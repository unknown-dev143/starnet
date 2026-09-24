/* node test/businessmaker.test.js — the BUSINESS MAKER (frontend/app/businessmaker.js).

   Two halves, tested two ways.
     The PURE half is require()d and asserted directly: labels, the evidence mix COUNT, completeness, the §4
     field table, validation rows, the plan preview, and — the interesting ones — the PROMOTE GUARD and the
     EVIDENCE OPTION LIST. The evidence picker must have NO default, because an unlabelled claim is the one
     thing P1 forbids and a picker that pre-selects a label would let one through silently.
     The DOM half cannot run headless, so its WIRING is source-locked: the dock button, the window
     registration, the script order in index.html, and the response-truthfulness of the fetch helper.
   Pure + fast (no DOM, no fetch, no boot). */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');

const BM = require('../frontend/app/businessmaker.js');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const html = read('frontend/index.html');
const engine = read('frontend/app/businessmaker.js');
const win = read('frontend/app/windows/maker.js');
const glossary = read('frontend/app/glossary.js');

/* ---------- labels ---------- */
{
  A.eq(BM.evidenceLabel('verified'), 'VERIFIED', 'verified reads VERIFIED');
  A.eq(BM.evidenceLabel('analysis'), 'ANALYSIS', 'analysis reads ANALYSIS');
  A.eq(BM.evidenceLabel('nope'), 'UNKNOWN', 'an unknown evidence class reads UNKNOWN — never a plausible guess');
  A.eq(BM.evidenceLabel(null), 'UNKNOWN', 'a null class reads UNKNOWN');
  A.eq(BM.fieldLabel('targetCustomer'), 'TARGET CUSTOMER', 'a §4 field reads as its prompt name');
  A.eq(BM.stageLabel('promoted'), 'PROMOTED', 'promoted reads PROMOTED');
  A.eq(BM.stageLabel('nope'), 'UNKNOWN', 'an unknown stage reads UNKNOWN');
  A.eq(BM.methodLabel('landing-page-test'), 'Landing-page test', 'a §5 method reads as prose');
  A.eq(BM.methodLabel('nope'), 'nope', 'an unknown method echoes back rather than inventing a name');
  A.eq(BM.verdictLabel('supported'), 'SUPPORTED', 'supported reads SUPPORTED');
  A.eq(BM.evidenceHint('verified'), 'sourced and checkable', 'each evidence class carries a one-line meaning');
  A.eq(BM.evidenceHint('nope'), '', 'an unknown class has no hint rather than a made-up one');
}

/* ---------- the vocabularies match the stores, in order ---------- */
{
  A.eq(BM.EVIDENCE, ['verified', 'analysis', 'assumption', 'estimate', 'prediction', 'unknown'],
    'the evidence vocabulary matches opportunities-store, strongest first');
  A.eq(BM.FIELDS.length, 12, '§4 has twelve fields');
  A.eq(BM.METHODS.length, 13, '§5 has thirteen tools');
  A.eq(BM.VERDICTS, ['pending', 'inconclusive', 'supported', 'contradicted'], 'the verdict vocabulary matches validation-store');
  A.eq(BM.STAGES, ['draft', 'researching', 'ready', 'validating', 'validated', 'rejected', 'promoted', 'archived'],
    'the stage vocabulary matches opportunities-store');
  // every §4 field has BOTH a label and a prompt, or the table renders a blank header/cell.
  for (const f of BM.FIELDS) {
    A.ok(!!BM.FIELD_LABEL[f], 'field ' + f + ' has a label');
    A.ok(!!BM.FIELD_PROMPT[f], 'field ' + f + ' has a prompt, so an empty cell is a question not a void');
  }
  for (const m of BM.METHODS) A.ok(!!BM.METHOD_LABEL[m], 'method ' + m + ' has a display name');
  for (const e of BM.EVIDENCE) A.ok(!!BM.EVIDENCE_LABEL[e], 'evidence class ' + e + ' has a label');
}

