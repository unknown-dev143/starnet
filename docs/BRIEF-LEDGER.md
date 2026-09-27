# Business OS — the completed / not-completed ledger

**What this is.** A line-by-line verdict against the brief's master prompt, requested as
*"verify for the prompt that I provided what is completed and is not completed."* Every row carries the
**evidence** that proves it. A row is `DONE` only when it is backed by a named module, a passing test, or a
live HTTP probe — never by intent.

**Companion doc.** `docs/PHASE0-AUDIT-v2.md` holds the full audit, the §6 gap list, and the live-verification
transcript. This ledger is the read-out.

**Scope of this ledger.** The §30 phase list (§1–§29) plus the eight §6 gap items. Where a § is `done`, the
row states what proves it; where a § is genuinely open, it says so plainly and why.

---

## 1. The headline

| | |
|---|---|
| Brief phases §1–§29 | **29 of 29 present** (§25 now built as the "architecture-ready" seam + read model the brief scopes) |
| §6 gap items | **8 of 8 closed** |
| Repo state | MIT-licensed; **zero** of the 8 researched repos are dependencies |
| Honesty discipline | 71 Business OS events; no fabricated score/health/grade/percentage anywhere (§11 check below) |

---

## 2. The §30 phase table, verified

| Brief § | Requirement | Verdict | Evidence |
|---|---|---|---|
| §1 | Business Brain / C-suite roles | **DONE** | `business-roles.js` — 12 roles **bridged** onto `shared/specialties.js` (bridge, not duplicate — P4) |
| §2 | Business lifecycle | **DONE** | `businesses-store.js` `STAGES` = the brief's **10**: `idea·validating·planning·building·testing·live·growing·paused·winding-down·archived`. `launching` folded into `live` with a recorded rationale. `INACTIVE_STAGES` is **one** source of truth (store / automation engine / index.js gate / UI). `test/business-os-lifecycle.test.js` (39). |
| §3 | Business memory | **DONE** | `business-memory.js` — 4 scopes + `biz:<id>` namespace |
| §4 | Business Factory | **DONE** | `business-templates.js` + `maker-routes.js`; 6 evidence classes enforced by the data model |
| §5 | Opportunity Radar | **DONE** | opportunity store + `maker-routes.js` (`opportunity.*` events) |
| §6 | Experiment Lab | **DONE** | `business-experiments-store.js` (397 ln) |
| §7 | AI Workforce registry | **DONE** | `business-agents-store.js` — every field the brief lists |
| §8 | Task orchestration | **DONE** | `business-tasks-store.js` (436) + work-orders |
| §9 | Goal Autopilot | **DONE** | `business-autopilot.js` + `autopilot-routes.js` + console `businessautopilot.js`. Goal → plan (read-only) → commit (the one mutating door). CLOSED goal set; unknown goal refused **with the known list**. Tests 56+60+43 = **159**. |
| §10 | Browser Worker | **DONE** | `tools/builtin/browser.js` (2,873 ln, 35 tools). Worker holds the **read-only half** (12 `research` tools, `wired:true`); interactive half deliberately absent + restricted. Pinned in `business-os-hardening.test.js` (196 — the count grew when the §25 commit extended the qrx sweep to all 14 route modules). |
| §11 | Computer Worker foundation | **DONE** | `business-worker-policy.js` — tool→§13 action table, fail-closed |
| §12 | Approval system | **DONE** | `business-approvals-store.js` (310) + held review-tier actions |
| §13 | Security system | **DONE** | `business-security.js` (composing reader) + `security-routes.js` + console `businesssecurity.js`. Tiers (`safe/review/restricted`), holders, decisions, pending. Read-only by construction — no POST where a guarded route already mutates. Tests 70 (engine) + 82 (routes) + 76 (console) = **228**. |
| §14 | Audit log | **DONE** | `business-activity-store.js` — append-only, bounded 500/business |
| §15 | AI cost management | **DONE** | cost / spend / ledger / budget (+ per-business tagging) |
| §16 | Model Router | **DONE** | `providers/factory.js` + `execution-router.js` + `fallbackchain.js` |
| §17 | Business Portfolio | **DONE** | `intelligence-engine.js` `portfolio()` — cross-business, returns `null` not `0` |
| §18 | Business Digital Twin | **DONE** | `business-twin.js` (pure what-if) + `twin-routes.js` + console `businessdtwin.js`. Runs **backward** from **recorded** readings; no reading → refuses. Every figure `kind:'simulation'` + `simulated:true` + `basis`; rates clamped 0..1 and clamps reported. |
| §19 | Business Intelligence | **DONE** | `intelligence-engine.js` — change / explain / anomalies |
| §20 | CRM | **DONE** | `business-crm-store.js` (391) |
| §21 | Automation engine | **DONE** | store + engine + depth bound + pass budget |
| §22 | AI Software Factory | **DONE** | `software-factory.js` (composing reader) + `factory-routes.js` + console `businessfactory.js`. Eight stages `idea·validate·business·spec·build·test·ship·operate`; each stage proven by a **recorded fact**; an unreadable source reads **"cannot tell"**, never `0`; **no percentage field exists**. Tests 54+37+37 = **128**. |
| §23 | Mission Control | **DONE** | `mission-control.js` (composing reader) + `mission-routes.js` + console `businessmission.js`. Every business on **one ranked board**; the ranking **IS** the named reasons (no score). Tests 89 (engine) + 100 (routes) + 88 (console) = **277**. |
| §24 | Emergency Stop | **DONE** | `halt.js` — station E-STOP **and** scoped per-business stop |
| §25 | Remote monitoring | **DONE (seam + read model)** | Brief §27 asks "eventually let the user monitor remotely … prioritize monitoring and approvals", and scopes it "architecture-ready". Built as `business-remote.js` (a composing READ MODEL — owns no store, writes nothing) + `remote-routes.js` (`/api/remote/summary · businesses/:id · status`, all GET) + `business-remote-seam.js` (the binding point, **disabled by default**, opens no listener). No remote workstation was reproduced, per the brief. Tests 60 (read model) + 79 (routes) + 43 (seam). |
| §26 | Integration adapters | **DONE** | MCP manager + channels registry |
| §27 | License requirement | **SATISFIED** | Repo is MIT. **No external repo referenced anywhere.** |
| §28 | Dependency rule | **SATISFIED** | Zero of the 8 researched repos are dependencies (repo-wide grep) |
| §29 | No duplicate functionality | **HONOURED** | Phase 3 **bridged** into `shared/specialties.js` rather than duplicating |

