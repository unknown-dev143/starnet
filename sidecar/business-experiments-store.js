/* sidecar/business-experiments-store.js — §14 EXPERIMENT LAB (Business OS Phase 4).

   §14: "Run controlled business experiments. Example: 'Test whether customers prefer Product A or Product B.'
   Track: hypothesis · variables · start date · end date · metrics · results · conclusion · next action. This
   lets SpaceStation learn from real data instead of only generating theories."

   THE LAST CLAUSE IS THE GUARD. "Learn from real data instead of only generating theories" is exactly what a
   conclusion field will violate if nobody stops it, so `conclude()` applies FOUR rules and refuses a verdict
   that fails any of them:

     1. The experiment must have ENDED. You cannot conclude a running test — a verdict reached mid-run is a
        theory about data that is still arriving.
     2. It must have at least TWO variants. One arm is not a controlled experiment; it is an anecdote.
     3. At least one RESULT must carry an evidence class strong enough to bear a verdict (VERDICT_GRADE:
        'verified' or 'analysis'). An assumption restated as a conclusion is the exact failure §14 names.
     4. 'inconclusive' is ALWAYS allowed. "We do not know" is always an honest thing to record, and a store
        that makes it hard to say so is a store that manufactures false confidence.

   WHY THIS IS NOT validation-store.js (§5, Phase 2) — the P4 question, answered. The Validation Lab validates
   an OPPORTUNITY before a business exists: its methods are competitor-research, landing-page-test,
   waitlist-test, and its runs hang off an opportunityId. Its job is to decide whether to COMMIT to a venture.
   This store runs experiments INSIDE a business that already exists, against that business's own metrics
   (Product A vs Product B in the §14 example). Different owner, different lifetime, different question.
   They are not merged because merging would force one of them to carry the other's fields — and they are not
   duplicated because the P2 DISCIPLINE is shared instead: this module imports `EVIDENCE` from
   opportunities-store.js and `VERDICT_GRADE` from validation-store.js, so all three modules are physically
   incapable of disagreeing about what evidence can carry a verdict.

   METRICS ARE VALIDATED AGAINST §11's CATALOGUE (imported from business-metrics.js). An experiment measuring
   "vibes" would produce a result nobody could ever compare to anything; measuring a metric the business
   actually records is what makes the result checkable later.

   ISOLATION (P6). Every experiment belongs to one business; an empty businessId is refused everywhere.

   PURE: no IO, no clock, no env, no rng. `persist` and `now` injected. UMD. Mirrors business-tasks-store.js. */
