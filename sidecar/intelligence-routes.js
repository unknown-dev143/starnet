/* sidecar/intelligence-routes.js — the HTTP surface for §30's INTELLIGENCE phase (Business OS Phase 7).

   Five capabilities, one module: business intelligence (§11's "explain changes"), cross-business portfolio
   analytics, opportunity monitoring, the model router, and AI cost optimization.

   WHY A SEPARATE MODULE. Same reason as manager-routes.js and worker-routes.js: sidecar/index.js is the
   merge-conflict hotfile, so handlers live here and index.js adds a require plus ROWS to the route table.

   AUTH: these are /api/* routes, so apiauth.js's per-launch token gate covers them automatically.

   EVERYTHING HERE IS A READ. Phase 7 is the layer that SAYS something about the business; it does not change
   the business. There is no POST that mutates a metric, a model choice, or an agent's configuration —
   the two POSTs below are both QUESTIONS (route this task / price this run) that return an answer and store
   nothing. That is deliberate: a system that could silently re-point a production model at a cheaper one in
   the name of optimisation would be optimising a number it cannot see the cost of. P5 keeps that decision
   with the owner, and the optimizer's own output says so.

   ROUTE MATCHING — the trap that silently 404s every business-scoped route:
     index.js's dispatch populates the match array ONLY for `rx` rows; a `qrx` row leaves gm = null, so a
     handler reading match[1] gets undefined and every id lookup 404s while the route looks correct.
     Every business-scoped route here therefore uses **rx** with a query-tolerant tail (QS), never qrx.
     Ids contain '~' (never '#', which the browser strips as a fragment delimiter before the request is sent).

   PURE-ish: `readBody` / `respondJson` injected, so this is unit-testable without booting the server. */

'use strict';

const MAX_BODY = 64 * 1024;

const ID = '([A-Za-z0-9_~-]+)';
const BIZ = '([A-Za-z0-9_-]+)';
const QS = '(?:\\?[^#]*)?$';

const RX_BIZ_INTELLIGENCE = new RegExp('^/api/businesses/' + BIZ + '/intelligence' + QS);
const RX_BIZ_EXPLAIN = new RegExp('^/api/businesses/' + BIZ + '/intelligence/explain' + QS);
const RX_BIZ_SIGNALS = new RegExp('^/api/businesses/' + BIZ + '/signals' + QS);
// Optional-query tail (QS) rather than two rows: `exact` in index.js compares the FULL url, so
// `/api/intelligence/models?tools=1` would never match `exact: '/api/intelligence/models'`. One rx covers
// both the bare path and every query form, and it captures groups like the other rx rows here.
const RX_MODELS = new RegExp('^/api/intelligence/models' + QS);

function defaultRespondJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function makeIntelligenceRoutes(deps) {
  deps = deps || {};
  const engine = deps.engine;                    // makeIntelligenceEngine(...) — the analytic layer
  const router = deps.router || null;            // makeModelRouter(...)
  const optimizer = deps.optimizer || null;      // makeCostOptimizer(...)
  const businesses = deps.businesses || null;    // businesses store (for the exists check + portfolio ids)
  const insights = typeof deps.insights === 'function' ? deps.insights : null; // () -> foldInsights shape
  const readBody = deps.readBody;
  const respondJson = typeof deps.respondJson === 'function' ? deps.respondJson : defaultRespondJson;
  const emit = typeof deps.emit === 'function' ? deps.emit : null;

  if (!engine) throw new Error('intelligence-routes.js requires { engine }');
  if (typeof readBody !== 'function') throw new Error('intelligence-routes.js requires { readBody }');

  const json = (res, code, obj) => respondJson(res, code, obj);
  const qs = (req) => { try { return new URL(String(req.url), 'http://x').searchParams; } catch (_) { return new URLSearchParams(); } };
  const str = (v) => (v == null ? '' : String(v));
  const num = (v) => { const n = Number(v); return isFinite(n) ? n : null; };

  function emitSafe(name, payload) {
    if (!emit) return null;
    try { emit(name, payload); return null; } catch (e) { return e; }
  }

  /* readBody returns a RAW UTF-8 STRING and THROWS on oversize — it is not a { ok, body } envelope. Every
     handler below goes through this wrapper, which builds the envelope and turns both failure modes into a
     proper HTTP code. (A truthy string has no `.ok`, so `if (!parsed.ok)` on the raw value is always false
     and the handler would fall through to `parsed.body` — i.e. the string itself.) */
  async function readJson(req) {
    let raw;
    try { raw = await readBody(req, MAX_BODY); }
    catch (e) { return { ok: false, code: 413, reason: 'request body too large' }; }
    try { return { ok: true, body: JSON.parse(raw || '{}') || {} }; }
    catch (e) { return { ok: false, code: 400, reason: 'body must be JSON' }; }
  }

  // A business that does not exist is a 404 on every business-scoped route (P6: never answer for a business
  // that is not there, which would be indistinguishable from "it exists and reported nothing").
  function bizExists(id) {
    if (!businesses || typeof businesses.get !== 'function') return true;   // no store to ask = do not block
    try { return !!businesses.get(id); } catch (_) { return true; }
  }
  function wantBiz(res, id) {
    if (!id) { json(res, 400, { ok: false, reason: 'a businessId is required (isolation is by key — never implied)' }); return null; }
    if (!bizExists(id)) { json(res, 404, { ok: false, reason: 'unknown business: ' + id }); return null; }
    return id;
  }

  /* ---- BUSINESS INTELLIGENCE (§11) ------------------------------------------------------------------*/

  // GET /api/businesses/:biz/intelligence — what moved, what is odd, what to look at.
  function handleBusinessIntelligence(req, res, match) {
    const b = wantBiz(res, match && match[1]);
    if (!b) return;
    const q2 = qs(req);
    const periodMs = num(q2.get('periodMs'));
    const o = periodMs && periodMs > 0 ? { periodMs: periodMs } : {};
    let digest;
    try { digest = engine.digest(b, o); }
    catch (e) { return json(res, 500, { ok: false, reason: 'could not build the digest: ' + str(e && e.message) }); }
    json(res, 200, { ok: true, digest: digest });
  }

  // GET /api/businesses/:biz/intelligence/explain?metric=revenue — the P1 explanation for one metric.
  function handleExplain(req, res, match) {
    const b = wantBiz(res, match && match[1]);
    if (!b) return;
    const q2 = qs(req);
    const metric = str(q2.get('metric')).trim();
    if (!metric) return json(res, 400, { ok: false, reason: 'a ?metric= is required' });
    const periodMs = num(q2.get('periodMs'));
    const o = periodMs && periodMs > 0 ? { periodMs: periodMs } : {};
    let out;
    try { out = engine.explain(b, metric, o); }
    catch (e) { return json(res, 500, { ok: false, reason: 'could not explain: ' + str(e && e.message) }); }
    if (!out) return json(res, 404, { ok: false, reason: 'unknown metric: ' + metric + ' — §11\'s set is closed' });
    json(res, 200, { ok: true, explanation: out });
  }

  // GET /api/businesses/:biz/signals — opportunity monitoring: conditions on recorded data.
  function handleSignals(req, res, match) {
    const b = wantBiz(res, match && match[1]);
    if (!b) return;
    let out;
    try { out = engine.signals(b); }
    catch (e) { return json(res, 500, { ok: false, reason: 'could not scan for signals: ' + str(e && e.message) }); }
    json(res, 200, { ok: true, businessId: b, signals: out, count: out.length });
  }

  /* ---- PORTFOLIO (cross-business) -------------------------------------------------------------------*/

  // GET /api/intelligence/portfolio — one row per §11 metric across every business.
  function handlePortfolio(req, res) {
    let out;
    try { out = engine.portfolio({}); }
    catch (e) { return json(res, 500, { ok: false, reason: 'could not build the portfolio: ' + str(e && e.message) }); }
    json(res, 200, { ok: true, portfolio: out });
  }

  /* ---- MODEL ROUTER ---------------------------------------------------------------------------------*/

  // GET /api/intelligence/models?needs.tools=1&prefer=cost — the catalog, filtered and ranked.
  function handleModels(req, res) {
    if (!router) return json(res, 501, { ok: false, reason: 'no model catalog is wired — the router cannot answer' });
    const q2 = qs(req);
    const task = {
      needs: {
        tools: q2.get('tools') === '1' || q2.get('tools') === 'true',
        reasoning: q2.get('reasoning') === '1' || q2.get('reasoning') === 'true',
        vision: q2.get('vision') === '1' || q2.get('vision') === 'true',
        minContext: num(q2.get('minContext')) || 0,
        provider: str(q2.get('provider')) || null
      },
      prefer: str(q2.get('prefer')) || 'balanced'
    };
    let ranked;
    try { ranked = router.rank(task); }
    catch (e) { return json(res, 500, { ok: false, reason: 'could not rank models: ' + str(e && e.message) }); }
    json(res, 200, {
      ok: true, catalogSize: router.size, task: task,
      models: ranked, count: ranked.length,
      qualitySignal: 'price-as-quality-proxy'
    });
  }

  // POST /api/intelligence/models/route — "which model should run this?" Reads, stores nothing.
  async function handleRoute(req, res) {
    if (!router) return json(res, 501, { ok: false, reason: 'no model catalog is wired — the router cannot answer' });
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, reason: parsed.reason });
    let decision;
    try { decision = router.route(parsed.body || {}); }
    catch (e) { return json(res, 500, { ok: false, reason: 'could not route: ' + str(e && e.message) }); }
    emitSafe('intelligence.model.routed', {
      ok: !!decision.ok,
      model: decision.ok && decision.model ? decision.model.id : '',
      prefer: decision.prefer || '',
      eligible: decision.eligible != null ? decision.eligible : 0
    });
    json(res, decision.ok ? 200 : 422, decision);
  }

  /* ---- AI COST OPTIMIZATION ------------------------------------------------------------------------*/

  // GET /api/intelligence/costs — what was spent, and where a cheaper equivalent model existed.
  function handleCosts(req, res) {
    if (!optimizer) return json(res, 501, { ok: false, reason: 'no cost optimizer is wired' });
    if (!insights) return json(res, 501, { ok: false, reason: 'no usage source is wired — spend cannot be read' });
    let usage;
    try { usage = insights(); }
    catch (e) { return json(res, 500, { ok: false, reason: 'could not read usage: ' + str(e && e.message) }); }
    let out;
    try { out = optimizer.analyze(usage, { periodLabel: 'recent runs' }); }
    catch (e) { return json(res, 500, { ok: false, reason: 'could not analyze spend: ' + str(e && e.message) }); }
    json(res, 200, { ok: true, costs: out });
  }

  // POST /api/intelligence/costs/price — "what would this run cost on each model?"
  async function handlePrice(req, res) {
    if (!optimizer) return json(res, 501, { ok: false, reason: 'no cost optimizer is wired' });
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, reason: parsed.reason });
    const body = parsed.body || {};
    const tin = num(body.tokensIn), tout = num(body.tokensOut);
    /* A PRICE NEEDS A TOKEN COUNT. Without one there is no honest dollar figure, and inventing a token count
       to produce one is exactly what P2 forbids — so this is a 400 that says which number is missing rather
       than a table of zeroes. */
    if (tin == null && tout == null) {
      return json(res, 400, { ok: false, reason: 'tokensIn and/or tokensOut is required — a price needs a token count, and none will be assumed' });
    }
    let out;
    try { out = optimizer.priceRun({ tokensIn: tin || 0, tokensOut: tout || 0 }); }
    catch (e) { return json(res, 500, { ok: false, reason: 'could not price: ' + str(e && e.message) }); }
    json(res, 200, { ok: true, pricing: out });
  }

  return {
    MAX_BODY: MAX_BODY,
    RX_BIZ_INTELLIGENCE: RX_BIZ_INTELLIGENCE,
    RX_BIZ_EXPLAIN: RX_BIZ_EXPLAIN,
    RX_BIZ_SIGNALS: RX_BIZ_SIGNALS,
    RX_MODELS: RX_MODELS,
    rows: [
      // Most specific first: /intelligence/explain must be tested BEFORE /intelligence, or the shorter
      // regex (which accepts the query tail) would swallow it.
      { m: 'GET', rx: RX_BIZ_EXPLAIN, h: handleExplain },
      { m: 'GET', rx: RX_BIZ_INTELLIGENCE, h: handleBusinessIntelligence },
      { m: 'GET', rx: RX_BIZ_SIGNALS, h: handleSignals },
      { m: 'GET', exact: '/api/intelligence/portfolio', h: handlePortfolio },
      { m: 'GET', rx: RX_MODELS, h: handleModels },
      { m: 'POST', exact: '/api/intelligence/models/route', h: handleRoute },
      { m: 'GET', exact: '/api/intelligence/costs', h: handleCosts },
      { m: 'POST', exact: '/api/intelligence/costs/price', h: handlePrice }
    ],
    handlers: {
      handleBusinessIntelligence, handleExplain, handleSignals,
      handlePortfolio, handleModels, handleRoute, handleCosts, handlePrice
    }
  };
}

module.exports = { makeIntelligenceRoutes, MAX_BODY: MAX_BODY };
