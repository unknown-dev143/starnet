'use strict';
/* test/business-approvals-store.test.js — the §13 APPROVAL QUEUE (Business OS Phase 5).

   The load-bearing behaviours:
     · THE §26 FLOOR. A pending request can ONLY be created through business-permissions.proposedAction,
       so every row carries a what/why/risk and at least one NON-unknown evidence item. A request with no
       why, no evidence, or evidence that is entirely `unknown` is REFUSED — there is no constructor path
       that skips the block (P1).
     · ONLY REVIEW NEEDS APPROVAL. A safe-tier or restricted-tier request is refused here, so the queue
       cannot be used to launder a safe action into a "decision", or to sneak a restricted one in.
     · A DECISION IS FINAL. decide() refuses any row that is not pending, which is what makes it safe for
       the engine to execute the action inside the approve path: the pending → approved transition happens
       ONCE, so a double-click cannot run the action twice.
     · PERSIST-BEFORE-COMMIT. A throwing persist leaves memory untouched and returns ok:false.
     · P6. Reads and clears are business-scoped; an empty businessId is refused, never read as "all". */
const A = require('./_assert.js');
const M = require('../sidecar/business-approvals-store.js');
const P = require('../sidecar/business-permissions.js');

const NOW = 1_700_000_000_000;
function mk(extra) {
  return M.makeBusinessApprovalsStore(Object.assign({ records: [], now: () => NOW, permissions: P }, extra || {}));
}
const EV = [{ text: 'a real event fired', evidence: 'verified', source: 'event:task.created' }];
function req(over) {
  return Object.assign({
    action: 'spend_money', actionId: 'spend_money', tier: 'review',
    params: { amount: '10', currency: 'USD', description: 'ads' },
    what: 'Spend 10 USD', why: 'the rule said so', evidence: EV, risk: 'high', effect: '{}'
  }, over || {});
}

/* ---------- construction guards ---------- */
{
  // a caller-supplied permissions object that cannot classify is refused at BUILD time, so no row can ever
  // be queued without a §26 block behind it.
  A.throws(() => M.makeBusinessApprovalsStore({ records: [], now: () => NOW, permissions: {} }),
    'the store refuses to build with a permissions object that cannot propose an action');
  A.notThrows(() => M.makeBusinessApprovalsStore({ records: [], now: () => NOW }),
    'and it falls back to the module-level business-permissions.js when none is injected');
  A.eq(M.STATUSES, ['pending', 'approved', 'rejected', 'expired'], 'the status vocabulary is the closed four');
  A.eq(M.OPEN_STATUS, 'pending', 'the open status is named once, not spelled inline');
}

/* ---------- create: the §26 floor ---------- */
{
  const s = mk();
  A.eq(s.create('', req()).ok, false, 'create refuses an empty businessId (P6)');
  A.eq(s.create('acme', req({ action: '' })).ok, false, 'create refuses a request with no action');
  A.eq(s.create('acme', req({ tier: 'safe' })).ok, false, 'create refuses a SAFE-tier request — only review needs approval');
  A.eq(s.create('acme', req({ tier: '' })).ok, false, 'create refuses an unset tier');
  A.eq(s.create('acme', req({ tier: 'restricted' })).ok, false, 'create refuses a restricted-tier request');
  A.eq(s.create('acme', req({ params: {} })).ok, false, 'create refuses a request with no resolved params');
  A.eq(s.create('acme', req({ why: '' })).ok, false, 'create refuses a request with no WHY (§26)');
  A.eq(s.create('acme', req({ what: '' })).ok, false, 'create refuses a request with no WHAT (§26)');
  A.eq(s.create('acme', req({ evidence: [] })).ok, false, 'create refuses a request with NO evidence (P1)');
  A.eq(s.create('acme', req({ evidence: [{ text: 'dunno', evidence: 'unknown' }] })).ok, false,
    'create refuses evidence that is ENTIRELY unknown (P1)');
  A.eq(s.create('acme', req({ risk: 'catastrophic' })).ok, false, 'create refuses an unknown §26 risk');
  A.eq(s.create('acme', req({ risk: '' })).ok, false, 'create refuses a missing §26 risk');

  const r = s.create('acme', req());
  A.eq(r.ok, true, 'a well-formed review request is queued');
  A.ok(/^acme~v\d+$/.test(r.approval.id), 'the id is <businessId>~v<seq> (' + r.approval.id + ')');
  A.ok(r.approval.id.indexOf('#') < 0, "the id contains no '#'");
  A.eq(r.approval.status, 'pending', 'a new request is pending');
  A.eq(r.approval.decidedAt, null, 'a pending request has no decision timestamp');
  A.eq(r.approval.decidedBy, '', 'a pending request has no decider');
  A.eq(r.approval.tier, 'review', 'the tier is stored on the row');
  A.eq(r.approval.action, 'spend_money', 'the PERMISSION action is stored (what the tier was classified against)');
  A.eq(r.approval.automationAction, 'spend_money', 'the AUTOMATION action is stored separately (what to execute)');
  A.eq(r.approval.params.amount, '10', 'the resolved params round-trip, so what the user read is what runs');
  A.eq(r.approval.evidence.length, 1, 'the evidence survives');
  A.eq(r.approval.evidence[0].evidence, 'verified', 'and keeps its class');

  // the tier-mismatch guard: the block (what the user reads) wins over the caller's claim
  const mism = s.create('acme', req({ action: 'report', actionId: 'notify', tier: 'review' }));
  A.eq(mism.ok, false, 'a request claiming review for a SAFE action is refused (the block wins)');
  A.ok(/safe/.test(mism.reason), 'and the refusal names the real tier');
}

