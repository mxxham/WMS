/** Tambah pengguna (spec §3): what the form refuses before anything reaches Supabase. */
import { strict as assert } from 'node:assert';
import { newUserError } from '../lib/username';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
console.log('\nNew accounts');
const ok = { name: 'Ani Lestari', username: 'ani', password: 'rahasia123', role: 'operator' };

test('a complete form passes', () => { assert.equal(newUserError(ok), null); });
test('name of at least 2 characters', () => { assert.match(newUserError({ ...ok, name: ' A ' }) ?? '', /Nama/); });
test('username rules apply', () => { assert.match(newUserError({ ...ok, username: 'a b' }) ?? '', /huruf kecil/); });
test('password at least 8 characters', () => { assert.match(newUserError({ ...ok, password: '1234567' }) ?? '', /8/); });
test('role is one of the three', () => { assert.match(newUserError({ ...ok, role: 'owner' }) ?? '', /Peran/); });

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
