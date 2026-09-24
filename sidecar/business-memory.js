/* sidecar/business-memory.js — the FOUR-SCOPE MEMORY system (master prompt §9, "Memory").

   §9 keeps four separate scopes and says why: User (about the Commander), Business (belongs to one
   business), Project (belongs to one project), Agent (temporary/context-specific to one agent). "Unrelated
   businesses must not accidentally share sensitive information (P6)."

   WHY THIS IS NOT sidecar/memory-store.js. The existing memory-store.js is the per-STATION-agent notebook:
   it routes one agent's notebook/todo/declined/minted/pending files to disk. That is one agent's private
   scratch space. This module is the BUSINESS knowledge record — durable facts a business remembers across
   agents and sessions (objectives, decisions, customers, prior failures, policies). Different owner,
   different lifetime, different reader. Both exist on purpose; neither subsumes the other.

   ISOLATION IS STRUCTURAL (P6). There is no database and therefore no foreign key, so isolation is by KEY.
   Every entry stores an internal tenancy key `scope\u0000ownerId`, and every read filters on it. The ownerId
   is REQUIRED on write: an omitted ownerId is REFUSED, never read as "all businesses". This is the same
   rule as the activity log, for the same reason — the dangerous failure is not a leaked read, it is a write
   that silently lands in a shared bucket.

   PROVENANCE (P1). Every entry carries a `source` — where the memory came from — and it is REQUIRED, never
   defaulted. A remembered fact with no provenance is indistinguishable from one the AI invented, which is
   the failure P2 exists to prevent. This store deliberately does NOT carry an evidence class: memory records
   what was said or observed, while claims and estimates (which DO need a class) belong in the stores that
   produced them. Adding a second evidence vocabulary here would be the duplication P4 forbids.

   PURE: no IO, no clock, no env, no rng. `records` is the live array the composition root shares; `persist`
   is the durable sink and THROWS on a real write failure; `now` is the injected clock. Persist-before-commit
   (fail-closed). UMD so a frontend panel can read it. */

