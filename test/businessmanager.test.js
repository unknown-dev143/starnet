'use strict';
/* test/businessmanager.test.js — the BUSINESS MANAGER console (frontend/app/businessmanager.js).

   Two halves, tested two ways.
     The PURE half is require()d and asserted directly: labels, option builders, row shaping, the guards, and
     the formatting helpers. The interesting ones are the guards and the shapes that make a fabrication
     IMPOSSIBLE rather than merely discouraged — totalsView() has no `total` key, metricRows() prints "not
     recorded" instead of 0, and provenanceOptions() opens on an explicit blank.
     The DOM half cannot run headless, so its WIRING is source-locked: the dock button, the window
     registration + title, the script order in index.html, the scoped stylesheet, and the response
     truthfulness of the fetch helper.

   ALSO LOCKED: the stylesheet prefix is .mg-, NOT .bm-. Phase 2's businessmaker.css already owns .bm-, and
   both stylesheets are global once index.html loads them — an overlap would let one console restyle the
   other. This test fails if a .bm- class ever reappears in the Phase 4 engine.
   Pure + fast (no DOM, no fetch, no boot). */
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');

const BM = require('../frontend/app/businessmanager.js');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const html = read('frontend/index.html');
const engine = read('frontend/app/businessmanager.js');
const win = read('frontend/app/windows/manager.js');
const css = read('frontend/css/businessmanager.css');
const glossary = read('frontend/app/glossary.js');

/* the stores own the vocabularies — the engine must not drift from them */
const PROJ = require('../sidecar/business-projects-store.js');
const FIN = require('../sidecar/business-finance.js');
const MET = require('../sidecar/business-metrics.js');
const CRM = require('../sidecar/business-crm-store.js');
const CON = require('../sidecar/business-content-store.js');
const DOC = require('../sidecar/business-documents-store.js');
const KB = require('../sidecar/business-knowledge.js');
const EXP = require('../sidecar/business-experiments-store.js');

/* ---------- labels ---------- */
{
  A.eq(BM.label(BM.PROJECT_STATUS_LABEL, 'active'), 'ACTIVE', 'active reads ACTIVE');
  A.eq(BM.label(BM.PROJECT_STATUS_LABEL, 'nope'), 'NOPE', 'an unknown status echoes upcased rather than inventing a word');
  A.eq(BM.label(BM.KIND_LABEL, 'revenue'), 'REVENUE', 'revenue reads REVENUE');
  A.ok(/AI ESTIMATE/.test(BM.label(BM.PROVENANCE_LABEL, 'ai-estimate')), 'the estimate provenance reads AI ESTIMATE');
  A.ok(/guess/.test(BM.label(BM.PROVENANCE_LABEL, 'ai-estimate')), 'and calls itself a guess');
  A.eq(BM.PROVENANCE_SHORT['actual'], 'ACTUAL', 'the short form of actual is ACTUAL');
  A.eq(BM.label(BM.STAGE_LABEL, 'customer'), 'CUSTOMER', 'customer reads CUSTOMER');
  A.eq(BM.label(BM.CONTENT_STAGE_LABEL, 'publish'), 'PUBLISH', 'publish reads PUBLISH');
  A.eq(BM.label(BM.CONCLUSION_LABEL, 'inconclusive'), 'INCONCLUSIVE', 'inconclusive reads INCONCLUSIVE');
  A.eq(BM.evidenceLabel('verified'), 'VERIFIED', 'verified reads VERIFIED');
}

/* ---------- the vocabularies the engine labels match the stores that own them ---------- */
{
  for (const s of PROJ.STATUSES) A.ok(!!BM.PROJECT_STATUS_LABEL[s], 'project status ' + s + ' has a label');
  for (const k of FIN.KINDS) A.ok(!!BM.KIND_LABEL[k], 'finance kind ' + k + ' has a label');
  for (const p of FIN.PROVENANCE) A.ok(!!BM.PROVENANCE_LABEL[p] && !!BM.PROVENANCE_SHORT[p], 'provenance ' + p + ' has both a long and a short label');
  for (const s of CRM.STAGES) A.ok(!!BM.STAGE_LABEL[s], 'contact stage ' + s + ' has a label');
  for (const k of CRM.INTERACTION_KINDS) A.ok(!!BM.INTERACTION_LABEL[k], 'interaction kind ' + k + ' has a label');
  for (const s of CON.STAGES) A.ok(!!BM.CONTENT_STAGE_LABEL[s], 'content stage ' + s + ' has a label');
  for (const c of CON.CHANNELS) A.ok(!!BM.CHANNEL_LABEL[c], 'channel ' + c + ' has a label');
  for (const t of DOC.TYPES) A.ok(!!BM.DOC_TYPE_LABEL[t], 'document type ' + t + ' has a label');
  for (const s of DOC.STATUSES) A.ok(!!BM.DOC_STATUS_LABEL[s], 'document status ' + s + ' has a label');
  for (const k of KB.KINDS) A.ok(!!BM.KB_KIND_LABEL[k], 'knowledge kind ' + k + ' has a label');
  for (const s of EXP.STATUSES) A.ok(!!BM.EXP_STATUS_LABEL[s], 'experiment status ' + s + ' has a label');
  for (const c of EXP.CONCLUSIONS) A.ok(!!BM.CONCLUSION_LABEL[c], 'conclusion ' + c + ' has a label');
  A.eq(Object.keys(BM.PROJECT_STATUS_LABEL).length, PROJ.STATUSES.length, 'the project status labels cover exactly the store\'s set');
}

