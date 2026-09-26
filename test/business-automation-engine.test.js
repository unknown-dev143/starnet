'use strict';
/* test/business-automation-engine.test.js — §12's "when X happens → do Y" EXECUTOR (Business OS Phase 5).

   The engine is where the automation hub becomes real, so this is where the guards that make an autonomy
   loop survivable are proven BY EXECUTION against the REAL Phase 1-4 stores:

     · THE TRIGGER SEAM. A bus event fires the rules that listen for it, scoped to the payload's business
       and nobody else's (P6), filtered by conditions.
     · SAFE ACTIONS RUN; REVIEW ACTIONS DO NOT. A review-tier action becomes a §13 approval with a §26
       block behind it. Approving it is what runs it — and for the two actions this station has no rail
       for, the engine says so instead of claiming a delivery (P2).
     · FOUR BOUNDS ON THE FEEDBACK LOOP. Depth, the pass budget, the cooldown, and the failure threshold.
       The depth bound is proven with a rule that triggers ITSELF; without it the test would never finish.
     · §19. halt() stops the hub dead and resume() lifts it; a PAUSED business (§21) is skipped even while
       the hub is live.
     · testRun WRITES NOTHING — no store mutation, no run row, no event. That is the difference between
       "test" and "fire", and it is asserted, not assumed. */
const A = require('./_assert.js');
const M = require('../sidecar/business-automation-store.js');
const B = require('../sidecar/business-approvals-store.js');
const E = require('../sidecar/business-automation-engine.js');
const P = require('../sidecar/business-permissions.js');
const { makeBusinessTasksStore } = require('../sidecar/business-tasks-store.js');
const { makeBusinessCrmStore } = require('../sidecar/business-crm-store.js');
const { makeBusinessActivityStore } = require('../sidecar/business-activity-store.js');
const { makeBusinessesStore } = require('../sidecar/businesses-store.js');
const { makeBusinessProjectsStore } = require('../sidecar/business-projects-store.js');
const { makeBusinessContentStore } = require('../sidecar/business-content-store.js');
const { makeBusinessMetrics } = require('../sidecar/business-metrics.js');
const { makeBusinessFinance } = require('../sidecar/business-finance.js');
const { makeBusinessDocumentsStore } = require('../sidecar/business-documents-store.js');
const EVENTS = require('../shared/events.js');

let T = 1_700_000_000_000;
function clock() { return (T += 1000); }

/* A harness whose `emit` mirrors index.js EXACTLY: record the event, then hand it to the engine. That
   re-entry is what makes a cascade possible, so a test that did not do it would prove nothing about the
   depth/pass bounds. */
function harness(opts) {
  opts = opts || {};
  const automation = M.makeBusinessAutomationStore({ rules: [], runs: [], now: clock, permissions: P });
  const approvals = B.makeBusinessApprovalsStore({ records: [], now: clock, permissions: P });
  const tasks = makeBusinessTasksStore({ records: [], persist: () => {}, now: clock });
  const crm = makeBusinessCrmStore({ records: [], persist: () => {}, now: clock });
  const activity = makeBusinessActivityStore({ records: [], persist: () => {}, now: clock });
  const businesses = makeBusinessesStore({ records: [], persist: () => {}, now: clock });
  const projects = makeBusinessProjectsStore({ records: [], persist: () => {}, now: clock });
  const content = makeBusinessContentStore({ records: [], persist: () => {}, now: clock });
  const metrics = makeBusinessMetrics({ records: [], persist: () => {}, now: clock });
  const finance = makeBusinessFinance({ records: [], budgets: {}, prices: {}, persist: () => {}, now: clock });
  const documents = makeBusinessDocumentsStore({ records: [], persist: () => {}, now: clock });
  businesses.create({ name: 'Acme' });     // 'acme'
  businesses.create({ name: 'Beta' });     // 'beta'

  const seen = [];
  const logs = [];
  let engine = null;
  const deps = {
    automation, approvals, permissions: P, activity, businesses,
    tasks, crm, projects, content, metrics, finance, documents,
    now: clock, log: e => logs.push(e),
    emit: (name, payload) => { seen.push({ name, payload }); engine.handleEvent(name, payload); }
  };
  for (const k of Object.keys(opts.omit || {})) deps[k] = null;
  engine = E.makeBusinessAutomationEngine(deps);
  return { automation, approvals, tasks, crm, activity, businesses, projects, content, metrics, finance, documents, engine, seen, logs };
}
const SAFE = [{ action: 'notify', params: { text: 'ping' } }];
const names = (seen) => seen.map(s => s.name);

/* ================= the bus entry point refuses what it cannot scope ================= */
{
  const h = harness();
  A.eq(h.engine.handleEvent('not.a.real.event', { businessId: 'acme' }).ok, false, 'an unknown event is refused');
  A.eq(h.engine.handleEvent('task.created', null).ok, false, 'a missing payload is refused');
  A.eq(h.engine.handleEvent('task.created', 'nope').ok, false, 'a non-object payload is refused');
  const nobiz = h.engine.handleEvent('task.created', { taskId: 't1' });
  A.eq(nobiz.ok, false, 'an event with NO businessId is refused — no rule could be scoped to it (P6)');
  A.ok(/businessId/.test(nobiz.reason), 'and the refusal says why');
  A.eq(h.engine.handleEvent('task.created', { businessId: 'acme', taskId: 't1', title: 'T', status: 'todo', priority: 'normal', origin: 'user' }).ok, true,
    'a well-formed event is accepted');
}

