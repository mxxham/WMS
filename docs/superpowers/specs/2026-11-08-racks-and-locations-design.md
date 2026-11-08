# Rak & Lokasi — design

Date: 8 Nov 2026 · Status: approved 8 Nov 2026 · Next migration number: **0132**

## 1. Why

The warehouse's physical shape lives in four places that disagree:

- **Phantom bins.** CE33 (whole rack), CE32 position 02 and CE34 position 01 are pillars. They are listed in
  `lib/allocator/config.ts blockedBins` with the comment "DB rows deleted", but no migration deletes them, and
  `import_snapshot` creates any unknown bin as `active`. On the live site `CE32A02` shows up in `Inventory → Bin kosong`,
  so it is an active, empty bin there.
- **Blocking has no proper tool.** `Pengaturan` has a raw form (`setBinStatusAction`) that flips `bins.status` for typed
  codes: admin only, no reason, no history, no check for stock / pickface / open tasks.
- **Occupancy is wrong.** `dashboard_summary` (0098) counts every rack bin outside CG/CH, including blocked ones, as an
  empty position, so blocked bins lower `Rak terisi` and the aisle/level grid. The grid's drill-down list of empty positions
  (`bin_summary` with `total_qty = 0`) includes them too.
- **"Who uses which rack" is hard-coded.** All racks are Shell's, but CKB 3PL borrows some, and the borrowing will
  change soon. Today it is spelled in five places: `rackLocationPattern /^C[A-F].../` and `aisleSequence` (allocator),
  `OCCUPANCY_EXCLUDED_ZONES = ["CG","CH"]` (`config/warehouse.ts`, used by putaway), `zone not in ('CG','CH')` (0098), and
  CF21–CF40 level A, which was lent to CKB by *blocking* it (0120).
- **No way to add racks.** More racks are planned. Adding aisle CH took a migration (0086).

The user wants one page that is "all about racks, bins and locations": see the whole warehouse, change any bin or rack,
mark bins that do not exist, block bins, add new racks, and change which racks are lent to CKB. It should look and work
as well as the best pages of the app.

## 2. Goals

1. One page, `Rak & Lokasi`, built on a floor plan that is drawn by the same rules as `Gudang 3D` (approved mockup:
   `.superpowers/brainstorm/82434-1794112268/content/layout-v2.html`).
2. Every rack position has a **state** and an **owner**, kept in the database, changed only through role-checked RPCs
   with a reason, recorded in an append-only history.
3. States: `Aktif`, `Diblokir` (exists, not usable now), `Tidak ada` (does not physically exist), `Rencana` (planned,
   not built yet). Owners: `Shell`, `CKB 3PL`.
4. Every part of Shell that chooses or counts bins reads those two facts from the database: picking, the walking route,
   replenishment targets, Bin To Bin targets, putaway, `Bin kosong`, occupancy (Dashboard, Home, `Rak & Lokasi`), labels,
   3D. The hard-coded lists in §1 stop being the source of truth.
5. Add racks: plan a new aisle (or the missing racks of an existing aisle) as `Rencana`, then activate them once built.
6. Lend racks to CKB and take them back in a few taps, refused while the move would strand stock.

## 3. Non-goals

- Rack shapes other than today's: 2 positions per bay, levels A–E, up to 20 bays per face, one set of dimensions
  (`settings.layout`). The bin-code format `C[A-Z]dd[A-E]dd`, the 3D view, the walking route and the labels all assume it.
- Ownership per CKB customer (Freeport, CGP, …). Two owners only.
- A CKB stock ledger or any change to the CKB app beyond rebagging respecting ownership (CKB_3PL.md §10.1 stays open).
- Moving or renumbering existing racks; editing bin codes.
- Changing the layout dimensions UI (stays on `Pengaturan`; this page links to it).

## 4. Anti-goals (would make it a failure even if it works)

- A second bin-choice rule. `selectNextBin` stays the only ranking of source bins; this feature only changes **which
  bins exist** for it (the set it is given), never how it orders them.
- Shell picking, putting away, or moving stock into a CKB-owned bin, or the reverse, through any path — including paths
  added later.
- Deleting a bin that anything references (movements, tasks, audits, counts). Bins are never deleted, with one exception:
  a `Rencana` bin that nothing has ever referenced may be removed by cancelling the plan.
