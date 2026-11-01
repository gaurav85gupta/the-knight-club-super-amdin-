/**
 * Super Admin Student Management API calls (Phase 21). The ONLY place that
 * knows the admin student URLs; pages call these and never build a path or
 * query string by hand. Uses the shared Api client (cookies, CSRF marker,
 * silent refresh) — no second auth mechanism. Mirrors orders-api.js.
 *
 * API CONTRACT (backend/src/routes/adminStudents.routes.js):
 *   GET  /admin/students                    list, server-side search/filter/sort/pagination
 *   GET  /admin/students/:id                full student detail (profile + account)
 *   GET  /admin/students/:id/enrollments    enrollment history (Phase 16 data)
 *   GET  /admin/students/:id/orders         purchase history (Phase 20 data, same shape as OrderApi.list)
 *   GET  /admin/students/:id/progress       learning progress (Phase 14 data, per enrolled course)
 *   POST /admin/students/:id/activate       no body
 *   POST /admin/students/:id/suspend        no body
 *   POST /admin/students/:id/reset-password  body: { newPassword }
 *   POST /admin/students/:id/swap-course    body: { fromCourseId, toCourseId, reason? }
 *
 * WRITE ROUTES (activate/suspend/swap-course) go through Api.post, which
 * already sends the CSRF marker on every non-GET request (api.js) — no
 * extra wiring needed here, same as CouponApi.activate/deactivate.
 */

const StudentApi = (() => {
  const BASE = '/admin/students';

  /** Builds ?a=b from ONLY the supported, non-empty parameters. */
  function toQuery(params) {
    const allowed = ['search', 'status', 'hasEnrollment', 'hasPurchase', 'sort', 'page', 'limit'];
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
    enrollments: (id) => Api.get(`${BASE}/${encodeURIComponent(id)}/enrollments`),
    orders: (id) => Api.get(`${BASE}/${encodeURIComponent(id)}/orders`),
    progress: (id) => Api.get(`${BASE}/${encodeURIComponent(id)}/progress`),
    activate: (id) => Api.post(`${BASE}/${encodeURIComponent(id)}/activate`),
    suspend: (id) => Api.post(`${BASE}/${encodeURIComponent(id)}/suspend`),
    resetPassword: (id, newPassword) => Api.post(`${BASE}/${encodeURIComponent(id)}/reset-password`, { newPassword }),
    swapCourse: (id, fromCourseId, toCourseId, reason) =>
      Api.post(`${BASE}/${encodeURIComponent(id)}/swap-course`, {
        fromCourseId,
        toCourseId,
        ...(reason && reason.trim() ? { reason: reason.trim() } : {}),
      }),
  };
})();
