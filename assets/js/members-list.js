/**
 * Membership → Members list (who purchased the 1% Club).
 * Read-only. Data: GET /admin/memberships/members (+ /totals).
 */
(async function initMembersList() {
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
    alert: $('page-alert'), body: $('members-body'), table: $('members-table'), state: $('state-box'),
    pager: $('pager'), info: $('pager-info'), page: $('pager-page'), prev: $('prev-btn'), next: $('next-btn'),
    search: $('f-search'), status: $('f-status'), reset: $('f-reset'), totalsGrid: $('totals-grid'),
  };

  const LIMIT = 20;
  const state = { page: 1, totalPages: 0 };
  let seq = 0;

  const criteria = () => ({ search: els.search.value, status: els.status.value, page: state.page, limit: LIMIT });
  const money = (paise) => `₹${Dom.paiseToRupees(paise || 0)}`;

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
    Forms.showAlert(els.alert, Ui.messageForError(err, 'member'), 'error');
    els.alert.focus();
    return false;
  }

  function statCard(label, value) {
    return Dom.el('div', { class: 'stat-card' }, [
      Dom.el('div', { class: 'stat-label', text: label }),
      Dom.el('div', { class: 'stat-value', text: value }),
    ]);
  }

  async function loadTotals() {
    try {
      const t = await MembersApi.totals();
      Dom.clear(els.totalsGrid);
      els.totalsGrid.appendChild(statCard('Total members', String(t.totalMembers)));
      els.totalsGrid.appendChild(statCard('Paid memberships', String(t.paidOrders)));
      els.totalsGrid.appendChild(statCard('Membership revenue', money(t.totalRevenue)));
      els.totalsGrid.appendChild(statCard('Pending payments', String(t.pendingOrders)));
      els.totalsGrid.hidden = false;
    } catch (err) {
      /* totals are secondary — the list still works without them */
    }
  }

  function statusBadge(status) {
    const label = { PAID: 'Paid', PENDING: 'Pending', FAILED: 'Failed', CANCELLED: 'Cancelled', REFUNDED: 'Refunded' }[status] || status;
    const cls = status === 'PAID' ? 'badge-paid' : status === 'REFUNDED' ? 'badge-refunded' : `badge-payment-${String(status).toLowerCase()}`;
    return Dom.el('span', { class: `badge badge-sm ${cls}`, text: label });
  }

  function studentCell(m) {
    if (m.student.deleted) return Dom.el('span', { class: 'cell-sub', text: 'Deleted student' });
    return Dom.el('div', {}, [
      Dom.el('a', { class: 'cell-title', href: `student-details.html?id=${encodeURIComponent(m.student.id)}`, text: m.student.fullName || m.student.userId }),
      Dom.el('div', { class: 'cell-sub', text: m.student.userId }),
    ]);
  }

  function coursesCell(m) {
    const wrap = Dom.el('div', { class: 'member-courses' });
    if (!m.selectedCourses.length) { wrap.appendChild(Dom.el('span', { class: 'cell-sub', text: '—' })); return wrap; }
    for (const c of m.selectedCourses) wrap.appendChild(Dom.el('span', { class: 'member-course-chip', text: c.title || 'Course' }));
    return wrap;
  }

  function renderRows(items) {
    Dom.clear(els.body);
    for (const m of items) {
      els.body.appendChild(Dom.el('tr', {}, [
        Dom.el('td', {}, [studentCell(m)]),
        Dom.el('td', { 'data-col': 'tertiary' }, [Dom.el('span', { class: 'order-id', text: m.orderNumber })]),
        Dom.el('td', { text: m.plan ? m.plan.name : '—' }),
        Dom.el('td', { 'data-col': 'secondary' }, [coursesCell(m)]),
        Dom.el('td', { text: money(m.amount) }),
        Dom.el('td', {}, [statusBadge(m.status)]),
        Dom.el('td', { 'data-col': 'secondary', text: Dom.formatDate(m.paidAt || m.createdAt) }),
        Dom.el('td', {}, [
          Dom.el('a', { class: 'btn btn-outline btn-sm', href: `member-details.html?id=${encodeURIComponent(m.orderId)}`, text: 'Details' }),
        ]),
      ]));
    }
  }

  async function load() {
    const mine = ++seq;
    Forms.hideAlert(els.alert);
    els.state.hidden = true;
    setBusy(true);
    if (!els.body.firstChild) showState('Loading members…', 'Please wait.');

    try {
      const data = await MembersApi.list(criteria());
      if (mine !== seq) return;

      const { items, pagination } = data;
      state.totalPages = pagination.totalPages;

      if (items.length === 0 && pagination.total > 0 && state.page > 1) {
        state.page = Math.max(1, pagination.totalPages);
        return load();
      }

      renderRows(items);
      els.pager.hidden = pagination.total === 0;
      els.info.textContent = `${pagination.total} record${pagination.total === 1 ? '' : 's'}`;
      els.page.textContent = `Page ${pagination.page} of ${Math.max(1, pagination.totalPages)}`;
      els.prev.disabled = pagination.page <= 1;
      els.next.disabled = pagination.page >= pagination.totalPages;

      if (items.length === 0) {
        const filtered = els.search.value.trim() !== '' || els.status.value !== 'PAID';
        showState('No members found', filtered ? 'Nothing matches these filters. Try changing or resetting them.' : 'Nobody has purchased the 1% Club yet.');
      }
      await loadTotals();
    } catch (err) {
      if (mine !== seq) return;
      Dom.clear(els.body);
      els.pager.hidden = true;
      if (fail(err)) return;
      showState('Could not load members', 'Check your connection and try again.');
    } finally {
      if (mine === seq) setBusy(false);
    }
  }

  const reload = () => { state.page = 1; load(); };
  els.search.addEventListener('input', Dom.debounce(reload, 350));
  els.status.addEventListener('change', reload);
  els.reset.addEventListener('click', () => { els.search.value = ''; els.status.value = 'PAID'; reload(); });
  els.prev.addEventListener('click', () => { if (state.page > 1) { state.page -= 1; load(); } });
  els.next.addEventListener('click', () => { if (state.page < state.totalPages) { state.page += 1; load(); } });

  await load();
})();
