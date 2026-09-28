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

**Every requirement the brief lists is present**, including §25 remote monitoring, which the brief scopes
to "architecture-ready" and which is built as exactly that — a composing read model plus a seam that
defaults to OFF and opens no listener.

The one thing **not** proven in this session is the *full* 750-step gate running green end-to-end, and that
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

Plus the broad guards: `business-os-hardening` 196, `business-os-lifecycle` 39, `station-tooltip` 443,
`events-contract` 9, `onboarding-legibility` 49, `dock-terms-open` 9, `module-scope-shadowing` 7,
`bottle-wiring` 22, `brand-wordmark-mask` 22, `boot-security` 16. Across the whole Phase 9–12 set the
cumulative count is **1,144 assertions, 0 failures**.

---

## 7. Postscript — the 7 capability props' art (and two gates they had left red)

The session that added the seven capability props (`audiolab`, `cinema`, `editingbay`, `publishinghouse`,
`briefingroom`, `printshop`, `listingdesk`) registered them in the catalog and in `CAP_REGISTRY`, but
**shipped them without art**. That left a footprint that granted a capability, blocked walkers, and painted
**nothing** — an invisible wall — and it left **two gates red**, both of which are in `test/fast.list`:

| Gate | What it caught |
|---|---|
| `test/prop-render-smoke.test.js` | walks the **whole catalog** through a recording 2D context; all seven reported `0 rects` ("this is what 'drew nothing' looks like") |
| `test/toolprops.test.js` | 14 failures — the seven objectTypes had no entry in its `EXPECT` lock table, and `toolprops.js` had no rule for `audio_generate` / `video_generate` / `video_compose` / `doc_publish` / `report_publish` / `print_prep` / `etsy_listing_check` |

**Why only one gate noticed.** `PropSprites.draw()` skips a prop with no `F[id]` entry **silently**
(`const fn = F[f.t]; if (!fn) return;`). So the catalog row, `has(id)`, the module parse, the cap-prop
contract and every objectType-level test all passed while the prop drew nothing. Only the whole-catalog
paint walk was sensitive to it.

**The repair.**

| File | Change |
|---|---|
| `frontend/app/propsprites.js` | **7 draw functions authored** (+ a shared rationale block). Each paints **53–266 rects**, stays inside the house silhouette budget (`PAD_X` 10 / `PAD_UP` 44 / `PAD_DOWN` 8), and carries a mark no other prop has: a **waveform** (audiolab), a **spoked film reel** (cinema), a **timeline with a running playhead** (editingbay), a **bound book stack under a press platen** (publishinghouse), a **dated wall chart on a lectern** (briefingroom), **CMYK process bars with a registration cross** (printshop), a **swing tag with a barcode and a character ruler** (listingdesk). The seven catalog `desc` strings drop the stale *"No custom sprite yet"* line. |
| `frontend/app/toolprops.js` | 7 `EXACT` tool→prop rules, so each tool now lights the machine that provides it instead of nothing. |
| `test/toolprops.test.js` | the 7 objectTypes added to the `EXPECT` lock, **plus 7 named assertions** so a swapped tool fails by name and not only via the objectType sweep. |
| `website/app/app/{propsprites,toolprops}.js` | mirror re-synced (`scripts/sync-website-app.mjs`; `--check` prints OK). |

**Verified.** `prop-render-smoke` → `OK (9 assertions)`; `toolprops` → `OK (165)`. Both were red before.
Every prop gate re-run green (`prop-search` 260, `proprotate` 498, `prop-mount` 91, `propanchor` 92,
`prop-flat-decal` 45, `prop-starter-shelf` 35, `prop-awareness` 9, `g1bprops` 43, `sprite-assets` 15324,
`worldmodel` 342, `capprop-map.contract` 143), plus `capdrift` 99, `cap-tool-registration` 306,
`capgate` 54, `onboarding-legibility` 49, `lint-determinism` (336 files, OK).

**The end-to-end proof, not just the unit tests.** The sidecar was booted on a scratch workspace and the
**served** bytes were fetched over HTTP: all seven `F.<id>` functions are present in
`/app/propsprites.js`, `"No custom sprite yet"` appears **0** times, and all seven mappings are present in
`/app/toolprops.js` — i.e. what the browser receives carries the art.

**Also rendered for review.** A contact sheet of the 7 (plus `studio` as the house-style reference) is
written by a throwaway rasterizer at `../spacestation-new-props.png` — outside the repo, because it is a
review tool and not a product file.

