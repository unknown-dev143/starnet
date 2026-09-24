'use strict';
/* test/business-permissions.test.js — the §13 action permission system + the §26 Proposed Action block.

   The load-bearing properties (this module's whole reason to exist is that these cannot be talked around):
     · an action the module has NOT classified is treated as the MOST restrictive tier, never as safe;
     · `restricted` is NEVER auto-grantable — no input can produce a grant set with it set;
     · a restricted action is refused even if a caller claims a grant for it;
     · §26's Proposed Action is REFUSED without a what, a why, or evidence — and evidence that is entirely
       `unknown` does not count (P1: an unjustified action must not be presented as justified);
     · the evidence vocabulary is the SAME one opportunities-store uses (one definition, P4). */
const A = require('./_assert.js');
const P = require('../sidecar/business-permissions.js');
const OPP = require('../sidecar/opportunities-store.js');

/* ---------- §13's three tiers ---------- */
{
  A.eq(P.TIERS, ['safe', 'review', 'restricted'], 'the three tiers are §13\'s three, in §13\'s order');
  A.eq(P.TIER_NOTES.safe, 'runs automatically', 'safe = runs automatically (§13)');
  A.eq(P.TIER_NOTES.review, 'needs your approval', 'review = needs user approval (§13)');
  A.eq(P.TIER_NOTES.restricted, 'cannot run without explicit authorization and safeguards', 'restricted = explicit authorization and safeguards (§13)');
}

/* ---------- §13's named actions are all present and classified ---------- */
{
  // §13 lists exactly these as "actions requiring review include: …".
  for (const id of ['spend_money', 'external_comms', 'publish_content', 'change_infra', 'delete_data', 'access_sensitive', 'legal_commitment']) {
    const c = P.classify(id);
    A.ok(c.ok, id + ' is classified');
    A.ok(c.tier === 'review' || c.tier === 'restricted', id + ' is at least review (§13)');
  }
  // the irreversible / high-stakes ones are promoted to restricted.
  for (const id of ['change_infra', 'delete_data', 'access_sensitive', 'legal_commitment']) {
    A.eq(P.classify(id).tier, 'restricted', id + ' is restricted');
  }
  for (const id of ['spend_money', 'external_comms', 'publish_content']) {
    A.eq(P.classify(id).tier, 'review', id + ' is review');
  }
  // the read/draft class is safe.
  for (const id of ['research', 'draft', 'analyze', 'plan', 'read_local', 'report']) {
    A.eq(P.classify(id).tier, 'safe', id + ' is safe');
  }
  A.eq(P.ACTION_IDS.length, P.ACTIONS.length, 'ACTION_IDS covers the whole catalogue');
  A.eq(new Set(P.ACTION_IDS).size, P.ACTION_IDS.length, 'action ids are unique');
}

/* ---------- THE HARD FLOOR 1: an unclassified action is never safe ---------- */
{
  const c = P.classify('nuke_everything');
  A.eq(c.ok, false, 'an unknown action is not "classified"');
  A.eq(c.tier, 'restricted', 'an unknown action defaults to the MOST restrictive tier, never safe');
  A.ok(/never as safe/.test(c.reason), 'the refusal explains the fail-closed rule');
  A.ok(c.reason.indexOf('research') >= 0, 'the refusal lists what it DOES know');

  // and decide() agrees: an unknown action is refused.
  const d = P.decide({ action: 'nuke_everything', grants: { safe: true, review: true } });
  A.eq(d.allow, false, 'an unknown action is not allowed even with every grant');
  A.eq(d.approval, 'required', 'an unknown action requires approval');

  A.eq(P.classify('').ok, false, 'an empty action is unclassified');
  A.eq(P.classify(null).ok, false, 'a null action is unclassified');
}

/* ---------- THE HARD FLOOR 2: restricted is never auto-grantable ---------- */
{
  A.eq(P.DEFAULT_GRANTS, { safe: true, review: false, restricted: false }, 'a new agent may run safe actions only');
  A.eq(P.sanitizeGrants({ restricted: true }).restricted, false, 'a request to grant restricted is ignored');
  A.eq(P.sanitizeGrants({ safe: true, review: true, restricted: true }), { safe: true, review: true, restricted: false },
    'restricted is stripped while the other tiers pass through');
  A.eq(P.sanitizeGrants({}, { safe: true, review: false, restricted: true }).restricted, false,
    'even a poisoned BASE cannot carry restricted through');
  A.eq(P.sanitizeGrants(null).restricted, false, 'a null grant set cannot carry restricted');
  A.eq(P.sanitizeGrants({ restricted: 'yes' }).restricted, false, 'a truthy string cannot carry restricted');

  // a restricted action is refused even when the caller claims the grant.
  const d = P.decide({ action: 'delete_data', grants: { safe: true, review: true, restricted: true } });
  A.eq(d.allow, false, 'a restricted action is never allowed unattended');
  A.eq(d.approval, 'required', 'a restricted action always requires approval');
  A.eq(d.tier, 'restricted', 'the decision reports the restricted tier');
}

