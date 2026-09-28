'use strict';
/* brand-identity.test.js — SPACE STATION IDENTITY guard (transformation brief §3).

   The brief's §3 says the product must not carry another product's visible identity, and §31/§35
   RULE 4 say the third-party license + attribution must NEVER be removed. Both are easy to regress:
   the legacy word is still in hundreds of comments and identifiers, so a future "fix" could either
   (a) miss the visible chrome, or (b) over-correct and scrub the licence. This suite pins both.

   It is a SOURCE LOCK, not a rendering test, so it must be precise about the distinction:
     · RENDERED TEXT  (what a user reads)   → must be SPACESTATION, never the legacy word.
     · IDENTIFIERS    (__STARNET_API__ etc) → must be LEFT ALONE (renaming them breaks the app).
     · COMMENTS       (dev notes)           → not user-visible; deliberately not enforced.
     · ATTRIBUTION    (MIT notice)          → must survive, and the lineage note must stay HONEST.

   Comments are stripped before the visible-text scan, because the header comments legitimately
   discuss the lineage ("built on the earlier StarNet harness") and must not trip the lock.       */

const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/* Extract every STRING LITERAL from source, skipping comments, regex literals and template
   `${…}` interpolation. This replaces the first cut's "strip comments, then regex the quotes",
   which had two blind spots that each hid a REAL user-visible offender and let it ship green:
     · a `/*` INSIDE a string literal — sidecar/plugins.js writes `'/* ' + name + ' — a … plugin.'`,
       so the phantom block comment swallowed the rest of the file;
     · a regex literal containing a quote — sidecar/tools/builtin/shell.js has /[\s"'`=(]/ in its
       guard, which desynced the quote matcher so the `why:` sentence after it was never inspected.
   A single pass that tracks the previous significant token (to tell a regex from a division) cannot
   be fooled by either. */
function extractStrings(src) {
  const REGEX_PREV = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '^', '~', '\n', '']);
  const KEYWORD = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'do', 'else', 'case', 'yield', 'await', 'throw']);
  const out = [];
  let i = 0; const n = src.length; let line = 1; let prev = ''; let word = '';
  while (i < n) {
    const c = src[i]; const c2 = src[i + 1];
    if (c === '\n') { line++; prev = '\n'; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '/' && c2 === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && c2 === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; } i += 2; continue; }
    if (c === '/' && (REGEX_PREV.has(prev) || KEYWORD.has(word))) {
      i++; let cls = false;
      while (i < n) {
        const r = src[i];
        if (r === '\\') { i += 2; continue; }
        if (r === '[') cls = true; else if (r === ']') cls = false;
        else if (r === '/' && !cls) { i++; break; }
        else if (r === '\n') { line++; break; }
        i++;
      }
      while (i < n && /[a-z]/.test(src[i])) i++;
      prev = '/'; word = ''; continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c; const at = line; i++; let buf = ''; let depth = 0;
      while (i < n) {
        const r = src[i];
        if (r === '\\') { buf += r + (src[i + 1] || ''); i += 2; continue; }
        if (quote === '`' && r === '$' && src[i + 1] === '{') { depth++; buf += '${'; i += 2; continue; }
        if (quote === '`' && depth > 0 && r === '}') { depth--; buf += '}'; i++; continue; }
        if (r === quote && depth === 0) { i++; break; }
        if (r === '\n') line++;
        buf += r; i++;
      }
      out.push({ line: at, text: buf, raw: quote + buf + quote });
      prev = quote; word = ''; continue;
    }
    if (/[A-Za-z_$]/.test(c)) { let w = ''; while (i < n && /[A-Za-z0-9_$]/.test(src[i])) { w += src[i]; i++; } word = w; prev = w[w.length - 1]; continue; }
    prev = c; word = ''; i++;
  }
  return out;
}

/* .ps1 / .sh: `#` line comments (plus PowerShell's <# #> blocks), '…' and "…" strings. The JS
   tokenizer above does not know `#`, so these two languages get their own pass — §10 scans both. */
