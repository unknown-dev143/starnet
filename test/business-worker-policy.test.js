'use strict';
/* test/business-worker-policy.test.js — the BRIDGE between §13 and the station's tool layer (Business OS P6).

   This is the module that decides, for a tool call, which §13 action it constitutes and whether it may run.
   The load-bearing behaviours:

     · EVERY ACTION ID IS REAL. Every id on the right of TOOL_ACTIONS must exist in business-permissions.js's
       ACTIONS. A rename upstream would otherwise make the policy classify everything as unknown — which reads
       as "very safe" and is actually a dead feature. This is asserted against the LIVE module, not a copy.

     · FAIL-CLOSED ON THE UNKNOWN. An unrecognised tool lands on `access_sensitive` (restricted) and is refused,
       never assumed harmless. So does a step with no tool name.

     · THE TIER IS §13's, THE FLOOR IS THE TOOL'S — TWO AXES, NEVER MERGED. This is the correction of a real
       bug and the reason this test file exists. An earlier draft folded the tool's `scope` into the tier, so
       fs.write (§13 'draft', safe) came back as 'review'. That is incoherent: business-approvals-store.create()
       correctly refuses to file a safe ACTION as a review REQUEST. So `tier` stays §13's verdict on the
       CONSEQUENCE and `floor` carries the runtime's requirement on the MECHANISM, and both must be satisfied.

     · THE FLOOR IS ENFORCED, NOT DECORATIVE. A write-scoped tool whose action is safe is HELD, not run — a
       standing safe grant must not pre-authorise a file mutation. An execute-scoped tool whose action is not
       restricted is REFUSED, because a process-spawning mechanism must never ride in on a safe grant.

     · RESTRICTED IS ABSOLUTE. No consent, no per-request authorization, and no granted tier rescues it, and
       the restricted branch is checked before `authorized` is ever read.

   Total: the module is pure — no IO, no clock, no rng. */
const A = require('./_assert.js');
const M = require('../sidecar/business-worker-policy.js');
const P = require('../sidecar/business-permissions.js');

const TIERS = ['safe', 'review', 'restricted'];

/* ---------- the table binds to the LIVE §13 vocabulary ---------- */
{
  const ids = Object.keys(M.TOOL_ACTIONS);
  A.ok(ids.length >= 60, 'the policy table is substantial (it has ' + ids.length + ' entries)');

  let unknown = [];
  for (const name of ids) {
    const c = P.classify(M.TOOL_ACTIONS[name]);
    if (!c || !c.ok) unknown.push(name + '->' + M.TOOL_ACTIONS[name]);
  }
  A.eq(unknown.length, 0, 'every TOOL_ACTIONS id is a real §13 action id' + (unknown.length ? ' — unknown: ' + unknown.join(', ') : ''));

  // every tier the table can produce is one §13 actually has
  let badTier = [];
  for (const name of ids) {
    const t = P.classify(M.TOOL_ACTIONS[name]).tier;
    if (TIERS.indexOf(t) < 0) badTier.push(name);
  }
  A.eq(badTier.length, 0, 'every classified tier is one of safe/review/restricted');

  // the fail-closed default must be §13's most restrictive action, and must classify as restricted
  A.ok(M.DEFAULT_ACTION === 'access_sensitive',
    'the fail-closed default is §13 access_sensitive (it is "' + M.DEFAULT_ACTION + '")');
  A.eq(P.classify(M.DEFAULT_ACTION).tier, 'restricted', 'and that default classifies as restricted');

  // the default must land on the SAME TIER §13 gives an unknown id, so "we don't know" reads identically on
  // both sides of the bridge. (§13 echoes the unknown id back rather than renaming it, so the TIER is the
  // thing the two must agree on.)
  A.eq(P.classify('definitely-not-an-action').tier, P.classify(M.DEFAULT_ACTION).tier,
    '§13 and the policy agree on the tier of an unclassified action');
}

