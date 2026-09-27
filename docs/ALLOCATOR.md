# FEFO allocator — rules and engine

The allocation engine in `lib/allocator/` (formerly the standalone
`fefo-allocator` repo). It is a set of pure functions with no I/O. The web app
feeds it stock from the Supabase `inventory_detail` view and demand from the
workbook's `Schedule of the day` sheet. The CLI (`npm run allocate:file`) can
feed it the whole workbook instead. How a saved plan is executed is covered in
the main README, section **Alokasi & wave**.

Quantities are in **cartons (CAR)** throughout. `UPP` = cartons per pallet.

## The rules, in the order they are applied

Per demand line (one shipment + one material; multiple SAP orders for the same
shipment/material are merged and their order numbers kept for traceability):

1. **Eligibility.** A bin is pickable only if it is a rack location
   (`C[A-G]dd[A-E]dd`), status `Aktif`, qty > 0, not blocked, and has at least
   `minRemainingShelfLifeDays` of life left at the run date. `STAGING`,
   `STAGING_INB` and `Quarantine` are never picked from.
2. **FEFO.** The earliest expiry date still on hand, in the pickface *or* the reserve, is served first. No bin with
   a later expiry is touched while stock of an earlier one remains. This is
   absolute — every other rule only operates *inside* one expiry date.
3. **Inside that expiry date**, pickface and reserve together (this is where handling cost lives):
   1. **≥ 1 pallet still needed → a sealed full pallet**, nearest on the route. Reserve
      pallets come before the pickface's own sealed pallet, which is kept for loose
      cartons (opening it there needs no Bin To Bin).
   2. **The loose rest → the pickface**, when it covers the rest.
   3. **One order line, one bin:** a single reserve bin that covers the rest, when that
      costs no extra pallet (it is already open, or the pickface-first split would open a
      sealed pallet anyway). Example: pickface 11, order 30 → one row "30, buka palet →
      pickface, Sisa 18" instead of 11 + 19.
   4. **Otherwise** the pickface first, then an already-open pallet (best fit), and a
      sealed pallet is opened only as the last resort (`breaksPallet`, *buka palet*).
   Examples: order 70 with 26 in the pickface → 1 full pallet + 22 from the pickface, no
   pallet opened; order 164 (UPP 44) with 31 in the pickface → 3 full pallets + 32 from
   one opened pallet, never a pallet opened for 1 carton.

   A pickface may hold more than one batch (Bin To Bin carries whatever pallet was
   opened); each row names the batch, and the oldest batch there is picked first.
   Rows of one order line that end on the same bin/batch are merged into one row.
   Guarded by `tests/one-bin-per-line.test.ts` and `tests/picklist-sisa-replay.test.ts`
   (strict FEFO at every pick on the real workbooks).
4. **Repeat** until the line is filled; any balance becomes a shortage with a
   reason: `ALREADY_STAGED` (stock is already in the staging lane — that
   shipment was picked earlier), `BLOCKED_SHELF_LIFE`, or `NO_STOCK`.

Quantities are in **cartons (CAR)** throughout, matching SAP `Delivery quantity`
and WMS `Qty`. `UPP` is cartons per pallet, read from the WMS row and falling
back to `MASTER DATA`.

### Pickface replenishment — the bin-to-bin part

Run **after** outbound allocation, against whatever stock is left once today's
orders are reserved, so replenishment never takes a carton an order needs.

- **Pickface bin.** One dedicated pick-from bin per SKU. Without an admin
  assignment (`config.pickfaceOverrides`), it's derived automatically as
  whichever bin currently holding that SKU sits earliest on the pick path —
  everything else of that SKU is reserve stock. This mirrors your own design
  (a permanent per-SKU CRUD assignment later); the auto-derivation is just a
  sensible starting point until that exists.
- **Trigger.** A pickface is topped up when its on-hand falls below its
  target level (default: one full pallet, `UPP` cartons — configurable to a
  flat number). If `replenishCoverPendingDemand` is on (default), the target
  also rises to cover today's outbound demand for that SKU, so a big order
  doesn't strand the picker mid-pick.
- **Source selection — identical rule to outbound picking.** Earliest expiry
  first; a whole-pallet need takes a sealed pallet nearest on the route; a
  loose remainder takes from an already-open pallet, best fit, before a sealed
  one is ever broken. This is literally the same function
  (`binselect.ts: selectNextBin`), not a re-implementation — a pickface never
  gets stock out of FEFO order.
- **A pickface bin is never a replenishment source.** It's topped up, not
  drawn from, even if it happens to be sitting on stock of another SKU.

### Movement report — what moved, from what item to where

One combined, chronological ledger:

| Seq | Type | Material | From | To | Qty | Shipment |
|---|---|---|---|---|---|---|
| 1 | REPLEN | 550044709 | CB02E02 | CB20D01 (pickface) | 48 | — |
| 2 | PICK | 550044709 | CB20D01 | STAGING → 109661414 | 44 | 109661414 |

Replenishment rows come first (stock lands on the pickface before the pick
that needs it), then picks, in pick-sequence order. This is the audit trail
for "what did the picklist do to the WMS sheet" — every row is a real bin
quantity change, traceable to a SKU, a batch, and an expiry date.

### Sisa and execution order

Every picklist row's **Sisa** is what physically stays in that bin once the
row is done. It is computed by replaying all lines of the run against real
bin balances (location + SKU + batch + expiry), in one fixed order:

1. NO waves by their **earliest** slot (a wave can hold shipments at
   different slots), then by NO;
2. inside a wave, shipments by slot, then shipment number (one picklist each);
3. inside a picklist, the printed walking order.

This is the order picklists are printed in, the order the saved plan numbers
its tasks in, and the order the Wave page reprints in. So all picklists
agree with each other, whether they are printed together from Alokasi or one
wave at a time from the Wave page.

