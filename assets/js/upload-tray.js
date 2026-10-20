/**
 * Floating upload tray (Phase 8.2) — the page-level view of every
 * lesson-video upload UploadManager is currently running in the background.
 *
 * This is what makes "upload several lessons' videos at once" visible and
 * manageable: start lesson A's upload, close its editor, open lesson B and
 * start its upload too — both now show up here, each with its own progress
 * and its own cancel button, independent of which (if any) lesson editor is
 * open.
 *
 * Mounted ONCE per page (course-form.html calls UploadTray.mount()). Hidden
 * entirely whenever there are zero in-flight uploads so it never clutters
 * the screen on a page where nothing is uploading.
 */

const UploadTray = (() => {
  let root = null;
  let unsubscribe = null;
  let collapsed = false;

  const fmtBytes = (n) => {
    if (!Number.isFinite(n) || n <= 0) return '—';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
    return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
  };

  function render(jobs) {
    if (!root) return;
    if (!jobs.length) { root.hidden = true; root.replaceChildren(); return; }
    root.hidden = false;

    const header = Dom.el('div', { class: 'upload-tray-head', onclick: () => { collapsed = !collapsed; render(jobs); } }, [
      Dom.el('span', { class: 'upload-tray-title', text: jobs.length === 1 ? 'Uploading 1 video' : `Uploading ${jobs.length} videos` }),
      Dom.el('button', { type: 'button', class: 'upload-tray-toggle', 'aria-label': collapsed ? 'Expand' : 'Collapse', text: collapsed ? '▲' : '▼' }),
    ]);

    const children = [header];
    if (!collapsed) {
      const list = Dom.el('ul', { class: 'upload-tray-list' });
      for (const j of jobs) {
        list.appendChild(
          Dom.el('li', { class: 'upload-tray-item' }, [
            Dom.el('div', { class: 'upload-tray-item-head' }, [
              Dom.el('span', { class: 'upload-tray-filename', text: j.fileName }),
              Dom.el('span', { class: 'upload-tray-lesson', text: j.lessonTitle || 'Lesson video' }),
            ]),
            Dom.el('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(j.pct), 'aria-label': `Upload progress for ${j.fileName}` }, [
              Dom.el('span', { style: `width:${j.pct}%` }),
            ]),
            Dom.el('div', { class: 'upload-tray-item-foot' }, [
              Dom.el('span', { class: 'upload-tray-pct', text: `${j.pct}% · ${fmtBytes(j.sent)} / ${fmtBytes(j.total)}` }),
              Dom.el('button', {
                type: 'button',
                class: 'btn btn-outline btn-xs',
                text: 'Cancel',
                onclick: () => UploadManager.cancel(j.courseId, j.moduleId, j.lessonId, {
                  onCancelled: (id) => VideoApi.reportFailure(j.courseId, j.moduleId, j.lessonId, id, 'UPLOAD_CANCELLED'),
                }),
              }),
            ]),
          ])
        );
      }
      children.push(list);
    }
    root.replaceChildren(...children);
  }

  /** Mount the tray once per page. Safe to call multiple times (no-op after the first). */
  function mount() {
    if (root) return;
    root = Dom.el('div', { class: 'upload-tray', hidden: true, 'aria-live': 'polite' });
    document.body.appendChild(root);
    unsubscribe = UploadManager.subscribeTray(render);
  }

  function unmount() {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    if (root) { root.remove(); root = null; }
  }

  return { mount, unmount };
})();
