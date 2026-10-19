/**
 * Super Admin — 1% Club Management page controller (Phase 38).
 *
 * =========================================================================
 * DESIGN PRINCIPLES
 * =========================================================================
 *
 * 1. ONE source of truth — every value displayed comes from the backend
 *    MembershipPlan document. No local state is shown unless it came from
 *    the server or was explicitly typed by the admin in this session.
 *
 * 2. Server controls all purchase-critical values — the page never tries
 *    to enforce business logic; it shows validation errors FROM the backend
 *    and provides light UX feedback (e.g. warning when selectionLimit >
 *    eligible course count). The backend is always authoritative.
 *
 * 3. No status via PATCH — activate/deactivate are dedicated actions that
 *    call their own endpoints. The save button never touches status.
 *
 * 4. Safe rendering — all text set via textContent / Dom.el. Never
 *    innerHTML with untrusted data.
 *
 * 5. No duplicate architecture — uses the existing MembershipApi module
 *    which wraps the Phase 35 admin endpoints unchanged.
 *
 * =========================================================================
 * PAGE FLOW
 * =========================================================================
 *
 *   1. Auth guard (Auth.requireAuth)
 *   2. Parallel load: GET /admin/memberships + GET /admin/courses
 *   3. If a plan exists, populate form with plan data.
 *      If no plan yet, show empty "Create plan" form.
 *   4. Admin edits fields → Save → PATCH (or POST if new) → re-render.
 *   5. Activate / Deactivate → dedicated action endpoints.
 *
 * =========================================================================
 * COURSE PICKER
 * =========================================================================
 *
 * The eligible-courses picker shows all courses from the admin catalog.
 * Admin checks/unchecks courses to add/remove them from the plan.
 * The picker includes a search filter for large course catalogs.
 *
 * Selected courses are shown as removable chips below the picker.
 * The selectionLimit field shows a live warning when its value exceeds
 * the number of selected courses (UX only; backend enforces the rule).
 *
 * =========================================================================
 * BENEFITS EDITOR
 * =========================================================================
 *
 * A dynamic list of text inputs, one per benefit. Admin can:
 *   - type into any row
 *   - add a new row (Add benefit button)
 *   - delete a row (× button per row)
 *
 * The array is sent as benefits: [...] in the PATCH body.
 */

