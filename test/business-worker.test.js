'use strict';
/* test/business-worker.test.js — the AI WORKER runner (Business OS Phase 6).

   This is the only place in the business layer that reaches the station's tool registry, so the security
   argument lives here and every branch of it is asserted:

     · THE §13 GATE SITS IN FRONT OF THE STATION'S, NEVER IN PLACE OF IT. `dispatch` is injected — here a fake
       that records what it was asked. Every assertion about "an agent could not do X" is really an assertion
       that dispatch was never called, because a bypass would show up as a call.

     · A RESTRICTED STEP IS REFUSED AND NO APPROVAL IS FILED. Filing one would imply the owner could authorise
       it here, and §13 says a restricted action needs safeguards this run does not have.

     · AN UNWIRED STEP IS REFUSED WITH ITS OWN REASON, NOT HELD. "The policy would allow it but the worker has
       no route to it" and "the policy refuses it" are different facts and a user would act on them
       differently, so they must not both surface as a generic failure.

     · A REVIEW STEP IS HELD AND FILED. This is the whole approval path: plan → hold → file → approve →
       execute. It is driven with an injected review-tier tool because the shipped worker subset deliberately
       carries none (nothing it can reach spends money, messages externally, or publishes) — so the path is
       proven here rather than assumed unreachable.

     · A DECISION IS FINAL. Approving twice cannot run the step twice.

     · THE BROKER GETS THE REAL DESCRIPTOR. permissions.js reads `scopeOf(tool) = tool.scope || 'read'`, so a
       synthetic descriptor handed to the consent gate turns a WRITE into a "read-only" auto-allow. The runner
       must therefore pass the tool's real declaration or not consult at all.

     · FAILURE IS RECORDED, NOT PAPERED OVER. A tool that returns isError is `failed`, never `executed`.

   ASYNC SHAPE. The runner is async (it awaits dispatch and consent), so every behavioural assertion lives in
   one `main()` and `A.report` is called after it settles. A file that called `return` inside each block would
   stop at the first one — Node wraps modules in a function, so a top-level return silently truncates the
   whole suite. */
const A = require('./_assert.js');
const W = require('../sidecar/business-worker.js');
const Policy = require('../sidecar/business-worker-policy.js');
const Orders = require('../sidecar/business-workorders-store.js');
const Approvals = require('../sidecar/business-approvals-store.js');
const P = require('../sidecar/business-permissions.js');

const NOW = 1_700_000_000_000;
const BIZ = 'acme';

/* A fake environment. `wired` is the registry subset; `desc` supplies each tool's real declaration — the two
   are the runner's only view of the station's tool layer, so making them explicit here is what lets a test
   prove the difference between "not allowed" and "not reachable". */
function env(over) {
  over = over || {};
  const calls = [];
  const events = [];
  const wired = over.wired || ['fs.read', 'fs.write', 'channel.send', 'shell.exec'];
  const dispatch = over.dispatch || (() => ({ ok: true, content: 'did it', summary: 'ok' }));
  const workorders = Orders.makeBusinessWorkOrders({ records: [], now: () => NOW });
  const approvals = Approvals.makeBusinessApprovalsStore({ records: [], now: () => NOW, permissions: P });
  const worker = W.makeBusinessWorker({
    workorders: workorders,
    policy: Policy,
    permissions: P,
    approvals: approvals,
    agents: over.agents || null,
    dispatch: (call, ctx) => { calls.push({ call: call, ctx: ctx }); return dispatch(call, ctx); },
    available: () => wired,
    describe: (n) => ({
      'fs.read': { name: n, scope: 'read', capability: 'cabinet' },
      'fs.write': { name: n, scope: 'write', requiresConsent: true, capability: 'cabinet' },
      'channel.send': { name: n, scope: 'write', requiresConsent: true, capability: 'comm' },
      'shell.exec': { name: n, scope: 'execute', capability: 'workbench' }
    }[n] || null),
    makeCtx: (info) => ({ agentId: info.agentId || '', businessId: info.businessId }),
    emit: (name, payload) => events.push({ name: name, payload: payload }),
    now: () => NOW,
    log: () => {}
  });
  return { worker, workorders, approvals, calls, events, wired };
}
const step = (tool, why, args) => ({ tool: tool, why: why, args: args || {} });
const ran = (e) => e.calls.length;
const evOf = (e, name) => e.events.filter(x => x.name === name);

