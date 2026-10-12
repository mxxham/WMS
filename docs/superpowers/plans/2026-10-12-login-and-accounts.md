# Login and Personal Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the shared "Gudang" auto sign-in with a `/login` page and one account per person (username + password), managed by admins on a `Pengguna` page, with the existing roles unchanged.

**Architecture:** Supabase Auth keeps the passwords. A username resolves to the account's auth email on the server (`account_email`, service role only), so the existing Gudang account keeps working with username `gudang` while new accounts get `<username>@pengguna.internal`. `profiles` gains `username` and `active`; `has_role()` requires `active`; role and status change only through two admin RPCs. The middleware redirects to `/login` instead of signing in, and a pure rule (`lib/auth-route.ts`) decides every redirect.

**Tech Stack:** Next.js 15 App Router (server actions, middleware), @supabase/ssr, Supabase Auth admin API (service role, server only), PostgreSQL 16, standalone `tsx` tests, SQL tests via `scripts/sql-test.sh`.

**Spec:** `docs/superpowers/specs/2026-10-12-login-and-accounts-design.md`

## Global Constraints

- UI strings Indonesian; code, comments, docs English. No emojis anywhere.
- No new dependencies. `SUPABASE_SERVICE_ROLE_KEY` only in server code (server actions / route handlers), never `NEXT_PUBLIC_`.
- Usernames: 3–32 chars, `^[a-z0-9._-]{3,32}$`, stored lowercase; input trimmed and lowercased.
- New accounts' auth email: `<username>@pengguna.internal`. Users never see it.
- Failed sign-in message, always the same: `Nama pengguna atau kata sandi salah.`
- Passwords: minimum 8 characters.
- Accounts are never deleted. Deactivate = `profiles.active = false` + Supabase ban.
- Every action has a confirmation step with a summary sentence (AGENTS.md).
- Migrations 0001–0070 are not edited; this work is `0071`. SQL test is `42_accounts.sql`.
- Never connect to the live database; never `supabase db push` or deploy (the user does).
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Two admins demoting/deactivating each other at the same moment** — expected: one wins, at least one active admin always remains. Test: Task 1 rows "demoting the other admin leaves one active admin" and "concurrent last-admin guard" (both functions go through the locking guard).
2. **`next=` pointing off-site** (`//evil.com`, `https://…`, `/\evil`) — expected: lands on `/`, never another origin. Test: Task 2 `auth-route` rows.
3. **A deactivated user with a still-valid token on a handheld** — expected: every RPC and page refuses at once (no waiting for token expiry), and the app sends them to `/login`. Test: Task 1 `has_role` row; Task 3 layout redirect via `/keluar`; browser check in Task 6.
4. **Username typed with capitals or spaces** (`" Ilham "`) — expected: signs in as `ilham`. Test: Task 2 `username` rows; browser check in Task 6.
5. **Gudang's existing auth email is not `gudang@pengguna.internal`** — expected: `gudang` still signs in after cutover. Test: Task 1 `account_email` row uses an account whose email is `site@x`.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/0071_accounts.sql` | `username`, `active`, `has_role` with active, `handle_new_user` username, `set_user_role`, `set_user_active`, `account_email`, drop direct profile updates |
| `supabase/tests/42_accounts.sql` | SQL rules above |
| `lib/username.ts` | `normalizeUsername`, `usernameError`, `internalEmail` (pure) |
| `lib/auth-route.ts` | `authRedirect(path, search, signedIn)`, `safeNext(next)` (pure) |
| `middleware.ts` | session check → `authRedirect` |
| `app/login/page.tsx`, `app/login/login-form.tsx`, `app/login/actions.ts` | sign-in page and server action |
| `app/keluar/route.ts` | sign out (POST from the button, GET from the inactive redirect) |
| `lib/auth.ts` | `SessionUser` gains `username`; inactive → null |
| `app/(app)/layout.tsx` | no user → `/keluar`; session provider |
| `components/app/session.tsx` | `SessionProvider`, `useSession` (client) |
| `components/app/account.tsx` | `AccountBox` (sidebar), `AccountButton` (phone header) |
| `components/app/person-name.tsx` | prefill from the account |
| `app/(app)/admin/users/page.tsx`, `users-client.tsx`, `actions.ts` | Pengguna page |
| `components/app/nav-config.ts` | `Pengguna` link (admin) |
| docs: `AGENTS.md`, `README.md`, `.env.example`, `components/app/about-copy.ts` (Privasi), spec note | |

---

### Task 1: Accounts in the database (0071)

**Files:**
- Create: `supabase/migrations/0071_accounts.sql`
- Test: `supabase/tests/42_accounts.sql`

**Interfaces:**
- Produces (SQL): `profiles.username text not null unique`, `profiles.active boolean not null default true`; `set_user_role(p_user uuid, p_role user_role) returns void`; `set_user_active(p_user uuid, p_active boolean) returns void`; `account_email(p_username text) returns text` (service_role only); `has_role(roles)` false for inactive profiles.

- [ ] **Step 1: Write the failing SQL test** `supabase/tests/42_accounts.sql`

