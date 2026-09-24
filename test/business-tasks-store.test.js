'use strict';
/* test/business-tasks-store.test.js — the §9 Task & Project Engine.

   The load-bearing properties:
     · ISOLATION (P6): businessId is required, and a dependency pointing at ANOTHER business is REFUSED —
       a cross-business edge would leak one business's plan into another's and would make the per-business
       E-STOP incoherent;
     · persist-before-commit (fail-closed): a thrown persist leaves memory EXACTLY as it was;
     · materialise() is ALL-OR-NOTHING and turns a plan's order into a REAL dependency chain;
     · every one of §9's thirteen fields is a real field;
     · the store computes COUNTS (summary/blockers), never a score (P7). */
const A = require('./_assert.js');
const { makeBusinessTasksStore } = require('../sidecar/business-tasks-store.js');

// a harness whose persist can be made to throw, to prove fail-closed behaviour.
function harness(opts) {
  const records = [];
  let boom = false;
  const persist = () => { if (boom) throw new Error('disk full'); };
  const s = makeBusinessTasksStore(Object.assign({ records, persist, now: () => 1000 }, opts || {}));
  return { s, records, failNext: () => { boom = true; }, heal: () => { boom = false; } };
}

/* ---------- §9: businessId is REQUIRED on every write ---------- */
{
  const { s } = harness();
  A.eq(s.create('', { title: 'x' }).ok, false, 'an empty businessId is refused');
  A.ok(/businessId is required/.test(s.create('', { title: 'x' }).reason), 'the refusal names the missing key');
  A.eq(s.create(null, { title: 'x' }).ok, false, 'a null businessId is refused');
  A.eq(s.create(undefined, { title: 'x' }).ok, false, 'an undefined businessId is refused');
  A.eq(s.create('   ', { title: 'x' }).ok, false, 'a whitespace businessId is refused');
  A.eq(s.create('acme', {}).ok, false, 'a task with no title is refused');
  A.eq(s.create('acme', { title: '   ' }).ok, false, 'a whitespace-only title is refused');
}

/* ---------- §9: all thirteen required fields are real and round-trip ---------- */
{
  const { s } = harness();
  const r = s.create('acme', {
    title: 'Research market', detail: 'the long version', projectId: 'proj-1', stage: 'research',
    status: 'doing', priority: 'high', deadline: '2026-03-01', dependsOn: [],
    assignedAgent: 'research-1', assignedUser: 'commander', estimated: { hours: 6 }, actual: { hours: 5 },
    approvalRequired: true, attachments: ['https://example.test/brief.pdf']
  });
  A.ok(r.ok, 'a fully-specified task is created');
  const t = r.task;
  A.eq(t.businessId, 'acme', 'business');
  A.eq(t.projectId, 'proj-1', 'project');
  A.eq(t.status, 'doing', 'status');
  A.eq(t.priority, 'high', 'priority');
  A.eq(t.deadline, '2026-03-01', 'deadline');
  A.eq(t.dependsOn, [], 'dependencies');
  A.eq(t.assignedAgent, 'research-1', 'assigned agent');
  A.eq(t.assignedUser, 'commander', 'assigned user');
  A.eq(t.estimated.hours, 6, 'estimated effort');
  A.eq(t.actual.hours, 5, 'actual effort');
  A.eq(t.approval, 'pending', 'approval requirement (approvalRequired:true -> pending)');
  A.eq(t.attachments.length, 1, 'attachments');
  A.eq(t.logs, [], 'logs start empty');
  A.eq(t.origin, 'user', 'a hand-written task is origin "user"');

  // P1: effort is LABELLED. An estimate stays an estimate; a recorded actual is a measurement by default.
  A.eq(t.estimated.evidence, 'estimate', 'P1: estimated effort is labelled an estimate');
  A.eq(t.actual.evidence, 'verified', 'a recorded actual effort defaults to verified (it was measured)');

  // id shape: '<businessId>~t<n>' — '~' not '#', so the id survives a URL path (see validation-store.js).
  A.eq(t.id, 'acme~t1', 'the first task id is <business>~t1');
  A.ok(t.id.indexOf('#') < 0, 'no task id contains "#" (it would be stripped as a URL fragment)');

  // the second task gets t2 — a deterministic per-business sequence, not a random token.
  A.eq(s.create('acme', { title: 'second' }).task.id, 'acme~t2', 'the sequence advances deterministically');
}

