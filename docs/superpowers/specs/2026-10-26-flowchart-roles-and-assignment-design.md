# Flowchart roles and shipment assignment — design

Date: 26 Oct 2026 · Status: approved 27 Oct 2026 · Source: `Flowchart_Proses_Bisnis_Tim_Shell_CKB (3).drawio`
(Tim Shell business process, inbound A–C, outbound D–G).

## Why

Login is on (`LOGIN_REQUIRED=true` on ckb-wms-v2 since 26 Oct 2026). Every person now has their own
account, but the app only knows three roles (`operator`, `supervisor`, `admin`), so an inbound admin
sees outbound planning, a checker sees the same menu as a forklift driver, and nothing says which
operator should pick which shipment. The flowchart names who owns each step; the app should give each
of those people the pages for their steps and nothing else, and let the inventory admin hand each
operator their shipments.

## Goals

1. Seven job roles, as the user chose them from the flowchart PICs:

   | Job (`job`) | Display (UI) | Who |
   |---|---|---|
   | `admin_inbound` | Admin Inbound | inbound desk: receipts, putaway, pallet cards |
   | `admin_outbound` | Admin Outbound | outbound desk: allocation, waves, DO numbers |
   | `checker` | Checker | Checker Inbound and Checker Outbound merged into one role |
   | `inventory` | Inventory | the one inventory admin; also assigns shipments |
   | `operator` | Operator / Picker | one role: forklift operators and pickers have the same pages |
   | `leader` | Leader | shift lead; today's `supervisor` |
   | `admin` | Admin | system admin (accounts, settings, import); not in the flowchart |

   Dropped on purpose (user's decision): Security, Scheduler, Krani, TKBM. No account type for
   Driver, PIC Transport, Tim Shell.

2. Each job sees exactly its pages — in the menu **and** on the server (a page outside the list
   redirects to `/?denied=1`, as `requireRole` does today).
3. **Shipment assignment.** The Inventory admin assigns a whole shipment — its `-FL` and `-HP`
   picklists together — to an Operator/Picker account. An Operator/Picker's `Wave` page shows only the
   shipments assigned to them; with none assigned it is empty and says
   `Belum ada shipment yang ditugaskan ke Anda.`
4. An Operator/Picker cannot post a pick on a shipment that is not assigned to them — refused by the
   database, not only hidden.

## Non-goals

- New pages for the flowchart's missing steps (gate/truck log, photos, loading sheet, DN/BAST, seal).
  Those are separate projects from the gap review.
- Changing the CKB 3PL app (`/ckb`) or its roles (`ckb_user_roles`). Untouched.
- Rewriting the ~210 `has_role(...)` checks in existing database functions.

## Anti-goals (a failure even if it works)

- Desk staff losing access on deploy day: today's `supervisor` and `admin` accounts keep everything
  (`leader`, `admin`). Today's `operator` accounts do change: they get the Operator/Picker pages
  below (no Penerimaan, Audit picking/putaway, Cycle count) and an empty `Wave` until shipments are
  assigned. That is the user's choice, not an accident; the Penugasan page must be ready the same day.
- Assignment changing the plan. Assigning or unassigning never touches `waves`, `pick_tasks`,
  `outbound`, FEFO order, `Sisa`, or the print/task-numbering order. It only decides who sees and posts.
- Two copies of the page list. The menu, the phone bar, the Home cards and the server gate all read one
  table.

## Decided design

### Job and level

- New column `profiles.job text not null default 'operator'`, check in the seven values above.
  Accounts with only the CKB app also get `operator`; the app gate (0105) already keeps them out of
  the Shell pages, so the job does nothing for them. *(Builder-check call.)*
- `profiles.role` (the existing `user_role` enum) stays and becomes **derived from `job`** — a trigger
  keeps it in step; nothing else writes it. Mapping:

  | job | role (level) |
  |---|---|
  | `admin` | `admin` |
  | `leader`, `admin_inbound`, `admin_outbound`, `inventory` | `supervisor` |
  | `checker`, `operator` | `operator` |

  So every existing `has_role` check keeps working unchanged, with the same meaning as today.
- `set_user_role` is replaced for the Shell app by `set_user_job(p_user, p_job)`: admin only, never on
  yourself, at least one active `admin` job remains (same rules as 0071's `set_user_role`). The old
  `set_user_role` is revoked from `authenticated` so the two cannot disagree.
- New accounts created on `Pengguna` default to `operator`, as today.

### Pages per job

One table in `components/app/nav-config.ts`: each link lists the jobs that may open it (replacing
today's `roles`). `requireRole` gains a sibling `requirePage(href)` that every page under `app/(app)/`
calls, reading the same table. Sub-routes follow their parent (`/audit/picking/...` follows
`/audit/picking`, `/receiving/[id]` follows `/receiving`, `/bin/[code]` follows `/scan`).
`/home` and the legal pages are open to every job.

| Page (UI name) | adm_in | adm_out | checker | inventory | operator | leader | admin |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Dashboard | ✓ | ✓ | | ✓ | | ✓ | ✓ |
| Scan (+ bin page) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Penerimaan | ✓ | | ✓ | | | ✓ | ✓ |
| Wave | | ✓ | ✓ | | ✓ (assigned only) | ✓ | ✓ |
| Penugasan (new) | | | | ✓ | | ✓ | ✓ |
| Alokasi | | ✓ | | | | ✓ | ✓ |
| Putaway | ✓ | | | | | ✓ | ✓ |
| Pickface | | | | ✓ | | ✓ | ✓ |
| Inventory | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Gudang 3D | | | | ✓ | ✓ | ✓ | ✓ |
| Adjust stok | | | | ✓ | | ✓ | ✓ |
| Mutasi | ✓ | | | ✓ | | ✓ | ✓ |
| Buku stok (0116, 28 Oct 2026) | | | | ✓ | | ✓ | ✓ |
| Cycle count | | | | ✓ | | ✓ | ✓ |
| Audit picking | | ✓ | ✓ | | | ✓ | ✓ |
| Audit putaway | ✓ | | ✓ | | | ✓ | ✓ |
| Kualitas data | | | | ✓ | | ✓ | ✓ |
| Lacak batch | | | | ✓ | | ✓ | ✓ |
| Label | ✓ | | | | | ✓ | ✓ |
| Kartu palet | ✓ | | | | | ✓ | ✓ |
| Master item | ✓ | | | ✓ | | ✓ | ✓ |
| Ikat barcode | | | | ✓ | | ✓ | ✓ |
| Import | | | | | | | ✓ |
| Pengaturan | | | | | | | ✓ |
| Pengguna | | | | | | | ✓ |

Inside a page, what a job may *do* keeps following its level (today's `supervisor`/`operator`
checks in the UI and the RPCs). Example: Checker on `Penerimaan` records the check (operator level)
but cannot create or post a receipt (supervisor level), exactly as an operator today.

### Shipment assignment

- Table `shipment_assignments (planned_date, shipment_number, user_id, assigned_by, assigned_by_name,
  assigned_at)`, primary key `(planned_date, shipment_number)` — **one operator per shipment**.
  Keyed on day + shipment number, not `wave_id`, so the assignment **survives re-running Alokasi**:
  `save_plan` replaces untouched waves with new ids but the same shipment numbers, and the
  assignment still applies. `save_plan` and carry-over are not changed. *(Builder-check call.)*
- A shipment carried to another day (`carry_over_wave`, `RESCHEDULED`) is not assigned on the new day;
  Penugasan lists it under `Belum ditugaskan`. *(Builder-check call.)*
- Reassigning or `Lepas` is allowed at any time, also part-way through picking. Lines already posted
  stay posted under the name of whoever posted them; from then on only the new operator can post the
  rest. Each change is its own row in the log. *(Builder-check call.)*
  Read policy for active users (`(select public.is_active())`), no write policy; writes through
  SECURITY DEFINER RPCs `assign_shipment(p_wave_id, p_shipment, p_user)` and
  `unassign_shipment(p_wave_id, p_shipment)`, callable by jobs `inventory`, `leader`, `admin`.
  `p_user` must be an active account with job `operator`.
- Assignment history is kept (append-only `shipment_assignment_log`: who assigned whom, when, who
  removed it) — the floor will ask "who had this shipment".
- A shipment that is `COMPLETED`/`CANCELLED`, or already loaded (`shipment_loads`), cannot be
  (re)assigned.
- **What the operator sees:** every task of the assigned shipment's wave — its `PICK` lines and the
  `REPLENISH` (Bin To Bin) rows that belong to that wave, since a wave is one shipment (`ad20444`).
  The rest of the Wave page (`Perlu ditangani`, other shipments, day arrows to days with no
  assignment) is filtered to the same shipments.
- **Enforcement:** every function that posts a wave task at operator level — whatever page calls it,
  including a `REPLENISH` (Bin To Bin) task posted from Scan or the bin page — refuses when the caller's
  job is `operator` and the task's `(wave_id, shipment_number)` is not assigned to them:
  `Shipment % tidak ditugaskan ke Anda`. A `REPLENISH` task belongs to its wave's shipment; an
  operator needing a move from another shipment's wave asks a Leader or Inventory, who are not
  restricted. Other jobs are not restricted by assignment. *(Builder-check call.)*
- **Penugasan page** (`/assign`, new): the chosen day's shipments (same date picker as `Wave`), each
  with wave no, shipment number, slot, truck, `-FL`/`-HP` line counts, status, and an operator
  dropdown (`Tugaskan` / `Lepas`), with the usual confirmation sentence
  (`Tugaskan shipment 109717235 ke Budi?`). Shows each operator's count of open assigned shipments so
  work can be spread. Live refresh like `Wave` (`0015` realtime). One row = one wave = one shipment.
  Approved sketch (desktop; each row becomes a card on a phone):

  ```
  Penugasan                                   [< 27 Okt 2026 >]
  Operator:  Budi 2 open  ·  Andi 1 open  ·  Sari 0 open
  NO  Shipment    Slot   Truck     FL  HP  Status     Operator
  1   109717235   08:00  L 9123 X  4   6   Belum      [ pilih operator v ] [Tugaskan]
  2   109717236   08:00  W 8812 B  2   3   Dipicking  Budi                 [Ganti] [Lepas]
  Belum ditugaskan (dipindah dari 26 Okt): 109717199
  ```

  Status: `Belum`, `Dipicking`, `Selesai`, `Dimuat`; `Selesai`/`Dimuat` rows cannot be (re)assigned.
  The page only assigns — picking details stay on `Wave`.
- **Cycle count stays off the Operator/Picker pages** (user, 27 Oct 2026: "no to cycle count for
  now"). Count tasks opened by a short pick are done by Inventory.

### Migration of existing accounts

- `admin` → `admin`, `supervisor` → `leader`, `operator` → `operator` (no one loses access).
- The six placeholder accounts created on 26 Oct get their jobs by username in the same migration:
  `admin.inbound` → `admin_inbound`, `admin.outbound` → `admin_outbound`, `checker` → `checker`,
  `inventory` → `inventory`, `operator` → `operator`, `leader` → `leader`. Absent usernames are
  skipped.
- `gudang` (shared account) stays `admin`.

### Pengguna

The role column and the `Tambah pengguna` form show the seven jobs (display names above) instead of
the three roles. Filter by job.

## Constraints

- Migration numbering continues after `0108`; pushed migrations are never edited.
- New table policies include `(select public.is_active())` (AGENTS.md).
- UI strings Indonesian, code English; confirmation step with a summary sentence on every action.
- Tests: SQL test file for job→level, `set_user_job` rules, assignment RPC rules and posting refusal;
  a `tests/*.test.ts` for the page table (every route under `app/(app)` is in it, every job's list
  matches the table above). Added to the `npm test` chain.

## Known limitation (accepted unless the user says otherwise)

The database checks the *level*, not the job. An Admin Inbound account (supervisor level) cannot open
`Alokasi`, but could in principle call a supervisor-level RPC such as `save_plan` directly through the
API. Closing that means a per-job check in each RPC; it is a later, separate change.

## Left to the builder

- Whether `requirePage` replaces `requireRole` calls or wraps them.
- The exact list of operator-reachable posting RPCs to guard (find them by `has_role` including
  `operator` on wave tasks).
- Layout of the Penugasan page, within the conventions (cards on phone, table on desktop).
- How the Wave page query is filtered (server-side join on `shipment_assignments` for job `operator`).
