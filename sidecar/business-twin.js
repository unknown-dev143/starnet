/* sidecar/business-twin.js — §18 BUSINESS DIGITAL TWIN, the SCENARIO layer (Business OS Phase 9).

   §18 is the one whole feature the brief names that had NO implementation. The audit recorded the reason
   it is the hardest to build honestly, and that reason is the design:

       A DIGITAL TWIN IS NOT A FORECASTER. A "twin" that projects next quarter's revenue from three
       readings is a prediction with a decimal point, and this codebase's governing rule is P7 — no fake
       intelligence. §11 already says the AI "may explain changes ... without pretending certainty"; a
       simulation that invented the future would be pretending certainty about something that has not
       happened, which is strictly worse than pretending it about something that has.

   So the twin runs BACKWARD, not forward. It takes readings a business ACTUALLY recorded and asks one
   question: "if this explicit assumption had held, what would these SAME recorded numbers have been?"

       baseline: recorded conversion-rate 0.032, recorded customers 120
       scenario: { metric: 'conversion-rate', op: 'multiply', value: 1.2 }   // "20% better conversion"
       result:   simulated conversion-rate 0.0384, simulated customers 144
                 delta: +24 customers — ARITHMETIC on two inputs a reader can check

   Every number it returns is either (a) a recorded value read back, or (b) that value carried through the
   operation the caller named. It computes no trend, no projection, no "runway", no probability. `at` is
   carried through unchanged, so a simulated row is never dated in the future.

   FOUR STRUCTURAL CONSTRAINTS, each of which exists to stop a specific lie:

     1. NO RECORDED READING, NO SIMULATION. A scenario over a metric with no reading returns
        `{ ok:false }` naming the missing metric — never a zero baseline presented as a starting point.
        (This is business-metrics.js's rule 2, `latest()` returns null not 0, carried into the twin.)

     2. THE OPERATION IS A CLOSED SET with an explicit display string. `multiply` / `add` / `set` — no
        free-form formula, because an expression evaluator would let a caller write a rule nobody can read
        back. Every step carries `label` ("conversion-rate x 1.2") so the assumption is auditable in words.

     3. A SIMULATION IS LABELLED AS ONE, PERVASIVELY. Every result object carries `kind:'simulation'`,
        every simulated row carries `simulated:true` and `basis` (the reading it came from). A downstream
        consumer cannot render one as a measurement without deleting a field first.

     4. RATES STAY BOUNDED. This module delegates the metric vocabulary and unit rules to
        business-metrics.js (P4 — one definition of the metric set, not a second copy). A `rate` metric
        simulated above 1.0 is CLAMPED and the clamp is REPORTED (`clamped:true`), because a conversion
        rate of 3 is not 300% — it is a request to state something impossible, and silently returning it
        would poison every average downstream exactly as the metrics store refuses to.

   WHAT IT DELIBERATELY DOES NOT DO: it does not chain one scenario into another's baseline (no compounding
   guesses piling on guesses), it does not compare scenarios into a "best" one (choosing is the owner's call,
   P5), and it stores nothing. `compare()` runs N scenarios against the SAME recorded baseline so the deltas
   are commensurable, and returns them side by side for the owner to read.

   PURE: no IO, no clock, no env, no rng. Reads arrive through an injected accessor. UMD. Mirrors
   intelligence-engine.js. */
