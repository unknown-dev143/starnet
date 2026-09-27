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

## 11. Postscript — the 7 capability props were shipping with NO ART (and 2 red gates)

A regression sweep of the *product* surfaces (rather than the Business OS surfaces) found that the seven
capability props added in the previous session were **registered but never drawn**. Because
`PropSprites.draw()` returns early when a prop has no `F[id]` entry — `const fn = F[f.t]; if (!fn) return;`
— a placed one **granted its capability, blocked walkers, and painted nothing**: an invisible wall. Nothing
errored, nothing logged, and every objectType-level gate still passed.

**Two gates in `test/fast.list` were red, and only one of them noticed the art:**

```
prop-render-smoke: FAIL: every catalog prop actually paints …
  got ["audiolab (0 rects)","cinema (0 rects)","editingbay (0 rects)","publishinghouse (0 rects)",
       "briefingroom (0 rects)","printshop (0 rects)","listingdesk (0 rects)"]
toolprops: 14 problem(s), 144 ok
```

`prop-render-smoke.test.js` walks the **entire catalog** through a recording 2D context and asserts three
things per prop — that it does not throw, that it paints at least `MIN_RECTS` rects, and that everything it
painted lands inside its own footprint (`PAD_X` 10 / `PAD_UP` 44 / `PAD_DOWN` 8). It was the single test
sensitive to a prop that draws nothing; `capprop-map.contract.test.js` (the other per-prop-id lock) had
**already** been updated for the seven, which is why the omission read as "done".

