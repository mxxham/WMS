# CKB 3PL — Housekeeping (design)

Status: **phase 1 built 24 Nov 2026** (migrations 0157-0158, SQL tests 117-118). One item still runs on a default (§10). Build notes:

- Photos are in their own table `ckb_hk_photos`, **not** in `ckb_evidence` as §5 first said: `ckb_evidence` stores `uploaded_by_name` and
  customers can read the evidence rows of their own records, so a housekeeping photo there would have shown the PIC's name. The files share the
  private bucket `ckb-evidence`; the unique SHA-256 index is on the new table.
- Bulk entry is **paste from Excel** (tab, semicolon or comma separated); uploading an .xlsx file is not built yet.
- Sections 4-7 describe what was built; sections 9 (phases 2 and 3) are still to do. Read `docs/CKB_3PL.md` first: this module follows its
access model, audit log and evidence rules, and adds nothing that bypasses them.

UI strings are Indonesian (quoted in `backticks`); code, comments and this document are English.

## 1. Purpose

Every CKB customer has racks in Oso 5 that CKB keeps clean and orderly. Today a person ticks a **paper** daily
checklist ("did the PIC do housekeeping today"). Customers have no evidence beyond that paper.

This module replaces the paper with a record the customer can **view**: each PIC photographs their location **before and
after** the housekeeping, every working day, and the customer sees the photos and the compliance for their own locations.

Not in scope for the first release: scoring quality, findings and corrective actions, a customer-facing 3D map, offline
queueing, billing. They are phases 2 and 3 (§9).

## 2. What was decided (user, 24 Nov 2026)

| Decision | Value |
|---|---|
| PIC | a **CKB employee**, with a personal account (CKB requires personal accounts) |
| Area | a **rack** (zone + rack number, e.g. `CG05`); each rack has its own PIC |
| One person per location | yes: one open PIC per area at a time |
| Frequency | **daily, Monday to Friday** |
| Proof | the PIC submits a **before and an after photo** for every housekeeping |
| Customers | **view only** |
| Language | Bahasa |
| Racks plus manual | racks come from the real CKB racks; an admin can also **add locations and PICs by hand** |
| Time between photos | **no minimum**: housekeeping may take less than 5 minutes; the after photo only has to come after the before photo |
| When it counts | a check-in is **done as soon as it is submitted**; a supervisor rejection takes it back |
| Other customers' goods in a photo | **acceptable**, no framing rule is enforced |
| New racks later | the admin button `Sinkron rak` (§5.1) |
| Photo retention | **180 days** |
| Reviewer | a **supervisor**; weekly quality (phase 2) is **judged from the photos** |
| PIC name | **never shown to customers**; only the supervisor and the admin (and the PIC, for their own work) see names |
| Late entries | **permitted**: a PIC may submit a check-in for a past working day within the late window (§4); it is flagged `late` |

## 3. Concepts

- **Area** (`ckb_hk_areas`): a place that gets housekeeping. `kind = RACK` (seeded from CKB's racks: aisles CG, CH and
  CF21-CF40 level A) or `MANUAL` (added by an admin: a floor spot, a dock, a corner). It has a customer, an active
  flag and optional 3D coordinates.
- **Assignment** (`ckb_hk_assignments`): which CKB employee is PIC of an area, from which date. History is kept, so an old
  check-in still names the right person after a PIC changes. At most one open assignment per area.
- **Working day**: Monday to Friday, minus `ckb_hk_holidays`. A PIC on approved leave (`ckb_hk_absences`) is not expected.
- **Check-in** (`ckb_hk_checkins`): one housekeeping of one area on one working day, with its before and after photos.
- **Compliance**: check-ins done ÷ check-ins expected, per area and per period (week, month).

## 4. The check-in

```
(no row)  --start (before photo)-->  STARTED  --submit (after photo)-->  SUBMITTED  --review-->  ACCEPTED
                                                                              \--review-->  REJECTED  (a new attempt is allowed)
```

- **Start**: the PIC opens their area for today and takes the **before** photo(s). The check-in exists from this moment, so
  a supervisor can see "started, not finished".
- **Submit**: the PIC takes the **after** photo(s) and submits. A check-in counts as **done** once it is `SUBMITTED` and not
  rejected.
- **Review** (supervisor): accept, or reject with a reason ("foto tidak menunjukkan rak", "foto sama"). A rejected check-in
  stops counting as done; the PIC does it again as attempt 2 the same day. Review is not required for a check-in to count.
