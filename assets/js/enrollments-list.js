/**
 * Enrollment Management list page controller (Phase 22 — Super Admin
 * Enrollment Management). Modeled directly on orders-list.js.
 *
 * ALL searching, filtering, sorting and paging happens on the SERVER: this
 * file only sends the current criteria and renders the one page it gets
 * back (spec Step 12-22). It never fetches "all enrollments" to filter in
 * the browser.
 *
 * COURSE-WISE / STUDENT-WISE (spec Step 12-13): both are this SAME list,
 * pre-filtered by the course/student dropdowns — there is no separate page
 * for either.
 *
 * READ-ONLY (spec Step 25-29): no row action exists here beyond navigating
 * to the details page — no status edit, no delete.
 *
 * The status shown per row is the REAL Enrollment.status the backend
 * returns (Ui.statusBadge) — never inferred client-side.
 *
 * RACES: every list request gets a sequence number; a response that is no
 * longer the latest is discarded.
 *
 * SESSION EXPIRY: any 401/403 from an API call goes through
 * Auth.handleSessionError(), which clears state and returns to login.
 */

(async function initEnrollmentList() {
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
    alert: $('page-alert'), body: $('enrollments-body'), table: $('enrollments-table'), state: $('state-box'),
    pager: $('pager'), info: $('pager-info'), page: $('pager-page'), prev: $('prev-btn'), next: $('next-btn'),
    search: $('f-search'), status: $('f-status'), source: $('f-source'), course: $('f-course'), student: $('f-student'), date: $('f-date'),
    sort: $('f-sort'), reset: $('f-reset'),
  };

  const LIMIT = 20;
  const state = { page: 1, totalPages: 0 };
  let seq = 0;

  const criteria = () => ({
    search: els.search.value, status: els.status.value, source: els.source.value, course: els.course.value, student: els.student.value,
    dateFilter: els.date.value, sort: els.sort.value, page: state.page, limit: LIMIT,
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
    Forms.showAlert(els.alert, Ui.messageForError(err, 'enrollment'), 'error');
    els.alert.focus();
    return false;
  }

  // ---- Filter dropdown options ---------------------------------------------
  async function loadCourseOptions() {
    try {
      const data = await EnrollmentApi.courses();
      for (const c of data.courses) {
        els.course.appendChild(Dom.el('option', { value: c.id, text: c.title }));
      }
    } catch (err) {
      // Non-fatal: the filter dropdown just stays "All courses" only.
    }
  }

  async function loadStudentOptions() {
    try {
      const data = await EnrollmentApi.students();
      for (const s of data.students) {
        els.student.appendChild(Dom.el('option', { value: s.id, text: `${s.fullName} (${s.userId})` }));
      }
    } catch (err) {
      // Non-fatal: the filter dropdown just stays "All students" only.
    }
  }

  // ---- Formatting helpers ---------------------------------------------------
  function formatStudent(e) {
    if (!e.student || e.student.deleted) return Dom.el('span', { class: 'cell-sub', text: 'Deleted student' });
    return Dom.el('div', {}, [
      Dom.el('div', { class: 'cell-title', text: e.student.fullName || e.student.userId }),
      Dom.el('div', { class: 'cell-sub', text: e.student.userId }),
    ]);
  }

  function formatCourse(e) {
    if (!e.course || e.course.deleted) return Dom.el('span', { class: 'cell-sub', text: 'Deleted course' });
    return Dom.el('span', { text: e.course.title });
  }

  function formatAccess(e) {
    const label = e.access.accessGranted ? 'Active' : 'Blocked';
    return Dom.el('span', { class: `badge badge-sm badge-${e.access.accessGranted ? 'active' : 'suspended'}`, text: label });
  }

  // ---- Row rendering (textContent only) -----------------------------------
  function sourceCell(e) {
    const box = Dom.el('div', {}, [Ui.sourceBadge(e.source)]);
    if (e.orderNumber) box.appendChild(Dom.el('div', { class: 'cell-sub', text: e.orderNumber }));
    return box;
  }

  function renderRows(items) {
    Dom.clear(els.body);
    for (const e of items) {
      els.body.appendChild(Dom.el('tr', {}, [
        Dom.el('td', {}, [Dom.el('span', { class: 'order-id', text: e.id })]),
        Dom.el('td', {}, [formatStudent(e)]),
        Dom.el('td', {}, [formatCourse(e)]),
        Dom.el('td', {}, [sourceCell(e)]),
        Dom.el('td', {}, [Ui.statusBadge(e.status)]),
        Dom.el('td', {}, [formatAccess(e)]),
        Dom.el('td', { text: Dom.formatDate(e.enrolledAt) }),
        Dom.el('td', {}, [
          Dom.el('a', { class: 'btn btn-outline btn-sm', href: `enrollment-details.html?id=${encodeURIComponent(e.id)}`, text: 'Details' }),
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
    if (!els.body.firstChild) showState('Loading enrollments…', 'Please wait.');

    try {
      const data = await EnrollmentApi.list(criteria());
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
      els.info.textContent = `${pagination.total} enrollment${pagination.total === 1 ? '' : 's'}`;
      els.page.textContent = `Page ${pagination.page} of ${Math.max(1, pagination.totalPages)}`;
      els.prev.disabled = pagination.page <= 1;
      els.next.disabled = pagination.page >= pagination.totalPages;

      if (items.length === 0) {
        const filtered = Object.entries(criteria()).some(([k, v]) => !['sort', 'page', 'limit'].includes(k) && String(v).trim() !== '');
        showState('No enrollments found', filtered ? 'No enrollment matches your selected criteria.' : 'No enrollments have been created yet.');
      } else {
        els.state.hidden = true;
      }
    } catch (err) {
      if (mine !== seq) return;
      Dom.clear(els.body);
      els.pager.hidden = true;
      if (fail(err)) return;
      showState('Could not load enrollments', 'Check your connection and try again.');
    } finally {
      if (mine === seq) setBusy(false);
    }
  }

  // ---- Filter wiring -------------------------------------------------------
  const reload = () => { state.page = 1; load(); };
  const reloadSearch = Dom.debounce(reload, 350);

  els.search.addEventListener('input', reloadSearch);
  for (const sel of [els.status, els.source, els.course, els.student, els.date, els.sort]) sel.addEventListener('change', reload);
  els.reset.addEventListener('click', () => {
    els.search.value = ''; els.status.value = ''; els.source.value = ''; els.course.value = ''; els.student.value = '';
    els.date.value = ''; els.sort.value = 'newest';
    reload();
  });
  els.prev.addEventListener('click', () => { if (state.page > 1) { state.page -= 1; load(); } });
  els.next.addEventListener('click', () => { if (state.page < state.totalPages) { state.page += 1; load(); } });

  await Promise.all([loadCourseOptions(), loadStudentOptions()]);
  await load();
})();