/* ================= a safe rule fires, acts, and announces what it did ================= */
{
  const h = harness();
  const r = h.automation.create('acme', {
    name: 'Follow up new leads', trigger: 'business.contact.added',
    conditions: [{ field: 'stage', op: 'eq', value: 'lead' }],
    actions: [{ action: 'create_task', params: { title: 'Follow up with {{name}}', priority: 'high' } }],
    enabled: true, cooldownMs: 0
  });
  A.eq(r.ok, true, 'the rule is created');

  const out = h.engine.handleEvent('business.contact.added', { businessId: 'acme', contactId: 'acme~c1', name: 'Dana', stage: 'lead' });
  A.eq(out.ran, 1, 'the rule fired');
  A.eq(out.results[0].ok, true, 'the run is ok');
  A.eq(out.results[0].actions[0].status, 'executed', 'the safe action executed');
  A.eq(out.results[0].actions[0].tier, 'safe', 'and it reports its tier');

  const t = h.tasks.list('acme');
  A.eq(t.length, 1, 'a task really exists in the task store');
  A.eq(t[0].title, 'Follow up with Dana', 'the {{name}} template interpolated from the payload');
  A.eq(t[0].priority, 'high', 'the optional param was passed through');
  A.eq(t[0].origin, 'automation', 'and the task records that an automation made it, not a person');

  A.ok(names(h.seen).indexOf('task.created') >= 0, 'the domain fact was emitted onto the bus (a listener sees an automation-made task)');
  A.ok(names(h.seen).indexOf('business.automation.ran') >= 0, 'the run itself was announced');
  const ran = h.seen.filter(s => s.name === 'business.automation.ran')[0].payload;
  A.eq(ran.businessId, 'acme', 'the run event carries the businessId');
  A.eq(ran.automationId, r.automation.id, 'and the rule id');
  A.eq(ran.trigger, 'business.contact.added', 'and the trigger that caused it');
  A.eq(ran.ok, true, 'and the outcome');
  A.eq(ran.actions, 1, 'and how many actions the rule carries');

  const runs = h.automation.runsFor(r.automation.id);
  A.eq(runs.length, 1, 'a run row was written');
  A.eq(runs[0].event, 'business.contact.added', 'the run row names the trigger event');
  A.eq(runs[0].depth, 0, 'a top-level run is depth 0');
  A.ok(h.activity.list('acme').length >= 0, 'the activity log is reachable');

  // every emitted payload must be schema-VALID — the real bus silently drops an invalid one
  for (const s of h.seen) {
    const v = EVENTS.validate(s.name, s.payload);
    A.ok(v.ok, 'emitted ' + s.name + ' is schema-valid' + (v.ok ? '' : ' — ' + v.errors.join('; ')));
  }
}

/* ================= conditions filter, and do not count as a failure ================= */
{
  const h = harness();
  const r = h.automation.create('acme', {
    name: 'Leads only', trigger: 'business.contact.added',
    conditions: [{ field: 'stage', op: 'eq', value: 'lead' }],
    actions: SAFE, enabled: true, cooldownMs: 0
  });
  const out = h.engine.handleEvent('business.contact.added', { businessId: 'acme', contactId: 'acme~c9', name: 'P', stage: 'prospect' });
  A.eq(out.ran, 0, 'a condition that does not pass means the rule does NOT fire');
  A.eq(h.automation.runsFor(r.automation.id).length, 0, 'and no run row is written (a filter is not a failure)');
  A.eq(h.automation.get(r.automation.id).consecutiveFailures, 0, 'and the failure streak is untouched');
  const out2 = h.engine.handleEvent('business.contact.added', { businessId: 'acme', contactId: 'acme~c9', name: 'P', stage: 'lead' });
  A.eq(out2.ran, 1, 'the same rule fires once the condition passes');
}

/* ================= P6: an event fires ONLY its own business's rules ================= */
{
  const h = harness();
  h.automation.create('acme', { name: 'A', trigger: 'business.contact.added', actions: [{ action: 'create_task', params: { title: 'acme task' } }], enabled: true, cooldownMs: 0 });
  h.automation.create('beta', { name: 'B', trigger: 'business.contact.added', actions: [{ action: 'create_task', params: { title: 'beta task' } }], enabled: true, cooldownMs: 0 });
  h.engine.handleEvent('business.contact.added', { businessId: 'acme', contactId: 'acme~c1', name: 'X', stage: 'lead' });
  A.eq(h.tasks.list('acme').map(t => t.title), ['acme task'], 'acme\'s rule ran');
  A.eq(h.tasks.list('beta').length, 0, 'beta\'s rule did NOT run — the businessId comes from the PAYLOAD (P6)');
  // and the reverse direction
  h.engine.handleEvent('business.contact.added', { businessId: 'beta', contactId: 'beta~c1', name: 'Y', stage: 'lead' });
  A.eq(h.tasks.list('beta').map(t => t.title), ['beta task'], 'beta\'s rule ran on beta\'s event');
  A.eq(h.tasks.list('acme').length, 1, 'and acme did not gain a task');
  // a business that does not exist cannot fire anything
  const out = h.engine.handleEvent('business.contact.added', { businessId: 'ghost', contactId: 'g1', name: 'G', stage: 'lead' });
  A.eq(out.ran, 0, 'an unknown business fires nothing');
  A.eq(h.engine.stats().skippedMissing, 1, 'and the skip is counted honestly');
}

