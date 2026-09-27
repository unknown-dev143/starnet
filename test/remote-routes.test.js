'use strict';
/* remote-routes.test.js — the /api/remote surface (Business OS §25).

   Three things this suite exists to catch:

     1. NAMESPACING + READ-ONLY. These are station-level reads under a fresh /api/remote prefix. None may
        collide with a Phase 1-12 path, and the module must expose NO mutation row.
     2. THE qrx TRAP. index.js's dispatch fills the match array ONLY for `rx` rows; a `qrx` row leaves gm =
        null and the handler reading match[1] gets undefined. Every row here is `rx` with a query-tolerant
        tail, and the asymmetry is mirrored in `call()`.
     3. THE SEAM IS HONEST. /api/remote/status must never claim a remote interface is live. Until the seam
        is both enabled and bound it reports bound:false and names what is missing.                      */

const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const { makeRemoteRoutes } = require('../sidecar/remote-routes.js');
const { makeRemoteReadModel } = require('../sidecar/business-remote.js');
const { makeRemoteSeam } = require('../sidecar/business-remote-seam.js');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'remote-routes.js'), 'utf8');
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

function mkReadModel() {
  return makeRemoteReadModel({
    now: () => NOW,
    businesses: {
      list: () => [{ id: 'acme', name: 'Acme', stage: 'live', template: 'saas', currency: 'USD', updatedAt: NOW - 100 }],
      get: (id) => (id === 'acme' ? { id: 'acme', name: 'Acme', stage: 'live', template: 'saas', currency: 'USD', updatedAt: NOW - 100 } : null)
    },
    approvals: { OPEN_STATUS: 'pending', pendingCount: () => 1, list: (id) => (id === 'acme' ? [{ id: 'acme~a1', businessId: 'acme', tier: 'review', action: 'send', at: NOW - 50, status: 'pending' }] : []), summary: () => ({ total: 1, pending: 1 }), pendingBusinessIds: () => ['acme'] },
    activity: { recent: () => [{ at: NOW - 10, businessId: 'acme', actor: 'agent', kind: 'business.automation.ran', summary: 'ran' }], list: () => [] },
    finance: { totals: () => ({ byCurrency: { USD: { revenue: 100, expense: 20, estimated: 0, count: 1 } } }) },
    workOrders: { list: () => [] }
  });
}

function mkRoutes(over) {
  over = over || {};
  return makeRemoteRoutes({
    readModel: over.readModel !== undefined ? over.readModel : mkReadModel(),
    seam: over.seam
  });
}

