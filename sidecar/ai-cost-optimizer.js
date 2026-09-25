/* sidecar/ai-cost-optimizer.js — §30 "AI cost optimization" (Business OS Phase 7).

   Reads what the station has actually SPENT on models (insights.js folds it from the run history) and
   answers: was there a cheaper model that could have done this work, and how much would it have saved?

   THE ESTIMATE IS LABELLED AS AN ESTIMATE, ALWAYS. Every figure this module produces rests on LIST PRICES
   and on the assumption that the cheaper model would have produced an acceptable result. Neither is a
   fact: list prices are not billed amounts (providers/prices.js says so in its own header), and "acceptable"
   is a judgement about output quality this module cannot make. So every recommendation carries
   `evidence: 'estimate'`, a `confidence`, and a `caveat` naming what would have to be true. A number that
   looks authoritative and is not is worse than no number at all (P1, P2).

   THE SWAP MUST PRESERVE CAPABILITY. A recommendation is only made when the suggested model satisfies the
   SAME hard requirements the current one does — tools, reasoning, vision, context. Recommending a cheaper
   model without tools for work that used them would "save" money by breaking the run, and the saving would
   show up in every report while the work silently degraded. This is the same law the model router enforces,
   and it is enforced by DELEGATING to the router's own filter rather than re-implementing it — one filter,
   two callers, no drift.

   IT DOES NOT ACT. This module returns recommendations. It does not change any agent's configured model.
   Switching a production model is the owner's decision (P5), and an automatic downgrade that quietly
   changed output quality in the name of saving money would be the exact failure this file exists to avoid.

   PURE: no IO, no clock, no env, no rng. Usage + catalog injected. UMD. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).aiCostOptimizer = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Below this, a recommendation is noise: the effort of switching a model exceeds the money involved.
  const MIN_SAVING_USD = 0.50;
  // A swap must save at least this fraction of the line's spend to be worth proposing.
  const MIN_SAVING_PCT = 0.20;
  const MAX_RECOMMENDATIONS = 10;

  function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }
  function round(n, p) { const f = Math.pow(10, p == null ? 6 : p); return Math.round(n * f) / f; }
  function pct(part, whole) { return whole > 0 ? round(part / whole, 4) : 0; }

  function makeCostOptimizer(o) {
    o = o || {};
    /* The router is INJECTED, not rebuilt: the capability filter that decides "could this model have done
       the same work" is the router's `eligible()`, so an optimizer recommendation and a routing decision can
       never disagree about what a model can do. Optional — without a router the optimizer still reports the
       spend breakdown honestly and simply recommends nothing. */
    const router = (o.router && typeof o.router.eligible === 'function') ? o.router : null;
    const minUsd = num(o.minSavingUsd) > 0 ? num(o.minSavingUsd) : MIN_SAVING_USD;
    const minPct = num(o.minSavingPct) > 0 ? num(o.minSavingPct) : MIN_SAVING_PCT;

    /* ANALYSE. `usage` is insights.js's own shape: { byModel: [{ model, usd, tokens, runs }], totalUsd }.
       Returns the spend breakdown plus zero or more recommendations, each individually defensible. */
    function analyze(usage, opts) {
      opts = opts || {};
      const u = usage || {};
      const rows = Array.isArray(u.byModel) ? u.byModel.slice() : [];
      const totalUsd = round(num(u.totalUsd != null ? u.totalUsd : rows.reduce((s, r) => s + num(r.usd), 0)), 6);

      const out = {
        totalUsd: totalUsd,
        totalRuns: num(u.totalRuns),
        totalTokens: num(u.totalTokens),
        models: rows.length,
        periodLabel: opts.periodLabel != null ? String(opts.periodLabel) : '',
        recommendations: [],
        warnings: [],
        /* WHAT THIS ANALYSIS CANNOT SEE. Stated up front rather than left for the reader to discover: an
           unpriced or subscription model contributes no dollars here, so a station running mostly on a
           subscription shows a small total and few recommendations — not because it is efficient, but
           because there is no per-token bill to optimise. */
        blindSpots: []
      };

      if (!rows.length) {
        out.warnings.push('no model usage was supplied — there is nothing to optimise and no saving to claim');
        return out;
      }

      if (!router) {
        out.warnings.push('no model router is configured, so no cheaper alternative can be checked — the spend breakdown below is the whole result');
      }

      const byId = {};
      for (const m of (router && typeof router.available === 'function' ? router.available() : [])) byId[m.id] = m;

      // Spend ranked heaviest first — the money is where the money is.
      const ranked = rows.slice().sort((a, b) => num(b.usd) - num(a.usd));

      for (const row of ranked) {
        const id = String(row.model == null ? '' : row.model);
        const usd = round(num(row.usd), 6);
        const runs = num(row.runs);
        const tokens = num(row.tokens);

        const cur = byId[id] || null;
        /* UNPRICED / SUBSCRIPTION: the spend line may be zero or absent because there is no per-token bill,
           not because the work was free. Recommending a swap off a subscription onto a metered model would
           INCREASE cost, so these are reported as blind spots and skipped. */
        if (cur && cur.unmetered) {
          out.blindSpots.push({
            model: id, usd: usd, runs: runs, tokens: tokens,
            reason: 'runs on a subscription with no per-token charge — its real cost is the seat, not a line item here, so no swap is proposed'
          });
          continue;
        }
        if (!cur) {
          out.blindSpots.push({
            model: id, usd: usd, runs: runs, tokens: tokens,
            reason: 'not present in the model catalog, so its capabilities are unknown and no equivalent can be verified'
          });
          continue;
        }
        if (!cur.priced) {
          out.blindSpots.push({
            model: id, usd: usd, runs: runs, tokens: tokens,
            reason: 'no list price in the catalog — the spend shown came from the provider, and no alternative can be priced against it'
          });
          continue;
        }
        if (usd < minUsd) continue;   // too small to be worth a model change

        // THE CAPABILITY CONTRACT: whatever this model can do, the replacement must also do.
        const needs = {
          tools: !!cur.supportsTools,
          reasoning: !!cur.supportsReasoning,
          vision: !!cur.supportsVision,
          minContext: cur.contextLength > 0 ? cur.contextLength : 0
        };
        if (!router) continue;

        const candidates = router.eligible({ needs: needs })
          .filter(m => m.id !== id && m.priced && !m.unmetered);

        if (!candidates.length) {
          out.blindSpots.push({
            model: id, usd: usd, runs: runs, tokens: tokens,
            reason: 'no other catalogued model offers the same capabilities — the spend may be unavoidable'
          });
          continue;
        }

        /* PRICE THE COUNTERFACTUAL ON THE SAME TOKEN MIX. The run history gives total tokens, not an in/out
           split, so the split is inferred from the catalog's own blend and stated as an assumption. The
           saving is therefore "if the tokens had been priced at the alternative's rates" — never "you would
           have been billed this". */
        const alt = candidates.slice().sort((a, b) => blended(a) - blended(b))[0];
        const altUsd = round(tokens * blended(alt) / 1e6, 6);
        const saving = round(usd - altUsd, 6);
        const savingPct = pct(saving, usd);

        if (saving < minUsd || savingPct < minPct) continue;

        out.recommendations.push({
          from: { id: id, name: cur.name, usd: usd, perMTok: blended(cur) },
          to: { id: alt.id, name: alt.name, perMTok: blended(alt), provider: alt.provider },
          estimatedUsd: altUsd,
          estimatedSavingUsd: saving,
          estimatedSavingPct: savingPct,
          runs: runs, tokens: tokens,
          capabilitiesPreserved: describeNeeds(needs),
          evidence: 'estimate',
          confidence: tokens > 0 ? 'moderate' : 'weak',
          caveat: 'list prices, and the same token count on the cheaper model — it assumes the cheaper model ' +
            'would have produced an acceptable result for this work, which this module cannot judge. Verify on a ' +
            'sample before switching a production model.',
          note: 'this station\'s total spend is ' + totalUsd + ' USD; this line is ' + Math.round(pct(usd, totalUsd) * 100) + '% of it'
        });
      }

      out.recommendations = out.recommendations
        .sort((a, b) => b.estimatedSavingUsd - a.estimatedSavingUsd)
        .slice(0, MAX_RECOMMENDATIONS);

      out.potentialSavingUsd = round(out.recommendations.reduce((s, r) => s + num(r.estimatedSavingUsd), 0), 6);
      out.potentialSavingPct = pct(out.potentialSavingUsd, totalUsd);

      if (!out.recommendations.length && !out.warnings.length) {
        out.warnings.push('no swap clears the thresholds (saving at least ' + minUsd + ' USD and ' +
          Math.round(minPct * 100) + '% on the line) — the current model mix stands');
      }
      return out;
    }

    function blended(m) {
      if (!m) return 0;
      if (typeof m.blendedPerMTok === 'number' && isFinite(m.blendedPerMTok)) return m.blendedPerMTok;
      if (!m.priced) return 0;
      return round(num(m.priceIn) * 0.75 + num(m.priceOut) * 0.25, 6);
    }

    function describeNeeds(n) {
      const parts = [];
      if (n.tools) parts.push('tools');
      if (n.reasoning) parts.push('reasoning');
      if (n.vision) parts.push('vision');
      if (num(n.minContext) > 0) parts.push('context >= ' + num(n.minContext));
      return parts.length ? parts.join(', ') : 'no specific capabilities';
    }

    /* WHAT ONE RUN WOULD COST ON EACH CATALOGUED MODEL — the comparison a user wants when they are choosing
       rather than reviewing. Same capability filter, same honesty: unpriced models report null, never 0. */
    function priceRun(task) {
      task = task || {};
      const rows = [];
      const pool = (router && typeof router.available === 'function') ? router.available() : [];
      for (const m of pool) {
        const est = (router && typeof router.estimate === 'function') ? router.estimate(m, task) : null;
        rows.push({
          id: m.id, name: m.name, provider: m.provider,
          priced: !!m.priced, unmetered: !!m.unmetered,
          usd: est ? est.usd : null,
          perMTok: blended(m),
          supportsTools: !!m.supportsTools, supportsReasoning: !!m.supportsReasoning
        });
      }
      const priced = rows.filter(r => r.usd != null).sort((a, b) => a.usd - b.usd);
      return {
        tokensIn: num(task.tokensIn), tokensOut: num(task.tokensOut),
        cheapest: priced.length ? priced[0] : null,
        dearest: priced.length ? priced[priced.length - 1] : null,
        spreadUsd: priced.length > 1 ? round(priced[priced.length - 1].usd - priced[0].usd, 6) : null,
        models: rows
      };
    }

    return {
      MIN_SAVING_USD: minUsd, MIN_SAVING_PCT: minPct, MAX_RECOMMENDATIONS: MAX_RECOMMENDATIONS,
      analyze, priceRun
    };
  }

  return { makeCostOptimizer, MIN_SAVING_USD: MIN_SAVING_USD, MIN_SAVING_PCT: MIN_SAVING_PCT, MAX_RECOMMENDATIONS: MAX_RECOMMENDATIONS };
});
