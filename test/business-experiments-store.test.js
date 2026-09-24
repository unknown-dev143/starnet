'use strict';
/* test/business-experiments-store.test.js — the §14 EXPERIMENT LAB (Business OS Phase 4).

   THE load-bearing property: a conclusion is gated by FOUR rules, so the app learns from data instead of
   generating theories (P2). conclusionAllowed() refuses a verdict unless:
     1. the experiment is ENDED (a verdict on data still arriving is a theory);
     2. it has at least TWO arms (a single arm is an anecdote);
     3. at least one result carries a VERDICT-GRADE evidence class (verified/analysis — assumptions, estimates
        and predictions cannot carry a verdict);
     4. ...UNLESS the conclusion is 'inconclusive', which is ALWAYS allowed — the honest answer is never blocked.

   Also locked: open() needs a hypothesis, two variants, and metrics drawn from §11's closed catalogue; the id
   is <businessId>~x<seq>; tally() reports sums/min/max/counts only, never an effect size or a p-value. */
const A = require('./_assert.js');
const X = require('../sidecar/business-experiments-store.js');

function store(extra) {
  const saved = [];
  const s = X.makeBusinessExperimentsStore(Object.assign({
    records: [], persist: (rows) => { saved.length = 0; for (const r of rows) saved.push(r); }, now: () => 1000
  }, extra || {}));
  return { s, saved };
}
const openExp = (s, extra) => s.open('acme', Object.assign({ hypothesis: 'A beats B', variants: ['A', 'B'], metrics: ['conversion-rate'] }, extra || {})).experiment.id;
const res = (variant, value, evidence, extra) => Object.assign({ variant: variant, metric: 'conversion-rate', value: value, evidence: evidence, source: 'analytics' }, extra || {});

/* ---------- the vocabularies ---------- */
{
  const { s } = store();
  A.eq(X.STATUSES, ['planned', 'running', 'ended', 'concluded'], 'the four §14 statuses');
  A.eq(X.CONCLUSIONS, ['supported', 'refuted', 'inconclusive'], 'the three conclusions');
  A.eq(s.VERDICT_GRADE, ['verified', 'analysis'], 'only verified/analysis can carry a verdict');
  A.eq(s.EVIDENCE, ['verified', 'analysis', 'assumption', 'estimate', 'prediction', 'unknown'], 'the shared evidence vocabulary');
  A.ok(s.METRIC_IDS.indexOf('conversion-rate') >= 0, 'metrics come from §11\'s catalogue');
}

/* ---------- open: validation ---------- */
{
  const { s } = store();
  A.eq(s.open('', { hypothesis: 'x', variants: ['A', 'B'] }).ok, false, 'no businessId -> refused');
  A.eq(s.open('acme', { variants: ['A', 'B'] }).ok, false, 'an experiment must state a hypothesis');
  A.eq(s.open('acme', { hypothesis: 'x', variants: ['A'] }).ok, false, 'one variant is refused — a controlled test needs two arms');
  A.ok(/two variants/.test(s.open('acme', { hypothesis: 'x', variants: ['A'] }).reason), 'and says why');
  A.eq(s.open('acme', { hypothesis: 'x', variants: ['A', 'B'], metrics: ['nope'] }).ok, false, 'an unknown metric is refused');
  A.ok(/conversion-rate/.test(s.open('acme', { hypothesis: 'x', variants: ['A', 'B'], metrics: ['nope'] }).reason), 'and lists §11\'s real metrics');

  const id = openExp(s);
  A.ok(/^acme~x\d+$/.test(id), 'the id is <businessId>~x<seq>');
  A.ok(id.indexOf('#') < 0, 'and never contains a #');
  A.eq(s.experiment(id).status, 'planned', 'a new experiment starts planned');
}

/* ---------- lifecycle: planned -> running -> ended ---------- */
{
  const { s } = store();
  const id = openExp(s);
  A.eq(s.end(id).ok, false, 'a planned experiment cannot be ended — it never ran');
  A.eq(s.recordResult(id, res('A', 1, 'verified')).ok, false, 'a result on a planned experiment is refused');
  A.eq(s.start(id).ok, true, 'a planned experiment can start');
  A.eq(s.start(id).ok, false, 'and cannot be started twice');
  A.eq(s.recordResult(id, res('A', 1, 'verified')).ok, true, 'a running experiment accepts results');
  A.eq(s.recordResult(id, res('C', 1, 'verified')).ok, false, 'a result for an unknown arm is refused');
  A.eq(s.recordResult(id, { variant: 'A', value: 1, evidence: 'verified' }).ok, false, 'a result needs a source (P1)');
  A.eq(s.recordResult(id, { variant: 'A', value: 1, source: 'x' }).ok, false, 'a result needs an evidence class');
  A.eq(s.end(id).ok, true, 'a running experiment can end');
  A.eq(s.end(id).ok, false, 'and cannot be ended twice');
}

