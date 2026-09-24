/* sidecar/maker-routes.js — the HTTP surface for the BUSINESS MAKER (Business OS Phase 2).

   Phase 2 is the REVERSE FUNNEL: §22 Opportunity Radar finds a claim set, §5 Validation Lab tries to kill
   it, and only then does §6 create a business. These routes are that funnel, and the ORDER is the point —
   /api/opportunities/:id/promote is the last door, not the first.

   WHY A SEPARATE MODULE. Same reason as business-routes.js: sidecar/index.js is the merge-conflict hotfile
   named in CODE_MAP, so handlers live here and index.js only adds a require plus ROWS to the route table.

   AUTH: these are /api/* routes, so apiauth.js's per-launch token gate covers them automatically.

   THE TWO GUARDS THIS MODULE EXISTS TO EXPOSE — both live in the STORES, not here, and that is deliberate:
   a route that re-implemented them could drift from the store that enforces them.
     P1 (§4)  — a claim cannot be written without an evidence label. POST /:id/field passes `evidence`
                straight through; the store REFUSES the write when it is missing or unrecognised.
     P2 (§5)  — a validation run cannot be marked 'supported'/'contradicted' without verified/analysis
                evidence plus a matching signal. The store REFUSES; this route returns its reason verbatim
                with a 422, so the refusal is a message the user can act on rather than a silent no-op.

   ROUTES (all JSON):
     GET    /api/templates                    -> { templates: [...] }
     GET    /api/templates/:id/plan           -> { plan }                     (§25 funnel -> tasks)
     POST   /api/plan                         -> { plan }                     (§9 goal -> tasks, body { goal })
     GET    /api/opportunities                -> { opportunities: [...] }
     POST   /api/opportunities                -> { ok, opportunity }
     GET    /api/opportunities/:id            -> { opportunity, evidenceMix, missing, completeness, validations, validationSummary }
     PATCH  /api/opportunities/:id            -> { ok, opportunity }
     DELETE /api/opportunities/:id            -> { ok, removed }
     POST   /api/opportunities/:id/field      -> { ok, opportunity }          (body { field, text, evidence, source })
     POST   /api/opportunities/:id/promote    -> { ok, business, opportunity, tasksCreated }   THE CREATION WORKFLOW
     GET    /api/opportunities/:id/validations-> { validations, summary }
     POST   /api/opportunities/:id/validations-> { ok, validation }
     PATCH  /api/validations/:id              -> { ok, validation }
     DELETE /api/validations/:id              -> { ok, removed }

   PURE-ish: `readBody` / `respondJson` injected, so this is unit-testable without booting the server.
   `emit`, `businesses`, `tasks` and `activity` are optional injections — absent, promote refuses honestly
   rather than half-creating a business. */
'use strict';

const MAX_BODY = 32 * 1024;

// ids are slugs (opportunities-store.slugFor) — but a validation id is `<opportunityId>~v<n>`, so '~' is
// legal in the id class. '~' and not '#' because a '#' in a URL path is a FRAGMENT delimiter: the browser
// would drop the id and send /api/validations/<slug>, which matches nothing. See validation-store.js.
const RX_OPP = /^\/api\/opportunities\/([A-Za-z0-9_-]+)$/;
const RX_OPP_FIELD = /^\/api\/opportunities\/([A-Za-z0-9_-]+)\/field$/;
const RX_OPP_PROMOTE = /^\/api\/opportunities\/([A-Za-z0-9_-]+)\/promote$/;
const RX_OPP_VALIDATIONS = /^\/api\/opportunities\/([A-Za-z0-9_-]+)\/validations$/;
const RX_VALIDATION = /^\/api\/validations\/([A-Za-z0-9_~-]+)$/;
const RX_TEMPLATE_PLAN = /^\/api\/templates\/([A-Za-z0-9_-]+)\/plan$/;

function defaultRespondJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function makeMakerRoutes(deps) {
  deps = deps || {};
  const opportunities = deps.opportunities;
  const validations = deps.validations;
  const templates = deps.templates;
  const businesses = deps.businesses || null;     // needed only by /promote
  const tasks = deps.tasks || null;               // needed only by /promote when materialising a plan
  const activity = deps.activity || null;         // audits the business that /promote creates
  const readBody = deps.readBody;
  const respondJson = typeof deps.respondJson === 'function' ? deps.respondJson : defaultRespondJson;
  const emit = typeof deps.emit === 'function' ? deps.emit : null;

  if (!opportunities || !validations) throw new Error('maker-routes.js requires { opportunities, validations }');
  if (!templates) throw new Error('maker-routes.js requires { templates } (business-templates.js)');
  if (typeof readBody !== 'function') throw new Error('maker-routes.js requires { readBody }');

  const json = (res, code, obj) => respondJson(res, code, obj);

  // telemetry can never fail a committed mutation; the caught error is RETURNED, never swallowed into an
  // empty catch (failopen-ratchet bans that shape — see business-routes.js for the same note).
  function emitSafe(name, payload) {
    if (!emit) return null;
    try { emit(name, payload); return null; } catch (e) { return e; }
  }

  async function readJson(req) {
    let raw;
    try { raw = await readBody(req, MAX_BODY); } catch (_) { return { ok: false, code: 413, error: 'body too large' }; }
    try { return { ok: true, body: JSON.parse(raw || '{}') || {} }; }
    catch (_) { return { ok: false, code: 400, error: 'bad json' }; }
  }

  // ---- templates (§25 / §9) -----------------------------------------------------------------------
  function handleTemplates(req, res) {
    return json(res, 200, { templates: templates.catalog() });
  }

  function handleTemplatePlan(req, res, match) {
    const plan = templates.templatePlan(match && match[1]);
    if (!plan.ok) return json(res, 404, { ok: false, error: plan.reason, templates: plan.templates });
    return json(res, 200, { plan: plan });
  }

  async function handleGoalPlan(req, res) {
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });
    const plan = templates.goalPlan(parsed.body.goal);
    // a goal this planner does not know is a 422, not a 200 with an invented plan (P7).
    if (!plan.ok) return json(res, 422, { ok: false, error: plan.reason, knownGoals: plan.knownGoals });
    return json(res, 200, { plan: plan });
  }

  // ---- opportunities (§4 / §22) -------------------------------------------------------------------
  function handleList(req, res) {
    return json(res, 200, { opportunities: opportunities.list() });
  }

  async function handleCreate(req, res) {
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });
    const r = opportunities.create(parsed.body);
    if (!r.ok) return json(res, 400, { ok: false, error: r.reason });
    const o = r.opportunity;
    emitSafe('opportunity.created', { opportunityId: o.id, title: o.title, template: o.template, stage: o.stage, origin: o.origin });
    return json(res, 201, { ok: true, opportunity: o });
  }

  function handleGet(req, res, match) {
    const id = match && match[1];
    const o = opportunities.get(id);
    if (!o) return json(res, 404, { ok: false, error: 'no such opportunity: ' + id });
    // The read that makes the reverse funnel legible: what is CLAIMED (mix), what is MISSING, and what has
    // actually been TESTED. All three are counts or lists — never a score (P2/P7).
    return json(res, 200, {
      opportunity: o,
      evidenceMix: opportunities.evidenceMix(id),
      missing: opportunities.missing(id),
      completeness: opportunities.completeness(id),
      validations: validations.list(id),
      validationSummary: validations.summary(id)
    });
  }

  async function handlePatch(req, res, match) {
    const id = match && match[1];
    if (!opportunities.has(id)) return json(res, 404, { ok: false, error: 'no such opportunity: ' + id });
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });
    const before = opportunities.get(id);
    const r = opportunities.update(id, parsed.body);
    if (!r.ok) return json(res, 400, { ok: false, error: r.reason });
    const after = r.opportunity;
    const changed = Object.keys(parsed.body).filter(k => k !== 'id' && before[k] !== after[k]);
    emitSafe('opportunity.updated', { opportunityId: id, title: after.title, stage: after.stage, changed: changed, origin: after.origin });
    return json(res, 200, { ok: true, opportunity: after });
  }

  function handleDelete(req, res, match) {
    const id = match && match[1];
    const doomed = opportunities.get(id);
    if (!doomed) return json(res, 404, { ok: false, error: 'no such opportunity: ' + id });
    const r = opportunities.remove(id);
    if (!r.ok) return json(res, 500, { ok: false, error: r.reason });
    // the opportunity's validation runs are its children; forgetting the parent forgets them, so a later
    // opportunity that reuses the slug cannot inherit a stranger's test results.
    validations.clear(id);
    emitSafe('opportunity.deleted', { opportunityId: id, title: doomed.title });
    return json(res, 200, { ok: true, removed: id });
  }

  /* SET ONE FIELD. The P1 guard lives in the store; this route's whole job is to pass the label through
     untouched and surface the store's refusal as a 422 the user can read. */
  async function handleField(req, res, match) {
    const id = match && match[1];
    if (!opportunities.has(id)) return json(res, 404, { ok: false, error: 'no such opportunity: ' + id });
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });
    const b = parsed.body;
    const r = opportunities.setField(id, b.field, b.text, b.evidence, b.source);
    if (!r.ok) return json(res, 422, { ok: false, error: r.reason });
    const o = r.opportunity;
    emitSafe('opportunity.updated', {
      opportunityId: id, title: o.title, stage: o.stage, changed: [String(b.field || '')], origin: o.origin
    });
    return json(res, 200, { ok: true, opportunity: o, missing: opportunities.missing(id) });
  }

  /* THE CREATION WORKFLOW (§6 -> §9). Turn a validated opportunity into a real business, and — because §6
     says the AI must be able to turn the plan into actual tasks — materialise the template's task plan into
     it. Ordering matters and is deliberate:
       1. create the business  (if this fails, nothing else has happened)
       2. materialise the plan (a failure here is reported as a warning; the business stands, because a
          business without tasks is recoverable and a half-created business is not)
       3. stamp the opportunity as promoted (LAST — so a crash between 1 and 3 leaves an un-promoted
          opportunity rather than a promoted one with no business)
     The response reports the REAL number of tasks created, and a `warning` when the evidence behind the
     opportunity is thin. It does NOT block on thin evidence: the user is the authority (§32), and inventing
     a validation threshold would be exactly the fake intelligence P7 forbids. */
  async function handlePromote(req, res, match) {
    const id = match && match[1];
    if (!businesses) return json(res, 501, { ok: false, error: 'promotion is unavailable: no business store is wired' });
    const o = opportunities.get(id);
    if (!o) return json(res, 404, { ok: false, error: 'no such opportunity: ' + id });
    if (o.businessId) {
      return json(res, 409, { ok: false, error: 'this opportunity was already promoted', businessId: o.businessId });
    }
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });
    const body = parsed.body;

    // map §4's fields onto the business row. Fields with no §4 counterpart (valueProposition) are left
    // EMPTY rather than filled with a plausible-looking sentence — that would be fabrication, not mapping.
    const textOf = (f) => (o.fields[f] && o.fields[f].text) || '';
    const seed = {
      name: String(body.name || o.title),
      template: (businesses.TEMPLATES.indexOf(o.template) >= 0) ? o.template : 'custom',
      stage: 'building',
      description: textOf('proposedSolution'),
      targetCustomer: textOf('targetCustomer'),
      businessModel: textOf('businessModel'),
      pricingModel: textOf('revenueModel'),
      createdBy: o.origin === 'ai' ? 'ai' : 'user'
    };
    const bc = businesses.create(seed);
    if (!bc.ok) return json(res, 400, { ok: false, error: bc.reason });
    const business = bc.business;

    // §6 -> §9: materialise the plan. Opt OUT with { plan: false }.
    let tasksCreated = 0;
    let planWarning = null;
    if (tasks && body.plan !== false) {
      const plan = templates.templatePlan(business.template);
      if (plan.ok && plan.tasks.length) {
        const m = tasks.materialise(business.id, plan.tasks, { projectId: String(body.projectId || '') });
        if (m.ok) {
          tasksCreated = m.tasks.length;
          for (const t of m.tasks) {
            emitSafe('task.created', {
              businessId: business.id, taskId: t.id, title: t.title, status: t.status, priority: t.priority, origin: t.origin
            });
          }
        } else {
          planWarning = 'the business was created, but its task plan could not be: ' + m.reason;
        }
      }
    } else if (tasks && body.plan === false) {
      planWarning = 'plan skipped by request';
    }

    // 3. stamp LAST.
    const p = opportunities.markPromoted(id, business.id);
    if (!p.ok) {
      // the business exists but the link failed. Say so plainly rather than reporting a clean promotion.
      return json(res, 500, { ok: false, error: 'business created but the opportunity link could not be saved: ' + p.reason, business: business, tasksCreated: tasksCreated });
    }

    emitSafe('business.created', { businessId: business.id, name: business.name, template: business.template, stage: business.stage, actor: business.createdBy });
    emitSafe('opportunity.promoted', { opportunityId: id, title: o.title, businessId: business.id, tasksCreated: tasksCreated });

    // best-effort audit: a failed audit row must never undo a committed business (see business-routes.audit).
    // The error is CAPTURED AND REPORTED rather than swallowed — an empty catch here is precisely the shape
    // test/failopen-ratchet.test.js bans, and a silently-lost audit row is worth telling the user about.
    let auditWarning = null;
    if (activity) {
      try {
        const ar = activity.append(business.id, {
          action: 'Business created from opportunity', reason: 'Promoted from the Business Maker',
          actor: { kind: 'user' }, result: 'ok', approval: 'not-required',
          detail: 'opportunity=' + id + ' tasks=' + tasksCreated
        });
        if (!(ar && ar.ok)) auditWarning = 'the business was created but its audit row was not: ' + ((ar && ar.reason) || 'unknown reason');
      } catch (e) {
        auditWarning = 'the business was created but its audit row failed: ' + String((e && e.message) || e);
      }
    }

    // honest, non-blocking advisory: say what evidence exists, do not invent a pass/fail.
    const vsum = validations.summary(id);
    const out = { ok: true, business: business, opportunity: p.opportunity, tasksCreated: tasksCreated, validationSummary: vsum };
    const warns = [];
    if (planWarning) warns.push(planWarning);
    if (auditWarning) warns.push(auditWarning);
    if (warns.length) out.warning = warns.join('; ');
    if (!vsum.supported) {
      out.advisory = 'no validation run is marked "supported" — the business was created anyway, because the user decides; this is a note, not a gate';
    }
    return json(res, 201, out);
  }

  // ---- validation runs (§5) -----------------------------------------------------------------------
  function handleListValidations(req, res, match) {
    const id = match && match[1];
    if (!opportunities.has(id)) return json(res, 404, { ok: false, error: 'no such opportunity: ' + id });
    return json(res, 200, { validations: validations.list(id), summary: validations.summary(id) });
  }

  async function handleCreateValidation(req, res, match) {
    const id = match && match[1];
    if (!opportunities.has(id)) return json(res, 404, { ok: false, error: 'no such opportunity: ' + id });
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });
    const r = validations.create(id, parsed.body);
    // 422 for a P2 refusal, 400 for a malformed request: the difference matters to the client.
    if (!r.ok) {
      const isGuard = /cannot mark a run/.test(r.reason || '');
      return json(res, isGuard ? 422 : 400, { ok: false, error: r.reason });
    }
    const v = r.validation;
    emitSafe('validation.recorded', {
      opportunityId: id, validationId: v.id, method: v.method, verdict: v.verdict,
      evidenceCount: (v.evidence || []).filter(e => e.text).length
    });
    // the opportunity advances to 'validating' the first time a run is opened — a real transition, not a guess.
    const o = opportunities.get(id);
    if (o && o.stage === 'ready') {
      const adv = opportunities.setStage(id, 'validating');
      if (adv.ok) emitSafe('opportunity.updated', { opportunityId: id, title: adv.opportunity.title, stage: 'validating', changed: ['stage'], origin: adv.opportunity.origin });
    }
    return json(res, 201, { ok: true, validation: v });
  }

  async function handleRecordValidation(req, res, match) {
    const id = match && match[1];
    const existing = validations.get(id);
    if (!existing) return json(res, 404, { ok: false, error: 'no such validation run: ' + id });
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });
    const r = validations.record(id, parsed.body);
    if (!r.ok) {
      const isGuard = /cannot mark a run/.test(r.reason || '');
      return json(res, isGuard ? 422 : 400, { ok: false, error: r.reason });
    }
    const v = r.validation;
    emitSafe('validation.recorded', {
      opportunityId: v.opportunityId, validationId: v.id, method: v.method, verdict: v.verdict,
      evidenceCount: (v.evidence || []).filter(e => e.text).length
    });
    return json(res, 200, { ok: true, validation: v });
  }

  function handleDeleteValidation(req, res, match) {
    const id = match && match[1];
    if (!validations.get(id)) return json(res, 404, { ok: false, error: 'no such validation run: ' + id });
    const r = validations.remove(id);
    if (!r.ok) return json(res, 500, { ok: false, error: r.reason });
    return json(res, 200, { ok: true, removed: id });
  }

  // ---- dispatchers --------------------------------------------------------------------------------
  function handleOppOne(req, res, match) {
    if (req.method === 'GET') return handleGet(req, res, match);
    if (req.method === 'PATCH') return handlePatch(req, res, match);
    if (req.method === 'DELETE') return handleDelete(req, res, match);
    return json(res, 405, { ok: false, error: 'method not allowed' });
  }

  // Route rows for index.js. Specific patterns are listed before the generic :id row — every pattern is
  // anchored so the order is not load-bearing today, but stating it keeps a future loosening from silently
  // shadowing /field or /promote behind the plain :id match.
  const routes = [
    { m: 'GET', exact: '/api/templates', h: handleTemplates },
    { m: 'GET', rx: RX_TEMPLATE_PLAN, h: handleTemplatePlan },
    { m: 'POST', exact: '/api/plan', h: handleGoalPlan },
    { m: 'GET', exact: '/api/opportunities', h: handleList },
    { m: 'POST', exact: '/api/opportunities', h: handleCreate },
    { m: 'POST', rx: RX_OPP_FIELD, h: handleField },
    { m: 'POST', rx: RX_OPP_PROMOTE, h: handlePromote },
    { m: ['GET', 'POST'], rx: RX_OPP_VALIDATIONS, h: (req, res, m) => (req.method === 'GET' ? handleListValidations(req, res, m) : handleCreateValidation(req, res, m)) },
    { m: ['PATCH', 'DELETE'], rx: RX_VALIDATION, h: (req, res, m) => (req.method === 'PATCH' ? handleRecordValidation(req, res, m) : handleDeleteValidation(req, res, m)) },
    { m: ['GET', 'PATCH', 'DELETE'], rx: RX_OPP, h: handleOppOne }
  ];

  return {
    routes,
    handleTemplates, handleTemplatePlan, handleGoalPlan,
    handleList, handleCreate, handleGet, handlePatch, handleDelete, handleField, handlePromote,
    handleListValidations, handleCreateValidation, handleRecordValidation, handleDeleteValidation,
    handleOppOne
  };
}

module.exports = {
  makeMakerRoutes,
  RX_OPP, RX_OPP_FIELD, RX_OPP_PROMOTE, RX_OPP_VALIDATIONS, RX_VALIDATION, RX_TEMPLATE_PLAN, MAX_BODY
};
