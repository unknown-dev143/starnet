/* STARNET — businessmanager.js : the BUSINESS MANAGER console (Business OS Phase 4).

   Phase 1 gave a business a place to live; Phase 2 a way to be created; Phase 3 a crew. This is the part
   that runs the thing: §10 Finance · §11 Analytics · §16 CRM · §17 Content · §15 Documents & Knowledge ·
   §14 Experiments, plus the §9 project layer Phase 3 deferred.

   WHAT THIS CONSOLE REFUSES TO DO, and why each refusal is the feature:
     · It does not add a business's REAL money to the AI's GUESS. §10's four provenance classes are rendered
       as two separate figures — RECORDED (actual + user-entered + imported) and ESTIMATED (ai-estimate) —
       because a single blended total is the exact fabrication P2 forbids, and it is the most convincing one
       a finance screen can produce.
     · It does not render an unrecorded metric as 0. §11's `latest` is null when nothing was recorded, and
       the panel says "not recorded" rather than showing a zero that reads as a fact.
     · It does not offer a "lead score". §16's attention panel lists the TWO NAMED RULES the sidecar applied
       (overdue follow-ups, contacts gone quiet) and the raw inputs behind each — no ranking, no verdict.
     · It does not let a button publish as an agent. §17's publish transition requires a human actor, so the
       only control that crosses that line sends the Commander as the actor, and the pane says plainly that
       an agent cannot.
     · It does not offer a conclusion the sidecar would refuse. §14's conclude control is built from the
       experiment's ACTUAL state (ended? two arms? graded evidence?) so the UI never proposes a verdict the
       store would reject.
     · It does not call term overlap "AI relevance". §15's retrieval is labelled for what it is.

   TWO HALVES, ON PURPOSE — the pure half (labels, option builders, row shaping, guards, formatting) is UMD
   and Node-loadable so it is unit-tested headless; only mount() needs a DOM and it degrades to a no-op. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.BusinessManager = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ---- LABELS ONLY. Every closed vocabulary's IDS come from /api/manager/catalog, so this file cannot
     drift from the values the stores accept; what lives here is how each id READS. ---- */
  const PROJECT_STATUS_LABEL = { planned: 'PLANNED', active: 'ACTIVE', paused: 'PAUSED', done: 'DONE', archived: 'ARCHIVED' };

  const KIND_LABEL = { revenue: 'REVENUE', expense: 'EXPENSE' };
  const PROVENANCE_LABEL = {
    'actual': 'ACTUAL — a real figure from the source system',
    'user-entered': 'ENTERED BY YOU',
    'imported': 'IMPORTED — needs a source',
    'ai-estimate': 'AI ESTIMATE — a guess, needs a basis'
  };
  const PROVENANCE_SHORT = { 'actual': 'ACTUAL', 'user-entered': 'YOU ENTERED', 'imported': 'IMPORTED', 'ai-estimate': 'AI ESTIMATE' };

  const STAGE_LABEL = {
    lead: 'LEAD', prospect: 'PROSPECT', customer: 'CUSTOMER', churned: 'CHURNED'
  };
  const INTERACTION_LABEL = {
    email: 'EMAIL', call: 'CALL', meeting: 'MEETING', message: 'MESSAGE', note: 'NOTE', purchase: 'PURCHASE', support: 'SUPPORT'
  };

  const CONTENT_STAGE_LABEL = {
    idea: 'IDEA', research: 'RESEARCH', script: 'SCRIPT', assets: 'ASSETS', editing: 'EDITING',
    review: 'REVIEW', publish: 'PUBLISH', analytics: 'ANALYTICS'
  };
  const CHANNEL_LABEL = {
    youtube: 'YOUTUBE', tiktok: 'TIKTOK', instagram: 'INSTAGRAM', facebook: 'FACEBOOK',
    blog: 'BLOG', newsletter: 'NEWSLETTER', 'product-marketing': 'PRODUCT MARKETING', other: 'OTHER'
  };

  const DOC_TYPE_LABEL = {
    'business-plan': 'BUSINESS PLAN', 'product-spec': 'PRODUCT SPEC', 'research-report': 'RESEARCH REPORT',
    'marketing-plan': 'MARKETING PLAN', sop: 'SOP', 'meeting-notes': 'MEETING NOTES',
    'investor-document': 'INVESTOR DOCUMENT', 'technical-doc': 'TECHNICAL DOC', 'customer-doc': 'CUSTOMER DOC',
    policy: 'POLICY', report: 'REPORT'
  };
  const DOC_STATUS_LABEL = { draft: 'DRAFT', final: 'FINAL' };

  const KB_KIND_LABEL = {
    pdf: 'PDF', note: 'NOTE', research: 'RESEARCH', website: 'WEBSITE', document: 'DOCUMENT',
    spec: 'SPEC', feedback: 'CUSTOMER FEEDBACK', competitor: 'COMPETITOR', internal: 'INTERNAL'
  };

  const EXP_STATUS_LABEL = { planned: 'PLANNED', running: 'RUNNING', ended: 'ENDED', concluded: 'CONCLUDED' };
  const CONCLUSION_LABEL = { supported: 'SUPPORTED', refuted: 'REFUTED', inconclusive: 'INCONCLUSIVE' };

  const EVIDENCE_LABEL = {
    verified: 'VERIFIED', analysis: 'ANALYSIS', assumption: 'ASSUMPTION',
    estimate: 'ESTIMATE', prediction: 'PREDICTION', unknown: 'UNKNOWN'
  };

  const byId = (arr, id) => (arr || []).filter(x => x === id)[0] || id;
  function label(map, id) { return map[id] || String(id == null ? '' : id).toUpperCase(); }
  function evidenceLabel(e) { return EVIDENCE_LABEL[e] || String(e == null ? '' : e).toUpperCase(); }

  // ---- formatting ----
  function money(amount, currency) {
    const n = Number(amount);
    if (!isFinite(n)) return '—';
    const sym = { USD: '$', CNY: '¥', EUR: '€', GBP: '£', JPY: '¥' }[String(currency || '').toUpperCase()];
    const body = Math.abs(n) >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(Math.round(n * 100) / 100);
    return sym ? sym + body : body + ' ' + String(currency || '');
  }

  function relTime(at, now) {
    if (!at) return '';
    const s = Math.max(0, Math.floor(((now || 0) - at) / 1000));
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  // one request helper; the Response is kept in scope and r.ok read, so a plain-text 403 or a proxy HTML page
  // can never collapse into {} and render as success. Mirrors aiteam.js / businessmaker.js.
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

  // ---- option builders. A picker NEVER defaults to a value the store would refuse. ----
  function optionsFrom(ids, map, current, blank) {
    let html = blank === undefined ? '' : '<option value=""' + (!current ? ' selected' : '') + '>' + esc(blank) + '</option>';
    for (const id of (ids || [])) {
      html += '<option value="' + esc(id) + '"' + (id === current ? ' selected' : '') + '>' + esc(label(map, id)) + '</option>';
    }
    return html;
  }
  // Provenance has NO default: the store refuses a row whose provenance nobody stated (P2), so an
  // auto-selected first option would be the UI inventing a provenance the user never chose.
  function provenanceOptions(ids, current) {
    let html = '<option value=""' + (!current ? ' selected' : '') + '>— where does this number come from? —</option>';
    for (const id of (ids || [])) html += '<option value="' + esc(id) + '"' + (id === current ? ' selected' : '') + '>' + esc(label(PROVENANCE_LABEL, id)) + '</option>';
    return html;
  }
  function metricOptions(metrics, current) {
    let html = '<option value=""' + (!current ? ' selected' : '') + '>— pick a metric —</option>';
    for (const m of (metrics || [])) html += '<option value="' + esc(m.id) + '"' + (m.id === current ? ' selected' : '') + '>' + esc(m.label + ' (' + m.unit + ')') + '</option>';
    return html;
  }

  // ---- row shaping ----
  function projectRows(projects) {
    return (projects || []).map(p => ({
      id: p.id, name: p.name, goal: p.goal || '', status: p.status,
      statusLabel: label(PROJECT_STATUS_LABEL, p.status), ownerAgent: p.ownerAgent || '',
      paused: p.status === 'paused', done: p.status === 'done' || p.status === 'archived'
    }));
  }

  function transactionRows(rows, now) {
    return (rows || []).map(t => ({
      id: t.id, kind: t.kind, kindLabel: label(KIND_LABEL, t.kind),
      amount: t.amount, currency: t.currency, amountText: money(t.amount, t.currency),
      category: t.category, note: t.note || '',
      provenance: t.provenance, provenanceLabel: label(PROVENANCE_SHORT, t.provenance),
      isEstimate: t.provenance === 'ai-estimate',
      basis: t.basis || '', source: t.source || '',
      at: t.at, when: relTime(t.at, now)
    }));
  }

  /* The §10 headline, shaped so the UI CANNOT blend the two. `recorded` and `estimated` come back as
     separate objects from the sidecar and stay separate here — there is deliberately no `total` key. */
  function totalsView(totals) {
    const by = (totals && totals.byCurrency) || {};
    return Object.keys(by).sort().map(c => ({
      currency: c,
      recorded: {
        revenue: money(by[c].recorded.revenue, c),
        expense: money(by[c].recorded.expense, c),
        profit: money(by[c].recorded.profit, c),
        count: by[c].recorded.count,
        profitNegative: by[c].recorded.profit < 0
      },
      estimated: {
        revenue: money(by[c].estimated.revenue, c),
        expense: money(by[c].estimated.expense, c),
        profit: money(by[c].estimated.profit, c),
        count: by[c].estimated.count
      }
    }));
  }

  function metricRows(summary) {
    return (summary || []).map(m => ({
      metric: m.metric, label: m.label, unit: m.unit,
      // null is NOT zero. The panel prints "not recorded" for an absent reading.
      recorded: m.latest != null,
      valueText: m.latest != null ? String(m.latest) : 'not recorded',
      evidence: m.evidence, evidenceLabel: m.evidence ? evidenceLabel(m.evidence) : '',
      source: m.source || '', readings: m.readings
    }));
  }

  function contactRows(contacts, now) {
    return (contacts || []).map(c => ({
      id: c.id, name: c.name, email: c.email || '', org: c.org || '',
      stage: c.stage, stageLabel: label(STAGE_LABEL, c.stage),
      tags: c.tags || [],
      interactions: (c.interactions || []).map(i => ({
        kind: i.kind, kindLabel: label(INTERACTION_LABEL, i.kind), summary: i.summary, at: i.at, when: relTime(i.at, now)
      })),
      followUps: (c.followUps || []).map(f => ({
        id: f.id, what: f.what, dueAt: f.dueAt, done: !!f.done,
        dueText: f.dueAt ? relTime(f.dueAt, now).replace(' ago', '') : 'no date'
      })),
      openFollowUps: (c.followUps || []).filter(f => !f.done).length,
      lastTouch: (c.interactions || []).length ? c.interactions[c.interactions.length - 1].at : null
    }));
  }

  function attentionRows(attention) {
    const a = attention || {};
    const out = [];
    for (const o of (a.overdue || [])) {
      out.push({ rule: o.rule, kind: 'overdue', contactId: o.contactId, who: o.contactName, what: o.what, detail: o.daysLate + 'd overdue' });
    }
    for (const q of (a.quiet || [])) {
      out.push({ rule: q.rule, kind: 'quiet', contactId: q.contactId, who: q.contactName, what: label(STAGE_LABEL, q.stage), detail: 'quiet ' + q.daysQuiet + 'd' });
    }
    return out;
  }

  function contentRows(pieces, now) {
    return (pieces || []).map(p => ({
      id: p.id, title: p.title, channel: p.channel, channelLabel: label(CHANNEL_LABEL, p.channel),
      stage: p.stage, stageLabel: label(CONTENT_STAGE_LABEL, p.stage),
      brief: p.brief || '', assets: p.assets || [],
      published: !!p.publishedAt, publishedBy: p.publishedBy || '',
      when: relTime(p.updatedAt, now)
    }));
  }
  // The pipeline board: one column per §17 stage, in §17's order.
  function contentBoard(pieces, stages) {
    const rows = contentRows(pieces, 0);
    return (stages || []).map(s => ({ stage: s, label: label(CONTENT_STAGE_LABEL, s), items: rows.filter(r => r.stage === s) }));
  }

  function documentRows(docs) {
    return (docs || []).map(d => ({
      id: d.id, title: d.title, type: d.type, typeLabel: label(DOC_TYPE_LABEL, d.type),
      status: d.status, statusLabel: label(DOC_STATUS_LABEL, d.status),
      body: d.body || '', chars: (d.body || '').length,
      deliverableId: d.deliverableId || '', projectId: d.projectId || ''
    }));
  }

  function knowledgeRows(entries, now) {
    return (entries || []).map(e => ({
      id: e.id, kind: e.kind, kindLabel: label(KB_KIND_LABEL, e.kind),
      title: e.title, body: e.body || '', ref: e.ref || '',
      tags: e.tags || [], source: e.source || '', when: relTime(e.createdAt, now)
    }));
  }

  function experimentRows(experiments, now) {
    return (experiments || []).map(x => ({
      id: x.id, hypothesis: x.hypothesis, variable: x.variable || '',
      variants: x.variants || [], metrics: x.metrics || [],
      status: x.status, statusLabel: label(EXP_STATUS_LABEL, x.status),
      conclusion: x.conclusion, conclusionLabel: x.conclusion ? label(CONCLUSION_LABEL, x.conclusion) : '',
      reason: x.conclusionReason || '', nextAction: x.nextAction || '',
      results: x.results || [], resultCount: (x.results || []).length,
      when: relTime(x.updatedAt, now)
    }));
  }

  // ---- guards: each MIRRORS a store rule, so the UI never proposes what the sidecar would refuse ----
  function financeGuard(draft) {
    draft = draft || {};
    if (!draft.kind) return { allowed: false, reason: 'Pick whether this is revenue or an expense.' };
    const amt = Number(draft.amount);
    if (!isFinite(amt) || amt <= 0) return { allowed: false, reason: 'Enter an amount greater than zero.' };
    if (!draft.currency || !/^[A-Za-z]{3}$/.test(String(draft.currency))) return { allowed: false, reason: 'Enter a 3-letter currency code (USD, CNY…).' };
    if (!draft.category) return { allowed: false, reason: 'Pick a category.' };
    if (!draft.provenance) return { allowed: false, reason: 'Say where this number comes from — a figure with no provenance cannot be told apart from an invented one (P2).' };
    if (draft.provenance === 'ai-estimate' && !String(draft.basis || '').trim()) {
      return { allowed: false, reason: 'An AI estimate must state its basis — the reasoning behind the guess.' };
    }
    if (draft.provenance === 'imported' && !String(draft.source || '').trim()) {
      return { allowed: false, reason: 'An imported figure must name its source.' };
    }
    return { allowed: true, reason: '' };
  }

  function metricGuard(draft, metrics) {
    draft = draft || {};
    if (!draft.metric) return { allowed: false, reason: 'Pick a metric.' };
    const def = (metrics || []).filter(m => m.id === draft.metric)[0];
    const v = Number(draft.value);
    if (!isFinite(v) || v < 0) return { allowed: false, reason: 'Enter a number zero or more.' };
    if (def && def.unit === 'rate' && v > 1) return { allowed: false, reason: 'A rate is a fraction between 0 and 1 (0.032, not 3.2).' };
    if (!String(draft.source || '').trim()) return { allowed: false, reason: 'Say where the reading came from — a number with no source cannot be checked (P1).' };
    if (!draft.evidence) return { allowed: false, reason: 'Pick an evidence class.' };
    return { allowed: true, reason: '' };
  }

  function knowledgeGuard(draft) {
    draft = draft || {};
    if (!draft.kind) return { allowed: false, reason: 'Pick what kind of source this is.' };
    if (!String(draft.title || '').trim()) return { allowed: false, reason: 'Give it a title.' };
    if (!String(draft.source || '').trim()) return { allowed: false, reason: 'Say where it came from — §15 retrieves this before decisions, so its origin must be recorded (P1).' };
    return { allowed: true, reason: '' };
  }

  /* The §17 publish gate, mirrored. Reaching 'publish' or 'analytics' needs a HUMAN actor; the UI sends the
     Commander as that actor, and this guard exists so the pane can explain the rule rather than let a click
     fail with a raw 403. */
  function contentAdvanceGuard(piece, toStage, publishStages) {
    if (!piece) return { allowed: false, reason: 'No piece selected.' };
    if (!toStage) return { allowed: false, reason: 'Pick a stage.' };
    if ((publishStages || []).indexOf(toStage) >= 0 && !piece.asHuman) {
      return { allowed: false, reason: 'Publishing is not automatic (§17) — it needs you, not an agent.' };
    }
    return { allowed: true, reason: '' };
  }

  /* The §14 conclusion gate, mirrored. Built from the experiment's ACTUAL state so the pane never offers a
     verdict the store would reject — and so it can say WHICH rule is missing instead of a bare refusal. */
  function conclusionGuard(experiment, conclusion, verdictGrade) {
    if (!experiment) return { allowed: false, reason: 'No experiment selected.' };
    if (conclusion === 'inconclusive') return { allowed: true, reason: '' };
    if (!conclusion) return { allowed: false, reason: 'Pick a conclusion.' };
    if (experiment.status !== 'ended' && experiment.status !== 'concluded') {
      return { allowed: false, reason: 'End the experiment first — a verdict on data still arriving is a theory (§14).' };
    }
    if ((experiment.variants || []).length < 2) {
      return { allowed: false, reason: 'A controlled experiment needs two arms to compare.' };
    }
    const grade = verdictGrade || ['verified', 'analysis'];
    const graded = (experiment.results || []).filter(r => grade.indexOf(r.evidence) >= 0);
    if (!graded.length) {
      return { allowed: false, reason: 'No ' + grade.join('/').toUpperCase() + ' result yet — assumptions and estimates cannot carry a verdict (P2). Record it as inconclusive instead.' };
    }
    return { allowed: true, reason: '' };
  }

  function summaryLine(business, counts) {
    if (!business) return 'No business selected. The manager belongs to a business.';
    const c = counts || {};
    const parts = [];
    for (const k of ['projects', 'transactions', 'readings', 'contacts', 'content', 'documents', 'knowledge', 'experiments']) {
      if (c[k]) parts.push(c[k] + ' ' + k);
    }
    return parts.length ? parts.join(' · ') : 'Nothing recorded in this business yet.';
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
    const names = [
      'business.project.created', 'business.project.updated', 'business.project.removed',
      'business.finance.recorded', 'business.finance.removed', 'business.metric.recorded',
      'business.contact.added', 'business.contact.updated', 'business.contact.removed', 'business.contact.interaction',
      'business.content.created', 'business.content.advanced', 'business.content.removed',
      'business.document.created', 'business.document.updated', 'business.document.removed',
      'business.knowledge.added', 'business.knowledge.forgotten',
      'business.experiment.opened', 'business.experiment.ended', 'business.experiment.concluded',
      'business.created'
    ];
    for (const n of names) { try { U.bus.on(n, scheduleRefresh); } catch (_) {} }
  }

  function mount(body) {
    if (typeof document === 'undefined' || !body) return null;
    const SUI = (typeof StationUI !== 'undefined') ? StationUI : null;
    if (!SUI || !SUI.h || typeof SUI.h.mountConsole !== 'function') return null;

    const panes = {};
    SUI.h.mountConsole(body, 'manager', [
      { id: 'overview', label: 'OVERVIEW', glyph: '◫',
        desc: 'What this business holds, and what the numbers actually are. Counts and recorded figures only — nothing on this pane is scored or forecast.',
        build: function (p) { panes.overview = p; } },
      { id: 'projects', label: 'PROJECTS', glyph: '▦',
        desc: '§9\'s project layer: a named unit of work with a goal. A task or a document can point at one, which is what makes "what is this work for" answerable.',
        build: function (p) { panes.projects = p; } },
      { id: 'finance', label: 'FINANCE', glyph: '¤',
        desc: '§10. Every figure carries where it came from. REAL money (actual, entered by you, imported) and AI ESTIMATES are shown as two separate sets and are never added together (P2).',
        build: function (p) { panes.finance = p; } },
      { id: 'analytics', label: 'ANALYTICS', glyph: '∿',
        desc: '§11\'s metrics. A metric nobody has recorded reads "not recorded" — never 0, because 0% churn is the most flattering lie a dashboard can tell.',
        build: function (p) { panes.analytics = p; } },
      { id: 'customers', label: 'CUSTOMERS', glyph: '☏',
        desc: '§16\'s CRM: contacts, what was said, and what is due. "Needs attention" lists the two named rules that fired — it is not a lead score.',
        build: function (p) { panes.customers = p; } },
      { id: 'content', label: 'CONTENT', glyph: '▶',
        desc: '§17\'s pipeline, idea through analytics. Moving a piece to PUBLISH or ANALYTICS requires you: the store refuses any agent actor, so the button that crosses that line is yours.',
        build: function (p) { panes.content = p; } },
      { id: 'library', label: 'LIBRARY', glyph: '▤',
        desc: '§15\'s documents and knowledge base. Documents are what the business wrote; knowledge is what it collected. Retrieval is ranked by literal word overlap and is labelled as such.',
        build: function (p) { panes.library = p; } },
      { id: 'experiments', label: 'EXPERIMENTS', glyph: '⚗',
        desc: '§14. A conclusion needs an ended run, two arms, and at least one verified or analysis result — so the app learns from data instead of generating theories.',
        build: function (p) { panes.experiments = p; } }
    ], { search: false });

    const state = {
      businesses: [], businessId: '', catalog: null,
      projects: [], transactions: [], totals: null, budgets: [], budgetStatus: null, prices: [], currencies: [],
      readings: [], metricSummary: [], series: null, seriesMetric: '',
      contacts: [], contactSummary: null, attention: null, openFollowUps: [],
      content: [], contentSummary: null,
      documents: [], docSummary: null, docQuery: '', docHits: null,
      knowledge: [], kbSummary: null, kbQuery: '', kbHits: null,
      experiments: [], expSummary: null,
      draft: {
        project: { name: '', goal: '' },
        txn: { kind: 'revenue', amount: '', currency: 'USD', category: '', provenance: '', basis: '', source: '', note: '' },
        budget: { category: '', amount: '', currency: 'USD' },
        price: { sku: '', amount: '', currency: 'USD' },
        metric: { metric: '', value: '', source: '', evidence: 'verified' },
        contact: { name: '', email: '', org: '', stage: 'lead' },
        interaction: { kind: 'note', summary: '' },
        followUp: { what: '', dueAt: '' },
        content: { title: '', channel: '', brief: '' },
        document: { title: '', type: '', body: '' },
        knowledge: { kind: '', title: '', body: '', ref: '', source: '', tags: '' },
        experiment: { hypothesis: '', variable: '', variants: '', metrics: '' }
      },
      exp: { selected: '', result: { variant: '', metric: '', value: '', source: '', evidence: 'verified' }, conclusion: '', reason: '', nextAction: '' },
      selectedContact: '', selectedExperiment: '',
      error: '', notice: '', busy: false
    };

    /* Two-press confirmation, the house pattern. An OS modal (window.confirm) over the phosphor terminal is
       banned — test/station-tooltip.test.js enforces it — and armconfirm.js is the shared helper.
       FAIL-CLOSED: if ArmConfirm is absent the control is DISABLED rather than firing unconfirmed. */
    function arm(btn, lbl, onConfirm) {
      if (!btn) return;
      if (typeof ArmConfirm === 'undefined' || typeof ArmConfirm.wire !== 'function') {
        btn.disabled = true;
        btn.title = 'confirmation helper unavailable — refusing to act unconfirmed';
        return;
      }
      ArmConfirm.wire(btn, { armedLabel: lbl, onConfirm: onConfirm });
    }

    const api = (p) => p;
    const bizPath = (suffix) => '/api/businesses/' + encodeURIComponent(state.businessId) + suffix;
    const cat = (k) => (state.catalog && state.catalog[k]) || {};
    const catList = (k, sub) => ((state.catalog && state.catalog[k] && state.catalog[k][sub]) || []);

    // ---- loaders ----
    function loadBusinesses() {
      return request('GET', api('/api/businesses')).then(function (r) {
        if (!r.ok) { state.error = errText(r, 'could not load businesses'); return; }
        state.businesses = (r.j && r.j.businesses) || [];
        if (!state.businessId && state.businesses.length) state.businessId = state.businesses[0].id;
        if (state.businessId && !state.businesses.some(b => b.id === state.businessId)) state.businessId = state.businesses.length ? state.businesses[0].id : '';
      });
    }
    function loadCatalog() {
      return request('GET', api('/api/manager/catalog')).then(function (r) {
        if (!r.ok) return;
        state.catalog = r.j || null;
      });
    }
    function loadProjects() {
      if (!state.businessId) { state.projects = []; return Promise.resolve(); }
      return request('GET', api(bizPath('/projects'))).then(function (r) {
        if (!r.ok) { state.error = errText(r, 'could not load projects'); return; }
        state.projects = (r.j && r.j.projects) || [];
      });
    }
    function loadFinance() {
      if (!state.businessId) { state.transactions = []; return Promise.resolve(); }
      return request('GET', api(bizPath('/finance'))).then(function (r) {
        if (!r.ok) { state.error = errText(r, 'could not load finance'); return; }
        state.transactions = (r.j && r.j.transactions) || [];
        state.totals = (r.j && r.j.totals) || null;
        state.budgets = (r.j && r.j.budgets) || [];
        state.budgetStatus = (r.j && r.j.budgetStatus) || null;
        state.prices = (r.j && r.j.prices) || [];
        state.currencies = (r.j && r.j.currencies) || [];
        if (!state.currencies.length) state.currencies = ['USD'];
      });
    }
    function loadMetrics() {
      if (!state.businessId) { state.metricSummary = []; return Promise.resolve(); }
      return request('GET', api(bizPath('/metrics'))).then(function (r) {
        if (!r.ok) { state.error = errText(r, 'could not load metrics'); return; }
        state.metricSummary = (r.j && r.j.summary) || [];
      });
    }
    function loadSeries() {
      if (!state.businessId || !state.seriesMetric) { state.series = null; return Promise.resolve(); }
      return request('GET', api(bizPath('/metrics/series') + '?metric=' + encodeURIComponent(state.seriesMetric))).then(function (r) {
        state.series = (r.ok && r.j) || null;
      });
    }
    function loadContacts() {
      if (!state.businessId) { state.contacts = []; return Promise.resolve(); }
      return request('GET', api(bizPath('/contacts') + '?now=' + Date.now())).then(function (r) {
        if (!r.ok) { state.error = errText(r, 'could not load contacts'); return; }
        state.contacts = (r.j && r.j.contacts) || [];
        state.contactSummary = (r.j && r.j.summary) || null;
        state.attention = (r.j && r.j.attention) || null;
        state.openFollowUps = (r.j && r.j.openFollowUps) || [];
      });
    }
    function loadContent() {
      if (!state.businessId) { state.content = []; return Promise.resolve(); }
      return request('GET', api(bizPath('/content'))).then(function (r) {
        if (!r.ok) { state.error = errText(r, 'could not load content'); return; }
        state.content = (r.j && r.j.content) || [];
        state.contentSummary = (r.j && r.j.summary) || null;
      });
    }
    function loadDocuments() {
      if (!state.businessId) { state.documents = []; return Promise.resolve(); }
      return request('GET', api(bizPath('/documents'))).then(function (r) {
        if (!r.ok) { state.error = errText(r, 'could not load documents'); return; }
        state.documents = (r.j && r.j.documents) || [];
        state.docSummary = (r.j && r.j.summary) || null;
      });
    }
    function loadKnowledge() {
      if (!state.businessId) { state.knowledge = []; return Promise.resolve(); }
      return request('GET', api(bizPath('/knowledge'))).then(function (r) {
        if (!r.ok) { state.error = errText(r, 'could not load knowledge'); return; }
        state.knowledge = (r.j && r.j.entries) || [];
        state.kbSummary = (r.j && r.j.summary) || null;
      });
    }
    function loadExperiments() {
      if (!state.businessId) { state.experiments = []; return Promise.resolve(); }
      return request('GET', api(bizPath('/experiments'))).then(function (r) {
        if (!r.ok) { state.error = errText(r, 'could not load experiments'); return; }
        state.experiments = (r.j && r.j.experiments) || [];
        state.expSummary = (r.j && r.j.summary) || null;
      });
    }

    function loadAll() {
      return Promise.all([
        loadProjects(), loadFinance(), loadMetrics(), loadContacts(),
        loadContent(), loadDocuments(), loadKnowledge(), loadExperiments()
      ]);
    }
    function refresh() {
      return loadBusinesses()
        .then(function () { return loadAll(); })
        .then(function () { return loadSeries(); })
        .then(function () { renderAll(); });
    }
    function flash(msg) { state.notice = msg || ''; state.error = ''; renderAll(); }

    // ---- mutations ----
    function post(path, body, okMsg, reload) {
      return send('POST', path, body, okMsg, reload);
    }
    /* PATCH is a distinct verb here, not a flavour of POST: the project-status and contact-stage routes are
       PATCH-only, and calling POST on them would 405. */
    function patch(path, body, okMsg, reload) {
      return send('PATCH', path, body, okMsg, reload);
    }
    function send(method, path, body, okMsg, reload) {
      state.busy = true;
      return request(method, api(path), body === undefined ? {} : body).then(function (r) {
        state.busy = false;
        if (!r.ok) { state.error = errText(r, 'request failed'); renderAll(); return; }
        state.notice = okMsg || 'Done.';
        return reload ? reload() : loadAll().then(renderAll);
      });
    }
    function del(path, okMsg, reload) {
      return request('DELETE', api(path)).then(function (r) {
        if (!r.ok) { state.error = errText(r, 'could not remove'); renderAll(); return; }
        state.notice = okMsg || 'Removed.';
        return reload ? reload() : loadAll().then(renderAll);
      });
    }

    function doCreateProject() {
      const d = state.draft.project;
      if (!String(d.name).trim()) { state.error = 'A project needs a name.'; renderAll(); return; }
      post(bizPath('/projects'), { name: d.name, goal: d.goal }, 'Project created.', function () {
        state.draft.project = { name: '', goal: '' };
        return loadProjects().then(renderAll);
      });
    }
    function doCreateTxn() {
      const d = state.draft.txn;
      const g = financeGuard(d);
      if (!g.allowed) { state.error = g.reason; renderAll(); return; }
      post(bizPath('/finance'), {
        kind: d.kind, amount: Number(d.amount), currency: String(d.currency).toUpperCase(), category: d.category,
        provenance: d.provenance, basis: d.basis, source: d.source, note: d.note
      }, 'Transaction recorded.', function () {
        state.draft.txn = { kind: d.kind, amount: '', currency: d.currency, category: '', provenance: '', basis: '', source: '', note: '' };
        return loadFinance().then(renderAll);
      });
    }
    function doSetBudget() {
      const d = state.draft.budget;
      if (!d.category) { state.error = 'Pick a budget category (or * for the whole business).'; renderAll(); return; }
      post(bizPath('/finance/budgets'), { category: d.category, amount: Number(d.amount), currency: String(d.currency).toUpperCase() }, 'Budget set.', function () {
        state.draft.budget = { category: '', amount: '', currency: d.currency };
        return loadFinance().then(renderAll);
      });
    }
    function doSetPrice() {
      const d = state.draft.price;
      if (!String(d.sku).trim()) { state.error = 'A price needs a sku.'; renderAll(); return; }
      post(bizPath('/finance/prices'), { sku: d.sku, amount: Number(d.amount), currency: String(d.currency).toUpperCase() }, 'Price set.', function () {
        state.draft.price = { sku: '', amount: '', currency: d.currency };
        return loadFinance().then(renderAll);
      });
    }
    function doRecordMetric() {
      const d = state.draft.metric;
      const g = metricGuard(d, (state.catalog && state.catalog.metrics) || []);
      if (!g.allowed) { state.error = g.reason; renderAll(); return; }
      post(bizPath('/metrics'), { metric: d.metric, value: Number(d.value), source: d.source, evidence: d.evidence }, 'Reading recorded.', function () {
        state.draft.metric = { metric: d.metric, value: '', source: '', evidence: 'verified' };
        return loadMetrics().then(renderAll);
      });
    }
    function doAddContact() {
      const d = state.draft.contact;
      if (!String(d.name).trim()) { state.error = 'A contact needs a name.'; renderAll(); return; }
      post(bizPath('/contacts'), { name: d.name, email: d.email, org: d.org, stage: d.stage }, 'Contact added.', function () {
        state.draft.contact = { name: '', email: '', org: '', stage: 'lead' };
        return loadContacts().then(renderAll);
      });
    }
    function doLogInteraction(contactId) {
      const d = state.draft.interaction;
      if (!String(d.summary).trim()) { state.error = 'An interaction needs a summary.'; renderAll(); return; }
      post('/api/contacts/' + encodeURIComponent(contactId) + '/interactions', { kind: d.kind, summary: d.summary }, 'Logged.', function () {
        state.draft.interaction = { kind: 'note', summary: '' };
        return loadContacts().then(renderAll);
      });
    }
    function doAddFollowUp(contactId) {
      const d = state.draft.followUp;
      if (!String(d.what).trim()) { state.error = 'A follow-up needs to say what it is.'; renderAll(); return; }
      const dueAt = d.dueAt ? Date.parse(d.dueAt) : null;
      post('/api/contacts/' + encodeURIComponent(contactId) + '/followups', { what: d.what, dueAt: dueAt }, 'Follow-up added.', function () {
        state.draft.followUp = { what: '', dueAt: '' };
        return loadContacts().then(renderAll);
      });
    }
    function doCreateContent() {
      const d = state.draft.content;
      if (!String(d.title).trim()) { state.error = 'A piece needs a title.'; renderAll(); return; }
      if (!d.channel) { state.error = 'Pick a channel.'; renderAll(); return; }
      post(bizPath('/content'), { title: d.title, channel: d.channel, brief: d.brief }, 'Piece added.', function () {
        state.draft.content = { title: '', channel: '', brief: '' };
        return loadContent().then(renderAll);
      });
    }
    /* The advance control is the ONE place the Commander crosses §17's line, so it sends the Commander as the
       actor explicitly. Nothing in this console ever advances a piece as an agent. */
    function doAdvanceContent(pieceId, stage) {
      post('/api/content/' + encodeURIComponent(pieceId) + '/advance', { stage: stage, actor: { kind: 'user', name: 'Commander' } },
        stage === 'publish' ? 'Published — you did that, not an agent.' : 'Moved to ' + label(CONTENT_STAGE_LABEL, stage) + '.',
        function () { return loadContent().then(renderAll); });
    }
    function doCreateDocument() {
      const d = state.draft.document;
      if (!String(d.title).trim()) { state.error = 'A document needs a title.'; renderAll(); return; }
      if (!d.type) { state.error = 'Pick a document type.'; renderAll(); return; }
      if (!String(d.body).trim()) { state.error = 'A document needs content — a title with nothing behind it is an empty promise.'; renderAll(); return; }
      post(bizPath('/documents'), { title: d.title, type: d.type, body: d.body }, 'Document saved.', function () {
        state.draft.document = { title: '', type: '', body: '' };
        return loadDocuments().then(renderAll);
      });
    }
    function doSearchDocuments() {
      const q = String(state.docQuery || '').trim();
      if (!q) { state.docHits = null; renderAll(); return Promise.resolve(); }
      return request('GET', api(bizPath('/documents/search') + '?q=' + encodeURIComponent(q))).then(function (r) {
        state.docHits = (r.ok && r.j && r.j.hits) || [];
        renderAll();
      });
    }
    function doAddKnowledge() {
      const d = state.draft.knowledge;
      const g = knowledgeGuard(d);
      if (!g.allowed) { state.error = g.reason; renderAll(); return; }
      const tags = String(d.tags || '').split(',').map(x => x.trim()).filter(Boolean);
      post(bizPath('/knowledge'), { kind: d.kind, title: d.title, body: d.body, ref: d.ref, source: d.source, tags: tags }, 'Stored.', function () {
        state.draft.knowledge = { kind: '', title: '', body: '', ref: '', source: '', tags: '' };
        return loadKnowledge().then(renderAll);
      });
    }
    function doRetrieveKnowledge() {
      const q = String(state.kbQuery || '').trim();
      if (!q) { state.kbHits = null; renderAll(); return Promise.resolve(); }
      return request('GET', api(bizPath('/knowledge/retrieve') + '?q=' + encodeURIComponent(q))).then(function (r) {
        state.kbHits = (r.ok && r.j) || null;
        renderAll();
      });
    }
    function doOpenExperiment() {
      const d = state.draft.experiment;
      if (!String(d.hypothesis).trim()) { state.error = 'An experiment must state a hypothesis.'; renderAll(); return; }
      const variants = String(d.variants || '').split(',').map(x => x.trim()).filter(Boolean);
      if (variants.length < 2) { state.error = 'An experiment needs at least two variants to compare (A vs B).'; renderAll(); return; }
      const metrics = String(d.metrics || '').split(',').map(x => x.trim()).filter(Boolean);
      post(bizPath('/experiments'), { hypothesis: d.hypothesis, variable: d.variable, variants: variants, metrics: metrics }, 'Experiment opened.', function () {
        state.draft.experiment = { hypothesis: '', variable: '', variants: '', metrics: '' };
        return loadExperiments().then(renderAll);
      });
    }
    function doRecordResult(expId) {
      const r = state.exp.result;
      if (!r.variant) { state.error = 'Name the variant this result came from.'; renderAll(); return; }
      if (!String(r.source).trim()) { state.error = 'A result needs a source (P1).'; renderAll(); return; }
      post('/api/experiments/' + encodeURIComponent(expId) + '/results',
        { variant: r.variant, metric: r.metric, value: Number(r.value), source: r.source, evidence: r.evidence }, 'Result recorded.',
        function () { return loadExperiments().then(renderAll); });
    }
    function doConclude(expId) {
      const x = (state.experiments || []).filter(e => e.id === expId)[0];
      const g = conclusionGuard(x, state.exp.conclusion, state.catalog && state.catalog.experiments && state.catalog.experiments.verdictGrade);
      if (!g.allowed) { state.error = g.reason; renderAll(); return; }
      post('/api/experiments/' + encodeURIComponent(expId) + '/conclude',
        { conclusion: state.exp.conclusion, reason: state.exp.reason, nextAction: state.exp.nextAction }, 'Concluded.',
        function () { return loadExperiments().then(renderAll); });
    }

    // ---- renderers ----
    function renderAll() {
      renderOverview(); renderProjects(); renderFinance(); renderAnalytics();
      renderCustomers(); renderContent(); renderLibrary(); renderExperiments();
    }

    function banner() {
      let html = '';
      if (state.error) html += '<div class="mg-err">' + esc(state.error) + '</div>';
      else if (state.notice) html += '<div class="mg-note">' + esc(state.notice) + '</div>';
      return html;
    }
    function bizPicker() {
      if (!state.businesses.length) return '<p class="mg-empty">No businesses yet. Create one in the Command Center first — the manager belongs to a business.</p>';
      return '<label class="mg-field"><span>BUSINESS</span><select id="mg-biz">' +
        state.businesses.map(b => '<option value="' + esc(b.id) + '"' + (b.id === state.businessId ? ' selected' : '') + '>' + esc(b.name) + '</option>').join('') +
        '</select></label>';
    }
    // ---- OVERVIEW ----
    function renderOverview() {
      const p = panes.overview; if (!p) return;
      let html = banner() + bizPicker();
      if (!state.businessId) { p.innerHTML = html; return; }
      const b = state.businesses.filter(x => x.id === state.businessId)[0];
      html += '<div class="mg-sum">' + esc(summaryLine(b, {
        projects: state.projects.length, transactions: state.transactions.length, readings: state.metricSummary.filter(m => m.readings).length,
        contacts: state.contacts.length, content: state.content.length, documents: state.documents.length,
        knowledge: state.knowledge.length, experiments: state.experiments.length
      })) + '</div>';

      // the §10 headline: RECORDED and ESTIMATED, side by side and never summed.
      const tv = totalsView(state.totals);
      if (!tv.length) html += '<p class="mg-empty">No financial figures recorded yet.</p>';
      else {
        html += '<div class="mg-totals">';
        for (const c of tv) {
          html += '<div class="mg-total">' +
            '<div class="mg-total-head">' + esc(c.currency) + '</div>' +
            '<div class="mg-total-rec"><div class="mg-total-tag">RECORDED</div>' +
              '<div class="mg-total-row"><span>revenue</span><b>' + esc(c.recorded.revenue) + '</b></div>' +
              '<div class="mg-total-row"><span>expenses</span><b>' + esc(c.recorded.expense) + '</b></div>' +
              '<div class="mg-total-row mg-profit' + (c.recorded.profitNegative ? ' mg-neg' : '') + '"><span>profit</span><b>' + esc(c.recorded.profit) + '</b></div>' +
              '<div class="mg-total-n">' + c.recorded.count + ' transaction(s)</div>' +
            '</div>';
          if (c.estimated.count) {
            html += '<div class="mg-total-est"><div class="mg-total-tag">AI ESTIMATE — held out, not added in</div>' +
              '<div class="mg-total-row"><span>revenue</span><b>' + esc(c.estimated.revenue) + '</b></div>' +
              '<div class="mg-total-row"><span>expenses</span><b>' + esc(c.estimated.expense) + '</b></div>' +
              '<div class="mg-total-n">' + c.estimated.count + ' estimate(s)</div>' +
            '</div>';
          } else {
            html += '<div class="mg-total-est mg-total-none">no AI estimates recorded</div>';
          }
          html += '</div>';
        }
        html += '</div>';
      }

      // §16's attention rules, named and with their inputs.
      const att = attentionRows(state.attention);
      html += '<div class="mg-att"><div class="mg-att-head">NEEDS ATTENTION</div>';
      const rules = (state.attention && state.attention.rules) || [];
      html += '<div class="mg-att-rules">Rules applied: ' + (rules.length ? rules.map(esc).join(' · ') : 'none (no clock supplied)') + '</div>';
      if (!att.length) html += '<p class="mg-empty">Nothing fires these rules right now.</p>';
      else {
        for (const a of att) {
          html += '<div class="mg-att-row mg-att-' + esc(a.kind) + '">' +
            '<span class="mg-att-who">' + esc(a.who) + '</span>' +
            '<span class="mg-att-what">' + esc(a.what) + '</span>' +
            '<span class="mg-att-detail">' + esc(a.detail) + '</span>' +
            '<span class="mg-att-rule">' + esc(a.rule) + '</span>' +
          '</div>';
        }
      }
      html += '</div>';
      p.innerHTML = html;
    }

    // ---- PROJECTS ----
    function renderProjects() {
      const p = panes.projects; if (!p) return;
      let html = banner() + bizPicker();
      if (!state.businessId) { p.innerHTML = html; return; }
      const rows = projectRows(state.projects);
      if (!rows.length) html += '<p class="mg-empty">No projects yet.</p>';
      else {
        html += '<div class="mg-rows">';
        for (const r of rows) {
          html += '<div class="mg-row' + (r.done ? ' mg-dim' : '') + '" data-id="' + esc(r.id) + '">' +
            '<div class="mg-row-main"><span class="mg-name">' + esc(r.name) + '</span>' +
            '<span class="mg-status mg-s-' + esc(r.status) + '">' + esc(r.statusLabel) + '</span></div>' +
            (r.goal ? '<div class="mg-row-sub">' + esc(r.goal) + '</div>' : '') +
            '<div class="mg-acts">' +
              '<button class="mg-btn" data-act="pstatus" data-id="' + esc(r.id) + '" data-status="active">ACTIVE</button>' +
              '<button class="mg-btn" data-act="pstatus" data-id="' + esc(r.id) + '" data-status="done">DONE</button>' +
              '<button class="mg-btn mg-danger" data-act="pdel" data-id="' + esc(r.id) + '">REMOVE</button>' +
            '</div>' +
          '</div>';
        }
        html += '</div>';
      }
      html += '<div class="mg-form">' +
        '<div class="mg-form-head">NEW PROJECT</div>' +
        '<label class="mg-field"><span>NAME</span><input id="mg-pname" type="text" value="' + esc(state.draft.project.name) + '"></label>' +
        '<label class="mg-field"><span>GOAL</span><textarea id="mg-pgoal" rows="2">' + esc(state.draft.project.goal) + '</textarea></label>' +
        '<button class="mg-btn mg-primary" id="mg-pcreate"' + (state.busy ? ' disabled' : '') + '>CREATE</button>' +
      '</div>';
      p.innerHTML = html;
    }

    // ---- FINANCE ----
    function renderFinance() {
      const p = panes.finance; if (!p) return;
      let html = banner() + bizPicker();
      if (!state.businessId) { p.innerHTML = html; return; }

      const tv = totalsView(state.totals);
      html += '<div class="mg-totals">';
      for (const c of tv) {
        html += '<div class="mg-total"><div class="mg-total-head">' + esc(c.currency) + '</div>' +
          '<div class="mg-total-rec"><div class="mg-total-tag">RECORDED — real money</div>' +
            '<div class="mg-total-row"><span>revenue</span><b>' + esc(c.recorded.revenue) + '</b></div>' +
            '<div class="mg-total-row"><span>expenses</span><b>' + esc(c.recorded.expense) + '</b></div>' +
            '<div class="mg-total-row mg-profit' + (c.recorded.profitNegative ? ' mg-neg' : '') + '"><span>profit</span><b>' + esc(c.recorded.profit) + '</b></div>' +
          '</div>' +
          '<div class="mg-total-est"><div class="mg-total-tag">AI ESTIMATE — never added to the figure above</div>' +
            '<div class="mg-total-row"><span>revenue</span><b>' + esc(c.estimated.revenue) + '</b></div>' +
            '<div class="mg-total-row"><span>expenses</span><b>' + esc(c.estimated.expense) + '</b></div>' +
          '</div>' +
        '</div>';
      }
      html += '</div>';

      const rows = transactionRows(state.transactions, Date.now()).slice().reverse();
      if (!rows.length) html += '<p class="mg-empty">No transactions yet.</p>';
      else {
        html += '<div class="mg-rows">';
        for (const t of rows) {
          html += '<div class="mg-row mg-tx' + (t.isEstimate ? ' mg-est' : '') + '">' +
            '<div class="mg-row-main"><span class="mg-kind mg-k-' + esc(t.kind) + '">' + esc(t.kindLabel) + '</span>' +
            '<span class="mg-amt">' + esc(t.amountText) + '</span>' +
            '<span class="mg-cat">' + esc(t.category) + '</span>' +
            '<span class="mg-prov mg-p-' + esc(t.provenance) + '">' + esc(t.provenanceLabel) + '</span>' +
            '<span class="mg-when">' + esc(t.when) + '</span></div>' +
            (t.basis ? '<div class="mg-row-sub">basis: ' + esc(t.basis) + '</div>' : '') +
            (t.source ? '<div class="mg-row-sub">source: ' + esc(t.source) + '</div>' : '') +
            '<div class="mg-acts"><button class="mg-btn mg-danger" data-act="txdel" data-id="' + esc(t.id) + '">REMOVE</button></div>' +
          '</div>';
        }
        html += '</div>';
      }

      const d = state.draft.txn;
      html += '<div class="mg-form">' +
        '<div class="mg-form-head">RECORD A TRANSACTION</div>' +
        '<div class="mg-form-inline">' +
          '<label class="mg-field"><span>KIND</span><select id="mg-tkind">' + optionsFrom(catList('finance', 'kinds'), KIND_LABEL, d.kind) + '</select></label>' +
          '<label class="mg-field"><span>AMOUNT</span><input id="mg-tamt" type="number" min="0" step="0.01" value="' + esc(d.amount) + '"></label>' +
          '<label class="mg-field"><span>CURRENCY</span><input id="mg-tcur" type="text" maxlength="3" value="' + esc(d.currency) + '"></label>' +
        '</div>' +
        '<div class="mg-form-inline">' +
          '<label class="mg-field"><span>CATEGORY</span><select id="mg-tcat"><option value="">— pick —</option>' +
            ((d.kind === 'revenue' ? catList('finance', 'revenueCategories') : catList('finance', 'expenseCategories')) || [])
              .map(c => '<option value="' + esc(c) + '"' + (c === d.category ? ' selected' : '') + '>' + esc(c) + '</option>').join('') +
          '</select></label>' +
          '<label class="mg-field"><span>WHERE IT CAME FROM</span><select id="mg-tprov">' + provenanceOptions(catList('finance', 'provenance'), d.provenance) + '</select></label>' +
        '</div>' +
        (d.provenance === 'ai-estimate' ? '<label class="mg-field"><span>BASIS — why the AI thinks so (required)</span><input id="mg-tbasis" type="text" value="' + esc(d.basis) + '"></label>' : '') +
        (d.provenance === 'imported' ? '<label class="mg-field"><span>SOURCE — which file or system (required)</span><input id="mg-tsource" type="text" value="' + esc(d.source) + '"></label>' : '') +
        '<label class="mg-field"><span>NOTE</span><input id="mg-tnote" type="text" value="' + esc(d.note) + '"></label>' +
        '<button class="mg-btn mg-primary" id="mg-tcreate"' + (state.busy ? ' disabled' : '') + '>RECORD</button>' +
      '</div>';

      // budgets
      html += '<div class="mg-form"><div class="mg-form-head">BUDGETS — compared against RECORDED expenses only</div>';
      if (state.budgetStatus && state.budgetStatus.categories.length) {
        for (const bd of state.budgetStatus.categories) {
          html += '<div class="mg-budget' + (bd.over ? ' mg-over' : '') + '">' +
            '<span>' + esc(bd.category) + '</span>' +
            '<span>' + esc(money(bd.spent, state.budgetStatus.currency)) + ' / ' + esc(money(bd.budget, state.budgetStatus.currency)) + '</span>' +
            '<span>' + (bd.over ? 'OVER by ' + esc(money(-bd.remaining, state.budgetStatus.currency)) : esc(money(bd.remaining, state.budgetStatus.currency)) + ' left') + '</span>' +
          '</div>';
        }
        if (state.budgetStatus.excludedEstimates) {
          html += '<div class="mg-hint">' + state.budgetStatus.excludedEstimates + ' AI estimate(s) held out of this comparison.</div>';
        }
      } else html += '<p class="mg-empty">No budgets set.</p>';
      html += '<div class="mg-form-inline">' +
        '<label class="mg-field"><span>CATEGORY</span><select id="mg-bcat"><option value="">— pick —</option>' +
          ((catList('finance', 'expenseCategories') || []).concat(['*'])).map(c => '<option value="' + esc(c) + '">' + esc(c === '*' ? '* (whole business)' : c) + '</option>').join('') +
        '</select></label>' +
        '<label class="mg-field"><span>AMOUNT</span><input id="mg-bamt" type="number" min="0" step="0.01" value="' + esc(state.draft.budget.amount) + '"></label>' +
        '<label class="mg-field"><span>CURRENCY</span><input id="mg-bcur" type="text" maxlength="3" value="' + esc(state.draft.budget.currency) + '"></label>' +
      '</div><button class="mg-btn" id="mg-bset">SET BUDGET</button></div>';

      // prices
      html += '<div class="mg-form"><div class="mg-form-head">PRICES</div>';
      if (state.prices.length) {
        for (const pr of state.prices) {
          html += '<div class="mg-price"><span>' + esc(pr.sku) + '</span><span>' + esc(money(pr.amount, pr.currency)) + '</span></div>';
        }
      } else html += '<p class="mg-empty">No prices set.</p>';
      html += '<div class="mg-form-inline">' +
        '<label class="mg-field"><span>SKU</span><input id="mg-psku" type="text" value="' + esc(state.draft.price.sku) + '"></label>' +
        '<label class="mg-field"><span>AMOUNT</span><input id="mg-pamt" type="number" min="0" step="0.01" value="' + esc(state.draft.price.amount) + '"></label>' +
        '<label class="mg-field"><span>CURRENCY</span><input id="mg-pcur" type="text" maxlength="3" value="' + esc(state.draft.price.currency) + '"></label>' +
      '</div><button class="mg-btn" id="mg-pset">SET PRICE</button></div>';
      p.innerHTML = html;
    }

    // ---- ANALYTICS ----
    function renderAnalytics() {
      const p = panes.analytics; if (!p) return;
      let html = banner() + bizPicker();
      if (!state.businessId) { p.innerHTML = html; return; }

      const rows = metricRows(state.metricSummary);
      html += '<div class="mg-metrics">';
      for (const m of rows) {
        html += '<div class="mg-metric' + (m.recorded ? '' : ' mg-unrec') + '" data-metric="' + esc(m.metric) + '">' +
          '<div class="mg-metric-label">' + esc(m.label) + '</div>' +
          '<div class="mg-metric-value">' + esc(m.valueText) + '</div>' +
          '<div class="mg-metric-sub">' + (m.recorded ? esc(m.evidenceLabel) + ' · ' + esc(m.readings) + ' reading(s)' : 'no reading on record') + '</div>' +
        '</div>';
      }
      html += '</div>';

      if (state.series && state.series.buckets && state.series.buckets.length) {
        const bs = state.series.buckets;
        const max = bs.reduce((t, b) => Math.max(t, Number(b.value) || 0), 0) || 1;
        html += '<div class="mg-series"><div class="mg-form-head">' + esc(state.seriesMetric) + ' over ' + bs.length + ' bucket(s)</div>';
        for (const b of bs) {
          const w = Math.round(((Number(b.value) || 0) / max) * 100);
          html += '<div class="mg-bar"><span class="mg-bar-v">' + esc(b.value == null ? '—' : b.value) + '</span>' +
            '<span class="mg-bar-fill" style="width:' + w + '%"></span></div>';
        }
        html += '</div>';
      }

      const d = state.draft.metric;
      html += '<div class="mg-form">' +
        '<div class="mg-form-head">RECORD A READING</div>' +
        '<div class="mg-form-inline">' +
          '<label class="mg-field"><span>METRIC</span><select id="mg-mmetric">' + metricOptions((state.catalog && state.catalog.metrics) || [], d.metric) + '</select></label>' +
          '<label class="mg-field"><span>VALUE</span><input id="mg-mvalue" type="number" step="any" min="0" value="' + esc(d.value) + '"></label>' +
          '<label class="mg-field"><span>EVIDENCE</span><select id="mg-mevidence">' + optionsFrom((state.catalog && state.catalog.evidence) || [], EVIDENCE_LABEL, d.evidence) + '</select></label>' +
        '</div>' +
        '<label class="mg-field"><span>SOURCE — where the number came from (required)</span><input id="mg-msource" type="text" value="' + esc(d.source) + '"></label>' +
        '<button class="mg-btn mg-primary" id="mg-mrecord"' + (state.busy ? ' disabled' : '') + '>RECORD</button>' +
      '</div>';
      p.innerHTML = html;
    }

    // ---- CUSTOMERS ----
    function renderCustomers() {
      const p = panes.customers; if (!p) return;
      let html = banner() + bizPicker();
      if (!state.businessId) { p.innerHTML = html; return; }

      const att = attentionRows(state.attention);
      if (att.length) {
        html += '<div class="mg-att"><div class="mg-att-head">NEEDS ATTENTION — named rules, not a score</div>';
        for (const a of att) {
          html += '<div class="mg-att-row mg-att-' + esc(a.kind) + '"><span class="mg-att-who">' + esc(a.who) + '</span>' +
            '<span class="mg-att-what">' + esc(a.what) + '</span><span class="mg-att-detail">' + esc(a.detail) + '</span>' +
            '<span class="mg-att-rule">' + esc(a.rule) + '</span></div>';
        }
        html += '</div>';
      }

      const rows = contactRows(state.contacts, Date.now());
      if (!rows.length) html += '<p class="mg-empty">No contacts yet.</p>';
      else {
        html += '<div class="mg-rows">';
        for (const c of rows) {
          html += '<div class="mg-row' + (c.id === state.selectedContact ? ' mg-sel' : '') + '" data-id="' + esc(c.id) + '">' +
            '<div class="mg-row-main"><span class="mg-name">' + esc(c.name) + '</span>' +
            '<span class="mg-stage mg-st-' + esc(c.stage) + '">' + esc(c.stageLabel) + '</span>' +
            (c.org ? '<span class="mg-org">' + esc(c.org) + '</span>' : '') +
            (c.openFollowUps ? '<span class="mg-open">' + c.openFollowUps + ' open</span>' : '') +
            '</div>' +
            (c.email ? '<div class="mg-row-sub">' + esc(c.email) + '</div>' : '') +
            (c.interactions.length ? '<div class="mg-ints">' + c.interactions.slice(-3).map(i =>
              '<div class="mg-int"><span class="mg-int-kind">' + esc(i.kindLabel) + '</span>' + esc(i.summary) + '<span class="mg-when">' + esc(i.when) + '</span></div>').join('') + '</div>' : '') +
            (c.followUps.length ? '<div class="mg-fus">' + c.followUps.map(f =>
              '<div class="mg-fu' + (f.done ? ' mg-dim' : '') + '"><span>' + esc(f.what) + '</span><span class="mg-when">' + esc(f.dueText) + '</span>' +
              (f.done ? '' : '<button class="mg-btn" data-act="fudone" data-id="' + esc(f.id) + '">DONE</button>') + '</div>').join('') + '</div>' : '') +
            '<div class="mg-acts">' +
              '<button class="mg-btn" data-act="cstage" data-id="' + esc(c.id) + '" data-status="prospect">PROSPECT</button>' +
              '<button class="mg-btn" data-act="cstage" data-id="' + esc(c.id) + '" data-status="customer">CUSTOMER</button>' +
              '<button class="mg-btn" data-act="cinspect" data-id="' + esc(c.id) + '">LOG / FOLLOW UP</button>' +
              '<button class="mg-btn mg-danger" data-act="cdel" data-id="' + esc(c.id) + '">REMOVE</button>' +
            '</div>' +
          '</div>';
        }
        html += '</div>';
      }

      html += '<div class="mg-form">' +
        '<div class="mg-form-head">ADD A CONTACT</div>' +
        '<div class="mg-form-inline">' +
          '<label class="mg-field"><span>NAME</span><input id="mg-cname" type="text" value="' + esc(state.draft.contact.name) + '"></label>' +
          '<label class="mg-field"><span>EMAIL</span><input id="mg-cemail" type="text" value="' + esc(state.draft.contact.email) + '"></label>' +
          '<label class="mg-field"><span>ORG</span><input id="mg-corg" type="text" value="' + esc(state.draft.contact.org) + '"></label>' +
          '<label class="mg-field"><span>STAGE</span><select id="mg-cstage">' + optionsFrom(catList('crm', 'stages'), STAGE_LABEL, state.draft.contact.stage) + '</select></label>' +
        '</div>' +
        '<button class="mg-btn mg-primary" id="mg-cadd"' + (state.busy ? ' disabled' : '') + '>ADD</button>' +
      '</div>';

      if (state.selectedContact) {
        const sel = rows.filter(r => r.id === state.selectedContact)[0];
        html += '<div class="mg-form"><div class="mg-form-head">' + esc(sel ? sel.name : state.selectedContact) + '</div>' +
          '<div class="mg-form-inline">' +
            '<label class="mg-field"><span>LOG AN INTERACTION</span><select id="mg-ikind">' + optionsFrom(catList('crm', 'interactionKinds'), INTERACTION_LABEL, state.draft.interaction.kind) + '</select></label>' +
            '<label class="mg-field"><span>WHAT HAPPENED</span><input id="mg-isummary" type="text" value="' + esc(state.draft.interaction.summary) + '"></label>' +
          '</div>' +
          '<button class="mg-btn" id="mg-ilog">LOG</button>' +
          '<div class="mg-form-inline">' +
            '<label class="mg-field"><span>FOLLOW UP</span><input id="mg-fwhat" type="text" value="' + esc(state.draft.followUp.what) + '"></label>' +
            '<label class="mg-field"><span>DUE</span><input id="mg-fdue" type="date" value="' + esc(state.draft.followUp.dueAt) + '"></label>' +
          '</div>' +
          '<button class="mg-btn" id="mg-fadd">ADD FOLLOW-UP</button>' +
        '</div>';
      }
      p.innerHTML = html;
    }

    // ---- CONTENT ----
    function renderContent() {
      const p = panes.content; if (!p) return;
      let html = banner() + bizPicker();
      if (!state.businessId) { p.innerHTML = html; return; }

      const stages = catList('content', 'stages');
      const board = contentBoard(state.content, stages);
      html += '<div class="mg-board">';
      for (const col of board) {
        html += '<div class="mg-col"><div class="mg-col-head">' + esc(col.label) + ' <span class="mg-col-n">' + col.items.length + '</span></div>';
        for (const it of col.items) {
          html += '<div class="mg-card" data-id="' + esc(it.id) + '">' +
            '<div class="mg-card-title">' + esc(it.title) + '</div>' +
            '<div class="mg-card-sub">' + esc(it.channelLabel) + (it.published ? ' · published by ' + esc(it.publishedBy || 'you') : '') + '</div>' +
            '<div class="mg-acts">' + nextStageButtons(it, stages) + '</div>' +
          '</div>';
        }
        html += '</div>';
      }
      html += '</div>';
      html += '<div class="mg-hint">Moving a piece to PUBLISH or ANALYTICS is recorded as YOUR action. The sidecar refuses an agent actor for those two stages (§17), so an agent cannot put anything live.</div>';

      const d = state.draft.content;
      html += '<div class="mg-form">' +
        '<div class="mg-form-head">NEW PIECE</div>' +
        '<div class="mg-form-inline">' +
          '<label class="mg-field"><span>TITLE</span><input id="mg-ntitle" type="text" value="' + esc(d.title) + '"></label>' +
          '<label class="mg-field"><span>CHANNEL</span><select id="mg-nchannel"><option value="">— pick —</option>' +
            (catList('content', 'channels') || []).map(c => '<option value="' + esc(c) + '"' + (c === d.channel ? ' selected' : '') + '>' + esc(label(CHANNEL_LABEL, c)) + '</option>').join('') +
          '</select></label>' +
        '</div>' +
        '<label class="mg-field"><span>BRIEF</span><textarea id="mg-nbrief" rows="2">' + esc(d.brief) + '</textarea></label>' +
        '<button class="mg-btn mg-primary" id="mg-ncreate"' + (state.busy ? ' disabled' : '') + '>ADD</button>' +
      '</div>';
      p.innerHTML = html;
    }
    function nextStageButtons(it, stages) {
      const i = (stages || []).indexOf(it.stage);
      if (i < 0 || i >= stages.length - 1) return '<span class="mg-done">end of pipeline</span>';
      const next = stages[i + 1];
      const publish = (catList('content', 'publishStages') || []).indexOf(next) >= 0;
      return '<button class="mg-btn' + (publish ? ' mg-publish' : '') + '" data-act="advance" data-id="' + esc(it.id) + '" data-stage="' + esc(next) + '">' +
        (publish ? 'PUBLISH (you)' : '→ ' + esc(label(CONTENT_STAGE_LABEL, next))) + '</button>' +
        '<button class="mg-btn mg-danger" data-act="ndel" data-id="' + esc(it.id) + '">X</button>';
    }

    // ---- LIBRARY (documents + knowledge) ----
    function renderLibrary() {
      const p = panes.library; if (!p) return;
      let html = banner() + bizPicker();
      if (!state.businessId) { p.innerHTML = html; return; }

      html += '<div class="mg-form-head">DOCUMENTS — what the business wrote</div>';
      html += '<div class="mg-form-inline">' +
        '<label class="mg-field"><span>SEARCH</span><input id="mg-dq" type="text" value="' + esc(state.docQuery) + '"></label>' +
        '<button class="mg-btn" id="mg-dsearch">SEARCH</button>' +
        (state.docHits ? '<button class="mg-btn" id="mg-dclear">CLEAR</button>' : '') +
      '</div>';
      if (state.docHits) {
        if (!state.docHits.length) html += '<p class="mg-empty">No document mentions that.</p>';
        else {
          for (const h of state.docHits) {
            html += '<div class="mg-hit"><div class="mg-hit-head"><span>' + esc(h.title) + '</span>' +
              '<span class="mg-hit-type">' + esc(label(DOC_TYPE_LABEL, h.type)) + '</span>' +
              '<span class="mg-hit-where">in ' + esc(h.matchedIn) + '</span></div>' +
              '<div class="mg-hit-body">' + esc(h.excerpt) + '</div></div>';
          }
        }
      }
      const docs = documentRows(state.documents);
      if (!docs.length) html += '<p class="mg-empty">No documents yet.</p>';
      else {
        html += '<div class="mg-rows">';
        for (const d of docs) {
          html += '<div class="mg-row"><div class="mg-row-main"><span class="mg-name">' + esc(d.title) + '</span>' +
            '<span class="mg-type">' + esc(d.typeLabel) + '</span>' +
            '<span class="mg-status">' + esc(d.statusLabel) + '</span>' +
            '<span class="mg-chars">' + d.chars + ' chars</span></div>' +
            '<div class="mg-acts"><button class="mg-btn mg-danger" data-act="ddel" data-id="' + esc(d.id) + '">REMOVE</button></div></div>';
        }
        html += '</div>';
      }
      const dd = state.draft.document;
      html += '<div class="mg-form"><div class="mg-form-head">NEW DOCUMENT</div>' +
        '<div class="mg-form-inline">' +
          '<label class="mg-field"><span>TITLE</span><input id="mg-dtitle" type="text" value="' + esc(dd.title) + '"></label>' +
          '<label class="mg-field"><span>TYPE</span><select id="mg-dtype"><option value="">— pick —</option>' +
            (catList('documents', 'types') || []).map(t => '<option value="' + esc(t) + '"' + (t === dd.type ? ' selected' : '') + '>' + esc(label(DOC_TYPE_LABEL, t)) + '</option>').join('') +
          '</select></label>' +
        '</div>' +
        '<label class="mg-field"><span>BODY</span><textarea id="mg-dbody" rows="4">' + esc(dd.body) + '</textarea></label>' +
        '<button class="mg-btn mg-primary" id="mg-dcreate"' + (state.busy ? ' disabled' : '') + '>SAVE</button></div>';

      html += '<div class="mg-form-head">KNOWLEDGE — what the business collected</div>';
      html += '<div class="mg-form-inline">' +
        '<label class="mg-field"><span>RETRIEVE</span><input id="mg-kq" type="text" value="' + esc(state.kbQuery) + '"></label>' +
        '<button class="mg-btn" id="mg-kretrieve">RETRIEVE</button>' +
      '</div>';
      if (state.kbHits && state.kbHits.hits) {
        html += '<div class="mg-hint">' + esc(state.kbHits.termOverlapNote) + '</div>';
        if (!state.kbHits.hits.length) html += '<p class="mg-empty">Nothing in the library mentions that.</p>';
        else {
          for (const h of state.kbHits.hits) {
            html += '<div class="mg-hit"><div class="mg-hit-head"><span>' + esc(h.title) + '</span>' +
              '<span class="mg-hit-type">' + esc(label(KB_KIND_LABEL, h.kind)) + '</span>' +
              '<span class="mg-hit-where">' + h.termOverlap + '/' + h.queryTerms + ' terms' + (h.inTitle ? ' · title' : '') + '</span></div>' +
              '<div class="mg-hit-body">matched: ' + esc((h.matched || []).join(', ')) + '</div></div>';
          }
        }
      }
      const ks = knowledgeRows(state.knowledge, Date.now());
      if (!ks.length) html += '<p class="mg-empty">Nothing stored yet.</p>';
      else {
        html += '<div class="mg-rows">';
        for (const k of ks) {
          html += '<div class="mg-row"><div class="mg-row-main"><span class="mg-kind">' + esc(k.kindLabel) + '</span>' +
            '<span class="mg-name">' + esc(k.title) + '</span>' +
            (k.tags.length ? '<span class="mg-tags">' + esc(k.tags.join(' ')) + '</span>' : '') +
            '<span class="mg-when">' + esc(k.when) + '</span></div>' +
            '<div class="mg-row-sub">source: ' + esc(k.source) + (k.ref ? ' · ref: ' + esc(k.ref) : '') + '</div>' +
            '<div class="mg-acts"><button class="mg-btn mg-danger" data-act="kdel" data-id="' + esc(k.id) + '">FORGET</button></div></div>';
        }
        html += '</div>';
      }
      const kd = state.draft.knowledge;
      html += '<div class="mg-form"><div class="mg-form-head">STORE A SOURCE</div>' +
        '<div class="mg-form-inline">' +
          '<label class="mg-field"><span>KIND</span><select id="mg-kkind"><option value="">— pick —</option>' +
            (catList('knowledge', 'kinds') || []).map(k => '<option value="' + esc(k) + '"' + (k === kd.kind ? ' selected' : '') + '>' + esc(label(KB_KIND_LABEL, k)) + '</option>').join('') +
          '</select></label>' +
          '<label class="mg-field"><span>TITLE</span><input id="mg-ktitle" type="text" value="' + esc(kd.title) + '"></label>' +
          '<label class="mg-field"><span>SOURCE (required)</span><input id="mg-ksource" type="text" value="' + esc(kd.source) + '"></label>' +
        '</div>' +
        '<div class="mg-form-inline">' +
          '<label class="mg-field"><span>REFERENCE (url or path)</span><input id="mg-kref" type="text" value="' + esc(kd.ref) + '"></label>' +
          '<label class="mg-field"><span>TAGS (comma separated)</span><input id="mg-ktags" type="text" value="' + esc(kd.tags) + '"></label>' +
        '</div>' +
        '<label class="mg-field"><span>TEXT</span><textarea id="mg-kbody" rows="3">' + esc(kd.body) + '</textarea></label>' +
        '<button class="mg-btn mg-primary" id="mg-kadd"' + (state.busy ? ' disabled' : '') + '>STORE</button></div>';
      p.innerHTML = html;
    }

    // ---- EXPERIMENTS ----
    function renderExperiments() {
      const p = panes.experiments; if (!p) return;
      let html = banner() + bizPicker();
      if (!state.businessId) { p.innerHTML = html; return; }

      const rows = experimentRows(state.experiments, Date.now());
      if (!rows.length) html += '<p class="mg-empty">No experiments yet.</p>';
      else {
        html += '<div class="mg-rows">';
        for (const x of rows) {
          const isSel = x.id === state.exp.selected;
          html += '<div class="mg-row' + (isSel ? ' mg-sel' : '') + '" data-id="' + esc(x.id) + '">' +
            '<div class="mg-row-main"><span class="mg-hyp">' + esc(x.hypothesis) + '</span>' +
            '<span class="mg-status mg-x-' + esc(x.status) + '">' + esc(x.statusLabel) + '</span>' +
            (x.conclusion ? '<span class="mg-conc mg-c-' + esc(x.conclusion) + '">' + esc(x.conclusionLabel) + '</span>' : '') +
            '</div>' +
            '<div class="mg-row-sub">arms: ' + esc(x.variants.join(' vs ')) + ' · measures: ' + esc(x.metrics.join(', ') || '(none)') + ' · ' + x.resultCount + ' result(s)</div>' +
            (x.reason ? '<div class="mg-row-sub">because: ' + esc(x.reason) + '</div>' : '') +
            (x.nextAction ? '<div class="mg-row-sub">next: ' + esc(x.nextAction) + '</div>' : '') +
            '<div class="mg-acts">' +
              (x.status === 'planned' ? '<button class="mg-btn" data-act="xstart" data-id="' + esc(x.id) + '">START</button>' : '') +
              (x.status === 'running' ? '<button class="mg-btn" data-act="xend" data-id="' + esc(x.id) + '">END</button>' : '') +
              '<button class="mg-btn" data-act="xselect" data-id="' + esc(x.id) + '">RESULTS / CONCLUDE</button>' +
              '<button class="mg-btn mg-danger" data-act="xdel" data-id="' + esc(x.id) + '">REMOVE</button>' +
            '</div>' +
          '</div>';
        }
        html += '</div>';
      }

      if (state.exp.selected) {
        const x = (state.experiments || []).filter(e => e.id === state.exp.selected)[0];
        const grade = (state.catalog && state.catalog.experiments && state.catalog.experiments.verdictGrade) || ['verified', 'analysis'];
        const gate = conclusionGuard(x, state.exp.conclusion || 'supported', grade);
        html += '<div class="mg-form"><div class="mg-form-head">RESULTS — ' + esc(x ? x.hypothesis : '') + '</div>' +
          '<div class="mg-form-inline">' +
            '<label class="mg-field"><span>VARIANT</span><select id="mg-xrvariant"><option value="">— pick —</option>' +
              ((x && x.variants) || []).map(v => '<option value="' + esc(v) + '"' + (v === state.exp.result.variant ? ' selected' : '') + '>' + esc(v) + '</option>').join('') +
            '</select></label>' +
            '<label class="mg-field"><span>METRIC</span><select id="mg-xrmetric"><option value="">— pick —</option>' +
              ((x && x.metrics) || []).map(m => '<option value="' + esc(m) + '"' + (m === state.exp.result.metric ? ' selected' : '') + '>' + esc(m) + '</option>').join('') +
            '</select></label>' +
            '<label class="mg-field"><span>VALUE</span><input id="mg-xrvalue" type="number" step="any" value="' + esc(state.exp.result.value) + '"></label>' +
            '<label class="mg-field"><span>EVIDENCE</span><select id="mg-xrevidence">' + optionsFrom((state.catalog && state.catalog.evidence) || [], EVIDENCE_LABEL, state.exp.result.evidence) + '</select></label>' +
          '</div>' +
          '<label class="mg-field"><span>SOURCE (required)</span><input id="mg-xrsource" type="text" value="' + esc(state.exp.result.source) + '"></label>' +
          '<button class="mg-btn" id="mg-xrrecord">RECORD RESULT</button>' +
          '<div class="mg-form-head">CONCLUDE</div>' +
          '<div class="mg-form-inline">' +
            '<label class="mg-field"><span>CONCLUSION</span><select id="mg-xconc"><option value="">— pick —</option>' +
              ((state.catalog && state.catalog.experiments && state.catalog.experiments.conclusions) || [])
                .map(c => '<option value="' + esc(c) + '"' + (c === state.exp.conclusion ? ' selected' : '') + '>' + esc(label(CONCLUSION_LABEL, c)) + '</option>').join('') +
            '</select></label>' +
          '</div>' +
          (gate.allowed ? '' : '<div class="mg-hint mg-blocked">' + esc(gate.reason) + '</div>') +
          '<label class="mg-field"><span>REASON</span><input id="mg-xreason" type="text" value="' + esc(state.exp.reason) + '"></label>' +
          '<label class="mg-field"><span>NEXT ACTION</span><input id="mg-xnext" type="text" value="' + esc(state.exp.nextAction) + '"></label>' +
          '<button class="mg-btn mg-primary" id="mg-xconclude"' + (gate.allowed ? '' : ' disabled') + '>CONCLUDE</button>' +
        '</div>';
      }

      const d = state.draft.experiment;
      html += '<div class="mg-form"><div class="mg-form-head">NEW EXPERIMENT</div>' +
        '<label class="mg-field"><span>HYPOTHESIS</span><input id="mg-xhyp" type="text" value="' + esc(d.hypothesis) + '"></label>' +
        '<div class="mg-form-inline">' +
          '<label class="mg-field"><span>VARIABLE</span><input id="mg-xvar" type="text" value="' + esc(d.variable) + '" placeholder="what is being varied"></label>' +
          '<label class="mg-field"><span>ARMS (comma separated, min 2)</span><input id="mg-xarms" type="text" value="' + esc(d.variants) + '" placeholder="Product A, Product B"></label>' +
          '<label class="mg-field"><span>METRICS (§11 ids)</span><input id="mg-xmetrics" type="text" value="' + esc(d.metrics) + '" placeholder="conversion-rate"></label>' +
        '</div>' +
        '<button class="mg-btn mg-primary" id="mg-xopen"' + (state.busy ? ' disabled' : '') + '>OPEN</button></div>';
      p.innerHTML = html;
    }

    // ---- wiring ----
    const val = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
    function bindPane(pane, handler) {
      if (!pane) return;
      pane.addEventListener('change', handler);
      pane.addEventListener('click', handler);
    }

    const onOverview = function (ev) {
      const t = ev.target;
      if (t && t.id === 'mg-biz') { state.businessId = t.value; state.selectedContact = ''; state.exp.selected = ''; refresh(); }
    };

    const onProjects = function (ev) {
      const t = ev.target;
      if (t && t.id === 'mg-biz') { state.businessId = t.value; refresh(); return; }
      if (t && t.id === 'mg-pname') { state.draft.project.name = t.value; return; }
      if (t && t.id === 'mg-pgoal') { state.draft.project.goal = t.value; return; }
      if (t && t.id === 'mg-pcreate') { doCreateProject(); return; }
      const act = t && t.getAttribute ? t.getAttribute('data-act') : null;
      if (act === 'pstatus') { patch('/api/projects/' + encodeURIComponent(t.getAttribute('data-id')), { status: t.getAttribute('data-status') }, 'Project updated.', function () { return loadProjects().then(renderAll); }); return; }
      if (act === 'pdel') { arm(t, 'CONFIRM REMOVE', function () { del('/api/projects/' + encodeURIComponent(t.getAttribute('data-id')), 'Project removed.'); }); }
    };

    const onFinance = function (ev) {
      const t = ev.target;
      if (t && t.id === 'mg-biz') { state.businessId = t.value; refresh(); return; }
      if (t && t.id === 'mg-tkind') { state.draft.txn.kind = t.value; state.draft.txn.category = ''; renderFinance(); return; }
      if (t && t.id === 'mg-tamt') { state.draft.txn.amount = t.value; return; }
      if (t && t.id === 'mg-tcur') { state.draft.txn.currency = t.value; return; }
      if (t && t.id === 'mg-tcat') { state.draft.txn.category = t.value; return; }
      if (t && t.id === 'mg-tprov') { state.draft.txn.provenance = t.value; renderFinance(); return; }
      if (t && t.id === 'mg-tbasis') { state.draft.txn.basis = t.value; return; }
      if (t && t.id === 'mg-tsource') { state.draft.txn.source = t.value; return; }
      if (t && t.id === 'mg-tnote') { state.draft.txn.note = t.value; return; }
      if (t && t.id === 'mg-tcreate') { doCreateTxn(); return; }
      if (t && t.id === 'mg-bcat') { state.draft.budget.category = t.value; return; }
      if (t && t.id === 'mg-bamt') { state.draft.budget.amount = t.value; return; }
      if (t && t.id === 'mg-bcur') { state.draft.budget.currency = t.value; return; }
      if (t && t.id === 'mg-bset') { doSetBudget(); return; }
      if (t && t.id === 'mg-psku') { state.draft.price.sku = t.value; return; }
      if (t && t.id === 'mg-pamt') { state.draft.price.amount = t.value; return; }
      if (t && t.id === 'mg-pcur') { state.draft.price.currency = t.value; return; }
      if (t && t.id === 'mg-pset') { doSetPrice(); return; }
      const act = t && t.getAttribute ? t.getAttribute('data-act') : null;
      if (act === 'txdel') arm(t, 'CONFIRM REMOVE', function () { del('/api/finance/' + encodeURIComponent(t.getAttribute('data-id')), 'Transaction removed.', function () { return loadFinance().then(renderAll); }); });
    };

    const onAnalytics = function (ev) {
      const t = ev.target;
      if (t && t.id === 'mg-biz') { state.businessId = t.value; refresh(); return; }
      if (t && t.id === 'mg-mmetric') { state.draft.metric.metric = t.value; return; }
      if (t && t.id === 'mg-mvalue') { state.draft.metric.value = t.value; return; }
      if (t && t.id === 'mg-mevidence') { state.draft.metric.evidence = t.value; return; }
      if (t && t.id === 'mg-msource') { state.draft.metric.source = t.value; return; }
      if (t && t.id === 'mg-mrecord') { doRecordMetric(); return; }
      const card = t && t.closest ? t.closest('.mg-metric') : null;
      if (card) { state.seriesMetric = card.getAttribute('data-metric'); loadSeries().then(renderAll); }
    };

    const onCustomers = function (ev) {
      const t = ev.target;
      if (t && t.id === 'mg-biz') { state.businessId = t.value; refresh(); return; }
      if (t && t.id === 'mg-cname') { state.draft.contact.name = t.value; return; }
      if (t && t.id === 'mg-cemail') { state.draft.contact.email = t.value; return; }
      if (t && t.id === 'mg-corg') { state.draft.contact.org = t.value; return; }
      if (t && t.id === 'mg-cstage') { state.draft.contact.stage = t.value; return; }
      if (t && t.id === 'mg-cadd') { doAddContact(); return; }
      if (t && t.id === 'mg-ikind') { state.draft.interaction.kind = t.value; return; }
      if (t && t.id === 'mg-isummary') { state.draft.interaction.summary = t.value; return; }
      if (t && t.id === 'mg-ilog') { doLogInteraction(state.selectedContact); return; }
      if (t && t.id === 'mg-fwhat') { state.draft.followUp.what = t.value; return; }
      if (t && t.id === 'mg-fdue') { state.draft.followUp.dueAt = t.value; return; }
      if (t && t.id === 'mg-fadd') { doAddFollowUp(state.selectedContact); return; }
      const act = t && t.getAttribute ? t.getAttribute('data-act') : null;
      if (act === 'cinspect') { state.selectedContact = t.getAttribute('data-id'); renderCustomers(); return; }
      if (act === 'cstage') { patch('/api/contacts/' + encodeURIComponent(t.getAttribute('data-id')), { stage: t.getAttribute('data-status') }, 'Stage updated.', function () { return loadContacts().then(renderAll); }); return; }
      if (act === 'fudone') { post('/api/followups/' + encodeURIComponent(t.getAttribute('data-id')) + '/done', {}, 'Follow-up closed.', function () { return loadContacts().then(renderAll); }); return; }
      if (act === 'cdel') { arm(t, 'CONFIRM REMOVE', function () { del('/api/contacts/' + encodeURIComponent(t.getAttribute('data-id')), 'Contact removed.', function () { state.selectedContact = ''; return loadContacts().then(renderAll); }); }); }
    };

    const onContent = function (ev) {
      const t = ev.target;
      if (t && t.id === 'mg-biz') { state.businessId = t.value; refresh(); return; }
      if (t && t.id === 'mg-ntitle') { state.draft.content.title = t.value; return; }
      if (t && t.id === 'mg-nchannel') { state.draft.content.channel = t.value; return; }
      if (t && t.id === 'mg-nbrief') { state.draft.content.brief = t.value; return; }
      if (t && t.id === 'mg-ncreate') { doCreateContent(); return; }
      const act = t && t.getAttribute ? t.getAttribute('data-act') : null;
      if (act === 'advance') { doAdvanceContent(t.getAttribute('data-id'), t.getAttribute('data-stage')); return; }
      if (act === 'ndel') arm(t, 'CONFIRM REMOVE', function () { del('/api/content/' + encodeURIComponent(t.getAttribute('data-id')), 'Piece removed.', function () { return loadContent().then(renderAll); }); });
    };

    const onLibrary = function (ev) {
      const t = ev.target;
      if (t && t.id === 'mg-biz') { state.businessId = t.value; refresh(); return; }
      if (t && t.id === 'mg-dq') { state.docQuery = t.value; return; }
      if (t && t.id === 'mg-dsearch') { doSearchDocuments(); return; }
      if (t && t.id === 'mg-dclear') { state.docHits = null; state.docQuery = ''; renderLibrary(); return; }
      if (t && t.id === 'mg-dtitle') { state.draft.document.title = t.value; return; }
      if (t && t.id === 'mg-dtype') { state.draft.document.type = t.value; return; }
      if (t && t.id === 'mg-dbody') { state.draft.document.body = t.value; return; }
      if (t && t.id === 'mg-dcreate') { doCreateDocument(); return; }
      if (t && t.id === 'mg-kq') { state.kbQuery = t.value; return; }
      if (t && t.id === 'mg-kretrieve') { doRetrieveKnowledge(); return; }
      if (t && t.id === 'mg-kkind') { state.draft.knowledge.kind = t.value; return; }
      if (t && t.id === 'mg-ktitle') { state.draft.knowledge.title = t.value; return; }
      if (t && t.id === 'mg-ksource') { state.draft.knowledge.source = t.value; return; }
      if (t && t.id === 'mg-kref') { state.draft.knowledge.ref = t.value; return; }
      if (t && t.id === 'mg-ktags') { state.draft.knowledge.tags = t.value; return; }
      if (t && t.id === 'mg-kbody') { state.draft.knowledge.body = t.value; return; }
      if (t && t.id === 'mg-kadd') { doAddKnowledge(); return; }
      const act = t && t.getAttribute ? t.getAttribute('data-act') : null;
      if (act === 'ddel') arm(t, 'CONFIRM REMOVE', function () { del('/api/documents/' + encodeURIComponent(t.getAttribute('data-id')), 'Document removed.', function () { return loadDocuments().then(renderAll); }); });
      if (act === 'kdel') arm(t, 'CONFIRM FORGET', function () { del('/api/knowledge/' + encodeURIComponent(t.getAttribute('data-id')), 'Forgotten.', function () { return loadKnowledge().then(renderAll); }); });
    };

    const onExperiments = function (ev) {
      const t = ev.target;
      if (t && t.id === 'mg-biz') { state.businessId = t.value; refresh(); return; }
      if (t && t.id === 'mg-xhyp') { state.draft.experiment.hypothesis = t.value; return; }
      if (t && t.id === 'mg-xvar') { state.draft.experiment.variable = t.value; return; }
      if (t && t.id === 'mg-xarms') { state.draft.experiment.variants = t.value; return; }
      if (t && t.id === 'mg-xmetrics') { state.draft.experiment.metrics = t.value; return; }
      if (t && t.id === 'mg-xopen') { doOpenExperiment(); return; }
      if (t && t.id === 'mg-xrvariant') { state.exp.result.variant = t.value; return; }
      if (t && t.id === 'mg-xrmetric') { state.exp.result.metric = t.value; return; }
      if (t && t.id === 'mg-xrvalue') { state.exp.result.value = t.value; return; }
      if (t && t.id === 'mg-xrevidence') { state.exp.result.evidence = t.value; return; }
      if (t && t.id === 'mg-xrsource') { state.exp.result.source = t.value; return; }
      if (t && t.id === 'mg-xrrecord') { doRecordResult(state.exp.selected); return; }
      if (t && t.id === 'mg-xconc') { state.exp.conclusion = t.value; renderExperiments(); return; }
      if (t && t.id === 'mg-xreason') { state.exp.reason = t.value; return; }
      if (t && t.id === 'mg-xnext') { state.exp.nextAction = t.value; return; }
      if (t && t.id === 'mg-xconclude') { doConclude(state.exp.selected); return; }
      const act = t && t.getAttribute ? t.getAttribute('data-act') : null;
      if (act === 'xselect') { state.exp.selected = t.getAttribute('data-id'); renderExperiments(); return; }
      if (act === 'xstart') { post('/api/experiments/' + encodeURIComponent(t.getAttribute('data-id')) + '/start', {}, 'Started.', function () { return loadExperiments().then(renderAll); }); return; }
      if (act === 'xend') { post('/api/experiments/' + encodeURIComponent(t.getAttribute('data-id')) + '/end', {}, 'Ended — a conclusion is now possible.', function () { return loadExperiments().then(renderAll); }); return; }
      if (act === 'xdel') arm(t, 'CONFIRM REMOVE', function () { del('/api/experiments/' + encodeURIComponent(t.getAttribute('data-id')), 'Experiment removed.', function () { state.exp.selected = ''; return loadExperiments().then(renderAll); }); });
    };

    bindPane(panes.overview, onOverview);
    bindPane(panes.projects, onProjects);
    bindPane(panes.finance, onFinance);
    bindPane(panes.analytics, onAnalytics);
    bindPane(panes.customers, onCustomers);
    bindPane(panes.content, onContent);
    bindPane(panes.library, onLibrary);
    bindPane(panes.experiments, onExperiments);

    wireBus();
    live = { refresh: refresh, state: state };

    return Promise.all([loadCatalog(), loadBusinesses()])
      .then(function () { return loadAll(); })
      .then(function () { renderAll(); return live; });
  }

  return {
    PROJECT_STATUS_LABEL, KIND_LABEL, PROVENANCE_LABEL, PROVENANCE_SHORT, STAGE_LABEL, INTERACTION_LABEL,
    CONTENT_STAGE_LABEL, CHANNEL_LABEL, DOC_TYPE_LABEL, DOC_STATUS_LABEL, KB_KIND_LABEL,
    EXP_STATUS_LABEL, CONCLUSION_LABEL, EVIDENCE_LABEL,
    label, evidenceLabel, money, relTime, esc, request, errText,
    optionsFrom, provenanceOptions, metricOptions,
    projectRows, transactionRows, totalsView, metricRows, contactRows, attentionRows,
    contentRows, contentBoard, documentRows, knowledgeRows, experimentRows,
    financeGuard, metricGuard, knowledgeGuard, contentAdvanceGuard, conclusionGuard, summaryLine,
    mount
  };
});
