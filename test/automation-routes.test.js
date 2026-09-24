'use strict';
/* test/automation-routes.test.js — the AUTOMATION HUB HTTP surface (Business OS Phase 5).

   Exercised with FAKE req/res, because index.js self-boots and cannot be require()d — the handlers take
   readBody/respondJson by injection precisely so this is possible.

   THE TRAP THIS TEST EXISTS FOR, and it is the SAME trap that bit Phase 4: index.js's dispatch populates
   the match array only for `rx` rows; a `qrx` row leaves it NULL, so a handler reading `match[1]` gets
   undefined and the route 404s while looking completely correct. Every business-scoped GET here carries a
   query (?status, ?limit), so every one of them must be `rx` with a query-tolerant tail. The dispatch
   below is a faithful copy of index.js's loop, so a wrong match key fails HERE.

   The load-bearing behaviours:
     · a bad trigger / condition / action surfaces as a 422, never a silent no-op rule;
     · a rule that cannot be enabled surfaces as a 403;
     · a cross-business payload injected by hand is a 409 (P6);
     · a double approval is a 409, not a second execution;
     · deleting an automation EXPIRES its pending requests rather than orphaning them;
     · every emitted payload is schema-VALID (the real bus silently drops an invalid one). */
const A = require('./_assert.js');
const AR = require('../sidecar/automation-routes.js');
const M = require('../sidecar/business-automation-store.js');
const B = require('../sidecar/business-approvals-store.js');
const E = require('../sidecar/business-automation-engine.js');
const P = require('../sidecar/business-permissions.js');
const { makeBusinessTasksStore } = require('../sidecar/business-tasks-store.js');
const { makeBusinessCrmStore } = require('../sidecar/business-crm-store.js');
const { makeBusinessActivityStore } = require('../sidecar/business-activity-store.js');
const { makeBusinessesStore } = require('../sidecar/businesses-store.js');
const EVENTS = require('../shared/events.js');

function fakeRes() {
  return {
    code: null, body: null, headers: null,
    writeHead(c, h) { this.code = c; this.headers = h; return this; },
    end(s) { this.body = s; }
  };
}
function fakeReq(method, url, body) {
  return { method, url, _body: body === undefined ? '' : (typeof body === 'string' ? body : JSON.stringify(body)) };
}
async function readBody(req) { return req._body || ''; }

let T = 1_700_000_000_000;
function clock() { return (T += 1000); }

function harness() {
  const automation = M.makeBusinessAutomationStore({ rules: [], runs: [], now: clock, permissions: P });
  const approvals = B.makeBusinessApprovalsStore({ records: [], now: clock, permissions: P });
  const tasks = makeBusinessTasksStore({ records: [], persist: () => {}, now: clock });
  const crm = makeBusinessCrmStore({ records: [], persist: () => {}, now: clock });
  const activity = makeBusinessActivityStore({ records: [], persist: () => {}, now: clock });
  const businesses = makeBusinessesStore({ records: [], persist: () => {}, now: clock });
  businesses.create({ name: 'Acme' });   // acme
  businesses.create({ name: 'Beta' });   // beta
  const seen = [];
  let engine = null;
  engine = E.makeBusinessAutomationEngine({
    automation, approvals, permissions: P, activity, businesses, tasks, crm, now: clock,
    emit: (name, payload) => { seen.push({ name, payload }); engine.handleEvent(name, payload); }
  });
  let haltedCalls = [];
  const R = AR.makeAutomationRoutes({
    automation, approvals, engine, businesses, activity, readBody,
    setHalted: on => { haltedCalls.push(on); if (on) engine.halt(); else engine.resume(); return { halted: !!on, dropped: 0, persisted: true }; },
    emit: (name, payload) => seen.push({ name, payload })
  });
  return { automation, approvals, tasks, crm, activity, businesses, engine, seen, R, haltedCalls };
}

