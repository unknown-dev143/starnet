# Phase 2 — The Business Maker

**Status: complete and verified.** Master prompt §30's Phase 2 row — *"Opportunity Radar · Business Factory ·
Validation Lab · business planning · templates · creation workflow"* — is built, wired into the running app,
and covered by 881 assertions across five new suites.

Phase 1 built the place you look after businesses that **exist**. Phase 2 builds the place you decide whether
one **should**. It is a reverse funnel, and the order is the design:

```
§22 RADAR  →  §4 EVIDENCE  →  §5 VALIDATION  →  §6/§9 PLAN  →  PROMOTE
  find it      label what      try to kill       preview the      it becomes a
               you know        the idea          task plan        real business
```

---

## 1. The two guards, and why they are STRUCTURAL rather than conventional

The interesting work in this phase is not the CRUD. It is that two of the operating principles (P1, P2) are
enforced by the **data model**, so a future caller cannot violate them by forgetting.

### P1 — no unlabelled claim (§4)

An opportunity is a claim set about a business that does not exist yet. Every §4 field is stored as
`{ text, evidence, source }`, and `evidence` must be one of the six classes:

| class | meaning |
|---|---|
| `verified` | sourced and checkable |
| `analysis` | reasoning over verified inputs |
| `assumption` | taken as true without proof |
| `estimate` | approximate, with a stated method |
| `prediction` | forward-looking and uncertain |
| `unknown` | explicitly **not** known |

`opportunities-store.setField` **REFUSES** a claim whose label is missing or unrecognised. There is no default
and no code path that writes an unlabelled claim. An **empty** cell is always allowed (and reads `unknown`) —
"we no longer claim this" is a legitimate edit. The UI's evidence picker mirrors this by having **no default
selection**: its first option is the empty `— pick a label —` prompt, so the rule is learned before the server
has to say it.

```
POST /api/opportunities/:id/field { field, text }              → 422  (needs a label)
POST /api/opportunities/:id/field { field, text, evidence:'vibes' } → 422  (unrecognised)
POST /api/opportunities/:id/field { field, text, evidence:'assumption' } → 200
```

### P2 — no fake validation (§5)

A validation run may be marked `supported` or `contradicted` **only** if it carries at least one piece of
evidence classed `verified` or `analysis`, **and** at least one signal on the matching side. Everything else is
refused, and the refusal names what is missing:

> cannot mark a run "supported" without at least one VERIFIED or ANALYSIS evidence item — assumptions,
> estimates, predictions and unknowns cannot carry a verdict (P2: no fake validation)

Why those two classes and not all six: *"we assumed customers want this, therefore supported"* is exactly the
sentence this guard exists to make unwritable. `pending` and `inconclusive` stay open to everyone, because
"we do not know yet" is always an honest thing to record.

The one place this rule lives is `validation-store.verdictAllowed()`, so `create()` and `record()` cannot drift
apart. The route passes the store's reason through **verbatim** as a 422 — that sentence is the product working.

### What is deliberately NOT here

**No score.** `evidenceMix()` is a *count* of fields per class; `missing()` and `completeness()` are a *list*
and a *fraction*. There is no "opportunity score", no health percentage, no priority re-ranking. A score would
be an invented number dressed as analysis, which is what P2 forbids. The Commander gets the counts and the
labels and draws their own conclusion.

**No validation threshold.** Promote does **not** block on thin evidence. It reports what evidence exists as a
non-blocking `advisory` and then does what the user said (P5, §32: *the user remains the final authority*).
Inventing a pass/fail threshold would be the fake intelligence P7 forbids.

---

## 2. Module inventory

Every module is its own file, mounted into `ROUTES` — never inlined into `sidecar/index.js` (the CODE_MAP
hotfile). All stores are **pure** (no IO, no clock, no env, no rng; `persist`/`now` injected) and UMD.

| file | lines | what it owns |
|---|---|---|
| `sidecar/opportunities-store.js` | 280 | §4/§22 — the claim set. P1 as a data-model invariant. |
| `sidecar/validation-store.js` | 268 | §5 — the Validation Lab. P2 as a structural refusal. |
| `sidecar/business-templates.js` | 302 | §25 funnels + the §9 task-plan generator. Pure, no deps. |
| `sidecar/business-tasks-store.js` | 400 | §9 Task & Project Engine. All thirteen fields; real dependency edges. |
| `sidecar/maker-routes.js` | 385 | `/api/opportunities`, `/api/validations`, `/api/templates`, `/api/plan`, **promote**. |
| `sidecar/task-routes.js` | 215 | `/api/businesses/:id/tasks`, `/api/tasks/:id`. |
| `frontend/app/businessmaker.js` | ~700 | The 4-pane console engine (pure half + DOM half). |
| `frontend/app/windows/maker.js` | 25 | The window slot (TITLE LAW pair). |
| `frontend/css/businessmaker.css` | ~140 | Scoped `.bm-*` styles on the shared phosphor vars. |

