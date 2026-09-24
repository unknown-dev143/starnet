'use strict';
/* test/worker-routes.test.js — the AI WORKER HTTP surface (Business OS Phase 6).

   Exercised with FAKE req/res, because index.js self-boots and cannot be require()d — the handlers take
   readBody/respondJson by injection precisely so this is possible.

   THE TRAP THIS TEST EXISTS FOR, and it is the same one that bit Phase 4 and Phase 5: index.js's dispatch
   populates the match array only for `rx` rows; a `qrx` row leaves it NULL, so a handler reading `match[1]`
   gets undefined and every id lookup 404s while looking completely correct. Every business-scoped GET here
   carries a query, so all of them must be `rx` with a query-tolerant tail. The dispatch below is a faithful
   copy of index.js's loop, so a wrong match key fails HERE.

   The load-bearing behaviours:
     · CREATING AN ORDER DOES NOT RUN IT. There is no route that runs an order as a side effect of creating
       one, so "plan" and "run" can never be confused by a caller (§19).
     · A TIER IS NEVER ACCEPTED FROM THE REQUEST. The policy recomputes it; a body claiming one is ignored.
     · THE TWO APPROVAL DECIDERS ARE NOT INTERCHANGEABLE. A request with no `params.orderId` was filed by the
       Phase 5 automation engine and is refused here with a 409 — the two execution paths are kept apart.
     · DELETING AN ORDER EXPIRES ITS PENDING REQUESTS rather than orphaning them in the owner's queue.
     · A BUSINESS THAT DOES NOT EXIST is a 404, never a silent empty list (P6).
*/
const A = require('./_assert.js');
const WR = require('../sidecar/worker-routes.js');
const W = require('../sidecar/business-worker.js');
const Policy = require('../sidecar/business-worker-policy.js');
const Orders = require('../sidecar/business-workorders-store.js');
const Approvals = require('../sidecar/business-approvals-store.js');
const P = require('../sidecar/business-permissions.js');
const { makeBusinessesStore } = require('../sidecar/businesses-store.js');

function fakeRes() {
  return { code: null, body: null, headers: null, writeHead(c, h) { this.code = c; this.headers = h; return this; }, end(s) { this.body = s; } };
}
function fakeReq(method, url, body) {
  return { method, url, _body: body === undefined ? '' : (typeof body === 'string' ? body : JSON.stringify(body)) };
}
async function readBody(req) { return req._body || ''; }

let T = 1_700_000_000_000;
function clock() { return (T += 1000); }

const WIRED = ['fs.read', 'fs.write', 'channel.send', 'shell.exec'];
const DESCRIBE = (n) => ({
  'fs.read': { name: n, scope: 'read', capability: 'cabinet' },
  'fs.write': { name: n, scope: 'write', requiresConsent: true, capability: 'cabinet' },
  'channel.send': { name: n, scope: 'write', requiresConsent: true, capability: 'comm' },
  'shell.exec': { name: n, scope: 'execute', capability: 'workbench' }
}[n] || null);

function harness(over) {
  over = over || {};
  const calls = [];
  const seen = [];
  const workorders = Orders.makeBusinessWorkOrders({ records: [], now: clock });
  const approvals = Approvals.makeBusinessApprovalsStore({ records: [], now: clock, permissions: P });
  const businesses = makeBusinessesStore({ records: [], persist: () => {}, now: clock });
  businesses.create({ name: 'Acme' });
  const worker = W.makeBusinessWorker({
    workorders, policy: Policy, permissions: P, approvals, agents: null,
    dispatch: (call, ctx) => { calls.push(call); return over.dispatch ? over.dispatch(call, ctx) : { ok: true, content: 'done', summary: 'ok' }; },
    available: () => (over.wired || WIRED),
    describe: DESCRIBE,
    makeCtx: (info) => ({ agentId: info.agentId || '', businessId: info.businessId }),
    emit: () => {}, now: clock, log: () => {}
  });
  const R = WR.makeWorkerRoutes({
    workorders, worker, approvals, businesses, readBody,
    consentFor: over.consentFor || (() => () => ({ allow: true, reason: 'test grant' })),
    emit: (name, payload) => seen.push({ name, payload })
  });
  return { workorders, approvals, businesses, worker, calls, seen, R };
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
  return null;   // no row matched
}
function json(res) { try { return JSON.parse(res.body || '{}'); } catch (_) { return null; } }
const bizId = (businesses, name) => { const b = businesses.list().filter(x => x.name === name)[0]; return b ? b.id : null; };

