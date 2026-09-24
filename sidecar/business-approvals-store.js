/* sidecar/business-approvals-store.js — the §13 APPROVAL QUEUE (Business OS Phase 5).

   §13 defines three action tiers and says a `review`-tier action "needs user approval", with an
   Approve/Reject interface. §19 lists "review pending actions" as one of the human controls. This store is
   that queue: one row per action an automation wanted to take but was not allowed to take alone.

   WHY IT IS NOT A COLUMN ON THE AUTOMATION ROW. An approval is a request to DO something, made at a
   moment, about a specific payload. A rule can request the same thing twenty times; each request needs its
   own decision, its own §26 block, and its own receipt. Collapsing them into a per-rule flag would mean
   approving a request that has since changed its params.

   THE ONE RULE THIS STORE EXISTS TO ENFORCE (fail-closed, and the reason it is worth having):
   A pending approval can ONLY be created through business-permissions.proposedAction (§26). That means
   every row in this queue carries a what, a why, a risk, and at least one evidence item that is not
   `unknown` — because proposedAction REFUSES a block missing any of those (P1). There is no constructor
   path that skips it, so a queue row that looks justified IS justified. A caller that wants to enqueue
   something it cannot justify gets a refusal instead of a row.

   THE SECOND RULE — a decision is FINAL. decide() refuses any row that is not `pending`, so approving
   twice cannot execute an action twice. That is what makes it safe for the engine to execute the action
   inside the approve() path: the transition pending -> approved happens ONCE, and the engine acts on that
   transition, not on the request.

   PURE: no IO, no clock, no env, no rng, no network. `persist` and `now` are injected; ids are a
   deterministic per-business sequence. UMD: `SK.businessApprovalsStore` in the browser, module.exports
   under node. Mirrors business-projects-store.js. */
