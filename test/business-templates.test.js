'use strict';
/* test/business-templates.test.js — the §25 template system + the §9 task-plan generator.

   The load-bearing properties:
     · every §25 funnel exists and its STAGE ORDER matches the master prompt (order IS the dependency order);
     · §9's worked example ("Launch a digital product" -> 10 tasks) is reproduced EXACTLY, in order;
     · every task's effort is labelled an ESTIMATE (P1) — an unlabelled number would read as a measurement;
     · a goal the planner does not know is REFUSED with the list of goals it does know (P7 — no invented plan);
     · the planner is DETERMINISTIC: same input, same output, no clock and no rng. */
const A = require('./_assert.js');
const T = require('../sidecar/business-templates.js');

/* ---------- the catalogue is exactly §25's four funnels plus 'custom' ---------- */
{
  A.eq(T.TEMPLATE_IDS, ['saas', 'content', 'digital-product', 'agency', 'custom'],
    'the catalogue is §25\'s four funnels plus custom, in the prompt\'s order');
  const cat = T.catalog();
  A.eq(cat.length, 5, 'catalog lists all five templates');
  for (const t of cat) {
    A.ok(t.stageCount > 0, t.id + ' has at least one stage');
    A.eq(t.taskCount, t.stages.reduce((n, s) => n + s.count, 0), t.id + ' taskCount equals the sum of its stage counts');
  }
}

/* ---------- each funnel's stage sequence is §25's, verbatim ---------- */
{
  const stageIds = (id) => T.byId(id).stages.map(s => s.id);
  A.eq(stageIds('saas'), ['research', 'mvp', 'landing', 'product', 'launch', 'analytics'],
    'SaaS: Research -> MVP -> Landing Page -> Product -> Launch -> Analytics (§25)');
  A.eq(stageIds('content'), ['research', 'content', 'production', 'publishing', 'analytics'],
    'Content: Research -> Content -> Production -> Publishing -> Analytics (§25)');
  A.eq(stageIds('digital-product'), ['research', 'product', 'landing', 'checkout', 'delivery', 'support'],
    'Digital Product: Research -> Product -> Landing Page -> Checkout -> Delivery -> Support (§25)');
  A.eq(stageIds('agency'), ['leadgen', 'proposal', 'client', 'project', 'delivery', 'invoice'],
    'Agency: Lead Generation -> Proposal -> Client -> Project -> Delivery -> Invoice (§25)');

  // the stage LABELS are the human strings from §25, not the internal ids.
  A.eq(T.stageLabel('saas', 'mvp'), 'MVP', 'stageLabel resolves the display name');
  A.eq(T.stageLabel('agency', 'leadgen'), 'Lead Generation', 'stageLabel resolves a multi-word stage');
  A.eq(T.stageLabel('saas', 'nope'), '', 'an unknown stage resolves to empty, never a guess');
  A.eq(T.stageLabel('nope', 'mvp'), '', 'an unknown template resolves to empty');
}

/* ---------- templatePlan: ordered, flattened, and every task carries a labelled estimate ---------- */
{
  const p = T.templatePlan('saas');
  A.ok(p.ok, 'saas has a plan');
  A.eq(p.template, 'saas', 'the plan names its template');
  A.ok(p.tasks.length > 0, 'the plan has tasks');
  // order is stage order, then task order within the stage — that IS the dependency order.
  const firstOfStage = (id) => p.tasks.filter(t => t.stage === id)[0];
  const idx = (t) => p.tasks.indexOf(t);
  A.ok(idx(firstOfStage('research')) < idx(firstOfStage('mvp')), 'research precedes mvp in the flat order');
  A.ok(idx(firstOfStage('mvp')) < idx(firstOfStage('landing')), 'mvp precedes landing');
  A.ok(idx(firstOfStage('landing')) < idx(firstOfStage('product')), 'landing precedes product');
  A.ok(idx(firstOfStage('product')) < idx(firstOfStage('launch')), 'product precedes launch');
  A.ok(idx(firstOfStage('launch')) < idx(firstOfStage('analytics')), 'launch precedes analytics');

  for (const t of p.tasks) {
    A.ok(!!t.title, 'every task has a title');
    A.ok(T.PRIORITIES.indexOf(t.priority) >= 0, 'priority "' + t.priority + '" is in the closed vocabulary');
    A.eq(t.effort.evidence, 'estimate', 'P1: task "' + t.title + '" labels its effort an ESTIMATE, never a measurement');
    A.ok(typeof t.effort.hours === 'number' && t.effort.hours >= 0, 'effort hours is a non-negative number');
    A.ok(!!T.stageLabel('saas', t.stage), 'task "' + t.title + '" names a real saas stage');
  }

  // an unknown template is refused with the list of known ones — never a substituted default plan.
  const bad = T.templatePlan('nope');
  A.eq(bad.ok, false, 'an unknown template is refused');
  A.ok(/unknown template/.test(bad.reason), 'the refusal says what was wrong');
  A.eq(bad.templates, T.TEMPLATE_IDS, 'the refusal lists the templates it does know');
  A.eq(T.templatePlan(null).ok, false, 'a null template is refused');
  A.eq(T.templatePlan('').ok, false, 'an empty template is refused');
}

