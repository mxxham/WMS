# Form Checker workbook format (inbound check sheet)

Source of truth sample: `data/Form_Checker_20261020.xlsx` (server copy of the uploaded file
`Form Checker 20261020.xlsx`, 20 Oct 2026). Users upload this kind of file on the
"Kartu palet" print page (`/labels/pallet`); the parser `lib/form-checker/parse.ts` implements
it and this document is the specification.

## Shape

- One sheet, name `FORM CHECKER` (fall back to the first sheet if renamed).
- 24 columns, `A:X`, header always in row 1, then data rows. 207 data rows in the sample,
  89 of them fully blank (trailing blank rows are dropped by the reader; mid-file blank rows
  are separators **inside** a shipment block and must not reset forward fill).
- No merged cells, no footer/total row, nothing after the last pallet row.

## Columns

| Col | Header | Role |
|---|---|---|
| A | `Month` | shipment context, forward fill |
| B | `User name` | shipment context, forward fill |
| C | `Shipment No.` | **shipment start** (number, e.g. `109717235`) |
| D | `Item Code` | **item start** (number, e.g. `550074326`) |
| E | `Qty Order` | item context (number) |
| F | `UoM` | item context (text, e.g. `CAR`, `EA`) |
| G | `ASN No` | item context, may be empty |
| H | `Vendor ASN No/Delivery No` | item context, may be empty |
| I | `Act. Qty` | per pallet (number) |
| J | `UoM` | per pallet, actual UoM (text) |
| K | `Pallet ID` | per pallet (12-digit SSCC, e.g. `540000849095`) |
| L | `Bin Location` | per pallet, may be empty |
| M–Q | `GR No`, `Batch No.`, `Manufacture Date`, `Exp Date`, `Putaway no.` | item context, may be empty |
| R–X | `Print Putaway Sheet`, `Container`, `Vehicle No.`, `SEAL`, `TRANSPORTER`, `PALLET LOSCAM`, `PALLET NON LOSCAM` | shipment context, may be empty, parsed but not printed |

## Grouping (forward fill)

The layout mimics Excel merged cells: context is only written on the row that starts it.

1. A row that sets `Shipment No.` starts a new shipment (month + user stay with it).
2. A row that sets `Item Code` starts a new item inside the current shipment
   (qty order, UoM, ASN no, batch no, dates… stay with it).
3. Every following row that carries `Act. Qty` or `Pallet ID` is **one more pallet line of the
   current item**; it may override its own `Act. Qty`/`UoM`/`Pallet ID` only.
   Reality in the sample: one pallet per row. 118 pallet rows over 10 item groups
   (9 distinct item codes; one code arrives in two shipments) over 6 shipments.
4. Item context (batch, GR no, dates, putaway no) extends over the item's pallet rows until a
   new `Item Code` or `Shipment No.` overwrites it.
5. A row where every cell is blank is skipped, but does not clear the current fill context.

## Values

- Numbers stay numbers, item and shipment codes are **not** zero-stripped or reformatted —
  a `noUncheckedIndexedAccess` code can print them as received.
- Date columns (`Manufacture Date`, `Exp Date`) may be Excel serial numbers; convert serial →
  `YYYY-MM-DD` and print as `DD/MM/YYYY`. Empty in the sample; tolerate both empty and filled.
- Strings are trimmed; empty string and `null` mean "not filled".

## Printed card (one card per pallet row, one card per A4 LANDSCAPE page)

Card fields, big enough to read with the pallet stacked up high (A4 LANDSCAPE, print 100%):

- Item code — the largest text on the card.
- Quantity (`Act. Qty`) + `UoM` — 64 pt, a bare number with no field label, the same size as the batch no. `UoM` falls back from the item master to the file.
- `Bin Location` printed as LOCATION — 96 pt, and a full-width write-in line when the file left it empty.
- `Batch No.` — 64 pt so it reads across the floor; when empty, a blank write-in line (checker hand-fills at the dock).
- `Exp Date` / `GR No` / `Putaway no.` in one tiny gray strip at the bottom, only when any of them is filled. `Mfg Date` is parsed but not printed; the item description is not printed either.
- NOT printed (dropped at the owner's request): the month · user · shipment context band, `UPP` and `Pallet ID` — Pallet ID stays in the parsed data, it is just no longer on the card.
- The API also accepts a `shipment` number on `action=print` to print just that shipment's cards; without it every shipment is printed.

## Column detection

The parser first attempts to detect column positions from the workbook's own header row
(row 1). Each header cell is normalized (lowercase, non-alphanumeric characters removed)
and matched against canonical labels:

- `month`, `username`/`user`, `shipmentno`/`shipment`, `itemcode`/`item`, `qtyorder`/`qty`,
  `uom`/`orderuom`, `asnno`/`asn`, `vendorasnno`/`vendorasn`/`deliveryno`,
  `actqty`/`actualqty`/`act`, `actuom`/`actualuom`/`uom2`, `palletid`/`pallet`,
  `binlocation`/`bin`/`location`, `grno`/`gr`, `batchno`/`batch`,
  `mfgdate`/`manufacturedate`/`manufacturingdate`, `expdate`/`expirydate`/`expirationdate`,
  `putawayno`/`putaway`, `printputawaysheet`/`printputaway`, `container`,
  `vehicleno`/`vehicle`, `seal`, `transporter`, `palletloscam`/`loscam`,
  `palletnonloscam`/`nonloscam`.

**Duplicate "UoM" handling:** the first occurrence maps to `UoM` (order UoM), the second to
`ACT_UOM` (actual UoM). Detection relies on column order — the earlier column becomes the
order UoM.

If fewer than the critical columns (Month, User name, Shipment No., Item Code, Act. Qty,
Pallet ID, Bin Location) are recognized, detection fails silently and the parser falls back
to the fixed A..X column map. This ensures existing workbooks without a recognizable header
continue to work.

The summary response includes a `shipmentRows` field mapping each shipment number to the
Excel row ranges (e.g. `3–7, 21–30`) that produced its cards. This makes a mixed-session
file visibly mixed before printing — motivated by an operator file that carried a previous
session's rows at the top and the new session's rows below in shifted columns.
