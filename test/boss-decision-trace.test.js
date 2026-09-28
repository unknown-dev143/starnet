'use strict';
/* test/boss-decision-trace.test.js — the DURABLE ASSIGNMENT DECISION TRACE (§20).

   WHY THIS SUITE EXISTS. The standalone tool this fork studied (a "boss-agent" coordinator) described its whole
   point in one sentence: "assigning work to an unregistered agent is refused, and the refusal itself is logged."
   The part worth porting was never the tool — its registry, its task table and its decision log all already
   exist here in deterministic form (business-agents-store / business-tasks-store / autonomy-ledger) — it was
   the GUARANTEE. And that guarantee was genuinely missing: agent-routes.js audited every SUCCESSFUL mutation
   (hire, fire, status, grants) and NOT ONE refusal, so a cross-business assignment answered 409 with an
   explanation that lived only in a response body. Once the tab closed, "why did nothing happen?" was
   unanswerable from the log.

   task-routes.js's header states the audit doctrine this follows — record what changed the shape of the work,
   not every keystroke — and a refusal is exactly that: it is the only durable evidence that the guard FIRED.

   The load-bearing assertions:
     · a refusal writes EXACTLY ONE row, with result 'refused' — never laundered into a generic 'error' — on the
       right business, with a reason naming the REAL cause;
     · the HTTP status is unchanged: the audit describes the decision, it does not make it;
     · a FAILING audit must not change the refusal (best-effort, no veto);
     · the row SURVIVES a reload from persisted bytes — durability, not merely an in-memory append;
     · the frontend's mirror of the result vocabulary still agrees with the sidecar's (two copies, one meaning);
     · every refusal exit in handleAssign audits before it returns — source-locked, and PROVEN to bite.

   Exercised through the REAL routes array with a copy of index.js's match loop, because index.js self-boots
   and cannot be require()d. */
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');

const { makeAgentRoutes } = require('../sidecar/agent-routes.js');
const { makeBusinessAgentsStore } = require('../sidecar/business-agents-store.js');
const { makeBusinessMemory } = require('../sidecar/business-memory.js');
const { makeAgentMessagesStore } = require('../sidecar/agent-messages-store.js');
const { makeBusinessesStore } = require('../sidecar/businesses-store.js');
const { makeBusinessTasksStore } = require('../sidecar/business-tasks-store.js');
const { makeBusinessActivityStore, RESULTS } = require('../sidecar/business-activity-store.js');

function fakeRes() {
  return {
    code: null, body: null,
    writeHead(c) { this.code = c; return this; },
    end(s) { this.body = s; }
  };
}
function fakeReq(method, url, body) {
  return { method, url, _body: body === undefined ? '' : JSON.stringify(body) };
}
async function readBody(req) { return req._body || ''; }

/* harness(extra) — the same shape test/agent-routes.test.js uses, plus a `sink` that records every array
   handed to persist(), so a "did it reach disk?" question is answered from the bytes and not from memory. */
function harness(extra) {
  const sink = [];
  const businesses = makeBusinessesStore({ records: [], persist: () => {}, now: () => 1000 });
  const agents = makeBusinessAgentsStore({ records: [], persist: () => {}, now: () => 1000 });
  const memory = makeBusinessMemory({ records: [], persist: () => {}, now: () => 1000 });
  const messages = makeAgentMessagesStore({ records: [], persist: () => {}, now: () => 1000 });
  const tasks = makeBusinessTasksStore({ records: [], persist: () => {}, now: () => 1000 });
  const actRecords = [];
  const activity = makeBusinessActivityStore({
    records: actRecords, now: () => 1000,
    persist: (rows) => { sink.push(rows); }
  });
  const R = makeAgentRoutes(Object.assign({
    agents, memory, messages, businesses, tasks, activity, readBody, emit: () => {}
  }, extra || {}));
  const biz = (name) => businesses.create({ name }).business;
  const task = (businessId, title) => tasks.create(businessId, { title }).task;
  const hire = (businessId, role) => agents.hire(businessId, { role: role || 'ceo' }).agent;
  return { businesses, agents, memory, messages, tasks, activity, actRecords, sink, R, biz, task, hire };
}

// dispatch exactly as index.js does: method gate, then the single match key, then h(req,res,gm).
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

