/* sidecar/business-workorders-store.js — §13's AI Worker record + §18's audit entry (Business OS Phase 6).

   WHAT A WORK ORDER IS. A business agent is asked to do real work on the station — research a market, read the
   business's own records, draft something, or (with the owner's yes) speak to the outside world. A work order
   is the durable record of that: WHAT was asked, by WHICH agent, for WHICH business, the STEPS it intends to
   take, and — step by step — what actually happened.

   WHY IT IS A SEPARATE STORE FROM business-automation-*. A Phase 5 automation rule is a STANDING rule that
   fires on its own when an event arrives; it is authored once and runs forever. A work order is a BOUNDED
   piece of work: one intent, a finite list of steps, a beginning and an end. They share a vocabulary (§13
   tiers, the §26 proposed-action shape) but not a lifetime, and folding them together would mean a rule that
   never finishes living in the same table as a job that finished last Tuesday.

   THE HONESTY RULE THIS STORE ENFORCES. A step has a STATUS that is separate from its RESULT, and `finish()`
   derives the order's overall status from the step statuses rather than from what the caller hoped. Three
   outcomes are recorded distinctly and never collapsed:
     executed — the tool really ran and returned
     held     — a human must decide; nothing ran
     refused  — the policy refused it; nothing ran, and no approval can change that in this run
   An order whose steps are all `held` is `blocked`, NOT `done`. A store that let a caller mark a held order
   "done" would turn "your agent is waiting for you" into "your agent finished", which is the single most
   damaging lie this phase could tell.

   P6: every row is `businessId`-scoped and the id CARRIES the businessId, so a lookup can never cross
   businesses. An empty businessId is REFUSED rather than read as "all businesses".
   Persist-before-commit: a thrown `persist` leaves memory untouched and returns ok:false.
   Pure UMD: no IO, no clock, no rng — `now` and `persist` are injected. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).businessWorkOrders = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* An order's status. `blocked` is the one worth naming: it means work is WAITING ON A HUMAN, which is a
     different thing from both `running` (nobody needs to act) and `done` (nothing is outstanding). */
  const STATUSES = ['planned', 'running', 'done', 'partial', 'blocked', 'failed'];
  const OPEN_STATUSES = ['planned', 'running', 'blocked'];
  /* A step's status. `held` and `refused` are deliberately distinct: `held` can still be approved into
     `executed`; `refused` cannot be moved by anyone, because the policy's answer was structural. */
  const STEP_STATUSES = ['pending', 'executed', 'held', 'refused', 'failed', 'skipped'];
  const DEFAULT_LIMIT = 200;

  const str = (v, cap) => (v == null ? '' : String(v)).slice(0, cap == null ? 2000 : cap);
  const oneOf = (v, list, dflt) => (list.indexOf(String(v)) >= 0 ? String(v) : dflt);

  function makeBusinessWorkOrders(opts) {
    opts = opts || {};
    const records = Array.isArray(opts.records) ? opts.records : [];
    const persist = typeof opts.persist === 'function' ? opts.persist : null;
    const now = typeof opts.now === 'function' ? opts.now : (() => null);
    const limit = Number.isFinite(opts.limit) && opts.limit > 0 ? opts.limit : DEFAULT_LIMIT;

    /* Defensive read: every optional field gets a default so a hand-edited or older file can never make a
       LIST throw. A row that throws on read takes the whole console down, and a console that cannot list is
       worse than one that shows a slightly thin row. */
    function rowView(r) {
      r = r || {};
      const steps = (Array.isArray(r.steps) ? r.steps : []).map((s, i) => {
        s = s || {};
        return {
          seq: Number.isFinite(Number(s.seq)) ? Number(s.seq) : i + 1,
          tool: str(s.tool, 200),
          args: (s.args && typeof s.args === 'object') ? s.args : {},
          why: str(s.why, 600),
          action: str(s.action, 60),
          tier: oneOf(s.tier, ['safe', 'review', 'restricted'], 'restricted'),
          outcome: oneOf(s.outcome, ['run', 'ask', 'deny'], 'deny'),
          status: oneOf(s.status, STEP_STATUSES, 'pending'),
          reason: str(s.reason, 800),
          /* Whether the worker could reach this tool when the order was planned. It is a PLAN-TIME annotation,
             recorded so the console can warn before an order is committed — the runner still RE-CHECKS at run
             time, so this never becomes the thing that permits a call. Default true, matching isAvailable's
             "an uninformed runner must not refuse work on a guess". */
          wired: s.wired === undefined ? true : !!s.wired,
          // the tool's own answer, kept VERBATIM-ish but bounded. Never summarised into a boolean, because
          // "it ran and returned this" and "it ran and returned an error string" must not look alike.
          result: s.result === undefined ? null : s.result,
          error: str(s.error, 600),
          at: Number.isFinite(Number(s.at)) ? Number(s.at) : null
        };
      });
      return {
        id: str(r.id, 200),
        seq: Number.isFinite(Number(r.seq)) ? Number(r.seq) : 0,
        businessId: str(r.businessId, 200),
        agentId: str(r.agentId, 200),
        agentName: str(r.agentName, 200),
        intent: str(r.intent, 1000),
        steps: steps,
        status: oneOf(r.status, STATUSES, 'planned'),
        dryRun: !!r.dryRun,
        note: str(r.note, 600),
        createdBy: str(r.createdBy, 120) || 'user',
        createdAt: Number.isFinite(Number(r.createdAt)) ? Number(r.createdAt) : null,
        updatedAt: Number.isFinite(Number(r.updatedAt)) ? Number(r.updatedAt) : null,
        finishedAt: Number.isFinite(Number(r.finishedAt)) ? Number(r.finishedAt) : null
      };
    }

    /* commit(next) — persist the SNAPSHOT first, then adopt it. On a persist failure memory is untouched, so
       a row is never visible unless it reached disk. */
    function commit(next) {
      if (persist) {
        try { persist(next.map(rowView)); }
        catch (e) { return { ok: false, reason: 'could not persist — denied' }; }
      }
      records.length = 0;
      for (const r of next) records.push(r);
      return { ok: true };
    }

    const byId = (id) => {
      const k = str(id, 200);
      for (const r of records) if (r.id === k) return r;
      return null;
    };
    const has = (id) => !!byId(id);
    const get = (id) => { const r = byId(id); return r ? rowView(r) : null; };

    function nextSeq(businessId) {
      let max = 0;
      for (const r of records) {
        if (r.businessId !== businessId) continue;
        if (Number.isFinite(Number(r.seq)) && Number(r.seq) > max) max = Number(r.seq);
      }
      return max + 1;
    }

    /* create(businessId, meta) -> { ok, order }
       meta: { agentId, agentName, intent, steps, createdBy, dryRun, note }
       `steps` is the ALREADY-CLASSIFIED plan (the runner produces it via the policy), so this store never
       re-derives a tier — one classifier, one answer. */
    function create(businessId, meta) {
      meta = meta || {};
      const biz = str(businessId, 200).trim();
      // P6: an empty businessId would make this row readable from every business. Refuse it.
      if (!biz) return { ok: false, reason: 'a work order needs a business — an unscoped order would be visible from every business (P6)' };

      const intent = str(meta.intent, 1000).trim();
      if (!intent) return { ok: false, reason: 'a work order needs an intent — what was asked, in words' };

      const rawSteps = Array.isArray(meta.steps) ? meta.steps : [];
      if (!rawSteps.length) return { ok: false, reason: 'a work order needs at least one step' };

      const seq = nextSeq(biz);
      const at = now();
      const row = {
        id: biz + '~w' + seq,
        seq: seq,
        businessId: biz,
        agentId: str(meta.agentId, 200),
        agentName: str(meta.agentName, 200),
        intent: intent,
        steps: rawSteps.map((s, i) => ({
          seq: Number.isFinite(Number(s && s.seq)) ? Number(s.seq) : i + 1,
          tool: str(s && s.tool, 200),
          args: (s && s.args && typeof s.args === 'object') ? s.args : {},
          why: str(s && s.why, 600),
          action: str(s && s.action, 60),
          tier: oneOf(s && s.tier, ['safe', 'review', 'restricted'], 'restricted'),
          outcome: oneOf(s && s.outcome, ['run', 'ask', 'deny'], 'deny'),
          status: 'pending',
          reason: str(s && s.reason, 800),
          // see rowView: a plan-time note that the worker's registry carries this tool. Default true when the
          // caller did not check — the runner re-checks before dispatching, so this is never the permission.
          wired: (s && s.wired === undefined) ? true : !!(s && s.wired),
          result: null,
          error: '',
          at: null
        })),
        status: 'planned',
        dryRun: !!meta.dryRun,
        note: str(meta.note, 600),
        createdBy: str(meta.createdBy, 120) || 'user',
        createdAt: at,
        updatedAt: at,
        finishedAt: null
      };

      const c = commit(records.concat([row]));
      if (!c.ok) return c;
      // the bounded run log: drop the OLDEST FINISHED orders, never an open one
      trim();
      return { ok: true, order: rowView(row) };
    }

    /* Keep the store bounded without ever discarding work that is still outstanding. Open orders are counted
       first and are exempt; only finished ones are candidates, oldest first. */
    function trim() {
      if (records.length <= limit) return;
      const open = records.filter(r => OPEN_STATUSES.indexOf(r.status) >= 0);
      const closed = records.filter(r => OPEN_STATUSES.indexOf(r.status) < 0)
        .sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0));
      const keep = closed.slice(Math.max(0, closed.length - Math.max(0, limit - open.length)));
      const next = open.concat(keep);
      if (next.length !== records.length) commit(next);
    }

    function list(businessId, opts2) {
      opts2 = opts2 || {};
      const biz = str(businessId, 200).trim();
      if (!biz) return [];   // P6: no business means nothing to read, never everything
      let out = records.filter(r => r.businessId === biz);
      const st = str(opts2.status, 40).trim();
      if (st) out = out.filter(r => r.status === st);
      const agent = str(opts2.agentId, 200).trim();
      if (agent) out = out.filter(r => r.agentId === agent);
      const openOnly = opts2.open === true;
      if (openOnly) out = out.filter(r => OPEN_STATUSES.indexOf(r.status) >= 0);
      out = out.slice().sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
      const cap = Number.isFinite(opts2.limit) && opts2.limit > 0 ? opts2.limit : 0;
      if (cap) out = out.slice(0, cap);
      return out.map(rowView);
    }

    /* recordStep(id, seq, patch) — write ONE step's outcome. This is the only way a step's status changes, so
       every transition is funnelled through the same place and the order's derived status is always refreshed
       from the real step list rather than set by a caller. */
    function recordStep(id, seq, patch) {
      patch = patch || {};
      const cur = byId(id);
      if (!cur) return { ok: false, reason: 'no such work order: ' + str(id, 200) };
      const n = Number(seq);
      const idx = cur.steps.findIndex(s => Number(s.seq) === n);
      if (idx < 0) return { ok: false, reason: 'no step ' + str(seq, 20) + ' on this work order' };

      const s = cur.steps[idx];
      if (patch.status !== undefined) s.status = oneOf(patch.status, STEP_STATUSES, s.status);
      if (patch.result !== undefined) s.result = patch.result;
      if (patch.error !== undefined) s.error = str(patch.error, 600);
      if (patch.reason !== undefined) s.reason = str(patch.reason, 800);
      if (patch.action !== undefined) s.action = str(patch.action, 60);
      if (patch.tier !== undefined) s.tier = oneOf(patch.tier, ['safe', 'review', 'restricted'], s.tier);
      if (patch.outcome !== undefined) s.outcome = oneOf(patch.outcome, ['run', 'ask', 'deny'], s.outcome);
      s.at = now();

      const before = cur.status;
      cur.status = deriveStatus(cur);
      if (before !== 'running' && cur.status === 'running') { /* nothing extra: status is derived */ }
      cur.updatedAt = now();
      if (OPEN_STATUSES.indexOf(cur.status) < 0 && !cur.finishedAt) cur.finishedAt = now();
      if (OPEN_STATUSES.indexOf(cur.status) >= 0) cur.finishedAt = null;

      const c = commit(records.slice());
      if (!c.ok) return c;
      return { ok: true, order: rowView(cur) };
    }

    /* THE DERIVATION. This is the store's spine: the order's status is a FUNCTION of its steps, so no caller
       can assert an outcome the steps do not support.
         any pending            -> still 'running' if work has begun, else 'planned'
         any failed             -> 'failed' if nothing succeeded, else 'partial'
         all held               -> 'blocked'  (waiting on a human — NOT done)
         some held              -> 'blocked'  if nothing executed, else 'partial'
         all refused            -> 'failed'
         every step executed    -> 'done'
         mix executed + refused -> 'partial'
       `done` requires EVERY step to have executed. Nothing else earns it. */
    function deriveStatus(row) {
      const steps = Array.isArray(row.steps) ? row.steps : [];
      if (!steps.length) return 'planned';
      const n = steps.length;
      let executed = 0, held = 0, refused = 0, failed = 0, skipped = 0, pending = 0;
      for (const s of steps) {
        if (s.status === 'executed') executed++;
        else if (s.status === 'held') held++;
        else if (s.status === 'refused') refused++;
        else if (s.status === 'failed') failed++;
        else if (s.status === 'skipped') skipped++;
        else pending++;
      }
      /* A SKIPPED STEP IS SETTLED, NOT PENDING. An earlier draft counted 'skipped' in the pending bucket,
         which meant an order whose remaining steps were all deliberately skipped could never leave 'running'
         — it would hang open forever waiting for steps that had already been passed over. A skip is a
         decision ("this step does not apply"), so it settles; only a genuinely untouched step is pending. */
      if (pending > 0) return row.status === 'running' ? 'running' : 'planned';
      // something is waiting on a human: it outranks every other tally, because the order is not over
      if (held > 0) return executed > 0 ? 'partial' : 'blocked';
      // nothing waiting, nothing outstanding: did anything actually run?
      if (executed > 0) {
        // every remaining step was either skipped (a deliberate pass) or executed
        return (failed > 0 || refused > 0) ? 'partial' : 'done';
      }
      // nothing executed — a skip is still a deliberate pass, so an all-skipped order is done, not failed
      if (skipped > 0) return 'done';
      return 'failed';
    }

    // markRunning(id) — the one caller-set transition, because "work has begun" is not derivable from steps
    // that are all still pending.
    function markRunning(id) {
      const cur = byId(id);
      if (!cur) return { ok: false, reason: 'no such work order: ' + str(id, 200) };
      if (cur.dryRun) return { ok: false, reason: 'a dry run does not run — it is a plan, not a job' };
      if (OPEN_STATUSES.indexOf(cur.status) < 0) return { ok: false, reason: 'this work order is already finished (' + cur.status + ')' };
      cur.status = 'running';
      cur.updatedAt = now();
      const c = commit(records.slice());
      if (!c.ok) return c;
      return { ok: true, order: rowView(cur) };
    }

    /* finish(id, note) — settle the order. It does NOT accept a status: the status is derived from the steps,
       so a caller cannot declare success the steps did not achieve. `note` is the only thing a caller may
       add. */
    function finish(id, note) {
      const cur = byId(id);
      if (!cur) return { ok: false, reason: 'no such work order: ' + str(id, 200) };
      if (note !== undefined) cur.note = str(note, 600);
      cur.status = deriveStatus(cur);
      cur.updatedAt = now();
      if (OPEN_STATUSES.indexOf(cur.status) < 0) { if (!cur.finishedAt) cur.finishedAt = now(); }
      const c = commit(records.slice());
      if (!c.ok) return c;
      return { ok: true, order: rowView(cur) };
    }

    function remove(id) {
      const cur = byId(id);
      if (!cur) return { ok: false, reason: 'no such work order: ' + str(id, 200) };
      const c = commit(records.filter(r => r !== cur));
      if (!c.ok) return c;
      return { ok: true, removed: rowView(cur) };
    }

    function removeForBusiness(businessId) {
      const biz = str(businessId, 200).trim();
      if (!biz) return { ok: false, reason: 'a business is required' };
      const doomed = records.filter(r => r.businessId === biz);
      if (!doomed.length) return { ok: true, removed: 0 };
      const c = commit(records.filter(r => r.businessId !== biz));
      if (!c.ok) return c;
      return { ok: true, removed: doomed.length };
    }

    function count(businessId) {
      const biz = str(businessId, 200).trim();
      if (!biz) return 0;
      let n = 0;
      for (const r of records) if (r.businessId === biz) n++;
      return n;
    }

    function openFor(businessId) {
      return list(businessId, { open: true });
    }

    /* summary(businessId) — counts by status and the step-level outcome tally, so the console can say
       "3 orders, 2 steps waiting on you" without recomputing anything. No score, no percentage: the numbers
       are counts of things that happened. */
    function summary(businessId) {
      const rows = list(businessId);
      const out = { total: rows.length, byStatus: {}, steps: { total: 0, executed: 0, held: 0, refused: 0, failed: 0, pending: 0 }, awaitingYou: 0 };
      for (const st of STATUSES) out.byStatus[st] = 0;
      for (const r of rows) {
        if (out.byStatus[r.status] === undefined) out.byStatus[r.status] = 0;
        out.byStatus[r.status]++;
        for (const s of r.steps) {
          out.steps.total++;
          if (out.steps[s.status] === undefined) out.steps[s.status] = 0;
          out.steps[s.status]++;
          if (s.status === 'held') out.awaitingYou++;
        }
      }
      return out;
    }

    function clear() {
      const c = commit([]);
      if (!c.ok) return c;
      return { ok: true };
    }

    return {
      STATUSES, OPEN_STATUSES, STEP_STATUSES, DEFAULT_LIMIT,
      rowView, deriveStatus,
      create, get, has, list, count, openFor, summary,
      recordStep, markRunning, finish, remove, removeForBusiness, clear,
      size: () => records.length
    };
  }

  return { makeBusinessWorkOrders, STATUSES, OPEN_STATUSES, STEP_STATUSES, DEFAULT_LIMIT };
});
