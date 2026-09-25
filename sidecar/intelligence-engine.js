/* sidecar/intelligence-engine.js — §11 BUSINESS INTELLIGENCE, the ANALYTIC layer (Business OS Phase 7).

   Phase 4 built business-metrics.js to RECORD readings. This module reads them back and says something true.
   §11's second sentence is the whole brief: "The AI may explain changes — e.g. 'Revenue decreased this
   month' — by investigating available evidence and stating possible causes without pretending certainty (P1)."

   THREE WORDS IN THAT SENTENCE DO ALL THE WORK, AND EACH ONE IS A STRUCTURAL CONSTRAINT HERE:

     "investigating available evidence" — an explanation is only offered when OTHER recorded facts exist that
       could bear on the change. No corroborating signal recorded => the engine reports the change and says
       it has no candidate cause. It never reaches for a plausible-sounding story (P2).

     "possible causes" — the output vocabulary is `possible`, never `because`. `explain()` returns
       `causes: [{ text, evidence, confidence }]` where confidence is one of 'strong'|'moderate'|'weak', and
       every cause names the evidence class it rests on. A weak correlation reads as a weak correlation.

     "without pretending certainty" — `trend()` returns `null` direction when the data cannot support one
       (fewer than MIN_READINGS readings, or a baseline of zero where a percentage is meaningless). It does
       NOT return 0% growth, and it does NOT smooth a gap.

   THE ZERO-BASELINE TRAP, handled explicitly: revenue going 0 -> 500 is not "infinite % growth" and revenue
   going 500 -> 0 is not "-100% with high confidence". The first is "started recording" and the second is
   "stopped" — both are reported as `kind:'onset'` / `kind:'cessation'` with the raw values, never as a
   percentage, because a percentage of nothing is not a fact.

   NO DERIVED SCORE (P7). This module computes CHANGE, DIRECTION and CANDIDATE EXPLANATIONS. It does not
   compute a "health score", a "growth grade", or a forecast. Those would be numbers the application invented
   and could not defend, which is precisely what P7 forbids.

   PORTFOLIO is the one genuinely cross-business read (§30: "cross-business portfolio analytics"), and it is
   built from EACH business's own rows — it never mixes a reading from one business into another's series. A
   business with no reading for a metric contributes `null`, not 0, so a portfolio total is the sum of what
   was actually recorded and `coverage` states how many businesses that covers.

   OPPORTUNITY SIGNALS are CONDITIONS ON RECORDED DATA, not recommendations. A signal says "conversion fell
   three periods running" — it does not say "you should run an experiment". Choosing to act is the owner's
   call (P5); this module's job is to make the condition visible and checkable.

   PURE: no IO, no clock, no env, no rng. Reads arrive through injected accessors. UMD. */