/* ---------- option builders: no silent defaults ---------- */
{
  // provenance opens on an explicit blank — the store refuses an unlabelled figure (P2), so a pre-selected
  // first option would be the UI inventing a provenance the user never chose.
  const prov = BM.provenanceOptions(FIN.PROVENANCE, '');
  A.ok(/<option value="" selected>/.test(prov), 'the provenance picker opens on an explicit blank');
  A.ok(/where does this number come from/.test(prov), 'and asks the question rather than defaulting');
  A.ok(!/selected>ACTUAL/.test(prov), 'it does NOT default to actual');
  A.ok(BM.provenanceOptions(FIN.PROVENANCE, 'actual').indexOf('value="actual" selected') >= 0, 'an explicit choice is honoured');

  const met = BM.metricOptions(MET.METRICS, '');
  A.ok(/<option value="" selected>/.test(met), 'the metric picker opens on an explicit blank');
  A.ok(/Visitors \(count\)/.test(met), 'each metric shows its unit');

  const opts = BM.optionsFrom(['a', 'b'], { a: 'A' }, '', '— pick —');
  A.ok(/<option value="" selected>/.test(opts), 'optionsFrom with a blank label opens on the blank');
  A.ok(!/selected/.test(BM.optionsFrom(['a'], { a: 'A' })), 'optionsFrom with no blank arg emits no blank option');
}

/* ---------- row shaping ---------- */
{
  const pr = BM.projectRows([{ id: 'acme~p1', name: 'Launch', status: 'done' }])[0];
  A.eq(pr.statusLabel, 'DONE', 'the project status is labelled');
  A.eq(pr.done, true, 'a done project is flagged');
  const pr2 = BM.projectRows([{ id: 'x', name: 'Y', status: 'active' }])[0];
  A.eq(pr2.done, false, 'an active project is not');

  const tx = BM.transactionRows([{ id: 'acme~f1', kind: 'revenue', amount: 10, currency: 'USD', category: 'sales', provenance: 'ai-estimate', at: 0 }], 0)[0];
  A.eq(tx.kindLabel, 'REVENUE', 'the kind is labelled');
  A.eq(tx.isEstimate, true, 'an ai-estimate row is flagged');
  A.eq(tx.provenanceLabel, 'AI ESTIMATE', 'and its short provenance label reads AI ESTIMATE');

  const doc = BM.documentRows([{ id: 'd', title: 'T', type: 'sop', status: 'draft', body: 'abcde' }])[0];
  A.eq(doc.chars, 5, 'the character count is computed');
  A.eq(doc.typeLabel, 'SOP', 'the type is labelled');
}

/* ================= totalsView: NO blended total, recorded and estimated stay apart ================= */
{
  const tv = BM.totalsView({ byCurrency: { USD: { recorded: { revenue: 170, expense: 30, profit: 140, count: 3 }, estimated: { revenue: 999, expense: 0, profit: 999, count: 1 } } } });
  A.eq(tv.length, 1, 'one currency row');
  A.eq(tv[0].currency, 'USD', 'the currency is named');
  A.eq(tv[0].recorded.profit, '$140', 'recorded profit is formatted from the recorded figures');
  A.eq(tv[0].estimated.revenue, '$999', 'the estimate is carried separately');
  A.ok(!('total' in tv[0]), 'there is NO `total` key on the view');
  A.ok(JSON.stringify(tv).indexOf('1169') < 0, 'the blended sum appears nowhere');
  A.eq(tv[0].recorded.profitNegative, false, 'a positive profit is not flagged negative');
  A.eq(BM.totalsView({ byCurrency: { USD: { recorded: { revenue: 0, expense: 50, profit: -50, count: 1 }, estimated: { revenue: 0, expense: 0, profit: 0, count: 0 } } } })[0].recorded.profitNegative, true, 'a loss IS flagged');
}

