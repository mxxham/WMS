# Staging handling (Rekap inbound `STAGE-IN` → staging → rack)

Date: 8 Nov 2026 · Status: approved 8 Nov 2026 (after builder check) · Next migration: 0134

## Why

Drums are received but often cannot go into a rack straight away (no rack room for drums that day), so they wait on
the staging floor, sometimes for days. SAP counts them from the goods receipt. Our WMS does not: the Putaway upload
refuses or skips them, so they vanish from our stock until someone puts them in a rack. The SAP vs WMS comparison then
shows a gap that is not missing stock, and accuracy cannot reach 100%. The user prioritises SAP accuracy above all.

Staging is temporary, but stock in it is real. It needs a place in the ledger while it waits, and a recorded move
when it leaves.

## What the files actually show (Rekap inbound, 3–6 Nov 2026)

- Staging is written as **`STAGE-IN`** in `BIN Location` (3 Nov: 20 pallets of 550046498, 4 EA each, i.e. drums).
  `QUA-SHELL` also appears (one damaged pallet, Pallet ID `DAMAGE`).
- A **blank `BIN Location` is not staging**: it means admin has not filled that day in yet (the 3 Nov sheet was fully
  blank in one download and filled in the next). Today's parser calls these "still in staging" (`parsePutawayDetail`
  `pending`, `putaway-client.tsx` comment); that wording is wrong.
- The Rekap is **never updated** when a staging drum later reaches a rack (still `STAGE-IN` on 6 Nov).
- **Pallet IDs are reused** across items (540000774460 is a staging drum of 550046498 on 3 Nov and 44 CAR of
  550070613 in CE35C01 on 4 Nov), so a Pallet ID cannot be used to follow a pallet from staging to a rack.

## What exists already (no change needed)

- Bins `STAGING` and `STG_01`–`STG_08` exist (zone `STAGING`, floor locations, no owner, shared).
- Staging stock is picked **only as a last resort**: `STAGING` / `STAGING_OUT` / `STG_xx` are `stagingLocations`; step 6 of
  `allocator.ts` ("Staging last") takes what the racks cannot cover as a hand pick. **The user decided to keep this.**
  A drum can therefore also leave staging by being picked; the staging list simply shows what is left.
- The dashboard already has a staging tally (0132 `dashboard_summary`, `zone = 'STAGING'`, ages <1 / 1–2 / 3+ days
  from `inventory.received_date`).
- The SAP comparison (`wms_stock_by_sku_day`, 0113) counts every non-quarantine bin as unrestricted stock, staging
  included. Once drums are booked into `STAGING`, the comparison is right without any change.
- A move from one bin to another is a `transfer` movement (as `components/bin/movement-actions.tsx` posts it); the
  database guards (`apply_movement`, `movements_a_bin_guard`, `bin_usable`) already refuse an unusable target rack.

## Goals

1. **Upload:** the same Rekap inbound file on the same `Putaway` page. A `STAGE-IN` row is booked into the `STAGING`
   location (with its arrival date, like every other row), instead of failing as an unknown bin. A staging row is
   **additive**: it skips the rack conflict checks of `putaway_import` (`bin_occupied`, `qty_differs`, `moved_in`),
   which assume one bin = one known content; staging always holds a mix. It is **posted once**: an arrival day's
   staging line (arrival_date + SKU + batch + expiry, after the existing per-key summing) is recorded in a new
   append-only table, and a re-upload of that day reports it as "sudah dicatat" and posts nothing. (Pallet IDs are
   reused and the Rekap is never updated, so this day key is the only safe guard against a double count.)
2. **Staging page** (`Staging`, new): every stock line currently in a staging location: SKU, description, batch,
   expiry, qty, UoM, location, arrival date and **days waiting** (oldest first). Lines waiting 3 days or more are
   highlighted, the same rule as the dashboard's staging tally (one rule, not two).
3. **Into a rack:** on that page the Inventory team picks a line, scans (or types) the rack label, confirms the qty
   (default: all of it; a part is allowed, drums can go to several racks), and posts. This is one `transfer`
   movement from the staging location to the rack. It is the only record of the move, so it must be quick on a phone.
