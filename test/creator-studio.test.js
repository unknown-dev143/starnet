'use strict';
/* creator-studio.test.js — §20 CREATOR STUDIO, the station-level content composer.

   Three things this suite exists to catch:

     1. HONESTY. Counts are counts (no score/readiness/percentage); an unreadable source is reported as
        `readable:false`, never as an empty pipeline; a rate is never summed into an invented total.
     2. THE CALENDAR NEVER INVENTED A DATE. There is no "scheduled" field in the content store, so the
        calendar places a piece on the day it is DATED (publishedAt → updatedAt → createdAt) and every row
        reports WHICH (`dateSource`). A piece with no recorded date is counted as `undated`, never binned
        into today.
     3. NO STORE, NO WRITE. The composer owns nothing and exposes no mutation — publishing stays a human
        action on the existing /content/advance route. */

const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const { makeCreatorStudio, pieceDate, STAGES, CHANNELS } = require('../sidecar/creator-studio.js');
const { makeBusinessContentStore } = require('../sidecar/business-content-store.js');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'creator-studio.js'), 'utf8');
const NOW = 1000000000000;
const DAY = 24 * 60 * 60 * 1000;

/* a real content store seeded across two businesses, with a publish and a movement recorded */
function mkStudio() {
  const content = makeBusinessContentStore({ now: () => NOW, persist: () => {} });
  content.addPiece('biz-a', { title: 'Launch teardown', channel: 'youtube', stage: 'script' });
  content.addPiece('biz-a', { title: 'Newsletter #1', channel: 'newsletter', stage: 'review', assets: ['/a.png', '/b.png'] });
  const pub = content.addPiece('biz-b', { title: 'Shipped it', channel: 'blog', stage: 'editing' });
  // a HUMAN publishes it — the only way the store allows it
  content.advance(pub.piece.id, 'publish', { kind: 'user', name: 'Commander' });
  content.addPiece('biz-b', { title: 'Fresh idea', channel: 'tiktok', stage: 'idea' });

  const businesses = () => [
    { id: 'biz-a', name: 'Alpha' },
    { id: 'biz-b', name: 'Beta' }
  ];
  return makeCreatorStudio({ content, businesses, now: () => NOW });
}

/* ---------- STAGES come from the store module (they cannot drift) ---------- */
{
  A.eq(JSON.stringify(STAGES), JSON.stringify(['idea', 'research', 'script', 'assets', 'editing', 'review', 'publish', 'analytics']),
    'the composer reads §17\'s stage order from the store module');
  A.ok(CHANNELS.indexOf('youtube') >= 0, 'and the channel vocabulary from the store module');
}

/* ---------- pieceDate: the honest date ladder ---------- */
{
  A.eq(pieceDate({ publishedAt: 5, updatedAt: 9, createdAt: 1 }).dateSource, 'published', 'a published piece is dated by publishedAt');
  A.eq(pieceDate({ updatedAt: 9, createdAt: 1 }).dateSource, 'updated', 'an unpublished piece falls back to updatedAt');
  A.eq(pieceDate({ createdAt: 1 }).dateSource, 'created', 'with nothing else, createdAt');
  A.eq(pieceDate({}).at, null, 'a piece with no dates has at:null, never a fabricated now');
  A.eq(pieceDate({}).dateSource, 'none', 'and says so');
}

/* ---------- pipeline: every piece, grouped by stage, joined to its business ---------- */
{
  const s = mkStudio();
  const p = s.pipeline({});
  A.eq(p.ok, true, 'the pipeline answers ok');
  A.eq(p.counts.total, 4, 'all four pieces across both businesses appear');
  A.eq(p.counts.byStage.script, 1, 'the script stage holds one');
  A.eq(p.counts.byStage.review, 1, 'the review stage holds one');
  A.eq(p.counts.byStage.idea, 1, 'the idea stage holds one');
  A.eq(p.counts.published, 1, 'exactly one piece is published');
  // the business NAME is joined on, not just the id
  const scriptPiece = p.byStage.script[0];
  A.eq(scriptPiece.businessName, 'Alpha', 'a piece carries its business name (joined from the businesses store)');
  A.eq(scriptPiece.channel, 'youtube', 'its channel is carried');
  // a review piece carries its assets
  A.eq(p.byStage.review[0].assets.length, 2, 'asset references ride along (the thumbnail source)');
  A.ok(!('score' in p) && !('readiness' in p), 'no score / readiness anywhere on the payload');
  A.eq(p.readable, true, 'a fully readable read says so');
}

/* ---------- an unreadable store is UNAVAILABLE, never an empty pipeline ---------- */
{
  const broken = makeCreatorStudio({ content: { pieces: () => { throw new Error('io'); } }, businesses: () => [{ id: 'b', name: 'B' }], now: () => NOW });
  const p = broken.pipeline({});
  A.eq(p.readable, false, 'a store that throws reads as unreadable');
  A.ok(p.counts.total === 0, 'with zero rows');
  A.ok(/could not be read/i.test(p.note), 'and a note that says so — not a tidy empty board');
}
/* a missing content store entirely is also reported, not crashed */
{
  const p = makeCreatorStudio({ content: null, businesses: () => [{ id: 'b', name: 'B' }], now: () => NOW }).pipeline({});
  A.eq(p.readable, false, 'no content store → unreadable');
  A.eq(p.ok, true, 'but still answers ok (a degraded read, not a 500)');
}