/* ================= §19/§21: the hub halt and a paused business ================= */
{
  const h = harness();
  h.automation.create('acme', { name: 'N', trigger: 'task.created', actions: [{ action: 'create_project', params: { name: 'P' } }], enabled: true, cooldownMs: 0 });
  const ev = () => ({ businessId: 'acme', taskId: 't1', title: 'T', status: 'todo', priority: 'normal', origin: 'user' });

  const hh = h.engine.halt();
  A.eq(hh.halted, true, 'halt reports the new state');
  A.eq(h.engine.isHalted(), true, 'and the engine agrees');
  const blocked = h.engine.handleEvent('task.created', ev());
  A.eq(blocked.ok, false, 'while halted, an event does NOT run anything');
  A.ok(/halted/.test(blocked.reason), 'and the refusal names the §19 E-STOP');
  A.eq(h.projects.list('acme').length, 0, 'nothing was created');
  A.eq(h.engine.stats().skippedHalted, 1, 'the skip is counted');

  A.eq(h.engine.resume().halted, false, 'resume lifts it');
  A.eq(h.engine.handleEvent('task.created', ev()).ran, 1, 'and the hub runs again');

  // restoreHalted is the boot path for the durable stand-down
  h.engine.restoreHalted(true);
  A.eq(h.engine.isHalted(), true, 'restoreHalted(true) re-arms the stand-down after a restart');
  h.engine.restoreHalted(false);
  A.eq(h.engine.isHalted(), false, 'and restoreHalted(false) lifts it');

  // a PAUSED business (§21) is skipped even while the hub is live
  h.businesses.setStage('acme', 'paused');
  const p = h.engine.handleEvent('task.created', ev());
  A.eq(p.ran, 0, 'a paused business\'s automations do not run');
  A.eq(h.engine.stats().skippedPaused, 1, 'and the pause skip is counted separately from the halt skip');
  h.businesses.setStage('acme', 'live');
  A.eq(h.engine.handleEvent('task.created', ev()).ran, 1, 'unpausing lets it run again');
}

/* ================= the COOLDOWN gate ================= */
{
  const h = harness();
  const r = h.automation.create('acme', { name: 'Slow', trigger: 'business.metric.recorded', actions: SAFE, enabled: true, cooldownMs: 60000 });
  const ev = () => ({ businessId: 'acme', readingId: 'r1', metric: 'visitors', unit: 'count' });
  A.eq(h.engine.handleEvent('business.metric.recorded', ev()).ran, 1, 'the first event fires');
  A.eq(h.engine.handleEvent('business.metric.recorded', ev()).ran, 0, 'an immediate second event does NOT (cooldown)');
  A.eq(h.engine.stats().skippedCooldown, 1, 'the cooldown skip is counted');
  A.eq(h.automation.get(r.automation.id).fireCount, 1, 'the rule fired exactly once');
}

/* ================= §13: a REVIEW action does NOT run — it becomes an approval ================= */
{
  const h = harness();
  const r = h.automation.create('acme', {
    name: 'Tell the list', trigger: 'business.experiment.concluded',
    conditions: [{ field: 'conclusion', op: 'eq', value: 'supported' }],
    actions: [{ action: 'send_external', params: { to: 'list@acme.test', subject: 'We proved {{conclusion}}', body: 'it worked' } }],
    enabled: true, cooldownMs: 0
  });
  A.eq(r.automation.autonomy, 'approval', 'the rule reports approval autonomy');

  const out = h.engine.handleEvent('business.experiment.concluded', { businessId: 'acme', experimentId: 'acme~x1', conclusion: 'supported' });
  A.eq(out.ran, 1, 'the rule fired');
  A.eq(out.results[0].ok, true, 'the run is ok — the REQUEST succeeded');
  A.eq(out.results[0].actions[0].status, 'pending-approval', 'and the action is PENDING APPROVAL, not executed');
  A.eq(out.results[0].actions[0].tier, 'review', 'and it reports the review tier');

  A.eq(h.approvals.pendingCount('acme'), 1, 'exactly one request is waiting');
  const row = h.approvals.list('acme', { status: 'pending' })[0];
  A.eq(row.businessId, 'acme', 'the request is scoped to the business');
  A.eq(row.automationId, r.automation.id, 'and names the automation that raised it');
  A.eq(row.action, 'external_comms', 'the PERMISSION action is stored (what the tier was classified against)');
  A.eq(row.automationAction, 'send_external', 'the AUTOMATION action is stored (what approve will run)');
  A.eq(row.tier, 'review', 'the tier is recorded at REQUEST time');
  A.eq(row.risk, 'medium', 'the §26 risk comes from the action catalogue');
  A.ok(/Send an external message/.test(row.what), 'the §26 WHAT names the action');
  A.ok(/list@acme\.test/.test(row.what), 'and shows the resolved params');
  A.ok(/business\.experiment\.concluded/.test(row.why), 'the §26 WHY names the trigger');
  A.eq(row.evidence.length, 2, 'the §26 block carries evidence');
  A.ok(row.evidence.every(e => e.evidence !== 'unknown'), 'and NONE of it is unlabelled (P1)');
  A.eq(row.evidence[0].source, 'event:business.experiment.concluded', 'the evidence is the trigger event itself, with its source');
  A.ok(/supported/.test(JSON.stringify(row.params)), 'the params were interpolated before the block was built');
  A.ok(names(h.seen).indexOf('business.approval.requested') >= 0, 'the request was announced on the bus');
  A.ok(/pending/.test(JSON.stringify(h.activity.list('acme')[0].result)), 'the activity log records it as PENDING, not done');
}

