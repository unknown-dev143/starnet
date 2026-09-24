'use strict';
/* test/agent-messages-store.test.js — agent communication (§7).

   The load-bearing properties:
     · every message names both ends and a CLOSED kind — nothing is inferred from ordering;
     · a self-message is refused (it is not communication);
     · P6: every read is scoped to one business, and an empty businessId reads nothing;
     · ids use '~', never '#', so a message id survives a URL path;
     · append-only + bounded, and persist-before-commit (fail-closed). */
const A = require('./_assert.js');
const { makeAgentMessagesStore, KINDS } = require('../sidecar/agent-messages-store.js');

function store(extra) {
  const saved = [];
  const s = makeAgentMessagesStore(Object.assign({ records: [], persist: (rows) => { saved.length = 0; for (const r of rows) saved.push(r); }, now: () => 1000 }, extra || {}));
  return { s, saved };
}

/* ---------- the closed vocabulary ---------- */
{
  A.eq(KINDS, ['note', 'request', 'handoff', 'decision', 'report'], 'message kinds are a closed vocabulary');
}

/* ---------- send: required fields ---------- */
{
  const { s } = store();
  A.eq(s.send('', { from: 'user', to: 'a', kind: 'note', body: 'x' }).ok, false, 'a send with no businessId is refused');
  A.eq(s.send('acme', { to: 'a', kind: 'note', body: 'x' }).ok, false, 'a send with no sender is refused');
  A.eq(s.send('acme', { from: 'user', kind: 'note', body: 'x' }).ok, false, 'a send with no recipient is refused');
  A.eq(s.send('acme', { from: 'user', to: 'a', body: 'x' }).ok, false, 'a send with no kind is refused');
  A.eq(s.send('acme', { from: 'user', to: 'a', kind: 'nope', body: 'x' }).ok, false, 'an unknown kind is refused');
  A.eq(s.send('acme', { from: 'user', to: 'user', kind: 'note', body: 'x' }).ok, false, 'an agent cannot message itself');
  A.eq(s.send('acme', { from: 'user', to: 'a', kind: 'note' }).ok, false, 'a message needs a subject or a body');

  const m = s.send('acme', { from: 'user', to: 'acme~a1', kind: 'request', subject: 'Research', body: 'Do the market scan' });
  A.ok(m.ok, 'a complete message is sent');
  A.eq(m.message.id, 'acme~m1', 'the id is <businessId>~m<seq>');
  A.ok(m.message.id.indexOf('#') < 0, 'the id never contains "#"');
  A.eq(m.message.from, 'user', 'the sender is recorded');
  A.eq(m.message.to, 'acme~a1', 'the recipient is recorded');
  A.eq(m.message.kind, 'request', 'the kind is recorded');
  A.eq(m.message.refs, [], 'refs default to empty');
}

/* ---------- P6: reads are scoped ---------- */
{
  const { s } = store();
  s.send('acme', { from: 'user', to: 'a1', kind: 'note', body: 'acme note' });
  s.send('beta', { from: 'user', to: 'b1', kind: 'note', body: 'beta note' });
  A.eq(s.list('acme').length, 1, 'acme sees only its own messages');
  A.eq(s.list('beta').length, 1, 'beta sees only its own');
  A.eq(s.list('acme')[0].body, 'acme note', 'and it is the right one');
  A.eq(s.list('').length, 0, 'an empty businessId reads nothing, never everything');
  A.eq(s.count('acme'), 1, 'count is per business');
}

/* ---------- reads: newest-first, filters ---------- */
{
  const { s } = store();
  s.send('acme', { from: 'user', to: 'a1', kind: 'request', body: 'first' });
  s.send('acme', { from: 'a1', to: 'user', kind: 'report', body: 'second' });
  s.send('acme', { from: 'a1', to: 'a2', kind: 'handoff', body: 'third' });

  A.eq(s.list('acme').map(m => m.body), ['third', 'second', 'first'], 'reads are newest-first by seq');
  A.eq(s.list('acme', { with: 'a1' }).length, 3, 'the "with" filter matches either direction');
  A.eq(s.list('acme', { kind: 'report' }).length, 1, 'the kind filter narrows');
  A.eq(s.list('acme', { limit: 2 }).length, 2, 'the limit caps');

  const th = s.thread('acme', 'user', 'a1');
  A.eq(th.map(m => m.body), ['second', 'first'], 'a two-party thread is both directions, newest-first');
  A.eq(s.thread('acme', 'a1', 'user').length, 2, 'and the thread is symmetric');
  A.eq(s.thread('acme', '', 'a1').length, 0, 'a thread with a blank party is empty');

  A.eq(s.parties('acme'), ['a1', 'a2', 'user'], 'parties lists everyone who appears');
  A.eq(s.parties('beta'), [], 'and is per business');
}

/* ---------- persist-before-commit + bounded ---------- */
{
  let failNext = false;
  const s = makeAgentMessagesStore({ records: [], persist: () => { if (failNext) throw new Error('disk full'); }, now: () => 1000 });
  s.send('acme', { from: 'user', to: 'a1', kind: 'note', body: 'ok' });
  failNext = true;
  A.eq(s.send('acme', { from: 'user', to: 'a1', kind: 'note', body: 'boom' }).ok, false, 'a send whose persist throws is refused');
  A.eq(s.count('acme'), 1, 'and the message was never committed');
  A.eq(s.clear('acme').ok, false, 'a clear whose persist throws is refused');
  A.eq(s.count('acme'), 1, 'and nothing was silently dropped');
  A.eq(s.clear('').ok, false, 'a clear with no businessId is refused');

  const cap = makeAgentMessagesStore({ records: [], persist: () => {}, now: () => 1000, limit: 2 });
  for (let i = 1; i <= 4; i++) cap.send('acme', { from: 'user', to: 'a1', kind: 'note', body: 'n' + i });
  cap.send('beta', { from: 'user', to: 'b1', kind: 'note', body: 'keep' });
  A.eq(cap.count('acme'), 2, 'the per-business cap holds');
  A.eq(cap.list('acme').map(m => m.body), ['n4', 'n3'], 'the OLDEST are dropped');
  A.eq(cap.count('beta'), 1, 'and another business is untouched');
}

A.report('agent-messages-store');
