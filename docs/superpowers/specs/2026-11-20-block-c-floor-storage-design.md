# Block C — floor storage in a second building — design

Date: 20 Nov 2026 · Status: **phases 1-2 built, phase 3 built incl. the 3D view (0147, 0148, SQL tests 109-111, `tests/block-c.test.ts`, `tests/block-c-allocator.test.ts`); phase 4 and the 3D view open** · Next migration number: **0151**

Source: `BIN FLOOR block-C` workbook the user supplied (40 floor bins `FA-01..FA-20`, `FB-01..FB-20`, drawn as two
facing lanes under a `STAGING` heading; cell `FB-13` is mistyped `FB-03` in the drawing, fix when importing).

## 1. Why

A new building, **Block C**, stores slow-moving SKUs on the floor. The current warehouse (**Oso 5**: racks `CA`–`CG`,
`STAGING`, ...) stays as it is. Stock of Block C items must never end up in Oso 5, and Oso 5 stock of other SKUs must
never end up in Block C. Today `FA-01` is "format tidak dikenal" in the import and every code that picks, puts away or
moves stock assumes a rack bin or a floor lane.

## 2. Decisions (user, 20 Nov 2026)

1. Block C is a separate **site**. Oso 5 = every existing bin. One application, one database, one stock ledger.
2. **Each Block C slot has one dedicated SKU** ("the item is predetermined"). A SKU is a Block C SKU if and only if it
   is assigned to a Block C slot. The user will supply the SKU-per-slot list later.
3. **One SKU may have several slots.**
4. **A SKU may only enter a bin it is allowed in.** A Block C SKU can never enter Oso 5 (Bin To Bin "or anything else");
   any other SKU can never enter Block C; a Block C SKU enters only a slot assigned to it.
5. Oso 5 stock of Block C SKUs moves to Block C by Bin To Bin, into the SKU's dedicated slot. New inbound of a Block C
   SKU goes straight to a Block C slot.
6. **Slot capacity depends on the pack type** (pallets stacked in one slot): Drum 3, Carton 3, everything else (IBC,
   Fluidbag, Pail, unknown) 2.
7. **A stack is one batch and one expiry**, so stacking never conflicts with FEFO. Stock identity is unchanged
   (bin + SKU + batch + expiry).
8. Picking is by pallet or loose cartons. FEFO stays **absolute and global** across both buildings (an earlier expiry
   in Block C beats a later one in Oso 5). `selectNextBin` stays the only ranking function.
9. **One Block C picklist per shipment**, not split into pallet / case lists. The assigned operator picks it, so
   shipment assignment (0110) is unchanged. A shipment has up to three lists: `-FL`, `-HP` (Oso 5) and a Block C list.
10. The Excel stock file includes Block C.
11. SAP: unknown whether Block C is its own storage location. Not needed for the first phases.

## 3. Design

### 3.1 Data

- `bins.site text not null default 'OSO5' check (site in ('OSO5','BLOCKC'))`.
- `bins.assigned_sku` (nullable, set only on Block C slots). Changed through `set_bin_attrs` with a reason; the
  `bin_changes` history (0132, field `ATTR`) records it. No write policy on `bins`, as today.
- Slot capacity is **stored on the slot** (`bins.capacity`, pallets) when its SKU is assigned: the database cannot read
  the TypeScript pack-type lookup, so the app works the number out and `assign_block_c_slots` stores it, and the guard
  enforces the stored number. `PALLETS_PER_SLOT` in `config/warehouse.ts` is the one table (`Drum` 3, `Carton` 3, default 2);
  `packOf` (`lib/inbound/putaway-plan.ts`) gives the pack type. Change a number, then assign that SKU's slots again.
- Floor code pattern `^F[A-Z]-\d{2}$` beside `STAGING_LANE_REGEX`; `parseBinCode` returns kind `floor`, zone = `FA`/`FB`,
  position = slot number.

### 3.2 One database rule (the `movements` guard)

Extend `movements_a_bin_guard` (0132): for every movement that puts stock into a bin, refuse unless

- the bin is `BLOCKC` and `bins.assigned_sku` equals the SKU, or
- the bin is `OSO5` and the SKU is not assigned to any Block C slot.

This one check covers inbound, putaway, Bin To Bin, adjustments, `Stock Opname` adds and the import. It also makes
Block C -> Oso 5 impossible without a separate "one-way" rule. Messages are Indonesian and name the SKU's slot(s).
Capacity: refuse when the pallets in the slot (`ceil(cartons of the SKU / UPP)`) would exceed the slot's stored `capacity`.
Cartons are summed per SKU, not per batch, because a slot holds one SKU in single-batch stacks. Stock already in Oso 5 for a Block C SKU stays until moved; it can only
leave.

### 3.3 Allocator

- `pickableBinPattern` today is rack-only. Make "pickable" data-driven (bin state + site + floor flag), not another
  regex. Block C slots are pickable; they are **not pickfaces** and never replenishment targets or sources
  (`relocateByWaveOrder` must skip them).
