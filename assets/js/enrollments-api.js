/**
 * Super Admin Enrollment Management API calls (Phase 22). The ONLY place
 * that knows the admin enrollment URLs; pages call these and never build a
 * path or query string by hand. Uses the shared Api client (cookies, CSRF
 * marker, silent refresh) — no second auth mechanism. Mirrors
 * orders-api.js.
 *
 * API CONTRACT (backend/src/routes/adminEnrollments.routes.js):
 *   GET /admin/enrollments                  list, server-side search/filter/sort/pagination
 *   GET /admin/enrollments/:id               full enrollment detail (student + course + access)
 *   GET /admin/enrollments/options/courses   course selector for the course filter
 *   GET /admin/enrollments/options/students  student selector for the student filter
 *
 * READ-ONLY: every method here is a GET. There is no create/update/action
 * call — see services/adminEnrollment.service.js for why this admin
 * surface never mutates an Enrollment.
 */

const EnrollmentApi = (() => {
  const BASE = '/admin/enrollments';

  /** Builds ?a=b from ONLY the supported, non-empty parameters. */
  function toQuery(params) {
    const allowed = ['search', 'status', 'course', 'student', 'source', 'dateFilter', 'dateFrom', 'dateTo', 'sort', 'page', 'limit'];
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
    courses: () => Api.get(`${BASE}/options/courses`),
    students: () => Api.get(`${BASE}/options/students`),
  };
})();
