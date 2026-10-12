/** The sign-in wiring (spec §1): no automatic shared session, one redirect rule, server-only lookup. */
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
console.log('\nSign-in wiring');
const src = (f: string) => readFileSync(f, 'utf8');

test('the middleware follows authRoute, and signs in as the site account only for "shared" (login not required)', () => {
  const m = src('middleware.ts');
  assert.ok(m.includes('authRoute(') && m.includes('loginRequired()'), 'middleware does not use authRoute with the switch');
  const shared = m.indexOf('"shared"');
  assert.ok(shared > 0 && m.indexOf('signInWithPassword') > shared, 'the site-account sign-in is not limited to the shared case');
});
test('only the middleware reads the site account; .env.example documents the switch', () => {
  for (const f of ['lib/auth.ts', 'app/login/actions.ts', 'lib/auth-route.ts']) assert.ok(!src(f).includes('SITE_ACCOUNT'), f);
  const env = src('.env.example');
  assert.ok(env.includes('LOGIN_REQUIRED=') && env.includes('SITE_ACCOUNT_EMAIL='), '.env.example lacks the switch or the site account');
});
test('Keluar goes back to the shared account while login is not required', () => {
  assert.ok(src('app/keluar/route.ts').includes('loginRequired()'), '/keluar ignores the switch');
});
test('while login is not required, the account menu offers signing in as yourself', () => {
  const acc = src('components/app/account.tsx');
  assert.ok(acc.includes('Masuk sebagai akun lain') && acc.includes('href="/login"'), 'no way to sign in as yourself');
});
test('the username lookup runs on the server with the service role, one error message for every failure', () => {
  const a = src('app/login/actions.ts');
  assert.ok(a.startsWith('"use server"'), 'login action is not a server action');
  assert.ok(a.includes('createServiceClient') && a.includes('account_email'), 'lookup not via service role');
  assert.equal((a.match(/Nama pengguna atau kata sandi salah\./g) ?? []).length, 1, 'one shared message');
});
test('sign-out route and login page exist outside the app layout', () => {
  assert.ok(existsSync('app/keluar/route.ts') && existsSync('app/login/page.tsx'));
  assert.ok(!existsSync('app/(app)/login'), 'login must not get the app shell');
});
test('the app layout sends a missing or inactive session to /keluar', () => {
  assert.match(src('app/(app)/layout.tsx'), /redirect\("\/keluar\?nonaktif=1"\)/);
});

test('sign-in is limited per username on the server (Supabase\'s per-IP limit only sees the server)', () => {
  const a = src('app/login/actions.ts');
  assert.ok(a.includes('"login_allowed"') && a.includes('"login_result"'), 'login does not use the per-username limit');
  assert.ok(a.indexOf('"login_allowed"') < a.indexOf('signInWithPassword'), 'the limit is not checked before trying the password');
});
test('the signed-in account and Keluar show on desktop and phone', () => {
  assert.ok(src('components/app/nav.tsx').includes('<AccountBox'), 'sidebar has no AccountBox');
  assert.ok(src('components/app/page-header.tsx').includes('<AccountButton'), 'phone header has no AccountButton');
  const acc = src('components/app/account.tsx');
  assert.ok(acc.includes('action="/keluar"') && acc.includes('method="post"'), 'Keluar does not POST to /keluar');
});
test('Nama Anda starts as the account name, not the last name typed on the device', () => {
  const p = src('components/app/person-name.tsx');
  assert.ok(p.includes('useSession()') && !p.includes('localStorage.getItem'), 'person name still read from the device');
});

test('sign-in fails closed: refused unless the limit check said yes; the client IP is part of the key', () => {
  const a = src('app/login/actions.ts');
  assert.ok(/allowed !== true/.test(a), 'a failed limit check must refuse, not skip');
  assert.ok(a.includes('x-forwarded-for') && a.includes('p_ip'), 'the limit is not keyed by client IP');
});
console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