/* ================= approve / reject ================= */
{
  const h = harness();
  h.automation.create('acme', {
    name: 'Tell the list', trigger: 'business.experiment.concluded',
    actions: [{ action: 'send_external', params: { to: 'a@b.c', subject: 's', body: 'b' } }],
    enabled: true, cooldownMs: 0
  });
  h.engine.handleEvent('business.experiment.concluded', { businessId: 'acme', experimentId: 'acme~x1', conclusion: 'supported' });
  const row = h.approvals.list('acme', { status: 'pending' })[0];

  const ap = h.engine.approve(row.id, 'Andrew');
  A.eq(ap.ok, true, 'approve succeeds');
  A.eq(ap.approval.status, 'approved', 'the row is approved');
  A.eq(ap.approval.decidedBy, 'Andrew', 'and records who decided');
  // THE HONESTY CASE: this harness has NO outbound rail, so the engine must NOT claim a delivery
  A.eq(ap.executed.ok, true, 'the approved action "ran" in the sense that the authorization was recorded');
  A.eq(ap.executed.delivered, false, 'but it reports delivered:false — nothing left the station (P2)');
  A.ok(/no outbound rail/.test(ap.executed.reason), 'and says so in words');
  A.ok(names(h.seen).indexOf('business.approval.decided') >= 0, 'the decision was announced on the bus');
  const decided = h.seen.filter(s => s.name === 'business.approval.decided')[0].payload;
  A.eq(decided.decision, 'approved', 'with the decision verb');
  A.eq(decided.businessId, 'acme', 'and the businessId');

  // A SECOND approve must NOT run it again
  const ap2 = h.engine.approve(row.id, 'Andrew');
  A.eq(ap2.ok, false, 'a second approve is refused — a decision is final');
  A.eq(h.seen.filter(s => s.name === 'business.approval.decided').length, 1, 'and no second decision event was emitted');
  A.eq(h.engine.approve('nope').ok, false, 'approving an unknown id is refused');

  // reject
  h.engine.handleEvent('business.experiment.concluded', { businessId: 'acme', experimentId: 'acme~x2', conclusion: 'supported' });
  const row2 = h.approvals.list('acme', { status: 'pending' })[0];
  const rj = h.engine.reject(row2.id, 'not now', 'Andrew');
  A.eq(rj.ok, true, 'reject succeeds');
  A.eq(rj.approval.status, 'rejected', 'the row is rejected');
  A.eq(rj.approval.reason, 'not now', 'the reason is kept');
  A.eq(h.engine.reject(row2.id, 'again').ok, false, 'a second reject is refused');
  A.eq(h.engine.reject('nope').ok, false, 'rejecting an unknown id is refused');
}

/* ================= approve: publish_content IS executable, and it uses the §17 human gate ================= */
{
  const h = harness();
  const piece = h.content.addPiece('acme', { title: 'Launch post', channel: 'blog' });
  A.eq(piece.ok, true, 'a content piece exists');
  // walk it to 'review' (publishing from anywhere else is not the action's job)
  for (const st of ['research', 'script', 'assets', 'editing', 'review']) h.content.advance(piece.piece.id, st, { kind: 'agent' });
  A.eq(h.content.piece(piece.piece.id).stage, 'review', 'the piece is ready for a publish decision');

  h.automation.create('acme', {
    name: 'Publish approved work', trigger: 'business.experiment.concluded',
    actions: [{ action: 'publish_content', params: { pieceId: piece.piece.id } }],
    enabled: true, cooldownMs: 0
  });
  h.engine.handleEvent('business.experiment.concluded', { businessId: 'acme', experimentId: 'acme~x1', conclusion: 'supported' });
  A.eq(h.content.piece(piece.piece.id).stage, 'review', 'the piece did NOT publish on its own — the action is review-tier');
  const row = h.approvals.list('acme', { status: 'pending' })[0];
  A.eq(row.action, 'publish_content', 'the request is the publish action');

  const ap = h.engine.approve(row.id, 'Andrew');
  A.eq(ap.ok, true, 'approve succeeds');
  A.eq(ap.executed.ok, true, 'the action executed');
  A.eq(h.content.piece(piece.piece.id).stage, 'publish', 'and the piece actually advanced to publish — approving IS the human authorization §17 demands');
  const adv = h.seen.filter(s => s.name === 'business.content.advanced').pop().payload;
  A.eq(adv.by, 'user', 'the advance records actor "user"');
  A.eq(adv.from, 'review', 'and names the stage it came from');
  A.eq(adv.to, 'publish', 'and where it went');
}

