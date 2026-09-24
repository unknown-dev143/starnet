/* sidecar/business-permissions.js — the ACTION PERMISSION SYSTEM (master prompt §13) and the §26
   Proposed Action block. This is the module that answers, for any action a business agent wants to take,
   ONE question: may it run on its own, or does a human have to say yes first?

   WHY THIS IS NOT sidecar/permissions.js (read that module's header before touching this one). The
   existing permissions.js is the RUNTIME TOOL-CALL CONSENT BROKER: it sits in the dispatch pipeline and
   gates an individual tool invocation (its four-tier ladder is hardline/bypass/cache/resolve). This module
   is the DECLARATIVE BUSINESS-ACTION MODEL: a closed catalogue of business action CLASSES, each assigned one
   of §13's three tiers, plus a per-agent grant set. They compose rather than compete — a business action
   classified `review` becomes a pending approval HERE; if it is ever executed, the resulting tool call still
   passes through the consent broker at the dispatch edge (Phase 6). Neither duplicates the other, and
   merging them would put business vocabulary into the hot path of every tool call.

   §13's THREE TIERS, verbatim:
     safe        — runs automatically
     review      — needs user approval
     restricted  — cannot run without explicit authorization and safeguards

   THE HARD FLOOR (fail-closed, and the reason this module is worth having). Two rules cannot be talked
   around by any input:
     1. An action this module has NOT classified is treated as `restricted`, never as `safe`. A new action
        that nobody classified must not silently inherit "runs automatically" — that is exactly how an
        agent ends up deleting something nobody told it to touch.
     2. `restricted` is NEVER auto-grantable. sanitizeGrants() forces `restricted: false` regardless of
        what a caller or a hand-edited JSON file passes, so no stored grant can turn a restricted action
        into an autonomous one. (Same shape as the consent broker's hardline floor: a rule no flag reaches
        past.)

   §26 — PROPOSED ACTION. Before a significant action, agents surface a block: what / why / evidence / risk /
   expected effect / approval. P1 applies structurally: a block with no evidence behind it is REFUSED, and
   evidence that is entirely `unknown` is refused too — an action nobody can justify must not be presented
   to the user pre-justified. The evidence vocabulary is imported from opportunities-store.js so the two
   modules can never disagree about what an evidence class is.

   PURE: no IO, no clock, no env, no rng, no network. UMD: `SK.businessPermissions` in the browser,
   module.exports under node. */

