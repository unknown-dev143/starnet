/* sidecar/business-agents-store.js — the AI BUSINESS TEAM agent registry (master prompt §7).

   One row per agent a business has hired. §7 says each agent has an explicit "role, tools, permissions, and
   scoped context" — this store owns the ROLE, the PERMISSIONS and the CONTEXT SCOPE, and points at the tools
   rather than copying them:

     role      — one of §7's twelve, from shared/business-roles.js (the bridge, not a second catalog).
     specialty — the concrete SharedSpecialties class filling the role. It must be one of the classes the role
                 names, which is what keeps "role" meaningful instead of decorative. The class's own kit /
                 skills / persona / model tier stay owned by specialties.js and are NOT duplicated here.
     grants    — the §13 tier grants, sanitised by business-permissions.js. `restricted` is forced false, so
                 no stored row can make a restricted action autonomous.
     context   — memoryNamespace(id) -> 'biz:<businessId>:agent:<agentId>', the key the memory store uses.

   P7 — NO FAKE INDEPENDENT INTELLIGENCE. An agent here is a CONFIGURATION, not a mind. It has no private
   goals, no free-running loop, and nothing in this store schedules or invokes it. It is the same object the
   station already knows how to summon, wearing a business role and a permission set — which is exactly what
   §7 asks for and exactly as much as it asks for.

   ISOLATION (P6). businessId is REQUIRED on hire and is part of the agent id, so two businesses cannot
   collide, and memoryNamespace() prefixes the business before the agent. `list` never returns across
   businesses.

   PURE: no IO, no clock, no env, no rng. Deterministic ids (per-business sequence, not a random token).
   Persist-before-commit (fail-closed). UMD. */

