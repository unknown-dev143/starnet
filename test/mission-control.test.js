'use strict';
/* mission-control.test.js — §23's MISSION CONTROL composer (Business OS Phase 11).

   The gap §6 item 5 named was a MISSING VIEW, so the risk is not a crash — it is a view that RANKS by an
   invented number. Every assertion here is about the ranking staying explainable:

     • no score, no health, no priority number anywhere
     • every row carries the NAMED reasons that placed it where it is
     • an unreadable source is unavailable, never empty
     • the order is deterministic and total (two reads never disagree)                                       */

const A = require('./_assert.js');
const { makeMissionControl, attentionReasons, bandOf, BAND, DEFAULT_STALE_MS, INACTIVE } =
  require('../sidecar/mission-control.js');

const NOW = 1000000000000;   // fixed clock so every time-based assertion is deterministic

function mk(over) {
  return makeMissionControl(Object.assign({ now: () => NOW }, over || {}));
}

/* ---------- attentionReasons: every reason is a real, recorded condition ---------- */
{
  const ctx = { now: NOW, staleMs: DEFAULT_STALE_MS, pendingByBiz: { acme: 3 } };
  const r = attentionReasons({ id: 'acme', stage: 'live', updatedAt: NOW - 1000 }, ctx);
  A.eq(r.length, 1, 'a live, recently-moved business with work waiting has exactly one reason');
  A.eq(r[0].kind, 'waiting-on-you', 'and it is the approvals one');
  A.ok(/3 approvals/.test(r[0].text), 'the count is in the text');
}
{
  const r = attentionReasons({ id: 'b', stage: 'paused', updatedAt: NOW - 1000 }, { now: NOW, staleMs: DEFAULT_STALE_MS, pendingByBiz: {} });
  A.eq(r[0].kind, 'paused', 'a paused business names pause');
  A.ok(/resume/.test(r[0].text), 'and says what fixes it');
}
{
  const one = attentionReasons({ id: 'b', stage: 'winding-down', updatedAt: NOW }, { now: NOW, staleMs: DEFAULT_STALE_MS, pendingByBiz: {} });
  A.eq(one[0].kind, 'winding-down', 'winding-down is its own reason, distinct from paused');
  const arch = attentionReasons({ id: 'b', stage: 'archived', updatedAt: NOW }, { now: NOW, staleMs: DEFAULT_STALE_MS, pendingByBiz: {} });
  A.eq(arch[0].kind, 'archived', 'archived is its own reason');
}
{
  const r = attentionReasons({ id: 'c', stage: 'live', updatedAt: NOW - 10 * 86400000 }, { now: NOW, staleMs: DEFAULT_STALE_MS, pendingByBiz: {} });
  A.eq(r[0].kind, 'stale', 'a business that has not moved is stale');
  A.ok(/10 days/.test(r[0].text), 'and the age is named');
}
/* a business with NO recorded change says so rather than being treated as ancient */
{
  const r = attentionReasons({ id: 'd', stage: 'live' }, { now: NOW, staleMs: DEFAULT_STALE_MS, pendingByBiz: {} });
  A.eq(r[0].kind, 'never-moved', 'an undated business says it has never moved');
}
/* a quiet business has NO reasons — which is a fact, not a failing */
{
  A.eq(attentionReasons({ id: 'e', stage: 'live', updatedAt: NOW - 500 }, { now: NOW, staleMs: DEFAULT_STALE_MS, pendingByBiz: {} }).length, 0,
    'a live, recently-moved business with nothing waiting has no reasons');
}
/* reasons can STACK: a paused business that also has work waiting shows BOTH, in precedence order */
{
  const r = attentionReasons({ id: 'f', stage: 'paused', updatedAt: NOW - 10 * 86400000 }, { now: NOW, staleMs: DEFAULT_STALE_MS, pendingByBiz: { f: 1 } });
  A.eq(r.length, 3, 'a paused, stale business with work waiting carries three reasons');
  A.eq(r[0].kind, 'waiting-on-you', 'the human-blocking reason comes first');
  A.eq(r[1].kind, 'paused', 'then the not-operating reason');
  A.eq(r[2].kind, 'stale', 'then the staleness');
}

