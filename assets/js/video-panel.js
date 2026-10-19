/**
 * Lesson video panel (Phase 8) — the "VIDEO" section of the Phase 7 lesson
 * editor. Everything the admin does with a lesson's video happens here.
 *
 * SOURCE OF TRUTH: the backend. This panel never decides a video is READY; it
 * renders whatever /video/status reports. After a page refresh it simply asks
 * the backend again (spec 40), so a refresh can never fake progress.
 *
 * Two independent things are shown, because replacement needs both:
 *   - the ACTIVE video (what the lesson serves now) — unaffected while a
 *     replacement uploads or fails (spec 23)
 *   - a PENDING candidate (an upload or replacement in progress / failed)
 *
 * SAFE RENDERING: DOM built with Dom.el / textContent only; the preview iframe
 * gets a URL that the backend signed for Bunny's own player host.
 */

const VideoPanel = (() => {
  const FORMAT_HINT = 'MP4, MOV, MKV, WebM and other common video formats.';

  /**
   * @param {{courseId, moduleId, lessonId, lessonTitle, onChange?:()=>void}} ctx
   * @returns {{ element: HTMLElement, destroy(): void }}
   */
  function create(ctx) {
    const { courseId, moduleId, lessonId } = ctx;
    const root = Dom.el('section', { class: 'video-panel', 'aria-labelledby': `video-h-${lessonId}` });
    const body = Dom.el('div');
    root.appendChild(Dom.el('h4', { id: `video-h-${lessonId}`, text: 'Video' }));
    root.appendChild(body);

    const fileInput = Dom.el('input', { type: 'file', class: 'video-file-input', accept: 'video/*,.mkv,.mov,.m4v,.ts,.mts,.m2ts', 'aria-label': 'Choose a video file' });
    root.appendChild(fileInput);

    let data = null; // last overview from the backend
    let destroyed = false;
    let busy = false; // an API action is in flight (disables buttons: spec 39)
    let uploadCtl = null; // { abort() } while a TUS upload runs
    let uploadState = null; // { videoRecordId, pct } while THIS tab is uploading
    let replaceIntent = false; // chosen file is a replacement
    let note = null; // { kind, text }

    // ------------------------------------------------------------------ helpers
    const fmtBytes = (n) => {
      if (!Number.isFinite(n) || n <= 0) return '—';
      const u = ['B', 'KB', 'MB', 'GB', 'TB'];
      let i = 0;
      let v = n;
      while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
      return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
    };
    const fmtDuration = (s) => {
      if (!s) return '—';
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = s % 60;
      return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
    };
    const stateBadge = (state) => {
      const label = { NOT_ATTACHED: 'Not uploaded', INITIALIZING: 'Preparing', UPLOADING: 'Uploading', UPLOADED: 'Uploaded', PROCESSING: 'Processing', READY: 'Ready', FAILED: 'Failed' }[state] || state;
      return Dom.el('span', { class: `badge badge-sm badge-vs-${String(state).toLowerCase()}`, text: label });
    };
    const errMsg = (err) => {
      if (err instanceof ApiError) {
        if (err.errorCode === 'VIDEO_NOT_CONFIGURED') return 'Video hosting is not configured on the server yet.';
        if (err.errorCode === 'VIDEO_PROVIDER_UNAVAILABLE') return 'The video service is temporarily unreachable. Please try again shortly.';
        if (err.errorCode === 'VIDEO_PROVIDER_ERROR') return 'The video service reported a problem. Please try again shortly.';
        if (err.status === 404) return err.message || 'That video could not be found. It may have been removed.';
        if (err.status === 409 || err.status === 422 || err.status === 400) return err.message;
        return Ui.messageForError(err);
      }
      return 'Something went wrong. Please try again.';
    };
    const say = (kind, text) => { note = text ? { kind, text } : null; render(); };

    function rebuildIfNeeded() {
      // Keep polling only while something is in flight.
      if (destroyed) return;
      if (needsPolling(data)) startPolling();
      else VideoPoller.stop('idle');
    }

    // ------------------------------------------------------------------ data
    function apply(next) {
      data = next;
      render();
      rebuildIfNeeded();
      if (ctx.onChange) ctx.onChange(data);
    }

    async function load() {
      try {
        apply(await VideoApi.overview(courseId, moduleId, lessonId));
        // A refresh mid-processing: immediately ask Bunny (through the backend) where it is.
        if (needsPolling(data)) startPolling();
      } catch (err) {
        if (Auth.handleSessionError(err)) return;
        body.replaceChildren(Dom.el('p', { class: 'field-error', text: errMsg(err) }));
      }
    }

    // An upload is only "in progress in the browser" if THIS tab is running it;
    // a candidate left UPLOADING by a closed tab is shown honestly as interrupted.
    const candidateInFlight = (d) => d && d.candidate && ['INITIALIZING', 'UPLOADING', 'UPLOADED', 'PROCESSING'].includes(d.candidate.status) && d.candidate.lifecycle === 'CANDIDATE';
    // Poll only what Bunny does after our bytes arrive (never while the browser is still sending).
    const needsPolling = (d) => candidateInFlight(d) && !uploadState && ['UPLOADING', 'UPLOADED', 'PROCESSING'].includes(d.candidate.status);

    function startPolling() {
      if (VideoPoller.isRunning() && !destroyed) return;
      VideoPoller.start({
        fetch: () => VideoApi.status(courseId, moduleId, lessonId),
        onUpdate: (d, err) => {
          if (destroyed) return;
          if (err) {
            if (Auth.handleSessionError(err)) return;
            say('error', errMsg(err));
            return;
          }
          const wasActiveId = data && data.active && data.active.id;
          data = d;
          render();
          if (d.active && d.active.id !== wasActiveId && d.state === 'READY') {
            say('success', 'Video is ready and attached to the lesson.');
            if (ctx.onChange) ctx.onChange(data);
          }
        },
        isDone: (d) => !needsPollingFrom(d),
        onStop: (reason) => {
          if (reason === 'timeout' && !destroyed) say('info', 'Still processing. Reopen this lesson later to check again.');
          if (reason === 'errors' && !destroyed) say('error', 'Lost contact with the server while checking progress. Reopen this lesson to continue.');
        },
      });
    }
    // Same test as needsPolling but for the poller's own data (uploadState is irrelevant server-side).
    const needsPollingFrom = (d) => candidateInFlight(d) && ['UPLOADING', 'UPLOADED', 'PROCESSING'].includes(d.candidate.status);

    // ------------------------------------------------------------------ actions
    async function guarded(fn) {
      if (busy) return;
      busy = true;
      render();
      try {
        await fn();
      } catch (err) {
        if (Auth.handleSessionError(err)) return;
        say('error', errMsg(err));
      } finally {
        busy = false;
        if (!destroyed) render();
      }
    }

    function chooseFile(replace) {
      if (busy || uploadState) return;
      replaceIntent = replace;
      fileInput.value = '';
      fileInput.click();
    }

    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      beginUpload(file, replaceIntent);
    });

    /** Init on our backend (small JSON) -> send bytes straight to Bunny -> tell the backend. */
    function beginUpload(file, replace) {
      guarded(async () => {
        if (!VideoUpload.isSupported()) throw new Error('unsupported');
        say(null, '');
        const init = await VideoApi.initializeUpload(courseId, moduleId, lessonId, {
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type || '',
          replace,
        });
        const rec = init.video;
        uploadState = { videoRecordId: rec.id, pct: 0, fileName: file.name, total: file.size };
        // Re-fetch so the UI reflects the new candidate; then start sending.
        data = { ...(data || {}), candidate: rec, state: 'UPLOADING' };
        render();

        uploadCtl = VideoUpload.start(file, init.upload, {
          onProgress: (pct) => {
            if (!uploadState) return;
            uploadState.pct = pct;
            paintProgress();
          },
          onSuccess: async () => {
            uploadCtl = null;
            const id = uploadState && uploadState.videoRecordId;
            uploadState = null;
            try {
              await VideoApi.markUploaded(courseId, moduleId, lessonId, id);
            } catch (e) {
              /* non-fatal: the poller reconciles from Bunny either way */
            }
            say('info', 'Upload complete. Processing…');
            await load();
            startPolling();
          },
          onError: async (error, info) => {
            uploadCtl = null;
            const id = uploadState && uploadState.videoRecordId;
            uploadState = null;
            // 401/403 from Bunny = our signed authorization expired or was refused.
            const reason = 'UPLOAD_FAILED';
            try { if (id) await VideoApi.reportFailure(courseId, moduleId, lessonId, id, reason); } catch (e) { /* best effort */ }
            say('error', info && (info.status === 401 || info.status === 403) ? 'The upload authorization expired. Please start the upload again.' : 'The upload failed. Your existing video (if any) is unchanged. You can try again.');
            await load();
          },
        });
      });
    }

    async function cancelUpload() {
      if (!uploadState) return;
      const id = uploadState.videoRecordId;
      const ctl = uploadCtl;
      uploadCtl = null;
      uploadState = null;
      if (ctl) await ctl.abort();
      try { await VideoApi.reportFailure(courseId, moduleId, lessonId, id, 'UPLOAD_CANCELLED'); } catch (e) { /* best effort */ }
      say('info', 'Upload cancelled.');
      await load();
    }

    async function discardPending() {
      if (!data || !data.candidate) return;
      const ok = await Ui.confirm({ title: 'Discard this upload?', message: 'The pending upload is dropped. The lesson\'s current video (if any) is not affected.', confirmLabel: 'Discard', danger: true });
      if (!ok) return;
      guarded(async () => {
        await VideoApi.discard(courseId, moduleId, lessonId, data.candidate.id);
        say('info', 'Upload discarded.');
        await load();
      });
    }

    async function preview(videoRecordId) {
      guarded(async () => {
        const r = await VideoApi.preview(courseId, moduleId, lessonId, videoRecordId);
        openPreview(r.playback.embedUrl);
      });
    }

    async function removeFromLesson() {
      const ok = await Ui.confirm({
        title: 'Remove video from this lesson?',
        message: 'The lesson will no longer show this video. The file itself stays stored at the video service, and you can delete it separately afterwards.',
        confirmLabel: 'Remove from lesson',
        danger: true,
      });
      if (!ok) return;
      guarded(async () => {
        await VideoApi.removeFromLesson(courseId, moduleId, lessonId);
        say('success', 'Video removed from the lesson.');
        await load();
      });
    }

    async function deleteAsset(rec) {
      const ok = await Ui.confirm({
        title: 'Permanently delete this video file?',
        message: 'The file is deleted from the video service and cannot be recovered.',
        confirmLabel: 'Delete file',
        danger: true,
      });
      if (!ok) return;
      guarded(async () => {
        await VideoApi.deleteAsset(courseId, moduleId, lessonId, rec.id);
        say('success', 'Video file deleted.');
        await load();
      });
    }

    async function refreshNow() {
      guarded(async () => apply(await VideoApi.status(courseId, moduleId, lessonId)));
    }

    // ------------------------------------------------------------------ preview modal
    function openPreview(embedUrl) {
      const previously = document.activeElement;
      const safeEmbed = Dom.safeHttpsUrl(embedUrl);
      if (!safeEmbed) { say('error', 'Could not load preview: invalid video URL.'); return; }
      const iframe = Dom.el('iframe', {
        src: safeEmbed,
        title: 'Lesson video preview',
        allow: 'accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen',
        allowfullscreen: true,
        referrerpolicy: 'strict-origin-when-cross-origin',
      });
      const closeBtn = Dom.el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'Close' });
      const backdrop = Dom.el('div', { class: 'modal-backdrop' }, [
        Dom.el('div', { class: 'modal video-preview-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Video preview' }, [
          Dom.el('div', { class: 'video-frame' }, [iframe]),
          Dom.el('p', { class: 'video-note', text: 'Streamed directly from the video service. This preview link expires shortly.' }),
          Dom.el('div', { class: 'modal-actions' }, [closeBtn]),
        ]),
      ]);
      const close = () => {
        document.removeEventListener('keydown', onKey, true);
        iframe.src = 'about:blank'; // stop playback and drop the signed URL
        backdrop.remove();
        if (previously && previously.focus) previously.focus();
      };
      const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
      closeBtn.addEventListener('click', close);
      backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(backdrop);
      closeBtn.focus();
    }

    // ------------------------------------------------------------------ rendering
    let progressEl = null;
    let progressLabel = null;
    function paintProgress() {
      if (!uploadState || !progressEl) return;
      progressEl.style.width = `${uploadState.pct}%`;
      if (progressLabel) progressLabel.textContent = `Uploading… ${uploadState.pct}%`;
      const bar = progressEl.parentElement;
      if (bar) bar.setAttribute('aria-valuenow', String(uploadState.pct));
    }

    function metaList(rec) {
      const rows = [
        ['File', rec.fileName || '—'],
        ['Size', fmtBytes(rec.fileSizeBytes)],
        ['Duration', fmtDuration(rec.durationSeconds)],
        ['Quality', rec.resolutions && rec.resolutions.length ? rec.resolutions.join(', ') : '—'],
        ['Ready since', Dom.formatDate(rec.readyAt)],
      ];
      const dl = Dom.el('dl', { class: 'video-meta' });
      for (const [k, v] of rows) { dl.appendChild(Dom.el('dt', { text: k })); dl.appendChild(Dom.el('dd', { text: v })); }
      return dl;
    }

    function renderActive(rec, frag) {
      if (rec.thumbnailUrl) {
        frag.appendChild(Dom.el('img', { class: 'video-thumb', src: rec.thumbnailUrl, alt: 'Video thumbnail', loading: 'lazy', referrerpolicy: 'no-referrer' }));
      }
      frag.appendChild(metaList(rec));
      frag.appendChild(
        Dom.el('div', { class: 'video-actions' }, [
          Dom.el('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Preview', disabled: busy, onclick: () => preview(null) }),
          Dom.el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'Replace', disabled: busy || Boolean(uploadState) || candidateInFlight(data), onclick: () => chooseFile(true) }),
          Dom.el('button', { type: 'button', class: 'btn btn-danger btn-sm', text: 'Remove', disabled: busy, onclick: removeFromLesson }),
        ])
      );
    }

    function renderCandidate(cand, hasActive, frag) {
      const wrap = Dom.el('div', { class: hasActive ? 'video-pending' : '' });
      const title = hasActive ? 'Replacement video' : 'New video';
      const head = Dom.el('div', { class: 'video-head' }, [Dom.el('span', { class: 'video-headline', text: title }), stateBadge(cand.status)]);
      wrap.appendChild(head);
      if (hasActive) wrap.appendChild(Dom.el('p', { class: 'video-note', text: 'The current video stays live until the new one is ready.' }));

      const sending = uploadState && uploadState.videoRecordId === cand.id;
      if (sending) {
        const bar = Dom.el('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(uploadState.pct), 'aria-label': 'Upload progress' }, [Dom.el('span')]);
        progressEl = bar.firstChild;
        progressLabel = Dom.el('div', { class: 'progress-label', 'aria-live': 'polite', text: `Uploading… ${uploadState.pct}%` });
        wrap.appendChild(bar);
        wrap.appendChild(progressLabel);
        wrap.appendChild(Dom.el('p', { class: 'video-note', text: 'Keep this page open until the upload finishes. It resumes automatically if your connection drops.' }));
        wrap.appendChild(Dom.el('div', { class: 'video-actions' }, [Dom.el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'Cancel upload', onclick: cancelUpload })]));
        paintProgress();
      } else if (cand.status === 'FAILED') {
        wrap.appendChild(Dom.el('p', { class: 'field-error', text: cand.failureMessage || 'This video could not be completed.' }));
        wrap.appendChild(
          Dom.el('div', { class: 'video-actions' }, [
            Dom.el('button', { type: 'button', class: 'btn btn-primary btn-sm', text: hasActive ? 'Try replacing again' : 'Try again', disabled: busy, onclick: () => chooseFile(hasActive) }),
            Dom.el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'Dismiss', disabled: busy, onclick: discardPending }),
          ])
        );
      } else {
        // Bunny is working (or a closed tab left it mid-upload/mid-processing).
        // Discard must be offered for EVERY non-terminal status, not just
        // UPLOADING/INITIALIZING — a candidate can just as easily get stuck at
        // UPLOADED or PROCESSING (tab closed/refreshed after bytes finished but
        // before Bunny confirmed Finished), and with no admin escape hatch that
        // candidate permanently blocks any new upload for this lesson (the
        // one-in-flight-candidate index rejects it).
        const uploadingElsewhere = ['UPLOADING', 'INITIALIZING', 'UPLOADED', 'PROCESSING'].includes(cand.status);
        const indeterminate = Dom.el('div', { class: `progress ${cand.status === 'PROCESSING' && cand.encodeProgress ? '' : 'is-indeterminate'}`, role: 'progressbar', 'aria-label': 'Processing progress' }, [Dom.el('span')]);
        if (cand.status === 'PROCESSING' && cand.encodeProgress) {
          indeterminate.firstChild.style.width = `${cand.encodeProgress}%`;
          indeterminate.setAttribute('aria-valuenow', String(cand.encodeProgress));
        }
        wrap.appendChild(indeterminate);
        const text =
          cand.status === 'PROCESSING' ? `Processing… ${cand.encodeProgress ? `${cand.encodeProgress}%` : ''}`.trim()
          : cand.status === 'UPLOADED' ? 'Upload complete. Waiting for processing to start…'
          : 'Waiting for the upload. If you closed the upload page, start it again.';
        wrap.appendChild(Dom.el('div', { class: 'progress-label', 'aria-live': 'polite', text }));
        wrap.appendChild(
          Dom.el('div', { class: 'video-actions' }, [
            Dom.el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'Check now', disabled: busy, onclick: refreshNow }),
            uploadingElsewhere ? Dom.el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'Discard', disabled: busy, onclick: discardPending }) : null,
          ])
        );
      }
      frag.appendChild(wrap);
    }

    function renderHistory(frag) {
      const old = (data.history || []).filter((h) => !h.isActive && h.lifecycle !== 'CANDIDATE' && h.lifecycle !== 'ABANDONED' && h.lifecycle !== 'DELETED');
      if (!old.length) return;
      const list = Dom.el('ul');
      for (const h of old) {
        const label = h.lifecycle === 'REPLACED' ? 'Replaced' : h.lifecycle === 'REMOVED' ? 'Removed from lesson' : h.lifecycle;
        list.appendChild(
          Dom.el('li', {}, [
            Dom.el('span', { text: `${h.fileName || 'Video'} — ${label} ${Dom.formatDate(h.replacedAt || h.removedAt || h.createdAt)}` }),
            h.status === 'READY' ? Dom.el('button', { type: 'button', class: 'btn btn-outline btn-xs', text: 'Preview', disabled: busy, onclick: () => preview(h.id) }) : null,
            Dom.el('button', { type: 'button', class: 'btn btn-danger btn-xs', text: 'Delete file', disabled: busy, onclick: () => deleteAsset(h) }),
          ])
        );
      }
      frag.appendChild(Dom.el('details', { class: 'video-history' }, [Dom.el('summary', { text: `Previous videos (${old.length})` }), list]));
    }

    function render() {
      if (destroyed) return;
      progressEl = null;
      progressLabel = null;
      const frag = document.createDocumentFragment();

      if (!data) {
        frag.appendChild(Dom.el('p', { class: 'video-note', text: 'Loading video…' }));
        body.replaceChildren(frag);
        return;
      }

      const headline = data.state === 'NOT_ATTACHED' ? 'Not uploaded' : data.state === 'READY' ? 'Ready' : { INITIALIZING: 'Preparing upload', UPLOADING: 'Uploading', UPLOADED: 'Uploaded', PROCESSING: 'Processing', FAILED: 'Failed' }[data.state] || data.state;
      frag.appendChild(Dom.el('div', { class: 'video-head' }, [Dom.el('span', { class: 'video-headline', text: `Status: ${headline}` }), stateBadge(data.state)]));

      if (note) frag.appendChild(Dom.el('div', { class: `alert alert-${note.kind || 'info'}`, role: note.kind === 'error' ? 'alert' : 'status', text: note.text }));

      if (!data.configured) {
        frag.appendChild(Dom.el('p', { class: 'video-note', text: 'Video hosting is not configured on the server yet. Uploads are unavailable.' }));
      }

      const hasActive = Boolean(data.active);
      if (hasActive) renderActive(data.active, frag);

      const cand = data.candidate && data.candidate.lifecycle === 'CANDIDATE' ? data.candidate : null;
      // An ABANDONED attempt is history, not a pending item, so it is not shown here.
      if (cand) renderCandidate(cand, hasActive, frag);

      if (!hasActive && !cand) {
        frag.appendChild(Dom.el('p', { class: 'video-note', text: `No video is attached to this lesson yet. ${FORMAT_HINT}` }));
        frag.appendChild(
          Dom.el('div', { class: 'video-actions' }, [
            Dom.el('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Upload video', disabled: busy || !data.configured || !VideoUpload.isSupported(), onclick: () => chooseFile(false) }),
          ])
        );
      }

      renderHistory(frag);
      body.replaceChildren(frag);
    }

    // Warn before leaving the page while THIS tab is sending bytes.
    function onBeforeUnload(e) {
      if (uploadState) { e.preventDefault(); e.returnValue = ''; }
    }
    window.addEventListener('beforeunload', onBeforeUnload);

    function destroy() {
      destroyed = true;
      VideoPoller.stop('destroyed');
      window.removeEventListener('beforeunload', onBeforeUnload);
      if (uploadCtl) { uploadCtl.abort(); uploadCtl = null; }
      if (uploadState) {
        // Tell the backend so the lesson is not left with a phantom "uploading" slot.
        const id = uploadState.videoRecordId;
        uploadState = null;
        VideoApi.reportFailure(courseId, moduleId, lessonId, id, 'UPLOAD_CANCELLED').catch(() => {});
      }
    }

    render();
    load();
    return { element: root, destroy, isUploading: () => Boolean(uploadState) };
  }

  return { create };
})();