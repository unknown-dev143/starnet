'use strict';
/* test/business-automation-store.test.js — §12 the automation hub's RULE CATALOGUE (Business OS Phase 5).

   The load-bearing behaviours:
     · THE TRIGGER INVARIANT. Every trigger this store accepts must be (a) a KNOWN event in the frozen
       contract and (b) an event whose schema declares a `businessId`. (b) is what makes P6 possible at
       all — an event with no businessId cannot be scoped to a venture, so accepting one would let a rule
       fire on every business at once. The list is asserted against the LIVE contract, so it can never
       drift into naming a dead or unscopable event.
     · THE TIER IS DERIVED, NEVER DECLARED. A rule's §13 tier comes from its actions' permission classes.
       There is no field in which a rule could claim to be safe while performing a review-tier action, and
       a rule holding an unclassified action lands on `restricted` (fail-closed) and CANNOT be enabled.
     · TOTAL PREDICATES. Every condition op returns a boolean for any input and never throws. A missing
       field is false for every op except not_exists; a comparison against a non-number is false, not an
       error, because "cannot be evaluated" must not mean "matches".
     · FAILURE RECOVERY. Consecutive failures auto-disable a rule at the threshold, with the reason stored.
     · PERSIST-BEFORE-COMMIT. A throwing persist leaves memory untouched and returns ok:false.
     · P6. list/get/matching are business-scoped; an empty businessId is refused, never read as "all". */
const A = require('./_assert.js');
const M = require('../sidecar/business-automation-store.js');
const P = require('../sidecar/business-permissions.js');
const EVENTS = require('../shared/events.js');

const NOW = 1_700_000_000_000;
function mk(extra) {
  return M.makeBusinessAutomationStore(Object.assign({ records: [], runs: [], now: () => NOW, permissions: P }, extra || {}));
}
const SAFE = [{ action: 'notify', params: { text: 'hi' } }];
const REVIEW = [{ action: 'spend_money', params: { amount: '10', currency: 'USD', description: 'ads' } }];

/* ---------- THE TRIGGER INVARIANT: curated AND contract-verified AND business-scoped ---------- */
{
  A.ok(M.TRIGGER_EVENTS.length >= 30, 'the trigger list is substantial (' + M.TRIGGER_EVENTS.length + ')');
  const seen = new Set();
  for (const t of M.TRIGGER_EVENTS) {
    A.ok(!seen.has(t.event), 'trigger "' + t.event + '" appears once');
    seen.add(t.event);
    A.ok(EVENTS.isKnown(t.event), 'trigger "' + t.event + '" is a KNOWN event in the frozen contract');
    const schema = EVENTS.EVENTS[t.event];
    A.ok(!!(schema && schema.properties && schema.properties.businessId),
      'trigger "' + t.event + '" carries a businessId in its schema (else it could not be scoped, P6)');
    A.ok(!!t.label && !!t.note, 'trigger "' + t.event + '" has a human label and a note');
    A.ok(t.example && typeof t.example === 'object', 'trigger "' + t.event + '" carries a payload example for the condition builder');
  }
  // the two CURATED exclusions, asserted so the reasoning is enforced rather than remembered
  A.ok(M.TRIGGER_IDS.indexOf('business.activity') < 0, 'business.activity is NOT a trigger — it mirrors every other business event, so a rule on it would double-fire');
  A.ok(M.TRIGGER_IDS.indexOf('business.automation.ran') < 0, 'the hub\'s own telemetry is NOT a trigger — else an automation would fire on its own run');
  A.ok(M.TRIGGER_IDS.indexOf('business.approval.requested') < 0, 'a pending approval is NOT a trigger — else requesting approval would request approval');
  A.ok(M.TRIGGER_IDS.indexOf('opportunity.created') < 0, 'opportunity.created is NOT a trigger — it carries no businessId (the business does not exist yet)');
}