/* ---------- bandOf: the first reason decides the band ---------- */
{
  A.eq(bandOf([{ kind: 'waiting-on-you' }]), BAND['waiting-on-you'], 'work waiting is the top band');
  A.eq(bandOf([{ kind: 'paused' }]), BAND.paused, 'paused is the second band');
  A.eq(bandOf([{ kind: 'archived' }]), BAND.archived, 'archived is the third band');
  A.eq(bandOf([]), BAND.quiet, 'no reasons is the quiet band');
  A.ok(BAND['waiting-on-you'] < BAND.paused, 'work waiting sorts above paused');
  A.ok(BAND.paused <= BAND.archived, 'paused sorts at or above archived');
  A.ok(BAND.archived < BAND.stale, 'a non-operating business sorts above a merely stale one');
  A.ok(BAND.stale < BAND.quiet, 'anything with a reason sorts above a quiet business');
}

/* ---------- board: the ranking, with reasons ---------- */
{
  const mc = mk({
    businesses: () => [
      { id: 'quiet', name: 'Quiet Co', stage: 'live', template: 'saas', updatedAt: NOW - 500 },
      { id: 'stale', name: 'Stale Co', stage: 'live', template: 'content', updatedAt: NOW - 30 * 86400000 },
      { id: 'paused', name: 'Paused Co', stage: 'paused', template: 'agency', updatedAt: NOW - 500 },
      { id: 'waiting', name: 'Waiting Co', stage: 'live', template: 'custom', updatedAt: NOW - 500 }
    ],
    pendingCount: (id) => (id === 'waiting' ? 2 : 0)
  });
  const b = mc.board();
  A.ok(b.ok === true, 'the board builds');
  A.eq(b.businesses.map(r => r.id).join(','), 'waiting,paused,stale,quiet',
    'rows rank: work waiting, then not-operating, then stale, then quiet');
  A.eq(b.businesses[0].reasons[0].kind, 'waiting-on-you', 'the first row says WHY it is first');
  A.eq(b.businesses[3].quiet, true, 'the last row is marked quiet');
  A.eq(b.counts.businesses, 4, 'the count is right');
  A.eq(b.counts.needsYou, 3, 'three businesses carry a reason');
  A.eq(b.counts.blockedOnYou, 1, 'and exactly one is blocked on an approval decision');
  A.eq(b.counts.quiet, 1, 'one is quiet');
  A.eq(b.counts.pending, 2, 'the total pending is summed');

  // NO SCORE, anywhere in the payload
  const flat = JSON.stringify(b).toLowerCase();
  A.ok(flat.indexOf('"score"') < 0, 'no score field');
  A.ok(flat.indexOf('"health"') < 0, 'no health field');
  A.ok(flat.indexOf('"priority"') < 0, 'no priority number');
  A.ok(flat.indexOf('"grade"') < 0 && flat.indexOf('"rating"') < 0, 'no grade, no rating');
}
/* the ranking IS the reasons — asserted structurally: a row's band equals its first reason's band */
{
  const mc = mk({
    businesses: () => [
      { id: 'a', stage: 'paused', updatedAt: NOW - 500 },
      { id: 'b', stage: 'live', updatedAt: NOW - 30 * 86400000 },
      { id: 'c', stage: 'live', updatedAt: NOW - 100 }
    ]
  });
  const rows = mc.board().businesses;
  for (const r of rows) A.eq(r.band, bandOf(r.reasons), r.id + '\'s band is exactly its reasons\' band');
  A.ok(rows.length === 3, 'all rows are present');
}

/* ---------- determinism: the order is total, so two reads never disagree ---------- */
{
  const build = () => mk({
    businesses: () => [
      { id: 'z', stage: 'live', updatedAt: NOW - 500 },
      { id: 'a', stage: 'live', updatedAt: NOW - 500 },
      { id: 'm', stage: 'live', updatedAt: NOW - 500 }
    ]
  }).board();
  // three identical-timestamp quiet businesses: the tiebreak must be stable (id order)
  A.eq(build().businesses.map(r => r.id).join(','), 'a,m,z', 'identical rows break ties by id, deterministically');
  A.eq(JSON.stringify(build()), JSON.stringify(build()), 'two identical reads serialise identically');
}
/* more pending moves a business up WITHIN its band */
{
  const mc = mk({
    businesses: () => [
      { id: 'one', stage: 'live', updatedAt: NOW - 500 },
      { id: 'three', stage: 'live', updatedAt: NOW - 500 }
    ],
    pendingCount: (id) => (id === 'three' ? 3 : 1)
  });
  A.eq(mc.board().businesses.map(r => r.id).join(','), 'three,one', 'more pending sorts higher within the band');
}

