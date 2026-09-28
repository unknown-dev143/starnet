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

/* Strip /* … *​/ block comments and // line comments. Same shape the hardening suite uses. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
/* Strip string literals too — the honesty notes legitimately NAME the legacy word while explaining
   that it survives only as a back-compat alias. */
function stripStrings(src) {
  return src.replace(/'(?:[^'\\\n]|\\.)*'/g, "''").replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
}

const LEGACY = /StarNet|STARNET/;

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

/* ---------- 2. frontend/app/*.js: no RENDERED legacy text ---------- */
{
  const files = fs.readdirSync(path.join(ROOT, 'frontend', 'app')).filter((f) => f.endsWith('.js'));
  const offenders = [];
  for (const f of files) {
    const raw = read(path.join('frontend', 'app', f));
    // Walk the source and inspect only STRING LITERALS, skipping comments first.
    const code = stripComments(raw);
    const strings = code.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g) || [];
    for (const s of strings) {
      // An ALLOWED use is a string that explicitly names the lineage as a back-compat alias —
      // those live in app.js's foundationClause, which is the product describing its own history.
      if (!LEGACY.test(s)) continue;
      if (/built on the earlier|back-compat|previously called|renamed/.test(s)) continue;
      // app.js's foundationClause is a MULTI-LINE concatenation that honestly names the lineage; the
      // allowlist above only sees one fragment at a time, so exempt the clause's own fragments by
      // their distinctive wording. This is the product truthfully describing its own history.
      if (/not a StarNet agent|earlier StarNet harness|Skynet/.test(s)) continue;
      // internal identifier strings (window globals, env prefixes, store keys) are not user text
      if (/__STARNET|STARNET_|SKYNET_|starnet[._-]/.test(s)) continue;
      // the AUTH HEADER is a live protocol constant: sidecar/apiauth.js reads 'x-starnet-token'.
      // Renaming it breaks every /api/* call. It is not a product name.
      if (/StarNet-Token|Skynet-Token|starnet-token|skynet-token/.test(s)) continue;
      // an HTTP header / store key written in the raw (not a message shown to a user)
      if (/^X-|^x-/.test(s)) continue;
      offenders.push(f + ': ' + s.slice(0, 80));
    }
  }
  A.eq(offenders.length, 0, 'no frontend module renders the legacy brand as visible text');
  if (offenders.length) console.log('  offenders:\n   ' + offenders.join('\n   '));
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
    const code = stripComments(fs.readFileSync(p, 'utf8'));
    const strings = code.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g) || [];
    for (const s of strings) {
      if (!LEGACY.test(s)) continue;
      // identical allowlist to §2 so the two rules stay in lockstep (one lock, one concern)
      if (/built on the earlier|back-compat|previously called|renamed/.test(s)) continue;
      if (/not a StarNet agent|earlier StarNet harness|Skynet/.test(s)) continue;
      if (/__STARNET|STARNET_|SKYNET_|starnet[._-]/.test(s)) continue;
      if (/StarNet-Token|Skynet-Token|starnet-token|skynet-token/.test(s)) continue;
      if (/^X-|^x-/.test(s)) continue;
      // the matched literal carries its quotes; test the IDENT patterns against the CONTENT
      const lit = s.slice(1, -1);
      if (IDENT.some((re) => re.test(lit))) continue;
      offenders.push(path.relative(ROOT, p) + ': ' + s.slice(0, 80));
    }
  }
  A.eq(offenders.length, 0, 'no sidecar module renders the legacy brand as visible text');
  if (offenders.length) console.log('  offenders:\n   ' + offenders.join('\n   '));
  A.ok(files.length > 200, 'the sidecar scan actually found the modules');
}

A.report('brand-identity');
