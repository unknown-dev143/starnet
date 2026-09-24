/* sidecar/business-routes.js — the HTTP surface for the Business OS (Phase 1).

   WHY A SEPARATE MODULE. sidecar/index.js is 19,400+ lines and is named in the project's own CODE_MAP as
   "THE hotfile — most merges conflict here". Adding a business feature by inlining more handlers would make
   that worse for every future change. So the handlers live here, take their dependencies by injection, and
   index.js only adds a require + a handful of ROWS to the route table (docs/PHASE0-AUDIT.md §7).

   AUTH: these are /api/* routes, so the existing per-launch token gate (apiauth.js requiresApiToken) covers
   them automatically — nothing here re-implements auth, and nothing here is exempt from it.

   ROUTES (all JSON; the id is the slug from businesses-store):
     GET    /api/businesses              -> { businesses: [...] }               (newest-updated first)
     POST   /api/businesses              -> { ok, business }                    (body: name, template?, …)
     GET    /api/businesses/:id          -> { business, activityCount }
     PATCH  /api/businesses/:id          -> { ok, business }                    (partial update)
     DELETE /api/businesses/:id          -> { ok, removed: id }
     GET    /api/businesses/:id/activity -> { activity: [...] }                 (newest first)

   AUDIT (§20). Every MUTATION writes an activity entry — create, update and delete all leave a row naming
   what changed. That is deliberate: an audit log that only records the operations someone remembered to log
   is not an audit log. A delete records the row BEFORE the entity is removed, so the history outlives the
   business (the row is then an orphan by design — it is a record that the business existed and was deleted).

   LIVE EVENTS. Every mutation also emits on the frozen bus (shared/events.js, ADDITIVE-only block
   'business.*') so the Command Center reacts without polling: business.created / business.updated /
   business.deleted / business.paused, plus business.activity for EVERY audit row (the live activity feed).
   `emit` is injected and optional — absent (unit tests, a headless boot) it is a silent no-op, and an emit
   that throws can never fail a mutation that already committed.

   THE PER-BUSINESS E-STOP (§21). Setting a business's stage to 'paused' IS the stop — there is no second
   door. handlePatch runs the injected `onPause(id)` FIRST and only then commits the stage, because the one
   lie this route must never tell is "paused" while the business's runs are still spending. The reverse
   (runs stopped, stage write failed) is recoverable and is reported honestly with the count.

   PURE-ish: no IO of its own. `readBody` and `respondJson` are injected (the real ones are http-body.js and
   respond.js at the composition root; fakes in tests), so this module is unit-testable without booting the
   server — which index.js cannot do (it self-boots; see apiauth.js). */
'use strict';

const MAX_BODY = 16 * 1024;

// ids are slugs produced by businesses-store.slugFor: lowercase alphanumerics and hyphens.
const RX_ONE = /^\/api\/businesses\/([A-Za-z0-9_-]+)$/;
const RX_ACTIVITY = /^\/api\/businesses\/([A-Za-z0-9_-]+)\/activity$/;

function defaultRespondJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function makeBusinessRoutes(deps) {
  deps = deps || {};
  const businesses = deps.businesses;
  const activity = deps.activity;
  const readBody = deps.readBody;
  const respondJson = typeof deps.respondJson === 'function' ? deps.respondJson : defaultRespondJson;
  // both optional: an absent emit is a no-op, an absent onPause means the pause commits without aborting runs.
  const emit = typeof deps.emit === 'function' ? deps.emit : null;
  const onPause = typeof deps.onPause === 'function' ? deps.onPause : null;
  if (!businesses || !activity) throw new Error('business-routes.js requires { businesses, activity }');
  if (typeof readBody !== 'function') throw new Error('business-routes.js requires { readBody }');

  const json = (res, code, obj) => respondJson(res, code, obj);

  // telemetry must never be able to fail a committed mutation — the bus validates and redacts downstream.
  // The caught error is RETURNED rather than swallowed into an empty catch: the caller ignores it on purpose
  // (the mutation already committed), but a real body keeps this from rotting into a silent catch, which is
  // exactly the shape test/failopen-ratchet.test.js exists to catch.
  function emitSafe(name, payload) {
    if (!emit) return null;
    try { emit(name, payload); return null; } catch (e) { return e; }
  }

  // a mutation's audit row. Best-effort ON PURPOSE: a failed audit write must not undo a committed business
  // (the store already fail-closes the entity write); it is surfaced in the response instead of hidden.
  // A successful row is ALSO the live activity feed — one audit row, one bus event, never two bookkeepings.
  function audit(businessId, event) {
    const r = activity.append(businessId, event);
    if (r && r.ok) {
      const row = r.entry || {};
      emitSafe('business.activity', {
        businessId: businessId,
        action: row.action || '',
        result: row.result || 'ok',
        approval: row.approval || 'not-required',
        detail: row.detail || '',
        actorKind: (row.actor && row.actor.kind) || 'system',
        seq: (typeof row.seq === 'number') ? row.seq : 0
      });
      return null;
    }
    return (r && r.reason) || 'activity could not be recorded';
  }

  async function readJson(req) {
    let raw;
    try { raw = await readBody(req, MAX_BODY); } catch (_) { return { ok: false, code: 413, error: 'body too large' }; }
    try { return { ok: true, body: JSON.parse(raw || '{}') || {} }; }
    catch (_) { return { ok: false, code: 400, error: 'bad json' }; }
  }

  // ---- GET /api/businesses ----
  function handleList(req, res) {
    return json(res, 200, { businesses: businesses.list() });
  }

  // ---- POST /api/businesses ----
  async function handleCreate(req, res) {
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });
    const r = businesses.create(parsed.body);
    if (!r.ok) return json(res, 400, { ok: false, error: r.reason });
    const b = r.business;
    emitSafe('business.created', { businessId: b.id, name: b.name, template: b.template, stage: b.stage, actor: b.createdBy });
    const warn = audit(b.id, {
      action: 'Business created', reason: 'Commander created this business',
      actor: { kind: 'user' }, result: 'ok', approval: 'not-required',
      detail: 'name=' + b.name + ' template=' + b.template
    });
    return json(res, 201, warn ? { ok: true, business: b, warning: warn } : { ok: true, business: b });
  }

  // ---- GET /api/businesses/:id ----
  function handleGet(req, res, match) {
    const id = match && match[1];
    const b = businesses.get(id);
    if (!b) return json(res, 404, { ok: false, error: 'no such business: ' + id });
    return json(res, 200, { business: b, activityCount: activity.count(id) });
  }

  // ---- PATCH /api/businesses/:id ----
  async function handlePatch(req, res, match) {
    const id = match && match[1];
    if (!businesses.has(id)) return json(res, 404, { ok: false, error: 'no such business: ' + id });
    const parsed = await readJson(req);
    if (!parsed.ok) return json(res, parsed.code, { ok: false, error: parsed.error });
    const before = businesses.get(id);

    // The E-STOP transition: this patch is what PAUSES the business. Runs stop first, stage commits second.
    const pausing = parsed.body.stage === 'paused' && before.stage !== 'paused';
    let halted = 0;
    if (pausing && onPause) { try { halted = onPause(id) || 0; } catch (_) { halted = 0; } }

    const r = businesses.update(id, parsed.body);
    if (!r.ok) {
      // honest failure: the runs (if any) are already stopped, and we say so rather than pretending otherwise.
      return json(res, 400, { ok: false, error: r.reason, halted: halted });
    }
    const after = r.business;
    // name the fields that ACTUALLY changed — an audit row that says "updated" is noise.
    const changed = Object.keys(parsed.body).filter(k => k !== 'id' && k !== 'createdAt' && k !== 'createdBy' && before[k] !== after[k]);

    if (pausing) {
      emitSafe('business.paused', { businessId: id, name: after.name, halted: halted, actor: after.createdBy });
    } else {
      emitSafe('business.updated', { businessId: id, name: after.name, stage: after.stage, changed: changed, actor: after.createdBy });
    }
    const warn = audit(id, {
      action: pausing ? 'Business paused' : 'Business updated',
      reason: pausing ? 'Commander paused this business — its runs were stopped' : 'Commander edited this business',
      actor: { kind: 'user' }, result: 'ok', approval: 'not-required',
      detail: pausing
        ? ('stopped ' + halted + ' in-flight run' + (halted === 1 ? '' : 's'))
        : (changed.length ? 'changed: ' + changed.join(', ') : 'no field changed')
    });
    const out = { ok: true, business: after, halted: halted };
    if (warn) out.warning = warn;
    return json(res, 200, out);
  }

  // ---- DELETE /api/businesses/:id ----
  function handleDelete(req, res, match) {
    const id = match && match[1];
    const doomed = businesses.get(id);
    if (!doomed) return json(res, 404, { ok: false, error: 'no such business: ' + id });
    // record BEFORE removing, so the history outlives the entity (the row becomes an intentional orphan).
    audit(id, {
      action: 'Business deleted', reason: 'Commander deleted this business',
      actor: { kind: 'user' }, result: 'ok', approval: 'not-required'
    });
    const r = businesses.remove(id);
    if (!r.ok) return json(res, 500, { ok: false, error: r.reason });
    emitSafe('business.deleted', { businessId: id, name: doomed.name, actor: doomed.createdBy });
    return json(res, 200, { ok: true, removed: id });
  }

  // ---- GET /api/businesses/:id/activity ----
  function handleActivity(req, res, match) {
    const id = match && match[1];
    if (!businesses.has(id)) return json(res, 404, { ok: false, error: 'no such business: ' + id });
    return json(res, 200, { activity: activity.list(id) });
  }

  // one entry per method, dispatching to the handler above. Kept explicit so an added verb is a visible
  // edit rather than a silent fall-through.
  function handleOne(req, res, match) {
    if (req.method === 'GET') return handleGet(req, res, match);
    if (req.method === 'PATCH') return handlePatch(req, res, match);
    if (req.method === 'DELETE') return handleDelete(req, res, match);
    return json(res, 405, { ok: false, error: 'method not allowed' });
  }

  // Route-table rows for index.js. `/activity` is listed FIRST: both patterns are anchored, so the order is
  // not load-bearing today — it is stated anyway so a future loosening of RX_ONE cannot silently shadow it.
  const routes = [
    { m: 'GET', exact: '/api/businesses', h: handleList },
    { m: 'POST', exact: '/api/businesses', h: handleCreate },
    { m: 'GET', rx: RX_ACTIVITY, h: handleActivity },
    { m: ['GET', 'PATCH', 'DELETE'], rx: RX_ONE, h: handleOne }
  ];

  return { routes, handleList, handleCreate, handleGet, handlePatch, handleDelete, handleActivity, handleOne };
}

module.exports = { makeBusinessRoutes, RX_ONE, RX_ACTIVITY, MAX_BODY };
