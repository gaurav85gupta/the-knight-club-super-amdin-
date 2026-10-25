/**
 * Course list page controller (Phase 6).
 *
 * ALL searching, filtering, sorting and paging happens on the SERVER: this
 * file only sends the current criteria and renders the one page it gets
 * back (spec 9-13). It never fetches "all courses" to filter in the browser.
 *
 * RACES: every request gets a sequence number; a response that is no longer
 * the latest is discarded, so a slow earlier search can never overwrite the
 * results of a newer one.
 *
 * SESSION EXPIRY: any 401/403 from an API call goes through
 * Auth.handleSessionError(), which clears state and returns to login.
 */

(async function initCourseList() {
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
    alert: $('page-alert'), body: $('courses-body'), table: $('courses-table'), state: $('state-box'),
    pager: $('pager'), info: $('pager-info'), page: $('pager-page'), prev: $('prev-btn'), next: $('next-btn'),
    search: $('f-search'), status: $('f-status'), visibility: $('f-visibility'),
    category: $('f-category'), instructor: $('f-instructor'), sort: $('f-sort'), reset: $('f-reset'),
  };

  const LIMIT = 20;
  const state = { page: 1, totalPages: 0 };
  let seq = 0;
  let busyRow = null; // id of the row whose action is in flight

  const criteria = () => ({
    search: els.search.value, status: els.status.value, visibility: els.visibility.value,
    category: els.category.value, instructor: els.instructor.value, sort: els.sort.value,
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
    Forms.showAlert(els.alert, Ui.messageForError(err), 'error');
    els.alert.focus();
    return false;
  }

  // ---- Row rendering (textContent only) -----------------------------------
  function actionButton(label, handler, { danger = false } = {}) {
    return Dom.el('button', { type: 'button', class: `btn btn-sm ${danger ? 'btn-danger' : 'btn-outline'}`, text: label, onclick: handler });
  }

  function rowActions(c) {
    const editHref = `course-form.html?id=${encodeURIComponent(c.id)}`;
    const box = Dom.el('div', { class: 'table-actions' }, [
      Dom.el('a', {
        class: 'btn btn-outline btn-sm',
        href: editHref,
        text: 'Edit',
        // Defensive: some static-file servers rewrite "/course-form.html?id=X"
        // to "/course-form?id=X" on the way through and can drop the query
        // string in that rewrite. Remembering the intended id here lets
        // course-form.js notice a mismatch and warn instead of silently
        // opening a blank "New course" form.
        onclick: () => { try { sessionStorage.setItem('nightclub:lastEditIntent', c.id); } catch (e) { /* storage unavailable — non-fatal */ } },
      }),
    ]);
    if (c.status === 'DRAFT') box.appendChild(actionButton('Publish', () => runAction(c, 'publish')));
    if (c.status === 'PUBLISHED') box.appendChild(actionButton('Unpublish', () => runAction(c, 'unpublish')));
    if (c.status === 'ARCHIVED') box.appendChild(actionButton('Restore', () => runAction(c, 'restore')));
    if (c.status !== 'ARCHIVED') box.appendChild(actionButton('Archive', () => runAction(c, 'archive'), { danger: true }));
    return box;
  }

  function renderRows(items) {
    Dom.clear(els.body);
    for (const c of items) {
      els.body.appendChild(Dom.el('tr', {}, [
        Dom.el('td', {}, [Dom.el('div', { class: 'cell-title', text: c.title }), Dom.el('div', { class: 'cell-sub', text: c.slug })]),
        Dom.el('td', { text: (c.category && c.category.name) || '—' }),
        Dom.el('td', { 'data-col': 'tertiary', text: (c.instructor && c.instructor.name) || '—' }),
        Dom.el('td', { text: Dom.formatPrice(c.pricing) }),
        Dom.el('td', {}, [Ui.statusBadge(c.status)]),
        Dom.el('td', { 'data-col': 'secondary' }, [Ui.visibilityBadge(c.visibility)]),
        Dom.el('td', { 'data-col': 'secondary', text: Dom.formatDate(c.createdAt) }),
        Dom.el('td', { 'data-col': 'secondary', text: Dom.formatDate(c.updatedAt) }),
        Dom.el('td', {}, [rowActions(c)]),
      ]));
    }
  }

  // ---- Loading ------------------------------------------------------------
  async function load() {
    const mine = ++seq;
    Forms.hideAlert(els.alert);
    els.state.hidden = true;
    setBusy(true);
    if (!els.body.firstChild) showState('Loading courses…', 'Please wait.');

    try {
      const data = await CoursesApi.list(criteria());
      if (mine !== seq) return; // a newer request superseded this one

      const { items, pagination } = data;
      state.totalPages = pagination.totalPages;

      // Asked for a page past the end (e.g. after archiving the last row of the last page).
      if (items.length === 0 && pagination.total > 0 && state.page > 1) {
        state.page = Math.max(1, pagination.totalPages);
        return load();
      }

      renderRows(items);
      els.pager.hidden = pagination.total === 0;
      els.info.textContent = `${pagination.total} course${pagination.total === 1 ? '' : 's'}`;
      els.page.textContent = `Page ${pagination.page} of ${Math.max(1, pagination.totalPages)}`;
      els.prev.disabled = pagination.page <= 1;
      els.next.disabled = pagination.page >= pagination.totalPages;

      if (items.length === 0) {
        const filtered = Object.entries(criteria()).some(([k, v]) => !['sort', 'page', 'limit'].includes(k) && String(v).trim() !== '');
        showState('No courses found', filtered ? 'No course matches these filters. Try changing or resetting them.' : 'You have not created any courses yet. Use “New course” to add one.');
      } else {
        els.state.hidden = true;
      }
    } catch (err) {
      if (mine !== seq) return;
      Dom.clear(els.body);
      els.pager.hidden = true;
      if (fail(err)) return;
      showState('Could not load courses', 'Check your connection and try again.');
    } finally {
      if (mine === seq) setBusy(false);
    }
  }

  // ---- Row actions (publish / unpublish / archive / restore) ---------------
  const ACTIONS = {
    publish: {
      call: CoursesApi.publish, pending: 'Publishing…', done: 'Course published.',
      confirm: (c) => ({ title: 'Publish this course?', message: `“${c.title}” will become Published. It stays private until you set its visibility to Public.`, confirmLabel: 'Publish' }),
    },
    unpublish: {
      call: CoursesApi.unpublish, pending: 'Unpublishing…', done: 'Course moved back to draft.',
      confirm: (c) => ({ title: 'Unpublish this course?', message: `“${c.title}” will go back to Draft and its publication date will be cleared.`, confirmLabel: 'Unpublish' }),
    },
    archive: {
      call: CoursesApi.archive, pending: 'Archiving…', done: 'Course archived.',
      confirm: (c) => ({ title: 'Archive this course?', message: `“${c.title}” will be archived and made Private, so it is no longer in the active or public state. Its content is kept and you can restore it later.`, confirmLabel: 'Archive', danger: true }),
    },
    restore: {
      call: CoursesApi.restore, pending: 'Restoring…', done: 'Course restored to draft.',
      confirm: (c) => ({ title: 'Restore this course?', message: `“${c.title}” will return to Draft (private) so you can edit and re-publish it.`, confirmLabel: 'Restore' }),
    },
  };

  async function runAction(course, name) {
    if (busyRow) return; // one in-flight action at a time: no double submits
    const spec = ACTIONS[name];
    if (!(await Ui.confirm(spec.confirm(course)))) return;

    busyRow = course.id;
    Forms.showAlert(els.alert, spec.pending, 'info');
    setBusy(true);
    try {
      await spec.call(course.id);
      Forms.showAlert(els.alert, spec.done, 'success');
    } catch (err) {
      if (fail(err)) return;
    } finally {
      busyRow = null;
    }
    await load();
  }

  // ---- Filter wiring -------------------------------------------------------
  const reload = () => { state.page = 1; load(); };
  const reloadSearch = Dom.debounce(reload, 350);

  els.search.addEventListener('input', reloadSearch);
  for (const sel of [els.status, els.visibility, els.category, els.instructor, els.sort]) sel.addEventListener('change', reload);
  els.reset.addEventListener('click', () => {
    els.search.value = ''; els.status.value = ''; els.visibility.value = '';
    els.category.value = ''; els.instructor.value = ''; els.sort.value = 'newest';
    reload();
  });
  els.prev.addEventListener('click', () => { if (state.page > 1) { state.page -= 1; load(); } });
  els.next.addEventListener('click', () => { if (state.page < state.totalPages) { state.page += 1; load(); } });

  // ---- Selector data for the filters (from the database, never hardcoded) --
  // Filters use the ADMIN list endpoints (every status), not the course-form
  // "assignable" selectors, which are active-only (Phase 8.1): an admin must
  // still be able to filter the list by a category that was deactivated after
  // courses were created under it. One page of up to 100 each — a filter menu
  // is bounded by how many categories/instructors exist.
  async function loadFilterOptions() {
    try {
      const [cats, inst] = await Promise.all([
        CatalogApi.categories.list({ limit: 100, sort: 'name' }),
        CatalogApi.instructors.list({ limit: 100, sort: 'name' }),
      ]);
      const label = (x) => (x.status === 'ACTIVE' ? x.name : `${x.name} (inactive)`);
      for (const c of cats.items) els.category.appendChild(Dom.el('option', { value: c.id, text: label(c) }));
      for (const i of inst.items) els.instructor.appendChild(Dom.el('option', { value: i.id, text: label(i) }));
    } catch (err) {
      fail(err); // filters simply stay at "All"; the list still works
    }
  }

  await loadFilterOptions();
  await load();
})();
