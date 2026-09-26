'use strict';
/* test/twin-routes.test.js — the §18 Digital Twin HTTP surface (Business OS Phase 9).

   Exercised with FAKE req/res, because index.js self-boots and cannot be require()d — the handlers take
   readBody/respondJson by injection precisely so this is possible.

   The load-bearing behaviours:
     · the route table is well-formed and free of the `qrx` trap that 404s every business-scoped lookup;
     · the MORE SPECIFIC paths (/twin/simulate, /twin/compare) are not swallowed by the bare /twin regex;
     · a business that does not exist is a 404, never an empty simulation;
     · a scenario that cannot be fully simulated is a 422, not a 200 with a quiet hole in it;
     · the twin STORES NOTHING — the only durable side effect is one activity-trail entry;
     · every emitted payload is schema-VALID (the real bus silently drops an invalid one);
     · a thrown activity store or emit NEVER vetoes an answer that was already computed.

   The twin is built from the REAL engine with fake readings, so this suite tests the route layer against
   real scenario semantics rather than a stub. */
const A = require('./_assert.js');
const {
  makeTwinRoutes,
  RX_BIZ_TWIN, RX_BIZ_TWIN_SIMULATE, RX_BIZ_TWIN_COMPARE
} = require('../sidecar/twin-routes.js');
const { makeBusinessTwin } = require('../sidecar/business-twin.js');
const { makeBusinessesStore } = require('../sidecar/businesses-store.js');
const { makeBusinessActivityStore } = require('../sidecar/business-activity-store.js');
const EVENTS = require('../shared/events.js');
const fs = require('fs');
const path = require('path');

function fakeRes() {
  return {
    code: null, body: null, headers: null,
    writeHead(c, h) { this.code = c; this.headers = h; return this; },
    end(s) { this.body = s; }
  };
}
function fakeReq(method, url, body) {
  return { method, url, _body: body === undefined ? '' : (typeof body === 'string' ? body : JSON.stringify(body)) };
}
async function readBody(req) { return req._body || ''; }

function harness(extra) {
  const businesses = makeBusinessesStore({ records: [], persist: () => {}, now: () => 1000 });
  const activity = makeBusinessActivityStore({ records: [], persist: () => {}, now: () => 1000 });
  const byMetric = { customers: [{ value: 120, at: 1000, evidence: 'verified', source: 'test' }], 'conversion-rate': [{ value: 0.032, at: 1000, evidence: 'verified', source: 'test' }] };
  const twin = makeBusinessTwin({ readings: (b, m) => byMetric[m] || [] });
  const seen = [];
  const R = makeTwinRoutes(Object.assign({
    twin, businesses, activity, readBody,
    emit: (name, payload) => seen.push({ name, payload })
  }, extra || {}));
  const biz = (name) => businesses.create({ name }).business;
  return { R, businesses, activity, twin, seen, biz, byMetric };
}

/* Mirrors index.js's dispatch asymmetry EXACTLY: an `rx` row matches the FULL url and FILLS the match array;
   a `qrx` row tests the query-stripped path and leaves the match array NULL. Getting this wrong is how the
   original `qrx` bug hid — a test that "fixes" the helper to pass bare to rx would stop catching it. */
async function call(R, method, url, body) {
  const res = fakeRes();
  const bare = String(url).split('?')[0];
  const hit = R.rows.filter(r => (Array.isArray(r.m) ? r.m.indexOf(method) >= 0 : r.m === method))
    .filter(r => (r.exact !== undefined ? url === r.exact
      : (r.rx ? !!String(url).match(r.rx) : (r.qrx ? !!bare.match(r.qrx) : false))))[0];
  if (!hit) throw new Error('no route for ' + method + ' ' + url);
  const m = hit.rx ? String(url).match(hit.rx) : null;
  await hit.h(fakeReq(method, url, body), res, m);
  return { code: res.code, json: res.body ? JSON.parse(res.body) : null };
}

