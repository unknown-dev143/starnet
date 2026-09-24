/* sidecar/business-content-store.js — §17 CONTENT FACTORY (Business OS Phase 4).

   §17 gives the pipeline — "Idea → Research → Script → Assets → Editing → Review → Publish → Analytics" —
   and then one hard rule: "Do not auto-publish unless the user has explicitly enabled that permission (§13)."

   THAT RULE IS ENFORCED HERE, STRUCTURALLY, NOT IN THE UI. Publishing is the one transition in this whole
   application that is irreversible in the world: once a piece is live on a channel, the business's name is
   on it. So the store REFUSES any transition into a public stage ('publish' or 'analytics') whose actor is
   not a human. An agent — however it is configured, whatever grants it holds — cannot move a piece across
   that line through this store. §13 classifies publishing as a review-tier action; this is where the tier
   becomes a wall rather than a label.

   WHY 'analytics' IS ALSO GUARDED. It sits after 'publish' in §17's pipeline, so reaching it means the piece
   went out. Guarding only the literal word 'publish' would leave an obvious side door: advance straight to
   'analytics' and skip the gate. Both stages are in PUBLISH_STAGES and both need a human actor.

   THE PIPELINE ORDER IS ADVISORY, NOT ENFORCED, and that is deliberate. Real content work loops — a script
   goes back to research, an edit fails review. The store allows any transition between stages and records
   every one in an append-only `history`, so what happened is auditable (§18) even when the path was not
   straight. What it does NOT allow is reaching the public end of the pipeline without a human.

   ISOLATION (P6). Every piece belongs to one business; an empty businessId is refused on every read and
   write. `projectId` is an optional reference the route validates against the project store — the same
   split as a task's projectId.

   PURE: no IO, no clock, no env, no rng. `persist` and `now` injected. UMD. Mirrors business-tasks-store.js. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).businessContentStore = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // §17's pipeline, in §17's order.
  const STAGES = ['idea', 'research', 'script', 'assets', 'editing', 'review', 'publish', 'analytics'];

  // The stages that mean the piece is OUT IN THE WORLD. Reaching either needs a human actor. See header.
  const PUBLISH_STAGES = ['publish', 'analytics'];

  // §17's channels, plus an escape hatch. Closed so "what did we publish, and where" stays countable.
  const CHANNELS = ['youtube', 'tiktok', 'instagram', 'facebook', 'blog', 'newsletter', 'product-marketing', 'other'];

  const MAX_TITLE = 200;
  const MAX_TEXT = 4000;
  const MAX_ID = 120;
  const MAX_HISTORY = 200;
  const DEFAULT_LIMIT = 2000;

  function makeBusinessContentStore(opts) {
    opts = opts || {};
    const records = Array.isArray(opts.records) ? opts.records : [];
    const persist = typeof opts.persist === 'function' ? opts.persist : null;
    const now = typeof opts.now === 'function' ? opts.now : (() => null);
    const limit = (Number.isFinite(opts.limit) && opts.limit > 0) ? Math.floor(opts.limit) : DEFAULT_LIMIT;

    const str = (v, cap) => (v == null ? '' : String(v)).slice(0, cap);
    const indexOf = (id) => records.findIndex(r => r && r.id === id);
    const forBiz = (businessId) => records.filter(r => r && r.businessId === businessId);
    const biz = (v) => str(v, MAX_ID).trim();
    const strList = (v, cap, itemCap) => (Array.isArray(v) ? v : []).map(x => str(x, itemCap || MAX_TEXT)).filter(Boolean).slice(0, cap);

    function nextSeq(businessId) {
      let max = 0;
      for (const r of records) if (r && r.businessId === businessId && r.seq > max) max = r.seq;
      return max + 1;
    }

    const rowView = (r) => ({
      id: r.id, seq: r.seq, businessId: r.businessId,
      projectId: r.projectId || '',
      title: r.title, channel: r.channel, stage: r.stage,
      brief: r.brief || '',
      assets: (Array.isArray(r.assets) ? r.assets : []).slice(),
      history: (Array.isArray(r.history) ? r.history : []).map(h => ({
        at: h.at != null ? h.at : null, from: h.from || '', to: h.to || '',
        by: h.by || 'user', actorName: h.actorName || ''
      })),
      // set ONLY by a human publish, so "was this actually sent" is a fact on the row rather than a guess
      // from the stage name.
      publishedAt: r.publishedAt != null ? r.publishedAt : null,
      publishedBy: r.publishedBy || '',
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
    function pieces(businessId, o) {
      const b = biz(businessId);
      if (!b) return [];
      o = o || {};
      let rows = forBiz(b);
      if (o.stage) rows = rows.filter(r => r.stage === String(o.stage));
      if (o.channel) rows = rows.filter(r => r.channel === String(o.channel));
      if (o.projectId) rows = rows.filter(r => r.projectId === String(o.projectId));
      return rows.slice().sort((a, b2) => (a.seq || 0) - (b2.seq || 0)).map(rowView);
    }
    function piece(id) { const i = indexOf(id); return i < 0 ? null : rowView(records[i]); }
    function has(id) { return indexOf(id) >= 0; }
    function count(businessId) { const b = biz(businessId); return b ? forBiz(b).length : 0; }

    // The pipeline board: counts per stage and per channel. Counts only — no "readiness" score (P7).
    function summary(businessId) {
      const rows = pieces(businessId);
      const out = { total: rows.length, byStage: {}, byChannel: {}, published: 0 };
      for (const s of STAGES) out.byStage[s] = 0;
      for (const c of CHANNELS) out.byChannel[c] = 0;
      for (const r of rows) {
        if (Object.prototype.hasOwnProperty.call(out.byStage, r.stage)) out.byStage[r.stage]++;
        if (Object.prototype.hasOwnProperty.call(out.byChannel, r.channel)) out.byChannel[r.channel]++;
        if (r.publishedAt) out.published++;
      }
      return out;
    }

    // ---- writes ------------------------------------------------------------------------------------
    function addPiece(businessId, meta) {
      meta = meta || {};
      const b = biz(businessId);
      if (!b) return { ok: false, reason: 'a businessId is required (isolation is by key — never implied)' };
      const title = str(meta.title, MAX_TITLE).trim();
      if (!title) return { ok: false, reason: 'a content piece needs a title' };
      const channel = String(meta.channel == null ? '' : meta.channel);
      if (CHANNELS.indexOf(channel) < 0) {
        return { ok: false, reason: 'unknown channel: ' + (channel || '(none)') + ' — one of: ' + CHANNELS.join(', ') };
      }
      const stage = meta.stage != null ? String(meta.stage) : 'idea';
      if (STAGES.indexOf(stage) < 0) return { ok: false, reason: 'unknown stage: ' + stage };
      // A piece cannot be BORN public. Publishing is a transition a human makes, never a starting condition.
      if (PUBLISH_STAGES.indexOf(stage) >= 0) {
        return { ok: false, reason: 'a piece cannot be created already at "' + stage + '" — publishing is a transition a human makes (§17), not a starting state' };
      }

      const at = now();
      const seq = nextSeq(b);
      const row = {
        // '~' not '#' — a piece id travels in a URL path (see validation-store.js).
        id: b + '~n' + seq, seq: seq, businessId: b,
        projectId: str(meta.projectId, MAX_ID),
        title: title, channel: channel, stage: stage,
        brief: str(meta.brief, MAX_TEXT),
        assets: strList(meta.assets, 64),
        history: [{ at: at, from: '', to: stage, by: 'user', actorName: '' }],
        publishedAt: null, publishedBy: '',
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
      return { ok: true, piece: rowView(row) };
    }

    /* ADVANCE the pipeline. The guard is here, in the store, so no route or UI can route around it: a
       transition into a PUBLISH stage is refused unless the actor is a human. `actor` is
       { kind: 'user'|'agent'|'system', id, name }. */
    function advance(id, toStage, actor) {
      const i = indexOf(id);
      if (i < 0) return { ok: false, reason: 'unknown content piece: ' + id };
      const prev = records[i];
      const to = String(toStage == null ? '' : toStage);
      if (STAGES.indexOf(to) < 0) return { ok: false, reason: 'unknown stage: ' + (to || '(none)') + ' — one of: ' + STAGES.join(', ') };

      const a = actor || {};
      const kind = (a.kind === 'user' || a.kind === 'agent' || a.kind === 'system') ? a.kind : 'system';

      if (PUBLISH_STAGES.indexOf(to) >= 0 && kind !== 'user') {
        return {
          ok: false,
          reason: 'publishing is not automatic (§17): a piece cannot be moved to "' + to + '" by an actor of ' +
            'kind "' + kind + '" — only the Commander can. §13 classifies publishing as a review-tier action.'
        };
      }

      const at = now();
      const history = (Array.isArray(prev.history) ? prev.history : []).slice();
      history.push({ at: at, from: prev.stage, to: to, by: kind, actorName: str(a.name, 120) });
      const kept = history.length > MAX_HISTORY ? history.slice(history.length - MAX_HISTORY) : history;

      const nextRow = Object.assign({}, prev, { stage: to, history: kept, updatedAt: at });
      if (PUBLISH_STAGES.indexOf(to) >= 0 && !prev.publishedAt) {
        nextRow.publishedAt = at;
        nextRow.publishedBy = str(a.name, 120) || 'user';
      }

      const next = records.slice(); next[i] = nextRow;
      const w = commit(next);
      if (!w.ok) return w;
      return { ok: true, piece: rowView(nextRow) };
    }

    function update(id, patch) {
      patch = patch || {};
      const i = indexOf(id);
      if (i < 0) return { ok: false, reason: 'unknown content piece: ' + id };
      const prev = records[i];
      const nextRow = rowView(prev);

      if (patch.title != null) {
        const t = str(patch.title, MAX_TITLE).trim();
        if (!t) return { ok: false, reason: 'title cannot be blank' };
        nextRow.title = t;
      }
      if (patch.brief != null) nextRow.brief = str(patch.brief, MAX_TEXT);
      if (patch.projectId != null) nextRow.projectId = str(patch.projectId, MAX_ID);
      if (patch.assets != null) nextRow.assets = strList(patch.assets, 64);
      if (patch.channel != null) {
        const c = String(patch.channel);
        if (CHANNELS.indexOf(c) < 0) return { ok: false, reason: 'unknown channel: ' + c };
        nextRow.channel = c;
      }
      // NOTE: `stage` is deliberately NOT patchable here. The only way to move a piece is advance(), which
      // carries the publish guard — a generic update() that could set stage would be a way around it.

      nextRow.id = prev.id; nextRow.seq = prev.seq; nextRow.businessId = prev.businessId;
      nextRow.createdAt = prev.createdAt; nextRow.history = prev.history;
      nextRow.publishedAt = prev.publishedAt; nextRow.publishedBy = prev.publishedBy;
      nextRow.updatedAt = now();

      const next = records.slice(); next[i] = nextRow;
      const w = commit(next);
      if (!w.ok) return w;
      return { ok: true, piece: rowView(nextRow) };
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
      STAGES, PUBLISH_STAGES, CHANNELS, LIMIT: limit,
      pieces, piece, has, count, summary,
      addPiece, advance, update, remove, clear
    };
  }

  return { makeBusinessContentStore, STAGES, PUBLISH_STAGES, CHANNELS, DEFAULT_LIMIT };
});
