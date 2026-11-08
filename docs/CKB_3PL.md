# CKB 3PL — specification

CKB 3PL is the second application behind the shared login: CKB Warehouse 5 and its six customers
(Freeport, CGP, SIP, MNE, Boiler, SSB). Routes live under `/ckb`, data in `ckb_*` tables
(migrations `0099`–`0107`), pure logic in `lib/ckb/`. Shell WMS is unchanged except where §2.3
says otherwise.

This document is the specification, like `docs/ALLOCATOR.md` is for FEFO. When code and this file
disagree, one of them is a bug.

## 1. What is fully working, what is a boundary

| Area | State |
|---|---|
| Access: app / CKB role / customer scope, isolation from Shell | Working, tested in SQL (65) and TS |
| Customers, user access, settings, inspection checklists | Working |
| SAP snapshot import, preview, duplicate detection, activation, comparison | Working **against a configurable column mapping that has not been verified with a real CKB SAP file** (§4) |
| Stock take: sessions, blind counting, counts, recounts, found stock, classification, review, adjustment approval | Working |
| Adjustment "posting" | Approval is the posting point. **There is no CKB stock ledger**; nothing changes a balance (§5.5) |
| SAP export | Working as an **internal review worksheet** (`CKB-INTERNAL-1`); not a verified SAP upload format (§6) |
| Cargo inspection with versioned checklists, review, re-inspection | Working |
| Evidence (photos/PDF), private storage, access logging, legal hold | Working; archival to cheaper storage is a **recorded manual step** (§8) |
| Rebagging | Pre-existing module (0084–0087), now on CKB roles and customers; **still posts to the Shell ledger on aisles CG/CH** (§9) |
| Reports (9 kinds, Excel + PDF), dashboard, activity log | Working |

## 2. Access

### 2.1 Three separate things

| Concept | Where | Who changes it |
|---|---|---|
| App access | `profiles.apps` contains `ckb_3pl` (0080) | Shell admin on `Pengguna`; CKB admin on `Akses pengguna` (only the `ckb_3pl` entry, never Shell) |
| Operational role | `ckb_user_roles.role`: `admin`, `supervisor`, `operator`, `customer` | CKB admin (`ckb_set_user_access`) |
| Customer scope | `ckb_customer_members` | CKB admin; only for role `customer` (staff see every customer) |

A Shell role grants nothing in CKB. An account with the app but no CKB role opens `/ckb` and sees
why it can do nothing (`app/ckb/no-role.tsx`).

`ckb_role()` returns the caller's role only while the profile is active **and** has the app, so
revoking the app or deactivating the account takes effect on the next request.

### 2.2 Rules enforced by the database

- Every table has RLS; no table has a write policy. All writes are SECURITY DEFINER RPCs that check
  the CKB role first and log to `ckb_audit_events`.
- Representatives (`customer`) read only their customers' **finished** records: closed stock takes
  (with results via `ckb_stocktake_tasks`), decided adjustments, reviewed inspections, finished
  rebagging jobs, and the evidence of those records. Never drafts, raw SAP snapshots, counts,
  counter names, settings, users or the audit log.
- `ckb_set_user_access`: admin only, never on yourself, never the shared site account, at least one
  CKB admin always remains, `customer` needs ≥1 customer, staff roles take none.
- The shared site account (`app_metadata.shared`, 0072) cannot get a CKB role or the CKB app through
  CKB administration: a shared login cannot attribute a count, inspection or approval to a person.
- First admin: `ckb_bootstrap_admin()` — only while no CKB admin exists, only a personal Shell admin
  who already has the CKB app.

### 2.3 Isolation from Shell at the database (0105)

Before 0105 app access was only checked in the Next.js layouts. Two consequences, both closed:

1. `has_role()` now also requires the `shell_wms` app. A CKB-only account (profile role defaults to
   `operator`) can no longer call Shell RPCs such as `save_plan` over the REST API.
2. `is_active()` is false for a customer-only account, so every Shell read policy refuses
   representatives (bins, inventory, movements, items …). Internal CKB staff keep Shell reads —
   rebagging reads items, bins and stock.

`check_request()` keeps its meaning through `account_active()`. CKB policies use
`(select public.account_active())` in place of `is_active()` so representatives can read their own
CKB rows. A profile change may not remove the last active admin who has the Shell app.

## 3. Audit

`ckb_audit_events` is append-only for every role including the database owner (triggers refuse
UPDATE, DELETE, TRUNCATE). It is written only by `ckb_audit()`, which no API caller may execute.
Every RPC in 0099–0107 writes one event; rebagging events are mirrored by a trigger (0106);
downloads of SAP export files and every opening of an evidence file are logged too. Readable by CKB
admins and supervisors (`/ckb/activity`).

## 4. SAP snapshots

- One upload = one immutable dated snapshot of one customer (`ckb_sap_imports` +
  `ckb_sap_snapshot_rows`, triggers refuse UPDATE/DELETE). The active snapshot is a separate pointer
  (`ckb_customers.active_snapshot_id`) moved explicitly by a supervisor.
