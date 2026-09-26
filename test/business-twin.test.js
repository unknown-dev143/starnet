/* test/business-twin.test.js — §18 BUSINESS DIGITAL TWIN (Business OS Phase 9).

   The engine is PURE and takes its readings through an injected accessor, so this suite proves the
   SCENARIO SEMANTICS with plain arrays — no store, no HTTP, no boot.

   The load-bearing claim of the whole module is the honesty one: it is a SIMULATION over RECORDED numbers,
   never a forecast. Most of what follows exists to pin that, because it is the property a later edit is
   most likely to erode — a "projection" helper added here would be the single most damaging change anyone
   could make, and it would look like a feature. */
'use strict';
const A = require('./_assert.js');
const path = require('path');
const Twin = require(path.join(__dirname, '..', 'sidecar', 'business-twin.js'));

/* A tiny fake metrics store: metricId -> readings. Mirrors business-metrics.js's read shape
   ([{value, at, evidence, source}]) without depending on it. */
function mk(byMetric) {
  const recs = byMetric || {};
  return Twin.makeBusinessTwin({
    readings: (businessId, metricId) => recs[metricId] || []
  });
}
const R = (value, at, extra) => Object.assign({ value: value, at: at || 1000, evidence: 'verified', source: 'test' }, extra || {});

/* ================= the honesty invariant ================= */
{
  const t = mk({ customers: [R(120)] });

  const out = t.simulate('biz', { name: 'x', steps: [{ metric: 'customers', op: 'multiply', factor: 1.2 }] });
  A.ok(out.ok, 'a scenario over a recorded metric simulates');
  A.eq(out.kind, 'simulation', 'the top-level object declares itself a simulation');
  A.ok(/not a forecast|not a prediction/.test(out.disclaimer), 'and carries a disclaimer saying it is not a forecast');
  A.ok(/simulation/i.test(out.label), 'and a human label that says simulation');

  const r = out.results[0];
  A.eq(r.simulatedFlag, true, 'every simulated row is flagged as simulated');
  A.eq(r.kind, 'simulation', 'and carries the kind as well, so a row is self-describing');
  A.eq(r.basisValue, 120, 'the RECORDED basis is returned alongside the result');
  A.eq(r.simulated, 144, 'and the arithmetic is exact (120 x 1.2)');
  A.eq(r.delta, 24, 'the delta is the difference, not a percentage of nothing');
}

/* ---------- the operation set is closed and legible ---------- */
{
  const t = mk({ customers: [R(100)] });

  A.eq(t.simulate('b', { name: 'a', steps: [{ metric: 'customers', op: 'multiply', factor: 2 }] }).results[0].simulated, 200, 'multiply scales');
  A.eq(t.simulate('b', { name: 'a', steps: [{ metric: 'customers', op: 'add', amount: 50 }] }).results[0].simulated, 150, 'add shifts');
  A.eq(t.simulate('b', { name: 'a', steps: [{ metric: 'customers', op: 'set', value: 7 }] }).results[0].simulated, 7, 'set replaces');

  // A free-form formula would let a caller encode an assumption nobody downstream can restate. Refuse it.
  const bad = t.simulate('b', { name: 'a', steps: [{ metric: 'customers', op: 'evaluate', expr: 'x*2' }] });
  A.eq(bad.ok, false, 'an unknown operation is refused, so no formula can be smuggled in');
  A.ok(/unknown operation/.test(bad.failures[0].reason), 'and the refusal names the problem');
  A.ok(/multiply, add, set/.test(bad.failures[0].reason), 'and lists what IS allowed');

  // Every operation names its argument, so a 400 can say WHICH field is missing.
  const noArg = t.simulate('b', { name: 'a', steps: [{ metric: 'customers', op: 'multiply' }] });
  A.eq(noArg.ok, false, 'a multiply with no factor is refused');
  A.ok(/factor/.test(noArg.failures[0].reason), 'and the refusal names the missing field');

  A.eq(t.OP_IDS.length, 3, 'the operation set has exactly three members');
}

