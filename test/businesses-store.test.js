'use strict';
// businesses-store.test.js — the BUSINESS ENTITY store (Business OS Phase 1 foundation).
// Identity + isolation only: create is persist-before-commit (fail-closed); id + createdAt are immutable
// across an update (a rename must never re-key the business, or namespaced child stores detach);
// memoryNamespace is the tenancy key; ids de-duplicate deterministically (no rng).
const assert = require('assert');
const { makeBusinessesStore, STAGES, INACTIVE_STAGES, TEMPLATES, slugFor } = require('../sidecar/businesses-store.js');

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

function fakeStore() {
  const calls = []; let boom = false;
  return { calls, fail() { boom = true; }, heal() { boom = false; },
    persist(recs) { if (boom) throw new Error('disk full'); calls.push(recs.map(r => Object.assign({}, r))); } };
}

// --- empty store ---
{
  const bs = makeBusinessesStore({ records: [], persist: fakeStore().persist, now: () => 1 });
  ok(bs.snapshot().businesses.length === 0, 'clean store snapshot is empty');
  ok(bs.count() === 0, 'clean store count is 0');
  ok(bs.get('nope') === null, 'get() of an absent business is null');
}

// --- slugFor is deterministic + total ---
{
  ok(slugFor('My SaaS Idea') === 'my-saas-idea', 'slug lowercases + hyphenates');
  ok(slugFor('  ***  ') === 'business', 'a name with no alphanumerics falls back to "business"');
  ok(slugFor('') === 'business', 'empty name falls back to "business"');
}

// --- create stamps identity + provenance and persists once ---
{
  const recs = []; const s = fakeStore();
  const bs = makeBusinessesStore({ records: recs, persist: s.persist, now: () => 5000 });
  const r = bs.create({ name: 'Neighborhood Notes', template: 'content', createdBy: 'ai' });
  ok(r.ok === true, 'create succeeds');
  ok(r.business.id === 'neighborhood-notes', 'id is derived from the name slug');
  ok(r.business.stage === 'idea', 'a new business defaults to stage "idea"');
  ok(r.business.createdBy === 'ai', 'createdBy provenance is recorded');
  ok(r.business.createdAt === 5000 && r.business.updatedAt === 5000, 'timestamps stamped from the injected clock');
  ok(recs.length === 1 && s.calls.length === 1, 'row committed to shared records and persisted once');
}

// --- name is required ---
{
  const bs = makeBusinessesStore({ records: [], persist: fakeStore().persist, now: () => 1 });
  ok(bs.create({}).ok === false, 'create without a name is refused');
  ok(bs.create({ name: '   ' }).ok === false, 'a whitespace-only name is refused');
  ok(bs.count() === 0, 'no row is created on a refused create');
}

// --- unknown stage / template refused ---
{
  const bs = makeBusinessesStore({ records: [], persist: fakeStore().persist, now: () => 1 });
  ok(bs.create({ name: 'X', stage: 'moonshot' }).ok === false, 'unknown stage refused');
  ok(bs.create({ name: 'X', template: 'pyramid-scheme' }).ok === false, 'unknown template refused');
  ok(STAGES.indexOf('live') >= 0 && TEMPLATES.indexOf('saas') >= 0, 'the whitelists are exported');
}

