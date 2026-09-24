'use strict';
/* test/business-activity-store.test.js — the per-business ACTIVITY LOG (Business OS Phase 1).
   Append-only + bounded + fail-closed. The load-bearing property is ISOLATION (P6): every read filters on
   an explicitly supplied businessId, an empty one is REFUSED rather than read as "everything", and the cap
   and the clear each touch ONE business. recent() is the single deliberate cross-business exception. */
const A = require('./_assert.js');
const { makeBusinessActivityStore, RESULTS, APPROVALS, ACTOR_KINDS } = require('../sidecar/business-activity-store.js');

function fakeStore() {
  const calls = []; let boom = false;
  return { calls, fail() { boom = true; }, heal() { boom = false; },
    persist(recs) { if (boom) throw new Error('disk full'); calls.push(recs.map(r => Object.assign({}, r))); } };
}

// --- empty ---
{
  const s = makeBusinessActivityStore({ records: [], persist: fakeStore().persist, now: () => 1 });
  A.eq(s.list('acme'), [], 'a clean log reads empty');
  A.eq(s.count('acme'), 0, 'a clean log counts zero');
  A.eq(s.recent(), [], 'a clean cross-business feed is empty');
}

// --- append stamps identity, seq, clock, and honest defaults ---
{
  const recs = []; const f = fakeStore();
  const s = makeBusinessActivityStore({ records: recs, persist: f.persist, now: () => 5000 });
  const r = s.append('acme', { action: 'Created campaign draft' });
  A.ok(r.ok === true, 'append succeeds');
  A.ok(r.entry.id === 'acme#1' && r.entry.seq === 1, 'id + seq derive from the business and the count (no rng)');
  A.ok(r.entry.at === 5000, 'the timestamp comes from the injected clock');
  A.eq(r.entry.actor.kind, 'system', 'actor.kind defaults to system, not to a fake agent');
  A.eq(r.entry.result, 'ok', 'result defaults to ok');
  A.eq(r.entry.approval, 'not-required', 'approval defaults to not-required');
  A.ok(recs.length === 1 && f.calls.length === 1, 'the entry is committed to the shared array and persisted once');
}

// --- required fields ---
{
  const s = makeBusinessActivityStore({ records: [], persist: fakeStore().persist, now: () => 1 });
  A.ok(s.append('', { action: 'x' }).ok === false, 'an empty businessId is REFUSED (never read as "all")');
  A.ok(s.append('  ', { action: 'x' }).ok === false, 'a whitespace businessId is refused');
  A.ok(s.append('acme', {}).ok === false, 'a missing action is refused');
  A.ok(s.append('acme', { action: '  ' }).ok === false, 'a blank action is refused');
  A.eq(s.count('acme'), 0, 'no refused append leaves a row');
}

// --- closed vocabularies are enforced, not coerced ---
{
  const s = makeBusinessActivityStore({ records: [], persist: fakeStore().persist, now: () => 1 });
  A.ok(s.append('acme', { action: 'x', result: 'great' }).ok === false, 'an unknown result is refused');
  A.ok(s.append('acme', { action: 'x', approval: 'maybe' }).ok === false, 'an unknown approval is refused');
  A.ok(s.append('acme', { action: 'x', actor: { kind: 'robot' } }).ok === false, 'an unknown actor.kind is refused');
  A.ok(RESULTS.indexOf('error') >= 0 && APPROVALS.indexOf('granted') >= 0 && ACTOR_KINDS.indexOf('agent') >= 0, 'the vocabularies are exported');
}

// --- FAIL CLOSED ---
{
  const recs = []; const f = fakeStore(); f.fail();
  const s = makeBusinessActivityStore({ records: recs, persist: f.persist, now: () => 1 });
  const r = s.append('acme', { action: 'x' });
  A.ok(r.ok === false, 'append returns ok:false when the durable write throws');
  A.eq(recs.length, 0, 'fail-closed: nothing is recorded when it could not be made durable');
}

