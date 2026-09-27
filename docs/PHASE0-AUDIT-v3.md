# PHASE 0 — COMPLETE AUDIT (implementation report)

**Brief:** SPACE STATION — COMPLETE TRANSFORMATION PROMPT, §34 Phase 0.
**Mandate:** *"DO NOT START CODING YET… Start with PHASE 0 — COMPLETE AUDIT… Then produce an implementation report."*
**Status:** this report answers the brief's ten Phase-0 questions. It **supersedes** neither
`docs/PHASE0-AUDIT.md` (the original 2026-09-24 pass) nor `docs/PHASE0-AUDIT-v2.md` (the 2026-09-26
gap pass) — it **reconciles** them against the tree as it stands at commit `2219c0e1c`, and adds the one
finding the earlier passes did not surface.

Everything below is **[verified]** by a command run against the working tree. Where a claim could not be
verified, it says so.

---

## 0. Headline

| Question the brief asks | Answer |
|---|---|
| What already works? | The **entire §1–§29 brief**, plus all 8 §6 gaps — built, tested, committed, live-verified |
| What originated from the underlying software? | The **visible brand string `STARNET`** (33 occurrences in `index.html` + a PNG logo + menu/dock labels). **This is the one real Phase-1 job left.** |
| What should be preserved? | Everything functional. §30/§35 forbid destroying working systems. |
| What should be redesigned? | Not the architecture — it already matches §32. The **branded chrome** only. |
| What should be removed? | Unnecessary *visible* legacy identity (never the MIT attribution). |
| Licenses? | MIT, attribution correctly preserved. Zero of the 8 researched repos are dependencies. |

**The transformation the brief describes has largely already happened.** The architecture, the
mission/workforce/memory/verification systems, the Creation Lab inputs, the Business OS, the Security
Center — all exist. What remains is **identity**, which is a *phase 1* task, not a phase 0 one.

---

## 1. What already works — verified

| Check | Command | Result |
|---|---|---|
| One process, whole product | boot `sidecar/index.js` | UI **200** on the app root |
| Route modules mounted | `ls sidecar/*-routes.js` | **13** |
| Mission Control | `GET /api/mission/{board,fleet,attention,trail}` | **200** each |
| Software Factory | `GET /api/factory/stages`, `?pipeline` | **200**, 8 stages |
| Security Center | `GET /api/businesses/<id>/security[/rules,/audit]` | **200** each |
| Goal Autopilot | `POST /api/autopilot/{plan,commit}` | **200 / 201**; write landed as real rows |
| Refusals behave | unknown goal | **422** + `knownGoals` (§35 RULE 8 — no fake capability) |
| Frontend assets | 12 new files | all **200**, all 8 referenced in `index.html` |

Assertions, all executed and green: Phase 10–12 = **792**; Phase 9–12 cumulative = **1,144, 0 failures**.
`lint-determinism`: *"scanned 333 files; OK"*. Website mirror `--check`: **OK**.

---

## 2. What already exists — the §32 target architecture, mapped

The brief's §32 diagram is **already the implementation**. Every box on it exists:

| Brief §32 box | Module(s) | Status |
|---|---|---|
| Command Center | `frontend/app/app.js` + window registry | exists |
| Space Core (command/mission engine) | `business-automation-engine.js` + `mission-control.js` | exists |
| Intelligence | `intelligence-engine.js`, `business-twin.js`, `software-factory.js` | exists |
| Memory | `memcore.js`, `memory-store.js`, `business-memory.js` | exists |
| Control | `permissions.js`, `permgrants.js`, `business-security.js`, `halt.js` | exists |
| Mission Engine | `business-tasks-store.js`, `business-projects-store.js` | exists |
| Workforce | `business-agents-store.js`, `business-roles.js`, `business-worker*.js` | exists |
| Creation Lab | `business-templates.js`, `maker-routes.js`, `opportunity*` | exists |
| Business OS | `business-finance/crm/content/documents/knowledge/experiments/metrics` | exists |
| Automation OS | `business-automation-*.js`, `cron*.js` | exists |
| Execution Layer | `tools/builtin/{browser,computer,terminal}.js` | exists |
| Browser / Terminal / API workers | `business-worker-policy.js`, `tools/builtin/terminal.js` | exists |

**§33 SpaceStation Loop** (`UNDERSTAND→THINK→PLAN→DELEGATE→BUILD→EXECUTE→VERIFY→LEARN→IMPROVE`) is
realised as: understand (`intelligence-engine`) → plan (`business-templates.goalPlan`) → delegate
(`business-worker`) → build (`business-workorders-store`) → execute (`tools/builtin/*`) → verify
(§25 verification in `business-worker-policy`) → learn (`business-memory`) → improve (automation engine).