/* ---------- closed vocabularies ---------- */
{
  const { s } = harness();
  A.eq(s.create('acme', { title: 'x', status: 'nope' }).ok, false, 'an unknown status is refused');
  A.eq(s.create('acme', { title: 'x', priority: 'urgent' }).ok, false, 'an unknown priority is refused');
  A.eq(s.create('acme', { title: 'x', approval: 'maybe' }).ok, false, 'an unknown approval state is refused');
  A.eq(s.create('acme', { title: 'x', deadline: 'tomorrow' }).ok, false, 'a malformed deadline is refused');
  A.eq(s.create('acme', { title: 'x', estimated: { hours: -1 } }).ok, false, 'negative effort is refused');
  A.eq(s.create('acme', { title: 'x', estimated: { hours: 'lots' } }).ok, false, 'non-numeric effort is refused');
  A.eq(s.create('acme', { title: 'x', deadline: 1767225600000 }).ok, true, 'an epoch-ms deadline is accepted');
  A.eq(s.create('acme', { title: 'x', deadline: '2026-03-01T09:30' }).ok, true, 'an ISO datetime deadline is accepted');
}

/* ---------- P6: a dependency must exist AND belong to the same business ---------- */
{
  const { s } = harness();
  const a = s.create('acme', { title: 'a' }).task;
  const b = s.create('other', { title: 'b' }).task;

  const cross = s.create('other', { title: 'c', dependsOn: [a.id] });
  A.eq(cross.ok, false, 'a dependency on ANOTHER business is refused');
  A.ok(/another business/.test(cross.reason), 'the refusal says the dependency is foreign (P6)');

  A.eq(s.create('acme', { title: 'd', dependsOn: ['ghost~t9'] }).ok, false, 'a dangling dependency is refused');
  A.eq(s.create('acme', { title: 'e', dependsOn: ['acme~t1'] }).ok, true, 'a same-business dependency is accepted');
  A.eq(s.update(a.id, { dependsOn: [a.id] }).ok, false, 'a task cannot depend on itself');

  // a dependency in the right business but referenced from the wrong one is still refused
  A.eq(s.update(b.id, { dependsOn: [a.id] }).ok, false, 're-pointing a task at a foreign dependency is refused');
}

/* ---------- remove() refuses to orphan a dependency ---------- */
{
  const { s } = harness();
  const a = s.create('acme', { title: 'a' }).task;
  const b = s.create('acme', { title: 'b', dependsOn: [a.id] }).task;
  const blocked = s.remove(a.id);
  A.eq(blocked.ok, false, 'deleting a task that others depend on is refused');
  A.ok(/depend on/.test(blocked.reason), 'the refusal names the dependency relationship');
  A.eq(s.has(a.id), true, 'the task is still there after the refused delete');
  A.eq(s.remove(b.id).ok, true, 'a leaf task can be deleted');
  A.eq(s.remove(a.id).ok, true, 'once the dependent is gone, the task can be deleted');
  A.eq(s.remove('ghost~t1').ok, true, 'deleting an unknown task is a no-op, not an error');
}

/* ---------- materialise(): all-or-nothing, and it chains the plan's order into real edges ---------- */
{
  const { s } = harness();
  const plan = [
    { title: 'one', stage: 'research', priority: 'high', estimated: { hours: 2 } },
    { title: 'two', stage: 'mvp', priority: 'normal', estimated: { hours: 4 } },
    { title: 'three', stage: 'launch', priority: 'high', estimated: { hours: 1 } }
  ];
  const r = s.materialise('acme', plan, {});
  A.ok(r.ok, 'a plan materialises');
  A.eq(r.tasks.length, 3, 'all three tasks were created');
  A.eq(r.chained, true, 'chaining is on by default');
  A.eq(r.tasks[0].dependsOn, [], 'the first task has no dependency');
  A.eq(r.tasks[1].dependsOn, [r.tasks[0].id], 'the second depends on the first — the plan order IS the chain');
  A.eq(r.tasks[2].dependsOn, [r.tasks[1].id], 'the third depends on the second');
  A.ok(r.tasks.every(t => t.origin === 'plan'), 'materialised tasks are marked origin "plan", never passed off as hand-made');
  A.ok(r.tasks.every(t => t.stage), 'each task keeps the template stage it came from');

  // unchained: independent steps
  const u = s.materialise('beta', plan, { chain: false });
  A.eq(u.chained, false, 'chain:false is honoured');
  A.ok(u.tasks.every(t => t.dependsOn.length === 0), 'an unchained plan creates independent tasks');

  // ALL-OR-NOTHING: one bad entry aborts the whole batch, so a half-created plan never lands.
  const before = s.count('acme');
  const bad = s.materialise('acme', [{ title: 'ok' }, { title: '' }, { title: 'also ok' }], {});
  A.eq(bad.ok, false, 'a plan with a bad entry is refused');
  A.eq(s.count('acme'), before, 'NOTHING was created by the refused plan (all-or-nothing)');

  const badVocab = s.materialise('acme', [{ title: 'ok' }, { title: 'x', priority: 'urgent' }], {});
  A.eq(badVocab.ok, false, 'a plan with an illegal vocabulary value is refused');
  A.eq(s.count('acme'), before, 'still nothing created');
  A.ok(/plan task "x"/.test(badVocab.reason), 'the refusal names WHICH plan task was bad');

  A.eq(s.materialise('acme', [], {}).ok, false, 'an empty plan is refused');
  A.eq(s.materialise('acme', null, {}).ok, false, 'a null plan is refused');
  A.eq(s.materialise('', plan, {}).ok, false, 'materialising into no business is refused');
}

