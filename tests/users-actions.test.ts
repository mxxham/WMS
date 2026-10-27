/** Tambah pengguna (spec §3): what the form refuses before anything reaches Supabase. */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { newUserError } from '../lib/username';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
console.log('\nNew accounts');
const ok = { name: 'Ani Lestari', username: 'ani', password: 'rahasia123', job: 'operator' };

test('a complete form passes', () => { assert.equal(newUserError(ok), null); });
test('name of at least 2 characters', () => { assert.match(newUserError({ ...ok, name: ' A ' }) ?? '', /Nama/); });
test('username rules apply', () => { assert.match(newUserError({ ...ok, username: 'a b' }) ?? '', /huruf kecil/); });
test('password at least 8 characters', () => { assert.match(newUserError({ ...ok, password: '1234567' }) ?? '', /8/); });
test('job is one of the seven', () => {
  assert.match(newUserError({ ...ok, job: 'owner' }) ?? '', /Peran/);
  assert.equal(newUserError({ ...ok, job: 'checker' }), null);
});
test('the old level name supervisor is not a job', () => { assert.equal(newUserError({ ...ok, job: 'supervisor' }), 'Peran tidak dikenal.'); });

console.log('\nActions');
const src = readFileSync('app/(app)/admin/users/actions.ts', 'utf8');
test('actions call set_user_job and no longer set_user_role', () => {
  assert.match(src, /rpc\("set_user_job"/);
  assert.doesNotMatch(src, /set_user_role/);
  assert.match(src, /export async function setJob\(/);
  assert.doesNotMatch(src, /export async function setRole\(/);
});
test('setJob keeps the admin and shared-account guards', () => {
  const body = src.slice(src.indexOf('export async function setJob'), src.indexOf('export async function setActive'));
  assert.match(body, /await admin\(\)/);
  assert.match(body, /sharedGuard\(id\)/);
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