4. The SAP comparison counts staging stock the whole time (already true, see above).

## Non-goals

- No change to the SAP comparison, the allocator, or `full_sync` snapshot import.
- No Pallet ID tracking (IDs are reused; see above).
- `QUA-SHELL` (quarantine/damage) rows: not part of this; they keep today's behaviour. Worth a later look.
- No automatic putaway suggestion for staging drums (the existing auto putaway can come later).

## Anti-goals (would make this a failure even if it works)

- A drum counted twice (staging and rack) or vanishing between them.
- A blank `BIN Location` row booked into staging (it is just not filled in yet; booking it would invent stock).
- A re-upload of a day's Rekap booking its staging drums a second time.

## Decisions made with the user

- Same Rekap inbound file, same `Putaway` page; no new file.
- The move from staging to a rack is recorded by a manual scan on our page by the **Inventory** team.
- Staging stock stays pickable as a last resort (today's allocator rule); no allocator change.
- Staging stays a location in the ledger (every stock change goes through `movements`), but the user manages it as a
  waiting list, not as a bin.

## My calls (builder may refine; flag if they turn out wrong)

- **Code mapping:** `STAGE-IN` (and `STAGE IN`, `STAGING-IN`, `STAGING`, any code starting `STAG`) maps to the
  `STAGING` bin in the putaway parser. One place, one function, unit-tested. `STG_xx` codes stay as they are.
- **Blank `BIN Location`:** keep skipping and counting them, but the message says "belum diisi" (not filled in yet),
  not "di staging".
- **Who:** the `Staging` page and its move are open to `Inventory`, `Admin Inbound`, `Leader`, `Admin`
  (nav-config page table). The putaway upload itself stays `Admin Inbound` / `Leader` / `Admin` (unchanged). The
  movements insert policy lets any active user post a transfer, so `staging_to_rack` does its own job check.
- **Arrival date / days waiting:** the staging line's arrival date (the putaway's `arrival_date`, which already
  feeds `inventory.received_date`-style ageing; builder picks the exact source, but the page and the dashboard tally
  must agree). A read-only SECURITY DEFINER RPC `staging_stock()` in migration 0134 returns the lines; the page reads
  only that. `is_active()` and role checks as every new function.
- **Drums staged before go-live** older than the 7-day arrival window of `putaway_import_arrival`: not backfilled;
  the existing `Adjust stok` / cycle count covers them. Staging rows keep the same 7-day window.
- **Posting the move:** a small RPC `staging_to_rack(p_bin_from, p_item, p_batch, p_expiry, p_qty, p_bin_to,
  p_by_name)` in 0134 that inserts one `transfer` movement (so the source must be a staging location, and the
  sentence is consistent), rather than a raw insert from the page. The existing triggers do the validation. It
  refuses to move quantity reserved by an open pick task on that staging line (reservation rule: operators cannot
  move reserved stock), with a message naming the wave.
- **Putaway result:** after posting, the result says "N baris masuk staging" with a link to `Staging`.
- **Dashboard:** not changed; its staging tally already counts these lines once they are booked.
- Page layout: cards on a phone, a table on a desktop, the bin plate style for locations, Indonesian UI, one
  confirmation with a summary sentence ("Pindah 4 EA 550046498 dari STAGING ke CB12A01?"), nothing after posting.

## Tests

- TS: the code mapping (`STAGE-IN` → `STAGING`, blank stays skipped, rack codes untouched) in the putaway-sheet test;
  a parse of the real 3 Nov sheet shape (20 `STAGE-IN` rows become 20 rows to `STAGING`, summed per
  SKU+batch+expiry by the existing rule).
- SQL test 98: a staging row posts into a `STAGING` bin that already holds other SKUs (no conflict); the same day's
  row a second time posts nothing; `staging_stock()` lists a staged line with its arrival date; `staging_to_rack`
  moves part and all of a line, refuses a non-staging source, an unusable rack (CKB / NOT_PRESENT), more than is
  there, reserved quantity, and a job outside the list; the SKU's stock total is unchanged by the move.
