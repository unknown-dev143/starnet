/* sidecar/business-templates.js — the BUSINESS TEMPLATE SYSTEM (master prompt §25) and the §9 task-plan
   generator that turns a template (or a stated goal) into an ORDERED, CONCRETE task list.

   PURE: no IO, no clock, no env, no rng, no network. Everything here is a deterministic function of its
   arguments, which is what lets the same call be replayed in a test and in the app and produce the same plan.
   UMD so the frontend planner can preview a plan without a round trip.

   WHAT IS A TEMPLATE. §25 names four funnels and each is a fixed sequence of STAGES; a stage owns the tasks
   that must exist before the next stage is worth starting. The task order is therefore not cosmetic — it is
   the dependency order, and business-tasks-store records it as real `dependsOn` edges when a plan is
   materialised into a business.

   TWO KINDS OF PLAN, AND WHY BOTH EXIST (they are not duplicates — §25 and §9 describe different things):
     templatePlan(id)  — the §25 funnel, expanded to tasks. This is what "create a SaaS business" produces.
     goalPlan(text)    — a plan for a STATED GOAL. §9 gives one worked example verbatim: "Launch a digital
                         product" -> a specific 10-task order. That order is NOT the digital-product funnel
                         (§9 puts the landing page before the product and adds marketing + launch; §25's
                         digital-product funnel trades those for Checkout/Delivery/Support), so collapsing the
                         two into one list would silently misreport one of them. Both are exposed, each is
                         labelled with the section it came from, and neither is invented.

   P1 — EFFORT IS LABELLED, NOT ASSERTED. Every task's effort is `{ hours, evidence: 'estimate' }`. An
   unlabelled number would read as a measured fact; a plan has never been executed, so the honest class is
   always 'estimate'. The UI renders it as "est. 6h", never as "6h".

   P7 — NO FAKE INTELLIGENCE. goalPlan matches by an explicit keyword table and REPORTS what it matched
   (`matchedBy`) and whether the match was confident. A goal it does not recognise is REFUSED with the list of
   goals it does know, rather than guessed at — a planner that always produces a plausible-looking plan is
   exactly the thing §26's confidence discipline exists to prevent. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).businessTemplates = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Aligned with business-tasks-store's closed vocabularies so a generated task is always a legal task.
  const PRIORITIES = ['low', 'normal', 'high', 'critical'];

  // A task blueprint: what the plan says, before a business owns it. `approval` is true where the master
  // prompt requires a human gate (§26) — anything that spends money or goes public.
  function task(title, priority, hours, approval) {
    return {
      title: title,
      priority: PRIORITIES.indexOf(priority) >= 0 ? priority : 'normal',
      effort: { hours: hours, evidence: 'estimate' },
      approvalRequired: !!approval
    };
  }

  /* §25's funnels, verbatim in name and order. `stage.id` is stable and is what tasks-store stores as the
     task's `stage`; `stage.label` is the human string the UI shows. Order within a stage is the intended
     order of execution. */
  const TEMPLATES = [
    {
      id: 'saas', label: 'SaaS', blurb: 'A subscription software product: research, build an MVP, prove the landing page, then launch and measure.',
      stages: [
        { id: 'research', label: 'Research', tasks: [
          task('Research the market and demand', 'high', 6),
          task('Analyse competitors and their pricing', 'high', 5),
          task('Define the target customer and their problem', 'high', 4),
          task('Decide the subscription model and price points', 'normal', 3, true)
        ] },
        { id: 'mvp', label: 'MVP', tasks: [
          task('Write the MVP specification (what is in, what is out)', 'high', 4),
          task('Choose the stack and set up the repo', 'normal', 3),
          task('Build the smallest end-to-end slice', 'high', 24),
          task('Write tests for the core path', 'normal', 8)
        ] },
        { id: 'landing', label: 'Landing Page', tasks: [
          task('Write the value proposition and headline', 'high', 3),
          task('Build the landing page', 'normal', 8),
          task('Add a signup / waitlist capture', 'normal', 3),
          task('Set up analytics on the page', 'low', 2)
        ] },
        { id: 'product', label: 'Product', tasks: [
          task('Build the account and billing flow', 'high', 16, true),
          task('Harden the product against the MVP spec', 'normal', 16),
          task('Run a closed beta with real users', 'high', 10)
        ] },
        { id: 'launch', label: 'Launch', tasks: [
          task('Prepare launch assets and copy', 'normal', 6),
          task('Publish the launch and announce it', 'high', 4, true)
        ] },
        { id: 'analytics', label: 'Analytics', tasks: [
          task('Instrument the product metrics that matter', 'normal', 6),
          task('Set up a weekly performance report', 'low', 3)
        ] }
      ]
    },
    {
      id: 'content', label: 'Content', blurb: 'A content business: research demand, produce, publish, then measure what actually gets read.',
      stages: [
        { id: 'research', label: 'Research', tasks: [
          task('Research the audience and their questions', 'high', 5),
          task('Research keywords and search demand', 'high', 4),
          task('Analyse what already ranks and why', 'normal', 4)
        ] },
        { id: 'content', label: 'Content', tasks: [
          task('Define the content pillars and formats', 'high', 3),
          task('Build a content calendar', 'normal', 3),
          task('Write the first three pieces', 'high', 12)
        ] },
        { id: 'production', label: 'Production', tasks: [
          task('Set up the production pipeline and templates', 'normal', 6),
          task('Define the editorial checklist and review step', 'low', 2)
        ] },
        { id: 'publishing', label: 'Publishing', tasks: [
          task('Choose and set up the publishing channels', 'normal', 4),
          task('Publish and distribute the first pieces', 'high', 4, true),
          task('Set up the subscribe / follow capture', 'normal', 3)
        ] },
        { id: 'analytics', label: 'Analytics', tasks: [
          task('Instrument readership and conversion metrics', 'normal', 5),
          task('Set up a monthly content performance review', 'low', 2)
        ] }
      ]
    },
    {
      id: 'digital-product', label: 'Digital Product', blurb: 'A one-off digital product: research, build it, sell it through a checkout, then deliver and support it.',
      stages: [
        { id: 'research', label: 'Research', tasks: [
          task('Research the market and demand', 'high', 6),
          task('Analyse competitors and comparable products', 'high', 5),
          task('Define the target customer and their problem', 'high', 4)
        ] },
        { id: 'product', label: 'Product', tasks: [
          task('Design the MVP scope of the product', 'high', 4),
          task('Build the product', 'high', 24),
          task('Test the product end to end', 'high', 8)
        ] },
        { id: 'landing', label: 'Landing Page', tasks: [
          task('Write the value proposition and offer', 'high', 3),
          task('Build the landing page', 'normal', 8),
          task('Create the marketing assets', 'normal', 6)
        ] },
        { id: 'checkout', label: 'Checkout', tasks: [
          task('Set up the payment checkout', 'high', 6, true),
          task('Configure the product delivery', 'normal', 4)
        ] },
        { id: 'delivery', label: 'Delivery', tasks: [
          task('Deliver the product to the first buyers', 'high', 3),
          task('Launch the product publicly', 'high', 4, true)
        ] },
        { id: 'support', label: 'Support', tasks: [
          task('Set up customer support and a refund policy', 'normal', 4),
          task('Monitor results and iterate', 'normal', 4)
        ] }
      ]
    },
    {
      id: 'agency', label: 'Agency', blurb: 'A services business: generate leads, propose, land a client, deliver a project, invoice.',
      stages: [
        { id: 'leadgen', label: 'Lead Generation', tasks: [
          task('Define the ideal client and the offer', 'high', 5),
          task('Build the outreach list and channels', 'high', 6),
          task('Set up the lead capture and CRM', 'normal', 4)
        ] },
        { id: 'proposal', label: 'Proposal', tasks: [
          task('Write the proposal and pricing template', 'high', 5),
          task('Send the first outreach batch', 'high', 4),
          task('Follow up and book calls', 'normal', 4)
        ] },
        { id: 'client', label: 'Client', tasks: [
          task('Run the discovery call and scope the work', 'high', 4),
          task('Sign the agreement and collect the deposit', 'high', 3, true),
          task('Set up the client workspace and comms', 'normal', 3)
        ] },
        { id: 'project', label: 'Project', tasks: [
          task('Plan the delivery and milestones', 'high', 4),
          task('Deliver the work', 'high', 24),
          task('Run the client review and revisions', 'normal', 8)
        ] },
        { id: 'delivery', label: 'Delivery', tasks: [
          task('Hand over the final deliverables', 'high', 3),
          task('Request a testimonial and a referral', 'low', 2)
        ] },
        { id: 'invoice', label: 'Invoice', tasks: [
          task('Send the final invoice', 'high', 2),
          task('Reconcile the payment and close the project', 'normal', 2)
        ] }
      ]
    },
    {
      id: 'custom', label: 'Custom', blurb: 'No funnel assumed. A generic plan you are expected to edit — it makes no claim about your business.',
      stages: [
        { id: 'plan', label: 'Plan', tasks: [
          task('Define the goal and how you will know it worked', 'high', 3),
          task('Identify the resources required', 'normal', 3)
        ] },
        { id: 'build', label: 'Build', tasks: [
          task('Build the first version', 'high', 16),
          task('Test it', 'high', 6)
        ] },
        { id: 'launch', label: 'Launch', tasks: [
          task('Prepare the launch', 'normal', 4),
          task('Launch', 'high', 3, true)
        ] },
        { id: 'operate', label: 'Operate', tasks: [
          task('Measure the results', 'normal', 4),
          task('Decide what to change next', 'normal', 3)
        ] }
      ]
    }
  ];

  const TEMPLATE_IDS = TEMPLATES.map(t => t.id);
  const byId = (id) => TEMPLATES.filter(t => t.id === id)[0] || null;

  /* §9's worked example, kept EXACTLY as written. The order is the master prompt's, not a tidied version of
     it: the landing page really does come before the product there, because the plan is testing demand before
     committing build time. Reproduced verbatim so a reviewer can diff it against §9 line by line. */
  const GOAL_PLANS = [
    {
      id: 'launch-a-digital-product',
      label: 'Launch a digital product',
      source: 'master prompt §9 (worked example)',
      template: 'digital-product',
      keywords: ['launch', 'digital', 'product'],
      tasks: [
        'Research market', 'Analyze competitors', 'Define customer', 'Design MVP', 'Build landing page',
        'Build product', 'Test product', 'Create marketing assets', 'Launch', 'Monitor results'
      ]
    }
  ];

  // Normalise free text for keyword matching: lowercase, collapse everything non-alphanumeric to a space.
  function norm(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  /* MATCH A STATED GOAL — deterministically, and REPORTING how. A goal matches only when EVERY keyword of a
     known plan is present; the caller gets the plan plus the exact tokens that matched. No fuzzy guessing:
     a partial match is not a match, because a half-matching plan presented as "your plan" is a fabrication. */
  function goalPlan(goal) {
    const text = norm(goal);
    if (!text) {
      return { ok: false, reason: 'a goal is required', knownGoals: GOAL_PLANS.map(g => g.label) };
    }
    const tokens = text.split(' ').filter(Boolean);
    for (const g of GOAL_PLANS) {
      if (g.keywords.every(k => tokens.indexOf(k) >= 0)) {
        return {
          ok: true,
          goal: g.label,
          source: g.source,
          template: g.template,
          matchedBy: g.keywords.slice(),
          tasks: g.tasks.map(t => task(t, 'normal', 4))
        };
      }
    }
    // refuse rather than guess — and say what it DOES know, so the refusal is actionable.
    return {
      ok: false,
      reason: 'no plan for that goal — this planner only knows the goals the master prompt specifies, and it will not invent one',
      knownGoals: GOAL_PLANS.map(g => g.label)
    };
  }

  /* TEMPLATE PLAN — the §25 funnel expanded to a flat, ordered task list. Order is stage order, then the
     task order within the stage, and that flat order IS the dependency order (see materialisePlan in
     business-tasks-store: each task depends on the one before it). */
  function templatePlan(templateId) {
    const t = byId(String(templateId == null ? '' : templateId));
    if (!t) {
      return { ok: false, reason: 'unknown template: ' + templateId + ' — one of: ' + TEMPLATE_IDS.join(', '), templates: TEMPLATE_IDS };
    }
    const out = [];
    for (const stage of t.stages) {
      for (const tk of stage.tasks) {
        out.push({
          title: tk.title, stage: stage.id, stageLabel: stage.label,
          priority: tk.priority, effort: { hours: tk.effort.hours, evidence: 'estimate' },
          approvalRequired: tk.approvalRequired
        });
      }
    }
    return { ok: true, template: t.id, label: t.label, tasks: out, stages: t.stages.map(s => ({ id: s.id, label: s.label, count: s.tasks.length })) };
  }

  // The catalogue the UI renders. Blurbs are plain description — no ranking, no "best" claim.
  function catalog() {
    return TEMPLATES.map(t => ({
      id: t.id, label: t.label, blurb: t.blurb,
      stageCount: t.stages.length,
      taskCount: t.stages.reduce((n, s) => n + s.tasks.length, 0),
      stages: t.stages.map(s => ({ id: s.id, label: s.label, count: s.tasks.length }))
    }));
  }

  const stageLabel = (templateId, stageId) => {
    const t = byId(String(templateId == null ? '' : templateId));
    if (!t) return '';
    const s = t.stages.filter(x => x.id === stageId)[0];
    return s ? s.label : '';
  };

  return {
    TEMPLATES, TEMPLATE_IDS, PRIORITIES, GOAL_PLANS,
    catalog, templatePlan, goalPlan, stageLabel, byId
  };
});