'use strict';
(function (root, factory) {
  const evidence = (typeof module !== 'undefined' && module.exports)
    ? require('./opportunities-store.js').EVIDENCE
    : ((root.SK && root.SK.businessOpportunitiesStore && root.SK.businessOpportunitiesStore.EVIDENCE)
        || ['verified', 'analysis', 'assumption', 'estimate', 'prediction', 'unknown']);
  const api = factory(evidence);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).businessPermissions = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (EVIDENCE) {
  'use strict';

  const TIERS = ['safe', 'review', 'restricted'];

  // §13's own wording, so the UI quotes the spec instead of restating it.
  const TIER_NOTES = {
    safe: 'runs automatically',
    review: 'needs your approval',
    restricted: 'cannot run without explicit authorization and safeguards'
  };

  /* THE ACTION CATALOGUE. §13 names the review list explicitly ("spending money · sending important
     external communications · publishing business content · changing production infrastructure · deleting
     data · accessing sensitive information · making legally significant commitments"). The three
     irreversible/high-stakes ones are promoted to `restricted` because §13 reserves that tier for actions
     needing "explicit authorization AND safeguards" — a refund is reviewable, a production teardown is not.
     The safe set is the read/draft/analyse class: producing work is not the same as committing it. */
  const ACTIONS = [
    { id: 'research', label: 'Research', tier: 'safe',
      note: 'Read public sources — the live web, docs, competitor pages. Nothing leaves the station.' },
    { id: 'draft', label: 'Draft', tier: 'safe',
      note: 'Produce a local draft or working file. A draft is not a publication.' },
    { id: 'analyze', label: 'Analyse', tier: 'safe',
      note: 'Compute from data the business already holds.' },
    { id: 'plan', label: 'Plan', tier: 'safe',
      note: 'Write a plan or a task breakdown.' },
    { id: 'read_local', label: 'Read business records', tier: 'safe',
      note: 'Read this business\'s own files and records.' },
    { id: 'report', label: 'Report', tier: 'safe',
      note: 'Summarise what was found.' },

    { id: 'spend_money', label: 'Spend money', tier: 'review',
      note: '§13 — spending money requires review.' },
    { id: 'external_comms', label: 'Send external communication', tier: 'review',
      note: '§13 — sending an important external communication requires review.' },
    { id: 'publish_content', label: 'Publish content', tier: 'review',
      note: '§13 — publishing business content requires review.' },

    { id: 'change_infra', label: 'Change production infrastructure', tier: 'restricted',
      note: '§13 — changing production infrastructure is restricted: explicit authorization and safeguards.' },
    { id: 'delete_data', label: 'Delete data', tier: 'restricted',
      note: '§13 — deleting data is restricted: explicit authorization and safeguards.' },
    { id: 'access_sensitive', label: 'Access sensitive information', tier: 'restricted',
      note: '§13 — accessing sensitive information is restricted: explicit authorization and safeguards.' },
    { id: 'legal_commitment', label: 'Make a legal commitment', tier: 'restricted',
      note: '§13 — a legally significant commitment is restricted: explicit authorization and safeguards.' }
  ];

  const ACTION_IDS = ACTIONS.map(a => a.id);
  const RISKS = ['low', 'medium', 'high'];

  // The tier an unclassified action is treated as. NOT 'safe' — see the hard floor in the header.
  const UNKNOWN_TIER = 'restricted';

  // A brand-new agent may run safe actions and nothing else. review is opt-in per agent; restricted is never.
  const DEFAULT_GRANTS = { safe: true, review: false, restricted: false };

  const str = (v, cap) => (v == null ? '' : String(v)).slice(0, cap == null ? 2000 : cap);

  function byId(id) {
    const k = String(id == null ? '' : id);
    for (const a of ACTIONS) if (a.id === k) return a;
    return null;
  }

  /* classify(id) -> { ok, id, label, tier, note } for a known action, or
                     { ok:false, id, tier:'restricted', reason } for an unknown one.
     The failure still carries a tier so a caller that ignores `ok` still lands on the safe side. */
  function classify(id) {
    const k = String(id == null ? '' : id);
    const a = byId(k);
    if (!a) {
      return {
        ok: false, id: k, tier: UNKNOWN_TIER, label: k,
        reason: 'unknown action "' + k + '" — an action this system has not classified is treated as the most restrictive tier, never as safe (fail-closed). Known actions: ' + ACTION_IDS.join(', ')
      };
    }
    return { ok: true, id: a.id, label: a.label, tier: a.tier, note: a.note };
  }

  /* GRANTS. Merge over `base` (default DEFAULT_GRANTS) so a partial update is legal, then FORCE
     restricted:false. That last line is the hard floor: no input — request body, hand-edited JSON, or a
     future caller — can produce a grant set with an autonomous restricted tier. */
  function sanitizeGrants(g, base) {
    const b = (base && typeof base === 'object') ? base : DEFAULT_GRANTS;
    const src = (g && typeof g === 'object') ? g : {};
    return {
      safe: src.safe === undefined ? !!b.safe : !!src.safe,
      review: src.review === undefined ? !!b.review : !!src.review,
      restricted: false
    };
  }

  /* decide({ action, grants }) -> { allow, tier, approval, action, reason }.
     `approval` is 'not-required' exactly when the action may run unattended; otherwise 'required'. */
  function decide(input) {
    input = input || {};
    const c = classify(input.action);
    const g = sanitizeGrants(input.grants);

    if (!c.ok) {
      return { allow: false, tier: c.tier, approval: 'required', action: c.id, reason: c.reason };
    }
    if (c.tier === 'restricted') {
      return {
        allow: false, tier: c.tier, approval: 'required', action: c.id,
        reason: 'a restricted action is never auto-run — it needs explicit authorization and safeguards (§13)'
      };
    }
    if (c.tier === 'review') {
      return g.review
        ? { allow: true, tier: c.tier, approval: 'not-required', action: c.id, reason: 'this agent holds the review-tier grant' }
        : { allow: false, tier: c.tier, approval: 'required', action: c.id, reason: 'a review-tier action — this agent has not been granted it' };
    }
    return g.safe
      ? { allow: true, tier: c.tier, approval: 'not-required', action: c.id, reason: 'a safe action — runs automatically' }
      : { allow: false, tier: c.tier, approval: 'required', action: c.id, reason: 'this agent holds no safe-tier grant, so nothing runs' };
  }

  // Normalise an evidence list to [{ text, evidence, source }]. An item with no text is dropped; an item
  // whose class is not in the shared vocabulary is labelled 'unknown' rather than silently accepted.
  function normalizeEvidence(list) {
    const out = [];
    for (const raw of (Array.isArray(list) ? list : [])) {
      if (raw == null) continue;
      const text = typeof raw === 'string' ? str(raw, 1000) : str(raw.text, 1000);
      if (!text) continue;
      const ev = (raw && typeof raw === 'object' && EVIDENCE.indexOf(String(raw.evidence)) >= 0)
        ? String(raw.evidence) : 'unknown';
      out.push({ text: text, evidence: ev, source: str(raw && raw.source, 300) });
    }
    return out;
  }

  /* §26 PROPOSED ACTION. Returns { ok:true, block } where block is the six-line structure the spec shows:
     what · why · evidence · risk · effect · approval. Refuses (rather than fills in) when a required line
     is missing, because an action presented with a blank "why" or no evidence is worse than no block at all:
     it looks justified. */
  function proposedAction(input) {
    input = input || {};
    const what = str(input.what, 600).trim();
    if (!what) return { ok: false, reason: 'a proposed action needs a "what"' };
    const why = str(input.why, 1000).trim();
    if (!why) return { ok: false, reason: 'a proposed action needs a "why" — an unexplained action must not be put forward for approval' };

    const evidence = normalizeEvidence(input.evidence);
    if (!evidence.length) {
      return { ok: false, reason: 'a proposed action needs at least one evidence item (P1) — an action with nothing behind it must not be presented as justified' };
    }
    if (!evidence.some(e => e.evidence !== 'unknown')) {
      return { ok: false, reason: 'every evidence item is unlabelled/unknown — a proposal whose evidence is entirely unknown has not been justified (P1)' };
    }

    const risk = String(input.risk == null ? '' : input.risk);
    if (RISKS.indexOf(risk) < 0) {
      return { ok: false, reason: 'risk must be one of: ' + RISKS.join(', ') };
    }

    const d = decide({ action: input.action, grants: input.grants });
    return {
      ok: true,
      block: {
        what: what,
        why: why,
        evidence: evidence,
        risk: risk,
        effect: str(input.effect, 1000),
        action: d.action,
        tier: d.tier,
        allow: d.allow,
        approval: d.approval,
        reason: d.reason
      }
    };
  }

  // The catalogue the UI renders, grouped by tier in §13's order.
  function catalog() {
    return TIERS.map(tier => ({
      tier: tier,
      note: TIER_NOTES[tier],
      actions: ACTIONS.filter(a => a.tier === tier).map(a => ({ id: a.id, label: a.label, tier: a.tier, note: a.note }))
    }));
  }

  return {
    TIERS, TIER_NOTES, ACTIONS, ACTION_IDS, RISKS, EVIDENCE, DEFAULT_GRANTS, UNKNOWN_TIER,
    byId, classify, sanitizeGrants, decide, proposedAction, normalizeEvidence, catalog
  };
});
