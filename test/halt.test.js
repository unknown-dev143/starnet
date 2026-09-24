/* node test/halt.test.js — the E-STOP kill logic (sidecar/halt.js). Locks: killAll aborts EVERY browser run
   AND every messaging-hub run, marks hub runs `superseded` BEFORE aborting (so no stale partial reply ships
   after the kill), returns the count, and never throws on null maps or a throwing abort (an E-STOP must not
   fail). Also locks the SCOPED door (killScope) — the per-business pause (§21) — which must abort ONLY the
   matching runs and must fail SAFE (never over-kill) on an empty key or an unattributable map.
   The HTTP route /api/halt is verified separately by a live sidecar smoke. */
'use strict';
const A = require('./_assert.js');
const { killAll, killScope } = require('../sidecar/halt.js');

function fakeAc() { let aborted = false; return { abort() { aborted = true; }, get aborted() { return aborted; } }; }

/* ---- browser runs only ---- */
{
  const a = fakeAc(), b = fakeAc();
  const n = killAll(new Map([['r1', a], ['r2', b]]), null);
  A.eq(n, 2, 'aborts both browser runs and counts them');
  A.ok(a.aborted && b.aborted, 'both browser controllers aborted');
}

/* ---- browser + hub runs: hub runs are marked superseded BEFORE the abort ---- */
{
  const a = fakeAc();
  const h1 = { abort: fakeAc(), superseded: false };
  const h2 = { abort: fakeAc(), superseded: false };
  const n = killAll(new Map([['r1', a]]), new Map([['c1', h1], ['c2', h2]]));
  A.eq(n, 3, 'counts browser + both hub runs');
  A.ok(a.aborted, 'browser run aborted');
  A.ok(h1.abort.aborted && h2.abort.aborted, 'both hub runs aborted');
  A.ok(h1.superseded && h2.superseded, 'hub runs marked superseded — no stale partial delivered after HALT');
}

/* ---- MULTIPLE hub maps (Telegram + Discord) are all killed in one call ---- */
{
  const a = fakeAc();
  const tg = { abort: fakeAc(), superseded: false };
  const dc = { abort: fakeAc(), superseded: false };
  const n = killAll(new Map([['r1', a]]), new Map([['c1', tg]]), new Map([['c2', dc]]));
  A.eq(n, 3, 'counts browser + telegram + discord hub runs');
  A.ok(a.aborted, 'browser run aborted');
  A.ok(tg.abort.aborted && tg.superseded, 'telegram hub run aborted + superseded');
  A.ok(dc.abort.aborted && dc.superseded, 'discord hub run aborted + superseded');
  A.eq(killAll(null, null, null), 0, 'all-null hub maps -> 0, no throw');
}

/* ---- the E-STOP must be unbreakable: null maps, a throwing abort, a null rec ---- */
{
  A.eq(killAll(null, null), 0, 'null maps -> 0, no throw');
  const boom = { abort() { throw new Error('boom'); } };
  let n;
  A.notThrows(() => { n = killAll(new Map([['r1', boom], ['r2', fakeAc()]]), null); }, 'a throwing abort never propagates out of the E-STOP');
  A.eq(n, 2, 'still counts a run whose abort threw');
  A.notThrows(() => killAll(new Map(), new Map([['c', null]])), 'a null hub rec is tolerated');
}

/* ---- killScope: the per-business pause aborts ONLY that business's runs ---- */
{
  const a = fakeAc(), b = fakeAc(), c = fakeAc();
  const runs = new Map([['r1', a], ['r2', b], ['r3', c]]);
  const tags = new Map([['r1', 'acme'], ['r2', 'globex'], ['r3', 'acme']]);
  const n = killScope('acme', tags, runs);
  A.eq(n, 2, 'killScope aborts only the two runs tagged acme');
  A.ok(a.aborted && c.aborted, 'both acme runs aborted');
  A.ok(!b.aborted, 'the globex run is UNTOUCHED — a business pause is not a station E-STOP');
  A.eq(killAll(new Map([['r2', b]]), null), 1, 'the survivor is still killable by the station E-STOP');
}

/* ---- killScope accepts a plain object and a function as the tag source ---- */
{
  const a = fakeAc(), b = fakeAc();
  const n = killScope('acme', { r1: 'acme' }, new Map([['r1', a], ['r2', b]]));
  A.eq(n, 1, 'a plain-object tag source works');
  A.ok(a.aborted && !b.aborted, 'only the tagged run died');
  const c = fakeAc();
  A.eq(killScope('acme', (k) => (k === 'r1' ? 'acme' : 'globex'), new Map([['r1', c]])), 1, 'a function tag source works');
}

/* ---- killScope FAILS SAFE: an empty key never means "everything" ---- */
{
  const a = fakeAc();
  A.eq(killScope('', { r1: 'acme' }, new Map([['r1', a]])), 0, 'an empty scope key aborts nothing');
  A.ok(!a.aborted, 'an empty scope key did NOT over-kill — an empty id is never "all businesses"');
  A.eq(killScope(null, null, new Map([['r1', a]])), 0, 'a null scope key aborts nothing');
  A.eq(killScope('acme', null, null), 0, 'null maps -> 0, no throw');
}

/* ---- killScope with hub maps: matching only, and an unkeyed map is SKIPPED not swept ---- */
{
  const h1 = { abort: fakeAc(), superseded: false };
  const h2 = { abort: fakeAc(), superseded: false };
  const hubTags = new Map([['chat-1', 'acme'], ['chat-2', 'globex']]);
  const n = killScope('acme', hubTags, new Map(), new Map([['chat-1', h1], ['chat-2', h2]]));
  A.eq(n, 1, 'killScope kills only the matching hub run');
  A.ok(h1.abort.aborted && h1.superseded && h1.halted, 'the matching hub run is aborted + superseded + halted');
  A.ok(!h2.abort.aborted && !h2.superseded, 'the other business’s hub run is untouched');
  // a Map-like with values() but no entries() cannot be attributed — a scoped kill must not guess.
  const unkeyed = { values() { return [h2].values(); } };
  A.eq(killScope('acme', hubTags, new Map(), unkeyed), 0, 'an unattributable hub map is skipped, never swept');
  A.ok(!h2.abort.aborted, 'the skipped hub run was not aborted');
}

/* ---- killScope is as unbreakable as killAll ---- */
{
  const boom = { abort() { throw new Error('boom'); } };
  let n;
  A.notThrows(() => { n = killScope('acme', { r1: 'acme', r2: 'acme' }, new Map([['r1', boom], ['r2', fakeAc()]])); },
    'a throwing abort never propagates out of a scoped kill');
  A.eq(n, 2, 'a scoped kill still counts a run whose abort threw');
  A.notThrows(() => killScope('acme', () => { throw new Error('lookup boom'); }, new Map([['r1', fakeAc()]])),
    'a throwing tag lookup is tolerated (candidate skipped, no throw)');
  A.eq(killScope('acme', () => { throw new Error('lookup boom'); }, new Map([['r1', fakeAc()]])), 0,
    'a throwing tag lookup matches nothing rather than everything');
}

A.report('halt');
