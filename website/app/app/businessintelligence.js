/* frontend/app/businessintelligence.js — the INTELLIGENCE console (Business OS Phase 7).

   §30's Intelligence phase: business intelligence (§11), cross-business portfolio analytics, opportunity
   monitoring, the model router, and AI cost optimization — one window, five panels.

   WHY ITS OWN WINDOW. Phases 1-6 each claimed a word on the dock; INTELLIGENCE does not overlap any of them.
   It is not a lane of AUTOMATION and not a tab of MANAGER: those act, this reports.

   THE TWO HALVES. The PURE half (labels, row shaping, period maths) is Node-loadable and unit-tested headless.
   The DOM half mounts it. The pure half is where the honesty lives, and this phase has a sharper honesty
   problem than any before it:

     AN EXPLANATION IS NOT A VERDICT.
     §11 lets the station explain a change "by investigating available evidence and stating possible causes
     without pretending certainty". So a cause row shows:
       · what was observed (the change),
       · what ELSE was recorded in the same window (the candidate),
       · and how much weight that candidate bears — STRONG / MODERATE / WEAK, never "because".
     Rendering "Revenue fell because 2 sync jobs failed" would be the single worst thing this console could
     print: it is a causal claim the data cannot support, and it would be believed. The console therefore
     renders causes under the heading POSSIBLE CAUSES and quotes the engine's own `verdict` line, which says
     plainly that no cause is asserted.

     NO DATA IS NOT ZERO DATA.
     `latest: null` from the metrics store means "never recorded". The portfolio panel renders that as MISSING,
     not 0 — a total that quietly included a dozen zeros would look like a real aggregate of real businesses.

     A SAVING IS AN ESTIMATE AND SAYS SO.
     The cost panel shows each recommendation with its caveat inline, because "switch to X, save $89" without
     "assuming the cheaper model is good enough" is a number the owner would act on and could not audit.

   NO `window.alert/confirm/prompt` (station-tooltip.test.js bans them). Ids are namespaced `in-*`: .in- is
   free (.bc-/.bm-/.tm-/.mg-/.ba-/.wk- are Phases 1-6). */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).businessIntelligenceConsole = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ================================ PURE HALF ================================

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function relTime(at, now) {
    if (at == null || !isFinite(Number(at))) return 'never';
    const d = Number(now) - Number(at);
    if (!isFinite(d)) return 'never';
    if (d < 0) return 'just now';
    if (d < 60000) return Math.floor(d / 1000) + 's ago';
    if (d < 3600000) return Math.floor(d / 60000) + 'm ago';
    if (d < 86400000) return Math.floor(d / 3600000) + 'h ago';
    return Math.floor(d / 86400000) + 'd ago';
  }

  const DIRECTION_CLASS = {
    up: 'in-up', down: 'in-down', flat: 'in-flat',
    onset: 'in-onset', cessation: 'in-cessation', unknown: 'in-unknown'
  };
  const CONFIDENCE_CLASS = { strong: 'in-conf-strong', moderate: 'in-conf-moderate', weak: 'in-conf-weak', none: 'in-conf-none' };

  /* THE DIRECTION WORD. 'onset' and 'cessation' exist because a percentage from or to zero is not a fact —
     so they render as words describing what happened ("STARTED", "STOPPED"), never as a percentage. */
  const DIRECTION_WORD = {
    up: 'rose', down: 'fell', flat: 'held steady',
    onset: 'started', cessation: 'stopped', unknown: 'unknown'
  };

  function directionChip(direction) {
    const d = String(direction || 'unknown');
    const cls = DIRECTION_CLASS[d] || 'in-unknown';
    const word = d === 'up' ? 'UP' : d === 'down' ? 'DOWN' : d === 'flat' ? 'FLAT'
      : d === 'onset' ? 'STARTED' : d === 'cessation' ? 'STOPPED' : 'UNKNOWN';
    return '<span class="in-chip ' + cls + '">' + esc(word) + '</span>';
  }

  function confidenceChip(confidence) {
    const c = String(confidence || 'none');
    return '<span class="in-chip ' + (CONFIDENCE_CLASS[c] || 'in-conf-none') + '" title="' +
      esc(confidenceTitle(c)) + '">' + esc(c.toUpperCase()) + '</span>';
  }

  function confidenceTitle(c) {
    if (c === 'strong') return 'enough readings were recorded to describe this change with confidence';
    if (c === 'moderate') return 'some readings — the direction is probably real, but the size is not well observed';
    if (c === 'weak') return 'very few readings, or a comparison window wider than the recorded history — treat this as a hint';
    return 'not enough recorded data to describe a change at all';
  }

  /* THE VALUE LINE. A rate renders as a percentage; a currency is deliberately NOT given a ¥/$ prefix
     (the station has no single business currency, so a bare number with the unit named beside it is the
     honest rendering). An absent reading reads as WORDS, never 0 — see the header.

     PLAIN TEXT, NOT HTML. This function is composed into `esc(...)` by every caller, so returning markup
     here would be escaped and printed literally as "<span class=...>not recorded</span>". `fmtHtml`
     below is the markup-returning variant, for callers that do not escape. */
  function fmt(value, unit) {
    if (value == null || !isFinite(Number(value))) return 'not recorded';
    const n = Number(value);
    if (unit === 'rate') return (Math.round(n * 10000) / 100) + '%';
    return String(Math.round(n * 100) / 100);
  }
  // Same value, escaped and with the "absent" case styled. For callers that do NOT wrap in esc().
  function fmtHtml(value, unit) {
    if (value == null || !isFinite(Number(value))) return '<span class="in-none">not recorded</span>';
    return esc(fmt(value, unit));
  }

  function fmtChange(row) {
    if (row.changePct == null) {
      if (row.direction === 'onset' || row.direction === 'cessation') return '—';
      return '—';
    }
    const p = Math.round(row.changePct * 10000) / 100;
    return (p > 0 ? '+' : '') + p + '%';
  }

  // ---- row shaping -----------------------------------------------------------------------------------

  /* ONE TREND ROW. The note is rendered whenever present: it is the engine saying something true that the
     numbers alone would hide (a window wider than the history, a stop, a start from nothing). */
  function trendRow(t) {
    const note = t.note ? '<div class="in-note">' + esc(t.note) + '</div>' : '';
    return '<div class="in-row in-trend">' +
      '<div class="in-rowhead">' +
        '<span class="in-metric">' + esc(t.label) + '</span>' +
        directionChip(t.direction) +
        confidenceChip(t.confidence) +
        '<span class="in-spacer"></span>' +
        '<span class="in-delta">' + esc(fmtChange(t)) + '</span>' +
      '</div>' +
      '<div class="in-rowbody">' +
        fmtHtml(t.from, t.unit) + ' → <b>' + fmtHtml(t.to, t.unit) + '</b>' +
        ' <span class="in-sub">· ' + esc(t.readings) + ' reading' + (t.readings === 1 ? '' : 's') +
        (t.at ? ' · last ' + esc(relTime(t.at, Date.now())) : '') + '</span>' +
      '</div>' + note +
    '</div>';
  }

  /* ONE CAUSE ROW — the most important rendering in this file. It shows the candidate text, the evidence
     class it rests on, and the weight. The heading above the list (in causesHtml) is what keeps it honest:
     a cause is never rendered as a reason. */
  function causeRow(c) {
    const cls = c.confidence === 'strong' ? 'in-conf-strong' : c.confidence === 'moderate' ? 'in-conf-moderate' : 'in-conf-weak';
    return '<div class="in-row in-cause">' +
      '<div class="in-rowhead">' +
        '<span class="in-chip ' + cls + '">' + esc(String(c.confidence || 'weak').toUpperCase()) + '</span>' +
        '<span class="in-chip in-ev">' + esc(String(c.evidence || 'unknown').toUpperCase()) + '</span>' +
        '<span class="in-kind">' + esc(c.kind || '') + '</span>' +
      '</div>' +
      '<div class="in-rowbody">' + esc(c.text) + '</div>' +
    '</div>';
  }

  function causesHtml(exp) {
    if (!exp) return '';
    const causes = Array.isArray(exp.causes) ? exp.causes : [];
    let html = '<div class="in-explain">' +
      '<div class="in-verdict">' + esc(exp.verdict || '') + '</div>';
    if (causes.length) {
      html += '<div class="in-subhead">POSSIBLE CAUSES — recorded in the same window, none asserted as the reason</div>';
      html += causes.map(causeRow).join('');
    }
    html += '</div>';
    return html;
  }

  function signalRow(s) {
    const cls = s.confidence === 'strong' ? 'in-conf-strong' : s.confidence === 'moderate' ? 'in-conf-moderate' : 'in-conf-weak';
    return '<div class="in-row in-signal">' +
      '<div class="in-rowhead">' +
        '<span class="in-kind">' + esc(String(s.kind || '')) + '</span>' +
        '<span class="in-chip ' + cls + '">' + esc(String(s.confidence || 'weak').toUpperCase()) + '</span>' +
        '<span class="in-chip in-ev">' + esc(String(s.evidence || 'unknown').toUpperCase()) + '</span>' +
      '</div>' +
      '<div class="in-rowbody">' + esc(s.text) + '</div>' +
    '</div>';
  }

  /* ONE PORTFOLIO ROW. `coverage` and `missing` are rendered explicitly — the count of businesses that
     actually reported is the fact that makes the total mean anything. */
  function portfolioRow(m) {
    const contribs = Array.isArray(m.contributors) ? m.contributors : [];
    const shown = contribs.slice(0, 12);
    const body = shown.map(c =>
      '<span class="in-contrib' + (c.value == null ? ' in-missing' : '') + '">' +
        esc(c.businessId) + ' ' + (c.value == null ? '—' : fmtHtml(c.value, m.unit)) +
      '</span>'
    ).join('');
    return '<div class="in-row in-port">' +
      '<div class="in-rowhead">' +
        '<span class="in-metric">' + esc(m.label) + '</span>' +
        '<span class="in-spacer"></span>' +
        '<span class="in-total">' + (m.unit === 'rate'
          ? 'mean ' + fmtHtml(m.mean, m.unit)
          : 'total ' + fmtHtml(m.total, m.unit)) + '</span>' +
      '</div>' +
      '<div class="in-rowbody">' +
        '<span class="in-sub">' + esc(m.coverage) + ' of ' + esc(contribs.length) + ' businesses reported' +
        (m.missing ? ' · ' + esc(m.missing) + ' missing' : '') + '</span>' +
        '<div class="in-contribs">' + body + '</div>' +
      '</div>' +
    '</div>';
  }

  function modelRow(r) {
    const m = r.model || {};
    const est = r.estimate || {};
    const price = m.priced
      ? '$' + esc(m.priceIn) + ' / $' + esc(m.priceOut) + ' per Mtok'
      : (m.unmetered ? 'subscription — no per-token charge' : 'no list price known');
    const caps = [];
    if (m.supportsTools) caps.push('tools');
    if (m.supportsReasoning) caps.push('reasoning');
    if (m.supportsVision) caps.push('vision');
    return '<div class="in-row in-model">' +
      '<div class="in-rowhead">' +
        '<span class="in-metric">' + esc(m.name || m.id) + '</span>' +
        '<span class="in-chip in-score">' + esc(r.score) + '</span>' +
        '<span class="in-spacer"></span>' +
        '<span class="in-sub">' + esc(m.provider || '') + '</span>' +
      '</div>' +
      '<div class="in-rowbody">' +
        esc(price) +
        (caps.length ? ' · ' + esc(caps.join(', ')) : '') +
        (m.contextLength ? ' · ' + esc(Math.round(m.contextLength / 1000)) + 'k ctx' : '') +
        (est.usd != null ? ' · <b>' + esc(fmtUsd(est.usd)) + '</b> for this run' : '') +
      '</div>' +
    '</div>';
  }

  function fmtUsd(n) {
    const v = Number(n);
    if (!isFinite(v)) return '—';
    if (v === 0) return '$0';
    if (v < 0.01) return '$' + v.toFixed(6);
    if (v < 1) return '$' + v.toFixed(4);
    return '$' + v.toFixed(2);
  }

  /* ONE COST RECOMMENDATION. The caveat is rendered INLINE, not behind a tooltip — a number this actionable
     must carry its own qualification where it is read, or it will be read without it. */
  function recommendationRow(r) {
    return '<div class="in-row in-rec">' +
      '<div class="in-rowhead">' +
        '<span class="in-metric">' + esc(r.from.name || r.from.id) + ' → ' + esc(r.to.name || r.to.id) + '</span>' +
        '<span class="in-spacer"></span>' +
        '<span class="in-chip in-save">−' + esc(fmtUsd(r.estimatedSavingUsd)) + '</span>' +
      '</div>' +
      '<div class="in-rowbody">' +
        esc(r.runs) + ' runs · ' + esc(r.tokens) + ' tokens · ' + esc(fmtUsd(r.from.usd)) + ' → ' + esc(fmtUsd(r.estimatedUsd)) +
        '<div class="in-sub">capabilities preserved: ' + esc(r.capabilitiesPreserved) + '</div>' +
        '<div class="in-caveat">' + esc(r.caveat) + '</div>' +
      '</div>' +
    '</div>';
  }

  function blindSpotRow(b) {
    return '<div class="in-row in-blind">' +
      '<div class="in-rowhead"><span class="in-metric">' + esc(b.model) + '</span>' +
        '<span class="in-spacer"></span><span class="in-sub">' + esc(fmtUsd(b.usd)) + '</span></div>' +
      '<div class="in-rowbody">' + esc(b.reason) + '</div>' +
    '</div>';
  }

  /* THE HEADLINE. The digest's own sentence, quoted verbatim — it is the engine's summary, and paraphrasing
     it here would put a second, unchecked claim on screen. */
  function headlineHtml(digest) {
    if (!digest) return '';
    return '<div class="in-headline"><span class="in-hl-label">HEADLINE</span> ' + esc(digest.headline) + '</div>';
  }

  /* COUNT LINE. States what the panel actually has, including the empty case — a console that renders an
     empty list with no explanation reads as "nothing is wrong" when it may mean "nothing is recorded". */
  function countLine(n, thing, emptyText) {
    if (!n) return '<p class="in-empty">' + esc(emptyText) + '</p>';
    return '<p class="in-sub in-count">' + esc(n) + ' ' + esc(thing) + (n === 1 ? '' : 's') + '</p>';
  }

  // ---- validation (mirrors the server) ---------------------------------------------------------------

  /* The model-router question form. Validated client-side so a malformed ask never hits the network — and
     the rules mirror the route's own, so the two cannot disagree about what a valid question is. */
  function validateRouteForm(f) {
    f = f || {};
    const tokensIn = Number(f.tokensIn);
    const tokensOut = Number(f.tokensOut);
    if (!isFinite(tokensIn) || !isFinite(tokensOut) || tokensIn < 0 || tokensOut < 0) {
      return { ok: false, reason: 'token counts must be numbers zero or more' };
    }
    if (!tokensIn && !tokensOut) return { ok: false, reason: 'give at least a rough token count — a price needs one' };
    if (tokensIn + tokensOut > 100000000) return { ok: false, reason: 'that is larger than any context window' };
    const prefer = String(f.prefer || 'balanced');
    if (['cost', 'quality', 'speed', 'balanced'].indexOf(prefer) < 0) {
      return { ok: false, reason: 'unknown preference: ' + prefer };
    }
    return {
      ok: true,
      task: {
        needs: {
          tools: !!f.tools, reasoning: !!f.reasoning, vision: !!f.vision,
          minContext: Number(f.minContext) || 0
        },
        prefer: prefer,
        tokensIn: Math.floor(tokensIn),
        tokensOut: Math.floor(tokensOut)
      }
    };
  }

  /* PRICE A RUN. The AI COST panel reviews what WAS spent; this answers the forward-looking question the
     optimizer already supports and nothing in the UI ever asked: "what would a run of N tokens cost on each
     catalogued model?" Same honesty rule as everything else here — an unpriced model reports null and is
     rendered as such, never as $0 (a free-looking model that is merely unpriced is the expensive mistake).

     Pure (no DOM, no clock): the panel calls it after the route responds. `rows` keeps the engine's own order
     because the panel groups priced vs unpriced rather than re-sorting, so what is read back matches what the
     route returned. */
  function shapePricing(raw) {
    raw = raw || {};
    const models = (Array.isArray(raw.models) ? raw.models : []).map(m => ({
      id: String(m.id || ''),
      name: String(m.name || m.id || ''),
      provider: String(m.provider || ''),
      priced: !!m.priced,
      usd: (m.usd == null || !isFinite(Number(m.usd))) ? null : Number(m.usd),
      usdText: (m.usd == null || !isFinite(Number(m.usd))) ? 'unpriced' : fmtUsd(Number(m.usd)),
      perMTokText: fmtUsd(m.perMTok)
    }));
    return {
      tokensIn: raw.tokensIn == null ? null : Number(raw.tokensIn),
      tokensOut: raw.tokensOut == null ? null : Number(raw.tokensOut),
      cheapest: raw.cheapest ? { name: String(raw.cheapest.name || raw.cheapest.id || ''), usdText: fmtUsd(raw.cheapest.usd) } : null,
      dearest: raw.dearest ? { name: String(raw.dearest.name || raw.dearest.id || ''), usdText: fmtUsd(raw.dearest.usd) } : null,
      spreadText: (raw.spreadUsd == null || !isFinite(Number(raw.spreadUsd))) ? '' : fmtUsd(Number(raw.spreadUsd)),
      models: models
    };
  }

  // ================================ DOM HALF ================================
  function apiFetch(path, opts) {
    const o = opts || {};
    const init = { method: o.method || 'GET' };
    init.headers = Object.assign({ 'Accept': 'application/json' }, o.headers || {});
    if (o.body) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(o.body);
    }
    return fetch(path, init).then(r => r.json().catch(() => ({ ok: false, reason: 'the response was not JSON' })));
  }

  function mount(body) {
    const host = typeof body === 'string' ? document.getElementById(body) : body;
    if (!host) return null;
    const now = () => Date.now();

    host.innerHTML = '' +
      '<div class="in-wrap">' +
        '<div class="in-head">' +
          '<h3 class="in-title">INTELLIGENCE</h3>' +
          '<span class="in-sub" id="in-scope">—</span>' +
          '<span class="in-spacer"></span>' +
          '<button class="in-btn" id="in-refresh" data-hint="intelligence">REFRESH</button>' +
        '</div>' +
        '<div class="in-tabs">' +
          '<button class="in-tab in-on" data-tab="digest" data-hint="intelligence">WHAT MOVED</button>' +
          '<button class="in-tab" data-tab="portfolio" data-hint="portfolio">PORTFOLIO</button>' +
          '<button class="in-tab" data-tab="signals" data-hint="signal">SIGNALS</button>' +
          '<button class="in-tab" data-tab="models" data-hint="intelligence">MODELS</button>' +
          '<button class="in-tab" data-tab="costs" data-hint="intelligence">AI COST</button>' +
        '</div>' +
        '<div class="in-panels">' +
          '<div class="in-panel in-on" id="in-panel-digest"></div>' +
          '<div class="in-panel" id="in-panel-portfolio"></div>' +
          '<div class="in-panel" id="in-panel-signals"></div>' +
          '<div class="in-panel" id="in-panel-models"></div>' +
          '<div class="in-panel" id="in-panel-costs"></div>' +
        '</div>' +
      '</div>';

    const state = { businessId: '', tab: 'digest', digest: null, costs: null, pricing: null };

    function panel(id) { return host.querySelector('#in-panel-' + id); }
    function say(id, html) { const p = panel(id); if (p) p.innerHTML = html; }
    function busy(id, text) { say(id, '<p class="in-loading">' + esc(text || 'loading…') + '</p>'); }

    function showTab(tab) {
      state.tab = tab;
      const tabs = host.querySelectorAll('.in-tab');
      for (const t of tabs) t.classList.toggle('in-on', t.getAttribute('data-tab') === tab);
      const panels = host.querySelectorAll('.in-panel');
      for (const p of panels) p.classList.toggle('in-on', p.id === 'in-panel-' + tab);
      load(tab);
    }

    for (const t of host.querySelectorAll('.in-tab')) {
      t.addEventListener('click', () => showTab(t.getAttribute('data-tab')));
    }
    const refresh = host.querySelector('#in-refresh');
    if (refresh) refresh.addEventListener('click', () => load(state.tab));

    // ---- businesses ---------------------------------------------------------------------------------
    /* The business picker. An empty businessId is REFUSED rather than read as "everything" (P6), so the
       per-business panels are simply unavailable until one is chosen — and they say why, instead of
       rendering a cross-business aggregate under a per-business heading. */
    function loadBusinesses() {
      return apiFetch('/api/businesses').then(res => {
        const rows = Array.isArray(res) ? res : (Array.isArray(res && res.businesses) ? res.businesses : []);
        if (!rows.length) { state.businessId = ''; return rows; }
        if (!state.businessId) state.businessId = String(rows[0].id || '');
        return rows;
      }).catch(() => []);
    }

    function renderScope(rows) {
      const el = host.querySelector('#in-scope');
      if (!el) return;
      if (!rows.length) { el.textContent = 'no businesses yet — per-business panels need one'; return; }
      const sel = document.createElement('select');
      sel.className = 'in-select';
      sel.setAttribute('data-hint', 'business');
      for (const b of rows) {
        const o = document.createElement('option');
        o.value = String(b.id || '');
        o.textContent = String((b && (b.name || b.title || b.id)) || '');
        if (o.value === state.businessId) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener('change', () => { state.businessId = sel.value; state.costs = null; state.pricing = null; load(state.tab); });
      el.innerHTML = '';
      el.appendChild(document.createTextNode('business '));
      el.appendChild(sel);
    }

    // ---- panels -------------------------------------------------------------------------------------

    function loadDigest() {
      if (!state.businessId) {
        say('digest', '<p class="in-empty">No business selected. WHAT MOVED, SIGNALS and the explainer are per-business reads — create a business first.</p>');
        return Promise.resolve();
      }
      busy('digest', 'reading what changed…');
      return apiFetch('/api/businesses/' + encodeURIComponent(state.businessId) + '/intelligence')
        .then(res => {
          if (!res || !res.ok) { say('digest', '<p class="in-empty">' + esc((res && res.reason) || 'could not read this business') + '</p>'); return; }
          const d = res.digest;
          /* CACHE IT. The explain request needs the §11 metric ID, but a trend row renders its LABEL — so the
             label→id map lives in the digest we just received. Without this the click handler could not know
             which metric to ask about. */
          lastDigest = d;
          state.digest = d;
          const moved = (d.trends || []).filter(t => t.direction !== 'unknown' && t.direction !== 'flat');
          const rest = (d.trends || []).filter(t => !(t.direction !== 'unknown' && t.direction !== 'flat'));
          let html = headlineHtml(d);
          html += countLine(moved.length, 'metric moved', 'No metric recorded a meaningful change yet. Record readings under MANAGER → metrics first.');
          html += moved.map(trendRow).join('');
          if (rest.length) {
            html += '<div class="in-subhead">TRACKED, NO MEANINGFUL MOVE</div>';
            html += rest.map(trendRow).join('');
          }
          say('digest', html);
          wireExplain();
        })
        .catch(e => say('digest', '<p class="in-empty">could not read the digest: ' + esc((e && e.message) || e) + '</p>'));
    }

    /* Clicking a metric asks for its explanation. The request is per-metric and the answer is rendered
       beneath the row, so a user sees the change AND what else was recorded without leaving the panel. */
    function wireExplain() {
      for (const row of host.querySelectorAll('#in-panel-digest .in-trend')) {
        const name = row.querySelector('.in-metric');
        if (!name) continue;
        const label = name.textContent;
        row.classList.add('in-clickable');
        row.addEventListener('click', () => {
          for (const r of host.querySelectorAll('#in-panel-digest .in-trend.in-open')) {
            r.classList.remove('in-open');
            const extra = r.querySelector('.in-explain');
            if (extra) extra.remove();
          }
          row.classList.add('in-open');
          const metric = metricIdFor(label);
          if (!metric) return;
          const wait = document.createElement('div');
          wait.className = 'in-explain in-loading';
          wait.textContent = 'looking for what else was recorded in this window…';
          row.appendChild(wait);
          apiFetch('/api/businesses/' + encodeURIComponent(state.businessId) + '/intelligence/explain?metric=' + encodeURIComponent(metric))
            .then(res => {
              wait.remove();
              if (!res || !res.ok) {
                const err = document.createElement('div');
                err.className = 'in-explain';
                err.textContent = (res && res.reason) || 'could not explain this metric';
                row.appendChild(err);
                return;
              }
              row.insertAdjacentHTML('beforeend', causesHtml(res.explanation));
            })
            .catch(e => { wait.remove(); });
        });
      }
    }

    // label -> §11 metric id. Built from the digest we already hold, so it never drifts from the server.
    function metricIdFor(label) {
      const d = state.digest;
      const rows = (d && d.trends) || [];
      for (const t of rows) if (t.label === label) return t.metric;
      for (const row of host.querySelectorAll('#in-panel-digest .in-trend')) {
        if (row.querySelector('.in-metric') && row.querySelector('.in-metric').textContent === label) {
          const idx = Array.prototype.indexOf.call(host.querySelectorAll('#in-panel-digest .in-trend'), row);
          const live = (lastDigest && lastDigest.trends) ? lastDigest.trends[idx] : null;
          if (live) return live.metric;
        }
      }
      return null;
    }

    let lastDigest = null;

    function loadPortfolio() {
      busy('portfolio', 'aggregating every business…');
      return apiFetch('/api/intelligence/portfolio')
        .then(res => {
          if (!res || !res.ok) { say('portfolio', '<p class="in-empty">' + esc((res && res.reason) || 'could not build the portfolio') + '</p>'); return; }
          const p = res.portfolio;
          let html = '<p class="in-sub in-count">across ' + esc(p.businesses) + ' business' + (p.businesses === 1 ? '' : 'es') + '</p>';
          const rows = (p.metrics || []).filter(m => m.coverage > 0);
          if (!rows.length) {
            html += '<p class="in-empty">No business has recorded a metric yet, so there is nothing to aggregate. A portfolio total built from missing readings would be a number made of nothing.</p>';
          } else {
            html += rows.map(portfolioRow).join('');
          }
          say('portfolio', html);
        })
        .catch(e => say('portfolio', '<p class="in-empty">could not read the portfolio: ' + esc((e && e.message) || e) + '</p>'));
    }

    function loadSignals() {
      if (!state.businessId) {
        say('signals', '<p class="in-empty">No business selected — signals are read from one business\'s own recordings.</p>');
        return Promise.resolve();
      }
      busy('signals', 'watching for conditions…');
      return apiFetch('/api/businesses/' + encodeURIComponent(state.businessId) + '/signals')
        .then(res => {
          if (!res || !res.ok) { say('signals', '<p class="in-empty">' + esc((res && res.reason) || 'could not scan for signals') + '</p>'); return; }
          const rows = res.signals || [];
          let html = '<p class="in-sub">A signal is a condition the numbers actually show — an observation, never a recommendation. What you do about one stays yours.</p>';
          html += countLine(rows.length, 'signal', 'No signals right now. That means no metric moved the same way four readings running, nothing sat far outside its own range, and no experiment was left without a verdict.');
          html += rows.map(signalRow).join('');
          say('signals', html);
        })
        .catch(e => say('signals', '<p class="in-empty">could not read signals: ' + esc((e && e.message) || e) + '</p>'));
    }

    /* MODELS. Two halves: a question form ("which model should run this?") and the ranked catalog. The
       catalog size is stated, because the offline seed is small and a user must be able to tell "ten models
       known" from "no models known". */
    function loadModels() {
      busy('models', 'reading the model catalog…');
      return apiFetch('/api/intelligence/models')
        .then(res => {
          if (!res || !res.ok) { say('models', '<p class="in-empty">' + esc((res && res.reason) || 'could not read the catalog') + '</p>'); return; }
          const rows = res.models || [];
          let html = '<div class="in-form">' +
            '<div class="in-formrow">' +
              '<label class="in-lbl">tokens in <input class="in-inp" id="in-tin" type="number" min="0" value="4000"></label>' +
              '<label class="in-lbl">tokens out <input class="in-inp" id="in-tout" type="number" min="0" value="800"></label>' +
              '<label class="in-lbl">prefer ' +
                '<select class="in-select" id="in-prefer">' +
                  '<option value="balanced">balanced</option><option value="cost">cost</option>' +
                  '<option value="quality">quality</option><option value="speed">speed</option>' +
                '</select></label>' +
            '</div>' +
            '<div class="in-formrow">' +
              '<label class="in-check"><input type="checkbox" id="in-tools"> needs tools</label>' +
              '<label class="in-check"><input type="checkbox" id="in-reason"> needs reasoning</label>' +
              '<label class="in-check"><input type="checkbox" id="in-vision"> needs vision</label>' +
              '<button class="in-btn" id="in-route">ROUTE THIS</button>' +
            '</div>' +
            '<div class="in-sub" id="in-routeout">asked nothing yet</div>' +
          '</div>';
          html += '<div class="in-subhead">CATALOG — ' + esc(res.catalogSize) + ' models known' +
            (res.catalogSize < 25 ? ' (the offline seed; it grows when a provider catalog loads)' : '') +
            ' · ranked by list price as a quality proxy, never a benchmark</div>';
          html += countLine(rows.length, 'model', 'No models in the catalog satisfy the current filters.');
          html += rows.slice(0, 40).map(modelRow).join('');
          say('models', html);
          wireRoute();
        })
        .catch(e => say('models', '<p class="in-empty">could not read the catalog: ' + esc((e && e.message) || e) + '</p>'));
    }

    function wireRoute() {
      const btn = host.querySelector('#in-route');
      const out = host.querySelector('#in-routeout');
      if (!btn || !out) return;
      btn.addEventListener('click', () => {
        const v = validateRouteForm({
          tokensIn: (host.querySelector('#in-tin') || {}).value,
          tokensOut: (host.querySelector('#in-tout') || {}).value,
          prefer: (host.querySelector('#in-prefer') || {}).value,
          tools: (host.querySelector('#in-tools') || {}).checked,
          reasoning: (host.querySelector('#in-reason') || {}).checked,
          vision: (host.querySelector('#in-vision') || {}).checked,
          minContext: 0
        });
        if (!v.ok) { out.textContent = v.reason; return; }
        out.textContent = 'asking…';
        apiFetch('/api/intelligence/models/route', { method: 'POST', body: v.task })
          .then(res => {
            if (!res) { out.textContent = 'no answer'; return; }
            if (!res.ok) { out.textContent = res.reason || 'no model qualifies'; return; }
            out.innerHTML = '<b>' + esc(res.model.name || res.model.id) + '</b> — ' + esc(res.reason) +
              (res.estimate && res.estimate.usd != null ? ' · ' + esc(fmtUsd(res.estimate.usd)) : '');
          })
          .catch(e => { out.textContent = 'could not route: ' + ((e && e.message) || e); });
      });
    }

    /* AI COST. The recommendations carry their caveat inline, and the blind spots are rendered as prominently
       as the savings — a station running on subscriptions has nothing to optimise, and saying so is the
       useful answer rather than an empty panel. */
    function loadCosts() {
      busy('costs', 'reading what was spent…');
      return apiFetch('/api/intelligence/costs')
        .then(res => {
          if (!res || !res.ok) { say('costs', '<p class="in-empty">' + esc((res && res.reason) || 'could not read spend') + '</p>'); return; }
          state.costs = res.costs;
          renderCostsOnly();
        })
        .catch(e => say('costs', '<p class="in-empty">could not read spend: ' + esc((e && e.message) || e) + '</p>'));
    }

    /* The spend review body. Split out from loadCosts so re-rendering after a price-a-run does not re-fetch
       the spend — the two are independent and only one of them changed. */
    function renderCostsBody() {
      const c = state.costs || {};
      let html = '<p class="in-sub in-count">total ' + esc(fmtUsd(c.totalUsd)) + ' across ' + esc(c.totalRuns) + ' runs' +
        (c.potentialSavingUsd ? ' · up to <b>' + esc(fmtUsd(c.potentialSavingUsd)) + '</b> estimated saving identified' : '') + '</p>';
      html += countLine((c.recommendations || []).length, 'recommendation', 'No swap clears the threshold on the current spend. Nothing here changes a model automatically — switching one is yours to make.');
      html += (c.recommendations || []).map(recommendationRow).join('');
      if ((c.blindSpots || []).length) {
        html += '<div class="in-subhead">NOT PROPOSED — what this analysis cannot see</div>';
        html += c.blindSpots.map(blindSpotRow).join('');
      }
      for (const w of (c.warnings || [])) html += '<p class="in-note">' + esc(w) + '</p>';
      return html;
    }

    /* PRICE A RUN — the forward-looking question the spend review cannot answer. A run of N tokens, priced on
       every catalogued model. This is a what-if, so it is LABELLED as one and renders unpriced models as
       "unpriced" rather than folding them into a $0 that would read as the cheapest. */
    function pricingFormHtml() {
      const p = state.pricing;
      let out = '<div class="in-subhead">PRICE A RUN — what a run of N tokens would cost on each model</div>' +
        '<div class="in-priceform">' +
          '<input class="in-inp in-price-in" id="in-price-in" type="number" min="0" step="1" placeholder="tokens in" data-hint="intelligence" />' +
          '<input class="in-inp in-price-out" id="in-price-out" type="number" min="0" step="1" placeholder="tokens out" data-hint="intelligence" />' +
          '<button class="in-btn" id="in-price-go" data-hint="intelligence">PRICE IT</button>' +
        '</div>' +
        '<p class="in-note">A price needs a token count — none will be assumed. This is an estimate on the ' +
        'catalogued per-token rates, not a quote.</p>';
      if (!p) return out;
      if (!p.ok) return out + '<p class="in-empty">' + esc(p.reason || 'could not price that run') + '</p>';
      if (!p.models.length) return out + '<p class="in-empty">No models are catalogued, so there is nothing to price against.</p>';
      const priced = p.models.filter(m => m.usd !== null);
      const unpriced = p.models.filter(m => m.usd === null);
      let head = '';
      if (p.cheapest) {
        head = '<p class="in-sub in-count">cheapest ' + esc(p.cheapest.usdText) + ' on ' + esc(p.cheapest.name) +
          (p.dearest && p.dearest.name !== p.cheapest.name ? ' · dearest ' + esc(p.dearest.usdText) + ' on ' + esc(p.dearest.name) +
            (p.spreadText ? ' · spread ' + esc(p.spreadText) : '') : '') + '</p>';
      }
      const row = (m) => '<div class="in-row">' +
        '<div class="in-rowhead"><span class="in-metric">' + esc(m.name) + '</span>' +
          '<span class="in-spacer"></span><span class="in-chip">' + esc(m.usdText) + '</span></div>' +
        '<div class="in-rowbody">' + esc(m.provider) + ' · ' + esc(m.perMTokText) + '/M tok</div>' +
      '</div>';
      out += head + (priced.length ? priced.map(row).join('') : '<p class="in-empty">No catalogued model is priced, so no estimate can be made.</p>');
      if (unpriced.length) {
        out += countLine(unpriced.length, 'unpriced model', '') +
          '<div class="in-sub">unpriced — the rate is unknown, so a $0 here would read as the cheapest and would be the expensive mistake</div>' +
          unpriced.map(row).join('');
      }
      return out;
    }

    function wirePricing() {
      const go = host.querySelector('#in-price-go');
      if (!go) return;
      go.addEventListener('click', () => {
        const tin = Number((host.querySelector('#in-price-in') || {}).value);
        const tout = Number((host.querySelector('#in-price-out') || {}).value);
        /* MIRROR THE ROUTE'S OWN RULE client-side: a price with no token count is refused here rather than
           being sent and bounced, and a blank field is refused rather than coerced by Number('') to 0. */
        if ((!isFinite(tin) || tin <= 0) && (!isFinite(tout) || tout <= 0)) {
          state.pricing = { ok: false, reason: 'give at least one token count — a price needs one, and none will be assumed' };
          renderCostsOnly();
          return;
        }
        const panelEl = panel('costs');
        if (panelEl) panelEl.innerHTML = '<p class="in-loading">pricing that run…</p>';
        const body = {};
        if (isFinite(tin) && tin > 0) body.tokensIn = Math.floor(tin);
        if (isFinite(tout) && tout > 0) body.tokensOut = Math.floor(tout);
        apiFetch('/api/intelligence/costs/price', { method: 'POST', body: body })
          .then(res => {
            if (!res || !res.ok) { state.pricing = { ok: false, reason: (res && res.reason) || 'could not price that run' }; }
            else state.pricing = Object.assign({ ok: true }, shapePricing(res.pricing));
            renderCostsOnly();
          })
          .catch(e => { state.pricing = { ok: false, reason: 'could not reach the station: ' + esc((e && e.message) || e) }; renderCostsOnly(); });
      });
    }

    function renderCostsOnly() {
      const p = panel('costs');
      if (!p) return;
      const body = state.costs ? renderCostsBody()
        : '<p class="in-empty">could not read spend — the price-a-run estimate below still works off the catalogue.</p>';
      p.innerHTML = body + pricingFormHtml();
      wirePricing();
    }

    function load(tab) {
      if (tab === 'digest') return loadDigest();
      if (tab === 'portfolio') return loadPortfolio();
      if (tab === 'signals') return loadSignals();
      if (tab === 'models') return loadModels();
      if (tab === 'costs') return loadCosts();
      return Promise.resolve();
    }

    // boot
    busy('digest', 'loading…');
    return loadBusinesses().then(rows => {
      renderScope(rows);
      return load(state.tab);
    });
  }

  return {
    esc, relTime, fmt, fmtHtml, fmtUsd, fmtChange,
    directionChip, confidenceChip, trendRow, causeRow, causesHtml, signalRow,
    portfolioRow, modelRow, recommendationRow, blindSpotRow, headlineHtml, countLine,
    validateRouteForm, shapePricing, mount
  };
});
