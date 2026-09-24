/* sidecar/worker-routes.js — the HTTP surface for the AI WORKER (Business OS Phase 6).

   Phase 6 is §30's "AI Worker": controlled browser / terminal / file / API / development operations, with
   strict permission boundaries (§13 the action permission tiers, §18 the audit log, §19 the human controls).

   WHY A SEPARATE MODULE. Same reason as every other phase's route module: sidecar/index.js is the
   merge-conflict hotfile named in CODE_MAP, so handlers live here and index.js adds a require plus ROWS.

   AUTH: these are /api/* routes, so apiauth.js's per-launch token gate covers them automatically.

   THE GUARDS THIS MODULE EXPOSES — every one lives in the POLICY, the RUNNER or a STORE, never here, so a
   route can never drift from the rule it enforces:
     §13 — a tool's tier is DERIVED (business-worker-policy.js), never accepted from the request. A body that
           claims a tier is ignored; the policy recomputes it. A restricted step is refused and no approval is
           filed for it.
     §18 — every work order is a durable audit record: who, for which business, what was asked, and per-step
           what actually happened.
     §19 — running an order is an explicit human act. There is no route that runs an order as a side effect of
           creating it, so "plan" and "run" can never be confused by a caller.
     P6  — every read and write names its business. A step's approval is filed under the ORDER's business and
           an approval from another business cannot be decided through this surface.

   THE TWO APPROVAL DECIDERS, AND WHY THERE ARE TWO. Phase 5's automation engine and Phase 6's worker both
   file into the SAME `business-approvals-store` — one queue, because a user has one queue. But the thing that
   happens on approval is different: Phase 5 runs an automation ACTION against a business store; Phase 6
   dispatches a STATION TOOL through the real tool registry. So each owns its own decider, and the rows are
   told apart by `params.orderId` — present only on a worker-filed request. The console shows both in one
   list and routes each to the right decider; the store stays single.

   ROUTE MATCHING — the trap that produces a route which looks right and never fires. index.js's dispatch
   populates the match array only for `rx` rows; a `qrx` row leaves it NULL, so a handler reading `match[1]`
   gets undefined and every id lookup 404s while looking correct. Every business-scoped GET here carries a
   query (?status, ?open, ?limit), so all of them use **rx** with the QS optional-query tail, never `qrx`.
   Ids contain '~' (never '#', which the browser strips as a fragment delimiter before the request is sent).

   PURE-ish: `readBody` / `respondJson` injected, so this is unit-testable without booting the server. */

'use strict';

const MAX_BODY = 64 * 1024;

// '<businessId>~w1' / 'acme~v3' — so '~' must be legal in an id.
const ID = '([A-Za-z0-9_~-]+)';
const BIZ = '([A-Za-z0-9_-]+)';

const QS = '(?:\\?[^#]*)?$';   // the optional-query tail — see the header.

const RX_BIZ_WORKORDERS = new RegExp('^/api/businesses/' + BIZ + '/workorders' + QS);
const RX_BIZ_WO_SUMMARY = new RegExp('^/api/businesses/' + BIZ + '/workorders/summary' + QS);

const RX_WORKORDER = new RegExp('^/api/workorders/' + ID + '$');
const RX_WO_RUN = new RegExp('^/api/workorders/' + ID + '/run$');
const RX_WO_APPROVE = new RegExp('^/api/worker/approvals/' + ID + '/approve$');
const RX_WO_REJECT = new RegExp('^/api/worker/approvals/' + ID + '/reject$');

function defaultRespondJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function makeWorkerRoutes(deps) {
  deps = deps || {};
  const workorders = deps.workorders;
  const worker = deps.worker;
  const approvals = deps.approvals || null;
  const businesses = deps.businesses || null;
  const emit = typeof deps.emit === 'function' ? deps.emit : null;
  // telemetry must never fail a committed mutation; the caught error is RETURNED, never swallowed into an empty
  // catch (the failopen ratchet bans that shape).
  function emitSafe(name, payload) {
    if (!emit) return null;
    try { emit(name, payload); return null; } catch (e) { return e; }
  }
  // readBody(req, max) returns the RAW utf8 string and THROWS on oversize (sidecar/http-body.js), so the
  // envelope is built here. Getting this shape wrong is silent: the handler sees a truthy string with no
  // `.ok`, every POST 400s, and the route still looks correct in the table.
  const readBody = typeof deps.readBody === 'function' ? deps.readBody : (() => Promise.resolve('{}'));
  const respondJson = typeof deps.respondJson === 'function' ? deps.respondJson : defaultRespondJson;

  if (!workorders) throw new Error('worker-routes needs a workorders store');
  if (!worker) throw new Error('worker-routes needs the worker runner');

  async function readJson(req) {
    let raw;
    try { raw = await readBody(req, MAX_BODY); } catch (e) { return { ok: false, code: 413, error: 'body too large' }; }
    try { return { ok: true, body: JSON.parse(raw || '{}') || {} }; }
    catch (e) { return { ok: false, code: 400, error: 'bad json' }; }
  }

  const str = (v, cap) => (v == null ? '' : String(v)).slice(0, cap == null ? 2000 : cap);
  const q = (req) => {
    try { return new URLSearchParams(String((req && req.url) || '').split('?')[1] || ''); }
    catch (_) { return new URLSearchParams(''); }
  };

  // P6: a businessId that does not name a real business is a 404, never a silent empty list.
  function businessMissing(biz) {
    if (!biz) return true;
    if (!businesses || typeof businesses.get !== 'function') return false;
    return !businesses.get(biz);
  }

  // ---- catalog ------------------------------------------------------------------------------------
  /* The whole policy table, so the console can show a user WHY a tool got its tier rather than asking them to
     trust it. Served from the module that enforces it — the UI cannot drift from the rules. */
  function handleCatalog(req, res) {
    return respondJson(res, 200, worker.catalog());
  }

  // ---- test a plan WITHOUT writing anything (§19's "look before you leap") ------------------------
  function handleTest(req, res) {
    return readJson(req).then(function (parsed) {
      if (!parsed.ok) return respondJson(res, parsed.code || 400, { ok: false, error: parsed.error });
      const body = parsed.body || {};
      const biz = str(body.businessId, 200).trim();
      if (businessMissing(biz)) return respondJson(res, 404, { ok: false, error: 'no such business: ' + biz });
      const r = worker.testPlan(biz, { agentId: body.agentId, steps: body.steps });
      if (!r.ok) return respondJson(res, 422, { ok: false, error: r.reason });
      // a classification is a look, not a write — say so in the payload so no client can mistake it for a job
      return respondJson(res, 200, { ok: true, dryRun: true, steps: r.steps, summary: r.summary, grants: r.grants });
    });
  }

  // ---- work orders (business-scoped) ---------------------------------------------------------------
  function handleListWorkOrders(req, res, match) {
    const biz = match && match[1];
    if (businessMissing(biz)) return respondJson(res, 404, { ok: false, error: 'no such business: ' + biz });
    const sp = q(req);
    const opts = {};
    const status = str(sp.get('status'), 40).trim();
    if (status) {
      if (workorders.STATUSES.indexOf(status) < 0) {
        return respondJson(res, 422, { ok: false, error: 'unknown status filter "' + status + '" — one of: ' + workorders.STATUSES.join(', ') });
      }
      opts.status = status;
    }
    const agentId = str(sp.get('agentId'), 200).trim();
    if (agentId) opts.agentId = agentId;
    if (sp.get('open') === '1' || sp.get('open') === 'true') opts.open = true;
    const lim = Number(sp.get('limit'));
    if (Number.isFinite(lim) && lim > 0) opts.limit = Math.min(lim, 500);

    const list = workorders.list(biz, opts);
    return respondJson(res, 200, { ok: true, workorders: list, count: list.length, summary: workorders.summary(biz) });
  }

  function handleCreateWorkOrder(req, res, match) {
    const biz = match && match[1];
    if (businessMissing(biz)) return respondJson(res, 404, { ok: false, error: 'no such business: ' + biz });
    return readJson(req).then(function (parsed) {
      if (!parsed.ok) return respondJson(res, parsed.code || 400, { ok: false, error: parsed.error });
      const body = parsed.body || {};
      const r = worker.plan(biz, {
        agentId: body.agentId,
        intent: body.intent,
        steps: body.steps,
        dryRun: body.dryRun,
        note: body.note,
        createdBy: 'user'
      });
      if (!r.ok) return respondJson(res, 422, { ok: false, error: r.reason });
      // 201: an order was created. It has NOT run — running is a separate, explicit act (§19).
      return respondJson(res, 201, { ok: true, workorder: r.order, summary: r.summary, ran: false });
    });
  }

  function handleWorkOrdersFamily(req, res, match) {
    if (req.method === 'GET') return handleListWorkOrders(req, res, match);
    if (req.method === 'POST') return handleCreateWorkOrder(req, res, match);
    return respondJson(res, 405, { ok: false, error: 'method not allowed' });
  }

  function handleSummary(req, res, match) {
    const biz = match && match[1];
    if (businessMissing(biz)) return respondJson(res, 404, { ok: false, error: 'no such business: ' + biz });
    return respondJson(res, 200, { ok: true, summary: workorders.summary(biz) });
  }

  // ---- one work order ------------------------------------------------------------------------------
  function handleWorkOrderOne(req, res, match) {
    const id = match && match[1];
    const order = workorders.get(id);
    if (!order) return respondJson(res, 404, { ok: false, error: 'no such work order: ' + id });
    if (req.method === 'GET') return respondJson(res, 200, { ok: true, workorder: order, summary: worker.summariseOrder(order) });
    if (req.method === 'DELETE') {
      const r = workorders.remove(id);
      if (!r.ok) return respondJson(res, 409, { ok: false, error: r.reason });
      /* A removed order's pending requests must not outlive it. They are found by `params.orderId`, NOT by
         `automationId`: a worker-filed request deliberately leaves `automationId` empty because it was not
         filed by an automation, and overloading that field would make the two request sources
         indistinguishable in the one queue they share. */
      let expired = 0;
      if (approvals && typeof approvals.list === 'function' && typeof approvals.expire === 'function') {
        const mine = approvals.list(r.removed.businessId).filter(a =>
          a.status === 'pending' && a.params && a.params.orderId === r.removed.id);
        for (const a of mine) { const ex = approvals.expire(a.id, 'the work order behind it was removed'); if (ex && ex.ok) expired += (ex.expired || 0); }
      }
      emitSafe('business.workorder.removed', {
        businessId: r.removed.businessId, orderId: r.removed.id, expiredApprovals: expired
      });
      return respondJson(res, 200, { ok: true, removed: r.removed.id, expiredApprovals: expired });
    }
    return respondJson(res, 405, { ok: false, error: 'method not allowed' });
  }

  /* RUN. §19: this is the explicit human act.

     `attended` controls whether the RUNTIME consent gate is consulted for this run. Unattended is the DEFAULT —
     a request that forgets to say gets the cautious behaviour (a consent-requiring step is held), never the
     permissive one. Attended does NOT mean "a person just answered"; there is no prompt channel on an HTTP
     request and this route does not pretend otherwise. What it means is that the broker IS asked, so a DURABLE
     grant the user already made (a permanent `cabinet:write`, FULL ACCESS) can take effect. Writing this
     distinction down matters: an `attended` flag that silently meant "allowed" would be a bypass wearing a
     question mark. See workerConsentFor in index.js. */
  function handleRun(req, res, match) {
    const id = match && match[1];
    const order = workorders.get(id);
    if (!order) return respondJson(res, 404, { ok: false, error: 'no such work order: ' + id });
    return readJson(req).then(function (parsed) {
      if (!parsed.ok) return respondJson(res, parsed.code || 400, { ok: false, error: parsed.error });
      const body = parsed.body || {};
      const attended = body.attended === true;
      const opts = {};
      if (attended && typeof deps.consentFor === 'function') {
        const c = deps.consentFor(order);
        if (typeof c === 'function') opts.consent = c;
      }
      return worker.run(id, opts).then(function (r) {
        if (!r.ok) return respondJson(res, 409, { ok: false, error: r.reason });
        return respondJson(res, 200, {
          ok: true, workorder: r.order, receipts: r.receipts, summary: r.summary, attended: attended
        });
      });
    });
  }

  // ---- the worker's own approval decider (§13 review, filed by the runner) -------------------------
  /* P6: an approval is decided through THIS surface only when it belongs to a work order. A request with no
     `params.orderId` was filed by the Phase 5 automation engine and must be decided there — refusing it here
     keeps the two execution paths from being interchangeable. */
  function workerApproval(id) {
    if (!approvals || typeof approvals.get !== 'function') return { ok: false, code: 503, error: 'no approval store is wired' };
    const a = approvals.get(id);
    if (!a) return { ok: false, code: 404, error: 'no such approval: ' + str(id, 200) };
    if (!a.params || !a.params.orderId) {
      return { ok: false, code: 409, error: 'this request was not filed by a work order — decide it through the automation surface' };
    }
    return { ok: true, approval: a };
  }

  function handleApprove(req, res, match) {
    const id = match && match[1];
    const g = workerApproval(id);
    if (!g.ok) return respondJson(res, g.code, { ok: false, error: g.error });
    return readJson(req).then(function (parsed) {
      if (!parsed.ok) return respondJson(res, parsed.code || 400, { ok: false, error: parsed.error });
      const body = parsed.body || {};
      return worker.approveStep(id, str(body.by, 120) || 'user', {}).then(function (r) {
        if (!r.ok) return respondJson(res, 409, { ok: false, error: r.reason });
        return respondJson(res, 200, { ok: true, approval: r.approval, step: r.step, workorder: r.order, summary: worker.summariseOrder(r.order) });
      });
    });
  }

  function handleReject(req, res, match) {
    const id = match && match[1];
    const g = workerApproval(id);
    if (!g.ok) return respondJson(res, g.code, { ok: false, error: g.error });
    return readJson(req).then(function (parsed) {
      if (!parsed.ok) return respondJson(res, parsed.code || 400, { ok: false, error: parsed.error });
      const body = parsed.body || {};
      return worker.rejectStep(id, str(body.by, 120) || 'user', body.reason).then(function (r) {
        if (!r.ok) return respondJson(res, 409, { ok: false, error: r.reason });
        return respondJson(res, 200, { ok: true, approval: r.approval, workorder: r.order });
      });
    });
  }

  const routes = [
    { m: 'GET', exact: '/api/worker/catalog', h: handleCatalog },
    { m: 'POST', exact: '/api/worker/test', h: handleTest },

    // GET + POST on the collection; summary is a distinct path so a plain GET can never be mistaken for it.
    { m: 'GET', rx: RX_BIZ_WO_SUMMARY, h: handleSummary },
    { m: ['GET', 'POST'], rx: RX_BIZ_WORKORDERS, h: handleWorkOrdersFamily },

    { m: 'GET', rx: RX_WORKORDER, h: handleWorkOrderOne },
    { m: 'DELETE', rx: RX_WORKORDER, h: handleWorkOrderOne },
    { m: 'POST', rx: RX_WO_RUN, h: handleRun },

    { m: 'POST', rx: RX_WO_APPROVE, h: handleApprove },
    { m: 'POST', rx: RX_WO_REJECT, h: handleReject }
  ];

  return {
    routes,
    handleCatalog, handleTest,
    handleWorkOrdersFamily, handleListWorkOrders, handleCreateWorkOrder, handleSummary,
    handleWorkOrderOne, handleRun, handleApprove, handleReject,
    businessMissing, workerApproval
  };
}

module.exports = {
  makeWorkerRoutes,
  RX_BIZ_WORKORDERS, RX_BIZ_WO_SUMMARY, RX_WORKORDER, RX_WO_RUN, RX_WO_APPROVE, RX_WO_REJECT,
  MAX_BODY
};
