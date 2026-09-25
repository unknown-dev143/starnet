# Phase 7 — Intelligence

> §30, verbatim: **"Model router · AI cost optimization · opportunity monitoring · business intelligence ·
> cross-business portfolio analytics"** (§11 Business Intelligence, §30 the Intelligence phase).

Status: **built, tested, smoke-proven.** 5 modules + 1 window + 5 test suites (88 assertions), all gates
green.

---

## 1. What this phase is for

Phases 1–6 built the business world and gave it hands — businesses, plans, teams, records, automations, a
worker that can touch real software. None of them ever *said* anything about what the business was doing. A
metric could be recorded; an experiment could end; a signal could exist — but the station never reported a
single one of them.

Phase 7 is the layer that **reads the recorded world back and says something true about it.** Five reads, all
of them *reads* (there is no POST that mutates a metric, a model choice, or an agent's configuration):

- **Business intelligence (§11)** — what moved, what is odd, what to look at, and an *explanation* of a change
  that names possible causes without pretending certainty.
- **Cross-business portfolio analytics** — one row per §11 metric, aggregated across businesses, honestly.
- **Opportunity monitoring** — conditions on recorded data, never recommendations.
- **Model router** — which model *should* run a piece of work, refusing hard requirements it cannot meet.
- **AI cost optimization** — where a cheaper equivalent model existed, labelled as an *estimate*.

The whole phase is governed by one principle, repeated in every module header: **no fake intelligence (P7).**
An explanation is not a verdict. A missing reading is not zero. A saving is an estimate, and says so.

---

## 2. The reconnaissance: the analytic layer is a reader, not a writer

Before writing code I traced where the Phase 7 reads would come from. Phase 4 built `business-metrics.js` to
*record* readings (it refuses to manufacture them — §11's honesty rule, and P7's own "no derived score"). So
the metric *store* already existed; Phase 7 only had to read it back. That is the entire brief, and it shapes
the architecture:

- Every analytic function is **pure** — no IO, no clock, no env, no rng. The readings/activities/experiments
  arrive through **injected accessors**, so the engine is unit-testable with plain arrays and cannot crash the
  host when a corroborating store is absent.
- The model router and cost optimizer are likewise pure and injected; the live OpenRouter catalog is *warmed
  in* at boot and can fall back to an offline seed without breaking a single read.
- The HTTP surface is **eight rows, all `rx` + query tail, zero `qrx`** — the route-table trap from earlier
  phases (a `qrx` row leaves `match === null` and every business-scoped lookup 404s) is asserted away by the
  route test.

---

## 3. The five modules

| file | what it owns |
|---|---|
| `sidecar/intelligence-engine.js` | the analytic layer. `change` / `explain` / `anomalies` / `portfolio` / `signals` / `digest`. Pure. |
| `sidecar/model-router.js` | picks which model runs a task. Refuses hard requirements it cannot meet; never invents a price or capability. |
| `sidecar/ai-cost-optimizer.js` | reads spend, proposes only swaps that *preserve capability*; reports unpriced/subscription/absent models as blind spots. |
| `sidecar/intelligence-routes.js` | the HTTP surface — 8 rows, read-only. |
| `frontend/app/businessintelligence.js` | the console. Pure half (labels, row shaping) is Node-loadable and tested headless. |

### 3.1 The engine's honesty guarantees

`intelligence-engine.js` is where the no-fake-intelligence rule lives as *structural* constraints:

- **No percentage from or to zero.** Revenue `0 → 500` is not "infinite % growth" — it is `kind:'onset'`
  ("started recording"), reported with the raw values and `changePct: null`. `500 → 0` is `kind:'cessation'`.
  A percentage of nothing is not a fact.
- **The short-history fallback.** A business two weeks into tracking has every reading inside the 30-day
  window, so "the reading before the window opened" does not exist. Refusing outright would leave it with
  permanent "unknown". Instead the baseline falls back to the *earliest* reading, `note` says so, and the
  confidence is **capped at `weak`** regardless of reading count — the window does not match the period it
  claims to describe.
- **Confidence is about the data, not the move.** 20 readings showing a huge swing is well-observed; two
  readings showing the same swing is barely observed. So `>=8 → strong`, `>=4 → moderate`, else `weak`.
- **A rate is not summed.** Adding four conversion rates means nothing. The portfolio reports a rate's
  `mean` and sets `total: null`. A business with no reading contributes `null`, never `0`, so a total is the
  sum of what was actually recorded and `coverage` states how many businesses that covers.
- **Anomaly detection uses median + MAD** (not mean/stdev) — a single wild reading barely moves a median but
  drags a mean, so a mean/stdev detector hides the outlier it was built to find.
- **An explanation offers *possible* causes, never *because*.** The vocabulary is `possible`, and every
  cause names the evidence class it rests on (`strong`/`moderate`/`weak`). The verdict reads "none is asserted
  as the reason". A recorded experiment that ended in-window is a `strong` candidate; thin sampling is flagged
  as a `sampling` cause; an unknown metric returns `null` (404), never a fabricated verdict.

### 3.2 The model router's two laws

1. **A hard requirement that cannot be met is a refusal, not a downgrade.** If the work needs tools and the
   cheapest model has none, routing to it "because it is cheap" produces a run that silently cannot do its
   job. `route()` filters on hard requirements *first* and returns `{ ok:false, reason, considered }` when
   nothing survives — it never relaxes a requirement to find a candidate.
2. **It never invents a price or a capability.** A model with no list price is `priced:false` and is ranked as
   though free *only* if the caller explicitly accepts unpriced models. The `reason` string describes **only
   what the ranking actually used**: when no eligible model carries a list price, it says "cost did not decide
   this — the order falls back to model id", never "cheapest that meets the requirements".

### 3.3 The cost optimizer's estimate discipline

Every recommendation carries `evidence:'estimate'`, a `caveat` ("Verify on a sample before switching…"), and
`capabilitiesPreserved`. A swap is proposed **only** when the replacement clears the *same* capability filter
the routing decision uses (`router.eligible`), so an optimizer recommendation and a routing decision can never
disagree about what a model can do. Unpriced, subscription, and catalog-absent models are reported as
**blind spots**, never swapped onto metered. Below-threshold spend yields no recommendation; no usage yields a
warning, not a fabricated saving.

---

## 4. The bugs this phase found in itself

Both were found by execution (the unit tests + a live smoke), not by reading. Both *looked* stricter than the
fix.

### 4.1 Normalising OpenRouter pricing — and not claiming a price that isn't there

The live OpenRouter `/models` endpoint publishes pricing as `{ prompt, completion }` in **USD per token**.
The router reasons in **USD per million**, so the first broken behaviour was that every live model came back
`priced:false` with an empty `provider` — `normalise` only read the `priceIn`/`priceOut` (per-million) shape
of the *seed* catalog. Fix: `prompt * 1e6` / `completion * 1e6`, and derive `provider` from an
`"<provider>/<model>"` id when absent.

Once prices were real, a second, subtler bug appeared: `reasonFor` claimed "cheapest that meets the
requirements" **even when every candidate was unpriced** (which was the entire 460-model live catalog at the
moment the smoke ran). The fix inspects `pricedPeers` / `knownSpeed` and states plainly that cost/quality/speed
*did not* decide the ranking when no signal exists — because printing "cheapest" in that state is a cost claim
the router never computed. The unit test `model-router.test.js` constructs *priced* rows so the honest
"cheapest" branch is proven, and a second case proves the honest "cost did not decide this" branch.

