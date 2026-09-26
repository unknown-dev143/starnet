'use strict';
/* test/business-os-hardening.test.js — Phase 8 (Hardening) audit of the Business OS.

   Master prompt §30 / §417 defines Phase 8 as the security, audit and resilience pass:
     Security audit · permission audit · data-isolation testing · agent-boundary testing ·
     failure testing · API-failure testing · auth testing · backup/recovery testing ·
     automation-safety testing · performance testing.

   This single suite exercises all ten against the REAL Business OS modules (no mocks for the code under
   test — only the ambient edges, store/emit/now, are injected exactly as production composes them). Every
   assertion is a property the §13 / §19 / P6 / P7 spec actually promises, so a green run is evidence the
   Business OS is hardened, not merely that code exists.

   Harness note (learned the hard way): A.eq(actual, expected, msg) — the MESSAGE is the THIRD argument. A
   wall of inverted "expected / got" failures means the call order is wrong, not the code. */
const fs = require('fs');
const path = require('path');
const A = require('./_assert.js');

const apiauth = require('../sidecar/apiauth.js');
const BP = require('../sidecar/business-permissions.js');
const { makeBusinessesStore } = require('../sidecar/businesses-store.js');
const { makeBusinessAgentsStore } = require('../sidecar/business-agents-store.js');
const { makeBusinessRoutes, RX_ONE, RX_ACTIVITY } = require('../sidecar/business-routes.js');
const { makeBusinessAutomationEngine, MAX_DEPTH, MAX_RUNS_PER_PASS } = require('../sidecar/business-automation-engine.js');

// ---------------------------------------------------------------------------
// Shared fakes
// ---------------------------------------------------------------------------
function fakeRes() {
  return { code: null, body: null, headers: null, writeHead(c, h) { this.code = c; this.headers = h; return this; }, end(s) { this.body = s; } };
}
function fakeReq(method, url, body) {
  return { method, url, _body: body === undefined ? '' : (typeof body === 'string' ? body : JSON.stringify(body)) };
}
// readBody throws past MAX_BODY exactly like the real http-body reader, so the 413 path is exercised.
function readBody(req) {
  const raw = req._body || '';
  if (raw.length > 16384) throw new Error('body too large');
  return raw;
}
function routeHarness(extra) {
  const bizRecords = []; const actRecords = [];
  const businesses = makeBusinessesStore({ records: bizRecords, persist: () => {}, now: () => 1000 });
  const activity = require('../sidecar/business-activity-store.js').makeBusinessActivityStore({ records: actRecords, persist: () => {}, now: () => 1000 });
  const seen = [];
  const R = makeBusinessRoutes(Object.assign({ businesses, activity, readBody, emit: (n, p) => seen.push({ name: n, payload: p }) }, extra || {}));
  return { businesses, activity, R, seen };
}
async function callRoute(R, method, url, body) {
  const res = fakeRes();
  const rx = RX_ACTIVITY.test(url) ? RX_ACTIVITY : RX_ONE;
  const match = url.match(rx);
  const h = match ? (RX_ACTIVITY.test(url) ? R.handleActivity : R.handleOne)
    : (url === '/api/businesses' ? (method === 'GET' ? R.handleList : R.handleCreate) : null);
  if (!h) throw new Error('no handler for ' + method + ' ' + url);
  await h(fakeReq(method, url, body), res, match);
  return { code: res.code, json: res.body ? JSON.parse(res.body) : null, headers: res.headers };
}

