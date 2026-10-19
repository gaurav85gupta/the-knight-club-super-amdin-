/**
 * Super Admin Analytics & Intelligence page controller (Phase 25).
 *
 * Fetches each section (students/courses/revenue/learning) independently,
 * mirroring the failure-isolation pattern dashboard.js already uses: one
 * section failing to load never blocks the others (spec "FAILURE
 * ISOLATION" / Step 28 error states). All dynamic text goes through
 * Dom.el/textContent — never innerHTML (spec Step 78 discipline already
 * established by dom.js).
 *
 * FILTERS (spec Step 8-12): one shared date-range + course/category/
 * instructor filter bar drives every section. Changing any filter re-fetches
 * every currently-relevant section (spec Step 9: "changing the date range
 * must refresh relevant analytics").
 *
 * LOADING / EMPTY / ERROR STATES (spec Step 26-28): a loading state is
 * shown before the first response; a genuine empty series shows "No data
 * available for selected period." (never a fake zero-filled chart); a
 * failed request shows an inline error box, never a stale chart pretending
 * to be current.
 */

(async function initAnalytics() {
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
    fDate: $('f-date'),
    fDateFrom: $('f-date-from'),
    fDateTo: $('f-date-to'),
    fCourse: $('f-course'),
    fCategory: $('f-category'),
    fInstructor: $('f-instructor'),
    fReset: $('f-reset'),
    tabs: Array.from(document.querySelectorAll('.analytics-tab')),
    panels: {
      students: $('panel-students'),
      courses: $('panel-courses'),
      revenue: $('panel-revenue'),
      learning: $('panel-learning'),
    },
  };

  function fail(err) {
    if (Auth.handleSessionError(err)) return true;
    Forms.showAlert(els.alert, Ui.messageForError(err, 'analytics'), 'error');
    els.alert.focus();
    return false;
  }

  function money(paise) {
    return `₹${Dom.paiseToRupees(paise || 0)}`;
  }

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

  // ---- Tabs (spec Step 23: one section visible at a time) --------------------
  els.tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      els.tabs.forEach((t) => {
        t.classList.toggle('active', t === tab);
        t.setAttribute('aria-selected', String(t === tab));
      });
      Object.entries(els.panels).forEach(([key, panel]) => {
        panel.hidden = key !== tab.dataset.tab;
      });
    });
  });

  // ---- Filters -----------------------------------------------------------
  els.fDate.addEventListener('change', () => {
    const isCustom = els.fDate.value === 'custom';
    els.fDateFrom.hidden = !isCustom;
    els.fDateTo.hidden = !isCustom;
    if (!isCustom) loadAll();
  });
  els.fDateFrom.addEventListener('change', () => { if (els.fDate.value === 'custom') loadAll(); });
  els.fDateTo.addEventListener('change', () => { if (els.fDate.value === 'custom') loadAll(); });
  els.fCourse.addEventListener('change', loadAll);
  els.fCategory.addEventListener('change', loadAll);
  els.fInstructor.addEventListener('change', loadAll);
  els.fReset.addEventListener('click', () => {
    els.fDate.value = 'last30days';
    els.fDateFrom.value = '';
    els.fDateTo.value = '';
    els.fDateFrom.hidden = true;
    els.fDateTo.hidden = true;
    els.fCourse.value = '';
    els.fCategory.value = '';
    els.fInstructor.value = '';
    loadAll();
  });

  function currentFilters() {
    const filters = { dateFilter: els.fDate.value };
    if (els.fDate.value === 'custom') {
      if (els.fDateFrom.value) filters.dateFrom = new Date(els.fDateFrom.value).toISOString();
      if (els.fDateTo.value) filters.dateTo = new Date(els.fDateTo.value).toISOString();
    }
    if (els.fCourse.value) filters.course = els.fCourse.value;
    if (els.fCategory.value) filters.category = els.fCategory.value;
    if (els.fInstructor.value) filters.instructor = els.fInstructor.value;
    return filters;
  }

  async function loadFilterOptions() {
    try {
      const opts = await AnalyticsApi.options();
      for (const c of opts.courses) els.fCourse.appendChild(Dom.el('option', { value: c.id, text: c.title }));
      for (const c of opts.categories) els.fCategory.appendChild(Dom.el('option', { value: c.id, text: c.name }));
      for (const i of opts.instructors) els.fInstructor.appendChild(Dom.el('option', { value: i.id, text: i.name }));
    } catch (err) {
      // Non-fatal: filters simply stay at "All ..." if options fail to load.
    }
  }

  // ---- Students section ----------------------------------------------------
  const STUDENT_STAT_DEFS = [
    { key: 'activeStudents', label: 'Active students', get: (d) => d.activeStudents && d.activeStudents.count },
    { key: 'completionRate', label: 'Completion rate', get: (d) => d.completionRate && d.completionRate.completionRate, fmt: (v) => `${v}%` },
    { key: 'totalEnrollments', label: 'Enrollments (in range)', get: (d) => d.completionRate && d.completionRate.totalEnrollments },
  ];

  function renderStudentStats(data) {
    Dom.clear($('students-stats-grid'));
    for (const def of STUDENT_STAT_DEFS) {
      const raw = def.get(data);
      const value = Number.isFinite(raw) ? (def.fmt ? def.fmt(raw) : String(raw)) : '—';
      $('students-stats-grid').appendChild(
        Dom.el('div', { class: 'stat-card' }, [
          Dom.el('div', { class: 'stat-label', text: def.label }),
          Dom.el('div', { class: 'stat-value', text: value }),
        ])
      );
    }
  }

  async function loadStudents() {
    hideState($('state-registrations'));
    hideState($('state-enrollments'));
    try {
      const data = await AnalyticsApi.students(currentFilters());
      renderStudentStats(data);

      if (data.registrationTrends.length === 0) {
        AnalyticsCharts.emptyState($('chart-registrations'));
        showEmptyState($('state-registrations'), 'No data available for selected period.');
      } else {
        AnalyticsCharts.lineChart(
          $('chart-registrations'),
          data.registrationTrends.map((r) => ({ label: r.period, value: r.count }))
        );
      }

      if (data.enrollmentTrends.length === 0) {
        AnalyticsCharts.emptyState($('chart-enrollments'));
        showEmptyState($('state-enrollments'), 'No data available for selected period.');
      } else {
        AnalyticsCharts.lineChart(
          $('chart-enrollments'),
          data.enrollmentTrends.map((r) => ({ label: r.period, value: r.count }))
        );
      }
    } catch (err) {
      if (fail(err)) return;
      renderStudentStats({});
      AnalyticsCharts.emptyState($('chart-registrations'));
      AnalyticsCharts.emptyState($('chart-enrollments'));
      showErrorState($('state-registrations'), 'registration trends');
      showErrorState($('state-enrollments'), 'enrollment trends');
    }
  }

  // ---- Courses section -------------------------------------------------------
  function renderEnrollmentPerCourseTable(rows) {
    const tbody = document.querySelector('#table-enrollment-per-course tbody');
    Dom.clear(tbody);
    for (const r of rows) {
      tbody.appendChild(Dom.el('tr', {}, [Dom.el('td', { text: r.title }), Dom.el('td', { text: String(r.enrollments) })]));
    }
  }

  function renderCompletionPerCourseTable(rows) {
    const tbody = document.querySelector('#table-completion-per-course tbody');
    Dom.clear(tbody);
    for (const r of rows) {
      tbody.appendChild(
        Dom.el('tr', {}, [
          Dom.el('td', { text: r.title }),
          Dom.el('td', { text: String(r.enrolled) }),
          Dom.el('td', { text: String(r.completed) }),
          Dom.el('td', { text: `${r.completionRate}%` }),
        ])
      );
    }
  }

  function renderEngagementTable(rows) {
    const tbody = document.querySelector('#table-engagement tbody');
    Dom.clear(tbody);
    for (const r of rows) {
      tbody.appendChild(Dom.el('tr', {}, [Dom.el('td', { text: r.title }), Dom.el('td', { text: String(r.engagedStudents) })]));
    }
  }

  async function loadCourses() {
    hideState($('state-enrollment-per-course'));
    hideState($('state-completion-per-course'));
    hideState($('state-engagement'));
    try {
      const data = await AnalyticsApi.courses(currentFilters());

      if (data.enrollmentPerCourse.length === 0) showEmptyState($('state-enrollment-per-course'), 'No data available for selected period.');
      renderEnrollmentPerCourseTable(data.enrollmentPerCourse);

      if (data.completionPerCourse.length === 0) showEmptyState($('state-completion-per-course'), 'No data available for selected period.');
      renderCompletionPerCourseTable(data.completionPerCourse);

      $('engagement-definition').textContent = data.engagement.definition;
      if (data.engagement.courses.length === 0) showEmptyState($('state-engagement'), 'No data available for selected period.');
      renderEngagementTable(data.engagement.courses);
    } catch (err) {
      if (fail(err)) return;
      showErrorState($('state-enrollment-per-course'), 'course enrollment data');
      showErrorState($('state-completion-per-course'), 'course completion data');
      showErrorState($('state-engagement'), 'course engagement data');
    }
  }

  // ---- Revenue section -------------------------------------------------------
  function renderRevenueStats(data) {
    const grid = $('revenue-stats-grid');
    Dom.clear(grid);
    const daily = data.daily || [];
    const couponImpact = data.couponImpact || { couponRevenue: 0, nonCouponRevenue: 0 };
    const totalRevenue = daily.reduce((s, r) => s + r.revenue, 0);
    const totalOrders = daily.reduce((s, r) => s + r.orders, 0);
    const defs = [
      { label: 'Revenue (in range)', value: money(totalRevenue) },
      { label: 'Orders (in range)', value: String(totalOrders) },
      { label: 'Coupon revenue', value: money(couponImpact.couponRevenue) },
      { label: 'Non-coupon revenue', value: money(couponImpact.nonCouponRevenue) },
    ];
    for (const def of defs) {
      grid.appendChild(
        Dom.el('div', { class: 'stat-card' }, [
          Dom.el('div', { class: 'stat-label', text: def.label }),
          Dom.el('div', { class: 'stat-value', text: def.value }),
        ])
      );
    }
  }

  function renderRevenueDailyTable(rows) {
    const tbody = document.querySelector('#table-revenue-daily tbody');
    Dom.clear(tbody);
    for (const r of rows) {
      tbody.appendChild(
        Dom.el('tr', {}, [
          Dom.el('td', { text: r.period }),
          Dom.el('td', { text: String(r.orders) }),
          Dom.el('td', { text: money(r.revenue) }),
          Dom.el('td', { text: money(r.discount) }),
        ])
      );
    }
  }

  function renderCourseRevenueTable(rows) {
    const tbody = document.querySelector('#table-course-revenue tbody');
    Dom.clear(tbody);
    for (const r of rows) {
      tbody.appendChild(
        Dom.el('tr', {}, [Dom.el('td', { text: r.title }), Dom.el('td', { text: String(r.orders) }), Dom.el('td', { text: money(r.revenue) })])
      );
    }
  }

  function renderCouponImpactSummary(impact) {
    const grid = $('coupon-impact-summary');
    Dom.clear(grid);
    const defs = [
      { label: 'Coupon orders', value: String(impact.couponOrders) },
      { label: 'Non-coupon orders', value: String(impact.nonCouponOrders) },
      { label: 'Discount given', value: money(impact.discountGiven) },
    ];
    for (const def of defs) {
      grid.appendChild(
        Dom.el('div', { class: 'stat-card' }, [
          Dom.el('div', { class: 'stat-label', text: def.label }),
          Dom.el('div', { class: 'stat-value', text: def.value }),
        ])
      );
    }
  }

  function renderCouponImpactTable(rows) {
    const tbody = document.querySelector('#table-coupon-impact tbody');
    Dom.clear(tbody);
    for (const r of rows) {
      tbody.appendChild(
        Dom.el('tr', {}, [
          Dom.el('td', { text: r.code }),
          Dom.el('td', { text: String(r.uses) }),
          Dom.el('td', { text: money(r.discountAmount) }),
          Dom.el('td', { text: money(r.revenue) }),
        ])
      );
    }
  }

  async function loadRevenue() {
    hideState($('state-revenue'));
    hideState($('state-course-revenue'));
    hideState($('state-coupon-impact'));
    try {
      const data = await AnalyticsApi.revenue(currentFilters());
      renderRevenueStats(data);

      if (data.daily.length === 0) {
        AnalyticsCharts.emptyState($('chart-revenue'));
        showEmptyState($('state-revenue'), 'No data available for selected period.');
      } else {
        AnalyticsCharts.barChart(
          $('chart-revenue'),
          data.daily.map((r) => ({ label: r.period, value: r.revenue })),
          { valueFormatter: (v) => Dom.paiseToRupees(v).split('.')[0] }
        );
      }
      renderRevenueDailyTable(data.daily);

      if (data.courseWise.length === 0) showEmptyState($('state-course-revenue'), 'No data available for selected period.');
      renderCourseRevenueTable(data.courseWise);

      renderCouponImpactSummary(data.couponImpact);
      if (data.couponImpact.byCoupon.length === 0) showEmptyState($('state-coupon-impact'), 'No coupon redemptions in this period.');
      renderCouponImpactTable(data.couponImpact.byCoupon);
    } catch (err) {
      if (fail(err)) return;
      renderRevenueStats({ daily: [], couponImpact: { couponRevenue: 0, nonCouponRevenue: 0 } });
      AnalyticsCharts.emptyState($('chart-revenue'));
      showErrorState($('state-revenue'), 'revenue data');
      showErrorState($('state-course-revenue'), 'course revenue data');
      showErrorState($('state-coupon-impact'), 'coupon impact data');
    }
  }

  // ---- Learning section -------------------------------------------------------
  function renderProgressDistribution(dist) {
    const container = $('progress-distribution');
    Dom.clear(container);
    const max = Math.max(1, ...dist.map((b) => b.count));
    for (const band of dist) {
      const pct = Math.round((band.count / max) * 100);
      container.appendChild(
        Dom.el('div', { class: 'progress-distribution-row' }, [
          Dom.el('span', { text: band.label }),
          Dom.el('div', { class: 'progress-distribution-bar-track' }, [
            Dom.el('div', { class: 'progress-distribution-bar-fill', style: `width:${pct}%` }),
          ]),
          Dom.el('span', { text: String(band.count) }),
        ])
      );
    }
  }

  function renderLearningCompletionStats(overall) {
    const grid = $('learning-completion-stats');
    Dom.clear(grid);
    const defs = [
      { label: 'Total enrollments', value: String(overall.totalEnrollments) },
      { label: 'Completed', value: String(overall.completedEnrollments) },
      { label: 'Completion rate', value: `${overall.completionRate}%` },
    ];
    for (const def of defs) {
      grid.appendChild(
        Dom.el('div', { class: 'stat-card' }, [
          Dom.el('div', { class: 'stat-label', text: def.label }),
          Dom.el('div', { class: 'stat-value', text: def.value }),
        ])
      );
    }
  }

  function renderDropOff(dropOff) {
    const empty = $('dropoff-empty');
    const chartWrap = $('dropoff-chart-wrap');
    const tableWrap = $('dropoff-table-wrap');

    if (!dropOff.available) {
      empty.hidden = false;
      Dom.clear(empty);
      empty.appendChild(Dom.el('p', { text: dropOff.reason }));
      chartWrap.hidden = true;
      tableWrap.hidden = true;
      return;
    }

    if (dropOff.lessons.length === 0) {
      chartWrap.hidden = true;
      tableWrap.hidden = true;
      empty.hidden = false;
      Dom.clear(empty);
      empty.appendChild(Dom.el('p', { text: 'No data available for selected period.' }));
      return;
    }

    empty.hidden = true;
    chartWrap.hidden = false;
    tableWrap.hidden = false;
    AnalyticsCharts.barChart(
      $('chart-dropoff'),
      dropOff.lessons.map((l) => ({ label: l.title, value: l.completionRate })),
      { valueFormatter: (v) => `${v}%` }
    );

    const tbody = document.querySelector('#table-dropoff tbody');
    Dom.clear(tbody);
    for (const l of dropOff.lessons) {
      tbody.appendChild(
        Dom.el('tr', {}, [Dom.el('td', { text: l.title }), Dom.el('td', { text: String(l.completed) }), Dom.el('td', { text: `${l.completionRate}%` })])
      );
    }
  }

  async function loadLearning() {
    hideState($('state-progress'));
    try {
      const data = await AnalyticsApi.learning(currentFilters());

      if (data.progress.distribution.length === 0 || data.progress.sampledEnrollments === 0) {
        showEmptyState($('state-progress'), 'No data available for selected period.');
        renderProgressDistribution([]);
      } else {
        renderProgressDistribution(data.progress.distribution);
      }

      renderLearningCompletionStats(data.completion.overall);
      renderDropOff(data.dropOff);
    } catch (err) {
      if (fail(err)) return;
      showErrorState($('state-progress'), 'progress data');
      renderLearningCompletionStats({ totalEnrollments: 0, completedEnrollments: 0, completionRate: 0 });
      renderDropOff({ available: false, reason: 'Unable to load drop-off data.' });
    }
  }

  // ---- Load everything. Only the active tab is fetched eagerly; the rest
  // load lazily on first visit to reduce work spent on hidden panels (spec
  // Step 31: no unnecessary query load on every page view). ----------------
  const loadedTabs = new Set();
  const loaders = { students: loadStudents, courses: loadCourses, revenue: loadRevenue, learning: loadLearning };

  async function loadTab(tab) {
    loadedTabs.add(tab);
    await loaders[tab]();
  }

  async function loadAll() {
    Forms.hideAlert(els.alert);
    loadedTabs.clear();
    const activeTabEl = els.tabs.find((t) => t.classList.contains('active'));
    const activeTab = activeTabEl ? activeTabEl.dataset.tab : 'students';
    await loadTab(activeTab);
  }

  els.tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      if (!loadedTabs.has(tab.dataset.tab)) loadTab(tab.dataset.tab);
    });
  });

  await loadFilterOptions();
  await loadAll();
})();