### Isolation (P6)

There is no database, so tenancy is by **key namespace**, not a foreign key:

* a validation run with no `opportunityId` and a task with no `businessId` are **REFUSED** on write and
  **DROPPED** on load — an unattributable row cannot be read back through any scoped route, so keeping it
  would only grow the file with rows nobody can see or delete;
* a task's `dependsOn` may only name a task **in the same business** — a cross-business edge would leak one
  business's plan into another's and would make the per-business E-STOP incoherent;
* `remove()` refuses to orphan a dependency (409, not 400 — the request is fine, the *state* is not);
* there is **no route that can list or mutate "all tasks"** — every path is business-scoped or names an id that
  already encodes its business. That is what makes P6 true at the HTTP layer and not just in the store.

### Persistence

Same `loadResilient`/`saveResilient` pair as Phase 1 (fsync-before-rename + `.bak` last-known-good), same
**persist-before-commit / fail-closed** discipline. Three new files: `opportunities.json`, `validations.json`,
`tasks.json`. A thrown `persist` leaves memory **exactly** as it was — proven for all six write paths in
`business-tasks-store.test.js`.

---

## 3. The §25 vs §9 reconciliation (a judgement call, stated)

§25 names four template funnels. §9 gives one worked example: *"Launch a digital product"* → ten ordered tasks.
**These are not the same list**, and collapsing them would have silently misreported one:

| | §25 digital-product funnel | §9's worked example |
|---|---|---|
| order | Research → Product → Landing → Checkout → Delivery → Support | landing page **before** the product |
| has | Checkout, Delivery, Support | marketing assets, Launch |
| lacks | marketing assets, Launch | Checkout, Delivery, Support |

So both are exposed, each labelled with the section it came from:

* `templatePlan(id)` — the §25 funnel, expanded to tasks. Order **is** the dependency order.
* `goalPlan(text)` — matches a stated goal against a keyword table and returns §9's plan **verbatim**,
  reporting `matchedBy` so the match is visible. A goal it does not know is **REFUSED** with the list of goals
  it does know — a planner that always produces a plausible-looking plan is precisely what §26's confidence
  discipline exists to prevent.

**P1 in the planner:** every generated task's effort is `{ hours, evidence: 'estimate' }`. An unlabelled number
would read as a measurement; a plan has never been run. The UI renders it as `est. 6h`, never as `6h`.

---

## 4. The creation workflow (`POST /api/opportunities/:id/promote`)

The one route that writes outside its own store. **Its order is load-bearing:**

1. **create the business** — if this fails, nothing else has happened;
2. **materialise the plan** (§6 → §9) — a failure here is reported as a `warning`; the business stands, because
   a business without tasks is recoverable and a half-created business is not;
3. **stamp the opportunity as promoted — LAST**, so a crash between 1 and 3 leaves an *un-promoted*
   opportunity rather than a *promoted* one with no business.

Field mapping is literal, and a field with **no §4 counterpart is left empty** rather than filled with a
plausible sentence (`valueProposition` is the case in point — inventing one would be fabrication, not mapping).

A re-promote is a **409 naming the existing business**, never a second business. With no business store wired
it is a **501**, not a half-created business.

---

## 5. Events (additive-only)

Eight new names in `shared/events.js`, inserted as a new block. Nothing existing was renamed, removed or
retyped — proven by the fixture diff: **159 insertions, 0 deletions** (`events-contract` snapshot regenerated
with `--update`; 69 → 77 events).

`opportunity.created` · `opportunity.updated` · `opportunity.promoted` · `opportunity.deleted` ·
`validation.recorded` · `task.created` · `task.updated` · `task.deleted`

Every mutation's payload is asserted schema-**valid** in the route tests — the real bus silently drops an
invalid payload, so a typo'd field would make the UI look merely "quiet" instead of loudly broken.

---

## 6. UI

`BUSINESS MAKER` in the WORK dock group (`data-term="maker"`, glyph `◈`), opening a four-pane console whose
pane order **is** the funnel argument: `RADAR → EVIDENCE → VALIDATION → PLAN & PROMOTE`.

* **RADAR** — opportunities with a `filled/12` completeness readout and evidence-mix chips. An opportunity
  with no claims shows an explicit `NO CLAIMS YET` chip rather than six zeroes.
* **EVIDENCE** — the twelve §4 fields, each with its current claim, its label, and an editor whose evidence
  picker has **no default**.
* **VALIDATION** — open a run against one question; record the result as one evidence item per line
  (`verified: 42 of 50 said yes`). A line with no recognised label is refused **client-side** too.
* **PLAN & PROMOTE** — template or goal → task-plan preview (with `est.` labels and approval gates) → promote.

**House patterns followed:** the templates are **fetched**, not hardcoded, so the UI cannot drift from the
sidecar's §25 definitions; the live bus is subscribed to all eight new events with a 200 ms debounce; a failed
load keeps the previous rows (last-good, never optimistic); `request()` keeps the `Response` in scope and reads
`r.ok` (the frontend fetch-truth ratchet).

