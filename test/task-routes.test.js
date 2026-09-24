'use strict';
/* test/task-routes.test.js — the §9 task HTTP surface (Phase 2).

   The load-bearing behaviours:
     · every path is BUSINESS-SCOPED — there is no route that can list or mutate "all tasks" (P6 at the HTTP
       layer, not just in the store);
     · the plan route turns §25/§9 into real tasks and REFUSES an unknown template/goal with a 422;
     · deleting a task other tasks depend on is a 409 (well-formed request, blocked by current STATE);
     · every mutation emits a schema-VALID task.* payload. */
const A = require('./_assert.js');
const { makeTaskRoutes, RX_BIZ_TASKS, RX_BIZ_TASKS_PLAN, RX_TASK, RX_TASK_LOG, RX_TASK_ATTACH } = require('../sidecar/task-routes.js');
const { makeBusinessTasksStore } = require('../sidecar/business-tasks-store.js');
const { makeBusinessesStore } = require('../sidecar/businesses-store.js');
const { makeBusinessActivityStore } = require('../sidecar/business-activity-store.js');
const TEMPLATES = require('../sidecar/business-templates.js');
const EVENTS = require('../shared/events.js');

function fakeRes() {
  return {
    code: null, body: null,
    writeHead(c) { this.code = c; return this; },
    end(s) { this.body = s; }
  };
}
function fakeReq(method, url, body) {
  return { method, url, _body: body === undefined ? '' : (typeof body === 'string' ? body : JSON.stringify(body)) };
}
async function readBody(req) { return req._body || ''; }

function harness(extra) {
  const tasks = makeBusinessTasksStore({ records: [], persist: () => {}, now: () => 1000 });
  const businesses = makeBusinessesStore({ records: [], persist: () => {}, now: () => 1000 });
  const activity = makeBusinessActivityStore({ records: [], persist: () => {}, now: () => 1000 });
  const seen = [];
  const R = makeTaskRoutes(Object.assign({
    tasks, businesses, templates: TEMPLATES, activity, readBody,
    emit: (name, payload) => seen.push({ name, payload })
  }, extra || {}));
  businesses.create({ name: 'Acme', template: 'saas' });
  businesses.create({ name: 'Beta', template: 'content' });
  return { tasks, businesses, activity, R, seen };
}
const names = (seen) => seen.map(e => e.name);
function last(seen, name) { for (let i = seen.length - 1; i >= 0; i--) if (seen[i].name === name) return seen[i].payload; return null; }

async function call(R, method, url, body) {
  const res = fakeRes();
  const hit = R.routes.filter(r => (Array.isArray(r.m) ? r.m.indexOf(method) >= 0 : r.m === method))
    .filter(r => (r.exact !== undefined ? url === r.exact : (r.rx ? !!url.match(r.rx) : false)))[0];
  if (!hit) throw new Error('no route for ' + method + ' ' + url);
  await hit.h(fakeReq(method, url, body), res, hit.rx ? url.match(hit.rx) : null);
  return { code: res.code, json: res.body ? JSON.parse(res.body) : null };
}

