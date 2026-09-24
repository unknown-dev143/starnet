/* sidecar/business-metrics.js — §11 BUSINESS INTELLIGENCE (Business OS Phase 4).

   §11 names the metrics a business tracks and then states the honesty rule: "The AI may explain changes —
   e.g. 'Revenue decreased this month' — by investigating available evidence and stating possible causes
   without pretending certainty (P1)."

   SO THIS STORE RECORDS READINGS, IT DOES NOT MANUFACTURE THEM. Three consequences, all structural:

     1. The metric set is CLOSED (§11's own list). A typo does not create a new metric, it is refused — so
        "converison-rate" cannot become a second series that quietly shadows the real one.

     2. `latest()` RETURNS null WHEN NOTHING WAS RECORDED — never 0. This is the whole point. A dashboard
        that renders an unrecorded churn as "0%" is stating a fact it does not have, and 0% churn is the
        single most flattering lie a metrics panel can tell. Absent data reads as absent.

     3. Every reading carries a `source` (P1, required) AND an evidence class from the ONE shared vocabulary
        (`EVIDENCE`, imported from opportunities-store.js exactly as business-permissions.js does, so the
        whole application cannot end up with two definitions of "verified").

   RATE METRICS ARE BOUNDED 0..1. A conversion rate of 3 is a data-entry error, not 300%, and silently
   accepting it would poison every average computed downstream. Rates are stored as FRACTIONS so that
   "0.032" and "3.2%" can never be confused for one another in the file.

   NO DERIVED SCORE (P7). This module exposes readings, the latest reading, and bucketed readings. It
   computes no growth percentage, no "business health", and no forecast. `series()` returns the last reading
   in each bucket plus how many readings landed there — a count and a value, both checkable.

   IT IS NOT insights.js. That module folds AI RUN rows (tokens, usd, model) into a usage report — the
   station's own cost telemetry. This is a business's performance. Different subject entirely (P4).

   PURE: no IO, no clock, no env, no rng. `persist` and `now` injected. UMD. Mirrors business-tasks-store.js. */
