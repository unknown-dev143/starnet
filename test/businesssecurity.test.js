'use strict';
/* businesssecurity.test.js — the §13 SECURITY CENTER console, pure half (Business OS Phase 10).

   The console's job is to render the engine's read WITHOUT adding a verdict of its own. So the risks this
   suite guards are presentation-shaped:

     • a null (unreadable) pending count must NEVER render as 0
     • "held by nobody" must be phrased as a fact, and a restricted action as un-grantable rather than a hole
     • restricted styling must be MUTED (it is structural) while unreadable sources are LOUD
     • the console must not fetch a policy of its own — every label came off the wire                       */

const A = require('./_assert.js');
const S = require('../frontend/app/businesssecurity.js');

/* ---------- escaping: every value that reaches innerHTML goes through it ---------- */
{
  A.eq(S.esc('<b>x</b>'), '&lt;b&gt;x&lt;/b&gt;', 'tags are escaped');
  A.eq(S.esc('a"b\'c'), 'a&quot;b&#39;c', 'both quote kinds are escaped');
  A.eq(S.esc(null), '', 'null escapes to the empty string, not "null"');
  A.eq(S.esc(undefined), '', 'undefined escapes to empty');
}

/* ---------- relTime: an undated row says NOTHING rather than "1970" ---------- */
{
  A.eq(S.relTime(0), '', 'a zero timestamp renders nothing (not 1970)');
  A.eq(S.relTime(-1), '', 'the engine\'s NO_TIME sentinel renders nothing (not 1970)');
  A.eq(S.relTime(null), '', 'a null timestamp renders nothing');
  A.eq(S.relTime(1000, 1000 + 5000), 'now', 'five seconds ago reads now');
  A.eq(S.relTime(1000, 1000 + 5 * 60000), '5m', 'minutes read as m');
  A.eq(S.relTime(1000, 1000 + 3 * 3600000), '3h', 'hours read as h');
  A.eq(S.relTime(1000, 1000 + 2 * 86400000), '2d', 'days read as d');
  A.eq(S.relTime(5000, 1000), 'now', 'a clock skew does not render -4m');
}

/* ---------- tierLabel: an unknown tier is UNKNOWN, never a plausible guess ---------- */
{
  A.eq(S.tierLabel('safe'), 'SAFE', 'safe reads SAFE');
  A.eq(S.tierLabel('review'), 'REVIEW', 'review reads REVIEW');
  A.eq(S.tierLabel('restricted'), 'RESTRICTED', 'restricted reads RESTRICTED');
  A.eq(S.tierLabel('moonshot'), 'UNKNOWN', 'an unknown tier reads UNKNOWN');
  A.eq(S.tierLabel(null), 'UNKNOWN', 'a null tier reads UNKNOWN');
  A.ok(S.tierBlurb('restricted').length > 0, 'restricted carries a blurb');
}

/* ---------- shapeCounts: the null-vs-zero rule is the whole point ---------- */
{
  const c = S.shapeCounts({ totals: { actions: 13, held: 9, neverGrantable: 4, reviewActionsHeld: 1 }, agentCount: 2, pendingApprovals: 0, decisionCount: 3, availability: { approvals: true } });
  A.eq(c.held, 9, 'the held count passes through');
  A.eq(c.actions, 13, 'the action count passes through');
  A.eq(c.pending, 0, 'a REAL zero pending count is 0');
  A.eq(c.pendingReadable, true, 'and is marked readable');
}
{
  const c = S.shapeCounts({ pendingApprovals: null, availability: { approvals: false } });
  A.eq(c.pending, null, 'an UNREADABLE pending count stays null — it does NOT become 0');
  A.eq(c.pendingReadable, false, 'and is flagged unreadable');
  const c2 = S.shapeCounts({ availability: { approvals: true } });
  A.eq(c2.pending, null, 'an ABSENT pending count is also null, never a fabricated 0');
}
{
  const c = S.shapeCounts({});
  A.eq(c.held, 0, 'missing totals default to 0 counts (which is true of an empty read)');
  A.eq(c.agents, 0, 'and zero seats');
  A.eq(c.pending, null, 'but pending stays null — absence is not zero even here');
}