/* ---------- HONESTY: an unreadable source is unavailable, never a zero ---------- */
{
  const mc = mk({ businesses: () => { throw new Error('store down'); } });
  const b = mc.board();
  A.eq(b.ok, true, 'the board still builds when the business list is unreadable');
  A.eq(b.businesses.length, 0, 'with no rows');
  A.eq(b.counts.businesses, 0, 'and a count of zero businesses');
}
{
  const mc = mk({
    businesses: () => [{ id: 'a', stage: 'live', updatedAt: NOW - 500 }],
    pendingCount: () => { throw new Error('approvals down'); }
  });
  const b = mc.board();
  A.eq(b.counts.pending, null, 'an unreadable approvals source reports the total as NULL, never 0');
}
/* a REAL zero pending count is 0 and the total is 0 — the two must not be confused */
{
  const mc = mk({ businesses: () => [{ id: 'a', stage: 'live', updatedAt: NOW - 500 }], pendingCount: () => 0 });
  A.eq(mc.board().counts.pending, 0, 'a real zero pending total is 0');
}
/* pendingIds fallback: works when only the id set is available (no per-business counts) */
{
  const mc = mk({
    businesses: () => [{ id: 'x', stage: 'live', updatedAt: NOW - 500 }, { id: 'y', stage: 'live', updatedAt: NOW - 500 }],
    pendingIds: () => ['x']
  });
  const b = mc.board();
  A.eq(b.businesses[0].id, 'x', 'the business with a pending id sorts first');
  A.eq(b.counts.pending, 1, 'and the total counts it');
}
/* an unreadable pendingIds source also reports null rather than zero */
{
  const mc = mk({ businesses: () => [{ id: 'x', stage: 'live', updatedAt: NOW - 500 }], pendingIds: () => { throw new Error('down'); } });
  A.eq(mc.board().counts.pending, null, 'a throwing pendingIds source reports null');
}

/* ---------- fields are bounded and named ---------- */
{
  const mc = mk({ businesses: () => [{ id: 'a', name: 'x'.repeat(500), stage: 'y'.repeat(200), template: 'z'.repeat(200), updatedAt: NOW }] });
  const r = mc.board().businesses[0];
  A.ok(r.name.length <= 121, 'the name is bounded');
  A.ok(r.stage.length <= 41, 'the stage is bounded');
  A.ok(r.template.length <= 41, 'the template is bounded');
}

/* ---------- attention(): just what needs a human ---------- */
{
  const mc = mk({
    businesses: () => [
      { id: 'q', stage: 'live', updatedAt: NOW - 500 },
      { id: 'p', stage: 'paused', updatedAt: NOW - 500 }
    ]
  });
  const a = mc.attention();
  A.eq(a.count, 1, 'only the non-quiet business appears');
  A.eq(a.rows[0].id, 'p', 'and it is the paused one');
  A.ok(a.rows.every(r => !r.quiet), 'no quiet row leaks into the attention list');
}

/* ---------- fleet(): portfolio passed through, and reportable when absent ---------- */
{
  const mc = mk({ portfolio: () => ({ businesses: 2, metrics: [{ metric: 'revenue', total: 100 }] }) });
  const f = mc.fleet();
  A.eq(f.portfolioReadable, true, 'a portfolio that built is readable');
  A.eq(f.portfolio.metrics[0].total, 100, 'and is passed through unchanged');
}
{
  const mc = mk({ portfolio: () => { throw new Error('no metrics'); } });
  const f = mc.fleet();
  A.eq(f.portfolio, null, 'a portfolio that could not build is NULL, not an empty metrics list');
  A.eq(f.portfolioReadable, false, 'and is flagged unreadable');
  A.ok(/could not be built/.test(f.note), 'and the note says so');
}
/* no portfolio injected at all: null, and NOT flagged as a failure of a source that exists */
{
  const f = mk().fleet();
  A.eq(f.portfolio, null, 'with no portfolio source the figures are null');
  A.eq(f.portfolioReadable, true, 'and this is not reported as a failure');
}

