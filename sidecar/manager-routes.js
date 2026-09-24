/* sidecar/manager-routes.js — the HTTP surface for the BUSINESS MANAGER (Business OS Phase 4).

   Phase 4 is §30's "Business Manager": Finance · Analytics · CRM · Content · Documents · Knowledge base ·
   Experiments (§10, §11, §14, §15, §16, §17), plus the per-business PROJECT layer §9 implies and Phase 3
   deferred.

   WHY A SEPARATE MODULE. Same reason as business-routes.js, maker-routes.js and agent-routes.js:
   sidecar/index.js is the merge-conflict hotfile named in CODE_MAP, so handlers live here and index.js adds
   a require plus ROWS to the route table.

   AUTH: these are /api/* routes, so apiauth.js's per-launch token gate covers them automatically.

   THE GUARDS THIS MODULE EXISTS TO EXPOSE — every one lives in a STORE, not here, so a route can never drift
   from the rule it enforces:
     §10/P2 — a transaction needs a provenance; an ai-estimate needs a basis; an import needs a source.
     §11/P1 — a reading needs a source and an evidence class; a rate must be a fraction.
     §14/P2 — a conclusion needs an ended run, two arms and verdict-grade evidence.
     §15/P1 — a knowledge entry needs a source.
     §16/P6 — an interaction or follow-up on another business's contact is refused.
     §17/§13 — reaching a publish stage needs a HUMAN actor; the store refuses any other.
     P6     — every read and write names its business; a project reference is checked to belong to it.

   WHAT THIS MODULE ADDS ON TOP OF THE STORES (the checks a store structurally cannot make, because it cannot
   see another store):
     · A projectId named by a task, content piece or document must BELONG to the same business (P6).
     · Deleting a project that still has tasks on it is a 409, so work is never silently orphaned.
     · A business that does not exist is a 404 on every business-scoped route.

   ROUTE MATCHING — the two traps, both of which produce a route that looks right and never fires:
     · Every business-scoped GET here carries a query (?stage, ?kind, ?currency, ?q, ?scope…) and index.js's
       `rx` matches the FULL url including the query. All of them therefore use **qrx** (query-stripped).
     · Ids contain '~' (never '#', which the browser strips as a fragment delimiter before the request is
       even sent). The id class below allows '~'.

   PURE-ish: `readBody` / `respondJson` injected, so this is unit-testable without booting the server. */

'use strict';

const MAX_BODY = 64 * 1024;

// '<businessId>~p1' / 'acme~f3' / 'acme~c2~u1' — so '~' must be legal in an id.
const ID = '([A-Za-z0-9_~-]+)';
const BIZ = '([A-Za-z0-9_-]+)';

/* THE MATCH-KEY TRAP, spelled out because it silently 404s every route if you get it wrong.
   index.js's dispatch (see its ~line 9039) does:
       else if (r.rx)  { gm = url.match(r.rx); if (!gm) continue; }   // gm = the MATCH ARRAY, groups included
       else if (r.qrx) { if (!r.qrx.test(bare)) continue; }           // gm stays NULL — no groups captured
   and then calls r.h(req, res, gm). So a `qrx` row gives its handler match === null, and any handler that
   reads `match && match[1]` gets undefined.

   Every business-scoped route here is READ WITH A QUERY (?stage, ?kind, ?currency, ?q…) and its handler needs
   the businessId from the match groups — so it must be `rx` (which populates gm) with a regex that ACCEPTS the
   query. QS is that optional-query tail. Using `qrx` here would match the row and then 404, because the
   handler would have no id to look up. The exported RX_BIZ_* still .test() a bare path unchanged. */
const QS = '(?:\\?[^#]*)?$';

const RX_BIZ_PROJECTS = new RegExp('^/api/businesses/' + BIZ + '/projects' + QS);
const RX_BIZ_FINANCE = new RegExp('^/api/businesses/' + BIZ + '/finance' + QS);
const RX_BIZ_BUDGETS = new RegExp('^/api/businesses/' + BIZ + '/finance/budgets' + QS);
const RX_BIZ_PRICES = new RegExp('^/api/businesses/' + BIZ + '/finance/prices' + QS);
const RX_BIZ_METRICS = new RegExp('^/api/businesses/' + BIZ + '/metrics' + QS);
const RX_BIZ_METRIC_SERIES = new RegExp('^/api/businesses/' + BIZ + '/metrics/series' + QS);
const RX_BIZ_CONTACTS = new RegExp('^/api/businesses/' + BIZ + '/contacts' + QS);
const RX_BIZ_CONTENT = new RegExp('^/api/businesses/' + BIZ + '/content' + QS);
const RX_BIZ_DOCUMENTS = new RegExp('^/api/businesses/' + BIZ + '/documents' + QS);
const RX_BIZ_DOC_SEARCH = new RegExp('^/api/businesses/' + BIZ + '/documents/search' + QS);
const RX_BIZ_KNOWLEDGE = new RegExp('^/api/businesses/' + BIZ + '/knowledge' + QS);
const RX_BIZ_KNOW_RETRIEVE = new RegExp('^/api/businesses/' + BIZ + '/knowledge/retrieve' + QS);
const RX_BIZ_EXPERIMENTS = new RegExp('^/api/businesses/' + BIZ + '/experiments' + QS);

const RX_PROJECT = new RegExp('^/api/projects/' + ID + '$');
const RX_FINANCE_ONE = new RegExp('^/api/finance/' + ID + '$');
const RX_CONTACT = new RegExp('^/api/contacts/' + ID + '$');
const RX_CONTACT_INTERACTIONS = new RegExp('^/api/contacts/' + ID + '/interactions$');
const RX_CONTACT_FOLLOWUPS = new RegExp('^/api/contacts/' + ID + '/followups$');
const RX_FOLLOWUP_DONE = new RegExp('^/api/followups/' + ID + '/done$');
const RX_CONTENT = new RegExp('^/api/content/' + ID + '$');
const RX_CONTENT_ADVANCE = new RegExp('^/api/content/' + ID + '/advance$');
const RX_DOCUMENT = new RegExp('^/api/documents/' + ID + '$');
const RX_KNOWLEDGE_ONE = new RegExp('^/api/knowledge/' + ID + '$');
const RX_EXPERIMENT = new RegExp('^/api/experiments/' + ID + '$');
const RX_EXPERIMENT_START = new RegExp('^/api/experiments/' + ID + '/start$');
const RX_EXPERIMENT_END = new RegExp('^/api/experiments/' + ID + '/end$');
const RX_EXPERIMENT_RESULTS = new RegExp('^/api/experiments/' + ID + '/results$');
const RX_EXPERIMENT_CONCLUDE = new RegExp('^/api/experiments/' + ID + '/conclude$');

function defaultRespondJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function makeManagerRoutes(deps) {
  deps = deps || {};
  const projects = deps.projects;
  const finance = deps.finance;
  const metrics = deps.metrics;
  const crm = deps.crm;
  const content = deps.content;
  const documents = deps.documents;
  const knowledge = deps.knowledge;
  const experiments = deps.experiments;
  const tasks = deps.tasks || null;               // only for the project-delete orphan check
  const businesses = deps.businesses || null;     // when present, a business is checked before every write
  const activity = deps.activity || null;         // optional per-business audit sink
  const readBody = deps.readBody;
  const respondJson = typeof deps.respondJson === 'function' ? deps.respondJson : defaultRespondJson;
  const emit = typeof deps.emit === 'function' ? deps.emit : null;

  if (!projects || !finance || !metrics || !crm || !content || !documents || !knowledge || !experiments) {
    throw new Error('manager-routes.js requires { projects, finance, metrics, crm, content, documents, knowledge, experiments }');
  }
  if (typeof readBody !== 'function') throw new Error('manager-routes.js requires { readBody }');

  // The closed vocabularies, read from the modules that OWN them rather than restated here — so the picker
  // the UI renders can never drift from the value the store accepts.
  const BusinessProjects = require('./business-projects-store.js');
  const BusinessFinance = require('./business-finance.js');
  const BusinessMetrics = require('./business-metrics.js');
  const BusinessCrm = require('./business-crm-store.js');
  const BusinessContent = require('./business-content-store.js');
  const BusinessDocuments = require('./business-documents-store.js');
  const BusinessKnowledge = require('./business-knowledge.js');
  const BusinessExperiments = require('./business-experiments-store.js');
  const EVIDENCE = require('./opportunities-store.js').EVIDENCE;

  const json = (res, code, obj) => respondJson(res, code, obj);
  const q = (req) => new URL(String(req.url), 'http://x').searchParams;
  const s = (v) => (v == null ? '' : String(v));

  // telemetry can never fail a committed mutation; the caught error is RETURNED, never swallowed into an
  // empty catch (failopen-ratchet bans that shape).
  function emitSafe(name, payload) {
    if (!emit) return null;
    try { emit(name, payload); return null; } catch (e) { return e; }
  }
  function audit(businessId, row) {
    if (!activity) return null;
    try { activity.append(businessId, row); return null; } catch (e) { return e; }
  }

  async function readJson(req) {
    let raw;
    try { raw = await readBody(req, MAX_BODY); } catch (_) { return { ok: false, code: 413, error: 'body too large' }; }
    try { return { ok: true, body: JSON.parse(raw || '{}') || {} }; }
    catch (_) { return { ok: false, code: 400, error: 'bad json' }; }
  }

  function businessMissing(id) {
    if (!businesses) return false;
    return !businesses.has(id);
  }

  /* A projectId named by a task / content piece / document must exist AND belong to the same business. The
     store cannot check this (it holds no projects), so the route does — the same split as agent-routes'
     cross-business assignment refusal. Returns null when acceptable, else an error string. */
  function projectRefError(businessId, projectId) {
    const pid = s(projectId).trim();
    if (!pid) return null;
    const p = projects.get(pid);
    if (!p) return 'no such project: ' + pid;
    if (p.businessId !== businessId) {
      return 'project ' + pid + ' belongs to business "' + p.businessId + '", not "' + businessId + '" — cross-business references are refused (P6)';
    }
    return null;
  }

  // ---- catalog ------------------------------------------------------------------------------------
  // Every picker vocabulary, in one response, owned by the store that enforces it.
  function handleCatalog(req, res) {
    return json(res, 200, {
      projects: { statuses: BusinessProjects.STATUSES },
      finance: {
        kinds: BusinessFinance.KINDS,
        provenance: BusinessFinance.PROVENANCE,
        estimateClass: BusinessFinance.ESTIMATE,
        recordedProvenance: BusinessFinance.RECORDED_PROVENANCE,
        revenueCategories: BusinessFinance.REVENUE_CATEGORIES,
        expenseCategories: BusinessFinance.EXPENSE_CATEGORIES
      },
      metrics: BusinessMetrics.METRICS,
      crm: { stages: BusinessCrm.STAGES, interactionKinds: BusinessCrm.INTERACTION_KINDS, quietDays: BusinessCrm.QUIET_DAYS },
      content: { stages: BusinessContent.STAGES, publishStages: BusinessContent.PUBLISH_STAGES, channels: BusinessContent.CHANNELS },
      documents: { types: BusinessDocuments.TYPES, statuses: BusinessDocuments.STATUSES },
      knowledge: { kinds: BusinessKnowledge.KINDS },
      experiments: {
        statuses: BusinessExperiments.STATUSES,
        conclusions: BusinessExperiments.CONCLUSIONS,
        verdictGrade: require('./validation-store.js').VERDICT_GRADE
      },
      evidence: EVIDENCE
    });
  }

  // ---- projects (§9) -------------------------------------------------------------------------------
  function handleListProjects(req, res, match) {
    const biz = match && match[1];
    if (businessMissing(biz)) return json(res, 404, { ok: false, error: 'no such business: ' + biz });
    const list = projects.list(biz);
    return json(res, 200, { projects: list, count: list.length, summary: projects.summary(biz) });
  }

  async function handleCreateProject(req, res, match) {
    const biz = match && match[1];
    if (businessMissing(biz)) return json(res, 404, { ok: false, error: 'no such business: ' + biz });
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });
    const r = projects.create(biz, parsed.body);
    if (!r.ok) return json(res, 400, { ok: false, error: r.reason });
    emitSafe('business.project.created', { businessId: biz, projectId: r.project.id, name: r.project.name });
    audit(biz, { actor: { kind: 'user', id: '', name: '' }, action: 'Created project "' + r.project.name + '"', reason: 'business manager', result: 'ok' });
    return json(res, 201, { ok: true, project: r.project });
  }

  function handleProjectOne(req, res, match) {
    const id = match && match[1];
    const p = projects.get(id);
    if (!p) return json(res, 404, { ok: false, error: 'no such project: ' + id });
    if (req.method === 'GET') {
      return json(res, 200, { project: p, memoryNamespace: projects.memoryNamespace(id) });
    }
    if (req.method === 'DELETE') return handleProjectDelete(req, res, id, p);
    return json(res, 405, { ok: false, error: 'method not allowed' });
  }

  // Refuse to orphan work: a project with tasks still pointing at it is a 409, exactly like an agent with
  // tasks assigned. The check lives HERE because the project store cannot see the task store.
  function handleProjectDelete(req, res, id, p) {
    if (tasks) {
      const attached = tasks.list(p.businessId).filter(t => t.projectId === id);
      if (attached.length) {
        return json(res, 409, {
          ok: false,
          error: 'this project has ' + attached.length + ' task(s) attached — move or clear them before removing it',
          tasks: attached.map(t => t.id)
        });
      }
    }
    const r = projects.remove(id);
    if (!r.ok) return json(res, 500, { ok: false, error: r.reason });
    emitSafe('business.project.removed', { businessId: p.businessId, projectId: id, name: p.name });
    audit(p.businessId, { actor: { kind: 'user', id: '', name: '' }, action: 'Removed project "' + p.name + '"', reason: 'business manager', result: 'ok' });
    return json(res, 200, { ok: true, removed: id });
  }

  async function handleProjectPatch(req, res, match) {
    const id = match && match[1];
    const prev = projects.get(id);
    if (!prev) return json(res, 404, { ok: false, error: 'no such project: ' + id });
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });
    const r = projects.update(id, parsed.body);
    if (!r.ok) return json(res, 400, { ok: false, error: r.reason });
    const changed = [];
    for (const f of ['name', 'goal', 'status', 'ownerAgent']) if (prev[f] !== r.project[f]) changed.push(f);
    if (changed.length) emitSafe('business.project.updated', { businessId: r.project.businessId, projectId: id, status: r.project.status, changed: changed });
    return json(res, 200, { ok: true, project: r.project, changed: changed });
  }

  function handleProjects(req, res, match) {
    if (req.method === 'GET') return handleListProjects(req, res, match);
    if (req.method === 'POST') return handleCreateProject(req, res, match);
    return json(res, 405, { ok: false, error: 'method not allowed' });
  }

  // ---- finance (§10) -------------------------------------------------------------------------------
  function handleFinance(req, res, match) {
    const biz = match && match[1];
    if (businessMissing(biz)) return json(res, 404, { ok: false, error: 'no such business: ' + biz });
    if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'method not allowed' });
    const sp = q(req);
    const currency = s(sp.get('currency')).trim().toUpperCase();
    const opts = {};
    for (const k of ['kind', 'category', 'provenance']) { const v = s(sp.get(k)).trim(); if (v) opts[k] = v; }
    const since = Number(sp.get('since')); if (Number.isFinite(since) && since > 0) opts.since = since;
    const until = Number(sp.get('until')); if (Number.isFinite(until) && until > 0) opts.until = until;
    const limit = Number(sp.get('limit')); if (Number.isFinite(limit) && limit > 0) opts.limit = limit;

    const rows = finance.list(biz, opts);
    return json(res, 200, {
      transactions: limit > 0 ? rows.slice(-limit) : rows,
      totals: finance.totals(biz, currency ? { currency: currency } : {}),
      budgets: finance.budgets(biz),
      budgetStatus: finance.budgetStatus(biz, currency ? { currency: currency } : {}),
      prices: finance.prices(biz),
      currencies: finance.currencies(biz)
    });
  }

  async function handleRecordTransaction(req, res, match) {
    const biz = match && match[1];
    if (businessMissing(biz)) return json(res, 404, { ok: false, error: 'no such business: ' + biz });
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });
    const r = finance.create(biz, parsed.body);
    if (!r.ok) {
      // 422 for a provenance/basis refusal (P2), 400 for a malformed request.
      const isGuard = /provenance|basis|imported/.test(r.reason || '');
      return json(res, isGuard ? 422 : 400, { ok: false, error: r.reason });
    }
    const t = r.transaction;
    emitSafe('business.finance.recorded', { businessId: biz, transactionId: t.id, kind: t.kind, amount: t.amount, currency: t.currency, provenance: t.provenance });
    audit(biz, { actor: { kind: 'user', id: '', name: '' }, action: 'Recorded ' + t.kind + ' ' + t.amount + ' ' + t.currency + ' (' + t.provenance + ')', reason: 'finance centre', result: 'ok' });
    return json(res, 201, { ok: true, transaction: t, totals: finance.totals(biz, { currency: t.currency }) });
  }

  function handleFinanceOne(req, res, match) {
    const id = match && match[1];
    const t = finance.get(id);
    if (!t) return json(res, 404, { ok: false, error: 'no such transaction: ' + id });
    if (req.method === 'DELETE') {
      const r = finance.remove(id);
      if (!r.ok) return json(res, 500, { ok: false, error: r.reason });
      emitSafe('business.finance.removed', { businessId: t.businessId, transactionId: id });
      return json(res, 200, { ok: true, removed: id });
    }
    if (req.method === 'GET') return json(res, 200, { transaction: t });
    return json(res, 405, { ok: false, error: 'method not allowed' });
  }

  async function handleBudgets(req, res, match) {
    const biz = match && match[1];
    if (businessMissing(biz)) return json(res, 404, { ok: false, error: 'no such business: ' + biz });
    if (req.method === 'GET') {
      const currency = s(q(req).get('currency')).trim().toUpperCase();
      return json(res, 200, { budgets: finance.budgets(biz), status: finance.budgetStatus(biz, currency ? { currency: currency } : {}) });
    }
    if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });
    const r = finance.setBudget(biz, parsed.body);
    if (!r.ok) return json(res, 400, { ok: false, error: r.reason });
    return json(res, 200, { ok: true, budget: r.budget, replaced: r.replaced });
  }

  async function handlePrices(req, res, match) {
    const biz = match && match[1];
    if (businessMissing(biz)) return json(res, 404, { ok: false, error: 'no such business: ' + biz });
    if (req.method === 'GET') return json(res, 200, { prices: finance.prices(biz) });
    if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });
    const r = finance.setPrice(biz, parsed.body);
    if (!r.ok) return json(res, 400, { ok: false, error: r.reason });
    return json(res, 200, { ok: true, price: r.price, replaced: r.replaced });
  }

  // ---- metrics (§11) -------------------------------------------------------------------------------
  function handleMetrics(req, res, match) {
    const biz = match && match[1];
    if (businessMissing(biz)) return json(res, 404, { ok: false, error: 'no such business: ' + biz });
    if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'method not allowed' });
    const sp = q(req);
    const metric = s(sp.get('metric')).trim();
    const since = Number(sp.get('since')); const until = Number(sp.get('until'));
    const opts = {};
    if (metric) opts.metric = metric;
    if (Number.isFinite(since) && since > 0) opts.since = since;
    if (Number.isFinite(until) && until > 0) opts.until = until;
    return json(res, 200, {
      readings: metrics.list(biz, opts),
      summary: metrics.summary(biz),
      // the honest-unknown read: null when a metric was never recorded, never a fabricated 0.
      latest: metric ? metrics.latest(biz, metric) : null
    });
  }

  async function handleRecordMetric(req, res, match) {
    const biz = match && match[1];
    if (businessMissing(biz)) return json(res, 404, { ok: false, error: 'no such business: ' + biz });
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });
    const r = metrics.record(biz, parsed.body);
    if (!r.ok) {
      const isGuard = /needs a source|evidence class|FRACTION/.test(r.reason || '');
      return json(res, isGuard ? 422 : 400, { ok: false, error: r.reason });
    }
    const k = r.reading;
    emitSafe('business.metric.recorded', { businessId: biz, readingId: k.id, metric: k.metric, unit: k.unit });
    return json(res, 201, { ok: true, reading: k, summary: metrics.summary(biz) });
  }

  function handleMetricSeries(req, res, match) {
    const biz = match && match[1];
    if (businessMissing(biz)) return json(res, 404, { ok: false, error: 'no such business: ' + biz });
    const sp = q(req);
    const metric = s(sp.get('metric')).trim();
    if (!metric) return json(res, 400, { ok: false, error: 'a metric is required (?metric=…)' });
    const bucketMs = Number(sp.get('bucketMs'));
    return json(res, 200, metrics.series(biz, metric, Number.isFinite(bucketMs) && bucketMs > 0 ? { bucketMs: bucketMs } : {}));
  }

  function handleMetricsFamily(req, res, match) {
    if (req.method === 'GET') return handleMetrics(req, res, match);
    if (req.method === 'POST') return handleRecordMetric(req, res, match);
    return json(res, 405, { ok: false, error: 'method not allowed' });
  }

  // ---- CRM (§16) -----------------------------------------------------------------------------------
  function handleContacts(req, res, match) {
    const biz = match && match[1];
    if (businessMissing(biz)) return json(res, 404, { ok: false, error: 'no such business: ' + biz });
    if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'method not allowed' });
    const sp = q(req);
    const stage = s(sp.get('stage')).trim();
    const search = s(sp.get('q')).trim();
    const nowMs = Number(sp.get('now'));
    const opts = {};
    if (stage) opts.stage = stage;
    if (search) opts.q = search;
    const list = crm.contacts(biz, opts);
    return json(res, 200, {
      contacts: list,
      count: list.length,
      summary: crm.summary(biz),
      openFollowUps: crm.openFollowUps(biz, Number.isFinite(nowMs) && nowMs > 0 ? { dueBefore: nowMs } : {}),
      // §16's "which items need attention" — two named rules over stored facts, never a score. Needs a
      // clock, and this module has none, so the caller supplies `now`; without it the rule set is still
      // returned (so the UI can explain it) but no rows are computed.
      attention: Number.isFinite(nowMs) && nowMs > 0 ? crm.needsAttention(biz, nowMs) : { rules: [], overdue: [], quiet: [] }
    });
  }

  async function handleAddContact(req, res, match) {
    const biz = match && match[1];
    if (businessMissing(biz)) return json(res, 404, { ok: false, error: 'no such business: ' + biz });
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });
    const r = crm.addContact(biz, parsed.body);
    if (!r.ok) return json(res, 400, { ok: false, error: r.reason });
    emitSafe('business.contact.added', { businessId: biz, contactId: r.contact.id, name: r.contact.name, stage: r.contact.stage });
    return json(res, 201, { ok: true, contact: r.contact });
  }

  function handleContactsFamily(req, res, match) {
    if (req.method === 'GET') return handleContacts(req, res, match);
    if (req.method === 'POST') return handleAddContact(req, res, match);
    return json(res, 405, { ok: false, error: 'method not allowed' });
  }

  function handleContactOne(req, res, match) {
    const id = match && match[1];
    const c = crm.contact(id);
    if (!c) return json(res, 404, { ok: false, error: 'no such contact: ' + id });
    if (req.method === 'GET') return json(res, 200, { contact: c });
    if (req.method === 'DELETE') {
      const r = crm.removeContact(id);
      // a contact with an open follow-up is refused (409) — the planned action must not vanish with the record
      if (!r.ok) return json(res, 409, { ok: false, error: r.reason });
      emitSafe('business.contact.removed', { businessId: c.businessId, contactId: id, name: c.name });
      return json(res, 200, { ok: true, removed: id });
    }
    return json(res, 405, { ok: false, error: 'method not allowed' });
  }

  async function handleContactPatch(req, res, match) {
    const id = match && match[1];
    const prev = crm.contact(id);
    if (!prev) return json(res, 404, { ok: false, error: 'no such contact: ' + id });
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });
    const r = crm.updateContact(id, parsed.body);
    if (!r.ok) return json(res, 400, { ok: false, error: r.reason });
    const changed = [];
    for (const f of ['name', 'email', 'org', 'stage']) if (JSON.stringify(prev[f]) !== JSON.stringify(r.contact[f])) changed.push(f);
    if (changed.length) emitSafe('business.contact.updated', { businessId: r.contact.businessId, contactId: id, stage: r.contact.stage, changed: changed });
    return json(res, 200, { ok: true, contact: r.contact, changed: changed });
  }

  async function handleLogInteraction(req, res, match) {
    const id = match && match[1];
    const c = crm.contact(id);
    if (!c) return json(res, 404, { ok: false, error: 'no such contact: ' + id });
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });
    // the business comes from the CONTACT, never from the body — a client cannot nominate someone else's
    // business to write into (P6).
    const r = crm.logInteraction(c.businessId, id, parsed.body);
    if (!r.ok) return json(res, 400, { ok: false, error: r.reason });
    const last = r.contact.interactions[r.contact.interactions.length - 1];
    emitSafe('business.contact.interaction', { businessId: c.businessId, contactId: id, kind: last.kind });
    return json(res, 201, { ok: true, contact: r.contact });
  }

  async function handleAddFollowUp(req, res, match) {
    const id = match && match[1];
    const c = crm.contact(id);
    if (!c) return json(res, 404, { ok: false, error: 'no such contact: ' + id });
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });
    const r = crm.addFollowUp(c.businessId, id, parsed.body);
    if (!r.ok) return json(res, 400, { ok: false, error: r.reason });
    return json(res, 201, { ok: true, contact: r.contact, followUp: r.followUp });
  }

  function handleFollowUpDone(req, res, match) {
    const id = match && match[1];
    const found = (() => {
      // the follow-up id embeds its contact, so resolve the business through it rather than trusting a body.
      for (const b of businesses && businesses.list ? businesses.list() : []) {
        const hit = crm.findFollowUp(b.id, id);
        if (hit) return { businessId: b.id, hit: hit };
      }
      return null;
    })();
    if (!found) return json(res, 404, { ok: false, error: 'no such follow-up: ' + id });
    const r = crm.completeFollowUp(found.businessId, id);
    if (!r.ok) return json(res, 400, { ok: false, error: r.reason });
    return json(res, 200, { ok: true, contact: r.contact });
  }

  // ---- content (§17) -------------------------------------------------------------------------------
  function handleContent(req, res, match) {
    const biz = match && match[1];
    if (businessMissing(biz)) return json(res, 404, { ok: false, error: 'no such business: ' + biz });
    if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'method not allowed' });
    const sp = q(req);
    const stage = s(sp.get('stage')).trim();
    const channel = s(sp.get('channel')).trim();
    const projectId = s(sp.get('project')).trim();
    const opts = {};
    if (stage) opts.stage = stage;
    if (channel) opts.channel = channel;
    if (projectId) opts.projectId = projectId;
    return json(res, 200, { content: content.pieces(biz, opts), summary: content.summary(biz) });
  }

  async function handleAddContent(req, res, match) {
    const biz = match && match[1];
    if (businessMissing(biz)) return json(res, 404, { ok: false, error: 'no such business: ' + biz });
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });
    const refErr = projectRefError(biz, parsed.body.projectId);
    if (refErr) return json(res, 409, { ok: false, error: refErr });
    const r = content.addPiece(biz, parsed.body);
    if (!r.ok) return json(res, 400, { ok: false, error: r.reason });
    emitSafe('business.content.created', { businessId: biz, pieceId: r.piece.id, channel: r.piece.channel });
    return json(res, 201, { ok: true, piece: r.piece });
  }

  function handleContentFamily(req, res, match) {
    if (req.method === 'GET') return handleContent(req, res, match);
    if (req.method === 'POST') return handleAddContent(req, res, match);
    return json(res, 405, { ok: false, error: 'method not allowed' });
  }

  async function handleContentAdvance(req, res, match) {
    const id = match && match[1];
    const prev = content.piece(id);
    if (!prev) return json(res, 404, { ok: false, error: 'no such content piece: ' + id });
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });
    const r = content.advance(id, parsed.body.stage, parsed.body.actor);
    if (!r.ok) {
      // §17's publish refusal is a permission fact, not a malformed request — 403 so the UI can say so.
      const isPublish = /publishing is not automatic/.test(r.reason || '');
      return json(res, isPublish ? 403 : 400, { ok: false, error: r.reason });
    }
    emitSafe('business.content.advanced', { businessId: r.piece.businessId, pieceId: id, from: prev.stage, to: r.piece.stage, by: (parsed.body.actor && parsed.body.actor.kind) || 'system' });
    audit(r.piece.businessId, { actor: { kind: 'user', id: '', name: '' }, action: 'Moved "' + r.piece.title + '" to ' + r.piece.stage, reason: 'content pipeline', result: 'ok' });
    return json(res, 200, { ok: true, piece: r.piece });
  }

  async function handleContentPatch(req, res, match) {
    const id = match && match[1];
    const prev = content.piece(id);
    if (!prev) return json(res, 404, { ok: false, error: 'no such content piece: ' + id });
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });
    const refErr = projectRefError(prev.businessId, parsed.body.projectId);
    if (refErr) return json(res, 409, { ok: false, error: refErr });
    const r = content.update(id, parsed.body);
    if (!r.ok) return json(res, 400, { ok: false, error: r.reason });
    return json(res, 200, { ok: true, piece: r.piece });
  }

  function handleContentOne(req, res, match) {
    const id = match && match[1];
    const p = content.piece(id);
    if (!p) return json(res, 404, { ok: false, error: 'no such content piece: ' + id });
    if (req.method === 'GET') return json(res, 200, { piece: p });
    if (req.method === 'DELETE') {
      const r = content.remove(id);
      if (!r.ok) return json(res, 500, { ok: false, error: r.reason });
      emitSafe('business.content.removed', { businessId: p.businessId, pieceId: id });
      return json(res, 200, { ok: true, removed: id });
    }
    return json(res, 405, { ok: false, error: 'method not allowed' });
  }

  // ---- documents (§15) -----------------------------------------------------------------------------
  function handleDocuments(req, res, match) {
    const biz = match && match[1];
    if (businessMissing(biz)) return json(res, 404, { ok: false, error: 'no such business: ' + biz });
    if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'method not allowed' });
    const sp = q(req);
    const opts = {};
    for (const k of ['type', 'status', 'projectId']) { const v = s(sp.get(k)).trim(); if (v) opts[k] = v; }
    const project = s(sp.get('project')).trim(); if (project) opts.projectId = project;
    return json(res, 200, { documents: documents.documents(biz, opts), summary: documents.summary(biz) });
  }

  async function handleAddDocument(req, res, match) {
    const biz = match && match[1];
    if (businessMissing(biz)) return json(res, 404, { ok: false, error: 'no such business: ' + biz });
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });
    const refErr = projectRefError(biz, parsed.body.projectId);
    if (refErr) return json(res, 409, { ok: false, error: refErr });
    const r = documents.create(biz, parsed.body);
    if (!r.ok) return json(res, 400, { ok: false, error: r.reason });
    emitSafe('business.document.created', { businessId: biz, documentId: r.document.id, type: r.document.type });
    return json(res, 201, { ok: true, document: r.document });
  }

  function handleDocumentsFamily(req, res, match) {
    if (req.method === 'GET') return handleDocuments(req, res, match);
    if (req.method === 'POST') return handleAddDocument(req, res, match);
    return json(res, 405, { ok: false, error: 'method not allowed' });
  }

  function handleDocSearch(req, res, match) {
    const biz = match && match[1];
    if (businessMissing(biz)) return json(res, 404, { ok: false, error: 'no such business: ' + biz });
    const sp = q(req);
    const query = s(sp.get('q')).trim();
    if (!query) return json(res, 400, { ok: false, error: 'a search needs a query (?q=…)' });
    const limit = Number(sp.get('limit'));
    return json(res, 200, { query: query, hits: documents.search(biz, query, Number.isFinite(limit) && limit > 0 ? { limit: limit } : {}) });
  }

  function handleDocumentOne(req, res, match) {
    const id = match && match[1];
    const d = documents.document(id);
    if (!d) return json(res, 404, { ok: false, error: 'no such document: ' + id });
    if (req.method === 'GET') return json(res, 200, { document: d });
    if (req.method === 'DELETE') {
      const r = documents.remove(id);
      if (!r.ok) return json(res, 500, { ok: false, error: r.reason });
      emitSafe('business.document.removed', { businessId: d.businessId, documentId: id });
      return json(res, 200, { ok: true, removed: id });
    }
    return json(res, 405, { ok: false, error: 'method not allowed' });
  }

  async function handleDocumentPatch(req, res, match) {
    const id = match && match[1];
    const prev = documents.document(id);
    if (!prev) return json(res, 404, { ok: false, error: 'no such document: ' + id });
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });
    const refErr = projectRefError(prev.businessId, parsed.body.projectId);
    if (refErr) return json(res, 409, { ok: false, error: refErr });
    const r = documents.update(id, parsed.body);
    if (!r.ok) return json(res, 400, { ok: false, error: r.reason });
    const changed = [];
    for (const f of ['title', 'type', 'status', 'projectId', 'deliverableId']) if (prev[f] !== r.document[f]) changed.push(f);
    if (String(prev.body) !== String(r.document.body)) changed.push('body');
    if (changed.length) emitSafe('business.document.updated', { businessId: r.document.businessId, documentId: id, changed: changed });
    return json(res, 200, { ok: true, document: r.document, changed: changed });
  }

  // ---- knowledge (§15) -----------------------------------------------------------------------------
  function handleKnowledge(req, res, match) {
    const biz = match && match[1];
    if (businessMissing(biz)) return json(res, 404, { ok: false, error: 'no such business: ' + biz });
    if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'method not allowed' });
    const sp = q(req);
    const opts = {};
    const kind = s(sp.get('kind')).trim(); if (kind) opts.kind = kind;
    const tag = s(sp.get('tag')).trim(); if (tag) opts.tag = tag;
    return json(res, 200, { entries: knowledge.entries(biz, opts), summary: knowledge.summary(biz) });
  }

  async function handleAddKnowledge(req, res, match) {
    const biz = match && match[1];
    if (businessMissing(biz)) return json(res, 404, { ok: false, error: 'no such business: ' + biz });
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });
    const r = knowledge.add(biz, parsed.body);
    if (!r.ok) {
      const isGuard = /needs a source/.test(r.reason || '');
      return json(res, isGuard ? 422 : 400, { ok: false, error: r.reason });
    }
    emitSafe('business.knowledge.added', { businessId: biz, entryId: r.entry.id, kind: r.entry.kind });
    return json(res, 201, { ok: true, entry: r.entry });
  }

  function handleKnowledgeFamily(req, res, match) {
    if (req.method === 'GET') return handleKnowledge(req, res, match);
    if (req.method === 'POST') return handleAddKnowledge(req, res, match);
    return json(res, 405, { ok: false, error: 'method not allowed' });
  }

  // §15's "retrieve relevant knowledge before making decisions" — ranked by LITERAL term overlap, and the
  // response says so, so no caller can present it as an AI relevance score.
  function handleKnowledgeRetrieve(req, res, match) {
    const biz = match && match[1];
    if (businessMissing(biz)) return json(res, 404, { ok: false, error: 'no such business: ' + biz });
    const sp = q(req);
    const query = s(sp.get('q')).trim();
    if (!query) return json(res, 400, { ok: false, error: 'retrieval needs a query (?q=…)' });
    const limit = Number(sp.get('limit'));
    const kinds = s(sp.get('kinds')).split(',').map(x => x.trim()).filter(Boolean);
    const opts = { query: query };
    if (Number.isFinite(limit) && limit > 0) opts.limit = limit;
    if (kinds.length) opts.kinds = kinds;
    return json(res, 200, knowledge.retrieve(biz, opts));
  }

  function handleKnowledgeOne(req, res, match) {
    const id = match && match[1];
    const e = knowledge.entry(id);
    if (!e) return json(res, 404, { ok: false, error: 'no such knowledge entry: ' + id });
    if (req.method === 'GET') return json(res, 200, { entry: e });
    if (req.method === 'DELETE') {
      const r = knowledge.forget(id);
      if (!r.ok) return json(res, 500, { ok: false, error: r.reason });
      emitSafe('business.knowledge.forgotten', { businessId: e.businessId, entryId: id });
      return json(res, 200, { ok: true, removed: id });
    }
    return json(res, 405, { ok: false, error: 'method not allowed' });
  }

  async function handleKnowledgePatch(req, res, match) {
    const id = match && match[1];
    const prev = knowledge.entry(id);
    if (!prev) return json(res, 404, { ok: false, error: 'no such knowledge entry: ' + id });
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });
    const r = knowledge.update(id, parsed.body);
    if (!r.ok) return json(res, 400, { ok: false, error: r.reason });
    return json(res, 200, { ok: true, entry: r.entry });
  }

  // ---- experiments (§14) ---------------------------------------------------------------------------
  function handleExperiments(req, res, match) {
    const biz = match && match[1];
    if (businessMissing(biz)) return json(res, 404, { ok: false, error: 'no such business: ' + biz });
    if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'method not allowed' });
    const sp = q(req);
    const opts = {};
    const status = s(sp.get('status')).trim(); if (status) opts.status = status;
    const conclusion = s(sp.get('conclusion')).trim(); if (conclusion) opts.conclusion = conclusion;
    return json(res, 200, { experiments: experiments.experiments(biz, opts), summary: experiments.summary(biz) });
  }

  async function handleOpenExperiment(req, res, match) {
    const biz = match && match[1];
    if (businessMissing(biz)) return json(res, 404, { ok: false, error: 'no such business: ' + biz });
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });
    const r = experiments.open(biz, parsed.body);
    if (!r.ok) return json(res, 400, { ok: false, error: r.reason });
    emitSafe('business.experiment.opened', { businessId: biz, experimentId: r.experiment.id });
    return json(res, 201, { ok: true, experiment: r.experiment });
  }

  function handleExperimentsFamily(req, res, match) {
    if (req.method === 'GET') return handleExperiments(req, res, match);
    if (req.method === 'POST') return handleOpenExperiment(req, res, match);
    return json(res, 405, { ok: false, error: 'method not allowed' });
  }

  function handleExperimentOne(req, res, match) {
    const id = match && match[1];
    const e = experiments.experiment(id);
    if (!e) return json(res, 404, { ok: false, error: 'no such experiment: ' + id });
    if (req.method === 'GET') return json(res, 200, { experiment: e, tally: experiments.tally(id) });
    if (req.method === 'DELETE') {
      const r = experiments.remove(id);
      if (!r.ok) return json(res, 500, { ok: false, error: r.reason });
      return json(res, 200, { ok: true, removed: id });
    }
    return json(res, 405, { ok: false, error: 'method not allowed' });
  }

  function handleExperimentStart(req, res, match) {
    const id = match && match[1];
    if (!experiments.has(id)) return json(res, 404, { ok: false, error: 'no such experiment: ' + id });
    const r = experiments.start(id);
    if (!r.ok) return json(res, 409, { ok: false, error: r.reason });
    return json(res, 200, { ok: true, experiment: r.experiment });
  }

  function handleExperimentEnd(req, res, match) {
    const id = match && match[1];
    if (!experiments.has(id)) return json(res, 404, { ok: false, error: 'no such experiment: ' + id });
    const r = experiments.end(id);
    if (!r.ok) return json(res, 409, { ok: false, error: r.reason });
    emitSafe('business.experiment.ended', { businessId: r.experiment.businessId, experimentId: id });
    return json(res, 200, { ok: true, experiment: r.experiment });
  }

  async function handleExperimentResult(req, res, match) {
    const id = match && match[1];
    if (!experiments.has(id)) return json(res, 404, { ok: false, error: 'no such experiment: ' + id });
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });
    const r = experiments.recordResult(id, parsed.body);
    if (!r.ok) {
      const isGuard = /needs a source|evidence class/.test(r.reason || '');
      return json(res, isGuard ? 422 : 400, { ok: false, error: r.reason });
    }
    return json(res, 201, { ok: true, experiment: r.experiment, tally: experiments.tally(id) });
  }

  async function handleExperimentConclude(req, res, match) {
    const id = match && match[1];
    if (!experiments.has(id)) return json(res, 404, { ok: false, error: 'no such experiment: ' + id });
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });
    const r = experiments.conclude(id, parsed.body);
    if (!r.ok) {
      // §14's P2 refusal: the request is well-formed, the DATA cannot carry the claim. 422.
      const isGuard = /cannot record a/.test(r.reason || '');
      return json(res, isGuard ? 422 : 400, { ok: false, error: r.reason });
    }
    emitSafe('business.experiment.concluded', { businessId: r.experiment.businessId, experimentId: id, conclusion: r.experiment.conclusion });
    audit(r.experiment.businessId, { actor: { kind: 'user', id: '', name: '' }, action: 'Concluded an experiment as ' + r.experiment.conclusion, reason: 'experiment lab', result: 'ok' });
    return json(res, 200, { ok: true, experiment: r.experiment, tally: experiments.tally(id) });
  }

  // Route rows for index.js. Specific paths are listed before the bare :id rows so a future loosening of an
  // anchor cannot silently shadow them. Every business-scoped GET carries a query string, so all of them use
  // qrx (query-stripped) — see the header.
  const routes = [
    { m: 'GET', exact: '/api/manager/catalog', h: handleCatalog },

    { m: ['GET', 'POST'], rx: RX_BIZ_PROJECTS, h: handleProjects },
    { m: 'GET', rx: RX_PROJECT, h: handleProjectOne },
    { m: 'PATCH', rx: RX_PROJECT, h: handleProjectPatch },
    { m: 'DELETE', rx: RX_PROJECT, h: handleProjectOne },

    { m: ['GET', 'POST'], rx: RX_BIZ_FINANCE, h: function (req, res, m) { return req.method === 'GET' ? handleFinance(req, res, m) : handleRecordTransaction(req, res, m); } },
    { m: ['GET', 'POST'], rx: RX_BIZ_BUDGETS, h: handleBudgets },
    { m: ['GET', 'POST'], rx: RX_BIZ_PRICES, h: handlePrices },
    { m: 'GET', rx: RX_FINANCE_ONE, h: handleFinanceOne },
    { m: 'DELETE', rx: RX_FINANCE_ONE, h: handleFinanceOne },

    { m: 'GET', rx: RX_BIZ_METRIC_SERIES, h: handleMetricSeries },
    { m: ['GET', 'POST'], rx: RX_BIZ_METRICS, h: handleMetricsFamily },

    { m: ['GET', 'POST'], rx: RX_BIZ_CONTACTS, h: handleContactsFamily },
    { m: 'POST', rx: RX_CONTACT_INTERACTIONS, h: handleLogInteraction },
    { m: 'POST', rx: RX_CONTACT_FOLLOWUPS, h: handleAddFollowUp },
    { m: 'POST', rx: RX_FOLLOWUP_DONE, h: handleFollowUpDone },
    { m: 'GET', rx: RX_CONTACT, h: handleContactOne },
    { m: 'PATCH', rx: RX_CONTACT, h: handleContactPatch },
    { m: 'DELETE', rx: RX_CONTACT, h: handleContactOne },

    { m: 'POST', rx: RX_CONTENT_ADVANCE, h: handleContentAdvance },
    { m: ['GET', 'POST'], rx: RX_BIZ_CONTENT, h: handleContentFamily },
    { m: 'GET', rx: RX_CONTENT, h: handleContentOne },
    { m: 'PATCH', rx: RX_CONTENT, h: handleContentPatch },
    { m: 'DELETE', rx: RX_CONTENT, h: handleContentOne },

    { m: 'GET', rx: RX_BIZ_DOC_SEARCH, h: handleDocSearch },
    { m: ['GET', 'POST'], rx: RX_BIZ_DOCUMENTS, h: handleDocumentsFamily },
    { m: 'GET', rx: RX_DOCUMENT, h: handleDocumentOne },
    { m: 'PATCH', rx: RX_DOCUMENT, h: handleDocumentPatch },
    { m: 'DELETE', rx: RX_DOCUMENT, h: handleDocumentOne },

    { m: 'GET', rx: RX_BIZ_KNOW_RETRIEVE, h: handleKnowledgeRetrieve },
    { m: ['GET', 'POST'], rx: RX_BIZ_KNOWLEDGE, h: handleKnowledgeFamily },
    { m: 'GET', rx: RX_KNOWLEDGE_ONE, h: handleKnowledgeOne },
    { m: 'PATCH', rx: RX_KNOWLEDGE_ONE, h: handleKnowledgePatch },
    { m: 'DELETE', rx: RX_KNOWLEDGE_ONE, h: handleKnowledgeOne },

    { m: ['GET', 'POST'], rx: RX_BIZ_EXPERIMENTS, h: handleExperimentsFamily },
    { m: 'POST', rx: RX_EXPERIMENT_START, h: handleExperimentStart },
    { m: 'POST', rx: RX_EXPERIMENT_END, h: handleExperimentEnd },
    { m: 'POST', rx: RX_EXPERIMENT_RESULTS, h: handleExperimentResult },
    { m: 'POST', rx: RX_EXPERIMENT_CONCLUDE, h: handleExperimentConclude },
    { m: 'GET', rx: RX_EXPERIMENT, h: handleExperimentOne },
    { m: 'DELETE', rx: RX_EXPERIMENT, h: handleExperimentOne }
  ];

  return {
    routes,
    handleCatalog,
    handleProjects, handleListProjects, handleCreateProject, handleProjectOne, handleProjectPatch, handleProjectDelete,
    handleFinance, handleRecordTransaction, handleFinanceOne, handleBudgets, handlePrices,
    handleMetrics, handleRecordMetric, handleMetricSeries, handleMetricsFamily,
    handleContacts, handleAddContact, handleContactOne, handleContactPatch, handleLogInteraction, handleAddFollowUp, handleFollowUpDone,
    handleContent, handleAddContent, handleContentAdvance, handleContentPatch, handleContentOne,
    handleDocuments, handleAddDocument, handleDocSearch, handleDocumentOne, handleDocumentPatch,
    handleKnowledge, handleAddKnowledge, handleKnowledgeRetrieve, handleKnowledgeOne, handleKnowledgePatch,
    handleExperiments, handleOpenExperiment, handleExperimentOne, handleExperimentStart, handleExperimentEnd, handleExperimentResult, handleExperimentConclude,
    projectRefError
  };
}

module.exports = {
  makeManagerRoutes,
  RX_BIZ_PROJECTS, RX_BIZ_FINANCE, RX_BIZ_BUDGETS, RX_BIZ_PRICES, RX_BIZ_METRICS, RX_BIZ_METRIC_SERIES,
  RX_BIZ_CONTACTS, RX_BIZ_CONTENT, RX_BIZ_DOCUMENTS, RX_BIZ_DOC_SEARCH, RX_BIZ_KNOWLEDGE,
  RX_BIZ_KNOW_RETRIEVE, RX_BIZ_EXPERIMENTS,
  RX_PROJECT, RX_FINANCE_ONE, RX_CONTACT, RX_CONTACT_INTERACTIONS, RX_CONTACT_FOLLOWUPS, RX_FOLLOWUP_DONE,
  RX_CONTENT, RX_CONTENT_ADVANCE, RX_DOCUMENT, RX_KNOWLEDGE_ONE,
  RX_EXPERIMENT, RX_EXPERIMENT_START, RX_EXPERIMENT_END, RX_EXPERIMENT_RESULTS, RX_EXPERIMENT_CONCLUDE,
  MAX_BODY
};