/* ---------- CONSTRAINT 1: no recorded reading => no simulation ---------- */
{
  const t = mk({ customers: [R(10)] });

  const out = t.simulate('b', { name: 'x', steps: [{ metric: 'revenue', op: 'multiply', factor: 2 }] });
  A.eq(out.ok, false, 'a scenario over an UNRECORDED metric is refused');
  A.eq(out.results.length, 0, 'and produces no result rows at all');
  A.ok(/no recorded reading/.test(out.failures[0].reason), 'and says the baseline is missing');
  A.ok(/none will be assumed/.test(out.failures[0].reason), 'and is explicit that nothing was invented');

  // The trap this guards: a dashboard rendering an unrecorded metric as 0 and then doubling it.
  const zeroish = t.step('b', { metric: 'revenue', op: 'set', value: 0 });
  A.eq(zeroish.ok, false, 'even an explicit set-to-zero is refused when there is no reading — absent is not zero');

  // An unknown metric id (a typo) must not create a series.
  const typo = t.step('b', { metric: 'customerss', op: 'multiply', factor: 2 });
  A.eq(typo.ok, false, 'an unknown metric is refused, so a typo cannot become a second series');
  A.ok(/closed/.test(typo.reason), "and the refusal says §11's set is closed");
}

/* ---------- an unrecorded metric is offered as such, never as 0 ---------- */
{
  const t = mk({ customers: [R(120)] });
  const cat = t.catalog('b');
  A.eq(cat.kind, 'catalog', 'the catalog describes what can be simulated over');
  const cust = cat.metrics.filter(m => m.metric === 'customers')[0];
  const rev = cat.metrics.filter(m => m.metric === 'revenue')[0];
  A.eq(cust.hasReading, true, 'a recorded metric is marked ready');
  A.eq(cust.basisValue, 120, 'and shows its basis');
  A.eq(rev.hasReading, false, 'an unrecorded metric is marked NOT ready');
  A.eq(rev.basisValue, null, 'and its basis is null, NOT 0 — the interface must grey it out, not offer a fake starting point');
  A.eq(cat.simulatable, 1, 'and the simulatable count reflects it');
  A.eq(cat.total, 13, "with the full §11 metric set listed");
}

/* ---------- CONSTRAINT 4: rates stay bounded, and the clamp is REPORTED ---------- */
{
  const t = mk({ 'conversion-rate': [R(0.032)] });

  const over = t.simulate('b', { name: 'x', steps: [{ metric: 'conversion-rate', op: 'set', value: 3 }] });
  A.eq(over.results[0].simulated, 1, 'a rate simulated above 1.0 is clamped to 1.0 (a rate of 3 is not 300%)');
  A.eq(over.results[0].clamped, true, 'AND THE CLAMP IS REPORTED — never silent');

  const under = t.simulate('b', { name: 'x', steps: [{ metric: 'conversion-rate', op: 'add', amount: -5 }] });
  A.eq(under.results[0].simulated, 0, 'a negative rate is clamped to 0');
  A.eq(under.results[0].clamped, true, 'and reported too');

  // A count is also non-negative in this domain; a negative visitor count is a data error, not a finding.
  const t2 = mk({ customers: [R(10)] });
  const neg = t2.simulate('b', { name: 'x', steps: [{ metric: 'customers', op: 'add', amount: -50 }] });
  A.eq(neg.results[0].simulated, 0, 'a negative count is clamped to 0');
  A.eq(neg.results[0].clamped, true, 'and reported');

  // An unclamped, in-range simulation must report clamped:false so the flag is meaningful.
  const ok = t.simulate('b', { name: 'x', steps: [{ metric: 'conversion-rate', op: 'multiply', factor: 1.2 }] });
  A.eq(ok.results[0].clamped, false, 'an in-range result is NOT flagged as clamped (the flag is informative)');
}

/* ---------- a PARTIAL scenario is a failure, not a partial answer ---------- */
{
  const t = mk({ customers: [R(120)] });
  const out = t.simulate('b', {
    name: 'mixed',
    steps: [
      { metric: 'customers', op: 'multiply', factor: 2 },
      { metric: 'revenue', op: 'multiply', factor: 2 }     // no reading
    ]
  });
  A.eq(out.ok, false, 'one unsimulatable step makes the whole scenario not-ok');
  A.eq(out.results.length, 1, 'the simulatable step is still returned (the work is not thrown away)');
  A.eq(out.failures.length, 1, 'and the failure is named');
  A.eq(out.stepCount, 2, 'the step count reports the request, not the success count');
  A.eq(out.simulatedCount, 1, 'and simulatedCount reports what actually ran — the two must not be conflated');
}

/* ---------- bounds ---------- */
{
  const t = mk({ customers: [R(1)] });
  const many = [];
  for (let i = 0; i < Twin.MAX_STEPS + 1; i++) many.push({ metric: 'customers', op: 'add', amount: 1 });
  A.eq(t.simulate('b', { name: 'big', steps: many }).ok, false, 'a scenario over the step bound is refused');

  const empty = t.simulate('b', { name: 'none', steps: [] });
  A.eq(empty.ok, false, 'an empty scenario is refused rather than returning an empty success');
  A.ok(/at least one step/.test(empty.reason), 'and says why');
}

