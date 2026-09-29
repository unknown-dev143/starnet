# Verification & gap-triage findings

**Date:** 2026-09-30 · **Branch** `feat/harness-backend` · **HEAD** `1c87c153d` · tree clean.

---

## PART 1 — `CAP_PROP_MAP` (worldmodel.js): VERIFIED, no change needed

**Result: all 7 entries are already present and correct — nothing to add.**

`frontend/app/worldmodel.js:120` (and the mirror `website/app/app/worldmodel.js:120`):

```js
jukebox: 'jukebox', editingbay: 'editingbay', audiolab: 'audiolab', cinema: 'cinema',
publishinghouse: 'publishinghouse', briefingroom: 'briefingroom', printshop: 'printshop', listingdesk: 'listingdesk'
```

- Each maps **to itself** as a string, exactly the requested style.
- Introduced in **`1429fb43d`** ("SpaceStation Business OS — foundation…"); untouched by the rebrand /
  route / path-trust work.
- **No conflict** with recent work: `git status` clean for both files; `git diff HEAD` empty.
- `CAP_LABEL` (`:126-129`) also carries labels for all 7 (`AUDIO`, `VIDEO`, `EDITING`, `DOCS`, `BRIEFINGS`,
  `PRINT`, `LISTINGS`), and the contract gate `test/capprop-map.contract.test.js` is **green (143 assertions)**.

**Diff: EMPTY** (no edits made).

---

## PART 2 — Gap status (report only, nothing fixed)

| # | Gap | Status | Evidence |
|---|-----|--------|----------|
| 1 | Agent can't read props placed in its OWN room | **STILL MISSING (real)** | `sidecar/tools/builtin/station-inspect.js` returns only `{build, runtime, scheduler, connectors, diagnostics}` — no room/props. Room data DOES exist server-side (`st.rooms.bay.objects`), so the feature is buildable. |
| 2 | `/api/toolsets` `placed` | **MISLEADING BUT DELIBERATE (confirmed echo)** | Proven live: bare ⇒ none placed; `?placed=cinema` ⇒ cinema placed; `?placed=bogusvalue123` ⇒ none. Server consults **no placement state** — the field intersects an `object` id set the **client** uploaded from its own `World.stationCaps()`. |
| 3 | Scheduler health | **NOT APPLICABLE / by design (never ticked)** | Live `/api/cron`: `enabled:false, halted:false, jobs:[], health:{healthy:false,lastTickAt:null}`. The scheduler is **INERT unless armed** — a user who never enables cron has no cron. Not broken. |
| 4 | OpenRouter "Reasoning is mandatory…" 400s | **STILL PRESENT IN HISTORY — stopped ~2026-09-03 (cause identified)** | `diag.errors.json` holds 8 entries, **7 are the exact 400**, all dated **2026-09-03**. Nothing since. Root cause is the request shape in `providers/openrouter.js:202`. |

### Detail

**#1 — no self-room read.** `station.inspect` has `schema: {type:'object', properties:{}}` and a fixed
5-section snapshot. It answers "what is SpaceStation" but not "what is physically in MY room". Genuinely
missing.

**#2 — the `placed` echo is a query-param intersection.** `handleToolsetsList` (`sidecar/index.js:10915`)
does `placedTypesFrom(u.searchParams.get('placed'))` then `placed: !!(r.object && placedSet[r.object])`.
The interactive panel is honest only because `frontend/app/windows/connectors.js:498` sends its own
`World.stationCaps()`. The **autonomous** path already does this correctly server-side
(`index.js:14189`, `router.stationFor(agentId)` → `st.rooms.bay.objects`) — so the asymmetry is the smell:
one endpoint trusts the caller, the other reads the station.

**#3 — scheduler healthy:false is correct.** Matches `docs/PHASE0-AUDIT.md` item #5 ("NOT A BUG — by
design"). `armed:false` is the right state when cron was never enabled.

**#4 — cause (identified, not fixed):**
```js
// sidecar/providers/openrouter.js:202
if (effort !== 'none' || allowed.length > 1) body.reasoning = { effort };
```
For a **reasoning-capable** model `allowed` has >1 entries, so the guard passes and the body carries
`reasoning: { effort: 'none' }` whenever the user sets the dial to **OFF** (`modeldock.js:34`, id `none`).
An endpoint whose reasoning is mandatory then 400s. Proven with the module's own `_internals`:
`clampReasoningEffortForModel(<reasoning model>, 'none', …)` → `'none'`, and `allowed.length > 1` → `true`.
The fix is almost certainly to **omit the block entirely when the clamped effort is `'none'`** — but per
your instruction, not applied yet.

Note: the existing test `test/provider.openrouter.test.js:159` asserts the *non*-reasoning model omits the
block (`reasoning: undefined`); it does **not** exercise a reasoning-capable model dialled to `none`, which
is the case that misfires.
