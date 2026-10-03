'use strict';
/* creatorstudio.test.js — the §20 CREATOR STUDIO console (frontend shapers + the window wiring).

   Two things this suite exists to catch:

     1. SHAPING. Every piece renders through ONE shaper (pipeline + calendar), stage/channel labels are
        resolved once so the stored value and the label cannot disagree, and an unreadable store stays
        unreadable through the UI (never silently an empty board).
     2. WIRING. The engine loads, the window slot registers CREATOR STUDIO against the dock key, and the
        console holds NO ranking/score policy of its own. */

const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const S = require('../frontend/app/creatorstudio.js');

const NOW = 1000000000000;
const ROOT = path.join(__dirname, '..');

/* ---------- labels resolve once, never disagree ---------- */
{
  A.eq(S.stageLabel('script'), 'SCRIPT', 'a known stage labels');
  A.eq(S.stageLabel('weird'), 'WEIRD', 'an unknown stage falls back to its slug uppercased (never UNKNOWN over a real value)');
  A.eq(S.stageLabel(''), 'UNKNOWN', 'an empty stage is the only UNKNOWN');
  A.eq(S.channelLabel('product-marketing'), 'PRODUCT MKT', 'a multi-word channel labels');
}

/* ---------- shapePiece: one row, one shape ---------- */
{
  const p = S.shapePiece({ id: 'x', title: 'T', businessName: 'B', channel: 'youtube', stage: 'review', assets: ['a', 'b'], updatedAt: NOW - 3600000, dateSource: 'updated', datedAt: NOW }, NOW);
  A.eq(p.stageLabel, 'REVIEW', 'the stage label is resolved on the shaped row');
  A.eq(p.channelLabel, 'YOUTUBE', 'the channel label too');
  A.eq(p.assetCount, 2, 'the asset count is derived');
  A.eq(p.published, false, 'published is false when there is no publishedAt');
  A.eq(p.updatedRel, '1h', 'the relative time is shaped');
  // a published piece reports published:true
  A.eq(S.shapePiece({ publishedAt: NOW, datedAt: NOW, dateSource: 'published' }, NOW).published, true, 'a publishedAt flips published');
}

/* ---------- shapePipeline: ordered stages, counts, no score ---------- */
{
  const raw = {
    ok: true, readable: true, stages: ['idea', 'script', 'publish'],
    counts: { total: 2, published: 1, byStage: { idea: 1, script: 1, publish: 0 }, byChannel: { youtube: 1, blog: 1 } },
    byStage: { idea: [{ id: 'a', title: 'A', stage: 'idea', channel: 'youtube' }], script: [{ id: 'b', title: 'B', stage: 'script', channel: 'blog' }], publish: [] }
  };
  const pl = S.shapePipeline(raw, NOW);
  A.eq(pl.ok, true, 'ok is carried');
  A.eq(pl.columns.length, 3, 'one column per stage, in wire order');
  A.eq(pl.columns[0].label, 'IDEA', 'columns carry the resolved label');
  A.eq(pl.columns[1].rows.length, 1, 'rows land in the right column');
  A.eq(pl.counts.total, 2, 'the counts are carried');
  A.ok(!('score' in pl) && !('health' in pl), 'no score / health on the shaped pipeline');
  // an unreadable pipeline stays unreadable through the UI
  A.eq(S.shapePipeline({ ok: true, readable: false, stages: ['idea'], counts: {}, byStage: {} }, NOW).readable, false, 'an unreadable store stays unreadable');
}

/* ---------- shapeCalendar: day buckets, undated counted ---------- */
{
  const raw = { ok: true, readable: true, days: [{ day: '2026-10-03', rows: [{ id: 'a', title: 'A', stage: 'publish', channel: 'blog', dateSource: 'published', datedAt: NOW, publishedAt: NOW }] }], undated: 2 };
  const cal = S.shapeCalendar(raw, NOW);
  A.eq(cal.days.length, 1, 'day buckets are carried');
  A.eq(cal.days[0].day, '2026-10-03', 'with their day key');
  A.eq(cal.days[0].rows[0].dateSource, 'published', 'each row names its date source');
  A.eq(cal.undated, 2, 'the undated count is carried (never binned into a day)');
}