- One check-in per area per working day per attempt (`unique (area_id, work_date, attempt)`). Never a future date. The work
  date of a normal check-in is the Jakarta date of the server clock.
- **Late entries are permitted.** The PIC may start and submit a check-in for a **past working day of their own area** within
  `late_window_working_days` (setting, default **3** working days). It counts as done, is stored with `late = true` and the
  day it was really sent (`submitted_at`), and is marked `Terlambat` for the supervisor. Older than the window, or a day
  the PIC was not assigned, only a supervisor or admin can add it, as an on-behalf entry. A holiday or a leave day cannot
  be filled.
- A supervisor or admin may record a check-in **on behalf of** a PIC (illness, no phone, beyond the late window) with a reason;
  it is marked `on_behalf`. The customer sees the mark, not who recorded it.
- Append-only like the rest of CKB: a check-in is never edited after submit; a correction is a new attempt or a review.

### 4.1 Photo rules (defaults, to confirm in §10)

- At least **1 before and 1 after**, at most 3 of each. Kinds `BEFORE` and `AFTER` on the existing evidence tables.
- **Server time only.** The app stores when the server received each photo; the time a phone claims is ignored.
- The **after** photo must be received **after** the first **before** photo (server order). There is no minimum gap: short
  housekeeping is normal (user decision 24 Nov 2026). `min_gap_minutes` stays a setting, default **0**.
- **Exact duplicates are refused**: the SHA-256 of every housekeeping photo is unique across all housekeeping evidence
  (the same file cannot be reused for another day, another area or for before and after).
- Taken with the phone camera (`capture` on the file input). The browser cannot prove a photo was live; the duplicate check
  and the supervisor review are the controls, and this document does not claim more.
- Photos are resized in the browser (long edge 1600 px, JPEG) before upload to keep a week of photos small.
- Private storage and signed URLs exactly as `docs/CKB_3PL.md` §8: type from the first bytes, size limit, path built from ids.

## 5. Data (all `ckb_hk_*`, migrations from `0157`)

| Table | Purpose |
|---|---|
| `ckb_hk_areas` | `id`, `code` (unique, e.g. `CG05`), `name`, `kind` (`RACK`/`MANUAL`), `customer_id`, `zone`, `rack`, `pos_x/y/z` (nullable), `active`, `note` |
| `ckb_hk_assignments` | `area_id`, `pic_user_id`, `pic_name`, `from_date`, `to_date` (null = open); exclusion constraint: no two overlapping assignments of one area |
| `ckb_hk_holidays` | `holiday_date`, `reason` |
| `ckb_hk_absences` | `user_id`, `from_date`, `to_date`, `reason`, `recorded_by` |
| `ckb_hk_checkins` | `area_id`, `work_date`, `attempt`, `status`, `pic_user_id`, `pic_name`, `started_at`, `submitted_at`, `late`, `on_behalf_by`, `on_behalf_reason`, `reviewed_by`, `reviewed_at`, `review_note` |
| existing `ckb_evidence` | new entity `HOUSEKEEPING` (record = the check-in), new kinds `BEFORE` and `AFTER`, plus a `sha256` unique index for that entity |
| `ckb_settings` key `housekeeping` | `min_gap_minutes` (default 0), `max_photos_per_kind` (3), `photo_retention_days` (**180**), `max_edge_px` (1600), `late_window_working_days` (3) |

Rules carried over from `docs/CKB_3PL.md` §2.2: RLS on every table, **no write policy**, every write is a SECURITY DEFINER
RPC that checks the CKB role first and calls `ckb_audit()`; policies use `(select public.account_active())`.

RPCs (all log an audit event): `ckb_hk_save_area`, `ckb_hk_assign`, `ckb_hk_import_preview` and `ckb_hk_import_apply`
(Excel paste or upload: area, customer, PIC), `ckb_hk_sync_racks`, `ckb_hk_set_holiday`, `ckb_hk_set_absence`,
`ckb_hk_start`, `ckb_hk_submit`, `ckb_hk_review`, `ckb_hk_record_on_behalf`.

### 5.1 Racks from Shell, without breaking the isolation rule

`tests/ckb-isolation.test.ts` forbids CKB code from reading the Shell `bins` table. So:

- the **first fill** of `ckb_hk_areas` is a one-time statement inside a migration (it reads `bins where owner = 'CKB'`, groups
  by zone + rack, and copies the code and the 3D coordinates). The isolation test is extended to allow exactly that file.
