/* node test/aiteam.test.js — the AI TEAM console (frontend/app/aiteam.js).

   Two halves, tested two ways.
     The PURE half is require()d and asserted directly: labels, option builders, row shaping, the permission
     view, and — the interesting ones — the HIRE GUARD and the HIRE-TIME SPECIALTY LIST. The specialty picker
     must offer ONLY the classes the chosen role names, because that is the one pairing the sidecar refuses;
     a UI that offers it is a UI whose button does nothing.
     The DOM half cannot run headless, so its WIRING is source-locked: the dock button, the window
     registration, the script order in index.html, and the response-truthfulness of the fetch helper.
   Pure + fast (no DOM, no fetch, no boot). */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');

const TM = require('../frontend/app/aiteam.js');
const Roles = require('../shared/business-roles.js');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const html = read('frontend/index.html');
const engine = read('frontend/app/aiteam.js');
const win = read('frontend/app/windows/team.js');
const glossary = read('frontend/app/glossary.js');

const ROLES = Roles.catalog();

/* ---------- labels ---------- */
{
  A.eq(TM.statusLabel('idle'), 'IDLE', 'idle reads IDLE');
  A.eq(TM.statusLabel('paused'), 'PAUSED', 'paused reads PAUSED');
  A.eq(TM.statusLabel('nope'), 'NOPE', 'an unknown status echoes upcased rather than inventing a word');
  A.eq(TM.scopeLabel('business'), 'BUSINESS', 'the business scope reads BUSINESS');
  A.eq(TM.kindLabel('decision'), 'DECISION', 'decision reads DECISION');
  A.eq(TM.sourceLabel('user'), 'you said', 'the user source reads as prose — provenance, not a code');
  A.eq(TM.messageKindLabel('handoff'), 'HANDOFF', 'handoff reads HANDOFF');
  A.eq(TM.tierLabel('restricted'), 'RESTRICTED', 'restricted reads RESTRICTED');
  A.eq(TM.TIER_NOTE.restricted, 'cannot run without explicit authorization and safeguards', 'the tier note is §13 verbatim');
}

/* ---------- the vocabularies match the stores, in order ---------- */
{
  A.eq(TM.STATUSES, ['idle', 'working', 'paused', 'disabled'], 'the status vocabulary matches business-agents-store');
  A.eq(TM.SCOPES, ['user', 'business', 'project', 'agent'], 'the scope vocabulary matches §9 and business-memory');
  A.eq(TM.SOURCES, ['user', 'document', 'agent', 'import'], 'the source vocabulary matches business-memory');
  A.eq(TM.MESSAGE_KINDS, ['note', 'request', 'handoff', 'decision', 'report'], 'the message kinds match agent-messages-store');
  A.eq(TM.TIERS, ['safe', 'review', 'restricted'], 'the tiers match business-permissions');
  A.eq(TM.KINDS.length, 11, '§9 has eleven kinds of memory');
  for (const k of TM.KINDS) A.ok(!!TM.KIND_LABEL[k], 'kind ' + k + ' has a label');
  for (const t of TM.TIERS) A.ok(!!TM.TIER_NOTE[t], 'tier ' + t + ' has its §13 note');
}

/* ---------- the specialty picker offers ONLY what the role names ---------- */
{
  // before a role is picked there is nothing to offer — and it says so rather than showing every class.
  const none = TM.specialtyOptions(ROLES, '', '');
  A.ok(/pick a role first/.test(none), 'with no role chosen the picker says to pick a role');
  A.ok(!/engineer/.test(none), 'and it does NOT leak the whole catalog');

  const ceo = TM.specialtyOptions(ROLES, 'ceo', '');
  A.ok(/strategist/.test(ceo) && /chief/.test(ceo), 'the CEO role offers its own two classes');
  A.ok(!/engineer/.test(ceo), 'and NOT a class from another role — the sidecar would refuse that hire');

  const eng = TM.specialtyOptions(ROLES, 'engineering', '');
  A.ok(/engineer/.test(eng) && /dbhelper/.test(eng) && /deployer/.test(eng), 'engineering offers its three');
  A.ok(!/strategist/.test(eng), 'and not the CEO classes');

  // the role picker has an explicit blank first option — no silent default.
  const roles = TM.roleOptions(ROLES, '');
  A.ok(/<option value="" selected>/.test(roles), 'the role picker opens on an explicit blank');
  A.ok(/pick a role/.test(roles), 'and says so');
  A.ok(/CEO/.test(roles) && /Project Manager/.test(roles), 'all twelve roles are offered');
}