/* ---------- rank / stricter ---------- */
{
  A.eq(M.rankOf('safe'), 0, 'safe ranks 0');
  A.eq(M.rankOf('review'), 1, 'review ranks 1');
  A.eq(M.rankOf('restricted'), 2, 'restricted ranks 2');
  A.eq(M.rankOf('nonsense'), M.rankOf('restricted'), 'an unknown tier ranks as restricted (fail-closed)');
  A.eq(M.stricter('safe', 'restricted'), 'restricted', 'stricter() picks the more severe');
  A.eq(M.stricter('restricted', 'safe'), 'restricted', 'and is order-independent');
  A.eq(M.stricter('review', 'review'), 'review', 'and ties resolve to the tier itself');
  A.eq(M.SCOPE_FLOOR.read, 'safe', 'a read-scoped tool floors at safe');
  A.eq(M.SCOPE_FLOOR.write, 'review', 'a write-scoped tool floors at review');
  A.eq(M.SCOPE_FLOOR.execute, 'restricted', 'an execute-scoped tool floors at restricted');
}

/* ---------- actionFor: source, and fail-closed on the unknown ---------- */
{
  const known = M.actionFor('fs.read', P);
  A.eq(known.tool, 'fs.read', 'actionFor reports the tool name');
  A.eq(known.action, 'read_local', 'fs.read is §13 read_local');
  A.eq(known.tier, 'safe', 'and read_local is safe-tier');
  A.eq(known.source, 'table', 'and it came from the table');
  A.ok(known.ok === true, 'a table hit is ok:true');

  // family fallback: a name the table lacks but a prefix rule covers
  const fam = M.actionFor('notebook.jot', P);
  A.eq(fam.source, 'family', 'an un-enumerated notebook.* falls back to the family rule');
  A.eq(fam.action, 'draft', 'and the notebook family is §13 draft');

  // the fail-closed default
  const unknown = M.actionFor('totally.made.up', P);
  A.eq(unknown.source, 'default', 'an unknown tool is classified by the default');
  A.eq(unknown.action, M.DEFAULT_ACTION, 'and lands on access_sensitive');
  A.eq(unknown.tier, 'restricted', 'which is restricted');
  A.ok(unknown.ok === false, 'an unclassified tool is ok:false — never silently safe');

  // no tool name at all
  const none = M.actionFor('', P);
  A.ok(none.ok === false, 'a step with no tool name is refused');
  A.eq(none.tier, 'restricted', 'and is treated as restricted');

  // a descriptor with no name falls back the same way
  A.ok(M.actionFor({}, P).ok === false, 'an empty descriptor is refused too');
}

/* ---------- THE TWO AXES: tier is §13's, floor is the tool's ---------- */
{
  // fs.write is a DRAFT (safe) action whose mechanism is a WRITE (review floor). Both facts must be present
  // and neither may overwrite the other.
  const w = M.actionFor({ name: 'fs.write', scope: 'write', requiresConsent: true, capability: 'cabinet' }, P);
  A.eq(w.action, 'draft', 'fs.write is §13 draft');
  A.eq(w.tier, 'safe', 'THE TIER IS §13\'S: draft is safe, and the write scope must NOT widen it');
  A.eq(w.scope, 'write', 'the declared scope is reported');
  A.eq(w.floor, 'review', 'THE FLOOR IS THE TOOL\'S: a write floors the mechanism at review');
  A.ok(w.floorAbove === true, 'and the mismatch between them is reported, not hidden');
  A.ok(w.requiresConsent === true, 'a write-scoped tool requires the runtime consent gate');
  A.eq(w.source, 'table', 'the action still came from the table');

  // the store's invariant is the reason these must stay separate: a safe ACTION cannot be filed as a review
  // REQUEST. Prove the two agree by asking §13 directly.
  A.eq(P.classify(w.action).tier, w.tier,
    'the reported tier is exactly what §13 says about the action — so it can be filed');

  // a read-scoped tool has no mismatch
  const r = M.actionFor({ name: 'fs.read', scope: 'read' }, P);
  A.eq(r.tier, 'safe', 'fs.read is safe-tier');
  A.eq(r.floor, 'safe', 'and a read floors at safe');
  A.ok(r.floorAbove === false, 'so there is no mismatch');
  A.ok(r.requiresConsent === false, 'and no consent is required');

  /* AN EXECUTE-SCOPED TOOL IS THE MISMATCH THE FLOOR EXISTS TO CATCH. It must not be reported as safe just
     because its action is. */
  const e = M.actionFor({ name: 'fs.read', scope: 'execute' }, P);
  A.eq(e.action, 'read_local', 'the ACTION is still read_local');
  A.eq(e.tier, 'safe', 'the tier is still §13\'s (read_local is safe)');
  A.eq(e.floor, 'restricted', 'but the MECHANISM floors at restricted');
  A.ok(e.floorAbove === true, 'and that is flagged');
  A.ok(e.requiresConsent === true, 'so it requires the runtime gate');
}