/* ---------- shapeCapabilities: ordered safe → review → restricted ---------- */
{
  const caps = S.shapeCapabilities([
    { tier: 'restricted', actions: 4, held: 0, neverGrantable: 4, note: 'r' },
    { tier: 'safe', actions: 6, held: 6, neverGrantable: 0, note: 's' },
    { tier: 'review', actions: 3, held: 3, neverGrantable: 0, note: 'v' }
  ], []);
  A.eq(caps.map(c => c.tier), ['safe', 'review', 'restricted'], 'tiers render in escalation order');
  A.eq(caps[0].heldText, '6 of 6 held', 'the held text is a count, not a percentage or a grade');
  A.eq(caps[2].neverGrantable, 4, 'the restricted tier carries its un-grantable count');
}
/* a tier with nothing held reads as "0 of N held" — a true fact, not a blank */
{
  const caps = S.shapeCapabilities([], []);
  A.eq(caps.length, 3, 'the three tiers always render, even when the engine sends none');
  A.ok(caps.every(c => /^0 of \d+ held$/.test(c.heldText)), 'each empty tier says so in words');
}

/* ---------- shapeActions: "held by nobody" is a statement ---------- */
{
  const rows = S.shapeActions([
    { id: 'research', label: 'Research', tier: 'safe', note: 'n', heldBy: ['Atlas (ceo)'], holderCount: 1, neverGrantable: false },
    { id: 'spend_money', label: 'Spend money', tier: 'review', note: 'n', heldBy: [], holderCount: 0, neverGrantable: false },
    { id: 'delete_data', label: 'Delete data', tier: 'restricted', note: 'n', heldBy: [], holderCount: 0, neverGrantable: true }
  ]);
  A.eq(rows.map(r => r.id), ['research', 'spend_money', 'delete_data'], 'actions group by tier in escalation order');
  A.eq(rows[0].heldText, 'Atlas (ceo)', 'a held action names its holders');
  A.eq(rows[1].heldText, 'held by nobody', 'an unheld action says so plainly');
  A.eq(rows[2].heldText, 'held by nobody — not grantable', 'a restricted action says it can never be held');
  A.eq(rows[2].neverGrantable, true, 'and is flagged structurally');
}
/* the row order is deterministic regardless of the engine's ordering */
{
  const build = () => S.shapeActions([
    { id: 'b', label: 'B', tier: 'review', heldBy: [], holderCount: 0 },
    { id: 'a', label: 'A', tier: 'safe', heldBy: [], holderCount: 0 }
  ]).map(r => r.id);
  A.eq(JSON.stringify(build()), JSON.stringify(build()), 'the same input orders identically');
  A.eq(build()[0], 'a', 'safe sorts before review');
}

/* ---------- shapeSeats: a review-holding seat is FLAGGED ---------- */
{
  const seats = S.shapeSeats([
    { id: 'a1', name: 'Atlas', role: 'ceo', grantedTiers: ['safe'], heldCount: 6, holdsReview: false },
    { id: 'a2', name: 'Vega', role: 'finance', grantedTiers: ['safe', 'review'], heldCount: 9, holdsReview: true }
  ]);
  A.eq(seats[0].holdsReview, false, 'a safe-only seat is not flagged');
  A.eq(seats[1].holdsReview, true, 'a review seat IS flagged');
  A.eq(seats[1].grantedTiers, ['SAFE', 'REVIEW'], 'the granted tiers are labelled for display');
  A.eq(seats[0].heldText, '6 capabilities', 'a non-empty held set is described');
  A.eq(S.shapeSeats([{ id: 'x', name: 'Idle', heldCount: 0, grantedTiers: [] }])[0].heldText, 'no capabilities',
    'a seat holding nothing says so');
  A.eq(S.shapeSeats([{ id: 'x', heldCount: 1 }])[0].heldText, '1 capability', 'the singular is correct');
  A.eq(S.shapeSeats([{ id: 'x' }])[0].name, '(unnamed seat)', 'an unnamed seat is labelled, not blank');
}

/* ---------- shapeDecisions: aboutAuthority drives the highlight ---------- */
{
  const d = S.shapeDecisions([
    { id: 'r1', at: 100, actor: 'agent', actorName: 'Atlas', action: 'spend_money', actionLabel: 'Spend money', tier: 'review', result: 'pending', approval: 'required', reason: 'over budget', aboutAuthority: true },
    { id: 'r2', at: 50, actor: 'user', action: 'research', actionLabel: 'Research', tier: 'safe', result: 'ok', aboutAuthority: false }
  ], 100);
  A.eq(d[0].aboutAuthority, true, 'a review-tier action is marked as an authority decision');
  A.eq(d[0].tierLabel, 'REVIEW', 'the tier label is present');
  A.eq(d[1].aboutAuthority, false, 'an ordinary safe action is not');
  A.eq(d[0].when, 'now', 'the timestamp is rendered relative');
}

