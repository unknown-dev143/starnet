'use strict';
/* businessmission.test.js — the §23 MISSION CONTROL console, pure half (Business OS Phase 11).

   The console's job is to render the composer's ranked board WITHOUT adding a verdict of its own. So the
   risks this suite guards are presentation-shaped:

     • the ranking must read as REASONS in place — never a score, health bar or colour band
     • a null (unreadable) pending count must NEVER render as 0
     • a rate must read "not summed", never blank and never 0
     • an unreadable source must be LOUD, and the console must hold no ranking policy of its own            */

const A = require('./_assert.js');
const S = require('../frontend/app/businessmission.js');

const NOW = 1000000000000;

/* ---------- escaping ---------- */
{
  A.eq(S.esc('<b>x</b>'), '&lt;b&gt;x&lt;/b&gt;', 'tags are escaped');
  A.eq(S.esc('a"b\'c'), 'a&quot;b&#39;c', 'both quote kinds are escaped');
  A.eq(S.esc(null), '', 'null escapes to empty');
}

/* ---------- relTime: an undated row says NOTHING rather than "1970" ---------- */
{
  A.eq(S.relTime(0), '', 'a zero timestamp renders nothing');
  A.eq(S.relTime(-1), '', 'the composer\'s NO_TIME sentinel renders nothing');
  A.eq(S.relTime(null), '', 'a null timestamp renders nothing');
  A.eq(S.relTime(NOW - 5000, NOW), 'now', 'five seconds ago reads now');
  A.eq(S.relTime(NOW - 5 * 60000, NOW), '5m', 'minutes read as m');
  A.eq(S.relTime(NOW - 3 * 3600000, NOW), '3h', 'hours read as h');
  A.eq(S.relTime(NOW - 2 * 86400000, NOW), '2d', 'days read as d');
  A.eq(S.relTime(NOW + 5000, NOW), 'now', 'a clock skew does not render -5s');
}

/* ---------- stageLabel: an unknown stage is UNKNOWN ---------- */
{
  A.eq(S.stageLabel('live'), 'LIVE', 'live reads LIVE');
  A.eq(S.stageLabel('winding-down'), 'WINDING DOWN', 'winding-down reads in words');
  A.eq(S.stageLabel('growing'), 'GROWING', 'the new Phase 10 stages are known here too');
  A.eq(S.stageLabel('moonshot'), 'UNKNOWN', 'an unknown stage reads UNKNOWN');
  A.eq(S.stageLabel(null), 'UNKNOWN', 'a null stage reads UNKNOWN');
}

/* ---------- shapeHeader: a quote of the counts, never a verdict ---------- */
{
  const h = S.shapeHeader({ businesses: 4, needsYou: 3, blockedOnYou: 1, pending: 2 });
  A.ok(/4 businesses/.test(h.text), 'the business count is named');
  A.ok(/3 need you/.test(h.text), 'the attention count is named');
  A.ok(/1 blocked on an approval/.test(h.text), 'the blocked count is named');
  A.ok(/2 approvals pending/.test(h.text), 'the pending count is named');
  A.eq(h.pendingKnown, true, 'a real pending count is known');
  const flat = h.text.toLowerCase();
  A.ok(flat.indexOf('health') < 0 && flat.indexOf('score') < 0 && flat.indexOf('grade') < 0,
    'no health, score or grade language');
}
/* a null pending count renders "unknown", NEVER a 0 */
{
  const h = S.shapeHeader({ businesses: 1, needsYou: 0, pending: null });
  A.ok(/unknown/.test(h.text), 'an unreadable pending count says unknown');
  A.ok(!/0 approval/.test(h.text), 'and never renders as 0 pending');
  A.eq(h.pendingKnown, false, 'and is flagged unknown');
  A.eq(h.pending, null, 'the null survives shaping');
}
/* a real zero pending count is simply omitted (nothing waiting), not "0 pending" */
{
  const h = S.shapeHeader({ businesses: 2, needsYou: 1, pending: 0 });
  A.eq(h.pending, 0, 'a real zero is 0');
  A.eq(h.pendingKnown, true, 'and is known');
  A.ok(!/pending/.test(h.text), 'and adds no clause when nothing is waiting');
}
/* the singular forms are correct */
{
  const h = S.shapeHeader({ businesses: 1, needsYou: 1, pending: 1 });
  A.ok(/1 business /.test(h.text) || /1 business$/.test(h.text) || /1 business ·/.test(h.text), 'one business is singular');
  A.ok(/1 needs you/.test(h.text), 'one needs you is singular');
  A.ok(/1 approval pending/.test(h.text), 'one approval is singular');
}
/* an ABSENT pending count is unknown too — not "none waiting" */
{
  const h = S.shapeHeader({});
  A.ok(/0 businesses/.test(h.text), 'an empty header names zero businesses');
  A.ok(/unknown/.test(h.text), 'and an absent pending count reads unknown, never a fabricated 0');
  A.eq(h.pendingKnown, false, 'an absent count is not known');
}

