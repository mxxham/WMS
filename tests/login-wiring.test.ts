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
test('the site account is read only to sign in as it (middleware) or recognise it (lib/auth, Pengguna); never by the login action', () => {
  for (const f of ['app/login/actions.ts', 'lib/auth-route.ts']) assert.ok(!src(f).includes('SITE_ACCOUNT'), f);
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
test('Nama Anda: a personal account\'s name; on the shared account, the name typed on this device (as today)', () => {
  const p = src('components/app/person-name.tsx');
  assert.ok(p.includes('useSession()') && p.includes('shared'), 'person name ignores whether the session is the shared account');
  assert.ok(p.includes('localStorage.getItem') && p.includes('localStorage.setItem'), 'the shared account no longer remembers the typed name');
  assert.ok(src('lib/auth.ts').includes('app_metadata') && src('app/(app)/layout.tsx').includes('shared: user.shared'), 'the shared account is not told apart');
});

test('sign-in fails closed: refused unless the limit check said yes; the client IP is part of the key', () => {
  const a = src('app/login/actions.ts');
  assert.ok(/allowed !== true/.test(a), 'a failed limit check must refuse, not skip');
  assert.ok(a.includes('x-forwarded-for') && a.includes('p_ip'), 'the limit is not keyed by client IP');
});
test('after a wrong password the username stays filled in (React resets the form after an action)', () => {
  const f = src('app/login/login-form.tsx');
  assert.ok(/value=\{username\}/.test(f) && f.includes('setUsername'), 'the username input is not kept in state');
});
test('only a real deactivation signs someone out; other profile read errors throw (error page, retry)', () => {
  const a = src('lib/auth.ts');
  assert.ok(a.includes('PGRST116') && a.includes('PT403') && /throw /.test(a), 'every failed read is treated as deactivated');
});
test('the shared account is marked in its sign-in data, and the middleware passes it to authRoute', () => {
  const m = src('middleware.ts');
  assert.ok(m.includes('shared') && m.includes('app_metadata'), 'middleware does not know the shared account');
  assert.ok(/authRoute\(.*isShared\)/.test(m), 'authRoute does not get the shared flag');
});
test('while login is not required, Pengguna refuses to deactivate, re-role or reset the shared account', () => {
  const a = src('app/(app)/admin/users/actions.ts');
  for (const fn of ['setRole', 'setActive', 'resetPassword']) {
    const body = a.slice(a.indexOf(`export async function ${fn}`), a.indexOf('\n}', a.indexOf(`export async function ${fn}`)));
    assert.ok(body.includes('sharedGuard('), `${fn} does not guard the shared account`);
  }
});

// --- New assertions for CKB 3PL app routing (Lane B) ---

test('login action falls back to resolveAppsHome/akses and only uses safeNext when next is present', () => {
  const a = src('app/login/actions.ts');
  // Explicit next uses safeNext
  assert.ok(a.includes('if (next)') && a.includes('redirect(safeNext(next))'), 'explicit next does not use safeNext');
  // No next: reads profile via service client, selects apps/default_app
  assert.ok(a.includes('from("profiles")') && a.includes('select("apps, default_app")'), 'profile apps/default_app not read via service client');
  // Calls normalizeApps and resolveAppsHome
  assert.ok(a.includes('normalizeApps(') && a.includes('resolveAppsHome('), 'does not call normalizeApps/resolveAppsHome');
  // Fail-closed: home defaults to /akses, and the redirect happens AFTER the catch — redirect()
  // throws, so it must never sit inside the try (a swallowed redirect would send everyone to /akses).
  const homeDefault = a.indexOf('let home');
  assert.ok(homeDefault > -1 && a.slice(homeDefault, homeDefault + 60).includes('= "/akses"'), 'home must default fail-closed to /akses');
  const catchEnd = a.indexOf('  } catch {');
  const redirectHome = a.indexOf('redirect(home);');
  assert.ok(catchEnd > -1 && redirectHome > catchEnd, 'redirect(home) must run after the catch (a redirect inside the try is swallowed)');
  // Comment: default-app data comes from server, never client
  assert.ok(a.includes('default-app data comes from the server, never from the client'), 'missing server-data comment');
});

test('app/(app)/layout.tsx calls requireAppAccess("shell_wms") with app-level gate comment', () => {
  const l = src('app/(app)/layout.tsx');
  assert.ok(l.includes('requireAppAccess("shell_wms")'), 'layout does not call requireAppAccess for shell_wms');
  assert.ok(l.includes('app-level gate') && l.includes('Shell WMS') && l.includes('/ckb') && l.includes('/akses'), 'missing app-level gate comment');
});

test('app/ckb/layout.tsx exists, checks ckb_3pl, and does NOT contain WaveAlerts/WelcomeScreen', () => {
  const l = src('app/ckb/layout.tsx');
  assert.ok(l.includes('requireAppAccess("ckb_3pl")'), 'ckb layout does not call requireAppAccess for ckb_3pl');
  assert.ok(!l.includes('WaveAlerts'), 'ckb layout must not include WaveAlerts');
  assert.ok(!l.includes('WelcomeScreen'), 'ckb layout must not include WelcomeScreen');
  assert.ok(!l.includes('SessionProvider'), 'ckb layout must not include SessionProvider');
  assert.ok(!l.includes('from "@/components/app/nav"'), 'ckb layout must not import Shell nav');
  assert.ok(l.includes('CKB 3PL'), 'ckb layout missing CKB 3PL header text');
  assert.ok(l.includes('action="/keluar"') && l.includes('method="post"'), 'ckb layout Keluar form not a plain POST');
});

test('app/ckb/page.tsx is a holding screen with the six streams and no Shell links', () => {
  const p = src('app/ckb/page.tsx');
  assert.ok(p.includes('CKB 3PL'), 'page missing CKB 3PL title');
  assert.ok(p.includes('Aplikasi ini sedang disiapkan untuk CKB Warehouse 5'), 'page missing Indonesian holding paragraph');
  for (const s of ['Freeport', 'CGP', 'SIP', 'MNE', 'Boiler', 'SSB']) {
    assert.ok(p.includes(s), `page missing stream: ${s}`);
  }
  assert.ok(!p.includes('/scan') && !p.includes('/dashboard') && !p.includes('/waves'), 'page must not link to Shell routes');
});

test('app/akses/page.tsx redirects authorized user to app home and has Keluar form', () => {
  const p = src('app/akses/page.tsx');
  assert.ok(p.includes('getSessionUser'), 'akses page does not get session user');
  assert.ok(p.includes('redirect("/login")'), 'akses page does not redirect missing user to login');
  // getSessionUser normalizes apps (dedupe, drop unknown ids); the page trusts it directly.
  assert.ok(p.includes('user.apps') && p.includes('resolveAppsHome'), 'akses page does not redirect authorized user to app home');
  assert.ok(p.includes('Tidak ada akses aplikasi') && p.includes('belum diberi akses ke aplikasi manapun'), 'akses page missing Indonesian denied text');
  assert.ok(p.includes('action="/keluar"') && p.includes('method="post"'), 'akses page Keluar form not a plain POST');
  // Server component, no client JS needed — no "use client"
  assert.ok(!p.startsWith('"use client"') && !p.includes("'use client'"), 'akses page must be a server component');
});

test('app/ckb/** files do not import SessionProvider or Shell nav', () => {
  const layout = src('app/ckb/layout.tsx');
  const page = src('app/ckb/page.tsx');
  for (const f of [layout, page]) {
    assert.ok(!f.includes('SessionProvider'), 'ckb file imports SessionProvider');
    assert.ok(!f.includes('from "@/components/app/nav"'), 'ckb file imports Shell nav');
    assert.ok(!f.includes('from "@/components/app/wave-alerts"'), 'ckb file imports WaveAlerts');
    assert.ok(!f.includes('from "@/components/app/welcome-screen"'), 'ckb file imports WelcomeScreen');
  }
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
