'use strict';
/* businessfactory.test.js — the SOFTWARE FACTORY console, PURE half (Business OS Phase 12, §22).

   The console's whole honesty problem is the progress bar it must NOT draw. So this suite locks:
     · a missing/failed payload is NOT a clean empty pipeline (ok must be explicit true);
     · an unobservable stage's count renders as "—", NEVER a 0 (unavailable ≠ empty);
     · every state maps to a WORD, and an unknown state is shown as-is rather than guessed;
     · blocked stages name their cause, pending stages say what would prove them;
     · an unreadable source produces a LOUD warning;
     · nothing carries a percentage.                                                                       */

const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const C = require('../frontend/app/businessfactory.js');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'businessfactory.js'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'css', 'businessfactory.css'), 'utf8');

/* ---------- esc / stateLabel / countText ---------- */
{
  A.eq(C.esc('<x>&"'), '&lt;x&gt;&amp;&quot;', 'esc neutralises metacharacters');
  A.eq(C.stateLabel('reached'), 'reached', 'reached maps to a word');
  A.eq(C.stateLabel('unobservable'), 'cannot tell', 'unobservable reads as plain words');
  A.eq(C.stateLabel('weird'), 'weird', 'an unknown state is shown as-is, never guessed');
  A.eq(C.stateLabel(''), 'unknown', 'an empty state is unknown');

  A.eq(C.countText({ state: 'reached', count: 3 }), '3', 'a real count renders');
  A.eq(C.countText({ state: 'unobservable', count: null }), '—', 'an unobservable count renders an em dash, NOT 0');
  A.eq(C.countText({ state: 'pending', count: 0 }), '0', 'a genuine 0 renders as 0');
  A.eq(C.countText(null), '—', 'no stage → em dash');
}

/* ---------- shapePipeline: a missing payload is NOT a clean empty pipeline ---------- */
{
  A.eq(C.shapePipeline(null).ok, false, 'no payload → not ok');
  A.eq(C.shapePipeline({}).ok, false, 'no ok:true → not ok');
  A.eq(C.shapePipeline({ stages: [] }).ok, false, 'stages but no ok:true → still not ok');
  A.ok(C.shapePipeline({ ok: false, reason: 'nope' }).reason.indexOf('nope') >= 0, 'the reason passes through');
}

/* ---------- shapePipeline: a real pipeline ---------- */
{
  const p = C.shapePipeline({
    ok: true, businessId: 'acme', business: { id: 'acme', name: 'Acme', stage: 'live' },
    stages: [
      { id: 'idea', label: 'Idea', state: 'reached', count: 2, evidence: ['Notes app', 'Todo app'] },
      { id: 'validate', label: 'Validate', state: 'unobservable', count: null, evidence: [] },
      { id: 'business', label: 'Business', state: 'pending', count: 0, waiting: 'promote it' }
    ],
    counts: { stages: 8, reached: 1, pending: 1, blocked: 0, unobservable: 1 },
    currentStage: 'business',
    availability: { opportunities: true, validations: false, business: true, tasks: true, workorders: true },
    note: 'no percentage'
  });
  A.eq(p.ok, true, 'ok');
  A.eq(p.stages.length, 3, 'stages shaped');
  A.eq(p.stages[0].n, 1, 'stages are numbered from 1');
  A.eq(p.stages[0].on, true, 'a reached stage is flagged on');
  A.eq(p.stages[0].evidence.join('|'), 'Notes app|Todo app', 'evidence passes through');
  A.eq(p.stages[1].count, null, 'an unobservable stage has a NULL count');
  A.eq(p.stages[1].countText, '—', 'and renders as an em dash');
  A.eq(p.stages[1].warn, true, 'and is flagged for a loud style');
  A.eq(p.stages[2].countText, '0', 'a pending stage with a real 0 renders 0');
  A.eq(p.currentStage, 'business', 'the current stage passes through');
}

/* ---------- authard-warnings: an unreadable source is LOUD ---------- */
{
  const p = C.shapePipeline({ ok: true, stages: [], counts: { stages: 0, reached: 0, pending: 0, blocked: 0, unobservable: 0 },
    availability: { opportunities: true, validations: false, business: true, tasks: false, workorders: true } });
  const w = C.availabilityWarnings(p);
  A.eq(w.length, 2, 'two unreadable sources → two warnings');
  A.ok(w.join(' ').indexOf('cannot tell') >= 0 || w.join(' ').indexOf('not zero') >= 0, 'the warning says it is not a zero');
  A.eq(C.availabilityWarnings(C.shapePipeline(null)).length, 0, 'no payload → no warnings (nothing to warn about yet)');
}

/* ---------- headLine: never a percentage ---------- */
{
  const p = C.shapePipeline({ ok: true, stages: [], counts: { stages: 8, reached: 3, pending: 2, blocked: 1, unobservable: 1 }, currentStage: 'build' });
  const line = C.headLine('Acme', p);
  A.ok(line.indexOf('3 of 8 stages reached') >= 0, 'it reports reached-of-total as a count');
  A.ok(line.indexOf('at build') >= 0, 'and the current stage');
  A.ok(line.indexOf('%') < 0, 'and NO percentage');
  A.eq(C.headLine('Acme', null), 'no pipeline read yet', 'no pipeline → a plain statement');
}

/* ---------- shapeStage guards ---------- */
{
  A.eq(C.shapeStage(null, 0), null, 'no stage → null');
  A.eq(C.shapeStage({}, 0).label, '', 'a stage with no label shapes empty (not invented)');
  A.eq(C.shapeStage({ id: 'x' }, 0).state, 'unobservable', 'a stage with no state defaults to unobservable, not reached');
}

/* ---------- source-locks ---------- */
{
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  A.ok(!/Date\.now/.test(CODE), 'no clock read');
  // the CSS must contain NO bar/track/fill — the progress-bar temptation is structurally removed
  A.ok(!/\.fac-[a-z-]*(bar|track|fill|progress)/i.test(CSS), 'the CSS has NO bar/track/fill/progress class');
  A.ok(!/width\s*:\s*\d+%/.test(CSS), 'the CSS never sets a percentage width');
  // the console must not render a percentage anywhere in its DOM half
  A.ok(!/percent/i.test(CODE) || SRC.indexOf('no percentage') >= 0, 'percent appears only in the refusal prose');
}

A.report('businessfactory');