(async function initMembershipPage() {
  'use strict';

  // ---- Auth guard ----------------------------------------------------------

  const admin = await Auth.requireAuth(); // redirects if not signed in
  document.documentElement.classList.remove('auth-pending');
  document.getElementById('admin-identity').textContent = admin.name;

  document.getElementById('logout-btn').addEventListener('click', async () => {
    document.getElementById('logout-btn').disabled = true;
    await Auth.logout();
    window.location.replace(Auth.urlFor(Auth.PATHS.login));
  });

  // ---- DOM references ------------------------------------------------------

  const $ = (id) => document.getElementById(id);

  const alertEl      = $('page-alert');
  const loadStateEl  = $('load-state');
  const formWrapEl   = $('form-wrap');

  // Status bar
  const statusBarEl     = $('status-bar');
  const statusBadgeEl   = $('status-badge');
  const activateBtn     = $('activate-btn');
  const deactivateBtn   = $('deactivate-btn');

  // Plan identity
  const nameInput         = $('plan-name');
  const slugInput         = $('plan-slug');
  const shortDescInput    = $('plan-short-desc');
  const descInput         = $('plan-description');

  // Pricing
  const priceInput        = $('plan-price');
  const compareAtInput    = $('plan-compare-at-price');

  // Course configuration
  const selLimitInput     = $('plan-selection-limit');
  const selLimitWarningEl = $('selection-limit-warning');
  const courseSearchInput = $('course-search');
  const coursePickerEl    = $('course-picker');
  const selectedChipsEl   = $('selected-chips');
  const selectedCountEl   = $('selected-count');

  // Benefits
  const benefitsEditorEl  = $('benefits-editor');
  const addBenefitBtn     = $('add-benefit-btn');

  // Availability
  const availFromInput    = $('plan-available-from');
  const availUntilInput   = $('plan-available-until');

  // Save
  const saveBtn       = $('save-btn');
  const saveLabelEl   = saveBtn ? saveBtn.querySelector('.label') : null;

  // ---- Runtime state -------------------------------------------------------

  let plan         = null;   // current plan from backend (null if none exists yet)
  let allCourses   = [];     // full catalog: [{id, title, slug, status}]
  let selectedIds  = new Set(); // currently selected eligible course IDs
  let busy         = false;  // one in-flight request at a time

  // ---- Alert helpers -------------------------------------------------------

  function showAlert(msg, kind = 'error') {
    Forms.showAlert(alertEl, msg, kind);
    alertEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function hideAlert() {
    Forms.hideAlert(alertEl);
  }

  function setLoading(isLoading) {
    if (!saveBtn) return;
    busy = isLoading;
    Forms.setLoading(saveBtn, isLoading, 'Saving…');
    if (activateBtn)   activateBtn.disabled   = isLoading;
    if (deactivateBtn) deactivateBtn.disabled = isLoading;
  }

  // ---- Status bar ----------------------------------------------------------

  function renderStatusBar(status) {
    if (!statusBarEl) return;
    const isActive = status === 'ACTIVE';
    statusBarEl.className = `membership-status-bar ${isActive ? 'is-active' : 'is-inactive'}`;
    if (statusBadgeEl) {
      statusBadgeEl.className = `badge membership-status-badge badge-${isActive ? 'active' : 'inactive'}`;
      statusBadgeEl.textContent = isActive ? 'Active' : 'Inactive';
    }
    if (activateBtn)   activateBtn.hidden   = isActive;
    if (deactivateBtn) deactivateBtn.hidden = !isActive;
  }

  // ---- Course picker -------------------------------------------------------

  function renderPicker(filter = '') {
    if (!coursePickerEl) return;
    Dom.clear(coursePickerEl);

    const q = filter.toLowerCase().trim();
    const filtered = q
      ? allCourses.filter((c) => c.title.toLowerCase().includes(q) || (c.slug || '').includes(q))
      : allCourses;

    if (filtered.length === 0) {
      coursePickerEl.appendChild(
        Dom.el('p', { class: 'course-picker-empty', text: q ? 'No courses match your search.' : 'No courses found in the catalog.' })
      );
      return;
    }

    for (const course of filtered) {
      const isChecked = selectedIds.has(course.id);
      const row = Dom.el('div', { class: 'course-picker-row' });

      const checkbox = document.createElement('input');
      checkbox.type    = 'checkbox';
      checkbox.id      = `course-pick-${course.id}`;
      checkbox.checked = isChecked;
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          selectedIds.add(course.id);
        } else {
          selectedIds.delete(course.id);
        }
        renderChips();
        updateSelectionLimitWarning();
      });

      const label = Dom.el('label', { class: 'course-picker-label', for: `course-pick-${course.id}` }, [
        Dom.el('span', { class: 'course-picker-title', text: course.title }),
        Dom.el('span', { class: 'course-picker-sub', text: `${course.status || ''}${course.slug ? ' · ' + course.slug : ''}` }),
      ]);

      row.appendChild(checkbox);
      row.appendChild(label);
      coursePickerEl.appendChild(row);
    }
  }

  function renderChips() {
    if (!selectedChipsEl) return;
    Dom.clear(selectedChipsEl);

    // Build a fast lookup: id -> title
    const courseMap = new Map(allCourses.map((c) => [c.id, c.title]));

    for (const id of selectedIds) {
      const title = courseMap.get(id) || id;
      const chip = Dom.el('span', { class: 'selected-course-chip' }, [
        Dom.el('span', { text: title }),
      ]);
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = '×';
      removeBtn.setAttribute('aria-label', `Remove ${title}`);
      removeBtn.addEventListener('click', () => {
        selectedIds.delete(id);
        // Uncheck the picker checkbox if visible
        const cb = document.getElementById(`course-pick-${id}`);
        if (cb) cb.checked = false;
        renderChips();
        updateSelectionLimitWarning();
      });
      chip.appendChild(removeBtn);
      selectedChipsEl.appendChild(chip);
    }

    if (selectedCountEl) {
      selectedCountEl.textContent = `${selectedIds.size} course${selectedIds.size !== 1 ? 's' : ''} selected`;
    }
  }

  function updateSelectionLimitWarning() {
    if (!selLimitWarningEl || !selLimitInput) return;
    const limit = parseInt(selLimitInput.value, 10);
    const count = selectedIds.size;
    const shouldWarn = !Number.isNaN(limit) && limit > 0 && count > 0 && limit > count;
    selLimitWarningEl.classList.toggle('is-visible', shouldWarn);
    if (shouldWarn) {
      selLimitWarningEl.textContent =
        `⚠ Selection limit (${limit}) exceeds eligible courses (${count}). The backend will reject activation.`;
    }
  }

  // ---- Benefits editor -----------------------------------------------------

  function addBenefitRow(value = '') {
    if (!benefitsEditorEl) return;
    const row = Dom.el('div', { class: 'benefit-row' });

    const input = document.createElement('input');
    input.type        = 'text';
    input.className   = 'input';
    input.maxLength   = 200;
    input.placeholder = 'e.g. Founder mentorship & 1-on-1 calls';
    input.value       = value;
    input.setAttribute('aria-label', 'Benefit text');

    const removeBtn = document.createElement('button');
    removeBtn.type      = 'button';
    removeBtn.className = 'btn-icon';
    removeBtn.textContent = '×';
    removeBtn.setAttribute('aria-label', 'Remove benefit');
    removeBtn.addEventListener('click', () => row.remove());

    row.appendChild(input);
    row.appendChild(removeBtn);
    benefitsEditorEl.appendChild(row);
    input.focus();
  }

  function getBenefits() {
    if (!benefitsEditorEl) return [];
    return Array.from(benefitsEditorEl.querySelectorAll('input'))
      .map((i) => i.value.trim())
      .filter(Boolean);
  }

  // ---- Populate form from plan data ----------------------------------------

  function populateForm(p) {
    // Phase 39: expose active plan so the Phase 39 media controller can read its id.
    window.__activePlan = p;
    // Phase 39: populate content/media sections (no-op if Phase 39 not loaded).
    if (window.__phase39 && window.__phase39.init) window.__phase39.init(p);

    if (nameInput)      nameInput.value       = p.name || '';
    if (slugInput)      slugInput.value       = p.slug || '';
    if (shortDescInput) shortDescInput.value  = p.shortDescription || '';
    if (descInput)      descInput.value       = p.description || '';

    // Price: convert paise → rupees for display
    if (priceInput) {
      const rupees = typeof p.price === 'number' ? Dom.paiseToRupees(p.price) : '';
      priceInput.value = rupees ? String(Math.round(p.price / 100)) : '';
    }
    if (compareAtInput) {
      compareAtInput.value = p.compareAtPrice ? String(Math.round(p.compareAtPrice / 100)) : '';
    }

    if (selLimitInput) selLimitInput.value = p.selectionLimit || '';

    // Eligible courses — populate from eligibleCoursesDetail (populated IDs)
    selectedIds = new Set();
    const details = p.eligibleCoursesDetail || [];
    for (const c of details) {
      selectedIds.add(c.id || String(c._id));
    }
    // Fallback: plain eligibleCourses array of ID strings
    if (selectedIds.size === 0 && Array.isArray(p.eligibleCourses)) {
      for (const id of p.eligibleCourses) selectedIds.add(String(id));
    }

    renderPicker();
    renderChips();
    updateSelectionLimitWarning();

    // Benefits
    if (benefitsEditorEl) {
      Dom.clear(benefitsEditorEl);
      const benefits = Array.isArray(p.benefits) ? p.benefits : [];
      for (const b of benefits) addBenefitRow(b);
      if (benefits.length === 0) addBenefitRow(); // one empty row to start
    }

    // Availability
    if (availFromInput) {
      availFromInput.value = p.availableFrom
        ? new Date(p.availableFrom).toISOString().slice(0, 16)
        : '';
    }
    if (availUntilInput) {
      availUntilInput.value = p.availableUntil
        ? new Date(p.availableUntil).toISOString().slice(0, 16)
        : '';
    }

    renderStatusBar(p.status || 'INACTIVE');
  }

  // ---- Build save payload --------------------------------------------------

  function buildPayload() {
    const errors = [];

    const name = (nameInput && nameInput.value.trim()) || '';
    if (!name) errors.push('Plan name is required.');

    const slug = (slugInput && slugInput.value.trim()) || '';
    if (!slug) errors.push('Slug is required.');
    else if (!/^[a-z0-9-]+$/.test(slug)) errors.push('Slug must be lowercase letters, numbers, and hyphens only.');

    // Price: rupees text → integer paise
    const priceText = (priceInput && priceInput.value.trim()) || '';
    const pricePaise = Dom.rupeesToPaise(priceText);
    if (!priceText) {
      errors.push('Price is required.');
    } else if (pricePaise === null || pricePaise < 0) {
      errors.push('Price must be a valid rupee amount (e.g. 4999).');
    }

    const compareText = (compareAtInput && compareAtInput.value.trim()) || '';
    let compareAtPaise = null;
    if (compareText) {
      compareAtPaise = Dom.rupeesToPaise(compareText);
      if (compareAtPaise === null) {
        errors.push('Compare-at price must be a valid rupee amount or empty.');
      }
    }

    const selLimit = parseInt(selLimitInput && selLimitInput.value, 10);
    if (!selLimitInput || !selLimitInput.value.trim()) {
      errors.push('Selection limit is required.');
    } else if (Number.isNaN(selLimit) || selLimit < 1) {
      errors.push('Selection limit must be a whole number of at least 1.');
    }

    if (errors.length > 0) return { errors };

    const payload = {
      name,
      slug,
      shortDescription: (shortDescInput && shortDescInput.value.trim()) || '',
      description: (descInput && descInput.value.trim()) || '',
      price: pricePaise,
      selectionLimit: selLimit,
      eligibleCourseIds: [...selectedIds],
      benefits: getBenefits(),
    };

    if (compareAtPaise !== null) payload.compareAtPrice = compareAtPaise;

    // Availability dates (ISO strings or null)
    const fromVal  = availFromInput && availFromInput.value;
    const untilVal = availUntilInput && availUntilInput.value;
    if (fromVal)  payload.availableFrom  = new Date(fromVal).toISOString();
    if (untilVal) payload.availableUntil = new Date(untilVal).toISOString();

    return { payload };
  }

  // ---- Save ----------------------------------------------------------------

  async function savePlan() {
    if (busy) return;
    hideAlert();

    const { errors, payload } = buildPayload();
    if (errors && errors.length > 0) {
      showAlert(errors.join(' '));
      return;
    }

    setLoading(true);
    try {
      let result;
      if (plan) {
        // Update existing plan
        result = await MembershipApi.updatePlan(plan.id, payload);
      } else {
        // Create new plan — slug + name are required for POST
        result = await MembershipApi.createPlan(payload);
      }

      // Re-fetch the full plan with populated courses
      const fresh = await MembershipApi.getPlan(result.id);
      plan = fresh;
      populateForm(plan);
      showAlert(plan ? 'Plan updated successfully.' : 'Plan created.', 'success');
    } catch (err) {
      if (Auth.handleSessionError(err)) return;
      showAlert(Ui.messageForError(err, 'plan'));
    } finally {
      setLoading(false);
    }
  }

  // ---- Activate / Deactivate -----------------------------------------------

  async function activatePlan() {
    if (busy || !plan) return;
    hideAlert();

    const confirmed = await Ui.confirm({
      title: 'Activate 1% Club',
      message: 'Students will be able to view and purchase the membership. Make sure the price, selection limit, and eligible courses are correct.',
      confirmLabel: 'Activate',
    });
    if (!confirmed) return;

    setLoading(true);
    try {
      const result = await MembershipApi.activatePlan(plan.id);
      plan = { ...plan, ...result };
      renderStatusBar(plan.status);
      showAlert('Membership is now active. Students can purchase it.', 'success');
    } catch (err) {
      if (Auth.handleSessionError(err)) return;
      showAlert(Ui.messageForError(err, 'plan'));
    } finally {
      setLoading(false);
    }
  }

  async function deactivatePlan() {
    if (busy || !plan) return;
    hideAlert();

    const confirmed = await Ui.confirm({
      title: 'Deactivate 1% Club',
      message: 'New membership purchases will be blocked. Existing members and their enrollments are not affected.',
      confirmLabel: 'Deactivate',
      danger: true,
    });
    if (!confirmed) return;

    setLoading(true);
    try {
      const result = await MembershipApi.deactivatePlan(plan.id);
      plan = { ...plan, ...result };
      renderStatusBar(plan.status);
      showAlert('Membership deactivated. No new purchases can be made.', 'success');
    } catch (err) {
      if (Auth.handleSessionError(err)) return;
      showAlert(Ui.messageForError(err, 'plan'));
    } finally {
      setLoading(false);
    }
  }

  // ---- Wire events ---------------------------------------------------------

  function wireEvents() {
    if (saveBtn) saveBtn.addEventListener('click', savePlan);
    if (activateBtn)   activateBtn.addEventListener('click',   activatePlan);
    if (deactivateBtn) deactivateBtn.addEventListener('click', deactivatePlan);
    if (addBenefitBtn) addBenefitBtn.addEventListener('click', () => addBenefitRow());

    // Course search filter
    if (courseSearchInput) {
      courseSearchInput.addEventListener('input', () => {
        renderPicker(courseSearchInput.value);
      });
    }

    // Live selection-limit warning
    if (selLimitInput) {
      selLimitInput.addEventListener('input', updateSelectionLimitWarning);
    }
  }

  // ---- Initial load --------------------------------------------------------

  async function initialLoad() {
    loadStateEl.hidden  = false;
    formWrapEl.hidden   = true;
    loadStateEl.textContent = 'Loading…';

    try {
      // Parallel: plan list + course catalog
      const [plansData, coursesData] = await Promise.all([
        MembershipApi.listPlans(),
        MembershipApi.loadAllCourses().catch(() => []),
      ]);

      allCourses = coursesData || [];

      const items = (plansData && plansData.items) || [];

      if (items.length > 0) {
        // Load the first plan with populated course details
        plan = await MembershipApi.getPlan(items[0].id);
      }

      loadStateEl.hidden  = true;
      formWrapEl.hidden   = false;

      if (plan) {
        populateForm(plan);
      } else {
        // No plan yet — show empty form ready for creation
        renderPicker();
        renderChips();
        renderStatusBar('INACTIVE');
        if (benefitsEditorEl) addBenefitRow(); // one empty row
      }
    } catch (err) {
      if (Auth.handleSessionError(err)) return;
      loadStateEl.textContent = 'Failed to load membership configuration. Please refresh.';
    }
  }

  // ---- Init ----------------------------------------------------------------

  wireEvents();
  await initialLoad();
})();

