/* node test/nav-groups.test.js — the CONCEPTUAL IA (brief §5) vs the REAL window registry.

   Step A of docs/PHASE0-AUDIT-v4.md §8 maps the master brief's fifteen §5 "AI COMMAND CENTER" labels onto
   the windows that ALREADY implement them (frontend/app/navgroups.js). Nothing moved; the four physical
   docks (CREW/WORK/BUILD/SYSTEM) are untouched. The risk this test closes is DRIFT: the navgroups table is a
   second list of window keys, and a second list that is not machine-checked against the first rots into a lie
   (the route-table / validator↔data lesson). So this asserts BOTH directions against the LIVE source:

     (1) every window key the table CLAIMS exists in a real window (BUILDERS inline or registerWindow);
     (2) every DOCK window (a .bb[data-term] button in index.html) is CLAIMED by at least one §5 label —
         so no dock door is invisible to the IA, and no §5 label points at a window that isn't there;
     (3) the module is actually LOADED and EXPOSED (a data module with no loader is dead code);
     (4) the table itself is well-formed (stable ids, no duplicate labels, docks are real data-groups).

   Pure + fast: static source reads (index.html + stationui.js + windows/*.js), no DOM/boot. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
const sui = fs.readFileSync(path.join(root, 'frontend/app/stationui.js'), 'utf8');
const nav = require(path.join(root, 'frontend/app/navgroups.js'));

/* ---- the REAL window registry, read from source (the one authority the table must match) ---- */
// inline BUILDERS entries: `    key:   ['TITLE', …` inside the BUILDERS object literal.
const inlineKeys = new Set();
{
  const bStart = sui.indexOf('const BUILDERS = {');
  const bEnd = sui.indexOf('};', bStart);
  const block = sui.slice(bStart, bEnd);
  for (const m of block.matchAll(/^\s{4}([a-z][a-z0-9]*)\s*:\s*\[/gm)) inlineKeys.add(m[1]);
}
// extracted windows: StationUI.registerWindow('key', …
const regKeys = new Set();
for (const f of fs.readdirSync(path.join(root, 'frontend/app/windows'))) {
  if (!f.endsWith('.js')) continue;
  const src = fs.readFileSync(path.join(root, 'frontend/app/windows', f), 'utf8');
  for (const m of src.matchAll(/registerWindow\(\s*'([a-z][a-z0-9]*)'/g)) regKeys.add(m[1]);
}
const realWindows = new Set([...inlineKeys, ...regKeys]);

// the DOCK window keys: every `.bb[data-term="key"]` button in index.html.
const dockKeys = new Set();
for (const m of html.matchAll(/data-term="([a-z][a-z0-9]*)"/g)) dockKeys.add(m[1]);

// sanity: the registry we parsed must be non-trivial (a mis-parse that found nothing would make every
// "claims a real window" assertion vacuously green — guard the guard).
A.ok(inlineKeys.size >= 8, 'parsed the inline BUILDERS registry (found ' + inlineKeys.size + ' keys)');
A.ok(regKeys.size >= 12, 'parsed the extracted registerWindow registry (found ' + regKeys.size + ' keys)');
A.ok(dockKeys.size >= 20, 'parsed the dock .bb[data-term] buttons (found ' + dockKeys.size + ' keys)');

/* ---- (1) every claimed window key is real ---- */
const claimed = nav.windowKeys();
A.ok(claimed.length > 0, 'the §5 table claims at least one window (' + claimed.length + ' claimed)');
for (const key of claimed) {
  A.ok(realWindows.has(key), 'SPACE IA: §5 label claims window "' + key + '", which EXISTS in the registry');
}

/* ---- (2) every dock door is visible to the IA — claimed by a §5 label, OR a declared utility ---- */
const utility = new Set(nav.UTILITY || []);
for (const key of dockKeys) {
  A.ok(nav.labelsFor(key).length > 0 || utility.has(key),
    'SPACE IA: dock window "' + key + '" is either claimed by a §5 label or declared UTILITY (no invisible door)');
}
// the utility allowlist is itself honest: every entry is a real dock window, and none is also claimed
// (an entry that IS claimed would be a mis-filed window silently excused from the IA).
for (const key of utility) {
  A.ok(dockKeys.has(key), 'UTILITY "' + key + '" is a real dock window (.bb[data-term])');
  A.ok(realWindows.has(key), 'UTILITY "' + key + '" is a real window key');
  A.ok(nav.labelsFor(key).length === 0, 'UTILITY "' + key + '" is NOT also claimed by a §5 label (no double-filing)');
}
A.ok(utility.size >= 5, 'the utility allowlist is populated (found ' + utility.size + ')');

/* ---- (3) the module is loaded and exposed (not dead code) ---- */
A.ok(/<script src="app\/navgroups\.js"><\/script>/.test(html),
  'index.html loads app/navgroups.js (the IA table actually ships to the browser)');
A.ok(/get navGroups\(\)[\s\S]{0,120}typeof NavGroups !== 'undefined'/.test(sui),
  'StationUI.h exposes navGroups (the single reader for the label→window mapping)');

/* ---- (4) the table is well-formed ---- */
A.ok(nav.all().length === 15, 'the §5 table has exactly 15 labels (got ' + nav.all().length + ')');
{
  const ids = nav.ids(), labels = nav.labels();
  A.ok(new Set(ids).size === ids.length, 'no duplicate §5 ids');
  A.ok(new Set(labels).size === labels.length, 'no duplicate §5 labels');
  for (const g of nav.all()) {
    A.ok(/^[a-z][a-z-]*$/.test(g.id), '§5 id "' + g.id + '" is a stable slug');
    A.ok(g.label === g.label.toUpperCase(), '§5 label "' + g.label + '" is uppercase (matches the brief)');
    A.ok(g.dock === null || nav.DOCKS.indexOf(g.dock) >= 0, '§5 label "' + g.label + '" names a real dock (' + g.dock + ')');
    A.ok(typeof g.note === 'string' && g.note.length > 10, '§5 label "' + g.label + '" carries an honest note');
    // a non-pending label must point at ≥1 window; a pending one must point at none.
    if (g.pending) A.ok((g.windows || []).length === 0, 'pending §5 label "' + g.label + '" claims NO window (honest)');
    else A.ok((g.windows || []).length > 0, '§5 label "' + g.label + '" resolves to ≥1 real window');
  }
  // the two labels the brief names that are genuinely owed — declared, not silently dropped.
  A.ok(nav.pendingLabels().indexOf('TERMINAL') >= 0, 'TERMINAL is declared pending (Recorded gap, audit §6)');
  A.ok(nav.resolve('COMMAND CENTER') && nav.resolve('command-center'),
    'resolve() accepts the §5 display label AND its slug');
  A.ok(nav.resolve('nope') === null, 'resolve() returns null for an unknown label (no silent default)');
}

A.report('nav-groups.test');
