# Phase 5 — Automation

**Status: complete and verified.** The rule engine · triggers · conditions · actions · scheduling ·
failure recovery · approval workflows (master prompt §30, Phase 5 — §12 Automation Hub, §13 action
permission tiers, §19 Human Control).

Built on `starnet/` (branch `feat/harness-backend`), continuing Phase 0 (audit), Phase 1 (foundation,
`1429fb43`), Phase 2 (Business Maker, `1429fb43`), Phase 3 (AI Team, `f0058757`) and Phase 4
(Business Manager, `f29fc787`).

---

## 1. What this phase is for

Phases 1–4 gave a business a place to live, a way to be made, a crew, and a console to run it from. All
of that is **attended**: someone opens a pane and does a thing.

**Phase 5 is the first phase that acts while nobody is watching.** That is the whole risk, and it is why
this phase's centre of gravity is not the rule builder — it is the four places where an unattended system
is tempted to overstate itself:

| The hazard | What Phase 5 does instead |
|---|---|
| A rule that reaches **outside** the station (email, spend, publish) runs while the user is asleep | §13's tier is **derived** from the action's permission, never declared by the rule author. A `review`-tier action is **held** and becomes a §13 request; it cannot be executed by the engine at all. |
| A rule triggers a rule triggers a rule… | A **depth bound** (`MAX_DEPTH=3`) **and** a **pass budget** (`MAX_RUNS_PER_PASS=100`). Depth alone does not bound work — a fan-out of 25 rules × 5 actions × 3 deep is bounded per-level but unbounded overall. The pass budget is the bound that actually makes a cascade safe. |
| A hub that is stopped is reported as "running, 0 runs" | `hubLine()` reads `halted` **first** and returns state `stopped`. A stopped hub never prints a run count in the live phrasing. |
| An action that has no rail (no mail server, no payment processor) reports success | `send_external` and `spend_money` carry `executor:'none'` and return `{ok:true, delivered:false, external:true, reason:'…no …rail…'}`. The authorization is recorded; **nothing claims to have left the station**. |

---

## 2. The seam this phase rides (reconnaissance before writing code)

Phase 5 needed **one** new seam and found it already built. `sidecar/index.js:3946` defines `chanBus`,
wrapped at `:3955` as `chanEmitValidated = makeEmitter(chanBus, …)` and `:3956` as
`chanEmit = (name, payload) => chanEmitValidated(name, redact(payload))`, which fans out to
`sse.broadcast`. Every domain event in the app — `task.created`, `business.contact.added`,
`business.finance.recorded` — already flows through it.

So the automation engine is **a subscriber on the existing bus**, not a new event source:

```js
// index.js — subscriber fan-out added this phase
chanBus.subscribers = chanSubscribers;                    // called AFTER sse.broadcast
onChanEvent((name, payload) => automationEngine.handleEvent(name, payload));
```

A throwing subscriber is routed through `failNote('channel.subscriber', e)` — it can never break the
broadcast that other subscribers are relying on.

**What this buys:** every action the engine takes emits a normal domain event through the normal emitter,
so an automation is indistinguishable from a human doing the same thing — which is exactly what makes a
cascade possible, and exactly why the bounds above exist.

**The E-STOP seam.** `POST /api/halt` → `handleHalt` (index.js:17621) already killed runs and stamped
durable halts for cron and loops. Phase 5 added `automationHaltControl(true)` to the same handler and two
receipts (`automationDropped`, `automationHaltPersisted`). One control, one code path, three subsystems
stood down.

---

## 3. The stores (pure UMD · no IO/clock/env/rng · persist-before-commit)

| Module | § | Load-bearing property |
|---|---|---|
| `business-automation-store.js` | §12 | **Three closed vocabularies** — 35 curated `TRIGGER_EVENTS`, 11 `CONDITION_OPS`, 11 `AUTOMATION_ACTIONS`. Each action names its §13 `perm`, so the tier is **derived** (`requiredTiers`) and never declared. `testCondition` is **TOTAL** (never throws); numeric comparison does **not** coerce strings; an unknown op is `false` (fail-closed). `autonomy(rule)` → `autonomous \| approval \| blocked`. |
| `business-approvals-store.js` | §13 | The queue. `create()` **requires** `tier === 'review'` and builds the §26 block through `perms.proposedAction` — so a request with no *why*, no evidence, or entirely-unknown evidence is **REFUSED** (P1). A decision is **final**: `decide()` refuses any non-pending row. Stores `action` (permission action) and `automationAction` (catalogue action) **separately** — they genuinely differ (`external_comms` vs `send_external`). |
| `business-automation-engine.js` | §12/§19 | The driver. Breadth-first `drain()` with the pass budget; `runRule` dispatches by tier (safe → execute, review → request approval, restricted → skip+fail). `testRun()` is a **DRY RUN that writes nothing**. `approve()` decides **first**, then executes, so a double-click cannot run twice. |