'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).businessMemory = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // §9's four scopes, in the order §9 lists them.
  const SCOPES = ['user', 'business', 'project', 'agent'];

  // §9's list of what the AI remembers, verbatim, as a closed vocabulary. A kind outside this set is
  // REFUSED rather than coerced — a memory store that accepts free-text categories cannot be filtered.
  const KINDS = [
    'objective', 'decision', 'document', 'customer', 'product', 'experiment',
    'failure', 'strategy', 'constraint', 'instruction', 'policy'
  ];

  // Where a memory came from. Required, closed vocabulary — see PROVENANCE in the header.
  const SOURCES = ['user', 'document', 'agent', 'import'];

  const MAX_TEXT = 4000;
  const DEFAULT_LIMIT = 400;      // per scope+owner; oldest dropped on overflow

  const SEP = '\u0000';

  function makeBusinessMemory(opts) {
    opts = opts || {};
    const records = Array.isArray(opts.records) ? opts.records : [];
    const persist = typeof opts.persist === 'function' ? opts.persist : null;
    const now = typeof opts.now === 'function' ? opts.now : (() => null);
    const limit = (Number.isFinite(opts.limit) && opts.limit > 0) ? Math.floor(opts.limit) : DEFAULT_LIMIT;

    const str = (v, cap) => (v == null ? '' : String(v)).slice(0, cap);

    // The tenancy key. Entries are stored WITH it, so isolation is a property of the row, not a filter a
    // caller could forget to apply.
    const keyOf = (scope, ownerId) => String(scope) + SEP + String(ownerId);
    const entryKey = (r) => keyOf(r.scope, r.ownerId);

    /* A namespace string for callers that need a single opaque id for a scope+owner (e.g. an agent's
       memory namespace). Mirrors businesses-store.memoryNamespace. */
    function namespace(scope, ownerId) {
      const s = String(scope == null ? '' : scope);
      const o = String(ownerId == null ? '' : ownerId);
      if (s === 'user') return 'mem:user';
      if (s === 'business') return 'mem:biz:' + o;
      if (s === 'project') return 'mem:proj:' + o;
      if (s === 'agent') return 'mem:agent:' + o;
      return 'mem:' + s + ':' + o;
    }

    const rowView = (r) => ({
      id: r.id, seq: r.seq, scope: r.scope, ownerId: r.ownerId,
      // The business this memory is filed under, when there is one. It is NOT the tenancy key (ownerId is),
      // but it is what lets a memory event and the UI name the business a project/agent-scope entry belongs
      // to — an agent-scope owner is 'biz~a1', which does not identify the business on its own.
      businessId: r.businessId || '',
      kind: r.kind, text: r.text, source: r.source,
      at: r.at != null ? r.at : null
    });

    const forKey = (scope, ownerId) => {
      const k = keyOf(scope, ownerId);
      return records.filter(r => r && entryKey(r) === k);
    };
    const newestFirst = (a, b) => (b.seq || 0) - (a.seq || 0);

    function nextSeq(scope, ownerId) {
      let max = 0;
      for (const r of records) if (r && entryKey(r) === keyOf(scope, ownerId) && r.seq > max) max = r.seq;
      return max + 1;
    }

    /* WRITE one memory. scope, kind, text and source are all required; ownerId is required for every scope
       except 'user' (a single-user station has exactly one user, so it is implied and normalised).
       Persist-before-commit: a thrown persist leaves memory untouched and returns ok:false. */
    function write(scope, ownerId, entry) {
      entry = entry || {};
      const sc = String(scope == null ? '' : scope);
      if (SCOPES.indexOf(sc) < 0) {
        return { ok: false, reason: 'unknown memory scope: "' + sc + '" — one of: ' + SCOPES.join(', ') };
      }
      let owner = str(ownerId, 120).trim();
      if (!owner) {
        if (sc !== 'user') return { ok: false, reason: 'a memory write to the "' + sc + '" scope needs an ownerId (isolation is by key — never implied)' };
        owner = 'user';
      }

      const kind = String(entry.kind == null ? '' : entry.kind);
      if (KINDS.indexOf(kind) < 0) {
        return { ok: false, reason: 'unknown memory kind: "' + kind + '" — one of: ' + KINDS.join(', ') };
      }
      const text = str(entry.text, MAX_TEXT).trim();
      if (!text) return { ok: false, reason: 'a memory needs some text' };

      const source = String(entry.source == null ? '' : entry.source);
      if (SOURCES.indexOf(source) < 0) {
        return { ok: false, reason: 'a memory needs a source (P1) — one of: ' + SOURCES.join(', ') };
      }

      const seq = nextSeq(sc, owner);
      const row = {
        id: sc + '~' + owner + '~' + seq,
        seq: seq, scope: sc, ownerId: owner,
        // a business-scope entry IS the business's memory, so businessId is the owner; for the other scopes
        // the caller states it (the route knows which business the agent/project lives in). A USER-scope
        // entry belongs to no business — even when it was written while working on one — so it never claims
        // a businessId it does not have.
        businessId: sc === 'user' ? '' : (str(entry.businessId, 120) || (sc === 'business' ? owner : '')),
        kind: kind, text: text, source: source,
        at: now()
      };

      // cap THIS scope+owner only: drop its oldest rows, never another owner's.
      let next = records.slice(); next.push(row);
      const mine = next.filter(r => r && entryKey(r) === keyOf(sc, owner)).sort(newestFirst);
      if (mine.length > limit) {
        const drop = new Set(mine.slice(limit).map(r => r.id));
        next = next.filter(r => !drop.has(r.id));
      }
      if (persist) {
        try { persist(next.map(rowView)); }
        catch (e) { return { ok: false, reason: 'could not persist memory — entry not recorded' }; }
      }
      records.length = 0;
      for (const r of next) records.push(r);
      return { ok: true, entry: rowView(row) };
    }

    /* READ one scope+owner, newest first. An empty ownerId returns [] — which is SAFE (empty, not
       everything) and mirrors the write-side refusal. `kind` optionally narrows to one category. */
    function read(scope, ownerId, o) {
      const sc = String(scope == null ? '' : scope);
      const owner = (sc === 'user' && !String(ownerId == null ? '' : ownerId).trim()) ? 'user' : str(ownerId, 120).trim();
      if (SCOPES.indexOf(sc) < 0 || !owner) return [];
      const wantKind = (o && o.kind != null) ? String(o.kind) : '';
      let rows = forKey(sc, owner);
      if (wantKind) rows = rows.filter(r => r.kind === wantKind);
      rows = rows.slice().sort(newestFirst).map(rowView);
      const n = (o && Number.isFinite(o.limit) && o.limit > 0) ? Math.floor(o.limit) : 0;
      return n ? rows.slice(0, n) : rows;
    }

    function count(scope, ownerId) {
      const sc = String(scope == null ? '' : scope);
      const owner = (sc === 'user' && !String(ownerId == null ? '' : ownerId).trim()) ? 'user' : str(ownerId, 120).trim();
      if (SCOPES.indexOf(sc) < 0 || !owner) return 0;
      return forKey(sc, owner).length;
    }

    // Per-kind counts for one scope+owner — a COUNT, never a score or a summary the store cannot support.
    function kinds(scope, ownerId) {
      const out = {};
      for (const k of KINDS) out[k] = 0;
      const rows = read(scope, ownerId);
      for (const r of rows) if (out[r.kind] != null) out[r.kind]++;
      return out;
    }

    function get(id) {
      const k = String(id == null ? '' : id);
      for (const r of records) if (r && r.id === k) return rowView(r);
      return null;
    }

    // FORGET one entry by id.
    function forget(id) {
      const k = String(id == null ? '' : id);
      const i = records.findIndex(r => r && r.id === k);
      if (i < 0) return { ok: true, removed: 0 };
      const next = records.slice(); next.splice(i, 1);
      if (persist) {
        try { persist(next.map(rowView)); }
        catch (e) { return { ok: false, reason: 'could not persist the forget — entry kept' }; }
      }
      records.length = 0;
      for (const r of next) records.push(r);
      return { ok: true, removed: 1 };
    }

    // CLEAR one scope+owner. Never touches another owner. Empty ownerId is refused (it would be a mass delete).
    function clear(scope, ownerId) {
      const sc = String(scope == null ? '' : scope);
      const owner = str(ownerId, 120).trim();
      if (SCOPES.indexOf(sc) < 0) return { ok: false, reason: 'unknown memory scope: ' + sc };
      if (!owner) return { ok: false, reason: 'clearing memory needs an ownerId — a bare clear would wipe every owner' };
      const k = keyOf(sc, owner);
      const next = records.filter(r => !(r && entryKey(r) === k));
      if (persist) {
        try { persist(next.map(rowView)); }
        catch (e) { return { ok: false, reason: 'could not persist the clear — memory kept' }; }
      }
      records.length = 0;
      for (const r of next) records.push(r);
      return { ok: true };
    }

    return { SCOPES, KINDS, SOURCES, LIMIT: limit, namespace, write, read, count, kinds, get, forget, clear };
  }

  return { makeBusinessMemory, SCOPES, KINDS, SOURCES, DEFAULT_LIMIT };
});
