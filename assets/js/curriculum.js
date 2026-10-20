/**
 * Curriculum builder (Phase 7) — modules and lessons inside course-form.html.
 *
 * SCOPE (spec 31-39): create/edit/delete modules and lessons, reorder both
 * (drag-and-drop, backend-validated), empty states, loading states, delete
 * confirmations that reflect the backend's real behaviour.
 *
 * VIDEO (Phase 8): the lesson editor embeds VideoPanel (video-panel.js), which
 * owns everything about a lesson's video. This file only mounts it and
 * refreshes the tree when the video changes; it never talks to Bunny.
 *
 * BACKGROUND UPLOADS (Phase 8.2): the actual upload now lives in
 * UploadManager, outside any one VideoPanel/modal. Closing this lesson
 * editor — to edit another lesson, or to add a new one — no longer cancels
 * an in-flight video upload; it keeps running, shown in the floating upload
 * tray (upload-tray.js) that course-form.html mounts once for the whole
 * page. That's what makes uploading several lessons' videos "at once"
 * possible: each lesson editor only ever drives one video at a time, but the
 * uploads it starts keep going after you move on to the next lesson.
 *
 * BACKEND IS THE AUTHORITY ON ORDER (spec 34): dragging only decides the
 * NEW ARRAY ORDER shown to the user; the actual persisted order always
 * comes back from the reorder API response, which we re-render with. A
 * failed reorder request re-fetches the tree rather than trusting the
 * optimistic DOM order.
 *
 * NO POLLING (spec 69): the tree loads once on boot and again only after a
 * mutation this page itself performed.
 */

