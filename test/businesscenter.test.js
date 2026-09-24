/* node test/businesscenter.test.js — the BUSINESS COMMAND CENTER (frontend/app/businesscenter.js).

   Two halves, tested two ways.
     The PURE half is require()d and asserted directly — labels, row shaping, the summary, and the RUN GUARD,
     which is the interesting one: the UI must refuse exactly what the sidecar refuses, or the dock offers a
     launch the engine rejects and the button reads as broken.
     The DOM half cannot run headless, so its WIRING is source-locked: the dock button, the window
     registration, the script order in index.html, and the response-truthfulness of the fetch helper (the
     frontend's response-discarding-parse ratchet would otherwise be free to regress it).
   Pure + fast (no DOM, no fetch, no boot). */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');

const BC = require('../frontend/app/businesscenter.js');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const html = read('frontend/index.html');
const engine = read('frontend/app/businesscenter.js');
const win = read('frontend/app/windows/business.js');
const host = read('sidecar/index.js');

/* ---------- labels ---------- */
A.eq(BC.stageLabel('live'), 'LIVE', 'live reads LIVE');
A.eq(BC.stageLabel('paused'), 'PAUSED', 'paused reads PAUSED');
A.eq(BC.stageLabel('moonshot'), 'UNKNOWN', 'an unknown stage reads UNKNOWN — never a plausible guess');
A.eq(BC.stageLabel(null), 'UNKNOWN', 'a null stage reads UNKNOWN');
A.eq(BC.templateLabel('digital-product'), 'DIGITAL PRODUCT', 'the digital-product template is spelled out');
A.eq(BC.templateLabel('nope'), 'CUSTOM', 'an unknown template falls back to CUSTOM');
A.eq(BC.resultLabel('error'), 'FAILED', 'an error result reads FAILED');
A.eq(BC.approvalLabel('not-required'), '', 'a not-required approval renders nothing (no noise)');
A.eq(BC.approvalLabel('denied'), 'DENIED', 'a denied approval is stated');
A.eq(BC.actorLabel('agent'), 'AI', 'an agent actor reads AI');
A.eq(BC.actorLabel('nobody'), 'SYSTEM', 'an unknown actor reads SYSTEM');

/* ---------- relTime: injected clock, and a clock skew must not invent a negative age ---------- */
A.eq(BC.relTime(0, 1000), '', 'an un-touched stamp renders nothing rather than "56y"');
A.eq(BC.relTime(null, 1000), '', 'a null stamp renders nothing');
A.eq(BC.relTime(1000, 1000 + 30000), 'now', 'under a minute reads now');
A.eq(BC.relTime(1000, 1000 + 5 * 60000), '5m', 'minutes');
A.eq(BC.relTime(1000, 1000 + 3 * 3600000), '3h', 'hours');
A.eq(BC.relTime(1000, 1000 + 2 * 86400000), '2d', 'days');
A.eq(BC.relTime(5000, 1000), 'now', 'a future stamp (clock skew) reads now, never "-4m"');

/* ---------- THE RUN GUARD: the UI's refusal must match the sidecar's ---------- */
A.eq(BC.runGuard({ stage: 'live' }).allowed, true, 'a live business may run work');
A.eq(BC.runGuard({ stage: 'idea' }).allowed, true, 'an idea-stage business may run work (planning IS work)');
A.eq(BC.runGuard({ stage: 'building' }).allowed, true, 'a building business may run work');
A.eq(BC.runGuard({ stage: 'paused' }).allowed, false, 'a PAUSED business may not run work');
A.eq(BC.runGuard({ stage: 'archived' }).allowed, false, 'an ARCHIVED business may not run work');
A.ok(/PAUSED/.test(BC.runGuard({ stage: 'paused' }).reason), 'the pause refusal names the reason a human can act on');
A.ok(/resume/i.test(BC.runGuard({ stage: 'paused' }).reason), 'the pause refusal says how to fix it');
A.eq(BC.runGuard(null).allowed, true, 'a missing business does not block (no false refusal)');
// the sidecar enforces exactly these two stages — if it ever grows a third, this lock goes red.
A.ok(/biz\.stage === 'paused' \|\| biz\.stage === 'archived'/.test(host),
  'sidecar/index.js refuses runs for exactly paused|archived — the same two the UI guard blocks');
A.ok(/409/.test(host) && /resume it before running work for it/.test(host),
  'the sidecar answers 409 with an actionable reason, matching the UI copy');

