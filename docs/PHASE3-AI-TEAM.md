# Phase 3 — AI Team

**Status: complete and verified.** Agent registry · roles · permissions · memory · task assignment ·
communication · activity logs (master prompt §30, Phase 3).

Built on `starnet/` (branch `feat/harness-backend`), continuing Phase 0 (audit), Phase 1 (foundation) and
Phase 2 (Business Maker). Phase 2 closed at commit `1429fb43`; the stale-`.bak` cleanup followed at `98095c32`.

---

## 1. The decision that shaped this phase: BRIDGE, don't duplicate (P4)

Phase 0's audit found that StarNet **already ships an agent catalog**: `shared/specialties.js`, the 50-class
roster behind the Recruitment Bay, each class carrying a real persona, operating manual, kit, skill bundle
and model tier. It also already ships `sidecar/permissions.js` (a runtime **tool-call consent broker**),
`sidecar/memory-store.js` (a per-station-agent **notebook**), `sidecar/subagents.js`, and `sidecar/agent-affinity.js`.

So Phase 3 could easily have produced a second, parallel "business agent" catalog — and that would have been
the exact duplication P4 forbids, with the added harm that the two catalogs would drift and the class the
harness actually summons would stop matching the class the business UI lists.

**What Phase 3 does instead:**

| §7 role (12) | Filled by (existing SharedSpecialties ids) |
|---|---|
| CEO | `strategist`, `chief` |
| Research | `researcher`, `opportunist` |
| Product | `drafter`, `designer` |
| Engineering | `engineer`, `dbhelper`, `deployer` |
| Marketing | `marketer`, `copywriter`, `publisher`, `optimizer` |
| Sales | `closer`, `prospector`, `negotiator` |
| Finance | `treasurer`, `broker` |
| Operations | `operator`, `processwriter`, `support` |
| Analytics | `analyst`, `harvester` |
| Security | `auditor`, `sentinel` |
| QA | `apptester`, `reviewer`, `a11y` |
| Project Manager | `foreman`, `taskmaster`, `chief` |

`shared/business-roles.js` owns **only** that table — the role id, the §7 label, the §7 responsibility
sentence verbatim, and the class ids. It adds **no** persona, manual, kit or skills. A test asserts a role row
carries exactly those four keys, so the bridge cannot quietly grow into a catalog.

### The anti-drift law

Every specialty id a role names must resolve in the real `SharedSpecialties`. That is enforced twice:
`BusinessRoles.unresolved()` is a **real runtime function** (the hire path refuses a role whose classes have
vanished), and `test/business-roles.test.js` pins it so a rename in `specialties.js` fails the gate instead of
silently producing a role nobody can fill. Same discipline as `capdrift`.

### The other distinction worth stating

`sidecar/business-permissions.js` (new) is **not** `sidecar/permissions.js` (existing). The existing module is
the runtime tool-call gate sitting in the dispatch pipeline. The new one is the **declarative business-action
model**: a closed catalogue of action *classes*, each assigned one of §13's three tiers, plus a per-agent
grant set. They compose — a business action classified `review` becomes a pending approval here; if it is ever
executed, the resulting tool call still passes through the consent broker at the dispatch edge (Phase 6).
Merging them would put business vocabulary into the hot path of every tool call.

---

## 2. Modules

### Pure (no IO, no clock, no env, no rng)

**`shared/business-roles.js`** — the §7 role bridge described above. Exports `ROLES`, `ROLE_IDS`,
`byId`, `catalog`, `specialtiesFor`, `defaultSpecialty`, `specialtyLabel`, `hasSpecialty`,
`knownSpecialtyIds`, `unresolved`. UMD: `SharedBusinessRoles` in the browser (index.html loads
`shared/specialties.js` first), `module.exports` under node.

**`sidecar/business-permissions.js`** — §13's three tiers + the §26 Proposed Action block.
`TIERS = ['safe','review','restricted']`; 13 actions (6 safe, 3 review, 4 restricted). Exports `classify`,
`sanitizeGrants`, `decide`, `proposedAction`, `normalizeEvidence`, `catalog`, and re-exports `EVIDENCE`
**imported from `opportunities-store.js`** so the two modules can never disagree about what an evidence class is.

### Stores (pure UMD, persist-before-commit / fail-closed)

