/* sidecar/mission-control.js — §23's MISSION CONTROL (Business OS Phase 11).

   WHAT THIS IS. The audit's §6 item 5 recorded the gap precisely: "Phase 7 read surfaces exist; no single
   unified mission-control window." Every read a mission view needs is already built and already honest:

     • businesses-store.js        — every venture, its stage and when it last moved
     • intelligence-engine.js     — portfolio() (cross-business metrics) and signals() (per business)
     • business-approvals-store.js — pendingBusinessIds() + pendingCount() (what is waiting on a human)
     • business-activity-store.js — recent() (the cross-business trail)

   This module adds no store. Its whole job is to put those four in ONE place and answer the question a single
   business view cannot: **what is the state of everything I am running, and what needs me next.**

   THE ONE DERIVATION, AND WHY IT IS ALLOWED. Mission Control must rank or it is just four tables stacked. But
   an invented "priority score" would be exactly the fake intelligence the brief forbids (P7). So the ranking
   is not a score — it is a pair of ORDERINGS over facts that are already recorded, and each row CARRIES the
   reasons it was placed where it was:

     • ATTENTION — a business is ranked by what is objectively blocking it: work waiting on the human
       (approvals), then a business that is not operating (paused / winding-down / archived), then a business
       that has not moved in a long time. Each contributes a NAMED reason; nothing contributes an invented
       number. A business with none of those reasons is "quiet" and sorts last.
     • FRESHNESS — the order a person would naturally scan: most recently moved first.

   There is NO blended total, no colour band, no "health". The reasons are the ranking and they are printed.

   HONESTY RULES (P1/P2/P7):
     1. A business with no readings shows `null`, never 0 — the same rule the intelligence engine follows.
     2. An unreadable source is reported as unavailable, never as empty. A pending count that could not be
        read is null and says so.
     3. No score, no grade, no verdict field anywhere in the payload.
     4. Every row is BOUNDED to the fields named here; the composer never invents a metric.

   PURE-ish: every source is injected. No IO of its own. UMD. */

