'use strict';
/* test/maker-routes.test.js — the Business Maker HTTP surface (Phase 2).

   Exercised with FAKE req/res, because index.js self-boots and cannot be require()d — the handlers take
   readBody/respondJson by injection precisely so this is possible.

   The load-bearing behaviours:
     · the P1 guard surfaces as a 422 (a claim needs an evidence label) — the route must NOT default it;
     · the P2 guard surfaces as a 422 (a verdict needs verified/analysis evidence + a matching signal);
     · PROMOTE is the creation workflow and its ORDER is load-bearing: business first, plan second, the
       opportunity stamp LAST — so a crash can never leave a promoted opportunity with no business;
     · a re-promote is a 409 naming the existing business, never a second business;
     · thin evidence produces an ADVISORY, never a block — the user is the authority (§32), and inventing a
       validation threshold would be the fake intelligence P7 forbids;
     · every emitted payload is schema-VALID (the real bus silently drops an invalid one). */
const A = require('./_assert.js');
const { makeMakerRoutes, RX_OPP, RX_OPP_FIELD, RX_OPP_PROMOTE, RX_OPP_VALIDATIONS, RX_VALIDATION, RX_TEMPLATE_PLAN } = require('../sidecar/maker-routes.js');
const { makeOpportunitiesStore } = require('../sidecar/opportunities-store.js');
const { makeValidationStore } = require('../sidecar/validation-store.js');
const { makeBusinessesStore } = require('../sidecar/businesses-store.js');
const { makeBusinessTasksStore } = require('../sidecar/business-tasks-store.js');
const { makeBusinessActivityStore } = require('../sidecar/business-activity-store.js');
const TEMPLATES = require('../sidecar/business-templates.js');
const EVENTS = require('../shared/events.js');

function fakeRes() {
  return {
    code: null, body: null, headers: null,
    writeHead(c, h) { this.code = c; this.headers = h; return this; },
    end(s) { this.body = s; }
  };
}
function fakeReq(method, url, body) {
  return { method, url, _body: body === undefined ? '' : (typeof body === 'string' ? body : JSON.stringify(body)) };
}
async function readBody(req) { return req._body || ''; }

function harness(extra) {
  const opportunities = makeOpportunitiesStore({ records: [], persist: () => {}, now: () => 1000 });
  const validations = makeValidationStore({ records: [], persist: () => {}, now: () => 1000 });
  const businesses = makeBusinessesStore({ records: [], persist: () => {}, now: () => 1000 });
  const tasks = makeBusinessTasksStore({ records: [], persist: () => {}, now: () => 1000 });
  const activity = makeBusinessActivityStore({ records: [], persist: () => {}, now: () => 1000 });
  const seen = [];
  const R = makeMakerRoutes(Object.assign({
    opportunities, validations, templates: TEMPLATES, businesses, tasks, activity, readBody,
    emit: (name, payload) => seen.push({ name, payload })
  }, extra || {}));
  return { opportunities, validations, businesses, tasks, activity, R, seen };
}

const names = (seen) => seen.map(e => e.name);
function last(seen, name) { for (let i = seen.length - 1; i >= 0; i--) if (seen[i].name === name) return seen[i].payload; return null; }

// dispatch exactly as index.js does: method gate, then the single match key, then h(req,res,gm).
async function call(R, method, url, body) {
  const res = fakeRes();
  const hit = R.routes.filter(r => (Array.isArray(r.m) ? r.m.indexOf(method) >= 0 : r.m === method))
    .filter(r => (r.exact !== undefined ? url === r.exact : (r.rx ? !!url.match(r.rx) : false)))[0];
  if (!hit) throw new Error('no route for ' + method + ' ' + url);
  await hit.h(fakeReq(method, url, body), res, hit.rx ? url.match(hit.rx) : null);
  return { code: res.code, json: res.body ? JSON.parse(res.body) : null };
}

