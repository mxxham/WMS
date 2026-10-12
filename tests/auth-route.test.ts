/** Who goes where (spec §1 and the LOGIN_REQUIRED revision): login required or not, never off-site. */
import { strict as assert } from 'node:assert';
import { authRoute, safeNext } from '../lib/auth-route';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
console.log('\nSign-in redirects');

const to = (path: string, search: string, signedIn: boolean, required = true) => {
  const r = authRoute(path, search, signedIn, required);
  return r.kind === 'redirect' ? r.to : r.kind === 'shared' ? 'SHARED' : null;
};
test('required, signed out on an app page: to /login, remembering the page and its query', () => {
  assert.equal(to('/waves', '?date=2026-10-12&wave=x', false), '/login?next=%2Fwaves%3Fdate%3D2026-10-12%26wave%3Dx');
  assert.equal(to('/', '', false), '/login');
});
test('required, signed out on /login or /keluar: stay', () => {
  assert.equal(to('/login', '', false), null);
  assert.equal(to('/login', '?next=%2Fscan', false), null);
  assert.equal(to('/keluar', '', false), null);
});
test('required, signed in on /login: back to next, or home', () => {
  assert.equal(to('/login', '?next=%2Fscan', true), '/scan');
  assert.equal(to('/login', '', true), '/');
});
test('required, signed in elsewhere: continue', () => {
  assert.equal(to('/dashboard', '', true), null);
  assert.equal(to('/keluar', '', true), null);
});
test('not required (today): signed out on an app page gets the shared account, as before', () => {
  assert.equal(to('/waves', '?date=2026-10-12', false, false), 'SHARED');
  assert.equal(to('/', '', false, false), 'SHARED');
});
test('not required: /login works for optional sign-in, signed in (as the shared account) or not', () => {
  assert.equal(to('/login', '', true, false), null);
  assert.equal(to('/login', '?next=%2Fscan', true, false), null);
  assert.equal(to('/login', '', false, false), null);
  assert.equal(to('/keluar', '', true, false), null);
  assert.equal(to('/dashboard', '', true, false), null);
});
test('next never leaves the site', () => {
  for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', 'evil.com', '', null, '/login', '/%2F%2Fevil.com']) assert.equal(safeNext(bad), '/', String(bad));
  assert.equal(safeNext('/waves?date=2026-10-12'), '/waves?date=2026-10-12');
});
test('browsers drop tabs and newlines, so /<tab>/evil.com would become //evil.com: refused', () => {
  for (const bad of ['/\t/evil.com', '/%09/evil.com', '/\n/evil.com', '/%0A/evil.com', '/\r/evil.com', '/ /evil.com', '/%2F/evil.com'])
    assert.equal(safeNext(bad), '/', JSON.stringify(bad));
  assert.equal(to('/login', '?next=%2F%09%2Fevil.com', true), '/');
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
