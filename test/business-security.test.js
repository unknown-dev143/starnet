'use strict';
/* business-security.test.js — §13's SECURITY CENTER engine (Business OS Phase 10).

   What this suite is actually protecting: the gap §6 item 6 named was a MISSING VIEW, so the risk is not a
   crash — it is a view that flatters. Every assertion below is about the view staying honest:

     • no score, no grade, no invented verdict
     • "held by nobody" is a real, named fact — and `restricted` is structurally un-grantable, not a hole
     • an unreadable source is reported as unavailable, NEVER as zero
     • the grant->action mapping follows the permissions module's real semantics (TIER-keyed), so the view
       cannot claim an authority the engine would refuse                                                        */

const A = require('./_assert.js');
const { makeBusinessSecurity, holdersByAction, capabilitySummary, tierRows, agentRows, AUDIT_PREVIEW } =
  require('../sidecar/business-security.js');
const P = require('../sidecar/business-permissions.js');

/* ---------- the arithmetic: TIER grants map onto the actions they unlock ---------- */
{
  const holders = holdersByAction([
    { id: 'a1', name: 'Atlas', role: 'ceo', grants: { safe: true, review: false } },
    { id: 'a2', name: 'Vega', role: 'finance', grants: { safe: true, review: true } }
  ]);
  // Atlas holds safe only -> every safe action, no review action. BOTH seats hold safe, so a safe action
  // is held by both; the naming is what matters, not the arity.
  A.eq(holders.research.length, 2, 'a safe action is held by every safe-holding seat');
  A.eq(holders.spend_money.length, 1, 'only the review-holding seat holds a review action');
  A.ok(holders.spend_money[0].indexOf('Vega') === 0, 'the holder is NAMED, not just counted');
  A.ok(holders.research[0].indexOf('Atlas') === 0, 'and the safe holder is named too');
  // restricted is never in the map at all — the permissions module forces that grant false on read.
  A.eq(holders.delete_data, undefined, 'a restricted action has no holders, however the row was written');
  A.eq(holders.access_sensitive, undefined, 'access_sensitive (restricted) has no holders');
}

/* a hand-edited row claiming {restricted:true} must NOT create a holder — the view cannot out-run the gate */
{
  const holders = holdersByAction([
    { id: 'evil', name: 'Tampered', grants: { safe: true, review: true, restricted: true } }
  ]);
  A.eq(holders.delete_data, undefined, 'a row hand-edited to claim restricted still holds nothing restricted');
  A.ok(holders.spend_money && holders.spend_money.length === 1, 'its legitimate review hold still counts');
}

/* the mapping agrees with the authority the system actually enforces — decide() is the ground truth */
{
  const agents = [
    { id: 'a1', name: 'A', grants: { safe: true, review: false } },
    { id: 'a2', name: 'B', grants: { safe: true, review: true } }
  ];
  const holders = holdersByAction(agents);
  // for every action, the set of holders must be exactly the agents decide() would allow unattended.
  let mismatches = 0;
  for (const a of P.ACTIONS) {
    const byDecide = agents.filter(ag => P.decide({ action: a.id, grants: ag.grants }).approval === 'not-required');
    const byView = (holders[a.id] || []).length;
    if (byDecide.length !== byView) mismatches++;
  }
  A.eq(mismatches, 0, 'the holders map matches decide() for EVERY action — the view cannot overstate authority');
}

/* ---------- capability summary counts, and does not judge ---------- */
{
  const tiers = tierRows(holdersByAction([
    { id: 'a1', name: 'A', grants: { safe: true, review: true } }
  ]));
  const caps = capabilitySummary(tiers);
  const safeRow = caps.find(c => c.tier === 'safe');
  const reviewRow = caps.find(c => c.tier === 'review');
  const restrRow = caps.find(c => c.tier === 'restricted');
  A.eq(safeRow.actions, P.ACTIONS.filter(a => a.tier === 'safe').length, 'the safe tier counts all its actions');
  A.eq(safeRow.held, safeRow.actions, 'holding safe holds every safe action');
  A.eq(reviewRow.held, reviewRow.actions, 'holding review holds every review action');
  A.eq(restrRow.held, 0, 'restricted holds nothing');
  A.eq(restrRow.neverGrantable, restrRow.actions, 'every restricted action is marked neverGrantable');
  A.ok(safeRow.note && safeRow.note.length > 0, 'each tier carries the §13 note, not just a number');
}

