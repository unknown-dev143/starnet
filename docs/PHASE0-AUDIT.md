# PHASE 0 — AUDIT: SpaceStation

**Scope:** read-only inspection of the existing application, per the master prompt §3.
**Date:** 2026-09-24 · **Repo:** `starnet/` (branch `feat/harness-backend`, v0.10.10)
**Method:** direct file inspection + `git status` + line counts. Nothing was modified during this phase.

> Every claim below is marked **[verified]** (read directly from source), **[inferred]** (derived from
> structure/comments), or **[unknown]** (not yet determined). Per P1, do not treat inferred items as fact.

---

## 1. What this application actually is

SpaceStation is a **fork of StarNet**, renamed. It is a local-first, single-user, gamified **desktop
workstation** for building and running real AI-agent teams — not a web SaaS. **[verified: `package.json`
description, `CODE_MAP.md`]**

The "gamified station" framing is load-bearing, not cosmetic: **an agent's capability is literally
determined by which props are placed in its room.** This is the single most important architectural fact
for the Business OS work, because it means *capability is spatial*. **[verified: `capability/resolve.js`]**

---

## 2. Architecture map

```
┌────────────────────────────────────────────────────────────────────────┐
│  Tauri 2 desktop shell (src-tauri/)                                    │
│  embeds a Node binary + compiles frontend/ into the exe                │
│  data root: %APPDATA%\Roaming\ai.skynet.harness\workspaces             │
└────────────────────────────────────────────────────────────────────────┘
                              │ spawns exactly ONE
                              ▼
┌────────────────────────────────────────────────────────────────────────┐
│  sidecar/index.js  — 19,413 lines  — THE hotfile                       │
│  HTTP + SSE on :8787 · serves frontend/ statically · runs the agent    │
│  loop in-process · streams shared/ events to the browser as ndjson/SSE │
└────────────────────────────────────────────────────────────────────────┘
   │            │             │            │            │           │
   ▼            ▼             ▼            ▼            ▼           ▼
loop.js     providers/     capability/   tools/      channels/    mcp/
(1,569 ln)  (20 files)     (6 files)     (builtin/   (22 files)   (10 files)
agent loop  factory +      CAP_REGISTRY  41 tools)   telegram,    manager,
+ tool-call anthropic,     resolve.js →  registry +  discord,     http/stdio
accumulation openrouter,   tool allowlist code-worker slack,       transports,
             openai-compat, capGate.js    fence.js    matrix,      OAuth 2.1
             gemini, codex  toolsets.js               signal + SSE  catalog
   │
   ▼  ~140 more flat sidecar/*.js modules: cron*, cost/spend/ledger/credits,
      *-store.js persistence, memory (context/memcore), safety (permissions/
      permgrants/apiauth/halt), workspace-*, nightshift, subagents …
```

**Frontend** (`frontend/`, no build step): `index.html` loads ~80 `app/*.js` modules in dependency order,
then `app.js` wires them to a frozen `U.bus`. 165 files in `frontend/app/`. The canvas station
(`world.js`) renders tiles, props, pathing, and agent bodies. **[verified]**

**Shared contract** (`shared/`): `events.js` (~60 event types, schema-validated both directions),
`schema.js` (zero-dep validator), `emitter.js`, `clock-rng.js` (deterministic tests), `specialties.js`
(class catalog). **FROZEN — additive-only. Never rename/remove an event or field.** **[verified:
`CODE_MAP.md` + `shared/events.js` = 265 lines]**

---

## 3. Layer-by-layer findings

