'use strict';
/* businessautopilot.test.js — the GOAL AUTOPILOT console, PURE half (Business OS Phase 12, §9).

   The console's whole honesty problem is that an autopilot is the feature most tempted to LOOK cleverer than
   it is. So this suite locks:
     · a missing/failed payload is NOT a clean empty view (ok must be explicit true);
     · a refusal is shaped as a refusal, with its alternatives, and carries NO tasks;
     · a plan preview shows the matched tokens (the match is checkable) and is flagged STAGED;
     · a commit is shaped differently from a plan — it names the business and carries the store's rows;
     · nothing anywhere carries a score, a grade, a percentage or a confidence.                          */

const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const C = require('../frontend/app/businessautopilot.js');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'businessautopilot.js'), 'utf8');

/* ---------- esc / str ---------- */
{
  A.eq(C.esc('<b>&"\'</b>'), '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;', 'esc neutralises every html metacharacter');
  A.eq(C.str(null), '', 'null → empty string');
  A.eq(C.str(0), '0', '0 survives (not treated as empty)');
}

/* ---------- shapeCatalog: a missing payload is NOT a clean empty view ---------- */
{
  A.eq(C.shapeCatalog(null).ok, false, 'no catalogue → not ok');
  A.eq(C.shapeCatalog({}).ok, false, 'a payload without ok:true → not ok');
  A.eq(C.shapeCatalog({ goals: [] }).ok, false, 'goals but no ok:true → still not ok (unreadable ≠ empty)');
  const c = C.shapeCatalog({ ok: true, goals: [{ id: 'g1', label: 'Launch', template: 'dp', keywords: ['launch', 'digital'], taskCount: 10 }], note: 'closed' });
  A.eq(c.ok, true, 'an explicit ok:true → ok');
  A.eq(c.count, 1, 'counts the goals');
  A.eq(c.rows[0].keywordText, 'launch · digital', 'the tokens are joined for display');
  A.eq(c.note, 'closed', 'the note passes through');
}

/* ---------- shapePlan: refusal ---------- */
{
  A.eq(C.shapePlan(null).ok, false, 'no plan → not ok');
  const r = C.shapePlan({ ok: false, reason: 'no plan for that goal', knownGoals: ['Launch a digital product'] });
  A.eq(r.ok, false, 'an unknown goal shapes as a refusal');
  A.eq(r.plan, false, 'and is NOT a plan');
  A.ok(r.reason.indexOf('no plan') >= 0, 'the reason passes through');
  A.eq(r.knownGoals.length, 1, 'the alternatives come through');
  A.eq('tasks' in r, false, 'a refusal carries NO tasks field');
}

/* ---------- shapePlan: a good plan ---------- */
{
  const p = C.shapePlan({
    ok: true, kind: 'plan', goal: 'Launch a digital product', template: 'digital-product',
    source: 'master prompt §9', matchedBy: ['launch', 'digital', 'product'], staged: true,
    tasks: [{ title: 'Research market', priority: 'normal' }, { title: 'Launch', priority: 'high', approvalRequired: true }]
  });
  A.eq(p.ok, true, 'a plan is ok');
  A.eq(p.plan, true, 'and flagged as a plan');
  A.eq(p.taskCount, 2, 'the tasks are counted');
  A.eq(p.matchedText, 'launch + digital + product', 'the matched tokens are shown joined');
  A.eq(p.staged, true, 'the staged flag is carried (nothing is written yet)');
  A.eq(p.tasks[0].n, 1, 'tasks are numbered from 1');
  A.eq(p.tasks[1].approvalRequired, true, 'a task needing approval is flagged');
}

/* ---------- shapeCommit: distinct from a plan ---------- */
{
  A.eq(C.shapeCommit(null).ok, false, 'no commit payload → not ok');
  const c = C.shapeCommit({ ok: true, goal: 'Launch a digital product', businessId: 'acme', created: 2, chained: true,
    tasks: [{ id: 'acme~t1', title: 'Research market', status: 'todo' }, { id: 'acme~t2', title: 'Launch', status: 'todo' }] });
  A.eq(c.ok, true, 'a commit is ok');
  A.eq(c.committed, true, 'and flagged as committed (not a plan)');
  A.eq(c.businessId, 'acme', 'it names the business');
  A.eq(c.created, 2, 'the created count comes through');
  A.eq(c.chained, true, 'the chained flag comes through');
  A.ok(c.tasks[0].id.indexOf('acme~') === 0, 'it carries the STORE\'s rows (with their ids)');
  A.eq('staged' in c, false, 'a commit result has no staged flag — it is not a plan');
}

/* ---------- validateGoal ---------- */
{
  A.eq(C.validateGoal('').ok, false, 'an empty goal is refused');
  A.eq(C.validateGoal('   ').ok, false, 'whitespace is not a goal');
  A.eq(C.validateGoal('launch a digital product').ok, true, 'a real goal passes');
  A.eq(C.validateGoal('x'.repeat(500)).ok, false, 'an over-long goal is refused');
}

/* ---------- headLine: never a percentage ---------- */
{
  const line1 = C.headLine({}, { ok: true, count: 3 });
  A.ok(line1.indexOf('3 goals known') >= 0, 'it reports the known-goal count');
  A.ok(line1.indexOf('%') < 0, 'and NO percentage anywhere');
  const line2 = C.headLine({ committed: { created: 3 } }, { ok: true, count: 1 });
  A.ok(line2.indexOf('committed 3 tasks') >= 0, 'a commit is summarised as a count, not progress');
  const line3 = C.headLine({ plan: { ok: true, taskCount: 4 } }, { ok: true, count: 1 });
  A.ok(line3.indexOf('plan of 4 tasks') >= 0, 'a held plan is summarised as a count');
}

/* ---------- source-locks: NO score/grade/percentage, and the honesty line is present ---------- */
{
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  A.ok(!/\bscore\b|\bgrade\b|\bhealth\b|\bpriority score\b|\bconfidence\b/i.test(CODE), 'the CODE has no score/grade/health/confidence');
  A.ok(!/Date\.now/.test(CODE), 'no clock read (the module reads none itself)');
  A.ok(SRC.indexOf('staged') >= 0 && SRC.indexOf('nothing has been written') >= 0, 'the staged/nothing-written line is present');
  A.ok(SRC.indexOf('the goal set is closed') >= 0 || SRC.indexOf('CLOSED') >= 0, 'the closed-set framing is present');
}

A.report('businessautopilot');
