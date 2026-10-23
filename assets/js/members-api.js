/**
 * Membership (1% Club) members API client — read-only.
 * Backend: GET /admin/memberships/members[/totals|/:orderId]
 */
const MembersApi = (() => {
  const BASE = '/admin/memberships/members';

  function toQuery(params) {
    const allowed = ['search', 'status', 'page', 'limit'];
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
    totals: () => Api.get(`${BASE}/totals`),
    get: (orderId) => Api.get(`${BASE}/${encodeURIComponent(orderId)}`),
  };
})();
