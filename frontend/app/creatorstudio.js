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

  /* ONE PIECE ROW, shaped. Shared by the pipeline columns and the calendar so a piece can never render two
     different ways. */
  function shapePiece(p, nowMs) {
    p = p || {};
    const stage = String(p.stage || 'idea');
    const channel = String(p.channel || 'other');
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
      // which recorded date a calendar cell is using — 'published' | 'updated' | 'created' | 'none'
      dateSource: String(p.dateSource || 'none'),
      datedAt: Number.isFinite(p.datedAt) ? p.datedAt : null,
      assets: (Array.isArray(p.assets) ? p.assets : []).map(a => String(a)),
      assetCount: (Array.isArray(p.assets) ? p.assets : []).length
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
        '</div>' +
        '<div class="cs-panels">' +
          '<div class="cs-panel cs-on" id="cs-panel-pipeline"></div>' +
          '<div class="cs-panel" id="cs-panel-calendar"></div>' +
        '</div>' +
      '</div>';

    const state = { tab: 'pipeline', pipeline: null, calendar: null };

    function panel(id) { return host.querySelector('#cs-panel-' + id); }
    function say(id, html) { const p = panel(id); if (p) p.innerHTML = html; }
    function busy(id, t) { say(id, '<p class="cs-loading">' + esc(t || 'reading…') + '</p>'); }
    function err(id, reason) { say(id, '<p class="cs-err">' + esc(reason || 'could not read that') + '</p>'); }

    function showTab(tab) {
      state.tab = tab;
      for (const t of host.querySelectorAll('.cs-tab')) t.classList.toggle('cs-on', t.getAttribute('data-tab') === tab);
      for (const p of host.querySelectorAll('.cs-panel')) p.classList.toggle('cs-on', p.id === 'cs-panel-' + tab);
      render(tab);
    }

    function pieceChip(p) {
      return '<div class="cs-piece">' +
          '<span class="cs-piece-t">' + esc(p.title) + '</span>' +
          '<span class="cs-piece-m">' + esc(p.businessName) + ' · ' + esc(p.channelLabel) +
            (p.assetCount ? ' · ' + p.assetCount + ' asset' + (p.assetCount === 1 ? '' : 's') : '') + '</span>' +
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
          '</div>').join('');
        return '<div class="cs-day"><div class="cs-day-h">' + esc(d.day) + '</div>' + rows + '</div>';
      }).join('') : '<p class="cs-none">nothing dated in this window</p>';
      say('calendar', warn + days +
        (cal.undated ? '<p class="cs-note">' + cal.undated + ' piece' + (cal.undated === 1 ? '' : 's') + ' carry no recorded date</p>' : '') +
        (cal.note ? '<p class="cs-note">' + esc(cal.note) + '</p>' : ''));
    }

    function render(tab) {
      if (tab === 'pipeline') renderPipeline();
      else if (tab === 'calendar') renderCalendar();
    }

    function renderHeader() {
      const el = host.querySelector('#cs-sum');
      if (el && state.pipeline) el.textContent = shapeHeader(state.pipeline.counts).text;
    }

    function loadAll() {
      busy('pipeline', 'reading the pipeline…'); busy('calendar', 'reading…');
      // Each read is guarded: a rejected fetch (the sidecar is down, the network dropped) must leave a NAMED
      // error in the panel, never an unhandled rejection and a panel stuck on "reading…" forever.
      const fail = (id) => (e) => { err(id, (e && e.message) ? ('could not read that — ' + e.message) : 'could not read that — the sidecar could not be reached'); };
      apiFetch('/api/creator/pipeline')
        .then(d => { state.pipeline = shapePipeline(d, now()); render('pipeline'); renderHeader(); })
        .catch(fail('pipeline'));
      apiFetch('/api/creator/calendar')
        .then(d => { state.calendar = shapeCalendar(d, now()); render('calendar'); })
        .catch(fail('calendar'));
    }

    host.querySelector('#cs-refresh').addEventListener('click', loadAll);
    for (const t of host.querySelectorAll('.cs-tab')) t.addEventListener('click', () => showTab(t.getAttribute('data-tab')));

    loadAll();
    return { state: state, reload: loadAll };
  }

  return {
    esc, relTime, stageLabel, channelLabel,
    shapePiece, shapePipeline, shapeCalendar, shapeHeader,
    STAGE_LABEL, CHANNEL_LABEL,
    mount
  };
});
