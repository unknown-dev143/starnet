'use strict';
/* test/business-metrics.test.js — the §11 BUSINESS INTELLIGENCE store (Business OS Phase 4).

   THE load-bearing property: an unrecorded metric reads NULL, never 0. "0% churn" is the most flattering lie
   a dashboard can tell, and it is indistinguishable from a metric nobody has measured. So `latest()` returns
   null when there is no reading, `summary()` returns one row per metric with `latest: null`, and the UI prints
   "not recorded" (P2/P7).

   Also locked: §11's 13-metric set is CLOSED; a `rate` metric is a FRACTION (0..1), so 3.2 is a data-entry
   error rather than 320%; a reading needs a source (P1) and an evidence class; the id uses '~' not '#'. */
const A = require('./_assert.js');
const M = require('../sidecar/business-metrics.js');

function store(extra) {
  const saved = [];
  const s = M.makeBusinessMetrics(Object.assign({
    records: [], persist: (rows) => { saved.length = 0; for (const r of rows) saved.push(r); }, now: () => 1000
  }, extra || {}));
  return { s, saved };
}
const reading = (metric, value, extra) => Object.assign({ metric: metric, value: value, source: 'analytics export', evidence: 'verified' }, extra || {});

/* ---------- the closed metric set is §11's thirteen, verbatim ---------- */
{
  const { s } = store();
  A.eq(M.METRICS.length, 13, '§11 names thirteen metrics');
  A.eq(M.METRIC_IDS, ['visitors', 'leads', 'customers', 'conversion-rate', 'revenue', 'profit', 'retention', 'churn', 'cac', 'aov', 'ltv', 'engagement', 'product-usage'], 'the ids match §11 in order');
  A.eq(M.UNITS, ['count', 'rate', 'currency'], 'three unit kinds');
  for (const m of M.METRICS) {
    A.ok(!!m.label, 'metric ' + m.id + ' has a label');
    A.ok(M.UNITS.indexOf(m.unit) >= 0, 'metric ' + m.id + ' has a known unit');
  }
  A.eq(s.EVIDENCE, ['verified', 'analysis', 'assumption', 'estimate', 'prediction', 'unknown'], 'the evidence classes come from the shared vocabulary (opportunities-store)');
}

/* ================= THE HEADLINE: no reading is null, never 0 ================= */
{
  const { s } = store();
  A.eq(s.latest('acme', 'churn'), null, 'latest() for a metric with no reading is NULL, not 0');
  const sum = s.summary('acme');
  A.eq(sum.length, 13, 'summary() returns one row per metric');
  const churn = sum.filter(m => m.metric === 'churn')[0];
  A.eq(churn.latest, null, 'the churn row says latest: null');
  A.eq(churn.readings, 0, 'and zero readings');
  A.ok(churn.latest !== 0, 'specifically NOT the number 0 — which would read as a measured zero churn');
  A.ok(!/^0/.test(String(churn.latest)), 'and nothing renders it as "0"');
}

/* ---------- recording: validation ---------- */
{
  const { s } = store();
  A.eq(s.record('', reading('visitors', 10)).ok, false, 'no businessId -> refused');
  A.eq(s.record('acme', reading('nope', 10)).ok, false, 'an unknown metric is refused (the set is closed)');
  A.ok(/visitors/.test(s.record('acme', reading('nope', 10)).reason), 'and the refusal lists the real metrics');
  A.eq(s.record('acme', reading('visitors', -1)).ok, false, 'a negative count is refused');
  A.eq(s.record('acme', reading('conversion-rate', 3.2)).ok, false, 'a rate above 1 is refused');
  A.ok(/FRACTION/.test(s.record('acme', reading('conversion-rate', 3.2)).reason), 'and explains it is a fraction (0.032, not 3.2)');
  A.eq(s.record('acme', reading('conversion-rate', 0.032)).ok, true, '0.032 is accepted');
  A.eq(s.record('acme', { metric: 'visitors', value: 10, evidence: 'verified' }).ok, false, 'a reading with no source is refused (P1)');
  A.eq(s.record('acme', { metric: 'visitors', value: 10, source: 'x' }).ok, false, 'a reading with no evidence class is refused');
  A.eq(s.record('acme', { metric: 'visitors', value: 10, source: 'x', evidence: 'nope' }).ok, false, 'an unknown evidence class is refused');

  const r = s.record('acme', reading('visitors', 10));
  A.ok(/^acme~k\d+$/.test(r.reading.id), 'the id is <businessId>~k<seq>');
  A.ok(r.reading.id.indexOf('#') < 0, 'and never contains a #');
  A.eq(r.reading.unit, 'count', 'the unit travels with the reading');
}

