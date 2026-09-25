#!/usr/bin/env node
// business-os-hardening-audit.mjs — the Phase 8 (Hardening) gate for the Business OS.
//
// Runs a consolidated audit across the ten master-prompt §30 / §417 hardening dimensions and prints a
// PASS/FAIL scorecard. Exits non-zero if any check fails, so it can be wired into the release gate.
//
// It loads the REAL Business OS modules (apiauth, business-permissions, businesses-store,
// business-agents-store, business-automation-engine) plus a source-level scan of the business route
// tables, exactly like test/business-os-hardening.test.js but as a standalone gate that needs no test
// harness. Pair it with: `node scripts/business-os-hardening-audit.mjs`.

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = dirname(dirname(fileURLToPath(import.meta.url))); // starnet/
const sidecar = (p) => require(join(ROOT, 'sidecar', p));
const shared = (p) => require(join(ROOT, 'shared', p));

const apiauth = sidecar('apiauth.js');
const BP = sidecar('business-permissions.js');
const { makeBusinessesStore } = sidecar('businesses-store.js');
const { makeBusinessAgentsStore } = sidecar('business-agents-store.js');
const { makeBusinessAutomationEngine, MAX_DEPTH, MAX_RUNS_PER_PASS } = sidecar('business-automation-engine.js');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; failures.push(name + (detail ? ' — ' + detail : '')); console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('\nBusiness OS — Phase 8 Hardening Audit');
console.log('======================================\n');

// 1. AUTH — every business path gated; constant-time compare; origin/host pinning.
console.log('1) Auth testing');
check('business routes require an API token', apiauth.requiresApiToken({ url: '/api/businesses' }) && apiauth.requiresApiToken({ url: '/api/businesses/acme' }));
check('liveness probe is exempt', apiauth.requiresApiToken({ url: '/api/health' }) === false);
check('constant-time compare rejects wrong token', apiauth.constTimeEq('a', 'b') === false && apiauth.constTimeEq('a', 'a') === true);
check('foreign origin is rejected', apiauth.isAllowedApiOrigin('http://evil.example.com', 1234) === false && apiauth.isAllowedApiOrigin('http://127.0.0.1:1234', 1234) === true);
check('foreign host is rejected', apiauth.isAllowedHost('evil.com') === false && apiauth.isAllowedHost('127.0.0.1') === true);

// 2. PERMISSION AUDIT — §13 hard floor.
console.log('\n2) Permission audit (§13)');
check('unclassified action is treated restricted', BP.classify('nope_not_real').ok === false && BP.classify('nope_not_real').tier === 'restricted');
check('sanitizeGrants forces restricted:false', BP.sanitizeGrants({ safe: true, review: true, restricted: true }).restricted === false);
check('restricted action never auto-runs', BP.decide({ action: 'delete_data' }).allow === false);
check('review action needs the grant', BP.decide({ action: 'spend_money' }).allow === false && BP.decide({ action: 'spend_money', grants: { safe: true, review: true, restricted: false } }).allow === true);
check('proposed action needs evidence', BP.proposedAction({ what: 'x', why: 'y' }).ok === false && BP.proposedAction({ what: 'x', why: 'y', evidence: [{ text: 'z', evidence: 'verified' }], risk: 'low', action: 'research' }).ok === true);

// 3. DATA ISOLATION — businesses-store namespace (P6).
console.log('\n3) Data-isolation testing (P6)');
check('memoryNamespace prefixes the business', makeBusinessesStore({}).memoryNamespace('alpha') === 'biz:alpha');
check('two businesses never share a namespace', makeBusinessesStore({}).memoryNamespace('alpha') !== makeBusinessesStore({}).memoryNamespace('beta'));
{
  const s = makeBusinessesStore({ persist: () => {} });
  s.create({ name: 'Acme' }); s.create({ name: 'Globex' });
  check('exact-id read isolation', s.get('acme') && s.get('acme').id === 'acme' && s.get('globex') && s.get('ghost') === null);
}

// 4. AGENT BOUNDARY — agents never leak across businesses.
console.log('\n4) Agent-boundary testing (P6)');
{
  const agents = makeBusinessAgentsStore({
    records: [
      { id: 'A~a1', seq: 1, businessId: 'A', role: 'researcher', specialty: 'x', name: 'R', status: 'idle', grants: { safe: true, review: false, restricted: false }, hiredBy: 'user', createdAt: 1, updatedAt: 1 },
      { id: 'B~a1', seq: 1, businessId: 'B', role: 'researcher', specialty: 'x', name: 'R', status: 'idle', grants: { safe: true, review: false, restricted: false }, hiredBy: 'user', createdAt: 1, updatedAt: 1 }
    ], persist: () => {}
  });
  check('agent list is scoped per-business', agents.list('A').length === 1 && agents.list('B').length === 1 && !agents.list('A').some(a => a.id === 'B~a1'));
  check('agent memory namespace is business-prefixed', agents.memoryNamespace('A~a1') === 'biz:A:agent:A~a1');
  check('unknown agent is denied (fail-closed)', agents.decide('ghost', 'research').allow === false);
}