/* ---------- shapeHeader: a quote of counts, no verdict ---------- */
{
  const h = S.shapeHeader({ total: 4, published: 1, byStage: { review: 2 } });
  A.ok(/4 pieces/.test(h.text), 'the header counts the pieces');
  A.ok(/1 published/.test(h.text), 'and the published count');
  A.ok(/2 awaiting review/.test(h.text), 'and the review count');
  A.ok(!/health|score|%/i.test(h.text), 'the header carries no verdict');
  A.eq(S.shapeHeader({}).text, '0 pieces', 'an empty read says zero pieces, not a blank');
}

/* ---------- the console holds NO policy, no mutation ---------- */
{
  const src = fs.readFileSync(path.join(ROOT, 'frontend', 'app', 'creatorstudio.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  A.ok(!/method:\s*'POST'/.test(src) && !/method:\s*"POST"/.test(src), 'the console issues no POST — it is a read');
  A.ok(!/\balert\s*\(/.test(src) && !/\bconfirm\s*\(/.test(src) && !/\bprompt\s*\(/.test(src), 'no native alert/confirm/prompt');
  A.ok(code.toLowerCase().indexOf('scheduled') < 0 || /no separate/i.test(src), 'the CODE never claims a scheduled field (the comment may name the absence)');
  A.ok(!/%/.test(code), 'no percentage anywhere in the CODE — the pipeline is a board, not a progress metre');
}

/* ---------- the window slot + dock wiring ---------- */
{
  const slot = fs.readFileSync(path.join(ROOT, 'frontend', 'app', 'windows', 'creatorstudio.js'), 'utf8');
  A.ok(/registerWindow\('creatorstudio',\s*'CREATOR STUDIO'/.test(slot), 'the window slot registers CREATOR STUDIO against the dock key');
  A.ok(/CreatorStudioUI\.mount/.test(slot), 'and mounts the engine');
  const html = fs.readFileSync(path.join(ROOT, 'frontend', 'index.html'), 'utf8');
  A.ok(/data-term="creatorstudio"/.test(html), 'the dock carries a CREATOR STUDIO button');
  A.ok(/data-term="creatorstudio"[^>]*>[\s\S]{0,400}CREATOR STUDIO/.test(html), 'and its label matches the window title (TITLE LAW)');
  A.ok(/<script src="app\/creatorstudio\.js"><\/script>/.test(html), 'index.html loads the engine');
  A.ok(/<script src="app\/windows\/creatorstudio\.js"><\/script>/.test(html), 'and the window slot');
  A.ok(html.indexOf('app/creatorstudio.js') < html.indexOf('app/windows/creatorstudio.js'), 'the engine loads BEFORE the slot');
  A.ok(/href="css\/creatorstudio\.css"/.test(html), 'the console stylesheet is linked');
}

/* ---------- ERROR STATES: a rejected read must be NAMED, not a spinner forever (Step E) ---------- */
{
  const src = fs.readFileSync(path.join(ROOT, 'frontend', 'app', 'creatorstudio.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  A.ok(/\.catch\(fail\('pipeline'\)\)/.test(code) && /\.catch\(fail\('calendar'\)\)/.test(code),
    'both creator reads name their failure panel (a dropped fetch must not leave a spinner forever)');
  A.ok(/cs-err/.test(src), 'the error state is rendered through the .cs-err surface');
  const css = fs.readFileSync(path.join(ROOT, 'frontend', 'css', 'creatorstudio.css'), 'utf8');
  A.ok(/\.cs-err\s*\{/.test(css), 'and .cs-err is styled (distinct from .cs-none: a failure is not an empty)');
}

/* ---------- mount(null) is a safe no-op ---------- */
{
  A.notThrows(() => { const r = S.mount(null); A.ok(r === null, 'mounting nothing returns null'); }, 'mount(null) does not throw');
}

A.report('creatorstudio');