/* ---------- decideWorker: restricted is absolute ---------- */
{
  const grants = { safe: true, review: true, restricted: true };
  const restricted = M.decideWorker({ tool: { name: 'shell.exec' }, grants: grants, permissions: P });
  A.eq(restricted.outcome, 'deny', 'a restricted action is denied');
  A.eq(restricted.tier, 'restricted', 'and reports restricted');

  // NOTHING rescues it: consent, nor the owner's per-request yes, nor the agent holding every grant
  const withConsent = M.decideWorker({
    tool: { name: 'shell.exec' }, grants: grants, permissions: P,
    consent: { allow: true, reason: 'sure' }
  });
  A.eq(withConsent.outcome, 'deny', 'a consent allow does NOT rescue a restricted action');

  const withAuth = M.decideWorker({
    tool: { name: 'shell.exec' }, grants: grants, permissions: P, authorized: true
  });
  A.eq(withAuth.outcome, 'deny', 'the owner\'s per-request yes does NOT rescue a restricted action');

  const both = M.decideWorker({
    tool: { name: 'shell.exec' }, grants: grants, permissions: P,
    consent: { allow: true, reason: 'sure' }, authorized: true
  });
  A.eq(both.outcome, 'deny', 'neither together rescues it either');
}

/* ---------- decideWorker: the floor holds a write, even on a standing safe grant ---------- */
{
  const grants = P.DEFAULT_GRANTS;
  A.eq(grants.safe, true, 'the default grants include the safe tier');

  // the escalation that must NOT happen: fs.write with no consent consulted
  const held = M.decideWorker({
    tool: { name: 'fs.write', scope: 'write', requiresConsent: true, capability: 'cabinet' },
    grants: grants, permissions: P
  });
  A.eq(held.outcome, 'ask', 'a write-scoped tool is HELD, not run, even though its action is safe');
  A.eq(held.tier, 'safe', 'and it is still reported as §13 safe — the tier was not widened');
  A.eq(held.floor, 'review', 'the reason is the review FLOOR on the mechanism');
  A.ok(/consent/.test(held.why), 'and the reason names the consent gate (' + held.why.slice(0, 60) + '…)');

  // the runtime refusing is also a hold
  const refused = M.decideWorker({
    tool: { name: 'fs.write', scope: 'write', requiresConsent: true, capability: 'cabinet' },
    grants: grants, permissions: P, consent: { allow: false, reason: 'silence is not consent' }
  });
  A.eq(refused.outcome, 'ask', 'a consent refusal holds the step');
  A.eq(refused.consent.allow, false, 'and the refusal is reported, not flattened into a generic hold');

  // the runtime allowing is the only thing that lets it run
  const allowed = M.decideWorker({
    tool: { name: 'fs.write', scope: 'write', requiresConsent: true, capability: 'cabinet' },
    grants: grants, permissions: P, consent: { allow: true, reason: 'previously granted' }
  });
  A.eq(allowed.outcome, 'run', 'a consent allow lets a write run');
}

/* ---------- decideWorker: an execute-scoped mechanism on a safe action is REFUSED ---------- */
{
  // the two declarations disagree; the only honest answer is to refuse, not to pick the weaker one
  const clash = M.decideWorker({
    tool: { name: 'fs.read', scope: 'execute' }, grants: P.DEFAULT_GRANTS, permissions: P,
    consent: { allow: true, reason: 'allowed' }
  });
  A.eq(clash.outcome, 'deny', 'an execute-scoped tool is refused even when its action is safe');
  A.ok(/execute/.test(clash.why), 'and the reason names the mechanism (' + clash.why.slice(0, 60) + '…)');
  A.ok(clash.consent && clash.consent.allow === true, 'a consent allow does not rescue a declaration clash');
}

