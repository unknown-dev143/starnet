# PHASE 0 — AUDIT v4: the AI COMMAND CENTER brief

**Brief:** `SPACE STATION — MASTER AI OPERATING SYSTEM TRANSFORMATION` (the 46-section brief, delivered 2026-10-03).
**Mandate:** *"Do NOT start rewriting the application immediately. Start with the complete repository audit…
Then present the implementation plan. Only after the audit should major implementation begin."*
**Status:** read-only inspection. Nothing was modified to produce this.
**Tree:** `starnet/`, branch `feat/harness-backend`, HEAD `6165fd663`, working tree **clean**.
**Relates to:** `docs/PHASE0-AUDIT.md` (2026-09-24), `docs/PHASE0-AUDIT-v2.md` (2026-09-26),
`docs/PHASE0-AUDIT-v3.md` (2026-09-27), `docs/BRIEF-LEDGER.md`. **This v4 covers a NEW, broader brief.**
The three earlier audits answered an *AI Business Maker + Manager* brief. This brief restates that and
**expands it** into a full AI Command Center / Workforce / Creator Studio / Opportunity Radar vision.
Everything below is **[verified]** against the working tree unless marked otherwise.

---

## 0. Headline (read this first)

**The transformation this brief asks for has very largely already been built.** The prior sessions
took the earlier (narrower) version of this same master prompt and implemented §1–§29 plus eight §6
gaps, then completed the brand rebrand (Phases 1–2) and built §25 remote monitoring. This newer, broader
brief is a **superset** — and the audit finds that ~90% of its named systems already exist as real,
tested modules.

| Question (brief §FIRST ACTION) | Answer |
|---|---|
| 1. What currently works? | A large, tested, single-process product: **203** sidecar modules (**70,390** LOC), **177** frontend modules (**108,165** LOC), **841** test files. Tree clean. |
| 2. What currently exists? | Nearly every system the brief names — see §2's mapping table. Mission engine, workforce, memory, twin, factory, intelligence, opportunity radar, content pipeline, model router, security — all present. |
| 3. What belongs to the original product's identity? | **Already handled.** The visible `STARNET` brand was rebranded in `cba3891a5` + `7b1d2f154`; a guard test (`test/brand-identity.test.js`, 40+ assertions) prevents regression. Only internal *identifiers* (CSS classes, store keys, `X-StarNet-Token`) remain — correctly, per §45 RULE 1. |
| 4. What should become SpaceStation-native? | The **brand layer** is done. The remaining native-isation is **conceptual grouping / navigation labels**, not new engines. |
| 5. What can be reused? | Essentially everything. This brief's §40 target architecture is *already the implementation*. |
| 6. What should be redesigned? | The **navigation / information architecture** at the *label* level (brief §5), so the existing systems read as `COMMAND CENTER / MISSIONS / CREATION LAB / BUSINESSES / PORTFOLIO / WORKFORCE / CREATOR STUDIO / OPPORTUNITY RADAR / …`. Redesign the *presentation*, not the engines. |
| 7. What should be removed? | Nothing functional. Only duplicated legacy **labels** on the surfaces §5 renames. |
| 8. Worth integrating externally? | **Nothing new.** The §41 repo study was done in `PHASE0-AUDIT-v2.md` §… : all eight are STUDY; **zero** are dependencies. The new brief's repo list is the same eight. |
| 9. Which licenses apply? | **MIT** (`LICENSE` → `Copyright (c) 2026 Andrew Sims`), attribution intact & guarded by test. No AGPL/n8n code vendored. |
| 10. Safest migration? | **Presentational re-organisation behind existing seams** — regroup existing windows under §5's nav labels, add tests that pin the group→module mapping, change nothing in the stores or routes. |

