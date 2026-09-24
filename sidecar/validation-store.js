/* sidecar/validation-store.js — the VALIDATION LAB (Business OS Phase 2, master prompt §5).

   A validation run asks ONE question about ONE opportunity and records what came back. The store's job is
   to make FAKE VALIDATION STRUCTURALLY IMPOSSIBLE — that is P2, and it is the whole reason this is a store
   with rules instead of a notes field.

   THE GUARD (the load-bearing rule):
     A run may be marked 'supported' or 'contradicted' ONLY IF it carries at least one piece of evidence
     whose class is `verified` or `analysis`, AND at least one signal on the matching side.
     Everything else — no evidence, only assumptions, only estimates, only predictions, or a verdict with
     nothing behind it — is REFUSED, and the refusal names what is missing.

   Why those two classes and not all six: an assumption restated as a verdict is not validation, and an
   estimate or a prediction is explicitly a guess. "We assumed customers want this, therefore supported" is
   exactly the sentence this guard exists to make unwritable. 'inconclusive' and 'pending' stay open to
   everyone, because "we do not know yet" is always an honest thing to record.

   ISOLATION (P6). Every read names an opportunityId and filters strictly on it; an empty one is REFUSED
   rather than read as "everything". Same rule as business-activity-store.

   PURE: no IO, no clock, no env, no rng. UMD. Mirrors businesses-store.js / opportunities-store.js. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).validationStore = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const EVIDENCE = ['verified', 'analysis', 'assumption', 'estimate', 'prediction', 'unknown'];

  // §5's tools, as a closed vocabulary. A method outside this list is refused, so a run can always be read
  // back as "which of the sanctioned tests did you actually run".
  const METHODS = [
    'competitor-research', 'customer-research', 'search-trend-research', 'pricing-research',
    'review-analysis', 'community-discussion-analysis', 'landing-page-test', 'waitlist-test',
    'survey', 'mvp-test', 'keyword-research', 'market-size-research', 'problem-validation'
  ];

  const VERDICTS = ['pending', 'inconclusive', 'supported', 'contradicted'];

  // The ONLY evidence classes strong enough to carry a verdict. See the header for why.
  const VERDICT_GRADE = ['verified', 'analysis'];

  const MAX_TEXT = 4000;
  const MAX_HYPOTHESIS = 1000;
  const DEFAULT_LIMIT = 300;

  function makeValidationStore(opts) {
    opts = opts || {};
    const records = Array.isArray(opts.records) ? opts.records : [];
    const persist = typeof opts.persist === 'function' ? opts.persist : null;
    const now = typeof opts.now === 'function' ? opts.now : (() => null);
    const limit = (Number.isFinite(opts.limit) && opts.limit > 0) ? Math.floor(opts.limit) : DEFAULT_LIMIT;

    const str = (v, cap) => (v == null ? '' : String(v)).slice(0, cap);
    const forOpp = (opportunityId) => records.filter(r => r && r.opportunityId === opportunityId);
    const newestFirst = (a, b) => (b.seq || 0) - (a.seq || 0);

    function nextSeq(opportunityId) {
      let max = 0;
      for (const r of records) if (r && r.opportunityId === opportunityId && r.seq > max) max = r.seq;
      return max + 1;
    }

    // one labeled evidence item, defensively read (a hand-edited file must not throw on READ).
    function evidenceView(e) {
      const text = str(e && e.text, MAX_TEXT);
      const ev = (e && EVIDENCE.indexOf(e.evidence) >= 0) ? e.evidence : 'unknown';
      return { text: text, evidence: text ? ev : 'unknown', source: str(e && e.source, 500) };
    }
    const strList = (v) => (Array.isArray(v) ? v : []).map(x => str(x, MAX_TEXT)).filter(Boolean);

    const rowView = (r) => ({
      id: r.id,
      seq: r.seq,
      opportunityId: r.opportunityId,
      method: r.method,
      hypothesis: r.hypothesis || '',
      evidence: (Array.isArray(r.evidence) ? r.evidence : []).map(evidenceView),
      supporting: strList(r.supporting),
      contradicting: strList(r.contradicting),
      assumptions: strList(r.assumptions),
      unknowns: strList(r.unknowns),
      risks: strList(r.risks),
      nextTest: r.nextTest || '',
      verdict: r.verdict,
      verdictReason: r.verdictReason || '',
      actor: (r.actor && typeof r.actor === 'object')
        ? { kind: r.actor.kind, name: r.actor.name || '' }
        : { kind: 'system', name: '' },
      at: r.at != null ? r.at : null,
      decidedAt: r.decidedAt != null ? r.decidedAt : null
    });

    function commit(next) {
      if (persist) {
        try { persist(next.map(rowView)); }
        catch (e) { return { ok: false, reason: 'could not persist — denied' }; }
      }
      records.length = 0;
      for (const r of next) records.push(r);
      return { ok: true };
    }

    /* CAN THIS EVIDENCE CARRY THIS VERDICT? The one place the P2 rule lives, so create() and setVerdict()
       cannot drift apart. Returns { ok, reason } — a refusal always names what is missing. */
    function verdictAllowed(evidence, supporting, contradicting, verdict) {
      if (verdict === 'pending' || verdict === 'inconclusive') return { ok: true };
      const graded = (Array.isArray(evidence) ? evidence : [])
        .map(evidenceView)
        .filter(e => e.text && VERDICT_GRADE.indexOf(e.evidence) >= 0);
      if (!graded.length) {
        return {
          ok: false,
          reason: 'cannot mark a run "' + verdict + '" without at least one VERIFIED or ANALYSIS evidence item — ' +
            'assumptions, estimates, predictions and unknowns cannot carry a verdict (P2: no fake validation)'
        };
      }
      const side = (verdict === 'supported') ? supporting : contradicting;
      if (!strList(side).length) {
        return {
          ok: false,
          reason: 'cannot mark a run "' + verdict + '" with no ' + (verdict === 'supported' ? 'supporting' : 'contradicting') +
            ' signal recorded — name the signal, or record the run as inconclusive'
        };
      }
      return { ok: true };
    }

    /* CREATE a run. A run may be opened as 'pending' (the usual case: you have not run the test yet) or
       with a verdict — but a verdict at create time is held to the SAME guard as setVerdict. */
    function create(opportunityId, meta) {
      meta = meta || {};
      const oid = str(opportunityId, 120).trim();
      if (!oid) return { ok: false, reason: 'an opportunityId is required (isolation is by key — never implied)' };
      const method = str(meta.method, 60);
      if (METHODS.indexOf(method) < 0) return { ok: false, reason: 'unknown method: ' + (method || '(none)') + ' — one of: ' + METHODS.join(', ') };
      const hypothesis = str(meta.hypothesis, MAX_HYPOTHESIS).trim();
      if (!hypothesis) return { ok: false, reason: 'a hypothesis is required — a validation run must ask a question' };

      // every supplied evidence item must carry a valid label (same refusal as opportunities-store).
      const rawEvidence = Array.isArray(meta.evidence) ? meta.evidence : [];
      for (const e of rawEvidence) {
        const body = str(e && e.text, MAX_TEXT);
        if (body && EVIDENCE.indexOf(String((e && e.evidence) == null ? '' : e.evidence)) < 0) {
          return { ok: false, reason: 'evidence needs a label, one of: ' + EVIDENCE.join(', ') };
        }
      }
      const evidence = rawEvidence.map(evidenceView);
      const supporting = strList(meta.supporting);
      const contradicting = strList(meta.contradicting);
      const verdict = meta.verdict != null ? String(meta.verdict) : 'pending';
      if (VERDICTS.indexOf(verdict) < 0) return { ok: false, reason: 'unknown verdict: ' + verdict };
      const allowed = verdictAllowed(evidence, supporting, contradicting, verdict);
      if (!allowed.ok) return allowed;

      const seq = nextSeq(oid);
      const a = meta.actor || {};
      const at = now();
      const entry = {
        // The separator is '~', NOT '#'. A run's id travels in a URL PATH (/api/validations/<id>), and '#'
        // is the fragment delimiter — a browser would strip everything after it and the request would arrive
        // as /api/validations/acme, matching nothing. '~' is unreserved in RFC 3986, is never percent-encoded,
        // and cannot occur in a slug (slugFor maps every non-alphanumeric to '-'), so it is unambiguous.
        id: oid + '~v' + seq, seq: seq, opportunityId: oid, method: method, hypothesis: hypothesis,
        evidence: evidence, supporting: supporting, contradicting: contradicting,
        assumptions: strList(meta.assumptions), unknowns: strList(meta.unknowns), risks: strList(meta.risks),
        nextTest: str(meta.nextTest, MAX_TEXT),
        verdict: verdict, verdictReason: str(meta.verdictReason, MAX_TEXT),
        actor: { kind: (a.kind === 'agent' || a.kind === 'user') ? a.kind : 'system', name: str(a.name, 120) },
        at: at, decidedAt: (verdict === 'pending') ? null : at
      };

      // cap THIS opportunity only: drop its oldest runs, never another opportunity's.
      let next = records.slice(); next.push(entry);
      const mine = next.filter(r => r && r.opportunityId === oid).sort(newestFirst);
      if (mine.length > limit) {
        const drop = new Set(mine.slice(limit).map(r => r.id));
        next = next.filter(r => !drop.has(r.id));
      }
      const w = commit(next);
      if (!w.ok) return w;
      return { ok: true, validation: rowView(entry) };
    }

    /* ATTACH the result of a run that was opened as 'pending'. Same guard, same refusal text. */
    function record(id, patch) {
      patch = patch || {};
      const i = records.findIndex(r => r && r.id === id);
      if (i < 0) return { ok: false, reason: 'unknown validation run: ' + id };
      const prev = records[i];
      const nextRow = Object.assign({}, prev);

      if (patch.evidence != null) {
        if (!Array.isArray(patch.evidence)) return { ok: false, reason: 'evidence must be an array' };
        for (const e of patch.evidence) {
          const body = str(e && e.text, MAX_TEXT);
          if (body && EVIDENCE.indexOf(String((e && e.evidence) == null ? '' : e.evidence)) < 0) {
            return { ok: false, reason: 'evidence needs a label, one of: ' + EVIDENCE.join(', ') };
          }
        }
        nextRow.evidence = patch.evidence.map(evidenceView);
      }
      for (const k of ['supporting', 'contradicting', 'assumptions', 'unknowns', 'risks']) {
        if (patch[k] != null) nextRow[k] = strList(patch[k]);
      }
      if (patch.nextTest != null) nextRow.nextTest = str(patch.nextTest, MAX_TEXT);

      if (patch.verdict != null) {
        const v = String(patch.verdict);
        if (VERDICTS.indexOf(v) < 0) return { ok: false, reason: 'unknown verdict: ' + v };
        const allowed = verdictAllowed(nextRow.evidence, nextRow.supporting, nextRow.contradicting, v);
        if (!allowed.ok) return allowed;
        nextRow.verdict = v;
        nextRow.verdictReason = str(patch.verdictReason, MAX_TEXT);
        nextRow.decidedAt = (v === 'pending') ? null : now();
      }
      nextRow.id = prev.id; nextRow.seq = prev.seq; nextRow.opportunityId = prev.opportunityId; nextRow.at = prev.at;

      const next = records.slice(); next[i] = nextRow;
      const w = commit(next);
      if (!w.ok) return w;
      return { ok: true, validation: rowView(nextRow) };
    }

    // READ one opportunity's runs, newest first. An empty id returns [] rather than everything.
    function list(opportunityId) {
      const oid = str(opportunityId, 120).trim();
      if (!oid) return [];
      return forOpp(oid).slice().sort(newestFirst).map(rowView);
    }
    function get(id) { const i = records.findIndex(r => r && r.id === id); return i < 0 ? null : rowView(records[i]); }
    function count(opportunityId) { const oid = str(opportunityId, 120).trim(); return oid ? forOpp(oid).length : 0; }

    // A real tally of verdicts for one opportunity — never a "validation score".
    function summary(opportunityId) {
      const rows = list(opportunityId);
      const out = { total: rows.length, pending: 0, inconclusive: 0, supported: 0, contradicted: 0 };
      for (const r of rows) if (Object.prototype.hasOwnProperty.call(out, r.verdict)) out[r.verdict]++;
      return out;
    }

    function remove(id) {
      const i = records.findIndex(r => r && r.id === id);
      if (i < 0) return { ok: true };
      const next = records.slice(); next.splice(i, 1);
      const w = commit(next);
      if (!w.ok) return w;
      return { ok: true };
    }

    // CLEAR one opportunity's runs. Never touches another's.
    function clear(opportunityId) {
      const oid = str(opportunityId, 120).trim();
      if (!oid) return { ok: false, reason: 'an opportunityId is required' };
      const next = records.filter(r => !(r && r.opportunityId === oid));
      const w = commit(next);
      if (!w.ok) return w;
      return { ok: true };
    }

    return {
      EVIDENCE, METHODS, VERDICTS, VERDICT_GRADE, LIMIT: limit,
      create, record, list, get, count, summary, remove, clear,
      verdictAllowed
    };
  }

  return { makeValidationStore, EVIDENCE, METHODS, VERDICTS, VERDICT_GRADE, DEFAULT_LIMIT };
});