(async () => {
  /* ---------- the route rows index.js will mount are well-formed ---------- */
  {
    const { R } = harness();
    A.eq(R.rows.length, 3, 'the module exposes 3 route rows');
    for (const row of R.rows) {
      A.ok(!!row.m && typeof row.h === 'function', 'each row has a method and a handler');
      const matchers = ['exact', 'qsplit', 'prefix', 'qprefix', 'rx', 'qrx'].filter(k => row[k] !== undefined);
      A.eq(matchers.length, 1, 'each row carries exactly ONE match key (' + matchers.join('/') + ')');
      A.ok(row.qrx === undefined, 'and NEVER qrx — the matcher that leaves match===null');
    }
    A.ok(RX_BIZ_TWIN_SIMULATE.test('/api/businesses/acme/twin/simulate'), 'RX_BIZ_TWIN_SIMULATE matches');
    A.ok(RX_BIZ_TWIN_COMPARE.test('/api/businesses/acme/twin/compare'), 'RX_BIZ_TWIN_COMPARE matches');
    A.ok(RX_BIZ_TWIN.test('/api/businesses/acme/twin'), 'RX_BIZ_TWIN matches');
    // The specific-before-general ordering, asserted on the REGEXES themselves: if the bare /twin regex
    // swallowed /twin/simulate, the simulate row could never fire.
    A.ok(!RX_BIZ_TWIN.test('/api/businesses/acme/twin/simulate'), 'RX_BIZ_TWIN does not swallow /twin/simulate');
    A.ok(!RX_BIZ_TWIN.test('/api/businesses/acme/twin/compare'), 'RX_BIZ_TWIN does not swallow /twin/compare');
    // Rows are ORDERED most-specific-first, which is what makes the dispatch above correct.
    A.ok(RX_BIZ_TWIN_SIMULATE.test('/api/businesses/acme/twin/simulate'), 'and the simulate regex is the one that claims it');

    // A query tail must not defeat any of the three (the reason for the QS tail).
    A.ok(RX_BIZ_TWIN.test('/api/businesses/acme/twin?x=1'), 'the catalog regex tolerates a query tail');
    A.ok(RX_BIZ_TWIN_SIMULATE.test('/api/businesses/acme/twin/simulate?dry=1'), 'so does simulate');

    // SOURCE LOCK: no qrx anywhere in this module, asserted against the file text so a future edit fails
    // here rather than 404ing in production.
    const src = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'twin-routes.js'), 'utf8');
    const lines = src.split('\n');
    A.ok(!lines.some(l => /qrx\s*:/.test(l) && /\(/.test(l)), 'twin-routes.js has no qrx matcher that captures a path segment');
  }

  /* ---------- the catalog ---------- */
  {
    const h = harness();
    h.biz('Acme');
    const r = await call(h.R, 'GET', '/api/businesses/acme/twin');
    A.eq(r.code, 200, 'GET /twin is 200');
    A.ok(r.json.ok, 'and ok');
    A.eq(r.json.catalog.businessId, 'acme', 'and scoped to the business');
    A.eq(r.json.catalog.simulatable, 2, 'reporting the two metrics that actually have readings');
    /* An unrecorded metric reports basisValue null, never 0 — the difference between "we have no reading"
       and "the reading was zero", which is the whole point of the metrics store's rule 2. Asserted on the
       parsed values rather than the raw JSON text, because "basisValue":0.032 also CONTAINS the substring
       "basisValue":0 and a substring test would pass for the wrong reason. */
    const unread = r.json.catalog.metrics.filter(m => !m.hasReading);
    A.eq(unread.length, 11, 'eleven metrics have no reading');
    A.ok(unread.every(m => m.basisValue === null), 'and every one of them reports basisValue null, not 0');
  }

  /* ---------- simulate: the happy path ---------- */
  {
    const h = harness();
    h.biz('Acme');
    const r = await call(h.R, 'POST', '/api/businesses/acme/twin/simulate',
      { name: 'better conversion', steps: [{ metric: 'conversion-rate', op: 'multiply', factor: 1.2 }] });
    A.eq(r.code, 200, 'a valid scenario is 200');
    A.eq(r.json.kind, 'simulation', 'and the response declares itself a simulation');
    A.eq(r.json.results[0].simulated, 0.0384, 'with the arithmetic carried through');
    A.eq(r.json.results[0].basisValue, 0.032, 'and the recorded basis alongside it');

    // The event fired, with counts and the scenario name — never a simulated number.
    A.eq(h.seen.length, 1, 'exactly one event was emitted');
    A.eq(h.seen[0].name, 'business.twin.simulated', 'named business.twin.simulated');
    A.ok(EVENTS.validate(h.seen[0].name, h.seen[0].payload).ok, 'and its payload is schema-VALID');
    A.eq(h.seen[0].payload.mode, 'simulate', 'carrying the mode');
    A.ok(!JSON.stringify(h.seen[0].payload).includes('0.0384'), 'and the emitted payload carries NO simulated number');

    // The durable side effect: one activity entry, naming the scenario but not the numbers.
    const rows = h.activity.list('acme');
    A.eq(rows.length, 1, 'one activity entry was recorded');
    A.eq(rows[0].action, 'twin.simulate', 'named twin.simulate');
    A.ok(/better conversion/.test(rows[0].detail), 'naming the scenario');
    A.ok(!/0\.0384/.test(rows[0].detail), 'and the activity detail carries no simulated number either');
  }

  /* ---------- simulate: the refusal paths are distinct codes ---------- */
  {
    const h = harness();
    h.biz('Acme');
    const noSteps = await call(h.R, 'POST', '/api/businesses/acme/twin/simulate', { name: 'x' });
    A.eq(noSteps.code, 400, 'a scenario with no steps is a 400');

    const badJson = await call(h.R, 'POST', '/api/businesses/acme/twin/simulate', '{not json');
    A.eq(badJson.code, 400, 'a non-JSON body is a 400');
    A.ok(/JSON/.test(badJson.json.reason), 'and says so');

    const noBase = await call(h.R, 'POST', '/api/businesses/acme/twin/simulate',
      { name: 'x', steps: [{ metric: 'revenue', op: 'multiply', factor: 2 }] });
    A.eq(noBase.code, 422, 'a scenario over an unrecorded metric is a 422, NOT a 200 with a hole');
    A.eq(noBase.json.ok, false, 'and ok is false');
    A.ok(/no recorded reading/.test(noBase.json.failures[0].reason), 'naming the missing baseline');
    A.eq(h.seen.length, 0, 'and a failed scenario emits NOTHING — a simulation that did not run is not an event');
  }

  /* ---------- compare ---------- */
  {
    const h = harness();
    h.biz('Acme');
    const r = await call(h.R, 'POST', '/api/businesses/acme/twin/compare',
      { scenarios: [{ name: 'a', steps: [{ metric: 'customers', op: 'multiply', factor: 1.5 }] },
                    { name: 'b', steps: [{ metric: 'customers', op: 'multiply', factor: 2 }] }] });
    A.eq(r.code, 200, 'a valid comparison is 200');
    A.eq(r.json.kind, 'comparison', 'and declares itself a comparison');
    A.eq(r.json.metrics[0].basisValue, 120, 'anchored on the recorded baseline');
    A.eq(r.json.metrics[0].scenarios.length, 2, 'with one column per scenario');
    A.eq(h.seen[0].payload.mode, 'compare', 'and the event carries mode=compare');
    A.ok(EVENTS.validate('business.twin.simulated', h.seen[0].payload).ok, 'with a schema-VALID payload');
    A.eq(h.activity.list('acme')[0].action, 'twin.compare', 'and the activity entry distinguishes a comparison');

    const none = await call(h.R, 'POST', '/api/businesses/acme/twin/compare', {});
    A.eq(none.code, 400, 'a comparison with no scenarios is a 400');
  }

  /* ---------- P6: a business that is not there is a 404 on every route ---------- */
  {
    const h = harness();
    h.biz('Acme');
    for (const [m, u] of [['GET', '/api/businesses/ghost/twin'],
                          ['POST', '/api/businesses/ghost/twin/simulate'],
                          ['POST', '/api/businesses/ghost/twin/compare']]) {
      const r = await call(h.R, m, u, { name: 'x', steps: [{ metric: 'customers', op: 'multiply', factor: 2 }], scenarios: [{ name: 'x', steps: [] }] });
      A.eq(r.code, 404, m + ' ' + u + ' is a 404 for an unknown business');
    }
    // The seeding business still works, so the 404 is the guard and not a broken harness.
    const ok = await call(h.R, 'GET', '/api/businesses/acme/twin');
    A.eq(ok.code, 200, 'while the real business still answers (the 404 is the guard, not a dead harness)');
  }

  /* ---------- the twin STORES NOTHING (except the one audit entry) ---------- */
  {
    const h = harness();
    h.biz('Acme');
    const before = JSON.stringify(h.byMetric);
    await call(h.R, 'POST', '/api/businesses/acme/twin/simulate',
      { name: 'x', steps: [{ metric: 'customers', op: 'multiply', factor: 9 }] });
    A.eq(JSON.stringify(h.byMetric), before, 'the readings are byte-identical after a simulation — the twin never writes a metric');
    A.eq(h.activity.list('acme').length, 1, 'and the only durable artifact is the single audit entry');
    A.eq(h.activity.list('acme')[0].result, 'ok', 'recorded as an ok result');
  }

  /* ---------- a broken activity store or emitter never vetoes an answer ---------- */
  {
    const h = harness({ activity: { append: () => { throw new Error('disk full'); } } });
    h.biz('Acme');
    const r = await call(h.R, 'POST', '/api/businesses/acme/twin/simulate',
      { name: 'x', steps: [{ metric: 'customers', op: 'multiply', factor: 2 }] });
    A.eq(r.code, 200, 'a thrown activity append does NOT veto the computed answer');
    A.eq(r.json.results[0].simulated, 240, 'and the arithmetic is still returned intact');

    const h2 = harness({ emit: () => { throw new Error('bus down'); } });
    h2.biz('Acme');
    const r2 = await call(h2.R, 'POST', '/api/businesses/acme/twin/simulate',
      { name: 'x', steps: [{ metric: 'customers', op: 'multiply', factor: 2 }] });
    A.eq(r2.code, 200, 'a thrown emit does NOT veto the answer either');
    A.eq(r2.json.results[0].simulated, 240, 'and the answer is intact');
  }

  /* ---------- the module refuses to build without its engine ---------- */
  {
    A.throws(() => makeTwinRoutes({ readBody }), 'the routes refuse to build with no twin engine');
    A.throws(() => makeTwinRoutes({ twin: harness().twin }), 'and refuse to build with no readBody');
  }

  /* ---------- a query tail on a POST path still routes (the QS tail) ---------- */
  {
    const h = harness();
    h.biz('Acme');
    const r = await call(h.R, 'POST', '/api/businesses/acme/twin/simulate?verbose=1',
      { name: 'x', steps: [{ metric: 'customers', op: 'multiply', factor: 2 }] });
    A.eq(r.code, 200, 'a POST carrying a query string still reaches the handler');
    A.eq(r.json.results[0].simulated, 240, 'and works');
  }

  A.report('twin-routes');
})().catch(e => { console.error('twin-routes.test CRASHED:', (e && e.stack) || e); process.exit(1); });
