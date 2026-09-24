'use strict';
/* test/business-content-store.test.js — the §17 CONTENT FACTORY (Business OS Phase 4).

   THE load-bearing property: a piece cannot go LIVE by itself. advance() refuses any actor whose kind is not
   'user' when the target stage is a PUBLISH stage, and addPiece() refuses a piece BORN public. The guard
   lives in the STORE, not the route or the UI, so nothing can route around it. §13 classifies publishing as a
   review-tier action; this store is where that classification has teeth.

   Also locked: update() deliberately does NOT accept `stage` — the only way to move a piece is advance(),
   which carries the guard; publishedAt/publishedBy are set only by a human publish; history is append-only. */
const A = require('./_assert.js');
const K = require('../sidecar/business-content-store.js');

function store(extra) {
  const saved = [];
  const s = K.makeBusinessContentStore(Object.assign({
    records: [], persist: (rows) => { saved.length = 0; for (const r of rows) saved.push(r); }, now: () => 1000
  }, extra || {}));
  return { s, saved };
}
const human = { kind: 'user', name: 'Commander' };
const agent = { kind: 'agent', id: 'acme~a1', name: 'Nova' };

/* ---------- the vocabularies ---------- */
{
  A.eq(K.STAGES, ['idea', 'research', 'script', 'assets', 'editing', 'review', 'publish', 'analytics'], '§17\'s pipeline in order');
  A.eq(K.PUBLISH_STAGES, ['publish', 'analytics'], 'the two live stages');
  A.eq(K.CHANNELS, ['youtube', 'tiktok', 'instagram', 'facebook', 'blog', 'newsletter', 'product-marketing', 'other'], 'the channel set');
}

/* ---------- addPiece validation + id ---------- */
{
  const { s } = store();
  A.eq(s.addPiece('', { title: 'X', channel: 'blog' }).ok, false, 'no businessId -> refused');
  A.eq(s.addPiece('acme', { channel: 'blog' }).ok, false, 'a piece needs a title');
  A.eq(s.addPiece('acme', { title: 'X', channel: 'nope' }).ok, false, 'an unknown channel is refused');
  const p = s.addPiece('acme', { title: 'Post', channel: 'blog' });
  A.eq(p.piece.id, 'acme~n1', 'the id is <businessId>~n<seq>');
  A.ok(p.piece.id.indexOf('#') < 0, 'and never contains a #');
  A.eq(p.piece.stage, 'idea', 'a new piece starts at idea');
  A.eq(p.piece.publishedAt, null, 'and is not published');
  A.eq(p.piece.history.length, 1, 'the history opens with the creation entry');
}

/* ---------- a piece cannot be BORN public ---------- */
{
  const { s } = store();
  A.eq(s.addPiece('acme', { title: 'X', channel: 'blog', stage: 'publish' }).ok, false, 'a piece cannot be created at publish');
  A.eq(s.addPiece('acme', { title: 'X', channel: 'blog', stage: 'analytics' }).ok, false, 'nor at analytics');
  A.ok(/not a starting state/.test(s.addPiece('acme', { title: 'X', channel: 'blog', stage: 'publish' }).reason), 'and says publishing is a transition, not a state');
  A.eq(s.addPiece('acme', { title: 'X', channel: 'blog', stage: 'review' }).ok, true, 'but a NON-live stage is fine to start at');
}

/* ================= THE HEADLINE: an agent cannot publish ================= */
{
  const { s } = store();
  const id = s.addPiece('acme', { title: 'Post', channel: 'blog' }).piece.id;
  s.advance(id, 'research', agent);
  s.advance(id, 'script', agent);
  s.advance(id, 'assets', agent);
  s.advance(id, 'editing', agent);
  s.advance(id, 'review', agent);
  A.eq(s.piece(id).stage, 'review', 'an agent CAN move a piece through the non-live stages');

  const refused = s.advance(id, 'publish', agent);
  A.eq(refused.ok, false, 'an AGENT moving a piece to publish is REFUSED');
  A.ok(/not automatic/.test(refused.reason), 'and the refusal names the §17 rule');
  A.ok(/only the Commander/.test(refused.reason), 'and who alone may do it');
  A.eq(s.piece(id).stage, 'review', 'the piece did not move');

  const refused2 = s.advance(id, 'analytics', { kind: 'system' });
  A.eq(refused2.ok, false, 'a SYSTEM actor is refused too');

  const ok = s.advance(id, 'publish', human);
  A.eq(ok.ok, true, 'the COMMANDER can publish');
  A.eq(ok.piece.stage, 'publish', 'and the piece moves');
  A.ok(!!ok.piece.publishedAt, 'publishedAt is stamped');
  A.eq(ok.piece.publishedBy, 'Commander', 'and publishedBy names the human');
}