### 4.2 The portfolio signature and the all-`eq` order trap (test harness)

`portfolio(o)` takes an **object** `{ businessIds: [...] }`, not an array. A test that called
`portfolio(['p1','p2'])` silently fell through to `businesses()` (which was `null` in the test fixture) and
returned an empty metrics list — the very next line then dereferenced `undefined` and threw, crashing the
suite before `report()`. The fix passes the object form, and the suite now asserts the honest aggregate
(`revenue` total `300`, `conversion-rate` `total:null` with `mean:0.1`, the missing business `value:null`).

A second harness bug bit all five suites at once: `test/_assert.js` defines `eq(actual, expected, msg)` with
`msg` as the **third** argument, but every call was written `eq(msg, actual, expected)`. Under that order the
first argument became the *actual* and the real *expected* was silently converted to a string as the *message*
— so every `eq` failed with a confusing "expected … got …" that pointed at the wrong value. The fix is the
same one-line shape in all five files. (This is captured in the `starnet-feature-addition` skill so it does
not recur.)

---

## 5. The console

`frontend/app/businessintelligence.js` + `frontend/css/businessintelligence.css` (`.in-`, verified free —
`.bc-`/`.bm-`/`.tm-`/`.mg-`/`.ba-`/`.wk-` are Phases 1–6). New **INTELLIGENCE** dock item;
`windows/intelligence.js` owns the key and title (TITLE LAW: dock reads INTELLIGENCE, window registers
`'INTELLIGENCE'`).

