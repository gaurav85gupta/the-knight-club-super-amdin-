/**
 * Testimonial VIDEO upload panel (NEW — additive).
 *
 * Fills the gap this phase was asked to fix: the testimonial form's VIDEO
 * type previously offered ONLY a plain "Bunny video ID" text box — nothing
 * in the app could actually put a video into Bunny Stream. This panel adds
 * a real "Upload video" control next to that field, using the SAME Bunny
 * TUS pattern already proven for lesson videos / placeholders / membership
 * media (assets/js/video-upload.js, assets/js/video-poller.js — BOTH
 * reused completely unchanged; this file adds no new upload transport).
 *
 * SCOPE — deliberately simpler than VideoPanel (curriculum.js's lesson
 * video editor):
 *   - No UploadManager/background-tray integration. A lesson upload must
 *     survive the editor modal being closed because an admin juggles many
 *     lessons; a testimonial is edited one at a time on its own page, so
 *     the upload only needs to survive while this page/tab stays open —
 *     exactly the same scope TestimonialsApi.uploadPhoto's photo upload
 *     already has (it also just disables the form and waits).
 *   - No "replace keeps the old asset active until the new one is ready"
 *     state machine, because testimonial media.video has no document of
 *     its own to protect mid-upload (see testimonialVideo.controller.js —
 *     this whole flow is stateless until the admin clicks Save). Replacing
 *     a video here simply starts a new upload and overwrites the Bunny
 *     video ID input once it succeeds, same as replacing a photo already
 *     does for #photo-ref.
 *
 * WHAT THIS NEVER DOES:
 *   - Touch the Testimonial document. It only ever writes the resulting
 *     Bunny video id into the existing #bunny-video-id text input — the
 *     SAME field the admin could already hand-type into. Saving the form
 *     (testimonial-form.js, unchanged) is what persists it.
 *   - Reimplement TUS. Byte-sending is 100% VideoUpload.start (unchanged).
 *   - Hide or remove the manual "Bunny video ID" input — an admin who
 *     already has a video id from elsewhere can still paste it directly;
 *     this panel is additive, not a replacement for that escape hatch.
 */

