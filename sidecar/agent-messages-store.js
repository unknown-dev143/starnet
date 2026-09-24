/* sidecar/agent-messages-store.js — AGENT COMMUNICATION (master prompt §7: the team's "communication").

   The readable record of what one agent said to another, or to the Commander, inside a business. §7 lists
   communication as a first-class part of the team, and it has to be a real, durable log rather than an
   in-memory relay: a handoff ("I finished the market research, here are the numbers") is only useful if the
   receiving agent can read it AFTER the sending run ended.

   WHAT IT IS NOT. This is not the station chat (frontend chat.js) and not the run event stream. It is the
   business's internal correspondence — addressed, typed, and scoped. Messages carry a closed `kind` so the
   UI can render a handoff differently from a report, and they name both ends explicitly so nothing has to be
   inferred from ordering.

   ISOLATION (P6). Every message belongs to exactly one business and every read filters on it; there is no
   cross-business read. `from`/`to` are free identifiers (an agentId or the literal 'user') because the store
   must not depend on the agent store — but the ROUTE validates them against the business's actual agents, so
   a message cannot be addressed to a stranger.

   APPEND-ONLY + BOUNDED. Entries are never edited. A business is capped at `limit` messages (default 500) and
   the OLDEST are dropped on overflow, so a chatty pair of agents cannot grow the file without bound.

   PURE: no IO, no clock, no env, no rng. Persist-before-commit (fail-closed). UMD. */

'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).agentMessagesStore = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Closed vocabulary — a message whose type is free text cannot be routed or styled.
  const KINDS = ['note', 'request', 'handoff', 'decision', 'report'];

  const DEFAULT_LIMIT = 500;
  const MAX_SUBJECT = 200;
  const MAX_BODY = 4000;
  const MAX_REF = 120;

  function makeAgentMessagesStore(opts) {
    opts = opts || {};
    const records = Array.isArray(opts.records) ? opts.records : [];
    const persist = typeof opts.persist === 'function' ? opts.persist : null;
    const now = typeof opts.now === 'function' ? opts.now : (() => null);
    const limit = (Number.isFinite(opts.limit) && opts.limit > 0) ? Math.floor(opts.limit) : DEFAULT_LIMIT;

    const str = (v, cap) => (v == null ? '' : String(v)).slice(0, cap);
    const forBiz = (businessId) => records.filter(r => r && r.businessId === businessId);
    const newestFirst = (a, b) => (b.seq || 0) - (a.seq || 0);

    function nextSeq(businessId) {
      let max = 0;
      for (const r of records) if (r && r.businessId === businessId && r.seq > max) max = r.seq;
      return max + 1;
    }

    const strList = (v) => (Array.isArray(v) ? v : []).map(x => str(x, MAX_REF)).filter(Boolean);

    const rowView = (r) => ({
      id: r.id, seq: r.seq, businessId: r.businessId,
      from: r.from, to: r.to, kind: r.kind,
      subject: r.subject || '', body: r.body || '',
      refs: strList(r.refs),
      at: r.at != null ? r.at : null
    });

    /* SEND one message. businessId, from, to and kind are required. Persist-before-commit. */
    function send(businessId, msg) {
      msg = msg || {};
      const bid = str(businessId, 120).trim();
      if (!bid) return { ok: false, reason: 'a businessId is required (isolation is by key — never implied)' };

      const from = str(msg.from, 120).trim();
      if (!from) return { ok: false, reason: 'a sender is required' };
      const to = str(msg.to, 120).trim();
      if (!to) return { ok: false, reason: 'a recipient is required' };
      if (from === to) return { ok: false, reason: 'an agent cannot message itself' };

      const kind = String(msg.kind == null ? '' : msg.kind);
      if (KINDS.indexOf(kind) < 0) return { ok: false, reason: 'unknown message kind: "' + kind + '" — one of: ' + KINDS.join(', ') };

      const body = str(msg.body, MAX_BODY).trim();
      const subject = str(msg.subject, MAX_SUBJECT).trim();
      if (!body && !subject) return { ok: false, reason: 'a message needs a subject or a body' };

      const seq = nextSeq(bid);
      const row = {
        id: bid + '~m' + seq,
        seq: seq, businessId: bid,
        from: from, to: to, kind: kind,
        subject: subject, body: body,
        refs: strList(msg.refs),
        at: now()
      };

      let next = records.slice(); next.push(row);
      const mine = next.filter(r => r && r.businessId === bid).sort(newestFirst);
      if (mine.length > limit) {
        const drop = new Set(mine.slice(limit).map(r => r.id));
        next = next.filter(r => !drop.has(r.id));
      }
      if (persist) {
        try { persist(next.map(rowView)); }
        catch (e) { return { ok: false, reason: 'could not persist the message — not sent' }; }
      }
      records.length = 0;
      for (const r of next) records.push(r);
      return { ok: true, message: rowView(row) };
    }

    /* READ one business's messages, newest first. `with` narrows to messages involving one party (either
       direction), which is what a per-agent inbox needs. */
    function list(businessId, o) {
      const bid = str(businessId, 120).trim();
      if (!bid) return [];
      let rows = forBiz(bid);
      const withWho = (o && o.with != null) ? str(o.with, 120).trim() : '';
      if (withWho) rows = rows.filter(r => r.from === withWho || r.to === withWho);
      const wantKind = (o && o.kind != null) ? String(o.kind) : '';
      if (wantKind) rows = rows.filter(r => r.kind === wantKind);
      rows = rows.slice().sort(newestFirst).map(rowView);
      const n = (o && Number.isFinite(o.limit) && o.limit > 0) ? Math.floor(o.limit) : 0;
      return n ? rows.slice(0, n) : rows;
    }

    // Everything said between two parties, in either direction — a two-party thread.
    function thread(businessId, a, b) {
      const x = str(a, 120).trim(), y = str(b, 120).trim();
      if (!x || !y) return [];
      return list(businessId).filter(m => (m.from === x && m.to === y) || (m.from === y && m.to === x));
    }

    function count(businessId) { const bid = str(businessId, 120).trim(); return bid ? forBiz(bid).length : 0; }

    // Distinct parties that appear in a business's messages — the UI's contact list.
    function parties(businessId) {
      const s = new Set();
      for (const m of list(businessId)) { s.add(m.from); s.add(m.to); }
      return Array.from(s).sort();
    }

    function clear(businessId) {
      const bid = str(businessId, 120).trim();
      if (!bid) return { ok: false, reason: 'a businessId is required' };
      const next = records.filter(r => !(r && r.businessId === bid));
      if (persist) {
        try { persist(next.map(rowView)); }
        catch (e) { return { ok: false, reason: 'could not persist the clear — messages kept' }; }
      }
      records.length = 0;
      for (const r of next) records.push(r);
      return { ok: true };
    }

    return { KINDS, LIMIT: limit, send, list, thread, count, parties, clear };
  }

  return { makeAgentMessagesStore, KINDS, DEFAULT_LIMIT };
});