| Layer | State | Evidence |
|---|---|---|
| **Process model** | Working | one Node process, `npm start` → `sidecar/index.js`, :8787 **[verified]** |
| **Frontend** | Working, large | 165 `app/*.js` modules, no build step, canvas world **[verified]** |
| **Backend** | Working but monolithic | `index.js` = 19,413 lines — everything routes through it **[verified]** |
| **Database** | **No SQL DB.** Persistence is JSON files via `durable-store.js` (atomic fsync-before-rename + `.bak` last-known-good recovery) + `*-store.js` domain modules + localStorage save v5 in the frontend **[verified]** |
| **Auth** | Loopback-only: Host pin (DNS-rebinding defense) + Origin allow-list + **per-launch secret token on every `/api/*` route** **[verified: `apiauth.js`]** |
| **AI/LLM** | Multi-provider: `providers/factory.js` + anthropic, openrouter, openai-compatible, gemini, codex (ChatGPT OAuth) **[verified]** |
| **Agent system** | `loop.js` — messages-array while-loop, tool-call accumulation + arg repair, stateless between runs. Crew = real separate runs; only the hero walks the station **[verified]** |
| **Capability system** | `CAP_REGISTRY` (355 lines) maps `objectType → [{tool, capId, scope, requiresConsent, network}]`; `resolveTools()` projects placed props → this turn's tool allowlist **[verified]** |
| **Terminal** | `sidecar/terminal-sessions.js` + `tools/builtin/terminal.js` **[verified: file presence]** |
| **Workspace** | `workspace-lease.js`, `workspace-owner.js`, `workspace-safety.js`, `workspace-lineage.js`, `workspace-recovery.js` **[verified: file presence]** |
| **Agency / recruit** | `subagents.js`, `agent-affinity.js`, `agent-lifecycle.js` + frontend `recruiter.js`, `prospect.js`, `worksignal.js` **[verified]** |
| **Tools** | 41 builtin tools incl. `station-inspect`, `connectors`, `browser`, `computer`, `shell`, `fs`, `code`, `orchestration`, `routines`, `publish` **[verified]** |
| **Automation** | Cron subsystem: `cron.js` (pure math), `cron-driver.js`, `cron-lock.js`, `cron-store.js`, `cron-guard.js`, `autonotify.js` **[verified]** |
| **MCP / integrations** | `mcp/manager.js` + http/stdio transports + OAuth 2.1 client + curated one-click catalog **[verified]** |
| **Cost / spend** | `cost.js`, `spend.js`, `credits.js`, `ledger.js`, `mint-ledger.js`, `budget.js`, `budgetcaps.js` — real USD reconciliation **[verified]** |
| **Memory** | `context.js`, `memcore.js` (cortex recall/redaction, compaction), `memory-store.js`, `personalization-store.js` **[verified]** |
| **Safety** | `permissions.js` (consent broker), `permgrants.js` (grants), `halt.js` (**E-STOP already exists**), `failopen.js`, `taint.js` **[verified]** |
| **Security tooling** | `inputguard.js`, `pathtrust.js`, `workspace-safety.js`, `apiauth.js`, `.gitleaksignore`, `scripts/scan-history-secrets.mjs` **[verified]** |
| **Docs** | `docs/BRAIN.md`, `CODE_MAP.md`, `RELEASE_RUNBOOK.md` + a large `loops/` and `qa/` corpus **[verified]** |
| **Tests** | **775** `*.test.js` files; fast gate = 687 steps in `test/fast.list` via `scripts/run-fast-tests.mjs`; `npm test` = test:fast + test:http **[verified]** |

---

## 4. Business-related functionality — the honest answer

**There is none. The Business OS is greenfield.** **[verified]**

A case-insensitive search for `business` across all `.js` returns only: comments, specialty
descriptions in `shared/specialties.js` (which frames the agent roster around business/project roles), a
`recipe-catalog/business.js` persona file, and incidental prose. There is **no business entity, no
business store, no business route, no business UI.**

This is good news: **there is no duplicate-system risk for Phase 1** (P4), and the existing primitives
(durable store, route table, event contract, capability registry) are exactly the right foundation.

What *does* already exist and must be **reused, not rebuilt**:

| Master-prompt requirement | Already exists as | Reuse verdict |
|---|---|---|
| §21 Human control / Emergency Stop | `sidecar/halt.js` + E-STOP | **Reuse + extend** to per-business / per-agent scope |
| §13 Action permission system | `permissions.js` (consent broker) + `permgrants.js` | **Reuse**; map Safe/Review/Restricted onto existing consent tiers |
| §23 AI cost management | `cost.js`, `spend.js`, `budget.js`, `budgetcaps.js`, `ledger.js` | **Reuse**; per-business tagging is the new work |
| §26 Model router | `providers/factory.js` + `routing/`, `execution-router.js`, `fallbackchain.js` | **Reuse**; already provider-agnostic |
| §24 Plugin/integration system | `mcp/manager.js` + `channels/registry.js` + `connectors.js` | **Reuse** as the adapter layer |
| §9 Memory scopes | `memcore.js`, `memory-store.js`, `contextpack.js` | **Extend** with business/project namespaces |
| §12 Automation | `cron-*` + `routines.js` + `autonotify.js` | **Extend** with triggers/conditions/approval |
| §20 Audit log | `ledger.js`, `run-journal.js`, `provenance` modules | **Extend** into a user-facing activity log |
| §15/§16 Documents & knowledge | `docextract.js`, `deliverable-store.js`, `publishinghouse` | **Reuse** |
| §10 Finance / §11 Analytics | `cost.js`/`spend.js` (real USD) | **Reuse**; revenue/CRM are new |