/* ---------- the kind picker distinguishes "any" from a pick ---------- */
{
  A.ok(/— any kind —/.test(TM.kindOptions('')), 'the memory filter offers an explicit "any kind"');
  A.ok(!/any kind/.test(TM.kindPickOptions('decision')), 'the WRITE picker has no "any" — a memory must have a kind');
  A.ok(/DECISION/.test(TM.kindPickOptions('decision')), 'the write picker lists the real kinds');
}

/* ---------- grant chips: the tier is always named, never colour-only ---------- */
{
  const chips = TM.grantChips({ safe: true, review: false, restricted: false });
  A.eq(chips.length, 3, 'all three tiers are shown, granted or not');
  A.eq(chips.map(c => c.label), ['SAFE', 'REVIEW', 'RESTRICTED'], 'in §13 order');
  A.eq(chips.map(c => c.on), [true, false, false], 'only the granted tier reads as on');
  A.ok(chips.every(c => !!c.note), 'every chip carries its §13 note as a tooltip');
}

/* ---------- the hire guard mirrors the sidecar exactly ---------- */
{
  A.eq(TM.hireGuard(ROLES, '', '').allowed, false, 'no role -> refused');
  A.eq(TM.hireGuard(ROLES, 'nope', '').allowed, false, 'an unknown role -> refused');
  const ok = TM.hireGuard(ROLES, 'ceo', '');
  A.eq(ok.allowed, true, 'a valid role with no explicit class -> allowed');
  A.eq(ok.specialty, 'strategist', 'and it defaults to the role\'s first class');
  A.eq(TM.hireGuard(ROLES, 'ceo', 'engineer').allowed, false, 'a class that does not fill the role -> refused');
  A.ok(/cannot fill the CEO role/.test(TM.hireGuard(ROLES, 'ceo', 'engineer').reason), 'and the refusal names the role');
  A.eq(TM.hireGuard(ROLES, 'engineering', 'deployer').allowed, true, 'a class the role DOES name -> allowed');
}

/* ---------- the memory guard mirrors the store (source is P1) ---------- */
{
  A.eq(TM.memoryGuard({ text: 'x', kind: 'decision', source: 'user' }).allowed, true, 'a complete draft is allowed');
  A.eq(TM.memoryGuard({ text: '  ', kind: 'decision', source: 'user' }).allowed, false, 'empty text -> refused');
  A.eq(TM.memoryGuard({ text: 'x', source: 'user' }).allowed, false, 'no kind -> refused');
  A.eq(TM.memoryGuard({ text: 'x', kind: 'decision' }).allowed, false, 'no source -> refused (P1)');
  A.ok(/invented one/.test(TM.memoryGuard({ text: 'x', kind: 'decision' }).reason), 'and the refusal explains why provenance matters');
}

