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
 * Responsive navigation (Phase 2): left-side slide-in drawer for mobile and
 * tablet (≤1024px), replacing the old horizontally-scrolling nav row.
 *
 * Markup expected on every page using the shared shell (see index.html /
 * pages/*.html, login.html excluded):
 *   <button class="menu-toggle" id="menu-toggle" type="button"
 *           aria-label="Open navigation" aria-expanded="false"
 *           aria-controls="sidebar-nav">...</button>
 *   <aside class="sidebar" id="sidebar-nav"> ... (unchanged) ... </aside>
 *   <div class="drawer-backdrop" id="drawer-backdrop" hidden></div>
 *
 * Desktop (>1024px) never opens the drawer — .sidebar is the permanent
 * column there regardless of this module's state, and the toggle button is
 * hidden by base.css, so this code simply has nothing to do above that
 * width other than guarantee the drawer isn't left open from a narrower
 * viewport (handled by the resize listener below).
 *
 * Safe to call more than once: init() is idempotent and only ever attaches
 * its listeners a single time per page load (early-return via a module-level
 * flag), matching the no-duplicate-listener / safe-reinit requirement.
 */
const ResponsiveNav = (() => {
  let initialized = false;
  let drawer = null;
  let toggle = null;
  let backdrop = null;
  let isOpen = false;

  const DESKTOP_QUERY = '(min-width: 1025px)';

  function focusableElements() {
    if (!drawer) return [];
    return Array.from(
      drawer.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')
    );
  }

  function trapFocus(e) {
    if (e.key !== 'Tab') return;
    const items = focusableElements();
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function onKeydown(e) {
    if (e.key === 'Escape') {
      close();
    } else {
      trapFocus(e);
    }
  }

  function open() {
    if (!drawer || isOpen) return;
    isOpen = true;
    drawer.classList.add('is-open');
    if (backdrop) {
      backdrop.hidden = false;
      // Force layout so the opacity transition actually runs instead of
      // the backdrop just appearing instantly (hidden -> display:block
      // needs a frame before toggling the opacity-driving class).
      void backdrop.offsetWidth;
      backdrop.classList.add('is-open');
    }
    toggle.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden'; // lock background scroll while modal
    document.addEventListener('keydown', onKeydown);
    const items = focusableElements();
    (items[0] || drawer).focus();
  }

  function close({ restoreFocus = true } = {}) {
    if (!drawer || !isOpen) return;
    isOpen = false;
    drawer.classList.remove('is-open');
    if (backdrop) {
      backdrop.classList.remove('is-open');
      backdrop.hidden = true;
    }
    toggle.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKeydown);
    if (restoreFocus) toggle.focus();
  }

  function toggleDrawer() {
    if (isOpen) close();
    else open();
  }

  function init() {
    if (initialized) return;
    drawer = document.getElementById('sidebar-nav') || document.querySelector('.sidebar');
    toggle = document.getElementById('menu-toggle') || document.querySelector('.menu-toggle');
    backdrop = document.getElementById('drawer-backdrop') || document.querySelector('.drawer-backdrop');
    if (!drawer || !toggle) return; // page doesn't use the shared shell (e.g. login)

    initialized = true;

    toggle.addEventListener('click', toggleDrawer);
    if (backdrop) {
      backdrop.addEventListener('click', () => close());
    }
    // Any nav link click closes the drawer so the next page (or anchor
    // jump on the same page) doesn't load/scroll with the drawer stuck
    // open; normal navigation itself is untouched (no preventDefault).
    drawer.querySelectorAll('nav a').forEach((link) => {
      link.addEventListener('click', () => close({ restoreFocus: false }));
    });

    // Crossing into desktop width must never leave the drawer "open" in a
    // state that fights the now-permanent sidebar; crossing back down must
    // start closed, not resume whatever it was mid-resize.
    const mq = window.matchMedia(DESKTOP_QUERY);
    const onViewportChange = (e) => {
      if (e.matches) close({ restoreFocus: false });
    };
    if (mq.addEventListener) mq.addEventListener('change', onViewportChange);
    else if (mq.addListener) mq.addListener(onViewportChange); // older Safari
  }

  return { init };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => ResponsiveNav.init());
} else {
  ResponsiveNav.init();
}