**`sidecar/business-agents-store.js`** — the §7 registry. A row is `{ id, seq, businessId, role, specialty,
name, status, grants, hiredBy, createdAt, updatedAt }`. `id = <businessId>~a<seq>`.
`memoryNamespace(id) -> 'biz:<businessId>:agent:<agentId>'`. Statuses `idle|working|paused|disabled`
(§19 pauses an *individual* agent). Exposes `hire`, `update`, `setStatus`, `setGrants`, `remove`, `list`,
`get`, `has`, `count`, `byRole`, `decide`, `resolveSeat`.

**`sidecar/business-memory.js`** — §9's four scopes. `SCOPES = ['user','business','project','agent']`;
`KINDS` = §9's list of eleven; `SOURCES = ['user','document','agent','import']`.
Isolation is **structural**: every entry stores an internal tenancy key `scope\u0000ownerId` and every read
filters on it, so a cross-owner read is impossible rather than merely unlikely. `id = <scope>~<ownerId>~<seq>`.

**`sidecar/agent-messages-store.js`** — §7 communication. `KINDS = ['note','request','handoff','decision','report']`.
Addressed (`from`/`to`), typed, business-scoped, append-only, bounded at 500/business. `id = <businessId>~m<seq>`.

### HTTP surface

**`sidecar/agent-routes.js`** — 12 route rows, mounted into `ROUTES` after `...taskRoutes.routes`:

```
GET    /api/roles                          -> { roles, unresolved }
GET    /api/permissions                    -> { tiers, defaultGrants }
GET    /api/businesses/:id/agents          -> { agents, count }
POST   /api/businesses/:id/agents          -> { ok, agent }              (body { role, specialty, name, grants })
GET    /api/businesses/:id/memory          -> { entries, counts, scope, ownerId }
POST   /api/businesses/:id/memory          -> { ok, entry }
GET    /api/businesses/:id/messages        -> { messages, parties }
POST   /api/businesses/:id/messages        -> { ok, message }
GET    /api/agents/:id                     -> { agent, memoryNamespace, decisions }
PATCH  /api/agents/:id                     -> { ok, agent, changed }
DELETE /api/agents/:id                     -> { ok, removed }            (409 if tasks are assigned)
POST   /api/agents/:id/status              -> { ok, agent }
POST   /api/agents/:id/grants              -> { ok, agent }              (restricted forced false + a note)
POST   /api/tasks/:id/assign               -> { ok, task }               ('' unassigns)
DELETE /api/memory/:id                     -> { ok, removed }
```

**Matcher choice, and why it matters.** The three business-scoped families use **`qrx`**, not `rx`: their GETs
carry `?scope`/`?owner`/`?kind`/`?with`, and index.js's `rx` matches the **full** URL, so a query string would
make the row miss entirely. This is the same class of bug as the Phase 2 `#` separator — a route that looks
correct and silently never fires.

### Frontend

`frontend/app/aiteam.js` (UMD `AITeam`), `frontend/app/windows/team.js`
(`registerWindow('team','AI TEAM', …, {console:true})` — TITLE LAW), `frontend/css/aiteam.css` (scoped `.tm-*`),
a `team` glossary term, and the dock button / stylesheet link / two script tags in `frontend/index.html`
(engine before slot).

The console is four panes in funnel order: **TEAM · HIRE · MEMORY · MESSAGES**.

---

## 3. What is enforced STRUCTURALLY (not editorially)

This is the same design idea as Phase 2's P1/P2 guards, applied to §7/§13/§9:

1. **§13 hard floor — an unclassified action is never safe.** `classify('anything-new')` returns
   `{ ok:false, tier:'restricted' }`. A new action nobody classified cannot silently inherit
   "runs automatically".
2. **§13 hard floor — `restricted` is never auto-grantable.** `sanitizeGrants()` forces
   `restricted:false` regardless of input, including a poisoned base. `decide()` refuses a restricted action
   even when the caller claims the grant.
3. **§7/P7 — an agent is a configuration.** Nothing in the registry schedules, invokes or progresses an agent.
   It has a role, a class, a permission set and a context scope. The status is whatever the store says.
4. **§7 — a class must fill the role.** `hire`/`update` refuse a specialty the role does not name, so "role"
   stays meaningful instead of decorative.
5. **§9/P6 — an ownerId is required on every memory write**, and an empty one is REFUSED rather than read as
   "everything". A user-scope entry never claims a `businessId` it does not have.
6. **§9/P1 — a memory write requires a `source`.** A remembered fact with no provenance is indistinguishable
   from one the AI invented.
7. **§26/P1 — a Proposed Action with no evidence is refused**, and evidence that is *entirely* `unknown` does
   not count as justification.