/* ---------- persist-before-commit is FAIL-CLOSED on every write path ---------- */
{
  const { s, failNext, heal } = harness();
  s.create('acme', { title: 'a' });
  const a = s.list('acme')[0];
  const baseline = JSON.stringify(s.list('acme'));

  failNext();
  A.eq(s.create('acme', { title: 'b' }).ok, false, 'a create whose persist throws is refused');
  A.eq(s.update(a.id, { status: 'done' }).ok, false, 'an update whose persist throws is refused');
  A.eq(s.addLog(a.id, { text: 'hi' }).ok, false, 'a log write whose persist throws is refused');
  A.eq(s.attach(a.id, 'ref').ok, false, 'an attach whose persist throws is refused');
  A.eq(s.remove(a.id).ok, false, 'a remove whose persist throws is refused');
  A.eq(s.materialise('acme', [{ title: 'z' }], {}).ok, false, 'a materialise whose persist throws is refused');
  A.eq(JSON.stringify(s.list('acme')), baseline, 'memory is EXACTLY as it was after every failed write (fail-closed)');
  heal();
  A.eq(s.create('acme', { title: 'b' }).ok, true, 'once persistence recovers, writes succeed again');
}

/* ---------- reads: isolation, ordering, counts (never a score) ---------- */
{
  const { s } = harness();
  s.create('acme', { title: 'a1', priority: 'high' });
  s.create('acme', { title: 'a2', status: 'done', priority: 'low' });
  s.create('acme', { title: 'a3', approvalRequired: true });
  s.create('beta', { title: 'b1' });

  A.eq(s.count('acme'), 3, 'acme has three tasks');
  A.eq(s.count('beta'), 1, 'beta has one');
  A.eq(s.list('beta').map(t => t.title), ['b1'], 'beta\'s list shows only beta\'s tasks (P6)');
  A.eq(s.list('').length, 0, 'an empty businessId reads as NOTHING, never as everything');
  A.eq(s.count(''), 0, 'count of an empty businessId is 0');
  A.eq(s.summary('').total, 0, 'summary of an empty businessId is empty');

  // ordering is by the deterministic sequence, not by the wall clock
  A.eq(s.list('acme').map(t => t.title), ['a1', 'a2', 'a3'], 'tasks list in creation order');

  const sum = s.summary('acme');
  A.eq(sum.total, 3, 'summary counts the total');
  A.eq(sum.byStatus.done, 1, 'summary counts by status');
  A.eq(sum.byStatus.todo, 2, 'summary counts todo');
  A.eq(sum.byPriority.high, 1, 'summary counts by priority');
  A.eq(sum.awaitingApproval, 1, 'summary counts tasks awaiting approval');
  A.eq(sum.open, 2, 'summary counts open (not done, not cancelled)');
  // P7: the summary exposes NO percentage and NO score.
  A.eq(Object.keys(sum).filter(k => /percent|score|health|progress/i.test(k)), [], 'the summary invents no score/percentage (P7)');

  A.eq(s.get('acme~t1').title, 'a1', 'get resolves by id');
  A.eq(s.get('ghost~t1'), null, 'get of an unknown id is null');
  A.eq(s.has('acme~t1'), true, 'has resolves');
}