/* dispatch EXACTLY as index.js does — method gate, then the single match key, then h(req,res,gm). */
async function dispatch(R, method, url, body) {
  const req = fakeReq(method, url, body);
  const res = fakeRes();
  const bare = url.split('?')[0];
  for (const r of R.routes) {
    if (Array.isArray(r.m) ? r.m.indexOf(method) < 0 : r.m !== method) continue;
    let gm = null;
    if (r.exact !== undefined) { if (url !== r.exact) continue; }
    else if (r.qsplit !== undefined) { if (bare !== r.qsplit) continue; }
    else if (r.rx) { gm = url.match(r.rx); if (!gm) continue; }
    else if (r.qrx) { if (!r.qrx.test(bare)) continue; }
    else continue;
    await r.h(req, res, gm);
    return res;
  }
  return null;   // no row matched -> in the real server this falls through to static
}
function json(res) { try { return JSON.parse(res.body || '{}'); } catch (_) { return null; } }
/* Look a business up BY NAME, never by list position: businesses-store.list() orders newest-first, so a
   positional destructure silently swaps acme and beta the moment the clock moves. */
const bizId = (businesses, name) => { const b = businesses.list().filter(x => x.name === name)[0]; return b ? b.id : null; };

(async () => {

/* ---------- every route row has exactly ONE match key, and no qrx row exists ---------- */
{
  const { R } = harness();
  A.ok(R.routes.length >= 19, 'the surface has the full set of rows (' + R.routes.length + ')');
  for (const r of R.routes) {
    const keys = ['exact', 'qsplit', 'prefix', 'qprefix', 'rx', 'qrx'].filter(k => r[k] !== undefined);
    A.eq(keys.length, 1, 'row ' + JSON.stringify(r.m) + ' has exactly ONE match key (found ' + keys.join(',') + ')');
    A.ok(typeof r.h === 'function', 'every row has a handler');
  }
  // THE PHASE 4 LESSON: a qrx row hands its handler match === null. Not one row here may be qrx.
  A.eq(R.routes.filter(r => r.qrx !== undefined).length, 0, 'NO row is qrx — a qrx row would pass match === null and every id read would be undefined');
  // the rows whose handler actually READS a query must accept one; an id-anchored row needs no tail.
  const TAIL = '(?:\\?[^#]*)?$';
  const readsAQuery = [AR.RX_BIZ_AUTOMATIONS, AR.RX_BIZ_AUTO_RUNS, AR.RX_BIZ_APPROVALS, AR.RX_AUTO_RUNS];
  for (const rx of readsAQuery) {
    A.ok(String(rx).indexOf(TAIL) >= 0, String(rx) + ' accepts an optional query tail (its handler reads a query)');
  }
  for (const r of R.routes) {
    if (!r.rx) continue;
    if (readsAQuery.indexOf(r.rx) >= 0) continue;
    // an id-anchored row ends at its `$` — no query tail, and none needed
    A.eq(String(r.rx).indexOf('?[^#]*'), -1, 'id-anchored row ' + String(r.rx) + ' needs no query tail');
  }
}

/* ================= THE TRAP: a business-scoped GET with a query still fires ================= */
{
  const { R, businesses } = harness();
  const acme = bizId(businesses, 'Acme');
  for (const u of [
    '/api/businesses/' + acme + '/automations?limit=5',
    '/api/businesses/' + acme + '/automations/runs?limit=5',
    '/api/businesses/' + acme + '/approvals?status=pending'
  ]) {
    const res = await dispatch(R, 'GET', u);
    A.ok(res && res.code === 200, 'GET ' + u + ' MATCHES and returns 200');
  }
  // the query-less forms match too
  for (const u of ['/api/businesses/' + acme + '/automations', '/api/businesses/' + acme + '/approvals']) {
    const res = await dispatch(R, 'GET', u);
    A.ok(res && res.code === 200, 'GET ' + u + ' (no query) MATCHES too');
  }
  // an id-bearing route must CAPTURE the id (the whole point of rx over qrx)
  const made = await dispatch(R, 'POST', '/api/businesses/' + acme + '/automations', { name: 'x', trigger: 'task.created', actions: [{ action: 'notify', params: { text: 'hi' } }], enabled: true });
  const id = json(made).automation.id;
  const one = await dispatch(R, 'GET', '/api/automations/' + id);
  A.ok(one && one.code === 200, 'GET /api/automations/:id MATCHES and captured the id');
  A.eq(json(one).automation.id, id, 'and the id it read back is the one that was created');
}

/* ================= the catalog serves the closed vocabularies from their owners ================= */
{
  const { R } = harness();
  const res = await dispatch(R, 'GET', '/api/automation/catalog');
  A.eq(res.code, 200, 'the catalog is served');
  const c = json(res);
  A.eq(c.triggers.length, M.TRIGGER_EVENTS.length, 'every trigger is offered');
  A.eq(c.ops.length, M.CONDITION_OPS.length, 'every condition op is offered');
  A.eq(c.actions.length, M.AUTOMATION_ACTIONS.length, 'every action is offered');
  A.eq(c.tiers, P.TIERS, 'the §13 tiers are offered');
  A.eq(c.evidence, P.EVIDENCE, 'the evidence vocabulary is offered');
  A.eq(c.limits.failureThreshold, M.FAILURE_THRESHOLD, 'the failure threshold is offered, not hard-coded in the UI');
  A.eq(c.limits.maxDepth, E.MAX_DEPTH, 'the cascade depth bound is offered');
  A.eq(c.limits.maxRunsPerPass, E.MAX_RUNS_PER_PASS, 'the pass budget is offered');
  A.ok(c.params.metrics.length > 0, 'the metric picker comes from the metrics module');
  A.ok(c.params.crmStages.length > 0, 'the CRM stage picker comes from the CRM module');
  A.ok(c.params.documentTypes.length > 0, 'the document type picker comes from the document module');
  A.ok(c.params.taskPriorities.length > 0, 'the task priority picker comes from the task module');
  for (const a of c.actions) {
    A.ok(!!a.tier && !!a.label && !!a.executor, 'action "' + a.id + '" is served with its DERIVED tier and its executor honesty field');
    A.eq(a.tier, P.classify(a.perm).tier, 'action "' + a.id + '" reports the tier its permission action resolves to');
  }
}

/* ================= create ================= */
{
  const { R, businesses, seen } = harness();
  const acme = bizId(businesses, 'Acme');
  const beta = bizId(businesses, 'Beta');

  const missing = await dispatch(R, 'POST', '/api/businesses/ghost/automations', { name: 'x', trigger: 'task.created', actions: [{ action: 'notify', params: { text: 'h' } }] });
  A.eq(missing.code, 404, 'an unknown business is a 404');

  const badTrigger = await dispatch(R, 'POST', '/api/businesses/' + acme + '/automations', { name: 'x', trigger: 'nope.not.real', actions: [{ action: 'notify', params: { text: 'h' } }] });
  A.eq(badTrigger.code, 422, 'an unknown trigger is a 422, not a silently dead rule');
  A.ok(/unknown trigger/.test(json(badTrigger).error), 'and the error says so');

  const badCond = await dispatch(R, 'POST', '/api/businesses/' + acme + '/automations', { name: 'x', trigger: 'task.created', conditions: [{ field: 'a', op: 'zzz', value: 1 }], actions: [{ action: 'notify', params: { text: 'h' } }] });
  A.eq(badCond.code, 422, 'an unknown condition op is a 422');
  const badAction = await dispatch(R, 'POST', '/api/businesses/' + acme + '/automations', { name: 'x', trigger: 'task.created', actions: [{ action: 'notify', params: {} }] });
  A.eq(badAction.code, 422, 'a missing required action param is a 422');
  const noActions = await dispatch(R, 'POST', '/api/businesses/' + acme + '/automations', { name: 'x', trigger: 'task.created' });
  A.eq(noActions.code, 422, 'a rule with no actions is a 422');
  const badJson = await dispatch(R, 'POST', '/api/businesses/' + acme + '/automations', 'not json');
  A.eq(badJson.code, 400, 'malformed JSON is a 400');

  const ok = await dispatch(R, 'POST', '/api/businesses/' + acme + '/automations', { name: 'Notify me', trigger: 'task.created', actions: [{ action: 'notify', params: { text: 'New: {{title}}' } }], enabled: true, cooldownMs: 0 });
  A.eq(ok.code, 201, 'a well-formed rule is 201 Created');
  const made = json(ok).automation;
  A.ok(/^acme~a\d+$/.test(made.id), 'the id is <businessId>~a<seq> (' + made.id + ')');
  A.eq(made.autonomy, 'autonomous', 'the response carries the derived autonomy');
  A.ok(seen.some(s => s.name === 'business.automation.created'), 'the creation was announced on the bus');
  A.ok(seen.some(s => s.name === 'business.automation.created' && s.payload.businessId === acme), 'and the event carries the businessId');
  A.ok(seen.filter(s => s.name === 'business.automation.created').every(s => EVENTS.validate(s.name, s.payload).ok), 'and it is schema-valid');

  const list = await dispatch(R, 'GET', '/api/businesses/' + acme + '/automations');
  A.eq(json(list).count, 1, 'the list returns the rule');
  A.eq(json(list).summary.total, 1, 'and a summary');
  const other = await dispatch(R, 'GET', '/api/businesses/' + beta + '/automations');
  A.eq(json(other).count, 0, 'the other business sees none (P6)');
}

/* ================= enable / disable ================= */
{
  const { R, businesses, seen } = harness();
  const acme = bizId(businesses, 'Acme');
  const made = json(await dispatch(R, 'POST', '/api/businesses/' + acme + '/automations', { name: 'x', trigger: 'task.created', actions: [{ action: 'notify', params: { text: 'h' } }], enabled: false })).automation;
  A.eq(made.enabled, false, 'the rule starts switched off');

  const on = await dispatch(R, 'POST', '/api/automations/' + made.id + '/enable');
  A.eq(on.code, 200, 'enable is 200');
  A.eq(json(on).automation.enabled, true, 'the rule is on');
  A.ok(seen.some(s => s.name === 'business.automation.enabled'), 'and the switch-on was announced');
  const again = await dispatch(R, 'POST', '/api/automations/' + made.id + '/enable');
  A.eq(json(again).changed, false, 'a redundant enable reports no change');

  const off = await dispatch(R, 'POST', '/api/automations/' + made.id + '/disable');
  A.eq(off.code, 200, 'disable is 200');
  A.eq(json(off).automation.enabled, false, 'the rule is off');
  A.ok(seen.some(s => s.name === 'business.automation.disabled'), 'and the switch-off was announced');
  A.ok(seen.filter(s => s.name === 'business.automation.disabled').every(s => EVENTS.validate(s.name, s.payload).ok), 'and it is schema-valid');

  A.eq((await dispatch(R, 'POST', '/api/automations/nope/enable')).code, 404, 'enabling an unknown rule is a 404');
  A.eq((await dispatch(R, 'POST', '/api/automations/nope/disable')).code, 404, 'disabling an unknown rule is a 404');
}

/* ================= PATCH / DELETE ================= */
{
  const { R, businesses, seen } = harness();
  const acme = bizId(businesses, 'Acme');
  const made = json(await dispatch(R, 'POST', '/api/businesses/' + acme + '/automations', { name: 'x', trigger: 'task.created', actions: [{ action: 'notify', params: { text: 'h' } }] })).automation;

  const patched = await dispatch(R, 'PATCH', '/api/automations/' + made.id, { name: 'renamed', conditions: [{ field: 'status', op: 'eq', value: 'done' }] });
  A.eq(patched.code, 200, 'PATCH is 200');
  A.eq(json(patched).automation.name, 'renamed', 'the name moved');
  A.ok(json(patched).changed.indexOf('conditions') >= 0, 'and `changed` names conditions — never a generic claim');
  A.ok(seen.some(s => s.name === 'business.automation.updated'), 'the update was announced');
  A.eq((await dispatch(R, 'PATCH', '/api/automations/' + made.id, { trigger: 'zzz' })).code, 422, 'an invalid patch is a 422');
  A.eq((await dispatch(R, 'PATCH', '/api/automations/nope', { name: 'x' })).code, 404, 'patching an unknown rule is a 404');

  const del = await dispatch(R, 'DELETE', '/api/automations/' + made.id);
  A.eq(del.code, 200, 'DELETE is 200');
  A.eq(json(del).removed, made.id, 'and reports what it removed');
  A.eq((await dispatch(R, 'GET', '/api/automations/' + made.id)).code, 404, 'the rule is gone');
  A.ok(seen.some(s => s.name === 'business.automation.removed'), 'the removal was announced');
  A.eq((await dispatch(R, 'DELETE', '/api/automations/nope')).code, 404, 'deleting an unknown rule is a 404');
}

/* ================= deleting an automation EXPIRES its pending requests ================= */
{
  const { R, businesses, approvals, automation, seen } = harness();
  const acme = bizId(businesses, 'Acme');
  const made = json(await dispatch(R, 'POST', '/api/businesses/' + acme + '/automations', {
    name: 'Spend', trigger: 'business.experiment.concluded',
    actions: [{ action: 'spend_money', params: { amount: '10', currency: 'USD', description: 'ads' } }], enabled: true, cooldownMs: 0
  })).automation;
  // fire it so a request is waiting
  const run = await dispatch(R, 'POST', '/api/automations/' + made.id + '/run', { payload: { conclusion: 'supported' } });
  A.eq(run.code, 200, 'the manual fire is 200');
  A.eq(approvals.pendingCount(acme), 1, 'a request is waiting');
  const reqId = approvals.list(acme, { status: 'pending' })[0].id;

  const del = await dispatch(R, 'DELETE', '/api/automations/' + made.id);
  A.eq(json(del).expiredApprovals, 1, 'deleting the automation expires its pending request');
  A.eq(approvals.get(reqId).status, 'expired', 'the request is expired, not left for a decision nobody can act on');
  A.eq(approvals.pendingCount(acme), 0, 'and the pending count is honest');
}

/* ================= test (dry run) and run (gated manual inject) ================= */
{
  const { R, businesses, tasks, automation } = harness();
  const acme = bizId(businesses, 'Acme');
  const beta = bizId(businesses, 'Beta');
  const made = json(await dispatch(R, 'POST', '/api/businesses/' + acme + '/automations', {
    name: 'Follow up', trigger: 'business.contact.added',
    conditions: [{ field: 'stage', op: 'eq', value: 'lead' }],
    actions: [{ action: 'create_task', params: { title: 'Follow up with {{name}}' } }], enabled: true, cooldownMs: 0
  })).automation;

  const before = tasks.count(acme);
  const test = await dispatch(R, 'POST', '/api/automations/' + made.id + '/test', { payload: { name: 'Dana', stage: 'lead' } });
  A.eq(test.code, 200, 'the dry run is 200');
  A.eq(json(test).test.fires, true, 'it reports that the rule would fire');
  A.eq(json(test).test.actions[0].params.title, 'Follow up with Dana', 'with the params resolved');
  A.eq(tasks.count(acme), before, 'and it wrote NOTHING');

  const crossBiz = await dispatch(R, 'POST', '/api/automations/' + made.id + '/test', { payload: { businessId: beta, name: 'D', stage: 'lead' } });
  A.eq(crossBiz.code, 409, 'a payload naming ANOTHER business is a 409 (P6)');
  A.ok(/cross-business/.test(json(crossBiz).error), 'and the error says so');

  // run: the real thing, through the SAME gates
  const run = await dispatch(R, 'POST', '/api/automations/' + made.id + '/run', { payload: { name: 'Dana', stage: 'lead' } });
  A.eq(run.code, 200, 'the manual fire is 200');
  A.eq(json(run).ran, 1, 'it ran the rule');
  A.eq(tasks.count(acme), before + 1, 'and a task really exists');
  A.eq(tasks.list(acme)[0].title, 'Follow up with Dana', 'with the interpolated title');

  const crossRun = await dispatch(R, 'POST', '/api/automations/' + made.id + '/run', { payload: { businessId: beta, name: 'D', stage: 'lead' } });
  A.eq(crossRun.code, 409, 'a manual fire naming another business is a 409 (P6)');

  // the cooldown is NOT bypassable by a manual fire
  const slow = json(await dispatch(R, 'POST', '/api/businesses/' + acme + '/automations', {
    name: 'Slow', trigger: 'business.metric.recorded', actions: [{ action: 'notify', params: { text: 'm' } }], enabled: true, cooldownMs: 60000
  })).automation;
  const f1 = await dispatch(R, 'POST', '/api/automations/' + slow.id + '/run', { payload: { metric: 'visitors' } });
  A.eq(json(f1).ran, 1, 'the first manual fire runs');
  const f2 = await dispatch(R, 'POST', '/api/automations/' + slow.id + '/run', { payload: { metric: 'visitors' } });
  A.eq(f2.code, 200, 'the second is still a 200');
  A.eq(json(f2).ran, 0, 'but it did NOT run — a manual fire passes the same gates, so it cannot storm a trigger');
  A.eq(json(f2).result, null, 'and the response carries no run result, because none happened');
  A.eq(json(f2).ran, 0, 'the run count is 0, so a caller can tell a skip from a fire');

  A.eq((await dispatch(R, 'POST', '/api/automations/nope/test', {})).code, 404, 'testing an unknown rule is a 404');
  A.eq((await dispatch(R, 'POST', '/api/automations/nope/run', {})).code, 404, 'running an unknown rule is a 404');
}

/* ================= approvals (§13) ================= */
{
  const { R, businesses, approvals, seen } = harness();
  const acme = bizId(businesses, 'Acme');
  const beta = bizId(businesses, 'Beta');
  const made = json(await dispatch(R, 'POST', '/api/businesses/' + acme + '/automations', {
    name: 'Tell the list', trigger: 'business.experiment.concluded',
    actions: [{ action: 'send_external', params: { to: 'a@b.c', subject: 's', body: 'b' } }], enabled: true, cooldownMs: 0
  })).automation;
  await dispatch(R, 'POST', '/api/automations/' + made.id + '/run', { payload: { conclusion: 'supported' } });

  const list = await dispatch(R, 'GET', '/api/businesses/' + acme + '/approvals');
  A.eq(list.code, 200, 'the queue is served');
  A.eq(json(list).count, 1, 'with the waiting request');
  A.eq(json(list).pending, 1, 'and the §19 pending count');
  const row = json(list).approvals[0];
  A.ok(!!row.what && !!row.why && !!row.risk, 'the row carries its §26 block');
  A.ok(row.evidence.length > 0, 'and its evidence (P1)');
  A.eq(row.tier, 'review', 'and the §13 tier');
  A.ok(seen.some(s => s.name === 'business.approval.requested'), 'the request was announced');

  const filtered = await dispatch(R, 'GET', '/api/businesses/' + acme + '/approvals?status=approved');
  A.eq(json(filtered).count, 0, 'the status filter works');
  A.eq((await dispatch(R, 'GET', '/api/businesses/' + acme + '/approvals?status=zzz')).code, 422, 'an unknown status filter is a 422');
  A.eq((await dispatch(R, 'GET', '/api/businesses/ghost/approvals')).code, 404, 'an unknown business is a 404');
  A.eq(json(await dispatch(R, 'GET', '/api/businesses/' + beta + '/approvals')).count, 0, 'the other business sees none (P6)');

  A.eq((await dispatch(R, 'GET', '/api/approvals/' + row.id)).code, 200, 'a single approval is readable');
  A.eq((await dispatch(R, 'GET', '/api/approvals/nope')).code, 404, 'an unknown approval is a 404');
  // a PENDING request cannot be deleted — it must be decided
  const del = await dispatch(R, 'DELETE', '/api/approvals/' + row.id);
  A.eq(del.code, 409, 'deleting a PENDING request is a 409 — approve or reject it');

  const ap = await dispatch(R, 'POST', '/api/approvals/' + row.id + '/approve', { by: 'Andrew' });
  A.eq(ap.code, 200, 'approve is 200');
  A.eq(json(ap).approval.status, 'approved', 'the row is approved');
  A.eq(json(ap).executed.delivered, false, 'and the engine honestly reports that nothing left the station');
  A.ok(seen.some(s => s.name === 'business.approval.decided'), 'the decision was announced');
  const ap2 = await dispatch(R, 'POST', '/api/approvals/' + row.id + '/approve', { by: 'Andrew' });
  A.eq(ap2.code, 409, 'a SECOND approve is a 409 — a decision is final, so an action cannot run twice');
  A.eq((await dispatch(R, 'POST', '/api/approvals/nope/approve', {})).code, 422, 'approving an unknown id is a 422');

  // a decided row CAN be deleted (its receipt is not a decision anyone is waiting on)
  A.eq((await dispatch(R, 'DELETE', '/api/approvals/' + row.id)).code, 200, 'a DECIDED row can be removed');
  A.eq((await dispatch(R, 'GET', '/api/approvals/' + row.id)).code, 404, 'and it is gone');

  // reject
  await dispatch(R, 'POST', '/api/automations/' + made.id + '/run', { payload: { conclusion: 'supported' } });
  const row2 = json(await dispatch(R, 'GET', '/api/businesses/' + acme + '/approvals?status=pending')).approvals[0];
  const rj = await dispatch(R, 'POST', '/api/approvals/' + row2.id + '/reject', { reason: 'not now', by: 'Andrew' });
  A.eq(rj.code, 200, 'reject is 200');
  A.eq(json(rj).approval.status, 'rejected', 'the row is rejected');
  A.eq(json(rj).approval.reason, 'not now', 'the reason is kept');
  A.eq((await dispatch(R, 'POST', '/api/approvals/' + row2.id + '/reject', {})).code, 409, 'a second reject is a 409');
}

/* ================= the §19 hub controls ================= */
{
  const { R, businesses, engine, haltedCalls, seen } = harness();
  const acme = bizId(businesses, 'Acme');
  const made = json(await dispatch(R, 'POST', '/api/businesses/' + acme + '/automations', {
    name: 'N', trigger: 'task.created', actions: [{ action: 'notify', params: { text: 'h' } }], enabled: true, cooldownMs: 0
  })).automation;

  const st = await dispatch(R, 'GET', '/api/automation/status');
  A.eq(st.code, 200, 'status is served');
  A.eq(json(st).hub.halted, false, 'the hub starts live');

  const halt = await dispatch(R, 'POST', '/api/automation/halt');
  A.eq(halt.code, 200, 'halt is 200');
  A.eq(json(halt).hub.halted, true, 'the hub is halted');
  A.eq(json(halt).persisted, true, 'and it reports the durable stamp honestly');
  A.ok(haltedCalls.indexOf(true) >= 0, 'the injected halt control was used (so index.js owns the persistence)');
  A.ok(seen.some(s => s.name === 'automation.halted'), 'the halt was announced on the bus');
  A.ok(seen.filter(s => s.name === 'automation.halted').every(s => EVENTS.validate(s.name, s.payload).ok), 'and it is schema-valid');

  // while halted, a manual fire is refused and a bus event runs nothing
  const run = await dispatch(R, 'POST', '/api/automations/' + made.id + '/run', { payload: {} });
  A.eq(run.code, 409, 'a manual fire while halted is a 409');
  A.ok(/halted/.test(json(run).error), 'and the error names the E-STOP');

  const res = await dispatch(R, 'POST', '/api/automation/resume');
  A.eq(res.code, 200, 'resume is 200');
  A.eq(json(res).hub.halted, false, 'the hub is live again');
  A.ok(haltedCalls.indexOf(false) >= 0, 'the resume went through the same halt control');
  A.eq(engine.isHalted(), false, 'and the engine agrees');
  A.eq((await dispatch(R, 'POST', '/api/automations/' + made.id + '/run', { payload: {} })).code, 200, 'a manual fire works again after resume');
}

/* ================= runs endpoints ================= */
{
  const { R, businesses, automation } = harness();
  const acme = bizId(businesses, 'Acme');
  const made = json(await dispatch(R, 'POST', '/api/businesses/' + acme + '/automations', {
    name: 'N', trigger: 'task.created', actions: [{ action: 'notify', params: { text: 'h' } }], enabled: true, cooldownMs: 0
  })).automation;
  await dispatch(R, 'POST', '/api/automations/' + made.id + '/run', { payload: {} });

  const runs = await dispatch(R, 'GET', '/api/automations/' + made.id + '/runs');
  A.eq(runs.code, 200, 'the per-rule log is served');
  A.eq(json(runs).count, 1, 'with the one run');
  A.eq(json(runs).lastFiredAt, automation.lastFiredAt(made.id), 'and the real last-fired instant');
  const limited = await dispatch(R, 'GET', '/api/automations/' + made.id + '/runs?limit=1');
  A.eq(json(limited).count, 1, 'the limit is honoured');
  A.eq((await dispatch(R, 'GET', '/api/automations/nope/runs')).code, 404, 'runs for an unknown rule is a 404');

  const bizRuns = await dispatch(R, 'GET', '/api/businesses/' + acme + '/automations/runs');
  A.eq(bizRuns.code, 200, 'the business-wide log is served');
  A.eq(json(bizRuns).count, 1, 'with the run');
  A.eq((await dispatch(R, 'GET', '/api/businesses/ghost/automations/runs')).code, 404, 'an unknown business is a 404');

  // the detail route embeds a slice of the log and the pending count
  const one = await dispatch(R, 'GET', '/api/automations/' + made.id);
  A.eq(one.code, 200, 'the detail route is served');
  A.eq(json(one).runs.length, 1, 'and it embeds the run log');
  A.eq(json(one).pendingApprovals, 0, 'and the pending approval count');
}

/* ================= method guards ================= */
{
  const { R } = harness();
  const putExact = await dispatch(R, 'PUT', '/api/automation/catalog');
  A.ok(putExact === null, 'an unhandled method on an exact route matches NO row (it falls through to static in the real server)');
  const made = json(await dispatch(R, 'POST', '/api/businesses/acme/automations', { name: 'x', trigger: 'task.created', actions: [{ action: 'notify', params: { text: 'h' } }] })).automation;
  const put = await dispatch(R, 'PUT', '/api/automations/' + made.id);
  A.ok(put === null || put.code === 405, 'PUT on a rule is not handled by any row (405 or no match)');
}

/* ================= every emitted payload across the whole run is schema-valid ================= */
{
  const { R, businesses, seen } = harness();
  const acme = bizId(businesses, 'Acme');
  const made = json(await dispatch(R, 'POST', '/api/businesses/' + acme + '/automations', {
    name: 'All', trigger: 'business.contact.added',
    actions: [{ action: 'create_task', params: { title: 'T {{name}}' } }, { action: 'notify', params: { text: 'n {{name}}' } }],
    enabled: true, cooldownMs: 0
  })).automation;
  await dispatch(R, 'POST', '/api/automations/' + made.id + '/run', { payload: { name: 'Dana', stage: 'lead' } });
  A.ok(seen.length > 0, 'events were emitted');
  for (const s of seen) {
    const v = EVENTS.validate(s.name, s.payload);
    A.ok(v.ok, 'emitted ' + s.name + ' is schema-valid' + (v.ok ? '' : ' — ' + v.errors.join('; ')));
  }
  A.ok(seen.some(s => s.name === 'task.created'), 'the action\'s domain event reached the bus');
  A.ok(seen.some(s => s.name === 'business.automation.ran'), 'and so did the run announcement');
}

A.report('automation-routes.test');
})();