Five panels: **WHAT MOVED** · **PORTFOLIO** · **SIGNALS** · **MODELS** · **AI COST**. Three rendering rules
carry the phase's meaning:

1. **No data is not zero data.** A null reading renders as "not recorded" / `MISSING`, never `0`. A portfolio
   total built from a dozen zeros would look like a real aggregate of real businesses.
2. **Causes render under POSSIBLE CAUSES** and quote the engine's own `verdict` — "none is asserted as the
   reason". Rendering "Revenue fell because 2 jobs failed" would be a causal claim the data cannot support, and
   it would be believed.
3. **A saving is an estimate and says so.** Each cost recommendation shows its caveat inline, because "switch
   to X, save $89" without "assuming the cheaper model is good enough" is a number the owner would act on and
   could not audit. The blind spots are rendered as prominently as the savings.

The pure half (formatters, the MISSING renderer, the POSSIBLE-CAUSES renderer, the route-form validator) is
Node-loadable and unit-tested headless in `test/businessintelligence.test.js`.

---

## 6. The contract

`shared/events.js` grew by **1 additive name** (122 → 123): `intelligence.model.routed` — emitted when the
router answers "which model runs this" (`ok:false` means it refused). `git diff --numstat` on the snapshot
fixture: **14 insertions, 0 deletions** — a pure addition, so every earlier consumer stays valid.

That is the right-sized footprint for a phase that is entirely a *read* layer: one event, because no Phase 7
endpoint mutates state.

---

## 7. Verification

| suite | assertions |
|---|---:|
| `intelligence-engine.test.js` | 23 |
| `model-router.test.js` | 20 |
| `ai-cost-optimizer.test.js` | 16 |
| `intelligence-routes.test.js` | 14 |
| `businessintelligence.test.js` (console) | 15 |
| **total** | **88** |

Gates re-run green: `events-contract` (9 assertions), `lint-determinism` (323 files), `lint-emits` (517 files
/ 200 literal emits).

The end-to-end smoke (live sidecar on a scratch workspace + spare port + fixed token) confirmed every endpoint
is honest: the digest headline reported a real move with its confidence and reading count; `explain` offered a
`strong/verified` experiment cause *only* when one was recorded in-window and said "no cause is offered rather
than one invented" otherwise; `portfolio` rendered a business with no reading as `null` (not `0`) and did not
sum rates; `route` refused `vision`/`minContext` with `422` and a `considered` count; `price` returned `400`
when no token count was supplied, never assuming one; `models`/`costs`/`signals` all returned truthful
payloads.

A real bug fixed by the engine test: the original "strong confidence" fixture had all readings *inside* the
30-day window, so `change` took the short-history branch and graded `weak` — the test was asserting the wrong
thing. The fixture now spans >30 days so the comparison is a matched period and `strong` is the honest grade.

---

## 8. Files

```
sidecar/intelligence-engine.js           (new)
sidecar/model-router.js                  (new)
sidecar/ai-cost-optimizer.js             (new)
sidecar/intelligence-routes.js           (new)
frontend/app/businessintelligence.js     (new)
frontend/app/windows/intelligence.js     (new)
frontend/css/businessintelligence.css    (new)
frontend/app/glossary.js                 (intelligence console terms)
frontend/index.html                      (stylesheet · dock item · 2 scripts)
sidecar/index.js                         (requires · engine · router · optimizer · warmModelCatalog · 8 route rows)
shared/events.js                         (+1: intelligence.model.routed)
test/fixtures/events-contract.snapshot.json  (+14 / −0)
test/fast.list                           (+5)
test/intelligence-engine.test.js         (new)
test/model-router.test.js                (new)
test/ai-cost-optimizer.test.js           (new)
test/intelligence-routes.test.js         (new)
test/businessintelligence.test.js        (new)
docs/PHASE7-INTELLIGENCE.md              (this file)
```

---

## 9. Next

**Phase 8 — Hardening**: the security, audit, and resilience pass across the whole Business OS — pinning down
the gates, the recovery story, and the release surface now that all seven capability phases are built.