// --- ISOLATION: one business never reads another's rows ---
{
  const recs = [];
  const s = makeBusinessActivityStore({ records: recs, persist: fakeStore().persist, now: () => 1 });
  s.append('acme', { action: 'a1' });
  s.append('globex', { action: 'g1' });
  s.append('acme', { action: 'a2' });
  A.eq(s.list('acme').map(e => e.action), ['a2', 'a1'], 'list() returns only this business, newest first');
  A.eq(s.list('globex').map(e => e.action), ['g1'], 'the other business sees only its own row');
  A.eq(s.count('acme'), 2, 'count is per business');
  A.eq(s.count('globex'), 1, 'count is per business (other)');
  A.eq(s.list(''), [], 'an empty businessId reads nothing');
  A.eq(s.count(''), 0, 'an empty businessId counts nothing');
}

// --- seq is per-business and monotonic (ordering never depends on the clock) ---
{
  let t = 100; const recs = [];
  const s = makeBusinessActivityStore({ records: recs, persist: fakeStore().persist, now: () => t });
  s.append('acme', { action: 'first' });
  t = 50;   // clock goes BACKWARDS
  s.append('acme', { action: 'second' });
  A.eq(s.list('acme').map(e => e.action), ['second', 'first'], 'ordering follows seq, so a backwards clock cannot reorder the log');
}

// --- list(limit) ---
{
  const recs = [];
  const s = makeBusinessActivityStore({ records: recs, persist: fakeStore().persist, now: () => 1 });
  for (let i = 1; i <= 5; i++) s.append('acme', { action: 'e' + i });
  A.eq(s.list('acme', { limit: 2 }).map(e => e.action), ['e5', 'e4'], 'list(limit) returns the newest N');
}

// --- BOUNDED per business: the cap drops the OLDEST, and never another business's rows ---
{
  const recs = [];
  const s = makeBusinessActivityStore({ records: recs, persist: fakeStore().persist, now: () => 1, limit: 3 });
  for (let i = 1; i <= 5; i++) s.append('acme', { action: 'e' + i });
  s.append('globex', { action: 'keep-me' });
  A.eq(s.count('acme'), 3, 'the capped business keeps at most `limit` entries');
  A.eq(s.list('acme').map(e => e.action), ['e5', 'e4', 'e3'], 'the OLDEST entries are the ones dropped');
  A.eq(s.count('globex'), 1, 'capping one business never touches another');
  A.eq(s.LIMIT, 3, 'the effective limit is reported');
}

// --- recent() is the ONE cross-business feed, newest-clock-first ---
{
  let t = 0; const recs = [];
  const s = makeBusinessActivityStore({ records: recs, persist: fakeStore().persist, now: () => t });
  t = 10; s.append('acme', { action: 'a' });
  t = 30; s.append('globex', { action: 'b' });
  t = 20; s.append('acme', { action: 'c' });
  A.eq(s.recent().map(e => e.action), ['b', 'c', 'a'], 'recent() spans businesses, newest first');
  A.eq(s.recent({ limit: 1 }).map(e => e.action), ['b'], 'recent(limit) is honoured');
  A.eq(s.businessIds(), ['acme', 'globex'], 'businessIds() lists the businesses with activity');
}

// --- clear() is per business + fail-closed ---
{
  const recs = []; const f = fakeStore();
  const s = makeBusinessActivityStore({ records: recs, persist: f.persist, now: () => 1 });
  s.append('acme', { action: 'a' });
  s.append('globex', { action: 'g' });
  A.ok(s.clear('acme').ok === true, 'clear succeeds');
  A.eq(s.count('acme'), 0, 'the cleared business is empty');
  A.eq(s.count('globex'), 1, 'clear never touches another business');
  A.ok(s.clear('').ok === false, 'clear without a businessId is refused');

  f.fail();
  s.append('globex', { action: 'x' });   // refused, but globex still has 1
  A.ok(s.clear('globex').ok === false, 'clear returns ok:false when persist throws');
  A.eq(s.count('globex'), 1, 'fail-closed: the log is kept when the clear could not be persisted');
}

// --- a MALFORMED row loaded from disk must not throw on read ---
{
  const recs = [{ id: 'acme#1', seq: 1, businessId: 'acme', at: 1, action: 'legacy' }];   // no `actor`
  const s = makeBusinessActivityStore({ records: recs, persist: fakeStore().persist, now: () => 1 });
  const out = s.list('acme');
  A.eq(out.length, 1, 'a row missing `actor` still reads');
  A.eq(out[0].actor.kind, 'system', 'a missing actor degrades to system rather than throwing');
}

A.report('business-activity-store.test');