The replay (`relocateByWaveOrder`, then `settleSisa` in `ledger.ts`) also decides:

- **Where the stock is.** Once an earlier row moved a batch's leftover to the
  pickface, later picks of that batch go to the pickface.
- **Which row opens a sealed pallet**: the first one in execution order.
- **The bin-to-bin move.** A row that breaks a pallet away from the SKU's
  pickface, while the pickface is below its target, carries the leftover to
  the pickface right after the pick. The printed row shows the destination in
  *Bin To Bin* (`CB01A01`) and, as *Sisa*, the leftover to carry (34): what is
  in the bin right after the pick (`sisaPrinted` in picklist.ts). Internally
  `qtyRemainingInBin` is what stays once the move is done too (0). The plan's REPLENISH task, the
  movement report (a REPLEN row) and stock-after-run all read this same
  `moveQty`/`moveTo`; nothing re-derives it.

The Wave-page reprint replays the saved tasks from **current** stock:
completed tasks are undone at what the picker actually did, then replayed
with their actuals. So Sisa stays true after deviations.
`tests/picklist-sisa-replay.test.ts` checks all of this on the real workbooks.

### Pick path

Picklists are sorted by travel order, not by SKU. WSM SUB 2 racks are
**back-to-back blocks**: each aisle code is one block, racks 01–20 on its left
face and 21–40 on its right face, rack 21 directly behind rack 01
(`baysPerSide: 20`). A walking lane runs between one block's right face and the
next block's left face (e.g. CB21–40 face CC01–20), so the route walks
**lanes** in sequence, **serpentine** (every second lane back-to-front, no empty
return leg). At one spot in a lane: ground level first, then the two facing
sides, then position. `baysPerSide: 0` restores the old one-row-per-aisle route. Each line carries a 2-digit check digit
derived from the location code for scan verification.

Forklift work (full pallets) and handpick work (loose cartons) are emitted as
**separate picklists per shipment** (`-FL` / `-HP`), so one operator isn't
switching equipment mid-run. Set `splitPalletAndCaseTasks: false` for one
combined sheet.

---

## Result on the 15 September workbook

| Outbound picking | |
|---|---|
| Eligible rack bins | 1,751 |
| Demand | 73 lines / 17 shipments / 4,800 cartons |
| Allocated | 4,730 cartons — **98.54 %** fill |
| Pick instructions | 206 (100 full-pallet, 106 case) |
| Sealed pallets opened | 26 |
| Picklists | 32 |
| Shortages | 4 lines / 70 cartons — all `ALREADY_STAGED` |
| FEFO violations (audited) | **0** |

| Pickface replenishment | |
|---|---|
| Pickfaces evaluated | 92 |
| Pickfaces replenished | 35 |
| Cartons moved | 3,564 (87 pallet moves, 40 case moves) |
| Sealed pallets opened | 18 |
| Replenishment shortages | 31 SKUs with no reserve stock left to top up from |
| FEFO violations (audited) | **0** — and **0** moves ever draw from a pickface bin |

The four outbound shortages are materials already sitting in `STAGING`
(550049044, 550074326, 550024986, 550025055) — those shipments were picked
before the snapshot was taken. The allocator says so explicitly rather than
reporting a false stock-out.

One bin was rejected as expired, and 8 lines legitimately span more than one
expiry date because FEFO drained the oldest batch first.

---

## Engine layout

```
lib/allocator/
  types.ts, config.ts          domain model; every business rule in one place
  binselect.ts                 the FEFO bin-choice rule, shared by picking and relocation
  allocator.ts                 outbound allocation + relocateByWaveOrder
  pickface.ts                  derives each SKU's dedicated pickface bin
  ledger.ts                    physical-identity ledger (location+sku+batch+expiry)
  picklist.ts, pickpath.ts     task grouping, serpentine travel order, check digit
  movement.ts, double.ts       movement report, double-pick detection
  pipeline.ts                  the full run: allocate → relocate → picklists → reports
  plan.ts                      allocation → `save_plan` RPC payload (waves, tasks, outbound)
  picklist-from-tasks.ts       rebuilds printable picklists from a saved plan
  adapters/inventory-stock.ts  inventory_detail rows → StockBin[] (same rules as the workbook)
  adapters/excel-*.ts          Node/ExcelJS workbook in/out (CLI)
  adapters/pdf-output.ts       A4 picklist PDF (jsPDF)
  browser/                     SheetJS workbook in/out + download helpers (web)
  cli.ts, db-client.ts         command-line entry point; `--db` reads stock via the service key
```

### Configuration worth tuning

| Key | Default | Effect |
|---|---|---|
| `minRemainingShelfLifeDays` | 0 | stock below this is refused |
| `nearExpiryWarningDays` | 365 | flagged, still picked |
| `preferOpenPalletForRemainder` | true | don't break a sealed pallet for a remainder |
| `bestFitOpenPallets` | true | clear the smallest usable fragment first |
| `serpentine` | true | alternate aisle direction |
| `splitPalletAndCaseTasks` | true | separate forklift and handpick sheets |
| `maxLinesPerPicklist` | 0 | split long sheets (0 = never) |
| `blockedBins` | `[]` | bins on cycle count / damage hold |


### Data quality flagged by this run

- 57 duplicate `Lokasi` rows in the stock sheet (mostly staging/quarantine
  lines). Duplicates inside the rack range are reported as `DUPLICATE_BIN` —
  worth resolving before the Postgres migration, since a bin must be unique.
- Bay numbers run to 40 on CB/CD/CF/CG in this workbook. If the physical racks
  are shorter, set `bayLimits` validation when migrating so bogus locations are
  rejected at import rather than at pick time.
