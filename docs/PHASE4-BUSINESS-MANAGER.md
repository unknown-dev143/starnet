# Phase 4 — Business Manager

**Status: complete and verified.** Finance · Analytics · CRM · Content · Documents · Knowledge base ·
Experiments, plus the §9 project layer Phase 3 deferred (master prompt §30, Phase 4).

Built on `starnet/` (branch `feat/harness-backend`), continuing Phase 0 (audit), Phase 1 (foundation),
Phase 2 (Business Maker, `1429fb43`) and Phase 3 (AI Team, `f0058757`).

---

## 1. What this phase is for

Phase 1 gave a business a place to live. Phase 2 gave it a way to be created. Phase 3 gave it a crew.
**Phase 4 is the part that runs the thing.**

Eight stores, one HTTP surface, one console. The design rule that shaped every file: **a screen that runs a
business is the single easiest place in the app to fabricate a fact**, because a finance panel that blends a
real figure with a guess looks *more* authoritative, not less. So most of this phase's work is refusing to
do things that would look better.

### The six refusals, and why each one is the feature

| The console does NOT… | Because |
|---|---|
| add a business's **real** money to the AI's **guess** | §10's four provenance classes render as two separate figures — RECORDED (actual + user-entered + imported) and ESTIMATED (ai-estimate). A single blended total is the most convincing fabrication a finance screen can produce, and P2 forbids it. |
| render an unrecorded metric as **0** | §11's `latest` is `null` when nothing was recorded. "0% churn" is the most flattering lie a dashboard can tell, and it is indistinguishable from a metric nobody measured. |
| offer a **"lead score"** | §16's attention panel lists the **two named rules** the sidecar applied (overdue follow-ups, contacts gone quiet) and the raw inputs behind each — no ranking, no verdict. |
| let a **button publish as an agent** | §17's publish transition requires a human actor. The only control that crosses that line sends the Commander as the actor, and the pane says plainly that an agent cannot. |
| offer a conclusion **the sidecar would refuse** | §14's conclude control is built from the experiment's **actual state** (ended? two arms? graded evidence?), so the UI never proposes a verdict the store would reject. |
| call term overlap **"AI relevance"** | §15's retrieval is labelled for what it is, in the response payload, every time. |

---

## 2. BRIDGE, don't duplicate (P4) — the reconnaissance that shaped the design

Before writing a line, the repo was surveyed for existing modules that would collide. There is **no** existing
CRM, knowledge base, analytics or experiment module — but several near-misses shaped the naming and the seams:

| Existing module | What it actually owns | Why Phase 4 does NOT reuse it |
|---|---|---|
| `ledger.js` · `insights.js` · `budget.js` · `cost.js` · `spend.js` · `billing.js` | **AI-RUN cost** (tokens, model spend) | Business money is a different quantity. Reusing them would conflate what the AI cost with what the business earned. |
| `projects-store.js` | the station's **blessed filesystem roots** | Not business projects. `business-projects-store.js` is a distinct layer; the names are deliberately `biz`-prefixed in `index.js` to avoid the identifier collision that would otherwise break boot. |
| `deliverable-store.js` | **run outputs**, keyed by `agentId`/`runId` | A §15 document **references** a run output (`deliverableId`) rather than copying it. A document row has **no `files` field** — copying bytes would fork the two and let them drift. |
| `validation-store.js` (Phase 2) | validates an **opportunity**, pre-commitment | §14's Experiment Lab runs tests **inside a live business** — different owner, different lifetime. |
| `business-memory.js` (Phase 3) | distilled **facts** | §15's knowledge store holds **raw sources**. They point at each other: memory's `source: 'document'` refers to the knowledge library. |

---

## 3. The stores (all pure UMD · no IO/clock/env/rng · persist-before-commit)