**One thing deliberately NOT done:** the stale `ultron` (8 frame keys vs the standard 25), `minion` (16) and
`pikachu` (16) sprite sets in `frontend/assets/sprites/manifest.json` are **left as they are**. They are
pre-existing character-art gaps, unrelated to this repair, and touching them would change how existing
saved agents render.

## 8. Postscript — full-suite sweep: 9 real defects, and 68 things that only *looked* red

A sweep of all 751 `test/fast.list` steps ended **674 OK / 71 flagged FAIL / 6 tagged ENV**. Re-running
every flagged suite and reading its actual error (a tally is not a triage) gave the real breakdown of the 71:

| category | count | detail |
|---|---|---|
| **real defects, now fixed** | **9** | §8a + §8b below — all nine now exit 0 |
| **false red — the sweep's classifier was wrong** | 30 | the suite exits **0** with a non-standard output shape (`configexport.test.js OK — 41 assertions`, `lint-determinism: scanned 336 file(s); OK`, `station-bridge.test.js: ok`); the classifier only recognised `OK (n assertions)` |
| environment — the sandbox | 32 | `spawnSync` of **any** child returns `status:null`; a `symlink()` **reports success but creates nothing**; `C:/Users/User` is itself a git repo. All show `actual: null` / `EBUSY` or a custom "N problem(s)" line |

(The 6 the sweep tagged ENV are the same class.) So **zero real defects remain**.

### 8a. The §3 rebrand left seven stale locks and one real divergence

`test/brand-identity.test.js` **passed** throughout — it correctly found no stale `StarNet` in
`frontend/`. It only guards the **source**; nothing guarded the **tests that pin the source's rendered
strings**, so seven gates were red for a reason that had nothing to do with what they test:

| gate | pinned | source now says |
|---|---|---|
| `poweruser-shell-repairs` PL-13 | `previews open safely inside StarNet` | `… inside SpaceStation` |
| `desktop-fresh-start-contract` | `your StarNet account link` | `your SpaceStation account link` |
| `errorclass` (4 assertions) | `local StarNet service…` | `… SpaceStation …` |
| `friendlyerror` | `local starnet service` | `local SpaceStation service` |
| `saveversion` | `newer StarNet` | `newer SpaceStation` |
| `run-recovery-ui` | `StarNet will not repeat it` | `SpaceStation will not repeat it` |
| `genesis-starnet-link` (3 assertions) | `link your StarNet account first`, `checking your StarNet credits…`, `…but StarNet could not verify it` | `… SpaceStation …` |

All seven are re-pointed at the **claim**, not the brand (`/local \w+ service/i`) — brand-identity owns the
brand, these own the claim. (The 7th, `genesis-starnet-link`, was found only on a **second pass**: the
sweep records each suite's *last* line, and a thrown assertion ends with the same `Node.js v22.x` crash
banner a sandbox env-fail prints. A crash banner says *the process exited non-zero*, never *why*.)

**The one that was a real bug:** `test/slash.parity.test.js` exists to stop the frontend and sidecar
slash-command registries drifting, and the rebrand had drifted them —
`frontend/app/chat.js:6383` said *"show SpaceStation version information"* while `sidecar/slash.js:310`
still said *"show StarNet version information"*. **The rebrand covered `frontend/`, `src-tauri/`, `README`
and `website/` — but not `sidecar/`.** Fixed in the **source**, because the two halves must agree.

⚠️ **Reported, not changed:** the sidecar holds further user/operator-visible old-brand strings — notably
`sidecar/acp/core.js:195` `'Allow StarNet to work in …'` (an ACP **permission prompt a human approves**),
plus `sidecar/acp/serve.js:147`, `sidecar/manual.js:25`, `sidecar/runtimeinfo.js:58`,
`sidecar/configexport.js:140`, `sidecar/mcp/bridge-core.js:41`. Their tests **pass**, so they are not
stale locks — they are a branding-completeness decision, and extending §3 into the sidecar is the owner's
call.

### 8b. One test was reporting a false security breach

