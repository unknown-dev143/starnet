/* sidecar/opportunities-store.js — the OPPORTUNITY RADAR + Business Factory Stage 1 (Business OS Phase 2).

   An opportunity is a CLAIM SET about a business that does not exist yet. The whole point of this store is
   that you cannot record a claim without saying how you know it.

   P1 IS A DATA-MODEL INVARIANT HERE, NOT A CONVENTION. Every field is `{ text, evidence }` and `evidence`
   must be one of the six classes the operating contract defines:

     verified    — sourced and checkable
     analysis    — reasoning over verified inputs
     assumption  — taken as true without proof
     estimate    — approximate, with a stated method
     prediction  — forward-looking and uncertain
     unknown     — explicitly NOT known

   `setField` REFUSES an unknown class rather than defaulting it. There is no code path that writes an
   unlabeled claim, so a future caller cannot accidentally ship one by forgetting to pass the label — the
   same reasoning as businesses-store's persist-before-commit, applied to epistemics instead of durability.

   THE STORE COMPUTES NO SCORE. It exposes evidenceMix() (a COUNT of fields per class) and missing() (the
   field names with nothing in them). Both are checkable facts. An "opportunity score" would be an invented
   number dressed as analysis, which is precisely what P2 forbids — so the honest read is the raw mix, and
   the Commander judges it.

   PURE: no IO, no clock, no env, no rng. `persist` and `now` injected; ids derived deterministically from
   the working title. UMD so the frontend panel can import it. Mirrors businesses-store.js. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).opportunitiesStore = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // P1's exact vocabulary. Order is the display order (strongest evidence first) — the UI relies on it.
  const EVIDENCE = ['verified', 'analysis', 'assumption', 'estimate', 'prediction', 'unknown'];

  // §4 — every opportunity must contain these. Order is the order the form and the report present them.
  const FIELDS = [
    'problem', 'targetCustomer', 'proposedSolution', 'existingAlternatives', 'competition',
    'businessModel', 'requiredResources', 'startupComplexity', 'revenueModel',
    'risks', 'unknowns', 'validationRequirements'
  ];

  // draft -> researching -> ready -> validating -> validated | rejected -> promoted; archived is terminal.
  const STAGES = ['draft', 'researching', 'ready', 'validating', 'validated', 'rejected', 'promoted', 'archived'];

  const MAX_TITLE = 160;
  const MAX_TEXT = 4000;
  const MAX_SOURCE = 500;

  function slugFor(title) {
    const s = String(title == null ? '' : title)
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
    return s || 'opportunity';
  }

  function makeOpportunitiesStore(opts) {
    opts = opts || {};
    const records = Array.isArray(opts.records) ? opts.records : [];
    const persist = typeof opts.persist === 'function' ? opts.persist : null;
    const now = typeof opts.now === 'function' ? opts.now : (() => null);

    const indexOf = (id) => records.findIndex(r => r && r.id === id);
    const str = (v, cap) => (v == null ? '' : String(v)).slice(0, cap);

    // A field cell. `evidence` defaults to 'unknown' ONLY when there is no text — an empty cell is honestly
    // unknown. A cell WITH text and no valid label is refused upstream in setField, never defaulted here.
    function cellView(c) {
      const text = str(c && c.text, MAX_TEXT);
      const ev = (c && EVIDENCE.indexOf(c.evidence) >= 0) ? c.evidence : 'unknown';
      return { text: text, evidence: text ? ev : 'unknown', source: str(c && c.source, MAX_SOURCE) };
    }

    const rowView = (r) => {
      const fields = {};
      for (const f of FIELDS) fields[f] = cellView(r.fields && r.fields[f]);
      return {
        id: r.id,
        title: r.title,
        stage: r.stage,
        template: r.template,
        fields: fields,
        origin: r.origin === 'ai' ? 'ai' : 'user',
        businessId: r.businessId || '',          // set when this opportunity is promoted
        createdAt: r.createdAt != null ? r.createdAt : null,
        updatedAt: r.updatedAt != null ? r.updatedAt : null
      };
    };

    function nextId(title) {
      const base = slugFor(title);
      if (indexOf(base) < 0) return base;
      let n = 2;
      while (indexOf(base + '-' + n) >= 0) n++;
      return base + '-' + n;
    }

    function snapshot() {
      return { opportunities: records.map(rowView).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)) };
    }
    function list() { return snapshot().opportunities; }
    function count() { return records.length; }
    function get(id) { const i = indexOf(id); return i < 0 ? null : rowView(records[i]); }
    function has(id) { return indexOf(id) >= 0; }

    // ---- reads that are COUNTS, never scores ---------------------------------------------------------
    // How many fields carry each evidence class. A real tally the Commander can read at a glance.
    function evidenceMix(id) {
      const r = indexOf(id) < 0 ? null : records[indexOf(id)];
      const mix = {};
      for (const e of EVIDENCE) mix[e] = 0;
      if (!r) return mix;
      for (const f of FIELDS) {
        const c = cellView(r.fields && r.fields[f]);
        if (c.text) mix[c.evidence]++;
      }
      return mix;
    }

    // The §4 fields with nothing in them — what the opportunity still owes you before it is decision-ready.
    function missing(id) {
      const r = indexOf(id) < 0 ? null : records[indexOf(id)];
      if (!r) return FIELDS.slice();
      return FIELDS.filter(f => !cellView(r.fields && r.fields[f]).text);
    }

    // Filled / total. `ready` means every §4 field is present — a STRUCTURAL test, not a quality judgement.
    function completeness(id) {
      const r = indexOf(id) < 0 ? null : records[indexOf(id)];
      if (!r) return { filled: 0, total: FIELDS.length, ready: false };
      let filled = 0;
      for (const f of FIELDS) if (cellView(r.fields && r.fields[f]).text) filled++;
      return { filled: filled, total: FIELDS.length, ready: filled === FIELDS.length };
    }

    // ---- writes (all persist-before-commit, fail-closed) ---------------------------------------------
    function commit(next) {
      if (persist) {
        try { persist(next.map(rowView)); }
        catch (e) { return { ok: false, reason: 'could not persist — denied' }; }
      }
      records.length = 0;
      for (const r of next) records.push(r);
      return { ok: true };
    }

    function create(meta) {
      meta = meta || {};
      const title = str(meta.title, MAX_TITLE).trim();
      if (!title) return { ok: false, reason: 'a working title is required' };
      const stage = meta.stage != null ? String(meta.stage) : 'draft';
      if (STAGES.indexOf(stage) < 0) return { ok: false, reason: 'unknown stage: ' + stage };
      const template = str(meta.template, 40) || 'custom';

      const at = now();
      const row = {
        id: nextId(title), title: title, stage: stage, template: template,
        fields: {},                                   // every cell starts empty; an empty cell reads 'unknown'
        origin: meta.origin === 'ai' ? 'ai' : 'user',
        businessId: '', createdAt: at, updatedAt: at
      };
      const next = records.slice(); next.push(row);
      const w = commit(next);
      if (!w.ok) return w;
      return { ok: true, opportunity: rowView(row) };
    }

    /* SET ONE LABELED FIELD — the only door that writes a claim. `evidence` is REQUIRED and must be in the
       P1 vocabulary; there is no default. An empty text CLEARS the cell (and its label becomes 'unknown',
       which is what an empty cell honestly is). */
    function setField(id, field, text, evidence, source) {
      if (FIELDS.indexOf(field) < 0) return { ok: false, reason: 'unknown field: ' + field };
      const i = indexOf(id);
      if (i < 0) return { ok: false, reason: 'unknown opportunity: ' + id };
      const body = str(text, MAX_TEXT);
      let ev = evidence == null ? '' : String(evidence);
      if (body) {
        if (EVIDENCE.indexOf(ev) < 0) {
          return { ok: false, reason: 'a claim needs an evidence label, one of: ' + EVIDENCE.join(', ') + ' — got: ' + (ev || '(none)') };
        }
      } else {
        ev = 'unknown';
      }
      const prev = records[i];
      const fields = Object.assign({}, prev.fields);
      fields[field] = { text: body, evidence: ev, source: str(source, MAX_SOURCE) };
      const nextRow = Object.assign({}, prev, { fields: fields, updatedAt: now() });
      const next = records.slice(); next[i] = nextRow;
      const w = commit(next);
      if (!w.ok) return w;
      return { ok: true, opportunity: rowView(nextRow) };
    }

    // Set several cells at once (the AI research pass). Every entry must carry its own label — the same
    // refusal applies, and a SINGLE bad entry aborts the whole batch so a partial write never lands.
    function setFields(id, entries) {
      if (!Array.isArray(entries)) return { ok: false, reason: 'entries must be an array' };
      for (const e of entries) {
        if (!e || FIELDS.indexOf(e.field) < 0) return { ok: false, reason: 'unknown field: ' + ((e && e.field) || '(none)') };
        const body = str(e.text, MAX_TEXT);
        if (body && EVIDENCE.indexOf(String(e.evidence == null ? '' : e.evidence)) < 0) {
          return { ok: false, reason: 'field "' + e.field + '" needs an evidence label, one of: ' + EVIDENCE.join(', ') };
        }
      }
      const i = indexOf(id);
      if (i < 0) return { ok: false, reason: 'unknown opportunity: ' + id };
      const prev = records[i];
      const fields = Object.assign({}, prev.fields);
      for (const e of entries) {
        const body = str(e.text, MAX_TEXT);
        fields[e.field] = { text: body, evidence: body ? String(e.evidence) : 'unknown', source: str(e.source, MAX_SOURCE) };
      }
      const nextRow = Object.assign({}, prev, { fields: fields, updatedAt: now() });
      const next = records.slice(); next[i] = nextRow;
      const w = commit(next);
      if (!w.ok) return w;
      return { ok: true, opportunity: rowView(nextRow) };
    }

    function update(id, patch) {
      patch = patch || {};
      const i = indexOf(id);
      if (i < 0) return { ok: false, reason: 'unknown opportunity: ' + id };
      const prev = records[i];
      const nextRow = Object.assign({}, prev);
      if (patch.title != null) {
        const t = str(patch.title, MAX_TITLE).trim();
        if (!t) return { ok: false, reason: 'title cannot be blank' };
        nextRow.title = t;                            // id is NOT re-keyed — see businesses-store for why
      }
      if (patch.template != null) nextRow.template = str(patch.template, 40) || 'custom';
      if (patch.stage != null) {
        const st = String(patch.stage);
        if (STAGES.indexOf(st) < 0) return { ok: false, reason: 'unknown stage: ' + st };
        nextRow.stage = st;
      }
      nextRow.id = prev.id; nextRow.createdAt = prev.createdAt; nextRow.origin = prev.origin;
      nextRow.updatedAt = now();
      const next = records.slice(); next[i] = nextRow;
      const w = commit(next);
      if (!w.ok) return w;
      return { ok: true, opportunity: rowView(nextRow) };
    }

    function setStage(id, stage) { return update(id, { stage: stage }); }

    /* PROMOTE — record that this opportunity BECAME a business. The route creates the business; this only
       stamps the link, so the two stores stay independent and neither reaches into the other's namespace. */
    function markPromoted(id, businessId) {
      const i = indexOf(id);
      if (i < 0) return { ok: false, reason: 'unknown opportunity: ' + id };
      const bid = str(businessId, 120).trim();
      if (!bid) return { ok: false, reason: 'a businessId is required to promote' };
      const nextRow = Object.assign({}, records[i], { stage: 'promoted', businessId: bid, updatedAt: now() });
      const next = records.slice(); next[i] = nextRow;
      const w = commit(next);
      if (!w.ok) return w;
      return { ok: true, opportunity: rowView(nextRow) };
    }

    function remove(id) {
      const i = indexOf(id);
      if (i < 0) return { ok: true };
      const next = records.slice(); next.splice(i, 1);
      const w = commit(next);
      if (!w.ok) return w;
      return { ok: true };
    }

    return {
      EVIDENCE, FIELDS, STAGES,
      snapshot, list, count, get, has, slugFor,
      evidenceMix, missing, completeness,
      create, setField, setFields, update, setStage, markPromoted, remove
    };
  }

  return { makeOpportunitiesStore, EVIDENCE, FIELDS, STAGES, slugFor };
});
