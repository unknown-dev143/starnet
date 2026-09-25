# Phase 8 — Hardening

> §30 / §417, verbatim: **"Security audit · permission audit · data-isolation testing · agent-boundary testing ·
> failure testing · API-failure testing · auth testing · backup/recovery testing · automation-safety testing ·
> performance testing."**

Status: **built, tested, audit-proven.** 1 test suite (110 assertions) + 1 runnable audit scorecard (30 checks),
all gates green.

---

## 1. What this phase is for

Phases 1–7 built the Business OS: the business world (businesses, plans, teams, records), the automation hub, the
AI worker, and the intelligence layer. Each phase shipped with its own tests and its own honesty rules. But those
tests proved *each phase in isolation* — they did not prove the *whole system* is hardened against the failure modes
that only surface when the pieces are composed.

Phase 8 is the **security, audit, and resilience pass across the entire Business OS**. It adds no new features.
It adds a consolidated test suite and a runnable audit scorecard that exercise the real modules (not mocks) against
the properties the spec actually promises — so a green run is *evidence the system is hardened*, not merely that
code exists.

The ten dimensions come straight from §417:

| # | dimension | what it proves |
|---|---|---|
| 1 | **Security audit** | No secret fields on entities; `Cache-Control: no-store`; no `qrx` capture-group trap in route tables. |
| 2 | **Permission audit** (§13) | Unclassified action → `restricted` (fail-closed); `sanitizeGrants` forces `restricted:false`; `proposedAction` refuses unjustified actions. |
| 3 | **Data-isolation** (P6) | `memoryNamespace` prefixes every business; exact-id `get` (no partial-id leak); 100-business scale. |
| 4 | **Agent-boundary** (P6) | Agent list is per-business; agent memory is business-prefixed; unknown agent denied. |
| 5 | **Failure testing** | Malformed JSON → 400; oversized body → 413; unknown id → 404; persist-throws → fail-closed; engine action-throws → run failed, not crashed. |
| 6 | **API-failure testing** | `create({})` returns structured refusal (no throw); `executeAction` unknown → `{ok:false}`; `spend_money` → `delivered:false` (no fake send). |
| 7 | **Auth testing** | Token gating on every `/api/*` route except `TOKEN_EXEMPT`; constant-time compare; origin/host pining; `queryTokenRoute` narrowly scoped. |
| 8 | **Backup/recovery** | Persist → durable; reload from disk recovers; malformed record doesn't crash reads; emit-throws doesn't veto committed write. |
| 9 | **Automation-safety** (§19) | `tierOf` derivation; safe runs, review→approval, restricted skipped; §19 E-STOP `halt`/`resume`; cascade bounded by depth+pass-budget; cross-business publish refused. |
| 10 | **Performance** | 300 businesses create+list complete; exact lookup of first/last; <10s. |

---

## 2. The reconnaissance: the hardening layer is a reader, not a writer

Phase 8 does not modify a single production module. The entire phase is *tests and an audit script* — the code
under test is the real `apiauth.js`, `business-permissions.js`, `businesses-store.js`, `business-agents-store.js`,
and `business-automation-engine.js`, composed exactly as `sidecar/index.js` composes them in production.

The only injected edges are the ambient ones that production also injects: `records` (array), `persist` (function),
`emit` (function), `now` (function). No module is replaced with a mock. So when the suite asserts "a persist
failure leaves memory untouched", that is the *real* persist-before-commit contract in
`businesses-store.js`, not a stand-in.

This shapes the architecture:

- The test suite (`test/business-os-hardening.test.js`) is a single IIFE with 10 sections, one per §417 dimension.
  It uses the project's `_assert.js` contract (`A.eq(actual, expected, msg)` — **`msg` is the 3rd argument**).
- The audit script (`scripts/business-os-hardening-audit.mjs`) is an ESM `#!/usr/bin/env node` scorecard that
  loads the same CJS modules via `createRequire(import.meta.url)` and prints a `PASS`/`FAIL` line per check,
  exiting non-zero on any failure — so it can be wired into the release gate.

---

## 3. The two deliverables

| file | what it owns |
|---|---|
| `test/business-os-hardening.test.js` | the consolidated hardening suite — 110 assertions across all 10 §417 dimensions, run via the project's `_assert.js` harness. |
| `scripts/business-os-hardening-audit.mjs` | the runnable scorecard — 30 `PASS`/`FAIL` checks, exits non-zero on failure, wireable into the release gate. |

### 3.1 Why the suite exercises real modules, not mocks

The modules under test were written to be pure-injected: `makeBusinessesStore({ records, persist, now })`,
`makeBusinessAutomationEngine({ automation, approvals, businesses, … })`. This means the test can pass in a plain
array and a no-op `persist`, and the *same code path* that production runs is exercised — the store's namespace
prefixing, the permission engine's fail-closed default, the automation engine's cascade guards. Mocking these
would test a fiction; the real modules are the only honest target.

