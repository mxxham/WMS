# CKB 3PL application routing over the shared login — design

Date: 2026-10-20 · Status: implemented (authentication/access only; CKB operational modules are not built)

## Why

The same login now fronts two applications: the Shell WMS (today's `(app)` route group) and a new
CKB 3PL app for CKB Warehouse 5 (Freeport, CGP, SIP, MNE, Boiler, SSB). One login page stays;
after signing in the server routes each account to the application it is authorized for. App
access is separate from operational roles — a CKB supervisor does not thereby get Shell, and no
role grants CKB by itself.

## Decisions (from the user)

- **Storage: columns on `profiles`** (`apps text[]`, `default_app text`), not a second table —
  smallest change, reuses the 0071 account model and its RPC-guard pattern.
- **Admins may change app access on their own account** (exception to 0071's not-on-yourself rule).
  That rule exists to keep exactly one active admin; app access does not touch it. `set_user_role`
  and `set_user_active` keep their strict not-on-yourself check.

## Schema (migration 0080)

- `profiles.apps text[] not null default array['shell_wms']`, `profiles.default_app text`.
- CHECK `profiles_apps_allowed`: `apps <@ array['shell_wms','ckb_3pl']::text[]` — arbitrary app ids
  are impossible at write time.
- CHECK `profiles_default_app_allowed`: `default_app is null or default_app = any(apps)`.
- Backfill policy: every existing user keeps exactly `shell_wms`, default `shell_wms` — current
  Shell access is preserved; nobody is given `ckb_3pl` automatically.
- RPC `set_user_apps(p_user, p_apps, p_default_app)` — SECURITY DEFINER, admin-only
  (`has_role('{admin}')` + advisory 'accounts' lock), target must exist, no not-on-yourself check,
  normalises (trim/lowercase/dedupe) and validates ids, requires a default when both apps are
  granted, repairs the default to the remaining app on revocation (0 apps ⇒ null). Reads of the
  columns ride the table's existing grants/policies (any active authenticated user can already
  read profiles; nothing new is exposed).

## Routing

- `lib/apps.ts` (pure): `resolveAppsHome(apps, defaultApp)` — empty → `/akses`; one app → its home
  (`shell_wms` → `/`, the existing role-based land: operator → `/scan`, else `/dashboard`;
  `ckb_3pl` → `/ckb`); both → the configured default, with a stale/missing default falling back
  to `/` (deterministic; the RPC normally makes that state impossible).
- `app/login/actions.ts`: an explicit same-origin `?next=` still wins (unchanged deep-link rule);
  otherwise the server reads the signed-in profile's `apps`/`default_app` (service client) and
  redirects to the resolved home, with a fail-closed default of `/akses` on any read error. The
  redirect call sits *outside* the try/catch — `redirect()` throws, and swallowing it would send
  every sign-in to `/akses`.
- `app/(app)/layout.tsx` calls `requireAppAccess("shell_wms")`: a CKB-only account is sent to
  `/ckb`, an account with no app to `/akses`. `app/ckb/layout.tsx` calls
  `requireAppAccess("ckb_3pl")`. Both are inside the layouts, so direct URL entry is checked
  server-side, not in the browser.
- `requireRole`/`checkRole` gained an `app = "shell_wms"` parameter, so every existing page and
  API route enforces Shell access with no per-file edits; CKB pages pass `ckb_3pl`.
- `app/akses/page.tsx` denies clearly, and routes an account that has *since* been granted access
  to its app home instead of a false denial.

## Session / revocation model

Unchanged from 0071: identity is the Supabase JWT; authorization is re-read from the database on
every request (now including app access, like `active` and roles). Revoking an app takes effect on
the caller's next request, with or without a token refresh. Middleware itself is untouched —
sign-in, lockout, logout, and shared-account behaviour behave exactly as before.

## Enforcement points

Pages and layouts (layouts cover direct URL entry), all API route handlers (`checkRole` default),
and server actions (`admin()`/`checkRole`, plus defense-in-depth validation of app ids in
`setUserApps` before the RPC — the CHECK constraint is the last guard). Hiding nav links was never
the auth layer.

## Tests

`tests/apps-routing.test.ts` (resolver matrix, normalisation, chain entry added),
`tests/login-wiring.test.ts` (wiring assertions for the gates and the fail-closed redirect),
`supabase/tests/23_user_apps.sql` (14 PASS/FAIL assertions, rollback: backfill, both CHECKs, RPC
permissions, self-grant, default rules and repairs). Full suite, typecheck, lint, and build run
at implementation time.

## Not in scope

Everything operational for CKB 3PL (rebagging, cargo inspection, stock take, SAP import/export,
reporting, photo archiving), CKB navigation of its own, and any CKB data model. The `/ckb` screen
is an entry point that says the app is being prepared.