const TestimonialVideoPanel = (() => {
  /**
   * @param {{
   *   getInput: () => HTMLInputElement,      // the existing #bunny-video-id input
   *   mountNode: HTMLElement,                 // where this panel renders its UI
   *   onBusyChange?: (busy: boolean) => void, // disable Save while uploading
   * }} ctx
   * @returns {{ destroy(): void }}
   */
  function create(ctx) {
    const { getInput, mountNode } = ctx;
    const poller = VideoPoller.create(); // this panel's own instance — never the shared default (spec precedent: video-poller.js header)

    let destroyed = false;
    let state = 'idle'; // 'idle' | 'uploading' | 'processing' | 'ready' | 'failed'
    let pct = 0;
    let fileName = '';
    let errorText = '';
    let currentVideoId = '';
    let abortCurrent = null;

    const root = Dom.el('div', { class: 'thumbnail-upload-slot testimonial-video-upload' });
    mountNode.appendChild(root);

    const fileInput = Dom.el('input', {
      type: 'file',
      class: 'video-file-input',
      accept: 'video/*,.mkv,.mov,.m4v,.ts,.mts,.m2ts',
      'aria-label': 'Choose a testimonial video file',
    });
    mountNode.appendChild(fileInput);

    function setBusy(busy) {
      if (ctx.onBusyChange) ctx.onBusyChange(busy);
    }

    function syncInputFromVideoId(videoId) {
      const input = getInput();
      if (input) {
        input.value = videoId;
        input.dispatchEvent(new Event('input'));
      }
    }

    function render() {
      if (destroyed) return;
      Dom.clear(root);

      if (state === 'idle') {
        root.appendChild(
          Dom.el('button', {
            type: 'button',
            class: 'btn btn-outline btn-sm',
            text: 'Upload video',
            disabled: !VideoUpload.isSupported(),
            onclick: () => fileInput.click(),
          })
        );
        if (!VideoUpload.isSupported()) {
          root.appendChild(Dom.el('p', { class: 'video-note', text: 'This browser cannot upload large videos. Please use the Bunny video ID field instead, or try a different browser.' }));
        }
        return;
      }

      if (state === 'uploading') {
        root.appendChild(Dom.el('p', { class: 'video-note', text: `Uploading “${fileName}”… ${pct}%` }));
        root.appendChild(
          Dom.el('button', {
            type: 'button',
            class: 'btn btn-outline btn-sm',
            text: 'Cancel',
            onclick: cancelUpload,
          })
        );
        return;
      }

      if (state === 'processing') {
        root.appendChild(Dom.el('p', { class: 'video-note', text: `Uploaded. Bunny is processing “${fileName}”… this can take a few minutes for a longer video.` }));
        return;
      }

      if (state === 'ready') {
        root.appendChild(Dom.el('p', { class: 'thumbnail-upload-status is-success', text: `“${fileName}” is ready.` }));
        root.appendChild(
          Dom.el('button', {
            type: 'button',
            class: 'btn btn-outline btn-sm',
            text: 'Replace video',
            onclick: () => fileInput.click(),
          })
        );
        return;
      }

      if (state === 'failed') {
        root.appendChild(Dom.el('p', { class: 'thumbnail-upload-status is-error', text: errorText || 'Upload failed.' }));
        root.appendChild(
          Dom.el('button', {
            type: 'button',
            class: 'btn btn-outline btn-sm',
            text: 'Try again',
            onclick: () => fileInput.click(),
          })
        );
      }
    }

    function startPolling(videoId) {
      poller.start({
        fetch: () => TestimonialVideoApi.getStatus(videoId),
        onUpdate: (data) => {
          if (destroyed || !data) return;
          if (data.videoStatus === 'READY') {
            state = 'ready';
            render();
          } else if (data.videoStatus === 'FAILED') {
            state = 'failed';
            errorText = 'Bunny could not process this video. Please try uploading again.';
            render();
          } else {
            state = 'processing';
            render();
          }
        },
        isDone: (data) => Boolean(data) && (data.videoStatus === 'READY' || data.videoStatus === 'FAILED'),
        onStop: (reason) => {
          if (destroyed) return;
          if (reason === 'timeout' || reason === 'errors') {
            state = 'failed';
            errorText = 'Still processing after a long wait. Check back later, or try uploading again.';
            render();
          }
        },
      });
    }

    async function cancelUpload() {
      if (abortCurrent) await abortCurrent();
      abortCurrent = null;
      poller.stop('cancelled');
      state = currentVideoId ? 'processing' : 'idle';
      setBusy(false);
      if (currentVideoId) {
        TestimonialVideoApi.reportFailure(currentVideoId, 'UPLOAD_CANCELLED').catch(() => {});
        state = 'idle';
      }
      render();
    }

    async function handleFile() {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!file) return;

      state = 'uploading';
      pct = 0;
      fileName = file.name;
      errorText = '';
      setBusy(true);
      render();

      try {
        const init = await TestimonialVideoApi.initUpload({
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type || '',
        });
        currentVideoId = init.bunnyVideoId;
        syncInputFromVideoId(currentVideoId);

        abortCurrent = null;
        const handle = VideoUpload.start(file, init.upload, {
          onProgress: (p) => {
            pct = p;
            render();
          },
          onSuccess: () => {
            state = 'processing';
            setBusy(false);
            render();
            startPolling(currentVideoId);
          },
          onError: (err, info) => {
            state = 'failed';
            setBusy(false);
            errorText = info && (info.status === 401 || info.status === 403)
              ? 'The upload authorization expired. Please try again.'
              : 'The upload failed. Please try again.';
            render();
            TestimonialVideoApi.reportFailure(currentVideoId, 'UPLOAD_FAILED').catch(() => {});
          },
        });
        abortCurrent = handle.abort;
      } catch (err) {
        state = 'failed';
        setBusy(false);
        errorText = (err && err.message) || 'Could not start the upload.';
        render();
      }
    }

    fileInput.addEventListener('change', handleFile);

    // If the field already has a value on load (editing an existing VIDEO
    // testimonial, or a value just typed by hand), show it as already set —
    // this panel only drives NEW uploads; it never second-guesses a
    // hand-entered id by polling it uninvited.
    function syncFromExistingValue() {
      const input = getInput();
      const existing = input && input.value.trim();
      if (existing) {
        currentVideoId = existing;
        fileName = 'existing video';
        state = 'ready';
      } else {
        state = 'idle';
      }
      render();
    }
    syncFromExistingValue();

    function destroy() {
      destroyed = true;
      poller.stop('destroyed');
      if (abortCurrent) abortCurrent().catch(() => {});
    }

    return { destroy, refresh: syncFromExistingValue };
  }

  return { create };
})();
