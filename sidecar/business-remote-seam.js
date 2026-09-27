/* sidecar/business-remote-seam.js — the §25 "architecture-ready" REMOTE BINDING SEAM.

   WHY THIS FILE EXISTS SEPARATELY. The brief (§27 Remote Monitoring) says "Eventually let the user
   monitor SpaceStation remotely". "Eventually" is the whole point: the requirement is that the product is
   READY for it — the seam is contracted, documented and test-locked — WITHOUT shipping a second network
   listener, a second auth path, or a half-built remote workstation. §28 is explicit: implement
   incrementally; do not rewrite or over-build.

   WHAT IS DELIBERATELY NOT BUILT:
     - no listener. This module opens NO socket. It describes the binding a future transport must satisfy.
     - no second auth. Every /api/* route is already behind apiauth.js's per-launch token. A remote
       transport would need a decision about token lifetime + scope, which is a PRODUCT decision, not a
       thing to guess here. So the seam REFUSES to activate until a concrete transport is supplied.
     - no mutation. The remote surface is read-only by design (the brief: monitoring + approvals). Approve /
       reject stay on the existing guarded routes; a remote client calls THOSE, with their existing auth.

   HOW IT STAYS HONEST. `status()` never claims the interface is live. Until `attach()` is handed a real
   transport it reports `{ bound: false, reason: ... }`, and `gate()` returns a refusal naming exactly what
   is missing. A test source-locks that the seam cannot bind without an explicit transport (see
   test/business-remote-seam.test.js) — so a future edit that quietly turns the remote interface ON fails
   the gate instead of shipping an unauthenticated listener.

   THE CONTRACT A FUTURE TRANSPORT MUST SATISFY (documented here so the decision has one home):
     1. TRANSPORT  — supply `attach(transport)`, where transport = { publish(snapshot), onDecision(fn) }.
     2. AUTH       — the transport must carry its own credential story. The per-launch /api token is
                     deliberately short-lived and process-scoped; reusing it for remote access is a
                     decision, not a default.
     3. SCOPE      — read model only (business-remote.js). Writes go through the existing approved routes.
     4. EXPOSURE   — a remote interface widens the attack surface; it must be opt-in per install, never
                     on by default.

   DETERMINISM: no clock, no rng, no env. */

'use strict';

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else { (root.SK = root.SK || {}).businessRemoteSeam = factory(); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* The four things a transport must bring. Exported as DATA so the requirement is inspectable (and so a
     test can assert the list did not shrink silently). */
  const REQUIREMENTS = [
    { id: 'transport', need: 'an attach(transport) binding — publish(snapshot) + onDecision(fn)' },
    { id: 'auth', need: 'a credential story for remote access (the per-launch /api token is process-scoped)' },
    { id: 'scope', need: 'read model only — approvals decisions reuse the existing guarded routes' },
    { id: 'exposure', need: 'opt-in per install; never on by default' }
  ];

  /* makeRemoteSeam({ readModel, isEnabled }) — isEnabled is the install-level switch. It DEFAULTS to
     false and must be an explicit boolean true to arm the seam; anything else (undefined, a string, an
     env var read as a string) leaves it disarmed. That strictness is the point: a remote interface must
     be turned on deliberately. */
  function makeRemoteSeam(opts) {
    opts = opts || {};
    const readModel = opts.readModel || null;
    const isEnabled = opts.isEnabled === true;      // === true, never truthy
    let transport = null;

    function status() {
      if (!isEnabled) {
        return { bound: false, enabled: false, transport: null,
          reason: 'remote interface is disabled by default — set the install switch to enable (see REQUIREMENTS)' };
      }
      if (!transport) {
        return { bound: false, enabled: true, transport: null,
          reason: 'enabled but no transport attached — call attach(transport) to bind' };
      }
      return { bound: true, enabled: true, transport: transport.name || 'unnamed', reason: null };
    }

    /* attach — the ONLY way to bind. Throws on a disarmed seam and on a transport missing its halves, so a
       misconfiguration surfaces loudly instead of producing a listener that publishes nothing. */
    function attach(t) {
      if (!isEnabled) throw new Error('remote seam is disabled — enable it before attaching a transport');
      if (!t || typeof t.publish !== 'function' || typeof t.onDecision !== 'function') {
        throw new Error('a remote transport must supply publish(snapshot) and onDecision(fn)');
      }
      transport = t;
      return status();
    }

    /* gate — the refusal a caller sees when it tries to USE the remote interface before it is armed. It
       never fabricates a snapshot; it returns what is missing. */
    function gate() {
      const s = status();
      if (!s.bound) return { ok: false, reason: s.reason, missing: missing() };
      return { ok: true };
    }

    // which REQUIREMENTS are still unsatisfied (transport binding is the only one the seam can observe).
    function missing() {
      const out = [];
      if (!isEnabled) out.push('exposure');
      if (!transport) out.push('transport', 'auth', 'scope');
      return Array.from(new Set(out));
    }

    /* publishOnce — hand the CURRENT read model to the transport, if bound. Read-only: it never mutates a
       store, and returns a refusal (not a throw) when unbound so a caller can fall back to local UI. */
    function publishOnce(o) {
      const g = gate();
      if (!g.ok) return g;
      if (!readModel || typeof readModel.summary !== 'function') {
        return { ok: false, reason: 'no read model wired to the seam' };
      }
      const snap = readModel.summary(o || {});
      try { transport.publish(snap); }
      catch (e) { return { ok: false, reason: 'transport.publish threw: ' + String(e && e.message || e) }; }
      return { ok: true, at: snap.at };
    }

    return { status, attach, gate, missing, publishOnce };
  }

  return { makeRemoteSeam, REQUIREMENTS };
});
