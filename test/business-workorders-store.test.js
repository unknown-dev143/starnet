'use strict';
/* test/business-workorders-store.test.js — the WORK ORDER record (Business OS Phase 6).

   §18 asks for an audit trail and §19 for human control, and this store is where both land. The
   load-bearing behaviours:

     · THE STATUS IS DERIVED, NEVER ASSERTED. This is the spine. `finish()` takes NO status argument — it
       re-derives from the steps. `done` therefore requires every step executed; a mix is `partial`, an
       all-refused order is `failed`, and an order that never got past its first hold is `blocked`. A caller
       cannot claim success, because there is no field to write it into.

     · P6 ISOLATION. An empty businessId is REFUSED, not read as "every business". Lists, counts and clears
       are all business-scoped.

     · PERSIST-BEFORE-COMMIT (fail-closed). A throwing persist leaves memory untouched and returns ok:false,
       so a lost write is a refused mutation rather than a silent one.

     · THE IDS ARE URL-SAFE. '~' never '#', because a fragment delimiter is stripped client-side and every
       id here is fetched through a path segment.

     · A STEP'S OUTCOME IS RECORDED, NOT OVERWRITTEN. `recordStep` patches one step by seq; it cannot invent
       a step, and a step that already reached a terminal state is not silently re-opened. */
const A = require('./_assert.js');
const M = require('../sidecar/business-workorders-store.js');

const NOW = 1_700_000_000_000;

function mk(extra) {
  return M.makeBusinessWorkOrders(Object.assign({ records: [], now: () => NOW }, extra || {}));
}
function steps(spec) {
  // spec is an array of statuses; each becomes a one-field step
  return (spec || []).map((st, i) => ({ seq: i + 1, tool: 't' + (i + 1), why: 'w' + (i + 1), status: st }));
}
function order(over) {
  return mk().create('acme', Object.assign({
    intent: 'do the thing',
    steps: steps(['pending', 'pending'])
  }, over || {}));
}

/* ---------- construction ---------- */
{
  A.notThrows(() => mk(), 'the store builds with no options');
  A.notThrows(() => mk({ persist: () => {} }), 'and with a persist function');
  A.eq(M.STATUSES.length, 6, 'there are six order statuses');
  A.eq(M.OPEN_STATUSES.length, 3, 'three of them are open');
  for (const s of M.OPEN_STATUSES) A.ok(M.STATUSES.indexOf(s) >= 0, 'every open status is a real status (' + s + ')');
  for (const s of M.STEP_STATUSES) A.ok(typeof s === 'string', 'step statuses are strings');
  A.ok(M.DEFAULT_LIMIT > 0, 'the default list limit is positive');
}

/* ---------- create: P6 and the required fields ---------- */
{
  const s = mk();
  A.ok(!s.create('', { intent: 'x', steps: steps(['pending']) }).ok, 'an empty businessId is refused');
  A.ok(!s.create('   ', { intent: 'x', steps: steps(['pending']) }).ok, 'a whitespace businessId is refused');
  A.ok(!s.create('acme', { steps: steps(['pending']) }).ok, 'an order with no intent is refused');
  A.ok(!s.create('acme', { intent: 'x' }).ok, 'an order with no steps is refused');
  A.ok(!s.create('acme', { intent: 'x', steps: [] }).ok, 'an empty steps array is refused');

  const r = order();
  A.ok(r.ok, 'a well-formed order is created');
  A.eq(r.order.businessId, 'acme', 'and carries its business');
  A.eq(r.order.status, 'planned', 'and starts as planned');
  A.eq(r.order.steps.length, 2, 'with its steps intact');
  A.ok(r.order.id.indexOf('acme~') === 0, 'the id is namespaced by business (' + r.order.id + ')');
  A.ok(r.order.id.indexOf('#') < 0, 'and contains no "#" — a fragment delimiter would be stripped client-side');

  // an id is unique within the business
  const second = mk().create('acme', { intent: 'y', steps: steps(['pending']) });
  A.ok(second.ok, 'a second order is created');
  A.notThrows(() => { const a = order().order.id; const b = mk().create('acme', { intent: 'z', steps: steps(['pending']) }).order.id; A.ok(true, 'ids are minted'); });
}

