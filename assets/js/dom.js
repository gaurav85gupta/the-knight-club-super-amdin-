/**
 * DOM + formatting helpers shared by the admin pages.
 *
 * SAFE RENDERING (spec 78): nothing here ever assigns markup. Elements are
 * built with createElement and text is set through textContent, so a course
 * title like `<img src=x onerror=alert(1)>` is displayed as literal text.
 * There is deliberately no `html()` helper: adding one would invite misuse.
 *
 * MONEY (spec 21): the backend stores integer paise. Conversion between the
 * rupee text a human types and paise is done on STRINGS and integers only —
 * never parseFloat / * 100 — so 19.99 can never become 1998.9999999.
 */

const Dom = (() => {
  /** el('div', { class: 'x', text: 'hi', onclick: fn }, [children]) */
  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else node.setAttribute(k, v === true ? '' : String(v));
    }
    for (const child of [].concat(children)) {
      if (child === null || child === undefined || child === false) continue;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  /** "499900" paise -> "4999.00" (string math on integers). */
  function paiseToRupees(paise) {
    if (!Number.isSafeInteger(paise) || paise < 0) return '';
    const whole = Math.trunc(paise / 100);
    return `${whole}.${String(paise % 100).padStart(2, '0')}`;
  }

  /** "4,999" / "4999.5" -> 499950. Returns null when not a valid amount. */
  function rupeesToPaise(text) {
    const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(String(text || '').replace(/[,\s]/g, ''));
    if (!m) return null;
    const paise = Number(m[1]) * 100 + (m[2] === undefined ? 0 : Number(m[2].padEnd(2, '0')));
    return Number.isSafeInteger(paise) ? paise : null;
  }

  /** Display price for a table cell, e.g. "₹4,999.00" or "Free". */
  function formatPrice(pricing) {
    if (!pricing) return '—';
    if (pricing.salePrice === 0) return 'Free';
    const fmt = (p) => `₹${Number(paiseToRupees(p).split('.')[0]).toLocaleString('en-IN')}.${String(p % 100).padStart(2, '0')}`;
    return fmt(pricing.salePrice);
  }

  function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  /**
   * Date + time (Phase 20 — order/payment timestamps, where time-of-day
   * matters: createdAt, capturedAt, etc.). formatDate() above stays
   * date-only for list columns that don't need it.
   */
  function formatDateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? '—'
      : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  /** Returns the URL only if it is a well-formed https:// URL, else ''. */
  function safeHttpsUrl(value) {
    try {
      const u = new URL(String(value || ''));
      return u.protocol === 'https:' ? u.href : '';
    } catch {
      return '';
    }
  }

  /** Debounce for the search box (one request after the user pauses). */
  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  return { el, clear, paiseToRupees, rupeesToPaise, formatPrice, formatDate, formatDateTime, safeHttpsUrl, debounce };
})();
