'use strict';
/* test/businessautomation.test.js — the BUSINESS lane of the AUTOMATION hub (frontend/app/businessautomation.js).

   Two halves, tested two ways.
     The PURE half is require()d and asserted directly: labels, the client-side validation mirror, the live
     autonomy derivation, row shaping and the hub sentence. The interesting ones are the places the console
     refuses to overstate what happened — `hubLine` never says the hub is live while §19's stand-down is on,
     `ruleRows` prints WHY a switched-off rule is off ("auto-disabled after 5 failed runs" reads very
     differently from "you switched it off"), and `runRows` counts skipped actions separately from executed
     ones so a half-worked run is not rendered as a success.
     The DOM half cannot run headless, so its WIRING is source-locked: it registers a LANE (not a window),
     its three section ids, the script order in index.html, the scoped stylesheet, and the fail-closed
     ArmConfirm path on the one destructive control.

   THE VOCABULARIES ARE NOT COPIED. The catalog is built here from the REAL store + permissions modules,
   exactly as sidecar/automation-routes.js builds it — so the client mirror is checked against the live
   trigger/op/action catalogue, and a server-side addition that the client's guard did not learn about
   fails this test instead of silently refusing a valid rule at the form.

   ALSO LOCKED: the stylesheet prefix is .ba-, NOT .bc-/.bm-/.mg-. Phases 1, 2 and 4 already own those, and
   every stylesheet in frontend/css/ is global once index.html loads it — an overlap would let one console
   restyle another. This test fails if a taken prefix reappears in the Phase 5 stylesheet or engine.
   Pure + fast (no DOM, no fetch, no boot). */
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');

const BA = require('../frontend/app/businessautomation.js');
const Autom = require('../sidecar/business-automation-store.js');
const Perms = require('../sidecar/business-permissions.js');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const html = read('frontend/index.html');
const engine = read('frontend/app/businessautomation.js');
const win = read('frontend/app/windows/automation.js');
const css = read('frontend/css/businessautomation.css');
const glossary = read('frontend/app/glossary.js');

/* the catalog, built the way sidecar/automation-routes.js builds it — from the modules that ENFORCE the
   vocabularies, never a hand-written list. If the server grows an action the client does not know, the
   guard assertions below are checked against the real thing. */
const CATALOG = {
  triggers: Autom.TRIGGER_EVENTS,
  ops: Autom.CONDITION_OPS,
  actions: Autom.AUTOMATION_ACTIONS.map(a => {
    const c = Perms.classify(a.perm);
    return { id: a.id, label: a.label, perm: a.perm, tier: c.tier, risk: a.risk, executor: a.executor,
      required: a.required, optional: a.optional, note: a.note };
  }),
  tiers: Perms.TIERS,
  tierNotes: Perms.TIER_NOTES,
  evidence: Perms.EVIDENCE,
  limits: { maxConditions: Autom.MAX_CONDITIONS, maxActions: Autom.MAX_ACTIONS,
    failureThreshold: Autom.FAILURE_THRESHOLD, defaultCooldownMs: Autom.DEFAULT_COOLDOWN_MS,
    maxCooldownMs: Autom.MAX_COOLDOWN_MS }
};

// helpers for building drafts without repeating the shape
const act = (id, params) => ({ action: id, params: params || {} });
const safeAction = CATALOG.actions.filter(a => a.tier === 'safe')[0];
const reviewAction = CATALOG.actions.filter(a => a.tier === 'review')[0];
A.ok(safeAction, 'the catalogue still has a safe action to build a draft from');
A.ok(reviewAction, 'the catalogue still has a review action to build a draft from');
/* a SAFE action with every required param filled — the drafts below that mean "a valid action" use this,
   so a refusal can only come from the thing under test and not from an unrelated missing param. */
const sat = (def) => { const p = {}; for (const f of (def.required || [])) p[f] = 'v'; return { action: def.id, params: p }; };

