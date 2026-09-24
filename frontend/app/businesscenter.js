/* STARNET — businesscenter.js : the BUSINESS COMMAND CENTER (Business OS Phase 1).

   The first surface in the app that is about BUSINESSES rather than about agents. It answers three questions
   and refuses to answer a fourth:
     WHAT BUSINESSES EXIST      — the entity list, each with its real lifecycle stage.
     WHAT HAPPENED              — the per-business audit log (§20), read straight from the store that wrote it.
     HOW DO I START ONE         — the create form (the seed Phase 2's Business Maker grows from).
     (it does NOT invent revenue, growth, or a score. There is no data behind such a number yet, so there is
      no such number here. Per P1, an estimate belongs to the store that produced it and carries its evidence
      class; a dashboard that fabricated one would poison every decision made from it.)

   THE E-STOP LIVES HERE TOO. Setting a business's stage to PAUSED is the per-business stop (§21): the sidecar
   aborts that business's in-flight runs and refuses new ones until it is resumed. This module does not
   re-implement any of that — it sends the stage and reports the `halted` count the sidecar returned. Two
   doors to one action is how a stop button starts lying.

   TWO HALVES, ON PURPOSE.
     The PURE half (labels, row shaping, summary, the run guard) is UMD and Node-loadable, so it is unit-tested
     headless exactly like projects.js / workstreams.js — no DOM, no fetch.
     The DOM half (mount) builds the console window. It is the only part that needs a browser, and it degrades
     to a no-op rather than throwing when StationUI or the document is absent.

   TELEMETRY IS LAST-GOOD, NEVER OPTIMISTIC. A failed load renders the error and KEEPS the previous rows
   visible; it never blanks the list into a convincing-looking "no businesses". */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.BusinessCenter = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ---- the vocabularies, mirrored from the sidecar stores (businesses-store.js / business-activity-store.js).
  // A value outside these renders as UNKNOWN rather than being coerced into something plausible.
  const STAGES = ['idea', 'validating', 'building', 'live', 'paused', 'archived'];
  const TEMPLATES = ['saas', 'content', 'digital-product', 'agency', 'custom'];
  const RESULTS = ['ok', 'error', 'pending'];
  const APPROVALS = ['not-required', 'required', 'granted', 'denied'];

  const STAGE_LABEL = {
    idea: 'IDEA', validating: 'VALIDATING', building: 'BUILDING',
    live: 'LIVE', paused: 'PAUSED', archived: 'ARCHIVED'
  };
  const TEMPLATE_LABEL = {
    saas: 'SAAS', content: 'CONTENT', 'digital-product': 'DIGITAL PRODUCT',
    agency: 'AGENCY', custom: 'CUSTOM'
  };
  const RESULT_LABEL = { ok: 'OK', error: 'FAILED', pending: 'PENDING' };
  const APPROVAL_LABEL = {
    'not-required': '', required: 'NEEDS APPROVAL', granted: 'APPROVED', denied: 'DENIED'
  };
  const ACTOR_LABEL = { user: 'YOU', agent: 'AI', system: 'SYSTEM' };

  function label(map, v, fallback) { return map[String(v == null ? '' : v)] || fallback; }
  function stageLabel(s) { return label(STAGE_LABEL, s, 'UNKNOWN'); }
  function templateLabel(t) { return label(TEMPLATE_LABEL, t, 'CUSTOM'); }
  function resultLabel(r) { return label(RESULT_LABEL, r, 'UNKNOWN'); }
  function approvalLabel(a) { return label(APPROVAL_LABEL, a, ''); }
  function actorLabel(k) { return label(ACTOR_LABEL, k, 'SYSTEM'); }

  // compact right-edge stamp, the same vocabulary the sessions/projects rails use (now · 2m · 1h · 3d).
  // Injected clock so the test is deterministic; a null/0 stamp reads '' (nothing has moved yet — say so).
  function relTime(ms, nowMs) {
    if (!ms) return '';
    const now = (typeof nowMs === 'number') ? nowMs : Date.now();
    const d = now - ms;
    if (d < 0) return 'now';                       // a clock skew must not render "-3m"
    if (d < 60000) return 'now';
    const m = Math.floor(d / 60000);
    if (m < 60) return m + 'm';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h';
    return Math.floor(h / 24) + 'd';
  }

  // is this business allowed to spend? mirrors the sidecar's /api/run guard EXACTLY — if these two ever
  // disagree, the UI offers a launch the engine will refuse, which reads as a broken button.
  function runGuard(business) {
    const stage = String((business && business.stage) || 'idea');
    if (stage === 'paused') return { allowed: false, reason: 'This business is PAUSED — resume it before running work for it.' };
    if (stage === 'archived') return { allowed: false, reason: 'This business is ARCHIVED — it no longer runs work.' };
    return { allowed: true, reason: '' };
  }

  function isPaused(b) { return String((b && b.stage) || '') === 'paused'; }

  // ---- list rows -------------------------------------------------------------------------------------
  // Server order is preserved (businesses-store already sorts newest-updated first).
  function toRows(businesses, nowMs) {
    return (Array.isArray(businesses) ? businesses : []).map(function (b) {
      b = b || {};
      const id = String(b.id || '');
      // resolve the stage ONCE — the display label, the flags and the guard must all read the SAME value, or
      // a row can claim stage 'idea' while labelling itself UNKNOWN (which is exactly what it did before).
      const stage = String(b.stage || 'idea');
      return {
        id: id,
        name: String(b.name || '(unnamed)'),
        stage: stage,
        stageLabel: stageLabel(stage),
        template: String(b.template || 'custom'),
        templateLabel: templateLabel(b.template),
        description: String(b.description || ''),
        paused: stage === 'paused',
        archived: stage === 'archived',
        createdBy: b.createdBy === 'ai' ? 'ai' : 'user',
        createdLabel: b.createdBy === 'ai' ? 'AI-PROPOSED' : 'YOURS',
        updatedRel: relTime(b.updatedAt, nowMs),
        guard: runGuard({ stage: stage })
      };
    });
  }

  // ---- activity rows ---------------------------------------------------------------------------------
  function activityRows(activity, nowMs) {
    return (Array.isArray(activity) ? activity : []).map(function (e) {
      e = e || {};
      const actor = (e.actor && typeof e.actor === 'object') ? e.actor : {};
      return {
        id: String(e.id || ''),
        seq: (typeof e.seq === 'number') ? e.seq : 0,
        action: String(e.action || ''),
        result: String(e.result || 'ok'),
        resultLabel: resultLabel(e.result),
        approval: String(e.approval || 'not-required'),
        approvalLabel: approvalLabel(e.approval),
        actorKind: String(actor.kind || 'system'),
        actorLabel: actorLabel(actor.kind),
        detail: String(e.detail || ''),
        rel: relTime(e.at, nowMs)
      };
    });
  }

  // ---- summary ---------------------------------------------------------------------------------------
  // Honest counts only. `active` = a business that is neither frozen nor retired, which is the only
  // definition the stages actually support; nothing here claims activity that was not observed.
  function summarize(businesses) {
    const list = Array.isArray(businesses) ? businesses : [];
    const byStage = {};
    for (const s of STAGES) byStage[s] = 0;
    let other = 0;
    for (const b of list) {
      const s = String((b && b.stage) || 'idea');
      if (Object.prototype.hasOwnProperty.call(byStage, s)) byStage[s]++;
      else other++;
    }
    return {
      total: list.length,
      byStage: byStage,
      other: other,
      active: list.length - byStage.paused - byStage.archived,
      paused: byStage.paused,
      archived: byStage.archived
    };
  }

  // ---- the stage picker ------------------------------------------------------------------------------
  function stageOptions(current) {
    return STAGES.map(function (s) {
      return { value: s, label: stageLabel(s), selected: s === current };
    });
  }
  function templateOptions(current) {
    return TEMPLATES.map(function (t) {
      return { value: t, label: templateLabel(t), selected: t === current };
    });
  }

  // the header strip: a real count of what is on the station, phrased so a zero is not a mystery.
  function summaryLine(sum) {
    if (!sum || !sum.total) return 'No businesses yet — start one from NEW BUSINESS.';
    const bits = [sum.total + (sum.total === 1 ? ' business' : ' businesses')];
    if (sum.active) bits.push(sum.active + ' active');
    if (sum.paused) bits.push(sum.paused + ' paused');
    if (sum.archived) bits.push(sum.archived + ' archived');
    return bits.join(' · ');
  }

  /* ================= DOM half — the console window ================= */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  /* ONE request helper. The Response object is kept in scope and r.ok is read — a plain-text 403 or a proxy
     HTML page must never collapse into {} and render as success. Resolves { ok, status, j } and only rejects
     on a transport failure, mirroring Harness.api's post/del shape. window.fetch is hardened at boot
     (harness.js) to attach the per-launch X-StarNet-Token to every /api/ URL, so no header work here. */
  function request(method, path, body) {
    const init = { method: method, cache: 'no-store' };
    if (body !== undefined) { init.headers = { 'Content-Type': 'application/json' }; init.body = JSON.stringify(body == null ? {} : body); }
    return fetch(path, init).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; })
        .catch(function () { return { ok: r.ok, status: r.status, j: {} }; });
    });
  }

  // the most useful sentence a non-2xx body can give us, without inventing one.
  function errText(r, fallback) {
    const j = r && r.j;
    if (j && typeof j.error === 'string' && j.error) return j.error;
    if (r && r.status) return fallback + ' (HTTP ' + r.status + ')';
    return fallback;
  }

  // the live instance + a debounced bus refresh. A bus event and our own mutation response both want a
  // reload; one 200ms timer collapses them into a single fetch instead of two racing ones.
  let live = null;
  let busWired = false;
  let refreshTimer = null;
  function scheduleRefresh() {
    if (!live || refreshTimer) return;
    refreshTimer = setTimeout(function () { refreshTimer = null; if (live) { try { live.refresh(); } catch (_) {} } }, 200);
  }
  function wireBus() {
    if (busWired) return;
    busWired = true;
    if (typeof U === 'undefined' || !U.bus || typeof U.bus.on !== 'function') return;
    const names = ['business.created', 'business.updated', 'business.deleted', 'business.paused', 'business.activity'];
    for (const n of names) { try { U.bus.on(n, scheduleRefresh); } catch (_) {} }
  }

  function mount(body) {
    if (typeof document === 'undefined' || !body) return null;
    const SUI = (typeof StationUI !== 'undefined') ? StationUI : null;
    if (!SUI || !SUI.h || typeof SUI.h.mountConsole !== 'function') return null;

    const panes = {};
    SUI.h.mountConsole(body, 'business', [
      {
        id: 'list', label: 'BUSINESSES', glyph: '▣',
        desc: 'Every business on the station, and the stage it is really in. Setting one to PAUSED is the per-business stop — its running work is halted immediately and new work is refused until you resume it.',
        build: function (p) { panes.list = p; }
      },
      {
        id: 'activity', label: 'ACTIVITY', glyph: '≡',
        desc: 'The audit log for the selected business — what happened, who did it, why, and what came of it. Read straight from the record; nothing here is summarised away.',
        build: function (p) { panes.activity = p; }
      },
      {
        id: 'new', label: 'NEW BUSINESS', glyph: '＋',
        desc: 'Start a business. Only the name is required — everything else can be filled in as you learn it.',
        build: function (p) { panes.new = p; }
      }
    ], { search: false });

    const state = { businesses: [], activity: [], selected: '', error: '', notice: '', busy: false, armedPause: '' };

    /* Two-press confirmation, the house pattern. An OS modal (window.confirm) over the phosphor terminal is
       banned — test/station-tooltip.test.js enforces it — and armconfirm.js is the shared helper.
       FAIL-CLOSED: if ArmConfirm is somehow absent the control is DISABLED rather than falling back to a
       native dialog or firing unconfirmed. A destructive button that cannot ask is a button that must not act. */
    function arm(btn, label, onConfirm) {
      if (!btn) return;
      if (typeof ArmConfirm === 'undefined' || typeof ArmConfirm.wire !== 'function') {
        btn.disabled = true;
        btn.title = 'confirmation helper unavailable — refusing to act unconfirmed';
        return;
      }
      ArmConfirm.wire(btn, { armedLabel: label, onConfirm: onConfirm });
    }

    // ---- renderers ----
    function renderList() {
      const p = panes.list; if (!p) return;
      const sum = summarize(state.businesses);
      const rows = toRows(state.businesses, Date.now());
      let html = '<div class="bc-sum">' + esc(summaryLine(sum)) + '</div>';
      if (state.error) html += '<div class="bc-err">' + esc(state.error) + '</div>';
      if (!rows.length) {
        html += '<p class="bc-empty">No businesses yet. Open <b>NEW BUSINESS</b> to create the first one.</p>';
      } else {
        html += '<div class="bc-rows">';
        for (const r of rows) {
          const sel = (r.id === state.selected) ? ' bc-sel' : '';
          const opts = stageOptions(r.stage).map(o =>
            '<option value="' + esc(o.value) + '"' + (o.selected ? ' selected' : '') + '>' + esc(o.label) + '</option>').join('');
          html += '<div class="bc-row' + sel + (r.paused ? ' bc-paused' : '') + (state.armedPause === r.id ? ' bc-armed' : '') + '" data-id="' + esc(r.id) + '">' +
            '<div class="bc-row-main">' +
              '<div class="bc-row-name">' + esc(r.name) +
                '<span class="bc-chip bc-stage-' + esc(r.stage) + '">' + esc(r.stageLabel) + '</span>' +
                '<span class="bc-chip bc-prov">' + esc(r.createdLabel) + '</span>' +
              '</div>' +
              '<div class="bc-row-sub">' + esc(r.templateLabel) + (r.updatedRel ? ' · updated ' + esc(r.updatedRel) : '') + '</div>' +
              (r.guard.allowed ? '' : '<div class="bc-row-warn">' + esc(r.guard.reason) + '</div>') +
            '</div>' +
            '<div class="bc-row-act">' +
              '<label class="bc-lbl">STAGE</label>' +
              '<select class="bc-stage" data-id="' + esc(r.id) + '">' + opts + '</select>' +
              '<button type="button" class="bc-del" data-id="' + esc(r.id) + '" title="delete this business">DELETE</button>' +
            '</div>' +
          '</div>';
        }
        html += '</div>';
      }
      if (state.notice) html += '<div class="bc-note">' + esc(state.notice) + '</div>';
      p.innerHTML = html;
      wireList(p);
    }

    function renderActivity() {
      const p = panes.activity; if (!p) return;
      const rows = activityRows(state.activity, Date.now());
      let html = '<div class="bc-act-head">' +
        '<label class="bc-lbl">BUSINESS</label>' +
        '<select class="bc-pick">' +
        '<option value="">— none —</option>' +
        toRows(state.businesses, Date.now()).map(r =>
          '<option value="' + esc(r.id) + '"' + (r.id === state.selected ? ' selected' : '') + '>' + esc(r.name) + '</option>').join('') +
        '</select></div>';
      if (!state.selected) {
        html += '<p class="bc-empty">Pick a business to read its log.</p>';
      } else if (!rows.length) {
        html += '<p class="bc-empty">Nothing recorded for this business yet.</p>';
      } else {
        html += '<div class="bc-act">';
        for (const e of rows) {
          html += '<div class="bc-act-row bc-res-' + esc(e.result) + '">' +
            '<div class="bc-act-top">' +
              '<span class="bc-chip bc-res">' + esc(e.resultLabel) + '</span>' +
              '<span class="bc-act-who">' + esc(e.actorLabel) + '</span>' +
              (e.approvalLabel ? '<span class="bc-chip bc-appr">' + esc(e.approvalLabel) + '</span>' : '') +
              (e.rel ? '<span class="bc-act-rel">' + esc(e.rel) + '</span>' : '') +
            '</div>' +
            '<div class="bc-act-action">' + esc(e.action) + '</div>' +
            (e.detail ? '<div class="bc-act-detail">' + esc(e.detail) + '</div>' : '') +
          '</div>';
        }
        html += '</div>';
      }
      p.innerHTML = html;
      const pick = p.querySelector('.bc-pick');
      if (pick) pick.addEventListener('change', function () {
        state.selected = String(pick.value || '');
        renderList(); loadActivity();
      });
    }

    function renderNew() {
      const p = panes.new; if (!p) return;
      if (p.getAttribute('data-built') === '1') return;   // the form is built once; re-rendering it would eat typing
      p.setAttribute('data-built', '1');
      p.innerHTML =
        '<div class="bc-form">' +
          '<label class="bc-f"><span>NAME *</span><input class="bc-f-name" type="text" maxlength="120" placeholder="Neighborhood Notes"></label>' +
          '<label class="bc-f"><span>TEMPLATE</span><select class="bc-f-template">' +
            templateOptions('custom').map(o => '<option value="' + esc(o.value) + '"' + (o.selected ? ' selected' : '') + '>' + esc(o.label) + '</option>').join('') +
          '</select></label>' +
          '<label class="bc-f"><span>CURRENCY</span><input class="bc-f-currency" type="text" maxlength="8" value="USD"></label>' +
          '<label class="bc-f bc-f-wide"><span>WHAT IT IS</span><textarea class="bc-f-description" rows="3" placeholder="One or two sentences. Optional."></textarea></label>' +
          '<label class="bc-f bc-f-wide"><span>WHO IT IS FOR</span><input class="bc-f-targetCustomer" type="text" placeholder="Optional"></label>' +
          '<label class="bc-f bc-f-wide"><span>WHY THEY PICK IT</span><input class="bc-f-valueProposition" type="text" placeholder="Optional"></label>' +
          '<label class="bc-f bc-f-wide"><span>HOW IT MAKES MONEY</span><input class="bc-f-businessModel" type="text" placeholder="Optional"></label>' +
          '<label class="bc-f bc-f-wide"><span>PRICING</span><input class="bc-f-pricingModel" type="text" placeholder="Optional"></label>' +
          '<div class="bc-f-actions"><button type="button" class="bc-create">CREATE BUSINESS</button><span class="bc-f-status"></span></div>' +
        '</div>';
      const btn = p.querySelector('.bc-create');
      btn.addEventListener('click', function () {
        const val = (sel) => { const el = p.querySelector(sel); return el ? String(el.value || '').trim() : ''; };
        const name = val('.bc-f-name');
        const status = p.querySelector('.bc-f-status');
        if (!name) { status.textContent = 'a name is required'; status.className = 'bc-f-status bc-bad'; return; }
        const body = {
          name: name,
          template: val('.bc-f-template') || 'custom',
          currency: val('.bc-f-currency') || 'USD',
          description: val('.bc-f-description'),
          targetCustomer: val('.bc-f-targetCustomer'),
          valueProposition: val('.bc-f-valueProposition'),
          businessModel: val('.bc-f-businessModel'),
          pricingModel: val('.bc-f-pricingModel')
        };
        btn.disabled = true;
        status.textContent = 'creating…'; status.className = 'bc-f-status';
        request('POST', '/api/businesses', body).then(function (r) {
          btn.disabled = false;
          if (!r.ok) { status.textContent = errText(r, 'could not create'); status.className = 'bc-f-status bc-bad'; return; }
          const made = r.j && r.j.business;
          state.selected = (made && made.id) || state.selected;
          state.notice = 'created ' + ((made && made.name) || name);
          p.querySelector('.bc-f-name').value = '';
          status.textContent = 'created'; status.className = 'bc-f-status bc-good';
          renderList();
          live.refresh();
        }).catch(function () {
          btn.disabled = false;
          status.textContent = 'could not reach the station'; status.className = 'bc-f-status bc-bad';
        });
      });
    }

    // ---- wiring ----
    function wireList(p) {
      p.querySelectorAll('.bc-stage').forEach(function (sel) {
        sel.addEventListener('change', function () {
          const id = String(sel.getAttribute('data-id') || '');
          const stage = String(sel.value || '');
          const row = toRows(state.businesses, Date.now()).find(r => r.id === id);
          /* PAUSING IS A STOP, so it takes two presses — the same arm/confirm discipline the delete button
             uses, applied to a <select>. The FIRST change to PAUSED is refused, the control snaps back to the
             truth, and the row is marked armed; the SECOND change confirms. Any other stage is a plain
             relabel and commits at once. state.armedPause survives the re-render (the DOM attribute would not). */
          if (stage === 'paused' && row && !row.paused && state.armedPause !== id) {
            state.armedPause = id;
            sel.value = row.stage;                      // put the control back where the truth is
            state.notice = 'press PAUSED again to confirm — this stops "' + row.name +
              '" in-flight work and refuses new work until you resume it. Other businesses are unaffected.';
            renderList();
            return;
          }
          state.armedPause = '';
          sel.disabled = true;
          request('PATCH', '/api/businesses/' + encodeURIComponent(id), { stage: stage }).then(function (r) {
            sel.disabled = false;
            if (!r.ok) {
              state.error = errText(r, 'could not change the stage');
              if (row) sel.value = row.stage;   // put the control back where the truth is
              renderList();
              return;
            }
            state.error = '';
            const halted = (r.j && typeof r.j.halted === 'number') ? r.j.halted : 0;
            state.notice = (stage === 'paused')
              ? ('paused — stopped ' + halted + ' in-flight run' + (halted === 1 ? '' : 's'))
              : ('stage set to ' + stageLabel(stage));
            live.refresh();
          }).catch(function () {
            sel.disabled = false;
            if (row) sel.value = row.stage;
            state.error = 'could not reach the station';
            renderList();
          });
        });
      });
      p.querySelectorAll('.bc-del').forEach(function (btn) {
        const id = String(btn.getAttribute('data-id') || '');
        arm(btn, 'SURE?', function () {
          const row = toRows(state.businesses, Date.now()).find(r => r.id === id);
          btn.disabled = true;
          request('DELETE', '/api/businesses/' + encodeURIComponent(id)).then(function (r) {
            btn.disabled = false;
            if (!r.ok) { state.error = errText(r, 'could not delete'); renderList(); return; }
            state.error = '';
            state.notice = 'deleted ' + ((row && row.name) || id);
            if (state.selected === id) { state.selected = ''; state.activity = []; }
            live.refresh();
          }).catch(function () {
            btn.disabled = false;
            state.error = 'could not reach the station';
            renderList();
          });
        });
      });
      // clicking a row selects it for the ACTIVITY pane (the controls stop propagation by being controls)
      p.querySelectorAll('.bc-row').forEach(function (rowEl) {
        rowEl.addEventListener('click', function (ev) {
          const t = ev.target;
          if (t && (t.tagName === 'SELECT' || t.tagName === 'BUTTON' || t.tagName === 'OPTION' || t.tagName === 'LABEL')) return;
          const id = String(rowEl.getAttribute('data-id') || '');
          if (!id || id === state.selected) return;
          state.selected = id;
          renderList(); loadActivity();
        });
      });
    }

    function loadActivity() {
      if (!state.selected) { state.activity = []; renderActivity(); return Promise.resolve(); }
      return request('GET', '/api/businesses/' + encodeURIComponent(state.selected) + '/activity').then(function (r) {
        if (r.ok && r.j && Array.isArray(r.j.activity)) state.activity = r.j.activity;
        renderActivity();
      }).catch(function () { renderActivity(); });
    }

    function refresh() {
      return request('GET', '/api/businesses').then(function (r) {
        if (!r.ok) { state.error = errText(r, 'could not load businesses'); renderList(); return; }
        state.error = '';
        state.businesses = (r.j && Array.isArray(r.j.businesses)) ? r.j.businesses : [];
        if (!state.selected && state.businesses.length) state.selected = state.businesses[0].id;
        if (state.selected && !state.businesses.some(b => b && b.id === state.selected)) {
          state.selected = state.businesses.length ? state.businesses[0].id : '';
        }
        renderList();
        return loadActivity();
      }).catch(function () {
        state.error = 'could not reach the station';
        renderList();
      });
    }

    renderNew();
    renderList();
    renderActivity();
    wireBus();
    const inst = { state: state, refresh: refresh, loadActivity: loadActivity };
    live = inst;
    refresh();
    return inst;
  }

  return {
    STAGES, TEMPLATES, RESULTS, APPROVALS,
    stageLabel, templateLabel, resultLabel, approvalLabel, actorLabel,
    relTime, runGuard, isPaused,
    toRows, activityRows, summarize, stageOptions, templateOptions, summaryLine,
    esc, request, errText,
    mount
  };
});