**The repair.** Seven draw functions authored in `frontend/app/propsprites.js`, in the catalog's established
language (baseplate + conduit socket, foreshortened top deck over a south front face, one warm key
high-and-west, silhouette ink a dark tint of the material's own hue). Measured against the reference prop
`studio` — the bounding box of each new 2×2 is **identical** to studio's, `[12,30..41,61]` in a 48×70 cell
with the footprint at `[12,36..36,60]`:

| prop | rects | bbox | tell |
|---|---|---|---|
| `audiolab` | 220 | `[12,30..41,61]` | waveform trace + tape hubs + speaker cones + VU needle |
| `cinema` | 266 | `[12,20..41,61]` | spoked film reel standing proud of the deck + lens barrel + gate |
| `editingbay` | 129 | `[12,30..41,61]` | timeline of source-tinted clips under a sweeping playhead |
| `publishinghouse` | 61 | `[11,30..29,61]` | bound book stack + ribbon under a dropping press platen |
| `briefingroom` | 53 | `[11,28..29,61]` | dated wall chart (newest row lit) on a lectern |
| `printshop` | 62 | `[11,30..29,61]` | CMYK process bars + registration cross |
| `listingdesk` | 68 | `[11,30..29,61]` | swing tag with a barcode + a character ruler |

`frontend/app/toolprops.js` gained the seven `EXACT` tool→prop rules so each tool lights its own machine
(`audio_generate→audiolab`, `video_generate→cinema`, `video_compose→editingbay`, `doc_publish→publishinghouse`,
`report_publish→briefingroom`, `print_prep→printshop`, `etsy_listing_check→listingdesk`), and
`test/toolprops.test.js` gained both the seven `EXPECT` rows and **seven named assertions** so a swapped
tool fails by name rather than only through the objectType sweep.

**Gates after the repair (all green):** `prop-render-smoke` **9** (was red), `toolprops` **165** (was 14
failures), `prop-search` 260, `proprotate` 498, `prop-mount` 91, `propanchor` 92, `prop-flat-decal` 45,
`prop-starter-shelf` 35, `prop-awareness` 9, `g1bprops` 43, `sprite-assets` 15324, `worldmodel` 342,
`capprop-map.contract` 143, `capdrift` 99, `cap-tool-registration` 306, `capgate` 54, `onboarding-legibility`
49, `lint-determinism` (336 files, OK). `sprite-detached-prop` env-fails (`spawnSync EBUSY`) — the sandbox.
Website mirror `--check`: **OK**.

**Live end-to-end proof.** The sidecar was booted on a scratch workspace and the **served** bytes fetched
over HTTP: all seven `F.<id>` functions present in `/app/propsprites.js`, `"No custom sprite yet"` present
**0** times, and all seven mappings present in `/app/toolprops.js`. The unit tests say the art paints; the
HTTP fetch says the browser receives it.

**Not touched on purpose:** the short `ultron` (8 frame keys), `minion` (16) and `pikachu` (16) character
sprite sets. Pre-existing gaps in a different subsystem (character art, not prop art); changing them would
alter how already-saved agents render, which is not this repair's business.

## 12. Postscript — the skill scanner was missing 8 of 12 threat classes

`sidecar/skills/guard.js` is the deterministic regex scanner behind a skill's trust verdict
(`safe` / `caution` / `dangerous` → `allow` / `ask` / `block`) before it is installed. Its `PATTERNS`
table covered command execution, network egress, filesystem destruction and prompt injection.

The other workspace repo `skill-firewall/` is a *less* complete predecessor of the same idea — it
inspects skill code with an LLM and returns APPROVE / REWRITE / REJECT. It is less complete
mechanically, but its **threat taxonomy was the richer of the two**, so it was worth reading.

**Measured, not assumed.** `guard-gap-probe.mjs` ran 13 threat samples plus one clean control through
the real scanner:

| | caught / detected | missed | clean-control false positives |
|---|---|---|---|
| before | 4 | **8 of 12 classes scanned `safe`** | 0 |
| after | 13 | 0 | 0 |

The misses included `skill-firewall`'s own malicious sample: a `~/.ssh/id_rsa` read,
`fs.appendFileSync = () => {}` silencing the audit trail, and `skillGuard = null` disabling the gate
**from inside the skill it was meant to guard**. All three scanned `safe`.

**What transferred was the taxonomy, not the method.** This scanner must stay deterministic and
offline-first (the determinism lint forbids `Date.now`/rng in sidecar modules, and the brief forbids
fabricated verdicts), so an LLM in the trust path would break the architecture. Twelve `PATTERNS`
rows were added after `network_url`:

| class | patternIds |
|---|---|
| credential-access | `private_key_ref`, `credential_store_read`, `secret_env_read` |
| evasion | `disable_logging`, `disable_audit`, `disable_guard`, `bypass_consent`, `disable_flags` |
| remote-control | `reverse_shell` |
| escalation | `privilege_escalation` |
| persistence | `scheduled_persistence` |
| obfuscation | `obfuscated_exec` |

Severity is chosen per pattern so the **existing** `verdictFor()` maths lands correctly (max severity
≥ 3 → `dangerous`, ≥ 1 → `caution`, else `safe`); `rankOf()` already treats an unknown level as worst,
so a new pattern cannot silently downgrade a verdict.

**Gates:** `skills.test` **149** (was 135) — a `MUST_BLOCK` table of 10 (patternId, code) pairs plus
three honesty assertions (`secret_env_read` is *detected* but rates only `caution` for community
source; an ordinary procedure yields **zero** findings; a credential path merely *named in prose* is
not flagged as a read). `skills.gate.test` **96** — the `EXPECT` verdict table is unchanged, so no
existing classification moved. The new gate was proven to bite by injecting a bogus patternId
(→ 1 problem, 148 ok, naming the exact assertion) and reverting.

**Deliberately NOT adopted:** `skill-firewall`'s LLM reviewer itself (breaks determinism/offline-first)
and `boss-agent`'s `node:sqlite` task registry (SpaceStation has its own durable store).

## 13. Postscript — a real WCAG AA failure in 3 themes, and the accessibility layer that was absent

### 13a. `--ph-dim` failed WCAG AA in three of six themes

`frontend/css/style.css` carried a claim on `.dim` since its opacity was dropped from .5:

> ".dim color comes from app.css var(--ph-dim) which is solid >=4.5:1"

An asserted invariant that **nothing checked** — and it was false. Measured against the worst ground a
dim label ever sits on (`--panel2`, the raised-card surface: lighter than both `--bg` and the
translucent `--panel` glass, so the tightest case):

| theme | stock `--ph-dim` | on `--panel2` | | fixed to | |
|---|---|---|---|---|---|
| amber | `#b9791c` | 5.55:1 | AA | *(unchanged)* | |
| green | `#1fae4e` | 6.14:1 | AA | *(unchanged)* | |
| blue | `#1e87ba` | **4.49:1** | missed by 0.01 | `#228ec1` | 4.90:1 |
| purple | `#7d3fc4` | **3.06:1** | below AA | `#a15cea` | 4.74:1 |
| red | `#b3271c` | **2.99:1** | below AA **and** below the 3:1 non-text floor | `#e8392e` | 4.70:1 |
| white | `#97a397` | 6.90:1 | AA | *(unchanged)* | |

This is not a decorative token: `--ph-dim` carries **608 `color:` declarations across 18 sheets** —
`.dim`, `.dimb`, `.crew-room`, `.crew-id`, `.h3-aux`, `.deliverable-row small`, `.set-slider-name`,
every console's `.xx-note`/`.xx-sub` — i.e. the label tier of every screen. It is *also* the 1px
border/dividers token, which is why one value has to clear the stricter floor; clearing 4.5:1 clears
3:1 for free.

**The known cost, named rather than hidden.** In purple and red `--ph` is itself only 5.88:1 and
5.63:1 on `--panel2`, so once `--ph-dim` clears 4.5:1 the dim↔accent luminance gap narrows to ~1.0.
Those two palettes have no headroom for a wide ramp under AA. Both alternatives were worse: raising
the accent restyles the entire theme (buttons, headings, every border and glow), and splitting
`--ph-dim` into separate text/line tokens would touch 608 declarations across 18 sheets for no
further accessibility gain. Text legibility wins; the ramp stays ordered
(dim 4.7 < accent 5.6 < text 10.0 < bright 13.8) and `--ph-bright` still holds the top tier. The
false comment was replaced with the measured table **in the source**.

**New gate:** `test/theme-contrast.test.js` (**186** assertions, in `test/fast.list`). It parses every
`body.theme-*` block, **composites the translucent `--panel` over `--bg`** (the glass, not the raw
token, is what text sits on), and holds every text-bearing token to 4.5:1 on all three grounds. It
was written **first** and run against the unfixed tree to prove it bites — it named purple 3.06:1,
red 2.99:1 and red's 1.4.11 failure individually before the fix existed.

### 13b. Three OS-level preferences the design answered nowhere

`forced-colors`, `prefers-contrast` and `prefers-reduced-transparency` appeared in **zero** of the 26
stylesheets. New `frontend/css/a11y.css`, **loaded last**.

**Why last is load-bearing:** most of what it does is *restate* a value an earlier sheet already set
(`.term`'s border, `--text`, `--panel`). At **equal specificity the last sheet wins**; loaded anywhere
else those rules are silently dead. The gate asserts it is last, and that no other sheet carries
these media queries.

**`forced-colors` (Windows High Contrast Mode).** The audit came before the rules. The UA forces
`background-image`, `box-shadow` **and** `text-shadow` to `none`, so **any surface whose only
boundary is a `box-shadow` loses its edge**. Every `var(--bezel)`/`var(--raise)` surface was checked:
`#topbar` `#left` `#right` `#bottombar` `#center`, `.panel`, `.lv-retry`, `.prov-card`, `.key-row`,
`.q-track`, `.ts-row`, `.cc-card`, `.ab-route` — all declare a real `border`, so the UA recolours it
and they survive. **`.term` (and `.term.feature`, which inherits) is the sole exception**: the
floating window's entire frame is `box-shadow: var(--bezel)`. In HCM an open window had **no edge at
all**. That is the one real fix, plus: colour-carried meaning is preserved
(`.phosphor-swatches .swatch` *is* the six palettes → `forced-color-adjust: none`, or it is six
identical grey circles), the drawn canvas is opted out, and the decorative CRT glass is asserted off.
Deliberately no system-colour keyword is named — the frontend bans OS system-control colours
(`control-floor-theming.test.js` §3) and letting the UA choose is more correct anyway.

**`prefers-contrast: more`.** The biggest win is killing the **glow**: `body` paints
`text-shadow: 0 0 4px` behind every glyph and headings add 10px of bloom, and that halo is strictly
harmful to a user who asked for more contrast. Theme-agnostic, so it works for `theme-custom` too.
`--text` is then raised to a 75/25 mix of `--ph-bright`/`--ph`, computed to be **never darker** than
stock in any of the six themes (worst case 11.06:1 on `--panel2`, up from 9.40:1). The six theme
classes are enumerated deliberately: `body` alone is 0,0,1 and **cannot** beat `body.theme-*` at
0,1,1 — class beats element whatever the load order. `theme-custom` is absent on purpose: its tokens
are inline on `<body>`, and no stylesheet rule can beat an inline declaration.

**`prefers-reduced-transparency: reduce`.** `--panel` repointed at `--panel2` (the theme's own solid
raised-card colour, not a colour invented here), `.term`'s `background-color` overridden so its
decorative radial glow survives, and `backdrop-filter` dropped from the three scrims
(`.term-scrim`, `.mkt-scrim`, `.refit-guide`).

The **panel-brightness promise** is respected and asserted: the contrast block must not reassign
`--bg`, `--panel` or `--panel2` at all — brighter *text*, never a brighter *ground*.

**Live end-to-end proof.** Sidecar booted on a scratch workspace, **served** bytes fetched:
`/css/a11y.css` → **HTTP 200 / 10273 bytes / text/css**; `a11y.css` is the **last** stylesheet in the
served `index.html`; and the served `style.css` carries the three new `--ph-dim` declarations exactly
once each (the old values survive only inside the explanatory before→after comment).
`website-app-sync --check` **OK** (3925 files + 2 embed-only).

### 13c. What the §3 rebrand left behind — seven stale locks and one real divergence

The rebrand's own verification was **incomplete**, and the full-sweep triage found it. Seven gates were
red because they pinned a rendered string the rebrand legitimately renamed:

| gate | pinned | source now says |
|---|---|---|
| `poweruser-shell-repairs` PL-13 | `previews open safely inside StarNet` | `… inside SpaceStation` |
| `desktop-fresh-start-contract` | `your StarNet account link` | `your SpaceStation account link` |
| `errorclass` (4 assertions) | `local StarNet service…`, `Can't reach StarNet's local service` | `… SpaceStation …` |
| `friendlyerror` | `local starnet service` | `local SpaceStation service` |
| `saveversion` | `newer StarNet` | `newer SpaceStation` |
| `run-recovery-ui` | `StarNet will not repeat it` | `SpaceStation will not repeat it` |
| `genesis-starnet-link` (3 assertions) | `link your StarNet account first`, `checking your StarNet credits…`, `…but StarNet could not verify it` | `… SpaceStation …` |

`test/brand-identity.test.js` **passed** throughout — it correctly found no stale `StarNet` left in
`frontend/`. It only guards the **source**; nothing guarded the **tests that pin the source's rendered
strings**. All seven are re-pointed at the **claim**, not the brand (e.g. `/local \w+ service/i`), which
is the right split of concerns: brand-identity owns the brand, these own the claim.

**The one that was a real bug, not a stale test:** `test/slash.parity.test.js` exists to stop the
frontend and sidecar slash-command registries drifting — and the rebrand had drifted them:

```
frontend/app/chat.js:6383   'show SpaceStation version information'
sidecar/slash.js:310        'show StarNet version information'      <- fixed (the SOURCE)
```

**The rebrand covered `frontend/`, `src-tauri/`, `README` and `website/` — but not `sidecar/`.** Here
the fix is the source, not the lock: the two halves must agree. ⚠️ **Still open, reported not
changed:** the sidecar holds further user/operator-visible old-brand strings — notably
`sidecar/acp/core.js:195` `'Allow StarNet to work in …'` (an ACP **permission prompt a human
approves**), `sidecar/acp/serve.js:147` `'StarNet is not running … start StarNet and try again'`,
`sidecar/manual.js:25`, `sidecar/runtimeinfo.js:58`, `sidecar/configexport.js:140`,
`sidecar/mcp/bridge-core.js:41`. Their tests **pass** (source and lock agree), so they are not stale
locks — they are a branding-completeness decision, and extending §3 into the sidecar is the owner's
call.

### 13d. One test was reporting a false security breach

`test/fs.jail.test.js` creates a real directory symlink and proves `resolveInside()` rejects the
escape. Its catch-block is meant to skip on filesystems that disallow symlinks — but it only catches a
**throw**, and the failure mode here is **silent**. Measured on Windows under the sandbox:

```
fsp.symlink(outside, link, 'dir')   -> reports SUCCESS
lstat(link).isSymbolicLink()        -> false
readlink(link)                      -> EINVAL
realpath(link)                      -> the link path itself
```

No link is created, so there is no link to escape *through*, so the containment proof failed **red**
and read as "the jail let an escape through" when no escape existed. The test now verifies the link is
real and skips explicitly. **The security assertion is not weakened**: wherever a real link is
created, the escape is proven exactly as before.

The jail itself was checked and **is not at fault** — `resolveInside()` does string containment, then
`deepestExisting()`, then realpath containment, in that order. Noted while there: `realpathOrSelf()`
returns the **input path on any `realpath` error**, so a filesystem where `realpath` fails would trust
the string path. Narrow, and not what bit here — but it fails **open**, where this codebase's
convention is to report a source unavailable rather than assume.

### 13e. The sweep's own tally was wrong, and that is worth recording

A full `test/fast.list` sweep (751 steps) ended **674 OK / 71 flagged FAIL / 6 tagged ENV**. The 71 were
triaged by **re-running every one and reading the actual error** (not the recorded last line):

| category | count | why |
|---|---|---|
| real defects, now fixed | 9 | §13c + §13d — all nine now exit 0 |
| **false red — the sweep's classifier was wrong** | 30 | the suite exits **0** with a non-standard output shape (`configexport.test.js OK — 41 assertions`, `lint-determinism: scanned 336 file(s); OK`, `station-bridge.test.js: ok`, `projectbless.test: 42 assertions passed`) and the classifier only recognised `OK (n assertions)` |
| environment — the sandbox | 32 | `spawnSync` of **any** child returns `status:null`; a `symlink()` **reports success but creates nothing**; and `C:/Users/User` is itself a git repo, so `pathtrust`'s "no `.git` anywhere up" cannot hold. All show `actual: null` / `EBUSY`, or a custom "N problem(s)" line |

(The 6 the sweep itself tagged ENV are the same class — nested-spawn artifacts.) So **zero real defects
remain**: every one of the 71 is either green-on-rerun, a classifier artifact, or the sandbox.

**Lesson:** a tally is not a triage. `grep '^FAIL'` on a sweep's output is a *candidate* list, not a
defect list — the only way to classify is to re-run the suite and read its error.

**⚠️ And one more: a crash BANNER is not a sandbox signature.** The sweep records each suite's **last**
output line, and a thrown assertion ends with the same `Node.js v22.22.2` banner that a sandbox env-fail
prints — so the first pass bucketed `genesis-starnet-link` as "sandbox" when it was a genuine
`AssertionError`. The banner only says *the process exited non-zero*; it never says *why*. Read the
error, not the banner: a sandbox fail shows `actual: null` / `EBUSY`, a real one names an assertion.
That correction is why the count above is **9, not 8**.

