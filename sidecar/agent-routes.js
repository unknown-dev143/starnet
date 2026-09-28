/* sidecar/agent-routes.js — the HTTP surface for the AI BUSINESS TEAM (Business OS Phase 3).

   Phase 3 is §7's virtual team: a registry of role agents, the §13 permission model that decides what each
   may do unattended, the §9 four-scope memory they read and write, and the communication between them.

   WHY A SEPARATE MODULE. Same reason as business-routes.js and maker-routes.js: sidecar/index.js is the
   merge-conflict hotfile named in CODE_MAP, so handlers live here and index.js only adds a require plus ROWS
   to the route table.

   AUTH: these are /api/* routes, so apiauth.js's per-launch token gate covers them automatically.

   THE GUARDS THIS MODULE EXISTS TO EXPOSE — every one lives in a STORE, not here, so a route can never drift
   from the rule it is supposed to enforce:
     P6 (§9/§21)  — a hire/message/memory write names its business and an empty one is refused. /api/tasks/:id/assign
                    additionally refuses an agent from a DIFFERENT business, which is the cross-tenant link the
                    flat JSON stores cannot enforce on their own.
     P7 (§7)      — an agent is a configuration. /api/roles reports BusinessRoles.unresolved() so a role whose
                    classes were renamed is visible as broken instead of silently unfillable.
     §13          — grants are sanitised by business-permissions.js, which forces restricted:false. The route
                    echoes the SANITISED grants back, so a client that tried to grant restricted sees it was
                    not applied rather than believing it was.
     P1 (§9)      — a memory write requires a source; the store refuses one without. The route passes it
                    straight through and returns the refusal with a 422.
     §20          — an ASSIGNMENT decision is durable, whichever way it went. Both the assignment and every
                    refusal of one write an activity row, so "why was this refused?" is answerable after the
                    fact instead of living only in a response body nobody kept. See auditDecision().

   ROUTES (all JSON):
     GET    /api/roles                          -> { roles, unresolved }
     GET    /api/permissions                    -> { tiers, defaultGrants }
     GET    /api/businesses/:id/agents          -> { agents, count }
     POST   /api/businesses/:id/agents          -> { ok, agent }                 (body { role, specialty, name, grants })
     GET    /api/businesses/:id/memory          -> { entries, counts, scope, ownerId }
     POST   /api/businesses/:id/memory          -> { ok, entry }                 (body { scope, ownerId, kind, text, source })
     GET    /api/businesses/:id/messages        -> { messages, parties }
     POST   /api/businesses/:id/messages        -> { ok, message }               (body { from, to, kind, subject, body, refs })
     GET    /api/agents/:id                     -> { agent, memoryNamespace, decisions }
     PATCH  /api/agents/:id                     -> { ok, agent, changed }
     DELETE /api/agents/:id                     -> { ok, removed }               (409 if tasks are assigned)
     POST   /api/agents/:id/status              -> { ok, agent }                 (body { status })
     POST   /api/agents/:id/grants              -> { ok, agent }                 (body { grants }; restricted is forced false)
     POST   /api/tasks/:id/assign               -> { ok, task }                  (body { agentId }; '' unassigns)
     DELETE /api/memory/:id                     -> { ok, removed }

   PURE-ish: `readBody` / `respondJson` injected, so this is unit-testable without booting the server. */

'use strict';

const MAX_BODY = 32 * 1024;

// An agent id is `<businessId>~a<n>` and a memory id is `<scope>~<ownerId>~<n>`, so '~' is legal in both id
// classes. '~' and not '#' because a '#' in a URL path is a FRAGMENT delimiter: the browser would drop the
// id and send the bare path, which matches nothing (the same bug fixed across Phase 2 — see validation-store.js).
const ID = '([A-Za-z0-9_~-]+)';
const BIZ = '([A-Za-z0-9_-]+)';

/* THE MATCH-KEY TRAP — this module had it, and it silently broke every business-scoped route on it.
   index.js's dispatch (see its ~line 9505) does:
       else if (r.rx)  { gm = url.match(r.rx); if (!gm) continue; }   // gm = the MATCH ARRAY, groups included
       else if (r.qrx) { if (!r.qrx.test(bare)) continue; }           // gm stays NULL — no groups captured
   and then calls r.h(req, res, gm). So a `qrx` row hands its handler match === null, and every handler below
   reads the businessId out of match[1] — which meant `POST /api/businesses/<id>/agents` answered
   "no such business: null" for a business that plainly existed (found live during app verification).

   The three business-scoped families are READ WITH A QUERY (?scope, ?owner, ?kind, ?with=true) AND their
   handlers need the id from the match groups, so they must be `rx` (which populates gm) with a regex that
   ACCEPTS the query. QS is that optional-query tail — the same discipline manager-routes.js documents.
   `qrx` would match the row and then 404, because the handler would have no id to look up. The exported
   RX_BIZ_* still .test() a bare path unchanged (QS matches an empty query). */
