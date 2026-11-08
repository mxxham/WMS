# Rak & Lokasi Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One `Rak & Lokasi` page (`/racks`) where every rack position gets a state (`Aktif` / `Diblokir` / `Tidak ada` / `Rencana`) and an owner (`Shell` / `CKB 3PL`), new racks are planned and activated, and every part of Shell that chooses or counts bins follows those two facts from the database.

**Architecture:** Migration 0132 adds `bins.block_kind`, `bins.block_reason`, `bins.owner`, an append-only `bin_changes` history, one usability function `bin_usable`, role-checked preview/apply RPCs, ledger refusals in `apply_movement`, and makes the read views (empty bins, bin summary, dashboard, planning stock, import) follow them. A pure `lib/racks.ts` mirrors the rules and builds the floor plan; the page is a server loader + client components that only call RPCs.

**Tech Stack:** PostgreSQL 16 (Supabase) migrations + psql tests, Next.js 15 App Router, React 19, TypeScript strict, Tailwind + shadcn/ui, tsx tests, SheetJS for Excel.

**Spec:** `docs/superpowers/specs/2026-11-08-racks-and-locations-design.md` (approved 8 Nov 2026). Approved mockup: `.superpowers/brainstorm/82434-1794112268/content/layout-v2.html`.

## Global Constraints

