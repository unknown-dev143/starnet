'use strict';
/* test/agent-routes.test.js — the AI Team HTTP surface (Phase 3).

   Exercised with FAKE req/res, because index.js self-boots and cannot be require()d — the handlers take
   readBody/respondJson by injection precisely so this is possible.

   The load-bearing behaviours:
     · P6 — a task may only be assigned to an agent of the SAME business; a cross-business pair is a 409
       naming both businesses. This is the one link a flat JSON store cannot catch on its own;
     · §13 — a request to grant `restricted` is refused with an explicit note, so a client cannot believe it
       granted something it did not;
     · P1 — a memory write with no source is a 422 (the store refuses; the route must not default it);
     · a message addressed to someone who is not the user or an agent of this business is a 422;
     · removing an agent that still has tasks is a 409 (no orphans);
     · every emitted payload is schema-VALID (the real bus silently drops an invalid one).

   Businesses and tasks are seeded through their OWN stores rather than their routes: this module mounts
   agent-routes only, and pulling the other route tables in would test them, not this one. */
const A = require('./_assert.js');
const {
  makeAgentRoutes,
  RX_BIZ_AGENTS, RX_BIZ_MEMORY, RX_BIZ_MESSAGES, RX_AGENT, RX_AGENT_STATUS, RX_AGENT_GRANTS,
  RX_TASK_ASSIGN, RX_MEMORY
} = require('../sidecar/agent-routes.js');
const { makeBusinessAgentsStore } = require('../sidecar/business-agents-store.js');
const { makeBusinessMemory } = require('../sidecar/business-memory.js');
const { makeAgentMessagesStore } = require('../sidecar/agent-messages-store.js');
const { makeBusinessesStore } = require('../sidecar/businesses-store.js');
const { makeBusinessTasksStore } = require('../sidecar/business-tasks-store.js');
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
  const businesses = makeBusinessesStore({ records: [], persist: () => {}, now: () => 1000 });
  const agents = makeBusinessAgentsStore({ records: [], persist: () => {}, now: () => 1000 });
  const memory = makeBusinessMemory({ records: [], persist: () => {}, now: () => 1000 });
  const messages = makeAgentMessagesStore({ records: [], persist: () => {}, now: () => 1000 });
  const tasks = makeBusinessTasksStore({ records: [], persist: () => {}, now: () => 1000 });
  const activity = makeBusinessActivityStore({ records: [], persist: () => {}, now: () => 1000 });
  const seen = [];
  const R = makeAgentRoutes(Object.assign({
    agents, memory, messages, businesses, tasks, activity, readBody,
    emit: (name, payload) => seen.push({ name, payload })
  }, extra || {}));
  // seed helpers — a business and a task, through their own stores.
  const biz = (name) => businesses.create({ name }).business;
  const task = (businessId, title) => tasks.create(businessId, { title }).task;
  return { businesses, agents, memory, messages, tasks, activity, R, seen, biz, task };
}

function last(seen, name) { for (let i = seen.length - 1; i >= 0; i--) if (seen[i].name === name) return seen[i].payload; return null; }

// dispatch exactly as index.js does: method gate, then the single match key, then h(req,res,gm).
// NOTE the asymmetry, which is the bug this suite pins: `rx` matches the FULL url and FILLS gm;
// `qrx` tests the query-stripped path and leaves gm NULL. Mirrored verbatim from index.js ~9505.
async function call(R, method, url, body) {
  const res = fakeRes();
  const bare = String(url).split('?')[0];
  const hit = R.routes.filter(r => (Array.isArray(r.m) ? r.m.indexOf(method) >= 0 : r.m === method))
    .filter(r => (r.exact !== undefined ? url === r.exact
      : (r.rx ? !!String(url).match(r.rx) : (r.qrx ? !!bare.match(r.qrx) : false))))[0];
  if (!hit) throw new Error('no route for ' + method + ' ' + url);
  const m = hit.rx ? String(url).match(hit.rx) : null;
  await hit.h(fakeReq(method, url, body), res, m);
  return { code: res.code, json: res.body ? JSON.parse(res.body) : null };
}

