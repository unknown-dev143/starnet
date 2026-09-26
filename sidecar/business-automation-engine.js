/* sidecar/business-automation-engine.js — §12's "WHEN X HAPPENS → DO Y" executor (Business OS Phase 5).

   The store (business-automation-store.js) holds the RULES. This file holds the DRIVER: it is what turns a
   bus event into zero or more runs, dispatches each run's actions, and decides which of them a human has to
   approve first.

   THE TRIGGER SEAM. §12's "X" is a shared/events.js event, and the frozen bus is already the one place
   every business mutation announces itself (sidecar/index.js `chanBus` → `sse.broadcast`, wrapped by
   `chanEmit`). So the engine does not poll, watch a database, or invent a second notification channel: it
   is handed every emitted event and looks up the rules that listen for it. index.js wires that fan-out.
   Keeping the fan-out in index.js (rather than subscribing here) is why this file has no bus of its own
   and is directly unit-testable with a plain function for `emit`.

   FOUR GUARDS THAT EXIST BECAUSE AN AUTOMATION IS A FEEDBACK LOOP:
     1. DEPTH. An automation's own effects are emitted back onto the bus, so automation A can trigger
        automation B (a real feature — "a contact joined → open a task → assign it"). Left alone that is an
        infinite loop. Every event therefore carries a depth, an engine-emitted event is depth+1, and
        MAX_DEPTH bounds the chain. Past the bound the event is dropped, not queued.
     2. PASS BUDGET. Depth alone does not bound the WORK: at one depth there can be (rules × actions)
        events, each matching many rules, so the product is a storm. A "pass" is one top-level event plus
        everything it cascaded, and MAX_RUNS_PER_PASS caps the total runs a pass may execute. When it is
        spent the rest of the queue is dropped and reported, so a mis-wired automation is a bounded,
        VISIBLE event instead of a wedged event loop.
     3. COOLDOWN. A chatty trigger (a metric reading, a logged interaction) can arrive hundreds of times a
        minute. Each rule has a cooldown, enforced by the store's canFire(); a rule inside its cooldown is
        SKIPPED, and the skip is counted so the console can say why nothing happened.
     4. FAILURE THRESHOLD. The store auto-disables a rule after FAILURE_THRESHOLD consecutive failed runs.
        The engine reports that on the bus and in the activity log instead of letting an automation go
        quietly dead — an automation that stopped working and did not say so is worse than one that never
        existed.

   P6, STRUCTURALLY. A run's businessId comes from the TRIGGER PAYLOAD, never from the caller, and every
   store call is made with that businessId. An automation therefore cannot act on another venture, even if
   someone hand-edits a rule file, because the engine has no path that passes a second businessId.

   §19 E-STOP. halt() stops the hub: the queue is dropped, no rule fires, and any request that would have
   become a pending approval is refused. It is NOT a permanent disable — the rules keep their definitions
   and resume() lifts it — but resuming is a deliberate human act, which is what §19 asks for.

   PURE-ish: every store and the clock and the emit sink are injected. No IO of its own. UMD. */

