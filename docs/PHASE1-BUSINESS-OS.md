# PHASE 1 — BUSINESS OS FOUNDATION: what shipped

_Record of the Phase 1 build. Follows docs/PHASE0-AUDIT.md §7 (the recommended implementation order)._
_Every claim here is backed by a file and a test; nothing is asserted from memory (P1/P2)._

---

## 1. What Phase 1 is, and what it deliberately is not

Phase 1 is the **foundation**: a business is a real, durable entity; everything that happens to it is
recorded; the Commander can see both; and one business can be stopped without stopping the station.

It is **not** the Business Maker (Phase 2), not the AI team assignment (Phase 3), and not the manager
surfaces (Phase 4). No revenue, growth, or score is displayed anywhere, because no store produces one yet.
A dashboard that invented a number would poison every decision made from it.

---

## 2. What was built

### 2.1 The entity store — `sidecar/businesses-store.js`

Owns **identity and isolation only**. Nothing else.

- `STAGES = idea · validating · building · live · paused · archived`
- `TEMPLATES = saas · content · digital-product · agency · custom`
- Ids are **deterministic slugs** (`Acme` → `acme`, then `acme-2`, `acme-3`), never a random token — so the
  module passes `lint-determinism` and ids are stable across restarts.
- `memoryNamespace(id)` → `'biz:<id>'` is a first-class export, not an afterthought: **isolation is by key
  namespace**, because there is no SQL here and therefore no foreign key to enforce tenancy (P6).
- `id` and `createdAt` are **immutable across update** — a rename never re-keys a business, so every
  namespaced child store stays correctly attached.
- Persist-before-commit (fail-closed): a thrown `persist` leaves memory untouched and returns `ok:false`, so
  a business is never visible unless it reached disk.

### 2.2 The activity log — `sidecar/business-activity-store.js`

The readable record of what happened (master prompt §20), and the surface for §7's per-business activity logs.

- Append-only and **bounded** (500 rows/business; the oldest are dropped per-business only).
- Ordering is by a **per-business monotonic `seq`**, not the clock — so the log cannot reorder itself.
- Closed vocabularies (`result`, `approval`, `actor.kind`); a value outside them is **refused, never coerced**.
- An empty `businessId` is **refused** rather than read as "everything". `recent()` is the one deliberate
  cross-business feed and is named for exactly that.
- `rowView` tolerates a malformed/missing `actor` on read, so a hand-edited file cannot throw.

### 2.3 The HTTP surface — `sidecar/business-routes.js`

A **module**, not more lines in the 19.4k-line `index.js` (which the project's own CODE_MAP names as the
merge-conflict hotfile).

| Route | Behaviour |
|---|---|
| `GET /api/businesses` | list, newest-updated first |
| `POST /api/businesses` | create (name required) |
| `GET /api/businesses/:id` | entity + activity count |
| `PATCH /api/businesses/:id` | partial update — **and the pause** (below) |
| `DELETE /api/businesses/:id` | remove the entity; the audit row is written **before** the removal so the history outlives the business |
| `GET /api/businesses/:id/activity` | that business's log, newest first |

Auth is inherited: these are `/api/*` routes, so `apiauth.js`'s per-launch token gate covers them and
nothing here re-implements or bypasses it.

### 2.4 Additive bus events — `shared/events.js`

Five **new** names in a new block. **No existing event or field was renamed, removed, or retyped** — the
contract is additive-only by rule, and every older consumer stays valid.

`business.created` · `business.updated` · `business.deleted` · `business.paused` · `business.activity`

`business.activity` mirrors one audit row verbatim, so the Command Center's ACTIVITY pane is a live feed
rather than a poll. `business.paused` carries `halted` — the number of runs the pause **actually** stopped.

### 2.5 The per-business E-STOP (master prompt §21) — `sidecar/halt.js` + `index.js`

`halt.js` now has **two doors, one engine**:

- `killAll(runs, ...hubInflights)` — the station E-STOP. Behaviour is byte-for-byte unchanged.
- `killScope(scopeKey, tags, runs, ...hubInflights)` — abort **only** the runs whose scope tag matches.

