/**
 * Membership → one member purchase in full (read-only).
 * Data: GET /admin/memberships/members/:orderId
 */
(async function initMemberDetails() {
  const admin = await Auth.requireAuth();
  document.documentElement.classList.remove('auth-pending');
  document.getElementById('admin-identity').textContent = admin.name;

  const logoutBtn = document.getElementById('logout-btn');
  logoutBtn.addEventListener('click', async () => {
    logoutBtn.disabled = true;
    await Auth.logout();
    window.location.replace(Auth.urlFor(Auth.PATHS.login));
  });

  const $ = (id) => document.getElementById(id);
  const money = (paise) => `₹${Dom.paiseToRupees(paise || 0)}`;
  const set = (id, text) => { $(id).textContent = text == null || text === '' ? '—' : String(text); };

  const loadState = $('load-state');
  function showState(title, text) {
    Dom.clear(loadState);
    loadState.appendChild(Dom.el('h3', { text: title }));
    loadState.appendChild(Dom.el('p', { text }));
    loadState.hidden = false;
  }

  const orderId = new URLSearchParams(window.location.search).get('id');
  if (!orderId) { showState('Member not found', 'No order id was provided.'); return; }
  showState('Loading…', 'Please wait.');

  let m;
  try {
    const data = await MembersApi.get(orderId);
    m = data.member;
  } catch (err) {
    if (Auth.handleSessionError(err)) return;
    showState('Could not load member', Ui.messageForError(err, 'member'));
    return;
  }

  loadState.hidden = true;
  $('page-title').textContent = m.student.fullName ? `${m.student.fullName} — 1% Club` : '1% Club member';

  set('d-student-name', m.student.fullName || (m.student.deleted ? 'Deleted student' : null));
  set('d-student-userid', m.student.userId);
  set('d-student-mobile', m.student.mobile);
  if (!m.student.deleted) {
    $('d-student-link').appendChild(Dom.el('a', { href: `student-details.html?id=${encodeURIComponent(m.student.id)}`, text: 'Open student profile' }));
  } else { set('d-student-link', null); }

  set('d-order-number', m.orderNumber);
  const statusLabel = { PAID: 'Paid', PENDING: 'Pending', FAILED: 'Failed', CANCELLED: 'Cancelled', REFUNDED: 'Refunded' }[m.status] || m.status;
  $('d-status').appendChild(Dom.el('span', { class: `badge badge-sm ${m.status === 'PAID' ? 'badge-paid' : 'badge-payment-' + String(m.status).toLowerCase()}`, text: statusLabel }));
  set('d-plan', m.plan ? m.plan.name : null);
  set('d-amount', money(m.amount));
  set('d-coupon', m.couponCode ? `${m.couponCode} (−${money(m.couponDiscountAmount)})` : null);
  set('d-paid-at', m.paidAt ? Dom.formatDateTime(m.paidAt) : Dom.formatDateTime(m.createdAt));
  set('d-rzp', m.razorpayPaymentId);
  if (m.paymentId) {
    $('d-payment-link').appendChild(Dom.el('a', { href: `order-details.html?id=${encodeURIComponent(m.paymentId)}`, text: 'Open payment' }));
  } else { set('d-payment-link', null); }

  const chosen = $('d-selected');
  if (!m.selectedCourses.length) chosen.textContent = '—';
  for (const c of m.selectedCourses) chosen.appendChild(Dom.el('span', { class: 'member-course-chip', text: c.title || 'Course' }));

  const tbody = $('d-enrollments');
  if (!m.enrollments.length) {
    tbody.appendChild(Dom.el('tr', {}, [Dom.el('td', { colspan: '5', text: m.status === 'PAID' ? 'Enrollments are still being created (fulfilment pending).' : 'No access granted.' })]));
  }
  for (const e of m.enrollments) {
    tbody.appendChild(Dom.el('tr', {}, [
      Dom.el('td', { text: e.course ? e.course.title : 'Deleted course' }),
      Dom.el('td', {}, [Ui.sourceBadge(e.source)]),
      Dom.el('td', { text: e.status }),
      Dom.el('td', { text: Dom.formatDate(e.enrolledAt) }),
      Dom.el('td', {}, [Dom.el('a', { class: 'btn btn-outline btn-sm', href: `enrollment-details.html?id=${encodeURIComponent(e.id)}`, text: 'Details' })]),
    ]));
  }

  $('content').hidden = false;
})();
