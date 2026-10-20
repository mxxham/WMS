/** The one-time welcome: shown once per browser, never over a floor screen (scanner, checker, print). */
import { strict as assert } from 'node:assert';
import { isFloorScreen, shouldShowWelcome } from '../lib/welcome';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
console.log('\nWelcome screen');

const normal = { enabled: true, seen: false as boolean | null, path: '/dashboard', search: '' };

test('first visit to a normal page: shown', () => {
  assert.equal(shouldShowWelcome(normal), true);
  assert.equal(shouldShowWelcome({ ...normal, path: '/waves', search: '?date=2026-10-12' }), true);
  assert.equal(shouldShowWelcome({ ...normal, path: '/inventory' }), true);
});
test('already seen: never again', () => {
  assert.equal(shouldShowWelcome({ ...normal, seen: true }), false);
});
test('storage unavailable (seen = null): not shown', () => {
  assert.equal(shouldShowWelcome({ ...normal, seen: null }), false);
});
test('switched off in config: not shown', () => {
  assert.equal(shouldShowWelcome({ ...normal, enabled: false }), false);
});
test('floor screens are never covered', () => {
  for (const path of ['/scan', '/audit', '/audit/picking', '/audit/picking/w1/SH1', '/audit/putaway/rak/CA', '/counts', '/counts/abc', '/bin/CA01C01', '/labels']) {
    assert.equal(isFloorScreen(path, ''), true, path);
    assert.equal(shouldShowWelcome({ ...normal, path }), false, path);
  }
});
test('the Wave picking screen is a floor screen, the Wave page itself is not', () => {
  assert.equal(isFloorScreen('/waves', '?date=2026-10-12&wave=x&pick=1'), true);
  assert.equal(isFloorScreen('/waves', '?date=2026-10-12&wave=x'), false);
});
test('a path that only starts with the same letters is not a floor screen', () => {
  assert.equal(isFloorScreen('/scanner-help', ''), false);
  assert.equal(isFloorScreen('/binders', ''), false);
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
