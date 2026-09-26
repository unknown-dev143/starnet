'use strict';
/* autopilot-routes.test.js — the /api/autopilot surface (Business OS Phase 12).

   The two things this suite exists to catch:

     1. THE ROUTE-MATCHING TRAP, in its `exact` form. Phase 11 shipped mission routes as `exact`, and `exact`
        compares the RAW url — so `/api/mission/trail?limit=5` 404'd live. These three rows are `qsplit`
        (path-verbatim, query-tolerant) for exactly that reason, and the ASYMMETRY IS MIRRORED IN `call()`
        rather than assumed away. The regression lock below proves every ?query variant resolves.

     2. SEPARATING READ FROM WRITE. /api/autopilot/plan MUST write nothing; only /commit writes. The suite
        proves plan never reaches the task store, and that a commit relays the store's verdict.            */

const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const { makeAutopilotRoutes } = require('../sidecar/autopilot-routes.js');
const { makeBusinessAutopilot } = require('../sidecar/business-autopilot.js');
const templates = require('../sidecar/business-templates.js');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'autopilot-routes.js'), 'utf8');

function mkRes() {
  const out = { code: 0, body: null };
  return {
    out,
    writeHead(code) { out.code = code; },
    end(s) { try { out.body = JSON.parse(s); } catch (e) { out.body = s; } }
  };
}

/* mirror index.js's dispatch EXACTLY: `exact` compares the RAW url; `qsplit` compares the query-stripped
   path; `rx` fills the match array; `qrx` leaves it null. */
function find(rows, url) {
  const bare = url.split('?')[0];
  for (const r of rows) {
    if (r.exact !== undefined && url === r.exact) return r;
    if (r.qsplit !== undefined && bare === r.qsplit) return r;
    if (r.rx && r.rx.test(url)) return r;
  }
  return null;
}

async function call(rows, route, url, method, body) {
  const r = mkRes();
  const req = {
    url: url, method: method || (route && route.m) || 'GET',
    _body: body === undefined ? null : JSON.stringify(body)
  };
  const readBody = async () => (req._body == null ? '' : req._body);
  route.h(req, r, null);
  // the handlers are async; await a tick so the response settles
  await new Promise(res => setImmediate(res));
  return { code: r.out.code, json: r.out.body };
}

function mkTasks(opts) {
  opts = opts || {};
  const calls = [];
  return {
    calls: calls,
    materialise(businessId, planTasks, meta) {
      calls.push({ businessId: businessId, tasks: planTasks, meta: meta });
      if (opts.refuse) return { ok: false, reason: opts.refuse };
      return { ok: true, chained: true, tasks: planTasks.map((t, i) => ({ id: businessId + '~t' + (i + 1), title: t.title })) };
    }
  };
}
const mkBiz = (ids) => ({ get: (id) => (ids.indexOf(id) >= 0 ? { id: id } : null) });

function mkRoutes(over) {
  over = over || {};
  const tasks = over.tasks !== undefined ? over.tasks : mkTasks();
  const autopilot = makeBusinessAutopilot({
    templates: templates,
    tasks: tasks,
    businesses: over.businesses !== undefined ? over.businesses : mkBiz(['acme'])
  });
  return {
    routes: makeAutopilotRoutes({ autopilot: autopilot, readBody: (req, max) => Promise.resolve(req._body || '{}') }),
    tasks: tasks
  };
}

