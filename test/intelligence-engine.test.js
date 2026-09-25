'use strict';
/* test/intelligence-engine.test.js — Phase 7 analytic layer: the honesty guarantees (Business OS §30).

   These tests prove the engine does NOT fabricate. Concrete, executed assertions for:
     · onset / cessation on a zero baseline (no fake percentage)
     · the short-history fallback (baseline = earliest reading, confidence capped at weak)
     · confidence graded by how many readings stand behind the move
     · the portfolio renders a missing contributor as null (never 0), and does NOT sum rates
     · anomaly detection uses median + MAD
     · signals: persistent-trend and single-reading
     · explain() offers a recorded experiment as a STRONG cause, and flags thin sampling — never invents one */
const A = require('./_assert.js');
const E = require('../sidecar/intelligence-engine.js');

const T = 1_700_000_000_000;
const at = (daysAgo) => T - daysAgo * 86400000;

function readingsFn(rows) {
  return (businessId, metricId) =>
    rows.filter(r => r.businessId === businessId && (!metricId || r.metric === metricId));
}
function eng(rows, extra) {
  extra = extra || {};
  return E.makeIntelligenceEngine({
    readings: readingsFn(rows),
    activities: extra.activities || (() => []),
    experiments: extra.experiments || (() => []),
    businesses: extra.businesses || null,
    now: () => T
  });
}

