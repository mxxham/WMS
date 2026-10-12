# Login and personal accounts — design

Date: 2026-10-12 · Status: approved by the user ("looks good")

## Why

Since 24 Sep every visitor is signed into one shared admin account ("Gudang") by the middleware.
The database already forces the signed-in account as the author of every movement, but with one
shared account the audit trail can only rely on names typed by hand, and anyone with the address
can use the site. The user asked for a login page with a role per login.

## Decisions (from the user)

- **One account per person** — every picker, checker, supervisor and admin has their own login.
- **Username + password** — no email needed; the admin creates accounts and resets passwords.
- Roles stay `operator`, `supervisor`, `admin` (`profiles.role`, `has_role()`, RLS) — unchanged.

## 1. Sign in

- `/login` (Indonesian, app theme, brand from `config/brand.ts`): `Nama pengguna`, `Kata sandi`,
  `Masuk`. A failed attempt says `Nama pengguna atau kata sandi salah.` (never which one).
  `?next=` returns to the page that was asked for (same-origin paths only).
- **Username → hidden email.** Supabase Auth signs in by email. A username maps to
  `<username>@pengguna.internal` (one function, `lib/username.ts`, used by login and account
  creation). Usernames: 3–32 chars, lowercase `a-z 0-9 . _ -`, stored lowercase; input is trimmed
  and lowercased before mapping. Users never see the internal address.
- **Middleware**: no automatic sign-in. A request without a valid session (checked with
  `getClaims()`, as today) goes to `/login?next=<path>`. Public: `/login` and static files. A
  signed-in user opening `/login` goes to `/`. `SITE_ACCOUNT_EMAIL` / `SITE_ACCOUNT_PASSWORD` are
  no longer read (remove from `.env.example` and docs; the user removes them from Vercel later).
- Sessions persist until `Keluar` (Supabase refresh tokens).
- A deactivated account cannot sign in (Supabase ban) and its existing session stops at the next
  token refresh; pages also refuse a profile marked inactive.

## 2. Accounts in the database (migration 0071)

- `profiles.username text unique` (lowercase check), `profiles.active boolean not null default true`.
- Backfill: the existing Gudang profile (`5e853334-…`) gets `username = 'gudang'`, role `admin`.
  Other existing profiles get a username derived from their email local part (deduplicated);
  the migration reports them.
- `handle_new_user` copies `username` from `raw_user_meta_data` when present.
- `has_role()` also requires `active` (an inactive account can do nothing, even with a live token).
- RPCs for the `Pengguna` page, all `security definer`, admin-only via `has_role(admin)`:
  `set_user_role(p_user, p_role)`, `set_user_active(p_user, p_active)`. Both refuse acting on
  yourself and refuse leaving zero active admins. Creating an account and setting passwords use the
  Auth admin API from a server action (service role, after `checkRole(["admin"])`), because
  passwords live in Supabase Auth, not in tables.
- Accounts are never deleted (movements reference them).

## 3. `Pengguna` page (`/admin/users`, admin only, in the Admin nav section)

- Table (cards on a phone): name, username, role, status (`Aktif` / `Nonaktif`).
- `Tambah pengguna`: name, username, starting password (min 8), role → confirmation sentence.
- Per user (menu, each with a confirmation): `Ubah peran`, `Reset kata sandi` (admin types the new
  one), `Nonaktifkan` / `Aktifkan`. Not offered on yourself.
- Errors in Indonesian (username taken, invalid username, password too short, last admin).

## 4. In the app

- **Who is signed in, and `Keluar`**: bottom of the sidebar (desktop) and in the page header
  (phone), name + role; `Keluar` signs out and goes to `/login`.
- **"Nama Anda" fields** (`usePersonName`, 51 uses) start with the account's name instead of the
  device's last typed name; still editable, so no RPC changes. The account name comes from a small
  client context filled by the app layout.
- `lib/auth.ts` keeps `getSessionUser` / `requireRole` / `checkRole`; `getSessionUser` returns null
  for an inactive profile and adds `username`.
- Welcome screen: never on `/login` (it is outside the app layout already); shown after sign-in.
- `Privasi`: states that each person's account is recorded with their actions.
- AGENTS.md: replace "Every visitor shares this one session … Do not add per-user auth" with the
  new model; README setup and §1 updated; `.env.example` without the site account.

## 5. Cutover (user runs the push/deploy, as always)

1. `supabase db push` (0068–0071). Nothing visible changes yet; `gudang` is now admin with a username.
2. Set a known password for `gudang` (script or Supabase dashboard) and, on the old site, nothing
   changes; on a local or preview build, sign in as `gudang` and create everyone's accounts.
   (Accounts are rows in the live database, so creating them from a preview deployment pointed at
   it is fine.)
3. Deploy the app: the login page appears; people sign in with the accounts they were given.

## 6. Testing

- SQL test `42_accounts.sql`: username unique + lowercase; `set_user_role` / `set_user_active`
  admin-only, refuse self, refuse removing the last active admin; `has_role` false for an inactive
  profile; new auth user with `username` metadata gets it in `profiles`.
- `tests/username.test.ts`: validation and the username → internal email mapping.
- `tests/login-redirect.test.ts`: the middleware rule as a pure function (`lib/auth-route.ts`):
  public paths, `next` handling (no open redirect), signed-in on `/login`.
- Browser check (local stack): wrong password, correct sign-in, `next` returns to the page,
  operator vs supervisor vs admin navigation and page refusal, `Keluar`, admin creates a user who
  signs in, deactivated user refused, a posting records the signed-in account as author, phone
  width.

## Out of scope

Self-service password change and "forgot password" (the admin resets); removing the typed-name
fields and `p_by_name` from RPCs (later, once accounts are in use); PINs; SSO.
