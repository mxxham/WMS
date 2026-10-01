

<h1 align="center">WMS — CKB Warehouse</h1>

<p align="center"><b>PT Cipta Krida Bahari · WSM SUB 2 Surabaya</b><br />Shell lubricant warehouse</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-15-000000" alt="Next.js 15" />
  <img src="https://img.shields.io/badge/React-19-087ea4" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6" alt="TypeScript 5" />
  <img src="https://img.shields.io/badge/Tailwind-3-38BDF8" alt="Tailwind CSS 3" />
  <img src="https://img.shields.io/badge/Supabase-3FCF8E" alt="Supabase" />
  <img src="https://img.shields.io/badge/PostgreSQL-16-4169E1" alt="PostgreSQL 16" />
  <img src="https://img.shields.io/badge/Three.js-0.186-black" alt="Three.js" />
  <img src="https://img.shields.io/badge/Lucide-F565B3" alt="Lucide" />
  <img src="https://img.shields.io/badge/version-2.0.0-orange" alt="v2.0.0" />
</p>

<p align="center"><b>bin labels · scan · 3D · FEFO allocation · picklist · waves</b></p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mxxham/WMS/integrate-bin-system/docs/screenshots/warehouse-3d.png" alt="The Gudang 3D page: the warehouse drawn as rows of racks, each rack stacked with five levels of bins, colour-coded by stock state, with the navigation and the colour legend in view" />
</p>

<p align="center"><sub><b><code>Gudang 3D</code></b> — the whole warehouse in one instanced mesh, drawn only while the camera moves. The legend switches the colour mode: ABC class, stock utilisation, or expiry state. Click a box for its bin detail.</sub></p>

---

> Bin location barcode labels, scanning, 3D stock visualisation, **FEFO allocation, picklists, and wave execution** for the Shell lubricant warehouse — one application, one database, one stock ledger.

**The application UI is in Indonesian.** Page, menu, and button names are quoted verbatim in `backticks` so the instructions below match what is on screen. Everything around them is English.

<p align="center">

