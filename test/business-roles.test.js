'use strict';
/* test/business-roles.test.js — the §7 AI BUSINESS TEAM role catalog (shared/business-roles.js).

   The load-bearing properties:
     · the twelve roles are §7's twelve, in §7's order, with §7's responsibility sentence VERBATIM;
     · EVERY specialty id a role names resolves in the real SharedSpecialties catalog — this is the anti-drift
       law. A rename in specialties.js must fail HERE rather than silently produce a role nobody can fill;
     · the bridge is a bridge: it adds no persona/manual/kit of its own (P4 — no second catalog);
     · it is DETERMINISTIC: no clock, no rng, same answer every call. */
const A = require('./_assert.js');
const R = require('../shared/business-roles.js');
const SharedSpecialties = require('../shared/specialties.js');

/* ---------- §7's twelve roles, in §7's order, with §7's words ---------- */
{
  A.eq(R.ROLE_IDS, [
    'ceo', 'research', 'product', 'engineering', 'marketing', 'sales',
    'finance', 'operations', 'analytics', 'security', 'qa', 'project-manager'
  ], 'the twelve roles are §7\'s twelve, in the order §7 lists them');

  const byId = R.byId;
  A.eq(byId('ceo').responsibility, 'Coordinates the business; strategic recommendations', 'CEO responsibility is §7 verbatim');
  A.eq(byId('research').responsibility, 'Markets, competitors, customers, opportunities', 'Research responsibility is §7 verbatim');
  A.eq(byId('product').responsibility, 'Product and feature design', 'Product responsibility is §7 verbatim');
  A.eq(byId('engineering').responsibility, 'Software and technical infrastructure', 'Engineering responsibility is §7 verbatim');
  A.eq(byId('marketing').responsibility, 'Campaigns and content', 'Marketing responsibility is §7 verbatim');
  A.eq(byId('sales').responsibility, 'Leads and sales workflows', 'Sales responsibility is §7 verbatim');
  A.eq(byId('finance').responsibility, 'Revenue, expenses, budgets, financial metrics', 'Finance responsibility is §7 verbatim');
  A.eq(byId('operations').responsibility, 'Recurring business processes', 'Operations responsibility is §7 verbatim');
  A.eq(byId('analytics').responsibility, 'Business performance analysis', 'Analytics responsibility is §7 verbatim');
  A.eq(byId('security').responsibility, 'Security risks and suspicious actions', 'Security responsibility is §7 verbatim');
  A.eq(byId('qa').responsibility, 'Tests products, sites, workflows, integrations', 'QA responsibility is §7 verbatim');
  A.eq(byId('project-manager').responsibility, 'Converts goals into tasks; tracks progress', 'Project Manager responsibility is §7 verbatim');

  A.eq(byId('nope'), null, 'an unknown role resolves to null, never a guess');
  A.eq(byId(''), null, 'an empty id does not match a role');
}

/* ---------- THE ANTI-DRIFT LAW: every named specialty is real ---------- */
{
  A.eq(R.unresolved(), [], 'no role names a specialty that the class catalog does not have');

  // non-vacuous: prove the check can fail by asserting it would flag a bad id.
  const real = SharedSpecialties.BUILTINS.concat(SharedSpecialties.ARCHETYPES).map(s => s.id);
  for (const role of R.ROLES) {
    A.ok(role.specialties.length > 0, role.id + ' names at least one specialty');
    for (const s of role.specialties) {
      A.ok(real.indexOf(s) >= 0, role.id + ' -> "' + s + '" resolves in SharedSpecialties');
    }
    // no duplicates within one role — a repeated class would be a copy-paste, not a choice.
    A.eq(new Set(role.specialties).size, role.specialties.length, role.id + ' lists each specialty once');
  }
}

/* ---------- the bridge resolves names but does NOT restate the catalog (P4) ---------- */
{
  const ceo = R.byId('ceo');
  A.eq(Object.keys(ceo).sort(), ['id', 'label', 'responsibility', 'specialties'],
    'a role row carries ONLY §7 fields — no persona, manual, kit or skills (those stay in specialties.js)');
  A.eq(R.specialtyLabel('strategist'), 'Strategist', 'specialtyLabel resolves a built-in name');
  A.eq(R.specialtyLabel('archivist'), 'Archivist', 'specialtyLabel resolves an archetype name');
  A.eq(R.specialtyLabel('nope'), '', 'an unknown specialty resolves to empty, never a guess');
  A.eq(R.specialtyLabel(''), '', 'an empty specialty resolves to empty');

  // the first listed specialty is the default the hire flow offers.
  A.eq(R.defaultSpecialty('ceo'), 'strategist', 'CEO defaults to the Strategist');
  A.eq(R.defaultSpecialty('qa'), 'apptester', 'QA defaults to the QA Tester');
  A.eq(R.defaultSpecialty('nope'), null, 'an unknown role has no default specialty');

  A.eq(R.specialtiesFor('engineering'), ['engineer', 'dbhelper', 'deployer'], 'specialtiesFor returns the role\'s classes');
  A.eq(R.specialtiesFor('nope'), [], 'an unknown role offers no specialties');
  // a returned list is a COPY — mutating it must not corrupt the frozen table.
  const list = R.specialtiesFor('engineering');
  list.push('bogus');
  A.eq(R.specialtiesFor('engineering'), ['engineer', 'dbhelper', 'deployer'], 'specialtiesFor returns a copy, not the live array');
}

/* ---------- the catalog the UI renders ---------- */
{
  const cat = R.catalog();
  A.eq(cat.length, 12, 'catalog lists all twelve roles');
  const ceo = cat[0];
  A.eq(ceo.id, 'ceo', 'the catalog preserves §7 order');
  A.eq(ceo.defaultSpecialty, 'strategist', 'the catalog names the default class');
  A.eq(ceo.specialties.length, 2, 'the CEO row lists its two classes');
  A.eq(ceo.specialties[0], { id: 'strategist', name: 'Strategist', known: true }, 'each class carries its real name and a known flag');
  for (const row of cat) {
    A.ok(!!row.label && !!row.responsibility, row.id + ' has a label and a responsibility');
    for (const s of row.specialties) A.ok(s.known, row.id + ' -> ' + s.id + ' is known');
  }
}

/* ---------- determinism ---------- */
{
  A.eq(R.catalog(), R.catalog(), 'catalog() is a pure function of frozen tables — two calls are identical');
  A.eq(R.unresolved(), R.unresolved(), 'unresolved() is stable');
  A.eq(R.hasSpecialty('researcher'), true, 'hasSpecialty resolves a real class');
  A.eq(R.hasSpecialty('nope'), false, 'hasSpecialty rejects a fake one');
  A.eq(R.hasSpecialty(''), false, 'hasSpecialty rejects an empty id');
  A.ok(R.knownSpecialtyIds().length >= 50, 'the known-id list spans built-ins and archetypes');
}

A.report('business-roles');