// 5/6/7. FAILURE / API-FAILURE / AUTOMATION-SAFETY — exercised through a minimal engine.
console.log('\n5/6/7) Failure · API-failure · Automation-safety');
{
  const businesses = makeBusinessesStore({ records: [{ id: 'A', name: 'A', stage: 'live', template: 'custom', createdBy: 'user', createdAt: 1, updatedAt: 1 }], persist: () => {} });
  const counts = { approvalCalls: 0, projectCalls: 0, taskCalls: 0 };
  const engine = makeBusinessAutomationEngine({
    automation: {
      matching: (bid, name) => (name === 'business.created' && bid === 'A' ? [{ id: 'r1', name: 'r1', trigger: 'business.created', enabled: true, conditions: [], actions: [{ action: 'create_project', params: { name: 'p' } }] }] : []),
      canFire: () => ({ ok: true }),
      recordRun: () => ({ ok: true, autoDisabled: false, automation: { disabledReason: '' } }),
      get: () => null
    },
    approvals: { create: () => { counts.approvalCalls++; return { ok: true, approval: { id: 'ap' } }; }, get: () => null, decide: () => ({ ok: true, approval: {} }) },
    permissions: BP, businesses,
    projects: { create: () => { counts.projectCalls++; return { ok: true, project: { id: 'pr' } }; } },
    emit: () => {}, now: () => 1000
  });
  check('tierOf derives review for spend_money', engine.tierOf('spend_money') === 'review');
  check('tierOf treats an unknown automation action as restricted', engine.tierOf('delete_data') === 'restricted');
  const out = engine.handleEvent('business.created', { businessId: 'A' });
  check('a safe automation action runs', counts.projectCalls >= 1 && out.ran >= 1);
  check('a store failure does not crash the engine', (() => { try { engine.executeAction('A', 'create_task', { title: 't' }, 0); return true; } catch (_) { return false; } })());
  const ext = engine.executeAction('A', 'spend_money', { amount: 1, currency: 'USD', description: 'x' });
  check('external spend claims no delivery (no fake send)', ext.ok === true && ext.delivered === false && ext.external === true);
  engine.halt();
  const blocked = engine.handleEvent('business.created', { businessId: 'A' });
  check('§19 E-STOP halts the hub', blocked.ok === false && /halt/i.test(blocked.reason));
}

// 8. BACKUP / RECOVERY — durability + corruption resilience.
console.log('\n8) Backup / recovery testing');
{
  const disk = [];
  const w = makeBusinessesStore({ persist: (rows) => { disk.length = 0; for (const r of rows) disk.push(r); }, now: () => 1 });
  w.create({ name: 'Acme' });
  check('create is persisted to durable storage', disk.length === 1);
  const reloaded = makeBusinessesStore({ records: disk, persist: () => {}, now: () => 2 });
  check('reload from durable storage recovers the business', reloaded.get('acme') && reloaded.get('acme').name === 'Acme');
  let crashed = null;
  try { makeBusinessesStore({ records: [{ id: 'ok', name: 'OK', stage: 'idea', template: 'custom', createdBy: 'user', createdAt: 1, updatedAt: 1 }, { name: 'broken-no-id' }], persist: () => {} }).list(); }
  catch (e) { crashed = e; }
  check('a malformed record does not crash reads', crashed === null);
}

// 9. PERFORMANCE — scaling correctness.
console.log('\n9) Performance testing');
{
  const s = makeBusinessesStore({ persist: () => {} });
  const t0 = Date.now();
  for (let i = 0; i < 300; i++) s.create({ name: 'Biz ' + i });
  const elapsed = Date.now() - t0;
  check('300 businesses list complete + exact lookup', s.list().length === 300 && s.get('biz-299') && s.get('biz-0'));
  check('bulk create+list completes without gross regression', elapsed < 10000, elapsed + 'ms');
}

// 10. SECURITY AUDIT — no secret fields, privacy headers, token gating, route-table trap.
console.log('\n10) Security audit');
{
  const s = makeBusinessesStore({ persist: () => {} });
  const b = s.create({ name: 'Acme' }).business;
  const SECRET = ['token', 'secret', 'password', 'apikey', 'api_key', 'privatekey'];
  check('business entity carries no secret field', !Object.keys(b).some(k => SECRET.indexOf(k.toLowerCase()) >= 0));
  const routeFiles = ['business-routes', 'maker-routes', 'task-routes', 'agent-routes', 'manager-routes', 'automation-routes', 'worker-routes'];
  let trap = false;
  for (const f of routeFiles) {
    const lines = readFileSync(join(ROOT, 'sidecar', f + '.js'), 'utf8').split('\n');
    if (lines.some(l => /qrx\s*:/.test(l) && /\(/.test(l))) trap = true;
  }
  check('no business route uses a qrx matcher that captures a path segment', trap === false);
  check('cascade guards exist (MAX_DEPTH/MAX_RUNS_PER_PASS)', typeof MAX_DEPTH === 'number' && typeof MAX_RUNS_PER_PASS === 'number' && MAX_DEPTH >= 1 && MAX_RUNS_PER_PASS >= 1);
}

console.log('\n--------------------------------------');
console.log('  ' + pass + ' passed, ' + fail + ' failed');
console.log('--------------------------------------\n');
if (fail > 0) { console.error('HARDENING AUDIT FAILED:\n - ' + failures.join('\n - ')); process.exit(1); }
console.log('Business OS hardening audit: OK');