/* ---------- row shaping ---------- */
{
  const rows = TM.agentRows([
    { id: 'acme~a1', name: 'Nova', role: 'ceo', specialty: 'strategist', status: 'paused', grants: { safe: true, review: false, restricted: false }, hiredBy: 'ai' }
  ], ROLES);
  A.eq(rows.length, 1, 'one agent -> one row');
  A.eq(rows[0].roleLabel, 'CEO', 'the role resolves to its §7 label');
  A.eq(rows[0].specialtyName, 'Strategist', 'the class resolves to its catalog name');
  A.eq(rows[0].statusLabel, 'PAUSED', 'the status is labelled');
  A.eq(rows[0].paused, true, 'and a paused agent is flagged so the UI can offer RESUME');
  A.eq(rows[0].responsibility, 'Coordinates the business; strategic recommendations', 'the §7 responsibility travels with the row');
  A.ok(/an agent proposed/.test(rows[0].hiredBy), 'provenance is stated, not hidden');

  const unknown = TM.agentRows([{ id: 'x', name: 'X', role: 'ceo', specialty: 'ghost', status: 'idle', grants: {} }], ROLES)[0];
  A.eq(unknown.specialtyName, 'ghost', 'an unknown class echoes its id rather than inventing a name');

  const dec = TM.decisionRows([
    { action: 'research', label: 'Research', tier: 'safe', allow: true, approval: 'not-required' },
    { action: 'spend_money', label: 'Spend money', tier: 'review', allow: false, approval: 'required' },
    { action: 'delete_data', label: 'Delete data', tier: 'restricted', allow: false, approval: 'required' }
  ]);
  A.eq(dec.map(d => d.verdict), ['MAY DO', 'NEEDS APPROVAL', 'NEEDS APPROVAL'], 'the verdict is stated in words, not a colour');
  A.eq(dec.map(d => d.tierLabel), ['SAFE', 'REVIEW', 'RESTRICTED'], 'the tier is labelled');
}

/* ---------- memory + message rows ---------- */
{
  const mem = TM.memoryRows([{ id: 'business~acme~1', scope: 'business', ownerId: 'acme', kind: 'decision', text: 'Ship in March', source: 'user', at: 1000, businessId: 'acme' }], 1000);
  A.eq(mem[0].kindLabel, 'DECISION', 'the kind is labelled');
  A.eq(mem[0].sourceLabel, 'you said', 'the provenance is rendered as prose');
  A.eq(mem[0].when, '0s ago', 'the age is computed from the injected now');

  const msgs = TM.messageRows([
    { id: 'acme~m1', from: 'user', to: 'acme~a1', kind: 'request', subject: 'Scan', body: 'go', refs: [], at: 0 },
    { id: 'acme~m2', from: 'acme~a1', to: 'user', kind: 'report', subject: '', body: 'done', refs: [], at: 0 }
  ], [{ id: 'acme~a1', name: 'Nova' }]);
  A.eq(msgs[0].fromName, 'YOU', 'the user reads as YOU');
  A.eq(msgs[0].toName, 'Nova', 'an agent id resolves to the agent name');
  A.eq(msgs[1].fromName, 'Nova', 'and in the other direction');
  A.eq(msgs.map(m => m.kindLabel), ['REQUEST', 'REPORT'], 'the message kind is labelled');

  const ghost = TM.messageRows([{ id: 'm', from: 'user', to: 'nobody', kind: 'note', body: '', refs: [], at: 0 }], [])[0];
  A.eq(ghost.toName, 'nobody', 'an unknown party echoes its id rather than inventing a name');
}

/* ---------- the summary counts statuses, never scores ---------- */
{
  A.ok(/No agents hired yet/.test(TM.summaryLine([], ROLES)), 'an empty team says so and explains what a team is');
  const line = TM.summaryLine([
    { id: 'a', status: 'idle' }, { id: 'b', status: 'paused' }, { id: 'c', status: 'paused' }
  ], ROLES);
  A.ok(/3 agents/.test(line), 'the count is right');
  A.ok(/PAUSED 2/.test(line) && /IDLE 1/.test(line), 'and it breaks down by status');
  A.ok(!/score|rating|%/i.test(line), 'nothing here is a score');
}

/* ---------- approvalLine quotes the sidecar ---------- */
{
  A.ok(/APPROVAL REQUIRED/.test(TM.approvalLine({ approval: 'required', reason: 'a review-tier action' })), 'a required approval reads REQUIRED');
  A.ok(/NO APPROVAL NEEDED/.test(TM.approvalLine({ approval: 'not-required', reason: 'safe' })), 'and a safe action reads not needed');
  A.eq(TM.approvalLine(null), '', 'no decision -> no line, rather than a default claim');
}

/* ================= the DOM half: wiring source-locks ================= */

