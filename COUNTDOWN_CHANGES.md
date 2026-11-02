# Hero Countdown — Super Admin Changes

New "Hero Countdown Timer" section on the Membership Plan settings page,
right after Pre-Booking. Lets you set **any** label and **any** deadline
for the public 1% Club hero countdown — no code change needed to run a
new sale, extend a deadline, or rename the offer.

## Files changed

- `pages/membership.html`
  - New section `#sec-countdown-wrap`: enable checkbox, label input,
    `datetime-local` deadline picker, optional "expired" message,
    its own "Save Countdown Settings" button — same layout pattern as
    the existing Pre-Booking section just above it.

- `assets/js/membership-page.js`
  - New IIFE (`window.__countdown`) handling load/save for the section,
    wired into `populateForm()` the same way `window.__phase3`
    (Pre-Booking) is.
  - Converts between the browser's local `datetime-local` value and the
    backend's UTC ISO string in exactly one place
    (`isoToLocalInputValue` / `localInputValueToIso`).

- `assets/js/membership-api.js`
  - New `getCountdown(id)` / `updateCountdown(id, body)` methods,
    calling `GET` / `PATCH /admin/memberships/:id/countdown`.

## How to use it

1. Open a membership plan → scroll to **Hero Countdown Timer**.
2. Check **"Show countdown on the public hero"**.
3. Type any **label** you want (e.g. "Limited Time Offer", "Diwali Sale
   Ends In", "Final Hours").
4. Pick an **Ends At** date/time (your local time — converted
   automatically).
5. Optionally set a message to show once it expires (leave blank to
   just hide the countdown when time runs out).
6. Click **Save Countdown Settings**.

The public page picks this up immediately on next load/refresh — no
deploy required. To run a brand-new countdown later (different name,
different date), just come back here and update the same fields.