// ================================ the catalogue is really the live one ================================
A.ok(CATALOG.triggers.length >= 30, 'the trigger list came off the store (>=30 curated events)');
A.ok(CATALOG.actions.length >= 8, 'the action list came off the store');
A.ok(CATALOG.ops.length >= 10, 'the op list came off the store');
A.ok(CATALOG.triggers.every(t => t.example && typeof t.example === 'object'),
  'every trigger carries an example payload — the condition builder reads its fields from it');

// ================================ esc ================================
A.eq(BA.esc('<b>"x" & \'y\'</b>'), '&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;', 'esc neutralises every HTML-significant char');
A.eq(BA.esc(null), '', 'esc(null) is the empty string, not "null"');
A.eq(BA.esc(0), '0', 'esc keeps a falsy-but-real value');

// ================================ relTime (now is injected, so the pure half stays deterministic) ================================
A.eq(BA.relTime(null, 1000), 'never', 'a missing instant reads "never", not "now"');
A.eq(BA.relTime(undefined, 1000), 'never', 'an undefined instant reads "never"');
A.eq(BA.relTime('nope', 1000), 'never', 'a non-numeric instant reads "never"');
A.eq(BA.relTime(9000, 10000), '1s ago', 'seconds');
A.eq(BA.relTime(0, 120000), '2m ago', 'minutes');
A.eq(BA.relTime(0, 7200000), '2h ago', 'hours');
A.eq(BA.relTime(0, 172800000), '2d ago', 'days');
A.eq(BA.relTime(10000, 9000), 'just now', 'a future instant reads "just now" rather than a negative age');

// ================================ trigger / action / op lookup ================================
const t0 = CATALOG.triggers[0];
A.eq(BA.triggerLabel(CATALOG, t0.event), t0.label, 'triggerLabel reads the label off the catalogue');
A.eq(BA.triggerLabel(CATALOG, 'not.a.real.event'), 'not.a.real.event', 'an unknown trigger falls back to the raw name — nothing is invented');
A.eq(BA.triggerLabel(null, 'x.y'), 'x.y', 'a missing catalogue does not throw');
A.eq(BA.triggerNote(CATALOG, t0.event), t0.note || '', 'triggerNote reads the note');
A.eq(BA.triggerNote(CATALOG, 'nope'), '', 'an unknown trigger has no note');

A.eq(BA.actionLabel(CATALOG, safeAction.id), safeAction.label, 'actionLabel reads the label');
A.eq(BA.actionLabel(CATALOG, 'not_an_action'), 'not_an_action', 'an unknown action falls back to the raw id');
A.eq(BA.actionDef(CATALOG, safeAction.id).id, safeAction.id, 'actionDef returns the whole row');
A.eq(BA.actionDef(CATALOG, 'nope'), null, 'an unknown action has no definition');
A.eq(BA.opDef(CATALOG, CATALOG.ops[0].op).op, CATALOG.ops[0].op, 'opDef returns the op row');
A.eq(BA.opDef(CATALOG, 'nope'), null, 'an unknown op has no definition');

// ================================ autonomy: text + chip ================================
A.eq(BA.autonomyText('autonomous'), 'runs on its own', 'autonomous reads in plain words');
A.eq(BA.autonomyText('approval'), 'asks you first', 'approval reads in plain words, not "review"');
A.eq(BA.autonomyText('blocked'), 'cannot run', 'blocked reads as a stop');
A.eq(BA.autonomyText('garbage'), 'cannot run', 'an unknown autonomy is treated as blocked (fail-closed)');
A.ok(BA.autonomyChip('approval').indexOf('ba-warn') >= 0, 'the approval chip is the gold "held for you" chip');
A.ok(BA.autonomyChip('autonomous').indexOf('ba-ok') >= 0, 'the autonomous chip is the ok chip');
A.ok(BA.autonomyChip('blocked').indexOf('ba-bad') >= 0, 'the blocked chip is the bad chip');
A.ok(BA.autonomyChip('approval').indexOf('asks you first') >= 0, 'the chip prints its label, so colour is never the only signal');

