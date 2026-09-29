# SpaceStation — what changed in the APP itself

Scope: changes to the **shipped product** (the app a user runs) — `frontend/`, `sidecar/`, `src-tauri/`,
`website/`, and the user-facing installers. Test-only, docs-only and tooling-only commits are listed in a
separate section at the end so the app changes are not diluted.

Branch `feat/harness-backend` → published to `mine/feat/business-os`. HEAD `9f0ea6133`.

---

## A. Defects fixed in the running app

### A1. The Settings **Permissions panel was empty** (route shadow) — `1aa1fe850`
The worst defect found. `GET /api/permissions` had **two** handlers: `agent-routes.js` returned only the
tier catalogue, `index.js` returned the real grant snapshot. Dispatch is **first-match-wins**, and the
module table is spread *above* the sidecar's own rows — so the catalogue handler won and the real one became
dead code.

- **What a user saw:** the Permissions panel rendered with **no `grants` and no `masterBypass`** — an empty
  panel and a dead **FULL BYPASS** switch. HTTP 200, no error, nothing in the log.
- **Fix:** deleted the duplicate route row; the handler that *owns* the path now returns an **additive
  payload** (`snapshot + masterBypass + envFullAccess + tiers + defaultGrants`). One path, one payload.
- **Proven live** by curling the running sidecar before/after.

### A2. ADD-project could silently grant your **entire home directory** (path-trust over-grant) — `d49d093c4`
`POST /api/projects/bless` records `detectRoot(path)`, which walked up to the nearest `.git` ancestor **with
no upper bound**. On any machine whose home folder is itself a repo (`yadm`, a bare `~/.git`), blessing a
plain folder under home proposed **HOME** and recorded `path:<home>`.

- **What a user saw:** the ADD-project doorway **commits on the click with no confirmation card**, so a
  folder-sized click silently granted the agent the user's whole personal tree; only a transient toast named
  the root.
- **Fix:** new injected `homeDir` ceiling — `detectRoot` may only return a root **strictly below** home;
  otherwise the pointed-at folder is its own root. Choosing home *itself* still proposes home. `projectbless`
  reuses the same capped walk, so **one injection caps both doorways**.
- **Impact:** `test/e2e.pathtrust.test.js` went from 1 failing assertion to **fully green (52), test file
  unmodified** — the test had been right all along.