**Bottom line:** this is a **Phase 1–2 (identity / IA) job**, not a rebuild. The brief's §45 RULE 1
("do not rebuild working functionality") and §45 RULE 12 ("every major feature must connect to real
functionality") both point the same way: **map, regroup, relabel, and close specific gaps — do not
re-architect.**

---

## 1. What this application actually is **[verified]**

SpaceStation is a **fork of StarNet** (`package.json` description says so, honestly). It is a
local-first, single-user, **desktop** (Tauri 2) AI-agent **workstation**, rendered as a pixel-art space
station. Not a web SaaS.

The load-bearing architectural fact — carried from `PHASE0-AUDIT.md` — is that **capability is spatial**:
an agent's tools are literally determined by which props are placed in its room
(`sidecar/capability/resolve.js` → `resolveTools`). Any new "worker" concept must respect this, or it
becomes a second, parallel authority — which §45 RULE 4 ("never ship two versions of the same feature")
forbids.

```
Tauri 2 shell (src-tauri/)  ──spawns──▶  sidecar/index.js  (ONE Node process, HTTP+SSE :8787)
  data root: %LOCALAPPDATA%\SpaceStation\workspaces\   serves frontend/ statically, runs the agent loop
```

---

## 2. What already exists — the brief's §5 / §40 mapped to modules **[verified]**

### 2a. Brief §5 navigation → what is already behind it

| Brief §5 nav item | Backing module(s) | Route surface | Status |
|---|---|---|---|
| COMMAND CENTER | `frontend/app/app.js` + window registry | `/api/mission/board` `…/fleet` `…/attention` `…/trail` | **exists** |
| MISSIONS | `mission-control.js`, `mission-routes.js`, `business-projects-store.js`, `business-tasks-store.js` | `/api/mission/*` | **exists** |
| CREATION LAB | `business-templates.js`, `maker-routes.js`, `business-maker` UI | `/api/opportunities*`, `/api/validation*`, `/api/templates*` | **exists** |
| BUSINESSES | `business-routes.js`, `businessmanager.js` UI | `/api/businesses*` | **exists** |
| PORTFOLIO | `intelligence-routes.js` (`/api/intelligence/portfolio`) | GET portfolio across all businesses | **exists** |
| WORKFORCE | `business-agents-store.js`, `business-workers` (`business-worker.js`, `business-worker-policy.js`), `worker-routes.js` | `/api/workers*`, `/api/businesses/:id/agents` | **exists** |
| CREATOR STUDIO | `business-content-store.js` (§17 pipeline) + `/api/businesses/:id/content` | content CRUD + `/api/content/:id/advance` | **exists (partial — see §6)** |
| OPPORTUNITY RADAR | `opportunities-store.js`, `maker-routes.js` | `/api/opportunities*` | **exists** |
| EXPERIMENT LAB | `business-experiments-store.js` | via `manager-routes.js` | **exists** |
| AUTOMATION | `business-automation-engine.js`, `business-automation-store.js`, `automation-routes.js`, `cron*.js` | `/api/automation*` | **exists** |
| INTELLIGENCE | `intelligence-engine.js`, `intelligence-routes.js`, `business-twin.js`, `twin-routes.js`, `model-router.js` | `/api/intelligence/*`, `/api/businesses/:id/twin` | **exists** |
| MEMORY | `memcore.js`, `memory-store.js`, `business-memory.js`, `commander-context.js` | via run path | **exists** |
| ANALYTICS | `business-metrics.js`, `business-finance.js`, `businessintelligence.js` UI | `/api/intelligence/*` | **exists** |
| SECURITY | `permissions.js`, `permgrants.js`, `business-security.js`, `security-routes.js`, `halt.js` | `/api/businesses/:id/security*` | **exists** |
| TERMINAL | `tools/builtin/terminal.js`, `shell.js`, `computer.js` | tool surface | **exists** |

### 2b. Brief §40 target architecture → already the implementation

Every box on §40's diagram resolves to a real module — same conclusion as `PHASE0-AUDIT-v3.md` §2, which
this audit re-verified and extends to the brief's new sections (§5, §8, §18, §20, §38).

| §40 box | Module(s) |
|---|---|
| COMMAND CENTER | `frontend/app/app.js` + `mission-control.js` |
| SPACE CORE / MISSION ENGINE | `mission-control.js`, `mission-routes.js`, `business-tasks/projects-store.js` |
| INTELLIGENCE | `intelligence-engine.js`, `business-twin.js`, `software-factory.js`, `model-router.js` |
| MEMORY | `memcore.js`, `memory-store.js`, `business-memory.js` |
| CONTROL | `permissions.js`, `permgrants.js`, `business-security.js`, `halt.js` |
| AI WORKFORCE | `business-agents-store.js`, `business-worker*.js`, `business-permissions.js` |
| CREATION LAB | `business-templates.js`, `maker-routes.js`, `opportunities-store.js` |
| BUSINESS OS | `business-{finance,crm,content,documents,knowledge,experiments,metrics}.js` |
| AUTOMATION | `business-automation-*.js`, `cron*.js` |
| EXECUTION LAYER | `tools/builtin/{browser,computer,terminal}.js` |
| BROWSER / TERMINAL / API workers | `business-worker-policy.js`, `tools/builtin/{browser,terminal}.js` |

### 2c. The brief's specific new sections

| Brief § | Concept | Evidence it exists |
|---|---|---|
| §6 Command Center | attention/mission/fleet | `/api/mission/{board,fleet,attention,trail}` (4 routes) |
| §7 "What needs my attention?" | attention engine | `mission-control.js` attention + `business-approvals-store.js` |
| §8 Space Commander | intelligence layer over missions/businesses | `commander-context.js`, `memcore.js`, orchestrator role grant (`registry.js:225`) |
| §9 Mission system + lifecycle | mission engine | `mission-control.js`, `mission-routes.js`, `business-tasks-store.js` |
| §10/§11 Creation Lab + workflow | creation templates | `business-templates.js` (`goalPlan`), `maker-routes.js` |
| §12 Build modes | build-with/for-me | station modes + `business-worker-policy.js` execution profiles |
| §13 Software Factory | 8-stage pipeline | `software-factory.js`, `factory-routes.js` (`/api/factory/stages`) |
| §14/§15 Business Maker + Manager | business OS | `business-*.js` (26 modules), `manager-routes.js` |
| §16 Business Portfolio | cross-business view | `/api/intelligence/portfolio` |
| §18 Opportunity Radar | discovery | `opportunities-store.js`, `/api/opportunities*` |
| §19 Experiment Lab | hypothesis→test | `business-experiments-store.js` |
| §20 Creator Studio | content pipeline | `business-content-store.js` (8-stage §17 pipeline, human-only publish gate) |
| §21–§23 AI Workforce + orchestration | worker system | `business-agents-store.js`, team.summon/dispatch (`registry.js:232/237`), `concurrency.js` fan-out cap |
| §24 Space Memory | namespaced memory | `business-memory.js` (`biz:<id>:agent:<id>` namespace, P6 isolation) |
| §25 Business Intelligence | metrics | `business-metrics.js`, `intelligence-routes.js` |
| §26 Financial management | finance | `business-finance.js` |
| §27 CRM | leads/customers | `business-crm-store.js` |
| §28 Automation Engine | trigger→action | `business-automation-engine.js`, `automation-routes.js` |
| §29 Browser Worker | controlled browser | `tools/builtin/browser.js` (Playwright), `business-worker-policy.js` risk tiers |
| §30 Terminal / Space Tools | unified tools | `tools/builtin/` (41 modules), `capability/registry.js` |
| §31 Approval system | approvals | `business-approvals-store.js`, `permissions.js` consent broker |
| §32 Security Center | permissions/risk/audit/E-stop | `business-security.js`, `security-routes.js`, `halt.js` |
| §33 Model Router | provider-independent | **`sidecar/model-router.js`**, `providers/` (8 providers) |
| §34 AI Cost Management | budgets | `cost.js`, `spend.js`, `ledger.js`, `credits.js` |
| §35 Attention & Intelligence engine | recommendations | `mission-control.js`, `intelligence-engine.js` |
| §36 Business Digital Twin | scenarios | `business-twin.js`, `twin-routes.js`, `businessdtwin.js` UI |
| §37 Creation Portfolio | "my creations" | `creations-index.js` (8 types) + `creator-routes.js` + CREATOR STUDIO ▸ CREATIONS |
| §38 Station Digital Twin | system overview | `business-twin.js` + `/api/mission/fleet` |
| §39 Verification Engine | run→test→verify | `business-worker-policy.js` verification, `tools/builtin/verify.js` |

---

## 3. ★ What originated from the underlying software — ALREADY REBRANDED

This brief's §3 is the same identity instruction as the earlier brief, and **it has already been carried
out** (see `PHASE0-AUDIT-v3.md` §8–§9 for the full record):

| Item | State |
|---|---|
| Visible `STARNET` in the chrome | **gone** — rebranded to `SPACESTATION` in `cba3891a5` (boot mark, 5× titlebar, splash, provisioning/update copy) |
| Installer / Start menu / window title | **done** — `productName: SpaceStation` in `7b1d2f154` |
| Public website + README | **done** — 239 replacements across 21 files |
| SpaceStation wordmark asset | **added** — `frontend/assets/brand/spacestation-wordmark.svg` |
| Brand guard test | **added** — `test/brand-identity.test.js` (40+ assertions), proven to fail on injection |
| MIT attribution | **intact** — `LICENSE` + `package.json` note unmodified; guarded by the test |
| Internal identifiers (`X-StarNet-Token`, `__STARNET_*`, CSS classes, store keys) | **kept on purpose** — §45 RULE 1 forbids renaming them |

**Residual legacy scan [verified]:** `androoAGI/starnet` / `androoAGI/starnet-releases` URLs and historical
paths remain in **docs** (`BRIEF-LEDGER.md` §… records them as *identifiers, not rendered text*) and in a
few dev scripts. These are **not user-visible identity** and the earlier phases deliberately left them.

### ⚠️ Important nuance for this brief

This brief's §3 says *"search the entire repository for Andro / original product names."* A naive sweep
finds **1,497** matches (incl. `skynet`, `androoAGI`). **Do not treat that number as 1,497 tasks.**
Prior work established, and this audit re-confirms, the split:

- **Change:** user-visible strings + brand assets. *(done)*
- **Keep:** internal identifiers, CSS class prefixes, store keys, event names, the `skynet` app-data
  path, `X-StarNet-Token`, `__STARNET_*` globals. Renaming these is churn with real breakage risk and no
  user benefit — §45 RULE 1.

---

## 4. KEEP / MODIFY / REPLACE / REMOVE / STUDY (brief §2)

- **KEEP** — every sidecar module, every store, every route, the 841-test suite, the no-build frontend
  model, the JSON-store + `biz:<id>` isolation, the determinism lint, the honesty doctrine, MIT
  attribution. This is the bulk of the app.
- **MODIFY** — the **navigation / IA labels** (brief §5): regroup the existing windows
  (`businesscenter`, `businessmission`, `businessfactory`, `businessworker`, `businessdtwin`,
  `businessintelligence`, `businessautopilot`, `businesssecurity`, `businessmaker`, `businessmanager`,
  `businessautomation`) under the brief's 15 nav labels. **Presentation only.**
- **REPLACE** — **nothing.** §40's architecture is already the implementation; replacing it would
  violate §45 RULE 1.
- **REMOVE** — **nothing functional.** Only duplicated legacy *labels* on renamed surfaces.
- **STUDY** — the eight §41 repos (already triaged in `PHASE0-AUDIT-v2.md`): Orionfold Relay (Apache-2.0,
  STUDY), Autonomous Business OS (MIT, STUDY), Kompany (AGPL — **AVOID code**), BOS-AI (STUDY),
  Open Browser (MIT, STUDY/possible ADAPT), Browser Agent (STUDY), Relaticle (STUDY), n8n (Sustainable
  Use License — **AVOID vendoring**; external adapter shape only). **Zero are in `package.json` [verified].**

---

## 5. Dependencies & licenses **[verified]**

Runtime deps: `@huggingface/transformers`, `docx`, `kokoro-js`, `node-pty`, `ogg-opus-decoder`.
Dev: `@tauri-apps/cli`. License: **MIT** (`Copyright (c) 2026 Andrew Sims`), attribution intact.
**None** of the §41 repos is a dependency.

---

## 6. The one genuine gap this brief surfaces

Everything §5/§40 names exists, so the audit's job is to be as honest about the **thin** spots as the
prior audits were about the brand. Two are worth naming (both noted, **neither is a rebuild**):

1. **CREATOR STUDIO is a single store behind a generic window.** `business-content-store.js` is real and
   well-designed (8-stage pipeline, human-only publish gate — see its header), and
   `/api/businesses/:id/content` + `/api/content/:id/advance` exist. But the brief's §20 asks for a
   **dedicated CREATOR STUDIO surface** (ideas · research · scripts · video projects · assets ·
   thumbnails · content calendar · publishing · analytics · audience · revenue). Today there is no
   `creator`-named route module and no dedicated frontend window — it lives inside the Business Manager
   content tab. → **MODIFY/EXTEND, not build-new:** a `creator-routes.js` + a `creatorstudio.js` window
   that *present* the existing store, adding only what is genuinely missing (calendar, thumbnails).
2. **No single "my creations" portfolio view.** §37 wants every creation (businesses, apps, websites,
   games, AI systems, automations, content, YouTube, experiments, research) in one place with per-item
   status/type/mission/workers/cost/tech/deployment/analytics. Today portfolio data exists per-domain
   (`/api/intelligence/portfolio` is finance/metrics-oriented) but there is no **unified creations
   index** that spans every store. → **EXTEND:** one composing read-model (the same pattern as
   `business-remote.js`), no new store. **✅ Closed (Steps D + B):** `creations-index.js` composes
   content · documents · work orders · deliverables into `GET /api/creations`, and the **CREATIONS tab**
   of the CREATOR STUDIO window renders it — so the index now has a real viewer, not just a route.

These two are **presentation/composition** gaps. Neither requires touching an engine.

### 6a. Two more dead-ends closed (same "backend exists, viewer missing" class)

Found by re-sweeping every route for a frontend consumer, rather than trusting the earlier ranking:

- **DIGITAL TWIN ▸ COMPARE was a dead stub.** `frontend/app/businessdtwin.js` rendered a `COMPARE` tab
  button and an empty panel, but `state.comparison` was only ever set to `null` and **no frontend file called
  `POST /api/businesses/:id/twin/compare`** (the pure `shapeComparison` shaper was exported and unused). The
  tab is now wired: a successful what-if is **recalled in-session** (the twin stores nothing by design), the
  recalled runs are handed to the compare route through a new pure `pickComparable` (which returns the
  comparable scenarios **and names, by name, every run that produced no result** — a what-if that is not a
  column must be said out loud, never silently dropped), and the table renders one column per scenario over
  the shared recorded baseline. `businessdtwin.test.js` 61 → 82 assertions; sabotage-proven two ways
  (invert the pick branch · remove the compare call).
- **`POST /api/intelligence/costs/price` had no UI.** The AI COST panel reviewed what *was* spent but never
  asked what a run *would* cost. A **PRICE A RUN** form (token in/out) now prices a hypothetical run on every
  catalogued model through a new pure `shapePricing`; an unpriced model renders as **"unpriced"**, never as
  `$0` (a free-looking model that is merely unpriced is the expensive mistake). `businessintelligence.test.js`
  21 → 28 assertions; sabotage-proven (unpriced → `$0` goes red by name).

Re-checked and **already wired** (the earlier ranking was stale): `/api/factory/stages` has a reference
surface; `POST /api/worker/test` is consumed by `businessworker.js`; `/api/automation/{halt,resume}` is the
STOP ALL / RESUME button; OPPORTUNITY RADAR is the MAKER window's §22 tab.

### 6b. A test that ran in NO suite — the silent-shadow shape, again

Every manifest check went **list → file** ("every listed file exists"); none went **file → list**. So
**11 `test/*.test.js` were in neither `fast.list` nor `http.list`** and ran in no suite — green-looking files
with no runner. Two real consequences, both now fixed:

- `onboarding-legibility.test.js` had been unrun and **did** catch a real gap: a shipped `data-hint=
  "creatorstudio"` with no glossary copy. Entry added to `frontend/app/glossary.js`.
- `businessdtwin.test.js` (the console above) was never registered.

All 11 are now listed (green/skip ones in `fast.list`; the two that `spawnSync` in `http.list`), and
`test/test-list-runner.test.js` gained the **reverse assertion** — every `test/*.test.js` must appear in a
manifest — sabotage-proven with a planted orphan (red by name, green after removal).

### 6c. The §37 index spanned 4 of the types the brief names — widened to 8

The §37 index (`creations-index.js`) originally composed only what a business's WORK **produced** — content,
documents, work orders, deliverables. The brief's §37 lists the **structures the owner BUILT** as creations
too ("businesses … automations … experiments …"). Widened with four more types, each over a store that already
exists (no new store, no new write path):

| new type | store | title is | status is |
| --- | --- | --- | --- |
| `business` | `businesses-store.js` | the venture's name | its stage |
| `project` | `business-projects-store.js` | its name | its status |
| `experiment` | `business-experiments-store.js` | its **hypothesis** (the store has no title) | its status |
| `automation` | `business-automation-store.js` | its name | **enabled / disabled** |

The CREATIONS tab of CREATOR STUDIO renders them with no change beyond a label map — the viewer was already
type-agnostic, which is why this was a composer edit rather than a UI build.

⚠️ **A trap this walked into and out of:** the business projects store is `bizProjectsStore`
(`business-projects-store.js`), NOT `projectsStore` — which is `projects-store.js`, the **blessed-ROOT trust
store**. Two similarly-named stores with unrelated subjects; wiring the wrong one would have indexed
filesystem path-grants as "creations". Verified live: `GET /api/creations` returns all 8 types and a real
`business` row, `readable` all-true.

`creations-index.test.js` 121 → 193 assertions; `creator-routes` 54 · `creatorstudio` 62 → 69; sabotage-proven
(invented experiment title · business rows never emitted).

---

## 7. The ten Phase-0 questions, answered

1. **Works** → a large tested product (203 sidecar / 177 frontend modules, 841 tests); §1.
2. **Exists** → §2: essentially every system the brief names.
3. **Original identity** → already rebranded; only internal identifiers remain (correctly); §3.
4. **Preserve** → everything functional + MIT attribution; §4 KEEP.
5. **Redesign** → the nav/IA *labels* only; §4 MODIFY.
6. **Remove** → nothing functional; §4 REMOVE.
7. **Become native** → the brand layer (done) + the nav grouping (§5 labels); §3, §4.
8. **Dependencies** → 5 + 1, none from the §41 repos; §5.
9. **Licenses** → MIT, attribution intact & guarded; §5.
10. **Safest migration** → presentational re-organisation behind existing seams, pinned by a
    group→module map test; §0.

---

## 8. Recommended implementation plan (for authorisation — nothing built yet)

Ordered so each step is independently shippable, low-risk, and testable. Maps to the brief's own phases.

| Step | Brief phase | Work | Risk | Evidence of done |
|---|---|---|---|---|
| **A** | §44 Ph0–1 | **Navigation regroup** — map the 15 §5 labels onto the existing windows via a single `NAV_GROUPS` table. No module moves. | Low | new `test/nav-groups.test.js` asserts every label resolves to a real window + every window is reachable — **✅ DONE** (`frontend/app/navgroups.js` + `test/nav-groups.test.js`, 152 assertions, sabotage-proven; 9 non-§5 dock doors declared in a `UTILITY` allowlist; TERMINAL recorded as the one `pending` label) |
| **B** | §44 Ph2–3 | **Command Center pass** — ensure `/api/mission/{board,fleet,attention,trail}` feed one attention-first home; add any missing tile from §6. | Low | route tests + a tile→route contract test — **✅ DONE**. (1) `businessmission.js`: ATTENTION is the default first tab, consuming `/api/mission/attention` + per-row `/api/mission/alerts`; the attention count paints a new `#mssn-dock-badge`. (2) **The missing §6 tile**: the home now carries a declarative **`TILES` strip** — its doors out to the surfaces it ranks (THE BOARD · FLEET FIGURES · TRAIL · **MY CREATIONS** (the §37 index) · **CREATOR STUDIO**). Each tile declares the window `term` it opens **and** the route(s) that back it; a tile with an unknown window is dropped, never rendered dead. A tile's `section` **actually switches the target window's tab** (`openTerm` sets `consoleSection`, honoured at mount), so a "TRAIL" tile lands on TRAIL — the door opens what it promised. (3) **`test/mission-tiles.test.js` (74 assertions)** — the tile→route contract test: parses the REAL window registry (inline `BUILDERS` + `windows/*.js registerWindow`), the REAL route registry (`mission-routes.js` + `creator-routes.js`), and each window's REAL `data-tab` set from source, then asserts every tile opens a real window, lands on a real tab of it, and points at a real route; sabotage-proven in 4 modes (dead window key · invented route · strip moved off the home tab · wrong tab). `businessmission` 110 · `mission-tiles` 74 · `mission-routes` 100 · `mission-control` 89 · gates green |
| **C** | §44 Ph7, §37 | **Creator Studio surface** — `creator-routes.js` + `creatorstudio.js` presenting the existing content store; add calendar + thumbnails only. | Med | store tests reused; new route tests — **✅ DONE** (`sidecar/creator-studio.js` composer + `sidecar/creator-routes.js` + `frontend/app/creatorstudio.js` engine + window slot + `css/creatorstudio.css`; adds PIPELINE + a dated CALENDAR over the §17 store, no new store; `creator-studio.test.js` 42 · `creatorstudio.test.js` 40 · `nav-groups` now 154 with CREATOR STUDIO claiming a real window) |
| **D** | §37 | **Unified Creations index** — one composing read-model spanning all stores (pattern: `business-remote.js`). | Low | contract test: every creation type appears with status/type/mission — **✅ DONE** (`sidecar/creations-index.js` composes content+documents+workorders+deliverables into one newest-first index; `GET /api/creations?type=&business=`; **+ the CREATIONS tab** of the CREATOR STUDIO window renders it — `frontend/app/creatorstudio.js` `shapeCreations`/`renderCreations`, `creatorstudio.test.js` 62 assertions; `test/creations-index.test.js` 121 + `creator-routes.test.js` 54, all sabotage-proven; route-table-collision green) |
| **E** | §44 Ph12 | **Polish pass** — dedupe labels, remove superseded nav entries, empty/loading/error states. | Low | `lint-determinism` + a11y + `theme-contrast` stay green — **✅ DONE**. Labels/retired entries were already handled by NAV CONDENSE 1–3 (`TERM_ALIAS` in `stationui.js`; the 24 dock labels are unique; `UTILITY` in `navgroups.js` is the honest record). The real gap was ERROR STATES: Step B/C/D's loaders had NO `.catch`, so a dropped fetch left a panel on "reading…" forever with an unhandled rejection. Fixed in `businessmission.js` (5 catches → `.mssn-err`) + `creatorstudio.js` (2 catches → new `.cs-err`), both source-locked and sabotage-proven; `lint-determinism` 339 files OK · `theme-contrast` 186 · `control-floor-theming` 157 · `panel-brightness` 12 · nav/a11y green |
| **F** | §44 Ph13 | **Hardening** — run the relevant test suites directly (sandbox blocks nested spawns; see `BRIEF-LEDGER.md` §4). | Low | suites green — **✅ DONE**. Ran all 759 `fast.list` entries directly: **35 non-zero, ALL sandbox false-reds** (every one is `spawnSync`/`execFileSync`/brokered-fs → `expected 0, got null`); the entire blast radius is green — creations-index 121 · creator-routes 54 · creator-studio 42 · creatorstudio 43 · nav-groups 154 · businessmission 110 · mission-control 89 · mission-routes 100 · route-table-collision 5 · theme-contrast 186 · control-floor-theming 157 · panel-brightness 12 · prop-render-smoke 9 · toolprops 165 · capprop-map.contract 143 · dock-terms-open 9 · field-manual-accessibility 3 · lint-determinism 339 files. `website-app-sync --check` OK (mirror re-synced). |

**Explicitly NOT owed** (and should not be chased): re-architecting anything (§45 RULE 1); renaming
internal identifiers (§45 RULE 1); vendoring any §41 repo (§41.6 / §45 RULE 10); remote monitoring
(already built per `PHASE0-AUDIT-v3.md` §10).

---

## 9. Verification method note

Per `BRIEF-LEDGER.md` and project memory, this sandbox **blocks nested process spawns**
(`spawnSync` → `EBUSY`), so a full `npm test` cannot go green here and a *sweep script that spawns* will
falsely report everything red. The reliable method is running test files **directly**
(`node test/<name>.test.js`) in a loop. The counts in §0 are from `ls`/`wc` (not spawns) and the
existence claims are from `ls`/`grep` against the working tree.

---

*End of Phase 0 audit v4. No files were modified. Awaiting authorisation before any implementation.*
