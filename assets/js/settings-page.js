/**
 * Settings page controller.
 *
 * Currently one preference: the sign-in sound (LoginSound). This is a
 * client-only UI preference — no backend endpoint, nothing server-side to
 * validate or authorize beyond the existing page-level Auth.requireAuth()
 * guard, matching how auth.js's own NOTICE_KEY is a plain client value.
 */

(async function initSettingsPage() {
  const admin = await Auth.requireAuth(); // redirects + never resolves if not signed in
  document.documentElement.classList.remove('auth-pending');

  document.getElementById('admin-identity').textContent = admin.name;

  const logoutBtn = document.getElementById('logout-btn');
  logoutBtn.addEventListener('click', async () => {
    logoutBtn.disabled = true;
    await Auth.logout();
    window.location.replace(Auth.urlFor(Auth.PATHS.login));
  });

  const soundCheckbox = document.getElementById('sound-enabled');
  soundCheckbox.checked = LoginSound.isEnabled();
  soundCheckbox.addEventListener('change', () => {
    LoginSound.setEnabled(soundCheckbox.checked);
  });
})();