- Rack rules scattered again: after this, "is this bin usable by Shell" is answered in one SQL function and one TS
  helper that mirror each other.
- Losing stock silently: a state or owner change never hides stock that is booked in a bin.

## 5. Model

### 5.1 Columns on `bins`

| Column | Values | Meaning |
|---|---|---|
| `status` (exists) | `active` / `blocked` | Kept as the single "may stock go here" switch, so every existing guard that refuses `blocked` keeps working untouched. |
| `block_kind` (new) | null / `BLOCKED` / `NOT_PRESENT` / `PLANNED` | Why it is blocked. `status = 'active'` ⇔ `block_kind is null` (check constraint). |
| `block_reason` (new) | text | The reason given at the last state change (also in history). |
| `owner` (new) | `SHELL` / `CKB` (default `SHELL`) on rack bins; **null on floor locations** | Who may use it. Independent of state: a CKB bin can be `Diblokir`; a `Rencana` aisle gets its owner when planned. Floor locations (STAGING…, STG_xx, QUARANTINE: `rack is null`) are shared by both sides (rebagging may write to QUARANTINE, 0085:250), so they carry no owner and rule 2 below does not apply to them. |

UI names: `Aktif`, `Diblokir`, `Tidak ada`, `Rencana`; `Shell`, `CKB 3PL`.

### 5.2 One definition of "usable"

- SQL: `public.bin_usable(p_bin uuid, p_owner text default 'SHELL') returns boolean` — `status = 'active' and (owner = p_owner or owner is null)`.
- TS: `lib/racks.ts usableForShell(bin)` mirroring it; tested against the SQL in one SQL test.
- `empty_bins` (0043), `bin_summary` (and through it `dashboard_summary`), the putaway loader, the allocate page's stock
  loader and every Shell target check use these, not zone lists or regexes.

### 5.3 Enforced at the ledger (defence in depth)

`apply_movement` is the one place every stock change passes. It gains two refusals:

1. No movement may put stock **into** a `NOT_PRESENT` or `PLANNED` bin. Moving stock **out** of one is allowed (that is how
   a data error found by import is cleaned up).
2. A movement touching a rack bin owned by the other side is refused. Rebagging is the CKB side's only writer of
   `movements` today; its posting functions set a transaction-local flag (`app.ckb_movement = 'on'`, the same pattern as
   `app.pick_bulk`) and `apply_movement` uses the flag to decide which owner the movement belongs to. Today rebagging
   accepts any non-blocked bin (0085:150, 247); after this it accepts CKB rack bins and floor locations only, and
   migration 0132 refuses (listing them) while an open rebagging job references a Shell rack bin.
