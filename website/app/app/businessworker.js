/* frontend/app/businessworker.js — the AI WORKER console (Business OS Phase 6).

   §13's AI Worker: an agent doing real station work — files, the web, the notebook — under the business
   owner's permission tiers, with the runtime's own gates still in front of it.

   WHY ITS OWN WINDOW. Every earlier business phase joined an existing console (Phase 5 registered a LANE into
   AUTOMATION). The Worker does not fit that: it is not a kind of routine, and "WORKER" is a different word
   from anything already on the dock. So windows/worker.js owns the key and this file owns the engine.

   THE TWO HALVES. The PURE half (labels, row shaping, the client-side validation mirror) is Node-loadable and
   unit-tested headless. The DOM half mounts it. The pure half is where the honesty lives, and Phase 6 has a
   specific honesty problem the earlier phases did not:

     A STEP HAS TWO PERMISSION ANSWERS, NOT ONE.
       · `tier`  — §13's verdict on the ACTION. What the act means to the business.
       · `floor` — the runtime's requirement for the MECHANISM, from the tool's own declaration.
     They are different axes and they can disagree. `fs.write` is a safe ACTION (draft) whose MECHANISM the
     runtime floors at review. A console that showed only one number would either understate the risk
     ("safe, it just ran") or misfile it ("review, so here is an Approve button that does nothing" —
     business-approvals-store correctly refuses to file a safe action as a review request). So every step row
     shows both, and the Approve button appears ONLY for a step that is genuinely waiting on the owner.

   The other half of the honesty rule: a step is `held` for two different reasons, and they are not the same
   wait. A §13 review step has a request in the owner's queue (`approvalId` set). A step held by the runtime
   consent gate has NO request — there is nothing to approve, only a run to start with a person attending.
   Rendering a dead Approve button for the second would be a lie about who can unblock it.

   NO `window.alert/confirm/prompt` (station-tooltip.test.js bans them). Destructive controls go through
   ArmConfirm's two-press helper, fail-closed. Ids are namespaced `wk-*`: .wk- is free (.bc-/.bm-/.tm-/.mg-/
   .ba- are Phases 1/2/3/4/5). */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).businessWorkerConsole = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ================================ PURE HALF ================================

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function relTime(at, now) {
    if (at == null || !isFinite(Number(at))) return 'never';
    const d = Number(now) - Number(at);
    if (!isFinite(d)) return 'never';
    if (d < 0) return 'just now';
    if (d < 60000) return Math.floor(d / 1000) + 's ago';
    if (d < 3600000) return Math.floor(d / 60000) + 'm ago';
    if (d < 86400000) return Math.floor(d / 3600000) + 'h ago';
    return Math.floor(d / 86400000) + 'd ago';
  }

  const TIER_CLASS = { safe: 'wk-safe', review: 'wk-review', restricted: 'wk-restricted' };
  const STATUS_CLASS = {
    planned: 'wk-planned', running: 'wk-running', done: 'wk-done',
    partial: 'wk-partial', blocked: 'wk-blocked', failed: 'wk-failed'
  };
  const STEP_CLASS = {
    pending: 'wk-pending', executed: 'wk-executed', held: 'wk-held',
    refused: 'wk-refused', failed: 'wk-failed', skipped: 'wk-skipped'
  };

  /* THE TIER CHIP, AND THE FLOOR BESIDE IT. The tier is §13's verdict on the action; the floor is the
     runtime's requirement for the mechanism. Both are rendered, and the floor is only spelled out when it is
     STRICTER than the tier — otherwise every row would carry a redundant "floor: safe" and the one row where
     it matters would stop standing out. */
  function tierChip(row) {
    const tier = String((row && row.tier) || '');
    const cls = TIER_CLASS[tier] || 'wk-restricted';
    const label = tier ? tier.toUpperCase() : 'UNKNOWN';
    let html = '<span class="wk-chip ' + cls + '" title="' + esc(tierLabelTitle(row)) + '">' + esc(label) + '</span>';
    if (row && row.floorAbove) {
      html += '<span class="wk-chip wk-floor" title="the runtime requires ' + esc(row.floor || '') +
        '-grade consent for this mechanism, because the tool declares scope &quot;' + esc(row.scope || '') +
        '&quot; — stricter than the action\'s own tier">FLOOR ' + esc(String(row.floor || '').toUpperCase()) + '</span>';
    }
    return html;
  }

  function tierLabelTitle(row) {
    if (!row) return '';
    return '§13 action: ' + (row.action || '') + ' — tier ' + (row.tier || '') +
      (row.floor ? '. The tool declares scope "' + (row.scope || '') + '", which the runtime floors at ' + row.floor + '.' : '');
  }

  function statusChip(status) {
    const s = String(status || '');
    return '<span class="wk-chip ' + (STATUS_CLASS[s] || 'wk-planned') + '">' + esc(s ? s.toUpperCase() : 'PLANNED') + '</span>';
  }
  function stepChip(status) {
    const s = String(status || '');
    return '<span class="wk-chip ' + (STEP_CLASS[s] || 'wk-pending') + '">' + esc(s ? s.toUpperCase() : 'PENDING') + '</span>';
  }

  /* ONE STEP ROW. The reason is shown verbatim — it is the policy's own sentence, and paraphrasing it would
     be the console inventing a justification. `wired:false` gets its own line because "the worker cannot
     reach this tool" is a different fix from "the policy refused it". */
  function stepRow(order, s) {
    const tool = String((s && s.tool) || '');
    const why = String((s && s.why) || '');
    const status = String((s && s.status) || 'pending');
    const reason = String((s && (s.error || s.reason)) || '');
    let html = '<li class="wk-step ' + (STEP_CLASS[status] || 'wk-pending') + '">';
    html += '<div class="wk-step-top"><b>' + esc((s && s.seq) || '') + '. ' + esc(tool) + '</b>';
    html += tierChip(s) + stepChip(status);
    if (s && s.wired === false) html += '<span class="wk-chip wk-unwired" title="this tool is not wired into the worker\'s registry — the worker has no route to it">NOT WIRED</span>';
    html += '</div>';
    html += '<div class="wk-why">' + esc(why) + '</div>';
    if (reason) html += '<div class="wk-reason">' + esc(reason) + '</div>';
    if (s && s.result) html += '<div class="wk-result">' + esc(String(s.result).slice(0, 400)) + '</div>';
    html += '</li>';
    return html;
  }

  function orderRow(order) {
    if (!order) return '';
    let html = '<div class="wk-order ' + (STATUS_CLASS[order.status] || '') + '">';
    html += '<div class="wk-order-top"><b>' + esc(order.intent || '') + '</b>' + statusChip(order.status) + '</div>';
    html += '<div class="wk-meta">' + esc(order.id || '') +
      ' · ' + esc(order.steps ? order.steps.length : 0) + ' step(s)' +
      (order.agentName ? ' · ' + esc(order.agentName) : '') +
      (order.dryRun ? ' · <span class="wk-chip wk-floor">DRY RUN</span>' : '') + '</div>';
    html += '<ul class="wk-steps">' + (order.steps || []).map(s => stepRow(order, s)).join('') + '</ul>';
    html += '</div>';
    return html;
  }

  /* THE WAITING ROWS. Only a step with a real `approvalId` is decidable here — see the header. A held step
     with no request is waiting on the RUNTIME, and the button for that is "run it attended", not "approve". */
  function waitingRows(approvals) {
    const pending = (approvals || []).filter(a => a && a.status === 'pending' && a.params && a.params.orderId);
    return pending.map(a => {
      let html = '<div class="wk-approval">';
      html += '<div class="wk-order-top"><b>' + esc(a.what || a.action || '') + '</b>' +
        '<span class="wk-chip wk-review">' + esc(String(a.tier || '').toUpperCase()) + '</span></div>';
      html += '<div class="wk-meta">' + esc(a.id || '') + ' · ' + esc(a.action || '') +
        ' · order ' + esc(a.params.orderId) + ' step ' + esc(a.params.seq) + '</div>';
      html += '<div class="wk-why">' + esc(a.why || '') + '</div>';
      html += '<div class="wk-btns">' +
        '<button class="bb xs wk-approve" type="button" data-wk-approve="' + esc(a.id) + '">✓ APPROVE</button>' +
        '<button class="bb xs wk-reject" type="button" data-wk-reject="' + esc(a.id) + '">✕ REJECT</button>' +
        '</div>';
      html += '</div>';
      return html;
    }).join('');
  }

  function catalogRows(catalog, filter) {
    const rows = ((catalog && catalog.rows) || []).slice();
    if (filter) {
      const f = String(filter);
      rows.sort((a, b) => (b.wired === a.wired ? 0 : (b.wired ? 1 : -1)) || (a.tool < b.tool ? -1 : 1));
      return rows.filter(r => (r.tool || '').indexOf(f) >= 0 || (r.action || '').indexOf(f) >= 0);
    }
    // wired first: what the worker can actually do is the answer a user is looking for
    rows.sort((a, b) => (b.wired === a.wired ? 0 : (b.wired ? 1 : -1)) || (a.tool < b.tool ? -1 : 1));
    return rows;
  }

  function catalogRow(r) {
    let html = '<tr class="' + (r.wired ? '' : 'wk-unwired-row') + '">';
    html += '<td><b>' + esc(r.tool) + '</b></td>';
    html += '<td>' + esc(r.action || '') + '</td>';
    html += '<td>' + tierChip(r) + '</td>';
    html += '<td>' + (r.wired ? '<span class="wk-chip wk-executed">WIRED</span>'
      : '<span class="wk-chip wk-unwired" title="not in the worker\'s registry, so a step asking for it is refused">—</span>') + '</td>';
    html += '</tr>';
    return html;
  }

  /* THE CLIENT-SIDE MIRROR of the server's step validation. It exists so a user is told what is wrong before
     a request is sent, and it is deliberately the SAME rules (a tool, a reason, a bounded step count) — never
     a second, looser rule that would let a request through the client and fail at the server. */
  const MAX_STEPS = 12;
  function validateSteps(steps) {
    const list = Array.isArray(steps) ? steps : [];
    if (!list.length) return { ok: false, reason: 'add at least one step' };
    if (list.length > MAX_STEPS) return { ok: false, reason: 'at most ' + MAX_STEPS + ' steps' };
    for (let i = 0; i < list.length; i++) {
      const s = list[i] || {};
      if (!String(s.tool || '').trim()) return { ok: false, reason: 'step ' + (i + 1) + ' has no tool' };
      if (!String(s.why || '').trim()) return { ok: false, reason: 'step ' + (i + 1) + ' has no reason — a step nobody can explain must not be queued' };
    }
    return { ok: true, steps: list };
  }

  /* Parse the args textarea. A JSON object or empty; anything else is refused with the parse error, so a
     malformed arg set is never silently sent as {}. */
  function parseArgs(text) {
    const raw = String(text == null ? '' : text).trim();
    if (!raw) return { ok: true, args: {} };
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) { return { ok: false, reason: 'the arguments must be JSON — ' + (e && e.message ? e.message : 'bad json') }; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, reason: 'the arguments must be a JSON object' };
    return { ok: true, args: parsed };
  }

  function summarise(summary) {
    const s = summary || {};
    const parts = [];
    parts.push(String(s.total || 0) + ' order(s)');
    if (s.executed) parts.push(String(s.executed) + ' executed');
    if (s.held) parts.push(String(s.held) + ' held');
    if (s.refused) parts.push(String(s.refused) + ' refused');
    if (s.failed) parts.push(String(s.failed) + ' failed');
    return parts.join(' · ');
  }

  /* The ONE sentence at the top. It states what the worker can reach and how many steps are waiting, and it
     never claims autonomy the policy does not give: a catalogue with no wired tool means the worker can do
     nothing, and the console says so rather than rendering an empty console that reads as "nothing queued". */
  function headLine(catalog, waiting) {
    const rows = (catalog && catalog.rows) || [];
    const wired = rows.filter(r => r.wired).length;
    const n = Number(waiting) || 0;
    if (!wired) return 'The worker has no wired tools — nothing you plan here could run.';
    if (n > 0) return wired + ' tool(s) reachable · ' + n + ' step(s) waiting on you';
    return wired + ' tool(s) reachable · nothing waiting on you';
  }

  const pure = {
    esc, relTime, tierChip, statusChip, stepChip, tierLabelTitle,
    stepRow, orderRow, waitingRows, catalogRows, catalogRow,
    validateSteps, parseArgs, summarise, headLine, MAX_STEPS
  };

  // ================================ DOM HALF ================================
  if (typeof document === 'undefined' || typeof StationUI === 'undefined') {
    return Object.assign({ mount: function () {} }, pure);
  }

  const H = StationUI.h;
  const request = function (method, path, body) {
    const init = { method: method, cache: 'no-store' };
    if (body !== undefined) { init.headers = { 'Content-Type': 'application/json' }; init.body = JSON.stringify(body == null ? {} : body); }
    return fetch(path, init).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; })
        .catch(function () { return { ok: r.ok, status: r.status, j: {} }; });
    });
  };
  const errText = function (r, fallback) {
    const j = r && r.j;
    if (j && typeof j.error === 'string' && j.error) return j.error;
    if (r && r.status) return fallback + ' (HTTP ' + r.status + ')';
    return fallback;
  };

  const state = {
    businessId: '', catalog: null, workorders: [], approvals: [], summary: null,
    busy: false, filter: '', draft: [{ tool: 'fs.read', why: '', args: '' }]
  };
  let body = null;
  const el = id => (body ? body.querySelector(id) : null);

  function msg(target, text, ok) {
    const m = el(target);
    if (!m) return;
    m.className = 'wk-msg ' + (ok ? 'wk-ok-t' : 'wk-bad-t');
    m.textContent = text || '';
  }

  // ArmConfirm, fail-closed: no helper means the control is DISABLED, never a one-press destructive action.
  function arm(btn, label, onConfirm) {
    if (!btn) return;
    if (typeof ArmConfirm === 'undefined' || typeof ArmConfirm.wire !== 'function') {
      btn.disabled = true;
      btn.title = 'confirmation helper unavailable — refusing to act unconfirmed';
      return;
    }
    ArmConfirm.wire(btn, { armedLabel: label, onConfirm: onConfirm });
  }

  const bizPath = (suffix) => '/api/businesses/' + encodeURIComponent(state.businessId) + suffix;

  function businessOptions() {
    const list = (H.presentBusinesses && H.presentBusinesses()) || [];
    if (!list.length) return '<option value="">no businesses yet — make one first</option>';
    return list.map(b => '<option value="' + esc(b.id) + '"' + (b.id === state.businessId ? ' selected' : '') + '>' + esc(b.name || b.id) + '</option>').join('');
  }

  // ---- sections ------------------------------------------------------------------------------------
  function secHead() {
    const waiting = (state.approvals || []).filter(a => a.status === 'pending' && a.params && a.params.orderId).length;
    return '<div class="wk-head">' +
      '<div class="wk-headline">' + esc(headLine(state.catalog, waiting)) + '</div>' +
      '<div class="wk-head-btns">' +
      '<select id="wk-biz" class="bb xs" title="which business this work is for">' + businessOptions() + '</select>' +
      '<button id="wk-reload" class="bb xs" type="button" title="re-read from the sidecar">↻ REFRESH</button>' +
      '</div></div>';
  }

  function secPlan() {
    const opts = catalogRows(state.catalog).map(r =>
      '<option value="' + esc(r.tool) + '"' + (r.wired ? '' : ' class="wk-opt-unwired"') + '>' +
      esc(r.tool) + (r.wired ? '' : ' (not wired)') + '</option>').join('');
    let rows = '';
    for (let i = 0; i < state.draft.length; i++) {
      const d = state.draft[i];
      rows += '<div class="wk-draft" data-wk-i="' + i + '">' +
        '<select class="bb xs wk-d-tool">' + opts.replace('value="' + esc(d.tool) + '"', 'value="' + esc(d.tool) + '" selected') + '</select>' +
        '<input class="bb xs wk-d-why" type="text" placeholder="why this step — a step nobody can explain must not be queued" value="' + esc(d.why) + '">' +
        '<input class="bb xs wk-d-args" type="text" placeholder=\'arguments, JSON — e.g. {"path":"notes.md"}\' value="' + esc(d.args) + '">' +
        '<button class="bb xs wk-d-drop" type="button" title="remove this step">✕</button>' +
        '</div>';
    }
    return '<div class="wk-sec"><h3>PLAN ONE</h3>' +
      '<input id="wk-intent" class="bb" type="text" placeholder="what are you asking the worker to do, in words">' +
      '<div class="wk-drafts">' + rows + '</div>' +
      '<div class="wk-btns">' +
      '<button id="wk-add" class="bb xs" type="button">+ STEP</button>' +
      '<button id="wk-test" class="bb xs" type="button" title="show what each step would be allowed to do, without doing it">TEST</button>' +
      '<button id="wk-create" class="bb xs" type="button" title="write the work order. It does NOT run — running is a separate act.">CREATE</button>' +
      '</div><div id="wk-plan-msg" class="wk-msg"></div></div>';
  }

  function secWaiting() {
    const rows = waitingRows(state.approvals);
    return '<div class="wk-sec"><h3>WAITING ON YOU</h3>' +
      (rows ? rows : '<p class="wk-empty">Nothing is waiting. A step only appears here when §13 needs your decision — a step held by the runtime consent gate has no request, and is started by running the order attended instead.</p>') +
      '</div>';
  }

  function secOrders() {
    const list = state.workorders || [];
    const rows = list.length
      ? list.map(o => {
        const open = ['planned', 'running', 'blocked'].indexOf(o.status) >= 0;
        return '<div class="wk-order-wrap">' + orderRow(o) +
          '<div class="wk-btns">' +
          (open ? '<button class="bb xs wk-run" type="button" data-wk-run="' + esc(o.id) + '">▶ RUN</button>'
            + '<button class="bb xs wk-run-att" type="button" data-wk-runatt="' + esc(o.id) + '" title="ask the runtime consent gate, so a standing grant you already made can take effect">▶ RUN ATTENDED</button>' : '') +
          '<button class="bb xs wk-del" type="button" data-wk-del="' + esc(o.id) + '">🗑 DELETE</button>' +
          '</div></div>';
      }).join('')
      : '<p class="wk-empty">No work orders yet for this business.</p>';
    return '<div class="wk-sec"><h3>WORK ORDERS</h3>' +
      (state.summary ? '<div class="wk-summary">' + esc(summarise(state.summary)) + '</div>' : '') +
      rows + '</div>';
  }

  function secCatalog() {
    const rows = catalogRows(state.catalog, state.filter);
    return '<div class="wk-sec"><h3>WHAT THE WORKER MAY DO</h3>' +
      '<p class="wk-note">Every tool the policy knows, with the §13 tier of the ACTION and the runtime FLOOR of the MECHANISM. Both must be satisfied before a step runs, and they can disagree — a safe action whose tool writes still stops for a person.</p>' +
      '<input id="wk-filter" class="bb xs" type="text" placeholder="filter by tool or action" value="' + esc(state.filter) + '">' +
      '<table class="wk-cat"><thead><tr><th>TOOL</th><th>§13 ACTION</th><th>TIER / FLOOR</th><th>REACH</th></tr></thead><tbody>' +
      rows.map(catalogRow).join('') + '</tbody></table>' +
      '<div id="wk-cat-msg" class="wk-msg"></div></div>';
  }

  function render() {
    if (!body) return;
    body.innerHTML = secHead() + secWaiting() + secPlan() + secOrders() + secCatalog();
    wire();
  }

  function readDraft() {
    if (!body) return;
    const rows = body.querySelectorAll('.wk-draft');
    state.draft = [];
    for (const r of rows) {
      const t = r.querySelector('.wk-d-tool'), w = r.querySelector('.wk-d-why'), a = r.querySelector('.wk-d-args');
      state.draft.push({ tool: t ? t.value : '', why: w ? w.value : '', args: a ? a.value : '' });
    }
    if (!state.draft.length) state.draft = [{ tool: 'fs.read', why: '', args: '' }];
  }

  function draftSteps() {
    const out = [];
    for (const d of state.draft) {
      const p = parseArgs(d.args);
      if (!p.ok) return { ok: false, reason: p.reason };
      out.push({ tool: String(d.tool || '').trim(), why: String(d.why || '').trim(), args: p.args });
    }
    return validateSteps(out);
  }

  async function reload() {
    if (!state.businessId) { state.workorders = []; state.approvals = []; state.summary = null; render(); return; }
    try {
      const [cat, list, appr] = await Promise.all([
        request('GET', '/api/worker/catalog'),
        request('GET', bizPath('/workorders')),
        request('GET', bizPath('/approvals'))
      ]);
      if (cat.ok) state.catalog = cat.j;
      if (list.ok) { state.workorders = list.j.workorders || []; state.summary = list.j.summary || null; }
      if (appr.ok) state.approvals = appr.j.approvals || [];
    } catch (e) { /* a failed refresh must not blank the console; the next one retries */ }
    render();
  }

  function wire() {
    if (!body) return;
    const biz = el('#wk-biz');
    if (biz) biz.addEventListener('change', () => { state.businessId = biz.value; reload(); });
    const reloadBtn = el('#wk-reload');
    if (reloadBtn) reloadBtn.addEventListener('click', () => reload());
    const filter = el('#wk-filter');
    if (filter) filter.addEventListener('input', () => { state.filter = filter.value; render(); const f = el('#wk-filter'); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } });

    const add = el('#wk-add');
    if (add) add.addEventListener('click', () => { readDraft(); state.draft.push({ tool: 'fs.read', why: '', args: '' }); render(); });
    const drop = body.querySelectorAll('.wk-d-drop');
    for (const b of drop) b.addEventListener('click', () => { readDraft(); const i = Number(b.closest('.wk-draft').getAttribute('data-wk-i')); state.draft.splice(i, 1); render(); });

    const test = el('#wk-test');
    if (test) test.addEventListener('click', async () => {
      if (!state.businessId) return msg('#wk-plan-msg', 'pick a business first', false);
      readDraft();
      const steps = draftSteps();
      if (!steps.ok) return msg('#wk-plan-msg', steps.reason, false);
      const r = await request('POST', '/api/worker/test', { businessId: state.businessId, steps: steps.steps });
      if (!r.ok) return msg('#wk-plan-msg', errText(r, 'the sidecar refused the test'), false);
      const lines = (r.j.steps || []).map(s => (s.seq) + '. ' + s.tool + ' — ' + s.tier +
        (s.floor && s.floorAbove ? ' (floor ' + s.floor + ')' : '') + ': ' + s.outcome);
      msg('#wk-plan-msg', lines.join(' | ') || 'no verdicts came back', true);
    });

    const create = el('#wk-create');
    if (create) create.addEventListener('click', async () => {
      if (!state.businessId) return msg('#wk-plan-msg', 'pick a business first', false);
      readDraft();
      const intent = String((el('#wk-intent') || {}).value || '').trim();
      if (!intent) return msg('#wk-plan-msg', 'say what the worker is being asked to do', false);
      const steps = draftSteps();
      if (!steps.ok) return msg('#wk-plan-msg', steps.reason, false);
      const r = await request('POST', bizPath('/workorders'), { intent: intent, steps: steps.steps, createdBy: 'user' });
      if (!r.ok) return msg('#wk-plan-msg', errText(r, 'the work order was not created'), false);
      msg('#wk-plan-msg', 'planned ' + (r.j.workorder && r.j.workorder.id) + ' — it has NOT run. Press RUN when you want it to.', true);
      await reload();
    });

    for (const b of body.querySelectorAll('[data-wk-run]')) {
      b.addEventListener('click', async () => {
        const id = b.getAttribute('data-wk-run');
        const r = await request('POST', '/api/workorders/' + encodeURIComponent(id) + '/run', {});
        if (!r.ok) return msg('#wk-plan-msg', errText(r, 'the run was refused'), false);
        await reload();
      });
    }
    for (const b of body.querySelectorAll('[data-wk-runatt]')) {
      b.addEventListener('click', async () => {
        const id = b.getAttribute('data-wk-runatt');
        const r = await request('POST', '/api/workorders/' + encodeURIComponent(id) + '/run', { attended: true });
        if (!r.ok) return msg('#wk-plan-msg', errText(r, 'the run was refused'), false);
        await reload();
      });
    }
    for (const b of body.querySelectorAll('[data-wk-del]')) {
      arm(b, '■ SURE?', async () => {
        const id = b.getAttribute('data-wk-del');
        const r = await request('DELETE', '/api/workorders/' + encodeURIComponent(id));
        if (!r.ok) return msg('#wk-plan-msg', errText(r, 'the delete was refused'), false);
        await reload();
      });
    }
    for (const b of body.querySelectorAll('[data-wk-approve]')) {
      b.addEventListener('click', async () => {
        const id = b.getAttribute('data-wk-approve');
        const r = await request('POST', '/api/worker/approvals/' + encodeURIComponent(id) + '/approve', { by: 'user' });
        if (!r.ok) return msg('#wk-plan-msg', errText(r, 'the approval was refused'), false);
        await reload();
      });
    }
    for (const b of body.querySelectorAll('[data-wk-reject]')) {
      b.addEventListener('click', async () => {
        const id = b.getAttribute('data-wk-reject');
        const r = await request('POST', '/api/worker/approvals/' + encodeURIComponent(id) + '/reject', { by: 'user', reason: 'rejected from the worker console' });
        if (!r.ok) return msg('#wk-plan-msg', errText(r, 'the rejection was refused'), false);
        await reload();
      });
    }
  }

  function mount(node) {
    body = node;
    const list = (H.presentBusinesses && H.presentBusinesses()) || [];
    if (!state.businessId && list.length) state.businessId = list[0].id;
    render();
    reload();
  }

  return Object.assign({ mount: mount, render: render, reload: reload, state: state }, pure);
});
