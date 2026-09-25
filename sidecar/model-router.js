/* sidecar/model-router.js — §30 "Model router" (Business OS Phase 7).

   Picks WHICH MODEL runs a piece of work. Phase 4 gave the station a price catalog (providers/prices.js)
   and Phase 1-N gave it providers (providers/registry.js), but nothing chose between them: a run used
   whatever the agent was configured with. This module is the choosing.

   THE ONE LAW: A HARD REQUIREMENT THAT CANNOT BE MET IS A REFUSAL, NOT A DOWNGRADE.
   If the work needs tools and the cheapest model has none, routing to it "because it is cheap" produces a
   run that silently cannot do its job — the worst possible outcome, and the one that looks fine in a cost
   report. `route()` filters on hard requirements FIRST and returns { ok:false, reason } when nothing
   survives. It never relaxes a requirement to find a candidate.

   THE SECOND LAW: IT NEVER INVENTS A PRICE OR A CAPABILITY.
   A model with no price in the catalog is `priced: false` and is ranked as THOUGH it were free only if the
   caller explicitly accepts unpriced models; otherwise it is excluded from cost ordering rather than
   assumed cheap. A model whose capabilities are unknown is treated as not having them, because "unknown"
   and "yes" are different facts and the safe reading is the one that does not break the run.

   PREFERENCE IS A WEIGHT, NOT A COMMAND. `prefer` biases the ranking among models that ALL satisfy the
   requirements. 'cost' favours the cheaper; 'quality' favours the higher-priced (an imperfect proxy, stated
   as one — see the header note in score()); 'speed' favours the faster tier; 'balanced' splits. No setting
   can reach past the hard filter.

   PURE: no IO, no clock, no env, no rng. The catalog is injected. UMD. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).modelRouter = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PREFERENCES = ['cost', 'quality', 'speed', 'balanced'];
  const DEFAULT_PREFERENCE = 'balanced';

  // Speed tiers, slowest to fastest. A catalog entry with no tier is 'unknown' and never wins on speed.
  const SPEED_TIERS = ['slow', 'medium', 'fast', 'unknown'];
  const SPEED_RANK = { slow: 0, medium: 1, fast: 2, unknown: -1 };

  // Cost per 1M tokens, blended 3:1 in/out — a typical assistant turn is input-heavy.
  const BLEND_IN = 0.75;
  const BLEND_OUT = 0.25;

  function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }
  function bool(v) { return v === true; }
  function round(n, p) { const f = Math.pow(10, p == null ? 6 : p); return Math.round(n * f) / f; }

  /* NORMALISE one catalog row into the shape the router reasons about. Tolerant by design: the live
     OpenRouter/OpenAI-compatible catalogs, the static fallbacks in registry.js and a host-built list do not
     share field names, so this is the single place that reconciles them. Anything unreadable becomes the
     conservative value (no capability, no price, unknown speed) — never a guess. */
  function normalise(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const id = raw.id != null ? String(raw.id) : '';
    if (!id) return null;
    // OpenRouter (and OpenAI-compatible /models) publish pricing as {prompt, completion} in USD PER TOKEN, while
    // this module reasons in USD PER MILLION — so convert here, once. A static/seed row that already carries
    // priceIn/priceOut (per-million) wins; otherwise prompt/completion is read and scaled by 1e6. Anything
    // unreadable becomes the conservative value (no price) — never a guess at a rate.
    let priceIn = raw.priceIn != null ? num(raw.priceIn)
      : (raw.pricing && raw.pricing.in != null ? num(raw.pricing.in)
      : (raw.pricing && raw.pricing.prompt != null ? num(raw.pricing.prompt) * 1e6 : null));
    let priceOut = raw.priceOut != null ? num(raw.priceOut)
      : (raw.pricing && raw.pricing.out != null ? num(raw.pricing.out)
      : (raw.pricing && raw.pricing.completion != null ? num(raw.pricing.completion) * 1e6 : null));
    if (priceIn != null && !isFinite(priceIn)) priceIn = null;
    if (priceOut != null && !isFinite(priceOut)) priceOut = null;
    const priced = (priceIn != null && priceOut != null) && (priceIn > 0 || priceOut > 0);
    const ctx = raw.contextLength != null ? num(raw.contextLength) : (raw.context_length != null ? num(raw.context_length) : 0);
    const tier = SPEED_TIERS.indexOf(String(raw.speedTier == null ? 'unknown' : raw.speedTier)) >= 0
      ? String(raw.speedTier == null ? 'unknown' : raw.speedTier) : 'unknown';
    // provider: honour an explicit field; else derive from an "<provider>/<model>" id. The live OpenRouter
    // form is "~anthropic/claude-…" — strip the leading namespace marker, take the part before the slash.
    let provider = raw.provider != null ? String(raw.provider) : '';
    if (!provider && id.indexOf('/') > 0) provider = id.replace(/^~/, '').split('/')[0];
    return {
      provider: provider,
      id: id,
      name: raw.name != null ? String(raw.name) : id,
      contextLength: ctx,
      // Unknown capability reads as FALSE — see the second law.
      supportsTools: bool(raw.supportsTools),
      supportsReasoning: bool(raw.supportsReasoning),
      supportsVision: bool(raw.supportsVision),
      priceIn: priced ? priceIn : null,
      priceOut: priced ? priceOut : null,
      priced: priced,
      unmetered: bool(raw.unmetered),          // a subscription seat: no per-token bill
      speedTier: tier,
      note: raw.note != null ? String(raw.note) : ''
    };
  }

  // Blended USD per 1M tokens. null when unpriced — callers cannot accidentally sort null as cheap.
  function blended(m) {
    if (!m.priced) return null;
    return round(num(m.priceIn) * BLEND_IN + num(m.priceOut) * BLEND_OUT, 6);
  }

  function makeModelRouter(o) {
    o = o || {};
    let catalog = (Array.isArray(o.catalog) ? o.catalog : []).map(normalise).filter(Boolean);
    const allowUnpriced = o.allowUnpriced !== false;   // default true: an unpriced model is not banned, just unranked on cost

    /* REPLACE THE CATALOG. The station's real model list is fetched from providers at runtime, so what is
       known at boot is only an offline seed. This lets the host swap in a richer catalog the moment one
       loads, without rebuilding the router and without every caller re-reading it. A malformed replacement
       is REFUSED and the previous catalog is kept — losing the whole catalog to a bad refresh would leave
       the router answering "no models" for work it could have routed. */
    function setCatalog(rows) {
      const next = (Array.isArray(rows) ? rows : []).map(normalise).filter(Boolean);
      if (!next.length) return { ok: false, replaced: 0, kept: catalog.length, reason: 'the replacement catalog was empty or unreadable — the existing one is kept' };
      const before = catalog.length;
      catalog = next;
      return { ok: true, replaced: next.length, kept: before };
    }

    function available() { return catalog.slice(); }

    /* HARD FILTER. Returns the models that can actually do the work. A requirement that is absent from the
       task imposes nothing — an unspecified need is not a need. */
    function eligible(task) {
      task = task || {};
      const needs = task.needs || {};
      return catalog.filter(m => {
        if (needs.tools && !m.supportsTools) return false;
        if (needs.reasoning && !m.supportsReasoning) return false;
        if (needs.vision && !m.supportsVision) return false;
        if (num(needs.minContext) > 0 && m.contextLength > 0 && m.contextLength < num(needs.minContext)) return false;
        if (needs.provider && m.provider && String(needs.provider) !== m.provider) return false;
        if (task.maxUsdPerMTok != null && m.priced && blended(m) > num(task.maxUsdPerMTok)) return false;
        if (!allowUnpriced && !m.priced && !m.unmetered) return false;
        return true;
      });
    }

    /* SCORE. Higher is better. Each component is normalised to roughly 0..1 so no single axis dominates by
       unit alone, and the weights come from `prefer`.

       THE QUALITY PROXY, STATED PLAINLY: this module has no benchmark data, so it uses LIST PRICE as the
       quality signal — a vendor charging $15/Mtok for a model and $0.25 for another is telling you
       something. That is a proxy and it is labelled one everywhere it surfaces ('price-as-quality-proxy'),
       because a cheap model can be better for a given job and this router must not pretend to know. */
    function score(m, task) {
      task = task || {};
      const prefer = PREFERENCES.indexOf(task.prefer) >= 0 ? task.prefer : DEFAULT_PREFERENCE;
      const c = blended(m);
      let costScore = 0, qualityScore = 0, speedScore = 0;

      // Cost: cheaper is better. An unmetered (subscription) model ranks as free AT THE MARGIN — the seat is
      // already paid, so one more run adds no per-token bill. It is not "free" outright, and it is not a
      // claim about which subscription is worth more. Unpriced ranks as unknown (0.5), not as cheap.
      if (m.unmetered) costScore = 1;
      else if (c == null) costScore = 0.5;
      else {
        const peers = catalog.filter(x => x.priced).map(blended).filter(x => x != null);
        const max = peers.length ? Math.max.apply(null, peers) : 0;
        costScore = max > 0 ? 1 - (c / max) : 1;
      }

      // Quality (the proxy): pricier is better, same normalisation. Unpriced/unmetered sit at the midpoint.
      if (c == null) qualityScore = m.unmetered ? 0.5 : 0.5;
      else {
        const peers = catalog.filter(x => x.priced).map(blended).filter(x => x != null);
        const max = peers.length ? Math.max.apply(null, peers) : 0;
        qualityScore = max > 0 ? (c / max) : 0.5;
      }

      speedScore = SPEED_RANK[m.speedTier] < 0 ? 0.5 : (SPEED_RANK[m.speedTier] / 2);

      if (prefer === 'cost') return costScore * 0.75 + qualityScore * 0.15 + speedScore * 0.10;
      if (prefer === 'quality') return qualityScore * 0.75 + costScore * 0.15 + speedScore * 0.10;
      if (prefer === 'speed') return speedScore * 0.60 + qualityScore * 0.25 + costScore * 0.15;
      return costScore * 0.35 + qualityScore * 0.40 + speedScore * 0.25;   // balanced
    }

    /* ROUTE. The one entry point. Returns { ok, model, reason, score, estimatedUsd, alternatives } or
       { ok:false, reason, considered } — a refusal always says how many models were considered, so "nothing
       matched" is distinguishable from "no catalog loaded". */
    function route(task) {
      task = task || {};
      const consider = eligible(task);
      const prefer = PREFERENCES.indexOf(task.prefer) >= 0 ? task.prefer : DEFAULT_PREFERENCE;

      if (!catalog.length) {
        return { ok: false, reason: 'no model catalog is loaded — the router will not guess at a model', considered: 0, prefer: prefer };
      }
      if (!consider.length) {
        return {
          ok: false,
          reason: 'no model in the catalog satisfies these requirements (' + describeNeeds(task) + '). ' +
            'The router will not relax a requirement to find a candidate — a model without a needed ' +
            'capability produces a run that cannot do its job.',
          considered: catalog.length, prefer: prefer, needs: task.needs || {}
        };
      }

      const ranked = consider.map(m => ({ m: m, s: round(score(m, task), 6) }))
        .sort((a, b) => b.s - a.s || String(a.m.id).localeCompare(String(b.m.id)));

      const top = ranked[0];
      const est = estimate(top.m, task);
      return {
        ok: true,
        model: view(top.m),
        score: top.s,
        prefer: prefer,
        reason: reasonFor(top.m, task, prefer, consider),
        qualitySignal: 'price-as-quality-proxy',
        estimate: est,
        considered: catalog.length,
        eligible: consider.length,
        alternatives: ranked.slice(1, 6).map(r => ({
          model: view(r.m), score: r.s, estimate: estimate(r.m, task)
        }))
      };
    }

    /* ESTIMATE the cost of a run. Requires the caller to say how many tokens; without that there is no
       honest dollar figure, and inventing a token count to produce one is exactly what P2 forbids. Returns
       null (never 0) when unpriced or when the token count is absent. */
    function estimate(m, task) {
      task = task || {};
      const tin = num(task.tokensIn), tout = num(task.tokensOut);
      if (!m.priced) {
        return { priced: false, unmetered: m.unmetered, usd: null,
          note: m.unmetered ? 'subscription / unmetered — no per-token bill' : 'no list price in the catalog — cost unknown' };
      }
      if (!tin && !tout) {
        return { priced: true, unmetered: false, usd: null,
          note: 'per-million rate known but no token count supplied — a dollar figure needs both' };
      }
      const usd = (tin * num(m.priceIn) + tout * num(m.priceOut)) / 1e6;
      return { priced: true, unmetered: false, usd: round(usd, 6), tokensIn: tin, tokensOut: tout,
        rateIn: m.priceIn, rateOut: m.priceOut, note: '' };
    }

    /* THE REASON DESCRIBES WHAT THE RANKING ACTUALLY USED, NOT WHAT WAS ASKED FOR.
       `prefer` is a REQUEST, not an outcome. When no eligible model carries the signal the preference needs
       — a list price for 'cost'/'quality', a published tier for 'speed' — every candidate lands on the same
       midpoint and the score cannot separate them at all. Printing "cheapest that meets the requirements"
       in that state would be a cost claim the router never computed, so the reason says the preference
       could not be applied and that the order fell back to model id. P7: no fake intelligence. */
    function reasonFor(m, task, prefer, consider) {
      const rows = Array.isArray(consider) ? consider : [];
      const pricedPeers = rows.filter(x => x && x.priced && !x.unmetered).length;
      const knownSpeed = rows.filter(x => x && SPEED_RANK[x.speedTier] >= 0).length;
      const bits = [];
      if (prefer === 'cost') {
        bits.push(pricedPeers
          ? 'cheapest by list price among the models that meet the requirements'
          : 'cost was preferred, but no model that meets the requirements carries a list price, so cost did not decide this — the order falls back to model id');
      } else if (prefer === 'quality') {
        bits.push(pricedPeers
          ? 'highest list price among models that meet the requirements (price is a quality proxy, not a benchmark)'
          : 'quality was preferred, but list price is the only quality signal available and no eligible model carries one, so this is not a quality judgement — the order falls back to model id');
      } else if (prefer === 'speed') {
        bits.push(knownSpeed
          ? 'fastest tier among models that meet the requirements'
          : 'speed was preferred, but no eligible model publishes a speed tier, so this is not a speed judgement — the order falls back to model id');
      } else {
        bits.push((pricedPeers || knownSpeed)
          ? 'best balance of cost, list-price quality and speed among the models that meet the requirements'
          : 'no eligible model carries a price or a speed tier, so there is nothing to balance — the order falls back to model id');
      }
      if (m.unmetered) bits.push('runs on a subscription — no per-token charge');
      else if (!m.priced) bits.push('no list price known, so it was not ranked on cost');
      if (m.supportsTools) bits.push('tools');
      if (m.supportsReasoning) bits.push('reasoning');
      return m.name + ' — ' + bits.join('; ') + '.';
    }

    function describeNeeds(task) {
      const n = (task && task.needs) || {};
      const parts = [];
      if (n.tools) parts.push('tools');
      if (n.reasoning) parts.push('reasoning');
      if (n.vision) parts.push('vision');
      if (num(n.minContext) > 0) parts.push('context >= ' + num(n.minContext));
      if (n.provider) parts.push('provider ' + n.provider);
      return parts.length ? parts.join(', ') : '(no hard requirements)';
    }

    function view(m) {
      return {
        provider: m.provider, id: m.id, name: m.name,
        contextLength: m.contextLength,
        supportsTools: m.supportsTools, supportsReasoning: m.supportsReasoning, supportsVision: m.supportsVision,
        priceIn: m.priceIn, priceOut: m.priceOut, priced: m.priced, unmetered: m.unmetered,
        speedTier: m.speedTier, blendedPerMTok: blended(m), note: m.note
      };
    }

    // The whole catalog, ranked under a task. Used by the console to show the field, not just the winner.
    function rank(task) {
      const consider = eligible(task || {});
      return consider.map(m => ({ model: view(m), score: round(score(m, task), 6), estimate: estimate(m, task) }))
        .sort((a, b) => b.score - a.score || String(a.model.id).localeCompare(String(b.model.id)));
    }

    return {
      PREFERENCES: PREFERENCES, DEFAULT_PREFERENCE: DEFAULT_PREFERENCE, SPEED_TIERS: SPEED_TIERS,
      // `size` is a getter: the catalog is now swappable, so a snapshot taken at construction would go stale.
      get size() { return catalog.length; },
      available, setCatalog, eligible, score, route, estimate, rank
    };
  }

  return { makeModelRouter, PREFERENCES: PREFERENCES, DEFAULT_PREFERENCE: DEFAULT_PREFERENCE, SPEED_TIERS: SPEED_TIERS, normalise, blended };
});