// ================================ conditionText / actionText ================================
const opEq = CATALOG.ops.filter(o => o.op === 'eq')[0];
A.ok(opEq && opEq.needsValue, 'the catalogue still has an eq op that needs a value');
A.eq(BA.conditionText(CATALOG, { field: 'stage', op: 'eq', value: 'lead' }), 'stage ' + opEq.label + ' "lead"',
  'a valued condition renders field · label · quoted value');
const opExists = CATALOG.ops.filter(o => o.op === 'exists')[0];
A.ok(opExists && !opExists.needsValue, 'the catalogue still has an exists op that needs no value');
A.eq(BA.conditionText(CATALOG, { field: 'note', op: 'exists' }), 'note ' + opExists.label,
  'a valueless condition renders field · label and no value');
A.eq(BA.conditionText(CATALOG, { field: 'tags', op: 'in', value: ['a', 'b'] }), 'tags ' + CATALOG.ops.filter(o => o.op === 'in')[0].label + ' "a, b"',
  'an array value is joined for display');
A.eq(BA.conditionText(CATALOG, {}), '? ?', 'a malformed condition renders placeholders rather than throwing');

A.eq(BA.actionText(CATALOG, { action: safeAction.id }), safeAction.label, 'a paramless action renders just its label');
A.ok(BA.actionText(CATALOG, act(safeAction.id, { a: 1 })).indexOf('a=1') >= 0, 'a parameter is shown');
A.ok(BA.actionText(CATALOG, act(safeAction.id, { a: 1, b: 2, c: 3, d: 4 })).indexOf('+2 more') >= 0,
  'more than two parameters are summarised, not listed');
A.eq(BA.actionText(CATALOG, { action: 'ghost', params: {} }), 'ghost', 'an unknown action falls back to the raw id');

// ================================ payloadFields: the builder offers fields that EXIST on the trigger ================================
const pf = BA.payloadFields(CATALOG, t0.event);
A.eq(pf.map(f => f.field).sort(), Object.keys(t0.example).sort(),
  'payloadFields offers exactly the keys the trigger example declares');
A.ok(pf.every(f => Object.prototype.hasOwnProperty.call(f, 'sample')), 'each offered field carries its sample');
A.eq(BA.payloadFields(CATALOG, 'not.a.real.event'), [], 'an unknown trigger offers no fields');
A.eq(BA.payloadFields(null, 'x'), [], 'a missing catalogue offers no fields');

// ================================ ruleGuard: the client mirror ================================
const goodDraft = () => ({ name: 'Follow up', trigger: t0.event, conditions: [], actions: [act(safeAction.id, (() => {
  const p = {}; for (const f of (safeAction.required || [])) p[f] = 'x'; return p;
})())] });
A.eq(BA.ruleGuard(CATALOG, goodDraft()).ok, true, 'a complete draft passes the mirror');

A.eq(BA.ruleGuard(CATALOG, {}).ok, false, 'an empty draft is refused');
A.ok(/name/i.test(BA.ruleGuard(CATALOG, {}).reason), 'and the refusal names the missing NAME');
A.eq(BA.ruleGuard(CATALOG, { name: 'x' }).ok, false, 'a draft with no trigger is refused');
A.ok(/trigger/i.test(BA.ruleGuard(CATALOG, { name: 'x' }).reason), 'and the refusal names the trigger');
A.eq(BA.ruleGuard(CATALOG, { name: 'x', trigger: 'not.a.trigger' }).ok, false,
  'a trigger outside the catalogue is refused — the mirror enforces the closed vocabulary');
A.ok(/trigger/i.test(BA.ruleGuard(CATALOG, { name: 'x', trigger: 'not.a.trigger' }).reason), 'and says so');

// conditions
A.eq(BA.ruleGuard(CATALOG, { name: 'x', trigger: t0.event, conditions: [{ field: '', op: 'eq', value: 1 }], actions: [act(safeAction.id)] }).ok, false,
  'a condition with no field is refused');
A.eq(BA.ruleGuard(CATALOG, { name: 'x', trigger: t0.event, conditions: [{ field: 'a', op: 'ghost' }], actions: [act(safeAction.id)] }).ok, false,
  'a condition with an unknown op is refused');