/* ================= metricRows: an unrecorded metric reads "not recorded", never 0 ================= */
{
  const rows = BM.metricRows([{ metric: 'churn', label: 'Churn', unit: 'rate', latest: null, readings: 0 }, { metric: 'visitors', label: 'Visitors', unit: 'count', latest: 42, readings: 3, evidence: 'verified' }]);
  A.eq(rows[0].recorded, false, 'a metric with latest:null is not recorded');
  A.eq(rows[0].valueText, 'not recorded', 'and prints "not recorded"');
  A.ok(rows[0].valueText !== '0', 'specifically NOT the string "0"');
  A.eq(rows[1].recorded, true, 'a metric with a reading is recorded');
  A.eq(rows[1].valueText, '42', 'and prints its value');
  A.eq(rows[1].evidenceLabel, 'VERIFIED', 'with its evidence class');
}

/* ---------- attentionRows: named rules with their inputs ---------- */
{
  const rows = BM.attentionRows({ overdue: [{ rule: 'overdue-follow-up', contactId: 'c', contactName: 'Dana', what: 'send quote', daysLate: 5 }], quiet: [{ rule: 'no-recent-interaction', contactId: 'c2', contactName: 'Sam', stage: 'lead', daysQuiet: 40 }] });
  A.eq(rows.length, 2, 'both rules produce rows');
  A.eq(rows[0].kind, 'overdue', 'the overdue row is tagged');
  A.eq(rows[0].detail, '5d overdue', 'and carries its raw input');
  A.eq(rows[1].kind, 'quiet', 'the quiet row is tagged');
  A.eq(rows[1].detail, 'quiet 40d', 'with its daysQuiet');
  A.ok(!/score|rank/i.test(JSON.stringify(rows)), 'nothing here is a score');
}

/* ---------- contentBoard: one column per §17 stage, in order ---------- */
{
  const board = BM.contentBoard([{ id: 'n1', title: 'A', channel: 'blog', stage: 'idea' }, { id: 'n2', title: 'B', channel: 'youtube', stage: 'publish' }], CON.STAGES);
  A.eq(board.length, CON.STAGES.length, 'one column per stage');
  A.eq(board.map(c => c.stage), CON.STAGES, 'the columns are in §17 order');
  A.eq(board[0].items.length, 1, 'the idea column holds the idea piece');
  A.eq(board.filter(c => c.stage === 'publish')[0].items.length, 1, 'the publish column holds the published piece');
}