```sql
-- Personal accounts (0071): usernames, active flag, admin-only role/status changes, username lookup.
-- Runs in a transaction and rolls back. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.fails(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then
  if sqlerrm not like p_like then raise notice 'got: %', sqlerrm; end if;
  return sqlerrm like p_like; end $$;
create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', p::text, true); end $$;

insert into auth.users values ('a1111111-1111-1111-1111-111111111111','site@x','{"name":"Gudang","username":"Gudang"}');
insert into auth.users values ('a2222222-2222-2222-2222-222222222222','ani@pengguna.internal','{"name":"Ani","username":"ani"}');
insert into auth.users values ('a3333333-3333-3333-3333-333333333333','Budi.Santoso@x','{"name":"Budi"}');
insert into auth.users values ('a4444444-4444-4444-4444-444444444444','admin2@pengguna.internal','{"name":"Dewi","username":"dewi"}');
update profiles set role = 'admin' where id in ('a1111111-1111-1111-1111-111111111111','a4444444-4444-4444-4444-444444444444');

select pg_temp.check('username from metadata, lowercased',
  (select username from profiles where id = 'a1111111-1111-1111-1111-111111111111') = 'gudang');
select pg_temp.check('no username in metadata: derived from the email, valid format',
  (select username ~ '^[a-z0-9._-]{3,32}$' and username like 'budi.santoso%' from profiles where id = 'a3333333-3333-3333-3333-333333333333'));
select pg_temp.check('a duplicate username is refused',
  pg_temp.fails($q$update profiles set username = 'ani' where id = 'a3333333-3333-3333-3333-333333333333'$q$, '%duplicate key%'));
select pg_temp.check('capitals are refused by the format check',
  pg_temp.fails($q$update profiles set username = 'Ani2' where id = 'a3333333-3333-3333-3333-333333333333'$q$, '%profiles_username_format%'));

set role authenticated;
select pg_temp.as_user('a2222222-2222-2222-2222-222222222222');
select pg_temp.check('an operator cannot change roles',
  pg_temp.fails($q$select set_user_role('a3333333-3333-3333-3333-333333333333', 'supervisor')$q$, 'Hanya admin%'));
select pg_temp.as_user('a1111111-1111-1111-1111-111111111111');
select pg_temp.check('no direct update of profiles any more, not even by an admin',
  pg_temp.fails($q$update profiles set role = 'admin' where id = 'a2222222-2222-2222-2222-222222222222'$q$, '%permission denied%'));
select pg_temp.check('an admin cannot change their own role',
  pg_temp.fails($q$select set_user_role('a1111111-1111-1111-1111-111111111111', 'operator')$q$, 'Tidak bisa mengubah akun Anda sendiri%'));
select set_user_role('a3333333-3333-3333-3333-333333333333', 'supervisor');
select pg_temp.check('an admin changes another account''s role',
  (select role from profiles where id = 'a3333333-3333-3333-3333-333333333333') = 'supervisor');
select pg_temp.check('an admin cannot deactivate themselves',
  pg_temp.fails($q$select set_user_active('a1111111-1111-1111-1111-111111111111', false)$q$, 'Tidak bisa mengubah akun Anda sendiri%'));
select set_user_active('a2222222-2222-2222-2222-222222222222', false);
select pg_temp.as_user('a2222222-2222-2222-2222-222222222222');
select pg_temp.check('a deactivated account has no role at once (live token or not)',
  not has_role(array['operator','supervisor','admin']::user_role[]));
select pg_temp.as_user('a1111111-1111-1111-1111-111111111111');
select set_user_role('a4444444-4444-4444-4444-444444444444', 'operator');
select pg_temp.check('demoting the other admin leaves one active admin; the last admin cannot be removed',
  (select count(*) from profiles where role = 'admin' and active) = 1);
select pg_temp.check('concurrent last-admin guard: both functions go through the locking guard',
  (select prosrc like '%pg_advisory_xact_lock%' from pg_proc where proname = 'accounts_guard')
  and (select count(*) from pg_proc where proname in ('set_user_role','set_user_active') and prosrc like '%accounts_guard%') = 2);

reset role;
select pg_temp.check('account_email finds the auth email by username, whatever the email is',
  account_email(' Gudang ') = 'site@x' and account_email('ani') is null and account_email('nobody') is null);
select pg_temp.check('account_email is for the server only',
  not has_function_privilege('authenticated', 'public.account_email(text)', 'execute')
  and not has_function_privilege('anon', 'public.account_email(text)', 'execute'));
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `PGUSER=postgres scripts/sql-test.sh supabase/tests/42_accounts.sql`
Expected: `ERROR in supabase/tests/42_accounts.sql` (column `username` does not exist).

- [ ] **Step 3: Write the migration** `supabase/migrations/0071_accounts.sql`

```sql
-- =====================================================================
-- 0071  Personal accounts: username, active, admin-managed roles
--
--  Until now every visitor was signed in as one shared account (Gudang).
--  Each person now has their own account (spec 2026-10-12 login):
--   · profiles.username: what people type to sign in (lowercase,
--     3–32 of a-z 0-9 . _ -). New accounts' auth email is
--     <username>@pengguna.internal; account_email() resolves a username to
--     whatever auth email the account has, so the existing Gudang account
--     (signed in by its old email until now) works as `gudang` unchanged.
--   · profiles.active: a deactivated account has no role at all
--     (has_role), even with a token that has not expired yet.
--   · roles and status change only through set_user_role /
--     set_user_active (admin, never on yourself, always one active admin
--     left). The direct "admin update" policy goes: it bypassed those rules.
-- =====================================================================

alter table public.profiles add column username text, add column active boolean not null default true;

-- The shared site account becomes the first admin, `gudang`.
update public.profiles set username = 'gudang', role = 'admin' where id = '5e853334-8d85-4466-b14c-4a1837afd92b';

-- Everyone else: from their email's local part, made valid and unique.
create or replace function public.derive_username(p_email text, p_id uuid) returns text
language plpgsql stable set search_path = public as $$
declare v text := left(regexp_replace(lower(split_part(coalesce(p_email, ''), '@', 1)), '[^a-z0-9._-]', '', 'g'), 24);
begin
  if length(v) < 3 then v := 'user'; end if;
  if exists (select 1 from public.profiles where username = v and id <> p_id) then
    v := v || '-' || left(replace(p_id::text, '-', ''), 6);
  end if;
  return v;
end $$;

do $$
declare r record;
begin
  for r in select p.id, u.email from public.profiles p join auth.users u on u.id = p.id where p.username is null order by p.created_at loop
    update public.profiles set username = public.derive_username(r.email, r.id) where id = r.id;
  end loop;
end $$;

alter table public.profiles alter column username set not null,
  add constraint profiles_username_format check (username ~ '^[a-z0-9._-]{3,32}$');
create unique index profiles_username_uq on public.profiles (username);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare v text := lower(trim(coalesce(new.raw_user_meta_data->>'username', '')));
begin
  if v !~ '^[a-z0-9._-]{3,32}$' then v := public.derive_username(new.email, new.id); end if;
  insert into public.profiles (id, name, role, username)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', new.email), 'operator', v)
  on conflict (id) do nothing;
  return new;
end $$;

create or replace function public.has_role(roles public.user_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select active and role = any(roles) from public.profiles where id = auth.uid()), false)
$$;

-- All role / status changes go through the functions below.
drop policy if exists "profiles: admin update" on public.profiles;
revoke update on public.profiles from authenticated;

