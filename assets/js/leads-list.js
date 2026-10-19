/**
 * Leads list page controller (Phase L4 — Super Admin Leads / Inquiry
 * Management UI). Modeled directly on orders-list.js.
 *
 * ALL searching, filtering and paging happens on the SERVER (spec Step
 * 21-23): this file only sends the current criteria and renders the one
 * page it gets back. It never fetches "all leads" to filter in the
 * browser, and performs no client-side filtering of the result set.
 *
 * The status shown per row is the REAL ContactMessage.status the backend
 * returns (Ui.leadStatusBadge) — never inferred or invented client-side.
 *
 * adminNotes and the full message are deliberately NOT requested or
 * rendered here (spec Step 7, 15) — those are detail-only, loaded by
 * leads-details.js from GET /admin/leads/:id.
 *
 * RACES: every list request gets a sequence number; a response that is no
 * longer the latest is discarded (same pattern as orders-list.js).
 *
 * SESSION EXPIRY: any 401/403 from an API call goes through
 * Auth.handleSessionError(), which clears state and returns to login.
 */

(async function initLeadList() {
  const admin = await Auth.requireAuth();
  document.documentElement.classList.remove('auth-pending');
  document.getElementById('admin-identity').textContent = admin.name;

  const logoutBtn = document.getElementById('logout-btn');
  logoutBtn.addEventListener('click', async () => {
    logoutBtn.disabled = true;
    await Auth.logout();
    window.location.replace(Auth.urlFor(Auth.PATHS.login));
  });

  const $ = (id) => document.getElementById(id);
  const els = {
    alert: $('page-alert'), body: $('leads-body'), table: $('leads-table'), state: $('state-box'),
    pager: $('pager'), info: $('pager-info'), page: $('pager-page'), prev: $('prev-btn'), next: $('next-btn'),
    search: $('f-search'), status: $('f-status'), enquiryType: $('f-enquiry-type'), reset: $('f-reset'),
  };

  const LIMIT = 20;
  const state = { page: 1, totalPages: 0 };
  let seq = 0;

  const criteria = () => ({
    search: els.search.value, status: els.status.value, enquiryType: els.enquiryType.value,
    page: state.page, limit: LIMIT,
  });

  function showState(title, text) {
    Dom.clear(els.state);
    els.state.appendChild(Dom.el('h3', { text: title }));
    els.state.appendChild(Dom.el('p', { text }));
    els.state.hidden = false;
  }

  function setBusy(isBusy) {
    els.table.classList.toggle('is-loading', isBusy);
    els.table.setAttribute('aria-busy', String(isBusy));
  }

  function fail(err) {
    if (Auth.handleSessionError(err)) return true;
    Forms.showAlert(els.alert, Ui.messageForError(err, 'lead'), 'error');
    els.alert.focus();
    return false;
  }

  // ---- Formatting helpers ---------------------------------------------------
  function formatEnquiryType(v) {
    return Ui.ENQUIRY_TYPE_LABELS[v] || v;
  }

  function formatCourse(l) {
    if (!l.course) return Dom.el('span', { class: 'cell-sub', text: '—' });
    return Dom.el('span', { text: l.course.title || '—' });
  }

  function formatEmail(l) {
    // mailto is consistent with this project's existing simple-link usage
    // elsewhere (spec Step 8) — no new CRM/mail integration is introduced.
    return Dom.el('a', { class: 'lead-email-link', href: `mailto:${l.email}`, text: l.email });
  }

  function formatPhone(l) {
    if (!l.phone) return Dom.el('span', { class: 'cell-sub', text: '—' });
    // tel: link, same simple-link pattern as formatEmail's mailto above.
    return Dom.el('a', { class: 'lead-phone-link', href: `tel:+91${l.phone}`, text: l.phone });
  }

  // ---- Row rendering (textContent only — see dom.js header) ---------------
  function renderRows(items) {
    Dom.clear(els.body);
    for (const l of items) {
      els.body.appendChild(Dom.el('tr', {}, [
        Dom.el('td', {}, [Dom.el('span', { class: 'cell-title', text: l.name })]),
        Dom.el('td', {}, [formatEmail(l)]),
        Dom.el('td', {}, [formatPhone(l)]),
        Dom.el('td', { text: formatEnquiryType(l.enquiryType) }),
        Dom.el('td', {}, [Dom.el('span', { class: 'lead-subject', text: l.subject })]),
        Dom.el('td', {}, [formatCourse(l)]),
        Dom.el('td', {}, [Ui.leadStatusBadge(l.status)]),
        Dom.el('td', { text: l.lastContactedAt ? Dom.formatDateTime(l.lastContactedAt) : 'Never' }),
        Dom.el('td', { text: Dom.formatDate(l.createdAt) }),
        Dom.el('td', {}, [
          Dom.el('a', { class: 'btn btn-outline btn-sm', href: `lead-details.html?id=${encodeURIComponent(l.id)}`, text: 'View' }),
        ]),
      ]));
    }
  }

  // ---- Loading ------------------------------------------------------------
  async function load() {
    const mine = ++seq;
    Forms.hideAlert(els.alert);
    els.state.hidden = true;
    setBusy(true);
    if (!els.body.firstChild) showState('Loading leads…', 'Please wait.');

    try {
      const data = await LeadApi.list(criteria());
      if (mine !== seq) return; // a newer request superseded this one

      const { items, pagination } = data;
      state.totalPages = pagination.totalPages;

      // Asked for a page past the end (e.g. after a filter narrows the result set).
      if (items.length === 0 && pagination.total > 0 && state.page > 1) {
        state.page = Math.max(1, pagination.totalPages);
        return load();
      }

      renderRows(items);
      els.pager.hidden = pagination.total === 0;
      els.info.textContent = `${pagination.total} lead${pagination.total === 1 ? '' : 's'}`;
      els.page.textContent = `Page ${pagination.page} of ${Math.max(1, pagination.totalPages)}`;
      els.prev.disabled = pagination.page <= 1;
      els.next.disabled = pagination.page >= pagination.totalPages;

      if (items.length === 0) {
        const filtered = Object.entries(criteria()).some(([k, v]) => !['page', 'limit'].includes(k) && String(v).trim() !== '');
        if (filtered) {
          Dom.clear(els.state);
          els.state.appendChild(Dom.el('h3', { text: 'No leads found' }));
          els.state.appendChild(Dom.el('p', { text: 'No leads match your current filters.' }));
          els.state.appendChild(Dom.el('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: resetFilters, text: 'Clear Filters' }));
          els.state.hidden = false;
        } else {
          showState('No leads found', 'No website or course enquiries have come in yet.');
        }
      } else {
        els.state.hidden = true;
      }
    } catch (err) {
      if (mine !== seq) return;
      Dom.clear(els.body);
      els.pager.hidden = true;
      if (fail(err)) return;
      showState('Could not load leads', 'Check your connection and try again.');
    } finally {
      if (mine === seq) setBusy(false);
    }
  }

  // ---- Filter wiring -------------------------------------------------------
  const reload = () => { state.page = 1; load(); };
  const reloadSearch = Dom.debounce(reload, 350);

  function resetFilters() {
    els.search.value = ''; els.status.value = ''; els.enquiryType.value = '';
    reload();
  }

  els.search.addEventListener('input', reloadSearch);
  for (const sel of [els.status, els.enquiryType]) sel.addEventListener('change', reload);
  els.reset.addEventListener('click', resetFilters);
  els.prev.addEventListener('click', () => { if (state.page > 1) { state.page -= 1; load(); } });
  els.next.addEventListener('click', () => { if (state.page < state.totalPages) { state.page += 1; load(); } });

  await load();
})();