### A3. Five user-visible legacy-brand strings the gate was letting through — `9272210d1`
A re-audit with a proper JS tokenizer (instead of the gate's naive comment/quote regex) found the app still
rendered the legacy name in five places while the gate passed green:
- `frontend/app/windows/messaging.js` — **Telegram** connect step: "…**StarNet** will show a one-time owner pairing `/pair` command"
- `frontend/app/windows/messaging.js` — **Signal** connect step: "Run the signal-cli REST API next to **StarNet**…"
- `frontend/app/windows/routines.js` — routine delivery option: "keep result in **StarNet**"
- `sidecar/plugins.js` — generated plugin header comment: "/* <name> — a **StarNet** plugin."
- `sidecar/tools/builtin/shell.js` — shell-guard refusal text: "machine persistence that outlives **StarNet**"

Two constructs had defeated the old scan: a `/*` *inside a string literal*, and a *regex literal containing a
quote*. The website mirror was re-synced. The gate became **structural** (a real tokenizer), not regex-based.

### A4. **Installer header image was broken** — `9f0ea6133`
`src-tauri/installer/header.bmp` was genuinely garbled — a prior bad Pillow attempt produced illegible
default-glyph jitter on the wordmark (the sidebar and DMG background came out fine). Regenerated cleanly;
verified at 6× native aspect: **SPACESTATION** sharp, phosphor glow + gold rail + starfield correct.

### A5. Two `qa/` ledgers rejected by their own validators — `1aa1fe850`
`qa/product-perfect/waves.json` and `claims.json` still said `StarNet…` while the rebranded validators in
`scripts/qa/` demanded `SpaceStation…` — the controller read as **BLOCKED**. Data corrected.

### A6. Stale claims in the QA atlas (`qa/atlas/areas/*.json`) — **uncommitted, this session**
`perfected` atlas entries asserted rendered strings that were **false about the shipped product** (e.g.
`/version` was marked "perfected" while claiming it prints "the real StarNet version/build string"; the
UPDATE button text still said `⭯ UPDATE STARNET ▸`; sleep/autostart/update-center purposes named the legacy
brand). Rendered fields corrected to match shipping code (`frontend/app/chat.js` renders the product name
from `/api/version`). A new `brand-identity.test.js` §13 gate now scans `qa/` so this class cannot recur.

---

## B. Finishing the product rebrand (visible name → SpaceStation)

### B1. The shipped backend (`sidecar/`) — `bf809139b`
43 files swept, **127 brand words** removed from user-visible strings: the **ACP permission prompt a human
approves**, diagnostics copy, and every tool description. Re-applying the gate now flags only the **9
deliberate identifiers** (multipart form boundaries, the skill-exchange User-Agent, the skill-package magic
header, legacy app-data / model-cache directory names).

### B2. Packaging & public surfaces — `7b1d2f154`
`src-tauri/tauri.conf.json` (`productName`), `Cargo.toml`, `Info.plist`, `entitlements.plist`, installer
hooks, `capabilities/default.json`, `credentials.rs`, `fresh_start.rs`, `main.rs` (window title), the
wordmark SVG, the public website + docs, and `frontend/css/*`.

### B3. The remaining frontend/sidecar divergence — `6c86a1cfe`
One frontend string and `sidecar/slash.js` re-pointed; a "lying skip-guard" in a test fixed so a green
result means what it says.

---

## C. Accessibility & visuals

### C1. Real WCAG AA failure in 3 themes + a missing a11y layer — `edc617f98`
- Found a genuine contrast failure in three themes and fixed it.
- Added `frontend/css/a11y.css` (**163 lines**, mirrored into the website) — loads **last** so equal-
  specificity restatements win; fixes `forced-colors` / Windows High Contrast surfaces (ones whose only
  boundary was a `box-shadow` lost their edge) and the `--ph-dim` token which serves **both** as 608 text
  colors *and* as the 1px line token, so it owes the stricter 4.5:1 text floor.
- `index.html` gets the a11y layer linked; `style.css` adjusted. A mechanical contrast gate
  (`theme-contrast.test.js`) now re-measures it all.

### C2. Art for the 7 capability props — `578574dd9`
`frontend/app/propsprites.js` **+572 lines**: draw functions for the 7 capability props. Before this, a
placeable prop with **no `F[id]`** rendered **nothing** — silently, no throw, no log (only a whole-catalog
render-smoke gate catches it).

---

## D. Security / capability hardening

### D1. Skill scanner — 8 of 12 threat classes closed — `14ac2a980`
`sidecar/skills/guard.js` +45 lines: closed **8 of 12** skill-scanner threat classes, taxonomy taken from
the `skill-firewall` project.

### D2. Business OS — durable decision trace — `4c919d056`
`sidecar/agent-routes.js` (+73) + `business-activity-store.js` + `frontend/app/businesscenter.js`: a durable,
readable trace of agent/task assignment decisions.

### D3. §25 Remote monitoring — `f55633bb9`
New `sidecar/business-remote.js` (412 lines), `business-remote-seam.js` (118), `remote-routes.js` (109),
wired into `index.js`: the architecture-ready seam + read model for remote monitoring (a read model; the
composing reader owns no store).

---

## E. Tests / docs / tooling only (NOT app changes — listed for completeness)
Committed: `3b799ae56` (`.github/` rebrand + gate §11), `b78b5fa76` (6 stale test locks + gate §12), and the
`docs/BRIEF-LEDGER.md` read-out §10a–§10i.
Uncommitted: this session's `brand-identity.test.js` §13 (the new `qa/` gate) and `qa/atlas/areas/*.json`
fixes — still staged in the working tree.

---

## Still open (not app defects)

- **Installer art (macOS):** `sidebar.bmp` / `dmg-background.png` were byte-stable from the prior generator
  run and were deliberately **not** re-rendered (a Pillow re-render would drift AA). `gen-installer-art.ps1`
  stays the canonical release generator; `scripts/gen-header.py` keeps the committed header honest here.
- **Sandbox-only test failures:** `loops-git.e2e`, `loops-check.e2e`, `nightshift-focus.e2e`,
  `source-text-integrity`, `release-cut` / `release-bump` — all die on `spawnSync`/`execFileSync` `EBUSY`
  (a hard wall in this environment), unrelated to the product.
