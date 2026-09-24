'use strict';
/* test/business-crm-store.test.js — the §16 CRM (Business OS Phase 4).

   THE load-bearing property: "needs attention" is TWO NAMED RULES applied to stored facts — an overdue
   follow-up, and no logged interaction in the last QUIET_DAYS days — each row carrying the rule that fired
   and its raw inputs (daysLate / daysQuiet). There is no lead score, no ranking, no verdict (P7).

   Also locked: a contact's interactions and follow-ups embed in the contact; logInteraction/addFollowUp
   REFUSE a businessId that differs from the contact's (P6); removeContact refuses while a follow-up is open;
   a follow-up id is <contactId>~u<n>. */
const A = require('./_assert.js');
const C = require('../sidecar/business-crm-store.js');

function store(extra) {
  const saved = [];
  const s = C.makeBusinessCrmStore(Object.assign({
    records: [], persist: (rows) => { saved.length = 0; for (const r of rows) saved.push(r); }, now: () => 1000
  }, extra || {}));
  return { s, saved };
}
const DAY = 86400000;

/* ---------- the vocabularies ---------- */
{
  A.eq(C.STAGES, ['lead', 'prospect', 'customer', 'churned'], 'the four §16 stages');
  A.eq(C.INTERACTION_KINDS, ['email', 'call', 'meeting', 'message', 'note', 'purchase', 'support'], 'the interaction kinds');
  A.eq(C.QUIET_DAYS, 30, 'QUIET_DAYS is 30');
}

/* ---------- addContact validation + id ---------- */
{
  const { s } = store();
  A.eq(s.addContact('', { name: 'X' }).ok, false, 'no businessId -> refused');
  A.eq(s.addContact('acme', {}).ok, false, 'a contact needs a name');
  A.eq(s.addContact('acme', { name: 'X', stage: 'nope' }).ok, false, 'an unknown stage is refused');
  const c = s.addContact('acme', { name: 'Dana', email: 'd@x.io', org: 'Acme' });
  A.eq(c.contact.id, 'acme~c1', 'the id is <businessId>~c<seq>');
  A.ok(c.contact.id.indexOf('#') < 0, 'and never contains a #');
  A.eq(c.contact.stage, 'lead', 'a new contact starts at lead');
  A.eq(c.contact.interactions, [], 'with no interactions yet');
}

/* ================= THE HEADLINE: two named rules, with their inputs ================= */
{
  const { s } = store();
  const now = 100 * DAY;
  // a contact created long ago with no interaction -> the QUIET rule
  const quietId = s.addContact('acme', { name: 'Quiet' }).contact.id;
  // a contact with an overdue follow-up -> the OVERDUE rule
  const odId = s.addContact('acme', { name: 'Overdue' }).contact.id;
  s.addFollowUp('acme', odId, { what: 'send quote', dueAt: now - 5 * DAY });

  const na = s.needsAttention('acme', now);
  A.eq(na.quietDays, 30, 'the window is reported');
  A.eq(na.rules.length, 2, 'TWO rules are named, verbatim');
  A.ok(/overdue-follow-up/.test(na.rules[0]), 'rule 1 is the overdue follow-up');
  A.ok(/no-recent-interaction/.test(na.rules[1]), 'rule 2 is the quiet contact');
  A.eq(na.overdue.length, 1, 'one overdue row fired');
  A.eq(na.overdue[0].contactId, odId, 'and it names the contact');
  A.eq(na.overdue[0].rule, 'overdue-follow-up', 'the row carries the rule that fired');
  A.eq(na.overdue[0].daysLate, 5, 'and its raw input (daysLate)');
  A.ok(na.quiet.length >= 1, 'the quiet rule fired for a contact with no interaction');
  A.eq(na.quiet[0].rule, 'no-recent-interaction', 'and that row carries its rule too');
  A.ok(typeof na.quiet[0].daysQuiet === 'number', 'with daysQuiet as an input');
  A.ok(!/score|rank|priority|verdict/i.test(JSON.stringify(na)), 'nothing here is a score, a rank or a verdict');
}

/* ---------- a fresh interaction silences the quiet rule ---------- */
{
  const { s } = store();
  const now = 100 * DAY;
  const id = s.addContact('acme', { name: 'Fresh' }).contact.id;
  A.eq(s.logInteraction('acme', id, { kind: 'call', summary: 'spoke', at: now - DAY }).ok, true, 'an interaction is logged');
  const na = s.needsAttention('acme', now);
  A.eq(na.quiet.length, 0, 'a contact touched yesterday does not fire the quiet rule');
}

