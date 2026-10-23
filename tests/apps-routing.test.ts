/** App routing resolver and normalisation tests. */
import { strict as assert } from 'node:assert';
import { normalizeApps, appsHome, resolveAppsHome, APP_IDS } from '../lib/apps';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

console.log('\nApps routing');

test('normalizeApps: empty array', () => {
  assert.deepEqual(normalizeApps([]), []);
});

test('normalizeApps: single valid app', () => {
  assert.deepEqual(normalizeApps(['shell_wms']), ['shell_wms']);
  assert.deepEqual(normalizeApps(['ckb_3pl']), ['ckb_3pl']);
});

test('normalizeApps: both valid apps', () => {
  assert.deepEqual(normalizeApps(['shell_wms', 'ckb_3pl']), ['shell_wms', 'ckb_3pl']);
  assert.deepEqual(normalizeApps(['ckb_3pl', 'shell_wms']), ['ckb_3pl', 'shell_wms']);
});

test('normalizeApps: dedupes', () => {
  assert.deepEqual(normalizeApps(['shell_wms', 'shell_wms']), ['shell_wms']);
  assert.deepEqual(normalizeApps(['shell_wms', 'ckb_3pl', 'shell_wms']), ['shell_wms', 'ckb_3pl']);
});

test('normalizeApps: drops unknown ids', () => {
  assert.deepEqual(normalizeApps(['shell_wms', 'unknown']), ['shell_wms']);
  assert.deepEqual(normalizeApps(['bad', 'ckb_3pl', 'worse']), ['ckb_3pl']);
});

test('normalizeApps: trims and lowercases', () => {
  assert.deepEqual(normalizeApps(['  SHELL_WMS  ']), ['shell_wms']);
  assert.deepEqual(normalizeApps(['Ckb_3pl']), ['ckb_3pl']);
});

test('normalizeApps: non-array returns empty', () => {
  assert.deepEqual(normalizeApps(null), []);
  assert.deepEqual(normalizeApps('shell_wms'), []);
  assert.deepEqual(normalizeApps(123), []);
});

test('appsHome: shell_wms -> /', () => {
  assert.equal(appsHome('shell_wms'), '/');
});

test('appsHome: ckb_3pl -> /ckb', () => {
  assert.equal(appsHome('ckb_3pl'), '/ckb');
});

test('resolveAppsHome: empty apps -> /akses', () => {
  assert.equal(resolveAppsHome([], null), '/akses');
  assert.equal(resolveAppsHome([], 'shell_wms'), '/akses');
});

test('resolveAppsHome: single app shell_wms -> /', () => {
  assert.equal(resolveAppsHome(['shell_wms'], null), '/');
  assert.equal(resolveAppsHome(['shell_wms'], 'shell_wms'), '/');
  assert.equal(resolveAppsHome(['shell_wms'], 'ckb_3pl'), '/'); // stale default ignored
});

test('resolveAppsHome: single app ckb_3pl -> /ckb', () => {
  assert.equal(resolveAppsHome(['ckb_3pl'], null), '/ckb');
  assert.equal(resolveAppsHome(['ckb_3pl'], 'ckb_3pl'), '/ckb');
  assert.equal(resolveAppsHome(['ckb_3pl'], 'shell_wms'), '/ckb'); // stale default ignored
});

test('resolveAppsHome: both apps, valid default shell_wms -> /', () => {
  assert.equal(resolveAppsHome(['shell_wms', 'ckb_3pl'], 'shell_wms'), '/');
});

test('resolveAppsHome: both apps, valid default ckb_3pl -> /ckb', () => {
  assert.equal(resolveAppsHome(['shell_wms', 'ckb_3pl'], 'ckb_3pl'), '/ckb');
});

test('resolveAppsHome: both apps, stale default -> / (fallback)', () => {
  assert.equal(resolveAppsHome(['shell_wms', 'ckb_3pl'], 'unknown'), '/');
  assert.equal(resolveAppsHome(['shell_wms', 'ckb_3pl'], null), '/');
});

test('resolveAppsHome: both apps, missing default -> / (fallback)', () => {
  assert.equal(resolveAppsHome(['shell_wms', 'ckb_3pl'], ''), '/');
});

test('resolveAppsHome: more than two apps (deduped) follows same rules', () => {
  // Should not happen with the type, but function handles it
  assert.equal(resolveAppsHome(['shell_wms', 'ckb_3pl', 'shell_wms'], 'shell_wms'), '/');
  assert.equal(resolveAppsHome(['shell_wms', 'ckb_3pl', 'shell_wms'], 'ckb_3pl'), '/ckb');
  assert.equal(resolveAppsHome(['shell_wms', 'ckb_3pl', 'shell_wms'], null), '/');
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);