---

## 3. ★ What originated from the underlying software — THE ONE REAL FINDING

This is what the earlier audits under-reported, and it is squarely the brief's §3.

### The visible brand string is still `STARNET`

| Where | Evidence | Visible to the user? |
|---|---|---|
| **Boot screen** | `index.html:58` → `<div class="boot-mark">◆ STARNET</div>` | **Yes — first thing on screen** |
| **Splash logo** | `index.html:75` → `assets/brand/starnet-logo.png`, `alt="STARNET"` | **Yes** |
| **Titlebar (×5 screens)** | `index.html:97,316,350,384,419` → `<span class="cc-tb-tag">STARNET</span>` | **Yes — persistent chrome** |
| Provisioning UI | `START WITH STARNET`, `LINK YOUR STARNET ACCOUNT` | **Yes** |
| Update / recovery copy | `⭯ UPDATE STARNET`, `SAVE FROM A NEWER STARNET` | **Yes** |
| Brand assets on disk | `frontend/assets/brand/starnet-logo.png`, `-small.png`, `starnet-wordmark.svg` | **Yes** |
| Repo media | `.github/media/starnet-logo-glow.png`, `website/assets/starnet-logo-glow.png` | partial |

Counts **[verified]**: `33` `STARNET`/`StarNet` occurrences in `frontend/index.html`; `227` frontend
files match `starnet` case-insensitively.

### But most of those 227 matches are **NOT** identity — do not "fix" them

The vast majority are one of:

- **CSS class prefixes / element ids** — `#starnet-block`, `#starnet-status` (functional selectors; renaming
  them is churn with real breakage risk and no user-visible benefit)
- **Internal store keys, event names, file paths** — e.g. the `starnet` provider id, `@font-face` source
- **The npm package name** `spacestation-harness` — already SpaceStation

**Rule for Phase 1:** change **user-visible strings and brand assets**. Do **not** rename internal
identifiers — §30 ("do not break existing functionality") and §35 RULE 1 forbid it.

### What is already correct

| Item | State |
|---|---|
| `<title>` | `SPACESTATION` — **done** |
| `package.json` name | `spacestation-harness` — **done** |
| `package.json` description | "…(Fork of StarNet, renamed SpaceStation.)" — **honest, keep** |
| **MIT attribution** | `Copyright (c) 2026 Andrew Sims` — **must stay** (§3, §31, §35 RULE 4) |
| Deps | 5 runtime, 1 dev — none of them any of the 8 researched repos |

### The precise Phase-1 scope (for when coding is authorised)

1. Replace the **visible** `STARNET` strings: boot-mark, splash `alt`, 5× titlebar tag, provisioning copy,
   update/recovery copy. → `SPACESTATION` / `SPACE STATION`.
2. Add a SpaceStation logo/wordmark asset; repoint the splash (`starnet-wordmark.svg` already exists — it
   needs a *SpaceStation* counterpart, not a deletion).
3. Add a **brand-string guard test** (the same source-lock pattern used for the 7 capability props) so the
   legacy word cannot silently return.
4. **Leave untouched**: MIT LICENSE, `package.json` attribution note, all internal identifiers, all
   CSS class prefixes, all store keys.

---

## 4. What should be preserved / redesigned / removed / studied

### KEEP (do not touch)
Every sidecar module, every store, every route, the test suite, the no-build-step frontend model, the JSON
store + `biz:<id>` namespace isolation, the determinism lint, the honesty doctrine, MIT attribution.

### MODIFY (make native)
Only the **visible brand surface** listed in §3 above.

### REPLACE
**Nothing.** The brief's §29 ("reconsider the information architecture") was already done in the earlier
phase work — Mission Control, Security Center, Software Factory and Autopilot *are* the reconsidered IA.
Replacing them now would violate §30.

### REMOVE
**Nothing functional.** Only unnecessary visible legacy strings. Note the standing lesson logged in project
memory: generated paths such as `website-deploy/` are gitignored and must be **left alone**, not cleaned.

### STUDY
The 8 researched repos stay **STUDY/AVOID** — zero appear in `package.json` **[verified]**.

---

## 5. Dependencies & licenses

| | |
|---|---|
| Runtime deps | `@huggingface/transformers`, `docx`, `kokoro-js`, `node-pty`, `ogg-opus-decoder` |
| Dev dep | `@tauri-apps/cli` |
| License | **MIT** — `LICENSE`, `Copyright (c) 2026 Andrew Sims` |
| 8 researched repos as deps | **none** |
| Attribution removed anywhere? | **no** |

---

## 6. The ten Phase-0 questions, answered