'use strict';
(function (root, factory) {
  const evidence = (typeof module !== 'undefined' && module.exports)
    ? require('./opportunities-store.js').EVIDENCE
    : ((root.SK && root.SK.businessOpportunitiesStore && root.SK.businessOpportunitiesStore.EVIDENCE)
        || ['verified', 'analysis', 'assumption', 'estimate', 'prediction', 'unknown']);
  const api = factory(evidence);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).businessMetrics = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (EVIDENCE) {
  'use strict';

  // §11's list, verbatim and complete. `unit` decides validation; `kind` decides how a reader should treat
  // it — a 'counter' accumulates, a 'gauge' is a reading at a moment.
  const METRICS = [
    { id: 'visitors',        label: 'Visitors',                 unit: 'count',    kind: 'counter' },
    { id: 'leads',           label: 'Leads',                    unit: 'count',    kind: 'counter' },
    { id: 'customers',       label: 'Customers',                unit: 'count',    kind: 'counter' },
    { id: 'conversion-rate', label: 'Conversion rate',          unit: 'rate',     kind: 'gauge'   },
    { id: 'revenue',         label: 'Revenue',                  unit: 'currency', kind: 'counter' },
    { id: 'profit',          label: 'Profit',                   unit: 'currency', kind: 'counter' },
    { id: 'retention',       label: 'Retention',                unit: 'rate',     kind: 'gauge'   },
    { id: 'churn',           label: 'Churn',                    unit: 'rate',     kind: 'gauge'   },
    { id: 'cac',             label: 'Customer acquisition cost', unit: 'currency', kind: 'gauge'  },
    { id: 'aov',             label: 'Average order value',      unit: 'currency', kind: 'gauge'   },
    { id: 'ltv',             label: 'Lifetime value',           unit: 'currency', kind: 'gauge'   },
    { id: 'engagement',      label: 'Engagement',               unit: 'count',    kind: 'counter' },
    { id: 'product-usage',   label: 'Product usage',            unit: 'count',    kind: 'counter' }
  ];
  const METRIC_IDS = METRICS.map(m => m.id);

  const UNITS = ['count', 'rate', 'currency'];
  const MAX_TEXT = 2000;
  const MAX_ID = 120;
  const DEFAULT_LIMIT = 20000;               // per business — readings are cheap and meant to be historical

  function round(n) { return Math.round(n * 1e6) / 1e6; }
  function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }

  function byId(id) { const s = String(id == null ? '' : id); return METRICS.filter(m => m.id === s)[0] || null; }

  function makeBusinessMetrics(opts) {
    opts = opts || {};
    const records = Array.isArray(opts.records) ? opts.records : [];
    const persist = typeof opts.persist === 'function' ? opts.persist : null;
    const now = typeof opts.now === 'function' ? opts.now : (() => null);
    const limit = (Number.isFinite(opts.limit) && opts.limit > 0) ? Math.floor(opts.limit) : DEFAULT_LIMIT;

    const str = (v, cap) => (v == null ? '' : String(v)).slice(0, cap);
    const indexOf = (id) => records.findIndex(r => r && r.id === id);
    const forBiz = (businessId) => records.filter(r => r && r.businessId === businessId);
    const biz = (v) => str(v, MAX_ID).trim();

    function nextSeq(businessId) {
      let max = 0;
      for (const r of records) if (r && r.businessId === businessId && r.seq > max) max = r.seq;
      return max + 1;
    }

    const rowView = (r) => ({
      id: r.id, seq: r.seq, businessId: r.businessId,
      metric: r.metric, value: r.value, unit: r.unit,
      source: r.source || '', evidence: r.evidence || 'unknown', note: r.note || '',
      at: r.at != null ? r.at : null
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

    // ---- reads -------------------------------------------------------------------------------------
    function list(businessId, o) {
      const b = biz(businessId);
      if (!b) return [];
      o = o || {};
      let rows = forBiz(b);
      if (o.metric) rows = rows.filter(r => r.metric === String(o.metric));
      if (o.evidence) rows = rows.filter(r => r.evidence === String(o.evidence));
      if (Number.isFinite(o.since)) rows = rows.filter(r => num(r.at) >= o.since);
      if (Number.isFinite(o.until)) rows = rows.filter(r => num(r.at) <= o.until);
      rows = rows.slice().sort((a, b2) => (num(a.at) - num(b2.at)) || (a.seq || 0) - (b2.seq || 0));
      const n = (Number.isFinite(o.limit) && o.limit > 0) ? Math.floor(o.limit) : 0;
      return (n ? rows.slice(-n) : rows).map(rowView);
    }
    function get(id) { const i = indexOf(id); return i < 0 ? null : rowView(records[i]); }
    function has(id) { return indexOf(id) >= 0; }
    function count(businessId) { const b = biz(businessId); return b ? forBiz(b).length : 0; }

    /* THE HONEST-UNKNOWN READ. Returns null when this business has never recorded this metric. It does NOT
       return 0, and it does NOT fall back to a sibling metric — see rule 2 in the header. */
    function latest(businessId, metric) {
      const b = biz(businessId);
      const m = String(metric == null ? '' : metric);
      if (!b || !byId(m)) return null;
      const rows = forBiz(b).filter(r => r.metric === m);
      if (!rows.length) return null;
      rows.sort((a, b2) => (num(a.at) - num(b2.at)) || (a.seq || 0) - (b2.seq || 0));
      return rowView(rows[rows.length - 1]);
    }

    // One row per §11 metric: the latest reading, or an explicit null. Never a fabricated zero.
    function summary(businessId) {
      const b = biz(businessId);
      if (!b) return [];
      return METRICS.map(m => {
        const rows = forBiz(b).filter(r => r.metric === m.id);
        const last = latest(b, m.id);
        return {
          metric: m.id, label: m.label, unit: m.unit, kind: m.kind,
          latest: last ? last.value : null,
          at: last ? last.at : null,
          evidence: last ? last.evidence : '',
          source: last ? last.source : '',
          readings: rows.length
        };
      });
    }

    /* SERIES for one metric. Pure arithmetic on epoch-ms `at`; the caller names the bucket width. Each bucket
       reports the LAST reading in it (a gauge's value at that time) plus how many readings landed there — a
       value and a count, never an average the store would have to justify. */
    function series(businessId, metric, o) {
      o = o || {};
      const b = biz(businessId);
      const m = String(metric == null ? '' : metric);
      const bucketMs = (Number.isFinite(o.bucketMs) && o.bucketMs > 0) ? Math.floor(o.bucketMs) : 86400000;
      if (!b || !byId(m)) return { bucketMs: bucketMs, metric: m, buckets: [] };
      const rows = forBiz(b).filter(r => r.metric === m && Number.isFinite(num(r.at)) && num(r.at) > 0);
      if (!rows.length) return { bucketMs: bucketMs, metric: m, buckets: [] };

      let min = Infinity, max = -Infinity;
      for (const r of rows) { const t = num(r.at); if (t < min) min = t; if (t > max) max = t; }
      const start = Math.floor(min / bucketMs) * bucketMs;
      const n = Math.floor((max - start) / bucketMs) + 1;
      const buckets = [];
      for (let i = 0; i < n; i++) buckets.push({ from: start + i * bucketMs, to: start + (i + 1) * bucketMs, value: null, readings: 0, lastAt: null });

      rows.sort((a, b2) => (num(a.at) - num(b2.at)) || (a.seq || 0) - (b2.seq || 0));
      for (const r of rows) {
        const idx = Math.floor((num(r.at) - start) / bucketMs);
        if (idx < 0 || idx >= n) continue;
        buckets[idx].value = r.value;              // last write wins, because rows are in time order
        buckets[idx].readings++;
        buckets[idx].lastAt = num(r.at);
      }
      return { bucketMs: bucketMs, metric: m, unit: (byId(m) || {}).unit || '', buckets: buckets };
    }

    // ---- writes ------------------------------------------------------------------------------------
    function record(businessId, meta) {
      meta = meta || {};
      const b = biz(businessId);
      if (!b) return { ok: false, reason: 'a businessId is required (isolation is by key — never implied)' };

      const metric = String(meta.metric == null ? '' : meta.metric);
      const def = byId(metric);
      if (!def) {
        return { ok: false, reason: 'unknown metric: ' + (metric || '(none)') + ' — §11\'s set is closed: ' + METRIC_IDS.join(', ') };
      }

      const value = Number(meta.value);
      if (!isFinite(value) || value < 0) return { ok: false, reason: 'a reading must be a number zero or more' };
      if (def.unit === 'rate' && value > 1) {
        return { ok: false, reason: '"' + metric + '" is a rate and must be a FRACTION between 0 and 1 (0.032, not 3.2 or "3.2%") — a rate above 1 is a data-entry error, not 300%' };
      }

      // P1: a reading with no stated origin cannot be told apart from an invented one.
      const source = str(meta.source, MAX_TEXT).trim();
      if (!source) return { ok: false, reason: 'a reading needs a source (P1) — where the number came from' };

      const evidence = String(meta.evidence == null ? '' : meta.evidence);
      if (EVIDENCE.indexOf(evidence) < 0) {
        return { ok: false, reason: 'a reading needs an evidence class, one of: ' + EVIDENCE.join(', ') };
      }

      let at = meta.at;
      if (at == null || at === '') at = now();
      at = Number(at);
      if (!isFinite(at) || at <= 0) return { ok: false, reason: 'at must be an epoch-ms number' };

      const seq = nextSeq(b);
      const row = {
        id: b + '~k' + seq, seq: seq, businessId: b,
        metric: metric, value: round(value), unit: def.unit,
        source: source, evidence: evidence, note: str(meta.note, MAX_TEXT),
        at: at
      };

      let next = records.slice(); next.push(row);
      const mine = next.filter(r => r && r.businessId === b);
      if (mine.length > limit) {
        const keep = new Set(mine.slice(mine.length - limit).map(r => r.id));
        next = next.filter(r => r.businessId !== b || keep.has(r.id));
      }
      const w = commit(next);
      if (!w.ok) return w;
      return { ok: true, reading: rowView(row) };
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
      METRICS, METRIC_IDS, UNITS, EVIDENCE, LIMIT: limit,
      list, get, has, count, latest, summary, series,
      record, remove, clear
    };
  }

  return { makeBusinessMetrics, METRICS, METRIC_IDS, UNITS, byId, DEFAULT_LIMIT };
});