- UI strings Indonesian; code, comments, docs English. On-screen names: `Rak & Lokasi`, `Denah`, `Daftar bin`, `Riwayat`, `Aktif`, `Diblokir`, `Tidak ada`, `Rencana`, `Shell`, `CKB 3PL`, `+ Tambah rak`, `Aktifkan`.
- One migration: `supabase/migrations/0132_racks_and_locations.sql`, forward-only. SQL tests `93`–`96`, each `begin; … rollback;`, PASS/FAIL per line (copy the header of `supabase/tests/91_pick_location_changes.sql`).
- `status = 'active'` ⇔ `block_kind is null` (check constraint). Keep `status` as the "may stock go here" switch; never add a bin_status enum value.
- `owner` is `'SHELL'` / `'CKB'` on rack bins (`rack is not null`), null on floor locations.
- Every new table: RLS on, read policy `using ((select public.is_active()))`, no write policy. Every write = SECURITY DEFINER RPC with role check + reason required + one `bin_changes` change set.
- Rights: block / unblock / ABC / capacity = `has_role(array['supervisor','admin'])`; `Tidak ada`, owner, plan / activate / cancel racks = `has_role(array['admin'])`.
- Bins are never deleted, except `cancel_planned` on a `PLANNED` bin nothing references.
- `selectNextBin` (`lib/allocator/binselect.ts`) is not edited.
- Each action: one confirmation dialog with a summary sentence; nothing after it succeeds.
- Phones: cards and `Daftar bin` by default; desktops: tables and `Denah`.
- Tests in `tests/*.test.ts` follow the inline `test()` / `passed` / `failed` shape and are appended to `npm test` in `package.json`.
- "Commit" steps are checkpoints: do not run `git commit` unless the user asks (the working tree carries a week of uncommitted work); keep the message for when they do.
- `package.json` test chain currently contains `&&&& tsx tests/login-wiring.test.ts && tsx tests/login-wiring.test.ts` (user's uncommitted edit, breaks `npm test`). Do not touch it; run test files individually with `npx tsx`.

## Review Focus

1. A selection that mixes bins which can change with bins that cannot (stock, pickface, open task): the accepted ones change, the refused ones are listed with a reason, and the preview and the result list the same bins. → Task 3 test `mixed selection changes only the accepted bins, preview = result`.
2. A WMS full import after 0132: CKB bins keep their stock, rows for `Tidak ada` bins are skipped and returned in `skipped`. → Task 2 test `full_sync leaves CKB bins alone`.
3. Planning racks in an aisle that already has some of them: only missing codes are created, existing ones reported, never duplicated or reset. → Task 4 test `plan_racks on a partial aisle creates only the missing codes`.
4. The Dashboard after racks are lent to CKB or planned: % uses Shell usable rack bins only; planned ones listed apart. → Task 5 test `occupancy excludes CKB, blocked, not present and planned bins`.
5. Picking when a CKB-owned bin holds the earliest expiry of a SKU: never picked; FEFO order among Shell bins unchanged. → Task 7 test `a CKB bin with the earliest expiry is never picked`.

---

### Task 1: Bin model, history, usability, current data

**Files:**
- Create: `supabase/migrations/0132_racks_and_locations.sql` (section 1; later tasks append sections)
- Create: `supabase/tests/93_bin_model.sql`
- Modify: `scripts/sql-test.sh` only if the glob misses `93` (it does not; leave it)

**Interfaces:**
- Produces:
  - columns `bins.block_kind text check (block_kind in ('BLOCKED','NOT_PRESENT','PLANNED'))`, `bins.block_reason text`, `bins.owner text check (owner in ('SHELL','CKB'))`; constraint `bins_state_ck check ((status = 'active') = (block_kind is null))`; constraint `bins_owner_ck check ((rack is null) = (owner is null))`.
  - `public.bin_changes(id bigint identity pk, change_set uuid not null, bin_code text not null, field text check (field in ('STATE','OWNER','CREATED','REMOVED','ATTR')), old_value text, new_value text, reason text not null, changed_by uuid references profiles(id), changed_by_name text not null, changed_at timestamptz default now())`, indexes on `(changed_at desc)` and `(bin_code)`, update/delete refused by trigger `bin_changes_forbid_change`.
  - `public.bin_usable(p_bin uuid, p_side text default 'SHELL') returns boolean` (stable, SECURITY DEFINER): `status = 'active' and (owner = p_side or owner is null)`.
  - `public.bin_state(p_status public.bin_status, p_kind text) returns text` (immutable): `'ACTIVE' | 'BLOCKED' | 'NOT_PRESENT' | 'PLANNED'`.
  - internal `public.log_bin_change(p_set uuid, p_code text, p_field text, p_old text, p_new text, p_reason text, p_by_name text)` (revoked from authenticated).
  - Policy `"bins: admin write"` (0003) dropped.

- [ ] **Step 1: Write `supabase/tests/93_bin_model.sql`** with checks:
  - `phantoms are NOT_PRESENT`: all of `CE33A01..CE33E02`, `CE32A02..CE32E02`, `CE34A01..CE34E01` exist with `status='blocked' and block_kind='NOT_PRESENT'` (20 rows).
  - `CG and CH are CKB`: `bool_and(owner='CKB')` over `zone in ('CG','CH') and rack is not null`.
  - `CF21-CF40 level A is CKB and active again`: 40 rows `owner='CKB' and status='active'` for `bin_code ~ '^CF(2[1-9]|3[0-9]|40)A0[12]$'`.
  - `other racks are SHELL, floor locations have no owner`.
  - `state and kind agree` (insert of `status='active', block_kind='BLOCKED'` fails).
  - `bin_usable`: an active SHELL bin true for SHELL, false for CKB; CF21A01 false for SHELL, true for CKB; STAGING true for both; CE33A01 false for both.
  - `history recorded`: `bin_changes` has a change set with `changed_by_name = 'migrasi 0132'` for each of the three data steps.
  - `history is append-only`: update and delete on `bin_changes` fail.
  - `no direct writes`: as an authenticated admin, `update bins set status='blocked' where bin_code='CA01A01'` changes 0 rows or fails.
- [ ] **Step 2: Run** `scripts/sql-test.sh supabase/tests/93_bin_model.sql` → FAIL (columns missing).
- [ ] **Step 3: Write section 1 of 0132**: header comment (incident: CE32A02 offered by `Bin kosong`, 8 Nov), columns, constraints, table, functions above, policy drop. Data steps, in order, each logging one change set:
  1. Insert the 20 phantom codes if missing (zone `CE`, rack/level/position parsed from the code, capacity 1). Refuse with the list (`raise exception 'Bin tiang masih berisi stok: %'`) if any holds inventory > 0, is a pickface, or is on an open task (`open_pick_tasks`, 0120 pattern). Set `status='blocked', block_kind='NOT_PRESENT', block_reason='tiang, tidak ada rak (0132)'`.
  2. `owner='SHELL'` for every rack bin, then `owner='CKB'` for zones CG, CH and for `^CF(2[1-9]|3[0-9]|40)A0[12]$` (these also become `status='active', block_kind=null`).
  3. Any other `status='blocked'` bin: `block_kind='BLOCKED', block_reason='diblokir sebelum 0132'`.
- [ ] **Step 4: Run** test 93 → all PASS; run `scripts/sql-test.sh` → only the known test 82 fails in the full run.
- [ ] **Step 5: Commit** `feat(racks): bin state, owner and change history (0132, SQL test 93)`.

### Task 2: Ledger guards, rebagging and import

**Files:**
- Modify: `supabase/migrations/0132_racks_and_locations.sql` (section 2)
- Create: `supabase/tests/94_bin_ledger_guards.sql`
- Modify: `app/(app)/admin/import/import-client.tsx` (show `skipped`)

**Interfaces:**
- Consumes: Task 1 columns, `bin_usable`.
- Produces:
  - `apply_movement` (copy latest from `0067_pick_line.sql`, add refusals before step 1): (a) stock entering a bin (`to_bin_id` with type `inbound/putaway/transfer`, or `adjustment` with quantity > 0) whose `block_kind in ('NOT_PRESENT','PLANNED')` → `raise exception 'Bin % tidak ada / belum dibangun'`; (b) side = `'CKB'` when `current_setting('app.ckb_movement', true) = 'on'` else `'SHELL'`; any rack bin in `from_bin_id`/`to_bin_id` with `owner` ≠ side → `raise exception 'Bin % dipinjam %, bukan untuk %'`.
  - Rebagging posting functions (latest bodies in `0106_ckb_rebagging_roles.sql`: `approve_post_rebagging`, `reverse_rebagging_posting`) set `perform set_config('app.ckb_movement','on',true)` before their movement inserts and `''` after; `set_rebagging_sources` / `set_rebagging_outputs` (latest: 0085 / 0106) refuse a rack bin whose `owner <> 'CKB'` (`'Baris %: bin % bukan rak CKB'`).
  - Migration check: refuse (list job numbers) if an open rebagging job (status not in final states) has a source/output on a Shell rack bin.
  - `import_snapshot(rows, full_sync, source_name, keep_bins)` keeps its signature; returns the old keys plus `'skipped': jsonb[]` of `{bin_code, sku, quantity, reason}` where reason ∈ `'CKB'`, `'TIDAK_ADA'`, `'RENCANA'`. Bin upsert never changes `status`, `block_kind`, `owner` of an existing bin; a new bin from the file gets `owner='SHELL'` when it has a rack. Rows for CKB or NOT_PRESENT/PLANNED bins are skipped (no item insert, no movement, not added to `_seen`); `full_sync` zeroing excludes CKB-owned bins.

- [ ] **Step 1: Write test 94** with checks: `stock cannot enter a NOT_PRESENT bin` (adjustment +1 into CE33A01 fails); `stock may leave a NOT_PRESENT bin` (seed a row in CE33A02 as owner via `alter table … disable trigger` is not allowed — instead insert the stock into a fresh active SHELL bin, then set it NOT_PRESENT by direct owner update inside the test as postgres, then a transfer out succeeds); `stock cannot enter a PLANNED bin`; `Shell cannot move into a CKB bin` (transfer CA01A01 → CF21A01 fails); `CKB flag allows it, and forbids a Shell bin` (with `set_config('app.ckb_movement','on',true)`: transfer into CG01A01 ok, into CA02A01 fails); `floor locations are shared`; `import keeps state and owner` (a file row for CE33A01 status 'active' leaves it NOT_PRESENT); `import skips a TIDAK_ADA row and reports it` (`skipped` contains `{"bin_code":"CE33A01","reason":"TIDAK_ADA"}`, no inventory row); `full_sync leaves CKB bins alone` (stock in CG01A01 via CKB flag survives a full_sync import that does not list it; the result's `skipped` lists a file row for CG01A02 with reason `CKB`); `rebagging output refused on a Shell rack bin`.
- [ ] **Step 2: Run** test 94 → FAIL.
- [ ] **Step 3: Implement section 2** as listed under Produces.
- [ ] **Step 4: Run** tests 94, 93, every rebagging/import SQL test (`grep -l "rebagging\|import_snapshot" supabase/tests/*.sql`) → PASS; fix tests that assumed CG/CH or CF21A were Shell-writable by giving them the CKB flag or a Shell bin, never by weakening the guard.
- [ ] **Step 5: Show `skipped` in the import page**: under the result, "N baris dilewati" with a table (bin, SKU, karton, alasan: `Rak CKB` / `Bin tidak ada` / `Rak belum dibangun`). Typecheck.
- [ ] **Step 6: Commit** `feat(racks): ledger refuses missing and other-side bins; import leaves CKB racks alone (0132, SQL test 94)`.

### Task 3: State, owner and attribute RPCs

**Files:**
- Modify: `supabase/migrations/0132_racks_and_locations.sql` (section 3)
- Create: `supabase/tests/95_bin_change_rpcs.sql`

**Interfaces:**
- Produces:
  - `public.bin_change_preview(p_codes text[], p_field text, p_value text) returns table(bin_code text, ok boolean, reason text, state text, owner text)` — `p_field` `'STATE'` with `p_value` ∈ `'ACTIVE','BLOCKED','NOT_PRESENT'`, or `'OWNER'` with `'SHELL','CKB'`. Unknown codes return `ok=false, reason='bin tidak ditemukan'`. Already-at-value → `ok=false, reason='sudah …'`.
  - `public.apply_bin_change(p_codes text[], p_field text, p_value text, p_reason text, p_by_name text) returns jsonb` → `{change_set uuid, changed int, refused: [{bin_code, reason}]}`; calls `bin_change_preview` and changes exactly its `ok` rows; one `bin_changes` row per changed bin.
  - `public.set_bin_attrs(p_codes text[], p_abc text, p_capacity numeric, p_reason text, p_by_name text) returns jsonb` (`p_abc` ∈ `'A','B','C','CLEAR'` or null = unchanged; capacity > 0 or null).
  - Blocker reasons (exact text, also used by the UI): `masih berisi % karton %` (sku list), `pickface %`, `tugas terbuka NO % #%`, `paket CKB aktif`, `rebagging terbuka`, `hitung stok CKB terbuka`, `rak lantai tidak punya pemilik`, `Rencana: aktifkan lewat Aktifkan` (STATE change of a PLANNED bin).
  - Rules: to `BLOCKED`/`NOT_PRESENT`: refuse stock, pickface, open task. `OWNER`: rack bins only; refuse inventory > 0, ACTIVE `ckb_packages.bin_id`, open `ckb_rebagging_sources.bin_id`/`ckb_rebagging_outputs.to_bin_id`, open CKB count task whose `storage_bin` = the code, pickface, open task. Roles per Global Constraints (any `NOT_PRESENT` in old or new value = admin).
- [ ] **Step 1: Write test 95**: `a reason is required`; `an operator cannot block`; `a supervisor can block an empty bin and unblock it` (2 history rows, 2 change sets); `a supervisor cannot set NOT_PRESENT`; `blocking a bin with stock is refused with its SKU`; `mixed selection changes only the accepted bins, preview = result` (3 codes: empty, with stock, pickface → changed 1, refused 2, same reasons as preview); `owner change refused while stock is in the bin`; `admin lends an empty rack to CKB and takes it back` (owner SHELL→CKB→SHELL, `bin_usable` follows); `owner change on STAGING refused`; `set_bin_attrs sets ABC and capacity, logs ATTR rows`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement section 3.** **Step 4: Run** 93–95 → PASS.
- [ ] **Step 5: Commit** `feat(racks): block, not-present and lend-to-CKB RPCs with preview (0132, SQL test 95)`.

### Task 4: Plan, activate and cancel racks

**Files:**
- Modify: `supabase/migrations/0132_racks_and_locations.sql` (section 4)
- Create: `supabase/tests/96_plan_racks.sql`

**Interfaces:**
- Produces:
  - `public.plan_racks_preview(p_aisle text, p_bays int, p_levels text[], p_owner text) returns table(bin_code text, rack text, level text, position text, exists boolean)` — codes for racks `01..p_bays` and `21..20+p_bays`, every level in `p_levels`, positions `01`,`02`. Validates `p_aisle ~ '^C[A-Z]$'`, `p_bays between 1 and 20`, `p_levels` non-empty, contiguous from `'A'`, subset of A–E, `p_owner in ('SHELL','CKB')`.
  - `public.plan_racks(p_aisle, p_bays, p_levels, p_owner, p_reason, p_by_name) returns jsonb` → `{change_set, created int, existing int}`; inserts the missing codes as `status='blocked', block_kind='PLANNED', owner=p_owner, capacity=1, zone=p_aisle`; appends `p_aisle` to `settings.layout.aisle_order` if absent; `perform public.recompute_bin_positions()`; `CREATED` history rows. Refuses when `created` would be 0.
  - `public.activate_planned(p_codes text[], p_reason, p_by_name) returns jsonb` `{change_set, changed, refused}` (refused: not PLANNED).
  - `public.cancel_planned(p_codes text[], p_reason, p_by_name) returns jsonb` (refused: not PLANNED, or referenced by `movements`, `pick_tasks`, `inventory`, `count_tasks`, `pick_audits`, `pickfaces`); deletes accepted bins, `REMOVED` history rows; removes the aisle from `aisle_order` when no bins of it remain.
  - All admin only.
- [ ] **Step 1: Write test 96**: `plan CI, 10 bays, levels A-D, Shell` → 160 codes, first `CI01A01`, last `CI30D02`, none `CI11…`/`CI31…`, all `PLANNED`, positions not null, `aisle_order` ends with `"CI"`; `levels must start at A and be contiguous` (`{B,C}` and `{A,C}` refused); `plan_racks on a partial aisle creates only the missing codes` (plan CI 12 bays after 10 → created 32, existing 128, no duplicates); `planned bins are not usable and stock cannot enter`; `activate makes them usable, cancel refuses activated ones`; `cancel removes unreferenced planned bins and the aisle from aisle_order`; `a supervisor cannot plan`.
- [ ] **Step 2–4:** run → FAIL, implement section 4, run 93–96 → PASS.
- [ ] **Step 5: Commit** `feat(racks): plan, activate and cancel racks (0132, SQL test 96)`.

### Task 5: Read side — empty bins, bin summary, dashboard, planning stock

**Files:**
- Modify: `supabase/migrations/0132_racks_and_locations.sql` (section 5)
- Modify: `supabase/tests/93_bin_model.sql` (add read-side checks)
- Modify: `config/warehouse.ts` (remove `OCCUPANCY_EXCLUDED_ZONES`), `app/(app)/dashboard/page.tsx`, `app/(app)/inventory/page.tsx:103`

**Interfaces:**
- Produces:
  - `empty_bins` (0043): `public.bin_usable(b.id)` replaces `b.status = 'active'`.
  - `bin_summary` (0002): same columns, then appended `block_kind`, `owner`, `block_reason` (append only — `create or replace view` cannot reorder).
  - `dashboard_summary` (0098, same signature): `rack_bins` = rack bins with `bin_usable(id)` (no zone list); `bins` object gains `ckb int`, `not_present int`, `planned int`; new top-level key `planned: [{zone, owner, positions}]` for PLANNED bins grouped by zone + owner.
  - `planning_stock` (find latest definition with `grep -l "function public.planning_stock" supabase/migrations/*.sql | tail -1`, keep signature and columns): its `bin_status` column is `case when public.bin_usable(b.id) then 'active' else 'blocked' end`, so the allocator's existing `BIN_NOT_ACTIVE` exclusion drops CKB, NOT_PRESENT and PLANNED bins.
- [ ] **Step 1: Add checks to test 93**: `occupancy excludes CKB, blocked, not present and planned bins` (`dashboard_summary()->'bins'->>'rack_total'` = count of rack bins with `bin_usable`); `planned list` after `plan_racks('CI',1,'{A}','SHELL',…)` = `[{"zone":"CI","owner":"SHELL","positions":4}]`; `empty_bins has no CKB, phantom or planned bin`; `planning_stock reports a CKB bin as blocked`.
- [ ] **Step 2–3:** run → FAIL; implement section 5.
- [ ] **Step 4: Dashboard page:** the type at `dashboard/page.tsx:58` gains the new fields; under the occupancy grid, when `planned.length`, one line `Rencana: aisle CI, 200 posisi` per aisle (`· CKB 3PL` when owner CKB) linking to `/racks`; the `Rak terisi` sub-label `di luar CKB 3PL` stays. Inventory empty drill-down (`page.tsx:103`) filters `.is("block_kind", null).eq("owner", "SHELL")`.
- [ ] **Step 5:** remove `OCCUPANCY_EXCLUDED_ZONES` from `config/warehouse.ts` (Task 7 replaces its one consumer); run tests 58, 60, 93–96, typecheck.
- [ ] **Step 6: Commit** `feat(racks): occupancy, empty bins and planning stock follow state and owner (0132)`.

### Task 6: Pure rack logic

**Files:**
- Create: `lib/racks.ts`
- Create: `tests/racks.test.ts` (append `&& tsx tests/racks.test.ts` to `npm test`)

**Interfaces:**
- Produces (all exported from `lib/racks.ts`):
  - `type BinState = 'ACTIVE' | 'BLOCKED' | 'NOT_PRESENT' | 'PLANNED'`; `type Owner = 'SHELL' | 'CKB'`.
  - `type RackBin = { id: string; bin_code: string; zone: string; rack: string | null; level: string | null; position: string | null; status: 'active' | 'blocked'; block_kind: Exclude<BinState,'ACTIVE'> | null; block_reason: string | null; owner: Owner | null; total_qty: number; fill_ratio: number | null; abc_class: string | null; min_expiry: string | null; skus: string[] }` (the `bin_summary` row).
  - `stateOf(b: Pick<RackBin,'status'|'block_kind'>): BinState`; `usableForShell(b: Pick<RackBin,'status'|'owner'>): boolean` (mirror of `bin_usable`).
  - `STATE_LABEL: Record<BinState,string>` = `{ACTIVE:'Aktif',BLOCKED:'Diblokir',NOT_PRESENT:'Tidak ada',PLANNED:'Rencana'}`; `OWNER_LABEL = {SHELL:'Shell',CKB:'CKB 3PL'}`.
  - `type Bay = { zone: string; rack: string; face: 0 | 1; slot: number; bins: RackBin[] }` (`slot` 0–19 = column in the plan); `type AisleBlock = { zone: string; faces: [Bay[], Bay[]]; planned: boolean }`; `buildFloorPlan(bins: RackBin[], aisleOrder: string[], baysPerSide = 20): { aisles: AisleBlock[]; floor: RackBin[] }` — aisles in `aisleOrder` then any extra zone alphabetically; face 0 = racks 01–20, face 1 = 21–40 (rack 21 at slot 0); floor = `rack === null`; `planned` = every bin PLANNED.
  - `bayKey(zone, rack) => \`${zone}${rack}\``; `selectBayRange(plan, a: Bay, b: Bay): Bay[]` (rectangle across aisles, faces and slots in plan order); `narrowLevels(bins: RackBin[], levels: string[]): RackBin[]`.
  - `codeRangeText(codes: string[]): string` → `'CF21A01–CF40A02 (40 bin)'`, single → `'CE32A02'`, empty → `''`.
  - `plannedCodes(aisle: string, bays: number, levels: string[]): string[]` (mirror of `plan_racks_preview`, same order: rack, level, position).
  - `overlayOf(b: RackBin): 'NOT_PRESENT' | 'PLANNED' | 'BLOCKED' | 'CKB' | null` (precedence in that order).
  - `rackTiles(bins: RackBin[]): { usable: number; occupied: number; pct: number; ckb: number; blocked: number; notPresent: number; planned: number }` (rack bins only; `pct` = occupied / usable, 0 when usable = 0).
  - `bayFill(bay: Bay): RackBin | null` — the bin whose colour the bay shows (highest `total_qty`, ignoring overlays).
- [ ] **Step 1: Write tests** `tests/racks.test.ts`: `stateOf and usableForShell mirror bin_usable`; `floor plan follows 3D: rack 21 sits under rack 01` (`aisles[0].faces[1][0].rack === '21'`, `faces[0][0].rack === '01'`); `aisle order from layout, extra zones after` (`['CA','CB']` + bins in CZ → `CA,CB,CZ`); `floor locations go to floor`; `planned aisle flagged`; `selectBayRange across two aisles` (CE01..CF03 rectangle → 6 bays per face row selected, in plan order); `narrowLevels keeps level A only`; `codeRangeText` (3 cases above); `plannedCodes('CI',10,['A','B','C','D'])` length 160, first `CI01A01`, last `CI30D02`; `overlay precedence: NOT_PRESENT beats CKB`; `rackTiles counts and pct` (fixture: 4 usable of which 3 occupied, 1 CKB, 1 BLOCKED, 1 NOT_PRESENT, 2 PLANNED → `{usable:4, occupied:3, pct:0.75, ckb:1, blocked:1, notPresent:1, planned:2}`).
- [ ] **Step 2–4:** `npx tsx tests/racks.test.ts` → FAIL; implement; → PASS.
- [ ] **Step 5: Commit** `feat(racks): floor plan and rack rules (lib/racks.ts)`.

### Task 7: Shell consumers follow the database

**Files:**
- Modify: `lib/allocator/config.ts` (`rackLocationPattern` → `/^C[A-Z]\d{2}[A-E]\d{2}$/`; `blockedBins` comment: offline fallback, the database is the source of truth since 0132)
- Modify: `app/(app)/allocate/allocate-client.tsx` (pass DB unusable codes and layout aisle order into the run config)
- Create: `lib/allocator/browser/unusable-bins.ts`
- Modify: `lib/inbound/load.ts:21-38`, `app/(app)/waves/wave-corrections.tsx:285`, `app/(app)/waves/task-post-dialog.tsx:45`, `app/(app)/waves/add-order.tsx:161`, `lib/wave-fix.ts:74`, `lib/allocator/pickface.ts:115`
- Create: `tests/racks-allocator.test.ts` (add to `npm test`)

**Interfaces:**
- Consumes: Task 5 `planning_stock.bin_status`, `bins.owner/block_kind`.
- Produces: `loadUnusableBins(db: SupabaseClient): Promise<string[]>` (rack bin codes where not `status='active' and owner='SHELL'`, paginated with `fetchAll`); `loadAisleOrder(db): Promise<string[]>` (`settings.layout.aisle_order`). The allocate page builds its config with `withConfig({ ...existing, blockedBins: [...DEFAULT_CONFIG.blockedBins, ...unusable], aisleSequence: aisleOrder })`.
- Every other listed consumer filters candidate bins with `usableForShell` on rows it loads (add `owner, block_kind` to their selects) instead of `DEFAULT_CONFIG.blockedBins` / zone lists; `pickface.ts` keeps reading `config.blockedBins` (now fed from the DB by the caller).
- [ ] **Step 1: Write `tests/racks-allocator.test.ts`**: `a CKB bin with the earliest expiry is never picked` (inventory rows: CF21A01 exp 2030-01 `bin_status:'blocked'` as planning_stock reports it, CA05B01 exp 2030-06, CA06B01 exp 2030-09 → allocation picks CA05B01 first, never CF21A01, and the shortage reason is not `NO_STOCK` when CA bins cover it); `an unusable code in blockedBins is never a relocation target` (workbook-style stock + `withConfig({blockedBins:['CA07B01']})` → no `moveTo` = CA07B01); `aisleSequence from the layout keeps today's route for CA-CF` (pick path order identical to `DEFAULT_CONFIG` for a CA–CF fixture).
- [ ] **Step 2–3:** run → FAIL where wiring is missing; implement.
- [ ] **Step 4: Run** `npx tsx` on `tests/racks-allocator.test.ts`, `one-bin-per-line`, `picklist-sisa-replay` (TZ=Asia/Jakarta), `stock-adapter`, `inbound-putaway`, `wave-fix`, `pickface-fixed`, `pickface-fallback` → PASS; `npm run typecheck`; `grep -rn "OCCUPANCY_EXCLUDED_ZONES\|'CG'\|\"CG\"" app lib config` → no Shell rule left.
- [ ] **Step 5: Commit** `feat(allocate): picking, putaway and wave fixes take usable bins from the database`.

### Task 8: Page shell and `Daftar bin`

**Files:**
- Modify: `components/app/nav-config.ts` (row after `/warehouse`: `{ href: "/racks", label: "Rak & Lokasi", blurb: "Denah rak, status bin, pinjam ke CKB, rak baru.", icon: LayoutGrid, jobs: [AI, AO, IV, LD, AD] }`), `docs/superpowers/specs/2026-10-26-flowchart-roles-and-assignment-design.md` (matrix row), `tests/jobs-pages.test.ts`
- Create: `app/(app)/racks/page.tsx`, `app/(app)/racks/loading.tsx`, `app/(app)/racks/racks-client.tsx`, `app/(app)/racks/racks-data.ts`, `app/(app)/racks/bin-list.tsx`, `app/(app)/racks/tiles.tsx`
- Modify: `components/app/live-refresh.tsx` (`LiveTable` gains `"bins"` and `"bin_changes"`); `supabase/migrations/0132_racks_and_locations.sql` (add both tables to the realtime publication as `0015_realtime.sql` does)

**Interfaces:**
- Produces: `loadRacks(supabase): Promise<{ bins: RackBin[]; aisleOrder: string[]; baysPerSide: number; role: Role }>` in `racks-data.ts` (`bin_summary` via `fetchAll`, layout from `settings`); `RacksClient({ bins, aisleOrder, baysPerSide, role, tab })` with tabs `?tab=denah|daftar|riwayat` (phone default `daftar`, via `useIsPhone` pattern from `app/(app)/waves/use-is-phone.ts`); `Tiles({ tiles })` showing the six `rackTiles` numbers; `BinList({ bins, selected, onSelect })` with filters (aisle, level, state, owner, `kosong`, free text), cards on a phone, table on desktop, checkbox selection, and `Unduh Excel` of the filtered rows via `saveSheets`.
- Visual direction: load the `frontend-design` skill before writing components. Bin codes as plates (reuse the plate styling from `components/bin/bin-plate.tsx`), state badges `Diblokir` (bad), `Tidak ada` (steel-500, dashed), `Rencana` (ckb dotted), `CKB 3PL` (jeir-teal tint). Header `+ Tambah rak` button (admin) in `floor` yellow.
- [ ] **Step 1:** add `/racks` to `tests/jobs-pages.test.ts` expectations (allowed: Admin Inbound, Admin Outbound, Inventory, Leader, Admin; refused: Checker, Operator / Picker) → run → FAIL.
- [ ] **Step 2:** implement nav row, page (`requirePage("/racks")`), loader, tiles, list, loading skeleton matching the layout.
- [ ] **Step 3:** run `npx tsx tests/jobs-pages.test.ts`, typecheck, lint → PASS.
- [ ] **Step 4: Verify in a browser** from a copy of the repo (never a second `next dev` in this folder; rsync without `.env*`, symlink `node_modules`), against the local Supabase with migrations applied: page loads 2,970+ bins, filters work, phone width shows cards.
- [ ] **Step 5: Commit** `feat(racks): Rak & Lokasi page with tiles and bin list`.

### Task 9: `Denah` floor plan

**Files:**
- Create: `app/(app)/racks/floor-plan.tsx`, `app/(app)/racks/rack-panel.tsx`, `app/(app)/racks/selection-bar.tsx`
- Modify: `app/(app)/racks/racks-client.tsx`, `components/warehouse/colors.ts` (export nothing new; reuse `binColor`, `LEGENDS`)

**Interfaces:**
- Consumes: `buildFloorPlan`, `bayFill`, `overlayOf`, `selectBayRange`, `narrowLevels`, `codeRangeText`, `binColor(b, mode)`.
- Produces: `FloorPlan({ plan, mode, selected: Set<string>, focus, onBay, onRange, onAisle })` (CSS grid; one memoised component per aisle so a selection change re-renders only touched aisles); `RackPanel({ bay, behind: Bay | null, onSelectBins, role })` (front view, level E on top, 2 plates per level with qty or `kosong` and state badge); `SelectionBar({ bins, role, onAction })` (sticky bottom: `codeRangeText`, count, level chips A–E, action buttons by role).
- Behaviour: colour modes `Utilisasi` / `Kelas ABC` / `Expired` (= 3D) + `Status & pemilik`; overlays always drawn; search (code, rack prefix, aisle, SKU) highlights and scrolls; drag or shift-click = `selectBayRange`; click aisle name = whole aisle; Esc clears; arrows move focus, Enter opens the panel; every bay has an `aria-label` like `CE32, 7 dari 10 posisi terisi, 1 tidak ada`.
- [ ] **Step 1:** implement against the approved mockup (`layout-v2.html`): ruler 01–20, floor-location chips in front, lane gaps, legend.
- [ ] **Step 2: Verify in the browser copy:** CE33 grey, CE32 pillar position shown in the panel, CF level A in CKB tint, drag-select across two aisles gives the expected `codeRangeText`, keyboard path works, no horizontal page scroll at 1280 px, 3D colours match for the same bins.
- [ ] **Step 3:** typecheck, lint. **Step 4: Commit** `feat(racks): Denah floor plan with rack panel and selection`.

### Task 10: Actions and `Riwayat`

**Files:**
- Create: `app/(app)/racks/change-dialog.tsx`, `app/(app)/racks/history.tsx`
- Modify: `app/(app)/racks/selection-bar.tsx`, `app/(app)/racks/rack-panel.tsx`, `app/(app)/racks/bin-list.tsx`

**Interfaces:**
- Consumes: RPCs from Task 3; `usePersonName` / `PersonNameField` (`components/app/person-name`).
- Produces: `ChangeDialog({ codes, field: 'STATE' | 'OWNER', value, onDone })` — on open calls `bin_change_preview`, shows "akan diubah" / "ditolak" groups with reasons, the summary sentence (e.g. `Blokir 38 bin CF21A01–CF39A02. 2 bin ditolak karena masih berisi stok.`), reason field (required), name field; confirm calls `apply_bin_change` and closes; `AttrDialog` for ABC / capacity via `set_bin_attrs`. `History({ from, to, action, q })` reads `bin_changes` grouped by `change_set` (one line per set: time, who, sentence, reason; expandable bin list), date range filter, `Unduh Excel`.
- Actions shown by role: supervisor+ `Blokir`, `Buka blokir`, `Kelas ABC / kapasitas`; admin adds `Tandai tidak ada`, `Kembalikan (ada)`, `Pinjamkan ke CKB`, `Kembalikan ke Shell`.
- [ ] **Step 1:** implement; the live refresh (`bins`, `bin_changes`) re-reads after a change.
- [ ] **Step 2: Verify in the browser copy:** block a mixed selection (one bin with stock) → dialog lists it refused, the rest change, `Riwayat` shows one line; a supervisor account does not see admin actions; an RPC refusal message appears in the dialog, not as a crash.
- [ ] **Step 3:** typecheck, lint. **Step 4: Commit** `feat(racks): block, lend and not-present actions with history`.

### Task 11: `+ Tambah rak`, activate and cancel

**Files:**
- Create: `app/(app)/racks/add-racks.tsx`
- Modify: `app/(app)/racks/racks-client.tsx`, `app/(app)/racks/selection-bar.tsx`

**Interfaces:**
- Consumes: `plan_racks_preview`, `plan_racks`, `activate_planned`, `cancel_planned`, `plannedCodes`, `buildFloorPlan`.
- Produces: `AddRacks({ aisleOrder, bins })` sheet: aisle (suggests the next free `C?` after the last in `aisleOrder`, or pick an existing aisle → "hanya rak yang belum ada"), bays per face 1–20, level checkboxes A–E (contiguous from A enforced in the form), owner, reason; live preview = mini floor plan with the new block dotted in place + `codeRangeText` + "N bin baru, M sudah ada"; confirm → `plan_racks`. Selection bar on PLANNED bins (admin): `Aktifkan`, `Batalkan rencana`.
- [ ] **Step 1:** implement. **Step 2: Verify in the browser copy:** plan CI 10 bays A–D → dotted block appears last, tiles show 160 `Rencana`; activate rack CI01 → it turns normal; cancel the rest → aisle disappears.
- [ ] **Step 3:** typecheck, lint. **Step 4: Commit** `feat(racks): plan, activate and cancel new racks`.

### Task 12: 3D, labels, Pengaturan, docs

**Files:**
- Modify: `components/warehouse/scene.tsx`, `components/warehouse/colors.ts`, `lib/warehouse-types.ts`, `app/api/warehouse/route.ts` (select the new columns)
- Modify: `app/(app)/labels/labels-client.tsx` (exclude NOT_PRESENT / PLANNED)
- Modify: `app/(app)/admin/settings/settings-forms.tsx`, `app/(app)/admin/actions.ts` (remove the bin status form and `setBinStatusAction`; add a link `Status bin, rak baru, pinjam ke CKB: buka Rak & Lokasi`)
- Modify: `AGENTS.md` (Gotchas bullet for 0132; fix the `blockedBins` "DB rows deleted" note), `docs/CKB_3PL.md` §9 (rebagging limited to CKB rack bins + floor locations), `README.md` §1 (racks/aisles now edited on `Rak & Lokasi`)
- Test: `tests/racks.test.ts` (add `binColor` overlay case if a helper is added)

**Interfaces:**
- 3D: NOT_PRESENT bins not drawn (filtered before the instanced mesh, so instance ids stay aligned); PLANNED drawn by a second instanced mesh with a transparent material (`opacity 0.25`); BLOCKED keep their colour plus the existing red wireframe cage (`Highlights` style) in a third small mesh; CKB bins mixed toward `#61A5C2`. Legend gains `Diblokir`, `Rencana`, `CKB 3PL`.
- [ ] **Step 1:** implement; **Step 2: Verify in the browser copy:** the CI plan from Task 11 shows faint in 3D, CE33 is a gap, CF level A tinted; labels page refuses `CE33A01`; `Pengaturan` has no bin status form.
- [ ] **Step 3:** full checks: `scripts/sql-test.sh` (only test 82 may fail in the full run; passes alone), every tsx test touched in this plan, `npm run typecheck`, `npm run lint`.
- [ ] **Step 4: Commit** `feat(racks): 3D, labels and settings follow rack state; docs`.
