# CKB 3PL: stock take for Exxon (EMCL), as a per-customer count profile (design)

Migrations `0161`-`0163`, SQL tests 121-122, `tests/ckb-sap-import.test.ts`, `ckb-count-rules.test.ts`, `ckb-stocktake.test.ts`.
Supplements `docs/CKB_3PL.md` §4-§5 and `2026-11-08-ckb-blind-count-design.md`. Decided with the user on 25 Nov 2026.

## 1. Why

Exxon (EMCL) sent `Stock in Bin as of 13 Nov 26.xlsx`: 397 SAP lines, 100 storage bins (floor and yard zones, one holds 53 lines), 263 materials,
15 units (DRM, EA, PL, TNK, CAN, ...), 11 batch-like codes (`FC1PMCL01`, `FC-PMCL01`, ...), no expiry, whole quantities only, stock types INV 369 /
HOLD 27 / CAP 1. It is the first real CKB SAP file. It differs from what the stock take assumed:

| | Default | EMCL |
|---|---|---|
| Titles | `Unrestricted`, `Storage bin` | `Total Stoc`, `Storage Bi`, `MTyp`, `ID1` (the default mapping refuses the file) |
| Batch | production batch + expiry, `BATCH_MISMATCH` | codes look like cost/project codes; 66 material+bin pairs carry more than one |
| Count task | material + plant + sloc + bin + batch + expiry + unit + stock type | material + bin (+ unit, stock type): 397 lines become **307 tasks** |
| Photos | per count line | one per **bin**, then per line for 0, found stock, recounts |
| Mapping | one global mapping | per customer |

## 2. Decisions

1. Count by **material + bin**; the batch code is **information only**.
2. **HOLD / CAP** are counted in the same session, tagged (INV shows no tag).
3. **Baseline**: a fresh SAP extract on count day (nothing records movements in CKB; the 13 Nov file is the format sample).
4. **Counting**: phone entry per line, **one photo per bin**.
5. **Mapping**: **one per customer**.

## 3. The profile (0161)

Three columns on `ckb_customers`, set by `ckb_set_customer_count_profile` (admin; audit `CUSTOMER_COUNT_PROFILE` with before and after):
`count_identity` `FULL` (default) | `MATERIAL_BIN`; `photo_scope` `TASK` (default) | `BIN`; `sap_mapping` null (the global `ckb_settings.sap_import`) or
`{verified, columns}`. `ckb_sap_mapping_for(customer)` returns the one that applies; `ckb_import_sap_snapshot` stores it (and its `verified` flag) on each snapshot.
Customer `EMCL` is seeded with `MATERIAL_BIN`, `BIN` and a mapping that reads this file's titles, **`verified: false`**: an admin marks it verified on the
Customer page after reading a real import (never in code). `ID1` is read as the plant and `MTyp` as the stock type; confirm with a real extract (it is data in the mapping).

## 4. Count identity (0162)

The snapshot stays faithful: each row keeps its full `identity_key`. `ckb_create_stocktake` groups by the profile's key: `MATERIAL_BIN` = the full key without batch and expiry
(stock type stays, so HOLD/CAP keep their tag). A merged task has `batch = ''`, `expiry_date = null`, `baseline_qty = sum`, and `batch_info` = `[{batch, expiry, qty}]`.
`identity_issue = 'DUPLICATE_ROWS'` now means the **same full identity appears twice** (`count(*) > count(distinct identity_key)`): kept, flagged `AMBIGUOUS`, never summed
silently. The exception to "never summed silently" is therefore only the deliberate merge of different batch codes, shown in the import preview ("397 baris menjadi 307 tugas hitung").

`ckb_submit_count` sets the batch and expiry flags to null for a `MATERIAL_BIN` customer, so `BATCH_MISMATCH` cannot occur (TS `classify` is unchanged). `ckb_add_found_line` matches and
keys without batch and expiry for this profile. `ckb_stocktake_tasks` (dropped and recreated, counter narrowing kept) adds `batch_codes` (codes only, everybody) and `batch_detail`
(with SAP quantity per code, only where the baseline is shown): a counter never reads what SAP holds.

## 5. Photo per bin (0163)

`ckb_stocktake_bins` (one row per bin of a session, made on first use by `ckb_stocktake_bin`) is the `entity_id` of evidence entity `STOCKTAKE_BIN` (kind `COUNT`): same route,
private bucket, audit and retention. A count is refused until the bin has a live photo (`ckb_bin_photo_missing`, in `ckb_counts_guard`); accepting a variance is satisfied by a
line photo **or** the bin photo; `ckb_photo_reason` ignores the customer's "photo on every count" switch for `BIN`; 0, found stock and recounts still need a line photo.
Only a counter who may count a line in the bin adds the bin photo (`ckb_can_count_bin`); an operator reads only the bin photos of their own bins; withdrawing a bin photo that a
submitted count relied on is for a lead. Sessions created before 0133 (`photo_rules = false`) are exempt, like every photo rule. `ckb_stocktake_bins_for` lists the bins a caller may
count with their photo counts. The counting list shows a "Foto bin dulu" control above each bin's first line and keeps that bin's lines shut until it has a photo.

## 6. Screens

Customer page: `Profil hitung` (identity, photo scope, own mapping with the shared `MappingFields`, also used by Pengaturan). SAP import preview: which mapping is used and the merge line.
Counting: the stock-type tag, batch codes read-only (no "batch sesuai?" checks), found stock without batch/expiry, the bin photo control. Review and discrepancies: the codes with SAP
quantities and the tag.

## 7. Known limits

An adjustment of a merged task is per material + bin, not per batch: whoever posts it in SAP allocates across the codes. No CKB ledger, hence the fresh extract. Odd bins in the file
(`TMCML`, `TMCMLSLGB3`) get no special handling: the supervisor counts 0 with a note or excludes them at review. The SAP export stays the unverified `CKB-INTERNAL-1` worksheet
(Batch blank and Tipe stok filled for a merged task). The reports `discrepancies` and `adjustments` do not yet carry the stock type or the batch list.