8. **§7 — a message cannot be addressed to a stranger.** The store cannot know who belongs to which business;
   the route does, and returns a 422.

---

## 4. Additive bus events (`shared/events.js`)

Seven new names; nothing renamed, removed or retyped. **77 → 84 events.**
Fixture diff: **104 insertions, 0 deletions** — the purely-additive diff is the proof.

```
agent.hired                { businessId, agentId, role, specialty, name }
agent.updated              { businessId, agentId, role, status, changed[] }
agent.fired                { businessId, agentId, name }
agent.assigned             { businessId, taskId, agentId, role }
agent.message              { businessId, messageId, from, to, kind }
business.memory.written    { businessId, id, scope, ownerId, kind, source }
business.memory.forgotten  { businessId, id, scope, ownerId, kind }
```

**Namespace note.** The contract already carries `agent.run.start` / `agent.token` / `agent.cost` for **station
runs**, all keyed on `agentId` + `runId`. The Phase 3 events carry `businessId` and **no** `runId`, and are
never emitted by the run loop — a hired role agent is a configuration, not a run, and conflating the two would
make them look like the same thing to every listener.

---

## 5. Tests

Seven new suites, all registered in `test/fast.list`:

| Suite | Assertions | Covers |
|---|---|---|
| `business-roles` | 136 | §7's twelve, verbatim; **the anti-drift law**; the bridge adds no catalog data |
| `business-permissions` | 99 | the two hard floors; the ladder; §26; one evidence vocabulary |
| `business-memory` | 60 | four scopes; P6 write refusal + read isolation; P1 source; `~` ids |
| `business-agents-store` | 71 | hire/update/status/grants/remove; P6; restricted never stored; fail-closed |
| `agent-messages-store` | 37 | closed kinds; self-message refusal; P6 scoping; fail-closed |
| `agent-routes` | 134 | P6 cross-business 409; 422s; schema-valid emits; **index.js mount locks** |
| `aiteam` | 108 | no-default pickers; the hire guard; the specialty list is role-scoped; ArmConfirm |

**645 new assertions.**

### Bugs the tests caught (mine, in this phase)

- **`update()` re-role.** Re-roling an agent while keeping its old class was refused — correct per the seat
  rule, but it made "change this agent's role" impossible without also naming a class. Fixed: when the role
  changes and no class is named, adopt the new role's default (and the route reports both fields in `changed`,
  so it is never silent).
- **`rx` vs `qrx`.** The business-scoped GETs would never have matched. Caught by the routes test the moment it
  used `?with=`.
- **A test that could not fail.** The memory persist-before-commit block asserted `forget()` returns
  `ok:false` on an *empty* store — but `forget` of an unknown id is a no-op success, so the assertion was
  testing nothing. Rewritten to commit one row, then make persist throw.

### Verified green alongside

`lint-determinism`, `lint-emits`, `failopen-ratchet` (157), `station-tooltip` (405), `events-contract` (9),
`onboarding-legibility` (49), `dock-terms-open` (9), `frontend-fetch-truth-ratchet` (12), `capdrift`,
`prop-search` (260), `cap-tool-registration` (306), `capprop-map.contract` (143), `capgate` (54),
`class-loadouts` (2798), plus every Phase 1 and Phase 2 suite — **22/22 in the Business OS set, 0 failures**.

---

## 6. Deliberately deferred (with reasons)

- **Actually running an agent** → Phase 6 (AI Worker). Phase 3 builds the registry and the permission model;
  the thing that executes a tool call under those permissions is the Worker, and it must still pass through
  the existing consent broker.
- **The Approve/Reject queue** → Phase 5 (Automation: "approval workflows"). Phase 3 owns the *decision*
  (`allow` / `approval: 'required'`); the queue that holds pending actions is the automation engine's.
- **Continuous agent activity** → Phase 5/7.
- **Per-business projects** → Phase 4 (Business Manager). The memory store already accepts a `project` scope;
  nothing creates project ids yet.
- **Agent-to-agent autonomous dialogue** → not planned. §7 asks for defined roles with scoped context, and P7
  forbids the fake independence a self-talking crew would imply. Messages are authored by a human or an agent
  run, never by a loop that decides to speak.

---

## 7. Still open

- **The full `npm run test:fast`** cannot complete in this sandbox (Node cannot spawn any child process:
  `spawnSync … EBUSY`). Every child-process suite — the release train, `eval-*`, `source-text-integrity`,
  `qa-installed-*`, `station-recovery-cli` — is unrunnable here. Re-run it normally.
- **Commit the Phase 3 working tree.**
