/* sidecar/business-automation-store.js — §12 THE AUTOMATION HUB (Business OS Phase 5).

   §12 asks for "user-authored workflows of the form WHEN X HAPPENS → DO Y", and lists what every one of
   them needs: trigger · conditions · actions · permissions · logs · enable/disable switch · failure
   handling. This module is the RULE CATALOGUE and the LOG; the engine that actually fires rules lives in
   business-automation-engine.js, and the §13 approval queue lives in business-approvals-store.js.

   WHY THIS IS NOT cron.js / loopjob-store.js (read both headers before touching this one). The station
   already has three flavours of standing automation and none of them is this one:
     · cron.js        — WHEN. A SCHEDULE fires a run. Station-global, no conditions, no actions: the "Y" is
                        "run this agent with this prompt".
     · loopjob-store  — UNTIL. Repeat a run until a goal is met or the streak breaks. Same shape.
     · hooks.js       — a shell hook on a lifecycle beat. Not user-authored, not business-scoped, no actions.
   This store is EVENT-DRIVEN and BUSINESS-SCOPED: the "X" is a frozen contract event (§12's "when X
   happens"), the "Y" is a closed set of BUSINESS RECORD operations, and both ends are owned by one venture
   so §19's per-business pause and §13's per-action tiers apply. Merging it into cron.js would put business
   vocabulary and a businessId column into the station's scheduler, and the two have different authorities:
   a routine is armed by the Commander for the whole station, an automation belongs to a business.

   THE THREE CLOSED VOCABULARIES, and why each is closed rather than free-form:
     TRIGGER_EVENTS     — a curated subset of shared/events.js. NOT every known event: `business.activity`
                          mirrors every other business event, so an automation on it would double-fire with
                          the specific one; and any event whose schema does not declare `businessId` cannot
                          be scoped to a venture at all (P6). A test asserts BOTH properties against the
                          live contract, so this list can never drift into naming a dead or unscopable event.
     CONDITION_OPS      — 11 predicates. A free-form expression language would be a second interpreter to
                          secure and a way to write a condition that silently never matches.
     AUTOMATION_ACTIONS — each action names the §13 PERMISSION ACTION it performs (business-permissions.js).
                          The tier is therefore DERIVED, never declared twice: a rule cannot claim to be
                          safe while performing a review-tier action, because there is no field in which to
                          claim it. That is the whole design of this file.

   FAILURE HANDLING (§12) IS NOT A TRY/CATCH. A rule that throws on every fire is a rule that spams the log
   forever. So every run outcome goes through noteOutcome(): a failure increments the rule's
   `consecutiveFailures`, a success resets it, and at FAILURE_THRESHOLD the rule AUTO-DISABLES itself with
   the reason recorded. Re-enabling is a deliberate human act (setEnabled), which is the honest recovery.

   PURE: no IO, no clock, no env, no rng, no network. `persist` and `now` are injected; ids are a
   deterministic per-business sequence. UMD: `SK.businessAutomationStore` in the browser, module.exports
   under node. Mirrors business-projects-store.js. */