/* ---------- toRows ---------- */
{
  const rows = BC.toRows([
    { id: 'acme', name: 'Acme', stage: 'live', template: 'saas', createdBy: 'user', updatedAt: 1000, description: 'd' },
    { id: 'globex', name: 'Globex', stage: 'paused', template: 'agency', createdBy: 'ai', updatedAt: 2000 }
  ], 1000 + 5 * 60000);
  A.eq(rows.length, 2, 'two businesses -> two rows');
  A.eq(rows[0].id, 'acme', 'server order is preserved');
  A.eq(rows[0].stageLabel, 'LIVE', 'the row carries a display stage');
  A.eq(rows[0].templateLabel, 'SAAS', 'the row carries a display template');
  A.eq(rows[0].createdLabel, 'YOURS', 'a user-created business reads YOURS');
  A.eq(rows[1].createdLabel, 'AI-PROPOSED', 'an ai-created business reads AI-PROPOSED — provenance is never blurred');
  A.eq(rows[0].updatedRel, '5m', 'the row carries a relative stamp');
  A.eq(rows[0].paused, false, 'a live row is not flagged paused');
  A.eq(rows[1].paused, true, 'a paused row is flagged');
  A.eq(rows[1].guard.allowed, false, 'the paused row carries its run guard');
  A.eq(BC.toRows(null), [], 'a null list is an empty list, not a throw');
  const junk = BC.toRows([null, { id: 'x' }], 1000);
  A.eq(junk[0].name, '(unnamed)', 'a malformed row is rendered honestly, not dropped or crashed on');
  A.eq(junk[0].stageLabel, 'IDEA', 'a missing stage defaults to IDEA (the store’s own default)');
}

/* ---------- activityRows ---------- */
{
  const rows = BC.activityRows([
    { id: 'a#2', seq: 2, action: 'Business paused', result: 'ok', approval: 'not-required', at: 1000, actor: { kind: 'user' }, detail: 'stopped 2 in-flight runs' },
    { id: 'a#1', seq: 1, action: 'Business created', result: 'ok', approval: 'not-required', at: 500, actor: { kind: 'system' } }
  ], 1000 + 60000);
  A.eq(rows.length, 2, 'two entries -> two rows');
  A.eq(rows[0].actorLabel, 'YOU', 'a user action is attributed to YOU');
  A.eq(rows[1].actorLabel, 'SYSTEM', 'a system action is attributed to SYSTEM');
  A.eq(rows[0].detail, 'stopped 2 in-flight runs', 'the detail is carried through verbatim');
  A.eq(rows[0].rel, '1m', 'the row carries a relative stamp');
  const junk = BC.activityRows([{ action: 'x' }], 1000);
  A.eq(junk[0].actorLabel, 'SYSTEM', 'a missing actor reads SYSTEM (the store’s own defensive default)');
  A.eq(BC.activityRows(null), [], 'a null log is an empty log');
}

/* ---------- summarize + summaryLine: honest counts, and a zero is explained ---------- */
{
  const sum = BC.summarize([
    { stage: 'live' }, { stage: 'live' }, { stage: 'paused' }, { stage: 'archived' }, { stage: 'idea' }
  ]);
  A.eq(sum.total, 5, 'total counts every business');
  A.eq(sum.byStage.live, 2, 'per-stage counts are real');
  A.eq(sum.paused, 1, 'paused is counted');
  A.eq(sum.archived, 1, 'archived is counted');
  A.eq(sum.active, 3, 'active = neither paused nor archived');
  A.eq(BC.summarize([]).total, 0, 'an empty station summarizes to 0');
  A.eq(BC.summarize([{ stage: 'bogus' }]).other, 1, 'an unknown stage is counted as OTHER, never silently dropped');
  A.ok(/No businesses yet/.test(BC.summaryLine(BC.summarize([]))), 'a zero-state summary says what to do next');
  A.ok(/5 businesses/.test(BC.summaryLine(sum)), 'the summary line states the real total');
  A.ok(/3 active/.test(BC.summaryLine(sum)), 'the summary line states the real active count');
  A.eq(BC.summaryLine(BC.summarize([{ stage: 'live' }])), '1 business · 1 active', 'a single business reads singular');
}

/* ---------- option builders drive the real vocabularies ---------- */
{
  A.eq(BC.stageOptions('paused').length, BC.STAGES.length, 'every stage is offered');
  A.eq(BC.stageOptions('paused').filter(o => o.selected).length, 1, 'exactly one stage is selected');
  A.eq(BC.stageOptions('paused').find(o => o.selected).value, 'paused', 'the CURRENT stage is the selected one');
  A.eq(BC.templateOptions('agency').find(o => o.selected).value, 'agency', 'the current template is selected');
}

/* ---------- esc ---------- */
A.eq(BC.esc('<b>&"\'</b>'), '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;', 'esc neutralises every HTML-significant character');
A.eq(BC.esc(null), '', 'esc(null) is empty, not "null"');

/* ---------- errText: the honest failure sentence ---------- */
A.eq(BC.errText({ ok: false, status: 403, j: { error: 'nope' } }, 'fallback'), 'nope', 'the body error wins when present');
A.eq(BC.errText({ ok: false, status: 403, j: {} }, 'could not load'), 'could not load (HTTP 403)', 'a bodyless refusal still names the status');
A.eq(BC.errText({ ok: false, status: 0, j: null }, 'boom'), 'boom', 'no status and no body -> the caller’s sentence');

/* ---------- WIRING: the dock button, the window slot, the script order ---------- */
A.ok(/<button class="bb" data-term="business"/.test(html), 'index.html has the BUSINESS dock button (.bb[data-term="business"])');
A.ok(/app\/businesscenter\.js/.test(html), 'index.html loads the Business Center engine (a missing tag fails silently — locked here)');
A.ok(/app\/windows\/business\.js/.test(html), 'index.html loads the BUSINESS window slot');
A.ok(html.indexOf('app/businesscenter.js') < html.indexOf('app/windows/business.js'),
  'the engine loads BEFORE the window slot that uses it');
