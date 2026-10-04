/* sidecar/creator-studio.js — §20 CREATOR STUDIO (the station-level content surface).

   WHAT THIS IS. §17 gave the content pipeline (idea → research → script → assets → editing → review →
   publish → analytics) and business-content-store.js enforces it, but the ONLY door onto it is
   per-business (/api/businesses/:id/content, Phase 4 BUSINESS MANAGER ▸ CONTENT). There is no
   station-level read: "what is my whole content operation doing right now, across every channel and
   business" — which is exactly what a CREATOR STUDIO is. The audit (docs/PHASE0-AUDIT-v4.md §6) named
   this the second genuine gap.

   THIS MODULE OWNS NO STORE. It composes the facts that already exist:
     • business-content-store.js — every piece, its stage, channel, assets, history, publishedAt, publishedBy
     • businesses-store.js       — the business each piece belongs to (name, stage)
   and answers the three questions a per-business tab cannot:
     1. THE PIPELINE — every piece in the system, grouped by §17 stage, across all businesses.
     2. THE CALENDAR — pieces placed on the day they are DATED. The one honest date is what is recorded:
        `publishedAt` for a piece that went out, else `updatedAt`. There is NO invented "scheduled for"
        field — a calendar built on a fabricated date would be a lie about what is planned.
     3. THE PUBLISHED LIST — what a HUMAN actually sent, newest first, with who signed it. Keyed on the
        `publishedAt` FACT, not the stage name: the store draws that distinction itself, and the per-business
        MANAGER tab already shows `publishedBy` — the station read was the one dropping it.

   HONESTY RULES (P1/P2/P7), the same as mission-control.js:
     1. Counts are counts. There is no "content score", no readiness, no percentage.
     2. An unreadable source is reported as unavailable (`readable:false`), never as an empty pipeline.
     3. Every row is BOUNDED to the fields named here; the composer invents no metric.
     4. Publishing stays a human action — this read exposes `publishedAt` but writes nothing.

   PURE-ish: every source is injected. No IO of its own. The clock is injected (determinism lint: no
   Date.now in a sidecar module). UMD. */