/* ---------- the ladder: safe / review ---------- */
{
  A.eq(P.decide({ action: 'research' }).allow, true, 'a safe action runs automatically by default');
  A.eq(P.decide({ action: 'research' }).approval, 'not-required', 'a safe action needs no approval');

  const noSafe = P.decide({ action: 'research', grants: { safe: false } });
  A.eq(noSafe.allow, false, 'an agent with no safe grant runs nothing');
  A.eq(noSafe.approval, 'required', 'and therefore needs approval');

  const rev = P.decide({ action: 'spend_money' });
  A.eq(rev.allow, false, 'a review action is not auto-run by default');
  A.eq(rev.approval, 'required', 'a review action requires approval by default');
  A.eq(rev.tier, 'review', 'the decision reports the review tier');

  const revGranted = P.decide({ action: 'spend_money', grants: { safe: true, review: true } });
  A.eq(revGranted.allow, true, 'a review action runs unattended once the agent is granted review');
  A.eq(revGranted.approval, 'not-required', 'and then needs no approval');

  A.eq(P.decide({}).allow, false, 'a decision with no action is refused');
}

/* ---------- §26 Proposed Action ---------- */
{
  const good = P.proposedAction({
    what: 'Send the launch email to 400 subscribers',
    why: 'The waitlist is warm and the product ships today',
    evidence: [{ text: '412 waitlist signups', evidence: 'verified', source: 'signup store' }],
    risk: 'medium',
    effect: 'First cohort onboards this week',
    action: 'external_comms'
  });
  A.ok(good.ok, 'a complete proposal is accepted');
  A.eq(good.block.approval, 'required', 'an external communication needs approval (§13)');
  A.eq(good.block.tier, 'review', 'the block reports the tier');
  A.eq(good.block.risk, 'medium', 'the block carries the stated risk');
  A.eq(good.block.evidence.length, 1, 'the block carries the evidence');

  A.eq(P.proposedAction({ why: 'x', evidence: [{ text: 't', evidence: 'verified' }], risk: 'low' }).ok, false, 'no "what" is refused');
  A.eq(P.proposedAction({ what: 'x', evidence: [{ text: 't', evidence: 'verified' }], risk: 'low' }).ok, false, 'no "why" is refused');
  A.eq(P.proposedAction({ what: 'x', why: 'y', risk: 'low' }).ok, false, 'no evidence at all is refused (P1)');
  A.eq(P.proposedAction({ what: 'x', why: 'y', evidence: [], risk: 'low' }).ok, false, 'an empty evidence list is refused');
  A.eq(P.proposedAction({ what: 'x', why: 'y', evidence: [{ text: '   ' }], risk: 'low' }).ok, false, 'evidence with no text is refused');
  // P1: evidence that is ENTIRELY unknown does not justify an action.
  A.eq(P.proposedAction({ what: 'x', why: 'y', evidence: [{ text: 't', evidence: 'unknown' }], risk: 'low' }).ok, false,
    'evidence that is entirely unknown does not count as justification');
  A.eq(P.proposedAction({ what: 'x', why: 'y', evidence: [{ text: 't', evidence: 'verified' }], risk: 'nope' }).ok, false,
    'an invalid risk is refused');
  A.eq(P.proposedAction({ what: 'x', why: 'y', evidence: [{ text: 't', evidence: 'verified' }], risk: 'low' }).ok, true,
    'a minimal but justified proposal is accepted');

  // an invalid evidence CLASS is labelled 'unknown' rather than silently accepted as real.
  const norm = P.normalizeEvidence([{ text: 't', evidence: 'made-up' }, 'plain string']);
  A.eq(norm[0].evidence, 'unknown', 'an unrecognised evidence class is labelled unknown');
  A.eq(norm[1].evidence, 'unknown', 'a bare string is treated as unlabelled');
  A.eq(norm.length, 2, 'both items survive normalisation');
}

/* ---------- one evidence vocabulary (P4) ---------- */
{
  A.eq(P.EVIDENCE, OPP.EVIDENCE, 'the evidence classes are the SAME ones opportunities-store uses — one definition');
  A.eq(P.EVIDENCE, ['verified', 'analysis', 'assumption', 'estimate', 'prediction', 'unknown'], 'and they are §4\'s six classes');
}

/* ---------- the catalogue the UI renders ---------- */
{
  const cat = P.catalog();
  A.eq(cat.length, 3, 'the catalogue is grouped into three tiers');
  A.eq(cat.map(g => g.tier), ['safe', 'review', 'restricted'], 'in §13 order');
  for (const g of cat) {
    A.ok(g.actions.length > 0, g.tier + ' has actions');
    for (const a of g.actions) A.eq(a.tier, g.tier, a.id + ' is filed under its own tier');
  }
  A.eq(cat.reduce((n, g) => n + g.actions.length, 0), P.ACTIONS.length, 'every action appears exactly once');
  A.eq(P.byId('spend_money').label, 'Spend money', 'byId resolves a label');
  A.eq(P.byId('nope'), null, 'byId returns null for an unknown action');
}

A.report('business-permissions');