A.ok(html.indexOf('app/stationui.js') < html.indexOf('app/windows/business.js'),
  'stationui.js loads before the slot (registerWindow must exist when it runs)');
A.ok(/css\/businesscenter\.css/.test(html), 'index.html loads the scoped Business Center stylesheet');

// TITLE LAW: the dock label must match (or prefix) the window title.
A.ok(/StationUI\.registerWindow\(\s*'business'\s*,\s*'BUSINESS'/.test(win),
  "windows/business.js registers key 'business' with title 'BUSINESS' (the dock label matches it)");
A.ok(/opts\.console|console:\s*true/.test(win), 'the window opts into CONSOLE mode (it has sections, not one scroll)');
A.ok(/BusinessCenter\.mount/.test(win), 'the slot calls the engine’s mount — the window is not a second implementation');
A.ok(/typeof BusinessCenter === 'undefined'/.test(win),
  'a missing engine degrades with an honest message rather than an empty console that reads as "no businesses"');

// the DOM half must actually use the console framework, and must not re-implement window chrome.
A.ok(/SUI\.h\.mountConsole\(body,\s*'business'/.test(engine),
  'mount() builds the window through StationUI.h.mountConsole (the shared console framework)');
A.ok(/'list'/.test(engine) && /'activity'/.test(engine) && /'new'/.test(engine),
  'the console declares its three sections: businesses · activity · new');

/* ---------- RESPONSE TRUTHFULNESS: the helper keeps the Response in scope ---------- */
// The frontend ratchet (frontend-fetch-truth-ratchet.test.js) bans the response-DISCARDING parse shape. The
// helper must read r.ok, so a plain-text 403 or a proxy HTML page can never collapse into {} and render as
// success (an empty list) or as a fabricated "created".
A.ok(/r\.ok/.test(engine), 'the fetch helper reads r.ok — a non-2xx can never render as success');
A.ok(!/await\s*\(\s*await\s+fetch\s*\(/.test(engine), 'no await-discarding fetch parse (the ratchet’s Form 1)');
A.ok(!/\.then\(\s*\(?\s*r\s*\)?\s*=>\s*r\.json\(\)\s*\)/.test(engine), 'no then-discarding parse (the ratchet’s Form 2)');

/* ---------- THE E-STOP IS ONE ACTION, NOT TWO ---------- */
// Setting the stage IS the stop. A separate /halt route would be a second door to one action, and the two
// would drift. The engine sends a stage and reports the sidecar's real `halted` count — nothing more.
A.ok(!/\/halt/.test(engine), 'the UI pauses by setting the stage — there is no second halt door to drift from it');
A.ok(/r\.j\.halted|j\.halted/.test(engine), 'the UI reports the sidecar’s real halted count rather than claiming a stop');
A.ok(/PATCH/.test(engine), 'the stage change goes through PATCH /api/businesses/:id — the route the sidecar mounts');
/* The confirmation pattern, source-locked. It was window.confirm; it is now the house two-press arm, because
   an OS modal over the phosphor terminal is banned (test/station-tooltip.test.js). Assert BOTH halves: the
   native dialog is gone, AND a real confirmation replaced it — deleting the confirmation without deleting the
   dialog would be the dangerous regression, and only asserting the absence would not catch it. */
A.ok(!/window\s*\.\s*(alert|confirm|prompt)\s*\(/.test(engine), 'the engine calls NO native window dialog');
A.ok(/ArmConfirm\.wire\(/.test(engine), 'destructive controls arm through the shared ArmConfirm helper');
A.ok(/armedPause/.test(engine), 'a PAUSE is armed: the first press is refused and the row is marked (state.armedPause)');
A.ok(/state\.armedPause !== id/.test(engine), 'the first change to PAUSED is refused — it does not commit');
A.ok(/state\.armedPause = ''/.test(engine), 'any other stage change disarms, so a stale arm cannot linger');

/* ---------- the sidecar really is wired (the 4th-seam lesson, applied to the frontend’s counterpart) ---------- */
A.ok(/emit:\s*\(name,\s*payload\)\s*=>\s*chanEmit\(name,\s*payload\)/.test(host), 'index.js injects chanEmit into the business routes');
A.ok(/onPause:\s*\(id\)\s*=>\s*haltBusiness\(id\)/.test(host), 'index.js injects haltBusiness as the pause handler');
A.ok(/function haltBusiness\(businessId\)/.test(host), 'haltBusiness is defined in the host');
A.ok(/killScope\(id,/.test(host), 'haltBusiness uses the SCOPED kill, not the station-wide one');
A.ok(/businessId:\s*businessTag/.test(host), 'an interactive run is tagged with its business in runsMeta (what the scope matches on)');
A.ok(/const \{ killAll, killScope \} = require\('\.\/halt\.js'\)/.test(host), 'the host imports the scoped kill');

A.report('businesscenter.test');