/* ---------- calendar: placed on the RECORDED day, source named ---------- */
{
  const s = mkStudio();
  const cal = s.calendar({});
  A.eq(cal.ok, true, 'the calendar answers ok');
  A.ok(cal.days.length >= 1, 'at least one day bucket');
  // every row names which date placed it
  for (const d of cal.days) for (const r of d.rows) {
    A.ok(['published', 'updated', 'created'].indexOf(r.dateSource) >= 0, 'every calendar row names its date source');
    A.eq(new Date(r.datedAt).toISOString().slice(0, 10), d.day, 'and its datedAt falls on the bucket day');
  }
  // the published piece is placed by 'published', the rest by 'updated'
  const all = cal.days.reduce((a, d) => a.concat(d.rows), []);
  A.ok(all.some(r => r.dateSource === 'published' && r.published), 'the published piece sits on its publish day');
  A.ok(all.every(r => r.stage && r.channel), 'every calendar row carries stage + channel');
  // assets ride on the calendar row too — a piece must not report a different asset set per read
  const withAssets = all.filter(r => Array.isArray(r.assets) && r.assets.length);
  A.eq(withAssets.length, 1, 'the calendar row carries the piece assets (the review piece has two)');
  A.eq(withAssets[0].assets.length, 2, 'so a piece reports the SAME asset set on every read, not just the pipeline');
  A.ok(/no separate "scheduled" date|could not be read|published/i.test(cal.note), 'the note tells the truth about the date basis');
}

/* ---------- calendar window is honoured (a real filter, not decoration) ---------- */
{
  const s = mkStudio();
  // everything is at NOW; a window ending BEFORE now excludes all, one ending AT now includes all
  const before = s.calendar({ to: NOW - DAY });
  A.eq(before.days.length, 0, 'a window that ends before the pieces excludes them all');
  const at = s.calendar({ from: NOW - DAY, to: NOW + DAY });
  A.ok(at.days.length >= 1, 'a window around now includes them');
}

/* ---------- published: only what a HUMAN actually sent, with who signed it ---------- */
{
  const s = mkStudio();
  const pub = s.published({});
  A.eq(pub.ok, true, 'the published list answers ok');
  A.eq(pub.count, 1, 'exactly the one piece a human published appears');
  A.eq(pub.rows.length, 1, 'and it is carried in rows');
  const row = pub.rows[0];
  A.eq(row.title, 'Shipped it', 'the sent piece is the one that was published');
  A.eq(row.publishedBy, 'Commander', 'and it names WHO signed it — the fact the station read used to drop');
  A.ok(Number.isFinite(row.publishedAt), 'with the recorded publishedAt');
  A.eq(row.businessName, 'Beta', 'and its business');
  A.ok(/human/i.test(pub.note), 'the note says publishing is a human action');

  // A piece that was published and then moved BACK out of the publish stages still has `publishedAt` set —
  // and it is still a thing that went out. This is the case that makes "the FACT, not the stage" a real
  // distinction rather than a slogan: a stage-keyed list would silently drop it.
  {
    const content = makeBusinessContentStore({ now: () => NOW, persist: () => {} });
    const made = content.addPiece('biz-a', { title: 'Sent then revised', channel: 'blog', stage: 'review' });
    content.advance(made.piece.id, 'publish', { kind: 'user', name: 'Commander' });   // it went out
    content.advance(made.piece.id, 'editing', { kind: 'user', name: 'Commander' });   // then came back for a fix
    const s2 = makeCreatorStudio({ content, businesses: () => [{ id: 'biz-a', name: 'Alpha' }], now: () => NOW });
    const p2 = s2.published({});
    A.eq(p2.count, 1, 'a piece sent and then moved back is STILL published — the list keys on the fact, not the stage');
    A.eq(p2.rows[0].stage, 'editing', 'even though its current stage is not a publish stage');
    A.eq(p2.rows[0].publishedBy, 'Commander', 'and it still names who sent it');
  }
}

/* ---------- the pipeline row now carries publishedBy (the fact MANAGER shows) ---------- */
{
  const s = mkStudio();
  const pl = s.pipeline({});
  const all = Object.keys(pl.byStage).reduce((a, k) => a.concat(pl.byStage[k]), []);
  const sent = all.filter(r => r.publishedAt != null);
  A.eq(sent.length, 1, 'one piece in the pipeline is published');
  A.eq(sent[0].publishedBy, 'Commander', 'and the pipeline row names who published it — no longer dropped at the station level');
  const unsent = all.filter(r => r.publishedAt == null);
  A.ok(unsent.every(r => r.publishedBy === ''), 'an unpublished row carries an empty publishedBy, never a guess');
}

/* ---------- NO STORE, NO WRITE (source-lock the discipline) ---------- */
{
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  A.ok(!/method:\s*'POST'/.test(SRC), 'the composer has no POST — read-only');
  A.ok(!/\bpersist\s*\(/.test(CODE), 'the composer never persists (it owns no store)');
  A.ok(!/\bDate\.now\b/.test(CODE), 'no Date.now in the module — the clock is injected (determinism lint)');
  // it must never claim a "scheduled" field it does not have
  A.ok(!/scheduledAt/.test(CODE), 'no invented scheduledAt field');
}

A.report('creator-studio.test');
