/**
 * Super Admin — Membership Plan API client (Phase 38).
 *
 * THE ONLY place that knows the admin membership URLs. Pages call this
 * module and never build a path or query by hand. Uses the shared Api client
 * (cookies, CSRF marker, silent session refresh) — no second auth mechanism.
 *
 * Endpoints:
 *   GET    /admin/memberships              — list all plans
 *   GET    /admin/memberships/:id          — get one plan (with populated courses)
 *   POST   /admin/memberships              — create a new plan (starts INACTIVE)
 *   PATCH  /admin/memberships/:id          — update plan fields (NOT status)
 *   POST   /admin/memberships/:id/activate    — activate
 *   POST   /admin/memberships/:id/deactivate  — deactivate
 *
 * The GET /admin/courses endpoint is also exposed here so the membership
 * page can load the full course list for the eligible-courses picker.
 * All course data comes from the existing admin courses API — no duplication.
 */

const MembershipApi = (() => {
  const BASE = '/admin/memberships';

  function one(id) {
    return `${BASE}/${encodeURIComponent(id)}`;
  }

  /**
   * List all membership plans.
   * @returns {Promise<{items: object[], total: number}>}
   */
  function listPlans() {
    return Api.get(BASE);
  }

  /**
   * Get one membership plan by id, with eligibleCoursesDetail populated.
   * @param {string} id  plan ObjectId
   * @returns {Promise<object>}
   */
  function getPlan(id) {
    return Api.get(one(id));
  }

  /**
   * Create a new membership plan (starts INACTIVE).
   * @param {object} body  validated plan fields
   * @returns {Promise<object>}
   */
  function createPlan(body) {
    return Api.post(BASE, body);
  }

  /**
   * Update plan fields (name, price, selectionLimit, eligibleCourseIds,
   * benefits, description, etc.). Does NOT change status.
   * @param {string} id
   * @param {object} body  only fields that changed
   * @returns {Promise<object>}
   */
  function updatePlan(id, body) {
    return Api.patch(one(id), body);
  }

  /**
   * Activate the plan. Backend validates selectionLimit, courses, price.
   * @param {string} id
   * @returns {Promise<object>}
   */
  function activatePlan(id) {
    return Api.post(`${one(id)}/activate`);
  }

  /**
   * Deactivate the plan. Does NOT delete orders, meta, or enrollments.
   * @param {string} id
   * @returns {Promise<object>}
   */
  function deactivatePlan(id) {
    return Api.post(`${one(id)}/deactivate`);
  }

  /**
   * Get the plan's pre-booking configuration.
   * @param {string} id
   * @returns {Promise<{planId, planName, currency, membershipPrice, enabled,
   *   amount, remainingAmount, usable, issue}>}
   */
  function getPreBooking(id) {
    return Api.get(`${one(id)}/pre-booking`);
  }

  /**
   * Update the plan's pre-booking configuration. Only `enabled` and/or
   * `amount` may be sent — the backend rejects any other field.
   * @param {string} id
   * @param {{enabled?: boolean, amount?: number|null}} body  amount in paise
   * @returns {Promise<object>}
   */
  function updatePreBooking(id, body) {
    return Api.patch(`${one(id)}/pre-booking`, body);
  }

  /**
   * Load all courses for the eligible-courses picker.
   * Uses the existing admin courses listing — limit=200, status=PUBLISHED.
   * Falls back to status=ALL if the query returns 0 results.
   * @returns {Promise<{id, title, slug, status}[]>}
   */
  async function loadAllCourses() {
    // Phase 6+ courses list — published first, then all
    let data = await Api.get('/admin/courses?limit=500&status=PUBLISHED');
    let items = (data && data.items) || [];

    // Also fetch DRAFT courses so admin can pre-populate before publishing
    if (items.length < 500) {
      try {
        const draft = await Api.get('/admin/courses?limit=500&status=DRAFT');
        const draftItems = (draft && draft.items) || [];
        // Merge, avoiding duplicates
        const seen = new Set(items.map((c) => c.id));
        for (const c of draftItems) {
          if (!seen.has(c.id)) items.push(c);
        }
      } catch {
        // Non-fatal: published courses are enough
      }
    }

    return items;
  }

  // ---------------------------------------------------------------------------
  // Phase 39: Content & Media API methods
  // ---------------------------------------------------------------------------

  /**
   * Update plain-text content fields for the public 1% Club page.
   * @param {string} id  plan ObjectId
   * @param {{ section2Heading?: string, section2Description?: string }} fields
   */
  function updateContent(id, fields) {
    return Api.patch(`${one(id)}/content`, fields);
  }

  /**
   * Upload an image to a predefined slot via raw binary body.
   * Sends the file bytes directly (no multipart) with Content-Type set to
   * the image MIME type and fileName in the query string.
   *
   * @param {string} id    plan ObjectId
   * @param {string} slot  e.g. 'founderImage'
   * @param {File} file    browser File object
   * @returns {Promise<{ cdnUrl: string, adminMedia: object }>}
   */
  async function uploadImage(id, slot, file) {
    // Raw binary upload — Content-Type is the image MIME, not application/json.
    // We cannot use Api.request() here because that always sets Content-Type: application/json
    // and serialises the body as JSON. Instead we use fetch() directly.
    const apiBase = (typeof CONFIG !== 'undefined' && CONFIG.API_BASE_URL) ? CONFIG.API_BASE_URL : '/api/v1';
    const url = `${apiBase}${one(id)}/media/images/${encodeURIComponent(slot)}?fileName=${encodeURIComponent(file.name)}`;

    // Attempt the request, retrying once after a session refresh on 401.
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

    // Session refresh on 401 (mirrors Api.request behaviour)
    if (res.status === 401) {
      await Api.refreshOnce().catch(() => {});
      res = await doFetch();
    }

    const body = await res.json().catch(() => null);
    if (!res.ok || !body || !body.success) {
      const msg = (body && body.message) || 'Image upload failed.';
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return body.data;
  }

  /**
   * Remove an image from a slot.
   * @param {string} id
   * @param {string} slot
   */
  function removeImage(id, slot) {
    return Api.request(`${one(id)}/media/images/${encodeURIComponent(slot)}`, {
      method: 'DELETE',
      body: {},
    });
  }

  /**
   * Initialize a Bunny Stream video upload for the Section 2 intro video.
   * Returns TUS credentials (the Bunny API key is NEVER included).
   * @param {string} id
   * @param {{ fileName: string, fileSize: number, mimeType?: string, replace?: boolean }} body
   */
  function initVideoUpload(id, body) {
    return Api.post(`${one(id)}/media/video/upload`, body);
  }

  /**
   * Mark the TUS video upload as complete. Syncs status from Bunny.
   * @param {string} id
   * @param {string} videoId  (required by route but controller uses plan's stored videoId)
   */
  function markVideoUploaded(id, videoId) {
    return Api.post(`${one(id)}/media/video/${encodeURIComponent(videoId)}/uploaded`, {});
  }

  /**
   * Report a TUS upload failure.
   * @param {string} id
   * @param {string} videoId
   * @param {string} reason
   */
  function reportVideoFailure(id, videoId, reason) {
    return Api.post(`${one(id)}/media/video/${encodeURIComponent(videoId)}/failed`, { reason });
  }

  /**
   * Poll the current intro video processing status.
   * @param {string} id
   */
  function getVideoStatus(id) {
    return Api.get(`${one(id)}/media/video/status`);
  }

  /**
   * Get a short-lived signed Bunny embed URL for admin preview.
   * @param {string} id
   */
  function previewVideo(id) {
    return Api.post(`${one(id)}/media/video/preview`, {});
  }

  /**
   * Remove the intro video configuration from the plan.
   * Does NOT delete the Bunny Stream asset.
   * @param {string} id
   */
  function removeVideo(id) {
    return Api.request(`${one(id)}/media/video`, { method: 'DELETE', body: {} });
  }

  return {
    listPlans,
    getPlan,
    createPlan,
    updatePlan,
    activatePlan,
    deactivatePlan,
    getPreBooking,
    updatePreBooking,
    loadAllCourses,
    // Phase 39
    updateContent,
    uploadImage,
    removeImage,
    initVideoUpload,
    markVideoUploaded,
    reportVideoFailure,
    getVideoStatus,
    previewVideo,
    removeVideo,
  };
})();