/* ---------- the action catalogue is closed, tiered and honest about execution ---------- */
{
  const seen = new Set();
  for (const a of M.AUTOMATION_ACTIONS) {
    A.ok(!seen.has(a.id), 'action "' + a.id + '" appears once');
    seen.add(a.id);
    const c = P.classify(a.perm);
    A.ok(c.ok, 'action "' + a.id + '" names a KNOWN permission action ("' + a.perm + '")');
    A.ok(P.TIERS.indexOf(c.tier) >= 0, 'action "' + a.id + '" resolves to a real §13 tier');
    A.ok(a.executor === 'local' || a.executor === 'none', 'action "' + a.id + '" declares whether this station can perform it');
    A.ok(!!a.label && !!a.note, 'action "' + a.id + '" has a label and a note');
    A.ok(Array.isArray(a.required) && a.required.length > 0, 'action "' + a.id + '" requires at least one param');
    A.ok(M.ACTION_IDS.indexOf('delete_data') < 0, 'no action maps to delete_data — an automation never deletes');
    A.ok(M.ACTION_IDS.indexOf('change_infra') < 0, 'no action maps to change_infra — an automation never touches infrastructure');
  }
  // the executor field is not decoration: the two external actions must say they have no rail.
  A.eq(M.actionById('send_external').executor, 'none', 'send_external has no local executor');
  A.eq(M.actionById('spend_money').executor, 'none', 'spend_money has no local executor');
  A.eq(M.actionById('publish_content').executor, 'local', 'publish_content DOES have a local executor (§17 advance with actor user)');
  for (const a of M.AUTOMATION_ACTIONS) {
    const c = P.classify(a.perm);
    if (c.tier === 'review') A.ok(P.RISKS.indexOf(a.risk) >= 0, 'review action "' + a.id + '" declares a §26 risk');
  }
}

/* ---------- the condition vocabulary ---------- */
{
  const ops = M.CONDITION_OPS.map(o => o.op);
  A.eq(ops.length, new Set(ops).size, 'every condition op appears once');
  for (const o of M.CONDITION_OPS) {
    A.ok(typeof o.needsValue === 'boolean', 'op "' + o.op + '" declares whether it needs a value');
    A.ok(!!o.label && !!o.note, 'op "' + o.op + '" has a label and a note');
  }
  A.ok(ops.indexOf('eq') >= 0 && ops.indexOf('gt') >= 0 && ops.indexOf('contains') >= 0, 'the expected ops are present');
}

/* ---------- testCondition is TOTAL and never throws ---------- */
{
  const p = { s: 'hello', n: 5, z: 0, arr: ['a', 'b'], t: true, nil: null, o: { k: 1 } };
  const cases = [
    [{ field: 's', op: 'eq', value: 'hello' }, true],
    [{ field: 's', op: 'eq', value: 'Hello' }, false],
    [{ field: 's', op: 'neq', value: 'x' }, true],
    [{ field: 'n', op: 'eq', value: 5 }, true],
    [{ field: 'n', op: 'eq', value: '5' }, false],        // a number and its string form are NOT equal
    [{ field: 's', op: 'in', value: ['hello', 'x'] }, true],
    [{ field: 's', op: 'in', value: ['x'] }, false],
    [{ field: 's', op: 'not_in', value: ['x'] }, true],
    [{ field: 'n', op: 'gt', value: 4 }, true],
    [{ field: 'n', op: 'gt', value: 5 }, false],
    [{ field: 'n', op: 'gte', value: 5 }, true],
    [{ field: 'n', op: 'lt', value: 6 }, true],
    [{ field: 'n', op: 'lte', value: 5 }, true],
    [{ field: 'z', op: 'exists' }, true],                  // 0 exists (falsy is not absent)
    [{ field: 'nil', op: 'exists' }, false],               // null is absent
    [{ field: 'nil', op: 'not_exists' }, true],
    [{ field: 'missing', op: 'not_exists' }, true],
    [{ field: 'missing', op: 'eq', value: 'x' }, false],
    [{ field: 'missing', op: 'neq', value: 'x' }, true],   // "is not x" is true of a thing that is not there
    [{ field: 's', op: 'contains', value: 'ELL' }, true],  // text contains is case-insensitive
    [{ field: 'arr', op: 'contains', value: 'b' }, true],  // list contains is membership
    [{ field: 'n', op: 'contains', value: '5' }, false],   // a number contains nothing
    [{ field: 't', op: 'contains', value: 'x' }, false]
  ];
  for (const [cond, want] of cases) A.eq(M.testCondition(cond, p), want, 'testCondition ' + JSON.stringify(cond));
  // the honesty guards on numeric comparison
  A.eq(M.testCondition({ field: 's', op: 'gt', value: 1 }, p), false, 'gt against a STRING payload value is false (no coercion)');
  A.eq(M.testCondition({ field: 'n', op: 'gt', value: '4' }, p), false, 'gt against a STRING rule value is false (no coercion)');
  A.eq(M.testCondition({ field: 'n', op: 'gt', value: NaN }, p), false, 'gt against NaN is false');
  A.eq(M.testCondition({ field: 'n', op: 'gt', value: Infinity }, p), false, 'gt against Infinity is false');
  // TOTAL: nothing below throws, whatever it is handed
  for (const bad of [null, undefined, {}, { field: '' }, { op: 'zzz' }, { field: 's', op: 'in', value: 'notalist' }, 42, 'x', []]) {
    A.notThrows(() => M.testCondition(bad, p), 'testCondition tolerates ' + JSON.stringify(bad));
  }
  A.eq(M.testCondition({ field: 's', op: 'eq', value: 'hello' }, null), false, 'testCondition against a null payload is false, not a throw');
  A.eq(M.testCondition({ field: 's', op: 'eq', value: 'hello' }, 'nope'), false, 'testCondition against a non-object payload is false');
  A.eq(M.testCondition({ field: 's', op: 'zzz', value: 1 }, p), false, 'an unknown op is false (fail-closed)');
}

