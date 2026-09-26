/* sidecar/security-routes.js — the HTTP surface for §13's SECURITY CENTER (Business OS Phase 10).

   THREE ROUTES, ALL GET, AND NONE OF THEM WRITES.

     GET /api/businesses/:biz/security              the combined read: tiers x holders, seats, decisions, pending
     GET /api/businesses/:biz/security/audit        the full audit slice for this business
     GET /api/businesses/:biz/security/rules        the §13 policy itself (tier table, defaults, risks)

   WHY GET-ONLY. §13's gap was a MISSING VIEW, not a missing capability: permissions, approvals and the audit
   trail all exist and are all enforced elsewhere. Granting, revoking and approving are mutations that already
   have their own routes and their own guards (agent-routes.js `POST /agents/:id/grants`, automation-routes.js
   approval decisions). This module only READS, so it cannot become a second, weaker way to change authority
   — which is exactly the P4 failure a "security center" is most tempting to commit.

   ROUTE MATCHING — the trap, restated because it cost a whole phase: index.js's dispatch populates the match
   array ONLY for `rx` rows; a `qrx` row leaves gm = null and a handler reading match[1] gets undefined, so
   every business-scoped route 404s while looking correct. Every row here is **rx** with a query-tolerant
   tail (QS), and `/security/audit` + `/security/rules` are listed BEFORE bare `/security` because the
   shorter regex accepts any query tail and would otherwise swallow them.

   PURE-ish: `respondJson` injected, so this is unit-testable without booting the server. */

'use strict';

const BIZ = '([A-Za-z0-9_-]+)';
const QS = '(?:\\?[^#]*)?$';

// Most specific FIRST in the rows array (see the header note).
const RX_BIZ_SECURITY_AUDIT = new RegExp('^/api/businesses/' + BIZ + '/security/audit' + QS);
const RX_BIZ_SECURITY_RULES = new RegExp('^/api/businesses/' + BIZ + '/security/rules' + QS);
const RX_BIZ_SECURITY = new RegExp('^/api/businesses/' + BIZ + '/security' + QS);

const MAX_AUDIT_LIMIT = 200;
const DEFAULT_AUDIT_LIMIT = 50;

function defaultRespondJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function makeSecurityRoutes(deps) {
  deps = deps || {};
  const security = deps.security;                 // makeBusinessSecurity(...) — the composing reader
  const businesses = deps.businesses || null;     // businesses store, for the exists check
  const respondJson = typeof deps.respondJson === 'function' ? deps.respondJson : defaultRespondJson;

  if (!security) throw new Error('security-routes.js requires { security }');

  const json = (res, code, obj) => respondJson(res, code, obj);
  const str = (v) => (v == null ? '' : String(v));

  // A business that does not exist is a 404 on every business-scoped route (P6: never answer for a business
  // that is not there — indistinguishable otherwise from "it exists and has a clean record").
  function bizExists(id) {
    if (!businesses || typeof businesses.get !== 'function') return true;   // no store to ask = do not block
    try { return !!businesses.get(id); } catch (e) { return true; }
  }
  function wantBiz(res, id) {
    if (!id) { json(res, 400, { ok: false, reason: 'a businessId is required (isolation is by key — never implied)' }); return null; }
    if (!bizExists(id)) { json(res, 404, { ok: false, reason: 'unknown business: ' + id }); return null; }
    return id;
  }

  /* Clamp a caller-supplied limit. A limit of "0", "abc" or "-5" must not silently mean "unbounded" or
     "nothing" — an unreadable request becomes the default, and an oversize one is capped and SAID SO. */
  function readLimit(req) {
    let raw = '';
    try {
      const u = new URL(req.url || '/', 'http://x');
      raw = u.searchParams.get('limit') || '';
    } catch (e) { raw = ''; }
    const n = Number(raw);
    if (!raw || !Number.isFinite(n) || n <= 0) return { limit: DEFAULT_AUDIT_LIMIT, clamped: false };
    const want = Math.floor(n);
    if (want > MAX_AUDIT_LIMIT) return { limit: MAX_AUDIT_LIMIT, clamped: true, asked: want };
    return { limit: want, clamped: false };
  }

  /* ---- THE COMBINED READ ---------------------------------------------------------------------------*/

  // GET /api/businesses/:biz/security — who can do what, what each seat holds, the authority decisions, and
  // what is waiting on a human.
  function handleOverview(req, res, match) {
    const b = wantBiz(res, match && match[1]);
    if (!b) return;
    let out;
    try { out = security.overview(b); }
    catch (e) { return json(res, 500, { ok: false, reason: 'could not build the security overview: ' + str(e && e.message) }); }
    if (!out || out.ok === false) {
      return json(res, 400, { ok: false, reason: (out && out.reason) || 'could not read this business\'s security state' });
    }
    json(res, 200, out);
  }

  /* ---- THE FULL AUDIT SLICE ------------------------------------------------------------------------*/

  // GET /api/businesses/:biz/security/audit?limit=N — the trail itself, newest first.
  function handleAudit(req, res, match) {
    const b = wantBiz(res, match && match[1]);
    if (!b) return;
    const lim = readLimit(req);
    let out;
    try { out = security.audit(b, { limit: lim.limit }); }
    catch (e) { return json(res, 500, { ok: false, reason: 'could not read the audit trail: ' + str(e && e.message) }); }
    if (!out || out.ok === false) {
      return json(res, 400, { ok: false, reason: (out && out.reason) || 'could not read the audit trail' });
    }
    /* Report the clamp rather than applying it silently — a caller who asked for 5,000 and got 200 should
       know the difference between "that is all there is" and "that is all I would give you". */
    if (lim.clamped) out.limitClamped = { asked: lim.asked, applied: lim.limit, max: MAX_AUDIT_LIMIT };
    json(res, 200, out);
  }

  /* ---- THE POLICY ----------------------------------------------------------------------------------*/

  // GET /api/businesses/:biz/security/rules — the §13 tier table itself. Business-scoped in the URL for
  // consistency with its siblings (and for the P6 404), though the policy is station-wide.
  function handleRules(req, res, match) {
    const b = wantBiz(res, match && match[1]);
    if (!b) return;
    let out;
    try { out = security.catalog(); }
    catch (e) { return json(res, 500, { ok: false, reason: 'could not read the §13 tier table: ' + str(e && e.message) }); }
    json(res, 200, { ok: true, businessId: b, rules: out });
  }

  const rows = [
    { m: 'GET', rx: RX_BIZ_SECURITY_AUDIT, h: handleAudit },
    { m: 'GET', rx: RX_BIZ_SECURITY_RULES, h: handleRules },
    { m: 'GET', rx: RX_BIZ_SECURITY, h: handleOverview }
  ];

  return { rows: rows, MAX_AUDIT_LIMIT: MAX_AUDIT_LIMIT, DEFAULT_AUDIT_LIMIT: DEFAULT_AUDIT_LIMIT };
}

module.exports = {
  makeSecurityRoutes,
  RX_BIZ_SECURITY,
  RX_BIZ_SECURITY_AUDIT,
  RX_BIZ_SECURITY_RULES,
  MAX_AUDIT_LIMIT,
  DEFAULT_AUDIT_LIMIT
};
