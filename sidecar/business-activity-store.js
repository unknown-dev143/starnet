/* sidecar/business-activity-store.js — the per-business ACTIVITY LOG (Business OS, Phase 1).

   The readable record of what happened to a business: who did it, why, what came of it, and whether it
   needed approval. This is the store behind master-prompt §20 (audit log) and the per-business "Activity
   logs" surface in §7. It answers, honestly and in order, "show me everything the AI did today".

   ISOLATION (P6). Every call names a businessId, and every read filters strictly on it — there is no
   "all businesses" read except recent(), which is explicitly the cross-business Command Center feed. A
   caller cannot accidentally get another business's rows by omitting an argument: the argument is
   required, and an empty one is REFUSED rather than treated as "everything".

   APPEND-ONLY + BOUNDED. Entries are never edited. A business is capped at `limit` entries (default 500)
   and the OLDEST are dropped on overflow, so a long-running automation cannot grow the file without
   bound. Dropping history is a real cost, so the cap is generous and stated in the header rather than
   hidden.

   PROVENANCE (P1). An entry never asserts more than it was told: `result` and `approval` are closed
   vocabularies, `actor.kind` is one of user/agent/system, and the store invents no timestamp of its own
   (the clock is injected). Nothing here derives a metric, a score, or a success claim.

   PURE: no IO, no clock, no env, no rng. `records` is the live array the composition root shares (so the
   reader serializes the SAME reference the store mutates); `persist` is the durable sink and THROWS on a
   real write failure; `now` is the injected clock. Persist-before-commit (fail-closed), matching
   projects-store.js / businesses-store.js. UMD so a frontend panel can import it. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).businessActivityStore = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Closed vocabularies — a value outside these is REFUSED, never coerced. An activity log that accepts
  // free-text outcomes is an activity log that cannot be trusted to mean anything.
  const RESULTS = ['ok', 'error', 'pending'];
  const APPROVALS = ['not-required', 'required', 'granted', 'denied'];
  const ACTOR_KINDS = ['user', 'agent', 'system'];

  const DEFAULT_LIMIT = 500;
  const MAX_TEXT = 2000;

  function makeBusinessActivityStore(opts) {
    opts = opts || {};
    const records = Array.isArray(opts.records) ? opts.records : [];
    const persist = typeof opts.persist === 'function' ? opts.persist : null;
    const now = typeof opts.now === 'function' ? opts.now : (() => null);
    const limit = (Number.isFinite(opts.limit) && opts.limit > 0) ? Math.floor(opts.limit) : DEFAULT_LIMIT;

    const str = (v, cap) => (v == null ? '' : String(v)).slice(0, cap);
    const forBiz = (businessId) => records.filter(r => r && r.businessId === businessId);
    // newest-first: `seq` is the per-business monotonic counter, so ordering never depends on the clock.
    const newestFirst = (a, b) => (b.seq || 0) - (a.seq || 0);

    function nextSeq(businessId) {
      let max = 0;
      for (const r of records) if (r && r.businessId === businessId && r.seq > max) max = r.seq;
      return max + 1;
    }

    const rowView = (r) => ({
      id: r.id,
      seq: r.seq,
      businessId: r.businessId,
      at: r.at != null ? r.at : null,
      // defensive: a row hand-edited on disk (or written by an older build) must not throw on READ.
      actor: (r.actor && typeof r.actor === 'object')
        ? { kind: r.actor.kind, id: r.actor.id || '', name: r.actor.name || '' }
        : { kind: 'system', id: '', name: '' },
      action: r.action,
      reason: r.reason || '',
      result: r.result,
      approval: r.approval,
      detail: r.detail || ''
    });

    /* APPEND one entry. businessId and action are required; everything else defaults honestly.
       Persist-before-commit: a thrown persist leaves memory untouched and returns ok:false, so an action
       is never recorded as having happened when the record could not be made durable. */
    function append(businessId, event) {
      event = event || {};
      const bid = str(businessId, 120).trim();
      if (!bid) return { ok: false, reason: 'a businessId is required (isolation is by key — never implied)' };
      const action = str(event.action, 200).trim();
      if (!action) return { ok: false, reason: 'an action is required' };

      const result = event.result != null ? String(event.result) : 'ok';
      if (RESULTS.indexOf(result) < 0) return { ok: false, reason: 'unknown result: ' + result };
      const approval = event.approval != null ? String(event.approval) : 'not-required';
      if (APPROVALS.indexOf(approval) < 0) return { ok: false, reason: 'unknown approval: ' + approval };

      const a = event.actor || {};
      const kind = a.kind != null ? String(a.kind) : 'system';
      if (ACTOR_KINDS.indexOf(kind) < 0) return { ok: false, reason: 'unknown actor.kind: ' + kind };

      const seq = nextSeq(bid);
      const entry = {
        id: bid + '#' + seq,
        seq: seq,
        businessId: bid,
        at: now(),
        actor: { kind: kind, id: str(a.id, 120), name: str(a.name, 120) },
        action: action,
        reason: str(event.reason, MAX_TEXT),
        result: result,
        approval: approval,
        detail: str(event.detail, MAX_TEXT)
      };

      // cap THIS business only: drop its oldest rows, never another business's.
      let next = records.slice(); next.push(entry);
      const mine = next.filter(r => r && r.businessId === bid).sort(newestFirst);
      if (mine.length > limit) {
        const drop = new Set(mine.slice(limit).map(r => r.id));
        next = next.filter(r => !drop.has(r.id));
      }
      if (persist) {
        try { persist(next.map(rowView)); }
        catch (e) { return { ok: false, reason: 'could not persist activity — entry not recorded' }; }
      }
      records.length = 0;
      for (const r of next) records.push(r);
      return { ok: true, entry: rowView(entry) };
    }

    // READ one business's log, newest first. A limit of 0/absent means "all of it".
    function list(businessId, o) {
      const bid = str(businessId, 120).trim();
      if (!bid) return [];
      const rows = forBiz(bid).slice().sort(newestFirst).map(rowView);
      const n = (o && Number.isFinite(o.limit) && o.limit > 0) ? Math.floor(o.limit) : 0;
      return n ? rows.slice(0, n) : rows;
    }

    function count(businessId) { const bid = str(businessId, 120).trim(); return bid ? forBiz(bid).length : 0; }

    /* CROSS-BUSINESS feed — the Command Center's "recent AI actions". This is the ONE deliberate exception
       to per-business isolation, so it is named for what it is and never used as a substitute for list(). */
    function recent(o) {
      const rows = records.slice().sort((a, b) => (b.at || 0) - (a.at || 0) || (b.seq || 0) - (a.seq || 0)).map(rowView);
      const n = (o && Number.isFinite(o.limit) && o.limit > 0) ? Math.floor(o.limit) : 20;
      return rows.slice(0, n);
    }

    function businessIds() { const s = new Set(); for (const r of records) if (r && r.businessId) s.add(r.businessId); return Array.from(s).sort(); }

    // CLEAR one business's log. Persist-before-commit; never touches another business.
    function clear(businessId) {
      const bid = str(businessId, 120).trim();
      if (!bid) return { ok: false, reason: 'a businessId is required' };
      const next = records.filter(r => !(r && r.businessId === bid));
      if (persist) {
        try { persist(next.map(rowView)); }
        catch (e) { return { ok: false, reason: 'could not persist the clear — log kept' }; }
      }
      records.length = 0;
      for (const r of next) records.push(r);
      return { ok: true };
    }

    return { RESULTS, APPROVALS, ACTOR_KINDS, LIMIT: limit, append, list, count, recent, businessIds, clear };
  }

  return { makeBusinessActivityStore, RESULTS, APPROVALS, ACTOR_KINDS, DEFAULT_LIMIT };
});