/* ---------- logging + follow-up validation ---------- */
{
  const { s } = store();
  const id = s.addContact('acme', { name: 'X' }).contact.id;
  A.eq(s.logInteraction('acme', id, { kind: 'nope', summary: 'x' }).ok, false, 'an unknown interaction kind is refused');
  A.eq(s.logInteraction('acme', id, { kind: 'call', summary: '  ' }).ok, false, 'an interaction needs a summary');
  A.eq(s.logInteraction('acme', 'ghost', { summary: 'x' }).ok, false, 'logging against an unknown contact is refused');
  A.eq(s.addFollowUp('acme', id, { what: '' }).ok, false, 'a follow-up needs to say what it is');
  A.eq(s.addFollowUp('acme', id, { what: 'x', dueAt: -1 }).ok, false, 'a negative dueAt is refused');

  const f = s.addFollowUp('acme', id, { what: 'send quote', dueAt: 5000 });
  A.ok(/~u1$/.test(f.followUp.id), 'the follow-up id is <contactId>~u<n>');
  A.eq(s.openFollowUps('acme').length, 1, 'it shows as open');
  A.eq(s.completeFollowUp('acme', f.followUp.id).ok, true, 'completing it succeeds');
  A.eq(s.completeFollowUp('acme', f.followUp.id).ok, false, 'completing it twice is refused');
  A.eq(s.openFollowUps('acme').length, 0, 'and it is no longer open');
}

/* ---------- P6: a cross-business interaction / follow-up is REFUSED ---------- */
{
  const { s } = store();
  const id = s.addContact('acme', { name: 'X' }).contact.id;
  const bad = s.logInteraction('beta', id, { summary: 'x' });
  A.eq(bad.ok, false, 'logging an interaction under the WRONG business is refused');
  A.ok(/cross-business/.test(bad.reason), 'and says it is a cross-business attempt (P6)');
  const bad2 = s.addFollowUp('beta', id, { what: 'x' });
  A.eq(bad2.ok, false, 'adding a follow-up under the wrong business is refused too');
  A.eq(s.contact(id).interactions.length, 0, 'nothing was written to the contact');
}

/* ---------- removeContact refuses while a follow-up is open ---------- */
{
  const { s } = store();
  const id = s.addContact('acme', { name: 'X' }).contact.id;
  s.addFollowUp('acme', id, { what: 'call back' });
  const denied = s.removeContact(id);
  A.eq(denied.ok, false, 'removing a contact with an open follow-up is refused');
  A.ok(/open follow-up/.test(denied.reason), 'and says why');
  s.completeFollowUp('acme', s.openFollowUps('acme')[0].followUp.id);
  A.eq(s.removeContact(id).ok, true, 'once the follow-up is closed, removal succeeds');
  A.eq(s.removeContact('ghost'), { ok: true, removed: 0 }, 'removing an unknown id is a no-op that says so');
}

/* ---------- summary counts stages / interactions / open follow-ups ---------- */
{
  const { s } = store();
  const id = s.addContact('acme', { name: 'X', stage: 'customer' }).contact.id;
  s.logInteraction('acme', id, { kind: 'email', summary: 'hi' });
  s.addFollowUp('acme', id, { what: 'y' });
  const sum = s.summary('acme');
  A.eq(sum.total, 1, 'one contact');
  A.eq(sum.byStage.customer, 1, 'counted in its stage');
  A.eq(sum.byStage.lead, 0, 'an absent stage counts zero');
  A.eq(sum.interactions.email, 1, 'the interaction is counted by kind');
  A.eq(sum.openFollowUps, 1, 'the open follow-up is counted');
}

/* ---------- P6 + clear ---------- */
{
  const { s } = store();
  s.addContact('acme', { name: 'A' });
  s.addContact('beta', { name: 'B' });
  A.eq(s.countContacts('acme'), 1, 'count is per business');
  A.eq(s.clear('').ok, false, 'clear with no businessId is refused');
  s.clear('acme');
  A.eq(s.countContacts('acme'), 0, 'acme is cleared');
  A.eq(s.countContacts('beta'), 1, 'beta is untouched');
}

/* ---------- persist-before-commit ---------- */
{
  let boom = false;
  const s = C.makeBusinessCrmStore({ records: [], persist: () => { if (boom) throw new Error('denied'); }, now: () => 1000 });
  s.addContact('acme', { name: 'A' });
  boom = true;
  A.eq(s.addContact('acme', { name: 'B' }).ok, false, 'a create whose persist throws returns ok:false');
  A.eq(s.countContacts('acme'), 1, 'memory is unchanged');
}

A.report('business-crm-store');