/* ---------- shapeOverview: one entry point, no derivation left for mount ---------- */
{
  const o = S.shapeOverview({
    ok: true, businessId: 'acme',
    totals: { actions: 13, held: 9, neverGrantable: 4, reviewActionsHeld: 1 },
    agentCount: 2, pendingApprovals: null, decisionCount: 1,
    availability: { agents: true, audit: false, approvals: false },
    tiers: [], agents: [], decisions: [], capabilities: [], note: 'n'
  }, 100);
  A.eq(o.ok, true, 'ok passes through');
  A.eq(o.businessId, 'acme', 'the id passes through');
  A.eq(o.counts.pending, null, 'the null pending survives shaping');
  A.eq(o.availability.audit, false, 'an unreadable audit stays flagged after shaping');
  A.ok(Array.isArray(o.actions) && Array.isArray(o.seats), 'the shapes are arrays even when empty');
}
/* ok:false is preserved so a refusal is not rendered as an empty-but-fine view */
{
  A.eq(S.shapeOverview({ ok: false, reason: 'nope' }).ok, false, 'an ok:false read stays ok:false');
  A.ok(S.shapeOverview(null).ok === false, 'a null read is NOT ok — never a clean empty view');
}

/* ---------- availabilityWarnings: an unreadable source is LOUD ---------- */
{
  const warns = S.availabilityWarnings(S.shapeOverview({ availability: { agents: false, audit: false, approvals: false } }));
  A.eq(warns.length, 3, 'one warning per unreadable source');
  A.ok(warns.some(w => /not zero/i.test(w)), 'the approvals warning says the count is unknown, NOT zero');
  A.ok(warns.some(w => /incomplete/i.test(w)), 'the seat warning says the table is incomplete');
  // a fully readable read warns about nothing
  A.eq(S.availabilityWarnings(S.shapeOverview({ availability: { agents: true, audit: true, approvals: true } })).length, 0,
    'a fully readable read produces no warnings');
}

/* ---------- clampNotice ---------- */
{
  A.eq(S.clampNotice({ limitClamped: { asked: 9999, applied: 200, max: 200 } }),
    'showing the most recent 200 (you asked for 9999; the maximum is 200)', 'the clamp is spelled out');
  A.eq(S.clampNotice({}), '', 'no clamp -> no notice');
  A.eq(S.clampNotice(null), '', 'a null audit -> no notice');
}

/* ---------- shapeAudit ---------- */
{
  const a = S.shapeAudit({ ok: true, readable: true, rows: [{ id: 'r1', at: 100, actor: 'agent', actorName: 'A', actionLabel: 'Research', result: 'ok' }] }, 100);
  A.eq(a.readable, true, 'a readable audit says so');
  A.eq(a.rows[0].actionLabel, 'Research', 'the labelled action is carried');
  A.eq(a.rows[0].when, 'now', 'the row is time-rendered');
}
{
  const a = S.shapeAudit({ ok: true, readable: false, rows: [] });
  A.eq(a.readable, false, 'an unreadable audit stays unreadable through shaping');
}
/* a row with no timestamp does not become "now" — it renders nothing */
{
  const a = S.shapeAudit({ ok: true, readable: true, rows: [{ id: 'r', at: -1, actionLabel: 'X' }] }, 100);
  A.eq(a.rows[0].when, '', 'an undated row renders an empty time, not "now" and not "1970"');
}

/* ---------- the console holds NO policy of its own ---------- */
{
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'frontend', 'app', 'businesssecurity.js'), 'utf8');
  // it must not hardcode the action ids or the tier notes — those all come off the wire
  A.ok(src.indexOf('spend_money') < 0, 'the action ids are NOT hardcoded — they come from the engine');
  A.ok(src.indexOf('delete_data') < 0, 'and neither is any other action id');
  // and it must not offer a path that mutates
  A.ok(!/method:\s*'POST'/.test(src) && !/method:\s*"POST"/.test(src), 'the console issues no POST — it is a read');
  // no banned dialog API (the station has its own confirm surface)
  A.ok(!/\balert\s*\(/.test(src) && !/\bconfirm\s*\(/.test(src) && !/\bprompt\s*\(/.test(src),
    'no native alert/confirm/prompt — the station supplies its own');
}

/* ---------- a body-less mount must not throw ---------- */
{
  A.notThrows(() => { const r = S.mount(null); A.ok(r === null, 'mounting nothing returns null'); }, 'mount(null) does not throw');
}

A.report('businesssecurity');