A.eq(BA.ruleGuard(CATALOG, { name: 'x', trigger: t0.event, conditions: [{ field: 'a', op: 'eq', value: '' }], actions: [act(safeAction.id)] }).ok, false,
  'a valued condition with an empty value is refused');
A.eq(BA.ruleGuard(CATALOG, { name: 'x', trigger: t0.event, conditions: [{ field: 'a', op: 'exists' }], actions: [sat(safeAction)] }).ok, true,
  'a valueless condition needs no value');
A.eq(BA.ruleGuard(CATALOG, { name: 'x', trigger: t0.event, conditions: [{ field: 'a', op: 'eq', value: 0 }], actions: [sat(safeAction)] }).ok, true,
  'a value of 0 is a real value, not an absent one');
const manyConds = []; for (let i = 0; i <= CATALOG.limits.maxConditions; i++) manyConds.push({ field: 'f' + i, op: 'exists' });
A.eq(BA.ruleGuard(CATALOG, { name: 'x', trigger: t0.event, conditions: manyConds, actions: [sat(safeAction)] }).ok, false,
  'more than maxConditions is refused');
A.eq(BA.ruleGuard(CATALOG, { name: 'x', trigger: t0.event, conditions: manyConds.slice(0, CATALOG.limits.maxConditions), actions: [sat(safeAction)] }).ok, true,
  'exactly maxConditions is allowed');

// actions
A.eq(BA.ruleGuard(CATALOG, { name: 'x', trigger: t0.event, conditions: [], actions: [] }).ok, false,
  'a rule with no action is refused');
A.ok(/action/i.test(BA.ruleGuard(CATALOG, { name: 'x', trigger: t0.event, actions: [] }).reason), 'and the refusal names the action');
A.eq(BA.ruleGuard(CATALOG, { name: 'x', trigger: t0.event, actions: [act('not_an_action')] }).ok, false,
  'an action outside the catalogue is refused');
const manyActs = []; for (let i = 0; i <= CATALOG.limits.maxActions; i++) manyActs.push(sat(safeAction));
A.eq(BA.ruleGuard(CATALOG, { name: 'x', trigger: t0.event, actions: manyActs }).ok, false,
  'more than maxActions is refused');

// the required-param rule — THE ONE THE SERVER ALSO ENFORCES
const req = (safeAction.required || [])[0];
A.ok(req, 'the chosen safe action has at least one required param (so the rule below is meaningful)');
A.eq(BA.ruleGuard(CATALOG, { name: 'x', trigger: t0.event, actions: [act(safeAction.id, {})] }).ok, false,
  'an action missing a required param is refused');
A.ok(BA.ruleGuard(CATALOG, { name: 'x', trigger: t0.event, actions: [act(safeAction.id, {})] }).reason.indexOf(req) >= 0,
  'and the refusal NAMES the missing param');
A.eq(BA.ruleGuard(CATALOG, { name: 'x', trigger: t0.event, actions: [act(safeAction.id, (() => { const p = {}; p[req] = '   '; return p; })())] }).ok, false,
  'a whitespace-only required param is refused (it is blank, not filled)');

// a permissive-vs-authoritative check: the mirror must never accept a draft the STORE would refuse.
// Both are run over the same drafts and their verdicts compared on the fields the store validates.
const storeDrafts = [
  goodDraft(),
  { name: '', trigger: t0.event, actions: [sat(safeAction)] },
  { name: 'x', trigger: 'not.a.trigger', actions: [sat(safeAction)] },
  { name: 'x', trigger: t0.event, actions: [] },
  { name: 'x', trigger: t0.event, actions: [act('not_an_action')] },
  { name: 'x', trigger: t0.event, actions: [act(safeAction.id, {})] },
  { name: 'x', trigger: t0.event, conditions: [{ field: 'a', op: 'ghost' }], actions: [sat(safeAction)] }
];
for (const d of storeDrafts) {
  const client = BA.ruleGuard(CATALOG, d).ok;
  const server = Autom.validateActions(d.actions, Perms).ok
    && Autom.validateTrigger(d.trigger).ok
    && Autom.validateConditions(d.conditions).ok;
  A.ok(!(client && !server),
    'the client mirror never accepts a draft the store would refuse — client=' + client + ' server=' + server
      + ' for trigger=' + d.trigger + ' actions=' + JSON.stringify(d.actions));
}