/* ================= THE HEADLINE: the four conclusion rules ================= */
{
  const { s } = store();
  const id = openExp(s);

  // RULE 4: inconclusive is ALWAYS allowed — even on a planned experiment with no data.
  A.eq(s.conclude(id, { conclusion: 'inconclusive' }).ok, true, 'inconclusive is allowed even before the experiment ends (the honest answer is never blocked)');

  const id2 = openExp(s);
  // RULE 1: not ended yet
  s.start(id2);
  A.eq(s.conclude(id2, { conclusion: 'supported' }).ok, false, 'a verdict before ending is refused');
  A.ok(/end it first/.test(s.conclude(id2, { conclusion: 'supported' }).reason), 'and says to end it first');
  // record an assumption-grade result and end
  s.recordResult(id2, res('A', 1, 'assumption'));
  s.recordResult(id2, res('B', 2, 'assumption'));
  s.end(id2);
  // RULE 3: no verdict-grade evidence
  const r3 = s.conclude(id2, { conclusion: 'supported' });
  A.eq(r3.ok, false, 'a verdict with only assumption-grade results is refused');
  A.ok(/VERIFIED OR ANALYSIS/.test(r3.reason), 'and names the grade it needs');
  A.ok(/inconclusive/.test(r3.reason), 'and points at the honest alternative');
  // now add a verdict-grade result -> allowed
  s.recordResult(id2, res('A', 1, 'verified'));
  A.eq(s.conclude(id2, { conclusion: 'supported' }).ok, true, 'with a verified result the verdict is allowed');
  A.eq(s.experiment(id2).status, 'concluded', 'and the experiment is concluded');
  A.eq(s.experiment(id2).conclusion, 'supported', 'the conclusion is recorded');
  A.eq(s.conclude(id2, { conclusion: 'nope' }).ok, false, 'an unknown conclusion is refused');
}

/* ---------- RULE 2: a single-arm experiment cannot conclude ---------- */
{
  const { s } = store();
  // build a one-arm experiment directly (open() refuses one, so inject the row to reach rule 2)
  const s2 = X.makeBusinessExperimentsStore({ records: [{ id: 'acme~x1', seq: 1, businessId: 'acme', hypothesis: 'h', variable: '', variants: ['A'], metrics: [], status: 'ended', results: [{ at: 1, variant: 'A', metric: '', value: 1, evidence: 'verified', source: 'x', note: '' }], conclusion: '', conclusionReason: '', nextAction: '', createdAt: 1, updatedAt: 1 }], persist: null, now: () => 1000 });
  const r = s2.conclude('acme~x1', { conclusion: 'supported' });
  A.eq(r.ok, false, 'a single-arm experiment cannot conclude');
  A.ok(/two arms|at least two/.test(r.reason), 'and says it needs two arms');
  A.eq(s2.conclusionAllowed(s2.experiment('acme~x1'), 'inconclusive').ok, true, 'but inconclusive is still allowed');
}

/* ---------- conclusionAllowed is exposed and mirrors the store ---------- */
{
  const { s } = store();
  const id = openExp(s);
  const exp = s.experiment(id);
  A.eq(s.conclusionAllowed(exp, 'inconclusive').ok, true, 'inconclusive always allowed');
  A.eq(s.conclusionAllowed(exp, 'supported').ok, false, 'supported not allowed while planned');
  A.ok(/§14/.test(s.conclusionAllowed(exp, 'supported').reason), 'and the refusal cites §14');
}

/* ---------- tally: sums/min/max/counts only, never an effect size ---------- */
{
  const { s } = store();
  const id = openExp(s);
  s.start(id);
  s.recordResult(id, res('A', 10, 'verified'));
  s.recordResult(id, res('A', 30, 'verified'));
  s.recordResult(id, res('B', 20, 'verified'));
  const t = s.tally(id);
  A.eq(t.total, 3, 'three results');
  A.eq(t.variants.A.readings, 2, 'arm A has two readings');
  A.eq(t.variants.A.metrics['conversion-rate'].sum, 40, 'sum is reported');
  A.eq(t.variants.A.metrics['conversion-rate'].min, 10, 'min is reported');
  A.eq(t.variants.A.metrics['conversion-rate'].max, 30, 'max is reported');
  A.eq(t.byEvidence.verified, 3, 'results are counted by evidence class');
  A.ok(!/pValue|significance|effectSize|uplift/.test(JSON.stringify(t)), 'there is no p-value or effect size the store would have to justify');
  A.eq(s.tally('ghost'), null, 'tallying an unknown experiment is null');
}

/* ---------- summary ---------- */
{
  const { s } = store();
  const a = openExp(s);
  const b = openExp(s);
  s.start(a); s.recordResult(a, res('A', 1, 'verified')); s.end(a); s.conclude(a, { conclusion: 'supported' });
  s.conclude(b, { conclusion: 'inconclusive' });
  const sum = s.summary('acme');
  A.eq(sum.total, 2, 'two experiments');
  A.eq(sum.byStatus.concluded, 2, 'both concluded');
  A.eq(sum.byConclusion.supported, 1, 'one supported');
  A.eq(sum.byConclusion.inconclusive, 1, 'one inconclusive');
  A.eq(sum.withVerdict, 1, 'only the non-inconclusive conclusion counts as a verdict');
}

/* ---------- P6 + remove/clear ---------- */
{
  const { s } = store();
  openExp(s);
  s.open('beta', { hypothesis: 'h', variants: ['A', 'B'] });
  A.eq(s.count('acme'), 1, 'count is per business');
  A.eq(s.remove('nope'), { ok: true, removed: 0 }, 'removing an unknown id is a no-op that says so');
  s.clear('acme');
  A.eq(s.count('acme'), 0, 'acme is cleared');
  A.eq(s.count('beta'), 1, 'beta is untouched');
}

/* ---------- persist-before-commit ---------- */
{
  let boom = false;
  const s = X.makeBusinessExperimentsStore({ records: [], persist: () => { if (boom) throw new Error('denied'); }, now: () => 1000 });
  const id = openExp(s);
  boom = true;
  A.eq(s.start(id).ok, false, 'a start whose persist throws returns ok:false');
  A.eq(s.experiment(id).status, 'planned', 'the experiment stays planned');
}

A.report('business-experiments-store');