`test/fs.jail.test.js` creates a real directory symlink and proves `resolveInside()` rejects the escape.
Its skip-guard only catches a **throw**, but the failure mode here is **silent** — measured on Windows
under the sandbox: `fsp.symlink(outside, link, 'dir')` **reports success** while
`lstat().isSymbolicLink()` is `false`, `readlink()` throws `EINVAL`, and `realpath()` resolves the path to
itself. No link is created, so there is no link to escape *through*, so the containment proof failed **red**
and read as "the jail let an escape through" when no escape existed. The test now verifies the link is real
and skips explicitly; the security assertion is **not weakened**. The jail itself was checked and is **not
at fault**. One latent note: `realpathOrSelf()` returns the **input path on any `realpath` error** — it
fails **open**, where this codebase's convention is to report a source unavailable rather than assume.

### 8c. Two more measured defects closed this session

- **The skill scanner was missing 8 of 12 threat classes** (§12 of `PHASE0-AUDIT-v3.md`). Found by reading
  the sibling repo `skill-firewall/`; proved with a 14-sample probe (before: 4 detected / 8 missed — after:
  13 / 0). Twelve `PATTERNS` rows added; `skills.test` 135 → **149**. The taxonomy transferred, not the LLM
  method — this scanner must stay deterministic and offline-first.
- **`--ph-dim` failed WCAG AA in 3 of 6 themes** (§13 of `PHASE0-AUDIT-v3.md`): purple 3.06:1, red 2.99:1
  (below even the 3:1 non-text floor), blue 4.49:1 — against a `style.css` comment that *claimed* ≥4.5:1.
  Fixed in the palette, the false comment replaced with the measured table, and a new gate
  (`theme-contrast`, **186** assertions) added that composites the translucent `--panel` over `--bg` and
  holds every text-bearing token to 4.5:1 on all three grounds. Written **first** and proven to bite.
- **Three OS-level preferences the design answered nowhere** (`forced-colors`, `prefers-contrast`,
  `prefers-reduced-transparency`) now have a layer — `frontend/css/a11y.css`, loaded **last** because most
  of it restates values earlier sheets set and equal specificity is decided by order. The forced-colors pass
  found `.term`'s floating-window frame is `box-shadow`-only, so in Windows High Contrast Mode an open
  window had **no edge at all**.

**Gates after:** `theme-contrast` 186, `control-floor-theming` 153, `font.law` 216, `panel-brightness` 12,
`theme-custom-phosphor` 36, `station-tooltip` 443, `brand-identity` 40, `crew-rail-fit` 84,
`slash.parity` 180, `saveversion` 23, `run-recovery-ui` 10, `fs.jail` 96, `skills.test` 149,
`skills.gate.test` 96, `errorclass` 211, `friendlyerror` 225, `poweruser-shell-repairs` 14,
`desktop-fresh-start-contract` 15. Website mirror `--check` **OK** (3925 files + 2 embed-only).

**Live proof:** sidecar booted on a scratch workspace, **served** bytes fetched — `/css/a11y.css`
**HTTP 200 / 10273 bytes / text/css**, `a11y.css` is the **last** stylesheet in the served `index.html`,
and the served `style.css` carries the three new `--ph-dim` declarations exactly once each.

---

## 9. Postscript — "add boss-agent": a P4 finding, and the one guarantee actually worth porting

**The request** was to integrate the standalone `boss-agent/` coordinator (the sibling tool restored beside
this repo) into the app, as the opening of a second feature phase.

**The finding: it has no non-duplicating form as a subsystem.** Its own README says the intent is that
"this becomes a module inside your OpenClaw fork" — and the fork already has every module it would become.
Wiring it in unchanged would have been **four P4 duplicate subsystems**, plus SQL in a repo that has none,
plus an LLM in the trust path:

| boss-agent | Already in this app | Verdict |
|---|---|---|
| `lib/db.js` — `node:sqlite` (`managed_agents`/`agent_tasks`/`decisions_log`) | `durable-store.js` — JSON, fsync-before-rename. The repo has **no SQL by rule** | duplicate — not ported |
| `lib/registry.js` — `managed_agents` | `business-agents-store.js` — hire/update/remove, §13 grants, memory namespace | duplicate — not ported |
| `lib/boss.js` — `assignTask` + task table | `business-tasks-store.js` + `agent-routes.js`, which already refuses cross-tenant assignment with an explicit `(P6)` error | duplicate — not ported |
| `lib/gate.js` — firewall choke point before registration | `sidecar/skills/gate.js` — and stricter: approvals are bound to a **content digest**, with a live re-scan on delivery that catches post-review tampering | duplicate — not ported |
| `lib/firewall/*` — LLM code review | `sidecar/skills/guard.js` — the deterministic 12-class scanner. The LLM reviewer is the piece `PHASE0-AUDIT-v3.md:414` records as **"Deliberately NOT adopted"** (it breaks determinism and offline-first) | not adopted |
| `decisions_log` — REFUSED/ASSIGNED/COMPLETED/FAILED | `sidecar/autonomy-ledger.js` — built for this exact question ("what did the station decide overnight, and why?") | duplicate — not ported |