- **Later racks** come in through `Sinkron rak` (admin), a narrow SECURITY DEFINER function that returns only code, zone, rack
  and coordinates of `owner = 'CKB'` racks. It only ever **adds** areas; it never deletes, renames or changes an area, a
  customer or a PIC that someone edited. Open decision §10.5: this function, or a pasted list.
- after the first fill, the housekeeping module never reads `bins` again; it reads only `ckb_hk_areas`.

### 5.2 Who sees what

| Role | Can |
|---|---|
| `operator` (the PIC) | see and check in **own** areas, today and late within the window; see own history (their own name only) |
| `supervisor` | see every area, **PIC names**, reviewers and who recorded on behalf; review, record on behalf, assign PICs, record leave and holidays |
| `admin` | everything a supervisor can, plus add and edit areas, bulk import, sync racks, settings |
| `customer` | read-only: their customers' areas, the week strip, compliance, the `Terlambat` and `dicatat oleh supervisor` marks, and the photos of **submitted, not rejected** check-ins. **No person's name anywhere** |

Customers never see drafts (`STARTED`), rejected check-ins, the audit log, or other customers' areas.

### 5.3 No names for customers: how it is enforced

Row-level security hides rows, not columns, so this is built in, not left to the screens:

- `ckb_hk_checkins` and `ckb_hk_assignments` have **no customer read policy at all**. A customer reads housekeeping only
  through a SECURITY DEFINER function (`ckb_hk_customer_week`, `ckb_hk_customer_photos`) that returns day, area, state,
  `late`, `on_behalf` as a yes/no and the photo ids, and **never** `pic_*`, `reviewed_by`, `on_behalf_by` or any name.
- `ckb_evidence` already carries `uploaded_by_name`, and its policy `ckb: evidence follows its record` would let a customer
  read it. The housekeeping entity is therefore **excluded from the customer branch of that policy**; customers get the
  photos only through `ckb_hk_customer_photos`, which also issues the signed URL through `ckb_evidence_open` (logged).
- The monthly download for customers has no name column.
- A SQL test runs every customer-facing read as a customer and fails if any returned text contains a seeded PIC name.

## 6. Screens (Indonesian)

**PIC: `Housekeeping hari ini`** (phone first). The PIC's areas as a checklist, in the style of the audit pages: a progress
line `3/5 rak selesai`, a mark per area (`Belum`, `Foto sebelum terkirim`, `Selesai`, `Ditolak: <alasan>`), tap an area:
`Foto sebelum` (camera) → `Foto sesudah` (camera) → `Kirim`. A rejected area shows why and a
`Ulangi` button. If the day is not a working day, or the PIC is on leave, the page says so instead of listing tasks.

**Supervisor: `Rekap housekeeping`.** A grid of PIC (or area) by Monday-Friday of the chosen week with a mark per cell (done,
started, missed, leave, holiday), a queue of submitted check-ins to review with the before and after photos side by side,
`Terima` / `Tolak` (reason required), and `Catat atas nama` for on-behalf entries.

**Admin: `Area & PIC`.** The area list with filters (customer, PIC, kind, unassigned), `Tambah lokasi` (manual), `Ganti PIC`
(with the date it takes effect), `Sinkron rak`, `Impor dari Excel` (paste or upload with a preview and the rows it would refuse),
`Hari libur`, `Cuti`.

**Customer: `Housekeeping`.** For each of their areas: the week strip Monday-Friday, compliance for the week and the month, and
the before and after photos of each submitted day, with a `Terlambat` mark on a late day. No names. A monthly download (Excel)
with the numbers.

Navigation: one new entry in `CKB_MODULES` and in `lib/ckb/permissions.ts` (group `Operasional`); every page gated with
`requireCkb(path)`, every route with `checkCkb(roles)`.

### 6.1 Phase 1 as built (25 Nov 2026, replaces the three separate screens above)

All of it is one page, `/ckb/housekeeping`, with tabs by role and one sidebar entry. PIC: `Hari ini` (a card per rack, two big tap-to-camera
slots, a wrong photo removed with its x, a sticky `Kirim`) and `Riwayat` (30 days, rejection reasons). Supervisor and admin: `Rekap` (KPI strip,
week grid where every cell opens the **day dialog**, PIC and problem filters, review queue with `Terima yang dipilih`, `Pengingat` of PICs who
still owe racks today) and `Area & PIC`. The day dialog shows every attempt of a rack on a day with photos, who did it and the review note,
and offers `Terima`/`Tolak`, `Catat atas nama`, `Batalkan check-in`, `Bebaskan hari`. Customer: week table, month calendar, photo lightbox,
`Laporan` (Excel, PDF) and `Foto per rak` (PDF built in the browser). Migration `0159`, SQL test 119.

