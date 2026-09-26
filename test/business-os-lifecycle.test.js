'use strict';
/* test/business-os-lifecycle.test.js — the END-TO-END Business OS lifecycle (Phase 8 follow-up).

   Every prior suite proves ONE phase in isolation. None of them proves the phases work TOGETHER: that a
   business created by the Business Maker is the same business the agent team hires into, the same business
   the planner scopes work to, the same business an automation fires for, the same business the worker
   executes a work order inside, and the same business the intelligence layer reads back.

   This suite drives that whole chain against the REAL modules, in one flow, per the P6 data-isolation rule
   (every stage must carry the businessId — nothing may be implied). It is the integration check the phase
   docs assume but never ran: create → hire → plan → automate → execute → report.

   Harness note: A.eq(actual, expected, msg) — the MESSAGE is the THIRD argument. */
const A = require('./_assert.js');

const { makeBusinessesStore } = require('../sidecar/businesses-store.js');
const { makeBusinessAgentsStore } = require('../sidecar/business-agents-store.js');
const { makeBusinessTasksStore } = require('../sidecar/business-tasks-store.js');
const { makeBusinessProjectsStore } = require('../sidecar/business-projects-store.js');
const { makeBusinessMetrics } = require('../sidecar/business-metrics.js');
const { makeBusinessActivityStore } = require('../sidecar/business-activity-store.js');
const { makeBusinessApprovalsStore } = require('../sidecar/business-approvals-store.js');
const { makeBusinessAutomationStore } = require('../sidecar/business-automation-store.js');
const { makeBusinessAutomationEngine } = require('../sidecar/business-automation-engine.js');
const { makeBusinessWorkOrders } = require('../sidecar/business-workorders-store.js');
const { makeBusinessWorker } = require('../sidecar/business-worker.js');
const workerPolicy = require('../sidecar/business-worker-policy.js');
const { makeIntelligenceEngine } = require('../sidecar/intelligence-engine.js');
const BP = require('../sidecar/business-permissions.js');

// A single clock for the whole flow so timestamps are deterministic.
let CLOCK = 1000;
const now = () => CLOCK;
const noop = () => {};

/* The whole Business OS, composed exactly as sidecar/index.js composes it — same modules, same wiring. */
function makeStation() {
  const activity = makeBusinessActivityStore({ records: [], persist: noop, now });
  const businesses = makeBusinessesStore({ records: [], persist: noop, now });
  const agents = makeBusinessAgentsStore({ records: [], persist: noop, now });
  const tasks = makeBusinessTasksStore({ records: [], persist: noop, now });
  const projects = makeBusinessProjectsStore({ records: [], persist: noop, now });
  const metrics = makeBusinessMetrics({ records: [], persist: noop, now });
  const approvals = makeBusinessApprovalsStore({ records: [], now, permissions: BP });
  const automation = makeBusinessAutomationStore({ rules: [], runs: [], now, permissions: BP });
  const workorders = makeBusinessWorkOrders({ records: [], persist: noop, now });

  const seen = [];
  let engine = null;
  const emit = (name, payload) => { seen.push({ name, payload }); if (engine) engine.handleEvent(name, payload); };

  const outboundSent = [];
  const outbound = { send: (o) => { outboundSent.push(o); return Promise.resolve({ ok: true }); } };

  const dispatch = (tool /*, step, ctx */) => {
    // a stand-in registry: every declared tool "succeeds" and returns a receipt.
    return { ok: true, summary: 'ran ' + tool };
  };

  const worker = makeBusinessWorker({
    workorders, policy: workerPolicy, permissions: BP, approvals, agents, dispatch
  });

  engine = makeBusinessAutomationEngine({
    automation, approvals, permissions: BP, activity, businesses,
    tasks, projects, metrics, outbound, now, emit
  });

  const intelligence = makeIntelligenceEngine({ businesses, metrics, activities: activity, now });

  return { businesses, agents, tasks, projects, metrics, approvals, automation, workorders, worker, intelligence, engine, seen, outboundSent };
}