/* ---------- evaluate: AND semantics, empty passes, and it says WHICH clause refused ---------- */
{
  const p = { stage: 'lead', amount: 12 };
  A.eq(M.evaluate([], p).pass, true, 'an empty condition list passes — "when X happens" is a complete rule');
  A.eq(M.evaluate([{ field: 'stage', op: 'eq', value: 'lead' }, { field: 'amount', op: 'gt', value: 100 }], p).pass, false, 'conditions are ANDed');
  const r = M.evaluate([{ field: 'stage', op: 'eq', value: 'lead' }, { field: 'amount', op: 'gt', value: 100 }], p);
  A.eq(r.results.length, 2, 'evaluate reports a row per condition');
  A.eq(r.results[0].ok, true, 'the first clause is reported as passing');
  A.eq(r.results[1].ok, false, 'the refusing clause is reported');
  A.eq(M.evaluate(null, p).pass, true, 'evaluate tolerates a null condition list');
}

/* ---------- interpolate ---------- */
{
  const p = { name: 'Dana', amount: 5, nested: { a: 1 }, nil: null };
  A.eq(M.interpolate('Follow up with {{name}}', p), 'Follow up with Dana', 'interpolate substitutes a field');
  A.eq(M.interpolate('{{name}} — {{amount}}', p), 'Dana — 5', 'interpolate substitutes numbers');
  A.eq(M.interpolate('x{{missing}}y', p), 'xy', 'an unknown field becomes EMPTY, never the literal braces');
  A.eq(M.interpolate('{{nil}}', p), '', 'a null field becomes empty');
  A.eq(M.interpolate('{{nested}}', p), '{"a":1}', 'an object field is JSON-encoded');
  A.eq(M.interpolate('no braces', p), 'no braces', 'a template with no braces is returned as-is');
  A.ok(M.interpolate('{{name}}', p).length <= M.MAX_PARAM_CHARS, 'interpolated output is capped');
  A.ok(M.interpolate('{{name}}'.repeat(500), p).length <= M.MAX_PARAM_CHARS, 'a runaway template cannot produce an unbounded string');
  A.eq(M.interpolate(null, p), '', 'a null template is empty');
}

/* ---------- resolveParams ---------- */
{
  A.eq(M.resolveParams('notify', { text: 'hi {{name}}' }, { name: 'D' }).params.text, 'hi D', 'resolveParams interpolates required params');
  A.eq(M.resolveParams('notify', {}, {}).ok, false, 'a missing required param is refused');
  A.eq(M.resolveParams('notify', { text: '   ' }, {}).ok, false, 'a whitespace-only required param is refused');
  A.eq(M.resolveParams('notify', { text: 'x', junk: 'y' }, {}).params.junk, undefined, 'an undeclared param is dropped, never passed through');
  A.eq(M.resolveParams('create_task', { title: 'T', priority: 'high' }, {}).params.priority, 'high', 'an optional param is kept when present');
  A.eq(M.resolveParams('create_task', { title: 'T' }, {}).params.priority, undefined, 'an omitted optional param is not invented');
  A.eq(M.resolveParams('bogus', { x: 1 }, {}).ok, false, 'an unknown action is refused');
}

