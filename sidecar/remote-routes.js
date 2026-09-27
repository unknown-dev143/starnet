/* sidecar/remote-routes.js — the HTTP surface for REMOTE MONITORING (Business OS §25, brief §27).

   WHAT THIS EXPOSES. A small, READ-ONLY view of the seven facts the brief names — business status · AI
   activity · alerts · pending approvals · revenue · errors · running tasks — shaped for a phone, not a
   workstation. The shaping lives in business-remote.js (the read model); this file only routes to it.

   READ-ONLY BY DESIGN. There is NO POST/PATCH/DELETE here. The brief says the remote interface should
   "prioritize monitoring and approvals — not attempt to reproduce the whole workstation", and more
   importantly an approval DECISION already has a guarded, tier-checked route
   (`POST /api/approvals/<id>/approve|reject`) that a remote client should call with its existing auth.
   Adding a second mutation path here would be a second door to the same decision — exactly the drift the
   project forbids (one door per mutation).

   THE SEAM. §25 is scoped "architecture-ready". business-remote-seam.js holds the binding point and is
   disabled by default; this module does not open any listener. GET /api/remote/status reports the seam's
   real state so a client can tell "not enabled yet" from "enabled but unwired" — it never claims a remote
   interface is live.

   ROUTE MATCHING — the trap that produces a route which looks right and never fires. index.js's dispatch
   populates the match array only for `rx` rows; a `qrx` row leaves it NULL, so a handler reading
   `match[1]` gets undefined. The business-scoped GET here carries a `?limit` query, so it uses **rx** with
   the QS optional-query tail, never `qrx`. This module declares **ZERO qrx rows** (asserted in
   test/remote-routes.test.js as a module-level sweep). Ids contain '~' (never '#', which the browser
   strips as a fragment delimiter before the request is sent).

   PURE-ish: `respondJson` injected, so this is unit-testable without booting the server. */

'use strict';

const ID = '([A-Za-z0-9_~-]+)';
const QS = '(?:\\?[^#]*)?$';   // the optional-query tail — see the header.

const RX_SUMMARY = new RegExp('^/api/remote/summary' + QS);
const RX_STATUS = new RegExp('^/api/remote/status' + QS);
const RX_BUSINESS = new RegExp('^/api/remote/businesses/' + ID + QS);

function defaultRespondJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

/* makeRemoteRoutes({ readModel, seam }) — both are the real objects from the composition root; nothing is
   required directly, so there is no second copy of any store. `seam` may be omitted (status then reports
   the seam as unconfigured rather than inventing one). */
function makeRemoteRoutes(deps) {
  deps = deps || {};
  const readModel = deps.readModel;
  const seam = deps.seam || null;
  const respondJson = typeof deps.respondJson === 'function' ? deps.respondJson : defaultRespondJson;

  if (!readModel) throw new Error('remote-routes.js requires { readModel }');

  function limitOf(req) {
    try {
      const u = new URL(String(req.url || ''), 'http://x');
      const n = Number(u.searchParams.get('limit'));
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : 20;
    } catch (e) { return 20; }
  }

  /* A throwing read model becomes a 500 that NAMES the failure, never a crash that takes the request
     handler (and every other route) down with it. Same discipline as mission-routes.js. */
  function guard(fn) {
    return function (req, res, match) {
      try { return fn(req, res, match); }
      catch (e) { return respondJson(res, 500, { ok: false, reason: String(e && e.message || e) }); }
    };
  }

  // GET /api/remote/summary — the whole snapshot in one call (what a remote client polls).
  function handleSummary(req, res) {
    const snap = readModel.summary({ limit: limitOf(req) });
    return respondJson(res, 200, { ok: true, snapshot: snap });
  }

  // GET /api/remote/businesses/<id> — the focused view a notification would deep-link to (§P6 scoped).
  function handleBusiness(req, res, match) {
    const id = match && match[1];
    const out = readModel.oneBusiness(id);
    if (!out.ok) return respondJson(res, 404, { ok: false, error: out.reason });
    return respondJson(res, 200, out);
  }

  /* GET /api/remote/status — the seam's REAL state. This is the honest answer to "can I monitor this
     remotely right now". Until the seam is both enabled and bound it says so, and names what is missing. */
  function handleStatus(req, res) {
    const s = seam ? seam.status() : { bound: false, enabled: false, transport: null,
      reason: 'no remote seam configured' };
    return respondJson(res, 200, {
      ok: true,
      bound: s.bound === true,
      enabled: s.enabled === true,
      transport: s.transport || null,
      reason: s.reason || null,
      missing: seam && typeof seam.missing === 'function' ? seam.missing() : [],
      priority: readModel.priority ? readModel.priority() : []
    });
  }

  const routes = [
    { m: 'GET', rx: RX_SUMMARY, h: guard(handleSummary) },
    { m: 'GET', rx: RX_STATUS, h: guard(handleStatus) },
    { m: 'GET', rx: RX_BUSINESS, h: guard(handleBusiness) }
  ];

  return { routes, handleSummary, handleBusiness, handleStatus, RX_SUMMARY, RX_STATUS, RX_BUSINESS };
}

module.exports = { makeRemoteRoutes, defaultRespondJson };
