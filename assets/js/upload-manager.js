/**
 * Upload manager (Phase 8.2) — owns every in-flight lesson-video upload for
 * the page, independent of whichever lesson editor modal happens to be open.
 *
 * WHY THIS EXISTS: VideoPanel used to hold the TUS upload itself, so closing
 * the lesson editor (or just opening a different lesson) tore the upload
 * down. That meant only one video could ever be mid-upload at a time, and
 * only while its modal stayed open. This module moves ownership of the
 * upload up to the page: a job started here keeps sending bytes to Bunny
 * regardless of which modal is open or closed, so several lessons — even
 * across different modules — can upload at the same time.
 *
 * WHAT IT DOES NOT CHANGE: the wire protocol, the backend contract, or the
 * one-candidate-per-lesson rule. Each job is still a single TUS upload for a
 * single (courseId, moduleId, lessonId, videoRecordId); VideoApi is still the
 * only thing that talks to the backend about it. This module just keeps that
 * job alive outside of any one panel's DOM lifecycle.
 *
 * SUBSCRIPTIONS: a VideoPanel for lesson X subscribes with that lesson's key
 * and gets called back with the job's current state whenever it changes —
 * including immediately, with whatever is already running, so a reopened
 * panel picks up an upload exactly where it is instead of saying "not
 * uploaded" while bytes are still moving in the background. Multiple
 * listeners (the panel + the tray) can subscribe to the same job.
 */

const UploadManager = (() => {
  // key -> { file, courseId, moduleId, lessonId, videoRecordId, pct, sent, total,
  //          status: 'uploading'|'done'|'error'|'cancelled', error, ctl, listeners:Set }
  const jobs = new Map();
  const trayListeners = new Set(); // notified whenever the SET of jobs changes (add/remove)

  const key = (courseId, moduleId, lessonId) => `${courseId}::${moduleId}::${lessonId}`;

  function notifyJob(job) {
    for (const fn of job.listeners) fn(snapshot(job));
  }
  function notifyTray() {
    for (const fn of trayListeners) fn(list());
  }

  function snapshot(job) {
    if (!job) return null;
    return {
      key: job.key,
      courseId: job.courseId,
      moduleId: job.moduleId,
      lessonId: job.lessonId,
      lessonTitle: job.lessonTitle,
      videoRecordId: job.videoRecordId,
      fileName: job.file.name,
      pct: job.pct,
      sent: job.sent,
      total: job.total,
      status: job.status, // 'uploading' | 'done' | 'error' | 'cancelled'
      error: job.error || null,
    };
  }

  function list() {
    return Array.from(jobs.values())
      .filter((j) => j.status === 'uploading')
      .map(snapshot);
  }

  /**
   * Start a new upload job for a lesson. Replaces any existing job for the
   * same lesson key (there can only be one candidate per lesson anyway).
   * @param {{courseId, moduleId, lessonId, lessonTitle, videoRecordId, file, creds}} o
   * @param {{onUploaded(id):void, onFailed(id,reason):void}} backendCb — called
   *   once, from inside this manager, to reconcile the backend. Kept here
   *   (rather than in VideoApi calls scattered across panel instances) so the
   *   reconciliation happens exactly once even if the panel that started the
   *   job is long gone by the time it finishes.
   */
  function startJob(o, backendCb) {
    const k = key(o.courseId, o.moduleId, o.lessonId);
    const prev = jobs.get(k);
    if (prev && prev.status === 'uploading' && prev.ctl) prev.ctl.abort();

    const job = {
      key: k,
      courseId: o.courseId,
      moduleId: o.moduleId,
      lessonId: o.lessonId,
      lessonTitle: o.lessonTitle || '',
      videoRecordId: o.videoRecordId,
      file: o.file,
      pct: 0,
      sent: 0,
      total: o.file.size,
      status: 'uploading',
      error: null,
      ctl: null,
      listeners: prev ? prev.listeners : new Set(),
    };
    jobs.set(k, job);
    notifyJob(job);
    notifyTray();

    job.ctl = VideoUpload.start(o.file, o.creds, {
      onProgress: (pct, sent, total) => {
        job.pct = pct;
        job.sent = sent;
        job.total = total;
        notifyJob(job);
        notifyTray();
      },
      onSuccess: async () => {
        job.status = 'done';
        job.ctl = null;
        notifyJob(job);
        notifyTray();
        try {
          await backendCb.onUploaded(job.videoRecordId);
        } finally {
          jobs.delete(k);
          notifyTray();
        }
      },
      onError: async (error, info) => {
        job.status = 'error';
        job.ctl = null;
        job.error = info && (info.status === 401 || info.status === 403)
          ? 'The upload authorization expired. Please start the upload again.'
          : 'The upload failed. Your existing video (if any) is unchanged. You can try again.';
        notifyJob(job);
        notifyTray();
        try {
          await backendCb.onFailed(job.videoRecordId, 'UPLOAD_FAILED');
        } finally {
          jobs.delete(k);
          notifyTray();
        }
      },
    });

    return k;
  }

  /** Cancel a running job (user-initiated). Reports to the backend once. */
  async function cancel(courseId, moduleId, lessonId, backendCb) {
    const k = key(courseId, moduleId, lessonId);
    const job = jobs.get(k);
    if (!job || job.status !== 'uploading') return;
    const ctl = job.ctl;
    const id = job.videoRecordId;
    job.status = 'cancelled';
    job.ctl = null;
    jobs.delete(k);
    notifyJob(job);
    notifyTray();
    if (ctl) await ctl.abort();
    if (backendCb && backendCb.onCancelled) {
      try { await backendCb.onCancelled(id); } catch (e) { /* best effort */ }
    }
  }

  /** Current job for a lesson, or null. Lets a freshly-mounted panel ask "is my lesson mid-upload?" */
  function get(courseId, moduleId, lessonId) {
    return snapshot(jobs.get(key(courseId, moduleId, lessonId)));
  }

  function isUploading(courseId, moduleId, lessonId) {
    const j = jobs.get(key(courseId, moduleId, lessonId));
    return Boolean(j && j.status === 'uploading');
  }

  /** Subscribe to one lesson's job (panel use). Returns an unsubscribe fn. Calls back immediately if a job exists. */
  function subscribe(courseId, moduleId, lessonId, fn) {
    const k = key(courseId, moduleId, lessonId);
    let job = jobs.get(k);
    if (!job) {
      // Register a placeholder listener set so a job started moments later
      // (race between subscribe and startJob) still reaches this listener.
      job = { key: k, listeners: new Set() };
      jobs.set(k, job);
      // Don't advertise a phantom job in the tray — only real jobs count there.
    }
    job.listeners.add(fn);
    if (job.status) fn(snapshot(job));
    return () => {
      const j = jobs.get(k);
      if (j) {
        j.listeners.delete(fn);
        // Clean up empty placeholders so they don't linger forever.
        if (!j.status && j.listeners.size === 0) jobs.delete(k);
      }
    };
  }

  /** Subscribe to the overall list of in-flight jobs (tray use). Returns an unsubscribe fn. */
  function subscribeTray(fn) {
    trayListeners.add(fn);
    fn(list());
    return () => trayListeners.delete(fn);
  }

  function hasAnyUploading() {
    for (const j of jobs.values()) if (j.status === 'uploading') return true;
    return false;
  }

  return { startJob, cancel, get, isUploading, subscribe, subscribeTray, hasAnyUploading };
})();