function extractQuoted(src, { ps = false } = {}) {
  const out = [];
  let i = 0; const n = src.length; let line = 1;
  while (i < n) {
    const c = src[i]; const c2 = src[i + 1];
    if (c === '\n') { line++; i++; continue; }
    if (ps && c === '<' && c2 === '#') { i += 2; while (i < n && !(src[i] === '#' && src[i + 1] === '>')) { if (src[i] === '\n') line++; i++; } i += 2; continue; }
    if (c === '#') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '"' || c === "'") {
      const q = c; const at = line; i++; let buf = '';
      while (i < n) {
        const r = src[i];
        if (r === '\n') { line++; buf += r; i++; continue; }
        if (q === "'" && r === "'" && src[i + 1] === "'") { buf += "''"; i += 2; continue; }        // PS doubled-quote escape
        if (q === '"' && ps && r === '`') { buf += r + (src[i + 1] || ''); i += 2; continue; }      // PS backtick escape
        if (q === '"' && !ps && r === '\\') { buf += r + (src[i + 1] || ''); i += 2; continue; }    // sh backslash escape
        if (r === q) { i++; break; }
        buf += r; i++;
      }
      out.push({ line: at, text: buf, raw: q + buf + q });
      continue;
    }
    i++;
  }
  return out;
}

/* The extractor is itself load-bearing — prove it is NOT fooled by the two constructs that hid real
   offenders (a `/*` inside a string, a quote inside a regex). If a future edit regresses it to the
   naive form, this fails loudly instead of silently letting a legacy string through. */
{
  const probe = "const a = 'x /* y'; const r = /[\"'`=(]/; const b = 'StarNet';";
  const got = extractStrings(probe).map((s) => s.text);
  A.eq(got.join('|'), 'x /* y|StarNet',
    'the string extractor skips comments and regex literals and still finds every real literal');
}

const LEGACY = /StarNet|STARNET/;

/* The identity allowlist shared by §2, §9 and §10 — ONE definition so the three locks cannot drift
   (one lock, one concern). A use is allowed iff it is lineage-honest, an internal identifier, or the
   auth header. `lit` is the literal CONTENT (quotes stripped), so `^`-anchored patterns work. */
const HONEST = /built on the earlier|back-compat|previously called|renamed|not a StarNet agent|earlier StarNet harness|Skynet/;
const IDENTIFIER = /__STARNET|STARNET_|SKYNET_|starnet[._-]|StarNet-Token|Skynet-Token|starnet-token|skynet-token|^X-|^x-/;
const allowedContent = (lit) => HONEST.test(lit) || IDENTIFIER.test(lit);

/* ---------- 1. index.html: the RENDERED chrome carries no legacy brand ---------- */
{
  const html = read('frontend/index.html');
  // comments are fine (they discuss lineage); only rendered markup matters
  const rendered = html.replace(/<!--[\s\S]*?-->/g, '');

  // the three loudest surfaces, each asserted by its own element so a failure names the place
  A.ok(!/class="boot-mark"[^>]*>[^<]*STARNET/i.test(rendered),
    'the boot screen mark does not render the legacy word');
  A.ok(/class="boot-mark"[^>]*>[^<]*SPACESTATION/i.test(rendered),
    'the boot screen mark renders SPACESTATION');

  const tbTags = rendered.match(/class="cc-tb-tag">([^<]*)</g) || [];
  A.ok(tbTags.length >= 5, 'all titlebar tags are present');
  A.ok(tbTags.every((t) => !LEGACY.test(t)), 'no titlebar tag renders the legacy word');
  A.ok(tbTags.every((t) => /SPACESTATION/.test(t)), 'every titlebar tag renders SPACESTATION');

  // the masthead logo + its screen-reader label
  A.ok(!/class="logo-img"[^>]*aria-label="[^"]*STARNET/i.test(rendered),
    'the masthead logo label is not the legacy word');

  // no src/href points at a legacy-branded ASSET in the shipped markup
  const srcs = rendered.match(/(?:src|href)="([^"]+)"/g) || [];
  const legacyAssets = srcs.filter((s) => /starnet[-_]|starnet\./i.test(s) && /logo|wordmark|brand/i.test(s));
  A.eq(legacyAssets.length, 0, 'no brand logo asset is referenced by its legacy filename');

  // the page title is the product name
  A.ok(/<title>SPACESTATION<\/title>/.test(rendered), 'the page title is SPACESTATION');
}