'use strict';
(function (root, factory) {
  const mod = (typeof module !== 'undefined' && module.exports);
  const metricsMod = mod
    ? require('./business-metrics.js')
    : (root.SK && root.SK.businessMetrics) || null;
  const api = factory(metricsMod);
  if (mod) module.exports = api;
  else { (root.SK = root.SK || {}).intelligenceEngine = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (MetricsMod) {
  'use strict';

  const METRICS = (MetricsMod && MetricsMod.METRICS) || [];
  const METRIC_IDS = (MetricsMod && MetricsMod.METRIC_IDS) || [];

  // A direction needs at least two readings to be a direction and not a single data point.
  const MIN_READINGS = 2;
  // A change smaller than this (as a fraction) reads as 'flat' — noise, not a trend.
  const FLAT_BAND = 0.02;
  // How far back a "recent period" reaches, in ms. Default 30 days.
  const DEFAULT_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;
  // An anomaly is a reading this many median-absolute-deviations from the median.
  const ANOMALY_MAD = 3;
  // Below this many readings a MAD is not a baseline, it is a guess.
  const MIN_BASELINE = 4;

  const DIRECTIONS = ['up', 'down', 'flat', 'onset', 'cessation', 'unknown'];

  function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }
  function round(n, p) { const f = Math.pow(10, p == null ? 6 : p); return Math.round(n * f) / f; }
  function byId(id) { const s = String(id == null ? '' : id); return METRICS.filter(m => m.id === s)[0] || null; }

  /* MEDIAN + MEDIAN ABSOLUTE DEVIATION. Chosen over mean/stdev because a single wild reading — exactly the
     thing anomaly detection is hunting — barely moves a median but drags a mean and inflates a stdev, so a
     mean/stdev detector hides the outlier it was built to find. Returns null when there is not enough data
     to call it a baseline. */
  function baseline(values) {
    const vs = values.filter(v => isFinite(v)).slice().sort((a, b) => a - b);
    if (vs.length < MIN_BASELINE) return null;
    const mid = Math.floor(vs.length / 2);
    const median = vs.length % 2 ? vs[mid] : (vs[mid - 1] + vs[mid]) / 2;
    const devs = vs.map(v => Math.abs(v - median)).sort((a, b) => a - b);
    const dmid = Math.floor(devs.length / 2);
    const mad = devs.length % 2 ? devs[dmid] : (devs[dmid - 1] + devs[dmid]) / 2;
    return { median: median, mad: mad, n: vs.length, min: vs[0], max: vs[vs.length - 1] };
  }

  function makeIntelligenceEngine(opts) {
    opts = opts || {};
    /* INJECTED ACCESSORS, not the stores themselves. Every one is optional and every one is consulted
       through a guard, so the engine is testable with plain arrays and cannot crash the host when a
       business layer is absent. `metrics` is the primary source (§11 readings); the rest are the
       CORROBORATING sources an explanation is allowed to draw on. */
    const readings = typeof opts.readings === 'function' ? opts.readings : null;   // (businessId, metricId) -> [{value, at, evidence, source}]
    const activities = typeof opts.activities === 'function' ? opts.activities : null; // (businessId, {since,until}) -> [{action, result, at}]
    const experiments = typeof opts.experiments === 'function' ? opts.experiments : null; // (businessId) -> [{status, conclusion, metrics}]
    const businesses = typeof opts.businesses === 'function' ? opts.businesses : null;   // () -> [{id, name, ...}]
    const now = typeof opts.now === 'function' ? opts.now : (() => null);

    function list(businessId, metricId) {
      if (!readings) return [];
      try {
        const rows = readings(businessId, metricId);
        return Array.isArray(rows) ? rows.filter(r => r && isFinite(Number(r.value))) : [];
      } catch (_) { return []; }
    }
    // Time-ordered, oldest first. `at` missing sorts last rather than being invented.
    function ordered(rows) {
      return rows.slice().sort((a, b) => (num(a.at) - num(b.at)));
    }
    function acts(businessId, o) {
      if (!activities) return [];
      try {
        const rows = activities(businessId, o || {});
        return Array.isArray(rows) ? rows.filter(r => r && r.action) : [];
      } catch (_) { return []; }
    }
    function exps(businessId) {
      if (!experiments) return [];
      try {
        const rows = experiments(businessId);
        return Array.isArray(rows) ? rows.filter(r => r && r.id) : [];
      } catch (_) { return []; }
    }

    /* ---- CHANGE -----------------------------------------------------------------------------------
       Compare the LATEST reading against the latest reading that falls BEFORE the current period opened.
       Two samples, not two averages: an average over a sparse period would invent a value for the days
       nobody recorded anything. Returns null when either sample is missing — no baseline, no claim. */
    function change(businessId, metricId, o) {
      o = o || {};
      const def = byId(metricId);
      if (!def) return null;
      const periodMs = (Number.isFinite(o.periodMs) && o.periodMs > 0) ? o.periodMs : DEFAULT_PERIOD_MS;
      const rows = ordered(list(businessId, metricId));
      if (rows.length < MIN_READINGS) {
        return {
          metric: metricId, label: def.label, unit: def.unit, kind: def.kind,
          direction: 'unknown', confidence: 'none',
          from: null, to: rows.length ? rows[rows.length - 1].value : null,
          changeAbs: null, changePct: null, at: rows.length ? rows[rows.length - 1].at : null,
          readings: rows.length,
          note: rows.length === 0
            ? 'no readings recorded for this metric'
            : 'only ' + rows.length + ' reading(s) recorded — a direction needs at least ' + MIN_READINGS
        };
      }
      const last = rows[rows.length - 1];
      const cut = num(last.at) - periodMs;
      let prev = null;
      let shortHistory = false;
      for (let i = rows.length - 2; i >= 0; i--) { if (num(rows[i].at) <= cut) { prev = rows[i]; break; } }
      /* WINDOW WIDER THAN HISTORY. A business two weeks into tracking has every reading inside a 30-day
         window, so "the reading before the window opened" does not exist. Refusing outright would leave a
         young business with a panel of permanent "unknown" — technically honest, practically useless. So
         the baseline falls back to the EARLIEST reading and the report says so in `note`, keeping the
         weaker of the two readings: this is a comparison across the whole recorded history, not across a
         matched period. The confidence grade still reflects how much data stands behind it. */
      if (!prev) {
        if (rows.length < MIN_READINGS) {
          return {
            metric: metricId, label: def.label, unit: def.unit, kind: def.kind,
            direction: 'unknown', confidence: 'none',
            from: null, to: last.value, changeAbs: null, changePct: null, at: last.at,
            readings: rows.length,
            note: 'nothing to compare against'
          };
        }
        prev = rows[0];
        shortHistory = true;
      }
      const spanDays = Math.round((num(last.at) - num(rows[0].at)) / 86400000);

      const from = num(prev.value), to = num(last.value);
      const changeAbs = round(to - from, 6);
      // Appended to every note below: how much history the comparison actually stands on.
      const span = shortHistory
        ? 'the comparison window is wider than the recorded history (' + spanDays + ' day(s)), so the baseline is the earliest reading, not a matched period'
        : '';

      /* THE ZERO TRAPS. A percentage is undefined when the baseline is zero, and reporting 100%/-100%
         there would be the single most misleading number this panel could print. */
      if (from === 0 && to === 0) {
        return { metric: metricId, label: def.label, unit: def.unit, kind: def.kind,
          direction: 'flat', confidence: 'strong', from: 0, to: 0, changeAbs: 0, changePct: null,
          at: last.at, readings: rows.length, shortHistory: shortHistory,
          note: 'both readings are zero' };
      }
      if (from === 0) {
        return { metric: metricId, label: def.label, unit: def.unit, kind: def.kind,
          direction: 'onset', confidence: 'strong', from: 0, to: to, changeAbs: changeAbs, changePct: null,
          at: last.at, readings: rows.length, shortHistory: shortHistory,
          note: 'started from zero — a percentage change from nothing is not a fact, so only the absolute move is reported' };
      }
      if (to === 0) {
        return { metric: metricId, label: def.label, unit: def.unit, kind: def.kind,
          direction: 'cessation', confidence: 'strong', from: from, to: 0, changeAbs: changeAbs, changePct: null,
          at: last.at, readings: rows.length, shortHistory: shortHistory,
          note: 'fell to zero — reported as a stop, not as -100%' };
      }

      const changePct = round((to - from) / from, 6);
      const mag = Math.abs(changePct);
      const direction = mag < FLAT_BAND ? 'flat' : (changePct > 0 ? 'up' : 'down');
      /* CONFIDENCE IS ABOUT THE DATA, NOT THE MOVE. A huge swing on two readings is a huge swing we have
         barely observed; the same swing on twenty readings is well observed. Saying so is the difference
         between evidence and enthusiasm. A comparison drawn across a short history is capped at 'weak'
         regardless of reading count, because the window does not match the period it claims to describe. */
      const confidence = shortHistory ? 'weak' : (rows.length >= 8 ? 'strong' : (rows.length >= 4 ? 'moderate' : 'weak'));
      return {
        metric: metricId, label: def.label, unit: def.unit, kind: def.kind,
        direction: direction, confidence: confidence,
        from: from, to: to, changeAbs: changeAbs, changePct: changePct, at: last.at,
        readings: rows.length, shortHistory: shortHistory, note: span
      };
    }

    // Every §11 metric this business records, as a change report. Metrics with no readings are omitted.
    function trends(businessId, o) {
      const out = [];
      for (const def of METRICS) {
        const c = change(businessId, def.id, o);
        if (c) out.push(c);
      }
      return out;
    }

    /* ---- EXPLANATION ------------------------------------------------------------------------------
       §11's "investigating available evidence". Given a metric that moved, look ONLY at facts this
       business actually recorded in the window and offer them as CANDIDATE causes, each labelled with
       the evidence class it rests on and a confidence the reader can audit.

       The corroborating sources are the OTHER business stores: a burst of failed automations, an
       experiment that ended, a run of errors in the activity log. Each is a REAL recorded event that
       overlaps the window — not a theory about the market, a season, or a competitor. */
    function explain(businessId, metricId, o) {
      o = o || {};
      const c = change(businessId, metricId, o);
      if (!c) return null;
      const out = {
        metric: metricId, label: c.label, unit: c.unit,
        direction: c.direction, confidence: c.confidence,
        from: c.from, to: c.to, changeAbs: c.changeAbs, changePct: c.changePct,
        at: c.at, readings: c.readings,
        causes: [],
        verdict: ''
      };

      if (c.direction === 'unknown') {
        out.verdict = 'not enough recorded data to describe a change, let alone explain one';
        return out;
      }
      if (c.direction === 'flat') {
        out.verdict = 'no meaningful change recorded in this window';
        return out;
      }

      const until = num(c.at);
      const since = until - ((Number.isFinite(o.periodMs) && o.periodMs > 0) ? o.periodMs : DEFAULT_PERIOD_MS);

      /* CANDIDATE 1 — an experiment that opened or closed inside the window. An experiment is a deliberate
         change to the business, so it is the strongest recorded thing that could move a metric. */
      for (const e of exps(businessId)) {
        const started = num(e.startedAt), ended = num(e.endedAt);
        const inWindow = (started && started >= since && started <= until) || (ended && ended >= since && ended <= until);
        if (!inWindow) continue;
        const measures = Array.isArray(e.metrics) && e.metrics.indexOf(metricId) >= 0;
        out.causes.push({
          kind: 'experiment',
          text: 'an experiment' + (measures ? ' measuring this metric' : '') + ' changed state in this window' +
            (e.status ? ' (now "' + e.status + '")' : ''),
          evidence: 'verified',
          confidence: measures ? 'strong' : 'weak',
          ref: e.id || ''
        });
      }

      /* CANDIDATE 2 — recorded failures. A metric that fell while the log shows errors is a correlation
         worth naming, and it is labelled 'weak' because co-occurrence is not causation. */
      const rows = acts(businessId, { since: since, until: until });
      const failed = rows.filter(a => a.result === 'error');
      if (failed.length) {
        out.causes.push({
          kind: 'failures',
          text: failed.length + ' recorded failure(s) in this window — this is a co-occurrence, not a proven cause',
          evidence: 'verified',
          confidence: 'weak',
          ref: ''
        });
      }
      const denied = rows.filter(a => a.approval === 'denied');
      if (denied.length) {
        out.causes.push({
          kind: 'denied',
          text: denied.length + ' action(s) were denied in this window, so planned work did not run',
          evidence: 'verified',
          confidence: 'weak',
          ref: ''
        });
      }

      /* CANDIDATE 3 — the measurement itself. Fewer readings than the window justifies is the most common
         real reason a number looks like it moved, and it is the one a dashboard never mentions. */
      if (c.readings < 4) {
        out.causes.push({
          kind: 'sampling',
          text: 'only ' + c.readings + ' reading(s) exist — a move this thinly observed may be measurement noise',
          evidence: 'analysis',
          confidence: 'moderate',
          ref: ''
        });
      }

      if (!out.causes.length) {
        out.verdict = 'this metric ' + (c.direction === 'up' ? 'rose' : c.direction === 'down' ? 'fell' : 'changed') +
          ', but nothing else this business recorded in the window bears on it — no cause is offered rather than one invented';
      } else {
        out.verdict = 'this metric ' + (c.direction === 'up' ? 'rose' : 'fell') +
          '. The causes below are CANDIDATES drawn from recorded events in the same window — none is asserted as the reason.';
      }
      return out;
    }

    /* ---- ANOMALIES --------------------------------------------------------------------------------
       A reading far from this metric's own median, by median-absolute-deviation. Returns [] when there is
       not enough history to call anything a baseline — with MIN_BASELINE readings the honest answer is
       "no baseline yet", not "everything is normal". */
    function anomalies(businessId, o) {
      o = o || {};
      const out = [];
      for (const def of METRICS) {
        const rows = ordered(list(businessId, def.id));
        if (rows.length < MIN_BASELINE) continue;
        const values = rows.map(r => num(r.value));
        const b = baseline(values);
        if (!b || b.mad === 0) continue;       // a perfectly flat series has no deviation to exceed
        for (const r of rows) {
          const v = num(r.value);
          const dev = Math.abs(v - b.median) / b.mad;
          if (dev >= ANOMALY_MAD) {
            out.push({
              metric: def.id, label: def.label, unit: def.unit,
              value: v, median: round(b.median, 6), mad: round(b.mad, 6),
              deviations: round(dev, 2), at: r.at != null ? r.at : null,
              source: r.source || '', evidence: r.evidence || 'unknown',
              direction: v > b.median ? 'high' : 'low'
            });
          }
        }
      }
      return out;
    }

    /* ---- PORTFOLIO (§30: cross-business portfolio analytics) --------------------------------------
       One row per §11 metric, aggregated across businesses. A business with no reading contributes null —
       never 0 — so `coverage` is the count of businesses that actually reported and the totals are sums
       of real readings. `spread` says how uneven the businesses are, which is the fact a portfolio view
       exists to show: one business carrying a total is not the same picture as four sharing it. */
    function portfolio(o) {
      o = o || {};
      const ids = (Array.isArray(o.businessIds) && o.businessIds.length)
        ? o.businessIds.slice()
        : (businesses ? (function () { try { const b = businesses(); return Array.isArray(b) ? b.map(x => x && x.id).filter(Boolean) : []; } catch (_) { return []; } })() : []);
      const out = { businesses: ids.length, metrics: [], generatedAt: now() };
      for (const def of METRICS) {
        const contributors = [];
        let sum = 0, n = 0, min = null, max = null;
        for (const bid of ids) {
          const rows = ordered(list(bid, def.id));
          if (!rows.length) { contributors.push({ businessId: bid, value: null, at: null }); continue; }
          const last = rows[rows.length - 1];
          const v = num(last.value);
          contributors.push({ businessId: bid, value: v, at: last.at != null ? last.at : null });
          sum += v; n++;
          if (min == null || v < min) min = v;
          if (max == null || v > max) max = v;
        }
        out.metrics.push({
          metric: def.id, label: def.label, unit: def.unit,
          /* A RATE IS NOT SUMMED. Adding four conversion rates produces a number that means nothing; the
             honest aggregate for a rate is the mean of the reported rates, and it says so. */
          total: def.unit === 'rate' ? null : (n ? round(sum, 6) : null),
          mean: n ? round(sum / n, 6) : null,
          min: min, max: max,
          coverage: n, missing: ids.length - n,
          contributors: contributors
        });
      }
      return out;
    }

    /* ---- OPPORTUNITY SIGNALS ---------------------------------------------------------------------
       Conditions on recorded data that a business owner would want to see. Each names the evidence it
       rests on and carries no recommendation — this module reports conditions, the owner decides (P5). */
    function signals(businessId, o) {
      o = o || {};
      const out = [];
      const push = (s) => out.push(s);

      // 1 — a metric that moved the same direction in every consecutive comparison. Persistence, not size.
      for (const def of METRICS) {
        const rows = ordered(list(businessId, def.id));
        if (rows.length < 4) continue;
        let run = 0, dir = 0;
        for (let i = 1; i < rows.length; i++) {
          const d = num(rows[i].value) - num(rows[i - 1].value);
          const s = d > 0 ? 1 : (d < 0 ? -1 : 0);
          if (s === 0) { run = 0; dir = 0; continue; }
          if (s === dir) run++; else { run = 1; dir = s; }
        }
        if (run >= 3) {
          push({
            kind: 'persistent-trend', metric: def.id, label: def.label, unit: def.unit,
            text: def.label + ' has moved ' + (dir > 0 ? 'up' : 'down') + ' for ' + (run + 1) + ' consecutive readings',
            direction: dir > 0 ? 'up' : 'down', streak: run + 1,
            evidence: 'verified', confidence: rows.length >= 8 ? 'moderate' : 'weak'
          });
        }
      }

      // 2 — an anomalous reading (reuses the same detector, so the two can never disagree).
      for (const a of anomalies(businessId, o)) {
        push({
          kind: 'anomaly', metric: a.metric, label: a.label, unit: a.unit,
          text: a.label + ' read ' + (a.direction === 'high' ? 'far above' : 'far below') + ' its own baseline (' +
            a.deviations + ' MAD from median ' + a.median + ')',
          direction: a.direction, at: a.at, value: a.value,
          evidence: a.evidence, confidence: 'moderate'
        });
      }

      // 3 — a metric recorded once and never updated. Stale data is a real condition, and it is the one
      //     that makes every downstream number quietly untrue.
      for (const def of METRICS) {
        const rows = ordered(list(businessId, def.id));
        if (rows.length !== 1) continue;
        push({
          kind: 'single-reading', metric: def.id, label: def.label, unit: def.unit,
          text: def.label + ' has exactly one reading — no trend, no anomaly and no comparison is possible yet',
          direction: 'unknown', at: rows[0].at != null ? rows[0].at : null,
          evidence: rows[0].evidence || 'unknown', confidence: 'strong'
        });
      }

      // 4 — an experiment that ended but was never concluded. §14 exists so the business learns from data;
      //     an ended-but-unconcluded experiment is learning left on the table.
      for (const e of exps(businessId)) {
        if (e.status === 'ended') {
          push({
            kind: 'unconcluded-experiment', metric: '', label: 'Experiment', unit: '',
            text: 'an experiment ended without a recorded conclusion — the data is closed but no verdict was drawn',
            direction: 'unknown', at: e.endedAt != null ? e.endedAt : null,
            evidence: 'verified', confidence: 'strong', ref: e.id || ''
          });
        }
      }
      return out;
    }

    /* ONE BUSINESS, ONE SCREEN. The summary a console mounts: what moved, what is odd, what to look at.
       Every field is derived above — nothing here is computed independently, so the screen cannot disagree
       with the detail views. */
    function digest(businessId, o) {
      o = o || {};
      const t = trends(businessId, o);
      const moved = t.filter(x => x.direction !== 'unknown' && x.direction !== 'flat');
      return {
        businessId: businessId,
        generatedAt: now(),
        tracked: t.length,
        moved: moved.length,
        trends: t,
        anomalies: anomalies(businessId, o),
        signals: signals(businessId, o),
        /* HEADLINE IS A QUOTE OF RECORDED FACTS, not a judgement. It names the largest mover only when the
           data supports calling it a move; otherwise it says so. */
        headline: moved.length
          ? (function () {
              const top = moved.slice().sort((a, b) => Math.abs(num(b.changePct)) - Math.abs(num(a.changePct)))[0];
              return top.label + ' ' + (top.direction === 'up' ? 'rose' : top.direction === 'down' ? 'fell' : 'started') +
                (top.changePct != null ? ' ' + Math.abs(round(top.changePct * 100, 1)) + '%' : ' from ' + top.from + ' to ' + top.to) +
                ' (' + top.confidence + ' confidence, ' + top.readings + ' readings)';
            })()
          : 'no metric recorded a meaningful change in this window'
      };
    }

    return {
      METRICS: METRICS, METRIC_IDS: METRIC_IDS, DIRECTIONS: DIRECTIONS,
      MIN_READINGS: MIN_READINGS, MIN_BASELINE: MIN_BASELINE, FLAT_BAND: FLAT_BAND,
      ANOMALY_MAD: ANOMALY_MAD, DEFAULT_PERIOD_MS: DEFAULT_PERIOD_MS,
      baseline, change, trends, explain, anomalies, portfolio, signals, digest
    };
  }

  return { makeIntelligenceEngine, METRICS: METRICS, METRIC_IDS: METRIC_IDS, DIRECTIONS: DIRECTIONS, baseline, DEFAULT_PERIOD_MS: DEFAULT_PERIOD_MS };
});