'use strict';
(function (root, factory) {
  const roles = (typeof module !== 'undefined' && module.exports)
    ? require('../shared/business-roles.js')
    : (root.SharedBusinessRoles || { ROLES: [], ROLE_IDS: [], byId: () => null, specialtiesFor: () => [], defaultSpecialty: () => null, specialtyLabel: () => '', unresolved: () => [] });
  const perms = (typeof module !== 'undefined' && module.exports)
    ? require('./business-permissions.js')
    : ((root.SK && root.SK.businessPermissions) || { DEFAULT_GRANTS: { safe: true, review: false, restricted: false }, sanitizeGrants: (g) => g || { safe: true, review: false, restricted: false }, decide: () => ({ allow: false, approval: 'required' }) });
  const api = factory(roles, perms);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).businessAgentsStore = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (BusinessRoles, BusinessPermissions) {
  'use strict';

  // §19 lets the Commander pause an INDIVIDUAL agent, which is why 'paused' is a status and not a flag.
  const STATUSES = ['idle', 'working', 'paused', 'disabled'];

  const MAX_NAME = 120;
  const MAX_ID = 120;

  function makeBusinessAgentsStore(opts) {
    opts = opts || {};
    const records = Array.isArray(opts.records) ? opts.records : [];
    const persist = typeof opts.persist === 'function' ? opts.persist : null;
    const now = typeof opts.now === 'function' ? opts.now : (() => null);

    const str = (v, cap) => (v == null ? '' : String(v)).slice(0, cap);
    const indexOf = (id) => records.findIndex(r => r && r.id === id);
    const forBiz = (businessId) => records.filter(r => r && r.businessId === businessId);

    const rowView = (r) => ({
      id: r.id,
      seq: r.seq,
      businessId: r.businessId,
      role: r.role,
      specialty: r.specialty,
      name: r.name || '',
      status: r.status,
      grants: BusinessPermissions.sanitizeGrants(r.grants),
      hiredBy: r.hiredBy === 'ai' ? 'ai' : 'user',
      createdAt: r.createdAt != null ? r.createdAt : null,
      updatedAt: r.updatedAt != null ? r.updatedAt : null
    });

    function nextSeq(businessId) {
      let max = 0;
      for (const r of records) if (r && r.businessId === businessId && r.seq > max) max = r.seq;
      return max + 1;
    }

    function commit(next) {
      if (persist) {
        try { persist(next.map(rowView)); }
        catch (e) { return { ok: false, reason: 'could not persist — denied' }; }
      }
      records.length = 0;
      for (const r of next) records.push(r);
      return { ok: true };
    }

    /* Resolve and validate a role+specialty pair. Returns { ok, role, specialty } or { ok:false, reason }.
       The specialty MUST be one of the classes the role names — that is the whole point of §7's role table,
       and it is also how a renamed class is caught (BusinessRoles.unresolved()). */
    function resolveSeat(roleId, specialtyId) {
      const role = BusinessRoles.byId(roleId);
      if (!role) {
        return { ok: false, reason: 'unknown role: "' + String(roleId) + '" — one of: ' + BusinessRoles.ROLE_IDS.join(', ') };
      }
      const offered = BusinessRoles.specialtiesFor(role.id);
      if (!offered.length) {
        return { ok: false, reason: 'role "' + role.id + '" names no specialties — the role bridge is broken' };
      }
      const wanted = (specialtyId == null || String(specialtyId).trim() === '') ? offered[0] : String(specialtyId);
      if (offered.indexOf(wanted) < 0) {
        return { ok: false, reason: 'specialty "' + wanted + '" cannot fill the ' + role.label + ' role — allowed: ' + offered.join(', ') };
      }
      if (!BusinessRoles.hasSpecialty(wanted)) {
        return { ok: false, reason: 'specialty "' + wanted + '" no longer exists in the class catalog — the role bridge is stale' };
      }
      return { ok: true, role: role, specialty: wanted };
    }

    // HIRE. businessId + role are required; specialty defaults to the role's default class.
    function hire(businessId, meta) {
      meta = meta || {};
      const bid = str(businessId, MAX_ID).trim();
      if (!bid) return { ok: false, reason: 'a businessId is required (isolation is by key — never implied)' };

      const seat = resolveSeat(meta.role, meta.specialty);
      if (!seat.ok) return { ok: false, reason: seat.reason };

      const name = str(meta.name, MAX_NAME).trim() || BusinessRoles.specialtyLabel(seat.specialty) || seat.role.label;
      const at = now();
      const seq = nextSeq(bid);
      const row = {
        id: bid + '~a' + seq,
        seq: seq,
        businessId: bid,
        role: seat.role.id,
        specialty: seat.specialty,
        name: name,
        status: 'idle',
        // sanitizeGrants forces restricted:false — an agent is never hired able to run restricted actions.
        grants: BusinessPermissions.sanitizeGrants(meta.grants),
        hiredBy: meta.hiredBy === 'ai' ? 'ai' : 'user',
        createdAt: at,
        updatedAt: at
      };
      const res = commit(records.concat([row]));
      if (!res.ok) return { ok: false, reason: 'could not persist the hire — denied' };
      return { ok: true, agent: rowView(row) };
    }

    // UPDATE. Whitelisted fields. id / businessId / createdAt are immutable (a re-role never re-keys the
    // agent, so its memory namespace and any task assignment stay attached).
    function update(id, patch) {
      patch = patch || {};
      const i = indexOf(id);
      if (i < 0) return { ok: false, reason: 'unknown agent: ' + id };
      const prev = records[i];
      const nextRow = rowView(prev);

      if (patch.role != null || patch.specialty != null) {
        const roleId = patch.role != null ? patch.role : prev.role;
        // When the ROLE changes and no class is named, adopt the new role's default class: a class that
        // filled the OLD role is by definition not meaningful for the new one, so keeping it would refuse a
        // re-role the user clearly intended. The change is reported in `changed` by the route, never silent.
        const specId = patch.specialty != null ? patch.specialty
          : (patch.role != null && patch.role !== prev.role ? null : prev.specialty);
        const seat = resolveSeat(roleId, specId);
        if (!seat.ok) return { ok: false, reason: seat.reason };
        nextRow.role = seat.role.id;
        nextRow.specialty = seat.specialty;
      }
      if (patch.name != null) {
        const nm = str(patch.name, MAX_NAME).trim();
        if (!nm) return { ok: false, reason: 'an agent name cannot be blank' };
        nextRow.name = nm;
      }
      if (patch.status != null) {
        const st = String(patch.status);
        if (STATUSES.indexOf(st) < 0) return { ok: false, reason: 'unknown status: ' + st };
        nextRow.status = st;
      }
      if (patch.grants != null) {
        nextRow.grants = BusinessPermissions.sanitizeGrants(patch.grants, prev.grants);
      }
      nextRow.id = prev.id;
      nextRow.businessId = prev.businessId;
      nextRow.seq = prev.seq;
      nextRow.createdAt = prev.createdAt;
      nextRow.updatedAt = now();

      const next = records.slice(); next[i] = nextRow;
      const res = commit(next);
      if (!res.ok) return { ok: false, reason: 'could not persist the update — denied' };
      return { ok: true, agent: rowView(nextRow) };
    }

    function setStatus(id, status) { return update(id, { status: status }); }
    function setGrants(id, grants) { return update(id, { grants: grants }); }

    // REMOVE. Hard forget of the AGENT row only. Tasks assigned to it are the caller's to reassign — this
    // store does not reach into another store's namespace (same rule as businesses-store.remove).
    function remove(id) {
      const i = indexOf(id);
      if (i < 0) return { ok: true };
      const next = records.slice(); next.splice(i, 1);
      const res = commit(next);
      if (!res.ok) return { ok: false, reason: 'could not persist the removal — kept' };
      return { ok: true };
    }

    function list(businessId) {
      const bid = str(businessId, MAX_ID).trim();
      if (!bid) return [];
      return forBiz(bid).slice().sort((a, b) => (a.seq || 0) - (b.seq || 0)).map(rowView);
    }
    function get(id) { const i = indexOf(id); return i < 0 ? null : rowView(records[i]); }
    function has(id) { return indexOf(id) >= 0; }
    function count(businessId) { const bid = str(businessId, MAX_ID).trim(); return bid ? forBiz(bid).length : 0; }

    function byRole(businessId, role) {
      return list(businessId).filter(a => a.role === role);
    }

    /* The context scope an agent's memory lives under. Prefixed by the BUSINESS first, so two businesses
       that both hired "a researcher" cannot share a namespace. */
    function memoryNamespace(id) {
      const a = get(id);
      if (!a) return '';
      return 'biz:' + a.businessId + ':agent:' + a.id;
    }

    /* Permission check for one agent + one action, using the agent's OWN stored grants. Unknown agent ->
       deny (fail-closed). */
    function decide(id, action) {
      const a = get(id);
      if (!a) return { allow: false, tier: 'restricted', approval: 'required', action: String(action == null ? '' : action), reason: 'unknown agent: ' + id };
      return BusinessPermissions.decide({ action: action, grants: a.grants });
    }

    return {
      STATUSES,
      hire, update, setStatus, setGrants, remove, list, get, has, count, byRole,
      memoryNamespace, decide, resolveSeat
    };
  }

  return { makeBusinessAgentsStore, STATUSES };
});
