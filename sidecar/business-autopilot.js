/* sidecar/business-autopilot.js — §9 GOAL AUTOPILOT, the SINGLE ENTRY (Business OS Phase 12).

   THE GAP THIS CLOSES. Before this file, §9 was half-built: business-templates.js knew how to match a STATED
   GOAL against a small table of worked plans (goalPlan), and business-worker.js knew how to plan and run a
   work order — but there was no single door a user could walk through with a big objective and come out the
   other side with the objective IN THE SYSTEM: a business's task list, in dependency order, ready to work.
   The audit recorded exactly this: "Worker plans+runs per order; no single 'big objective → whole plan'
   entry."

   WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT.

       It is a COMPOSER, not a planner. The planning already exists and already belongs to someone else:
         · business-templates.js OWNS the goal vocabulary (GOAL_PLANS) and the plan shape.
         · business-tasks-store.js OWNS the tasks and their dependency chain (materialise chains each task
           to the one before it — the flat order IS the dependency order).
       This module reads those two through injected accessors and drives ONE admission: "resolve this goal,
       expand it, materialise it, and report what happened." It owns no store, and it invents no plan.

   THE GOVERNING RULE, P7 — NO FAKE INTELLIGENCE. §9 gives exactly one worked example: "Launch a digital
   product". A goal autopilot that produced a plausible-looking plan for ANY objective ("expand to Europe",
   "hire a sales team") would be fabricating a plan, which is worse than admitting ignorance because the
   user would ACT on it. So:

       · The catalogue is CLOSED. resolve() matches only the goals the prompt specifies, by an explicit
         keyword rule, and REPORTS the tokens that matched. A partial match is not a match.
       · An unknown goal is REFUSED with the list of goals that ARE known (a 422, not an invented plan).
         The refusal is actionable: it tells the user the one thing they can do instead.
       · `resolve()` is READ-ONLY. It expands a goal to a plan and returns it. `commit()` is the ONE
         mutating door, and it is explicit — a caller must name the goal AND the business, and the store's
         own guards (task cap, duplicate title, dependency validation) still run underneath.

   FOUR STRUCTURAL CONSTRAINTS, each stopping a specific lie:

     1. NO MATCH, NO PLAN. An unmatched goal returns { ok:false, reason, knownGoals } — never a
        best-effort plan built from the tokens it happened to recognise.

     2. THE MATCH IS SHOWN. Every resolved plan carries `matchedBy` (the exact tokens that fired) and
        `source` (where the plan came from). A reader can check the match rather than trust it.

     3. COMMIT REPORTS THE STORE'S VERDICT. `commit()` does not claim the tasks were written; it returns
        the store's OWN result. If materialise refuses (a bad title, the task cap), that reason is
        returned VERBATIM and nothing is written — the composer never reports success the store did not.

     4. A COMMIT IS ALL-OR-NOTHING, BY DELEGATION. The chain of dependencies is built by the store's
        materialise, not re-implemented here (P4 — one place builds a plan's dependency chain).

   PURE-ish UMD: no IO, no clock, no rng. `templates`, `tasks` and `businesses` are injected. Without
   `tasks` this module still RESOLVES (read-only) and REFUSES to commit — a composer that cannot write must
   not pretend it did. */

'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).businessAutopilot = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_TEXT = 400;

  function makeBusinessAutopilot(deps) {
    deps = deps || {};
    const templates = deps.templates || null;
    const tasks = deps.tasks || null;
    const businesses = deps.businesses || null;

    if (!templates || typeof templates.goalPlan !== 'function') {
      throw new Error('business-autopilot.js requires { templates } with goalPlan()');
    }

    const str = (v, cap) => (v == null ? '' : String(v)).slice(0, cap == null ? MAX_TEXT : cap);

    /* The goal catalogue, read straight off the templates module so the two can never drift. Each row is
       the goal's LABEL plus the tokens that fire it — the user sees exactly what a goal must contain. */
    function catalog() {
      const plans = (templates.GOAL_PLANS || []);
      return {
        ok: true,
        goals: plans.map(g => ({
          id: str(g.id),
          label: str(g.label),
          source: str(g.source),
          template: str(g.template),
          keywords: (g.keywords || []).map(k => str(k)),
          taskCount: (g.tasks || []).length
        })),
        count: plans.length,
        note: 'this is a CLOSED set — an autopilot that planned any goal would be inventing a plan, and a plan a user acts on must be one the system can stand behind'
      };
    }

    /* RESOLVE — the single read entry. Turns a stated objective into a full, ordered plan, or refuses.
       READ-ONLY: nothing is written, so a user can see the whole plan before committing to it. */
    function resolve(input) {
      input = input || {};
      const goal = str(input.goal);
      const r = templates.goalPlan(goal);
      if (!r || !r.ok) {
        return {
          ok: false,
          reason: (r && r.reason) || 'no plan for that goal',
          knownGoals: (r && r.knownGoals) || (templates.GOAL_PLANS || []).map(g => g.label)
        };
      }
      // The store's task shape is the target; the plan rows already carry it (templates.task()).
      const planTasks = (r.tasks || []).map(t => ({
        title: str(t.title), priority: t.priority, effort: t.effort,
        approvalRequired: !!t.approvalRequired
      }));
      return {
        ok: true,
        kind: 'plan',            // not 'job' — resolving runs nothing
        goal: str(r.goal),
        source: str(r.source),
        template: str(r.template),
        matchedBy: (r.matchedBy || []).map(k => str(k)),
        tasks: planTasks,
        taskCount: planTasks.length,
        chain: true,             // the store chains each task to the one before it
        staged: true             // explicitly: a resolved plan is STAGED, not committed
      };
    }

    /* COMMIT — the single MUTATING entry. Hands the resolved plan to the task store and returns the
       store's OWN verdict. A refusal (unknown goal, no business, no task store, a store guard) is
       reported verbatim and NOTHING is half-written. */
    function commit(input) {
      input = input || {};
      const businessId = str(input.businessId, 200).trim();
      if (!businessId) return { ok: false, reason: 'an autopilot commit needs a business (which business is the plan for?)' };
      if (!tasks || typeof tasks.materialise !== 'function') {
        return { ok: false, reason: 'no task store is wired — the plan can be resolved but not committed' };
      }
      // A business that does not exist must not quietly accumulate tasks.
      if (businesses && typeof businesses.get === 'function') {
        const b = businesses.get(businessId);
        if (!b) return { ok: false, reason: 'no such business: ' + businessId };
      }

      const resolved = resolve(input);
      if (!resolved.ok) return resolved;   // the refusal carries knownGoals

      const meta = {
        chain: resolved.chain !== false,
        projectId: str(input.projectId, 200)
      };
      const w = tasks.materialise(businessId, resolved.tasks, meta);
      if (!w || !w.ok) {
        // the STORE decides; the composer only relays. No success is fabricated.
        return { ok: false, reason: (w && w.reason) || 'the task store refused the plan' };
      }
      return {
        ok: true,
        goal: resolved.goal,
        template: resolved.template,
        matchedBy: resolved.matchedBy,
        businessId: businessId,
        tasks: w.tasks,                 // the store's rows, verbatim
        created: (w.tasks || []).length,
        chained: !!w.chained,
        note: 'committed — the tasks now belong to the business task store and follow its rules from here'
      };
    }

    return { catalog, resolve, commit };
  }

  return { makeBusinessAutopilot };
});