(async () => {
  /* ---------- route rows are well-formed ---------- */
  {
    const { R } = harness();
    A.eq(R.routes.length, 5, 'the module exposes 5 route rows');
    for (const row of R.routes) {
      A.ok(!!row.m && typeof row.h === 'function', 'each row has a method and a handler');
      const matchers = ['exact', 'qsplit', 'prefix', 'qprefix', 'rx', 'qrx'].filter(k => row[k] !== undefined);
      A.eq(matchers.length, 1, 'each row carries exactly ONE match key (' + matchers.join('/') + ')');
    }
    A.ok(RX_BIZ_TASKS.test('/api/businesses/acme/tasks'), 'RX_BIZ_TASKS matches');
    A.ok(RX_BIZ_TASKS_PLAN.test('/api/businesses/acme/tasks/plan'), 'RX_BIZ_TASKS_PLAN matches');
    A.ok(!RX_BIZ_TASKS.test('/api/businesses/acme/tasks/plan'), 'RX_BIZ_TASKS does NOT swallow the plan route');
    A.ok(RX_TASK.test('/api/tasks/acme~t1'), 'RX_TASK matches a "~" task id');
    A.ok(RX_TASK_LOG.test('/api/tasks/acme~t1/log'), 'RX_TASK_LOG matches');
    A.ok(RX_TASK_ATTACH.test('/api/tasks/acme~t1/attach'), 'RX_TASK_ATTACH matches');
    A.ok(!RX_TASK.test('/api/tasks/acme~t1/log'), 'RX_TASK does NOT swallow the log route');
  }

  /* ---------- create + list, scoped to the business ---------- */
  {
    const { R, seen, activity } = harness();
    const c = await call(R, 'POST', '/api/businesses/acme/tasks', { title: 'Research market', priority: 'high', estimated: { hours: 6 } });
    A.eq(c.code, 201, 'creating a task is 201');
    A.eq(c.json.task.businessId, 'acme', 'the task belongs to the business in the path');
    A.eq(last(seen, 'task.created').origin, 'user', 'a hand-made task emits origin "user"');
    A.eq(last(seen, 'task.created').priority, 'high', 'the event carries the priority');
    A.ok(activity.count('acme') >= 1, 'creating a task writes a per-business audit row');

    await call(R, 'POST', '/api/businesses/beta/tasks', { title: 'Write post' });
    const la = await call(R, 'GET', '/api/businesses/acme/tasks');
    A.eq(la.json.tasks.length, 1, 'acme lists only acme\'s tasks (P6)');
    A.eq(la.json.tasks[0].title, 'Research market', 'the right task came back');
    A.eq(la.json.summary.total, 1, 'the summary is scoped to the business');
    const lb = await call(R, 'GET', '/api/businesses/beta/tasks');
    A.eq(lb.json.tasks.length, 1, 'beta lists only beta\'s tasks');

    A.eq((await call(R, 'POST', '/api/businesses/ghost/tasks', { title: 'x' })).code, 404, 'creating under an unknown business is 404');
    A.eq((await call(R, 'GET', '/api/businesses/ghost/tasks')).code, 404, 'listing an unknown business is 404');
    A.eq((await call(R, 'POST', '/api/businesses/acme/tasks', {})).code, 400, 'a task with no title is 400');
  }

  /* ---------- the plan route: §25/§9 -> real tasks ---------- */
  {
    const { R, tasks, seen } = harness();
    const p = await call(R, 'POST', '/api/businesses/acme/tasks/plan', { template: 'saas' });
    A.eq(p.code, 201, 'planning from a template is 201');
    A.eq(p.json.tasks.length, TEMPLATES.templatePlan('saas').tasks.length, 'every plan task was created');
    A.eq(p.json.chained, true, 'the plan is chained by default');
    A.eq(p.json.source, 'saas', 'the response names the plan source');
    A.eq(tasks.count('acme'), p.json.tasks.length, 'the store agrees with the response');
    A.ok(tasks.list('acme').every(t => t.origin === 'plan'), 'every generated task is marked origin "plan"');
    A.eq(names(seen).filter(n => n === 'task.created').length, p.json.tasks.length, 'one task.created per generated task');

    // goal form
    const g = await call(R, 'POST', '/api/businesses/acme/tasks/plan', { goal: 'Launch a digital product' });
    A.eq(g.code, 201, 'planning from a goal is 201');
    A.eq(g.json.tasks.length, 10, '§9\'s goal yields its 10 tasks');
    A.eq(g.json.source, 'Launch a digital product', 'the response names the goal');

    // unchained
    const u = await call(R, 'POST', '/api/businesses/beta/tasks/plan', { template: 'custom', chain: false });
    A.eq(u.json.chained, false, 'chain:false is honoured');
    A.ok(u.json.tasks.every(t => t.dependsOn.length === 0), 'an unchained plan is independent');

    // refusals
    A.eq((await call(R, 'POST', '/api/businesses/acme/tasks/plan', { template: 'nope' })).code, 422, 'an unknown template is 422');
    const badGoal = await call(R, 'POST', '/api/businesses/acme/tasks/plan', { goal: 'moon base' });
    A.eq(badGoal.code, 422, 'an unknown goal is 422, never an invented plan');
    A.eq(badGoal.json.knownGoals, ['Launch a digital product'], 'the refusal lists the known goals');
    A.eq((await call(R, 'POST', '/api/businesses/acme/tasks/plan', {})).code, 400, 'neither template nor goal is 400');
    A.eq((await call(R, 'POST', '/api/businesses/ghost/tasks/plan', { template: 'saas' })).code, 404, 'planning into an unknown business is 404');

    // a route with no template catalogue degrades honestly rather than inventing a plan
    const noCat = makeTaskRoutes({ tasks, businesses: harness().businesses, readBody, emit: () => {} });
    const r = await call(noCat, 'POST', '/api/businesses/acme/tasks/plan', { template: 'saas' });
    A.eq(r.code, 501, 'with no catalogue wired the plan route is 501, not a fabricated plan');
  }

  /* ---------- patch + blockers ---------- */
  {
    const { R, tasks, seen } = harness();
    const a = (await call(R, 'POST', '/api/businesses/acme/tasks', { title: 'a' })).json.task;
    const b = (await call(R, 'POST', '/api/businesses/acme/tasks', { title: 'b', dependsOn: [a.id] })).json.task;

    const p = await call(R, 'PATCH', '/api/tasks/' + b.id, { status: 'doing' });
    A.eq(p.code, 200, 'patching a task is 200');
    A.eq(p.json.task.status, 'doing', 'the status changed');
    A.eq(last(seen, 'task.updated').status, 'doing', 'the event carries the new status');
    A.eq(last(seen, 'task.updated').changed, ['status'], 'the event names what changed');
    A.eq(p.json.blockers.length, 1, 'the response reports the unmet dependency');
    A.eq(p.json.blockers[0].id, a.id, 'the blocker names the dependency');

    A.eq((await call(R, 'PATCH', '/api/tasks/' + b.id, { status: 'nope' })).code, 400, 'an unknown status is 400');
    A.eq((await call(R, 'PATCH', '/api/tasks/ghost~t1', { status: 'done' })).code, 404, 'patching an unknown task is 404');

    // a dependency in another business is refused (P6)
    const other = (await call(R, 'POST', '/api/businesses/beta/tasks', { title: 'x' })).json.task;
    A.eq((await call(R, 'PATCH', '/api/tasks/' + other.id, { dependsOn: [a.id] })).code, 400,
      'a cross-business dependency is refused');
  }

  /* ---------- delete: 409 when something depends on the task ---------- */
  {
    const { R, seen, activity } = harness();
    const a = (await call(R, 'POST', '/api/businesses/acme/tasks', { title: 'a' })).json.task;
    const b = (await call(R, 'POST', '/api/businesses/acme/tasks', { title: 'b', dependsOn: [a.id] })).json.task;
    const blocked = await call(R, 'DELETE', '/api/tasks/' + a.id);
    A.eq(blocked.code, 409, 'deleting a depended-on task is 409 — the request is fine, the STATE is not');
    A.ok(/depend on/.test(blocked.json.error), 'the refusal explains the dependency');
    const d = await call(R, 'DELETE', '/api/tasks/' + b.id);
    A.eq(d.code, 200, 'a leaf task deletes');
    A.eq(last(seen, 'task.deleted').title, 'b', 'the event names the deleted task');
    A.ok(activity.count('acme') >= 3, 'the delete wrote an audit row');
    A.eq((await call(R, 'DELETE', '/api/tasks/ghost~t1')).code, 404, 'deleting an unknown task is 404');
  }

  /* ---------- log + attach ---------- */
  {
    const { R } = harness();
    const t = (await call(R, 'POST', '/api/businesses/acme/tasks', { title: 'a' })).json.task;
    const l = await call(R, 'POST', '/api/tasks/' + t.id + '/log', { text: 'started', kind: 'progress' });
    A.eq(l.code, 200, 'logging is 200');
    A.eq(l.json.task.logs.length, 1, 'the log entry landed');
    A.eq((await call(R, 'POST', '/api/tasks/' + t.id + '/log', {})).code, 400, 'an empty log entry is 400');
    A.eq((await call(R, 'POST', '/api/tasks/ghost~t1/log', { text: 'x' })).code, 404, 'logging an unknown task is 404');

    const at = await call(R, 'POST', '/api/tasks/' + t.id + '/attach', { ref: 'https://example.test/a.pdf' });
    A.eq(at.code, 200, 'attaching is 200');
    A.eq(at.json.task.attachments.length, 1, 'the attachment landed');
    A.eq((await call(R, 'POST', '/api/tasks/' + t.id + '/attach', {})).code, 400, 'an empty attachment ref is 400');
  }

  /* ---------- every emitted payload is schema-valid ---------- */
  {
    const { R, seen } = harness();
    await call(R, 'POST', '/api/businesses/acme/tasks', { title: 'a' });
    await call(R, 'POST', '/api/businesses/acme/tasks/plan', { template: 'custom' });
    const t = (await call(R, 'GET', '/api/businesses/acme/tasks')).json.tasks[0];
    await call(R, 'PATCH', '/api/tasks/' + t.id, { status: 'done' });
    await call(R, 'DELETE', '/api/tasks/' + t.id);
    A.ok(seen.length >= 4, 'the flow emitted several events');
    for (const e of seen) {
      const v = EVENTS.validate(e.name, e.payload);
      A.ok(v.ok, 'emitted ' + e.name + ' is schema-valid (' + (v.errors || []).join('; ') + ')');
    }
  }

  A.report('task-routes.test');
})();