---

## 3. The eight §6 gap items

| # | Gap | Brief § | Verdict | Evidence |
|---|---|---|---|---|
| 1 | Browser tools unclassified | §10 | **DONE** | 35 tools classified by consequence (`329b3aeb4`) |
| 2 | Browser callable by a worker | §10 | **DONE** | Read-only half wired: 12 `research` tools, headless, anonymous profile (`f7fa49c08`) |
| 3 | Business Digital Twin / scenario simulation | §18 | **DONE** (Phase 9) | `business-twin.js` — backward, evidence-bound, `kind:'simulation'` |
| 4 | Goal Autopilot single entry | §9 | **DONE** (Phase 12) | `business-autopilot.js` + `autopilot-routes.js` + console |
| 5 | Unified Mission Control window | §23 | **DONE** (Phase 11) | `mission-control.js` + `mission-routes.js` + console |
| 6 | Security Center window | §13 | **DONE** (Phase 10) | `business-security.js` + `security-routes.js` + console |
| 7 | AI Software Factory pipeline | §22 | **DONE** (Phase 12) | `software-factory.js` + `factory-routes.js` + console |
| 8 | Lifecycle divergence (6 vs 10) | §2 | **DONE** (Phase 12) | `STAGES` extended to the brief's 10 |

---

## 4. What is *not* complete — stated plainly

Nothing on the brief's §30 list or the §6 gap list is outstanding. What remains is **verification
environment**, not product:

| Item | State | Why |
|---|---|---|
| The **full** `test/fast.list` gate (750 steps) green in one run | **Not achieved here** | This execution sandbox **blocks nested process spawns** (`spawnSync` of *any* child exits `EBUSY` / returns `status:null`, even with the sandbox disabled). ~65 of the steps spawn a subprocess (git probes, PowerShell, release trains, eval CLIs) and therefore cannot pass **here** regardless of the code. They are expected to pass on a normal machine. `test/fast.list` in the commit has **no test excluded** — the §25 commit only *added* three registrations (a purely additive diff). |
| `website-deploy-staging` | **Env artifact** | `website-deploy/` is a gitignored *generated* build artifact (`scripts/stage-website-deploy.mjs`); regenerating it fixes the initial `ENOENT`, leaving only the nested-`spawnSync` EBUSY step (`spawnSync(…).status === null`). 23 of 24 assertions pass. |
| `qa-cartographer` / `toolprops` / `prop-render-smoke` | **Pre-existing failures**, not ours | 7 capability props have no sprite renderer / no tool mapping (`414b05161`, `446987fac`). Confirmed pre-existing by commit archaeology; untouched by this work. |
| §25 remote monitoring | **DONE — the "architecture-ready" seam + read model** | Built to the brief's own scope ("eventually … prioritize monitoring and approvals"): a composing read model + a disabled-by-default binding seam. No remote workstation, no second listener. See §2's row. |

