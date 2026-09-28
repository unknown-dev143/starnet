import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NSIS_PRODUCT_NAME,
  nsisInstallerName,
  currentTauriVersion,
  findCurrentNsisInstaller,
  findVersionedNsisInstaller,
} from '../scripts/lib/release-installer.mjs';

/* The Tauri bundler names the NSIS artifact "<productName>_<version>_<arch>-setup.exe", and
   productName is the PACKAGED identity in src-tauri/tauri.conf.json. When the product was rebranded
   (commit 7b1d2f154, productName "StarNet" -> "SpaceStation") every produced installer was renamed,
   but the finder kept looking for "StarNet_…" — so the release cutter and the t0/t1/t3/t4/t5 gates
   silently stopped finding the artifact the build actually writes, while THIS test stayed green
   because its fixtures were named "StarNet_…" too. The fix (a single NSIS_PRODUCT_NAME constant)
   only holds if something asserts it still tracks tauri.conf.json — that is the point of this suite. */
const realConf = JSON.parse(
  readFileSync(fileURLToPath(new URL('../src-tauri/tauri.conf.json', import.meta.url)), 'utf8'));
const productName = String(realConf.productName || '');

assert.equal(NSIS_PRODUCT_NAME, productName,
  'the installer-name prefix must equal tauri.conf.json productName (rename one -> rename the other)');

const name = (v) => productName + '_' + v + '_x64-setup.exe';

const root = mkdtempSync(join(tmpdir(), 'starnet-release-installer-'));
try {
  const nsis = join(root, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
  mkdirSync(nsis, { recursive: true });
  mkdirSync(join(root, 'src-tauri'), { recursive: true });
  writeFileSync(join(root, 'src-tauri', 'tauri.conf.json'), JSON.stringify({ version: '0.10.5' }));

  const stale = join(nsis, name('0.8.0'));
  const exact = join(nsis, name('0.10.5'));
  writeFileSync(stale, 'stale');
  writeFileSync(exact, 'exact');

  assert.equal(findVersionedNsisInstaller(nsis, '0.10.5'), exact,
    'the exact current version wins even when a stale filename sorts later');
  assert.equal(findVersionedNsisInstaller(nsis, '0.10.6'), '',
    'a missing exact version fails closed instead of falling back');
  assert.equal(findVersionedNsisInstaller(nsis, '../0.10.5'), '',
    'version input cannot escape the NSIS directory');
  assert.equal(currentTauriVersion(root), '0.10.5', 'the helper reads the canonical Tauri version pin');
  assert.equal(findCurrentNsisInstaller(root), exact, 'the release gates bind discovery to the canonical current version');
  assert.equal(nsisInstallerName('1.2.3'), name('1.2.3'),
    'the shared name builder matches the productName-prefixed pattern the bundler emits');

  // The legacy "StarNet_…" name must NOT be discovered any more: a stale installer left over from a
  // pre-rebrand build would otherwise be picked up and published under the new product.
  const legacy = join(nsis, 'StarNet_0.10.5_x64-setup.exe');
  writeFileSync(legacy, 'legacy');
  assert.equal(findVersionedNsisInstaller(nsis, '0.10.5'), exact,
    'a leftover legacy-branded installer is never selected for the rebranded product');
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('release-installer-selection.test: OK (7 assertions)');
