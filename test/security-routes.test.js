'use strict';
/* security-routes.test.js — the /api/businesses/:id/security surface (Business OS Phase 10).

   The two things this suite exists to catch, both of which have bitten this codebase before:

     1. THE qrx TRAP. index.js's dispatch fills the match array ONLY for `rx` rows. A `qrx` row leaves gm =
        null, so a handler reading match[1] gets undefined and every business-scoped route 404s while looking
        perfectly correct in the table. So every row must be `rx`, the regexes must carry a query-tolerant
        tail, and the specific paths must be listed before the general one. All of that is asserted below,
        and the ASYMMETRY IS MIRRORED IN `call()` rather than assumed away.

     2. READ-ONLY. §13's mutations already have their own guarded routes. If this module ever grew a POST,
        it would be a second, weaker door to the same room — so the absence of any non-GET row is locked.   */

const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const { makeSecurityRoutes, RX_BIZ_SECURITY, RX_BIZ_SECURITY_AUDIT, RX_BIZ_SECURITY_RULES,
        MAX_AUDIT_LIMIT, DEFAULT_AUDIT_LIMIT } = require('../sidecar/security-routes.js');
const { makeBusinessSecurity } = require('../sidecar/business-security.js');
const P = require('../sidecar/business-permissions.js');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'security-routes.js'), 'utf8');

/* ---- a harness that mirrors index.js's dispatch asymmetry EXACTLY --------------------------------------
   `rx` fills the match array; `qrx` leaves it null. If the module ever used a qrx row, call() would hand the
   handler a null match and the test would 404 — which is the failure mode we want reproduced, not hidden. */
function mkRes() {
  const out = { code: 0, body: null };
  return {
    out,
    writeHead(code) { out.code = code; },
    end(s) { try { out.body = JSON.parse(s); } catch (e) { out.body = s; } }
  };
}

function call(routes, route, url) {
  const r = mkRes();
  const req = { url: url, method: route.m[0] === 'GET' ? 'GET' : route.m };
  const rx = route.rx || null;
  const ex = route.exact || null;
  let match = null;
  if (ex) match = (url.split('?')[0] === ex) ? [url.split('?')[0]] : null;
  // THE ASYMMETRY: only an rx row populates the match array, exactly as index.js's dispatch does.
  if (rx) match = rx.exec(url);
  if (!match) return { matched: false };
  route.h(req, r, match);
  return { matched: true, code: r.out.code, json: r.out.body };
}

function find(rows, url) {
  for (const r of rows) {
    const ex = r.exact || null;
    if (ex && url.split('?')[0] === ex) return r;
    if (r.rx && r.rx.test(url)) return r;
  }
  return null;
}

function mkRoutes(over) {
  const sec = over && over.security ? over.security : makeBusinessSecurity(Object.assign({
    agents: () => [{ id: 'a1', name: 'Atlas', role: 'ceo', grants: { safe: true, review: false } }],
    activity: () => ([
      { id: 'r1', at: 100, actor: { kind: 'user' }, action: 'research', result: 'ok', approval: 'not-required' },
      { id: 'r2', at: 200, actor: { kind: 'agent', name: 'Atlas' }, action: 'spend_money', result: 'pending', approval: 'required', reason: 'over budget' }
    ]),
    pending: () => 1
  }, (over && over.sources) || {}));
  return makeSecurityRoutes({
    security: sec,
    businesses: (over && over.businesses !== undefined) ? over.businesses : {
      get: (id) => (id === 'acme' ? { id: 'acme', name: 'Acme' } : null)
    }
  });
}