/* ---------- validate* ---------- */
{
  A.eq(M.validateTrigger('').ok, false, 'an empty trigger is refused');
  A.eq(M.validateTrigger('nope.not.an.event').ok, false, 'an unknown trigger is refused');
  A.eq(M.validateTrigger('business.contact.added').trigger, 'business.contact.added', 'a curated trigger is accepted');

  A.eq(M.validateConditions([{ field: '', op: 'eq', value: 1 }]).ok, false, 'a condition with no field is refused');
  A.eq(M.validateConditions([{ field: 'a', op: 'zzz', value: 1 }]).ok, false, 'a condition with an unknown op is refused');
  A.eq(M.validateConditions([{ field: 'a', op: 'eq' }]).ok, false, 'a value-taking op with no value is refused');
  A.eq(M.validateConditions([{ field: 'a', op: 'in', value: 'x' }]).ok, false, 'in with a non-list value is refused');
  A.eq(M.validateConditions([{ field: 'a', op: 'exists' }]).ok, true, 'a value-free op needs no value');
  A.eq(M.validateConditions(new Array(M.MAX_CONDITIONS + 1).fill({ field: 'a', op: 'exists' })).ok, false, 'the condition cap is enforced');

  A.eq(M.validateActions([]).ok, false, 'an automation with no actions is refused — it would do nothing');
  A.eq(M.validateActions([{ action: 'nope', params: {} }]).ok, false, 'an unknown action is refused');
  A.eq(M.validateActions([{ action: 'notify', params: {} }]).ok, false, 'a missing required action param is refused');
  A.eq(M.validateActions([{ action: 'notify', params: { text: 'x' } }]).ok, true, 'a well-formed action is accepted');
  A.eq(M.validateActions(new Array(M.MAX_ACTIONS + 1).fill({ action: 'notify', params: { text: 'x' } })).ok, false, 'the action cap is enforced');
}

/* ---------- tier derivation: the tier is NEVER declared ---------- */
{
  A.eq(M.requiredTiers(SAFE, P).tiers, ['safe'], 'a safe action derives the safe tier');
  A.eq(M.requiredTiers(SAFE, P).autonomous, true, 'an all-safe rule is autonomous');
  A.eq(M.requiredTiers(REVIEW, P).tiers, ['review'], 'a review action derives the review tier');
  A.eq(M.requiredTiers(REVIEW, P).needsApproval, true, 'a review action needs approval');
  A.eq(M.requiredTiers(SAFE.concat(REVIEW), P).autonomous, false, 'a mixed rule is NOT autonomous');
  A.eq(M.requiredTiers([{ action: 'bogus' }], P).blocked, true, 'an unclassified action is blocked (fail-closed)');
  A.eq(M.requiredTiers([{ action: 'bogus' }], P).tiers, ['restricted'], 'an unclassified action lands on restricted');
  A.eq(M.requiredTiers([], P).tiers, [], 'no actions derives no tier');
  A.eq(M.autonomy({ actions: SAFE }, P), 'autonomous', 'autonomy(notify) is autonomous');
  A.eq(M.autonomy({ actions: REVIEW }, P), 'approval', 'autonomy(spend) is approval');
  A.eq(M.autonomy({ actions: [] }, P), 'blocked', 'autonomy with no actions is blocked');
  A.eq(M.autonomy({ actions: [{ action: 'bogus' }] }, P), 'blocked', 'autonomy with an unknown action is blocked');
}

