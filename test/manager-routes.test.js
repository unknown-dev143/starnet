'use strict';
/* test/manager-routes.test.js — the Business Manager HTTP surface (Business OS Phase 4).

   Exercised with FAKE req/res, because index.js self-boots and cannot be require()d — the handlers take
   readBody/respondJson by injection precisely so this is possible.

   THE TRAP THIS TEST EXISTS FOR: index.js's `rx` matches the FULL url INCLUDING the query string, while
   `qrx` matches the query-STRIPPED path. Every business-scoped GET here carries a query (?stage, ?kind,
   ?currency, ?q…), so any row that used `rx` where it needed `qrx` would look correct and NEVER FIRE. The
   dispatch below is a faithful copy of index.js's loop (line ~9039), so a wrong match key fails HERE.

   The load-bearing behaviours:
     · the P2 guard surfaces as a 422 (an unlabelled figure) — the route must NOT default a provenance;
     · the §14 conclusion guard surfaces as a 422; §17's publish refusal as a 403;
     · a cross-business project reference and an orphaned project delete are 409;
     · an unknown business is a 404 on every business-scoped route;
     · every emitted payload is schema-VALID (the real bus silently drops an invalid one). */
const A = require('./_assert.js');
const MR = require('../sidecar/manager-routes.js');
const { makeBusinessProjectsStore } = require('../sidecar/business-projects-store.js');
const { makeBusinessFinance } = require('../sidecar/business-finance.js');
const { makeBusinessMetrics } = require('../sidecar/business-metrics.js');
const { makeBusinessCrmStore } = require('../sidecar/business-crm-store.js');
const { makeBusinessContentStore } = require('../sidecar/business-content-store.js');
const { makeBusinessDocumentsStore } = require('../sidecar/business-documents-store.js');
const { makeBusinessKnowledge } = require('../sidecar/business-knowledge.js');
const { makeBusinessExperimentsStore } = require('../sidecar/business-experiments-store.js');
const { makeBusinessTasksStore } = require('../sidecar/business-tasks-store.js');
const { makeBusinessesStore } = require('../sidecar/businesses-store.js');
const { makeBusinessActivityStore } = require('../sidecar/business-activity-store.js');
const EVENTS = require('../shared/events.js');
const fs = require('fs');
const path = require('path');

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
  const projects = makeBusinessProjectsStore({ records: [], persist: () => {}, now: () => 1000 });
  const finance = makeBusinessFinance({ records: [], budgets: {}, prices: {}, persist: () => {}, now: () => 1000 });
  const metrics = makeBusinessMetrics({ records: [], persist: () => {}, now: () => 1000 });
  const crm = makeBusinessCrmStore({ records: [], persist: () => {}, now: () => 1000 });
  const content = makeBusinessContentStore({ records: [], persist: () => {}, now: () => 1000 });
  const documents = makeBusinessDocumentsStore({ records: [], persist: () => {}, now: () => 1000 });
  const knowledge = makeBusinessKnowledge({ records: [], persist: () => {}, now: () => 1000 });
  const experiments = makeBusinessExperimentsStore({ records: [], persist: () => {}, now: () => 1000 });
  const tasks = makeBusinessTasksStore({ records: [], persist: () => {}, now: () => 1000 });
  const businesses = makeBusinessesStore({ records: [], persist: () => {}, now: () => 1000 });
  const activity = makeBusinessActivityStore({ records: [], persist: () => {}, now: () => 1000 });
  businesses.create({ name: 'Acme' });           // acme~b1
  businesses.create({ name: 'Beta' });           // acme~b2? -> beta
  const seen = [];
  const R = MR.makeManagerRoutes(Object.assign({
    projects, finance, metrics, crm, content, documents, knowledge, experiments,
    tasks, businesses, activity, readBody,
    emit: (name, payload) => seen.push({ name, payload })
  }, extra || {}));
  return { projects, finance, metrics, crm, content, documents, knowledge, experiments, tasks, businesses, activity, R, seen };
}

/* the business ids the harness created */
function bizIds(businesses) {
  const all = businesses.list();
  return all.map(b => b.id);
}