'use strict';
(function (root, factory) {
  const Autom = (typeof module !== 'undefined' && module.exports)
    ? require('./business-automation-store.js')
    : ((root.SK && root.SK.businessAutomationStore) || null);
  const permsMod = (typeof module !== 'undefined' && module.exports)
    ? require('./business-permissions.js')
    : ((root.SK && root.SK.businessPermissions) || null);
  const EV = (typeof module !== 'undefined' && module.exports)
    ? require('../shared/events.js')
    : ((root.SK && root.SK.events) || null);
  /* The inactive-stage list comes from the store that OWNS the lifecycle, not a copy here — the gate below
     and index.js's work-order admission must agree about when a business is standing down. */
  const BIZ = (typeof module !== 'undefined' && module.exports)
    ? require('./businesses-store.js')
    : ((root.SK && root.SK.businessesStore) || null);
  const api = factory(Autom, permsMod, EV, BIZ);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).businessAutomationEngine = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Autom, P, EV, BIZ) {
  'use strict';

  const INACTIVE_STAGES = (BIZ && BIZ.INACTIVE_STAGES) || ['paused', 'winding-down', 'archived'];

  const MAX_DEPTH = 3;                  // how far a chain of automations may cascade
  const MAX_RULES_PER_EVENT = 25;       // a storm guard: one event cannot fan out without bound
  /* THE PASS BUDGET — the bound that actually makes a cascade safe. MAX_DEPTH alone does not: at depth 1
     there can be (rules × actions) events, each matching up to MAX_RULES_PER_EVENT rules, so the product
     is a storm. A "pass" is one top-level event plus everything it cascaded; this caps the TOTAL runs a
     pass may execute. When it is exhausted the remaining queue is DROPPED and the pass reports it, so a
     mis-wired automation is a bounded, visible event rather than a wedged event loop. */
  const MAX_RUNS_PER_PASS = 100;
  const MAX_ID = 120;
  const MAX_TEXT = 2000;

  // §13's own wording, for the approval block's `what`.
  const TIER_NOTE = (P && P.TIER_NOTES) || { safe: 'runs automatically', review: 'needs your approval', restricted: 'cannot run without explicit authorization and safeguards' };

  function str(v, cap) { return (v == null ? '' : String(v)).slice(0, cap); }
  function clip(v, cap) { const s = str(v, cap == null ? MAX_TEXT : cap); return s.length >= (cap == null ? MAX_TEXT : cap) ? s + '…' : s; }

  function makeBusinessAutomationEngine(deps) {
    deps = deps || {};
    const automation = deps.automation;
    const approvals = deps.approvals;
    const permissions = deps.permissions || P;
    const activity = deps.activity || null;
    const businesses = deps.businesses || null;
    // the action targets. Each is optional: an action whose target store was not supplied fails its run
    // with a reason instead of silently doing nothing (a no-op "success" would be a lie).
    const tasks = deps.tasks || null;
    const crm = deps.crm || null;
    const finance = deps.finance || null;
    const metrics = deps.metrics || null;
    const projects = deps.projects || null;
    const documents = deps.documents || null;
    const content = deps.content || null;   // only the §17 publish action needs it, and only on approve()
    /* THE OUTBOUND RAIL (Phase 8 follow-up): `send_external` used to have NO executor at all — approving it
       recorded the authorization and reported `delivered:false`, which was honest but meant automation could
       never reach outside the station. A rail is now INJECTED (`outbound.send(...)`), never hardcoded: the
       host passes the same transport the cron notifier uses (channels/telegram.js), so this module stays
       ambient-IO-free and unit-testable with a plain fake. Absent rail → the old honest non-delivery. */
    const outbound = (deps.outbound && typeof deps.outbound.send === 'function') ? deps.outbound : null;

    const emit = typeof deps.emit === 'function' ? deps.emit : null;
    const now = typeof deps.now === 'function' ? deps.now : (() => null);
    const log = typeof deps.log === 'function' ? deps.log : null;

    if (!automation) throw new Error('business-automation-engine.js requires { automation }');
    if (!approvals) throw new Error('business-automation-engine.js requires { approvals }');
    if (!EV) throw new Error('business-automation-engine.js requires shared/events.js');

    // ---- state -------------------------------------------------------------------------------------
    let halted = !!deps.halted;
    const queue = [];
    let executing = false;
    let pendingDepth = 0;               // read by handleEvent; set while the engine is emitting
    const counters = {
      eventsSeen: 0, eventsMatched: 0, ran: 0, skippedHalted: 0, skippedPaused: 0, skippedMissing: 0,
      skippedCooldown: 0, skippedDepth: 0, skippedStorm: 0, stormStopped: 0,
      approvalsRequested: 0, autoDisabled: 0, failures: 0, actionsRun: 0, cascaded: 0
    };

    // ---- small helpers -----------------------------------------------------------------------------
    function emitSafe(name, payload) {
      if (!emit) return null;
      try { emit(name, payload); return null; } catch (e) { return e; }
    }
    /* An engine emission is what makes a cascade possible, so it is the ONE place that raises the depth.
       Synchronous by construction: chanEmit fans out to handleEvent before emit() returns. */
    function emitAt(depth, name, payload) {
      const prev = pendingDepth;
      pendingDepth = depth + 1;
      try { return emitSafe(name, payload); }
      finally { pendingDepth = prev; }
    }
    function audit(businessId, row) {
      if (!activity) return null;
      try { activity.append(businessId, row); return null; } catch (e) { return e; }
    }
    /* A log sink must never break a run — but "never break" is not "never noticed". A throwing sink is
       COUNTED (logErrors, surfaced in stats()) rather than swallowed into an empty catch, so a broken log
       is visible instead of silently absent. */
    let logErrors = 0;
    function note(kind, detail) {
      if (!log) return;
      try { log({ kind: kind, detail: detail }); }
      catch (e) { logErrors++; }
    }
    function tierOf(actionId) {
      const a = Autom.actionById(actionId);
      if (!a) return 'restricted';                     // fail-closed, same floor as business-permissions
      const c = permissions ? permissions.classify(a.perm) : null;
      return c && c.ok ? c.tier : 'restricted';
    }
    function businessGate(biz) {
      if (!businesses) return { ok: true };
      if (!businesses.has(biz)) return { ok: false, why: 'missing' };
      const b = businesses.get(biz);
      /* A business that is not operating does not run scheduled work. The list lives in the store (single
         source of truth) so this gate and index.js's work-order admission cannot drift apart. `why` names
         the actual stage — "paused" and "winding-down" are different reasons to stand down. */
      if (b && INACTIVE_STAGES.indexOf(b.stage) >= 0) return { ok: false, why: b.stage };
      return { ok: true };
    }

    // ---- the queue ---------------------------------------------------------------------------------
    function enqueue(job) {
      if (job.depth > MAX_DEPTH) { counters.skippedDepth++; return false; }
      queue.push(job);
      return true;
    }
    /* Drain the queue. Re-entrant calls (from an event the engine itself emitted) return immediately and
       let the OUTER loop pick their job up, so a cascade runs breadth-first and the depth bound is real
       rather than a recursion depth limit. The loop is also where the PASS BUDGET is spent — see
       MAX_RUNS_PER_PASS for why a depth bound alone is not enough. */
    function drain() {
      if (executing) return { ok: true, ran: 0, results: [], dropped: 0 };
      executing = true;
      const results = [];
      let budget = MAX_RUNS_PER_PASS;
      let dropped = 0;
      let exhausted = false;
      try {
        while (queue.length) {
          if (budget <= 0) { exhausted = true; break; }
          const job = queue.shift();
          let out;
          try { out = runEvent(job, budget); }
          catch (e) { note('run-failed', { event: job.name, message: e && e.message }); continue; }
          budget -= out.length;
          for (const r of out) results.push(r);
        }
      } finally {
        if (exhausted || (budget <= 0 && queue.length)) {
          dropped = queue.length;
          queue.length = 0;
          counters.stormStopped++;
          note('pass-budget-exhausted', { runs: results.length, dropped: dropped, limit: MAX_RUNS_PER_PASS });
        }
        executing = false;
      }
      return { ok: true, ran: results.length, results: results, dropped: dropped };
    }

    // Every enabled rule of this business listening for this event, minus the ones that may not fire yet.
    // `budget` is the runs this pass may still afford, so one event cannot spend past it.
    function runEvent(job, budget) {
      const gate = businessGate(job.businessId);
      if (!gate.ok) {
        if (gate.why === 'paused') counters.skippedPaused++; else counters.skippedMissing++;
        return [];
      }
      const rules = automation.matching(job.businessId, job.name);
      if (!rules.length) return [];
      counters.eventsMatched++;
      // a real cascade = an event the engine's own actions put on the bus that some rule actually listens
      // for. Counting it here (rather than on every depth>0 event) keeps the number honest: the engine's
      // own telemetry events carry a depth too, and they are not cascades.
      if (job.depth > 0) counters.cascaded++;
      const out = [];
      let used = 0;
      const cap = Math.max(0, Math.min(MAX_RULES_PER_EVENT, Number.isFinite(budget) ? budget : MAX_RULES_PER_EVENT));
      for (const rule of rules) {
        if (used >= cap) { counters.skippedStorm++; continue; }
        const can = automation.canFire(rule.id, now());
        if (!can.ok) { counters.skippedCooldown++; continue; }
        const ev = Autom.evaluate(rule.conditions, job.payload);
        if (!ev.pass) continue;                        // conditions are a filter, not a failure
        used++;
        out.push(runRule(rule, job, ev));
      }
      return out;
    }

    /* runRule — one fire of one rule. Returns the run record it wrote. Never throws: every action's
       outcome is captured, because one failing action must not abandon the rest of the run. */
    function runRule(rule, job, evaluation) {
      const at = now();
      const actions = [];
      let ok = true;

      for (const spec of rule.actions) {
        const tier = tierOf(spec.action);
        const resolved = Autom.resolveParams(spec.action, spec.params, job.payload);
        if (!resolved.ok) { actions.push({ action: spec.action, tier: tier, status: 'failed', ok: false, reason: resolved.reason }); ok = false; continue; }

        if (tier === 'restricted') {
          actions.push({ action: spec.action, tier: tier, status: 'skipped', ok: false, reason: 'a restricted action is never run by an automation — it needs explicit authorization and safeguards (§13)' });
          ok = false;
          continue;
        }
        if (tier === 'review') {
          const r = requestApproval(rule, spec, resolved.params, job);
          if (!r.ok) ok = false;
          actions.push({ action: spec.action, tier: tier, status: r.ok ? 'pending-approval' : 'failed', ok: r.ok, reason: r.ok ? '' : r.reason });
          continue;
        }
        const r = executeAction(job.businessId, spec.action, resolved.params, job.depth);
        if (!r.ok) ok = false;
        actions.push({ action: spec.action, tier: tier, status: r.ok ? 'executed' : 'failed', ok: r.ok, reason: r.ok ? '' : r.reason });
      }

      const reason = ok ? '' : (actions.filter(a => !a.ok).map(a => a.reason).filter(Boolean)[0] || 'one or more actions failed');
      const rec = automation.recordRun(rule.id, {
        at: at, event: job.name, depth: job.depth, ok: ok, reason: reason, actions: actions
      });
      if (!rec.ok) { note('run-not-recorded', { rule: rule.id, reason: rec.reason }); return { ruleId: rule.id, ok: false, reason: rec.reason, actions: actions }; }

      counters.ran++;
      for (const a of actions) if (a.status === 'executed') counters.actionsRun++;
      if (!ok) counters.failures++;

      emitAt(job.depth, 'business.automation.ran', {
        businessId: job.businessId, automationId: rule.id, trigger: job.name,
        ok: ok, actions: actions.length
      });
      if (rec.autoDisabled) {
        counters.autoDisabled++;
        emitAt(job.depth, 'business.automation.disabled', {
          businessId: job.businessId, automationId: rule.id, name: rule.name,
          reason: rec.automation.disabledReason
        });
        audit(job.businessId, {
          actor: { kind: 'system', id: '', name: '' },
          action: 'Switched off automation "' + rule.name + '"',
          reason: rec.automation.disabledReason, result: 'error', approval: 'not-required'
        });
      }
      if (!ok) {
        audit(job.businessId, {
          actor: { kind: 'system', id: '', name: '' },
          action: 'Automation "' + rule.name + '" failed',
          reason: reason, result: 'error', approval: 'not-required'
        });
      }
      return { ruleId: rule.id, ok: ok, reason: reason, actions: actions, autoDisabled: !!rec.autoDisabled, evaluation: evaluation };
    }

    /* requestApproval — §13. A review-tier action does NOT run. It becomes a row in the approval queue
       with a §26 block whose evidence is the trigger event itself: the event is a recorded fact, so the
       block is justified rather than decorative, and the approvals store refuses it if it is not. */
    function requestApproval(rule, spec, params, job) {
      const a = Autom.actionById(spec.action);
      const permId = a ? a.perm : '';
      const evidence = [
        { text: 'This automation fired: ' + job.name, evidence: 'verified', source: 'event:' + job.name },
        { text: 'Trigger payload: ' + clip(JSON.stringify(job.payload), 900), evidence: 'verified', source: 'event:' + job.name }
      ];
      const what = (a ? a.label : spec.action) + ' — ' + clip(JSON.stringify(params), 400);
      const why = 'Automation "' + rule.name + '" is set to fire on ' + job.name + ', and this action is ' + (a ? a.perm : '') + '-tier: ' + TIER_NOTE.review + ' (§13).';
      const r = approvals.create(job.businessId, {
        automationId: rule.id,
        runId: '',
        action: permId,
        actionId: spec.action,
        tier: 'review',
        what: what,
        why: why,
        evidence: evidence,
        risk: a ? a.risk : 'medium',
        effect: clip(JSON.stringify(params), 900),
        params: params
      });
      if (!r.ok) return { ok: false, reason: r.reason };
      counters.approvalsRequested++;
      emitAt(job.depth, 'business.approval.requested', {
        businessId: job.businessId, approvalId: r.approval.id, automationId: rule.id,
        action: spec.action, tier: 'review'
      });
      audit(job.businessId, {
        actor: { kind: 'system', id: '', name: '' },
        action: 'Requested approval to ' + (a ? a.label.toLowerCase() : spec.action),
        reason: 'automation "' + rule.name + '"', result: 'pending', approval: 'required'
      });
      return { ok: true, approval: r.approval };
    }

    /* executeAction — run ONE action against the store that owns it, then announce the domain fact on the
       bus. The engine emits the domain event itself (task.created, business.contact.added, …) rather than
       routing through a route handler, because a record an automation created MUST be visible to every
       listener exactly like a hand-made one. That emission is also what a cascade rides on. */
    function executeAction(businessId, actionId, params, depth) {
      const a = Autom.actionById(actionId);
      if (!a) return { ok: false, reason: 'unknown action: ' + actionId };
      const d = Number.isFinite(depth) ? depth : 0;
      let r;
      try {
        switch (actionId) {
          case 'notify': {
            const text = str(params.text, MAX_TEXT);
            audit(businessId, { actor: { kind: 'system', id: '', name: '' }, action: text, reason: 'automation', result: 'ok', approval: 'not-required' });
            emitAt(d, 'business.automation.notified', { businessId: businessId, automationId: '', text: text });
            return { ok: true };
          }
          case 'create_task': {
            if (!tasks) return { ok: false, reason: 'the task store is not available on this station' };
            // the THIRD argument is provenance, passed out-of-band so a request body can never claim it.
            r = tasks.create(businessId, { title: params.title, priority: params.priority, projectId: params.projectId, detail: params.detail }, 'automation');
            if (!r.ok) return { ok: false, reason: r.reason };
            emitAt(d, 'task.created', { businessId: businessId, taskId: r.task.id, title: r.task.title, status: r.task.status, priority: r.task.priority, origin: r.task.origin });
            return { ok: true, ref: r.task.id };
          }
          case 'create_project': {
            if (!projects) return { ok: false, reason: 'the project store is not available on this station' };
            r = projects.create(businessId, { name: params.name, goal: params.goal });
            if (!r.ok) return { ok: false, reason: r.reason };
            emitAt(d, 'business.project.created', { businessId: businessId, projectId: r.project.id, name: r.project.name });
            return { ok: true, ref: r.project.id };
          }
          case 'record_metric': {
            if (!metrics) return { ok: false, reason: 'the metrics store is not available on this station' };
            r = metrics.record(businessId, { metric: params.metric, value: params.value, source: params.source, evidence: params.evidence, note: params.note });
            if (!r.ok) return { ok: false, reason: r.reason };
            emitAt(d, 'business.metric.recorded', { businessId: businessId, readingId: r.reading.id, metric: r.reading.metric, unit: r.reading.unit });
            return { ok: true, ref: r.reading.id };
          }
          case 'crm_contact': {
            if (!crm) return { ok: false, reason: 'the CRM store is not available on this station' };
            r = crm.addContact(businessId, { name: params.name, stage: params.stage, email: params.email, org: params.org });
            if (!r.ok) return { ok: false, reason: r.reason };
            emitAt(d, 'business.contact.added', { businessId: businessId, contactId: r.contact.id, name: r.contact.name, stage: r.contact.stage });
            return { ok: true, ref: r.contact.id };
          }
          case 'log_interaction': {
            if (!crm) return { ok: false, reason: 'the CRM store is not available on this station' };
            r = crm.logInteraction(businessId, params.contactId, { kind: params.kind, summary: params.summary });
            if (!r.ok) return { ok: false, reason: r.reason };
            emitAt(d, 'business.contact.interaction', { businessId: businessId, contactId: params.contactId, kind: params.kind });
            return { ok: true, ref: params.contactId };
          }
          case 'record_finance': {
            if (!finance) return { ok: false, reason: 'the finance store is not available on this station' };
            r = finance.create(businessId, {
              kind: params.kind, amount: params.amount, currency: params.currency, category: params.category,
              provenance: params.provenance, basis: params.basis, source: params.source, note: params.note
            });
            if (!r.ok) return { ok: false, reason: r.reason };
            emitAt(d, 'business.finance.recorded', {
              businessId: businessId, transactionId: r.transaction.id, kind: r.transaction.kind,
              amount: r.transaction.amount, currency: r.transaction.currency, provenance: r.transaction.provenance
            });
            return { ok: true, ref: r.transaction.id };
          }
          case 'draft_document': {
            if (!documents) return { ok: false, reason: 'the document store is not available on this station' };
            r = documents.create(businessId, { type: params.type, title: params.title, body: params.body });
            if (!r.ok) return { ok: false, reason: r.reason };
            emitAt(d, 'business.document.created', { businessId: businessId, documentId: r.document.id, type: r.document.type });
            return { ok: true, ref: r.document.id };
          }
          /* PUBLISH — the one review-tier action this station CAN perform. §17 refuses any actor but
             'user' at a publish stage, and an approval IS the user's authorization, so approve() passes
             actor {kind:'user'}. That is not a loophole: it is the same human gate, reached through the
             §13 queue instead of a click in the content pane. */
          case 'publish_content': {
            if (!content) return { ok: false, reason: 'the content store is not available on this station' };
            const before = content.piece(params.pieceId);
            if (!before) return { ok: false, reason: 'unknown content piece: ' + params.pieceId };
            if (before.businessId !== businessId) {
              return { ok: false, reason: 'content piece ' + params.pieceId + ' belongs to business "' + before.businessId + '" — cross-business references are refused (P6)' };
            }
            r = content.advance(params.pieceId, 'publish', { kind: 'user' });
            if (!r.ok) return { ok: false, reason: r.reason };
            emitAt(d, 'business.content.advanced', {
              businessId: businessId, pieceId: params.pieceId, from: before.stage, to: 'publish', by: 'user'
            });
            return { ok: true, ref: params.pieceId };
          }
          /* §13's external actions. `send_external` now has a REAL rail when the host injects one — it goes
             through the transport the cron notifier uses. Every prior guarantee is kept:
               · it is `review`-tier, so it only ever runs from approve(), never from an event;
               · no rail injected → the old honest non-delivery (authorization recorded, `delivered:false`);
               · a rail that reports failure is reported as NOT delivered — never a phantom success (P2/P7);
               · the reason string states what actually happened, in words.
             `spend_money` deliberately stays rail-less: there is no payment rail, and inventing one would be
             the single most dangerous thing this module could do. It keeps the record-the-authorization path. */
          case 'send_external': {
            if (!outbound) {
              return {
                ok: true, delivered: false, external: true,
                reason: 'your authorization is recorded, but this station has no outbound rail — nothing left the station'
              };
            }
            if (!params.to) return { ok: false, reason: 'send_external needs a destination ("to")' };
            /* The catalog declares required: ['to','subject','body'] — resolveParams only forwards DECLARED
               fields, so read exactly those (reading an undeclared `text` would always be undefined). */
            const subject = params.subject != null ? String(params.subject) : '';
            const body = params.body != null ? String(params.body) : '';
            if (!body.trim()) return { ok: false, reason: 'send_external needs a non-empty "body"' };
            const text = subject ? (subject + '\n\n' + body) : body;
            let sent;
            try {
              sent = outbound.send({ to: String(params.to), text: text, subject: subject, businessId: businessId, channel: params.channel });
            } catch (e) {
              return { ok: false, reason: 'the outbound rail threw: ' + ((e && e.message) || 'unknown error') };
            }
            /* Transports resolve a SendResult; a rejection or `ok:false` is a FAILED delivery, not a success.
               Awaiting here keeps approve() synchronous-from-the-caller's-view via the promise it returns. */
            return Promise.resolve(sent).then(function (r) {
              if (r && r.ok === false) {
                return { ok: false, reason: 'the outbound rail could not deliver: ' + String((r && r.error) || 'send failed') };
              }
              return { ok: true, delivered: true, external: true, to: String(params.to), ref: (r && r.ref) || null };
            }, function (e) {
              return { ok: false, reason: 'the outbound rail rejected: ' + ((e && e.message) || 'send failed') };
            });
          }
          case 'spend_money': {
            /* Still rail-less BY DESIGN — there is no payment rail on this station, and this is the one
               action where a mistake is unrecoverable. The authorization is the deliverable. */
            return {
              ok: true, delivered: false, external: true,
              reason: 'your authorization is recorded, but this station has no payment rail — nothing left the station'
            };
          }
          default:
            return { ok: false, reason: 'action "' + actionId + '" has no executor' };
        }
      } catch (e) {
        return { ok: false, reason: 'action threw: ' + ((e && e.message) || 'unknown error') };
      }
    }

    // ---- the bus entry point -----------------------------------------------------------------------
    function handleEvent(name, payload) {
      const ev = str(name, MAX_ID);
      const depth = pendingDepth;                 // read, then clear: only an engine emission sets this
      pendingDepth = 0;
      counters.eventsSeen++;
      if (halted) { counters.skippedHalted++; return { ok: false, reason: 'the automation hub is halted (§19 E-STOP) — resume it to run automations' }; }
      if (!EV.isKnown(ev)) return { ok: false, reason: 'unknown event: ' + ev };
      const p = (payload && typeof payload === 'object') ? payload : null;
      if (!p) return { ok: false, reason: 'an event payload is required' };
      const biz = str(p.businessId, MAX_ID).trim();
      if (!biz) return { ok: false, reason: 'this event carries no businessId, so no business automation can be scoped to it (P6)' };
      if (!enqueue({ name: ev, payload: p, businessId: biz, depth: depth })) {
        return { ok: false, reason: 'cascade depth ' + depth + ' exceeds the limit of ' + MAX_DEPTH + ' — dropped' };
      }
      return drain();
    }

    /* testRun — a DRY RUN. Evaluates the conditions and resolves the params against a payload the caller
       supplies, and reports what WOULD happen. Writes nothing: no run row, no store mutation, no event.
       This is the difference between "test" and "fire", and the console needs it. */
    function testRun(ruleId, payload) {
      const rule = automation.get(ruleId);
      if (!rule) return { ok: false, reason: 'unknown automation: ' + ruleId };
      const p = (payload && typeof payload === 'object') ? payload : {};
      const ev = Autom.evaluate(rule.conditions, p);
      const actions = rule.actions.map(spec => {
        const tier = tierOf(spec.action);
        const resolved = Autom.resolveParams(spec.action, spec.params, p);
        if (!resolved.ok) return { action: spec.action, tier: tier, status: 'would-fail', reason: resolved.reason, params: {} };
        if (tier === 'restricted') return { action: spec.action, tier: tier, status: 'would-fail', reason: 'restricted tier — an automation never runs one', params: resolved.params };
        if (tier === 'review') return { action: spec.action, tier: tier, status: 'would-ask-approval', reason: '', params: resolved.params };
        return { action: spec.action, tier: tier, status: 'would-run', reason: '', params: resolved.params };
      });
      return {
        ok: true, automationId: rule.id, trigger: rule.trigger, enabled: rule.enabled,
        fires: ev.pass && rule.enabled, conditions: ev, actions: actions
      };
    }

    // ---- the §13 decision path ---------------------------------------------------------------------
    /* approve — settle a pending request and THEN run the action. The order matters: the store's decide()
       refuses a non-pending row, so the pending → approved transition happens exactly once and a
       double-click cannot run the action twice. */
    function approve(id, by) {
      const row = approvals.get(id);
      if (!row) return { ok: false, reason: 'unknown approval: ' + id };
      const d = approvals.decide(id, { decision: 'approve', by: by || 'user', reason: '' });
      if (!d.ok) return d;
      emitAt(0, 'business.approval.decided', {
        businessId: row.businessId, approvalId: id, action: row.automationAction || row.action, tier: row.tier, decision: 'approved'
      });
      audit(row.businessId, {
        actor: { kind: 'user', id: '', name: str(by, MAX_ID) }, action: 'Approved: ' + row.what,
        reason: 'automation approval', result: 'ok', approval: 'granted'
      });
      const r = executeAction(row.businessId, row.automationAction, row.params, 0);
      /* executeAction is synchronous for every LOCAL executor, but `send_external` against an injected rail
         resolves a Promise. Settle both here so the audit trail says the same thing either way — a Promise
         that fails is a failure (never a silent success), and a delivered send is recorded as delivered. */
      if (r && typeof r.then === 'function') {
        return Promise.resolve(r).then(function (res) { return finishApprove(row, d, id, res); });
      }
      return finishApprove(row, d, id, r);
    }

    /* finishApprove — the audit + drain tail shared by the sync and async paths, so they cannot drift. */
    function finishApprove(row, d, id, r) {
      if (!r.ok) {
        audit(row.businessId, {
          actor: { kind: 'system', id: '', name: '' }, action: 'Approved action failed: ' + row.what,
          reason: r.reason, result: 'error', approval: 'granted'
        });
      } else if (r.delivered === false) {
        // §13's external actions: the authorization is the deliverable. Say so, in the log, in words.
        audit(row.businessId, {
          actor: { kind: 'system', id: '', name: '' }, action: 'Approved (not delivered): ' + row.what,
          reason: r.reason, result: 'ok', approval: 'granted'
        });
      } else if (r.delivered === true) {
        // the outbound rail actually delivered — record THAT, distinctly from "authorized but not sent".
        audit(row.businessId, {
          actor: { kind: 'system', id: '', name: '' }, action: 'Approved and delivered: ' + row.what,
          reason: r.reason || ('delivered to ' + (r.to || 'the outbound rail')), result: 'ok', approval: 'granted'
        });
      }
      // executeAction emitted a domain event, and handleEvent drained whatever that cascaded — the queue
      // is empty here by construction. drain() is a no-op safety net, not the cascade path.
      drain();
      return { ok: true, approval: d.approval, executed: r };
    }

    function reject(id, reason, by) {
      const row = approvals.get(id);
      if (!row) return { ok: false, reason: 'unknown approval: ' + id };
      const d = approvals.decide(id, { decision: 'reject', by: by || 'user', reason: reason });
      if (!d.ok) return d;
      emitAt(0, 'business.approval.decided', {
        businessId: row.businessId, approvalId: id, action: row.automationAction || row.action, tier: row.tier, decision: 'rejected'
      });
      audit(row.businessId, {
        actor: { kind: 'user', id: '', name: str(by, MAX_ID) }, action: 'Rejected: ' + row.what,
        reason: str(reason, MAX_TEXT) || 'no reason given', result: 'ok', approval: 'denied'
      });
      return { ok: true, approval: d.approval };
    }

    // ---- §19 controls ------------------------------------------------------------------------------
    function halt() {
      halted = true;
      const dropped = queue.length;
      queue.length = 0;
      return { halted: true, dropped: dropped };
    }
    function resume() {
      halted = false;
      return { halted: false };
    }
    function isHalted() { return halted; }
    // boot restore: the durable stand-down survives a restart, exactly like cronHalted / loopsHalted.
    function restoreHalted(v) { halted = !!v; return { halted: halted }; }

    function stats() {
      return {
        halted: halted, queued: queue.length, maxDepth: MAX_DEPTH,
        maxRunsPerPass: MAX_RUNS_PER_PASS, maxRulesPerEvent: MAX_RULES_PER_EVENT,
        eventsSeen: counters.eventsSeen, eventsMatched: counters.eventsMatched,
        ran: counters.ran, actionsRun: counters.actionsRun,
        cascaded: counters.cascaded, approvalsRequested: counters.approvalsRequested,
        autoDisabled: counters.autoDisabled, failures: counters.failures,
        skippedHalted: counters.skippedHalted, skippedPaused: counters.skippedPaused,
        skippedMissing: counters.skippedMissing, skippedCooldown: counters.skippedCooldown,
        skippedDepth: counters.skippedDepth, skippedStorm: counters.skippedStorm,
        stormStopped: counters.stormStopped, logErrors: logErrors
      };
    }

    return {
      MAX_DEPTH, MAX_RULES_PER_EVENT, MAX_RUNS_PER_PASS,
      handleEvent, testRun, approve, reject,
      halt, resume, isHalted, restoreHalted, stats,
      // exposed for the route module + tests: the same execution path approve() uses.
      executeAction, tierOf
    };
  }

  return { makeBusinessAutomationEngine, MAX_DEPTH, MAX_RULES_PER_EVENT, MAX_RUNS_PER_PASS };
});
