/* sidecar/mission-routes.js — the HTTP surface for §23's MISSION CONTROL (Business OS Phase 11).

   FOUR ROUTES, ALL GET, NONE OF THEM WRITES.

     GET /api/mission/board          every business, ranked by what is blocking it, with the reasons named
     GET /api/mission/fleet          the cross-business figures (intelligence portfolio) alongside the board
     GET /api/mission/attention      just the businesses that need a human, in rank order
     GET /api/mission/trail          the cross-business activity trail (the one deliberate isolation exception)
     GET /api/mission/alerts?business=<id>   one business's persistence/anomaly signals

   NAMESPACING. These are STATION-level reads (/api/mission/…), not business-scoped: a mission view is the
   whole point of the surface, and a per-business variant already exists under /api/businesses/:id/…
   'mission' is a fresh prefix, so none of these can shadow a Phase 1-10 path.

   READ-ONLY BY CONSTRUCTION. The composer has no write path and this module exposes no POST. A mission
   control that could also ACT would be an unguarded second door to every guarded mutation in the system.

   ROUTE MATCHING — the trap, restated because it cost a whole phase: index.js's dispatch populates the match
   array ONLY for `rx` rows; a `qrx` row leaves gm = null and a handler reading match[1] gets undefined. The
   business-scoped /alerts row is therefore **rx** with a query-tolerant tail.

   The four parameterless rows use **`qsplit`**, not `exact`. `exact` compares the RAW url (`url !== r.exact`),
   so `/api/mission/trail?limit=5` would NOT match `exact: '/api/mission/trail'` and would fall through to the
   static handler (a live 404 — this was a real defect found on the box, not a theory). `qsplit` compares the
   query-stripped path (`bare !== r.qsplit`), so every parameterised variant of these four resolves while a
   stray suffix (/api/mission/trail/extra) still does not — verbatim, suffix-proof, query-tolerant.

   PURE-ish: `respondJson` injected, so this is unit-testable without booting the server. */

'use strict';

const QS = '(?:\\?[^#]*)?$';
const MAX_ID = 120;

// /api/mission/alerts reads its business from ?business= — the id lives in the QUERY, not the path, so the
// regex is anchored to the exact route and tolerance comes from QS.
const RX_MISSION_ALERTS = new RegExp('^/api/mission/alerts' + QS);

function defaultRespondJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function makeMissionRoutes(deps) {
  deps = deps || {};
  const mission = deps.mission;                   // makeMissionControl(...) — the composing reader
  const respondJson = typeof deps.respondJson === 'function' ? deps.respondJson : defaultRespondJson;

  if (!mission) throw new Error('mission-routes.js requires { mission }');

  const json = (res, code, obj) => respondJson(res, code, obj);
  const str = (v) => (v == null ? '' : String(v));

  /* Read one query parameter. A handler must never read the raw URL with a home-made split — URL parsing
     handles the encoding, repeated keys and the fragment for us. */
  function q(req, name) {
    try {
      const u = new URL(req.url || '/', 'http://x');
      return str(u.searchParams.get(name) || '').trim();
    } catch (e) { return ''; }
  }

  /* An optional period override, clamped. A caller-supplied periodMs of "abc", 0 or -5 is not a period —
     it falls back to the default rather than becoming a zero-width window that reports nothing. */
  function period(req) {
    const raw = q(req, 'periodMs');
    const n = Number(raw);
    if (!raw || !Number.isFinite(n) || n <= 0) return {};
    return { periodMs: Math.min(Math.floor(n), 90 * 24 * 60 * 60 * 1000) };
  }

  function guard(fn, res, label) {
    try { return fn(); }
    catch (e) { json(res, 500, { ok: false, reason: 'could not build the mission ' + label + ': ' + str(e && e.message) }); return null; }
  }

  // GET /api/mission/board — the ranked attention board.
  function handleBoard(req, res) {
    const o = guard(() => mission.board({}), res, 'board');
    if (o) json(res, 200, o);
  }

  // GET /api/mission/fleet — the cross-business figures beside the board.
  function handleFleet(req, res) {
    const o = guard(() => mission.fleet(period(req)), res, 'fleet');
    if (o) json(res, 200, o);
  }

  // GET /api/mission/attention — only what needs a human.
  function handleAttention(req, res) {
    const o = guard(() => mission.attention({}), res, 'attention list');
    if (o) json(res, 200, o);
  }

  // GET /api/mission/alerts?business=<id> — one business's signals.
  function handleAlerts(req, res) {
    const id = q(req, 'business').slice(0, MAX_ID);
    if (!id) return json(res, 400, { ok: false, reason: 'a ?business= is required (isolation is by key — never implied)' });
    const o = guard(() => mission.alerts(id, period(req)), res, 'alerts');
    if (!o) return;
    /* A business scoped read with no business to read is a 400; the composer's own ok:false carries the
       reason so the two cannot disagree. */
    json(res, o.ok === false ? 400 : 200, o);
  }

  // GET /api/mission/trail — the cross-business activity feed.
  function handleTrail(req, res) {
    const rawLim = q(req, 'limit');
    const n = Number(rawLim);
    const o = guard(() => mission.trail(Number.isFinite(n) && n > 0 ? { limit: Math.floor(n) } : {}), res, 'trail');
    if (o) json(res, 200, o);
  }

  // `qsplit` = verbatim path match with the query ignored. `exact` would reject every ?query variant.
  const rows = [
    { m: 'GET', qsplit: '/api/mission/board', h: handleBoard },
    { m: 'GET', qsplit: '/api/mission/fleet', h: handleFleet },
    { m: 'GET', qsplit: '/api/mission/attention', h: handleAttention },
    { m: 'GET', qsplit: '/api/mission/trail', h: handleTrail },
    { m: 'GET', rx: RX_MISSION_ALERTS, h: handleAlerts }
  ];

  return { rows: rows, MAX_ID: MAX_ID };
}

module.exports = { makeMissionRoutes, RX_MISSION_ALERTS, MAX_ID };
