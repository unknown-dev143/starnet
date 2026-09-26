/* sidecar/factory-routes.js — the HTTP surface for §22's AI SOFTWARE FACTORY (Business OS Phase 12).

   TWO ROUTES, BOTH GET, NEITHER WRITES.

     GET /api/factory/stages                the eight pipeline stages and what proves each
     GET /api/factory/pipeline?business=<id>  one business's whole pipeline, stage by stage

   WHY GET AND NOT POST. The factory view OBSERVES the six stores that already hold the facts; it composes
   them. It mutates nothing — so it exposes no POST. A "factory" that could also build from a read route
   would be a second, unguarded door to every guarded mutation in the system.

   NAMESPACING. 'factory' is a fresh prefix; none of these can shadow a Phase 1-12 path.

   ROUTE MATCHING. /api/factory/stages is parameterless → **qsplit** (verbatim path, query ignored). The
   pipeline route reads its business from ??business= — the id lives in the QUERY, not the path — so it is
   **rx** with the query-tolerant tail, exactly like §13's security routes. `exact` is used by NEITHER: it
   compares the raw url and would 404 every ?query variant (the Phase 11 defect, fixed at source).

   PURE-ish: `respondJson` injected, so this is unit-testable without booting the server. */

'use strict';

const QS = '(?:\\?[^#]*)?$';
const MAX_ID = 120;

// the business id comes from ?business= — anchored to the exact route, tolerance from QS.
const RX_FACTORY_PIPELINE = new RegExp('^/api/factory/pipeline' + QS);

function defaultRespondJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function makeFactoryRoutes(deps) {
  deps = deps || {};
  const factory = deps.factory;
  const respondJson = typeof deps.respondJson === 'function' ? deps.respondJson : defaultRespondJson;

  if (!factory) throw new Error('factory-routes.js requires { factory }');

  const json = (res, code, obj) => respondJson(res, code, obj);
  const str = (v) => (v == null ? '' : String(v));

  function q(req, name) {
    try {
      const u = new URL(req.url || '/', 'http://x');
      return str(u.searchParams.get(name) || '').trim();
    } catch (e) { return ''; }
  }

  // GET /api/factory/stages — the stage vocabulary (data, so the console and the server cannot drift).
  function handleStages(req, res) {
    try {
      json(res, 200, {
        ok: true,
        stages: (factory.STAGES || []).map(s => ({ id: str(s.id), label: str(s.label), blurb: str(s.blurb) })),
        states: (factory.STATES || []).slice(),
        note: 'the eight stages the brief names, each proven by a recorded fact — never by a percentage'
      });
    } catch (e) { json(res, 500, { ok: false, reason: 'could not read the stage list: ' + str(e && e.message) }); }
  }

  // GET /api/factory/pipeline?business=<id>
  function handlePipeline(req, res) {
    const id = q(req, 'business').slice(0, MAX_ID);
    if (!id) return json(res, 400, { ok: false, reason: 'a ?business= is required (which pipeline?)' });
    try {
      const r = factory.pipeline(id);
      if (!r || r.ok !== true) return json(res, 400, r || { ok: false, reason: 'the pipeline could not be built' });
      return json(res, 200, r);
    } catch (e) {
      return json(res, 500, { ok: false, reason: 'could not build the pipeline: ' + str(e && e.message) });
    }
  }

  // qsplit = verbatim path, query ignored. rx = regex with the query-tolerant tail.
  const rows = [
    { m: 'GET', qsplit: '/api/factory/stages', h: handleStages },
    { m: 'GET', rx: RX_FACTORY_PIPELINE, h: handlePipeline }
  ];

  return { rows: rows, MAX_ID: MAX_ID };
}

module.exports = { makeFactoryRoutes, RX_FACTORY_PIPELINE, MAX_ID };