const QS = '(?:\\?[^#]*)?$';

const RX_BIZ_AGENTS = new RegExp('^/api/businesses/' + BIZ + '/agents' + QS);
const RX_BIZ_MEMORY = new RegExp('^/api/businesses/' + BIZ + '/memory' + QS);
const RX_BIZ_MESSAGES = new RegExp('^/api/businesses/' + BIZ + '/messages' + QS);
const RX_AGENT = new RegExp('^/api/agents/' + ID + '$');
const RX_AGENT_STATUS = new RegExp('^/api/agents/' + ID + '/status$');
const RX_AGENT_GRANTS = new RegExp('^/api/agents/' + ID + '/grants$');
const RX_TASK_ASSIGN = new RegExp('^/api/tasks/' + ID + '/assign$');
const RX_MEMORY = new RegExp('^/api/memory/' + ID + '$');

function defaultRespondJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function makeAgentRoutes(deps) {
  deps = deps || {};
  const agents = deps.agents;
  const memory = deps.memory;
  const messages = deps.messages;
  const tasks = deps.tasks || null;               // needed only by /api/tasks/:id/assign
  const businesses = deps.businesses || null;     // when present, a business is checked before a hire/memory/message write
  const activity = deps.activity || null;         // optional per-business audit sink
  const readBody = deps.readBody;
  const respondJson = typeof deps.respondJson === 'function' ? deps.respondJson : defaultRespondJson;
  const emit = typeof deps.emit === 'function' ? deps.emit : null;

  const BusinessRoles = deps.roles || require('../shared/business-roles.js');
  const BusinessPermissions = deps.permissions || require('./business-permissions.js');

  if (!agents || !memory || !messages) throw new Error('agent-routes.js requires { agents, memory, messages }');
  if (typeof readBody !== 'function') throw new Error('agent-routes.js requires { readBody }');

  const json = (res, code, obj) => respondJson(res, code, obj);
  const q = (req) => new URL(String(req.url), 'http://x').searchParams;

  // telemetry can never fail a committed mutation; the caught error is RETURNED, never swallowed into an
  // empty catch (failopen-ratchet bans that shape).
  function emitSafe(name, payload) {
    if (!emit) return null;
    try { emit(name, payload); return null; } catch (e) { return e; }
  }

  async function readJson(req) {
    let raw;
    try { raw = await readBody(req, MAX_BODY); } catch (_) { return { ok: false, code: 413, error: 'body too large' }; }
    try { return { ok: true, body: JSON.parse(raw || '{}') || {} }; }
    catch (_) { return { ok: false, code: 400, error: 'bad json' }; }
  }

  // A business that does not exist is a 404 on every business-scoped route — but only when the businesses
  // store was injected. Headless boots without it still work (the store itself is the isolation authority).
  function businessMissing(id) {
    if (!businesses) return false;
    return !businesses.has(id);
  }

  // ---- catalogs (§7 roles · §13 permissions) -------------------------------------------------------
  function handleRoles(req, res) {
    return json(res, 200, { roles: BusinessRoles.catalog(), unresolved: BusinessRoles.unresolved() });
  }

  function handlePermissions(req, res) {
    return json(res, 200, { tiers: BusinessPermissions.catalog(), defaultGrants: BusinessPermissions.DEFAULT_GRANTS });
  }

  // ---- agents (§7) --------------------------------------------------------------------------------
  function handleListAgents(req, res, match) {
    const biz = match && match[1];
    if (businessMissing(biz)) return json(res, 404, { ok: false, error: 'no such business: ' + biz });
    const list = agents.list(biz);
    return json(res, 200, { agents: list, count: list.length });
  }

  async function handleHire(req, res, match) {
    const biz = match && match[1];
    if (businessMissing(biz)) return json(res, 404, { ok: false, error: 'no such business: ' + biz });
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });

    const r = agents.hire(biz, parsed.body);
    if (!r.ok) return json(res, 400, { ok: false, error: r.reason });
    const a = r.agent;
    emitSafe('agent.hired', { businessId: biz, agentId: a.id, role: a.role, specialty: a.specialty, name: a.name });
    audit(biz, { actor: { kind: 'user', id: '', name: '' }, action: 'Hired the ' + a.role + ' agent (' + a.name + ')', reason: 'team hire', result: 'ok' });
    return json(res, 201, { ok: true, agent: a });
  }

  // The per-agent permission view: one row per §13 action, decided against THIS agent's stored grants. This
  // is what lets the UI show "may do / needs approval" without re-implementing the tier rules in JS.
  function decisionsFor(id) {
    return BusinessPermissions.ACTIONS.map(a => {
      const d = agents.decide(id, a.id);
      return { action: a.id, label: a.label, tier: a.tier, allow: d.allow, approval: d.approval, reason: d.reason };
    });
  }

  function handleAgentOne(req, res, match) {
    const id = match && match[1];
    const a = agents.get(id);
    if (!a) return json(res, 404, { ok: false, error: 'no such agent: ' + id });
    if (req.method === 'GET') {
      return json(res, 200, { agent: a, memoryNamespace: agents.memoryNamespace(id), decisions: decisionsFor(id) });
    }
    if (req.method === 'DELETE') return handleAgentDelete(req, res, id, a);
    return json(res, 405, { ok: false, error: 'method not allowed' });
  }

  function handleAgentDelete(req, res, id, a) {
    // Refuse to orphan assigned work. The check lives HERE rather than in the store because the agent store
    // must not reach into the task store's namespace (same rule as businesses-store.remove).
    if (tasks) {
      const assigned = tasks.list(a.businessId).filter(t => t.assignedAgent === id);
      if (assigned.length) {
        auditDecision(a.businessId, {
          action: 'Refused to remove the ' + a.role + ' agent (' + a.name + ')',
          reason: 'this agent has ' + assigned.length + ' task(s) assigned — reassign or clear them before removing it',
          result: 'refused',
          detail: 'agent=' + id + ' tasks=' + assigned.map(t => t.id).join(',')
        });
        return json(res, 409, {
          ok: false,
          error: 'this agent has ' + assigned.length + ' task(s) assigned — reassign or clear them before removing it',
          tasks: assigned.map(t => t.id)
        });
      }
    }
    const r = agents.remove(id);
    if (!r.ok) return json(res, 500, { ok: false, error: r.reason });
    emitSafe('agent.fired', { businessId: a.businessId, agentId: id, name: a.name });
    audit(a.businessId, { actor: { kind: 'user', id: '', name: '' }, action: 'Removed the ' + a.role + ' agent (' + a.name + ')', reason: 'team change', result: 'ok' });
    return json(res, 200, { ok: true, removed: id });
  }

  async function handleAgentPatch(req, res, match) {
    const id = match && match[1];
    const prev = agents.get(id);
    if (!prev) return json(res, 404, { ok: false, error: 'no such agent: ' + id });
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });

    const r = agents.update(id, parsed.body);
    if (!r.ok) return json(res, 400, { ok: false, error: r.reason });
    const a = r.agent;
    const changed = [];
    for (const f of ['name', 'role', 'specialty', 'status']) if (prev[f] !== a[f]) changed.push(f);
    if (JSON.stringify(prev.grants) !== JSON.stringify(a.grants)) changed.push('grants');
    if (changed.length) emitSafe('agent.updated', { businessId: a.businessId, agentId: id, role: a.role, status: a.status, changed: changed });
    return json(res, 200, { ok: true, agent: a, changed: changed });
  }

  async function handleAgentStatus(req, res, match) {
    const id = match && match[1];
    const a = agents.get(id);
    if (!a) return json(res, 404, { ok: false, error: 'no such agent: ' + id });
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });
    const r = agents.setStatus(id, parsed.body.status);
    if (!r.ok) return json(res, 400, { ok: false, error: r.reason });
    emitSafe('agent.updated', { businessId: r.agent.businessId, agentId: id, role: r.agent.role, status: r.agent.status, changed: ['status'] });
    audit(r.agent.businessId, { actor: { kind: 'user', id: '', name: '' }, action: 'Set the ' + r.agent.name + ' agent to ' + r.agent.status, reason: 'human control (§19)', result: 'ok' });
    return json(res, 200, { ok: true, agent: r.agent });
  }

  async function handleAgentGrants(req, res, match) {
    const id = match && match[1];
    const a = agents.get(id);
    if (!a) return json(res, 404, { ok: false, error: 'no such agent: ' + id });
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });
    const wanted = parsed.body.grants || {};
    const r = agents.setGrants(id, wanted);
    if (!r.ok) return json(res, 400, { ok: false, error: r.reason });
    const a2 = r.agent;
    emitSafe('agent.updated', { businessId: a2.businessId, agentId: id, role: a2.role, status: a2.status, changed: ['grants'] });
    // Tell the caller explicitly when the restricted tier was asked for and refused — silence here would let
    // a client believe it had granted something it had not.
    const out = { ok: true, agent: a2 };
    if (wanted.restricted) out.note = 'the restricted tier is never auto-grantable (§13) — it was not applied';
    return json(res, 200, out);
  }

  // ---- task assignment (§9 "assigned agent") -------------------------------------------------------
  async function handleAssign(req, res, match) {
    const taskId = match && match[1];
    if (!tasks) return json(res, 501, { ok: false, error: 'task assignment is not wired on this build' });
    const task = tasks.get(taskId);
    if (!task) return json(res, 404, { ok: false, error: 'no such task: ' + taskId });
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });

    const agentId = String(parsed.body.agentId == null ? '' : parsed.body.agentId).trim();
    if (agentId) {
      const a = agents.get(agentId);
      if (!a) {
        auditDecision(task.businessId, {
          action: 'Refused to assign task "' + task.title + '" — no such agent',
          reason: 'no such agent: ' + agentId,
          result: 'refused',
          detail: 'task=' + taskId + ' agent=' + agentId
        });
        return json(res, 404, { ok: false, error: 'no such agent: ' + agentId });
      }
      // P6: the agent must belong to the SAME business as the task. A cross-business assignment is the one
      // link a flat JSON store cannot catch, so it is refused here with a 409 the user can act on.
      if (a.businessId !== task.businessId) {
        const why = 'agent ' + agentId + ' belongs to business "' + a.businessId + '", but this task belongs to "' + task.businessId + '" — cross-business assignment is refused (P6)';
        auditDecision(task.businessId, {
          action: 'Refused to assign task "' + task.title + '" to agent ' + agentId,
          reason: why,
          result: 'refused',
          detail: 'task=' + taskId + ' agent=' + agentId + ' taskBusiness=' + task.businessId + ' agentBusiness=' + a.businessId
        });
        return json(res, 409, { ok: false, error: why });
      }
    }
    const r = tasks.update(taskId, { assignedAgent: agentId });
    if (!r.ok) {
      auditDecision(task.businessId, {
        action: 'Refused to assign task "' + task.title + '"',
        reason: r.reason,
        result: 'refused',
        detail: 'task=' + taskId + ' agent=' + agentId
      });
      return json(res, 400, { ok: false, error: r.reason });
    }
    if (agentId) {
      const a = agents.get(agentId);
      emitSafe('agent.assigned', { businessId: task.businessId, taskId: taskId, agentId: agentId, role: a ? a.role : '' });
      auditDecision(task.businessId, {
        action: 'Assigned task "' + task.title + '" to the ' + ((a && a.role) || 'agent') + ' agent (' + ((a && a.name) || agentId) + ')',
        reason: 'assigned from the task board',
        result: 'ok',
        detail: 'task=' + taskId + ' agent=' + agentId
      });
    } else {
      auditDecision(task.businessId, {
        action: 'Unassigned task "' + task.title + '"',
        reason: 'cleared from the task board',
        result: 'ok',
        detail: 'task=' + taskId + ' agent='
      });
    }
    return json(res, 200, { ok: true, task: r.task });
  }

  // ---- memory (§9) --------------------------------------------------------------------------------
  function handleBizMemory(req, res, match) {
    const biz = match && match[1];
    if (businessMissing(biz)) return json(res, 404, { ok: false, error: 'no such business: ' + biz });
    if (req.method === 'GET') {
      const sp = q(req);
      const scope = String(sp.get('scope') || 'business');
      const ownerId = String(sp.get('owner') || (scope === 'business' ? biz : '')).trim();
      const kind = String(sp.get('kind') || '').trim();
      const limit = Number(sp.get('limit'));
      const entries = memory.read(scope, ownerId, { kind: kind || undefined, limit: Number.isFinite(limit) ? limit : undefined });
      return json(res, 200, { entries: entries, counts: memory.kinds(scope, ownerId), scope: scope, ownerId: ownerId });
    }
    return json(res, 405, { ok: false, error: 'method not allowed' });
  }

  async function handleBizMemoryWrite(req, res, match) {
    const biz = match && match[1];
    if (businessMissing(biz)) return json(res, 404, { ok: false, error: 'no such business: ' + biz });
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });
    const body = parsed.body || {};
    const scope = String(body.scope || 'business');
    const ownerId = String(body.ownerId || (scope === 'business' ? biz : '')).trim();
    const r = memory.write(scope, ownerId, {
      kind: body.kind, text: body.text, source: body.source, businessId: biz
    });
    if (!r.ok) {
      // 422 for a P1/provenance refusal (a memory with no source), 400 for a malformed request.
      const isGuard = /needs a source/.test(r.reason || '');
      return json(res, isGuard ? 422 : 400, { ok: false, error: r.reason });
    }
    const e = r.entry;
    emitSafe('business.memory.written', { businessId: biz, id: e.id, scope: e.scope, ownerId: e.ownerId, kind: e.kind, source: e.source });
    return json(res, 201, { ok: true, entry: e });
  }

  function handleForgetMemory(req, res, match) {
    const id = match && match[1];
    const e = memory.get(id);
    if (!e) return json(res, 404, { ok: false, error: 'no such memory entry: ' + id });
    const r = memory.forget(id);
    if (!r.ok) return json(res, 500, { ok: false, error: r.reason });
    emitSafe('business.memory.forgotten', { businessId: e.businessId || '', id: id, scope: e.scope, ownerId: e.ownerId, kind: e.kind });
    return json(res, 200, { ok: true, removed: id });
  }

  // ---- communication (§7) -------------------------------------------------------------------------
  function handleBizMessages(req, res, match) {
    const biz = match && match[1];
    if (businessMissing(biz)) return json(res, 404, { ok: false, error: 'no such business: ' + biz });
    if (req.method === 'GET') {
      const sp = q(req);
      const withWho = String(sp.get('with') || '').trim();
      const kind = String(sp.get('kind') || '').trim();
      const limit = Number(sp.get('limit'));
      const list = messages.list(biz, { with: withWho || undefined, kind: kind || undefined, limit: Number.isFinite(limit) ? limit : undefined });
      return json(res, 200, { messages: list, parties: messages.parties(biz) });
    }
    return json(res, 405, { ok: false, error: 'method not allowed' });
  }

  async function handleBizMessageSend(req, res, match) {
    const biz = match && match[1];
    if (businessMissing(biz)) return json(res, 404, { ok: false, error: 'no such business: ' + biz });
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });
    const body = parsed.body || {};

    // Both ends must be the Commander or an agent of THIS business — a message addressed to a stranger is
    // refused rather than stored (the store cannot know who belongs where; this route does).
    const ids = agents.list(biz).map(a => a.id);
    const known = (who) => who === 'user' || ids.indexOf(who) >= 0;
    const from = String(body.from == null ? '' : body.from).trim();
    const to = String(body.to == null ? '' : body.to).trim();
    if (from && !known(from)) return json(res, 422, { ok: false, error: 'sender "' + from + '" is neither the user nor an agent of this business' });
    if (to && !known(to)) return json(res, 422, { ok: false, error: 'recipient "' + to + '" is neither the user nor an agent of this business' });

    const r = messages.send(biz, body);
    if (!r.ok) return json(res, 400, { ok: false, error: r.reason });
    const m = r.message;
    emitSafe('agent.message', { businessId: biz, messageId: m.id, from: m.from, to: m.to, kind: m.kind });
    return json(res, 201, { ok: true, message: m });
  }

  // ---- optional audit sink ------------------------------------------------------------------------
  // Best-effort: a missing/failing activity store must never fail the mutation that already committed. The
  // error is returned by the caller's emitSafe-style discipline; here we simply do not let it escape.
  function audit(businessId, row) {
    if (!activity) return;
    try { activity.append(businessId, row); } catch (e) { return e; }
  }

  /* THE DECISION TRACE. A REFUSED assignment must leave the same kind of durable row a successful one does,
     because the question worth answering after the fact is "why did nothing happen?" — and a 409 in a response
     body nobody kept answers it for exactly as long as the tab stays open. This is the guarantee the reference
     boss-agent called its whole point ("assigning work to an unregistered agent is refused, and the refusal
     itself is logged"), expressed in this app's own durable sink rather than a second registry.

     `result:'refused'` is a closed-vocabulary value (business-activity-store.js), deliberately NOT 'error': an
     error is something going wrong, a refusal is the system choosing not to act, and the reason is the payload.

     Best-effort like every other audit here — a log we cannot write must never change the decision it describes,
     so a failed row leaves the 409 a 409. (test/boss-decision-trace.test.js pins that.) */
  function auditDecision(businessId, decision) {
    audit(businessId, {
      actor: { kind: 'system', id: '', name: '' },
      action: decision.action,
      reason: decision.reason || '',
      result: decision.result,
      detail: decision.detail || ''
    });
  }

  // ---- dispatchers --------------------------------------------------------------------------------
  function handleAgents(req, res, match) {
    if (req.method === 'GET') return handleListAgents(req, res, match);
    if (req.method === 'POST') return handleHire(req, res, match);
    return json(res, 405, { ok: false, error: 'method not allowed' });
  }

  function handleMemory(req, res, match) {
    if (req.method === 'GET') return handleBizMemory(req, res, match);
    if (req.method === 'POST') return handleBizMemoryWrite(req, res, match);
    return json(res, 405, { ok: false, error: 'method not allowed' });
  }

  function handleMessages(req, res, match) {
    if (req.method === 'GET') return handleBizMessages(req, res, match);
    if (req.method === 'POST') return handleBizMessageSend(req, res, match);
    return json(res, 405, { ok: false, error: 'method not allowed' });
  }

  // Route rows for index.js. Every pattern is anchored, so order is not load-bearing today; the specific
  // rows are still listed before the generic :id rows so a future loosening cannot silently shadow them.
  // `rx` (NOT qrx) for the three business-scoped families. Their GETs carry ?scope/?owner/?kind/?with, and
  // index.js's matcher only fills the match array for `rx` rows — a `qrx` row reaches its handler with
  // match === null, and every handler here reads the businessId from match[1]. The regexes carry the QS tail
  // so the query is accepted; see the note above the RX_ definitions.
  const routes = [
    { m: 'GET', exact: '/api/roles', h: handleRoles },
    // ⛔ NO bare `GET /api/permissions` row here. It used to be, and it SILENTLY SHADOWED index.js's
    // handlePermissionsList: dispatchRoute is first-match-wins over ROUTES, and index.js spreads this module's
    // table ABOVE its own rows, so `exact` (which compares the raw url) matched here first. GET
    // /api/permissions therefore answered {tiers, defaultGrants} and never {grants, masterBypass} — the
    // Permissions panel lost its grant list. handlePermissions is still exported and still the catalog's
    // definition; index.js now serves those two fields ADDITIVELY from its own row. The "anchored patterns
    // mean order is not load-bearing" note above holds for rx/qrx, but NOT for two rows sharing one `exact`.
    { m: ['GET', 'POST'], rx: RX_BIZ_AGENTS, h: handleAgents },
    { m: ['GET', 'POST'], rx: RX_BIZ_MEMORY, h: handleMemory },
    { m: ['GET', 'POST'], rx: RX_BIZ_MESSAGES, h: handleMessages },
    { m: 'POST', rx: RX_AGENT_STATUS, h: handleAgentStatus },
    { m: 'POST', rx: RX_AGENT_GRANTS, h: handleAgentGrants },
    { m: 'POST', rx: RX_TASK_ASSIGN, h: handleAssign },
    { m: 'DELETE', rx: RX_MEMORY, h: handleForgetMemory },
    { m: 'GET', rx: RX_AGENT, h: handleAgentOne },
    { m: 'PATCH', rx: RX_AGENT, h: handleAgentPatch },
    { m: 'DELETE', rx: RX_AGENT, h: handleAgentOne }
  ];

  return {
    routes,
    handleRoles, handlePermissions, handleListAgents, handleHire,
    handleAgentOne, handleAgentPatch, handleAgentDelete, handleAgentStatus, handleAgentGrants,
    handleAssign, handleBizMemory, handleBizMemoryWrite, handleForgetMemory,
    handleBizMessages, handleBizMessageSend, handleAgents, handleMemory, handleMessages,
    decisionsFor
  };
}

module.exports = {
  makeAgentRoutes,
  RX_BIZ_AGENTS, RX_BIZ_MEMORY, RX_BIZ_MESSAGES, RX_AGENT, RX_AGENT_STATUS, RX_AGENT_GRANTS,
  RX_TASK_ASSIGN, RX_MEMORY, MAX_BODY
};