**`window.confirm` was removed from both engines.** An OS modal over the phosphor terminal is banned
(`station-tooltip`), so destructive controls now use the shared `ArmConfirm` two-press helper. The PAUSE
control — a `<select>`, which `ArmConfirm` cannot wire — uses the same discipline by hand: the first change to
`PAUSED` is refused, the control snaps back to the truth and the row is marked `bc-armed`; the second change
confirms. The `arm()` helper is **fail-closed**: with no `ArmConfirm` the control disables rather than falling
back to a native dialog or firing unconfirmed.

---

## 7. The `~` separator (a real bug found and fixed)

Ids travel in URL **paths**. The first cut used `<id>#v<n>` for validation runs and `<id>#t<n>` for tasks — and
`#` is the **fragment delimiter**, so a browser would have stripped everything after it and sent
`/api/validations/acme`, matching nothing. The separator is now `~`: unreserved in RFC 3986, never
percent-encoded, and impossible in a slug (`slugFor` maps every non-alphanumeric to `-`), so it is unambiguous.

---

## 8. Test evidence

| suite | assertions | what it locks |
|---|---|---|
| `business-templates.test.js` | 361 | §25 stage order, §9's 10 tasks verbatim, P1 effort labels, deterministic refusal of unknown goals |
| `business-tasks-store.test.js` | 126 | all thirteen §9 fields, P6 dependency refusal, all-or-nothing plans, fail-closed on all six write paths |
| `maker-routes.test.js` | 138 | the P1/P2 422s, promote ORDER + 409 + 501, advisory-not-gate, schema-valid emits |
| `task-routes.test.js` | 82 | business-scoped paths only, 409 on dependency orphan, plan refusals |
| `businessmaker.test.js` | 206 | no default on the evidence picker, counts-not-scores, `est.` labels, ArmConfirm, load order |

All five are registered in `test/fast.list`. 36 suites covering every touched surface were re-run green,
including the gates that caught real problems during this phase: **`failopen-ratchet`** (an empty catch in the
promote audit), **`station-tooltip`** (the `window.confirm` uses), **`events-contract`**, and
**`prop-search`** (see below).

### A latent test bug this phase exposed

Adding the AUDIO/VIDEO capability labels made `prop-search`'s "a grant word returns only props that grant it or
visibly carry it" law fail on `editingbay` — whose description reads *"a video editing bay … generated audio"*.
The cause was **in the test**: `matchProps` searches the name surface **and** `desc`, but the law only consulted
`haystack()`, omitting `desc`. The mismatch was latent until a grant label collided with existing prose. Fixed
by having the check consult `descstack` too — the module exports it for exactly this, and a desc hit is ranked
in the weakest band by design. This aligns the law with the matcher it claims to test; it does not relax it.

### Known-unrunnable in this sandbox

Node here **cannot spawn child processes** (`spawnSync … EBUSY`). Suites that shell out — `source-text-integrity`,
`website-app-sync`, `website-deploy-staging`, the `t0`–`t5` release train, `installer-upgrade-resilience`,
`minisign-verify`, the `eval-*` family, `qa-installed-*`, `station-recovery-cli` — cannot complete here and
**must be re-run normally**. The website mirror was synced by invoking the script directly
(`node scripts/sync-website-app.mjs`; 11 files written, `--check` now clean), so the real content is correct
even though the wrapper test cannot run.

Pre-existing failures unrelated to this phase (verified byte-identical with and without these changes, by
`git stash`): `toolprops` (14), `prop-render-smoke` (1) — both belong to the **unapplied zone patches**
(`audiolab`, `cinema`, `editingbay`, `publishinghouse`, `briefingroom`, `printshop`, `listingdesk`) that sit at
the workspace root and are not part of Business OS.

---

## 9. Deliberately deferred

* **Opportunity Radar as a continuous monitor (§22).** §22 describes a *running* monitor over configured
  sources with alert thresholds. Phase 2 ships the opportunity **record** and the manual/AI-authored creation
  path; the continuous scanning loop needs the scheduler and belongs with Phase 5 (Automation) / Phase 7
  (Intelligence). Nothing here blocks it — `origin: 'ai'` already exists on the record for a scanner to use.
* **Tagging a run with a `taskId`.** Runs are already tagged with their `businessId`, which is what the
  per-business E-STOP matches on. A task-level tag would add a second scope to `runsMeta` for no §9 requirement
  yet; it belongs with Phase 6 (AI Worker), when tasks actually drive runs.
* **Per-business task *projects*.** `projectId` is stored and carried, but the §9 project entity itself
  (§8's PROJECTS section) is Phase 4.

---

## 10. Running it

```bash
# the five new suites
node test/business-templates.test.js
node test/business-tasks-store.test.js
node test/maker-routes.test.js
node test/task-routes.test.js
node test/businessmaker.test.js

# the whole gate (normally; needs child-process support)
npm run test:fast
```