/* ---------- agentRows reports what a seat holds, and says restricted is impossible ---------- */
{
  const rows = agentRows([
    { id: 'a1', name: 'Atlas', role: 'ceo', grants: { safe: true, review: false } },
    { id: 'a2', name: 'Vega', role: 'finance', grants: { safe: true, review: true } }
  ], {});
  A.eq(rows[0].holdsReview, false, 'a safe-only seat does not hold review');
  A.eq(rows[1].holdsReview, true, 'a review seat says so');
  A.eq(rows[0].holdsRestricted, false, 'no seat holds restricted');
  A.ok(rows[0].heldCount > 0, 'a safe seat holds a non-empty set of actions');
  A.ok(rows[1].heldCount > rows[0].heldCount, 'the review seat holds strictly more (safe + review)');
}

/* a seat holding NOTHING reads as holding nothing — a true fact, not a blank */
{
  const rows = agentRows([{ id: 'a1', name: 'Idle', grants: { safe: false, review: false } }], {});
  A.eq(rows[0].heldCount, 0, 'a seat with no grants holds no actions');
  A.eq(rows[0].heldActions.length, 0, 'and its action list is empty, not absent');
  A.eq(rows[0].holdsReview, false, 'and it holds no review authority');
}

/* ---------- overview: the combined read ---------- */
function mk(over) {
  return makeBusinessSecurity(Object.assign({
    agents: () => [],
    activity: () => [],
    pending: () => 0
  }, over || {}));
}

{
  const sec = mk({
    agents: () => [{ id: 'a1', name: 'Atlas', role: 'ceo', grants: { safe: true, review: false } }],
    activity: () => ([
      { id: 'r1', at: 100, actor: { kind: 'user' }, action: 'research', result: 'ok', approval: 'not-required', name: 'x' },
      { id: 'r2', at: 200, actor: { kind: 'agent', name: 'Atlas' }, action: 'spend_money', result: 'pending', approval: 'required', reason: 'over budget' }
    ]),
    pending: () => 1
  });
  const o = sec.overview('acme');
  A.ok(o.ok === true, 'overview succeeds for a real business id');
  A.eq(o.businessId, 'acme', 'the read is scoped to the id asked for');
  A.eq(o.totals.actions, P.ACTIONS.length, 'every §13 action appears in the tier table');
  A.eq(o.agentCount, 1, 'the seat count is reported');

  // no score / no grade — the honesty rule this view most needs
  const flat = JSON.stringify(o).toLowerCase();
  A.ok(flat.indexOf('"score"') < 0, 'there is NO score field — a security score would be invented');
  A.ok(flat.indexOf('"grade"') < 0 && flat.indexOf('"risklevel"') < 0 && flat.indexOf('rating') < 0,
    'no grade, no risk level, no rating');

  // decisions are the AUTHORITY slice, newest first, and spend_money qualifies (review tier)
  A.eq(o.decisions[0].id, 'r2', 'the authority decisions are newest-first');
  A.eq(o.decisions[0].aboutAuthority, true, 'a review-tier action IS an authority decision');
  A.eq(o.decisions[1].aboutAuthority, false, 'an ordinary safe action is NOT an authority decision');
  A.eq(o.decisions[0].actionLabel, P.ACTIONS.find(a => a.id === 'spend_money').label, 'the action is labelled, not raw');
  A.eq(o.decisions[0].tier, 'review', 'the tier is carried onto the decision row');
}

/* ---------- HONESTY: an unreadable source is unavailable, never zero ---------- */
{
  const sec = mk({ pending: () => { throw new Error('approvals store down'); } });
  const o = sec.overview('acme');
  A.eq(o.pendingApprovals, null, 'an unreadable approvals source reports null — NOT 0');
  A.eq(o.availability.approvals, false, 'and the availability flag says so');
  A.ok(/unavailable|never as zero/i.test(o.note), 'the note explains the rule');
}
{
  const sec = mk({ agents: () => { throw new Error('agents store down'); } });
  const o = sec.overview('acme');
  A.eq(o.availability.agents, false, 'an unreadable agents store is flagged unavailable');
  A.eq(o.agentCount, 0, 'and yields no seats');
  A.ok(o.totals.held === 0, 'and nothing reads as held');
}
{
  const sec = mk({ activity: () => { throw new Error('trail down'); } });
  const o = sec.overview('acme');
  A.eq(o.availability.audit, false, 'an unreadable audit source is flagged unavailable');
  A.eq(o.decisionCount, 0, 'and yields no decisions');
}
/* a PENDING COUNT OF 0 IS REAL and must not be confused with "unread" */
{
  const sec = mk({ pending: () => 0 });
  const o = sec.overview('acme');
  A.eq(o.pendingApprovals, 0, 'a real zero is reported as zero');
  A.eq(o.availability.approvals, true, 'and the source is marked available');
}

/* ---------- the businessId is required — isolation is by key, never implied ---------- */
{
  const sec = mk();
  A.eq(sec.overview('').ok, false, 'an empty businessId is refused');
  A.eq(sec.overview(null).ok, false, 'a null businessId is refused');
  A.ok(/isolation/.test(sec.overview('').reason), 'and the refusal names the isolation rule');
  A.eq(sec.audit('').ok, false, 'audit refuses an empty id too');
}

