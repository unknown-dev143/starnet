'use strict';
/* business-remote.test.js — §25's REMOTE MONITORING read model (Business OS).

   This is a READ MODEL, so the risk is not a crash — it is a snapshot that LIES. Every assertion here is
   about the composed view staying truthful:

     • a section that could not be read is `ok:false` with a REASON, never an empty list
     • a count is `null` when unreadable, and a real `0` only when the source was actually read
     • no fabricated score / health / grade / percentage anywhere
     • the section order is the brief's priority (monitoring + approvals first)
     • the composer OWNS NO STORE and WRITES NOTHING — a throwing source cannot mutate anything           */

const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const remote = require('../sidecar/business-remote.js');
const { makeRemoteReadModel, SECTIONS } = remote;

const NOW = 1000000000000;

/* a set of fake stores in the exact shapes the real ones expose (read off the real modules) */
function mkDeps(over) {
  const base = {
    now: () => NOW,
    businesses: {
      list: () => [
        { id: 'acme', name: 'Acme', stage: 'live', template: 'saas', currency: 'USD', updatedAt: NOW - 100 },
        { id: 'beta', name: 'Beta', stage: 'idea', template: 'content', currency: 'USD', updatedAt: NOW - 900 }
      ],
      get: (id) => (id === 'acme' ? { id: 'acme', name: 'Acme', stage: 'live', template: 'saas', currency: 'USD', updatedAt: NOW - 100 } : null)
    },
    approvals: {
      OPEN_STATUS: 'pending',
      pendingCount: (id) => (id === 'acme' ? 2 : 0),
      list: (id, o) => (id === 'acme'
        ? [{ id: 'acme~a1', businessId: 'acme', tier: 'review', action: 'send the launch email', at: NOW - 50, status: 'pending' }]
        : []),
      summary: (id) => ({ total: id === 'acme' ? 1 : 0, pending: id === 'acme' ? 1 : 0, approved: 0, rejected: 0, expired: 0, byTier: {} }),
      pendingBusinessIds: () => ['acme']
    },
    activity: {
      recent: (o) => [
        { at: NOW - 10, businessId: 'acme', actor: 'agent', kind: 'business.automation.ran', summary: 'ran a rule' },
        { at: NOW - 20, businessId: 'acme', actor: 'user', kind: 'business.workorder.step.held', summary: 'held a step', title: 'publish' },
        { at: NOW - 30, businessId: 'acme', actor: 'agent', kind: 'agent.run.error', summary: 'provider 500' }
      ].slice(0, o.limit),
      list: (id, o) => [{ at: NOW - 10, businessId: id, actor: 'agent', kind: 'business.automation.ran', summary: 'ran a rule' }]
    },
    finance: {
      totals: (id) => ({ byCurrency: id === 'acme' ? { USD: { revenue: 1000, expense: 200, estimated: 50, count: 4 } } : {}, currencies: id === 'acme' ? ['USD'] : [] })
    },
    workOrders: {
      list: (id, o) => (id === 'acme'
        ? [{ id: 'acme~w1', businessId: 'acme', title: 'Launch', status: 'running', stepCount: 3, stepsDone: 1, createdAt: NOW - 500 }]
        : [])
    },
    errors: null    // default: not wired → the section must be honest about it
  };
  return Object.assign(base, over || {});
}

/* ---------- §25's priority order is data, and it is the one the brief names ---------- */
{
  A.eq(JSON.stringify(SECTIONS), JSON.stringify(['alerts', 'approvals', 'status', 'tasks', 'revenue', 'activity', 'errors']),
    'the section order is monitoring + approvals first, exactly as §27 ranks them');
  const model = makeRemoteReadModel(mkDeps());
  A.eq(JSON.stringify(model.priority()), JSON.stringify(SECTIONS), 'priority() publishes the same order');
}

