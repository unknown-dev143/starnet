'use strict';
/* test/businessworker.test.js — the AI WORKER console's PURE half (Business OS Phase 6).

   Only the Node-loadable half is exercised here: labels, chips, row shaping, the client-side validation
   mirror and the args parser. The DOM half needs a browser and is not tested headless.

   The load-bearing behaviours:
     · BOTH PERMISSION ANSWERS ARE RENDERED. A step row shows the §13 tier and, when it is stricter, the
       runtime FLOOR. A console that showed only one would either understate the risk or misfile a safe
       action as a review request — business-approvals-store refuses to file one, so an Approve button
       rendered from the floor alone would be a dead control.
     · AN APPROVE BUTTON APPEARS ONLY FOR A DECIDABLE REQUEST. A held step with no `approvalId` is waiting on
       the runtime consent gate, not on the owner. Rendering an Approve button for it would be a lie about
       who can unblock it, so `waitingRows` filters on `params.orderId` exactly as the route does.
     · THE TIER IS NEVER COMPUTED HERE. It travels on the row, derived server-side. This file asserts the
       console renders what it was given, and never re-derives it.
     · THE CLIENT-SIDE MIRROR IS THE SAME RULE AS THE SERVER'S, never a looser one.
     · EVERY INTERPOLATED VALUE IS ESCAPED — the console renders server text into innerHTML.
*/
const A = require('./_assert.js');
const M = require('../frontend/app/businessworker.js');

/* ---------- escaping ---------- */
{
  A.eq(M.esc('<b>x</b>'), '&lt;b&gt;x&lt;/b&gt;', 'esc neutralises tags');
  A.eq(M.esc('a"b\'c'), 'a&quot;b&#39;c', 'esc neutralises quotes');
  A.eq(M.esc(null), '', 'esc renders null as empty, never "null"');
  A.eq(M.esc(undefined), '', 'esc renders undefined as empty');
  A.eq(M.esc(0), '0', 'esc keeps a real zero');
}

/* ---------- relTime never invents a time ---------- */
{
  A.eq(M.relTime(null, 1000), 'never', 'a missing instant reads "never", not "now"');
  A.eq(M.relTime(NaN, 1000), 'never', 'and so does a NaN one');
  A.eq(M.relTime(2000, 1000), 'just now', 'a future instant reads "just now" rather than a negative age');
  // just inside each bucket — 61000-1000 is exactly 60000ms, which is already the next bucket up
  A.eq(M.relTime(1000, 60_000), '59s ago', 'seconds render as seconds');
  A.eq(M.relTime(1000, 3_600_000), '59m ago', 'minutes render as minutes');
  A.eq(M.relTime(1000, 3_600_000 + 60_000), '1h ago', 'and an hour rolls over to hours');
  A.eq(M.relTime(1000, 86_400_000 * 3), '2d ago', 'and days render as days');
}

/* ---------- THE TIER AND THE FLOOR ARE BOTH RENDERED ---------- */
{
  // a plain safe step: one chip, no floor noise
  const safe = M.tierChip({ tier: 'safe', action: 'read_local' });
  A.ok(safe.indexOf('SAFE') >= 0, 'a safe tier renders SAFE');
  A.ok(safe.indexOf('FLOOR') < 0, 'and carries NO floor chip — a redundant one would bury the row that matters');

  // the disagreement: a safe ACTION whose MECHANISM floors at review
  const write = M.tierChip({ tier: 'safe', action: 'draft', floor: 'review', floorAbove: true, scope: 'write' });
  A.ok(write.indexOf('SAFE') >= 0, 'the §13 tier is still rendered as SAFE');
  A.ok(write.indexOf('FLOOR REVIEW') >= 0, 'AND the review floor is rendered beside it — both answers, visible');
  A.ok(write.indexOf('scope') >= 0, 'and the title explains the declared scope');

  const restricted = M.tierChip({ tier: 'restricted', action: 'change_infra' });
  A.ok(restricted.indexOf('RESTRICTED') >= 0, 'a restricted tier renders RESTRICTED');

  // an unknown tier must not render as safe
  A.ok(M.tierChip({}).indexOf('UNKNOWN') >= 0, 'a missing tier renders UNKNOWN, never SAFE');
  A.ok(M.tierChip({ tier: 'nonsense' }).indexOf('SAFE') < 0, 'and an unknown tier string is not treated as safe');
}

