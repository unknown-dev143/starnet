'use strict';
/* test/business-projects-store.test.js — the §9 PROJECT layer (Business OS Phase 4).

   A project is the referent Phase 1's business-tasks-store never had: a task carries a projectId that could
   not be resolved until now. The load-bearing properties:
     · businessId is REQUIRED and is part of the id (P6) — two businesses cannot collide;
     · the id uses '~', never '#', because it travels in a URL path and '#' would be stripped client-side;
     · memoryNamespace() is shaped biz:<businessId>:proj:<projectId> so the Phase 3 memory store's 'project'
       scope gets an ownerId that cannot collide with a business or an agent id;
     · summary() counts by status ONLY — there is no progress percentage, because a project's "percent done"
       would be a number nobody recorded (P2/P7);
     · persist-before-commit on every write path (fail-closed). */
const A = require('./_assert.js');
const { makeBusinessProjectsStore, STATUSES } = require('../sidecar/business-projects-store.js');

function store(extra) {
  const saved = [];
  const s = makeBusinessProjectsStore(Object.assign({
    records: [],
    persist: (rows) => { saved.length = 0; for (const r of rows) saved.push(r); },
    now: () => 1000
  }, extra || {}));
  return { s, saved };
}

/* ---------- the five statuses ---------- */
{
  A.eq(STATUSES, ['planned', 'active', 'paused', 'done', 'archived'], 'a project has the five §9 statuses');
}

/* ---------- create: required fields, id shape, defaults ---------- */
{
  const { s } = store();
  A.eq(s.create('', { name: 'X' }).ok, false, 'a create with no businessId is REFUSED');
  A.ok(/never implied/.test(s.create('', { name: 'X' }).reason), 'and says why (isolation is by key)');
  A.eq(s.create('acme', {}).ok, false, 'a project with no name is refused');
  A.eq(s.create('acme', { name: '  ' }).ok, false, 'a whitespace-only name is refused');

  const c = s.create('acme', { name: 'Launch', goal: 'ship it' });
  A.ok(c.ok, 'a minimal create succeeds');
  A.eq(c.project.id, 'acme~p1', 'the id is <businessId>~p<seq>');
  A.ok(c.project.id.indexOf('#') < 0, 'the id never contains a # (it travels in a URL path)');
  A.eq(c.project.status, 'planned', 'a new project starts planned');
  A.eq(c.project.businessId, 'acme', 'the business is recorded');
  A.eq(c.project.goal, 'ship it', 'the goal is stored');
  A.eq(s.create('acme', { name: 'Second' }).project.id, 'acme~p2', 'sequence continues within a business');
}

/* ---------- an unknown status is refused on create and on update ---------- */
{
  const { s } = store();
  A.eq(s.create('acme', { name: 'X', status: 'nope' }).ok, false, 'an unknown status is refused on create');
  const id = s.create('acme', { name: 'X' }).project.id;
  A.eq(s.setStatus(id, 'nope').ok, false, 'and on update');
  A.eq(s.setStatus(id, 'active').ok, true, 'a real status is accepted');
  A.eq(s.get(id).status, 'active', 'and it lands');
  A.eq(s.update(id, { name: '  ' }).ok, false, 'a blank rename is refused');
}

/* ---------- P6: businesses do not collide ---------- */
{
  const { s } = store();
  s.create('acme', { name: 'A' });
  s.create('acme', { name: 'B' });
  s.create('beta', { name: 'C' });
  A.eq(s.list('acme').length, 2, 'acme sees only its own two');
  A.eq(s.list('beta').length, 1, 'beta sees only its own one');
  A.eq(s.list('beta')[0].id, 'beta~p1', 'beta numbering restarts — ids cannot collide across businesses');
  A.eq(s.list('').length, 0, 'an empty businessId lists nothing, never everything');
  A.eq(s.count('acme'), 2, 'count is per business');
  A.eq(s.summary('acme').total, 2, 'summary is per business');
}

/* ---------- the memory namespace ---------- */
{
  const { s } = store();
  const id = s.create('acme', { name: 'A' }).project.id;
  A.eq(s.memoryNamespace(id), 'biz:acme:proj:acme~p1', 'the namespace is biz:<businessId>:proj:<projectId>');
  A.eq(s.memoryNamespace('nope'), '', 'an unknown id has no namespace (never a half-built one)');
}

/* ---------- summary counts statuses, never a percentage ---------- */
{
  const { s } = store();
  s.create('acme', { name: 'A', status: 'active' });
  s.create('acme', { name: 'B', status: 'active' });
  s.create('acme', { name: 'C', status: 'done' });
  const sum = s.summary('acme');
  A.eq(sum.total, 3, 'the total is counted');
  A.eq(sum.byStatus.active, 2, 'actives are counted');
  A.eq(sum.byStatus.done, 1, 'dones are counted');
  A.eq(sum.byStatus.planned, 0, 'an absent status counts zero rather than going missing');
  A.ok(!/percent|progress|%/.test(JSON.stringify(sum)), 'nothing here is a progress percentage');
}

/* ---------- remove reports what it did; the route owns the orphan check ---------- */
{
  const { s } = store();
  const id = s.create('acme', { name: 'A' }).project.id;
  A.eq(s.remove('nope'), { ok: true, removed: 0 }, 'removing an unknown id is a no-op that says so');
  A.eq(s.remove(id), { ok: true, removed: 1 }, 'removing a real id reports one removed');
  A.eq(s.has(id), false, 'and it is gone');
}

/* ---------- clear only ever clears ONE business ---------- */
{
  const { s } = store();
  s.create('acme', { name: 'A' });
  s.create('beta', { name: 'B' });
  A.eq(s.clear('').ok, false, 'clear with no businessId is refused');
  A.eq(s.clear('acme').ok, true, 'clear acme succeeds');
  A.eq(s.list('acme').length, 0, 'acme is empty');
  A.eq(s.list('beta').length, 1, 'beta is untouched');
}

/* ---------- persist-before-commit: a throw leaves memory untouched (fail-closed) ---------- */
{
  let boom = false;
  const saved = [];
  const s = makeBusinessProjectsStore({
    records: [],
    persist: (rows) => { if (boom) throw new Error('disk denied'); saved.length = 0; for (const r of rows) saved.push(r); },
    now: () => 1000
  });
  const first = s.create('acme', { name: 'A' });
  A.ok(first.ok, 'the first create persists fine');
  boom = true;
  const denied = s.create('acme', { name: 'B' });
  A.eq(denied.ok, false, 'a create whose persist throws returns ok:false');
  A.ok(/denied/.test(denied.reason), 'and says the write was denied');
  A.eq(s.list('acme').length, 1, 'memory is unchanged — the failed row never became visible');
  A.eq(saved.length, 1, 'and the saved snapshot is still the last good one');
}

A.report('business-projects-store');