/* ---------- the automation action and the permission action are NOT the same field ---------- */
{
  const s = mk();
  const r = s.create('acme', req({ action: 'external_comms', actionId: 'send_external', params: { to: 'a@b.c', subject: 's', body: 'b' } }));
  A.eq(r.ok, true, 'an external_comms request is queued');
  A.eq(r.approval.action, 'external_comms', 'the permission action is stored for the tier');
  A.eq(r.approval.automationAction, 'send_external', 'the automation action is stored for execution — they differ');
}

/* ---------- decide: a decision is FINAL ---------- */
{
  const s = mk();
  const r = s.create('acme', req()).approval;
  A.eq(s.decide(r.id, { decision: 'maybe' }).ok, false, 'an unknown decision verb is refused');
  A.eq(s.decide(r.id, {}).ok, false, 'a missing decision verb is refused');
  A.eq(s.decide('nope', { decision: 'approve' }).ok, false, 'deciding an unknown id is refused');

  const ap = s.decide(r.id, { decision: 'approve', by: 'Andrew' });
  A.eq(ap.ok, true, 'approve succeeds');
  A.eq(ap.approval.status, 'approved', 'the row is approved');
  A.eq(ap.approval.decidedBy, 'Andrew', 'WHO decided is recorded (§19 accountability)');
  A.eq(ap.approval.decidedAt, NOW, 'WHEN is recorded');
  A.eq(ap.decision, 'approve', 'the decision verb is echoed');

  const again = s.decide(r.id, { decision: 'approve' });
  A.eq(again.ok, false, 'approving twice is REFUSED — this is the guard that makes approve() safe to execute on');
  A.eq(again.status, 'approved', 'and the refusal reports the settled status');
  A.eq(s.decide(r.id, { decision: 'reject' }).ok, false, 'an approved request cannot be flipped to rejected');
  A.eq(s.get(r.id).status, 'approved', 'the status never moved');

  const r2 = s.create('acme', req()).approval;
  const rj = s.decide(r2.id, { decision: 'reject', reason: 'not now' });
  A.eq(rj.ok, true, 'reject succeeds');
  A.eq(rj.approval.status, 'rejected', 'the row is rejected');
  A.eq(rj.approval.reason, 'not now', 'the rejection reason is kept');
  A.eq(s.decide(r2.id, { decision: 'approve' }).ok, false, 'a rejected request cannot be flipped to approved');
  A.eq(s.decide(r2.id, { decision: 'reject' }).ok, false, 'and it cannot be rejected twice either');

  // the default decider is 'user', never a blank
  const r3 = s.create('acme', req()).approval;
  A.eq(s.decide(r3.id, { decision: 'approve' }).approval.decidedBy, 'user', 'a missing `by` defaults to "user", not empty');
}

/* ---------- expire ---------- */
{
  const s = mk();
  const a1 = s.create('acme', req({ automationId: 'acme~a1' })).approval;
  const a2 = s.create('acme', req({ automationId: 'acme~a2' })).approval;
  const a3 = s.create('acme', req({ automationId: 'acme~a1' })).approval;
  A.eq(s.pendingCount('acme'), 3, 'three requests are pending');
  const ex = s.expireForAutomation('acme~a1', 'the automation was removed');
  A.eq(ex.expired, 2, 'expireForAutomation expires every PENDING request from that automation');
  A.eq(s.get(a1.id).status, 'expired', 'the first is expired');
  A.eq(s.get(a3.id).status, 'expired', 'the third is expired');
  A.eq(s.get(a2.id).status, 'pending', 'the other automation\'s request is untouched');
  A.eq(s.expireForAutomation('acme~a1').expired, 0, 'expiring again expires nothing (already settled)');
  A.eq(s.expire(a2.id).expired, 1, 'expire settles a single request');
  A.eq(s.expire(a2.id).expired, 0, 'expiring a settled row is a no-op');
  A.eq(s.expire('nope').expired, 0, 'expiring an unknown id is a no-op');
  // expireForBusiness
  const b1 = s.create('acme', req()).approval;
  const b2 = s.create('beta', req()).approval;
  A.eq(s.expireForBusiness('', 'x').ok, false, 'expireForBusiness refuses an empty businessId (P6)');
  A.eq(s.expireForBusiness('acme').expired, 1, 'expireForBusiness expires only that business\'s pending rows');
  A.eq(s.get(b2.id).status, 'pending', 'the other business\'s request is untouched (P6)');
  // a decided row is never expired
  const c1 = s.create('acme', req()).approval;
  s.decide(c1.id, { decision: 'approve' });
  A.eq(s.expire(c1.id).expired, 0, 'a DECIDED row cannot be expired — its receipt stands');
  A.eq(s.get(c1.id).status, 'approved', 'and it keeps its decision');
}

