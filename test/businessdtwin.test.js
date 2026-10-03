'use strict';
/* test/businessdtwin.test.js — Phase 9 DIGITAL TWIN console PURE HALF, tested headless (Business OS §18).

   The console's pure half (formatters, the SIM labelling, the catalog shaper, the step/form validators) is
   Node-loadable without a DOM. These tests prove the honest-rendering rules the browser panel must honour:

     · a simulated figure is ALWAYS accompanied by the recorded basis it came from;
     · an unrecorded metric is NEVER rendered as 0 and is never offered as simulatable;
     · a blank assumption field is REFUSED, never coerced to 0 (which would simulate "everything to zero");
     · a clamped result is marked, not printed as a plain computed value;
     · the console's operation list is IDENTICAL to the engine's — a console offering an op the engine
       refuses (or missing one it accepts) is a bug the user would experience as a mystery 422. */
const A = require('./_assert.js');

// The console is a browser UMD; give it harmless globals so it can be required in Node, then read the pure API.
globalThis.window = globalThis.window || globalThis;
globalThis.document = globalThis.document || { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), getElementById: () => null };
globalThis.StationUI = globalThis.StationUI || { registerWindow: () => {} };

const C = require('../frontend/app/businessdtwin.js');
const Engine = require('../sidecar/business-twin.js');

/* ---------- the pure API is exposed and matches the engine's vocabulary ---------- */
{
  A.ok(typeof C === 'object' && typeof C.fmtValue === 'function', 'the console exports its pure API');
  A.eq(JSON.stringify(C.OP_IDS.slice().sort()), JSON.stringify(Engine.OP_IDS.slice().sort()),
    'the console\'s operation list is IDENTICAL to the engine\'s — a drift here is a mystery 422 for the user');
  // And each op's argument NAME must agree, not just its id.
  for (const id of Engine.OP_IDS) {
    A.eq(C.OPS.filter(o => o.id === id)[0].param, Engine.OPS[id].param,
      'operation "' + id + '" names the same argument in both the console and the engine');
  }
}

/* ---------- value formatting respects the declared unit ---------- */
{
  A.eq(C.fmtValue(0.032, 'rate'), '3.2%', 'a rate is a fraction rendered as a percentage');
  A.eq(C.fmtValue(120, 'count'), '120', 'a count renders as itself');
  A.eq(C.fmtValue(1200, 'currency', 'USD'), '$1,200', 'a currency carries its symbol');
  A.eq(C.fmtValue(null, 'count'), '—', 'an absent value is an em dash, never 0');
  A.eq(C.fmtValue(undefined, 'rate'), '—', 'and so is undefined');
  A.eq(C.fmtValue('nonsense', 'count'), '—', 'and a non-numeric value');
}

/* ---------- deltas are signed and explicit ---------- */
{
  A.eq(C.fmtDelta(24, 'count'), '+24', 'a positive delta carries a +');
  A.eq(C.fmtDelta(-50, 'count'), '-50', 'a negative delta carries a -');
  A.eq(C.fmtDelta(0, 'count'), 'no change', 'a zero delta reads as no change, not "+0"');
  A.eq(C.fmtDelta(0.0064, 'rate'), '+0.6pt', 'a rate delta is in percentage POINTS, not a ratio');
  A.eq(C.fmtDelta(null, 'count'), '—', 'an absent delta is an em dash');
}

/* ---------- THE CORE RULE: a simulated row always carries its recorded basis ---------- */
{
  const row = C.shapeResult({
    metric: 'customers', label: 'Customers', unit: 'count',
    basisValue: 120, basisAt: 1000, basisEvidence: 'verified', basisSource: 'stripe',
    simulated: 144, delta: 24, assumption: 'customers × 1.2', clamped: false
  });
  A.eq(row.isSimulated, true, 'a shaped result row is ALWAYS flagged simulated');
  A.eq(row.basisText, '120', 'and it carries the RECORDED basis as text');
  A.eq(row.simulatedText, '144', 'alongside the simulated figure');
  A.eq(row.deltaText, '+24', 'and the signed delta');
  A.eq(row.assumption, 'customers × 1.2', 'and the assumption in words, so the arithmetic is auditable');
  A.eq(row.basisMissing, false, 'and the basis is present');

  // A row with no basis (should never happen for a simulated row) is rendered as absent, not as 0.
  const noBasis = C.shapeResult({ metric: 'x', unit: 'count', simulated: 5, delta: 5 });
  A.eq(noBasis.basisMissing, true, 'a result with no basis is flagged');
  A.eq(noBasis.basisText, 'not recorded', 'and rendered as "not recorded", NEVER as 0');
}

