/* sidecar/creator-routes.js — the HTTP surface for §20 CREATOR STUDIO + §37 MY CREATIONS.

   THREE ROUTES, ALL GET, NONE WRITES.

     GET /api/creator/pipeline            every content piece, grouped by §17 stage, across all businesses
     GET /api/creator/calendar?from=&to=  pieces placed on the day they are dated, within a window
     GET /api/creations?type=&business=   EVERY made thing (content · documents · work orders · deliverables)

   NAMESPACING. /api/creator and /api/creations are fresh prefixes — none can shadow a Phase 1-12 path. The
   per-business content CRUD stays on its own guarded routes (/api/businesses/:id/content,
   /api/content/:id/advance); this module adds only the cross-business READS those doors cannot answer.

   READ-ONLY BY CONSTRUCTION. The composers have no write path and this module exposes no POST. Publishing
   remains a human action on the existing advance route — this surface must never become a second door to
   the one transition the store refuses to automate (§17).

   ROUTE MATCHING — the trap, restated because it cost a whole phase: `exact` compares the RAW url, so
   `/api/creator/pipeline?x=1` would fall through to a 404. Every row is therefore **`qsplit`**
   (query-stripped path compare), so a cache-buster or a ?from/?to/?type window resolves while a stray
   suffix (/api/creator/pipeline/extra) still does not.

   PURE-ish: `respondJson` injected, so this is unit-testable without booting the server. */

'use strict';

function defaultRespondJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function makeCreatorRoutes(deps) {
  deps = deps || {};
  const creator = deps.creator;                   // makeCreatorStudio(...) — the composing reader
  const creations = deps.creations || null;       // makeCreationsIndex(...) — the §37 unified index (optional)
  const respondJson = typeof deps.respondJson === 'function' ? deps.respondJson : defaultRespondJson;

  if (!creator) throw new Error('creator-routes.js requires { creator }');

  const json = (res, code, obj) => respondJson(res, code, obj);

  /* Read one query parameter through URL parsing (handles encoding, repeats, fragment) — never a
     home-made split on the raw url. */
  function q(req, name) {
    try {
      const u = new URL(req.url || '/', 'http://x');
      const v = u.searchParams.get(name);
      return v == null ? '' : String(v).trim();
    } catch (e) { return ''; }
  }

  // A finite epoch-ms from a query param, or null. A junk value is "no bound", never a zero-width window.
  function ms(req, name) {
    const raw = q(req, name);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.floor(n) : null;
  }

  function guard(fn, res, label) {
    try { return fn(); }
    catch (e) { json(res, 500, { ok: false, reason: 'could not build the creator ' + label + ': ' + String(e && e.message) }); return null; }
  }

  function handlePipeline(req, res) {
    const o = guard(() => creator.pipeline({}), res, 'pipeline');
    if (o) json(res, 200, o);
  }

  function handleCalendar(req, res) {
    const from = ms(req, 'from');
    const to = ms(req, 'to');
    // A reversed window is a caller mistake, not an empty calendar — refuse it plainly.
    if (from != null && to != null && from > to) {
      return json(res, 400, { ok: false, reason: 'the calendar window is reversed — from must be ≤ to' });
    }
    const o = guard(() => creator.calendar({ from: from, to: to }), res, 'calendar');
    if (o) json(res, 200, o);
  }

  /* GET /api/creations?type=&business= — the §37 unified index. Optional filters narrow the read; an
     unknown type is refused (never silently ignored, which would return EVERYTHING under a bad filter). */
  function handleCreations(req, res) {
    if (!creations) return json(res, 200, { ok: true, types: [], rows: [], counts: { total: 0, byType: {} }, readable: {}, note: 'the creations index is not wired here' });
    const type = q(req, 'type');
    if (type && creations.TYPES.indexOf(type) < 0) {
      return json(res, 400, { ok: false, reason: 'unknown type "' + type + '" — one of: ' + creations.TYPES.join(', ') });
    }
    const business = q(req, 'business');
    const o = guard(() => creations.index({ type: type, businessId: business }), res, 'creations index');
    if (o) json(res, 200, o);
  }

  const rows = [
    { m: 'GET', qsplit: '/api/creator/pipeline', h: handlePipeline },
    { m: 'GET', qsplit: '/api/creator/calendar', h: handleCalendar },
    { m: 'GET', qsplit: '/api/creations', h: handleCreations }
  ];

  return { rows: rows };
}

module.exports = { makeCreatorRoutes };