/* ---------- a step row shows the policy's own words ---------- */
{
  const row = M.stepRow({ id: 'acme~w1' }, {
    seq: 2, tool: 'fs.write', why: 'draft the note', status: 'held', tier: 'safe',
    action: 'draft', floor: 'review', floorAbove: true, scope: 'write',
    reason: 'the runtime requires review-grade consent for this mechanism', wired: true
  });
  A.ok(row.indexOf('fs.write') >= 0, 'the tool is named');
  A.ok(row.indexOf('draft the note') >= 0, 'and the reason it was asked for');
  A.ok(row.indexOf('SAFE') >= 0, 'the §13 tier');
  A.ok(row.indexOf('FLOOR REVIEW') >= 0, 'and the floor, because they disagree');
  A.ok(row.indexOf('HELD') >= 0, 'and the step status');
  A.ok(row.indexOf('review-grade consent') >= 0, "and the policy's own sentence, verbatim");

  // an unwired tool gets its own marker — "no route to it" is a different fix from "refused"
  const unwired = M.stepRow({ id: 'x' }, { seq: 1, tool: 'shell.exec', why: 'look', status: 'refused', tier: 'restricted', wired: false, reason: 'no route' });
  A.ok(unwired.indexOf('NOT WIRED') >= 0, 'an unwired tool is marked NOT WIRED');

  // a step with no result renders no result block rather than an empty one
  A.ok(M.stepRow({ id: 'x' }, { seq: 1, tool: 'a', why: 'b', status: 'pending' }).indexOf('wk-result') < 0,
    'a step with no result renders no result block');
}

/* ---------- WAITING ON YOU: only a DECIDABLE request gets a button ---------- */
{
  const decidable = [{ id: 'acme~v1', status: 'pending', tier: 'review', action: 'external_comms',
    what: 'Run channel.send', why: 'step 1', params: { orderId: 'acme~w1', seq: 1, tool: 'channel.send' } }];
  const html = M.waitingRows(decidable);
  A.ok(html.indexOf('data-wk-approve="acme~v1"') >= 0, 'a worker-filed request gets an APPROVE button');
  A.ok(html.indexOf('data-wk-reject="acme~v1"') >= 0, 'and a REJECT button');

  // a request with no orderId was filed by the Phase 5 automation engine: deciding it here is a 409
  A.eq(M.waitingRows([{ id: 'acme~v2', status: 'pending', params: { amount: '10' } }]), '',
    'a request with no orderId is NOT offered here — the route refuses it with a 409');

  // a decided request is not pending, so it is not offered either
  A.eq(M.waitingRows([{ id: 'acme~v3', status: 'approved', params: { orderId: 'acme~w1' } }]), '',
    'an already-decided request drops out of the waiting list');

  A.eq(M.waitingRows([]), '', 'an empty queue renders nothing rather than an empty panel');
  A.eq(M.waitingRows(null), '', 'and a null queue is survived');
}

/* ---------- the catalog: reachable first, and unreachable marked ---------- */
{
  const catalog = { rows: [
    { tool: 'shell.exec', action: 'change_infra', tier: 'restricted', wired: false },
    { tool: 'fs.read', action: 'read_local', tier: 'safe', wired: true },
    { tool: 'fs.write', action: 'draft', tier: 'safe', floor: 'review', floorAbove: true, scope: 'write', wired: true }
  ] };
  const rows = M.catalogRows(catalog);
  A.eq(rows.length, 3, 'every row is listed');
  A.ok(rows[0].wired === true && rows[1].wired === true, 'WIRED tools sort first — what the worker can do is the answer a user wants');
  A.ok(rows[2].wired === false, 'and an unreachable one sorts last');
  A.ok(M.catalogRow(rows[2]).indexOf('—') >= 0, 'an unreachable row is marked, not left blank');
  A.ok(M.catalogRow(rows[0]).indexOf('WIRED') >= 0, 'and a reachable row says so');

  const filtered = M.catalogRows(catalog, 'fs.');
  A.eq(filtered.length, 2, 'a filter narrows the table');
  A.eq(M.catalogRows(catalog, 'nothing-matches').length, 0, 'and a filter with no match returns nothing');
  A.eq(M.catalogRows(null).length, 0, 'a null catalog is survived');
}

