/**
 * Lead details page controller (Phase L4 — Super Admin Leads / Inquiry
 * Management UI). Modeled on coupon-details.js / student-details.js for
 * page structure, and coupon-form.js for the "only send what changed" save
 * flow.
 *
 * READ-ONLY FIELDS (spec Step 16): name, email, phone, enquiryType, subject,
 * message, course, createdAt are rendered as plain text only — this file
 * never creates an input for them and never includes them in a PATCH body.
 *
 * MUTABLE FIELDS: status, adminNotes, lastContactedAt. The PATCH payload is
 * built field-by-field from the edit form (spec Step 18) — never
 * `{ ...lead, status: x }` — so an immutable field can never leak into a
 * write by accident.
 *
 * lastContactedAt is only ever sent when the admin explicitly changes it
 * (spec Step 12, 20): opening, viewing, or saving an unrelated field (e.g.
 * just the status) never stamps or clears it as a side effect.
 */

(async function initLeadDetails() {
  const admin = await Auth.requireAuth();
  document.documentElement.classList.remove('auth-pending');
  document.getElementById('admin-identity').textContent = admin.name;

  const $ = (id) => document.getElementById(id);
  const alertEl = $('page-alert');
  const loadState = $('load-state');
  const content = $('content');
  const form = $('edit-form');
  const statusSelect = $('f-status');
  const lastContactedInput = $('f-last-contacted');
  const clearLastContactedBtn = $('clear-last-contacted');
  const adminNotesInput = $('f-admin-notes');
  const saveBtn = $('save-btn');
  const saveStatusEl = $('save-status');

  $('logout-btn').addEventListener('click', async () => {
    $('logout-btn').disabled = true;
    await Auth.logout();
    window.location.replace(Auth.urlFor(Auth.PATHS.login));
  });

  const leadId = new URLSearchParams(window.location.search).get('id');
  let currentLead = null;
  let busy = false;

  // A sentinel distinct from both "" (untouched) and null (explicitly
  // cleared), so clearing the field is a deliberate action the admin takes
  // via the Clear button — never an accidental side effect of focusing and
  // blurring the input (spec Step 12: "Do not silently set it").
  let lastContactedCleared = false;

  function showLoad(title, text) {
    Dom.clear(loadState);
    loadState.appendChild(Dom.el('h3', { text: title }));
    loadState.appendChild(Dom.el('p', { text }));
    loadState.hidden = false;
  }

  function fail(err) {
    if (Auth.handleSessionError(err)) return true;
    Forms.showAlert(alertEl, Ui.messageForError(err, 'lead'), 'error');
    alertEl.focus();
    return false;
  }

  // ---- datetime-local <-> ISO helpers ---------------------------------------
  // datetime-local has no timezone; the value it gives/wants is in the
  // BROWSER'S LOCAL time, so conversion must go through the Date object's
  // local getters/constructor — never string-slicing an ISO UTC string,
  // which would silently shift the displayed/submitted time by the admin's
  // UTC offset.
  function isoToLocalInputValue(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function localInputValueToDate(value) {
    if (!value) return null;
    const d = new Date(value); // parsed as local time by the Date constructor
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // ---- Rendering ------------------------------------------------------------
  function renderLead(l) {
    currentLead = l;
    $('page-title').textContent = l.subject;
    document.title = `${l.subject} — The Knight Club Super Admin`;

    $('d-name').textContent = l.name;
    $('d-email').textContent = l.email;
    $('d-phone').textContent = l.phone || '—';
    $('d-enquiry-type').textContent = Ui.ENQUIRY_TYPE_LABELS[l.enquiryType] || l.enquiryType;
    $('d-subject').textContent = l.subject;
    $('d-course').textContent = l.course ? l.course.title || '—' : '—';
    $('d-message').textContent = l.message;
    $('d-created').textContent = Dom.formatDateTime(l.createdAt);
    $('d-updated').textContent = l.updatedAt ? Dom.formatDateTime(l.updatedAt) : '—';

    // Editable fields: seeded from the server's current values every time
    // the lead (re)loads, so the form never shows stale state after a save.
    statusSelect.value = l.status;
    lastContactedInput.value = isoToLocalInputValue(l.lastContactedAt);
    adminNotesInput.value = l.adminNotes || '';
    lastContactedCleared = false;
  }

  // ---- lastContactedAt "Clear" ------------------------------------------------
  clearLastContactedBtn.addEventListener('click', () => {
    lastContactedInput.value = '';
    lastContactedCleared = true;
  });
  lastContactedInput.addEventListener('input', () => {
    // The admin typed/picked a real value: no longer an explicit clear.
    if (lastContactedInput.value) lastContactedCleared = false;
  });

  // ---- Build the PATCH payload: explicit allow-list, changed fields only ----
  // Mirrors coupon-form.js#buildPayload: never spreads `currentLead`, only
  // ever sets the three keys the backend accepts, and only the ones that
  // actually differ from what was last loaded.
  function buildChangedPayload() {
    const payload = {};

    if (statusSelect.value !== currentLead.status) {
      payload.status = statusSelect.value;
    }

    const typedValue = lastContactedInput.value;
    if (lastContactedCleared && currentLead.lastContactedAt) {
      payload.lastContactedAt = null;
    } else if (!lastContactedCleared && typedValue) {
      const nextDate = localInputValueToDate(typedValue);
      const prevIso = currentLead.lastContactedAt;
      const prevTime = prevIso ? new Date(prevIso).getTime() : null;
      if (nextDate && nextDate.getTime() !== prevTime) {
        payload.lastContactedAt = nextDate.toISOString();
      }
    }

    const nextNotes = adminNotesInput.value;
    if (nextNotes !== (currentLead.adminNotes || '')) {
      payload.adminNotes = nextNotes;
    }

    return payload;
  }

  // ---- Save -------------------------------------------------------------------
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || !currentLead) return; // prevents duplicate submissions

    Forms.hideAlert(alertEl);
    saveStatusEl.textContent = '';

    const payload = buildChangedPayload();
    if (Object.keys(payload).length === 0) {
      Forms.showAlert(alertEl, 'You have not changed anything.', 'info');
      return;
    }

    busy = true;
    Forms.setLoading(saveBtn, true, 'Saving…');
    try {
      const data = await LeadApi.update(currentLead.id, payload);
      renderLead(data.lead);
      Forms.showAlert(alertEl, 'Lead updated successfully.', 'success');
      alertEl.focus();
    } catch (err) {
      if (fail(err)) return;
      if (err instanceof ApiError && err.status === 404) {
        showLoad('Lead not found', 'This lead may have been removed.');
        content.hidden = true;
      }
    } finally {
      busy = false;
      Forms.setLoading(saveBtn, false);
    }
  });

  // ---- Initial load -----------------------------------------------------------
  if (!leadId) {
    showLoad('No lead specified', 'Open a lead from the Leads list to see its details.');
    return;
  }

  showLoad('Loading…', 'Please wait.');
  try {
    const data = await LeadApi.get(leadId);
    renderLead(data.lead);
    loadState.hidden = true;
    content.hidden = false;
  } catch (err) {
    if (fail(err)) return;
    const notFound = err instanceof ApiError && (err.status === 404 || err.status === 400);
    showLoad(notFound ? 'Lead not found' : 'Could not load this lead', notFound ? 'This lead does not exist or was removed.' : 'Check your connection and try again.');
  }
})();