async function main() {
  /* ---------- the vocabulary: a refusal is its own outcome, not a flavour of "error" ---------- */
  {
    A.ok(RESULTS.indexOf('refused') >= 0, "'refused' is a closed-vocabulary outcome of the activity store");
    const st = makeBusinessActivityStore({ records: [], now: () => 1 });
    A.ok(st.append('acme', { action: 'x', result: 'refused' }).ok, "the store accepts result 'refused'");
    const bad = st.append('acme', { action: 'x', result: 'probably-fine' });
    A.eq(bad.ok, false, 'an unknown result is still REFUSED — the vocabulary did not become free-text');
  }

  /* ---------- THE FRONTEND MIRROR: two copies, one meaning ----------
     frontend/app/businesscenter.js keeps its own RESULTS + RESULT_LABEL ("mirrored from the sidecar stores").
     A value added on one side and not the other renders as UNKNOWN in the UI while the log is perfectly
     correct — a drift that is invisible in both files and only shows up on screen. */
  {
    const BC = require('../frontend/app/businesscenter.js');
    A.eq(BC.RESULTS.slice().sort().join(','), RESULTS.slice().sort().join(','),
      'the frontend mirror of the result vocabulary matches the sidecar exactly');
    for (const r of RESULTS) {
      A.ok(BC.resultLabel(r) !== 'UNKNOWN', 'the frontend has a real label for "' + r + '"');
    }
    A.eq(BC.resultLabel('refused'), 'REFUSED', 'a refusal renders as REFUSED, not UNKNOWN');
  }

  /* ---------- P6: a refused cross-business assignment leaves a durable row ---------- */
  {
    const h = harness();
    const a = h.biz('Alpha');
    const b = h.biz('Beta');
    const agentB = h.hire(b.id, 'ceo');
    const t = h.task(a.id, 'Ship the thing');
    A.eq(h.activity.list(a.id).length, 0, 'the business starts with an empty log');

    const out = await call(h.R, 'POST', '/api/tasks/' + t.id + '/assign', { agentId: agentB.id });
    A.eq(out.code, 409, 'a cross-business assignment is still a 409');
    A.ok(/cross-business assignment is refused \(P6\)/.test(out.json.error), 'and the body still explains why');

    const rows = h.activity.list(a.id);
    A.eq(rows.length, 1, 'EXACTLY ONE durable row was written for the refusal');
    A.eq(rows[0].result, 'refused', "the row is recorded as 'refused', not 'error'");
    A.ok(rows[0].reason.indexOf(agentB.businessId) >= 0 && rows[0].reason.indexOf(a.id) >= 0,
      'the reason names BOTH businesses, so it says which side is wrong');
    A.ok(rows[0].detail.indexOf('task=' + t.id) >= 0 && rows[0].detail.indexOf('agent=' + agentB.id) >= 0,
      'the detail carries the task and agent ids, so the row is traceable back to the pair');
    A.eq(rows[0].businessId, a.id, 'the row belongs to the TASK business — the one the decision was about');
    A.eq(h.tasks.get(t.id).assignedAgent, '', 'the refusal did not half-apply: the task is still unassigned');
  }

  /* ---------- an unknown agent is refused AND logged ---------- */
  {
    const h = harness();
    const a = h.biz('Alpha');
    const t = h.task(a.id, 'Ship the thing');
    const out = await call(h.R, 'POST', '/api/tasks/' + t.id + '/assign', { agentId: 'ghost~a9' });
    A.eq(out.code, 404, 'assigning to an agent that does not exist is a 404');
    const rows = h.activity.list(a.id);
    A.eq(rows.length, 1, 'the unknown-agent refusal is logged too');
    A.eq(rows[0].result, 'refused', "and it is 'refused'");
    A.ok(/no such agent/.test(rows[0].reason), 'the reason names the actual cause, not a generic failure');
    A.ok(rows[0].reason.indexOf('ghost~a9') >= 0, 'and names the id that was asked for');
  }

  /* ---------- a SUCCESSFUL assignment is durable as well (the other half of the trace) ---------- */
  {
    const h = harness();
    const a = h.biz('Alpha');
    const agentA = h.hire(a.id, 'engineering');
    const t = h.task(a.id, 'Ship the thing');

    const ok = await call(h.R, 'POST', '/api/tasks/' + t.id + '/assign', { agentId: agentA.id });
    A.eq(ok.code, 200, 'a same-business assignment is 200');
    A.eq(h.tasks.get(t.id).assignedAgent, agentA.id, 'and it actually applied');

    const rows = h.activity.list(a.id);
    A.eq(rows.length, 1, 'the assignment wrote one row');
    A.eq(rows[0].result, 'ok', "recorded as 'ok'");
    A.ok(rows[0].action.indexOf(agentA.name) >= 0, 'the row names the agent it went to');
    A.ok(rows[0].action.indexOf('Ship the thing') >= 0, 'and the task it was about');

    // unassigning is a decision too — a trace that only records arrivals cannot explain a disappearance
    const cleared = await call(h.R, 'POST', '/api/tasks/' + t.id + '/assign', { agentId: '' });
    A.eq(cleared.code, 200, 'clearing the assignment is 200');
    const rows2 = h.activity.list(a.id);
    A.eq(rows2.length, 2, 'the unassignment wrote its own row');
    A.eq(rows2[0].result, 'ok', 'recorded as ok');
    A.ok(/Unassigned/.test(rows2[0].action), 'and says plainly that it was unassigned');
    A.eq(h.tasks.get(t.id).assignedAgent, '', 'the task really is unassigned');
  }

  /* ---------- DURABILITY: the row is on disk, not just in the array we happen to hold ---------- */
  {
    const h = harness();
    const a = h.biz('Alpha');
    const b = h.biz('Beta');
    const agentB = h.hire(b.id, 'ceo');
    const t = h.task(a.id, 'Ship the thing');
    await call(h.R, 'POST', '/api/tasks/' + t.id + '/assign', { agentId: agentB.id });

    A.ok(h.sink.length >= 1, 'the refusal reached the persist sink');
    const persisted = h.sink[h.sink.length - 1];
    A.eq(persisted.length, 1, 'one row was persisted');

    // rebuild a store from the PERSISTED bytes only — a fresh process would do exactly this
    const reloaded = makeBusinessActivityStore({ records: persisted.slice(), now: () => 1000 });
    const back = reloaded.list(a.id);
    A.eq(back.length, 1, 'the refused row survives a reload from persisted bytes');
    A.eq(back[0].result, 'refused', "and it is still 'refused' after the round trip");
    A.ok(/cross-business/.test(back[0].reason), 'and it still carries the reason');
  }

  /* ---------- a FAILING audit must never change the decision it describes ---------- */
  {
    // (a) a store whose persist throws — append() fails closed and returns ok:false
    const h = harness();
    const a = h.biz('Alpha');
    const b = h.biz('Beta');
    const agentB = h.hire(b.id, 'ceo');
    const t = h.task(a.id, 'Ship the thing');
    const throwing = makeBusinessActivityStore({ records: [], now: () => 1000, persist: () => { throw new Error('disk full'); } });
    const R2 = makeAgentRoutes({
      agents: h.agents, memory: h.memory, messages: h.messages, businesses: h.businesses,
      tasks: h.tasks, activity: throwing, readBody, emit: () => {}
    });
    const out = await call(R2, 'POST', '/api/tasks/' + t.id + '/assign', { agentId: agentB.id });
    A.eq(out.code, 409, 'a store that cannot persist the row does NOT turn the refusal into a success');
    A.eq(h.tasks.get(t.id).assignedAgent, '', 'and the task is still unassigned');

    // (b) an activity dependency that throws outright — the audit seam itself must swallow it
    const h3 = harness();
    const a3 = h3.biz('Alpha');
    const b3 = h3.biz('Beta');
    const agentB3 = h3.hire(b3.id, 'ceo');
    const t3 = h3.task(a3.id, 'Ship the thing');
    const R3 = makeAgentRoutes({
      agents: h3.agents, memory: h3.memory, messages: h3.messages, businesses: h3.businesses,
      tasks: h3.tasks, readBody, emit: () => {},
      activity: { append: () => { throw new Error('audit exploded'); } }
    });
    const out3 = await call(R3, 'POST', '/api/tasks/' + t3.id + '/assign', { agentId: agentB3.id });
    A.eq(out3.code, 409, 'a THROWING audit does not turn the refusal into a success either');
  }

  /* ---------- removing an agent that still holds work is refused AND logged ---------- */
  {
    const h = harness();
    const a = h.biz('Alpha');
    const agentA = h.hire(a.id, 'engineering');
    const t = h.task(a.id, 'Ship the thing');
    await call(h.R, 'POST', '/api/tasks/' + t.id + '/assign', { agentId: agentA.id });
    const before = h.activity.list(a.id).length;

    const del = await call(h.R, 'DELETE', '/api/agents/' + agentA.id);
    A.eq(del.code, 409, 'deleting an agent with assigned work is still a 409 (no orphans)');
    const rows = h.activity.list(a.id);
    A.eq(rows.length, before + 1, 'the orphan refusal wrote one row');
    A.eq(rows[0].result, 'refused', "recorded as 'refused'");
    A.ok(/task\(s\) assigned/.test(rows[0].reason), 'and the reason names the real cause');
    A.eq(h.agents.has(agentA.id), true, 'the agent was NOT removed');
  }

  /* ---------- headless: no activity dependency at all must not throw ---------- */
  {
    const h = harness();
    const a = h.biz('Alpha');
    const b = h.biz('Beta');
    const agentB = h.hire(b.id, 'ceo');
    const t = h.task(a.id, 'Ship the thing');
    const R4 = makeAgentRoutes({
      agents: h.agents, memory: h.memory, messages: h.messages, businesses: h.businesses,
      tasks: h.tasks, readBody, emit: () => {}
    });
    const out = await call(R4, 'POST', '/api/tasks/' + t.id + '/assign', { agentId: agentB.id });
    A.eq(out.code, 409, 'a boot with no activity store still refuses correctly (the audit is optional)');
  }

  /* ---------- SOURCE LOCK: every refusal exit in handleAssign audits before it returns ----------
     The behavioural blocks above only prove the paths a test happened to walk. This reads the source so a
     refusal added LATER without an audit row fails here rather than quietly reopening the hole. */
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'agent-routes.js'), 'utf8');
    const clean = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const start = clean.indexOf('async function handleAssign');
    A.ok(start >= 0, 'handleAssign was located in the source');
    // The boundary is "the next top-level function", found structurally — NOT by searching for a named
    // sibling. `handleBizMemory` is not `async`, so a search for 'async function handleBizMemory' silently
    // matched `handleBizMemoryWrite` instead and swallowed the whole memory section into this body.
    const rel = clean.slice(start + 20).search(/\n {2}(?:async )?function /);
    A.ok(rel > 0, 'the end of handleAssign was located');
    const body = clean.slice(start, start + 20 + rel);
    A.ok(body.indexOf('no such task') >= 0, 'the extracted body really is handleAssign');
    A.ok(body.indexOf('no such business') < 0, 'and it stops before the memory section');

    const exits = [];
    const re = /return json\(res, (4\d\d)/g;
    let m;
    while ((m = re.exec(body))) exits.push({ code: m[1], at: m.index });
    A.ok(exits.length >= 3, 'handleAssign has at least three 4xx refusal exits to lock');

    /* "This exit audits" must be bound to the exit, not to the neighbourhood. A fixed character window is a
       false negative waiting to happen: the 400 exit sits ~600 chars after the cross-business refusal, so a
       windowed scan sees THAT branch's auditDecision and calls the 400 covered. The precise test is positional
       — the nearest preceding auditDecision must come AFTER the previous return, i.e. inside this branch. */
    const unaudited = exits.filter(e => {
      const lastAudit = body.lastIndexOf('auditDecision(', e.at);
      // e.at is the index of this exit's OWN `return json(`, so the previous one must be searched before it.
      const prevReturn = body.lastIndexOf('return json(', e.at - 1);
      return !(lastAudit >= 0 && lastAudit > prevReturn);
    });
    A.eq(unaudited.length, 1,
      'exactly ONE 4xx exit is unaudited — the "no such task" 404, which names no business to log against');
    A.ok(body.slice(unaudited[0].at, unaudited[0].at + 160).indexOf('no such task') >= 0,
      'and that unaudited exit is the business-less one (if this moves, the audit coverage moved with it)');

    const audits = body.split('auditDecision(').length - 1;
    A.ok(audits >= 5, 'handleAssign audits both outcomes: the refusals AND the success (' + audits + ' calls)');

    // The best-effort guarantee lives in the `audit` seam auditDecision delegates to: a log that can veto a
    // decision is worse than no log at all, so the try/catch must stay between the caller and the store.
    const helperAt = clean.indexOf('function auditDecision');
    const helper = clean.slice(helperAt, helperAt + 700);
    A.ok(helperAt >= 0 && /\baudit\(/.test(helper), 'auditDecision delegates to the audit seam');
    const seamAt = clean.indexOf('function audit(');
    const seam = clean.slice(seamAt, seamAt + 300);
    A.ok(/try\s*\{/.test(seam), 'the audit seam is wrapped so a failing write cannot propagate');
  }

  A.report('boss-decision-trace.test');
}

main().then(() => {}, (e) => { console.error('THREW:', (e && e.stack) || e); A.report('boss-decision-trace.test'); });