/* ---------- create ---------- */
{
  const s = mk();
  A.eq(s.create('', { name: 'x', trigger: 'task.created', actions: SAFE }).ok, false, 'create refuses an empty businessId (P6)');
  A.eq(s.create('acme', { trigger: 'task.created', actions: SAFE }).ok, false, 'create refuses a blank name');
  A.eq(s.create('acme', { name: 'x', actions: SAFE }).ok, false, 'create refuses a missing trigger');
  A.eq(s.create('acme', { name: 'x', trigger: 'task.created' }).ok, false, 'create refuses missing actions');

  const r = s.create('acme', { name: 'Follow up', trigger: 'business.contact.added', conditions: [{ field: 'stage', op: 'eq', value: 'lead' }], actions: SAFE, enabled: true });
  A.eq(r.ok, true, 'a well-formed rule is created');
  A.ok(/^acme~a\d+$/.test(r.automation.id), 'the id is <businessId>~a<seq> (' + r.automation.id + ')');
  A.ok(r.automation.id.indexOf('#') < 0, "the id contains no '#' (a URL fragment delimiter would truncate it)");
  A.eq(r.automation.enabled, true, 'enabled:true is honoured for an all-safe rule');
  A.eq(r.automation.autonomy, 'autonomous', 'the created rule reports its derived autonomy');
  A.eq(r.automation.tiers, ['safe'], 'the created rule reports its derived tiers');
  A.eq(r.automation.consecutiveFailures, 0, 'a new rule starts with no failures');
  A.eq(r.automation.cooldownMs, M.DEFAULT_COOLDOWN_MS, 'the default cooldown applies when none is given');
  A.eq(s.get(r.automation.id).trigger, 'business.contact.added', 'the trigger round-trips');

  // a review-tier rule CAN be created and enabled — it produces approvals rather than running
  const rev = s.create('acme', { name: 'Spend', trigger: 'task.created', actions: REVIEW, enabled: true });
  A.eq(rev.ok, true, 'a review-tier rule can be created and enabled');
  A.eq(rev.automation.autonomy, 'approval', 'a review-tier rule reports approval autonomy');

  // a rule whose action is unclassified is blocked and CANNOT be enabled
  const bad = s.create('acme', { name: 'Bad', trigger: 'task.created', actions: [{ action: 'bogus', params: {} }], enabled: true });
  A.eq(bad.ok, false, 'a rule with an unclassified action is refused at the door (fail-closed)');

  A.eq(s.create('acme', { name: 'c', trigger: 'task.created', actions: SAFE, cooldownMs: -1 }).ok, false, 'a negative cooldown is refused');
  A.eq(s.create('acme', { name: 'c', trigger: 'task.created', actions: SAFE, cooldownMs: M.MAX_COOLDOWN_MS + 1 }).ok, false, 'an over-long cooldown is refused');
  A.eq(s.create('acme', { name: 'c', trigger: 'task.created', actions: SAFE, cooldownMs: 5000 }).automation.cooldownMs, 5000, 'a valid cooldown is stored');
}

/* ---------- P6: reads never leak across businesses ---------- */
{
  const s = mk();
  s.create('acme', { name: 'A', trigger: 'task.created', actions: SAFE });
  s.create('beta', { name: 'B', trigger: 'task.created', actions: SAFE });
  A.eq(s.list('acme').length, 1, 'list is scoped to one business');
  A.eq(s.list('beta').length, 1, 'the other business sees only its own');
  A.eq(s.list('').length, 0, 'an empty businessId lists NOTHING rather than everything');
  A.eq(s.count('acme'), 1, 'count is scoped');
  A.eq(s.count(''), 0, 'count of an empty businessId is 0');
  A.eq(s.matching('', 'task.created').length, 0, 'matching() with an empty businessId matches nothing');
  A.eq(s.clear('').ok, false, 'clear refuses an empty businessId');
  const ids = s.list('acme').map(r => r.id);
  s.clear('beta');
  A.eq(s.list('acme').length, 1, 'clearing one business leaves another untouched');
  A.ok(s.has(ids[0]), 'the surviving rule is still addressable');
}

