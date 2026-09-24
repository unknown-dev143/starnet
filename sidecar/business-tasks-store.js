/* sidecar/business-tasks-store.js — the TASK & PROJECT ENGINE (master prompt §9).

   Every task in SpaceStation belongs to exactly ONE business. There is no global task list, because §9's
   relationship model is User -> Businesses -> Projects -> Tasks and a task that belongs to nobody is a task
   nobody is accountable for. So `businessId` is a REQUIRED argument on every write and an empty one is
   REFUSED rather than read as "everything" — the same isolation rule as business-activity-store and
   validation-store (P6). A task is also REFUSED if it names a dependency in another business: a cross-
   business edge would leak one business's plan into another's and would make the per-business E-STOP
   (§21) incoherent, since stopping one business must never strand another's work.

   WHAT §9 REQUIRES, AND WHERE EACH FIELD LIVES
     priority · status · deadline · dependencies · assigned agent · assigned user · business · project ·
     estimated effort · actual effort · logs · attachments · approval requirements
   All thirteen are real fields here. Nothing is stubbed and nothing is inferred.

   P1 — EFFORT IS LABELLED. `estimated` is always { hours, evidence: 'estimate' } (a plan has never run).
   `actual` is { hours, evidence } and defaults to 'verified' because recording actual effort means it
   happened and was measured — but a caller may pass 'estimate' when it is really a guess, and the label
   travels with the number rather than being assumed at the UI.

   P7 — NO DERIVED INTELLIGENCE. The store exposes `summary()` (counts by status and priority) and
   `blockers(id)` (the unmet dependencies, as a fact). It computes NO progress percentage, NO health score
   and NO priority re-ranking. "3 of 8 done" is checkable; "37% healthy" would be invented.

   PURE: no IO, no clock, no env, no rng. `persist` and `now` injected; ids are a deterministic per-business
   sequence (`<businessId>#t<n>`). UMD. Mirrors businesses-store.js. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).businessTasksStore = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STATUSES = ['todo', 'doing', 'blocked', 'review', 'done', 'cancelled'];
  const PRIORITIES = ['low', 'normal', 'high', 'critical'];
  const APPROVALS = ['not-required', 'pending', 'approved', 'rejected'];
  // The only classes an effort number may carry. Kept identical to the P1 vocabulary elsewhere.
  const EFFORT_EVIDENCE = ['verified', 'analysis', 'assumption', 'estimate', 'prediction', 'unknown'];

  const MAX_TITLE = 200;
  const MAX_TEXT = 4000;
  const MAX_ID = 120;
  const DEFAULT_LIMIT = 2000;                 // per business, so one runaway plan cannot grow unbounded

  function makeBusinessTasksStore(opts) {
    opts = opts || {};
    const records = Array.isArray(opts.records) ? opts.records : [];
    const persist = typeof opts.persist === 'function' ? opts.persist : null;
    const now = typeof opts.now === 'function' ? opts.now : (() => null);
    const limit = (Number.isFinite(opts.limit) && opts.limit > 0) ? Math.floor(opts.limit) : DEFAULT_LIMIT;

    const str = (v, cap) => (v == null ? '' : String(v)).slice(0, cap);
    const indexOf = (id) => records.findIndex(r => r && r.id === id);
    const forBiz = (businessId) => records.filter(r => r && r.businessId === businessId);
    const biz = (v) => str(v, MAX_ID).trim();

    function nextSeq(businessId) {
      let max = 0;
      for (const r of records) if (r && r.businessId === businessId && r.seq > max) max = r.seq;
      return max + 1;
    }

    // A deadline is either an epoch-ms number or an ISO-ish date string. Validated by SHAPE, never by
    // `new Date()` (banned in sidecar by lint-determinism, and parsing "now" would be a clock read).
    const RX_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})?/;
    function deadlineView(v) {
      if (v == null || v === '') return null;
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      const s = String(v).trim();
      if (!s) return null;
      return RX_DATE.test(s) ? s : undefined;   // undefined = present but malformed (caller refuses it)
    }

    function effortView(e, fallbackEvidence) {
      if (e == null) return null;
      const hours = (typeof e === 'number') ? e : Number(e.hours);
      if (!Number.isFinite(hours) || hours < 0) return undefined;   // malformed
      const ev = EFFORT_EVIDENCE.indexOf(e && e.evidence) >= 0 ? e.evidence : fallbackEvidence;
      return { hours: hours, evidence: ev };
    }

    const idList = (v, cap) => (Array.isArray(v) ? v : []).map(x => str(x, MAX_ID)).filter(Boolean).slice(0, cap || 64);
    const strList = (v, cap) => (Array.isArray(v) ? v : []).map(x => str(x, MAX_TEXT)).filter(Boolean).slice(0, cap || 200);

    const rowView = (r) => ({
      id: r.id,
      seq: r.seq,
      businessId: r.businessId,
      projectId: r.projectId || '',
      title: r.title,
      detail: r.detail || '',
      stage: r.stage || '',                 // the template stage this task came from, if any
      status: r.status,
      priority: r.priority,
      deadline: r.deadline != null ? r.deadline : null,
      dependsOn: (Array.isArray(r.dependsOn) ? r.dependsOn : []).slice(),
      assignedAgent: r.assignedAgent || '',
      assignedUser: r.assignedUser || '',
      estimated: r.estimated ? { hours: r.estimated.hours, evidence: r.estimated.evidence } : null,
      actual: r.actual ? { hours: r.actual.hours, evidence: r.actual.evidence } : null,
      approval: r.approval || 'not-required',
      logs: (Array.isArray(r.logs) ? r.logs : []).map(l => ({ at: l.at != null ? l.at : null, text: l.text || '', kind: l.kind || 'note' })),
      attachments: strList(r.attachments),
      origin: r.origin === 'plan' ? 'plan' : 'user',
      createdAt: r.createdAt != null ? r.createdAt : null,
      updatedAt: r.updatedAt != null ? r.updatedAt : null
    });

    function commit(next) {
      if (persist) {
        try { persist(next.map(rowView)); }
        catch (e) { return { ok: false, reason: 'could not persist — denied' }; }
      }
      records.length = 0;
      for (const r of next) records.push(r);
      return { ok: true };
    }

    // Validate a dependency list: every id must EXIST and belong to THIS business. A dangling or foreign
    // dependency is refused rather than stored, because a stored one would look satisfied forever.
    function checkDeps(businessId, deps, selfId) {
      for (const d of deps) {
        if (selfId && d === selfId) return { ok: false, reason: 'a task cannot depend on itself' };
        const i = indexOf(d);
        if (i < 0) return { ok: false, reason: 'unknown dependency: ' + d };
        if (records[i].businessId !== businessId) {
          return { ok: false, reason: 'dependency ' + d + ' belongs to another business — cross-business links are refused (P6)' };
        }
      }
      return { ok: true };
    }

    // ---- reads ---------------------------------------------------------------------------------------
    function list(businessId) {
      const b = biz(businessId);
      if (!b) return [];
      return forBiz(b).slice().sort((a, b2) => (a.seq || 0) - (b2.seq || 0)).map(rowView);
    }
    function get(id) { const i = indexOf(id); return i < 0 ? null : rowView(records[i]); }
    function has(id) { return indexOf(id) >= 0; }
    function count(businessId) { const b = biz(businessId); return b ? forBiz(b).length : 0; }

    // Counts only. Deliberately not a percentage and not a score — see the header.
    function summary(businessId) {
      const rows = list(businessId);
      const out = { total: rows.length, byStatus: {}, byPriority: {}, awaitingApproval: 0, overdue: null };
      for (const s of STATUSES) out.byStatus[s] = 0;
      for (const p of PRIORITIES) out.byPriority[p] = 0;
      for (const r of rows) {
        if (Object.prototype.hasOwnProperty.call(out.byStatus, r.status)) out.byStatus[r.status]++;
        if (Object.prototype.hasOwnProperty.call(out.byPriority, r.priority)) out.byPriority[r.priority]++;
        if (r.approval === 'pending') out.awaitingApproval++;
      }
      // 'overdue' needs a clock, and this module has none. The caller compares deadlines to its own now —
      // so we expose the raw deadlines and let a clock-owning layer decide. Honest by construction.
      out.open = rows.filter(r => r.status !== 'done' && r.status !== 'cancelled').length;
      return out;
    }

    // The UNMET dependencies of a task — a fact, not a judgement. A task with an unfinished dependency is
    // blocked in reality whether or not anyone flipped its status, and saying so is the point.
    function blockers(id) {
      const i = indexOf(id);
      if (i < 0) return [];
      const deps = Array.isArray(records[i].dependsOn) ? records[i].dependsOn : [];
      const out = [];
      for (const d of deps) {
        const j = indexOf(d);
        if (j < 0) { out.push({ id: d, title: '(missing)', status: 'unknown' }); continue; }
        if (records[j].status !== 'done') out.push({ id: d, title: records[j].title, status: records[j].status });
      }
      return out;
    }

    // ---- writes --------------------------------------------------------------------------------------
    function build(businessId, meta, seq, origin) {
      const at = now();
      return {
        // '~' not '#' — see validation-store.js: a task id travels in a URL path (/api/tasks/<id>), and '#'
        // would be stripped as a fragment delimiter before the request ever left the browser.
        id: businessId + '~t' + seq,
        seq: seq,
        businessId: businessId,
        projectId: str(meta.projectId, MAX_ID),
        title: str(meta.title, MAX_TITLE).trim(),
        detail: str(meta.detail, MAX_TEXT),
        stage: str(meta.stage, 60),
        status: meta.status != null ? String(meta.status) : 'todo',
        priority: meta.priority != null ? String(meta.priority) : 'normal',
        deadline: null,                        // set below (deadlineView can return undefined = malformed)
        dependsOn: idList(meta.dependsOn),
        assignedAgent: str(meta.assignedAgent, MAX_ID),
        assignedUser: str(meta.assignedUser, MAX_ID),
        estimated: null,
        actual: null,
        approval: meta.approval != null ? String(meta.approval) : (meta.approvalRequired ? 'pending' : 'not-required'),
        logs: [],
        attachments: strList(meta.attachments),
        origin: origin,
        createdAt: at,
        updatedAt: at
      };
    }

    // Validate the closed vocabularies + effort/deadline shapes shared by create() and materialise().
    function validateMeta(meta) {
      const status = meta.status != null ? String(meta.status) : 'todo';
      if (STATUSES.indexOf(status) < 0) return { ok: false, reason: 'unknown status: ' + status };
      const priority = meta.priority != null ? String(meta.priority) : 'normal';
      if (PRIORITIES.indexOf(priority) < 0) return { ok: false, reason: 'unknown priority: ' + priority };
      const approval = meta.approval != null ? String(meta.approval) : (meta.approvalRequired ? 'pending' : 'not-required');
      if (APPROVALS.indexOf(approval) < 0) return { ok: false, reason: 'unknown approval state: ' + approval };
      const dl = deadlineView(meta.deadline);
      if (dl === undefined) return { ok: false, reason: 'deadline must be an epoch-ms number or a YYYY-MM-DD date' };
      const est = effortView(meta.estimated, 'estimate');
      if (est === undefined) return { ok: false, reason: 'estimated effort must be { hours >= 0 }' };
      const act = effortView(meta.actual, 'verified');
      if (act === undefined) return { ok: false, reason: 'actual effort must be { hours >= 0 }' };
      return { ok: true, status: status, priority: priority, approval: approval, deadline: dl, estimated: est, actual: act };
    }

    function create(businessId, meta) {
      meta = meta || {};
      const b = biz(businessId);
      if (!b) return { ok: false, reason: 'a businessId is required (isolation is by key — never implied)' };
      const title = str(meta.title, MAX_TITLE).trim();
      if (!title) return { ok: false, reason: 'a task title is required' };
      const v = validateMeta(meta);
      if (!v.ok) return v;
      const deps = idList(meta.dependsOn);
      const dc = checkDeps(b, deps, null);
      if (!dc.ok) return dc;

      const row = build(b, meta, nextSeq(b), 'user');
      row.status = v.status; row.priority = v.priority; row.approval = v.approval;
      row.deadline = v.deadline; row.estimated = v.estimated; row.actual = v.actual;

      // cap THIS business only — never another's.
      let next = records.slice(); next.push(row);
      const mine = next.filter(r => r && r.businessId === b);
      if (mine.length > limit) {
        const keep = new Set(mine.slice(mine.length - limit).map(r => r.id));
        next = next.filter(r => r.businessId !== b || keep.has(r.id));
      }
      const w = commit(next);
      if (!w.ok) return w;
      return { ok: true, task: rowView(row) };
    }

    /* MATERIALISE A PLAN — turn business-templates' ordered list into real tasks, chaining each to the one
       before it so the plan's order becomes a real dependency chain (and blockers() can prove it). The
       chain is per-PLAN: `chain: false` creates independent tasks for a plan whose steps are parallel.
       ALL-OR-NOTHING: one bad entry aborts the whole batch, so a half-created plan never lands. */
    function materialise(businessId, planTasks, meta) {
      meta = meta || {};
      const b = biz(businessId);
      if (!b) return { ok: false, reason: 'a businessId is required' };
      if (!Array.isArray(planTasks) || !planTasks.length) return { ok: false, reason: 'planTasks must be a non-empty array' };
      const chain = meta.chain !== false;
      const projectId = str(meta.projectId, MAX_ID);

      // validate everything FIRST (all-or-nothing).
      for (const t of planTasks) {
        if (!t || !str(t.title, MAX_TITLE).trim()) return { ok: false, reason: 'every plan task needs a title' };
        const v = validateMeta(t);
        if (!v.ok) return { ok: false, reason: 'plan task "' + t.title + '": ' + v.reason };
      }
      if (forBiz(b).length + planTasks.length > limit) {
        return { ok: false, reason: 'this plan would exceed the ' + limit + '-task cap for the business' };
      }

      let seq = nextSeq(b);
      const created = [];
      let prevId = null;
      for (const t of planTasks) {
        const m = Object.assign({}, t, { projectId: projectId });
        const row = build(b, m, seq++, 'plan');
        const v = validateMeta(m);
        row.status = v.status; row.priority = v.priority; row.approval = v.approval;
        row.deadline = v.deadline; row.estimated = v.estimated; row.actual = v.actual;
        if (chain && prevId) row.dependsOn = [prevId];
        records.push(row);                      // staged in memory; persisted once below
        created.push(row);
        prevId = row.id;
      }
      const w = commit(records.slice());
      if (!w.ok) {
        // roll back the staged rows so a failed persist leaves memory exactly as it was.
        for (const r of created) { const i = indexOf(r.id); if (i >= 0) records.splice(i, 1); }
        return w;
      }
      return { ok: true, tasks: created.map(rowView), chained: chain };
    }

    function update(id, patch) {
      patch = patch || {};
      const i = indexOf(id);
      if (i < 0) return { ok: false, reason: 'unknown task: ' + id };
      const prev = records[i];
      const nextRow = rowView(prev);

      if (patch.title != null) {
        const t = str(patch.title, MAX_TITLE).trim();
        if (!t) return { ok: false, reason: 'title cannot be blank' };
        nextRow.title = t;
      }
      if (patch.detail != null) nextRow.detail = str(patch.detail, MAX_TEXT);
      if (patch.projectId != null) nextRow.projectId = str(patch.projectId, MAX_ID);
      if (patch.stage != null) nextRow.stage = str(patch.stage, 60);
      if (patch.status != null) {
        const s = String(patch.status);
        if (STATUSES.indexOf(s) < 0) return { ok: false, reason: 'unknown status: ' + s };
        nextRow.status = s;
      }
      if (patch.priority != null) {
        const p = String(patch.priority);
        if (PRIORITIES.indexOf(p) < 0) return { ok: false, reason: 'unknown priority: ' + p };
        nextRow.priority = p;
      }
      if (patch.approval != null) {
        const a = String(patch.approval);
        if (APPROVALS.indexOf(a) < 0) return { ok: false, reason: 'unknown approval state: ' + a };
        nextRow.approval = a;
      }
      if (patch.deadline != null) {
        const dl = deadlineView(patch.deadline);
        if (dl === undefined) return { ok: false, reason: 'deadline must be an epoch-ms number or a YYYY-MM-DD date' };
        nextRow.deadline = dl;
      }
      if (patch.dependsOn != null) {
        const deps = idList(patch.dependsOn);
        const dc = checkDeps(prev.businessId, deps, prev.id);
        if (!dc.ok) return dc;
        nextRow.dependsOn = deps;
      }
      if (patch.assignedAgent != null) nextRow.assignedAgent = str(patch.assignedAgent, MAX_ID);
      if (patch.assignedUser != null) nextRow.assignedUser = str(patch.assignedUser, MAX_ID);
      if (patch.estimated != null) {
        const e = effortView(patch.estimated, 'estimate');
        if (e === undefined) return { ok: false, reason: 'estimated effort must be { hours >= 0 }' };
        nextRow.estimated = e;
      }
      if (patch.actual != null) {
        const a = effortView(patch.actual, 'verified');
        if (a === undefined) return { ok: false, reason: 'actual effort must be { hours >= 0 }' };
        nextRow.actual = a;
      }
      if (patch.attachments != null) nextRow.attachments = strList(patch.attachments);

      // immutable
      nextRow.id = prev.id; nextRow.seq = prev.seq; nextRow.businessId = prev.businessId;
      nextRow.origin = prev.origin; nextRow.createdAt = prev.createdAt;
      nextRow.updatedAt = now();

      const next = records.slice(); next[i] = nextRow;
      const w = commit(next);
      if (!w.ok) return w;
      return { ok: true, task: rowView(nextRow) };
    }

    function setStatus(id, status) { return update(id, { status: status }); }

    // Append a log line. `kind` is free-form but defaults to 'note'; logs are append-only by construction.
    function addLog(id, entry) {
      entry = entry || {};
      const i = indexOf(id);
      if (i < 0) return { ok: false, reason: 'unknown task: ' + id };
      const text = str(entry.text, MAX_TEXT).trim();
      if (!text) return { ok: false, reason: 'a log entry needs text' };
      const prev = records[i];
      const logs = (Array.isArray(prev.logs) ? prev.logs : []).slice();
      logs.push({ at: now(), text: text, kind: str(entry.kind, 40) || 'note' });
      const nextRow = Object.assign({}, prev, { logs: logs, updatedAt: now() });
      const next = records.slice(); next[i] = nextRow;
      const w = commit(next);
      if (!w.ok) return w;
      return { ok: true, task: rowView(nextRow) };
    }

    function attach(id, ref) {
      const r = str(ref, MAX_TEXT).trim();
      if (!r) return { ok: false, reason: 'an attachment reference is required' };
      const i = indexOf(id);
      if (i < 0) return { ok: false, reason: 'unknown task: ' + id };
      const prev = records[i];
      const list = strList(prev.attachments); list.push(r);
      const nextRow = Object.assign({}, prev, { attachments: list, updatedAt: now() });
      const next = records.slice(); next[i] = nextRow;
      const w = commit(next);
      if (!w.ok) return w;
      return { ok: true, task: rowView(nextRow) };
    }

    function remove(id) {
      const i = indexOf(id);
      if (i < 0) return { ok: true };
      // refuse to orphan a dependency: a task other tasks depend on must be detached first.
      const dependents = records.filter(r => r && Array.isArray(r.dependsOn) && r.dependsOn.indexOf(id) >= 0);
      if (dependents.length) {
        return { ok: false, reason: dependents.length + ' task(s) depend on ' + id + ' — detach them first' };
      }
      const next = records.slice(); next.splice(i, 1);
      const w = commit(next);
      if (!w.ok) return w;
      return { ok: true };
    }

    // CLEAR one business's tasks. Never another's.
    function clear(businessId) {
      const b = biz(businessId);
      if (!b) return { ok: false, reason: 'a businessId is required' };
      const next = records.filter(r => !(r && r.businessId === b));
      const w = commit(next);
      if (!w.ok) return w;
      return { ok: true };
    }

    return {
      STATUSES, PRIORITIES, APPROVALS, EFFORT_EVIDENCE, LIMIT: limit,
      list, get, has, count, summary, blockers,
      create, materialise, update, setStatus, addLog, attach, remove, clear
    };
  }

  return { makeBusinessTasksStore, STATUSES, PRIORITIES, APPROVALS, DEFAULT_LIMIT };
});