/* ---------- an unknown stage is refused; a missing actor defaults to system (not user) ---------- */
{
  const { s } = store();
  const id = s.addPiece('acme', { title: 'X', channel: 'blog' }).piece.id;
  A.eq(s.advance(id, 'nope', human).ok, false, 'an unknown stage is refused');
  // no actor at all -> defaults to 'system', which is NOT the human, so publish is still refused
  A.eq(s.advance(id, 'publish').ok, false, 'a publish with NO actor is refused (defaults to system, never assumed to be you)');
}

/* ---------- update() cannot move the stage — only advance() can ---------- */
{
  const { s } = store();
  const id = s.addPiece('acme', { title: 'X', channel: 'blog' }).piece.id;
  s.update(id, { stage: 'publish' });
  A.eq(s.piece(id).stage, 'idea', 'a generic update() carrying stage does NOT move the piece — the guard cannot be bypassed');
  A.eq(s.piece(id).publishedAt, null, 'and nothing is published');
  A.eq(s.update(id, { title: 'New' }).piece.title, 'New', 'but a legitimate field still updates');
  A.eq(s.update(id, { title: '  ' }).ok, false, 'a blank title is refused');
  A.eq(s.update(id, { channel: 'nope' }).ok, false, 'an unknown channel is refused');
}

/* ---------- history is append-only and records the actor kind ---------- */
{
  const { s } = store();
  const id = s.addPiece('acme', { title: 'X', channel: 'blog' }).piece.id;
  s.advance(id, 'research', agent);
  s.advance(id, 'script', human);
  const h = s.piece(id).history;
  A.eq(h.length, 3, 'three entries: create + two advances');
  A.eq(h[1].by, 'agent', 'the agent move is attributed to an agent');
  A.eq(h[2].by, 'user', 'the human move is attributed to the user');
  A.eq(h[2].from, 'research', 'and records where it came from');
  A.eq(h[2].to, 'script', 'and where it went');
}

/* ---------- summary counts per stage and channel ---------- */
{
  const { s } = store();
  s.addPiece('acme', { title: 'A', channel: 'blog' });
  s.addPiece('acme', { title: 'B', channel: 'youtube' });
  const id = s.addPiece('acme', { title: 'C', channel: 'blog' }).piece.id;
  s.advance(id, 'publish', human);
  const sum = s.summary('acme');
  A.eq(sum.total, 3, 'three pieces');
  A.eq(sum.byStage.idea, 2, 'two still at idea');
  A.eq(sum.byStage.publish, 1, 'one published');
  A.eq(sum.byChannel.blog, 2, 'two on the blog channel');
  A.eq(sum.published, 1, 'and one counted as published');
}

/* ---------- P6 + clear ---------- */
{
  const { s } = store();
  s.addPiece('acme', { title: 'A', channel: 'blog' });
  s.addPiece('beta', { title: 'B', channel: 'blog' });
  A.eq(s.count('acme'), 1, 'count is per business');
  A.eq(s.clear('').ok, false, 'clear with no businessId is refused');
  s.clear('acme');
  A.eq(s.count('acme'), 0, 'acme is cleared');
  A.eq(s.count('beta'), 1, 'beta is untouched');
}

/* ---------- persist-before-commit ---------- */
{
  let boom = false;
  const s = K.makeBusinessContentStore({ records: [], persist: () => { if (boom) throw new Error('denied'); }, now: () => 1000 });
  const id = s.addPiece('acme', { title: 'A', channel: 'blog' }).piece.id;
  s.advance(id, 'review', human);
  boom = true;
  A.eq(s.advance(id, 'publish', human).ok, false, 'a publish whose persist throws returns ok:false');
  A.eq(s.piece(id).stage, 'review', 'the piece stays where it was');
}

A.report('business-content-store');