/* ---------- matching + canFire + cooldown ---------- */
{
  const s = mk();
  const on = s.create('acme', { name: 'on', trigger: 'task.created', actions: SAFE, enabled: true, cooldownMs: 0 }).automation;
  const off = s.create('acme', { name: 'off', trigger: 'task.created', actions: SAFE, enabled: false }).automation;
  s.create('acme', { name: 'other', trigger: 'business.project.created', actions: SAFE, enabled: true });
  A.eq(s.matching('acme', 'task.created').length, 1, 'matching() returns only ENABLED rules for that exact trigger');
  A.eq(s.matching('acme', 'task.created')[0].id, on.id, 'and it is the enabled one');
  A.eq(s.matching('acme', 'business.project.created').length, 1, 'a different trigger matches its own rule');
  A.eq(s.matching('acme', 'no.such.event').length, 0, 'an unknown event matches nothing');
  A.eq(s.matching('beta', 'task.created').length, 0, 'another business matches nothing (P6)');

  A.eq(s.canFire(on.id, NOW).ok, true, 'an enabled rule past its cooldown may fire');
  A.eq(s.canFire(off.id, NOW).ok, false, 'a disabled rule may not fire');
  A.eq(s.canFire('nope', NOW).ok, false, 'an unknown rule may not fire');
  s.recordRun(on.id, { at: NOW, event: 'task.created', ok: true, actions: [] });
  A.eq(s.canFire(on.id, NOW + 1).ok, true, 'a rule with a ZERO cooldown may fire again immediately');
  A.eq(s.lastFiredAt(on.id), NOW, 'lastFiredAt reports the real last fire');
  A.eq(s.lastFiredAt(off.id), null, 'a rule that never fired reports null, not 0');

  // a real cooldown: the gate must actually hold
  const slow = s.create('acme', { name: 'slow', trigger: 'business.metric.recorded', actions: SAFE, enabled: true, cooldownMs: 60000 }).automation;
  A.eq(s.canFire(slow.id, NOW).ok, true, 'the slow rule may fire before it has ever run');
  s.recordRun(slow.id, { at: NOW, event: 'business.metric.recorded', ok: true, actions: [] });
  A.eq(s.canFire(slow.id, NOW + 1).ok, false, 'a rule inside its cooldown may not fire');
  A.ok(/cooling down/.test(s.canFire(slow.id, NOW + 1).reason), 'the cooldown refusal says how long is left');
  A.eq(s.canFire(slow.id, NOW + 59999).ok, false, 'still cooling down one millisecond before the end');
  A.eq(s.canFire(slow.id, NOW + 60000).ok, true, 'past the cooldown it may fire again');
}

/* ---------- the run log is bounded per rule ---------- */
{
  const s = mk({ runLimit: 3 });
  const r = s.create('acme', { name: 'x', trigger: 'task.created', actions: SAFE, enabled: true }).automation;
  for (let i = 0; i < 10; i++) s.recordRun(r.id, { at: NOW + i, event: 'task.created', ok: true, actions: [{ action: 'notify', tier: 'safe', status: 'executed', ok: true, reason: '' }] });
  A.eq(s.runsFor(r.id).length, 3, 'the per-rule run log is bounded (' + s.runsFor(r.id).length + ')');
  A.eq(s.runsFor(r.id)[0].at, NOW + 9, 'the log keeps the NEWEST runs, newest first');
  A.eq(s.get(r.id).fireCount, 10, 'fireCount counts every fire, not just the retained ones');
  A.eq(s.runsFor(r.id, 2).length, 2, 'runsFor honours a limit');
  A.eq(s.runsForBusiness('acme').length, 3, 'the business-wide log is the union of its rules\' retained rows');
  A.eq(s.runsForBusiness('beta').length, 0, 'and it is scoped (P6)');
  A.eq(s.runsFor('nope').length, 0, 'an unknown rule has no runs');
}