create or replace function public.accounts_guard(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(array['admin']::public.user_role[]) then raise exception 'Hanya admin yang bisa mengubah pengguna'; end if;
  if p_user = auth.uid() then raise exception 'Tidak bisa mengubah akun Anda sendiri'; end if;
  -- One change to accounts at a time: two admins demoting each other cannot leave no admin.
  perform pg_advisory_xact_lock(hashtext('accounts'));
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'Pengguna tidak ditemukan'; end if;
end $$;

create or replace function public.set_user_role(p_user uuid, p_role public.user_role) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.accounts_guard(p_user);
  update public.profiles set role = p_role where id = p_user;
  if not exists (select 1 from public.profiles where role = 'admin' and active) then raise exception 'Harus ada minimal satu admin aktif'; end if;
end $$;

create or replace function public.set_user_active(p_user uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.accounts_guard(p_user);
  update public.profiles set active = p_active where id = p_user;
  if not exists (select 1 from public.profiles where role = 'admin' and active) then raise exception 'Harus ada minimal satu admin aktif'; end if;
end $$;

-- Sign-in: username -> the account's auth email (active accounts only). Server only.
create or replace function public.account_email(p_username text) returns text
language sql stable security definer set search_path = public as $$
  select u.email from auth.users u join public.profiles p on p.id = u.id
  where p.username = lower(trim(p_username)) and p.active
$$;

revoke execute on function public.accounts_guard(uuid), public.derive_username(text, uuid) from public, anon, authenticated;
revoke execute on function public.account_email(text) from public, anon, authenticated;
grant execute on function public.account_email(text) to service_role;
revoke execute on function public.set_user_role(uuid, public.user_role), public.set_user_active(uuid, boolean) from public, anon;
grant execute on function public.set_user_role(uuid, public.user_role), public.set_user_active(uuid, boolean) to authenticated;
```

(The lock is taken in `accounts_guard`, which both functions call first, so it is held for the rest of the calling transaction.)

- [ ] **Step 4: Run the test to verify it passes, then the whole SQL suite**

Run: `PGUSER=postgres scripts/sql-test.sh supabase/tests/42_accounts.sql`
Expected: `supabase/tests/42_accounts.sql: 14 PASS, 0 FAIL` (14 rows)
Run: `PGUSER=postgres scripts/sql-test.sh`
Expected: every file `0 FAIL` (tests that sign in as test users must still pass: `has_role` only adds `active`, default true).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0071_accounts.sql supabase/tests/42_accounts.sql
git commit -m "feat(auth): personal accounts with usernames and admin-managed roles (0071, test 42)"
```

---

### Task 2: Pure rules — usernames and redirects

**Files:**
- Create: `lib/username.ts`, `lib/auth-route.ts`
- Test: `tests/username.test.ts`, `tests/auth-route.test.ts`; add both to the `npm test` chain in `package.json` after `tests/notices.test.ts`.

**Interfaces:**
- Produces: `normalizeUsername(raw: string): string`; `usernameError(u: string): string | null`; `internalEmail(u: string): string`; `safeNext(next: string | null): string`; `authRedirect(path: string, search: string, signedIn: boolean): string | null` (the URL to redirect to, or null to continue); `PUBLIC_PATHS: string[]`.

- [ ] **Step 1: Write the failing tests**

`tests/username.test.ts`:

```ts
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
```

`tests/auth-route.test.ts`:

```ts
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx tsx tests/username.test.ts; npx tsx tests/auth-route.test.ts`
Expected: both fail with `ERR_MODULE_NOT_FOUND` for `../lib/username` and `../lib/auth-route`.

- [ ] **Step 3: Implement**

`lib/username.ts`:

```ts
/**
 * Usernames (spec 2026-10-12 login §1): people sign in with a username, Supabase Auth with an email.
 * New accounts get a hidden internal email; sign-in resolves a username to whatever email the
 * account has (account_email(), 0071), so older accounts keep theirs.
 */
export const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
export const INTERNAL_DOMAIN = "pengguna.internal";

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function usernameError(u: string): string | null {
  if (u.length < 3) return "Nama pengguna minimal 3 karakter.";
  if (u.length > 32) return "Nama pengguna maksimal 32 karakter.";
  if (!USERNAME_RE.test(u)) return "Nama pengguna hanya huruf kecil, angka, titik, garis bawah atau tanda hubung, tanpa spasi.";
  return null;
}

export function internalEmail(u: string): string {
  return `${u}@${INTERNAL_DOMAIN}`;
}
```

`lib/auth-route.ts`:

```ts
/**
 * Where a request goes (middleware.ts): signed out -> /login?next=<page>, signed in on /login ->
 * back to that page. Pure, so the rule is tested without a server.
 */
export const PUBLIC_PATHS = ["/login", "/keluar"];

const isPublic = (path: string) => PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

/** A same-site path to return to; anything else (other sites, protocol-relative, /login) is "/". */
export function safeNext(next: string | null): string {
  if (!next) return "/";
  let v = next;
  try { v = decodeURIComponent(next); } catch { return "/"; }
  if (!v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\") || v.includes("\\")) return "/";
  if (v === "/login" || v.startsWith("/login?") || v.startsWith("/keluar")) return "/";
  return v;
}

export function authRedirect(path: string, search: string, signedIn: boolean): string | null {
  if (!signedIn) {
    if (isPublic(path)) return null;
    const here = path + search;
    return here === "/" ? "/login" : `/login?next=${encodeURIComponent(here)}`;
  }
  if (path === "/login") return safeNext(new URLSearchParams(search).get("next"));
  return null;
}
```

- [ ] **Step 4: Run them to verify they pass; chain them**

Run: `npx tsx tests/username.test.ts; npx tsx tests/auth-route.test.ts`
Expected: `4 passed, 0 failed` and `5 passed, 0 failed`.
In `package.json`, append ` && tsx tests/username.test.ts && tsx tests/auth-route.test.ts` after `tsx tests/notices.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add lib/username.ts lib/auth-route.ts tests/username.test.ts tests/auth-route.test.ts package.json
git commit -m "feat(auth): username and sign-in redirect rules"
```

---

### Task 3: Sign in, sign out, no automatic session

**Files:**
- Modify: `middleware.ts` (whole file), `lib/auth.ts`, `app/(app)/layout.tsx`, `.env.example`
- Create: `app/login/page.tsx`, `app/login/login-form.tsx`, `app/login/actions.ts`, `app/keluar/route.ts`
- Test: `tests/login-wiring.test.ts` (source checks; add to the chain)

**Interfaces:**
- Consumes: `authRedirect`, `safeNext` (Task 2); `normalizeUsername`, `usernameError` (Task 2); `account_email` (Task 1).
- Produces: `loginAction(state: { error?: string }, fd: FormData): Promise<{ error?: string }>`; `SessionUser = { id: string; email: string | null; name: string; role: Role; username: string }`; `POST|GET /keluar` → signs out → `/login` (`/login?nonaktif=1` when called for an inactive account).

- [ ] **Step 1: Write the failing wiring test** `tests/login-wiring.test.ts`

```ts
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

test('the middleware no longer signs anyone in; it applies authRedirect', () => {
  const m = src('middleware.ts');
  assert.ok(!m.includes('signInWithPassword') && !m.includes('SITE_ACCOUNT'), 'middleware still signs in');
  assert.ok(m.includes('authRedirect('), 'middleware does not use authRedirect');
});
test('no code reads the site account any more', () => {
  for (const f of ['middleware.ts', 'lib/auth.ts', '.env.example', 'app/login/actions.ts']) assert.ok(!src(f).includes('SITE_ACCOUNT'), f);
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

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx tests/login-wiring.test.ts`
Expected: FAIL rows for the middleware, the env file, and missing files (`ENOENT` on `app/login/actions.ts` is the first).

- [ ] **Step 3: Implement**

`middleware.ts` (replace the whole file):

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authRedirect } from "@/lib/auth-route";

// Every person signs in with their own account (spec 2026-10-12 login). This refreshes the session
// cookie and sends a signed-out request to /login (lib/auth-route.ts decides). getClaims verifies
// the JWT locally against the cached JWKS, refreshing it first if it is about to expire.
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data } = await supabase.auth.getClaims();
  const to = authRedirect(request.nextUrl.pathname, request.nextUrl.search, !!data?.claims);
  if (!to) return response;
  const redirect = NextResponse.redirect(new URL(to, request.url));
  for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie.name, cookie.value, cookie);
  return redirect;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico)$).*)"],
};
```

`app/login/actions.ts`:

```ts
"use server";
import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { normalizeUsername, usernameError } from "@/lib/username";
import { safeNext } from "@/lib/auth-route";

