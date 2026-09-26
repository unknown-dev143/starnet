/* sidecar/twin-routes.js — the HTTP surface for §18's BUSINESS DIGITAL TWIN (Business OS Phase 9).

   THREE ROUTES, AND ONLY ONE OF THEM IS A POST — AND THAT POST STORES NOTHING.

     GET  /api/businesses/:biz/twin                       the catalog: what can be simulated over
     POST /api/businesses/:biz/twin/simulate              run one scenario, return its arithmetic
     POST /api/businesses/:biz/twin/compare               run N against the same baseline, side by side

   The two POSTs take a scenario in a request BODY rather than in a URL, because a scenario is a structured
   list of assumptions and a query string would either truncate it or encode a JSON blob inside a URL — both
   of which make the assumption unreadable in a log. Neither POST writes to any store: the twin computes and
   returns. That is deliberate and it is the same rule intelligence-routes.js follows. A "digital twin" that
   PERSISTED its projections would be creating facts out of assumptions, which is the exact failure P7 names.

   THE ONE EVENT. `business.twin.simulated` fires on a successful simulate/compare. It is emitted because a
   simulation that ran is a real thing that happened and the owner may want to see it in the activity trail —
   but the payload carries the COUNT and the scenario NAME, never the numbers, so the audit trail cannot
   become a second, stale copy of a computation (P4: one source of truth).

   ROUTE MATCHING — the trap, restated because it cost a whole phase: index.js's dispatch populates the match
   array ONLY for `rx` rows; a `qrx` row leaves gm = null and a handler reading match[1] gets undefined, so
   every business-scoped route 404s while looking correct. Every family here is **rx** with a query-tolerant
   tail (QS). Ids contain '~' (never '#', which the browser strips as a fragment delimiter before sending).

   PURE-ish: `readBody` / `respondJson` injected, so this is unit-testable without booting the server. */

'use strict';

const MAX_BODY = 64 * 1024;

const BIZ = '([A-Za-z0-9_-]+)';
const QS = '(?:\\?[^#]*)?$';

// Most specific FIRST in the rows array: /twin/simulate and /twin/compare must be tested before bare /twin,
// or the shorter regex (which accepts any query tail) would swallow them.
const RX_BIZ_TWIN_SIMULATE = new RegExp('^/api/businesses/' + BIZ + '/twin/simulate' + QS);
const RX_BIZ_TWIN_COMPARE = new RegExp('^/api/businesses/' + BIZ + '/twin/compare' + QS);
const RX_BIZ_TWIN = new RegExp('^/api/businesses/' + BIZ + '/twin' + QS);

function defaultRespondJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function makeTwinRoutes(deps) {
  deps = deps || {};
  const twin = deps.twin;                        // makeBusinessTwin(...) — the scenario engine
  const businesses = deps.businesses || null;    // businesses store, for the exists check
  const activity = deps.activity || null;        // business-activity-store — the durable audit trail
  const readBody = deps.readBody;
  const respondJson = typeof deps.respondJson === 'function' ? deps.respondJson : defaultRespondJson;
  const emit = typeof deps.emit === 'function' ? deps.emit : null;

  if (!twin) throw new Error('twin-routes.js requires { twin }');
  if (typeof readBody !== 'function') throw new Error('twin-routes.js requires { readBody }');

  const json = (res, code, obj) => respondJson(res, code, obj);
  const str = (v) => (v == null ? '' : String(v));

  function emitSafe(name, payload) {
    if (!emit) return null;
    try { emit(name, payload); return null; } catch (e) { return e; }
  }

  /* RECORD the simulation in the durable activity trail and on the bus. A simulation that ran IS a real
     thing the owner did, so it belongs in the log next to every other action — but the log entry carries
     the scenario name and the COUNTS only, never a simulated number, so the trail cannot become a stale
     second copy of a computation (P4: one source of truth; the recorded readings stay the only numbers that
     mean anything).

     BEST-EFFORT, DELIBERATELY: the analysis is the deliverable and the log is a record OF it, so neither a
     thrown `append` nor a thrown `emit` may veto an answer that is already correct. That is the same rule
     every store in this codebase follows for telemetry. A catch here RETURNS the error rather than
     swallowing it into an empty block — failopen-ratchet bans the empty shape, and the returned error is
     what keeps the failure visible. */
  function recordSafe(businessId, payload) {
    let failure = null;
    if (activity && typeof activity.append === 'function') {
      try {
        activity.append(businessId, {
          actor: { kind: 'user' },
          action: payload.mode === 'compare' ? 'twin.compare' : 'twin.simulate',
          reason: 'a what-if over recorded readings (a simulation, not a forecast)',
          result: 'ok',
          detail: payload.scenario + ' — ' + payload.steps + ' step(s) simulated'
        });
      } catch (e) { failure = e; }
    }
    const emitErr = emitSafe('business.twin.simulated', payload);
    return failure || emitErr;
  }

  /* readBody returns a RAW UTF-8 STRING and THROWS on oversize — it is NOT a { ok, body } envelope. This
     wrapper builds the envelope and turns both failure modes into a proper HTTP code. */
  async function readJson(req) {
    let raw;
    try { raw = await readBody(req, MAX_BODY); }
    catch (e) { return { ok: false, code: 413, reason: 'request body too large' }; }
    try { return { ok: true, body: JSON.parse(raw || '{}') || {} }; }
    catch (e) { return { ok: false, code: 400, reason: 'body must be JSON' }; }
  }

  // A business that does not exist is a 404 on every business-scoped route (P6: never answer for a business
  // that is not there — indistinguishable otherwise from "it exists and recorded nothing").
  function bizExists(id) {
    if (!businesses || typeof businesses.get !== 'function') return true;   // no store to ask = do not block
    try { return !!businesses.get(id); } catch (_) { return true; }
  }
  function wantBiz(res, id) {
    if (!id) { json(res, 400, { ok: false, reason: 'a businessId is required (isolation is by key — never implied)' }); return null; }
    if (!bizExists(id)) { json(res, 404, { ok: false, reason: 'unknown business: ' + id }); return null; }
    return id;
  }

  /* ---- CATALOG -------------------------------------------------------------------------------------*/

  // GET /api/businesses/:biz/twin — what the twin can simulate over, and what it cannot (no reading yet).
  function handleCatalog(req, res, match) {
    const b = wantBiz(res, match && match[1]);
    if (!b) return;
    let out;
    try { out = twin.catalog(b); }
    catch (e) { return json(res, 500, { ok: false, reason: 'could not build the twin catalog: ' + str(e && e.message) }); }
    json(res, 200, { ok: true, catalog: out });
  }

  /* ---- SIMULATE ------------------------------------------------------------------------------------*/

  // POST /api/businesses/:biz/twin/simulate  { name, note, steps:[{metric, op, factor|amount|value}] }
  async function handleSimulate(req, res, match) {
    const b = wantBiz(res, match && match[1]);
    if (!b) return;
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, reason: parsed.reason });
    const body = parsed.body || {};
    /* A scenario with no steps is a request to simulate nothing and report success — refuse it explicitly
       rather than returning an empty result set that reads as "no change". */
    if (!Array.isArray(body.steps) || !body.steps.length) {
      return json(res, 400, { ok: false, reason: 'a scenario needs a steps array with at least one {metric, op, ...}' });
    }
    let out;
    try { out = twin.simulate(b, body); }
    catch (e) { return json(res, 500, { ok: false, reason: 'could not simulate: ' + str(e && e.message) }); }

    if (out.ok) {
      recordSafe(b, {
        businessId: b,
        scenario: str(out.name),
        steps: out.stepCount,
        simulated: out.simulatedCount,
        mode: 'simulate'
      });
    }
    /* A scenario that could not be fully simulated is a 422, not a 200-with-caveats: the caller asked for a
       what-if and did not get one, and `failures` names every metric that had no baseline. */
    json(res, out.ok ? 200 : 422, out);
  }

  /* ---- COMPARE -------------------------------------------------------------------------------------*/

  // POST /api/businesses/:biz/twin/compare  { scenarios:[{name, steps:[...]}, ...] }
  async function handleCompare(req, res, match) {
    const b = wantBiz(res, match && match[1]);
    if (!b) return;
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, reason: parsed.reason });
    const body = parsed.body || {};
    if (!Array.isArray(body.scenarios) || !body.scenarios.length) {
      return json(res, 400, { ok: false, reason: 'a comparison needs a scenarios array with at least one scenario' });
    }
    let out;
    try { out = twin.compare(b, body.scenarios); }
    catch (e) { return json(res, 500, { ok: false, reason: 'could not compare: ' + str(e && e.message) }); }

    if (out.ok) {
      recordSafe(b, {
        businessId: b,
        scenario: str(body.scenarios.length) + ' scenarios',
        steps: out.metrics.length,
        simulated: out.metrics.length,
        mode: 'compare'
      });
    }
    json(res, out.ok ? 200 : 422, out);
  }

  return {
    MAX_BODY: MAX_BODY,
    RX_BIZ_TWIN_SIMULATE: RX_BIZ_TWIN_SIMULATE,
    RX_BIZ_TWIN_COMPARE: RX_BIZ_TWIN_COMPARE,
    RX_BIZ_TWIN: RX_BIZ_TWIN,
    rows: [
      // MOST SPECIFIC FIRST — see the note above the regexes.
      { m: 'POST', rx: RX_BIZ_TWIN_SIMULATE, h: handleSimulate },
      { m: 'POST', rx: RX_BIZ_TWIN_COMPARE, h: handleCompare },
      { m: 'GET', rx: RX_BIZ_TWIN, h: handleCatalog }
    ],
    handlers: { handleCatalog, handleSimulate, handleCompare }
  };
}

module.exports = {
  makeTwinRoutes,
  MAX_BODY: MAX_BODY,
  // Exported for the route test, which asserts the specific-before-general ordering on the REGEXES
  // themselves — the same discipline agent-routes.js follows.
  RX_BIZ_TWIN, RX_BIZ_TWIN_SIMULATE, RX_BIZ_TWIN_COMPARE
};
