'use strict';
/* mission-tiles.test.js — the tile→route contract test for §6's Command Center home (Step B).

   The audit's Step B evidence column asked for exactly this: "route tests + a tile→route contract test".
   The route tests exist (`mission-routes.test.js`). What was missing is the assertion that the Command
   Center's TILES — the doors out of the attention-first home — point at real destinations. A tile is a
   deep link PLUS a declared backing route, and either half can rot silently:

     • a tile whose `term` is not a registered window → a button that opens nothing
     • a tile whose `route` is not a real mission/creator route → a promise the sidecar never made

   This test reads the registries from SOURCE (window keys from `frontend/app/windows/*.js`
   registerWindow calls + the inline BUILDERS table; routes from `sidecar/mission-routes.js` +
   `sidecar/creator-routes.js`), and fails BY NAME on drift in either direction. It also pins that the
   home actually RENDERS the strip on the ATTENTION tab. */

const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const M = require('../frontend/app/businessmission.js');

/* ---------- 1. collect the REAL window keys ---------- */
function realWindowKeys() {
  const keys = new Set();
  // inline BUILDERS in stationui.js — the keys are object-literal property names inside `const BUILDERS = { ... }`
  const sui = read('frontend/app/stationui.js');
  const mBuilt = sui.match(/const BUILDERS\s*=\s*\{([\s\S]*?)\n\s*\};/);
  if (mBuilt) for (const m of mBuilt[1].matchAll(/^\s*([a-zA-Z0-9_]+)\s*:/gm)) keys.add(m[1]);
  // extracted windows: registerWindow('key', ...)
  const wdir = path.join(ROOT, 'frontend', 'app', 'windows');
  for (const f of fs.readdirSync(wdir)) {
    if (!f.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(wdir, f), 'utf8');
    for (const m of src.matchAll(/registerWindow\(\s*'([^']+)'/g)) keys.add(m[1]);
  }
  return keys;
}

/* ---------- 2. collect the REAL routes ---------- */
function realRoutes() {
  const routes = new Set();
  for (const file of ['sidecar/mission-routes.js', 'sidecar/creator-routes.js']) {
    const src = read(file);
    for (const m of src.matchAll(/(?:qsplit|exact):\s*'([^']+)'/g)) routes.add(m[1]);
    // rx rows embed the path in a regex literal — capture the leading /api/... literal
    for (const m of src.matchAll(/new RegExp\(\s*'\^(\/api\/[A-Za-z0-9/_-]+)/g)) routes.add(m[1]);
  }
  return routes;
}

const WINDOWS = realWindowKeys();
const ROUTES = realRoutes();

/* ---------- the registries were actually parsed (a broken parser must fail loudly, not pass empty) ---------- */
{
  A.ok(WINDOWS.size >= 20, 'parsed the real window registry from source — found ' + WINDOWS.size + ' keys');
  A.ok(ROUTES.size >= 5, 'parsed the real mission/creator routes from source — found ' + ROUTES.size);
  for (const r of ['/api/mission/board', '/api/mission/fleet', '/api/mission/attention', '/api/mission/trail',
    '/api/mission/alerts', '/api/creator/pipeline', '/api/creator/calendar', '/api/creations']) {
    A.ok(ROUTES.has(r), 'the route registry knows ' + r);
  }
  A.ok(WINDOWS.has('mission') && WINDOWS.has('creatorstudio'), 'the window registry knows mission + creatorstudio');
}

/* ---------- 3. the tiles are well-formed ---------- */
{
  A.ok(Array.isArray(M.TILES) && M.TILES.length >= 3, 'the Command Center declares a tile strip');
  const ids = new Set();
  for (const t of M.TILES) {
    A.ok(typeof t.id === 'string' && t.id, 'every tile has a stable id');
    A.ok(!ids.has(t.id), 'tile id "' + t.id + '" is unique');
    ids.add(t.id);
    A.ok(typeof t.label === 'string' && t.label, 'tile ' + t.id + ' has a label');
    A.ok(typeof t.term === 'string' && t.term, 'tile ' + t.id + ' names the window it opens');
    A.ok(Array.isArray(t.routes) && t.routes.length > 0, 'tile ' + t.id + ' declares the route(s) that back it');
  }
}

/* ---------- 4. ★ THE CONTRACT: every tile opens a real window AND points at a real route ---------- */
{
  for (const t of M.TILES) {
    A.ok(WINDOWS.has(t.term), 'tile "' + t.id + '" opens a REAL window key (' + t.term + ') — no dead door');
    for (const r of t.routes) {
      A.ok(ROUTES.has(r), 'tile "' + t.id + '" points at a REAL route (' + r + ') — no invented promise');
    }
  }
}

/* ---------- 4b. ★ a tile's SECTION is a real TAB of the window it opens ----------
   A door that promised "TRAIL" but lands on ATTENTION is a quiet lie. Each window's tabs are declared as
   `data-tab="X"` in its engine; parse them and assert the tile's section is one of them. A window whose
   engine has no tabs (a single-pane window) must carry NO section. */
{
  const ENGINE = { mission: 'frontend/app/businessmission.js', creatorstudio: 'frontend/app/creatorstudio.js' };
  const tabsOf = {};
  for (const k of Object.keys(ENGINE)) {
    const src = read(ENGINE[k]);
    tabsOf[k] = new Set(Array.from(src.matchAll(/data-tab="([^"]+)"/g), m => m[1]));
  }
  for (const k of Object.keys(ENGINE)) {
    A.ok(tabsOf[k].size >= 2, 'parsed the real tabs of ' + k + ' — found ' + tabsOf[k].size);
  }
  // the sections the tiles claim must exist as tabs of the window they open
  for (const t of M.TILES) {
    if (!t.section) continue;
    A.ok(tabsOf[t.term] && tabsOf[t.term].has(t.section),
      'tile "' + t.id + '" lands on a REAL tab (' + t.term + ' ▸ ' + t.section + ') — not the wrong pane');
  }
  // the two creator tiles land on the two distinct panes they promise
  const byId = {}; for (const t of M.TILES) byId[t.id] = t;
  A.eq(byId.creations.section, 'creations', 'the MY CREATIONS tile lands on the CREATIONS tab');
  A.ok(tabsOf.creatorstudio.has('creations'), 'and CREATIONS is a real tab of CREATOR STUDIO');
}

/* ---------- 5. every mission route the home reads is reachable — tile OR the home tab itself ---------- */
{
  const claimed = new Set();
  for (const t of M.TILES) for (const r of t.routes) claimed.add(r);
  /* ATTENTION is not a door OUT — it IS the home tab, so the console reads it directly in loadAll() rather
     than through a tile. Every other mission route is a door and must be claimed by a tile. */
  const src = read('frontend/app/businessmission.js');
  A.ok(/apiFetch\('\/api\/mission\/attention'\)/.test(src), 'the home READS /api/mission/attention (it is the home tab)');
  for (const r of ['/api/mission/board', '/api/mission/fleet', '/api/mission/trail']) {
    A.ok(claimed.has(r), 'the home reaches ' + r + ' through a tile');
  }
  // and the Step D index has a door from the home (the "missing tile from §6")
  A.ok(claimed.has('/api/creations'), 'the §37 creations index has a door from the Command Center home');
}

/* ---------- 6. tileTarget refuses a dead door (never renders a button that opens nothing) ---------- */
{
  A.eq(M.tileTarget(null), null, 'a null tile resolves to nothing');
  A.eq(M.tileTarget({}), null, 'a tile with no window key resolves to nothing');
  // with no live BUILDERS table (a headless test), a well-formed tile still resolves (the table is trusted)
  const good = M.TILES[0];
  const resolved = M.tileTarget(good);
  A.ok(resolved && resolved.term === good.term, 'a real tile resolves to its window + section');
  A.eq(resolved.section, good.section || '', 'and carries the section to land on');
}

/* ---------- 7. the home actually RENDERS the strip, on the ATTENTION tab ---------- */
{
  const src = read('frontend/app/businessmission.js');
  A.ok(/renderTiles\s*\(/.test(src), 'the console renders the tile strip');
  A.ok(/mssn-tiles/.test(src), 'through the .mssn-tiles container');
  A.ok(/onTileClick/.test(src), 'with a click handler that deep-links');
  A.ok(/H\.openTerm\(/.test(src), 'the handler opens the real window via the shared openTerm seam');
  // the strip is on the ATTENTION (home) tab — rendered in renderAttention, not a hidden tab
  A.ok(/function renderAttention[\s\S]{0,600}renderTiles\(\)/.test(src), 'the strip is on the ATTENTION home tab');
  // and a tile is NOT an action — the console still issues no POST
  A.ok(!/method:\s*'POST'/.test(src) && !/method:\s*"POST"/.test(src), 'the tiles add no mutation — still a read view');
}

/* ---------- 8. the strip is styled, and the tile styles exist ---------- */
{
  const css = read('frontend/css/businessmission.css');
  A.ok(/\.mssn-tiles\s*\{/.test(css), '.mssn-tiles is styled');
  A.ok(/\.mssn-tile\s*\{/.test(css), '.mssn-tile is styled');
}

A.report('mission-tiles.test');
