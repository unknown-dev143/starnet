/* sidecar/creations-index.js — the MY CREATIONS index (§37: one place that spans every made thing).

   WHAT THIS IS. The station records work in several stores, each honest on its own: content pieces
   (§17 pipeline), business documents, work orders (an agent's planned run), and station deliverables
   (what a run actually produced). But there is no ONE place that answers "show me everything I have made,
   and where each thing stands" — the audit (docs/PHASE0-AUDIT-v4.md §6) named this the second genuine gap.

   THIS MODULE OWNS NO STORE. It COMPOSES the four via injected accessors into one flat index, the way
   business-remote.js composes its snapshot. It reads; it never writes. Every row carries the four facts a
   person actually scans for:

       type · id · title · status · businessId · businessName · updatedAt

   HONESTY RULES (P1/P2/P7), the same as business-remote.js and mission-control.js:
     1. An unreadable source is reported per-source as `readable:false` — never silently dropped, never
        rendered as "you made nothing".
     2. A row with no recorded date carries `updatedAt: null`, never a fabricated now (it sorts last).
     3. No score, no rank, no percentage. The ORDER is by most-recently-updated, which is a fact.
     4. Fields are BOUNDED to what the stores actually hold — a work order's title is its `intent`, a
        content piece's status is its §17 `stage`; the index does not invent a display field the store lacks.

   PURE-ish: every source is injected; the clock is injected (determinism lint). UMD. */

'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).creationsIndex = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // The closed set of creation TYPES this index spans. Each maps to one store + one adapter. Adding a
  // type is a deliberate edit here — never a silent new kind appearing in the rows.
  const TYPES = ['content', 'document', 'workorder', 'deliverable'];

  const MAX_TITLE = 200;
  const MAX_NAME = 120;
  const DEFAULT_LIMIT = 500;

  function str(v, cap) {
    const s = (v == null ? '' : String(v));
    const c = cap || MAX_TITLE;
    return s.length > c ? s.slice(0, c) + '…' : s;
  }
  function num(v) { return Number.isFinite(v) ? v : (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null); }

  function makeCreationsIndex(opts) {
    opts = opts || {};
    const businesses = typeof opts.businesses === 'function' ? opts.businesses : (() => []);
    const content = opts.content || null;            // business-content-store
    const documents = opts.documents || null;        // business-documents-store
    const workorders = opts.workorders || null;      // business-workorders-store
    const deliverables = opts.deliverables || null;  // deliverable-store (station-level, no businessId)
    const now = typeof opts.now === 'function' ? opts.now : (() => null);
    const limit = (Number.isFinite(opts.limit) && opts.limit > 0) ? Math.floor(opts.limit) : DEFAULT_LIMIT;

    /* ADAPTERS — one per type. Each takes the raw store row(s) for ONE business (or the station, for
       deliverables) and returns a normalized creation row. Kept tiny and explicit so a store's own
       vocabulary (a piece's `stage`, an order's `intent`) is layered ONCE and named. */
    const ADAPTERS = {
      content: (b, row) => ({
        type: 'content', id: str(row.id),
        title: str(row.title || '(untitled)'),
        status: str(row.stage || 'idea', 40),        // §17's stage IS the status
        businessId: str(b.id), businessName: str(b.name || '(unnamed)', MAX_NAME),
        updatedAt: num(row.updatedAt)
      }),
      document: (b, row) => ({
        type: 'document', id: str(row.id),
        title: str(row.title || '(untitled)'),
        status: str(row.status || 'draft', 40),
        businessId: str(b.id), businessName: str(b.name || '(unnamed)', MAX_NAME),
        updatedAt: num(row.updatedAt)
      }),
      workorder: (b, row) => ({
        type: 'workorder', id: str(row.id),
        // a work order has no title; its `intent` is what a person reads. No invented field.
        title: str(row.intent || '(no intent recorded)'),
        status: str(row.status || 'planned', 40),
        businessId: str(b.id), businessName: str(b.name || '(unnamed)', MAX_NAME),
        updatedAt: num(row.updatedAt) != null ? num(row.updatedAt) : num(row.createdAt)
      })
    };

    /* THE INDEX — every creation, newest first. `readable` maps each source to whether it answered, so a
       partial read is explicit: the caller sees "content read, documents could not be". */
    function index(o) {
      o = o || {};
      const wantType = o.type ? String(o.type) : '';
      const wantBiz = o.businessId ? String(o.businessId) : '';

      let list = [];
      let businessesReadable = true;
      try { list = businesses() || []; }
      catch (e) { list = []; businessesReadable = false; }

      const readable = { content: !!content, document: !!documents, workorder: !!workorders, deliverable: !!deliverables };
      const rows = [];

      for (const b of list) {
        if (!b || !b.id) continue;
        if (wantBiz && b.id !== wantBiz) continue;

        // content pieces
        if (content && readable.content && (!wantType || wantType === 'content')) {
          try { for (const r of content.pieces(b.id) || []) rows.push(ADAPTERS.content(b, r)); }
          catch (e) { readable.content = false; }
        }
        // documents
        if (documents && readable.document && (!wantType || wantType === 'document')) {
          try { for (const r of documents.documents(b.id) || []) rows.push(ADAPTERS.document(b, r)); }
          catch (e) { readable.document = false; }
        }
        // work orders
        if (workorders && readable.workorder && (!wantType || wantType === 'workorder')) {
          try { for (const r of workorders.list(b.id) || []) rows.push(ADAPTERS.workorder(b, r)); }
          catch (e) { readable.workorder = false; }
        }
      }

      // deliverables are STATION-level (no businessId) — read once, attributed to the station.
      if (deliverables && readable.deliverable && (!wantType || wantType === 'deliverable')) {
        try {
          for (const r of deliverables.list() || []) {
            if (wantBiz) continue;   // station-level rows never match a business filter
            rows.push({
              type: 'deliverable', id: str(r.id),
              title: str(r.title || '(untitled)'),
              status: str(r.status || 'kept', 40),
              businessId: str(r.businessId || ''), businessName: str(r.businessName || 'Station', MAX_NAME),
              updatedAt: num(r.updatedAt)
            });
          }
        } catch (e) { readable.deliverable = false; }
      }

      /* ORDER: most recently updated first; an undated row (null) sorts LAST — a fact, not a guess. Ties
         break on id so two reads never disagree (deterministic). */
      rows.sort((a, b) => {
        const au = a.updatedAt == null ? -1 : a.updatedAt;
        const bu = b.updatedAt == null ? -1 : b.updatedAt;
        if (bu !== au) return bu - au;
        return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
      });

      const capped = rows.slice(0, limit);
      const counts = { total: rows.length, byType: {} };
      for (const t of TYPES) counts.byType[t] = 0;
      for (const r of rows) counts.byType[r.type] = (counts.byType[r.type] || 0) + 1;

      return {
        ok: true,
        generatedAt: now(),
        types: TYPES.slice(),
        rows: capped,
        truncated: rows.length > capped.length,
        counts: counts,
        readable: readable,
        businessesReadable: businessesReadable,
        // `readable:false` on a source means "could not read", NOT "you have none" — say it in the note.
        note: Object.keys(readable).every(k => readable[k])
          ? ''
          : 'one or more sources could not be read — this index may be incomplete, not empty'
      };
    }

    return { index: index, TYPES: TYPES, DEFAULT_LIMIT: DEFAULT_LIMIT };
  }

  return { makeCreationsIndex, TYPES, DEFAULT_LIMIT };
});