/* ---------- the dock button, the window slot, and the load order ---------- */
{
  A.ok(/<button class="bb" data-term="team" data-hint="team"/.test(html),
    'index.html has the AI TEAM dock button (.bb[data-term="team"])');
  A.ok(/data-hint="team"/.test(html), 'the button carries a data-hint');
  A.ok(/team:\s*'/.test(glossary), 'glossary.js defines a `team` term, so the data-hint resolves');
  A.ok(/StationUI\.registerWindow\('team', 'AI TEAM'/.test(win),
    'windows/team.js registers the window under the title the dock shows (TITLE LAW)');
  A.ok(/AITeam\.mount\(body\)/.test(win), 'the window slot mounts the engine');
  A.ok(/typeof AITeam === 'undefined'/.test(win),
    'the slot degrades honestly when the engine is missing rather than showing a fake empty team');

  const iEngine = html.indexOf('app/aiteam.js');
  const iWin = html.indexOf('app/windows/team.js');
  const iSui = html.indexOf('app/stationui.js');
  A.ok(iEngine > 0 && iWin > 0, 'both files are loaded by index.html');
  A.ok(iEngine < iWin, 'the engine loads BEFORE the window slot that calls it');
  A.ok(iSui > 0 && iSui < iWin, 'stationui.js loads before the slot that registers with it');
  A.ok(/css\/aiteam\.css/.test(html), 'the scoped stylesheet is linked');
}

/* ---------- the engine is UMD and mounts a 4-pane console ---------- */
{
  A.ok(/root\.AITeam = api/.test(engine), 'the engine exports itself as root.AITeam (UMD)');
  A.ok(/mountConsole\(body, 'team',/.test(engine), 'mount() builds the console under the "team" key');
  for (const pane of ['team', 'hire', 'memory', 'messages']) {
    A.ok(new RegExp("id: '" + pane + "'").test(engine), 'the console has a ' + pane + ' pane');
  }
  const order = ['team', 'hire', 'memory', 'messages'].map(p => engine.indexOf("id: '" + p + "'"));
  A.ok(order[0] < order[1] && order[1] < order[2] && order[2] < order[3],
    'the panes are ordered team -> hire -> memory -> messages');
}

/* ---------- destructive controls arm through ArmConfirm, never a native dialog ---------- */
{
  // An OS modal over the phosphor terminal is banned (test/station-tooltip.test.js). Assert BOTH halves: the
  // dialog is gone AND a real two-press confirmation replaced it.
  A.ok(!/window\s*\.\s*(alert|confirm|prompt)\s*\(/.test(engine), 'the engine calls NO native window dialog');
  A.ok(/ArmConfirm\.wire\(/.test(engine), 'REMOVE and FORGET arm through the shared ArmConfirm helper');
  A.ok(/function arm\(btn, label, onConfirm\)/.test(engine), 'there is ONE local arm() helper, not two copies');
  A.ok(/confirmation helper unavailable/.test(engine),
    'the arm helper is FAIL-CLOSED: with no ArmConfirm the control disables rather than firing unconfirmed');
}

/* ---------- the fetch helper reads the Response (the frontend truth ratchet) ---------- */
{
  A.ok(/r\.json\(\)\.then\(function \(j\) \{ return \{ ok: r\.ok, status: r\.status, j: j \}; \}\)/.test(engine),
    'request() keeps the Response in scope and reads r.ok — a 403 must never collapse into success');
  A.ok(/function errText\(r, fallback\)/.test(engine), 'errText surfaces the server\'s own error string');
}

/* ---------- the restricted tier is never offered as a grant ---------- */
{
  // the checkbox exists only as a DISABLED, labelled row — a checkbox that silently does nothing is worse
  // than no checkbox, so it is shown locked with its §13 reason.
  A.ok(/tm-locked/.test(engine), 'the restricted grant is rendered as a locked row');
  A.ok(/<input type="checkbox" disabled>/.test(engine), 'and the control is actually disabled');
  A.ok(/never auto-grantable/.test(engine), 'and it says why, quoting §13');
}

A.report('aiteam');
