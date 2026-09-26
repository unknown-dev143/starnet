/* sidecar/business-worker-policy.js — THE BRIDGE between the station's TOOL layer and §13's business
   permission tiers (Business OS Phase 6).

   WHY THIS FILE EXISTS AND WHY IT IS NOT AN EDIT TO EITHER SIDE.

   The station already has a complete, load-bearing permission system: `sidecar/tools/registry.js`'s dispatch
   runs every tool call through `ctx.authorize` → `ctx.canUse` → `schema.validate` → the consent broker
   (`sidecar/permissions.js`), and `sidecar/capability/registry.js` declares per-objectType grants carrying
   `scope` ('read'|'write'|'execute'), `requiresConsent` and `network`. Business OS Phase 3 built a SECOND,
   independent model: §13's three tiers, `business-permissions.js`, whose `ACTIONS` are business concepts
   ("spend money", "publish content") that the tool layer has never heard of.

   The two are on DIFFERENT AXES and neither subsumes the other:
     · the tool layer knows the MECHANISM  (does this touch the disk? the network? does it spawn a process?)
     · §13 knows the CONSEQUENCE            (is this a commitment the business owner must authorise?)
   A tool can be mechanically trivial and commercially consequential (`channel.send` is one HTTP POST; it is
   also the business speaking to a customer in public). A tool can be mechanically heavy and commercially
   inert (`fs.search` walks the disk; it commits nothing).

   So Phase 6 composes them rather than merging them — exactly the shape `permissions.js`'s own header asks
   for. This module owns ONE question: **given a tool, which §13 action does calling it constitute, and what
   do BOTH permission systems say about it?** It never executes anything, never touches a store, and never
   relaxes a floor. The runner (`business-worker.js`) consumes its verdicts.

   THE THREE PROPERTIES THAT MAKE THIS SAFE:

   1. FAIL-CLOSED BY DEFAULT. A tool that is not in the table and matches no family is mapped to
      `access_sensitive` — §13's most restrictive action — so an unrecognised tool is REFUSED, never waved
      through. New tools added to the station upstream do not silently become worker-callable.

   2. THE TOOL'S OWN DECLARATION IS A RUNTIME FLOOR, NOT A §13 TIER. Each tool carries its own `scope` and
      `requiresConsent`, and those yield a FLOOR (`read` → safe, `write` → review, `execute` → restricted).
      The floor is reported SEPARATELY from the tier, and this separation is the correction of a real bug: an
      earlier draft folded the floor into `tier`, so a tool the table called 'draft' (safe) came back as
      'review'. That looked stricter and was actually incoherent — §13's tier is what the grants model, the
      approval queue and business-approvals-store.create() all speak, and a safe ACTION cannot be filed as a
      review REQUEST (the store correctly refuses: "the approval claims tier review but draft is a safe-tier
      action"). The two systems are on different axes — §13 judges the CONSEQUENCE (what the act means to the
      business), the tool layer judges the MECHANISM (what the call does to the machine) — and a policy that
      merges them cannot be satisfied by either. So: `tier` is §13's verdict on the action, `floor` is the
      runtime's requirement for the mechanism, and BOTH must be satisfied before a step runs.

   3. NEITHER SYSTEM CAN OVERRIDE THE OTHER. `decideWorker` ANDs §13's verdict with the runtime floor AND the
      consent broker's answer. An allow from one never rescues a deny from the other. That is the whole point
      of composing: the business owner's tier model cannot be bypassed by a stale session grant, and a session
      grant cannot be conjured by an agent that §13 already refused.

   Pure UMD: no IO, no clock, no rng, no env. Every function is total — a malformed tool descriptor produces a
   refusal, never a throw. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).businessWorkerPolicy = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // §13's tiers, in severity order. `rank` is what "the stricter wins" compares.
  const TIER_RANK = { safe: 0, review: 1, restricted: 2 };
  const rankOf = (t) => (TIER_RANK[t] === undefined ? TIER_RANK.restricted : TIER_RANK[t]);
  const stricter = (a, b) => (rankOf(a) >= rankOf(b) ? a : b);

  // The tool's own declaration floor. See property (2) in the header.
  const SCOPE_FLOOR = { read: 'safe', write: 'review', execute: 'restricted' };

  /* THE TABLE. Explicit tool name → §13 action id. Every id on the right MUST be a real id from
     business-permissions.js's ACTIONS — `test/business-worker-policy.test.js` asserts exactly that against
     the live module, so a rename upstream fails the gate instead of producing a policy that classifies
     everything as unknown-and-therefore-restricted (which would look like a very safe policy and would
     actually be a dead feature).

     The mapping is by CONSEQUENCE, and the reasoning is written down because a reader must be able to
     disagree with a specific line rather than with "the policy". */
  const TOOL_ACTIONS = {
    /* ---- READ: the agent's own records and the station's read-only surfaces. §13 'read_local'. ---- */
    'fs.read': 'read_local',
    'fs.list': 'read_local',
    'fs.search': 'read_local',
    'session.list': 'read_local',
    'session.peek': 'read_local',
    'skill.list': 'read_local',
    'skill.view': 'read_local',
    'tool.search': 'read_local',
    'connectors.list': 'read_local',
    'station.inspect': 'read_local',
    'task.list': 'read_local',
    'todo': 'read_local',
    'loop.list': 'read_local',
    'routine.list': 'read_local',
    'routine.notepad': 'read_local',
    'channel.targets': 'read_local',
    'deliverable_note': 'report',

    /* ---- RESEARCH: reaching the open web to READ. §13 'research' — safe. The network itself is not a §13
       concern; the runtime consent broker already treats an autonomous network read as needing a human yes,
       so the two systems each hold their own half and neither is duplicated here. ---- */
    'web_search': 'research',
    'web_fetch': 'research',
    'web_request': 'research',

    /* ---- ANALYSIS: bounded, internal, no outside effect. §13 'analyze'. ----
       `code.run` is here because the tool is a READ-scoped bounded-JS sandbox that can only call the caller's
       already-granted READ tools and explicitly refuses nested writes/shell/code.run — so it cannot be used to
       escalate. If that ever changes upstream, its `scope` becomes 'execute' and property (2) escalates it. */
    'code.run': 'analyze',
    'verify.run': 'analyze',
    'image_analyze': 'analyze',
    'recall_conversation': 'analyze',
    'notebook.read': 'analyze',
    'notebook.feedback': 'draft',

    /* ---- DRAFT: producing an internal artefact. §13 'draft' — safe. Nothing here leaves the station, so the
       business owner has nothing to authorise yet; the publish step is where §13 intervenes, and that is a
       separate action below. Media generators are 'draft' for the same reason: they produce an internal
       asset. Their API COST is an inference-cost question owned by the cost layer, not a §13 money
       COMMITMENT — §13's 'spend money' is about obligating the business, and Phase 4 built a whole separate
       finance layer precisely so the two are never conflated. ---- */
    'notebook.write': 'draft',
    'skill.write': 'draft',
    'widget.set': 'draft',
    'image_generate': 'draft',
    'video_generate': 'draft',
    'video_compose': 'draft',
    'audio_generate': 'draft',
    'voice_generate': 'draft',

    /* ---- PLAN: changing the station's own plan/agenda. §13 'plan' — safe. This schedules future work; it
       does not perform it, and every scheduled action is classified again when it actually runs. ---- */
    'task.create': 'plan',
    'task.manage': 'plan',
    'loop.create': 'plan',
    'loop.manage': 'plan',
    'routine.create': 'plan',
    'routine.manage': 'plan',
    'skill.manage': 'plan',
    'quest.update': 'plan',
    'team.spawn': 'plan',
    'team.summon': 'plan',
    'team.dispatch': 'plan',
    'team.steer': 'plan',
    'team.interrupt': 'plan',
    'team.resume': 'plan',
    'team.subagents': 'plan',

    /* ---- EXTERNAL COMMS: the business speaking to someone outside the station. §13 'external_comms' —
       REVIEW. This is the single most important line in the table: a channel message is one HTTP POST
       (mechanically trivial) and a public statement by the business (commercially consequential). The tool
       layer would call it a cheap write; §13 is the system that knows it needs a human. ---- */
    'channel.send': 'external_comms',

    /* ---- PUBLISH: content becoming public. §13 'publish_content' — REVIEW (§17's own rule). ---- */
    'doc_publish': 'publish_content',
    'report_publish': 'publish_content',
    'publish': 'publish_content',

    /* ---- CONTROLLING AN EXTERNAL SERVICE. Spotify playback is an effect in the outside world that a person
       can perceive, so it takes the external-comms tier rather than riding in as a 'write'. Reading what is
       playing / searching the catalogue stays safe above. ---- */
    'spotify_play': 'external_comms',
    'spotify_pause': 'external_comms',
    'spotify_next': 'external_comms',
    'spotify_previous': 'external_comms',
    'spotify_queue': 'external_comms',
    'spotify_now_playing': 'read_local',
    'spotify_search': 'read_local',
    'spotify_playlists': 'read_local',

    /* ---- INFRASTRUCTURE: spawning processes and driving the desktop. §13 'change_infra' — RESTRICTED, i.e.
       never auto-run and not even rescuable by a per-request yes. A process this agent starts runs with the
       user's own privileges, and a desktop action lands in the user's real session; neither is something the
       agent can be trusted to decide for itself. The station's own jails (the per-agent workspace, the
       realpath-proven `resolveInside`, the sandbox router) still apply on top; this tier is about who
       AUTHORISES it, and the answer for an agent is: not the agent. ---- */
    'shell.exec': 'change_infra',
    'shell.bg.write': 'change_infra',
    'shell.bg.kill': 'change_infra',
    'shell.bg.read': 'read_local',
    'shell.bg.status': 'read_local',
    'terminal.start': 'change_infra',
    'terminal.write': 'change_infra',
    'terminal.resize': 'change_infra',
    'terminal.stop': 'change_infra',
    'terminal.interrupt': 'change_infra',
    'terminal.read': 'read_local',
    'terminal.status': 'read_local',
    'computer.use': 'change_infra',
    'desktop.open': 'change_infra',
    'session.create': 'change_infra',
    'session.focus': 'change_infra',

    /* ---- LOCAL FILE MUTATIONS: §13 'draft' — a safe ACTION with a REVIEW FLOOR on the mechanism. ----
       These four are the deliberate exception to the paragraph above, and the reasoning is the two-axes
       argument in this file's header. Writing a file is a DRAFTING act — the agent composing a note, a report,
       a config — not a change to production infrastructure, which is what 'change_infra' names. So §13's tier
       for the ACTION is safe: the owner's "this agent may draft" grant is the right question to ask, and it is
       the answer the approval store can actually record.

       But a write is not inert, and it must not ride in on a standing grant either. That half is the MECHANISM
       and it belongs to the tool's own declaration, not to §13: `fs.write` declares `scope:'write'`, so
       SCOPE_FLOOR puts a 'review' floor on it and the runtime consent gate has to answer yes for THIS call.
       An unattended run therefore holds the step — with the runtime's reason, and with no §13 request filed,
       because §13 has nothing to ask.

       The alternative — mapping these to 'change_infra' — was tried first and is wrong twice over. It makes
       them §13-restricted, so the worker could never write a file at all, which leaves §30's "controlled ...
       file ... operations" with no way to write one. And it makes SCOPE_FLOOR's `write: 'review'` floor
       unreachable for every tool in the table, so the floor would be documentation rather than enforcement.

       A file write is REVERSIBLE (it is inside the agent's own jail, and the station keeps checkpoints). The
       tier below it — delete_data — is not. That asymmetry is the reason these two live in different blocks. ---- */
    'fs.write': 'draft',
    'fs.edit': 'draft',
    'fs.append': 'draft',
    'fs.patch': 'draft',

    /* ---- DESTRUCTION: §13 'delete_data' — RESTRICTED, and unlike a write there is nothing to review away.
       Enumerated explicitly so the `fs.` family rule below can stay permissive without turning a delete into
       a draft. ---- */
    'fs.delete': 'delete_data',
    'fs.remove': 'delete_data',
    'fs.rm': 'delete_data',
    'fs.unlink': 'delete_data',

    /* ---- SENSITIVE ACCESS: credentials and authenticated sessions. §13 'access_sensitive' — RESTRICTED.
       Logging in as the business is the one action that can turn every later read into a privileged one, so
       it can never be the agent's own decision. ---- */
    'browser.login': 'access_sensitive',

    /* ---- THE BROWSER (§10). Enumerated in full, because there was previously only ONE browser entry in
       this table and no `browser.` family — so 34 of the 35 browser tools fell through to the fail-closed
       default (`access_sensitive` → restricted) and a business worker could not drive the browser AT ALL.
       That failure mode was SAFE (fail-closed is correct) but it made a mature 2,873-line browser layer
       unreachable, which is a dead feature rather than a safe one. Found by live verification, 2026-09-26.

       CLASSIFIED BY CONSEQUENCE, not by the tool's own `scope` — the two-axes argument in this file's header.
       The tool layer knows the MECHANISM (does it touch the network?); §13 knows the CONSEQUENCE (can the
       business be harmed?). A page that is merely READ cannot harm the business, so it is 'research'. A page
       that is DRIVEN (a click, a form submit, a purchase) acts in the outside world as the business, so it is
       'change_infra' — restricted, never auto-run, not rescuable by a per-request yes. And anything that
       changes WHO we are while browsing, or exports the session, is 'access_sensitive'. ---- */

    /* READING A PAGE (§13 'research' — safe). These observe; they do not act. `browser.navigate` is here and
       not in the acting block on purpose: it resolves a URL and renders it, exactly what `web_fetch` does, and
       `web_fetch` is already 'research' above. Consistency matters more than the tool's own 'read' scope would
       suggest, because an inconsistent line is the one a reader cannot disagree with precisely. */
    'browser.navigate': 'research',
    'browser.snapshot': 'research',
    'browser.get_text': 'research',
    'browser.inspect': 'research',
    'browser.find': 'research',
    'browser.console': 'research',
    'browser.network': 'research',
    'browser.tabs': 'research',
    'browser.screenshot': 'research',
    'browser.pdf': 'research',
    'browser.vision': 'research',
    'browser.wait': 'research',

    /* DRIVING A PAGE (§13 'change_infra' — RESTRICTED). Every one of these changes state in the outside
       world under the business's identity: a click can buy, a type can submit, an upload can publish,
       `browser.dialog` can accept a native confirm. Reversible ones and irreversible ones are NOT
       distinguished here because this tier already refuses unattended execution entirely — the distinction
       that matters (approve / do not) has already been made one level up. */
    'browser.click': 'change_infra',
    'browser.type': 'change_infra',
    'browser.press': 'change_infra',
    'browser.select': 'change_infra',
    'browser.hover': 'change_infra',
    'browser.scroll': 'change_infra',
    'browser.drag': 'change_infra',
    'browser.back': 'change_infra',
    'browser.forward': 'change_infra',
    'browser.dialog': 'change_infra',
    'browser.upload': 'change_infra',
    'browser.tab_select': 'change_infra',
    'browser.tab_close': 'change_infra',
    'browser.viewport': 'change_infra',
    'browser.emulate': 'change_infra',

    /* SESSION AND PAGE CONTROL THAT IS EFFECTIVELY INFRASTRUCTURE.

       `browser.eval` runs arbitrary JavaScript in the page. The tool declares it `exec`, but a generic
       "restricted" is not enough nuance: eval can read the session cookie, rewrite the DOM a later step
       trusts, or extract the whole page's secrets. It is the browser's `shell.exec`, and it takes the same
       tier for the same reason — an agent may not decide this for itself.
       `browser.intercept` rewrites network traffic, which is worse than reading it: a rewritten response is
       what every later step will believe.
       `browser.attach` / `browser.detach` adopt or release an EXISTING browser session that may already be
       authenticated as the user — that is privileged access, not mere navigation. */
    'browser.eval': 'change_infra',
    'browser.intercept': 'change_infra',
    'browser.attach': 'access_sensitive',
    'browser.detach': 'access_sensitive',

    /* THE BROWSER TEST RIG (`browser.test_*`, capability 'workbench'). These drive a throwaway test page the
       agent itself created to check a site it is building — they cannot touch the business's real accounts, so
       they stay 'draft' (producing an internal artefact). They are still enumerated rather than left to a
       family so a future rename is a deliberate edit here. */
    'browser.test_navigate': 'draft',
    'browser.test_snapshot': 'draft',
    'browser.test_state': 'draft',
    'browser.test_input': 'draft'
  };

  /* FAMILY RULES, applied only when the exact name is not in the table. A family rule exists where a whole
     prefix shares one consequence and enumerating each member would drift. `test` entries are matched
     longest-prefix-first, and an unmatched name still falls through to the fail-closed default — so a family
     rule is a convenience, never a hole. */
  const FAMILIES = [
    { prefix: 'fs.read', action: 'read_local' },
    /* An fs.* name the table above does not enumerate is a mutation of a KIND THIS POLICY DOES NOT KNOW. The
       enumerated writes are 'draft' (see the block above); an unknown one could just as easily be a delete,
       so it takes the restricted family rather than the drafting one. A new fs tool added upstream therefore
       arrives refused, and earning it a lower tier is a deliberate edit to this table. */
    { prefix: 'fs.', action: 'change_infra' },
    { prefix: 'shell.bg.read', action: 'read_local' },
    { prefix: 'shell.', action: 'change_infra' },
    { prefix: 'terminal.read', action: 'read_local' },
    { prefix: 'terminal.status', action: 'read_local' },
    { prefix: 'terminal.', action: 'change_infra' },
    { prefix: 'browser.login', action: 'access_sensitive' },
    /* The read-only browser reads, longest-prefix-first cannot help across different names, so the twelve
       `browser.<read>` names are listed as their own prefixes. A NEW browser read added upstream falls to the
       `browser.` family below and arrives refused — which is the honest default, not a hole: earning it
       'research' is a deliberate edit here, exactly as the `fs.` family argues. */
    { prefix: 'browser.navigate', action: 'research' },
    { prefix: 'browser.snapshot', action: 'research' },
    { prefix: 'browser.get_text', action: 'research' },
    { prefix: 'browser.inspect', action: 'research' },
    { prefix: 'browser.find', action: 'research' },
    { prefix: 'browser.console', action: 'research' },
    { prefix: 'browser.network', action: 'research' },
    { prefix: 'browser.tabs', action: 'research' },
    { prefix: 'browser.screenshot', action: 'research' },
    { prefix: 'browser.pdf', action: 'research' },
    { prefix: 'browser.vision', action: 'research' },
    { prefix: 'browser.wait', action: 'research' },
    { prefix: 'browser.test_', action: 'draft' },
    /* An unenumerated browser.* name is one this policy cannot reason about. It could be a click on a
       "Confirm payment" button, so it takes the restricted family rather than the reading one. */
    { prefix: 'browser.', action: 'change_infra' },
    { prefix: 'channel.', action: 'external_comms' },
    { prefix: 'web_', action: 'research' },
    { prefix: 'notebook.read', action: 'analyze' },
    { prefix: 'notebook.', action: 'draft' },
    { prefix: 'recall', action: 'analyze' },
    { prefix: 'session.', action: 'change_infra' },
    { prefix: 'team.', action: 'plan' },
    { prefix: 'task.', action: 'plan' },
    { prefix: 'loop.', action: 'plan' },
    { prefix: 'routine.', action: 'plan' },
    { prefix: 'skill.', action: 'draft' },
    { prefix: 'spotify_', action: 'external_comms' },
    { prefix: 'image_', action: 'draft' },
    { prefix: 'video_', action: 'draft' },
    { prefix: 'audio_', action: 'draft' },
    { prefix: 'voice_', action: 'draft' }
  ];

  /* The fail-closed default. NOT 'read_local' and NOT 'plan': an unclassified tool is one this policy cannot
     reason about, and §13's most restrictive action is the only honest answer. It is deliberately the
     SAME action business-permissions.classify() lands on for an unknown id, so "we don't know" reads
     identically on both sides of the bridge. */
  const DEFAULT_ACTION = 'access_sensitive';

  const str = (v, cap) => (v == null ? '' : String(v)).slice(0, cap == null ? 2000 : cap);
  const nameOf = (tool) => (typeof tool === 'string' ? tool : str(tool && tool.name, 200)).trim();

  function familyAction(name) {
    let best = null;
    for (const f of FAMILIES) {
      if (name.indexOf(f.prefix) !== 0) continue;
      if (!best || f.prefix.length > best.prefix.length) best = f;
    }
    return best ? best.action : null;
  }

  /* actionFor(tool, permissions) -> { ok, tool, action, tier, label, source, note, reason }

     `tool` is a registry tool descriptor ({name, scope, requiresConsent, capability, ...}) or a bare name.
     `permissions` is business-permissions.js, injected so this module owns no copy of the tier model and the
     test can prove the two agree. `source` records HOW the action was chosen — 'table', 'family', 'declared'
     or 'default' — because "we knew this tool" and "we guessed" must not look the same in an audit trail. */
  function actionFor(tool, permissions) {
    const P = permissions || null;
    const name = nameOf(tool);
    if (!name) {
      return { ok: false, tool: '', action: DEFAULT_ACTION, tier: 'restricted', label: DEFAULT_ACTION, source: 'default',
        reason: 'a work step with no tool name cannot be classified, so it is refused (fail-closed)' };
    }

    let action = null, source = 'default';
    if (Object.prototype.hasOwnProperty.call(TOOL_ACTIONS, name)) { action = TOOL_ACTIONS[name]; source = 'table'; }
    if (!action) { const fam = familyAction(name); if (fam) { action = fam; source = 'family'; } }
    if (!action) { action = DEFAULT_ACTION; source = 'default'; }

    // the tool's OWN declaration, when we were handed a descriptor rather than a bare name
    const declared = (tool && typeof tool === 'object') ? tool : null;
    const scope = declared && declared.scope ? String(declared.scope) : '';
    const floor = SCOPE_FLOOR[scope] || null;

    // §13's verdict for the chosen action, from the module that owns the vocabulary
    const classified = P && typeof P.classify === 'function'
      ? P.classify(action)
      : { ok: true, id: action, label: action, tier: (action === DEFAULT_ACTION ? 'restricted' : 'review') };

    // property (2): the tool's OWN declaration, reported as a floor on the MECHANISM — never folded into the
    // §13 tier. See the header. `floorAbove` is the mismatch the floor exists to surface.
    const tier = classified.tier;
    const floorAbove = !!(floor && rankOf(floor) > rankOf(tier));

    const reason = floorAbove
      ? 'the policy maps "' + name + '" to ' + action + ' (' + tier + '), and the tool declares scope "' + scope
        + '" which the runtime floors at ' + floor + ' — §13 judges the ACTION as ' + tier + ', the runtime '
        + 'requires ' + floor + '-grade consent for the MECHANISM'
      : (source === 'default'
        ? 'no policy entry matches "' + name + '" — an unclassified tool is refused rather than assumed harmless'
        : 'policy: "' + name + '" is ' + action + ' (' + tier + ')');

    return {
      ok: source !== 'default',
      tool: name,
      action: action,
      tier: tier,
      label: classified.label || action,
      source: source,
      scope: scope || null,
      floor: floor,
      floorAbove: floorAbove,
      // the tool's own declaration, OR a floor above the tier (a write-scoped tool must be consented even if it
      // forgot to declare it) — the runtime gate is required either way.
      requiresConsent: !!(declared && declared.requiresConsent) || floorAbove,
      network: !!(declared && declared.network),
      reason: reason
    };
  }

  /* §13's verdict for one step, given the AGENT's grants. Kept separate from the composition below so the UI
     can show "what the business owner's rules say" and "what the runtime says" as two lines, which is the
     only way a user can tell WHICH system is holding their agent up. */
  function businessVerdict(tool, grants, permissions) {
    const a = actionFor(tool, permissions);
    const P = permissions || null;
    const d = P && typeof P.decide === 'function'
      ? P.decide({ action: a.action, grants: grants })
      : { allow: false, tier: a.tier, approval: 'required', action: a.action,
          reason: 'the §13 permission module was not supplied, so no action can be authorised (fail-closed)' };
    return {
      action: a.action, tier: a.tier, label: a.label, source: a.source,
      scope: a.scope, floor: a.floor, floorAbove: a.floorAbove,
      requiresConsent: a.requiresConsent, network: a.network,
      allow: !!d.allow, approval: d.approval || (d.allow ? 'not-required' : 'required'), reason: d.reason,
      policyReason: a.reason
    };
  }

  /* decideWorker({ tool, grants, consent, permissions, authorized }) -> the COMPOSED verdict.

     Outcome vocabulary — deliberately three values, because "held for a human" and "refused outright" are
     different situations that a two-value allow/deny boolean would flatten:
       'run'  — both systems allow, and the runtime needs no consent
       'ask'  — a human must decide (either system may be the reason; both are reported)
       'deny' — refused, and no approval can change it in this run (a restricted action)

     `authorized` IS THE PER-REQUEST YES, and the distinction it draws is the whole of §13:
       §13 says a review action "needs user approval". business-permissions.decide() reports that as
       `allow:false, approval:'required'` when the agent does not hold the STANDING review grant — i.e. "this
       agent may not do this unattended; put it in front of the owner". `authorized:true` is the owner then
       saying yes to THIS action, once. It therefore satisfies the review gate — and ONLY the review gate.
       A restricted action returns 'deny' on the line above, before `authorized` is ever consulted, so no
       amount of per-request authorization can turn §13's restricted tier into a runnable action. That
       ordering is the security property, not an implementation detail.

     THE FLOOR IS CHECKED SEPARATELY FROM THE TIER. §13's tier governs the ACTION; the tool's own declaration
     governs the MECHANISM. Two consequences, and both are load-bearing:

       · A `write`-scoped tool whose action is safe (fs.write → 'draft') is HELD, not run. The owner has said
         "this agent may draft"; the tool says "this call changes a file". Those are compatible — but only with
         a per-call yes, so the step waits for the runtime consent gate. It is deliberately NOT filed as a §13
         request: §13's tier for the action is safe, business-approvals-store.create() correctly refuses to
         record a safe action as a review request, and a queue entry nobody could honour is worse than none.
       · An `execute`-scoped tool whose action is NOT restricted is REFUSED outright. That combination means
         either the table is wrong or the tool is misdeclared, and a process-spawning mechanism must never ride
         in on a safe grant while the disagreement is unresolved. This is the mismatch the floor exists to
         catch, and fail-closed is the only honest answer to "two of our own declarations disagree".

     `consent` is the runtime broker's outcome: { allow, reason, scope } or undefined when the call needs no
     consent. Passing undefined means "the runtime was not consulted", which for a consent-requiring tool is
     itself a reason to hold — never to run. */
  function decideWorker(input) {
    input = input || {};
    const b = businessVerdict(input.tool, input.grants, input.permissions);
    const consent = (input.consent && typeof input.consent === 'object') ? input.consent : null;
    const consentRequired = b.requiresConsent || (input.consentRequired === true);
    const authorized = input.authorized === true;

    // §13 first: a restricted action is refused and NOTHING — not consent, not a per-request authorization —
    // can rescue it (property 3, and the reason this branch is above the `authorized` check).
    if (b.tier === 'restricted') {
      return {
        outcome: 'deny', action: b.action, tier: b.tier, label: b.label, source: b.source, floor: b.floor,
        why: b.allow ? b.policyReason : b.reason,
        business: { allow: b.allow, approval: b.approval, reason: b.reason },
        consent: consent ? { allow: !!consent.allow, reason: str(consent.reason, 600) } : null
      };
    }

    /* THE MECHANISM FLOOR, checked before the tier's own gate. An execute-scoped tool on a non-restricted
       action is a disagreement between our own declarations — refuse, do not guess. */
    if (b.floor === 'restricted') {
      return {
        outcome: 'deny', action: b.action, tier: b.tier, label: b.label, source: b.source, floor: b.floor,
        why: 'the tool declares scope "execute", so calling it spawns a process — that is a restricted mechanism, '
          + 'and the policy maps "' + b.action + '" to the ' + b.tier + ' tier. Two of our own declarations '
          + 'disagree, so the step is refused rather than run on the weaker of the two.',
        business: { allow: b.allow, approval: b.approval, reason: b.reason },
        consent: consent ? { allow: !!consent.allow, reason: str(consent.reason, 600) } : null
      };
    }

    /* REVIEW. Two things satisfy §13's review gate and both are legitimate readings of it:
         · a STANDING review grant — the owner has already said "this agent may do review actions"; or
         · `authorized` — the owner saying yes to THIS action, once.
       NOTE WHAT IS NOT HERE. An earlier draft required `authorized` for every review step and ignored the
       standing grant. That was written to stop an ESCALATED safe action from slipping through on a safe
       grant — but escalation no longer touches the tier (see the header), so the case it guarded against
       cannot reach this branch, and demanding a per-request yes on top of a grant the owner deliberately
       made would contradict §13 rather than enforce it. The floor, not this line, is what holds a write. */
    if (b.tier === 'review') {
      if (!(b.allow || authorized)) {
        return {
          outcome: 'ask', action: b.action, tier: b.tier, label: b.label, source: b.source, floor: b.floor,
          why: 'a review-tier action — this agent has no standing grant for it, and review is never '
            + 'pre-approved by a safe grant',
          business: { allow: false, approval: b.approval, reason: b.reason },
          consent: consent ? { allow: !!consent.allow, reason: str(consent.reason, 600) } : null
        };
      }
      // allowed: the standing grant or the owner's yes. Fall through to the runtime, which can still refuse.
    } else if (!b.allow) {
      // a SAFE action the agent has no grant for — e.g. the owner revoked `draft` outright
      return {
        outcome: 'ask', action: b.action, tier: b.tier, label: b.label, source: b.source, floor: b.floor,
        why: b.reason,
        business: { allow: false, approval: b.approval, reason: b.reason },
        consent: consent ? { allow: !!consent.allow, reason: str(consent.reason, 600) } : null
      };
    }

    // §13 allows (or the owner authorised this one). The runtime still gets its say — and it can only ever be
    // stricter.
    if (consentRequired && !consent) {
      return {
        outcome: 'ask', action: b.action, tier: b.tier, label: b.label, source: b.source, floor: b.floor,
        why: b.floorAbove
          ? 'the tool declares scope "' + b.scope + '", so the runtime requires ' + b.floor + '-grade consent for '
            + 'this mechanism, and the gate was not consulted — an unasked question is not a yes'
          : 'this tool requires the runtime consent gate, and the gate was not consulted — an unasked question is not a yes',
        business: { allow: true, approval: b.approval, reason: b.reason },
        consent: null
      };
    }
    if (consent && !consent.allow) {
      return {
        outcome: 'ask', action: b.action, tier: b.tier, label: b.label, source: b.source, floor: b.floor,
        why: str(consent.reason, 600) || 'the runtime consent gate refused this call',
        business: { allow: true, approval: b.approval, reason: b.reason },
        consent: { allow: false, reason: str(consent.reason, 600) }
      };
    }

    return {
      outcome: 'run', action: b.action, tier: b.tier, label: b.label, source: b.source, floor: b.floor,
      why: (b.tier === 'review' && authorized)
        ? 'the owner authorised this specific review action, and the runtime allows it'
        : ((!b.allow && authorized) ? 'the owner authorised this specific action, and the runtime allows it'
          : (consentRequired ? 'both systems allow this call' : b.reason)),
      business: { allow: true, approval: b.approval, reason: b.reason },
      consent: consent ? { allow: true, reason: str(consent.reason, 600) } : null
    };
  }

  /* plan(input) -> the work order's PLAN. One row per requested step, each carrying the composed verdict, so
     the whole order can be shown — and approved — BEFORE anything runs. A step is { tool, args?, why }; `why`
     is required because §26 requires a reason and a work order is a sequence of proposed actions.

     `describe(name) -> descriptor | null` is how the caller hands over the tool's OWN declaration so
     SCOPE_FLOOR can fire. It is optional, and its ABSENCE IS THE SAFE DIRECTION for every entry in the table
     except the fs writes: without a descriptor there is no declared scope, so no floor applies and the table's
     tier stands alone. The fs writes are the reason it exists — the table calls them 'draft' precisely so the
     tool's `scope:'write'` can raise them to 'review', and a caller that forgets `describe` would let them run
     on the safe grant. `business-worker.js` therefore always passes it, and its test asserts the escalation. */
  const MAX_STEPS = 12;

  function plan(input) {
    input = input || {};
    const steps = Array.isArray(input.steps) ? input.steps : [];
    const grants = input.grants;
    const permissions = input.permissions;
    const describe = typeof input.describe === 'function' ? input.describe : null;

    if (!steps.length) return { ok: false, reason: 'a work order needs at least one step' };
    if (steps.length > MAX_STEPS) {
      return { ok: false, reason: 'a work order may carry at most ' + MAX_STEPS + ' steps (it has ' + steps.length + ')' };
    }

    const out = [];
    for (let i = 0; i < steps.length; i++) {
      const raw = steps[i] || {};
      const tool = str(raw.tool, 200).trim();
      const why = str(raw.why, 600).trim();
      if (!tool) return { ok: false, reason: 'step ' + (i + 1) + ' has no tool' };
      if (!why) return { ok: false, reason: 'step ' + (i + 1) + ' has no reason — a step nobody can explain must not be queued (§26)' };
      // a describe that throws must not take the plan down with it: falling back to the table alone is the
      // correct degradation, because the table is the axis we are certain about.
      let desc = null;
      if (describe) { try { desc = describe(tool) || null; } catch (e) { desc = null; } }
      const d = decideWorker({
        tool: desc || tool, grants: grants, permissions: permissions,
        consent: raw.consent, consentRequired: raw.consentRequired
      });
      out.push({
        seq: i + 1, tool: tool, args: (raw.args && typeof raw.args === 'object') ? raw.args : {},
        why: why, action: d.action, tier: d.tier, outcome: d.outcome, reason: d.why
      });
    }
    return { ok: true, steps: out, summary: summarise(out) };
  }

  // The counts a user actually needs: how much runs on its own, how much waits for them, how much is refused.
  function summarise(steps) {
    const list = Array.isArray(steps) ? steps : [];
    const s = { total: list.length, run: 0, ask: 0, deny: 0, byTier: { safe: 0, review: 0, restricted: 0 }, unclassified: 0 };
    for (const st of list) {
      if (!st) continue;
      if (st.outcome === 'run') s.run++;
      else if (st.outcome === 'ask') s.ask++;
      else if (st.outcome === 'deny') s.deny++;
      const t = TIER_RANK[st.tier] === undefined ? 'restricted' : st.tier;
      s.byTier[t]++;
      if (st.source === 'default') s.unclassified++;
    }
    return s;
  }

  // The catalogue the UI renders: the table itself, so a user can see WHY a tool got its tier rather than
  // being asked to trust it. Sorted by tier severity then name.
  /* catalog(permissions, describe) — the whole table for the console, so a user can see WHY a tool got its
     tier rather than being asked to trust it.

     `describe` matters here because the table's tier is only HALF the answer: `fs.write` is a safe ACTION
     ('draft') whose MECHANISM the runtime floors at review. A catalogue built from bare names would show the
     tier and hide the floor — i.e. the one surface whose entire purpose is to let a user audit the policy
     would omit the reason a file write still stops for a human. So the descriptor is threaded through and each
     row reports the tier, the declared scope, the derived floor, and `floorAbove` (the two disagreeing).
     `tier` remains §13's verdict and is NEVER widened by the floor — see the header. */
  function catalog(permissions, describe) {
    const rows = [];
    const desc = typeof describe === 'function' ? describe : null;
    for (const name of Object.keys(TOOL_ACTIONS)) {
      let d = null;
      if (desc) { try { d = desc(name) || null; } catch (e) { d = null; } }
      const a = actionFor(d || { name: name }, permissions);
      rows.push({
        tool: name, action: a.action, tier: a.tier, label: a.label, source: a.source,
        scope: a.scope, floor: a.floor, floorAbove: a.floorAbove,
        requiresConsent: a.requiresConsent, network: a.network
      });
    }
    rows.sort((x, y) => (rankOf(y.tier) - rankOf(x.tier)) || (x.tool < y.tool ? -1 : x.tool > y.tool ? 1 : 0));
    return {
      rows: rows,
      families: FAMILIES.map(f => ({ prefix: f.prefix, action: f.action })),
      defaultAction: DEFAULT_ACTION,
      scopeFloor: Object.assign({}, SCOPE_FLOOR),
      tiers: ['safe', 'review', 'restricted'],
      maxSteps: MAX_STEPS
    };
  }

  return {
    TIER_RANK, SCOPE_FLOOR, TOOL_ACTIONS, FAMILIES, DEFAULT_ACTION, MAX_STEPS,
    rankOf, stricter, actionFor, businessVerdict, decideWorker, plan, summarise, catalog
  };
});
