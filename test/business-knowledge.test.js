'use strict';
/* test/business-knowledge.test.js — the §15 KNOWLEDGE CENTER (Business OS Phase 4).

   THE load-bearing property: retrieval is LITERAL term overlap and says so, in the response, every time. It
   is NOT a semantic or AI relevance score (P7), and the honest label travels with the payload
   (termOverlapNote) so no caller can present it as one. Every hit reports termOverlap/queryTerms and which
   terms matched, so the claim is checkable.

   Also locked: a knowledge entry needs a source (P1) — §15 retrieves this BEFORE a decision, so its origin
   must be recorded; the 9 kinds are closed; tokens shorter than MIN_TOKEN are dropped so "a"/"of" cannot make
   the overlap number meaningless; the id is <businessId>~g<seq>. */
const A = require('./_assert.js');
const G = require('../sidecar/business-knowledge.js');

function store(extra) {
  const saved = [];
  const s = G.makeBusinessKnowledge(Object.assign({
    records: [], persist: (rows) => { saved.length = 0; for (const r of rows) saved.push(r); }, now: () => 1000
  }, extra || {}));
  return { s, saved };
}
const entry = (kind, title, body, source, extra) => Object.assign({ kind: kind, title: title, body: body, source: source }, extra || {});

/* ---------- the vocabularies ---------- */
{
  A.eq(G.KINDS, ['pdf', 'note', 'research', 'website', 'document', 'spec', 'feedback', 'competitor', 'internal'], '§15\'s nine kinds');
  A.eq(G.MIN_TOKEN, 3, 'tokens shorter than 3 are dropped from retrieval');
}

/* ---------- add validation + id ---------- */
{
  const { s } = store();
  A.eq(s.add('', entry('note', 'X', 'b', 'src')).ok, false, 'no businessId -> refused');
  A.eq(s.add('acme', entry('nope', 'X', 'b', 'src')).ok, false, 'an unknown kind is refused');
  A.eq(s.add('acme', entry('note', '', 'b', 'src')).ok, false, 'a knowledge entry needs a title');
  A.eq(s.add('acme', entry('note', 'X', 'b', '')).ok, false, 'a knowledge entry needs a source (P1)');
  A.ok(/P1/.test(s.add('acme', entry('note', 'X', 'b', '')).reason), 'and the refusal cites P1');
  const a = s.add('acme', entry('note', 'Pricing', 'we charge ten dollars', 'interview'));
  A.eq(a.entry.id, 'acme~g1', 'the id is <businessId>~g<seq>');
  A.ok(a.entry.id.indexOf('#') < 0, 'and never contains a #');
  A.eq(a.entry.source, 'interview', 'the source is stored');
}

/* ================= THE HEADLINE: literal overlap, labelled as such ================= */
{
  const { s } = store();
  s.add('acme', entry('research', 'Pricing study', 'customers care about pricing and value', 'report'));
  s.add('acme', entry('note', 'Hiring', 'we need two engineers', 'chat'));
  const r = s.retrieve('acme', { query: 'pricing' });
  A.eq(r.hits.length, 1, 'only the pricing entry matches');
  A.eq(r.hits[0].title, 'Pricing study', 'and it is the right one');
  A.eq(r.hits[0].termOverlap, 1, 'the overlap count is reported');
  A.eq(r.hits[0].queryTerms, 1, 'alongside the number of query terms');
  A.eq(r.hits[0].matched, ['pricing'], 'and WHICH terms matched');
  A.ok(/LITERAL term overlap/.test(r.termOverlapNote), 'the response carries the honest label');
  A.ok(/not a semantic or AI relevance score/.test(r.termOverlapNote), 'explicitly denying it is an AI score (P7)');
  A.ok(!/semantic|embedding|ai score/i.test(JSON.stringify(r.hits)), 'nothing in the hits claims semantic relevance');
}

/* ---------- ties break on recency, then id ---------- */
{
  const { s } = store();
  s.add('acme', entry('note', 'Old', 'alpha beta', 'a', { at: 1000 }));
  s.add('acme', entry('note', 'New', 'alpha beta', 'b', { at: 5000 }));
  const r = s.retrieve('acme', { query: 'alpha beta' });
  A.eq(r.hits[0].title, 'New', 'equal overlap breaks toward the more recent entry');
}

/* ---------- title matches flag inTitle; short tokens are dropped ---------- */
{
  const { s } = store();
  s.add('acme', entry('note', 'Retention playbook', 'body text', 'src'));
  const r = s.retrieve('acme', { query: 'retention' });
  A.eq(r.hits[0].inTitle, true, 'a title match sets inTitle');
  A.eq(s.retrieve('acme', { query: 'a of to' }).hits.length, 0, 'a query of only short tokens matches nothing (MIN_TOKEN)');
  A.eq(s.retrieve('acme', { query: 'zzzznomatch' }).hits.length, 0, 'a no-match query returns nothing');
  A.eq(s.retrieve('acme', { query: '' }).hits.length, 0, 'an empty query returns nothing');
}

/* ---------- kinds filter + limit ---------- */
{
  const { s } = store();
  s.add('acme', entry('research', 'A', 'alpha', 'x'));
  s.add('acme', entry('note', 'B', 'alpha', 'y'));
  A.eq(s.retrieve('acme', { query: 'alpha' }).hits.length, 2, 'without a filter both match');
  A.eq(s.retrieve('acme', { query: 'alpha', kinds: ['research'] }).hits.length, 1, 'the kinds filter narrows it');
  A.eq(s.retrieve('acme', { query: 'alpha', limit: 1 }).hits.length, 1, 'the limit caps the hits');
}

/* ---------- summary ---------- */
{
  const { s } = store();
  s.add('acme', entry('note', 'A', 'b', 'x', { tags: ['pricing', 'pricing', 'growth'] }));
  s.add('acme', entry('research', 'B', 'c', 'y', { tags: ['pricing'] }));
  const sum = s.summary('acme');
  A.eq(sum.total, 2, 'two entries');
  A.eq(sum.byKind.note, 1, 'one note');
  A.eq(sum.byKind.research, 1, 'one research');
  A.eq(sum.tags[0].tag, 'pricing', 'the most-used tag is first');
}

/* ---------- P6 + forget/clear ---------- */
{
  const { s } = store();
  s.add('acme', entry('note', 'A', 'alpha', 'x'));
  s.add('beta', entry('note', 'B', 'alpha', 'y'));
  A.eq(s.count('acme'), 1, 'count is per business');
  A.eq(s.retrieve('acme', { query: 'alpha' }).hits.length, 1, 'acme cannot retrieve beta\'s knowledge');
  A.eq(s.forget('nope'), { ok: true, removed: 0 }, 'forgetting an unknown id is a no-op that says so');
  s.clear('acme');
  A.eq(s.count('acme'), 0, 'acme is cleared');
  A.eq(s.count('beta'), 1, 'beta is untouched');
}

/* ---------- persist-before-commit ---------- */
{
  let boom = false;
  const s = G.makeBusinessKnowledge({ records: [], persist: () => { if (boom) throw new Error('denied'); }, now: () => 1000 });
  s.add('acme', entry('note', 'A', 'b', 'x'));
  boom = true;
  A.eq(s.add('acme', entry('note', 'B', 'c', 'y')).ok, false, 'an add whose persist throws returns ok:false');
  A.eq(s.count('acme'), 1, 'memory is unchanged');
}

A.report('business-knowledge');