'use strict';
(function (root, factory) {
  const permissions = (typeof module !== 'undefined' && module.exports)
    ? require('./business-permissions.js')
    : ((root.SK && root.SK.businessPermissions) || null);
  const api = factory(permissions);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).businessApprovalsStore = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (permissions) {
  'use strict';

  const STATUSES = ['pending', 'approved', 'rejected', 'expired'];
  const OPEN_STATUS = 'pending';

  const MAX_NAME = 160;
  const MAX_TEXT = 2000;
  const MAX_ID = 120;
  const DEFAULT_LIMIT = 200;                 // approvals per business

  function makeBusinessApprovalsStore(opts) {
    opts = opts || {};
    const records = Array.isArray(opts.records) ? opts.records : [];
    const persist = typeof opts.persist === 'function' ? opts.persist : null;
    const now = typeof opts.now === 'function' ? opts.now : (() => null);
    const perms = opts.permissions || permissions;
    const limit = (Number.isFinite(opts.limit) && opts.limit > 0) ? Math.floor(opts.limit) : DEFAULT_LIMIT;

    const str = (v, cap) => (v == null ? '' : String(v)).slice(0, cap);
    const indexOf = (id) => records.findIndex(r => r && r.id === id);
    const forBiz = (businessId) => records.filter(r => r && r.businessId === businessId);
    const biz = (v) => str(v, MAX_ID).trim();
    const newestFirst = (a, b) => (b.seq || 0) - (a.seq || 0);

    if (!perms || typeof perms.proposedAction !== 'function') {
      throw new Error('business-approvals-store.js requires business-permissions.js (proposedAction)');
    }

    function nextSeq(businessId) {
      let max = 0;
      for (const r of records) if (r && r.businessId === businessId && r.seq > max) max = r.seq;
      return max + 1;
    }

    function rowView(r) {
      return {
        id: r.id,
        seq: r.seq,
        businessId: r.businessId,
        automationId: r.automationId || '',
        runId: r.runId || '',
        // `action` is the §13 PERMISSION action the block was classified against (what the tier means);
        // `automationAction` is the automation catalogue action to actually execute on approval. They are
        // stored separately because they are not the same id — `send_external` is classified as
        // `external_comms` — and an approve() path that guessed one from the other would run the wrong op.
        action: r.action,
        automationAction: r.automationAction || '',
        tier: r.tier,
        what: r.what,
        why: r.why,
        evidence: (r.evidence || []).map(e => ({ text: e.text, evidence: e.evidence, source: e.source })),
        risk: r.risk,
        effect: r.effect || '',
        // the resolved params the action will be executed with. Held so approve() is a decision, not a
        // re-derivation: what the user read in the block is exactly what runs.
        params: Object.assign({}, r.params || {}),
        status: r.status,
        createdAt: r.createdAt != null ? r.createdAt : null,
        decidedAt: r.decidedAt != null ? r.decidedAt : null,
        decidedBy: r.decidedBy || '',
        reason: r.reason || ''
      };
    }

    function commit(next) {
      if (persist) {
        try { persist(next.map(rowView)); }
        catch (e) { return { ok: false, reason: 'could not persist — denied' }; }
      }
      records.length = 0;
      for (const r of next) records.push(r);
      return { ok: true };
    }

    // ---- reads -------------------------------------------------------------------------------------
    function list(businessId, o) {
      const b = biz(businessId);
      if (!b) return [];
      const want = o && o.status != null ? String(o.status) : '';
      return forBiz(b)
        .filter(r => !want || r.status === want)
        .slice().sort(newestFirst).map(rowView);
    }
    function get(id) { const i = indexOf(id); return i < 0 ? null : rowView(records[i]); }
    function has(id) { return indexOf(id) >= 0; }
    function count(businessId, status) {
      const b = biz(businessId);
      if (!b) return 0;
      const want = status == null ? '' : String(status);
      return forBiz(b).filter(r => !want || r.status === want).length;
    }
    // The §19 number the UI shows: how many decisions are actually waiting on the user.
    function pendingCount(businessId) { return count(businessId, OPEN_STATUS); }

    function summary(businessId) {
      const rows = list(businessId);
      const out = { total: rows.length, pending: 0, approved: 0, rejected: 0, expired: 0, byTier: {} };
      for (const r of rows) {
        if (Object.prototype.hasOwnProperty.call(out, r.status)) out[r.status]++;
        out.byTier[r.tier] = (out.byTier[r.tier] || 0) + 1;
      }
      return out;
    }

    // every business with at least one pending decision — the console's badge source.
    function pendingBusinessIds() {
      const s = new Set();
      for (const r of records) if (r && r.status === OPEN_STATUS && r.businessId) s.add(r.businessId);
      return Array.from(s).sort();
    }

    // ---- writes ------------------------------------------------------------------------------------
    /* create — enqueue a request. The §26 block is built by business-permissions.proposedAction, so a
       request with no why or no evidence is REFUSED here and never becomes a row. */
    function create(businessId, meta) {
      meta = meta || {};
      const b = biz(businessId);
      if (!b) return { ok: false, reason: 'a businessId is required (isolation is by key — never implied)' };

      const action = str(meta.action, MAX_ID).trim();
      if (!action) return { ok: false, reason: 'an approval needs the action it is asking for' };
      const tier = str(meta.tier, 20).trim();
      if (tier !== 'review') {
        return { ok: false, reason: 'only a review-tier action needs approval — this request is "' + (tier || 'unset') + '"' };
      }
      const params = (meta.params && typeof meta.params === 'object' && !Array.isArray(meta.params)) ? meta.params : {};
      if (!Object.keys(params).length) return { ok: false, reason: 'an approval needs the resolved params the action would run with' };

      const p = perms.proposedAction({
        what: meta.what, why: meta.why, evidence: meta.evidence, risk: meta.risk, effect: meta.effect,
        action: action,
        // the request is made BY an automation that does not hold the review grant, so decide() must
        // report approval:'required'. Passing the default grants is what makes that true.
        grants: meta.grants
      });
      if (!p.ok) return { ok: false, reason: p.reason };
      // The block's own tier must agree with the tier the caller claimed. A mismatch means the caller is
      // describing the action wrongly, and the block (which is what the user reads) wins.
      if (p.block.tier !== tier) {
        return { ok: false, reason: 'the approval claims tier "' + tier + '" but "' + action + '" is a ' + p.block.tier + '-tier action' };
      }

      const at = now();
      const seq = nextSeq(b);
      const row = {
        // '~' not '#' — see validation-store.js for why an id in a URL path may not contain '#'.
        id: b + '~v' + seq,
        seq: seq,
        businessId: b,
        automationId: str(meta.automationId, MAX_ID),
        runId: str(meta.runId, MAX_ID),
        action: p.block.action,
        automationAction: str(meta.actionId, MAX_ID),
        tier: p.block.tier,
        what: p.block.what,
        why: p.block.why,
        evidence: p.block.evidence,
        risk: p.block.risk,
        effect: p.block.effect,
        params: params,
        status: OPEN_STATUS,
        createdAt: at,
        decidedAt: null,
        decidedBy: '',
        reason: ''
      };

      // cap THIS business only — never another's. A dropped PENDING row is a decision the user never got
      // to make, so the cap drops the OLDEST DECIDED rows first and only then the oldest pending ones.
      let next = records.slice(); next.push(row);
      const mine = next.filter(r => r && r.businessId === b).sort((a, c) => (c.seq || 0) - (a.seq || 0));
      if (mine.length > limit) {
        const decided = mine.filter(r => r.status !== OPEN_STATUS);
        const pending = mine.filter(r => r.status === OPEN_STATUS);
        const keep = new Set(pending.map(r => r.id));                     // every pending row is kept
        for (const r of decided.slice(0, Math.max(0, limit - pending.length))) keep.add(r.id);
        next = next.filter(r => r.businessId !== b || keep.has(r.id));
      }
      const w = commit(next);
      if (!w.ok) return w;
      return { ok: true, approval: rowView(row) };
    }

    /* decide — Approve or Reject (§13). Refuses any row that is not pending, which is the guard that
       makes double-approval harmless: the transition happens once, and the engine acts on the transition.
       `by` records WHO decided, because §19's whole point is that a human is accountable. */
    function decide(id, input) {
      input = input || {};
      const i = indexOf(id);
      if (i < 0) return { ok: false, reason: 'unknown approval: ' + id };
      const prev = records[i];
      if (prev.status !== OPEN_STATUS) {
        return { ok: false, reason: 'this request was already ' + prev.status + ' — a decision is final', status: prev.status };
      }
      const decision = String(input.decision == null ? '' : input.decision);
      if (decision !== 'approve' && decision !== 'reject') {
        return { ok: false, reason: 'decision must be "approve" or "reject"' };
      }
      const nextRow = rowView(prev);
      nextRow.status = decision === 'approve' ? 'approved' : 'rejected';
      nextRow.decidedAt = now();
      nextRow.decidedBy = str(input.by, MAX_NAME) || 'user';
      nextRow.reason = str(input.reason, MAX_TEXT);
      const next = records.slice(); next[i] = nextRow;
      const w = commit(next);
      if (!w.ok) return w;
      return { ok: true, approval: rowView(nextRow), decision: decision };
    }

    /* expire — withdraw a pending request that can no longer be acted on (the business was deleted, or
       the automation it came from was removed). Only a PENDING row can expire; a decided one keeps its
       receipt. */
    function expire(id, reason) {
      const i = indexOf(id);
      if (i < 0) return { ok: true, expired: 0 };
      const prev = records[i];
      if (prev.status !== OPEN_STATUS) return { ok: true, expired: 0 };
      const nextRow = rowView(prev);
      nextRow.status = 'expired';
      nextRow.decidedAt = now();
      nextRow.decidedBy = 'system';
      nextRow.reason = str(reason, MAX_TEXT) || 'no longer actionable';
      const next = records.slice(); next[i] = nextRow;
      const w = commit(next);
      if (!w.ok) return w;
      return { ok: true, expired: 1, approval: rowView(nextRow) };
    }

    // every pending request raised by one automation — used when that automation is removed.
    function expireForAutomation(automationId, reason) {
      const ids = records.filter(r => r && r.automationId === automationId && r.status === OPEN_STATUS).map(r => r.id);
      let n = 0;
      for (const id of ids) { const r = expire(id, reason); if (r.ok) n += r.expired || 0; }
      return { ok: true, expired: n };
    }

    // every pending request belonging to one business — used by the per-business E-STOP path when the
    // caller wants the queue cleared rather than left for a decision. Deliberately NOT wired into the
    // global E-STOP: a pending request is the user's to decide, not the system's to discard.
    function expireForBusiness(businessId, reason) {
      const b = biz(businessId);
      if (!b) return { ok: false, reason: 'a businessId is required' };
      const ids = records.filter(r => r && r.businessId === b && r.status === OPEN_STATUS).map(r => r.id);
      let n = 0;
      for (const id of ids) { const r = expire(id, reason); if (r.ok) n += r.expired || 0; }
      return { ok: true, expired: n };
    }

    function remove(id) {
      const i = indexOf(id);
      if (i < 0) return { ok: true, removed: 0 };
      const next = records.slice(); next.splice(i, 1);
      const w = commit(next);
      if (!w.ok) return w;
      return { ok: true, removed: 1 };
    }

    function clear(businessId) {
      const b = biz(businessId);
      if (!b) return { ok: false, reason: 'a businessId is required' };
      const next = records.filter(r => !(r && r.businessId === b));
      const w = commit(next);
      if (!w.ok) return w;
      return { ok: true };
    }

    return {
      STATUSES, OPEN_STATUS, LIMIT: limit,
      list, get, has, count, pendingCount, summary, pendingBusinessIds,
      create, decide, expire, expireForAutomation, expireForBusiness, remove, clear
    };
  }

  return { makeBusinessApprovalsStore, STATUSES, OPEN_STATUS, DEFAULT_LIMIT };
});
