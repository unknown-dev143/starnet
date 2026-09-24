'use strict';
/* test/business-routes.test.js — the Business OS HTTP surface (Phase 1).
   Exercised with FAKE req/res, because index.js self-boots and cannot be require()d (see apiauth.js) —
   the handlers take readBody/respondJson by injection precisely so this is possible.
   The load-bearing behaviours: every mutation leaves an AUDIT row naming what changed; a delete records
   the row BEFORE the entity goes; one business's activity is never visible from another's route; every
   mutation emits its frozen bus event; and setting stage 'paused' IS the per-business E-STOP (runs stop
   BEFORE the stage commits, and an aborted halt is reported honestly rather than as a clean pause). */
const A = require('./_assert.js');
const { makeBusinessRoutes, RX_ONE, RX_ACTIVITY } = require('../sidecar/business-routes.js');
const { makeBusinessesStore } = require('../sidecar/businesses-store.js');
const { makeBusinessActivityStore } = require('../sidecar/business-activity-store.js');
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
  const bizRecords = []; const actRecords = [];
  const businesses = makeBusinessesStore({ records: bizRecords, persist: () => {}, now: () => 1000 });
  const activity = makeBusinessActivityStore({ records: actRecords, persist: () => {}, now: () => 1000 });
  const seen = [];
  const R = makeBusinessRoutes(Object.assign({
    businesses, activity, readBody,
    emit: (name, payload) => seen.push({ name, payload })
  }, extra || {}));
  return { businesses, activity, R, seen };
}
// every emitted payload must be a VALID payload for its name — the bus would silently drop it otherwise.
function names(seen) { return seen.map(e => e.name); }
function last(seen, name) { for (let i = seen.length - 1; i >= 0; i--) if (seen[i].name === name) return seen[i].payload; return null; }
async function call(R, method, url, body) {
  const res = fakeRes();
  const rx = RX_ACTIVITY.test(url) ? RX_ACTIVITY : RX_ONE;
  const match = url.match(rx);
  const h = match ? (RX_ACTIVITY.test(url) ? R.handleActivity : R.handleOne)
    : (url === '/api/businesses' ? (method === 'GET' ? R.handleList : R.handleCreate) : null);
  if (!h) throw new Error('no handler for ' + method + ' ' + url);
  await h(fakeReq(method, url, body), res, match);
  return { code: res.code, json: res.body ? JSON.parse(res.body) : null };
}