**The trigger list is asserted against the live contract.** Every one of the 35 curated events is checked
(a) to be a known event and (b) to declare `businessId` in its schema. The exclusions are asserted too:
`business.activity` (it mirrors every other event → double-fire), `business.automation.ran` (the engine's
own telemetry → self-trigger), `business.approval.requested`, and `opportunity.created` (no `businessId`).

Every id is `<businessId>~a<seq>` (rules) and `<businessId>~v<seq>` (approvals) — **`~`, never `#`**,
because a `#` is stripped client-side as a URL fragment delimiter before the request leaves the browser.
`businessId` is required and part of the id (P6); an empty `businessId` is REFUSED rather than read as
"every business". Both stores persist a **snapshot** of two row families (rules + runs, like
`business-finance.js`).

---

## 4. The HTTP surface — `sidecar/automation-routes.js` (19 rows)

**The route-table trap, again.** `index.js`'s dispatch populates the match array only for `rx` rows; a
`qrx` row leaves `gm = null`, so its handler reads `match === null` and every id lookup 404s **while
looking correct**. All three business-scoped families (`RX_BIZ_AUTOMATIONS`, `RX_BIZ_AUTO_RUNS`,
`RX_BIZ_APPROVALS`) are therefore `rx` with the query-tolerant tail `const QS = '(?:\\?[^#]*)?$';`.
`test/automation-routes.test.js` dispatches with a faithful copy of index.js's match loop and asserts
**exactly one match key per row** and **zero `qrx` rows**.

**Status codes:** 422 bad trigger/condition/action/status-filter · 403 un-enableable · 409 cross-business
payload and double-decision · 404 unknown business/id · 400 bad JSON · 201 creations.

**What the routes add that a store structurally cannot:**
- `GET /api/businesses/:biz/approvals` is **GET-only**. An approval is created by the **engine** when a
  review action fires — there is no hand-made request path, because a request nobody's automation raised
  has no §26 block behind it.
- deleting an automation **expires its pending requests** (reported as `expiredApprovals`), so a deleted
  rule cannot leave a live decision behind;
- `GET /api/automation/catalog` serves **every** picker vocabulary from the module that owns it, plus
  `limits.{maxConditions, maxActions, failureThreshold, defaultCooldownMs, maxCooldownMs, maxDepth,
  maxRunsPerPass, maxRulesPerEvent}`, so the UI cannot drift from the values the stores enforce.

---

## 5. The console — `frontend/app/businessautomation.js` + `css/businessautomation.css`

**A lane, not a window.** The station already has ONE AUTOMATION dock item, and
`frontend/app/windows/automation.js` was built with a lane registry
(`window.AutomationWindow.registerLane`) precisely so a third kind of standing work could join ROUTINES
and LOOPS without a second dock item competing for the same word. Phase 5 registers a **lane** with three
sections — **ACTIVE AUTOMATIONS · BUILD AN AUTOMATION · WAITING ON YOU** — with `ba-*` ids, disjoint from
the lanes' `rt-*` and `lp-*`.

**A collision that would have silently restyled three consoles.** `.bc-*` (Phase 1), `.bm-*` (Phase 2) and
`.mg-*` (Phase 4) are all taken, and every stylesheet in `frontend/css/` is global once `index.html` loads
it. Phase 5 uses **`.ba-*`**; `test/businessautomation.test.js` fails if a taken prefix reappears in the
sheet or the engine.

The engine is split on purpose: the **pure half** (labels, the client-side validation mirror, the live
autonomy derivation, row shaping, the hub sentence) is UMD and Node-loadable so it is unit-tested headless;
the DOM half returns early under Node. Destructive controls arm through the shared **`ArmConfirm`**
two-press helper (fail-closed: disable if absent) — `window.confirm` over the phosphor terminal is banned
by `test/station-tooltip.test.js`.

**The client mirror is checked against the live catalogue, not a copy.** The test builds its catalog from
the **real** store + permissions modules, exactly as `handleCatalog` does, then runs seven drafts through
both `ruleGuard()` and the store's validators and asserts the client never accepts a draft the server would
refuse. A server-side addition the client's guard has not learned about fails the test instead of silently
refusing a valid rule at the form.

---

## 6. The contract

`shared/events.js` gained a **10-event additive** Phase 5 block (**105 → 115** events):
`business.automation.created/updated/enabled/disabled/removed/ran/notified`,
`business.approval.requested/decided` (all carry `businessId`), plus `automation.halted` — deliberately
**not** business-scoped, because it governs the whole hub, and carrying `halted`/`dropped`.

The fixture diff is **133 insertions / 0 deletions** — a pure addition, verified.

---

## 7. A provenance hole this phase closed