Scoping is **fail-safe, never fail-open**: an empty scope key returns 0 rather than "everything", and a hub
map that cannot be keyed (no `entries()`) is *skipped* by a scoped kill rather than swept. Over-killing is
the one failure mode a scoped stop must not have.

**Setting a business's stage to `paused` IS the stop** — there is no second door to drift from it. The route
runs the halt **first** and commits the stage **second**, because the one lie this route must never tell is
"paused" while the business's runs are still spending. The reverse (runs stopped, stage write failed) is
recoverable and is reported honestly with the count.

Runs are tagged in `runsMeta.businessId`, set from `/api/run`'s `businessId`. An **untagged run is station
work** and is deliberately never stopped by a business's pause. A `paused`/`archived` business **refuses new
work** (409 with an actionable reason) — without that guard a pause would only stop what was already
running, and the next queued launch would spend anyway.

### 2.6 The Business Command Center — `frontend/app/businesscenter.js` + `windows/business.js`

A new dock window (**WORK ▸ BUSINESS**) with three sections: **BUSINESSES · ACTIVITY · NEW BUSINESS**.

- The **pure half** (labels, row shaping, summary, the run guard) is UMD and Node-loadable, so it is
  unit-tested headless like `projects.js`/`workstreams.js`.
- The **DOM half** builds through `StationUI.h.mountConsole` — the shared console framework — and degrades
  to an honest message (never an empty console that reads as "no businesses") if the engine is missing.
- The UI **refuses exactly what the sidecar refuses** (`runGuard` mirrors the 409 rule), because a UI that
  offers a launch the engine rejects reads as a broken button.
- Live: subscribes to the `business.*` events with a 200 ms debounce, so a bus event and the mutation's own
  response collapse into one fetch instead of two racing ones.
- Telemetry is **last-good, never optimistic**: a failed load renders the error and keeps the previous rows.

---

## 3. Test evidence

| Test | Assertions | What it locks |
|---|---|---|
| `test/businesses-store.test.js` | 51 | entity lifecycle, slug de-dup, immutability, fail-closed persist |
| `test/business-activity-store.test.js` | 44 | append/read isolation, per-business cap, `seq` ordering |
| `test/business-routes.test.js` | 104 | every route, the audit rows, **every emitted payload schema-valid**, the pause ordering, idempotent re-pause, a throwing halt reporting 0 |
| `test/businesscenter.test.js` | 93 | the pure engine, the run guard vs the sidecar's rule, and the wiring (dock button, window slot, script order, response-truthfulness) |
| `test/halt.test.js` | 35 | the station E-STOP contract **unchanged** + the scoped door (match-only, empty-key refusal, unkeyed-map skip) |
| `test/cap-tool-registration.test.js` | 306 | the 4th seam: every capability-declaring module is required by the host |

---

## 4. Gate findings

- **`test/failopen-ratchet.test.js` was RED at HEAD**, on four files that were already committed:
  `tools/builtin/audio.js` (1), `compose.js` (1), `printprep.js` (1), `video.js` (2) — all bare silent
  promise catches. Fixed here with the documented `swallow(tag, ...)` form from `sidecar/failopen.js`
  (semantics identical, trace added). The ratchet is green for the first time in this working tree.
- **`sidecar/halt.js`'s** empty-catch baseline row was **lowered from 1 to 0** (the ratchet enforces exact
  equality, no slack): the never-throw contract now lives in one `attempt(fn)` helper that *returns* the
  thrown error instead of swallowing it into an empty body.
- **`test/qa-product-perfect-claims.test.js`** cannot run in this sandbox — Node cannot spawn any child
  process here (`spawnSync git EBUSY`). That is an environment restriction, not a repo defect.
- `test/source-text-integrity.test.js` and the rest of the git-dependent gate steps are blocked by the same
  restriction and must be re-run normally.

---

## 5. Carried forward (not Phase 1)

- **Commit the working tree.** `frontend/app/worldmodel.js` and everything in this phase are live but
  uncommitted.
- `frontend/app/worldmodel.js.bak` is a **tracked** duplicate of `worldmodel.js`. Left alone — deleting a
  tracked file is not Phase 1's call.
- **Phase 2 — the Business Maker**: the wizard, template-specific planning fields, and the interview that
  fills them. The create form in this phase is the seed it grows from.
