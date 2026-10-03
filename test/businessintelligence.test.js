'use strict';
/* test/businessintelligence.test.js — Phase 7 console PURE HALF, tested headless (Business OS §30).

   The console's pure half (formatters, the MISSING renderer, the POSSIBLE-CAUSES renderer, the route-form
   validator) is Node-loadable without a DOM. These tests prove the honest rendering rules that the browser
   panel must honour: a null reading is NOT rendered as 0, causes are shown under POSSIBLE CAUSES with no
   asserted verdict, and the route-form validator rejects absent / implausible token counts and a bad preference. */
const A = require('./_assert.js');

// The console is a browser UMD; give it harmless globals so it can be required in Node, then read the pure API.
globalThis.window = globalThis.window || globalThis;
globalThis.document = globalThis.document || { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), getElementById: () => null };
globalThis.StationUI = globalThis.StationUI || { registerWindow: () => {} };

const C = require('../frontend/app/businessintelligence.js');

function main() {
  A.ok(typeof C === 'object' && typeof C.fmt === 'function', 'console module exports its pure API');

  // ---- a null reading is not zero ----
  A.eq(C.fmt(null), 'not recorded', 'fmt(null) is the absent label');
  A.ok(/MISSING|not recorded|in-missing|in-none/.test(C.fmtHtml(null)), 'fmtHtml(null) renders absence, never 0');

  // ---- a real number formats as itself ----
  A.eq(C.fmt(1700), '1700', 'fmt(1700) is the number');
  A.ok(C.fmtHtml(1700).indexOf('1700') >= 0, 'fmtHtml(1700) contains the value');

  // ---- currency formatting is explicit ----
  A.ok(/\$/.test(C.fmtUsd(1.5)), 'fmtUsd carries a currency symbol');
  A.eq(C.fmtUsd(0), '$0', 'fmtUsd(0) renders a real zero');

  // ---- causes render under POSSIBLE CAUSES and quote the verdict (no asserted causality) ----
  const exp = {
    verdict: 'no cause is asserted as the reason',
    causes: [
      { kind: 'experiment', text: 'an experiment changed state', confidence: 'strong', evidence: 'verified' },
      { kind: 'sampling', text: 'few readings recorded', confidence: 'weak', evidence: 'verified' }
    ]
  };
  const ch = C.causesHtml(exp);
  A.ok(/POSSIBLE CAUSES/i.test(ch), 'causes render under POSSIBLE CAUSES');
  A.ok(/asserted as the reason/i.test(ch), 'the verdict is quoted, not a causal claim');
  A.ok(/strong/i.test(ch) && /experiment/i.test(ch), 'cause strength and kind are shown');

  // ---- the route-form validator (mirrors the POST /route contract) ----
  A.ok(C.validateRouteForm({ needs: {}, prefer: 'cost', tokensIn: 1000, tokensOut: 200 }).ok, 'valid form passes');
  A.ok(!C.validateRouteForm({ needs: {}, prefer: 'bogus' }).ok, 'unknown preference rejected');
  A.ok(!C.validateRouteForm({ needs: {}, prefer: 'cost', tokensIn: -1 }).ok, 'negative token count rejected');
  A.ok(!C.validateRouteForm({ needs: {}, prefer: 'cost', tokensIn: 0, tokensOut: 0 }).ok, 'all-zero token count rejected');
  A.ok(!C.validateRouteForm({ needs: {}, prefer: 'cost', tokensIn: 200000000 }).ok, 'token count above any context rejected');

  // ---- PRICE A RUN: a priced model carries its dollar figure; an unpriced one is NOT a $0 ----
  {
    const p = C.shapePricing({
      tokensIn: 1000, tokensOut: 200,
      cheapest: { id: 'haiku', name: 'Haiku', usd: 0.001 },
      dearest: { id: 'opus', name: 'Opus', usd: 0.12 },
      spreadUsd: 0.119,
      models: [
        { id: 'haiku', name: 'Haiku', provider: 'anthropic', priced: true, usd: 0.001, perMTok: 0.8 },
        { id: 'opus', name: 'Opus', provider: 'anthropic', priced: true, usd: 0.12, perMTok: 15 },
        { id: 'free-local', name: 'Local', provider: 'local', priced: false, usd: null, perMTok: null }
      ]
    });
    A.eq(p.models.length, 3, 'every catalogued model is priced');
    A.eq(p.models[0].usdText, '$0.001000', 'a priced model carries its dollar estimate');
    A.eq(p.models[2].usd, null, 'an unpriced model carries a NULL price, never a number');
    A.eq(p.models[2].usdText, 'unpriced', 'and renders as "unpriced", NOT as $0 (a free-looking model is the expensive mistake)');
    A.eq(p.cheapest.name, 'Haiku', 'the cheapest is named');
    A.ok(/\$/.test(p.spreadText), 'and the spread is a real currency string');
    A.eq(p.tokensIn, 1000, 'the priced token counts are carried through');

    // A comparison with nothing priced -> no cheapest, and that must not throw.
    const none = C.shapePricing({ tokensIn: 5, models: [{ id: 'x', name: 'X', priced: false, usd: null }] });
    A.eq(none.cheapest, null, 'no priced model means no cheapest, and no throw');
    A.eq(none.models[0].usdText, 'unpriced', 'and the lone model is still rendered as unpriced');

    // Absent input shapes harmlessly rather than throwing.
    A.eq(C.shapePricing(null).models.length, 0, 'an absent pricing payload shapes an empty list, not a throw');
  }

  // ---- the PRICE A RUN surface is WIRED, not a stub over an unused route ----
  {
    const fs = require('fs');
    const pathMod = require('path');
    const src = fs.readFileSync(pathMod.join(__dirname, '..', 'frontend', 'app', 'businessintelligence.js'), 'utf8');
    // The audit found POST /api/intelligence/costs/price had NO consumer anywhere in the frontend.
    A.ok(/\/intelligence\/costs\/price/.test(src), 'the console actually calls POST /intelligence/costs/price — the route has a consumer');
    A.ok(/function shapePricing/.test(src), 'through a pure shaper');
    A.ok(/pricingFormHtml/.test(src), 'and renders the token-count form the route needs');
  }

  A.report('businessintelligence: honest console rendering (pure half)');
}

main();
