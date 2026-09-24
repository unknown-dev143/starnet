/* sidecar/task-routes.js — the HTTP surface for the §9 TASK & PROJECT ENGINE (Business OS Phase 2).

   Tasks hang off a BUSINESS, never off the station, so every path here is either scoped by business
   (/api/businesses/:id/tasks) or names a task id that already encodes its business (`<biz>~t<n>`). That is
   not cosmetic: it means there is no route that can list or mutate "all tasks", which is what makes P6 true
   at the HTTP layer and not just in the store.

   MOUNTED AFTER business-routes.js in the ROUTES table, and that is safe rather than lucky: business-routes'
   own :id row is anchored (`/^\/api\/businesses\/([A-Za-z0-9_-]+)$/`), so `/api/businesses/acme/tasks` cannot
   match it. Stated because a future loosening of that anchor WOULD start shadowing these rows.

   AUTH: /api/* — covered by apiauth.js's per-launch token gate automatically.

   AUDIT LINE, stated explicitly because it is a judgement call: the per-business activity log (§20) records
   task CREATION and DELETION and each plan materialisation — the things that changed the shape of the work.
   It does NOT record every status flip; those ride the live bus as task.updated instead. An audit log that
   logs every keystroke is one nobody reads.

   PURE-ish: readBody/respondJson injected; emit/activity optional. */
'use strict';

const MAX_BODY = 32 * 1024;

const RX_BIZ_TASKS_PLAN = /^\/api\/businesses\/([A-Za-z0-9_-]+)\/tasks\/plan$/;
const RX_BIZ_TASKS = /^\/api\/businesses\/([A-Za-z0-9_-]+)\/tasks$/;
const RX_TASK_LOG = /^\/api\/tasks\/([A-Za-z0-9_~-]+)\/log$/;
const RX_TASK_ATTACH = /^\/api\/tasks\/([A-Za-z0-9_~-]+)\/attach$/;
const RX_TASK = /^\/api\/tasks\/([A-Za-z0-9_~-]+)$/;

function defaultRespondJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function makeTaskRoutes(deps) {
  deps = deps || {};
  const tasks = deps.tasks;
  const businesses = deps.businesses;
  const templates = deps.templates || null;      // needed only by the plan route
  const activity = deps.activity || null;
  const readBody = deps.readBody;
  const respondJson = typeof deps.respondJson === 'function' ? deps.respondJson : defaultRespondJson;
  const emit = typeof deps.emit === 'function' ? deps.emit : null;

  if (!tasks || !businesses) throw new Error('task-routes.js requires { tasks, businesses }');
  if (typeof readBody !== 'function') throw new Error('task-routes.js requires { readBody }');

  const json = (res, code, obj) => respondJson(res, code, obj);

  function emitSafe(name, payload) {
    if (!emit) return null;
    try { emit(name, payload); return null; } catch (e) { return e; }
  }

  // best-effort audit: a failed audit row must never undo a committed task (see business-routes.audit).
  function audit(businessId, event) {
    if (!activity) return null;
    try {
      const r = activity.append(businessId, event);
      return (r && r.ok) ? null : ((r && r.reason) || 'activity could not be recorded');
    } catch (e) { return String((e && e.message) || e); }
  }

  async function readJson(req) {
    let raw;
    try { raw = await readBody(req, MAX_BODY); } catch (_) { return { ok: false, code: 413, error: 'body too large' }; }
    try { return { ok: true, body: JSON.parse(raw || '{}') || {} }; }
    catch (_) { return { ok: false, code: 400, error: 'bad json' }; }
  }

  function taskPayload(t) {
    return { businessId: t.businessId, taskId: t.id, title: t.title, status: t.status, priority: t.priority, origin: t.origin };
  }

  // ---- GET /api/businesses/:id/tasks ----
  function handleList(req, res, match) {
    const bizId = match && match[1];
    if (!businesses.has(bizId)) return json(res, 404, { ok: false, error: 'no such business: ' + bizId });
    return json(res, 200, { tasks: tasks.list(bizId), summary: tasks.summary(bizId) });
  }

  // ---- POST /api/businesses/:id/tasks ----
  async function handleCreate(req, res, match) {
    const bizId = match && match[1];
    if (!businesses.has(bizId)) return json(res, 404, { ok: false, error: 'no such business: ' + bizId });
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });
    const r = tasks.create(bizId, parsed.body);
    if (!r.ok) return json(res, 400, { ok: false, error: r.reason });
    const t = r.task;
    emitSafe('task.created', taskPayload(t));
    const warn = audit(bizId, {
      action: 'Task created', reason: 'A task was added to this business',
      actor: { kind: 'user' }, result: 'ok', approval: t.approval === 'pending' ? 'pending' : 'not-required',
      detail: t.title + (t.estimated ? ' (est. ' + t.estimated.hours + 'h)' : '')
    });
    return json(res, 201, warn ? { ok: true, task: t, warning: warn } : { ok: true, task: t });
  }

  /* POST /api/businesses/:id/tasks/plan — §6's "turn the business plan into actual implementation tasks".
     Body is ONE of { template } (a §25 funnel) or { goal } (a §9 stated goal); the template route is the
     usual one. `chain: false` makes the steps independent instead of a dependency chain. */
  async function handlePlan(req, res, match) {
    const bizId = match && match[1];
    if (!businesses.has(bizId)) return json(res, 404, { ok: false, error: 'no such business: ' + bizId });
    if (!templates) return json(res, 501, { ok: false, error: 'plan generation is unavailable: no template catalogue is wired' });
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });
    const body = parsed.body;

    let plan = null;
    if (body.template != null) plan = templates.templatePlan(body.template);
    else if (body.goal != null) plan = templates.goalPlan(body.goal);
    else return json(res, 400, { ok: false, error: 'provide either { template } or { goal }' });
    // a refusal from the planner is surfaced verbatim — never a substituted default plan (P7).
    if (!plan.ok) return json(res, 422, { ok: false, error: plan.reason, knownGoals: plan.knownGoals, templates: plan.templates });

    const r = tasks.materialise(bizId, plan.tasks, { chain: body.chain !== false, projectId: body.projectId });
    if (!r.ok) return json(res, 400, { ok: false, error: r.reason });
    for (const t of r.tasks) emitSafe('task.created', taskPayload(t));
    const warn = audit(bizId, {
      action: 'Task plan generated', reason: 'A plan was materialised into tasks for this business',
      actor: { kind: 'user' }, result: 'ok', approval: 'not-required',
      detail: r.tasks.length + ' task(s) from ' + (plan.template || plan.goal || 'plan') + (r.chained ? ', chained' : ', unchained')
    });
    const out = {
      ok: true, tasks: r.tasks, chained: r.chained,
      // `source` is what the CALLER asked for (a goal beats the template it resolved to); `template` is the
      // §25 funnel the plan belongs to. Both, because a goal plan is genuinely both things at once.
      source: plan.goal || plan.template || null,
      template: plan.template || null
    };
    if (warn) out.warning = warn;
    return json(res, 201, out);
  }

  // ---- PATCH /api/tasks/:id ----
  async function handlePatch(req, res, match) {
    const id = match && match[1];
    const before = tasks.get(id);
    if (!before) return json(res, 404, { ok: false, error: 'no such task: ' + id });
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });
    const r = tasks.update(id, parsed.body);
    if (!r.ok) return json(res, 400, { ok: false, error: r.reason });
    const t = r.task;
    const changed = Object.keys(parsed.body).filter(k => JSON.stringify(before[k]) !== JSON.stringify(t[k]));
    emitSafe('task.updated', { businessId: t.businessId, taskId: t.id, status: t.status, changed: changed });
    return json(res, 200, { ok: true, task: t, blockers: tasks.blockers(t.id) });
  }

  // ---- DELETE /api/tasks/:id ----
  function handleDelete(req, res, match) {
    const id = match && match[1];
    const doomed = tasks.get(id);
    if (!doomed) return json(res, 404, { ok: false, error: 'no such task: ' + id });
    const r = tasks.remove(id);
    // the store REFUSES to orphan a dependency — surface that as a 409, not a 400: the request is
    // well-formed, the current STATE is what prevents it.
    if (!r.ok) return json(res, 409, { ok: false, error: r.reason });
    emitSafe('task.deleted', { businessId: doomed.businessId, taskId: id, title: doomed.title });
    audit(doomed.businessId, {
      action: 'Task deleted', reason: 'A task was removed from this business',
      actor: { kind: 'user' }, result: 'ok', approval: 'not-required', detail: doomed.title
    });
    return json(res, 200, { ok: true, removed: id });
  }

  // ---- POST /api/tasks/:id/log ----
  async function handleLog(req, res, match) {
    const id = match && match[1];
    if (!tasks.has(id)) return json(res, 404, { ok: false, error: 'no such task: ' + id });
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });
    const r = tasks.addLog(id, parsed.body);
    if (!r.ok) return json(res, 400, { ok: false, error: r.reason });
    return json(res, 200, { ok: true, task: r.task });
  }

  // ---- POST /api/tasks/:id/attach ----
  async function handleAttach(req, res, match) {
    const id = match && match[1];
    if (!tasks.has(id)) return json(res, 404, { ok: false, error: 'no such task: ' + id });
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });
    const r = tasks.attach(id, parsed.body.ref);
    if (!r.ok) return json(res, 400, { ok: false, error: r.reason });
    return json(res, 200, { ok: true, task: r.task });
  }

  function handleBizTasks(req, res, match) {
    if (req.method === 'GET') return handleList(req, res, match);
    if (req.method === 'POST') return handleCreate(req, res, match);
    return json(res, 405, { ok: false, error: 'method not allowed' });
  }

  function handleTaskOne(req, res, match) {
    if (req.method === 'PATCH') return handlePatch(req, res, match);
    if (req.method === 'DELETE') return handleDelete(req, res, match);
    return json(res, 405, { ok: false, error: 'method not allowed' });
  }

  // `/plan`, `/log`, `/attach` are listed before their plain :id row for the same reason as maker-routes:
  // every pattern is anchored so order is not load-bearing today, but it stays honest if one is loosened.
  const routes = [
    { m: 'POST', rx: RX_BIZ_TASKS_PLAN, h: handlePlan },
    { m: ['GET', 'POST'], rx: RX_BIZ_TASKS, h: handleBizTasks },
    { m: 'POST', rx: RX_TASK_LOG, h: handleLog },
    { m: 'POST', rx: RX_TASK_ATTACH, h: handleAttach },
    { m: ['PATCH', 'DELETE'], rx: RX_TASK, h: handleTaskOne }
  ];

  return {
    routes,
    handleList, handleCreate, handlePlan, handlePatch, handleDelete, handleLog, handleAttach,
    handleBizTasks, handleTaskOne
  };
}

module.exports = {
  makeTaskRoutes,
  RX_BIZ_TASKS, RX_BIZ_TASKS_PLAN, RX_TASK, RX_TASK_LOG, RX_TASK_ATTACH, MAX_BODY
};
