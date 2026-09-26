/* STARNET — businessmission.js : the §23 MISSION CONTROL console (Business OS Phase 11).

   The presentation half of §23. The sidecar (`mission-control.js`) ranks every business by what is blocking
   it and names the reasons; this file renders that board and NOTHING ELSE. It holds no ranking policy of its
   own: the order and the reasons all come off the wire, so the console cannot disagree with the composer.

   WHAT IT DELIBERATELY DOES NOT DO:

     • NO SCORE / NO HEALTH BAR / NO COLOUR BAND. The composer deliberately emits no verdict, and the console
       does not invent one for display. The reasons ARE the ranking, and they are printed on every row.

     • NOTHING IS MUTABLE FROM HERE. Resuming a business, approving a request, opening a business — those are
       places, not buttons in a read view. Each row links to where the work happens; it does not do it.

     • AN UNREADABLE SOURCE IS SHOWN AS UNAVAILABLE. If the approvals count could not be read the composer
       sends null; the console renders "unknown" and never a 0 that would read as "nothing waiting".

   The pure half (every shaper below) is Node-loadable so the tests exercise it headless; only `mount` touches
   the DOM. */

'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).businessMissionUI = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------------------------
  // PURE HALF — the tested surface
  // ---------------------------------------------------------------------------------------------

  const STAGE_LABEL = {
    idea: 'IDEA', validating: 'VALIDATING', planning: 'PLANNING', building: 'BUILDING',
    testing: 'TESTING', live: 'LIVE', growing: 'GROWING', paused: 'PAUSED',
    'winding-down': 'WINDING DOWN', archived: 'ARCHIVED'
  };
  // The reasons that mean "a human is needed", used only for phrasing the header line — never for ranking.
  const HUMAN_KINDS = { 'waiting-on-you': 1, paused: 1, 'winding-down': 1, archived: 1, stale: 1, 'never-moved': 1 };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function relTime(ms, nowMs) {
    if (!ms || ms < 0) return '';                    // an undated row says nothing rather than "1970"
    const now = (typeof nowMs === 'number') ? nowMs : Date.now();
    const d = now - ms;
    if (d < 0) return 'now';                         // clock skew must not render "-3m"
    if (d < 60000) return 'now';
    const m = Math.floor(d / 60000);
    if (m < 60) return m + 'm';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h';
    return Math.floor(h / 24) + 'd';
  }

  function stageLabel(s) { return STAGE_LABEL[String(s || '')] || 'UNKNOWN'; }

  /* THE HEADER LINE — a plain quote of the counts, no verdict. "3 need you" names a number of businesses
     carrying a reason; "1 blocked" is the narrower count. Never "health" or "status". */
  function shapeHeader(counts) {
    counts = counts || {};
    const needs = Number.isFinite(counts.needsYou) ? counts.needsYou : 0;
    const blocked = Number.isFinite(counts.blockedOnYou) ? counts.blockedOnYou : 0;
    const total = Number.isFinite(counts.businesses) ? counts.businesses : 0;
    const pending = (counts.pending === null || counts.pending === undefined) ? null : counts.pending;
    const parts = [];
    parts.push(total + (total === 1 ? ' business' : ' businesses'));
    if (needs) parts.push(needs + ' need' + (needs === 1 ? 's' : '') + ' you');
    if (blocked) parts.push(blocked + ' blocked on an approval');
    /* null pending is "unknown", NOT "none waiting" — this is the whole null-vs-zero rule, in the header. */
    if (pending === null) parts.push('approvals unknown');
    else if (pending) parts.push(pending + ' approval' + (pending === 1 ? '' : 's') + ' pending');
    return {
      text: parts.join(' · '),
      needs: needs,
      blocked: blocked,
      total: total,
      pending: pending,
      pendingKnown: pending !== null
    };
  }

  /* ONE BOARD ROW. The reasons are the payload: a row without them would be an unexplained order. */
  function shapeRow(r, nowMs) {
    r = r || {};
    const reasons = (Array.isArray(r.reasons) ? r.reasons : []).map(x => ({
      kind: x && x.kind ? x.kind : '',
      text: (x && x.text) ? String(x.text) : ''
    }));
    /* Resolve the stage ONCE so the stored value and the label can never disagree (a row that stored 'idea'
       but labelled 'UNKNOWN' is exactly the bug this avoids). */
    const stage = String(r.stage || 'idea');
    return {
      id: String(r.id || ''),
      name: String(r.name || '(unnamed)'),
      stage: stage,
      stageLabel: stageLabel(stage),
      template: String(r.template || 'custom'),
      updatedRel: relTime(r.updatedAt, nowMs),
      pending: Number.isFinite(r.pending) ? r.pending : 0,
      reasons: reasons,
      reasonText: reasons.map(x => x.text).join(' · '),
      quiet: !!r.quiet,
      // the band is carried for ORDERING/labelling only — never rendered as a number
      band: Number.isFinite(r.band) ? r.band : 9,
      // does this row need a human at all? derived from the reasons, not from a score
      needsHuman: reasons.some(x => HUMAN_KINDS[x.kind])
    };
  }

  /* THE WHOLE BOARD, shaped. */
  function shapeBoard(raw, nowMs) {
    raw = raw || {};
    return {
      ok: raw.ok === true,
      generatedAt: Number.isFinite(raw.generatedAt) ? raw.generatedAt : null,
      header: shapeHeader(raw.counts),
      rows: (Array.isArray(raw.businesses) ? raw.businesses : []).map(r => shapeRow(r, nowMs)),
      counts: raw.counts || {},
      note: raw.note || ''
    };
  }

  /* THE PORTFOLIO FIGURES — passed through, but ordered and labelled. A metric with no total (a rate is never
     summed) shows its mean and says so rather than a blank. */
  function shapeFleet(raw, nowMs) {
    raw = raw || {};
    const pf = raw.portfolio || null;
    const metrics = (pf && Array.isArray(pf.metrics) ? pf.metrics : []).map(m => ({
      metric: String(m.metric || ''),
      label: String(m.label || m.metric || ''),
      unit: String(m.unit || ''),
      /* `total` is null for a rate BY DESIGN (adding rates is meaningless). Report it as null and let the
         renderer say "not summed", never 0. */
      total: (m.total === null || m.total === undefined) ? null : m.total,
      mean: (m.mean === null || m.mean === undefined) ? null : m.mean,
      min: (m.min === null || m.min === undefined) ? null : m.min,
      max: (m.max === null || m.max === undefined) ? null : m.max,
      notSummed: m.total === null || m.total === undefined
    }));
    return {
      ok: raw.ok === true,
      portfolioReadable: raw.portfolioReadable !== false,
      businesses: (pf && Number.isFinite(pf.businesses)) ? pf.businesses : 0,
      metrics: metrics,
      note: raw.note || ''
    };
  }

  /* THE TRAIL ROWS. */
  function shapeTrail(raw, nowMs) {
    raw = raw || {};
    return {
      ok: raw.ok === true,
      readable: raw.readable !== false,
      rows: (Array.isArray(raw.rows) ? raw.rows : []).map(r => ({
        id: String(r.id || ''),
        at: Number.isFinite(r.at) ? r.at : -1,
        when: relTime(r.at, nowMs),
        businessId: String(r.businessId || ''),
        actor: String(r.actor || 'system'),
        actorName: String(r.actorName || ''),
        action: String(r.action || ''),
        result: String(r.result || ''),
        detail: String(r.detail || '')
      }))
    };
  }

  /* THE ALERT SIGNALS for one business. */
  function shapeAlerts(raw) {
    raw = raw || {};
    return {
      ok: raw.ok === true,
      businessId: String(raw.businessId || ''),
      readable: raw.readable !== false,
      signals: (Array.isArray(raw.signals) ? raw.signals : []).map(s => ({
        kind: String(s.kind || ''),
        metric: String(s.metric || ''),
        label: String(s.label || ''),
        text: String(s.text || ''),
        direction: String(s.direction || '')
      }))
    };
  }

  /* AVAILABILITY WARNINGS — one line per unreadable source. Empty = everything read. */
  function availabilityWarnings(board, fleet, trail) {
    const out = [];
    if (board && board.counts && board.counts.pending === null) {
      out.push('the approval queue could not be read — what is waiting on you is unknown, not zero');
    }
    if (fleet && fleet.portfolioReadable === false) {
      out.push('the cross-business figures could not be built — the board below is still current');
    }
    if (trail && trail.readable === false) {
      out.push('the activity trail could not be read');
    }
    return out;
  }

  /* A SHORT SUMMARY suitable for a badge: the count of businesses that need a human. Null-safe. */
  function attentionBadge(board) {
    if (!board || board.ok !== true) return { text: '', count: 0, known: false };
    const n = (board.header && board.header.needs) || 0;
    return { text: n ? String(n) : '', count: n, known: true };
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
      '<div class="mssn-wrap">' +
        '<div class="mssn-head">' +
          '<h3 class="mssn-title">MISSION CONTROL</h3>' +
          // PERSISTENT framing: the ranking is the reasons, not a score.
          '<span class="mssn-banner" data-hint="missioncontrol">everything you are running — ranked by what is blocking it, with the reasons named</span>' +
          '<span class="mssn-spacer"></span>' +
          '<span class="mssn-sum" id="mssn-sum"></span>' +
          '<button class="mssn-btn" id="mssn-refresh" data-hint="missioncontrol">REFRESH</button>' +
        '</div>' +
        '<div class="mssn-tabs">' +
          '<button class="mssn-tab mssn-on" data-tab="board" data-hint="missioncontrol">BOARD</button>' +
          '<button class="mssn-tab" data-tab="fleet" data-hint="missioncontrol">FLEET FIGURES</button>' +
          '<button class="mssn-tab" data-tab="trail" data-hint="missioncontrol">TRAIL</button>' +
        '</div>' +
        '<div class="mssn-panels">' +
          '<div class="mssn-panel mssn-on" id="mssn-panel-board"></div>' +
          '<div class="mssn-panel" id="mssn-panel-fleet"></div>' +
          '<div class="mssn-panel" id="mssn-panel-trail"></div>' +
        '</div>' +
      '</div>';

    const state = { tab: 'board', board: null, fleet: null, trail: null };

    function panel(id) { return host.querySelector('#mssn-panel-' + id); }
    function say(id, html) { const p = panel(id); if (p) p.innerHTML = html; }
    function busy(id, t) { say(id, '<p class="mssn-loading">' + esc(t || 'reading…') + '</p>'); }
    function err(id, reason) { say(id, '<p class="mssn-err">' + esc(reason || 'could not read that') + '</p>'); }

    function showTab(tab) {
      state.tab = tab;
      for (const t of host.querySelectorAll('.mssn-tab')) t.classList.toggle('mssn-on', t.getAttribute('data-tab') === tab);
      for (const p of host.querySelectorAll('.mssn-panel')) p.classList.toggle('mssn-on', p.id === 'mssn-panel-' + tab);
      render(tab);
    }

    function renderBoard() {
      const b = state.board;
      if (!b) return busy('board');
      const warns = availabilityWarnings(b, state.fleet, state.trail);
      const rows = b.rows.length ? b.rows.map(r =>
        '<tr class="mssn-row' + (r.needsHuman ? ' mssn-row-needs' : '') + '">' +
          '<td class="mssn-cell-name"><b>' + esc(r.name) + '</b>' +
            (r.quiet ? '' : '<div class="mssn-why">' + esc(r.reasonText) + '</div>') + '</td>' +
          '<td class="mssn-cell-stage"><span class="mssn-stage">' + esc(r.stageLabel) + '</span></td>' +
          '<td class="mssn-cell-pending">' + (r.pending ? String(r.pending) : '<span class="mssn-none">—</span>') + '</td>' +
          '<td class="mssn-cell-moved">' + esc(r.updatedRel) + '</td>' +
        '</tr>').join('') : '<tr><td colspan="4" class="mssn-none">no businesses yet</td></tr>';

      say('board', '' +
        (warns.length ? '<div class="mssn-warn">' + warns.map(w => esc(w)).join('<br>') + '</div>' : '') +
        '<table class="mssn-table"><thead><tr>' +
          '<th>business</th><th>stage</th><th class="mssn-th-num">waiting</th><th>last moved</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table>' +
        (b.note ? '<p class="mssn-note">' + esc(b.note) + '</p>' : ''));
    }

    function renderFleet() {
      const f = state.fleet;
      if (!f) return busy('fleet');
      if (!f.portfolioReadable) return say('fleet', '<p class="mssn-warn">the cross-business figures could not be built</p>');
      const rows = f.metrics.length ? f.metrics.map(m =>
        '<tr class="mssn-metric">' +
          '<td class="mssn-cell-name"><b>' + esc(m.label) + '</b></td>' +
          // a rate is never summed — say "not summed", never blank or 0
          '<td class="mssn-cell-num">' + (m.notSummed ? '<span class="mssn-none">not summed</span>' : esc(String(m.total))) + '</td>' +
          '<td class="mssn-cell-num">' + (m.mean === null ? '<span class="mssn-none">—</span>' : esc(String(m.mean))) + '</td>' +
          '<td class="mssn-cell-num">' + (m.min === null ? '<span class="mssn-none">—</span>' : esc(String(m.min))) + '</td>' +
          '<td class="mssn-cell-num">' + (m.max === null ? '<span class="mssn-none">—</span>' : esc(String(m.max))) + '</td>' +
        '</tr>').join('') : '<tr><td colspan="5" class="mssn-none">nothing measured yet</td></tr>';
      say('fleet', '<p class="mssn-note">across ' + f.businesses + ' business' + (f.businesses === 1 ? '' : 'es') +
        ' — a rate is never summed, so its total reads "not summed"</p>' +
        '<table class="mssn-table"><thead><tr><th>metric</th><th class="mssn-th-num">total</th><th class="mssn-th-num">mean</th><th class="mssn-th-num">min</th><th class="mssn-th-num">max</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>' +
        (f.note ? '<p class="mssn-note">' + esc(f.note) + '</p>' : ''));
    }

    function renderTrail() {
      const t = state.trail;
      if (!t) return busy('trail');
      if (t.readable === false) return say('trail', '<p class="mssn-warn">the activity trail could not be read</p>');
      const rows = t.rows.length ? t.rows.map(r =>
        '<tr class="mssn-trail">' +
          '<td class="mssn-cell-moved">' + esc(r.when) + '</td>' +
          '<td class="mssn-cell-name">' + esc(r.businessId) + '</td>' +
          '<td class="mssn-cell-who">' + esc(r.actor === 'agent' ? (r.actorName || 'AI') : r.actor === 'user' ? 'YOU' : 'SYSTEM') + '</td>' +
          '<td class="mssn-cell-name">' + esc(r.action) + '</td>' +
          '<td class="mssn-cell-res">' + esc(r.result) + '</td>' +
        '</tr>').join('') : '<tr><td colspan="5" class="mssn-none">nothing recorded yet</td></tr>';
      say('trail', '<table class="mssn-table"><thead><tr><th>when</th><th>business</th><th>who</th><th>action</th><th>result</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>');
    }

    function render(tab) {
      if (tab === 'board') renderBoard();
      else if (tab === 'fleet') renderFleet();
      else if (tab === 'trail') renderTrail();
    }

    function loadAll() {
      busy('board', 'reading the board…'); busy('fleet', 'reading…'); busy('trail', 'reading…');
      apiFetch('/api/mission/board').then(d => { state.board = shapeBoard(d, now()); render('board'); renderHeader(); });
      apiFetch('/api/mission/fleet').then(d => { state.fleet = shapeFleet(d, now()); render('fleet'); });
      apiFetch('/api/mission/trail').then(d => { state.trail = shapeTrail(d, now()); render('trail'); });
    }

    function renderHeader() {
      const el = host.querySelector('#mssn-sum');
      if (el && state.board) el.textContent = state.board.header.text;
    }

    host.querySelector('#mssn-refresh').addEventListener('click', loadAll);
    for (const t of host.querySelectorAll('.mssn-tab')) t.addEventListener('click', () => showTab(t.getAttribute('data-tab')));

    loadAll();
    return { state: state, reload: loadAll };
  }

  return {
    // pure half — the tested surface
    esc, relTime, stageLabel,
    shapeHeader, shapeRow, shapeBoard, shapeFleet, shapeTrail, shapeAlerts,
    availabilityWarnings, attentionBadge,
    STAGE_LABEL,
    // dom
    mount
  };
});
