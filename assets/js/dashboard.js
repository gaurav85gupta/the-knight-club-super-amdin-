/**
 * Super Admin Dashboard page controller (Phase 24).
 *
 * ONE request (DashboardApi.get()) returns everything the page renders:
 * stats + recentStudents + recentOrders + recentEnrollments +
 * recentActivity, each independently fetched server-side (see
 * adminDashboard.service.js). `errors` (if present) names which section(s)
 * failed on the backend; those sections render their own error state while
 * everything that succeeded still renders normally (spec "FAILURE
 * ISOLATION").
 *
 * LOADING STATE (spec "LOADING STATE"): stat cards show a loading dash,
 * never a fake "0", until the real response arrives.
 *
 * ZERO STATE (spec "ZERO STATE"): a legitimate 0 is rendered as "0", not
 * "N/A"/blank — Number.isFinite distinguishes "not loaded yet" (undefined)
 * from "genuinely zero".
 *
 * All dynamic text goes through Dom.el/textContent (see dom.js) — never
 * innerHTML — so nothing the server returns can be interpreted as markup.
 *
 * SESSION EXPIRY: any 401/403 from the API call goes through
 * Auth.handleSessionError(), which clears state and returns to login.
 */

(async function initDashboard() {
  const admin = await Auth.requireAuth();
  document.documentElement.classList.remove('auth-pending');
  document.getElementById('admin-identity').textContent = admin.name;

  const logoutBtn = document.getElementById('logout-btn');
  let signingOut = false;
  logoutBtn.addEventListener('click', async () => {
    if (signingOut) return;
    signingOut = true;
    logoutBtn.disabled = true;
    await Auth.logout();
    window.location.replace(Auth.urlFor(Auth.PATHS.login));
  });

  const $ = (id) => document.getElementById(id);
  const els = {
    alert: $('page-alert'),
    statsGrid: $('stats-grid'),
    students: $('recent-students-body'),
    studentsState: $('recent-students-state'),
    orders: $('recent-orders-body'),
    ordersState: $('recent-orders-state'),
    enrollments: $('recent-enrollments-body'),
    enrollmentsState: $('recent-enrollments-state'),
    activity: $('recent-activity-list'),
    activityState: $('recent-activity-state'),
  };

  function fail(err) {
    if (Auth.handleSessionError(err)) return true;
    Forms.showAlert(els.alert, Ui.messageForError(err, 'dashboard'), 'error');
    els.alert.focus();
    return false;
  }

  function money(paise) {
    return `₹${Dom.paiseToRupees(paise || 0)}`;
  }

  // ---- Stat cards -----------------------------------------------------------
  const STAT_DEFS = [
    { key: 'totalStudents', label: 'Total students', fmt: String },
    { key: 'totalCourses', label: 'Total courses', fmt: String },
    { key: 'publishedCourses', label: 'Published courses', fmt: String },
    { key: 'totalEnrollments', label: 'Total enrollments', fmt: String },
    { key: 'totalOrders', label: 'Total orders', fmt: String },
    { key: 'successfulPayments', label: 'Successful payments', fmt: String },
    { key: 'revenue', label: 'Revenue', fmt: money },
    { key: 'couponUsage', label: 'Coupon usage', fmt: String },
  ];

  /**
   * One stat card. PRESENTATION ONLY (Phase 3): the label/value text is exactly
   * what the page rendered before; `data-stat` + the decorative icon span just
   * give the stylesheet something to hang the icon on. `stateClass` is
   * "is-loading" / "is-unavailable" purely for styling.
   */
  function buildStatCard(def, value, stateClass) {
    return Dom.el('div', { class: stateClass ? `stat-card ${stateClass}` : 'stat-card', 'data-stat': def.key }, [
      Dom.el('div', { class: 'stat-head' }, [
        Dom.el('div', { class: 'stat-label', text: def.label }),
        Dom.el('span', { class: 'stat-icon', 'aria-hidden': 'true' }),
      ]),
      Dom.el('div', { class: 'stat-value', text: value }),
    ]);
  }

  function renderStatsLoading() {
    Dom.clear(els.statsGrid);
    for (const def of STAT_DEFS) {
      els.statsGrid.appendChild(buildStatCard(def, '—', 'is-loading'));
    }
  }

  function renderStats(stats) {
    Dom.clear(els.statsGrid);
    if (!stats) {
      els.statsGrid.appendChild(buildStatCard({ key: 'unavailable', label: 'Statistics' }, 'Unavailable', 'is-unavailable'));
      return;
    }
    for (const def of STAT_DEFS) {
      const raw = stats[def.key];
      // Number.isFinite(0) is true, so a real zero still renders "0" — only
      // a genuinely missing value falls back to the em dash (spec "ZERO
      // STATE" vs "LOADING STATE").
      const value = Number.isFinite(raw) ? def.fmt(raw) : '—';
      els.statsGrid.appendChild(buildStatCard(def, value));
    }
  }

  // ---- Section state helpers -------------------------------------------------
  function showEmptyState(stateEl, text) {
    Dom.clear(stateEl);
    stateEl.appendChild(Dom.el('p', { text }));
    stateEl.hidden = false;
  }

  function showErrorState(stateEl, noun) {
    Dom.clear(stateEl);
    stateEl.appendChild(Dom.el('p', { class: 'dashboard-error-note', text: `Unable to load ${noun}.` }));
    stateEl.hidden = false;
  }

  function hideState(stateEl) {
    stateEl.hidden = true;
    Dom.clear(stateEl);
  }

  // ---- Recent Students --------------------------------------------------------
  function renderRecentStudents(students) {
    if (students === null) {
      Dom.clear(els.students);
      showErrorState(els.studentsState, 'recent students');
      return;
    }
    hideState(els.studentsState);
    Dom.clear(els.students);
    if (students.length === 0) {
      showEmptyState(els.studentsState, 'No students yet.');
      return;
    }
    for (const s of students) {
      els.students.appendChild(
        Dom.el('tr', {}, [
          Dom.el('td', { text: s.fullName }),
          Dom.el('td', { text: s.userId }),
          Dom.el('td', {}, [Ui.statusBadge(s.status)]),
          Dom.el('td', { text: Dom.formatDate(s.createdAt) }),
        ])
      );
    }
  }

  // ---- Recent Orders -----------------------------------------------------------
  function renderRecentOrders(orders) {
    if (orders === null) {
      Dom.clear(els.orders);
      showErrorState(els.ordersState, 'recent orders');
      return;
    }
    hideState(els.ordersState);
    Dom.clear(els.orders);
    if (orders.length === 0) {
      showEmptyState(els.ordersState, 'No orders yet.');
      return;
    }
    for (const o of orders) {
      els.orders.appendChild(
        Dom.el('tr', {}, [
          Dom.el('td', { text: o.student ? o.student.fullName : '—' }),
          Dom.el('td', { text: o.course ? o.course.title : '—' }),
          Dom.el('td', { text: money(o.finalAmount) }),
          Dom.el('td', {}, [Ui.paymentStatusBadge(o.status)]),
          Dom.el('td', { text: Dom.formatDate(o.createdAt) }),
        ])
      );
    }
  }

  // ---- Recent Enrollments -------------------------------------------------------
  function renderRecentEnrollments(enrollments) {
    if (enrollments === null) {
      Dom.clear(els.enrollments);
      showErrorState(els.enrollmentsState, 'recent enrollments');
      return;
    }
    hideState(els.enrollmentsState);
    Dom.clear(els.enrollments);
    if (enrollments.length === 0) {
      showEmptyState(els.enrollmentsState, 'No enrollments yet.');
      return;
    }
    for (const e of enrollments) {
      els.enrollments.appendChild(
        Dom.el('tr', {}, [
          Dom.el('td', { text: e.student ? e.student.fullName : '—' }),
          Dom.el('td', { text: e.course ? e.course.title : '—' }),
          Dom.el('td', {}, [Ui.statusBadge(e.status)]),
          Dom.el('td', { text: Dom.formatDate(e.enrolledAt) }),
        ])
      );
    }
  }

  // ---- Recent Activity -----------------------------------------------------------
  /** ADMIN_EVENT_TYPES value ("COURSE_PUBLISHED") -> "Course published". */
  function labelForEventType(type) {
    const s = String(type || '').toLowerCase().replace(/_/g, ' ');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /**
   * Renders an event's already-allow-listed `meta` as "key: value, ...".
   * Raw internal identifiers are noise for an operator (and session ids
   * should not be displayed at all), so: sessionId is hidden, and any other
   * *Id value is shortened to its last 6 characters.
   */
  function metaText(meta) {
    if (!meta || typeof meta !== 'object') return '';
    const parts = Object.entries(meta)
      .filter(([k, v]) => v !== undefined && v !== null && v !== '' && k.toLowerCase() !== 'sessionid')
      .map(([k, v]) => {
        const isId = /id$/i.test(k) && typeof v === 'string' && v.length > 8;
        const label = k.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
        return `${label}: ${isId ? '…' + v.slice(-6) : v}`;
      });
    return parts.join(' · ');
  }

  function renderRecentActivity(events) {
    if (events === null) {
      Dom.clear(els.activity);
      showErrorState(els.activityState, 'recent activity');
      return;
    }
    hideState(els.activityState);
    Dom.clear(els.activity);
    if (events.length === 0) {
      showEmptyState(els.activityState, 'No recent activity.');
      return;
    }
    for (const e of events) {
      const meta = metaText(e.meta);
      els.activity.appendChild(
        Dom.el('li', { class: 'activity-item' }, [
          Dom.el('div', { class: 'activity-item-top' }, [
            Dom.el('span', { class: 'activity-label', text: labelForEventType(e.type) }),
            Dom.el('span', { class: 'activity-time', text: Dom.formatDateTime(e.createdAt) }),
          ]),
          meta ? Dom.el('div', { class: 'activity-meta', text: meta }) : null,
        ])
      );
    }
  }

  // ---- Load -------------------------------------------------------------------
  renderStatsLoading();
  for (const stateEl of [els.studentsState, els.ordersState, els.enrollmentsState, els.activityState]) {
    showEmptyState(stateEl, 'Loading…');
  }

  try {
    const data = await DashboardApi.get();
    renderStats(data.stats);
    renderRecentStudents(data.recentStudents);
    renderRecentOrders(data.recentOrders);
    renderRecentEnrollments(data.recentEnrollments);
    renderRecentActivity(data.recentActivity);

    if (data.errors) {
      const failedSections = Object.keys(data.errors).join(', ');
      Forms.showAlert(els.alert, `Some dashboard sections could not be loaded: ${failedSections}.`, 'error');
    }
  } catch (err) {
    if (fail(err)) return;
    renderStats(null);
    renderRecentStudents(null);
    renderRecentOrders(null);
    renderRecentEnrollments(null);
    renderRecentActivity(null);
  }
})();
