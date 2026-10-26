# Flowchart Roles and Shipment Assignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seven job roles from the Tim Shell flowchart, each seeing only its pages, and a `Penugasan`
page where Inventory assigns each shipment to one Operator/Picker, whose `Wave` page then shows only
their shipments.

**Architecture:** A new `profiles.job` column; the existing `profiles.role` level is kept in step by a
trigger, so the ~210 `has_role` checks stay unchanged. One page table in `nav-config.ts` drives the
menu, the Home cards and a server-side `requirePage()`. Assignments live in `shipment_assignments`
keyed on day + shipment number; a trigger on `pick_tasks` status changes is the single place that
refuses an operator posting a shipment that is not theirs.

**Tech Stack:** Next.js 15 App Router (RSC), React 19, TypeScript strict, Supabase / PostgreSQL 16,
tsx standalone tests, psql SQL tests.

**Spec:** `docs/superpowers/specs/2026-10-26-flowchart-roles-and-assignment-design.md` (approved
27 Oct 2026). Read it before any task; the page table there is the source of truth.

## Global Constraints

- Migrations continue at `0109`; never edit a migration that exists already (`0001`–`0108`).
- New tables: RLS on, read policy `using ((select public.is_active()))`, **no write policy**; writes
  only through SECURITY DEFINER RPCs with a role check. Explicit grants (0005 pattern):
  `grant select ... to authenticated; grant all ... to service_role`;
  `revoke execute ... from public, anon; grant execute ... to authenticated` on every new RPC.
- Never touch `waves`, `pick_tasks` rows, `outbound`, the allocator, FEFO, `Sisa` or print order —
  assignment only decides who sees and who posts.
- Job values, exactly: `admin_inbound`, `admin_outbound`, `checker`, `inventory`, `operator`, `leader`,
  `admin`. Display names: `Admin Inbound`, `Admin Outbound`, `Checker`, `Inventory`,
  `Operator / Picker`, `Leader`, `Admin`.
- Job → level: `admin`→`admin`; `leader`,`admin_inbound`,`admin_outbound`,`inventory`→`supervisor`;
  `checker`,`operator`→`operator`. Legacy level → job (direct `role` writes): `admin`→`admin`,
  `supervisor`→`leader`, `operator`→`operator`.
- Assigners: jobs `inventory`, `leader`, `admin`. Assignees: active accounts with job `operator` and
  `shell_wms` in `apps`.
- UI strings Indonesian, code/comments English. Every action has a confirmation with a summary
  sentence. Cards on phone, table on desktop. No emojis.
- Exact copy: empty Wave `Belum ada shipment yang ditugaskan ke Anda.`; posting refusal
  `Shipment % tidak ditugaskan ke Anda`; confirm `Tugaskan shipment <no> ke <nama>?`; statuses
  `Belum`, `Dipicking`, `Selesai`, `Dimuat`.
- Every new TS test file follows AGENTS.md's inline `test()` shape, exits non-zero on failure, and is
  added to the `npm test` chain in `package.json`. SQL tests print PASS/FAIL per row and roll back.
- CKB (`/ckb`, `ckb_*`) is untouched.

## Review Focus

1. **An operator posts a pick whose paired Bin To Bin belongs to another wave** (pallet rest moved
   for another shipment) — the whole posting is refused with `Shipment % tidak ditugaskan ke Anda`
   and nothing is half-posted. Test in Task 2.
2. **An operator is moved to another job (or deactivated) while holding open shipments** — their open
   assignments are released (logged), so Penugasan shows them as `Belum ditugaskan` instead of
   pointing at someone who can no longer pick. Test in Task 2.
3. **Re-running Alokasi after assigning** — `save_plan` replaces the wave (new `wave_id`), the
   operator still sees the shipment. Test in Task 2.
4. **Shared `gudang` account and every non-operator job** post exactly as before. Test in Task 2.
5. **A route nobody listed** — every `page.tsx` under `app/(app)` is covered by the page table, so a
   new page cannot silently be open to all or none. Test in Task 3.

---

### Task 1: Jobs in the database (`0109_jobs.sql`)

**Files:**
- Create: `supabase/migrations/0109_jobs.sql`
- Test: `supabase/tests/71_jobs.sql` (shape and helpers as `supabase/tests/42_accounts.sql`)

