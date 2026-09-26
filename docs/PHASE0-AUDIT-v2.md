# PHASE 0 — AUDIT v2: SpaceStation vs. the Business-OS master prompt

**Scope:** read-only inspection + reconciliation of the master-prompt brief against the code as it actually
stands. **Nothing was modified to write this document** (only this file was created).

**Date:** 2026-09-26 · **Repo:** `starnet/` (branch `feat/harness-backend`, HEAD `21d13498c`, v0.10.10)
**Method:** direct file inspection (`wc -l`, `grep`, file reads) + running the Business OS test suites.

> This supersedes `docs/PHASE0-AUDIT.md` (2026-09-24), which was written *before* Phases 1–8 were built and
> therefore reports "the Business OS is greenfield". **That is no longer true** — Phases 1–8 are complete,
> tested, and committed. The headline finding of this audit is the delta since then.

Every claim is marked **[verified]** (read directly from source / produced by running it), **[inferred]**
(derived from structure/comments) or **[unknown]**.

---

## 0. THE HEADLINE FINDING — read this first

**The brief describes a build that is already ~85–90% complete.** This is not a greenfield project.

The master prompt reads as a plan to "upgrade SpaceStation into an AI Business OS". In fact that upgrade has
already been carried out across eight committed phases, each with its own design doc, its own tests, and an
explicit honesty discipline:

| Brief phase (§30) | Status in the repo | Evidence |
|---|---|---|
| Phase 0 — audit | **done** (`docs/PHASE0-AUDIT.md`) | this document |
| Phase 1 — architecture/foundation | **done** | `businesses-store.js`, `business-activity-store.js`, `business-routes.js` |
| Phase 2 — business intelligence | **done** | `opportunity*`, `business-templates.js`, `maker-routes.js` — 881 assertions |
| Phase 3 — AI workforce | **done** | `business-agents-store.js`, `business-roles.js`, `business-permissions.js`, `agent-routes.js` |
| Phase 4 — execution | **done** | `business-worker.js`, `business-worker-policy.js`, `worker-routes.js` |
| Phase 5 — automation | **done** | `business-automation-store.js`, `business-automation-engine.js`, `automation-routes.js` |
| Phase 6 — business management | **done** | finance · CRM · content · documents · knowledge · experiments · metrics |
| Phase 7 — hardening→intelligence | **done** | `intelligence-engine.js`, `intelligence-routes.js` |
| Phase 8 — production/hardening | **done** | `business-os-hardening.test.js` (116) + a 30-check audit script |

**Verified scale:** 33 Business OS sidecar modules (~11,000 lines), 8 route modules, 9 frontend windows,
**71 of the 104 frozen bus events** are the Business OS's, and **~3,900+ assertions** pass across the
Business OS suites (a partial count of 33 suites; all green, run this session).

**Therefore the correct next move is NOT to start building from §1.** It is to (a) confirm this reading, and
(b) work the genuinely-open gaps listed in §6. Starting over would be the single most destructive thing
possible here — it would duplicate working, tested, hardened systems, which is exactly what the brief's own
P4/§29 forbids.

---

## 1. What SpaceStation actually is

Local-first, **single-user**, Tauri 2 desktop app. One Node process (`sidecar/index.js`, now **20,302
lines**) serves `frontend/` statically and HTTP+SSE on `:8787`, and runs the agent loop in-process.
No build step, **no SQL** — persistence is JSON via `durable-store.js` (atomic fsync-before-rename +
last-known-good `.bak`). **[verified]**

Current metrics **[verified]**:

| Metric | Value |
|---|---|
| `sidecar/index.js` | 20,302 lines — THE hotfile |
| `sidecar/*.js` | 190 modules |
| `sidecar/*-routes.js` | 8 route modules (Phase 1–7 surface) |
| `frontend/app/*.js` | 172 modules, no build step |
| `test/*.test.js` | 819 suites |
| `test/fast.list` | 732 gate steps |
| Frozen bus events | 104 (71 of them Business OS) |
| License | **MIT**, © Andrew Sims **[verified: `LICENSE`]** |