// =============================================================================
// PHASE 39 — 1% Club Content & Media Management
// Appended to the Phase 38 controller. All DOM references use the element IDs
// added to membership.html in Phase 39. All API calls use MembershipApi
// methods added to membership-api.js in Phase 39.
// =============================================================================

(function initPhase39(getActivePlan) {
  'use strict';

  // We need to know the active plan id at runtime. Phase 38's `plan` var is
  // local to its IIFE, so we use a small shared accessor pattern:
  // membership-page.js now exports a `getCurrentPlan()` accessor at the bottom
  // of the file (see patch below). This IIFE receives it as a parameter.

  // ---------------------------------------------------------------------------
  // DOM: Content section
  // ---------------------------------------------------------------------------
  var $ = function (id) { return document.getElementById(id); };

  var s2HeadingInput  = $('content-section2-heading');
  var s2DescInput     = $('content-section2-desc');
  var saveContentBtn  = $('save-content-btn');

  // ---------------------------------------------------------------------------
  // DOM: Media — founderImage slot
  // ---------------------------------------------------------------------------
  var founderPreviewEl  = $('media-preview-founderImage');
  var founderUploadEl   = $('upload-founderImage');
  var founderRemoveBtn  = $('remove-founderImage');
  var founderStatusEl   = $('upload-founderImage-status');

  // ---------------------------------------------------------------------------
  // DOM: Video — Section 2 intro
  // ---------------------------------------------------------------------------
  var videoPlaceholderEl  = $('video-placeholder');
  var videoStatusRow      = $('video-status-row');
  var videoStatusBadge    = $('video-status-badge');
  var videoTitleLabel     = $('video-title-label');
  var videoThumbWrap      = $('video-thumb-wrap');
  var videoThumbImg       = $('video-thumb');
  var videoUploadInput    = $('upload-intro-video');
  var videoUploadLabelEl  = $('video-upload-label-text');
  var videoPreviewBtn     = $('video-preview-btn');
  var videoRemoveBtn      = $('video-remove-btn');
  var videoProgressWrap   = $('video-progress-wrap');
  var videoProgressBar    = $('video-progress-bar');
  var videoProgressLabel  = $('video-progress-label');
  var videoAbortBtn       = $('video-abort-btn');
  var videoModal          = $('video-preview-modal');
  var videoModalBackdrop  = $('video-modal-backdrop');
  var videoModalClose     = $('video-modal-close');
  var videoPreviewContainer = $('video-preview-container');
  var videoStatusEl       = $('video-upload-status');

  // Current upload handle (for abort)
  var _uploadHandle = null;
  // Polling — reuse global VideoPoller from video-poller.js
  var _pollingPlanId = null;

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function setStatus(el, msg, kind) {
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'media-slot-status' + (kind ? ' is-' + kind : '');
  }

  function clearStatus(el) {
    if (!el) return;
    el.textContent = '';
    el.className = 'media-slot-status';
  }

  function planId() {
    var p = getActivePlan();
    return p && (p.id || p._id);
  }

  // ---------------------------------------------------------------------------
  // Populate Phase 39 UI from plan data
  // ---------------------------------------------------------------------------

  function populatePhase39(plan) {
    if (!plan) return;

    // Content fields
    var content = plan.content || {};
    if (s2HeadingInput) s2HeadingInput.value = content.section2Heading || '';
    if (s2DescInput)    s2DescInput.value    = content.section2Description || '';

    // Media: founderImage
    var adminMedia = plan.adminMedia || {};
    var founderUrl = adminMedia.founderImage || '';
    renderImageSlot(founderPreviewEl, founderRemoveBtn, founderUrl, 'Founder photo');

    // Video
    renderVideoState(adminMedia);
  }

  // ---------------------------------------------------------------------------
  // Image slot renderer
  // ---------------------------------------------------------------------------

  function renderImageSlot(previewEl, removeBtn, cdnUrl, altText) {
    if (!previewEl) return;
    previewEl.innerHTML = '';

    if (cdnUrl) {
      var img = document.createElement('img');
      img.src     = cdnUrl;
      img.alt     = altText || '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.style.maxHeight = '20rem';
      img.style.width = '100%';
      img.style.objectFit = 'contain';
      // Handle broken CDN links gracefully
      img.onerror = function () {
        img.style.display = 'none';
        renderPlaceholderInto(previewEl, 'Image unavailable');
      };
      previewEl.appendChild(img);
      if (removeBtn) removeBtn.hidden = false;
    } else {
      renderPlaceholderInto(previewEl, 'No image configured');
      if (removeBtn) removeBtn.hidden = true;
    }
  }

  function renderPlaceholderInto(el, label) {
    var ph = document.createElement('div');
    ph.className = 'media-placeholder';
    ph.setAttribute('aria-label', label);
    ph.innerHTML =
      '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<rect x="3" y="3" width="18" height="18" rx="2"/>' +
        '<circle cx="8.5" cy="8.5" r="1.5"/>' +
        '<path d="M21 15l-5-5L5 21"/>' +
      '</svg>' +
      '<span>' + label + '</span>';
    el.appendChild(ph);
  }

  // ---------------------------------------------------------------------------
  // Video state renderer
  // ---------------------------------------------------------------------------

  var STATUS_LABELS = {
    'PENDING':    'Pending',
    'UPLOADING':  'Uploading',
    'PROCESSING': 'Processing',
    'READY':      'Ready',
    'ERROR':      'Error',
  };

  var STATUS_BADGE_CLASS = {
    'PENDING':    'badge-pending',
    'UPLOADING':  'badge-pending',
    'PROCESSING': 'badge-processing',
    'READY':      'badge-ready',
    'ERROR':      'badge-error',
  };

  function renderVideoState(adminMedia) {
    if (!adminMedia) adminMedia = {};
    var videoId     = adminMedia.introVideoId || '';
    var videoStatus = adminMedia.introVideoStatus || '';
    var thumb       = adminMedia.introVideoThumbnail || '';
    var title       = adminMedia.introVideoTitle || '';

    var hasVideo = Boolean(videoId);

    if (videoPlaceholderEl) videoPlaceholderEl.hidden = hasVideo;
    if (videoStatusRow)     videoStatusRow.hidden     = !hasVideo;
    if (videoThumbWrap)     videoThumbWrap.hidden     = !(hasVideo && thumb);

    if (hasVideo) {
      if (videoStatusBadge) {
        videoStatusBadge.textContent = STATUS_LABELS[videoStatus] || videoStatus || 'Unknown';
        videoStatusBadge.className = 'badge ' + (STATUS_BADGE_CLASS[videoStatus] || 'badge-pending');
      }
      if (videoTitleLabel) videoTitleLabel.textContent = title ? '— ' + title : '';
      if (thumb && videoThumbImg) videoThumbImg.src = thumb;
    }

    if (videoUploadLabelEl) {
      videoUploadLabelEl.textContent = hasVideo ? 'Replace Video' : 'Upload Video';
    }
    if (videoPreviewBtn) videoPreviewBtn.hidden = !(hasVideo && videoStatus === 'READY');
    if (videoRemoveBtn)  videoRemoveBtn.hidden  = !hasVideo;
  }

  // ---------------------------------------------------------------------------
  // CONTENT: Save section2Heading + section2Description
  // ---------------------------------------------------------------------------

  async function saveContent() {
    var id = planId();
    if (!id) { Ui.notify('No active plan. Please save the plan first.', 'error'); return; }
    if (!saveContentBtn) return;

    var origLabel = saveContentBtn.textContent;
    saveContentBtn.disabled = true;
    saveContentBtn.textContent = 'Saving…';

    try {
      var fields = {};
      if (s2HeadingInput) fields.section2Heading    = s2HeadingInput.value.trim();
      if (s2DescInput)    fields.section2Description = s2DescInput.value.trim();

      await MembershipApi.updateContent(id, fields);
      saveContentBtn.textContent = 'Saved ✓';
      setTimeout(function () {
        saveContentBtn.textContent = origLabel;
        saveContentBtn.disabled = false;
      }, 2000);
    } catch (err) {
      saveContentBtn.textContent = origLabel;
      saveContentBtn.disabled = false;
      if (typeof Auth !== 'undefined' && Auth.handleSessionError && Auth.handleSessionError(err)) return;
      Ui.notify('Failed to save content: ' + ((err && err.message) || 'Unknown error'), 'error');
    }
  }

  // ---------------------------------------------------------------------------
  // IMAGE: Upload
  // ---------------------------------------------------------------------------

  async function handleImageUpload(slot, file, previewEl, removeBtn, statusEl) {
    clearStatus(statusEl);
    if (!file) return;

    var id = planId();
    if (!id) { setStatus(statusEl, 'No active plan. Save the plan first.', 'error'); return; }

    // Disable upload input while in progress
    var inputEl = $('upload-' + slot);
    if (inputEl) inputEl.disabled = true;

    setStatus(statusEl, 'Uploading…');
    try {
      var result = await MembershipApi.uploadImage(id, slot, file);
      renderImageSlot(previewEl, removeBtn, result.cdnUrl, file.name);
      setStatus(statusEl, 'Uploaded successfully.', 'success');
      setTimeout(function () { clearStatus(statusEl); }, 3000);
    } catch (err) {
      if (typeof Auth !== 'undefined' && Auth.handleSessionError && Auth.handleSessionError(err)) return;
      setStatus(statusEl, 'Upload failed: ' + ((err && err.message) || 'Unknown error.'), 'error');
    } finally {
      if (inputEl) { inputEl.disabled = false; inputEl.value = ''; }
    }
  }

  // ---------------------------------------------------------------------------
  // IMAGE: Remove
  // ---------------------------------------------------------------------------

  async function handleImageRemove(slot, previewEl, removeBtn, statusEl) {
    var id = planId();
    if (!id) return;
    if (!(await Ui.confirm({ title: 'Remove this image?', message: 'The slot will show the default placeholder.', confirmLabel: 'Remove', danger: true }))) return;
    clearStatus(statusEl);
    try {
      await MembershipApi.removeImage(id, slot);
      renderImageSlot(previewEl, removeBtn, '', '');
      setStatus(statusEl, 'Image removed.', 'success');
      setTimeout(function () { clearStatus(statusEl); }, 2500);
    } catch (err) {
      if (typeof Auth !== 'undefined' && Auth.handleSessionError && Auth.handleSessionError(err)) return;
      setStatus(statusEl, 'Remove failed: ' + ((err && err.message) || 'Unknown error.'), 'error');
    }
  }

  // ---------------------------------------------------------------------------
  // VIDEO: Upload via TUS (VideoUpload + MembershipApi)
  // ---------------------------------------------------------------------------

  function setVideoProgress(pct, label) {
    if (videoProgressWrap) videoProgressWrap.hidden = false;
    if (videoProgressBar)  videoProgressBar.style.width = pct + '%';
    if (videoProgressLabel) videoProgressLabel.textContent = label || (pct + '%');
  }

  function hideVideoProgress() {
    if (videoProgressWrap) videoProgressWrap.hidden = true;
    if (videoProgressBar)  videoProgressBar.style.width = '0%';
    if (videoProgressLabel) videoProgressLabel.textContent = '';
  }

  function setVideoUploadBusy(busy) {
    if (videoUploadInput)  videoUploadInput.disabled  = busy;
    if (videoPreviewBtn)   videoPreviewBtn.disabled   = busy;
    if (videoRemoveBtn)    videoRemoveBtn.disabled    = busy;
    if (videoAbortBtn)     videoAbortBtn.hidden       = !busy;
  }

  function startVideoStatusPolling(id) {
    if (typeof VideoPoller === 'undefined') return;
    _pollingPlanId = id;
    VideoPoller.start({
      fetch: function () { return MembershipApi.getVideoStatus(id).then(function (r) { return r; }); },
      onUpdate: function (data, err) {
        if (err || !data) return;
        var vs = data.videoStatus || data.data && data.data.videoStatus || '';
        // Update badge
        if (videoStatusBadge) {
          videoStatusBadge.textContent = STATUS_LABELS[vs] || vs;
          videoStatusBadge.className = 'badge ' + (STATUS_BADGE_CLASS[vs] || 'badge-pending');
        }
        if (videoStatusEl) {
          if (vs === 'READY') setStatus(videoStatusEl, 'Video is ready.', 'success');
          else if (vs === 'ERROR') setStatus(videoStatusEl, 'Bunny reported a processing error.', 'error');
          else setStatus(videoStatusEl, 'Processing… (' + (STATUS_LABELS[vs] || vs) + ')');
        }
        if (vs === 'READY' && videoPreviewBtn) videoPreviewBtn.hidden = false;
      },
      isDone: function (data) {
        var vs = data && (data.videoStatus || (data.data && data.data.videoStatus));
        return vs === 'READY' || vs === 'ERROR';
      },
      onStop: function () { _pollingPlanId = null; },
    });
  }

  async function handleVideoUpload(file) {
    var id = planId();
    if (!id) { setStatus(videoStatusEl, 'No active plan. Save the plan first.', 'error'); return; }
    if (!file) return;

    if (typeof VideoUpload === 'undefined' || !VideoUpload.isSupported()) {
      setStatus(videoStatusEl, 'Your browser does not support video upload. Please use a modern browser.', 'error');
      return;
    }

    clearStatus(videoStatusEl);
    setVideoUploadBusy(true);
    setVideoProgress(0, 'Preparing upload…');

    var initResult;
    try {
      initResult = await MembershipApi.initVideoUpload(id, {
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || 'video/mp4',
        replace: true,
      });
    } catch (err) {
      setVideoUploadBusy(false);
      hideVideoProgress();
      if (typeof Auth !== 'undefined' && Auth.handleSessionError && Auth.handleSessionError(err)) return;
      setStatus(videoStatusEl, 'Failed to initialise upload: ' + ((err && err.message) || 'Unknown error.'), 'error');
      return;
    }

    var creds = initResult && initResult.upload;
    if (!creds) {
      setVideoUploadBusy(false);
      hideVideoProgress();
      setStatus(videoStatusEl, 'Invalid upload credentials from server.', 'error');
      return;
    }

    // Update UI to show uploading state immediately
    if (videoPlaceholderEl) videoPlaceholderEl.hidden = true;
    if (videoStatusRow)     videoStatusRow.hidden = false;
    if (videoStatusBadge) {
      videoStatusBadge.textContent = 'Uploading';
      videoStatusBadge.className   = 'badge badge-pending';
    }
    if (videoTitleLabel) videoTitleLabel.textContent = '— ' + file.name;

    _uploadHandle = VideoUpload.start(file, creds, {
      onProgress: function (pct) {
        setVideoProgress(pct, 'Uploading — ' + pct + '%');
      },
      onSuccess: function () {
        hideVideoProgress();
        setVideoProgress(100, 'Upload complete. Processing…');
        MembershipApi.markVideoUploaded(id, creds.videoId)
          .then(function () {
            setStatus(videoStatusEl, 'Upload complete. Bunny is now processing your video.', 'success');
            if (videoStatusBadge) {
              videoStatusBadge.textContent = 'Processing';
              videoStatusBadge.className   = 'badge badge-processing';
            }
            startVideoStatusPolling(id);
          })
          .catch(function (err) {
            setStatus(videoStatusEl, 'Upload complete but status sync failed: ' + (err && err.message), 'error');
          })
          .finally(function () {
            setVideoUploadBusy(false);
            hideVideoProgress();
            if (videoUploadInput) { videoUploadInput.value = ''; }
          });
      },
      onError: function (err, info) {
        _uploadHandle = null;
        setVideoUploadBusy(false);
        hideVideoProgress();
        MembershipApi.reportVideoFailure(id, creds.videoId, (err && err.message) || 'TUS_ERROR').catch(function () {});
        var msg = 'Upload failed.';
        if (info && info.status === 401) msg = 'Session expired. Please refresh the page.';
        else if (err && err.message)     msg = 'Upload failed: ' + err.message;
        setStatus(videoStatusEl, msg, 'error');
        if (videoUploadInput) videoUploadInput.value = '';
      },
    });
  }

  // ---------------------------------------------------------------------------
  // VIDEO: Preview (signed embed URL)
  // ---------------------------------------------------------------------------

  async function openVideoPreview() {
    var id = planId();
    if (!id) return;
    if (videoPreviewContainer) videoPreviewContainer.innerHTML = '';
    if (videoModal) videoModal.hidden = false;

    try {
      var result = await MembershipApi.previewVideo(id);
      var embedUrl = result && result.data && result.data.embedUrl;
      if (!embedUrl) throw new Error('No embed URL returned.');
      if (videoPreviewContainer) {
        // Only ever embed an https:// URL, never javascript:/data:/http:.
        var parsed;
        try { parsed = new URL(embedUrl); } catch (e) { parsed = null; }
        if (!parsed || parsed.protocol !== 'https:') throw new Error('Invalid preview URL.');
        var iframe = document.createElement('iframe');
        iframe.src = parsed.href;
        iframe.title = 'Intro video preview';
        iframe.allow = 'autoplay; fullscreen';
        iframe.allowFullscreen = true;
        iframe.referrerPolicy = 'strict-origin-when-cross-origin';
        videoPreviewContainer.appendChild(iframe);
      }
    } catch (err) {
      if (videoModal) videoModal.hidden = true;
      Ui.notify('Could not load preview: ' + ((err && err.message) || 'Unknown error'), 'error');
    }
  }

  function closeVideoPreview() {
    if (videoModal) videoModal.hidden = true;
    if (videoPreviewContainer) videoPreviewContainer.innerHTML = '';
  }

  // ---------------------------------------------------------------------------
  // VIDEO: Remove configuration
  // ---------------------------------------------------------------------------

  async function removeVideo() {
    var id = planId();
    if (!id) return;
    if (!(await Ui.confirm({ title: 'Remove the intro video?', message: 'The public page will show a placeholder until a new video is uploaded. This does not delete the video from Bunny CDN.', confirmLabel: 'Remove', danger: true }))) return;
    clearStatus(videoStatusEl);
    if (typeof VideoPoller !== 'undefined') VideoPoller.stop('removed');
    try {
      await MembershipApi.removeVideo(id);
      renderVideoState({});
      setStatus(videoStatusEl, 'Video configuration removed.', 'success');
      setTimeout(function () { clearStatus(videoStatusEl); }, 2500);
    } catch (err) {
      if (typeof Auth !== 'undefined' && Auth.handleSessionError && Auth.handleSessionError(err)) return;
      setStatus(videoStatusEl, 'Failed to remove: ' + ((err && err.message) || 'Unknown error.'), 'error');
    }
  }

  // ---------------------------------------------------------------------------
  // Wire Phase 39 events
  // ---------------------------------------------------------------------------

  function wirePhase39Events() {
    // Content save
    if (saveContentBtn) saveContentBtn.addEventListener('click', saveContent);

    // Founder image upload
    if (founderUploadEl) {
      founderUploadEl.addEventListener('change', function () {
        var file = founderUploadEl.files && founderUploadEl.files[0];
        handleImageUpload('founderImage', file, founderPreviewEl, founderRemoveBtn, founderStatusEl);
      });
    }

    // Founder image remove
    if (founderRemoveBtn) {
      founderRemoveBtn.addEventListener('click', function () {
        handleImageRemove('founderImage', founderPreviewEl, founderRemoveBtn, founderStatusEl);
      });
    }

    // Video upload
    if (videoUploadInput) {
      videoUploadInput.addEventListener('change', function () {
        var file = videoUploadInput.files && videoUploadInput.files[0];
        handleVideoUpload(file);
      });
    }

    // Video abort
    if (videoAbortBtn) {
      videoAbortBtn.addEventListener('click', function () {
        if (_uploadHandle) {
          _uploadHandle.abort().catch(function () {});
          _uploadHandle = null;
        }
        setVideoUploadBusy(false);
        hideVideoProgress();
        setStatus(videoStatusEl, 'Upload cancelled.', 'error');
        if (videoUploadInput) videoUploadInput.value = '';
      });
    }

    // Video preview
    if (videoPreviewBtn) videoPreviewBtn.addEventListener('click', openVideoPreview);
    if (videoModalClose) videoModalClose.addEventListener('click', closeVideoPreview);
    if (videoModalBackdrop) videoModalBackdrop.addEventListener('click', closeVideoPreview);

    // Keyboard close for modal
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && videoModal && !videoModal.hidden) closeVideoPreview();
    });

    // Video remove
    if (videoRemoveBtn) videoRemoveBtn.addEventListener('click', removeVideo);
  }

  // ---------------------------------------------------------------------------
  // Expose init function to be called from Phase 38 after plan is loaded
  // ---------------------------------------------------------------------------

  // Phase 38 calls window.__phase39.init(plan) after populateForm() and on
  // every subsequent reload of the plan.
  window.__phase39 = { init: populatePhase39, wireEvents: wirePhase39Events };

  // Auto-wire events immediately (DOM is ready by the time this runs).
  wirePhase39Events();

})(function getActivePlan() {
  // Reads the current plan from the Phase 38 IIFE via a shared accessor.
  // If Phase 38 sets window.__activePlan we use it. Otherwise null.
  return window.__activePlan || null;
});
