'use strict';
/* test/business-documents-store.test.js — the §15 DOCUMENT GENERATOR (Business OS Phase 4).

   THE load-bearing property: a document REFERENCES a run output (deliverableId) rather than COPYING it. A row
   has no `files` field — a document is the business's own written artifact, and a Workshop build stays owned
   by deliverable-store.js (keyed by agentId/runId). Copying bytes here would fork the two and let them drift.

   Also locked: a document needs BODY or a deliverableId (a title with nothing behind it is an empty promise);
   §15's 11 types are closed; search is a case-insensitive substring returning matchedIn + a context excerpt,
   never a relevance score (P7). */
const A = require('./_assert.js');
const D = require('../sidecar/business-documents-store.js');

function store(extra) {
  const saved = [];
  const s = D.makeBusinessDocumentsStore(Object.assign({
    records: [], persist: (rows) => { saved.length = 0; for (const r of rows) saved.push(r); }, now: () => 1000
  }, extra || {}));
  return { s, saved };
}

/* ---------- the vocabularies ---------- */
{
  A.eq(D.TYPES.length, 11, '§15 names eleven document types');
  A.eq(D.TYPES, ['business-plan', 'product-spec', 'research-report', 'marketing-plan', 'sop', 'meeting-notes', 'investor-document', 'technical-doc', 'customer-doc', 'policy', 'report'], 'the types match §15 in order');
  A.eq(D.STATUSES, ['draft', 'final'], 'two states: draft and final');
}

/* ---------- create validation + id ---------- */
{
  const { s } = store();
  A.eq(s.create('', { title: 'X', type: 'sop', body: 'b' }).ok, false, 'no businessId -> refused');
  A.eq(s.create('acme', { type: 'sop', body: 'b' }).ok, false, 'a document needs a title');
  A.eq(s.create('acme', { title: 'X', type: 'nope', body: 'b' }).ok, false, 'an unknown type is refused');
  A.ok(/business-plan/.test(s.create('acme', { title: 'X', type: 'nope', body: 'b' }).reason), 'and the refusal lists the real types');
  A.eq(s.create('acme', { title: 'X', type: 'sop' }).ok, false, 'a title with NO body and NO deliverable is refused');
  A.ok(/empty promise/.test(s.create('acme', { title: 'X', type: 'sop' }).reason), 'and says why');
  A.eq(s.create('acme', { title: 'X', type: 'sop', deliverableId: 'run-9' }).ok, true, 'a deliverable reference alone is enough');

  const c = s.create('acme', { title: 'Runbook', type: 'sop', body: 'step one' });
  A.ok(/^acme~d\d+$/.test(c.document.id), 'the id is <businessId>~d<seq>');
  A.ok(c.document.id.indexOf('#') < 0, 'and never contains a #');
  A.eq(c.document.status, 'draft', 'a new document is a draft');
  A.eq(c.document.body, 'step one', 'the body is stored');
}

/* ================= THE HEADLINE: a document REFERENCES a run output, never copies it ================= */
{
  const { s } = store();
  const c = s.create('acme', { title: 'Spec', type: 'product-spec', deliverableId: 'run-42' });
  A.eq(c.document.deliverableId, 'run-42', 'the deliverable is referenced by id');
  A.ok(!('files' in c.document), 'the row has NO `files` field — a document does not own bytes');
  A.ok(!('file' in c.document), 'and no `file` field either');
  A.ok(!('artifacts' in c.document), 'and no `artifacts` — run outputs stay owned by deliverable-store');
}

/* ---------- search: substring, matchedIn, excerpt — never a score ---------- */
{
  const { s } = store();
  s.create('acme', { title: 'Onboarding guide', type: 'sop', body: 'nothing relevant here' });
  s.create('acme', { title: 'Other', type: 'report', body: 'the word onboarding appears in the body' });
  const hits = s.search('acme', 'onboarding');
  A.eq(hits.length, 2, 'both a title hit and a body hit are found');
  const titleHit = hits.filter(h => h.matchedIn === 'title')[0];
  A.eq(titleHit.title, 'Onboarding guide', 'the title hit is labelled matchedIn: title');
  A.eq(titleHit.excerpt, '', 'and carries no body excerpt');
  const bodyHit = hits.filter(h => h.matchedIn === 'body')[0];
  A.ok(/onboarding/.test(bodyHit.excerpt), 'the body hit carries a context excerpt around the match');
  A.eq(s.search('acme', 'zzzznomatch').length, 0, 'a no-match query returns nothing');
  A.eq(s.search('acme', '').length, 0, 'an empty query returns nothing');
  A.ok(!/score|relevance|rank/i.test(JSON.stringify(hits)), 'there is no relevance score — only matchedIn and an excerpt');
  // case-insensitive
  A.eq(s.search('acme', 'ONBOARDING').length, 2, 'the search is case-insensitive');
}

/* ---------- update: cannot blank the only content ---------- */
{
  const { s } = store();
  const id = s.create('acme', { title: 'X', type: 'sop', body: 'real content' }).document.id;
  A.eq(s.update(id, { title: '  ' }).ok, false, 'a blank title is refused');
  A.eq(s.update(id, { type: 'nope' }).ok, false, 'an unknown type is refused');
  A.eq(s.update(id, { body: '' }).ok, false, 'blanking the body (with no deliverable) is refused');
  A.eq(s.update(id, { status: 'final' }).ok, true, 'promoting to final succeeds');
  A.eq(s.document(id).status, 'final', 'and it lands');
  A.eq(s.update(id, { status: 'nope' }).ok, false, 'an unknown status is refused');
}

/* ---------- summary ---------- */
{
  const { s } = store();
  s.create('acme', { title: 'A', type: 'sop', body: 'x' });
  s.create('acme', { title: 'B', type: 'sop', body: 'y', status: 'final' });
  s.create('acme', { title: 'C', type: 'report', body: 'z' });
  const sum = s.summary('acme');
  A.eq(sum.total, 3, 'three documents');
  A.eq(sum.byType.sop, 2, 'two SOPs');
  A.eq(sum.byStatus.draft, 2, 'two drafts');
  A.eq(sum.byStatus.final, 1, 'one final');
}

/* ---------- P6 + remove/clear ---------- */
{
  const { s } = store();
  s.create('acme', { title: 'A', type: 'sop', body: 'x' });
  s.create('beta', { title: 'B', type: 'sop', body: 'y' });
  A.eq(s.count('acme'), 1, 'count is per business');
  A.eq(s.search('acme', 'B').length, 0, 'acme cannot see beta\'s documents');
  A.eq(s.remove('nope'), { ok: true, removed: 0 }, 'removing an unknown id is a no-op that says so');
  s.clear('acme');
  A.eq(s.count('acme'), 0, 'acme is cleared');
  A.eq(s.count('beta'), 1, 'beta is untouched');
}

/* ---------- persist-before-commit ---------- */
{
  let boom = false;
  const s = D.makeBusinessDocumentsStore({ records: [], persist: () => { if (boom) throw new Error('denied'); }, now: () => 1000 });
  s.create('acme', { title: 'A', type: 'sop', body: 'x' });
  boom = true;
  A.eq(s.create('acme', { title: 'B', type: 'sop', body: 'y' }).ok, false, 'a create whose persist throws returns ok:false');
  A.eq(s.count('acme'), 1, 'memory is unchanged');
}

A.report('business-documents-store');
