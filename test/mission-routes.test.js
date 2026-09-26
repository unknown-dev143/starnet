'use strict';
/* mission-routes.test.js — the /api/mission surface (Business OS Phase 11).

   Three things this suite exists to catch:

     1. NAMESPACING. These are station-level reads under a fresh /api/mission prefix. None may collide with a
        Phase 1-10 path, and the exact rows must not absorb a stray suffix.
     2. THE qrx TRAP. index.js's dispatch fills the match array ONLY for `rx` rows; a `qrx` row leaves gm =
        null and the handler reading match[1] gets undefined. The one parameterised read (/alerts) is `rx`
        with a query-tolerant tail, and the asymmetry is mirrored in `call()`.
     3. READ-ONLY. §23's mutations live elsewhere. This module exposes no POST.                            */

const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const { makeMissionRoutes, RX_MISSION_ALERTS, MAX_ID } = require('../sidecar/mission-routes.js');
const { makeMissionControl } = require('../sidecar/mission-control.js');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'mission-routes.js'), 'utf8');
/* the prose explains WHY `exact` is wrong, so a source-lock must read the CODE, not the comment that names
   the avoided concept. */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const NOW = 1000000000000;

function mkRes() {
  const out = { code: 0, body: null };
  return { out, writeHead(c) { out.code = c; }, end(s) { try { out.body = JSON.parse(s); } catch (e) { out.body = s; } } };
}

/* call() mirrors index.js's dispatch EXACTLY: `exact` compares the RAW url; `qsplit` compares the
   query-stripped path; `rx` fills the match array; a `qrx` row would leave it null. */
function call(routes, route, url, method) {
  const r = mkRes();
  const req = { url: url, method: method || 'GET' };
  const bare = url.split('?')[0];
  let match = null;
  if (route.exact !== undefined) match = (url === route.exact) ? [url] : null;
  if (route.qsplit !== undefined) match = (bare === route.qsplit) ? [bare] : null;
  if (route.rx) match = route.rx.exec(url);
  if (!match) return { matched: false };
  route.h(req, r, match);
  return { matched: true, code: r.out.code, json: r.out.body };
}

function find(rows, url) {
  const bare = url.split('?')[0];
  for (const r of rows) {
    if (r.exact !== undefined && url === r.exact) return r;
    if (r.qsplit !== undefined && bare === r.qsplit) return r;
    if (r.rx && r.rx.test(url)) return r;
  }
  return null;
}

function mkRoutes(over) {
  const mission = makeMissionControl(Object.assign({
    now: () => NOW,
    businesses: () => [
      { id: 'waiting', name: 'Waiting Co', stage: 'live', template: 'saas', updatedAt: NOW - 500 },
      { id: 'quiet', name: 'Quiet Co', stage: 'live', template: 'saas', updatedAt: NOW - 500 }
    ],
    pendingCount: (id) => (id === 'waiting' ? 2 : 0),
    portfolio: () => ({ businesses: 2, metrics: [{ metric: 'revenue', total: 100 }] }),
    signals: (id) => (id === 'waiting' ? [{ kind: 'persistent-trend', metric: 'revenue', text: 'up 4' }] : []),
    recent: (o) => [{ id: 'r1', at: NOW - 100, businessId: 'waiting', actor: { kind: 'user' }, action: 'Hired', result: 'ok' }].slice(0, o.limit)
  }, (over && over.sources) || {}));
  return makeMissionRoutes({
    mission: (over && over.mission !== undefined) ? over.mission : mission
  });
}

