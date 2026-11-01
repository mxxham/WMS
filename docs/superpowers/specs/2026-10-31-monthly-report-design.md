# 2026-10-31 · Laporan Bulanan (monthly report page) — design

## Intent
The **Leader** opens one page and shows it to the warehouse customer
(Shell): the month's goods movement in **liters** and the **SAP
comparison score (accuracy %)**, for screen display only — no print
layout, no PDF export.

## Why
Today these numbers exist but are scattered: recon accuracy lives on the
Inventory page, liters inside picking audit, in/out inside the ledger.
The customer conversation needs them on one page for one month.

## Approach (picked)
A read-only aggregate page in the app, built from data that already
exists. One new database view (`monthly_report`) does the month math;
the page renders screen cards.

Alternatives considered:
- *PDF/print export* — dropped: the user chose screen-only.
- *Compute on the page client-side from many queries* — dropped: month
  aggregates belong in Postgres (1,000-row pagination rule), not in a
  browser loop.
- *Automating the planning-outbound demand file (earlier thread)* —
  parked, not part of this.

## Blocks on the page (month picker, default = current month)
1. **Ringkasan** — badges for: liters in, liters out, closing stock in
   liters (from `wms_stock_by_sku_at(month_end)`), # shipment / DO,
   and the month-end recon's **accuracy %** as the headline.
   Accuracy = the last `stock_recons` with `as_of` in the month
   (`stock_recon_summary.accuracy_pct`, % SKUs where WMS = SAP);
   smaller recons of the month shown as a small accuracy trend.
2. **Pembandingan SAP** — one row per recon in the month: date, SKUs
   compared / matched, accuracy %, |Σ diff|, and the difference-cause
   breakdown (`stock_recon_lines.cause`).
3. **Masuk & keluar per SKU** — table sorted by liters out descending:
   qty + liters in, qty + liters out, closing qty + liters.
   (Liters = qty × `items.volume_l`.)
4. **Aktivitas harian** — per-day: waves, picklists posted, shipments
   loaded — so the month's rhythm is visible.

Not on the page (proposed, leader can veto): picking-audit quality and
near-expiry — internal talk, not for the customer.

## Calls made in this design
- Name: nav entry **`Laporan`**, page title **`Laporan Bulanan`**,
  route `/laporan/[month]` (`YYYY-MM`).
- Gate: **Leader + Admin** through `nav-config.ts` (the one page table)
  with RLS unchanged — all sources are existing readable views.
- Month boundaries are **Asia/Jakarta** days (same TZ discipline as the
  ledger: `README`'s date-boundary tests note).
- Read-only: no RPC writes; nothing append-only is touched.
- UOM caveat: in/out liters come from `movements` × `items.volume_l`
  where `volume_l` is missing → SKU counted by qty only and shown with
  a "tanpa volume" note, never silently dropped.

## Left to the builder
- Exact `monthly_report` view SQL (follow `noop` conventions of
  `0098_dashboard_summary_rpc.sql`), migration number, tests
  (`supabase/tests/86_*.sql`), nav icon/label, empty-month state,
  loading skeleton per page conventions.
- `app/(app)/laporan/[month]/page.tsx` server component + small client
  parts; Indonesian UI strings; cards on phone, tables on desktop.
