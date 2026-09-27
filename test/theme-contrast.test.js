'use strict';

/* theme-contrast.test.js — THE CONTRAST FLOOR.
 *
 * Why this exists. `frontend/css/style.css` has carried this note on `.dim` since the opacity was
 * dropped from .5 to 1:
 *
 *     ".dim color comes from app.css var(--ph-dim) which is solid >=4.5:1"
 *
 * That is an ASSERTED INVARIANT, and nothing checked it. Measured against the real grounds, it was
 * false: `--ph-dim` reads 3.06:1 on purple's `--panel2` and 2.99:1 on red's — both below the WCAG AA
 * 1.4.3 floor of 4.5:1 for normal text, and red was below even the 3:1 non-text floor of 1.4.11.
 * Blue missed by a hairline (4.49). That matters because `--ph-dim` is not decoration: 600+ of its
 * declarations are `color:` — `.dim`, `.dimb`, `.crew-room`, `.h3-aux`, `.deliverable-row small`,
 * `.set-slider-name`, every console's `.xx-note`/`.xx-sub` — i.e. the label tier of every screen.
 *
 * This suite computes WCAG relative luminance exactly as `panel-brightness.test.js` does (the two
 * gates must agree on the maths) and holds every text-bearing theme token to 4.5:1 on EVERY ground a
 * token can be painted on, not just the page background. `--panel` is a translucent rgba, so it is
 * composited over `--bg` first — the glass, not the raw token, is what text actually sits on.
 *
 * It also locks the ACCESSIBILITY LAYER (frontend/css/a11y.css): the three media features the design
 * had no answer for at all before it existed, and the two promises that layer must not break —
 * grounds stay dark (see panel-brightness.test.js) and it loads LAST so its equal-specificity rules
 * can win.
 */

const fs = require('node:fs');
const path = require('node:path');
const A = require('./_assert.js');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const stripCss = s => s.replace(/\/\*[\s\S]*?\*\//g, '');

/* ============================== 1 · the WCAG maths (shared with panel-brightness.test.js) ====== */
const hex = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgba = s => {
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/.exec(s);
  return m ? { c: [+m[1], +m[2], +m[3]], a: m[4] === undefined ? 1 : +m[4] } : null;
};
const lum = c => {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const over = (fg, bg) => fg.c.map((v, i) => Math.round(v + (bg[i] - v) * fg.a));
const show = c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');

const AA = 4.5;          /* WCAG 1.4.3, normal text */
const NON_TEXT = 3.0;    /* WCAG 1.4.11, UI boundaries / graphical objects */

/* ============================== 2 · parse every shipped theme ================================= */
const style = stripCss(read('frontend/css/style.css'));

const THEMES = [];
for (const m of style.matchAll(/body\.theme-([a-z]+)\s*\{([^}]*)\}/g)) {
  const [, name, body] = m;
  const hx = tok => { const r = new RegExp('--' + tok + ':\\s*(#[0-9a-fA-F]{6})').exec(body); return r ? hex(r[1]) : null; };
  const panel = /--panel:\s*(rgba\([^)]*\))/.exec(body);
  const t = {
    name,
    bg: hx('bg'), panel2: hx('panel2'),
    ph: hx('ph'), bright: hx('ph-bright'), dim: hx('ph-dim'), text: hx('text'), warn: hx('warn'),
  };
  /* --panel is rgba() over --bg: composite it, because that composite is the real ground. */
  t.panel = panel && t.bg ? over(rgba(panel[1]), t.bg) : null;
  THEMES.push(t);
}

A.ok(THEMES.length >= 6, 'style.css still declares the six stock phosphor themes (got ' + THEMES.length + ')');

/* the semantic status colours live once, on :root, and never re-tint per theme (see the note there) */
const rootBlock = /(?:^|\n):root\s*\{([^}]*)\}/.exec(style);
A.ok(rootBlock, 'style.css still carries the :root token block');
const rootTok = tok => {
  const r = new RegExp('--' + tok + ':\\s*(#[0-9a-fA-F]{6})').exec(rootBlock ? rootBlock[1] : '');
  return r ? hex(r[1]) : null;
};
const OK_COLOUR = rootTok('ok'), BAD_COLOUR = rootTok('bad'), LINK_DOWN = rootTok('link-down');
A.ok(OK_COLOUR && BAD_COLOUR, ':root declares the semantic --ok and --bad');

/* ============================== 3 · the floors ================================================ */
/* Every token that paints TEXT, held to 1.4.3 on every ground it can sit on. */
const TEXT_TOKENS = ['ph', 'text', 'dim', 'bright', 'warn'];

