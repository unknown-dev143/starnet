'use strict';
/* business-autopilot.test.js — the §9 GOAL AUTOPILOT single entry (Business OS Phase 12).

   §9's whole point is that a user can walk in with a big objective and come out with it IN THE SYSTEM. The
   thing that must never happen is the autopilot inventing a plan for an objective it does not actually know —
   a fabricated plan a user acts on is strictly worse than an honest refusal.

   So this suite locks four properties, each of which stops a specific lie:
     1. NO MATCH, NO PLAN      — an unknown goal is refused and names the goals that ARE known.
     2. THE MATCH IS SHOWN     — a resolved plan carries matchedBy + source; the match is checkable.
     3. RESOLVE WRITES NOTHING — resolve() is read-only even when a task store is wired.
     4. COMMIT RELAYS, NEVER FABRICATES — a store refusal (missing business, task cap, bad title) is returned
                                  verbatim and nothing is half-written.                                                            */

const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const { makeBusinessAutopilot } = require('../sidecar/business-autopilot.js');
const templates = require('../sidecar/business-templates.js');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'business-autopilot.js'), 'utf8');

/* A tiny fake task store that mirrors business-tasks-store.materialise's contract: it validates, it can
   refuse, and it returns { ok, tasks, chained }. It records what it was asked so a test can prove resolve()
   never called it. */
function mkTasks(opts) {
  opts = opts || {};
  const calls = [];
  return {
    calls: calls,
    materialise(businessId, planTasks, meta) {
      calls.push({ businessId: businessId, tasks: planTasks, meta: meta });
      if (opts.refuse) return { ok: false, reason: opts.refuse };
      return {
        ok: true,
        chained: !(meta && meta.chain === false),
        tasks: planTasks.map((t, i) => ({ id: businessId + '~t' + (i + 1), title: t.title, status: 'todo' }))
      };
    }
  };
}

function mkBiz(exists) {
  const map = {};
  (exists || []).forEach(id => { map[id] = { id: id, name: id }; });
  return { get: (id) => map[id] || null };
}

function mk(over) {
  over = over || {};
  return makeBusinessAutopilot(Object.assign({
    templates: templates,
    tasks: over.tasks !== undefined ? over.tasks : mkTasks(),
    businesses: over.businesses !== undefined ? over.businesses : mkBiz(['acme'])
  }, over.deps || {}));
}

/* ---------- construction guards ---------- */
{
  A.throws(() => makeBusinessAutopilot({}), 'no templates → refuses to construct');
  A.throws(() => makeBusinessAutopilot({ templates: {} }), 'a templates object without goalPlan → refuses');
  A.notThrows(() => mk(), 'templates alone constructs (resolve-only, no task store required)');
}

/* ---------- the catalogue is CLOSED and honest ---------- */
{
  const a = mk();
  const c = a.catalog();
  A.eq(c.ok, true, 'the catalogue answers');
  A.eq(c.count, templates.GOAL_PLANS.length, 'it lists exactly the goals the templates know');
  A.eq(c.goals.length, c.count, 'goals array length matches count');
  A.ok(c.goals[0].keywords.length > 0, 'each goal carries the tokens that fire it');
  A.ok(c.note.indexOf('CLOSED') >= 0, 'the note says the set is closed');
  A.ok(!('score' in c) && !('rank' in c), 'no score/rank — it is a catalogue, not a ranking');
  // the catalogue must READ from templates, not carry a second copy (P4)
  const labels = templates.GOAL_PLANS.map(g => g.label);
  A.eq(c.goals.map(g => g.label).join('|'), labels.join('|'), 'the labels come straight from the templates module');
}

/* ---------- resolve: a known goal expands to a full, ordered plan ---------- */
{
  const a = mk();
  const r = a.resolve({ goal: 'launch a digital product' });
  A.eq(r.ok, true, 'the §9 worked example resolves');
  A.eq(r.kind, 'plan', 'the result is a PLAN, not a job');
  A.eq(r.staged, true, 'and it says so — a resolved plan is staged, not committed');
  A.eq(r.template, 'digital-product', 'it names the template');
  A.eq(r.matchedBy.join(' '), 'launch digital product', 'it reports the tokens that matched');
  A.ok(r.source.indexOf('§9') >= 0, 'and the source of the plan');
  A.ok(r.tasks.length >= 8, 'it expands to a real task list');
  A.ok(r.tasks.every(t => t.title && t.priority), 'every task has a title and a priority');
  A.eq(r.taskCount, r.tasks.length, 'taskCount matches the tasks');
  A.ok(!('score' in r) && !('confidence' in r), 'no invented confidence on a deterministic match');
}

/* ---------- resolve: an UNKNOWN goal is refused with the known set (P7) ---------- */
{
  const a = mk();
  const r = a.resolve({ goal: 'expand to europe and double revenue' });
  A.eq(r.ok, false, 'an unknown goal is refused');
  A.ok(r.reason.indexOf('no plan') >= 0 || r.reason.length > 0, 'the refusal carries a reason');
  A.ok(r.knownGoals && r.knownGoals.length > 0, 'and names the goals that ARE known');
  A.eq(r.knownGoals.join('|'), templates.GOAL_PLANS.map(g => g.label).join('|'), 'the known set is the real one, not a placeholder');
  A.eq('tasks' in r, false, 'NO tasks are returned on a refusal — nothing is invented');
}