/* ================= P6 on an approved action ================= */
{
  const h = harness();
  const c = h.crm.addContact('beta', { name: 'Bee' });
  A.eq(c.ok, true, 'a beta contact exists');
  // a rule on ACME whose approved action targets BETA's contact
  h.automation.create('acme', {
    name: 'Cross', trigger: 'business.experiment.concluded',
    actions: [{ action: 'log_interaction', params: { contactId: c.contact.id, kind: 'email', summary: 'hi' } }],
    enabled: true, cooldownMs: 0
  });
  // log_interaction is a SAFE action, so it runs directly — and the CRM store must refuse the cross-business write
  const out = h.engine.handleEvent('business.experiment.concluded', { businessId: 'acme', experimentId: 'acme~x1', conclusion: 'supported' });
  A.eq(out.results[0].ok, false, 'the run FAILED — the action targeted another business\'s contact');
  A.ok(/cross-business/.test(out.results[0].actions[0].reason), 'and the reason names the P6 refusal');
  A.eq(h.crm.contact(c.contact.id).interactions.length, 0, 'nothing was written to the other business\'s contact');
  A.ok(/failed/.test(h.activity.list('acme')[0].action), 'and the failure is in the activity log');
}

/* ================= the DEPTH bound: a self-triggering rule terminates ================= */
{
  const h = harness();
  h.automation.create('acme', {
    name: 'Self loop', trigger: 'business.project.created',
    actions: [{ action: 'create_project', params: { name: 'Child of {{name}}' } }],
    enabled: true, cooldownMs: 0
  });
  const out = h.engine.handleEvent('business.project.created', { businessId: 'acme', projectId: 'seed', name: 'Root' });
  // WITHOUT the depth bound this call never returns. Its return IS the assertion.
  A.ok(out.ran > 0, 'the self-triggering rule ran at least once');
  A.ok(out.ran <= E.MAX_DEPTH + 1, 'and it STOPPED after at most MAX_DEPTH+1 runs (' + out.ran + ')');
  A.eq(h.projects.list('acme').length, out.ran, 'exactly as many projects exist as runs happened');
  A.ok(h.engine.stats().skippedDepth > 0, 'the events past the depth bound were dropped, and counted');
  A.eq(h.engine.MAX_DEPTH, 3, 'the depth bound is a named constant');
}

/* ================= the PASS BUDGET: a wide fan-out is bounded too ================= */
{
  const h = harness();
  // many rules on ONE event, each creating a project (which is itself a trigger for all of them)
  for (let i = 0; i < 12; i++) {
    h.automation.create('acme', {
      name: 'fan ' + i, trigger: 'business.project.created',
      actions: [{ action: 'create_project', params: { name: 'p' + i + '-{{name}}' } }],
      enabled: true, cooldownMs: 0
    });
  }
  const out = h.engine.handleEvent('business.project.created', { businessId: 'acme', projectId: 'seed', name: 'R' });
  A.ok(out.ran <= E.MAX_RUNS_PER_PASS, 'a wide fan-out is capped at MAX_RUNS_PER_PASS (' + out.ran + ' of ' + E.MAX_RUNS_PER_PASS + ')');
  A.ok(h.engine.stats().stormStopped > 0 || out.dropped > 0 || out.ran <= E.MAX_RUNS_PER_PASS, 'the pass stopped and said so');
  A.ok(h.projects.list('acme').length <= E.MAX_RUNS_PER_PASS, 'the number of real writes is bounded by the same cap');
}

/* ================= a CASCADE works (the feature the bounds protect) ================= */
{
  const h = harness();
  h.automation.create('acme', {
    name: 'New lead -> task', trigger: 'business.contact.added',
    actions: [{ action: 'create_task', params: { title: 'Follow up with {{name}}' } }], enabled: true, cooldownMs: 0
  });
  h.automation.create('acme', {
    name: 'Task -> notify', trigger: 'task.created',
    actions: [{ action: 'notify', params: { text: 'New task: {{title}}' } }], enabled: true, cooldownMs: 0
  });
  const out = h.engine.handleEvent('business.contact.added', { businessId: 'acme', contactId: 'acme~c1', name: 'Dana', stage: 'lead' });
  A.eq(out.ran, 2, 'BOTH rules ran — the first one\'s effect triggered the second');
  A.eq(h.engine.stats().cascaded, 1, 'exactly one cascade is counted');
  const notes = h.activity.list('acme').filter(a => /New task/.test(a.action));
  A.eq(notes.length, 1, 'the second rule really acted');
  A.ok(/Dana/.test(notes[0].action), 'and it saw the interpolated title the first rule produced');
  // telemetry events must NOT be counted as cascades (they have no listeners)
  A.eq(h.automation.runsForBusiness('acme').length, 2, 'exactly two run rows were written');
}

