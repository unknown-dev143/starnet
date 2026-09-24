/* sidecar/halt.js — the E-STOP kill logic, factored out of the host so it is unit-testable.

   TWO DOORS, ONE ENGINE.
     killAll(runs, ...hubInflights)                     — the STATION E-STOP: abort EVERY in-flight run.
     killScope(scopeKey, tags, runs, ...hubInflights)   — the SCOPED E-STOP: abort only the runs whose
                                                          scope tag matches (the per-business pause, §21).

   `runs` is the browser map runId -> AbortController; each trailing argument is a messaging-hub inflight map
   (Map chatId -> { abort, superseded }). MULTIPLE hub maps may be passed (Telegram AND Discord AND Slack …
   share the same shape). Hub runs are marked `superseded` BEFORE aborting so the hub does not deliver their
   now-stale partial reply after the kill (mirrors how the hub supersedes a run when a newer message arrives),
   and ALSO marked `halted`, which is what lets the hub tell that chat it was stopped on purpose rather than
   returning the same silence a supersede earns.

   AN E-STOP MUST NEVER ITSELF THROW. Tolerant of null/absent maps, of a null hub record, and of an individual
   abort throwing. Both doors report what they TOUCHED, not what cooperated: a run whose abort threw still
   counts as halted, because it was reached and attempted (this is the pre-existing killAll contract, kept
   byte-for-byte by the shared engine below).

   SCOPING IS FAIL-SAFE, NEVER FAIL-OPEN. killScope refuses an empty scope key rather than reading it as
   "everything", and a hub map that cannot be keyed (no entries()) is SKIPPED by a scoped kill rather than
   killed wholesale — an unattributable run is not this business's run. Over-killing is the one failure mode
   a scoped stop must not have. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).halt = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* The ONE place the "an E-STOP must never throw" contract lives. It RETURNS the thrown error instead of
     swallowing it into an empty catch, which matters twice over: the contract is stated in one readable
     line rather than re-derived at six call sites, and the body is real, so this cannot rot into the kind of
     silent catch the fail-open ratchet (test/failopen-ratchet.test.js) exists to catch. Callers ignore the
     return value on purpose — a stop button that aborts and then reports the abort's own failure has already
     done its job. */
  function attempt(fn) { try { fn(); return null; } catch (e) { return e; } }

  /* The ONE kill engine. `want(key, rec)` decides whether a candidate dies; a null matcher means "everything"
     (killAll's contract). Counting mirrors the original killAll exactly:
       - browser run: counted even when its abort throws;
       - hub rec: counted even when it is falsy or its abort throws.
     A scoped kill needs the KEY, so it walks entries() and skips any map that has none. */
  function kill(want, runs, hubInflights) {
    let halted = 0;

    if (runs && typeof runs.values === 'function') {
      if (want) {
        const pairs = (typeof runs.entries === 'function') ? Array.from(runs.entries()) : [];
        for (const pair of pairs) {
          let hit = false;
          try { hit = !!want(pair[0], pair[1]); } catch (_) { hit = false; }
          if (!hit) continue;
          attempt(() => { if (pair[1] && typeof pair[1].abort === 'function') pair[1].abort(); });
          halted++;
        }
      } else {
        for (const ac of runs.values()) { attempt(() => { if (ac && typeof ac.abort === 'function') ac.abort(); }); halted++; }
      }
    }

    for (const hubInflight of hubInflights) {
      if (!hubInflight || typeof hubInflight.values !== 'function') continue;
      if (want) {
        // a scoped kill cannot attribute an unkeyed map — it must not guess, so it leaves it alone.
        if (typeof hubInflight.entries !== 'function') continue;
        for (const pair of Array.from(hubInflight.entries())) {
          let hit = false;
          try { hit = !!want(pair[0], pair[1]); } catch (_) { hit = false; }
          if (!hit) continue;
          attempt(() => {
            // `halted` alongside `superseded`: both must silence this run's now-stale partial, but they mean
            // different things downstream. A supersede means a NEWER message owns the conversation and is about
            // to answer, so silence is correct; an E-STOP means nothing else is coming, and on a phone (no floor,
            // no browser, no other signal) silence made a deliberate stop byte-identical to a crashed bot.
            const rec = pair[1];
            if (rec) { rec.superseded = true; rec.halted = true; if (rec.abort && typeof rec.abort.abort === 'function') rec.abort.abort(); }
          });
          halted++;
        }
        continue;
      }
      for (const rec of hubInflight.values()) {
        attempt(() => {
          if (rec) { rec.superseded = true; rec.halted = true; if (rec.abort && typeof rec.abort.abort === 'function') rec.abort.abort(); }
        });
        halted++;
      }
    }

    return halted;
  }

  function killAll(runs, ...hubInflights) { return kill(null, runs, hubInflights); }

  // The scope-key lookup: a Map, a plain object, or a function(key) -> scopeKey.
  function tagLookup(tags) {
    if (typeof tags === 'function') return tags;
    if (tags && typeof tags.get === 'function') return (k) => tags.get(k);
    if (tags && typeof tags === 'object') return (k) => tags[k];
    return () => undefined;
  }

  /* SCOPED KILL. Aborts only the candidates whose tag equals scopeKey, leaving every other run on the station
     untouched. `tags` may be a Map/object keyed by the SAME key the run maps use (runId for `runs`, chatId for
     a hub map), or a function(key) -> tag. An empty scope key returns 0 — never "everything". */
  function killScope(scopeKey, tags, runs, ...hubInflights) {
    const key = String(scopeKey == null ? '' : scopeKey);
    if (!key) return 0;
    const lookup = tagLookup(tags);
    return kill((candidate) => {
      try { const tag = lookup(candidate); return String(tag == null ? '' : tag) === key; }
      catch (_) { return false; }
    }, runs, hubInflights);
  }

  return { killAll, killScope };
});