/* ---------- the rows are well-formed ---------- */
{
  const routes = mkRoutes();
  A.eq(routes.rows.length, 3, 'three rows');
  for (const r of routes.rows) {
    A.ok(!!r.rx, 'every row is an rx row (a qrx row would leave match[1] undefined and 404 every id)');
    A.eq(r.qrx, undefined, 'and NO row is a qrx row');
    A.eq(r.m, 'GET', 'every row is GET — this module is read-only');
    A.ok(typeof r.h === 'function', 'every row has a handler');
  }
  // exactly one regex matches any given url (no overlapping rows)
  for (const url of ['/api/businesses/acme/security', '/api/businesses/acme/security/audit', '/api/businesses/acme/security/rules']) {
    const hits = routes.rows.filter(r => r.rx.test(url)).length;
    A.eq(hits, 1, 'exactly one row matches ' + url);
  }
}
/* the specific paths are listed BEFORE the general one, or bare /security would swallow them */
{
  const routes = mkRoutes();
  const iAudit = routes.rows.findIndex(r => r.rx === RX_BIZ_SECURITY_AUDIT);
  const iRules = routes.rows.findIndex(r => r.rx === RX_BIZ_SECURITY_RULES);
  const iBare = routes.rows.findIndex(r => r.rx === RX_BIZ_SECURITY);
  A.ok(iAudit < iBare, '/security/audit is listed before bare /security');
  A.ok(iRules < iBare, '/security/rules is listed before bare /security');
  // and prove the ORDER is safe either way: the bare regex is end-anchored by QS, so it does NOT match the
  // audit path. The ordering is therefore belt-and-braces here rather than load-bearing — which is a better
  // place to be than the twin's /twin vs /twin/simulate, and is asserted so a future QS edit cannot silently
  // make the bare row greedy without this going red.
  A.ok(RX_BIZ_SECURITY.test('/api/businesses/acme/security/audit') === false,
    'the bare /security regex is end-anchored and does NOT swallow /security/audit');
  A.ok(RX_BIZ_SECURITY.test('/api/businesses/acme/security/rules') === false,
    'and it does not swallow /security/rules either');
}
/* the query tail is tolerated everywhere (a ?limit=… or ?tools=1 must not 404) */
{
  A.ok(RX_BIZ_SECURITY.test('/api/businesses/acme/security'), 'bare path matches');
  A.ok(RX_BIZ_SECURITY.test('/api/businesses/acme/security?x=1'), 'bare path tolerates a query tail');
  A.ok(RX_BIZ_SECURITY_AUDIT.test('/api/businesses/acme/security/audit?limit=5'), 'audit tolerates ?limit=');
  A.ok(RX_BIZ_SECURITY_RULES.test('/api/businesses/acme/security/rules?v=2'), 'rules tolerates a query tail');
  A.ok(RX_BIZ_SECURITY.test('/api/businesses/acme/security#frag') === false, 'a fragment is NOT part of the path');
}
/* source-lock the discipline: no qrx, and every rx carries the QS tail */
{
  A.ok(!/qrx\s*:/.test(SRC), 'the source contains no qrx row');
  /* the regexes are built from the BIZ/QS constants, so the query tail cannot be forgotten in one row */
  A.ok(/const QS = /.test(SRC), 'QS is defined');
  A.ok(/const BIZ = /.test(SRC), 'BIZ is defined');
  A.ok(/new RegExp\('\^\/api\/businesses\/' \+ BIZ/.test(SRC), 'the regexes are built from BIZ, not hand-written');
  A.ok(SRC.split('+ QS)').length - 1 >= 3, 'every business-scoped regex carries the QS tail');
  A.ok(/require\('\.\/business-security\.js'\)/.test(SRC) === false, 'security-routes does not require the engine directly (it is injected)');
}

/* ---------- GET /security — the combined read ---------- */
{
  const routes = mkRoutes();
  const row = find(routes.rows, '/api/businesses/acme/security');
  const r = call(routes, row, '/api/businesses/acme/security');
  A.ok(r.matched, 'the overview route matches');
  A.eq(r.code, 200, 'the overview answers 200');
  A.ok(r.json.ok === true, 'the payload is ok');
  A.eq(r.json.businessId, 'acme', 'scoped to the id in the URL');
  A.eq(r.json.agentCount, 1, 'the seat count is carried through');
  A.eq(r.json.pendingApprovals, 1, 'the pending count is carried through');
  A.ok(r.json.totals.actions === P.ACTIONS.length, 'the full tier table is present');
  A.ok(!('score' in r.json), 'no score field on the wire');
}
/* the match[1] the handler reads is the business id — the qrx trap, asserted directly */
{
  const m = RX_BIZ_SECURITY.exec('/api/businesses/my-biz-42/security?x=1');
  A.eq(m[1], 'my-biz-42', 'the regex captures the business id in match[1]');
  A.ok(m[1] !== undefined, 'and it is NOT undefined (which is what a qrx row would produce)');
}
/* an id realistic to this store captures whole. Business ids come from slugFor(), which strips everything
   outside [a-z0-9] to '-', so an id is always [a-z0-9-] — asserted here against the real generator. */
{
  const { slugFor } = require('../sidecar/businesses-store.js');
  const id = slugFor('My Biz 42');
  const m = RX_BIZ_SECURITY.exec('/api/businesses/' + id + '/security');
  A.eq(m[1], id, 'a slugFor-produced id captures whole');
  A.ok(/^[a-z0-9-]+$/.test(id), 'and such an id is [a-z0-9-] only');
  A.eq(slugFor('a~b'), 'a-b', 'slugFor strips a tilde to a dash (ids never contain ~)');
}

/* ---------- P6: an unknown business is a 404, on every route ---------- */
{
  const routes = mkRoutes();
  for (const url of ['/api/businesses/ghost/security', '/api/businesses/ghost/security/audit', '/api/businesses/ghost/security/rules']) {
    const row = find(routes.rows, url);
    const r = call(routes, row, url);
    A.eq(r.code, 404, url + ' 404s for an unknown business');
    A.ok(/unknown business/.test(r.json.reason), 'and says why');
  }
}
/* no businesses store at all -> do not block (the same fail-open the twin routes use) */
{
  const routes = mkRoutes({ businesses: null });
  const row = find(routes.rows, '/api/businesses/acme/security');
  A.eq(call(routes, row, '/api/businesses/acme/security').code, 200, 'with no store to ask, the read proceeds');
}

/* ---------- GET /security/audit — the slice + the clamp ---------- */
{
  const routes = mkRoutes();
  const row = find(routes.rows, '/api/businesses/acme/security/audit');
  const r = call(routes, row, '/api/businesses/acme/security/audit?limit=5');
  A.eq(r.code, 200, 'the audit route answers 200');
  A.eq(r.json.rows.length, 2, 'the rows come back');
  A.eq(r.json.limitClamped, undefined, 'a limit under the max is not flagged as clamped');
}
/* a limit ABOVE the max is applied AND reported — "that is all I would give you" != "that is all there is" */
{
  const routes = mkRoutes();
  const row = find(routes.rows, '/api/businesses/acme/security/audit');
  const r = call(routes, row, '/api/businesses/acme/security/audit?limit=99999');
  A.eq(r.code, 200, 'an oversize limit still answers 200');
  A.ok(r.json.limitClamped, 'but the clamp is reported');
  A.eq(r.json.limitClamped.applied, MAX_AUDIT_LIMIT, 'the applied limit is the max');
  A.eq(r.json.limitClamped.asked, 99999, 'and the asked-for value is echoed');
}
/* a junk limit falls back to the default rather than becoming unbounded or empty */
{
  const routes = mkRoutes();
  const row = find(routes.rows, '/api/businesses/acme/security/audit');
  for (const q of ['limit=abc', 'limit=0', 'limit=-3', '']) {
    const r = call(routes, row, '/api/businesses/acme/security/audit?' + q);
    A.eq(r.code, 200, 'a junk limit (' + (q || 'none') + ') does not error');
    A.eq(r.json.limitClamped, undefined, 'and is not reported as clamped');
  }
}

/* ---------- GET /security/rules — the policy, no state ---------- */
{
  const routes = mkRoutes();
  const row = find(routes.rows, '/api/businesses/acme/security/rules');
  const r = call(routes, row, '/api/businesses/acme/security/rules');
  A.eq(r.code, 200, 'the rules route answers 200');
  A.ok(r.json.rules.tiers.length === P.TIERS.length, 'the tier table comes back');
  A.eq(r.json.businessId, 'acme', 'the policy read is still business-scoped in the URL');
  A.ok(JSON.stringify(r.json).toLowerCase().indexOf('heldby') < 0, 'the policy read carries no holders');
}

/* ---------- never writes to a store ---------- */
{
  // The engine is read-only by construction, and this module has no POST row. Prove BOTH.
  let mutated = false;
  const sec = makeBusinessSecurity({
    agents: () => { mutated = true; return []; },
    activity: () => { mutated = true; return []; },
    pending: () => { mutated = true; return 0; }
  });
  const routes = makeSecurityRoutes({ security: sec, businesses: { get: () => ({ id: 'acme' }) } });
  for (const url of ['/api/businesses/acme/security', '/api/businesses/acme/security/audit', '/api/businesses/acme/security/rules']) {
    call(routes, find(routes.rows, url), url);
  }
  A.ok(mutated, 'the accessors were exercised (so the check below is meaningful)');
  // the module exposes no write path at all:
  A.ok(!/\bpost\b/i.test(routes.rows.map(r => r.m).join(',')), 'no POST row exists — the surface cannot mutate');
}

/* ---------- a broken engine surfaces as a 500, not a crash ---------- */
{
  const routes = mkRoutes({ security: { overview: () => { throw new Error('engine down'); }, audit: () => { throw new Error('down'); }, catalog: () => { throw new Error('down'); } } });
  const o = call(routes, find(routes.rows, '/api/businesses/acme/security'), '/api/businesses/acme/security');
  A.eq(o.code, 500, 'a throwing overview is a 500');
  A.ok(/down/.test(o.json.reason), 'and the message is carried');
  const a = call(routes, find(routes.rows, '/api/businesses/acme/security/audit'), '/api/businesses/acme/security/audit');
  A.eq(a.code, 500, 'a throwing audit is a 500');
  const rr = call(routes, find(routes.rows, '/api/businesses/acme/security/rules'), '/api/businesses/acme/security/rules');
  A.eq(rr.code, 500, 'a throwing catalog is a 500');
}
/* an engine that returns ok:false becomes a 400 with the engine's own reason */
{
  const routes = mkRoutes({ security: { overview: () => ({ ok: false, reason: 'a businessId is required' }) } });
  const r = call(routes, find(routes.rows, '/api/businesses/acme/security'), '/api/businesses/acme/security');
  A.eq(r.code, 400, 'a refusal is a 400');
  A.ok(/businessId is required/.test(r.json.reason), 'and the engine\'s reason is passed through');
}

/* ---------- refuses to build without its engine ---------- */
{
  A.throws(() => makeSecurityRoutes({}), 'the module refuses to build with no engine');
  A.throws(() => makeSecurityRoutes(), 'and with no deps at all');
}

/* ---------- bounds are sane and exported ---------- */
{
  A.ok(MAX_AUDIT_LIMIT > 0 && MAX_AUDIT_LIMIT <= 1000, 'the audit max is a sane bound');
  A.ok(DEFAULT_AUDIT_LIMIT > 0 && DEFAULT_AUDIT_LIMIT <= MAX_AUDIT_LIMIT, 'the default is within the max');
}

A.report('security-routes');
