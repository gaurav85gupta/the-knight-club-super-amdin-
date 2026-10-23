/**
 * Enrollment details page controller (Phase 22 — spec Step 23-24).
 *
 * ONE GET, rendering every field the API returns: enrollment identity,
 * status, date, the student and course THIS enrollment references, and the
 * real access summary. Nothing here is computed client-side — every value
 * comes straight from services/adminEnrollment.service.js#getEnrollmentById
 * (spec Step 24: relationship integrity — never a mixed-up student/course).
 *
 * READ-ONLY (spec Step 25-29): no action buttons beyond "Back to
 * enrollments". There is deliberately no status-change or delete control —
 * see adminEnrollment.service.js's own header for why none exists in the
 * underlying architecture to expose.
 *
 * The originating order/payment is linked by id only (Phase 20 owns its
 * own detail page); this page does not duplicate payment information.
 */

(async function initEnrollmentDetails() {
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

  const enrollmentId = new URLSearchParams(window.location.search).get('id');

  function showLoad(title, text) {
    Dom.clear(loadState);
    loadState.appendChild(Dom.el('h3', { text: title }));
    loadState.appendChild(Dom.el('p', { text }));
    loadState.hidden = false;
  }

  function fail(err) {
    if (Auth.handleSessionError(err)) return true;
    Forms.showAlert(alertEl, Ui.messageForError(err, 'enrollment'), 'error');
    alertEl.focus();
    return false;
  }

  function renderEnrollment(e) {
    $('page-title').textContent = `Enrollment ${e.id}`;
    document.title = `Enrollment ${e.id} — The Knight Club Super Admin`;

    // Enrollment
    $('d-id').textContent = e.id;
    Dom.clear($('d-status'));
    $('d-status').appendChild(Ui.statusBadge(e.status));
    $('d-enrolled-at').textContent = Dom.formatDateTime(e.enrolledAt);
    $('d-completed-at').textContent = e.completedAt ? Dom.formatDateTime(e.completedAt) : 'Not completed';

    // Student
    if (e.student && !e.student.deleted) {
      $('d-student-name').textContent = e.student.fullName || '—';
      $('d-student-id').textContent = e.student.userId || '—';
      Dom.clear($('d-student-status'));
      $('d-student-status').appendChild(Ui.statusBadge(e.student.status));
    } else {
      $('d-student-name').textContent = 'Deleted student';
      $('d-student-id').textContent = e.student ? e.student.id : '—';
      Dom.clear($('d-student-status'));
      $('d-student-status').textContent = '—';
    }

    // Course
    if (e.course && !e.course.deleted) {
      $('d-course-title').textContent = e.course.title || '—';
      $('d-course-id').textContent = e.course.id;
      Dom.clear($('d-course-status'));
      $('d-course-status').appendChild(Ui.statusBadge(e.course.status));
    } else {
      $('d-course-title').textContent = 'Deleted course';
      $('d-course-id').textContent = e.course ? e.course.id : '—';
      Dom.clear($('d-course-status'));
      $('d-course-status').textContent = '—';
    }

    // Access
    const a = e.access;
    Dom.clear($('d-access-granted'));
    $('d-access-granted').appendChild(Dom.el('span', {
      class: `badge badge-sm badge-${a.accessGranted ? 'active' : 'suspended'}`,
      text: a.accessGranted ? 'Access active' : 'Access blocked',
    }));
    $('d-enrollment-grants').textContent = a.enrollmentGrantsAccess ? 'Yes' : 'No';
    $('d-account-active').textContent = a.accountActive ? 'Yes' : 'No';
    $('d-course-public').textContent = a.courseCurrentlyPublic ? 'Yes' : 'No (does not affect this enrollment\u2019s access)';

    // Source badge (Course / Cart / 1% Club)
    const sourceCell = $('d-source');
    Dom.clear(sourceCell);
    sourceCell.appendChild(Ui.sourceBadge(e.source));

    // Originating order
    const orderLink = $('d-order-link');
    Dom.clear(orderLink);
    if (e.order) {
      orderLink.appendChild(Dom.el('div', { class: 'cell-sub', text: `${e.order.orderNumber} · ${e.order.kind === 'MEMBERSHIP' ? '1% Club' + (e.order.membershipPlan ? ' — ' + e.order.membershipPlan.name : '') : 'Course cart'}` }));
    }
    if (e.paymentId) {
      orderLink.appendChild(Dom.el('a', { class: 'btn btn-outline btn-sm', href: `order-details.html?id=${encodeURIComponent(e.paymentId)}`, text: 'View order' }));
    } else if (!e.order) {
      orderLink.appendChild(Dom.el('span', { class: 'cell-sub', text: 'No originating order recorded.' }));
    }
  }

  if (!enrollmentId) {
    showLoad('No enrollment specified', 'Open an enrollment from the Enrollments list to see its details.');
    return;
  }

  showLoad('Loading…', 'Please wait.');
  try {
    const data = await EnrollmentApi.get(enrollmentId);
    renderEnrollment(data.enrollment);
    loadState.hidden = true;
    content.hidden = false;
  } catch (err) {
    if (fail(err)) return;
    const notFound = err instanceof ApiError && (err.status === 404 || err.status === 400);
    showLoad(notFound ? 'Enrollment not found' : 'Could not load this enrollment', notFound ? 'This enrollment does not exist or was removed.' : 'Check your connection and try again.');
  }
})();
