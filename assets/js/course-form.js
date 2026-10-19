/**
 * Course create / edit form controller (Phase 6).
 *
 * MODES  no ?id  -> create (POST, always a private DRAFT)
 *        ?id=... -> edit   (PATCH; status changes go through action buttons)
 *
 * WHAT THE FORM NEVER SENDS: status, visibility, publishedAt, createdAt,
 * updatedAt, _id. The payload builder below lists the writable fields
 * explicitly. (The backend would reject them anyway — its schemas are
 * strict — but the client should not even try.)
 *
 * VALIDATION here is convenience only; the backend is authoritative and its
 * field-level errors (422) are mapped back onto the same inputs.
 *
 * CONCURRENCY: edit sends the `updatedAt` it loaded as `expectedUpdatedAt`.
 * If someone else saved in between, the backend answers 409 and this page
 * tells the admin to reload instead of silently overwriting their work.
 *
 * UNSAVED CHANGES: a snapshot of the payload is compared on beforeunload
 * and on in-page navigation, so leaving with edits asks first.
 */

(async function initCourseForm() {
  const admin = await Auth.requireAuth();
  document.documentElement.classList.remove('auth-pending');
  document.getElementById('admin-identity').textContent = admin.name;

  const $ = (id) => document.getElementById(id);
  const form = $('course-form');
  const alertEl = $('page-alert');
  const saveBtn = $('save-btn');

  const courseId = new URLSearchParams(window.location.search).get('id');
  const isEdit = Boolean(courseId);

  // Defensive check: if the admin just clicked "Edit" on a specific course
  // (recorded by courses-list.js right before navigating) but this page
  // loaded with no ?id at all, something between the click and this page
  // dropped the query string (e.g. a static-file server rewriting the URL).
  // Surface that clearly instead of silently showing a blank "New course"
  // form, which looks like data loss.
  let lastEditIntent = null;
  try { lastEditIntent = sessionStorage.getItem('nightclub:lastEditIntent'); } catch (e) { /* storage unavailable — non-fatal */ }
  if (!isEdit && lastEditIntent) {
    try { sessionStorage.removeItem('nightclub:lastEditIntent'); } catch (e) { /* non-fatal */ }
  }

  let course = null; // the course as last loaded/saved (edit mode)
  let busy = false; // ONE in-flight request at a time (no duplicate submits)
  let snapshot = '';

  $('logout-btn').addEventListener('click', async () => {
    $('logout-btn').disabled = true;
    await Auth.logout();
    window.location.replace(Auth.urlFor(Auth.PATHS.login));
  });

  // ---- Repeatable text lists (outcomes / requirements / audience) ----------
  function createListEditor(host, { max = 20, placeholder }) {
    const rows = Dom.el('div', { class: 'list-editor' });
    const addBtn = Dom.el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'Add item' });
    host.appendChild(rows);
    host.appendChild(Dom.el('div', { style: 'margin-top: var(--space-2)' }, [addBtn]));

    function addRow(value = '') {
      if (rows.children.length >= max) return;
      const input = Dom.el('input', { class: 'input', type: 'text', maxlength: 200, placeholder, value });
      input.value = value;
      const remove = Dom.el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'Remove', 'aria-label': 'Remove this item' });
      const row = Dom.el('div', { class: 'list-row' }, [input, remove]);
      remove.addEventListener('click', () => { row.remove(); addBtn.disabled = false; });
      rows.appendChild(row);
      if (rows.children.length >= max) addBtn.disabled = true;
      return input;
    }
    addBtn.addEventListener('click', () => addRow('').focus());

    return {
      set(values) { Dom.clear(rows); addBtn.disabled = false; (values || []).forEach((v) => addRow(v)); },
      get() { return Array.from(rows.querySelectorAll('input')).map((i) => i.value.trim()).filter(Boolean); },
    };
  }

  const lists = {
    learningOutcomes: createListEditor($('list-learningOutcomes'), { placeholder: 'What will students be able to do?' }),
    requirements: createListEditor($('list-requirements'), { placeholder: 'What should students already have or know?' }),
    targetAudience: createListEditor($('list-targetAudience'), { placeholder: 'Who is this course for?' }),
  };

  // ---- Tag input -----------------------------------------------------------
  const tagBox = $('tag-box');
  const tagInput = $('tag-input');
  let tags = [];
  const normTag = (t) => t.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  function renderTags() {
    tagBox.querySelectorAll('.tag').forEach((n) => n.remove());
    for (const t of tags) {
      const x = Dom.el('button', { type: 'button', 'aria-label': `Remove tag ${t}`, text: '×' });
      x.addEventListener('click', () => { tags = tags.filter((v) => v !== t); renderTags(); });
      tagBox.insertBefore(Dom.el('span', { class: 'tag' }, [t, x]), tagInput);
    }
  }
  function addTag(raw) {
    const t = normTag(raw);
    if (!t || tags.includes(t) || tags.length >= 15) return;
    tags.push(t);
    renderTags();
  }
  tagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagInput.value); tagInput.value = ''; }
    else if (e.key === 'Backspace' && !tagInput.value && tags.length) { tags.pop(); renderTags(); }
  });
  tagInput.addEventListener('blur', () => { if (tagInput.value.trim()) { addTag(tagInput.value); tagInput.value = ''; } });

  // ---- Character counters --------------------------------------------------
  for (const id of ['shortDescription', 'description']) {
    const counter = $(`${id}-count`);
    const update = () => { counter.textContent = `${$(id).value.length} / ${$(id).maxLength}`; };
    $(id).addEventListener('input', update);
    update();
  }

  // ---- Field errors --------------------------------------------------------
  const FIELD_INPUT = {
    title: 'title', slug: 'slug', thumbnail: 'thumbnail', shortDescription: 'shortDescription', description: 'description',
    category: 'category', instructor: 'instructor', 'pricing.basePrice': 'basePrice', 'pricing.salePrice': 'salePrice',
    'pricing.currency': 'currency', 'metadata.durationMinutes': 'durationMinutes',
  };
  const LIST_FIELDS = ['learningOutcomes', 'requirements', 'targetAudience', 'tags'];

  function setError(key, message) {
    const p = $(`${key}-error`);
    if (!p) return false;
    p.textContent = message;
    const input = $(key);
    if (input) { input.closest('.field').classList.add('has-error'); input.setAttribute('aria-invalid', 'true'); }
    else p.closest('.field').classList.add('has-error');
    return true;
  }
  function clearErrors() {
    form.querySelectorAll('.field-error').forEach((p) => { p.textContent = ''; });
    form.querySelectorAll('.has-error').forEach((f) => f.classList.remove('has-error'));
    form.querySelectorAll('[aria-invalid]').forEach((i) => i.removeAttribute('aria-invalid'));
  }
  function focusFirstError() {
    const first = form.querySelector('.has-error .input, .has-error input, .has-error select, .has-error textarea');
    if (first) first.focus();
  }

  /** Maps backend { field, message } pairs onto inputs; returns any it could not place. */
  function applyServerErrors(errors) {
    const unplaced = [];
    for (const e of errors || []) {
      const field = String(e.field || '');
      const key = FIELD_INPUT[field] || (field.startsWith('metadata.') && LIST_FIELDS.includes(field.split('.')[1]) ? field.split('.')[1] : null) || (field === 'pricing' ? 'salePrice' : null);
      if (!key || !setError(key, e.message)) unplaced.push(e.message);
    }
    focusFirstError();
    return unplaced;
  }

  // ---- Payload (explicit allow-list; money via string math) -----------------
  function buildPayload() {
    const errors = {};
    const base = Dom.rupeesToPaise($('basePrice').value.trim() === '' ? '0' : $('basePrice').value);
    const sale = Dom.rupeesToPaise($('salePrice').value.trim() === '' ? '0' : $('salePrice').value);
    if (base === null) errors.basePrice = 'Enter a valid amount, e.g. 4999 or 4999.50.';
    if (sale === null) errors.salePrice = 'Enter a valid amount, e.g. 3999 or 3999.50.';
    if (base !== null && sale !== null && sale > base) errors.salePrice = 'The sale price cannot be higher than the base price.';

    const durRaw = $('durationMinutes').value.trim();
    const duration = durRaw === '' ? 0 : /^\d{1,7}$/.test(durRaw) ? Number(durRaw) : null;
    if (duration === null) errors.durationMinutes = 'Enter a whole number of minutes.';

    const title = $('title').value.trim();
    if (title.length < 3) errors.title = 'The title must be at least 3 characters.';
    if (!$('category').value) errors.category = 'Please select a category.';
    if (!$('instructor').value) errors.instructor = 'Please select an instructor.';

    if (Object.keys(errors).length) return { errors };

    const payload = {
      title,
      shortDescription: $('shortDescription').value,
      description: $('description').value,
      thumbnail: $('thumbnail').value.trim(),
      category: $('category').value,
      instructor: $('instructor').value,
      pricing: { basePrice: base, salePrice: sale, currency: $('currency').value },
      metadata: {
        level: $('level').value,
        language: $('language').value,
        durationMinutes: duration,
        learningOutcomes: lists.learningOutcomes.get(),
        requirements: lists.requirements.get(),
        targetAudience: lists.targetAudience.get(),
        tags: tags.slice(),
      },
    };
    // Slug: blank => omit on create (server generates); on edit blank means "keep".
    const slug = $('slug').value.trim();
    if (slug) payload.slug = slug;
    return { payload };
  }

  const snapshotOf = () => JSON.stringify([
    $('title').value, $('slug').value, $('thumbnail').value, $('shortDescription').value, $('description').value,
    $('category').value, $('instructor').value, $('basePrice').value, $('salePrice').value, $('currency').value,
    $('level').value, $('language').value, $('durationMinutes').value,
    lists.learningOutcomes.get(), lists.requirements.get(), lists.targetAudience.get(), tags,
  ]);
  const isDirty = () => snapshot !== '' && snapshot !== snapshotOf();

  // Leaving with unsaved edits (tab close / reload / external nav).
  window.addEventListener('beforeunload', (e) => { if (isDirty() && !busy) { e.preventDefault(); e.returnValue = ''; } });
  // In-page links (Back / Cancel / sidebar): ask first.
  document.addEventListener('click', async (e) => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || !isDirty()) return;
    e.preventDefault();
    const leave = await Ui.confirm({ title: 'Discard unsaved changes?', message: 'You have changes that have not been saved. If you leave now they will be lost.', confirmLabel: 'Discard changes', danger: true });
    if (leave) { snapshot = ''; window.location.href = a.href; }
  });

  // ---- Populate ------------------------------------------------------------
  function fillForm(c) {
    $('title').value = c.title;
    $('slug').value = c.slug;
    $('thumbnail').value = c.thumbnail || '';
    $('shortDescription').value = c.shortDescription || '';
    $('description').value = c.description || '';
    $('category').value = c.category ? c.category.id : '';
    $('instructor').value = c.instructor ? c.instructor.id : '';
    $('basePrice').value = c.pricing ? Dom.paiseToRupees(c.pricing.basePrice) : '';
    $('salePrice').value = c.pricing ? Dom.paiseToRupees(c.pricing.salePrice) : '';
    $('currency').value = (c.pricing && c.pricing.currency) || 'INR';
    const m = c.metadata || {};
    $('level').value = m.level || 'ALL_LEVELS';
    $('language').value = m.language || 'en';
    $('durationMinutes').value = m.durationMinutes ? String(m.durationMinutes) : '';
    lists.learningOutcomes.set(m.learningOutcomes);
    lists.requirements.set(m.requirements);
    lists.targetAudience.set(m.targetAudience);
    tags = (m.tags || []).slice();
    renderTags();
    for (const id of ['shortDescription', 'description']) $(id).dispatchEvent(new Event('input'));
    renderThumbnailPreview($('thumbnail').value);
  }

  // ---- Thumbnail upload (reuses the existing Bunny Storage Zone upload
  // architecture — see courses-api.js#uploadThumbnail). Writes the returned
  // CDN URL straight into the existing #thumbnail input, so buildPayload(),
  // fillForm() and snapshotOf() above need no changes: the upload is just
  // another way of filling in that one field. The admin may still type or
  // paste a reference URL instead; either way only the #thumbnail value is
  // ever saved. ---------------------------------------------------------
  const thumbPreviewEl = $('thumbnail-upload-preview');
  const thumbInputEl = $('thumbnail-upload-input');
  const thumbStatusEl = $('thumbnail-upload-status');
  const thumbLabelEl = thumbInputEl ? thumbInputEl.closest('.thumbnail-upload-label') || document.querySelector('label[for="thumbnail-upload-input"]') : null;

  function setThumbStatus(msg, kind) {
    if (!thumbStatusEl) return;
    thumbStatusEl.textContent = msg || '';
    thumbStatusEl.className = 'thumbnail-upload-status' + (kind ? ` is-${kind}` : '');
  }

  function renderThumbnailPreview(value) {
    if (!thumbPreviewEl) return;
    thumbPreviewEl.innerHTML = '';
    const isHttpsUrl = typeof value === 'string' && /^https:\/\//i.test(value);
    if (isHttpsUrl) {
      const img = Dom.el('img', { alt: 'Course thumbnail preview' });
      img.loading = 'lazy';
      img.decoding = 'async';
      img.onerror = () => { thumbPreviewEl.classList.add('is-empty'); thumbPreviewEl.innerHTML = ''; };
      img.src = value;
      thumbPreviewEl.appendChild(img);
      thumbPreviewEl.classList.remove('is-empty');
    } else {
      thumbPreviewEl.classList.add('is-empty');
    }
  }
  // A storage-key (non-URL) reference can't be rendered as an <img src> here
  // without knowing the CDN base, so only https URLs get a live preview —
  // the reference itself is unaffected and still saves normally.

  // Live preview + dirty-tracking when the admin types/pastes a URL by hand.
  $('thumbnail').addEventListener('input', () => renderThumbnailPreview($('thumbnail').value));

  if (thumbInputEl) {
    thumbInputEl.addEventListener('change', async () => {
      const file = thumbInputEl.files && thumbInputEl.files[0];
      thumbInputEl.value = ''; // allow re-selecting the same file name later
      if (!file) return;

      setThumbStatus('');
      thumbInputEl.disabled = true;
      if (thumbLabelEl) thumbLabelEl.setAttribute('aria-disabled', 'true');
      saveBtn.disabled = true; // keep the course from being saved mid-upload

      const previousUrl = $('thumbnail').value.trim();
      setThumbStatus('Uploading thumbnail…');
      try {
        const result = await CoursesApi.uploadThumbnail(file, previousUrl);
        $('thumbnail').value = result.cdnUrl;
        renderThumbnailPreview(result.cdnUrl);
        // Clear any stale "thumbnail" field error directly (not via setError,
        // which always re-applies the has-error class).
        const thumbErrEl = $('thumbnail-error');
        if (thumbErrEl) thumbErrEl.textContent = '';
        $('thumbnail').closest('.field').classList.remove('has-error');
        $('thumbnail').removeAttribute('aria-invalid');
        setThumbStatus('Uploaded successfully.', 'success');
        setTimeout(() => setThumbStatus(''), 3000);
      } catch (err) {
        if (Auth.handleSessionError(err)) return;
        // Previous thumbnail value is left untouched on failure.
        setThumbStatus(`Upload failed: ${(err && err.message) || 'Unknown error.'}`, 'error');
      } finally {
        thumbInputEl.disabled = false;
        if (thumbLabelEl) thumbLabelEl.removeAttribute('aria-disabled');
        saveBtn.disabled = false;
      }
    });
  }

  /**
   * Fills a select from the server's ACTIVE-only option list, then makes sure
   * the record the course ALREADY points at is present (Phase 8.1).
   *
   * The option endpoints no longer return inactive categories/instructors —
   * an inactive one must not be newly assignable — so a course whose category
   * was deactivated later would otherwise open with a blank select and could
   * not be saved without re-picking. The current reference comes from the
   * course itself (the course DTO carries {id, name, status}); it is shown
   * labelled "(inactive)" so the admin sees why, and nothing else inactive is
   * ever offered.
   */
  function fillSelect(select, activeItems, current) {
    for (const it of activeItems) {
      select.appendChild(Dom.el('option', { value: it.id, text: it.name }));
    }
    if (current && current.id && !activeItems.some((it) => it.id === current.id)) {
      const inactive = current.status && current.status !== 'ACTIVE';
      select.insertBefore(
        Dom.el('option', { value: current.id, text: inactive ? `${current.name} (inactive)` : current.name }),
        select.firstChild
      );
    }
  }

  function renderPublishing(c) {
    $('publishing-section').hidden = false;
    $('curriculum-section').hidden = false;
    Dom.clear($('pub-status')); $('pub-status').appendChild(Ui.statusBadge(c.status));
    Dom.clear($('pub-visibility')); $('pub-visibility').appendChild(Ui.visibilityBadge(c.visibility));
    $('pub-date').textContent = c.publishedAt ? `Published ${Dom.formatDate(c.publishedAt)}` : 'Not published';

    const box = $('pub-actions');
    Dom.clear(box);
    const btn = (label, fn, danger) => box.appendChild(Dom.el('button', { type: 'button', class: `btn btn-sm ${danger ? 'btn-danger' : 'btn-outline'}`, text: label, onclick: fn }));

    if (c.status === 'DRAFT') btn('Publish', () => statusAction('publish'));
    if (c.status === 'PUBLISHED') {
      btn('Unpublish', () => statusAction('unpublish'));
      btn(c.visibility === 'PUBLIC' ? 'Make private' : 'Make public', () => visibilityAction(c.visibility === 'PUBLIC' ? 'PRIVATE' : 'PUBLIC'));
    }
    if (c.status === 'ARCHIVED') btn('Restore to draft', () => statusAction('restore'));
    if (c.status !== 'ARCHIVED') btn('Archive', () => statusAction('archive'), true);

    // Curriculum builder boots once, the first time we have a course id.
    if (typeof Curriculum !== 'undefined' && !Curriculum.isBooted()) {
      Curriculum.init({ courseId: c.id, container: $('module-list'), stateBox: $('curriculum-state'), addButton: $('add-module-btn') });
    }
  }

  function adoptCourse(c) {
    course = c;
    $('page-title').textContent = c.title;
    document.title = `${c.title} — The Knight Club Super Admin`;
    fillForm(c);
    renderPublishing(c);
    snapshot = snapshotOf();
  }

  function fail(err) {
    if (Auth.handleSessionError(err)) return true;
    const unplaced = err instanceof ApiError && err.status === 422 ? applyServerErrors(err.errors) : [];
    const detail = unplaced.length ? ` ${unplaced.join(' ')}` : '';
    Forms.showAlert(alertEl, `${Ui.messageForError(err)}${detail}`, 'error');
    alertEl.focus();
    return false;
  }

  // ---- Status / visibility actions (edit mode) ------------------------------
  const STATUS_SPECS = {
    publish: { call: CoursesApi.publish, pending: 'Publishing…', done: 'Course published. It is still private until you make it public.', title: 'Publish this course?', message: 'The course becomes Published. It stays private until you set its visibility to Public.', label: 'Publish' },
    unpublish: { call: CoursesApi.unpublish, pending: 'Unpublishing…', done: 'Course moved back to draft.', title: 'Unpublish this course?', message: 'The course returns to Draft and its publication date is cleared.', label: 'Unpublish' },
    archive: { call: CoursesApi.archive, pending: 'Archiving…', done: 'Course archived.', title: 'Archive this course?', message: 'The course is archived and made Private, so it is no longer in the active or public state. Nothing is deleted and you can restore it later.', label: 'Archive', danger: true },
    restore: { call: CoursesApi.restore, pending: 'Restoring…', done: 'Course restored to draft.', title: 'Restore this course?', message: 'The course returns to Draft (private) so it can be edited and re-published.', label: 'Restore' },
  };

  async function statusAction(name) {
    if (busy) return;
    if (isDirty()) {
      Forms.showAlert(alertEl, 'Save or discard your edits before changing the course status.', 'error');
      return;
    }
    const spec = STATUS_SPECS[name];
    if (!(await Ui.confirm({ title: spec.title, message: spec.message, confirmLabel: spec.label, danger: Boolean(spec.danger) }))) return;
    await runRequest(spec.pending, async () => {
      const data = await spec.call(course.id);
      adoptCourse(data.course);
      Forms.showAlert(alertEl, spec.done, 'success');
    });
  }

  async function visibilityAction(target) {
    if (busy) return;
    if (isDirty()) {
      Forms.showAlert(alertEl, 'Save or discard your edits before changing visibility.', 'error');
      return;
    }
    const goingPublic = target === 'PUBLIC';
    const ok = await Ui.confirm({
      title: goingPublic ? 'Make this course public?' : 'Make this course private?',
      message: goingPublic ? 'It will be listed publicly once the public catalog exists.' : 'It will no longer be publicly listed.',
      confirmLabel: goingPublic ? 'Make public' : 'Make private',
    });
    if (!ok) return;
    await runRequest('Updating visibility…', async () => {
      const data = await CoursesApi.setVisibility(course.id, target);
      adoptCourse(data.course);
      Forms.showAlert(alertEl, goingPublic ? 'Course is now public.' : 'Course is now private.', 'success');
    });
  }

  /** Runs one request with the busy guard, info banner and shared error handling. */
  async function runRequest(pendingText, fn) {
    busy = true;
    clearErrors();
    Forms.showAlert(alertEl, pendingText, 'info');
    try {
      await fn();
    } catch (err) {
      fail(err);
    } finally {
      busy = false;
    }
  }

  // ---- Submit ---------------------------------------------------------------
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || saveBtn.disabled) return; // no duplicate creates / saves

    Forms.hideAlert(alertEl);
    clearErrors();

    const built = buildPayload();
    if (built.errors) {
      for (const [k, msg] of Object.entries(built.errors)) setError(k, msg);
      focusFirstError();
      return;
    }

    busy = true;
    Forms.setLoading(saveBtn, true, isEdit ? 'Saving changes…' : 'Creating course…');
    try {
      if (isEdit) {
        const body = { ...built.payload, expectedUpdatedAt: course.updatedAt };
        const data = await CoursesApi.update(courseId, body);
        adoptCourse(data.course);
        Forms.showAlert(alertEl, 'Changes saved.', 'success');
      } else {
        const data = await CoursesApi.create(built.payload);
        snapshot = ''; // saved: do not warn about leaving
        window.location.replace(`course-form.html?id=${encodeURIComponent(data.course.id)}&created=1`);
        return; // navigating away; leave the button in its loading state
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && /changed by someone else/i.test(err.message)) {
        Forms.showAlert(alertEl, 'This course was changed elsewhere after you opened it. Reload the page to see the latest version, then re-apply your edits.', 'error');
        alertEl.focus();
      } else if (err instanceof ApiError && err.status === 409) {
        setError('slug', 'A course with this slug already exists. Choose a different one.');
        Forms.showAlert(alertEl, Ui.messageForError(err), 'error');
        focusFirstError();
      } else {
        fail(err);
      }
    } finally {
      busy = false;
      Forms.setLoading(saveBtn, false);
    }
  });

  // ---- Boot -----------------------------------------------------------------
  const loadState = $('load-state');
  function showLoad(title, text) {
    Dom.clear(loadState);
    loadState.appendChild(Dom.el('h3', { text: title }));
    loadState.appendChild(Dom.el('p', { text }));
    loadState.hidden = false;
  }

  showLoad('Loading…', 'Please wait.');
  try {
    const [cats, inst, loaded] = await Promise.all([
      CoursesApi.categories(),
      CoursesApi.instructors(),
      isEdit ? CoursesApi.get(courseId) : Promise.resolve(null),
    ]);

    fillSelect($('category'), cats.items, loaded && loaded.course.category);
    fillSelect($('instructor'), inst.items, loaded && loaded.course.instructor);

    // The option lists are ACTIVE-only (server-enforced), so "any items" is
    // exactly "something can be newly assigned".
    const hasCat = cats.items.length > 0;
    const hasInst = inst.items.length > 0;
    if (!isEdit && (!hasCat || !hasInst)) {
      const missing = [!hasCat && 'categories', !hasInst && 'instructors'].filter(Boolean).join(' and ');
      showLoad(`No active ${missing} available`, `A course needs an active category and an active instructor. Add or activate ${missing} first, then come back.`);
    } else {
      loadState.hidden = true;
      form.hidden = false;
      if (isEdit) {
        adoptCourse(loaded.course);
        $('save-btn').querySelector('.label').textContent = 'Save changes';
        if (new URLSearchParams(window.location.search).get('created') === '1') {
          Forms.showAlert(alertEl, 'Course created as a private draft.', 'success');
        }
      } else {
        // Sensible free-course defaults; the admin fills in the rest.
        $('basePrice').value = '0'; $('salePrice').value = '0';
        lists.learningOutcomes.set([]); lists.requirements.set([]); lists.targetAudience.set([]);
        snapshot = snapshotOf();
        if (lastEditIntent) {
          Forms.showAlert(
            alertEl,
            'Opened a blank "New course" form instead of editing — the course id was lost on the way here (likely the local server rewriting the URL). Go back to Courses and click Edit again; if this keeps happening, the static server needs the fix described in serve-static.js.',
            'error'
          );
          alertEl.focus();
        }
      }
    }
  } catch (err) {
    if (Auth.handleSessionError(err)) return;
    const notFound = err instanceof ApiError && (err.status === 404 || err.status === 400);
    showLoad(notFound ? 'Course not found' : 'Could not load this page', notFound ? 'This course does not exist or was removed.' : Ui.messageForError(err));
  }
})();