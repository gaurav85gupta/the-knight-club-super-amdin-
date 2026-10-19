/**
 * Super Admin — Placeholders page controller (Central Placeholders System).
 *
 * Controls pages/placeholders.html. Loads the list of implemented
 * placeholders from the backend and renders each one. Right now only
 * home.skills.video is implemented; adding a future placeholder requires
 * no changes here — the list comes from the API.
 *
 * VIDEO UPLOAD FLOW (mirrors membership-page.js exactly — same Bunny TUS
 * pattern, same safe-replacement discipline):
 *
 *   1. Admin picks a file → file-input change fires
 *   2. initVideoUpload()  → backend creates Bunny video object → returns TUS creds
 *   3. VideoUpload.start() → browser uploads DIRECTLY to Bunny (never through backend)
 *   4. onSuccess          → markVideoUploaded() → backend polls Bunny for status
 *   5. VideoPoller starts polling until status becomes ready/failed
 *   6. Admin can "Preview" (signed embed URL) or "Remove" at any point
 *
 * SAFE RENDERING: all text via textContent / Dom.el (never innerHTML).
 * MASS ASSIGNMENT: PlaceholderApi builds explicit JSON bodies; req.body is
 * never spread blindly on the backend.
 */

(async function initPlaceholdersPage() {
  // ── 1. Auth guard ──────────────────────────────────────────────────────────
  const admin = await Auth.requireAuth();
  document.documentElement.classList.remove('auth-pending');
  document.getElementById('admin-identity').textContent = admin.name;

  // ── 2. Sign-out ────────────────────────────────────────────────────────────
  const logoutBtn = document.getElementById('logout-btn');
  let signingOut = false;
  logoutBtn.addEventListener('click', async () => {
    if (signingOut) return;
    signingOut = true;
    logoutBtn.disabled = true;
    await Auth.logout();
    window.location.replace(Auth.urlFor(Auth.PATHS.login));
  });

  // ── 3. Page-level alert helper ─────────────────────────────────────────────
  const pageAlert = document.getElementById('page-alert');
  function showAlert(kind, text) {
    pageAlert.className = `alert alert-${kind}`;
    pageAlert.textContent = text;
    pageAlert.hidden = false;
    pageAlert.focus();
  }
  function clearAlert() {
    pageAlert.hidden = true;
    pageAlert.textContent = '';
  }

  // ── 4. Containers ──────────────────────────────────────────────────────────
  const loadStateEl = document.getElementById('load-state');
  const listWrap = document.getElementById('placeholders-list');

  function setLoadState(kind, text) {
    loadStateEl.className = `state-box state-${kind}`;
    loadStateEl.textContent = text;
    loadStateEl.hidden = false;
    listWrap.hidden = true;
  }
  function clearLoadState() {
    loadStateEl.hidden = true;
    listWrap.hidden = false;
  }

  // ── 5. Load placeholders ───────────────────────────────────────────────────
  setLoadState('loading', 'Loading placeholders…');

  let items;
  try {
    const data = await PlaceholderApi.listPlaceholders();
    items = data.items || [];
  } catch (err) {
    if (Auth.handleSessionError(err)) return;
    setLoadState('error', Ui.messageForError(err) || 'Failed to load placeholders.');
    return;
  }

  clearLoadState();

  if (items.length === 0) {
    setLoadState('empty', 'No placeholders have been implemented yet.');
    return;
  }

  // ── 6. Render one card per placeholder ────────────────────────────────────
  for (const ph of items) {
    const card = buildPlaceholderCard(ph);
    listWrap.appendChild(card);
  }

  // ── 7. Card builder ────────────────────────────────────────────────────────
  /**
   * Builds the full card DOM for one placeholder.
   * For VIDEO type: renders current state, upload/replace/remove/preview.
   * Self-contained: all state for this card lives in the closure.
   */
  function buildPlaceholderCard(initial) {
    const key = initial.key;

    // -- Track current data for this card --
    let ph = initial; // latest server shape
    let busy = false;
    let uploadCtl = null; // { abort() } while a TUS upload is running

    // -- Card shell --
    const card = Dom.el('div', { class: 'card placeholder-card', 'data-key': key });

    // -- Header --
    const headerRow = Dom.el('div', { class: 'placeholder-card-header' });
    const titleGroup = Dom.el('div', { class: 'placeholder-card-title-group' });
    titleGroup.appendChild(Dom.el('h3', { class: 'placeholder-card-title', text: initial.label }));
    const breadcrumb = Dom.el('p', { class: 'placeholder-card-breadcrumb text-muted' });
    breadcrumb.textContent = `${initial.page} → ${initial.section}`;
    titleGroup.appendChild(breadcrumb);

    const keyBadge = Dom.el('code', { class: 'placeholder-key-badge', text: key });
    headerRow.appendChild(titleGroup);
    headerRow.appendChild(keyBadge);
    card.appendChild(headerRow);

    // -- Status row --
    const statusRow = Dom.el('div', { class: 'placeholder-status-row', 'aria-live': 'polite' });
    const statusLabel = Dom.el('span', { class: 'placeholder-status-label', text: 'Status:' });
    const statusBadge = Dom.el('span', { class: 'badge' });
    statusRow.appendChild(statusLabel);
    statusRow.appendChild(statusBadge);
    card.appendChild(statusRow);

    // -- VIDEO body --
    if (initial.type === 'VIDEO') {
      card.appendChild(buildVideoBody());
    }

    // -- Inline status message --
    const inlineStatus = Dom.el('p', { class: 'placeholder-inline-status', 'aria-live': 'polite', role: 'status' });
    card.appendChild(inlineStatus);

    // Initial render
    syncCard();

    return card;

    // ---- VIDEO section builder ----
    function buildVideoBody() {
      const wrap = Dom.el('div', { class: 'placeholder-video-body' });

      // Current state area
      const stateArea = Dom.el('div', { class: 'video-state-wrap' });
      const thumbPlaceholder = Dom.el('div', { class: 'video-placeholder', id: `vph-${key}` }, [
        videoIcon(),
        Dom.el('span', { text: 'No video configured' }),
      ]);
      const videoStatusRow = Dom.el('div', { class: 'video-status-row', hidden: true });
      const videoStatusLabel = Dom.el('span', { class: 'video-status-label', text: 'Video status:' });
      const videoStatusBadge = Dom.el('span', { class: 'badge' });
      const videoTitleLabel = Dom.el('span', { class: 'video-title-label text-muted' });
      videoStatusRow.appendChild(videoStatusLabel);
      videoStatusRow.appendChild(videoStatusBadge);
      videoStatusRow.appendChild(videoTitleLabel);

      const thumbWrap = Dom.el('div', { class: 'video-thumb-wrap', hidden: true });
      const thumbImg = Dom.el('img', { class: 'video-thumb', alt: 'Video thumbnail', loading: 'lazy' });
      thumbWrap.appendChild(thumbImg);

      stateArea.appendChild(thumbPlaceholder);
      stateArea.appendChild(videoStatusRow);
      stateArea.appendChild(thumbWrap);
      wrap.appendChild(stateArea);

      // Upload actions
      const uploadArea = Dom.el('div', { class: 'video-upload-area' });

      const uploadLabel = Dom.el('label', {
        class: 'btn btn-outline btn-sm media-upload-label',
        for: `upload-${key}`,
      }, [uploadIcon(), Dom.el('span', { class: 'upload-label-text', text: 'Upload Video' })]);

      const fileInput = Dom.el('input', {
        type: 'file',
        id: `upload-${key}`,
        accept: 'video/*,.mkv,.mov,.m4v,.ts,.mts,.m2ts',
        class: 'sr-only',
        'aria-label': `Upload video for ${initial.label}`,
      });

      const previewBtn = Dom.el('button', { type: 'button', class: 'btn btn-ghost btn-sm', hidden: true, text: 'Preview video' });
      const removeBtn = Dom.el('button', { type: 'button', class: 'btn btn-ghost btn-sm', hidden: true, text: 'Remove video' });

      uploadArea.appendChild(uploadLabel);
      uploadArea.appendChild(fileInput);
      uploadArea.appendChild(previewBtn);
      uploadArea.appendChild(removeBtn);
      wrap.appendChild(uploadArea);

      // Progress bar
      const progressWrap = Dom.el('div', { class: 'video-progress-wrap', hidden: true, 'aria-live': 'polite', role: 'status' });
      const progressTrack = Dom.el('div', { class: 'video-progress-bar-track' });
      const progressFill = Dom.el('div', { class: 'video-progress-bar-fill', style: 'width: 0%' });
      const progressLabel = Dom.el('p', { class: 'video-progress-label', text: 'Preparing upload…' });
      const abortBtn = Dom.el('button', { type: 'button', class: 'btn btn-ghost btn-sm', hidden: true, text: 'Cancel' });
      progressTrack.appendChild(progressFill);
      progressWrap.appendChild(progressTrack);
      progressWrap.appendChild(progressLabel);
      progressWrap.appendChild(abortBtn);
      wrap.appendChild(progressWrap);

      // Preview modal
      const modal = Dom.el('div', {
        class: 'media-modal', hidden: true,
        role: 'dialog', 'aria-modal': 'true', 'aria-label': `${initial.label} preview`,
      });
      const modalBackdrop = Dom.el('div', { class: 'media-modal-backdrop' });
      const modalInner = Dom.el('div', { class: 'media-modal-inner' });
      const modalClose = Dom.el('button', { type: 'button', class: 'media-modal-close', 'aria-label': 'Close preview' });
      modalClose.textContent = '×';
      const previewContainer = Dom.el('div', { class: 'video-preview-container' });
      modalInner.appendChild(modalClose);
      modalInner.appendChild(previewContainer);
      modal.appendChild(modalBackdrop);
      modal.appendChild(modalInner);
      wrap.appendChild(modal);

      // ---- Event handlers ----

      // File selected → start upload
      fileInput.addEventListener('change', async () => {
        const file = fileInput.files && fileInput.files[0];
        fileInput.value = '';
        if (!file) return;
        if (busy) return;
        await startUpload(file);
      });

      // Preview
      previewBtn.addEventListener('click', async () => {
        if (busy) return;
        busy = true;
        setInlineStatus('');
        previewBtn.disabled = true;
        try {
          const data = await PlaceholderApi.previewVideo(key);
          openPreviewModal(data.embedUrl);
        } catch (err) {
          if (Auth.handleSessionError(err)) return;
          setInlineStatus('error', Ui.messageForError(err) || 'Could not load preview.');
        } finally {
          busy = false;
          previewBtn.disabled = false;
        }
      });

      // Remove
      removeBtn.addEventListener('click', async () => {
        if (busy) return;
        const confirmed = await Ui.confirm({
          title: 'Remove video',
          message: `Remove the configured video from "${initial.label}"? The video asset on Bunny will not be deleted — only the configuration will be cleared.`,
          confirmLabel: 'Remove',
          danger: true,
        });
        if (!confirmed) return;
        busy = true;
        setInlineStatus('');
        disableActions(true);
        try {
          const data = await PlaceholderApi.removeVideo(key);
          ph = data.placeholder;
          syncCard();
          setInlineStatus('success', 'Video removed.');
        } catch (err) {
          if (Auth.handleSessionError(err)) return;
          setInlineStatus('error', Ui.messageForError(err) || 'Failed to remove video.');
        } finally {
          busy = false;
          disableActions(false);
        }
      });

      // Abort upload
      abortBtn.addEventListener('click', async () => {
        if (uploadCtl) {
          await uploadCtl.abort();
          uploadCtl = null;
        }
        VideoPoller.stop('aborted');
        busy = false;
        progressWrap.hidden = true;
        disableActions(false);
        setInlineStatus('info', 'Upload cancelled.');
      });

      // Modal close
      modalClose.addEventListener('click', closePreviewModal);
      modalBackdrop.addEventListener('click', closePreviewModal);
      document.addEventListener('keydown', (e) => {
        if (!modal.hidden && e.key === 'Escape') closePreviewModal();
      });

      function openPreviewModal(embedUrl) {
        Dom.clear(previewContainer);
        const safeEmbed = Dom.safeHttpsUrl(embedUrl);
        if (!safeEmbed) { Ui.notify('Could not load preview: invalid video URL.', 'error'); return; }
        const iframe = Dom.el('iframe', {
          src: safeEmbed,
          referrerpolicy: 'strict-origin-when-cross-origin',
          allow: 'accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture',
          allowfullscreen: '',
          title: `${initial.label} preview`,
        });
        previewContainer.appendChild(iframe);
        modal.hidden = false;
        modalClose.focus();
      }

      function closePreviewModal() {
        modal.hidden = true;
        Dom.clear(previewContainer);
        previewBtn.focus();
      }

      // ---- Upload flow ----
      async function startUpload(file) {
        if (!VideoUpload.isSupported()) {
          setInlineStatus('error', 'Your browser does not support resumable video uploads.');
          return;
        }

        const isReplacing = ph.status === 'CONFIGURED';
        busy = true;
        disableActions(true);
        progressWrap.hidden = false;
        progressFill.style.width = '0%';
        progressLabel.textContent = 'Initializing upload…';
        abortBtn.hidden = false;
        setInlineStatus('');

        let creds, videoId;
        try {
          const data = await PlaceholderApi.initVideoUpload(key, {
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type || undefined,
            replace: isReplacing,
          });
          creds = data.upload;
          videoId = creds.videoId;
          ph = data.placeholder;
          syncCard();
        } catch (err) {
          if (Auth.handleSessionError(err)) return;
          busy = false;
          progressWrap.hidden = true;
          disableActions(false);
          setInlineStatus('error', Ui.messageForError(err) || 'Failed to initialize upload.');
          return;
        }

        progressLabel.textContent = 'Uploading… 0%';

        uploadCtl = VideoUpload.start(file, creds, {
          onProgress(pct) {
            progressFill.style.width = `${pct}%`;
            progressLabel.textContent = `Uploading… ${pct}%`;
          },
          async onSuccess() {
            uploadCtl = null;
            progressLabel.textContent = 'Upload complete — waiting for processing…';
            progressFill.style.width = '100%';
            abortBtn.hidden = true;

            try {
              const data = await PlaceholderApi.markVideoUploaded(key, videoId);
              ph = data.placeholder;
              syncCard();
            } catch (err) {
              if (Auth.handleSessionError(err)) return;
              setInlineStatus('error', 'Upload succeeded but status sync failed. Refreshing…');
            }

            // Poll until ready/failed
            VideoPoller.start({
              fetch: () => PlaceholderApi.getVideoStatus(key),
              onUpdate(data, err) {
                if (err) return; // keep polling
                if (!data) return;
                const vs = data.videoStatus;
                ph.video = Object.assign({}, ph.video, { status: vs });
                syncCard();

                if (vs === 'ready') {
                  progressWrap.hidden = true;
                  busy = false;
                  disableActions(false);
                  setInlineStatus('success', 'Video is ready.');
                  // Refresh full placeholder data to get thumbnail URL
                  PlaceholderApi.getPlaceholder(key).then((fresh) => {
                    ph = fresh;
                    syncCard();
                  }).catch(() => {});
                }
                if (vs === 'failed') {
                  progressWrap.hidden = true;
                  busy = false;
                  disableActions(false);
                  setInlineStatus('error', 'Video processing failed. Please try uploading again.');
                }
              },
              isDone(data) {
                if (!data) return false;
                return data.videoStatus === 'ready' || data.videoStatus === 'failed';
              },
              onStop(reason) {
                if (reason === 'timeout') {
                  progressWrap.hidden = true;
                  busy = false;
                  disableActions(false);
                  setInlineStatus('error', 'Processing is taking longer than expected. Try refreshing the page.');
                }
                if (reason === 'errors') {
                  progressWrap.hidden = true;
                  busy = false;
                  disableActions(false);
                  setInlineStatus('error', 'Lost contact with the server while waiting for processing. Refresh to check status.');
                }
              },
            });
          },
          async onError(err, info) {
            uploadCtl = null;
            VideoPoller.stop('upload-error');
            busy = false;
            progressWrap.hidden = true;
            disableActions(false);

            // Report failure to backend so the record is updated
            PlaceholderApi.reportVideoFailure(key, videoId, err && err.message).catch(() => {});

            const msg = info && info.status === 401
              ? 'Upload session expired. Please try again.'
              : 'Upload failed. Check your connection and try again.';
            setInlineStatus('error', msg);
          },
        });
      }

      // ---- Sync helpers (video-specific) ----
      function syncVideoSection() {
        const v = ph.video || {};
        const vs = v.status || 'none';
        const configured = ph.status === 'CONFIGURED';

        // Placeholder vs thumbnail
        if (configured && v.thumbnailUrl) {
          thumbPlaceholder.hidden = true;
          thumbImg.src = v.thumbnailUrl;
          thumbWrap.hidden = false;
        } else {
          thumbPlaceholder.hidden = false;
          thumbWrap.hidden = true;
        }

        // Video status row
        if (configured || vs !== 'none') {
          videoStatusRow.hidden = false;
          videoStatusBadge.textContent = videoStatusLabel_text(vs);
          videoStatusBadge.className = `badge badge-sm badge-vs-${vs}`;
          videoTitleLabel.textContent = v.title ? `— ${v.title}` : '';
        } else {
          videoStatusRow.hidden = true;
        }

        // Buttons
        const hasVideo = configured;
        const isProcessing = vs === 'uploading' || vs === 'processing';
        previewBtn.hidden = !hasVideo || isProcessing;
        removeBtn.hidden = !hasVideo;
        const uploadLabelText = uploadArea.querySelector('.upload-label-text');
        if (uploadLabelText) {
          uploadLabelText.textContent = hasVideo ? 'Replace Video' : 'Upload Video';
        }
      }

      function disableActions(on) {
        uploadLabel.style.pointerEvents = on ? 'none' : '';
        uploadLabel.style.opacity = on ? '0.5' : '';
        previewBtn.disabled = on;
        removeBtn.disabled = on;
      }

      // Make syncVideoSection accessible from outer syncCard
      card._syncVideo = syncVideoSection;

      return wrap;
    }

    // ---- Outer sync (status badge + calls video sync) ----
    function syncCard() {
      // Top-level status badge
      const configured = ph.status === 'CONFIGURED';
      statusBadge.textContent = configured ? 'Configured' : 'Not Configured';
      statusBadge.className = `badge badge-sm ${configured ? 'badge-configured' : 'badge-not-configured'}`;

      // Call video sync if present
      if (typeof card._syncVideo === 'function') {
        card._syncVideo();
      }
    }

    function setInlineStatus(kind, text) {
      if (!kind && !text) {
        inlineStatus.textContent = '';
        inlineStatus.className = 'placeholder-inline-status';
        return;
      }
      inlineStatus.textContent = text || '';
      inlineStatus.className = `placeholder-inline-status placeholder-inline-status-${kind}`;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function videoStatusLabel_text(vs) {
    return {
      none: 'Not uploaded',
      uploading: 'Uploading',
      processing: 'Processing',
      ready: 'Ready',
      failed: 'Failed',
    }[vs] || vs;
  }

  function videoIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '40');
    svg.setAttribute('height', '40');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.5');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>';
    return svg;
  }

  function uploadIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>';
    return svg;
  }
})();