*(Update 2026-09-27: the visible-identity rebrand — the transformation brief's §3 — was the one open
product item after this ledger was written. It is now **DONE**: Phase 1 (`cba3891a5`) rebranded the
in-app chrome, and Phase 2 (`7b1d2f154`) carried the same rule out to the packaged app metadata, the
installer, the Rust shell's user-visible strings, the README and the public website. Guarded by
`test/brand-identity.test.js` (40 assertions). With that closed, the only item still deliberately not
built is §25 remote monitoring. Two incidental fixes came with Phase 2: a Phase 1 regression in
`test/brand-wordmark-mask.test.js`, and three pre-existing `test/font.law.test.js` failures from the
Phase 10–12 CSS.)*

*(Update 2026-09-27, later: **§25 remote monitoring is now BUILT**, to the brief's own "architecture-ready"
scope — see §2's row. The ledger's "deliberately absent" verdict above is superseded. Nothing in the brief
remains unbuilt. The build is a READ MODEL (`business-remote.js`) over the existing stores plus a
binding SEAM (`business-remote-seam.js`) that is DISABLED BY DEFAULT and opens no listener; three GET
routes expose it (`/api/remote/summary · /businesses/:id · /status`). Live-smoked on a scratch workspace:
`/api/remote/status` reports `bound:false, enabled:false` and names all four missing requirements; a
created business then appears in `/api/remote/summary` with real values; a bogus id 404s and a wrong token
403s (proving the route exists and auth covers it).)*

---

## 5. Honesty checks that were run against the new modules

| Property | Where | Result |
|---|---|---|
| No `Date.now` / RNG in any sidecar module | `test/lint-determinism.js` (script) | `scanned 333 files; OK` |
| No fabricated score / health / grade / percent | `business-security.test.js`, `software-factory.test.js`, `businessmission.test.js`, `business-autopilot.test.js` | source-locks present and biting |
| `latest()` returns `null`, never `0` | `businessfactory.test.js` — `countText` renders `—` for unobservable | pass |
| Unreadable source reported as unavailable | `software-factory.test.js` — `unobservable` state, count `NULL` | pass |
| A rate is a fraction bounded 0..1, never summed | `business-security.test.js` | pass |
| A mutating action has exactly one door (P4) | Security/Mission/Factory consoles issue **no** POST | pass |
| Every `data-hint` resolves to glossary copy | `test/station-tooltip.test.js` (443) | pass |
| Website mirror in sync | `node scripts/sync-website-app.mjs --check` | `OK` |

---

## 6. Bottom line

**Every requirement the brief lists is present**, with the single explicit exception of §25 remote
monitoring, which the brief itself scopes to "architecture-ready" and which is therefore not owed.

The one thing **not** proven in this session is the *full* 732-step gate running green end-to-end, and that
is an artifact of the sandbox refusing nested process spawns — not of the change. The Business OS suites
themselves were all executed and passed. Phase 10–12 alone is **12 suites, 792 assertions, 0 failures**:

| Suite | Assertions |
|---|---|
| `business-security` | 70 |
| `security-routes` | 82 |
| `businesssecurity` | 76 |
| `mission-control` | 89 |
| `mission-routes` | 100 |
| `businessmission` | 88 |
| `business-autopilot` | 56 |
| `autopilot-routes` | 60 |
| `businessautopilot` | 43 |
| `software-factory` | 54 |
| `factory-routes` | 37 |
| `businessfactory` | 37 |
| **total** | **792** |

Plus the broad guards: `business-os-hardening` 189, `business-os-lifecycle` 39, `station-tooltip` 443,
`events-contract` 9, `onboarding-legibility` 49, `dock-terms-open` 9, `module-scope-shadowing` 7,
`bottle-wiring` 22, `brand-wordmark-mask` 22, `boot-security` 16. Across the whole Phase 9–12 set the
cumulative count is **1,144 assertions, 0 failures**.
