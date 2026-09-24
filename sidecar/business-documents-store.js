/* sidecar/business-documents-store.js — §15 DOCUMENT GENERATOR (Business OS Phase 4).

   §15: "A workspace capable of producing business plans, product specs, research reports, marketing plans,
   SOPs, meeting notes, investor documents, technical documentation, customer documentation, internal
   policies, and reports. Documents belong to a business/project and are searchable."

   THE ONE DESIGN QUESTION THIS MODULE HAD TO ANSWER (P4): does it duplicate deliverable-store.js?

   No, and the boundary is worth stating precisely because the two look similar from a distance.
   deliverable-store.js records WHAT A RUN PRODUCED: its rows are keyed by agentId/runId, carry a `source`
   of 'workshop', a `status` of ok/failed, and file blobs under an .output directory. It answers "what did
   the machine finish, and where is the file".

   This store records WHAT THE BUSINESS OWNS: a typed document (a business plan, a spec, a policy) that
   belongs to a business or a project, was authored or uploaded deliberately, and is searchable by its own
   text. It answers "what does this business know, in writing".

   They MEET rather than overlap: a document may carry a `deliverableId` pointing at the run output it came
   from, and it does so by REFERENCE — this store never copies a deliverable's bytes, so a re-run cannot
   leave two divergent copies of the same file on disk. A test pins that a document row holds no `files`
   array, so the two cannot quietly converge.

   A DOCUMENT NEEDS CONTENT OR A REFERENCE. A row with neither a body nor a deliverableId is an empty
   promise — a title with nothing behind it — and is refused. This is the small honest guard this store
   needs; §15's documents are not evidence claims, so no evidence class applies here.

   ISOLATION (P6). Every document belongs to one business; an empty businessId is refused everywhere.
   `projectId` is an optional reference the route validates against the project store.

   PURE: no IO, no clock, no env, no rng. `persist` and `now` injected. UMD. Mirrors business-tasks-store.js. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).businessDocumentsStore = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // §15's list, verbatim, as a closed vocabulary. A typo is refused rather than becoming a 12th type that
  // nobody can filter for.
  const TYPES = [
    'business-plan', 'product-spec', 'research-report', 'marketing-plan', 'sop', 'meeting-notes',
    'investor-document', 'technical-doc', 'customer-doc', 'policy', 'report'
  ];

  // 'draft' is being written; 'final' is the version the business stands behind. Kept as a two-state flag
  // rather than a version chain, because a version history is a different feature and faking one with a
  // status field would be worse than not having it.
  const STATUSES = ['draft', 'final'];

  const MAX_TITLE = 200;
  const MAX_BODY = 200000;                    // documents are long; the cap is a guard, not a limit on use
  const MAX_TEXT = 2000;
  const MAX_ID = 120;
  const DEFAULT_LIMIT = 2000;

  function makeBusinessDocumentsStore(opts) {
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

    // NOTE the absence of a `files` field — see the header on the deliverable-store boundary.
    const rowView = (r) => ({
      id: r.id, seq: r.seq, businessId: r.businessId,
      projectId: r.projectId || '',
      type: r.type, title: r.title, body: r.body || '',
      status: r.status,
      // a REFERENCE to a run output, never a copy of it.
      deliverableId: r.deliverableId || '',
      createdBy: r.createdBy || 'user',
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

    // ---- reads -------------------------------------------------------------------------------------
    function documents(businessId, o) {
      const b = biz(businessId);
      if (!b) return [];
      o = o || {};
      let rows = forBiz(b);
      if (o.type) rows = rows.filter(r => r.type === String(o.type));
      if (o.status) rows = rows.filter(r => r.status === String(o.status));
      if (o.projectId) rows = rows.filter(r => r.projectId === String(o.projectId));
      return rows.slice().sort((a, b2) => (a.seq || 0) - (b2.seq || 0)).map(rowView);
    }
    function document(id) { const i = indexOf(id); return i < 0 ? null : rowView(records[i]); }
    function has(id) { return indexOf(id) >= 0; }
    function count(businessId) { const b = biz(businessId); return b ? forBiz(b).length : 0; }

    /* SEARCH — §15's "searchable". A case-insensitive substring match over title and body. It reports WHERE
       the match was and a short EXCERPT around it, and claims nothing about relevance: no score, no ranking
       beyond recency. A document search that invented a relevance number would be the P7 failure. */
    function search(businessId, query, o) {
      o = o || {};
      const b = biz(businessId);
      const q = str(query, 200).trim();
      if (!b || !q) return [];
      const needle = q.toLowerCase();
      const out = [];
      for (const r of documents(b, o)) {
        const titleHit = r.title.toLowerCase().indexOf(needle) >= 0;
        const bodyIdx = r.body.toLowerCase().indexOf(needle);
        if (!titleHit && bodyIdx < 0) continue;
        let excerpt = '';
        if (bodyIdx >= 0) {
          const from = Math.max(0, bodyIdx - 60);
          excerpt = (from > 0 ? '…' : '') + r.body.slice(from, bodyIdx + needle.length + 60) + (bodyIdx + needle.length + 60 < r.body.length ? '…' : '');
        }
        out.push({ id: r.id, type: r.type, title: r.title, status: r.status, matchedIn: titleHit ? 'title' : 'body', excerpt: excerpt });
      }
      const n = (Number.isFinite(o.limit) && o.limit > 0) ? Math.floor(o.limit) : 0;
      return n ? out.slice(0, n) : out;
    }

    function summary(businessId) {
      const rows = documents(businessId);
      const out = { total: rows.length, byType: {}, byStatus: {} };
      for (const t of TYPES) out.byType[t] = 0;
      for (const s of STATUSES) out.byStatus[s] = 0;
      for (const r of rows) {
        if (Object.prototype.hasOwnProperty.call(out.byType, r.type)) out.byType[r.type]++;
        if (Object.prototype.hasOwnProperty.call(out.byStatus, r.status)) out.byStatus[r.status]++;
      }
      return out;
    }

    // ---- writes ------------------------------------------------------------------------------------
    function create(businessId, meta) {
      meta = meta || {};
      const b = biz(businessId);
      if (!b) return { ok: false, reason: 'a businessId is required (isolation is by key — never implied)' };
      const title = str(meta.title, MAX_TITLE).trim();
      if (!title) return { ok: false, reason: 'a document needs a title' };
      const type = String(meta.type == null ? '' : meta.type);
      if (TYPES.indexOf(type) < 0) {
        return { ok: false, reason: 'unknown document type: ' + (type || '(none)') + ' — one of: ' + TYPES.join(', ') };
      }
      const status = meta.status != null ? String(meta.status) : 'draft';
      if (STATUSES.indexOf(status) < 0) return { ok: false, reason: 'unknown status: ' + status };

      const body = str(meta.body, MAX_BODY);
      const deliverableId = str(meta.deliverableId, MAX_ID).trim();
      if (!body.trim() && !deliverableId) {
        return { ok: false, reason: 'a document needs content or a deliverable reference — a title with nothing behind it is an empty promise' };
      }

      const at = now();
      const seq = nextSeq(b);
      const row = {
        // '~' not '#' — a document id travels in a URL path (see validation-store.js).
        id: b + '~d' + seq, seq: seq, businessId: b,
        projectId: str(meta.projectId, MAX_ID),
        type: type, title: title, body: body, status: status,
        deliverableId: deliverableId,
        createdBy: str(meta.createdBy, 60) || 'user',
        createdAt: at, updatedAt: at
      };

      let next = records.slice(); next.push(row);
      const mine = next.filter(r => r && r.businessId === b);
      if (mine.length > limit) {
        const keep = new Set(mine.slice(mine.length - limit).map(r => r.id));
        next = next.filter(r => r.businessId !== b || keep.has(r.id));
      }
      const w = commit(next);
      if (!w.ok) return w;
      return { ok: true, document: rowView(row) };
    }

    function update(id, patch) {
      patch = patch || {};
      const i = indexOf(id);
      if (i < 0) return { ok: false, reason: 'unknown document: ' + id };
      const prev = records[i];
      const nextRow = rowView(prev);

      if (patch.title != null) {
        const t = str(patch.title, MAX_TITLE).trim();
        if (!t) return { ok: false, reason: 'title cannot be blank' };
        nextRow.title = t;
      }
      if (patch.type != null) {
        const t = String(patch.type);
        if (TYPES.indexOf(t) < 0) return { ok: false, reason: 'unknown document type: ' + t };
        nextRow.type = t;
      }
      if (patch.body != null) nextRow.body = str(patch.body, MAX_BODY);
      if (patch.projectId != null) nextRow.projectId = str(patch.projectId, MAX_ID);
      if (patch.deliverableId != null) nextRow.deliverableId = str(patch.deliverableId, MAX_ID).trim();
      if (patch.status != null) {
        const s = String(patch.status);
        if (STATUSES.indexOf(s) < 0) return { ok: false, reason: 'unknown status: ' + s };
        nextRow.status = s;
      }
      // re-check the "content or reference" rule AFTER the patch, so an edit cannot empty a document out.
      if (!String(nextRow.body || '').trim() && !nextRow.deliverableId) {
        return { ok: false, reason: 'a document needs content or a deliverable reference' };
      }

      nextRow.id = prev.id; nextRow.seq = prev.seq; nextRow.businessId = prev.businessId;
      nextRow.createdAt = prev.createdAt; nextRow.createdBy = prev.createdBy;
      nextRow.updatedAt = now();

      const next = records.slice(); next[i] = nextRow;
      const w = commit(next);
      if (!w.ok) return w;
      return { ok: true, document: rowView(nextRow) };
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
      TYPES, STATUSES, LIMIT: limit,
      documents, document, has, count, search, summary,
      create, update, remove, clear
    };
  }

  return { makeBusinessDocumentsStore, TYPES, STATUSES, DEFAULT_LIMIT };
});
