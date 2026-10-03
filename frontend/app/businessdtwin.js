/* frontend/app/businessdtwin.js — the DIGITAL TWIN console (Business OS Phase 9, §18).

   §18's scenario simulation: pick a business, name a what-if, and see what its OWN recorded numbers would
   have been under that assumption. One window, two panels — RUN A WHAT-IF and COMPARE.

   WHY ITS OWN WINDOW. It is not a lane of INTELLIGENCE. Intelligence REPORTS what happened; the twin takes
   an ASSUMPTION and shows arithmetic. Putting it under INTELLIGENCE would bury the one distinction that
   matters most here, which is the honesty one:

     A SIMULATION IS NOT A MEASUREMENT, AND MUST NOT LOOK LIKE ONE.
     Every number the twin shows is one of two things: a value the business RECORDED, or that value carried
     through an operation the user typed. The console therefore renders every simulated figure with:
       · a SIM label next to it, always — never a bare number in a KPI slot,
       · the RECORDED basis it came from, in the same row, so the arithmetic is checkable by eye,
       · and a persistent header line saying this is arithmetic on recorded readings, not a forecast.
     A reader who screenshots one number and pastes it into a board deck must have had to delete a visible
     marker to do it. That is the design test this console is built to pass.

     AN IMPOSSIBLE ASSUMPTION IS SHOWN AS CLAMPED, NOT AS A RESULT.
     Ask for a conversion rate of 3 and the engine returns 1.0 with `clamped:true`. The console says
     "clamped to the metric's range" rather than printing 1.0 and moving on — because "we simulated 1.0" and
     "your assumption was impossible and we stopped at the edge" are different facts.

     NO BASELINE, NO SIMULATION.
     A metric with no recorded reading is rendered as NOT RECORDED and cannot be simulated. It is never shown
     as 0 and never offered as a starting point.

   NO `window.alert/confirm/prompt` (station-tooltip.test.js bans them). Ids are namespaced `dt-*` / `.dt-`:
   `.dt-` is free (.bc- .bm- .tm- .mg- .ba- .wk- .in- are Phases 1-7). */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).businessDTwin = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ================================ PURE HALF ================================
  // Node-loadable and unit-tested headless. This is where the honesty lives.

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function relTime(at, now) {
    const t = Number(at);
    if (!isFinite(t) || t <= 0) return 'never';
    const d = Math.max(0, (now || Date.now()) - t);
    const m = Math.floor(d / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  }

  /* FORMAT A VALUE ACCORDING TO ITS DECLARED UNIT, never a guess. A rate is a fraction and is shown as a
     percentage with one decimal; a currency gets a symbol; a count is grouped. The unit comes from the
     metrics store's own definition, so the console cannot disagree with the store about what a number IS. */
  const CUR = { USD: '$', EUR: '€', GBP: '£', JPY: '¥', CNY: '¥' };
  function fmtValue(v, unit, currency) {
    if (v == null || !isFinite(Number(v))) return '—';
    const n = Number(v);
    if (unit === 'rate') return (n * 100).toFixed(1) + '%';
    if (unit === 'currency') {
      const sym = CUR[String(currency || '').toUpperCase()] || '';
      const abs = Math.abs(n);
      const body = abs >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : n.toFixed(2);
      return sym ? sym + body : body;
    }
    return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  /* A DELTA IS SIGNED AND EXPLICIT. "+24" and "-50" — a reader must not have to infer direction from
     position. Zero is shown as "no change", not "+0". */
  function fmtDelta(v, unit, currency) {
    if (v == null || !isFinite(Number(v))) return '—';
    const n = Number(v);
    if (n === 0) return 'no change';
    const sign = n > 0 ? '+' : '-';
    const mag = Math.abs(n);
    let body;
    if (unit === 'rate') body = (mag * 100).toFixed(1) + 'pt';
    else if (unit === 'currency') {
      const sym = CUR[String(currency || '').toUpperCase()] || '';
      body = sym + (mag >= 1000 ? mag.toLocaleString(undefined, { maximumFractionDigits: 0 }) : mag.toFixed(2));
    } else body = mag.toLocaleString(undefined, { maximumFractionDigits: 2 });
    return sign + body;
  }

  /* THE OPERATION LABEL. Mirrors the engine's closed set exactly — multiply/add/set with their argument
     names. Kept here so the console's dropdown and the engine cannot drift: a test asserts the two lists
     are identical. */
  const OPS = [
    { id: 'multiply', label: 'scale by a factor', param: 'factor', verb: '×' },
    { id: 'add', label: 'shift by an amount', param: 'amount', verb: '+' },
    { id: 'set', label: 'replace with a value', param: 'value', verb: '=' }
  ];
  const OP_IDS = OPS.map(o => o.id);

  // How much of a reason string to render. Long engine messages are still shown in full — this only guards
  // against a runaway string taking the layout with it.
  const MAX_REASON = 400;

  /* SHAPE ONE SIMULATED ROW FOR RENDERING. Returns a plain object (no HTML) so it is testable headless;
     `renderResultRow` turns it into markup. The two flags a caller must be able to rely on:
       · `isSimulated` is ALWAYS true here (this only ever shapes simulated rows),
       · `basisMissing` is true when the engine gave no basis — which should never happen for a row that
         simulated, but is rendered as "not recorded" rather than as a zero if it ever does. */
  function shapeResult(r, currency) {
    r = r || {};
    const hasBasis = r.basisValue != null && isFinite(Number(r.basisValue));
    return {
      metric: String(r.metric || ''),
      label: String(r.label || r.metric || ''),
      unit: String(r.unit || ''),
      isSimulated: true,
      basisMissing: !hasBasis,
      basisText: hasBasis ? fmtValue(r.basisValue, r.unit, currency) : 'not recorded',
      basisAt: Number(r.basisAt) || 0,
      basisEvidence: String(r.basisEvidence || ''),
      simulatedText: fmtValue(r.simulated, r.unit, currency),
      deltaText: fmtDelta(r.delta, r.unit, currency),
      deltaNum: isFinite(Number(r.delta)) ? Number(r.delta) : null,
      assumption: String(r.assumption || ''),
      clamped: !!r.clamped
    };
  }

  function shapeScenario(out, currency) {
    out = out || {};
    return {
      ok: !!out.ok,
      name: String(out.name || 'scenario'),
      label: String(out.label || ''),
      disclaimer: String(out.disclaimer || ''),
      rows: (Array.isArray(out.results) ? out.results : []).map(r => shapeResult(r, currency)),
      failures: (Array.isArray(out.failures) ? out.failures : []).map(f => ({
        metric: String(f.metric || ''),
        reason: String(f.reason || '').slice(0, MAX_REASON)
      }))
    };
  }

  /* SHAPE THE CATALOG into what a picker needs: which metrics CAN be simulated (they have a reading) and
     which cannot. The `simulatable` flag is the whole point — the form must offer only the former and must
     say why for the latter. */
  function shapeCatalog(cat, now) {
    cat = cat || {};
    const metrics = (Array.isArray(cat.metrics) ? cat.metrics : []).map(m => ({
      metric: String(m.metric || ''),
      label: String(m.label || m.metric || ''),
      unit: String(m.unit || ''),
      simulatable: !!m.hasReading,
      basisText: m.hasReading ? fmtValue(m.basisValue, m.unit) : 'not recorded',
      basisValue: m.hasReading ? Number(m.basisValue) : null,
      basisAt: Number(m.basisAt) || 0,
      basisAge: m.hasReading ? relTime(m.basisAt, now) : '',
      basisSource: String(m.basisSource || '')
    }));
    return {
      metrics: metrics,
      ready: metrics.filter(m => m.simulatable),
      unavailable: metrics.filter(m => !m.simulatable),
      ops: OP_IDS.slice()
    };
  }

  /* SHAPE A COMPARISON for rendering: one row per metric, one column per scenario, plus the shared
     recorded baseline. Pure — no DOM — so it is testable in Node. */
  function shapeComparison(raw) {
    raw = raw || {};
    const scenarios = (Array.isArray(raw.scenarios) ? raw.scenarios : []).map(s => String(s.name || 'scenario'));
    const excluded = (Array.isArray(raw.excluded) ? raw.excluded : []).map(x => ({
      name: String(x.name || 'what-if'),
      reason: String(x.reason || 'this run produced no result').slice(0, MAX_REASON)
    }));
    const metrics = (Array.isArray(raw.metrics) ? raw.metrics : []).map(m => ({
      metric: String(m.metric || ''),
      label: String(m.label || m.metric || ''),
      basisText: fmtValue(m.basisValue, m.unit),
      cells: (Array.isArray(m.scenarios) ? m.scenarios : []).map(s => ({
        simulatedText: s.present ? fmtValue(s.simulated, m.unit) : '—',
        deltaText: s.present ? fmtDelta(s.delta, m.unit) : ''
      }))
    }));
    return { ok: !!raw.ok, scenarios: scenarios, metrics: metrics, note: String(raw.note || ''), excluded: excluded };
  }

  /* PICK THE RUNS THAT MAY BE COMPARED — and REFUSE the rest BY NAME.

     COMPARE lines scenarios up because all of them are carried through the SAME recorded baseline, which is
     the only thing that makes their deltas commensurable. A run that produced no result has NOTHING to carry
     and cannot be a column; silently dropping it would leave a table that looks like a complete set while one
     of the owner's what-ifs was quietly absent (P7 — no fake anything). So this returns BOTH:
       · `runs`     the shaped scenarios to send, each with the ONE what-if name its owner gave it (never a
                    computed label like "scenario 1", which could not be read back out of a URL or a log), and
       · `excluded` every run that was left out, NAMED, so the panel can say which one and why.
     Pure and header-free (no DOM, no clock): the caller owns the "what is a run" test, this owns the refusal.

     `isSimulatable(run)` is injected rather than imported from the engine's own `ok`, because the decision to
     compare belongs to the CONSOLE's honesty policy — the engine's `ok` also goes false for a scenario that
     merely clamped a rate, which is still a perfectly comparable column. */
  function pickComparable(runs, isSimulatable) {
    const all = Array.isArray(runs) ? runs : [];
    const test = typeof isSimulatable === 'function' ? isSimulatable : (r => !!(r && r.ok));
    const good = [];
    const excluded = [];
    all.forEach((run, i) => {
      const name = String((run && run.name) || '').trim();
      if (test(run)) good.push({ name: name || ('scenario ' + (i + 1)), steps: (run && run.steps) || [] });
      else excluded.push({ name: name || ('what-if ' + (i + 1)), reason: (run && run.reason) || 'this run produced no result' });
    });
    return { ok: good.length > 0, scenarios: good, excluded: excluded };
  }

  /* BUILD THE REQUEST BODY from the form's raw inputs — and REFUSE rather than coerce when the input is
     empty. A blank factor becoming 0 would silently simulate "everything drops to zero", which is a number
     the user would then read as a finding. */
  function buildStep(raw) {
    raw = raw || {};
    const metric = String(raw.metric || '').trim();
    if (!metric) return { ok: false, reason: 'choose a metric' };
    const op = OP_IDS.indexOf(String(raw.op)) >= 0 ? String(raw.op) : null;
    if (!op) return { ok: false, reason: 'choose an operation' };
    const def = OPS.filter(o => o.id === op)[0];
    const rawArg = raw.arg;
    if (rawArg === '' || rawArg == null) return { ok: false, reason: 'give a value for "' + def.param + '"' };
    const arg = Number(rawArg);
    if (!isFinite(arg)) return { ok: false, reason: '"' + def.param + '" must be a number' };
    const step = { metric: metric, op: op };
    step[def.param] = arg;
    return { ok: true, step: step };
  }

  /* VALIDATE A WHOLE FORM before it is sent. Returns every problem at once, so the user fixes one round
     trip rather than one field per attempt. */
  function validateForm(form) {
    form = form || {};
    const problems = [];
    const name = String(form.name || '').trim();
    if (!name) problems.push('give the what-if a name');
    const steps = Array.isArray(form.steps) ? form.steps : [];
    if (!steps.length) problems.push('add at least one assumption');
    steps.forEach((s, i) => {
      const b = buildStep(s);
      if (!b.ok) problems.push('assumption ' + (i + 1) + ': ' + b.reason);
    });
    return { ok: problems.length === 0, problems: problems };
  }

  // ================================ DOM HALF ================================

  const PREFIX = '/api/businesses/';

  /* HOW MANY RECALLED RUNS MAY BE COMPARED. A bound, not a policy: the engine caps a comparison at 12 columns
     and more than a handful is unreadable side by side anyway. Kept BELOW the engine's cap so the console can
     never assemble a request the engine refuses with a mystery 422. */
  const MAX_RUNS = 8;

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
      '<div class="dt-wrap">' +
        '<div class="dt-head">' +
          '<h3 class="dt-title">DIGITAL TWIN</h3>' +
          // PERSISTENT honesty banner. Not dismissible: it is the one line that stops a simulated figure
          // from being read as a measurement.
          '<span class="dt-banner" data-hint="digitaltwin">simulation — arithmetic on recorded readings, not a forecast</span>' +
          '<span class="dt-spacer"></span>' +
          '<select class="dt-select" id="dt-biz" data-hint="business"></select>' +
          '<button class="dt-btn" id="dt-refresh" data-hint="digitaltwin">REFRESH</button>' +
        '</div>' +
        '<div class="dt-tabs">' +
          '<button class="dt-tab dt-on" data-tab="run" data-hint="digitaltwin">RUN A WHAT-IF</button>' +
          '<button class="dt-tab" data-tab="compare" data-hint="digitaltwin">COMPARE</button>' +
        '</div>' +
        '<div class="dt-panels">' +
          '<div class="dt-panel dt-on" id="dt-panel-run"></div>' +
          '<div class="dt-panel" id="dt-panel-compare"></div>' +
        '</div>' +
      '</div>';

    const state = { businessId: '', tab: 'run', catalog: null, result: null, comparison: null, runs: [], compareBusy: false };

    function panel(id) { return host.querySelector('#dt-panel-' + id); }
    function say(id, html) { const p = panel(id); if (p) p.innerHTML = html; }
    function busy(id, text) { say(id, '<p class="dt-loading">' + esc(text || 'loading…') + '</p>'); }
    function err(id, reason) { say(id, '<p class="dt-err">' + esc(reason || 'something went wrong') + '</p>'); }

    function showTab(tab) {
      state.tab = tab;
      for (const t of host.querySelectorAll('.dt-tab')) t.classList.toggle('dt-on', t.getAttribute('data-tab') === tab);
      for (const p of host.querySelectorAll('.dt-panel')) p.classList.toggle('dt-on', p.id === 'dt-panel-' + tab);
      render(tab);
    }
    for (const t of host.querySelectorAll('.dt-tab')) t.addEventListener('click', () => {
      const tab = t.getAttribute('data-tab');
      if (tab === 'compare') enterCompare();
      else showTab(tab);
    });
    const refresh = host.querySelector('#dt-refresh');
    if (refresh) refresh.addEventListener('click', () => loadCatalog());

    const bizSel = host.querySelector('#dt-biz');
    if (bizSel) bizSel.addEventListener('change', () => { state.businessId = String(bizSel.value || ''); state.result = null; state.comparison = null; state.runs = []; loadCatalog(); });

    function currencyOf() { return 'USD'; }   // the store's default; a business-level override is a later concern

    // ---- catalog ------------------------------------------------------------------------------------
    function loadBusinesses() {
      return apiFetch('/api/businesses').then(res => {
        const rows = Array.isArray(res) ? res : (Array.isArray(res && res.businesses) ? res.businesses : []);
        if (!state.businessId && rows.length) state.businessId = String(rows[0].id || '');
        if (bizSel) {
          bizSel.innerHTML = rows.length
            ? rows.map(b => '<option value="' + esc(b.id) + '">' + esc(b.name || b.id) + '</option>').join('')
            : '<option value="">no businesses yet</option>';
          bizSel.value = state.businessId;
        }
        return rows;
      }).catch(() => []);
    }

    function loadCatalog() {
      if (!state.businessId) { err('run', 'create a business first — a twin simulates over its recorded readings'); return Promise.resolve(); }
      busy('run', 'reading the recorded metrics…');
      return apiFetch(PREFIX + encodeURIComponent(state.businessId) + '/twin').then(res => {
        if (!res || !res.ok) { err('run', (res && res.reason) || 'could not read the twin catalog'); return; }
        state.catalog = shapeCatalog(res.catalog, now());
        render('run');
      }).catch(() => err('run', 'could not reach the station'));
    }

    // ---- forms --------------------------------------------------------------------------------------
    /* ONE ASSUMPTION ROW. The metric picker offers ONLY simulatable metrics — an unrecorded metric cannot
       be a baseline, so offering it would be offering a scenario that will be refused. */
    function stepRowHtml(ready) {
      const opts = ready.map(m => '<option value="' + esc(m.metric) + '">' + esc(m.label) + ' (' + esc(m.basisText) + ')</option>').join('');
      const ops = OPS.map(o => '<option value="' + o.id + '">' + esc(o.label) + '</option>').join('');
      return '<div class="dt-step">' +
        '<select class="dt-select dt-step-metric" data-hint="digitaltwin">' + opts + '</select>' +
        '<select class="dt-select dt-step-op" data-hint="digitaltwin">' + ops + '</select>' +
        '<input class="dt-input dt-step-arg" type="number" step="any" placeholder="value" data-hint="digitaltwin" />' +
        '<button class="dt-x dt-step-del" data-hint="digitaltwin" title="remove">×</button>' +
      '</div>';
    }

    function readSteps() {
      const rows = host.querySelectorAll('#dt-panel-run .dt-step');
      const out = [];
      for (const r of rows) {
        out.push({
          metric: (r.querySelector('.dt-step-metric') || {}).value,
          op: (r.querySelector('.dt-step-op') || {}).value,
          arg: (r.querySelector('.dt-step-arg') || {}).value
        });
      }
      return out;
    }

    function renderRun() {
      const c = state.catalog;
      if (!c) return;
      if (!c.ready.length) {
        say('run', '<p class="dt-empty">This business has no recorded metric readings yet, so there is nothing to ' +
          'simulate over. Record a reading in MANAGER, then come back — a what-if needs a real baseline and none ' +
          'will be assumed.</p>');
        return;
      }
      const nameVal = esc((state.nameDraft || ''));
      let html = '' +
        '<div class="dt-form">' +
          '<label class="dt-lbl" data-hint="digitaltwin">name this what-if</label>' +
          '<input class="dt-input dt-name" id="dt-name" placeholder="e.g. better conversion" value="' + nameVal + '" data-hint="digitaltwin" />' +
          '<label class="dt-lbl" data-hint="digitaltwin">assumptions</label>' +
          '<div class="dt-steps" id="dt-steps">' + stepRowHtml(c.ready) + '</div>' +
          '<div class="dt-actions">' +
            '<button class="dt-btn dt-add" id="dt-add" data-hint="digitaltwin">+ ADD ASSUMPTION</button>' +
            '<button class="dt-btn dt-go" id="dt-run" data-hint="digitaltwin">SIMULATE</button>' +
          '</div>' +
          '<p class="dt-note">Each assumption is applied to the LATEST RECORDED value. Nothing is dated in the future.</p>' +
        '</div>' + runListHtml() + resultHtml();

      say('run', html);
      wireRun();
    }

    /* THE RECALLED RUNS. The twin stores nothing, so this strip is the ONLY place a set of comparable
       scenarios exists — it is the live memory the COMPARE tab reads. Rendered with a one-click hand-off so
       the owner does not have to retype a what-if to line it up against another. */
    function runListHtml() {
      const runs = state.runs || [];
      if (!runs.length) {
        return '<p class="dt-note dt-runs-hint">Simulate a what-if and it is recalled here, ready to line up ' +
          'against others on the COMPARE tab. Nothing is saved — recalling ends when this window closes.</p>';
      }
      const chips = runs.map(r =>
        '<span class="dt-run" data-hint="digitaltwin">' + esc(r.name) +
          '<button class="dt-x dt-run-del" data-name="' + esc(r.name) + '" title="forget this run">×</button>' +
        '</span>'
      ).join('');
      return '<div class="dt-runs">' +
        '<span class="dt-lbl dt-runs-lbl" data-hint="digitaltwin">recalled this session (' + runs.length + ')</span>' +
        '<div class="dt-runs-list">' + chips + '</div>' +
        '<button class="dt-btn dt-cmp" id="dt-cmp" data-hint="digitaltwin">COMPARE ' + runs.length + '</button>' +
      '</div>';
    }

    function resultHtml() {
      const r = state.result;
      if (!r) return '';
      if (!r.ok) {
        return '<div class="dt-result dt-bad">' +
          '<div class="dt-result-head">not simulated</div>' +
          r.failures.map(f => '<p class="dt-fail">' + esc(f.metric || '(a step)') + ': ' + esc(f.reason) + '</p>').join('') +
          '<p class="dt-note">A scenario that could not be fully simulated is not partially shown — a hole in a ' +
          'what-if is not the same as a step that did not matter.</p>' +
        '</div>';
      }
      const rows = r.rows.map(row =>
        '<tr>' +
          '<td class="dt-cell-metric">' + esc(row.label) + (row.isSimulated ? '<span class="dt-sim">SIM</span>' : '') + '</td>' +
          '<td class="dt-cell-basis">' + esc(row.basisText) + (row.basisAge ? '<span class="dt-age">' + esc(row.basisAge) + '</span>' : '') + '</td>' +
          '<td class="dt-cell-sim">' + esc(row.simulatedText) + '</td>' +
          '<td class="dt-cell-delta">' + esc(row.deltaText) + '</td>' +
        '</tr>' +
        '<tr class="dt-assume"><td colspan="4">' + esc(row.assumption) +
          (row.clamped ? ' <span class="dt-clamp">clamped to the metric\'s range</span>' : '') + '</td></tr>'
      ).join('');
      return '<div class="dt-result">' +
        '<div class="dt-result-head">' + esc(r.name) + ' <span class="dt-sim">SIMULATION</span></div>' +
        '<table class="dt-table"><thead><tr>' +
          '<th>metric</th><th>recorded</th><th>simulated</th><th>change</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table>' +
        '<p class="dt-note">' + esc(r.disclaimer) + '</p>' +
      '</div>';
    }

    function wireRun() {
      const add = host.querySelector('#dt-add');
      if (add) add.addEventListener('click', () => {
        const c = state.catalog;
        if (!c) return;
        const box = host.querySelector('#dt-steps');
        if (box) box.insertAdjacentHTML('beforeend', stepRowHtml(c.ready));
        wireStepDeletes();
      });
      wireStepDeletes();
      const nameIn = host.querySelector('#dt-name');
      if (nameIn) nameIn.addEventListener('input', () => { state.nameDraft = nameIn.value; });
      const go = host.querySelector('#dt-run');
      if (go) go.addEventListener('click', () => submit());
      const cmp = host.querySelector('#dt-cmp');
      if (cmp) cmp.addEventListener('click', () => enterCompare());
      for (const b of host.querySelectorAll('.dt-run-del')) {
        b.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const name = b.getAttribute('data-name');
          state.runs = (state.runs || []).filter(r => r.name !== name);
          state.comparison = null;
          renderRun();
        });
      }
    }
    function wireStepDeletes() {
      for (const b of host.querySelectorAll('.dt-step-del')) {
        if (b._wired) continue;
        b._wired = true;
        b.addEventListener('click', () => {
          const row = b.closest('.dt-step');
          const all = host.querySelectorAll('#dt-panel-run .dt-step');
          if (all.length <= 1) return;              // always keep one row
          if (row) row.remove();
        });
      }
    }

    function submit() {
      const raw = { name: (host.querySelector('#dt-name') || {}).value, steps: readSteps() };
      /* Canonicalise through the PURE validator first, so the UI and the engine agree on the step shape and
         a blank field is REFUSED here rather than being coerced to 0 by Number('') and simulating
         "everything drops to zero" — a number the user would then read as a finding. */
      const args = raw.steps.map(s => ({ metric: s.metric, op: s.op, arg: s.arg }));
      const v = validateForm({ name: raw.name, steps: args });
      if (!v.ok) {
        say('run', formHtmlWithErrors(v.problems));
        wireRun();
        return;
      }
      const steps = args.map(a => {
        const def = OPS.filter(o => o.id === a.op)[0];
        const st = { metric: a.metric, op: a.op };
        st[def.param] = Number(a.arg);
        return st;
      });
      busy('run', 'simulating…');
      apiFetch(PREFIX + encodeURIComponent(state.businessId) + '/twin/simulate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: String(raw.name).trim(), steps: steps })
      }).then(res => {
        state.result = shapeScenario(res, currencyOf());
        /* RECALL THIS RUN so COMPARE has something to line up. The twin STORES NOTHING (its own header is
           explicit: a persisted projection would be a fact made of an assumption), so the only place a set of
           comparable scenarios can live is right here in the session — and it is bounded, because an
           unbounded list is a place to hide a workload. Only a run that actually produced results is kept: a
           what-if that had no baseline is not a column, and pretending it is one is exactly the lie P7 bans. */
        if (state.result && state.result.ok) {
          const run = { name: state.result.name, steps: steps, ok: true };
          state.runs = (state.runs || []).filter(r => r.name !== run.name);
          state.runs.push(run);
          if (state.runs.length > MAX_RUNS) state.runs.shift();
          state.comparison = null;              // a new run makes the old table stale — rebuild on demand
        }
        renderRun();
      }).catch(() => { err('run', 'could not reach the station'); setTimeout(renderRun, 0); });
    }

    function formHtmlWithErrors(problems) {
      const c = state.catalog;
      const ready = (c && c.ready) || [];
      return '<div class="dt-form">' +
        '<label class="dt-lbl" data-hint="digitaltwin">name this what-if</label>' +
        '<input class="dt-input dt-name" id="dt-name" placeholder="e.g. better conversion" value="' + esc((state.nameDraft || '')) + '" data-hint="digitaltwin" />' +
        '<label class="dt-lbl" data-hint="digitaltwin">assumptions</label>' +
        '<div class="dt-steps" id="dt-steps">' + stepRowHtml(ready) + '</div>' +
        '<div class="dt-actions">' +
          '<button class="dt-btn dt-add" id="dt-add" data-hint="digitaltwin">+ ADD ASSUMPTION</button>' +
          '<button class="dt-btn dt-go" id="dt-run" data-hint="digitaltwin">SIMULATE</button>' +
        '</div>' +
        '<div class="dt-problems">' + problems.map(p => '<p class="dt-fail">' + esc(p) + '</p>').join('') + '</div>' +
      '</div>' + resultHtml();
    }

    // ---- compare ------------------------------------------------------------------------------------
    /* FETCH THE COMPARISON over the recalled runs, through the SAME endpoint a what-if uses. Read-only — the
       route computes and returns; the twin stores nothing, so a comparison is regenerated on demand rather
       than kept, which is also why the table is stale the moment a new run is simulated. */
    function loadComparison() {
      const runs = state.runs || [];
      if (!runs.length) { state.comparison = null; renderCompare(); return Promise.resolve(); }
      if (!state.businessId) { err('compare', 'create a business first — a twin simulates over its recorded readings'); return Promise.resolve(); }
      state.compareBusy = true;
      renderCompare();
      /* Only runs that produced results become columns; the rest are carried through as `excluded` so the
         refusal is VISIBLE. `isSimulatable` is the session's own test — a run is recallable only when it
         actually simulated, which is why a clamped-but-ok run is still comparable. */
      const picked = pickComparable(runs, r => !!r.ok);
      return apiFetch(PREFIX + encodeURIComponent(state.businessId) + '/twin/compare', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarios: picked.scenarios })
      }).then(res => {
        state.comparison = shapeComparison(Object.assign({}, res, { excluded: picked.excluded }));
      }).catch(() => {
        state.comparison = { ok: false, scenarios: [], metrics: [], note: '', excluded: picked.excluded, reason: 'could not reach the station' };
      }).then(() => { state.compareBusy = false; renderCompare(); });
    }

    function renderCompare() {
      const runs = state.runs || [];
      if (!runs.length) {
        say('compare', '<p class="dt-empty">Nothing to compare yet. Run a what-if on the RUN A WHAT-IF tab — ' +
          'COMPARE lines up several what-ifs against the SAME recorded baseline, so their changes are directly ' +
          'comparable. It does not pick a best one. (Nothing is saved; the runs are recalled for this session only.)</p>');
        return;
      }
      if (state.compareBusy) { busy('compare', 'carrying every what-if through the same recorded baseline…'); return; }
      const r = state.comparison;
      if (!r) { busy('compare', 'building the comparison…'); return; }
      if (!r.ok) {
        say('compare', '<p class="dt-err">' + esc(r.reason || 'this comparison could not be built — one or more what-ifs had no recorded baseline') + '</p>');
        appendExcluded(r);
        return;
      }
      const head = '<tr><th>metric</th><th>recorded</th>' + r.scenarios.map(s => '<th>' + esc(s) + '</th>').join('') + '</tr>';
      const body = r.metrics.map(m =>
        '<tr><td class="dt-cell-metric">' + esc(m.label) + '</td><td class="dt-cell-basis">' + esc(m.basisText) + '</td>' +
        m.cells.map(c => '<td class="dt-cell-sim">' + esc(c.simulatedText) + '<span class="dt-delta-sub">' + esc(c.deltaText) + '</span></td>').join('') +
        '</tr>'
      ).join('');
      say('compare', '<div class="dt-result">' +
        '<div class="dt-result-head">COMPARISON <span class="dt-sim">SIMULATION</span></div>' +
        '<table class="dt-table"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>' +
        '<p class="dt-note">' + esc(r.note) + '</p>' +
        '<p class="dt-note">Each column is one recalled what-if. Nothing here is ranked: which assumption is ' +
        'better is the owner\'s call, and the twin does not make it.</p>' +
      '</div>');

      // If any recalled this session could not be simulated, name them — the table above is what CAN be compared.
      appendExcluded(r);
    }

    /* NAME THE RUNS THAT DID NOT MAKE A COLUMN. Rendered under BOTH the success and the failure table, because
       a what-if that produced no result is the most important thing to say out loud when the owner expects to
       see it lined up. */
    function appendExcluded(r) {
      if (!r || !r.excluded || !r.excluded.length) return;
      const p = panel('compare');
      if (!p) return;
      p.insertAdjacentHTML('beforeend', '<div class="dt-bad">' +
        '<div class="dt-result-head">not compared</div>' +
        r.excluded.map(x => '<p class="dt-fail">' + esc(x.name) + ': ' + esc(x.reason) + '</p>').join('') +
        '<p class="dt-note">A what-if that produced no result is not a column. It is named here rather than ' +
        'silently dropped, so the table cannot look complete while one of your runs is missing.</p>' +
      '</div>');    }

    function render(tab) {
      if (tab === 'run') renderRun();
      else renderCompare();
    }

    /* Switching to COMPARE triggers the fetch if there are runs and no current table; the click handler and
       the COMPARE button both land here, so there is one door into the comparison. */
    function enterCompare() {
      showTab('compare');
      if ((state.runs || []).length && !state.comparison && !state.compareBusy) loadComparison();
    }

    loadBusinesses().then(() => loadCatalog());
    return { state: state, reload: loadCatalog };
  }

  return {
    // pure half — the tested surface
    esc, relTime, fmtValue, fmtDelta, shapeResult, shapeScenario, shapeCatalog,
    buildStep, validateForm, pickComparable, OPS, OP_IDS, MAX_REASON,
    // dom
    mount, shapeComparison
  };
});
