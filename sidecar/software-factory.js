/* sidecar/software-factory.js — §22 AI SOFTWARE FACTORY, the IDEA→…→DEPLOY PIPELINE (Business OS Phase 12).

   THE GAP THIS CLOSES. The audit recorded §22 as "partial — terminal + code tools exist; no Idea→Spec→…→Deploy
   artifact." Every PIECE already existed and was already honest: an opportunity (a claim set with an evidence
   label per field), a validation run that tries to kill it, a promoted business, a task plan, work orders the
   worker drives, and code/terminal tools a work order can reach. What did not exist was a single read that
   lays out the WHOLE pipeline for one business and says — truthfully — where it actually is.

   WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT.

       It is a COMPOSER, not a build system. It owns no store and writes nothing. It reads the six stores that
       already hold the facts and assembles ONE view: for each of the eight stages the brief names, is there
       EVIDENCE that the stage was reached, and what is that evidence?

   THE GOVERNING RULE, P7 — NO FAKE INTELLIGENCE. The overwhelming temptation in a "factory" is a progress
   bar: a confident 62% with the stages ticked off in sequence. That would be a fabrication, twice over:
     (1) it would claim stages are ORDERED and COMPLETE when the underlying work is arbitrary; and
     (2) it would INVENT the percentage from nothing.
   So this module does neither. For every stage it decides exactly one of three states from RECORDED FACTS:

       reached    — there is at least one concrete record proving this stage happened (named in `evidence`)
       pending    — the earlier gates are open but nothing yet proves this stage (named in `waiting`)
       blocked    — a PRIOR stage has not been passed, so this one cannot have been (named in `blockedBy`)

   `reached` is only ever set by a COUNTABLE fact — an opportunity with this business as its promoted target,
   a validation run with a verdict, a task in a given status, a work order, a step that dispatched a code
   tool. There is no stage whose `reached` is a guess.

   THE EIGHT STAGES (the brief's pipeline, each mapped to the store that PROVES it):
       1. idea      — an opportunity exists                      (opportunities-store)
       2. validate  — a validation run has a non-pending verdict (validation-store)
       3. business  — the opportunity was PROMOTED to a business  (opportunities-store.businessId)
       4. spec      — the business has a task plan               (business-tasks-store)
       5. build     — tasks have moved past 'todo'               (business-tasks-store)
       6. test      — a task reached 'review' or 'done'          (business-tasks-store)
       7. ship      — a work order reached a terminal status     (business-workorders-store)
       8. operate   — the business is 'live' (or beyond)         (businesses-store)
   The stage LIST is data, not code, so the console and the tests read the same eight names. A caller may
   override the set, but the DEFAULT is the brief's.

   THREE STRUCTURAL CONSTRAINTS:

     1. AN UNREADABLE SOURCE IS REPORTED, NOT SHOWN AS ZERO. If a store is missing or throws, the stages it
        proves are marked `unobservable` — never `pending`, which would read as "you have not done this yet"
        when the truth is "this cannot be seen from here". (The house rule: unavailable ≠ empty.)

     2. NO STAGE IS SKIPPED SILENTLY. A stage declared `blocked` names the PRIOR stage it waits on, so a
        reader can act on it. Stages are listed in the brief's order, always, whatever their state.

     3. NO SCORE, NO PERCENTAGE, NO GRADE. The view carries per-stage FACTS and counts. It carries no
        completion number, because any such number would be invented. (Locked by test.)

   PURE-ish UMD: no IO, no clock, no rng. All six sources are injected accessors. Without one, its stages read
   `unobservable` and everything else still works. */