// A minimal automation engine wired with injected fakes. `ruleMap` is keyed "businessId:eventName".
function makeEngine(ruleMap, opts) {
  opts = opts || {};
  const emits = []; let emitCount = 0; let engineHolder = null;
  const emit = (n, p) => {
    emits.push({ name: n, payload: p });
    if (opts.reentrant) { if (++emitCount > 1000) return; if (engineHolder) engineHolder.handleEvent('business.created', { businessId: 'A' }); }
  };
  const businesses = makeBusinessesStore({ records: [{ id: 'A', name: 'A', stage: 'live', template: 'custom', createdBy: 'user', createdAt: 1, updatedAt: 1 }], persist: () => {} });
  const automation = {
    matching: (bid, name) => (ruleMap[bid + ':' + name] || []),
    canFire: () => ({ ok: true }),
    recordRun: () => ({ ok: true, autoDisabled: false, automation: { disabledReason: '' } }),
    get: (id) => { for (const k in ruleMap) { for (const r of ruleMap[k]) if (r.id === id) return r; } return null; }
  };
  // A single mutable counter object (NOT captured-by-value) so increments are visible after construction.
  const counts = { approvalCalls: 0, projectCalls: 0, taskCalls: 0 };
  const approvals = { create: () => { counts.approvalCalls++; return { ok: true, approval: { id: 'ap' + counts.approvalCalls } }; }, get: () => null, decide: () => ({ ok: true, approval: {} }) };
  // Honour an explicit store if supplied (so a test can make one throw); else build a default if requested.
  const projects = opts.projects || (opts.withProjects ? { create: (bid, o) => { counts.projectCalls++; return { ok: true, project: { id: 'pr' + counts.projectCalls, name: o.name } }; } } : null);
  const tasks = opts.tasks || (opts.withTasks ? { create: (bid, o, prov) => { counts.taskCalls++; return { ok: true, task: { id: 'tk' + counts.taskCalls, title: o.title, status: 'todo', priority: o.priority || 'normal', origin: prov } }; } } : null);
  const content = opts.content || null;
  // forward an injected outbound rail (so the send_external deliver/fail/throw paths are exercisable)
  const engine = makeBusinessAutomationEngine({ automation, approvals, permissions: BP, businesses, projects, tasks, content, outbound: opts.outbound || null, emit, now: () => 1000 });
  engineHolder = engine;
  engine.__counts = counts;
  engine.__emits = emits;
  return engine;
}
function rule(id, event, actions) { return { id, name: id, trigger: event, enabled: true, conditions: [], actions }; }