// ================================ draftAutonomy: the live preview's tier derivation ================================
A.eq(BA.draftAutonomy(CATALOG, { actions: [act(safeAction.id)] }), 'autonomous',
  'a draft of only safe actions would run on its own');
A.eq(BA.draftAutonomy(CATALOG, { actions: [act(safeAction.id), act(reviewAction.id)] }), 'approval',
  'one review action makes the whole rule ask first — the union, not the weakest link');
A.eq(BA.draftAutonomy(CATALOG, { actions: [] }), 'blocked', 'a draft with no action cannot run');
A.eq(BA.draftAutonomy(CATALOG, {}), 'blocked', 'a draft with no actions key cannot run');
A.eq(BA.draftAutonomy(CATALOG, { actions: [act('ghost')] }), 'autonomous',
  'an unknown action contributes no tier (the server refuses it first, so this is unreachable in practice)');

// ================================ ruleRows: the honest status line ================================
const rows = BA.ruleRows([
  { id: 'b~a1', name: 'Live', trigger: t0.event, enabled: true, autonomy: 'autonomous', tiers: ['safe'],
    conditions: [{ field: 'a', op: 'exists' }], actions: [act(safeAction.id)], fireCount: 3, consecutiveFailures: 0, cooldownMs: 0 },
  { id: 'b~a2', name: 'Sick', trigger: t0.event, enabled: true, autonomy: 'autonomous', tiers: ['safe'],
    conditions: [], actions: [act(safeAction.id)], fireCount: 9, consecutiveFailures: 5, cooldownMs: 1000 },
  { id: 'b~a3', name: 'Off', trigger: t0.event, enabled: false, autonomy: 'approval', tiers: ['review'],
    conditions: [], actions: [act(reviewAction.id)], fireCount: 0, consecutiveFailures: 0, cooldownMs: 0,
    disabledReason: 'switched itself off after 5 failed runs' },
  { id: 'b~a4', name: 'OffByHand', trigger: t0.event, enabled: false, autonomy: 'autonomous', tiers: ['safe'],
    conditions: [], actions: [act(safeAction.id)], fireCount: 1, consecutiveFailures: 0, cooldownMs: 0 }
]);
A.eq(rows.length, 4, 'one row per rule');
A.eq(rows[0].status, 'listening', 'an enabled rule with a clean streak reads "listening"');
A.eq(rows[1].status, '5 failure(s) in a row', 'an enabled rule with a failure streak says so instead of claiming to listen');
A.eq(rows[2].status, 'switched itself off after 5 failed runs',
  'a rule the engine auto-disabled says WHY — the reason travels, not a generic "off"');
A.eq(rows[3].status, 'switched off',
  'a rule switched off by hand with no reason reads plainly as switched off');
A.eq(rows[0].autonomyText, 'runs on its own', 'the row carries its plain-words autonomy');
A.eq(rows[0].conditionCount, 1, 'condition count is the length of the conditions list');
A.eq(rows[0].actionCount, 1, 'action count is the length of the actions list');
A.eq(rows[0].fireCount, 3, 'fire count travels');
A.eq(BA.ruleRows(null), [], 'ruleRows(null) is an empty list, not a throw');
A.eq(BA.ruleRows([{}])[0].fireCount, 0, 'a rule with no fire count defaults to 0');
A.eq(BA.ruleRows([{}])[0].conditionCount, 0, 'a rule with no conditions has a count of 0');
A.eq(BA.ruleRows([{}])[0].enabled, false, 'a rule with no enabled flag reads as off (fail-closed)');