(async () => {
  /* ---------- the route rows index.js will mount are well-formed ---------- */
  {
    const { R } = harness();
    A.eq(R.routes.length, 11, 'the module exposes 11 route rows');
    for (const row of R.routes) {
      A.ok(!!row.m && typeof row.h === 'function', 'each row has a method and a handler');
      const matchers = ['exact', 'qsplit', 'prefix', 'qprefix', 'rx', 'qrx'].filter(k => row[k] !== undefined);
      A.eq(matchers.length, 1, 'each row carries exactly ONE match key (' + matchers.join('/') + ')');
    }
    A.ok(RX_BIZ_AGENTS.test('/api/businesses/acme/agents'), 'RX_BIZ_AGENTS matches');
    A.ok(!RX_BIZ_AGENTS.test('/api/businesses/acme/agents/acme~a1'), 'RX_BIZ_AGENTS does not swallow an agent id');
    A.ok(RX_BIZ_MEMORY.test('/api/businesses/acme/memory'), 'RX_BIZ_MEMORY matches');
    A.ok(RX_BIZ_MESSAGES.test('/api/businesses/acme/messages'), 'RX_BIZ_MESSAGES matches');
    A.ok(RX_AGENT.test('/api/agents/acme~a1'), 'RX_AGENT matches a "~" separated agent id');
    A.ok(!RX_AGENT.test('/api/agents/acme~a1/status'), 'RX_AGENT does not swallow /status');
    A.ok(RX_AGENT_STATUS.test('/api/agents/acme~a1/status'), 'RX_AGENT_STATUS matches');
    A.ok(RX_AGENT_GRANTS.test('/api/agents/acme~a1/grants'), 'RX_AGENT_GRANTS matches');
    A.ok(RX_TASK_ASSIGN.test('/api/tasks/acme~t1/assign'), 'RX_TASK_ASSIGN matches a task id');
    A.ok(RX_MEMORY.test('/api/memory/agent~acme~a1~2'), 'RX_MEMORY matches a nested agent-scope memory id');
    A.ok(!RX_MEMORY.test('/api/memory/agent~acme~a1#2'), 'a "#" id would never arrive — the pattern does not pretend otherwise');
  }

  /* ---------- THE ROUTE-TABLE TRAP: no qrx row may capture a path segment ----------
     FOUND LIVE during app verification. index.js's dispatcher fills the match array ONLY for `rx` rows;
     a `qrx` row reached its handler with match === null, so `POST /api/businesses/<id>/agents` answered
     "no such business: null" for a business that existed. These locks make the trap a failing test rather
     than a silent 404 (and mirror automation-routes.test.js's Phase-4 lesson). */
  {
    const { R } = harness();
    const segQrx = R.routes.filter(r => r.qrx !== undefined && /\(/.test(String(r.qrx)));
    A.eq(segQrx.length, 0, 'NO row is a segment-capturing qrx (a qrx row hands its handler match === null)');
    for (const rx of [RX_BIZ_AGENTS, RX_BIZ_MEMORY, RX_BIZ_MESSAGES]) {
      const row = R.routes.filter(r => r.rx === rx)[0];
      A.ok(!!row, 'the family is registered as rx, not qrx');
      A.ok(String(rx).indexOf('(?:\\?[^#]*)?$') >= 0, 'its regex carries the query-tolerant QS tail');
    }
    // a QUERY on a business-scoped GET must still match AND still capture the id (the whole point of rx+QS)
    const q = '/api/businesses/acme/agents?role=ceo&specialty=strategist';
    const m = q.match(RX_BIZ_AGENTS);
    A.ok(!!m, 'a query string still matches the row');
    A.eq(m[1], 'acme', 'and the businessId is captured out of the group — not null');
    A.ok(!RX_BIZ_AGENTS.test('/api/businesses/acme/agents/acme~a1'),
      'the QS tail does not loosen the anchor: an agent id is still refused');
  }

  /* ---------- the catalogs ---------- */
  {
    const { R } = harness();
    const roles = await call(R, 'GET', '/api/roles');
    A.eq(roles.code, 200, 'GET /api/roles is 200');
    A.eq(roles.json.roles.length, 12, 'the catalog lists §7\'s twelve roles');
    A.eq(roles.json.unresolved, [], 'the role bridge is intact');
    // The bare GET /api/permissions ROW was REMOVED from this module: mounted above index.js's own row it
    // silently shadowed the grant list (dispatchRoute is first-match-wins, and `exact` compares the raw url).
    // The catalogue is still this module's definition, so call the exported handler directly — the SHAPE is
    // what this block tests — and lock the row's absence so it cannot come back.
    const pRes = fakeRes();
    R.handlePermissions(fakeReq('GET', '/api/permissions'), pRes);
    const perms = { code: pRes.code, json: JSON.parse(pRes.body) };
    A.eq(perms.code, 200, 'the permission catalogue handler is 200');
    A.eq(perms.json.tiers.length, 3, 'the catalog lists §13\'s three tiers');
    A.eq(perms.json.defaultGrants, { safe: true, review: false, restricted: false }, 'it reports the default grants');
    A.ok(!R.routes.some(r => r.exact === '/api/permissions'),
      'the module mounts NO bare /api/permissions row (it would shadow index.js\'s grant list)');
  }

  /* ---------- hire ---------- */
  {
    const H = harness();
    const bad = await call(H.R, 'POST', '/api/businesses/acme/agents', { role: 'ceo' });
    A.eq(bad.code, 404, 'a hire into an unknown business is a 404');
    H.biz('Acme');

    const noRole = await call(H.R, 'POST', '/api/businesses/acme/agents', {});
    A.eq(noRole.code, 400, 'a hire with no role is a 400');
    A.ok(/unknown role/.test(noRole.json.error), 'and the error says so');

    const ok = await call(H.R, 'POST', '/api/businesses/acme/agents', { role: 'ceo' });
    A.eq(ok.code, 201, 'a valid hire is 201');
    A.eq(ok.json.agent.role, 'ceo', 'the agent carries the role');
    A.eq(ok.json.agent.specialty, 'strategist', 'and the default class');

    const list = await call(H.R, 'GET', '/api/businesses/acme/agents');
    A.eq(list.code, 200, 'listing agents is 200');
    A.eq(list.json.count, 1, 'and shows the one hired');

    const v = EVENTS.validate('agent.hired', last(H.seen, 'agent.hired'));
    A.ok(v.ok, 'agent.hired is schema-valid (' + (v.errors || []).join('; ') + ')');
  }

  /* ---------- one agent: the permission view ---------- */
  {
    const H = harness();
    H.biz('Acme');
    const a = (await call(H.R, 'POST', '/api/businesses/acme/agents', { role: 'finance' })).json.agent;

    const got = await call(H.R, 'GET', '/api/agents/' + a.id);
    A.eq(got.code, 200, 'GET an agent is 200');
    A.eq(got.json.memoryNamespace, 'biz:acme:agent:' + a.id, 'the response names the memory scope');
    A.eq(got.json.decisions.length, 13, 'the permission view covers every §13 action');
    const spend = got.json.decisions.filter(d => d.action === 'spend_money')[0];
    A.eq(spend.allow, false, 'a review action is not allowed by default');
    A.eq(spend.approval, 'required', 'and reports that approval is required');
    const del = got.json.decisions.filter(d => d.action === 'delete_data')[0];
    A.eq(del.tier, 'restricted', 'a restricted action reports its tier');

    A.eq((await call(H.R, 'GET', '/api/agents/nope')).code, 404, 'an unknown agent is a 404');
  }

  /* ---------- grants: restricted is refused with a note ---------- */
  {
    const H = harness();
    H.biz('Acme');
    const a = (await call(H.R, 'POST', '/api/businesses/acme/agents', { role: 'finance' })).json.agent;

    const g = await call(H.R, 'POST', '/api/agents/' + a.id + '/grants', { grants: { review: true, restricted: true } });
    A.eq(g.code, 200, 'the grant update succeeds');
    A.eq(g.json.agent.grants.restricted, false, 'restricted was NOT applied');
    A.eq(g.json.agent.grants.review, true, 'review was applied');
    A.ok(/never auto-grantable/.test(g.json.note), 'and the response says so explicitly rather than staying silent');
    A.eq(last(H.seen, 'agent.updated').changed, ['grants'], 'the change is reported');

    const got = await call(H.R, 'GET', '/api/agents/' + a.id);
    A.eq(got.json.decisions.filter(d => d.action === 'spend_money')[0].allow, true, 'the review grant now permits spending');
    A.eq(got.json.decisions.filter(d => d.action === 'delete_data')[0].allow, false, 'but restricted stays refused');
  }

  /* ---------- status (§19) ---------- */
  {
    const H = harness();
    H.biz('Acme');
    const a = (await call(H.R, 'POST', '/api/businesses/acme/agents', { role: 'research' })).json.agent;
    const s = await call(H.R, 'POST', '/api/agents/' + a.id + '/status', { status: 'paused' });
    A.eq(s.code, 200, 'pausing an individual agent is 200 (§19)');
    A.eq(s.json.agent.status, 'paused', 'and the status is applied');
    A.eq(last(H.seen, 'agent.updated').changed, ['status'], 'the status change is reported');
    A.eq((await call(H.R, 'POST', '/api/agents/' + a.id + '/status', { status: 'nope' })).code, 400, 'an unknown status is a 400');
  }

  /* ---------- PATCH ---------- */
  {
    const H = harness();
    H.biz('Acme');
    const a = (await call(H.R, 'POST', '/api/businesses/acme/agents', { role: 'ceo' })).json.agent;
    const p = await call(H.R, 'PATCH', '/api/agents/' + a.id, { name: 'Nova', role: 'engineering' });
    A.eq(p.code, 200, 'a patch is 200');
    A.eq(p.json.agent.name, 'Nova', 'the rename applied');
    A.eq(p.json.agent.specialty, 'engineer', 'the re-role adopted the new role\'s class');
    A.eq(p.json.changed.sort(), ['name', 'role', 'specialty'], 'changed names every field that moved');
    A.eq(last(H.seen, 'agent.updated').changed.sort(), ['name', 'role', 'specialty'], 'and the event agrees');

    const noop = await call(H.R, 'PATCH', '/api/agents/' + a.id, { name: 'Nova' });
    A.eq(noop.json.changed, [], 'a no-op patch reports no change');
  }

  /* ---------- assignment: P6 cross-business refusal ---------- */
  {
    const H = harness();
    H.biz('Acme'); H.biz('Beta');
    const acmeAgent = (await call(H.R, 'POST', '/api/businesses/acme/agents', { role: 'research' })).json.agent;
    const betaAgent = (await call(H.R, 'POST', '/api/businesses/beta/agents', { role: 'research' })).json.agent;
    const t = H.task('acme', 'Scan the market');

    A.eq((await call(H.R, 'POST', '/api/tasks/nope~t9/assign', { agentId: acmeAgent.id })).code, 404, 'an unknown task is a 404');
    A.eq((await call(H.R, 'POST', '/api/tasks/' + t.id + '/assign', { agentId: 'nope' })).code, 404, 'an unknown agent is a 404');

    const cross = await call(H.R, 'POST', '/api/tasks/' + t.id + '/assign', { agentId: betaAgent.id });
    A.eq(cross.code, 409, 'a cross-business assignment is a 409');
    A.ok(/cross-business assignment is refused/.test(cross.json.error), 'and says why (P6)');

    const ok = await call(H.R, 'POST', '/api/tasks/' + t.id + '/assign', { agentId: acmeAgent.id });
    A.eq(ok.code, 200, 'a same-business assignment is 200');
    A.eq(ok.json.task.assignedAgent, acmeAgent.id, 'the task carries the agent');
    const v = EVENTS.validate('agent.assigned', last(H.seen, 'agent.assigned'));
    A.ok(v.ok, 'agent.assigned is schema-valid (' + (v.errors || []).join('; ') + ')');

    const un = await call(H.R, 'POST', '/api/tasks/' + t.id + '/assign', { agentId: '' });
    A.eq(un.json.task.assignedAgent, '', 'an empty agentId unassigns');
  }

  /* ---------- assignment degrades honestly without the task store ---------- */
  {
    const agents = makeBusinessAgentsStore({ records: [], persist: () => {}, now: () => 1000 });
    const memory = makeBusinessMemory({ records: [], persist: () => {}, now: () => 1000 });
    const messages = makeAgentMessagesStore({ records: [], persist: () => {}, now: () => 1000 });
    const R = makeAgentRoutes({ agents, memory, messages, readBody });
    const r = await call(R, 'POST', '/api/tasks/x~t1/assign', { agentId: 'y' });
    A.eq(r.code, 501, 'assignment without a task store is a 501, never a silent success');
  }

  /* ---------- removing an agent that still has work is refused ---------- */
  {
    const H = harness();
    H.biz('Acme');
    const a = (await call(H.R, 'POST', '/api/businesses/acme/agents', { role: 'research' })).json.agent;
    const t = H.task('acme', 'Scan');
    await call(H.R, 'POST', '/api/tasks/' + t.id + '/assign', { agentId: a.id });

    const blocked = await call(H.R, 'DELETE', '/api/agents/' + a.id);
    A.eq(blocked.code, 409, 'removing an agent with assigned tasks is a 409');
    A.eq(blocked.json.tasks, [t.id], 'and it names the tasks');
    A.eq((await call(H.R, 'GET', '/api/agents/' + a.id)).code, 200, 'the agent is still there');

    await call(H.R, 'POST', '/api/tasks/' + t.id + '/assign', { agentId: '' });
    const gone = await call(H.R, 'DELETE', '/api/agents/' + a.id);
    A.eq(gone.code, 200, 'once the tasks are cleared the removal succeeds');
    A.eq(gone.json.removed, a.id, 'and names what was removed');
    const v = EVENTS.validate('agent.fired', last(H.seen, 'agent.fired'));
    A.ok(v.ok, 'agent.fired is schema-valid (' + (v.errors || []).join('; ') + ')');
  }

  /* ---------- memory: P1 source guard ---------- */
  {
    const H = harness();
    H.biz('Acme');

    const noSource = await call(H.R, 'POST', '/api/businesses/acme/memory', { kind: 'decision', text: 'Ship in March' });
    A.eq(noSource.code, 422, 'a memory write with no source is a 422 (P1)');
    A.ok(/source/.test(noSource.json.error), 'and the error names the missing source');

    const ok = await call(H.R, 'POST', '/api/businesses/acme/memory', { kind: 'decision', text: 'Ship in March', source: 'user' });
    A.eq(ok.code, 201, 'a complete memory write is 201');
    A.eq(ok.json.entry.scope, 'business', 'the scope defaults to business');
    A.eq(ok.json.entry.ownerId, 'acme', 'the owner defaults to the business');
    A.eq(ok.json.entry.businessId, 'acme', 'and it is filed under the business');
    const v = EVENTS.validate('business.memory.written', last(H.seen, 'business.memory.written'));
    A.ok(v.ok, 'business.memory.written is schema-valid (' + (v.errors || []).join('; ') + ')');

    const read = await call(H.R, 'GET', '/api/businesses/acme/memory');
    A.eq(read.code, 200, 'reading memory is 200');
    A.eq(read.json.entries.length, 1, 'and returns the entry');
    A.eq(read.json.scope, 'business', 'the response echoes the scope');
    A.eq(read.json.counts.decision, 1, 'and the per-kind counts');

    // a user-scope memory belongs to no business.
    const u = await call(H.R, 'POST', '/api/businesses/acme/memory', { scope: 'user', kind: 'instruction', text: 'Be brief', source: 'user' });
    A.eq(u.json.entry.businessId, '', 'a user-scope memory claims no business');

    const forgot = await call(H.R, 'DELETE', '/api/memory/' + ok.json.entry.id);
    A.eq(forgot.code, 200, 'forgetting a memory is 200');
    A.eq(forgot.json.removed, ok.json.entry.id, 'and names it');
    A.eq((await call(H.R, 'DELETE', '/api/memory/nope~x~9')).code, 404, 'forgetting an unknown id is a 404');
    const fv = EVENTS.validate('business.memory.forgotten', last(H.seen, 'business.memory.forgotten'));
    A.ok(fv.ok, 'business.memory.forgotten is schema-valid (' + (fv.errors || []).join('; ') + ')');
  }

  /* ---------- messages: only the user and this business's agents ---------- */
  {
    const H = harness();
    H.biz('Acme');
    const a = (await call(H.R, 'POST', '/api/businesses/acme/agents', { role: 'research' })).json.agent;

    const stranger = await call(H.R, 'POST', '/api/businesses/acme/messages', { from: 'user', to: 'stranger', kind: 'note', body: 'hi' });
    A.eq(stranger.code, 422, 'a message to a stranger is a 422');
    A.ok(/neither the user nor an agent/.test(stranger.json.error), 'and says why');

    const self = await call(H.R, 'POST', '/api/businesses/acme/messages', { from: 'user', to: 'user', kind: 'note', body: 'hi' });
    A.eq(self.code, 400, 'a self-message is a 400 (the store refuses it)');

    const ok = await call(H.R, 'POST', '/api/businesses/acme/messages', { from: 'user', to: a.id, kind: 'request', body: 'Scan the market' });
    A.eq(ok.code, 201, 'a message to a real agent is 201');
    A.eq(ok.json.message.to, a.id, 'the recipient is recorded');
    const v = EVENTS.validate('agent.message', last(H.seen, 'agent.message'));
    A.ok(v.ok, 'agent.message is schema-valid (' + (v.errors || []).join('; ') + ')');

    const list = await call(H.R, 'GET', '/api/businesses/acme/messages');
    A.eq(list.json.messages.length, 1, 'the message is readable');
    A.eq(list.json.parties, ['user', a.id].sort(), 'and both parties are listed');

    const filtered = await call(H.R, 'GET', '/api/businesses/acme/messages?with=' + a.id);
    A.eq(filtered.json.messages.length, 1, 'the ?with filter matches');
  }

  /* ---------- method discipline + every emitted payload is schema-valid ---------- */
  {
    const H = harness();
    H.biz('Acme');
    const a = (await call(H.R, 'POST', '/api/businesses/acme/agents', { role: 'research' })).json.agent;
    const t = H.task('acme', 'Scan');
    await call(H.R, 'POST', '/api/tasks/' + t.id + '/assign', { agentId: a.id });
    await call(H.R, 'POST', '/api/agents/' + a.id + '/status', { status: 'paused' });
    await call(H.R, 'PATCH', '/api/agents/' + a.id, { name: 'Scout' });
    await call(H.R, 'POST', '/api/businesses/acme/memory', { kind: 'decision', text: 'x', source: 'user' });
    await call(H.R, 'POST', '/api/businesses/acme/messages', { from: 'user', to: a.id, kind: 'note', body: 'hi' });

    for (const e of H.seen) {
      const v = EVENTS.validate(e.name, e.payload);
      A.ok(v.ok, 'emitted ' + e.name + ' is schema-valid (' + (v.errors || []).join('; ') + ')');
    }
    A.ok(H.seen.length >= 5, 'the flow emitted a real event stream');
    A.ok(H.seen.every(e => e.name.indexOf('agent.') === 0 || e.name.indexOf('business.memory.') === 0),
      'every event is in the Phase 3 namespace');

    const res = fakeRes();
    const row = H.R.routes.filter(r => r.rx === RX_BIZ_MEMORY)[0];
    await row.h(fakeReq('DELETE', '/api/businesses/acme/memory'), res, '/api/businesses/acme/memory'.match(RX_BIZ_MEMORY));
    A.eq(res.code, 405, 'an unsupported method on a known path is a 405');
  }

  /* ---------- index.js actually mounts this module ---------- */
  // A route module nobody mounts serves nothing — the same dead-code shape Phase 0 found in the seven
  // capability tools. These locks fail loudly if the wiring is ever dropped.
  {
    const host = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'index.js'), 'utf8');
    A.ok(/require\(['"]\.\/agent-routes\.js['"]\)/.test(host), 'index.js REQUIRES agent-routes.js');
    A.ok(/makeAgentRoutes\(\{/.test(host), 'index.js constructs the routes with its real stores');
    A.ok(/\.\.\.agentRoutes\.routes/.test(host), 'index.js spreads the agent route rows into ROUTES');
    A.ok(/require\(['"]\.\/business-agents-store\.js['"]\)/.test(host), 'index.js requires the agent registry store');
    A.ok(/require\(['"]\.\/business-memory\.js['"]\)/.test(host), 'index.js requires the memory store');
    A.ok(/require\(['"]\.\/agent-messages-store\.js['"]\)/.test(host), 'index.js requires the messages store');
    A.ok(/emit: \(name, payload\) => chanEmit\(name, payload\)/.test(host),
      'index.js injects the REAL chanEmit as the routes\' emit (a lazy wrapper — chanEmit is defined later in the file)');
    // the three durable files the stores persist to
    for (const f of ['agents.json', 'business-memory.json', 'agent-messages.json']) {
      A.ok(host.indexOf(f) >= 0, 'index.js persists to ' + f);
    }
  }

  A.report('agent-routes');
})();