(async () => {
  // --- empty list ---
  {
    const { R } = harness();
    const r = await call(R, 'GET', '/api/businesses');
    A.eq(r.code, 200, 'GET /api/businesses is 200');
    A.eq(r.json.businesses, [], 'a fresh station lists no businesses');
  }

  // --- create: 201 + an audit row naming the action ---
  {
    const { R, activity } = harness();
    const r = await call(R, 'POST', '/api/businesses', { name: 'Neighborhood Notes', template: 'content' });
    A.eq(r.code, 201, 'POST create is 201');
    A.eq(r.json.business.id, 'neighborhood-notes', 'the created business comes back with its slug id');
    const log = activity.list('neighborhood-notes');
    A.eq(log.length, 1, 'creating a business writes exactly one activity row');
    A.eq(log[0].action, 'Business created', 'the row names the action');
    A.eq(log[0].actor.kind, 'user', 'the row attributes it to the user, not an agent');
    A.eq(log[0].approval, 'not-required', 'creating a business needs no approval');
  }

  // --- create without a name: 400, and NO audit row for a business that never existed ---
  {
    const { R, activity } = harness();
    const r = await call(R, 'POST', '/api/businesses', {});
    A.eq(r.code, 400, 'a nameless create is 400');
    A.ok(!!r.json.error, 'the refusal carries a reason');
    A.eq(activity.recent(), [], 'a refused create records no activity');
  }

  // --- bad json: 400, not a crash ---
  {
    const { R } = harness();
    const r = await call(R, 'POST', '/api/businesses', '{not json');
    A.eq(r.code, 400, 'malformed json is 400');
  }

  // --- get one: business + activityCount; unknown is 404 ---
  {
    const { R } = harness();
    await call(R, 'POST', '/api/businesses', { name: 'Acme' });
    const got = await call(R, 'GET', '/api/businesses/acme');
    A.eq(got.code, 200, 'GET one is 200');
    A.eq(got.json.business.name, 'Acme', 'it returns the business');
    A.eq(got.json.activityCount, 1, 'it reports the activity count');
    const miss = await call(R, 'GET', '/api/businesses/ghost');
    A.eq(miss.code, 404, 'an unknown id is 404');
  }

  // --- patch: 200 + an audit row naming the CHANGED FIELDS (not just "updated") ---
  {
    const { R, activity } = harness();
    await call(R, 'POST', '/api/businesses', { name: 'Acme' });
    const r = await call(R, 'PATCH', '/api/businesses/acme', { stage: 'validating', description: 'x' });
    A.eq(r.code, 200, 'PATCH is 200');
    A.eq(r.json.business.stage, 'validating', 'the patch applied');
    const log = activity.list('acme');
    A.eq(log.length, 2, 'the patch added one row');
    A.ok(/changed: .*stage/.test(log[0].detail), 'the row names the field that changed — got: ' + log[0].detail);
    A.ok(/changed: .*description/.test(log[0].detail), 'the row names every changed field');
  }

  // --- patch that changes nothing says so, rather than claiming an update ---
  {
    const { R, activity } = harness();
    await call(R, 'POST', '/api/businesses', { name: 'Acme' });
    await call(R, 'PATCH', '/api/businesses/acme', { stage: 'idea' });   // already 'idea'
    A.ok(/no field changed/.test(activity.list('acme')[0].detail), 'a no-op patch is recorded honestly');
  }

  // --- patch: unknown id 404, invalid enum 400 ---
  {
    const { R } = harness();
    await call(R, 'POST', '/api/businesses', { name: 'Acme' });
    A.eq((await call(R, 'PATCH', '/api/businesses/ghost', { stage: 'live' })).code, 404, 'patching an unknown business is 404');
    A.eq((await call(R, 'PATCH', '/api/businesses/acme', { stage: 'moonshot' })).code, 400, 'an unknown stage is 400');
  }

  // --- delete: records the row BEFORE removing the entity (history outlives the business) ---
  {
    const { R, activity, businesses } = harness();
    await call(R, 'POST', '/api/businesses', { name: 'Temporary' });
    const r = await call(R, 'DELETE', '/api/businesses/temporary');
    A.eq(r.code, 200, 'DELETE is 200');
    A.eq(r.json.removed, 'temporary', 'it names what was removed');
    A.ok(businesses.has('temporary') === false, 'the entity is gone');
    const log = activity.list('temporary');
    A.eq(log.length, 2, 'the delete row survives the entity');
    A.eq(log[0].action, 'Business deleted', 'the surviving row says what happened');
    A.eq((await call(R, 'DELETE', '/api/businesses/temporary')).code, 404, 'deleting again is 404');
  }

  // --- activity route ---
  {
    const { R } = harness();
    await call(R, 'POST', '/api/businesses', { name: 'Acme' });
    const r = await call(R, 'GET', '/api/businesses/acme/activity');
    A.eq(r.code, 200, 'GET activity is 200');
    A.eq(r.json.activity.length, 1, 'it returns the log');
    A.eq((await call(R, 'GET', '/api/businesses/ghost/activity')).code, 404, 'activity for an unknown business is 404');
  }

  // --- ISOLATION: one business's route never exposes another's log ---
  {
    const { R } = harness();
    await call(R, 'POST', '/api/businesses', { name: 'Acme' });
    await call(R, 'POST', '/api/businesses', { name: 'Globex' });
    await call(R, 'PATCH', '/api/businesses/acme', { stage: 'live' });
    const acme = await call(R, 'GET', '/api/businesses/acme/activity');
    const globex = await call(R, 'GET', '/api/businesses/globex/activity');
    A.eq(acme.json.activity.length, 2, 'acme sees its own two rows');
    A.eq(globex.json.activity.length, 1, 'globex sees only its own row');
    A.ok(globex.json.activity.every(e => e.businessId === 'globex'), 'no acme row leaks into globex');
  }

  // --- method not allowed is explicit ---
  {
    const { R } = harness();
    await call(R, 'POST', '/api/businesses', { name: 'Acme' });
    const res = fakeRes();
    R.handleOne(fakeReq('PUT', '/api/businesses/acme'), res, '/api/businesses/acme'.match(RX_ONE));
    A.eq(res.code, 405, 'an unsupported verb on the item route is 405');
  }

  // --- the route rows index.js will mount are well-formed ---
  {
    const { R } = harness();
    A.eq(R.routes.length, 4, 'the module exposes 4 route rows');
    for (const row of R.routes) {
      A.ok(!!row.m && typeof row.h === 'function', 'each row has a method and a handler');
      const matchers = ['exact', 'qsplit', 'prefix', 'qprefix', 'rx', 'qrx'].filter(k => row[k] !== undefined);
      A.eq(matchers.length, 1, 'each row carries exactly ONE match key (' + matchers.join('/') + ')');
    }
    A.ok(RX_ONE.test('/api/businesses/acme'), 'RX_ONE matches a business id');
    A.ok(!RX_ONE.test('/api/businesses/acme/activity'), 'RX_ONE does NOT swallow the activity route');
    A.ok(RX_ACTIVITY.test('/api/businesses/acme/activity'), 'RX_ACTIVITY matches the activity route');
  }

  /* ---------- LIVE EVENTS: every mutation emits its frozen bus event ---------- */
  // The contract this locks: the Command Center must be able to react WITHOUT polling, and every payload it
  // receives must be schema-VALID — the real bus (shared/emitter.js) silently drops an invalid payload, so a
  // typo'd field would make the UI look merely "quiet" instead of loudly broken.
  {
    const { R, seen } = harness();
    await call(R, 'POST', '/api/businesses', { name: 'Acme', template: 'saas' });
    A.eq(names(seen), ['business.created', 'business.activity'],
      'a create emits business.created, then the audit row as business.activity');
    const created = last(seen, 'business.created');
    A.eq(created.businessId, 'acme', 'business.created names the id');
    A.eq(created.name, 'Acme', 'business.created names the business');
    A.eq(created.template, 'saas', 'business.created carries the template');
    A.eq(created.actor, 'user', 'business.created attributes it to the user');

    await call(R, 'PATCH', '/api/businesses/acme', { description: 'x' });
    const updated = last(seen, 'business.updated');
    A.ok(!!updated, 'a patch emits business.updated');
    A.eq(updated.changed, ['description'], 'business.updated names the fields that actually changed');
    A.eq(updated.stage, 'idea', 'business.updated carries the (unchanged) stage honestly');

    await call(R, 'DELETE', '/api/businesses/acme');
    A.eq(names(seen).filter(n => n === 'business.deleted').length, 1, 'a delete emits business.deleted exactly once');
    A.eq(last(seen, 'business.deleted').name, 'Acme', 'business.deleted carries the name AFTER the entity is gone');

    // EVERY emitted payload is valid against the frozen contract — no silent drops on the real bus.
    for (const e of seen) {
      const v = EVENTS.validate(e.name, e.payload);
      A.ok(v.ok, 'emitted ' + e.name + ' is schema-valid (' + (v.errors || []).join('; ') + ')');
    }
    // …and the names are ADDITIVE: every one of them is a real, known event.
    for (const n of names(seen)) A.ok(EVENTS.isKnown(n), n + ' is a declared event name');
  }

  // --- a refused mutation emits NOTHING (no phantom created/updated on the bus) ---
  {
    const { R, seen } = harness();
    await call(R, 'POST', '/api/businesses', {});
    A.eq(seen, [], 'a refused create emits nothing — the bus never hears about a business that does not exist');
    await call(R, 'POST', '/api/businesses', { name: 'Acme' });
    seen.length = 0;
    await call(R, 'PATCH', '/api/businesses/acme', { stage: 'moonshot' });
    A.eq(seen, [], 'a rejected patch emits nothing');
    await call(R, 'PATCH', '/api/businesses/ghost', { stage: 'live' });
    A.eq(seen, [], 'a 404 patch emits nothing');
  }

  // --- an emit that THROWS must never fail an already-committed mutation ---
  {
    const { R, businesses, activity } = harness({ emit: () => { throw new Error('bus down'); } });
    const r = await call(R, 'POST', '/api/businesses', { name: 'Acme' });
    A.eq(r.code, 201, 'a throwing bus still returns 201 — telemetry cannot veto a committed write');
    A.ok(businesses.has('acme'), 'the business really was committed');
    A.eq(activity.list('acme').length, 1, 'the audit row really was written');
  }

  /* ---------- THE PER-BUSINESS E-STOP (§21) ---------- */
  // Setting stage 'paused' IS the stop. Two things are locked here that a UI test could never prove:
  // (1) the halt runs BEFORE the stage commits, and (2) a halt that reports a count is reported honestly.
  {
    let asked = [];
    const { R, seen } = harness({ onPause: (id) => { asked.push(id); return 3; } });
    await call(R, 'POST', '/api/businesses', { name: 'Acme' });
    seen.length = 0;
    const r = await call(R, 'PATCH', '/api/businesses/acme', { stage: 'paused' });
    A.eq(r.code, 200, 'pausing is 200');
    A.eq(r.json.business.stage, 'paused', 'the stage committed');
    A.eq(r.json.halted, 3, 'the response reports how many runs were actually stopped');
    A.eq(asked, ['acme'], 'onPause was called with THIS business id and no other');
    A.eq(names(seen).filter(n => n === 'business.paused').length, 1, 'pausing emits business.paused (not business.updated)');
    A.eq(last(seen, 'business.paused').halted, 3, 'business.paused carries the real halted count');
  }

  // --- the pause audit row says what the pause DID, and re-pausing does not re-halt ---
  {
    let calls = 0;
    const { R, activity } = harness({ onPause: () => { calls++; return 2; } });
    await call(R, 'POST', '/api/businesses', { name: 'Acme' });
    await call(R, 'PATCH', '/api/businesses/acme', { stage: 'paused' });
    A.eq(calls, 1, 'the halt ran once');
    A.ok(/stopped 2 in-flight runs/.test(activity.list('acme')[0].detail), 'the audit row says what the pause did — got: ' + activity.list('acme')[0].detail);
    A.eq(activity.list('acme')[0].action, 'Business paused', 'the row is named for the pause, not a generic update');
    await call(R, 'PATCH', '/api/businesses/acme', { stage: 'paused' });   // already paused
    A.eq(calls, 1, 're-pausing an already-paused business does NOT halt again (idempotent stop)');
  }

  // --- resuming is an ordinary update, not a second E-STOP ---
  {
    let calls = 0;
    const { R, seen } = harness({ onPause: () => { calls++; return 1; } });
    await call(R, 'POST', '/api/businesses', { name: 'Acme' });
    await call(R, 'PATCH', '/api/businesses/acme', { stage: 'paused' });
    seen.length = 0;
    const r = await call(R, 'PATCH', '/api/businesses/acme', { stage: 'live' });
    A.eq(r.code, 200, 'resuming is 200');
    A.eq(r.json.business.stage, 'live', 'the business is live again');
    A.eq(calls, 1, 'resuming does NOT call onPause');
    A.ok(!names(seen).includes('business.paused'), 'resuming never emits business.paused');
    A.eq(last(seen, 'business.updated').stage, 'live', 'resuming emits business.updated with the new stage');
  }

  // --- a halt that THROWS does not lose the pause, and the count is not fabricated ---
  {
    const { R, businesses } = harness({ onPause: () => { throw new Error('kill exploded'); } });
    await call(R, 'POST', '/api/businesses', { name: 'Acme' });
    const r = await call(R, 'PATCH', '/api/businesses/acme', { stage: 'paused' });
    A.eq(r.code, 200, 'a throwing halt does not fail the pause');
    A.eq(r.json.halted, 0, 'a halt that threw reports 0 — never an invented count');
    A.eq(businesses.get('acme').stage, 'paused', 'the stage still committed (the stop is the point)');
  }

  // --- with NO onPause wired (a headless boot) the pause still commits, honestly reporting 0 ---
  {
    const { R } = harness();
    await call(R, 'POST', '/api/businesses', { name: 'Acme' });
    const r = await call(R, 'PATCH', '/api/businesses/acme', { stage: 'paused' });
    A.eq(r.json.business.stage, 'paused', 'the pause commits even with no halt callback wired');
    A.eq(r.json.halted, 0, 'and it claims no runs were stopped');
  }

  // --- the module is actually MOUNTED by the host ---
  // Same failure mode as the 7 dead capability tools (docs/PHASE0-AUDIT.md §5b): a module that is written,
  // tested, and then never required by index.js. A route module nobody mounts serves nothing.
  {
    const fs = require('fs'); const path = require('path');
    const host = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'index.js'), 'utf8');
    A.ok(/require\(['"]\.\/business-routes\.js['"]\)/.test(host), 'index.js REQUIRES business-routes.js');
    A.ok(/makeBusinessRoutes\(\{/.test(host), 'index.js constructs the routes with its real stores');
    A.ok(/\.\.\.businessRoutes\.routes/.test(host), 'index.js spreads the business route rows into ROUTES');
    A.ok(/require\(['"]\.\/businesses-store\.js['"]\)/.test(host), 'index.js requires the business entity store');
    A.ok(/require\(['"]\.\/business-activity-store\.js['"]\)/.test(host), 'index.js requires the activity log store');
    // the two seams that make the events live and the pause real must be wired, not just accepted by the module.
    A.ok(/emit:\s*\(name,\s*payload\)\s*=>\s*chanEmit\(name,\s*payload\)/.test(host),
      'index.js injects the REAL chanEmit as the routes’ emit (a lazy wrapper — chanEmit is defined later in the file)');
    A.ok(/onPause:\s*\(id\)\s*=>\s*haltBusiness\(id\)/.test(host),
      'index.js injects haltBusiness as the routes’ onPause — the per-business E-STOP is wired, not declared');
  }

  A.report('business-routes.test');
})().catch(e => { console.error('business-routes.test CRASHED:', (e && e.stack) || e); process.exit(1); });
