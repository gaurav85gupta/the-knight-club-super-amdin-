/**
 * Centralized frontend API configuration.
 *
 * Every fetch() call in this app should read API_BASE_URL from here rather
 * than hardcoding a URL. This is the ONLY file that should need to change
 * when moving between local development and production.
 *
 * No secrets belong in this file — only the public backend base URL.
 */

const CONFIG = Object.freeze({
  // Swap this value (or detect via hostname) when deploying to production.
  API_BASE_URL: (() => {
    const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    return isLocal
      ? 'http://localhost:5000/api/v1'
      : 'https://api.theknightclub.in/api/v1';
  })(),
});