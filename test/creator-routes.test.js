'use strict';
/* creator-routes.test.js — the /api/creator + /api/creations surface (§20 CREATOR STUDIO, §37 MY CREATIONS).
 
   Three things this suite exists to catch:
 
     1. NAMESPACING. Station-level reads under fresh /api/creator and /api/creations prefixes. None may
        collide with a Phase 1-12 path, and the rows must not absorb a stray suffix.
     2. THE QUERY TRAP. `exact` compares the RAW url, so /api/creator/pipeline?x=1 would 404. Every row is
        `qsplit` (query-stripped compare), so a window, a filter, or a cache-buster resolves.
     3. READ-ONLY. This module exposes no POST — publishing keeps its own guarded route.               */

const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const { makeCreatorRoutes } = require('../sidecar/creator-routes.js');
const { makeCreatorStudio } = require('../sidecar/creator-studio.js');
const { makeCreationsIndex } = require('../sidecar/creations-index.js');
const { makeBusinessContentStore } = require('../sidecar/business-content-store.js');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'creator-routes.js'), 'utf8');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const NOW = 1000000000000;

function mkRes() {
  const out = { code: 0, body: null };
  return { out, writeHead(c) { out.code = c; }, end(s) { try { out.body = JSON.parse(s); } catch (e) { out.body = s; } } };
}
function call(routes, url, method) {
  const r = mkRes();
  const req = { url: url, method: method || 'GET' };
  const bare = url.split('?')[0];
  const route = routes.rows.find(x => (x.qsplit !== undefined && bare === x.qsplit));
  if (!route) return { matched: false };
  route.h(req, r, [bare]);
  return { matched: true, code: r.out.code, json: r.out.body };
}
function find(rows, url) {
  const bare = url.split('?')[0];
  for (const r of rows) if (r.qsplit !== undefined && bare === r.qsplit) return r;
  return null;
}

function mkRoutes() {
  const content = makeBusinessContentStore({ now: () => NOW, persist: () => {} });
  content.addPiece('biz-a', { title: 'A piece', channel: 'youtube', stage: 'script' });
  const creator = makeCreatorStudio({ content, businesses: () => [{ id: 'biz-a', name: 'Alpha' }], now: () => NOW });
  const creations = makeCreationsIndex({ content, businesses: () => [{ id: 'biz-a', name: 'Alpha' }], now: () => NOW });
  return makeCreatorRoutes({ creator: creator, creations: creations });
}

/* ---------- the rows are well-formed and namespaced ---------- */
{
  const routes = mkRoutes();
  A.eq(routes.rows.length, 3, 'three rows');
  for (const r of routes.rows) {
    A.eq(r.m, 'GET', 'every row is GET — the surface is read-only');
    A.ok(typeof r.h === 'function', 'every row has a handler');
    A.ok(String(r.qsplit).indexOf('/api/creator') >= 0 || String(r.qsplit).indexOf('/api/creations') >= 0,
      'every row lives under a fresh prefix (/api/creator or /api/creations)');
    A.eq(r.exact, undefined, 'no row uses `exact` — it would reject every query variant');
    A.eq(r.rx, undefined, 'no row uses rx — all are plain paths');
  }
  for (const url of ['/api/creator/pipeline', '/api/creator/calendar', '/api/creations']) {
    A.eq(routes.rows.filter(r => url === r.qsplit).length, 1, 'exactly one row matches ' + url);
  }
  // no stray suffix resolves
  for (const url of ['/api/creator/pipeline/extra', '/api/creator/calendarx', '/api/creator/x', '/api/creations/x']) {
    A.eq(find(routes.rows, url), null, url + ' matches no row');
  }
  // but a query tail IS still the path
  A.ok(find(routes.rows, '/api/creator/pipeline?t=1'), 'a qsplit row still matches with a query tail');
  A.ok(find(routes.rows, '/api/creator/calendar?from=1&to=2'), 'and the calendar with a window');
  A.ok(find(routes.rows, '/api/creations?type=content'), 'and the creations index with a filter');
}