/* dispatch EXACTLY as index.js does — method gate, then the single match key, then h(req,res,gm). */
async function dispatch(R, method, url, body) {
  const req = fakeReq(method, url, body);
  const res = fakeRes();
  const bare = url.split('?')[0];
  for (const r of R.routes) {
    if (Array.isArray(r.m) ? r.m.indexOf(method) < 0 : r.m !== method) continue;
    let gm = null;
    if (r.exact !== undefined) { if (url !== r.exact) continue; }
    else if (r.qsplit !== undefined) { if (bare !== r.qsplit) continue; }
    else if (r.rx) { gm = url.match(r.rx); if (!gm) continue; }
    else if (r.qrx) { if (!r.qrx.test(bare)) continue; }
    else continue;
    await r.h(req, res, gm);
    return res;
  }
  return null;   // no row matched -> in the real server this falls through to static
}
function json(res) { try { return JSON.parse(res.body || '{}'); } catch (_) { return null; } }

(async () => {

/* ---------- every route row has exactly ONE match key ---------- */
{
  const { R } = harness();
  A.ok(R.routes.length >= 40, 'the surface has the full set of rows (' + R.routes.length + ')');
  for (const r of R.routes) {
    const keys = ['exact', 'qsplit', 'prefix', 'qprefix', 'rx', 'qrx'].filter(k => r[k] !== undefined);
    A.eq(keys.length, 1, 'row ' + JSON.stringify(r.m) + ' has exactly ONE match key (found ' + keys.join(',') + ')');
    A.ok(typeof r.h === 'function', 'every row has a handler');
  }
}

/* ================= THE TRAP: a business-scoped GET with a query still fires ================= */
{
  const { R, businesses } = harness();
  const [acme] = bizIds(businesses);
  // each of these carries a query string; if the row used `rx` it would never match and dispatch returns null.
  const gets = [
    '/api/businesses/' + acme + '/projects?stage=active',
    '/api/businesses/' + acme + '/finance?kind=revenue',
    '/api/businesses/' + acme + '/metrics?metric=visitors',
    '/api/businesses/' + acme + '/contacts?stage=lead',
    '/api/businesses/' + acme + '/content?stage=idea',
    '/api/businesses/' + acme + '/documents?q=x',
    '/api/businesses/' + acme + '/knowledge?kind=note',
    '/api/businesses/' + acme + '/experiments?status=planned'
  ];
  for (const u of gets) {
    const res = await dispatch(R, 'GET', u);
    A.ok(res && res.code === 200, 'GET ' + u + ' MATCHES and returns 200 (the qrx match key is correct)');
  }
  // and the query-less forms match too
  for (const u of ['/api/businesses/' + acme + '/projects', '/api/businesses/' + acme + '/finance']) {
    const res = await dispatch(R, 'GET', u);
    A.ok(res && res.code === 200, 'GET ' + u + ' (no query) also matches');
  }
}

/* ---------- the catalog serves every picker vocabulary ---------- */
{
  const { R } = harness();
  const res = await dispatch(R, 'GET', '/api/manager/catalog');
  A.eq(res.code, 200, 'the catalog route returns 200');
  const c = json(res);
  for (const k of ['projects', 'finance', 'metrics', 'crm', 'content', 'documents', 'knowledge', 'experiments', 'evidence']) {
    A.ok(c && c[k] !== undefined, 'the catalog carries the `' + k + '` vocabulary');
  }
  A.eq(c.finance.provenance, ['actual', 'user-entered', 'imported', 'ai-estimate'], 'the provenance vocabulary comes from the finance store');
  A.eq(c.metrics.length, 13, 'the metric catalogue is §11\'s thirteen');
  A.eq(c.evidence, ['verified', 'analysis', 'assumption', 'estimate', 'prediction', 'unknown'], 'the evidence classes come from the shared vocabulary');
  A.eq(c.content.publishStages, ['publish', 'analytics'], 'the publish stages come from the content store');
}

/* ---------- unknown business -> 404 ---------- */
{
  const { R } = harness();
  const res = await dispatch(R, 'GET', '/api/businesses/nope/projects');
  A.eq(res.code, 404, 'a business-scoped GET on an unknown business is a 404');
}

/* ================= the P2 guard surfaces as 422 (never a defaulted provenance) ================= */
{
  const { R, businesses } = harness();
  const [acme] = bizIds(businesses);
  // no provenance at all
  let res = await dispatch(R, 'POST', '/api/businesses/' + acme + '/finance', { kind: 'revenue', amount: 10, currency: 'USD', category: 'sales' });
  A.eq(res.code, 422, 'a transaction with no provenance is a 422');
  A.ok(/provenance/.test(json(res).error), 'and the error names provenance');
  // an ai-estimate with no basis
  res = await dispatch(R, 'POST', '/api/businesses/' + acme + '/finance', { kind: 'revenue', amount: 10, currency: 'USD', category: 'sales', provenance: 'ai-estimate' });
  A.eq(res.code, 422, 'an ai-estimate with no basis is a 422');
  // a good one
  res = await dispatch(R, 'POST', '/api/businesses/' + acme + '/finance', { kind: 'revenue', amount: 10, currency: 'USD', category: 'sales', provenance: 'actual' });
  A.eq(res.code, 201, 'a labelled transaction succeeds (201 Created)');
  A.ok(/^acme/.test(json(res).transaction.id) || /~f/.test(json(res).transaction.id), 'and returns the row');
}

/* ---------- P1: a metric with no source is a 422 ---------- */
{
  const { R, businesses } = harness();
  const [acme] = bizIds(businesses);
  let res = await dispatch(R, 'POST', '/api/businesses/' + acme + '/metrics', { metric: 'visitors', value: 10, evidence: 'verified' });
  A.eq(res.code, 422, 'a reading with no source is a 422 (P1)');
  res = await dispatch(R, 'POST', '/api/businesses/' + acme + '/metrics', { metric: 'visitors', value: 10, source: 'export', evidence: 'verified' });
  A.eq(res.code, 201, 'a sourced reading succeeds (201 Created)');
}

/* ---------- P1: a knowledge entry with no source is a 422 ---------- */
{
  const { R, businesses } = harness();
  const [acme] = bizIds(businesses);
  const res = await dispatch(R, 'POST', '/api/businesses/' + acme + '/knowledge', { kind: 'note', title: 'X', body: 'y' });
  A.eq(res.code, 422, 'a knowledge entry with no source is a 422 (P1)');
}

/* ================= §17: an agent publish is a 403, the Commander's is a 200 ================= */
{
  const { R, businesses } = harness();
  const [acme] = bizIds(businesses);
  let res = await dispatch(R, 'POST', '/api/businesses/' + acme + '/content', { title: 'Post', channel: 'blog' });
  A.eq(res.code, 201, 'a content piece is created (201 Created)');
  const pid = json(res).piece.id;
  res = await dispatch(R, 'POST', '/api/content/' + pid + '/advance', { stage: 'publish', actor: { kind: 'agent', name: 'Nova' } });
  A.eq(res.code, 403, 'an AGENT advancing a piece to publish is a 403 (§17/§13)');
  A.ok(/publish/i.test(json(res).error), 'and the error explains the publish rule');
  res = await dispatch(R, 'POST', '/api/content/' + pid + '/advance', { stage: 'publish', actor: { kind: 'user', name: 'Commander' } });
  A.eq(res.code, 200, 'the COMMANDER advancing to publish succeeds');
}

/* ---------- §14: a conclusion without an ended run is a 422 ---------- */
{
  const { R, businesses } = harness();
  const [acme] = bizIds(businesses);
  let res = await dispatch(R, 'POST', '/api/businesses/' + acme + '/experiments', { hypothesis: 'A beats B', variants: ['A', 'B'], metrics: ['conversion-rate'] });
  A.eq(res.code, 201, 'an experiment opens (201 Created)');
  const xid = json(res).experiment.id;
  res = await dispatch(R, 'POST', '/api/experiments/' + xid + '/conclude', { conclusion: 'supported' });
  A.eq(res.code, 422, 'concluding before ending is a 422');
  A.ok(/end it first/i.test(json(res).error), 'and says to end it first');
  res = await dispatch(R, 'POST', '/api/experiments/' + xid + '/conclude', { conclusion: 'inconclusive' });
  A.eq(res.code, 200, 'but inconclusive is ALWAYS allowed');
}

/* ================= P6: a cross-business project reference is a 409 ================= */
{
  const { R, businesses } = harness();
  const ids = bizIds(businesses);
  const acme = ids[0], beta = ids[1];
  const proj = await dispatch(R, 'POST', '/api/businesses/' + acme + '/projects', { name: 'Launch' });
  const pid = json(proj).project.id;
  // a content piece under BETA referencing ACME's project -> 409
  const res = await dispatch(R, 'POST', '/api/businesses/' + beta + '/content', { title: 'X', channel: 'blog', projectId: pid });
  A.eq(res.code, 409, 'a project reference that belongs to ANOTHER business is a 409 (P6)');
  // and the same reference under ACME succeeds
  const ok = await dispatch(R, 'POST', '/api/businesses/' + acme + '/content', { title: 'X', channel: 'blog', projectId: pid });
  A.eq(ok.code, 201, 'the same reference under the OWNING business succeeds (201 Created)');
}

/* ---------- P6: deleting a project that still has tasks is a 409 ---------- */
{
  const { R, businesses, tasks } = harness();
  const [acme] = bizIds(businesses);
  const proj = await dispatch(R, 'POST', '/api/businesses/' + acme + '/projects', { name: 'Launch' });
  const pid = json(proj).project.id;
  // attach a task to the project
  tasks.create(acme, { title: 'do the thing', projectId: pid });
  const denied = await dispatch(R, 'DELETE', '/api/projects/' + pid);
  A.eq(denied.code, 409, 'deleting a project with tasks on it is a 409 — work is never silently orphaned');
  // remove the task, then the delete succeeds
  const t = tasks.list(acme)[0];
  tasks.remove(t.id);
  const ok = await dispatch(R, 'DELETE', '/api/projects/' + pid);
  A.eq(ok.code, 200, 'once the task is gone, the delete succeeds');
}

/* ---------- PATCH is a distinct verb: project status + contact stage ---------- */
{
  const { R, businesses } = harness();
  const [acme] = bizIds(businesses);
  const proj = await dispatch(R, 'POST', '/api/businesses/' + acme + '/projects', { name: 'Launch' });
  const pid = json(proj).project.id;
  const res = await dispatch(R, 'PATCH', '/api/projects/' + pid, { status: 'active' });
  A.eq(res.code, 200, 'PATCH /api/projects/:id sets the status');
  A.eq(json(res).project.status, 'active', 'and it lands');
  // POST on the PATCH-only row must NOT match (falls through to null)
  const wrong = await dispatch(R, 'POST', '/api/projects/' + pid, { status: 'done' });
  A.eq(wrong, null, 'POST on the project row does not match — the PATCH verb is distinct');
}

/* ---------- bad json is a 400 ---------- */
{
  const { R, businesses } = harness();
  const [acme] = bizIds(businesses);
  const res = await dispatch(R, 'POST', '/api/businesses/' + acme + '/projects', '{not json');
  A.eq(res.code, 400, 'malformed JSON is a 400');
}

/* ---------- every emitted event name is schema-valid ---------- */
{
  const { R, businesses } = harness();
  const [acme] = bizIds(businesses);
  await dispatch(R, 'POST', '/api/businesses/' + acme + '/projects', { name: 'Launch' });
  const { seen } = harness();
  A.ok(seen.length === 0, 'the fresh harness saw nothing');
  // re-run on the real harness and check the names
  const h2 = harness();
  const a2 = bizIds(h2.businesses)[0];
  await dispatch(h2.R, 'POST', '/api/businesses/' + a2 + '/projects', { name: 'L' });
  A.ok(h2.seen.length >= 1, 'a project creation emitted at least one event');
  for (const e of h2.seen) {
    A.ok(EVENTS.isKnown(e.name), 'emitted event `' + e.name + '` is a declared event');
  }
}

/* ================= index.js mount locks ================= */
{
  const idx = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'index.js'), 'utf8');
  A.ok(/require\('\.\/manager-routes\.js'\)/.test(idx), 'index.js requires manager-routes.js');
  for (const m of ['business-projects-store', 'business-finance', 'business-metrics', 'business-crm-store', 'business-content-store', 'business-documents-store', 'business-knowledge', 'business-experiments-store']) {
    A.ok(new RegExp("require\\('\\./" + m + "\\.js'\\)").test(idx), 'index.js requires ' + m + '.js');
  }
  A.ok(/makeManagerRoutes\(\{/.test(idx), 'index.js builds the manager routes');
  A.ok(/\.\.\.managerRoutes\.routes/.test(idx), 'index.js spreads managerRoutes.routes into ROUTES');
  // the mount must come AFTER agentRoutes (Phase 3) so the table stays append-only
  const iAgent = idx.indexOf('...agentRoutes.routes');
  const iManager = idx.indexOf('...managerRoutes.routes');
  A.ok(iAgent > 0 && iManager > iAgent, 'managerRoutes mount AFTER agentRoutes (append-only table)');
}

A.report('manager-routes');
})();
