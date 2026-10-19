/**
 * Coupon create / edit form controller (Phase 19 — Super Admin Coupon
 * Management). Modeled directly on course-form.js.
 *
 * MODES  no ?id  -> create (POST)
 *        ?id=... -> edit   (PATCH; ACTIVE/INACTIVE changes go through the
 *                            dedicated Enable/Disable/Archive action
 *                            buttons, never through this form's Save)
 *
 * WHAT THE FORM NEVER SENDS: code (immutable after creation, spec Step 9),
 * status, usedCount, createdBy, createdAt, updatedAt, _id. The payload
 * builder below lists the writable fields explicitly — the backend's
 * schemas are strict and would reject anything else anyway, but the client
 * does not even try.
 *
 * VALIDATION here is convenience only; the backend is authoritative and its
 * field-level errors (422) are mapped back onto the same inputs.
 *
 * MONEY: rupee inputs are converted to integer paise via Dom.rupeesToPaise
 * (string/integer math only — see dom.js header) never parseFloat.
 *
 * COURSE SCOPE: a coupon is GLOBAL (courses: []) unless the admin switches
 * to "Course-specific" and picks at least one course — the same emptiness-
 * means-global rule the Coupon model itself documents.
 *
 * UNSAVED CHANGES: a snapshot of the payload is compared on beforeunload
 * and on in-page navigation, so leaving with edits asks first.
 */