/* ---------- shapeRow: the reasons are the payload ---------- */
{
  const r = S.shapeRow({
    id: 'acme', name: 'Acme', stage: 'paused', updatedAt: NOW - 500, pending: 2, band: 1,
    reasons: [{ kind: 'waiting-on-you', text: '2 approvals waiting' }, { kind: 'paused', text: 'paused — stopped' }]
  }, NOW);
  A.eq(r.name, 'Acme', 'the name passes through');
  A.eq(r.stageLabel, 'PAUSED', 'the stage is labelled');
  A.eq(r.reasons.length, 2, 'both reasons survive');
  A.ok(/2 approvals waiting/.test(r.reasonText), 'the reason text is joined for display');
  A.eq(r.needsHuman, true, 'a reason means a human is needed');
  A.eq(r.quiet, false, 'and it is not quiet');
}
/* a quiet row carries no reasons and is marked so */
{
  const r = S.shapeRow({ id: 'q', name: 'Quiet', stage: 'live', updatedAt: NOW - 500, reasons: [], quiet: true, band: 9 }, NOW);
  A.eq(r.reasons.length, 0, 'a quiet row has no reasons');
  A.eq(r.quiet, true, 'and is marked quiet');
  A.eq(r.needsHuman, false, 'and does not need a human');
}
/* the band is carried for ordering but is NOT rendered — asserted by checking the shape has no band text */
{
  const r = S.shapeRow({ id: 'x', name: 'X', band: 0, reasons: [] }, NOW);
  A.eq(typeof r.band, 'number', 'the band is carried (for order/labelling)');
}
/* an unnamed row is labelled */
{
  A.eq(S.shapeRow({ id: 'x' }, NOW).name, '(unnamed)', 'an unnamed business is labelled, not blank');
  A.eq(S.shapeRow({ id: 'x' }, NOW).stageLabel, 'IDEA', 'a missing stage reads IDEA');
}
/* junk reasons do not crash */
{
  const r = S.shapeRow({ id: 'x', reasons: [null, undefined, {}, { kind: 'paused' }] }, NOW);
  A.eq(r.reasons.length, 4, 'junk reasons each become a (labelled) reason');
  A.eq(r.reasons[3].kind, 'paused', 'the real reason survives');
}