/* ================= synchronous guards ================= */
{
  A.throws(() => W.makeBusinessWorker({}), 'the runner refuses to build without a workorders store');
  A.throws(() => W.makeBusinessWorker({ workorders: {} }), 'and without the policy module');
  A.notThrows(() => env(), 'and builds with the real modules wired');
}

/* ---------- plan: §26 requires a reason, and nothing runs ---------- */
{
  const e = env();
  A.ok(!e.worker.plan('', { intent: 'x', steps: [step('fs.read', 'r')] }).ok, 'a plan needs a business');
  A.ok(!e.worker.plan(BIZ, { steps: [step('fs.read', 'r')] }).ok, 'a plan needs an intent');
  A.ok(!e.worker.plan(BIZ, { intent: 'x' }).ok, 'a plan needs steps');
  const noWhy = e.worker.plan(BIZ, { intent: 'x', steps: [{ tool: 'fs.read' }] });
  A.ok(!noWhy.ok, 'a step with no reason is refused — §26 requires one');
  A.ok(/reason/.test(noWhy.reason), 'and the refusal says so');

  const r = e.worker.plan(BIZ, { intent: 'x', steps: [step('fs.read', 'r'), step('fs.write', 'w')] });
  A.ok(r.ok, 'a well-formed plan is accepted');
  A.eq(r.order.status, 'planned', 'and the order is planned, not run');
  A.eq(ran(e), 0, 'AND NOTHING WAS DISPATCHED — planning is not running');
  A.ok(r.order.steps[0].wired === true, 'each step is annotated with whether the worker can reach it');
}

/* ---------- plan marks an unreachable tool BEFORE it is committed ---------- */
{
  const e = env({ wired: ['fs.read'] });   // fs.write deliberately absent
  const r = e.worker.plan(BIZ, { intent: 'x', steps: [step('fs.read', 'r'), step('fs.write', 'w')] });
  A.ok(r.ok, 'the plan is still accepted');
  A.eq(r.order.steps[0].wired, true, 'the reachable tool is marked wired');
  A.eq(r.order.steps[1].wired, false, 'the unreachable one is marked NOT wired');
  A.eq(r.summary.unwired, 1, 'and the summary counts it, so a user sees it before committing');
}

/* ---------- grantsFor: unknown and cross-business agents ---------- */
{
  const e = env({ agents: { get: (id) => (id === 'a1' ? { id: 'a1', businessId: BIZ, grants: { safe: true, review: true } } : null) } });
  A.eq(e.worker.grantsFor(BIZ, 'a1').review, true, 'a real agent\'s own grants are used');

  const g2 = e.worker.grantsFor(BIZ, 'nope');
  A.eq(g2.safe, P.DEFAULT_GRANTS.safe, 'an unknown agent falls back to the DEFAULT grants, not an empty object');

  // P6: an agent belonging to another business is not this business's agent
  const cross = env({ agents: { get: () => ({ id: 'x', businessId: 'other', grants: { safe: true, review: true, restricted: true } }) } });
  A.eq(cross.worker.grantsFor(BIZ, 'x').review, P.DEFAULT_GRANTS.review,
    'a cross-business agent does NOT bring its grants over (P6)');
}

/* ---------- testPlan classifies and creates NOTHING ---------- */
{
  const e = env();
  const r = e.worker.testPlan(BIZ, { steps: [step('fs.read', 'r'), step('shell.exec', 'look')] });
  A.ok(r.ok, 'testPlan succeeds');
  A.eq(r.steps.length, 2, 'and classifies every step');
  A.eq(r.steps[0].outcome, 'run', 'the read would run');
  A.eq(r.steps[1].outcome, 'deny', 'the shell would be refused');
  A.eq(e.workorders.count(BIZ), 0, 'AND NOTHING WAS CREATED — it is a look, not a job');
  A.eq(ran(e), 0, 'and nothing was dispatched');
  A.ok(r.grants, 'and it reports the grants it judged against');
  A.ok(!e.worker.testPlan('', { steps: [step('fs.read', 'r')] }).ok, 'testPlan needs a business');
}