/* ---------- compare: one shared baseline, no ranking ---------- */
{
  const t = mk({ customers: [R(100)] });
  const cmp = t.compare('b', [
    { name: 'half', steps: [{ metric: 'customers', op: 'multiply', factor: 0.5 }] },
    { name: 'double', steps: [{ metric: 'customers', op: 'multiply', factor: 2 }] }
  ]);
  A.ok(cmp.ok, 'a two-scenario comparison succeeds');
  A.eq(cmp.kind, 'comparison', 'and declares itself a comparison');

  const row = cmp.metrics.filter(m => m.metric === 'customers')[0];
  A.eq(row.basisValue, 100, 'the RECORDED baseline is anchored in the row, so deltas are commensurable');
  A.eq(row.scenarios[0].simulated, 50, 'scenario 1 carries the shared baseline through its own assumption');
  A.eq(row.scenarios[1].simulated, 200, 'scenario 2 does too');
  A.eq(row.scenarios[0].delta, -50, 'and each delta is against the RECORDED value, not against the other scenario');

  // No ranking, no winner: choosing is the owner's call (P5).
  A.eq(cmp.best, undefined, 'the comparison names no "best" scenario — choosing is the owner\'s call');
  A.eq(cmp.winner, undefined, 'and no winner');
  A.ok(/SAME recorded baseline/.test(cmp.note), 'and the note explains that the baseline is shared');

  A.eq(t.compare('b', []).ok, false, 'an empty comparison is refused');
  const tooMany = [];
  for (let i = 0; i < Twin.MAX_SCENARIOS + 1; i++) tooMany.push({ name: 's' + i, steps: [{ metric: 'customers', op: 'add', amount: 1 }] });
  A.eq(t.compare('b', tooMany).ok, false, 'a comparison over the scenario bound is refused');
}

/* ---------- the engine cannot crash the host ---------- */
{
  const noReadings = Twin.makeBusinessTwin({});                 // accessor absent
  A.eq(noReadings.simulate('b', { name: 'x', steps: [{ metric: 'customers', op: 'multiply', factor: 2 }] }).ok, false,
    'with no readings accessor wired the engine refuses rather than throwing');
  A.eq(noReadings.catalog('b').metrics.length, 13, 'and the catalog still lists the metric set (all not-ready)');

  const thrower = Twin.makeBusinessTwin({ readings: () => { throw new Error('store exploded'); } });
  A.eq(thrower.step('b', { metric: 'customers', op: 'multiply', factor: 2 }).ok, false,
    'a throwing readings accessor is contained, not propagated');

  const t = mk({ customers: [R(5)] });
  A.eq(t.simulate('b', null).ok, false, 'a null scenario is refused');
  A.eq(t.simulate('b', {}).ok, false, 'an empty scenario object is refused');
  A.eq(t.simulate('b', { name: 'x', steps: [null] }).ok, false, 'a null step is refused, not crashed on');
}

/* ---------- determinism: the same inputs give byte-identical output ---------- */
{
  const t = mk({ customers: [R(120, 5000)], 'conversion-rate': [R(0.03, 6000)] });
  const sc = { name: 'd', steps: [{ metric: 'customers', op: 'multiply', factor: 1.5 }, { metric: 'conversion-rate', op: 'add', amount: 0.01 }] };
  A.eq(JSON.stringify(t.simulate('b', sc)), JSON.stringify(t.simulate('b', sc)),
    'the same scenario over the same readings produces identical output (no clock, no rng)');
}

/* ---------- the LATEST reading is the basis, not an average ---------- */
{
  const t = mk({ customers: [R(10, 1000), R(50, 3000), R(30, 2000)] });   // out of order on purpose
  const r = t.step('b', { metric: 'customers', op: 'multiply', factor: 2 });
  A.eq(r.basisValue, 50, 'the basis is the reading with the GREATEST at (3000), even when the array is out of order');
  A.eq(r.basisAt, 3000, 'and its timestamp is carried through');
  A.eq(r.simulated, 100, 'so the arithmetic uses the latest recorded value');
  // An average of (10,50,30) would be 30 — proving the choice, not just the outcome.
  A.ok(r.basisValue !== 30, 'and it is explicitly NOT the mean of the readings');
}

A.report('business-twin');
