# Inventory ledger (Buku stok): SAP book against WMS book, per day

Date: 28 Oct 2026. Status: approved direction; built in two parts (ledger first, then the putaway
arrival date).

## Intent

The warehouse keeps two books of the same stock: SAP (Shell's system of record) and the warehouse's own.
Today the team keeps the comparison by hand in a monthly workbook,
`Book to Book SHELL_OKTOBER_2026_ALL NEW__.xlsx`. Its `BOOK TO BOOK` sheet, for a chosen date, shows per
SKU for SAP and for FISIK (the warehouse) `Stock awal + Inbound − Outbound ± block moves = Stock akhir`, in
cartons and litres, and the difference FISIK − SAP at the end of the day. Differences carry a note that
repeats every day until the gap closes. A `SUMMARY` sheet totals the day.

Checked against the October data: the workbook's FISIK side is effectively a copy of SAP (FISIK stock awal
equals MB52 on all 1,554 SKU-days; FISIK inbound/outbound equal SAP's every day but one). It does not test
the warehouse. This page does, because our side comes from the WMS database: real scans and postings.

The user wants a dedicated page: one upload of SAP's file per day, our side from the database, the same
book-to-book view per date. The workbook is the reference for rules and layout; where this document and
the workbook disagree on a rule, the workbook wins, except where noted.

`Rekonsiliasi SAP` (0021, 0111–0113) stays unchanged: it is where a gap is investigated.

## Goals

- A dedicated page with its own menu entry.
- One SAP upload per day; one day = one ledger entry.
- Per date, per SKU, both books as `awal + inbound − outbound ± block moves ± other = akhir`, unrestricted
  and blocked, every quantity also in litres.
- Difference WMS − SAP on stock akhir (unrestricted, blocked) per SKU; a day's accuracy = share of SKUs
  whose akhir matches on both.
- A summary per date (SAP and WMS totals of awal, inbound, outbound, akhir, cartons and litres).
- Notes on a SKU that stay until the difference closes.
- A list of all uploaded days with their accuracy; a date picker.
- Excel download of a day in the `BOOK TO BOOK` column order.

## Non-goals (this version)

- The workbook's `THROUGHPUT`, `data slow moving` and `Aging Expired` sheets.
- Gap investigation, count requests, supervisor resolution (`Rekonsiliasi SAP`).
- Writing to SAP. Any change to stock: the ledger only reads.

## Anti-goals

- Hiding a difference, or a day showing as matched when SKUs differ.
- A saved day's SAP figures changing after upload.
- Counting the same cartons twice.
- WMS figures that cannot be traced to `Laporan WMS harian` and the putaway history.

## The SAP file

One workbook per day as SAP exports it, e.g. `MB52 2810_28 Oktober 2026.xlsx` (sample
`data/MB52_2810_28_Oktober_2026.xlsx`): sheets `mb52`, `INBD`, `mb51`. `lib/sap-stock.ts` already parses
them (`parseMb52`, `parseMb51`, `dateFromFileName`).

## The SAP book (the workbook's formulas)

Storage location WHS1. Base unit (CAR / EA).

- **One daily file is one SAP day.** The file named `MB52 2810_28 Oktober` holds MB52 = the stock on the
  morning of the 28th, and MB51 = the movements **posted on the 27th** (Excel serial 46322 = 27 Oct). The
  ledger day is the MB51 posting date: SAP **akhir = MB52 as printed**, SAP **awal = akhir minus that day's
  movements**. Same rule as the workbook (MB52 of a morning + that day's MB51 = the next morning's MB52),
  checked on October: it holds for 108–111 of 111 SKUs on most days. With no MB51 rows the day is the
  file-name date − 1. This also explains the 28 Oct match in `Rekonsiliasi SAP`: SAP booked 4,546 cartons
  (Z31) on the 27th and we put them away on the morning of the 28th.
- Inbound = MB51 movements the team labels Inbound: **101, Z31, and 311 into WHS1**; 102 / 312 subtract.
- Outbound = **601**, minus 602.
- Block moves: **344** unrestricted → blocked, **343** blocked → unrestricted (debit side, "S").
- Write-off **Z55** (credit side) reduces blocked.
- Other WHS1 movements (701/702, 551, 311 out to RETN, …) are applied and shown per type, never dropped.
- `akhir unrest = awal unrest + inbound − outbound + 343 − 344 (+ other unrestricted)`;
  `akhir block = awal block + 344 − 343 − Z55` (used backwards: awal from the printed akhir).
- **Chain check**: this day's back-computed awal should equal the previous day's akhir (its MB52). Around
  weekends it does not (3–4 and 10–11 Oct: the Sunday file already contains Sunday's movements). A broken
  chain is shown as a warning on the day ("Awal SAP tidak sama dengan akhir kemarin: N SKU"), never as
  a stock difference.
- `INBD` (received by SAP, not yet in the warehouse) is shown per SKU for information, not compared.

## The WMS book

From the database, built on `Laporan WMS harian` (`wms_day_report`, 0055). Confirmed by the user: **on
hand** is the stock before the day's picks; **remain qty** is after them and is tomorrow's starting point.

**Inbound by arrival date.** Goods arriving on day D are put away and posted on D+1 (the team always enters
today's inbound tomorrow). SAP books them on D. The ledger therefore counts inbound on the **arrival date**:
- Receipts posted through `Penerimaan` (movement `inbound`): their own date.
- Putaways (movement `putaway` with no source bin): the arrival date recorded with the putaway (part 2,
  below). Until part 2 exists, and for putaways posted before it, arrival = posting date − 1, marked
  "diasumsikan" (assumed) on the day.

WMS book for date D (all per SKU, unrestricted/blocked):
- `akhir(D)` = our real stock at the end of D (`remain(D)`) **+ putaways that arrived on or before D but
  were posted after D**. That is the stock SAP should hold, so it is the figure compared with SAP's akhir.
  (This is why on 28 Oct our on hand matched MB52: the morning putaway had arrived on the 27th.)
- `awal(D)` = `akhir(D−1)` computed the same way.
- Inbound(D) = receipts of D + putaways that arrived on D.
- Outbound(D) = posted picks of D, net of un-picks (the report's `pick` column).
- Block moves = movements into / out of `QUARANTINE` bins that day ("ATP to Unserviceable" / back).
- Other = adjustments of D.
- Blocked = stock in `QUARANTINE` bins (the user's definition). Holds are not counted: they are a
  current state with no history, so a past day could not be rebuilt from them.
  Today no stock is in quarantine, so WMS blocked is 0 and SAP-blocked SKUs show as differences: intended.
- The identity `awal + inbound − outbound ± block ± other = akhir` must hold per SKU on our side; a SKU where
  it does not is shown with a warning (a data problem in our own books), and the builder verifies the
  report columns before relying on them.
- **Waiting for putaway**: a day whose next day has no putaway posted yet is marked
  "menunggu putaway"; its WMS side is recomputed when the page is opened, until the day is closed.

## Comparison and accuracy

- Per SKU: akhir WMS − SAP, unrestricted and blocked, cartons and litres; `match` when both are 0. Awal,
  inbound and outbound are shown for both books with differences; only akhir decides `match` (as in the
  workbook).
- Day accuracy = matching SKUs / SKUs in either book's akhir. Also: SKUs differing, total absolute
  difference in cartons and litres.
- A note never turns a difference into a match.

## Notes

The workbook repeats a note daily until a gap closes. In the app a note is written once on a SKU from a
date and is shown on every following day while that SKU still differs; it closes when the user closes it or
when the SKU matches again. Notes are append-only (a change is a new note).

## Volume

Litres = quantity × `items.volume_l` (0091; the workbook's `Master SKU_in volume`). A SKU without a volume
shows "–" and is listed in a warning, never counted as 0.

## Record keeping

- An upload stores the SAP lines as uploaded. SAP figures of a saved day never change; re-uploading a date
  makes a new version (latest shown, older kept).
- The WMS side is computed from the database every time a day is opened. `movements` is append-only, so a
  past day's WMS figures only change when something is posted later with an earlier arrival date (a late
  putaway): exactly the correction the ledger should pick up. No stored WMS copy, no `Hitung ulang WMS`.
- Tables: RLS with `(select public.is_active())`, no write policy, writes only through role-checking
  SECURITY DEFINER RPCs, append-only by trigger.

## The page

- Menu `Buku stok`, section `Stok`, path `/ledger`, jobs `Inventory`, `Leader`, `Admin`; gated through
  `components/app/nav-config.ts`.
- Landing: list of days (date, accuracy, SKUs differing, status: menunggu putaway / selesai, uploaded by),
  newest first; date picker; `Upload file SAP`.
- Upload: choose the workbook → date from the `mb51` posting date (file name as fallback) → confirmation
  sentence ("28 Okt 2026: 106 SKU stok, 40 transaksi MB51. Simpan?"). Refused when the file holds more than
  one posting date or a future date.
- Day `/ledger/<date>`: summary (as `SUMMARY`), accuracy, warnings (chain, assumed arrival, missing volume,
  waiting for putaway), then per SKU in `BOOK TO BOOK` order: Material · Description · UOM · SAP (awal
  unrest, awal block, inbound, outbound, akhir unrest, akhir block) · WMS (same) · WMS − SAP (unrest, block)
  · 344 · 343 · Z55 · quarantine in / out · note. Filter all / only differences. Cards on a phone, table on a
  desktop. Excel download in the same order.

## Part 2: arrival date on putaway (built: 0117)

Built as a wrapper: `putaway_import_arrival` checks the date and calls the unchanged `putaway_import` (0066);
the date is kept per import in `putaway_arrivals`, and `ledger_inbound_moves` finds a putaway's import
through `putaway_log.movement_ids`.

- The putaway page asks `Tanggal barang datang` when a sheet is posted, pre-filled with yesterday, a date
  not in the future. It is stored with every posted line (`putaway_log`) and with the putaway movements'
  import, so the ledger can read it.
- Stock is unchanged: cartons still enter the racks when the putaway is posted.
- The ledger then uses the recorded date instead of the assumption.

## Constraints (AGENTS.md)

- New migrations from **0116**. Pushed migrations are final.
- No write to `inventory`; movements are never edited.
- List queries paginate at 1,000 rows.
- UI Indonesian, code and docs English; every action has a confirmation step.
- Tests: standalone `tests/*.test.ts` with the inline `test()` helper in the `npm test` chain,
  `TZ=Asia/Jakarta` for date logic; SQL tests numbered after 77, PASS/FAIL per row, rolled back.
- Dates are Asia/Jakarta calendar days.

## Calls made on the user's behalf (for checking)

- Accuracy counts akhir only, as the workbook's `match`.
- Notes carry forward until the gap closes.
- Re-upload makes a new version; the WMS side is always computed live from the append-only ledger.
- Menu place, path and jobs.
- Throughput, slow moving and aging later.
- Fallback for putaways without an arrival date: posting date − 1.

## Left to the builder

- Table and RPC names, storage shape, sharing code with `Rekonsiliasi SAP` without changing it.
- Excel styling, phone cards, page loading and pagination.