/* ---------- audit() slice ---------- */
{
  const sec = mk({
    activity: () => ([
      { id: 'r1', at: 10, actor: { kind: 'user' }, action: 'research', result: 'ok' },
      { id: 'r2', at: 20, actor: { kind: 'system' }, action: 'delete_data', result: 'error', approval: 'denied', reason: 'refused — restricted' }
    ])
  });
  const a = sec.audit('acme', { limit: 5 });
  A.ok(a.ok === true && a.readable === true, 'the audit slice is readable');
  A.eq(a.rows.length, 2, 'both rows come back');
  A.eq(a.rows[1].tier, 'restricted', 'a restricted action carries its tier');
  A.ok(/restricted/.test(a.rows[1].reason), 'the refusal reason is preserved verbatim');
}
/* an unreadable trail in audit() returns ok:true + readable:false — the request succeeded, the read did not */
{
  const sec = mk({ activity: () => { throw new Error('down'); } });
  const a = sec.audit('acme', {});
  A.eq(a.ok, true, 'the request itself still succeeded');
  A.eq(a.readable, false, 'but the read is flagged unreadable');
  A.eq(a.rows.length, 0, 'with no rows');
}
/* a row with no timestamp must not sort as "now" (which would put an undated row on top) */
{
  const sec = mk({
    activity: () => ([
      { id: 'old', at: null, actor: { kind: 'system' }, action: 'research', result: 'ok' },
      { id: 'new', at: 500, actor: { kind: 'user' }, action: 'research', result: 'ok' }
    ])
  });
  const o = sec.overview('acme');
  A.eq(o.decisions[0].id, 'new', 'a dated row sorts above an undated one');
  A.eq(o.decisions[0].at, 500, 'the real timestamp is kept');
}

/* ---------- catalog() is the POLICY, not the state ---------- */
{
  const sec = mk();
  const c = sec.catalog();
  A.eq(c.tiers.length, P.TIERS.length, 'the catalog lists every tier');
  A.ok(c.defaultGrants && typeof c.defaultGrants.safe === 'boolean', 'the default grants are tier-keyed');
  A.ok(Array.isArray(c.risks) && c.risks.length > 0, 'the risk vocabulary is exposed');
  A.ok(Array.isArray(c.evidence) && c.evidence.length > 0, 'the evidence vocabulary is exposed');
  const flat = JSON.stringify(c).toLowerCase();
  A.ok(flat.indexOf('heldby') < 0, 'the POLICY read carries no holders — policy and state are separate reads');
}

/* ---------- bounds ---------- */
{
  A.ok(AUDIT_PREVIEW > 0 && AUDIT_PREVIEW <= 50, 'the preview is a sane, small number');
  const sec = mk({
    activity: (b, o) => {
      A.ok(o && Number.isFinite(o.limit) && o.limit === AUDIT_PREVIEW, 'overview asks the store for exactly the preview size');
      return [];
    }
  });
  sec.overview('acme');
}

/* ---------- host-safety: a throwing accessor or a hostile row cannot crash the view ---------- */
{
  const sec = mk({ activity: () => [null, undefined, { id: 'r' }] });
  A.ok(sec.overview('acme').ok === true, 'junk rows do not crash the view');
}
{
  const sec = makeBusinessSecurity({
    agents: () => [{ id: 'a', grants: null }, { id: 'b' }],
    activity: () => [],
    pending: null
  });
  const o = sec.overview('acme');
  A.ok(o.ok === true, 'an absent grants object is survived');
  A.eq(o.availability.approvals, false, 'a null pending accessor reports approvals as unavailable');
}
/* no injected sources at all — must not throw */
{
  const sec = makeBusinessSecurity({});
  A.ok(sec.overview('acme').ok === true, 'the engine works with no sources injected');
}

/* ---------- determinism: the same inputs give byte-identical output ---------- */
{
  const build = () => mk({
    agents: () => [
      { id: 'a2', name: 'B', grants: { safe: true, review: true } },
      { id: 'a1', name: 'A', grants: { safe: true, review: false } }
    ],
    activity: () => ([{ id: 'r1', at: 1, actor: { kind: 'user' }, action: 'research', result: 'ok', approval: 'required' }]),
    pending: () => 3
  });
  A.eq(JSON.stringify(build().overview('acme')), JSON.stringify(build().overview('acme')),
    'two identical reads serialise identically');
  // holders are sorted, so source ORDER cannot change the output
  const sec = build();
  A.eq(JSON.stringify(sec.overview('acme').tiers), JSON.stringify(sec.overview('acme').tiers),
    'tiers are stable across calls');
}

A.report('security-center');