- Stock identity: material + plant + storage location + storage bin + batch + expiry + unit + stock
  type (`ckb_identity_key`, mirrored by `lib/ckb/sap-import.ts identityKey`). Rows with the same
  identity in one file are kept as uploaded and counted as duplicate identities, never summed silently.
- The server parses the file twice (preview, then import) and never trusts rows from the browser;
  the RPC validates every row again and refuses a file whose SHA-256 was already imported for that customer.
- Refusals instead of guesses: empty quantity (never zero), text quantities with `.`/`,`, negative
  quantities, missing material/unit, ambiguous `dd/mm` dates, batches Excel turned into dates, a
  required column that matches two columns.
- **Open:** no CKB SAP sample file exists in the repository. The header aliases in
  `ckb_settings.sap_import` are the SAP titles this repo already reads for Shell plus a storage-bin
  column. `verified` stays `false` until a real CKB file has been read and reconciled; each snapshot
  records the flag, and the UI warns on every page that shows SAP data.

## 5. Stock take

### 5.1 Session

`DRAFT → COUNTING → REVIEW → CLOSED`, or `→ CANCELLED` (only before any adjustment exists).
A session counts **one customer against one snapshot** fixed at creation. Scope: all stock, chosen
bins, or chosen materials. Counters may be assigned; an unassigned operator cannot count.

### 5.2 Counting

- One task per identity in scope; stock found on the floor becomes a `FOUND` task with its count.
- Counts are append-only (`ckb_counts`, triggers refuse UPDATE/DELETE). A revision or recount is a
  new row; `entry_no` orders them. No count = not counted; `0` is a count.
- `client_key` makes a submission idempotent: a retry returns the first row.
- Blind: `ckb_count_tasks` is not readable over the API at all. `ckb_stocktake_tasks()` shows the
  baseline to supervisors/admins, to operators only when the session is not blind, and to
  representatives only once the session is closed.

### 5.3 Classification (`public.ckb_classify`, mirrored by `lib/ckb/stocktake.ts classify`)

First match wins: no count → `UNCOUNTED`; duplicate identity → `AMBIGUOUS`; found stock →
`UNEXPECTED`; batch or expiry not as recorded → `BATCH_MISMATCH`; equal → `MATCH`; less →
`SHORTAGE`; more → `OVERAGE`.

Variance = accepted count − baseline, **per task**. A shortage and an overage of the same material
in different bins are never netted; the shortage is flagged `wrong_bin_hint` for investigation.

### 5.4 Review

Per task: `ACCEPT` a chosen count (any round), `RECOUNT` (new round, reason required) or `EXCLUDE`
(reason required). A variance needs a reason. `AMBIGUOUS` and `BATCH_MISMATCH` cannot be accepted:
which stock identity to adjust is a business rule not confirmed yet, so they are recounted or
excluded. The session closes only when every task is decided.

### 5.4b Counters, blind reads and photos (0133)

Spec: `docs/superpowers/specs/2026-11-08-ckb-blind-count-design.md`.

- **Assignment per location:** `Penugasan hitung` (`/ckb/stock-take/[id]/assign`, leads) assigns lines by SAP storage bin
  (`ckb_assign_count_tasks`, audited); `ckb_count_tasks.assigned_to`. An operator counts an assigned line only when it
  is theirs; an unassigned line follows the 0101 session rule. Leads count any line. `Hitung saya` (`/ckb/count`) lists
  a counter's sessions.
- **Blind for the operator role everywhere:** RLS hides `ckb_sap_snapshot_rows`, `ckb_adjustments`, `ckb_counts`,
  `ckb_task_notes` from operators; `ckb_stocktake_tasks` returns them only their lines, and a recount is blind (no
  earlier count, accepted qty or decision text). Inventaris shows operators locations only (`ckb_inventory_locations`);
  the dashboard has no discrepancy count for them. Leads see SAP everywhere, also while counting.
- **Photos per round (`ckb_evidence.round`, kind `COUNT` "Foto hitung"):** a count needs a photo of the current round when
  it is 0, a found line, a recount, or the customer's `count_photo_required` ("foto wajib di setiap hitungan", admin
  switch on `Customer`). Accepting a line with a variance needs ≥ 1 photo. A counter cannot withdraw a photo a submitted
  count relied on. Only for sessions created after 0133 (`ckb_stocktakes.photo_rules`). Enforced by triggers on
  `ckb_counts`, `ckb_evidence`, `ckb_count_tasks`, so every writer obeys them. Found stock is two steps
  (`ckb_add_found_line`, then the normal count). SQL test 97.

### 5.5 Adjustments

Accepting a task with a variance creates one `PROPOSED` adjustment (unique per task). A
supervisor/admin who did not make the accepted count approves or rejects it; a batch decision is one
transaction. Quantities and identity are frozen by trigger; status only moves
`PROPOSED → APPROVED|REJECTED`, `APPROVED → EXPORTED`, and back to `APPROVED` only by voiding an export.