### 6.2 Phase 2 as built (24 Nov 2026): weekly quality

Decided with the user: three levels per item (Baik / Perlu perbaikan / Buruk), one shared checklist the admin edits, the customer sees the score
plus findings with photo and status (never a name), the PIC fixes and a different lead verifies. Migration `0160`, SQL test 120. Rack, week and
photos decide the score; a finding is raised from a photo in the scoring dialog; the fix may cite a later photo of the same rack. Reminders,
trends over months, the 3D heat map and the offline queue stay in phase 3.

### 6.3 Phase 3, first part (24 Nov 2026): offline photo queue

Built: the offline photo queue (see `docs/CKB_3PL.md` §12). Reminders stay in-app only (user decision). Not built, still open: the monthly
customer PDF with trends, the customer-scoped 3D heat map (needs CKB rack coordinates), an admin settings screen, `.xlsx` upload for the
area import, and a real reminder channel (email or WhatsApp needs a provider and credentials).

## 7. Pure logic (`lib/ckb/housekeeping.ts`, zero I/O, tested)

- `workingDays(from, to, holidays)`: Monday to Friday minus holidays, by Jakarta date.
- `expectedCheckins(areas, assignments, absences, holidays, day)`: which areas must be checked in on a day.
- `compliance(expected, done)`: a ratio that is `null`, not 100%, when nothing was expected.
- `checkinState(...)`: `NOT_STARTED`, `STARTED`, `SUBMITTED`, `LATE` (submitted after its day), `REJECTED`, `MISSED` (a past working day with nothing done), `LEAVE`, `HOLIDAY`.
- `lateWindowOpen(workDate, today, holidays, windowDays)`: whether a PIC may still fill a past working day.
- `photoRuleError(...)`: the first rule a submission breaks (too few photos, an after photo that is not after the before photo, too many).

## 8. Tests

- SQL (`supabase/tests/117+`): area and assignment constraints (one open PIC, no overlap); the check-in lifecycle and its
  refusals (future date, a day beyond the late window, a holiday or leave day, someone else's area, after photo not after the before photo, duplicate photo hash, submit without photos, edit after
  submit); on-behalf and review rules; the customer sees only submitted, not-rejected check-ins of own customers and nothing
  of other customers; the audit event of every RPC; the rack sync adds and never changes edited areas.
- TS: `lib/ckb/housekeeping.ts` (working days across a holiday and a weekend, expected check-ins with leave and a changed PIC,
  compliance with nothing expected, states, photo rules).
- `tests/ckb-isolation.test.ts` updated: the migration list, and the housekeeping files read no Shell table.

## 9. Phases

1. **Phase 1:** areas and PICs (racks plus manual, bulk import), the daily before/after check-in, supervisor review and recap,
   holidays and leave, the customer view and monthly Excel.
2. **Phase 2:** weekly quality: a supervisor scores each area from its photos of the week (a short checklist per area), findings with a photo, corrective actions
   with an owner and a due date, verified by someone other than the fixer; the customer sees the score and open actions.
3. **Phase 3:** trend and PDF report, a customer-scoped 3D heat map coloured by score (CKB's own copy of the rack coordinates,
   never `bin_summary`), offline queueing for poor Wi-Fi, a reminder for check-ins not started by a set hour.

## 10. Decisions

**Decided** (user, 24 Nov 2026): no minimum gap between the photos; a check-in counts as done once submitted; other customers'
goods in a photo are acceptable; rack sync by the `Sinkron rak` button; housekeeping photos kept **180 days**; a supervisor
reviews, and the weekly quality score is judged from the photos.

**Also decided (24 Nov 2026):** customers never see a PIC's name (§5.3); late entries are permitted (§4).

**Still on a default** (change it before the build starts):

1. **Holidays.** Entered by hand by a supervisor or admin (`Hari libur`). A yearly list can be pasted in once.

Two small choices I made inside the late rule, easy to change: the **window is 3 working days**, and the customer **does see**
a `Terlambat` mark (no name) on a late day, because compliance without it would look better than it was.

**Still open outside this module:** the archive service for evidence older than the retention (item 10.7 of
`docs/CKB_3PL.md`). With 180 days of retention and roughly 1,000-3,000 photos a week the storage is about 8-22 GB at a time
(300 KB per photo after the browser resize); nothing is deleted physically (`docs/CKB_3PL.md` §8), so the retention date only
marks when a photo may be archived.