/* ---------- 2. every frontend JS module: no RENDERED legacy text ----------
   Recurses the WHOLE frontend tree. The first cut read only the flat `frontend/app` listing, so
   frontend/app/windows/ and frontend/app/recipe-catalog/ were never scanned — and that is exactly
   where three user-visible strings (a Telegram step, a Signal step, a routine delivery label) kept
   the legacy word. It now also covers frontend/js/ (shared modules the page loads). */
{
  const files = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) files.push(p);
    }
  })(path.join(ROOT, 'frontend'));
  const offenders = [];
  for (const p of files) {
    for (const s of extractStrings(fs.readFileSync(p, 'utf8'))) {
      if (!LEGACY.test(s.text)) continue;
      if (allowedContent(s.text)) continue;
      offenders.push(path.relative(ROOT, p) + ':' + s.line + '  ' + s.raw.slice(0, 80));
    }
  }
  A.eq(offenders.length, 0, 'no frontend module renders the legacy brand as visible text');
  if (offenders.length) console.log('  offenders:\n   ' + offenders.join('\n   '));
  A.ok(files.length > 60, 'the frontend scan actually found the modules');
}

/* ---------- 3. IDENTIFIERS must NOT have been renamed (the over-correction guard) ---------- */
{
  // These are load-bearing: the desktop shell injects them, the sidecar reads them. If a future
  // "rebrand" renamed them, the app would break at boot while looking correct in review.
  const html = read('frontend/index.html');
  A.ok(/__STARNET_API__/.test(html), 'the __STARNET_API__ global injection is still wired');
  A.ok(/__STARNET_CUSTOM_CHROME__/.test(html), 'the __STARNET_CUSTOM_CHROME__ flag is still wired');
  A.ok(/__STARNET_DEV__/.test(html), 'the __STARNET_DEV__ dev gate is still wired');

  // the sidecar's env prefix chain must keep STARNET_ as a live alias (ENV() reads it)
  const index = read('sidecar/index.js');
  A.ok(/STARNET_/.test(index), 'the sidecar still honours the STARNET_ env alias');
  A.ok(/SKYNET_/.test(index), 'the sidecar still honours the SKYNET_ legacy alias');
}

/* ---------- 4. ATTRIBUTION must survive (§3 / §31 / RULE 4) ---------- */
{
  const lic = read('LICENSE');
  A.ok(/MIT License/.test(lic), 'the MIT licence text is intact');
  A.ok(/Copyright \(c\)/.test(lic), 'the copyright line survives');
  A.ok(/Andrew Sims/.test(lic), 'the original author is still credited');
  A.ok(!/SPACESTATION|SpaceStation/.test(lic),
    'the licence is NOT rebranded — it credits the original author, not this product');

  const pkg = JSON.parse(read('package.json'));
  A.eq(pkg.license, 'MIT', 'package.json still declares MIT');
  A.ok(/fork of starnet/i.test(pkg.description || ''),
    'package.json still honestly declares the lineage');
  A.ok(/Andrew Sims/.test(pkg.author || ''), 'package.json still credits the original author');
}