/* ---------- catalog: the console cannot drift from the policy ---------- */
{
  const e = env();
  const c = e.worker.catalog();
  A.ok(c.rows.length >= 60, 'the catalog lists the policy table (' + c.rows.length + ')');
  A.eq(c.maxSteps, Policy.MAX_STEPS, 'and the runner\'s own step limit');
  A.ok(c.stepTimeoutMs > 0, 'and its per-step timeout');
  A.ok(c.rows.filter(r => r.tool === 'fs.write')[0].wired === true, 'fs.write is marked wired');
  A.ok(c.rows.filter(r => r.tool === 'fs.delete')[0].wired === false, 'an unwired tool is marked unwired');
  A.ok(Array.isArray(c.wired) && c.wired.indexOf('fs.read') >= 0, 'and the wired name list is included');
}

/* ================= the async half ================= */
async function main() {
  /* ---------- run: a safe step executes through the registry ---------- */
  {
    const e = env();
    const o = e.worker.plan(BIZ, { intent: 'x', steps: [step('fs.read', 'read it')] }).order;
    const r = await e.worker.run(o.id, {});
    A.ok(r.ok, 'the run succeeds');
    A.eq(ran(e), 1, 'and dispatch was called exactly once');
    A.eq(e.calls[0].call.name, 'fs.read', 'with the right tool');
    A.eq(r.order.steps[0].status, 'executed', 'and the step is recorded as executed');
    A.eq(r.order.status, 'done', 'so the order settles as done — derived, not asserted');
    A.ok(e.calls[0].ctx.businessId === BIZ, 'the dispatch ctx carries the business (P6)');
  }

  /* ---------- run: a RESTRICTED step is refused, and NO approval is filed ---------- */
  {
    const e = env();
    const o = e.worker.plan(BIZ, { intent: 'x', steps: [step('shell.exec', 'look around')] }).order;
    const r = await e.worker.run(o.id, {});
    A.eq(r.order.steps[0].status, 'refused', 'a restricted step is refused');
    A.eq(ran(e), 0, 'AND DISPATCH WAS NEVER CALLED — the §13 gate sits in front of it');
    A.eq(e.approvals.list(BIZ).length, 0, 'AND NO APPROVAL WAS FILED — the owner cannot authorise it here');
    A.ok(/restricted/.test(r.order.steps[0].reason), 'the reason names the restricted tier');
  }

  /* ---------- run: an UNWIRED step is refused with its own reason, not held ---------- */
  {
    // channel.send is §13 review (external_comms) — the policy would HOLD it — but it is not wired, so the
    // runner must refuse rather than file an approval it could not then honour.
    const e = env({ wired: ['fs.read'] });
    const o = e.worker.plan(BIZ, { intent: 'x', steps: [step('channel.send', 'tell the lead')] }).order;
    const r = await e.worker.run(o.id, {});
    A.eq(r.order.steps[0].status, 'refused', 'an unwired step is refused, not held');
    A.eq(ran(e), 0, 'and nothing was dispatched');
    A.eq(e.approvals.list(BIZ).length, 0, 'AND NO APPROVAL WAS FILED — a request nobody could honour is worse than none');
    A.ok(/no route|not wired/.test(r.order.steps[0].reason), 'and the reason says the worker has no route to it');
  }

  /* ---------- THE APPROVAL PATH: review → held → filed → approved → executed ---------- */
  {
    const e = env();                       // channel.send IS wired here
    const o = e.worker.plan(BIZ, { intent: 'x', steps: [step('channel.send', 'tell the lead', { text: 'hi' })] }).order;
    A.eq(o.steps[0].tier, 'review', 'channel.send is §13 review (external_comms)');

    const r = await e.worker.run(o.id, {});
    A.eq(r.order.steps[0].status, 'held', 'a review step is HELD, not run');
    A.eq(ran(e), 0, 'and nothing was dispatched before the owner decided');

    // a §13 request was filed, under this order
    const queue = e.approvals.list(BIZ);
    A.eq(queue.length, 1, 'exactly one approval was filed');
    A.eq(queue[0].tier, 'review', 'and it is a review-tier request');
    A.eq(queue[0].action, 'external_comms', 'for the §13 action the tool constitutes');
    A.eq(queue[0].params.orderId, o.id, 'and it names the work order it belongs to');
    A.eq(queue[0].params.tool, 'channel.send', 'and the tool being asked for');

    // THE OWNER APPROVES
    const ap = await e.worker.approveStep(queue[0].id, 'user');
    A.ok(ap.ok, 'approveStep succeeds');
    A.eq(ran(e), 1, 'AND NOW dispatch was called — the approval is what unlocked it');
    A.eq(e.calls[0].call.name, 'channel.send', 'with the right tool');
    A.eq(ap.step.status, 'executed', 'the step executed');
    A.eq(ap.order.status, 'done', 'and the order settled as done');
    A.eq(e.approvals.get(queue[0].id).status, 'approved', 'the request is marked approved');

    // A DECISION IS FINAL — a second approve cannot run the step twice
    const again = await e.worker.approveStep(queue[0].id, 'user');
    A.ok(!again.ok, 'a second approve is refused');
    A.eq(ran(e), 1, 'AND STILL EXACTLY ONE DISPATCH — a double-click cannot run it twice');
  }

  /* ---------- THE OWNER REJECTS ---------- */
  {
    const e = env();
    const o = e.worker.plan(BIZ, { intent: 'x', steps: [step('channel.send', 'tell the lead')] }).order;
    const r = await e.worker.run(o.id, {});
    A.eq(r.order.steps[0].status, 'held', 'the step is held');
    const id = e.approvals.list(BIZ)[0].id;
    const rj = await e.worker.rejectStep(id, 'user', 'not now');
    A.ok(rj.ok, 'rejectStep succeeds');
    A.eq(ran(e), 0, 'NOTHING WAS DISPATCHED — a rejection never runs the step');
    A.eq(rj.order.steps[0].status, 'refused', 'the step is recorded as refused');
    A.eq(e.approvals.get(id).status, 'rejected', 'and the request is marked rejected');
  }

  /* ---------- a request is pinned to its own business (P6) ---------- */
  {
    const e = env();
    const o1 = e.worker.plan(BIZ, { intent: 'x', steps: [step('channel.send', 'a')] }).order;
    const o2 = e.worker.plan('other', { intent: 'x', steps: [step('channel.send', 'b')] }).order;
    await e.worker.run(o1.id, {});
    await e.worker.run(o2.id, {});
    A.eq(e.approvals.list(BIZ).length, 1, 'acme has one request');
    A.eq(e.approvals.list('other').length, 1, 'other has its own');
    A.eq(e.approvals.list(BIZ)[0].params.orderId, o1.id, 'and each is pinned to its own order (P6)');
  }

  /* ---------- a tool that errors is FAILED, never executed ---------- */
  {
    const e = env({ dispatch: () => ({ ok: false, isError: true, content: 'boom', summary: 'it broke' }) });
    const o = e.worker.plan(BIZ, { intent: 'x', steps: [step('fs.read', 'r')] }).order;
    const r = await e.worker.run(o.id, {});
    A.eq(ran(e), 1, 'the tool was called');
    A.eq(r.order.steps[0].status, 'failed', 'but the step is FAILED — "it ran" and "it worked" differ');
    A.eq(r.order.status, 'failed', 'and the order settles as failed');
  }

  /* ---------- a DOWNSTREAM refusal is distinguished from a tool bug ---------- */
  {
    const e = env({ dispatch: () => ({ ok: false, isError: true, content: 'capability denied', summary: 'denied' }) });
    const o = e.worker.plan(BIZ, { intent: 'x', steps: [step('fs.read', 'r')] }).order;
    const r = await e.worker.run(o.id, {});
    A.eq(r.order.steps[0].status, 'failed', 'the step is failed');
    A.ok(r.receipts[0].downstream === true, 'and the receipt flags it as a DOWNSTREAM refusal, not a bug');
  }

  /* ---------- a dispatcher that throws is survived ---------- */
  {
    const e = env({ dispatch: () => { throw new Error('hard crash'); } });
    const o = e.worker.plan(BIZ, { intent: 'x', steps: [step('fs.read', 'r')] }).order;
    const r = await e.worker.run(o.id, {});
    A.ok(r && r.ok, 'a throwing dispatcher does not take the run down');
    A.eq(r.order.steps[0].status, 'failed', 'and the step is failed, never executed');
  }

  /* ---------- a dry run plans and dispatches NOTHING ---------- */
  {
    const e = env();
    const o = e.worker.plan(BIZ, { intent: 'x', steps: [step('fs.read', 'r')], dryRun: true }).order;
    A.ok(o.dryRun === true, 'the order is flagged a dry run');
    const r = await e.worker.run(o.id, {});
    A.ok(!r.ok, 'running a dry run is refused');
    A.ok(/dry run/.test(r.reason), 'and the refusal says why');
    A.eq(ran(e), 0, 'and nothing was dispatched — a plan is not a job');
  }

  /* ---------- an already-finished order cannot be re-run ---------- */
  {
    const e = env();
    const o = e.worker.plan(BIZ, { intent: 'x', steps: [step('fs.read', 'r')] }).order;
    await e.worker.run(o.id, {});
    A.ok(!(await e.worker.run(o.id, {})).ok, 'a second run is refused');
    A.eq(ran(e), 1, 'and dispatch was still called only once');
  }

  /* ---------- THE BROKER GETS THE REAL DESCRIPTOR ---------- */
  {
    /* permissions.js reads `scopeOf(tool) = tool.scope || 'read'`, and its read tier auto-allows. So a runner
       that hands the consent gate a descriptor with no `scope` turns every WRITE into a "read-only" allowance.
       These two assertions are the regression test for that. */
    let seen = null;
    const e = env();
    const o = e.worker.plan(BIZ, { intent: 'x', steps: [step('fs.write', 'write it')] }).order;
    await e.worker.run(o.id, { consent: (call, tool) => { seen = tool; return { allow: false, reason: 'nope' }; } });
    A.ok(seen, 'the consent gate was consulted for a write');
    A.eq(seen.scope, 'write', 'AND IT WAS TOLD THE REAL SCOPE — not a blank that defaults to read');
    A.ok(seen.capability === 'cabinet', 'and the real capability');

    // with the broker not consulted at all, the write is HELD rather than run
    const e2 = env();
    const o2 = e2.worker.plan(BIZ, { intent: 'x', steps: [step('fs.write', 'write it')] }).order;
    const r2 = await e2.worker.run(o2.id, {});
    A.eq(r2.order.steps[0].status, 'held', 'a write with no consent decision is held, never run');
    A.eq(ran(e2), 0, 'and nothing was dispatched');
  }

  /* ---------- events: the §18 audit trail ---------- */
  {
    const e = env();
    const o = e.worker.plan(BIZ, { intent: 'x', steps: [step('fs.read', 'r'), step('shell.exec', 'look')] }).order;
    A.eq(evOf(e, 'business.workorder.planned').length, 1, 'planning emits business.workorder.planned');
    await e.worker.run(o.id, {});
    A.eq(evOf(e, 'business.workorder.finished').length, 1, 'running emits business.workorder.finished');
    A.eq(evOf(e, 'business.workorder.step.refused').length, 1, 'and the refused step is reported');
  }

  /* ---------- events: the approval path is observable ---------- */
  {
    const e = env();
    const o = e.worker.plan(BIZ, { intent: 'x', steps: [step('channel.send', 'tell them')] }).order;
    await e.worker.run(o.id, {});
    A.eq(evOf(e, 'business.workorder.step.held').length, 1, 'holding a step emits step.held');
    const id = e.approvals.list(BIZ)[0].id;
    await e.worker.approveStep(id, 'user');
    A.eq(evOf(e, 'business.workorder.step.approved').length, 1, 'approving emits step.approved');

    const e2 = env();
    const o2 = e2.worker.plan(BIZ, { intent: 'x', steps: [step('channel.send', 'tell them')] }).order;
    await e2.worker.run(o2.id, {});
    await e2.worker.rejectStep(e2.approvals.list(BIZ)[0].id, 'user', 'no');
    A.eq(evOf(e2, 'business.workorder.step.rejected').length, 1, 'rejecting emits step.rejected');
  }

  /* ---------- stats: the runner counts what it did ---------- */
  {
    const e = env();
    const o = e.worker.plan(BIZ, { intent: 'x', steps: [step('fs.read', 'r'), step('shell.exec', 'look')] }).order;
    await e.worker.run(o.id, {});
    const s = e.worker.stats();
    A.eq(s.ordersPlanned, 1, 'one order planned');
    A.eq(s.ordersRun, 1, 'one run');
    A.eq(s.stepsExecuted, 1, 'one step executed');
    A.eq(s.stepsRefused, 1, 'one refused');
    A.eq(s.dispatches, 1, 'and exactly one dispatch — the refused step never reached the registry');
  }
}

main().then(
  () => A.report('business-worker'),
  (e) => { console.error('business-worker THREW:', (e && e.stack) || e); A.report('business-worker'); }
);
