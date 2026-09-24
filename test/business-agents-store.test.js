'use strict';
/* test/business-agents-store.test.js — the §7 agent registry.

   The load-bearing properties:
     · an agent is a CONFIGURATION (§7): a role + one of that role's real classes + a permission set + a
       context scope. It has no private goals and nothing here schedules it (P7);
     · businessId is REQUIRED and is part of the id — two businesses cannot collide (P6);
     · the specialty MUST be one of the classes the role names, which is what keeps "role" meaningful;
     · `restricted` is forced false on hire AND on every grant update, so no stored row can make a restricted
       action autonomous;
     · persist-before-commit on every write path (fail-closed). */
const A = require('./_assert.js');
const { makeBusinessAgentsStore, STATUSES } = require('../sidecar/business-agents-store.js');

function store(extra) {
  const saved = [];
  const s = makeBusinessAgentsStore(Object.assign({ records: [], persist: (rows) => { saved.length = 0; for (const r of rows) saved.push(r); }, now: () => 1000 }, extra || {}));
  return { s, saved };
}

/* ---------- the four statuses (§19 pauses an individual agent) ---------- */
{
  A.eq(STATUSES, ['idle', 'working', 'paused', 'disabled'], 'an agent has the four lifecycle statuses');
}

/* ---------- hire: required fields, role bridge, defaults ---------- */
{
  const { s } = store();
  A.eq(s.hire('', { role: 'ceo' }).ok, false, 'a hire with no businessId is REFUSED');
  A.ok(/never implied/.test(s.hire('', { role: 'ceo' }).reason), 'and says why');
  A.eq(s.hire('acme', {}).ok, false, 'a hire with no role is refused');
  A.ok(/unknown role/.test(s.hire('acme', { role: 'nope' }).reason), 'an unknown role is refused');
  A.ok(s.hire('acme', { role: 'nope' }).reason.indexOf('ceo') >= 0, 'and the refusal lists the real roles');

  const h = s.hire('acme', { role: 'ceo' });
  A.ok(h.ok, 'a minimal hire succeeds');
  A.eq(h.agent.role, 'ceo', 'the role is recorded');
  A.eq(h.agent.specialty, 'strategist', 'the specialty defaults to the role\'s first class');
  A.eq(h.agent.name, 'Strategist', 'the name defaults to the class name');
  A.eq(h.agent.status, 'idle', 'a new agent starts idle');
  A.eq(h.agent.id, 'acme~a1', 'the id is <businessId>~a<seq>');
  A.eq(h.agent.businessId, 'acme', 'the business is recorded');
  A.eq(h.agent.hiredBy, 'user', 'provenance defaults to the user');
  A.eq(h.agent.grants, { safe: true, review: false, restricted: false }, 'a new agent may run safe actions only');
}

/* ---------- the specialty MUST fill the role ---------- */
{
  const { s } = store();
  A.eq(s.hire('acme', { role: 'ceo', specialty: 'engineer' }).ok, false, 'a class that does not fill the role is refused');
  A.ok(/cannot fill the CEO role/.test(s.hire('acme', { role: 'ceo', specialty: 'engineer' }).reason), 'the refusal names the role');
  A.ok(s.hire('acme', { role: 'ceo', specialty: 'engineer' }).reason.indexOf('strategist') >= 0, 'and lists the classes that CAN');
  A.ok(s.hire('acme', { role: 'ceo', specialty: 'chief' }).ok, 'the role\'s second class is accepted');
  A.ok(s.hire('acme', { role: 'engineering', specialty: 'engineer' }).ok, 'an engineering role takes the engineer class');
}

/* ---------- P6: businesses do not collide ---------- */
{
  const { s } = store();
  s.hire('acme', { role: 'ceo' });
  s.hire('acme', { role: 'research' });
  s.hire('beta', { role: 'ceo' });
  A.eq(s.list('acme').length, 2, 'acme sees only its own two agents');
  A.eq(s.list('beta').length, 1, 'beta sees only its own one');
  A.eq(s.list('acme').map(a => a.id), ['acme~a1', 'acme~a2'], 'acme ids are per-business sequential');
  A.eq(s.list('beta')[0].id, 'beta~a1', 'beta numbering restarts — ids cannot collide across businesses');
  A.eq(s.list('').length, 0, 'an empty businessId lists nothing, never everything');
  A.eq(s.count('acme'), 2, 'count is per business');
  A.eq(s.byRole('acme', 'ceo').length, 1, 'byRole filters within a business');
}

/* ---------- the context scope ---------- */
{
  const { s } = store();
  const a = s.hire('acme', { role: 'ceo' }).agent;
  const b = s.hire('beta', { role: 'ceo' }).agent;
  A.eq(s.memoryNamespace(a.id), 'biz:acme:agent:acme~a1', 'the namespace prefixes the BUSINESS before the agent');
  A.eq(s.memoryNamespace(b.id), 'biz:beta:agent:beta~a1', 'so two businesses\' researchers never share a namespace');
  A.eq(s.memoryNamespace('nope'), '', 'an unknown agent has no namespace');
}