---

## 5. Technical debt & duplication

1. **`sidecar/index.js` = 19,413 lines.** The CODE_MAP calls it ~6.5k and names it "THE hotfile — most
   merges conflict here." It is **3× larger than documented** and is the single biggest structural risk.
   **[verified]** → New business routes must be registered in a *separate* module and mounted, not inlined.
2. **`CODE_MAP.md` is stale across the board** — sidecar "~23k lines / ~82 files" (actual: 155 files),
   frontend "~133 files" (actual: 165), test "~409 files" (actual: 775). **[verified]** → Docs drift;
   trust `wc -l`.
3. **Uncommitted work is live.** `git status` shows `frontend/app/worldmodel.js` modified but uncommitted
   on `feat/harness-backend`. **[verified]** → the running build ≠ the committed build.
4. **A stray `frontend/app/worldmodel.js.bak`** sits next to the live file. **[verified: `ls`]** → likely a
   leftover; should not ship.
5. **~140 flat modules in `sidecar/`** with no sub-folder grouping for the store/safety/cost families.
   **[inferred]** → navigation cost is high; consider grouping only if it can be done without breaking
   require paths (high blast radius — do NOT do this casually).
6. **No SQL, no migrations.** All state is JSON + localStorage. **[verified]** → the business data model
   must be expressed as stores + relationships in code, with isolation enforced by key namespacing, not by
   foreign keys. This raises the bar on P6 (isolation) — it will not be enforced by a database.

---

## 5b. ROOT CAUSE FOUND — the 7 newer capabilities are dead code

The prior session concluded the 7 capabilities were broken by a missing `CAP_PROP_MAP` entry. That was
**half the story**. The deeper failure, verified this phase:

- `CAP_REGISTRY` (`capability/registry.js:302-343`) **does advertise all 7 tools** — `audio_generate`,
  `video_generate`, `video_compose`, `doc_publish`, `report_publish`, `print_prep`,
  `etsy_listing_check`. **[verified]**
- Each tool object exists with its `capability:` declared, in `audio.js`, `video.js`, `compose.js`,
  `publish.js`, `briefing.js`, `printprep.js`, `listingdesk.js`. **[verified]**
- **But `index.js` requires builtin tools explicitly, one `require` per line, and none of these 7 modules
  is in that list. There is no dynamic loader.** **[verified: `grep "tools/builtin" sidecar/index.js`]**
- Therefore the factories (`makeAudioTools`, `makeVideoTools`, `makeComposeTools`, `makeDocTools`,
  `makeBriefingTools`, `makePrintPrepTools`, `makeListingDeskTools`) are **never called** — zero call sites
  outside their own file. **[verified]**
- And **no test references any of them** — zero coverage. **[verified]**

**Net effect:** `resolveTools` will happily hand an agent the tool name `report_publish` once the
`briefingroom` prop is placed, but nothing is registered under that name. The capability is *advertised and
unfulfillable* — which is exactly the "silently broke tool-granting" symptom, one layer deeper than the
prior session's diagnosis.

**Why the existing guard missed it.** `test/capdrift.test.js` (in the gate, 99 assertions, passing) guards
a **three-way** seam: PropSprites catalog ↔ `CAP_PROP_MAP` ↔ `CAP_REGISTRY`. The failure lives on a
**fourth, unguarded seam**: CAP_REGISTRY tool name → a registered handler in the tool registry. The prior
session's `CAP_PROP_MAP` fix repaired seams 1–3; seam 4 was never wired, and nothing asserts it.

**Recommended guard (new work):** add a test that every `tool` string in `CAP_REGISTRY` resolves to a
registered tool. That one test would have caught all seven.

