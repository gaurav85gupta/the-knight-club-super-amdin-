/**
 * Testimonial VIDEO upload — API client (NEW — additive).
 *
 * THE ONLY place that knows the testimonial video-upload URLs. Mirrors
 * placeholder-api.js's video section exactly, minus the parts that don't
 * apply to a stateless flow (no `key`, no `/uploaded` — see
 * backend/src/routes/adminTestimonialVideo.routes.js header for why).
 *
 * Endpoints (all behind /api/v1/admin/testimonials/video):
 *   POST /upload               — init Bunny TUS upload, returns { upload, bunnyVideoId }
 *   GET  /:videoId/status      — poll Bunny processing status
 *   POST /:videoId/preview     — signed admin preview embed URL
 *   POST /:videoId/failed      — report a TUS upload failure
 *
 * The Bunny API key is NEVER returned by any endpoint here — same guarantee
 * as PlaceholderApi / TestimonialsApi.uploadPhoto.
 *
 * This file does NOT touch testimonials-api.js. TestimonialVideoApi only
 * produces a `bunnyVideoId`; TestimonialsApi.create/update/changeType (the
 * EXISTING, unchanged endpoints) are what persist it onto a testimonial —
 * exactly the same division of labor TestimonialsApi.uploadPhoto already
 * has with TestimonialsApi.create/update for photo testimonials.
 */

const TestimonialVideoApi = (() => {
  const BASE = '/admin/testimonials/video';

  /**
   * @param {{ fileName: string, fileSize: number, mimeType?: string }} body
   * @returns {Promise<{ upload: object, bunnyVideoId: string }>}
   */
  function initUpload(body) {
    return Api.post(`${BASE}/upload`, body);
  }

  /** @param {string} videoId @returns {Promise<{ videoStatus: string, bunnyStatusCode: number|null, thumbnailUrl: string }>} */
  function getStatus(videoId) {
    return Api.get(`${BASE}/${encodeURIComponent(videoId)}/status`);
  }

  /** @param {string} videoId @returns {Promise<{ embedUrl: string, expiresAt: string }>} */
  function preview(videoId) {
    return Api.post(`${BASE}/${encodeURIComponent(videoId)}/preview`, {});
  }

  /** @param {string} videoId @param {string} [reason] */
  function reportFailure(videoId, reason) {
    return Api.post(`${BASE}/${encodeURIComponent(videoId)}/failed`, { reason: reason || 'UNKNOWN' });
  }

  return { initUpload, getStatus, preview, reportFailure };
})();
