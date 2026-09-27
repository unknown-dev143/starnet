'use strict';
/* business-remote-seam.test.js — §25's REMOTE BINDING SEAM (Business OS).

   The seam is the "architecture-ready" half of §25: the product must be READY for remote monitoring
   WITHOUT shipping an unauthenticated listener. So the risk this suite guards is specific — a future edit
   that quietly turns the remote interface ON, or binds it without a transport. Every assertion is about the
   seam refusing to be armed by accident.

     • it is DISABLED by default and `isEnabled` must be the literal `true`
     • it opens no listener (source-locked: no createServer / listen / ws / http in the module)
     • attach() throws on a disarmed seam and on a malformed transport
     • status() never claims bound:true until a real transport is attached
     • the REQUIREMENTS list cannot shrink silently (the contract a transport must satisfy)               */

const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const { makeRemoteSeam, REQUIREMENTS } = require('../sidecar/business-remote-seam.js');
const { makeRemoteReadModel } = require('../sidecar/business-remote.js');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'business-remote-seam.js'), 'utf8');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const NOW = 1000000000000;

function mkModel() {
  return makeRemoteReadModel({ now: () => NOW, businesses: { list: () => [], get: () => null },
    approvals: { OPEN_STATUS: 'pending', pendingCount: () => 0, list: () => [], summary: () => ({}), pendingBusinessIds: () => [] },
    activity: { recent: () => [], list: () => [] }, finance: { totals: () => ({ byCurrency: {} }) }, workOrders: { list: () => [] } });
}

/* ---------- the contract is data, and it names the four requirements ---------- */
{
  A.eq(REQUIREMENTS.length, 4, 'four requirements');
  const ids = REQUIREMENTS.map(r => r.id).sort();
  A.eq(JSON.stringify(ids), JSON.stringify(['auth', 'exposure', 'scope', 'transport']),
    'transport, auth, scope and exposure are all named');
  for (const r of REQUIREMENTS) A.ok(r.need && r.need.length > 0, r.id + ' explains what it needs');
}

/* ---------- DISABLED BY DEFAULT ---------- */
{
  const seam = makeRemoteSeam({ readModel: mkModel() });
  const s = seam.status();
  A.eq(s.enabled, false, 'a seam with no isEnabled is DISABLED');
  A.eq(s.bound, false, 'and unbound');
  A.ok(/disabled by default/.test(s.reason), 'and says so');
}
/* only the LITERAL true arms it — a truthy string does not */
{
  for (const v of ['1', 'true', 'yes', 1, {}, []]) {
    const seam = makeRemoteSeam({ readModel: mkModel(), isEnabled: v });
    A.eq(seam.status().enabled, false, 'a non-literal-true isEnabled (' + JSON.stringify(v) + ') leaves the seam disabled');
  }
  const armed = makeRemoteSeam({ readModel: mkModel(), isEnabled: true });
  A.eq(armed.status().enabled, true, 'the literal true arms it');
}

/* ---------- attach() refuses to bind a disarmed seam ---------- */
{
  const seam = makeRemoteSeam({ readModel: mkModel() });
  A.throws(() => seam.attach({ publish: () => {}, onDecision: () => {} }),
    'attaching to a DISABLED seam throws rather than binding');
}
/* attach() refuses a malformed transport even when armed */
{
  const seam = makeRemoteSeam({ readModel: mkModel(), isEnabled: true });
  A.throws(() => seam.attach(null), 'a null transport is refused');
  A.throws(() => seam.attach({}), 'a transport with no halves is refused');
  A.throws(() => seam.attach({ publish: () => {} }), 'a transport with no onDecision is refused');
  A.throws(() => seam.attach({ onDecision: () => {} }), 'a transport with no publish is refused');
  A.eq(seam.status().bound, false, 'none of those bound the seam');
}
/* a well-formed transport binds, and ONLY then does bound become true */
{
  const seam = makeRemoteSeam({ readModel: mkModel(), isEnabled: true });
  const st = seam.attach({ name: 'ok', publish: () => {}, onDecision: () => {} });
  A.eq(st.bound, true, 'a well-formed transport binds');
  A.eq(seam.status().bound, true, 'and status agrees');
  A.eq(seam.status().transport, 'ok', 'naming it');
}

/* ---------- publishOnce: read-only, and refuses when unbound ---------- */
{
  const seam = makeRemoteSeam({ readModel: mkModel() });
  const r = seam.publishOnce({});
  A.eq(r.ok, false, 'publishing on a disarmed seam is refused');
  A.ok(Array.isArray(r.missing), 'and names what is missing');
}
{
  let published = null;
  const seam = makeRemoteSeam({ readModel: mkModel(), isEnabled: true });
  seam.attach({ name: 'cap', publish: (s) => { published = s; }, onDecision: () => {} });
  const r = seam.publishOnce({});
  A.eq(r.ok, true, 'a bound seam publishes');
  A.eq(r.at, NOW, 'and reports the snapshot time');
  A.ok(published && published.at === NOW, 'the transport received the snapshot');
  A.ok(published && Array.isArray(published.sections), 'and it is the real read model output');
}
/* a throwing transport is reported, never propagated as a crash */
{
  const seam = makeRemoteSeam({ readModel: mkModel(), isEnabled: true });
  seam.attach({ name: 'bad', publish: () => { throw new Error('pipe broke'); }, onDecision: () => {} });
  const r = seam.publishOnce({});
  A.eq(r.ok, false, 'a throwing transport is a refusal, not a throw');
  A.ok(/pipe broke/.test(r.reason), 'with the reason');
}

/* ---------- NO LISTENER: source-locked ---------- */
{
  for (const tok of ['createServer', 'http.createServer', '.listen(', 'new WebSocket', 'require(\'ws\')', 'net.createServer', 'http2']) {
    A.ok(CODE.indexOf(tok) < 0, 'the seam never opens a listener: ' + tok);
  }
  A.ok(CODE.indexOf('require(') < 0, 'the seam requires nothing — no transport is bundled');
  A.ok(!/\bDate\.now\b/.test(CODE), 'no ambient clock');
  A.ok(!/\bMath\.random\b/.test(CODE), 'no rng');
}

A.report('business-remote-seam');
