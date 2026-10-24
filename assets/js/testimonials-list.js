/**
 * Testimonials list page controller (Phase 7).
 *
 * ALL searching, filtering, sorting and paging happens on the SERVER: this
 * file only sends the current criteria and renders the one page it gets
 * back — same discipline as courses-list.js. It never fetches "all
 * testimonials" to filter in the browser.
 *
 * SUMMARY COUNTS: the admin list endpoint has no dedicated totals route, so
 * TestimonialsApi.summaryCounts() makes 4 cheap filtered requests (limit=1)
 * and reads only pagination.total from each. These are the REAL database
 * counts across every page, never just the current page's items.
 *
 * RACES: every request gets a sequence number; a response that is no longer
 * the latest is discarded.
 *
 * SESSION EXPIRY: any 401/403 from an API call goes through
 * Auth.handleSessionError(), which clears state and returns to login.
 */

(async function initTestimonialsList() {
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
  const els = {
    alert: $('page-alert'), body: $('rows-body'), table: $('rows-table'), state: $('state-box'),
    pager: $('pager'), info: $('pager-info'), page: $('pager-page'), prev: $('prev-btn'), next: $('next-btn'),
    search: $('f-search'), status: $('f-status'), type: $('f-type'), featured: $('f-featured'),
    sort: $('f-sort'), reset: $('f-reset'), statGrid: $('stat-grid'),
  };

  const LIMIT = 20;
  const state = { page: 1, totalPages: 0 };
  let seq = 0;
  let busyRow = null; // id of the row whose action is in flight

  const criteria = () => ({
    search: els.search.value, status: els.status.value, type: els.type.value,
    featured: els.featured.value, sort: els.sort.value, page: state.page, limit: LIMIT,
  });

  function showState(title, text) {
    Dom.clear(els.state);
    els.state.appendChild(Dom.el('h3', { text: title }));
    els.state.appendChild(Dom.el('p', { text }));
    els.state.hidden = false;
  }

  function setBusy(isBusy) {
    els.table.classList.toggle('is-loading', isBusy);
    els.table.setAttribute('aria-busy', String(isBusy));
  }

  function fail(err) {
    if (Auth.handleSessionError(err)) return true;
    Forms.showAlert(els.alert, Ui.messageForError(err, 'testimonial'), 'error');
    els.alert.focus();
    return false;
  }

  // ---- Summary cards (real DB counts; see file header) ---------------------
  function statCard(label, value) {
    return Dom.el('div', { class: 'stat-card' }, [
      Dom.el('div', { class: 'stat-label', text: label }),
      Dom.el('div', { class: 'stat-value', text: value }),
    ]);
  }

  async function loadSummary() {
    try {
      const counts = await TestimonialsApi.summaryCounts();
      Dom.clear(els.statGrid);
      els.statGrid.appendChild(statCard('Total Testimonials', String(counts.total)));
      els.statGrid.appendChild(statCard('Published', String(counts.published)));
      els.statGrid.appendChild(statCard('Drafts', String(counts.draft)));
      els.statGrid.appendChild(statCard('Archived', String(counts.archived)));
      els.statGrid.hidden = false;
    } catch (err) {
      // Summary is secondary — the list still works without it. Do not
      // silently fabricate numbers; just leave the cards hidden.
      els.statGrid.hidden = true;
    }
  }

  // ---- Type / featured labels (real enum values only) ----------------------
  const TYPE_LABELS = Object.freeze({ PHOTO: 'Photo', VIDEO: 'Video', WRITTEN: 'Written' });

  function typeBadge(type) {
    const t = String(type || '');
    return Dom.el('span', { class: `badge badge-sm badge-type-${t.toLowerCase()}`, text: TYPE_LABELS[t] || t });
  }

  function featuredBadge(featured) {
    return featured
      ? Dom.el('span', { class: 'badge badge-sm badge-featured', text: 'Featured' })
      : Dom.el('span', { class: 'badge badge-sm badge-not-featured', text: 'Not featured' });
  }

  // ---- Type-specific preview (never invents a URL; see spec 5F) ------------
  function mediaPreview(t) {
    const wrap = Dom.el('div', { class: 'testimonial-media-cell' });
    if (t.type === 'PHOTO') {
      const url = t.media && t.media.photo ? Dom.safeHttpsUrl(t.media.photo) : '';
      if (url) {
        const img = Dom.el('img', { class: 'testimonial-thumb', alt: `Photo of ${t.name}` });
        img.loading = 'lazy';
        img.decoding = 'async';
        img.onerror = () => { img.replaceWith(Dom.el('div', { class: 'testimonial-thumb-placeholder', text: 'No image' })); };
        img.src = url;
        wrap.appendChild(img);
      } else {
        // A storage key (not an https URL) cannot be rendered without a CDN
        // base this admin UI does not have — show a safe placeholder rather
        // than guessing at a URL.
        wrap.appendChild(Dom.el('div', { class: 'testimonial-thumb-placeholder', text: t.media && t.media.photo ? 'Key' : 'No photo' }));
      }
    } else if (t.type === 'VIDEO') {
      const hasId = Boolean(t.media && t.media.video && t.media.video.bunnyVideoId);
      wrap.appendChild(Dom.el('div', { class: 'testimonial-thumb-placeholder', text: hasId ? 'Video' : 'No video' }));
    } else {
      wrap.appendChild(Dom.el('div', { class: 'testimonial-thumb-placeholder', text: 'Written' }));
      const preview = (t.quote || t.story || '').trim();
      if (preview) wrap.appendChild(Dom.el('span', { class: 'testimonial-quote-preview', text: preview }));
    }
    return wrap;
  }

  // ---- Row rendering (textContent only) -----------------------------------
  function actionButton(label, handler, { danger = false } = {}) {
    return Dom.el('button', { type: 'button', class: `btn btn-sm ${danger ? 'btn-danger' : 'btn-outline'}`, text: label, onclick: handler });
  }

  function rowActions(t) {
    const editHref = `testimonial-form.html?id=${encodeURIComponent(t.id)}`;
    const box = Dom.el('div', { class: 'table-actions' }, [
      Dom.el('a', { class: 'btn btn-outline btn-sm', href: editHref, text: 'View / Edit' }),
    ]);
    if (t.status === 'DRAFT') box.appendChild(actionButton('Publish', () => runAction(t, 'publish')));
    if (t.status !== 'ARCHIVED') box.appendChild(actionButton('Archive', () => runAction(t, 'archive'), { danger: true }));
    if (t.status === 'ARCHIVED') box.appendChild(actionButton('Republish', () => runAction(t, 'republish')));
    return box;
  }

  function renderRows(items) {
    Dom.clear(els.body);
    for (const t of items) {
      els.body.appendChild(Dom.el('tr', {}, [
        Dom.el('td', {}, [
          mediaPreview(t),
          Dom.el('div', { class: 'cell-title', text: t.name, style: 'margin-top: var(--space-1);' }),
          t.role ? Dom.el('div', { class: 'cell-sub', text: t.role }) : null,
        ]),
        Dom.el('td', {}, [typeBadge(t.type)]),
        Dom.el('td', { text: t.program || '—' }),
        Dom.el('td', {}, [featuredBadge(t.featured)]),
        Dom.el('td', {}, [Ui.statusBadge(t.status)]),
        Dom.el('td', { text: t.publishedAt ? Dom.formatDate(t.publishedAt) : '—' }),
        Dom.el('td', {}, [rowActions(t)]),
      ]));
    }
  }

  // ---- Loading ---------------------------------------------------------
  async function load() {
    const mine = ++seq;
    Forms.hideAlert(els.alert);
    els.state.hidden = true;
    setBusy(true);
    if (!els.body.firstChild) showState('Loading testimonials…', 'Please wait.');

    try {
      const data = await TestimonialsApi.list(criteria());
      if (mine !== seq) return; // a newer request superseded this one

      const { items, pagination } = data;
      state.totalPages = pagination.totalPages;

      if (items.length === 0 && pagination.total > 0 && state.page > 1) {
        state.page = Math.max(1, pagination.totalPages);
        return load();
      }

      renderRows(items);
      els.pager.hidden = pagination.total === 0;
      els.info.textContent = `${pagination.total} testimonial${pagination.total === 1 ? '' : 's'}`;
      els.page.textContent = `Page ${pagination.page} of ${Math.max(1, pagination.totalPages)}`;
      els.prev.disabled = pagination.page <= 1;
      els.next.disabled = pagination.page >= pagination.totalPages;

      if (items.length === 0) {
        const filtered = Object.entries(criteria()).some(([k, v]) => !['sort', 'page', 'limit'].includes(k) && String(v).trim() !== '');
        if (filtered) {
          showState('No testimonials match', 'No testimonial matches these filters. Try changing or resetting them.');
        } else {
          showState('No testimonials yet', 'You have not added any testimonials yet. Use “Add Testimonial” to create one.');
        }
      } else {
        els.state.hidden = true;
      }
    } catch (err) {
      if (mine !== seq) return;
      Dom.clear(els.body);
      els.pager.hidden = true;
      if (fail(err)) return;
      showState('Could not load testimonials', 'Check your connection and try again.');
    } finally {
      if (mine === seq) setBusy(false);
    }
  }

  // ---- Row actions (publish / archive / republish) --------------------------
  const ACTIONS = {
    publish: {
      call: TestimonialsApi.publish, pending: 'Publishing…', done: 'Testimonial published.',
      confirm: (t) => ({ title: 'Publish this testimonial?', message: `“${t.name}”’s testimonial will become visible on the public site.`, confirmLabel: 'Publish' }),
    },
    archive: {
      call: TestimonialsApi.archive, pending: 'Archiving…', done: 'Testimonial archived.',
      confirm: (t) => ({ title: 'Archive this testimonial?', message: `“${t.name}”’s testimonial will be archived and removed from public display. It is not deleted and can be republished later.`, confirmLabel: 'Archive', danger: true }),
    },
    republish: {
      call: TestimonialsApi.republish, pending: 'Republishing…', done: 'Testimonial republished.',
      confirm: (t) => ({ title: 'Republish this testimonial?', message: `“${t.name}”’s testimonial may become publicly visible again. The backend re-checks that its content/media is still valid before this succeeds.`, confirmLabel: 'Republish' }),
    },
  };

  async function runAction(testimonial, name) {
    if (busyRow) return; // one in-flight action at a time: no double submits
    const spec = ACTIONS[name];
    if (!(await Ui.confirm(spec.confirm(testimonial)))) return;

    busyRow = testimonial.id;
    Forms.showAlert(els.alert, spec.pending, 'info');
    setBusy(true);
    try {
      await spec.call(testimonial.id);
      Forms.showAlert(els.alert, spec.done, 'success');
    } catch (err) {
      if (fail(err)) return;
    } finally {
      busyRow = null;
    }
    await load();
    await loadSummary();
  }

  // ---- Filter wiring -------------------------------------------------------
  const reload = () => { state.page = 1; load(); };
  const reloadSearch = Dom.debounce(reload, 350);

  els.search.addEventListener('input', reloadSearch);
  for (const sel of [els.status, els.type, els.featured, els.sort]) sel.addEventListener('change', reload);
  els.reset.addEventListener('click', () => {
    els.search.value = ''; els.status.value = ''; els.type.value = '';
    els.featured.value = ''; els.sort.value = 'order';
    reload();
  });
  els.prev.addEventListener('click', () => { if (state.page > 1) { state.page -= 1; load(); } });
  els.next.addEventListener('click', () => { if (state.page < state.totalPages) { state.page += 1; load(); } });

  await loadSummary();
  await load();
})();
