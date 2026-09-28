'use strict';
/* route-table-collision.test.js — ONE path, ONE handler.

   index.js builds ROUTES by spreading each Business OS module's table ABOVE its own rows, and
   dispatchRoute() is FIRST-MATCH-WINS. The module headers all claim "every pattern is anchored, so table
   position is not load-bearing" — true for rx/qrx rows, but FALSE for two rows sharing one exact/qsplit,
   because those are identity tests on the raw url. That is exactly how agent-routes.js's bare
   `GET /api/permissions` silently shadowed index.js's grant list: the Permissions panel asked for
   {grants, masterBypass} and got {tiers, defaultGrants} — HTTP 200, no error, no log, an empty panel.

   index.js cannot be `require`d without booting the whole server, so this reads the mounted tables as
   SOURCE. It flags any (method, path) or (method, regex) claimed by more than one row. */

const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');

const SIDE = path.join(__dirname, '..', 'sidecar');
// The tables index.js actually mounts (one `...xRoutes.routes` spread each) + index.js's own inline rows.
const FILES = ['index.js', 'business-routes.js', 'maker-routes.js', 'task-routes.js', 'agent-routes.js',
  'manager-routes.js', 'automation-routes.js', 'worker-routes.js', 'remote-routes.js'];

/* Blank out // and /* *​/ comments, preserving newlines AND column positions so a row's line number stays
   true. A commented-out row, or a doc example that looks like one, must never be counted as a real claim. */
function stripComments(src) {
  const out = src.split('');
  let i = 0; const n = src.length;
  while (i < n) {
    const c = src[i]; const c2 = src[i + 1];
    if (c === '/' && c2 === '/') { while (i < n && src[i] !== '\n') { out[i] = ' '; i++; } continue; }
    if (c === '/' && c2 === '*') {
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] !== '\n') out[i] = ' '; i++; }
      if (i < n) { out[i] = ' '; out[i + 1] = ' '; i += 2; }
      continue;
    }
    // string literals are opaque: a '//' inside one is not a comment (and vice versa).
    if (c === "'" || c === '"' || c === '`') {
      const q = c; i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    i++;
  }
  return out.join('');
}

// A route row: { m: <method(s)>, <key>: <value>, h: ... }. `m` and the key are required; `h` proves it is a row.
const ROW = /\{\s*m:\s*(\[[^\]]*\]|'[^']*'|"[^"]*")\s*,\s*(exact|qsplit|prefix|qprefix|rx|qrx)\s*:\s*(\/(?:\\.|\[[^\]]*\]|[^/\\\n])*\/[a-z]*|'[^']*'|"[^"]*"|[A-Za-z_$][\w$]*)\s*,[^}]*?\bh\s*:/g;

const claims = [];
let scanned = 0;
for (const f of FILES) {
  const raw = fs.readFileSync(path.join(SIDE, f), 'utf8');
  const src = stripComments(raw);
  scanned += src.length;
  let m;
  ROW.lastIndex = 0;
  while ((m = ROW.exec(src))) {
    const line = src.slice(0, m.index).split('\n').length;
    const methods = m[1].replace(/[[\]'"]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
    // The token text IS the identity: two rows naming the same string or the same RX_ constant cannot both win.
    // A quoted path keeps its quotes in the capture, so strip them; regex literals and RX_ names stay verbatim.
    let value = m[3];
    if (value[0] === "'" || value[0] === '"') value = value.slice(1, -1);
    const kind = (m[2] === 'rx' || m[2] === 'qrx') ? 'regex' : 'path';
    for (const method of methods) claims.push({ file: f, line, method, kind, value, key: m[2] });
  }
}

A.ok(claims.length > 200, 'the scanner found the route tables (' + claims.length + ' claims across ' + FILES.length + ' files)');
A.ok(scanned > 200000, 'the scanner actually read the sources');

// self-check: the scanner sees a row we know exists, at the right place. Rows are counted per LINE, because a
// row carrying m: ['GET','POST'] legitimately yields one claim per method.
A.ok(claims.some((c) => c.file === 'agent-routes.js' && c.key === 'exact' && c.value === '/api/roles'),
  'the scanner finds a known row (agent-routes GET /api/roles)');
A.eq(new Set(claims.filter((c) => c.file === 'agent-routes.js').map((c) => c.line)).size, 11,
  'agent-routes exposes exactly 11 rows (its bare /api/permissions row is gone)');

const seen = new Map();
for (const c of claims) {
  const k = c.method + ' ' + c.kind + ' ' + c.value;
  if (!seen.has(k)) seen.set(k, []);
  seen.get(k).push(c);
}
const collisions = [];
for (const [k, list] of seen) if (list.length > 1) collisions.push(k + '  →  ' + list.map((c) => c.file + ':' + c.line).join(', '));

A.eq(collisions.length, 0, 'no two mounted route rows claim the same (method, path) — first-match-wins makes the loser dead');
if (collisions.length) console.log('  collisions:\n   ' + collisions.join('\n   '));

A.report('route-table-collision');
