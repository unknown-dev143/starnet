/* sidecar/business-finance.js — the §10 FINANCE CENTER (Business OS Phase 4).

   §10's rule, verbatim: "Do not fabricate financial data (P2). Keep these strictly separated: actual
   financial data · user-entered data · imported data · AI estimates."

   THAT SENTENCE IS THE ENTIRE DESIGN. A finance store is the easiest place in this whole application to
   manufacture a number that looks authoritative and is not, so the separation is not a display convention
   here — it is STRUCTURAL, in two places:

     1. Every transaction carries a `provenance` from a closed set of four. There is no default. A row whose
        provenance nobody stated is REFUSED, because an unlabelled number is indistinguishable from an
        invented one.

     2. `totals()` CANNOT return a single number that mixes them. It returns per-currency buckets, and inside
        each currency it returns `recorded` (actual + user-entered + imported) and `estimated` (ai-estimate)
        as SEPARATE objects. The exclusion is by construction, not by a filter someone has to remember: the
        recorded bucket is summed by explicitly skipping the estimate class, so an AI guess can never move
        the figure a user reads as real money. A test asserts exactly that.

   TWO MORE PROVENANCE RULES, both P1/P2:
     · An 'ai-estimate' must state its `basis` — the reasoning behind the guess. An estimate with no stated
       basis is a fabrication wearing a label.
     · An 'imported' row must state its `source` — which file or system it came from. "Imported" without a
       source cannot be audited back to anything.

   CURRENCIES ARE NEVER SUMMED TOGETHER. The result shape is `byCurrency`, so there is deliberately no
   cross-currency grand total to accidentally read. Adding ¥ to $ is not a total; it is a wrong number.

   THREE ROW FAMILIES, ONE FILE. Transactions, budgets and prices all belong to §10 and are always read
   together in one Finance Center pane, so they share a store and a file rather than tripling the
   load/persist boilerplate. They are NOT one array: transactions are an append-only ledger (capped), while a
   budget and a price are per-key CONFIGURATION where setting one twice REPLACES rather than doubles. That
   difference is why `persist` here takes a SNAPSHOT OBJECT ({ transactions, budgets, prices }) instead of a
   bare row array — the one deviation from the house store shape, and it is deliberate.

   IT IS NOT ledger.js. That module is the AI RUN cost ledger — runId, agentId, tokens, usd — the station's
   own spend on models (with budget.js / cost.js / spend.js / billing.js around it). This module is a
   BUSINESS's money: its revenue and its expenses. Different subject, different owner, different lifetime.
   Conflating them would put a business's revenue into the station's spend governor (P4).

   CASH FLOW IS DELIBERATELY NOT FAKED. §10 lists it, and a real cash-flow statement needs payment dates
   against invoice dates. This store holds settled transactions, so it exposes revenue, expense and profit
   and says nothing about cash timing rather than inventing a figure.

   PURE: no IO, no clock, no env, no rng. `persist` and `now` injected; `at` is an epoch-ms number so
   bucketing in series() is pure arithmetic (parsing a date string would need a clock read, which
   lint-determinism bans in sidecar/). UMD. Mirrors business-tasks-store.js. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).businessFinance = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const KINDS = ['revenue', 'expense'];

  // §10's four classes, in §10's order. Closed: see rule 1 in the header.
  const PROVENANCE = ['actual', 'user-entered', 'imported', 'ai-estimate'];

  // The one class that must NEVER enter a recorded total. Named once so no call site can disagree.
  const ESTIMATE = 'ai-estimate';
  const RECORDED_PROVENANCE = PROVENANCE.filter(p => p !== ESTIMATE);

  // §10's named cost/revenue lines, split by the direction they move money.
  const REVENUE_CATEGORIES = ['sales', 'subscription', 'services', 'licensing', 'affiliate', 'other'];
  const EXPENSE_CATEGORIES = ['infrastructure', 'advertising', 'ai-api', 'acquisition', 'software', 'contractors', 'other'];

  const RX_CURRENCY = /^[A-Z]{3}$/;
  const MAX_TEXT = 2000;
  const MAX_ID = 120;
  const DEFAULT_LIMIT = 5000;                // per business

  // Round to 6dp — the same helper shape as insights.js, so a float sum of cents does not print 0.30000000004.
  function round(n) { return Math.round(n * 1e6) / 1e6; }
  function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }

  function makeBusinessFinance(opts) {
    opts = opts || {};
    const records = Array.isArray(opts.records) ? opts.records : [];
    // Budgets and prices are keyed maps (business|category|currency / business|sku|currency), so setting a
    // key twice replaces. Defensively rebuilt as plain objects: a hand-edited file must not throw on READ.
    let budgetsMap = (opts.budgets && typeof opts.budgets === 'object' && !Array.isArray(opts.budgets)) ? opts.budgets : {};
    let pricesMap = (opts.prices && typeof opts.prices === 'object' && !Array.isArray(opts.prices)) ? opts.prices : {};
    const persist = typeof opts.persist === 'function' ? opts.persist : null;
    const now = typeof opts.now === 'function' ? opts.now : (() => null);
    const limit = (Number.isFinite(opts.limit) && opts.limit > 0) ? Math.floor(opts.limit) : DEFAULT_LIMIT;

    const str = (v, cap) => (v == null ? '' : String(v)).slice(0, cap);
    const indexOf = (id) => records.findIndex(r => r && r.id === id);
    const forBiz = (businessId) => records.filter(r => r && r.businessId === businessId);
    const biz = (v) => str(v, MAX_ID).trim();
    const catsFor = (kind) => (kind === 'revenue' ? REVENUE_CATEGORIES : EXPENSE_CATEGORIES);

    function nextSeq(businessId) {
      let max = 0;
      for (const r of records) if (r && r.businessId === businessId && r.seq > max) max = r.seq;
      return max + 1;
    }

    const rowView = (r) => ({
      id: r.id, seq: r.seq, businessId: r.businessId,
      kind: r.kind, amount: r.amount, currency: r.currency, category: r.category,
      note: r.note || '', provenance: r.provenance,
      // both are always present as strings so a reader never has to test for undefined; only the provenance
      // that requires one will ever carry content.
      basis: r.basis || '', source: r.source || '',
      at: r.at != null ? r.at : null,
      createdAt: r.createdAt != null ? r.createdAt : null
    });

    // Persist-before-commit across ALL THREE families at once: a snapshot that throws leaves memory exactly
    // as it was, so a budget can never be visible without its transaction ledger also being durable.
    function commit(nextTx, nextBudgets, nextPrices) {
      const b = nextBudgets || budgetsMap;
      const p = nextPrices || pricesMap;
      if (persist) {
        try { persist({ transactions: nextTx.map(rowView), budgets: b, prices: p }); }
        catch (e) { return { ok: false, reason: 'could not persist — denied' }; }
      }
      records.length = 0;
      for (const r of nextTx) records.push(r);
      budgetsMap = b;
      pricesMap = p;
      return { ok: true };
    }

    // ---- validation, shared by create() and by any future import path ---------------------------------
    function validate(meta) {
      const kind = String(meta.kind == null ? '' : meta.kind);
      if (KINDS.indexOf(kind) < 0) return { ok: false, reason: 'unknown kind: ' + (kind || '(none)') + ' — one of: ' + KINDS.join(', ') };

      const amount = Number(meta.amount);
      if (!isFinite(amount) || amount <= 0) {
        return { ok: false, reason: 'amount must be a positive number — the KIND carries the direction, so a refund is recorded as its own row rather than a negative amount' };
      }

      const currency = String(meta.currency == null ? '' : meta.currency).trim().toUpperCase();
      if (!RX_CURRENCY.test(currency)) return { ok: false, reason: 'currency must be a 3-letter code (e.g. USD, CNY)' };

      const category = String(meta.category == null ? '' : meta.category).trim();
      if (catsFor(kind).indexOf(category) < 0) {
        return { ok: false, reason: 'unknown ' + kind + ' category: ' + (category || '(none)') + ' — one of: ' + catsFor(kind).join(', ') };
      }

      const provenance = String(meta.provenance == null ? '' : meta.provenance);
      if (PROVENANCE.indexOf(provenance) < 0) {
        return {
          ok: false,
          reason: 'a transaction needs a provenance (P2) — one of: ' + PROVENANCE.join(', ') +
            '. An unlabelled figure cannot be told apart from an invented one.'
        };
      }

      const basis = str(meta.basis, MAX_TEXT).trim();
      if (provenance === ESTIMATE && !basis) {
        return { ok: false, reason: 'an ai-estimate must state its basis — the reasoning behind the guess (P2)' };
      }
      const source = str(meta.source, MAX_TEXT).trim();
      if (provenance === 'imported' && !source) {
        return { ok: false, reason: 'an imported transaction must name its source — which file or system it came from (P1)' };
      }

      let at = meta.at;
      if (at == null || at === '') at = now();
      at = Number(at);
      if (!isFinite(at) || at <= 0) return { ok: false, reason: 'at must be an epoch-ms number' };

      return { ok: true, kind: kind, amount: round(amount), currency: currency, category: category, provenance: provenance, basis: basis, source: source, at: at };
    }

    // ---- reads -------------------------------------------------------------------------------------
    function list(businessId, o) {
      const b = biz(businessId);
      if (!b) return [];
      o = o || {};
      let rows = forBiz(b);
      if (o.kind) rows = rows.filter(r => r.kind === o.kind);
      if (o.category) rows = rows.filter(r => r.category === o.category);
      if (o.provenance) rows = rows.filter(r => r.provenance === o.provenance);
      if (o.currency) rows = rows.filter(r => r.currency === String(o.currency).toUpperCase());
      if (Number.isFinite(o.since)) rows = rows.filter(r => num(r.at) >= o.since);
      if (Number.isFinite(o.until)) rows = rows.filter(r => num(r.at) <= o.until);
      return rows.slice().sort((a, b2) => (num(a.at) - num(b2.at)) || (a.seq || 0) - (b2.seq || 0)).map(rowView);
    }
    function get(id) { const i = indexOf(id); return i < 0 ? null : rowView(records[i]); }
    function has(id) { return indexOf(id) >= 0; }
    function count(businessId) { const b = biz(businessId); return b ? forBiz(b).length : 0; }

    // currencies actually present — so the UI offers the real set instead of guessing one.
    function currencies(businessId) {
      const seen = {};
      for (const r of forBiz(biz(businessId))) if (r && RX_CURRENCY.test(String(r.currency || ''))) seen[r.currency] = 1;
      return Object.keys(seen).sort();
    }

    // One currency's ledger, split by provenance, with `recorded` computed by EXCLUDING the estimate class.
    function bucketFor(rows, currency) {
      const byProvenance = {};
      for (const p of PROVENANCE) byProvenance[p] = { revenue: 0, expense: 0, profit: 0, count: 0 };
      const recorded = { revenue: 0, expense: 0, profit: 0, count: 0 };
      const estimated = { revenue: 0, expense: 0, profit: 0, count: 0 };

      for (const r of rows) {
        if (r.currency !== currency) continue;
        const p = byProvenance[r.provenance];
        if (!p) continue;                                   // an unknown class contributes to NOTHING
        const a = num(r.amount);
        p[r.kind] += a; p.count++;
        // The load-bearing line. 'recorded' is fed ONLY by the three non-estimate classes; 'estimated' ONLY
        // by the estimate class. Neither can leak into the other because neither reads the other's rows.
        if (r.provenance === ESTIMATE) { estimated[r.kind] += a; estimated.count++; }
        else { recorded[r.kind] += a; recorded.count++; }
      }
      for (const k of Object.keys(byProvenance)) {
        byProvenance[k].revenue = round(byProvenance[k].revenue);
        byProvenance[k].expense = round(byProvenance[k].expense);
        byProvenance[k].profit = round(byProvenance[k].revenue - byProvenance[k].expense);
      }
      recorded.revenue = round(recorded.revenue); recorded.expense = round(recorded.expense);
      recorded.profit = round(recorded.revenue - recorded.expense);
      estimated.revenue = round(estimated.revenue); estimated.expense = round(estimated.expense);
      estimated.profit = round(estimated.revenue - estimated.expense);
      return { currency: currency, byProvenance: byProvenance, recorded: recorded, estimated: estimated };
    }

    /* TOTALS. Per currency, always — there is no cross-currency grand total by construction (see header).
       `recorded` is real money; `estimated` is what the AI guessed; the two are never added together. */
    function totals(businessId, o) {
      o = o || {};
      const b = biz(businessId);
      if (!b) return { byCurrency: {}, currencies: [] };
      const rows = forBiz(b);
      let curs = currencies(b);
      if (o.currency) curs = curs.filter(c => c === String(o.currency).toUpperCase());
      const byCurrency = {};
      for (const c of curs) byCurrency[c] = bucketFor(rows, c);
      return { byCurrency: byCurrency, currencies: curs };
    }

    /* SERIES — the §10 "charts and historical trends". Pure arithmetic on the stored epoch-ms `at`, so it
       needs no clock: the caller names the bucket width. Only RECORDED rows feed the money series; estimates
       are carried in their own field per bucket, never merged into it. */
    function series(businessId, o) {
      o = o || {};
      const b = biz(businessId);
      const bucketMs = (Number.isFinite(o.bucketMs) && o.bucketMs > 0) ? Math.floor(o.bucketMs) : 86400000;
      if (!b) return { bucketMs: bucketMs, buckets: [] };
      const currency = String(o.currency || (currencies(b)[0] || 'USD')).toUpperCase();
      const rows = forBiz(b).filter(r => r && r.currency === currency && Number.isFinite(num(r.at)) && num(r.at) > 0);
      if (!rows.length) return { bucketMs: bucketMs, currency: currency, buckets: [] };

      let min = Infinity, max = -Infinity;
      for (const r of rows) { const t = num(r.at); if (t < min) min = t; if (t > max) max = t; }
      const start = Math.floor(min / bucketMs) * bucketMs;
      const n = Math.floor((max - start) / bucketMs) + 1;

      const buckets = [];
      for (let i = 0; i < n; i++) {
        buckets.push({ from: start + i * bucketMs, to: start + (i + 1) * bucketMs, revenue: 0, expense: 0, profit: 0, count: 0, estimated: 0 });
      }
      for (const r of rows) {
        const idx = Math.floor((num(r.at) - start) / bucketMs);
        if (idx < 0 || idx >= n) continue;
        const bk = buckets[idx];
        const a = num(r.amount);
        if (r.provenance === ESTIMATE) { bk.estimated = round(bk.estimated + a); continue; }
        bk[r.kind] = round(bk[r.kind] + a);
        bk.count++;
      }
      for (const bk of buckets) bk.profit = round(bk.revenue - bk.expense);
      return { bucketMs: bucketMs, currency: currency, buckets: buckets };
    }

    // ---- writes ------------------------------------------------------------------------------------
    function create(businessId, meta) {
      meta = meta || {};
      const b = biz(businessId);
      if (!b) return { ok: false, reason: 'a businessId is required (isolation is by key — never implied)' };
      const v = validate(meta);
      if (!v.ok) return v;

      const seq = nextSeq(b);
      const row = {
        id: b + '~f' + seq, seq: seq, businessId: b,
        kind: v.kind, amount: v.amount, currency: v.currency, category: v.category,
        note: str(meta.note, MAX_TEXT), provenance: v.provenance, basis: v.basis, source: v.source,
        at: v.at, createdAt: now()
      };

      let next = records.slice(); next.push(row);
      const mine = next.filter(r => r && r.businessId === b);
      if (mine.length > limit) {
        const keep = new Set(mine.slice(mine.length - limit).map(r => r.id));
        next = next.filter(r => r.businessId !== b || keep.has(r.id));
      }
      const w = commit(next);
      if (!w.ok) return w;
      return { ok: true, transaction: rowView(row) };
    }

    function remove(id) {
      const i = indexOf(id);
      if (i < 0) return { ok: true, removed: 0 };
      const next = records.slice(); next.splice(i, 1);
      const w = commit(next);
      if (!w.ok) return w;
      return { ok: true, removed: 1 };
    }

    // ---- budgets (§10 "budgets") ---------------------------------------------------------------------
    // A budget is a per-category ceiling for one business in one currency, keyed so setting one twice
    // REPLACES rather than doubles. '*' means the whole business.
    function setBudget(businessId, meta) {
      meta = meta || {};
      const b = biz(businessId);
      if (!b) return { ok: false, reason: 'a businessId is required' };
      const category = String(meta.category == null ? '' : meta.category).trim();
      if (EXPENSE_CATEGORIES.indexOf(category) < 0 && category !== '*') {
        return { ok: false, reason: 'a budget category must be one of the expense categories, or "*" for the whole business: ' + EXPENSE_CATEGORIES.join(', ') };
      }
      const currency = String(meta.currency == null ? '' : meta.currency).trim().toUpperCase();
      if (!RX_CURRENCY.test(currency)) return { ok: false, reason: 'currency must be a 3-letter code (e.g. USD, CNY)' };
      const amount = Number(meta.amount);
      if (!isFinite(amount) || amount < 0) return { ok: false, reason: 'a budget amount must be zero or more' };

      const key = b + '|' + category + '|' + currency;
      const replaced = !!budgetsMap[key];
      const nextBudgets = Object.assign({}, budgetsMap);
      nextBudgets[key] = { businessId: b, category: category, currency: currency, amount: round(amount), at: now() };

      const w = commit(records.slice(), nextBudgets, pricesMap);
      if (!w.ok) return w;
      return { ok: true, budget: Object.assign({}, nextBudgets[key]), replaced: replaced };
    }

    function budgets(businessId) {
      const b = biz(businessId);
      if (!b) return [];
      const out = [];
      for (const k of Object.keys(budgetsMap)) if (budgetsMap[k] && budgetsMap[k].businessId === b) out.push(Object.assign({}, budgetsMap[k]));
      return out.sort((a, b2) => a.currency.localeCompare(b2.currency) || a.category.localeCompare(b2.category));
    }

    /* BUDGET vs ACTUAL. Spent is RECORDED expenses only — an AI estimate never counts against a budget, for
       the same reason it never enters a recorded total. `over` is the fact of exceeding; there is no
       "budget health" score, because §10 asks for the comparison and P7 forbids inventing a verdict. */
    function budgetStatus(businessId, o) {
      o = o || {};
      const b = biz(businessId);
      const currency = String(o.currency || (currencies(b)[0] || 'USD')).toUpperCase();
      const rows = forBiz(b).filter(r => r && r.currency === currency && r.kind === 'expense' && r.provenance !== ESTIMATE);
      const spentBy = {};
      for (const r of rows) spentBy[r.category] = round(num(spentBy[r.category]) + num(r.amount));

      const out = {
        currency: currency,
        categories: [],
        // stated explicitly so the UI can say "N AI estimates were held out of this comparison" rather than
        // letting the reader wonder why the numbers do not match a total that included them.
        excludedEstimates: forBiz(b).filter(r => r.currency === currency && r.kind === 'expense' && r.provenance === ESTIMATE).length
      };
      for (const bd of budgets(b)) {
        if (bd.currency !== currency) continue;
        const spent = bd.category === '*'
          ? round(Object.keys(spentBy).reduce((t, k) => t + num(spentBy[k]), 0))
          : num(spentBy[bd.category]);
        out.categories.push({
          category: bd.category, budget: bd.amount, spent: spent,
          remaining: round(bd.amount - spent),
          over: spent > bd.amount
        });
      }
      return out;
    }

    // ---- pricing (§10 "pricing") --------------------------------------------------------------------
    function setPrice(businessId, meta) {
      meta = meta || {};
      const b = biz(businessId);
      if (!b) return { ok: false, reason: 'a businessId is required' };
      const sku = str(meta.sku, 120).trim();
      if (!sku) return { ok: false, reason: 'a price needs a sku (what is being priced)' };
      const amount = Number(meta.amount);
      if (!isFinite(amount) || amount < 0) return { ok: false, reason: 'a price must be zero or more' };
      const currency = String(meta.currency == null ? '' : meta.currency).trim().toUpperCase();
      if (!RX_CURRENCY.test(currency)) return { ok: false, reason: 'currency must be a 3-letter code (e.g. USD, CNY)' };

      const key = b + '|' + sku + '|' + currency;
      const replaced = !!pricesMap[key];
      const nextPrices = Object.assign({}, pricesMap);
      nextPrices[key] = { businessId: b, sku: sku, currency: currency, amount: round(amount), note: str(meta.note, MAX_TEXT), at: now() };

      const w = commit(records.slice(), budgetsMap, nextPrices);
      if (!w.ok) return w;
      return { ok: true, price: Object.assign({}, nextPrices[key]), replaced: replaced };
    }

    function prices(businessId) {
      const b = biz(businessId);
      if (!b) return [];
      const out = [];
      for (const k of Object.keys(pricesMap)) if (pricesMap[k] && pricesMap[k].businessId === b) out.push(Object.assign({}, pricesMap[k]));
      return out.sort((a, b2) => a.sku.localeCompare(b2.sku) || a.currency.localeCompare(b2.currency));
    }

    // CLEAR one business's whole finance picture. Never another's.
    function clear(businessId) {
      const b = biz(businessId);
      if (!b) return { ok: false, reason: 'a businessId is required' };
      const nextTx = records.filter(r => !(r && r.businessId === b));
      const nextBudgets = Object.assign({}, budgetsMap);
      for (const k of Object.keys(nextBudgets)) if (nextBudgets[k] && nextBudgets[k].businessId === b) delete nextBudgets[k];
      const nextPrices = Object.assign({}, pricesMap);
      for (const k of Object.keys(nextPrices)) if (nextPrices[k] && nextPrices[k].businessId === b) delete nextPrices[k];
      const w = commit(nextTx, nextBudgets, nextPrices);
      if (!w.ok) return w;
      return { ok: true };
    }

    return {
      KINDS, PROVENANCE, ESTIMATE, RECORDED_PROVENANCE, REVENUE_CATEGORIES, EXPENSE_CATEGORIES, LIMIT: limit,
      list, get, has, count, currencies, totals, series,
      create, remove,
      setBudget, budgets, budgetStatus,
      setPrice, prices,
      clear
    };
  }

  return {
    makeBusinessFinance, KINDS, PROVENANCE, ESTIMATE, RECORDED_PROVENANCE,
    REVENUE_CATEGORIES, EXPENSE_CATEGORIES, DEFAULT_LIMIT, round
  };
});