const FAILED = "Nama pengguna atau kata sandi salah.";

/** Sign in by username: resolve the account's auth email on the server, then sign in with it. */
export async function loginAction(_: { error?: string }, fd: FormData): Promise<{ error?: string }> {
  const username = normalizeUsername(String(fd.get("username") ?? ""));
  const password = String(fd.get("password") ?? "");
  const fail = { error: FAILED };
  if (usernameError(username) || password.length === 0) return fail;
  const { data: email } = await createServiceClient().rpc("account_email", { p_username: username });
  if (typeof email !== "string" || !email) return fail;
  const { error } = await (await createClient()).auth.signInWithPassword({ email, password });
  if (error) return fail;
  redirect(safeNext(String(fd.get("next") ?? "")));
}
```

`app/login/login-form.tsx`:

```tsx
"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { loginAction } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, run, pending] = useActionState(loginAction, {});
  return (
    <form action={run} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <div><Label htmlFor="username">Nama pengguna</Label>
        <Input id="username" name="username" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required /></div>
      <div><Label htmlFor="password">Kata sandi</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required /></div>
      {state.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
      <Button type="submit" className="h-12 w-full text-base" disabled={pending}>{pending ? "Masuk…" : "Masuk"}</Button>
    </form>
  );
}
```

`app/login/page.tsx`:

```tsx
import { BRAND } from "@/config/brand";
import { ABOUT } from "@/components/app/about-copy";
import { LoginForm } from "./login-form";

/** Sign in (spec §1). Outside the app layout: no nav, no footer, no welcome screen. */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; nonaktif?: string }> }) {
  const sp = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-ckb p-4">
      <div className="w-full max-w-sm space-y-6 rounded-xl bg-white p-6">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-md bg-white p-1 ring-1 ring-steel-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={BRAND.logo} alt="" width={40} height={40} className="h-10 w-10" />
          </span>
          <div>
            <h1 className="font-cond text-2xl font-bold leading-tight">{ABOUT.name}</h1>
            <span className="inline-block rounded-plate bg-plate px-1.5 font-cond text-xs font-bold text-steel">{BRAND.site}</span>
          </div>
        </div>
        <p className="text-sm text-steel-500">Masuk dengan akun yang dibuat admin gudang.</p>
        {sp.nonaktif && <p role="alert" className="text-sm text-bad">Akun ini dinonaktifkan. Hubungi admin.</p>}
        <LoginForm next={sp.next ?? ""} />
        <p className="text-xs text-steel-500">{ABOUT.copyright} · {ABOUT.internal}</p>
      </div>
    </main>
  );
}
```

`app/keluar/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Sign out: POST from the Keluar button; GET only from the app layout for an inactive account
// (never linked with <Link>, so nothing prefetches it).
async function signOut(request: NextRequest) {
  await (await createClient()).auth.signOut();
  const url = new URL("/login", request.url);
  if (request.nextUrl.searchParams.get("nonaktif")) url.searchParams.set("nonaktif", "1");
  return NextResponse.redirect(url, { status: 303 });
}
export const POST = signOut;
export const GET = signOut;
```

`lib/auth.ts` — change the type and the profile read in `getSessionUser`:

```ts
export type SessionUser = { id: string; email: string | null; name: string; role: Role; username: string };

// cache(): the layout and the page both ask for the user; one request does
// the JWT check and profile read once. A deactivated account (0071) counts as signed out.
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims) return null;
  const email = typeof claims.email === "string" ? claims.email : null;
  const { data: profile } = await supabase.from("profiles").select("name, role, username, active").eq("id", claims.sub).single();
  if (!profile || !profile.active) return null;
  return { id: claims.sub, email, name: profile.name ?? email ?? "User", role: profile.role as Role, username: profile.username };
});
```

and in `requireRole` replace `if (!user) throw new Error("Sesi situs tidak tersedia.");` with `if (!user) redirect("/keluar?nonaktif=1");`.

`app/(app)/layout.tsx` — replace `if (!user) throw new Error("Sesi situs tidak tersedia.");` with
`if (!user) redirect("/keluar?nonaktif=1");` and add `import { redirect } from "next/navigation";`.
(The middleware already sent requests without a session to `/login`; a missing user here means a valid token for a deactivated or missing profile.)

`.env.example` — remove the three site-account lines:

```
# Shared site account every visitor uses (an admin account in Supabase Auth).
SITE_ACCOUNT_EMAIL=
SITE_ACCOUNT_PASSWORD=
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx tsx tests/login-wiring.test.ts && npm run typecheck && npm run lint`
Expected: `5 passed, 0 failed`; no type or lint errors. Append ` && tsx tests/login-wiring.test.ts` to the `npm test` chain.

- [ ] **Step 5: Commit**

```bash
git add middleware.ts lib/auth.ts "app/(app)/layout.tsx" .env.example app/login app/keluar tests/login-wiring.test.ts package.json
git commit -m "feat(auth): sign in with a username, Keluar, no shared session"
```

---

### Task 4: Who is signed in, Keluar, names prefilled

**Files:**
- Create: `components/app/session.tsx`, `components/app/account.tsx`
- Modify: `app/(app)/layout.tsx`, `components/app/nav.tsx` (sidebar bottom), `components/app/page-header.tsx` (phone), `components/app/person-name.tsx`
- Test: extend `tests/login-wiring.test.ts`

**Interfaces:**
- Consumes: `SessionUser` (Task 3).
- Produces: `SessionProvider({ user: { name: string; username: string; role: Role }, children })`, `useSession(): { name: string; username: string; role: Role } | null`; `AccountBox()` (sidebar), `AccountButton()` (phone header); `usePersonName()` unchanged signature `[string, (v: string) => void]`.

- [ ] **Step 1: Add the failing checks** to `tests/login-wiring.test.ts` (before the summary line)

```ts
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx tsx tests/login-wiring.test.ts`
Expected: the two new rows FAIL.

- [ ] **Step 3: Implement**

`components/app/session.tsx`:

```tsx
"use client";
import { createContext, useContext } from "react";
import type { Role } from "@/lib/types";