`sidecar/business-tasks-store.js` collapsed a task's `origin` to `user` or `plan`. An automation-created
task would therefore have been recorded as **hand-made**. Phase 5 added `ORIGINS = ['user','plan',
'automation']` and made `create(businessId, meta, origin)` take provenance as a **third ARGUMENT** — never
read from `meta`, so a request body cannot claim it. `rowView` clamps an unrecognised origin back to
`'user'`.

---

## 8. Verification

Five new suites, **1,193 assertions**, all passing:

```
business-automation-store (496)   business-approvals-store (103)
business-automation-engine (194)  automation-routes (219)   businessautomation (181)
```

Every headline guard is proven by execution, not by inspection:

- a **self-triggering rule** was bounded by `MAX_DEPTH` — it stopped, it did not spin;
- a **fan-out** of rules was bounded by `MAX_RUNS_PER_PASS` — the pass budget, not depth, is what held;
- a genuine **cascade** (A→B→C) ran, and stopped at depth 3;
- a rule that failed 5× **auto-disabled itself** with a `disabledReason`;
- `testRun()` wrote **nothing**;
- a `review` action **created a request instead of executing**, and approving it ran it exactly once —
  a second approve was **409**;
- `publish_content` on approve advanced the piece with `{kind:'user'}` — the approval **is** §17's human gate;
- `send_external` on approve returned `{delivered:false, external:true, reason:'…no message-delivery rail…'}`;
- `testCondition` never threw on any malformed input, and an unknown op returned `false`;
- a request with **no why / no evidence** was refused at `create()`.

**A real boot smoke**, not just unit tests: the sidecar was started against a scratch workspace, a business
and two automations were created over HTTP, and then —

- adding a contact **fired the rule** (run depth 0, action `notify` executed, `fireCount 1`);
- an `send_external` rule **held** and produced a §13 request with `{{name}}` interpolated to the real
  contact name, a labelled `verified` evidence item, and a `medium` risk;
- approving returned `delivered:false` with the no-rail reason; re-approving and rejecting-after-approving
  both returned **409**;
- `POST /api/halt` returned `automationHaltPersisted:true` and the hub read `halted:true`;
- the sidecar was **restarted** — the halt stamp, both rules (with their `fireCount`s) and both decided
  approvals all loaded back, the RAM counters reset to 0, and a live event while halted was
  **skipped** (`ran:0, skippedHalted:1`).

Gates re-run green: `events-contract` (9) · `failopen-ratchet` (157) · `apiauth` (51) · `bottle-wiring` (22) ·
`station-tooltip` (415) · `onboarding-legibility` (49) · `dock-terms-open` (9) · `capdrift` (99) ·
`frontend-fetch-truth-ratchet` (12) · `control-floor-theming` (121) · `font.law` (216) · `boot-security` (16) ·
`journey-wiring` (13) · `crew-rail-fit` (84) · `titlebar` (21) · `lint-determinism` (315 files) ·
`lint-emits` (505 files, 193 literal emits).

The **fail-open ratchet caught two new violations** in this phase's own code and both were fixed properly
rather than baselined: an empty `catch (_)` in the engine's `note()` (now counted into `logErrors`, which
`stats()` surfaces) and the bus-subscriber catch in `index.js` (now routed through `failNote`).

No Phase 1–4 regressions: all seven neighbouring suites still pass after the tasks-store change
(`business-tasks-store` 126, `business-routes` 104, `businessmanager` 199, `manager-routes` 147,
`aiteam` 108, `businesscenter` 97, `businessmaker` 206).

**Sandbox note:** `test/lint-evidence-secrets.test.js` and `test/website-app-sync.test.js` cannot complete in
this environment — both `spawnSync` a child process, which the sandbox refuses (`EBUSY`). Their underlying
scripts run green when invoked directly.

---

## 9. Files

**New — sidecar (4):** `business-automation-store.js`, `business-approvals-store.js`,
`business-automation-engine.js`, `automation-routes.js`

**New — frontend (2):** `app/businessautomation.js`, `css/businessautomation.css`

**New — tests (5):** one per store, plus `business-automation-engine`, `automation-routes`,
`businessautomation`

**Modified:** `shared/events.js` (+10 events), `test/fixtures/events-contract.snapshot.json` (regenerated,
pure insertion), `sidecar/business-tasks-store.js` (`ORIGINS` + the third `create()` argument),
`sidecar/index.js` (4 requires + store wiring + engine construction + `automationHaltControl` + route mount +
the `chanBus` subscriber fan-out + `handleHalt` integration), `frontend/app/glossary.js` (`automation` and
`approval` terms extended to cover business rules), `frontend/index.html` (stylesheet + script tag),
`test/fast.list`, and the mirrored `website/app/*`.

---

## 10. Next

**Phase 6 — AI Worker · Phase 7 — Intelligence · Phase 8 — Hardening.**
