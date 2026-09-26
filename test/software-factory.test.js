'use strict';
/* software-factory.test.js — the §22 AI SOFTWARE FACTORY pipeline read (Business OS Phase 12).

   §22's whole point is a single honest read of "where is this idea, really?" The thing that must never happen
   is a fabricated progress bar — a confident 62% with stages ticked off. So this suite locks:
     · every stage is decided by a COUNTABLE recorded fact, never a guess;
     · a stage with no proof whose PRIOR stage is unreached is `blocked`, naming the prior;
     · an unreadable source marks its stages `unobservable` with count NULL — never a fake zero;
     · all eight stages are ALWAYS present, in order;
     · no score, no percentage, no grade anywhere.                                                         */

const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const { makeSoftwareFactory, STAGES, STAGE_IDS } = require('../sidecar/software-factory.js');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'software-factory.js'), 'utf8');

/* The engine reads sources through accessors: opportunities.list(), validations.list(), tasks.list(biz),
   workorders.list(biz), businesses.get(id). This harness builds those from plain data, and lets a source be
   'throw' (a store that blows up) or undefined (not wired). */
function srcList(v) {
  if (v === undefined) return undefined;
  if (v === 'throw') return { list: () => { throw new Error('source blew up'); } };
  return { list: () => v };
}

function mkBiz(bizValue) {
  return function (src) {
    src = src || {};
    const g = bizValue === undefined ? undefined
      : (bizValue === 'throw' ? { get: () => { throw new Error('blow up'); } } : { get: () => bizValue });
    return makeSoftwareFactory({
      opportunities: srcList(src.opportunities),
      validations: srcList(src.validations),
      businesses: g,
      tasks: srcList(src.tasks),
      workorders: srcList(src.workorders)
    });
  };
}

/* ---------- construction + shape ---------- */
{
  const f = makeSoftwareFactory({});
  A.notThrows(() => f.pipeline('acme'), 'constructs with no sources and still answers');
  const r = f.pipeline('acme');
  A.eq(r.ok, true, 'it answers ok');
  A.eq(r.stages.length, 8, 'all eight stages are present');
  A.eq(r.stages.map(s => s.id).join('|'), STAGE_IDS.join('|'), 'the order is the brief\'s order, exactly');
  A.eq(r.stageOrder.join('|'), STAGE_IDS.join('|'), 'stageOrder mirrors the stages');
  A.eq(STAGES.length, 8, 'the module exports eight stages');
  A.ok(!('percent' in r) && !('score' in r) && !('progress' in r), 'no percentage/score/progress on the wire');
  A.eq(f.pipeline('').ok, false, 'an empty business is refused');
}

/* ---------- nothing wired → every stage unobservable, counts NULL (never 0) ---------- */
{
  const f = makeSoftwareFactory({});
  const r = f.pipeline('acme');
  A.eq(r.counts.reached, 0, 'nothing is reached');
  A.eq(r.counts.unobservable, 8, 'all eight are unobservable');
  A.ok(r.stages.every(s => s.state === 'unobservable'), 'every stage reads unobservable');
  A.ok(r.stages.every(s => s.count === null), 'and every count is NULL, not 0 — unavailable ≠ empty');
  A.ok(r.availability.tasks === false, 'availability says the task source is unreadable');
  A.eq(r.currentStage, null, 'with nothing observable, there is no current stage');
}

/* ---------- a fully empty but READABLE system → idea pending, everything after blocked ---------- */
{
  const f = mkBiz(null)({ opportunities: [], validations: [], tasks: [], workorders: [] });
  const r = f.pipeline('acme');
  A.eq(r.counts.reached, 0, 'nothing reached');
  A.eq(r.stages[0].state, 'pending', 'idea is PENDING (readable, just empty)');
  A.eq(r.stages[0].count, 0, 'and its count is a real 0');
  A.eq(r.stages[1].state, 'blocked', 'validate is blocked behind idea');
  A.eq(r.stages[1].blockedBy, 'idea', 'and names the prior stage it waits on');
  A.eq(r.stages[2].blockedBy, 'idea', 'business is blocked by the SAME first unreached stage');
  A.eq(r.currentStage, 'idea', 'the current stage is the first unreached one');
  A.ok(r.stages.slice(1).every(s => s.blockedBy === 'idea'), 'every later stage names the first unreached gate');
}

/* ---------- a partial pipeline: idea + validate reached, business pending ---------- */
{
  const f = mkBiz(null)({
    opportunities: [{ id: 'o1', title: 'Notes app', stage: 'validated', businessId: '' }],
    validations: [{ id: 'v1', verdict: 'supported', method: 'survey' }, { id: 'v2', verdict: 'pending' }],
    tasks: [], workorders: []
  });
  const r = f.pipeline('acme');
  A.eq(r.stages[0].state, 'reached', 'idea reached (an opportunity exists)');
  A.eq(r.stages[0].count, 1, 'with a real count');
  A.ok(r.stages[0].evidence[0].indexOf('Notes app') >= 0, 'and names the opportunity');
  A.eq(r.stages[1].state, 'reached', 'validate reached (a non-pending verdict exists)');
  A.eq(r.counts.reached, 2, 'counts.reached is a real number (2)');
  A.eq(r.stages[2].state, 'pending', 'business is pending (readable, no business named yet)');
  A.eq(r.currentStage, 'business', 'the current stage is business');
}