(async () => {
// ===========================================================================
// 1. AUTH TESTING — apiauth.js (the loopback token gate + origin/host pinning)
// ===========================================================================
{
  A.eq(apiauth.requiresApiToken({ url: '/api/businesses' }), true, 'every business route requires an API token');
  A.eq(apiauth.requiresApiToken({ url: '/api/businesses/acme' }), true, 'a business item route requires a token');
  A.eq(apiauth.requiresApiToken({ url: '/api/automations' }), true, 'an automation route requires a token');
  A.eq(apiauth.requiresApiToken({ url: '/api/health' }), false, '/api/health is exempt (liveness)');
  A.eq(apiauth.requiresApiToken({ method: 'OPTIONS', url: '/api/businesses' }), false, 'OPTIONS preflight is never gated');

  A.eq(apiauth.constTimeEq('secret', 'secret'), true, 'constant-time compare accepts the right token');
  A.eq(apiauth.constTimeEq('secret', 'wrong'), false, 'constant-time compare rejects a wrong token');
  A.eq(apiauth.constTimeEq('', 'secret'), false, 'constant-time compare rejects an empty candidate (no throw)');
  A.eq(apiauth.constTimeEq('secret', ''), false, 'constant-time compare rejects a missing token (no throw)');

  A.eq(apiauth.apiTokenOk({ headers: { 'x-starnet-token': 'T' } }, 'T'), true, 'header token validated');
  A.eq(apiauth.apiTokenOk({ headers: { 'x-starnet-token': 'X' } }, 'T'), false, 'wrong header token rejected');
  A.eq(apiauth.apiTokenOk({ headers: {} }, 'T'), false, 'absent header token rejected');

  A.eq(apiauth.isAllowedApiOrigin('http://evil.example.com', 1234), false, 'foreign origin rejected (DNS-rebinding / CSRF defense)');
  A.eq(apiauth.isAllowedApiOrigin('null'), false, 'sandboxed null origin rejected');
  A.eq(apiauth.isAllowedApiOrigin('http://127.0.0.1:1234', 1234), true, 'loopback origin allowed');
  A.eq(apiauth.isAllowedApiOrigin('http://tauri.localhost', 1234), true, 'tauri scheme origin allowed');

  A.eq(apiauth.isAllowedHost('evil.com'), false, 'foreign host rejected (DNS-rebinding defense)');
  A.eq(apiauth.isAllowedHost('127.0.0.1'), true, 'loopback host allowed');
  A.eq(apiauth.isAllowedHost('localhost'), true, 'localhost host allowed');

  A.eq(apiauth.queryTokenRoute({ method: 'GET', url: '/api/file' }), true, 'GET /api/file may carry a ?token (browser media loads)');
  A.eq(apiauth.queryTokenRoute({ method: 'POST', url: '/api/save' }), true, 'POST /api/save may carry a ?token (unload beacon)');
  A.eq(apiauth.queryTokenRoute({ method: 'GET', url: '/api/businesses' }), false, 'business routes may NOT carry a query token');
}

// ===========================================================================
// 2. PERMISSION AUDIT — business-permissions.js (§13 hard floor)
// ===========================================================================
{
  const c = BP.classify('made_up_action_xyz');
  A.eq(c.ok, false, 'an unclassified action is not silently "safe"');
  A.eq(c.tier, 'restricted', 'an unclassified action falls through to the MOST restrictive tier (fail-closed)');

  A.eq(BP.decide({ action: 'made_up_action_xyz' }).allow, false, 'a decision on an unknown action is refused');
  A.eq(BP.decide({ action: 'made_up_action_xyz' }).approval, 'required', 'a refused decision still demands approval');

  const g = BP.sanitizeGrants({ safe: true, review: true, restricted: true });
  A.eq(g.restricted, false, 'sanitizeGrants FORCES restricted:false — no stored grant can make a restricted action autonomous');
  A.eq(g.review, true, 'sanitizeGrants preserves a legitimately-granted review tier');

  A.eq(BP.decide({ action: 'delete_data' }).allow, false, 'a restricted action is never auto-run');
  A.eq(BP.decide({ action: 'delete_data' }).tier, 'restricted', 'delete_data is restricted per §13');

  A.eq(BP.decide({ action: 'spend_money' }).allow, false, 'a review-tier action is refused without the grant');
  A.eq(BP.decide({ action: 'spend_money', grants: { safe: true, review: true, restricted: false } }).allow, true, 'a review-tier action runs once the review grant is held');

  A.eq(BP.decide({ action: 'research' }).allow, true, 'a safe action runs with the default safe grant');

  // §26 proposed-action block refuses to be presented as justified when its justification is missing.
  A.eq(BP.proposedAction({ what: 'x' }).ok, false, 'a proposed action with no "why" is refused');
  A.eq(BP.proposedAction({ what: 'x', why: 'y' }).ok, false, 'a proposed action with no evidence is refused');
  A.eq(BP.proposedAction({ what: 'x', why: 'y', evidence: [{ text: 'z', evidence: 'unknown' }] }).ok, false, 'a proposal whose evidence is entirely unknown is refused');
  const pa = BP.proposedAction({ what: 'x', why: 'y', evidence: [{ text: 'z', evidence: 'verified' }], risk: 'low', action: 'research' });
  A.eq(pa.ok, true, 'a fully-justified proposal is accepted');
  A.eq(pa.block.evidence[0].evidence, 'verified', 'the proposal carries its evidence class through');
}

// ===========================================================================
// 3. DATA-ISOLATION TESTING — businesses-store.js (P6: isolation by key namespace)
// ===========================================================================
{
  A.eq(makeBusinessesStore({}).memoryNamespace('alpha'), 'biz:alpha', 'memoryNamespace prefixes the business id');
  A.eq(makeBusinessesStore({}).memoryNamespace('beta'), 'biz:beta', 'a different business gets a different namespace');
  A.ok(makeBusinessesStore({}).memoryNamespace('alpha') !== makeBusinessesStore({}).memoryNamespace('beta'), 'two businesses never share a namespace');

  const s = makeBusinessesStore({ persist: () => {} });
  s.create({ name: 'Acme' }); s.create({ name: 'Globex' });
  A.eq(s.get('acme').id, 'acme', 'a business is readable by its exact id');
  A.eq(s.get('globex').id, 'globex', 'the second business is readable by its exact id');
  A.eq(s.get('ac'), null, 'a partial id never resolves to a different business (no cross-read by prefix)');
  A.eq(s.get('ghost'), null, 'an unknown id is null — a tenant cannot be read into existence');

  // Namespaced isolation holds under scale: 100 businesses, each only ever sees its own row via get().
  const big = makeBusinessesStore({ persist: () => {} });
  for (let i = 0; i < 100; i++) big.create({ name: 'Biz ' + i });
  A.eq(big.get('biz-50').name, 'Biz 50', 'isolation holds at scale: the right business is fetched by exact id');
  A.eq(big.get('biz-0').name, 'Biz 0', 'isolation holds at scale: the first business is still exact');
}

// ===========================================================================
// 4. AGENT-BOUNDARY TESTING — business-agents-store.js (P6: never across businesses)
// ===========================================================================
{
  // Seed two businesses each with one agent; ids follow "<businessId>~a<seq>".
  const agents = makeBusinessAgentsStore({
    records: [
      { id: 'A~a1', seq: 1, businessId: 'A', role: 'researcher', specialty: 'x', name: 'R', status: 'idle', grants: { safe: true, review: false, restricted: false }, hiredBy: 'user', createdAt: 1, updatedAt: 1 },
      { id: 'B~a1', seq: 1, businessId: 'B', role: 'researcher', specialty: 'x', name: 'R', status: 'idle', grants: { safe: true, review: false, restricted: false }, hiredBy: 'user', createdAt: 1, updatedAt: 1 }
    ], persist: () => {}
  });
  A.eq(agents.list('A').length, 1, 'business A sees exactly its own agent');
  A.eq(agents.list('B').length, 1, 'business B sees exactly its own agent');
  A.eq(agents.list('A')[0].id, 'A~a1', 'A’s agent is A’s agent');
  A.ok(agents.list('A').every(a => a.businessId === 'A'), 'A’s agent list contains no other venture');
  A.ok(!agents.list('A').some(a => a.id === 'B~a1'), 'B’s agent never leaks into A’s list');
  A.eq(agents.get('B~a1').businessId, 'B', 'an agent fetched by global id reports its real owner');
  A.eq(agents.memoryNamespace('A~a1'), 'biz:A:agent:A~a1', 'an agent’s memory namespace is prefixed by ITS business first');
  A.eq(agents.decide('ghost', 'research').allow, false, 'an unknown agent is denied (fail-closed), never granted by default');
}

// ===========================================================================
// 5. FAILURE TESTING — routes + stores fail safe, never silently
// ===========================================================================
{
  // malformed JSON -> 400, not a crash
  const r1 = routeHarness();
  A.eq((await callRoute(r1.R, 'POST', '/api/businesses', '{not json')).code, 400, 'malformed JSON is 400, not a 500');

  // body over MAX_BODY (16 KiB) -> 413
  const r2 = routeHarness();
  A.eq((await callRoute(r2.R, 'POST', '/api/businesses', 'x'.repeat(20000))).code, 413, 'an oversized body is rejected with 413 (size cap enforced)');

  // unknown id -> 404
  const r3 = routeHarness();
  await callRoute(r3.R, 'POST', '/api/businesses', { name: 'Acme' });
  A.eq((await callRoute(r3.R, 'GET', '/api/businesses/ghost')).code, 404, 'reading an unknown business is 404, never a leak');

  // store persist that throws => create fails closed, memory untouched
  const s = makeBusinessesStore({ persist: () => { throw new Error('disk full'); } });
  const created = s.create({ name: 'Acme' });
  A.eq(created.ok, false, 'a failed persist makes the create fail closed (ok:false)');
  A.eq(s.count(), 0, 'a failed persist leaves no business visible in memory');

  // engine: one action that throws must not abandon the rest of the run, and must not crash the engine
  let boom = 0;
  const eng = makeEngine({ 'A:business.created': [rule('r1', 'business.created', [{ action: 'create_task', params: { title: 't' } }])] }, {
    withTasks: true,
    tasks: { create: () => { if (++boom === 1) throw new Error('task store exploded'); return { ok: true, task: { id: 'tk', title: 't', status: 'todo', priority: 'normal', origin: 'automation' } }; } }
  });
  let threw = null;
  let out = null;
  try { out = eng.handleEvent('business.created', { businessId: 'A' }); } catch (e) { threw = e; }
  A.eq(threw, null, 'a throwing action store does not crash the engine');
  A.eq(out.results[0].ok, false, 'the run that hit the broken store is recorded as failed, not vanished');
  A.ok(eng.stats().failures >= 1, 'a failed run is counted in the failure counter (visible, not silent)');
}

// ===========================================================================
// 6. API-FAILURE TESTING — graceful degradation, honest errors, no fake sends
// ===========================================================================
{
  const s = makeBusinessesStore({ persist: () => {} });
  A.eq(s.create({}).ok, false, 'creating with no name returns a structured refusal (no throw)');
  A.ok(typeof s.create({}).reason === 'string', 'the refusal carries a human reason, not a stack trace');
  A.eq(s.get('ghost'), null, 'reading a missing business returns null (no throw)');

  const eng = makeEngine({}, {});
  const noExec = eng.executeAction('A', 'no_such_action', {});
  A.eq(noExec.ok, false, 'an action with no executor fails gracefully (no throw)');
  A.ok(/unknown action/.test(noExec.reason), 'an unknown action explains itself (structured reason, no crash)');

  // §13 external actions: the station has no payment rail — approving records authorization only.
  const ext = eng.executeAction('A', 'spend_money', { amount: 1, currency: 'USD', description: 'x' });
  A.eq(ext.ok, true, 'a spend action is "handled"');
  A.eq(ext.delivered, false, 'a spend action claims NOTHING was delivered (no fake send — P2)');
  A.ok(ext.external === true, 'the external flag is honest about what happened');

  // The outbound rail, when injected, must deliver — and must never lie about a failure (P2/P7).
  // AWAIT, never `return`: a return here would exit the whole IIFE and silently skip sections 7-10 + report().
  const railSent = [];
  const rail = makeEngine({}, { outbound: { send: (o) => { railSent.push(o); return Promise.resolve({ ok: true }); } } });
  const r = await rail.executeAction('A', 'send_external', { to: 'x@y.z', subject: 's', body: 'hello' });
  A.eq(r.ok, true, 'an injected outbound rail makes send_external succeed');
  A.eq(r.delivered, true, 'and it reports a REAL delivery, not a phantom authorization');
  A.ok(railSent.length === 1 && /hello/.test(railSent[0].text), 'the rail received the composed message');
  // a rail that reports failure must fail the action
  const fail = makeEngine({}, { outbound: { send: () => Promise.resolve({ ok: false, error: 'nope' }) } });
  const rf = await fail.executeAction('A', 'send_external', { to: 'x@y.z', subject: 's', body: 'b' });
  A.eq(rf.ok, false, 'a rail failure fails the action — never a phantom success');
  // a rail that throws must be caught, not propagated into the engine
  const thr = makeEngine({}, { outbound: { send: () => { throw new Error('boom'); } } });
  const rt = await thr.executeAction('A', 'send_external', { to: 'x@y.z', subject: 's', body: 'b' });
  A.eq(rt.ok, false, 'a throwing rail is caught and reported as a failure, not propagated');
  A.ok(/threw/.test(rt.reason), 'and the throw is named in the reason');
}

// ===========================================================================
// 7. AUTOMATION-SAFETY TESTING — §13 tiers, §19 E-STOP, cascade guards (business-automation-engine.js)
// ===========================================================================
{
  // tier derivation is honest: safe runs, review needs approval, unknown is treated restricted.
  const probe = makeEngine({}, {});
  A.eq(probe.tierOf('create_task'), 'safe', 'create_task derives a safe tier');
  A.eq(probe.tierOf('spend_money'), 'review', 'spend_money derives a review tier');
  A.eq(probe.tierOf('delete_data'), 'restricted', 'an unclassified automation action is treated restricted (never runs)');

  // safe action runs
  const safe = makeEngine({ 'A:business.created': [rule('r1', 'business.created', [{ action: 'create_project', params: { name: 'p' } }])] }, { withProjects: true });
  safe.handleEvent('business.created', { businessId: 'A' });
  A.ok(safe.__counts.projectCalls >= 1, 'a safe automation action actually executes its store write');
  A.ok(safe.stats().ran >= 1, 'the safe run is counted');

  // review action becomes a pending approval, NOT an execution
  const rev = makeEngine({ 'A:business.created': [rule('r1', 'business.created', [{ action: 'spend_money', params: { amount: 1, currency: 'USD', description: 'x' } }])] }, {});
  rev.handleEvent('business.created', { businessId: 'A' });
  A.ok(rev.__counts.approvalCalls >= 1, 'a review-tier action is routed to the approval queue');
  A.eq(rev.__counts.projectCalls, 0, 'a review-tier action is NOT executed on its own');

  // restricted (unknown) action is skipped, run still recorded as failed
  const res = makeEngine({ 'A:business.created': [rule('r1', 'business.created', [{ action: 'delete_data', params: {} }])] }, {});
  const resOut = res.handleEvent('business.created', { businessId: 'A' });
  A.ok(resOut.results[0] && resOut.results[0].ok === false, 'a restricted automation action is skipped and the failure is recorded');
  A.eq(res.stats().failures, 1, 'the skipped restricted action is counted as a failure (visible)');

  // §19 E-STOP: halt stops all automation; resume restores it.
  const estop = makeEngine({ 'A:business.created': [rule('r1', 'business.created', [{ action: 'create_project', params: { name: 'p' } }])] }, { withProjects: true });
  const halted = estop.halt();
  A.eq(halted.halted, true, 'halt() engages the hub E-STOP');
  const blocked = estop.handleEvent('business.created', { businessId: 'A' });
  A.eq(blocked.ok, false, 'while halted, no event is processed');
  A.ok(/halt/i.test(blocked.reason), 'the halt is explained in the refusal reason');
  A.ok(estop.stats().skippedHalted >= 1, 'the halt is counted as skipped, not silently dropped');
  estop.resume();
  estop.handleEvent('business.created', { businessId: 'A' });
  A.ok(estop.__counts.projectCalls >= 1, 'after resume(), automations run again');

  // Cascade guard: a self-retriggering automation is bounded by depth AND pass budget, never infinite.
  const cascade = makeEngine({ 'A:business.created': [rule('r1', 'business.created', [{ action: 'create_project', params: { name: 'p' } }])] }, { withProjects: true, reentrant: true });
  const cOut = cascade.handleEvent('business.created', { businessId: 'A' });
  A.ok(cOut.ran >= 2, 'the cascade actually propagated (depth > 1)');
  A.ok(cOut.ran <= MAX_RUNS_PER_PASS, 'the cascade is bounded by the pass budget (MAX_RUNS_PER_PASS=' + MAX_RUNS_PER_PASS + ')');
  A.ok(cascade.stats().skippedDepth >= 1, 'the depth guard fired — the cascade could not grow without limit');

  // P6 cross-business guard inside an automation: a publish targeting another venture's content is refused.
  const xbiz = makeEngine({}, { content: { piece: (id) => (id === 'pieceA' ? { businessId: 'A' } : null), advance: () => ({ ok: true }) } });
  const xr = xbiz.executeAction('B', 'publish_content', { pieceId: 'pieceA' }, 0);
  A.eq(xr.ok, false, 'an automation cannot publish content that belongs to a different business (P6)');
  A.ok(/cross-business/.test(xr.reason), 'the cross-business refusal explains itself');
}

// ===========================================================================
// 8. BACKUP / RECOVERY TESTING — durability, reload, and corruption resilience
// ===========================================================================
{
  // Durability + recovery: a persist that records to "disk"; reload from that disk reconstructs state.
  const disk = [];
  const w = makeBusinessesStore({ persist: (rows) => { disk.length = 0; for (const r of rows) disk.push(r); }, now: () => 1 });
  w.create({ name: 'Acme' });
  A.eq(disk.length, 1, 'a create is persisted to durable storage');
  const reloaded = makeBusinessesStore({ records: disk, persist: () => {}, now: () => 2 });
  A.eq(reloaded.get('acme').name, 'Acme', 'reloading from durable storage recovers the business (recovery works)');

  // Corruption resilience: a malformed record must not crash reads.
  let crashed = null; let listed = null;
  try {
    const corrupt = makeBusinessesStore({ records: [{ id: 'ok', name: 'OK', stage: 'idea', template: 'custom', createdBy: 'user', createdAt: 1, updatedAt: 1 }, { name: 'broken-no-id' }], persist: () => {} });
    listed = corrupt.list();
  } catch (e) { crashed = e; }
  A.eq(crashed, null, 'a store seeded with a malformed record does not throw on read');
  A.ok(Array.isArray(listed), 'reads against a partially-corrupt dataset still return a list');

  // Emit-throws resilience: a mutation still commits when telemetry throws.
  const r = routeHarness({ emit: () => { throw new Error('bus down'); } });
  const cr = await callRoute(r.R, 'POST', '/api/businesses', { name: 'Acme' });
  A.eq(cr.code, 201, 'a throwing bus still returns 201 — telemetry cannot veto a committed write');
  A.ok(r.businesses.has('acme'), 'the business really was committed despite the telemetry failure');
}

// ===========================================================================
// 9. PERFORMANCE TESTING — scaling correctness under load (no O(N^2) blow-up)
// ===========================================================================
{
  const N = 300;
  const s = makeBusinessesStore({ persist: () => {} });
  const t0 = Date.now();
  for (let i = 0; i < N; i++) s.create({ name: 'Biz ' + i });
  const listed = s.list();
  const elapsed = Date.now() - t0;
  A.eq(listed.length, N, 'creating ' + N + ' businesses keeps the list complete');
  A.eq(s.get('biz-299').name, 'Biz 299', 'exact lookup still resolves the last-created business');
  A.eq(s.get('biz-0').name, 'Biz 0', 'exact lookup still resolves the first-created business');
  A.ok(elapsed < 10000, 'bulk create+list of ' + N + ' businesses completed in ' + elapsed + 'ms (no gross regression)');
}

// ===========================================================================
// 10. SECURITY AUDIT — no secret fields, privacy headers, token gating, route-table trap
// ===========================================================================
{
  const s = makeBusinessesStore({ persist: () => {} });
  const b = s.create({ name: 'Acme' }).business;
  const SECRET_KEYS = ['token', 'secret', 'password', 'apiKey', 'api_key', 'privateKey'];
  A.ok(!Object.keys(b).some(k => SECRET_KEYS.indexOf(k.toLowerCase()) >= 0), 'a business entity carries no secret/credential field');

  const r = routeHarness();
  const res = await callRoute(r.R, 'GET', '/api/businesses');
  A.eq(res.headers && res.headers['Cache-Control'], 'no-store', 'business API responses set Cache-Control: no-store (no caching of private data)');

  // Every business route requires a token (auth cannot be opted out of by a path).
  const businessPaths = ['/api/businesses', '/api/businesses/acme', '/api/businesses/acme/activity', '/api/automations', '/api/approvals', '/api/workorders', '/api/agents', '/api/manager', '/api/tasks'];
  A.ok(businessPaths.every(p => apiauth.requiresApiToken({ url: p })), 'all sampled Business OS paths require an API token');

  // Route-table trap: no Business OS route module may use the `qrx` matcher (it leaves match===null and
  // every business-scoped lookup 404s). Asserted at the source so a future edit cannot silently regress it.
  const routeFiles = ['business-routes', 'maker-routes', 'task-routes', 'agent-routes', 'manager-routes', 'automation-routes', 'worker-routes'];
  for (const f of routeFiles) {
    const lines = fs.readFileSync(path.join(__dirname, '..', 'sidecar', f + '.js'), 'utf8').split('\n');
    // A qrx is the route-table trap ONLY when its regex captures a path segment (a "("): qrx leaves the
    // handler's match array null, so a handler relying on match[1] would 404 every lookup. Query GETs whose
    // qrx carries no capture group are correct (index.js strips the query before matching). A "(" in the
    // regex literal denotes a capture group — the only form that causes the trap.
    const bad = lines.some(l => /qrx\s*:/.test(l) && /\(/.test(l));
    A.ok(!bad, 'sidecar/' + f + '.js has no qrx matcher that captures a path segment (route-table trap avoided)');
  }

  // ---------------------------------------------------------------------------
  // 5. THE WORKER'S BROWSER IS READ-ONLY (§10's "controlled browser worker").
  //    A business worker may READ the open web (navigate/snapshot/get_text/...)
  //    and must never be able to ACT on it (click/type/upload/eval/login/...).
  //    Asserted at the source because the fence lives in TWO places that must
  //    agree: the policy's tier table AND makeWorkerRegistry()'s filter in
  //    index.js. If a future edit widens either one, this fails loudly.
  // ---------------------------------------------------------------------------
  {
    const idx = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'index.js'), 'utf8');
    // Locate the browser registration inside makeWorkerRegistry() specifically — not the normal-run
    // browser, which legitimately carries the interactive tools.
    const fnStart = idx.indexOf('function makeWorkerRegistry()');
    A.ok(fnStart > 0, 'makeWorkerRegistry() is found in sidecar/index.js');
    const fnEnd = idx.indexOf('\nfunction ', fnStart + 10);
    const rawBody = fnEnd > fnStart ? idx.slice(fnStart, fnEnd) : idx.slice(fnStart);
    // Strip comments before scanning: the header and inline notes in this function deliberately NAME the
    // options it does not pass (e.g. "NO attendedLogin"), so a naive scan would read the explanation as
    // the thing it denies. Code only.
    const body = rawBody.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

    // The registry builds the browser toolset then filters it to the research tier.
    A.ok(/makeBrowserTools\s*\(/.test(body), 'the worker registry builds a browser toolset');
    A.ok(/\.tools\.filter\(/.test(body), 'and FILTERS the toolset rather than registering all of it');

    // The allow-set names exactly the read tools — every one §13 `research`.
    const READ = ['navigate', 'snapshot', 'find', 'inspect', 'get_text', 'screenshot', 'pdf', 'vision', 'console', 'network', 'tabs', 'wait'];
    for (const t of READ) {
      A.ok(body.indexOf("'browser." + t + "'") >= 0, "the worker may read: browser." + t);
    }
    // And NO interactive tool may appear in the allow-set. This is the load-bearing assertion: a
    // regression that adds e.g. browser.click to the Set would make the worker able to act on the web.
    const ACT = ['click', 'type', 'press', 'select', 'hover', 'scroll', 'drag', 'upload', 'dialog', 'emulate', 'eval', 'intercept', 'attach', 'detach', 'login', 'back', 'forward', 'tab_select', 'tab_close', 'viewport'];
    for (const t of ACT) {
      A.ok(body.indexOf("'browser." + t + "'") < 0, "the worker must NOT be granted browser." + t);
    }

    // The session posture: an unattended worker browses anonymously. These four defaults are what make
    // that true, and each is a deliberate asymmetry against the normal interactive run.
    A.ok(/forceHeadless:\s*true/.test(body), 'the worker browser is headless');
    A.ok(/syntheticInputOnly:\s*true/.test(body), 'and takes synthetic input only (no OS-level cursor)');
    A.ok(/cdpPort:\s*0/.test(body), 'and opens CDP on an ephemeral port');
    A.ok(/cleanupProfile:\s*true/.test(body), 'and burns its profile afterwards');
    A.ok(!/persistentProfile\s*:/.test(body), 'AND IS PASSED NO PERSISTENT PROFILE LEASE (it cannot inherit a signed-in identity)');
    A.ok(!/attendedLogin\s*:/.test(body), 'and no attended-login channel (browser.login refuses honestly)');

    // Second fence: the policy already calls every interactive browser tool restricted. Prove the two
    // layers are consistent by reading the policy table rather than trusting the comment.
    const Pol = require(path.join(__dirname, '..', 'sidecar', 'business-worker-policy.js'));
    for (const t of READ) {
      const c = Pol.actionFor('browser.' + t);
      A.eq(c && c.action, 'research', 'policy agrees: browser.' + t + ' is §13 research');
    }
    for (const t of ACT) {
      const c = Pol.actionFor('browser.' + t);
      A.ok(c && c.action !== 'research', 'policy fences browser.' + t + ' out of the safe tier');
    }
  }
}

A.report('business-os-hardening.test');
})().catch(e => { console.error('business-os-hardening.test CRASHED:', (e && e.stack) || e); process.exit(1); });
