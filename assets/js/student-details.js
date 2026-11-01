/**
 * Student details page controller (Phase 21 — Super Admin Student
 * Management).
 *
 * FOUR reads compose this page — profile/account, enrollments, purchase
 * history, and learning progress — loaded in parallel. Nothing on this page
 * is computed client-side: enrollment status, historical purchase amounts,
 * and progress percentages all come straight from the backend, which itself
 * reuses the exact Phase 16 / Phase 20 / Phase 14 services (see
 * students-api.js and the backend route comments this file's requests map
 * to). Opening this page never mutates anything — only the explicit
 * Activate/Suspend actions do, and each requires confirmation.
 *
 * PASSWORDS/TOKENS: never requested, never rendered — the backend's DTO
 * does not include them (same discipline as order-details.js and
 * coupon-details.js).
 *
 * SUSPEND/ACTIVATE: same confirm-then-call-then-reload pattern as
 * coupons-list.js#runAction. A suspend takes effect immediately (backend
 * bumps tokenVersion + revokes live sessions) — this page does not need to
 * do anything extra to "log the student out"; it only reflects backend
 * state after the call succeeds.
 */

(async function initStudentDetails() {
  const admin = await Auth.requireAuth();
  document.documentElement.classList.remove('auth-pending');
  document.getElementById('admin-identity').textContent = admin.name;

  const $ = (id) => document.getElementById(id);
  const alertEl = $('page-alert');
  const loadState = $('load-state');
  const content = $('content');
  const activateBtn = $('activate-btn');
  const suspendBtn = $('suspend-btn');
  const resetPasswordBtn = $('reset-password-btn');

  $('logout-btn').addEventListener('click', async () => {
    $('logout-btn').disabled = true;
    await Auth.logout();
    window.location.replace(Auth.urlFor(Auth.PATHS.login));
  });

  const studentId = new URLSearchParams(window.location.search).get('id');
  let currentStudent = null;
  let actionBusy = false;

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

  function fail(err) {
    if (Auth.handleSessionError(err)) return true;
    Forms.showAlert(alertEl, Ui.messageForError(err, 'student'), 'error');
    alertEl.focus();
    return false;
  }

  function emptyBox(el, text) {
    Dom.clear(el);
    el.appendChild(Dom.el('p', { text }));
    el.hidden = false;
  }

  // ---- Profile / Account rendering -----------------------------------------
  function renderStudent(s) {
    currentStudent = s;
    $('page-title').textContent = s.fullName;
    document.title = `${s.fullName} — The Knight Club Super Admin`;

    $('d-name').textContent = s.fullName;
    $('d-userid').textContent = s.userId || '—';
    $('d-email').textContent = s.email ? `${s.email}${s.isEmailVerified ? '' : ' (unverified)'}` : '—';
    Dom.clear($('d-signin'));
    $('d-signin').appendChild(Ui.authProviderBadge(s));
    $('d-mobile').textContent = s.mobile || '—';
    $('d-state').textContent = s.state || '—';

    Dom.clear($('d-status'));
    $('d-status').appendChild(Ui.statusBadge(s.status));
    const incompleteBadge = Ui.profileIncompleteBadge(s.needsProfileCompletion);
    if (incompleteBadge) $('d-status').appendChild(incompleteBadge);
    $('d-created').textContent = Dom.formatDateTime(s.createdAt);
    $('d-last-login').textContent = s.lastLoginAt ? Dom.formatDateTime(s.lastLoginAt) : 'Never';

    renderMembership(s.membership);

    // Account actions: exactly one of the two is ever shown, matching the
    // student's REAL current status — never both, never neither.
    if (s.status === 'ACTIVE') {
      activateBtn.hidden = true;
      suspendBtn.hidden = false;
    } else {
      activateBtn.hidden = false;
      suspendBtn.hidden = true;
    }
    // Reset password is always available regardless of account status — an
    // admin may need to help a SUSPENDED student too before re-activating them.
    resetPasswordBtn.hidden = false;
  }

  // ---- Enrollments -----------------------------------------------------------
  // ---- 1% Club membership card -------------------------------------------
  function renderMembership(m) {
    const statusCell = $('d-member-status');
    Dom.clear(statusCell);
    const wrap = $('member-purchases-wrap');
    const body = $('member-purchases-body');
    Dom.clear(body);
    if (m && m.isMember) {
      statusCell.appendChild(Ui.memberBadge());
      $('d-member-since').textContent = Dom.formatDate(m.since);
      wrap.hidden = false;
      for (const p of m.purchases) {
        body.appendChild(Dom.el('tr', {}, [
          Dom.el('td', {}, [Dom.el('span', { class: 'order-id', text: p.orderNumber })]),
          Dom.el('td', { text: p.plan ? p.plan.name : '—' }),
          Dom.el('td', {}, [Dom.el('div', { class: 'member-courses' }, (p.courses || []).map((t) => Dom.el('span', { class: 'member-course-chip', text: t })))]),
          Dom.el('td', { text: money(p.amount, p.currency) }),
          Dom.el('td', { text: Dom.formatDate(p.paidAt) }),
          Dom.el('td', {}, [Dom.el('a', { class: 'btn btn-outline btn-sm', href: `member-details.html?id=${encodeURIComponent(p.orderId)}`, text: 'Details' })]),
        ]));
      }
    } else {
      statusCell.textContent = 'Not a member';
      $('d-member-since').textContent = '—';
      wrap.hidden = true;
    }
  }

  function renderEnrollments(items) {
    const body = $('enrollments-body');
    Dom.clear(body);
    if (items.length === 0) {
      emptyBox($('enrollments-empty'), 'This student has no enrollments yet.');
      return;
    }
    $('enrollments-empty').hidden = true;
    for (const e of items) {
      // Swap only makes sense from an ACTIVE enrollment — a REVOKED row has
      // nothing left to swap out of (see
      // adminEnrollment.service.js#swapEnrollment's own ACTIVE precondition).
      const actionCell = Dom.el('td', {}, []);
      if (e.status === 'ACTIVE' && e.course) {
        const swapBtn = Dom.el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'Swap' });
        swapBtn.addEventListener('click', () => openSwapModal(e));
        actionCell.appendChild(swapBtn);
      }
      body.appendChild(Dom.el('tr', {}, [
        Dom.el('td', {}, [e.course ? Dom.el('span', { text: e.course.title }) : Dom.el('span', { class: 'cell-sub', text: 'Deleted course' })]),
        Dom.el('td', {}, [Ui.sourceBadge(e.source)]),
        Dom.el('td', {}, [Ui.statusBadge(e.status)]),
        Dom.el('td', { text: Dom.formatDate(e.enrolledAt) }),
        Dom.el('td', { text: e.completedAt ? Dom.formatDate(e.completedAt) : '—' }),
        actionCell,
      ]));
    }
  }

  /** Re-fetches and re-renders just the enrollments table after a swap. */
  async function reloadEnrollments() {
    try {
      const data = await StudentApi.enrollments(studentId);
      renderEnrollments(data.items);
    } catch (err) {
      fail(err);
    }
  }

  /**
   * Course-swap modal (adminEnrollment.service.js#swapEnrollment, via
   * StudentApi.swapCourse — see students-api.js). Works identically whether
   * this student is a 1% Club member or a regular buyer: `enrollment` is
   * just the row being swapped OUT of; the dropdown lists every
   * currently-published course (EnrollmentApi.courses(), the same selector
   * the Enrollments admin page's own course filter already uses) MINUS the
   * one being swapped out of, since swapping a course into itself is
   * rejected by the backend anyway.
   */
  function openSwapModal(enrollment) {
    const previouslyFocused = document.activeElement;
    const titleId = `swap-title-${Date.now()}`;
    const statusEl = Dom.el('p', { class: 'cell-sub', text: 'Loading courses…' });
    const courseSelect = Dom.el('select', { class: 'input', 'aria-label': 'New course', disabled: true }, []);
    const reasonInput = Dom.el('textarea', { class: 'input', maxlength: 500, rows: 2, 'aria-label': 'Reason (optional)' });

    const cancelBtn = Dom.el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'Cancel' });
    const saveBtn = Dom.el('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Swap course', disabled: true });

    const modal = Dom.el('div', { class: 'modal editor-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId }, [
      Dom.el('h3', { id: titleId, text: `Swap “${enrollment.course ? enrollment.course.title : 'this course'}”` }),
      Dom.el('p', { text: 'This student will lose access to the current course and gain access to the one you pick below.' }),
      Dom.el('div', { class: 'field' }, [
        Dom.el('label', { text: 'New course' }),
        statusEl,
        courseSelect,
      ]),
      Dom.el('div', { class: 'field' }, [
        Dom.el('label', { text: 'Reason (optional, visible to other admins)' }),
        reasonInput,
      ]),
      Dom.el('div', { class: 'modal-actions' }, [cancelBtn, saveBtn]),
    ]);
    const backdrop = Dom.el('div', { class: 'modal-backdrop' }, [modal]);

    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
      if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
    }
    function onKey(e) {
      if (e.key === 'Escape') close();
    }
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
    document.addEventListener('keydown', onKey);
    cancelBtn.addEventListener('click', close);
    document.body.appendChild(backdrop);

    // Load the course list, excluding the one being swapped out of.
    EnrollmentApi.courses()
      .then((data) => {
        const options = (data.courses || []).filter((c) => c.id !== enrollment.course.id);
        if (options.length === 0) {
          statusEl.textContent = 'No other published courses are available to swap into.';
          return;
        }
        Dom.clear(courseSelect);
        for (const c of options) {
          courseSelect.appendChild(Dom.el('option', { value: c.id, text: c.title }));
        }
        courseSelect.disabled = false;
        saveBtn.disabled = false;
        statusEl.hidden = true;
        courseSelect.focus();
      })
      .catch(() => {
        statusEl.textContent = 'Could not load the course list. Please close this and try again.';
      });

    let busy = false;
    saveBtn.addEventListener('click', async () => {
      if (busy || !courseSelect.value) return;
      busy = true;
      saveBtn.disabled = true;
      cancelBtn.disabled = true;
      try {
        await StudentApi.swapCourse(studentId, enrollment.course.id, courseSelect.value, reasonInput.value);
        close();
        Forms.showAlert(alertEl, 'Course swapped successfully.', 'success');
        await reloadEnrollments();
      } catch (err) {
        busy = false;
        saveBtn.disabled = false;
        cancelBtn.disabled = false;
        if (fail(err)) return;
      }
    });
  }

  // ---- Purchase history --------------------------------------------------
  function formatAmount(o) {
    const box = Dom.el('div', {}, [
      Dom.el('div', { class: 'order-amount order-amount-final', text: money(o.finalAmount) }),
    ]);
    if (o.discountAmount > 0) {
      box.appendChild(Dom.el('div', { class: 'order-amount-discount', text: `${money(o.originalAmount)} − ${money(o.discountAmount)}` }));
    }
    return box;
  }

  function orderCourseLabel(o) {
    if (o.kind === 'MEMBERSHIP') return Dom.el('span', { text: o.membershipPlan ? o.membershipPlan.name : '1% Club membership' });
    if (o.course) return Dom.el('span', { text: o.course.title });
    if (Array.isArray(o.courses) && o.courses.length) return Dom.el('span', { text: o.courses.map((c) => c.title).join(', ') });
    return Dom.el('span', { class: 'cell-sub', text: 'Deleted course' });
  }

  function renderOrders(items) {
    const body = $('orders-body');
    Dom.clear(body);
    if (items.length === 0) {
      emptyBox($('orders-empty'), 'This student has not purchased anything yet.');
      return;
    }
    $('orders-empty').hidden = true;
    for (const o of items) {
      body.appendChild(Dom.el('tr', {}, [
        Dom.el('td', {}, [Dom.el('span', { class: 'order-id', text: o.id })]),
        Dom.el('td', {}, [Ui.kindBadge(o.kind)]),
        Dom.el('td', {}, [orderCourseLabel(o)]),
        Dom.el('td', {}, [formatAmount(o)]),
        Dom.el('td', { text: o.couponCode || '—' }),
        Dom.el('td', {}, [Ui.paymentStatusBadge(o.status)]),
        Dom.el('td', { text: Dom.formatDate(o.createdAt) }),
        Dom.el('td', {}, [
          Dom.el('a', { class: 'btn btn-outline btn-sm', href: `order-details.html?id=${encodeURIComponent(o.id)}`, text: 'Details' }),
        ]),
      ]));
    }
  }

  // ---- Learning progress ---------------------------------------------------
  function renderProgress(items) {
    const body = $('progress-body');
    Dom.clear(body);
    if (items.length === 0) {
      emptyBox($('progress-empty'), 'This student has not started learning yet.');
      return;
    }
    $('progress-empty').hidden = true;
    for (const p of items) {
      body.appendChild(Dom.el('tr', {}, [
        Dom.el('td', {}, [p.course ? Dom.el('span', { text: p.course.title }) : Dom.el('span', { class: 'cell-sub', text: 'Deleted course' })]),
        Dom.el('td', { text: `${p.progress}%` }),
        Dom.el('td', { text: `${p.completedLessons} / ${p.totalLessons}` }),
        Dom.el('td', { text: p.completed ? 'Completed' : 'In progress' }),
      ]));
    }
  }


  // ---- Password Reset Modal ---------------------------------------------------
  // A small self-contained flow: open modal → validate passwords client-side →
  // confirm → POST to backend → close modal → show success alert on page.
  // The modal is its own isolated scope; it never touches actionBusy because
  // a reset is not a status-changing action (it does not alter account status)
  // and can run independently even while activate/suspend is busy (though in
  // practice both UI paths require the student to be fully loaded first).

  const resetModal = $('reset-password-modal');
  const rpModalDesc = $('rp-modal-desc');
  const rpModalAlert = $('rp-modal-alert');
  const rpNewPassword = $('rp-new-password');
  const rpConfirmPassword = $('rp-confirm-password');
  const rpCancelBtn = $('rp-cancel-btn');
  const rpSubmitBtn = $('rp-submit-btn');
  let resetBusy = false;

  function openResetModal() {
    if (!currentStudent) return;
    rpModalDesc.textContent = `Set a new password for "${currentStudent.fullName}". Their existing sessions will be signed out immediately.`;
    rpNewPassword.value = '';
    rpConfirmPassword.value = '';
    rpModalAlert.hidden = true;
    rpModalAlert.textContent = '';
    resetModal.hidden = false;
    rpNewPassword.focus();
  }

  function closeResetModal() {
    resetModal.hidden = true;
    resetBusy = false;
    rpSubmitBtn.disabled = false;
    rpCancelBtn.disabled = false;
    resetPasswordBtn.focus();
  }

  function showModalAlert(text, type) {
    rpModalAlert.textContent = text;
    rpModalAlert.className = `alert alert-${type}`;
    rpModalAlert.hidden = false;
    rpModalAlert.focus();
  }

  resetPasswordBtn.addEventListener('click', openResetModal);
  rpCancelBtn.addEventListener('click', closeResetModal);

  // Close on backdrop click
  resetModal.addEventListener('mousedown', (e) => {
    if (e.target === resetModal) closeResetModal();
  });

  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !resetModal.hidden) closeResetModal();
  });

  rpSubmitBtn.addEventListener('click', async () => {
    if (resetBusy || !currentStudent) return;

    const newPwd = rpNewPassword.value;
    const confirmPwd = rpConfirmPassword.value;

    // Client-side validation (mirrors the Zod schema on the backend)
    if (!newPwd || newPwd.length < 8) {
      showModalAlert('New password must be at least 8 characters.', 'error');
      rpNewPassword.focus();
      return;
    }
    if (newPwd.length > 128) {
      showModalAlert('Password must be at most 128 characters.', 'error');
      rpNewPassword.focus();
      return;
    }
    if (newPwd !== confirmPwd) {
      showModalAlert('Passwords do not match.', 'error');
      rpConfirmPassword.focus();
      return;
    }

    resetBusy = true;
    rpSubmitBtn.disabled = true;
    rpCancelBtn.disabled = true;
    showModalAlert('Resetting password…', 'info');

    try {
      await StudentApi.resetPassword(currentStudent.id, newPwd);
      closeResetModal();
      Forms.showAlert(alertEl, `Password reset successfully for "${currentStudent.fullName}". They have been signed out of all devices.`, 'success');
      alertEl.focus();
    } catch (err) {
      resetBusy = false;
      rpSubmitBtn.disabled = false;
      rpCancelBtn.disabled = false;
      if (Auth.handleSessionError(err)) return;
      showModalAlert(Ui.messageForError(err, 'student'), 'error');
    }
  });

  // ---- Activate / Suspend actions -------------------------------------------
  const ACTIONS = {
    suspend: {
      call: StudentApi.suspend, pending: 'Suspending…', done: (s) => `“${s.fullName}” suspended.`,
      confirm: (s) => ({
        title: 'Suspend this student?',
        message: `“${s.fullName}” will lose access immediately, including any active session. This can be reversed at any time.`,
        confirmLabel: 'Suspend',
        danger: true,
      }),
    },
    activate: {
      call: StudentApi.activate, pending: 'Activating…', done: (s) => `“${s.fullName}” activated.`,
      confirm: (s) => ({
        title: 'Activate this student?',
        message: `“${s.fullName}” will regain full access to their account.`,
        confirmLabel: 'Activate',
      }),
    },
  };

  async function runAction(name) {
    if (actionBusy || !currentStudent) return;
    const spec = ACTIONS[name];
    if (!(await Ui.confirm(spec.confirm(currentStudent)))) return;

    actionBusy = true;
    activateBtn.disabled = true;
    suspendBtn.disabled = true;
    Forms.showAlert(alertEl, spec.pending, 'info');
    try {
      const data = await spec.call(currentStudent.id);
      renderStudent(data.student);
      Forms.showAlert(alertEl, spec.done(data.student), 'success');
    } catch (err) {
      if (fail(err)) return;
      if (err instanceof ApiError && err.status === 404) {
        showLoad('Student not found', 'This student may have been removed.');
        content.hidden = true;
      }
    } finally {
      actionBusy = false;
      activateBtn.disabled = false;
      suspendBtn.disabled = false;
    }
  }

  suspendBtn.addEventListener('click', () => runAction('suspend'));
  activateBtn.addEventListener('click', () => runAction('activate'));

  // ---- Initial load: four independent reads in parallel ---------------------
  if (!studentId) {
    showLoad('No student specified', 'Open a student from the Students list to see their details.');
    return;
  }

  showLoad('Loading…', 'Please wait.');
  try {
    const [studentData, enrollmentsData, ordersData, progressData] = await Promise.all([
      StudentApi.get(studentId),
      StudentApi.enrollments(studentId),
      StudentApi.orders(studentId),
      StudentApi.progress(studentId),
    ]);

    renderStudent(studentData.student);
    renderEnrollments(enrollmentsData.items);
    renderOrders(ordersData.items);
    renderProgress(progressData.items);

    loadState.hidden = true;
    content.hidden = false;
  } catch (err) {
    if (fail(err)) return;
    const notFound = err instanceof ApiError && (err.status === 404 || err.status === 400);
    showLoad(notFound ? 'Student not found' : 'Could not load this student', notFound ? 'This student does not exist or was removed.' : 'Check your connection and try again.');
  }
})();
