/**
 * Static file server for the super-admin panel (dev + simple production use).
 *
 * WHY THIS EXISTS instead of `npx serve`:
 * Some versions of the `serve` package implement "clean URLs" by 301/302
 * redirecting a request for `/pages/course-form.html?id=X` to
 * `/pages/course-form?id=X` (dropping the extension) — and in doing so can
 * drop the query string during that redirect. Since `course-form.html?id=X`
 * is how this app identifies WHICH course to edit, losing `?id=X` silently
 * sends the admin to a blank "New course" form instead of the course they
 * clicked. This server never redirects: it serves the exact file that was
 * asked for, so the query string is never touched.
 *
 * BEHAVIOUR:
 *   - Serves ONLY index.html, /pages/** and /assets/** (allow-list). Dot-files,
 *     .git/, README, this script etc. return 404.
 *   - Sends security headers (nosniff, frame-ancestors 'none', ...).
 *   - `/pages/course-form.html?id=X` -> serves pages/course-form.html as-is.
 *   - `/pages/course-form?id=X` (no extension) -> ALSO serves
 *     pages/course-form.html, by trying `<path>.html` as a fallback. This
 *     keeps both forms of the URL working without ever issuing a redirect.
 *   - Unknown paths -> 404.
 *   - Query strings are never inspected or altered — only the path portion
 *     of the URL is used to resolve a file.
 *
 * USAGE:
 *   node serve-static.js [port]        (default port 3001)
 */

const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = __dirname;
const PORT = Number(process.argv[2]) || Number(process.env.PORT) || 3001;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.map': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

// ONLY these top-level entries are ever served. Everything else in the repo
// folder (.git/, README.md, serve-static.js, .env, ...) is never reachable.
const PUBLIC_TOP_LEVEL = new Set(['index.html', 'pages', 'assets']);

// Resolve a URL path to a real file on disk, WITHOUT ever redirecting.
// Tries, in order: the exact path, then the exact path + ".html",
// then (if the path ends in "/") that path + "index.html".
// Returns null for anything outside the public allow-list, any dot-file,
// any malformed URL, or any path that escapes ROOT.
function resolveFile(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null; // malformed %-encoding -> 404, never an uncaught exception
  }
  if (decoded.includes('\0')) return null;

  const segments = decoded.split(/[/\\]/).filter(Boolean);
  // No traversal, and no hidden files/folders (.git, .env, .DS_Store ...).
  if (segments.some((seg) => seg === '..' || seg === '.' || seg.startsWith('.'))) return null;

  const wantsIndex = segments.length === 0 || decoded.endsWith('/');
  const top = segments[0] || 'index.html';
  if (!PUBLIC_TOP_LEVEL.has(top)) return null;

  const base = path.join(ROOT, ...segments);
  const candidates = wantsIndex
    ? [path.join(base, 'index.html')]
    : [base, `${base}.html`];

  for (const candidate of candidates) {
    // Guard: must stay inside ROOT (trailing separator avoids the
    // "/app/super-admin-evil" prefix trick).
    if (!candidate.startsWith(ROOT + path.sep)) continue;
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      /* not found: try next candidate */
    }
  }
  return null;
}

// Safe-by-default response headers. frame-ancestors blocks clickjacking of
// the admin UI; the rest are standard hardening.
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "frame-ancestors 'none'",
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD', ...SECURITY_HEADERS });
    res.end('405 Method Not Allowed');
    return;
  }

  const urlPath = (req.url || '/').split('?')[0].split('#')[0];
  const filePath = resolveFile(urlPath);

  if (!filePath) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
    res.end('404 Not Found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  // HTML must always revalidate (it carries the page logic); static assets
  // may be cached briefly. Set NODE_ENV=development to disable caching.
  const isDev = process.env.NODE_ENV === 'development';
  const cacheControl = isDev || ext === '.html' ? 'no-cache' : 'public, max-age=3600';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
      res.end('500 Internal Server Error');
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': cacheControl,
      ...SECURITY_HEADERS,
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
});

// Last line of defence: one bad request must never take the panel down.
process.on('uncaughtException', (err) => console.error('uncaughtException:', err));
process.on('unhandledRejection', (err) => console.error('unhandledRejection:', err));

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Super-admin panel serving at http://localhost:${PORT}`);
  console.log(`Serving files from: ${ROOT}`);
});
