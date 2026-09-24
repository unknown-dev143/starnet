/* shared/business-roles.js — the AI BUSINESS TEAM role catalog (master prompt §7).

   WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT. §7 names twelve roles a business's virtual team is made
   of, each with a stated responsibility. StarNet ALREADY ships an agent catalog — shared/specialties.js,
   the 50-class roster behind the Recruitment Bay, each class carrying a real persona, operating manual,
   kit, skill bundle and model tier. Building a second, parallel catalog of "business agents" would be the
   exact duplication P4 forbids, and worse: two catalogs drift, and the one the harness actually summons
   would stop matching the one the business UI lists.

   So this module is a BRIDGE, not a catalog. It owns the §7 role table (id, label, the responsibility
   sentence VERBATIM from §7) and, for each role, the ids of the existing SharedSpecialties classes that
   can fill it. It invents no persona, no manual, no tool list — those stay where they already live, owned
   by one module, so a business agent and a bay-summoned specialist are the same thing configured the same
   way.

   THE ANTI-DRIFT LAW. Every specialty id named here must resolve in SharedSpecialties. That is enforced
   two ways: `unresolved()` is a real runtime check (the hire route refuses to seat a role whose classes
   have vanished), and test/business-roles.test.js pins it so a rename in specialties.js fails the gate
   instead of silently producing a role nobody can fill. This is the same discipline as capdrift: a
   reference that cannot be checked is a reference that will rot.

   PURE: no IO, no clock, no env, no rng, no network. A deterministic function of the frozen tables in this
   file and the frozen tables in specialties.js. UMD: `SharedBusinessRoles` in the browser (index.html
   loads shared/specialties.js first), module.exports under node. */

'use strict';
(function (root, factory) {
  const specs = (typeof module !== 'undefined' && module.exports)
    ? require('./specialties.js')
    : (root.SharedSpecialties || { BUILTINS: [], ARCHETYPES: [] });
  const api = factory(specs);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.SharedBusinessRoles = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (SharedSpecialties) {
  'use strict';

  const DEFAULT_ROLE = 'ceo';

  /* §7's table, in the order §7 lists it. `responsibility` is the §7 cell verbatim — not a paraphrase,
     so the UI can quote the spec rather than restate it. `specialties` names the SharedSpecialties classes
     that can fill the role; the FIRST is the default the hire flow offers. A role with an empty list would
     be a role nobody can fill, which is why unresolved() treats that as a failure too. */
  const ROLES = [
    {
      id: 'ceo', label: 'CEO',
      responsibility: 'Coordinates the business; strategic recommendations',
      specialties: ['strategist', 'chief']
    },
    {
      id: 'research', label: 'Research',
      responsibility: 'Markets, competitors, customers, opportunities',
      specialties: ['researcher', 'opportunist']
    },
    {
      id: 'product', label: 'Product',
      responsibility: 'Product and feature design',
      specialties: ['drafter', 'designer']
    },
    {
      id: 'engineering', label: 'Engineering',
      responsibility: 'Software and technical infrastructure',
      specialties: ['engineer', 'dbhelper', 'deployer']
    },
    {
      id: 'marketing', label: 'Marketing',
      responsibility: 'Campaigns and content',
      specialties: ['marketer', 'copywriter', 'publisher', 'optimizer']
    },
    {
      id: 'sales', label: 'Sales',
      responsibility: 'Leads and sales workflows',
      specialties: ['closer', 'prospector', 'negotiator']
    },
    {
      id: 'finance', label: 'Finance',
      responsibility: 'Revenue, expenses, budgets, financial metrics',
      specialties: ['treasurer', 'broker']
    },
    {
      id: 'operations', label: 'Operations',
      responsibility: 'Recurring business processes',
      specialties: ['operator', 'processwriter', 'support']
    },
    {
      id: 'analytics', label: 'Analytics',
      responsibility: 'Business performance analysis',
      specialties: ['analyst', 'harvester']
    },
    {
      id: 'security', label: 'Security',
      responsibility: 'Security risks and suspicious actions',
      specialties: ['auditor', 'sentinel']
    },
    {
      id: 'qa', label: 'QA',
      responsibility: 'Tests products, sites, workflows, integrations',
      specialties: ['apptester', 'reviewer', 'a11y']
    },
    {
      id: 'project-manager', label: 'Project Manager',
      responsibility: 'Converts goals into tasks; tracks progress',
      specialties: ['foreman', 'taskmaster', 'chief']
    }
  ];

  const ROLE_IDS = ROLES.map(r => r.id);

  function byId(id) {
    const k = String(id == null ? '' : id);
    for (const r of ROLES) if (r.id === k) return r;
    return null;
  }

  // Every specialty id the catalog actually knows — built-ins AND the deep-cut archetypes, because a role
  // may legitimately be filled by an archetype and neither shelf is gated.
  function knownSpecialtyIds() {
    const out = [];
    const push = (list) => { for (const s of (Array.isArray(list) ? list : [])) if (s && s.id) out.push(s.id); };
    push(SharedSpecialties.BUILTINS);
    push(SharedSpecialties.ARCHETYPES);
    return out;
  }

  function hasSpecialty(id) {
    const k = String(id == null ? '' : id);
    if (!k) return false;
    return knownSpecialtyIds().indexOf(k) >= 0;
  }

  /* THE DRIFT CHECK. Returns every specialty id a role names that SharedSpecialties does not resolve to —
     an empty array means the bridge is intact. This is a real function, not just a test fixture: the hire
     route calls it so a role whose classes were renamed is REFUSED with an explanation instead of seating
     an agent pointing at a class that no longer exists. */
  function unresolved() {
    const missing = [];
    for (const r of ROLES) {
      if (!r.specialties.length) { missing.push({ role: r.id, specialty: null, reason: 'role has no specialties' }); continue; }
      for (const s of r.specialties) {
        if (!hasSpecialty(s)) missing.push({ role: r.id, specialty: s, reason: 'unknown specialty id' });
      }
    }
    return missing;
  }

  function specialtiesFor(roleId) {
    const r = byId(roleId);
    return r ? r.specialties.slice() : [];
  }

  // The default class for a role — the first one §7's bridge offers. Null for an unknown role.
  function defaultSpecialty(roleId) {
    const r = byId(roleId);
    return r && r.specialties.length ? r.specialties[0] : null;
  }

  // Display label for a specialty id, from the ONE catalog that owns names. '' when unknown — never a guess.
  function specialtyLabel(id) {
    const k = String(id == null ? '' : id);
    const all = (Array.isArray(SharedSpecialties.BUILTINS) ? SharedSpecialties.BUILTINS : [])
      .concat(Array.isArray(SharedSpecialties.ARCHETYPES) ? SharedSpecialties.ARCHETYPES : []);
    for (const s of all) if (s && s.id === k) return s.name || k;
    return '';
  }

  // The catalog the UI renders: the §7 table plus, per role, its fillable classes resolved to real names.
  function catalog() {
    return ROLES.map(r => ({
      id: r.id,
      label: r.label,
      responsibility: r.responsibility,
      defaultSpecialty: r.specialties.length ? r.specialties[0] : null,
      specialties: r.specialties.map(id => ({ id: id, name: specialtyLabel(id), known: hasSpecialty(id) }))
    }));
  }

  return {
    ROLES, ROLE_IDS, DEFAULT_ROLE,
    byId, catalog, specialtiesFor, defaultSpecialty, specialtyLabel,
    hasSpecialty, knownSpecialtyIds, unresolved
  };
});
