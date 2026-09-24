/* sidecar/business-projects-store.js — the §9 PROJECT layer (Business OS Phase 4).

   WHY THIS EXISTS AT ALL, GIVEN PHASE 1 ALREADY SHIPPED TASKS. business-tasks-store.js has carried a
   `projectId` field since Phase 1 — but nothing ever created a project, so the field was a free string that
   named nothing. Phase 3's record says so in its own "still open" list: "Per-business projects -> Phase 4
   (Business Manager). The memory store already accepts a `project` scope; nothing creates project ids yet."
   This module is that missing referent. Without it, §9's memory scope 'project' can never be filled and a
   task's projectId can never be resolved back to a name.

   IT IS NOT projects-store.js. That module is the STATION's project registry: the blessed filesystem roots
   the Commander has granted, keyed by real path, used by pathtrust and the workspace lease. This one is a
   BUSINESS project: a named unit of work inside one venture, with a goal and an owning agent. Different
   owner, different key, different reader. Neither subsumes the other (P4).

   ISOLATION (P6) IS STRUCTURAL. Every project belongs to exactly one business and carries its businessId on
   the row; every read names a businessId and an empty one is REFUSED rather than read as "everything" —
   the same rule as business-tasks-store, validation-store and business-activity-store. `memoryNamespace()`
   is a first-class export for the same reason businesses-store exports one: a child store must be able to
   key on the parent without inventing its own convention.

   PURE: no IO, no clock, no env, no rng. `persist` and `now` are injected; ids are a deterministic
   per-business sequence. UMD. Mirrors businesses-store.js. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).businessProjectsStore = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // A project's life. 'done' is finished; 'archived' is out of the way but still readable — kept distinct
  // because collapsing them would make "what did we actually finish" unanswerable.
  const STATUSES = ['planned', 'active', 'paused', 'done', 'archived'];

  const MAX_NAME = 160;
  const MAX_TEXT = 4000;
  const MAX_ID = 120;
  const DEFAULT_LIMIT = 500;                 // per business

  function makeBusinessProjectsStore(opts) {
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

    const rowView = (r) => ({
      id: r.id,
      seq: r.seq,
      businessId: r.businessId,
      name: r.name,
      goal: r.goal || '',
      status: r.status,
      // the §7 role agent accountable for this project, by agent id. Free-form on purpose: the registry
      // lives in another store, so this is a REFERENCE the route validates, not a foreign key.
      ownerAgent: r.ownerAgent || '',
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

    /* The namespace a child store keys on. Deliberately shaped like businesses-store.memoryNamespace
       ('biz:<id>') so a project is addressable as biz:<businessId>:proj:<projectId> and the Phase 3 memory
       store's 'project' scope has an ownerId that cannot collide with a business or an agent id. */
    function memoryNamespace(id) {
      const i = indexOf(id);
      if (i < 0) return '';
      const r = records[i];
      return 'biz:' + String(r.businessId) + ':proj:' + String(r.id);
    }

    // ---- reads -------------------------------------------------------------------------------------
    function list(businessId) {
      const b = biz(businessId);
      if (!b) return [];
      return forBiz(b).slice().sort((a, b2) => (a.seq || 0) - (b2.seq || 0)).map(rowView);
    }
    function get(id) { const i = indexOf(id); return i < 0 ? null : rowView(records[i]); }
    function has(id) { return indexOf(id) >= 0; }
    function count(businessId) { const b = biz(businessId); return b ? forBiz(b).length : 0; }

    // Counts by status only. No progress percentage, no health score — P7. "3 of 8 done" is checkable;
    // "37% healthy" would be invented, and this store has no basis for it.
    function summary(businessId) {
      const rows = list(businessId);
      const out = { total: rows.length, byStatus: {} };
      for (const s of STATUSES) out.byStatus[s] = 0;
      for (const r of rows) if (Object.prototype.hasOwnProperty.call(out.byStatus, r.status)) out.byStatus[r.status]++;
      return out;
    }

    // ---- writes ------------------------------------------------------------------------------------
    function create(businessId, meta) {
      meta = meta || {};
      const b = biz(businessId);
      if (!b) return { ok: false, reason: 'a businessId is required (isolation is by key — never implied)' };
      const name = str(meta.name, MAX_NAME).trim();
      if (!name) return { ok: false, reason: 'a project name is required' };
      const status = meta.status != null ? String(meta.status) : 'planned';
      if (STATUSES.indexOf(status) < 0) return { ok: false, reason: 'unknown status: ' + status };

      const at = now();
      const seq = nextSeq(b);
      const row = {
        // '~' not '#' — a project id travels in a URL path, and '#' would be stripped as a fragment
        // delimiter before the request left the browser (see validation-store.js).
        id: b + '~p' + seq,
        seq: seq,
        businessId: b,
        name: name,
        goal: str(meta.goal, MAX_TEXT),
        status: status,
        ownerAgent: str(meta.ownerAgent, MAX_ID),
        createdAt: at,
        updatedAt: at
      };

      // cap THIS business only — never another's.
      let next = records.slice(); next.push(row);
      const mine = next.filter(r => r && r.businessId === b);
      if (mine.length > limit) {
        const keep = new Set(mine.slice(mine.length - limit).map(r => r.id));
        next = next.filter(r => r.businessId !== b || keep.has(r.id));
      }
      const w = commit(next);
      if (!w.ok) return w;
      return { ok: true, project: rowView(row) };
    }

    function update(id, patch) {
      patch = patch || {};
      const i = indexOf(id);
      if (i < 0) return { ok: false, reason: 'unknown project: ' + id };
      const prev = records[i];
      const nextRow = rowView(prev);

      if (patch.name != null) {
        const n = str(patch.name, MAX_NAME).trim();
        if (!n) return { ok: false, reason: 'name cannot be blank' };
        nextRow.name = n;
      }
      if (patch.goal != null) nextRow.goal = str(patch.goal, MAX_TEXT);
      if (patch.status != null) {
        const s = String(patch.status);
        if (STATUSES.indexOf(s) < 0) return { ok: false, reason: 'unknown status: ' + s };
        nextRow.status = s;
      }
      if (patch.ownerAgent != null) nextRow.ownerAgent = str(patch.ownerAgent, MAX_ID);

      // immutable
      nextRow.id = prev.id; nextRow.seq = prev.seq; nextRow.businessId = prev.businessId;
      nextRow.createdAt = prev.createdAt;
      nextRow.updatedAt = now();

      const next = records.slice(); next[i] = nextRow;
      const w = commit(next);
      if (!w.ok) return w;
      return { ok: true, project: rowView(nextRow) };
    }

    function setStatus(id, status) { return update(id, { status: status }); }

    /* REMOVE. The store cannot see the task store, so it cannot refuse a project that still has tasks on it
       — that check belongs to the route, which holds both (the same split as agent-routes' delete check).
       What the store CAN do is refuse to leave a dangling reference behind silently, so it reports the id it
       removed and the caller is responsible for the tasks. */
    function remove(id) {
      const i = indexOf(id);
      if (i < 0) return { ok: true, removed: 0 };
      const next = records.slice(); next.splice(i, 1);
      const w = commit(next);
      if (!w.ok) return w;
      return { ok: true, removed: 1 };
    }

    // CLEAR one business's projects. Never another's.
    function clear(businessId) {
      const b = biz(businessId);
      if (!b) return { ok: false, reason: 'a businessId is required' };
      const next = records.filter(r => !(r && r.businessId === b));
      const w = commit(next);
      if (!w.ok) return w;
      return { ok: true };
    }

    return {
      STATUSES, LIMIT: limit,
      list, get, has, count, summary, memoryNamespace,
      create, update, setStatus, remove, clear
    };
  }

  return { makeBusinessProjectsStore, STATUSES, DEFAULT_LIMIT };
});
