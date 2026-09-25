'use strict';
/* test/ai-cost-optimizer.test.js — Phase 7 AI cost optimizer (Business OS §30).

   Proves the optimizer only ever proposes a swap when the replacement clears the SAME capability filter the
   routing decision would use (router.eligible), reports unpriced / subscription / catalog-absent models as
   blind spots (never swaps them), states the saving as an ESTIMATE with a caveat, and respects the
   minimum-saving thresholds. No fake intelligence. */
const A = require('./_assert.js');
const R = require('../sidecar/model-router.js');
const O = require('../sidecar/ai-cost-optimizer.js');

function main() {
  // current model (priced, tools, reasoning) + a cheaper equivalent + a model missing reasoning + a subscription
  const router = R.makeModelRouter({ catalog: [
    { id: 'cur', provider: 'p', contextLength: 200000, supportsTools: true, supportsReasoning: true, pricing: { prompt: '0.000010', completion: '0.000030' } },
    { id: 'alt', provider: 'p', contextLength: 200000, supportsTools: true, supportsReasoning: true, pricing: { prompt: '0.000001', completion: '0.000003' } },
    { id: 'no-reason', provider: 'p', contextLength: 200000, supportsTools: true, supportsReasoning: false, pricing: { prompt: '0.0000005', completion: '0.000001' } },
    { id: 'sub', provider: 'p', contextLength: 8000, supportsTools: true, unmetered: true }
  ] });
  const opt = O.makeCostOptimizer({ router, minSavingUsd: 0.5, minSavingPct: 0.20 });

  // ---- a real, worth-making swap ----
  const usage = {
    totalUsd: 100, totalRuns: 50, totalTokens: 1_000_000,
    byModel: [{ model: 'cur', usd: 100, tokens: 1_000_000, runs: 50 }]
  };
  const out = opt.analyze(usage);
  A.eq(out.recommendations.length, 1, 'one recommendation produced');
  const rec = out.recommendations[0];
  A.eq(rec.from.id, 'cur', 'from current model');
  A.eq(rec.to.id, 'alt', 'to cheaper equivalent');
  A.ok(rec.estimatedSavingUsd > 0.5, 'saving clears the USD threshold');
  A.ok(rec.estimatedSavingPct >= 0.20, 'saving clears the pct threshold');
  A.eq(rec.evidence, 'estimate', 'evidence is an estimate, not a fact');
  A.ok(/Verify on a sample before switching/.test(rec.caveat), 'the caveat is stated inline');
  A.ok(rec.capabilitiesPreserved.indexOf('reasoning') >= 0, 'capabilities preserved are reported');

  // ---- the cheaper model lacking a CURRENT capability is NOT proposed (capability contract) ----
  // cur3 HAS reasoning; alt3 LACKS it. A swap must preserve the current model's capabilities, so alt3
  // is excluded and no recommendation is made — reported as a blind spot instead. (This is the real
  // contract: the replacement must be >= the current model, not merely cheaper.)
  const cap = R.makeModelRouter({ catalog: [
    { id: 'cur3', provider: 'p', contextLength: 8000, supportsTools: true, supportsReasoning: true, pricing: { prompt: '0.000010', completion: '0.000030' } },
    { id: 'alt3', provider: 'p', contextLength: 8000, supportsTools: true, supportsReasoning: false, pricing: { prompt: '0.0000005', completion: '0.000001' } }
  ] });
  const opt2 = O.makeCostOptimizer({ router: cap, minSavingUsd: 0.5, minSavingPct: 0.20 });
  const out2 = opt2.analyze({ totalUsd: 100, byModel: [{ model: 'cur3', usd: 100, tokens: 1_000_000, runs: 50 }] });
  A.eq(out2.recommendations.length, 0, 'no swap when the cheaper model lacks a current capability');
  A.ok(out2.blindSpots.some(b => b.model === 'cur3' && /same capabilities/.test(b.reason)), 'reports a blind spot instead of a wrong swap');

  // ---- subscription model is a blind spot, never swapped onto metered ----
  const out3 = opt.analyze({ totalUsd: 0, byModel: [{ model: 'sub', usd: 0, tokens: 1_000_000, runs: 50 }] });
  A.ok(out3.blindSpots.some(b => b.model === 'sub' && /subscription/.test(b.reason)), 'subscription is a blind spot');

  // ---- unknown model (absent from catalog) is a blind spot ----
  const out4 = opt.analyze({ totalUsd: 10, byModel: [{ model: 'ghost', usd: 10, tokens: 100000, runs: 5 }] });
  A.ok(out4.blindSpots.some(b => b.model === 'ghost' && /not present in the model catalog/.test(b.reason)), 'catalog-absent model is a blind spot');

  // ---- below-threshold spend is not worth a model change ----
  const out5 = opt.analyze({ totalUsd: 100, byModel: [{ model: 'cur', usd: 0.3, tokens: 1000, runs: 1 }] });
  A.eq(out5.recommendations.length, 0, 'tiny spend yields no recommendation');

  // ---- no usage at all: honest warning, no invented saving ----
  const out6 = opt.analyze({});
  A.ok(out6.warnings.some(w => /nothing to optimise/.test(w)), 'warns when nothing to optimise');

  // ---- priceRun prices the same tokens across the whole catalog; unpriced stay null ----
  const pr = opt.priceRun({ tokensIn: 1000, tokensOut: 200 });
  A.eq(pr.models.length, 4, 'priceRun covers every model');
  A.ok(pr.models.some(m => m.priced === false && m.usd === null), 'unpriced models report usd:null, never 0');

  A.report('ai-cost-optimizer: safe swaps only, blind spots stated');
}

main();