/* ---------- decideWorker: review needs the owner's per-request yes ---------- */
{
  const tool = { name: 'channel.send', scope: 'write', requiresConsent: true };
  const grants = P.DEFAULT_GRANTS;   // review:false — the agent has no standing review grant

  const asked = M.decideWorker({ tool: tool, grants: grants, permissions: P, consent: { allow: true, reason: 'ok' } });
  A.eq(asked.outcome, 'ask', 'a review action with no standing grant is held');
  A.eq(asked.tier, 'review', 'and reports review');
  A.eq(asked.business.allow, false, 'the business verdict is a refusal');
  A.eq(asked.business.approval, 'required', 'and it says an approval is required');

  // the owner authorising THIS action satisfies the review gate
  const auth = M.decideWorker({ tool: tool, grants: grants, permissions: P, authorized: true, consent: { allow: true, reason: 'ok' } });
  A.eq(auth.outcome, 'run', 'the owner\'s per-request yes satisfies the review gate');
  A.ok(/authoris/.test(auth.why), 'and the reason says so (' + auth.why.slice(0, 60) + '…)');

  // a STANDING review grant also satisfies it
  const standing = M.decideWorker({
    tool: tool, grants: { safe: true, review: true, restricted: false }, permissions: P,
    consent: { allow: true, reason: 'ok' }
  });
  A.eq(standing.outcome, 'run', 'a standing review grant satisfies the review gate');

  /* A REVIEW STEP STILL NEEDS THE RUNTIME'S SAY. §13 allowing is half the answer — the consent gate is
     checked after and can only ever be stricter. */
  const noConsent = M.decideWorker({ tool: tool, grants: grants, permissions: P, authorized: true });
  A.eq(noConsent.outcome, 'ask', 'an authorised review step is still held when the runtime gate was not asked');
  A.ok(/not consulted/.test(noConsent.why), 'and the reason says the gate was not consulted');
}

/* ---------- decideWorker: a safe action the agent has no grant for ---------- */
{
  const noSafe = M.decideWorker({ tool: { name: 'fs.read', scope: 'read' }, grants: { safe: false }, permissions: P });
  A.eq(noSafe.outcome, 'ask', 'a safe action is held when the agent has no safe grant');
  A.eq(noSafe.business.allow, false, 'and the business verdict reflects that');
}

/* ---------- decideWorker is total: no throw on malformed input ---------- */
{
  A.notThrows(() => M.decideWorker(), 'decideWorker() with no arguments does not throw');
  A.notThrows(() => M.decideWorker({}), 'decideWorker({}) does not throw');
  A.eq(M.decideWorker({}).outcome, 'deny', 'and an unclassifiable input is refused, not run');
  A.notThrows(() => M.decideWorker({ tool: null, grants: null, permissions: null }), 'null deps do not throw');
  // consent is only honoured when it is an object — a bare `true` must not be read as an allow
  const bogus = M.decideWorker({ tool: { name: 'fs.write', scope: 'write', requiresConsent: true }, grants: P.DEFAULT_GRANTS, permissions: P, consent: true });
  A.eq(bogus.outcome, 'ask', 'a non-object consent is treated as "the gate was not asked"');
}