[![Features](https://img.shields.io/badge/Features-2563EB?style=for-the-badge)](#features)
[![Key numbers](https://img.shields.io/badge/Key_numbers-0F766E?style=for-the-badge)](#key-numbers)
[![Test status](https://img.shields.io/badge/Test_status-16A34A?style=for-the-badge)](#5-tested--not-yet-tested)
[![Setup](https://img.shields.io/badge/Setup-B45309?style=for-the-badge)](#2-setup)
[![Phases](https://img.shields.io/badge/Phases-6D28D9?style=for-the-badge)](#3-phase-by-phase-files-commands-how-to-test)
[![Design decisions](https://img.shields.io/badge/Design_decisions-9333EA?style=for-the-badge)](#4-design-decisions-for-the-internship-report)
[![Notes](https://img.shields.io/badge/Notes-475569?style=for-the-badge)](#6-technical-notes)

</p>

## Key numbers

<p align="center">

| Bins | SKUs | Stock rows | Total cartons | Allocated | Waves |
|:---:|:---:|:---:|:---:|:---:|:---:|
| **2,570** | **106** | **1,790** | **52,078** | **1,293** | **8** / 51 tasks |

</p>

## Features

| Feature | What it does |
|---|---|
| **Labels** | Rack column strips A–E, 80 × 85 mm cells, vector QR + Code 128 |
| **Scan** | Camera or USB/Bluetooth scanner, auto-focus, submits on Enter |
| **3D** | 2,570 bins in one draw call, render on demand |
| **FEFO** | `planning_stock`, reservation, safe re-plan |
| **Waves** | Idempotent posting, `movements` ledger |
| **Putaway** | Sheet import, per-row conflict decisions, safe to re-upload |
| **Pickface** | One fixed pick bin per SKU, auto-suggested and then locked |
| **Cycle count** | Blind counts, recount by a second person, accuracy tracking |
| **Inventory control** | Stock holds, reason codes, four-eyes approval, receiving, SAP reconciliation, FEFO compliance |
| **Audits** | Blind picking audit in staging and at the rack, putaway audit, WMS-file audit |
| **Corrections** | Undo a posting, split a pick, redirect a move, add items to an open wave |

Full allocation rules: **`docs/ALLOCATOR.md`** · Inventory control: **`docs/INVENTORY_CONTROL.md`** · Verification status: section [5](#5-tested--not-yet-tested) · Data issues: **`docs/DATA_ISSUES.md`** · Column mapping: **`docs/DATA_MAPPING.md`**

<details>
<summary><b>Label sample — 203 dpi print output</b></summary>

<p align="center">
  <img src="https://raw.githubusercontent.com/mxxham/WMS/integrate-bin-system/docs/label-samples/contoh-strip-203dpi.png" width="260" alt="Sample A–E rack label strip, 203 dpi" />
</p>

</details>

---

## 1. Confirm Before Go-Live

The values below are **assumptions**. Change each one in the single file or menu named, not in many places.

<details>
<summary><b>12 assumptions that must be confirmed before go-live</b></summary>

| # | Assumption | Change in |
|---|---|---|
| 1 | Label strip cell order: **A (top) → E (bottom)**; colours A red, B orange, C yellow, D green, E blue | `config/warehouse.ts` → `STRIP_LEVEL_ORDER`, `LEVEL_COLORS` |
| 2 | Arrow direction: position **01 = left**, **02 = right** (facing the rack) | `config/warehouse.ts` → `POSITION_ARROW` |
| 3 | 1 rack bin = 1 pallet (capacity 1) | `bins.capacity` |
| 4 | Rack dimensions for 3D (bay 2.7 m, level 1.6 m, depth 1.2 m, aisle 3.2 m) are **placeholders**. The rack layout itself is confirmed: back-to-back blocks, racks 01–20 on the left face, 21–40 on the right face (21 directly behind 01), with a walking lane between one block's right face and the next block's left face | `Pengaturan` (`Rak per sisi` = 20); pick route: `lib/allocator/config.ts` → `baysPerSide` |
| 5 | ABC classes derived from 91 K_ONE picking rows: **provisional** | `Pengaturan` → `Hitung ulang` (after at least 1 month of picking data) |
| 6 | Aisle **CG** is missing from the `warehouse mapping` status table and was imported as active | `Pengaturan` → `Status & kelas bin` |
| 7 | Racks CC19, CC20, CE33 are missing from the data (columns or pillars?) | check on site |
| 8 | "Near expiry" threshold = 90 days | `config/warehouse.ts` → `NEAR_EXPIRY_DAYS` |
| 9 | Shell lubricant shelf life = **48 months** from the production date encoded in the batch code (matches 97% of the 24 Sep batches); SKUs with a different shelf life are entered by hand | `Pengaturan` → `Aturan inventory`; per SKU in `Master item` |
| 10 | Minimum remaining shelf life to ship = **0 days** (no rule from Shell or the customer yet) | same as above |
| 11 | Adjustment above **20 units** needs approval from someone else; count tolerance for classes A/B/C = **0** cartons | same as above |
| 12 | Scanning the carton barcode when posting a pick is **not mandatory** (the item master has no EAN yet) | same as above, once barcodes are filled in on `Master item` |

</details>

> [!WARNING]
> **Colour vs thermal printers.** A 4-inch direct thermal printer only prints black. The per-level colour bands need one of: pre-printed colour labels, a colour printer, or **Black-and-white** mode in the Label menu (black band, white text). Colour mode is still offered because it follows the sample photos.

> [!CAUTION]
> **Data issues in the 24 Sep 2026 WMS file.** See **`docs/DATA_ISSUES.md`** (bin CC01C01 holds `#VALUE!`, CE08A01 expired in the year 1930, batches CD39C01/C02 whose values Excel read as dates, 129 SKU-bearing bins with quantity 0, and more). Column mapping: **`docs/DATA_MAPPING.md`**.

---

## 2. Setup

### 2.1 Supabase

1. Create a project at supabase.com (Singapore region).
2. Apply the migrations in filename order. The set is 48 files, `supabase/migrations/0001_schema.sql` through `supabase/migrations/0048_add_wave_items.sql`; use the CLI rather than the SQL Editor so nothing is skipped or run twice:
   ```bash
   supabase link --project-ref <ref>
   supabase db push
   ```
   **A project that is already running** (0001–0003 applied): apply everything from `0004` onwards. Section [3](#3-phase-by-phase-files-commands-how-to-test) maps each range of migrations to the feature it delivers. Two worth knowing about: `supabase/migrations/0015_realtime.sql` turns on Realtime (pages refresh themselves, a *Live* dot sits in the title) — without it the pages still work but never receive changes; `supabase/migrations/0004_allocation.sql` changes the stock identity to bin + SKU + batch + **expiry**, and old data stays valid.
3. Run `supabase/seed.sql` (2,570 bins, 106 SKUs, 1,790 stock rows from the WMS file). The file is about 230 KB; if the editor refuses it, use the CLI: `psql "<connection string>" -f supabase/seed.sql`.
4. **Site account**: create one account under **Authentication → Users → Add user** (name it e.g. *Gudang*), then in the SQL Editor:
   ```sql
   update public.profiles set role = 'admin', name = 'Gudang' where id = (select id from auth.users where email = '<site account email>');
   ```
   Fill in `SITE_ACCOUNT_EMAIL` and `SITE_ACCOUNT_PASSWORD` in the hosting environment (Vercel) and in `.env.local`. Every visitor shares this account session, so the app opens straight away.
5. **Authentication → Providers → Email**: turn off "Allow new users to sign up".

Regenerating the seed from a new WMS file:
```bash
pip install openpyxl
python3 scripts/generate_seed.py path/to/Warehouse_Management_System.xlsx
```
For routine updates use the **Import** menu in the app (recorded as movements), not the seed.

### 2.2 Local SQL tests (without Supabase)

```bash
psql -f supabase/tests/00_local_auth_stub.sql   # auth schema + role stub
for f in supabase/migrations/*.sql; do psql -f "$f"; done
psql -f supabase/seed.sql
psql -f supabase/tests/01_rls_and_stock_rules.sql
psql -f supabase/tests/02_allocation_flow.sql            # every row must PASS
psql -f supabase/tests/03_rolling_execution.sql          # every row must PASS (auth stub, not real Supabase)
psql -f supabase/tests/04_putaway_import.sql             # all PASS; rolls back, safe on local Supabase
psql -f supabase/tests/05_pickfaces_counts_corrections.sql  # same
psql -f supabase/tests/06_audits.sql                     # same
psql -f supabase/tests/07_stock_fixes.sql                # same
psql -f supabase/tests/08_cycle_count.sql                # same
psql -f supabase/tests/09_inventory_control.sql          # inventory control (0016–0023), same
psql -f supabase/tests/10_pick_audit.sql                 # picking audit (0024–0026), same
psql -f supabase/tests/11_rack_audit.sql                 # rack audit (0025, 0030, 0031), same
psql -f supabase/tests/12_putaway_rack_audit.sql         # putaway audit (0027, 0028), same
psql -f supabase/tests/13_sheet_pick_audit.sql           # WMS-file audit (0029, 0032), same
psql -f supabase/tests/14_relocate_actual_left.sql       # relocate actual-left (0033), same
psql -f supabase/tests/15_carry_over.sql                 # parked wave carry-over (0036, 0037), same
psql -f supabase/tests/16_pick_order_guard.sql           # pick order guard (0038), same
psql -f supabase/tests/17_pick_found_elsewhere.sql       # pick found elsewhere (0039), same
psql -f supabase/tests/18_putaway_redirect.sql           # putaway redirect (0042), same
psql -f supabase/tests/19_add_relocation.sql             # add relocation (0045), same
psql -f supabase/tests/20_split_task.sql                 # split task (0046), same
psql -f supabase/tests/21_change_relocation.sql          # change relocation (0047), same
psql -f supabase/tests/22_add_wave_items.sql             # add wave items (0048), same
```
Or all of them at once against a temporary local database: `scripts/sql-test.sh`.

### 2.3 Application

```bash
cp .env.example .env.local   # fill in the URL, anon key, service role key (Project Settings → API)
npm install
npm run dev                  # http://localhost:3000
```
Phone cameras need **HTTPS** (or localhost). To test on a phone during development: `npx next dev --experimental-https`, or deploy to Vercel.

Other scripts: `npm test` (the whole TypeScript suite), `npm run typecheck`, `npm run lint`, `npm run build`, `npm run seed:generate`, and `npm run allocate:file` for the CLI.

### 2.4 Deploy to Vercel

Import the repo in Vercel, fill in the same five environment variables, deploy. Vercel detects Next.js on its own (the old `vercel.json` for a static site has been removed).

---

## 3. Phase by Phase: Files, Commands, How to Test

### Phase 1 — Schema, migrations, RLS, seed (`0001`–`0003`)

Files: `supabase/migrations/*`, `supabase/seed.sql`, `scripts/generate_seed.py`, `supabase/tests/*`.

Test:
```sql
select count(*) from bins;                          -- 2570
select count(*), sum(quantity) from inventory;       -- 1790 | 52078
select * from bin_summary where bin_code = 'CA01C01';
```
Test the stock rules and RLS on local Postgres (not Supabase): `psql -f supabase/tests/00_local_auth_stub.sql`, then the migrations, then the seed, then `supabase/tests/01_rls_and_stock_rules.sql`.

### Phase 2 — Import

Files: `app/(app)/admin/import/*`, `lib/import-validate.ts`, `lib/read-sheet.ts`, SQL function `import_snapshot`.

Test: `Import` → choose the WMS file → sheet `WMS` and title row 4 are detected automatically → `Validasi`. Expected result for the 24 Sep file: **2,468 ok, 146 warnings, 1 error** (CC01C01 contains `#VALUE!`). Importing the same file again after the seed gives **0 movements**.

### Phase 3 — Labels

Files: `lib/labels.ts`, `app/api/labels/route.ts`, `app/(app)/labels/*`.

Test: `Label` → one rack → CA / 01 → `Strip` → create the PDF. One page equals one column (position 01 or 02), width 80 mm, 5 cells × 85 mm plus a 22 mm arrow top and bottom = 469 mm. `Per sel` mode is an 80 × 85 mm page. Print at **100%** scale (`Cetak di skala 100%`). Sample output: `docs/label-samples/`.

### Phase 4 — Scan and bin detail

Files: `app/(app)/scan/*`, `app/(app)/bin/[code]/*`, `components/bin/*`, `components/scan/*`.

Test: open `/scan` on a phone → scan with the camera → point it at a label → the bin page opens. Type `XX99` and you get "not a bin format". A pick above the available stock is rejected by the database.

### Phase 5 — 3D warehouse

Files: `components/warehouse/*`, `app/(app)/warehouse/*`, `app/api/warehouse/route.ts`.

Test: `/warehouse` → switch colour mode → click a box → the detail panel opens. Search for `CB12` (all bins of rack CB12) or for SKU `550070612`.

### Phase 6 — Dashboard and reports

Files: `app/(app)/dashboard/page.tsx`, `app/(app)/movements/page.tsx`, `app/api/movements/export/route.ts`, `lib/movement-query.ts`.

Test: `Dashboard` shows 2,570 total bins plus stock on hold, expired and near-expiry stock, the ABC breakdown, and the audit accuracy figures. `Mutasi` → filter type `adjustment` → export .xlsx.

### Phase 7 — Allocation and waves (`0004`–`0007`)

Files: `lib/allocator/*` (the FEFO engine, pure functions with no I/O), `app/(app)/allocate/*`, `app/(app)/waves/*`, `supabase/migrations/0004_allocation.sql`, `docs/ALLOCATOR.md`.

Daily flow:
```
WMS file (sheet "Schedule of the day") ────────┐
                                               ├─► FEFO allocation (browser) ─► Save plan ─► waves + pick_tasks + outbound
Database stock (inventory_detail) ─────────────┘
                                                    (supervisor)                 (stock unchanged)
                                                                     │
            inventory ◀── trigger ◀── movements (picking / transfer) ◀── Post task / Complete wave (operator)
```

- **`Alokasi`** (supervisor/admin): upload the daily WMS file → date and options → `Jalankan alokasi` → review the picklist, shortages, planned movements, pickface, and double picks → download PDF/Excel → `Simpan rencana`. The stock source *Sheet WMS di file* is a simulation and cannot be saved.
- **Planning stock = physical stock − stock already reserved by open tasks + stock coming in** (`planning_stock`). A plan for another date, or another wave, cannot consume the same cartons.
- **`Wave`** (all roles): confirm one task or one whole wave. Database stock changes at that moment, through the `movements` ledger.
  - *Posting → `Sesuai rencana`*: exactly what the plan said.
  - *Posting → differs from the plan*: enter the quantity actually taken (0 is allowed), the real source bin and batch, and a reason (mandatory). Stock is deducted from the bin that was really used, and the order records what was taken.
  - *`Selesaikan wave`*: every remaining task as planned, in a single transaction.
- **Recalculate remaining waves** (supervisor): waves that have not been worked on (still *Menunggu*, with no task posted or cancelled) are recalculated from current stock, without a file. Waves already running, parked, or cancelled are left alone. Running `Alokasi` again for the same date also replaces only the untouched waves; shipments of running waves are skipped.
- **Audit gate before loading** (all roles): every picked line is checked blind by someone other than the picker before the shipment can be loaded — see [Phase 11](#phase-11--picking-and-putaway-audits-00240032).

### Phase 8 — Putaway, pickfaces, cycle count, data quality (`0008`–`0014`)

Files: `app/(app)/putaway/*`, `app/(app)/pickfaces/*`, `app/(app)/counts/*`, `app/(app)/data-quality/*`, `app/(app)/adjust/*`, migrations `0008`–`0014`, `docs/INVENTORY_CONTROL.md`.

- **`Putaway`** (supervisor/admin): upload the WMS file → the *data putaway* sheet is picked automatically → every row is compared with what the bin holds now. *New* (empty bin) is posted as a putaway movement; *Already recorded* (the bin already holds the same thing) is skipped, so the same file is safe to upload again. *Conflict* is shown next to the bin contents in the system and is not posted until you choose: a different quantity → add to it or match it; a bin holding other stock → put it beside. Unknown bins or SKUs, blocked bins, and duplicate rows are only reported. The conflict report downloads as .xlsx.
- **`Pickface`** (supervisor/admin): one fixed pick bin per SKU. Allocation and *Recalculate remaining waves* use it for replenishment. An SKU without a pickface keeps using the automatic suggestion (the earliest level-A bin on the route), which never takes another SKU's fixed bin. *Fill the suggestions for everything not yet fixed*, then *Save* locks in today's choices.
- **`Cycle count`** (all roles): a count task per bin. Created by hand by a supervisor, from the Data quality page, or automatically when posting a putaway with an undecided quantity or contents conflict (one open task per bin). The operator counts the whole bin without seeing the system quantity; a supervisor sees the difference and then either *Applies* it (recorded as an adjustment `HITUNG <bin>`) or *Closes without changes* with a reason. A count that differs from the bin's class tolerance must be recounted by a different person.
- **`Kualitas data`** (supervisor/admin): a direct check of the stock — rack stock without a batch, batches that are really dates (the original serial number is recommended), missing expiry, already expired on the rack, rack bins holding more than one pallet. Batch and expiry are corrected with two adjustments (`KOREKSI <bin>`, quantity unchanged); refused while that stock is still used by an open wave task. Expired stock and pallet overflows are sent to Cycle count.
- **`Adjust stok`** (supervisor/admin): swap the contents of two bins, correct an expiry date, or add a SKU the item master does not have yet. Every adjustment needs a reason code and a name.
- **Protected stock**: an operator cannot move or pick manually (bin page) stock reserved by open tasks. A supervisor can; tasks that no longer fit are marked red (`stok kurang`) on the `Wave` page with a recalculate button.
- **Bin scan**: the bin page shows the planned tasks that take from or fill that bin.
- **Stock ledger**: *`Mutasi`* is every stock change (type, SKU, batch, expiry, quantity, from/to bin, who, when, note; rows coming from wave tasks record the deviation). It cannot be edited or deleted.
- **CLI** (no browser): `npm run allocate:file -- data/file.xlsx --out out --as-of 2026-09-24 [--db] [--pdf]`.

Test: `npm test`. SQL: `supabase/tests/04`–`08`.

### Phase 9 — Realtime (`0015`)

Enables Supabase Realtime on the tables the pages subscribe to. Without it the app still works, but the *Live* indicator never lights up and open pages do not refresh on their own.

### Phase 10 — Inventory control (`0016`–`0023`)

How it works, the rules, and the daily routine: **`docs/INVENTORY_CONTROL.md`**. Migration `0016` adds one policy that every control reads (`inventory_policy`: shelf life, dispatch minimum, near-expiry days, count tolerance per class, adjustment approval threshold, IRA and picking-accuracy targets, recount-on-variance and scan-on-pick flags) plus the item master fields (barcode, shelf life, minimum remaining shelf life per SKU) and Shell batch-code decoding.

- `0017` **Stock holds** — a hold says "this stock may not ship" without moving it: waiting for QC or Shell, damaged, under investigation, recalled, expired, customer return. A hold covers part or all of one stock line.
- `0018` **Adjustment control** — every movement carries a `reason_code` from a fixed list, the name typed on the floor, and a four-eyes approval for movements above the threshold.
- `0019` **Blind counts** — the counter never sees the system quantity; a count outside the bin's class tolerance goes to `RECOUNT` and a different person counts it.
- `0020` **Receiving** (`Penerimaan`) — a receipt is opened from the delivery document number and its lines; the checker at the dock records what is physically there; posting into stock must be done by someone other than the checker.
- `0021` **SAP reconciliation** — uploads Shell's SAP book stock per SKU (plant I003 / WHS1, batch "UT", split Unrestricted / Blocked) and snapshots both sides, so a difference can be explained per SKU and per batch.
- `0022` **FEFO compliance** — every rack pick in the period where a batch was taken while an older expiry of the same SKU was available in that rack at that moment becomes an exception, plus live page updates.
- `0023` **Pick confirmation** — the picker's name on the movement and a carton barcode check: a scanned code must resolve to the task's SKU.

Pages: **`Inventory`** with the tabs `Stok`, `Expired & FEFO`, `Bin kosong`, `Hold & karantina`, `Akurasi & adjustment`, `Rekonsiliasi SAP`, `Persetujuan`; **`Penerimaan`**; **`Master item`**; and **`Lacak batch`** for a batch's whole history.

Test: `supabase/tests/09_inventory_control.sql`, `tests/batch-code.test.ts`, `tests/sap-stock.test.ts`, `tests/min-shelf-life.test.ts`, `tests/stock-accuracy.test.ts`.

### Phase 11 — Picking and putaway audits (`0024`–`0032`)

- `0024` **Picking audit** — every picked line is checked blind by someone other than the picker before the shipment is loaded. The checker counts the cartons on the pallet, and the shipment cannot be loaded until every line passes.
- `0025` **Rack audit** — instead of walking the staging lanes, the checker walks the racks and counts what is *left* in each picked bin. What should be left is rebuilt from the picks of the day.
- `0026` fixes the accuracy KPIs: a wave cancelled after some of its lines were audited no longer counts them.
- `0027` **Putaway audit at the rack** — per putaway the checker scans or types the SKU, types its batch, and counts it; the database compares all three.
- `0028` lets operators be the checker on putaway audits; the named checker may not be the person who did the putaway.
- `0029` and `0030` run the same two audits against the WMS workbook instead of `pick_tasks`, for the days when the K_ONE picklist is the source of truth.
- `0031` lets the checker record a *wrong item* found in the bin, which becomes its own follow-up.
- `0032` lets a supervisor re-record a count that was saved by mistake.

Pages: **`Audit picking`** (per shipment, per rack, per WMS file, plus an accuracy view and a download per line or per bin) and **`Audit putaway`**.

Test: `supabase/tests/10`–`13`, `tests/pick-audit.test.ts`, `tests/sheet-audit-export.test.ts`, `tests/putaway-audit-export.test.ts`.

### Phase 12 — Wave corrections and floor exceptions (`0033`–`0048`)

Everything here exists because of something that happened on the floor; each migration header records the real case.

- `0033` a relocation carries what is *really* left in the bin, not what the plan assumed, when a broken pallet is picked short.
- `0034` **`Batalkan posting`** undoes a posting and puts the stock back exactly as the posting took it; an order's quantity can be corrected afterwards. Both stay in the ledger.
- `0035` a pick and its pallet's leftover move post as one line on the wave page, the way the picklist prints them.
- `0036` and `0037` a parked (*Tunda*) wave that comes back on a later schedule — possibly under a new shipment number and with extra items — is carried over instead of being re-planned from scratch.
- `0038` picks are worked in plan order, and a pick that finds less than planned becomes a count instead of silently taking stock from elsewhere.
- `0039` a pick whose cartons are physically in another bin than the books say can be posted from that bin (`Bin lain`).
- `0040` and `0041` SKUs missing from the item master are added from the WMS file, and an item's description, UoM, UPP, and volume can be edited. UPP decides what counts as a full pallet in the next `Alokasi`; volume is the litres per unit.
- `0042` a putaway sheet row whose bin holds other stock can be sent to the bin the pallet really went to (`Pindah ke bin lain`).
- `0043` `Bin kosong` lists active rack bins that hold nothing and are not the target of an open task, so a pallet without a planned destination has somewhere to go.
- `0044` **`Tambah order`** allocates a late order straight onto a day without the *Schedule of the day* sheet and without re-running `Alokasi`.
- `0045` **`Tambah Bin To Bin`** adds a move for what a pick leaves behind when the plan had none; `0047` **`Ubah Bin To Bin`** sends an open move to a different destination.
- `0046` **`Pecah`** splits an open pick in two so each part can be posted from its own bin.
- `0048` **`Tambah item`** allocates more cartons of a SKU, or a new SKU, onto a wave that already exists.

Test: `supabase/tests/14`–`22`, plus `tests/carry-over.test.ts`, `tests/pair-moves.test.ts`, `tests/pickpath.test.ts`.

---

## 4. Design Decisions (for the Internship Report)

<details open>
<summary><b>Data and integrity</b></summary>

- **Stock only changes through the `movements` table.** The `apply_movement` trigger in the database validates and changes `inventory`; `inventory` has no write policy at all, so the app, the API, and a user cannot change stock without a trace.
- **Stock is validated in the database, not in the UI.** Two operators picking at the same time stay safe because the stock row is locked (`FOR UPDATE`) before it is decremented.
- **The ledger cannot be edited or deleted.** A correction is a new movement (an adjustment), which is normal warehouse audit practice.
- **The author of a movement is forced to be the session account.** The trigger fills `user_id` from the session, so a `user_id` sent by the client is ignored.
- **Opening balances and imports are recorded as `adjustment`.** The initial stock figures can be traced back to the file they came from.
- **An empty batch is stored as `''`, not NULL.** A unique key on (bin, SKU, batch) in Postgres does not consider two NULLs equal; `''` prevents duplicates.
- **A snapshot import does not touch bins whose rows had errors.** Without this, one mistyped row would reject physical stock that really exists.
- **An impossible expiry year (e.g. 1930) is imported as a warning, not rejected.** The goods are physically there; rejecting the row would remove real stock from the system.
- **Remain Qty is used, not Qty.** Remain Qty already accounts for the day's picks, putaways, and transfers.

</details>

<details>
<summary><b>Security (RLS)</b></summary>

- **Roles live in `profiles` and are checked through a `has_role()` SECURITY DEFINER function.** A policy cannot recursively read the table it is protecting.
- **Double checking: RLS plus a role check in the function or route.** If one layer is misconfigured, the other still refuses.
- **The service role key is only used on the server.** It bypasses RLS, so it is never sent to the browser.
- **Public sign-up is disabled.** Only the site account is used.

</details>

<details>
<summary><b>Labels</b></summary>

- **Rack column strips A–E, one 80 × 85 mm cell per level**, following the sample photos. The operator finds every level from the floor without climbing.
- **QR plus a level colour band, with Code 128 optional.** The QR stays readable even when the label is bent around the column; Code 128 is there for older laser scanners.
- **Barcodes are rendered as vectors**, not PNG images. Module edges stay sharp on a 203 dpi printer (tested: every code read by zbar).
- **A 3 mm quiet zone is kept around the QR and Code 128.** A scanner needs white space to recognise the start and end of a code.
- **Black-and-white mode.** Direct thermal printers cannot print colour.
- **The PDF is built on the server.** One place to log `print_logs`, and no dependence on what the phone can do.

</details>

<details>
<summary><b>Scan and UI</b></summary>

- **The scan field is always focused and submits on Enter.** USB and Bluetooth scanners behave as keyboards, no driver needed.
- **A scan is only recorded when it comes from the scan screen (`?scan=1`).** Refreshing the page does not inflate the scan count.
- **Every action has a confirmation step with a summary sentence.** A mis-tap on the warehouse floor costs more than one extra tap.
- **A FEFO warning when a batch is chosen that is not the earliest expiry**, without blocking it (sometimes there is an operational reason).
- **Cards on a phone, tables on a desktop.** A 9-column table is unreadable on a 6-inch screen.
- **Bin codes are shown like the yellow location plates.** What is on screen matches what the operator sees on the rack.

</details>

<details>
<summary><b>3D</b></summary>

- **One instanced mesh for 2,570 bins** (one draw call), so it stays light on an office laptop.
- **Render on demand (`frameloop="demand"`).** The GPU only works while the camera moves or the data changes, which saves tablet battery.
- **Coordinates are computed in the database from the layout configuration.** Change a rack dimension once and every bin follows.

</details>

<details>
<summary><b>Allocation and waves, combined</b></summary>

- **One source of truth for stock.** The old allocator's `stock`/`stock_transactions` tables were removed; the allocator reads `inventory` and writes through the same `movements` ledger. A posted pick shows up in the movement history, in ABC, and in 3D exactly like a manual movement.
- **A plan is not an execution.** Saving a plan only writes `waves`, `pick_tasks`, and `outbound`. Stock changes when a task is posted (`post_task` → one `movements` row).
- **Stock identity = bin + SKU + batch + expiry.** Rule inherited from the allocator: two expiry dates inside one batch in one bin are two stock rows, so FEFO cannot mix them up. A movement without an expiry date still works when that batch has only one row in the bin.
- **Posting is idempotent and atomic.** The unique index on `movements(task_id)` makes double posting impossible; *`Selesaikan wave`* runs in one transaction.
- **Plans roll forward.** `save_plan` only replaces waves that have not been worked on; running waves stay, so no pick loses its plan.
- **Reservation, not locking.** Physical stock stays a single number; open tasks only reduce the stock *for planning*. Manual moves of reserved stock are refused for operators.
- **The actual is recorded, not guessed.** A confirmation that differs from the plan needs a reason and deducts from the bin that was really used.
- **Plan tables have no write policy.** Every change goes through a role-checking SECURITY DEFINER RPC, and the client cannot forge a `task_id` in the ledger either (RLS).
- **The allocation engine runs in the browser**, exactly like the CLI (pure functions). The server only stores the result.

</details>

<details>
<summary><b>Inventory control</b></summary>

- **One policy, read by every control.** `inventory_policy()` returns the settings key `inventory_policy` over built-in defaults, so shelf life, dispatch minimum, near-expiry days, count tolerance, and the approval threshold are changed in one place instead of being hard-coded per feature.
- **A hold is a status, not a move.** Stock that may not ship stays where it is and keeps its identity; releasing it needs a reason.
- **Counting is blind, and a variance is recounted by someone else.** The counter never sees the system quantity, and a difference outside the bin's class tolerance requires a second person — the same four-eyes idea as adjustment approval.
- **Every adjustment has a reason code from a fixed list,** so root causes can be counted instead of guessed at.
- **The checker is not the poster.** Receiving follows the same separation as counting: whoever checked the truck at the dock may not be the one who posts it into stock.

</details>

<details>
<summary><b>Audits</b></summary>

- **Audits are blind.** The checker counts the pallet, or what is left in the bin, without seeing the system figure, so the count cannot be anchored to it.
- **The checker may not be the picker.** Enforced in the database, not in the UI, and the same rule covers putaway audits.
- **A shipment cannot be loaded until every line passes.** The gate is part of the wave, not a report somebody remembers to run.
- **The same audit runs against the WMS workbook** when the day's picks come from the K_ONE sheet rather than from `pick_tasks`, so accuracy is measured the same way on both paths.
- **A count saved by mistake can be re-recorded** by a supervisor, and the correction is itself recorded.

</details>

<details>
<summary><b>Corrections instead of new plans</b></summary>

- **The floor is right more often than the plan.** Every correction in `0033`–`0048` exists because a picker found something the plan had not foreseen: short picks, stock in the wrong bin, a full destination, a growing order.
- **Corrections are separate, named actions** — `Batalkan posting`, `Pecah`, `Tambah Bin To Bin`, `Ubah Bin To Bin`, `Tambah item` — rather than hidden parameters, so the reason is obvious at the moment it is used.
- **Nothing is silently rewritten.** An undone posting puts the stock back exactly as the posting took it, and both rows stay in the ledger.

</details>

<details>
<summary><b>Other</b></summary>

- **List queries are paginated at 1,000 rows.** Supabase's default 1,000-row limit would truncate 2,570 bins without an error.
- **The Excel reader stops at the last non-empty cell.** The WMS sheet declares a range up to row 1,048,563; reading only what exists cut the time from about 21 seconds to about 2 seconds.
- **Roles gate the navigation** (`components/app/nav.tsx`): `operator` gets `Scan`, `Penerimaan` (receiving), `Wave`, `Inventory`, `Gudang 3D`, `Cycle count`, `Audit picking`, and `Audit putaway`; `supervisor` adds `Dashboard`, `Alokasi` (allocation), `Putaway`, `Pickface`, `Adjust stok` (adjust stock), `Mutasi` (movements), `Kualitas data` (data quality), `Lacak batch` (batch trace), `Label`, and `Master item`; `admin` adds `Import` and `Pengaturan` (settings).

</details>

---

## 5. Tested / Not Yet Tested

**Done** — in the development sandbox:

- [x] Migrations and seed on PostgreSQL 16 (with a stub of Supabase's `auth` schema): 2,570 bins, 1,790 stock rows, 52,078 in total.
- [x] Rules: a pick above the available stock is refused; a transfer keeps the expiry date; a transfer into a blocked bin is refused; an operator cannot adjust, import, change `inventory`, or delete a movement; a forged `user_id` is ignored; a supervisor's adjustment is recorded.
- [x] Import of the real WMS file: 2,614 rows in, re-import after the seed gives 0 movements.
- [x] Labels: exact page sizes (80 × 85 mm and 80 × 469 mm); QR and Code 128 read by zbar from the 203 dpi render.
- [x] `tsc`, ESLint, and `next build` pass.
- [x] SQL test suite: `supabase/tests/00_local_auth_stub.sql`–`supabase/tests/22_add_wave_items.sql` (23 files), covering the stock rules and RLS, the allocation flow, rolling execution, putaway import, pickfaces, counts and corrections, audits, stock fixes, inventory control, picking, rack and putaway audits, the WMS-file audit, relocations, parked-wave carry-over, the pick order guard, picks found in another bin, putaway redirect, and add/change relocation.
- [x] TypeScript suite: `npm test` runs 31 test files (515 tests, 0 failures), including the FEFO engine, leftover and FEFO regression, the daily workflow, pickface behaviour, pick path, stress runs on the real workbooks, database-versus-workbook stock parity, batch-code decoding, minimum shelf life, SAP stock, and the audit exports.
- [x] End-to-end on local Supabase (Auth + PostgREST, supervisor and operator accounts): the 24 Sep file → 1,790 stock rows → allocation of 1,293 cartons → 8 waves / 51 tasks → all waves completed by the operator → stock 52,078 → 50,785, with every ledger row in the operator's name.

**Not yet:**

- [ ] Testing against the production Supabase project (already tested on local Supabase).
- [ ] The 3D view on a real GPU and on an operator's phone or tablet. It does render in a browser — the screenshot above was captured from a real Chromium against local Supabase, using software WebGL — but not yet on physical hardware.
- [ ] Physical printing on the warehouse printer and scanning with an operator's phone.

---

## 6. Technical Notes

- **SheetJS**: the npm `xlsx@0.18.5` package has security advisories (prototype pollution / ReDoS) that are fixed in the official CDN build. Before production: `npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`.
- Floor-zone labels in 3D (`<Text>` from drei) load a font from a CDN the first time they are opened.
- Movement filter dates use WIB (UTC+7).
- **Explicit grants (`0005`).** New Supabase projects no longer grant SELECT/INSERT/EXECUTE to `authenticated` by default; without `0005` every query fails with "permission denied". Safe to run on an existing project.
- Old allocator audit documents live in `docs/archive/allocator/` and refer to code that has since been replaced.
- The migration set is the real index of what exists: `supabase/migrations/0001_schema.sql`–`supabase/migrations/0048_add_wave_items.sql`, with the test covering each range named in section [3](#3-phase-by-phase-files-commands-how-to-test).