/* ---------- the evidence picker has NO DEFAULT (this is the P1 guard, in the UI) ---------- */
{
  const opts = BM.evidenceOptions('');
  A.eq(opts[0].value, '', 'the first option is the empty "pick a label" prompt');
  A.ok(opts[0].selected, 'with no current value the EMPTY option is selected — nothing is pre-labelled');
  A.eq(opts.length, 7, 'six classes plus the empty prompt');
  A.ok(!opts.slice(1).some(o => o.selected), 'no real class is pre-selected');

  const cur = BM.evidenceOptions('analysis');
  A.eq(cur.filter(o => o.selected).length, 1, 'exactly one option is selected when a value exists');
  A.eq(cur.filter(o => o.selected)[0].value, 'analysis', 'and it is the current one');
  A.ok(!cur[0].selected, 'the empty prompt is not selected when a real label is present');

  // the other pickers DO default, because they are not epistemics.
  A.ok(BM.methodOptions('').some(o => o.selected), 'the method picker always has a selection');
  A.ok(BM.verdictOptions('pending').filter(o => o.selected)[0].value === 'pending', 'the verdict picker honours its current value');
  A.ok(BM.stageOptions('ready').filter(o => o.selected)[0].value === 'ready', 'the stage picker honours its current value');
}

/* ---------- evidenceMix is a COUNT, never a score ---------- */
{
  const opp = {
    fields: {
      problem: { text: 'People forget', evidence: 'assumption' },
      competition: { text: 'Two local papers', evidence: 'verified' },
      risks: { text: '', evidence: 'unknown' },
      unknowns: { text: 'Willingness to pay', evidence: 'unknown' }
    }
  };
  const mix = BM.evidenceMix(opp);
  A.eq(mix.assumption, 1, 'one assumption counted');
  A.eq(mix.verified, 1, 'one verified counted');
  A.eq(mix.unknown, 1, 'an unknown claim counts as unknown');
  A.eq(mix.estimate, 0, 'a class with nothing in it counts zero');
  A.eq(Object.keys(mix).length, 6, 'every class is present in the mix');
  A.eq(Object.keys(mix).filter(k => /score|percent/i.test(k)), [], 'the mix carries no score/percentage key (P2/P7)');

  // an EMPTY cell is not a claim: it must not be counted at all.
  const empty = BM.evidenceMix({ fields: { problem: { text: '', evidence: 'verified' } } });
  A.eq(empty.verified, 0, 'an empty cell with a stale label is NOT counted — an empty cell is not a claim');
  A.eq(empty.unknown, 0, 'and it is not counted as unknown either');

  // the server's mix wins when present (it is the same count, computed once).
  A.eq(BM.evidenceMix({ evidenceMix: { verified: 3 }, fields: {} }).verified, 3, 'a server-supplied mix is used as-is');

  A.eq(BM.mixChips(opp).length, 3, 'only classes with a non-zero count get a chip');
  A.eq(BM.mixChips({ fields: {} }), [], 'an opportunity with no claims has no chips (the UI shows a NO CLAIMS line instead)');
}

/* ---------- completeness + missing ---------- */
{
  const opp = { fields: { problem: { text: 'x' }, risks: { text: 'y' } } };
  const c = BM.completeness(opp);
  A.eq(c.filled, 2, 'two fields filled');
  A.eq(c.total, 12, 'of twelve');
  A.eq(c.ready, false, 'not decision-ready');
  A.eq(BM.missingFields(opp).length, 10, 'ten still missing');
  A.ok(BM.missingFields(opp).indexOf('problem') < 0, 'a filled field is not listed as missing');
  A.ok(BM.missingFields(opp).indexOf('risks') < 0, 'nor is the other filled one');

  // a server-supplied completeness/missing pair is honoured.
  const served = { completeness: { filled: 12, total: 12, ready: true }, missing: [] };
  A.eq(BM.completeness(served).ready, true, 'a server-supplied completeness is used');
  A.eq(BM.missingFields(served), [], 'a server-supplied missing list is used');

  A.eq(BM.completeness(null).filled, 0, 'a null opportunity is 0 of 12, not a crash');
  A.eq(BM.completeness({}).total, 12, 'a bare opportunity still reports the right total');
}