/* ---------- business reached via promotion (businessId matches) ---------- */
{
  const f = mkBiz({ id: 'acme', name: 'Acme', stage: 'building' })({
    opportunities: [{ id: 'o1', title: 'Notes app', businessId: 'acme' }],
    validations: [{ id: 'v1', verdict: 'supported' }],
    tasks: [{ id: 't1', title: 'Design MVP', status: 'todo' }],
    workorders: []
  });
  const r = f.pipeline('acme');
  A.eq(r.stages[2].state, 'reached', 'business reached');
  A.ok(r.stages[2].evidence.join(' ').indexOf('promoted') >= 0, 'the evidence names the promotion');
  A.eq(r.stages[3].state, 'reached', 'spec reached (a task plan exists)');
  A.eq(r.stages[4].state, 'pending', 'build pending (all tasks still todo)');
  A.eq(r.business.stage, 'building', 'the business stage is reported');
  A.eq(r.stages[7].state, 'blocked', 'operate is blocked (business is not live yet)');
}

/* ---------- build/test/ship/operate all reached ---------- */
{
  const f = mkBiz({ id: 'acme', name: 'Acme', stage: 'live' })({
    opportunities: [{ id: 'o1', title: 'Notes app', businessId: 'acme' }],
    validations: [{ id: 'v1', verdict: 'supported' }],
    tasks: [
      { id: 't1', title: 'Build product', status: 'done' },
      { id: 't2', title: 'Test product', status: 'review' },
      { id: 't3', title: 'Launch', status: 'done' }
    ],
    workorders: [{ id: 'w1', intent: 'ship the app', status: 'done' }]
  });
  const r = f.pipeline('acme');
  A.eq(r.counts.reached, 8, 'all eight stages are reached');
  A.eq(r.counts.pending, 0, 'nothing is pending');
  A.eq(r.counts.blocked, 0, 'nothing is blocked');
  A.eq(r.currentStage, null, 'and there is no current stage — the pipeline is complete');
  A.eq(r.stages[5].state, 'reached', 'test reached (a task hit done/review)');
  A.eq(r.stages[6].state, 'reached', 'ship reached (a work order is terminal)');
  A.eq(r.stages[7].state, 'reached', 'operate reached (the business is live)');
}

/* ---------- an unreadable source marks ONLY its stages; the rest still resolve ---------- */
{
  const f = mkBiz({ id: 'acme', stage: 'live' })({
    opportunities: [{ id: 'o1', title: 'Notes app', businessId: 'acme' }],
    validations: 'throw',                                  // validations blows up
    tasks: [{ id: 't1', title: 'Build', status: 'done' }],
    workorders: []
  });
  const r = f.pipeline('acme');
  A.eq(r.stages[1].state, 'unobservable', 'validate is unobservable (its source threw)');
  A.eq(r.stages[1].count, null, 'its count is NULL, never 0');
  A.eq(r.availability.validations, false, 'availability reports the failure');
  A.eq(r.stages[3].state, 'reached', 'the OTHER stages still resolve normally');
  A.eq(r.stages[0].state, 'reached', 'idea still reached');
}

/* ---------- a business that exists but is not live → operate not reached ---------- */
{
  const f = mkBiz({ id: 'acme', stage: 'planning' })({
    opportunities: [{ id: 'o1', businessId: 'acme' }], validations: [{ verdict: 'supported' }],
    tasks: [{ id: 't1', title: 'T', status: 'doing' }], workorders: []
  });
  const r = f.pipeline('acme');
  A.eq(r.stages[7].state, 'blocked', 'operate is not reached for a planning business');
  A.eq(r.stages[7].count, 0, 'its count is a real 0 (the business was read, just not live)');
  A.ok(r.stages[7].evidence.length === 0, 'and it names no evidence');
}

/* ---------- determinism + honesty source-locks ---------- */
{
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // the note STRING intentionally names the refused concepts, so strip string literals too before locking.
  const BARE = CODE.replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""');
  A.ok(!/Date\.now|Math\.random/.test(BARE), 'no clock, no rng');
  A.ok(!/\bpercent\b|\bprogress\b|\bscore\b|\bgrade\b|\bhealth\b/i.test(BARE), 'the CODE has no percent/progress/score/grade/health (outside prose strings)');
  A.ok(SRC.indexOf('unobservable') >= 0, 'the unobservable state exists');
  A.ok(SRC.indexOf('There is no percentage') >= 0, 'the note refuses a percentage explicitly');
}

A.report('software-factory');
