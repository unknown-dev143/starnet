'use strict';
/* test/business-memory.test.js — the §9 four-scope memory store.

   The load-bearing properties:
     · four scopes exactly as §9 names them, and §9's list of what is remembered is a CLOSED vocabulary;
     · P6 is structural: an ownerId is REQUIRED on write, an empty one is REFUSED, and a read for one owner
       can never return another owner's rows — including across two businesses;
     · P1: a memory carries a SOURCE and the store refuses one without — a remembered fact with no provenance
       is indistinguishable from an invented one;
     · ids use '~', never '#', so a memory id survives being put in a URL path;
     · persist-before-commit: a thrown persist leaves memory untouched and returns ok:false. */
const A = require('./_assert.js');
const { makeBusinessMemory, SCOPES, KINDS, SOURCES } = require('../sidecar/business-memory.js');

function mem(extra) {
  const saved = [];
  const store = makeBusinessMemory(Object.assign({ records: [], persist: (rows) => { saved.length = 0; for (const r of rows) saved.push(r); }, now: () => 1000 }, extra || {}));
  return { store, saved };
}

/* ---------- §9's scopes and its list of what is remembered ---------- */
{
  A.eq(SCOPES, ['user', 'business', 'project', 'agent'], 'the four scopes are §9\'s four');
  A.eq(KINDS, ['objective', 'decision', 'document', 'customer', 'product', 'experiment', 'failure', 'strategy', 'constraint', 'instruction', 'policy'],
    'the memory kinds are §9\'s list, verbatim');
  A.eq(SOURCES, ['user', 'document', 'agent', 'import'], 'provenance is a closed vocabulary');
}

/* ---------- write: required fields, closed vocabularies ---------- */
{
  const { store } = mem();
  A.ok(store.write('business', 'acme', { kind: 'decision', text: 'Ship the MVP in March', source: 'user' }).ok, 'a complete write succeeds');
  A.eq(store.write('nope', 'acme', { kind: 'decision', text: 'x', source: 'user' }).ok, false, 'an unknown scope is refused');
  A.eq(store.write('business', 'acme', { kind: 'nope', text: 'x', source: 'user' }).ok, false, 'an unknown kind is refused');
  A.eq(store.write('business', 'acme', { kind: 'decision', text: '  ', source: 'user' }).ok, false, 'empty text is refused');
  A.eq(store.write('business', 'acme', { kind: 'decision', text: 'x' }).ok, false, 'a write with no source is refused (P1)');
  A.eq(store.write('business', 'acme', { kind: 'decision', text: 'x', source: 'made-up' }).ok, false, 'an unknown source is refused');

  A.ok(/source/.test(store.write('business', 'acme', { kind: 'decision', text: 'x' }).reason), 'the P1 refusal names the missing source');
}

/* ---------- P6: isolation is by key, and an empty owner is refused ---------- */
{
  const { store } = mem();
  A.eq(store.write('business', '', { kind: 'decision', text: 'x', source: 'user' }).ok, false, 'a business write with no ownerId is REFUSED');
  A.ok(/never implied/.test(store.write('business', '', { kind: 'decision', text: 'x', source: 'user' }).reason), 'and says why');
  A.eq(store.write('project', '', { kind: 'decision', text: 'x', source: 'user' }).ok, false, 'a project write with no ownerId is refused');
  A.eq(store.write('agent', '', { kind: 'decision', text: 'x', source: 'user' }).ok, false, 'an agent write with no ownerId is refused');

  // the user scope is the ONE scope where the owner is implied (a single-user station).
  A.ok(store.write('user', '', { kind: 'instruction', text: 'Always answer in metric', source: 'user' }).ok, 'a user-scope write defaults its owner');

  store.write('business', 'acme', { kind: 'decision', text: 'acme fact', source: 'user' });
  store.write('business', 'other', { kind: 'decision', text: 'other fact', source: 'user' });
  A.eq(store.read('business', 'acme').length, 1, 'acme sees only its own memory');
  A.eq(store.read('business', 'other').length, 1, 'other sees only its own memory');
  A.eq(store.read('business', 'acme')[0].text, 'acme fact', 'and it is the right row');
  A.eq(store.read('business', 'other')[0].text, 'other fact', 'and so is the other one');

  // cross-SCOPE reads are also isolated even when the owner string is identical.
  store.write('project', 'acme', { kind: 'objective', text: 'project fact', source: 'user' });
  store.write('agent', 'acme', { kind: 'failure', text: 'agent fact', source: 'agent' });
  A.eq(store.read('business', 'acme').length, 1, 'a business read does not see the same-named project scope');
  A.eq(store.read('project', 'acme').length, 1, 'a project read does not see the same-named business scope');
  A.eq(store.read('agent', 'acme').length, 1, 'an agent read is its own scope');
  A.eq(store.read('business', 'nobody').length, 0, 'an unknown owner reads empty — safe, not everything');
  A.eq(store.read('nope', 'acme').length, 0, 'an unknown scope reads empty');
}