**Interfaces:**
- Produces: column `profiles.job text not null default 'operator'` with check on the 7 values;
  `public.job_level(p_job text) returns public.user_role` (immutable);
  `public.my_job() returns text` (stable, security definer: the caller's job, null without account);
  `public.has_job(p_jobs text[]) returns boolean` (active account whose job is in the list);
  `public.set_user_job(p_user uuid, p_job text) returns void`.

- [ ] **Step 1: Write the failing test** `supabase/tests/71_jobs.sql`. Rows (each a `pg_temp.check`):
  - `job_level`: `admin_inbound`→`supervisor`, `checker`→`operator`, `admin`→`admin`, all 7 mapped.
  - backfill: every existing profile with role `supervisor` has job `leader`; `operator`→`operator`;
    `admin`→`admin`.
  - an `auth.users` insert gives a profile with job `operator`, role `operator`.
  - `update profiles set job = 'admin_inbound'` → role becomes `supervisor`.
  - legacy `update profiles set role = 'supervisor'` on an operator → job becomes `leader`;
    `role = 'operator'` → job `operator`.
  - a job not in the list fails (check constraint).
  - as an admin (`pg_temp.as_user`), `set_user_job(other, 'checker')` works; on yourself fails with
    `Tidak bisa mengubah akun Anda sendiri%`; as a non-admin fails with `Hanya admin%`; moving the last
    active admin to `leader` fails with `Harus ada minimal satu admin aktif%`.
  - `set_user_role` is not executable by `authenticated`
    (`not has_function_privilege('authenticated', 'public.set_user_role(uuid, public.user_role)', 'execute')`).
  - placeholder mapping: `public.placeholder_job('admin.inbound') = 'admin_inbound'`,
    `placeholder_job('leader') = 'leader'`, `placeholder_job('budi') is null` (the migration's one-off
    update uses this function, so testing it tests the update).

- [ ] **Step 2: Run it to see it fail**
  Run: `scripts/sql-test.sh supabase/tests/71_jobs.sql`
  Expected: errors / FAIL (no `job` column).

- [ ] **Step 3: Write `0109_jobs.sql`**
  Header comment in the house style (what, why, 26 Oct flowchart decision). Contents:
  - add `job`, backfill from `role` with the legacy mapping, then add the check.
  - `placeholder_job(username)` (immutable sql) and an update setting jobs for usernames
    `admin.inbound`, `admin.outbound`, `checker`, `inventory`, `operator`, `leader` (absent ones simply
    match nothing). Keep `placeholder_job` (test reads it).
  - trigger `profiles_job_level` BEFORE INSERT OR UPDATE OF job, role: if `job` changed (or insert) →
    `new.role := job_level(new.job)`; else if `role` changed → `new.job` from the legacy mapping.
    Must run before 0105's `profiles_keep_shell_admin` (that one is AFTER, so it sees the final row).
  - `set_user_job`: `perform public.accounts_guard(p_user)` (0071: admin only, not yourself), validate
    job, update, then the same "minimal satu admin aktif" check as `set_user_role`.
  - `my_job`, `has_job`; revoke `set_user_role` from `authenticated`; grants per Global Constraints.

- [ ] **Step 4: Run the new and the account tests**
  Run: `scripts/sql-test.sh supabase/tests/71_jobs.sql supabase/tests/42_accounts.sql`
  Expected: every row PASS (42 runs as the database owner, so the revoke does not affect it).

- [ ] **Step 5: Run all SQL tests** — `scripts/sql-test.sh`; expected: no FAIL, no ERROR.

- [ ] **Step 6: Commit**
  `git add supabase/migrations/0109_jobs.sql supabase/tests/71_jobs.sql`
  `git commit -m "feat(accounts): seven flowchart jobs with the role level derived (0109, test 71)"`

---

### Task 2: Shipment assignment in the database (`0110_shipment_assignments.sql`)

**Files:**
- Create: `supabase/migrations/0110_shipment_assignments.sql`
- Test: `supabase/tests/72_shipment_assignments.sql`

**Interfaces:**
- Consumes: `my_job()`, `has_job(text[])` (Task 1).
- Produces:
  - table `shipment_assignments (planned_date date, shipment_number text, user_id uuid references
    profiles(id), assigned_by uuid, assigned_by_name text not null, assigned_at timestamptz default now(),
    primary key (planned_date, shipment_number))`.
  - table `shipment_assignment_log (id uuid pk, planned_date, shipment_number, user_id uuid null,
    action text check in ('ASSIGN','UNASSIGN','RELEASE'), by_name text, created_at)`, append-only
    (update/delete refused by trigger, as 0099's `ckb_forbid_change` pattern).
  - `assign_shipment(p_date date, p_shipment text, p_user uuid, p_by_name text) returns void`
  - `unassign_shipment(p_date date, p_shipment text, p_by_name text) returns void`
  - `shipment_assigned_to_me(p_wave_id uuid, p_shipment text) returns boolean` — `p_shipment` null
    (REPLENISH) = any shipment of that wave is assigned to the caller.
  - `assignment_board(p_date date)` returns rows `(wave_id uuid, wave_no text, shipment_number text,
    planned_slot text, truck text, fl_lines int, hp_lines int, status text, user_id uuid,
    user_name text)` — one row per shipment of the day's waves, status in
    `Belum|Dipicking|Selesai|Dimuat` (Dimuat = `shipment_loads` row; Selesai = wave `COMPLETED` or no
    `PLANNED` task left; Dipicking = some task `COMPLETED`; else Belum). FL/HP = count of `PICK` tasks with `pick_type = 'PALLET'` / `'CASE'` (the split
    `picklist-from-tasks.ts:217` uses).
  - `assignable_operators()` returns `(id uuid, name text, username text, open_count int)`.

- [ ] **Step 1: Write the failing test** `supabase/tests/72_shipment_assignments.sql`, using a wave
  and tasks created through `save_plan` with a small plan (copy the fixture style of the existing
  wave tests, e.g. `supabase/tests/*pick_line*.sql`). Rows:
  - as `inventory`: `assign_shipment` works and writes one `ASSIGN` log row; as `checker` fails
    `Hanya Inventory, Leader atau Admin%`; assigning to a `checker` account fails
    `Hanya akun Operator%`; assigning a loaded shipment fails `Shipment % sudah dimuat%`.
  - reassign to a second operator replaces the row and logs `ASSIGN` again; `unassign_shipment` logs
    `UNASSIGN`.
  - as the assigned operator: `post_task_by` on a PICK of that shipment succeeds.
  - as another operator: the same call fails `Shipment % tidak ditugaskan ke Anda%`, and
    `complete_wave` on that wave fails the same way.
  - Review Focus 1: an operator posting via `post_pick_with_move` where the move task belongs to a
    different, unassigned wave fails, and the PICK task is still `PLANNED` afterwards.
  - Review Focus 3: after a second `save_plan` for the same date (wave untouched → replaced, new id),
    `shipment_assigned_to_me(new_wave_id, shipment)` is true for the operator.
  - Review Focus 4: as `gudang`-style admin and as `leader`, posting an unassigned shipment works.
  - Review Focus 2: `set_user_job(operator, 'checker')` releases their assignments on shipments not
    `Selesai`/`Dimuat` (row gone, `RELEASE` log row); same for `set_user_active(operator, false)`.
  - `assignment_board(date)` returns the shipment with status `Belum`, then `Dipicking` after one
    posted task, with `user_name` of the assignee.
  - log rows cannot be updated or deleted.

- [ ] **Step 2: Run to see it fail** — `scripts/sql-test.sh supabase/tests/72_shipment_assignments.sql`

- [ ] **Step 3: Write `0110_shipment_assignments.sql`**
  - Tables, RLS, grants per Global Constraints; add both tables to `supabase_realtime` with the 0015
    guarded loop.
  - The guard: trigger `pick_tasks_assignment_guard` BEFORE UPDATE OF status ON `pick_tasks`, when
    `old.status is distinct from new.status`: if `auth.uid()` is null → allow; if `my_job()` is not
    `operator` → allow; else require `shipment_assigned_to_me(new.wave_id, new.shipment_number)`, else
    `raise exception 'Shipment % tidak ditugaskan ke Anda', coalesce(new.shipment_number, <first
    shipment of the wave>)`. This one trigger covers `post_task`, `post_task_by`, `post_pick_line`,
    `post_pick_with_move`, `post_task_found_elsewhere`, `complete_wave` and every future path.
  - Release: trigger AFTER UPDATE OF job, active ON `profiles` when
    `old.job = 'operator' and (new.job <> 'operator' or not new.active)`: delete that user's
    assignments whose board status is not `Selesai`/`Dimuat`, log `RELEASE`.
  - RPCs with the role check `has_job(array['inventory','leader','admin'])`, person name via
    `public.person_name(p_by_name)` as other RPCs do.

- [ ] **Step 4: Run** — `scripts/sql-test.sh supabase/tests/72_shipment_assignments.sql`; all PASS.

- [ ] **Step 5: Run all SQL tests** — `scripts/sql-test.sh`; no FAIL, no ERROR (existing wave tests
  post as owner or non-operator, so the guard must not change them; if one fails, the fixture is
  posting as an operator account — fix the guard, not the old test).

- [ ] **Step 6: Commit**
  `git commit -m "feat(waves): assign a shipment to one operator, posting refused for others (0110, test 72)"`

---

### Task 3: One page table for jobs (`lib/jobs.ts`, `nav-config.ts`)

**Files:**
- Create: `lib/jobs.ts`
- Modify: `components/app/nav-config.ts`, `components/app/nav.tsx`, `components/home/home-page.tsx`,
  `lib/types.ts` (add `Job`)
- Create test: `tests/jobs-pages.test.ts`; Modify: `tests/home.test.ts`; `package.json` test chain

**Interfaces:**
- Produces (`lib/jobs.ts`): `type Job = 'admin_inbound'|'admin_outbound'|'checker'|'inventory'|'operator'|'leader'|'admin'`;
  `JOBS: readonly Job[]` (that order); `JOB_LABEL: Record<Job, string>`;
  `jobLevel(j: Job): Role`.
- Produces (`nav-config.ts`): `NavLink` gets `jobs: Job[]` instead of `roles`; `sectionsFor(job: Job)`,
  `mobileLinksFor(job: Job)`, `homePrimary(job: Job)`; new
  `pageAllowed(job: Job, path: string): boolean` and `OPEN_PATHS = ['/home', '/lisensi', '/privasi']`.
  New link `{ href: '/assign', label: 'Penugasan', icon: UserCheck, jobs: ['inventory','leader','admin'] }`
  in section `Operasional` after `Wave`.
- `pageAllowed` rules: open paths → true; else the **longest** link `href` that equals `path` or is a
  prefix followed by `/` decides (`/labels/pallet` wins over `/labels`); `/bin/...` follows `/scan`;
  `/audit` (index) → allowed when either audit link is; no match → false.

- [ ] **Step 1: Write the failing test** `tests/jobs-pages.test.ts`:
  - for each of the 7 jobs, the set of hrefs from `sectionsFor(job)` equals the spec's table exactly
    (write the 7 expected arrays out from the spec; `/assign` for inventory, leader, admin).
  - `pageAllowed('operator', '/waves')` true; `('operator', '/counts')` false;
    `('admin_inbound', '/allocate')` false; `('admin_inbound', '/labels/pallet')` true;
    `('checker', '/audit/picking/abc/123')` true; `('operator', '/bin/CA01A01')` true;
    `('checker', '/home')` true; `('leader', '/admin/users')` false; `('admin', '/admin/users')` true.
  - Review Focus 5: walk `app/(app)` for every `page.tsx` (fs, skip route groups' parentheses, turn
    `[x]` into a sample segment `x`) and assert at least one job is allowed each route and `admin` is
    allowed every route.
  - `mobileLinksFor('operator')` = `['/scan','/waves','/inventory','/warehouse']`;
    `homePrimary('operator')` = Scan, `homePrimary('inventory')` = dashboard.
- [ ] **Step 2: Run it to see it fail** — `npx tsx tests/jobs-pages.test.ts`
- [ ] **Step 3: Implement** `lib/jobs.ts` and the `nav-config.ts` changes; update `nav.tsx` and
  `home-page.tsx` to take `job`; rewrite `tests/home.test.ts` calls from roles to jobs
  (`supervisor`→`leader`).
- [ ] **Step 4: Run** — `npx tsx tests/jobs-pages.test.ts && npx tsx tests/home.test.ts`; both pass.
- [ ] **Step 5: Add `tests/jobs-pages.test.ts` to the `npm test` chain**; `npm run typecheck` (it fails
  in the callers fixed in Task 4 — commit together with Task 4 if typecheck must be green per commit;
  otherwise commit now).
- [ ] **Step 6: Commit** `feat(nav): one page table per flowchart job`

---

### Task 4: Server gate and session job

**Files:**
- Modify: `lib/auth.ts`, `app/(app)/layout.tsx`, every `app/(app)/**/page.tsx` that calls
  `requireRole`, and `app/api/**` Shell routes only where they gate a page's data by role (leave
  RPC-level checks as they are).
- Test: extend `tests/jobs-pages.test.ts`

**Interfaces:**
- Consumes: `pageAllowed`, `Job` (Task 3).
- Produces: `SessionUser.job: Job` (read `profiles.job`); `requirePage(path: string): Promise<SessionUser>`
  — same redirects as `requireRole` (no user → `/keluar?nonaktif=1`, no `shell_wms` → app home), not
  allowed → `/?denied=1`. `requireRole` stays for non-page uses.

- [ ] **Step 1: Write the failing test** — in `tests/jobs-pages.test.ts`: every `page.tsx` under
  `app/(app)` except the open paths contains `requirePage(` and none contains `requireRole(`
  (static file read).
- [ ] **Step 2: Run to see it fail.**
- [ ] **Step 3: Implement** `requirePage`; replace each page's `requireRole([...])` with
  `requirePage("<that page's route>")` (dynamic segments: pass the static parent, e.g.
  `"/receiving"` for `/receiving/[id]`); pass `user.job` to `Nav` in the layout. Pages keep using
  `user.role` for what a user may *do* inside the page.
- [ ] **Step 4: Run** — `npx tsx tests/jobs-pages.test.ts`, `npm run typecheck`, `npm run lint`.
- [ ] **Step 5: Manual check (local)** — `npm run dev` with `LOGIN_REQUIRED=true` in `.env.local`,
  local DB migrated (`supabase migration up --local`): sign in as `admin.inbound` → menu matches the
  spec row, `/allocate` redirects to `/?denied=1`; as `checker` → `/receiving` opens, `/adjust` denied.
- [ ] **Step 6: Commit** `feat(auth): pages gated by job on the server`

---

### Task 5: Pengguna shows and sets jobs

**Files:**
- Modify: `app/(app)/admin/users/actions.ts`, `users-client.tsx`, `page.tsx`, `lib/username.ts`
  (`newUserError` validates `job` against `JOBS` instead of `ROLES`)
- Test: `tests/users-actions.test.ts`, `tests/username.test.ts`

**Interfaces:**
- Consumes: `JOBS`, `JOB_LABEL` (Task 3); RPC `set_user_job` (Task 1).
- Produces: `createUser(i: { name; username; password; job: Job })`, `setJob(id: string, job: Job)`
  (replaces `setRole`; same `admin()` and `sharedGuard` checks).

- [ ] **Step 1: Update tests first** — `newUserError` rejects `job: 'supervisor'` with
  `Peran tidak dikenal.` and accepts `'checker'`; `tests/users-actions.test.ts` asserts actions call
  `set_user_job` and no longer `set_user_role` (follow how that file inspects actions today).
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement** — role column shows `JOB_LABEL[job]`; the add form and the row menu offer
  the 7 jobs; a filter by job above the list.
- [ ] **Step 4: Run** — both tests, `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(accounts): Pengguna manages the seven jobs`

---

### Task 6: Wave page shows only the operator's shipments

**Files:**
- Modify: `app/(app)/waves/page.tsx`, `app/(app)/waves/waves-client.tsx` (empty state),
  `components/app/live-refresh.tsx` (`LiveTable` += `'shipment_assignments'`)
- Create: `lib/assigned-waves.ts`; Test: `tests/assigned-waves.test.ts`

**Interfaces:**
- Consumes: `shipment_assignments` (Task 2), `SessionUser.job` (Task 4).
- Produces: `filterToAssigned<W extends { id: string; shipment_numbers: string[] }>(waves: W[],
  assigned: Set<string>): W[]` — keeps waves with any shipment number in `assigned`;
  `keepWaveIds(ids: Set<string>, rows: { wave_id: string | null }[])` for tasks, outbound, problems,
  DO rows.

- [ ] **Step 1: Write the failing test** `tests/assigned-waves.test.ts`: two waves, one assigned →
  only it remains; tasks/outbound/problem rows of the other wave are dropped; empty set → empty.
- [ ] **Step 2: Run to see it fail.**
- [ ] **Step 3: Implement** — in `page.tsx`, when `user.job === 'operator'`, read the caller's
  `shipment_assignments` for `date` and filter every dataset with the helpers before passing them to
  `WavesClient`; the day arrows only move between days that have an assignment for them. In
  `waves-client.tsx`, when the operator has no waves, show
  `Belum ada shipment yang ditugaskan ke Anda.` instead of the "no waves for this day" text. Add
  `'shipment_assignments'` to the Wave page's live tables.
- [ ] **Step 4: Run** — test, typecheck; manual: as `operator` with nothing assigned the page shows
  the sentence; after assigning on Task 7's page (or via SQL locally) the shipment appears live.
- [ ] **Step 5: Commit** `feat(waves): operators see only their assigned shipments`

---

### Task 7: Penugasan page (`/assign`)

**Files:**
- Create: `app/(app)/assign/page.tsx`, `app/(app)/assign/assign-client.tsx`, `app/(app)/assign/actions.ts`
- Test: `tests/assign-board.test.ts` (pure helpers only)

**Interfaces:**
- Consumes: `assignment_board(p_date)`, `assignable_operators()`, `assign_shipment`,
  `unassign_shipment` (Task 2); `requirePage('/assign')` (Task 4).
- Produces: `assignConfirm(shipment: string, name: string): string` →
  `Tugaskan shipment ${shipment} ke ${name}?`; `unassignConfirm(shipment, name)` →
  `Lepas shipment ${shipment} dari ${name}?`; `canAssign(status): boolean` (false for `Selesai`,
  `Dimuat`).

- [ ] **Step 1: Write the failing test** — the three helpers with the exact strings above.
- [ ] **Step 2: Run to see it fail.**
- [ ] **Step 3: Implement** the page per the spec's approved sketch: day picker (reuse the Wave
  page's `day-bar.tsx` behaviour/date param), operator counts line from `assignable_operators()`,
  table on desktop / cards on phone with NO, Shipment, Slot, Truck, FL, HP, Status, Operator;
  `Tugaskan` (dropdown + confirm), `Ganti`, `Lepas`; empty day → `Tidak ada shipment pada tanggal ini.`;
  `LiveRefresh` on `shipment_assignments`, `pick_tasks`, `waves`, `shipment_loads`. Person name from
  the session (personal accounts) as other actions do. Errors from the RPC shown as-is.
- [ ] **Step 4: Run** — test, `npm run typecheck`, `npm run lint`, `npm run build`; manual: as
  `inventory` assign a shipment to `operator`, sign in as `operator` in another browser, see it on
  `Wave`, post a line; as a second operator account the same line is refused with the spec sentence.
- [ ] **Step 5: Commit** `feat(assign): Penugasan page for Inventory, Leader and Admin`

---

### Task 8: Docs and full verification

**Files:**
- Modify: `AGENTS.md` (Roles line → the 7 jobs and their pages, pointer to the spec; migration count),
  `README.md` (Features row for Penugasan, Phase list `0109`–`0110`, accounts section)

- [ ] **Step 1: Update the docs** (English; on-screen names in backticks).
- [ ] **Step 2: Full run** — `npm run typecheck && npm run lint && npm test && scripts/sql-test.sh`;
  expected: all green, every SQL row PASS.
- [ ] **Step 3: Commit** `docs(readme): flowchart jobs and Penugasan`
- [ ] **Step 4: Hand-off note for the user** — live needs `supabase db push` (0109, 0110) and a
  deploy, run by the user; the live placeholder accounts get their jobs from 0109 automatically.