- Pick order inside one expiry date still holds: a sealed full pallet when a pallet is needed, the loose rest from an
  open pallet, a sealed pallet opens last, never for 1 carton. Rule 2 ("the pickface covers the rest") has no Block C
  equivalent. A full pallet = a multiple of `UPP`; the remainder is the open one. Needs tests that assert quantities and
  pallet openings.
- Picklist: a third group per shipment. It is a section inside the existing **one fixed order** (print, task numbering,
  Wave-page reprint, `Sisa` replay), never a second sort. `plan.ts`, `picklist-from-tasks.ts` and `save_plan` carry it.
- Route inside Block C: start with `FA-01..20` down and `FB-20..01` back (serpentine, no empty return); confirm on the floor.

### 3.4 Screens

- **`Rak & Lokasi`**: create the 40 bins as `PLANNED`, assign SKUs, activate when built.
- **Bin To Bin**: the destination is filled with the SKU's slot; a wrong slot is refused with the reason.
- **Putaway / `Penerimaan`**: `planPutaway` sends a Block C SKU to a slot with room (first slot with room, ties by
  distance); full -> clear warning, not a silent staging.
- **Import**: reads `FA-xx` / `FB-xx` rows (`import-validate.ts`). `import_snapshot` switches the guard off for the
  import (`app.site_guard = 'off'`, transaction-local) and returns `site_warnings` (`BLOCKC_DI_OSO5`, `SLOT_LAIN`,
  `SLOT_TANPA_SKU`), shown on the Import page; the goods are physically there, so they are booked. Flagging them on
  `Kualitas data` is still to do — open item B.
- **Labels, 3D, `Stock Opname`, per-site reports**: later phases.

## 4. Phases

Phase 1 status: done — migration 0147 (site, assigned_sku, guard, capacity, plan / assign RPCs, import warnings), the
`Block C` tab on `Rak & Lokasi`, auto putaway into a SKU's slots, `FA-01` parsing, SQL test 109, `tests/block-c.test.ts`.

1. `site` + `assigned_sku`, the 40 bins, code pattern, the movement guard and capacity, import, putaway. SQL tests.
2. Allocator: pickable floor slots, the Block C picklist per shipment, tests on quantities / FEFO / `Sisa` order. **Done**: stacks are split into pallet ledgers (`toLedgers`), `palletKind` replays them, `PL-<shipment>-BC`, no migration needed (`save_plan` / `post_task` already take any bin).
3. Labels (floor slot sign), `Stock Opname` by lane, dashboard and occupancy by site, 3D. **Done:** the slot label names its SKU and stack height; the Transfer form fills in and offers the SKU's own slots; `Stock Opname` lists `FA`/`FB` lanes (`apply_rack_check` takes a lane as the aisle, the slot rule still refuses another SKU); the `Block C` tab shows pallets used of room. **3D (0148):** Block C stands in its own area of `Gudang 3D`, far from the racks (`layout.block_c`: origin, slot pitch, lane gap, pallet height, lane order; edited on Pengaturan, saved with the layout), two separate rows (user, 20 Nov: FA 20 slots + FB another 20 = 40, not one combined block; `lane_gap_m` 4 m between the rows is a placeholder, 0150 reverts 0149's touching rows: set the measured value on Pengaturan), each slot a box as tall as its stack (flat plate when empty); buttons fly between Oso 5 and Block C. `recompute_bin_positions` keeps Block C out of the Oso 5 floor row. **Open:** Block C figures on the Dashboard / Home (they still count rack bins only, so Block C is not mixed into Oso 5 numbers).
4. SAP storage-location reconciliation, if Block C turns out to be its own location.

## 5. Open items

- **A. SKU-per-slot list** — from the user, later. Nothing assigns until then.
- **B. Import of a Block C SKU found in an Oso 5 rack** — assumed: warn and import, never reject. Not confirmed.
- **C. SAP** — whether Block C is a separate storage location. Ask whoever handles SAP; shows as a second location in the
  SAP stock overview for a Block C SKU.
- **D. Pack type unknown** (`packOf` returns null) — assumed 2 pallets per slot.
- **E. Walking route inside Block C** — assumed serpentine over the two lanes; confirm on the floor.
- **F. Slot full** — assumed refuse with a warning when every slot of the SKU is full (putaway shows the reason and leaves the bin empty).
- **G. STAGING and QUARANTINE are Oso 5 bins**, so a Block C SKU is refused there too (user: "or anything else"). A damaged
  Block C pallet cannot go to quarantine, and an arrival cannot wait in `STAGING`. Decide whether those two floor bins are
  exempt.
- **H. Bin To Bin** — done on the bin page's Transfer form (`components/bin/movement-actions.tsx`). The Putaway upload page still relies on the database refusing a wrong slot.

## 6. Not doing

- No Block C -> Oso 5 transfer flow (the rule forbids it).
- No separate FEFO pool per building.
- No second SKU list: the slot assignment is the single source.