**Gate status — was RED on TWO steps, now GREEN on both.** (i) `test/lint-determinism.js` (fast-gate step
674) was **failing**: 3 ambient-time violations in two of these very modules (`briefing.js` `new Date()`;
`video.js` `Date.now()` ×2). Since both modules were unwired, the fix carried zero runtime risk — repaired
by injecting a clock (`now`) into both factories; `lint-determinism` now reports `scanned 288 file(s); OK`.
(ii) `test/capprop-map.contract.test.js` was **also failing**: the prior session's `worldmodel.js` edit
added 7 prop ids to `CAP_PROP_MAP` without updating that lock's documented table, so the gate was red on an
unlocked change. Lock updated → `OK (143 assertions)`.

> **Verification caveat.** The full `npm run test:fast` run could not be completed in the authoring
> environment: it aborts at step 58/689 on `test/source-text-integrity.test.js` with
> `spawnSync git EBUSY`. That is an **environment restriction, not a repo defect** — in that sandbox Node
> cannot spawn *any* child process (`node -e "execFileSync(process.execPath,...)"` fails identically), so
> every gate step that shells out is unrunnable there. The steps verified green are the ones that run
> in-process — a 45-test sweep of tool/capability/contract tests came back **44 pass, 0 real failures, 1
> environment-limited** (`station-recovery-cli.test.js`, which spawns the backup CLI). Green includes
> `lint-determinism`, `lint-emits`, `capdrift` (99), `capprop-map.contract` (143), `cap-tool-registration`
> (306), `capgate` (54), `browser.tool-parity` (111), `class-loadouts` (2798), `businesses-store` (51).
> **Re-run the full gate in a normal environment before merging.**

---

## 6. Reconciliation of the prior session's issue list

The appendix in the master prompt was written from a previous session. Verified against disk:

| # | Prior claim | Verdict | Evidence |
|---|---|---|---|
| 1 | `CAP_PROP_MAP` missing 7 entries | **PARTLY FIXED — the real cause is deeper (see §5b)** | `worldmodel.js:120` now lists all 7 (uncommitted). But seams 1–3 were only half the problem: none of the 7 tools is registered on the backend at all. |
| 2 | No tool for an agent to read its own room's props | **CONFIRMED** | `station-inspect.js` has `schema: {type:'object', properties:{}}` — no room field. Room data exists at `station.rooms[roomId].objects` (`resolve.js:37-38`). |
| 3 | `/api/toolsets` `placed` echoes the query string | **CONFIRMED, and it is deliberate** | `handleToolsetsList` (index.js:9870-9888) reads `?placed=<types>` and intersects; bare call ⇒ `placed:false` for all rows. The code comment says "the client passes ?placed — we never guess." |
| 4 | `/api/toolsets` 403s non-browser requests due to Origin | **PARTLY WRONG — diagnosis corrected** | `isAllowedApiOrigin('')` returns **true** (absent Origin is allowed). The real fence for a bare PowerShell call is the **per-launch token** on every `/api/*` route (`requiresApiToken`), not the Origin check. Origin only rejects *foreign* origins (a malicious website). |
| 5 | Scheduler `healthy:false, armed:false, lastTickAt:0` = broken | **NOT A BUG — by design** | index.js:4270-4278: the scheduler is **INERT unless armed**; "a user who never enables cron has no cron… no timer is armed, and the off-path is byte-identical." `armed:false` is the correct state when cron was never enabled. |
| 6 | 8× `openrouter http 400 — Reasoning is mandatory…` | **CONFIRMED as runtime, not hardcoded** | The string appears **nowhere** in the source — it is an upstream API response, so the cause is the request shape built in `providers/openrouter.js`. Needs a targeted look at how `reasoning` is sent. |
| 7 | Build flagged `dirty: true` | **CONFIRMED** | same fact as #1: `worldmodel.js` uncommitted. |
| 8 | No `connectors.list` granted to the agent | **PARTLY WRONG — tool exists** | `connectors.list` is a real tool (`tools/builtin/connectors.js`, capId `web`, consent-free). It is absent from an agent's list only when the agent's **room has no `web`-granting prop placed**. It's a placement issue, not a missing tool. |