/* ---------- FAILURE RECOVERY: the auto-disable ---------- */
{
  const s = mk();
  const r = s.create('acme', { name: 'flaky', trigger: 'task.created', actions: SAFE, enabled: true }).automation;
  for (let i = 1; i < M.FAILURE_THRESHOLD; i++) {
    const o = s.recordRun(r.id, { at: NOW + i, event: 'task.created', ok: false, reason: 'boom', actions: [] });
    A.eq(o.autoDisabled, false, 'failure ' + i + ' does not auto-disable (threshold is ' + M.FAILURE_THRESHOLD + ')');
    A.eq(s.get(r.id).enabled, true, 'the rule is still enabled at failure ' + i);
  }
  const last = s.recordRun(r.id, { at: NOW + 99, event: 'task.created', ok: false, reason: 'boom', actions: [] });
  A.eq(last.autoDisabled, true, 'the threshold failure auto-disables the rule');
  A.eq(last.automation.enabled, false, 'the rule is now disabled');
  A.ok(/switched itself off/.test(last.automation.disabledReason), 'the auto-disable reason is stored, in words');
  A.eq(s.canFire(r.id, NOW + 999999).ok, false, 'an auto-disabled rule cannot fire');
  // a success resets the streak
  const s2 = mk();
  const r2 = s2.create('acme', { name: 'ok', trigger: 'task.created', actions: SAFE, enabled: true }).automation;
  s2.recordRun(r2.id, { at: NOW, event: 'task.created', ok: false, actions: [] });
  s2.recordRun(r2.id, { at: NOW + 1, event: 'task.created', ok: true, actions: [] });
  A.eq(s2.get(r2.id).consecutiveFailures, 0, 'a success resets the failure streak');
  // re-enabling clears the streak and the reason
  const on = s.setEnabled(r.id, true);
  A.eq(on.ok, true, 'a human can re-enable an auto-disabled rule');
  A.eq(on.automation.consecutiveFailures, 0, 're-enabling clears the failure streak');
  A.eq(on.automation.disabledReason, '', 're-enabling clears the auto-disable reason');
  A.eq(on.changed, true, 'the change is reported');
  A.eq(s.setEnabled(r.id, true).changed, false, 'a no-op toggle reports no change');
  // noteOutcome is the same threshold logic on its own path
  const s3 = mk();
  const r3 = s3.create('acme', { name: 'n', trigger: 'task.created', actions: SAFE, enabled: true }).automation;
  for (let i = 0; i < M.FAILURE_THRESHOLD; i++) s3.noteOutcome(r3.id, false);
  A.eq(s3.get(r3.id).enabled, false, 'noteOutcome auto-disables at the same threshold');
}

/* ---------- setEnabled refuses what cannot run ---------- */
{
  const s = mk();
  const blocked = { id: 'acme~aX', seq: 99, businessId: 'acme', name: 'b', trigger: 'task.created', conditions: [], actions: [{ action: 'bogus', params: {} }], enabled: false, cooldownMs: 0, disabledReason: '', consecutiveFailures: 0, fireCount: 0, createdAt: NOW, updatedAt: NOW };
  // inject a hand-edited row that bypassed create() — the enable gate must still hold
  const s2 = M.makeBusinessAutomationStore({ rules: [blocked], runs: [], now: () => NOW, permissions: P });
  const r = s2.setEnabled('acme~aX', true);
  A.eq(r.ok, false, 'a hand-edited rule holding an unclassified action CANNOT be enabled');
  A.ok(/restricted|cannot run/.test(r.reason), 'and the refusal says why');
  A.eq(s2.get('acme~aX').enabled, false, 'and the row was left switched off');
  A.eq(s.setEnabled('nope', true).ok, false, 'setEnabled refuses an unknown id');
  // the same gate on the CREATE path
  const s3 = M.makeBusinessAutomationStore({ rules: [], runs: [], now: () => NOW, permissions: P });
  A.eq(s3.create('acme', { name: 'b', trigger: 'task.created', actions: [{ action: 'bogus', params: {} }], enabled: true }).ok, false,
    'create refuses to ENABLE a rule holding an unclassified action');
  A.eq(s3.create('acme', { name: 'b', trigger: 'task.created', actions: [{ action: 'bogus', params: {} }], enabled: false }).ok, false,
    'and it refuses to create the row at all, so no dead rule is stored');
}

/* ---------- update ---------- */
{
  const s = mk();
  const a = s.create('acme', { name: 'x', trigger: 'task.created', actions: SAFE, enabled: true }).automation;
  A.eq(s.update(a.id, { name: 'renamed' }).automation.name, 'renamed', 'update renames');
  A.eq(s.update(a.id, { name: '  ' }).ok, false, 'update refuses a blank name');
  A.eq(s.update(a.id, { trigger: 'zzz' }).ok, false, 'update refuses an unknown trigger');
  A.eq(s.update(a.id, { conditions: [{ field: '', op: 'eq', value: 1 }] }).ok, false, 'update refuses a malformed condition');
  A.eq(s.update(a.id, { actions: [{ action: 'nope', params: {} }] }).ok, false, 'update refuses an unknown action');
  A.eq(s.update(a.id, { cooldownMs: 1234 }).automation.cooldownMs, 1234, 'update stores a new cooldown');
  const up = s.update(a.id, { name: 'again' }).automation;
  A.eq(up.id, a.id, 'update cannot change the id');
  A.eq(up.seq, a.seq, 'update cannot change the seq');
  A.eq(up.businessId, a.businessId, 'update cannot move a rule to another business (P6)');
  A.eq(up.createdAt, a.createdAt, 'update cannot change createdAt');
  A.eq(up.enabled, true, 'update does not silently toggle the switch');
  A.eq(s.update('nope', { name: 'x' }).ok, false, 'update refuses an unknown id');
}

