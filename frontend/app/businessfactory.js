/* frontend/app/businessfactory.js — the AI SOFTWARE FACTORY console (Business OS Phase 12, §22).

   §22's pipeline read. Pick a business and see the brief's eight stages — Idea → Validate → Business → Spec →
   Build → Test → Ship → Operate — each with its TRUE state and the recorded fact that proves it. This is the
   single read the audit asked for; the six stores that hold the facts already existed.

   WHY ITS OWN WINDOW. "SOFTWARE FACTORY" is a different word from anything on the dock, and this is a view of
   the WHOLE journey — it does not fit inside any one console (Business, Maker, Worker) without pretending to
   be one of them.

   THE HONESTY PROBLEM THIS CONSOLE HAS. A "factory" is the single most tempting place to draw a progress bar:
   a confident 62% with the stages ticked off. This console refuses that, because the percentage would be pure
   invention. Instead every stage shows one of four states decided from RECORDED FACTS:
     REACHED       — a count is > 0 and the evidence is named;
     PENDING       — readable but nothing yet proves it (and it says what WOULD);
     BLOCKED       — a PRIOR stage has not been passed (and it names which);
     UNOBSERVABLE  — the proving source could not be read (count shows as "—", never a zero).

   THE TWO HALVES. The PURE half (stage shaping, the state→label map, the availability warnings, the header
   line) is Node-loadable and unit-tested headless. The DOM half mounts it.

   NO `window.alert/confirm/prompt` (station-tooltip.test.js bans them). Ids are namespaced `.fac-*`: .fac- is
   free (.bc-/.bm-/.tm-/.mg-/.ba-/.wk-/.in-/.dt-/.se-/.mssn-/.ap- are Phases 1/2/3/4/5/6/7/9/10/11/12). */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).businessFactoryConsole = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ================================ PURE HALF ================================

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  const str = (v) => (v == null ? '' : String(v));

  // The state vocabulary, in the console's own words. Unknown states are shown as-is, never guessed.
  const STATE_LABEL = {
    reached: 'reached',
    pending: 'not yet',
    blocked: 'blocked',
    unobservable: 'cannot tell'
  };

  function stateLabel(state) { return STATE_LABEL[str(state)] || str(state) || 'unknown'; }

  /* The count as it must be shown: a real number, or an em dash when the source is unobservable. NEVER a 0
     standing in for "cannot tell" — that is the whole point of the null. */
  function countText(stage) {
    if (!stage) return '—';
    if (stage.state === 'unobservable' || stage.count === null || stage.count === undefined) return '—';
    return String(stage.count);
  }

  /* Shape one stage row for the console. Everything is display; the state is taken as given (the server is
     the authority on the state, this only renders it). */
  function shapeStage(stage, i) {
    if (!stage || typeof stage !== 'object') return null;
    const state = str(stage.state) || 'unobservable';
    return {
      id: str(stage.id),
      n: (typeof i === 'number' ? i + 1 : 0),
      label: str(stage.label) || str(stage.id),
      blurb: str(stage.blurb),
      state: state,
      stateLabel: stateLabel(state),
      count: (state === 'unobservable' || stage.count === null || stage.count === undefined) ? null : Number(stage.count),
      countText: countText(stage),
      evidence: (stage.evidence || []).map(e => str(e)),
      blockedBy: str(stage.blockedBy),
      waiting: str(stage.waiting),
      on: state === 'reached',
      warn: state === 'unobservable'
    };
  }

  /* Shape the whole pipeline. `ok!==true` is a refusal, not an empty pipeline. */
  function shapePipeline(p) {
    if (!p || p.ok !== true) {
      return { ok: false, reason: str(p && p.reason) || 'the pipeline could not be read', stages: [], counts: null, availability: null };
    }
    const stages = (p.stages || []).map(shapeStage).filter(Boolean);
    return {
      ok: true,
      businessId: str(p.businessId),
      business: p.business ? { id: str(p.business.id), name: str(p.business.name), stage: str(p.business.stage) } : null,
      stages: stages,
      counts: p.counts ? {
        stages: Number(p.counts.stages) || stages.length,
        reached: Number(p.counts.reached) || 0,
        pending: Number(p.counts.pending) || 0,
        blocked: Number(p.counts.blocked) || 0,
        unobservable: Number(p.counts.unobservable) || 0
      } : null,
      currentStage: p.currentStage == null ? null : str(p.currentStage),
      availability: p.availability || null,
      note: str(p.note)
    };
  }

  /* Which sources could not be read — turned into plain warnings. An unreadable source must NEVER pass for an
     empty one, so this list is shown LOUDLY. */
  function availabilityWarnings(p) {
    const out = [];
    const a = p && p.availability;
    if (!a) return out;
    const names = { opportunities: 'the opportunity list', validations: 'the validation runs', business: 'the business record', tasks: 'the task list', workorders: 'the work orders' };
    for (const k of Object.keys(names)) {
      if (a[k] === false) out.push(canRead(names[k]));
    }
    return out;
    function canRead(n) { return 'could not read ' + n + ' — the stages it proves show "cannot tell", not zero'; }
  }

  /* A one-line header, honest about the state. NEVER a percentage — a count of reached stages at most. */
  function headLine(business, p) {
    if (!p || p.ok !== true) return 'no pipeline read yet';
    const c = p.counts || { reached: 0, stages: 8 };
    const parts = [];
    if (business) parts.push(business);
    parts.push(c.reached + ' of ' + c.stages + ' stages reached');
    if (p.currentStage) parts.push('at ' + p.currentStage);
    if (c.unobservable) parts.push(c.unobservable + ' cannot be told');
    return parts.join(' — ');
  }

  return { esc, str, STATE_LABEL, stateLabel, countText, shapeStage, shapePipeline, availabilityWarnings, headLine, mount: mount };

  // ================================ DOM HALF ================================

  function apiFetch(path, init) {
    const H = (typeof StationUI !== 'undefined' && StationUI.h) || {};
    if (typeof H.api === 'function') return H.api(path, init);
    return fetch(path, init).then(r => r.json().catch(() => ({ ok: false, reason: 'the response was not JSON' })));
  }

  function businessOptions(selected) {
    const H = (typeof StationUI !== 'undefined' && StationUI.h) || {};
    const list = (H.presentBusinesses && H.presentBusinesses()) || [];
    if (!list.length) return '<option value="">no businesses yet — make one first</option>';
    return list.map(b => '<option value="' + esc(b.id) + '"' + (b.id === selected ? ' selected' : '') + '>' + esc(b.name || b.id) + '</option>').join('');
  }

  function mount(body) {
    const host = typeof body === 'string' ? document.getElementById(body) : body;
    if (!host) return null;

    host.innerHTML = '' +
      '<div class="fac-wrap">' +
        '<div class="fac-head">' +
          '<h3 class="fac-title">SOFTWARE FACTORY</h3>' +
          '<span class="fac-banner" data-hint="softwarefactory">the whole journey, one honest read — every stage is shown only when a recorded fact proves it, with no percentage invented</span>' +
          '<span class="fac-spacer"></span>' +
          '<select id="fac-biz" class="fac-select" data-hint="softwarefactory">' + businessOptions('') + '</select>' +
          '<button class="fac-btn" id="fac-refresh" data-hint="softwarefactory">REFRESH</button>' +
        '</div>' +
        '<div id="fac-sum" class="fac-sum"></div>' +
        '<div id="fac-warn" class="fac-warn"></div>' +
        '<div id="fac-pipeline" class="fac-pipeline"></div>' +
      '</div>';

    const state = { businessId: '', pipeline: null };
    const el = id => host.querySelector(id);

    function render() {
      const p = shapePipeline(state.pipeline);
      const sum = el('#fac-sum');
      const bizName = (() => {
        const H = (typeof StationUI !== 'undefined' && StationUI.h) || {};
        const list = (H.presentBusinesses && H.presentBusinesses()) || [];
        const b = list.filter(x => x.id === state.businessId)[0];
        return b ? (b.name || b.id) : (state.businessId || '');
      })();
      if (sum) sum.textContent = headLine(bizName, p);

      const warn = el('#fac-warn');
      if (warn) {
        const ws = p.ok ? availabilityWarnings(p) : [];
        warn.innerHTML = ws.length ? ws.map(w => '<p class="fac-warn-line">' + esc(w) + '</p>').join('') : '';
      }

      const out = el('#fac-pipeline');
      if (!out) return;
      if (!state.businessId) { out.innerHTML = '<p class="fac-empty">Pick a business to see its pipeline.</p>'; return; }
      if (!p.ok) { out.innerHTML = '<p class="fac-err">' + esc(p.reason) + '</p>'; return; }
      if (!p.stages.length) { out.innerHTML = '<p class="fac-empty">This pipeline has no stages to show.</p>'; return; }

      const rows = p.stages.map(s => {
        const cls = 'fac-stage' + (s.on ? ' fac-on' : '') + (s.warn ? ' fac-cannot' : '') + (s.state === 'blocked' ? ' fac-blocked' : '');
        const why = s.evidence.length
          ? '<ul class="fac-ev">' + s.evidence.map(e => '<li>' + esc(e) + '</li>').join('') + '</ul>'
          : (s.state === 'blocked' ? '<p class="fac-why">waits on <b>' + esc(s.blockedBy) + '</b></p>'
            : (s.state === 'pending' ? '<p class="fac-why">' + esc(s.waiting || s.blurb) + '</p>'
              : (s.state === 'unobservable' ? '<p class="fac-why">the source that proves this could not be read</p>' : '')));
        return '<div class="' + cls + '">' +
          '<div class="fac-stage-head">' +
            '<span class="fac-stage-n">' + s.n + '</span>' +
            '<span class="fac-stage-label">' + esc(s.label) + '</span>' +
            '<span class="fac-state fac-state-' + esc(s.state) + '">' + esc(s.stateLabel) + '</span>' +
            '<span class="fac-count">' + esc(s.countText) + '</span>' +
          '</div>' +
          why +
        '</div>';
      }).join('');
      out.innerHTML = rows + (p.note ? '<p class="fac-note">' + esc(p.note) + '</p>' : '');
    }

    async function load() {
      if (!state.businessId) { state.pipeline = null; render(); return; }
      try {
        const r = await apiFetch('/api/factory/pipeline?business=' + encodeURIComponent(state.businessId));
        state.pipeline = r && r.j ? r.j : r;
      } catch (e) { state.pipeline = { ok: false, reason: 'the sidecar could not be reached' }; }
      render();
    }

    const biz = el('#fac-biz');
    if (biz) biz.addEventListener('change', () => { state.businessId = biz.value; load(); });
    const refresh = el('#fac-refresh');
    if (refresh) refresh.addEventListener('click', () => load());

    // pick the first business by default (from the same shared list the picker uses)
    const H = (typeof StationUI !== 'undefined' && StationUI.h) || {};
    const list = (H.presentBusinesses && H.presentBusinesses()) || [];
    if (list.length) state.businessId = list[0].id;
    render();
    if (state.businessId) load();

    return { destroy: () => { host.innerHTML = ''; } };
  }
});