| Store | § | Load-bearing property |
|---|---|---|
| `business-projects-store.js` | §9 | The referent `task.projectId` never had. `memoryNamespace(id)` → `biz:<businessId>:proj:<projectId>`, so the Phase 3 memory store's `project` scope gets an ownerId that cannot collide. `summary()` counts by status only — no progress %. |
| `business-finance.js` | §10 | **THREE row families in one file** (transactions + budgets map + prices map), so `persist` takes a **snapshot object**. `totals()` returns `{byCurrency:{…}}` with **no cross-currency grand total**; `recorded` is summed by explicitly skipping `ESTIMATE`. |
| `business-metrics.js` | §11 | §11's 13 metrics verbatim. **`latest()` returns `null` when unrecorded — never 0.** Rates bounded 0..1 (fractions). `source` required (P1). |
| `business-crm-store.js` | §16 | `needsAttention()` applies **two named rules** and returns each row with the rule that fired + its raw inputs. **P6**: `logInteraction`/`addFollowUp` refuse a businessId that differs from the contact's. `removeContact` refuses while a follow-up is open. |
| `business-content-store.js` | §17 | **`advance()` refuses any non-`'user'` actor reaching a PUBLISH stage.** `addPiece` refuses a piece born public. `update()` deliberately does **not** accept `stage`. |
| `business-documents-store.js` | §15 | A document needs **body OR `deliverableId`** — it references the run output, never copies it. Row has **no `files` field**. `search()` returns `matchedIn` + an excerpt, no relevance score. |
| `business-knowledge.js` | §15 | **`retrieve()` computes LITERAL term overlap** and labels itself "not a semantic or AI relevance score" in every response. `source` required (P1). |
| `business-experiments-store.js` | §14 | **`conclusionAllowed()` = 4 rules**: must be ended · ≥2 arms · ≥1 verdict-grade result · `inconclusive` always allowed. `tally()` = sums/min/max counts only — no effect size. |

Every store: `id = <businessId>~<letter><seq>` (**`~`, never `#`** — a `#` in an id is stripped client-side as a
URL fragment delimiter before the request leaves the browser), `businessId` required and part of the id (P6),
and persist-before-commit (a thrown `persist` leaves memory untouched and returns `ok:false`).

---

## 4. The HTTP surface — `sidecar/manager-routes.js` (~46 rows)

**THE TRAP, and the bug this phase's test caught.** `index.js`'s dispatch (`~line 9039`) does:

```js
else if (r.rx)  { gm = url.match(r.rx); if (!gm) continue; }   // gm = the MATCH ARRAY, groups included
else if (r.qrx) { if (!r.qrx.test(bare)) continue; }           // gm stays NULL — no groups captured
```

then calls `r.h(req, res, gm)`. So a **`qrx` row gives its handler `match === null`**, and every handler that
reads `match && match[1]` gets `undefined`.

Every business-scoped route here is read **with a query** (`?stage`, `?kind`, `?currency`, `?q`…) *and* needs the
businessId from the match groups — so it must be **`rx`** (which populates `gm`) with a regex that **accepts** the
query. The first draft used `qrx` throughout and would have **404'd every single business-scoped route** while
looking completely correct. `test/manager-routes.test.js` dispatches with a faithful copy of index.js's loop and
caught it; the fix is the `QS` optional-query tail (`(?:\?[^#]*)?$`) plus `rx` rows.

**Status codes:** 422 for provenance/source/evidence/§14-conclusion refusals · 403 for the §17 publish refusal ·
409 for cross-business references and orphaned project deletes · 404 unknown business · 400 bad JSON.

**What the routes add that a store structurally cannot** (a store cannot see another store):
- a `projectId` named by a task, content piece or document must **belong to the same business** (P6);
- deleting a project that still has tasks on it is a **409** — work is never silently orphaned;
- `GET /api/manager/catalog` serves **every** picker vocabulary from the module that owns it, so the UI cannot
  drift from the values the stores accept.

---

## 5. The console — `frontend/app/businessmanager.js` + `windows/manager.js` + `css/businessmanager.css`

Eight panes: **OVERVIEW · PROJECTS · FINANCE · ANALYTICS · CUSTOMERS · CONTENT · LIBRARY · EXPERIMENTS**.