/* ---------- THE STATUS IS DERIVED — the spine ---------- */
{
  // all executed → done
  let s = mk();
  let o = s.create('acme', { intent: 'i', steps: steps(['pending', 'pending']) }).order;
  s.recordStep(o.id, 1, { status: 'executed' });
  s.recordStep(o.id, 2, { status: 'executed' });
  A.eq(s.finish(o.id).order.status, 'done', 'every step executed → done');

  // one skipped still counts as done: a skip is a deliberate pass, not a failure
  s = mk();
  o = s.create('acme', { intent: 'i', steps: steps(['pending', 'pending']) }).order;
  s.recordStep(o.id, 1, { status: 'executed' });
  s.recordStep(o.id, 2, { status: 'skipped' });
  A.eq(s.finish(o.id).order.status, 'done', 'executed + skipped → done');

  // executed + held → partial (NOT done — something is still waiting)
  s = mk();
  o = s.create('acme', { intent: 'i', steps: steps(['pending', 'pending']) }).order;
  s.recordStep(o.id, 1, { status: 'executed' });
  s.recordStep(o.id, 2, { status: 'held' });
  A.eq(s.finish(o.id).order.status, 'partial', 'executed + held → partial, never done');

  // executed + failed → partial
  s = mk();
  o = s.create('acme', { intent: 'i', steps: steps(['pending', 'pending']) }).order;
  s.recordStep(o.id, 1, { status: 'executed' });
  s.recordStep(o.id, 2, { status: 'failed' });
  A.eq(s.finish(o.id).order.status, 'partial', 'executed + failed → partial');

  // executed + refused → partial
  s = mk();
  o = s.create('acme', { intent: 'i', steps: steps(['pending', 'pending']) }).order;
  s.recordStep(o.id, 1, { status: 'executed' });
  s.recordStep(o.id, 2, { status: 'refused' });
  A.eq(s.finish(o.id).order.status, 'partial', 'executed + refused → partial');

  // all held, nothing executed → blocked
  s = mk();
  o = s.create('acme', { intent: 'i', steps: steps(['pending', 'pending']) }).order;
  s.recordStep(o.id, 1, { status: 'held' });
  s.recordStep(o.id, 2, { status: 'held' });
  A.eq(s.finish(o.id).order.status, 'blocked', 'all held with nothing executed → blocked');

  // held + refused → blocked (still waiting on a human)
  s = mk();
  o = s.create('acme', { intent: 'i', steps: steps(['pending', 'pending']) }).order;
  s.recordStep(o.id, 1, { status: 'held' });
  s.recordStep(o.id, 2, { status: 'refused' });
  A.eq(s.finish(o.id).order.status, 'blocked', 'held + refused → blocked');

  // all refused → failed
  s = mk();
  o = s.create('acme', { intent: 'i', steps: steps(['pending', 'pending']) }).order;
  s.recordStep(o.id, 1, { status: 'refused' });
  s.recordStep(o.id, 2, { status: 'refused' });
  A.eq(s.finish(o.id).order.status, 'failed', 'all refused → failed');

  // all failed → failed
  s = mk();
  o = s.create('acme', { intent: 'i', steps: steps(['pending', 'pending']) }).order;
  s.recordStep(o.id, 1, { status: 'failed' });
  s.recordStep(o.id, 2, { status: 'failed' });
  A.eq(s.finish(o.id).order.status, 'failed', 'all failed → failed');

  // refused + failed → failed (nothing ran and nothing is waiting)
  s = mk();
  o = s.create('acme', { intent: 'i', steps: steps(['pending', 'pending']) }).order;
  s.recordStep(o.id, 1, { status: 'refused' });
  s.recordStep(o.id, 2, { status: 'failed' });
  A.eq(s.finish(o.id).order.status, 'failed', 'refused + failed → failed');
}

/* ---------- finish takes NO status argument — a caller cannot claim success ---------- */
{
  const s = mk();
  const o = s.create('acme', { intent: 'i', steps: steps(['pending']) }).order;
  /* The second argument is a NOTE, not a status — there is deliberately no parameter that accepts one. An
     untouched order stays open: the derivation cannot call it done, and cannot call it failed either. */
  const f = s.finish(o.id, 'done');
  A.ok(f.ok, 'finish succeeds');
  A.eq(f.order.status, 'planned', 'a supplied status is ignored — the derivation decides (all pending → planned)');
  A.eq(f.order.note, 'done', 'and the caller\'s argument landed as a NOTE, the only field they may add');
}