// --- THE LIFECYCLE (§2): the brief's ten stages, and the inactive subset is derived from them ---
{
  // The audit's §6 item 8 called the 6-vs-10 divergence "a decision to make, not a bug". This is the
  // decision, locked: the ten the brief names, minus `launching` (folded into `live` — nothing in this
  // system can be true in "launching" and false in "live", so it would be a state nothing enters).
  ok(STAGES.length === 10, 'the lifecycle carries ten stages');
  for (const s of ['idea', 'validating', 'planning', 'building', 'testing', 'live', 'growing', 'paused', 'winding-down', 'archived']) {
    ok(STAGES.indexOf(s) >= 0, 'the lifecycle includes ' + s);
  }
  ok(STAGES.indexOf('launching') < 0,
    '`launching` is deliberately absent — folded into `live` rather than kept as a state nothing can enter');
  ok(/launching/.test(require('fs').readFileSync(require('path').join(__dirname, '..', 'sidecar', 'businesses-store.js'), 'utf8')),
    'the absence of `launching` is EXPLAINED in the source, not just missing');

  // INACTIVE_STAGES must be a real subset of STAGES — a typo here would gate a stage that cannot exist.
  for (const s of INACTIVE_STAGES) ok(STAGES.indexOf(s) >= 0, 'inactive stage ' + s + ' is a real stage');
  ok(INACTIVE_STAGES.indexOf('paused') >= 0 && INACTIVE_STAGES.indexOf('archived') >= 0,
    'paused and archived are inactive');
  ok(INACTIVE_STAGES.indexOf('winding-down') >= 0, 'winding-down is inactive (it is on its way to archived)');
  ok(INACTIVE_STAGES.indexOf('live') < 0 && INACTIVE_STAGES.indexOf('growing') < 0,
    'live and growing are NOT inactive — they are the operating states');

  // the new states are reachable through the same path as the old ones (not decoration).
  const bs = makeBusinessesStore({ records: [], persist: fakeStore().persist, now: () => 1 });
  bs.create({ name: 'Reachable Ltd' });
  for (const s of ['planning', 'testing', 'growing', 'winding-down']) {
    ok(bs.setStage('reachable-ltd', s).ok === true, 'a business can be moved into ' + s);
  }
}

// --- FAIL CLOSED: a thrown persist leaves memory untouched ---
{
  const recs = []; const s = fakeStore(); s.fail();
  const bs = makeBusinessesStore({ records: recs, persist: s.persist, now: () => 1 });
  const r = bs.create({ name: 'Doomed' });
  ok(r.ok === false, 'create returns ok:false when the durable write throws');
  ok(recs.length === 0, 'fail-closed: nothing enters memory when persist failed');
  ok(bs.count() === 0, 'the refused business is not visible');
}

// --- duplicate slugs de-duplicate deterministically ---
{
  const recs = [];
  const bs = makeBusinessesStore({ records: recs, persist: fakeStore().persist, now: () => 1 });
  bs.create({ name: 'Acme' });
  bs.create({ name: 'Acme' });
  const third = bs.create({ name: 'acme!' });
  const ids = recs.map(r => r.id);
  ok(ids[0] === 'acme' && ids[1] === 'acme-2' && ids[2] === 'acme-3', 'colliding names get -2 / -3 suffixes, no rng');
  ok(third.business.id === 'acme-3', 'the third collision resolves to acme-3');
}

// --- update preserves id + createdAt, bumps updatedAt ---
{
  let t = 100; const recs = [];
  const bs = makeBusinessesStore({ records: recs, persist: fakeStore().persist, now: () => t });
  bs.create({ name: 'Ledger Lite' });
  t = 250;
  const r = bs.update('ledger-lite', { description: 'Bookkeeping for solo founders', stage: 'validating' });
  ok(r.ok === true, 'update succeeds');
  ok(r.business.id === 'ledger-lite', 'update never re-keys the business');
  ok(r.business.createdAt === 100, 'createdAt provenance survives an update');
  ok(r.business.updatedAt === 250, 'updatedAt is bumped from the clock');
  ok(r.business.description === 'Bookkeeping for solo founders', 'a whitelisted field is written');
  ok(r.business.stage === 'validating', 'stage can be changed through update');
}

// --- RENAME does not change the id (or namespaced child stores would detach) ---
{
  const recs = [];
  const bs = makeBusinessesStore({ records: recs, persist: fakeStore().persist, now: () => 1 });
  bs.create({ name: 'Old Name' });
  const r = bs.update('old-name', { name: 'Brand New Name' });
  ok(r.business.id === 'old-name', 'the id is stable across a rename');
  ok(r.business.name === 'Brand New Name', 'the display name did change');
  ok(bs.has('old-name') === true, 'the business is still addressable by its original id');
}

