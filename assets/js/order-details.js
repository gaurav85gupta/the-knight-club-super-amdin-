/**
 * Order details page controller (Phase 20 — spec Step 6, 32-33).
 *
 * ONE GET, rendering every field the API returns: order info, student,
 * course, financial breakdown, payment/Razorpay information, and the
 * enrollment relationship. Nothing on this page is computed client-side —
 * the historical financial figures, payment status, and enrollment link all
 * come straight from services/adminOrder.service.js#getOrderById.
 *
 * READ-ONLY (spec Step 24-25): no action buttons beyond "Back to orders".
 * There is deliberately no "Mark as Paid" or any other mutation control.
 *
 * SECRETS (spec Step 9, 28): only Razorpay order/payment IDs are rendered —
 * never a key secret or webhook secret, because the API itself never
 * returns them (see adminOrder.service.js#toAdminOrderDetail).
 */

(async function initOrderDetails() {
  const admin = await Auth.requireAuth();
  document.documentElement.classList.remove('auth-pending');
  document.getElementById('admin-identity').textContent = admin.name;

  const $ = (id) => document.getElementById(id);
  const alertEl = $('page-alert');
  const loadState = $('load-state');
  const content = $('content');

  $('logout-btn').addEventListener('click', async () => {
    $('logout-btn').disabled = true;
    await Auth.logout();
    window.location.replace(Auth.urlFor(Auth.PATHS.login));
  });

  const orderId = new URLSearchParams(window.location.search).get('id');

  function showLoad(title, text) {
    Dom.clear(loadState);
    loadState.appendChild(Dom.el('h3', { text: title }));
    loadState.appendChild(Dom.el('p', { text }));
    loadState.hidden = false;
  }

  function money(paise, currency) {
    if (paise == null) return '—';
    return `₹${Dom.paiseToRupees(paise)}${currency && currency !== 'INR' ? ` ${currency}` : ''}`;
  }

  function setBadge(elId, status) {
    Dom.clear($(elId));
    $(elId).appendChild(Ui.paymentStatusBadge(status));
  }

  function renderOrder(o) {
    $('page-title').textContent = `Order ${o.id}`;
    document.title = `Order ${o.id} — The Knight Club Super Admin`;

    // Order information
    $('d-id').textContent = o.id;
    setBadge('d-status', o.status);
    $('d-created').textContent = Dom.formatDateTime(o.createdAt);
    $('d-updated').textContent = Dom.formatDateTime(o.updatedAt);

    // Student
    if (o.student && !o.student.deleted) {
      $('d-student-name').textContent = o.student.fullName || '—';
      $('d-student-id').textContent = o.student.userId || '—';
    } else {
      $('d-student-name').textContent = 'Deleted student';
      $('d-student-id').textContent = o.student ? o.student.id : '—';
    }

    // Order type + 1% Club membership summary
    $('d-order-number').textContent = o.orderNumber || '—';
    const kindCell = $('d-kind');
    Dom.clear(kindCell);
    kindCell.appendChild(Ui.kindBadge(o.kind));
    const membershipSection = $('membership-section');
    if (o.kind === 'MEMBERSHIP' && o.membership) {
      $('d-membership-plan').textContent = o.membership.plan ? o.membership.plan.name : '—';
      const chips = $('d-membership-courses');
      Dom.clear(chips);
      for (const c of o.membership.selectedCourses) chips.appendChild(Dom.el('span', { class: 'member-course-chip', text: c.title || 'Course' }));
      const link = $('d-membership-link');
      Dom.clear(link);
      link.appendChild(Dom.el('a', { href: 'members.html', text: 'View in Membership' }));
      membershipSection.hidden = false;
    } else {
      membershipSection.hidden = true;
    }

    // Course
    if (o.course === null && Array.isArray(o.courses) && o.courses.length) {
      $('d-course-title').textContent = o.courses.map((c) => c.title || '—').join(', ');
      $('d-course-id').textContent = o.kind === 'MEMBERSHIP' ? 'Chosen via 1% Club' : 'Multi-course order';
    } else if (o.course && !o.course.deleted) {
      $('d-course-title').textContent = o.course.title || '—';
      $('d-course-id').textContent = o.course.id;
    } else {
      $('d-course-title').textContent = 'Deleted course';
      $('d-course-id').textContent = o.course ? o.course.id : '—';
    }

    // Financial breakdown
    const f = o.financial;
    $('d-original-amount').textContent = money(f.originalAmount, f.currency);
    $('d-discount').textContent = f.discountAmount > 0 ? `− ${money(f.discountAmount, f.currency)}` : 'None';
    $('d-coupon').textContent = f.couponCode || '—';
    $('d-final-amount').textContent = money(f.finalAmount, f.currency);
    $('d-currency').textContent = f.currency;

    // Payment
    const p = o.payment;
    $('d-rzp-order').textContent = p.razorpayOrderId;
    $('d-rzp-payment').textContent = p.razorpayPaymentId || 'Not yet attempted';
    $('d-signature-verified').textContent = p.signatureVerified ? 'Yes' : 'No';
    setBadge('d-payment-status', p.status);
    $('d-authorized-at').textContent = Dom.formatDateTime(p.authorizedAt);
    $('d-captured-at').textContent = Dom.formatDateTime(p.capturedAt);
    $('d-expires-at').textContent = Dom.formatDateTime(p.expiresAt);
    $('d-webhook-events').textContent = String(p.webhookEventsProcessed);

    const failureBox = $('failure-box');
    if (p.failure) {
      Dom.clear(failureBox);
      failureBox.appendChild(Dom.el('strong', { text: p.failure.code || 'Payment failed' }));
      failureBox.appendChild(Dom.el('p', { text: p.failure.reason || 'No further detail available.', style: 'margin: var(--space-1) 0 0;' }));
      failureBox.hidden = false;
    } else {
      failureBox.hidden = true;
    }

    // Enrollment (legacy single-course) — or the order's own enrollments
    if (!o.enrollment && Array.isArray(o.orderEnrollments) && o.orderEnrollments.length) {
      $('d-enrollment-status').textContent = `${o.orderEnrollments.length} enrollment${o.orderEnrollments.length === 1 ? '' : 's'} (${o.orderEnrollments.map((e) => e.status).filter((v, i, a) => a.indexOf(v) === i).join(', ')})`;
      $('d-enrolled-at').textContent = Dom.formatDateTime(o.orderEnrollments[0].enrolledAt);
    } else if (o.enrollment) {
      $('d-enrollment-status').textContent = o.enrollment.status;
      $('d-enrolled-at').textContent = Dom.formatDateTime(o.enrollment.enrolledAt);
    } else {
      $('d-enrollment-status').textContent = 'Not enrolled';
      $('d-enrolled-at').textContent = '—';
    }
  }

  function fail(err) {
    if (Auth.handleSessionError(err)) return true;
    Forms.showAlert(alertEl, Ui.messageForError(err, 'order'), 'error');
    alertEl.focus();
    return false;
  }

  if (!orderId) {
    showLoad('No order specified', 'Open an order from the Orders list to see its details.');
    return;
  }

  showLoad('Loading…', 'Please wait.');
  try {
    const data = await OrderApi.get(orderId);
    renderOrder(data.order);
    loadState.hidden = true;
    content.hidden = false;
  } catch (err) {
    if (fail(err)) return;
    const notFound = err instanceof ApiError && (err.status === 404 || err.status === 400);
    showLoad(notFound ? 'Order not found' : 'Could not load this order', notFound ? 'This order does not exist or was removed.' : 'Check your connection and try again.');
  }
})();
