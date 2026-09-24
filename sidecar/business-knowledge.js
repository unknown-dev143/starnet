/* sidecar/business-knowledge.js — §15 KNOWLEDGE CENTER / business knowledge base (Business OS Phase 4).

   §15: "lets users and agents store PDFs, notes, research, websites, documents, product specs, customer
   feedback, competitor info, and internal docs. The AI retrieves relevant knowledge BEFORE making decisions."

   HOW THIS DIFFERS FROM business-memory.js (Phase 3) — the P4 question, and it is a real one because both
   modules hold business knowledge.

   Memory is what the business LEARNED: a distilled fact, of a closed kind (objective, decision, policy…),
   with a provenance source. It is the conclusion.

   Knowledge is what the business HAS: a source document — a PDF, a competitor's pricing page, a pile of
   customer feedback — stored with its own text and an origin. It is the raw material.

   They point at each other rather than duplicating: business-memory's `source` field already accepts
   'document', and THIS is the library that value refers to. Distilling a knowledge entry into a memory entry
   is the intended flow; keeping both would be the duplication, so neither module stores the other's shape.

   RETRIEVAL IS HONEST ABOUT WHAT IT IS. §15 asks the AI to retrieve relevant knowledge before deciding, and
   the temptation is to call a substring match "AI relevance". This module does NOT. `retrieve()` computes
   LITERAL TERM OVERLAP — how many distinct words of the query appear in the entry — and returns that number
   under the name `termOverlap`, together with the tokens that matched. It is labelled, it is reproducible,
   and a caller can verify it by reading the entry. No embedding, no semantic score, no invented confidence
   (P7). A retrieval result a reader cannot check is worse than no retrieval result.

   PROVENANCE (P1). Every entry states its `source` — where it came from. A knowledge base that cannot say
   where a document came from cannot be trusted before a decision, which is precisely the moment §15 asks it
   to be used.

   ISOLATION (P6). Every entry belongs to one business; an empty businessId is refused on every read and
   write, the same rule as the other Phase 1-4 stores.

   PURE: no IO, no clock, no env, no rng. `persist` and `now` injected. UMD. Mirrors business-tasks-store.js. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).businessKnowledge = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // §15's list of what can be stored, verbatim, as a closed vocabulary.
  const KINDS = ['pdf', 'note', 'research', 'website', 'document', 'spec', 'feedback', 'competitor', 'internal'];

  const MAX_TITLE = 300;
  const MAX_BODY = 200000;
  const MAX_TEXT = 2000;
  const MAX_ID = 120;
  const MAX_TAGS = 32;
  const DEFAULT_LIMIT = 5000;

  // Tokens shorter than this are dropped from retrieval: "a", "of", "to" would match everything and make
  // the overlap number meaningless. 3 is the smallest cutoff that still keeps real terms like "cac" or "ltv".
  const MIN_TOKEN = 3;

  function tokensOf(text) {
    const raw = String(text == null ? '' : text).toLowerCase().split(/[^a-z0-9]+/);
    const out = [];
    const seen = {};
    for (const t of raw) {
      if (t.length < MIN_TOKEN) continue;
      if (seen[t]) continue;
      seen[t] = 1; out.push(t);
    }
    return out;
  }

  function makeBusinessKnowledge(opts) {
    opts = opts || {};
    const records = Array.isArray(opts.records) ? opts.records : [];
    const persist = typeof opts.persist === 'function' ? opts.persist : null;
    const now = typeof opts.now === 'function' ? opts.now : (() => null);
    const limit = (Number.isFinite(opts.limit) && opts.limit > 0) ? Math.floor(opts.limit) : DEFAULT_LIMIT;

    const str = (v, cap) => (v == null ? '' : String(v)).slice(0, cap);
    const indexOf = (id) => records.findIndex(r => r && r.id === id);
    const forBiz = (businessId) => records.filter(r => r && r.businessId === businessId);
    const biz = (v) => str(v, MAX_ID).trim();
    const strList = (v, cap, itemCap) => (Array.isArray(v) ? v : []).map(x => str(x, itemCap || 60)).filter(Boolean).slice(0, cap);

    function nextSeq(businessId) {
      let max = 0;
      for (const r of records) if (r && r.businessId === businessId && r.seq > max) max = r.seq;
      return max + 1;
    }

    const rowView = (r) => ({
      id: r.id, seq: r.seq, businessId: r.businessId,
      kind: r.kind, title: r.title, body: r.body || '',
      // where it lives outside the station: a URL for a website, a path for a PDF. Free-form, and separate
      // from `source` because "where I got it" and "where it is" are different questions.
      ref: r.ref || '',
      tags: (Array.isArray(r.tags) ? r.tags : []).slice(),
      source: r.source || '',
      at: r.at != null ? r.at : null,
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
    function entries(businessId, o) {
      const b = biz(businessId);
      if (!b) return [];
      o = o || {};
      let rows = forBiz(b);
      if (o.kind) rows = rows.filter(r => r.kind === String(o.kind));
      if (o.tag) rows = rows.filter(r => (Array.isArray(r.tags) ? r.tags : []).indexOf(String(o.tag)) >= 0);
      return rows.slice().sort((a, b2) => (a.seq || 0) - (b2.seq || 0)).map(rowView);
    }
    function entry(id) { const i = indexOf(id); return i < 0 ? null : rowView(records[i]); }
    function has(id) { return indexOf(id) >= 0; }
    function count(businessId) { const b = biz(businessId); return b ? forBiz(b).length : 0; }

    /* RETRIEVE — §15's "the AI retrieves relevant knowledge before making decisions".

       LITERAL TERM OVERLAP, and the result says so. `termOverlap` is the number of DISTINCT query tokens
       found in the entry's title, body or tags; `matched` lists them. An entry that matches nothing is not
       returned at all, so an empty result honestly means "nothing in the library mentions this".

       Title matches are reported separately (`inTitle`) rather than being weighted into the score — a weight
       would be a relevance claim this module cannot justify. Ties break on recency, then on id, so the order
       is deterministic and testable. */
    function retrieve(businessId, o) {
      o = o || {};
      const b = biz(businessId);
      const query = str(o.query, 500).trim();
      if (!b || !query) return { query: query, termOverlapNote: '', hits: [] };

      const qTokens = tokensOf(query);
      if (!qTokens.length) return { query: query, termOverlapNote: '', hits: [] };

      const kinds = Array.isArray(o.kinds) ? o.kinds : null;
      const hits = [];
      for (const r of forBiz(b)) {
        if (kinds && kinds.length && kinds.indexOf(r.kind) < 0) continue;
        const titleTokens = tokensOf(r.title);
        const bodyTokens = tokensOf(r.body);
        const tagTokens = (Array.isArray(r.tags) ? r.tags : []).map(t => String(t).toLowerCase());
        const hay = bodyTokens.concat(tagTokens);
        const matched = [];
        let inTitle = false;
        for (const t of qTokens) {
          if (titleTokens.indexOf(t) >= 0) { matched.push(t); inTitle = true; }
          else if (hay.indexOf(t) >= 0) matched.push(t);
        }
        if (!matched.length) continue;
        hits.push({
          id: r.id, kind: r.kind, title: r.title, source: r.source || '', ref: r.ref || '',
          at: r.at != null ? r.at : null,
          termOverlap: matched.length,
          queryTerms: qTokens.length,
          matched: matched,
          inTitle: inTitle
        });
      }
      hits.sort((a, b2) => (b2.termOverlap - a.termOverlap) || ((b2.at || 0) - (a.at || 0)) || String(a.id).localeCompare(String(b.id)));
      const n = (Number.isFinite(o.limit) && o.limit > 0) ? Math.floor(o.limit) : 0;
      return {
        query: query,
        // the honest label, carried with every response so a caller cannot present this as AI relevance.
        termOverlapNote: 'ranked by LITERAL term overlap between the query and the entry text — not a semantic or AI relevance score',
        queryTerms: qTokens,
        hits: n ? hits.slice(0, n) : hits
      };
    }

    function summary(businessId) {
      const rows = entries(businessId);
      const out = { total: rows.length, byKind: {}, tags: [] };
      for (const k of KINDS) out.byKind[k] = 0;
      const tagCount = {};
      for (const r of rows) {
        if (Object.prototype.hasOwnProperty.call(out.byKind, r.kind)) out.byKind[r.kind]++;
        for (const t of r.tags) tagCount[t] = (tagCount[t] || 0) + 1;
      }
      out.tags = Object.keys(tagCount).sort((a, b2) => (tagCount[b2] - tagCount[a]) || a.localeCompare(b2))
        .slice(0, 50).map(t => ({ tag: t, count: tagCount[t] }));
      return out;
    }

    // ---- writes ------------------------------------------------------------------------------------
    function add(businessId, meta) {
      meta = meta || {};
      const b = biz(businessId);
      if (!b) return { ok: false, reason: 'a businessId is required (isolation is by key — never implied)' };
      const kind = String(meta.kind == null ? '' : meta.kind);
      if (KINDS.indexOf(kind) < 0) {
        return { ok: false, reason: 'unknown knowledge kind: ' + (kind || '(none)') + ' — one of: ' + KINDS.join(', ') };
      }
      const title = str(meta.title, MAX_TITLE).trim();
      if (!title) return { ok: false, reason: 'a knowledge entry needs a title' };
      // P1: §15 wants this retrieved BEFORE a decision, so it must say where it came from.
      const source = str(meta.source, MAX_TEXT).trim();
      if (!source) return { ok: false, reason: 'a knowledge entry needs a source (P1) — where it came from' };

      const at = now();
      const seq = nextSeq(b);
      const row = {
        // '~' not '#' — a knowledge id travels in a URL path (see validation-store.js).
        id: b + '~g' + seq, seq: seq, businessId: b,
        kind: kind, title: title, body: str(meta.body, MAX_BODY),
        ref: str(meta.ref, MAX_TEXT),
        tags: strList(meta.tags, MAX_TAGS, 60),
        source: source,
        at: (meta.at != null && isFinite(Number(meta.at)) && Number(meta.at) > 0) ? Number(meta.at) : at,
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
      return { ok: true, entry: rowView(row) };
    }

    function update(id, patch) {
      patch = patch || {};
      const i = indexOf(id);
      if (i < 0) return { ok: false, reason: 'unknown knowledge entry: ' + id };
      const prev = records[i];
      const nextRow = rowView(prev);

      if (patch.kind != null) {
        const k = String(patch.kind);
        if (KINDS.indexOf(k) < 0) return { ok: false, reason: 'unknown knowledge kind: ' + k };
        nextRow.kind = k;
      }
      if (patch.title != null) {
        const t = str(patch.title, MAX_TITLE).trim();
        if (!t) return { ok: false, reason: 'title cannot be blank' };
        nextRow.title = t;
      }
      if (patch.body != null) nextRow.body = str(patch.body, MAX_BODY);
      if (patch.ref != null) nextRow.ref = str(patch.ref, MAX_TEXT);
      if (patch.tags != null) nextRow.tags = strList(patch.tags, MAX_TAGS, 60);
      if (patch.source != null) {
        const s = str(patch.source, MAX_TEXT).trim();
        if (!s) return { ok: false, reason: 'a knowledge entry needs a source (P1)' };
        nextRow.source = s;
      }

      nextRow.id = prev.id; nextRow.seq = prev.seq; nextRow.businessId = prev.businessId;
      nextRow.createdAt = prev.createdAt; nextRow.at = prev.at;
      nextRow.updatedAt = now();

      const next = records.slice(); next[i] = nextRow;
      const w = commit(next);
      if (!w.ok) return w;
      return { ok: true, entry: rowView(nextRow) };
    }

    function forget(id) {
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
      KINDS, MIN_TOKEN, LIMIT: limit,
      entries, entry, has, count, retrieve, summary,
      add, update, forget, clear
    };
  }

  return { makeBusinessKnowledge, KINDS, MIN_TOKEN, DEFAULT_LIMIT };
});
