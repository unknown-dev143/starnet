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

A.report('brand-identity');