/* ---------- 5. the SpaceStation wordmark exists and is the one referenced ---------- */
{
  const wordmark = path.join(ROOT, 'frontend', 'assets', 'brand', 'spacestation-wordmark.svg');
  A.ok(fs.existsSync(wordmark), 'a SpaceStation wordmark asset exists');
  const svg = fs.readFileSync(wordmark, 'utf8');
  A.ok(/<svg/.test(svg) && /viewBox=/.test(svg), 'the wordmark is a valid svg with a viewBox');
  A.ok(/SPACESTATION/.test(svg), 'the wordmark names the product');
  A.ok(!LEGACY.test(svg), 'the wordmark carries no legacy brand');

  // both surfaces that render it must point at THIS file
  const css = read('frontend/css/style.css');
  A.ok(/spacestation-wordmark\.svg/.test(css), 'the masthead mask points at the SpaceStation wordmark');
  const html = read('frontend/index.html');
  A.ok(/spacestation-wordmark\.svg/.test(html), 'the splash points at the SpaceStation wordmark');
}

/* ---------- 6. the PACKAGED app ships under the SpaceStation name ---------- */
{
  const conf = JSON.parse(read('src-tauri/tauri.conf.json'));
  A.eq(conf.productName, 'SpaceStation',
    'the packaged app is named SpaceStation (installer, Start menu, taskbar, window title)');
  // IDENTIFIERS that must NOT move: the bundle id keys the app-data dir and the updater identity.
  A.eq(conf.identifier, 'ai.skynet.harness',
    'the bundle identifier is unchanged — it keys the app data directory and the updater');
  A.eq(conf.bundle.publisher, 'Andrew Sims', 'the publisher is still the original author');

  // The NSIS hooks read the uninstall registry key BY PRODUCT NAME. They must stay in lockstep
  // with tauri.conf.json or a manual upgrade stops finding the installed copy.
  const hooks = read('src-tauri/installer/hooks.nsh');
  A.ok(hooks.includes('Uninstall\\' + conf.productName + '"'),
    'the installer hooks read the uninstall key named by productName (lockstep with tauri.conf.json)');
  // The shell binary name is an IDENTIFIER (the Rust crate name) — renaming it breaks the build.
  A.ok(hooks.includes('skynet-desktop'), 'the installer still targets the real shell binary name');
  A.ok(/name\s*=\s*"skynet-desktop"/.test(read('src-tauri/Cargo.toml')),
    'the Rust crate name is unchanged — it is the binary name, not a brand');

  A.ok(/SpaceStation uses the microphone/.test(read('src-tauri/Info.plist')),
    'the macOS microphone permission prompt names SpaceStation');
}

/* ---------- 7. README: the legacy brand survives only in URLs and the attribution clause ---------- */
{
  const md = read('README.md');
  const bad = md.split('\n')
    .filter((l) => LEGACY.test(l))
    .filter((l) => !/https?:\/\//.test(l)
      && !/upstream StarNet|fork of|ship it as StarNet|\*\*StarNet\*\* name/.test(l));
  A.eq(bad.length, 0,
    'README prose carries the legacy brand only inside URLs and the upstream attribution clause');
  if (bad.length) console.log('  offenders:\n   ' + bad.join('\n   '));
  A.ok(/spacestation-wordmark\.svg/.test(md), 'the README logo is the SpaceStation wordmark');
  A.ok(/alt="SpaceStation"/.test(md), 'the README logo is labelled SpaceStation');
  A.ok(/fork of \[StarNet\]/.test(md), 'the README still credits the upstream project honestly');
}

/* ---------- 8. the public website carries no legacy brand (outside the mirrored app) ---------- */
{
  const web = path.join(ROOT, 'website');
  const files = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'app') continue;   // website/app is the frontend mirror, covered by §1/§2 rules
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(html|js|css)$/.test(e.name)) files.push(p);
    }
  })(web);
  const offenders = files.filter((p) => LEGACY.test(fs.readFileSync(p, 'utf8').replace(/<!--[\s\S]*?-->/g, '')));
  A.eq(offenders.length, 0, 'no public website page renders the legacy brand');
  if (offenders.length) console.log('  offenders:\n   ' + offenders.map((p) => path.relative(ROOT, p)).join('\n   '));
  A.ok(files.length > 10, 'the website scan actually found the public pages');
}

