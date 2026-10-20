# Tunda shipment into STAGING, back as "NO RESCHEDULE" — design

Date: 2026-10-12 · Status: approved by the user in chat, part by part (Parts 1–4)

## Why

On 12 Oct the trucks for NO 5, 6 and 7 did not come. The floor had picked some of the goods and
left them on the staging floor. The system had no way to say so:

- `Tunda` (set_wave_status RESCHEDULED) works per wave only, refuses a wave that is already Selesai,
  and keeps the open picks reserved in the racks. Posted picks have already left stock ("Truk"),
  so cartons waiting in staging are invisible: 109714050 (NO 6, 792 cartons picked and posted, not
  loaded) is in stock nowhere.
- So the user used `Batal` instead, and the next re-run of `Alokasi` for 12 Oct skipped those
  shipments ("3 shipment dilewati…": waves of the date that are done, Tunda or Batal are kept).
- The 13 Oct `Schedule of the day` lists the postponed shipments at the bottom **with yesterday's
  NO** (109713885 NO 5, 109714050 NO 6, 109713888 NO 7), while 13 Oct has its own NO 5, 6, 7. Waves
  are grouped by the file's NO, so they would merge into today's waves, and 109714050 would be
  planned and picked a second time.
- A carried-over Tunda wave (0036/0037) is either planned fresh (nothing posted: lands in the
  file's NO, merged) or renamed `T<NO>` (something posted). Neither matches the floor.
- The morning import (`import_snapshot`, full sync, 0018) zeroes every bin absent from the WMS
  file. The WMS file's `staging` rows are empty templates (staging is tracked by hand in its
  `staging` sheet, per shipment), so any stock in `STAGING` would be zeroed every morning.

## Decisions (from the user)

- **Approach 1:** Tunda moves the cartons already picked back into stock at bin `STAGING`. Normal
  shipments are unchanged (a pick still leaves stock at once). Every pick going to staging until
  `Muat` (approach 2) was considered and not chosen.
- **Per shipment**, also on a Selesai wave, as long as the shipment is not loaded.
- **Picked part:** into the one `STAGING` bin.
- **Not-yet-picked part:** asked at Tunda time: keep reserved in the racks, or release.
- **Next day:** its own wave named after the **origin NO**: `6 RESCHEDULE`. Never merged with the
  day's waves. The NO the file gives it is ignored.
- **Staged cartons leave through tasks** "ambil dari STAGING" that are posted like picks, then audit
  and `Muat` as usual.

## 1. `Tunda shipment` (migration 0073)

### The action

`Wave` page → wave menu → `Tunda shipment` replaces the wave-level `Tunda`. The dialog:

- lists the wave's shipments with a checkbox each (all ticked); a loaded shipment
  (`shipment_loads`) is shown and cannot be ticked;
- when a ticked shipment has open picks: `Yang belum dipick` — `Tetap dipesan di rak` (default) or
  `Lepas (direncanakan ulang besok)`;
- name (`Nama Anda`) and reason, then the confirmation sentence, e.g.
  `109714050: 792 karton yang sudah dipick masuk STAGING, 0 karton belum dipick. Besok jadi wave
  6 RESCHEDULE.`

Supervisor or admin. Allowed when the wave is `PENDING` or `COMPLETED` (not `RESCHEDULED`,
`CANCELLED`).

### `tunda_shipment(p_wave_id, p_shipments text[], p_keep_open boolean, p_by_name, p_reason)`

One transaction, SECURITY DEFINER, `has_role(supervisor, admin)` (a deactivated account is already
refused by `check_request`). No new table, so no new policy.
For each shipment:

1. **Parked wave.** A new `waves` row on the same `planned_date`: status `RESCHEDULED`,
   `wave_no = '<NO> RESCHEDULE'` (`'<NO> RESCHEDULE-2'`, `-3` … when taken that day; `<NO>` is the
   origin's NO without an earlier ` RESCHEDULE…` suffix), `shipment_numbers = [shipment]`, the
   origin's truck, destination and slot. New columns on `waves`: `origin_wave_id uuid`,
   `origin_date date`, `origin_wave_no text` (null on every other wave). The shipment's `outbound`
   rows move to it (`wave_id`), status back to `PLANNED`.
2. **Picked cartons into STAGING.** For every posted (`COMPLETED`) PICK task of the shipment,
   grouped by item + actual batch + actual expiry: one movement of the new type **`staging`**
   (`alter type movement_type add value 'staging'`): `to_bin_id = STAGING`, no `from_bin_id`,
   quantity > 0, note `Tunda <shipment> NO <origin NO> <date>: <reason>`. `apply_movement` adds it
   to `inventory` like an inbound (identity bin + SKU + batch + expiry). It is not an adjustment: no
   reason code, no approval threshold. The posted pick tasks and their movements stay unchanged
   (the ledger is never edited) and stay in the origin wave.
3. **"Ambil dari STAGING" tasks.** In the parked wave, one PLANNED PICK task per staged identity,
   `from_bin = STAGING`, the shipment number, the staged quantity. Being open, they reserve the
   cartons (`open_pick_tasks` / `planning_stock`). `outbound.quantity_picked` goes down by the
   staged quantity.
4. **Open picks.** Keep: the shipment's PLANNED picks, with a PLANNED Bin To Bin paired to them
   (`pairMoves` rule: same pallet, neighbouring seq), move to the parked wave, renumbered after the
   staging tasks. Release: they are cancelled (as `Batal` does), with their paired open moves.
   A PLANNED Bin To Bin paired to a *posted* pick stays in the origin wave.
5. **Origin wave.** If no shipment with open work is left, it closes: `COMPLETED` when it has
   posted picks (they are the record of the day), `CANCELLED` when nothing of it was ever posted.
   Otherwise it stays as it was.
6. `execution_events` on both waves: who, why, how many cartons to STAGING, kept/released.

Refusals: shipment not in the wave, loaded, wave status not allowed, nothing to postpone
(no posted and no open picks).

### Import

`import_snapshot` full sync no longer zeroes stock in bins whose `zone = 'STAGING'`
(`STAGING`, `STG_01`–`STG_05`). Everything else unchanged. (Redefined in 0073 from its latest
body.)

### Batal of a parked wave

`set_wave_status(..., 'CANCELLED')` on a wave with `origin_wave_id`: its tasks are cancelled as
today; the STAGING cartons stay in stock, unreserved. The dialog warns
`<n> karton tetap di STAGING: kembalikan ke rak lewat Mutasi.`

## 2. The next day in `Alokasi`

- `parked_orders` also returns `origin_wave_no`, `origin_date` and, per order line, `covered`: the
  quantity of the parked wave's PLANNED picks for that shipment + SKU (staging tasks + kept rack
  picks).
