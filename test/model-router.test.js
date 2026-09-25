'use strict';
/* test/model-router.test.js — Phase 7 model router: the refusal law + honest pricing (Business OS §30).

   Proves:
     · OpenRouter {prompt, completion} (USD per token) is normalised to USD per million and priced
     · provider is derived from an "<provider>/<model>" id when absent
     · a hard requirement that cannot be met is a REFUSAL (422), never a downgrade
     · the route reason states ONLY what the ranking actually used — never "cheapest" when nothing is priced
     · estimate() returns usd:null for an unpriced model (never 0)
     · setCatalog refuses an empty replacement and keeps the previous one; an empty router refuses outright */
const A = require('./_assert.js');
const R = require('../sidecar/model-router.js');

function main() {
  const r = R.makeModelRouter({ catalog: [
    { id: 'anthropic/claude-a', provider: 'anthropic', contextLength: 200000, supportsTools: true, supportsReasoning: true,
      pricing: { prompt: '0.000003', completion: '0.000015' } },
    { id: '~openai/gpt-b', provider: '', contextLength: 128000, supportsTools: true,
      pricing: { in: 1, out: 2 } },
    { id: 'free/model', provider: 'free', contextLength: 8000, supportsTools: false, pricing: { prompt: '0', completion: '0' } },
    { id: 'unpriced/model', provider: 'x', contextLength: 8000, supportsTools: true }
  ] });

  const all = r.available();
  const a = all.find(m => m.id === 'anthropic/claude-a');
  A.ok(a.priced, 'prompt/completion is priced');
  A.eq(a.priceIn, 3, 'prompt scaled to per-million');
  A.eq(a.priceOut, 15, 'completion scaled to per-million');
  A.eq(all.find(m => m.id === '~openai/gpt-b').provider, 'openai', 'provider derived from id');
  A.eq(all.find(m => m.id === 'free/model').priced, false, 'free model is not "priced"');
  A.eq(all.find(m => m.id === 'unpriced/model').priced, false, 'unpriced model is not "priced"');

  // ---- refusal law ----
  const ref = r.route({ needs: { vision: true }, prefer: 'cost' });
  A.eq(ref.ok, false, 'hard requirement unmet => refused');
  A.eq(ref.considered, 4, 'refusal reports how many were considered');
  const ref2 = r.route({ needs: { minContext: 500000 }, prefer: 'balanced' });
  A.eq(ref2.ok, false, 'unsatisfiable context => refused');

  // ---- honest reason: all eligible unpriced => must NOT claim "cheapest" ----
  const ru = R.makeModelRouter({ catalog: [
    { id: 'a', provider: 'p', contextLength: 8000, supportsTools: true },
    { id: 'b', provider: 'p', contextLength: 8000, supportsTools: true }
  ] });
  const ruRoute = ru.route({ needs: {}, prefer: 'cost', tokensIn: 100, tokensOut: 10 });
  A.ok(ruRoute.ok, 'routable (no hard requirement)');
  A.ok(/did not decide this|falls back to model id/.test(ruRoute.reason), 'honest reason: cost could not decide the ranking');
  A.ok(!/cheapest that meets the requirements/.test(ruRoute.reason), 'never falsely claims cheapest when unpriced');

  // ---- honest reason: priced => cheapest IS stated, and it is true ----
  const r2 = R.makeModelRouter({ catalog: [
    { id: 'cheap', provider: 'p', contextLength: 8000, supportsTools: true, pricing: { prompt: '0.000001', completion: '0.000001' } },
    { id: 'dear', provider: 'p', contextLength: 8000, supportsTools: true, pricing: { prompt: '0.00001', completion: '0.00001' } }
  ] });
  const best = r2.route({ needs: { tools: true }, prefer: 'cost' });
  A.eq(best.model.id, 'cheap', 'cheapest priced model is selected');
  A.ok(/cheapest by list price/.test(best.reason), 'honest reason states cheapest only when a price exists');

  // ---- estimate unpriced => usd null ----
  const est = r.estimate(all.find(m => m.id === 'unpriced/model'), { tokensIn: 1000, tokensOut: 200 });
  A.eq(est.usd, null, 'unpriced estimate usd is null');
  A.eq(est.priced, false, 'unpriced estimate priced:false');

  // ---- setCatalog refuses empty, keeps previous ----
  const bad = r.setCatalog([]);
  A.eq(bad.ok, false, 'empty catalog is refused');
  A.eq(r.size, 4, 'previous catalog retained');

  // ---- empty router refuses ----
  const empty = R.makeModelRouter({ catalog: [] });
  A.eq(empty.route({}).ok, false, 'empty router refuses to route');
  A.eq(empty.route({}).considered, 0, 'empty router considered: 0');

  A.report('model-router: refusal law + honest pricing');
}

main();
