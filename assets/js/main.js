/**
 * Protected admin home (Phase 5 placeholder).
 *
 * Flow: Auth.requireAuth() asks the SERVER who the administrator is. If
 * there is no valid session it redirects to the login page and never
 * resolves, so nothing below the `await` runs for an unauthenticated
 * visitor. This guard is UX; the backend independently refuses every admin
 * API call without a valid session.
 *
 * All dynamic text is written with textContent (never innerHTML), so
 * nothing the server returns can be interpreted as markup. (Phase 0 wrote
 * the health widget with innerHTML; that is replaced here.)
 */

(async function initAdminHome() {
  const admin = await Auth.requireAuth(); // redirects + never resolves if not signed in

  // Reveal the shell only now that the server has confirmed the session.
  document.documentElement.classList.remove('auth-pending');

  document.getElementById('admin-identity').textContent = admin.name;

  // ---- Sign out -----------------------------------------------------------
  const logoutBtn = document.getElementById('logout-btn');
  let signingOut = false;
  logoutBtn.addEventListener('click', async () => {
    if (signingOut) return;
    signingOut = true;
    logoutBtn.disabled = true;
    await Auth.logout(); // revokes the server-side session
    window.location.replace(Auth.urlFor(Auth.PATHS.login));
  });

  // ---- Live API check through the PROTECTED boundary -----------------------
  // /admin/ping requires a valid Super Admin session server-side, so a
  // successful response is real proof the boundary works end to end.
  const statusEl = document.getElementById('api-status');
  try {
    await Api.get('/admin/ping');
    statusEl.className = 'badge badge-success';
    statusEl.textContent = 'Admin API connected';
  } catch (err) {
    if (Auth.handleSessionError(err)) return;
    statusEl.className = 'badge badge-error';
    statusEl.textContent = 'API unreachable';
  }
})();