/* ---------- summary(): every section is present as a key, always ---------- */
{
  const model = makeRemoteReadModel(mkDeps());
  const s = model.summary({});
  for (const k of SECTIONS) A.ok(Object.prototype.hasOwnProperty.call(s, k), 'summary carries section ' + k);
  A.eq(s.at, NOW, 'the snapshot is stamped with the INJECTED clock');
}

/* ---------- revenue is merged per currency across businesses ---------- */
{
  const model = makeRemoteReadModel(mkDeps());
  const r = model.summary({}).revenue;
  A.eq(r.ok, true, 'revenue is readable when finance is wired');
  A.eq(r.currencies.length, 1, 'one currency');
  A.eq(r.currencies[0].currency, 'USD', 'USD');
  A.eq(r.currencies[0].revenue, 1000, 'revenue is summed across businesses in the same currency');
  A.eq(r.currencies[0].expense, 200, 'expense too');
  A.eq(r.currencies[0].estimated, 50, 'and the estimate is kept SEPARATE, never merged into revenue');
}

/* ---------- approvals: only the OPEN ones, and a decision is final ---------- */
{
  const model = makeRemoteReadModel(mkDeps());
  const a = model.summary({}).approvals;
  A.eq(a.ok, true, 'approvals readable');
  A.eq(a.count, 2, 'the pending count comes from the store, not a re-count here');
  A.eq(a.pending.length, 1, 'the open request is listed');
  A.eq(a.pending[0].id, 'acme~a1', 'by id');
  A.ok(JSON.stringify(a.pending[0].verbs) === JSON.stringify(['approve', 'reject']), 'a remote client learns the verbs without loading the console');
}

/* ---------- alerts: composed from real conditions, never invented ---------- */
{
  const model = makeRemoteReadModel(mkDeps());
  const s = model.summary({});
  const kinds = s.alerts.map(x => x.kind);
  A.ok(kinds.indexOf('business.workorder.step.held') >= 0, 'a held worker step is an alert');
  A.ok(kinds.indexOf('agent.run.error') >= 0, 'a failed agent run is an alert');
  A.ok(s.alerts.length === 2, 'exactly the two real conditions appear — nothing fabricated');
  for (const al of s.alerts) A.ok(al.summary && al.summary.length > 0, 'every alert says what it is');
}
/* a halted hub is the loudest alert */
{
  const model = makeRemoteReadModel(mkDeps({ hub: { halted: true, haltedAt: NOW - 5 } }));
  const al = model.summary({}).alerts;
  A.ok(al.some(x => x.kind === 'automation.halted'), 'a halted hub is reported');
  A.eq(al[0].kind, 'automation.halted', 'and it sorts first (highest severity, newest)');
}

/* ---------- AN UNREADABLE SOURCE IS UNAVAILABLE, NEVER EMPTY ---------- */
{
  const model = makeRemoteReadModel(mkDeps({ finance: { totals: () => { throw new Error('disk gone'); } } }));
  const r = model.summary({}).revenue;
  A.eq(r.ok, false, 'an unreadable finance source marks revenue unavailable');
  A.ok(/disk gone/.test(r.reason), 'and names the failure');
  A.ok(!Object.prototype.hasOwnProperty.call(r, 'currencies') || r.currencies === undefined || r.currencies.length === 0,
    'no fabricated currency rows are emitted');
}
/* an unreadable business list makes the dependent counts null — NOT zero */
{
  const model = makeRemoteReadModel(mkDeps({ businesses: { list: () => { throw new Error('nope'); } } }));
  const s = model.summary({});
  A.eq(s.status.ok, false, 'status is unavailable when the business list throws');
  A.eq(s.counts.businesses, null, 'the business count is null, never 0');
}