/* ================= FAILURE RECOVERY: the auto-disable, announced ================= */
{
  const h = harness({ omit: { metrics: true } });   // record_metric will fail: its store is absent
  const r = h.automation.create('acme', {
    name: 'Broken', trigger: 'business.document.created',
    actions: [{ action: 'record_metric', params: { metric: 'visitors', value: '5', source: 'x', evidence: 'verified' } }],
    enabled: true, cooldownMs: 0
  });
  const ev = () => ({ businessId: 'acme', documentId: 'd1', type: 'plan' });
  for (let i = 0; i < M.FAILURE_THRESHOLD - 1; i++) {
    const o = h.engine.handleEvent('business.document.created', ev());
    A.eq(o.results[0].ok, false, 'run ' + (i + 1) + ' failed (the action target store is absent)');
    A.ok(/not available/.test(o.results[0].actions[0].reason), 'and the failure says the store is missing, not a generic error');
    A.eq(h.automation.get(r.automation.id).enabled, true, 'the rule is still enabled below the threshold');
  }
  const last = h.engine.handleEvent('business.document.created', ev());
  A.eq(last.results[0].autoDisabled, true, 'the threshold run reports the auto-disable');
  const after = h.automation.get(r.automation.id);
  A.eq(after.enabled, false, 'the rule switched ITSELF off');
  A.ok(/switched itself off/.test(after.disabledReason), 'and recorded why, in words');
  A.ok(names(h.seen).indexOf('business.automation.disabled') >= 0, 'the auto-disable was announced on the bus');
  const dis = h.seen.filter(s => s.name === 'business.automation.disabled').pop().payload;
  A.eq(dis.businessId, 'acme', 'the disable event carries the businessId');
  A.eq(dis.automationId, r.automation.id, 'and the rule id');
  A.ok(/switched itself off/.test(dis.reason), 'and the reason, so a listener can say WHY it went quiet');
  A.ok(h.activity.list('acme').some(a => /Switched off automation/.test(a.action)), 'and it is in the activity log');
  A.eq(h.engine.stats().autoDisabled, 1, 'the engine counts the auto-disable');
  A.eq(h.engine.handleEvent('business.document.created', ev()).ran, 0, 'a disabled rule no longer fires');
}

/* ================= a review action whose params cannot resolve is a FAILED run, not a queued request ============ */
{
  const h = harness();
  // a BLANK required param is refused at create time, so this shape cannot even be stored
  A.eq(h.automation.create('acme', { name: 'x', trigger: 'business.experiment.concluded', actions: [{ action: 'send_external', params: { to: '', subject: 's', body: 'b' } }], enabled: true }).ok, false,
    'a blank required action param is refused when the rule is created');
  // so the failing shape has to be one that only fails at RUN time: a template that interpolates to nothing
  const r = h.automation.create('acme', {
    name: 'Bad request', trigger: 'business.experiment.concluded',
    actions: [{ action: 'send_external', params: { to: '{{no_such_field}}', subject: 's', body: 'b' } }],
    enabled: true, cooldownMs: 0
  });
  A.eq(r.ok, true, 'a template that cannot resolve is accepted at create time (it is only empty at run time)');
  const out = h.engine.handleEvent('business.experiment.concluded', { businessId: 'acme', experimentId: 'acme~x1', conclusion: 'supported' });
  A.eq(out.results[0].ok, false, 'the run failed');
  A.eq(out.results[0].actions[0].status, 'failed', 'the action is reported as failed, not pending');
  A.eq(h.approvals.pendingCount('acme'), 0, 'and NO approval was queued — a request that cannot be executed must not be presented for a decision');
}

/* ================= testRun writes NOTHING ================= */
{
  const h = harness();
  const r = h.automation.create('acme', {
    name: 'Lead follow-up', trigger: 'business.contact.added',
    conditions: [{ field: 'stage', op: 'eq', value: 'lead' }],
    actions: [{ action: 'create_task', params: { title: 'Follow up with {{name}}' } }, { action: 'send_external', params: { to: 'a@b.c', subject: 's', body: 'b' } }],
    enabled: true, cooldownMs: 0
  });
  const before = { tasks: h.tasks.count('acme'), approvals: h.approvals.count('acme'), runs: h.automation.runsForBusiness('acme').length, seen: h.seen.length };
  const tr = h.engine.testRun(r.automation.id, { businessId: 'acme', contactId: 'acme~c1', name: 'Dana', stage: 'lead' });
  A.eq(tr.ok, true, 'testRun succeeds');
  A.eq(tr.fires, true, 'it reports that the rule WOULD fire');
  A.eq(tr.conditions.pass, true, 'and that the conditions pass');
  A.eq(tr.actions[0].status, 'would-run', 'a safe action is reported as would-run');
  A.eq(tr.actions[0].params.title, 'Follow up with Dana', 'with its params resolved against the supplied payload');
  A.eq(tr.actions[1].status, 'would-ask-approval', 'a review action is reported as would-ask-approval');
  A.eq(h.tasks.count('acme'), before.tasks, 'NOTHING was written to the task store');
  A.eq(h.approvals.count('acme'), before.approvals, 'NOTHING was queued for approval');
  A.eq(h.automation.runsForBusiness('acme').length, before.runs, 'no run row was written');
  A.eq(h.seen.length, before.seen, 'and NO event was emitted');
  A.eq(h.automation.get(r.automation.id).fireCount, 0, 'and the fire count did not move');

  // a condition that fails is reported, not silently swallowed
  const tr2 = h.engine.testRun(r.automation.id, { businessId: 'acme', name: 'P', stage: 'prospect' });
  A.eq(tr2.fires, false, 'a failing condition means it would not fire');
  A.eq(tr2.conditions.results[0].ok, false, 'and the refusing clause is reported');
  A.eq(h.engine.testRun('nope', {}).ok, false, 'testRun refuses an unknown rule');

  // a disabled rule reports fires:false even when its conditions pass
  h.automation.setEnabled(r.automation.id, false);
  A.eq(h.engine.testRun(r.automation.id, { businessId: 'acme', name: 'D', stage: 'lead' }).fires, false, 'a switched-off rule would not fire');
}