/* ---------- markRunning ---------- */
{
  const s = mk();
  const o = s.create('acme', { intent: 'i', steps: steps(['pending']) }).order;
  A.eq(s.get(o.id).status, 'planned', 'an order starts planned');
  A.ok(s.markRunning(o.id).ok, 'markRunning succeeds');
  A.eq(s.get(o.id).status, 'running', 'and the order is running');

  // re-marking a running order is idempotent (running → running), not an error: the runner calls it once, and
  // a caller that calls it twice must not be handed a failure for a state it is already in
  A.ok(s.markRunning(o.id).ok, 'markRunning on a running order is idempotent');
  A.eq(s.get(o.id).status, 'running', 'and it stays running');

  // a genuinely FINISHED order cannot be re-run
  s.recordStep(o.id, 1, { status: 'executed' });
  const f = s.finish(o.id);
  A.eq(f.order.status, 'done', 'the order settled as done');
  A.ok(!s.markRunning(o.id).ok, 'markRunning refuses a finished order — a run is not re-entrant');

  // a dry run never runs
  const dry = s.create('acme', { intent: 'i', steps: steps(['pending']), dryRun: true }).order;
  A.ok(dry.dryRun === true, 'a dry run is flagged');
  A.ok(!s.markRunning(dry.id).ok, 'markRunning refuses a dry run — a plan is not a job');
}

/* ---------- recordStep ---------- */
{
  const s = mk();
  const o = s.create('acme', { intent: 'i', steps: steps(['pending', 'pending']) }).order;
  A.ok(!s.recordStep('nope', 1, { status: 'executed' }).ok, 'recordStep refuses an unknown order');
  A.ok(!s.recordStep(o.id, 99, { status: 'executed' }).ok, 'recordStep refuses a step that is not on the order');
  A.ok(!s.recordStep(o.id, 0, { status: 'executed' }).ok, 'seq 0 is not a step');

  const r = s.recordStep(o.id, 1, { status: 'executed', result: 'the answer', error: '' });
  A.ok(r.ok, 'recordStep patches a real step');
  A.eq(r.order.steps[0].status, 'executed', 'and the status landed');
  A.eq(r.order.steps[0].result, 'the answer', 'and the result was kept');
  A.eq(r.order.steps[1].status, 'pending', 'and the OTHER step is untouched');

  // a step's why/tool are not clobbered by a patch that omits them
  A.ok(r.order.steps[0].why === 'w1', 'the step keeps its reason');
  A.ok(r.order.steps[0].tool === 't1', 'the step keeps its tool');
}

/* ---------- PERSIST-BEFORE-COMMIT (fail-closed) ---------- */
{
  let calls = 0;
  const s = mk({ persist: () => { calls++; throw new Error('disk gone'); } });
  const before = s.count('acme');
  const r = s.create('acme', { intent: 'i', steps: steps(['pending']) });
  A.ok(!r.ok, 'a throwing persist makes create fail');
  A.ok(calls > 0, 'and the persist was actually attempted');
  A.eq(s.count('acme'), before, 'and memory is UNCHANGED — the mutation did not half-land');
  A.eq(s.list('acme').length, 0, 'nothing was added');
}

/* ---------- P6: reads are business-scoped ---------- */
{
  const s = mk();
  s.create('acme', { intent: 'one', steps: steps(['pending']) });
  s.create('acme', { intent: 'two', steps: steps(['pending']) });
  s.create('other', { intent: 'three', steps: steps(['pending']) });

  A.eq(s.list('acme').length, 2, 'acme sees its own two orders');
  A.eq(s.list('other').length, 1, 'other sees only its own');
  A.eq(s.list('').length, 0, 'an empty businessId lists NOTHING — never "everything"');
  A.eq(s.count('acme'), 2, 'count is scoped');
  A.eq(s.count('other'), 1, 'and scoped for the other business too');

  // get() finds an order from any business by id (it is an id lookup), but the id is namespaced
  const acmeOne = s.list('acme')[0];
  A.ok(s.get(acmeOne.id), 'an order is gettable by its full id');
  A.ok(s.get(acmeOne.id).businessId === 'acme', 'and it reports its own business');
}

