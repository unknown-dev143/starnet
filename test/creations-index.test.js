'use strict';
/* creations-index.test.js — §37 MY CREATIONS, the unified index over every made thing.

   The gap §6 named was a MISSING VIEW, so the risk is not a crash — it is an index that LIES. Every
   assertion here is about the index staying honest across four stores that speak four vocabularies:

     • every type appears with type · id · title · status · businessId · businessName · updatedAt
     • a work order's title is its `intent` (the store has no title — no invented field)
     • a content piece's status is its §17 `stage`
     • an unreadable source is reported `readable:false`, never silently dropped
     • a row with no recorded date carries updatedAt:null and sorts LAST (a fact, not a guess)
     • the order is deterministic and total; no score, no rank, no percentage anywhere              */

const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const { makeCreationsIndex, TYPES } = require('../sidecar/creations-index.js');
const { makeBusinessContentStore } = require('../sidecar/business-content-store.js');
const { makeBusinessDocumentsStore } = require('../sidecar/business-documents-store.js');
const { makeBusinessWorkOrders } = require('../sidecar/business-workorders-store.js');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'creations-index.js'), 'utf8');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const NOW = 1000000000000;

/* A tiny in-memory stand-in for deliverable-store (station-level; only `list()` is read). */
function fakeDeliverables(rows) {
  return { list: () => rows.slice() };
}
/* Stand-ins for the three per-business structure stores — only their list accessor is read by the index.
   They honour the businessId filter the way the real stores do (isolation by key), so a fixture row is not
   counted once per business. */
function fakeList(rows) { return { list: (bizId) => rows.filter(r => !bizId || r.businessId === bizId).slice() }; }
function fakeExperiments(rows) { return { experiments: (bizId) => rows.filter(r => !bizId || r.businessId === bizId).slice() }; }

const BIZ = [{ id: 'biz-a', name: 'Alpha', stage: 'operating' }, { id: 'biz-b', name: 'Beta', stage: 'building' }];

function mkStores() {
  const content = makeBusinessContentStore({ now: () => NOW, persist: () => {} });
  A.eq(content.addPiece('biz-a', { title: 'Launch video', channel: 'youtube', stage: 'script' }).ok, true, 'fixture: piece A');
  A.eq(content.addPiece('biz-b', { title: 'Newsletter', channel: 'newsletter', stage: 'idea' }).ok, true, 'fixture: piece B');

  const documents = makeBusinessDocumentsStore({ now: () => NOW, persist: () => {} });
  A.eq(documents.create('biz-a', { title: 'SOP', type: 'sop', body: 'body text' }).ok, true, 'fixture: document');

  const workorders = makeBusinessWorkOrders({ records: [], persist: () => {}, now: () => NOW });
  A.eq(workorders.create('biz-a', { intent: 'Draft the launch plan', steps: [{ tool: 'noop' }] }).ok, true, 'fixture: work order');

  const deliverables = fakeDeliverables([
    { id: 'd1', title: 'Kept artifact', status: 'kept', updatedAt: NOW - 500 }
  ]);
  const projects = fakeList([
    { id: 'p1', businessId: 'biz-a', name: 'Launch project', status: 'active', updatedAt: NOW - 100 }
  ]);
  const experiments = fakeExperiments([
    { id: 'x1', businessId: 'biz-a', hypothesis: 'A bigger button lifts signups', status: 'running', updatedAt: NOW - 200 }
  ]);
  const automations = fakeList([
    { id: 'a1', businessId: 'biz-a', name: 'Welcome email', enabled: true, updatedAt: NOW - 300 }
  ]);
  const agents = fakeList([
    { id: 'ag1', businessId: 'biz-a', name: 'Ada', specialty: 'growth-hacker', status: 'idle', updatedAt: NOW - 150 }
  ]);
  return { content, documents, workorders, deliverables, projects, experiments, automations, agents };
}

function mkIndex(over) {
  const s = mkStores();
  return makeCreationsIndex(Object.assign({
    businesses: () => BIZ,
    content: s.content, documents: s.documents, workorders: s.workorders, deliverables: s.deliverables,
    projects: s.projects, experiments: s.experiments, automations: s.automations, agents: s.agents,
    now: () => NOW
  }, over || {}));
}

/* ---------- every type appears, each with the seven scannable facts ---------- */
{
  const o = mkIndex().index({});
  A.eq(o.ok, true, 'the index reports ok');
  A.eq(o.counts.total, 11, 'all eleven made things across the nine stores are indexed');
  for (const t of TYPES) {
    A.ok(o.counts.byType[t] >= 1, 'the ' + t + ' type appears');
  }
  for (const row of o.rows) {
    for (const f of ['type', 'id', 'title', 'status', 'businessId', 'businessName', 'updatedAt']) {
      A.ok(f in row, 'every row carries ' + f);
    }
    A.ok(o.types.indexOf(row.type) >= 0, 'every row type is in the closed vocabulary');
  }
  A.eq(o.types.length, TYPES.length, 'the wire vocabulary matches the module TYPES');
  A.eq(TYPES.length, 9, 'the index spans nine creation types, not four');
}