/* ---------- THE CLIENT-SIDE MIRROR: the same rule as the server's, never looser ---------- */
{
  A.ok(!M.validateSteps([]).ok, 'no steps is refused');
  A.ok(!M.validateSteps(null).ok, 'a null step list is refused');
  A.ok(!M.validateSteps([{ tool: 'fs.read' }]).ok, 'a step with no reason is refused (§26)');
  A.ok(M.validateSteps([{ tool: 'fs.read' }]).reason.indexOf('reason') >= 0, 'and says it is the reason that is missing');
  A.ok(!M.validateSteps([{ why: 'because' }]).ok, 'a step with no tool is refused');
  A.ok(M.validateSteps([{ tool: 'fs.read', why: 'read it' }]).ok, 'a well-formed step is accepted');

  const many = [];
  for (let i = 0; i < M.MAX_STEPS + 1; i++) many.push({ tool: 'fs.read', why: 'x' });
  A.ok(!M.validateSteps(many).ok, 'more than MAX_STEPS is refused');
  A.eq(M.MAX_STEPS, 12, 'and the client limit is the same 12 the policy enforces');
}

/* ---------- args parsing ---------- */
{
  A.ok(M.parseArgs('').ok, 'empty args are accepted');
  A.eq(Object.keys(M.parseArgs('').args).length, 0, 'as an empty object');
  A.ok(!M.parseArgs('{oops').ok, 'malformed JSON is refused');
  A.ok(M.parseArgs('{oops').reason.indexOf('JSON') >= 0, 'and the error names JSON');
  A.ok(!M.parseArgs('[1,2]').ok, 'an array is refused — args must be an object');
  A.ok(!M.parseArgs('"just a string"').ok, 'and a bare string is refused too');
  A.eq(M.parseArgs('{"path":"a.md"}').args.path, 'a.md', 'a well-formed object parses');
  A.ok(M.parseArgs(null).ok, 'a null textarea is survived');
}

/* ---------- the head line states the truth about reachability ---------- */
{
  A.ok(M.headLine({ rows: [] }, 0).indexOf('no wired tools') >= 0,
    'a catalogue with nothing wired says so — an empty console must not read as "nothing queued"');
  const c = { rows: [{ wired: true }, { wired: true }, { wired: false }] };
  A.ok(M.headLine(c, 0).indexOf('2 tool(s) reachable') >= 0, 'and it counts only the reachable ones');
  A.ok(M.headLine(c, 3).indexOf('3 step(s) waiting') >= 0, 'and reports what is waiting on you');
  A.ok(M.headLine(c, 0).indexOf('nothing waiting') >= 0, 'and says so plainly when nothing is');
}

/* ---------- summarise ---------- */
{
  A.ok(M.summarise({ total: 3, executed: 2, held: 1 }).indexOf('3 order(s)') >= 0, 'summarise counts orders');
  A.ok(M.summarise({ total: 3, executed: 2, held: 1 }).indexOf('2 executed') >= 0, 'and executions');
  A.ok(M.summarise({}).indexOf('0 order(s)') >= 0, 'and survives an empty summary');
  A.ok(M.summarise(null).indexOf('0 order(s)') >= 0, 'and a null one');
}

/* ---------- status chips never invent a status ---------- */
{
  A.ok(M.statusChip('done').indexOf('DONE') >= 0, 'a known status renders');
  A.ok(M.statusChip('').indexOf('PLANNED') >= 0, 'a missing status renders PLANNED, not blank');
  A.ok(M.statusChip('nonsense').indexOf('NONSENSE') >= 0, 'an unknown status is echoed, not silently mapped to a safe one');
  A.ok(M.stepChip('held').indexOf('HELD') >= 0, 'a step status renders');
  A.ok(M.stepChip('').indexOf('PENDING') >= 0, 'and a missing one renders PENDING');
}

/* ---------- an order row ---------- */
{
  const html = M.orderRow({
    id: 'acme~w1', intent: 'research the market', status: 'partial', agentName: 'Scout',
    steps: [{ seq: 1, tool: 'web_search', why: 'find competitors', status: 'executed', tier: 'safe', wired: true, result: '3 hits' }]
  });
  A.ok(html.indexOf('research the market') >= 0, 'the intent is shown');
  A.ok(html.indexOf('PARTIAL') >= 0, 'and the derived status');
  A.ok(html.indexOf('Scout') >= 0, 'and the agent');
  A.ok(html.indexOf('3 hits') >= 0, 'and the tool result');
  A.eq(M.orderRow(null), '', 'a null order renders nothing');
  A.ok(M.orderRow({ id: 'x', intent: 'y', status: 'planned', steps: [], dryRun: true }).indexOf('DRY RUN') >= 0,
    'a dry run is marked, so a plan is never mistaken for a job');
}

A.report('businessworker');