/* ---------- blockers() reports UNMET dependencies as a FACT ---------- */
{
  const { s } = harness();
  const a = s.create('acme', { title: 'a' }).task;
  const b = s.create('acme', { title: 'b', dependsOn: [a.id] }).task;
  A.eq(s.blockers(a.id), [], 'a task with no dependencies has no blockers');
  A.eq(s.blockers(b.id).length, 1, 'b is blocked by its unfinished dependency');
  A.eq(s.blockers(b.id)[0].id, a.id, 'the blocker names the dependency');
  A.eq(s.blockers(b.id)[0].status, 'todo', 'the blocker reports the dependency\'s real status');
  s.setStatus(a.id, 'done');
  A.eq(s.blockers(b.id), [], 'completing the dependency clears the blocker — no status flag was needed');
}

/* ---------- update(): whitelisted, id/seq/businessId/origin immutable ---------- */
{
  const { s } = harness();
  const t = s.create('acme', { title: 'a' }).task;
  const u = s.update(t.id, { title: 'renamed', status: 'review', priority: 'critical', businessId: 'hijack', id: 'evil~t9', seq: 999, origin: 'plan' });
  A.ok(u.ok, 'the update succeeds');
  A.eq(u.task.title, 'renamed', 'the title changed');
  A.eq(u.task.status, 'review', 'the status changed');
  A.eq(u.task.businessId, 'acme', 'businessId is IMMUTABLE — a task cannot be re-homed (P6)');
  A.eq(u.task.id, t.id, 'id is immutable');
  A.eq(u.task.seq, t.seq, 'seq is immutable');
  A.eq(u.task.origin, 'user', 'origin is provenance — a patch cannot relabel a hand-made task as a plan task');
  A.eq(s.update('ghost~t1', { status: 'done' }).ok, false, 'updating an unknown task is refused');
  A.eq(s.update(t.id, { title: '  ' }).ok, false, 'a blank title is refused');
  A.eq(s.update(t.id, { status: 'nope' }).ok, false, 'an unknown status is refused on update too');
}

/* ---------- logs and attachments ---------- */
{
  const { s } = harness();
  const t = s.create('acme', { title: 'a' }).task;
  A.eq(s.addLog(t.id, { text: '' }).ok, false, 'an empty log entry is refused');
  A.eq(s.addLog('ghost~t1', { text: 'x' }).ok, false, 'logging against an unknown task is refused');
  const l1 = s.addLog(t.id, { text: 'started', kind: 'progress' });
  A.ok(l1.ok, 'a log entry is appended');
  A.eq(l1.task.logs.length, 1, 'the log has one entry');
  A.eq(l1.task.logs[0].kind, 'progress', 'the log kind is kept');
  A.eq(l1.task.logs[0].at, 1000, 'the log entry is stamped by the injected clock');
  const l2 = s.addLog(t.id, { text: 'done' });
  A.eq(l2.task.logs.length, 2, 'logs are append-only');
  A.eq(l2.task.logs[1].kind, 'note', 'the log kind defaults to note');

  A.eq(s.attach(t.id, '').ok, false, 'an empty attachment reference is refused');
  A.eq(s.attach('ghost~t1', 'x').ok, false, 'attaching to an unknown task is refused');
  A.eq(s.attach(t.id, 'https://example.test/a.pdf').task.attachments.length, 1, 'an attachment is added');
}

/* ---------- clear() is scoped to one business ---------- */
{
  const { s } = harness();
  s.create('acme', { title: 'a' });
  s.create('beta', { title: 'b' });
  A.eq(s.clear('').ok, false, 'clearing with no businessId is refused');
  A.eq(s.clear('acme').ok, true, 'clearing acme works');
  A.eq(s.count('acme'), 0, 'acme is empty');
  A.eq(s.count('beta'), 1, 'beta is UNTOUCHED — clear never crosses the namespace (P6)');
}

/* ---------- the per-business cap bounds one business without touching another ---------- */
{
  const { s } = harness({ limit: 3 });
  A.eq(s.LIMIT, 3, 'the cap is configurable');
  for (let i = 0; i < 5; i++) s.create('acme', { title: 'a' + i });
  A.eq(s.count('acme'), 3, 'acme is capped at 3');
  A.eq(s.list('acme').map(t => t.title), ['a2', 'a3', 'a4'], 'the cap drops the OLDEST tasks');
  s.create('beta', { title: 'b' });
  A.eq(s.count('beta'), 1, 'beta is unaffected by acme hitting its cap');
  // a plan that would exceed the cap is refused up front rather than half-created
  A.eq(s.materialise('acme', [{ title: 'x' }, { title: 'y' }], {}).ok, false, 'a plan that would exceed the cap is refused');
  A.eq(s.count('acme'), 3, 'the refused plan created nothing');
}

A.report('business-tasks-store.test');