'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).softwareFactory = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* The brief's eight stages, in order. `id` is stable; `label` is display. `needs` names the prior stage a
     stage is blocked by — the pipeline is strictly sequential per the brief, so needs = the stage before. */
  const STAGES = [
    { id: 'idea', label: 'Idea', blurb: 'an opportunity exists — a claim set you can label evidence for' },
    { id: 'validate', label: 'Validate', blurb: 'a validation run tried to kill it and recorded a verdict' },
    { id: 'business', label: 'Business', blurb: 'the opportunity was promoted into a real business' },
    { id: 'spec', label: 'Spec', blurb: 'the business has a task plan — what work would make it real' },
    { id: 'build', label: 'Build', blurb: 'tasks have moved past todo — building actually started' },
    { id: 'test', label: 'Test', blurb: 'a task reached review or done — something was checked' },
    { id: 'ship', label: 'Ship', blurb: 'a work order ran to a terminal status' },
    { id: 'operate', label: 'Operate', blurb: 'the business is live or beyond' }
  ];
  const STAGE_IDS = STAGES.map(s => s.id);

  const STATES = ['reached', 'pending', 'blocked', 'unobservable'];

  // businesses-store's lifecycle, mirrored only for the ONE comparison this module makes. Kept local so the
  // module has no store dependency; the value is the tail of the shared INACTIVE_STAGES.
  const OPERATING_FROM = ['live', 'growing'];

  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
  const str = (v) => (v == null ? '' : String(v));

  function makeSoftwareFactory(deps) {
    deps = deps || {};

    // Each source is an accessor. `read(name, fn, fallback)` runs it and reports whether it was READABLE,
    // so an unreadable source is never silently mistaken for an empty one.
    function read(name, fn, fallback) {
      if (typeof fn !== 'function') return { ok: false, name: name, value: fallback, reason: 'not wired' };
      try {
        const v = fn();
        return { ok: true, name: name, value: (v === undefined ? fallback : v), reason: '' };
      } catch (e) {
        return { ok: false, name: name, value: fallback, reason: str(e && e.message) || 'read failed' };
      }
    }

    /* Read every source ONCE and normalise it. This is the only place a store is touched. */
    function gather(businessId) {
      const biz = str(businessId).trim();
      const src = {};

      // 1. opportunities — all of them; we filter to the ones that name this business (promoted) and, for the
      //    idea gate, any opportunity at all (an idea need not yet be tied to a business).
      src.opportunities = read('opportunities', deps.opportunities && (() => deps.opportunities.list()), []);

      // 2. validations — every run across every opportunity (the store is keyed by opportunity id).
      src.validations = read('validations', deps.validations && (() => deps.validations.list()), []);

      // 3. the business itself (for the operate gate).
      src.business = read('business', deps.businesses && (() => deps.businesses.get(biz)), null);

      // 4+5+6. the business's tasks (spec/build/test all read this one list).
      src.tasks = read('tasks', deps.tasks && (() => deps.tasks.list(biz)), []);

      // 7. the business's work orders (ship).
      src.workorders = read('workorders', deps.workorders && (() => deps.workorders.list(biz)), []);

      return src;
    }

    /* --- the per-stage facts. Each returns { count, evidence:[str], unobservable:bool } ------------------- */

    // idea — an opportunity exists (any, since an idea is pre-business).
    function factIdea(src) {
      if (!src.opportunities.ok) return { count: 0, evidence: [], unobservable: true };
      const list = Array.isArray(src.opportunities.value) ? src.opportunities.value : [];
      return {
        count: list.length,
        evidence: list.slice(0, 4).map(o => str(o.title || o.id)),
        unobservable: false
      };
    }

    // validate — a run with a non-pending verdict.
    function factValidate(src) {
      if (!src.validations.ok) return { count: 0, evidence: [], unobservable: true };
      const list = Array.isArray(src.validations.value) ? src.validations.value : [];
      const decided = list.filter(v => v && v.verdict && v.verdict !== 'pending');
      return {
        count: decided.length,
        evidence: decided.slice(0, 4).map(v => str(v.verdict) + (v.method ? ' (' + str(v.method) + ')' : '')),
        unobservable: false
      };
    }

    // business — an opportunity was promoted INTO this business (businessId matches).
    function factBusiness(src, businessId) {
      if (!src.opportunities.ok) return { count: 0, evidence: [], unobservable: true };
      const list = Array.isArray(src.opportunities.value) ? src.opportunities.value : [];
      const promoted = list.filter(o => o && str(o.businessId) === businessId);
      // also count the business simply existing as evidence the stage was reached
      const exists = !!(src.business.ok && src.business.value);
      const evidence = promoted.slice(0, 4).map(o => 'promoted: ' + str(o.title || o.id));
      if (exists && !promoted.length) evidence.push('business exists: ' + businessId);
      return { count: promoted.length + (exists ? 1 : 0), evidence: evidence, unobservable: false };
    }

    // spec — the business has at least one task.
    function factSpec(src) {
      if (!src.tasks.ok) return { count: 0, evidence: [], unobservable: true };
      const list = Array.isArray(src.tasks.value) ? src.tasks.value : [];
      return {
        count: list.length,
        evidence: list.slice(0, 3).map(t => str(t.title)),
        unobservable: false
      };
    }

    // build — tasks that have moved past 'todo'.
    function factBuild(src) {
      if (!src.tasks.ok) return { count: 0, evidence: [], unobservable: true };
      const list = Array.isArray(src.tasks.value) ? src.tasks.value : [];
      const moved = list.filter(t => t && str(t.status) !== 'todo' && str(t.status) !== 'cancelled');
      return {
        count: moved.length,
        evidence: moved.slice(0, 4).map(t => str(t.status) + ': ' + str(t.title)),
        unobservable: false
      };
    }

    // test — a task reached 'review' or 'done'.
    function factTest(src) {
      if (!src.tasks.ok) return { count: 0, evidence: [], unobservable: true };
      const list = Array.isArray(src.tasks.value) ? src.tasks.value : [];
      const checked = list.filter(t => t && (str(t.status) === 'review' || str(t.status) === 'done'));
      return {
        count: checked.length,
        evidence: checked.slice(0, 4).map(t => str(t.status) + ': ' + str(t.title)),
        unobservable: false
      };
    }

    // ship — a work order reached a terminal status.
    function factShip(src) {
      if (!src.workorders.ok) return { count: 0, evidence: [], unobservable: true };
      const list = Array.isArray(src.workorders.value) ? src.workorders.value : [];
      const terminal = list.filter(o => o && (str(o.status) === 'done' || str(o.status) === 'failed'));
      return {
        count: terminal.length,
        evidence: terminal.slice(0, 4).map(o => str(o.status) + ': ' + str(o.intent || o.id)),
        unobservable: false
      };
    }

    // operate — the business is live (or beyond).
    function factOperate(src) {
      if (!src.business.ok) return { count: 0, evidence: [], unobservable: true };
      const b = src.business.value;
      if (!b) return { count: 0, evidence: [], unobservable: false };   // readable, just absent → not reached
      const live = OPERATING_FROM.indexOf(str(b.stage)) >= 0;
      return {
        count: live ? 1 : 0,
        evidence: live ? ['stage: ' + str(b.stage)] : [],
        unobservable: false
      };
    }

    /* ASSEMBLE the pipeline for one business. Stages are ALWAYS all eight, in order, whatever their state. */
    function pipeline(businessId) {
      const biz = str(businessId).trim();
      if (!biz) return { ok: false, reason: 'a business is required (which pipeline?)' };

      const src = gather(biz);
      const facts = {
        idea: factIdea(src),
        validate: factValidate(src),
        business: factBusiness(src, biz),
        spec: factSpec(src),
        build: factBuild(src),
        test: factTest(src),
        ship: factShip(src),
        operate: factOperate(src)
      };

      /* Decide each stage's state in ORDER. `reached` is decided purely by the fact's count. A stage with no
         fact yet whose PRIOR stage is not reached is `blocked` (and names the prior). `unobservable` when the
         proving source could not be read. This is a deterministic fold, not a judgment. */
      const rows = [];
      let firstUnreached = null;
      for (const st of STAGES) {
        const f = facts[st.id] || { count: 0, evidence: [], unobservable: true };
        let state, blockedBy = '', waiting = '';
        if (f.unobservable) {
          state = 'unobservable';
        } else if (num(f.count) > 0) {
          state = 'reached';
        } else if (firstUnreached) {
          state = 'blocked';
          blockedBy = firstUnreached;                          // the first stage that is not reached
        } else {
          state = 'pending';
          waiting = st.blurb;                                  // what would prove it
        }
        if (state !== 'reached' && state !== 'unobservable' && !firstUnreached) firstUnreached = st.id;
        rows.push({
          id: st.id,
          label: st.label,
          blurb: st.blurb,
          state: state,
          count: f.unobservable ? null : num(f.count),         // NULL when unobservable — never a fake 0
          evidence: f.evidence,
          blockedBy: blockedBy,
          waiting: waiting
        });
      }

      const reachedCount = rows.filter(r => r.state === 'reached').length;
      const unobservableCount = rows.filter(r => r.state === 'unobservable').length;

      return {
        ok: true,
        businessId: biz,
        business: (src.business.ok && src.business.value) ? { id: str(src.business.value.id), name: str(src.business.value.name), stage: str(src.business.value.stage) } : null,
        stages: rows,
        stageOrder: STAGE_IDS.slice(),
        counts: {
          stages: rows.length,
          reached: reachedCount,
          pending: rows.filter(r => r.state === 'pending').length,
          blocked: rows.filter(r => r.state === 'blocked').length,
          unobservable: unobservableCount
        },
        // WHERE IT ACTUALLY IS: the FIRST stage not yet reached. Null when every stage is reached.
        currentStage: firstUnreached,
        // availability of the six sources, so an auditor can tell "not done" from "cannot see"
        availability: {
          opportunities: src.opportunities.ok,
          validations: src.validations.ok,
          business: src.business.ok,
          tasks: src.tasks.ok,
          workorders: src.workorders.ok
        },
        note: 'a stage is "reached" only when a recorded fact proves it. There is no percentage or score — the counts and the named evidence are the whole state.'
      };
    }

    return { pipeline, STAGES: STAGES, STAGE_IDS: STAGE_IDS, STATES: STATES };
  }

  return { makeSoftwareFactory, STAGES, STAGE_IDS, STATES };
});
