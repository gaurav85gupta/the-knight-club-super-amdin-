/**
 * Order dashboard list page controller (Phase 20 — Super Admin Order &
 * Payment Management). Modeled directly on coupons-list.js.
 *
 * ALL searching, filtering, sorting and paging happens on the SERVER: this
 * file only sends the current criteria and renders the one page it gets
 * back (spec Step 10-14). It never fetches "all orders" to filter in the
 * browser.
 *
 * READ-ONLY (spec Step 24-25): no row action exists here beyond navigating
 * to the details page — no "mark as paid", no status edit.
 *
 * The status shown per row is the REAL Payment.status the backend returns
 * (Ui.paymentStatusBadge) — never inferred client-side from the presence of
 * a Razorpay order ID (spec Step 5, 17-20).
 *
 * RACES: every list/totals request gets a sequence number; a response that
 * is no longer the latest is discarded.
 *
 * SESSION EXPIRY: any 401/403 from an API call goes through
 * Auth.handleSessionError(), which clears state and returns to login.
 */

(async function initOrderList() {
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
    alert: $('page-alert'), body: $('orders-body'), table: $('orders-table'), state: $('state-box'),
    pager: $('pager'), info: $('pager-info'), page: $('pager-page'), prev: $('prev-btn'), next: $('next-btn'),
    search: $('f-search'), status: $('f-status'), kind: $('f-kind'), course: $('f-course'), date: $('f-date'),
    sort: $('f-sort'), reset: $('f-reset'), totalsGrid: $('totals-grid'),
  };

  const LIMIT = 20;
  const state = { page: 1, totalPages: 0 };
  let seq = 0;

  const criteria = () => ({
    search: els.search.value, status: els.status.value, kind: els.kind.value, course: els.course.value,
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
    Forms.showAlert(els.alert, Ui.messageForError(err, 'order'), 'error');
    els.alert.focus();
    return false;
  }

  // ---- Course filter options -------------------------------------------
  async function loadCourseOptions() {
    try {
      const data = await OrderApi.courses();
      for (const c of data.courses) {
        els.course.appendChild(Dom.el('option', { value: c.id, text: c.title }));
      }
    } catch (err) {
      // Non-fatal: the filter dropdown just stays "All courses" only.
    }
  }

  // ---- Totals strip -------------------------------------------------------
  function statCard(label, value) {
    return Dom.el('div', { class: 'stat-card' }, [
      Dom.el('div', { class: 'stat-label', text: label }),
      Dom.el('div', { class: 'stat-value', text: value }),
    ]);
  }

  function money(paise) {
    return `₹${Dom.paiseToRupees(paise || 0)}`;
  }

  async function loadTotals() {
    const mine = seq;
    try {
      const t = await OrderApi.totals(criteria());
      if (mine !== seq) return;
      Dom.clear(els.totalsGrid);
      els.totalsGrid.appendChild(statCard('Total orders', String(t.totalOrders)));
      els.totalsGrid.appendChild(statCard('Paid', String(t.successfulOrders)));
      els.totalsGrid.appendChild(statCard('Pending', String(t.pendingOrders)));
      els.totalsGrid.appendChild(statCard('Failed', String(t.failedOrders)));
      els.totalsGrid.appendChild(statCard('Paid value', money(t.paidValue)));
      els.totalsGrid.hidden = false;
    } catch (err) {
      // Non-fatal: the table itself is the source of truth; totals are a
      // convenience strip. A failure here does not block the list.
    }
  }

  // ---- Formatting helpers ---------------------------------------------------
  function formatAmount(o) {
    const box = Dom.el('div', {}, [
      Dom.el('div', { class: 'order-amount order-amount-final', text: money(o.finalAmount) }),
    ]);
    if (o.discountAmount > 0) {
      box.appendChild(Dom.el('div', { class: 'order-amount-discount', text: `${money(o.originalAmount)} − ${money(o.discountAmount)}` }));
    }
    return box;
  }

  function formatStudent(o) {
    if (!o.student) return Dom.el('span', { class: 'cell-sub', text: 'Deleted student' });
    return Dom.el('div', {}, [
      Dom.el('div', { class: 'cell-title', text: o.student.fullName || o.student.userId }),
      Dom.el('div', { class: 'cell-sub', text: o.student.userId }),
    ]);
  }

  function formatCourse(o) {
    if (o.kind === 'MEMBERSHIP') {
      return Dom.el('span', { text: o.membershipPlan ? `${o.membershipPlan.name} (courses of choice)` : '1% Club membership' });
    }
    if (o.course) return Dom.el('span', { text: o.course.title });
    if (Array.isArray(o.courses) && o.courses.length) return Dom.el('span', { text: o.courses.map((c) => c.title).join(', ') });
    return Dom.el('span', { class: 'cell-sub', text: 'Deleted course' });
  }

  function formatOrderId(o) {
    const box = Dom.el('div', {}, [Dom.el('span', { class: 'order-id', text: o.id })]);
    if (o.orderNumber) box.appendChild(Dom.el('div', { class: 'cell-sub', text: o.orderNumber }));
    return box;
  }

  // ---- Row rendering (textContent only) -----------------------------------
  function renderRows(items) {
    Dom.clear(els.body);
    for (const o of items) {
      els.body.appendChild(Dom.el('tr', {}, [
        Dom.el('td', {}, [formatOrderId(o)]),
        Dom.el('td', { 'data-col': 'tertiary' }, [Ui.kindBadge(o.kind)]),
        Dom.el('td', {}, [formatStudent(o)]),
        Dom.el('td', { 'data-col': 'secondary' }, [formatCourse(o)]),
        Dom.el('td', {}, [formatAmount(o)]),
        Dom.el('td', { 'data-col': 'secondary', text: o.couponCode || '—' }),
        Dom.el('td', {}, [Ui.paymentStatusBadge(o.status)]),
        Dom.el('td', { 'data-col': 'secondary', text: Dom.formatDate(o.createdAt) }),
        Dom.el('td', {}, [
          Dom.el('a', { class: 'btn btn-outline btn-sm', href: `order-details.html?id=${encodeURIComponent(o.id)}`, text: 'Details' }),
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
    if (!els.body.firstChild) showState('Loading orders…', 'Please wait.');

    try {
      const data = await OrderApi.list(criteria());
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
      els.info.textContent = `${pagination.total} order${pagination.total === 1 ? '' : 's'}`;
      els.page.textContent = `Page ${pagination.page} of ${Math.max(1, pagination.totalPages)}`;
      els.prev.disabled = pagination.page <= 1;
      els.next.disabled = pagination.page >= pagination.totalPages;

      if (items.length === 0) {
        const filtered = Object.entries(criteria()).some(([k, v]) => !['sort', 'page', 'limit'].includes(k) && String(v).trim() !== '');
        showState('No orders found', filtered ? 'No order matches these filters. Try changing or resetting them.' : 'No orders have been placed yet.');
      } else {
        els.state.hidden = true;
      }

      await loadTotals();
    } catch (err) {
      if (mine !== seq) return;
      Dom.clear(els.body);
      els.pager.hidden = true;
      if (fail(err)) return;
      showState('Could not load orders', 'Check your connection and try again.');
    } finally {
      if (mine === seq) setBusy(false);
    }
  }

  // ---- Filter wiring -------------------------------------------------------
  const reload = () => { state.page = 1; load(); };
  const reloadSearch = Dom.debounce(reload, 350);

  els.search.addEventListener('input', reloadSearch);
  for (const sel of [els.status, els.kind, els.course, els.date, els.sort]) sel.addEventListener('change', reload);
  els.reset.addEventListener('click', () => {
    els.search.value = ''; els.status.value = ''; els.kind.value = ''; els.course.value = '';
    els.date.value = ''; els.sort.value = 'newest';
    reload();
  });
  els.prev.addEventListener('click', () => { if (state.page > 1) { state.page -= 1; load(); } });
  els.next.addEventListener('click', () => { if (state.page < state.totalPages) { state.page += 1; load(); } });

  // ===========================================================================
  // Phase 3 Part G — Pre-Bookings panel
  // Separate, Order-keyed state from the Payment-keyed table above. Its own
  // criteria/page/load — does not share `state`/`seq`/`criteria()` with the
  // main table so the two panels' requests never race each other.
  // ===========================================================================
  const pb = {
    alert: els.alert, // reuses the page's one alert banner
    body: $('pb-admin-body'), table: $('pb-admin-table'), state: $('pb-admin-state'),
    pager: $('pb-admin-pager'), info: $('pb-admin-pager-info'), page: $('pb-admin-pager-page'),
    prev: $('pb-admin-prev'), next: $('pb-admin-next'), stage: $('pb-admin-stage'),
  };

  // Only render the panel's own controls if they exist on this page — keeps
  // this file safe to load on any page that happens to include it.
  if (pb.body) {
    const PB_LIMIT = 20;
    const pbState = { page: 1, totalPages: 0 };
    let pbSeq = 0;

    const pbCriteria = () => ({ stage: pb.stage.value, page: pbState.page, limit: PB_LIMIT });

    function pbShowState(title, text) {
      Dom.clear(pb.state);
      pb.state.appendChild(Dom.el('h3', { text: title }));
      pb.state.appendChild(Dom.el('p', { text }));
      pb.state.hidden = false;
    }

    function pbSetBusy(isBusy) {
      pb.table.classList.toggle('is-loading', isBusy);
      pb.table.setAttribute('aria-busy', String(isBusy));
    }

    function pbMoney(paise) {
      return typeof paise === 'number' ? `₹${Dom.paiseToRupees(paise)}` : '—';
    }

    function pbFormatStudent(o) {
      if (!o.student) return Dom.el('span', { class: 'cell-sub', text: 'Deleted student' });
      return Dom.el('div', {}, [
        Dom.el('div', { class: 'cell-title', text: o.student.fullName || o.student.userId }),
        Dom.el('div', { class: 'cell-sub', text: o.student.userId }),
      ]);
    }

    function pbFormatOrderId(o) {
      const idClass = o.requiresSupportReview ? 'order-id order-id-flagged' : 'order-id';
      const box = Dom.el('div', {}, [Dom.el('span', { class: idClass, text: o.orderId })]);
      if (o.orderNumber) box.appendChild(Dom.el('div', { class: 'cell-sub', text: o.orderNumber }));
      return box;
    }

    function pbRenderRows(items) {
      Dom.clear(pb.body);
      for (const o of items) {
        const row = [
          Dom.el('td', {}, [pbFormatOrderId(o)]),
          Dom.el('td', {}, [pbFormatStudent(o)]),
          Dom.el('td', {}, [
            o.integrityIssue
              ? Dom.el('span', { class: 'badge badge-sm badge-payment-failed', text: 'Needs review' })
              : Ui.stageBadge(o.purchaseStage),
          ]),
          Dom.el('td', {}, [Dom.el('span', { text: o.integrityIssue ? '—' : `${pbMoney(o.verifiedCapturedTotal)} / ${pbMoney(o.membershipPrice)}` })]),
          Dom.el('td', { 'data-col': 'secondary' }, [Dom.el('span', { text: o.integrityIssue ? '—' : pbMoney(o.remainingBalance) })]),
          Dom.el('td', { 'data-col': 'secondary', text: Dom.formatDate(o.createdAt) }),
          Dom.el('td', {}, [
            Dom.el('a', { class: 'btn btn-outline btn-sm', href: `order-details.html?id=${encodeURIComponent(o.orderId)}`, text: 'Details' }),
          ]),
        ];
        pb.body.appendChild(Dom.el('tr', {}, row));
      }
    }

    async function pbLoad() {
      const mine = ++pbSeq;
      pb.state.hidden = true;
      pbSetBusy(true);
      if (!pb.body.firstChild) pbShowState('Loading pre-bookings…', 'Please wait.');

      try {
        const data = await OrderApi.preBookings(pbCriteria());
        if (mine !== pbSeq) return;

        const { items, pagination } = data;
        pbState.totalPages = pagination.totalPages;

        if (items.length === 0 && pagination.total > 0 && pbState.page > 1) {
          pbState.page = Math.max(1, pagination.totalPages);
          return pbLoad();
        }

        pbRenderRows(items);
        pb.pager.hidden = pagination.total === 0;
        pb.info.textContent = `${pagination.total} booking${pagination.total === 1 ? '' : 's'}`;
        pb.page.textContent = `Page ${pagination.page} of ${Math.max(1, pagination.totalPages)}`;
        pb.prev.disabled = pagination.page <= 1;
        pb.next.disabled = pagination.page >= pagination.totalPages;

        if (items.length === 0) {
          pbShowState('No pre-bookings found', pb.stage.value ? 'No booking matches this stage filter.' : 'No one has started a 1% Club pre-booking yet.');
        } else {
          pb.state.hidden = true;
        }
      } catch (err) {
        if (mine !== pbSeq) return;
        Dom.clear(pb.body);
        pb.pager.hidden = true;
        if (Auth.handleSessionError(err)) return;
        Forms.showAlert(pb.alert, Ui.messageForError(err, 'pre-booking'), 'error');
        pbShowState('Could not load pre-bookings', 'Check your connection and try again.');
      } finally {
        if (mine === pbSeq) pbSetBusy(false);
      }
    }

    pb.stage.addEventListener('change', () => { pbState.page = 1; pbLoad(); });
    pb.prev.addEventListener('click', () => { if (pbState.page > 1) { pbState.page -= 1; pbLoad(); } });
    pb.next.addEventListener('click', () => { if (pbState.page < pbState.totalPages) { pbState.page += 1; pbLoad(); } });

    await pbLoad();
  }

  await loadCourseOptions();
  await load();
})();
