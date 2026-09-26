/* sidecar/autopilot-routes.js — the HTTP surface for §9's GOAL AUTOPILOT (Business OS Phase 12).

   TWO ROUTES, ONE READ AND ONE WRITE. The whole point of the "single entry" the audit asked for is that a
   user can walk up with a big objective and come out with it in the system — but "see the plan" and "write
   the plan" are different acts and must never be one button:

     GET  /api/autopilot/catalog            the goals this autopilot actually knows (a closed set)
     POST /api/autopilot/plan               resolve a goal to a full plan — READ-ONLY, writes nothing
     POST /api/autopilot/commit             resolve AND materialise the plan into a business's tasks

   WHY POST FOR A READ. /api/autopilot/plan takes a goal STRING in the body; a query string would put
   user-authored free text (spaces, punctuation, anything) into the URL, and it is a READ regardless — it
   returns a plan and writes nothing. The name says plan, not commit.

   NAMESPACING. 'autopilot' is a fresh prefix; none of these can shadow a Phase 1-11 path.

   ROUTE MATCHING. All three are parameterless (the business and goal travel in the body), so they MUST be
   `qsplit` — a verbatim path match with the query ignored. `exact` compares the RAW url and would 404 the
   moment a caller appended a cache-buster (this was a real defect found live in Phase 11's mission routes,
   not a theory). No id ever appears in an autopilot path.

   PURE-ish: `readBody` / `respondJson` injected, so this is unit-testable without booting the server. */

'use strict';

const MAX_BODY = 16 * 1024;

function defaultRespondJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function makeAutopilotRoutes(deps) {
  deps = deps || {};
  const autopilot = deps.autopilot;
  const respondJson = typeof deps.respondJson === 'function' ? deps.respondJson : defaultRespondJson;
  const readBody = deps.readBody;

  if (!autopilot) throw new Error('autopilot-routes.js requires { autopilot }');
  if (typeof readBody !== 'function') throw new Error('autopilot-routes.js requires { readBody }');

  const json = (res, code, obj) => respondJson(res, code, obj);
  const str = (v) => (v == null ? '' : String(v));

  async function readJson(req) {
    let body;
    try { body = JSON.parse(await readBody(req, MAX_BODY, null)) || {}; }
    catch (e) { return { ok: false, code: 400, error: 'bad json' }; }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, code: 400, error: 'body must be an object' };
    return { ok: true, body: body };
  }

  // GET /api/autopilot/catalog — the CLOSED goal set.
  function handleCatalog(req, res) {
    try { json(res, 200, autopilot.catalog()); }
    catch (e) { json(res, 500, { ok: false, reason: 'could not read the goal catalogue: ' + str(e && e.message) }); }
  }

  // POST /api/autopilot/plan — resolve to a plan. WRITES NOTHING.
  async function handlePlan(req, res) {
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });
    const r = autopilot.resolve({ goal: parsed.body.goal });
    // an unknown goal is a 422 with the known set — an actionable refusal, never an invented plan (P7)
    if (!r.ok) return json(res, 422, r);
    return json(res, 200, r);
  }

  // POST /api/autopilot/commit — resolve AND write the tasks.
  async function handleCommit(req, res) {
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });
    const r = autopilot.commit({ goal: parsed.body.goal, businessId: parsed.body.businessId, projectId: parsed.body.projectId });
    if (!r.ok) {
      // an unknown goal is a 422 (actionable); a missing business is a 400 (the caller forgot something)
      const code = (r.knownGoals && r.knownGoals.length) ? 422 : 400;
      return json(res, code, r);
    }
    return json(res, 201, r);
  }

  // `qsplit` = verbatim path match, query ignored. `exact` would reject every ?query variant.
  const rows = [
    { m: 'GET', qsplit: '/api/autopilot/catalog', h: handleCatalog },
    { m: 'POST', qsplit: '/api/autopilot/plan', h: handlePlan },
    { m: 'POST', qsplit: '/api/autopilot/commit', h: handleCommit }
  ];

  return { rows: rows };
}

module.exports = { makeAutopilotRoutes, MAX_BODY };