// ================================ approvalRows: P1 in the UI ================================
const aps = BA.approvalRows([
  { id: 'b~v1', status: 'pending', tier: 'review', risk: 'high', what: 'Send an email', why: 'a lead arrived',
    evidence: [{ text: 'lead from the site', evidence: 'user-stated', source: 'crm' }, { text: 'guessed', evidence: 'unknown', source: '' }] },
  { id: 'b~v2', status: 'approved', tier: 'review', risk: 'medium', what: 'Publish', why: 'ready', evidence: [],
    decidedBy: 'user', reason: 'looks good' }
]);
A.eq(aps[0].pending, true, 'a pending row is pending');
A.eq(aps[1].pending, false, 'a decided row is not pending');
A.eq(aps[0].evidenceCount, 2, 'every evidence item is counted');
A.eq(aps[0].unlabelled, 1, 'an evidence item with no/unknown class is counted as UNLABELLED — never quietly dropped (P1)');
A.eq(aps[1].unlabelled, 0, 'a row with no evidence has nothing unlabelled');
A.eq(aps[1].decidedBy, 'user', 'the decider travels');
A.eq(aps[1].reason, 'looks good', 'the reason travels');
A.eq(BA.approvalRows(null), [], 'approvalRows(null) is an empty list');

// ================================ runRows: a half-worked run is not a success ================================
const runs = BA.runRows([
  { id: 'r1', at: 1000, event: t0.event, ok: true, depth: 1,
    actions: [{ action: safeAction.id, status: 'executed' }, { action: reviewAction.id, status: 'pending-approval' }] },
  { id: 'r2', at: 2000, event: t0.event, ok: false, reason: 'no such business',
    actions: [{ action: safeAction.id, status: 'failed' }, { action: safeAction.id, status: 'skipped' }] }
]);
A.eq(runs[0].executed, 1, 'executed actions are counted');
A.eq(runs[0].pending, 1, 'actions held for approval are counted separately');
A.eq(runs[0].failed, 0, 'a run with a pending action has no failures');
A.ok(runs[0].summary.indexOf('1 ran') >= 0, 'the summary says how many ran');
A.ok(runs[0].summary.indexOf('waiting on you') >= 0, 'the summary says an action is waiting on the user');
A.eq(runs[1].failed, 2, 'failed AND skipped actions both count as not-run — a skipped action did not happen');
A.ok(runs[1].summary.indexOf('failed') >= 0, 'the summary reports the failures');
A.eq(runs[1].reason, 'no such business', 'the failure reason travels');
A.eq(BA.runRows(null), [], 'runRows(null) is an empty list');
A.eq(BA.runRows([{}])[0].summary, '0 ran', 'a run with no actions summarises as nothing ran');

// ================================ hubLine: never overstate what the hub is doing ================================
const halted = BA.hubLine({ halted: true, ran: 42 });
A.eq(halted.state, 'stopped', 'a halted hub reports state "stopped"');
A.ok(/STOPPED/.test(halted.text), 'and the sentence says STOPPED');
A.ok(!/LISTENING/.test(halted.text), 'a halted hub NEVER claims to be listening');
A.eq(halted.cls, 'ba-bad', 'a halted hub is the bad state');
A.ok(!/so far/.test(halted.text),
  'a halted hub does not report a run count in the LIVE phrasing ("N runs so far") — it says what is happening now');

const live = BA.hubLine({ ran: 0 });
A.eq(live.state, 'live', 'a running hub reports state "live"');
A.ok(/LISTENING/.test(live.text), 'and says LISTENING');
A.ok(/no runs yet/.test(live.text), 'with no runs it says so rather than showing a bare 0');
A.eq(live.cls, 'ba-ok', 'a clean live hub is the ok state');

const warn = BA.hubLine({ ran: 3, autoDisabled: 1 });
A.eq(warn.cls, 'ba-warn', 'a hub where something switched itself off is the warn state, not ok');
A.ok(/1 switched itself off/.test(warn.text), 'and the sentence names it');

const skipped = BA.hubLine({ ran: 2, skippedCooldown: 4, skippedPaused: 1, skippedDepth: 2, stormStopped: 1 });
A.ok(/Skipped:/.test(skipped.text), 'skip reasons are reported in their own clause');
A.ok(/4 cooling down/.test(skipped.text), 'cooldown skips are named');
A.ok(/1 in a paused business/.test(skipped.text), 'paused-business skips are named');
A.ok(/2 past the cascade depth limit/.test(skipped.text), 'depth skips are named');
A.ok(/1 pass\(es\) hit the safety cap/.test(skipped.text), 'storm-cap stops are named');