/* ---------- the per-business cap drops the OLDEST and takes their runs with them ---------- */
{
  const s = mk({ limit: 2 });
  const first = s.create('acme', { name: '1', trigger: 'task.created', actions: SAFE }).automation;
  s.recordRun(first.id, { at: NOW, event: 'task.created', ok: true, actions: [] });
  s.create('acme', { name: '2', trigger: 'task.created', actions: SAFE });
  s.create('acme', { name: '3', trigger: 'task.created', actions: SAFE });
  A.eq(s.count('acme'), 2, 'the cap holds');
  A.eq(s.has(first.id), false, 'the OLDEST rule was dropped');
  A.eq(s.runsFor(first.id).length, 0, 'the dropped rule\'s run rows went with it (no orphaned log rows)');
  A.eq(s.list('acme').map(r => r.name), ['2', '3'], 'the two newest survive, in order');
}

/* ---------- summary ---------- */
{
  const s = mk();
  s.create('acme', { name: 'a', trigger: 'task.created', actions: SAFE, enabled: true });
  s.create('acme', { name: 'b', trigger: 'task.created', actions: REVIEW, enabled: true });
  s.create('acme', { name: 'c', trigger: 'business.project.created', actions: SAFE, enabled: false });
  const sum = s.summary('acme');
  A.eq(sum.total, 3, 'summary counts every rule');
  A.eq(sum.enabled, 2, 'summary counts enabled');
  A.eq(sum.disabled, 1, 'summary counts disabled');
  A.eq(sum.autonomous, 2, 'summary counts rules that WOULD run unattended — including a switched-off one');
  A.eq(sum.needsApproval, 1, 'summary counts rules that will need approval');
  A.eq(sum.byTrigger['task.created'], 2, 'summary groups by trigger');
  A.eq(s.summary('').total, 0, 'summary of an empty businessId is empty (P6)');
}

/* ---------- PERSIST-BEFORE-COMMIT (fail-closed) ---------- */
{
  let saved = null;
  const s = M.makeBusinessAutomationStore({ records: [], runs: [], now: () => NOW, permissions: P, persist: snap => { saved = snap; } });
  const a = s.create('acme', { name: 'x', trigger: 'task.created', actions: SAFE, enabled: true });
  A.eq(a.ok, true, 'a working persist commits');
  A.ok(saved && saved.rules && saved.rules.length === 1, 'the persist sink received a { rules, runs } snapshot');
  A.ok(Array.isArray(saved.runs), 'the snapshot carries BOTH row families');

  const s2 = M.makeBusinessAutomationStore({ records: [], runs: [], now: () => NOW, permissions: P, persist: () => { throw new Error('disk full'); } });
  const bad = s2.create('acme', { name: 'x', trigger: 'task.created', actions: SAFE, enabled: true });
  A.eq(bad.ok, false, 'a throwing persist fails the write');
  A.ok(/persist/.test(bad.reason), 'and the reason says the write failed');
  A.eq(s2.count('acme'), 0, 'memory is UNTOUCHED — the rule was not committed');
  A.eq(s2.list('acme').length, 0, 'and it is not readable');
}

/* ---------- remove / clear ---------- */
{
  const s = mk();
  const a = s.create('acme', { name: 'x', trigger: 'task.created', actions: SAFE }).automation;
  s.recordRun(a.id, { at: NOW, event: 'task.created', ok: true, actions: [] });
  const r = s.remove(a.id);
  A.eq(r.ok, true, 'remove succeeds');
  A.eq(r.removed, 1, 'remove reports what it removed');
  A.eq(s.has(a.id), false, 'the rule is gone');
  A.eq(s.runsFor(a.id).length, 0, 'its run rows are gone too');
  A.eq(s.remove(a.id).removed, 0, 'removing again is a harmless no-op');
}

A.report('business-automation-store.test');