'use strict';
(function (root, factory) {
  const events = (typeof module !== 'undefined' && module.exports)
    ? require('../shared/events.js')
    : (root.SK && root.SK.events);
  const api = factory(events);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).businessAutomationStore = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (events) {
  'use strict';

  const MAX_NAME = 160;
  const MAX_TEXT = 2000;
  const MAX_ID = 120;
  const MAX_CONDITIONS = 8;
  const MAX_ACTIONS = 5;
  const MAX_PARAM_CHARS = 600;             // one interpolated param value
  const DEFAULT_LIMIT = 100;               // rules per business
  const DEFAULT_RUN_LIMIT = 50;            // run-log rows per RULE (bounded ring)
  const FAILURE_THRESHOLD = 5;             // consecutive failures before a rule disables itself
  const DEFAULT_COOLDOWN_MS = 1000;        // a rule may not re-fire faster than this
  const MAX_COOLDOWN_MS = 24 * 60 * 60 * 1000;

  /* ---------------------------------------------------------------------------------------------
     TRIGGER_EVENTS — §12's "when X happens".
     `label`/`note` exist so the UI can render "a new contact joined the CRM" instead of
     `business.contact.added`; a raw event name is not a thing a business owner should have to read.
     `example` is the payload sketch the condition builder shows, so a user writing a condition can see
     which fields actually exist on this trigger instead of guessing a name that will never match.
     --------------------------------------------------------------------------------------------- */
  const TRIGGER_EVENTS = [
    { event: 'business.created', label: 'A business is created', note: 'Fires once, when the venture is founded.', example: { businessId: '', name: '', template: '', stage: '', actor: '' } },
    { event: 'business.updated', label: 'A business profile changes', note: 'Name, stage or template moved. `changed` names which.', example: { businessId: '', name: '', stage: '', changed: [], actor: '' } },
    { event: 'business.paused', label: 'A business is paused', note: 'The per-business E-STOP (§21) was pressed.', example: { businessId: '', name: '', halted: 0, actor: '' } },

    { event: 'opportunity.promoted', label: 'An opportunity becomes a business', note: 'The Maker promoted it; `tasksCreated` is the real count.', example: { opportunityId: '', title: '', businessId: '', tasksCreated: 0 } },

    { event: 'task.created', label: 'A task is created', note: 'Includes tasks a plan materialised.', example: { businessId: '', taskId: '', title: '', status: '', priority: '', origin: '' } },
    { event: 'task.updated', label: 'A task changes', note: '`changed` names the fields that actually moved.', example: { businessId: '', taskId: '', status: '', changed: [] } },
    { event: 'task.deleted', label: 'A task is deleted', note: 'Emitted only after the row is gone.', example: { businessId: '', taskId: '', title: '' } },

    { event: 'agent.hired', label: 'An agent is hired', note: 'A §7 role agent joined the team.', example: { businessId: '', agentId: '', role: '', specialty: '', name: '' } },
    { event: 'agent.updated', label: 'An agent changes', note: 'A pause (§19) rides here as changed:["status"].', example: { businessId: '', agentId: '', role: '', status: '', changed: [] } },
    { event: 'agent.fired', label: 'An agent is let go', note: 'Emitted only after the row is gone.', example: { businessId: '', agentId: '', name: '' } },
    { event: 'agent.assigned', label: 'A task is assigned to an agent', note: 'Both ends are always the same business (P6).', example: { businessId: '', taskId: '', agentId: '', role: '' } },
    { event: 'agent.message', label: 'An agent sends a message', note: 'One agent-to-agent or agent-to-user message.', example: { businessId: '', messageId: '', from: '', to: '', kind: '' } },
    { event: 'business.memory.written', label: 'A memory is recorded', note: '`scope` is one of §9\'s four; `source` is its provenance.', example: { businessId: '', id: '', scope: '', ownerId: '', kind: '', source: '' } },
    { event: 'business.memory.forgotten', label: 'A memory is forgotten', note: '`businessId` is "" for a user-scope entry.', example: { businessId: '', id: '', scope: '', ownerId: '', kind: '' } },

    { event: 'business.project.created', label: 'A project is created', note: 'The §9 project layer.', example: { businessId: '', projectId: '', name: '' } },
    { event: 'business.project.updated', label: 'A project changes', note: 'Status moves ride here.', example: { businessId: '', projectId: '', status: '', changed: [] } },
    { event: 'business.project.removed', label: 'A project is removed', note: 'Emitted only after the row is gone.', example: { businessId: '', projectId: '', name: '' } },

    { event: 'business.finance.recorded', label: 'Money is recorded', note: '`provenance` travels, so an AI estimate is never mistaken for real money.', example: { businessId: '', transactionId: '', kind: '', amount: 0, currency: '', provenance: '' } },
    { event: 'business.finance.removed', label: 'A transaction is removed', note: 'A correction, not a refund.', example: { businessId: '', transactionId: '' } },

    { event: 'business.metric.recorded', label: 'A metric reading is recorded', note: '`unit` travels so a rate and a count render differently.', example: { businessId: '', readingId: '', metric: '', unit: '' } },

    { event: 'business.contact.added', label: 'A contact joins the CRM', note: '§12\'s own example: a new customer → a CRM record.', example: { businessId: '', contactId: '', name: '', stage: '' } },
    { event: 'business.contact.updated', label: 'A contact changes', note: 'A stage move (lead → customer) rides here.', example: { businessId: '', contactId: '', stage: '', changed: [] } },
    { event: 'business.contact.removed', label: 'A contact is removed', note: 'Emitted only after the row is gone.', example: { businessId: '', contactId: '', name: '' } },
    { event: 'business.contact.interaction', label: 'You log a touch with a contact', note: 'An email, call, meeting, purchase or support note.', example: { businessId: '', contactId: '', kind: '' } },

    { event: 'business.content.created', label: 'A content piece is created', note: 'The §17 content factory.', example: { businessId: '', pieceId: '', channel: '' } },
    { event: 'business.content.advanced', label: 'A content piece moves stage', note: '`by` names WHO advanced it — reaching a publish stage needs "user".', example: { businessId: '', pieceId: '', from: '', to: '', by: '' } },
    { event: 'business.content.removed', label: 'A content piece is removed', note: 'Emitted only after the row is gone.', example: { businessId: '', pieceId: '' } },

    { event: 'business.document.created', label: 'A document is generated', note: 'The §15 document generator.', example: { businessId: '', documentId: '', type: '' } },
    { event: 'business.document.updated', label: 'A document changes', note: '`changed` names the fields.', example: { businessId: '', documentId: '', changed: [] } },
    { event: 'business.document.removed', label: 'A document is removed', note: 'Emitted only after the row is gone.', example: { businessId: '', documentId: '' } },

    { event: 'business.knowledge.added', label: 'A knowledge entry is added', note: 'The §15 knowledge center.', example: { businessId: '', entryId: '', kind: '' } },
    { event: 'business.knowledge.forgotten', label: 'A knowledge entry is forgotten', note: 'Emitted only after the row is gone.', example: { businessId: '', entryId: '' } },

    { event: 'business.experiment.opened', label: 'An experiment is opened', note: 'The §14 experiment lab.', example: { businessId: '', experimentId: '' } },
    { event: 'business.experiment.ended', label: 'An experiment ends', note: 'Results are in; no conclusion yet.', example: { businessId: '', experimentId: '' } },
    { event: 'business.experiment.concluded', label: 'An experiment is concluded', note: '`conclusion` is supported / refuted / inconclusive.', example: { businessId: '', experimentId: '', conclusion: '' } }
  ];

  const TRIGGER_IDS = TRIGGER_EVENTS.map(t => t.event);

  /* ---------------------------------------------------------------------------------------------
     CONDITION_OPS — the closed predicate set. Every op is total: it returns a boolean for ANY input
     and never throws. A missing field is `false` for every op except not_exists, and a comparison
     against a non-number is `false` rather than an error — a condition that cannot be evaluated must
     not match, because "unknown" is not "yes".
     --------------------------------------------------------------------------------------------- */
  const CONDITION_OPS = [
    { op: 'eq', label: 'is', needsValue: true, note: 'Strict equality; a number and its string form are NOT equal.' },
    { op: 'neq', label: 'is not', needsValue: true, note: 'The negation of `is`.' },
    { op: 'in', label: 'is one of', needsValue: true, note: 'Value must be a list; membership is strict-or-string-equal.' },
    { op: 'not_in', label: 'is none of', needsValue: true, note: 'The negation of `is one of`.' },
    { op: 'gt', label: 'is greater than', needsValue: true, note: 'Numbers only; a non-number is false, not an error.' },
    { op: 'gte', label: 'is at least', needsValue: true, note: 'Numbers only.' },
    { op: 'lt', label: 'is less than', needsValue: true, note: 'Numbers only.' },
    { op: 'lte', label: 'is at most', needsValue: true, note: 'Numbers only.' },
    { op: 'exists', label: 'is present', needsValue: false, note: 'The field exists and is not null/undefined.' },
    { op: 'not_exists', label: 'is absent', needsValue: false, note: 'The field is missing or null.' },
    { op: 'contains', label: 'contains', needsValue: true, note: 'Text: case-insensitive substring. List: membership. Numbers: false.' }
  ];

  const OP_IDS = CONDITION_OPS.map(o => o.op);

  /* ---------------------------------------------------------------------------------------------
     AUTOMATION_ACTIONS — §12's "do Y", each naming the §13 permission action it performs.
     `perm` is the ONLY place a tier is decided. `risk` is what the §26 approval block reports for a
     review-tier action (safe actions never produce a block, because they never need approval).
     `params` is the closed field set per action; `required` fields must be present and non-empty.
     `executor` is the honesty field: 'local' means this station can actually perform the action
     against one of its own stores, 'none' means it cannot. `send_external` and `spend_money` are
     executor:'none' on purpose — §13 names them as review-tier actions, so the catalogue must carry
     them, but no mail rail or payment rail is wired to the business layer. Approving one records your
     AUTHORIZATION (a real, auditable fact) and says plainly that nothing left the station. Offering
     the action and then silently pretending to have sent something would be a fabrication (P2).
     --------------------------------------------------------------------------------------------- */
  const AUTOMATION_ACTIONS = [
    { id: 'notify', label: 'Notify me', perm: 'report', risk: 'low', executor: 'local',
      required: ['text'], optional: [],
      note: 'Write a line to this business\'s activity log and pulse the console. §12\'s own example.' },
    { id: 'create_task', label: 'Create a task', perm: 'plan', risk: 'low', executor: 'local',
      required: ['title'], optional: ['priority', 'projectId', 'detail'],
      note: '§9 Task & Project Engine. The task belongs to this business.' },
    { id: 'create_project', label: 'Create a project', perm: 'plan', risk: 'low', executor: 'local',
      required: ['name'], optional: ['goal'],
      note: '§9 project layer — a named unit of work.' },
    { id: 'record_metric', label: 'Record a metric reading', perm: 'analyze', risk: 'low', executor: 'local',
      required: ['metric', 'value', 'source', 'evidence'], optional: ['note'],
      note: '§11. Needs a source AND an evidence class (P1) — the metrics store refuses a reading without either.' },
    { id: 'crm_contact', label: 'Add a CRM contact', perm: 'draft', risk: 'low', executor: 'local',
      required: ['name'], optional: ['stage', 'email', 'org'],
      note: '§16 CRM. §12\'s own example: a new customer → a CRM record.' },
    { id: 'log_interaction', label: 'Log a touch with a contact', perm: 'draft', risk: 'low', executor: 'local',
      required: ['contactId', 'kind', 'summary'], optional: [],
      note: '§16. The CRM store refuses it if the contact belongs to another business (P6).' },
    { id: 'record_finance', label: 'Record a transaction', perm: 'draft', risk: 'low', executor: 'local',
      required: ['kind', 'amount', 'currency', 'category', 'provenance'], optional: ['basis', 'source', 'note'],
      note: '§10. Recording bookkeeping is not spending — `spend_money` below is the review-tier one. `provenance` is required and has no default (P2).' },
    { id: 'draft_document', label: 'Draft a document', perm: 'draft', risk: 'low', executor: 'local',
      required: ['type', 'title'], optional: ['body'],
      note: '§15 document generator. A draft is not a publication.' },

    { id: 'send_external', label: 'Send an external message', perm: 'external_comms', risk: 'medium', executor: 'none',
      required: ['to', 'subject', 'body'], optional: [],
      note: '§13 — an important external communication needs your approval. Approving records your authorization; this station has no mail rail, so nothing is delivered by it.' },
    { id: 'publish_content', label: 'Publish a content piece', perm: 'publish_content', risk: 'medium', executor: 'local',
      required: ['pieceId'], optional: [],
      note: '§13 — publishing business content needs your approval. Approving it IS the human authorization §17 demands: the piece advances to "publish" with actor "user".' },
    { id: 'spend_money', label: 'Spend money', perm: 'spend_money', risk: 'high', executor: 'none',
      required: ['amount', 'currency', 'description'], optional: [],
      note: '§13 — spending money needs your approval. Approving records your authorization; this station has no payment rail, so no money moves.' }
  ];

  const ACTION_IDS = AUTOMATION_ACTIONS.map(a => a.id);

  // The permission module is the single source of tier truth. Required lazily so the browser build can
  // fall back to its own loaded copy, and so this file still loads if the module is absent in a test stub.
  function permissionsModule() {
    if (typeof module !== 'undefined' && module.exports) {
      try { return require('./business-permissions.js'); } catch (_) { return null; }
    }
    return null;
  }

  function actionById(id) {
    const k = String(id == null ? '' : id);
    for (const a of AUTOMATION_ACTIONS) if (a.id === k) return a;
    return null;
  }

  /* requiredTiers(actions) -> { ok, tiers:[...], autonomous, needsApproval, blocked, unknown }
     The rule's tier is the UNION of its actions' tiers. `blocked` is true when any action is
     restricted — impossible with the catalogue above, but a rule carrying an unknown action id is
     treated as restricted (fail-closed, exactly like business-permissions.classify). */
  function requiredTiers(actions, permissions) {
    const P = permissions || permissionsModule();
    const tiers = [];
    const unknown = [];
    for (const raw of (Array.isArray(actions) ? actions : [])) {
      const id = raw && typeof raw === 'object' ? raw.action : raw;
      const a = actionById(id);
      const permId = a ? a.perm : null;
      const c = P ? P.classify(permId == null ? '' : permId) : { ok: false, tier: 'restricted' };
      if (!a) unknown.push(String(id == null ? '' : id));
      if (tiers.indexOf(c.tier) < 0) tiers.push(c.tier);
    }
    const autonomous = tiers.length > 0 && tiers.every(t => t === 'safe');
    const needsApproval = tiers.indexOf('review') >= 0;
    const blocked = tiers.indexOf('restricted') >= 0;
    return { ok: unknown.length === 0, tiers: tiers, autonomous: autonomous, needsApproval: needsApproval, blocked: blocked, unknown: unknown };
  }

  /* autonomy(rule) -> 'autonomous' | 'approval' | 'blocked'. What the UI shows and what setEnabled
     gates on. A rule with NO actions cannot be enabled: an automation that does nothing is a lie. */
  function autonomy(rule, permissions) {
    const t = requiredTiers(rule && rule.actions, permissions);
    if (t.tiers.length === 0) return 'blocked';
    if (t.blocked) return 'blocked';
    return t.autonomous ? 'autonomous' : (t.needsApproval ? 'approval' : 'blocked');
  }

  // ---- the pure matcher --------------------------------------------------------------------------

  function str(v, cap) { return (v == null ? '' : String(v)).slice(0, cap); }

  /* Read a TOP-LEVEL payload field. Deliberately not a path expression: a dotted path invites a typo
     that silently never matches, and every trigger payload in the contract is flat by design. */
  function valueAt(payload, field) {
    const p = (payload && typeof payload === 'object') ? payload : {};
    const k = String(field == null ? '' : field);
    if (!Object.prototype.hasOwnProperty.call(p, k)) return { present: false, value: undefined };
    const v = p[k];
    return { present: v !== null && v !== undefined, value: v };
  }

  function inList(list, v) {
    if (!Array.isArray(list)) return false;
    for (const e of list) { if (e === v || String(e) === String(v)) return true; }
    return false;
  }

  // one predicate. TOTAL: returns a boolean for any input.
  function testCondition(cond, payload) {
    const c = (cond && typeof cond === 'object') ? cond : {};
    const op = String(c.op == null ? '' : c.op);
    const got = valueAt(payload, c.field);
    switch (op) {
      case 'exists': return got.present;
      case 'not_exists': return !got.present;
      case 'eq': return got.present && got.value === c.value;
      case 'neq': return !(got.present && got.value === c.value);
      case 'in': return got.present && inList(c.value, got.value);
      case 'not_in': return !(got.present && inList(c.value, got.value));
      case 'contains': {
        if (!got.present) return false;
        if (typeof got.value === 'string') return got.value.toLowerCase().indexOf(String(c.value == null ? '' : c.value).toLowerCase()) >= 0;
        if (Array.isArray(got.value)) return inList(got.value, c.value);
        return false;
      }
      case 'gt': case 'gte': case 'lt': case 'lte': {
        // numbers only. A string that looks numeric is NOT coerced: the contract declares its types, so a
        // string here means the rule is asking the wrong question, and false is the honest answer.
        if (!got.present || typeof got.value !== 'number' || typeof c.value !== 'number') return false;
        if (!isFinite(got.value) || !isFinite(c.value)) return false;
        if (op === 'gt') return got.value > c.value;
        if (op === 'gte') return got.value >= c.value;
        if (op === 'lt') return got.value < c.value;
        return got.value <= c.value;
      }
      default: return false;
    }
  }

  /* evaluate(conditions, payload) -> { pass, results:[{ field, op, ok, note }] }.
     `pass` is the AND of every condition; an EMPTY condition list passes (a rule that only says
     "when X happens" is a complete rule). The per-condition results are what the UI shows so a user can
     see WHICH clause refused, instead of an automation that just never fires. */
  function evaluate(conditions, payload) {
    const list = Array.isArray(conditions) ? conditions : [];
    const results = [];
    let pass = true;
    for (const c of list) {
      const ok = testCondition(c, payload);
      if (!ok) pass = false;
      results.push({ field: str(c && c.field, MAX_ID), op: str(c && c.op, 20), ok: ok });
    }
    return { pass: pass, results: results };
  }

  /* interpolate(template, payload) -> string. `{{field}}` reads a top-level payload field; an unknown
     field becomes '' (never the literal '{{field}}', which would end up in a real task title). Capped so
     a runaway payload cannot write a megabyte into a task title. */
  function interpolate(template, payload) {
    const t = str(template, MAX_TEXT);
    if (t.indexOf('{{') < 0) return t.slice(0, MAX_PARAM_CHARS);
    const out = t.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_m, name) => {
      const got = valueAt(payload, name);
      if (!got.present) return '';
      const v = got.value;
      if (typeof v === 'object') { try { return JSON.stringify(v); } catch (_) { return ''; } }
      return String(v);
    });
    return out.slice(0, MAX_PARAM_CHARS);
  }

  // Resolve one action's params against a payload. Returns { ok, params } or { ok:false, reason }.
  function resolveParams(actionId, params, payload) {
    const a = actionById(actionId);
    if (!a) return { ok: false, reason: 'unknown action: ' + actionId };
    const src = (params && typeof params === 'object') ? params : {};
    const out = {};
    for (const f of a.required) {
      const v = interpolate(src[f], payload);
      if (!v.trim()) return { ok: false, reason: 'action "' + a.id + '" needs a "' + f + '"' };
      out[f] = v;
    }
    for (const f of a.optional) {
      if (src[f] === undefined || src[f] === null) continue;
      const v = interpolate(src[f], payload);
      if (v !== '') out[f] = v;
    }
    return { ok: true, params: out };
  }

  // ---- validation of a whole rule body ----------------------------------------------------------

  function validateTrigger(trigger) {
    const t = str(trigger, MAX_ID).trim();
    if (!t) return { ok: false, reason: 'an automation needs a trigger — the "when X happens" half' };
    if (TRIGGER_IDS.indexOf(t) < 0) {
      return { ok: false, reason: 'unknown trigger: "' + t + '". A trigger must be one of the events §12\'s automations may listen to; ' + TRIGGER_IDS.length + ' are available.' };
    }
    return { ok: true, trigger: t };
  }

  function validateConditions(conditions) {
    const list = Array.isArray(conditions) ? conditions : [];
    if (list.length > MAX_CONDITIONS) return { ok: false, reason: 'at most ' + MAX_CONDITIONS + ' conditions' };
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const c = (list[i] && typeof list[i] === 'object') ? list[i] : {};
      const field = str(c.field, MAX_ID).trim();
      if (!field) return { ok: false, reason: 'condition ' + (i + 1) + ' needs a field name' };
      const op = str(c.op, 20).trim();
      if (OP_IDS.indexOf(op) < 0) return { ok: false, reason: 'condition ' + (i + 1) + ' has an unknown test: "' + op + '" (one of: ' + OP_IDS.join(', ') + ')' };
      const def = CONDITION_OPS.filter(o => o.op === op)[0];
      if (def.needsValue && c.value === undefined) return { ok: false, reason: 'condition ' + (i + 1) + ' ("' + op + '") needs a value' };
      if ((op === 'in' || op === 'not_in') && !Array.isArray(c.value)) return { ok: false, reason: 'condition ' + (i + 1) + ' ("' + op + '") needs a list value' };
      const row = { field: field, op: op };
      if (def.needsValue) row.value = c.value;
      out.push(row);
    }
    return { ok: true, conditions: out };
  }

  function validateActions(actions) {
    const list = Array.isArray(actions) ? actions : [];
    if (!list.length) return { ok: false, reason: 'an automation needs at least one action — the "do Y" half' };
    if (list.length > MAX_ACTIONS) return { ok: false, reason: 'at most ' + MAX_ACTIONS + ' actions' };
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const raw = list[i];
      const id = str(raw && typeof raw === 'object' ? raw.action : raw, MAX_ID).trim();
      const a = actionById(id);
      if (!a) return { ok: false, reason: 'action ' + (i + 1) + ' is unknown: "' + id + '" (one of: ' + ACTION_IDS.join(', ') + ')' };
      const params = (raw && typeof raw === 'object' && raw.params && typeof raw.params === 'object') ? raw.params : {};
      for (const f of a.required) {
        if (params[f] === undefined || params[f] === null || String(params[f]).trim() === '') {
          return { ok: false, reason: 'action ' + (i + 1) + ' ("' + a.id + '") needs a "' + f + '"' };
        }
      }
      const clean = {};
      for (const f of a.required) clean[f] = str(params[f], MAX_PARAM_CHARS);
      for (const f of a.optional) if (params[f] !== undefined && params[f] !== null && String(params[f]) !== '') clean[f] = str(params[f], MAX_PARAM_CHARS);
      out.push({ action: a.id, params: clean });
    }
    return { ok: true, actions: out };
  }

  function makeBusinessAutomationStore(opts) {
    opts = opts || {};
    const rules = Array.isArray(opts.rules) ? opts.rules : [];
    const runs = Array.isArray(opts.runs) ? opts.runs : [];
    const persist = typeof opts.persist === 'function' ? opts.persist : null;
    const now = typeof opts.now === 'function' ? opts.now : (() => null);
    const permissions = opts.permissions || null;
    const limit = (Number.isFinite(opts.limit) && opts.limit > 0) ? Math.floor(opts.limit) : DEFAULT_LIMIT;
    const runLimit = (Number.isFinite(opts.runLimit) && opts.runLimit > 0) ? Math.floor(opts.runLimit) : DEFAULT_RUN_LIMIT;

    const indexOf = (id) => rules.findIndex(r => r && r.id === id);
    const forBiz = (businessId) => rules.filter(r => r && r.businessId === businessId);
    const biz = (v) => str(v, MAX_ID).trim();

    function nextSeq(businessId) {
      let max = 0;
      for (const r of rules) if (r && r.businessId === businessId && r.seq > max) max = r.seq;
      return max + 1;
    }

    function runView(r) {
      return {
        id: r.id,
        seq: r.seq,
        ruleId: r.ruleId,
        businessId: r.businessId,
        at: r.at != null ? r.at : null,
        event: r.event || '',
        depth: r.depth != null ? r.depth : 0,
        ok: !!r.ok,
        reason: r.reason || '',
        actions: Array.isArray(r.actions) ? r.actions.map(a => ({
          action: a.action, tier: a.tier || '', status: a.status || '', ok: !!a.ok, reason: a.reason || ''
        })) : []
      };
    }

    function rowView(r) {
      return {
        id: r.id,
        seq: r.seq,
        businessId: r.businessId,
        name: r.name,
        trigger: r.trigger,
        conditions: (r.conditions || []).map(c => ({ field: c.field, op: c.op, value: c.value })),
        actions: (r.actions || []).map(a => ({ action: a.action, params: Object.assign({}, a.params || {}) })),
        enabled: !!r.enabled,
        cooldownMs: r.cooldownMs,
        disabledReason: r.disabledReason || '',
        consecutiveFailures: r.consecutiveFailures || 0,
        fireCount: r.fireCount || 0,
        createdAt: r.createdAt != null ? r.createdAt : null,
        updatedAt: r.updatedAt != null ? r.updatedAt : null,
        // derived, never stored: the §13 tiers this rule's actions land in, and whether it may run
        // unattended. Recomputed on every read so a catalogue change cannot leave a stale claim behind.
        tiers: requiredTiers(r.actions, permissions).tiers,
        autonomy: autonomy(r, permissions)
      };
    }

    /* Persist-before-commit, fail-closed: a thrown persist leaves memory untouched and returns ok:false,
       so a rule is never reported as saved when the write failed. The SNAPSHOT carries both row families
       (rules + the bounded run log), the same shape business-finance.js uses for its three. */
    function commit(nextRules, nextRuns) {
      if (persist) {
        try { persist({ rules: nextRules.map(rowView), runs: nextRuns.map(runView) }); }
        catch (e) { return { ok: false, reason: 'could not persist — denied' }; }
      }
      rules.length = 0;
      for (const r of nextRules) rules.push(r);
      runs.length = 0;
      for (const r of nextRuns) runs.push(r);
      return { ok: true };
    }

    // ---- reads -------------------------------------------------------------------------------------
    function list(businessId) {
      const b = biz(businessId);
      if (!b) return [];
      return forBiz(b).slice().sort((a, c) => (a.seq || 0) - (c.seq || 0)).map(rowView);
    }
    function get(id) { const i = indexOf(id); return i < 0 ? null : rowView(rules[i]); }
    function has(id) { return indexOf(id) >= 0; }
    function count(businessId) { const b = biz(businessId); return b ? forBiz(b).length : 0; }

    function summary(businessId) {
      const rows = list(businessId);
      const out = { total: rows.length, enabled: 0, disabled: 0, autonomous: 0, needsApproval: 0, byTrigger: {} };
      for (const r of rows) {
        if (r.enabled) out.enabled++; else out.disabled++;
        if (r.autonomy === 'autonomous') out.autonomous++;
        if (r.autonomy === 'approval') out.needsApproval++;
        out.byTrigger[r.trigger] = (out.byTrigger[r.trigger] || 0) + 1;
      }
      return out;
    }

    // The ENABLED rules of one business listening to one event. Never another business's (P6).
    function matching(businessId, eventName) {
      const b = biz(businessId);
      if (!b) return [];
      const e = str(eventName, MAX_ID);
      return forBiz(b).filter(r => r && r.enabled && r.trigger === e).sort((a, c) => (a.seq || 0) - (c.seq || 0)).map(rowView);
    }

    function runsFor(ruleId, n) {
      const rows = runs.filter(r => r && r.ruleId === ruleId).slice().sort((a, c) => (c.at || 0) - (a.at || 0));
      const cap = (Number.isFinite(n) && n > 0) ? Math.floor(n) : 0;
      return (cap ? rows.slice(0, cap) : rows).map(runView);
    }
    function runsForBusiness(businessId, n) {
      const b = biz(businessId);
      if (!b) return [];
      const rows = runs.filter(r => r && r.businessId === b).slice().sort((a, c) => (c.at || 0) - (a.at || 0));
      const cap = (Number.isFinite(n) && n > 0) ? Math.floor(n) : 0;
      return (cap ? rows.slice(0, cap) : rows).map(runView);
    }
    // The most recent successful fire, epoch-ms, or null. The cooldown is measured from this.
    function lastFiredAt(ruleId) {
      let max = null;
      for (const r of runs) if (r && r.ruleId === ruleId && r.at != null && (max === null || r.at > max)) max = r.at;
      return max;
    }
    /* canFire(rule, atMs) -> { ok, reason }. Two gates: the rule must be enabled, and it must be past its
       cooldown. A cooldown exists because a chatty trigger (a metric reading, a logged interaction) would
       otherwise let one automation fire hundreds of times in a minute. */
    function canFire(ruleOrId, atMs) {
      const r = (typeof ruleOrId === 'string') ? (indexOf(ruleOrId) < 0 ? null : rules[indexOf(ruleOrId)]) : ruleOrId;
      if (!r) return { ok: false, reason: 'no such rule' };
      if (!r.enabled) return { ok: false, reason: r.disabledReason ? ('disabled: ' + r.disabledReason) : 'this automation is switched off' };
      const at = (typeof atMs === 'number' && isFinite(atMs)) ? atMs : now();
      if (typeof at === 'number') {
        const last = lastFiredAt(r.id);
        if (last !== null && (at - last) < (r.cooldownMs || 0)) {
          return { ok: false, reason: 'cooling down (' + Math.max(0, (r.cooldownMs || 0) - (at - last)) + 'ms left)' };
        }
      }
      return { ok: true };
    }

    // ---- writes ------------------------------------------------------------------------------------
    function create(businessId, meta) {
      meta = meta || {};
      const b = biz(businessId);
      if (!b) return { ok: false, reason: 'a businessId is required (isolation is by key — never implied)' };
      const name = str(meta.name, MAX_NAME).trim();
      if (!name) return { ok: false, reason: 'an automation name is required' };

      const t = validateTrigger(meta.trigger);
      if (!t.ok) return { ok: false, reason: t.reason };
      const c = validateConditions(meta.conditions);
      if (!c.ok) return { ok: false, reason: c.reason };
      const a = validateActions(meta.actions);
      if (!a.ok) return { ok: false, reason: a.reason };

      let cooldown = DEFAULT_COOLDOWN_MS;
      if (meta.cooldownMs !== undefined && meta.cooldownMs !== null) {
        const n = Number(meta.cooldownMs);
        if (!isFinite(n) || n < 0) return { ok: false, reason: 'cooldownMs must be a number of milliseconds' };
        if (n > MAX_COOLDOWN_MS) return { ok: false, reason: 'cooldownMs cannot exceed ' + MAX_COOLDOWN_MS + 'ms' };
        cooldown = Math.floor(n);
      }

      // A rule carrying a restricted-tier action can NEVER be enabled — the store refuses it at the door
      // rather than storing a rule that would silently never run.
      const tiers = requiredTiers(a.actions, permissions);
      const wantEnabled = !!meta.enabled;
      if (wantEnabled && tiers.blocked) {
        return { ok: false, reason: 'this automation contains an action that cannot run automatically (restricted tier) — it cannot be enabled' };
      }

      const at = now();
      const seq = nextSeq(b);
      const row = {
        // '~' not '#' — a rule id travels in a URL path, and '#' would be stripped as a fragment
        // delimiter before the request left the browser (see validation-store.js).
        id: b + '~a' + seq,
        seq: seq,
        businessId: b,
        name: name,
        trigger: t.trigger,
        conditions: c.conditions,
        actions: a.actions,
        enabled: wantEnabled,
        cooldownMs: cooldown,
        disabledReason: '',
        consecutiveFailures: 0,
        fireCount: 0,
        createdAt: at,
        updatedAt: at
      };

      // cap THIS business only — never another's.
      let nextRules = rules.slice(); nextRules.push(row);
      const mine = nextRules.filter(r => r && r.businessId === b);
      if (mine.length > limit) {
        const keep = new Set(mine.slice(mine.length - limit).map(r => r.id));
        const dropped = mine.filter(r => !keep.has(r.id)).map(r => r.id);
        nextRules = nextRules.filter(r => r.businessId !== b || keep.has(r.id));
        // the dropped rules' run-log rows go with them — an orphaned log row names a rule nobody can read.
        const nextRuns = runs.filter(r => !(r && dropped.indexOf(r.ruleId) >= 0));
        const w = commit(nextRules, nextRuns);
        if (!w.ok) return w;
        return { ok: true, automation: rowView(row) };
      }
      const w = commit(nextRules, runs.slice());
      if (!w.ok) return w;
      return { ok: true, automation: rowView(row) };
    }

    function update(id, patch) {
      patch = patch || {};
      const i = indexOf(id);
      if (i < 0) return { ok: false, reason: 'unknown automation: ' + id };
      const prev = rules[i];
      const nextRow = Object.assign({}, prev);
      nextRow.conditions = (prev.conditions || []).map(c => Object.assign({}, c));
      nextRow.actions = (prev.actions || []).map(a => ({ action: a.action, params: Object.assign({}, a.params || {}) }));

      if (patch.name != null) {
        const n = str(patch.name, MAX_NAME).trim();
        if (!n) return { ok: false, reason: 'name cannot be blank' };
        nextRow.name = n;
      }
      if (patch.trigger != null) {
        const t = validateTrigger(patch.trigger);
        if (!t.ok) return { ok: false, reason: t.reason };
        nextRow.trigger = t.trigger;
      }
      if (patch.conditions != null) {
        const c = validateConditions(patch.conditions);
        if (!c.ok) return { ok: false, reason: c.reason };
        nextRow.conditions = c.conditions;
      }
      if (patch.actions != null) {
        const a = validateActions(patch.actions);
        if (!a.ok) return { ok: false, reason: a.reason };
        nextRow.actions = a.actions;
      }
      if (patch.cooldownMs != null) {
        const n = Number(patch.cooldownMs);
        if (!isFinite(n) || n < 0) return { ok: false, reason: 'cooldownMs must be a number of milliseconds' };
        if (n > MAX_COOLDOWN_MS) return { ok: false, reason: 'cooldownMs cannot exceed ' + MAX_COOLDOWN_MS + 'ms' };
        nextRow.cooldownMs = Math.floor(n);
      }
      // Changing the actions of a LIVE rule must not let it slide into a restricted tier while enabled.
      if (patch.actions != null && nextRow.enabled && requiredTiers(nextRow.actions, permissions).blocked) {
        return { ok: false, reason: 'that change would leave an enabled automation holding a restricted-tier action — switch it off first' };
      }

      // immutable
      nextRow.id = prev.id; nextRow.seq = prev.seq; nextRow.businessId = prev.businessId;
      nextRow.createdAt = prev.createdAt;
      nextRow.updatedAt = now();

      const next = rules.slice(); next[i] = nextRow;
      const w = commit(next, runs.slice());
      if (!w.ok) return w;
      return { ok: true, automation: rowView(nextRow) };
    }

    /* setEnabled — the §12 enable/disable switch and §19's "disable automation". Enabling CLEARS the
       failure streak and the auto-disable reason, because "turn it back on" is a human decision that the
       next run should be judged on its own merits. Disabling records WHY. */
    function setEnabled(id, enabled, o) {
      o = o || {};
      const i = indexOf(id);
      if (i < 0) return { ok: false, reason: 'unknown automation: ' + id };
      const prev = rules[i];
      const on = !!enabled;
      if (on && autonomy(prev, permissions) === 'blocked') {
        return { ok: false, reason: 'this automation cannot run automatically (restricted tier or no actions) — it cannot be enabled' };
      }
      const nextRow = Object.assign({}, prev);
      nextRow.enabled = on;
      nextRow.disabledReason = on ? '' : str(o.reason, MAX_TEXT) || 'switched off by you';
      if (on) nextRow.consecutiveFailures = 0;
      nextRow.updatedAt = now();
      const next = rules.slice(); next[i] = nextRow;
      const w = commit(next, runs.slice());
      if (!w.ok) return w;
      return { ok: true, automation: rowView(nextRow), changed: prev.enabled !== on };
    }

    function remove(id) {
      const i = indexOf(id);
      if (i < 0) return { ok: true, removed: 0 };
      const next = rules.slice(); next.splice(i, 1);
      const nextRuns = runs.filter(r => !(r && r.ruleId === id));
      const w = commit(next, nextRuns);
      if (!w.ok) return w;
      return { ok: true, removed: 1 };
    }

    function clear(businessId) {
      const b = biz(businessId);
      if (!b) return { ok: false, reason: 'a businessId is required' };
      const next = rules.filter(r => !(r && r.businessId === b));
      const nextRuns = runs.filter(r => !(r && r.businessId === b));
      const w = commit(next, nextRuns);
      if (!w.ok) return w;
      return { ok: true };
    }

    /* recordRun — append one run to the bounded per-rule ring and fold its outcome into the failure
       streak. Returns { ok, run, automation, autoDisabled }. A rule that has just auto-disabled comes
       back with autoDisabled:true so the caller can say so on the bus and in the activity log instead of
       leaving the user to notice that an automation went quiet. */
    function recordRun(ruleId, run) {
      run = run || {};
      const i = indexOf(ruleId);
      if (i < 0) return { ok: false, reason: 'unknown automation: ' + ruleId };
      const prev = rules[i];

      const row = {
        id: prev.id + '~r' + ((runs.filter(r => r && r.ruleId === prev.id).length) + 1),
        ruleId: prev.id,
        businessId: prev.businessId,
        at: run.at != null ? run.at : now(),
        event: str(run.event, MAX_ID),
        depth: Number.isFinite(run.depth) ? run.depth : 0,
        ok: !!run.ok,
        reason: str(run.reason, MAX_TEXT),
        actions: Array.isArray(run.actions) ? run.actions.map(a => ({
          action: str(a && a.action, MAX_ID),
          tier: str(a && a.tier, 20),
          status: str(a && a.status, 20),
          ok: !!(a && a.ok),
          reason: str(a && a.reason, MAX_TEXT)
        })) : []
      };

      let nextRuns = runs.slice(); nextRuns.push(row);
      // cap THIS rule's log only.
      const mine = nextRuns.filter(r => r && r.ruleId === prev.id).sort((a, c) => (c.at || 0) - (a.at || 0));
      if (mine.length > runLimit) {
        const drop = new Set(mine.slice(runLimit).map(r => r.id));
        nextRuns = nextRuns.filter(r => !drop.has(r.id));
      }

      const nextRow = Object.assign({}, prev);
      nextRow.fireCount = (prev.fireCount || 0) + 1;
      let autoDisabled = false;
      if (row.ok) {
        nextRow.consecutiveFailures = 0;
      } else {
        nextRow.consecutiveFailures = (prev.consecutiveFailures || 0) + 1;
        if (nextRow.consecutiveFailures >= FAILURE_THRESHOLD && nextRow.enabled) {
          nextRow.enabled = false;
          nextRow.disabledReason = 'switched itself off after ' + nextRow.consecutiveFailures + ' failed runs in a row';
          autoDisabled = true;
        }
      }
      nextRow.updatedAt = now();

      const nextRules = rules.slice(); nextRules[i] = nextRow;
      const w = commit(nextRules, nextRuns);
      if (!w.ok) return w;
      return { ok: true, run: runView(row), automation: rowView(nextRow), autoDisabled: autoDisabled };
    }

    /* noteOutcome — the failure counter on its own, for a caller that recorded no run row (a rule that
       could not even build a run). Kept separate from recordRun so the two paths cannot disagree about
       the streak: both go through the same threshold logic. */
    function noteOutcome(ruleId, ok) {
      const i = indexOf(ruleId);
      if (i < 0) return { ok: false, reason: 'unknown automation: ' + ruleId };
      const prev = rules[i];
      const nextRow = Object.assign({}, prev);
      let autoDisabled = false;
      if (ok) nextRow.consecutiveFailures = 0;
      else {
        nextRow.consecutiveFailures = (prev.consecutiveFailures || 0) + 1;
        if (nextRow.consecutiveFailures >= FAILURE_THRESHOLD && nextRow.enabled) {
          nextRow.enabled = false;
          nextRow.disabledReason = 'switched itself off after ' + nextRow.consecutiveFailures + ' failed runs in a row';
          autoDisabled = true;
        }
      }
      nextRow.updatedAt = now();
      const next = rules.slice(); next[i] = nextRow;
      const w = commit(next, runs.slice());
      if (!w.ok) return w;
      return { ok: true, automation: rowView(nextRow), autoDisabled: autoDisabled };
    }

    return {
      MAX_CONDITIONS, MAX_ACTIONS, FAILURE_THRESHOLD, DEFAULT_COOLDOWN_MS, MAX_COOLDOWN_MS,
      LIMIT: limit, RUN_LIMIT: runLimit,
      list, get, has, count, summary, matching, runsFor, runsForBusiness, lastFiredAt, canFire,
      create, update, setEnabled, remove, clear, recordRun, noteOutcome,
      // exposed so a caller holding this instance never has to re-require the module to classify
      requiredTiers: (actions) => requiredTiers(actions, permissions),
      autonomy: (rule) => autonomy(rule, permissions)
    };
  }

  return {
    makeBusinessAutomationStore,
    TRIGGER_EVENTS, TRIGGER_IDS,
    CONDITION_OPS, OP_IDS,
    AUTOMATION_ACTIONS, ACTION_IDS,
    MAX_CONDITIONS, MAX_ACTIONS, MAX_NAME, MAX_TEXT, MAX_PARAM_CHARS,
    DEFAULT_LIMIT, DEFAULT_RUN_LIMIT, FAILURE_THRESHOLD, DEFAULT_COOLDOWN_MS, MAX_COOLDOWN_MS,
    actionById, requiredTiers, autonomy,
    valueAt, testCondition, evaluate, interpolate, resolveParams,
    validateTrigger, validateConditions, validateActions,
    // `events` is re-exported so a test (and the route module) can assert every trigger against the
    // LIVE contract without a second require of shared/events.js.
    events: events
  };
});