/* ---------- GET /api/creator/pipeline ---------- */
{
  const routes = mkRoutes();
  const r = call(routes, '/api/creator/pipeline');
  A.ok(r.matched, 'the pipeline route matches');
  A.eq(r.code, 200, 'the pipeline answers 200');
  A.eq(r.json.counts.total, 1, 'the one piece comes back');
  A.eq(r.json.byStage.script[0].title, 'A piece', 'grouped by stage');
  A.ok(Array.isArray(r.json.stages) && r.json.stages[0] === 'idea', 'the stage order is on the wire');
}
/* a query tail is tolerated (a cache-buster must not 404 it) */
{
  const routes = mkRoutes();
  A.eq(call(routes, '/api/creator/pipeline?t=1').code, 200, 'a query tail is tolerated');
}

/* ---------- GET /api/creator/calendar ---------- */
{
  const routes = mkRoutes();
  const r = call(routes, '/api/creator/calendar');
  A.eq(r.code, 200, 'the calendar answers 200');
  A.ok(Array.isArray(r.json.days), 'and returns day buckets');
}
/* a reversed window is a 400, not an empty calendar */
{
  const routes = mkRoutes();
  const r = call(routes, '/api/creator/calendar?from=1000&to=1');
  A.eq(r.code, 400, 'a reversed window is refused with 400');
  A.ok(/reversed/i.test(r.json.reason), 'and says why');
}
/* a junk date is "no bound", never a zero-width window */
{
  const routes = mkRoutes();
  const r = call(routes, '/api/creator/calendar?from=abc');
  A.eq(r.code, 200, 'a junk from is ignored (no bound), not a 400');
}

/* ---------- GET /api/creations (§37 unified index) ---------- */
{
  const routes = mkRoutes();
  const r = call(routes, '/api/creations');
  A.eq(r.code, 200, 'the creations index answers 200');
  A.ok(Array.isArray(r.json.rows), 'and returns rows');
  A.eq(r.json.counts.total, 1, 'the one content piece is indexed');
  A.ok(r.json.types.indexOf('content') >= 0 && r.json.types.indexOf('deliverable') >= 0, 'the type vocabulary is on the wire');
}
/* an unknown type is refused, never silently ignored (which would return EVERYTHING) */
{
  const routes = mkRoutes();
  const r = call(routes, '/api/creations?type=banana');
  A.eq(r.code, 400, 'an unknown type is a 400');
  A.ok(/unknown type/i.test(r.json.reason), 'and it says so');
  A.ok(/content/.test(r.json.reason), 'and lists the real vocabulary');
}
/* a known type narrows the read */
{
  const routes = mkRoutes();
  A.eq(call(routes, '/api/creations?type=content').code, 200, 'a known type answers 200');
  const none = call(routes, '/api/creations?type=deliverable');
  A.eq(none.json.counts.total, 0, 'a type with no rows returns an empty (honest) set, not an error');
}
/* a query tail is tolerated (a cache-buster must not 404 it) */
{
  const routes = mkRoutes();
  A.eq(call(routes, '/api/creations?t=1&business=biz-a').code, 200, 'a query tail with a business filter is tolerated');
}

/* ---------- a route with NO index wired is honest, never a crash ---------- */
{
  const content = makeBusinessContentStore({ now: () => NOW, persist: () => {} });
  const creator = makeCreatorStudio({ content, businesses: () => [], now: () => NOW });
  const routes = makeCreatorRoutes({ creator: creator });   // no `creations` dep
  const r = call(routes, '/api/creations');
  A.eq(r.code, 200, 'an unwired index still answers 200');
  A.eq(r.json.rows.length, 0, 'with no rows');
  A.ok(/not wired/i.test(r.json.note), 'and says why (never a silent empty that reads as "you made nothing")');
}

/* ---------- source-lock the discipline ---------- */
{
  A.ok(!/method:\s*'POST'/.test(SRC) && !/'POST'/.test(SRC), 'the source contains no POST');
  A.ok(!/exact\s*:/.test(CODE), 'the code uses qsplit, never exact (the query-blind trap)');
  A.ok(/qsplit:/.test(SRC), 'the rows are qsplit');
  A.ok(/['"]\/api\/creations['"]/.test(SRC), 'the §37 index path is registered in the source');
}

A.report('creator-routes.test');