/* ---------- plan: the whole order is classified before anything runs ---------- */
{
  // `describe` is supplied, as the runner always does — without it the fs.write step has no declared scope and
  // the floor cannot fire (that difference is asserted in its own block below).
  const DESCRIBE = (n) => ({
    'fs.read': { name: n, scope: 'read' },
    'fs.write': { name: n, scope: 'write', requiresConsent: true, capability: 'cabinet' },
    'shell.exec': { name: n, scope: 'execute', capability: 'workbench' }
  }[n] || null);

  const r = M.plan({
    steps: [
      { tool: 'fs.read', args: { path: 'a' }, why: 'read' },
      { tool: 'fs.write', args: { path: 'b' }, why: 'write' },
      { tool: 'shell.exec', args: { cmd: 'ls' }, why: 'look' }
    ],
    grants: P.DEFAULT_GRANTS, permissions: P, describe: DESCRIBE
  });
  A.ok(r.ok, 'a plan with well-formed steps is accepted');
  A.eq(r.steps.length, 3, 'one row per step');
  A.eq(r.steps[0].seq, 1, 'seq starts at 1');
  A.eq(r.steps[0].outcome, 'run', 'the read is planned to run');
  A.eq(r.steps[1].outcome, 'ask', 'the write is planned to be held');
  A.eq(r.steps[2].outcome, 'deny', 'the shell is planned to be refused');
  A.eq(r.summary.run, 1, 'the summary counts one run');
  A.eq(r.summary.ask, 1, 'one held');
  A.eq(r.summary.deny, 1, 'one denied');

  // nothing was executed by planning: the rows carry verdicts, not results
  for (const s of r.steps) A.ok(s.status === undefined, 'a planned step carries no execution status');
}

/* ---------- plan: `why` is mandatory (§26) and the step count is bounded ---------- */
{
  A.ok(!M.plan({ steps: [], grants: P.DEFAULT_GRANTS, permissions: P }).ok, 'an empty plan is refused');
  A.ok(!M.plan({ grants: P.DEFAULT_GRANTS, permissions: P }).ok, 'a missing steps array is refused');

  const noWhy = M.plan({ steps: [{ tool: 'fs.read', why: '  ' }], grants: P.DEFAULT_GRANTS, permissions: P });
  A.ok(!noWhy.ok, 'a step with no reason is refused');
  A.ok(/reason/.test(noWhy.reason), 'and the refusal names the missing reason');

  const noTool = M.plan({ steps: [{ why: 'because' }], grants: P.DEFAULT_GRANTS, permissions: P });
  A.ok(!noTool.ok, 'a step with no tool is refused');

  const many = [];
  for (let i = 0; i < M.MAX_STEPS + 1; i++) many.push({ tool: 'fs.read', why: 'x' });
  const over = M.plan({ steps: many, grants: P.DEFAULT_GRANTS, permissions: P });
  A.ok(!over.ok, 'a plan over MAX_STEPS is refused');
  A.ok(new RegExp(String(M.MAX_STEPS)).test(over.reason), 'and the refusal names the limit');
}

/* ---------- plan: `describe` is what makes the floor real ---------- */
{
  const steps = [{ tool: 'fs.write', args: { path: 'b' }, why: 'write it' }];

  // WITHOUT the descriptor there is no declared scope, so no floor — the write would be planned to RUN.
  const bare = M.plan({ steps: steps, grants: P.DEFAULT_GRANTS, permissions: P });
  A.eq(bare.steps[0].outcome, 'run', 'without a descriptor the table alone says draft/safe → run');

  // WITH it, the floor fires and the write is held. The difference between these two is the whole reason
  // `describe` exists, so both halves are asserted.
  const withDesc = M.plan({
    steps: steps, grants: P.DEFAULT_GRANTS, permissions: P,
    describe: (n) => (n === 'fs.write' ? { name: n, scope: 'write', requiresConsent: true, capability: 'cabinet' } : null)
  });
  A.eq(withDesc.steps[0].outcome, 'ask', 'with the real descriptor the write floors at review → held');
  A.eq(withDesc.steps[0].tier, 'safe', 'and the tier is STILL §13 safe — the floor does not widen it');

  // a throwing describe must not crash the plan
  const boom = M.plan({
    steps: steps, grants: P.DEFAULT_GRANTS, permissions: P,
    describe: () => { throw new Error('boom'); }
  });
  A.ok(boom.ok, 'a describe that throws is survived');
  A.eq(boom.steps[0].outcome, 'run', 'and the plan falls back to the table alone');
}

