'use strict';
/* test/intelligence-routes.test.js — Phase 7 HTTP route wiring (Business OS §30).

   The critical trap in this fork: index.js's dispatcher leaves `gm = null` for a `qrx` row, so its handler
   reads `match === null` and every id lookup 404s while looking correct. These tests assert the route table
   has ZERO `qrx` rows, that the most-specific paths are registered before the shorter ones, and that the
   handlers behave: models lists the catalog, a hard requirement refuses with 422, and an unmet business 404s. */
const A = require('./_assert.js');
const E = require('../sidecar/intelligence-engine.js');
const R = require('../sidecar/model-router.js');
const O = require('../sidecar/ai-cost-optimizer.js');
const IR = require('../sidecar/intelligence-routes.js');

const T = 1_700_000_000_000;
function build() {
  const engine = E.makeIntelligenceEngine({ readings: () => [], activities: () => [], experiments: () => [], now: () => T });
  const router = R.makeModelRouter({ catalog: [
    { id: 'm1', provider: 'p', contextLength: 8000, supportsTools: true, pricing: { prompt: '0.000001', completion: '0.000001' } }
  ] });
  const optimizer = O.makeCostOptimizer({ router });
  const businesses = { get: (id) => (id === 'real' ? { id } : null) };
  const readBody = async (req) => JSON.stringify((req && req.__body) || {});
  const respondJson = (res, code, obj) => { res.__code = code; res.__body = obj; return res; };
  const emit = [];
  const routes = IR.makeIntelligenceRoutes({ engine, router, optimizer, businesses, insights: () => ({ byModel: [] }), readBody, respondJson, emit: (n, p) => emit.push([n, p]) });
  return { engine, router, optimizer, businesses, routes, emit };
}

function main() {
  const { router, routes } = build();
  const rows = routes.rows;

  // ---- the route-table trap: no qrx, correct ordering, right count ----
  A.eq(rows.length, 8, 'exactly 8 intelligence routes');
  A.ok(rows.every(r => !('qrx' in r)), 'ZERO qrx rows — every business-scoped route uses rx + QS tail');

  const explainIdx = rows.findIndex(r => r.h === routes.handlers.handleExplain);
  const intelIdx = rows.findIndex(r => r.h === routes.handlers.handleBusinessIntelligence);
  A.ok(explainIdx >= 0 && intelIdx >= 0 && explainIdx < intelIdx, 'explain is registered before the shorter /intelligence route');

  // ---- handler: models lists the catalog size ----
  const res1 = {};
  routes.handlers.handleModels({ url: '/api/intelligence/models?tools=1&prefer=cost', method: 'GET' }, res1, ['/api/intelligence/models']);
  A.eq(res1.__body.ok, true, 'models ok');
  A.eq(res1.__body.catalogSize, router.size, 'models catalogSize matches router');

  // ---- handler: hard requirement refusal => 422 ----
  (async () => {
    const res2 = {};
    const req2 = { url: '/api/intelligence/models/route', method: 'POST', __body: { needs: { vision: true }, prefer: 'cost' } };
    await routes.handlers.handleRoute(req2, res2, ['/api/intelligence/models/route']);
    A.eq(res2.__code, 422, 'route refusal is 422');
    A.eq(res2.__body.ok, false, 'route refusal is not ok');
    A.ok(res2.__body.considered > 0, 'refusal says how many were considered');

    // ---- handler: unmet business => 404 ----
    const res3 = {};
    routes.handlers.handleExplain({ url: '/api/businesses/nope/intelligence/explain?metric=revenue', method: 'GET' }, res3, ['/api/businesses/nope/intelligence/explain', 'nope']);
    A.eq(res3.__code, 404, 'unknown business 404');

    // ---- handler: explain for a real business with no data is 200 with an explanation (unknown metric 404) ----
    const res4 = {};
    routes.handlers.handleExplain({ url: '/api/businesses/real/intelligence/explain?metric=revenue', method: 'GET' }, res4, ['/api/businesses/real/intelligence/explain', 'real']);
    A.eq(res4.__code, 200, 'explain ok for real business');

    // ---- handler: explain unknown metric => 404 (closed §11 set) ----
    const res5 = {};
    routes.handlers.handleExplain({ url: '/api/businesses/real/intelligence/explain?metric=not-a-metric', method: 'GET' }, res5, ['/api/businesses/real/intelligence/explain', 'real']);
    A.eq(res5.__code, 404, 'closed metric set refuses');

    // ---- handler: costs with empty usage reports a warning, not a fabricated saving ----
    const res6 = {};
    routes.handlers.handleCosts({ url: '/api/intelligence/costs', method: 'GET' }, res6, []);
    A.eq(res6.__code, 200, 'costs ok');
    A.ok((res6.__body.costs.warnings || []).length > 0, 'costs warns when there is nothing to optimise');

    // ---- handler: price without tokens => 400 (never assumes a count) ----
    const res7 = {};
    const req7 = { url: '/api/intelligence/costs/price', method: 'POST', __body: {} };
    await routes.handlers.handlePrice(req7, res7, ['/api/intelligence/costs/price']);
    A.eq(res7.__code, 400, 'price without tokens is 400');

    A.report('intelligence-routes: table integrity + handler behaviour');
  })();
}

main();