/* ---------- a clamped assumption is marked, not printed as a computed value ---------- */
{
  const clamped = C.shapeResult({ metric: 'conversion-rate', unit: 'rate', basisValue: 0.032, simulated: 1, delta: 0.968, clamped: true });
  A.eq(clamped.clamped, true, 'the clamped flag survives shaping, so the panel can mark it');
  const normal = C.shapeResult({ metric: 'conversion-rate', unit: 'rate', basisValue: 0.032, simulated: 0.0384, delta: 0.0064, clamped: false });
  A.eq(normal.clamped, false, 'and an unclamped result is not marked');
}

/* ---------- the catalog decides what may be OFFERED ---------- */
{
  const cat = C.shapeCatalog({
    metrics: [
      { metric: 'customers', label: 'Customers', unit: 'count', hasReading: true, basisValue: 120, basisAt: 1000, basisSource: 'stripe' },
      { metric: 'revenue', label: 'Revenue', unit: 'currency', hasReading: false, basisValue: null, basisAt: 0 }
    ]
  }, 1000);
  A.eq(cat.ready.length, 1, 'only metrics WITH a reading are ready to simulate');
  A.eq(cat.ready[0].metric, 'customers', 'and it is the recorded one');
  A.eq(cat.unavailable.length, 1, 'the unrecorded one is listed as unavailable');
  A.eq(cat.unavailable[0].basisText, 'not recorded', 'and its basis reads as absent, not as 0');
  A.eq(cat.unavailable[0].basisValue, null, 'and its numeric basis is null, so a picker cannot mis-use it');
  A.eq(cat.ops.length, 3, 'and the catalog carries the operation set for the form');
}

/* ---------- a blank assumption is REFUSED, never coerced to 0 ---------- */
{
  A.eq(C.buildStep({ metric: 'customers', op: 'multiply', arg: '' }).ok, false,
    'a blank value is refused — Number("") is 0, which would silently simulate "everything to zero"');
  A.eq(C.buildStep({ metric: 'customers', op: 'multiply', arg: null }).ok, false, 'and so is a null value');
  A.eq(C.buildStep({ metric: '', op: 'multiply', arg: 2 }).ok, false, 'a missing metric is refused');
  A.eq(C.buildStep({ metric: 'customers', op: 'bogus', arg: 2 }).ok, false, 'an unknown operation is refused');
  A.eq(C.buildStep({ metric: 'customers', op: 'multiply', arg: 'abc' }).ok, false, 'a non-numeric value is refused');

  const good = C.buildStep({ metric: 'customers', op: 'multiply', arg: '1.2' });
  A.eq(good.ok, true, 'a well-formed assumption is accepted');
  A.eq(JSON.stringify(good.step), JSON.stringify({ metric: 'customers', op: 'multiply', factor: 1.2 }),
    'and it is shaped exactly as the engine expects (op argument name included)');

  // A literal zero IS allowed — it is a real assumption, unlike a blank.
  A.eq(C.buildStep({ metric: 'customers', op: 'set', arg: 0 }).ok, true, 'an explicit 0 is a valid assumption');
}

