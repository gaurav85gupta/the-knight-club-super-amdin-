# The Knight Club — Super Admin

The internal admin dashboard for managing courses, students, orders, and
platform operations. Framework-free by design: **HTML5 + CSS3 + Vanilla
JavaScript only.**

## What this application does

Will provide admin modules for Dashboard, Courses, Categories, Instructors,
Students, Enrollments, Orders, Payments, Coupons, Analytics, and Settings —
all implemented in later phases. Phase 0 establishes only the application
shell, navigation scaffold, and API wiring.

## Tech stack

- HTML5
- CSS3 (shares the same design tokens as the public website — white surface,
  purple accent — with a dashboard-oriented layout)
- Vanilla JavaScript (no React/Vue/Angular/Svelte)

## Running locally

No build step required:

```bash
node serve-static.js 3001
```

**Do not use `npx serve` or `python3 -m http.server` for this app.** Both
issue a redirect when a request like `/pages/course-form.html?id=X` is made
(rewriting it to the extension-less `/pages/course-form?id=X`), and in doing
so can drop the `?id=X` query string — which silently opens a blank
"New course" form instead of the course you meant to edit. `serve-static.js`
is a small dependency-free static server (see the comment at the top of that
file) that serves exactly the file requested and never redirects, so the
query string is never touched.

Then open `http://localhost:3001`.

The backend must be running at `http://localhost:5000` (see `/backend/README.md`).

## Folder structure

```
super-admin/
├── assets/
│   ├── css/       → tokens.css (shared design system), base.css (app shell)
│   ├── js/        → config.js, api.js, main.js
│   ├── images/
│   └── icons/
├── pages/         → future admin module pages
├── index.html
└── README.md
```

## API configuration

Backend calls go through `assets/js/config.js`, identical in structure to
the public website's config. Never hardcode API URLs elsewhere.

## What this app must NEVER contain

- MongoDB connection strings or credentials
- JWT secrets
- Razorpay secret key
- Bunny.net API key
- Any other backend-only secret

This app talks to the backend **only** over HTTPS API calls — never directly
to MongoDB.

## Note on indexing

`index.html` sets `<meta name="robots" content="noindex, nofollow">` since
this is an internal tool, not public-facing content.