/* ---------- guards mirror the stores ---------- */
{
  // financeGuard
  A.eq(BM.financeGuard({}).allowed, false, 'an empty finance draft is refused');
  A.eq(BM.financeGuard({ kind: 'revenue' }).allowed, false, 'no amount -> refused');
  A.eq(BM.financeGuard({ kind: 'revenue', amount: 0 }).allowed, false, 'amount 0 -> refused');
  A.eq(BM.financeGuard({ kind: 'revenue', amount: 10, currency: 'US' }).allowed, false, 'a 2-letter currency -> refused');
  A.eq(BM.financeGuard({ kind: 'revenue', amount: 10, currency: 'USD', category: 'sales' }).allowed, false, 'no provenance -> refused (P2)');
  A.ok(/P2/.test(BM.financeGuard({ kind: 'revenue', amount: 10, currency: 'USD', category: 'sales' }).reason), 'and the refusal cites P2');
  A.eq(BM.financeGuard({ kind: 'revenue', amount: 10, currency: 'USD', category: 'sales', provenance: 'ai-estimate' }).allowed, false, 'an ai-estimate with no basis -> refused');
  A.eq(BM.financeGuard({ kind: 'revenue', amount: 10, currency: 'USD', category: 'sales', provenance: 'imported' }).allowed, false, 'an imported row with no source -> refused');
  A.eq(BM.financeGuard({ kind: 'revenue', amount: 10, currency: 'USD', category: 'sales', provenance: 'actual' }).allowed, true, 'a fully-labelled row is allowed');

  // metricGuard
  A.eq(BM.metricGuard({}, MET.METRICS).allowed, false, 'an empty metric draft is refused');
  A.eq(BM.metricGuard({ metric: 'visitors', value: -1 }, MET.METRICS).allowed, false, 'a negative value -> refused');
  A.eq(BM.metricGuard({ metric: 'conversion-rate', value: 3.2 }, MET.METRICS).allowed, false, 'a rate above 1 -> refused');
  A.ok(/fraction/i.test(BM.metricGuard({ metric: 'conversion-rate', value: 3.2 }, MET.METRICS).reason), 'and explains it is a fraction');
  A.eq(BM.metricGuard({ metric: 'visitors', value: 10, source: 'x' }, MET.METRICS).allowed, false, 'no evidence class -> refused');
  A.eq(BM.metricGuard({ metric: 'visitors', value: 10, evidence: 'verified' }, MET.METRICS).allowed, false, 'no source -> refused (P1)');
  A.eq(BM.metricGuard({ metric: 'visitors', value: 10, source: 'x', evidence: 'verified' }, MET.METRICS).allowed, true, 'a complete reading is allowed');

  // knowledgeGuard
  A.eq(BM.knowledgeGuard({}).allowed, false, 'an empty knowledge draft is refused');
  A.eq(BM.knowledgeGuard({ kind: 'note' }).allowed, false, 'no title -> refused');
  A.eq(BM.knowledgeGuard({ kind: 'note', title: 'X' }).allowed, false, 'no source -> refused (P1)');
  A.eq(BM.knowledgeGuard({ kind: 'note', title: 'X', source: 'interview' }).allowed, true, 'a complete entry is allowed');

  // contentAdvanceGuard
  A.eq(BM.contentAdvanceGuard(null, 'idea', CON.PUBLISH_STAGES).allowed, false, 'no piece -> refused');
  A.eq(BM.contentAdvanceGuard({ asHuman: false }, 'publish', CON.PUBLISH_STAGES).allowed, false, 'a non-human reaching publish -> refused');
  A.eq(BM.contentAdvanceGuard({ asHuman: false }, 'script', CON.PUBLISH_STAGES).allowed, true, 'a non-human reaching a non-live stage is fine');
  A.eq(BM.contentAdvanceGuard({ asHuman: true }, 'publish', CON.PUBLISH_STAGES).allowed, true, 'a human reaching publish is allowed');

  // conclusionGuard — the four rules
  A.eq(BM.conclusionGuard(null, 'supported').allowed, false, 'no experiment -> refused');
  A.eq(BM.conclusionGuard({ status: 'planned', variants: ['A', 'B'], results: [] }, 'supported').allowed, false, 'a planned experiment cannot conclude');
  A.ok(/End the experiment first/.test(BM.conclusionGuard({ status: 'planned', variants: ['A', 'B'], results: [] }, 'supported').reason), 'and says to end it first');
  A.eq(BM.conclusionGuard({ status: 'ended', variants: ['A'], results: [{ evidence: 'verified' }] }, 'supported').allowed, false, 'a single-arm experiment cannot conclude');
  A.eq(BM.conclusionGuard({ status: 'ended', variants: ['A', 'B'], results: [{ evidence: 'assumption' }] }, 'supported').allowed, false, 'only-assumption evidence cannot conclude');
  A.ok(/cannot carry a verdict/.test(BM.conclusionGuard({ status: 'ended', variants: ['A', 'B'], results: [{ evidence: 'assumption' }] }, 'supported').reason), 'and explains why');
  A.eq(BM.conclusionGuard({ status: 'ended', variants: ['A', 'B'], results: [{ evidence: 'verified' }] }, 'supported').allowed, true, 'an ended, two-arm, verified experiment CAN conclude');
  A.eq(BM.conclusionGuard({ status: 'planned', variants: [], results: [] }, 'inconclusive').allowed, true, 'inconclusive is ALWAYS allowed (the honest answer is never blocked)');
}

/* ---------- summaryLine ---------- */
{
  A.ok(/No business selected/.test(BM.summaryLine(null, {})), 'no business says so');
  A.ok(/Nothing recorded/.test(BM.summaryLine({ name: 'X' }, {})), 'a business with nothing recorded says so');
  const line = BM.summaryLine({ name: 'X' }, { projects: 2, transactions: 5 });
  A.ok(/2 projects/.test(line) && /5 transactions/.test(line), 'counts are joined');
  A.ok(!/%|score/i.test(line), 'nothing is a percentage or a score');
}

/* ---------- formatting ---------- */
{
  A.eq(BM.money(1000, 'USD'), '$1,000', 'a thousands figure is grouped with its symbol');
  A.eq(BM.money(12.5, 'CNY'), '¥12.5', 'CNY uses the ¥ symbol');
  A.eq(BM.money(NaN, 'USD'), '—', 'a non-number renders as a dash, never 0');
  A.eq(BM.relTime(1, 30001), '30s ago', 'seconds are relative to the injected now');
  A.eq(BM.relTime(1, 3600001), '1h ago', 'and hours');
  A.eq(BM.relTime(0, 30000), '', 'an absent timestamp renders as nothing, not "0s ago"');
}