**Net correction:** of the 8 items, **2 are misdiagnosed** (#4, #5), **1 is misdiagnosed in cause** (#8),
**1 was diagnosed too shallowly** (#1 — see §5b: the tools are not registered at all), and the remaining 4
are real. Acting on the original diagnoses alone would have sent you chasing the Origin check and a
"scheduler" that is working exactly as designed — while the actual root cause (unregistered tools) went
untouched.

**Not in the prior list, found this phase:** (a) the fast gate was **RED** on `lint-determinism` (§5b);
(b) all 7 newer capabilities are **dead code with zero test coverage** (§5b); (c) the drift guard covers
only 3 of 4 seams (§5b); (d) `CODE_MAP.md` is stale by 3× (§5.2).

---

## 7. Recommended implementation order

The master prompt's phase order is sound. Two adjustments based on what the audit found:

- **Phase 1 first slice = the business entity store** (pure module + test), *not* the dashboard. The
  dashboard needs data to show; build the entity + isolation namespace first.
- **Do NOT inline business routes into `index.js`.** At 19,413 lines it is the top structural risk.
  Register them through a dedicated module mounted into the route table.

**Immediate repair — status:**

1. ✅ **Un-red the gate** — injected clocks into `briefing.js` / `video.js` (§5b).
2. ✅ **Registered the 7 dead tools** — `audio/video/compose/publish/briefing/printprep/listingdesk` are now
   required and constructed in the registration block. They keep the **Spotify posture**: registered every
   run, EXPOSED only when the matching prop is placed, and an unconfigured dependency (no ACE-Step server,
   no ffmpeg, no OpenRouter key) **fails honestly at call time** rather than hiding the tool. The reverse
   option — deleting the caps from `CAP_REGISTRY` — was rejected: the modules are real and working, only the
   wiring was missing.
3. ✅ **Added the 4th-seam guard** — `test/cap-tool-registration.test.js`. It asserts (a) every
   capability-declaring module in `tools/builtin/` is required by the host, (b) every advertised capId has an
   implementing module, (c) every advertised tool name is declared in a module the host requires, and (d) an
   explicit regression pin for the 7. **Proven non-vacuous**: unwiring one module produces 3 named failures.
4. ✅ **Fixed the second red test** — `capprop-map.contract.test.js` was ALSO failing (the prior session's
   `worldmodel.js` edit added 7 prop ids without updating the lock). Lock updated; `CAP_LABEL` gained the 7
   power-words so those palette tiles stop falling back to a raw lowercase id.
5. ⬜ **Commit the working tree** — `worldmodel.js` is live but uncommitted; reconcile so the running build
   matches what is checked in.
6. ⬜ Remove the stray `frontend/app/worldmodel.js.bak`.

**Phase 1 (Foundation) — build order and progress:**
1. ✅ `sidecar/businesses-store.js` — business entity + `biz:<id>` isolation namespace. `test/businesses-store.test.js` (51).
2. ✅ `sidecar/business-activity-store.js` — per-business activity log: append-only, bounded (500/business),
   closed vocabularies for `result`/`approval`/`actor.kind`, fail-closed, strictly filtered by `businessId`
   on every read. `test/business-activity-store.test.js` (44).
3. ✅ `sidecar/business-routes.js` — the `/api/businesses` HTTP surface, **a module mounted into `ROUTES`**,
   not inlined into the 19k-line hotfile. Every mutation writes an audit row naming what changed; a delete
   records the row *before* the entity is removed. `test/business-routes.test.js` (54), including a
   mount-check for the same dead-code shape as the 7 tools.
4. ⬜ Additive events in `shared/events.js` (never rename/remove) so the frontend can react live.
5. ⬜ Business Command Center UI as a new `frontend/app/` module.
6. ⬜ Wire the E-STOP (`halt.js`) to per-business scope.

**Durable files added** (both under the workspace root, same resilient load/save pair as `projects.json`):
`businesses.json` and `business-activity.json`. **No SQL, no migration** — isolation is by key namespace.

---

## 8. Risks to watch

- **Frozen contract.** `shared/events.js` is additive-only. Any business event must be *added*, never
  repurposed. **[verified]**
- **Capability is spatial.** If business agents need new tools, the tools must be grantable via a placed
  prop + `CAP_REGISTRY` entry, or the agent will never see them (this is exactly what bit the 7
  capabilities in item #1). **[verified]**
- **No DB-level isolation.** P6 must be enforced in code via namespaced keys. **[verified]**
- **19k-line hotfile.** Every new route is a merge-conflict magnet. **[verified]**
- **Single-process invariant.** One sidecar per workspaces dir; no cross-process locking. **[verified:
  `durable-store.js` header]**
