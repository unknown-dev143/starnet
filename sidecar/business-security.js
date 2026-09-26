/* sidecar/business-security.js — §13's SECURITY CENTER (Business OS Phase 10).

   WHAT THIS IS. The audit's §6 item 6 recorded the gap precisely: "permissions + audit exist; the combined
   view does not." Both halves are already built and already honest:

     • business-permissions.js — the TIER table. Every action the system can take is classified `safe` /
       `review` / `restricted`, fail-closed, with a `restricted` class that is never grantable.
     • business-agents-store.js — each hired agent carries its OWN `grants`, sanitised by the permissions
       module so `restricted` is forced false.
     • business-activity-store.js — the append-only audit trail (actor, action, result, approval, detail).
     • business-approvals-store.js — every review-tier action waiting on a human decision.

   This module does NOT add a store and does NOT re-derive any of those facts. Its whole job is to READ the
   four of them together, for one business, and answer the question the four separately cannot: **who can do
   what, what has actually happened, and what is waiting for me right now.** That is the Security Center.

   THE HONESTY RULES THAT SHAPE IT (P1/P2/P7):

   1. NO SCORE. §13 has a natural trap: a "security score" or a "risk level" would be invented — the four
      sources do not contain the information such a number would need (there is no threat model here, no
      exploit surface measurement). So there is no score, no grade, no colour traffic-light. What is
      reported is exactly what is recorded, counted and named.

   2. EFFECTIVE POWER IS COMPUTED, NOT ASSERTED. The one genuinely useful derivation is which CAPABILITIES
      the workforce currently holds: the union of every agent's grants, mapped back to the actions they
      unlock. That is arithmetic over stored facts (a set union), not a judgement, so it is allowed — and it
      is the single most useful thing a security view can state ("what can this business currently do").

   3. A REFUSAL IS NOT A FAILURE. `restricted` actions are listed as `neverGrantable:true` — the honest
      framing is that they are structurally held, not that they are a hole. An action nobody holds is
      reported as `heldBy: []`, which reads as "nobody", never as "unknown".

   4. COUNTS ARE COUNTS. `pendingApprovals` is a real count of open rows. If the approvals store cannot be
      read, the block says so rather than reporting zero — absence of data is never the same as zero
      (the same rule the intelligence engine's `latest()` follows).

   PURE-ish: every source is injected. No IO of its own. UMD. */

