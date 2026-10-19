# Super Admin — Pre-production audit (19 Oct 2026, updated same day)

Scope: static frontend (HTML/CSS/vanilla JS) + `serve-static.js`. Backend was NOT in the zip, so
backend items are listed as "verify", not "confirmed".

## FIXED in this package (second pass — real mobile layout bug)
| # | Sev | Issue | Fix |
|---|-----|-------|-----|
| 0 | **CRITICAL — reported by user, reproduced with Playwright at 320–1024px** | On tablet/mobile (≤1024px), `.app-shell` correctly collapsed to a single grid column, but `.sidebar` itself did not shrink: it's a CSS Grid item, and a grid item's default `min-width` is `auto` (not `0`), so it refuses to shrink below its content's intrinsic width. At this breakpoint `.sidebar nav` becomes a horizontal-scroll row (`flex-wrap: nowrap`, 13 links, `white-space: nowrap`) — without `min-width:0` the browser sized `.sidebar` to fit all 13 links unwrapped (~1700px), which stretched the shared grid column and therefore `.main-content` and the whole page to ~1200px+ even on a 378px viewport. Confirmed via DevTools (`.main-content` computed width 1168px at 378px viewport) and reproduced headlessly; `.main-content` already had the `min-width:0` fix from the first pass, `.sidebar` did not. | Added `min-width: 0;` to `.sidebar` inside the `@media (max-width: 1024px)` block in `base.css`. Verified with Playwright at 320/375/414/768/1024/1025px: `document.body.scrollWidth` now equals the viewport width at every size, on both `index.html` (dashboard) and `pages/categories.html` (the page in the reported screenshot). |

## FIXED in earlier pass
| # | Sev | Issue | Fix |
|---|-----|-------|-----|
| 1 | Layout | Whole page incl. sidebar scrolled together (sidebar was in normal flow) | `.sidebar` is now `position: sticky; top:0; height:100dvh; overflow-y:auto` (desktop). Mobile top-nav unchanged. (`base.css`) |
| 2 | CRITICAL (if serve-static.js is used in prod) | `/.git/config`, `/.git/HEAD`, `/serve-static.js`, `/README.md` were publicly downloadable (tested: HTTP 200) | Allow-list: only `index.html`, `/pages/**`, `/assets/**`; any dot-file/folder → 404 |
| 3 | HIGH (same) | One malformed URL (e.g. `/%E0%A4%A`) threw an uncaught `URIError` and **crashed the whole Node process** (tested) | try/catch on decode + global `uncaughtException` guard |
| 4 | MED | No security headers → admin panel could be framed (clickjacking) | `X-Frame-Options`, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` in server + `_headers` file |
| 5 | MED | Video preview `iframe.src` taken from API response without validation (3 places) | Only well-formed `https://` URLs allowed (`Dom.safeHttpsUrl`), referrerpolicy + title added |
| 6 | LOW/MED | Dashboard "Recent activity" showed raw `sessionId` and full Mongo IDs | sessionId hidden, other IDs shortened (`…a1c20f`) |
| 7 | LOW | Server allowed any HTTP method; no cache policy | GET/HEAD only; HTML `no-cache`, assets cached 1h (set `NODE_ENV=development` to disable) |

## Checked and GOOD
- No secrets in code or in full git history (searched all commits for keys/URIs/tokens).
- No token in localStorage/sessionStorage; HttpOnly cookies + CSRF header on non-GET + single-flight refresh.
- Rendering uses `textContent`/`Dom.el` everywhere; remaining `innerHTML` uses are static strings only.
- Every protected page calls `Auth.requireAuth()` and fails closed; cross-tab logout works.
- Money handled as integer paise (no float math). Hrefs use `encodeURIComponent`.