const Curriculum = (() => {
  let courseId = null;
  let container = null;
  let stateBox = null;
  let addButton = null;
  let booted = false;
  let tree = null; // last-loaded { course, modules: [{..., lessons:[...]}] }
  let expanded = new Set(); // module ids currently expanded
  let busy = false; // one curriculum mutation at a time

  function isBooted() {
    return booted;
  }

  // ---- Loading / empty state -------------------------------------------------
  function showState(title, text) {
    Dom.clear(stateBox);
    stateBox.appendChild(Dom.el('h3', { text: title }));
    if (text) stateBox.appendChild(Dom.el('p', { text }));
    stateBox.hidden = false;
    container.hidden = true;
  }
  function hideState() {
    stateBox.hidden = true;
    container.hidden = false;
  }

  function toast(message, kind = 'info') {
    // Small transient inline note above the module list — reuses the page's
    // alert element pattern but scoped to this section so it never fights
    // with the course-level page alert.
    let note = document.getElementById('curriculum-note-live');
    if (!note) {
      note = Dom.el('div', { id: 'curriculum-note-live', class: `alert alert-${kind}`, role: 'status' });
      container.parentElement.insertBefore(note, container);
    }
    note.className = `alert alert-${kind}`;
    note.textContent = message;
    note.hidden = false;
    if (kind !== 'error') {
      clearTimeout(toast._t);
      toast._t = setTimeout(() => { note.hidden = true; }, 3000);
    }
  }

  function errorMessage(err) {
    return Ui.messageForError(err);
  }

  // ---- Load / render ----------------------------------------------------------
  async function load() {
    showState('Loading curriculum…', 'Please wait.');
    try {
      tree = await CurriculumApi.getTree(courseId);
      hideState();
      render();
    } catch (err) {
      if (Auth.handleSessionError(err)) return;
      showState('Could not load the curriculum', errorMessage(err));
    }
  }

  function render() {
    Dom.clear(container);
    if (!tree.modules.length) {
      container.appendChild(
        Dom.el('div', { class: 'curriculum-empty' }, [
          Dom.el('p', { text: 'No modules yet.' }),
          Dom.el('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Create your first module', onclick: openCreateModule }),
        ])
      );
      return;
    }
    for (const mod of tree.modules) container.appendChild(renderModuleCard(mod));
  }

  function renderModuleCard(mod) {
    const isOpen = expanded.has(mod.id);
    const card = Dom.el('div', { class: `module-card${isOpen ? ' is-expanded' : ''}`, dataset: { moduleId: mod.id } });

    const head = Dom.el(
      'div',
      { class: 'module-head', onclick: (e) => { if (!e.target.closest('button')) toggleModule(mod.id); } },
      [
        Dom.el('span', { class: 'module-handle', title: 'Drag to reorder', draggable: 'true', 'aria-label': 'Reorder module' }, '⠿'),
        Dom.el('span', { class: 'module-order-badge', text: String(mod.order) }),
        Dom.el('div', { class: 'module-title-wrap' }, [
          Dom.el('span', { class: 'cell-title', text: mod.title }),
          Dom.el('span', { class: 'cell-sub', text: `${mod.lessons.length} lesson${mod.lessons.length === 1 ? '' : 's'}` }),
        ]),
        Ui.statusBadge(mod.status),
        Dom.el('div', { class: 'module-actions' }, [
          Dom.el('button', {
            type: 'button',
            class: 'btn btn-outline btn-xs',
            text: mod.status === 'PUBLISHED' ? 'Unpublish' : 'Publish',
            onclick: (e) => { e.stopPropagation(); toggleModuleStatus(mod); },
          }),
          Dom.el('button', { type: 'button', class: 'btn btn-outline btn-xs', text: 'Add lesson', onclick: () => openCreateLesson(mod) }),
          Dom.el('button', { type: 'button', class: 'btn btn-outline btn-xs', text: 'Edit', onclick: () => openEditModule(mod) }),
          Dom.el('button', { type: 'button', class: 'btn btn-danger btn-xs', text: 'Delete', onclick: () => confirmDeleteModule(mod) }),
        ]),
        Dom.el('span', { class: 'module-caret', 'aria-hidden': 'true', text: '›' }),
      ]
    );

    // Drag handle on the module row reorders modules (spec 34).
    const handle = head.querySelector('.module-handle');
    wireDrag(handle, card, {
      containerSelector: '#module-list',
      itemSelector: '.module-card',
      onDrop: (orderedIds) => reorderModules(orderedIds),
    });

    const body = Dom.el('div', { class: 'module-body' });
    const lessonList = Dom.el('div', { class: 'lesson-list' });
    if (!mod.lessons.length) {
      lessonList.appendChild(
        Dom.el('div', { class: 'curriculum-empty' }, [
          Dom.el('p', { text: 'No lessons yet.' }),
          Dom.el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'Add your first lesson', onclick: () => openCreateLesson(mod) }),
        ])
      );
    } else {
      for (const lesson of mod.lessons) lessonList.appendChild(renderLessonRow(mod, lesson));
    }
    body.appendChild(lessonList);
    card.appendChild(head);
    card.appendChild(body);
    return card;
  }

  function renderLessonRow(mod, lesson) {
    const row = Dom.el('div', { class: 'lesson-row', dataset: { lessonId: lesson.id, moduleId: mod.id } }, [
      Dom.el('span', { class: 'lesson-handle', title: 'Drag to reorder', draggable: 'true', 'aria-label': 'Reorder lesson' }, '⠿'),
      Dom.el('span', { class: 'lesson-order-badge', text: String(lesson.order) }),
      Dom.el('div', { class: 'lesson-title-wrap' }, [
        Dom.el('span', { class: 'cell-title', text: lesson.title }),
        Dom.el('div', { class: 'lesson-meta' }, [
          Dom.el('span', { class: 'pill pill-muted', text: lesson.type }),
          lesson.isFreePreview ? Dom.el('span', { class: 'pill', text: 'Free preview' }) : null,
          Ui.statusBadge(lesson.status),
        ]),
      ]),
      Dom.el('div', { class: 'lesson-actions' }, [
        Dom.el('button', {
          type: 'button',
          class: 'btn btn-outline btn-xs',
          text: lesson.status === 'PUBLISHED' ? 'Unpublish' : 'Publish',
          onclick: () => toggleLessonStatus(mod, lesson),
        }),
        Dom.el('button', { type: 'button', class: 'btn btn-outline btn-xs', text: 'Edit', onclick: () => openEditLesson(mod, lesson) }),
        Dom.el('button', { type: 'button', class: 'btn btn-danger btn-xs', text: 'Delete', onclick: () => confirmDeleteLesson(mod, lesson) }),
      ]),
    ]);

    const handle = row.querySelector('.lesson-handle');
    wireDrag(handle, row, {
      containerSelector: `.module-card[data-module-id="${cssEscape(mod.id)}"] .lesson-list`,
      itemSelector: '.lesson-row',
      onDrop: (orderedIds) => reorderLessons(mod.id, orderedIds),
    });

    return row;
  }

  function cssEscape(id) {
    return window.CSS && CSS.escape ? CSS.escape(id) : id.replace(/["\\]/g, '\\$&');
  }

  function toggleModule(id) {
    if (expanded.has(id)) expanded.delete(id);
    else expanded.add(id);
    render();
  }

  // ---- Drag-and-drop (spec 34): UI-only ordering; backend validates on drop ---
  function wireDrag(handleEl, itemEl, { containerSelector, itemSelector, onDrop }) {
    handleEl.addEventListener('dragstart', (e) => {
      itemEl.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', itemEl.dataset.moduleId || itemEl.dataset.lessonId || '');
    });
    handleEl.addEventListener('dragend', () => {
      itemEl.classList.remove('is-dragging');
      document.querySelectorAll('.drag-over').forEach((n) => n.classList.remove('drag-over'));
    });
    itemEl.addEventListener('dragover', (e) => {
      if (!document.querySelector('.is-dragging')) return;
      e.preventDefault();
      itemEl.classList.add('drag-over');
    });
    itemEl.addEventListener('dragleave', () => itemEl.classList.remove('drag-over'));
    itemEl.addEventListener('drop', (e) => {
      e.preventDefault();
      itemEl.classList.remove('drag-over');
      const dragging = document.querySelector('.is-dragging');
      if (!dragging || dragging === itemEl) return;
      const list = document.querySelector(containerSelector);
      if (!list || !list.contains(dragging) || !list.contains(itemEl)) return;

      const items = Array.from(list.querySelectorAll(itemSelector));
      const fromIndex = items.indexOf(dragging);
      const toIndex = items.indexOf(itemEl);
      if (fromIndex === -1 || toIndex === -1) return;

      if (fromIndex < toIndex) list.insertBefore(dragging, itemEl.nextSibling);
      else list.insertBefore(dragging, itemEl);

      const orderedIds = Array.from(list.querySelectorAll(itemSelector)).map((n) => n.dataset.moduleId || n.dataset.lessonId);
      onDrop(orderedIds);
    });
  }

  async function reorderModules(orderedIds) {
    if (busy) { await load(); return; } // another op in flight: resync instead of racing it
    busy = true;
    toast('Reordering…', 'info');
    try {
      await CurriculumApi.reorderModules(courseId, orderedIds);
      tree = await CurriculumApi.getTree(courseId);
      render();
      toast('Modules reordered.', 'success');
    } catch (err) {
      if (Auth.handleSessionError(err)) return;
      toast(errorMessage(err), 'error');
      await load(); // resync to the real backend order after a failed reorder
    } finally {
      busy = false;
    }
  }

  async function reorderLessons(moduleId, orderedIds) {
    if (busy) { await load(); return; }
    busy = true;
    toast('Reordering…', 'info');
    try {
      await CurriculumApi.reorderLessons(courseId, moduleId, orderedIds);
      tree = await CurriculumApi.getTree(courseId);
      render();
      toast('Lessons reordered.', 'success');
    } catch (err) {
      if (Auth.handleSessionError(err)) return;
      toast(errorMessage(err), 'error');
      await load();
    } finally {
      busy = false;
    }
  }

  // ---- Publish / Unpublish toggle ---------------------------------------------
  // A DRAFT module or lesson never appears on the student-facing learning
  // page regardless of the other one's status (studentLearning.service.js
  // requires BOTH the module and the lesson to be PUBLISHED) — so this is a
  // simple two-state flip, no separate "publish" endpoint needed.
  async function toggleModuleStatus(mod) {
    if (busy) { await load(); return; }
    busy = true;
    const nextStatus = mod.status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED';
    toast(nextStatus === 'PUBLISHED' ? 'Publishing…' : 'Unpublishing…', 'info');
    try {
      await CurriculumApi.updateModule(courseId, mod.id, { status: nextStatus });
      tree = await CurriculumApi.getTree(courseId);
      render();
      toast(nextStatus === 'PUBLISHED' ? 'Module published.' : 'Module unpublished.', 'success');
    } catch (err) {
      if (Auth.handleSessionError(err)) return;
      toast(errorMessage(err), 'error');
      await load();
    } finally {
      busy = false;
    }
  }

  async function toggleLessonStatus(mod, lesson) {
    if (busy) { await load(); return; }
    busy = true;
    const nextStatus = lesson.status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED';
    toast(nextStatus === 'PUBLISHED' ? 'Publishing…' : 'Unpublishing…', 'info');
    try {
      await CurriculumApi.updateLesson(courseId, mod.id, lesson.id, { status: nextStatus });
      tree = await CurriculumApi.getTree(courseId);
      render();
      toast(nextStatus === 'PUBLISHED' ? 'Lesson published.' : 'Lesson unpublished.', 'success');
    } catch (err) {
      if (Auth.handleSessionError(err)) return;
      toast(errorMessage(err), 'error');
      await load();
    } finally {
      busy = false;
    }
  }

  // ---- Delete (spec 20, 62) ---------------------------------------------------
  async function confirmDeleteModule(mod) {
    const count = mod.lessons.length;
    const message = count > 0
      ? `This module contains ${count} lesson${count === 1 ? '' : 's'}. Delete its lessons first — modules with lessons cannot be deleted.`
      : 'This cannot be undone.';
    const ok = await Ui.confirm({ title: 'Delete this module?', message, confirmLabel: 'Delete module', danger: true });
    if (!ok) return;
    busy = true;
    toast('Deleting module…', 'info');
    try {
      await CurriculumApi.deleteModule(courseId, mod.id);
      expanded.delete(mod.id);
      tree = await CurriculumApi.getTree(courseId);
      render();
      toast('Module deleted.', 'success');
    } catch (err) {
      if (Auth.handleSessionError(err)) return;
      toast(errorMessage(err), 'error');
    } finally {
      busy = false;
    }
  }

  async function confirmDeleteLesson(mod, lesson) {
    const ok = await Ui.confirm({ title: 'Delete this lesson?', message: 'This cannot be undone.', confirmLabel: 'Delete lesson', danger: true });
    if (!ok) return;
    busy = true;
    toast('Deleting lesson…', 'info');
    try {
      await CurriculumApi.deleteLesson(courseId, mod.id, lesson.id);
      tree = await CurriculumApi.getTree(courseId);
      render();
      toast('Lesson deleted.', 'success');
    } catch (err) {
      if (Auth.handleSessionError(err)) return;
      toast(errorMessage(err), 'error');
    } finally {
      busy = false;
    }
  }

  // ---- Module editor modal (create / edit) — spec 36, 38, 61 -----------------
  function openCreateModule() {
    openModuleEditor({ mode: 'create' });
  }
  function openEditModule(mod) {
    openModuleEditor({ mode: 'edit', module: mod });
  }

  function openModuleEditor({ mode, module }) {
    const isEdit = mode === 'edit';
    const titleInput = Dom.el('input', { class: 'input', type: 'text', maxlength: 120, value: isEdit ? module.title : '', 'aria-label': 'Module title' });
    const descInput = Dom.el('textarea', { class: 'input', maxlength: 1000, rows: 3, 'aria-label': 'Module description' });
    descInput.value = isEdit ? module.description || '' : '';
    const errorEl = Dom.el('p', { class: 'field-error', 'aria-live': 'polite' });

    const initialSnapshot = JSON.stringify([titleInput.value, descInput.value]);
    let saved = false;

    const saveBtn = Dom.el('button', { type: 'button', class: 'btn btn-primary btn-sm', text: isEdit ? 'Save changes' : 'Create module' });
    const cancelBtn = Dom.el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'Cancel' });

    const body = Dom.el('div', {}, [
      Dom.el('div', { class: 'field' }, [Dom.el('label', { text: 'Title' }), titleInput]),
      Dom.el('div', { class: 'field' }, [Dom.el('label', { text: 'Description' }), descInput]),
      errorEl,
    ]);

    const close = openEditorModal({
      title: isEdit ? 'Edit module' : 'New module',
      body,
      actions: [cancelBtn, saveBtn],
      isDirty: () => !saved && JSON.stringify([titleInput.value, descInput.value]) !== initialSnapshot,
    });

    cancelBtn.addEventListener('click', () => close());
    saveBtn.addEventListener('click', async () => {
      const title = titleInput.value.trim();
      if (title.length < 2) {
        errorEl.textContent = 'Title must be at least 2 characters.';
        titleInput.focus();
        return;
      }
      errorEl.textContent = '';
      saveBtn.disabled = true;
      saveBtn.textContent = isEdit ? 'Saving…' : 'Creating…';
      try {
        if (isEdit) {
          await CurriculumApi.updateModule(courseId, module.id, { title, description: descInput.value.trim() });
        } else {
          const nextOrder = tree.modules.length + 1;
          await CurriculumApi.createModule(courseId, { title, description: descInput.value.trim(), order: nextOrder });
        }
        saved = true;
        close();
        tree = await CurriculumApi.getTree(courseId);
        render();
        toast(isEdit ? 'Module updated.' : 'Module created.', 'success');
      } catch (err) {
        if (Auth.handleSessionError(err)) return;
        errorEl.textContent = errorMessage(err);
        saveBtn.disabled = false;
        saveBtn.textContent = isEdit ? 'Save changes' : 'Create module';
      }
    });
  }

  // ---- Lesson editor modal (create / edit) — spec 37, 39, 61 -----------------
  function openCreateLesson(mod) {
    openLessonEditor({ mode: 'create', module: mod });
  }
  function openEditLesson(mod, lesson) {
    openLessonEditor({ mode: 'edit', module: mod, lesson });
  }

  const LESSON_TYPES = ['VIDEO', 'TEXT'];

  function openLessonEditor({ mode, module, lesson }) {
    const isEdit = mode === 'edit';
    const titleInput = Dom.el('input', { class: 'input', type: 'text', maxlength: 150, value: isEdit ? lesson.title : '', 'aria-label': 'Lesson title' });
    const descInput = Dom.el('textarea', { class: 'input', maxlength: 2000, rows: 3, 'aria-label': 'Lesson description' });
    descInput.value = isEdit ? lesson.description || '' : '';

    const typeSelect = Dom.el(
      'select',
      { class: 'input', 'aria-label': 'Lesson type' },
      LESSON_TYPES.map((t) => Dom.el('option', { value: t, text: t }))
    );
    typeSelect.value = isEdit ? lesson.type : 'VIDEO';

    const durationInput = Dom.el('input', {
      class: 'input',
      type: 'text',
      inputmode: 'numeric',
      placeholder: '0',
      value: isEdit ? String(lesson.durationSeconds || 0) : '0',
      'aria-label': 'Duration in seconds',
    });

    const previewCheckbox = Dom.el('input', { type: 'checkbox', id: 'lesson-free-preview' });
    previewCheckbox.checked = isEdit ? Boolean(lesson.isFreePreview) : false;

    const errorEl = Dom.el('p', { class: 'field-error', 'aria-live': 'polite' });

    // Phase 8: a video can only be attached to a lesson that already exists
    // (the backend needs the lesson to authorise and title the upload).
    let videoPanel = null;
    let videoDirty = false;
    let videoNode;
    if (isEdit && lesson.type === 'VIDEO') {
      videoPanel = VideoPanel.create({
        courseId,
        moduleId: module.id,
        lessonId: lesson.id,
        lessonTitle: lesson.title,
        onChange: () => { videoDirty = true; },
      });
      videoNode = videoPanel.element;
    } else if (isEdit) {
      videoNode = Dom.el('p', { class: 'hint', text: 'Only video lessons can have a video. Change the type to VIDEO and save to add one.' });
    } else {
      videoNode = Dom.el('p', { class: 'hint', text: 'Save the lesson first, then edit it to upload a video.' });
    }

    const initialSnapshot = JSON.stringify([titleInput.value, descInput.value, typeSelect.value, durationInput.value, previewCheckbox.checked]);
    let saved = false;

    const saveBtn = Dom.el('button', { type: 'button', class: 'btn btn-primary btn-sm', text: isEdit ? 'Save changes' : 'Create lesson' });
    const cancelBtn = Dom.el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'Cancel' });

    const bodyChildren = [
      Dom.el('div', { class: 'field' }, [Dom.el('label', { text: 'Title' }), titleInput]),
      Dom.el('div', { class: 'field' }, [Dom.el('label', { text: 'Description' }), descInput]),
      Dom.el('div', { class: 'form-row' }, [
        Dom.el('div', { class: 'field' }, [Dom.el('label', { text: 'Type' }), typeSelect]),
        Dom.el('div', { class: 'field' }, [Dom.el('label', { text: 'Duration (seconds)' }), durationInput]),
      ]),
    ];
    if (isEdit) {
      bodyChildren.push(
        Dom.el('div', { class: 'field checkbox-field' }, [previewCheckbox, Dom.el('label', { for: 'lesson-free-preview', text: 'Free preview lesson' })])
      );
    }
    bodyChildren.push(videoNode, errorEl);

    const body = Dom.el('div', {}, bodyChildren);

    const close = openEditorModal({
      title: isEdit ? 'Edit lesson' : 'New lesson',
      body,
      actions: [cancelBtn, saveBtn],
      isDirty: () =>
        !saved &&
        JSON.stringify([titleInput.value, descInput.value, typeSelect.value, durationInput.value, previewCheckbox.checked]) !== initialSnapshot,
      // Phase 8.2: uploads run in the background now (UploadManager), so
      // closing this editor no longer cancels them — nothing to confirm here.
      canClose: async () => true,
      onClosed: async () => {
        if (videoPanel) videoPanel.destroy();
        // Video changes happen outside "Save changes": reflect them in the tree.
        if (videoDirty) { try { tree = await CurriculumApi.getTree(courseId); render(); } catch (e) { /* tree reloads on next action */ } }
      },
    });

    cancelBtn.addEventListener('click', () => close.attempt());
    saveBtn.addEventListener('click', async () => {
      const title = titleInput.value.trim();
      if (title.length < 2) {
        errorEl.textContent = 'Title must be at least 2 characters.';
        titleInput.focus();
        return;
      }
      const durRaw = durationInput.value.trim();
      const duration = durRaw === '' ? 0 : /^\d{1,7}$/.test(durRaw) ? Number(durRaw) : null;
      if (duration === null) {
        errorEl.textContent = 'Duration must be a whole number of seconds.';
        durationInput.focus();
        return;
      }
      errorEl.textContent = '';
      saveBtn.disabled = true;
      saveBtn.textContent = isEdit ? 'Saving…' : 'Creating…';
      try {
        if (isEdit) {
          await CurriculumApi.updateLesson(courseId, module.id, lesson.id, {
            title,
            description: descInput.value.trim(),
            type: typeSelect.value,
            durationSeconds: duration,
            isFreePreview: previewCheckbox.checked,
          });
        } else {
          const nextOrder = module.lessons.length + 1;
          await CurriculumApi.createLesson(courseId, module.id, {
            title,
            description: descInput.value.trim(),
            order: nextOrder,
            type: typeSelect.value,
            durationSeconds: duration,
          });
          expanded.add(module.id);
        }
        saved = true;
        close();
        tree = await CurriculumApi.getTree(courseId);
        render();
        toast(isEdit ? 'Lesson updated.' : 'Lesson created.', 'success');
      } catch (err) {
        if (Auth.handleSessionError(err)) return;
        errorEl.textContent = errorMessage(err);
        saveBtn.disabled = false;
        saveBtn.textContent = isEdit ? 'Save changes' : 'Create lesson';
      }
    });
  }

  // ---- Shared modal shell with unsaved-changes protection (spec 61) ---------
  function openEditorModal({ title, body, actions, isDirty, canClose, onClosed }) {
    const previouslyFocused = document.activeElement;
    const titleId = `editor-title-${Date.now()}`;
    const modal = Dom.el('div', { class: 'modal editor-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId }, [
      Dom.el('h3', { id: titleId, text: title }),
      body,
      Dom.el('div', { class: 'modal-actions' }, actions),
    ]);
    const backdrop = Dom.el('div', { class: 'modal-backdrop' }, [modal]);

    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
      if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
      if (onClosed) onClosed();
    }

    async function attemptClose() {
      if (canClose && !(await canClose())) return;
      if (isDirty && isDirty()) {
        const leave = await Ui.confirm({
          title: 'Discard unsaved changes?',
          message: 'You have changes that have not been saved.',
          confirmLabel: 'Discard',
          danger: true,
        });
        if (!leave) return;
      }
      close();
    }

    function onKey(e) {
      if (e.key === 'Escape') attemptClose();
    }
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) attemptClose(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(backdrop);
    const firstInput = modal.querySelector('input, textarea, select');
    if (firstInput) firstInput.focus();

    // Returned to the caller as "close()". A save flow calls this directly
    // (no dirty check needed — it just saved). `close.attempt` is the GUARDED
    // path (unsaved-changes + running-upload confirmations): Cancel, Escape
    // and the backdrop all use it so nothing is silently discarded.
    close.attempt = attemptClose;
    return close;
  }

  // ---- Boot -------------------------------------------------------------------
  function init(opts) {
    if (booted) return;
    courseId = opts.courseId;
    container = opts.container;
    stateBox = opts.stateBox;
    addButton = opts.addButton;
    booted = true;
    addButton.addEventListener('click', openCreateModule);
    load();
  }

  return { init, isBooted };
})();