/* ---------- the rows are well-formed and namespaced ---------- */
{
  const routes = mkRoutes();
  A.eq(routes.rows.length, 5, 'five rows');
  for (const r of routes.rows) {
    A.eq(r.m, 'GET', 'every row is GET — the surface is read-only');
    A.ok(typeof r.h === 'function', 'every row has a handler');
    /* a qsplit row carries the path literally; an rx row carries it in the escaped regex source */
    const path0 = r.qsplit || (r.rx ? r.rx.source.replace(/\\\//g, '/') : '');
    A.ok(path0.indexOf('/api/mission') >= 0, 'every row lives under /api/mission (a fresh prefix)');
    if (r.qsplit) A.eq(r.rx, undefined, 'a qsplit row has no rx');
    else A.ok(r.rx && !r.qrx, 'the one parameterised row is rx, never qrx');
  }
  // no two rows claim the same path
  for (const url of ['/api/mission/board', '/api/mission/fleet', '/api/mission/attention', '/api/mission/trail', '/api/mission/alerts?business=x']) {
    const hits = routes.rows.filter(r => (r.qsplit !== undefined && url.split('?')[0] === r.qsplit) || (r.rx && r.rx.test(url))).length;
    A.eq(hits, 1, 'exactly one row matches ' + url);
  }
}
/* the qsplit rows must NOT absorb a suffix — a stray path falls through rather than 200-ing the wrong thing */
{
  const routes = mkRoutes();
  for (const url of ['/api/mission/board/extra', '/api/mission/fleetx', '/api/mission/trailing']) {
    A.eq(find(routes.rows, url), null, url + ' matches no row');
  }
  // but a query tail on a qsplit path IS still that path (index.js compares the split path)
  A.ok(find(routes.rows, '/api/mission/board?x=1'), 'a qsplit row still matches with a query tail');
  A.ok(find(routes.rows, '/api/mission/trail?limit=5'), 'and so does the trail with a limit');
}
/* REGRESSION — the live defect: `exact` compares the RAW url, so EVERY ?query variant 404s. The four
   parameterless rows must be qsplit (path-verbatim, query-tolerant), never exact. */
{
  const routes = mkRoutes();
  for (const r of routes.rows) {
    if (r.rx) continue;
    A.eq(r.exact, undefined, 'no row uses `exact` — it would reject every query variant');
    A.ok(r.qsplit !== undefined, 'the parameterless rows are qsplit');
  }
  // the four advertised paths all resolve WITH a query tail
  for (const url of ['/api/mission/board?t=1', '/api/mission/fleet?periodMs=1000', '/api/mission/attention?x=1', '/api/mission/trail?limit=5']) {
    A.ok(find(routes.rows, url), url + ' resolves to a row');
    A.eq(call(routes, find(routes.rows, url), url).code, 200, url + ' answers 200');
  }
}
/* source-lock the discipline */
{
  A.ok(!/qrx\s*:/.test(SRC), 'the source contains no qrx row');
  A.ok(/const QS = /.test(SRC), 'QS is defined for the tolerant row');
  A.ok(SRC.indexOf("new RegExp('^/api/mission/alerts' + QS)") >= 0, 'the alerts regex is built from QS');
  A.ok(!/method:\s*'POST'/.test(SRC) && !/'POST'/.test(SRC), 'the source contains no POST');
  A.ok(!/exact\s*:/.test(CODE), 'the code uses qsplit, never exact (the query-blind trap)');
}

/* ---------- GET /api/mission/board ---------- */
{
  const routes = mkRoutes();
  const r = call(routes, find(routes.rows, '/api/mission/board'), '/api/mission/board');
  A.ok(r.matched, 'the board route matches');
  A.eq(r.code, 200, 'the board answers 200');
  A.eq(r.json.businesses.length, 2, 'both businesses come back');
  A.eq(r.json.businesses[0].id, 'waiting', 'ranked first (work waiting)');
  A.ok(r.json.businesses[0].reasons.length > 0, 'and carries its reasons');
  A.ok(!('score' in r.json), 'no score on the wire');
}
/* the board works with a query tail (a cache-buster must not 404 it) */
{
  const routes = mkRoutes();
  A.eq(call(routes, find(routes.rows, '/api/mission/board?t=1'), '/api/mission/board?t=1').code, 200, 'a query tail is tolerated');
}

/* ---------- GET /api/mission/fleet ---------- */
{
  const routes = mkRoutes();
  const r = call(routes, find(routes.rows, '/api/mission/fleet'), '/api/mission/fleet');
  A.eq(r.code, 200, 'fleet answers 200');
  A.eq(r.json.portfolio.metrics[0].total, 100, 'the portfolio is passed through');
  A.eq(r.json.portfolioReadable, true, 'and flagged readable');
}
/* a junk periodMs is ignored rather than becoming a zero-width window */
{
  let seen = null;
  const routes = mkRoutes({ sources: { portfolio: (o) => { seen = o; return { businesses: 0, metrics: [] }; } } });
  call(routes, find(routes.rows, '/api/mission/fleet'), '/api/mission/fleet?periodMs=abc');
  A.eq(JSON.stringify(seen), '{}', 'a junk periodMs falls back to the default');
  call(routes, find(routes.rows, '/api/mission/fleet'), '/api/mission/fleet?periodMs=86400000');
  A.eq(seen.periodMs, 86400000, 'a real periodMs is passed through');
}
/* an oversize periodMs is clamped */
{
  let seen = null;
  const routes = mkRoutes({ sources: { portfolio: (o) => { seen = o; return { businesses: 0, metrics: [] }; } } });
  call(routes, find(routes.rows, '/api/mission/fleet'), '/api/mission/fleet?periodMs=999999999999');
  A.ok(seen.periodMs <= 90 * 24 * 60 * 60 * 1000, 'an oversize period is clamped server-side');
}

/* ---------- GET /api/mission/attention ---------- */
{
  const routes = mkRoutes();
  const r = call(routes, find(routes.rows, '/api/mission/attention'), '/api/mission/attention');
  A.eq(r.code, 200, 'attention answers 200');
  A.eq(r.json.count, 1, 'only the business that needs a human appears');
  A.eq(r.json.rows[0].id, 'waiting', 'and it is the right one');
}

/* ---------- GET /api/mission/trail ---------- */
{
  const routes = mkRoutes();
  const r = call(routes, find(routes.rows, '/api/mission/trail'), '/api/mission/trail?limit=5');
  A.eq(r.code, 200, 'trail answers 200');
  A.eq(r.json.rows.length, 1, 'rows come back');
  A.eq(r.json.rows[0].businessId, 'waiting', 'the cross-business feed carries the business id');
}
{
  const routes = mkRoutes();
  A.eq(call(routes, find(routes.rows, '/api/mission/trail'), '/api/mission/trail').code, 200, 'trail works with no limit');
}

/* ---------- GET /api/mission/alerts?business=<id> ---------- */
{
  const routes = mkRoutes();
  const r = call(routes, find(routes.rows, '/api/mission/alerts?business=waiting'), '/api/mission/alerts?business=waiting');
  A.ok(r.matched, 'the alerts route matches');
  A.eq(r.code, 200, 'alerts answers 200');
  A.eq(r.json.businessId, 'waiting', 'the business id is read from the QUERY');
  A.eq(r.json.signals.length, 1, 'its signals come back');
}
/* the id read from the query is the one asked for — the qrx trap, asserted directly */
{
  const m = RX_MISSION_ALERTS.exec('/api/mission/alerts?business=my-co&x=1');
  A.ok(m, 'the alerts regex matches with a query tail');
  A.eq(m[0].indexOf('/api/mission/alerts'), 0, 'from the start of the path');
}
/* a missing ?business= is a 400 — isolation is by key, never implied */
{
  const routes = mkRoutes();
  const r = call(routes, find(routes.rows, '/api/mission/alerts'), '/api/mission/alerts');
  A.eq(r.code, 400, 'no ?business= is a 400');
  A.ok(/business=/.test(r.json.reason), 'and asks for it');
  A.ok(/isolation/.test(r.json.reason), 'and names the isolation rule');
}
/* a business with no signals is 200 with an empty list — a real answer, not a 404 */
{
  const routes = mkRoutes();
  const r = call(routes, find(routes.rows, '/api/mission/alerts?business=quiet'), '/api/mission/alerts?business=quiet');
  A.eq(r.code, 200, 'a business with no signals answers 200');
  A.eq(r.json.signals.length, 0, 'with an empty signal list');
  A.eq(r.json.readable, true, 'and is marked readable (the source WAS read)');
}
/* an empty ?business= is refused (not treated as "all") */
{
  const routes = mkRoutes();
  A.eq(call(routes, find(routes.rows, '/api/mission/alerts'), '/api/mission/alerts?business=').code, 400,
    'an empty ?business= is refused');
}
/* the id is bounded before it reaches the composer */
{
  const routes = mkRoutes();
  const long = 'x'.repeat(500);
  const r = call(routes, find(routes.rows, '/api/mission/alerts'), '/api/mission/alerts?business=' + long);
  A.eq(r.code, 200, 'an oversize id still routes');
  A.ok(r.json.businessId.length <= MAX_ID, 'but the id is bounded before use');
}

/* ---------- a broken composer surfaces as a 500, not a crash ---------- */
{
  const routes = mkRoutes({ mission: { board: () => { throw new Error('boom'); }, fleet: () => { throw new Error('boom'); }, attention: () => { throw new Error('boom'); }, alerts: () => { throw new Error('boom'); }, trail: () => { throw new Error('boom'); } } });
  for (const url of ['/api/mission/board', '/api/mission/fleet', '/api/mission/attention', '/api/mission/trail']) {
    const r = call(routes, find(routes.rows, url), url);
    A.eq(r.code, 500, url + ' 500s when the composer throws');
    A.ok(/boom/.test(r.json.reason), 'and carries the message');
  }
  const a = call(routes, find(routes.rows, '/api/mission/alerts?business=x'), '/api/mission/alerts?business=x');
  A.eq(a.code, 500, 'alerts 500s too');
}
/* a composer ok:false becomes a 400 with the composer's reason */
{
  const routes = mkRoutes({ mission: { alerts: () => ({ ok: false, reason: 'a businessId is required' }) } });
  const r = call(routes, find(routes.rows, '/api/mission/alerts?business=x'), '/api/mission/alerts?business=x');
  A.eq(r.code, 400, 'an ok:false alerts read is a 400');
  A.ok(/businessId is required/.test(r.json.reason), 'with the composer\'s reason');
}

/* ---------- refuses to build without its composer ---------- */
{
  A.throws(() => makeMissionRoutes({}), 'the module refuses to build with no composer');
  A.throws(() => makeMissionRoutes(), 'and with no deps at all');
}

A.report('mission-routes');
