/**
 * Small shared UI pieces for the admin pages: confirmation dialog, page
 * alerts, badges, and the ONE place API errors become human messages.
 * All text via textContent (see dom.js) — never markup.
 */

const Ui = (() => {
  /**
   * Accessible confirmation dialog. Resolves true (confirmed) / false
   * (cancelled or Esc). Focus moves into the dialog and returns afterwards.
   */
  function confirm({ title, message, confirmLabel = 'Confirm', danger = false }) {
    return new Promise((resolve) => {
      const previouslyFocused = document.activeElement;
      const titleId = `dlg-title-${Date.now()}`;

      const cancelBtn = Dom.el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'Cancel' });
      const okBtn = Dom.el('button', { type: 'button', class: `btn btn-sm ${danger ? 'btn-danger-solid' : 'btn-primary'}`, text: confirmLabel });

      const backdrop = Dom.el('div', { class: 'modal-backdrop' }, [
        Dom.el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId }, [
          Dom.el('h3', { id: titleId, text: title }),
          Dom.el('p', { text: message }),
          Dom.el('div', { class: 'modal-actions' }, [cancelBtn, okBtn]),
        ]),
      ]);

      const close = (result) => {
        document.removeEventListener('keydown', onKey);
        backdrop.remove();
        if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
        resolve(result);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') close(false);
        if (e.key === 'Tab') {
          // keep focus inside the dialog
          const focusables = [cancelBtn, okBtn];
          const i = focusables.indexOf(document.activeElement);
          if (e.shiftKey && i <= 0) { e.preventDefault(); okBtn.focus(); }
          else if (!e.shiftKey && i === focusables.length - 1) { e.preventDefault(); cancelBtn.focus(); }
        }
      };

      cancelBtn.addEventListener('click', () => close(false));
      okBtn.addEventListener('click', () => close(true));
      backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(false); });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(backdrop);
      cancelBtn.focus();
    });
  }

  /**
   * Non-blocking toast (replaces native alert()). kind: 'info' | 'error' | 'success'.
   * Errors use role="alert" (announced immediately); others role="status".
   */
  function notify(message, kind = 'info') {
    let region = document.getElementById('toast-region');
    if (!region) {
      region = Dom.el('div', { id: 'toast-region', class: 'toast-region' });
      document.body.appendChild(region);
    }
    const closeBtn = Dom.el('button', { type: 'button', class: 'toast-close', 'aria-label': 'Dismiss', text: '×' });
    const toast = Dom.el('div', { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status' }, [
      Dom.el('span', { class: 'toast-msg', text: String(message) }),
      closeBtn,
    ]);
    const remove = () => toast.remove();
    closeBtn.addEventListener('click', remove);
    region.appendChild(toast);
    setTimeout(remove, kind === 'error' ? 10000 : 5000);
  }

  function statusBadge(status) {
    const s = String(status || '');
    return Dom.el('span', { class: `badge badge-sm badge-${s.toLowerCase()}`, text: s.charAt(0) + s.slice(1).toLowerCase() });
  }

  function visibilityBadge(visibility) {
    const v = String(visibility || '');
    return Dom.el('span', { class: `badge badge-sm badge-${v.toLowerCase()}`, text: v.charAt(0) + v.slice(1).toLowerCase() });
  }

  /**
   * Coupon EFFECTIVE state badge (Phase 19 — spec Step 4: Active / Inactive /
   * Scheduled / Expired / Usage limit reached). Distinct from statusBadge:
   * a coupon's displayed state is the SERVER-DERIVED `effectiveState` the
   * API returns (coupon.service.js#computeEffectiveState) — never
   * recomputed here from raw fields, so the badge always agrees with
   * whatever the backend just decided.
   */
  const COUPON_STATE_LABELS = Object.freeze({
    ACTIVE: 'Active',
    INACTIVE: 'Inactive',
    SCHEDULED: 'Scheduled',
    EXPIRED: 'Expired',
    USAGE_LIMIT_REACHED: 'Usage limit reached',
  });

  function couponStateBadge(effectiveState) {
    const s = String(effectiveState || '');
    return Dom.el('span', {
      class: `badge badge-sm badge-coupon-${s.toLowerCase().replace(/_/g, '-')}`,
      text: COUPON_STATE_LABELS[s] || s,
    });
  }

  /**
   * Payment status badge (Phase 20 — spec Step 4-5, 11, 20: CREATED /
   * AUTHORIZED / CAPTURED / FAILED / CANCELLED / EXPIRED). This is the REAL
   * Payment.status enum the backend returns — never an invented UI-only
   * status, so the badge always agrees with what the state machine in
   * payment.service.js actually decided (spec Step 20: "backend
   * verification remains authoritative").
   */
  const PAYMENT_STATUS_LABELS = Object.freeze({
    CREATED: 'Pending',
    AUTHORIZED: 'Authorized',
    CAPTURED: 'Paid',
    FAILED: 'Failed',
    CANCELLED: 'Cancelled',
    EXPIRED: 'Expired',
  });

  function paymentStatusBadge(status) {
    const s = String(status || '');
    return Dom.el('span', {
      class: `badge badge-sm badge-payment-${s.toLowerCase()}`,
      text: PAYMENT_STATUS_LABELS[s] || s,
    });
  }

  /**
   * Lead status badge (Phase L4 — spec Step 11: New / In Progress /
   * Resolved / Spam). This is the REAL ContactMessage.status enum the
   * backend returns (adminLead.service.js's toLeadListDto/toLeadDetailDto)
   * — never an invented UI-only status, matching the discipline of
   * paymentStatusBadge/couponStateBadge above.
   */
  const LEAD_STATUS_LABELS = Object.freeze({
    new: 'New',
    'in-progress': 'In Progress',
    resolved: 'Resolved',
    spam: 'Spam',
  });

  function leadStatusBadge(status) {
    const s = String(status || '');
    return Dom.el('span', {
      class: `badge badge-sm badge-lead-${s.toLowerCase()}`,
      text: LEAD_STATUS_LABELS[s] || s,
    });
  }

  /**
   * Enquiry type labels (Phase L4 — spec Step 9): the backend's raw
   * ENQUIRY_TYPES enum values (general/course/payment/support/club/other)
   * mapped to the human-readable labels the spec requires. The frontend
   * never invents new enquiry types and always sends the raw enum value
   * back to the API — this map is display-only.
   */
  const ENQUIRY_TYPE_LABELS = Object.freeze({
    general: 'General',
    course: 'Course',
    payment: 'Payment',
    support: 'Support',
    club: '1% Club',
    other: 'Other',
  });

  /**
   * Turns an ApiError into ONE safe, human message (spec 42). Raw backend
   * text is only shown for the statuses where the backend's message is
   * written for the user; everything unexpected gets a generic line.
   * `noun` names the resource in the 404 line (default keeps the Phase 6
   * wording for the course pages; category/instructor pages pass their own).
   */
  function messageForError(err, noun = 'course') {
    if (!(err instanceof ApiError)) return 'Something went wrong. Please try again.';
    switch (err.status) {
      case 0: return err.message; // network / timeout text is already user-facing
      case 400: return err.message || 'That request was not valid.';
      case 401: return 'Your session has expired. Please sign in again.';
      case 403: return 'You do not have permission to do that.';
      case 404: return `That ${noun} could not be found. It may have been removed.`;
      case 409: return err.message || 'That conflicts with existing data.';
      case 413: return 'That request was too large.';
      case 422: return err.message || 'Please correct the highlighted fields.';
      case 429: return 'Too many requests. Please wait a moment and try again.';
      default: return 'The server ran into a problem. Please try again shortly.';
    }
  }

  /**
   * Copies plain text to the clipboard (spec Step 7, 41 — admin copies a
   * coupon code to hand to a student). Prefers the async Clipboard API;
   * falls back to a hidden textarea + execCommand for browsers/contexts
   * where navigator.clipboard is unavailable (e.g. non-HTTPS admin
   * deployments). Never throws — callers get a boolean and show their own
   * success/failure message via Forms.showAlert, same as every other
   * action on these pages.
   *
   * @param {string} text
   * @returns {Promise<boolean>}
   */
  async function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (err) {
        // fall through to the legacy path below
      }
    }
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand('copy');
      textarea.remove();
      return ok;
    } catch (err) {
      return false;
    }
  }

  /**
   * 1% Club badges. Labels come ONLY from the backend values
   * (Order.kind / Enrollment.source) — never invented UI-side states.
   */
  const KIND_LABELS = Object.freeze({ COURSE: 'Course', MEMBERSHIP: '1% Club' });
  const SOURCE_LABELS = Object.freeze({ COURSE: 'Course', CART: 'Cart', MEMBERSHIP: '1% Club' });

  function kindBadge(kind) {
    const k = String(kind || 'COURSE');
    return Dom.el('span', { class: `badge badge-sm badge-kind-${k.toLowerCase()}`, text: KIND_LABELS[k] || k });
  }

  function sourceBadge(source) {
    const k = String(source || 'COURSE');
    return Dom.el('span', { class: `badge badge-sm badge-source-${k.toLowerCase()}`, text: SOURCE_LABELS[k] || k });
  }

  function memberBadge() {
    return Dom.el('span', { class: 'badge badge-sm badge-kind-membership', text: '1% Club Member' });
  }

  return {
    confirm, notify, statusBadge, visibilityBadge, couponStateBadge, paymentStatusBadge,
    leadStatusBadge, ENQUIRY_TYPE_LABELS, messageForError, copyToClipboard,
    kindBadge, sourceBadge, memberBadge,
  };
})();

