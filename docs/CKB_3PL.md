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
| Housekeeping: areas and PICs, the daily before/after photo check-in, review, customer view (§12) | Working (phase 1); weekly quality, actions and the 3D heat map are later phases |

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
- **Count profile per customer (0161-0163, 25 Nov 2026; spec `docs/superpowers/specs/2026-11-25-ckb-emcl-stocktake-design.md`):** a customer may have its own SAP
  column mapping (`ckb_customers.sap_mapping`, else the global one), count by `MATERIAL_BIN` instead of the full identity (lines that differ only by batch become one task, the codes are
  information, `BATCH_MISMATCH` cannot occur; "never summed silently" still holds for the same full identity twice) and one photo per bin (`photo_scope = 'BIN'`). First customer: Exxon (EMCL),
  seeded with an unverified mapping for its file. The defaults are unchanged for the six original customers. SQL tests 121-122.
- **Open:** the first real CKB SAP file (Exxon, `Stock in Bin as of 13 Nov 26`) has been read, but its mapping stays `verified: false` until an admin checks a real import. Other customers still have no sample file. The header aliases in
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

### 11.1 Home and sign-in (25 Nov 2026)

`/ckb` is the **home** (route group `app/ckb/(home)`, `components/ckb/ckb-home.tsx`), the CKB twin of the Shell Home: the floor photo in navy, the greeting,
one yellow floor line to the role's first stop (`Buka dashboard`; an operator's is `Mulai hitung`), a board of four counts for the role
(from `ckb_dashboard`, `ckb_hk_dashboard` and, for a customer, their RLS-filtered records; an unreadable count shows 0 so the home always opens), the
directory of every page the role may open (`components/ckb/home-copy.ts` holds the one-line blurbs) and the builders band. The **dashboard** moved to
`/ckb/dashboard` (its own `loading.tsx`; `app/ckb/loading.tsx` is now a neutral fallback). The sidebar has `Beranda` (`/ckb`) above `Dashboard`.
Signing in with a CKB-only account lands on `/ckb` and the login line continues into it exactly as it does into the Shell `/home`: the login page adds
`floor-exit` (the line drives off, `Masuk` folds into it), then the home's own line runs in from the left (`login-form.tsx` treats `/home` and `/ckb`
alike). `requireCkb` still sends a refused page to `/ckb?ditolak=1`, which the home explains. The login page no longer names Shell or any one
customer (it serves both applications): headline `Gudang CKB, Surabaya.`, plates `Shell WMS` · `CKB 3PL` · `Satu akun`; each field is judged on its own, and a
Caps Lock hint shows on the password.

**Logo and footer (25 Nov 2026).** The CKB sidebar, the phone header and the home use the JE-IR logo (`BRAND.logo`, as the Shell sidebar does) with "CKB 3PL"
written beside it; the plain "3PL" tile is gone. Every CKB page ends with `CkbFooter` (`components/ckb/ckb-footer.tsx`, rendered by `app/ckb/layout.tsx`), the
Shell footer's words: owner, name, credit, the internal-use notice and `Kredit` / `Lisensi` / `Privasi`. A CKB-only account cannot open the Shell's `/lisensi`
and `/privasi` (the `(app)` layout is Shell-gated), so CKB has its own `/ckb/lisensi` and `/ckb/privasi` (gated by `requireCkb`, open to every CKB role, not in the
menu); both render the same shared content as the Shell pages (`components/legal/`). `Kredit` goes to the builders band on the CKB home (the Shell's opens its welcome
screen, which CKB does not have).

## 12. Housekeeping

Spec: `docs/superpowers/specs/2026-11-24-ckb-housekeeping-design.md`. Migrations `0157` (areas, PICs, holidays, leave),
`0158` (check-ins, photos, day states, customer functions) and `0159` (withdraw a photo, abandon, excuse, report, dashboard,
badge); SQL tests 117-119, `tests/ckb-housekeeping*.test.ts`. **One page**, `/ckb/housekeeping`, with tabs chosen by role
(`?tab=`, validated on the server): PIC `Hari ini` and `Riwayat`; supervisor and admin `Rekap` and `Area & PIC` (and `Hari ini`
when they own racks); a customer has no tabs. One sidebar entry (badge: check-ins awaiting review for a lead, racks not yet
done today for a PIC, from `ckb_hk_badge()`). Photos: `/api/ckb/housekeeping/photo` (POST) and `.../photo/[id]` (GET, `?raw=1`
streams the bytes for the photo pack).

- **Area** = a rack (zone + rack number, `CG05`; first fill and `Sinkron rak` read the CKB racks of the Shell `bins` table, the only
  place housekeeping touches Shell data; `Sinkron rak` only adds) or a manual location. One open **PIC** per area, history kept.
- **Check-in** = one housekeeping of one area on one working day (Monday-Friday, minus `ckb_hk_holidays`; a PIC's leave in
  `ckb_hk_absences` is not expected). `STARTED` (before photo) -> `SUBMITTED` (after photo; **counts as done at once**) ->
  `ACCEPTED` or `REJECTED` by a supervisor who is never the doer; a rejection takes it back and the PIC starts attempt 2.
