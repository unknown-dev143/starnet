/* SPACESTATION — businesssecurity.js : the §13 SECURITY CENTER console (Business OS Phase 10).

   The presentation half of §13. The sidecar (`business-security.js`) composes the four sources into one read;
   this file renders that read and NOTHING ELSE. It holds no policy of its own: every tier, action label and
   reason it shows comes off the wire, so the console cannot drift from the authority the engine enforces.

   WHAT IT DELIBERATELY DOES NOT DO:

     • NO SCORE / NO GRADE / NO TRAFFIC LIGHT. The temptation in a security view is a big verdict at the top.
       The four sources contain nothing that could justify one — there is no threat model here — so the view
       opens on counts and goes straight to the evidence. The one number that is genuinely useful is "how many
       capabilities are held", and it is a COUNT, labelled as such.

     • NOTHING IS MUTABLE FROM HERE. Granting and approving have their own guarded surfaces. This is a read.

     • AN UNAVAILABLE SOURCE IS SHOWN AS UNAVAILABLE. If the approvals count could not be read the engine
       sends null; the console renders "not readable" and never a 0 that would read as "nothing waiting".

   The pure half (every shaper below) is Node-loadable so the tests exercise it headless; only `mount` touches
   the DOM. */

'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).businessSecurityUI = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------------------------
  // PURE HALF — the tested surface
  // ---------------------------------------------------------------------------------------------

  const TIER_ORDER = ['safe', 'review', 'restricted'];
  const TIER_LABEL = {
    safe: 'SAFE', review: 'REVIEW', restricted: 'RESTRICTED'
  };
  const TIER_BLURB = {
    safe: 'runs automatically',
    review: 'pauses for your approval',
    restricted: 'never auto-runs — needs explicit authorization and safeguards'
  };

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

  function tierLabel(t) { return TIER_LABEL[String(t || '')] || 'UNKNOWN'; }
  function tierBlurb(t) { return TIER_BLURB[String(t || '')] || ''; }

  /* THE COUNTS ROW. Deliberately not a score: each cell is a count of something that exists.
     `pending` is special — null means "could not be read", which must render as such. */
  function shapeCounts(o) {
    o = o || {};
    const t = o.totals || {};
    const avail = o.availability || {};
    return {
      // "capabilities held" is the honest headline: a count of actions at least one seat may run.
      held: Number.isFinite(t.held) ? t.held : 0,
      actions: Number.isFinite(t.actions) ? t.actions : 0,
      neverGrantable: Number.isFinite(t.neverGrantable) ? t.neverGrantable : 0,
      reviewSeats: Number.isFinite(t.reviewActionsHeld) ? t.reviewActionsHeld : 0,
      agents: Number.isFinite(o.agentCount) ? o.agentCount : 0,
      // null is NOT 0 — a source that could not be read must not look like "nothing waiting"
      pending: (o.pendingApprovals === null || o.pendingApprovals === undefined) ? null : o.pendingApprovals,
      pendingReadable: avail.approvals !== false,
      decisions: Number.isFinite(o.decisionCount) ? o.decisionCount : 0
    };
  }

  /* THE CAPABILITY TABLE — one row per tier, with its counts. Ordered safe → review → restricted so the
     escalation reads downward. */
  function shapeCapabilities(caps, tiers) {
    const list = Array.isArray(caps) ? caps : [];
    const byTier = {};
    for (const t of (Array.isArray(tiers) ? tiers : [])) {
      if (!byTier[t.tier]) byTier[t.tier] = { tier: t.tier, actions: 0, held: 0, neverGrantable: 0, note: '' };
    }
    const ordered = TIER_ORDER.map(k => {
      const found = list.filter(c => c.tier === k)[0];
      return found || byTier[k] || { tier: k, actions: 0, held: 0, neverGrantable: 0, note: '' };
    });
    return ordered.map(c => ({
      tier: c.tier,
      label: tierLabel(c.tier),
      blurb: c.note || tierBlurb(c.tier),
      actions: c.actions || 0,
      held: c.held || 0,
      neverGrantable: c.neverGrantable || 0,
      // a tier where nothing is held reads as "none held", not as "clean"
      heldText: (c.held || 0) + ' of ' + (c.actions || 0) + ' held'
    }));
  }

  /* THE ACTION TABLE — the "who can do what" grid. An action held by nobody says so in words. */
  function shapeActions(tiers) {
    return (Array.isArray(tiers) ? tiers : []).map(t => ({
      id: t.id,
      label: t.label || t.id,
      tier: t.tier,
      tierLabel: tierLabel(t.tier),
      note: t.note || '',
      neverGrantable: !!t.neverGrantable,
      holders: (Array.isArray(t.heldBy) ? t.heldBy : []).slice(),
      // the honest phrasing: an empty holder list is "nobody", and for restricted it is "nobody, ever".
      heldText: t.neverGrantable
        ? 'held by nobody — not grantable'
        : ((t.holderCount || 0) === 0 ? 'held by nobody' : (t.heldBy || []).join(', ')),
      heldCount: t.holderCount || 0
    })).sort((a, b) => {
      // group by tier (safe → review → restricted), then by label, so the table is scannable
      const d = TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier);
      return d !== 0 ? d : String(a.label).localeCompare(String(b.label));
    });
  }

  /* THE SEAT TABLE — each hired agent and the authority it holds. A seat holding review authority is
     FLAGGED, because that is the thing a reader scanning this list must not miss. */
  function shapeSeats(agents) {
    return (Array.isArray(agents) ? agents : []).map(a => ({
      id: a.id || '',
      name: a.name || '(unnamed seat)',
      role: a.role || '',
      specialty: a.specialty || '',
      status: a.status || '',
      grantedTiers: (Array.isArray(a.grantedTiers) ? a.grantedTiers : []).map(tierLabel),
      heldCount: a.heldCount || 0,
      holdsReview: !!a.holdsReview,
      heldText: (a.heldCount || 0) === 0 ? 'no capabilities' : (a.heldCount + ' capabilit' + (a.heldCount === 1 ? 'y' : 'ies'))
    }));
  }

  /* THE DECISION ROWS — the authority slice of the audit trail. `aboutAuthority` is surfaced so the view can
     distinguish "a decision was made about authority" from "ordinary work happened". */
  function shapeDecisions(decisions, nowMs) {
    return (Array.isArray(decisions) ? decisions : []).map(d => ({
      id: d.id || '',
      at: Number.isFinite(d.at) ? d.at : -1,
      when: relTime(d.at, nowMs),
      actor: d.actor || 'system',
      actorName: d.actorName || '',
      action: d.action || '',
      actionLabel: d.actionLabel || d.action || '',
      tier: d.tier || '',
      tierLabel: d.tier ? tierLabel(d.tier) : '',
      result: d.result || '',
      approval: d.approval || '',
      reason: d.reason || '',
      detail: d.detail || '',
      aboutAuthority: !!d.aboutAuthority
    }));
  }

  /* THE WHOLE READ, shaped for rendering. One entry point so `mount` does no derivation of its own. */
  function shapeOverview(raw, nowMs) {
    raw = raw || {};
    return {
      /* ok requires an EXPLICIT ok:true. A missing payload is not a clean empty view — treating an absent
         response as "ok with nothing in it" is exactly how a security read silently shows a blank that
         looks like a clean bill of health. */
      ok: raw.ok === true,
      businessId: raw.businessId || '',
      counts: shapeCounts(raw),
      capabilities: shapeCapabilities(raw.capabilities, raw.tiers),
      actions: shapeActions(raw.tiers),
      seats: shapeSeats(raw.agents),
      decisions: shapeDecisions(raw.decisions, nowMs),
      availability: {
        agents: (raw.availability || {}).agents !== false,
        audit: (raw.availability || {}).audit !== false,
        approvals: (raw.availability || {}).approvals !== false
      },
      note: raw.note || ''
    };
  }

  /* AVAILABILITY WARNINGS — one line per unreadable source. Empty array = everything read. The point is
     that a reader never has to wonder whether a blank table means "nothing there" or "not read". */
  function availabilityWarnings(overview) {
    const a = (overview && overview.availability) || {};
    const out = [];
    if (a.agents === false) out.push('the seat list could not be read — the capability table below is incomplete');
    if (a.audit === false) out.push('the activity log could not be read — recent decisions are not shown');
    if (a.approvals === false) out.push('the approval queue could not be read — the pending count is unknown, not zero');
    return out;
  }

  /* CLAMP NOTICE — the audit route reports when it capped a limit; surface it rather than hiding it. */
  function clampNotice(audit) {
    const c = audit && audit.limitClamped;
    if (!c) return '';
    return 'showing the most recent ' + c.applied + ' (you asked for ' + c.asked + '; the maximum is ' + c.max + ')';
  }

  /* THE AUDIT SLICE, shaped. */
  function shapeAudit(raw, nowMs) {
    raw = raw || {};
    return {
      ok: raw.ok !== false,
      readable: raw.readable !== false,
      businessId: raw.businessId || '',
      rows: (Array.isArray(raw.rows) ? raw.rows : []).map(r => ({
        id: r.id || '',
        when: relTime(r.at, nowMs),
        actor: r.actor || 'system',
        actorName: r.actorName || '',
        action: r.action || '',
        actionLabel: r.actionLabel || r.action || '',
        tierLabel: r.tier ? tierLabel(r.tier) : '',
        result: r.result || '',
        approval: r.approval || '',
        reason: r.reason || '',
        detail: r.detail || ''
      })),
      notice: clampNotice(raw)
    };
  }

  // ---------------------------------------------------------------------------------------------
  // DOM HALF
  // ---------------------------------------------------------------------------------------------

  const PREFIX = '/api/businesses/';

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
      '<div class="se-wrap">' +
        '<div class="se-head">' +
          '<h3 class="se-title">SECURITY CENTER</h3>' +
          // PERSISTENT framing. Not dismissible: it is the line that stops a blank table being read as a
          // clean bill of health, and stops the counts being read as a verdict.
          '<span class="se-banner" data-hint="securitycenter">a read of what is recorded — no score, no grade</span>' +
          '<span class="se-spacer"></span>' +
          '<select class="se-select" id="se-biz" data-hint="business"></select>' +
          '<button class="se-btn" id="se-refresh" data-hint="securitycenter">REFRESH</button>' +
        '</div>' +
        '<div class="se-tabs">' +
          '<button class="se-tab se-on" data-tab="overview" data-hint="securitycenter">OVERVIEW</button>' +
          '<button class="se-tab" data-tab="authority" data-hint="securitycenter">WHO CAN DO WHAT</button>' +
          '<button class="se-tab" data-tab="audit" data-hint="securitycenter">AUDIT</button>' +
          '<button class="se-tab" data-tab="rules" data-hint="securitycenter">RULES</button>' +
        '</div>' +
        '<div class="se-panels">' +
          '<div class="se-panel se-on" id="se-panel-overview"></div>' +
          '<div class="se-panel" id="se-panel-authority"></div>' +
          '<div class="se-panel" id="se-panel-audit"></div>' +
          '<div class="se-panel" id="se-panel-rules"></div>' +
        '</div>' +
      '</div>';

    const state = { businessId: '', tab: 'overview', overview: null, audit: null, rules: null };

    function panel(id) { return host.querySelector('#se-panel-' + id); }
    function say(id, html) { const p = panel(id); if (p) p.innerHTML = html; }
    function busy(id, text) { say(id, '<p class="se-loading">' + esc(text || 'reading…') + '</p>'); }
    function err(id, reason) { say(id, '<p class="se-err">' + esc(reason || 'could not read that') + '</p>'); }

    function showTab(tab) {
      state.tab = tab;
      for (const t of host.querySelectorAll('.se-tab')) t.classList.toggle('se-on', t.getAttribute('data-tab') === tab);
      for (const p of host.querySelectorAll('.se-panel')) p.classList.toggle('se-on', p.id === 'se-panel-' + tab);
      render(tab);
    }

    function renderOverview() {
      const o = state.overview;
      if (!o) return busy('overview');
      const c = o.counts;
      const warns = availabilityWarnings(o);
      const pendText = c.pendingReadable ? String(c.pending == null ? 0 : c.pending) : 'not readable';

      const capRows = o.capabilities.map(cp =>
        '<tr class="se-cap se-cap-' + esc(cp.tier) + '">' +
          '<td class="se-cell-tier"><span class="se-tier se-tier-' + esc(cp.tier) + '">' + esc(cp.label) + '</span></td>' +
          '<td class="se-cell-note">' + esc(cp.blurb) + '</td>' +
          '<td class="se-cell-num">' + cp.held + ' / ' + cp.actions + '</td>' +
          (cp.neverGrantable ? '<td class="se-cell-tag"><span class="se-tag">' + cp.neverGrantable + ' un-grantable</span></td>' : '<td class="se-cell-tag"></td>') +
        '</tr>').join('');

      const decRows = o.decisions.length ? o.decisions.map(d =>
        '<tr class="se-dec' + (d.aboutAuthority ? ' se-dec-auth' : '') + '">' +
          '<td class="se-cell-when">' + esc(d.when) + '</td>' +
          '<td class="se-cell-who">' + esc(d.actor === 'agent' ? (d.actorName || 'AI') : d.actor === 'user' ? 'YOU' : 'SYSTEM') + '</td>' +
          '<td class="se-cell-what">' + esc(d.actionLabel) + (d.tierLabel ? ' <span class="se-tag se-tag-' + esc(d.tier) + '">' + esc(d.tierLabel) + '</span>' : '') + '</td>' +
          '<td class="se-cell-res">' + esc(d.result) + (d.approval && d.approval !== 'not-required' ? ' · ' + esc(d.approval) : '') + '</td>' +
          '<td class="se-cell-why">' + esc(d.reason) + '</td>' +
        '</tr>').join('') : '<tr><td colspan="5" class="se-none">no authority decisions recorded yet</td></tr>';

      say('overview', '' +
        (warns.length ? '<div class="se-warn">' + warns.map(w => esc(w)).join('<br>') + '</div>' : '') +
        '<div class="se-counts">' +
          '<div class="se-count"><b>' + c.held + '</b><span>of ' + c.actions + ' actions held</span></div>' +
          '<div class="se-count"><b>' + c.agents + '</b><span>hired seat' + (c.agents === 1 ? '' : 's') + '</span></div>' +
          '<div class="se-count"><b>' + c.reviewSeats + '</b><span>seat' + (c.reviewSeats === 1 ? '' : 's') + ' with review authority</span></div>' +
          '<div class="se-count"><b>' + c.neverGrantable + '</b><span>un-grantable (restricted)</span></div>' +
          '<div class="se-count se-count-pending"><b>' + esc(pendText) + '</b><span>waiting on you</span></div>' +
        '</div>' +
        '<h4 class="se-sub">CAPABILITY BY TIER</h4>' +
        '<table class="se-table"><thead><tr><th>tier</th><th>what it means</th><th>held</th><th></th></tr></thead>' +
        '<tbody>' + capRows + '</tbody></table>' +
        '<h4 class="se-sub">RECENT AUTHORITY DECISIONS</h4>' +
        '<table class="se-table"><thead><tr><th>when</th><th>who</th><th>action</th><th>result</th><th>why</th></tr></thead>' +
        '<tbody>' + decRows + '</tbody></table>' +
        (o.note ? '<p class="se-note">' + esc(o.note) + '</p>' : ''));
    }

    function renderAuthority() {
      const o = state.overview;
      if (!o) return busy('authority');
      const actRows = o.actions.map(a =>
        '<tr class="se-act' + (a.neverGrantable ? ' se-act-restricted' : '') + '">' +
          '<td class="se-cell-what">' + esc(a.label) + '</td>' +
          '<td class="se-cell-tier"><span class="se-tier se-tier-' + esc(a.tier) + '">' + esc(a.tierLabel) + '</span></td>' +
          '<td class="se-cell-note">' + esc(a.note) + '</td>' +
          '<td class="se-cell-holders' + (a.heldCount ? '' : ' se-cell-none') + '">' + esc(a.heldText) + '</td>' +
        '</tr>').join('');

      const seatRows = o.seats.length ? o.seats.map(s =>
        '<tr class="se-seat' + (s.holdsReview ? ' se-seat-review' : '') + '">' +
          '<td class="se-cell-what">' + esc(s.name) + '</td>' +
          '<td class="se-cell-note">' + esc(s.role) + (s.specialty ? ' · ' + esc(s.specialty) : '') + '</td>' +
          '<td class="se-cell-tier">' + (s.grantedTiers.length ? s.grantedTiers.map(t => '<span class="se-tier">' + esc(t) + '</span>').join(' ') : '<span class="se-none">none</span>') + '</td>' +
          '<td class="se-cell-num">' + esc(s.heldText) + '</td>' +
        '</tr>').join('') : '<tr><td colspan="4" class="se-none">no seats hired yet</td></tr>';

      say('authority', '' +
        '<h4 class="se-sub">WHO CAN DO WHAT</h4>' +
        '<table class="se-table"><thead><tr><th>action</th><th>tier</th><th>note</th><th>held by</th></tr></thead>' +
        '<tbody>' + actRows + '</tbody></table>' +
        '<h4 class="se-sub">SEATS</h4>' +
        '<table class="se-table"><thead><tr><th>seat</th><th>role</th><th>grants</th><th>capabilities</th></tr></thead>' +
        '<tbody>' + seatRows + '</tbody></table>');
    }

    function renderAudit() {
      const a = state.audit;
      if (!a) return busy('audit');
      if (a.readable === false) return say('audit', '<p class="se-warn">the activity log could not be read</p>');
      const rows = a.rows.length ? a.rows.map(r =>
        '<tr class="se-log">' +
          '<td class="se-cell-when">' + esc(r.when) + '</td>' +
          '<td class="se-cell-who">' + esc(r.actor === 'agent' ? (r.actorName || 'AI') : r.actor === 'user' ? 'YOU' : 'SYSTEM') + '</td>' +
          '<td class="se-cell-what">' + esc(r.actionLabel) + (r.tierLabel ? ' <span class="se-tag">' + esc(r.tierLabel) + '</span>' : '') + '</td>' +
          '<td class="se-cell-res">' + esc(r.result) + '</td>' +
          '<td class="se-cell-why">' + esc(r.reason || r.detail) + '</td>' +
        '</tr>').join('') : '<tr><td colspan="5" class="se-none">nothing recorded yet</td></tr>';
      say('audit', (a.notice ? '<p class="se-note">' + esc(a.notice) + '</p>' : '') +
        '<table class="se-table"><thead><tr><th>when</th><th>who</th><th>action</th><th>result</th><th>detail</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>');
    }

    function renderRules() {
      const r = state.rules;
      if (!r) return busy('rules');
      const tiers = (r.tiers || []).map(t =>
        '<div class="se-rule">' +
          '<div class="se-rule-head"><span class="se-tier se-tier-' + esc(t.tier) + '">' + esc(tierLabel(t.tier)) + '</span>' +
          '<span class="se-rule-note">' + esc(t.note || tierBlurb(t.tier)) + '</span></div>' +
          '<ul class="se-rule-list">' +
            (Array.isArray(t.actions) ? t.actions : []).map(a => '<li><b>' + esc(a.label) + '</b> — ' + esc(a.note) + '</li>').join('') +
          '</ul></div>').join('');
      say('rules', '<p class="se-note">the §13 tier table — the policy every grant is measured against</p>' + tiers);
    }

    function render(tab) {
      if (tab === 'overview') renderOverview();
      else if (tab === 'authority') renderAuthority();
      else if (tab === 'audit') renderAudit();
      else if (tab === 'rules') renderRules();
    }

    // ---- data ---------------------------------------------------------------------------------------
    function loadBusinesses() {
      return apiFetch('/api/businesses').then(data => {
        const list = (data && (data.businesses || data.list)) || [];
        const sel = host.querySelector('#se-biz');
        if (!sel) return;
        sel.innerHTML = list.map(b => '<option value="' + esc(b.id) + '">' + esc(b.name || b.id) + '</option>').join('')
          || '<option value="">no businesses</option>';
        if (list.length) state.businessId = list[0].id;
      }).catch(() => {});
    }

    function loadAll() {
      const b = state.businessId;
      if (!b) { err('overview', 'pick a business first'); return; }
      busy('overview', 'reading the security state…');
      busy('authority', 'reading…'); busy('audit', 'reading…'); busy('rules', 'reading…');
      apiFetch(PREFIX + encodeURIComponent(b) + '/security').then(d => { state.overview = shapeOverview(d, now()); render('overview'); render('authority'); });
      apiFetch(PREFIX + encodeURIComponent(b) + '/security/audit?limit=50').then(d => { state.audit = shapeAudit(d, now()); render('audit'); });
      apiFetch(PREFIX + encodeURIComponent(b) + '/security/rules').then(d => { state.rules = (d && d.rules) || null; render('rules'); });
    }

    host.querySelector('#se-refresh').addEventListener('click', loadAll);
    host.querySelector('#se-biz').addEventListener('change', e => { state.businessId = e.target.value; loadAll(); });
    for (const t of host.querySelectorAll('.se-tab')) t.addEventListener('click', () => showTab(t.getAttribute('data-tab')));

    loadBusinesses().then(() => loadAll());
    return { state: state, reload: loadAll };
  }

  return {
    // pure half — the tested surface
    esc, relTime, tierLabel, tierBlurb,
    shapeCounts, shapeCapabilities, shapeActions, shapeSeats, shapeDecisions, shapeOverview,
    availabilityWarnings, clampNotice, shapeAudit,
    TIER_ORDER, TIER_LABEL, TIER_BLURB,
    // dom
    mount
  };
});