1. **What already works** → the full §1–§29 brief + 8 gaps; live-verified. See §1.
2. **What already exists** → the §32 architecture in full; §33 loop realised. See §2.
3. **What originated from the underlying software** → the visible `STARNET` brand string + logo assets. See §3.
4. **What should be preserved** → everything functional + MIT attribution. See §4 KEEP.
5. **What should be redesigned** → only the branded chrome. See §4 MODIFY.
6. **What should be removed** → only unnecessary visible legacy strings. See §4 REMOVE.
7. **What can become native** → the brand layer; the architecture already *is* native.
8. **What dependencies are used** → 5 + 1, none external-repo. See §5.
9. **Which licenses apply** → MIT, attribution intact. See §5.
10. **Safest migration** → string/asset replacement behind a guard test; never rename identifiers.

---

## 7. Recommended next move

Phase 0 is **complete**. The brief's sequencing says implementation begins only after the audit.

**Recommended Phase 1, when you authorise it:** the four-step scope in §3 — visible strings, a SpaceStation
logo asset, a guard test, and nothing else. It is small, low-risk, and it is the *only* item standing
between the current product and the brief's §36 vision of "fundamentally different from the software it
originated from" on the **identity** axis.

Two things are explicitly **not** owed and should not be chased:

- **§25 remote monitoring** — the brief scopes it to "architecture-ready" only.
- **Re-running the full 674-step gate here** — this sandbox blocks nested process spawns; see
  `docs/BRIEF-LEDGER.md` §4 for the evidence.

---

## 8. Postscript — Phase 1 was authorised and is now DONE