**What was genuinely missing** was the one thing boss-agent's README calls its whole point: *"assigning work
to an unregistered agent is refused, **and the refusal itself is logged**."* `agent-routes.js` audited every
SUCCESSFUL mutation (hire, fire, status, grants) and **not one refusal** — a cross-business assignment
answered 409 with an explanation that lived only in a response body, so once the tab closed, *"why did
nothing happen?"* was unanswerable from the log.

**So that guarantee was ported — and only that.** It composes with the store that already owns the job
rather than adding a second one:

- **`business-activity-store.js`** — `'refused'` joins the closed `RESULTS` vocabulary. A refusal is
  **not** an `error`: an error is something going wrong, a refusal is the system *choosing* not to act, and
  the reason is the payload. Collapsing them makes "why did nothing happen?" unanswerable — the exact
  question the trail exists to answer. `'refused'` was already house vocabulary
  (`business-workorders-store` `STEP_STATUSES`, `subagents.js` `TERMINAL`, `live-doctor.js`).
- **`agent-routes.js`** — `auditDecision()` now records **both** outcomes of an assignment: the assignment
  itself, and every refusal (the P6 cross-business 409, the unknown-agent 404, the store's 400). Also the
  "this agent still has tasks" 409 on removal. Every existing status code and response body is unchanged —
  the audit **describes** the decision, it never makes it.
- **`frontend/app/businesscenter.js`** (+ the generated `website/app/` mirror) — the result vocabulary is
  mirrored there, so `'refused'` was added to **both** `RESULTS` and `RESULT_LABEL`; without it the log
  would be correct while the UI rendered `UNKNOWN`. A parity assertion in the new gate stops the two
  copies drifting again.

**Gates after:** `boss-decision-trace` (**58**, new), `agent-routes` 144, `business-activity-store` 44,
`businesscenter` 100, `task-routes` 82, `business-routes` 104, `business-os-hardening` 196,
`business-os-lifecycle` 39, `automation-routes` 219, `maker-routes` 138, `manager-routes` 147,
`twin-routes` 68, `mission-control` 89, `business-security` 70, `events-contract` 9, `failopen` 18,
`failopen-ratchet` 157, `lint-determinism` scanned 336 files OK. Website mirror `--check` **OK**
(3925 files + 2 embed-only). `source-text-integrity` is the documented sandbox artifact
(`spawnSync git EBUSY`), not a defect.

**The new gate was proven to bite, not merely written.** Its source-lock asserts that every 4xx exit in
`handleAssign` audits *inside its own branch* — the first version used a fixed 600-character window and
**passed with an audit removed**, because the window reached back into the sibling branch's call. It was
replaced with a positional test (the nearest preceding `auditDecision` must come *after* the previous
`return`), re-sabotaged, and confirmed red — `expected 1, got 2` — before being restored. Two boundary bugs
in the lock itself were found the same way: `indexOf('async function handleBizMemory')` silently matched
`handleBizMemoryWrite` (the real one is not `async`), swallowing the whole memory section into the body.

**Live proof, on a scratch workspace (never the real station):** two businesses created, an agent hired into
Beta, a task created in Alpha, then the cross-business assignment → **HTTP 409**, and Alpha's activity log
returned the refusal as `alpha#3` with `result:"refused"`, the full P6 reason, and a traceable
`detail:"task=alpha~t1 agent=beta~a1 taskBusiness=alpha agentBusiness=beta"`. The sidecar was **restarted**
and the row was still there — read back through `GET /api/businesses/alpha/activity`, not from memory. The
success path (`alpha~a1` → 200) and the unknown-agent path (`ghost~a9` → 404) were exercised too, leaving a
six-row trail in which refusals and successes are distinguishable:

```
 1 | ok       | Business created
 2 | ok       | Task created
 3 | refused  | Refused to assign task "Ship the thing" to agent beta~a1
 4 | ok       | Hired the engineering agent (Engineer)
 5 | ok       | Assigned task "Ship the thing" to the engineering agent (Engineer)
 6 | refused  | Refused to assign task "Ship the thing" — no such agent
```

**Not complete / deliberately not done:** `boss-agent` itself is **not** a dependency and **not** wired into
the app — it remains a standalone tool sitting beside it, exactly as `PHASE0-AUDIT-v3.md:414` recorded. §28's
dependency rule stays **SATISFIED** ("zero of the 8 researched repos are dependencies"). Nothing was deleted
from it. The one honest limitation in the new code: the `no such task` 404 is the **only** unaudited refusal
exit, because the activity store is business-scoped and a task id that resolves to nothing names no business
to log against — the gate pins that as an explicit count so it cannot drift silently.

## 10. Postscript — the rebrand's unfinished business: `sidecar/` (the shipped backend), and the consumers Phase 2 silently invalidated

**The request** was simply *"is there a round 3, do it then."* There is **no explicit round numbering** in this
project, so rather than invent a scope the remaining open items were verified against the source. TODO/FIXME
debt was checked first and is **empty** (all 13 hits are the app's own TODO-scanning feature). The `.term`
forced-colors note turned out to be **stale** (`a11y.css` already gives it a real `border`). The one genuinely
open item is the rebrand's: **Phase 2 (`7b1d2f154`) covered the frontend, the packaging, the public website and
the README — but never reached `sidecar/`**, the process that actually ships inside the desktop bundle and
serves the API. `docs/PHASE0-AUDIT-v3.md` had recorded exactly this as STILL OPEN.

### 10a. `sidecar/` — the shipped backend

The sidecar renders user-visible strings of its own (the **ACP permission prompt a human approves**, diagnostics
copy, tool descriptions). 43 files were swept, **127 brand words** removed. Every changed file passed
`node --check`, and the transformer carried a **round-trip self-check** (re-run with a no-op transform and
compared byte-for-byte) → **0 failures** across 300 files. Re-applying the brand gate's §2 rule to `sidecar/`
now flags **only the 9 deliberate identifiers** (multipart form boundaries `----StarNet{FormBoundary,STT,Part}`,
the skill-exchange User-Agent, the skill-package **magic header**, and the legacy app-data / model-cache
directory names).

**A silent coverage loss was caught by reading, not by a red test.** `test/acp.e2e.test.js:335` asserted
`!/the run failed inside StarNet/` — a **negative** assertion that became **vacuous** the moment the producer's
string changed. It was re-pointed at the new claim. This is the same failure mode as the seven stale brand
locks found earlier: *a green test is not evidence the claim still holds.*

### 10b. A real defect the sweep uncovered — the rebrand renamed the product, and left its consumers stale

Phase 2's own commit message says it changed `productName "StarNet" -> "SpaceStation"` (**"installer name"**),
and it updated `update-canary.mjs` accordingly — but **three productName-derived consumers were left stale**,
each a functional break rather than a cosmetic string:

| Consumer | It looks for | The product actually produces | Impact |
|---|---|---|---|
| `scripts/lib/release-installer.mjs` + `release-cut.mjs` | `StarNet_<v>_x64-setup.exe` | `SpaceStation_<v>_x64-setup.exe` | the one-command release cutter and the **t0/t1/t3/t4/t5** gates cannot discover the artifact the build writes |
| `scripts/qa/packaged-lifecycle.mjs` | window titled exactly `StarNet` | `main.rs:3774` titles it `"SpaceStation"` | the **G1** packaged-lifecycle gate can never find the window |
| `scripts/verify-macos-intel-installed.sh` | `/Applications/StarNet.app`, `tell application "StarNet"` | the bundle is `<productName>.app` → `SpaceStation.app` | the macOS Intel acceptance never finds the installed app |

The installer-name rule was proven from three independent in-repo sources, not guessed: the README's own release
table documents `SpaceStation_<version>_x64-setup.exe`; `update-canary.mjs` sets `productName: 'SpaceStation
Canary'` and then stages `SpaceStation Canary_<v>_*-setup.exe`; and the rebrand commit message names productName
as the installer name. `test/release-installer-selection.test.mjs` had stayed **green throughout** because its
fixtures were named `StarNet_…` too — self-consistent, and therefore blind.

**Fixed with one source of truth, plus a drift lock.** The prefix now lives once, as
`NSIS_PRODUCT_NAME`/`nsisInstallerName()` in `lib/release-installer.mjs` (imported by `release-cut.mjs`, no
duplicate literal), and the guard test **derives** the expected filename from `tauri.conf.json`'s `productName`
and asserts the constant still equals it — so a future rename forces the lock to be revisited rather than
silently drifting again. The macOS script's legacy data dir (`~/.local/share/StarNet/workspaces`) was
**deliberately kept** — it is an identifier pinned by `desktop-build-macos-notarization.test.js`, read in place
by the Skynet→StarNet→SpaceStation fallback chain.

### 10c. A permanent gate, proven to bite

`brand-identity.test.js` **§9** applies §2's exact rule to `sidecar/**/*.js` (327 modules), reusing §2's
allowlist so the two rules stay in lockstep, plus a documented 9-identifier allowlist. It was **proven to
bite**: injecting `'Allow StarNet to work in this folder?'` into `sidecar/` turned it red naming that exact
string — the same class as the ACP prompt that motivated the sweep — and removing the file returned it green.

**Gates after:** `brand-identity` **42**, `packaged-lifecycle` 70, `release-installer-selection` 7,
`desktop-build-macos-notarization` 26, `release-train-macos-trust` 56, `acp-core` 128, `acp.e2e` 48,
`channels.telegram.e2e` 60, `sidecar.http` 497, `runtimeinfo` 15, `schema-stamp` 15, `cloudsave-refusal` 14,
`configexport` 41, `source-release-mirror` 35, `release-preflight` 92, `release-ritual` 64,
`failopen-ratchet` 157, `lint-determinism` scanned 336 files OK. Website mirror `--check` **OK**
(3925 files + 2 embed-only). Sandbox artifacts, not defects: `source-text-integrity` (`spawnSync git EBUSY`),
`release-cut` / `release-bump` (`actual: null` — a spawned child under EBUSY).

**Deliberately left, and why (not an oversight):** the rest of `scripts/` is release/QA engineering whose
remaining brand strings are either **identifiers** — env prefixes `STARNET_*`/`SKYNET_*`, `window.__STARNET_*`
globals, `X-StarNet-Token`, the `ai.skynet.harness` bundle id, the `skynet-desktop` binary/crate name, the
`androoAGI/starnet(-releases)` URLs, historical install registry keys (`Uninstall\StarNet`,
`HKCU:\Software\Andrew Sims\StarNet`), the `StarNet_*_x64-setup.exe` glob in the historical-replay proof, and
the `StarNet-QA-*` scheduled-task names — or **eval-internal labels/keys** (`bind.mjs` `name: 'StarNet'`,
`runner.mjs` `StarNet=${…}` / `StarNetBoot=`), or **internal evidence-doc headers** (`# StarNet … Evidence`).
Two coupled items are deferred to their own deliberate pass because each touches a pinned pair: the
**release-notes header** (`# StarNet v` in `RELEASE_NOTES.md` + `release-preflight.mjs` regex + `release-bump`/
`release-ritual` + their tests) and the **public mirror page text** (`source-release-mirror.mjs`, pinned by its
test). The **installer-art wordmark** (`gen-installer-art.ps1` draws `STARNET`) is a genuine user-facing asset
that needs its images regenerated, not a string swap.

### 10d. …and then the remainder was finished too

Everything §10c listed as deferred is now done, in the same commit series:

- **`scripts/` identity sweep** — 73 more brand words across 34 files: evidence-doc headers
  (`# StarNet … Evidence` → `# SpaceStation …`), the eval driver labels (`name: 'StarNet'`,
  `StarNet=${…}`, `StarNetBoot=`), operator messages, the QA campaign names, the eval **schema titles**,
  `lib/states.mjs`'s rendered notification fixture, and the release-notes pipeline.
- **The release-notes header, as one coupled change** — `release-bump.mjs` writes it, `release-ritual.mjs`
  validates it, `release-preflight.mjs` parses it with a regex, and `RELEASE_NOTES.md` carries it; all four
  moved together, and the three test fixtures that pin `# StarNet v…` moved with them.
- **The public mirror page** (`source-release-mirror.mjs`) — title and body now name the product; the
  `distributionRepo` value (`androoAGI/starnet-releases`) is an IDENTIFIER and was left alone.
- **The installer art** — `gen-installer-art.ps1` now draws `SPACESTATION`. Because the 12-letter word does
  not fit the original 7-letter stacked layout, the sidebar's row pitch and the header/DMG sizes were
  retuned (sidebar 26pt/30px → 18pt/19px; header 15pt → 13pt; DMG title re-centred). System.Drawing is
  **blocked in this sandbox** (`Add-Type` is refused by the security guard), so the three committed assets
  were regenerated with an equivalent Pillow renderer using the script's own palette and passes, then
  **viewed to confirm** the layout fits (header text 108px in 150; DMG title 264px in 660; sidebar's last
  row at y=255 against the rail at 278). The `.ps1` was parser-checked (0 errors) but could not be
  *executed* here — **regenerate on Windows before the next cut** to make the committed art byte-identical
  to the canonical generator.

**Permanent gate.** `brand-identity.test.js` **§10** applies §2's rule to `scripts/**` with a documented
identifier allowlist (registry keys, the historical asset glob, the replay proof's messages, the scheduled-task
names, the legacy path component, the pre-rebrand macOS data dir). Sabotage-proven: injecting
`'Welcome back to StarNet, commander.'` turns it red. The gate is now **44 assertions**.

**Still the legacy word, on purpose (all IDENTIFIERS, 18 strings):**
`ci/windows-published-upgrade-proof.ps1` (8 — the registry keys, the historical asset glob and the messages of
a proof that deliberately replays a PRE-REBRAND install), `qa/register-watch.ps1` (8 — `StarNet-QA-*` Windows
scheduled-task names and their labels; a task name is a registry identity, and renaming it orphans the
operator's existing registration), and `purge-leaked-codex-tokens.mjs`'s legacy install-root path component
(1) plus `verify-macos-intel-installed.sh`'s legacy data dir (1).

### 10e. …but §10d's "done" was itself incomplete — the gate had blind spots

A re-audit with a proper JS tokenizer (not the gate's naive comment/quote regex) found **five real
user-visible offenders the gate had been letting through green.** The gate was passing while the app still
rendered the legacy word in five places, because the gate's own scanning was broken in two ways and its scope
was too narrow:

- **§2 read only the FLAT `frontend/app` listing** — `readdirSync` + `.endsWith('.js')`, no recursion. So
  `frontend/app/windows/` (30 files) and `frontend/app/recipe-catalog/` (10 files) were **never scanned**.
  Three rendered strings lived there: a Telegram connect step, a Signal connect step, and a routine
  delivery-option label (`keep result in StarNet`).
- **§9/§10 stripped comments with a regex, then matched quotes with a regex** — two constructs defeated it:
  a `/*` **inside a string literal** (`sidecar/plugins.js` writes `'/* ' + name + ' — a … plugin.'`, so the
  phantom block comment ate the rest of the file) and a **regex literal containing a quote**
  (`sidecar/tools/builtin/shell.js` has `/[\s"'`=(]/` in its guard, which desynced the quote matcher so the
  `why:` refusal sentence after it was never inspected).

**Fixed:** the five strings (`frontend/app/windows/{messaging,routines}.js` ×3, `sidecar/plugins.js`,
`sidecar/tools/builtin/shell.js`) + the website mirror re-synced.

**The gate is now structural, not regex-based.** A single-pass `extractStrings()` tokenizer tracks the previous
significant token (so a `/` is told from a division), skips comments, and handles template `${…}`; `§2` recurses
the **whole** `frontend/` tree (also picking up `frontend/js/`); `§10` uses a `#`-comment-aware `extractQuoted()`
for `.ps1`/`.sh`; the allowlist is ONE shared `allowedContent()` so the three locks cannot drift; and a
**self-check** proves the extractor is not fooled by either construct (a `/*`-in-string and a quote-in-regex),
so a future edit that regresses it fails loudly instead of silently. Gate **44 → 46 assertions**.
Sabotage-proven on all three classes: re-introducing the subdir offender, the `/*`-in-string offender, and the
quote-regex offender each turns it red naming the exact file and line.

**Corrected:** `test/eval-comparison.test.js`'s 13 failures are **100% sandbox**, not defects. The
`fault-compaction-rotation` adapter spawns a child (`fixtures/fault-compaction-child.mjs`); `spawnSync` is
blocked here (EBUSY), so the child never writes its transcript and the adapter reports `rotation-adapter-error`
(ENOENT). Run **directly**, the child works: exit **1** (the intended simulated crash) and **38** durable rows
including the searchable `ROTATION-FACT-731`. So all ten boundaries pass in a real environment — an earlier
note calling two of these "real" was wrong.