function main() {
  // ---- onset (0 -> x) : no percentage, never pretends a zero baseline moved by X% ----
  const onset = eng([
    { businessId: 'b1', metric: 'revenue', value: 0, at: at(1), evidence: 'verified', source: 'x' },
    { businessId: 'b1', metric: 'revenue', value: 100, at: at(0), evidence: 'verified', source: 'x' }
  ]).change('b1', 'revenue');
  A.eq(onset.direction, 'onset', 'onset direction');
  A.eq(onset.changePct, null, 'onset changePct is null');
  A.ok(!onset.from || onset.from === 0, 'onset from is 0');

  // ---- cessation (x -> 0) ----
  const cess = eng([
    { businessId: 'b1', metric: 'revenue', value: 100, at: at(1), evidence: 'verified', source: 'x' },
    { businessId: 'b1', metric: 'revenue', value: 0, at: at(0), evidence: 'verified', source: 'x' }
  ]).change('b1', 'revenue');
  A.eq(cess.direction, 'cessation', 'cessation direction');
  A.eq(cess.changePct, null, 'cessation changePct is null');

  // ---- short-history fallback: all readings inside the 30d window ----
  const sh = eng([
    { businessId: 'b2', metric: 'revenue', value: 100, at: at(5), evidence: 'verified', source: 'x' },
    { businessId: 'b2', metric: 'revenue', value: 150, at: at(3), evidence: 'verified', source: 'x' },
    { businessId: 'b2', metric: 'revenue', value: 200, at: at(1), evidence: 'verified', source: 'x' }
  ]).change('b2', 'revenue');
  A.eq(sh.shortHistory, true, 'shortHistory flagged');
  A.eq(sh.confidence, 'weak', 'shortHistory confidence capped weak');
  A.ok(/earliest reading/.test(sh.note), 'shortHistory note explains the fallback');

  // ---- confidence grading by evidence depth ----
  // 9 readings spanning >30 days so the comparison is a MATCHED period (not short-history), now >=8 => strong.
  const strong = [];
  for (let i = 0; i < 9; i++) strong.push({ businessId: 'b3', metric: 'revenue', value: 100 + i * 10, at: at(i * 5) });
  A.eq(eng(strong).change('b3', 'revenue').confidence, 'strong', 'strong confidence needs >=8 readings across a real period');

  const weak = [
    { businessId: 'b4', metric: 'revenue', value: 100, at: at(40), evidence: 'verified', source: 'x' },
    { businessId: 'b4', metric: 'revenue', value: 120, at: at(0), evidence: 'verified', source: 'x' }
  ];
  A.eq(eng(weak).change('b4', 'revenue').confidence, 'weak', 'weak confidence under 4 readings');

  // ---- portfolio: missing contributor is null, rates are NOT summed ----
  const pf = eng([
    { businessId: 'p1', metric: 'revenue', value: 100, at: at(1), evidence: 'verified', source: 'x' },
    { businessId: 'p2', metric: 'revenue', value: 200, at: at(1), evidence: 'verified', source: 'x' },
    { businessId: 'p1', metric: 'conversion-rate', value: 0.1, at: at(1), evidence: 'verified', source: 'x' }
  ]).portfolio({ businessIds: ['p1', 'p2'] });
  const rev = pf.metrics.find(m => m.metric === 'revenue');
  A.eq(rev.total, 300, 'revenue total is the sum');
  const cr = pf.metrics.find(m => m.metric === 'conversion-rate');
  A.eq(cr.total, null, 'rate total is null (never summed)');
  A.eq(cr.mean, 0.1, 'rate mean is reported instead');
  A.eq(cr.missing, 1, 'rate missing count');
  A.eq(cr.coverage, 1, 'rate coverage');
  const missing = cr.contributors.find(c => c.businessId === 'p2');
  A.eq(missing.value, null, 'MISSING contributor value is null');

  // ---- anomaly via median + MAD (needs spread, or MAD collapses to 0 and nothing flags) ----
  const ar = [];
  const base = [1000, 1010, 990, 1020, 980, 1005, 995, 1015, 985, 1008];
  for (let i = 0; i < 10; i++) ar.push({ businessId: 'a1', metric: 'visitors', value: base[i], at: at(20 - i) });
  ar.push({ businessId: 'a1', metric: 'visitors', value: 5000, at: at(0) });
  const an = eng(ar).anomalies('a1');
  A.ok(an.length >= 1, 'the outlier is flagged as an anomaly');

  // ---- signals ----
  const sr = [];
  for (let i = 0; i < 8; i++) sr.push({ businessId: 's1', metric: 'revenue', value: 100 + i * 10, at: at(7 - i), evidence: 'verified', source: 'x' });
  sr.push({ businessId: 's1', metric: 'visitors', value: 50, at: at(0), evidence: 'estimate', source: 'x' });
  const kinds = eng(sr).signals('s1').map(s => s.kind);
  A.ok(kinds.indexOf('persistent-trend') >= 0, 'persistent-trend signal fires on a monotonic series');
  A.ok(kinds.indexOf('single-reading') >= 0, 'single-reading signal fires on a lone reading');

  // ---- explain(): a recorded experiment is offered as a STRONG cause ----
  const xr = [];
  for (let i = 0; i < 9; i++) xr.push({ businessId: 'x1', metric: 'revenue', value: 100 + i * 10, at: at(40 - i), evidence: 'verified', source: 'x' });
  xr.push({ businessId: 'x1', metric: 'revenue', value: 300, at: at(0), evidence: 'verified', source: 'x' });
  const exp = (b) => b === 'x1'
    ? [{ id: 'x1~x1', status: 'ended', metrics: ['revenue'], startedAt: at(2), endedAt: at(1) }]
    : [];
  const ex = eng(xr, { experiments: exp }).explain('x1', 'revenue');
  A.ok(ex.causes.some(c => c.kind === 'experiment' && c.confidence === 'strong'), 'experiment measuring the metric => strong cause');
  A.ok(/asserted as the reason/i.test(ex.verdict), 'verdict refuses to assert causation');

  // ---- explain(): thin sampling is flagged, never invented ----
  const tc = eng([
    { businessId: 't1', metric: 'revenue', value: 100, at: at(40), evidence: 'verified', source: 'x' },
    { businessId: 't1', metric: 'revenue', value: 200, at: at(0), evidence: 'verified', source: 'x' }
  ]).explain('t1', 'revenue');
  A.ok(tc.causes.some(c => c.kind === 'sampling'), 'sampling cause is offered for thin data');

  // ---- explain(): unknown metric => 404-level null, no fabricated verdict ----
  A.eq(eng(xr).explain('x1', 'not-a-metric'), null, 'unknown metric explain is null');

  A.report('intelligence-engine: honesty guarantees');
}

main();