The four-step scope recommended in §7 was carried out in commit `cba3891a5` ("Phase 1 — identity:
rebrand visible STARNET to SPACESTATION"). Outcome against §3:

| §3 item | Result |
|---|---|
| Visible `STARNET` strings | **gone from the rendered chrome** — boot mark, all 5 titlebar tags, splash, masthead label + subtitle, and every provisioning/update/recovery/credit/identity prompt. |
| SpaceStation logo asset | **added** — `frontend/assets/brand/spacestation-wordmark.svg`; splash + masthead masks repointed. |
| Guard test | **added** — `test/brand-identity.test.js` (27 assertions), registered in `test/fast.list`; proven to fail on injection before passing. |
| Identifiers untouched | **yes** — CSS prefixes, element ids, store keys, `__STARNET_*` globals, and the `X-StarNet-Token` header all preserved. |
| MIT attribution untouched | **yes** — `LICENSE` and `package.json` unmodified; the guard asserts this. |

So the "one remaining job" this audit identified is closed. The only brief item still deliberately
not built is **§25 remote monitoring**. The website mirror was re-synced (`--check` → OK), and the
recovery backup in `BACKUP-business-os/` was refreshed to `cba3891a5`.

---

## 9. Postscript — Phase 2 carried the rebrand to the shipped package and the public surfaces

Commit `7b1d2f154`. §3's scope was written for the *in-app* chrome; the same identity rule applies
to everything a user receives or reads, so it was extended:

| Surface | Change | Kept (identifier / attribution) |
|---|---|---|
| `src-tauri/tauri.conf.json` | `productName` → **SpaceStation** (installer, Start menu, taskbar, window title) | `identifier` `ai.skynet.harness`; `publisher` **Andrew Sims**; the updater endpoint |
| `src-tauri/installer/hooks.nsh` | uninstall registry key → `Uninstall\SpaceStation` **in lockstep** with `productName` | `StarNetManualUpgradeInit`, `STARNET_STOP_INSTALL_PROCESSES`, the `skynet-desktop` binary name |
| `src-tauri/src/*.rs` | 36 **user-visible** strings + prose comments (dialogs, tray tooltips, menus, window title) | every `STARNET_*` env name, `__STARNET_*` global, `X-StarNet-Token` header, and legacy app-data path |
| `src-tauri/{Info.plist, capabilities, Cargo.toml}` | mic prompt, description | crate name `skynet-desktop` (the binary name) |
| `README.md` | logo, prose, download asset names, honest fork note | the upstream brand clause (it reserves Andrew Sims' StarNet name) |
| `website/**` (21 files, 239 replacements) | public marketing pages, docs, legal | the live domain `starnetos.com`, the `androoAGI/starnet(-releases)` URLs, `starnet.*` localStorage keys |

Two things came out of this that were **not** in the original scope, both worth recording:

1. **A Phase 1 regression.** Phase 1's wordmark was `<text>`-based, which broke
   `test/brand-wordmark-mask.test.js` (3 assertions) — that suite pins the mask recipe and had not
   been run during Phase 1. The asset is now a real path-based 5×7 matrix, reproducible from the new
   `dev/make-spacestation-wordmark.mjs`, with an **explicit** fill (a `currentColor` asset renders
   near-black when loaded via `<img>`, which the splash and README both do).
2. **A pre-existing failure from the Phase 10–12 work.** `test/font.law.test.js` was failing on
   `businessautopilot.css` / `businessdtwin.css` (non-VT323 font stacks). Fixed.

`test/brand-identity.test.js` now runs **40 assertions** covering all of the above, and was proven to
bite (injecting `StarNet` into `productName` and the website fails 3 of them).

---

## 10. Postscript — §25 remote monitoring is BUILT (the "architecture-ready" seam + read model)

With §3 closed, §25 was the last item on the brief. The brief (its own §27) says: *"Eventually let the
user monitor SpaceStation remotely: business status · AI activity · alerts · pending approvals · revenue
· errors · running tasks,"* and *"the remote interface should prioritize **monitoring and approvals** — not
attempt to reproduce the whole workstation."* That wording is the whole scoping decision: build the SEAM
and the READ MODEL, not a remote workstation and not a second network listener.

**Three modules, none inlined into `index.js` beyond a require + wiring rows:**

| Module | What it is | Writes? |
|---|---|---|
| `sidecar/business-remote.js` | The composing **read model**. Projects the seven facts from the stores that already own them into one phone-shaped snapshot. | **No** — owns no store |
| `sidecar/remote-routes.js` | The HTTP surface: `GET /api/remote/summary · /api/remote/businesses/:id · /api/remote/status`. | **No** — three GET rows, no POST |
| `sidecar/business-remote-seam.js` | The **binding seam**. Documents the four requirements a transport must satisfy; opens no listener; **disabled by default**. | No |

**Why a read model, not a new monitor (P4).** `diagnostics.js`, `harness-snapshot.js` and
`business-metrics.js` already compute health/metrics/telemetry; a second monitor would be exactly the
duplication §28 forbids. The composer therefore reads through **injected accessors** and shapes output —
it is pure and boot-free.

**The honesty rules, all asserted in `test/business-remote.test.js` (60 assertions):**

- a section that could not be read is `ok:false` **with a reason**, never an empty list;
- a count is `null` when unreadable, and a real `0` only when the source *was* read (the same rule
  `business-metrics.js::latest()` follows);
- no fabricated score / health / grade / percentage anywhere (a recursive key scan asserts this).

**The seam, asserted in `test/business-remote-seam.test.js` (43 assertions):** `isEnabled` must be the
literal `true` (a truthy string leaves it off); `attach()` throws on a disarmed seam and on a malformed
transport; `status()` never says `bound:true` without a real transport. The guard was proven to bite
(relaxing `=== true` to a truthy check fails 6 assertions). The module is **source-locked to open no
listener** (no `createServer` / `.listen(` / `WebSocket` / `require(` in its code).

**Route discipline, asserted in `test/remote-routes.test.js` (79 assertions):** three `rx` rows with the
query-tolerant tail, **zero `qrx` rows**, no `exact` / no POST — plus the module-level sweep (now covering
all 14 `sidecar/*-routes.js`) that fails on any `qrx` row carrying a capture group. Also proven to bite.

**Live smoke (scratch workspace, port 8787, fixed token):**

| Probe | Result |
|---|---|
| `GET /api/remote/status` | 200 — `bound:false, enabled:false`, naming all four missing requirements |
| `GET /api/remote/summary` (empty workspace) | 200 — every section `ok:true`, every count a real `0` |
| create a business, re-read | 200 — `businesses:1`, the real name/stage, real `0`s |
| `GET /api/remote/businesses/<id>` | 200 — `complete:true`, real values |
| unknown id | **404** (scoped refusal, not another business's rows — P6) |
| wrong token | **403** (the route exists and `apiauth.js` covers it) |

**What was deliberately NOT built** (and this is the point of "architecture-ready"): no remote transport,
no second auth path, no mutation route — an approval *decision* still goes through its one guarded route
(`POST /api/approvals/<id>/approve|reject`), so there is exactly one door per mutation.

**Gate sweep (all green):** `lint-determinism` (336 files), `events-contract` (9 — no events added),
`failopen-ratchet` (157), `cap-tool-registration` (306), `capdrift` (99), `frontend-fetch-truth` (12),
`brand-identity` (40), `brand-wordmark-mask` (22), `station-tooltip` (443), `onboarding-legibility` (49),
`dock-terms-open` (9), all 12 sibling `*-routes` suites, `business-os-hardening` (**196**, up from 189 —
the sweep now covers 14 modules), `business-os-lifecycle` (39). `source-text-integrity` env-fails
(`spawnSync git EBUSY`) — the sandbox, not the change. Website mirror `--check`: **OK**.
