'use strict';
/* test/business-finance.test.js — the §10 FINANCE CENTER (Business OS Phase 4).

   THE load-bearing property, and the reason this store exists rather than reusing ledger.js/insights.js (both
   of which track AI-RUN cost, not business money): a business's REAL money is never added to the AI's GUESS.
   `recorded` is fed ONLY by actual + user-entered + imported rows; `estimated` ONLY by ai-estimate rows. A
   single blended total is the exact fabrication P2 forbids, and the most convincing one a finance screen can
   produce — so there is no `total` key anywhere, and no cross-currency grand total either.

   Also locked here: an ai-estimate must state a basis; an imported row must name its source; a budget's
   `spent` counts RECORDED expenses only and reports how many estimates it held out. */
const A = require('./_assert.js');
const F = require('../sidecar/business-finance.js');

function store(extra) {
  const saved = [];
  const s = F.makeBusinessFinance(Object.assign({
    records: [], budgets: {}, prices: {},
    persist: (snap) => { saved.length = 0; saved.push(snap); },
    now: () => 1000
  }, extra || {}));
  return { s, saved };
}
const rev = (amount, provenance, extra) => Object.assign({ kind: 'revenue', amount: amount, currency: 'USD', category: 'sales', provenance: provenance }, extra || {});
const exp = (amount, provenance, extra) => Object.assign({ kind: 'expense', amount: amount, currency: 'USD', category: 'advertising', provenance: provenance }, extra || {});

/* ---------- the vocabularies ---------- */
{
  A.eq(F.KINDS, ['revenue', 'expense'], 'two kinds — the KIND carries the direction, never a negative amount');
  A.eq(F.PROVENANCE, ['actual', 'user-entered', 'imported', 'ai-estimate'], 'the four §10 provenance classes');
  A.eq(F.ESTIMATE, 'ai-estimate', 'the estimate class is named once');
  A.eq(F.RECORDED_PROVENANCE, ['actual', 'user-entered', 'imported'], 'RECORDED = everything that is NOT an estimate');
  A.ok(F.REVENUE_CATEGORIES.indexOf('sales') >= 0, 'revenue categories include sales');
  A.ok(F.EXPENSE_CATEGORIES.indexOf('advertising') >= 0, 'expense categories include advertising');
}

/* ---------- create validation ---------- */
{
  const { s } = store();
  A.eq(s.create('', rev(10, 'actual')).ok, false, 'no businessId -> refused');
  A.eq(s.create('acme', rev(0, 'actual')).ok, false, 'amount 0 -> refused');
  A.eq(s.create('acme', rev(-5, 'actual')).ok, false, 'a negative amount is refused (the kind carries direction)');
  A.eq(s.create('acme', rev(10, 'actual', { currency: 'US' })).ok, false, 'a 2-letter currency is refused');
  A.eq(s.create('acme', rev(10, 'actual', { category: 'nope' })).ok, false, 'an unknown category is refused');
  A.eq(s.create('acme', exp(10, 'actual', { category: 'sales' })).ok, false, 'a revenue category is refused for an expense');
  A.eq(s.create('acme', rev(10, '')).ok, false, 'no provenance -> refused (P2)');
  A.ok(/invented one/.test(s.create('acme', rev(10, '')).reason), 'and the refusal says why provenance matters');
  A.eq(s.create('acme', rev(10, 'ai-estimate')).ok, false, 'an ai-estimate with no basis is refused');
  A.eq(s.create('acme', rev(10, 'imported')).ok, false, 'an imported row with no source is refused');
  A.eq(s.create('acme', rev(10, 'imported', { source: 'stripe.csv' })).ok, true, 'an imported row WITH a source is accepted');

  const c = s.create('acme', rev(10, 'actual'));
  A.ok(/^acme~f\d+$/.test(c.transaction.id), 'the id is <businessId>~f<seq>');
  A.ok(c.transaction.id.indexOf('#') < 0, 'and never contains a # (it travels in a URL path)');
  A.eq(c.transaction.currency, 'USD', 'the currency is normalised');
  A.eq(c.transaction.basis, '', 'basis is present as an empty string, not undefined');
}