---

## 2. Layer-by-layer findings (current state)

| Layer | State | Note |
|---|---|---|
| Process model | **Working** | one Node process on :8787 |
| Frontend | **Working, large** | 172 `app/*.js`, canvas station, no build step |
| Backend | **Working but monolithic** | `index.js` = 20,302 lines; every route registers here |
| Database | **No SQL** | JSON stores + localStorage v5; isolation is **by key namespace**, not foreign keys |
| Auth | **Working** | loopback Host pin + Origin allow-list + per-launch token on every `/api/*` |
| AI/LLM | **Working, multi-provider** | `providers/factory.js` + anthropic, openrouter, openai-compatible, gemini, codex |
| Agent system | **Working** | `loop.js`; crew = real separate runs |
| Capability | **Working (spatial)** | an agent's tools = which props are placed in its room |
| Terminal | **Working** | `terminal-sessions.js` + `tools/builtin/terminal.js` |
| Browser | **Working, mature** | `tools/builtin/browser.js` = **2,873 lines**, Playwright-backed |
| Computer | **Working** | `tools/builtin/computer.js` + `desktop.js` + `win32desktop.js` |
| Memory | **Working** | `memcore.js`, `context.js`, `memory-store.js` + business/project scopes |
| Cost / spend | **Working, real USD** | `cost/spend/credits/ledger/budget/budgetcaps` |
| Safety | **Working** | `permissions.js` consent broker, `permgrants.js`, `halt.js` (E-STOP), `taint.js` |
| MCP / integrations | **Working** | `mcp/manager.js` + http/stdio + OAuth 2.1 + curated catalog |
| Automation (cron) | **Working** | `cron*.js` (pure math, lock, store, driver, guard, autonotify) |
| **Business OS** | **Working — Phases 1–8 complete** | see §3 |

---

## 3. The Business OS as built — function-by-function

### 3.1 Sidecar modules (33, ~11,000 lines) **[verified]**

| Group | Modules |
|---|---|
| Entity & audit | `businesses-store.js` (204), `business-activity-store.js` (164), `business-routes.js` (215) |
| Maker (§22/§4/§5) | `business-templates.js` (304), `maker-routes.js` (138 assertions) |
| Team (§7/§13/§9) | `business-agents-store.js` (237), `business-roles.js` (136 a.), `business-permissions.js` (237), `business-memory.js` (231), `agent-messages-store.js` (158), `agent-routes.js` (422) |
| Manager (§10/§11/§16/§15/§14) | `business-finance.js` (435), `business-metrics.js` (263), `business-crm-store.js` (391), `business-content-store.js` (267), `business-documents-store.js` (259), `business-knowledge.js` (292), `business-experiments-store.js` (397), `business-projects-store.js` (214), `business-tasks-store.js` (436), `manager-routes.js` (903) |
| Automation (§12/§13/§19) | `business-automation-store.js` (810), `business-automation-engine.js` (623), `business-approvals-store.js` (310), `automation-routes.js` (431) |
| Worker (§18/§13) | `business-worker.js` (494), `business-worker-policy.js` (590), `business-workorders-store.js` (386), `worker-routes.js` (308) |
| Intelligence (§11/§30) | `intelligence-engine.js` (496), `intelligence-routes.js` (248) |

### 3.2 Frontend windows (9) **[verified]**

`businesscenter.js`, `businessmaker.js`, `businessmanager.js`, `businessautomation.js`,
`businessworker.js`, `businessintelligence.js`, plus `permissions.js` / `permissionsstore.js` /
`agentid.js`. All are registered in the dock (`data-term` = `business`, `maker`, `manager`, `automation`,
`worker`, `intelligence`, `team`, `agents`, `tasks`).

### 3.3 Brief requirement → where it already lives