/* ---------- businessVerdict: the two systems are reported separately ---------- */
{
  const v = M.businessVerdict({ name: 'fs.write', scope: 'write', requiresConsent: true }, P.DEFAULT_GRANTS, P);
  A.eq(v.action, 'draft', 'the action is reported');
  A.eq(v.tier, 'safe', 'the §13 tier is reported');
  A.eq(v.floor, 'review', 'the runtime floor is reported');
  A.ok(v.floorAbove === true, 'and the disagreement is flagged');
  A.eq(v.allow, true, 'the business verdict for a safe action with a safe grant is allow');
  A.ok(typeof v.reason === 'string' && v.reason.length > 0, 'and it carries a reason');

  // with no permissions module at all, nothing can be authorised (fail-closed)
  const none = M.businessVerdict({ name: 'fs.read' }, P.DEFAULT_GRANTS, null);
  A.eq(none.allow, false, 'with no permissions module nothing is authorised');
}

/* ---------- catalog: the console's view is the effective rule, not the table's ---------- */
{
  const c = M.catalog(P);
  A.ok(c.rows.length >= 60, 'the catalog lists every table entry (' + c.rows.length + ')');
  A.eq(c.tiers.length, 3, 'and reports the three tiers');
  A.eq(c.maxSteps, M.MAX_STEPS, 'and the step limit the runner enforces');
  A.ok(c.scopeFloor && c.scopeFloor.write === 'review', 'and the scope floor, so the UI can explain a hold');

  // every row carries both axes
  for (const r of c.rows) {
    A.ok(r.tier !== undefined && r.floor !== undefined && r.scope !== undefined, 'row ' + r.tool + ' carries tier, floor and scope');
    A.ok(TIERS.indexOf(r.tier) >= 0, 'row ' + r.tool + ' has a valid tier');
  }

  // WITH a descriptor, fs.write must report its floor rather than advertising itself as safe-and-clear
  const cd = M.catalog(P, (n) => (n === 'fs.write' ? { name: n, scope: 'write', requiresConsent: true } : null));
  const row = cd.rows.filter(r => r.tool === 'fs.write')[0];
  A.eq(row.tier, 'safe', 'the catalog still shows the §13 tier');
  A.eq(row.floor, 'review', 'but ALSO the review floor — a user auditing the policy sees why it stops');
  A.ok(row.floorAbove === true, 'and the mismatch flag');

  // a throwing describe is survived
  const cb = M.catalog(P, () => { throw new Error('boom'); });
  A.ok(cb.rows.length === c.rows.length, 'a throwing describe does not shrink the catalog');
}

/* ---------- summarise ---------- */
{
  const s = M.summarise([
    { tier: 'safe', outcome: 'run' }, { tier: 'safe', outcome: 'run' },
    { tier: 'safe', outcome: 'ask' }, { tier: 'restricted', outcome: 'deny' }
  ]);
  A.eq(s.total, 4, 'the summary totals the steps');
  A.eq(s.run, 2, 'counts the runs');
  A.eq(s.ask, 1, 'counts the holds');
  A.eq(s.deny, 1, 'counts the refusals');
  A.eq(s.byTier.safe, 3, 'and breaks them down by tier');
  A.eq(s.byTier.restricted, 1, 'including the restricted one');
}