'use strict';
(function (root, factory) {
  const mod = (typeof module !== 'undefined' && module.exports);
  const metricsMod = mod
    ? require('./business-metrics.js')
    : (root.SK && root.SK.businessMetrics) || null;
  const api = factory(metricsMod);
  if (mod) module.exports = api;
  else { (root.SK = root.SK || {}).businessTwin = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (MetricsMod) {
  'use strict';

  const METRICS = (MetricsMod && MetricsMod.METRICS) || [];
  const METRIC_IDS = (MetricsMod && MetricsMod.METRIC_IDS) || [];

  /* THE OPERATION SET. Closed, and each one is a plain arithmetic sentence a reader can verify by hand.
     There is no expression parser here on purpose: a caller with a formula string could encode an
     assumption nobody downstream can restate, and the whole value of this layer is that the assumption is
     legible. `param` names the numeric argument so a 400 can say which field is missing. */
  const OPS = {
    multiply: { id: 'multiply', verb: 'x',        param: 'factor',  note: 'scale by a factor' },
    add:      { id: 'add',      verb: '+',        param: 'amount',  note: 'shift by an amount' },
    set:      { id: 'set',      verb: '=',        param: 'value',   note: 'replace with a value' }
  };
  const OP_IDS = Object.keys(OPS);

  // How many scenarios one comparison may hold. A bound, not a policy: an unbounded list is a place for a
  // caller to hide a workload, and 12 is more than anyone reads side by side.
  const MAX_SCENARIOS = 12;
  // How many metric steps one scenario may carry, same reason.
  const MAX_STEPS = 24;
  const MAX_TEXT = 400;

  function num(v) { const n = Number(v); return isFinite(n) ? n : null; }
  function round(n, p) { const f = Math.pow(10, p == null ? 6 : p); return Math.round(n * f) / f; }
  function str(v) { return v == null ? '' : String(v); }
  function clip(s, n) { const t = str(s); return t.length > (n || MAX_TEXT) ? t.slice(0, n || MAX_TEXT) : t; }
  function byId(id) { const s = str(id); return METRICS.filter(m => m.id === s)[0] || null; }

  function makeBusinessTwin(opts) {
    opts = opts || {};
    /* ONE INJECTED ACCESSOR, the same shape intelligence-engine.js takes: (businessId, metricId) ->
       [{value, at, evidence, source}]. Optional and guarded, so the engine is testable with plain arrays
       and cannot crash the host when the metrics layer is absent. */
    const readings = typeof opts.readings === 'function' ? opts.readings : null;

    function list(businessId, metricId) {
      if (!readings) return [];
      try {
        const rows = readings(businessId, metricId);
        return Array.isArray(rows) ? rows.filter(r => r && isFinite(Number(r.value))) : [];
      } catch (_) { return []; }
    }
    /* The LATEST recorded reading, or null. Not zero, not an average — the same rule the metrics store
       enforces at its own boundary, applied again here because this is a second reader of the same data. */
    function latest(businessId, metricId) {
      const rows = list(businessId, metricId);
      if (!rows.length) return null;
      const ordered = rows.slice().sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0));
      return ordered[ordered.length - 1];
    }

    /* ---- ONE STEP ---------------------------------------------------------------------------------
       Apply one operation to one recorded reading. Returns a RESULT OBJECT, never a bare number, so the
       caller always has the basis and the provenance alongside the value. */
    function step(businessId, s) {
      s = s || {};
      const def = byId(s.metric);
      if (!def) {
        return { ok: false, reason: 'unknown metric: ' + clip(s.metric || '(none)') + " — §11's set is closed",
                 metric: str(s.metric) };
      }
      const base = latest(businessId, def.id);
      if (!base) {
        /* CONSTRAINT 1. A scenario over an unrecorded metric is a request to simulate from nothing. */
        return { ok: false, reason: 'no recorded reading for ' + def.id + ' — a simulation needs a real baseline, and none will be assumed',
                 metric: def.id };
      }
      const op = OPS[str(s.op)];
      if (!op) {
        return { ok: false, reason: 'unknown operation: ' + clip(s.op || '(none)') + ' — allowed: ' + OP_IDS.join(', '),
                 metric: def.id };
      }
      const arg = num(s[op.param]);
      if (arg == null) {
        return { ok: false, reason: 'operation "' + op.id + '" needs a numeric "' + op.param + '"',
                 metric: def.id };
      }

      const basisValue = Number(base.value);
      let out = basisValue;
      if (op.id === 'multiply') out = basisValue * arg;
      else if (op.id === 'add') out = basisValue + arg;
      else if (op.id === 'set') out = arg;

      /* CONSTRAINT 4. A rate is a fraction bounded 0..1. Clamp, and REPORT the clamp rather than hiding it:
         a silently-clamped result reads as "we simulated it and got 1.0", when the truth is "the assumption
         demanded something impossible and we stopped at the edge of the definition". */
      let clamped = false;
      if (def.unit === 'rate') {
        if (out > 1) { out = 1; clamped = true; }
        else if (out < 0) { out = 0; clamped = true; }
      }
      // A count or a currency is non-negative in this domain too; a negative visitor count is a data error.
      if (def.unit !== 'rate' && out < 0) { out = 0; clamped = true; }

      out = round(out, 6);
      const delta = round(out - basisValue, 6);
      return {
        ok: true,
        kind: 'simulation',
        metric: def.id,
        label: def.label,
        unit: def.unit,
        op: op.id,
        assumption: def.id + ' ' + op.verb + ' ' + arg,
        arg: arg,
        /* THE RECORDED INPUT, named, so the arithmetic is checkable: a reader sees basisValue, arg, and
           result and can confirm the relation without trusting this module. */
        basisValue: basisValue,
        basisAt: Number(base.at) || 0,
        basisEvidence: str(base.evidence),
        basisSource: str(base.source),
        simulated: out,
        simulatedValue: out,
        delta: delta,
        clamped: clamped,
        simulatedFlag: true
      };
    }

    /* ---- ONE SCENARIO -----------------------------------------------------------------------------
       A named list of steps over one business's recorded readings. `ok` is false if ANY step could not be
       simulated, because a partial scenario presented as a whole is the failure mode this guards: a reader
       who sees nine of ten numbers move would reasonably believe the tenth was unremarkable. */
    function simulate(businessId, scenario) {
      scenario = scenario || {};
      const name = clip(scenario.name || 'scenario', 120);
      const steps = Array.isArray(scenario.steps) ? scenario.steps : [];
      if (!steps.length) {
        return { ok: false, kind: 'simulation', name: name, reason: 'a scenario needs at least one step',
                 results: [] };
      }
      if (steps.length > MAX_STEPS) {
        return { ok: false, kind: 'simulation', name: name,
                 reason: 'a scenario may carry at most ' + MAX_STEPS + ' steps', results: [] };
      }
      const results = [];
      const failures = [];
      for (let i = 0; i < steps.length; i++) {
        const r = step(businessId, steps[i]);
        if (r.ok) results.push(r);
        else failures.push({ index: i, metric: r.metric || '', reason: r.reason });
      }
      return {
        ok: failures.length === 0,
        kind: 'simulation',
        businessId: str(businessId),
        name: name,
        note: clip(scenario.note || ''),
        results: results,
        failures: failures,
        stepCount: steps.length,
        simulatedCount: results.length,
        /* A scenario is a SIMULATION and says so at the top level as well as on every row — a consumer that
           renders the object without descending into `results` still cannot mistake it for a measurement. */
        label: 'simulation — arithmetic on recorded readings, not a forecast',
        disclaimer: 'This is a what-if over numbers the business actually recorded. It is not a prediction: no value here is dated after its recorded basis, and no reading was invented.'
      };
    }

    /* ---- COMPARE ----------------------------------------------------------------------------------
       N scenarios against the SAME recorded baseline, side by side. Deliberately does NOT rank them or
       pick a winner (P5 — choosing is the owner's call). It returns rows that line up: one row per metric,
       one column per scenario, plus the recorded baseline in the first column so every delta is anchored. */
    function compare(businessId, scenarios) {
      const listIn = Array.isArray(scenarios) ? scenarios : [];
      if (!listIn.length) {
        return { ok: false, kind: 'comparison', reason: 'a comparison needs at least one scenario', metrics: [] };
      }
      if (listIn.length > MAX_SCENARIOS) {
        return { ok: false, kind: 'comparison',
                 reason: 'a comparison may hold at most ' + MAX_SCENARIOS + ' scenarios', metrics: [] };
      }
      const sims = listIn.map(s => simulate(businessId, s));

      // The union of every metric any scenario touched, in the metrics store's own order so the table is
      // stable across calls and a reader's eye does not have to re-find a row.
      const touched = {};
      sims.forEach(sim => sim.results.forEach(r => { touched[r.metric] = true; }));
      const metricIds = METRIC_IDS.filter(id => touched[id]);

      const metrics = metricIds.map(id => {
        const def = byId(id);
        const base = latest(businessId, id);
        const row = {
          metric: id,
          label: def ? def.label : id,
          unit: def ? def.unit : '',
          basisValue: base ? Number(base.value) : null,
          basisAt: base ? (Number(base.at) || 0) : 0,
          scenarios: sims.map(sim => {
            const hit = sim.results.filter(r => r.metric === id)[0] || null;
            if (!hit) return { name: sim.name, simulated: null, delta: null, present: false };
            return {
              name: sim.name,
              simulated: hit.simulated,
              delta: hit.delta,
              clamped: !!hit.clamped,
              assumption: hit.assumption,
              present: true
            };
          })
        };
        return row;
      });

      return {
        ok: sims.every(s => s.ok),
        kind: 'comparison',
        businessId: str(businessId),
        metrics: metrics,
        scenarios: sims.map(s => ({ name: s.name, ok: s.ok, failures: s.failures, simulatedCount: s.simulatedCount })),
        note: 'Each column is the SAME recorded baseline carried through that scenario\'s assumptions. Deltas are comparable because the baseline is shared.',
        label: 'simulation — arithmetic on recorded readings, not a forecast'
      };
    }

    /* ---- CATALOG ----------------------------------------------------------------------------------
       What the twin can simulate over, for a UI to render WITHOUT guessing. A metric with no recorded
       reading is listed with `hasReading:false` and `basisValue:null`, so the interface can grey it out
       instead of offering an assumption that will be refused. */
    function catalog(businessId) {
      const metrics = METRICS.map(def => {
        const base = latest(businessId, def.id);
        return {
          metric: def.id,
          label: def.label,
          unit: def.unit,
          kind: def.kind,
          hasReading: !!base,
          basisValue: base ? Number(base.value) : null,
          basisAt: base ? (Number(base.at) || 0) : 0,
          basisEvidence: base ? str(base.evidence) : '',
          basisSource: base ? str(base.source) : ''
        };
      });
      return {
        ok: true,
        kind: 'catalog',
        businessId: str(businessId),
        ops: OP_IDS.map(id => ({ id: id, verb: OPS[id].verb, param: OPS[id].param, note: OPS[id].note })),
        metrics: metrics,
        simulatable: metrics.filter(m => m.hasReading).length,
        total: metrics.length,
        label: 'simulation — arithmetic on recorded readings, not a forecast'
      };
    }

    return { simulate, compare, catalog, step, latest, OPS: OPS, OP_IDS: OP_IDS, MAX_SCENARIOS: MAX_SCENARIOS, MAX_STEPS: MAX_STEPS };
  }

  return { makeBusinessTwin, OPS, OP_IDS, MAX_SCENARIOS, MAX_STEPS };
});