/* ---------- completenessLine: counts only, no judgement ---------- */
{
  const line = BM.completenessLine({ fields: { problem: { text: 'x', evidence: 'verified' } } });
  A.ok(/1 of 12 fields/.test(line), 'the line reports filled-of-total');
  A.ok(/1 verified/.test(line), 'the line reports the evidence mix');
  A.ok(/11 still missing/.test(line), 'the line reports what is still missing');
  A.ok(!/score|good|bad|strong|weak|promising/i.test(line), 'the line passes NO judgement on the idea');
  A.ok(/no claims yet/.test(BM.completenessLine({ fields: {} })), 'an empty opportunity says so plainly');
}

/* ---------- toRows ---------- */
{
  const rows = BM.toRows([
    { id: 'a', title: 'Alpha', stage: 'promoted', businessId: 'alpha', updatedAt: 1000, fields: {} },
    { id: 'b', title: '', stage: 'nope', fields: {} },
    null
  ], 61000);
  A.eq(rows.length, 3, 'a null entry does not drop the row count (it is shaped defensively)');
  A.eq(rows[0].stageLabel, 'PROMOTED', 'the stage is labelled');
  A.eq(rows[0].promoted, true, 'a promoted opportunity is flagged');
  A.eq(rows[0].businessId, 'alpha', 'the business link is carried');
  A.eq(rows[0].guard.allowed, false, 'a promoted opportunity cannot be promoted again');
  A.eq(rows[0].completenessLabel, '0/12', 'the completeness label is filled/total');
  A.eq(rows[0].updatedRel, '1m', 'the relative stamp is computed from the injected clock');
  A.eq(rows[1].title, '(untitled)', 'a blank title reads (untitled)');
  A.eq(rows[1].stageLabel, 'UNKNOWN', 'an unknown stage reads UNKNOWN rather than defaulting to draft');
  A.eq(rows[2].title, '(untitled)', 'a null row is shaped, not thrown on');
  A.eq(rows[1].guard.allowed, true, 'a non-promoted opportunity may be promoted');
  A.eq(BM.toRows([], 0), [], 'no opportunities is an empty list');
}

/* ---------- the promote guard ---------- */
{
  A.eq(BM.promoteGuard({ stage: 'draft' }).allowed, true, 'a draft can be promoted');
  A.eq(BM.promoteGuard({ stage: 'validated' }).allowed, true, 'a validated opportunity can be promoted');
  A.eq(BM.promoteGuard({ stage: 'rejected' }).allowed, true,
    'even a REJECTED opportunity can be promoted — the user is the authority (§32), the UI does not overrule them');
  const p = BM.promoteGuard({ stage: 'promoted' });
  A.eq(p.allowed, false, 'a promoted opportunity cannot be promoted again');
  A.ok(/Already promoted/.test(p.reason), 'and the reason says so');
  A.eq(BM.promoteGuard(null).allowed, true, 'a null opportunity is treated as a fresh draft');
}

/* ---------- the §4 field table ---------- */
{
  const rows = BM.fieldRows({ fields: { problem: { text: 'People forget', evidence: 'assumption', source: 'a hunch' } } });
  A.eq(rows.length, 12, 'all twelve fields are listed, filled or not');
  const p = rows.filter(r => r.key === 'problem')[0];
  A.eq(p.filled, true, 'a filled field is flagged filled');
  A.eq(p.evidence, 'assumption', 'the evidence class is carried');
  A.eq(p.evidenceLabel, 'ASSUMPTION', 'and labelled');
  A.eq(p.source, 'a hunch', 'the source is carried');
  const empty = rows.filter(r => r.key === 'risks')[0];
  A.eq(empty.filled, false, 'an empty field is flagged unfilled');
  A.eq(empty.evidenceLabel, '—', 'an empty field shows a dash rather than a fake UNKNOWN claim');
  A.eq(empty.evidence, '', 'and carries no evidence class at all');
  A.ok(!!empty.prompt, 'an empty field still shows its prompt');
  A.eq(BM.fieldRows(null).length, 12, 'a null opportunity still lists twelve rows');
}