let worst = { r: Infinity };
for (const t of THEMES) {
  A.ok(t.bg && t.panel && t.panel2 && t.ph && t.bright && t.dim && t.text && t.warn,
    'theme ' + t.name + ' declares every token this gate measures (bg/panel/panel2/ph/ph-bright/ph-dim/text/warn)');
  if (!t.panel) continue;

  const grounds = [['--bg', t.bg], ['--panel', t.panel], ['--panel2', t.panel2]];
  for (const tok of TEXT_TOKENS) {
    const c = t[tok];
    if (!c) continue;
    for (const [gn, g] of grounds) {
      const r = ratio(c, g);
      if (r < worst.r) worst = { r, theme: t.name, tok, ground: gn };
      A.ok(r >= AA,
        t.name + ' --' + tok + ' on ' + gn + ' must clear WCAG AA 1.4.3 (' + AA + ':1) for normal text — got '
        + r.toFixed(2) + ':1 (' + show(c) + ' on ' + show(g) + ')');
    }
  }

  /* the status colours are constant, but they are TEXT on a themed ground — so still measured */
  for (const [label, c] of [['--ok', OK_COLOUR], ['--bad', BAD_COLOUR], ['--link-down', LINK_DOWN]]) {
    if (!c) continue;
    for (const [gn, g] of grounds) {
      const r = ratio(c, g);
      A.ok(r >= AA, t.name + ' ' + label + ' on ' + gn + ' must clear WCAG AA 1.4.3 — got ' + r.toFixed(2) + ':1');
    }
  }

  /* --ph-dim is ALSO the 1px border/dividers token; those only owe 1.4.11 (3:1), which is the
     weaker of the two floors, so clearing 4.5:1 above satisfies both roles at once. */
  for (const [gn, g] of grounds) {
    A.ok(ratio(t.dim, g) >= NON_TEXT,
      t.name + ' --ph-dim on ' + gn + ' must clear the non-text floor 1.4.11 (' + NON_TEXT + ':1) for 1px borders');
  }
}

/* Name the worst case in the output, so the margin is visible rather than implied. */
A.ok(worst.r >= AA, 'the worst measured text contrast across every theme/token/ground clears AA');
console.log('   worst text contrast: ' + worst.r.toFixed(2) + ':1  (' + worst.theme + ' --' + worst.tok
  + ' on ' + worst.ground + ')');

/* ---- the invariant the .dim comment claims, asserted directly so it can never drift again ---- */
const amber = THEMES.find(t => t.name === 'amber');
if (amber) {
  const r = ratio(amber.dim, amber.panel2);
  A.ok(r >= AA, 'the ".dim is solid >=4.5:1" claim in style.css holds on amber --panel2 — measured ' + r.toFixed(2) + ':1');
}

/* ============================== 4 · the accessibility layer ================================== */
const A11Y = 'frontend/css/a11y.css';
const a11yExists = fs.existsSync(path.join(root, A11Y));
A.ok(a11yExists, A11Y + ' exists — the design has an accessibility layer');
/* read defensively: a missing sheet must FAIL the assertions below, not crash the suite before
   report() runs — a test that throws prints no tally, and a silent crash reads as "no output". */
const a11y = stripCss(a11yExists ? read(A11Y) : '');

/* the three media features the shipped design answered nowhere before this file */
const FEATURES = [
  ['forced-colors: active', 'Windows High Contrast Mode — the UA drops every box-shadow/text-shadow '
    + 'and forces background-image to none, so the CRT chrome loses its frames'],
  ['prefers-contrast: more', 'the OS-level request for more contrast'],
  ['prefers-reduced-transparency: reduce', 'the panels, windows and scrims are translucent by design'],
];
for (const [feat, why] of FEATURES) {
  A.ok(new RegExp('@media\\s*\\(\\s*' + feat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\)').test(a11y),
    A11Y + ' handles `' + feat + '` (' + why + ')');
}

/* the forced-colors pass must give the floating-window frame a REAL border: .term's only boundary
   today is box-shadow: var(--bezel), which forced-colors forces to none — an open window would
   have no edge at all. */
A.ok(/\.term\b[^{]*\{[^}]*border/.test(a11y), 'the forced-colors pass gives .term a real border (its only frame is a box-shadow)');

/* colour-carried meaning must survive: the phosphor swatches ARE the six palettes. */
A.ok(/forced-color-adjust:\s*none/.test(a11y),
  'the forced-colors pass opts colour-carrying widgets out with forced-color-adjust:none');

/* PANEL-BRIGHTNESS PROMISE: the contrast pass may raise foreground tokens, never the grounds.
   --bg / --panel / --panel2 must not be lifted toward white by `prefers-contrast`. */
const contrastBlock = (() => {
  const i = a11y.indexOf('prefers-contrast');
  if (i < 0) return '';
  const open = a11y.indexOf('{', i);
  let depth = 0, j = open;
  for (; j < a11y.length; j++) { if (a11y[j] === '{') depth++; else if (a11y[j] === '}') { depth--; if (!depth) break; } }
  return a11y.slice(open, j + 1);
})();
A.ok(contrastBlock.length > 0, 'the prefers-contrast block is parseable');
for (const ground of ['--bg', '--panel', '--panel2']) {
  /* plain substring: `--panel:` cannot be satisfied by `--panel2:` because of the colon */
  A.ok(!contrastBlock.includes(ground + ':'),
    'prefers-contrast never reassigns ' + ground + ' — brighter text, never a brighter ground (panel-brightness.test.js)');
}

/* LOAD ORDER: equal specificity means the LAST sheet wins, so this one must be last. */
const html = read('frontend/index.html');
const sheets = [...html.matchAll(/<link rel="stylesheet" href="(css\/[^"]+)"/g)].map(m => m[1]);
A.ok(sheets.length >= 20, 'index.html links the full stylesheet stack (got ' + sheets.length + ')');
A.eq(sheets[sheets.length - 1], 'css/a11y.css',
  'a11y.css is the LAST stylesheet — at equal specificity only the last one wins');
A.ok(!/prefers-contrast|forced-colors/.test(sheets.filter(s => s !== 'css/a11y.css').map(s => read('frontend/' + s)).join('\n')),
  'the accessibility media queries live in exactly ONE sheet — a second copy would be dead weight the load order decides');

A.report('theme-contrast.test');