'use strict';
(function (root, factory) {
  const B = (typeof module !== 'undefined' && module.exports)
    ? require('./businesses-store.js')
    : ((root.SK && root.SK.businessesStore) || null);
  const api = factory(B);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).missionControl = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (B) {
  'use strict';

  const MAX_NAME = 120;
  const MAX_REASON = 200;
  const MAX_TRAIL = 30;
  const DEFAULT_STALE_MS = 7 * 24 * 60 * 60 * 1000;   // "has not moved in a while" = 7 days
  const INACTIVE = (B && B.INACTIVE_STAGES) || ['paused', 'winding-down', 'archived'];

  function str(v, cap) {
    const s = (v == null ? '' : String(v));
    return s.length > (cap || MAX_NAME) ? s.slice(0, cap || MAX_NAME) + '…' : s;
  }

  /* ATTENTION REASONS — the named facts that place a business above another. Each is a real, recorded
     condition. `kind` is machine-readable; `text` is what a person reads. Order here IS the precedence: the
     first matching reason decides which band the business lands in. */
  function attentionReasons(biz, ctx) {
    const out = [];
    const stage = String((biz && biz.stage) || 'idea');
    const pending = ctx.pendingByBiz[biz.id];

    if (typeof pending === 'number' && pending > 0) {
      out.push({
        kind: 'waiting-on-you',
        text: pending + ' approval' + (pending === 1 ? '' : 's') + ' waiting on your decision'
      });
    }
    if (INACTIVE.indexOf(stage) >= 0) {
      out.push({
        kind: stage === 'archived' ? 'archived' : stage === 'winding-down' ? 'winding-down' : 'paused',
        text: stage === 'archived'
          ? 'archived — it no longer runs work'
          : stage === 'winding-down'
            ? 'winding down — on its way to archived'
            : 'paused — its work is stopped until you resume it'
      });
    }
    const moved = ctx.now - (Number.isFinite(biz.updatedAt) ? biz.updatedAt : 0);
    if (!Number.isFinite(biz.updatedAt)) {
      out.push({ kind: 'never-moved', text: 'no recorded change yet' });
    } else if (moved > ctx.staleMs) {
      const days = Math.floor(moved / 86400000);
      out.push({ kind: 'stale', text: 'nothing has changed in ' + days + ' day' + (days === 1 ? '' : 's') });
    }
    return out;
  }

  // The precedence band: lower sorts higher. Derived from the first reason only, so the ORDER is explainable.
  const BAND = { 'waiting-on-you': 0, paused: 1, 'winding-down': 1, archived: 2, stale: 3, 'never-moved': 3, quiet: 9 };

  function bandOf(reasons) {
    if (!reasons.length) return BAND.quiet;
    const k = reasons[0].kind;
    return BAND[k] == null ? BAND.stale : BAND[k];
  }

  function makeMissionControl(opts) {
    opts = opts || {};
    const businesses = typeof opts.businesses === 'function' ? opts.businesses : (function () { return []; });
    const portfolio = typeof opts.portfolio === 'function' ? opts.portfolio : null;
    const signals = typeof opts.signals === 'function' ? opts.signals : null;
    const pendingCount = typeof opts.pendingCount === 'function' ? opts.pendingCount : null;
    const pendingIds = typeof opts.pendingIds === 'function' ? opts.pendingIds : null;
    const recent = typeof opts.recent === 'function' ? opts.recent : null;
    /* THE CLOCK IS INJECTED, never read here (determinism lint: no Date.now in a sidecar module). It defaults
       to null, which makes every business read as "no recorded change" rather than silently using wall time —
       index.js passes the real clock in. This is the same shape intelligence-engine.js uses. */
    const now = typeof opts.now === 'function' ? opts.now : (() => null);

    /* THE BOARD — every business, ranked, with the reasons it sits where it sits. */
    function board(o) {
      o = o || {};
      const at = now();
      const staleMs = (Number.isFinite(o.staleMs) && o.staleMs > 0) ? o.staleMs : DEFAULT_STALE_MS;

      // --- sources, each read defensively and each reportable as unavailable -------------------------
      let list = [];
      let businessesReadable = true;
      try { list = businesses() || []; }
      catch (e) { list = []; businessesReadable = false; }

      /* pendingByBiz: map businessId -> count. Built from pendingCount if given (the precise route), else
         from pendingIds (a set with no counts). Whichever came back, an unreadable source leaves the map
         EMPTY and the availability flag FALSE — never a silent zero everywhere. */
      const pendingByBiz = {};
      let approvalsReadable = true;
      if (typeof pendingCount === 'function') {
        for (const b of list) {
          try {
            const n = pendingCount(b && b.id);
            if (Number.isFinite(n) && n > 0) pendingByBiz[b.id] = n;
          } catch (e) { approvalsReadable = false; }
        }
      } else if (typeof pendingIds === 'function') {
        try {
          const ids = pendingIds() || [];
          for (const id of ids) pendingByBiz[id] = (pendingByBiz[id] || 0) + 1;
        } catch (e) { approvalsReadable = false; }
      }

      const ctx = { now: at, staleMs: staleMs, pendingByBiz: pendingByBiz };

      const rows = (Array.isArray(list) ? list : []).map(function (b) {
        b = b || {};
        const reasons = attentionReasons(b, ctx);
        return {
          id: str(b.id),
          name: str(b.name || '(unnamed)'),
          stage: str((b.stage || 'idea'), 40),
          template: str((b.template || 'custom'), 40),
          updatedAt: Number.isFinite(b.updatedAt) ? b.updatedAt : null,
          pending: (typeof pendingByBiz[b.id] === 'number') ? pendingByBiz[b.id] : 0,
          reasons: reasons,
          band: bandOf(reasons),
          /* `quiet` is a fact, not a failing: nothing recorded needs a human. */
          quiet: reasons.length === 0
        };
      });

      // RANK: by band, then by pending count, then by most recently moved. Fully deterministic.
      rows.sort(function (x, y) {
        if (x.band !== y.band) return x.band - y.band;
        if (y.pending !== x.pending) return y.pending - x.pending;
        const xa = x.updatedAt == null ? -1 : x.updatedAt;
        const ya = y.updatedAt == null ? -1 : y.updatedAt;
        if (ya !== xa) return ya - xa;
        return x.id < y.id ? -1 : (x.id > y.id ? 1 : 0);   // stable tiebreak so two reads never disagree
      });

      /* `needsYou` is every business that carries a reason — not only the top band. A paused business and a
         business that has gone quiet both want attention from the same human; naming only the approvals band
         here would under-report the work waiting. `blockedOnYou` is the narrower, precise count. */
      const needsYou = rows.filter(function (r) { return !r.quiet; });
      const blockedOnYou = rows.filter(function (r) { return r.band === 0; });

      return {
        ok: true,
        generatedAt: at,
        businesses: rows,
        counts: {
          businesses: rows.length,
          needsYou: needsYou.length,
          blockedOnYou: blockedOnYou.length,
          quiet: rows.filter(function (r) { return r.quiet; }).length,
          inactive: rows.filter(function (r) { return INACTIVE.indexOf(r.stage) >= 0; }).length,
          /* total pending across the board; null when the approvals source could not be read at all */
          pending: approvalsReadable ? rows.reduce(function (a, r) { return a + (r.pending || 0); }, 0) : null
        },
        /* There is deliberately no `score`, no `health`, no `priority` number and no colour band here. The
           ranking IS the reasons, and they are on every row. */
        note: 'every business with what is recorded against it, ranked by what is blocking it — work waiting on '
          + 'you first, then anything not operating, then anything that has gone quiet. There is no score: the '
          + 'reasons are the ranking.'
      };
    }

    /* THE FLEET READ — the cross-business metrics, passed through from the intelligence engine, plus the
       attention board. Kept as a SEPARATE call because the board must work even when a portfolio cannot be
       built (and vice versa). */
    function fleet(o) {
      o = o || {};
      let pf = null;
      let portfolioReadable = true;
      if (portfolio) {
        try { pf = portfolio(o); }
        catch (e) { pf = null; portfolioReadable = false; }
      }
      return {
        ok: true,
        generatedAt: now(),
        portfolio: pf,
        portfolioReadable: portfolioReadable,
        /* A portfolio that could not be built is null and says so — never an empty metrics list, which
           would read as "nothing measured anywhere". */
        note: portfolioReadable ? '' : 'the cross-business figures could not be built — the board below is still current'
      };
    }

    /* THE ATTENTION LIST — just the businesses that need a human, in rank order. A small, fast read for a
       badge or a summary line. */
    function attention(o) {
      const b = board(o);
      const rows = b.businesses.filter(function (r) { return !r.quiet; });
      return {
        ok: true,
        generatedAt: b.generatedAt,
        rows: rows,
        count: rows.length,
        pending: b.counts.pending
      };
    }

    /* ONE BUSINESS'S ALERT SIGNALS — the persistence/anomaly signals the intelligence engine already computes,
       read through so Mission Control can show "why is this one highlighted" without a second window. */
    function alerts(businessId, o) {
      const id = str(businessId, MAX_NAME).trim();
      if (!id) return { ok: false, reason: 'a businessId is required (isolation is by key — never implied)' };
      if (!signals) return { ok: true, businessId: id, signals: [], readable: false, note: 'signal detection is not wired here' };
      let rows = [];
      let readable = true;
      try { rows = signals(id, o) || []; }
      catch (e) { rows = []; readable = false; }
      return {
        ok: true,
        businessId: id,
        readable: readable,
        signals: (Array.isArray(rows) ? rows : []).map(function (s) {
          s = s || {};
          return { kind: s.kind || '', metric: s.metric || '', label: s.label || '', text: str(s.text, MAX_REASON), direction: s.direction || '' };
        })
      };
    }

    /* THE CROSS-BUSINESS TRAIL — the one deliberate exception to per-business isolation, read through from
       the activity store and capped. Not a substitute for a business's own log. */
    function trail(o) {
      o = o || {};
      const limit = (Number.isFinite(o.limit) && o.limit > 0) ? Math.min(Math.floor(o.limit), MAX_TRAIL) : 12;
      if (!recent) return { ok: true, rows: [], readable: false, note: 'the activity trail is not wired here' };
      let rows = [];
      let readable = true;
      try { rows = recent({ limit: limit }) || []; }
      catch (e) { rows = []; readable = false; }
      return {
        ok: true,
        readable: readable,
        rows: (Array.isArray(rows) ? rows : []).map(function (r) {
          r = r || {};
          return {
            id: str(r.id),
            at: Number.isFinite(r.at) ? r.at : null,
            businessId: str(r.businessId),
            actor: (r.actor && r.actor.kind) || 'system',
            actorName: str((r.actor && r.actor.name) || '', 80),
            action: str(r.action, MAX_REASON),
            result: str(r.result, 40),
            approval: str(r.approval, 40),
            detail: str(r.detail || r.reason || '', MAX_REASON)
          };
        })
      };
    }

    return { board: board, fleet: fleet, attention: attention, alerts: alerts, trail: trail, DEFAULT_STALE_MS: DEFAULT_STALE_MS };
  }

  return { makeMissionControl, attentionReasons, bandOf, BAND, DEFAULT_STALE_MS, INACTIVE };
});