(async () => {
  /* ---------- the route rows index.js will mount are well-formed ---------- */
  {
    const { R } = harness();
    A.eq(R.routes.length, 10, 'the module exposes 10 route rows');
    for (const row of R.routes) {
      A.ok(!!row.m && typeof row.h === 'function', 'each row has a method and a handler');
      const matchers = ['exact', 'qsplit', 'prefix', 'qprefix', 'rx', 'qrx'].filter(k => row[k] !== undefined);
      A.eq(matchers.length, 1, 'each row carries exactly ONE match key (' + matchers.join('/') + ')');
    }
    A.ok(RX_OPP.test('/api/opportunities/acme'), 'RX_OPP matches an opportunity id');
    A.ok(!RX_OPP.test('/api/opportunities/acme/field'), 'RX_OPP does NOT swallow the field route');
    A.ok(RX_OPP_FIELD.test('/api/opportunities/acme/field'), 'RX_OPP_FIELD matches the field route');
    A.ok(RX_OPP_PROMOTE.test('/api/opportunities/acme/promote'), 'RX_OPP_PROMOTE matches the promote route');
    A.ok(RX_OPP_VALIDATIONS.test('/api/opportunities/acme/validations'), 'RX_OPP_VALIDATIONS matches');
    A.ok(RX_TEMPLATE_PLAN.test('/api/templates/saas/plan'), 'RX_TEMPLATE_PLAN matches');
    // '~' is the id separator because '#' is a URL FRAGMENT delimiter and would be stripped client-side.
    A.ok(RX_VALIDATION.test('/api/validations/acme~v1'), 'RX_VALIDATION matches a "~" separated run id');
    A.ok(!RX_VALIDATION.test('/api/validations/acme#v1'), 'a "#" id would never arrive — the pattern does not pretend otherwise');
  }

  /* ---------- templates ---------- */
  {
    const { R } = harness();
    const r = await call(R, 'GET', '/api/templates');
    A.eq(r.code, 200, 'GET /api/templates is 200');
    A.eq(r.json.templates.length, 5, 'the catalogue lists five templates');
    const p = await call(R, 'GET', '/api/templates/saas/plan');
    A.eq(p.code, 200, 'GET /api/templates/:id/plan is 200');
    A.ok(p.json.plan.tasks.length > 0, 'the plan has tasks');
    const bad = await call(R, 'GET', '/api/templates/nope/plan');
    A.eq(bad.code, 404, 'an unknown template is 404');
    A.eq(bad.json.templates, TEMPLATES.TEMPLATE_IDS, 'the 404 lists the templates it does know');
  }

  /* ---------- the goal planner refuses an unknown goal (P7) ---------- */
  {
    const { R } = harness();
    const ok = await call(R, 'POST', '/api/plan', { goal: 'Launch a digital product' });
    A.eq(ok.code, 200, 'a known goal plans');
    A.eq(ok.json.plan.tasks.length, 10, '§9\'s example yields its 10 tasks');
    const bad = await call(R, 'POST', '/api/plan', { goal: 'build a moon base' });
    A.eq(bad.code, 422, 'an unknown goal is 422, NOT a 200 with an invented plan');
    A.eq(bad.json.knownGoals, ['Launch a digital product'], 'the refusal lists the known goals');
  }

  /* ---------- opportunity CRUD + the P1 guard ---------- */
  {
    const { R, seen } = harness();
    const c = await call(R, 'POST', '/api/opportunities', { title: 'Neighborhood Notes', template: 'content' });
    A.eq(c.code, 201, 'creating an opportunity is 201');
    A.eq(c.json.opportunity.id, 'neighborhood-notes', 'the id is the deterministic slug');
    A.eq(last(seen, 'opportunity.created').origin, 'user', 'the create names its provenance');
    const oid = c.json.opportunity.id;

    // P1 — a claim with no evidence label is REFUSED, and the route must not default it.
    const noLabel = await call(R, 'POST', '/api/opportunities/' + oid + '/field', { field: 'problem', text: 'People forget' });
    A.eq(noLabel.code, 422, 'P1: a claim with no evidence label is 422');
    A.ok(/evidence label/.test(noLabel.json.error), 'the refusal explains that a label is required');
    A.eq((await call(R, 'GET', '/api/opportunities/' + oid)).json.opportunity.fields.problem.text, '',
      'the refused claim was NOT written');

    // a bogus label is refused too — there is no "closest match" defaulting.
    A.eq((await call(R, 'POST', '/api/opportunities/' + oid + '/field', { field: 'problem', text: 'x', evidence: 'vibes' })).code, 422,
      'P1: an unrecognised evidence class is refused');

    // with a real label it lands.
    const ok = await call(R, 'POST', '/api/opportunities/' + oid + '/field', { field: 'problem', text: 'People forget', evidence: 'assumption', source: 'a hunch' });
    A.eq(ok.code, 200, 'a labelled claim is accepted');
    A.eq(ok.json.opportunity.fields.problem.evidence, 'assumption', 'the label round-trips');
    A.eq(ok.json.opportunity.fields.problem.source, 'a hunch', 'the source round-trips');
    A.eq(ok.json.missing.length, 11, 'the response reports what is still missing');

    A.eq((await call(R, 'POST', '/api/opportunities/' + oid + '/field', { field: 'bogus', text: 'x', evidence: 'verified' })).code, 422,
      'an unknown field name is refused');
    A.eq((await call(R, 'POST', '/api/opportunities/ghost/field', { field: 'problem', text: 'x', evidence: 'verified' })).code, 404,
      'a field write against an unknown opportunity is 404');

    // reads
    const g = await call(R, 'GET', '/api/opportunities/' + oid);
    A.eq(g.code, 200, 'GET one opportunity is 200');
    A.eq(g.json.evidenceMix.assumption, 1, 'the evidence mix counts the one labelled claim');
    A.eq(g.json.evidenceMix.verified, 0, 'the evidence mix counts the classes with nothing in them honestly');
    A.eq(g.json.completeness.filled, 1, 'completeness counts filled fields');
    A.eq(g.json.completeness.ready, false, 'completeness is not "ready" until every §4 field is present');
    A.ok(g.json.validationSummary, 'the read carries the validation summary');
    A.eq((await call(R, 'GET', '/api/opportunities/ghost')).code, 404, 'reading an unknown opportunity is 404');

    // patch
    const p = await call(R, 'PATCH', '/api/opportunities/' + oid, { stage: 'researching' });
    A.eq(p.code, 200, 'patching an opportunity is 200');
    A.eq(last(seen, 'opportunity.updated').changed, ['stage'], 'the update names the fields that actually changed');
    A.eq((await call(R, 'PATCH', '/api/opportunities/' + oid, { stage: 'nope' })).code, 400, 'an unknown stage is 400');
    A.eq((await call(R, 'PATCH', '/api/opportunities/ghost', { stage: 'ready' })).code, 404, 'patching an unknown opportunity is 404');

    // list
    const l = await call(R, 'GET', '/api/opportunities');
    A.eq(l.json.opportunities.length, 1, 'the list shows the one opportunity');
  }

  /* ---------- the P2 verdict guard ---------- */
  {
    const { R } = harness();
    const oid = (await call(R, 'POST', '/api/opportunities', { title: 'Thing' })).json.opportunity.id;

    // an unknown METHOD is refused
    A.eq((await call(R, 'POST', '/api/opportunities/' + oid + '/validations', { method: 'vibes', hypothesis: 'H' })).code, 400,
      'an unknown validation method is 400');
    // a run with no hypothesis is refused — a validation run must ask a question
    A.eq((await call(R, 'POST', '/api/opportunities/' + oid + '/validations', { method: 'survey' })).code, 400,
      'a validation run with no hypothesis is refused');

    // P2 — a verdict backed only by an ASSUMPTION is refused with a 422.
    const assumptionOnly = await call(R, 'POST', '/api/opportunities/' + oid + '/validations', {
      method: 'survey', hypothesis: 'People want this', verdict: 'supported', supporting: ['we think so'],
      evidence: [{ text: 'we assume so', evidence: 'assumption' }]
    });
    A.eq(assumptionOnly.code, 422, 'P2: a verdict on assumption-only evidence is 422');
    A.ok(/VERIFIED or ANALYSIS/.test(assumptionOnly.json.error), 'the refusal names the classes that would be enough');
    A.eq(assumptionOnly.json.validation, undefined, 'nothing was created by the refused verdict');

    // P2 — verified evidence but NO supporting signal is also refused.
    const noSignal = await call(R, 'POST', '/api/opportunities/' + oid + '/validations', {
      method: 'survey', hypothesis: 'H', verdict: 'supported',
      evidence: [{ text: '42/50 said yes', evidence: 'verified' }]
    });
    A.eq(noSignal.code, 422, 'P2: a verdict with no supporting signal is 422');
    A.ok(/supporting signal/.test(noSignal.json.error), 'the refusal names the missing side');

    // a run may be OPENED as pending by anyone — "we do not know yet" is always honest.
    const pending = await call(R, 'POST', '/api/opportunities/' + oid + '/validations', { method: 'survey', hypothesis: 'People want this' });
    A.eq(pending.code, 201, 'a pending run is created');
    A.eq(pending.json.validation.verdict, 'pending', 'it starts pending');
    const vid = pending.json.validation.id;
    A.ok(vid.indexOf('~v') > 0, 'the run id uses the "~" separator so it survives a URL path');

    // recording the result: same guard.
    A.eq((await call(R, 'PATCH', '/api/validations/' + vid, { verdict: 'supported', supporting: ['yes'] })).code, 422,
      'P2: recording a verdict still needs graded evidence');
    const rec = await call(R, 'PATCH', '/api/validations/' + vid, {
      evidence: [{ text: '42/50 said yes', evidence: 'verified' }], supporting: ['majority said yes'], verdict: 'supported'
    });
    A.eq(rec.code, 200, 'with verified evidence and a signal, the verdict is accepted');
    A.eq(rec.json.validation.verdict, 'supported', 'the verdict round-trips');
    A.eq((await call(R, 'PATCH', '/api/validations/ghost~v1', { verdict: 'supported' })).code, 404, 'recording against an unknown run is 404');

    // the summary is a TALLY, and the emitted event carries the real evidence count.
    const lv = await call(R, 'GET', '/api/opportunities/' + oid + '/validations');
    A.eq(lv.code, 200, 'listing runs is 200');
    A.eq(lv.json.summary.total, 1, 'the summary counts the one run');
    A.eq(lv.json.summary.supported, 1, 'the summary counts the supported verdict');
    A.eq((await call(R, 'GET', '/api/opportunities/ghost/validations')).code, 404, 'listing runs for an unknown opportunity is 404');
  }

  /* ---------- THE CREATION WORKFLOW: promote ---------- */
  {
    const { R, businesses, tasks, activity, seen, validations } = harness();
    const c = await call(R, 'POST', '/api/opportunities', { title: 'Neighborhood Notes', template: 'content' });
    const oid = c.json.opportunity.id;
    // fill enough that the mapping has something real to carry
    await call(R, 'POST', '/api/opportunities/' + oid + '/field', { field: 'proposedSolution', text: 'A weekly local digest', evidence: 'analysis' });
    await call(R, 'POST', '/api/opportunities/' + oid + '/field', { field: 'targetCustomer', text: 'Busy neighbors', evidence: 'assumption' });
    await call(R, 'POST', '/api/opportunities/' + oid + '/field', { field: 'businessModel', text: 'Sponsorship', evidence: 'assumption' });
    await call(R, 'POST', '/api/opportunities/' + oid + '/field', { field: 'revenueModel', text: '$50/issue sponsor slot', evidence: 'estimate' });

    const pr = await call(R, 'POST', '/api/opportunities/' + oid + '/promote', {});
    A.eq(pr.code, 201, 'promote is 201');
    A.eq(pr.json.business.id, 'neighborhood-notes', 'the business is created');
    A.eq(pr.json.business.template, 'content', 'the template carries over');
    A.eq(pr.json.business.stage, 'building', 'a promoted business starts in "building"');
    A.eq(pr.json.business.description, 'A weekly local digest', '§4 proposedSolution maps to the business description');
    A.eq(pr.json.business.targetCustomer, 'Busy neighbors', 'targetCustomer maps across');
    A.eq(pr.json.business.businessModel, 'Sponsorship', 'businessModel maps across');
    A.eq(pr.json.business.pricingModel, '$50/issue sponsor slot', '§4 revenueModel maps to the business pricingModel');
    A.eq(pr.json.business.valueProposition, '', 'a field with no §4 counterpart is left EMPTY rather than invented (P2)');
    A.eq(pr.json.business.createdBy, 'user', 'provenance is carried from the opportunity');

    // §6 -> §9: the template plan was materialised into REAL tasks.
    A.ok(pr.json.tasksCreated > 0, 'promote materialised the template plan into tasks');
    A.eq(pr.json.tasksCreated, tasks.count('neighborhood-notes'), 'the reported count matches the store');
    A.ok(tasks.list('neighborhood-notes').every(t => t.origin === 'plan'), 'every generated task is marked origin "plan"');
    A.ok(tasks.list('neighborhood-notes')[1].dependsOn.length === 1, 'the generated plan is a real dependency chain');

    // the opportunity is stamped LAST, and reports where it went.
    A.eq(pr.json.opportunity.stage, 'promoted', 'the opportunity is marked promoted');
    A.eq(pr.json.opportunity.businessId, 'neighborhood-notes', 'the opportunity links to the business it became');

    // thin evidence is an ADVISORY, never a block (§32: the user is the authority).
    A.ok(!!pr.json.advisory, 'with no supported validation the response carries an advisory');
    A.ok(/not a gate/.test(pr.json.advisory), 'the advisory says explicitly that it is not a gate');

    // the business gets an audit row.
    A.ok(activity.count('neighborhood-notes') >= 1, 'promotion writes a per-business audit row');

    // a second promote is a 409 naming the existing business — never a second business.
    const again = await call(R, 'POST', '/api/opportunities/' + oid + '/promote', {});
    A.eq(again.code, 409, 're-promoting is 409');
    A.eq(again.json.businessId, 'neighborhood-notes', 'the 409 names the business it already became');
    A.eq(businesses.count(), 1, 'no second business was created');

    // opt out of the plan
    const o2 = (await call(R, 'POST', '/api/opportunities', { title: 'Solo Idea', template: 'custom' })).json.opportunity.id;
    const noPlan = await call(R, 'POST', '/api/opportunities/' + o2 + '/promote', { plan: false });
    A.eq(noPlan.code, 201, 'promote with plan:false still creates the business');
    A.eq(noPlan.json.tasksCreated, 0, 'no tasks were created');
    A.ok(/skipped by request/.test(noPlan.json.warning), 'the warning says the plan was skipped by request, not that it failed');

    // every payload the promote flow emitted is schema-valid.
    for (const e of seen) {
      const v = EVENTS.validate(e.name, e.payload);
      A.ok(v.ok, 'emitted ' + e.name + ' is schema-valid (' + (v.errors || []).join('; ') + ')');
    }
  }

  /* ---------- promote degrades honestly when a dependency is missing ---------- */
  {
    const opportunities = makeOpportunitiesStore({ records: [], persist: () => {}, now: () => 1000 });
    const validations = makeValidationStore({ records: [], persist: () => {}, now: () => 1000 });
    const R = makeMakerRoutes({ opportunities, validations, templates: TEMPLATES, readBody, emit: () => {} });
    const oid = (await call(R, 'POST', '/api/opportunities', { title: 'Thing' })).json.opportunity.id;
    const r = await call(R, 'POST', '/api/opportunities/' + oid + '/promote', {});
    A.eq(r.code, 501, 'with no business store wired, promote is 501 rather than a half-created business');
  }

  /* ---------- deleting an opportunity forgets its validation runs ---------- */
  {
    const { R, validations } = harness();
    const oid = (await call(R, 'POST', '/api/opportunities', { title: 'Thing' })).json.opportunity.id;
    await call(R, 'POST', '/api/opportunities/' + oid + '/validations', { method: 'survey', hypothesis: 'H' });
    A.eq(validations.count(oid), 1, 'the run exists');
    const d = await call(R, 'DELETE', '/api/opportunities/' + oid);
    A.eq(d.code, 200, 'deleting the opportunity is 200');
    A.eq(validations.count(oid), 0, 'its validation runs went with it — a reused slug cannot inherit a stranger\'s results');
    A.eq((await call(R, 'DELETE', '/api/opportunities/' + oid)).code, 404, 'deleting it again is 404');
  }

  /* ---------- unsupported verbs and bad bodies ---------- */
  {
    const { R } = harness();
    const oid = (await call(R, 'POST', '/api/opportunities', { title: 'Thing' })).json.opportunity.id;
    // The row's `m` array gates the verb before the handler runs, so a 405 is only reachable by calling the
    // dispatcher directly — which is exactly what a loosened method list would produce. Assert it there.
    const res405 = fakeRes();
    R.handleOppOne(fakeReq('PUT', '/api/opportunities/' + oid), res405, ['/api/opportunities/' + oid, oid]);
    A.eq(res405.code, 405, 'an unsupported verb on the item dispatcher is 405');
    A.eq((await call(R, 'POST', '/api/opportunities', 'not json')).code, 400, 'a malformed body is 400');
    A.eq((await call(R, 'POST', '/api/opportunities', {})).code, 400, 'a create with no title is 400');
  }

  A.report('maker-routes.test');
})();
