/** Who goes where (spec §1): signed out -> /login?next=, signed in on /login -> back, never off-site. */
import { strict as assert } from 'node:assert';
import { authRedirect, safeNext } from '../lib/auth-route';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
console.log('\nSign-in redirects');

test('signed out on an app page: to /login, remembering the page and its query', () => {
  assert.equal(authRedirect('/waves', '?date=2026-10-12&wave=x', false), '/login?next=%2Fwaves%3Fdate%3D2026-10-12%26wave%3Dx');
  assert.equal(authRedirect('/', '', false), '/login');
});
test('signed out on /login or /keluar: stay', () => {
  assert.equal(authRedirect('/login', '', false), null);
  assert.equal(authRedirect('/login', '?next=%2Fscan', false), null);
  assert.equal(authRedirect('/keluar', '', false), null);
});
test('signed in on /login: back to next, or home', () => {
  assert.equal(authRedirect('/login', '?next=%2Fscan', true), '/scan');
  assert.equal(authRedirect('/login', '', true), '/');
});
test('signed in elsewhere: continue', () => {
  assert.equal(authRedirect('/dashboard', '', true), null);
  assert.equal(authRedirect('/keluar', '', true), null);
});
test('next never leaves the site', () => {
  for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', 'evil.com', '', null, '/login', '/%2F%2Fevil.com']) assert.equal(safeNext(bad), '/', String(bad));
  assert.equal(safeNext('/waves?date=2026-10-12'), '/waves?date=2026-10-12');
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
