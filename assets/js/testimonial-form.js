/**
 * Testimonial create / edit form controller (Phase 7).
 *
 * MODES  no ?id  -> create (POST, always starts DRAFT — server-controlled)
 *        ?id=... -> edit   (PATCH content fields; status changes go through
 *                   the dedicated publish/archive/republish actions below,
 *                   never through this PATCH body)
 *
 * WHAT THE FORM NEVER SENDS: status, publishedAt, archivedAt, createdBy,
 * updatedBy, _id. The payload builder below lists only the fields the
 * backend's CREATE_FIELDS/UPDATE_FIELDS actually accept (see
 * backend/src/services/testimonial.service.js).
 *
 * TYPE CHANGE (edit mode only): changing the type selector on an EXISTING
 * record calls the dedicated POST /:id/change-type endpoint instead of
 * folding `type` into a general PATCH, per the backend's own type-change
 * safety rules. On CREATE, the type is simply part of the create payload
 * (no prior type to transition away from).
 *
 * VALIDATION here is convenience only; the backend is authoritative and its
 * field-level errors (422) are mapped back onto the same inputs.
 */

(async function initTestimonialForm() {
  const admin = await Auth.requireAuth();
  document.documentElement.classList.remove('auth-pending');
  document.getElementById('admin-identity').textContent = admin.name;

  const $ = (id) => document.getElementById(id);
  const form = $('testimonial-form');
  const alertEl = $('page-alert');
  const saveBtn = $('save-btn');

  const testimonialId = new URLSearchParams(window.location.search).get('id');
  const isEdit = Boolean(testimonialId);

  let testimonial = null; // last loaded/saved record (edit mode)
  let busy = false; // one in-flight request at a time
  let snapshot = '';
  let currentType = 'WRITTEN'; // selector state; defaults to WRITTEN on create

  $('logout-btn').addEventListener('click', async () => {
    $('logout-btn').disabled = true;
    await Auth.logout();
    window.location.replace(Auth.urlFor(Auth.PATHS.login));
  });

  // ---- Program select (standardized "1% Club member" + free-text custom) ---
  const programSelect = $('program');
  const programCustom = $('program-custom');
  programSelect.addEventListener('change', () => {
    programCustom.hidden = programSelect.value !== '__custom__';
    if (programSelect.value === '__custom__') programCustom.focus();
  });
  function setProgramValue(value) {
    const v = value || '';
    if (v === '' || v === '1% Club member') {
      programSelect.value = v;
      programCustom.hidden = true;
      programCustom.value = '';
    } else {
      programSelect.value = '__custom__';
      programCustom.hidden = false;
      programCustom.value = v;
    }
  }
  function getProgramValue() {
    return programSelect.value === '__custom__' ? programCustom.value.trim() : programSelect.value;
  }

  // ---- Character counters ---------------------------------------------------
  for (const id of ['quote', 'story', 'quote-caption']) {
    const el = $(id);
    const counter = $(`${id}-count`);
    const update = () => { counter.textContent = `${el.value.length} / ${el.maxLength}`; };
    el.addEventListener('input', update);
    update();
  }

  // ---- Type selector ---------------------------------------------------------
  const TYPE_BUTTONS = {
    PHOTO: $('type-photo-btn'),
    VIDEO: $('type-video-btn'),
    WRITTEN: $('type-written-btn'),
  };

  function renderTypePanels(type) {
    $('panel-photo').hidden = type !== 'PHOTO';
    $('panel-video').hidden = type !== 'VIDEO';
    $('panel-written').hidden = type !== 'WRITTEN';
    // PHOTO/VIDEO still need the model's required `quote` field as a short caption.
    $('panel-caption').hidden = type === 'WRITTEN';
    for (const [t, btn] of Object.entries(TYPE_BUTTONS)) {
      btn.setAttribute('aria-pressed', String(t === type));
    }
  }

  async function setType(newType) {
    if (newType === currentType) return;

    // Warn before discarding incompatible media when switching an existing
    // type that already has data (spec 6: "must not silently erase existing
    // data without warning").
    const hasExistingMedia =
      (currentType === 'PHOTO' && $('photo-ref').value.trim()) ||
      (currentType === 'VIDEO' && $('bunny-video-id').value.trim());
    if (hasExistingMedia) {
      const ok = await Ui.confirm({
        title: 'Change testimonial type?',
        message: `Switching from ${currentType} to ${newType} will not submit the ${currentType.toLowerCase()} media you entered unless you switch back. Continue?`,
        confirmLabel: 'Change type',
      });
      if (!ok) return;
    }

    currentType = newType;
    renderTypePanels(newType);
  }

  for (const [t, btn] of Object.entries(TYPE_BUTTONS)) {
    btn.addEventListener('click', () => setType(t));
  }

  // ---- Photo upload (reuses the existing course-thumbnail Bunny Storage
  // Zone endpoint — see testimonials-api.js#uploadPhoto). Writes the
  // returned CDN URL into #photo-ref, same pattern as course-form.js. ------
  const photoPreviewEl = $('photo-upload-preview');
  const photoInputEl = $('photo-upload-input');
  const photoStatusEl = $('photo-upload-status');
  const photoLabelEl = photoInputEl ? photoInputEl.closest('.thumbnail-upload-label') : null;

  function setPhotoStatus(msg, kind) {
    if (!photoStatusEl) return;
    photoStatusEl.textContent = msg || '';
    photoStatusEl.className = 'thumbnail-upload-status' + (kind ? ` is-${kind}` : '');
  }

  function renderPhotoPreview(value) {
    if (!photoPreviewEl) return;
    photoPreviewEl.innerHTML = '';
    const isHttpsUrl = typeof value === 'string' && /^https:\/\//i.test(value);
    if (isHttpsUrl) {
      const img = Dom.el('img', { alt: 'Testimonial photo preview' });
      img.loading = 'lazy';
      img.decoding = 'async';
      img.onerror = () => { photoPreviewEl.classList.add('is-empty'); photoPreviewEl.innerHTML = ''; };
      img.src = value;
      photoPreviewEl.appendChild(img);
      photoPreviewEl.classList.remove('is-empty');
    } else {
      photoPreviewEl.classList.add('is-empty');
    }
  }

  $('photo-ref').addEventListener('input', () => renderPhotoPreview($('photo-ref').value));

  if (photoInputEl) {
    photoInputEl.addEventListener('change', async () => {
      const file = photoInputEl.files && photoInputEl.files[0];
      photoInputEl.value = '';
      if (!file) return;

      setPhotoStatus('');
      photoInputEl.disabled = true;
      if (photoLabelEl) photoLabelEl.setAttribute('aria-disabled', 'true');
      saveBtn.disabled = true;

      const previousUrl = $('photo-ref').value.trim();
      setPhotoStatus('Uploading photo…');
      try {
        const result = await TestimonialsApi.uploadPhoto(file, previousUrl);
        $('photo-ref').value = result.cdnUrl;
        renderPhotoPreview(result.cdnUrl);
        const errEl = $('photo-error');
        if (errEl) errEl.textContent = '';
        $('photo-ref').closest('.field').classList.remove('has-error');
        $('photo-ref').removeAttribute('aria-invalid');
        setPhotoStatus('Uploaded successfully.', 'success');
        setTimeout(() => setPhotoStatus(''), 3000);
      } catch (err) {
        if (Auth.handleSessionError(err)) return;
        setPhotoStatus(`Upload failed: ${(err && err.message) || 'Unknown error.'}`, 'error');
      } finally {
        photoInputEl.disabled = false;
        if (photoLabelEl) photoLabelEl.removeAttribute('aria-disabled');
        saveBtn.disabled = false;
      }
    });
  }

  // ---- Video upload (NEW — additive; see testimonial-video-panel.js). Mounts
  // next to #bunny-video-id and writes the resulting Bunny video id into that
  // same input — the field testimonial-form.js already reads in
  // buildPayload()/fillForm() below is completely unchanged. -------------
  const videoUploadMount = $('video-upload-mount');
  if (videoUploadMount && typeof TestimonialVideoPanel !== 'undefined') {
    TestimonialVideoPanel.create({
      getInput: () => $('bunny-video-id'),
      mountNode: videoUploadMount,
      onBusyChange: (b) => { saveBtn.disabled = b; },
    });
  }

  // ---- Field errors --------------------------------------------------------
  const FIELD_INPUT = {
    name: 'name', role: 'role', quote: 'quote', story: 'story', topic: 'topic',
    program: 'program', course: 'course', order: 'order',
    'media.photo': 'photo-ref', 'media.video.bunnyVideoId': 'bunny-video-id',
  };

  function setError(key, message) {
    const el = $(key);
    const p = $(`${key}-error`);
    if (p) p.textContent = message;
    if (el) {
      const field = el.closest('.field');
      if (field) field.classList.add('has-error');
      el.setAttribute('aria-invalid', 'true');
    }
    return Boolean(p);
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
      let key = FIELD_INPUT[field];
      if (!key && field === 'quote' && currentType !== 'WRITTEN') key = 'quote-caption';
      if (!key || !setError(key, e.message)) unplaced.push(e.message);
    }
    focusFirstError();
    return unplaced;
  }

  // ---- Payload (explicit allow-list; mirrors backend CREATE_FIELDS) ---------
  function buildPayload() {
    const errors = {};
    const name = $('name').value.trim();
    if (name.length < 2) errors.name = 'The name must be at least 2 characters.';

    const orderRaw = $('order').value.trim();
    const order = orderRaw === '' ? 0 : /^\d{1,9}$/.test(orderRaw) ? Number(orderRaw) : null;
    if (order === null) errors.order = 'Enter a whole non-negative number.';

    // quote: the model requires a non-empty quote regardless of type. For
    // WRITTEN, the dedicated quote field is used; for PHOTO/VIDEO, the short
    // caption field doubles as it.
    const quote = currentType === 'WRITTEN' ? $('quote').value.trim() : $('quote-caption').value.trim();
    const story = currentType === 'WRITTEN' ? $('story').value : '';
    if (!quote && !story) errors.quote = currentType === 'WRITTEN' ? 'Enter a quote or a story.' : 'Enter a short caption/quote.';

    const media = {};
    if (currentType === 'PHOTO') {
      const photo = $('photo-ref').value.trim();
      if (!photo) errors['photo-ref'] = 'A photo reference is required for a Photo testimonial.';
      media.photo = photo;
    } else if (currentType === 'VIDEO') {
      const bunnyVideoId = $('bunny-video-id').value.trim();
      if (!bunnyVideoId) errors['bunny-video-id'] = 'A Bunny video ID is required for a Video testimonial.';
      media.video = { bunnyVideoId };
    }

    if (Object.keys(errors).length) return { errors };

    const payload = {
      name,
      role: $('role').value,
      quote,
      story,
      topic: $('topic').value,
      program: getProgramValue(),
      type: currentType,
      media,
      featured: $('featured').value === 'true',
      order,
    };
    const course = $('course').value;
    if (course) payload.course = course;
    return { payload };
  }

  const snapshotOf = () => JSON.stringify([
    $('name').value, $('role').value, $('quote').value, $('story').value, $('quote-caption').value,
    $('topic').value, getProgramValue(), $('course').value, $('featured').value, $('order').value,
    currentType, $('photo-ref').value, $('bunny-video-id').value,
  ]);
  const isDirty = () => snapshot !== '' && snapshot !== snapshotOf();

  window.addEventListener('beforeunload', (e) => { if (isDirty() && !busy) { e.preventDefault(); e.returnValue = ''; } });
  document.addEventListener('click', async (e) => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || !isDirty()) return;
    e.preventDefault();
    const leave = await Ui.confirm({ title: 'Discard unsaved changes?', message: 'You have changes that have not been saved. If you leave now they will be lost.', confirmLabel: 'Discard changes', danger: true });
    if (leave) { snapshot = ''; window.location.href = a.href; }
  });

  // ---- Populate (edit mode) --------------------------------------------------
  function fillForm(t) {
    $('name').value = t.name;
    $('role').value = t.role || '';
    $('topic').value = t.topic || '';
    setProgramValue(t.program || '');
    $('course').value = t.course || '';
    $('featured').value = t.featured ? 'true' : 'false';
    $('order').value = String(t.order || 0);

    currentType = t.type;
    renderTypePanels(t.type);

    if (t.type === 'WRITTEN') {
      $('quote').value = t.quote || '';
      $('story').value = t.story || '';
    } else {
      $('quote-caption').value = t.quote || '';
    }
    $('photo-ref').value = (t.media && t.media.photo) || '';
    $('bunny-video-id').value = (t.media && t.media.video && t.media.video.bunnyVideoId) || '';
    renderPhotoPreview($('photo-ref').value);

    for (const id of ['quote', 'story', 'quote-caption']) $(id).dispatchEvent(new Event('input'));
  }

  function renderPublishing(t) {
    $('publishing-section').hidden = false;
    Dom.clear($('pub-status')); $('pub-status').appendChild(Ui.statusBadge(t.status));
    $('pub-date').textContent = t.publishedAt ? `Published ${Dom.formatDate(t.publishedAt)}` : 'Not published';

    const box = $('pub-actions');
    Dom.clear(box);
    const btn = (label, fn, danger) => box.appendChild(Dom.el('button', { type: 'button', class: `btn btn-sm ${danger ? 'btn-danger' : 'btn-outline'}`, text: label, onclick: fn }));

    if (t.status === 'DRAFT') btn('Publish', () => statusAction('publish'));
    if (t.status !== 'ARCHIVED') btn('Archive', () => statusAction('archive'), true);
    if (t.status === 'ARCHIVED') btn('Republish', () => statusAction('republish'));
  }

  function adoptTestimonial(t) {
    testimonial = t;
    $('page-title').textContent = t.name;
    document.title = `${t.name} — The Knight Club Super Admin`;
    fillForm(t);
    renderPublishing(t);
    snapshot = snapshotOf();
  }

  function fail(err) {
    if (Auth.handleSessionError(err)) return true;
    const unplaced = err instanceof ApiError && err.status === 422 ? applyServerErrors(err.errors) : [];
    const detail = unplaced.length ? ` ${unplaced.join(' ')}` : '';
    Forms.showAlert(alertEl, `${Ui.messageForError(err, 'testimonial')}${detail}`, 'error');
    alertEl.focus();
    return false;
  }

  // ---- Status actions (edit mode) --------------------------------------------
  const STATUS_SPECS = {
    publish: { call: TestimonialsApi.publish, pending: 'Publishing…', done: 'Testimonial published.', title: 'Publish this testimonial?', message: 'It will become visible on the public site.', label: 'Publish' },
    archive: { call: TestimonialsApi.archive, pending: 'Archiving…', done: 'Testimonial archived.', title: 'Archive this testimonial?', message: 'It will be archived and removed from public display. Nothing is deleted and it can be republished later.', label: 'Archive', danger: true },
    republish: { call: TestimonialsApi.republish, pending: 'Republishing…', done: 'Testimonial republished.', title: 'Republish this testimonial?', message: 'It may become publicly visible again. The backend re-checks that its content/media is still valid.', label: 'Republish' },
  };

  async function statusAction(name) {
    if (busy) return;
    if (isDirty()) {
      Forms.showAlert(alertEl, 'Save or discard your edits before changing the status.', 'error');
      return;
    }
    const spec = STATUS_SPECS[name];
    if (!(await Ui.confirm({ title: spec.title, message: spec.message, confirmLabel: spec.label, danger: Boolean(spec.danger) }))) return;
    await runRequest(spec.pending, async () => {
      const data = await spec.call(testimonial.id);
      adoptTestimonial(data.testimonial);
      Forms.showAlert(alertEl, spec.done, 'success');
    });
  }

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

  // ---- Submit -----------------------------------------------------------------
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || saveBtn.disabled) return;

    Forms.hideAlert(alertEl);
    clearErrors();

    const built = buildPayload();
    if (built.errors) {
      for (const [k, msg] of Object.entries(built.errors)) setError(k, msg);
      focusFirstError();
      return;
    }

    busy = true;
    Forms.setLoading(saveBtn, true, isEdit ? 'Saving changes…' : 'Creating testimonial…');
    try {
      if (isEdit) {
        const typeChanged = testimonial.type !== built.payload.type;
        if (typeChanged) {
          // Dedicated change-type endpoint, per backend lifecycle rules —
          // never folded into a general PATCH (spec 7/11).
          const { type, media } = built.payload;
          const data = await TestimonialsApi.changeType(testimonialId, { type, media });
          // The rest of the content fields still go through the normal PATCH.
          const { type: _t, media: _m, ...rest } = built.payload;
          const data2 = await TestimonialsApi.update(testimonialId, rest);
          adoptTestimonial(data2.testimonial);
        } else {
          const data = await TestimonialsApi.update(testimonialId, built.payload);
          adoptTestimonial(data.testimonial);
        }
        Forms.showAlert(alertEl, 'Changes saved.', 'success');
      } else {
        const data = await TestimonialsApi.create(built.payload);
        snapshot = '';
        window.location.replace(`testimonial-form.html?id=${encodeURIComponent(data.testimonial.id)}&created=1`);
        return;
      }
    } catch (err) {
      fail(err);
    } finally {
      busy = false;
      Forms.setLoading(saveBtn, false);
    }
  });

  // ---- Boot ---------------------------------------------------------------
  const loadState = $('load-state');
  function showLoad(title, text) {
    Dom.clear(loadState);
    loadState.appendChild(Dom.el('h3', { text: title }));
    loadState.appendChild(Dom.el('p', { text }));
    loadState.hidden = false;
  }

  function fillCourseSelect(select, items, current) {
    for (const c of items) select.appendChild(Dom.el('option', { value: c.id, text: c.title }));
    if (current && !items.some((c) => c.id === current)) {
      select.insertBefore(Dom.el('option', { value: current, text: `(course ${current})` }), select.firstChild);
    }
  }

  showLoad('Loading…', 'Please wait.');
  try {
    const [courses, loaded] = await Promise.all([
      CoursesApi.list({ limit: 100, sort: 'newest' }).catch(() => ({ items: [] })),
      isEdit ? TestimonialsApi.get(testimonialId) : Promise.resolve(null),
    ]);

    fillCourseSelect($('course'), courses.items, loaded && loaded.testimonial.course);

    loadState.hidden = true;
    form.hidden = false;

    if (isEdit) {
      adoptTestimonial(loaded.testimonial);
      $('save-btn').querySelector('.label').textContent = 'Save changes';
      if (new URLSearchParams(window.location.search).get('created') === '1') {
        Forms.showAlert(alertEl, 'Testimonial created as a draft.', 'success');
      }
    } else {
      currentType = 'WRITTEN';
      renderTypePanels('WRITTEN');
      $('order').value = '0';
      $('featured').value = 'false';
      snapshot = snapshotOf();
    }
  } catch (err) {
    if (Auth.handleSessionError(err)) return;
    const notFound = err instanceof ApiError && (err.status === 404 || err.status === 400);
    showLoad(notFound ? 'Testimonial not found' : 'Could not load this page', notFound ? 'This testimonial does not exist or was removed.' : Ui.messageForError(err, 'testimonial'));
  }
})();