/* ---------- validation rows ---------- */
{
  const rows = BM.validationRows([
    { id: 'a~v1', seq: 1, method: 'survey', hypothesis: 'H', verdict: 'supported', at: 1000,
      evidence: [{ text: '42/50', evidence: 'verified' }, { text: 'we assume', evidence: 'assumption' }, { text: '' }],
      supporting: ['yes'], contradicting: [] }
  ], 61000);
  A.eq(rows.length, 1, 'one run listed');
  A.eq(rows[0].methodLabel, 'Survey', 'the method is labelled');
  A.eq(rows[0].verdictLabel, 'SUPPORTED', 'the verdict is labelled');
  A.eq(rows[0].evidenceCount, 2, 'only evidence WITH text is counted');
  A.eq(rows[0].gradedCount, 1, 'only verified/analysis evidence counts as graded — an assumption is not');
  A.eq(rows[0].supporting, 1, 'supporting signals counted');
  A.eq(rows[0].contradicting, 0, 'contradicting signals counted');
  A.eq(rows[0].rel, '1m', 'the relative stamp is computed');
  A.eq(BM.validationRows(null), [], 'no runs is an empty list');

  A.ok(/Nothing tested yet/.test(BM.validationSummaryLine({ total: 0 })), 'an empty summary says so plainly');
  const s = BM.validationSummaryLine({ total: 3, supported: 1, contradicted: 1, inconclusive: 1, pending: 0 });
  A.ok(/3 runs/.test(s) && /1 supported/.test(s) && /1 contradicted/.test(s), 'the summary is a tally of verdicts');
}

/* ---------- the plan preview: P1 means the effort is never a bare number ---------- */
{
  const plan = { tasks: [
    { title: 'Research market', stage: 'research', stageLabel: 'Research', priority: 'high', effort: { hours: 6, evidence: 'estimate' }, approvalRequired: false },
    { title: 'Set up checkout', stage: 'checkout', stageLabel: 'Checkout', priority: 'high', effort: { hours: 6, evidence: 'estimate' }, approvalRequired: true }
  ] };
  const rows = BM.planRows(plan);
  A.eq(rows.length, 2, 'both plan tasks are listed');
  A.eq(rows[0].n, 1, 'tasks are numbered from 1');
  A.eq(rows[0].stageLabel, 'Research', 'the stage label is carried');
  A.eq(rows[0].effortLabel, 'est. 6h', 'P1: the effort renders WITH its label, never as a bare number');
  A.eq(rows[1].approvalRequired, true, 'an approval-gated task is flagged');
  A.ok(/2 tasks/.test(BM.planSummary(plan)), 'the summary counts the tasks');
  A.ok(/est\. 12h total/.test(BM.planSummary(plan)), 'the summary totals the estimates');
  A.ok(/1 need your approval/.test(BM.planSummary(plan)), 'the summary counts the approval gates');
  A.eq(BM.planSummary(null), '', 'no plan is an empty summary');
  A.eq(BM.planSummary({ tasks: [] }), '', 'an empty plan is an empty summary');
}