/* ================= a rule that can never resolve its params fails cleanly ================= */
{
  const h = harness();
  h.automation.create('acme', {
    name: 'Bad params', trigger: 'task.created',
    actions: [{ action: 'create_task', params: { title: '{{nothing}}' } }],   // interpolates to empty
    enabled: true, cooldownMs: 0
  });
  const out = h.engine.handleEvent('task.created', { businessId: 'acme', taskId: 't1', title: 'T', status: 'todo', priority: 'normal', origin: 'user' });
  A.eq(out.results[0].ok, false, 'the run failed — a required param interpolated to nothing');
  A.eq(out.results[0].actions[0].status, 'failed', 'and the action is reported as failed');
  A.ok(/needs a "title"/.test(out.results[0].actions[0].reason), 'with the refusal naming the missing param');
  A.eq(h.tasks.count('acme'), 0, 'and no task was created');
  A.ok(h.engine.stats().failures > 0, 'the failure is counted');
}

/* ================= the storm guard on ONE event ================= */
{
  const h = harness();
  for (let i = 0; i < E.MAX_RULES_PER_EVENT + 5; i++) {
    h.automation.create('acme', { name: 'r' + i, trigger: 'task.created', actions: SAFE, enabled: true, cooldownMs: 0 });
  }
  const out = h.engine.handleEvent('task.created', { businessId: 'acme', taskId: 't1', title: 'T', status: 'todo', priority: 'normal', origin: 'user' });
  A.ok(out.ran <= E.MAX_RULES_PER_EVENT, 'one event cannot run more than MAX_RULES_PER_EVENT rules (' + out.ran + ')');
  A.ok(h.engine.stats().skippedStorm > 0, 'the rules past the cap were skipped, and counted');
}

/* ================= stats ================= */
{
  const h = harness();
  h.automation.create('acme', { name: 'n', trigger: 'task.created', actions: SAFE, enabled: true, cooldownMs: 0 });
  h.engine.handleEvent('task.created', { businessId: 'acme', taskId: 't1', title: 'T', status: 'todo', priority: 'normal', origin: 'user' });
  const s = h.engine.stats();
  A.eq(s.halted, false, 'stats reports the halt state');
  // eventsSeen counts EVERY event the hub saw, including the telemetry its own run emitted back onto the
  // bus (business.automation.ran / .notified). eventsMatched counts only the ones a rule actually listened
  // for, which is the number that answers "is this hub doing anything".
  A.ok(s.eventsSeen >= 1, 'stats counts every event the hub saw (' + s.eventsSeen + ')');
  A.eq(s.eventsMatched, 1, 'stats counts the events that matched a rule — exactly one here');
  A.eq(s.ran, 1, 'stats counts the runs');
  A.eq(s.actionsRun, 1, 'stats counts the actions actually executed');
  A.eq(s.queued, 0, 'the queue is drained');
  A.eq(s.maxDepth, E.MAX_DEPTH, 'stats reports the depth bound');
  A.eq(s.maxRunsPerPass, E.MAX_RUNS_PER_PASS, 'stats reports the pass budget');
  A.eq(s.maxRulesPerEvent, E.MAX_RULES_PER_EVENT, 'stats reports the per-event cap');
  for (const k of ['skippedHalted', 'skippedPaused', 'skippedMissing', 'skippedCooldown', 'skippedDepth', 'skippedStorm', 'stormStopped', 'autoDisabled', 'failures', 'cascaded', 'approvalsRequested']) {
    A.ok(typeof s[k] === 'number', 'stats exposes ' + k + ' as a number');
  }
}

/* ================= the engine refuses to build without its two stores ================= */
{
  A.throws(() => E.makeBusinessAutomationEngine({ approvals: B.makeBusinessApprovalsStore({ records: [], now: clock, permissions: P }) }),
    'the engine refuses to build without the rule store');
  A.throws(() => E.makeBusinessAutomationEngine({ automation: M.makeBusinessAutomationStore({ rules: [], now: clock, permissions: P }) }),
    'the engine refuses to build without the approval queue');
  A.eq(E.MAX_DEPTH, 3, 'MAX_DEPTH is exported');
  A.eq(E.MAX_RUNS_PER_PASS, 100, 'MAX_RUNS_PER_PASS is exported');
}