3. `import_snapshot` is a Shell writer and never touches CKB-owned rack bins: no rows added there, and `full_sync` does
   not zero them (Shell's WMS sheet shows the CKB aisles as 0, 0086, so zeroing would wipe rebagged CKB stock). File rows
   for CKB bins are listed in the import report and skipped.

The RPCs and UIs still check first and explain in Indonesian; the trigger is the guarantee that a path added later
cannot break the rule.

### 5.4 History

`bin_changes` — append-only (UPDATE/DELETE refused by trigger), RLS read for active accounts, no write policy:
`id, change_set uuid, bin_code, field ('STATE' | 'OWNER' | 'CREATED' | 'REMOVED' | 'ATTR'), old_value, new_value, reason,
changed_by, changed_by_name, changed_at`. One confirmed action = one `change_set`, so `Riwayat` shows "Leader X blocked 10
bins of CF21 because …" as one line that expands.

## 6. Actions (RPCs)

All SECURITY DEFINER, role-checked, `(select public.is_active())`, reason required, one transaction, write `bin_changes`.
Each has a `…_preview` twin that returns the same per-bin verdicts without changing anything; the confirm dialog shows the
preview and the action re-runs the same function (the `recon_fix_plan` pattern, 0129), so preview and result never disagree.

| Action | Who | Refused per bin when |
|---|---|---|
| `set_bin_state(codes, state, reason)` → `Aktif` / `Diblokir` | supervisor, admin | to `Diblokir`: holds stock, is a pickface, is the source/target of an open task. To `Aktif` from `Tidak ada`/`Rencana`: not allowed here (see below). |
| `set_bin_state(…, 'NOT_PRESENT', …)` / back to `Aktif` | admin | same blockers as `Diblokir` |
| `set_bin_owner(codes, owner, reason)` | admin | rack bins only. Refused while the bin has any `inventory` row with quantity > 0 (either side's stock lives there), an ACTIVE `ckb_packages` row, an open rebagging job line, an open CKB stock-take task, is a pickface, or has an open pick task. |
| `plan_racks(aisle, bays_per_face, levels, owner, reason)` | admin | aisle code not `C[A-Z]`; a bin code that would be created already exists (offer "only the missing racks" instead). Creates bins as `PLANNED`, appends a new aisle to `layout.aisle_order`, runs `recompute_bin_positions()`. |
| `activate_planned(codes, reason)` | admin | bin is not `PLANNED`. |
| `cancel_planned(codes, reason)` | admin | bin is not `PLANNED`, or anything references it. Deletes the bins; history keeps a `REMOVED` row. |
| `set_bin_attrs(codes, abc_class, capacity, reason)` | supervisor, admin | — (replaces the ABC part of the old `Pengaturan` form) |

The selection may mix bins: the preview splits them into "akan diubah" and "ditolak" with the reason per bin
(`masih berisi 12 karton 550058593`, `pickface 550024919`, `tugas terbuka NO 3 #4`). The action changes only the accepted
ones — or nothing, if the user prefers; **my call: change the accepted ones, list the refused ones**, which is how the
floor works (block the 38 you can, deal with the 2 that hold stock).

Rights go by the existing role levels (user decision, 8 Nov): every supervisor-level job (Inventory, Leader, Admin
Inbound, Admin Outbound) and Admin may block / unblock and set ABC/capacity; `Tidak ada`, lending to / taking back from
CKB, planning, activating and cancelling racks are Admin only. The page is visible to those five jobs (`nav-config.ts`);
no per-job read-only mode is needed.

## 7. The page

Route `/racks`, nav label `Rak & Lokasi`, blurb "Denah rak, status bin, pinjam ke CKB, rak baru." In the `Stok` nav
section, right after `Gudang 3D` (`nav-config.ts:29`). Live refresh on `bins`, `bin_changes`, `movements`.

### 7.1 Header

Title, live dot, primary button `+ Tambah rak` (admin). Five tiles:
`Posisi Shell bisa dipakai` · `Terisi` (% of Shell usable) · `Dipinjam CKB` · `Diblokir` · `Tidak ada` · `Rencana`
(the mockup shows five; owner adds one — six tiles wrap to 3×2 on a phone).

### 7.2 Tab `Denah` (desktop/tablet; approved mockup)

- Drawn from `settings.layout` and the bins table by the 3D rules: aisles top-to-bottom in `aisle_order`; each aisle one
  back-to-back block, row 1 = racks 01–20, row 2 = racks 21–40 (rack 21 under rack 01); bay ruler 01–20 above; walking
  lane between blocks; floor locations (STAGING…, STG_xx, QUARANTINE) as chips in a row in front, as in 3D.
- One cell = one bay, split into its 2 positions. Colour modes: `Utilisasi`, `Kelas ABC`, `Expired` — **the same
  functions and legend as 3D** (`components/warehouse/colors.ts`, reused, not copied) — plus `Status & pemilik`
  (Aktif Shell / CKB 3PL tint / Diblokir hatched / Tidak ada empty / Rencana dotted). A bay shows its fullest level;
  `Tidak ada` / `Rencana` / `Diblokir` patterns always override the colour mode so they never hide.
- Search box: bin code, rack (`CE32`), aisle (`CE`), or SKU — highlights and scrolls to matches.
- Click a bay → side panel: rack name, which face, the rack behind it, a front view of 5 levels × 2 positions drawn as
  location plates (code, quantity or "kosong", state badge), and actions for the selected plates / the whole rack.
- Select many: drag across bays, shift-click a range, or click the aisle name (whole aisle). A selection bar appears at
  the bottom: "72 bin dipilih · 3 rak · CE21–CE23" with level chips (`A B C D E`) to narrow it ("only level A of these
  racks"), and the actions. This is how "CF21–CF40 level A to CKB" is one action.
- Keyboard: arrows move the focused bay, Enter opens it, Esc closes the panel / clears the selection. Bays have
  `aria-label`s ("CE32, 7 dari 10 posisi terisi, 1 tidak ada").
- Rendering: the plan is ~4,000 positions; render as one SVG (or CSS grid) memoised per aisle so a selection change does
  not re-render every cell. No WebGL here.

### 7.3 Tab `Daftar bin` (default on a phone)

A paginated, filterable table (cards on a phone): code (yellow-plate style, like everywhere else), aisle, rack, level,
state, owner, quantity, SKU count, ABC, last change. Filters: aisle, level, state, owner, `kosong`, free text. Checkbox
selection + the same selection bar and actions as `Denah`. Excel export of the filtered list.

### 7.4 Tab `Riwayat`

`bin_changes` grouped by `change_set`: time, who, action sentence ("Leader Ani memblokir 10 bin CF21A01–CF25A02"),
reason, expandable to the bin list. Filters by date range, action, bin/rack. Excel export.

### 7.5 `+ Tambah rak` (sheet / dialog, admin)

Fields: aisle (next free code suggested, or an existing aisle → "rak yang belum ada saja"), bays per face (1–20),
levels (checkboxes A–E, contiguous from A), owner, note. Live preview: the new block drawn dotted in a mini floor plan in
its place, the code range (`CI01A01 … CI20E02`, 200 bin), and what changes in 3D. Confirmation sentence, then
`plan_racks`. Activating later: select dotted bays (or the aisle) → `Aktifkan` → reason → done; labels for them become
printable from that moment.

### 7.6 Design quality bar

Follow the existing visual language (navy `jeir`, `ckb` blues, `plate` for location codes, `bad`/`warn`/`ok` meanings,
`floor` yellow only for the primary "way in" button as on the mockup's `+ Tambah rak` — **my call; if the app's rule keeps
yellow to Login/Home only, use the default primary button**). Every action: one confirmation with a summary sentence,
nothing after posting (user preference: fewer confirmations). Loading skeleton matching the layout (`loading.tsx`).
Empty states and refusal messages in plain Indonesian. Use the frontend-design skill when building the UI.

## 8. What changes elsewhere

| Where | Change |
|---|---|
| `empty_bins` view | `bin_usable(id)` instead of `status = 'active'` (so CKB bins are not offered to Shell). |
| `bin_summary` / `dashboard_summary` | expose `block_kind`, `owner`; occupancy = Shell usable rack bins only (CG/CH no longer special-cased by zone). Dashboard drill-down lists usable empty positions only. |
| Dashboard note | while any `PLANNED` bins exist, a line under the occupancy grid: "Rencana: aisle CI, 200 posisi" (per aisle, Shell and CKB counted apart), linking to `Rak & Lokasi`. Planned bins never enter the % (user decision, 8 Nov). |
| `config/warehouse.ts OCCUPANCY_EXCLUDED_ZONES` | removed; putaway loader (`lib/inbound/load.ts`) filters on owner/state. |
| Allocator | `rackLocationPattern` widens to `C[A-Z]`; `aisleSequence` comes from `layout.aisle_order` (passed in by the adapters); the stock adapters drop bins that are not usable for Shell (DB source: from the columns; the allocate page passes the DB's unusable codes into `withConfig({ blockedBins })` for a workbook source too). `config.blockedBins` stays as the offline fallback for the CLI with a comment saying the DB is the source of truth. `selectNextBin` untouched. |
| Every other reader of `config.blockedBins` / zone lists | read usable bins from the data they already load or are given: `app/(app)/waves/wave-corrections.tsx:285` (`PHANTOM`), `app/(app)/waves/task-post-dialog.tsx:45`, `app/(app)/waves/add-order.tsx:161`, `lib/wave-fix.ts:74`, `lib/allocator/pickface.ts:115` (must never derive a pickface into a CKB / unusable bin), `lib/inbound/load.ts:36` and `:38`. The builder greps for `blockedBins`, `OCCUPANCY_EXCLUDED_ZONES`, `rackLocationPattern` and `'CG'` again before closing the plan. |
| `Gudang 3D` | `NOT_PRESENT` not drawn; `PLANNED` drawn as faint outlines; `BLOCKED` keeps the colour mode but gets a red cage; CKB bins tinted. Uses the same status helper as the page. |
| Labels | `NOT_PRESENT` and `PLANNED` bins cannot be printed. |
| `import_snapshot` | never creates or reactivates over a known bin's state/owner (already keeps status; must keep the new columns). A file row with stock in a `NOT_PRESENT`/`PLANNED` bin is **skipped and reported** with SKU and cartons ("lokasi tidak ada / belum dibangun"), so someone finds where that stock really is (user decision, 8 Nov; the one deliberate exception to "import reports, does not reject": stock cannot sit in a bin that does not exist). Rows for CKB-owned bins are skipped and reported (§5.3). `Rak & Lokasi` shows a warning tile with the last import's skipped rows. |
| Rebagging RPCs | set `app.ckb_movement`; source/output bins must be CKB-owned (today CG/CH are, by the migration below). |
| `Pengaturan` | the bin status form (`setBinStatusAction`, a direct client write) is removed; a link to `Rak & Lokasi` replaces it. Layout dimensions stay. |
| RLS on `bins` | the policy `"bins: admin write"` (0003:25) is dropped; `bins` keeps read only. All writes go through the RPCs. |
| `nav-config.ts`, `jobs-pages` test, the job matrix spec | new page row. |

## 9. Migration 0132 (data)

1. Columns, constraints, `bin_changes`, `bin_usable`, RPCs, view changes, `apply_movement` refusals, drop the `bins`
   write policy.
2. Ownership as it is today: aisles CG, CH → `CKB`; CF21A01–CF40A02 → `CKB` and back to `status = 'active'` (they were
   blocked only to lend them, 0120).
3. Phantom bins CE33 (all 10), CE32x02 (5), CE34x01 (5) → `NOT_PRESENT`, inserting the rows if missing, refusing with the
   list if any holds stock (the 0120 pattern).
4. Any other bin already `blocked` → `BLOCKED` with reason "diblokir sebelum 0132".
5. One `bin_changes` change set per step, reason naming the migration, `changed_by_name = 'migrasi 0132'`.

## 10. Tests

- SQL test 93: states and owners (constraint), each RPC's refusals (stock, pickface, open task, wrong role, no reason,
  CKB package / rebagging line / CKB count on an owner change),
  preview = result, history rows per change set, append-only, `apply_movement` refusals (into `NOT_PRESENT`/`PLANNED`, Shell
  into CKB, CKB out of Shell, out of `NOT_PRESENT` allowed), `plan_racks` codes and positions, `cancel_planned` refused
  once referenced, `empty_bins`/occupancy exclude unusable bins, import keeps state/owner, skips + reports stock in a
  `NOT_PRESENT` bin and leaves CKB bins untouched under `full_sync`, rebagging refused on a Shell rack bin, migration
  step 3 refusal message.
- Update tests that hard-code the old rules (0098 occupancy, rebagging, 82, putaway).
- TS `tests/racks.test.ts`: plan geometry (aisle → rows → bays → positions, same as `recompute_bin_positions`), selection
  ranges and level narrowing, `usableForShell`, code-range text, colour override order.
- Allocator regression: a CKB-owned bin with earlier expiry is never picked, FEFO order otherwise unchanged
  (`one-bin-per-line`, `picklist-sisa-replay` still pass).

## 11. Left to the builder

Component structure, SVG vs CSS grid, exact copy of messages, pagination size, how the preview is cached between preview
and confirm, the order of the plan in which these land (suggested: DB model + guards + migration → page read-only →
actions → add racks → 3D/labels/allocator wiring).

## 12. Calls made without the user (check these)

- Change the accepted bins of a mixed selection and list the refused ones (§6).
- Owner changes, `Tidak ada` and racks are admin-only (§6).
- Floor locations carry no owner and are shared (§5.1); rebagging is limited to CKB rack bins + floor locations (§5.3).
- Owner change refused on any stock, CKB package, open rebagging line or CKB count in the bin (§6).
- Yellow `+ Tambah rak` button (§7.6).
- Layout dimensions stay on `Pengaturan` (§3).
