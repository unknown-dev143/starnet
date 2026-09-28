import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/* The Tauri bundler names every NSIS artifact "<productName>_<version>_<arch>-setup.exe", where
   productName is the PACKAGED identity from src-tauri/tauri.conf.json (proven by
   scripts/update-canary.mjs, which sets productName "SpaceStation Canary" and then stages
   "SpaceStation Canary_<v>_*-setup.exe"). The rebrand changed productName "StarNet" ->
   "SpaceStation" (commit 7b1d2f154), which renamed every produced installer — but this finder kept
   looking for the old "StarNet_…" name, so the release cutter and the t0/t1/t3/t4/t5 gates could no
   longer discover the artifact the current build actually writes. This constant is the ONE place the
   prefix lives; test/release-installer-selection.test.mjs asserts it still equals tauri.conf.json's
   productName so the two can never silently drift apart again. */
export const NSIS_PRODUCT_NAME = 'SpaceStation';

export function nsisInstallerName(version) {
  return NSIS_PRODUCT_NAME + '_' + String(version || '').trim() + '_x64-setup.exe';
}

export function findVersionedNsisInstaller(nsisDir, version) {
  const v = String(version || '').trim();
  if (!/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(v)) return '';
  const expected = join(nsisDir, nsisInstallerName(v));
  try {
    return statSync(expected).isFile() ? expected : '';
  } catch (_) {
    return '';
  }
}

export function currentTauriVersion(root) {
  try {
    const conf = JSON.parse(readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8').replace(/^\uFEFF/, ''));
    return String((conf && conf.version) || '').trim();
  } catch (_) {
    return '';
  }
}

export function findCurrentNsisInstaller(root) {
  const version = currentTauriVersion(root);
  const nsisDir = join(root, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
  return findVersionedNsisInstaller(nsisDir, version);
}