/* ---------- 9. sidecar/*.js: no RENDERED legacy text (the SHIPPED backend) ----------
   §2 only ever scanned frontend/app/. But the sidecar is the process that actually ships inside the
   desktop bundle and serves the API, and it renders several user-visible strings of its own — the
   ACP permission prompt a human approves, diagnostics/console copy, tool descriptions. Those were
   left carrying the legacy brand by the Phase-2 rebrand (which never reached sidecar/ at all), so
   the same rule must cover it. The only permitted uses are the 9 IDENTIFIERS below, none of which is
   a product name:
     · '----StarNetFormBoundary' / '----StarNetSTT' / '----StarNetPart'  multipart form boundaries
                                                                         (wire constants)
     · 'StarNet-Skill-Exchange/1'    the skill-exchange User-Agent
     · 'StarNet skill package\0v1\0' the skill-package magic header (renaming it breaks packages)
     · 'StarNet'                     legacy app-data / model-cache DIRECTORY names (read in place)
   A bare 'StarNet' is permitted only because it is a directory name; any OTHER string carrying the
   brand — a sentence, a label, a prompt — is an offender. */
{
  const dir = path.join(ROOT, 'sidecar');
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); }
      else if (e.name.endsWith('.js')) files.push(p);
    }
  })(dir);
  const IDENT = [
    /^-{2,}StarNet/,              // multipart form boundaries
    /^StarNet-Skill-Exchange\//,  // skill-exchange User-Agent
    /^StarNet skill package/,     // skill-package magic header
    /^StarNet$/,                  // legacy app-data / model-cache directory names
  ];
  const offenders = [];
  for (const p of files) {
    for (const s of extractStrings(fs.readFileSync(p, 'utf8'))) {
      if (!LEGACY.test(s.text)) continue;
      if (allowedContent(s.text)) continue;
      if (IDENT.some((re) => re.test(s.text))) continue;
      offenders.push(path.relative(ROOT, p) + ':' + s.line + '  ' + s.raw.slice(0, 80));
    }
  }
  A.eq(offenders.length, 0, 'no sidecar module renders the legacy brand as visible text');
  if (offenders.length) console.log('  offenders:\n   ' + offenders.join('\n   '));
  A.ok(files.length > 200, 'the sidecar scan actually found the modules');
}

/* ---------- 10. scripts/**: the only legacy brand left is IDENTIFIERS ----------
   scripts/ is the release/QA toolchain. Its user-visible prose was rebranded, but a handful of
   strings MUST keep the legacy word because they name things that live OUTSIDE this repo or were
   created by an older release — renaming them would break a lookup or orphan an OS-registered
   object. Each permitted shape:
     · HKCU:\…\Uninstall\StarNet / HKCU:\Software\Andrew Sims\StarNet
         the uninstall registry keys a PRE-REBRAND release wrote; ci/windows-published-upgrade-proof.ps1
         replays that historical field failure, so it must read the OLD keys.
     · StarNet_*_x64-setup.exe   the historical published installer asset name (same replay).
     · non-proof StarNet state / owned StarNet process / StarNet registry record
         that proof's messages, which describe the historical StarNet install it is removing.
     · StarNet-QA-*  and  StarNet QA …
         Windows scheduled-task names + their labels (scripts/qa/register-watch.ps1). A task NAME is a
         registry identity: renaming it orphans the operator's existing registration.
     · 'StarNet'   a legacy app-data / install-root path component (purge-leaked-codex-tokens.mjs).
     · .local/share/StarNet/workspaces   the pre-rebrand macOS app-data dir, read in place.
   Any OTHER string in scripts/ carrying the brand — a label, a header, a sentence — is an offender. */
{
  const dir = path.join(ROOT, 'scripts');
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); }
      else if (/\.(js|mjs|cjs|ps1|sh)$/.test(e.name)) files.push(p);
    }
  })(dir);
  const IDENT = [
    /^HKCU:.*\\StarNet$/,              // historical install registry keys
    /^StarNet_\*_x64-setup\.exe$/,     // historical published installer asset
    /non-proof StarNet state/,         // the replay proof's own messages
    /owned StarNet process/,
    /StarNet registry record/,
    /^StarNet-QA-/,                    // OS-registered scheduled-task names
    /^StarNet QA/,
    /pointing at the StarNet repo/,
    /^StarNet$/,                       // legacy install-root path component
    /\.local\/share\/StarNet\//,       // pre-rebrand macOS app-data dir
  ];
  const offenders = [];
  for (const p of files) {
    const src = fs.readFileSync(p, 'utf8');
    const strings = /\.(js|mjs|cjs)$/.test(p) ? extractStrings(src) : extractQuoted(src, { ps: p.endsWith('.ps1') });
    for (const s of strings) {
      if (!LEGACY.test(s.text)) continue;
      if (allowedContent(s.text)) continue;
      if (IDENT.some((re) => re.test(s.text))) continue;
      offenders.push(path.relative(ROOT, p) + ':' + s.line + '  ' + s.raw.slice(0, 80));
    }
  }
  A.eq(offenders.length, 0, 'no scripts/ module renders the legacy brand as visible text');
  if (offenders.length) console.log('  offenders:\n   ' + offenders.join('\n   '));
  A.ok(files.length > 100, 'the scripts scan actually found the toolchain');
}

