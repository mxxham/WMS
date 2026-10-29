# Inventory Ledger (Buku stok) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `Buku stok` page that takes one SAP workbook per day and shows, per SKU, SAP's book against the WMS book (awal, inbound, outbound, block moves, akhir) with the end-of-day difference and the day's accuracy; then a `Tanggal barang datang` field on putaway so inbound is filed on the arrival date.

**Architecture:** The SAP side is computed in the browser by a pure function from the existing MB52/MB51 parsers and stored per SKU through one RPC. The WMS side is computed live by one SQL function from `movements` (append-only, so a past day only changes when a putaway with that arrival date is posted later). A pure TypeScript module joins the two books, computes differences, accuracy, chain breaks and carried notes; the pages only load and render.

**Tech Stack:** Next.js 15 App Router (RSC), React 19, TypeScript strict, Supabase/PostgreSQL 16, SheetJS (`xlsx`), standalone `tsx` tests, psql SQL tests.

**Spec:** `docs/superpowers/specs/2026-10-28-inventory-ledger-design.md`

## Global Constraints

- New migrations: `0116_inventory_ledger.sql` (Tasks 3), `0117_putaway_arrival_date.sql` (Task 6). Never edit 0001–0115.
- No write to `inventory`, no edit/delete of `movements`. The ledger writes no stock.
- New tables: RLS on, read policy `using ((select public.is_active()))`, no write policy, writes only through SECURITY DEFINER RPCs that check `public.has_job(array['inventory','leader','admin'])`, append-only by trigger.
- Quantities in the SKU's base unit (CAR / EA). Litres = quantity × `items.volume_l`; a SKU without `volume_l` shows `–`, never 0.
- Dates are Asia/Jakarta calendar days (`(ts at time zone 'Asia/Jakarta')::date`).
- Storage location for SAP: `WHS1` only; `INBD` is information.
- Blocked on the WMS side = stock in bins with `zone = 'QUARANTINE'` (the user's definition; holds are not counted, unlike 0113).
- UI strings Indonesian, code/comments English. Every action has a confirmation step with a summary sentence.
- Tests: standalone `tests/*.test.ts` with the inline `test()` helper and `process.exit(1)` on failure, added to the `npm test` chain in `package.json`; prefix `TZ=Asia/Jakarta` for date logic. SQL tests `supabase/tests/78_inventory_ledger.sql`, `79_putaway_arrival.sql`: PASS/FAIL per row, `begin … rollback`, run with `scripts/sql-test.sh`.
- List queries paginate at 1,000 rows (`lib/fetch-all.ts` `fetchAll`).
- Commits: the working tree holds unrelated uncommitted work (SAP compare 0112/0113, picking audit 0114/0115). Stage only the files a task names; never `git add -A`. Commit only after the user agrees to commits.

## Review Focus

1. **A SKU on only one side** (in MB52 but no WMS stock, or WMS stock never in SAP, or only in MB51): it must get a line with 0 on the missing side, never be dropped. Tested in Task 2 (`compareDay` union) and Task 1 (`550066782` only in MB51).
2. **Uploading a file whose MB51 holds two posting dates, or a future date, or no MB51 sheet**: refused with a sentence, nothing saved. Tested in Task 1 (`sapBook` throws) and Task 3 (RPC refuses future date).
3. **A putaway posted on D+1 for goods that arrived on D**: inbound on D, not D+1; WMS akhir(D) includes it; awal(D+1) too. Tested in Task 3 SQL (arrival shift) and Task 6 (recorded date beats the assumption).
4. **Re-uploading the same date**: a new version, the page shows the latest, the older stays. Tested in Task 3 SQL.
5. **SKU without `volume_l`**: litres `null`, counted in `summary.missingVolume`, totals in litres skip it. Tested in Task 2.

---

### Task 1: SAP book from the daily workbook

**Files:**
- Create: `lib/ledger/sap-book.ts`
- Test: `tests/ledger-sap-book.test.ts` (add `TZ=Asia/Jakarta tsx tests/ledger-sap-book.test.ts` to the `npm test` chain)

**Interfaces:**
- Consumes: `Mb52Row`, `Mb51Row`, `parseMb52`, `parseMb51`, `dateFromFileName` from `lib/sap-stock.ts`.
- Produces:
```ts
export type SapBookLine = {
  sku: string; description: string; uom: string;
  awal_unrest: number; awal_block: number;
  inbound: number;            // 101 + 102 (signed) + Z31 + positive 311, WHS1
  outbound: number;           // -(601 + 602 signed), positive = cartons out
  mv343: number; mv344: number; z55: number;   // positive quantities
  other_unrest: number;       // every other WHS1 movement, signed
  other_by_type: Record<string, number>;
  akhir_unrest: number; akhir_block: number;
  inbd: number;               // INBD unrestricted + blocked
};
export type SapBook = { date: string; lines: SapBookLine[]; mb51Count: number; inbdTotal: number };
export function sapBook(mb52: Mb52Row[], mb51: Mb51Row[], fileName: string): SapBook;
export function readSapWorkbook(wb: XLSX.WorkBook, fileName: string): SapBook; // parseMb52 + parseMb51 + sapBook
```

Rules (the team workbook's formulas, spec "The SAP book"): `akhir_unrest = awal_unrest + inbound − outbound + mv343 − mv344 + other_unrest`; `akhir_block = awal_block + mv344 − mv343 − z55`. For 343/344 use the positive (debit) lines only; Z55 uses the negative line as a positive write-off. A negative 311 in WHS1 (to RETN) goes to `other_unrest` under type `311`. Date = the single MB51 posting date; when MB51 has no dated rows, `dateFromFileName(fileName)`; throws `Error("File berisi lebih dari satu tanggal posting MB51: …")` on two or more dates and `Error("Tanggal file tidak terbaca: …")` when neither gives a date. Lines sorted by SKU.

- [ ] **Step 1: Write the failing test** on the real sample `data/MB52_2810_28_Oktober_2026.xlsx` (read with `XLSX.readFile`, then `readSapWorkbook(wb, "MB52 2810_28 Oktober 2026.xlsx")`):

```ts
test('date from the MB51 posting date', () => assert.equal(book.date, '2026-10-28'));
test('opening = MB52 WHS1', () => {
  assert.equal(sum(book.lines, 'awal_unrest'), 59477);
  assert.equal(sum(book.lines, 'awal_block'), 18);
});
test('inbound 101 + Z31 = 4546, outbound 601 - 602 = 114', () => {
  assert.equal(sum(book.lines, 'inbound'), 4546);
  assert.equal(sum(book.lines, 'outbound'), 114);
});
test('550062464: two Z31 of 960 in, 5 out, akhir 7369 + 1920 - 5', () => {
  const l = line('550062464');
  assert.deepEqual([l.awal_unrest, l.inbound, l.outbound, l.akhir_unrest], [7369, 1920, 5, 9284]);
});
test('550049045: 101 of 219 and Z31 of 960 both count', () => assert.equal(line('550049045').inbound, 1179));
test('550066782 only in MB51: a line with awal 0, 311 to RETN in other', () => {
  const l = line('550066782');
  assert.deepEqual([l.awal_unrest, l.outbound, l.other_by_type['311'], l.akhir_unrest], [0, 8, -5, -13]);
});
test('INBD total is information only', () => assert.equal(book.inbdTotal, 23540));
test('two posting dates are refused', () =>
  assert.throws(() => sapBook([], [row({ posting_date: '2026-10-28' }), row({ posting_date: '2026-10-29' })], 'x.xlsx'), /lebih dari satu tanggal/));
test('343 / 344 / Z55 move between unrestricted and blocked', () => {
  const b = sapBook([mb52('1', 10, 2)], [row({ sku: '1', mvt_type: '344', quantity: 3 }), row({ sku: '1', mvt_type: '344', quantity: -3 }),
    row({ sku: '1', mvt_type: '343', quantity: 1 }), row({ sku: '1', mvt_type: '343', quantity: -1 }), row({ sku: '1', mvt_type: 'Z55', quantity: -2 })], 'x.xlsx');
  assert.deepEqual([b.lines[0].akhir_unrest, b.lines[0].akhir_block], [8, 2]);
});
```
(`row()` / `mb52()` are inline fixture builders filling the other `Mb51Row` / `Mb52Row` fields with WHS1 defaults.)

- [ ] **Step 2: Run** `TZ=Asia/Jakarta npx tsx tests/ledger-sap-book.test.ts` — expected FAIL (module not found).
- [ ] **Step 3: Implement** `lib/ledger/sap-book.ts` as in Interfaces.
- [ ] **Step 4: Run** the test — expected `9 passed, 0 failed`; `npm run typecheck` clean.
- [ ] **Step 5: Commit** `lib/ledger/sap-book.ts tests/ledger-sap-book.test.ts package.json` — `feat(ledger): SAP book from the daily MB52/MB51 workbook`.

### Task 2: Join the books: differences, accuracy, chain, notes, Excel rows

**Files:**
- Create: `lib/ledger/compare.ts`
- Test: `tests/ledger-compare.test.ts` (add to the chain with `TZ=Asia/Jakarta`)

**Interfaces:**
- Consumes: `SapBookLine` (Task 1).
- Produces:
```ts
export type WmsBookLine = {          // one row of ledger_wms_book (Task 3)
  sku: string; description: string; uom: string;
  awal_unrest: number; awal_block: number;
  inbound: number; inbound_assumed: number;   // part of inbound filed by the posting-date-minus-one rule
  outbound: number; q_in: number; q_out: number;
  other_unrest: number; other_block: number;
  akhir_unrest: number; akhir_block: number;
};
export type LedgerNote = { id: string; sku: string; from_date: string; note: string; closed: boolean; by_name: string; created_at: string };
export type LedgerLine = { sku: string; description: string; uom: string; volume_l: number | null;
  sap: SapBookLine | null; wms: WmsBookLine | null;
  diff_unrest: number; diff_block: number;       // WMS akhir − SAP akhir
  match: boolean; wms_identity_ok: boolean; note: LedgerNote | null };
export type LedgerSummary = { skus: number; matching: number; accuracy: number | null;  // 0–100, 2 decimals; null when no SKU
  differing: number; absDiff: number; absDiffLitres: number; missingVolume: string[];
  sap: Totals; wms: Totals; inboundAssumed: number };
export type Totals = { awal_unrest: number; awal_block: number; inbound: number; outbound: number; akhir_unrest: number; akhir_block: number;
  litres: { awal_unrest: number; awal_block: number; inbound: number; outbound: number; akhir_unrest: number; akhir_block: number } };
export function compareDay(sap: SapBookLine[], wms: WmsBookLine[], volume: Map<string, number | null>, notes: LedgerNote[], date: string):
  { lines: LedgerLine[]; summary: LedgerSummary };
export function chainBreaks(today: SapBookLine[], previousDay: SapBookLine[] | null): string[];   // SKUs whose awal ≠ the previous day's akhir (MB52)
export function ledgerSheetRows(lines: LedgerLine[]): Record<string, string | number | null>[];  // BOOK TO BOOK column order
```
Notes rule (spec "Notes"): for each SKU take its latest note row with `from_date <= date`; show it when not `closed` and (`from_date === date` or the SKU does not match on `date`). Accuracy = `matching / skus × 100` rounded to 2 decimals. `wms_identity_ok` = `awal + inbound − outbound + q_out − q_in + other_unrest === akhir_unrest` and the blocked equivalent. Lines sorted by SKU.

- [ ] **Step 1: Write the failing tests:**
```ts
test('a SKU in SAP only and one in WMS only both get a line', () => {
  const r = compareDay([sap('A', { akhir_unrest: 5 })], [wms('B', { akhir_unrest: 3 })], vol(), [], D);
  assert.deepEqual(r.lines.map((l) => [l.sku, l.diff_unrest]), [['A', -5], ['B', 3]]);
  assert.equal(r.summary.accuracy, 0);
});
test('match needs unrestricted and blocked equal', () => {
  const r = compareDay([sap('A', { akhir_unrest: 5, akhir_block: 1 })], [wms('A', { akhir_unrest: 5, akhir_block: 0 })], vol(), [], D);
  assert.equal(r.lines[0].match, false); assert.equal(r.lines[0].diff_block, -1);
});
test('accuracy = matching / SKUs, 2 decimals', () => { /* 2 of 3 match */ assert.equal(r.summary.accuracy, 66.67); });
test('litres use volume_l; a SKU without volume is listed, not counted as 0', () => {
  /* A volume 9.6, B null */ assert.deepEqual(r.summary.missingVolume, ['B']); assert.equal(r.summary.sap.litres.akhir_unrest, 48);
});
test('a note shows on its date and later days while the SKU differs, not once it matches or is closed', () => { /* three dates */ });
test('chainBreaks lists SKUs whose next MB52 is not today akhir', () =>
  assert.deepEqual(chainBreaks([sap('A', { awal_unrest: 9 }), sap('B', { awal_unrest: 5 })], [sap('A', { akhir_unrest: 9 }), sap('B', { akhir_unrest: 4 })]), ['B']));
test('a broken WMS identity is flagged', () => assert.equal(compareDay([], [wms('A', { awal_unrest: 1, akhir_unrest: 5 })], vol(), [], D).lines[0].wms_identity_ok, false));
test('sheet rows keep the BOOK TO BOOK order', () =>
  assert.deepEqual(Object.keys(ledgerSheetRows(r.lines)[0]).slice(0, 9), ['Material', 'Material Description', 'UOM', 'SAP Unrest Awal', 'SAP Block Awal', 'SAP Inbound', 'SAP Outbound', 'SAP Unrest Akhir', 'SAP Block Akhir']));
```
Remaining sheet columns, in order: `WMS Unrest Awal`, `WMS Block Awal`, `WMS Inbound`, `WMS Outbound`, `WMS Unrest Akhir`, `WMS Block Akhir`, `Selisih Unrest`, `Selisih Block`, `344 Release to Block`, `343 Block to Release`, `Z55 Write Off`, `Karantina masuk`, `Karantina keluar`, `Lain-lain SAP`, `Lain-lain WMS`, `INBD`, `Volume (L)`, `Selisih Unrest (L)`, `Selisih Block (L)`, `Catatan`.
- [ ] **Step 2: Run** — expected FAIL (module not found).
- [ ] **Step 3: Implement** `lib/ledger/compare.ts`.
- [ ] **Step 4: Run** — all pass; typecheck clean.
- [ ] **Step 5: Commit** `lib/ledger/compare.ts tests/ledger-compare.test.ts package.json` — `feat(ledger): compare SAP and WMS books per day`.

### Task 3: Database: stored SAP days, notes, live WMS book (0116)

**Files:**
- Create: `supabase/migrations/0116_inventory_ledger.sql`
- Test: `supabase/tests/78_inventory_ledger.sql`

**Interfaces:**
- Produces (SQL):
  - `ledger_days(id uuid pk, ledger_date date, version int, file_name text, mb51_count int, inbd_total numeric, uploaded_by uuid default auth.uid(), by_name text, created_at timestamptz default now(), unique (ledger_date, version))`
  - `ledger_sap_lines(day_id uuid → ledger_days, sku text, description text, uom text, awal_unrest, awal_block, inbound, outbound, mv343, mv344, z55, other_unrest numeric, other_by_type jsonb, akhir_unrest, akhir_block, inbd numeric, primary key (day_id, sku))`
  - `ledger_notes(id uuid pk, sku text, from_date date, note text, closed boolean default false, by_name text, created_by uuid default auth.uid(), created_at timestamptz default now())`
  - view `ledger_latest_days` = latest version per `ledger_date`.
  - `ledger_save_day(p_date date, p_file_name text, p_by_name text, p_mb51_count int, p_inbd_total numeric, p_lines jsonb) returns jsonb {day_id, version}` — `p_lines` = `SapBookLine[]` as JSON; refuses a date after today (Jakarta) with `'Tanggal % di masa depan'`, an empty `p_lines` with `'File tidak berisi stok WHS1'`; version = max + 1.
  - `ledger_add_note(p_sku text, p_from_date date, p_note text, p_closed boolean, p_by_name text) returns uuid` — note required unless `p_closed`.
  - view `ledger_inbound_moves(movement_id, item_id, to_bin_id, quantity, posted_date, arrival_date, assumed boolean)`: movements `type = 'inbound'` (arrival = posted date, assumed false) and `type = 'putaway' and from_bin_id is null` (arrival = posted date − 1, assumed true). Task 6 redefines this view; nothing else may hard-code the arrival rule.
  - `ledger_wms_book(p_date date) returns table(sku text, description text, uom text, awal_unrest numeric, awal_block numeric, inbound numeric, inbound_assumed numeric, outbound numeric, q_in numeric, q_out numeric, other_unrest numeric, other_block numeric, akhir_unrest numeric, akhir_block numeric)`, `security invoker`, `stable`.

`ledger_wms_book` algorithm (the one part the signature does not determine):
```
end(D) per item, split by bin zone (QUARANTINE → block, else unrest):
    current inventory − legs of movements created after end of D (Jakarta)
  + putaway quantity from ledger_inbound_moves with arrival_date <= D and posted_date > D   (into its to_bin's zone)
awal = end(D−1); akhir = end(D)
inbound      = ledger_inbound_moves with arrival_date = D (split by to_bin zone for the identity; returned summed)
inbound_assumed = the part of inbound where assumed
outbound     = picking legs out on D − unpick adjustments on D (same unpick test as wms_day_report, 0055)
q_in / q_out = transfer legs on D from non-quarantine into quarantine / back
other_unrest / other_block = non-unpick adjustment legs on D by zone
Rows: every item with any non-zero value; joined to items for sku, description, uom.
```

- [ ] **Step 1: Write the failing SQL test** `78_inventory_ledger.sql` in the shape of `76_move_source_audit.sql` (auth stub users, `pg_temp.check`, `pg_temp.fails`, `begin … rollback`). Fixture: one SKU, bins `CF38C01` (rack) and a `QUARANTINE` bin; post through `movements` with explicit `created_at` on 2026-10-26/27/28 (Jakarta): stock 100 on the 26th; putaway 50 posted on the 28th (no source bin); pick 10 on the 27th; transfer 3 into quarantine on the 27th. Checks:
  - `ledger_wms_book('2026-10-27')`: awal_unrest 100, inbound 50 (`inbound_assumed` 50: posted 28th → arrived 27th), outbound 10, q_in 3, akhir_unrest 137, akhir_block 3.
  - `ledger_wms_book('2026-10-28')`: awal_unrest 137 (= akhir of the 27th), inbound 0.
  - identity `awal + inbound − outbound + q_out − q_in + other = akhir` holds for both dates.
  - `ledger_save_day` twice for the same date → versions 1 and 2; `ledger_latest_days` shows version 2.
  - `ledger_save_day` for tomorrow → fails `'%masa depan%'`; with `[]` lines → fails `'%stok WHS1%'`.
  - an `operator` job → fails (role check); a direct `insert into ledger_days` as `authenticated` → refused; `update ledger_notes` as owner → refused by trigger.
- [ ] **Step 2: Run** `scripts/sql-test.sh supabase/tests/78_inventory_ledger.sql` — expected ERROR (function does not exist).
- [ ] **Step 3: Write** `0116_inventory_ledger.sql` (header comment: why, the workbook rules, the arrival rule; grants; RLS; append-only triggers like `move_source_audits_forbid_change` in 0114).
- [ ] **Step 4: Run** the test, then the whole suite `scripts/sql-test.sh` — every row PASS.
- [ ] **Step 5: Commit** `supabase/migrations/0116_inventory_ledger.sql supabase/tests/78_inventory_ledger.sql` — `feat(ledger): stored SAP days, notes and the live WMS book (0116, test 78)`.

### Task 4: Buku stok pages

**Files:**
- Modify: `components/app/nav-config.ts` (link `{ href: "/ledger", label: "Buku stok", icon: BookOpen, jobs: [IV, LD, AD] }` in `Stok`, after `Mutasi`)
- Create: `lib/ledger/load.ts` (server loaders), `app/(app)/ledger/page.tsx` (month list), `app/(app)/ledger/upload-sap.tsx` (client), `app/(app)/ledger/[date]/page.tsx`, `app/(app)/ledger/[date]/day-view.tsx` (client: filter, notes, Excel)
- Test: `tests/ledger-load.test.ts` only if `load.ts` holds logic beyond queries (otherwise covered by Tasks 1–3); verification here is typecheck, lint, and running the page.

**Interfaces:**
- Consumes: `readSapWorkbook` (Task 1); `compareDay`, `chainBreaks`, `ledgerSheetRows`, types (Task 2); `ledger_save_day`, `ledger_add_note`, `ledger_latest_days`, `ledger_sap_lines`, `ledger_notes`, `ledger_wms_book` (Task 3); `saveSheets` from `lib/save-xlsx.ts`; `requirePage("/ledger")`.
- Produces:
```ts
export async function loadLedgerDay(supabase, date: string): Promise<{ day: LedgerDayRow | null; lines: LedgerLine[]; summary: LedgerSummary;
  chain: string[]; waiting: boolean; inbdTotal: number; mb51Count: number }>;
export async function loadLedgerMonth(supabase, month: string /* YYYY-MM */): Promise<{ date: string; accuracy: number | null; differing: number;
  waiting: boolean; byName: string; version: number; createdAt: string }[]>;
```
`waiting` = today (Jakarta) ≤ date + 1 day: label `Menunggu putaway`. Volume map from `items.volume_l` by SKU.

- [ ] **Step 1: Month list** `/ledger?month=YYYY-MM` (default this month): table/cards of uploaded days with accuracy, SKUs differing, status, uploaded by; month switcher; date picker opens `/ledger/<date>`; `Upload file SAP` button.
- [ ] **Step 2: Upload** (`upload-sap.tsx`): read the file with `XLSX.read`, `readSapWorkbook`, show `"{tanggal}: {n} SKU stok WHS1, {m} transaksi MB51, INBD {x}. Simpan?"`, then `ledger_save_day` with `p_by_name` from `usePersonName`; parser errors shown as the alert text; on success go to `/ledger/<date>`. When the date already has a version: `"Tanggal ini sudah diupload (versi {v}). Upload lagi membuat versi {v+1}."`.
- [ ] **Step 3: Day page** `/ledger/[date]`: summary block (SAP and WMS totals, cartons and litres, as the workbook `SUMMARY`), accuracy, warnings: chain breaks (`Awal SAP tidak sama dengan akhir kemarin: {n} SKU`), assumed arrival (`{n} karton inbound diasumsikan datang H-1 dari tanggal putaway`), missing volume, broken WMS identity, `Menunggu putaway`. Then the per-SKU table in `ledgerSheetRows` order; filter `Semua` / `Hanya selisih` (default); cards on a phone. No upload for the date → message and the upload button.
- [ ] **Step 4: Notes**: on a differing row `Catatan` opens a dialog (note text, `Nama Anda`), confirm sentence `"Catatan untuk {sku} mulai {tanggal}: …"`; `Tutup catatan` adds a closed row.
- [ ] **Step 5: Excel**: `Download Excel` → `saveSheets({ "Book to Book": ledgerSheetRows(lines), Ringkasan: [summary rows] }, "Buku stok {date}.xlsx")`.
- [ ] **Step 6: Verify**: `npm run typecheck`, `npm run lint`, `npm test`; run `npm run dev` against a local database with migrations through 0116, upload `data/MB52_2810_28_Oktober_2026.xlsx`, open `/ledger/2026-10-27`: SAP akhir 59,477 / block 18, inbound 4,546, outbound 114.
- [ ] **Step 7: Commit** the listed files — `feat(ledger): Buku stok page, upload and day view`.

### Task 5: Check against live data (user runs)

- [ ] **Step 1:** After the user pushes 0116 and deploys, upload the 28 Oct file on the live site and record: accuracy, the 10 largest differences, chain/assumed warnings.
- [ ] **Step 2:** If most differences equal one day's putaway or pick quantity, the timing rule is off: report the evidence before changing the arrival rule (it lives only in `ledger_inbound_moves`).

### Task 6: Tanggal barang datang on putaway (0117)

**Files:**
- Create: `supabase/migrations/0117_putaway_arrival_date.sql`, `supabase/tests/79_putaway_arrival.sql`
- Modify: `app/(app)/putaway/putaway-client.tsx` (date field + confirmation sentence), `docs/superpowers/specs/2026-10-28-inventory-ledger-design.md` (mark part 2 built)

**Interfaces:**
- Consumes: `putaway_import(p_rows jsonb, p_source text, p_apply boolean, p_by_name text)` (0066), `putaway_log.movement_ids`, view `ledger_inbound_moves` (Task 3).
- Produces: `putaway_log.arrival_date date` (nullable; null for rows before 0117); `putaway_import(p_rows jsonb, p_source text, p_apply boolean, p_by_name text, p_arrival_date date default null)` — drop the 4-argument version and recreate with the 0066 body unchanged plus: when `p_apply`, `p_arrival_date` is required, not after today (Jakarta) (`'Tanggal barang datang tidak boleh di masa depan'`), not more than 7 days back (`'Tanggal barang datang lebih dari 7 hari yang lalu'`), and written to every `putaway_log` row of the import; `ledger_inbound_moves` redefined: a putaway movement listed in a `putaway_log.movement_ids` with `arrival_date` uses it (`assumed = false`), otherwise posted date − 1 (`assumed = true`).

- [ ] **Step 1: Failing SQL test** `79_putaway_arrival.sql`: post a putaway on 2026-10-28 with `p_arrival_date => '2026-10-26'` → `ledger_wms_book('2026-10-26').inbound` includes it with `inbound_assumed = 0`, `ledger_wms_book('2026-10-27').inbound` does not; future date refused; 8 days back refused; apply without a date refused; a dry run (`p_apply = false`) without a date still works; test 78 still passes.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Write** 0117.
- [ ] **Step 4: UI**: `Tanggal barang datang` date input next to `Nama Anda`, default yesterday (Jakarta), max today; the post confirmation sentence names it (`"… putaway untuk barang datang {tanggal}"`); pass `p_arrival_date`.
- [ ] **Step 5: Run** SQL suite, `npm test`, typecheck, lint — all pass.
- [ ] **Step 6: Commit** — `feat(putaway): record the arrival date and file inbound on it in Buku stok (0117, test 79)`.