/* ---------- reads, counts, summary, P6 ---------- */
{
  const s = mk();
  s.create('acme', req());
  const d = s.create('acme', req()).approval;
  s.decide(d.id, { decision: 'reject' });
  s.create('beta', req());

  A.eq(s.list('acme').length, 2, 'list is scoped to one business');
  A.eq(s.list('beta').length, 1, 'the other business sees only its own');
  A.eq(s.list('').length, 0, 'an empty businessId lists NOTHING rather than everything (P6)');
  A.eq(s.list('acme', { status: 'pending' }).length, 1, 'list filters by status');
  A.eq(s.list('acme', { status: 'rejected' }).length, 1, 'and by another status');
  A.eq(s.list('acme', { status: 'nope' }).length, 0, 'an unknown status filter matches nothing');
  A.eq(s.count('acme'), 2, 'count is scoped');
  A.eq(s.count('acme', 'pending'), 1, 'count filters by status');
  A.eq(s.count('', 'pending'), 0, 'count of an empty businessId is 0');
  A.eq(s.pendingCount('acme'), 1, 'pendingCount is the §19 number the UI shows');
  A.eq(s.pendingCount('beta'), 1, 'and it is per business');
  A.eq(s.pendingBusinessIds(), ['acme', 'beta'], 'pendingBusinessIds lists every business with a decision waiting');

  const sum = s.summary('acme');
  A.eq(sum.total, 2, 'summary counts every row');
  A.eq(sum.pending, 1, 'summary counts pending');
  A.eq(sum.rejected, 1, 'summary counts rejected');
  A.eq(sum.approved, 0, 'summary counts approved');
  A.eq(sum.expired, 0, 'summary counts expired');
  A.eq(sum.byTier.review, 2, 'summary groups by tier');
  A.eq(s.summary('').total, 0, 'summary of an empty businessId is empty');

  // newest first
  A.ok(s.list('acme')[0].seq > s.list('acme')[1].seq, 'list is newest-first');

  // clear is scoped
  A.eq(s.clear('').ok, false, 'clear refuses an empty businessId');
  s.clear('beta');
  A.eq(s.list('beta').length, 0, 'clear empties the named business');
  A.eq(s.list('acme').length, 2, 'and leaves the other alone');
}

/* ---------- remove ---------- */
{
  const s = mk();
  const r = s.create('acme', req()).approval;
  A.eq(s.remove(r.id).removed, 1, 'remove reports what it removed');
  A.eq(s.has(r.id), false, 'the row is gone');
  A.eq(s.remove(r.id).removed, 0, 'removing again is a harmless no-op');
  A.eq(s.remove('nope').removed, 0, 'removing an unknown id is a harmless no-op');
}

/* ---------- the per-business cap never drops a PENDING row ---------- */
{
  const s = mk({ limit: 3 });
  const p1 = s.create('acme', req()).approval;
  s.decide(p1.id, { decision: 'approve' });
  const p2 = s.create('acme', req()).approval;
  s.decide(p2.id, { decision: 'approve' });
  const p3 = s.create('acme', req()).approval;   // pending
  s.create('acme', req());                        // pending -> the cap must drop a DECIDED row, not this
  A.eq(s.list('acme').length, 3, 'the cap holds');
  A.eq(s.pendingCount('acme'), 2, 'both PENDING rows survive — a dropped pending row is a decision the user never got to make');
  A.eq(s.list('acme', { status: 'approved' }).length, 1, 'a decided row was dropped instead');
  A.ok(s.has(p3.id), 'the older pending row is still there');
}

/* ---------- PERSIST-BEFORE-COMMIT (fail-closed) ---------- */
{
  let saved = null;
  const s = M.makeBusinessApprovalsStore({ records: [], now: () => NOW, permissions: P, persist: r => { saved = r; } });
  const r = s.create('acme', req());
  A.eq(r.ok, true, 'a working persist commits');
  A.eq(saved.length, 1, 'the persist sink received the row array');
  const d = s.decide(r.approval.id, { decision: 'approve' });
  A.eq(d.ok, true, 'a decision commits');
  A.eq(saved[0].status, 'approved', 'and the persisted snapshot shows the decision');

  const s2 = M.makeBusinessApprovalsStore({ records: [], now: () => NOW, permissions: P, persist: () => { throw new Error('disk full'); } });
  const bad = s2.create('acme', req());
  A.eq(bad.ok, false, 'a throwing persist fails the write');
  A.ok(/persist/.test(bad.reason), 'and the reason says so');
  A.eq(s2.count('acme'), 0, 'memory is UNTOUCHED — the request was not queued');
}

A.report('business-approvals-store.test');
