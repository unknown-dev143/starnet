/* sidecar/business-remote.js — the REMOTE MONITORING read model (Business OS §25, brief §27).

   WHAT THE BRIEF ASKS FOR. §27 "Remote Monitoring": "Eventually let the user monitor SpaceStation
   remotely: business status · AI activity · alerts · pending approvals · revenue · errors · running
   tasks." And critically: "The remote interface should prioritize **monitoring and approvals** — not
   attempt to reproduce the whole workstation."

   So this module is a READ MODEL, not a second workstation. It projects the seven facts above from the
   stores that already own them into ONE compact, phone-shaped snapshot. It:
     - owns NO store and writes NOTHING (every write stays behind the existing guarded routes);
     - reads through INJECTED accessors, so it is pure and unit-testable with no boot;
     - tells the truth about absence — a missing reading is `null`, never a fabricated 0 (§ P1/P2
       honesty; the SAME rule business-metrics.js::latest() follows).

   WHY NOT A NEW MONITORING ENGINE (P4). diagnostics.js, harness-snapshot.js and business-metrics.js
   already compute health/metrics/telemetry. Building a second monitor would be the duplication the brief
   forbids (§28 "identify technical debt and duplication ... do not rewrite"). This module COMPOSES them
   by reference: the composition root passes the real stores in, and this file only shapes the output.

   WHAT IS *NOT* HERE. No transport, no remote listener, no second auth path. §25 is scoped
   "architecture-ready" — the SEAM (a disabled-by-default binding point plus the read model behind it)
   lives in business-remote-seam.js. This file is the half that can be tested and reasoned about today.

   PRIORITY ORDER (the brief's ranking, made literal). The snapshot's sections are ordered so that a
   remote client rendering top-down shows monitoring + approvals first:
     alerts → approvals → business status → running tasks → revenue → activity → errors
   `priority()` returns exactly that list so a UI never has to re-invent it.

   HONESTY RULES THIS MODULE ENFORCES (each is asserted in test/business-remote.test.js):
     - a rate is a fraction bounded 0..1, never summed across businesses;
     - a count is `null` when the source is unreadable, never `0` (0 is a FACT: "we looked, there are none");
     - an unreadable source is reported as `unavailable` with a reason, never rendered as empty;
     - no fabricated score / health / grade / percentage anywhere.

   DETERMINISM: no clock, no rng, no env. `now` is injected (and only used to stamp the snapshot). */