- **Late entries**: the PIC may fill a past working day of their own area within `late_window_working_days` (3), flagged
  `late`; beyond it, or for another person, only a supervisor or admin, on behalf with a reason. Never a future day, a holiday or a leave day.
- **Photos** live in `ckb_hk_photos` (not `ckb_evidence`: that table stores `uploaded_by_name` and its customer policy would
  show it), in the same private bucket under `{customer}/HOUSEKEEPING/{check-in}/{uuid}.{ext}`. SHA-256 is unique across all
  live photos (a file cannot be reused; a withdrawn photo frees its file), server time only, no minimum gap, 1-3 of each kind,
  kept `photo_retention_days` (180). **A wrong photo** is withdrawn (`ckb_hk_withdraw_photo`, only while the check-in is `STARTED`,
  by its owner or a lead): the row and the file stay, but it no longer counts, a customer never reaches it, and its file may be used again.
- **Stuck and excused days (0159)**: a `STARTED` check-in nobody finishes is abandoned (`ckb_hk_abandon` -> `CANCELLED`, owner or lead;
  the day reads missed again and the next attempt can be a PIC's or a lead's on-behalf). A lead never resumes someone else's started
  check-in. A day that cannot be done is excused by a lead (`ckb_hk_excuse` -> `EXCUSED`, reason required, `ckb_hk_revoke_excuse` undoes it):
  it is not expected, like leave, and a customer sees it as not scheduled, never the reason. `ckb_hk_start` takes an advisory lock per
  area and day; `ckb_hk_grid_core` refuses a range over 93 days. Only a customer's view of a photo is written to the audit log.
- **Weekly quality (0160, phase 2)**: one shared checklist (`ckb_hk_checklist_items`, admin edits it; a retired item stays on old
  scores) is rated by a supervisor or admin per rack and Monday-week from that week's photos: `Baik` 2 / `Perlu perbaikan` 1 / `Buruk` 0
  points over the best possible, whole percent (`ckb_hk_score_week`; the person who holds the rack that week never scores it; a rack with no
  done check-in that week cannot be scored). A re-score is a new version, scores and lines are append-only, line wording is a snapshot.
  A **finding** points at one live photo of a done check-in of the rack (`ckb_hk_raise_finding`), the rack's PIC marks it fixed with a note
  and optionally a later photo (`ckb_hk_fix_finding`), and a lead who neither raised nor fixed it verifies it or sends it back
  (`ckb_hk_verify_finding`); a lead may cancel with a reason. No write policy on any of the four tables. A customer reads only
  `ckb_hk_customer_quality` and `ckb_hk_customer_findings` (percentage, item, description, status, dates, photo ids; `VERIFIED` reads as
  `DONE`, `CANCELLED` is never sent, no person, no fix, verification or send-back note); the description is typed by a lead and is shown with
  a warning not to write names. Tab `Kualitas` for leads, `Temuan` for PICs, a section on the customer page. SQL test 120, `tests/ckb-housekeeping-quality.test.ts`.
- **Offline photo queue (phase 3, no migration)**: a photo is shrunk, stored on the phone first (IndexedDB, per signed-in account) and
  then sent, so poor Wi-Fi, a closed tab or a crash never loses it; it leaves the phone only after the server confirmed it
  (`lib/ckb/hk-upload-queue.ts` pure rules, `hk-upload-runner.ts` storage and sender, `app/ckb/housekeeping/upload-queue.tsx` banner and
  hook). It is sent when the page opens, when the signal returns, when the tab comes to the front and every 15 s while something waits;
  backoff 5 s to 5 min; photos of one check-in go in the order taken. An answer that means "try later" (no signal, 5xx, expired session,
  a redirect to the login page) keeps the photo; a rule refusal (maximum, wrong state, the same file again) is final and shows its reason with
  a `Hapus` button. A photo whose answer was lost and is then refused as "same file" counts as sent. Waiting photos count toward the
  per-kind maximum and block `Kirim` until they are on the server. Only one tab sends at a time (Web Locks). Limit: it sends only while
  the housekeeping page is open (no service worker). Without IndexedDB (private window) the old direct upload is used.
  `tests/ckb-hk-upload-queue.test.ts`.
- **Customer report (0159)**: `housekeeping` in `REPORTS` (Excel and PDF from `/api/ckb/reports`) is one name-free row per rack and day
  (`ckb_hk_report`); a **photo pack** per rack for a week or a month is built in the browser (`lib/ckb/hk-photo-pack.ts`, jsPDF, one page
  per done day, at most 31) because a server response is limited to about 4.5 MB. Reminders are in-app only (`Pengingat` list, tiles, badge).
- **No names for customers (§5.3 of the spec)**: a customer has no policy on any `ckb_hk_*` table; they read only through
  `ckb_hk_customer_week`, `ckb_hk_compliance`, `ckb_hk_customer_day` and `ckb_hk_photo_open`, which return no PIC, reviewer or
  on-behalf name. Leave reads as "not scheduled". `ckb_hk_grid_core` carries names and is not callable by the app.
  SQL test 118 asserts it, `tests/ckb-housekeeping-isolation.test.ts` guards the migrations.
- **Compliance** = days done / days expected; a day not over counts only once done; nothing expected is `-`, never 100%.