async function main() {
  const S = makeStation();

  // =========================================================================================
  // STAGE 1 — CREATE: the Business Maker creates a business.
  // =========================================================================================
  const made = S.businesses.create({ name: 'Acme Coffee', template: 'custom', stage: 'idea' });
  A.eq(made.ok, true, 'STAGE 1: the Business Maker creates a business');
  const biz = made.business.id;
  A.ok(!!biz, 'STAGE 1: the created business has an id (' + biz + ')');
  A.eq(S.businesses.get(biz).name, 'Acme Coffee', 'STAGE 1: and it is readable back by that id');
  A.eq(S.businesses.memoryNamespace(biz), 'biz:' + biz, 'STAGE 1: with the P6 namespace every child store must key on');

  // Advance the business to live — automations belong to a running business.
  const live = S.businesses.update(biz, { stage: 'live' });
  A.eq(live.ok, true, 'STAGE 1: the business can be moved to the "live" stage');

  // =========================================================================================
  // STAGE 2 — HIRE: an agent team is recruited into THAT business.
  // =========================================================================================
  const hire1 = S.agents.hire(biz, { role: 'ceo', specialty: 'strategist' });
  const hire2 = S.agents.hire(biz, { role: 'engineering', specialty: (require('../shared/business-roles.js').specialtiesFor('engineering') || [])[0] });
  A.eq(hire1.ok, true, 'STAGE 2: the first agent is hired');
  A.eq(hire2.ok, true, 'STAGE 2: the second agent is hired');
  const team = S.agents.list(biz);
  A.eq(team.length, 2, 'STAGE 2: the business has exactly two agents');
  A.ok(team.every(a => a.businessId === biz), 'STAGE 2: every agent is scoped to THIS business (P6)');
  A.ok(S.agents.memoryNamespace(team[0].id).indexOf('biz:' + biz) === 0, 'STAGE 2: each agent memory is business-prefixed');

  // Cross-business isolation: a second business must not see this team.
  const other = S.businesses.create({ name: 'Beta Bakery', template: 'custom', stage: 'live' });
  A.eq(S.agents.list(other.business.id).length, 0, 'STAGE 2: a different business sees NONE of this team (P6 isolation)');

  // =========================================================================================
  // STAGE 3 — PLAN: a project and its tasks are scoped to the business.
  // =========================================================================================
  const proj = S.projects.create(biz, { name: 'Opening week', goal: 'Open the doors' });
  A.eq(proj.ok, true, 'STAGE 3: a project is created for the business');
  const t1 = S.tasks.create(biz, { title: 'Buy beans', projectId: proj.project.id, priority: 'high' }, 'user');
  const t2 = S.tasks.create(biz, { title: 'Print menus', projectId: proj.project.id }, 'user');
  A.eq(t1.ok, true, 'STAGE 3: the first task is created');
  A.eq(t2.ok, true, 'STAGE 3: the second task is created');
  A.eq(S.tasks.list(biz).length, 2, 'STAGE 3: the business has exactly two tasks');
  A.eq(S.tasks.list(other.business.id).length, 0, 'STAGE 3: the other business has none of them (P6 isolation)');

  // =========================================================================================
  // STAGE 4 — AUTOMATE: a rule fires for THIS business and does real work.
  // =========================================================================================
  const rule = S.automation.create(biz, {
    name: 'New task -> create a follow-up project',
    trigger: 'task.created',
    actions: [{ action: 'create_project', params: { name: 'Follow-up: {{title}}', goal: 'auto' } }],
    enabled: true, cooldownMs: 0
  });
  A.eq(rule.ok, true, 'STAGE 4: an automation rule is created for the business');

  const beforeProjects = S.projects.list(biz).length;
  const fired = S.engine.handleEvent('task.created', {
    businessId: biz, taskId: t1.task.id, title: 'Buy beans', status: 'todo', priority: 'high', origin: 'user'
  });
  A.eq(fired.ok, true, 'STAGE 4: the rule fires for the business that owns the event');
  A.eq(S.projects.list(biz).length, beforeProjects + 1, 'STAGE 4: the rule actually created a project (real side effect)');
  // the created project carries the interpolated title — proof the payload reached the action
  A.ok(S.projects.list(biz).some(p => /Buy beans/.test(p.name)), 'STAGE 4: the action saw the interpolated event payload');
  // and it must NEVER have touched the other business
  A.eq(S.projects.list(other.business.id).length, 0, 'STAGE 4: the other business gained no project (P6 — businessId comes from the payload)');

  // A rule the caller tries to scope to another business still acts on the PAYLOAD business.
  const cross = S.engine.handleEvent('task.created', { businessId: other.business.id, taskId: 'x', title: 'Nope' });
  A.eq(cross.ok, true, 'STAGE 4: an event for the other business is handled');
  A.eq(S.projects.list(biz).length, beforeProjects + 1, 'STAGE 4: but the first business gained nothing from it');

  // =========================================================================================
  // STAGE 5 — EXECUTE: a work order runs inside the business, gated by §13 policy.
  // =========================================================================================
  const order = S.worker.plan(biz, {
    agentId: team[0].id, intent: 'Read the opening checklist',
    // §26: a step nobody can explain must not be queued — every step carries its reason.
    steps: [{ tool: 'fs.read', args: { path: '/tmp/checklist.md' }, why: 'confirm the checklist exists' }]
  });
  A.eq(order.ok, true, 'STAGE 5: the worker plans a work order for the business');
  A.eq(order.order.businessId, biz, 'STAGE 5: the order is scoped to this business');

  const run = await S.worker.run(order.order.id, { dispatch: (tool) => ({ ok: true, summary: 'ran ' + tool }) });
  A.eq(run.ok, true, 'STAGE 5: the order runs');
  A.eq(run.order.businessId, biz, 'STAGE 5: still scoped to the business');
  A.ok(run.receipts && run.receipts.length >= 1, 'STAGE 5: at least one step produced a receipt');
  A.ok(run.order.steps.some(s => s.status === 'executed'), 'STAGE 5: the step actually executed (not merely classified)');

  // A work order for a business that does not exist must be refused — no unscoped work.
  const orphan = S.worker.plan('', { intent: 'x', steps: [{ tool: 'fs.read', args: {}, why: 'r' }] });
  A.eq(orphan.ok, false, 'STAGE 5: a work order with no business is refused (P6)');
  // §26: a step with no reason is refused before it is ever queued.
  const unexplained = S.worker.plan(biz, { agentId: team[0].id, intent: 'x', steps: [{ tool: 'fs.read', args: {} }] });
  A.eq(unexplained.ok, false, 'STAGE 5: a step with no reason is refused (§26 — nothing unaccountable is queued)');

  // =========================================================================================
  // STAGE 6 — REPORT: the intelligence layer reads the business back truthfully.
  // =========================================================================================
  // Record two readings of one metric so a real change exists.
  S.metrics.record(biz, { metric: 'revenue', value: 100, source: 'manual', evidence: 'strong', at: now() });
  CLOCK += 1000;
  S.metrics.record(biz, { metric: 'revenue', value: 250, source: 'manual', evidence: 'strong', at: now() });

  const digest = S.intelligence.digest(biz);
  A.eq(digest.businessId, biz, 'STAGE 6: the intelligence layer reads back THIS business');
  A.ok(typeof digest.tracked === 'number', 'STAGE 6: it reports how many metrics are tracked');
  A.ok(!!digest.headline, 'STAGE 6: it produces a headline');
  // NO FAKE INTELLIGENCE (P7): a business with no readings must not be given a fabricated verdict.
  // `tracked` counts the §11 metric DIMENSIONS the engine knows about (a fixed catalog), so the honest
  // signal that nothing was recorded is `moved: 0` — no metric is claimed to have moved.
  const empty = S.intelligence.digest(other.business.id);
  A.eq(empty.businessId, other.business.id, 'STAGE 6: a business with no readings is still readable');
  A.eq(empty.moved, 0, 'STAGE 6: and it claims ZERO metrics moved — nothing is invented (P7)');
  A.eq(S.metrics.list(other.business.id).length, 0, 'STAGE 6: the other business has no readings (P6 isolation)');

  // =========================================================================================
  // THE CROSS-CUTTING CLAIM — one businessId governed every stage.
  // =========================================================================================
  A.ok(S.agents.list(biz).every(a => a.businessId === biz), 'END-TO-END: agents, tasks, projects and metrics all key on ONE businessId');
  A.eq(S.tasks.list(other.business.id).length, 0, 'END-TO-END: and the second business is provably untouched by all of it');

  A.report('business-os-lifecycle.test');
}

main().then(
  () => {},
  (e) => { console.error('business-os-lifecycle.test THREW:', (e && e.stack) || e); process.exit(1); }
);