**There is no CKB stock ledger.** Approval is the posting point of this system; the approved
adjustment is the record. `Inventaris` shows the snapshot and, separately, proposed and approved
adjustments, and never a computed balance. Building a CKB ledger is a business decision (§10).

## 6. SAP export

An export freezes chosen `APPROVED` adjustments of one customer into lines (copied data) and marks
them `EXPORTED` in the same transaction. Statuses: `GENERATED → SAP_CONFIRMED` (someone records
SAP's document number) or `GENERATED → VOIDED` (admin, with reason; the adjustments return to
`APPROVED`). Re-export creates a new export of the same lines with a reason. Every download is
counted and logged.

**Open:** no SAP upload specification exists. The file is a review worksheet in format
`CKB-INTERNAL-1`, and the sheet says so in its header rows. Generating a file never changes any
status beyond `EXPORTED`; only a recorded SAP document number marks it posted.

## 7. Cargo inspection

Checklists are versioned templates (`ckb_inspection_templates`, items `CHECK`/`TEXT`/`NUMBER`,
required or not). Saving a template writes a new version; an inspection copies the items it was
created with. `DRAFT → SUBMITTED → ACCEPTED → CLOSED` or `SUBMITTED → REJECTED`. Submitting needs
every required item, a note on every NG, a photo when any item is NG (setting), and a finding or
damage class. Answers are frozen once submitted (trigger). The reviewer is never the inspector. A
rejected inspection stays; "Inspeksi ulang" creates a new one pointing back to it. An inspection
never changes stock.

## 8. Evidence

Private bucket `ckb-evidence`, **no storage policy for any client role**. Upload goes through
`POST /api/ckb/evidence`: role check, record's customer from the database, file type from its first
bytes (JPEG/PNG/WebP/PDF), size limit, path `{customer}/{type}/{record}/{uuid}.{ext}` built from ids
only, upload with the service role, then `ckb_register_evidence` as the user, which re-checks
everything (a failed registration removes the object). Download: `ckb_evidence_open` decides and
logs, then a 60-second signed URL.

Retention: `retain_until` = upload + `evidence.retention_days` (default 730). Nothing is deleted
physically; "Tarik" is a soft delete with a reason, only while the record is open, never under
legal hold. **Open:** archival to cheaper storage is recorded by hand (`archive_ref`) — no archive
service is configured.

## 9. Rebagging

The module of 0084–0087 is kept as built. 0106 changes only: CKB roles instead of Shell roles in
seven functions (copied verbatim otherwise — `tests/ckb-isolation.test.ts` proves it), `customer_id`
resolved from the customer name, a read policy for representatives on finished jobs, and the audit mirror.

**Conflict with the CKB isolation principle, not resolved here:** rebagging posting writes
`movements` on aisles CG/CH of the Shell ledger (0084–0086, confirmed on the floor 21 Oct 2026). The
Shell `apply_movement` trigger still requires a **Shell** supervisor for the loss adjustment, so a
CKB supervisor without a Shell supervisor role cannot post a rebagging job with a loss. Whether CKB
stock moves to its own ledger is decision §10.1.

**Since 0132 (Rak & Lokasi)** which racks CKB 3PL uses is data, not a zone list: `bins.owner = 'CKB'`
(CG, CH and CF21-CF40 level A at the migration; changed by an admin on `Rak & Lokasi`). Rebagging sources and
outputs must be CKB racks or floor locations, and a rebagging movement (its `ref_id` is the job) may not touch
a Shell rack; a Shell movement may not touch a CKB rack. The WMS import never books or zeroes CKB racks.

## 10. Decisions needed

1. **CKB stock ledger.** Should CKB keep its own balances (and rebagging stop posting to Shell's
   `movements`)? Until decided: snapshots + approved adjustments, no balance.
2. **CKB SAP file format.** A real file per customer to verify the column mapping.
3. **SAP adjustment transaction.** What SAP expects (movement types, upload layout) to replace
   `CKB-INTERNAL-1`.
4. **Ambiguous identities and batch mismatches.** How a duplicate identity or a different batch
   should become an adjustment (today: recount or exclude).
5. **Units of measure.** No conversions exist; counts are in the snapshot's unit.
6. **Customer approval.** Whether a customer must also approve adjustments (today: no).
7. **Archive service** for evidence older than two years.
8. **Shared account transition.** CKB requires personal accounts (`LOGIN_REQUIRED` may stay off for
   Shell); floor staff doing CKB work each need one.

## 11. Operating it

- Migrations: `0099`–`0107`, forward-only, applied in order after `0098`. `scripts/sql-test.sh` runs
  `supabase/tests/65`–`69` with the rest.
- First CKB admin: a Shell admin gives their own account the CKB app on `Pengguna` (Shell), opens
  `/ckb`, taps "Jadikan saya admin CKB pertama". From then on `/ckb/users`.
- Before the first stock take: admin checks `Pengaturan → Pemetaan kolom import SAP` against a
  real file, imports the snapshot, activates it.