## OPEN — you must verify / decide before go-live
1. **Uncommitted work:** 46 files differ from last commit (`f0cf0d3`, 14 Oct). If you deploy from GitHub, production will NOT contain your latest changes. Commit + push (including the files in this package).
2. **Cross-site cookies (biggest architectural risk):** frontend is on one domain, API on `the-knight-club-backend.onrender.com`. Auth relies on HttpOnly cookies, so the backend must send them `SameSite=None; Secure`, CORS must allow your exact admin origin with `credentials: true`, and browsers that block third-party cookies (Safari, Chrome incognito/phase-out) will break login. Best fix: serve API from a subdomain of the same site (e.g. `api.yourdomain.com` + `admin.yourdomain.com`).
3. **Render cold start:** on a free/starter Render instance the first call after idle can take 30–60 s, but `api.js` times out at 15 s, and `requireAuth()` then redirects to login ("could not verify your session"). Use a paid always-on instance, or raise the timeout for `/admin/auth/me`.
4. **Test data in production DB:** ₹1.00 orders (Expired/Cancelled), students "gaurav", "gaurav12". Confirm Razorpay is in LIVE mode and clean test records.
5. **Content-Security-Policy:** not added because it can break uploads/preview if hostnames are wrong. Needed allow-list: your API origin (connect-src), Bunny tus upload endpoint (connect-src), Bunny embed host (frame-src), `fonts.googleapis.com`/`fonts.gstatic.com`, `data:` (login chime is a data: URI), and inline styles/scripts (index uses an inline `auth-pending` snippet — move to a file or hash it).
6. **Backend checks (not in zip):** login rate-limit + lockout, admin-role authorization on EVERY endpoint (not just UI), refresh-token rotation/reuse detection, audit log immutability, Razorpay webhook signature verification, signed-URL expiry for Bunny.
7. **Low:** `alert()`/`confirm()` in `membership-page.js`; `mailto:`/`tel:` built from lead data (scheme is fixed, so safe, but sanitise on backend); login waits up to ~2.5 s for the chime before redirect; README still says "Phase 0"; Google Fonts loaded without self-hosting; JS/CSS have no cache-busting (`?v=`) so users may briefly see stale files after a deploy.

## Hosting note
If you host on Netlify / Vercel / Cloudflare Pages / Render Static, `serve-static.js` is not used there —
the file-exposure bugs (#2, #3) then don't apply, but make sure `.git` is never part of the published folder.

---

# UI / UX review (code-based — not visually rendered, no browser available)

## FIXED
| # | Area | Issue | Fix |
|---|------|-------|-----|
| U1 | Dashboard tables | In half-width cards, dates ("19 Oct / 2026"), amounts and statuses wrapped onto 2 lines (visible in your screenshot) | Columns 3+ are `nowrap`; cards go 2-up only when each is ≥32rem, otherwise stack (`auto-fit`) |
| U2 | Mobile nav | 13 links wrapped into a very tall block above the content | Single horizontally-scrollable row with snap |
| U3 | Native dialogs | 6× `alert()` / `confirm()` in 1% Club page (blocking, unstyled, inconsistent with the app's own modal) | Confirms use `Ui.confirm` (danger style, focus-trap, Esc); alerts use new non-blocking `Ui.notify()` toast (`role=alert` for errors) |
| U4 | Button contrast | White text on the blue end of the primary gradient = 3.26:1 (fails WCAG AA 4.5:1) | Gradient now ends at `blue-600` → 4.7:1 |
| U5 | Keyboard a11y | No "skip to content" link; 13 nav links before content on every page | Skip link + focusable `<main id="main-content">` on all 20 app pages |
| U6 | Nav clarity | "Payments" greyed out with no explanation | Shows a "Soon" tag |

## Checked and GOOD
- Text contrast: body/muted text 4.3–4.7:1+, links 7.2:1, all status badges ≥ 4.97:1, sidebar text 9.2:1.
- Visible focus on buttons, inputs, nav; `prefers-reduced-motion` respected; 16px inputs (no iOS zoom).
- Login: proper labels, `autocomplete=username/current-password`, password cleared after failure, double-submit blocked, specific messages for rate-limit / network / invalid.
- Every page has its own `<title>`, `aria-current="page"` on active nav, `<th scope="col">`, `aria-live` on stats, unsaved-changes guard on course/coupon forms, loading + empty + error states on dashboard sections.

## OPEN — your decision
1. ~~Brand name inconsistency~~ **FIXED:** confirmed "The Knight Club" is correct; all "Night Club" text (sidebar brand, login brand, every `<title>`, `document.title` in JS, README) changed. Only the internal sessionStorage key `nightclub:lastEditIntent` was left as-is (not user-visible).
2. **Small touch targets:** `.btn-xs` (~26px high) and some table action buttons are below the recommended 44px on touch devices. Fine on desktop; consider `min-height: 40px` under 768px.
3. **Dead-end/duplicate nav:** "Placeholders" is an unclear label for an operator — consider "Page media" / "Site images".
4. **Activity feed wording:** event types are auto-prettified from enum names ("Admin login success"). Consider friendlier, past-tense copy ("Admin signed in") and showing the admin's name instead of IDs.
5. **Sticky topbar:** "Sign out" scrolls out of view on long pages (e.g. dashboard). Optional: make `.topbar` sticky.
6. **Low-contrast intentional elements:** disabled sidebar text (4.3:1) and `--color-text-faint` (2.6:1, currently unused for text) — keep faint only for decorative use.
7. Please eyeball once on a real phone + 1280px laptop: I could verify CSS logic and contrast numerically, but could not render the pages.