(async () => {

/* ---------- every route row has exactly ONE match key, and no qrx row exists ---------- */
{
  const { R } = harness();
  A.ok(R.routes.length >= 9, 'the surface has the full set of rows (' + R.routes.length + ')');
  for (const r of R.routes) {
    const keys = ['exact', 'qsplit', 'prefix', 'qprefix', 'rx', 'qrx'].filter(k => r[k] !== undefined);
    A.eq(keys.length, 1, 'row ' + JSON.stringify(r.m) + ' has exactly ONE match key (found ' + keys.join(',') + ')');
    A.ok(typeof r.h === 'function', 'every row has a handler');
  }
  // THE PHASE 4 LESSON: a qrx row hands its handler match === null. Not one row here may be qrx.
  A.eq(R.routes.filter(r => r.qrx !== undefined).length, 0, 'NO row is qrx — a qrx row would pass match === null and every id read would be undefined');

  const TAIL = '(?:\\?[^#]*)?$';
  // each query-reading row, paired with the bare path it must match (the summary row is a DIFFERENT path, so
  // asserting it against /workorders would be asserting the wrong thing)
  const readsAQuery = [
    [WR.RX_BIZ_WORKORDERS, '/api/businesses/acme/workorders'],
    [WR.RX_BIZ_WO_SUMMARY, '/api/businesses/acme/workorders/summary']
  ];
  for (const [rx, barePath] of readsAQuery) {
    A.ok(String(rx).indexOf(TAIL) >= 0, String(rx) + ' accepts an optional query tail (its handler reads a query)');
    // the tail must be OPTIONAL, or a plain GET without a query would stop matching
    A.ok(rx.test(barePath), 'and it still matches WITHOUT a query (' + barePath + ')');
    A.ok(rx.test(barePath + '?status=done'), 'and WITH one');
  }
  // the summary path is distinct, so a plain collection GET can never be mistaken for it
  A.ok(!WR.RX_BIZ_WO_SUMMARY.test('/api/businesses/acme/workorders'), 'the summary row does not swallow the collection GET');
  A.ok(WR.RX_BIZ_WORKORDERS.test('/api/businesses/acme/workorders'), 'and the collection row does match it');
  // an id must survive a '~', which is what the store mints
  A.ok(WR.RX_WORKORDER.test('/api/workorders/acme~w1'), 'a work order id with ~ matches');
  A.ok(WR.RX_WO_RUN.test('/api/workorders/acme~w1/run'), 'the run route matches');
  A.ok(WR.RX_WO_APPROVE.test('/api/worker/approvals/acme~v1/approve'), 'the approve route matches');
  A.ok(WR.RX_WO_REJECT.test('/api/worker/approvals/acme~v1/reject'), 'the reject route matches');
  A.ok(!WR.RX_WORKORDER.test('/api/workorders/acme~w1/run'), 'and the plain GET route does NOT swallow the run path');
}

/* ---------- the catalog is served from the module that enforces the rules ---------- */
{
  const { R } = harness();
  const res = await dispatch(R, 'GET', '/api/worker/catalog');
  A.eq(res.code, 200, 'GET /api/worker/catalog is 200');
  const body = json(res);
  A.ok(body.rows.length >= 60, 'and serves the whole policy table (' + body.rows.length + ')');
  A.ok(body.rows.every(r => r.wired !== undefined), 'every row carries a wired flag');
  A.ok(body.scopeFloor && body.scopeFloor.write === 'review', 'and the scope floor, so the UI can explain a hold');
}

/* ---------- test a plan WITHOUT writing anything (§19's "look before you leap") ---------- */
{
  const { R, workorders, businesses } = harness();
  const id = bizId(businesses, 'Acme');
  const res = await dispatch(R, 'POST', '/api/worker/test', {
    businessId: id, steps: [{ tool: 'fs.read', why: 'r' }, { tool: 'shell.exec', why: 'look' }]
  });
  A.eq(res.code, 200, 'POST /api/worker/test is 200');
  const body = json(res);
  A.ok(body.dryRun === true, 'and the payload says it was a dry run');
  A.eq(body.steps.length, 2, 'and classifies every step');
  A.eq(workorders.count(id), 0, 'AND NOTHING WAS CREATED — it is a look, not a job');
  A.ok(!dispatch(R, 'POST', '/api/worker/test', { steps: [{ tool: 'fs.read', why: 'r' }] }).code,
    'a test with no business does not match the catalog route', true);
  const noBiz = await dispatch(R, 'POST', '/api/worker/test', { steps: [{ tool: 'fs.read', why: 'r' }] });
  A.eq(noBiz.code, 404, 'a test with no business is a 404, never an unscoped classification');
}

/* ---------- CREATING AN ORDER DOES NOT RUN IT ---------- */
{
  const { R, businesses, calls } = harness();
  const id = bizId(businesses, 'Acme');
  const res = await dispatch(R, 'POST', '/api/businesses/' + id + '/workorders', {
    intent: 'do the thing',
    steps: [{ tool: 'fs.read', args: { path: 'a' }, why: 'read it' }]
  });
  A.eq(res.code, 201, 'creating an order is a 201');
  const body = json(res);
  A.ok(body.ok, 'and reports ok');
  A.eq(body.ran, false, 'AND THE PAYLOAD SAYS IT DID NOT RUN — creating and running are separate acts (§19)');
  A.eq(body.workorder.status, 'planned', 'and the order is planned');
  A.eq(calls.length, 0, 'AND NOTHING WAS DISPATCHED — there is no route that runs an order by creating it');
}

/* ---------- a step is refused without a reason (§26), and a bad business is a 404 ---------- */
{
  const { R, businesses } = harness();
  const id = bizId(businesses, 'Acme');
  const noWhy = await dispatch(R, 'POST', '/api/businesses/' + id + '/workorders', {
    intent: 'x', steps: [{ tool: 'fs.read' }]
  });
  A.eq(noWhy.code, 422, 'a step with no reason is a 422, never a silent queued step');
  A.ok(/reason/.test(json(noWhy).error), 'and the error names the missing reason');

  const ghost = await dispatch(R, 'GET', '/api/businesses/ghost/workorders');
  A.eq(ghost.code, 404, 'a business that does not exist is a 404, never a silent empty list (P6)');
  const ghostPost = await dispatch(R, 'POST', '/api/businesses/ghost/workorders', { intent: 'x', steps: [{ tool: 'fs.read', why: 'r' }] });
  A.eq(ghostPost.code, 404, 'and so is creating one under it');
}

/* ---------- listing, filtering and the summary ---------- */
{
  const { R, businesses, workorders } = harness();
  const id = bizId(businesses, 'Acme');
  const o = json(await dispatch(R, 'POST', '/api/businesses/' + id + '/workorders', {
    intent: 'x', steps: [{ tool: 'fs.read', why: 'r' }]
  })).workorder;
  workorders.recordStep(o.id, 1, { status: 'executed' });
  workorders.finish(o.id);

  const list = await dispatch(R, 'GET', '/api/businesses/' + id + '/workorders');
  A.eq(list.code, 200, 'listing is 200');
  A.eq(json(list).count, 1, 'and counts the order');
  A.ok(json(list).summary, 'and carries the store summary');

  const filtered = await dispatch(R, 'GET', '/api/businesses/' + id + '/workorders?status=done');
  A.eq(json(filtered).count, 1, 'filtering by a real status works');

  const badFilter = await dispatch(R, 'GET', '/api/businesses/' + id + '/workorders?status=nonsense');
  A.eq(badFilter.code, 422, 'an unknown status filter is a 422');

  const open = await dispatch(R, 'GET', '/api/businesses/' + id + '/workorders?open=1');
  A.eq(json(open).count, 0, 'the finished order is not open');

  const sum = await dispatch(R, 'GET', '/api/businesses/' + id + '/workorders/summary');
  A.eq(sum.code, 200, 'the summary route is 200');
  A.eq(json(sum).summary.total, 1, 'and counts the order');
}

/* ---------- one order: get and delete ---------- */
{
  const { R, businesses, approvals } = harness();
  const id = bizId(businesses, 'Acme');
  const o = json(await dispatch(R, 'POST', '/api/businesses/' + id + '/workorders', {
    intent: 'x', steps: [{ tool: 'channel.send', why: 'tell them' }]
  })).workorder;

  const one = await dispatch(R, 'GET', '/api/workorders/' + o.id);
  A.eq(one.code, 200, 'GET one order is 200');
  A.ok(json(one).summary, 'and carries the derived summary');

  A.eq((await dispatch(R, 'GET', '/api/workorders/nope~w9')).code, 404, 'an unknown order is a 404');

  // file a pending request for it, then delete the order — the request must not outlive it
  await dispatch(R, 'POST', '/api/workorders/' + o.id + '/run', {});
  A.eq(approvals.list(id).filter(a => a.status === 'pending').length, 1, 'running held the review step and filed a request');

  const del = await dispatch(R, 'DELETE', '/api/workorders/' + o.id);
  A.eq(del.code, 200, 'DELETE is 200');
  A.eq(json(del).expiredApprovals, 1, 'AND THE PENDING REQUEST WAS EXPIRED, not orphaned in the owner\'s queue');
  A.eq(approvals.list(id).filter(a => a.status === 'pending').length, 0, 'so nothing is left pending');
}

/* ---------- RUN: unattended is the default and holds what it cannot decide ---------- */
{
  const { R, businesses, calls } = harness();
  const id = bizId(businesses, 'Acme');
  const o = json(await dispatch(R, 'POST', '/api/businesses/' + id + '/workorders', {
    intent: 'x', steps: [{ tool: 'fs.read', why: 'read it' }, { tool: 'shell.exec', why: 'look' }]
  })).workorder;

  const run = await dispatch(R, 'POST', '/api/workorders/' + o.id + '/run', {});
  A.eq(run.code, 200, 'running is 200');
  const body = json(run);
  A.eq(body.attended, false, 'and the payload reports it ran UNATTENDED — the default, not an omission');
  A.eq(calls.length, 1, 'exactly one dispatch: the safe step ran, the restricted one never reached the registry');
  A.eq(body.workorder.steps[0].status, 'executed', 'the safe step executed');
  A.eq(body.workorder.steps[1].status, 'refused', 'the restricted step was refused');
  A.eq(body.workorder.status, 'partial', 'so the order settles as partial — derived, not asserted');
  A.ok(Array.isArray(body.receipts) && body.receipts.length === 2, 'and every step produced a receipt');
}

/* ---------- RUN: a dry run and a finished order are refused ---------- */
{
  const { R, businesses } = harness();
  const id = bizId(businesses, 'Acme');
  const dry = json(await dispatch(R, 'POST', '/api/businesses/' + id + '/workorders', {
    intent: 'x', steps: [{ tool: 'fs.read', why: 'r' }], dryRun: true
  })).workorder;
  const bad = await dispatch(R, 'POST', '/api/workorders/' + dry.id + '/run', {});
  A.eq(bad.code, 409, 'running a dry run is a 409');
  A.ok(/dry run/.test(json(bad).error), 'and the error says why');

  A.eq((await dispatch(R, 'POST', '/api/workorders/nope~w1/run', {})).code, 404, 'running an unknown order is a 404');
}

/* ---------- THE TWO APPROVAL DECIDERS ARE NOT INTERCHANGEABLE ---------- */
{
  const { R, businesses, approvals } = harness();
  const id = bizId(businesses, 'Acme');
  // a request filed WITHOUT params.orderId belongs to the Phase 5 automation engine. It must be created in
  // the SAME store the route under test reads, or the 404 would be about the id and not about the rule.
  const built = approvals.create(id, {
    action: 'spend_money', tier: 'review', actionId: 'spend_money',
    params: { amount: '10', currency: 'USD', description: 'ads' },
    what: 'Spend 10 USD', why: 'the rule said so',
    evidence: [{ text: 'a real event fired', evidence: 'verified', source: 'event:task.created' }],
    risk: 'high', effect: '{}'
  });
  A.ok(built.ok, 'an automation-style request was filed');

  // deciding it through the WORKER surface must be refused — the two execution paths are not interchangeable
  const wrong = await dispatch(R, 'POST', '/api/worker/approvals/' + built.approval.id + '/approve', { by: 'user' });
  A.eq(wrong.code, 409, 'a request that was NOT filed by a work order is a 409 here');
  A.ok(/automation/.test(json(wrong).error), 'and the error points the caller at the automation surface');

  const wrongReject = await dispatch(R, 'POST', '/api/worker/approvals/' + built.approval.id + '/reject', { by: 'user' });
  A.eq(wrongReject.code, 409, 'and the same holds for reject');

  A.eq((await dispatch(R, 'POST', '/api/worker/approvals/nope~v9/approve', { by: 'user' })).code, 404,
    'an unknown approval is a 404');
}

/* ---------- approve / reject a WORKER-filed request ---------- */
{
  const { R, businesses, approvals, calls } = harness();
  const id = bizId(businesses, 'Acme');
  const o = json(await dispatch(R, 'POST', '/api/businesses/' + id + '/workorders', {
    intent: 'x', steps: [{ tool: 'channel.send', why: 'tell the lead' }]
  })).workorder;
  await dispatch(R, 'POST', '/api/workorders/' + o.id + '/run', {});
  const req = approvals.list(id).filter(a => a.status === 'pending')[0];
  A.ok(req, 'the held step filed a request');

  A.eq(calls.length, 0, 'nothing was dispatched before the owner decided');
  const ap = await dispatch(R, 'POST', '/api/worker/approvals/' + req.id + '/approve', { by: 'user' });
  A.eq(ap.code, 200, 'approving is 200');
  A.eq(calls.length, 1, 'AND NOW IT WAS DISPATCHED — the approval is what unlocked it');
  A.eq(json(ap).workorder.status, 'done', 'and the order settled as done');

  // a decision is final
  const again = await dispatch(R, 'POST', '/api/worker/approvals/' + req.id + '/approve', { by: 'user' });
  A.eq(again.code, 409, 'a second approve is a 409');
  A.eq(calls.length, 1, 'AND STILL EXACTLY ONE DISPATCH — a double-click cannot run it twice');
}

/* ---------- reject ---------- */
{
  const { R, businesses, approvals, calls } = harness();
  const id = bizId(businesses, 'Acme');
  const o = json(await dispatch(R, 'POST', '/api/businesses/' + id + '/workorders', {
    intent: 'x', steps: [{ tool: 'channel.send', why: 'tell the lead' }]
  })).workorder;
  await dispatch(R, 'POST', '/api/workorders/' + o.id + '/run', {});
  const req = approvals.list(id).filter(a => a.status === 'pending')[0];

  const rj = await dispatch(R, 'POST', '/api/worker/approvals/' + req.id + '/reject', { by: 'user', reason: 'not now' });
  A.eq(rj.code, 200, 'rejecting is 200');
  A.eq(calls.length, 0, 'NOTHING WAS DISPATCHED — a rejection never runs the step');
  A.eq(json(rj).workorder.steps[0].status, 'refused', 'the step is recorded as refused');
  A.eq((await dispatch(R, 'POST', '/api/worker/approvals/' + req.id + '/reject', { by: 'user' })).code, 409,
    'and a second decision is a 409');
}

/* ---------- a bad body is a 400, never a crash ---------- */
{
  const { R, businesses } = harness();
  const id = bizId(businesses, 'Acme');
  const bad = await dispatch(R, 'POST', '/api/businesses/' + id + '/workorders', 'not json at all');
  A.eq(bad.code, 400, 'a malformed body is a 400');
  A.ok(/json/.test(json(bad).error), 'and the error says the json was bad');
}

/* ---------- an unsupported method ---------- */
{
  const { R, businesses } = harness();
  const id = bizId(businesses, 'Acme');
  const o = json(await dispatch(R, 'POST', '/api/businesses/' + id + '/workorders', {
    intent: 'x', steps: [{ tool: 'fs.read', why: 'r' }]
  })).workorder;
  /* No row declares PUT, so the real dispatch falls through to static rather than reaching a handler — which
     is why these are asserted against the HANDLERS. The 405 branch inside them is the defence for a row that
     a future edit widens to `m: ['GET','POST','PUT']` without adding a branch. */
  A.eq((await dispatch(R, 'PUT', '/api/workorders/' + o.id)), null, 'a PUT matches no row, so it falls through');
  const res1 = fakeRes();
  R.handleWorkOrderOne(fakeReq('PUT', '/api/workorders/' + o.id), res1, [null, o.id]);
  A.eq(res1.code, 405, 'and the handler itself answers 405 for an unsupported method');
  const res2 = fakeRes();
  R.handleWorkOrdersFamily(fakeReq('PUT', '/api/businesses/' + id + '/workorders'), res2, [null, id]);
  A.eq(res2.code, 405, 'and the collection family too');
}

/* ---------- deleting emits the audit event ---------- */
{
  const { R, businesses, seen } = harness();
  const id = bizId(businesses, 'Acme');
  const o = json(await dispatch(R, 'POST', '/api/businesses/' + id + '/workorders', {
    intent: 'x', steps: [{ tool: 'fs.read', why: 'r' }]
  })).workorder;
  await dispatch(R, 'DELETE', '/api/workorders/' + o.id);
  A.ok(seen.filter(e => e.name === 'business.workorder.removed').length === 1, 'deleting emits business.workorder.removed');
}

A.report('worker-routes');
})();