/* ---------- 11. .github/**: the public project surface ----------
   The issue templates, the release titles, the DMG install guide and the release workflows are all
   user-visible, and NO other section scanned them — so the stale productName-derived references that
   were fixed in scripts/ survived here, each a real break:
     · release.yml still named the installer `StarNet_<v>_x64-setup.exe`, but the bundler emits
       `SpaceStation_<v>_x64-setup.exe` and the upload step has if-no-files-found: error.
     · two hosted proofs located the installed app with `-match 'StarNet'`, but the install dir is
       <LOCALAPPDATA>\<productName> = SpaceStation.
   The only permitted legacy brand is an IDENTIFIER: the androoAGI/starnet* repos/URLs, lowercase
   starnet-prefixed filenames and starnet-dotted receipt schema ids (all lowercase — they do not
   match the case-sensitive LEGACY regex anyway), and the STARNET_* env prefix. Anything mixed-case is
   an offender. */
{
  const dir = path.join(ROOT, '.github');
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.ya?ml$/.test(e.name)) files.push(p);
    }
  })(dir);
  const ALLOW = [
    /STARNET_|__STARNET|SKYNET_/,   // env prefixes (identifiers)
    /StarNet-Token|starnet-token/,  // the auth header
  ];
  const offenders = [];
  for (const p of files) {
    fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach((line, i) => {
      if (!LEGACY.test(line)) return;
      if (ALLOW.some((re) => re.test(line))) return;
      offenders.push(path.relative(ROOT, p) + ':' + (i + 1) + '  ' + line.trim().slice(0, 80));
    });
  }
  A.eq(offenders.length, 0, 'no .github surface renders the legacy brand');
  if (offenders.length) console.log('  offenders:\n   ' + offenders.join('\n   '));
  A.ok(files.length >= 10, 'the .github scan actually found the workflows + issue templates');

  // Drift lock: the release workflows name the installer explicitly (YAML cannot call the JS helper
  // that owns the name), so its product-name prefix must equal tauri.conf.json's productName — a
  // future rename has to revisit it, exactly like release-installer-selection.test.mjs.
  const productName = JSON.parse(read('src-tauri/tauri.conf.json')).productName;
  const drift = [];
  for (const p of files) {
    for (const m of fs.readFileSync(p, 'utf8').matchAll(/["'\s/]([A-Za-z][A-Za-z0-9]*_[^\n]*?x64-setup\.exe)/g)) {
      if (!m[1].startsWith(productName + '_')) drift.push(path.relative(ROOT, p) + ': ' + m[1].slice(0, 50));
    }
  }
  A.eq(drift.length, 0, 'every installer filename in .github/ is prefixed with the product name');
  if (drift.length) console.log('  drift:\n   ' + drift.join('\n   '));
}

A.report('brand-identity');