/* ---------- a work order's title IS its intent (the store has no title) ---------- */
{
  const o = mkIndex().index({ type: 'workorder' });
  A.eq(o.rows.length, 1, 'one work order');
  A.eq(o.rows[0].title, 'Draft the launch plan', 'the work order row shows its intent as the title');
  A.ok(!('priority' in o.rows[0]), 'no invented priority field');
}

/* ---------- a content piece's status IS its §17 stage ---------- */
{
  const o = mkIndex().index({ type: 'content' });
  const titles = o.rows.map(r => r.title).sort();
  A.eq(titles.join(','), 'Launch video,Newsletter', 'both pieces indexed');
  for (const r of o.rows) A.ok(['idea', 'script'].indexOf(r.status) >= 0, 'status is the real §17 stage');
}

/* ---------- the structures the owner BUILT appear, each named by the store's own field ---------- */
{
  // a BUSINESS: title is its name, status is its stage
  const b = mkIndex().index({ type: 'business' });
  A.eq(b.rows.length, 2, 'both ventures appear as creations');
  A.eq(b.rows.map(r => r.title).sort().join(','), 'Alpha,Beta', 'a business row is titled by its name');
  A.ok(b.rows.every(r => ['operating', 'building'].indexOf(r.status) >= 0), 'and its status is its real stage');

  // an EXPERIMENT: the store has no title — its hypothesis is what a person reads
  const x = mkIndex().index({ type: 'experiment' });
  A.eq(x.rows.length, 1, 'the experiment is indexed');
  A.eq(x.rows[0].title, 'A bigger button lifts signups', 'an experiment is titled by its hypothesis (no invented field)');
  A.eq(x.rows[0].status, 'running', 'and its status is the real experiment status');

  // an AUTOMATION: status is whether it is enabled — the store's own fact
  const a = mkIndex().index({ type: 'automation' });
  A.eq(a.rows.length, 1, 'the automation rule is indexed');
  A.eq(a.rows[0].title, 'Welcome email', 'an automation is titled by its name');
  A.eq(a.rows[0].status, 'enabled', 'and its status reflects enabled');

  // a disabled rule reads as disabled, not as a health verdict
  const idx = makeCreationsIndex({
    businesses: () => [{ id: 'biz-a', name: 'Alpha' }],
    automations: fakeList([{ id: 'a2', businessId: 'biz-a', name: 'Old rule', enabled: false, updatedAt: 1 }]),
    now: () => NOW
  });
  A.eq(idx.index({ type: 'automation' }).rows[0].status, 'disabled', 'a disabled rule reads "disabled"');

  // a PROJECT is titled by its name
  const p = mkIndex().index({ type: 'project' });
  A.eq(p.rows[0].title, 'Launch project', 'a project is titled by its name');

  // an AGENT — §37's "AI systems": a worker the owner hired (§7). Titled by its name; status is its lifecycle.
  const g = mkIndex().index({ type: 'agent' });
  A.eq(g.rows.length, 1, 'the hired agent is indexed');
  A.eq(g.rows[0].title, 'Ada', 'an agent is titled by its name');
  A.eq(g.rows[0].status, 'idle', 'and its status is the store lifecycle status');
  A.ok(!('grants' in g.rows[0]), 'no permission grants leak into the creation row');
  // a nameless agent falls back to its specialty CLASS (a real recorded field), never an invented label
  const idxAg = makeCreationsIndex({
    businesses: () => [{ id: 'biz-a', name: 'Alpha' }],
    agents: fakeList([{ id: 'ag2', businessId: 'biz-a', specialty: 'copywriter', status: 'working', updatedAt: 1 }]),
    now: () => NOW
  });
  A.eq(idxAg.index({ type: 'agent' }).rows[0].title, 'copywriter', 'a nameless agent is titled by its specialty class');
}

/* ---------- newest first; an undated row sorts LAST ---------- */
{
  const content = makeBusinessContentStore({ now: () => NOW, persist: () => {} });
  content.addPiece('biz-a', { title: 'Newer', channel: 'newsletter', stage: 'idea' });
  // force distinct updatedAt by using stores that stamp real times
  const idx = makeCreationsIndex({
    businesses: () => [{ id: 'biz-a', name: 'Alpha' }],
    content: content, now: () => NOW
  });
  const o = idx.index({});
  A.ok(o.rows.length >= 1, 'rows present');
  // and an explicitly undated row sorts last
  const idx2 = makeCreationsIndex({
    businesses: () => [{ id: 'x', name: 'X' }],
    deliverables: fakeDeliverables([
      { id: 'dated', title: 'has date', status: 'kept', updatedAt: 5 },
      { id: 'undated', title: 'no date', status: 'kept' }            // updatedAt absent
    ]),
    now: () => NOW
  });
  const o2 = idx2.index({ type: 'deliverable' });
  A.eq(o2.rows[o2.rows.length - 1].id, 'undated', 'an undated row sorts LAST');
  A.eq(o2.rows[o2.rows.length - 1].updatedAt, null, 'and its updatedAt is null, never a fabricated now');
}