/* ================= THE HEADLINE: recorded never absorbs an estimate ================= */
{
  const { s } = store();
  s.create('acme', rev(100, 'actual'));                              // real
  s.create('acme', exp(30, 'user-entered'));                         // real
  s.create('acme', rev(70, 'imported', { source: 'x.csv' }));        // real
  s.create('acme', rev(999, 'ai-estimate', { basis: 'growth extrapolation' }));   // the guess

  const t = s.totals('acme').byCurrency.USD;
  A.eq(t.recorded.revenue, 170, 'recorded revenue = 100 + 70 — the 999 estimate is NOT in it');
  A.eq(t.recorded.expense, 30, 'recorded expense = 30');
  A.eq(t.recorded.profit, 140, 'recorded profit = 170 - 30');
  A.eq(t.recorded.count, 3, 'three recorded rows');
  A.eq(t.estimated.revenue, 999, 'the estimate is carried in its OWN field');
  A.eq(t.estimated.count, 1, 'one estimate');
  A.eq(t.byProvenance['ai-estimate'].revenue, 999, 'and it is visible per provenance class too');
  A.ok(!('total' in t), 'there is NO blended `total` key — the two can never be added together');

  const j = JSON.stringify(t);
  A.ok(j.indexOf('1169') < 0, 'the blended sum (170 + 999) appears NOWHERE in the shape');
}

/* ---------- an unknown provenance class contributes to nothing ---------- */
{
  const { s } = store();
  s.create('acme', rev(50, 'actual'));
  // hand-inject a row with a class the store does not know (a hand-edited file)
  const s2 = F.makeBusinessFinance({ records: [{ id: 'acme~f9', seq: 9, businessId: 'acme', kind: 'revenue', amount: 500, currency: 'USD', category: 'sales', provenance: 'wishful', at: 1 }], persist: null, now: () => 1000 });
  const t2 = s2.totals('acme').byCurrency.USD;
  A.eq(t2.recorded.revenue, 0, 'a row with an unknown class feeds recorded nothing');
  A.eq(t2.estimated.revenue, 0, 'and feeds estimated nothing');
}

/* ---------- no cross-currency grand total ---------- */
{
  const { s } = store();
  s.create('acme', rev(100, 'actual', { currency: 'USD' }));
  s.create('acme', rev(500, 'actual', { currency: 'CNY' }));
  const t = s.totals('acme');
  A.eq(t.currencies, ['CNY', 'USD'], 'each currency is its own bucket, sorted');
  A.eq(t.byCurrency.USD.recorded.revenue, 100, 'USD keeps its own figure');
  A.eq(t.byCurrency.CNY.recorded.revenue, 500, 'CNY keeps its own');
  A.ok(!t.grandTotal && !t.total, 'there is no grand total across currencies — 100 USD + 500 CNY is not a number');
}

/* ---------- series: only recorded rows feed money; estimates ride their own field ---------- */
{
  const { s } = store();
  s.create('acme', rev(10, 'actual', { at: 1000 }));
  s.create('acme', rev(20, 'actual', { at: 2000 }));
  s.create('acme', rev(999, 'ai-estimate', { basis: 'x', at: 2000 }));
  const ser = s.series('acme', { bucketMs: 1000, currency: 'USD' });
  A.eq(ser.buckets.length, 2, 'two buckets');
  A.eq(ser.buckets[0].revenue, 10, 'bucket 0 carries the real 10');
  A.eq(ser.buckets[1].revenue, 20, 'bucket 1 carries the real 20 — the estimate is not merged in');
  A.eq(ser.buckets[1].estimated, 999, 'and the estimate is carried separately');
  A.eq(ser.buckets[1].count, 1, 'count counts recorded rows only');
}

