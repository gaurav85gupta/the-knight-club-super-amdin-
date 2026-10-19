/**
 * Coupon details page controller (Phase 19 — spec Step 13-15).
 *
 * Two independent GETs: the coupon itself (config + derived effectiveState)
 * and its usage statistics (computed fresh from CouponRedemption on the
 * server — see coupon.service.js#getCouponUsage). Nothing on this page is
 * computed client-side from cached rows; both requests hit the database
 * every time the page loads.
 */

(async function initCouponDetails() {
  const admin = await Auth.requireAuth();
  document.documentElement.classList.remove('auth-pending');
  document.getElementById('admin-identity').textContent = admin.name;

  const $ = (id) => document.getElementById(id);
  const alertEl = $('page-alert');
  const loadState = $('load-state');
  const content = $('content');

  $('logout-btn').addEventListener('click', async () => {
    $('logout-btn').disabled = true;
    await Auth.logout();
    window.location.replace(Auth.urlFor(Auth.PATHS.login));
  });

  const couponId = new URLSearchParams(window.location.search).get('id');

  // Copy code (spec Step 7, 41): copies exactly the code currently
  // rendered in d-code — never a stale value, since renderCoupon() sets
  // it fresh from the just-fetched coupon before this button is usable.
  $('copy-code-btn').addEventListener('click', async () => {
    const btn = $('copy-code-btn');
    const code = $('d-code').textContent;
    if (!code) return;
    const ok = await Ui.copyToClipboard(code);
    const label = btn.textContent;
    btn.textContent = ok ? 'Copied!' : 'Copy failed';
    btn.disabled = true;
    setTimeout(() => { btn.textContent = label; btn.disabled = false; }, 1500);
  });

  function showLoad(title, text) {
    Dom.clear(loadState);
    loadState.appendChild(Dom.el('h3', { text: title }));
    loadState.appendChild(Dom.el('p', { text }));
    loadState.hidden = false;
  }

  function money(paise) {
    return paise == null ? '—' : `₹${Dom.paiseToRupees(paise)}`;
  }

  function renderCoupon(c) {
    $('page-title').textContent = c.code;
    document.title = `${c.code} — The Knight Club Super Admin`;
    $('edit-link').href = `coupon-form.html?id=${encodeURIComponent(c.id)}`;

    $('d-code').textContent = c.code;
    Dom.clear($('d-state')); $('d-state').appendChild(Ui.couponStateBadge(c.effectiveState));
    $('d-discount').textContent = c.discountType === 'PERCENTAGE'
      ? `${c.percentage}% off${c.maxDiscountAmount ? `, capped at ${money(c.maxDiscountAmount)}` : ''}`
      : `${money(c.fixedAmount)} off`;
    $('d-min-order').textContent = c.minOrderAmount ? money(c.minOrderAmount) : 'None';
    $('d-start').textContent = c.startAt ? Dom.formatDate(c.startAt) : 'No start restriction';
    $('d-end').textContent = c.endAt ? Dom.formatDate(c.endAt) : 'No end date';
    $('d-usage-limit').textContent = typeof c.usageLimit === 'number' ? String(c.usageLimit) : 'Unlimited';
    $('d-per-user-limit').textContent = typeof c.perUserLimit === 'number' ? String(c.perUserLimit) : 'Unlimited';
    $('d-courses').textContent = Array.isArray(c.courses) && c.courses.length > 0 ? `${c.courses.length} specific course${c.courses.length === 1 ? '' : 's'}` : 'Global — any course';
    $('d-description').textContent = c.description || '—';
    $('d-created').textContent = Dom.formatDate(c.createdAt);
    $('d-updated').textContent = Dom.formatDate(c.updatedAt);
  }

  function statCard(label, value, sub) {
    return Dom.el('div', { class: 'stat-card' }, [
      Dom.el('div', { class: 'stat-label', text: label }),
      Dom.el('div', { class: 'stat-value', text: value }),
      sub ? Dom.el('div', { class: 'stat-sub', text: sub }) : null,
    ]);
  }

  function renderUsage(u) {
    const grid = $('stat-grid');
    Dom.clear(grid);
    grid.appendChild(statCard('Total redemptions', String(u.totalRedemptions)));
    grid.appendChild(statCard('Unique students', String(u.uniqueUsers)));
    grid.appendChild(statCard('Remaining uses', typeof u.remainingUsage === 'number' ? String(u.remainingUsage) : 'Unlimited'));
    grid.appendChild(statCard('Per-student limit', typeof u.perUserLimit === 'number' ? String(u.perUserLimit) : 'Unlimited'));
    grid.hidden = false;

    if (typeof u.usageLimit === 'number' && u.usageLimit > 0) {
      $('usage-progress-card').hidden = false;
      const pct = Math.min(100, u.usagePercentage ?? 0);
      $('usage-progress-label').textContent = `${u.usedCount} / ${u.usageLimit} (${pct}%)`;
      const fill = $('usage-bar-fill');
      fill.style.width = `${pct}%`;
      fill.classList.toggle('is-full', u.usedCount >= u.usageLimit);
    }

    if (u.byCourse && u.byCourse.length > 0) {
      $('by-course-card').hidden = false;
      const body = $('by-course-body');
      Dom.clear(body);
      for (const row of u.byCourse) {
        body.appendChild(Dom.el('tr', {}, [
          Dom.el('td', { text: row.title || (row.courseId ? `Course ${row.courseId}` : 'Unknown course') }),
          Dom.el('td', { text: String(row.redemptions) }),
          Dom.el('td', { text: money(row.totalDiscount) }),
        ]));
      }
    }
  }

  function fail(err) {
    if (Auth.handleSessionError(err)) return true;
    Forms.showAlert(alertEl, Ui.messageForError(err, 'coupon'), 'error');
    alertEl.focus();
    return false;
  }

  if (!couponId) {
    showLoad('No coupon specified', 'Open a coupon from the Coupons list to see its details.');
    return;
  }

  showLoad('Loading…', 'Please wait.');
  try {
    const [couponData, usageData] = await Promise.all([CouponApi.get(couponId), CouponApi.usage(couponId)]);
    renderCoupon(couponData.coupon);
    renderUsage(usageData);
    loadState.hidden = true;
    content.hidden = false;
  } catch (err) {
    if (fail(err)) return;
    const notFound = err instanceof ApiError && (err.status === 404 || err.status === 400);
    showLoad(notFound ? 'Coupon not found' : 'Could not load this coupon', notFound ? 'This coupon does not exist or was removed.' : 'Check your connection and try again.');
  }
})();
