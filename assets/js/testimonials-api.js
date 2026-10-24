/**
 * Testimonial-management API calls (Phase 7). The ONLY place that knows the
 * admin testimonial URLs; pages call these and never build a path by hand.
 * Uses the shared Api client (cookies, CSRF marker, silent refresh) — no
 * second auth mechanism, same discipline as courses-api.js.
 *
 * Endpoints (backend/src/routes/adminTestimonials.routes.js):
 *   GET    /admin/testimonials
 *   POST   /admin/testimonials
 *   GET    /admin/testimonials/:id
 *   PATCH  /admin/testimonials/:id
 *   POST   /admin/testimonials/:id/publish
 *   POST   /admin/testimonials/:id/archive
 *   POST   /admin/testimonials/:id/republish
 *   POST   /admin/testimonials/:id/change-type
 *
 * PHOTO UPLOAD: there is no dedicated testimonial-photo upload endpoint.
 * This reuses the EXISTING generic Bunny Storage Zone image uploader at
 * POST /admin/courses/thumbnail (see courses-api.js#uploadThumbnail for the
 * original pattern). That endpoint only validates/stores an image and
 * returns a bare CDN URL — it has no dependency on Course data — so reusing
 * it here is "use an existing upload endpoint", not a new media-upload
 * architecture.
 */

const TestimonialsApi = (() => {
  const BASE = '/admin/testimonials';

  /** Builds ?a=b from ONLY the supported, non-empty parameters. */
  function toQuery(params) {
    const allowed = ['search', 'status', 'type', 'featured', 'course', 'sort', 'page', 'limit'];
    const qs = new URLSearchParams();
    for (const key of allowed) {
      const v = params[key];
      if (v !== undefined && v !== null && String(v).trim() !== '') qs.set(key, String(v).trim());
    }
    const s = qs.toString();
    return s ? `?${s}` : '';
  }

  const action = (id, name) => Api.post(`${BASE}/${encodeURIComponent(id)}/${name}`);

  /**
   * Uploads a testimonial photo via the existing course-thumbnail Bunny
   * Storage Zone endpoint (see file header). Sends raw bytes directly — no
   * multipart — with Content-Type set to the image MIME type and fileName
   * in the query string. Returns { cdnUrl }.
   *
   * @param {File} file
   * @param {string} [previousUrl] prior Bunny-hosted CDN URL being
   *   replaced, if any — passed through for best-effort cleanup. A plain
   *   admin-entered reference URL is safely ignored server-side rather than
   *   deleted.
   */
  async function uploadPhoto(file, previousUrl) {
    const apiBase = (typeof CONFIG !== 'undefined' && CONFIG.API_BASE_URL) ? CONFIG.API_BASE_URL : '/api/v1';
    const qs = new URLSearchParams({ fileName: file.name });
    if (previousUrl) qs.set('previousUrl', previousUrl);
    const url = `${apiBase}/admin/courses/thumbnail?${qs.toString()}`;

    async function doFetch() {
      return fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: file,
        credentials: 'include',
        cache: 'no-store',
      });
    }

    let res = await doFetch();
    if (res.status === 401) {
      await Api.refreshOnce().catch(() => {});
      res = await doFetch();
    }

    const body = await res.json().catch(() => null);
    if (!res.ok || !body || !body.success) {
      const msg = (body && body.message) || 'Photo upload failed.';
      const err = new Error(msg);
      err.status = res.status;
      err.fieldErrors = (body && body.errors) || null;
      throw err;
    }
    return body.data;
  }

  return {
    list: (params = {}) => Api.get(`${BASE}${toQuery(params)}`),
    get: (id) => Api.get(`${BASE}/${encodeURIComponent(id)}`),
    create: (body) => Api.post(BASE, body),
    update: (id, body) => Api.patch(`${BASE}/${encodeURIComponent(id)}`, body),
    publish: (id) => action(id, 'publish'),
    archive: (id) => action(id, 'archive'),
    republish: (id) => action(id, 'republish'),
    changeType: (id, body) => Api.post(`${BASE}/${encodeURIComponent(id)}/change-type`, body),
    uploadPhoto,

    /**
     * Honest global status counts (spec 5B): the list endpoint has no
     * dedicated totals/analytics route, so this makes 4 cheap filtered
     * requests (limit=1) and reads ONLY pagination.total from each — never
     * guesses a global count from the current page.
     */
    async summaryCounts() {
      const [all, draft, published, archived] = await Promise.all([
        Api.get(`${BASE}${toQuery({ limit: 1, page: 1 })}`),
        Api.get(`${BASE}${toQuery({ limit: 1, page: 1, status: 'DRAFT' })}`),
        Api.get(`${BASE}${toQuery({ limit: 1, page: 1, status: 'PUBLISHED' })}`),
        Api.get(`${BASE}${toQuery({ limit: 1, page: 1, status: 'ARCHIVED' })}`),
      ]);
      return {
        total: all.pagination.total,
        draft: draft.pagination.total,
        published: published.pagination.total,
        archived: archived.pagination.total,
      };
    },
  };
})();
