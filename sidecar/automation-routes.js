/* sidecar/automation-routes.js — the HTTP surface for the AUTOMATION HUB (Business OS Phase 5).

   Phase 5 is §30's "Automation": Engine · triggers · conditions · actions · scheduling · failure recovery ·
   approval workflows (§12 the automation hub, §13 the action permission tiers, §19 the human controls).

   WHY A SEPARATE MODULE. Same reason as business-routes.js / maker-routes.js / agent-routes.js /
   manager-routes.js: sidecar/index.js is the merge-conflict hotfile named in CODE_MAP, so handlers live
   here and index.js adds a require plus ROWS to the route table.

   AUTH: these are /api/* routes, so apiauth.js's per-launch token gate covers them automatically.

   THE GUARDS THIS MODULE EXISTS TO EXPOSE — every one lives in a STORE or the ENGINE, not here, so a route
   can never drift from the rule it enforces:
     §12 — a trigger must be one of the curated contract events; conditions and actions come from closed
           vocabularies; the enable/disable switch is the only way a rule starts or stops running.
     §13 — the tier is DERIVED from the action (never declared), and a review-tier action becomes a pending
           approval instead of running. A decision is final, so double-approval cannot run an action twice.
     §19 — the hub halt. This module exposes it; the ENGINE owns it, so every path that could fire a rule
           (a bus event, an approval, a manual inject) is stopped by the same flag.
     P6  — every read and write names its business; a payload injected by hand must name the SAME business
           as the rule it is injected into, or it is refused.

   ROUTE MATCHING — the trap that produces a route which looks right and never fires. index.js's dispatch
   populates the match array only for `rx` rows; a `qrx` row leaves it NULL, so a handler reading
   `match[1]` gets undefined. Every business-scoped GET here carries a query (?status, ?limit), so all of
   them use **rx** with the QS optional-query tail, never `qrx`. Ids contain '~' (never '#', which the
   browser strips as a fragment delimiter before the request is even sent).

   PURE-ish: `readBody` / `respondJson` injected, so this is unit-testable without booting the server. */

'use strict';

const MAX_BODY = 64 * 1024;

// '<businessId>~a1' / 'acme~v3' — so '~' must be legal in an id.
const ID = '([A-Za-z0-9_~-]+)';
const BIZ = '([A-Za-z0-9_-]+)';

const QS = '(?:\\?[^#]*)?$';   // the optional-query tail — see the header.

const RX_BIZ_AUTOMATIONS = new RegExp('^/api/businesses/' + BIZ + '/automations' + QS);
const RX_BIZ_AUTO_RUNS = new RegExp('^/api/businesses/' + BIZ + '/automations/runs' + QS);
const RX_BIZ_APPROVALS = new RegExp('^/api/businesses/' + BIZ + '/approvals' + QS);

const RX_AUTOMATION = new RegExp('^/api/automations/' + ID + '$');
const RX_AUTO_ENABLE = new RegExp('^/api/automations/' + ID + '/enable$');
const RX_AUTO_DISABLE = new RegExp('^/api/automations/' + ID + '/disable$');
const RX_AUTO_TEST = new RegExp('^/api/automations/' + ID + '/test$');
const RX_AUTO_RUN = new RegExp('^/api/automations/' + ID + '/run$');
const RX_AUTO_RUNS = new RegExp('^/api/automations/' + ID + '/runs' + QS);

const RX_APPROVAL = new RegExp('^/api/approvals/' + ID + '$');
const RX_APPROVE = new RegExp('^/api/approvals/' + ID + '/approve$');
const RX_REJECT = new RegExp('^/api/approvals/' + ID + '/reject$');

function defaultRespondJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function makeAutomationRoutes(deps) {
  deps = deps || {};
  const automation = deps.automation;
  const approvals = deps.approvals;
  const engine = deps.engine;
  const businesses = deps.businesses || null;
  const activity = deps.activity || null;
  const readBody = deps.readBody;
  const respondJson = typeof deps.respondJson === 'function' ? deps.respondJson : defaultRespondJson;
  const emit = typeof deps.emit === 'function' ? deps.emit : null;
  // the ONE place that flips the hub's halt flag AND stamps it durably, so the two can never disagree.
  // Injected by index.js (it owns the file); absent in a unit test, which then falls back to the engine.
  const setHalted = typeof deps.setHalted === 'function' ? deps.setHalted : null;

  if (!automation || !approvals || !engine) {
    throw new Error('automation-routes.js requires { automation, approvals, engine }');
  }
  if (typeof readBody !== 'function') throw new Error('automation-routes.js requires { readBody }');

  // The closed vocabularies, read from the modules that OWN them rather than restated here — so the
  // picker the UI renders can never drift from the value the store accepts.
  const Autom = require('./business-automation-store.js');
  const Perms = require('./business-permissions.js');
  const Metrics = require('./business-metrics.js');
  const Crm = require('./business-crm-store.js');
  const Finance = require('./business-finance.js');
  const Documents = require('./business-documents-store.js');
  const Tasks = require('./business-tasks-store.js');
  const Content = require('./business-content-store.js');

  const json = (res, code, obj) => respondJson(res, code, obj);
  const q = (req) => new URL(String(req.url), 'http://x').searchParams;
  const s = (v) => (v == null ? '' : String(v));

  // telemetry can never fail a committed mutation; the caught error is RETURNED, never swallowed into an
  // empty catch (failopen-ratchet bans that shape).
  function emitSafe(name, payload) {
    if (!emit) return null;
    try { emit(name, payload); return null; } catch (e) { return e; }
  }
  function audit(businessId, row) {
    if (!activity) return null;
    try { activity.append(businessId, row); return null; } catch (e) { return e; }
  }

  async function readJson(req) {
    let raw;
    try { raw = await readBody(req, MAX_BODY); } catch (_) { return { ok: false, code: 413, error: 'body too large' }; }
    try { return { ok: true, body: JSON.parse(raw || '{}') || {} }; }
    catch (_) { return { ok: false, code: 400, error: 'bad json' }; }
  }

  function businessMissing(id) {
    if (!businesses) return false;
    return !businesses.has(id);
  }

  // ---- catalog ------------------------------------------------------------------------------------
  /* Every picker vocabulary, in one response, owned by the module that enforces it. The action params
     need the target stores' own closed sets (metric ids, CRM stages, finance categories…), which is why
     this route exists rather than a hard-coded list in the frontend. */
  function handleCatalog(req, res) {
    return json(res, 200, {
      triggers: Autom.TRIGGER_EVENTS,
      ops: Autom.CONDITION_OPS,
      actions: Autom.AUTOMATION_ACTIONS.map(a => {
        const c = Perms.classify(a.perm);
        return {
          id: a.id, label: a.label, perm: a.perm, tier: c.tier, risk: a.risk, executor: a.executor,
          required: a.required, optional: a.optional, note: a.note
        };
      }),
      tiers: Perms.TIERS,
      tierNotes: Perms.TIER_NOTES,
      evidence: Perms.EVIDENCE,
      limits: {
        maxConditions: Autom.MAX_CONDITIONS, maxActions: Autom.MAX_ACTIONS,
        failureThreshold: Autom.FAILURE_THRESHOLD,
        defaultCooldownMs: Autom.DEFAULT_COOLDOWN_MS, maxCooldownMs: Autom.MAX_COOLDOWN_MS,
        maxDepth: engine.MAX_DEPTH, maxRunsPerPass: engine.MAX_RUNS_PER_PASS,
        maxRulesPerEvent: engine.MAX_RULES_PER_EVENT
      },
      // the params each action's pickers are drawn from
      params: {
        metrics: Metrics.METRICS,
        crmStages: Crm.STAGES,
        interactionKinds: Crm.INTERACTION_KINDS,
        financeKinds: Finance.KINDS,
        revenueCategories: Finance.REVENUE_CATEGORIES,
        expenseCategories: Finance.EXPENSE_CATEGORIES,
        provenance: Finance.PROVENANCE,
        documentTypes: Documents.TYPES,
        taskPriorities: Tasks.PRIORITIES,
        contentStages: Content.STAGES,
        contentChannels: Content.CHANNELS
      },
      approvalStatuses: approvals.STATUSES
    });
  }

  // ---- the hub itself (§19) ----------------------------------------------------------------------
  function handleStatus(req, res) {
    return json(res, 200, { ok: true, hub: engine.stats() });
  }
  function handleHalt(req, res) {
    const r = setHalted ? setHalted(true) : { halted: true, dropped: engine.halt().dropped, persisted: false };
    emitSafe('automation.halted', { halted: true, dropped: r.dropped });
    return json(res, 200, { ok: true, hub: engine.stats(), dropped: r.dropped, persisted: !!r.persisted });
  }
  function handleResume(req, res) {
    const r = setHalted ? setHalted(false) : { halted: false, dropped: 0, persisted: false };
    engine.resume();                     // idempotent, and guarantees the RAM flag is off even if setHalted threw
    emitSafe('automation.halted', { halted: false, dropped: 0 });
    return json(res, 200, { ok: true, hub: engine.stats(), persisted: !!r.persisted });
  }

  // ---- automations (§12) -------------------------------------------------------------------------
  function handleListAutomations(req, res, match) {
    const biz = match && match[1];
    if (businessMissing(biz)) return json(res, 404, { ok: false, error: 'no such business: ' + biz });
    const list = automation.list(biz);
    return json(res, 200, { automations: list, count: list.length, summary: automation.summary(biz) });
  }

  async function handleCreateAutomation(req, res, match) {
    const biz = match && match[1];
    if (businessMissing(biz)) return json(res, 404, { ok: false, error: 'no such business: ' + biz });
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });
    const r = automation.create(biz, parsed.body);
    if (!r.ok) return json(res, 422, { ok: false, error: r.reason });
    emitSafe('business.automation.created', { businessId: biz, automationId: r.automation.id, name: r.automation.name, trigger: r.automation.trigger });
    audit(biz, {
      actor: { kind: 'user', id: '', name: '' },
      action: 'Created automation "' + r.automation.name + '"',
      reason: r.automation.enabled ? 'enabled on create' : 'created switched off',
      result: 'ok', approval: 'not-required'
    });
    return json(res, 201, { ok: true, automation: r.automation });
  }

  function handleAutomationOne(req, res, match) {
    const id = match && match[1];
    const a = automation.get(id);
    if (!a) return json(res, 404, { ok: false, error: 'no such automation: ' + id });
    if (req.method === 'GET') {
      return json(res, 200, {
        automation: a,
        runs: automation.runsFor(id, 20),
        pendingApprovals: approvals.list(a.businessId, { status: 'pending' }).filter(v => v.automationId === id).length
      });
    }
    if (req.method === 'DELETE') return handleDeleteAutomation(req, res, id, a);
    return json(res, 405, { ok: false, error: 'method not allowed' });
  }

  async function handlePatchAutomation(req, res, match) {
    const id = match && match[1];
    const prev = automation.get(id);
    if (!prev) return json(res, 404, { ok: false, error: 'no such automation: ' + id });
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });
    const r = automation.update(id, parsed.body);
    if (!r.ok) return json(res, 422, { ok: false, error: r.reason });
    const changed = [];
    for (const f of ['name', 'trigger', 'cooldownMs']) if (JSON.stringify(prev[f]) !== JSON.stringify(r.automation[f])) changed.push(f);
    if (JSON.stringify(prev.conditions) !== JSON.stringify(r.automation.conditions)) changed.push('conditions');
    if (JSON.stringify(prev.actions) !== JSON.stringify(r.automation.actions)) changed.push('actions');
    if (changed.length) emitSafe('business.automation.updated', { businessId: r.automation.businessId, automationId: id, trigger: r.automation.trigger, changed: changed });
    return json(res, 200, { ok: true, automation: r.automation, changed: changed });
  }

  /* DELETE. Two things must happen beyond dropping the row, and both live HERE because the store cannot
     see the approval queue: (1) a pending request raised by this automation is EXPIRED rather than left
     for a decision nobody can act on, and (2) the expiry is reported. */
  function handleDeleteAutomation(req, res, id, a) {
    const r = automation.remove(id);
    if (!r.ok) return json(res, 500, { ok: false, error: r.reason });
    const ex = approvals.expireForAutomation(id, 'the automation that raised it was removed');
    emitSafe('business.automation.removed', { businessId: a.businessId, automationId: id, name: a.name });
    audit(a.businessId, {
      actor: { kind: 'user', id: '', name: '' }, action: 'Removed automation "' + a.name + '"',
      reason: ex.expired ? ex.expired + ' pending request(s) expired with it' : 'no pending requests',
      result: 'ok', approval: 'not-required'
    });
    return json(res, 200, { ok: true, removed: id, expiredApprovals: ex.expired || 0 });
  }

  function setEnabled(req, res, match, on) {
    const id = match && match[1];
    const prev = automation.get(id);
    if (!prev) return json(res, 404, { ok: false, error: 'no such automation: ' + id });
    const r = automation.setEnabled(id, on, { reason: on ? '' : 'switched off by you' });
    if (!r.ok) return json(res, 403, { ok: false, error: r.reason });
    if (r.changed) {
      emitSafe(on ? 'business.automation.enabled' : 'business.automation.disabled', on
        ? { businessId: r.automation.businessId, automationId: id, name: r.automation.name }
        : { businessId: r.automation.businessId, automationId: id, name: r.automation.name, reason: r.automation.disabledReason });
      audit(r.automation.businessId, {
        actor: { kind: 'user', id: '', name: '' },
        action: (on ? 'Enabled' : 'Disabled') + ' automation "' + r.automation.name + '"',
        reason: on ? 'switched on' : r.automation.disabledReason, result: 'ok', approval: 'not-required'
      });
    }
    return json(res, 200, { ok: true, automation: r.automation, changed: r.changed });
  }

  async function handleTest(req, res, match) {
    const id = match && match[1];
    const a = automation.get(id);
    if (!a) return json(res, 404, { ok: false, error: 'no such automation: ' + id });
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });
    const payload = (parsed.body && parsed.body.payload && typeof parsed.body.payload === 'object') ? parsed.body.payload : {};
    // P6: a payload injected by hand must name the SAME business as the rule. Without this a caller could
    // dry-run acme's rule against beta's data and read the result.
    const pb = s(payload.businessId).trim();
    if (pb && pb !== a.businessId) {
      return json(res, 409, { ok: false, error: 'that payload names business "' + pb + '", but this automation belongs to "' + a.businessId + '" — cross-business payloads are refused (P6)' });
    }
    const r = engine.testRun(id, payload);
    if (!r.ok) return json(res, 422, { ok: false, error: r.reason });
    return json(res, 200, { ok: true, test: r });
  }

  /* RUN — a manual inject of the rule's own trigger event. It goes through engine.handleEvent, so it
     passes EVERY gate a real event passes: the hub halt, the business's paused stage, the rule's cooldown
     and its conditions. There is deliberately no bypass — a "run now" that skipped the cooldown would be
     a way to storm a chatty trigger by hand. */
  async function handleRun(req, res, match) {
    const id = match && match[1];
    const a = automation.get(id);
    if (!a) return json(res, 404, { ok: false, error: 'no such automation: ' + id });
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });
    const given = (parsed.body && parsed.body.payload && typeof parsed.body.payload === 'object') ? parsed.body.payload : {};
    const pb = s(given.businessId).trim();
    if (pb && pb !== a.businessId) {
      return json(res, 409, { ok: false, error: 'that payload names business "' + pb + '", but this automation belongs to "' + a.businessId + '" — cross-business payloads are refused (P6)' });
    }
    const payload = Object.assign({}, given, { businessId: a.businessId });
    const r = engine.handleEvent(a.trigger, payload);
    if (!r.ok) return json(res, 409, { ok: false, error: r.reason });
    const ran = (r.results || []).filter(x => x.ruleId === id);
    audit(a.businessId, {
      actor: { kind: 'user', id: '', name: '' }, action: 'Fired automation "' + a.name + '" by hand',
      reason: ran.length ? 'ran' : 'the trigger fired but this rule did not match (conditions or cooldown)',
      result: ran.length && ran[0].ok ? 'ok' : 'pending', approval: 'not-required'
    });
    return json(res, 200, { ok: true, ran: ran.length, result: ran[0] || null, hub: engine.stats() });
  }

  function handleAutomationRuns(req, res, match) {
    const id = match && match[1];
    if (!automation.has(id)) return json(res, 404, { ok: false, error: 'no such automation: ' + id });
    const p = q(req);
    const n = Number(p.get('limit'));
    const runs = automation.runsFor(id, Number.isFinite(n) && n > 0 ? n : 0);
    return json(res, 200, { runs: runs, count: runs.length, lastFiredAt: automation.lastFiredAt(id) });
  }

  function handleBusinessRuns(req, res, match) {
    const biz = match && match[1];
    if (businessMissing(biz)) return json(res, 404, { ok: false, error: 'no such business: ' + biz });
    const p = q(req);
    const n = Number(p.get('limit'));
    const runs = automation.runsForBusiness(biz, Number.isFinite(n) && n > 0 ? n : 50);
    return json(res, 200, { runs: runs, count: runs.length });
  }

  function handleAutomationsFamily(req, res, match) {
    if (req.method === 'GET') return handleListAutomations(req, res, match);
    if (req.method === 'POST') return handleCreateAutomation(req, res, match);
    return json(res, 405, { ok: false, error: 'method not allowed' });
  }

  // ---- approvals (§13) ---------------------------------------------------------------------------
  function handleListApprovals(req, res, match) {
    const biz = match && match[1];
    if (businessMissing(biz)) return json(res, 404, { ok: false, error: 'no such business: ' + biz });
    const p = q(req);
    const status = p.get('status');
    if (status && approvals.STATUSES.indexOf(status) < 0) {
      return json(res, 422, { ok: false, error: 'unknown status: ' + status + ' — one of: ' + approvals.STATUSES.join(', ') });
    }
    const list = approvals.list(biz, { status: status });
    return json(res, 200, { approvals: list, count: list.length, pending: approvals.pendingCount(biz), summary: approvals.summary(biz) });
  }

  function handleApprovalOne(req, res, match) {
    const id = match && match[1];
    const a = approvals.get(id);
    if (!a) return json(res, 404, { ok: false, error: 'no such approval: ' + id });
    if (req.method === 'GET') return json(res, 200, { approval: a });
    if (req.method === 'DELETE') {
      if (a.status === 'pending') return json(res, 409, { ok: false, error: 'this request is still pending — approve or reject it rather than deleting it' });
      const r = approvals.remove(id);
      if (!r.ok) return json(res, 500, { ok: false, error: r.reason });
      return json(res, 200, { ok: true, removed: id });
    }
    return json(res, 405, { ok: false, error: 'method not allowed' });
  }

  /* APPROVE / REJECT (§13). The engine owns both: it settles the row and, on approve, runs the action.
     A refusal here is the store's "a decision is final" guard surfacing — a double-click is a 409, not a
     second execution. */
  async function handleApprove(req, res, match) {
    const id = match && match[1];
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });
    const r = engine.approve(id, s(parsed.body.by) || 'user');
    if (!r.ok) return json(res, /already/.test(r.reason || '') ? 409 : 422, { ok: false, error: r.reason });
    return json(res, 200, { ok: true, approval: r.approval, executed: r.executed });
  }

  async function handleReject(req, res, match) {
    const id = match && match[1];
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });
    const r = engine.reject(id, s(parsed.body.reason), s(parsed.body.by) || 'user');
    if (!r.ok) return json(res, /already/.test(r.reason || '') ? 409 : 422, { ok: false, error: r.reason });
    return json(res, 200, { ok: true, approval: r.approval });
  }

  // Route rows for index.js. Specific paths are listed before the bare :id rows so a future loosening of an
  // anchor cannot silently shadow them. Every business-scoped GET carries a query string, so all of them use
  // rx (which populates the match array) with the QS tail — see the header.
  const routes = [
    { m: 'GET', exact: '/api/automation/catalog', h: handleCatalog },
    { m: 'GET', exact: '/api/automation/status', h: handleStatus },
    { m: 'POST', exact: '/api/automation/halt', h: handleHalt },
    { m: 'POST', exact: '/api/automation/resume', h: handleResume },

    { m: 'GET', rx: RX_BIZ_AUTO_RUNS, h: handleBusinessRuns },
    { m: ['GET', 'POST'], rx: RX_BIZ_AUTOMATIONS, h: handleAutomationsFamily },
    // GET only: an approval is created by the ENGINE when a review-tier action fires. There is no
    // hand-made request path, because a request nobody's automation raised has no §26 block behind it.
    { m: 'GET', rx: RX_BIZ_APPROVALS, h: handleListApprovals },

    { m: 'POST', rx: RX_AUTO_ENABLE, h: function (req, res, m) { return setEnabled(req, res, m, true); } },
    { m: 'POST', rx: RX_AUTO_DISABLE, h: function (req, res, m) { return setEnabled(req, res, m, false); } },
    { m: 'POST', rx: RX_AUTO_TEST, h: handleTest },
    { m: 'POST', rx: RX_AUTO_RUN, h: handleRun },
    { m: 'GET', rx: RX_AUTO_RUNS, h: handleAutomationRuns },
    { m: 'GET', rx: RX_AUTOMATION, h: handleAutomationOne },
    { m: 'PATCH', rx: RX_AUTOMATION, h: handlePatchAutomation },
    { m: 'DELETE', rx: RX_AUTOMATION, h: handleAutomationOne },

    { m: 'POST', rx: RX_APPROVE, h: handleApprove },
    { m: 'POST', rx: RX_REJECT, h: handleReject },
    { m: 'GET', rx: RX_APPROVAL, h: handleApprovalOne },
    { m: 'DELETE', rx: RX_APPROVAL, h: handleApprovalOne }
  ];

  return {
    routes,
    handleCatalog, handleStatus, handleHalt, handleResume,
    handleAutomationsFamily, handleListAutomations, handleCreateAutomation,
    handleAutomationOne, handlePatchAutomation, handleDeleteAutomation, setEnabled,
    handleTest, handleRun, handleAutomationRuns, handleBusinessRuns,
    handleListApprovals, handleApprovalOne, handleApprove, handleReject
  };
}

module.exports = {
  makeAutomationRoutes,
  RX_BIZ_AUTOMATIONS, RX_BIZ_AUTO_RUNS, RX_BIZ_APPROVALS,
  RX_AUTOMATION, RX_AUTO_ENABLE, RX_AUTO_DISABLE, RX_AUTO_TEST, RX_AUTO_RUN, RX_AUTO_RUNS,
  RX_APPROVAL, RX_APPROVE, RX_REJECT,
  MAX_BODY
};