A.report('business-automation-engine.test');

/* ================= the OUTBOUND RAIL: a real send, honestly reported =================
   Everything above is synchronous, so this block lives AFTER report() as its own async section — a top-level
   `return` anywhere above would silently truncate the whole suite. The rail is injected, so this proves the
   real deliver/fail/throw paths without a network. */
async function railSection() {
  // 1) A rail that DELIVERS: the approval actually sends, and says delivered:true.
  const sent = [];
  const h = harness({ outbound: { send: (o) => { sent.push(o); return Promise.resolve({ ok: true, ref: 'msg-1' }); } } });
  h.automation.create('acme', {
    name: 'Tell the list', trigger: 'business.experiment.concluded',
    actions: [{ action: 'send_external', params: { to: 'a@b.c', subject: 'Hi', body: 'Body text' } }],
    enabled: true, cooldownMs: 0
  });
  h.engine.handleEvent('business.experiment.concluded', { businessId: 'acme', experimentId: 'acme~x1', conclusion: 'supported' });
  const row = h.approvals.list('acme', { status: 'pending' })[0];

  const ap = await h.engine.approve(row.id, 'Andrew');
  A.eq(ap.ok, true, 'approve with a rail succeeds');
  A.eq(ap.executed.delivered, true, 'and the message was actually DELIVERED (the new capability)');
  A.eq(sent.length, 1, 'the rail was called exactly once');
  A.eq(sent[0].to, 'a@b.c', 'with the declared destination');
  A.ok(/Hi/.test(sent[0].text) && /Body text/.test(sent[0].text), 'and the subject+body composed into the text');
  A.eq(sent[0].businessId, 'acme', 'the rail is told which business the send belongs to (P6 audit trail)');
  const auditRow = h.activity.list('acme').filter(a => /delivered/i.test(String(a.action)))[0];
  A.ok(auditRow, 'the activity log records a DELIVERY, distinctly from an authorization');

  // 2) A rail that FAILS must never be reported as a success (P2/P7).
  const hf = harness({ outbound: { send: () => Promise.resolve({ ok: false, error: 'smtp 550' }) } });
  hf.automation.create('acme', {
    name: 'Failing send', trigger: 'business.experiment.concluded',
    actions: [{ action: 'send_external', params: { to: 'a@b.c', subject: 's', body: 'b' } }],
    enabled: true, cooldownMs: 0
  });
  hf.engine.handleEvent('business.experiment.concluded', { businessId: 'acme', experimentId: 'acme~y1', conclusion: 'supported' });
  const rowf = hf.approvals.list('acme', { status: 'pending' })[0];
  const apf = await hf.engine.approve(rowf.id, 'Andrew');
  A.eq(apf.executed.ok, false, 'a rail failure is a FAILED action, not a phantom success');
  A.ok(/could not deliver|550/.test(apf.executed.reason), 'the failure reason is surfaced in words');

  // 3) A rail that THROWS is caught, not propagated.
  const ht = harness({ outbound: { send: () => { throw new Error('socket closed'); } } });
  ht.automation.create('acme', {
    name: 'Throwing send', trigger: 'business.experiment.concluded',
    actions: [{ action: 'send_external', params: { to: 'a@b.c', subject: 's', body: 'b' } }],
    enabled: true, cooldownMs: 0
  });
  ht.engine.handleEvent('business.experiment.concluded', { businessId: 'acme', experimentId: 'acme~z1', conclusion: 'supported' });
  const rowt = ht.approvals.list('acme', { status: 'pending' })[0];
  const apt = await ht.engine.approve(rowt.id, 'Andrew');
  A.eq(apt.executed.ok, false, 'a throwing rail is caught and reported as a failure');
  A.ok(/threw|socket closed/.test(apt.executed.reason), 'with the throw surfaced, not swallowed');

  // 4) spend_money stays rail-less BY DESIGN (money is the one unrecoverable action).
  const hs = harness({ outbound: { send: () => Promise.resolve({ ok: true }) } });
  hs.automation.create('acme', {
    name: 'Pay', trigger: 'business.experiment.concluded',
    actions: [{ action: 'spend_money', params: { amount: 10, currency: 'USD', description: 'x' } }],
    enabled: true, cooldownMs: 0
  });
  hs.engine.handleEvent('business.experiment.concluded', { businessId: 'acme', experimentId: 'acme~w1', conclusion: 'supported' });
  const rows = hs.approvals.list('acme', { status: 'pending' })[0];
  const aps = await hs.engine.approve(rows.id, 'Andrew');
  A.eq(aps.executed.delivered, false, 'spend_money reports delivered:false even WHEN a rail exists');
  A.ok(/no payment rail/.test(aps.executed.reason), 'because there is deliberately no payment rail');
  A.eq(sent.length, 1, 'and it never touched the outbound rail');
}
railSection().then(
  () => A.report('business-automation-engine.test — outbound rail'),
  (e) => { console.error('outbound rail section THREW:', (e && e.stack) || e); A.report('business-automation-engine.test — outbound rail'); }
);