| Brief § | Requirement | Status | Where |
|---|---|---|---|
| §1 Business Brain / C-suite roles | **done** | 12 roles bridged onto `shared/specialties.js` (**bridge, not duplicate** — P4) |
| §2 Business lifecycle | **done** | `idea·validating·planning·building·testing·live·growing·paused·winding-down·archived` (the brief's **10** states; `launching` deliberately folded into `live` — see the rationale in `businesses-store.js`). `INACTIVE_STAGES` is one source of truth across the store, the automation engine, index.js's work-order gate and the UI. |
| §3 Business memory | **done** | `business-memory.js`, 4 scopes + namespaced `biz:<id>` |
| §4 Business Factory | **done** | templates + maker funnel; 6 evidence classes enforced by the data model |
| §5 Opportunity Radar | **done** | opportunity store + routes (`opportunity.*` events) |
| §6 Experiment Lab | **done** | `business-experiments-store.js` (397) |
| §7 AI Workforce registry | **done** | `business-agents-store.js` — every field the brief lists |
| §8 Task orchestration | **done** | `business-tasks-store.js` (436) + work-orders |
| §9 Goal Autopilot | **done** | `business-autopilot.js` — the single entry: a stated goal → a full plan → committed tasks. CLOSED goal set; an unknown goal is refused with the known list (P7). `autopilot-routes.js` (catalog·plan·commit). |
| §10 Browser Worker | **done** | `tools/builtin/browser.js` (2,873 ln, **35 tools**). Worker now gets the **read-only half** (12 `research` tools, `wired:true`); interactive half stays absent + restricted. See §6b/§6c. |
| §11 Computer Worker foundation | **done** | `business-worker-policy.js` — tool→§13 action table, fail-closed |
| §12 Approval system | **done** | `business-approvals-store.js` (310) + held review-tier actions |
| §13 Security system | **done** | `business-security.js` (composing reader) + `security-routes.js` + console `businesssecurity.js` — the combined "Security Center": every action's tier, who holds what, decisions, pending. Read-only by construction. |
| §14 Audit log | **done** | `business-activity-store.js` append-only, bounded 500/business |
| §15 AI cost management | **done** | cost/spend/ledger/budget (+ per-business tagging) |
| §16 Model Router | **done** | `providers/factory.js` + `execution-router.js` + `fallbackchain.js` |
| §17 Business Portfolio | **done** | `intelligence-engine.js` `portfolio()` — cross-business, `null` not `0` |
| §18 Business Digital Twin | **done** | `business-twin.js` (pure what-if engine) + `twin-routes.js` + console `businessdtwin.js` — every figure labelled `kind:'simulation'` |
| §19 Business Intelligence | **done** | `intelligence-engine.js` — change/explain/anomalies |
| §20 CRM | **done** | `business-crm-store.js` (391) |
| §21 Automation engine | **done** | store + engine + depth bound + pass budget |
| §22 AI Software Factory | **done** | `software-factory.js` (composing reader) + `factory-routes.js` + console `businessfactory.js` — the Idea→Validate→Business→Spec→Build→Test→Ship→Operate pipeline, each stage proven by a recorded fact, **no percentage invented**. |
| §23 Mission Control | **done** | `mission-control.js` (composing reader) + `mission-routes.js` + console `businessmission.js` — every business on one ranked board, the reasons ARE the ranking (no score). |
| §24 Emergency Stop | **done** | `halt.js` — station E-STOP **and** scoped per-business stop |
| §25 Remote monitoring | **missing by design** | no remote interface (brief says "architecture-ready" only) |
| §26 Integration adapters | **done** | MCP manager + channels registry |
| §27 License requirement | **satisfied** | repo is MIT; **no external repo is referenced anywhere** |
| §28 Dependency rule | **satisfied** | zero of the 8 researched repos are dependencies **[verified: repo-wide grep]** |
| §29 No duplicate functionality | **honoured** | Phase 3 explicitly bridged instead of duplicating |

---

## 4. The 8 researched repositories — classification

**Key finding: none of the 8 is referenced anywhere in the repo.** **[verified: case-insensitive grep across
`*.js`/`*.md`/`*.json` returns nothing]** They are greenfield *references* in the brief, not existing
dependencies. So the §27/§28 licensing analysis has a clean starting point: there is nothing to un-vendor.

| Repo | Brief says study | Verdict | Why |
|---|---|---|---|
| **Orionfold Relay** (Apache-2.0) | orchestration, scheduling, cost, approvals | **STUDY** | SpaceStation already has all of it (cron, cost/ledger, approvals, agent loop). Mine it for *ideas* only. |
| **Autonomous Business OS** (MIT) | lifecycle, departments, spawning, memory namespaces, approval queues, audit | **STUDY** | This is the closest analogue to what's already built. Compare designs; do not import. |
| **Kompany** (AGPL-3.0) | C-suite, delegation, debates, budgets | **AVOID (code)** | AGPL-3.0 is copyleft-incompatible with shipping a proprietary MIT-derived desktop app. **Ideas only, no code.** |
| **BOS-AI** | specialist business agents | **STUDY** | Same role model already bridged in Phase 3. |
| **Open Browser** (MIT) | browser execution layer | **STUDY / possible ADAPT** | MIT is compatible. But SpaceStation's `browser.js` (2,873 lines, Playwright) already exists — evaluate only if a concrete gap appears. |
| **Browser Agent** | risk tiers, confirmation, DOM verification, audit | **STUDY** | Its *principles* are already implemented in `business-worker-policy.js` (risk tiers, fail-closed). |
| **Relaticle** | CRM | **STUDY** | CRM already exists. Do not replace. |
| **n8n** (Sustainable Use License) | optional automation backend | **STUDY as external adapter only** | **Not open-source in the OSI sense** — its license restricts commercial resale. Never vendor the code; an *adapter* to a user-run instance is the only safe shape. |

**Recommended classifications requested by the brief:**
- **USE** — nothing. (No repo earns "use" until a *concrete* gap is proven.)
- **ADAPT** — possibly Open Browser, *only if* a specific browser gap is demonstrated.
- **STUDY** — Orionfold Relay, Autonomous Business OS, BOS-AI, Browser Agent, Relaticle, n8n.
- **AVOID** — Kompany (AGPL code), n8n (code vendoring).

---

## 5. Technical debt & duplication

1. **`index.js` = 20,302 lines** — grew ~900 lines since the last audit. The top structural risk; every new
   route is a merge magnet. **[verified]** → keep mounting modules, never inline.
2. **`CODE_MAP.md` is stale** — claims sidecar "~23k / ~82 files" (actual 190 files), frontend "~133"
   (actual 172), tests "~409" (actual 819). **[verified]**
3. **No SQL, no migrations** — isolation must be, and is, enforced by key namespacing. **[verified]**
4. **Route-table trap has now bitten twice** — the `qrx`-vs-`rx` bug (fixed this session in
   `agent-routes.js`, commit `21d13498c`; previously in `manager-routes.js`). A module-level source sweep
   now guards it in `business-os-hardening.test.js`, but the *pattern* keeps recurring. **[verified]**
5. **Sandbox cannot run the full gate** — `test/source-text-integrity.test.js` fails with
   `spawnSync git EBUSY`; confirmed environmental (fails identically on a pristine stashed tree). **[verified]**
6. **No duplicate systems found** for the Business OS — Phase 3 deliberately bridged onto existing
   specialty/permission/memory primitives. **[verified — this is a P4 pass, not a fail]**

---

## 6. The genuinely-open gaps (what Phase 1+ should actually target)

Ordered by value. Each is *verified absent or partial* above.

| # | Gap | Brief § | Effort | Note |
|---|---|---|---|---|
| 1 | ~~Browser tools unclassified~~ **DONE** (`329b3aeb4`) | §10 | — | 35 tools classified by consequence. |
| 2 | ~~**Browser callable by a worker** (the §6c decision)~~ **DONE** (`f7fa49c08`) | §10 | — | Read-only half wired (12 `research` tools, headless, anonymous profile). Interactive half still held. |
| 3 | ~~**Business Digital Twin / scenario simulation**~~ **DONE** (Phase 9) | §18 | — | Runs **backward**: applies explicit assumptions to **recorded** readings; never forecasts. No reading → refuses. Every figure `kind:'simulation'` + `simulated:true` + `basis`. Rates clamped 0..1, clamps reported. |
| 4 | ~~**Goal Autopilot single entry**~~ **DONE** (Phase 12) | §9 | — | `business-autopilot.js` + `autopilot-routes.js` + console. A stated goal resolves to a full plan (read-only) and commits into a business's tasks. CLOSED goal set — an unknown goal is refused with the known list, never invented. |
| 5 | ~~**Unified Mission Control window**~~ **DONE** (Phase 11) | §23 | — | `mission-control.js` + `mission-routes.js` + console. One ranked board; the ranking IS the named reasons (no score). Live-verified. |
| 6 | ~~**Security Center window**~~ **DONE** (Phase 10) | §13 | — | `business-security.js` + `security-routes.js` + console. Tiers, holders, decisions, pending. Read-only. Live-verified. |
| 7 | ~~**AI Software Factory pipeline**~~ **DONE** (Phase 12) | §22 | — | `software-factory.js` + `factory-routes.js` + console. The eight-stage pipeline, each stage proven by a recorded fact; an unreadable source shows "cannot tell", never a zero; **no percentage**. |
| 8 | ~~**Lifecycle divergence**~~ **DONE** (Phase 12) | §2 | — | Extended to the brief's 10 states; `launching` folded into `live` with a recorded rationale; `INACTIVE_STAGES` is one source of truth. |

---

## 6b. LIVE VERIFICATION — the audit claim tested end-to-end

The headline claim ("the system exists") was verified by **booting the sidecar and driving the real HTTP
surface**, not by reading files. All of the following was executed against a scratch workspace this session
(`SPACESTATION_WORKSPACES=/tmp/ss-audit`, port 8793, fixed token). Every result below is **[verified]**.

### What was exercised, and what it proved

| Probe | Result |
|---|---|
| 7 catalog endpoints (`/api/roles`, `/permissions`, `/templates`, `/manager/catalog`, `/automation/catalog`, `/worker/catalog`, `/intelligence/models`) | all **200** |
| Create business → hire 3 agents (ceo/finance/marketing) | agents got real specialties: `strategist`, `treasurer`, `marketer` — the **bridge** to `shared/specialties.js` works |
| Record finance revenue | accepted only with `provenance:'actual'`; totals came back **split** into `recorded:{revenue:1200}` vs `estimated:{revenue:0}` — never blended (§10 P2) |
| Record metric | accepted only with an `evidence` class; the 13-metric summary returned **`latest:null`** for every unmeasured metric, never `0` (§11) |
| CRM contact | created; contact `attention.rules` returned as named rules, not a "lead score" |
| Cross-business portfolio | `customers total:14`; unmeasured metrics reported `missing:1, total:null` |

### The guards fired, unprompted — this is the important part

Four requests were **deliberately under-specified**, and the system refused each with a specific reason
rather than accepting a half-fact:

1. `finance` with no category → *"unknown revenue category: (none) — one of: sales, subscription, …"*
2. `finance` with no provenance → *"a transaction needs a provenance (P2) … An unlabelled figure cannot be
   told apart from an invented one."*
3. `metrics` with no source → *"a reading needs a source (P1) — where the number came from"*
4. `metrics` with no evidence class → *"a reading needs an evidence class, one of: verified, analysis,
   assumption, estimate, prediction, unknown"*

### Isolation (P6) — verified both ways

- **Collection reads are strictly scoped.** `second-venture` returned **zero** agents / transactions /
  contacts while `audit-roasters` held 3 / 1 / 1.
- **Cross-tenant mutation is refused.** Assigning `audit-roasters~a1` to a `second-venture` task returned:
  *"agent audit-roasters~a1 belongs to business \"audit-roasters\", but this task belongs to
  \"second-venture\" — cross-business assignment is refused (P6)"*.

**One nuance worth recording (NOT a leak).** `GET /api/contacts/:id` returns 200 for a *fully-qualified*
foreign id (`audit-roasters~c1`) and 404 for a bogus one. This is **id-addressed reading, not cross-tenant
access**: the id itself carries the tenant, and the response names `businessId` explicitly. Collection
routes stay scoped; single-entity routes are global-by-id. This is a deliberate design shape, and it is
consistent — but it should be documented, because it *looks* like a leak to an auditor who only sees the 200.

### Automation safety — the tier is derived, not declared

Two rules with **identical shape** got different autonomy purely from their action:

| Action | Resulting tier | Autonomy |
|---|---|---|
| `create_task` | `["safe"]` | `autonomous` |
| `send_external` | `["review"]` | `approval` |

The hub reported its real bounds: `maxDepth:3`, `maxRunsPerPass:100`, `maxRulesPerEvent:25`. This is exactly
the Phase 5 cascade-safety design, confirmed at runtime.

### E-STOP — verified

- Hub halt → `halted:true`, and the hub recorded `skippedHalted:1` (it **refused to fire while stopped**).
- Per-business pause via `PATCH stage:"paused"` → succeeded, `halted` count reported.

### ⚠️ CONCRETE GAP FOUND — the browser tools were unclassified (FIXED); and a second, deliberate layer

**Layer 1 — the policy gap (REAL, now FIXED).** `tools/builtin/browser.js` declares **35 browser tools**.
`business-worker-policy.js` mapped **only one** (`browser.login`) and had **no `browser.` prefix family**, so
the other 34 fell through to the fail-closed default (`access_sensitive` → restricted). Fixed by enumerating
all 36 browser entries by consequence and adding `browser.` families. **Verified live:** the worker catalog's
browser rows went 1 → **36**, with **0** still default-classified; catalog total 86 → 121.

**Layer 2 — the worker registry is a DELIBERATE SUBSET (not a bug).** After the fix, `wired` still read
**0/36** for browser tools — because `makeWorkerRegistry()` (index.js:3412) assembles a deliberately small
registry (web, connectors, station-inspect, fs, notebook, recall, skill, todo, deliverable, code, verify,
quest, station) and does **not** register browser / shell / terminal / computer. In the same fresh workspace
**32 tools were wired**, so `wired` is about host registration, not about props placed.

`business-worker.js`'s own header states this on purpose: the worker *"carries a deliberate subset"*, and the
runner must **distinguish "the policy refuses this" from "the policy would allow it but the worker has no
route to it"** — *"those are different facts and a user acting on them would do different things."*

**Honest conclusion (as of Phase 0):** the `329b3aeb4` fix made browser steps **correctly classified** (no
longer silently dead), but at that moment the browser was **still not callable** by a business worker,
because the worker registry does not carry it. That was a *separate, deliberate* decision, not an oversight.
**That decision has since been made and implemented** (`f7fa49c08`, see §6c): the read-only half is wired,
the interactive half remains absent. The general lesson stands, though — **`wired` and `tier` are two
different facts about a tool**, and a change to one does not imply the other. Always check both.

---

## 6c. THE DECISION LEFT TO THE USER — should the browser be callable by a worker?

Phase 0 fixed *classification*. It did **not** make the browser reachable. That is a separate decision, and
this section records exactly what it would cost so the choice is informed.

**What changing it would mean.** Add browser registration to `makeWorkerRegistry()` (index.js:3412), roughly:

```js
makeBrowserTools({ session: <the station's browser session>, ... }).register(reg);
```

**Why it is not a one-line change:** `makeBrowserRegistry`'s other registrations are pure/stateless
(web tools take a `reader`, fs takes a jail). The browser takes a **live Playwright session**, and
`browser.js`'s own header notes the session is created per-run and deliberately not retained at module
scope. Wiring it for an unattended worker means deciding:

1. **Session lifetime** — one session per work order? per step? a shared, long-lived one?
2. **Profile** — the durable station Chrome profile (which holds the Commander's cookies) or a clean one?
   Handing an unattended agent the Commander's logged-in profile is the single highest-risk variant.
3. **Headless posture** — `browser.js` has an `allowVisible` flag; an unattended worker must almost
   certainly be headless-only.
4. **The two-gate interaction** — every browser call would then be judged by §13 (now correct, this commit)
   *and* the runtime consent broker. A `restricted` browser action is already non-runnable; the open
   question is whether `research`-tier reads (navigate/snapshot) should auto-run unattended.

**Recommendation:** if the user wants §10 satisfiable, the smallest safe first step is **read-only browser
access** — register the browser and grant only the `research` tier (navigate/snapshot/get_text/inspect/find),
on a **clean profile**, headless. That gives a business worker real research capability with no credential
exposure and no ability to act. Interactive browser work (click/type/upload) should stay **held for human
approval** even after that, which the policy already does correctly as of this commit.

**Status: DECIDED AND IMPLEMENTED** (`f7fa49c08`). The user took the recommended option — read-only browser
access — and it is now wired. `makeWorkerRegistry()` builds `makeBrowserTools({...})` with the hardened
posture (headless, `syntheticInputOnly`, `cdpPort: 0`, throwaway profile, `cleanupProfile: true`) and then
**filters the toolset to the 12 `research` tools before registering**. Q1 (session lifetime) resolved the
same way `browser.js` already resolves it for a normal run: **per-run session**, fresh registry per work
order. Q2 (profile) resolved as **clean throwaway profile** — and deliberately *no* `persistentProfile`
lease and *no* `attendedLogin`, so an unattended worker cannot inherit the Commander's cookies; Q3 headless
only; Q4 unchanged — the two gates still AND.

The result, verified live on a fresh boot:

| check | value |
|---|---|
| browser rows in `/api/worker/catalog` | 36 |
| **wired** browser tools | **12** (all `safe` / `research`) |
| wired interactive browser tools | **0** |
| total wired tools | 32 → **44** |

and end-to-end on a dry-run work order: `browser.navigate`/`browser.get_text` → `wired:true`, `outcome:run`;
`browser.click` → `tier:restricted`, `wired:false`, `outcome:deny`. **The worker can read the web and
cannot act on it**, and the two fences (policy tier + registry membership) agree.

The invariant is pinned at the source in `test/business-os-hardening.test.js` (116 → 189 assertions), with a
comment-stripping scan of `makeWorkerRegistry()`'s body plus a per-tool cross-check against the policy table.
Confirmed to bite: injecting `browser.click` or `persistentProfile` into the registry fails the gate.

**Interactive browser work stays held for human approval** — as recommended, and as the policy already did.

---

## 7. Recommended next move

1. **Confirm this audit with the user** — specifically the headline that Phases 1–8 already exist. The brief's
   §30 phase numbering does **not** map onto the repo's phase numbering, which is a real source of confusion.
2. If the user agrees the base is done, **Phase 1+ should target the §6 gap list**, one at a time, in the
   established house style: a pure module + injected deps + a mounted route module + a window + tests, with
   the repo's honesty discipline (no fabricated numbers) preserved.
3. **Do not import any of the 8 repos.** STUDY/AVOID per §4 above.

---

## 8. Risks to carry forward

- **Frozen contract** — `shared/events.js` is additive-only; 71 of 104 events are already Business OS.
- **Capability is spatial** — a business agent can only use tools grantable via a placed prop + `CAP_REGISTRY`.
- **No DB isolation** — P6 lives in code (namespaced keys), so every new store must honour it.
- **20k-line hotfile** — mount, never inline.
- **Single-process invariant** — one sidecar per workspaces dir; no cross-process locking.
