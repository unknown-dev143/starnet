/* sidecar/businesses-store.js — the BUSINESS ENTITY store (Business OS, Phase 1 foundation).

   THE FIRST BUSINESS ENTITY. Every business the Commander creates inside SpaceStation gets exactly one
   row here, keyed by a stable, human-readable id derived from its name. This module is deliberately the
   NARROWEST possible foundation: it owns IDENTITY + ISOLATION and nothing else.

   WHAT IT OWNS
     - the business row (id, name, stage, template, the planning fields the Business Builder fills in)
     - the ISOLATION KEY every other business-scoped store must namespace on: memoryNamespace(id) -> 'biz:<id>'
     - persist-before-commit (fail-closed): a row is never visible in memory unless it reached disk

   WHAT IT DELIBERATELY DOES NOT OWN (so this stays honest and small)
     - money, metrics, customers, tasks, documents, agents, automations — each gets its OWN store, each
       namespaced on memoryNamespace(id) so one business can never read another's private data (P6).
     - any derived number. This store holds NO revenue/score/estimate. Per P1, estimates live in the store
       that produced them, tagged with their evidence class — never baked into the entity.

   ISOLATION (P6). There is no database and therefore no foreign key to enforce tenancy. Isolation is by
   KEY NAMESPACE, which is why memoryNamespace() is a first-class export and not an afterthought: a store
   that keys on a bare agentId would silently let two businesses collide. Callers MUST prefix.

   PROVENANCE (P1). Every row carries `createdBy` ('user' | 'ai') so the UI can distinguish a business the
   Commander typed from one an agent proposed. This is a real, checkable provenance signal — not a guess.

   PURE: no IO, no clock, no env, no rng. `persist` and `now` are injected (Date.now at the sidecar edge, a
   fixed stub in tests), and ids are derived by DETERMINISTIC slug de-duplication rather than a random
   token — so the module passes lint-determinism and is fully Node-testable. UMD so a future frontend
   panel can import it directly. Mirrors projects-store.js. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).businessesStore = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* THE BUSINESS LIFECYCLE (master prompt §2). The brief names ten stages; this list is the ten, in the
     brief's order:

       idea → validating → planning → building → testing → live → growing → paused → winding-down → archived

     Three deliberate differences from the original six-state list, each recorded because the audit's §6
     called the divergence "a decision to make, not a bug" (PHASE0-AUDIT-v2 §6 item 8):

     1. `planning`, `testing` and `growing` are NEW. They were absent only because nothing had needed them
        yet — not because the model rejects them. They are ordinary states: a business can be moved into any
        of them through the same `setStage` path as the rest, and the UI offers them. Adding them closes the
        gap by making the system able to SAY where a venture is, which is the point of a lifecycle.
     2. `launching` (the brief's stage between testing and live) is NOT here, folded into `live`. A stage
        only earns its place if something can be true in it and false outside it. Nothing in this system
        distinguishes "launched but not yet live" from "live" — there is no launch gate that flips. Keeping
        a stage nothing can enter would be decoration, so it is deliberately merged and the divergence is
        named in the audit rather than papered over (P7 — no invented state).
     3. `archived` is terminal-by-choice, never a delete, and `paused` is a deliberate freeze — both already
        carried meaning (the automation engine reads `paused`; index.js reads `paused`/`archived`).

     `winding-down` is the brief's `winding-down`: distinct from `paused` (temporary) because it is the
     one-way approach to `archived`. */
  const STAGES = [
    'idea', 'validating', 'planning', 'building', 'testing',
    'live', 'growing', 'paused', 'winding-down', 'archived'
  ];

  /* States a business is NOT operating in: the automation engine refuses to run scheduled work for these,
     and index.js treats them as "not live" for the purposes of work-order admission. Kept as one exported
     list so the two call sites cannot drift apart. */
  const INACTIVE_STAGES = ['paused', 'winding-down', 'archived'];

  // Reusable business templates (master prompt §25). 'custom' = no template, user-defined flow.
  const TEMPLATES = ['saas', 'content', 'digital-product', 'agency', 'custom'];

  const MAX_NAME = 120;
  const MAX_TEXT = 4000;

  function slugFor(name) {
    const s = String(name == null ? '' : name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
    return s || 'business';
  }

  function makeBusinessesStore(opts) {
    opts = opts || {};
    const records = Array.isArray(opts.records) ? opts.records : [];
    const persist = typeof opts.persist === 'function' ? opts.persist : null;
    const now = typeof opts.now === 'function' ? opts.now : (() => null);

    const indexOf = (id) => records.findIndex(r => r && r.id === id);

    // defensive view so a caller can't mutate live rows out from under the store.
    const rowView = (r) => ({
      id: r.id,
      name: r.name,
      stage: r.stage,
      template: r.template,
      description: r.description != null ? r.description : '',
      targetCustomer: r.targetCustomer != null ? r.targetCustomer : '',
      valueProposition: r.valueProposition != null ? r.valueProposition : '',
      businessModel: r.businessModel != null ? r.businessModel : '',
      pricingModel: r.pricingModel != null ? r.pricingModel : '',
      currency: r.currency != null ? r.currency : 'USD',
      createdBy: r.createdBy === 'ai' ? 'ai' : 'user',
      createdAt: r.createdAt != null ? r.createdAt : null,
      updatedAt: r.updatedAt != null ? r.updatedAt : null
    });

    // a stable, unique id: the name's slug, then slug-2, slug-3 … Deterministic (no rng).
    function nextId(name) {
      const base = slugFor(name);
      if (indexOf(base) < 0) return base;
      let n = 2;
      while (indexOf(base + '-' + n) >= 0) n++;
      return base + '-' + n;
    }

    const str = (v, cap) => (v == null ? '' : String(v)).slice(0, cap);

    function snapshot() {
      // newest-updated first — the Command Center cares about "what moved lately".
      return { businesses: records.map(rowView).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)) };
    }
    function list() { return snapshot().businesses; }
    function count() { return records.length; }
    function get(id) { const i = indexOf(id); return i < 0 ? null : rowView(records[i]); }
    function has(id) { return indexOf(id) >= 0; }

    /* The tenancy key. Every business-scoped store (memory, activity, finance, crm, tasks …) MUST
       namespace on this, so two businesses can never collide in a flat JSON store. */
    function memoryNamespace(id) { return 'biz:' + String(id == null ? '' : id); }

    // CREATE. Name is the only required field. Persist-before-commit: a thrown persist leaves memory
    // untouched and returns ok:false, so a business is never visible unless it is durable.
    function create(meta) {
      meta = meta || {};
      const name = str(meta.name, MAX_NAME).trim();
      if (!name) return { ok: false, reason: 'a business name is required' };
      const stage = meta.stage != null ? String(meta.stage) : 'idea';
      if (STAGES.indexOf(stage) < 0) return { ok: false, reason: 'unknown stage: ' + stage };
      const template = meta.template != null ? String(meta.template) : 'custom';
      if (TEMPLATES.indexOf(template) < 0) return { ok: false, reason: 'unknown template: ' + template };

      const at = now();
      const id = nextId(name);
      const row = {
        id: id,
        name: name,
        stage: stage,
        template: template,
        description: str(meta.description, MAX_TEXT),
        targetCustomer: str(meta.targetCustomer, MAX_TEXT),
        valueProposition: str(meta.valueProposition, MAX_TEXT),
        businessModel: str(meta.businessModel, MAX_TEXT),
        pricingModel: str(meta.pricingModel, MAX_TEXT),
        currency: str(meta.currency, 8) || 'USD',
        createdBy: meta.createdBy === 'ai' ? 'ai' : 'user',
        createdAt: at,
        updatedAt: at
      };
      const next = records.slice(); next.push(row);
      if (persist) {
        try { persist(next.map(rowView)); }
        catch (e) { return { ok: false, reason: 'could not persist business — denied' }; }
      }
      records.push(row);
      return { ok: true, business: rowView(row) };
    }

    // UPDATE. Whitelisted fields only. id + createdAt are IMMUTABLE (a rename never re-keys the business,
     // so every namespaced child store stays correctly attached). Persist-before-commit.
    function update(id, patch) {
      patch = patch || {};
      const i = indexOf(id);
      if (i < 0) return { ok: false, reason: 'unknown business: ' + id };
      const prev = records[i];
      const nextRow = rowView(prev);

      if (patch.name != null) {
        const nm = str(patch.name, MAX_NAME).trim();
        if (!nm) return { ok: false, reason: 'name cannot be blank' };
        nextRow.name = nm;
      }
      if (patch.stage != null) {
        const st = String(patch.stage);
        if (STAGES.indexOf(st) < 0) return { ok: false, reason: 'unknown stage: ' + st };
        nextRow.stage = st;
      }
      if (patch.template != null) {
        const tp = String(patch.template);
        if (TEMPLATES.indexOf(tp) < 0) return { ok: false, reason: 'unknown template: ' + tp };
        nextRow.template = tp;
      }
      for (const f of ['description', 'targetCustomer', 'valueProposition', 'businessModel', 'pricingModel']) {
        if (patch[f] != null) nextRow[f] = str(patch[f], MAX_TEXT);
      }
      if (patch.currency != null) nextRow.currency = str(patch.currency, 8) || 'USD';
      // createdBy is provenance — set once at create, never rewritten by a patch.
      nextRow.id = prev.id;
      nextRow.createdAt = prev.createdAt;
      nextRow.updatedAt = now();

      const next = records.slice(); next[i] = nextRow;
      if (persist) {
        try { persist(next.map(rowView)); }
        catch (e) { return { ok: false, reason: 'could not persist update — denied' }; }
      }
      records[i] = nextRow;
      return { ok: true, business: rowView(nextRow) };
    }

    function setStage(id, stage) { return update(id, { stage: stage }); }

    // REMOVE. Hard forget of the ENTITY only. Child stores (memory, activity, finance …) are the caller's
    // to clean up — this module must not reach into namespaces it does not own.
    function remove(id) {
      const i = indexOf(id);
      if (i < 0) return { ok: true };
      const next = records.slice(); next.splice(i, 1);
      if (persist) {
        try { persist(next.map(rowView)); }
        catch (e) { return { ok: false, reason: 'could not persist removal — kept' }; }
      }
      records.splice(i, 1);
      return { ok: true };
    }

    return { STAGES, INACTIVE_STAGES, TEMPLATES, snapshot, list, count, get, has, create, update, setStage, remove, memoryNamespace, slugFor };
  }

  return { makeBusinessesStore, STAGES, INACTIVE_STAGES, TEMPLATES, slugFor };
});
