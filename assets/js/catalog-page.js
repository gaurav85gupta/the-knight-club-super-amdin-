/**
 * Shared controller for the Category and Instructor management pages
 * (Phase 8.1). Both pages are the same screen — a filterable, paginated list
 * with Add / Edit / Activate / Deactivate — so the behaviour lives here once
 * and each page supplies a small config (columns + form fields + API).
 *
 * ALL searching, filtering, sorting and paging happens on the SERVER; this
 * file only sends the current criteria and renders the one page it gets back.
 *
 * STATES handled: loading, empty (none yet / none match), error (with retry),
 * success feedback, submitting, per-field validation error, network error,
 * unauthorized/forbidden (-> Auth.handleSessionError), stale record (404 on
 * edit/status -> tells the admin and refreshes the list).
 *
 * DUPLICATE SUBMISSION: one in-flight write at a time (`busy`), the submit
 * button is disabled while a request runs, and the backend remains safe
 * against a repeat regardless (unique indexes).
 *
 * RACES: every list request gets a sequence number; a response that is no
 * longer the latest is discarded.
 *
 * SAFE RENDERING: DOM is built with createElement/textContent only (dom.js);
 * no markup from the server is ever interpreted.
 */

const CatalogPage = (() => {
  const LIMIT = 20;

  async function init(config) {
    const admin = await Auth.requireAuth();
    document.documentElement.classList.remove('auth-pending');
    document.getElementById('admin-identity').textContent = admin.name;
    

    const $ = (id) => document.getElementById(id);
    const logoutBtn = $('logout-btn');
    logoutBtn.addEventListener('click', async () => {
      logoutBtn.disabled = true;
      await Auth.logout();
      window.location.replace(Auth.urlFor(Auth.PATHS.login));
    });

    const els = {
      alert: $('page-alert'), body: $('rows-body'), table: $('rows-table'), state: $('state-box'),
      pager: $('pager'), info: $('pager-info'), page: $('pager-page'), prev: $('prev-btn'), next: $('next-btn'),
      search: $('f-search'), status: $('f-status'), sort: $('f-sort'), reset: $('f-reset'), add: $('add-btn'),
    };

    const api = config.api;
    const noun = config.noun; // 'category' | 'instructor'
    const state = { page: 1, totalPages: 0 };
    let seq = 0;
    let busy = false; // ONE in-flight write at a time

    const criteria = () => ({ search: els.search.value, status: els.status.value, sort: els.sort.value, page: state.page, limit: LIMIT });

    // ---- feedback ------------------------------------------------------------
    const message = (err) => Ui.messageForError(err, noun);

    function showState(title, text, { retry = false } = {}) {
      Dom.clear(els.state);
      els.state.appendChild(Dom.el('h3', { text: title }));
      els.state.appendChild(Dom.el('p', { text }));
      if (retry) els.state.appendChild(Dom.el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'Try again', onclick: () => load() }));
      els.state.hidden = false;
    }

    function setBusy(isBusy) {
      els.table.classList.toggle('is-loading', isBusy);
      els.table.setAttribute('aria-busy', String(isBusy));
    }

    /** Returns true when the error ended the session (caller must stop). */
    function fail(err) {
      if (Auth.handleSessionError(err)) return true;
      Forms.showAlert(els.alert, message(err), 'error');
      els.alert.focus();
      return false;
    }

    // ---- rows ----------------------------------------------------------------
    function actionButton(label, handler, { danger = false } = {}) {
      return Dom.el('button', { type: 'button', class: `btn btn-sm ${danger ? 'btn-danger' : 'btn-outline'}`, text: label, onclick: handler });
    }

    function rowActions(item) {
      const box = Dom.el('div', { class: 'table-actions' }, [actionButton('Edit', () => openEditor(item))]);
      if (item.status === 'ACTIVE') box.appendChild(actionButton('Deactivate', () => toggleStatus(item, 'deactivate'), { danger: true }));
      else box.appendChild(actionButton('Activate', () => toggleStatus(item, 'activate')));
      return box;
    }

    function renderRows(items) {
      Dom.clear(els.body);
      for (const item of items) {
        const cells = config.columns.map((col) => Dom.el('td', {}, [col.render(item)]));
        cells.push(Dom.el('td', {}, [Ui.statusBadge(item.status)]));
        cells.push(Dom.el('td', { text: String(item.courseCount ?? 0) }));
        cells.push(Dom.el('td', { text: Dom.formatDate(item.createdAt) }));
        cells.push(Dom.el('td', { text: Dom.formatDate(item.updatedAt) }));
        cells.push(Dom.el('td', {}, [rowActions(item)]));
        els.body.appendChild(Dom.el('tr', {}, cells));
      }
    }

    // ---- loading ---------------------------------------------------------------
    async function load() {
      const mine = ++seq;
      els.state.hidden = true;
      setBusy(true);
      if (!els.body.firstChild) showState(`Loading ${config.plural}…`, 'Please wait.');

      try {
        const data = await api.list(criteria());
        if (mine !== seq) return; // a newer request superseded this one

        const { items, pagination } = data;
        state.totalPages = pagination.totalPages;

        // Asked for a page past the end (e.g. the last row of the last page was filtered away).
        if (items.length === 0 && pagination.total > 0 && state.page > 1) {
          state.page = Math.max(1, pagination.totalPages);
          return load();
        }

        renderRows(items);
        els.pager.hidden = pagination.total === 0;
        els.info.textContent = `${pagination.total} ${pagination.total === 1 ? noun : config.plural}`;
        els.page.textContent = `Page ${pagination.page} of ${Math.max(1, pagination.totalPages)}`;
        els.prev.disabled = pagination.page <= 1;
        els.next.disabled = pagination.page >= pagination.totalPages;

        if (items.length === 0) {
          const filtered = Object.entries(criteria()).some(([k, v]) => !['sort', 'page', 'limit'].includes(k) && String(v).trim() !== '');
          showState(
            `No ${config.plural} found`,
            filtered ? `No ${noun} matches these filters. Try changing or resetting them.` : `You have not created any ${config.plural} yet. Use “Add ${noun}” to create one.`
          );
        } else {
          els.state.hidden = true;
        }
      } catch (err) {
        if (mine !== seq) return;
        Dom.clear(els.body);
        els.pager.hidden = true;
        if (fail(err)) return;
        showState(`Could not load ${config.plural}`, 'Check your connection and try again.', { retry: true });
      } finally {
        if (mine === seq) setBusy(false);
      }
    }

    // ---- activate / deactivate -----------------------------------------------------
    async function toggleStatus(item, action) {
      if (busy) return;
      const spec = config.statusCopy(item)[action];
      if (!(await Ui.confirm(spec))) return;

      busy = true;
      Forms.showAlert(els.alert, action === 'activate' ? 'Activating…' : 'Deactivating…', 'info');
      setBusy(true);
      try {
        await api[action](item.id);
        Forms.showAlert(els.alert, action === 'activate' ? `“${item.name}” activated.` : `“${item.name}” deactivated.`, 'success');
      } catch (err) {
        if (fail(err)) return;
        if (err instanceof ApiError && err.status === 404) await load(); // stale row: refresh so it disappears
        return;
      } finally {
        busy = false;
        setBusy(false);
      }
      await load();
    }

    // ---- add / edit modal ---------------------------------------------------------------
    function openEditor(item) {
      if (busy) return;
      const isEdit = Boolean(item);
      const fields = config.fields;

      // Build inputs from config. `data-key` ties an input to its API field.
      const inputs = {};
      const errorEls = {};
      const body = Dom.el('div');
      for (const f of fields) {
        const id = `ed-${f.key}`;
        const input = f.multiline
          ? Dom.el('textarea', { class: 'input', id, maxlength: f.max, rows: 4 })
          : Dom.el('input', { class: 'input', id, type: 'text', maxlength: f.max, spellcheck: f.key === 'slug' ? 'false' : undefined, autocapitalize: f.key === 'slug' ? 'none' : undefined });
        input.value = isEdit ? String(item[f.key] ?? '') : '';
        const err = Dom.el('p', { class: 'field-error', id: `${id}-error`, 'aria-live': 'polite' });
        input.setAttribute('aria-describedby', `${id}-error`);
        inputs[f.key] = input;
        errorEls[f.key] = err;
        body.appendChild(Dom.el('div', { class: 'field' }, [
          Dom.el('label', { for: id, text: f.label + (f.required ? '' : ' (optional)') }),
          input,
          f.hint ? Dom.el('p', { class: 'hint', text: f.hint }) : null,
          err,
        ]));
      }
      const formError = Dom.el('p', { class: 'field-error', role: 'alert', 'aria-live': 'polite' });
      body.appendChild(formError);

      const snapshot = () => JSON.stringify(fields.map((f) => inputs[f.key].value));
      const initial = snapshot();
      let saved = false;

      const saveBtn = Dom.el('button', { type: 'button', class: 'btn btn-primary btn-sm', text: isEdit ? 'Save changes' : `Add ${noun}` });
      const cancelBtn = Dom.el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'Cancel' });

      const close = openEditorModal({
        title: isEdit ? `Edit ${noun}` : `Add ${noun}`,
        body,
        actions: [cancelBtn, saveBtn],
        isDirty: () => !saved && snapshot() !== initial,
      });
      cancelBtn.addEventListener('click', () => close.attempt());

      function clearErrors() {
        formError.textContent = '';
        for (const f of fields) {
          errorEls[f.key].textContent = '';
          inputs[f.key].closest('.field').classList.remove('has-error');
          inputs[f.key].removeAttribute('aria-invalid');
        }
      }
      function setFieldError(key, msg) {
        if (!errorEls[key]) return false;
        errorEls[key].textContent = msg;
        inputs[key].closest('.field').classList.add('has-error');
        inputs[key].setAttribute('aria-invalid', 'true');
        return true;
      }

      /** Payload is built from the config's field list only — nothing else can be sent. */
      function buildPayload() {
        const payload = {};
        const problems = {};
        for (const f of fields) {
          const v = inputs[f.key].value.trim();
          if (f.required && v.length < (f.min || 1)) problems[f.key] = f.requiredMessage || `${f.label} is required.`;
          if (isEdit) {
            // Send only what changed, so an untouched slug is not re-submitted.
            if (v !== String(item[f.key] ?? '')) payload[f.key] = v;
          } else if (v !== '' || f.required) {
            payload[f.key] = v;
          }
        }
        return { payload, problems };
      }

      saveBtn.addEventListener('click', async () => {
        if (busy) return; // no duplicate creates / saves
        clearErrors();
        const { payload, problems } = buildPayload();
        const keys = Object.keys(problems);
        if (keys.length) {
          keys.forEach((k) => setFieldError(k, problems[k]));
          inputs[keys[0]].focus();
          return;
        }
        if (isEdit && Object.keys(payload).length === 0) {
          formError.textContent = 'You have not changed anything.';
          return;
        }

        busy = true;
        saveBtn.disabled = true;
        cancelBtn.disabled = true;
        saveBtn.textContent = isEdit ? 'Saving…' : 'Adding…';
        try {
          const data = isEdit ? await api.update(item.id, payload) : await api.create(payload);
          saved = true;
          close();
          Forms.showAlert(els.alert, `${config.titleCase} “${data[noun].name}” ${isEdit ? 'updated' : 'added'}.`, 'success');
          busy = false;
          await load();
        } catch (err) {
          busy = false;
          if (Auth.handleSessionError(err)) return;
          saveBtn.disabled = false;
          cancelBtn.disabled = false;
          saveBtn.textContent = isEdit ? 'Save changes' : `Add ${noun}`;

          let placed = false;
          if (err instanceof ApiError && (err.status === 422 || err.status === 409)) {
            for (const e of err.errors || []) placed = setFieldError(String(e.field), e.message) || placed;
            // A 409 names the conflicting field only in its message; show it on the natural field.
            if (err.status === 409) {
              const key = /slug/i.test(err.message) ? 'slug' : 'name';
              placed = setFieldError(key, err.message) || placed;
            }
          }
          if (!placed) formError.textContent = message(err);
          if (err instanceof ApiError && err.status === 404) {
            // Stale: it was removed elsewhere. Close and refresh rather than leave a dead editor open.
            close();
            Forms.showAlert(els.alert, message(err), 'error');
            await load();
            return;
          }
          const firstBad = fields.map((f) => inputs[f.key]).find((i) => i.getAttribute('aria-invalid'));
          (firstBad || saveBtn).focus();
        }
      });

      // Enter submits single-line inputs (not textareas).
      body.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); saveBtn.click(); }
      });
    }

    // Modal shell with unsaved-changes protection (same behaviour as the
    // curriculum editor's; kept local so this page does not depend on
    // curriculum.js, which only loads on the course form).
    function openEditorModal({ title, body, actions, isDirty }) {
      const previouslyFocused = document.activeElement;
      const titleId = `editor-title-${Date.now()}`;
      const modal = Dom.el('div', { class: 'modal editor-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId }, [
        Dom.el('h3', { id: titleId, text: title }),
        body,
        Dom.el('div', { class: 'modal-actions' }, actions),
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
      async function attemptClose() {
        if (busy) return; // never abandon an in-flight save
        if (isDirty && isDirty()) {
          const leave = await Ui.confirm({ title: 'Discard unsaved changes?', message: 'You have changes that have not been saved.', confirmLabel: 'Discard', danger: true });
          if (!leave) return;
        }
        close();
      }
      function onKey(e) {
        // A nested confirm dialog handles its own Escape; only react when this modal is topmost.
        if (e.key === 'Escape' && document.querySelectorAll('.modal-backdrop').length === 1) attemptClose();
      }
      backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) attemptClose(); });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(backdrop);
      const first = modal.querySelector('input, textarea, select');
      if (first) first.focus();
      close.attempt = attemptClose;
      return close;
    }

    // ---- filter wiring -----------------------------------------------------------------------
    const reload = () => { state.page = 1; load(); };
    els.search.addEventListener('input', Dom.debounce(reload, 350));
    els.status.addEventListener('change', reload);
    els.sort.addEventListener('change', reload);
    els.reset.addEventListener('click', () => { els.search.value = ''; els.status.value = ''; els.sort.value = 'name'; reload(); });
    els.prev.addEventListener('click', () => { if (state.page > 1) { state.page -= 1; load(); } });
    els.next.addEventListener('click', () => { if (state.page < state.totalPages) { state.page += 1; load(); } });
    els.add.addEventListener('click', () => openEditor(null));

    await load();
  }

  return { init };
})();
