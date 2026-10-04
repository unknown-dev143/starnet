/* SPACESTATION — creatorstudio.js : the §20 CREATOR STUDIO console.

   The presentation half of §20. The sidecar composer (`creator-studio.js`) reads the existing content
   store across every business and returns the §17 pipeline and a dated calendar; this file renders them
   and holds no policy of its own. The stage order, the channel list and the counts all come off the wire,
   so the console cannot disagree with the composer.

   WHAT IT DELIBERATELY DOES NOT DO:

     • NO SCHEDULING. There is no recorded "scheduled for" date in the content store, so the CALENDAR
       places each piece on the day it is DATED — publishedAt for a published piece, else updatedAt — and
       says which. It never shows a future plan that was never recorded.

     • NO SCORE / NO READINESS. The pipeline shows pieces per stage. There is no percentage, no "content
       health", no priority number.

     • AN UNREADABLE STORE IS SHOWN AS UNAVAILABLE, never as an empty pipeline.

     • NOTHING IS MUTABLE FROM HERE. Advancing a piece (and the human-only publish gate) lives on the
       Business Manager's CONTENT tab; this window links to where the work happens, it does not do it.

   The pure half (every shaper below) is Node-loadable so the tests exercise it headless; only `mount`
   touches the DOM. */

'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).creatorStudioUI = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // §17's stage labels, in §17's order. A closed display map — an unknown stage falls back to its raw slug
  // uppercased rather than rendering "UNKNOWN" over a real value.
  const STAGE_LABEL = {
    idea: 'IDEA', research: 'RESEARCH', script: 'SCRIPT', assets: 'ASSETS', editing: 'EDITING',
    review: 'REVIEW', publish: 'PUBLISH', analytics: 'ANALYTICS'
  };
  const CHANNEL_LABEL = {
    youtube: 'YOUTUBE', tiktok: 'TIKTOK', instagram: 'INSTAGRAM', facebook: 'FACEBOOK',
    blog: 'BLOG', newsletter: 'NEWSLETTER', 'product-marketing': 'PRODUCT MKT', other: 'OTHER'
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function relTime(ms, nowMs) {
    if (!ms || ms < 0) return '';
    const now = (typeof nowMs === 'number') ? nowMs : Date.now();
    const d = now - ms;
    if (d < 0) return 'now';
    if (d < 60000) return 'now';
    const m = Math.floor(d / 60000);
    if (m < 60) return m + 'm';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h';
    return Math.floor(h / 24) + 'd';
  }

  function stageLabel(s) { const k = String(s || ''); return STAGE_LABEL[k] || k.toUpperCase() || 'UNKNOWN'; }
  function channelLabel(c) { const k = String(c || ''); return CHANNEL_LABEL[k] || k.toUpperCase() || 'OTHER'; }

  /* ASSET PREVIEW — §20's "assets · thumbnails". A content piece carries free-text asset REFERENCES (a
     filename, a path, or a URL); the store never says which are images. We render what we can PROVE is an
     image — a `data:image/…` URI, or an `http(s)://` URL whose path ends in a known image extension — as a
     real thumbnail, and everything else as a NAMED CHIP. We deliberately do NOT invent a local file URL for
     a bare path: a content asset is BUSINESS-scoped, not agent-scoped, so there is no honest fs jail to
     resolve it against, and a guessed `/api/file` src would paint a broken image over a real reference. */
  const IMG_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'];
  function isImageAsset(a) {
    const s = String(a == null ? '' : a).trim();
    if (!s) return false;
    if (/^data:image\//i.test(s)) return true;
    if (/^https?:\/\//i.test(s)) {
      const p = s.split(/[?#]/, 1)[0];
      return IMG_EXT.indexOf(p.split('.').pop().toLowerCase()) >= 0;
    }
    return false;
  }
  function assetPreview(a) {
    const s = String(a == null ? '' : a).trim();
    const label = s.split(/[\\/]/).pop() || s;
    if (isImageAsset(s)) return { kind: 'image', src: s, label: label };
    return { kind: 'ref', src: '', label: label || s };
  }

  /* ONE PIECE ROW, shaped. Shared by the pipeline columns and the calendar so a piece can never render two
     different ways. */
  function shapePiece(p, nowMs) {
    p = p || {};
    const stage = String(p.stage || 'idea');
    const channel = String(p.channel || 'other');
    const assets = (Array.isArray(p.assets) ? p.assets : []).map(a => String(a));
    return {
      id: String(p.id || ''),
      title: String(p.title || '(untitled)'),
      businessId: String(p.businessId || ''),
      businessName: String(p.businessName || p.businessId || ''),
      channel: channel,
      channelLabel: channelLabel(channel),
      stage: stage,
      stageLabel: stageLabel(stage),
      updatedRel: relTime(p.updatedAt, nowMs),
      published: Number.isFinite(p.publishedAt),
      publishedAt: Number.isFinite(p.publishedAt) ? p.publishedAt : null,
      // WHO signed it — set only by a human publish. The per-business MANAGER tab shows this; carrying it
      // here keeps the station read from being the one place it is missing.
      publishedBy: String(p.publishedBy || ''),
      publishedRel: Number.isFinite(p.publishedAt) ? relTime(p.publishedAt, nowMs) : '',
      // which recorded date a calendar cell is using — 'published' | 'updated' | 'created' | 'none'
      dateSource: String(p.dateSource || 'none'),
      datedAt: Number.isFinite(p.datedAt) ? p.datedAt : null,
      assets: assets,
      assetCount: assets.length,
      // the same assets, classified for rendering (image thumbnail vs named chip) — one source, so the
      // pipeline, the calendar and the published list show a piece's assets identically.
      assetPreviews: assets.map(assetPreview)
    };
  }

  /* THE PIPELINE, shaped: ordered stages, each with its rows, plus the counts + a header line. */
  function shapePipeline(raw, nowMs) {
    raw = raw || {};
    const stages = (Array.isArray(raw.stages) ? raw.stages : Object.keys(raw.byStage || {}));
    const byStage = raw.byStage || {};
    const columns = stages.map(s => ({
      stage: s,
      label: stageLabel(s),
      rows: (Array.isArray(byStage[s]) ? byStage[s] : []).map(p => shapePiece(p, nowMs))
    }));
    const counts = raw.counts || {};
    return {
      ok: raw.ok === true,
      readable: raw.readable !== false,
      generatedAt: Number.isFinite(raw.generatedAt) ? raw.generatedAt : null,
      columns: columns,
      counts: {
        total: Number.isFinite(counts.total) ? counts.total : 0,
        published: Number.isFinite(counts.published) ? counts.published : 0,
        byStage: counts.byStage || {},
        byChannel: counts.byChannel || {}
      },
      note: raw.note || ''
    };
  }

  /* THE CALENDAR, shaped: ordered days, each with its rows. */
  function shapeCalendar(raw, nowMs) {
    raw = raw || {};
    return {
      ok: raw.ok === true,
      readable: raw.readable !== false,
      from: Number.isFinite(raw.from) ? raw.from : null,
      to: Number.isFinite(raw.to) ? raw.to : null,
      days: (Array.isArray(raw.days) ? raw.days : []).map(d => ({
        day: String(d.day || ''),
        rows: (Array.isArray(d.rows) ? d.rows : []).map(p => shapePiece(p, nowMs))
      })),
      undated: Number.isFinite(raw.undated) ? raw.undated : 0,
      note: raw.note || ''
    };
  }

  /* THE PUBLISHED LIST, shaped: what a human actually sent, newest first, with who + when. Keyed on the
     `publishedAt` FACT, not the §17 stage — the store draws that distinction itself. */
  function shapePublished(raw, nowMs) {
    raw = raw || {};
    return {
      ok: raw.ok === true,
      readable: raw.readable !== false,
      count: Number.isFinite(raw.count) ? raw.count : (Array.isArray(raw.rows) ? raw.rows.length : 0),
      rows: (Array.isArray(raw.rows) ? raw.rows : []).map(p => shapePiece(p, nowMs)),
      note: raw.note || ''
    };
  }

  /* THE HEADER LINE — a plain quote of the counts, no verdict. */
  function shapeHeader(counts) {
    counts = counts || {};
    const total = Number.isFinite(counts.total) ? counts.total : 0;
    const published = Number.isFinite(counts.published) ? counts.published : 0;
    const parts = [total + (total === 1 ? ' piece' : ' pieces')];
    if (published) parts.push(published + ' published');
    const byStage = counts.byStage || {};
    const inReview = Number.isFinite(byStage.review) ? byStage.review : 0;
    if (inReview) parts.push(inReview + ' awaiting review');
    return { text: parts.join(' · '), total: total, published: published, inReview: inReview };
  }

  /* ★ THE CREATIONS INDEX (§37), shaped. The sidecar composer (`creations-index.js`) already normalised every
     made thing to {type,id,title,status,businessId,businessName,updatedAt}; this just labels the type and
     renders the relative time. It invents NOTHING: no score, no rank — the order is the composer's
     newest-first, and each row says which store it came from and where it stands. An unreadable source is
     carried through so the viewer can warn rather than show a shorter list that reads as "you made less". */
  const TYPE_LABEL = {
    content: 'CONTENT', document: 'DOCUMENT', workorder: 'WORK ORDER', deliverable: 'DELIVERABLE',
    business: 'BUSINESS', project: 'PROJECT', experiment: 'EXPERIMENT', automation: 'AUTOMATION',
    agent: 'AI AGENT'
  };
  function typeLabel(t) { const k = String(t || ''); return TYPE_LABEL[k] || k.toUpperCase() || 'CREATION'; }

  function shapeCreations(raw, nowMs) {
    raw = raw || {};
    const counts = raw.counts || {};
    const byType = counts.byType || {};
    return {
      ok: raw.ok === true,
      types: (Array.isArray(raw.types) ? raw.types : Object.keys(byType)).map(t => String(t)),
      rows: (Array.isArray(raw.rows) ? raw.rows : []).map(r => {
        r = r || {};
        const type = String(r.type || '');
        return {
          type: type,
          typeLabel: typeLabel(type),
          id: String(r.id || ''),
          title: String(r.title || '(untitled)'),
          status: String(r.status || ''),
          businessId: String(r.businessId || ''),
          businessName: String(r.businessName || r.businessId || 'Station'),
          updatedAt: Number.isFinite(r.updatedAt) ? r.updatedAt : null,
          updatedRel: relTime(r.updatedAt, nowMs)
        };
      }),
      counts: {
        total: Number.isFinite(counts.total) ? counts.total : (Array.isArray(raw.rows) ? raw.rows.length : 0),
        byType: byType
      },
      // per-source readability: a false here is "could not read", never "you have none"
      readable: raw.readable || {},
      truncated: raw.truncated === true,
      note: raw.note || ''
    };
  }

  /* THE CREATIONS HEADER — a plain count, no verdict. */
  function shapeCreationsHeader(counts) {
    counts = counts || {};
    const total = Number.isFinite(counts.total) ? counts.total : 0;
    return { text: total + (total === 1 ? ' creation' : ' creations'), total: total };
  }

  // ---------------------------------------------------------------------------------------------
  // DOM HALF
  // ---------------------------------------------------------------------------------------------

  function apiFetch(path, init) {
    const H = (typeof StationUI !== 'undefined' && StationUI.h) || {};
    if (typeof H.api === 'function') return H.api(path, init);
    return fetch(path, init).then(r => r.json().catch(() => ({ ok: false, reason: 'the response was not JSON' })));
  }

  function mount(body) {
    const host = typeof body === 'string' ? document.getElementById(body) : body;
    if (!host) return null;
    const now = () => Date.now();

    host.innerHTML = '' +
      '<div class="cs-wrap">' +
        '<div class="cs-head">' +
          '<h3 class="cs-title">CREATOR STUDIO</h3>' +
          '<span class="cs-banner" data-hint="creatorstudio">every content piece across every business — the §17 pipeline from idea to published</span>' +
          '<span class="cs-spacer"></span>' +
          '<span class="cs-sum" id="cs-sum"></span>' +
          '<button class="cs-btn" id="cs-refresh" data-hint="creatorstudio">REFRESH</button>' +
        '</div>' +
        '<div class="cs-tabs">' +
          '<button class="cs-tab cs-on" data-tab="pipeline" data-hint="creatorstudio">PIPELINE</button>' +
          '<button class="cs-tab" data-tab="calendar" data-hint="creatorstudio">CALENDAR</button>' +
          // §17's terminal outcome, made first-class: what a HUMAN actually sent, with who signed it. A
          // separate read from the pipeline because "at the publish stage" and "was actually sent" differ.
          '<button class="cs-tab" data-tab="published" data-hint="creatorstudio">PUBLISHED</button>' +
          // §37: every made thing, not just content — the unified index (content · documents · work orders ·
          // deliverables) in one place. This is the surface the /api/creations route never had.
          '<button class="cs-tab" data-tab="creations" data-hint="creatorstudio">CREATIONS</button>' +
        '</div>' +
        '<div class="cs-panels">' +
          '<div class="cs-panel cs-on" id="cs-panel-pipeline"></div>' +
          '<div class="cs-panel" id="cs-panel-calendar"></div>' +
          '<div class="cs-panel" id="cs-panel-published"></div>' +
          '<div class="cs-panel" id="cs-panel-creations"></div>' +
        '</div>' +
      '</div>';

    const state = { tab: 'pipeline', pipeline: null, calendar: null, published: null, creations: null };

    /* A tile deep-links with a section (openTerm sets consoleSection['creatorstudio']); honour it when it
       names a real tab so a "MY CREATIONS" tile lands on CREATIONS. Falls back to the pipeline. */
    const CTABS = ['pipeline', 'calendar', 'published', 'creations'];
    const H0 = (typeof StationUI !== 'undefined' && StationUI.h) || null;
    const wantTab = (H0 && H0.consoleSection && H0.consoleSection['creatorstudio']) || '';
    const startTab = CTABS.indexOf(wantTab) >= 0 ? wantTab : 'pipeline';

    function panel(id) { return host.querySelector('#cs-panel-' + id); }
    function say(id, html) { const p = panel(id); if (p) p.innerHTML = html; }
    function busy(id, t) { say(id, '<p class="cs-loading">' + esc(t || 'reading…') + '</p>'); }
    function err(id, reason) { say(id, '<p class="cs-err">' + esc(reason || 'could not read that') + '</p>'); }

    function showTab(tab) {
      state.tab = tab;
      for (const t of host.querySelectorAll('.cs-tab')) t.classList.toggle('cs-on', t.getAttribute('data-tab') === tab);
      for (const p of host.querySelectorAll('.cs-panel')) p.classList.toggle('cs-on', p.id === 'cs-panel-' + tab);
      render(tab);
      renderHeader();
    }

    /* THE ASSET STRIP — a piece's assets, made visible (the board used to say only "· N assets"). An image
       reference renders as a real thumbnail; anything else as a named chip; a piece with more than the cap
       gets a "+N" tail. Same strip in the pipeline chip and on the calendar row, from one classified list. */
    function thumbStrip(p) {
      const list = (p.assetPreviews || []).slice(0, 6);
      if (!list.length) return '';
      return '<span class="cs-thumbs">' + list.map(a =>
        a.kind === 'image'
          ? '<img class="cs-thumb" src="' + esc(a.src) + '" alt="' + esc(a.label) + '" loading="lazy" title="' + esc(a.label) + '">'
          : '<span class="cs-thumb cs-thumb-ref" title="' + esc(a.label) + '">' + esc(a.label) + '</span>'
      ).join('') +
        (p.assetCount > list.length ? '<span class="cs-thumb-more">+' + (p.assetCount - list.length) + '</span>' : '') +
        '</span>';
    }

    function pieceChip(p) {
      return '<div class="cs-piece">' +
          '<span class="cs-piece-t">' + esc(p.title) + '</span>' +
          '<span class="cs-piece-m">' + esc(p.businessName) + ' · ' + esc(p.channelLabel) +
            (p.assetCount ? ' · ' + p.assetCount + ' asset' + (p.assetCount === 1 ? '' : 's') : '') + '</span>' +
          thumbStrip(p) +
        '</div>';
    }

    function renderPipeline() {
      const pl = state.pipeline;
      if (!pl) return busy('pipeline');
      const warn = pl.readable ? '' : '<div class="cs-warn">the content store could not be read — this pipeline may be incomplete, not empty</div>';
      const cols = pl.columns.map(c =>
        '<div class="cs-col">' +
          '<div class="cs-col-h"><span class="cs-col-t">' + esc(c.label) + '</span>' +
            '<span class="cs-col-n">' + c.rows.length + '</span></div>' +
          (c.rows.length ? c.rows.map(pieceChip).join('') : '<p class="cs-none">—</p>') +
        '</div>').join('');
      say('pipeline', warn + '<div class="cs-board">' + cols + '</div>' +
        (pl.note ? '<p class="cs-note">' + esc(pl.note) + '</p>' : ''));
    }

    function renderCalendar() {
      const cal = state.calendar;
      if (!cal) return busy('calendar');
      const warn = cal.readable ? '' : '<div class="cs-warn">the content store could not be read</div>';
      const days = cal.days.length ? cal.days.map(d => {
        const rows = d.rows.map(p =>
          '<div class="cs-piece cs-piece-dated">' +
            '<span class="cs-piece-t">' + esc(p.title) + '</span>' +
            '<span class="cs-piece-m">' + esc(p.businessName) + ' · ' + esc(p.channelLabel) + ' · ' + esc(p.stageLabel) +
              '<span class="cs-src">' + (p.dateSource === 'published' ? 'published' : p.dateSource === 'created' ? 'created' : 'last moved') + '</span>' +
            '</span>' +
            thumbStrip(p) +
          '</div>').join('');
        return '<div class="cs-day"><div class="cs-day-h">' + esc(d.day) + '</div>' + rows + '</div>';
      }).join('') : '<p class="cs-none">nothing dated in this window</p>';
      say('calendar', warn + days +
        (cal.undated ? '<p class="cs-note">' + cal.undated + ' piece' + (cal.undated === 1 ? '' : 's') + ' carry no recorded date</p>' : '') +
        (cal.note ? '<p class="cs-note">' + esc(cal.note) + '</p>' : ''));
    }

    /* THE PUBLISHED TAB — what a HUMAN actually sent, newest first. A row names the piece, the business and
       channel it went out under, when it went out, and WHO signed it. It is keyed on the `publishedAt` fact,
       not the §17 stage: a piece can sit in the "publish" column unsigned, and a sent piece can move on to
       "analytics" — this list shows what was actually sent, and nothing here can publish (that stays a human
       action on the advance route). */
    function renderPublished() {
      const pub = state.published;
      if (!pub) return busy('published');
      const warn = pub.readable ? '' : '<div class="cs-warn">the content store could not be read — this list may be incomplete, not empty</div>';
      const rows = pub.rows.length ? pub.rows.map(p =>
        '<tr class="cs-prow">' +
          '<td class="cs-prow-title"><b>' + esc(p.title) + '</b></td>' +
          '<td class="cs-prow-biz">' + esc(p.businessName) + '</td>' +
          '<td class="cs-prow-ch">' + esc(p.channelLabel) + '</td>' +
          '<td class="cs-prow-when">' + (p.publishedRel ? esc(p.publishedRel) : '<span class="cs-none">—</span>') + '</td>' +
          '<td class="cs-prow-by">' + esc(p.publishedBy || 'you') + '</td>' +
        '</tr>').join('') : '<tr><td colspan="5" class="cs-none">nothing published yet — publishing is a human action, so a piece stays here empty until you send one</td></tr>';
      say('published', warn +
        '<table class="cs-ptable"><thead><tr><th>title</th><th>business</th><th>channel</th><th>sent</th><th>signed by</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>' +
        (pub.note ? '<p class="cs-note">' + esc(pub.note) + '</p>' : ''));
    }

    function render(tab) {
      if (tab === 'pipeline') renderPipeline();
      else if (tab === 'calendar') renderCalendar();
      else if (tab === 'published') renderPublished();
      else if (tab === 'creations') renderCreations();
    }

    /* THE CREATIONS TAB — every made thing, newest first. A row names its TYPE, TITLE, the business it
       belongs to, where it stands, and when it last moved. No score, no rank; the order is the composer's
       newest-first. A source that could not be read is warned about, so a short list is never mistaken for
       "you made nothing". */
    function renderCreations() {
      const cr = state.creations;
      if (!cr) return busy('creations');
      const unreadable = Object.keys(cr.readable).filter(k => cr.readable[k] === false);
      const warn = unreadable.length
        ? '<div class="cs-warn">could not read: ' + esc(unreadable.join(', ')) + ' — this list may be incomplete, not empty</div>'
        : '';
      const rows = cr.rows.length ? cr.rows.map(r =>
        '<tr class="cs-crow">' +
          '<td class="cs-crow-type"><span class="cs-type">' + esc(r.typeLabel) + '</span></td>' +
          '<td class="cs-crow-title"><b>' + esc(r.title) + '</b></td>' +
          '<td class="cs-crow-status">' + (r.status ? esc(r.status) : '<span class="cs-none">—</span>') + '</td>' +
          '<td class="cs-crow-biz">' + esc(r.businessName) + '</td>' +
          '<td class="cs-crow-moved">' + (r.updatedRel ? esc(r.updatedRel) : '<span class="cs-none">—</span>') + '</td>' +
        '</tr>').join('') : '<tr><td colspan="5" class="cs-none">nothing made yet</td></tr>';
      say('creations', warn +
        '<table class="cs-ctable"><thead><tr><th>type</th><th>title</th><th>status</th><th>business</th><th>last moved</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>' +
        (cr.truncated ? '<p class="cs-note">showing the most recent ' + cr.rows.length + ' of ' + cr.counts.total + '</p>' : '') +
        (cr.note ? '<p class="cs-note">' + esc(cr.note) + '</p>' : ''));
    }

    function renderHeader() {
      const el = host.querySelector('#cs-sum');
      if (!el) return;
      if (state.tab === 'creations' && state.creations) el.textContent = shapeCreationsHeader(state.creations.counts).text;
      else if (state.tab === 'published' && state.published) {
        const n = state.published.count;
        el.textContent = n + ' published';
      }
      else if (state.pipeline) el.textContent = shapeHeader(state.pipeline.counts).text;
    }

    function loadAll() {
      busy('pipeline', 'reading the pipeline…'); busy('calendar', 'reading…'); busy('published', 'reading…'); busy('creations', 'reading…');
      // Each read is guarded: a rejected fetch (the sidecar is down, the network dropped) must leave a NAMED
      // error in the panel, never an unhandled rejection and a panel stuck on "reading…" forever.
      const fail = (id) => (e) => { err(id, (e && e.message) ? ('could not read that — ' + e.message) : 'could not read that — the sidecar could not be reached'); };
      apiFetch('/api/creator/pipeline')
        .then(d => { state.pipeline = shapePipeline(d, now()); render('pipeline'); renderHeader(); })
        .catch(fail('pipeline'));
      apiFetch('/api/creator/calendar')
        .then(d => { state.calendar = shapeCalendar(d, now()); render('calendar'); })
        .catch(fail('calendar'));
      apiFetch('/api/creator/published')
        .then(d => { state.published = shapePublished(d, now()); render('published'); renderHeader(); })
        .catch(fail('published'));
      apiFetch('/api/creations')
        .then(d => { state.creations = shapeCreations(d, now()); render('creations'); renderHeader(); })
        .catch(fail('creations'));
    }

    host.querySelector('#cs-refresh').addEventListener('click', loadAll);
    for (const t of host.querySelectorAll('.cs-tab')) t.addEventListener('click', () => showTab(t.getAttribute('data-tab')));

    // honour a tile's section hint: land on the promised tab, not the default (no-op for 'pipeline').
    if (startTab !== 'pipeline') showTab(startTab);

    loadAll();
    return { state: state, reload: loadAll };
  }

  return {
    esc, relTime, stageLabel, channelLabel,
    isImageAsset, assetPreview,
    shapePiece, shapePipeline, shapeCalendar, shapePublished, shapeHeader,
    shapeCreations, shapeCreationsHeader, typeLabel,
    STAGE_LABEL, CHANNEL_LABEL, TYPE_LABEL,
    mount
  };
});
