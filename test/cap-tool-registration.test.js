'use strict';
/* test/cap-tool-registration.test.js — the FOURTH seam: CAP_REGISTRY -> a REGISTERED handler.

   capdrift.test.js guards the three-way prop⇄capability seam (PropSprites catalog ↔ CAP_PROP_MAP ↔
   CAP_REGISTRY). It does NOT guard the seam on the OTHER side of CAP_REGISTRY: whether the tool a grant
   names is actually CONSTRUCTED and REGISTERED by the host. That unguarded gap shipped SEVEN dead
   capabilities — the registry advertised audio_generate / video_generate / video_compose / doc_publish /
   report_publish / print_prep / etsy_listing_check while none of their modules was ever required, so a
   placed prop granted a tool name with no handler behind it (docs/PHASE0-AUDIT.md §5b).

   index.js self-boots a server and cannot be require()d from a test (see apiauth.js), so this is a STATIC
   source check — the same style as source-text-integrity.test.js and module-scope-shadowing.test.js.

   Why capability-declaration and not `name:` parsing: browser.js builds its tools through read()/exec()
   helpers, so its names are ARGUMENTS (`read('browser.navigate', ...)`), never a literal `name:` field.
   A `name:` parse silently missed all 29 browser tools. A capability-declaring module, and a tool name
   appearing as a quoted literal, are both robust to how the name is assembled. */
const fs = require('fs');
const path = require('path');
const A = require('./_assert.js');
const { CAP_REGISTRY } = require('../sidecar/capability/registry.js');

const base = path.join(__dirname, '..');
const BUILTIN = path.join(base, 'sidecar', 'tools', 'builtin');

/* ---- the builtin modules the host actually requires ---- */
const host = fs.readFileSync(path.join(base, 'sidecar', 'index.js'), 'utf8');
const required = new Set();
{
  const re = /require\(\s*'\.\/tools\/builtin\/([A-Za-z0-9._-]+\.js)'\s*\)/g;
  let m;
  while ((m = re.exec(host))) required.add(m[1]);
}

const mods = [];
for (const f of fs.readdirSync(BUILTIN)) {
  if (!f.endsWith('.js')) continue;
  mods.push({ f, src: fs.readFileSync(path.join(BUILTIN, f), 'utf8') });
}

// Sanity: the extractors must have found things, or everything below would vacuously pass.
A.ok(required.size >= 20, 'index.js requires at least 20 builtin tool modules (extractor works) — got ' + required.size);
A.ok(mods.length >= 30, 'tools/builtin holds at least 30 modules (extractor works) — got ' + mods.length);

/* ---- CHECK A — every capability-declaring module is WIRED INTO THE HOST ----
   This is the load-bearing check and the exact shape of the 7-tool bug: a module that declares a real
   capability, sitting in tools/builtin, that index.js never requires. Nothing can ever call it. */
const declaredCaps = new Set();
const capabilityModules = [];
for (const { f, src } of mods) {
  const re = /capability:\s*'([A-Za-z0-9_-]+)'/g;
  let m;
  const caps = new Set();
  while ((m = re.exec(src))) caps.add(m[1]);
  if (!caps.size) continue;
  capabilityModules.push(f);
  for (const c of caps) declaredCaps.add(c);
  A.ok(required.has(f), 'capability-declaring module IS wired into the host: ' + f
    + ' (declares ' + [...caps].join(', ') + ') — a module index.js never requires is DEAD CODE');
}
A.ok(capabilityModules.length >= 20, 'at least 20 modules declare a capability — got ' + capabilityModules.length);

/* ---- CHECK B — every advertised capId has an implementing module ----
   The reverse direction: a capId resolveTools can grant that no module implements. */
const SKIP_CAPS = new Set(['compute', 'connector']);   // 'compute' = the model gate (never a callable tool); 'connector' = a DYNAMIC marker (grants come from the live MCP server)
const registryCaps = new Set();
for (const ot of Object.keys(CAP_REGISTRY)) for (const g of (CAP_REGISTRY[ot] || [])) registryCaps.add(g.capId);
for (const c of registryCaps) {
  if (SKIP_CAPS.has(c)) continue;
  A.ok(declaredCaps.has(c), 'CAP_REGISTRY capId has an implementing module: ' + c);
}

/* ---- CHECK C — every advertised TOOL NAME is declared in a module the host requires ---- */
let tools = 0;
for (const ot of Object.keys(CAP_REGISTRY)) {
  for (const g of (CAP_REGISTRY[ot] || [])) {
    if (g.capId === 'compute') continue;   // resolve.js never emits a compute grant as a callable tool
    tools++;
    const home = mods.filter(m => m.src.indexOf("'" + g.tool + "'") >= 0);
    A.ok(home.length > 0, 'advertised tool name is declared in tools/builtin: ' + ot + ' -> ' + g.tool);
    if (!home.length) continue;
    A.ok(home.some(m => required.has(m.f)),
      'advertised tool name lives in a module the host REQUIRES: ' + ot + ' -> ' + g.tool
      + ' [found in ' + home.map(m => m.f).join(', ') + ']');
  }
}
A.ok(tools > 100, 'the registry carries a meaningful number of emittable grants — got ' + tools);

/* ---- CHECK D — explicit regression pin for the seven that shipped dead ---- */
const SEVEN = [
  ['audiolab', 'audio.js'], ['cinema', 'video.js'], ['editingbay', 'compose.js'],
  ['publishinghouse', 'publish.js'], ['briefingroom', 'briefing.js'],
  ['printshop', 'printprep.js'], ['listingdesk', 'listingdesk.js']
];
for (const [cap, file] of SEVEN) {
  A.ok(required.has(file), 'the ' + cap + ' capability module (' + file + ') is required by the host');
  A.ok(declaredCaps.has(cap), 'the ' + cap + ' capId is declared by a wired module');
}

A.report('cap-tool-registration.test');