const one = BA.hubLine({ ran: 1, approvalsRequested: 1 });
A.ok(/1 run so far/.test(one.text), 'a single run is not pluralised');
A.ok(/1 approval request\b/.test(one.text), 'a single approval request is not pluralised');
A.eq(BA.hubLine(null).state, 'live', 'a missing status object reads as live (nothing has said otherwise)');

// ================================ summarise ================================
const sum = BA.summarise([
  { enabled: true, autonomy: 'autonomous' }, { enabled: true, autonomy: 'approval' },
  { enabled: false, autonomy: 'autonomous' }, { enabled: false, autonomy: 'blocked' }
]);
A.eq(sum.total, 4, 'summarise counts every rule');
A.eq(sum.enabled, 2, 'and how many are switched on');
A.eq(sum.autonomous, 2, 'and how many WOULD run unattended (whether or not they are switched on)');
A.eq(sum.approval, 1, 'and how many would ask first');

// ================================ cooldownText ================================
A.eq(BA.cooldownText(0), 'no wait between runs', 'zero cooldown reads plainly');
A.eq(BA.cooldownText(null), 'no wait between runs', 'a missing cooldown reads as none');
A.eq(BA.cooldownText(500), 'at most once every 500ms', 'sub-second cooldowns read in ms');
A.eq(BA.cooldownText(30000), 'at most once every 30s', 'seconds');
A.eq(BA.cooldownText(300000), 'at most once every 5 min', 'minutes');
A.eq(BA.cooldownText(7200000), 'at most once every 2h', 'hours');

