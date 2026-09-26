'use strict';
/* factory-routes.test.js — the /api/factory surface (Business OS Phase 12, §22).

   The things this suite exists to catch:

     1. THE ROUTE-MATCHING TRAP, both forms. /api/factory/pipeline reads its business from ?business=, so it
        must be `rx` with the query-tolerant tail (a `qrx` row would leave the match array NULL and 404 every
        lookup while looking correct). /api/factory/stages is parameterless, so it must be `qsplit` — never
        `exact`, which compares the raw url and 404s every ?query variant (the Phase 11 defect).

     2. READ-ONLY. §22's mutations already have their own guarded routes; a POST here would be a second,
        weaker door. The absence of any non-GET row is locked.                                              */

const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const { makeFactoryRoutes, RX_FACTORY_PIPELINE } = require('../sidecar/factory-routes.js');
const { makeSoftwareFactory } = require('../sidecar/software-factory.js');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'factory-routes.js'), 'utf8');

function mkRes() {
  const out = { code: 0, body: null };
  return { out, writeHead(code) { out.code = code; }, end(s) { try { out.body = JSON.parse(s); } catch (e) { out.body = s; } } };
}

/* mirror index.js's dispatch: `exact` compares the RAW url; `qsplit` the stripped path; `rx` fills the match. */
function find(rows, url) {
  const bare = url.split('?')[0];
  for (const r of rows) {
    if (r.exact !== undefined && url === r.exact) return r;
    if (r.qsplit !== undefined && bare === r.qsplit) return r;
    if (r.rx && r.rx.test(url)) return r;
  }
  return null;
}
function call(route, url, method) {
  const r = mkRes();
  const req = { url: url, method: method || 'GET' };
  const gm = route.rx ? route.rx.exec(url) : null;
  route.h(req, r, gm);
  return { code: r.out.code, json: r.out.body };
}

function mkFactory(src) {
  src = src || {};
  const L = (v) => (v === undefined ? undefined : { list: () => v });
  return makeSoftwareFactory({
    opportunities: L(src.opportunities), validations: L(src.validations),
    businesses: src.businesses === undefined ? undefined : { get: () => src.businesses },
    tasks: L(src.tasks), workorders: L(src.workorders)
  });
}
const mkRoutes = (src) => makeFactoryRoutes({ factory: mkFactory(src) });

/* ---------- rows well-formed ---------- */
{
  const { rows } = mkRoutes({});
  A.eq(rows.length, 2, 'two rows');
  for (const r of rows) {
    A.eq(r.m, 'GET', 'every row is GET — the surface is read-only');
    A.ok(typeof r.h === 'function', 'every row has a handler');
  }
  // stages is qsplit, pipeline is rx — and NOTHING uses exact
  A.eq(rows.filter(r => r.qsplit === '/api/factory/stages').length, 1, 'stages is a single qsplit row');
  A.eq(rows.filter(r => r.rx).length, 1, 'exactly one rx row (pipeline)');
  A.eq(rows.filter(r => r.exact !== undefined).length, 0, 'no row uses exact (the query-blind trap)');
  A.eq(rows.filter(r => r.qrx !== undefined).length, 0, 'no row uses qrx (the null-match trap)');
  A.ok(rows[1].rx.source.replace(/\\\//g, '/').indexOf('^/api/factory/pipeline') === 0, 'the pipeline regex is anchored');
}

/* ---------- the query-tolerant regression, both rows ---------- */
{
  const { rows } = mkRoutes({ opportunities: [] });
  for (const url of ['/api/factory/stages?t=1', '/api/factory/pipeline?business=acme&t=1']) {
    A.ok(find(rows, url), url + ' resolves to a row');
  }
  // a stray suffix must NOT match
  A.eq(find(rows, '/api/factory/stages/x'), null, 'stages does not absorb a suffix');
  A.eq(find(rows, '/api/factory/pipelinex'), null, 'pipeline does not absorb a suffix');
}

/* ---------- GET /api/factory/stages ---------- */
{
  const { rows } = mkRoutes({});
  const r = call(find(rows, '/api/factory/stages'), '/api/factory/stages');
  A.eq(r.code, 200, 'stages answers 200');
  A.eq(r.json.ok, true, 'ok');
  A.eq(r.json.stages.length, 8, 'eight stages');
  A.ok(r.json.states.indexOf('unobservable') >= 0, 'the state vocabulary is exposed');
  A.ok(!('score' in r.json) && !('percent' in r.json), 'no score/percent');
}

/* ---------- GET /api/factory/pipeline ---------- */
{
  const { rows } = mkRoutes({
    opportunities: [{ id: 'o1', title: 'Notes app', businessId: 'acme' }],
    validations: [{ verdict: 'supported' }],
    businesses: { id: 'acme', name: 'Acme', stage: 'live' },
    tasks: [{ id: 't1', title: 'Build', status: 'done' }],
    workorders: [{ id: 'w1', intent: 'ship', status: 'done' }]
  });
  const route = find(rows, '/api/factory/pipeline?business=acme');
  const r = call(route, '/api/factory/pipeline?business=acme');
  A.eq(r.code, 200, 'pipeline answers 200');
  A.eq(r.json.ok, true, 'ok');
  A.eq(r.json.stages.length, 8, 'all eight stages come back');
  A.eq(r.json.businessId, 'acme', 'the business is named');
  A.eq(r.json.counts.reached, 8, 'all reached for a complete pipeline');
  A.eq(r.json.currentStage, null, 'no current stage when complete');
}

/* ---------- pipeline with no ?business= → 400 ---------- */
{
  const { rows } = mkRoutes({});
  const r = call(find(rows, '/api/factory/pipeline'), '/api/factory/pipeline');
  A.eq(r.code, 400, 'a pipeline read with no business is a 400');
  A.ok(r.json.reason.indexOf('business') >= 0, 'and says a business is required');
  // even with a stray other query
  const r2 = call(find(rows, '/api/factory/pipeline?x=1'), '/api/factory/pipeline?x=1');
  A.eq(r2.code, 400, 'and still 400 with an unrelated query');
}

/* ---------- pipeline for an unknown business still answers (an empty-but-readable pipeline) ---------- */
{
  const { rows } = mkRoutes({ opportunities: [], validations: [], businesses: null, tasks: [], workorders: [] });
  const r = call(find(rows, '/api/factory/pipeline?business=ghost'), '/api/factory/pipeline?business=ghost');
  A.eq(r.code, 200, 'an unknown business still returns a pipeline (it is a read, not a create)');
  A.eq(r.json.ok, true, 'ok');
  A.eq(r.json.stages[0].state, 'pending', 'idea is pending (readable, empty)');
}

/* ---------- construction guard ---------- */
{
  A.throws(() => makeFactoryRoutes({}), 'no factory → refuses to construct');
}

/* ---------- source-locks ---------- */
{
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  A.ok(!/exact\s*:/.test(CODE), 'no exact row');
  A.ok(!/qrx\s*:/.test(CODE), 'no qrx row');
  A.ok(/const QS = /.test(CODE), 'QS is defined');
  A.ok(SRC.indexOf("new RegExp('^/api/factory/pipeline' + QS)") >= 0, 'the pipeline regex is built from QS');
  A.ok(!/'POST'/.test(CODE), 'no POST anywhere');
}

A.report('factory-routes');