/* ---------- §9's worked example is reproduced EXACTLY ---------- */
{
  const g = T.goalPlan('Launch a digital product');
  A.ok(g.ok, 'the §9 example goal is recognised');
  A.eq(g.tasks.length, 10, '§9\'s plan is exactly 10 tasks');
  A.eq(g.tasks.map(t => t.title), [
    'Research market', 'Analyze competitors', 'Define customer', 'Design MVP', 'Build landing page',
    'Build product', 'Test product', 'Create marketing assets', 'Launch', 'Monitor results'
  ], '§9\'s 10 tasks, in the master prompt\'s exact order');
  A.eq(g.source, 'master prompt §9 (worked example)', 'the plan names §9 as its source');
  A.eq(g.template, 'digital-product', 'the plan points at the template it belongs to');
  A.eq(g.matchedBy, ['launch', 'digital', 'product'], 'the plan reports HOW it matched (P7 — no hidden inference)');
  A.ok(g.tasks.every(t => t.effort.evidence === 'estimate'), 'P1: goal-plan efforts are labelled estimates too');

  // matching is case- and punctuation-insensitive, because a user types a goal, not a key.
  A.ok(T.goalPlan('  LAUNCH a Digital-Product! ').ok, 'matching normalises case and punctuation');

  // P7: a partial match is NOT a match — a half-matching plan presented as "your plan" would be a fabrication.
  A.eq(T.goalPlan('launch a podcast').ok, false, 'a goal sharing only one keyword is refused');
  A.eq(T.goalPlan('digital product').ok, false, 'a goal missing a keyword is refused');
}

/* ---------- a goal the planner does not know is REFUSED, with the known list ---------- */
{
  const g = T.goalPlan('build a moon base');
  A.eq(g.ok, false, 'an unknown goal is refused rather than guessed at');
  A.ok(/no plan for that goal/.test(g.reason), 'the refusal explains itself');
  A.eq(g.knownGoals, ['Launch a digital product'], 'the refusal lists the goals it DOES know, so it is actionable');
  A.eq(T.goalPlan('').ok, false, 'an empty goal is refused');
  A.eq(T.goalPlan(null).ok, false, 'a null goal is refused');
  A.eq(T.goalPlan(undefined).ok, false, 'an undefined goal is refused');
  A.eq(T.goalPlan('   ').ok, false, 'a whitespace-only goal is refused');
}

/* ---------- determinism: same input, same output, twice ---------- */
{
  A.eq(JSON.stringify(T.templatePlan('agency')), JSON.stringify(T.templatePlan('agency')),
    'templatePlan is deterministic (no clock, no rng)');
  A.eq(JSON.stringify(T.goalPlan('Launch a digital product')), JSON.stringify(T.goalPlan('Launch a digital product')),
    'goalPlan is deterministic');
  A.eq(JSON.stringify(T.catalog()), JSON.stringify(T.catalog()), 'catalog is deterministic');
}

/* ---------- P1: no plan anywhere carries an UNLABELLED number ---------- */
{
  // Walk every template and assert every effort object has both halves. A bare `hours` with no `evidence`
  // is exactly the shape P1 forbids, and it is the easiest one to introduce by accident later.
  for (const id of T.TEMPLATE_IDS) {
    for (const t of T.templatePlan(id).tasks) {
      A.ok(t.effort && typeof t.effort === 'object', id + '/' + t.title + ' effort is an object');
      A.ok('hours' in t.effort && 'evidence' in t.effort, id + '/' + t.title + ' effort carries BOTH hours and its label');
      A.ok(T.PRIORITIES.indexOf(t.priority) >= 0, id + '/' + t.title + ' priority is legal');
    }
  }
}

A.report('business-templates.test');