/* ---------- latest() returns the most recent reading ---------- */
{
  const { s } = store();
  s.record('acme', reading('visitors', 10, { at: 1000 }));
  s.record('acme', reading('visitors', 25, { at: 3000 }));
  s.record('acme', reading('visitors', 20, { at: 2000 }));
  const l = s.latest('acme', 'visitors');
  A.eq(l.value, 25, 'the latest is the one with the greatest `at`, not the last inserted');
  A.eq(s.latest('acme', 'nope'), null, 'an unknown metric has no latest');
  A.eq(s.latest('beta', 'visitors'), null, 'a business with no readings has none either');
}

/* ---------- summary carries the latest value once one exists ---------- */
{
  const { s } = store();
  s.record('acme', reading('churn', 0.05, { at: 1000 }));
  const churn = s.summary('acme').filter(m => m.metric === 'churn')[0];
  A.eq(churn.latest, 0.05, 'the recorded churn now reads 0.05');
  A.eq(churn.readings, 1, 'with one reading');
  A.eq(churn.evidence, 'verified', 'and its evidence class');
  A.eq(churn.source, 'analytics export', 'and its source');
}

/* ---------- series: last reading per bucket + a count, never an average ---------- */
{
  const { s } = store();
  s.record('acme', reading('visitors', 10, { at: 1000 }));
  s.record('acme', reading('visitors', 30, { at: 1500 }));
  s.record('acme', reading('visitors', 20, { at: 2500 }));
  const ser = s.series('acme', 'visitors', { bucketMs: 1000 });
  A.eq(ser.buckets.length, 2, 'two buckets span the readings');
  A.eq(ser.buckets[0].value, 30, 'bucket 0 reports the LAST reading in it (30), not an average of 10 and 30');
  A.eq(ser.buckets[0].readings, 2, 'and how many readings landed there');
  A.eq(ser.buckets[1].value, 20, 'bucket 1 reports 20');
  A.ok(!/avg|mean/.test(JSON.stringify(ser)), 'there is no average the store would have to justify');
  A.eq(s.series('acme', 'nope', {}).buckets, [], 'an unknown metric has an empty series');
}

/* ---------- P6 + remove/clear ---------- */
{
  const { s } = store();
  s.record('acme', reading('visitors', 10));
  s.record('beta', reading('visitors', 99));
  A.eq(s.count('acme'), 1, 'count is per business');
  A.eq(s.latest('beta', 'visitors').value, 99, 'beta keeps its own reading');
  A.eq(s.remove('nope'), { ok: true, removed: 0 }, 'removing an unknown id is a no-op that says so');
  s.clear('acme');
  A.eq(s.count('acme'), 0, 'acme is cleared');
  A.eq(s.count('beta'), 1, 'beta is untouched');
}

/* ---------- persist-before-commit ---------- */
{
  let boom = false;
  const s = M.makeBusinessMetrics({ records: [], persist: () => { if (boom) throw new Error('denied'); }, now: () => 1000 });
  s.record('acme', reading('visitors', 10));
  boom = true;
  A.eq(s.record('acme', reading('visitors', 20)).ok, false, 'a record whose persist throws returns ok:false');
  A.eq(s.count('acme'), 1, 'memory is unchanged');
}

A.report('business-metrics');