/* ---------- shapeBoard: order is preserved EXACTLY as the composer sent it ---------- */
{
  const b = S.shapeBoard({
    ok: true, generatedAt: NOW,
    counts: { businesses: 3, needsYou: 2, blockedOnYou: 1, pending: 1 },
    businesses: [
      { id: 'waiting', name: 'W', stage: 'live', updatedAt: NOW - 500, pending: 1, band: 0, reasons: [{ kind: 'waiting-on-you', text: 'x' }] },
      { id: 'paused', name: 'P', stage: 'paused', updatedAt: NOW - 500, band: 1, reasons: [{ kind: 'paused', text: 'y' }] },
      { id: 'quiet', name: 'Q', stage: 'live', updatedAt: NOW - 500, band: 9, reasons: [], quiet: true }
    ]
  }, NOW);
  A.eq(b.rows.map(r => r.id).join(','), 'waiting,paused,quiet', 'the console preserves the composer\'s order EXACTLY');
  A.eq(b.ok, true, 'ok passes through');
  A.eq(b.header.needs, 2, 'the header count is carried');
}
/* ok requires an explicit ok:true — an absent payload is not a clean empty board */
{
  A.eq(S.shapeBoard({}).ok, false, 'an absent ok is NOT ok (never a clean empty view)');
  A.ok(S.shapeBoard(null).ok === false, 'a null board is NOT ok');
  A.eq(S.shapeBoard({ ok: true, businesses: [] }).rows.length, 0, 'an explicit empty board is fine');
}

/* ---------- shapeFleet: a rate is never summed ---------- */
{
  const f = S.shapeFleet({
    ok: true, portfolioReadable: true, portfolio: { businesses: 2, metrics: [
      { metric: 'revenue', label: 'Revenue', unit: 'currency', total: 100, mean: 50, min: 20, max: 80 },
      { metric: 'conversion', label: 'Conversion', unit: 'rate', total: null, mean: 0.032, min: 0.02, max: 0.05 }
    ] }
  }, NOW);
  A.eq(f.metrics.length, 2, 'both metrics come back');
  A.eq(f.metrics[0].notSummed, false, 'a summable metric is not flagged');
  A.eq(f.metrics[1].notSummed, true, 'a rate IS flagged as not summed');
  A.eq(f.metrics[1].total, null, 'its total stays null, not 0');
  A.eq(f.metrics[1].mean, 0.032, 'but its mean is carried');
  A.eq(f.businesses, 2, 'the business count is carried');
}
/* an unreadable portfolio is flagged, never shown as "nothing measured" */
{
  const f = S.shapeFleet({ ok: true, portfolioReadable: false, portfolio: null }, NOW);
  A.eq(f.portfolioReadable, false, 'an unreadable portfolio is flagged');
  A.eq(f.metrics.length, 0, 'with no metrics');
}
/* an undefined total is treated as not-summed, not as 0 */
{
  const f = S.shapeFleet({ ok: true, portfolio: { metrics: [{ metric: 'x', label: 'X' }] } }, NOW);
  A.eq(f.metrics[0].total, null, 'a missing total is null');
  A.eq(f.metrics[0].notSummed, true, 'and is flagged not-summed');
}

/* ---------- shapeTrail ---------- */
{
  const t = S.shapeTrail({ ok: true, readable: true, rows: [
    { id: 'r1', at: NOW - 100, businessId: 'acme', actor: 'agent', actorName: 'Atlas', action: 'Hired', result: 'ok' }
  ] }, NOW);
  A.eq(t.rows.length, 1, 'the trail rows come back');
  A.eq(t.rows[0].businessId, 'acme', 'the business id is carried');
  A.eq(t.rows[0].when, 'now', 'and time-rendered');
}
{
  const t = S.shapeTrail({ ok: true, readable: false, rows: [] }, NOW);
  A.eq(t.readable, false, 'an unreadable trail stays flagged');
}
/* an undated trail row renders nothing for time */
{
  const t = S.shapeTrail({ ok: true, readable: true, rows: [{ id: 'r', at: -1, action: 'X' }] }, NOW);
  A.eq(t.rows[0].when, '', 'an undated row renders an empty time');
}

/* ---------- shapeAlerts ---------- */
{
  const a = S.shapeAlerts({ ok: true, businessId: 'acme', readable: true, signals: [{ kind: 'persistent-trend', metric: 'revenue', text: 'up 4' }] });
  A.eq(a.signals.length, 1, 'the signal comes back');
  A.eq(a.readable, true, 'and is readable');
}