'use strict';
(function (root, factory) {
  const C = (typeof module !== 'undefined' && module.exports)
    ? require('./business-content-store.js')
    : ((root.SK && root.SK.businessContentStore) || null);
  const api = factory(C);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).creatorStudio = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (C) {
  'use strict';

  const MAX_NAME = 120;
  const MAX_TITLE = 200;
  const MAX_ASSETS = 12;

  // §17's pipeline, in §17's order. Read from the store module so the two can never drift.
  const STAGES = (C && C.STAGES) || ['idea', 'research', 'script', 'assets', 'editing', 'review', 'publish', 'analytics'];
  const PUBLISH_STAGES = (C && C.PUBLISH_STAGES) || ['publish', 'analytics'];
  const CHANNELS = (C && C.CHANNELS) || ['youtube', 'tiktok', 'instagram', 'facebook', 'blog', 'newsletter', 'product-marketing', 'other'];

  const DAY_MS = 24 * 60 * 60 * 1000;

  function str(v, cap) {
    const s = (v == null ? '' : String(v));
    const c = cap || MAX_NAME;
    return s.length > c ? s.slice(0, c) + '…' : s;
  }

  // The one date a piece is placed on: when it went out (publishedAt), else when it last moved (updatedAt).
  // `dateSource` says WHICH — so a calendar cell never implies a plan that was never recorded.
  function pieceDate(p) {
    if (Number.isFinite(p && p.publishedAt)) return { at: p.publishedAt, dateSource: 'published' };
    if (Number.isFinite(p && p.updatedAt)) return { at: p.updatedAt, dateSource: 'updated' };
    if (Number.isFinite(p && p.createdAt)) return { at: p.createdAt, dateSource: 'created' };
    return { at: null, dateSource: 'none' };
  }

  function makeCreatorStudio(opts) {
    opts = opts || {};
    const content = opts.content || null;                        // business-content-store instance
    const businesses = typeof opts.businesses === 'function' ? opts.businesses : (function () { return []; });
    const now = typeof opts.now === 'function' ? opts.now : (() => null);

    // Read every piece across every business, joined to its business's name. Defensive: an unreadable
    // business list still lets the content store answer if it can, and vice versa.
    function allPieces() {
      let list = [];
      let businessesReadable = true;
      try { list = businesses() || []; }
      catch (e) { list = []; businessesReadable = false; }

      const nameById = {};
      for (const b of list) if (b && b.id) nameById[b.id] = str(b.name || '(unnamed)', MAX_NAME);

      let pieces = [];
      let contentReadable = true;
      if (content && typeof content.pieces === 'function') {
        for (const b of list) {
          if (!b || !b.id) continue;
          try {
            const rows = content.pieces(b.id) || [];
            for (const r of rows) pieces.push({ piece: r, businessId: b.id, businessName: nameById[b.id] || str(b.id) });
          } catch (e) { contentReadable = false; }
        }
      } else {
        contentReadable = false;
      }
      return { pieces, businessesReadable, contentReadable };
    }

    /* THE PIPELINE — every piece, grouped by §17 stage, plus per-channel counts. Not a score: counts only. */
    function pipeline() {
      const { pieces, businessesReadable, contentReadable } = allPieces();

      const byStage = {}; for (const s of STAGES) byStage[s] = [];
      const byChannel = {}; for (const c of CHANNELS) byChannel[c] = 0;
      let published = 0;

      for (const { piece, businessId, businessName } of pieces) {
        const stage = STAGES.indexOf(piece.stage) >= 0 ? piece.stage : 'idea';
        const { at, dateSource } = pieceDate(piece);
        const row = {
          id: str(piece.id),
          title: str(piece.title || '(untitled)', MAX_TITLE),
          businessId: str(businessId),
          businessName: str(businessName),
          channel: CHANNELS.indexOf(piece.channel) >= 0 ? piece.channel : 'other',
          stage: stage,
          publishedAt: Number.isFinite(piece.publishedAt) ? piece.publishedAt : null,
          // WHO signed it. The store sets this ONLY on a human publish, so it is the fact that makes
          // "was this actually sent, and by whom" answerable — the per-business MANAGER tab shows it, and
          // the station read dropped it, which is the gap this carries across.
          publishedBy: str(piece.publishedBy || '', MAX_NAME),
          updatedAt: Number.isFinite(piece.updatedAt) ? piece.updatedAt : null,
          datedAt: at,
          dateSource: dateSource,
          assets: (Array.isArray(piece.assets) ? piece.assets : []).slice(0, MAX_ASSETS).map(a => str(a, 200))
        };
        byStage[stage].push(row);
        byChannel[row.channel] = (byChannel[row.channel] || 0) + 1;
        if (Number.isFinite(piece.publishedAt)) published++;
      }

      const counts = { total: pieces.length, byStage: {}, byChannel: byChannel, published: published };
      for (const s of STAGES) counts.byStage[s] = byStage[s].length;

      return {
        ok: true,
        generatedAt: now(),
        stages: STAGES.slice(),
        channels: CHANNELS.slice(),
        counts: counts,
        byStage: byStage,
        readable: contentReadable && businessesReadable,
        note: contentReadable
          ? ''
          : 'the content store could not be read — this pipeline may be incomplete, not empty'
      };
    }

    /* THE CALENDAR — pieces placed on the day they are DATED, within [from, to]. The date is the recorded
       one (publishedAt else updatedAt else createdAt) and every row says WHICH, so a cell never implies a
       schedule that was never set. Days with no piece are simply absent (the UI fills the grid). */
    function calendar(o) {
      o = o || {};
      const from = Number.isFinite(o.from) ? o.from : null;
      const to = Number.isFinite(o.to) ? o.to : null;
      const { pieces, contentReadable } = allPieces();

      const buckets = {};   // dayKey (UTC yyyy-mm-dd) -> rows
      let undated = 0;
      for (const { piece, businessId, businessName } of pieces) {
        const { at, dateSource } = pieceDate(piece);
        if (!Number.isFinite(at)) { undated++; continue; }
        if (from != null && at < from) continue;
        if (to != null && at > to) continue;
        const dayKey = new Date(at).toISOString().slice(0, 10);
        (buckets[dayKey] = buckets[dayKey] || []).push({
          id: str(piece.id),
          title: str(piece.title || '(untitled)', MAX_TITLE),
          businessId: str(businessId),
          businessName: str(businessName),
          channel: CHANNELS.indexOf(piece.channel) >= 0 ? piece.channel : 'other',
          stage: STAGES.indexOf(piece.stage) >= 0 ? piece.stage : 'idea',
          datedAt: at,
          dateSource: dateSource,
          published: Number.isFinite(piece.publishedAt),
          // assets ride along HERE too, exactly as on the pipeline/published rows — a piece must not report
          // a different asset set depending on which read carried it (the frontend renders one piece one way).
          assets: (Array.isArray(piece.assets) ? piece.assets : []).slice(0, MAX_ASSETS).map(a => str(a, 200))
        });
      }

      // Stable, deterministic ordering: day ascending, then published-first, then title.
      const days = Object.keys(buckets).sort().map(k => ({
        day: k,
        rows: buckets[k].slice().sort((a, b) =>
          (b.published ? 1 : 0) - (a.published ? 1 : 0) ||
          (a.title < b.title ? -1 : (a.title > b.title ? 1 : 0)))
      }));

      return {
        ok: true,
        generatedAt: now(),
        from: from,
        to: to,
        days: days,
        undated: undated,
        readable: contentReadable,
        note: 'a piece appears on the day it was PUBLISHED, else the day it last MOVED — there is no separate '
          + '"scheduled" date, so the calendar never implies a plan that was not recorded'
      };
    }

    /* THE PUBLISHED LIST — what actually went OUT, newest first. Keyed on the `publishedAt` FACT the store
       sets only for a human publish, NOT on the §17 stage NAME: a piece that was sent and then moved on to
       'analytics' is still published, and a piece sitting in the 'publish' column that nobody has signed is
       NOT. The store's own header draws exactly this distinction ("set ONLY by a human publish, so 'was this
       actually sent' is a fact on the row rather than a guess from the stage name"), and this read carries it
       — which is why it exists alongside the pipeline rather than being a filter on it. */
    function published() {
      const { pieces, contentReadable } = allPieces();
      const rows = [];
      for (const { piece, businessId, businessName } of pieces) {
        if (!Number.isFinite(piece.publishedAt)) continue;
        rows.push({
          id: str(piece.id),
          title: str(piece.title || '(untitled)', MAX_TITLE),
          businessId: str(businessId),
          businessName: str(businessName),
          channel: CHANNELS.indexOf(piece.channel) >= 0 ? piece.channel : 'other',
          stage: STAGES.indexOf(piece.stage) >= 0 ? piece.stage : 'idea',
          publishedAt: piece.publishedAt,
          publishedBy: str(piece.publishedBy || '', MAX_NAME),
          assets: (Array.isArray(piece.assets) ? piece.assets : []).slice(0, MAX_ASSETS).map(a => str(a, 200))
        });
      }
      // Newest first; ties break on id so two reads never disagree (deterministic).
      rows.sort((a, b) => (b.publishedAt - a.publishedAt) || (a.id < b.id ? -1 : (a.id > b.id ? 1 : 0)));

      return {
        ok: true,
        generatedAt: now(),
        count: rows.length,
        rows: rows,
        readable: contentReadable,
        note: 'a piece appears here only if a HUMAN published it — being at the "publish" stage is not the same '
          + 'as having been sent, and this list shows the fact, not the stage'
      };
    }

    return { pipeline: pipeline, calendar: calendar, published: published, STAGES: STAGES, PUBLISH_STAGES: PUBLISH_STAGES, CHANNELS: CHANNELS, DAY_MS: DAY_MS };
  }

  return { makeCreatorStudio, pieceDate, STAGES, PUBLISH_STAGES, CHANNELS, DAY_MS };
});