(async function initCouponForm() {
  const admin = await Auth.requireAuth();
  document.documentElement.classList.remove('auth-pending');
  document.getElementById('admin-identity').textContent = admin.name;

  const $ = (id) => document.getElementById(id);
  const form = $('coupon-form');
  const alertEl = $('page-alert');
  const saveBtn = $('save-btn');

  const couponId = new URLSearchParams(window.location.search).get('id');
  const isEdit = Boolean(couponId);

  let coupon = null; // the coupon as last loaded/saved (edit mode)
  let allCourses = []; // { id, title, slug, status } — the full selector list
  let busy = false; // ONE in-flight request at a time (no duplicate submits)
  let snapshot = '';

  $('logout-btn').addEventListener('click', async () => {
    $('logout-btn').disabled = true;
    await Auth.logout();
    window.location.replace(Auth.urlFor(Auth.PATHS.login));
  });

  // ---- Discount-type field toggling -----------------------------------------
  function syncDiscountFields() {
    const isPct = $('discountType').value === 'PERCENTAGE';
    $('field-percentage').hidden = !isPct;
    $('field-fixedAmount').hidden = isPct;
    $('field-maxDiscountAmount').hidden = !isPct;
    if (!isPct) $('maxDiscountAmount').value = ''; // meaningless for FIXED — never silently sent
  }
  $('discountType').addEventListener('change', syncDiscountFields);
  syncDiscountFields();

  // ---- Course picker (scope toggle + checklist) ------------------------------
  const coursePicker = $('course-picker');
  const coursePickerField = $('course-picker-field');
  const coursePickerSummary = $('course-picker-summary');
  let selectedCourseIds = new Set();

  function syncScopeUI() {
    const courseSpecific = $('scope-course').checked;
    coursePickerField.hidden = !courseSpecific;
  }
  $('scope-global').addEventListener('change', syncScopeUI);
  $('scope-course').addEventListener('change', syncScopeUI);

  function renderCoursePicker() {
    Dom.clear(coursePicker);
    if (allCourses.length === 0) {
      coursePicker.appendChild(Dom.el('div', { class: 'course-picker-empty', text: 'No courses available to select.' }));
    }
    for (const c of allCourses) {
      const checkboxId = `course-opt-${c.id}`;
      const checkbox = Dom.el('input', {
        type: 'checkbox', id: checkboxId, value: c.id,
        checked: selectedCourseIds.has(c.id) || undefined,
        onchange: (e) => {
          if (e.target.checked) selectedCourseIds.add(c.id);
          else selectedCourseIds.delete(c.id);
          updateCoursePickerSummary();
        },
      });
      coursePicker.appendChild(Dom.el('div', { class: 'course-picker-row' }, [
        checkbox,
        Dom.el('label', { for: checkboxId }, [
          Dom.el('span', { text: c.title }),
          Dom.el('span', { class: 'cell-sub', text: c.status === 'ARCHIVED' ? `${c.slug} (archived)` : c.slug }),
        ]),
      ]));
    }
    updateCoursePickerSummary();
  }
  function updateCoursePickerSummary() {
    coursePickerSummary.textContent = selectedCourseIds.size === 0
      ? 'No courses selected yet.'
      : `${selectedCourseIds.size} course${selectedCourseIds.size === 1 ? '' : 's'} selected.`;
  }

  // ---- Field-error plumbing (same shape as course-form.js) -------------------
  const FIELD_INPUT = {
    code: 'code', description: 'description', discountType: 'discountType', percentage: 'percentage',
    fixedAmount: 'fixedAmount', maxDiscountAmount: 'maxDiscountAmount', minOrderAmount: 'minOrderAmount',
    startAt: 'startAt', endAt: 'endAt', usageLimit: 'usageLimit', perUserLimit: 'perUserLimit', courses: 'courses',
  };

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
  function applyServerErrors(errors) {
    const unplaced = [];
    for (const e of errors || []) {
      const field = String(e.field || '');
      const key = FIELD_INPUT[field];
      if (!key || !setError(key, e.message)) unplaced.push(e.message);
    }
    focusFirstError();
    return unplaced;
  }

  // ---- datetime-local <-> ISO helpers ----------------------------------------
  // <input type="datetime-local"> has no timezone; treated as the browser's
  // local time and converted to a real ISO instant at the boundary, matching
  // how the backend's dateField expects a genuine ISO date-time string.
  function localInputToIso(value) {
    if (!value) return undefined;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  function isoToLocalInput(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // ---- Payload (explicit allow-list; money via string math) -----------------
  function buildPayload() {
    const errors = {};

    const code = $('code').value.trim();
    if (!isEdit && code.length < 3) errors.code = 'The code must be at least 3 characters.';

    const discountType = $('discountType').value;
    let percentage;
    let fixedAmount;
    if (discountType === 'PERCENTAGE') {
      const raw = $('percentage').value.trim();
      const n = /^\d{1,3}$/.test(raw) ? Number(raw) : null;
      if (n === null || n < 1 || n > 100) errors.percentage = 'Enter a whole number between 1 and 100.';
      else percentage = n;
    } else {
      const rawFixed = $('fixedAmount').value.trim();
      if (rawFixed === '') {
        errors.fixedAmount = 'Enter an amount.';
      } else {
        fixedAmount = Dom.rupeesToPaise(rawFixed);
        if (fixedAmount === null) errors.fixedAmount = 'Enter a valid amount, e.g. 250 or 250.50.';
      }
    }

    let maxDiscountAmount;
    const maxRaw = $('maxDiscountAmount').value.trim();
    if (discountType === 'PERCENTAGE' && maxRaw !== '') {
      maxDiscountAmount = Dom.rupeesToPaise(maxRaw);
      if (maxDiscountAmount === null) errors.maxDiscountAmount = 'Enter a valid amount, e.g. 500 or 500.50.';
    }

    let minOrderAmount;
    const minRaw = $('minOrderAmount').value.trim();
    if (minRaw !== '') {
      minOrderAmount = Dom.rupeesToPaise(minRaw);
      if (minOrderAmount === null) errors.minOrderAmount = 'Enter a valid amount, e.g. 999 or 999.00.';
    }

    let startAt;
    let endAt;
    const startRaw = $('startAt').value;
    const endRaw = $('endAt').value;
    if (startRaw) {
      startAt = localInputToIso(startRaw);
      if (startAt === null) errors.startAt = 'Enter a valid date and time.';
    }
    if (endRaw) {
      endAt = localInputToIso(endRaw);
      if (endAt === null) errors.endAt = 'Enter a valid date and time.';
    }
    if (startAt && endAt && new Date(startAt).getTime() > new Date(endAt).getTime()) {
      errors.endAt = 'End must not be before start.';
    }

    let usageLimit;
    const usageRaw = $('usageLimit').value.trim();
    if (usageRaw !== '') {
      const n = /^\d{1,7}$/.test(usageRaw) ? Number(usageRaw) : null;
      if (n === null || n < 1) errors.usageLimit = 'Enter a whole number of 1 or more.';
      else usageLimit = n;
    }

    let perUserLimit;
    const perUserRaw = $('perUserLimit').value.trim();
    if (perUserRaw !== '') {
      const n = /^\d{1,4}$/.test(perUserRaw) ? Number(perUserRaw) : null;
      if (n === null || n < 1) errors.perUserLimit = 'Enter a whole number of 1 or more.';
      else perUserLimit = n;
    }

    const courseSpecific = $('scope-course').checked;
    let courses;
    if (courseSpecific) {
      courses = Array.from(selectedCourseIds);
      if (courses.length === 0) errors.courses = 'Select at least one course, or switch to Global.';
    } else {
      courses = [];
    }

    if (Object.keys(errors).length) return { errors };

    const payload = { discountType, minOrderAmount: minOrderAmount ?? 0, courses };
    if (!isEdit) payload.code = code;
    const description = $('description').value.trim();
    if (description || isEdit) payload.description = description;
    if (discountType === 'PERCENTAGE') {
      payload.percentage = percentage;
      if (maxDiscountAmount !== undefined) payload.maxDiscountAmount = maxDiscountAmount;
    } else {
      payload.fixedAmount = fixedAmount;
    }
    if (startAt !== undefined) payload.startAt = startAt;
    if (endAt !== undefined) payload.endAt = endAt;
    if (usageLimit !== undefined) payload.usageLimit = usageLimit;
    if (perUserLimit !== undefined) payload.perUserLimit = perUserLimit;

    // Edit mode: only send fields that actually changed, so an untouched
    // optional field is never re-sent as "cleared" (mirrors course-form.js's
    // "send only what changed" discipline for its own optional fields).
    if (isEdit) return { payload: diffFromLoadedCoupon(payload) };
    return { payload };
  }

  /** Drops keys from `payload` that equal the currently-loaded coupon's value, so a no-op field is never re-sent. */
  function diffFromLoadedCoupon(payload) {
    const out = {};
    for (const [key, value] of Object.entries(payload)) {
      const current = coupon[key];
      const same = key === 'courses'
        ? Array.isArray(current) && current.length === value.length && current.every((c, i) => c === value[i])
        : key === 'startAt' || key === 'endAt'
          ? (current ? new Date(current).getTime() : null) === (value ? new Date(value).getTime() : null)
          : current === value;
      if (!same) out[key] = value;
    }
    return out;
  }

  const snapshotOf = () => JSON.stringify([
    $('code').value, $('description').value, $('discountType').value, $('percentage').value, $('fixedAmount').value,
    $('maxDiscountAmount').value, $('minOrderAmount').value, $('startAt').value, $('endAt').value,
    $('usageLimit').value, $('perUserLimit').value, $('scope-course').checked, Array.from(selectedCourseIds).sort(),
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
  function fillForm(c) {
    $('code').value = c.code;
    $('code').disabled = true; // immutable after creation (spec Step 9)
    $('description').value = c.description || '';
    $('discountType').value = c.discountType;
    $('percentage').value = c.percentage != null ? String(c.percentage) : '';
    $('fixedAmount').value = c.fixedAmount != null ? Dom.paiseToRupees(c.fixedAmount) : '';
    $('maxDiscountAmount').value = c.maxDiscountAmount != null ? Dom.paiseToRupees(c.maxDiscountAmount) : '';
    $('minOrderAmount').value = c.minOrderAmount ? Dom.paiseToRupees(c.minOrderAmount) : '';
    $('startAt').value = isoToLocalInput(c.startAt);
    $('endAt').value = isoToLocalInput(c.endAt);
    $('usageLimit').value = c.usageLimit != null ? String(c.usageLimit) : '';
    $('perUserLimit').value = c.perUserLimit != null ? String(c.perUserLimit) : '';
    syncDiscountFields();

    const courseSpecific = Array.isArray(c.courses) && c.courses.length > 0;
    $('scope-course').checked = courseSpecific;
    $('scope-global').checked = !courseSpecific;
    selectedCourseIds = new Set(c.courses || []);
    syncScopeUI();
    renderCoursePicker();

    if (c.usageLimit != null || c.usedCount > 0) {
      $('usage-readout').hidden = false;
      const remaining = typeof c.usageLimit === 'number' ? `${Math.max(0, c.usageLimit - c.usedCount)} remaining` : 'unlimited remaining';
      $('usage-readout-text').textContent = `${c.usedCount} used so far, ${remaining}.`;
    }
  }

  function renderStatusPanel(c) {
    $('status-section').hidden = false;
    Dom.clear($('status-current'));
    $('status-current').appendChild(Ui.statusBadge(c.status));
    $('status-effective').textContent = c.effectiveState && c.effectiveState !== c.status
      ? `Currently shown to students as: ${c.effectiveState.replace(/_/g, ' ').toLowerCase()}.`
      : '';

    const box = $('status-actions');
    Dom.clear(box);
    const btn = (label, fn, danger) => box.appendChild(Dom.el('button', { type: 'button', class: `btn btn-sm ${danger ? 'btn-danger' : 'btn-outline'}`, text: label, onclick: fn }));
    if (c.status === 'ACTIVE') {
      btn('Disable', () => statusAction('deactivate', CouponApi.deactivate, 'Disable this coupon?', `“${c.code}” will stop working at checkout immediately. Purchases already made with it are not affected.`, true), true);
    } else {
      btn('Enable', () => statusAction('activate', CouponApi.activate, 'Enable this coupon?', `“${c.code}” will become usable at checkout again (subject to its dates and usage limits).`));
    }
    btn('Archive', () => statusAction('archive', CouponApi.archive, 'Archive this coupon?', `“${c.code}” will be archived and can no longer be applied at checkout. Its history is kept exactly as it was.`, true), true);
  }

  async function statusAction(name, call, title, message, danger) {
    if (busy) return;
    if (isDirty()) {
      Forms.showAlert(alertEl, 'Save or discard your edits before changing this coupon\u2019s availability.', 'error');
      return;
    }
    if (!(await Ui.confirm({ title, message, confirmLabel: title.split(' ')[0], danger: Boolean(danger) }))) return;
    await runRequest(`${title.split(' ')[0]}ing…`, async () => {
      const data = await call(coupon.id);
      adoptCoupon(data.coupon);
      Forms.showAlert(alertEl, `“${data.coupon.code}” updated.`, 'success');
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

  function adoptCoupon(c) {
    coupon = c;
    $('page-title').textContent = c.code;
    document.title = `${c.code} — The Knight Club Super Admin`;
    fillForm(c);
    renderStatusPanel(c);
    snapshot = snapshotOf();
  }

  function fail(err) {
    if (Auth.handleSessionError(err)) return true;
    const unplaced = err instanceof ApiError && err.status === 422 ? applyServerErrors(err.errors) : [];
    const detail = unplaced.length ? ` ${unplaced.join(' ')}` : '';
    Forms.showAlert(alertEl, `${Ui.messageForError(err, 'coupon')}${detail}`, 'error');
    alertEl.focus();
    return false;
  }

  // ---- Submit -----------------------------------------------------------------
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

    if (isEdit && Object.keys(built.payload).length === 0) {
      Forms.showAlert(alertEl, 'You have not changed anything.', 'info');
      return;
    }

    busy = true;
    Forms.setLoading(saveBtn, true, isEdit ? 'Saving changes…' : 'Creating coupon…');
    try {
      if (isEdit) {
        const data = await CouponApi.update(couponId, built.payload);
        adoptCoupon(data.coupon);
        Forms.showAlert(alertEl, 'Changes saved.', 'success');
      } else {
        const data = await CouponApi.create(built.payload);
        snapshot = ''; // saved: do not warn about leaving
        window.location.replace(`coupon-form.html?id=${encodeURIComponent(data.coupon.id)}&created=1`);
        return; // navigating away; leave the button in its loading state
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError('code', 'A coupon with this code already exists. Choose a different one.');
        Forms.showAlert(alertEl, Ui.messageForError(err, 'coupon'), 'error');
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
    const [coursesData, loaded] = await Promise.all([
      CouponApi.courses(),
      isEdit ? CouponApi.get(couponId) : Promise.resolve(null),
    ]);
    allCourses = coursesData.items;

    loadState.hidden = true;
    form.hidden = false;

    if (isEdit) {
      // A course-specific coupon may reference a course this selector
      // (non-archived only) does not currently include, e.g. one archived
      // after the coupon was scoped to it. Add it back in so the checkbox
      // list can still show it as selected, clearly marked — never silently
      // dropping a course id the coupon actually still targets.
      const known = new Set(allCourses.map((c) => c.id));
      const missing = (loaded.coupon.courses || []).filter((id) => !known.has(id));
      for (const id of missing) allCourses.push({ id, title: `(unavailable course ${id})`, slug: '', status: 'ARCHIVED' });

      adoptCoupon(loaded.coupon);
      $('save-btn').querySelector('.label').textContent = 'Save changes';
      if (new URLSearchParams(window.location.search).get('created') === '1') {
        Forms.showAlert(alertEl, 'Coupon created.', 'success');
      }
    } else {
      renderCoursePicker();
      snapshot = snapshotOf();
    }
  } catch (err) {
    if (Auth.handleSessionError(err)) return;
    const notFound = err instanceof ApiError && (err.status === 404 || err.status === 400);
    showLoad(notFound ? 'Coupon not found' : 'Could not load this page', notFound ? 'This coupon does not exist or was removed.' : Ui.messageForError(err, 'coupon'));
  }
})();