'use strict';
(function (root, factory) {
  const P = (typeof module !== 'undefined' && module.exports)
    ? require('./business-permissions.js')
    : ((root.SK && root.SK.businessPermissions) || null);
  const api = factory(P);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).businessSecurity = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (P) {
  'use strict';

  // How many audit rows the overview shows inline. The full trail has its own window; this is a SUMMARY.
  const AUDIT_PREVIEW = 12;
  const MAX_TEXT = 400;
  // When a row has no `at`, it must not sort as "just now" or as 1970 — it sorts last and says so.
  const NO_TIME = -1;

  function str(v, cap) {
    const s = (v == null ? '' : String(v));
    return s.length > (cap || MAX_TEXT) ? s.slice(0, cap || MAX_TEXT) + '…' : s;
  }

  /* THE TIER VIEW — one row per §13 action, carrying what the tier table says PLUS who currently holds it.
     `heldBy` is computed from the injected agent grants; a `restricted` action is marked `neverGrantable`
     because the permissions module is built so that no grant can ever turn it on. */
  function tierRows(heldByAction) {
    const actions = (P && P.ACTIONS) || [];
    return actions.map(function (a) {
      const holders = heldByAction[a.id] || [];
      return {
        id: a.id,
        label: a.label,
        tier: a.tier,
        note: a.note || '',
        /* A restricted action is not "currently granted by nobody" in a worrying sense — it is structurally
           un-grantable. Naming that distinction is the difference between a security view and a scare. */
        neverGrantable: a.tier === 'restricted',
        heldBy: holders.slice().sort(),
        holderCount: holders.length
      };
    });
  }

  /* MAP tier grants -> the actions they unlock.
     A grant is keyed by TIER (`safe` / `review`), NOT by action id: holding `{review:true}` unlocks every
     review-tier action, exactly as `decide()` reads it. So "who holds action X" is "every agent holding the
     grant for X's tier" — a set union over stored rows, not an inference. This is the ONE place the two
     vocabularies (tiers and action ids) meet, and it is derived from `classify()` so it cannot disagree
     with the authority the system actually enforces. */
  function holdersByAction(agents) {
    const out = {};
    const actions = (P && P.ACTIONS) || [];
    (Array.isArray(agents) ? agents : []).forEach(function (ag) {
      ag = ag || {};
      const g = (ag.grants && typeof ag.grants === 'object') ? ag.grants : {};
      const who = ag.name ? (ag.name + (ag.role ? ' (' + ag.role + ')' : '')) : (ag.id || 'agent');
      actions.forEach(function (a) {
        /* `restricted` is never grantable — the permissions module forces that grant false on read — so a
           restricted action can never appear in anyone's held list, however the row was written. */
        if (a.tier === 'restricted') return;
        if (!g[a.tier]) return;
        if (!out[a.id]) out[a.id] = [];
        out[a.id].push(who);
      });
    });
    return out;
  }

  /* THE CAPABILITY SUMMARY — the one derivation. For each tier, how many of its actions are HELD by at
     least one agent. This is a count over the union computed above. It is the honest answer to "what can
     this workforce do right now", and it deliberately stops short of any verdict about whether that is
     too much. */
  function capabilitySummary(tiers) {
    const byTier = {};
    (Array.isArray(tiers) ? tiers : []).forEach(function (t) {
      if (!byTier[t.tier]) byTier[t.tier] = { tier: t.tier, actions: 0, held: 0, neverGrantable: 0 };
      byTier[t.tier].actions += 1;
      if (t.holderCount > 0) byTier[t.tier].held += 1;
      if (t.neverGrantable) byTier[t.tier].neverGrantable += 1;
    });
    return ((P && P.TIERS) || Object.keys(byTier)).map(function (tier) {
      const row = byTier[tier] || { tier: tier, actions: 0, held: 0, neverGrantable: 0 };
      row.note = (P && P.TIER_NOTES && P.TIER_NOTES[tier]) || '';
      return row;
    });
  }

  /* AGENT ROWS — each hired agent with the TIER grants it actually holds, and the actions those unlock.
     An agent holding nothing reads as holding nothing (an empty list), which is a true and useful fact. */
  function agentRows(agents, byAction) {
    const actions = (P && P.ACTIONS) || [];
    return (Array.isArray(agents) ? agents : []).map(function (ag) {
      ag = ag || {};
      const g = (ag.grants && typeof ag.grants === 'object') ? ag.grants : {};
      const heldTiers = ['safe', 'review'].filter(function (t) { return !!g[t]; });
      const held = actions.filter(function (a) { return heldTiers.indexOf(a.tier) >= 0; }).map(function (a) { return a.id; });
      return {
        id: ag.id || '',
        name: ag.name || '(unnamed seat)',
        role: ag.role || '',
        specialty: ag.specialty || '',
        status: ag.status || '',
        /* the stored grants, named — this is what the agent store actually carries */
        grantedTiers: heldTiers,
        /* the actions those grants unlock, derived — the useful reading of the above */
        heldActions: held.slice().sort(),
        heldCount: held.length,
        /* Report whether the agent holds anything review-tier, because that is the one thing a reader
           scanning this list needs to notice: authority that did NOT pause for a human. */
        holdsReview: heldTiers.indexOf('review') >= 0,
        /* always false, and said out loud rather than omitted: no grant can ever turn this on */
        holdsRestricted: false
      };
    });
  }

  /* BUILD the whole Security Center read for one business. Sources are injected; a source that throws is
     reported as unreadable rather than crashing the view or being silently shown as empty. */
  function makeBusinessSecurity(opts) {
    opts = opts || {};
    const agents = typeof opts.agents === 'function' ? opts.agents : (function () { return []; });
    const activity = typeof opts.activity === 'function' ? opts.activity : (function () { return []; });
    const pending = typeof opts.pending === 'function' ? opts.pending : null;

    function byActionMap() {
      const d = {};
      ((P && P.ACTIONS) || []).forEach(function (a) { d[a.id] = a; });
      return d;
    }

    function overview(businessId) {
      const bid = str(businessId, 120).trim();
      if (!bid) return { ok: false, reason: 'a businessId is required (isolation is by key — never implied)' };

      // --- sources, each read defensively and each reportable as unavailable --------------------------
      let agentList = [];
      let agentsReadable = true;
      try { agentList = agents(bid) || []; }
      catch (e) { agentList = []; agentsReadable = false; }

      let auditRows = [];
      let auditReadable = true;
      try {
        /* A source may hand back { rows, ok } or a bare array. Both shapes are accepted because the point
           is to read what exists, not to force a calling convention. */
        const raw = activity(bid, { limit: AUDIT_PREVIEW });
        if (raw && Array.isArray(raw.rows)) { auditRows = raw.rows; auditReadable = raw.ok !== false; }
        else { auditRows = Array.isArray(raw) ? raw : []; }
      } catch (e) { auditRows = []; auditReadable = false; }

      let pendingApprovals = null;                    // null = NOT READ, which is not the same as 0
      if (pending) {
        try { const n = pending(bid); pendingApprovals = Number.isFinite(n) ? n : null; }
        catch (e) { pendingApprovals = null; }
      }

      // --- derived read -------------------------------------------------------------------------------
      const holders = holdersByAction(agentList);
      const tiers = tierRows(holders);
      const caps = capabilitySummary(tiers);
      const amap = byActionMap();

      /* RECENT DECISIONS. The audit trail is filtered to the rows that are about AUTHORITY rather than
         about ordinary work: an approval decision, or an action whose tier is review/restricted. Ordinary
         activity belongs in the activity log; this view is about who was allowed to do what. */
      const decisions = (auditRows || []).map(function (r) {
        r = r || {};
        const detail = amap[r.action];
        const tier = detail && detail.tier;
        const aboutAuthority = r.approval === 'required' || r.approval === 'granted' || r.approval === 'denied'
          || tier === 'review' || tier === 'restricted';
        return {
          id: r.id || '',
          at: (r.at != null ? r.at : NO_TIME),
          actor: (r.actor && r.actor.kind) || 'system',
          actorName: (r.actor && r.actor.name) || '',
          action: r.action || '',
          actionLabel: (detail && detail.label) || '',
          tier: tier || '',
          result: r.result || '',
          approval: r.approval || '',
          reason: str(r.reason, MAX_TEXT),
          detail: str(r.detail, MAX_TEXT),
          aboutAuthority: !!aboutAuthority
        };
      }).sort(function (a, b) { return b.at - a.at; });

      /* How many agents hold the review-tier grant — the count of seats whose authority does not pause. */
      const reviewHeld = agentList.reduce(function (acc, ag) {
        const g = (ag && ag.grants) || {};
        return acc + (g.review ? 1 : 0);
      }, 0);

      return {
        ok: true,
        businessId: bid,
        /* What the workforce can currently do, per tier. Counts, not a verdict. */
        capabilities: caps,
        /* Every §13 action with the named holders — the "who can do what" table. */
        tiers: tiers,
        /* Each seat with the capabilities it holds. */
        agents: agentRows(agentList, amap),
        agentCount: agentList.length,
        /* The authority slice of the audit trail, newest first. */
        decisions: decisions,
        decisionCount: decisions.length,
        /* Open approvals waiting on a human. `null` means "could not be read" — never a fake 0. */
        pendingApprovals: pendingApprovals,
        /* Totals a reader can quote without doing arithmetic in their head. */
        totals: {
          actions: tiers.length,
          held: tiers.filter(function (t) { return t.holderCount > 0; }).length,
          neverGrantable: tiers.filter(function (t) { return t.neverGrantable; }).length,
          reviewActionsHeld: reviewHeld
        },
        /* Honest availability flags. If a source was unreadable the view SAYS SO rather than showing an
           empty table that looks like a clean bill of health. */
        availability: {
          agents: agentsReadable,
          audit: auditReadable,
          approvals: pendingApprovals !== null
        },
        /* The one thing this view must never be mistaken for. */
        note: 'A read of what is recorded. No score, no grade — the tier table, the grants actually held, '
          + 'and the authority decisions in the log. An absent source is reported as unavailable, never as zero.'
      };
    }

    /* THE FULL AUDIT SLICE for one business. Separate from overview() because the Security Center shows a
       preview and the full trail has its own window; both read the same store, neither re-implements it. */
    function audit(businessId, o) {
      const bid = str(businessId, 120).trim();
      if (!bid) return { ok: false, reason: 'a businessId is required' };
      const limit = (o && Number.isFinite(o.limit) && o.limit > 0) ? Math.floor(o.limit) : 50;
      let rows = [];
      try {
        const raw = activity(bid, { limit: limit });
        if (raw && Array.isArray(raw.rows)) rows = raw.rows;
        else rows = Array.isArray(raw) ? raw : [];
      } catch (e) {
        return { ok: true, businessId: bid, rows: [], readable: false, note: 'the activity log could not be read' };
      }
      const amap = byActionMap();
      return {
        ok: true,
        businessId: bid,
        readable: true,
        rows: rows.map(function (r) {
          r = r || {};
          const d = amap[r.action];
          return {
            id: r.id || '',
            at: (r.at != null ? r.at : NO_TIME),
            actor: (r.actor && r.actor.kind) || 'system',
            actorName: (r.actor && r.actor.name) || '',
            action: r.action || '',
            actionLabel: (d && d.label) || '',
            tier: (d && d.tier) || '',
            result: r.result || '',
            approval: r.approval || '',
            reason: str(r.reason, MAX_TEXT),
            detail: str(r.detail, MAX_TEXT)
          };
        })
      };
    }

    /* THE CATALOG — the tier table itself, for the "what are the rules" pane. No holders here: this is the
       policy, not the state. */
    function catalog() {
      return {
        tiers: (P && P.catalog) ? P.catalog() : [],
        defaultGrants: (P && P.DEFAULT_GRANTS) || {},
        risks: (P && P.RISKS) || [],
        evidence: (P && P.EVIDENCE) || [],
        tierNotes: (P && P.TIER_NOTES) || {}
      };
    }

    return { overview: overview, audit: audit, catalog: catalog };
  }

  return {
    makeBusinessSecurity,
    AUDIT_PREVIEW: AUDIT_PREVIEW,
    /* exported for the tests to exercise the arithmetic without a store */
    holdersByAction, capabilitySummary, tierRows, agentRows
  };
});