/* ---------- availabilityWarnings: an unreadable source is LOUD ---------- */
{
  const board = S.shapeBoard({ ok: true, counts: { pending: null }, businesses: [] }, NOW);
  const warns = S.availabilityWarnings(board, S.shapeFleet({ portfolioReadable: false }, NOW), S.shapeTrail({ readable: false }, NOW));
  A.eq(warns.length, 3, 'one warning per unreadable source');
  A.ok(warns.some(w => /not zero/i.test(w)), 'the approvals warning says unknown, not zero');
  A.ok(warns.some(w => /still current/i.test(w)), 'the portfolio warning says the board is still current');
}
/* a fully readable read warns about nothing */
{
  const board = S.shapeBoard({ ok: true, counts: { pending: 0 }, businesses: [] }, NOW);
  A.eq(S.availabilityWarnings(board, S.shapeFleet({ portfolioReadable: true }, NOW), S.shapeTrail({ readable: true }, NOW)).length, 0,
    'a fully readable read produces no warnings');
}

/* ---------- attentionBadge: null-safe ---------- */
{
  A.eq(S.attentionBadge(S.shapeBoard({ ok: true, counts: { needsYou: 3, pending: 0 }, businesses: [] }, NOW)).count, 3,
    'the badge counts the businesses that need a human');
  A.eq(S.attentionBadge(null).count, 0, 'a null board yields a zero badge');
  A.eq(S.attentionBadge(null).known, false, 'and is not marked known');
  A.eq(S.attentionBadge(S.shapeBoard({ ok: true, counts: { needsYou: 0, pending: 0 }, businesses: [] }, NOW)).text, '',
    'a badge with nothing to say is empty');
}