/* ---------- ordering is deterministic and total (two reads never disagree) ---------- */
{
  const idx = mkIndex();
  const a = idx.index({}).rows.map(r => r.type + ':' + r.id).join('|');
  const b = idx.index({}).rows.map(r => r.type + ':' + r.id).join('|');
  A.eq(a, b, 'two reads produce the identical order');
}
/* ties break on id — deterministic, not store order */
{
  const idx = makeCreationsIndex({
    businesses: () => [{ id: 'x', name: 'X' }],
    deliverables: fakeDeliverables([
      { id: 'zzz', title: 'Z', status: 'kept', updatedAt: 9 },
      { id: 'aaa', title: 'A', status: 'kept', updatedAt: 9 }
    ]),
    now: () => NOW
  });
  A.eq(idx.index({ type: 'deliverable' }).rows.map(r => r.id).join(','), 'aaa,zzz', 'equal timestamps tie-break on id');
}

/* ---------- filtering ---------- */
{
  const idx = mkIndex();
  A.eq(idx.index({ type: 'document' }).counts.total, 1, 'type filter narrows to documents');
  // Beta owns one content piece AND is itself a creation row — the venture is counted under its own filter.
  A.eq(idx.index({ businessId: 'biz-b' }).counts.total, 2, 'business filter narrows to Beta (its piece + the venture itself)');
  const both = idx.index({ businessId: 'biz-a' });
  A.ok(both.rows.every(r => r.businessId === 'biz-a'), 'every row under a business filter belongs to it');
}

/* ---------- an UNREADABLE source is reported, never dropped silently ---------- */
{
  const boom = { pieces: () => { throw new Error('disk gone'); } };
  const idx = makeCreationsIndex({
    businesses: () => [{ id: 'biz-a', name: 'Alpha' }],
    content: boom, now: () => NOW
  });
  const o = idx.index({});
  A.eq(o.readable.content, false, 'a source that throws is marked unreadable');
  A.ok(o.note.length > 0, 'and the index carries a note — it may be incomplete, not empty');
  A.ok(/incomplete/i.test(o.note), 'the note says incomplete, never "nothing made"');
}
/* a fully-readable index carries NO note (nothing to warn about) */
{
  const o = mkIndex().index({});
  A.eq(o.note, '', 'a fully readable index carries no warning note');
  A.ok(Object.keys(o.readable).every(k => o.readable[k] === true), 'every source is readable');
}
/* a source that was never injected is not "unreadable" — it is simply absent from the read */
{
  const o = makeCreationsIndex({ businesses: () => [], now: () => NOW }).index({});
  A.eq(o.readable.deliverable, false, 'a store never wired reads as false, not as a lie');
  A.eq(o.counts.total, 0, 'and contributes no rows');
}
/* businesses() that throws still yields a valid, honest envelope */
{
  const o = makeCreationsIndex({
    businesses: () => { throw new Error('nope'); },
    content: mkStores().content, now: () => NOW
  }).index({});
  A.eq(o.ok, true, 'a throwing businesses() does not take the index down');
  A.eq(o.businessesReadable, false, 'it is reported as unreadable');
}

/* ---------- deliverables are STATION-level: they never match a business filter ---------- */
{
  const idx = mkIndex();
  A.eq(idx.index({ businessId: 'biz-a' }).rows.filter(r => r.type === 'deliverable').length, 0,
    'station-level deliverables never appear under a business filter');
  A.eq(idx.index({ type: 'deliverable' }).rows.length, 1, 'but they DO appear under the station read');
}

/* ---------- the limit caps the rows and says so ---------- */
{
  const o = mkIndex({ limit: 2 }).index({});
  A.eq(o.rows.length, 2, 'the limit caps returned rows');
  A.eq(o.truncated, true, 'and truncation is declared');
  A.eq(o.counts.total, 11, 'while the honest total is still the full count');
  A.eq(mkIndex({ limit: 2 }).DEFAULT_LIMIT, 500, 'the default limit is exported');
}

/* ---------- no score, no rank, no percentage anywhere in the source ---------- */
{
  A.ok(!/score/i.test(CODE), 'the code computes no score');
  A.ok(!/percent/i.test(CODE), 'no percentage');
  A.ok(!/(^|[^a-z])rank([^a-z]|$)/i.test(CODE), 'no rank');
  A.ok(!/Date\.now|new Date\(/.test(CODE), 'the clock is injected — the module reads none itself');
  A.ok(/readable/.test(SRC), 'per-source readability is part of the contract');
}

/* ---------- WIRING: index.js actually injects the agents store (a core lock does not prove the wiring) ---------- */
{
  const main = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'index.js'), 'utf8');
  const at = main.indexOf('makeCreationsIndex({');
  A.ok(at >= 0, 'index.js calls makeCreationsIndex');
  const body = main.slice(at, main.indexOf('});', at));
  const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  A.ok(/agents:\s*agentsStore\b/.test(code), 'index.js wires the §7 agents store in — the agent type is LIVE, not a dead adapter');
}

A.report('creations-index.test');