/* ---------- form validation reports EVERY problem at once ---------- */
{
  const v = C.validateForm({ name: '', steps: [{ metric: '', op: 'multiply', arg: '' }] });
  A.eq(v.ok, false, 'a form with problems is not ok');
  A.ok(v.problems.length >= 2, 'and reports more than one problem, so the user fixes one round trip, not one field per try');
  A.ok(v.problems.some(p => /name/.test(p)), 'naming the missing name');
  A.ok(v.problems.some(p => /assumption 1/.test(p)), 'and pointing at the offending assumption');

  A.eq(C.validateForm({ name: 'x', steps: [] }).ok, false, 'a form with no assumptions is refused');
  A.eq(C.validateForm({ name: 'x', steps: [{ metric: 'customers', op: 'multiply', arg: 2 }] }).ok, true, 'a good form is ok');
}

/* ---------- a scenario is shaped with its failures intact ---------- */
{
  const ok = C.shapeScenario({
    ok: true, name: 'better conversion', label: 'simulation — arithmetic on recorded readings, not a forecast',
    disclaimer: 'This is a what-if...', results: [{ metric: 'customers', unit: 'count', basisValue: 120, simulated: 144, delta: 24 }], failures: []
  });
  A.eq(ok.ok, true, 'a successful scenario shapes as ok');
  A.eq(ok.rows.length, 1, 'with its rows');
  A.ok(/simulation/i.test(ok.label), 'and the simulation label preserved for rendering');
  A.ok(/what-if/.test(ok.disclaimer), 'and the disclaimer preserved');

  const bad = C.shapeScenario({
    ok: false, name: 'mixed', results: [{ metric: 'customers', unit: 'count', basisValue: 120, simulated: 240, delta: 120 }],
    failures: [{ metric: 'revenue', reason: 'no recorded reading for revenue — a simulation needs a real baseline' }]
  });
  A.eq(bad.ok, false, 'a partial scenario shapes as not-ok');
  A.eq(bad.failures.length, 1, 'with its failure named');
  A.ok(/no recorded reading/.test(bad.failures[0].reason), 'including the engine\'s own reason, so the panel never has to invent one');
}

/* ---------- long reasons are bounded, not dropped ---------- */
{
  const long = 'x'.repeat(C.MAX_REASON + 100);
  const shaped = C.shapeScenario({ ok: false, failures: [{ metric: 'm', reason: long }] });
  A.eq(shaped.failures[0].reason.length, C.MAX_REASON, 'an overlong reason is truncated to the bound, never dropped');
}

/* ---------- a comparison shapes one column per scenario plus the shared basis ---------- */
{
  const cmp = C.shapeComparison({
    ok: true,
    scenarios: [{ name: 'half' }, { name: 'double' }],
    metrics: [{ metric: 'customers', label: 'Customers', unit: 'count', basisValue: 100, scenarios: [{ present: true, simulated: 50, delta: -50 }, { present: true, simulated: 200, delta: 100 }] }],
    note: 'Each column is the SAME recorded baseline'
  });
  A.eq(cmp.scenarios.length, 2, 'the comparison names two scenarios');
  A.eq(cmp.metrics[0].basisText, '100', 'and anchors the shared recorded basis');
  A.eq(cmp.metrics[0].cells.length, 2, 'with one cell per scenario');
  A.eq(cmp.metrics[0].cells[0].simulatedText, '50', 'carrying each simulated value');
  A.eq(cmp.metrics[0].cells[1].deltaText, '+100', 'and each signed delta');

  // A metric a scenario did not touch renders as absent for that column, not as a zero.
  const partial = C.shapeComparison({ ok: true, scenarios: [{ name: 'a' }], metrics: [{ metric: 'm', label: 'M', unit: 'count', basisValue: 5, scenarios: [{ present: false }] }] });
  A.eq(partial.metrics[0].cells[0].simulatedText, '—', 'a scenario that did not touch a metric renders as absent, not 0');
}

/* ---------- no banned dialog API may appear in the console source ---------- */
{
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'businessdtwin.js'), 'utf8');
  A.ok(!/window\.(alert|confirm|prompt)\s*\(/.test(src), 'the console uses no banned window.alert/confirm/prompt');
}