/* ---------- alerts(): signals read through ---------- */
{
  const mc = mk({ signals: () => [{ kind: 'persistent-trend', metric: 'revenue', label: 'Revenue', text: 'up 4 readings', direction: 'up' }] });
  const a = mc.alerts('acme');
  A.eq(a.ok, true, 'alerts build for a real id');
  A.eq(a.signals[0].kind, 'persistent-trend', 'the signal is passed through');
  A.eq(a.readable, true, 'and marked readable');
}
{
  const mc = mk({ signals: () => { throw new Error('down'); } });
  const a = mc.alerts('acme');
  A.eq(a.signals.length, 0, 'an unreadable signal source yields no signals');
  A.eq(a.readable, false, 'and says so');
}
{
  A.eq(mk().alerts('').ok, false, 'alerts refuses an empty id');
  A.eq(mk().alerts(null).ok, false, 'and a null id');
  A.ok(/isolation/.test(mk().alerts('').reason), 'and names the isolation rule');
}
/* with no signals source wired, alerts says so rather than claiming no signals exist */
{
  const a = mk().alerts('acme');
  A.eq(a.readable, false, 'no signal source -> unreadable, never "zero signals"');
}

/* ---------- trail(): the cross-business feed, capped ---------- */
{
  const mc = mk({ recent: (o) => [{ id: 'r1', at: NOW - 100, businessId: 'acme', actor: { kind: 'user' }, action: 'Hired an agent', result: 'ok' }].slice(0, o.limit) });
  const t = mc.trail({ limit: 5 });
  A.eq(t.rows.length, 1, 'the trail rows come back');
  A.eq(t.rows[0].businessId, 'acme', 'the business id is carried (the whole point of a cross-business feed)');
  A.eq(t.readable, true, 'and is marked readable');
}
/* the limit is capped so a caller cannot ask for the whole log through this surface */
{
  let asked = null;
  const mc = mk({ recent: (o) => { asked = o.limit; return []; } });
  mc.trail({ limit: 99999 });
  A.ok(asked <= 30, 'the trail limit is capped server-side, not trusted from the caller');
  mc.trail({});
  A.ok(asked > 0, 'a default limit applies when none is given');
}
{
  const mc = mk({ recent: () => { throw new Error('down'); } });
  const t = mc.trail();
  A.eq(t.rows.length, 0, 'an unreadable trail yields no rows');
  A.eq(t.readable, false, 'and says so');
}

/* ---------- host-safety ---------- */
{
  const mc = makeMissionControl({});
  A.ok(mc.board().ok === true, 'the composer works with no sources at all');
  A.ok(mc.fleet().ok === true, 'fleet too');
  A.ok(mc.trail().ok === true, 'trail too');
}
/* junk business rows must not crash the board */
{
  const mc = mk({ businesses: () => [null, undefined, {}, { id: 'ok', stage: 'live', updatedAt: NOW }] });
  const b = mc.board();
  A.ok(b.ok === true, 'junk rows do not crash the board');
  A.eq(b.businesses.length, 4, 'each junk row still becomes a (labelled) row');
  A.ok(b.businesses.some(r => r.id === 'ok'), 'the real row survives');
}
/* a custom stale threshold is honoured */
{
  const mc = mk({ businesses: () => [{ id: 'a', stage: 'live', updatedAt: NOW - 2 * 86400000 }] });
  A.eq(mc.board({ staleMs: 86400000 }).businesses[0].reasons[0].kind, 'stale', 'a 1-day threshold flags a 2-day-old business');
  A.eq(mc.board({ staleMs: 5 * 86400000 }).businesses[0].reasons.length, 0, 'a 5-day threshold does not');
}

/* ---------- INACTIVE is the store's own list (single source of truth) ---------- */
{
  const store = require('../sidecar/businesses-store.js');
  A.eq(JSON.stringify(INACTIVE.slice().sort()), JSON.stringify(store.INACTIVE_STAGES.slice().sort()),
    'the mission view reads the store\'s inactive list — the two cannot drift apart');
}

A.report('mission-control');