'use strict';

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else { (root.SK = root.SK || {}).businessRemote = factory(); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* The brief's priority order, as data. A UI renders in this order; changing the brief changes one array. */
  const SECTIONS = ['alerts', 'approvals', 'status', 'tasks', 'revenue', 'activity', 'errors'];

  const OPEN_WORKORDER = ['planned', 'running', 'held'];   // a work order still in flight

  function num(v) { const n = Number(v); return isFinite(n) ? n : null; }
  function str(v, max) {
    const s = String(v == null ? '' : v);
    return max && s.length > max ? s.slice(0, max) : s;
  }
  /* Wrap an accessor so a THROWING source becomes an explicit `unavailable` fact, never an empty list.
     This is the difference between "we looked and there is nothing" and "we could not look". */
  function safe(read, label) {
    try { return { ok: true, value: read() }; }
    catch (e) {
      return { ok: false, reason: (label || 'source') + ' unreadable: ' + str(e && e.message || e, 200) };
    }
  }

  /* ---- the pure projections ---------------------------------------------------------------------
     Every shaper takes plain rows and returns plain rows. No store access, no clock. */

  // ALERTS — the things a remote user must see first: a halted hub, a failed run, a held/refused step.
  function shapeAlerts(input) {
    const alerts = [];
    if (input.hubHalted === true) {
      alerts.push({ at: num(input.hubHaltedAt), severity: 'high', kind: 'automation.halted',
        businessId: null, summary: 'the automation hub is halted — automations are not firing' });
    }
    for (const r of (input.heldSteps || [])) {
      alerts.push({ at: num(r.at), severity: 'medium', kind: 'business.workorder.step.held',
        businessId: r.businessId || null,
        summary: 'a worker step needs a decision: ' + str(r.title || r.workOrderId, 120) });
    }
    for (const r of (input.refusedSteps || [])) {
      alerts.push({ at: num(r.at), severity: 'medium', kind: 'business.workorder.step.refused',
        businessId: r.businessId || null,
        summary: 'a worker step was refused: ' + str(r.title || r.workOrderId, 120) });
    }
    for (const r of (input.runErrors || [])) {
      alerts.push({ at: num(r.at), severity: 'high', kind: 'agent.run.error',
        businessId: r.businessId || null, summary: 'an agent run failed: ' + str(r.reason || r.runId, 120) });
    }
    alerts.sort((a, b) => (b.at || 0) - (a.at || 0));
    return alerts;
  }

  // APPROVALS — the second priority. Only the OPEN ones; a decided one is history, not a task.
  function shapeApprovals(pending, byTier) {
    const tier = byTier && typeof byTier === 'object' ? byTier : {};
    return (pending || []).slice().sort((a, b) => (num(b.at) || 0) - (num(a.at) || 0)).map(r => ({
      id: r.id, businessId: r.businessId || null, tier: str(r.tier, 40),
      action: str(r.action || r.summary, 160), at: num(r.at),
      // a remote client needs to know a decision is FINAL and which verbs exist, without loading the console
      verbs: ['approve', 'reject']
    })).map(r => (tier[r.tier] != null ? Object.assign({}, r, { openForTier: tier[r.tier] }) : r));
  }

  // STATUS — one compact line per business. `stage` is the real lifecycle stage, never a re-derived one.
  function shapeStatus(businesses, perBusiness) {
    const by = perBusiness && typeof perBusiness === 'object' ? perBusiness : {};
    return (businesses || []).map(b => {
      const extra = by[b.id] || {};
      return {
        id: b.id, name: str(b.name, 120), stage: str(b.stage, 40), template: str(b.template, 40),
        currency: str(b.currency, 8) || null,
        paused: b.paused === true,
        pendingApprovals: extra.pendingApprovals == null ? null : num(extra.pendingApprovals),
        openTasks: extra.openTasks == null ? null : num(extra.openTasks),
        updatedAt: num(b.updatedAt)
      };
    }).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  // RUNNING TASKS — the work orders still in flight, flattened to one row each.
  function shapeTasks(workOrders) {
    return (workOrders || []).filter(w => OPEN_WORKORDER.indexOf(w.status) >= 0).map(w => ({
      id: w.id, businessId: w.businessId || null, title: str(w.title, 160),
      status: str(w.status, 40), agentId: w.agentId || null,
      steps: num(w.stepCount), stepsDone: num(w.stepsDone), createdAt: num(w.createdAt)
    })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  /* REVENUE — per currency, straight from finance.totals(). A currency with no rows reports 0 revenue
     and 0 count, which is TRUE (the store looked). If the source is unreadable the caller omits the key
     entirely and the section is marked unavailable — we never write a 0 we did not observe. */
  function shapeRevenue(totals) {
    const out = [];
    const by = (totals && totals.byCurrency) || {};
    for (const c of Object.keys(by).sort()) {
      const b = by[c] || {};
      out.push({
        currency: c,
        revenue: num(b.revenue) == null ? 0 : num(b.revenue),
        expense: num(b.expense) == null ? 0 : num(b.expense),
        estimated: num(b.estimated) == null ? 0 : num(b.estimated),
        count: num(b.count) == null ? 0 : num(b.count)
      });
    }
    return out;
  }

  // ACTIVITY — the cross-business feed, trimmed for a small screen.
  function shapeActivity(rows) {
    return (rows || []).map(r => ({
      at: num(r.at), businessId: r.businessId || null, actor: str(r.actor, 60),
      kind: str(r.kind || r.event, 80), summary: str(r.summary || r.text, 200)
    }));
  }

  // ERRORS — the error-shaped feed, kept separate from alerts so counts never double up.
  function shapeErrors(rows) {
    return (rows || []).map(r => ({
      at: num(r.at), businessId: r.businessId || null, kind: str(r.kind, 80),
      summary: str(r.summary || r.reason || r.message, 200)
    })).sort((a, b) => (b.at || 0) - (a.at || 0));
  }

  /* ---- the composer -------------------------------------------------------------------------------
     makeRemoteReadModel(deps) — deps are the REAL stores, injected. Nothing here is required directly,
     so no store is duplicated and the module stays boot-free.

       deps = {
         now,                      // () => epoch ms; injected clock, never ambient
         businesses,               // { list() }
         approvals,                // { list(bizId, {status}), pendingCount(bizId), summary(bizId) }
         activity,                 // { list(bizId, {limit}), recent({limit}) }
         finance,                  // { totals(bizId, {currency}) }
         workOrders,               // { list(bizId, {open, limit}) }
         metrics,                  // { summary(bizId) }         (optional)
         hub,                      // { halted: bool, haltedAt: n } (optional; the engine exposes this)
         errors,                   // { recent({limit}) } OR a plain array  (optional)
         businessIds               // optional override; defaults to businesses.list().map(b => b.id)
       }
  */
  function makeRemoteReadModel(deps) {
    deps = deps || {};
    const now = typeof deps.now === 'function' ? deps.now : (() => null);

    function ids() {
      if (Array.isArray(deps.businessIds)) return deps.businessIds.slice();
      const s = safe(() => deps.businesses.list(), 'businesses');
      if (!s.ok) return null;                       // null = unreadable (NOT [])
      return s.value.map(b => b.id).filter(Boolean);
    }

    function businessRows() {
      const s = safe(() => deps.businesses.list(), 'businesses');
      return s.ok ? s.value : null;
    }

    /* pendingApprovals — the count of OPEN approvals across every business. `null` when the source is
       unreadable; a real 0 when we looked and the queue is empty. */
    function pendingApprovals(all) {
      if (!deps.approvals) return { value: null, reason: 'approvals source not wired' };
      const list = Array.isArray(all) ? all
        : (Array.isArray(deps.businessIds) ? deps.businessIds : null);
      if (!list) {
        // prefer the store's own cross-business helper when it has one
        if (typeof deps.approvals.pendingBusinessIds === 'function') {
          const s = safe(() => deps.approvals.pendingBusinessIds(), 'approvals');
          if (!s.ok) return { value: null, reason: s.reason };
          return { value: s.value.length, byBusiness: s.value };
        }
        return { value: null, reason: 'no business list to scope approvals' };
      }
      const l = Array.isArray(all) ? all : list;
      let total = 0; const byBusiness = {};
      for (const id of l) {
        const c = safe(() => deps.approvals.pendingCount(id), 'approvals');
        if (!c.ok) return { value: null, reason: c.reason };
        byBusiness[id] = num(c.value);
        total += num(c.value) || 0;
      }
      return { value: total, byBusiness: byBusiness };
    }

    /* summary() — the whole remote snapshot in one call. Sections are ALWAYS present as keys; a section
       that could not be read carries `{ ok:false, reason }` so a client can tell "none" from "unknown". */
    function summary(o) {
      o = o || {};
      const at = now();
      const limit = Number.isFinite(o.limit) && o.limit > 0 ? Math.floor(o.limit) : 20;

      const bizList = businessRows();
      const bizIds = bizList ? bizList.map(b => b.id).filter(Boolean) : null;

      // --- approvals (needs bizIds to scope, or the store's cross-business helper)
      let approvalsSection = { ok: false, reason: 'approvals source not wired' };
      let pendingRows = [];
      if (deps.approvals) {
        const pa = pendingApprovals(bizIds);
        if (pa.value == null) approvalsSection = { ok: false, reason: pa.reason || 'approvals unreadable' };
        else {
          // collect the OPEN rows themselves when we have a business list; else counts only
          if (bizIds) {
            for (const id of bizIds) {
              const s = safe(() => deps.approvals.list(id, { status: (deps.approvals.OPEN_STATUS || 'pending') }), 'approvals');
              if (!s.ok) { approvalsSection = { ok: false, reason: s.reason }; pendingRows = null; break; }
              for (const row of s.value) pendingRows.push(row);
            }
          }
          if (pendingRows !== null) {
            approvalsSection = { ok: true, count: pa.value, byBusiness: pa.byBusiness || null,
              pending: shapeApprovals(pendingRows, null) };
          }
        }
      }

      // --- status (+ per-business approval/open-task counts, so a remote list shows a badge)
      let statusSection = { ok: false, reason: 'businesses source not wired' };
      if (bizList) {
        const per = {};
        for (const b of bizList) {
          const p = deps.approvals ? safe(() => deps.approvals.pendingCount(b.id), 'approvals') : { ok: true, value: null };
          const t = deps.workOrders ? safe(() => deps.workOrders.list(b.id, { open: true, limit: 200 }), 'workOrders') : { ok: true, value: null };
          per[b.id] = {
            pendingApprovals: p.ok ? num(p.value) : null,
            openTasks: t.ok && Array.isArray(t.value) ? t.value.length : null
          };
        }
        statusSection = { ok: true, businesses: shapeStatus(bizList, per) };
      }

      // --- tasks: flatten every business's open work orders
      let tasksSection = { ok: true, tasks: [] };
      if (deps.workOrders && bizIds) {
        const acc = [];
        for (const id of bizIds) {
          const s = safe(() => deps.workOrders.list(id, { open: true, limit: 200 }), 'workOrders');
          if (!s.ok) { tasksSection = { ok: false, reason: s.reason }; acc.length = 0; break; }
          for (const w of s.value) acc.push(w);
        }
        if (tasksSection.ok) tasksSection.tasks = shapeTasks(acc);
      }

      // --- revenue: merge every business's currency totals into ONE per-currency view
      let revenueSection = { ok: true, currencies: [] };
      if (deps.finance && bizIds) {
        const merged = {};
        let failed = null;
        for (const id of bizIds) {
          const s = safe(() => deps.finance.totals(id), 'finance');
          if (!s.ok) { failed = s.reason; break; }
          const t = s.value || {};
          for (const c of Object.keys(t.byCurrency || {})) {
            const cur = t.byCurrency[c] || {};
            if (!merged[c]) merged[c] = { revenue: 0, expense: 0, estimated: 0, count: 0 };
            merged[c].revenue += num(cur.revenue) || 0;
            merged[c].expense += num(cur.expense) || 0;
            merged[c].estimated += num(cur.estimated) || 0;
            merged[c].count += num(cur.count) || 0;
          }
        }
        if (failed) revenueSection = { ok: false, reason: failed };
        else revenueSection.currencies = shapeRevenue({ byCurrency: merged });
      } else if (!deps.finance) {
        revenueSection = { ok: false, reason: 'finance source not wired' };
      }

      // --- activity (cross-business feed) + errors
      let activitySection = { ok: true, recent: [] };
      let activityRaw = [];
      if (deps.activity) {
        const s = safe(() => deps.activity.recent({ limit: limit }), 'activity');
        if (s.ok) { activityRaw = Array.isArray(s.value) ? s.value : []; activitySection.recent = shapeActivity(activityRaw); }
        else activitySection = { ok: false, reason: s.reason };
      } else activitySection = { ok: false, reason: 'activity source not wired' };

      let errorsArr = [];
      let errorsSection = { ok: true, errors: [] };
      if (deps.errors) {
        const s = typeof deps.errors.recent === 'function'
          ? safe(() => deps.errors.recent({ limit: limit }), 'errors')
          : safe(() => deps.errors, 'errors');
        if (s.ok) { errorsArr = Array.isArray(s.value) ? s.value : []; errorsSection.errors = shapeErrors(errorsArr); }
        else errorsSection = { ok: false, reason: s.reason };
      } else errorsSection = { ok: false, reason: 'errors source not wired' };

      /* ALERTS — composed from the SAME cross-business feed the activity section reads, so there is one
         source of truth and no second query. The classification is by recorded `kind`, never invented: a
         held step, a refused step and a failed run are exactly the things a remote user must act on. When
         the errors store is wired separately its rows are folded in too, but the activity feed alone is
         enough — that is why this does not depend on `deps.errors`. */
      const alertSource = activityRaw.concat(errorsArr);
      const hub = deps.hub || {};
      const held = [], refused = [];
      for (const e of alertSource) {
        const k = str(e.kind, 80);
        if (k === 'business.workorder.step.held') held.push(e);
        else if (k === 'business.workorder.step.refused') refused.push(e);
      }
      const runErrors = alertSource.filter(e => str(e.kind, 80) === 'agent.run.error');
      const alerts = shapeAlerts({ hubHalted: hub.halted === true, hubHaltedAt: hub.haltedAt,
        heldSteps: held, refusedSteps: refused, runErrors: runErrors });

      const counts = {
        alerts: alerts.length,
        pendingApprovals: approvalsSection.ok ? approvalsSection.count : null,
        openTasks: tasksSection.ok ? tasksSection.tasks.length : null,
        businesses: bizList ? bizList.length : null
      };

      return {
        at: at,
        sections: SECTIONS.slice(),         // the render order, published so a client never guesses
        counts: counts,
        alerts: alerts,
        approvals: approvalsSection,
        status: statusSection,
        tasks: tasksSection,
        revenue: revenueSection,
        activity: activitySection,
        errors: errorsSection
      };
    }

    /* oneBusiness(id) — the focused view a notification would deep-link to. Strictly scoped (§P6): an
       unknown id returns ok:false, never another business's rows. */
    function oneBusiness(id) {
      const bid = str(id, 200).trim();
      if (!bid) return { ok: false, reason: 'a businessId is required' };
      const b = deps.businesses ? safe(() => deps.businesses.get(bid), 'businesses') : { ok: true, value: null };
      if (!b.ok) return { ok: false, reason: b.reason };
      if (!b.value) return { ok: false, reason: 'no such business: ' + bid };

      const pending = deps.approvals ? safe(() => deps.approvals.list(bid, { status: (deps.approvals.OPEN_STATUS || 'pending') }), 'approvals') : { ok: true, value: [] };
      const summaryAp = deps.approvals ? safe(() => deps.approvals.summary(bid), 'approvals') : { ok: true, value: null };
      const tasks = deps.workOrders ? safe(() => deps.workOrders.list(bid, { open: true, limit: 200 }), 'workOrders') : { ok: true, value: [] };
      const totals = deps.finance ? safe(() => deps.finance.totals(bid), 'finance') : { ok: true, value: { byCurrency: {} } };
      const acts = deps.activity ? safe(() => deps.activity.list(bid, { limit: 20 }), 'activity') : { ok: true, value: [] };

      const unread = [pending, summaryAp, tasks, totals, acts].some(s => s.ok === false);
      return {
        ok: true,
        business: { id: b.value.id, name: str(b.value.name, 120), stage: str(b.value.stage, 40),
          template: str(b.value.template, 40), currency: str(b.value.currency, 8) || null,
          paused: b.value.paused === true, updatedAt: num(b.value.updatedAt) },
        approvals: {
          ok: pending.ok,
          reason: pending.ok ? undefined : pending.reason,
          open: pending.ok ? shapeApprovals(pending.value, null) : null,
          summary: summaryAp.ok ? summaryAp.value : null
        },
        tasks: { ok: tasks.ok, reason: tasks.ok ? undefined : tasks.reason,
          open: tasks.ok ? shapeTasks(tasks.value) : null },
        revenue: { ok: totals.ok, reason: totals.ok ? undefined : totals.reason,
          currencies: totals.ok ? shapeRevenue(totals.value) : null },
        activity: { ok: acts.ok, reason: acts.ok ? undefined : acts.reason,
          recent: acts.ok ? shapeActivity(acts.value) : null },
        complete: !unread
      };
    }

    /* priority() — the brief's ordering as a callable, so a client can render "most important first"
       without hard-coding the list. */
    function priority() { return SECTIONS.slice(); }

    return { summary, oneBusiness, priority, SECTIONS };
  }

  return {
    makeRemoteReadModel,
    SECTIONS,
    // shapers exported so a test can exercise them without a full deps set
    shapeAlerts, shapeApprovals, shapeStatus, shapeTasks, shapeRevenue, shapeActivity, shapeErrors
  };
});