/**
 * Sidebar nav scroll affordance (tablet/mobile only).
 *
 * Below 1024px the sidebar becomes a single horizontally-scrolling row of
 * 13+ nav links (see base.css @media (max-width: 1024px) .sidebar nav),
 * with no native scrollbar and no other signal that most of the nav sits
 * off-screen. base.css always draws a right-edge shadow by default (the
 * correct state before the first scroll ever happens); this script's job
 * is to keep that in sync as the visitor actually scrolls — fading in a
 * LEFT-edge shadow once scrolled away from the start, and dropping the
 * right-edge shadow once scrolled all the way to the end — by toggling
 * .sidebar-nav-at-start / .sidebar-nav-at-end on .sidebar, which base.css
 * reads. Purely cosmetic, runs on every admin page (no auth/data
 * involved), so it's safe to run unconditionally and before the
 * auth-gated page scripts settle.
 */
(function initSidebarNavScrollHints() {
  const nav = document.querySelector('.sidebar nav');
  if (!nav) return;

  function update() {
    const maxScroll = nav.scrollWidth - nav.clientWidth;
    const atStart = nav.scrollLeft <= 2;
    const atEnd = maxScroll <= 2 || nav.scrollLeft >= maxScroll - 2;
    nav.parentElement.classList.toggle('sidebar-nav-at-start', atStart);
    nav.parentElement.classList.toggle('sidebar-nav-at-end', atEnd);
  }

  nav.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  update();
})();