/* ---------- parseEvidenceLines: an unlabelled line is refused in the UI, before the server sees it ---------- */
{
  const good = BM.parseEvidenceLines('verified: 42 of 50 said yes\nassumption: they answered honestly');
  A.eq(good.ok, true, 'well-formed lines parse');
  A.eq(good.items.length, 2, 'both items parsed');
  A.eq(good.items[0].evidence, 'verified', 'the class is read from the label');
  A.eq(good.items[0].text, '42 of 50 said yes', 'the text is read after the colon');
  A.eq(good.items[1].evidence, 'assumption', 'the second class too');

  A.eq(BM.parseEvidenceLines('no label here').ok, false, 'a line with no label is refused');
  A.eq(BM.parseEvidenceLines('vibes: something').ok, false, 'a line with an unrecognised class is refused');
  A.eq(BM.parseEvidenceLines('verified:').ok, false, 'a label with no text is refused');
  A.eq(BM.parseEvidenceLines('').ok, true, 'an empty box parses to zero items (a run may be saved with no evidence yet)');
  A.eq(BM.parseEvidenceLines('').items, [], 'and yields an empty list');
  A.eq(BM.parseEvidenceLines('  \n  ').items, [], 'whitespace-only lines are ignored');
  A.eq(BM.parseEvidenceLines('VERIFIED: shouted').items[0].evidence, 'verified', 'the class is matched case-insensitively');
}

/* ---------- summaryLine ---------- */
{
  A.ok(/No opportunities yet/.test(BM.summaryLine([])), 'an empty radar says so plainly');
  const s = BM.summaryLine([{ stage: 'promoted' }, { stage: 'draft' }, { stage: 'draft' }]);
  A.ok(/3 opportunities/.test(s), 'the line counts them');
  A.ok(/1 promoted/.test(s), 'and counts the promoted ones');
  A.ok(/2 still under evaluation/.test(s), 'and the rest');
}

/* ---------- relTime ---------- */
{
  A.eq(BM.relTime(0, 1000), '', 'no stamp renders empty rather than "now"');
  A.eq(BM.relTime(900, 1000), 'now', 'under a minute reads now');
  A.eq(BM.relTime(1000, 61000), '1m', 'a minute reads 1m');
  A.eq(BM.relTime(1000, 1000 + 3600000), '1h', 'an hour reads 1h');
  A.eq(BM.relTime(1000, 1000 + 90000000), '1d', 'a day reads 1d');
  A.eq(BM.relTime(5000, 1000), 'now', 'a clock skew must not render a negative age');
}

/* ---------- esc ---------- */
{
  A.eq(BM.esc('<b>&"\''), '&lt;b&gt;&amp;&quot;&#39;', 'esc neutralises every HTML metacharacter');
  A.eq(BM.esc(null), '', 'a null renders empty');
}

/* ================= the DOM half: wiring source-locks ================= */