/* ---------- THE BROWSER (§10) — every browser tool is REACHABLE and CLASSIFIED ----------
   Regression pin for a real, verified gap (found live 2026-09-26). The table previously held exactly ONE
   browser entry — `browser.login` — and there was no `browser.` family, so 34 of the 35 browser tools
   (tools/builtin/browser.js) fell through to the fail-closed DEFAULT. That is SAFE but it made a mature,
   2,873-line browser layer unreachable by a business worker: a dead capability, not a protected one.

   These locks fail if the browser surface ever silently loses its classification again. */
{
  // The 35 tools tools/builtin/browser.js actually declares (read via its makeBrowserTools helpers).
  const BROWSER_TOOLS = [
    'browser.attach', 'browser.back', 'browser.click', 'browser.console', 'browser.detach',
    'browser.dialog', 'browser.drag', 'browser.emulate', 'browser.eval', 'browser.find',
    'browser.forward', 'browser.get_text', 'browser.hover', 'browser.inspect', 'browser.intercept',
    'browser.login', 'browser.navigate', 'browser.network', 'browser.pdf', 'browser.press',
    'browser.screenshot', 'browser.scroll', 'browser.select', 'browser.snapshot', 'browser.tab_close',
    'browser.tab_select', 'browser.tabs', 'browser.test_input', 'browser.test_navigate',
    'browser.test_snapshot', 'browser.test_state', 'browser.type', 'browser.upload', 'browser.viewport',
    'browser.vision', 'browser.wait'
  ];
  const unclassified = BROWSER_TOOLS.filter(t => { const r = M.actionFor(t, P); return !r.ok || r.source === 'default'; });
  A.eq(unclassified.length, 0,
    'NO browser tool falls to the fail-closed default — the browser is reachable by the worker'
    + (unclassified.length ? ' (unclassified: ' + unclassified.join(', ') + ')' : ''));

  // classification is explicit (table), not a guess rescued by a family
  const byTable = BROWSER_TOOLS.filter(t => M.actionFor(t, P).source === 'table');
  A.eq(byTable.length, BROWSER_TOOLS.length, 'every browser tool is classified by the TABLE, not a family fallback');

  // the SPLIT is the whole point: observing ≠ acting
  const tierOf = (t) => M.actionFor(t, P).tier;
  A.eq(tierOf('browser.snapshot'), 'safe', 'reading a page (snapshot) is safe');
  A.eq(tierOf('browser.get_text'), 'safe', 'reading text is safe');
  A.eq(tierOf('browser.navigate'), 'safe', 'navigation alone is research, matching web_fetch');
  A.eq(tierOf('browser.click'), 'restricted', 'clicking acts in the world, so it is restricted');
  A.eq(tierOf('browser.type'), 'restricted', 'typing into a form is restricted');
  A.eq(tierOf('browser.upload'), 'restricted', 'an upload can publish, so it is restricted');
  A.eq(tierOf('browser.eval'), 'restricted', "arbitrary page JS is the browser's shell.exec — restricted");
  A.eq(tierOf('browser.intercept'), 'restricted', 'rewriting responses is restricted');
  A.eq(tierOf('browser.login'), 'restricted', 'logging in is access_sensitive → restricted');
  A.eq(tierOf('browser.attach'), 'restricted', 'adopting an existing authenticated session is access_sensitive');
  A.eq(M.actionFor('browser.attach', P).action, 'access_sensitive', 'and it is named as sensitive access, not mere infra');

  // the test rig drives a throwaway page the agent built, so it is drafting, not real-world action
  for (const t of ['browser.test_navigate', 'browser.test_snapshot', 'browser.test_state', 'browser.test_input']) {
    A.eq(tierOf(t), 'safe', t + ' is internal test-rig work → safe');
  }

  // A NEW browser tool added upstream arrives REFUSED, not silently safe and not silently dead.
  const novel = M.actionFor('browser.teleport', P);
  A.ok(novel.ok === true && novel.source === 'family', 'an unenumerated browser.* name is still classified (family)');
  A.eq(novel.tier, 'restricted', 'and it arrives restricted, so it is refused rather than waved through');
  A.eq(novel.action, 'change_infra', 'via the browser. family');

  // the read-only family members are reachable by NAME too (a rename would otherwise regress silently)
  for (const t of ['browser.console', 'browser.find', 'browser.inspect', 'browser.network', 'browser.tabs',
    'browser.pdf', 'browser.screenshot', 'browser.vision', 'browser.wait']) {
    A.eq(tierOf(t), 'safe', t + ' stays reachable as a read');
  }

  // and the worker catalog agrees: browser rows are present, wired, and tier-tagged
  const cat = M.catalog(P);
  const browserRows = cat.rows.filter(r => r.tool.indexOf('browser.') === 0);
  A.ok(browserRows.length >= BROWSER_TOOLS.length, 'the worker catalog lists every browser tool');
  A.ok(browserRows.every(r => r.tier !== undefined), 'each browser row carries a tier');
}

A.report('business-worker-policy');
