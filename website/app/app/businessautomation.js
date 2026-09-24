/* frontend/app/businessautomation.js — the AUTOMATION HUB console (Business OS Phase 5).

   §12's "when X happens → do Y", §13's Approve/Reject queue and §19's hub controls, in one lane.

   WHY A LANE AND NOT A WINDOW. The station already has ONE AUTOMATION dock item, and windows/automation.js
   was built with a lane registry (`window.AutomationWindow.registerLane`) precisely so a third kind of
   standing work could join ROUTINES and LOOPS without a second dock item competing for the same word. So
   this file registers a LANE: three sections (ACTIVE AUTOMATIONS · BUILD ONE · WAITING ON YOU) mounted into
   the shared console. Its ids are namespaced `ba-*`, which is disjoint from the lanes' `rt-*` and `lp-*`,
   so the three wirings coexist on one body exactly as that registry intended.

   THE TWO HALVES, and why they are in one file. The PURE half (labels, row shaping, the client-side
   validation mirror, the hub sentence) is Node-loadable and unit-tested headless. The DOM half mounts the
   lane. The pure half is where the honesty lives — e.g. `runRows` reports a rule's SKIP counts separately
   from its failures, and `hubLine` never claims the hub is running when the §19 stand-down is on.

   NO `window.alert/confirm/prompt` (station-tooltip.test.js bans them). Destructive controls go through
   ArmConfirm's two-press helper, fail-closed. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).businessAutomation = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ================================ PURE HALF ================================

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* Relative time. `at` is epoch-ms; `now` is injected so the pure half stays deterministic in tests.
     A missing instant reads 'never' rather than 'now' — an absent timestamp is not a recent one. */
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

  // 'business.contact.added' -> 'a contact joins the CRM'. Falls back to the raw name so nothing is invented.
  function triggerLabel(catalog, event) {
    const list = (catalog && catalog.triggers) || [];
    for (const t of list) if (t.event === event) return t.label;
    return String(event || '');
  }
  function triggerNote(catalog, event) {
    const list = (catalog && catalog.triggers) || [];
    for (const t of list) if (t.event === event) return t.note || '';
    return '';
  }
  function actionDef(catalog, id) {
    const list = (catalog && catalog.actions) || [];
    for (const a of list) if (a.id === id) return a;
    return null;
  }
  function actionLabel(catalog, id) {
    const a = actionDef(catalog, id);
    return a ? a.label : String(id || '');
  }
  function opDef(catalog, op) {
    const list = (catalog && catalog.ops) || [];
    for (const o of list) if (o.op === op) return o;
    return null;
  }

  /* The tier chip. The tier is DERIVED server-side and travels on the row; this only renders it. A rule
     whose autonomy is 'approval' says so in words, because "review" is §13 jargon a business owner has not
     read. */
  function autonomyText(autonomy) {
    if (autonomy === 'autonomous') return 'runs on its own';
    if (autonomy === 'approval') return 'asks you first';
    return 'cannot run';
  }
  function autonomyChip(autonomy) {
    const cls = autonomy === 'autonomous' ? 'ba-ok' : (autonomy === 'approval' ? 'ba-warn' : 'ba-bad');
    return '<span class="ba-chip ' + cls + '">' + esc(autonomyText(autonomy)) + '</span>';
  }

  // one condition -> "stage is lead" / "amount is at least 100" / "note is present"
  function conditionText(catalog, c) {
    const def = opDef(catalog, c && c.op);
    const label = def ? def.label : String((c && c.op) || '?');
    const field = String((c && c.field) || '?');
    if (!def || !def.needsValue) return field + ' ' + label;
    let v = (c && c.value);
    if (Array.isArray(v)) v = v.join(', ');
    return field + ' ' + label + ' ' + (typeof v === 'string' ? '"' + v + '"' : String(v));
  }
  // one action -> "Create a task — Follow up with {{name}}"
  function actionText(catalog, spec) {
    const a = actionDef(catalog, spec && spec.action);
    const label = a ? a.label : String((spec && spec.action) || '?');
    const params = (spec && spec.params) || {};
    const keys = Object.keys(params);
    if (!keys.length) return label;
    const shown = keys.slice(0, 2).map(k => k + '=' + String(params[k])).join(', ');
    return label + ' — ' + shown + (keys.length > 2 ? ' +' + (keys.length - 2) + ' more' : '');
  }

  /* The fields a payload example declares — what the condition builder offers, so a user picks a field
     that EXISTS on this trigger instead of typing a name that can never match. */
  function payloadFields(catalog, event) {
    const list = (catalog && catalog.triggers) || [];
    for (const t of list) {
      if (t.event !== event) continue;
      const ex = t.example || {};
      return Object.keys(ex).map(k => ({ field: k, sample: ex[k] }));
    }
    return [];
  }

  /* THE CLIENT-SIDE MIRROR of the store's validation. It exists to catch a mistake BEFORE a round trip, and
     it is deliberately NOT more permissive than the server: it mirrors the same closed vocabularies and the
     same required-param rule, and the server is still the authority. A draft that passes here can still be
     refused (and the refusal is shown verbatim). */
  function ruleGuard(catalog, draft) {
    draft = draft || {};
    if (!String(draft.name || '').trim()) return { ok: false, reason: 'give this automation a name you will recognise later' };
    if (!draft.trigger) return { ok: false, reason: 'pick a trigger — the "when this happens" half' };
    const triggers = (catalog && catalog.triggers) || [];
    if (triggers.length && !triggers.some(t => t.event === draft.trigger)) {
      return { ok: false, reason: 'that trigger is not one this hub can listen to' };
    }
    const conds = Array.isArray(draft.conditions) ? draft.conditions : [];
    if (conds.length > ((catalog && catalog.limits && catalog.limits.maxConditions) || 8)) {
      return { ok: false, reason: 'too many conditions' };
    }
    for (let i = 0; i < conds.length; i++) {
      const c = conds[i] || {};
      if (!String(c.field || '').trim()) return { ok: false, reason: 'condition ' + (i + 1) + ' needs a field' };
      const def = opDef(catalog, c.op);
      if (!def) return { ok: false, reason: 'condition ' + (i + 1) + ' needs a test' };
      if (def.needsValue && (c.value === undefined || c.value === '')) return { ok: false, reason: 'condition ' + (i + 1) + ' needs a value' };
    }
    const acts = Array.isArray(draft.actions) ? draft.actions : [];
    if (!acts.length) return { ok: false, reason: 'add at least one action — the "do this" half' };
    if (acts.length > ((catalog && catalog.limits && catalog.limits.maxActions) || 5)) {
      return { ok: false, reason: 'too many actions' };
    }
    for (let i = 0; i < acts.length; i++) {
      const a = acts[i] || {};
      const def = actionDef(catalog, a.action);
      if (!def) return { ok: false, reason: 'action ' + (i + 1) + ' is not one this hub can perform' };
      const params = a.params || {};
      for (const f of (def.required || [])) {
        if (!String(params[f] == null ? '' : params[f]).trim()) {
          return { ok: false, reason: '"' + def.label + '" needs a "' + f + '"' };
        }
      }
    }
    return { ok: true };
  }

  // which tiers a draft's actions would land in — the same derivation the server does, for the live preview.
  function draftAutonomy(catalog, draft) {
    const acts = (draft && Array.isArray(draft.actions)) ? draft.actions : [];
    let anyReview = false;
    for (const a of acts) {
      const def = actionDef(catalog, a && a.action);
      if (!def) continue;
      if (def.tier === 'review') anyReview = true;
      if (def.tier === 'restricted') return 'blocked';
    }
    if (!acts.length) return 'blocked';
    return anyReview ? 'approval' : 'autonomous';
  }

  // ---- row shaping ------------------------------------------------------------------------------
  /* One row per rule. Every field the row shows comes off the server's own row; nothing is derived that the
     server did not already decide (tiers, autonomy, failure streak). */
  function ruleRows(rules) {
    return (Array.isArray(rules) ? rules : []).map(r => ({
      id: r.id,
      name: r.name,
      trigger: r.trigger,
      enabled: !!r.enabled,
      autonomy: r.autonomy,
      autonomyText: autonomyText(r.autonomy),
      tiers: (r.tiers || []).slice(),
      conditionCount: (r.conditions || []).length,
      actionCount: (r.actions || []).length,
      fireCount: r.fireCount || 0,
      consecutiveFailures: r.consecutiveFailures || 0,
      cooldownMs: r.cooldownMs || 0,
      disabledReason: r.disabledReason || '',
      // the honest status line: a switched-off rule says WHY it is off, because "auto-disabled after 5
      // failed runs" and "you switched it off" are very different things to see next to a dead automation.
      status: r.enabled
        ? (r.consecutiveFailures ? (r.consecutiveFailures + ' failure(s) in a row') : 'listening')
        : (r.disabledReason || 'switched off')
    }));
  }

  function approvalRows(approvals) {
    return (Array.isArray(approvals) ? approvals : []).map(a => ({
      id: a.id,
      status: a.status,
      pending: a.status === 'pending',
      tier: a.tier,
      risk: a.risk,
      what: a.what,
      why: a.why,
      effect: a.effect || '',
      evidence: (a.evidence || []).map(e => ({ text: e.text, evidence: e.evidence, source: e.source })),
      // P1 in the UI: an evidence item with no class is shown as UNLABELLED, never quietly dropped.
      evidenceCount: (a.evidence || []).length,
      unlabelled: (a.evidence || []).filter(e => !e.evidence || e.evidence === 'unknown').length,
      decidedBy: a.decidedBy || '',
      reason: a.reason || '',
      createdAt: a.createdAt,
      decidedAt: a.decidedAt
    }));
  }

  /* One row per RUN. `skipped` counts the actions that never executed, so a run that half-worked is not
     rendered as a success. */
  function runRows(runs) {
    return (Array.isArray(runs) ? runs : []).map(r => {
      const acts = Array.isArray(r.actions) ? r.actions : [];
      const executed = acts.filter(a => a.status === 'executed').length;
      const pending = acts.filter(a => a.status === 'pending-approval').length;
      const failed = acts.filter(a => a.status === 'failed' || a.status === 'skipped').length;
      return {
        id: r.id, at: r.at, event: r.event, depth: r.depth || 0, ok: !!r.ok, reason: r.reason || '',
        executed: executed, pending: pending, failed: failed, total: acts.length,
        actions: acts.slice(),
        summary: executed + ' ran' + (pending ? ', ' + pending + ' waiting on you' : '') + (failed ? ', ' + failed + ' failed' : '')
      };
    });
  }

  /* The hub sentence. It never says "running" when §19's stand-down is on, and it reports the SKIP reasons
     separately — a hub that did nothing because every rule was cooling down is a different situation from
     one that did nothing because it is stopped, and the line says which. */
  function hubLine(stats) {
    const s = stats || {};
    if (s.halted) {
      return { state: 'stopped', text: 'STOPPED — the automation hub is stood down (E-STOP). Nothing here will run until you resume it.', cls: 'ba-bad' };
    }
    const ran = s.ran || 0;
    const parts = [];
    parts.push(ran ? (ran + ' run' + (ran === 1 ? '' : 's') + ' so far') : 'no runs yet');
    if (s.approvalsRequested) parts.push(s.approvalsRequested + ' approval request' + (s.approvalsRequested === 1 ? '' : 's'));
    if (s.autoDisabled) parts.push(s.autoDisabled + ' switched itself off');
    const skipped = [];
    if (s.skippedCooldown) skipped.push(s.skippedCooldown + ' cooling down');
    if (s.skippedPaused) skipped.push(s.skippedPaused + ' in a paused business');
    if (s.stormStopped) skipped.push(s.stormStopped + ' pass(es) hit the safety cap');
    if (s.skippedDepth) skipped.push(s.skippedDepth + ' past the cascade depth limit');
    return {
      state: 'live',
      text: 'LISTENING — ' + parts.join(', ') + '.' + (skipped.length ? ' Skipped: ' + skipped.join(', ') + '.' : ''),
      cls: s.autoDisabled ? 'ba-warn' : 'ba-ok'
    };
  }

  function summarise(rules) {
    const rows = ruleRows(rules);
    const out = { total: rows.length, enabled: 0, autonomous: 0, approval: 0 };
    for (const r of rows) {
      if (r.enabled) out.enabled++;
      if (r.autonomy === 'autonomous') out.autonomous++;
      if (r.autonomy === 'approval') out.approval++;
    }
    return out;
  }

  function cooldownText(ms) {
    const n = Number(ms) || 0;
    if (!n) return 'no wait between runs';
    if (n < 1000) return 'at most once every ' + n + 'ms';
    if (n < 60000) return 'at most once every ' + Math.round(n / 1000) + 's';
    if (n < 3600000) return 'at most once every ' + Math.round(n / 60000) + ' min';
    return 'at most once every ' + Math.round(n / 3600000) + 'h';
  }

  // ================================ DOM HALF ================================

  // the lane is only registered in a browser with the AUTOMATION window present. Under Node (a unit test)
  // there is no StationUI, so the pure half is all that loads.
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return {
      esc, relTime, triggerLabel, triggerNote, actionDef, actionLabel, opDef,
      autonomyText, autonomyChip, conditionText, actionText, payloadFields,
      ruleGuard, draftAutonomy, ruleRows, approvalRows, runRows, hubLine, summarise, cooldownText
    };
  }

  if (typeof StationUI === 'undefined' || typeof AutomationWindow === 'undefined') {
    return {
      esc, relTime, triggerLabel, triggerNote, actionDef, actionLabel, opDef,
      autonomyText, autonomyChip, conditionText, actionText, payloadFields,
      ruleGuard, draftAutonomy, ruleRows, approvalRows, runRows, hubLine, summarise, cooldownText
    };
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

  const state = { businessId: '', catalog: null, automations: [], approvals: [], runs: [], hub: null, busy: false };
  let body = null;
  const el = id => (body ? body.querySelector(id) : null);

  function msg(target, text, ok) {
    const m = el(target);
    if (!m) return;
    m.className = 'ba-msg ' + (ok ? 'ba-ok-t' : 'ba-bad-t');
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

  // ---- ACTIVE AUTOMATIONS ------------------------------------------------------------------------
  function secActive() {
    return ''
      + '<div class="ba-bar">'
      + '<label class="ba-lab" for="ba-biz">BUSINESS</label>'
      + '<select id="ba-biz" class="ba-in">' + businessOptions() + '</select>'
      + '<button id="ba-hub" class="bb xs" type="button" title="stop or resume every automation on this station">…</button>'
      + '<button id="ba-reload" class="bb xs" type="button" title="re-read from the sidecar">↻ REFRESH</button>'
      + '</div>'
      + '<div id="ba-hubline" class="ba-hubline">reading the hub…</div>'
      + '<div id="ba-msg" class="ba-msg"></div>'
      + '<div id="ba-list" class="ba-list"><div class="ba-empty">nothing loaded yet.</div></div>';
  }

  // ---- BUILD AN AUTOMATION -----------------------------------------------------------------------
  function secBuild() {
    return ''
      + '<div class="ba-note" data-hint="automation">An automation is a standing rule: <b>when</b> something happens in this business, <b>do</b> this. It only ever touches its own business, and anything that reaches outside the station waits for your yes.</div>'
      + '<div class="ba-form">'
      + '<label class="ba-lab" for="ba-name">NAME</label>'
      + '<input id="ba-name" class="ba-in" type="text" maxlength="160" placeholder="e.g. Follow up every new lead">'
      + '<label class="ba-lab" for="ba-trigger">WHEN</label>'
      + '<select id="ba-trigger" class="ba-in"><option value="">— pick a trigger —</option></select>'
      + '<div id="ba-trigger-note" class="ba-sub"></div>'
      + '<label class="ba-lab" for="ba-wait">HOW OFTEN AT MOST</label>'
      + '<select id="ba-wait" class="ba-in"></select>'
      + '<div class="ba-lab">ONLY IF (optional)</div>'
      + '<div id="ba-conds" class="ba-conds"></div>'
      + '<button id="ba-cond-add" class="bb xs" type="button">+ ADD A CONDITION</button>'
      + '<div class="ba-lab">THEN</div>'
      + '<div id="ba-acts" class="ba-acts"></div>'
      + '<button id="ba-act-add" class="bb xs" type="button">+ ADD AN ACTION</button>'
      + '<div id="ba-preview" class="ba-preview"></div>'
      + '<div class="ba-row">'
      + '<button id="ba-create" class="bb" type="button">CREATE — SWITCHED OFF</button>'
      + '<button id="ba-create-on" class="bb" type="button">CREATE &amp; SWITCH ON</button>'
      + '</div>'
      + '<div id="ba-cmsg" class="ba-msg"></div>'
      + '</div>';
  }

  // ---- WAITING ON YOU (§13) ----------------------------------------------------------------------
  function secApprovals() {
    return ''
      + '<div class="ba-note" data-hint="approval">Anything an automation wants to do that reaches outside the station — spending money, messaging people, publishing — stops here instead. Each request shows you what it is, why it fired and what is behind it. Approving runs it; rejecting drops it. A decision is final.</div>'
      + '<div id="ba-apmsg" class="ba-msg"></div>'
      + '<div id="ba-approvals" class="ba-list"><div class="ba-empty">nothing loaded yet.</div></div>'
      + '<div class="ba-lab">ALREADY DECIDED</div>'
      + '<div id="ba-decided" class="ba-list"></div>';
  }

  // ---- rendering ---------------------------------------------------------------------------------
  function renderHub() {
    const line = hubLine(state.hub);
    const box = el('#ba-hubline');
    if (box) { box.className = 'ba-hubline ' + line.cls; box.textContent = line.text; }
    const btn = el('#ba-hub');
    if (btn) {
      const halted = !!(state.hub && state.hub.halted);
      btn.textContent = halted ? '▶ RESUME AUTOMATIONS' : '■ STOP ALL AUTOMATIONS';
      btn.title = halted ? 'lift the §19 stand-down so automations run again' : 'stand every automation down until you resume — this is separate from the station E-STOP';
    }
  }

  function renderList() {
    const box = el('#ba-list');
    if (!box) return;
    if (!state.businessId) { box.innerHTML = '<div class="ba-empty">Pick a business above.</div>'; return; }
    const rows = ruleRows(state.automations);
    if (!rows.length) { box.innerHTML = '<div class="ba-empty">No automations for this business yet. Build one in the next section.</div>'; return; }
    const sum = summarise(state.automations);
    box.innerHTML = '<div class="ba-sub">' + sum.total + ' automation(s) · ' + sum.enabled + ' switched on · '
      + sum.autonomous + ' run on their own · ' + sum.approval + ' ask you first</div>'
      + rows.map(r => ''
        + '<div class="ba-card" data-id="' + esc(r.id) + '">'
        + '<div class="ba-card-h">'
        + '<b>' + esc(r.name) + '</b>'
        + autonomyChip(r.autonomy)
        + '<span class="ba-chip ' + (r.enabled ? 'ba-ok' : 'ba-dim') + '">' + (r.enabled ? 'ON' : 'OFF') + '</span>'
        + '</div>'
        + '<div class="ba-card-b">'
        + '<div class="ba-when">WHEN ' + esc(triggerLabel(state.catalog, r.trigger)) + '</div>'
        + (r.conditionCount ? '<div class="ba-when">ONLY IF ' + r.conditionCount + ' condition(s)</div>' : '')
        + '<div class="ba-when">THEN ' + r.actionCount + ' action(s) · ' + esc(cooldownText(r.cooldownMs)) + '</div>'
        + '<div class="ba-stat">' + esc(r.status) + ' · fired ' + r.fireCount + ' time(s)</div>'
        + '<div class="ba-acts-row">'
        + '<button class="bb xs ba-toggle" type="button">' + (r.enabled ? '■ SWITCH OFF' : '▶ SWITCH ON') + '</button>'
        + '<button class="bb xs ba-test" type="button" title="show what would happen, without doing it">TEST</button>'
        + '<button class="bb xs ba-runs" type="button">RUN HISTORY</button>'
        + '<button class="bb xs ba-del" type="button">DELETE</button>'
        + '</div>'
        + '<div class="ba-testout" hidden></div>'
        + '<div class="ba-runsout" hidden></div>'
        + '</div></div>').join('');
  }

  function renderApprovals() {
    const box = el('#ba-approvals');
    const decidedBox = el('#ba-decided');
    if (!box) return;
    const rows = approvalRows(state.approvals);
    const pending = rows.filter(r => r.pending);
    const decided = rows.filter(r => !r.pending);

    box.innerHTML = pending.length ? pending.map(r => ''
      + '<div class="ba-card ba-ap" data-id="' + esc(r.id) + '">'
      + '<div class="ba-card-h"><b>' + esc(r.what) + '</b>'
      + '<span class="ba-chip ba-warn">' + esc(r.tier) + '</span>'
      + '<span class="ba-chip ba-dim">risk ' + esc(r.risk) + '</span></div>'
      + '<div class="ba-card-b">'
      + '<div class="ba-why"><span class="ba-lab">WHY</span> ' + esc(r.why) + '</div>'
      + '<div class="ba-why"><span class="ba-lab">EVIDENCE</span> ' + r.evidenceCount + ' item(s)'
      + (r.unlabelled ? ' <span class="ba-chip ba-bad">' + r.unlabelled + ' unlabelled</span>' : '') + '</div>'
      + '<ul class="ba-ev">' + r.evidence.map(e => '<li>' + esc(e.text) + ' <span class="ba-evcls">[' + esc(e.evidence || 'unknown') + ']</span> <span class="ba-evsrc">' + esc(e.source || '') + '</span></li>').join('') + '</ul>'
      + '<div class="ba-acts-row">'
      + '<button class="bb xs ba-approve" type="button">✓ APPROVE &amp; RUN</button>'
      + '<button class="bb xs ba-reject" type="button">✕ REJECT</button>'
      + '</div></div></div>').join('')
      : '<div class="ba-empty">Nothing is waiting on you. Anything an automation wants to do outside the station will appear here.</div>';

    if (!decidedBox) return;
    decidedBox.innerHTML = decided.length ? decided.map(r => ''
      + '<div class="ba-card ba-dim" data-id="' + esc(r.id) + '">'
      + '<div class="ba-card-h"><b>' + esc(r.what) + '</b>'
      + '<span class="ba-chip ' + (r.status === 'approved' ? 'ba-ok' : 'ba-dim') + '">' + esc(r.status) + '</span></div>'
      + '<div class="ba-card-b"><div class="ba-stat">decided by ' + esc(r.decidedBy || '—')
      + (r.reason ? ' · ' + esc(r.reason) : '') + '</div></div></div>').join('')
      : '<div class="ba-empty">No decisions yet.</div>';
  }

  function refresh() {
    if (!state.businessId) { renderHub(); renderList(); renderApprovals(); return Promise.resolve(); }
    return Promise.all([
      request('GET', bizPath('/automations')),
      request('GET', bizPath('/approvals')),
      request('GET', '/api/automation/status')
    ]).then(function (rs) {
      const a = rs[0], p = rs[1], s = rs[2];
      if (a.ok && a.j) state.automations = a.j.automations || [];
      if (p.ok && p.j) state.approvals = p.j.approvals || [];
      if (s.ok && s.j) state.hub = s.j.hub || null;
      if (!a.ok && a.status) msg('#ba-msg', errText(a, 'could not read automations'), false);
      renderHub(); renderList(); renderApprovals();
    }).catch(function (e) {
      msg('#ba-msg', 'could not reach the sidecar: ' + ((e && e.message) || 'unknown'), false);
    });
  }

  function loadRuns(id, out) {
    return request('GET', '/api/automations/' + encodeURIComponent(id) + '/runs?limit=20').then(function (r) {
      if (!r.ok) { out.innerHTML = '<div class="ba-empty">' + esc(errText(r, 'could not read the run history')) + '</div>'; return; }
      const rows = runRows(r.j.runs);
      out.innerHTML = rows.length
        ? rows.map(x => '<div class="ba-run ' + (x.ok ? '' : 'ba-run-bad') + '">'
          + '<span class="ba-run-t">' + esc(relTime(x.at, Date.now())) + '</span>'
          + '<span class="ba-run-e">' + esc(x.event) + '</span>'
          + '<span class="ba-run-s">' + (x.ok ? '✓' : '✕') + ' ' + esc(x.summary) + '</span>'
          + (x.reason ? '<span class="ba-run-r">' + esc(x.reason) + '</span>' : '')
          + '</div>').join('')
        : '<div class="ba-empty">It has never fired.</div>';
    });
  }

  function wire() {
    if (!body) return;
    const post = (path, payload) => request('POST', path, payload);

    // ---- the business picker
    const bizSel = el('#ba-biz');
    if (bizSel) bizSel.addEventListener('change', function () {
      state.businessId = bizSel.value || '';
      state.automations = []; state.approvals = [];
      refresh();
    });

    // ---- the hub switch (§19)
    const hubBtn = el('#ba-hub');
    if (hubBtn) hubBtn.addEventListener('click', function () {
      const halted = !!(state.hub && state.hub.halted);
      post('/api/automation/' + (halted ? 'resume' : 'halt')).then(function (r) {
        if (!r.ok) { msg('#ba-msg', errText(r, 'the hub control failed'), false); return; }
        msg('#ba-msg', halted ? 'Automations resumed.' : 'Every automation is stood down until you resume it.', true);
        return refresh();
      });
    });
    const reload = el('#ba-reload');
    if (reload) reload.addEventListener('click', function () { refresh(); });

    // ---- the builder
    const trigSel = el('#ba-trigger');
    const waitSel = el('#ba-wait');
    if (waitSel) {
      const waits = [[0, 'as often as it happens'], [1000, 'at most once a second'], [60000, 'at most once a minute'], [300000, 'at most once every 5 minutes'], [3600000, 'at most once an hour']];
      waitSel.innerHTML = waits.map(w => '<option value="' + w[0] + '">' + esc(w[1]) + '</option>').join('');
    }
    if (trigSel && state.catalog) {
      trigSel.innerHTML = '<option value="">— pick a trigger —</option>'
        + (state.catalog.triggers || []).map(t => '<option value="' + esc(t.event) + '">' + esc(t.label) + '</option>').join('');
      trigSel.addEventListener('change', function () {
        const note = el('#ba-trigger-note');
        if (note) note.textContent = trigSel.value ? triggerNote(state.catalog, trigSel.value) : '';
        const conds = el('#ba-conds');
        if (conds) conds.innerHTML = '';    // a condition's field list belongs to the OLD trigger
        drawPreview();
      });
    }

    function addCondition() {
      const box = el('#ba-conds');
      if (!box || !state.catalog) return;
      const fields = payloadFields(state.catalog, trigSel ? trigSel.value : '');
      const row = document.createElement('div');
      row.className = 'ba-cond';
      row.innerHTML = '<select class="ba-in ba-cf">' + (fields.length
        ? fields.map(f => '<option value="' + esc(f.field) + '">' + esc(f.field) + '</option>').join('')
        : '<option value="">— pick a trigger first —</option>') + '</select>'
        + '<select class="ba-in ba-co">' + (state.catalog.ops || []).map(o => '<option value="' + esc(o.op) + '">' + esc(o.label) + '</option>').join('') + '</select>'
        + '<input class="ba-in ba-cv" type="text" placeholder="value">'
        + '<button class="bb xs ba-cx" type="button">✕</button>';
      box.appendChild(row);
      row.querySelector('.ba-cx').addEventListener('click', function () { row.remove(); drawPreview(); });
      row.querySelectorAll('select,input').forEach(n => n.addEventListener('change', drawPreview));
    }
    function addAction() {
      const box = el('#ba-acts');
      if (!box || !state.catalog) return;
      const row = document.createElement('div');
      row.className = 'ba-act';
      row.innerHTML = '<select class="ba-in ba-aa">' + (state.catalog.actions || []).map(a => '<option value="' + esc(a.id) + '">' + esc(a.label) + (a.tier === 'review' ? ' (asks you first)' : '') + '</option>').join('') + '</select>'
        + '<div class="ba-aparams"></div>'
        + '<button class="bb xs ba-ax" type="button">✕</button>';
      box.appendChild(row);
      const sel = row.querySelector('.ba-aa');
      const paramsBox = row.querySelector('.ba-aparams');
      function drawParams() {
        const def = actionDef(state.catalog, sel.value);
        const fields = def ? (def.required || []).concat(def.optional || []) : [];
        paramsBox.innerHTML = fields.map(f => {
          const req = def && (def.required || []).indexOf(f) >= 0;
          return '<label class="ba-pf"><span>' + esc(f) + (req ? ' *' : '') + '</span>'
            + '<input class="ba-in ba-pv" data-field="' + esc(f) + '" type="text" placeholder="' + (req ? 'required' : 'optional') + ' — {{field}} reads the event"></label>';
        }).join('');
        paramsBox.querySelectorAll('input').forEach(n => n.addEventListener('input', drawPreview));
        const hint = document.createElement('div');
        hint.className = 'ba-sub';
        hint.textContent = def ? def.note : '';
        paramsBox.appendChild(hint);
        drawPreview();
      }
      sel.addEventListener('change', drawParams);
      row.querySelector('.ba-ax').addEventListener('click', function () { row.remove(); drawPreview(); });
      drawParams();
    }

    const condAdd = el('#ba-cond-add');
    if (condAdd) condAdd.addEventListener('click', addCondition);
    const actAdd = el('#ba-act-add');
    if (actAdd) actAdd.addEventListener('click', addAction);

    function draft() {
      const conds = [];
      body.querySelectorAll('#ba-conds .ba-cond').forEach(r => {
        const field = (r.querySelector('.ba-cf') || {}).value || '';
        const op = (r.querySelector('.ba-co') || {}).value || '';
        const raw = (r.querySelector('.ba-cv') || {}).value || '';
        if (!field) return;
        const def = opDef(state.catalog, op);
        if (!def) return;
        if (!def.needsValue) { conds.push({ field: field, op: op }); return; }
        let v = raw;
        if (op === 'in' || op === 'not_in') v = raw.split(',').map(x => x.trim()).filter(Boolean);
        else if (raw !== '' && !isNaN(Number(raw))) v = Number(raw);
        conds.push({ field: field, op: op, value: v });
      });
      const acts = [];
      body.querySelectorAll('#ba-acts .ba-act').forEach(r => {
        const action = (r.querySelector('.ba-aa') || {}).value || '';
        if (!action) return;
        const params = {};
        r.querySelectorAll('.ba-pv').forEach(n => { const f = n.getAttribute('data-field'); if (n.value !== '') params[f] = n.value; });
        acts.push({ action: action, params: params });
      });
      return {
        name: (el('#ba-name') || {}).value || '',
        trigger: trigSel ? trigSel.value : '',
        conditions: conds,
        actions: acts,
        enabled: false,
        cooldownMs: Number((waitSel || {}).value || 0)
      };
    }

    function drawPreview() {
      const box = el('#ba-preview');
      if (!box) return;
      const d = draft();
      const g = ruleGuard(state.catalog, d);
      const autonomy = draftAutonomy(state.catalog, d);
      box.innerHTML = '<div class="ba-lab">WHAT THIS WILL DO</div>'
        + (g.ok
          ? '<div class="ba-prev-line">WHEN ' + esc(triggerLabel(state.catalog, d.trigger)) + '</div>'
            + (d.conditions.length ? '<div class="ba-prev-line">ONLY IF ' + esc(d.conditions.map(c => conditionText(state.catalog, c)).join(' and ')) + '</div>' : '')
            + '<div class="ba-prev-line">THEN ' + esc(d.actions.map(a => actionText(state.catalog, a)).join('; ')) + '</div>'
            + '<div class="ba-prev-line">' + autonomyChip(autonomy) + '</div>'
          : '<div class="ba-prev-line ba-bad-t">' + esc(g.reason) + '</div>');
    }
    body.addEventListener('input', function (e) {
      if (e.target && (e.target.id === 'ba-name' || e.target.className.indexOf('ba-pv') >= 0)) drawPreview();
    });

    function create(enable) {
      const d = draft();
      d.enabled = !!enable;
      const g = ruleGuard(state.catalog, d);
      if (!g.ok) { msg('#ba-cmsg', g.reason, false); return; }
      if (!state.businessId) { msg('#ba-cmsg', 'pick a business in the previous section first', false); return; }
      post(bizPath('/automations'), d).then(function (r) {
        if (!r.ok) { msg('#ba-cmsg', errText(r, 'could not save this automation'), false); return; }
        msg('#ba-cmsg', enable
          ? 'Saved and switched on. ' + (draftAutonomy(state.catalog, d) === 'approval' ? 'It will ask you before it does anything outside the station.' : 'It is listening now.')
          : 'Saved, switched off. Switch it on when you are ready.', true);
        el('#ba-name').value = '';
        const c = el('#ba-conds'); if (c) c.innerHTML = '';
        const a = el('#ba-acts'); if (a) a.innerHTML = '';
        drawPreview();
        refresh();
      });
    }
    const cOff = el('#ba-create');
    if (cOff) cOff.addEventListener('click', function () { create(false); });
    const cOn = el('#ba-create-on');
    if (cOn) cOn.addEventListener('click', function () { create(true); });

    // ---- the list (delegated, because the list re-renders)
    const listBox = el('#ba-list');
    if (listBox) listBox.addEventListener('click', function (e) {
      const card = e.target.closest ? e.target.closest('.ba-card') : null;
      if (!card) return;
      const id = card.getAttribute('data-id');
      const row = (state.automations || []).filter(a => a.id === id)[0];
      if (!row) return;
      if (e.target.classList.contains('ba-toggle')) {
        post('/api/automations/' + encodeURIComponent(id) + (row.enabled ? '/disable' : '/enable')).then(function (r) {
          if (!r.ok) { msg('#ba-msg', errText(r, 'could not switch it'), false); return; }
          msg('#ba-msg', row.enabled ? 'Switched off.' : 'Switched on — it is listening now.', true);
          refresh();
        });
      } else if (e.target.classList.contains('ba-test')) {
        const out = card.querySelector('.ba-testout');
        if (!out) return;
        out.hidden = false;
        out.innerHTML = '<div class="ba-sub">testing…</div>';
        post('/api/automations/' + encodeURIComponent(id) + '/test', { payload: {} }).then(function (r) {
          if (!r.ok) { out.innerHTML = '<div class="ba-bad-t">' + esc(errText(r, 'the test failed')) + '</div>'; return; }
          const t = r.j.test || {};
          out.innerHTML = '<div class="ba-lab">DRY RUN — nothing was written</div>'
            + '<div class="ba-prev-line">Would fire: <b>' + (t.fires ? 'yes' : 'no') + '</b>' + (t.enabled ? '' : ' (it is switched off)') + '</div>'
            + '<div class="ba-prev-line">Conditions: ' + ((t.conditions && t.conditions.results || []).map(x => esc(x.field + ' ' + x.op) + ' ' + (x.ok ? '✓' : '✕')).join(', ') || 'none') + '</div>'
            + '<div class="ba-prev-line">' + (t.actions || []).map(x => esc(x.action) + ' → ' + esc(x.status) + (x.reason ? ' (' + esc(x.reason) + ')' : '')).join('; ') + '</div>'
            + '<div class="ba-sub">A dry run with an empty event shows you the shape; use RUN to try it against a real event.</div>';
        });
      } else if (e.target.classList.contains('ba-runs')) {
        const out = card.querySelector('.ba-runsout');
        if (!out) return;
        out.hidden = false;
        out.innerHTML = '<div class="ba-sub">reading…</div>';
        loadRuns(id, out);
      } else if (e.target.classList.contains('ba-del')) {
        arm(e.target, '■ SURE?', function () {
          request('DELETE', '/api/automations/' + encodeURIComponent(id)).then(function (r) {
            if (!r.ok) { msg('#ba-msg', errText(r, 'could not remove it'), false); return; }
            const ex = (r.j && r.j.expiredApprovals) || 0;
            msg('#ba-msg', 'Removed.' + (ex ? ' ' + ex + ' pending request(s) expired with it.' : ''), true);
            refresh();
          });
        });
      }
    });

    // ---- the approval queue (§13)
    const apBox = el('#ba-approvals');
    if (apBox) apBox.addEventListener('click', function (e) {
      const card = e.target.closest ? e.target.closest('.ba-ap') : null;
      if (!card) return;
      const id = card.getAttribute('data-id');
      if (e.target.classList.contains('ba-approve')) {
        post('/api/approvals/' + encodeURIComponent(id) + '/approve', { by: 'user' }).then(function (r) {
          if (!r.ok) { msg('#ba-apmsg', errText(r, 'could not approve it'), false); return; }
          const ex = (r.j && r.j.executed) || {};
          msg('#ba-apmsg', ex.delivered === false
            ? 'Approved. ' + (ex.reason || 'Your authorization is recorded; nothing left the station.')
            : 'Approved and run.', true);
          refresh();
        });
      } else if (e.target.classList.contains('ba-reject')) {
        post('/api/approvals/' + encodeURIComponent(id) + '/reject', { by: 'user', reason: 'rejected from the automation console' }).then(function (r) {
          if (!r.ok) { msg('#ba-apmsg', errText(r, 'could not reject it'), false); return; }
          msg('#ba-apmsg', 'Rejected. Nothing ran.', true);
          refresh();
        });
      }
    });

    // ---- first load
    request('GET', '/api/automation/catalog').then(function (r) {
      if (r.ok && r.j) state.catalog = r.j;
      if (trigSel && state.catalog) {
        trigSel.innerHTML = '<option value="">— pick a trigger —</option>'
          + (state.catalog.triggers || []).map(t => '<option value="' + esc(t.event) + '">' + esc(t.label) + '</option>').join('');
      }
      drawPreview();
    });
    if (!state.businessId && bizSel && bizSel.value) state.businessId = bizSel.value;
    refresh();
  }

  function lane(b) {
    body = b;
    return {
      sections: [
        { id: 'automation', label: 'ACTIVE AUTOMATIONS', glyph: '⚙', desc: 'Standing business rules — when something happens in a business, do this. Each one says whether it runs on its own or asks you first.', build: el2 => { el2.innerHTML = secActive(); } },
        { id: 'automation-build', label: 'BUILD AN AUTOMATION', glyph: '✦', desc: 'Pick a trigger, add conditions, choose what to do. Anything that reaches outside the station is held for your approval.', build: el2 => { el2.innerHTML = secBuild(); } },
        { id: 'automation-approvals', label: 'WAITING ON YOU', glyph: '✓', desc: 'Actions an automation wanted to take outside the station, held for your decision. Approving runs it; rejecting drops it.', build: el2 => { el2.innerHTML = secApprovals(); } }
      ],
      wire: wire
    };
  }

  AutomationWindow.registerLane(lane);

  return {
    esc, relTime, triggerLabel, triggerNote, actionDef, actionLabel, opDef,
    autonomyText, autonomyChip, conditionText, actionText, payloadFields,
    ruleGuard, draftAutonomy, ruleRows, approvalRows, runRows, hubLine, summarise, cooldownText,
    lane
  };
});