type Session = { name: string; username: string; role: Role };
const Ctx = createContext<Session | null>(null);

/** The signed-in account, for client components (filled once by the app layout). */
export function SessionProvider({ user, children }: { user: Session; children: React.ReactNode }) {
  return <Ctx.Provider value={user}>{children}</Ctx.Provider>;
}
export const useSession = () => useContext(Ctx);
```

`components/app/account.tsx`:

```tsx
"use client";
import { LogOut } from "lucide-react";
import { ActionMenu, MenuSection } from "@/components/app/action-menu";
import { useSession } from "./session";

const ROLE: Record<string, string> = { operator: "Operator", supervisor: "Supervisor", admin: "Admin" };

/** Keluar: a plain form POST to /keluar, so it works even if scripts failed to load. */
function SignOut({ className }: { className?: string }) {
  return (
    <form action="/keluar" method="post">
      <button type="submit" className={className}><LogOut className="h-4 w-4" />Keluar</button>
    </form>
  );
}

/** Bottom of the desktop sidebar: who is signed in, and Keluar. */
export function AccountBox() {
  const s = useSession();
  if (!s) return null;
  return (
    <div className="flex items-center justify-between gap-2 border-t border-white/10 px-4 py-3 text-sm">
      <span className="min-w-0">
        <span className="block truncate font-medium">{s.name}</span>
        <span className="block text-xs text-white/60">{s.username} · {ROLE[s.role] ?? s.role}</span>
      </span>
      <SignOut className="inline-flex h-10 items-center gap-1 rounded-md px-2 text-white/85 hover:bg-ckb-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-plate" />
    </div>
  );
}

/** Phone page header: the account's initial; tapping shows name, role and Keluar. */
export function AccountButton() {
  const s = useSession();
  if (!s) return null;
  return (
    <ActionMenu title={s.name} trigger={
      <button type="button" aria-label={`Akun: ${s.name}`} className="ml-auto flex h-10 w-10 items-center justify-center rounded-full bg-plate font-cond text-lg font-bold text-steel lg:hidden">
        {s.name.charAt(0).toUpperCase()}
      </button>
    }>
      <p className="px-3 pb-2 text-sm text-steel-500">{s.username} · {ROLE[s.role] ?? s.role}</p>
      <MenuSection><SignOut /></MenuSection>
    </ActionMenu>
  );
}
```

`app/(app)/layout.tsx` — the whole file after Tasks 3 and 4:

```tsx
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Nav } from "@/components/app/nav";
import { WaveAlerts } from "@/components/app/wave-alerts";
import { WelcomeScreen } from "@/components/app/welcome-screen";
import { SiteFooter } from "@/components/app/site-footer";
import { SessionProvider } from "@/components/app/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  // The middleware already sent requests without a session to /login: no user here means a valid
  // token for a deactivated (or missing) profile. Sign it out.
  if (!user) redirect("/keluar?nonaktif=1");
  return (
    <SessionProvider user={{ name: user.name, username: user.username, role: user.role }}>
      <div className="min-h-screen">
        <Nav role={user.role} />
        <div className="pb-20 lg:pb-0 lg:pl-56">
          {children}
          <SiteFooter />
        </div>
        <WaveAlerts />
        {/* useSearchParams inside: its own Suspense boundary so it never holds up a page. */}
        <Suspense fallback={null}><WelcomeScreen /></Suspense>
      </div>
    </SessionProvider>
  );
}
```

`components/app/nav.tsx` — before `</aside>` add `<AccountBox />`; import `{ AccountBox } from "./account"`.

`components/app/page-header.tsx` — inside the header, after the title block `</div>` add `<AccountButton />`; import `{ AccountButton } from "./account"`. (The header is a server component rendering a client component; the header's `flex flex-wrap items-end justify-between` already pushes it right.)

`components/app/person-name.tsx` — replace `usePersonName`:

```ts
/**
 * The name of whoever is doing a control step (count, approval, receipt, hold …). The database
 * records it with the step and refuses the step without one. It starts as the signed-in account's
 * name (0071 personal accounts); it can still be edited for this page, but is not remembered on
 * the device, so the next person on a shared handheld starts with their own name.
 */