/* ---------- the COMPARE hand-off picks only runs that produced results, and NAMES the rest ---------- */
{
  // Three recalled runs, one of which produced no result. Only the two real ones may become columns; the
  // third must be returned BY NAME so the panel can say which one is missing — never silently dropped.
  const picked = C.pickComparable([
    { name: 'half', ok: true, steps: [{ metric: 'customers', op: 'multiply', factor: 0.5 }] },
    { name: 'no baseline', ok: false, steps: [{ metric: 'revenue', op: 'set', value: 1 }] },
    { name: 'double', ok: true, steps: [{ metric: 'customers', op: 'multiply', factor: 2 }] }
  ], r => !!r.ok);
  A.eq(picked.ok, true, 'a comparison over at least one real run is ok');
  A.eq(picked.scenarios.length, 2, 'only the runs that produced results become columns');
  A.eq(picked.scenarios[0].name, 'half', 'and they carry the ONE name their owner gave them');
  A.eq(picked.excluded.length, 1, 'the run with no result is excluded');
  A.eq(picked.excluded[0].name, 'no baseline', 'and it is named, so a missing column is not a silent gap');

  // A run with NO name still gets one — never an empty column header the table cannot be read against.
  const nameless = C.pickComparable([{ ok: true, steps: [] }, { ok: false }], r => !!r.ok);
  A.ok(nameless.scenarios[0].name.length > 0, 'a nameless run is given a readable fallback name, never a blank header');
  A.ok(nameless.excluded[0].name.length > 0, 'and an excluded nameless run is named too');

  // NOTHING comparable -> ok:false, so the panel does not build an empty table that reads as "no change".
  const none = C.pickComparable([{ name: 'x', ok: false }], r => !!r.ok);
  A.eq(none.ok, false, 'a comparison with no comparable run is NOT ok — an empty table must not read as a result');
  A.eq(none.scenarios.length, 0, 'and it carries no columns');

  // Empty / absent input is refused the same way, not thrown on.
  A.eq(C.pickComparable(null, r => !!r.ok).ok, false, 'a null run-list is refused, not thrown on');
  A.eq(C.pickComparable([], () => true).ok, false, 'and an empty run-list produces nothing to compare');
}

/* ---------- a comparison carries its EXCLUDED runs through the shaper ---------- */
{
  const cmp = C.shapeComparison({
    ok: true, scenarios: [{ name: 'a' }], metrics: [],
    excluded: [{ name: 'gone', reason: 'no recorded reading' }], note: 'n'
  });
  A.eq(cmp.excluded.length, 1, 'the shaped comparison keeps the runs that could not be compared');
  A.eq(cmp.excluded[0].name, 'gone', 'named');
  A.ok(/no recorded reading/.test(cmp.excluded[0].reason), 'with the engine\'s own reason, so the panel never invents one');

  // An excluded reason is bounded like every other reason, never dropped.
  const long = C.shapeComparison({ ok: false, excluded: [{ name: 'x', reason: 'y'.repeat(C.MAX_REASON + 50) }] });
  A.eq(long.excluded[0].reason.length, C.MAX_REASON, 'an overlong exclusion reason is truncated to the bound, never dropped');

  // A comparison with no excluded set shapes an EMPTY list, so the panel can test its length without a guard.
  A.eq(C.shapeComparison({ ok: true }).excluded.length, 0, 'a comparison with no exclusions shapes an empty list, not undefined');
}

/* ---------- the COMPARE tab is WIRED, not a dead stub ---------- */
{
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'businessdtwin.js'), 'utf8');
  // The audit found this tab rendered a button and an empty panel while NO frontend file ever called the
  // compare route. These locks fail if the wiring is removed again.
  A.ok(/\/twin\/compare/.test(src), 'the console actually calls POST /twin/compare — COMPARE is not a dead tab');
  A.ok(/function loadComparison/.test(src), 'through a named loader');
  A.ok(/state\.runs/.test(src), 'recalling each successful run so there is something to compare');
  A.ok(/pickComparable\(/.test(src), 'and refusing the runs that produced no result, by name');
  A.ok(!/window\.(alert|confirm|prompt)\s*\(/.test(src), 'still no banned dialog API after the wiring');
}

A.report('businessdtwin');