/* ---------- list filters ---------- */
{
  const s = mk();
  const a = s.create('acme', { intent: 'i', steps: steps(['pending']) }).order;
  const b = s.create('acme', { intent: 'i', steps: steps(['pending']) }).order;
  const c = s.create('acme', { intent: 'i', steps: steps(['pending']) }).order;
  s.recordStep(a.id, 1, { status: 'held' });      // → blocked (still open, waiting on a human)
  s.finish(a.id);
  s.recordStep(b.id, 1, { status: 'executed' });  // → done
  s.finish(b.id);
  // c is left untouched → planned (open)

  A.eq(s.list('acme', { status: 'blocked' }).length, 1, 'filtering by status works');
  A.eq(s.list('acme', { status: 'done' }).length, 1, 'and by another status');
  A.eq(s.list('acme', { status: 'planned' }).length, 1, 'and finds the untouched order');
  A.eq(s.list('acme', { status: 'running' }).length, 0, 'and returns nothing when nothing matches');
  A.eq(s.list('acme', { limit: 1 }).length, 1, 'limit is honoured');

  A.ok(Array.isArray(s.openFor('acme')), 'openFor returns an array');
  A.eq(s.list('acme', { open: true }).length, 2, 'blocked + planned are open; done is not');
}

/* ---------- summary ---------- */
{
  const s = mk();
  s.create('acme', { intent: 'i', steps: steps(['pending']) });
  const o = s.create('acme', { intent: 'i', steps: steps(['pending']) }).order;
  s.recordStep(o.id, 1, { status: 'executed' });
  s.finish(o.id);

  const sum = s.summary('acme');
  A.ok(sum && typeof sum === 'object', 'summary returns an object');
  A.eq(sum.total, 2, 'and counts every order');
  A.eq(sum.byStatus.done, 1, 'including the finished one, broken down by status');
  A.eq(sum.steps.executed, 1, 'and counts step outcomes');
  A.eq(s.summary('').total, 0, 'an empty businessId summarises nothing, not everything');

  // awaitingYou is the console's badge: how many steps are waiting on a human
  const s2 = mk();
  const h = s2.create('acme', { intent: 'i', steps: steps(['pending', 'pending']) }).order;
  s2.recordStep(h.id, 1, { status: 'held' });
  s2.recordStep(h.id, 2, { status: 'held' });
  A.eq(s2.summary('acme').awaitingYou, 2, 'awaitingYou counts the held steps a human must decide');
}

/* ---------- remove ---------- */
{
  const s = mk();
  const o = s.create('acme', { intent: 'i', steps: steps(['pending']) }).order;
  A.ok(!s.remove('nope').ok, 'removing an unknown order fails');
  const r = s.remove(o.id);
  A.ok(r.ok, 'removing a real order succeeds');
  A.eq(r.removed.id, o.id, 'and reports what went');
  A.eq(s.count('acme'), 0, 'and it is gone');
  A.ok(!s.get(o.id), 'and get() no longer finds it');
}

/* ---------- removeForBusiness: P6 bulk clear ---------- */
{
  const s = mk();
  s.create('acme', { intent: 'i', steps: steps(['pending']) });
  s.create('acme', { intent: 'i', steps: steps(['pending']) });
  s.create('other', { intent: 'i', steps: steps(['pending']) });
  const r = s.removeForBusiness('acme');
  A.ok(r.ok, 'removeForBusiness succeeds');
  A.eq(r.removed, 2, 'and reports how many went');
  A.eq(s.count('acme'), 0, 'acme is empty');
  A.eq(s.count('other'), 1, 'and other is UNTOUCHED — a clear is never global');
  A.ok(!s.removeForBusiness('').ok, 'an empty businessId is refused');
}

/* ---------- clear ---------- */
{
  const s = mk();
  s.create('acme', { intent: 'i', steps: steps(['pending']) });
  s.create('other', { intent: 'i', steps: steps(['pending']) });
  s.clear();
  A.eq(s.count('acme'), 0, 'clear wipes acme');
  A.eq(s.count('other'), 0, 'and other');
}

/* ---------- the store is total: no throw on garbage ---------- */
{
  const s = mk();
  A.notThrows(() => s.create('acme', null), 'create with no meta does not throw');
  A.notThrows(() => s.list(), 'list with no args does not throw');
  A.notThrows(() => s.get(), 'get with no args does not throw');
  A.notThrows(() => s.recordStep(), 'recordStep with no args does not throw');
  A.notThrows(() => s.finish(), 'finish with no args does not throw');
  A.notThrows(() => s.remove(), 'remove with no args does not throw');
  A.notThrows(() => s.summary(), 'summary with no args does not throw');
  A.ok(!s.get('nope'), 'an unknown id returns falsy, not a throw');
  A.ok(!s.finish('nope').ok, 'finish on an unknown id fails cleanly');
}

A.report('business-workorders-store');
