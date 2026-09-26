/* SPACESTATION — businessmaker.js : the BUSINESS MAKER (Business OS Phase 2).

   Phase 1 built the Business COMMAND CENTER — the place you look after businesses that exist. This is the
   other half: the place you decide whether one SHOULD exist. It runs the reverse funnel from the master
   prompt, in order, and the order is the whole design:

     §22 RADAR      — the opportunity: a CLAIM SET about a business that does not exist yet.
     §4  EVIDENCE   — every claim carries how you know it. You cannot record one without saying.
     §5  VALIDATION — try to kill the idea. A verdict needs real evidence or it is refused.
     §6/§9 PLAN     — only then: pick a template, see the task plan, and PROMOTE it into a business.

   WHAT THIS MODULE REFUSES TO DO, and why each refusal is the feature:
     · It does not score opportunities. There is no "opportunity score" here because a score would be an
       invented number dressed as analysis (P2). What it shows instead is a COUNT of claims per evidence
       class and a COUNT of §4 fields still empty. Both are checkable; a reader draws their own conclusion.
     · It does not let a claim be saved unlabelled. The evidence picker has NO default — it opens on
       "— pick a label —", and the sidecar refuses the write with a 422 that this module renders verbatim.
       The guard lives in the store; this surface only refuses to hide it.
     · It does not soften a refused verdict. "Cannot mark a run supported without verified or analysis
       evidence" is shown as-is, because that sentence IS the product working.
     · It does not block a promotion on thin evidence. It says what evidence exists and then does what you
       said (P5/§32: the user is the authority). Inventing a validation threshold would be the fake
       intelligence P7 forbids.

   TWO HALVES, ON PURPOSE — the pure half (labels, row shaping, guards, plan rendering) is UMD and
   Node-loadable so it is unit-tested headless; only mount() needs a DOM, and it degrades to a no-op. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.BusinessMaker = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ---- P1's vocabulary, mirrored from opportunities-store.js. Order is strongest-first. ----
  const EVIDENCE = ['verified', 'analysis', 'assumption', 'estimate', 'prediction', 'unknown'];
  const EVIDENCE_LABEL = {
    verified: 'VERIFIED', analysis: 'ANALYSIS', assumption: 'ASSUMPTION',
    estimate: 'ESTIMATE', prediction: 'PREDICTION', unknown: 'UNKNOWN'
  };
  // the one-line meaning of each class, shown next to the picker so the choice is informed rather than a guess.
  const EVIDENCE_HINT = {
    verified: 'sourced and checkable',
    analysis: 'reasoning over verified inputs',
    assumption: 'taken as true without proof',
    estimate: 'approximate, with a stated method',
    prediction: 'forward-looking and uncertain',
    unknown: 'explicitly not known'
  };

  // ---- §4's twelve fields, mirrored from opportunities-store.js. ----
  const FIELDS = [
    'problem', 'targetCustomer', 'proposedSolution', 'existingAlternatives', 'competition',
    'businessModel', 'requiredResources', 'startupComplexity', 'revenueModel',
    'risks', 'unknowns', 'validationRequirements'
  ];
  const FIELD_LABEL = {
    problem: 'PROBLEM', targetCustomer: 'TARGET CUSTOMER', proposedSolution: 'PROPOSED SOLUTION',
    existingAlternatives: 'EXISTING ALTERNATIVES', competition: 'COMPETITION', businessModel: 'BUSINESS MODEL',
    requiredResources: 'REQUIRED RESOURCES', startupComplexity: 'STARTUP COMPLEXITY', revenueModel: 'REVENUE MODEL',
    risks: 'RISKS', unknowns: 'UNKNOWNS', validationRequirements: 'VALIDATION REQUIREMENTS'
  };
  // what each field is asking for — shown as the placeholder, so an empty cell is a prompt not a void.
  const FIELD_PROMPT = {
    problem: 'What problem does this solve, and for whom?',
    targetCustomer: 'Who exactly is the customer?',
    proposedSolution: 'What is being proposed, in one or two sentences?',
    existingAlternatives: 'What do people use today instead?',
    competition: 'Who else is already doing this?',
    businessModel: 'How does it make money?',
    requiredResources: 'What does it take to start — time, money, skills, tools?',
    startupComplexity: 'How hard is this to build and run, honestly?',
    revenueModel: 'What is charged, how much, and how often?',
    risks: 'What could make this fail?',
    unknowns: 'What do we genuinely not know yet?',
    validationRequirements: 'What would have to be TRUE for this to be worth building?'
  };

  // ---- the opportunity lifecycle, mirrored from opportunities-store.js. ----
  const STAGES = ['draft', 'researching', 'ready', 'validating', 'validated', 'rejected', 'promoted', 'archived'];
  const STAGE_LABEL = {
    draft: 'DRAFT', researching: 'RESEARCHING', ready: 'READY', validating: 'VALIDATING',
    validated: 'VALIDATED', rejected: 'REJECTED', promoted: 'PROMOTED', archived: 'ARCHIVED'
  };

  // ---- §5's thirteen tools, mirrored from validation-store.js. ----
  const METHODS = [
    'competitor-research', 'customer-research', 'search-trend-research', 'pricing-research',
    'review-analysis', 'community-discussion-analysis', 'landing-page-test', 'waitlist-test',
    'survey', 'mvp-test', 'keyword-research', 'market-size-research', 'problem-validation'
  ];
  const METHOD_LABEL = {
    'competitor-research': 'Competitor research', 'customer-research': 'Customer research',
    'search-trend-research': 'Search-trend research', 'pricing-research': 'Pricing research',
    'review-analysis': 'Review analysis', 'community-discussion-analysis': 'Community discussion analysis',
    'landing-page-test': 'Landing-page test', 'waitlist-test': 'Waitlist test', survey: 'Survey',
    'mvp-test': 'MVP test', 'keyword-research': 'Keyword research', 'market-size-research': 'Market-size research',
    'problem-validation': 'Problem validation'
  };

  const VERDICTS = ['pending', 'inconclusive', 'supported', 'contradicted'];
  const VERDICT_LABEL = {
    pending: 'PENDING', inconclusive: 'INCONCLUSIVE', supported: 'SUPPORTED', contradicted: 'CONTRADICTED'
  };

  function label(map, v, fallback) { return map[String(v == null ? '' : v)] || fallback; }
  const evidenceLabel = (e) => label(EVIDENCE_LABEL, e, 'UNKNOWN');
  const fieldLabel = (f) => label(FIELD_LABEL, f, String(f || '').toUpperCase());
  const stageLabel = (s) => label(STAGE_LABEL, s, 'UNKNOWN');
  const methodLabel = (m) => label(METHOD_LABEL, m, String(m || ''));
  const verdictLabel = (v) => label(VERDICT_LABEL, v, 'UNKNOWN');
  const evidenceHint = (e) => String(EVIDENCE_HINT[String(e == null ? '' : e)] || '');

  function relTime(ms, nowMs) {
    if (!ms) return '';
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

  // ---- option builders. The evidence picker deliberately has NO default: an unlabelled claim is not a
  //      thing you can submit by accident, so the first option is the empty "pick a label" prompt.
  function evidenceOptions(current) {
    const cur = String(current == null ? '' : current);
    const out = [{ value: '', label: '— pick a label —', selected: !cur }];
    for (const e of EVIDENCE) out.push({ value: e, label: evidenceLabel(e), selected: e === cur });
    return out;
  }
  function methodOptions(current) {
    const cur = String(current == null ? '' : current);
    // Unlike the evidence picker, this one DOES default: a method is a choice of tool, not an epistemic
    // claim, so pre-selecting the first is a convenience rather than a way to record an unlabelled fact.
    const has = cur && METHODS.indexOf(cur) >= 0;
    return METHODS.map((m, i) => ({ value: m, label: methodLabel(m), selected: has ? m === cur : i === 0 }));
  }
  function verdictOptions(current) {
    const cur = String(current == null ? '' : current);
    return VERDICTS.map(v => ({ value: v, label: verdictLabel(v), selected: v === cur }));
  }
  function stageOptions(current) {
    const cur = String(current == null ? '' : current);
    return STAGES.map(s => ({ value: s, label: stageLabel(s), selected: s === cur }));
  }

  // ---- counts, never scores ---------------------------------------------------------------------
  // How many filled claims sit in each evidence class. Uses the server's mix when present, otherwise
  // derives it from the fields — the derivation is the same count either way.
  function evidenceMix(opp) {
    const mix = {};
    for (const e of EVIDENCE) mix[e] = 0;
    if (!opp) return mix;
    if (opp.evidenceMix && typeof opp.evidenceMix === 'object') {
      for (const e of EVIDENCE) if (typeof opp.evidenceMix[e] === 'number') mix[e] = opp.evidenceMix[e];
      return mix;
    }
    const fields = opp.fields || {};
    for (const f of FIELDS) {
      const c = fields[f] || {};
      if (c.text) mix[EVIDENCE.indexOf(c.evidence) >= 0 ? c.evidence : 'unknown']++;
    }
    return mix;
  }

  function completeness(opp) {
    if (opp && opp.completeness && typeof opp.completeness.filled === 'number') {
      return { filled: opp.completeness.filled, total: opp.completeness.total || FIELDS.length, ready: !!opp.completeness.ready };
    }
    const fields = (opp && opp.fields) || {};
    let filled = 0;
    for (const f of FIELDS) if ((fields[f] || {}).text) filled++;
    return { filled: filled, total: FIELDS.length, ready: filled === FIELDS.length };
  }

  function missingFields(opp) {
    if (opp && Array.isArray(opp.missing)) return opp.missing.slice();
    const fields = (opp && opp.fields) || {};
    return FIELDS.filter(f => !(fields[f] || {}).text);
  }

  // the chips the radar row shows: only the classes that actually have something in them. An all-zero mix
  // renders as the explicit "no claims yet" line instead of six zero chips.
  function mixChips(opp) {
    const mix = evidenceMix(opp);
    return EVIDENCE.filter(e => mix[e] > 0).map(e => ({ cls: e, label: evidenceLabel(e), count: mix[e] }));
  }

  function toRows(opps, nowMs) {
    return (Array.isArray(opps) ? opps : []).map(function (o) {
      o = o || {};
      const stage = String(o.stage || 'draft');
      const comp = completeness(o);
      return {
        id: String(o.id || ''),
        title: String(o.title || '(untitled)'),
        stage: stage,
        stageLabel: stageLabel(stage),
        template: String(o.template || 'custom'),
        origin: o.origin === 'ai' ? 'ai' : 'user',
        originLabel: o.origin === 'ai' ? 'AI-PROPOSED' : 'YOURS',
        filled: comp.filled,
        total: comp.total,
        ready: comp.ready,
        completenessLabel: comp.filled + '/' + comp.total,
        chips: mixChips(o),
        promoted: stage === 'promoted',
        businessId: String(o.businessId || ''),
        updatedRel: relTime(o.updatedAt, nowMs),
        guard: promoteGuard(o)
      };
    });
  }

  // ---- the §4 field table for one opportunity ---------------------------------------------------
  function fieldRows(opp) {
    const fields = (opp && opp.fields) || {};
    return FIELDS.map(function (f) {
      const c = fields[f] || {};
      const text = String(c.text || '');
      return {
        key: f,
        label: fieldLabel(f),
        prompt: String(FIELD_PROMPT[f] || ''),
        text: text,
        evidence: text ? String(c.evidence || 'unknown') : '',
        evidenceLabel: text ? evidenceLabel(c.evidence) : '—',
        source: String(c.source || ''),
        filled: !!text
      };
    });
  }

  // "3 of 12 fields · 2 assumptions, 1 estimate · 9 still missing" — all counts, no judgement.
  function completenessLine(opp) {
    const comp = completeness(opp);
    const missing = missingFields(opp);
    const bits = [comp.filled + ' of ' + comp.total + ' fields'];
    const chips = mixChips(opp);
    if (chips.length) bits.push(chips.map(c => c.count + ' ' + c.label.toLowerCase()).join(', '));
    else bits.push('no claims yet');
    if (missing.length) bits.push(missing.length + ' still missing');
    return bits.join(' · ');
  }

  // ---- validation rows --------------------------------------------------------------------------
  function validationRows(runs, nowMs) {
    return (Array.isArray(runs) ? runs : []).map(function (r) {
      r = r || {};
      const evidence = Array.isArray(r.evidence) ? r.evidence : [];
      return {
        id: String(r.id || ''),
        seq: (typeof r.seq === 'number') ? r.seq : 0,
        method: String(r.method || ''),
        methodLabel: methodLabel(r.method),
        hypothesis: String(r.hypothesis || ''),
        verdict: String(r.verdict || 'pending'),
        verdictLabel: verdictLabel(r.verdict),
        evidenceCount: evidence.filter(e => e && e.text).length,
        gradedCount: evidence.filter(e => e && e.text && (e.evidence === 'verified' || e.evidence === 'analysis')).length,
        supporting: (Array.isArray(r.supporting) ? r.supporting : []).length,
        contradicting: (Array.isArray(r.contradicting) ? r.contradicting : []).length,
        nextTest: String(r.nextTest || ''),
        rel: relTime(r.at, nowMs),
        decided: !!r.decidedAt
      };
    });
  }

  function validationSummaryLine(sum) {
    if (!sum || !sum.total) return 'Nothing tested yet — open a run to try to kill this idea.';
    const bits = [sum.total + (sum.total === 1 ? ' run' : ' runs')];
    if (sum.supported) bits.push(sum.supported + ' supported');
    if (sum.contradicted) bits.push(sum.contradicted + ' contradicted');
    if (sum.inconclusive) bits.push(sum.inconclusive + ' inconclusive');
    if (sum.pending) bits.push(sum.pending + ' pending');
    return bits.join(' · ');
  }

  // ---- the plan preview -------------------------------------------------------------------------
  function planRows(plan) {
    const tasks = (plan && Array.isArray(plan.tasks)) ? plan.tasks : [];
    return tasks.map(function (t, i) {
      t = t || {};
      return {
        n: i + 1,
        title: String(t.title || ''),
        stage: String(t.stage || ''),
        stageLabel: String(t.stageLabel || ''),
        priority: String(t.priority || 'normal'),
        // P1 in the UI: the effort is rendered with its label attached, never as a bare number.
        effortLabel: (t.effort && typeof t.effort.hours === 'number')
          ? ('est. ' + t.effort.hours + 'h') : '',
        approvalRequired: !!t.approvalRequired
      };
    });
  }

  function planSummary(plan) {
    const tasks = (plan && Array.isArray(plan.tasks)) ? plan.tasks : [];
    if (!tasks.length) return '';
    // Sum from the NUMBERS, never by re-parsing the display label: 'est. 6h' stripped of non-numerics
    // leaves '.6' (the dot is kept), which silently totals 0.6h per task instead of 6.
    let hours = 0;
    let approvals = 0;
    for (const t of tasks) {
      if (t && t.effort && typeof t.effort.hours === 'number') hours += t.effort.hours;
      if (t && t.approvalRequired) approvals++;
    }
    const bits = [tasks.length + ' tasks', 'est. ' + Math.round(hours) + 'h total'];
    if (approvals) bits.push(approvals + ' need your approval');
    return bits.join(' · ');
  }

  /* Parse the validation editor's evidence box: one item per line as "<label>: <text>". A line with no
     recognised label is REFUSED here rather than sent unlabelled, so the user learns the rule before the
     server has to say it. PURE, so it is unit-tested headless — the DOM half only reads the textarea. */
  function parseEvidenceLines(raw) {
    const out = { ok: true, items: [] };
    const lines = String(raw || '').split('\n').map(s => s.trim()).filter(Boolean);
    for (const line of lines) {
      const i = line.indexOf(':');
      if (i < 0) { out.ok = false; out.bad = line; return out; }
      const cls = line.slice(0, i).trim().toLowerCase();
      const text = line.slice(i + 1).trim();
      if (EVIDENCE.indexOf(cls) < 0 || !text) { out.ok = false; out.bad = line; return out; }
      out.items.push({ text: text, evidence: cls });
    }
    return out;
  }
  const splitLines = (raw) => String(raw || '').split('\n').map(s => s.trim()).filter(Boolean);

  // ---- the promote guard (P5: the user decides, but the button must not lie) ---------------------
  function promoteGuard(opp) {
    const stage = String((opp && opp.stage) || 'draft');
    if (stage === 'promoted') {
      return { allowed: false, reason: 'Already promoted — this opportunity is a business now.' };
    }
    return { allowed: true, reason: '' };
  }

  function summaryLine(opps) {
    const list = Array.isArray(opps) ? opps : [];
    if (!list.length) return 'No opportunities yet — open one to start evaluating an idea.';
    const promoted = list.filter(o => o && o.stage === 'promoted').length;
    const bits = [list.length + (list.length === 1 ? ' opportunity' : ' opportunities')];
    if (promoted) bits.push(promoted + ' promoted');
    bits.push((list.length - promoted) + ' still under evaluation');
    return bits.join(' · ');
  }

  /* ================= DOM half — the maker console ================= */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  // one request helper; the Response is kept in scope and r.ok read, so a plain-text 403 or a proxy HTML
  // page can never collapse into {} and render as success. Mirrors businesscenter.js.
  function request(method, path, body) {
    const init = { method: method, cache: 'no-store' };
    if (body !== undefined) { init.headers = { 'Content-Type': 'application/json' }; init.body = JSON.stringify(body == null ? {} : body); }
    return fetch(path, init).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; })
        .catch(function () { return { ok: r.ok, status: r.status, j: {} }; });
    });
  }

  function errText(r, fallback) {
    const j = r && r.j;
    if (j && typeof j.error === 'string' && j.error) return j.error;
    if (r && r.status) return fallback + ' (HTTP ' + r.status + ')';
    return fallback;
  }

  let live = null;
  let busWired = false;
  let refreshTimer = null;
  function scheduleRefresh() {
    if (!live || refreshTimer) return;
    refreshTimer = setTimeout(function () { refreshTimer = null; if (live) { try { live.refresh(); } catch (_) {} } }, 200);
  }
  function wireBus() {
    if (busWired) return;
    busWired = true;
    if (typeof U === 'undefined' || !U.bus || typeof U.bus.on !== 'function') return;
    const names = ['opportunity.created', 'opportunity.updated', 'opportunity.deleted', 'opportunity.promoted',
      'validation.recorded', 'business.created', 'task.created'];
    for (const n of names) { try { U.bus.on(n, scheduleRefresh); } catch (_) {} }
  }

  function mount(body) {
    if (typeof document === 'undefined' || !body) return null;
    const SUI = (typeof StationUI !== 'undefined') ? StationUI : null;
    if (!SUI || !SUI.h || typeof SUI.h.mountConsole !== 'function') return null;

    const panes = {};
    SUI.h.mountConsole(body, 'maker', [
      {
        id: 'radar', label: 'RADAR', glyph: '◎',
        desc: 'Opportunities under evaluation. Each shows how many of the twelve planning fields are filled and how many claims sit in each evidence class — counts, never a score, because a score would be an invented number.',
        build: function (p) { panes.radar = p; }
      },
      {
        id: 'evidence', label: 'EVIDENCE', glyph: '▤',
        desc: 'The twelve fields of the selected opportunity. Every claim must carry a label saying how you know it — verified, analysis, assumption, estimate, prediction, or explicitly unknown. A claim with no label is refused.',
        build: function (p) { panes.evidence = p; }
      },
      {
        id: 'validation', label: 'VALIDATION', glyph: '⚗',
        desc: 'Try to kill the idea. Open a run against one question, then record what came back. A run can be marked SUPPORTED or CONTRADICTED only with verified or analysis evidence plus a matching signal — assumptions cannot carry a verdict.',
        build: function (p) { panes.validation = p; }
      },
      {
        id: 'plan', label: 'PLAN & PROMOTE', glyph: '⤴',
        desc: 'Preview the task plan for a business template, then promote the opportunity into a real business with that plan already materialised into tasks.',
        build: function (p) { panes.plan = p; }
      }
    ], { search: false });

    const state = {
      opportunities: [], validations: [], selected: '', selectedRun: '',
      templates: [], plan: null, planSource: '', planError: '',
      goal: '', error: '', notice: '', busy: false
    };

    /* Two-press confirmation, the house pattern. An OS modal (window.confirm) over the phosphor terminal is
       banned — test/station-tooltip.test.js enforces it — and armconfirm.js is the shared helper.
       FAIL-CLOSED: if ArmConfirm is somehow absent the control is DISABLED rather than falling back to a
       native dialog or firing unconfirmed. A destructive button that cannot ask is a button that must not act. */
    function arm(btn, label, onConfirm) {
      if (!btn) return;
      if (typeof ArmConfirm === 'undefined' || typeof ArmConfirm.wire !== 'function') {
        btn.disabled = true;
        btn.title = 'confirmation helper unavailable — refusing to act unconfirmed';
        return;
      }
      ArmConfirm.wire(btn, { armedLabel: label, onConfirm: onConfirm });
    }

    function selectedOpp() { return state.opportunities.filter(o => o && o.id === state.selected)[0] || null; }

    // ---- RADAR ----
    function renderRadar() {
      const p = panes.radar; if (!p) return;
      const rows = toRows(state.opportunities, Date.now());
      let html = '<div class="bm-sum">' + esc(summaryLine(state.opportunities)) + '</div>';
      if (state.error) html += '<div class="bm-err">' + esc(state.error) + '</div>';
      if (!rows.length) {
        html += '<p class="bm-empty">No opportunities yet. Add one below to start evaluating an idea.</p>';
      } else {
        html += '<div class="bm-rows">';
        for (const r of rows) {
          const sel = (r.id === state.selected) ? ' bm-sel' : '';
          const chips = r.chips.length
            ? r.chips.map(c => '<span class="bm-chip bm-ev-' + esc(c.cls) + '">' + esc(c.label) + ' ' + c.count + '</span>').join('')
            : '<span class="bm-chip bm-ev-none">NO CLAIMS YET</span>';
          html += '<div class="bm-row' + sel + (r.promoted ? ' bm-promoted' : '') + '" data-id="' + esc(r.id) + '">' +
            '<div class="bm-row-main">' +
              '<div class="bm-row-name">' + esc(r.title) +
                '<span class="bm-chip bm-stage-' + esc(r.stage) + '">' + esc(r.stageLabel) + '</span>' +
                '<span class="bm-chip bm-prov">' + esc(r.originLabel) + '</span>' +
              '</div>' +
              '<div class="bm-row-sub">' + esc(r.completenessLabel) + ' fields' + (r.updatedRel ? ' · updated ' + esc(r.updatedRel) : '') + '</div>' +
              '<div class="bm-row-chips">' + chips + '</div>' +
              (r.promoted && r.businessId ? '<div class="bm-row-sub">became the business <b>' + esc(r.businessId) + '</b></div>' : '') +
            '</div>' +
            '<div class="bm-row-act">' +
              '<button type="button" class="bm-open" data-id="' + esc(r.id) + '">OPEN</button>' +
              '<button type="button" class="bm-del" data-id="' + esc(r.id) + '" title="delete this opportunity">DELETE</button>' +
            '</div>' +
          '</div>';
        }
        html += '</div>';
      }
      // the create form lives under the list — one less pane to hunt through.
      html += '<div class="bm-form">' +
        '<label class="bm-f"><span>WORKING TITLE *</span><input class="bm-f-title" type="text" maxlength="160" placeholder="Neighborhood Notes"></label>' +
        '<label class="bm-f"><span>TEMPLATE</span><select class="bm-f-template">' +
          state.templates.map(t => '<option value="' + esc(t.id) + '"' + (t.id === 'custom' ? ' selected' : '') + '>' + esc(String(t.label || t.id).toUpperCase()) + '</option>').join('') +
        '</select></label>' +
        '<div class="bm-f-actions"><button type="button" class="bm-new">ADD OPPORTUNITY</button><span class="bm-f-status"></span></div>' +
      '</div>';
      if (state.notice) html += '<div class="bm-note">' + esc(state.notice) + '</div>';
      p.innerHTML = html;
      wireRadar(p);
    }

    function wireRadar(p) {
      p.querySelectorAll('.bm-open').forEach(function (btn) {
        btn.addEventListener('click', function () {
          state.selected = String(btn.getAttribute('data-id') || '');
          state.selectedRun = '';
          renderRadar(); renderEvidence(); loadValidations();
        });
      });
      p.querySelectorAll('.bm-row').forEach(function (rowEl) {
        rowEl.addEventListener('click', function (ev) {
          const t = ev.target;
          if (t && (t.tagName === 'BUTTON' || t.tagName === 'INPUT' || t.tagName === 'SELECT')) return;
          const id = String(rowEl.getAttribute('data-id') || '');
          if (!id || id === state.selected) return;
          state.selected = id; state.selectedRun = '';
          renderRadar(); renderEvidence(); loadValidations();
        });
      });
      p.querySelectorAll('.bm-del').forEach(function (btn) {
        const id = String(btn.getAttribute('data-id') || '');
        arm(btn, 'SURE?', function () {
          const row = toRows(state.opportunities, Date.now()).filter(r => r.id === id)[0];
          btn.disabled = true;
          request('DELETE', '/api/opportunities/' + encodeURIComponent(id)).then(function (r) {
            btn.disabled = false;
            if (!r.ok) { state.error = errText(r, 'could not delete'); renderRadar(); return; }
            state.error = '';
            state.notice = 'deleted ' + ((row && row.title) || id);
            if (state.selected === id) { state.selected = ''; state.validations = []; }
            live.refresh();
          }).catch(function () { btn.disabled = false; state.error = 'could not reach the station'; renderRadar(); });
        });
      });
      const add = p.querySelector('.bm-new');
      if (add) add.addEventListener('click', function () {
        const titleEl = p.querySelector('.bm-f-title');
        const status = p.querySelector('.bm-f-status');
        const title = titleEl ? String(titleEl.value || '').trim() : '';
        if (!title) { status.textContent = 'a working title is required'; status.className = 'bm-f-status bm-bad'; return; }
        add.disabled = true;
        status.textContent = 'adding…'; status.className = 'bm-f-status';
        const tpl = p.querySelector('.bm-f-template');
        request('POST', '/api/opportunities', { title: title, template: tpl ? String(tpl.value || 'custom') : 'custom' }).then(function (r) {
          add.disabled = false;
          if (!r.ok) { status.textContent = errText(r, 'could not add'); status.className = 'bm-f-status bm-bad'; return; }
          const made = r.j && r.j.opportunity;
          state.selected = (made && made.id) || state.selected;
          state.notice = 'added ' + ((made && made.title) || title);
          if (titleEl) titleEl.value = '';
          status.textContent = 'added'; status.className = 'bm-f-status bm-good';
          live.refresh();
        }).catch(function () { add.disabled = false; status.textContent = 'could not reach the station'; status.className = 'bm-f-status bm-bad'; });
      });
    }

    // ---- EVIDENCE ----
    function renderEvidence() {
      const p = panes.evidence; if (!p) return;
      const opp = selectedOpp();
      if (!opp) { p.innerHTML = '<p class="bm-empty">Pick an opportunity on the RADAR pane.</p>'; return; }
      const rows = fieldRows(opp);
      const missing = missingFields(opp);
      let html = '<div class="bm-sum">' + esc(completenessLine(opp)) + '</div>';
      if (missing.length) {
        html += '<div class="bm-missing">Still owed: ' +
          missing.map(f => '<span class="bm-chip bm-miss">' + esc(fieldLabel(f)) + '</span>').join('') + '</div>';
      } else {
        html += '<div class="bm-note">All twelve §4 fields are present. That makes this DECISION-READY — it does not make it true; read the labels.</div>';
      }
      html += '<div class="bm-fields">';
      for (const f of rows) {
        const opts = evidenceOptions(f.evidence).map(o =>
          '<option value="' + esc(o.value) + '"' + (o.selected ? ' selected' : '') + '>' + esc(o.label) + '</option>').join('');
        html += '<div class="bm-field' + (f.filled ? '' : ' bm-field-open') + '" data-key="' + esc(f.key) + '">' +
          '<div class="bm-field-head">' +
            '<span class="bm-field-lbl">' + esc(f.label) + '</span>' +
            '<span class="bm-chip bm-ev-' + esc(f.evidence || 'none') + '">' + esc(f.evidenceLabel) + '</span>' +
            (f.source ? '<span class="bm-src">' + esc(f.source) + '</span>' : '') +
          '</div>' +
          (f.text ? '<div class="bm-field-text">' + esc(f.text) + '</div>' : '') +
          '<div class="bm-field-edit">' +
            '<textarea class="bm-in bm-in-text" rows="2" placeholder="' + esc(f.prompt) + '">' + esc(f.text) + '</textarea>' +
            '<select class="bm-in bm-in-ev" title="how do you know this?">' + opts + '</select>' +
            '<input class="bm-in bm-in-src" type="text" maxlength="500" placeholder="source (optional)" value="' + esc(f.source) + '">' +
            '<button type="button" class="bm-save-field">SAVE</button>' +
            '<span class="bm-field-status"></span>' +
          '</div>' +
        '</div>';
      }
      html += '</div>';
      p.innerHTML = html;
      wireEvidence(p);
    }

    function wireEvidence(p) {
      p.querySelectorAll('.bm-save-field').forEach(function (btn) {
        btn.addEventListener('click', function () {
          const wrap = btn.closest ? btn.closest('.bm-field') : null;
          if (!wrap) return;
          const key = String(wrap.getAttribute('data-key') || '');
          const text = String((wrap.querySelector('.bm-in-text') || {}).value || '');
          const evidence = String((wrap.querySelector('.bm-in-ev') || {}).value || '');
          const source = String((wrap.querySelector('.bm-in-src') || {}).value || '');
          const status = wrap.querySelector('.bm-field-status');
          // a CLEARED field is always allowed — "we no longer claim this" is a legitimate edit and needs no label.
          if (String(text).trim() && !evidence) {
            status.textContent = 'pick a label first — a claim must say how you know it';
            status.className = 'bm-field-status bm-bad';
            return;
          }
          btn.disabled = true;
          status.textContent = 'saving…'; status.className = 'bm-field-status';
          request('POST', '/api/opportunities/' + encodeURIComponent(state.selected) + '/field',
            { field: key, text: text, evidence: evidence, source: source }).then(function (r) {
            btn.disabled = false;
            if (!r.ok) {
              // the sidecar's P1 refusal is rendered VERBATIM — that sentence is the feature working.
              status.textContent = errText(r, 'could not save');
              status.className = 'bm-field-status bm-bad';
              return;
            }
            status.textContent = 'saved'; status.className = 'bm-field-status bm-good';
            live.refresh();
          }).catch(function () { btn.disabled = false; status.textContent = 'could not reach the station'; status.className = 'bm-field-status bm-bad'; });
        });
      });
    }

    // ---- VALIDATION ----
    function renderValidation() {
      const p = panes.validation; if (!p) return;
      const opp = selectedOpp();
      if (!opp) { p.innerHTML = '<p class="bm-empty">Pick an opportunity on the RADAR pane.</p>'; return; }
      const rows = validationRows(state.validations, Date.now());
      const sum = opp.validationSummary || null;
      let html = '<div class="bm-sum">' + esc(validationSummaryLine(sum)) + '</div>';

      // open a run
      html += '<div class="bm-form">' +
        '<label class="bm-f"><span>METHOD</span><select class="bm-v-method">' +
          methodOptions('').map(o => '<option value="' + esc(o.value) + '">' + esc(o.label) + '</option>').join('') +
        '</select></label>' +
        '<label class="bm-f bm-f-wide"><span>THE QUESTION *</span>' +
          '<input class="bm-v-hyp" type="text" placeholder="Will busy neighbours pay for a weekly local digest?"></label>' +
        '<div class="bm-f-actions"><button type="button" class="bm-v-open">OPEN RUN</button><span class="bm-v-status"></span></div>' +
      '</div>';

      if (!rows.length) {
        html += '<p class="bm-empty">No runs yet. Opening one asks a single question — then you go and find out.</p>';
      } else {
        html += '<div class="bm-runs">';
        for (const r of rows) {
          const sel = (r.id === state.selectedRun) ? ' bm-sel' : '';
          html += '<div class="bm-run' + sel + '" data-id="' + esc(r.id) + '">' +
            '<div class="bm-run-top">' +
              '<span class="bm-chip bm-vd-' + esc(r.verdict) + '">' + esc(r.verdictLabel) + '</span>' +
              '<span class="bm-run-method">' + esc(r.methodLabel) + '</span>' +
              (r.rel ? '<span class="bm-run-rel">' + esc(r.rel) + '</span>' : '') +
            '</div>' +
            '<div class="bm-run-hyp">' + esc(r.hypothesis) + '</div>' +
            '<div class="bm-run-sub">' + r.evidenceCount + ' evidence · ' + r.gradedCount + ' verified/analysis · ' +
              r.supporting + ' supporting · ' + r.contradicting + ' contradicting</div>' +
          '</div>';
        }
        html += '</div>';

        // record a result on the selected run
        const run = rows.filter(r => r.id === state.selectedRun)[0] || rows[0];
        if (run) {
          html += '<div class="bm-record">' +
            '<div class="bm-record-head">RECORD THE RESULT — ' + esc(run.methodLabel) + '</div>' +
            '<label class="bm-f bm-f-wide"><span>EVIDENCE (one item per line, as <b>label: text</b>)</span>' +
              '<textarea class="bm-r-ev" rows="3" placeholder="verified: 42 of 50 surveyed said they would pay&#10;assumption: they answered honestly"></textarea></label>' +
            '<label class="bm-f bm-f-wide"><span>SUPPORTING SIGNALS (one per line)</span>' +
              '<textarea class="bm-r-sup" rows="2" placeholder="majority said yes"></textarea></label>' +
            '<label class="bm-f bm-f-wide"><span>CONTRADICTING SIGNALS (one per line)</span>' +
              '<textarea class="bm-r-con" rows="2" placeholder="only 3 offered a price"></textarea></label>' +
            '<label class="bm-f"><span>VERDICT</span><select class="bm-r-vd">' +
              verdictOptions(run.verdict).map(o => '<option value="' + esc(o.value) + '"' + (o.selected ? ' selected' : '') + '>' + esc(o.label) + '</option>').join('') +
            '</select></label>' +
            '<div class="bm-f-actions"><button type="button" class="bm-r-save">SAVE RESULT</button><span class="bm-r-status"></span></div>' +
          '</div>';
        }
      }
      p.innerHTML = html;
      wireValidation(p, rows);
    }

    // "verified: 42 of 50 said yes" -> { text, evidence }. A line with no recognised label is REFUSED here
    // rather than sent unlabelled, so the user learns the rule before the server has to say it. (Defined in
    // the pure half above; aliased here for readability at the call site.)

    function wireValidation(p, rows) {
      p.querySelectorAll('.bm-run').forEach(function (el) {
        el.addEventListener('click', function () {
          const id = String(el.getAttribute('data-id') || '');
          if (!id || id === state.selectedRun) return;
          state.selectedRun = id;
          renderValidation();
        });
      });
      const open = p.querySelector('.bm-v-open');
      if (open) open.addEventListener('click', function () {
        const status = p.querySelector('.bm-v-status');
        const method = String((p.querySelector('.bm-v-method') || {}).value || '');
        const hypothesis = String((p.querySelector('.bm-v-hyp') || {}).value || '').trim();
        if (!hypothesis) { status.textContent = 'a run must ask a question'; status.className = 'bm-v-status bm-bad'; return; }
        open.disabled = true;
        status.textContent = 'opening…'; status.className = 'bm-v-status';
        request('POST', '/api/opportunities/' + encodeURIComponent(state.selected) + '/validations',
          { method: method, hypothesis: hypothesis }).then(function (r) {
          open.disabled = false;
          if (!r.ok) { status.textContent = errText(r, 'could not open the run'); status.className = 'bm-v-status bm-bad'; return; }
          const made = r.j && r.j.validation;
          state.selectedRun = (made && made.id) || state.selectedRun;
          status.textContent = 'opened'; status.className = 'bm-v-status bm-good';
          loadValidations();
        }).catch(function () { open.disabled = false; status.textContent = 'could not reach the station'; status.className = 'bm-v-status bm-bad'; });
      });

      const save = p.querySelector('.bm-r-save');
      if (save) save.addEventListener('click', function () {
        const status = p.querySelector('.bm-r-status');
        const run = rows.filter(r => r.id === state.selectedRun)[0] || rows[0];
        if (!run) return;
        const parsed = parseEvidenceLines((p.querySelector('.bm-r-ev') || {}).value);
        if (!parsed.ok) {
          status.textContent = 'each evidence line needs "<label>: <text>" — unknown line: ' + parsed.bad;
          status.className = 'bm-r-status bm-bad';
          return;
        }
        const body = {
          evidence: parsed.items,
          supporting: splitLines((p.querySelector('.bm-r-sup') || {}).value),
          contradicting: splitLines((p.querySelector('.bm-r-con') || {}).value),
          verdict: String((p.querySelector('.bm-r-vd') || {}).value || 'pending')
        };
        save.disabled = true;
        status.textContent = 'saving…'; status.className = 'bm-r-status';
        request('PATCH', '/api/validations/' + encodeURIComponent(run.id), body).then(function (r) {
          save.disabled = false;
          if (!r.ok) {
            // the P2 refusal, verbatim. This is the sentence the whole Validation Lab exists to produce.
            status.textContent = errText(r, 'could not record the result');
            status.className = 'bm-r-status bm-bad';
            return;
          }
          status.textContent = 'recorded'; status.className = 'bm-r-status bm-good';
          loadValidations();
        }).catch(function () { save.disabled = false; status.textContent = 'could not reach the station'; status.className = 'bm-r-status bm-bad'; });
      });
    }

    // ---- PLAN & PROMOTE ----
    function renderPlan() {
      const p = panes.plan; if (!p) return;
      const opp = selectedOpp();
      let html = '<div class="bm-sum">Preview the task plan a template produces, then promote the opportunity into a real business.</div>';

      html += '<div class="bm-form">' +
        '<label class="bm-f"><span>TEMPLATE</span><select class="bm-p-template">' +
          state.templates.map(t => '<option value="' + esc(t.id) + '"' +
            (opp && t.id === opp.template ? ' selected' : '') + '>' + esc(String(t.label || t.id).toUpperCase()) + '</option>').join('') +
        '</select></label>' +
        '<div class="bm-f-actions"><button type="button" class="bm-p-preview">PREVIEW PLAN</button>' +
          '<span class="bm-p-status"></span></div>' +
      '</div>';
      html += '<div class="bm-form">' +
        '<label class="bm-f bm-f-wide"><span>OR STATE A GOAL</span>' +
          '<input class="bm-p-goal" type="text" placeholder="Launch a digital product"></label>' +
        '<div class="bm-f-actions"><button type="button" class="bm-p-goal-btn">PLAN FROM GOAL</button></div>' +
      '</div>';

      if (state.planError) html += '<div class="bm-err">' + esc(state.planError) + '</div>';
      if (state.plan) {
        const rows = planRows(state.plan);
        html += '<div class="bm-sum">' + esc(state.planSource) + ' — ' + esc(planSummary(state.plan)) + '</div>';
        html += '<div class="bm-plan">';
        for (const r of rows) {
          html += '<div class="bm-plan-row">' +
            '<span class="bm-plan-n">' + r.n + '</span>' +
            '<span class="bm-plan-title">' + esc(r.title) + '</span>' +
            (r.stageLabel ? '<span class="bm-chip bm-plan-stage">' + esc(String(r.stageLabel).toUpperCase()) + '</span>' : '') +
            '<span class="bm-chip bm-plan-pri bm-pri-' + esc(r.priority) + '">' + esc(String(r.priority).toUpperCase()) + '</span>' +
            (r.effortLabel ? '<span class="bm-plan-eff">' + esc(r.effortLabel) + '</span>' : '') +
            (r.approvalRequired ? '<span class="bm-chip bm-plan-appr">NEEDS APPROVAL</span>' : '') +
          '</div>';
        }
        html += '</div>';
      }

      if (!opp) {
        html += '<p class="bm-empty">Pick an opportunity on the RADAR pane to promote it.</p>';
      } else {
        const guard = promoteGuard(opp);
        html += '<div class="bm-promote">' +
          '<div class="bm-promote-head">PROMOTE INTO A BUSINESS</div>' +
          '<div class="bm-note">' + esc(completenessLine(opp)) + '</div>' +
          (guard.allowed
            ? '<label class="bm-f"><span>BUSINESS NAME</span><input class="bm-pr-name" type="text" value="' + esc(opp.title) + '"></label>' +
              '<label class="bm-f bm-f-inline"><input class="bm-pr-plan" type="checkbox" checked> <span>also generate the task plan</span></label>' +
              '<div class="bm-f-actions"><button type="button" class="bm-pr-go">PROMOTE</button><span class="bm-pr-status"></span></div>'
            : '<div class="bm-row-warn">' + esc(guard.reason) + '</div>') +
        '</div>';
      }
      p.innerHTML = html;
      wirePlan(p);
    }

    function wirePlan(p) {
      const prev = p.querySelector('.bm-p-preview');
      if (prev) prev.addEventListener('click', function () {
        const status = p.querySelector('.bm-p-status');
        const id = String((p.querySelector('.bm-p-template') || {}).value || '');
        status.textContent = 'loading…'; status.className = 'bm-p-status';
        request('GET', '/api/templates/' + encodeURIComponent(id) + '/plan').then(function (r) {
          if (!r.ok) { state.plan = null; state.planError = errText(r, 'could not load the plan'); renderPlan(); return; }
          state.plan = r.j && r.j.plan;
          state.planSource = String((state.plan && (state.plan.label || state.plan.template)) || id);
          state.planError = '';
          renderPlan();
        }).catch(function () { state.plan = null; state.planError = 'could not reach the station'; renderPlan(); });
      });
      const goalBtn = p.querySelector('.bm-p-goal-btn');
      if (goalBtn) goalBtn.addEventListener('click', function () {
        const goal = String((p.querySelector('.bm-p-goal') || {}).value || '').trim();
        if (!goal) { state.planError = 'type a goal first'; renderPlan(); return; }
        request('POST', '/api/plan', { goal: goal }).then(function (r) {
          if (!r.ok) {
            // P7 surfaced: the planner refuses an unknown goal and names the ones it knows.
            const known = (r.j && r.j.knownGoals) || [];
            state.plan = null;
            state.planError = errText(r, 'no plan for that goal') + (known.length ? ' Known goals: ' + known.join(', ') + '.' : '');
            renderPlan();
            return;
          }
          state.plan = r.j && r.j.plan;
          state.planSource = String((state.plan && (state.plan.goal || state.plan.label)) || goal);
          state.planError = '';
          renderPlan();
        }).catch(function () { state.plan = null; state.planError = 'could not reach the station'; renderPlan(); });
      });

      const go = p.querySelector('.bm-pr-go');
      if (go) arm(go, 'SURE?', function () {
        const opp = selectedOpp();
        const status = p.querySelector('.bm-pr-status');
        const name = String((p.querySelector('.bm-pr-name') || {}).value || '').trim();
        const withPlan = !!(p.querySelector('.bm-pr-plan') || {}).checked;
        go.disabled = true;
        status.textContent = 'promoting…'; status.className = 'bm-pr-status';
        request('POST', '/api/opportunities/' + encodeURIComponent(state.selected) + '/promote',
          { name: name || undefined, plan: withPlan }).then(function (r) {
          go.disabled = false;
          if (!r.ok) { status.textContent = errText(r, 'could not promote'); status.className = 'bm-pr-status bm-bad'; return; }
          const biz = (r.j && r.j.business) || {};
          const made = (r.j && typeof r.j.tasksCreated === 'number') ? r.j.tasksCreated : 0;
          state.notice = 'promoted to ' + (biz.id || '') + ' — ' + made + ' task' + (made === 1 ? '' : 's') + ' created';
          status.textContent = (r.j && r.j.advisory) ? r.j.advisory : ('created ' + (biz.id || '') + ' with ' + made + ' tasks');
          status.className = 'bm-pr-status bm-good';
          live.refresh();
        }).catch(function () { go.disabled = false; status.textContent = 'could not reach the station'; status.className = 'bm-pr-status bm-bad'; });
      });
    }

    function loadValidations() {
      if (!state.selected) { state.validations = []; renderValidation(); return Promise.resolve(); }
      return request('GET', '/api/opportunities/' + encodeURIComponent(state.selected) + '/validations').then(function (r) {
        if (r.ok && r.j && Array.isArray(r.j.validations)) state.validations = r.j.validations;
        renderValidation();
      }).catch(function () { renderValidation(); });
    }

    function refresh() {
      return request('GET', '/api/opportunities').then(function (r) {
        if (!r.ok) { state.error = errText(r, 'could not load opportunities'); renderRadar(); return; }
        state.error = '';
        state.opportunities = (r.j && Array.isArray(r.j.opportunities)) ? r.j.opportunities : [];
        if (!state.selected && state.opportunities.length) state.selected = state.opportunities[0].id;
        if (state.selected && !state.opportunities.some(o => o && o.id === state.selected)) {
          state.selected = state.opportunities.length ? state.opportunities[0].id : '';
          state.selectedRun = '';
        }
        renderRadar(); renderEvidence(); renderPlan();
        return loadValidations();
      }).catch(function () {
        state.error = 'could not reach the station';
        renderRadar();
      });
    }

    // the template catalogue is static, but it is fetched (not hardcoded) so the UI can never drift from
    // the sidecar's §25 definitions — a hardcoded copy would be a second source of truth.
    request('GET', '/api/templates').then(function (r) {
      state.templates = (r.ok && r.j && Array.isArray(r.j.templates)) ? r.j.templates : [];
      renderRadar(); renderPlan();
    }).catch(function () { renderRadar(); renderPlan(); });

    renderRadar(); renderEvidence(); renderValidation(); renderPlan();
    wireBus();
    const inst = { state: state, refresh: refresh, loadValidations: loadValidations };
    live = inst;
    refresh();
    return inst;
  }

  return {
    EVIDENCE, EVIDENCE_LABEL, EVIDENCE_HINT, FIELDS, FIELD_LABEL, FIELD_PROMPT,
    STAGES, STAGE_LABEL, METHODS, METHOD_LABEL, VERDICTS, VERDICT_LABEL,
    evidenceLabel, fieldLabel, stageLabel, methodLabel, verdictLabel, evidenceHint,
    relTime, evidenceOptions, methodOptions, verdictOptions, stageOptions,
    evidenceMix, completeness, missingFields, mixChips, toRows,
    fieldRows, completenessLine, validationRows, validationSummaryLine,
    planRows, planSummary, promoteGuard, summaryLine, parseEvidenceLines,
    esc, request, errText, mount
  };
});