(async () => {

/* ---------- the rows are well-formed and namespaced ---------- */
{
  const { routes } = mkRoutes();
  A.eq(routes.rows.length, 3, 'three rows');
  for (const r of routes.rows) {
    A.ok(typeof r.h === 'function', 'every row has a handler');
    A.eq(r.qsplit !== undefined, true, 'every row is qsplit — path-verbatim, query-tolerant');
    A.eq(r.exact, undefined, 'no row uses `exact` (the query-blind trap)');
    A.ok(String(r.qsplit).indexOf('/api/autopilot') === 0, 'every row lives under /api/autopilot');
    A.eq(r.rx, undefined, 'no row uses rx — no id ever appears in an autopilot path');
  }
  const methods = routes.rows.map(r => r.m).sort().join(',');
  A.eq(methods, 'GET,POST,POST', 'one GET (catalog) and two POSTs (plan, commit)');
  for (const url of ['/api/autopilot/catalog', '/api/autopilot/plan', '/api/autopilot/commit']) {
    A.eq(routes.rows.filter(r => r.qsplit === url).length, 1, 'exactly one row claims ' + url);
    A.ok(find(routes.rows, url + '?t=1'), url + ' resolves WITH a query tail');
  }
  // a stray suffix must NOT match
  for (const url of ['/api/autopilot/catalog/x', '/api/autopilot/planz', '/api/autopilot/commit/1']) {
    A.eq(find(routes.rows, url), null, url + ' matches no row');
  }
}

/* ---------- construction guards ---------- */
{
  A.throws(() => makeAutopilotRoutes({}), 'no autopilot → refuses to construct');
  A.throws(() => makeAutopilotRoutes({ autopilot: {} }), 'no readBody → refuses to construct');
}

/* ---------- GET /api/autopilot/catalog ---------- */
{
  const { routes } = mkRoutes();
  const r = await call(routes.rows, find(routes.rows, '/api/autopilot/catalog'), '/api/autopilot/catalog');
  A.eq(r.code, 200, 'the catalogue answers 200');
  A.eq(r.json.ok, true, 'and is ok');
  A.ok(r.json.goals.length > 0, 'with the known goals');
}

/* ---------- POST /api/autopilot/plan — resolves, WRITES NOTHING ---------- */
{
  const { routes, tasks } = mkRoutes();
  const r = await call(routes.rows, find(routes.rows, '/api/autopilot/plan'), '/api/autopilot/plan', 'POST', { goal: 'launch a digital product' });
  A.eq(r.code, 200, 'a known goal resolves 200');
  A.eq(r.json.ok, true, 'ok');
  A.eq(r.json.kind, 'plan', 'it is a plan');
  A.ok(r.json.tasks.length > 0, 'with tasks');
  A.eq(tasks.calls.length, 0, 'and the task store was NEVER touched — plan is read-only');
}

/* ---------- POST /api/autopilot/plan — an unknown goal is 422 with the known set ---------- */
{
  const { routes } = mkRoutes();
  const r = await call(routes.rows, find(routes.rows, '/api/autopilot/plan'), '/api/autopilot/plan', 'POST', { goal: 'become a unicorn' });
  A.eq(r.code, 422, 'an unknown goal is a 422, not an invented plan');
  A.eq(r.json.ok, false, 'and not ok');
  A.ok(r.json.knownGoals && r.json.knownGoals.length, 'the refusal names the known goals');
}

/* ---------- POST /api/autopilot/plan — bad json / empty goal ---------- */
{
  const { routes } = mkRoutes();
  const rBad = await call(routes.rows, find(routes.rows, '/api/autopilot/plan'), '/api/autopilot/plan', 'POST', undefined);
  // undefined body → the readBody fake returns '{}' → an empty goal → 422
  A.eq(rBad.code, 422, 'a missing goal is still a 422 refusal');
}

/* ---------- POST /api/autopilot/commit — the happy path writes ---------- */
{
  const { routes, tasks } = mkRoutes();
  const r = await call(routes.rows, find(routes.rows, '/api/autopilot/commit'), '/api/autopilot/commit', 'POST', { goal: 'launch a digital product', businessId: 'acme' });
  A.eq(r.code, 201, 'a commit answers 201 (a resource was created)');
  A.eq(r.json.ok, true, 'ok');
  A.eq(tasks.calls.length, 1, 'the task store WAS called');
  A.eq(tasks.calls[0].businessId, 'acme', 'for the named business');
  A.ok(r.json.tasks[0].id.indexOf('acme~') === 0, 'and the store\'s rows come back');
}

/* ---------- POST /api/autopilot/commit — refusals map to the right status ---------- */
{
  // unknown goal → 422
  const { routes } = mkRoutes();
  const r1 = await call(routes.rows, find(routes.rows, '/api/autopilot/commit'), '/api/autopilot/commit', 'POST', { goal: 'become a unicorn', businessId: 'acme' });
  A.eq(r1.code, 422, 'an unknown goal commits as a 422');
  A.ok(r1.json.knownGoals, 'with the known goals');

  // missing / unknown business → 400
  const r2 = await call(routes.rows, find(routes.rows, '/api/autopilot/commit'), '/api/autopilot/commit', 'POST', { goal: 'launch a digital product' });
  A.eq(r2.code, 400, 'a commit with no business is a 400');
  A.eq(r2.json.ok, false, 'not ok');

  const r3 = await call(routes.rows, find(routes.rows, '/api/autopilot/commit'), '/api/autopilot/commit', 'POST', { goal: 'launch a digital product', businessId: 'ghost' });
  A.eq(r3.code, 400, 'a commit to a nonexistent business is a 400');

  // a STORE refusal (task cap) → 400, reason relayed
  const { routes: routes4 } = mkRoutes({ tasks: mkTasks({ refuse: 'this plan would exceed the 200-task cap for the business' }) });
  const r4 = await call(routes4.rows, find(routes4.rows, '/api/autopilot/commit'), '/api/autopilot/commit', 'POST', { goal: 'launch a digital product', businessId: 'acme' });
  A.eq(r4.code, 400, 'a store refusal is a 400');
  A.eq(r4.json.reason, 'this plan would exceed the 200-task cap for the business', 'and the store\'s reason is relayed verbatim');
}

/* ---------- the query-tolerant regression, end to end ---------- */
{
  const { routes } = mkRoutes();
  for (const [url, method, body] of [
    ['/api/autopilot/catalog?t=1', 'GET', undefined],
    ['/api/autopilot/plan?t=1', 'POST', { goal: 'launch a digital product' }],
    ['/api/autopilot/commit?t=1', 'POST', { goal: 'launch a digital product', businessId: 'acme' }]
  ]) {
    const r = await call(routes.rows, find(routes.rows, url), url, method, body);
    A.ok(r.code === 200 || r.code === 201, url + ' answers ' + r.code + ' (not a 404)');
  }
}

/* ---------- source-locks ---------- */
{
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  A.ok(!/exact\s*:/.test(CODE), 'the code uses qsplit, never exact');
  A.ok(!/qrx\s*:/.test(CODE), 'no qrx row');
  A.ok(!/Date\.now|Math\.random/.test(CODE), 'no clock, no rng');
  A.ok(/POST', qsplit: '\/api\/autopilot\/plan'/.test(CODE), 'plan is a POST');
  A.ok(/POST', qsplit: '\/api\/autopilot\/commit'/.test(CODE), 'commit is a POST');
}

A.report('autopilot-routes');
})();
