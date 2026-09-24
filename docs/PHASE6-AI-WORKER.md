# Phase 6 — The AI Worker

> §30, verbatim: **"Controlled browser / terminal / file / API / development operations, with strict
> permission boundaries"** (§13 the AI Worker Layer + Action Permission System, §18 Security Center &
> Audit Log, §19 Human Control).

Status: **built, tested, smoke-proven.** 5 modules + 1 window + 5 test suites (676 assertions), all gates
green.

---

## 1. What this phase is for

Phases 1–5 built the business layer's own world: businesses, plans, teams, records, automations. None of
them could touch anything outside that world. An automation rule could notify you, create a task, or file an
approval — but it could not read a file, search the web, or write a draft.

Phase 6 is the seam where a business agent reaches **real station software**. That is the most dangerous
thing in the whole Business OS, so the phase is mostly about what it *cannot* do:

- A step is classified against §13 **before** it is dispatched.
- The station's own gates (user-control authority → capability → schema → consent broker → hooks) still run,
  because a worker step **is** a registry dispatch, not a bypass.
- Writing an order and running it are separate acts.
- An order's status is **derived** from what its steps actually did.

---

## 2. The reconnaissance: the two permission systems are fully disjoint

Before writing code I traced where the business layer could reach the tool registry. **It cannot.** `execute
Action` (the automation engine's action runner) never touches `tools/registry.js`; it writes to business
stores only. So the business layer and the execution layer were two closed systems with no bridge.

Phase 6 is that bridge. And the bridge has to respect something important: **the two systems are on
different axes.**

| | Judges | Speaks | Lives in |
|---|---|---|---|
| **§13** | the **consequence** — what the act means to the business | the 13 action ids, three tiers, the approval queue | `business-permissions.js` |
| **the tool layer** | the **mechanism** — what the call does to the machine | `scope` (read/write/execute), `capability`, the consent broker | `permissions.js`, `tools/*` |

Merging them is the mistake this phase made first and then corrected. See §4.

---

## 3. The four modules

| file | what it owns |
|---|---|
| `sidecar/business-worker-policy.js` | **the bridge.** Tool name → §13 action id (86 entries), plus the composed verdict. Pure. |
| `sidecar/business-workorders-store.js` | the work-order record. **Status is derived, never asserted.** Pure. |
| `sidecar/business-worker.js` | the runner. `dispatch` is **injected**. |
| `sidecar/worker-routes.js` | 10 HTTP rows, all `rx` + query tail. |

### 3.1 The policy table

`TOOL_ACTIONS` maps 86 tool names to §13 action ids. Three properties make it safe:

1. **Fail-closed.** An unrecognised tool lands on `access_sensitive` (restricted) and is refused. New tools
   added upstream do not silently become worker-callable.
2. **Every id is real.** The test asserts all 86 against the *live* `business-permissions.js`, so a rename
   upstream fails the gate instead of producing a policy that classifies everything as
   unknown-and-therefore-restricted — which would look like a very safe policy and would actually be a dead
   feature.
3. **Neither system can override the other.** `decideWorker` ANDs §13's verdict with the runtime's.

### 3.2 The runner

```
plan → (per step) deny → not-wired refusal → ask → run → record
```

The order **is** the security argument. Restricted is checked before `authorized` is ever read, so a
per-request yes can never unlock a restricted action. The unwired check sits after the policy (so a
restricted tool reports the §13 reason, the more meaningful one) but before an approval is filed (so nobody
is asked to authorise something the worker could not then run).

---

## 4. The two bugs this phase found in itself

Both were found by execution, not by reading. Both are worth recording because both *looked* stricter than
the fix.

### 4.1 Folding the tool's `scope` into the §13 tier

`SCOPE_FLOOR = { read:'safe', write:'review', execute:'restricted' }` existed to catch a tool whose own
declaration is stricter than the table. The first draft applied it by **widening the tier**: `fs.write` is
§13 `draft` (safe), the tool declares `scope:'write'`, so the step came back as `review`.

That is incoherent, and `business-approvals-store` said so at runtime:

```
[worker] approval-not-filed "the approval claims tier \"review\" but \"draft\" is a safe-tier action"
```

A safe **action** cannot be filed as a review **request**. The store's invariant is right; the policy was
wrong. The fix keeps the two axes separate:

- `tier` — §13's verdict on the action (`draft` → safe). This is what the grants model and the queue speak.
- `floor` — the runtime's requirement for the mechanism, from the tool's own declaration (`write` → review).
- `floorAbove` — the two disagreeing.

Both must be satisfied before a step runs. A write-scoped tool on a safe action is **held** (not run, and
not filed as a §13 request — §13 has nothing to ask). An execute-scoped tool on a non-restricted action is
**refused outright**: two of our own declarations disagree, and picking the weaker one is not an option.

### 4.2 Handing the consent broker a synthetic descriptor

The runner built the descriptor it passed to the consent gate by hand: `{ name, scope: null,
requiresConsent: true }`. And `permissions.js` defines:

```js
function scopeOf(tool) { return (tool && tool.scope) || 'read'; }
```

A **missing** scope is not "unknown", it is **"read"**. The broker's read tier then auto-allows
(*"read-only, non-network"*). So a work order calling `fs.write` was handed the broker's read-only
allowance, and **the write ran**.

A synthetic descriptor is never neutral — the fallback direction is always toward more permission. The fix:
consult the broker **only** when holding the real declaration, and pass it verbatim. With no descriptor
there is nothing honest to ask about, so the gate is not consulted and the step stays held.

Both halves are asserted in `test/business-worker.test.js`.

---

## 5. The deliberate subset, and the reachability flag

`makeWorkerRegistry()` (in `index.js`) builds a **subset**: web tools, connectors, `station.inspect`, fs
(jailed, **without** `pathTrust` — the stricter of the two), notebook, recall, skills, todo, deliverable,
code, verify, quest, station.

Deliberately absent: **shell, terminal, browser, computer, desktop, spotify, media generators, comms.**

Absence alone would be a silent failure — a step would just fail. So:

- `available()` returns the wired names, read **from the registry itself** (never a hand-kept list).
- A step whose tool is not wired is **refused with its own reason**, distinct from "the policy refused it".
- `/api/worker/catalog` exposes a `wired` flag per row, so the console shows reachability **before** an
  order is written.

This is why the worker currently has **no review-tier tool**: the review actions are `spend_money`,
`external_comms`, `publish_content`, and none of those are wired. Nothing the worker can reach spends money,
messages externally, or publishes. That is a feature, not an oversight — and the review→approve→execute
path is proven in `test/business-worker.test.js` with an injected review-tier tool rather than assumed
unreachable.

---

## 6. Proven end-to-end (live sidecar, not mocks)

```
create business (saas)                      → worker-co
plan: fs.read · fs.write · shell.exec       → safe/run · safe+review floor/ask · restricted/deny
run unattended                              → failed · HELD  · refused     status: partial
                                              (no approval filed — §13 has nothing to ask)
run attended, no grant                      → HELD "autonomous run cannot self-approve — silence is not consent"
grant cabinet:write (the user's durable choice)
run attended                                → EXECUTED, probe.md written
```

That is a real permission: default-deny, unlockable only by the user's own durable decision. The worker
never asks for itself.

Catalog as shipped: **86 policy rows, 32 wired.** Sample unwired: `browser.login`, `computer.use`,
`desktop.open`, `shell.exec`, `terminal.*`.

---

## 7. The console

`frontend/app/businessworker.js` + `css/businessworker.css` (`.wk-`, verified free — `.bc-`/`.bm-`/`.tm-`
/`.mg-`/`.ba-` are Phases 1/2/3/4/5). New **WORKER** dock item; `windows/worker.js` owns the key and title
(TITLE LAW: dock reads WORKER, window registers `'WORKER'`).

Four sections: **WAITING ON YOU** · **PLAN ONE** · **WORK ORDERS** · **WHAT THE WORKER MAY DO**.

Two rendering rules carry the phase's meaning:

1. **Both permission answers are shown** — the tier chip, and a `FLOOR` chip only when the floor is
   stricter. A redundant "floor: safe" on every row would bury the one row where it matters.
2. **An Approve button appears only for a decidable request.** A held step with no `approvalId` is waiting
   on the runtime consent gate, not on the owner. A dead Approve button would be a lie about who can unblock
   it. `waitingRows` filters on `params.orderId`, exactly as the route does.

Destructive controls use `ArmConfirm` (two-press, fail-closed: no helper means the button is disabled).

---

## 8. The contract

`shared/events.js` grew by **7 additive names** (115 → 122). `git diff --numstat` on the snapshot fixture:
**142 insertions, 0 deletions** — a pure addition, so every earlier consumer stays valid.

```
business.workorder.planned
business.workorder.step.refused      (unwired: false = §13 refused it, true = no route to it)
business.workorder.step.held         (approvalId empty = waiting on the runtime, not on you)
business.workorder.step.approved     (status = what actually happened; an approval is not a promise)
business.workorder.step.rejected
business.workorder.finished          (status = the store's DERIVED verdict)
business.workorder.removed           (expiredApprovals = requests retired with it)
```

---

## 9. Verification

| suite | assertions |
|---|---:|
| `business-worker-policy.test.js` | 296 |
| `business-workorders-store.test.js` | 104 |
| `business-worker.test.js` | 100 |
| `worker-routes.test.js` | 99 |
| `businessworker.test.js` (console) | 77 |
| **total** | **676** |

Gates re-run green: `events-contract`, `failopen-ratchet`, `lint-determinism` (319 files), `lint-emits`
(511 files / 200 emits), `apiauth`, `bottle-wiring`, `station-tooltip`, `onboarding-legibility`,
`dock-terms-open`, `capdrift`, `cap-tool-registration`, `capprop-map.contract`,
`frontend-fetch-truth-ratchet`, `control-floor-theming`, `font.law`, `boot-security`, `journey-wiring`,
`crew-rail-fit`, `titlebar`.

A real bug fixed by the store test: `deriveStatus` counted `skipped` in the *pending* bucket, so an order
whose remaining steps were deliberately skipped could never leave `running` — it hung open forever.

---

## 10. Files

```
sidecar/business-worker-policy.js        (new)
sidecar/business-workorders-store.js     (new)
sidecar/business-worker.js               (new)
sidecar/worker-routes.js                 (new)
frontend/app/businessworker.js           (new)
frontend/app/windows/worker.js           (new)
frontend/css/businessworker.css          (new)
frontend/app/glossary.js                 (worker · workorder · floor)
frontend/index.html                      (stylesheet · dock item · 2 scripts)
sidecar/index.js                         (requires · makeWorkerRegistry · workerToolInfo · workerConsentFor · store · runner · 10 route rows)
shared/events.js                         (+7)
test/fixtures/events-contract.snapshot.json  (+142 / −0)
test/fast.list                           (+5)
docs/PHASE6-AI-WORKER.md                 (this file)
```

---

## 11. Next

**Phase 7 — Intelligence**: metrics, insights and reporting across the business layer. Phases 1–6 have
built the world and given it hands; Phase 7 is where it starts to say something true about itself.