- Matching unchanged (`matchParked`: same SKU and same shipment number or a shared Order No).
- A parked wave with `origin_wave_id` is **always carried** (`mode: 'carry'`), whatever was posted.
  Older parked waves (no origin) keep today's behaviour (fresh / `T<NO>`).
- `carry_over_wave` on such a wave keeps its `wave_no` (`6 RESCHEDULE`), adding `-2`, `-3` only when
  the new date already has that name. Older waves still become `T<NO>`.
- Per matched line, `need = file quantity − covered`:
  - `need > 0` (released part, or the order went up): that quantity is planned with the rest of the
    day (FEFO, same engine) and merged into the RESCHEDULE wave (`merge_into_carried_wave`).
  - `need < 0` (order went down): nothing is cut; the preview warns
    `<shipment> · <SKU>: jadwal <q>, sudah <covered> (STAGING/rak); ubah lewat Ubah jumlah order.`
  - New item of the shipment: planned and merged (as today). Parked item absent from the file:
    stays in the wave, listed in the preview (as today).
- A parked shipment absent from the day's file stays Tunda; its cartons stay in STAGING, reserved.
- Preview: a `Dilanjutkan` block per shipment, e.g.
  `109714050 → 6 RESCHEDULE: 792 dari STAGING, 0 direncanakan`. The `dilewati` message does not
  include these shipments.
- Order of work: the RESCHEDULE wave takes the file's `Arrival Slot Time` for that shipment; the one
  fixed order (earliest slot, then NO, then printed walking order) sorts `6 RESCHEDULE` right after
  `6`. That order is the print, numbering and `Sisa` replay order, changed in its one place.

## 3. Screens

- **Wave page:** parked wave `6 RESCHEDULE` with the Tunda tag and
  `dari 12 Okt NO 6 · 792 di STAGING · 0 di rak`; after carry-over the same line under the name.
- **"Ambil dari STAGING" rows:** ordinary PICK rows, source `STAGING`; posted from the phone card,
  the wave page and `Isi dari picklist`. Confirmation: scan a `STAGING` label (printable from
  `Label`) or type `STAGING` (`rack_scan_check`, counted `ketik`).
- **Printed picklist:** a `Dari STAGING` section first (pallets on the floor by the dock), then rack
  lines in walking order.
- **Inventory / bin view:** STAGING rows show `untuk SH <shipment> (<wave_no>)` from the open
  STAGING tasks.
- **Daily report (`wms_harian`):** STAGING bins leave the `WMS` sheet (so `KOMPARASI` stays racks
  against racks) and get a `Staging` sheet per shipment: shipment, customer, SKU, description,
  quantity, UOM.

## 4. Edge cases

- Loaded shipment: refused.
- Mis-tap: `Lanjutkan hari ini` (carry_over_wave to the same date) makes it an active
  `6 RESCHEDULE` today; post its STAGING lines. No separate undo.
- Audit is per wave + shipment: the RESCHEDULE wave is audited when loaded; the earlier audit stays
  with the origin wave.
- Quantities are cartons (CAR) everywhere, as the rest of the system.

## Testing

- SQL `supabase/tests/43_tunda_shipment.sql` (every row PASS, rolls back): picked → STAGING
  movements and reservations; keep vs release (incl. paired open Bin To Bin); refused when loaded;
  allowed on a Selesai wave; origin wave closes; full import keeps STAGING stock; carry-over names
  `6 RESCHEDULE` and `-2`; Batal of a parked wave leaves stock unreserved; posting from STAGING with
  a typed confirmation; older Tunda waves unchanged.
- TypeScript (`tests/carry-over.test.ts` and new cases): parked-with-origin always carried; `need`
  planned and merged; lower quantity warned; staging lines first on the printed picklist; daily
  report `Staging` sheet and STAGING out of `WMS`. New files go into the `npm test` chain
  (`TZ=Asia/Jakarta` if they touch dates).

## Rollout

- Migration **0073**, the next number after the repo's 0072 (check the live history first; pushed
  migrations are final). The user pushes and deploys.
- Until it is live, for the 13 Oct file: remove 109714050 from the schedule before `Alokasi` (its
  792 cartons were posted on 12 Oct; audit and `Muat` it on 12 Oct NO 6 when the truck comes); give
  109713885 and 109713888 an unused NO so they do not merge into 13 Oct NO 5 and 7. Once live:
  `Pulihkan wave` NO 5 and NO 7, then `Tunda shipment`.
- README: the Tunda section and the `STAGING` behaviour; `docs/ALLOCATOR.md`: RESCHEDULE waves in
  the fixed order.
