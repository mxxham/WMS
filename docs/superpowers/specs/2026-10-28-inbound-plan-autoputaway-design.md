# Inbound plan + auto putaway (Penerimaan)

Date: 28 Oct 2026. Status: approved in chat by the user ("go ahead, I will tell you what is not right").

## Intent

Shell sends a daily inbound plan ("INBOUND SHELL, KAMIS 29 OKTOBER 2026"): one row per delivery order with
shipment no, DO no, sales order no, material, description, qty, UoM, total litres, container no, seal no,
transporter, slot time. Blank (yellow) rows separate entries. It is a plan: the truck has not come, and what
arrives can differ (quantity, or another SKU in the container). Admin Inbound uploads the plan ahead, double-
checks what really arrived against it, then the system chooses a bin per pallet (auto putaway), the pallet
cards are printed with their bins on `Kartu palet`, and the pallets go to the bins.

Built on the existing `Penerimaan` (0020): receipts (one per document), receipt_expected (plan lines),
receipt_actuals (per pallet, with to_bin), post_receipt (second person; damaged → QUARANTINE + hold).

## Rules (decided by the user)

- Level by packaging (packOf, lib/inbound/putaway-plan.ts). Corrected by the user 29 Oct: level A is only for
  leftovers below a full pallet. Full pallets: Carton B–E · Drum B–C · Pail A · Fluidbag A–B · IBC A–B
  (fluidbag / IBC on A added by the user 29 Oct). Leftovers: the pickface (level A), every packaging.
- A quantity below the SKU's units per pallet (`items.upp`) goes to the SKU's pickface (level A).
- Batch / how the admin gets it: decided later by the user. Batch and expiry are optional when checking;
  expiry is required when posting (FEFO: stock cannot enter a bin without an expiry).

## Calls made by Claude (user may correct)

- One receipt per Delivery Order (`doc_no` = DO no). Re-uploading a plan skips DOs that already exist and says so.
- Plan header data stored on `receipts`: plan_date (from the title), shipment_no, sales_order, container_no,
  seal_no, transporter, slot_time, source = 'PLAN'.
- Pallets: `floor(qty / upp)` full pallets + one partial pallet for the rest. No upp → one pallet, flagged.
- Bin for a full pallet (user, 28 Oct): grouped per rack (aisle + bay, e.g. CB01). A SKU fills every free allowed
  bin of its rack before moving on, then goes to the nearest next rack (same aisle by bay distance, then the
  neighbouring aisles). The first rack is the one nearest the SKU's pickface; without a pickface, the rack with
  the most free allowed bins, so no rack is favoured by its name (ties only fall back to rack order). Within a
  rack: levels B, C, D, E, A (keep A for picking), then position. Excluded: not active, `blockedBins`, CKB aisles
  CG/CH, any SKU's pickface, bins chosen for another receipt waiting to be posted.
- Partial pallet: the SKU's pickface (may already hold stock). No pickface → nearest empty level-A bin as above.
- Bins can be changed by hand before printing (the existing bin field stays editable).
- Damaged cartons: no bin, to QUARANTINE at posting (unchanged).
- The bin choice is a pure TypeScript function (testable); the database re-checks every chosen bin when it
  is saved (exists, active, level allowed, empty or the SKU's pickface, not reserved by another receipt).
- `Kartu palet` gets a list of checked receipts with "Cetak kartu"; cards come from receipt_actuals through
  the existing `buildPalletCardPdf`.
- Jobs: plan upload and check by `admin_inbound`, `leader`, `admin` (as `Penerimaan`); posting keeps 0020's
  rule (supervisor level, not the checker).

## Not now

- Batch capture method; SSCC pallet IDs; slot-time KPIs (ON TIME / LATE); editing a plan after upload.
