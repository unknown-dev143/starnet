/* sidecar/business-worker.js — the AI Worker runner (Business OS Phase 6).

   WHAT THIS DOES. It takes a work order (an intent + a list of tool steps) and drives each step to one of
   three honest ends: RUN it, HOLD it for the owner, or REFUSE it. It is the only place in the business layer
   that reaches the station's tool registry.

   THE TWO GATES, AND WHY THE ORDER MATTERS.

       1. THE §13 GATE (this layer, business-worker-policy.js) — "is this agent, for this business, allowed to
          constitute this action at all?"
       2. THE STATION'S OWN GATE (tools/registry.js's dispatch) — user-control authority → capability gate →
          schema validation → the runtime consent broker → pre_tool_call hooks.

   This runner puts (1) IN FRONT OF (2) and never in place of it. `dispatch` is INJECTED — the real registry —
   so a worker step is gated by every check an ordinary agent tool call is gated by, plus §13. There is no
   path in this file that calls a tool's `run()` directly, and there must never be one: a bypass here would
   silently disable the capability gate, the schema validation and the consent broker for exactly the caller
   with the most authority to abuse them.

   CONSEQUENCE: a step can be allowed by §13 and still refused downstream (a capability the agent was never
   granted, a malformed argument, a hook). When that happens the step is recorded as FAILED with the
   downstream reason, not retried and not reported as success. Both systems are ANDed; neither can override
   the other in either direction.

   THE HONESTY RULES.
     · A step whose tool returned `isError` is `failed`, never `executed`. "It ran" and "it worked" are
       different facts and the store keeps them apart.
     · A step held for approval is `held`. Nothing ran. `held` is not `done`.
     · A restricted step is `refused` and NO approval is filed for it — filing one would imply the owner could
       authorise it here, and §13 says a restricted action needs safeguards this run does not have.
     · `dryRun` classifies everything and dispatches NOTHING. It is a plan, not a job.
     · Every dispatch is bounded by a per-step timeout so one wedged tool cannot hold the order forever.

   Pure-ish UMD: no IO, no clock, no rng — `now`, `dispatch` and `persist` are all injected. `dispatch` is
   optional: without it the runner still plans and classifies, and REFUSES to run anything, because a runner
   that cannot dispatch must not pretend it did. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).businessWorker = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STEP_TIMEOUT_MS = 120000;

  function makeBusinessWorker(deps) {
    deps = deps || {};
    const workorders = deps.workorders;
    const policy = deps.policy;
    const permissions = deps.permissions || null;
    const approvals = deps.approvals || null;
    const agents = deps.agents || null;
    const dispatch = typeof deps.dispatch === 'function' ? deps.dispatch : null;
    /* WHICH TOOLS THE WORKER'S REGISTRY ACTUALLY CARRIES.
       The worker does not build the station's full tool registry — that assembly lives inside a single agent
       run and pulls in per-run state the worker has no business fabricating. It carries a deliberate subset,
       and this set is how the runner KNOWS the difference between "the policy refuses this" and "the policy
       would allow it but the worker has no route to it". Those are different facts and a user acting on them
       would do different things, so they must not both surface as a generic failure.
       A function, not a Set, so a caller can extend it without rebuilding the runner. Returns null when the
       caller did not supply one, in which case availability is NOT checked — an uninformed runner must not
       refuse work on a guess. */
    const available = typeof deps.available === 'function' ? deps.available : null;
    /* THE TOOL'S OWN DECLARATION, for the policy's SCOPE_FLOOR. `describe(name) -> descriptor | null`.
       Without it the policy classifies from its table alone, and the table deliberately calls the fs writes
       'draft' so that the tool's `scope:'write'` can raise them to 'review' — so a runner that never asked for
       the descriptor would let a file write run on the agent's standing SAFE grant with no human in the loop,
       and SCOPE_FLOOR would be pure decoration. `plan()` and `step()` both pass it, and both re-derive, so a
       grant that changes between planning and running is re-judged rather than inherited. */
    const describe = typeof deps.describe === 'function' ? deps.describe : null;
    function describeTool(name) {
      if (!describe) return null;
      try { return describe(name) || null; } catch (e) { return null; }   // a broken probe must not crash a step
    }
    function isAvailable(toolName) {
      if (!available) return true;
      let list = null;
      try { list = available(); } catch (e) { return true; }   // a broken probe must not silently refuse work
      if (!list) return true;
      const arr = (list instanceof Set) ? Array.from(list) : (Array.isArray(list) ? list : []);
      if (!arr.length) return true;
      return arr.indexOf(toolName) >= 0;
    }
    // makeCtx({businessId, agentId, order, step}) -> the ctx handed to registry.dispatch. index.js supplies
    // one built from the SAME modules the ordinary run path uses, so the station's gates see a real agent.
    const makeCtx = typeof deps.makeCtx === 'function' ? deps.makeCtx : null;
    const emit = typeof deps.emit === 'function' ? deps.emit : (() => {});
    const now = typeof deps.now === 'function' ? deps.now : (() => null);
    const log = typeof deps.log === 'function' ? deps.log : (() => {});

    const stats = {
      ordersPlanned: 0, ordersRun: 0, stepsExecuted: 0, stepsHeld: 0, stepsRefused: 0, stepsFailed: 0,
      approvalsFiled: 0, dispatchRefusals: 0, dispatches: 0, timeouts: 0
    };

    if (!workorders) throw new Error('business-worker needs a workorders store');
    if (!policy) throw new Error('business-worker needs the worker policy module');

    const str = (v, cap) => (v == null ? '' : String(v)).slice(0, cap == null ? 2000 : cap);

    /* Resolve an agent's §13 grants. A missing/unknown agent gets DEFAULT_GRANTS' shape (safe only) rather
       than an empty object, because an empty object would make `decide()` treat `safe` as falsy and refuse
       even the safe tier — a silent behaviour change for a caller who merely forgot the agentId. */
    function grantsFor(businessId, agentId) {
      const P = permissions;
      const fallback = (P && P.DEFAULT_GRANTS) ? P.DEFAULT_GRANTS : { safe: true, review: false, restricted: false };
      if (!agentId || !agents || typeof agents.get !== 'function') return fallback;
      const a = agents.get(agentId);
      if (!a) return fallback;
      // P6: an agent from another business is not this business's agent.
      if (businessId && a.businessId && a.businessId !== businessId) return fallback;
      return (P && typeof P.sanitizeGrants === 'function') ? P.sanitizeGrants(a.grants, fallback) : fallback;
    }

    function agentNameFor(agentId) {
      if (!agentId || !agents || typeof agents.get !== 'function') return '';
      const a = agents.get(agentId);
      return a ? str(a.name || a.role, 200) : '';
    }

    /* plan(businessId, input) -> { ok, order } | { ok:false, reason }
       Classifies every step against §13 and stores the order. NOTHING is dispatched. */
    function plan(businessId, input) {
      input = input || {};
      const biz = str(businessId, 200).trim();
      if (!biz) return { ok: false, reason: 'a work order needs a business' };

      const agentId = str(input.agentId, 200).trim();
      const grants = grantsFor(biz, agentId);

      const classified = policy.plan({
        steps: input.steps, grants: grants, permissions: permissions, describe: describe ? describeTool : null
      });
      if (!classified.ok) return classified;

      // annotate each step with whether the worker can actually reach the tool, so the console can warn BEFORE
      // an order is committed rather than after a step is refused
      const steps = classified.steps.map(s => Object.assign({}, s, { wired: isAvailable(s.tool) }));
      const summary = Object.assign({}, classified.summary, {
        unwired: steps.filter(s => !s.wired).length
      });

      const r = workorders.create(biz, {
        agentId: agentId,
        agentName: agentNameFor(agentId) || str(input.agentName, 200),
        intent: input.intent,
        steps: steps,
        createdBy: str(input.createdBy, 120) || 'user',
        dryRun: !!input.dryRun,
        note: str(input.note, 600)
      });
      if (!r.ok) return r;

      stats.ordersPlanned++;
      emit('business.workorder.planned', {
        businessId: biz, orderId: r.order.id, agentId: agentId, steps: r.order.steps.length,
        dryRun: r.order.dryRun, run: summary.run, ask: summary.ask, deny: summary.deny, unwired: summary.unwired
      });
      return { ok: true, order: r.order, summary: summary, grants: grants };
    }

    /* ONE STEP. Returns a step patch for the store plus a small receipt for the caller.
       The order of the branches is the security argument: refusal and holding are decided BEFORE anything is
       dispatched, so there is no code path where a tool runs and the decision is written afterwards. */
    async function step(order, s, ctxOpts) {
      const biz = order.businessId;
      const grants = grantsFor(biz, order.agentId);

      // re-decide at RUN time, not at plan time: grants may have changed between planning and running, and a
      // stale "run" verdict is exactly the kind of thing a permission system must not honour.
      const desc = describeTool(s.tool);

      /* THE BROKER GETS THE REAL DESCRIPTOR — this is not a stylistic point, it is a privilege boundary.

         An earlier draft passed a hand-built `{ name, scope: null, requiresConsent: true }`. That looks
         harmless and is the opposite: permissions.js defines `scopeOf(tool) = tool.scope || 'read'`, so a
         MISSING scope is not "unknown", it is "read". The broker's read tier then auto-allows
         ("read-only, non-network") — which means a work order calling fs.write was handed the broker's
         read-only allowance and the write ran. A synthetic descriptor is therefore never neutral: it silently
         downgrades the mechanism, and the downgrade direction is always toward more permission.

         So: consult the broker ONLY when we hold the real descriptor, and hand over that descriptor verbatim
         (its true `scope` and `capability`). With no descriptor there is nothing honest to ask about, so the
         broker is not consulted and a consent-requiring step stays held — never allowed by a guess. */
      let consent = null;
      if (typeof ctxOpts.consent === 'function' && desc) {
        try {
          consent = await ctxOpts.consent(
            { name: s.tool, args: s.args },
            Object.assign({}, desc, { name: s.tool, requiresConsent: true })
          );
        } catch (e) { consent = { allow: false, reason: 'consent error: ' + str(e && e.message, 200) }; }
      }
      const d = policy.decideWorker({
        // the tool's OWN declaration (scope / requiresConsent / network) so SCOPE_FLOOR can escalate; the name is
        // always present even when the descriptor is not.
        tool: Object.assign({ name: s.tool }, desc || {}, {
          requiresConsent: !!((desc && desc.requiresConsent) || typeof ctxOpts.consent === 'function')
        }),
        grants: grants, permissions: permissions, consent: consent,
        // the owner's per-request yes. It satisfies §13's review gate for THIS action only; the policy checks
        // the restricted tier before it ever reads this flag, so it can never unlock a restricted action.
        authorized: ctxOpts.authorized === true
      });

      if (d.outcome === 'deny') {
        stats.stepsRefused++;
        emit('business.workorder.step.refused', {
          businessId: biz, orderId: order.id, seq: s.seq, tool: s.tool,
          action: d.action, tier: d.tier, why: d.why, unwired: false
        });
        return {
          patch: { status: 'refused', action: d.action, tier: d.tier, outcome: 'deny', reason: d.why },
          receipt: { seq: s.seq, tool: s.tool, status: 'refused', reason: d.why }
        };
      }

      /* Not wired into the worker's registry. Checked AFTER the policy so a restricted tool still reports the
         §13 reason (the more meaningful one) rather than this one, and checked BEFORE an approval is filed so
         a user is never asked to authorise something the worker could not then run. */
      if (!isAvailable(s.tool)) {
        stats.stepsRefused++;
        const why = 'the worker has no route to "' + s.tool + '" — it is classified ' + d.action + ' (' + d.tier
          + '), but this tool is not wired into the worker\'s registry, so the step is refused rather than'
          + ' held for an approval that could not then run';
        emit('business.workorder.step.refused', {
          businessId: biz, orderId: order.id, seq: s.seq, tool: s.tool,
          action: d.action, tier: d.tier, why: why, unwired: true
        });
        return {
          patch: { status: 'refused', action: d.action, tier: d.tier, outcome: 'deny', reason: why },
          receipt: { seq: s.seq, tool: s.tool, status: 'refused', reason: why, unwired: true }
        };
      }

      if (d.outcome === 'ask') {
        stats.stepsHeld++;
        let approvalId = '';
        /* A review-tier step becomes a §13 request the owner can actually decide. A step held only because
           the RUNTIME consent gate was not consulted (or refused) is NOT filed as a §13 request: it is not a
           §13 matter, and filing one would put a request in the owner's queue that approving could not
           legitimately resolve. It is recorded as held with the runtime's own words. */
        if (d.tier === 'review' && approvals && typeof approvals.create === 'function') {
          const built = approvals.create(biz, {
            // §13's permission action, and the tier the store requires to be exactly 'review'
            action: d.action,
            tier: d.tier,
            // the store's `automationAction` column — for a work order this is the TOOL being asked for
            actionId: s.tool,
            what: 'Run "' + s.tool + '" — ' + str(order.intent, 200),
            why: 'Work order ' + order.id + ' step ' + s.seq + ': ' + s.why,
            evidence: [
              { text: 'Work order ' + order.id + ' for this business asked for it: ' + str(order.intent, 300),
                evidence: 'user-stated', source: 'workorder:' + order.id },
              { text: 'Step ' + s.seq + ' of ' + order.steps.length + ' — tool "' + s.tool + '" (' + d.action + ')',
                evidence: 'verified', source: 'policy:' + d.source }
            ],
            risk: 'medium',
            effect: 'Calls the station tool "' + s.tool + '" with the arguments this work order recorded.',
            params: { orderId: order.id, seq: s.seq, tool: s.tool, args: s.args }
          });
          if (built && built.ok) { approvalId = built.approval.id; stats.approvalsFiled++; }
          else if (built && !built.ok) { log({ kind: 'approval-not-filed', detail: built.reason }); }
        }
        /* Emitted for EVERY held step, including one held only by the runtime consent gate (which files no §13
           request). The console needs to show "this order is waiting" in both cases; `approvalId` empty is what
           tells it the wait is a runtime question rather than a §13 one. */
        emit('business.workorder.step.held', {
          businessId: biz, orderId: order.id, seq: s.seq, tool: s.tool,
          action: d.action, tier: d.tier, approvalId: approvalId, why: d.why
        });
        return {
          patch: { status: 'held', action: d.action, tier: d.tier, outcome: 'ask', reason: d.why },
          receipt: { seq: s.seq, tool: s.tool, status: 'held', reason: d.why, approvalId: approvalId }
        };
      }

      // outcome === 'run'
      if (!dispatch) {
        stats.stepsFailed++;
        return {
          patch: { status: 'failed', action: d.action, tier: d.tier, outcome: 'run', reason: 'no dispatcher is wired, so this step could not run',
                   error: 'no dispatcher' },
          receipt: { seq: s.seq, tool: s.tool, status: 'failed', reason: 'no dispatcher is wired' }
        };
      }

      const ctx = makeCtx ? makeCtx({ businessId: biz, agentId: order.agentId, order: order, step: s }) : {};
      const runCtx = Object.assign({}, ctx || {}, { agentId: order.agentId || (ctx && ctx.agentId) });
      if (!runCtx.timeoutMs) runCtx.timeoutMs = STEP_TIMEOUT_MS;

      let res = null;
      stats.dispatches++;
      try {
        res = await dispatch({ id: order.id + '~s' + s.seq, name: s.tool, args: s.args || {} }, runCtx);
      } catch (e) {
        // registry.dispatch is documented never to throw; if it ever does, the step is FAILED, not executed.
        res = { ok: false, isError: true, content: '', summary: 'dispatcher threw: ' + str(e && e.message, 200) };
      }

      if (!res || res.isError || res.ok === false) {
        const why = str((res && (res.content || res.summary)) || 'the tool failed', 600);
        // A downstream refusal is reported as such rather than as a tool bug, because the two need different
        // fixes and only one of them is the agent's fault.
        const downstream = /denied|capability denied|consent denied|user-control denied|blocked by your hook|invalid arguments/.test(why);
        if (downstream) stats.dispatchRefusals++; else stats.stepsFailed++;
        return {
          patch: { status: 'failed', action: d.action, tier: d.tier, outcome: 'run', reason: why, error: str(res && res.summary, 600),
                   result: res && res.content ? str(res.content, 4000) : null },
          receipt: { seq: s.seq, tool: s.tool, status: 'failed', reason: why, downstream: downstream }
        };
      }

      stats.stepsExecuted++;
      return {
        patch: {
          status: 'executed', action: d.action, tier: d.tier, outcome: 'run',
          reason: 'ran through the station tool registry', result: str(res.content, 4000)
        },
        receipt: { seq: s.seq, tool: s.tool, status: 'executed', summary: str(res.summary, 200) }
      };
    }

    /* run(orderId, opts) -> { ok, order, receipts, summary }
       opts: { consent?: fn, actor?: string }
       `consent` is the runtime consent gate for THIS run. Omit it for an unattended run: every step that
       would need a consent decision is then HELD rather than run, which is the only honest reading of
       "nobody is here to ask". */
    async function run(orderId, opts) {
      opts = opts || {};
      const order = workorders.get(orderId);
      if (!order) return { ok: false, reason: 'no such work order: ' + str(orderId, 200) };
      if (order.dryRun) {
        return { ok: false, reason: 'this work order is a dry run — it classifies the steps and runs nothing. Plan a real order to execute it.' };
      }
      if (workorders.OPEN_STATUSES.indexOf(order.status) < 0) {
        return { ok: false, reason: 'this work order is already finished (' + order.status + ')' };
      }

      const started = workorders.markRunning(order.id);
      if (!started.ok) return started;

      const receipts = [];
      for (const s of order.steps) {
        const out = await step(order, s, opts);
        const w = workorders.recordStep(order.id, s.seq, out.patch);
        if (!w.ok) { log({ kind: 'record-step-failed', detail: w.reason }); }
        receipts.push(out.receipt);
      }

      const done = workorders.finish(order.id);
      const final = done.ok ? done.order : workorders.get(order.id);
      stats.ordersRun++;

      emit('business.workorder.finished', {
        businessId: final.businessId, orderId: final.id, status: final.status,
        executed: final.steps.filter(s => s.status === 'executed').length,
        held: final.steps.filter(s => s.status === 'held').length,
        refused: final.steps.filter(s => s.status === 'refused').length,
        failed: final.steps.filter(s => s.status === 'failed').length
      });

      return { ok: true, order: final, receipts: receipts, summary: summariseOrder(final) };
    }

    /* testPlan(input) — classify WITHOUT creating anything. This is the dry-run a user can run from the console
       before committing an order: it writes no row, dispatches no tool, and returns the same verdicts `plan`
       would have produced. */
    function testPlan(businessId, input) {
      input = input || {};
      const biz = str(businessId, 200).trim();
      if (!biz) return { ok: false, reason: 'a business is required' };
      const agentId = str(input.agentId, 200).trim();
      const grants = grantsFor(biz, agentId);
      const classified = policy.plan({
        steps: input.steps, grants: grants, permissions: permissions, describe: describe ? describeTool : null
      });
      if (!classified.ok) return classified;
      return { ok: true, steps: classified.steps, summary: classified.summary, grants: grants };
    }

    /* approveStep(approvalId, by) — the owner said yes to a held step. Decide the approval FIRST (so a double
       click cannot run the step twice), then dispatch that one step and write its real outcome back onto the
       order. */
    async function approveStep(approvalId, by, opts) {
      opts = opts || {};
      if (!approvals) return { ok: false, reason: 'no approval store is wired' };
      const a = approvals.get(approvalId);
      if (!a) return { ok: false, reason: 'no such approval: ' + str(approvalId, 200) };
      if (a.status !== 'pending') return { ok: false, reason: 'this request was already decided (' + a.status + ')' };

      const p = a.params || {};
      const orderId = str(p.orderId, 200);
      const seq = Number(p.seq);
      const order = orderId ? workorders.get(orderId) : null;
      if (!order) return { ok: false, reason: 'the work order behind this request no longer exists' };
      const target = order.steps.filter(s => Number(s.seq) === seq)[0];
      if (!target) return { ok: false, reason: 'step ' + seq + ' is no longer on that work order' };
      if (target.status !== 'held') return { ok: false, reason: 'step ' + seq + ' is ' + target.status + ', not held' };

      // decide FIRST — a decision is final, so a second call cannot reach the dispatch below
      const decided = approvals.decide(approvalId, { decision: 'approve', by: str(by, 120) || 'user', reason: 'approved from the worker console' });
      if (!decided.ok) return decided;

      const s = { seq: target.seq, tool: target.tool, args: target.args, why: target.why };
      // the owner's yes IS the authorization AND the consent for this one call
      const out = await step(order, s, {
        authorized: true,
        consent: () => ({ allow: true, reason: 'the owner approved this request in the worker console' })
      });
      const w = workorders.recordStep(order.id, s.seq, out.patch);
      const final = w.ok ? w.order : workorders.get(order.id);
      // re-derive the order's status now that the step moved
      const settled = workorders.finish(order.id);
      const settledOrder = settled.ok ? settled.order : final;
      emit('business.workorder.step.approved', {
        businessId: order.businessId, orderId: order.id, seq: s.seq, tool: s.tool,
        approvalId: approvalId, by: str(by, 120) || 'user',
        status: out.receipt.status, orderStatus: settledOrder ? settledOrder.status : ''
      });
      return { ok: true, approval: decided.approval, step: out.receipt, order: settledOrder };
    }

    async function rejectStep(approvalId, by, reason) {
      if (!approvals) return { ok: false, reason: 'no approval store is wired' };
      const a = approvals.get(approvalId);
      if (!a) return { ok: false, reason: 'no such approval: ' + str(approvalId, 200) };
      if (a.status !== 'pending') return { ok: false, reason: 'this request was already decided (' + a.status + ')' };
      const decided = approvals.decide(approvalId, { decision: 'reject', by: str(by, 120) || 'user', reason: str(reason, 400) || 'rejected from the worker console' });
      if (!decided.ok) return decided;
      const p = a.params || {};
      const orderId = str(p.orderId, 200);
      const seq = Number(p.seq);
      let order = null;
      if (orderId) {
        workorders.recordStep(orderId, seq, { status: 'refused', reason: 'the owner rejected this step' });
        workorders.finish(orderId);
        order = workorders.get(orderId);
      }
      emit('business.workorder.step.rejected', {
        businessId: a.businessId, orderId: orderId, seq: seq, tool: str(p.tool, 200),
        approvalId: str(approvalId, 200), by: str(by, 120) || 'user',
        orderStatus: order ? order.status : ''
      });
      return { ok: true, approval: decided.approval, order: order };
    }

    // The counts a user needs from one order, and no score.
    function summariseOrder(order) {
      const steps = (order && order.steps) || [];
      return {
        total: steps.length,
        executed: steps.filter(s => s.status === 'executed').length,
        held: steps.filter(s => s.status === 'held').length,
        refused: steps.filter(s => s.status === 'refused').length,
        failed: steps.filter(s => s.status === 'failed').length,
        pending: steps.filter(s => s.status === 'pending').length,
        status: order ? order.status : 'planned'
      };
    }

    /* The console's catalogue: the policy table + the runner's own limits, so the UI cannot drift. Each row
       also carries whether the worker can actually REACH the tool, because "the policy would allow this" and
       "the worker can run this" are different facts and a user needs both before writing an order. */
    function catalog() {
      // the descriptor goes in so each row reports the EFFECTIVE tier — see policy.catalog's header
      const c = policy.catalog(permissions, describe ? describeTool : null);
      const rows = c.rows.map(r => Object.assign({}, r, { wired: isAvailable(r.tool) }));
      let wiredNames = null;
      if (available) {
        try {
          const list = available();
          wiredNames = (list instanceof Set) ? Array.from(list) : (Array.isArray(list) ? list.slice() : null);
        } catch (e) { wiredNames = null; }
      }
      return Object.assign({}, c, {
        rows: rows,
        wired: wiredNames,
        stepTimeoutMs: STEP_TIMEOUT_MS,
        statuses: workorders.STATUSES,
        stepStatuses: workorders.STEP_STATUSES
      });
    }

    return {
      STEP_TIMEOUT_MS,
      plan, run, testPlan, approveStep, rejectStep, summariseOrder, catalog, grantsFor,
      stats: () => Object.assign({}, stats)
    };
  }

  return { makeBusinessWorker, STEP_TIMEOUT_MS };
});
