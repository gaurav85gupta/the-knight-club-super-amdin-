/**
 * Coupon dashboard list page controller (Phase 19 — Super Admin Coupon
 * Management). Modeled directly on courses-list.js.
 *
 * ALL searching, filtering, sorting and paging happens on the SERVER: this
 * file only sends the current criteria and renders the one page it gets
 * back (spec Step 16-19). It never fetches "all coupons" to filter in the
 * browser.
 *
 * The "state" shown per row is the SERVER-DERIVED `effectiveState`
 * (coupon.service.js#computeEffectiveState) — never recomputed here from
 * raw dates/usage, so the dashboard can never disagree with the backend
 * about whether a coupon is currently usable (spec Step 4: "do not confuse
 * database active=false with date expired" — both facts are already
 * resolved into one state by the server).
 *
 * RACES: every list request gets a sequence number; a response that is no
 * longer the latest is discarded.
 *
 * SESSION EXPIRY: any 401/403 from an API call goes through
 * Auth.handleSessionError(), which clears state and returns to login.
 */

(async function initCouponList() {
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
    alert: $('page-alert'), body: $('coupons-body'), table: $('coupons-table'), state: $('state-box'),
    pager: $('pager'), info: $('pager-info'), page: $('pager-page'), prev: $('prev-btn'), next: $('next-btn'),
    search: $('f-search'), status: $('f-status'), discountType: $('f-discount-type'), scope: $('f-scope'),
    sort: $('f-sort'), reset: $('f-reset'),
  };

  const LIMIT = 20;
  const state = { page: 1, totalPages: 0 };
  let seq = 0;
  let busyRow = null; // id of the row whose action is in flight

  const criteria = () => ({
    search: els.search.value, status: els.status.value, discountType: els.discountType.value,
    scope: els.scope.value, sort: els.sort.value, page: state.page, limit: LIMIT,
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
    Forms.showAlert(els.alert, Ui.messageForError(err, 'coupon'), 'error');
    els.alert.focus();
    return false;
  }

  // ---- Formatting helpers ---------------------------------------------------
  function formatDiscount(c) {
    if (c.discountType === 'PERCENTAGE') {
      const cap = typeof c.maxDiscountAmount === 'number' ? ` (max ₹${Dom.paiseToRupees(c.maxDiscountAmount).split('.')[0]})` : '';
      return `${c.percentage}%${cap}`;
    }
    return `₹${Dom.paiseToRupees(c.fixedAmount).split('.')[0]}`;
  }

  function formatUsage(c) {
    const limit = typeof c.usageLimit === 'number' ? String(c.usageLimit) : '∞';
    return `${c.usedCount} / ${limit}`;
  }

  function formatDateRange(c) {
    if (!c.startAt && !c.endAt) return 'No limit';
    const from = c.startAt ? Dom.formatDate(c.startAt) : '—';
    const to = c.endAt ? Dom.formatDate(c.endAt) : '—';
    return `${from} → ${to}`;
  }

  function formatScope(c) {
    return Array.isArray(c.courses) && c.courses.length > 0 ? `${c.courses.length} course${c.courses.length === 1 ? '' : 's'}` : 'Global';
  }

  // ---- Row rendering (textContent only) -----------------------------------
  function actionButton(label, handler, { danger = false } = {}) {
    return Dom.el('button', { type: 'button', class: `btn btn-sm ${danger ? 'btn-danger' : 'btn-outline'}`, text: label, onclick: handler });
  }

  function rowActions(c) {
    const box = Dom.el('div', { class: 'table-actions' }, [
      Dom.el('a', { class: 'btn btn-outline btn-sm', href: `coupon-details.html?id=${encodeURIComponent(c.id)}`, text: 'Details' }),
      Dom.el('a', { class: 'btn btn-outline btn-sm', href: `coupon-form.html?id=${encodeURIComponent(c.id)}`, text: 'Edit' }),
    ]);
    if (c.status === 'ACTIVE') box.appendChild(actionButton('Disable', () => runAction(c, 'deactivate'), { danger: true }));
    else box.appendChild(actionButton('Enable', () => runAction(c, 'activate')));
    if (c.status !== 'INACTIVE') box.appendChild(actionButton('Archive', () => runAction(c, 'archive'), { danger: true }));
    return box;
  }

  // Copy code (spec Step 7, 41): same clipboard helper the details page
  // uses. Each row's button copies exactly that row's own code — closed
  // over per-row, never re-read from the DOM at click time.
  function copyCodeButton(code) {
    const btn = Dom.el('button', { type: 'button', class: 'btn btn-outline btn-sm coupon-copy-btn', text: 'Copy' });
    btn.addEventListener('click', async () => {
      const ok = await Ui.copyToClipboard(code);
      btn.textContent = ok ? 'Copied!' : 'Copy failed';
      btn.disabled = true;
      setTimeout(() => { btn.textContent = 'Copy'; btn.disabled = false; }, 1500);
    });
    return btn;
  }

  function renderRows(items) {
    Dom.clear(els.body);
    for (const c of items) {
      els.body.appendChild(Dom.el('tr', {}, [
        Dom.el('td', {}, [
          Dom.el('div', { class: 'cell-title coupon-code-row' }, [
            Dom.el('span', { class: 'coupon-code', text: c.code }),
            copyCodeButton(c.code),
          ]),
          c.description ? Dom.el('div', { class: 'cell-sub', text: c.description }) : null,
        ]),
        Dom.el('td', { class: 'coupon-discount', text: formatDiscount(c) }),
        Dom.el('td', {}, [Ui.couponStateBadge(c.effectiveState)]),
        Dom.el('td', { 'data-col': 'tertiary', text: formatUsage(c) }),
        Dom.el('td', { 'data-col': 'secondary', text: formatDateRange(c) }),
        Dom.el('td', { 'data-col': 'secondary', text: formatScope(c) }),
        Dom.el('td', { 'data-col': 'secondary', text: Dom.formatDate(c.createdAt) }),
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
    if (!els.body.firstChild) showState('Loading coupons…', 'Please wait.');

    try {
      const data = await CouponApi.list(criteria());
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
      els.info.textContent = `${pagination.total} coupon${pagination.total === 1 ? '' : 's'}`;
      els.page.textContent = `Page ${pagination.page} of ${Math.max(1, pagination.totalPages)}`;
      els.prev.disabled = pagination.page <= 1;
      els.next.disabled = pagination.page >= pagination.totalPages;

      if (items.length === 0) {
        const filtered = Object.entries(criteria()).some(([k, v]) => !['sort', 'page', 'limit'].includes(k) && String(v).trim() !== '');
        showState('No coupons found', filtered ? 'No coupon matches these filters. Try changing or resetting them.' : 'You have not created any coupons yet. Use “New coupon” to add one.');
      } else {
        els.state.hidden = true;
      }
    } catch (err) {
      if (mine !== seq) return;
      Dom.clear(els.body);
      els.pager.hidden = true;
      if (fail(err)) return;
      showState('Could not load coupons', 'Check your connection and try again.');
    } finally {
      if (mine === seq) setBusy(false);
    }
  }

  // ---- Row actions (activate / deactivate / archive) -----------------------
  const ACTIONS = {
    activate: {
      call: CouponApi.activate, pending: 'Enabling…', done: (c) => `“${c.code}” enabled.`,
      confirm: (c) => ({ title: 'Enable this coupon?', message: `“${c.code}” will become usable at checkout again (subject to its dates and usage limits).`, confirmLabel: 'Enable' }),
    },
    deactivate: {
      call: CouponApi.deactivate, pending: 'Disabling…', done: (c) => `“${c.code}” disabled.`,
      confirm: (c) => ({ title: 'Disable this coupon?', message: `“${c.code}” will stop working at checkout immediately. Purchases already made with it are not affected. You can enable it again at any time.`, confirmLabel: 'Disable', danger: true }),
    },
    archive: {
      call: CouponApi.archive, pending: 'Archiving…', done: (c) => `“${c.code}” archived.`,
      confirm: (c) => ({ title: 'Archive this coupon?', message: `“${c.code}” will be archived and can no longer be applied at checkout. Its history and any past purchases made with it are kept exactly as they were.`, confirmLabel: 'Archive', danger: true }),
    },
  };

  async function runAction(coupon, name) {
    if (busyRow) return; // one in-flight action at a time: no double submits
    const spec = ACTIONS[name];
    if (!(await Ui.confirm(spec.confirm(coupon)))) return;

    busyRow = coupon.id;
    Forms.showAlert(els.alert, spec.pending, 'info');
    setBusy(true);
    try {
      const data = await spec.call(coupon.id);
      Forms.showAlert(els.alert, spec.done(data.coupon), 'success');
    } catch (err) {
      if (fail(err)) return;
      if (err instanceof ApiError && err.status === 404) await load(); // stale row: refresh so it disappears
      return;
    } finally {
      busyRow = null;
    }
    await load();
  }

  // ---- Filter wiring -------------------------------------------------------
  const reload = () => { state.page = 1; load(); };
  const reloadSearch = Dom.debounce(reload, 350);

  els.search.addEventListener('input', reloadSearch);
  for (const sel of [els.status, els.discountType, els.scope, els.sort]) sel.addEventListener('change', reload);
  els.reset.addEventListener('click', () => {
    els.search.value = ''; els.status.value = ''; els.discountType.value = '';
    els.scope.value = ''; els.sort.value = 'newest';
    reload();
  });
  els.prev.addEventListener('click', () => { if (state.page > 1) { state.page -= 1; load(); } });
  els.next.addEventListener('click', () => { if (state.page < state.totalPages) { state.page += 1; load(); } });

  await load();
})();
