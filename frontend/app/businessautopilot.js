/* frontend/app/businessautopilot.js — the GOAL AUTOPILOT console (Business OS Phase 12, §9).

   §9's single entry. Type (or pick) a big objective, see the WHOLE plan it resolves to, and — as a separate,
   deliberate act — commit it into a business's task list. Everything else in the business OS works on what
   already exists; this is the one door for "get this whole thing into the system".

   WHY ITS OWN WINDOW. "AUTOPILOT" is a different word from anything on the dock, and the autopilot is not a
   kind of worker order or a kind of task — it is the entry point that CREATES tasks. So windows/autopilot.js
   owns the key and this file owns the engine.

   THE HONESTY PROBLEM THIS CONSOLE HAS. An autopilot is exactly the feature most tempted to fake competence:
   the natural thing to build is a box you type anything into and get a confident-looking plan back. This one
   refuses that. The goal set is CLOSED — the console shows the goals that ARE known, and an unknown goal is
   refused with that list rather than planned. The plan preview shows the exact TOKENS that matched, so the
   user can check the match instead of trusting it.

   TWO ACTS, TWO BUTTONS, NEVER ONE.
     PLAN    — resolves and shows. Asks the sidecar to write NOTHING.
     COMMIT  — writes the tasks into the chosen business. Deliberate, and separately labelled.

   THE TWO HALVES. The PURE half (shaping: the plan preview, the refusal, the catalogue rows, the client-side
   guards) is Node-loadable and unit-tested headless. The DOM half mounts it.

   NO `window.alert/confirm/prompt` (station-tooltip.test.js bans them). Ids are namespaced `.ap-*`: .ap- is
   free (.bc-/.bm-/.tm-/.mg-/.ba-/.wk-/.in-/.dt-/.se-/.mssn- are Phases 1/2/3/4/5/6/7/9/10/11). */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).businessAutopilotConsole = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ================================ PURE HALF ================================

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  const str = (v) => (v == null ? '' : String(v));

  /* The catalogue rows. A closed set — each row is a goal you can actually plan, with the tokens it needs. */
  function shapeCatalog(cat) {
    if (!cat || cat.ok !== true) return { ok: false, rows: [], count: 0, note: '' };
    const rows = (cat.goals || []).map(g => ({
      id: str(g.id), label: str(g.label), template: str(g.template),
      keywords: (g.keywords || []).map(k => str(k)),
      keywordText: (g.keywords || []).join(' · '),
      taskCount: Number(g.taskCount) || 0
    }));
    return { ok: true, rows: rows, count: rows.length, note: str(cat.note) };
  }

  /* A resolved plan, shaped for the preview. `ok!==true` is treated as the refusal it is. */
  function shapePlan(plan) {
    if (!plan || plan.ok !== true) {
      return {
        ok: false, plan: false,
        reason: str(plan && plan.reason) || 'that goal could not be planned',
        knownGoals: (plan && plan.knownGoals) || []
      };
    }
    const tasks = (plan.tasks || []).map((t, i) => ({
      n: i + 1, title: str(t.title), priority: str(t.priority), approvalRequired: !!t.approvalRequired
    }));
    return {
      ok: true, plan: true,
      goal: str(plan.goal), template: str(plan.template), source: str(plan.source),
      matchedBy: (plan.matchedBy || []).map(k => str(k)),
      matchedText: (plan.matchedBy || []).join(' + '),
      tasks: tasks, taskCount: tasks.length,
      staged: plan.staged === true,
      note: str(plan.note)
    };
  }

  /* A committed result. Distinct from a plan: it names the business and carries the store's OWN rows. */
  function shapeCommit(res) {
    if (!res || res.ok !== true) {
      return {
        ok: false, committed: false,
        reason: str(res && res.reason) || 'the plan could not be committed',
        knownGoals: (res && res.knownGoals) || []
      };
    }
    const tasks = (res.tasks || []).map((t, i) => ({ n: i + 1, id: str(t.id), title: str(t.title), status: str(t.status) }));
    return {
      ok: true, committed: true,
      goal: str(res.goal), template: str(res.template), businessId: str(res.businessId),
      matchedBy: (res.matchedBy || []).map(k => str(k)),
      tasks: tasks, created: Number(res.created) || tasks.length,
      chained: !!res.chained, note: str(res.note)
    };
  }

  /* The client-side guard, mirroring the server: an empty goal is not a request. Returns { ok, reason }. */
  function validateGoal(raw) {
    const goal = str(raw).trim();
    if (!goal) return { ok: false, reason: 'type an objective first' };
    if (goal.length > 400) return { ok: false, reason: 'that objective is too long' };
    return { ok: true, goal: goal };
  }

  /* One short line for the header, honest about the state. Never a percentage — there is no progress to
     report; the autopilot is either idle, holding a plan, or having committed one. */
  function headLine(state, catalog) {
    const parts = [];
    parts.push(catalog && catalog.ok ? (catalog.count + ' goal' + (catalog.count === 1 ? '' : 's') + ' known') : 'goal list unavailable');
    if (state && state.committed) parts.push('committed ' + state.committed.created + ' task' + (state.committed.created === 1 ? '' : 's'));
    else if (state && state.plan && state.plan.ok) parts.push('showing a plan of ' + state.plan.taskCount + ' tasks');
    return parts.join(' — ');
  }

  return {
    esc, str, shapeCatalog, shapePlan, shapeCommit, validateGoal, headLine,
    mount: mount
  };

  // ================================ DOM HALF ================================

  function apiFetch(path, init) {
    const H = (typeof StationUI !== 'undefined' && StationUI.h) || {};
    if (typeof H.api === 'function') return H.api(path, init);
    return fetch(path, init).then(r => r.json().catch(() => ({ ok: false, reason: 'the response was not JSON' })));
  }

  /* The business list for the commit picker, read from the shared presentBusinesses helper (the same one
     every other console uses, so they cannot disagree). */
  function businessOptions() {
    const H = (typeof StationUI !== 'undefined' && StationUI.h) || {};
    const list = (H.presentBusinesses && H.presentBusinesses()) || [];
    if (!list.length) return '<option value="">no businesses yet — make one first</option>';
    return list.map(b => '<option value="' + esc(b.id) + '">' + esc(b.name || b.id) + '</option>').join('');
  }

  function mount(body) {
    const host = typeof body === 'string' ? document.getElementById(body) : body;
    if (!host) return null;

    host.innerHTML = '' +
      '<div class="ap-wrap">' +
        '<div class="ap-head">' +
          '<h3 class="ap-title">GOAL AUTOPILOT</h3>' +
          '<span class="ap-banner" data-hint="autopilot">one objective → the whole plan, ready to work — the goal set is closed, so an unknown goal is refused, not invented</span>' +
          '<span class="ap-spacer"></span>' +
          '<span class="ap-sum" id="ap-sum"></span>' +
          '<button class="ap-btn" id="ap-refresh" data-hint="autopilot">REFRESH</button>' +
        '</div>' +
        '<div class="ap-sec">' +
          '<h4 class="ap-h4">WHAT IT KNOWS</h4>' +
          '<div id="ap-catalog" class="ap-catalog"></div>' +
        '</div>' +
        '<div class="ap-sec">' +
          '<h4 class="ap-h4">STATE AN OBJECTIVE</h4>' +
          '<div class="ap-form">' +
            '<input id="ap-goal" class="ap-input" type="text" placeholder="e.g. launch a digital product" data-hint="autopilot">' +
            '<button id="ap-plan" class="ap-btn ap-primary" data-hint="autopilot">PLAN</button>' +
          '</div>' +
          '<div id="ap-msg" class="ap-msg"></div>' +
          '<div id="ap-planout" class="ap-planout"></div>' +
        '</div>' +
      '</div>';

    const state = { catalog: null, plan: null, committed: null, busy: false };
    const el = id => host.querySelector(id);

    function msg(text, ok) {
      const m = el('#ap-msg');
      if (!m) return;
      m.className = 'ap-msg ' + (ok ? 'ap-ok' : 'ap-bad');
      m.textContent = text || '';
    }

    function renderCatalog() {
      const c = shapeCatalog(state.catalog);
      const t = el('#ap-catalog');
      if (!t) return;
      if (!c.ok) { t.innerHTML = '<p class="ap-err">the goal catalogue could not be read — planning is unavailable until it can.</p>'; return; }
      if (!c.rows.length) { t.innerHTML = '<p class="ap-empty">No goals are known yet.</p>'; return; }
      t.innerHTML = '<table class="ap-table"><thead><tr><th>goal</th><th>tokens it matches</th><th class="ap-num">tasks</th><th></th></tr></thead><tbody>' +
        c.rows.map(r =>
          '<tr><td class="ap-goal-cell">' + esc(r.label) + '</td>' +
          '<td class="ap-kw">' + esc(r.keywordText) + '</td>' +
          '<td class="ap-num">' + r.taskCount + '</td>' +
          '<td><button class="ap-btn ap-xs ap-use" data-ap-goal="' + esc(r.label) + '">USE</button></td></tr>').join('') +
        '</tbody></table>' +
        '<p class="ap-note">' + esc(c.note) + '</p>';
    }

    function renderPlan() {
      const out = el('#ap-planout');
      if (!out) return;
      const p = shapePlan(state.plan);
      const h = headLine(state, shapeCatalog(state.catalog));
      const sum = el('#ap-sum');
      if (sum) sum.textContent = h;

      if (!state.plan) { out.innerHTML = ''; return; }

      if (!p.ok) {
        const known = p.knownGoals.length
          ? '<p class="ap-known"><b>Try one of these instead:</b> ' + p.knownGoals.map(esc).join(' · ') + '</p>'
          : '';
        out.innerHTML = '<div class="ap-refuse"><p class="ap-refuse-line">' + esc(p.reason) + '</p>' + known +
          '<p class="ap-note">An autopilot that planned an objective it does not know would be inventing a plan — and you would act on it. So it will not.</p></div>';
        return;
      }

      const rows = p.tasks.map(t =>
        '<tr><td class="ap-num">' + t.n + '</td><td>' + esc(t.title) + '</td>' +
        '<td class="ap-pri">' + esc(t.priority) + '</td>' +
        '<td class="ap-appr">' + (t.approvalRequired ? 'needs approval' : '') + '</td></tr>').join('');

      out.innerHTML =
        '<div class="ap-plan-head">' +
          '<span class="ap-plan-goal">' + esc(p.goal) + '</span>' +
          '<span class="ap-plan-meta">matched on <b>' + esc(p.matchedText) + '</b>' + (p.source ? ' · ' + esc(p.source) : '') + '</span>' +
        '</div>' +
        (p.staged ? '<p class="ap-staged">This is a PLAN — nothing has been written. Committing below creates the tasks.</p>' : '') +
        '<table class="ap-table ap-plan-table"><thead><tr><th class="ap-num">#</th><th>task</th><th>priority</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>' +
        '<div class="ap-commit-bar">' +
          '<select id="ap-biz" class="ap-input ap-biz" data-hint="autopilot">' + businessOptions() + '</select>' +
          '<button id="ap-commit" class="ap-btn ap-primary" data-hint="autopilot">COMMIT TO THIS BUSINESS</button>' +
        '</div>' +
        '<div id="ap-commit-msg" class="ap-msg"></div>';
      wireCommit();
    }

    function renderCommitted(c) {
      const out = el('#ap-planout');
      if (!out) return;
      out.innerHTML = '<div class="ap-committed"><p class="ap-committed-line">Committed <b>' + c.created + '</b> task' +
        (c.created === 1 ? '' : 's') + ' to <b>' + esc(c.businessId) + '</b>' + (c.chained ? ', chained in dependency order' : '') + '.</p>' +
        '<table class="ap-table"><thead><tr><th class="ap-num">#</th><th>id</th><th>task</th></tr></thead><tbody>' +
        c.tasks.map(t => '<tr><td class="ap-num">' + t.n + '</td><td class="ap-id">' + esc(t.id) + '</td><td>' + esc(t.title) + '</td></tr>').join('') +
        '</tbody></table>' +
        '<p class="ap-note">' + esc(c.note || 'The tasks now belong to the business task store and follow its rules from here.') + '</p></div>';
      const sum = el('#ap-sum');
      if (sum) sum.textContent = headLine(state, shapeCatalog(state.catalog));
    }

    async function loadCatalog() {
      try {
        const r = await apiFetch('/api/autopilot/catalog');
        state.catalog = r && r.ok ? r : (r && r.j ? r.j : r);
      } catch (e) { state.catalog = null; /* the panel says so */ }
      renderCatalog();
      const sum = el('#ap-sum');
      if (sum) sum.textContent = headLine(state, shapeCatalog(state.catalog));
    }

    async function doPlan() {
      if (state.busy) return;
      const v = validateGoal(el('#ap-goal') ? el('#ap-goal').value : '');
      if (!v.ok) return msg(v.reason, false);
      state.busy = true;
      state.committed = null;
      msg('reading the plan…', true);
      try {
        const r = await apiFetch('/api/autopilot/plan', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ goal: v.goal })
        });
        const body = r && r.j ? r.j : r;
        state.plan = body;
        if (body && body.ok) msg('', true); else msg('', true);
      } catch (e) { state.plan = { ok: false, reason: 'the sidecar could not be reached' }; }
      state.busy = false;
      const m = el('#ap-msg'); if (m) m.textContent = '';
      renderPlan();
    }

    function wireCommit() {
      const btn = el('#ap-commit');
      if (btn) btn.addEventListener('click', doCommit);
    }

    async function doCommit() {
      if (state.busy) return;
      const biz = el('#ap-biz');
      const businessId = biz ? biz.value : '';
      const cm = el('#ap-commit-msg');
      if (!state.plan || state.plan.ok !== true) return;
      const goal = state.plan.goal;

      async function really() {
        state.busy = true;
        if (cm) { cm.className = 'ap-msg ap-ok'; cm.textContent = 'writing…'; }
        try {
          const r = await apiFetch('/api/autopilot/commit', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ goal: goal, businessId: businessId })
          });
          const body = r && r.j ? r.j : r;
          const c = shapeCommit(body);
          if (c.ok) { state.committed = c; renderCommitted(c); return; }
          if (cm) { cm.className = 'ap-msg ap-bad'; cm.textContent = c.reason + (c.knownGoals.length ? ' — try: ' + c.knownGoals.join(' · ') : ''); }
        } catch (e) {
          if (cm) { cm.className = 'ap-msg ap-bad'; cm.textContent = 'the sidecar could not be reached'; }
        }
        state.busy = false;
      }

      // A commit WRITES tasks, so it is confirmed. ArmConfirm is fail-closed: without it, no write.
      if (typeof ArmConfirm !== 'undefined' && typeof ArmConfirm.wire === 'function') {
        ArmConfirm.wire(btn, { armedLabel: 'CONFIRM COMMIT', onConfirm: really });
        btn.click();
      } else {
        if (cm) { cm.className = 'ap-msg ap-bad'; cm.textContent = 'confirmation helper unavailable — refusing to write unconfirmed'; }
      }
    }

    const planBtn = el('#ap-plan');
    if (planBtn) planBtn.addEventListener('click', doPlan);
    const refresh = el('#ap-refresh');
    if (refresh) refresh.addEventListener('click', () => { loadCatalog(); });
    // clicking a USE button drops the goal into the box
    host.addEventListener('click', (ev) => {
      const b = ev.target.closest && ev.target.closest('.ap-use');
      if (!b) return;
      const g = b.getAttribute('data-ap-goal') || '';
      const box = el('#ap-goal');
      if (box) { box.value = g; box.focus(); }
    });
    const box = el('#ap-goal');
    if (box) box.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') doPlan(); });

    loadCatalog();
    return { destroy: () => { host.innerHTML = ''; } };
  }
});