**A collision that would have silently restyled two windows.** Phase 2's `businessmaker.css` already owns
`.bm-*`, and both stylesheets are global once `index.html` loads them — so the Phase 4 engine was re-prefixed to
**`.mg-*`**. `test/businessmanager.test.js` fails if a `.bm-` class ever reappears in the engine or the sheet.

The engine is split on purpose: the **pure half** (labels, option builders, row shaping, guards, formatting) is
UMD and Node-loadable so it is unit-tested headless; only `mount()` needs a DOM and it degrades to a no-op.
Destructive controls arm through the shared **`ArmConfirm`** two-press helper (fail-closed: disable if absent) —
`window.confirm` over the phosphor terminal is banned by `test/station-tooltip.test.js`.

---

## 6. The contract

`shared/events.js` gained a **21-event additive** Phase 4 block (`84 → 105` events): `business.project.*`,
`business.finance.*`, `business.metric.recorded`, `business.contact.*`, `business.content.*`,
`business.document.*`, `business.knowledge.*`, `business.experiment.*`. All carry `businessId`; none carries
`runId`. The fixture diff is **253 insertions / 0 deletions** — a pure addition.

---

## 7. Verification

Ten new suites, **764 assertions**, all passing:

```
business-projects-store (42)  business-finance (67)   business-metrics (69)
business-crm-store (53)       business-content-store (48)  business-documents-store (43)
business-knowledge (37)       business-experiments-store (59)
manager-routes (147)          businessmanager (199)
```

Every headline guard is proven by execution, not by inspection:

- the ¥999 AI estimate stayed out of `recorded` (100 / 30 / 70) and landed **only** in `estimated`;
- `latest()` returned **`null`**, not `0`, for an unrecorded metric;
- a **cross-business** interaction was refused (P6);
- an **agent** publish attempt was refused (403) while the Commander's succeeded (201);
- a conclusion was refused at **every** stage until a `verified` result existed — while `inconclusive` was
  **always** allowed;
- `retrieve()` returned **0 hits** for a no-match query and labelled itself literal;
- a document row has **no `files` field**;
- **all 13 business-scoped GETs with a query matched** (the `qrx` bug above).

Gates re-run green: `events-contract` (9) · `failopen-ratchet` (157) · `station-tooltip` (413) ·
`onboarding-legibility` (49) · `dock-terms-open` (9) · `lint-determinism` (311 files) · `lint-emits` (500 files) ·
`capdrift` (99) · `frontend-fetch-truth-ratchet` (12) · `website-app-sync --check` (OK, 3900 files).
No Phase 1–3 regressions: all 16 neighbouring suites still pass.

**Sandbox note:** `test/lint-evidence-secrets.test.js` and `test/website-app-sync.test.js` cannot complete in
this environment — both `spawnSync` a child process, which the sandbox refuses (`EBUSY`). Their underlying
scripts run green when invoked directly.

---

## 8. Files

**New — sidecar (9):** `business-projects-store.js`, `business-finance.js`, `business-metrics.js`,
`business-crm-store.js`, `business-content-store.js`, `business-documents-store.js`, `business-knowledge.js`,
`business-experiments-store.js`, `manager-routes.js`

**New — frontend (3):** `app/businessmanager.js`, `app/windows/manager.js`, `css/businessmanager.css`

**New — tests (10):** one per store + `manager-routes` + `businessmanager`

**Modified:** `shared/events.js` (+21 events), `test/fixtures/events-contract.snapshot.json` (regenerated),
`sidecar/index.js` (9 requires + 8-store wiring + route mount), `frontend/app/glossary.js` (`manager` term),
`frontend/index.html` (dock button + stylesheet + 2 script tags), `test/fast.list`, and the mirrored `website/app/*`.

---

## 9. Next

**Phase 5 — Automation · Phase 6 — AI Worker · Phase 7 — Intelligence · Phase 8 — Hardening.**