// ================================ the DOM half — source locks ================================
// it registers a LANE into the shared AUTOMATION window, not a second window of its own
A.ok(/AutomationWindow\.registerLane\(/.test(engine), 'the console registers a LANE, not a window');
A.ok(!/StationUI\.registerWindow\(/.test(engine), 'and it does NOT register a competing window slot');
A.ok(/registerLane/.test(win), 'the AUTOMATION window still exposes the lane registry this file uses');

// the three section ids the lane contributes (disjoint from rt-* and lp-*)
for (const id of ['automation', 'automation-build', 'automation-approvals']) {
  A.ok(new RegExp("id: '" + id + "'").test(engine), 'the lane declares the section id ' + id);
}
A.ok(!/id: 'rt-/.test(engine) && !/id: 'lp-/.test(engine),
  'the lane does not reuse the ROUTINES (rt-*) or LOOPS (lp-*) section ids');

// every section carries a label, glyph, desc and a build fn — the shape mountConsole consumes.
// NOTE: 'AutomationWindow.registerLane' appears in the file's HEADER COMMENT too, so the end of the slice
// must be searched from inside lane(), not from the top of the file (an early match yields an empty slice).
const laneAt = engine.indexOf('function lane(b)');
A.ok(laneAt >= 0, 'the file still declares lane(b)');
const laneFn = engine.slice(laneAt, engine.indexOf('AutomationWindow.registerLane', laneAt));
A.ok(laneFn.length > 0 && laneFn.length < engine.length, 'the lane slice is a real, bounded body');
A.ok(/label:/.test(laneFn) && /glyph:/.test(laneFn) && /desc:/.test(laneFn) && /build:/.test(laneFn),
  'each lane section carries label · glyph · desc · build');
A.ok(/wire: wire/.test(laneFn), 'the lane exposes a wire() the window calls after mount');

// the DOM half returns early under Node so the pure half is what a unit test loads
A.ok(/typeof document === 'undefined'/.test(engine), 'the DOM half is guarded so the pure half loads headless');
A.ok(/typeof StationUI === 'undefined'/.test(engine) && /typeof AutomationWindow === 'undefined'/.test(engine),
  'and it degrades to pure exports if StationUI/AutomationWindow are absent');

// the TWO glossary hints this console emits must both resolve
const hints = (engine.match(/data-hint="([a-z-]+)"/g) || []).map(s => s.replace(/.*"(.*)"/, '$1'));
A.ok(hints.length >= 2, 'the console emits at least two glossary hints');
for (const h of hints) {
  A.ok(new RegExp("(?:^|[\\s'{,])" + h + "\\s*:").test(glossary),
    'the data-hint "' + h + '" resolves in glossary.js (onboarding-legibility.test.js requires it)');
}

// no banned native dialogs (station-tooltip.test.js bans them), and ArmConfirm on the destructive control
A.ok(!/window\.(alert|confirm|prompt)\s*\(/.test(engine), 'no window.alert/confirm/prompt anywhere');
A.ok(!/\balert\s*\(|\bconfirm\s*\(|\bprompt\s*\(/.test(engine.replace(/ArmConfirm/g, '')), 'no bare alert/confirm/prompt either');
A.ok(/typeof ArmConfirm === 'undefined'/.test(engine), 'the destructive control checks for the ArmConfirm helper');
A.ok(/btn\.disabled = true/.test(engine), 'and FAILS CLOSED (disables) when the helper is absent');
A.ok(/arm\(e\.target/.test(engine), 'the DELETE control goes through arm(), i.e. the two-press path');

// the fetch helper is truthful about a non-JSON / failed response
A.ok(/r\.ok/.test(engine) && /r\.status/.test(engine), 'the request helper surfaces ok + status');
A.ok(/errText/.test(engine), 'and errors go through one errText helper that prefers the server message');
A.ok(/j\.error/.test(engine), 'errText prefers the server-provided error string');
A.ok(!/catch\s*\(\s*_\s*\)\s*\{\s*\}/.test(engine), 'no empty catch (_) — the fail-open ratchet bans it');

// ================================ index.html seams ================================
A.ok(/<link rel="stylesheet" href="css\/businessautomation\.css">/.test(html),
  'index.html links the Phase 5 stylesheet');
A.ok(/<script src="app\/businessautomation\.js"><\/script>/.test(html),
  'index.html loads the Phase 5 engine');

// load order: after the lane registry, after stationui, and before navdock (the window-slot block)
const at = (needle) => html.indexOf(needle);
A.ok(at('app/windows/automation.js') >= 0 && at('app/businessautomation.js') > at('app/windows/automation.js'),
  'businessautomation.js loads AFTER the lane registry it registers into');
A.ok(at('app/stationui.js') >= 0 && at('app/businessautomation.js') > at('app/stationui.js'),
  'and after stationui.js (the console uses StationUI.h)');
A.ok(at('app/businessautomation.js') < at('app/navdock.js'),
  'and inside the window/console block, before navdock');

// ================================ the stylesheet prefix is .ba- and NOTHING taken ================================
A.ok(/\.ba-/.test(css), 'the stylesheet declares .ba- rules');
for (const taken of ['bc', 'bm', 'mg']) {
  A.ok(!new RegExp('\\.' + taken + '-[a-z]').test(css),
    'the Phase 5 stylesheet does not use .' + taken + '- (owned by another console; both sheets are global)');
}
// and the engine's own class names stay inside .ba-
const engineClasses = (engine.match(/class="([^"]*)"/g) || []).join(' ').match(/\b[a-z]{2,3}-[a-z0-9-]+/g) || [];
const foreign = engineClasses.filter(c => !/^ba-/.test(c) && !/^bb$/.test(c));
A.eq(foreign, [], 'every prefixed class the engine writes is .ba- (bb is the shared button surface)');

// the sheet is themed through the shared vars, never a literal the themes cannot re-tint
A.ok(/var\(--ph/.test(css) && /var\(--bad\)/.test(css), 'the sheet paints through the phosphor theme vars');
A.ok(!/:\s*#[0-9a-fA-F]{3,6}\b/.test(css.replace(/color:\s*#000/g, '')),
  'no literal hex colours beyond the two #000 on-hover fills (which are the absence of paint)');

A.report('businessautomation');
