/** Usernames (spec §1): what people type, how it is checked, the hidden auth email of new accounts. */
import { strict as assert } from 'node:assert';
import { internalEmail, normalizeUsername, usernameError } from '../lib/username';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
console.log('\nUsernames');

test('typed with spaces or capitals: the same account', () => {
  assert.equal(normalizeUsername('  Ilham '), 'ilham');
  assert.equal(normalizeUsername('Budi.Santoso'), 'budi.santoso');
});
test('valid usernames pass', () => {
  for (const u of ['ilham', 'budi.s', 'op_01', 'a-b', 'abc', 'x'.repeat(32)]) assert.equal(usernameError(u), null, u);
});
test('invalid usernames say why, in Indonesian', () => {
  assert.match(usernameError('ab') ?? '', /3/);
  assert.match(usernameError('x'.repeat(33)) ?? '', /32/);
  assert.match(usernameError('ilham saputra') ?? '', /huruf kecil/);
  assert.match(usernameError('ilham@x') ?? '', /huruf kecil/);
  assert.match(usernameError('Ilham') ?? '', /huruf kecil/);
});
test('new accounts get a hidden internal email', () => {
  assert.equal(internalEmail('ilham'), 'ilham@pengguna.internal');
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