/* ---------- grants: restricted is never granted ---------- */
{
  const { s } = store();
  const a = s.hire('acme', { role: 'finance', grants: { safe: true, review: true, restricted: true } }).agent;
  A.eq(a.grants, { safe: true, review: true, restricted: false }, 'restricted is stripped even at hire time');

  const g = s.setGrants(a.id, { restricted: true });
  A.ok(g.ok, 'the grant update succeeds');
  A.eq(g.agent.grants.restricted, false, 'restricted stays false after an update');
  A.eq(g.agent.grants.review, true, 'the other tiers are preserved by the merge');
  A.eq(s.setGrants(a.id, { safe: false }).agent.grants, { safe: false, review: true, restricted: false }, 'a partial update merges over the current grants');
}

/* ---------- the per-agent permission decision uses the agent's OWN grants ---------- */
{
  const { s } = store();
  const a = s.hire('acme', { role: 'research' }).agent;
  A.eq(s.decide(a.id, 'research').allow, true, 'a safe action is allowed by default');
  A.eq(s.decide(a.id, 'spend_money').allow, false, 'a review action is refused by default');
  s.setGrants(a.id, { review: true });
  A.eq(s.decide(a.id, 'spend_money').allow, true, 'and allowed once the agent is granted review');
  A.eq(s.decide(a.id, 'delete_data').allow, false, 'but a restricted action stays refused');
  A.eq(s.decide('nope', 'research').allow, false, 'an unknown agent is denied (fail-closed)');
}

/* ---------- update: whitelisted fields, immutables ---------- */
{
  const { s } = store();
  const a = s.hire('acme', { role: 'ceo' }).agent;
  const up = s.update(a.id, { name: 'Nova' });
  A.ok(up.ok, 'a rename succeeds');
  A.eq(up.agent.name, 'Nova', 'the name changed');
  A.eq(up.agent.id, a.id, 'the id is immutable — a rename never re-keys the agent');
  A.eq(up.agent.businessId, a.businessId, 'the business is immutable');
  A.eq(up.agent.createdAt, a.createdAt, 'createdAt is immutable');
  A.eq(s.update(a.id, { name: '  ' }).ok, false, 'a blank name is refused');
  A.eq(s.update('nope', { name: 'x' }).ok, false, 'an unknown agent is refused');
  A.eq(s.update(a.id, { status: 'nope' }).ok, false, 'an unknown status is refused');

  // re-roling re-validates the specialty against the NEW role.
  A.eq(s.update(a.id, { role: 'engineering' }).agent.specialty, 'engineer', 'a re-role adopts the new role\'s default class');
  A.eq(s.update(a.id, { role: 'marketing', specialty: 'engineer' }).ok, false, 'and a class that does not fit the new role is refused');

  A.ok(s.setStatus(a.id, 'paused').ok, '§19 can pause an individual agent');
  A.eq(s.get(a.id).status, 'paused', 'and the status sticks');
}

/* ---------- remove ---------- */
{
  const { s } = store();
  const a = s.hire('acme', { role: 'ceo' }).agent;
  A.eq(s.remove(a.id), { ok: true }, 'removing a real agent succeeds');
  A.eq(s.get(a.id), null, 'and it is gone');
  A.eq(s.remove('nope'), { ok: true }, 'removing an unknown agent is a no-op success');
  A.eq(s.has(a.id), false, 'has() agrees');
}

/* ---------- persist-before-commit on EVERY write path ---------- */
{
  let failNext = false;
  const s = makeBusinessAgentsStore({ records: [], persist: () => { if (failNext) throw new Error('disk full'); }, now: () => 1000 });
  const a = s.hire('acme', { role: 'ceo' }).agent;
  A.ok(!!a, 'the first hire commits');
  failNext = true;
  A.eq(s.hire('acme', { role: 'research' }).ok, false, 'a hire whose persist throws is refused');
  A.eq(s.count('acme'), 1, 'and the agent was never committed');
  A.eq(s.update(a.id, { name: 'X' }).ok, false, 'an update whose persist throws is refused');
  A.eq(s.get(a.id).name, 'Strategist', 'and the old name is kept');
  A.eq(s.setStatus(a.id, 'paused').ok, false, 'a status change whose persist throws is refused');
  A.eq(s.get(a.id).status, 'idle', 'and the old status is kept');
  A.eq(s.setGrants(a.id, { review: true }).ok, false, 'a grant change whose persist throws is refused');
  A.eq(s.get(a.id).grants.review, false, 'and the old grants are kept');
  A.eq(s.remove(a.id).ok, false, 'a removal whose persist throws is refused');
  A.eq(s.count('acme'), 1, 'and the agent is kept');
}

/* ---------- determinism ---------- */
{
  const { s } = store();
  s.hire('acme', { role: 'ceo' });
  s.hire('acme', { role: 'research' });
  A.eq(s.list('acme'), s.list('acme'), 'list() is stable across calls');
  A.eq(s.list('acme').map(x => x.id), ['acme~a1', 'acme~a2'], 'ids are a deterministic per-business sequence, not a random token');
  const seat = s.resolveSeat('qa', null);
  A.eq(seat.specialty, 'apptester', 'resolveSeat defaults to the role\'s first class');
  A.eq(s.resolveSeat('nope', null).ok, false, 'resolveSeat refuses an unknown role');
}

A.report('business-agents-store');