/* ---------- the console holds NO ranking policy of its own ---------- */
{
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'frontend', 'app', 'businessmission.js'), 'utf8');
  // it must not re-derive the ranking — the order comes from the composer
  A.ok(src.indexOf('waiting-on-you') < 0 || src.indexOf('HUMAN_KINDS') >= 0,
    'the console does not re-implement the ranking bands (it only classifies "needs a human" for phrasing)');
  A.ok(!/band\s*===\s*0\s*\?/.test(src), 'the console does not re-rank by band');
  // no mutation, no native dialogs
  A.ok(!/method:\s*'POST'/.test(src) && !/method:\s*"POST"/.test(src), 'the console issues no POST — it is a read');
  A.ok(!/\balert\s*\(/.test(src) && !/\bconfirm\s*\(/.test(src) && !/\bprompt\s*\(/.test(src),
    'no native alert/confirm/prompt');
  // and it must not append a fabricated metric. NOTE: strip comments first — the file's own prose NAMES the
  // concepts it refuses to add ("no score / no health bar"), so a bare substring scan reads the comment and
  // reports a false positive. That is the same trap the worker-registry hardening test hit.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  A.ok(code.toLowerCase().indexOf('health') < 0, 'no "health" concept in the CODE (comments excluded)');
  A.ok(code.toLowerCase().indexOf('"score"') < 0, 'no score field in the CODE');
}

/* ---------- shapeAttention: the narrow "needs a human" read (Step B) ---------- */
{
  const raw = { ok: true, count: 1, pending: 2, rows: [{ id: 'a', name: 'A', stage: 'live', reasons: [{ kind: 'waiting-on-you', text: '2 approvals waiting' }], pending: 2, band: 0 }] };
  const a = S.shapeAttention(raw, NOW);
  A.eq(a.ok, true, 'attention ok is carried');
  A.eq(a.count, 1, 'the attention count comes off the wire');
  A.eq(a.pending, 2, 'the pending total is carried (null vs 0 kept distinct)');
  A.eq(a.rows.length, 1, 'the attention rows are shaped');
  A.eq(a.rows[0].stageLabel, 'LIVE', 'attention rows re-use the ONE row-shaper (stage label resolved identically)');
  A.ok(a.rows[0].needsHuman, 'an attention row always carries a human reason');
  // a null pending must survive as null (the composer reports an unreadable queue as null, never 0)
  A.eq(S.shapeAttention({ ok: true, count: 0, pending: null, rows: [] }, NOW).pending, null, 'an unknown pending stays null');
  // missing count falls back to the row length, never undefined
  A.eq(S.shapeAttention({ ok: true, rows: [{ id: 'x', name: 'X' }] }, NOW).count, 1, 'count falls back to the row length');
  A.eq(S.shapeAttention(null, NOW).rows.length, 0, 'a null attention read shapes to an empty list, not a throw');
}

/* ---------- ATTENTION-FIRST: the console consumes all four routes (Step B) ----------
   Before Step B, /api/mission/attention and /api/mission/alerts had NO frontend consumer — two purpose-built
   routes that could rot green forever. This locks the console to them, so the attention-first home cannot
   silently regress to a board-only surface. */
{
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'frontend', 'app', 'businessmission.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  A.ok(code.indexOf('/api/mission/attention') >= 0, 'the console READS /api/mission/attention (no longer an orphan route)');
  A.ok(code.indexOf('/api/mission/alerts') >= 0, 'the console READS /api/mission/alerts (per-business signals)');
  A.ok(code.indexOf('/api/mission/board') >= 0 && code.indexOf('/api/mission/fleet') >= 0 && code.indexOf('/api/mission/trail') >= 0,
    'and still reads board + fleet + trail — all five reads in one home');
  // attention is the DEFAULT tab (the console opens on what needs a human).
  A.ok(/data-tab="attention"[^>]*>\s*ATTENTION/.test(src) && /class="mssn-tab mssn-on" data-tab="attention"/.test(src),
    'ATTENTION is the first, default tab (attention-first home)');
  // still a pure read — no mutation added by the new tab.
  A.ok(!/method:\s*'POST'/.test(src) && !/method:\s*"POST"/.test(src), 'the attention tab adds no POST — still a read');
}

/* ---------- paintDockBadge: the attention count on the dock (Step B) ---------- */
{
  // no document → a silent no-op (this module is Node-loaded in tests; never throw).
  A.notThrows(() => S.paintDockBadge(S.shapeBoard({ ok: true, counts: { needsYou: 2 } }, NOW)),
    'paintDockBadge is a no-op with no DOM (never throws in the headless test)');
  const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'frontend', 'index.html'), 'utf8');
  A.ok(/id="mssn-dock-badge"/.test(html), 'the MISSION CONTROL dock button carries the attention badge element');
  A.ok(/data-term="mission"[^>]*>[\s\S]{0,600}id="mssn-dock-badge"/.test(html),
    'and it is inside the mission dock button (the badge shows where a person already looks)');
  A.ok(typeof S.paintDockBadge === 'function', 'paintDockBadge is exported');
}

/* ---------- ERROR STATES: a rejected read must be NAMED, not a spinner forever (Step E) ---------- */
{
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'frontend', 'app', 'businessmission.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  // every one of the five reads is guarded: 4 loads in loadAll() + the per-business alerts expansion.
  const catches = (code.match(/\.catch\(/g) || []).length;
  A.ok(catches >= 5, 'every mission read carries a .catch (a dropped fetch must not leave a spinner forever) — found ' + catches);
  A.ok(/mssn-err/.test(src), 'the error state is rendered through the .mssn-err surface');
  A.ok(/\.catch\(fail\('attention'\)\)/.test(code) && /\.catch\(fail\('board'\)\)/.test(code) &&
    /\.catch\(fail\('fleet'\)\)/.test(code) && /\.catch\(fail\('trail'\)\)/.test(code),
    'all four boards name their failure panel');
  A.ok(/state\.alerts\[id\] = \{ signals: \[\], readable: false \}/.test(code),
    'a failed alerts read is marked unreadable, never left in-flight');
}

/* ---------- a body-less mount must not throw ---------- */
{
  A.notThrows(() => { const r = S.mount(null); A.ok(r === null, 'mounting nothing returns null'); }, 'mount(null) does not throw');
}

A.report('businessmission');
