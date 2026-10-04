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

/* ---------- shapePublished: what a human sent, with who signed it ---------- */
{
  const raw = {
    ok: true, readable: true, count: 1,
    rows: [{ id: 'p1', title: 'Shipped', stage: 'publish', channel: 'blog', publishedAt: NOW, publishedBy: 'Commander' }],
    note: 'a piece appears here only if a HUMAN published it'
  };
  const pub = S.shapePublished(raw, NOW);
  A.eq(pub.ok, true, 'the published read shapes ok');
  A.eq(pub.count, 1, 'the count is carried');
  A.eq(pub.rows.length, 1, 'and its rows');
  A.eq(pub.rows[0].publishedBy, 'Commander', 'the human who signed it is carried through');
  A.eq(pub.rows[0].published, true, 'and the row reads as published');
  A.ok(pub.rows[0].publishedRel.length > 0, 'with a relative "sent" time');

  // a null read is an empty, honest envelope — never a throw
  A.eq(S.shapePublished(null, NOW).rows.length, 0, 'a null read shapes to an empty list');
  A.eq(S.shapePublished(null, NOW).count, 0, 'with a zero count');
  // count falls back to the row count when the wire omits it
  A.eq(S.shapePublished({ ok: true, rows: [{ id: 'x', title: 'X' }] }, NOW).count, 1, 'a missing count falls back to the row length');
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

/* ---------- shapeCreations: the §37 unified index, shaped (content · document · work order · deliverable) ---------- */
{
  const raw = {
    ok: true, types: ['content', 'document', 'workorder', 'deliverable'],
    counts: { total: 3, byType: { content: 1, document: 1, workorder: 1, deliverable: 0 } },
    rows: [
      { type: 'content', id: 'c1', title: 'A video', status: 'script', businessId: 'b', businessName: 'Alpha', updatedAt: NOW - 3600000 },
      { type: 'workorder', id: 'w1', title: 'Draft the plan', status: 'planned', businessId: 'b', businessName: 'Alpha', updatedAt: NOW },
      { type: 'deliverable', id: 'd1', title: 'Kept artifact', status: 'kept', businessId: '', businessName: 'Station', updatedAt: null }
    ],
    readable: { content: true, document: true, workorder: true, deliverable: true },
    truncated: false, note: ''
  };
  const c = S.shapeCreations(raw, NOW);
  A.eq(c.ok, true, 'the index reports ok');
  A.eq(c.rows.length, 3, 'every row is carried through');
  A.eq(c.rows[0].typeLabel, 'CONTENT', 'the type is labelled');
  A.eq(c.rows[1].typeLabel, 'WORK ORDER', 'a work order labels as WORK ORDER');
  A.eq(c.rows[2].updatedRel, '', 'an undated row renders NO relative time (never "1970")');
  A.eq(c.rows[2].updatedAt, null, 'and its updatedAt stays null');
  A.eq(c.rows[2].businessName, 'Station', 'a station-level row names the station');
  A.eq(c.counts.total, 3, 'the count is carried');
  // no score/rank/percentage in the shaped output
  A.ok(!/score|rank|%/i.test(JSON.stringify(c)), 'the shaped index carries no score/rank/percent');
  // a null read is an empty, honest envelope — never a throw
  A.eq(S.shapeCreations(null, NOW).rows.length, 0, 'a null read shapes to an empty list');
  A.eq(S.shapeCreations(null, NOW).counts.total, 0, 'with a zero total');
  // an unreadable source is carried through (the viewer warns; it does not shorten the list silently)
  const u = S.shapeCreations({ ok: true, rows: [], counts: { total: 0 }, readable: { content: false, document: true } }, NOW);
  A.eq(u.readable.content, false, 'a source that could not be read is carried as readable:false');

  // THE STRUCTURES THE OWNER BUILT (§37) also label — the index spans eight types, not four.
  for (const [t, label] of [['business', 'BUSINESS'], ['project', 'PROJECT'], ['experiment', 'EXPERIMENT'], ['automation', 'AUTOMATION']]) {
    A.eq(S.typeLabel(t), label, 'the ' + t + ' type labels as ' + label);
  }
  const built = S.shapeCreations({
    ok: true,
    rows: [{ type: 'business', id: 'b1', title: 'Alpha', status: 'operating', businessId: 'b1', businessName: 'Alpha', updatedAt: NOW }],
    counts: { total: 1, byType: { business: 1 } }
  }, NOW);
  A.eq(built.rows[0].typeLabel, 'BUSINESS', 'a shaped business row carries its label');
  A.eq(built.rows[0].status, 'operating', 'and its real stage as the status');
  // an unknown future type still labels (never a blank cell), just upper-cased
  A.eq(S.typeLabel('gadget'), 'GADGET', 'an unknown type upper-cases rather than rendering blank');
}
/* the creations header is a plain count, no verdict */
{
  A.ok(/3 creations/.test(S.shapeCreationsHeader({ total: 3 }).text), 'the creations header counts');
  A.eq(S.shapeCreationsHeader({ total: 1 }).text, '1 creation', 'and singularises');
  A.ok(!/health|score|%/i.test(S.shapeCreationsHeader({ total: 9 }).text), 'no verdict');
}
/* the CREATIONS tab exists in the engine source, and reads the §37 route */
{
  const src = fs.readFileSync(path.join(ROOT, 'frontend', 'app', 'creatorstudio.js'), 'utf8');
  A.ok(/data-tab="creations"/.test(src), 'the console declares a CREATIONS tab');
  A.ok(/apiFetch\('\/api\/creations'\)/.test(src), 'and reads /api/creations (the §37 index has a viewer)');
  A.ok(/renderCreations/.test(src), 'with a renderer');
  A.ok(/\.catch\(fail\('creations'\)\)/.test(src), 'and a guarded read (a dropped fetch is named, not a spinner)');
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