/* ---------- the dock button, the window slot, and the load order ---------- */
{
  A.ok(/<button class="bb" data-term="maker" data-hint="maker"/.test(html),
    'index.html has the BUSINESS MAKER dock button (.bb[data-term="maker"])');
  A.ok(/data-hint="maker"/.test(html), 'the button carries a data-hint');
  A.ok(/maker:\s*'/.test(glossary), 'glossary.js defines a `maker` term, so the data-hint resolves');
  A.ok(/StationUI\.registerWindow\('maker', 'BUSINESS MAKER'/.test(win),
    'windows/maker.js registers the maker window under the title the dock shows (TITLE LAW)');
  A.ok(/BusinessMaker\.mount\(body\)/.test(win), 'the window slot mounts the engine');
  A.ok(/typeof BusinessMaker === 'undefined'/.test(win),
    'the slot degrades honestly when the engine is missing rather than showing a fake empty console');

  // load order: the engine must be parsed before the slot, and both after stationui.
  const iEngine = html.indexOf('app/businessmaker.js');
  const iWin = html.indexOf('app/windows/maker.js');
  const iSui = html.indexOf('app/stationui.js');
  A.ok(iEngine > 0 && iWin > 0, 'both files are loaded by index.html');
  A.ok(iEngine < iWin, 'the engine loads BEFORE the window slot that calls it');
  A.ok(iSui > 0 && iSui < iWin, 'stationui.js loads before the slot that registers with it');
  A.ok(/css\/businessmaker\.css/.test(html), 'the scoped stylesheet is linked');
}

/* ---------- the engine is UMD and mounts a 4-pane console ---------- */
{
  A.ok(/root\.BusinessMaker = api/.test(engine), 'the engine exports itself as root.BusinessMaker (UMD)');
  A.ok(/mountConsole\(body, 'maker',/.test(engine), 'mount() builds the console under the "maker" key');
  for (const pane of ['radar', 'evidence', 'validation', 'plan']) {
    A.ok(new RegExp("id: '" + pane + "'").test(engine), 'the console has a ' + pane + ' pane');
  }
  // the reverse funnel: the PANE ORDER is the argument order of the master prompt.
  const order = ['radar', 'evidence', 'validation', 'plan'].map(p => engine.indexOf("id: '" + p + "'"));
  A.ok(order[0] < order[1] && order[1] < order[2] && order[2] < order[3],
    'the panes are ordered radar -> evidence -> validation -> plan (evaluate first, commit second)');
}

/* ---------- destructive controls arm through ArmConfirm, never a native dialog ---------- */
{
  // An OS modal over the phosphor terminal is banned (test/station-tooltip.test.js). Assert BOTH halves: the
  // dialog is gone AND a real two-press confirmation replaced it.
  A.ok(!/window\s*\.\s*(alert|confirm|prompt)\s*\(/.test(engine), 'the engine calls NO native window dialog');
  A.ok(/ArmConfirm\.wire\(/.test(engine), 'DELETE and PROMOTE arm through the shared ArmConfirm helper');
  A.ok(/function arm\(btn, label, onConfirm\)/.test(engine), 'there is ONE local arm() helper, not two copies');
  A.ok(/confirmation helper unavailable/.test(engine),
    'the arm helper is FAIL-CLOSED: with no ArmConfirm the control disables rather than firing unconfirmed');
}

/* ---------- the fetch helper reads the Response (the frontend truth ratchet) ---------- */
{
  A.ok(/r\.json\(\)\.then\(function \(j\) \{ return \{ ok: r\.ok, status: r\.status, j: j \}; \}\)/.test(engine),
    'request() keeps the Response in scope and reads r.ok — a 403 must never collapse into success');
  A.ok(/function errText\(r, fallback\)/.test(engine), 'errText surfaces the server\'s own error string');
  A.ok(/if \(j && typeof j\.error === 'string' && j\.error\) return j\.error;/.test(engine),
    'errText prefers the server\'s message over a generic one');
}

/* ---------- the guard messages are rendered VERBATIM, never softened ---------- */
{
  // The P1 refusal and the P2 refusal must be shown as the server wrote them — a UI that paraphrased
  // "cannot mark a run supported without verified or analysis evidence" into "could not save" would hide
  // the single most important sentence the Validation Lab produces.
  A.ok(/errText\(r, 'could not save'\)/.test(engine), 'the field save renders the server refusal through errText');
  A.ok(/errText\(r, 'could not record the result'\)/.test(engine), 'the validation save renders the server refusal through errText');
  A.ok(/pick a label first/.test(engine), 'the field editor refuses an unlabelled claim BEFORE sending it');
  A.ok(/each evidence line needs/.test(engine), 'the validation editor refuses an unlabelled evidence line before sending it');
}

/* ---------- the live bus is wired to the Phase 2 events ---------- */
{
  for (const ev of ['opportunity.created', 'opportunity.updated', 'opportunity.deleted',
    'opportunity.promoted', 'validation.recorded', 'task.created']) {
    A.ok(engine.indexOf("'" + ev + "'") >= 0, 'the engine subscribes to ' + ev);
  }
  A.ok(/setTimeout\(function \(\) \{ refreshTimer = null;/.test(engine), 'bus refreshes are debounced (one fetch, not two racing ones)');
}

/* ---------- the templates are FETCHED, not hardcoded (one source of truth) ---------- */
{
  A.ok(/request\('GET', '\/api\/templates'\)/.test(engine), 'the template catalogue is fetched from the sidecar');
  A.ok(!/TEMPLATES\s*=\s*\[\s*'saas'/.test(engine), 'the engine does NOT hardcode a second copy of the §25 catalogue');
}

A.report('businessmaker.test');