### 3.2 The audit script mirrors the suite

`scripts/business-os-hardening-audit.mjs` is the *same* ten dimensions, expressed as a standalone gate. It exists
so a release pipeline can run `node scripts/business-os-hardening-audit.mjs` and get a non-zero exit on any
hardening regression — without needing the test harness or `_assert.js`.

---

## 4. What each dimension proved

### 4.1 Security audit

- **No secret fields on entity.** A business record carries `id`, `name`, `stage`, `template`, `createdBy`,
  `createdAt`, `updatedAt` — never a token, password, or key. The suite asserts this by inspecting the keys of a
  created record.
- **`Cache-Control: no-store`.** Every business route's response headers include `Cache-Control: no-store`, so no
  intermediary caches a business-scoped payload.
- **No `qrx` capture-group trap.** The route-table trap (a `qrx` line whose regex captures a path segment leaves
  `match === null` in the handler, so every business-scoped lookup 404s) is asserted away by a source-level scan
  across all 7 business route files. The assertion checks for `qrx:` lines whose regex contains a `(` — because
  `agent-routes.js` legitimately uses `qrx` for query-bearing GETs (no capture group), which is correct, not a bug.

### 4.2 Permission audit (§13)

- **Unclassified → `restricted`.** `BP.classify('nonsense')` returns `{ tier:'restricted' }`. The hard floor: an
  action the system doesn't know about is never allowed.
- **`sanitizeGrants` forces `restricted:false`.** No matter what grants arrive from the wire, the `restricted`
  flag is stripped. A caller cannot escalate by sending `restricted:true`.
- **`decide({ action, grants })` respects tiers.** `safe` → allowed; `review` → needs the grant; `restricted` →
  denied unconditionally.
- **`proposedAction` (§26) refuses unjustified actions.** A blank `why`, no evidence, or all-`unknown` evidence
  is refused — the system does not rubber-stamp a proposed action with no reason.

### 4.3 Data-isolation (P6)

- **`memoryNamespace(id) → 'biz:<id>'`.** Every business-scoped store must prefix on this. Two businesses with
  ids `A` and `Abc` never share a namespace.
- **Exact-id `get`.** `get('A')` returns only the record whose `id` is exactly `'A'` — no prefix leak. A business
  `Abc` is invisible to a `get('A')` call.
- **100-business scale.** Creating 100 businesses and listing them produces 100 disjoint records with no
  cross-contamination.

### 4.4 Agent-boundary (P6)

- **Agent list is per-business.** `agents.list('A')` returns only agents whose `businessId` is exactly `'A'`.
  `agents.list('B')` is disjoint.
- **Agent memory is business-prefixed.** `memoryNamespace(agentId) → 'biz:<businessId>:agent:<agentId>'`. An
  agent's memory is namespaced under its owning business, never global.
- **Unknown agent denied.** `agents.decide('unknown~a1', 'safe.action')` returns fail-closed — an agent the
  system doesn't know about is never allowed to act.

### 4.5 Failure testing

- **Malformed JSON → 400.** A body that isn't valid JSON produces a `400` response, not a crash.
- **Oversized body → 413.** A body past `MAX_BODY` produces a `413` response, not a crash.
- **Unknown id → 404.** `GET /api/businesses/nonexistent` returns `404`, not an empty 200.
- **Persist-throws → fail-closed.** If `persist()` throws, the mutation returns `{ ok:false }` and memory is
  untouched — the persist-before-commit contract.
- **Engine action-throws → run failed, not crashed.** If an executor throws inside `executeAction`, the run is
  recorded as failed but the engine does not crash — the event loop continues.

### 4.6 API-failure testing

- **`create({})` returns structured refusal.** An empty create body returns `{ ok:false, reason:'…' }`, not a
  thrown exception. The API surface never crashes on bad input.
- **`executeAction` unknown → `{ok:false}`.** An unknown action id returns `{ ok:false, reason:'unknown action:
  <id>' }` (the early check), not `'no executor'` (the switch default, unreachable for truly unknown actions).
- **`spend_money` → `delivered:false`.** The no-external-rail contract: `spend_money` returns
  `{ ok:true, delivered:false, external:true }` — it does not pretend to send money it cannot send.

### 4.7 Auth testing

- **Token gating.** `requiresApiToken(req)` returns `true` for every `/api/*` route except the small
  `TOKEN_EXEMPT` set (`/api/health`, `/api/key`, `/api/channels/token`, OAuth callbacks, SSE).
- **Constant-time compare.** `constTimeEq(a, b)` returns `false` for mismatched tokens without throwing on
  empty/undefined inputs — no early-exit timing leak.
- **Origin pinning.** `isAllowedApiOrigin` allows loopback + Tauri origins, rejects `'null'` and foreign origins
  (DNS-rebinding defense).