/* ---------- a REAL zero is a fact: it means "we looked" ---------- */
{
  const model = makeRemoteReadModel(mkDeps({
    businesses: { list: () => [{ id: 'quiet', name: 'Quiet', stage: 'idea', template: 'content', currency: 'USD', updatedAt: NOW }] },
    approvals: { OPEN_STATUS: 'pending', pendingCount: () => 0, list: () => [], summary: () => ({ total: 0, pending: 0, approved: 0, rejected: 0, expired: 0, byTier: {} }), pendingBusinessIds: () => [] },
    activity: { recent: () => [], list: () => [] },
    finance: { totals: () => ({ byCurrency: {}, currencies: [] }) },
    workOrders: { list: () => [] }
  }));
  const s = model.summary({});
  A.eq(s.approvals.count, 0, 'no pending approvals is a REAL 0 (the store was read)');
  A.eq(s.counts.openTasks, 0, 'and so is the open-task count');
  A.eq(s.counts.businesses, 1, 'and the business count');
}

/* ---------- NO FABRICATED SCORE/HEALTH/GRADE/PERCENTAGE ---------- */
{
  const model = makeRemoteReadModel(mkDeps());
  const s = model.summary({});
  const bad = [];
  (function walk(o, p) {
    if (o && typeof o === 'object') {
      for (const k of Object.keys(o)) {
        if (/score|percent|health|grade|rating/i.test(k)) bad.push(p + k);
        walk(o[k], p + k + '.');
      }
    }
  })(s, '');
  A.eq(bad.length, 0, 'the snapshot carries no invented metric key: ' + bad.join(', '));
}

/* ---------- oneBusiness: strictly scoped, and an unknown id is a refusal ---------- */
{
  const model = makeRemoteReadModel(mkDeps());
  const one = model.oneBusiness('acme');
  A.eq(one.ok, true, 'a known business reads');
  A.eq(one.business.id, 'acme', 'and it is the one asked for');
  A.eq(one.tasks.open.length, 1, 'its open work orders come back');
  A.eq(one.complete, true, 'and every source was readable');
}
{
  const model = makeRemoteReadModel(mkDeps());
  A.eq(model.oneBusiness('nope').ok, false, 'an unknown business is refused');
  A.ok(/no such business/.test(model.oneBusiness('nope').reason), 'with a reason naming it');
  A.eq(model.oneBusiness('').ok, false, 'an empty id is refused — isolation is never implied');
}
/* a partial failure is surfaced, not hidden behind complete:true */
{
  const model = makeRemoteReadModel(mkDeps({ finance: { totals: () => { throw new Error('down'); } } }));
  const one = model.oneBusiness('acme');
  A.eq(one.ok, true, 'the business still reads');
  A.eq(one.revenue.ok, false, 'but the unreadable section says so');
  A.eq(one.complete, false, 'and the read is explicitly not complete');
}

/* ---------- §P4 / §P2: the composer owns no store and writes nothing ---------- */
{
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'business-remote.js'), 'utf8');
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const verb of ['persist', 'saveResilient', 'writeFileSync', 'create(', 'commit(']) {
    A.ok(CODE.indexOf(verb) < 0, 'the composer never calls ' + verb + ' — it owns no store');
  }
  // no ambient clock / rng (the determinism gate scans shared/ + sidecar/, so this must be clean too)
  A.ok(!/\bDate\.now\b/.test(CODE), 'no ambient Date.now — the clock is injected');
  A.ok(!/\bMath\.random\b/.test(CODE), 'no rng');
}

/* ---------- a throwing source is isolated: it cannot take the whole snapshot down ---------- */
{
  const model = makeRemoteReadModel(mkDeps({ activity: { recent: () => { throw new Error('feed down'); } } }));
  const s = model.summary({});
  A.eq(s.activity.ok, false, 'the activity section reports unavailable');
  A.eq(s.status.ok, true, 'but the OTHER sections still read');
  A.eq(s.revenue.ok, true, 'because one bad source does not poison the rest');
}

/* ---------- refuses nothing at build time; a bare model is simply all-unavailable ---------- */
{
  const model = makeRemoteReadModel({});
  const s = model.summary({});
  A.eq(s.status.ok, false, 'no stores wired → status unavailable');
  A.eq(s.approvals.ok, false, 'approvals unavailable');
  A.eq(s.counts.businesses, null, 'and the count is null, never a fabricated 0');
}

A.report('business-remote');