/* ---------- resolve: empty and partial goals ---------- */
{
  const a = mk();
  A.eq(a.resolve({}).ok, false, 'an empty goal is refused');
  A.eq(a.resolve({ goal: 'launch a product' }).ok, false, 'a PARTIAL match is not a match (needs every token)');
  A.eq(a.resolve({ goal: '   ' }).ok, false, 'whitespace is not a goal');
  // case/punctuation insensitivity is the templates module's business — prove it still works end to end
  A.eq(a.resolve({ goal: 'LAUNCH, a DIGITAL product!' }).ok, true, 'the match is normalised (case/punctuation tolerated)');
}

/* ---------- resolve WRITES NOTHING even with a task store wired ---------- */
{
  const tasks = mkTasks();
  const a = mk({ tasks: tasks });
  a.resolve({ goal: 'launch a digital product' });
  A.eq(tasks.calls.length, 0, 'resolve never touches the task store');
}

/* ---------- commit: the happy path relays the store's own rows ---------- */
{
  const tasks = mkTasks();
  const a = mk({ tasks: tasks });
  const r = a.commit({ goal: 'launch a digital product', businessId: 'acme' });
  A.eq(r.ok, true, 'a commit succeeds');
  A.eq(tasks.calls.length, 1, 'the task store was called exactly once');
  A.eq(tasks.calls[0].businessId, 'acme', 'for the named business');
  A.eq(r.created, r.tasks.length, 'created count matches the rows returned');
  A.eq(r.businessId, 'acme', 'the result names the business');
  A.eq(r.chained, true, 'the chain flag is relayed from the store');
  A.ok(r.tasks[0].id.indexOf('acme~') === 0, 'the tasks are the STORE\'s rows (with its ids), not the plan\'s');
  A.eq('kind' in r, false, 'a commit result is not labelled a plan — it is a write');
}

/* ---------- commit: the three refusals are relayed, never masked ---------- */
{
  // (a) no business named
  const a1 = mk();
  const r1 = a1.commit({ goal: 'launch a digital product' });
  A.eq(r1.ok, false, 'a commit with no business is refused');
  A.ok(r1.reason.indexOf('business') >= 0, 'and says a business is required');

  // (b) an unknown goal → the refusal carries knownGoals (so the route can 422)
  const a2 = mk();
  const r2 = a2.commit({ goal: 'become a unicorn', businessId: 'acme' });
  A.eq(r2.ok, false, 'committing an unknown goal is refused');
  A.ok(r2.knownGoals && r2.knownGoals.length, 'and it still names the known goals');

  // (c) a business that does not exist
  const a3 = mk({ businesses: mkBiz([]) });
  const r3 = a3.commit({ goal: 'launch a digital product', businessId: 'ghost' });
  A.eq(r3.ok, false, 'committing to a nonexistent business is refused');
  A.ok(r3.reason.indexOf('no such business') >= 0, 'and it names the missing business');

  // (d) the STORE refuses (task cap, bad title) → relayed verbatim
  const tasks = mkTasks({ refuse: 'this plan would exceed the 200-task cap for the business' });
  const a4 = mk({ tasks: tasks });
  const r4 = a4.commit({ goal: 'launch a digital product', businessId: 'acme' });
  A.eq(r4.ok, false, 'a store refusal is a refusal');
  A.eq(r4.reason, 'this plan would exceed the 200-task cap for the business', 'and the store\'s reason is relayed VERBATIM');
  A.eq('tasks' in r4, false, 'no tasks are reported on a store refusal');
}

/* ---------- commit: no task store wired → resolves but refuses to write ---------- */
{
  const a = makeBusinessAutopilot({ templates: templates });   // no tasks, no businesses
  A.eq(a.resolve({ goal: 'launch a digital product' }).ok, true, 'resolve still works without a task store');
  const r = a.commit({ goal: 'launch a digital product', businessId: 'acme' });
  A.eq(r.ok, false, 'but commit refuses without a task store');
  A.ok(r.reason.indexOf('is wired') >= 0 || r.reason.indexOf('not committed') >= 0, 'and says the store is not wired');
}

/* ---------- commit: projectId is threaded, and chain can be turned off ---------- */
{
  const tasks = mkTasks();
  const a = mk({ tasks: tasks });
  a.commit({ goal: 'launch a digital product', businessId: 'acme', projectId: 'proj-1' });
  A.eq(tasks.calls[0].meta.projectId, 'proj-1', 'the projectId reaches the store');
  A.eq(tasks.calls[0].meta.chain, true, 'the default is chained (the flat order IS the dependency order)');
}

/* ---------- determinism + honesty source-locks ---------- */
{
  A.ok(!/Date\.now/.test(SRC), 'no Date.now in the module (the determinism lint forbids it)');
  A.ok(!/Math\.random/.test(SRC), 'no rng either');
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  A.ok(!/score|health|grade|rating|confidence/i.test(CODE), 'the CODE contains no score/health/grade/rating/confidence');
  A.ok(!/function\s+goalPlan/.test(CODE), 'it does not RE-implement goalPlan — the templates module owns it (P4)');
}

A.report('business-autopilot');