/* ---------- budgets: spent counts RECORDED expenses only ---------- */
{
  const { s } = store();
  s.create('acme', exp(40, 'actual', { category: 'advertising' }));
  s.create('acme', exp(10, 'user-entered', { category: 'advertising' }));
  s.create('acme', exp(500, 'ai-estimate', { basis: 'x', category: 'advertising' }));   // must NOT count
  A.eq(s.setBudget('acme', { category: 'advertising', amount: 100, currency: 'USD' }).ok, true, 'a budget is set');
  A.eq(s.setBudget('acme', { category: 'nope', amount: 100, currency: 'USD' }).ok, false, 'an unknown budget category is refused');
  A.eq(s.setBudget('acme', { category: '*', amount: 100, currency: 'USD' }).ok, true, '"*" is allowed for the whole business');

  const st = s.budgetStatus('acme', { currency: 'USD' });
  const ad = st.categories.filter(c => c.category === 'advertising')[0];
  A.eq(ad.spent, 50, 'spent = 40 + 10 — the 500 estimate is held OUT');
  A.eq(ad.over, false, '50 <= 100 is not over');
  A.eq(st.excludedEstimates, 1, 'and the store reports the one estimate it held out');
  A.ok(!/health|score/.test(JSON.stringify(st)), 'there is no budget "health" score');
}

/* ---------- budgets: setting the same key REPLACES, and '*' totals every expense ---------- */
{
  const { s } = store();
  s.create('acme', exp(40, 'actual', { category: 'advertising' }));
  s.create('acme', exp(60, 'actual', { category: 'software' }));
  s.setBudget('acme', { category: 'advertising', amount: 100, currency: 'USD' });
  s.setBudget('acme', { category: 'advertising', amount: 30, currency: 'USD' });
  A.eq(s.budgets('acme').length, 1, 'setting the same key twice leaves ONE budget, not two');
  A.eq(s.budgets('acme')[0].amount, 30, 'and it holds the second amount');
  s.setBudget('acme', { category: '*', amount: 50, currency: 'USD' });
  const star = s.budgetStatus('acme', { currency: 'USD' }).categories.filter(c => c.category === '*')[0];
  A.eq(star.spent, 100, '"*" sums every recorded expense (40 + 60)');
  A.eq(star.over, true, '100 > 50 is over');
}

/* ---------- prices: keyed by business|sku|currency, replaced flag ---------- */
{
  const { s } = store();
  A.eq(s.setPrice('acme', { sku: '', amount: 5, currency: 'USD' }).ok, false, 'a price needs a sku');
  A.eq(s.setPrice('acme', { sku: 'A', amount: -1, currency: 'USD' }).ok, false, 'a negative price is refused');
  const p1 = s.setPrice('acme', { sku: 'A', amount: 10, currency: 'USD' });
  A.eq(p1.replaced, false, 'the first set is not a replace');
  const p2 = s.setPrice('acme', { sku: 'A', amount: 12, currency: 'USD' });
  A.eq(p2.replaced, true, 'setting the same sku+currency again IS a replace');
  A.eq(s.prices('acme').length, 1, 'and leaves one price row');
  A.eq(s.prices('acme')[0].amount, 12, 'holding the new amount');
}

/* ---------- persist: ONE snapshot covering all three families ---------- */
{
  const { s, saved } = store();
  s.create('acme', rev(10, 'actual'));
  A.eq(saved.length, 1, 'one snapshot was persisted');
  A.ok(saved[0] && saved[0].transactions && saved[0].budgets && saved[0].prices, 'the snapshot carries transactions, budgets AND prices together');
}

/* ---------- P6 + clear ---------- */
{
  const { s } = store();
  s.create('acme', rev(10, 'actual'));
  s.create('beta', rev(20, 'actual'));
  A.eq(s.count('acme'), 1, 'count is per business');
  A.eq(s.totals('beta').byCurrency.USD.recorded.revenue, 20, 'totals are per business');
  A.eq(s.clear('').ok, false, 'clear with no businessId is refused');
  s.clear('acme');
  A.eq(s.count('acme'), 0, 'acme is cleared');
  A.eq(s.count('beta'), 1, 'beta is untouched');
}

/* ---------- persist-before-commit ---------- */
{
  let boom = false;
  const s = F.makeBusinessFinance({
    records: [], budgets: {}, prices: {},
    persist: () => { if (boom) throw new Error('denied'); },
    now: () => 1000
  });
  s.create('acme', rev(10, 'actual'));
  boom = true;
  const denied = s.create('acme', rev(20, 'actual'));
  A.eq(denied.ok, false, 'a create whose persist throws returns ok:false');
  A.eq(s.count('acme'), 1, 'memory is unchanged');
}

A.report('business-finance');