export function usePersonName(): [string, (v: string) => void] {
  const account = useSession()?.name ?? "";
  const [name, setName] = useState(account);
  useEffect(() => {
    setName(account);
    // Every field on the page shows the same person.
    const sync = (e: Event) => setName((e as CustomEvent<string>).detail);
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, [account]);
  const set = (v: string) => {
    setName(v);
    window.dispatchEvent(new CustomEvent(EVENT, { detail: v }));
  };
  return [name, set];
}
```

remove the `KEY` constant, add `import { useSession } from "./session";`.

- [ ] **Step 4: Run tests, typecheck, lint**

Run: `npx tsx tests/login-wiring.test.ts && npm run typecheck && npm run lint`
Expected: `7 passed, 0 failed`; clean.

- [ ] **Step 5: Commit**

```bash
git add components/app/session.tsx components/app/account.tsx "app/(app)/layout.tsx" components/app/nav.tsx components/app/page-header.tsx components/app/person-name.tsx tests/login-wiring.test.ts
git commit -m "feat(auth): show the signed-in account with Keluar; names start as the account"
```

---

### Task 5: Pengguna page (admin)

**Files:**
- Create: `app/(app)/admin/users/page.tsx`, `app/(app)/admin/users/users-client.tsx`, `app/(app)/admin/users/actions.ts`
- Modify: `components/app/nav-config.ts` (Admin section), `tests/home.test.ts` (admin has 3 more links than supervisor)
- Test: `tests/users-actions.test.ts` (validation helper), plus the existing `tests/home.test.ts`

**Interfaces:**
- Consumes: `normalizeUsername`, `usernameError`, `internalEmail` (Task 2); `set_user_role`, `set_user_active` (Task 1); `checkRole` (lib/auth); `ConfirmButton`, `ActionMenu`.
- Produces: `newUserError(input: { name: string; username: string; password: string; role: string }): string | null` (exported from `lib/username.ts`); server actions `createUser(input) / setRole(id, role) / setActive(id, active) / resetPassword(id, password): Promise<string | null>` (null = ok, else the message).

- [ ] **Step 1: Write the failing tests**

`tests/users-actions.test.ts`:

```ts
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
```

In `tests/home.test.ts`, change `assert.equal(hrefs('admin').length, sup.length + 2);` to `assert.equal(hrefs('admin').length, sup.length + 3);` and add `assert.ok(hrefs('admin').includes('/admin/users') && !sup.includes('/admin/users'));` in the same test.

- [ ] **Step 2: Run to verify they fail**

Run: `npx tsx tests/users-actions.test.ts; npx tsx tests/home.test.ts`
Expected: `users-actions` fails (`newUserError` is not exported); `home` fails the admin count (19 vs 20) and `/admin/users` (not a page yet).

- [ ] **Step 3: Implement**

Append to `lib/username.ts`:

```ts
export const PASSWORD_MIN = 8;
export const ROLES = ["operator", "supervisor", "admin"] as const;

/** Tambah pengguna: the first problem with the form, or null. */
export function newUserError(i: { name: string; username: string; password: string; role: string }): string | null {
  if (i.name.trim().length < 2) return "Nama wajib diisi.";
  const u = usernameError(normalizeUsername(i.username));
  if (u) return u;
  if (i.password.length < PASSWORD_MIN) return `Kata sandi minimal ${PASSWORD_MIN} karakter.`;
  if (!(ROLES as readonly string[]).includes(i.role)) return "Peran tidak dikenal.";
  return null;
}
```

`components/app/nav-config.ts` — in the Admin section, after `Pengaturan`:

```ts
    { href: "/admin/users", label: "Pengguna", icon: Users, roles: ["admin"] },
```

and add `Users` to the lucide import.

`app/(app)/admin/users/actions.ts`:

```ts
"use server";
import { revalidatePath } from "next/cache";
import { checkRole } from "@/lib/auth";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { PASSWORD_MIN, internalEmail, newUserError, normalizeUsername } from "@/lib/username";

// Pengguna (spec §3). Passwords live in Supabase Auth, so creating accounts and setting passwords
// use the Auth admin API (service role) after an admin check; role and status go through the
// 0071 RPCs as the admin, which enforce "not yourself" and "one active admin".
const BAN = "876000h"; // ~100 years: Supabase's way to block sign-in

async function admin() {
  const u = await checkRole(["admin"]);
  if (!u) throw new Error("Hanya admin.");
  return u;
}
const done = () => { revalidatePath("/admin/users"); return null; };

export async function createUser(i: { name: string; username: string; password: string; role: string }): Promise<string | null> {
  try {
    await admin();
    const bad = newUserError(i);
    if (bad) return bad;
    const username = normalizeUsername(i.username);
    const db = await createClient();
    const { data: taken } = await db.from("profiles").select("id").eq("username", username).maybeSingle();
    if (taken) return `Nama pengguna ${username} sudah dipakai.`;
    const { data, error } = await createServiceClient().auth.admin.createUser({
      email: internalEmail(username), password: i.password, email_confirm: true,
      // username in app metadata: only the server can set it (0071 reads it from there).
      user_metadata: { name: i.name.trim() }, app_metadata: { username },
    });
    if (error || !data.user) return error?.message ?? "Akun tidak bisa dibuat.";
    if (i.role !== "operator") {
      const { error: e2 } = await db.rpc("set_user_role", { p_user: data.user.id, p_role: i.role });
      if (e2) return `Akun dibuat sebagai operator; peran tidak bisa diubah: ${e2.message}`;
    }
    return done();
  } catch (e) { return (e as Error).message; }
}

export async function setRole(id: string, role: string): Promise<string | null> {
  try {
    await admin();
    const { error } = await (await createClient()).rpc("set_user_role", { p_user: id, p_role: role });
    return error ? error.message : done();
  } catch (e) { return (e as Error).message; }
}

export async function setActive(id: string, active: boolean): Promise<string | null> {
  try {
    await admin();
    const { error } = await (await createClient()).rpc("set_user_active", { p_user: id, p_active: active });
    if (error) return error.message;
    const { error: e2 } = await createServiceClient().auth.admin.updateUserById(id, { ban_duration: active ? "none" : BAN });
    return e2 ? `Status disimpan, tetapi blokir masuk gagal: ${e2.message}` : done();
  } catch (e) { return (e as Error).message; }
}

/** Also allowed on your own account (cutover: change gudang's password). */
export async function resetPassword(id: string, password: string): Promise<string | null> {
  try {
    await admin();
    if (password.length < PASSWORD_MIN) return `Kata sandi minimal ${PASSWORD_MIN} karakter.`;
    const { error } = await createServiceClient().auth.admin.updateUserById(id, { password });
    return error ? error.message : done();
  } catch (e) { return (e as Error).message; }
}
```

`app/(app)/admin/users/page.tsx`:

```tsx
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app/page-header";
import { UsersClient, type UserRow } from "./users-client";

export const dynamic = "force-dynamic";

/** Pengguna (admin): every account, its role and status; create, change role, reset, deactivate. */
export default async function UsersPage() {
  const me = await requireRole(["admin"]);
  const { data } = await (await createClient()).from("profiles").select("id, name, username, role, active").order("active", { ascending: false }).order("name");
  return (
    <main>
      <PageHeader title="Pengguna" />
      <div className="p-4 lg:p-8"><UsersClient rows={(data ?? []) as UserRow[]} me={me.id} /></div>
    </main>
  );
}
```

(No `live` prop: the page revalidates after each action.)

`app/(app)/admin/users/users-client.tsx`:

```tsx
"use client";
import { useState } from "react";
import { UserPlus } from "lucide-react";
import { ActionMenu, MenuDanger, MenuSection } from "@/components/app/action-menu";
import { ConfirmButton } from "@/components/app/confirm-button";
import { Input, Label, Select } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { ROLES } from "@/lib/username";
import { createUser, resetPassword, setActive, setRole } from "./actions";

export type UserRow = { id: string; name: string; username: string; role: string; active: boolean };
const ROLE: Record<string, string> = { operator: "Operator", supervisor: "Supervisor", admin: "Admin" };

export function UsersClient({ rows, me }: { rows: UserRow[]; me: string }) {
  return (
    <div className="space-y-4">
      <AddUser />
      {/* Phone: cards. Desktop: a table. */}
      <ul className="space-y-2 md:hidden">
        {rows.map((u) => (
          <li key={u.id} className={cn("flex items-center gap-3 rounded-lg bg-white p-3", !u.active && "opacity-60")}>
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{u.name}{u.id === me && " (Anda)"}</span>
              <span className="block text-sm text-steel-500">{u.username} · {ROLE[u.role]} · {u.active ? "Aktif" : "Nonaktif"}</span>
            </span>
            <UserMenu u={u} self={u.id === me} />
          </li>
        ))}
      </ul>
      <div className="hidden rounded-lg bg-white md:block">
        <Table>
          <thead><tr><Th>Nama</Th><Th>Nama pengguna</Th><Th>Peran</Th><Th>Status</Th><Th /></tr></thead>
          <tbody>{rows.map((u) => (
            <tr key={u.id} className={cn(!u.active && "text-steel-500")}>
              <Td>{u.name}{u.id === me && " (Anda)"}</Td><Td>{u.username}</Td><Td>{ROLE[u.role]}</Td>
              <Td>{u.active ? "Aktif" : "Nonaktif"}</Td>
              <Td className="text-right"><UserMenu u={u} self={u.id === me} /></Td>
            </tr>
          ))}</tbody>
        </Table>
      </div>
    </div>
  );
}

function AddUser() {
  const [f, setF] = useState({ name: "", username: "", password: "", role: "operator" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <ConfirmButton title="Tambah pengguna" confirmLabel="Buat akun"
      summary={`Buat akun ${f.name || "baru"} (${f.username.trim().toLowerCase() || "nama pengguna"}) sebagai ${ROLE[f.role]}. Berikan nama pengguna dan kata sandi awal kepada orangnya.`}
      extra={
        <div className="space-y-3">
          <div><Label htmlFor="nu-name">Nama</Label><Input id="nu-name" value={f.name} onChange={set("name")} /></div>
          <div><Label htmlFor="nu-user">Nama pengguna</Label><Input id="nu-user" value={f.username} onChange={set("username")} autoCapitalize="none" spellCheck={false} placeholder="mis. ani" /></div>
          <div><Label htmlFor="nu-pass">Kata sandi awal (min. 8)</Label><Input id="nu-pass" value={f.password} onChange={set("password")} autoComplete="new-password" /></div>
          <div><Label htmlFor="nu-role">Peran</Label>
            <Select id="nu-role" value={f.role} onChange={set("role")}>{ROLES.map((r) => <option key={r} value={r}>{ROLE[r]}</option>)}</Select></div>
        </div>
      }
      onConfirm={async () => {
        const err = await createUser(f);
        if (!err) setF({ name: "", username: "", password: "", role: "operator" });
        return err;
      }}>
      <UserPlus className="h-4 w-4" />Tambah pengguna
    </ConfirmButton>
  );
}

function UserMenu({ u, self }: { u: UserRow; self: boolean }) {
  const [role, setR] = useState(u.role);
  const [pw, setPw] = useState("");
  return (
    <ActionMenu title={u.name}>
      <MenuSection>
        {!self && (
          <div><ConfirmButton size="sm" variant="outline" title={`Ubah peran ${u.name}`} confirmLabel="Simpan peran"
            summary={`${u.name} menjadi ${ROLE[role]}. Menu dan izin mengikuti peran baru saat halaman dimuat ulang.`}
            extra={<div><Label htmlFor={`role-${u.id}`}>Peran</Label>
              <Select id={`role-${u.id}`} value={role} onChange={(e) => setR(e.target.value)}>{ROLES.map((r) => <option key={r} value={r}>{ROLE[r]}</option>)}</Select></div>}
            onConfirm={() => setRole(u.id, role)}>Ubah peran</ConfirmButton></div>
        )}
        <div><ConfirmButton size="sm" variant="outline" title={`Reset kata sandi ${u.name}`} confirmLabel="Simpan kata sandi"
          summary={`Kata sandi ${u.username} diganti. Sesi yang sedang masuk tetap berjalan sampai Keluar.`}
          extra={<div><Label htmlFor={`pw-${u.id}`}>Kata sandi baru (min. 8)</Label><Input id={`pw-${u.id}`} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></div>}
          onConfirm={() => resetPassword(u.id, pw)}>Reset kata sandi</ConfirmButton></div>
      </MenuSection>
      {!self && (
        <MenuDanger>
          <div><ConfirmButton size="sm" variant={u.active ? "danger" : "outline"} title={`${u.active ? "Nonaktifkan" : "Aktifkan"} ${u.name}`}
            confirmLabel={u.active ? "Nonaktifkan" : "Aktifkan"}
            summary={u.active
              ? `${u.name} tidak bisa masuk lagi, dan sesi yang masih terbuka langsung tidak bisa melakukan apa pun. Riwayat kerjanya tetap tersimpan.`
              : `${u.name} bisa masuk lagi dengan kata sandinya.`}
            onConfirm={() => setActive(u.id, !u.active)}>{u.active ? "Nonaktifkan" : "Aktifkan"}</ConfirmButton></div>
        </MenuDanger>
      )}
    </ActionMenu>
  );
}
```

- [ ] **Step 4: Run tests, typecheck, lint**

Run: `npx tsx tests/users-actions.test.ts && npx tsx tests/home.test.ts && npm run typecheck && npm run lint`
Expected: `5 passed, 0 failed`; `6 passed, 0 failed`; clean. Append ` && tsx tests/users-actions.test.ts` to the `npm test` chain.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/admin/users" components/app/nav-config.ts lib/username.ts tests/users-actions.test.ts tests/home.test.ts package.json
git commit -m "feat(auth): Pengguna page for admins"
```

---

### Task 6: Docs, privacy text, full verification

**Files:**
- Modify: `AGENTS.md` (Environment section, Roles line), `README.md` (§2 setup, cutover), `components/app/about-copy.ts` (Privasi), `docs/superpowers/specs/2026-10-12-login-and-accounts-design.md` (note on the username lookup)
- Test: whole suite + browser check

- [ ] **Step 1: Docs**

`AGENTS.md` — replace the table rows for `SITE_ACCOUNT_EMAIL` / `SITE_ACCOUNT_PASSWORD` (remove them; "Five variables" → "Three variables") and the paragraph

```
Every visitor shares this one session, so the app opens without a login screen. Public sign-up is
disabled. Do not add per-user auth to a feature.
```

with

```
Every person signs in at `/login` with their own account: a username and password, created by an
admin on `Pengguna` (`/admin/users`). Public sign-up is disabled. A username resolves to the
account's auth email on the server (`account_email`, 0071); new accounts get
`<username>@pengguna.internal`. Roles live in `profiles` and change only through `set_user_role` /
`set_user_active` (never on yourself, always one active admin). A deactivated account has no role
(`has_role` checks `active`), even with a live token. Accounts are never deleted.
```

`README.md` §2 — replace the `SITE_ACCOUNT_*` instruction with: create the first admin (on an existing database the 0071 migration makes the shared account `gudang`; on a new one, create an auth user in the Supabase dashboard with `username` in its metadata and set its role to admin in `profiles`), then add a §2 "Cutover to personal accounts" list copied from the spec §5.

`components/app/about-copy.ts` — first item of "Apa yang dicatat" becomes:
`"Akun Anda (nama dan nama pengguna) tercatat pada setiap posting, perubahan, audit, hitung dan persetujuan yang Anda lakukan, beserta waktunya."` and the second item becomes `"Nama di kolom Nama Anda diisi otomatis dari akun Anda; tidak disimpan di perangkat."`

Spec §1 — after the "Username → hidden email" bullet add: `Ruling (plan): sign-in resolves the username to the account's existing auth email on the server (account_email, service role), so the Gudang account keeps its email and the old app keeps working between the migration and the deploy.`

- [ ] **Step 2: Full suite**

Run: `npm run typecheck && npm run lint && npm test && PGUSER=postgres scripts/sql-test.sh`
Expected: all green; every SQL file `0 FAIL`; `42_accounts.sql: 14 PASS, 0 FAIL`.

- [ ] **Step 3: Browser check (local stack, port 3100)**

Start the dev server with the local keys and **no** `SITE_ACCOUNT_*` variables. Create a local admin directly: an auth user via the local Auth admin API with `user_metadata: { name: "Admin Uji", username: "adminuji" }`, then `select set_config('request.jwt.claim.sub', …)` is not needed — set its role with `update profiles set role='admin'` as postgres (local only). Then in the browser (1440×900 and 390×844):
1. `/waves` signed out → `/login?next=%2Fwaves`; wrong password → `Nama pengguna atau kata sandi salah.`; ` AdminUji ` + password → lands on `/waves`.
2. `Pengguna`: create `opuji` (operator) and `supuji` (supervisor) with the confirmation; both listed.
3. Sign in as `opuji` (Keluar first): no Dashboard/Alokasi/Pengguna in the nav; `/admin/users` → sent away; "Nama Anda" fields show the account name.
4. Post one wave line as `opuji`; `select user_id from movements order by created_at desc limit 1` = `opuji`'s id.
5. As `adminuji`, `Nonaktifkan` `opuji`; in the other browser context where `opuji` is still signed in, reload → `/login?nonaktif=1`; signing in as `opuji` fails.
6. `adminuji` cannot change or deactivate their own account (no menu rows); `Reset kata sandi` on self works.
7. `/login?next=//evil.com` and `/login?next=%2F%09%2Fevil.com` signed in → `/`.
8. Six wrong passwords for `supuji` → the sixth answer is `Terlalu banyak percobaan…`; the right password is refused too until the 15 minutes pass (clear with `delete from login_failures` locally to continue).
Clean up: kill the dev server by PID, delete the local test users, `git checkout -- tsconfig.json`, `rm -rf .next/claude-dev`.

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md README.md components/app/about-copy.ts docs/superpowers/specs/2026-10-12-login-and-accounts-design.md
git commit -m "docs(auth): personal accounts, cutover, privacy text"
```

---

## Revision (2026-10-12): switch and review fixes — tasks 7 and 8 run before Task 5

### Task 7: Review fixes — fail-closed limit, lockout per username and IP

**Files:** `supabase/migrations/0071_accounts.sql` (not pushed: edited in place), `supabase/tests/42_accounts.sql`, `app/login/actions.ts`, `tests/login-wiring.test.ts`.

- `login_allowed(p_username text, p_ip text) returns boolean`, `login_result(p_username text, p_ip text, p_ok boolean) returns void`; `login_failures` keyed `(username, ip)`. A key locks for 15 minutes after 5 wrong passwords; a username locks for every IP after 30 wrong passwords across IPs within 15 minutes. A success clears that key only.
- Test 42 rows: 5 wrong from IP A lock A but not B; 30 wrong across 6 IPs lock the username for a 7th IP; a success clears its own key.
- `loginAction`: client IP from `x-forwarded-for` (first entry) else `x-real-ip` else `unknown`; `if (error || allowed !== true)` → refuse with `Masuk sedang tidak bisa. Coba lagi sebentar lagi.` (fail closed). Wiring test row: the action refuses unless `allowed === true`.

### Task 8: The switch (`LOGIN_REQUIRED`)

**Files:** `lib/auth-route.ts`, `tests/auth-route.test.ts`, `middleware.ts`, `app/keluar/route.ts`, `components/app/account.tsx`, `app/login/page.tsx`, `.env.example`, `tests/login-wiring.test.ts`.

- `authRoute(path: string, search: string, signedIn: boolean, required: boolean): { kind: "continue" } | { kind: "redirect"; to: string } | { kind: "shared" }` replaces `authRedirect`.
  - required: as before (signed out → `/login?next=`, signed in on `/login` → `safeNext`).
  - not required: signed out on a non-public path → `shared` (middleware signs in as the site account and redirects to the same URL); `/login` and `/keluar` → continue whether signed in or not.
- `loginRequired()` in `lib/auth-route.ts` reads `process.env.LOGIN_REQUIRED === "true"`.
- `/keluar` redirects to `/login` when required, to `/` (shared account) when not.
- Account menu: when not required, a link `Masuk sebagai akun lain` to `/login`; the login page says `Login belum diwajibkan: tanpa masuk, situs memakai akun bersama.` when not required.
- `.env.example` gets `LOGIN_REQUIRED=` and the site-account lines back (used while it is off).
- Tests: `auth-route` rows for both modes; wiring rows: middleware signs in with the site account only on `kind === "shared"`.