// --- update refuses unknown ids + bad enums; blank rename refused ---
{
  const recs = [];
  const bs = makeBusinessesStore({ records: recs, persist: fakeStore().persist, now: () => 1 });
  bs.create({ name: 'Solid' });
  ok(bs.update('ghost', { name: 'x' }).ok === false, 'update of an unknown business is refused');
  ok(bs.update('solid', { stage: 'moonshot' }).ok === false, 'update with an unknown stage is refused');
  ok(bs.update('solid', { template: 'nope' }).ok === false, 'update with an unknown template is refused');
  ok(bs.update('solid', { name: '  ' }).ok === false, 'renaming to blank is refused');
  ok(bs.get('solid').name === 'Solid', 'a refused update leaves the row unchanged');
}

// --- update FAILS CLOSED too ---
{
  const recs = []; const s = fakeStore();
  const bs = makeBusinessesStore({ records: recs, persist: s.persist, now: () => 1 });
  bs.create({ name: 'Steady' });
  s.fail();
  const r = bs.update('steady', { description: 'should not stick' });
  ok(r.ok === false, 'update returns ok:false when persist throws');
  ok(bs.get('steady').description === '', 'fail-closed: the in-memory row is unchanged');
}

// --- setStage is a thin validated wrapper ---
{
  const recs = [];
  const bs = makeBusinessesStore({ records: recs, persist: fakeStore().persist, now: () => 1 });
  bs.create({ name: 'Pipeline Co' });
  ok(bs.setStage('pipeline-co', 'building').ok === true, 'setStage moves the business');
  ok(bs.get('pipeline-co').stage === 'building', 'the stage stuck');
  ok(bs.setStage('pipeline-co', 'meltdown').ok === false, 'setStage validates against the whitelist');
}

// --- snapshot is newest-UPDATED first ---
{
  let t = 0; const recs = [];
  const bs = makeBusinessesStore({ records: recs, persist: fakeStore().persist, now: () => t });
  t = 10; bs.create({ name: 'First' });
  t = 30; bs.create({ name: 'Second' });
  t = 20; bs.create({ name: 'Third' });
  t = 40; bs.update('first', { description: 'bumped' });   // First is now the most recently updated
  const order = bs.snapshot().businesses.map(b => b.id);
  ok(order[0] === 'first' && order[1] === 'second' && order[2] === 'third', 'snapshot sorts newest-updated first');
}

// --- remove forgets the entity (persist-before-commit) ---
{
  const recs = [];
  const bs = makeBusinessesStore({ records: recs, persist: fakeStore().persist, now: () => 1 });
  bs.create({ name: 'Temporary' });
  ok(bs.remove('temporary').ok === true, 'remove succeeds');
  ok(!bs.has('temporary') && recs.length === 0, 'the entity is forgotten');
  ok(bs.remove('never-existed').ok === true, 'removing an absent business is a no-op success');
}

// --- remove FAILS CLOSED ---
{
  const recs = []; const s = fakeStore();
  const bs = makeBusinessesStore({ records: recs, persist: s.persist, now: () => 1 });
  bs.create({ name: 'Sticky' });
  s.fail();
  ok(bs.remove('sticky').ok === false, 'remove returns ok:false when persist throws');
  ok(bs.has('sticky') === true, 'fail-closed: the business is kept when the removal could not be persisted');
}

// --- memoryNamespace is the tenancy key (P6) ---
{
  const bs = makeBusinessesStore({ records: [], persist: fakeStore().persist, now: () => 1 });
  ok(bs.memoryNamespace('acme') === 'biz:acme', 'the namespace is prefixed');
  ok(bs.memoryNamespace('acme') !== bs.memoryNamespace('acme-2'), 'two businesses never share a namespace');
}

// --- no derived/fabricated numbers leak into the entity (P1) ---
{
  const recs = [];
  const bs = makeBusinessesStore({ records: recs, persist: fakeStore().persist, now: () => 1 });
  const b = bs.create({ name: 'Honest Co' }).business;
  const keys = Object.keys(b);
  ok(keys.indexOf('revenue') < 0 && keys.indexOf('score') < 0 && keys.indexOf('valuation') < 0,
    'the entity carries no invented revenue/score/valuation — those belong to their own tagged stores');
}

console.log('businesses-store.test.js OK —', n, 'assertions');
