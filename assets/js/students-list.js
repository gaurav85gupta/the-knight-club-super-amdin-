/**
 * Student list page controller (Phase 21 — Super Admin Student Management).
 * Modeled directly on orders-list.js.
 *
 * ALL searching, filtering, sorting and paging happens on the SERVER: this
 * file only sends the current criteria and renders the one page it gets
 * back. It never fetches "all students" to filter in the browser.
 *
 * The status shown per row is the REAL Student.status the backend returns
 * (Ui.statusBadge) — never inferred client-side.
 *
 * RACES: every list request gets a sequence number; a response that is no
 * longer the latest is discarded.
 *
 * SESSION EXPIRY: any 401/403 from an API call goes through
 * Auth.handleSessionError(), which clears state and returns to login.
 */

(async function initStudentList() {
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
    alert: $('page-alert'), body: $('students-body'), table: $('students-table'), state: $('state-box'),
    pager: $('pager'), info: $('pager-info'), page: $('pager-page'), prev: $('prev-btn'), next: $('next-btn'),
    search: $('f-search'), status: $('f-status'), sort: $('f-sort'), reset: $('f-reset'),
  };

  const LIMIT = 20;
  const state = { page: 1, totalPages: 0 };
  let seq = 0;

  const criteria = () => ({
    search: els.search.value, status: els.status.value,
    sort: els.sort.value, page: state.page, limit: LIMIT,
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
    Forms.showAlert(els.alert, Ui.messageForError(err, 'student'), 'error');
    els.alert.focus();
    return false;
  }

  // ---- Formatting helpers ---------------------------------------------------
  function formatStudent(s) {
    return Dom.el('div', {}, [
      Dom.el('div', { class: 'cell-title', text: s.fullName }),
      s.isMember ? Ui.memberBadge() : null,
    ]);
  }

  // ---- Row rendering (textContent only) -----------------------------------
  function renderRows(items) {
    Dom.clear(els.body);
    for (const s of items) {
      els.body.appendChild(Dom.el('tr', {}, [
        Dom.el('td', {}, [formatStudent(s)]),
        Dom.el('td', { 'data-col': 'tertiary' }, [Dom.el('span', { class: 'order-id', text: s.userId })]),
        Dom.el('td', { 'data-col': 'secondary', text: s.mobile || '—' }),
        Dom.el('td', {}, [Ui.statusBadge(s.status)]),
        Dom.el('td', { 'data-col': 'secondary', text: String(s.enrollmentCount) }),
        Dom.el('td', { 'data-col': 'secondary', text: String(s.purchaseCount) }),
        Dom.el('td', { 'data-col': 'secondary', text: Dom.formatDate(s.createdAt) }),
        Dom.el('td', {}, [
          Dom.el('a', { class: 'btn btn-outline btn-sm', href: `student-details.html?id=${encodeURIComponent(s.id)}`, text: 'View' }),
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
    if (!els.body.firstChild) showState('Loading students…', 'Please wait.');

    try {
      const data = await StudentApi.list(criteria());
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
      els.info.textContent = `${pagination.total} student${pagination.total === 1 ? '' : 's'}`;
      els.page.textContent = `Page ${pagination.page} of ${Math.max(1, pagination.totalPages)}`;
      els.prev.disabled = pagination.page <= 1;
      els.next.disabled = pagination.page >= pagination.totalPages;

      if (items.length === 0) {
        const filtered = Object.entries(criteria()).some(([k, v]) => !['sort', 'page', 'limit'].includes(k) && String(v).trim() !== '');
        showState('No students found', filtered ? 'No student matches these filters. Try changing or resetting them.' : 'No students have registered yet.');
      } else {
        els.state.hidden = true;
      }
    } catch (err) {
      if (mine !== seq) return;
      Dom.clear(els.body);
      els.pager.hidden = true;
      if (fail(err)) return;
      showState('Could not load students', 'Check your connection and try again.');
    } finally {
      if (mine === seq) setBusy(false);
    }
  }

  // ---- Filter wiring -------------------------------------------------------
  const reload = () => { state.page = 1; load(); };
  const reloadSearch = Dom.debounce(reload, 350);

  els.search.addEventListener('input', reloadSearch);
  for (const sel of [els.status, els.sort]) sel.addEventListener('change', reload);
  els.reset.addEventListener('click', () => {
    els.search.value = ''; els.status.value = ''; els.sort.value = 'newest';
    reload();
  });
  els.prev.addEventListener('click', () => { if (state.page > 1) { state.page -= 1; load(); } });
  els.next.addEventListener('click', () => { if (state.page < state.totalPages) { state.page += 1; load(); } });

  await load();
})();