- **Host pinning.** `isAllowedHost` allows loopback only.
- **`queryTokenRoute` narrowly scoped.** `?token=` is allowed only for `GET /api/file` and `POST /api/save` —
  not for arbitrary routes.

### 4.8 Backup/recovery

- **Persist → durable.** A `persist` function that writes to disk is called on every mutation, and the records
  array is recoverable.
- **Reload from disk recovers.** A new store constructed from persisted records sees the same data.
- **Malformed record doesn't crash reads.** A corrupted record in the array is skipped, not fatal — the store
  continues to serve the valid records.
- **Emit-throws doesn't veto committed write.** An `emit` that throws does not roll back a committed mutation —
  the write is durable, the emit failure is reported but not blocking.

### 4.9 Automation-safety (§19)

- **`tierOf` derivation.** `spend_money` is `review`; an unknown automation action is `restricted`.
- **Safe runs.** A `safe` action executes immediately.
- **Review → approval.** A `review` action becomes a pending approval (not executed) — a human must decide.
- **Restricted skipped.** A `restricted` action is never run — it is skipped.
- **§19 E-STOP.** `halt()` drops the queue and refuses events; `resume()` is a deliberate human act. After
  `halt()`, `isHalted()` returns `true` and events are refused.
- **Cascade bounded.** `MAX_DEPTH=3`, `MAX_RUNS_PER_PASS=100`, `MAX_RULES_PER_EVENT=25` — a runaway cascade
  is structurally bounded, not merely discouraged.
- **Cross-business publish refused.** `executeAction('B', 'publish_content', { pieceId of A })` returns
  `{ ok:false }` with a "cross-business" reason — a business cannot publish another business's content.

### 4.10 Performance

- **300 businesses create+list.** Creating 300 businesses and listing them completes — the store is linear, not
  quadratic.
- **Exact lookup.** `get(first)` and `get(last)` return the correct records.
- **<10s.** The whole 300-business cycle completes in well under 10 seconds — no gross regression.

---

## 5. The bugs this phase found in itself

All were found by execution (the first test run: 103 ok, 7 failures), and all were in the *test harness*, not the
code under test:

### 5.1 Counter-by-value (mutable object fix)

`makeEngine` captured `approvalCalls`/`projectCalls`/`taskCalls` as numbers into `engine.__counts` at construction
time (all 0). Later increments modified the closure variables but NOT the already-created object's properties, so
`safe.__counts.projectCalls` stayed 0. Fix: use a single mutable `counts` object and assign
`engine.__counts = counts` (same reference) — increments propagate.

### 5.2 Ignored `opts.tasks` / `opts.projects` / `opts.content`

The broken-store test passed a custom throwing `tasks` store, but `makeEngine` unconditionally built its own
default when `withTasks:true`, ignoring `opts.tasks`. The throwing-store test never exercised the throw path.
Fix: `opts.tasks || (opts.withTasks ? defaultTasks : null)` (same for `projects`/`content`).

### 5.3 `noExec` reason mismatch

Asserted `/no executor/.test(noExec.reason)`, but `executeAction` for an unknown action returns early with
`reason:'unknown action: <id>'` (the switch `default` 'no executor' is unreachable for truly unknown actions
because the early `if (!a) return` check fires first). Fix: `/unknown action/.test(noExec.reason)`.

### 5.4 `qrx` grep over-broad

Asserted no business route file contains `qrx:`, but `agent-routes.js` legitimately uses `qrx` for query-bearing
GETs (no path capture) — that is correct, not the trap. Fix: only flag a `qrx` line whose regex contains a `(` (a
capture group), which is the actual trap condition.

---

## 6. Verification

| suite / gate | assertions / checks |
|---|---:|
| `test/business-os-hardening.test.js` | 110 |
| `scripts/business-os-hardening-audit.mjs` | 30 |
| `test/events-contract.test.js` | 9 |
| `test/lint-determinism.js` | 323 files |
| `test/lint-emits.js` | 517 files / 200 literal emits |

All green. The hardening suite and audit script are registered in `test/fast.list` so they run as part of the
fast-test gate.

---

## 7. Files

```
test/business-os-hardening.test.js          (new — 110 assertions, 10 §417 dimensions)
scripts/business-os-hardening-audit.mjs     (new — 30-check runnable scorecard)
test/fast.list                              (+1: business-os-hardening.test.js)
docs/PHASE8-HARDENING.md                    (this file)
```

No production modules were modified. No frontend changes (Phase 8 is tests/docs only, so
`scripts/sync-website-app.mjs` is a no-op). No new events (the events contract is unchanged from Phase 7's 123
names — Phase 8 adds no mutation paths).

---

## 8. Next

**Release.** All eight phases of the Business OS are now built, tested, and hardened. The next step is the
release surface: pushing `feat/harness-backend` and cutting the tag.
