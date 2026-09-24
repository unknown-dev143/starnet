/* sidecar/business-crm-store.js — §16 BUSINESS CRM (Business OS Phase 4).

   §16, verbatim: "A lightweight CRM tracking leads · prospects · customers · interactions · sales stages ·
   notes · tasks · follow-ups. The AI identifies which items need attention."

   THE LAST SENTENCE IS THE ONE THAT NEEDS A GUARD. "The AI identifies which items need attention" is an
   invitation to invent a lead score — and a fabricated lead score is worse than no score, because a
   salesperson acts on it. So `needsAttention()` here is NOT a model judgement and does not pretend to be
   one. It applies TWO NAMED RULES to the stored facts and returns them labelled:

     · OVERDUE   — a follow-up whose dueAt has passed and which is not done.
     · QUIET     — a contact with no logged interaction in the last N days (default 30).

   Both are arithmetic on timestamps the store actually holds. The response carries the rule that fired and
   the raw inputs, so a reader can check the claim instead of trusting it (P1). There is no score, no
   ranking, and no "hot lead" label anywhere in this module (P7).

   WHY INTERACTIONS AND FOLLOW-UPS ARE EMBEDDED IN THE CONTACT ROW. Same reason business-tasks-store embeds
   `logs`: they are strictly owned by one contact, always read together with it, and bounded per contact. A
   separate array would need its own tenancy key and its own cross-tenant check for no benefit — and the
   embed is what makes the P6 rule below cheap to enforce.

   ISOLATION (P6). Every contact belongs to one business and carries its businessId. Because contacts and
   their interactions live in the SAME store, this module can enforce the rule the flat stores elsewhere
   cannot: an interaction or follow-up addressed to a contact of ANOTHER business is REFUSED, not merely
   unlikely. An empty businessId is refused on every read and write, the same rule as the other Phase 1-4
   stores.

   PURE: no IO, no clock, no env, no rng. `persist` and `now` injected; `needsAttention` takes the clock as
   an ARGUMENT so the module itself never reads one. UMD. Mirrors business-tasks-store.js. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).businessCrmStore = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // §16's relationship stages. A contact moves along these; 'churned' is kept distinct from a plain delete
  // because a customer who left is a fact worth remembering.
  const STAGES = ['lead', 'prospect', 'customer', 'churned'];

  // §16's interactions, as a closed vocabulary, so "what contact did we have" can be counted by kind.
  const INTERACTION_KINDS = ['email', 'call', 'meeting', 'message', 'note', 'purchase', 'support'];

  const MAX_NAME = 200;
  const MAX_TEXT = 2000;
  const MAX_ID = 120;
  const MAX_TAGS = 32;
  const MAX_INTERACTIONS = 200;              // per contact, oldest dropped
  const MAX_FOLLOWUPS = 100;                 // per contact
  const DEFAULT_LIMIT = 2000;                // contacts per business
  const QUIET_DAYS = 30;

  function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }

  function makeBusinessCrmStore(opts) {
    opts = opts || {};
    const records = Array.isArray(opts.records) ? opts.records : [];
    const persist = typeof opts.persist === 'function' ? opts.persist : null;
    const now = typeof opts.now === 'function' ? opts.now : (() => null);
    const limit = (Number.isFinite(opts.limit) && opts.limit > 0) ? Math.floor(opts.limit) : DEFAULT_LIMIT;

    const str = (v, cap) => (v == null ? '' : String(v)).slice(0, cap);
    const indexOf = (id) => records.findIndex(r => r && r.id === id);
    const forBiz = (businessId) => records.filter(r => r && r.businessId === businessId);
    const biz = (v) => str(v, MAX_ID).trim();
    const strList = (v, cap, itemCap) => (Array.isArray(v) ? v : []).map(x => str(x, itemCap || MAX_TEXT)).filter(Boolean).slice(0, cap);

    function nextSeq(businessId) {
      let max = 0;
      for (const r of records) if (r && r.businessId === businessId && r.seq > max) max = r.seq;
      return max + 1;
    }

    const interactionView = (x) => ({
      at: x.at != null ? x.at : null,
      kind: x.kind || 'note',
      summary: x.summary || ''
    });
    const followUpView = (f) => ({
      id: f.id, at: f.at != null ? f.at : null, dueAt: f.dueAt != null ? f.dueAt : null,
      what: f.what || '', done: !!f.done, doneAt: f.doneAt != null ? f.doneAt : null
    });

    const rowView = (r) => ({
      id: r.id, seq: r.seq, businessId: r.businessId,
      name: r.name, email: r.email || '', org: r.org || '',
      stage: r.stage, tags: (Array.isArray(r.tags) ? r.tags : []).slice(),
      interactions: (Array.isArray(r.interactions) ? r.interactions : []).map(interactionView),
      followUps: (Array.isArray(r.followUps) ? r.followUps : []).map(followUpView),
      createdAt: r.createdAt != null ? r.createdAt : null,
      updatedAt: r.updatedAt != null ? r.updatedAt : null
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

    // ---- reads -------------------------------------------------------------------------------------
    function contacts(businessId, o) {
      const b = biz(businessId);
      if (!b) return [];
      o = o || {};
      let rows = forBiz(b);
      if (o.stage) rows = rows.filter(r => r.stage === String(o.stage));
      if (o.q) {
        const needle = String(o.q).toLowerCase();
        rows = rows.filter(r =>
          String(r.name || '').toLowerCase().indexOf(needle) >= 0 ||
          String(r.email || '').toLowerCase().indexOf(needle) >= 0 ||
          String(r.org || '').toLowerCase().indexOf(needle) >= 0);
      }
      return rows.slice().sort((a, b2) => (a.seq || 0) - (b2.seq || 0)).map(rowView);
    }
    function contact(id) { const i = indexOf(id); return i < 0 ? null : rowView(records[i]); }
    function has(id) { return indexOf(id) >= 0; }
    function countContacts(businessId) { const b = biz(businessId); return b ? forBiz(b).length : 0; }

    // Counts by stage and by interaction kind. Counts only — see the header on why there is no score.
    function summary(businessId) {
      const rows = contacts(businessId);
      const out = { total: rows.length, byStage: {}, interactions: {}, openFollowUps: 0 };
      for (const s of STAGES) out.byStage[s] = 0;
      for (const k of INTERACTION_KINDS) out.interactions[k] = 0;
      for (const r of rows) {
        if (Object.prototype.hasOwnProperty.call(out.byStage, r.stage)) out.byStage[r.stage]++;
        for (const it of r.interactions) if (Object.prototype.hasOwnProperty.call(out.interactions, it.kind)) out.interactions[it.kind]++;
        for (const f of r.followUps) if (!f.done) out.openFollowUps++;
      }
      return out;
    }

    /* Locate a follow-up by its own id across the business's contacts. The id embeds its contact
       (`<contactId>~u<n>`), so this is a lookup, not a guess. */
    function findFollowUp(businessId, followUpId) {
      const b = biz(businessId);
      const fid = str(followUpId, MAX_ID).trim();
      if (!b || !fid) return null;
      for (const r of forBiz(b)) {
        const list = Array.isArray(r.followUps) ? r.followUps : [];
        const f = list.filter(x => x && x.id === fid)[0];
        if (f) return { contactId: r.id, contactName: r.name, followUp: followUpView(f) };
      }
      return null;
    }

    function openFollowUps(businessId, o) {
      o = o || {};
      const b = biz(businessId);
      if (!b) return [];
      const out = [];
      for (const r of forBiz(b)) {
        for (const f of (Array.isArray(r.followUps) ? r.followUps : [])) {
          if (f.done) continue;
          if (Number.isFinite(o.dueBefore) && !(num(f.dueAt) && num(f.dueAt) <= o.dueBefore)) continue;
          out.push({ contactId: r.id, contactName: r.name, followUp: followUpView(f) });
        }
      }
      return out.sort((a, b2) => num(a.followUp.dueAt) - num(b2.followUp.dueAt));
    }

    /* NEEDS ATTENTION — two named rules over stored facts. See the header: no score, no ranking, and the
       rule that fired travels with every row so the claim is checkable. `nowMs` is an ARGUMENT because this
       module owns no clock. */
    function needsAttention(businessId, nowMs, o) {
      o = o || {};
      const b = biz(businessId);
      const at = num(nowMs);
      const quietDays = (Number.isFinite(o.quietDays) && o.quietDays > 0) ? Math.floor(o.quietDays) : QUIET_DAYS;
      const quietMs = quietDays * 86400000;
      if (!b || !at) return { rules: [], overdue: [], quiet: [], quietDays: quietDays };

      const overdue = [];
      const quiet = [];
      for (const r of contacts(b)) {
        for (const f of r.followUps) {
          if (f.done) continue;
          if (num(f.dueAt) && num(f.dueAt) < at) {
            overdue.push({
              rule: 'overdue-follow-up',
              contactId: r.id, contactName: r.name, followUpId: f.id,
              what: f.what, dueAt: f.dueAt, daysLate: Math.floor((at - num(f.dueAt)) / 86400000)
            });
          }
        }
        const last = r.interactions.length ? Math.max.apply(null, r.interactions.map(x => num(x.at))) : 0;
        const since = last || num(r.createdAt);
        if (since && (at - since) > quietMs) {
          quiet.push({
            rule: 'no-recent-interaction',
            contactId: r.id, contactName: r.name, stage: r.stage,
            lastInteractionAt: last || null, daysQuiet: Math.floor((at - since) / 86400000)
          });
        }
      }
      return {
        rules: [
          'overdue-follow-up — a follow-up whose dueAt has passed and is not done',
          'no-recent-interaction — no logged interaction in the last ' + quietDays + ' days'
        ],
        quietDays: quietDays,
        overdue: overdue.sort((a, b2) => b2.daysLate - a.daysLate),
        quiet: quiet.sort((a, b2) => b2.daysQuiet - a.daysQuiet)
      };
    }

    // ---- writes ------------------------------------------------------------------------------------
    function addContact(businessId, meta) {
      meta = meta || {};
      const b = biz(businessId);
      if (!b) return { ok: false, reason: 'a businessId is required (isolation is by key — never implied)' };
      const name = str(meta.name, MAX_NAME).trim();
      if (!name) return { ok: false, reason: 'a contact needs a name' };
      const stage = meta.stage != null ? String(meta.stage) : 'lead';
      if (STAGES.indexOf(stage) < 0) return { ok: false, reason: 'unknown stage: ' + stage + ' — one of: ' + STAGES.join(', ') };

      const at = now();
      const seq = nextSeq(b);
      const row = {
        // '~' not '#' — a contact id travels in a URL path (see validation-store.js).
        id: b + '~c' + seq, seq: seq, businessId: b,
        name: name, email: str(meta.email, MAX_NAME), org: str(meta.org, MAX_NAME),
        stage: stage, tags: strList(meta.tags, MAX_TAGS, 60),
        interactions: [], followUps: [],
        createdAt: at, updatedAt: at
      };

      let next = records.slice(); next.push(row);
      const mine = next.filter(r => r && r.businessId === b);
      if (mine.length > limit) {
        const keep = new Set(mine.slice(mine.length - limit).map(r => r.id));
        next = next.filter(r => r.businessId !== b || keep.has(r.id));
      }
      const w = commit(next);
      if (!w.ok) return w;
      return { ok: true, contact: rowView(row) };
    }

    function updateContact(id, patch) {
      patch = patch || {};
      const i = indexOf(id);
      if (i < 0) return { ok: false, reason: 'unknown contact: ' + id };
      const prev = records[i];
      const nextRow = rowView(prev);

      if (patch.name != null) {
        const n = str(patch.name, MAX_NAME).trim();
        if (!n) return { ok: false, reason: 'name cannot be blank' };
        nextRow.name = n;
      }
      if (patch.email != null) nextRow.email = str(patch.email, MAX_NAME);
      if (patch.org != null) nextRow.org = str(patch.org, MAX_NAME);
      if (patch.tags != null) nextRow.tags = strList(patch.tags, MAX_TAGS, 60);
      if (patch.stage != null) {
        const s = String(patch.stage);
        if (STAGES.indexOf(s) < 0) return { ok: false, reason: 'unknown stage: ' + s };
        nextRow.stage = s;
      }

      nextRow.id = prev.id; nextRow.seq = prev.seq; nextRow.businessId = prev.businessId;
      nextRow.createdAt = prev.createdAt;
      nextRow.updatedAt = now();

      const next = records.slice(); next[i] = nextRow;
      const w = commit(next);
      if (!w.ok) return w;
      return { ok: true, contact: rowView(nextRow) };
    }

    function setStage(id, stage) { return updateContact(id, { stage: stage }); }

    /* LOG AN INTERACTION. The businessId is REQUIRED and must match the contact's — a mismatch is refused
       (P6). This is the check a separate interactions array could not make without its own tenancy key. */
    function logInteraction(businessId, contactId, meta) {
      meta = meta || {};
      const b = biz(businessId);
      if (!b) return { ok: false, reason: 'a businessId is required' };
      const i = indexOf(contactId);
      if (i < 0) return { ok: false, reason: 'unknown contact: ' + contactId };
      const prev = records[i];
      if (prev.businessId !== b) {
        return { ok: false, reason: 'contact ' + contactId + ' belongs to business "' + prev.businessId + '", not "' + b + '" — cross-business contact is refused (P6)' };
      }
      const kind = meta.kind != null ? String(meta.kind) : 'note';
      if (INTERACTION_KINDS.indexOf(kind) < 0) {
        return { ok: false, reason: 'unknown interaction kind: ' + kind + ' — one of: ' + INTERACTION_KINDS.join(', ') };
      }
      const summary = str(meta.summary, MAX_TEXT).trim();
      if (!summary) return { ok: false, reason: 'an interaction needs a summary — what happened' };

      const list = (Array.isArray(prev.interactions) ? prev.interactions : []).slice();
      list.push({ at: (meta.at != null && isFinite(Number(meta.at))) ? Number(meta.at) : now(), kind: kind, summary: summary });
      // cap per contact: drop the OLDEST, keeping the recent history that a CRM is actually read for.
      const kept = list.length > MAX_INTERACTIONS ? list.slice(list.length - MAX_INTERACTIONS) : list;

      const nextRow = Object.assign({}, prev, { interactions: kept, updatedAt: now() });
      const next = records.slice(); next[i] = nextRow;
      const w = commit(next);
      if (!w.ok) return w;
      return { ok: true, contact: rowView(nextRow) };
    }

    function addFollowUp(businessId, contactId, meta) {
      meta = meta || {};
      const b = biz(businessId);
      if (!b) return { ok: false, reason: 'a businessId is required' };
      const i = indexOf(contactId);
      if (i < 0) return { ok: false, reason: 'unknown contact: ' + contactId };
      const prev = records[i];
      if (prev.businessId !== b) {
        return { ok: false, reason: 'contact ' + contactId + ' belongs to business "' + prev.businessId + '", not "' + b + '" — cross-business follow-up is refused (P6)' };
      }
      const what = str(meta.what, MAX_TEXT).trim();
      if (!what) return { ok: false, reason: 'a follow-up needs to say what it is' };
      let dueAt = meta.dueAt;
      if (dueAt == null || dueAt === '') dueAt = null;
      else {
        dueAt = Number(dueAt);
        if (!isFinite(dueAt) || dueAt <= 0) return { ok: false, reason: 'dueAt must be an epoch-ms number' };
      }

      const list = (Array.isArray(prev.followUps) ? prev.followUps : []).slice();
      list.push({ id: contactId + '~u' + (list.length + 1), at: now(), dueAt: dueAt, what: what, done: false, doneAt: null });
      const kept = list.length > MAX_FOLLOWUPS ? list.slice(list.length - MAX_FOLLOWUPS) : list;

      const nextRow = Object.assign({}, prev, { followUps: kept, updatedAt: now() });
      const next = records.slice(); next[i] = nextRow;
      const w = commit(next);
      if (!w.ok) return w;
      return { ok: true, contact: rowView(nextRow), followUp: followUpView(kept[kept.length - 1]) };
    }

    function completeFollowUp(businessId, followUpId) {
      const b = biz(businessId);
      if (!b) return { ok: false, reason: 'a businessId is required' };
      const found = findFollowUp(b, followUpId);
      if (!found) return { ok: false, reason: 'unknown follow-up: ' + followUpId };
      if (found.followUp.done) return { ok: false, reason: 'that follow-up is already done' };

      const i = indexOf(found.contactId);
      const prev = records[i];
      const list = (Array.isArray(prev.followUps) ? prev.followUps : []).map(f =>
        (f && f.id === followUpId) ? Object.assign({}, f, { done: true, doneAt: now() }) : f);
      const nextRow = Object.assign({}, prev, { followUps: list, updatedAt: now() });
      const next = records.slice(); next[i] = nextRow;
      const w = commit(next);
      if (!w.ok) return w;
      return { ok: true, contact: rowView(nextRow) };
    }

    // REMOVE a contact. Refuses while a follow-up is still open, so a planned action cannot vanish with the
    // record of the person it was about (the same rule as a task with dependents).
    function removeContact(id) {
      const i = indexOf(id);
      if (i < 0) return { ok: true, removed: 0 };
      const prev = records[i];
      const open = (Array.isArray(prev.followUps) ? prev.followUps : []).filter(f => f && !f.done);
      if (open.length) {
        return { ok: false, reason: open.length + ' open follow-up(s) on this contact — close them first' };
      }
      const next = records.slice(); next.splice(i, 1);
      const w = commit(next);
      if (!w.ok) return w;
      return { ok: true, removed: 1 };
    }

    function clear(businessId) {
      const b = biz(businessId);
      if (!b) return { ok: false, reason: 'a businessId is required' };
      const next = records.filter(r => !(r && r.businessId === b));
      const w = commit(next);
      if (!w.ok) return w;
      return { ok: true };
    }

    return {
      STAGES, INTERACTION_KINDS, QUIET_DAYS, LIMIT: limit,
      contacts, contact, has, countContacts, summary, findFollowUp, openFollowUps, needsAttention,
      addContact, updateContact, setStage, logInteraction, addFollowUp, completeFollowUp, removeContact, clear
    };
  }

  return { makeBusinessCrmStore, STAGES, INTERACTION_KINDS, QUIET_DAYS, DEFAULT_LIMIT };
});