'use strict';
(function (root, factory) {
  const mod = (typeof module !== 'undefined' && module.exports);
  const evidence = mod
    ? require('./opportunities-store.js').EVIDENCE
    : ((root.SK && root.SK.businessOpportunitiesStore && root.SK.businessOpportunitiesStore.EVIDENCE)
        || ['verified', 'analysis', 'assumption', 'estimate', 'prediction', 'unknown']);
  const grade = mod
    ? require('./validation-store.js').VERDICT_GRADE
    : ((root.SK && root.SK.validationStore && root.SK.validationStore.VERDICT_GRADE)
        || ['verified', 'analysis']);
  const metricIds = mod
    ? require('./business-metrics.js').METRIC_IDS
    : ((root.SK && root.SK.businessMetrics && root.SK.businessMetrics.METRIC_IDS) || []);
  const api = factory(evidence, grade, metricIds);
  if (mod) module.exports = api;
  else { (root.SK = root.SK || {}).businessExperimentsStore = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (EVIDENCE, VERDICT_GRADE, METRIC_IDS) {
  'use strict';

  // §14's life: planned (designed, not started) · running (collecting) · ended (data closed) · concluded
  // (a verdict was recorded). 'ended' and 'concluded' are distinct because ending is a fact about the clock
  // and concluding is a judgement about the data — and rule 1 above depends on that distinction.
  const STATUSES = ['planned', 'running', 'ended', 'concluded'];

  const CONCLUSIONS = ['supported', 'refuted', 'inconclusive'];

  const MAX_TEXT = 4000;
  const MAX_TITLE = 300;
  const MAX_ID = 120;
  const MAX_VARIANTS = 12;
  const MAX_RESULTS = 500;
  const DEFAULT_LIMIT = 500;

  function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }
  function round(n) { return Math.round(n * 1e6) / 1e6; }

  function makeBusinessExperimentsStore(opts) {
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

    const resultView = (x) => ({
      at: x.at != null ? x.at : null,
      variant: x.variant || '',
      metric: x.metric || '',
      value: x.value != null ? x.value : null,
      evidence: x.evidence || 'unknown',
      source: x.source || '',
      note: x.note || ''
    });

    const rowView = (r) => ({
      id: r.id, seq: r.seq, businessId: r.businessId,
      hypothesis: r.hypothesis,
      variable: r.variable || '',
      variants: (Array.isArray(r.variants) ? r.variants : []).slice(),
      metrics: (Array.isArray(r.metrics) ? r.metrics : []).slice(),
      status: r.status,
      startedAt: r.startedAt != null ? r.startedAt : null,
      endsAt: r.endsAt != null ? r.endsAt : null,
      endedAt: r.endedAt != null ? r.endedAt : null,
      results: (Array.isArray(r.results) ? r.results : []).map(resultView),
      conclusion: r.conclusion || '',
      conclusionReason: r.conclusionReason || '',
      nextAction: r.nextAction || '',
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

    /* CAN THIS EXPERIMENT CARRY THIS CONCLUSION? The one place the four rules live, so conclude() and any
       future path cannot drift apart. Returns { ok, reason } — a refusal always names what is missing. */
    function conclusionAllowed(exp, conclusion) {
      // Rule 4 first: the honest answer is never blocked.
      if (conclusion === 'inconclusive') return { ok: true };

      // Rule 1 — a verdict needs closed data.
      if (exp.status !== 'ended' && exp.status !== 'concluded') {
        return {
          ok: false,
          reason: 'cannot record a "' + conclusion + '" conclusion while the experiment is "' + exp.status +
            '" — end it first. A verdict on data that is still arriving is a theory, not a result (§14).'
        };
      }
      // Rule 2 — a controlled experiment has more than one arm.
      const variants = Array.isArray(exp.variants) ? exp.variants : [];
      if (variants.length < 2) {
        return {
          ok: false,
          reason: 'cannot record a "' + conclusion + '" conclusion with ' + variants.length +
            ' variant(s) — a controlled experiment needs at least two arms to compare (a single arm is an anecdote)'
        };
      }
      // Rule 3 — only verdict-grade evidence can carry a verdict. Same class list the Validation Lab uses.
      const graded = (Array.isArray(exp.results) ? exp.results : [])
        .map(resultView)
        .filter(r => r.evidence && VERDICT_GRADE.indexOf(r.evidence) >= 0);
      if (!graded.length) {
        return {
          ok: false,
          reason: 'cannot record a "' + conclusion + '" conclusion without at least one ' +
            VERDICT_GRADE.join(' or ').toUpperCase() + ' result — assumptions, estimates and predictions ' +
            'cannot carry a verdict (P2: no fabricated conclusions). Record it as inconclusive instead.'
        };
      }
      return { ok: true };
    }

    // ---- reads -------------------------------------------------------------------------------------
    function experiments(businessId, o) {
      const b = biz(businessId);
      if (!b) return [];
      o = o || {};
      let rows = forBiz(b);
      if (o.status) rows = rows.filter(r => r.status === String(o.status));
      if (o.conclusion) rows = rows.filter(r => r.conclusion === String(o.conclusion));
      return rows.slice().sort((a, b2) => (a.seq || 0) - (b2.seq || 0)).map(rowView);
    }
    function experiment(id) { const i = indexOf(id); return i < 0 ? null : rowView(records[i]); }
    function has(id) { return indexOf(id) >= 0; }
    function count(businessId) { const b = biz(businessId); return b ? forBiz(b).length : 0; }

    /* Per-variant tally of the recorded results. Counts and SUMS of what was actually recorded — never an
       "effect size", a significance test, or a winner. Deciding what the numbers mean is the Commander's
       call; this store's job is to make sure they are the real numbers (§14, P7). */
    function tally(id) {
      const exp = experiment(id);
      if (!exp) return null;
      const out = { variants: {}, byEvidence: {}, total: exp.results.length };
      for (const v of exp.variants) out.variants[v] = { readings: 0, metrics: {} };
      for (const e of EVIDENCE) out.byEvidence[e] = 0;
      for (const r of exp.results) {
        if (Object.prototype.hasOwnProperty.call(out.byEvidence, r.evidence)) out.byEvidence[r.evidence]++;
        if (!out.variants[r.variant]) out.variants[r.variant] = { readings: 0, metrics: {} };
        const bucket = out.variants[r.variant];
        bucket.readings++;
        if (r.metric) {
          const cur = bucket.metrics[r.metric] || { sum: 0, n: 0, min: null, max: null };
          const n = num(r.value);
          cur.sum = round(cur.sum + n); cur.n++;
          cur.min = (cur.min == null || n < cur.min) ? n : cur.min;
          cur.max = (cur.max == null || n > cur.max) ? n : cur.max;
          bucket.metrics[r.metric] = cur;
        }
      }
      return out;
    }

    function summary(businessId) {
      const rows = experiments(businessId);
      const out = { total: rows.length, byStatus: {}, byConclusion: {}, withVerdict: 0 };
      for (const s of STATUSES) out.byStatus[s] = 0;
      for (const c of CONCLUSIONS) out.byConclusion[c] = 0;
      for (const r of rows) {
        if (Object.prototype.hasOwnProperty.call(out.byStatus, r.status)) out.byStatus[r.status]++;
        if (r.conclusion && Object.prototype.hasOwnProperty.call(out.byConclusion, r.conclusion)) out.byConclusion[r.conclusion]++;
        if (r.conclusion && r.conclusion !== 'inconclusive') out.withVerdict++;
      }
      return out;
    }

    // ---- writes ------------------------------------------------------------------------------------
    function open(businessId, meta) {
      meta = meta || {};
      const b = biz(businessId);
      if (!b) return { ok: false, reason: 'a businessId is required (isolation is by key — never implied)' };
      const hypothesis = str(meta.hypothesis, MAX_TEXT).trim();
      if (!hypothesis) return { ok: false, reason: 'an experiment must state a hypothesis — §14 runs a test, not a wish' };

      const variants = strList(meta.variants, MAX_VARIANTS, 120);
      if (variants.length < 2) {
        return { ok: false, reason: 'an experiment needs at least two variants to compare (the §14 example: Product A vs Product B)' };
      }
      const metrics = strList(meta.metrics, MAX_VARIANTS, 60);
      for (const m of metrics) {
        if (METRIC_IDS.length && METRIC_IDS.indexOf(m) < 0) {
          return { ok: false, reason: 'unknown metric: "' + m + '" — an experiment must measure a metric the business actually records (§11): ' + METRIC_IDS.join(', ') };
        }
      }

      let endsAt = meta.endsAt;
      if (endsAt == null || endsAt === '') endsAt = null;
      else {
        endsAt = Number(endsAt);
        if (!isFinite(endsAt) || endsAt <= 0) return { ok: false, reason: 'endsAt must be an epoch-ms number' };
      }

      const at = now();
      const seq = nextSeq(b);
      const row = {
        // '~' not '#' — an experiment id travels in a URL path (see validation-store.js).
        id: b + '~x' + seq, seq: seq, businessId: b,
        hypothesis: hypothesis,
        variable: str(meta.variable, 200),
        variants: variants, metrics: metrics,
        status: 'planned',
        startedAt: null, endsAt: endsAt, endedAt: null,
        results: [],
        conclusion: '', conclusionReason: '', nextAction: '',
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
      return { ok: true, experiment: rowView(row) };
    }

    // planned -> running. A conclusion already recorded cannot be reopened by a status flip.
    function start(id) {
      const i = indexOf(id);
      if (i < 0) return { ok: false, reason: 'unknown experiment: ' + id };
      const prev = records[i];
      if (prev.status !== 'planned') return { ok: false, reason: 'only a planned experiment can be started (this one is "' + prev.status + '")' };
      const nextRow = Object.assign({}, prev, { status: 'running', startedAt: now(), updatedAt: now() });
      const next = records.slice(); next[i] = nextRow;
      const w = commit(next);
      if (!w.ok) return w;
      return { ok: true, experiment: rowView(nextRow) };
    }

    /* RECORD A RESULT. Allowed while running or after ending (late data is real); refused on a planned
       experiment, because a result for a test that never ran is not a result. Every result needs a source
       and an evidence class (P1) — an unlabelled reading is the "theory" §14 exists to replace. */
    function recordResult(id, meta) {
      meta = meta || {};
      const i = indexOf(id);
      if (i < 0) return { ok: false, reason: 'unknown experiment: ' + id };
      const prev = records[i];
      if (prev.status !== 'running' && prev.status !== 'ended') {
        return { ok: false, reason: 'results can only be recorded while the experiment is running or after it ended (this one is "' + prev.status + '")' };
      }
      const variant = str(meta.variant, 120).trim();
      if (!variant) return { ok: false, reason: 'a result must name the variant it came from' };
      if ((prev.variants || []).indexOf(variant) < 0) {
        return { ok: false, reason: 'unknown variant: "' + variant + '" — this experiment compares: ' + (prev.variants || []).join(', ') };
      }
      const metric = str(meta.metric, 60).trim();
      if (metric && (prev.metrics || []).indexOf(metric) < 0) {
        return { ok: false, reason: 'unknown metric for this experiment: "' + metric + '" — it measures: ' + ((prev.metrics || []).join(', ') || '(none declared)') };
      }
      const value = Number(meta.value);
      if (!isFinite(value)) return { ok: false, reason: 'a result needs a numeric value' };
      const source = str(meta.source, MAX_TEXT).trim();
      if (!source) return { ok: false, reason: 'a result needs a source (P1) — where the number came from' };
      const evidence = String(meta.evidence == null ? '' : meta.evidence);
      if (EVIDENCE.indexOf(evidence) < 0) {
        return { ok: false, reason: 'a result needs an evidence class, one of: ' + EVIDENCE.join(', ') };
      }

      const list = (Array.isArray(prev.results) ? prev.results : []).slice();
      list.push({
        at: (meta.at != null && isFinite(Number(meta.at))) ? Number(meta.at) : now(),
        variant: variant, metric: metric, value: round(value),
        evidence: evidence, source: source, note: str(meta.note, MAX_TEXT)
      });
      const kept = list.length > MAX_RESULTS ? list.slice(list.length - MAX_RESULTS) : list;

      const nextRow = Object.assign({}, prev, { results: kept, updatedAt: now() });
      const next = records.slice(); next[i] = nextRow;
      const w = commit(next);
      if (!w.ok) return w;
      return { ok: true, experiment: rowView(nextRow) };
    }

    // running -> ended. Closes the data window; a verdict becomes possible only after this.
    function end(id) {
      const i = indexOf(id);
      if (i < 0) return { ok: false, reason: 'unknown experiment: ' + id };
      const prev = records[i];
      if (prev.status !== 'running') return { ok: false, reason: 'only a running experiment can be ended (this one is "' + prev.status + '")' };
      const at = now();
      const nextRow = Object.assign({}, prev, { status: 'ended', endedAt: at, updatedAt: at });
      const next = records.slice(); next[i] = nextRow;
      const w = commit(next);
      if (!w.ok) return w;
      return { ok: true, experiment: rowView(nextRow) };
    }

    /* CONCLUDE. The four rules live in conclusionAllowed() so this and any future caller cannot drift. */
    function conclude(id, meta) {
      meta = meta || {};
      const i = indexOf(id);
      if (i < 0) return { ok: false, reason: 'unknown experiment: ' + id };
      const prev = records[i];
      const conclusion = String(meta.conclusion == null ? '' : meta.conclusion);
      if (CONCLUSIONS.indexOf(conclusion) < 0) {
        return { ok: false, reason: 'unknown conclusion: ' + (conclusion || '(none)') + ' — one of: ' + CONCLUSIONS.join(', ') };
      }
      const allowed = conclusionAllowed(rowView(prev), conclusion);
      if (!allowed.ok) return allowed;

      const at = now();
      const nextRow = Object.assign({}, prev, {
        status: 'concluded',
        conclusion: conclusion,
        conclusionReason: str(meta.reason, MAX_TEXT),
        nextAction: str(meta.nextAction, MAX_TEXT),
        updatedAt: at
      });
      const next = records.slice(); next[i] = nextRow;
      const w = commit(next);
      if (!w.ok) return w;
      return { ok: true, experiment: rowView(nextRow) };
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
      STATUSES, CONCLUSIONS, EVIDENCE, VERDICT_GRADE, METRIC_IDS, LIMIT: limit,
      experiments, experiment, has, count, tally, summary, conclusionAllowed,
      open, start, recordResult, end, conclude, remove, clear
    };
  }

  return { makeBusinessExperimentsStore, STATUSES, CONCLUSIONS, DEFAULT_LIMIT };
});