/* ---------- the rows are well-formed, namespaced, and read-only ---------- */
{
  const routes = mkRoutes();
  A.eq(routes.routes.length, 3, 'three rows');
  for (const r of routes.routes) {
    A.eq(r.m, 'GET', 'every row is GET — the surface is read-only');
    A.ok(typeof r.h === 'function', 'every row has a handler');
    const path0 = r.qsplit || (r.rx ? r.rx.source.replace(/\\\//g, '/') : '');
    A.ok(path0.indexOf('/api/remote') >= 0, 'every row lives under /api/remote (a fresh prefix)');
    // the RX trap lock: every row is rx (it needs the match array), never qrx, never exact
    A.ok(r.rx && !r.qrx, 'every row is rx, never qrx');
    A.eq(r.exact, undefined, 'no row uses `exact` — it would reject every query variant');
  }
  for (const url of ['/api/remote/summary', '/api/remote/status', '/api/remote/businesses/acme']) {
    const hits = routes.routes.filter(r => r.rx && r.rx.test(url)).length;
    A.eq(hits, 1, 'exactly one row matches ' + url);
  }
}

/* ---------- the summary row tolerates a query tail (a cache-buster must not 404 it) ---------- */
{
  const routes = mkRoutes();
  for (const url of ['/api/remote/summary', '/api/remote/summary?limit=5', '/api/remote/status?t=1', '/api/remote/businesses/acme?x=1']) {
    A.ok(find(routes.routes, url), url + ' resolves to a row');
    A.eq(call(routes, find(routes.routes, url), url).code, 200, url + ' answers 200');
  }
}
/* a stray suffix falls through rather than 200-ing the wrong thing */
{
  const routes = mkRoutes();
  A.eq(find(routes.routes, '/api/remote/summary/extra'), null, 'a suffix does not match the summary row');
  A.eq(find(routes.routes, '/api/remote/statusx'), null, 'a glued suffix does not match status');
}

/* ---------- source-lock the discipline ---------- */
{
  // the sweep that catches a future sibling: a qrx row WITH a capture group is always a bug
  for (const file of fs.readdirSync(path.join(__dirname, '..', 'sidecar'))) {
    if (!/-routes\.js$/.test(file)) continue;
    const s = fs.readFileSync(path.join(__dirname, '..', 'sidecar', file), 'utf8');
    const bad = /qrx\s*:\s*[^\n]*\(/.test(s);
    A.ok(!bad, 'no sidecar/*-routes.js has a qrx row with a capture group (' + file + ')');
  }
  A.ok(!/'POST'/.test(SRC) && !/method:\s*'POST'/.test(SRC), 'the source contains no POST — read-only by construction');
  A.ok(!/\bpersist\b/.test(CODE), 'the route module writes nothing');
}

/* ---------- GET /api/remote/summary ---------- */
{
  const routes = mkRoutes();
  const r = call(routes, find(routes.routes, '/api/remote/summary'), '/api/remote/summary');
  A.ok(r.matched, 'the summary route matches');
  A.eq(r.code, 200, 'summary answers 200');
  A.ok(r.json.ok, 'ok:true');
  A.eq(r.json.snapshot.at, NOW, 'the snapshot is stamped from the injected clock');
  A.ok(Array.isArray(r.json.snapshot.sections), 'the render order is published');
  A.eq(r.json.snapshot.sections[0], 'alerts', 'alerts come first (the brief\'s priority)');
  A.eq(r.json.snapshot.sections[1], 'approvals', 'approvals second');
  A.ok(!('score' in r.json.snapshot), 'no score on the wire');
}

/* ---------- GET /api/remote/businesses/<id> ---------- */
{
  const routes = mkRoutes();
  const r = call(routes, find(routes.routes, '/api/remote/businesses/acme'), '/api/remote/businesses/acme');
  A.ok(r.matched, 'the business route matches');
  A.eq(r.code, 200, 'a known business answers 200');
  A.eq(r.json.business.id, 'acme', 'the id is read from the PATH (match[1], not a query)');
  A.eq(r.json.business.stage, 'live', 'and the real stage comes through');
}
/* an unknown business is a 404 with a reason — never another business's rows (P6) */
{
  const routes = mkRoutes();
  const r = call(routes, find(routes.routes, '/api/remote/businesses/nope'), '/api/remote/businesses/nope');
  A.eq(r.code, 404, 'an unknown business is a 404');
  A.ok(/no such business/.test(r.json.error), 'naming the miss');
}
/* the id is bounded and the route tolerates a trailing query */
{
  const routes = mkRoutes();
  A.eq(call(routes, find(routes.routes, '/api/remote/businesses/acme'), '/api/remote/businesses/acme?v=2').code, 200,
    'a ?v= cache-buster does not 404 a path-addressed read');
}

/* ---------- GET /api/remote/status — THE SEAM MUST BE HONEST ---------- */
{
  // no seam at all
  const routes = mkRoutes();
  const r = call(routes, find(routes.routes, '/api/remote/status'), '/api/remote/status');
  A.eq(r.code, 200, 'status answers 200');
  A.eq(r.json.bound, false, 'an unconfigured seam is NOT bound');
  A.eq(r.json.enabled, false, 'and not enabled');
  A.ok(r.json.reason, 'and says why');
  A.ok(Array.isArray(r.json.priority) && r.json.priority.length === 7, 'and publishes the seven-section priority');
}
/* the DEFAULT seam: disabled, unbound, and it names what is missing */
{
  const seam = makeRemoteSeam({ readModel: mkReadModel() });   // isEnabled defaults to false
  const routes = mkRoutes({ seam: seam });
  const r = call(routes, find(routes.routes, '/api/remote/status'), '/api/remote/status');
  A.eq(r.json.bound, false, 'the default seam is not bound');
  A.eq(r.json.enabled, false, 'and not enabled');
  A.ok(r.json.missing.indexOf('exposure') >= 0, 'and names EXPOSURE as missing');
  A.ok(/disabled by default/.test(r.json.reason), 'the reason states it is off by default');
}
/* an ENABLED-but-unwired seam still says bound:false — enabling is not binding */
{
  const seam = makeRemoteSeam({ readModel: mkReadModel(), isEnabled: true });
  const routes = mkRoutes({ seam: seam });
  const r = call(routes, find(routes.routes, '/api/remote/status'), '/api/remote/status');
  A.eq(r.json.enabled, true, 'the seam reports enabled');
  A.eq(r.json.bound, false, 'but still NOT bound — enabling is not binding');
  A.ok(r.json.missing.indexOf('transport') >= 0, 'and names the transport as missing');
}
/* a BOUND seam reports the truth */
{
  const seam = makeRemoteSeam({ readModel: mkReadModel(), isEnabled: true });
  seam.attach({ name: 'test-transport', publish: () => {}, onDecision: () => {} });
  const routes = mkRoutes({ seam: seam });
  const r = call(routes, find(routes.routes, '/api/remote/status'), '/api/remote/status');
  A.eq(r.json.bound, true, 'a bound seam reports bound:true');
  A.eq(r.json.transport, 'test-transport', 'and names the transport');
}

/* ---------- a broken read model surfaces as a 500, not a crash ---------- */
{
  const routes = mkRoutes({ readModel: { summary: () => { throw new Error('boom'); }, oneBusiness: () => { throw new Error('boom'); }, priority: () => [] } });
  const s = call(routes, find(routes.routes, '/api/remote/summary'), '/api/remote/summary');
  A.eq(s.code, 500, 'summary 500s when the read model throws');
  A.ok(/boom/.test(s.json.reason), 'and carries the message');
  const b = call(routes, find(routes.routes, '/api/remote/businesses/acme'), '/api/remote/businesses/acme');
  A.eq(b.code, 500, 'the business read 500s too');
}

/* ---------- refuses to build without its read model ---------- */
{
  A.throws(() => makeRemoteRoutes({}), 'the module refuses to build with no read model');
  A.throws(() => makeRemoteRoutes(), 'and with no deps at all');
}

A.report('remote-routes');
