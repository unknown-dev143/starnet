'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const tauri = JSON.parse(read('src-tauri/tauri.conf.json'));
const infoPlist = read('src-tauri/Info.plist');
const stage = read('scripts/stage-voice-deps.mjs');
const buildRs = read('src-tauri/build.rs');
const desktopCi = read('.github/workflows/desktop-build.yml');
const releaseCi = read('.github/workflows/release-train.yml');
const canary = read('scripts/update-canary.mjs');
const phase5Surface = read('scripts/phase5-surface-proof.mjs');

assert.equal(
  pkg.dependencies['ogg-opus-decoder'],
  '^1.7.3',
  'the packaged sidecar carries an in-process Telegram Ogg/Opus decoder'
);
// Sharp's CVE floor is 0.35.4 (libheif GHSA-g89c-p67h-r497 / GHSA-2jg2-4ch7-h545, advisory range `<0.35.4`).
// The guard's intent is "cannot restore a vulnerable Sharp", so it enforces the FLOOR, not a frozen patch:
// a future 0.35.x bump that stays >= 0.35.4 is allowed, and a regression below it still goes RED by name.
const SHARP_CVE_FLOOR = [0, 35, 4];
const cmpVer = (a, b) => {
  const pa = String(a).split('.').map(Number), pb = b.map(Number);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0); }
  return 0;
};
const sharpOverride = pkg.overrides && pkg.overrides.sharp;
assert.ok(sharpOverride && cmpVer(sharpOverride, SHARP_CVE_FLOOR) >= 0,
  'both Transformers copies are forced onto a patched Sharp runtime (>= 0.35.4); got ' + sharpOverride);
const lockedSharp = Object.entries(lock.packages || {})
  .filter(([name]) => /(?:^|\/)node_modules\/sharp$/.test(name))
  .map(([, meta]) => meta && meta.version);
assert.ok(lockedSharp.length > 0 && lockedSharp.every(version => cmpVer(version, SHARP_CVE_FLOOR) >= 0),
  'the lockfile cannot restore a vulnerable Sharp below 0.35.4 — got ' + JSON.stringify(lockedSharp));

// adm-zip: every adm-zip CVE is fixed in 0.6.1 (advisory range `<=0.6.0`), and the override is what stops
// onnxruntime-node's `^0.5.16` spec resolving back below the fix. Assert the FLOOR for the same reason.
const ADM_ZIP_CVE_FLOOR = [0, 6, 1];
const admZipOverride = pkg.overrides && pkg.overrides['adm-zip'];
assert.ok(admZipOverride && cmpVer(admZipOverride, ADM_ZIP_CVE_FLOOR) >= 0,
  'the build-only ZIP parser is forced onto a patched adm-zip (>= 0.6.1); got ' + admZipOverride);
const lockedAdmZip = Object.entries(lock.packages || {})
  .filter(([name]) => /(?:^|\/)node_modules\/adm-zip$/.test(name))
  .map(([, meta]) => meta && meta.version);
assert.ok(lockedAdmZip.length > 0 && lockedAdmZip.every(version => cmpVer(version, ADM_ZIP_CVE_FLOOR) >= 0),
  'the lockfile cannot restore a vulnerable adm-zip below 0.6.1 — got ' + JSON.stringify(lockedAdmZip));

assert.match(
  pkg.scripts['desktop:build'],
  /prepare-node\.mjs[\s\S]*stage-voice-deps\.mjs[\s\S]*tauri build/,
  'a local desktop build stages the voice runtime before Tauri packages resources'
);
assert.equal(
  tauri.bundle.resources['voice-deps/node_modules'],
  'node_modules',
  'the staged runtime lands beside sidecar/ so ordinary Node resolution finds it'
);
assert.match(buildRs, /"voice-deps\/node_modules"/, 'Cargo treats the staged voice runtime as a shipped build input');

// WKWebView getUserMedia reaches the macOS microphone privacy boundary. Tauri merges
// src-tauri/Info.plist into the generated application bundle, and macOS refuses capture
// when this purpose string is absent. Keep the permission declaration coupled to the
// offline voice runtime so a packaged Mac build cannot silently ship a dead microphone.
assert.match(
  infoPlist,
  /<key>NSMicrophoneUsageDescription<\/key>\s*<string>[^<]*(?:microphone|voice)[^<]*<\/string>/i,
  'the macOS app bundle declares why StarNet requests microphone access'
);

for (const [name, source] of [['desktop CI', desktopCi], ['release CI', releaseCi]]) {
  assert.match(
    source,
    /prepare-node\.mjs \$\{\{ matrix\.target \}\}[\s\S]{0,160}stage-voice-deps\.mjs --target \$\{\{ matrix\.target \}\}/,
    name + ' stages the matching platform/architecture voice runtime'
  );
}
assert.match(canary, /stage-voice-deps\.mjs'\), '--target', 'win-x64'/, 'canary installers ship the same Windows voice engine');
assert.match(
  phase5Surface,
  /prepare-node\.mjs'[\s\S]*stage-voice-deps\.mjs --target win-x64'[\s\S]*tauri\) \+ ' build'/,
  'the Windows desktop evidence runner stages the native voice closure before its direct Tauri build'
);

assert.match(stage, /\^\(win\|darwin\|linux\)-\(x64\|arm64\)\$/, 'the staging script validates release target names');
assert.match(stage, /pruneOnnxBinaries\(dest\)/, 'foreign ONNX native binaries are removed from the staged closure');
assert.match(stage, /if \(!pruned\.kept\.length\)/, 'the build fails closed when no target ONNX runtime survives');
assert.match(stage, /for \(const dep of runtimeDeps\)/, 'every declared production dependency must exist in the staged tree');
assert.match(stage, /DROP_ANYWHERE = new Set\(\['onnxruntime-web', 'adm-zip'\]\)/, 'browser ONNX and the build-only ZIP downloader are not shipped in the Node sidecar bundle');
assert.match(stage, /build-only adm-zip leaked into the shipped runtime closure/, 'the build fails closed if the vulnerable postinstall-only ZIP package survives staging');
assert.match(stage, /function purgeStaleReleasePackages\(\)/, 'warm Tauri outputs are purged so removed packages cannot survive in a later installer');
assert.match(stage, /OUT === resolve\(join\(ROOT, 'src-tauri', 'voice-deps'\)\)/, 'stale-output purging is limited to the real desktop staging path');

console.log('desktop voice bundle tests passed');