/* ================= the DOM half: wiring source-locks ================= */

/* ---------- the dock button, the window slot, and the load order ---------- */
{
  A.ok(/<button class="bb" data-term="manager" data-hint="manager"/.test(html), 'index.html has the BUSINESS MANAGER dock button (.bb[data-term="manager"])');
  A.ok(/manager:\s*'/.test(glossary), 'glossary.js defines a `manager` term, so the data-hint resolves');
  A.ok(/StationUI\.registerWindow\('manager', 'MANAGER'/.test(win), 'windows/manager.js registers the window under the title the dock shows (TITLE LAW)');
  A.ok(/BusinessManager\.mount\(body\)/.test(win), 'the window slot mounts the engine');
  A.ok(/typeof BusinessManager === 'undefined'/.test(win), 'the slot degrades honestly when the engine is missing');
  A.ok(/mg-empty/.test(win), 'and its degradation message uses the .mg- prefix, not another console\'s');

  const iEngine = html.indexOf('app/businessmanager.js');
  const iWin = html.indexOf('app/windows/manager.js');
  const iSui = html.indexOf('app/stationui.js');
  A.ok(iEngine > 0 && iWin > 0, 'both files are loaded by index.html');
  A.ok(iEngine < iWin, 'the engine loads BEFORE the window slot that calls it');
  A.ok(iSui > 0 && iSui < iWin, 'stationui.js loads before the slot that registers with it');
  A.ok(/css\/businessmanager\.css/.test(html), 'the scoped stylesheet is linked');
}

/* ---------- the engine is UMD and mounts an 8-pane console ---------- */
{
  A.ok(/root\.BusinessManager = api/.test(engine), 'the engine exports itself as root.BusinessManager (UMD)');
  A.ok(/mountConsole\(body, 'manager',/.test(engine), 'mount() builds the console under the "manager" key');
  const panes = ['overview', 'projects', 'finance', 'analytics', 'customers', 'content', 'library', 'experiments'];
  for (const p of panes) A.ok(new RegExp("id: '" + p + "'").test(engine), 'the console has a ' + p + ' pane');
  const order = panes.map(p => engine.indexOf("id: '" + p + "'"));
  for (let i = 1; i < order.length; i++) A.ok(order[i - 1] < order[i], 'the panes are in order (' + panes[i - 1] + ' before ' + panes[i] + ')');
}

/* ---------- destructive controls arm through ArmConfirm, never a native dialog ---------- */
{
  A.ok(!/window\s*\.\s*(alert|confirm|prompt)\s*\(/.test(engine), 'the engine calls NO native window dialog');
  A.ok(/ArmConfirm\.wire\(/.test(engine), 'REMOVE / FORGET / project-delete arm through the shared ArmConfirm helper');
  A.ok(/function arm\(btn, lbl, onConfirm\)/.test(engine), 'there is ONE local arm() helper');
  A.ok(/confirmation helper unavailable/.test(engine), 'the arm helper is FAIL-CLOSED: with no ArmConfirm the control disables rather than firing unconfirmed');
}

/* ---------- the fetch helper reads the Response (the frontend truth ratchet) ---------- */
{
  A.ok(/r\.ok/.test(engine), 'request() reads r.ok — a 403 must never collapse into success');
  A.ok(/function errText\(r, fallback\)/.test(engine), 'errText surfaces the server\'s own error string');
}

/* ================= the stylesheet prefix: .mg-, NEVER .bm- ================= */
{
  // Phase 2's businessmaker.css already owns .bm-* and both sheets are global. A .bm- class in the Phase 4
  // engine (or a .bm- rule in this stylesheet) would let one console restyle the other.
  A.ok(!/bm-[a-z]/.test(engine), 'the engine emits NO .bm-* class (that prefix belongs to businessmaker.css)');
  A.ok(/mg-/.test(engine), 'the engine emits .mg-* classes');
  A.ok(!/^\s*\.bm-/m.test(css), 'the stylesheet defines NO .bm-* rules');
  A.ok(/^\s*\.mg-/m.test(css), 'the stylesheet defines .mg-* rules');
  A.ok(/\.mg-total-est/.test(css), 'the AI-ESTIMATE block is styled apart from the recorded one');
  A.ok(/\.mg-hint\.mg-blocked/.test(css), 'a refusal hint (.mg-blocked) has its own styling');
}

A.report('businessmanager');
