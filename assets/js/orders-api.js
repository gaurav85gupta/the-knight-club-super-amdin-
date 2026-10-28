/**
 * Order & Payment Management API calls (Phase 20 — Super Admin Order &
 * Payment Management). The ONLY place that knows the admin order URLs;
 * pages call these and never build a path or query string by hand. Uses the
 * shared Api client (cookies, CSRF marker, silent refresh) — no second auth
 * mechanism. Mirrors coupon-api.js exactly.
 *
 * READ-ONLY (spec Step 24-25): every method here is a GET. There is no
 * create/update/action call — this admin surface never mutates a Payment.
 */

const OrderApi = (() => {
  const BASE = '/admin/orders';

  /** Builds ?a=b from ONLY the supported, non-empty parameters. */
  function toQuery(params) {
    const allowed = ['search', 'status', 'course', 'student', 'coupon', 'kind', 'dateFilter', 'dateFrom', 'dateTo', 'sort', 'page', 'limit'];
    const qs = new URLSearchParams();
    for (const key of allowed) {
      const v = params[key];
      if (v !== undefined && v !== null && String(v).trim() !== '') qs.set(key, String(v).trim());
    }
    const s = qs.toString();
    return s ? `?${s}` : '';
  }

  /** Builds ?a=b for the pre-bookings endpoint's own small parameter set. */
  function toPreBookingsQuery(params) {
    const allowed = ['stage', 'page', 'limit'];
    const qs = new URLSearchParams();
    for (const key of allowed) {
      const v = params[key];
      if (v !== undefined && v !== null && String(v).trim() !== '') qs.set(key, String(v).trim());
    }
    const s = qs.toString();
    return s ? `?${s}` : '';
  }

  return {
    list: (params = {}) => Api.get(`${BASE}${toQuery(params)}`),
    get: (id) => Api.get(`${BASE}/${encodeURIComponent(id)}`),
    totals: (params = {}) => Api.get(`${BASE}/totals${toQuery(params)}`),
    courses: () => Api.get(`${BASE}/options/courses`),
    // Phase 3 Part G: staged (pre-booking) orders — a separate, Order-keyed
    // read model. See membershipBooking.service.js#listStagedOrdersForAdmin
    // for why this isn't a `status` value on the main `list` endpoint above.
    preBookings: (params = {}) => Api.get(`${BASE}/pre-bookings${toPreBookingsQuery(params)}`),
  };
})();