/* ---------- reads: ordering, kind filter, limit, counts ---------- */
{
  const { store } = mem();
  store.write('business', 'acme', { kind: 'objective', text: 'first', source: 'user' });
  store.write('business', 'acme', { kind: 'decision', text: 'second', source: 'user' });
  store.write('business', 'acme', { kind: 'decision', text: 'third', source: 'user' });

  const all = store.read('business', 'acme');
  A.eq(all.map(r => r.text), ['third', 'second', 'first'], 'reads are newest-first by seq, not by clock');
  A.eq(store.read('business', 'acme', { kind: 'decision' }).length, 2, 'a kind filter narrows the read');
  A.eq(store.read('business', 'acme', { limit: 2 }).length, 2, 'a limit caps the read');
  A.eq(store.count('business', 'acme'), 3, 'count reports the rows');
  A.eq(store.count('business', ''), 0, 'count for an empty owner is 0, never a total');
  A.eq(store.kinds('business', 'acme'), { objective: 1, decision: 2, document: 0, customer: 0, product: 0, experiment: 0, failure: 0, strategy: 0, constraint: 0, instruction: 0, policy: 0 },
    'kinds() is a per-kind COUNT, never a score');
}

/* ---------- ids survive a URL path ---------- */
{
  const { store } = mem();
  const e = store.write('business', 'acme', { kind: 'decision', text: 'x', source: 'user' }).entry;
  A.eq(e.id, 'business~acme~1', 'the id is scope~owner~seq');
  A.ok(e.id.indexOf('#') < 0, 'the id never contains "#" — a "#" would be stripped as a URL fragment');
  A.eq(store.get(e.id).id, e.id, 'get() resolves the id it returned');
  A.eq(store.get('nope'), null, 'get() returns null for an unknown id');

  const a = store.write('agent', 'acme~a1', { kind: 'failure', text: 'x', source: 'agent' }).entry;
  A.eq(a.id, 'agent~acme~a1~1', 'an agent-scope id nests the agent id');
  A.ok(/^[A-Za-z0-9_~-]+$/.test(a.id), 'the id matches the route id class (no reserved characters)');
}

/* ---------- businessId is carried for event/UI grouping ---------- */
{
  const { store } = mem();
  A.eq(store.write('business', 'acme', { kind: 'decision', text: 'x', source: 'user' }).entry.businessId, 'acme',
    'a business-scope entry is filed under the business');
  A.eq(store.write('agent', 'acme~a1', { kind: 'failure', text: 'x', source: 'agent', businessId: 'acme' }).entry.businessId, 'acme',
    'an agent-scope entry carries the business the caller named');
  A.eq(store.write('user', '', { kind: 'instruction', text: 'x', source: 'user' }).entry.businessId, '',
    'a user-scope entry belongs to no business');
}

/* ---------- forget / clear ---------- */
{
  const { store } = mem();
  const e = store.write('business', 'acme', { kind: 'decision', text: 'x', source: 'user' }).entry;
  A.eq(store.forget('nope'), { ok: true, removed: 0 }, 'forgetting an unknown id is a no-op success');
  A.eq(store.forget(e.id), { ok: true, removed: 1 }, 'forgetting a real id removes it');
  A.eq(store.count('business', 'acme'), 0, 'and the count drops');

  store.write('business', 'acme', { kind: 'decision', text: 'a', source: 'user' });
  store.write('business', 'other', { kind: 'decision', text: 'b', source: 'user' });
  A.eq(store.clear('business', '').ok, false, 'a bare clear is refused — it would wipe every owner');
  A.ok(store.clear('business', 'acme').ok, 'a scoped clear succeeds');
  A.eq(store.count('business', 'acme'), 0, 'acme is cleared');
  A.eq(store.count('business', 'other'), 1, 'and other is untouched');
}

/* ---------- persist-before-commit (fail-closed) ---------- */
{
  let failNext = false;
  const store = makeBusinessMemory({ records: [], persist: () => { if (failNext) throw new Error('disk full'); }, now: () => 1000 });
  A.ok(store.write('business', 'acme', { kind: 'decision', text: 'x', source: 'user' }).ok, 'a normal write commits');
  failNext = true;
  A.eq(store.write('business', 'acme', { kind: 'decision', text: 'y', source: 'user' }).ok, false, 'a write whose persist throws is refused');
  A.eq(store.count('business', 'acme'), 1, 'and memory is untouched — the refused row was never committed');
  const id = store.read('business', 'acme')[0].id;
  A.eq(store.forget(id).ok, false, 'a forget whose persist throws is refused');
  A.eq(store.count('business', 'acme'), 1, 'and the entry is kept');
  A.eq(store.clear('business', 'acme').ok, false, 'a clear whose persist throws is refused');
  A.eq(store.count('business', 'acme'), 1, 'and nothing was silently dropped');
}

/* ---------- bounded per owner ---------- */
{
  const { store } = mem({ limit: 3 });
  for (let i = 1; i <= 5; i++) store.write('business', 'acme', { kind: 'decision', text: 'n' + i, source: 'user' });
  store.write('business', 'other', { kind: 'decision', text: 'keep', source: 'user' });
  A.eq(store.count('business', 'acme'), 3, 'the per-owner cap holds');
  A.eq(store.read('business', 'acme').map(r => r.text), ['n5', 'n4', 'n3'], 'the OLDEST rows are dropped');
  A.eq(store.count('business', 'other'), 1, 'and another owner is not touched by the cap');
}

/* ---------- namespace ---------- */
{
  const { store } = mem();
  A.eq(store.namespace('user', ''), 'mem:user', 'the user namespace is global');
  A.eq(store.namespace('business', 'acme'), 'mem:biz:acme', 'a business namespace is prefixed');
  A.eq(store.namespace('project', 'p1'), 'mem:proj:p1', 'a project namespace is prefixed');
  A.eq(store.namespace('agent', 'acme~a1'), 'mem:agent:acme~a1', 'an agent namespace is prefixed');
}

A.report('business-memory');
