# CKB stock take: counters, blind counting, photos — design

Date: 8 Nov 2026 · Status: approved 8 Nov 2026 · Next migration: **0133** · Read with `docs/CKB_3PL.md` §5 (stock take).

## 1. Why

The CKB 3PL stock take (`/ckb/stock-take`, migrations 0101–0104) works but is run from one account, and:

- Counters can only be ticked on `Sesi baru` at creation. There is no way to assign or change who counts what
  afterwards, and a counter has no list of "my counts".
- Blind counting exists (`ckb_stocktakes.blind`; `ckb_stocktake_tasks` hides the SAP quantity from operators), but a
  supervisor counting with their own account sees "SAP 1" on every card — so in practice nothing has been blind.
- Photo evidence is optional everywhere in the stock take. In a 3PL count, differences, missing goods and found goods
  need proof; a customer audit (Freeport) would expect it.
- The count page (`/ckb/stock-take/[id]/count`) is hard to use on a phone: a pre-filled-looking `0`, the photo below
  the `Kirim` button, a collapsible evidence panel with a `Selisih` type that hints at the answer.

The user (warehouse lead) will have dedicated counters with their own accounts, assigned per aisle/location, counting
blind on a phone.

## 2. Goals

1. A supervisor assigns the lines of a stock take to counters **by location** (SAP storage bin), and can change it at
   any time before the session closes.
2. A counter sees **only the lines assigned to them**, and never any system/SAP quantity, variance or classification.
3. A counter's page with **two screens** (approved mockup `.superpowers/brainstorm/62364-1794133787/content/count-page.html`,
   screens 1 and 3; screen 2 merged into 3): **my list** → tap a line → **count screen** → send → next line opens.
4. **Photos (user-approved rules)**, enforced in the database:
   - required at count time when the count is **0**, for **found stock**, and on **every recount** (round > 1);
   - required (≥ 1 photo on the line, any round) before a supervisor can **accept a line with a variance**;
   - a per-customer setting **"foto wajib di setiap hitungan"** makes a photo required on every count of that
     customer's sessions.
5. The current count page looks and works like the mockup for everyone; supervisors additionally see the SAP number.

## 3. Non-goals

- Changing classification, review, adjustment approval or SAP export (CKB_3PL.md §5.3–§6).
- Counting on the Shell side; any Shell table (CKB isolation stays: `tests/ckb-isolation.test.ts`).
- Offline counting. Barcode labels for CKB locations.

## 4. Anti-goals

- Any screen, API response or file a counter can open that contains a baseline quantity, a variance or a
  classification other than "counted / not counted" — for a blind session. Hiding it only in the UI is not enough:
  `ckb_stocktake_tasks` and every other read path must not return it.
- A count that bypasses the photo rule through a retry, a second tab or a direct RPC call.
- A counter counting lines assigned to someone else.

## 5. Model (migration 0133, CKB tables only)

- `ckb_count_tasks.assigned_to uuid null references profiles(id)` (+ `assigned_at`, `assigned_by_name`). Null =
  unassigned.
- `ckb_customers.count_photo_required boolean not null default false` ("foto wajib di setiap hitungan").
- Assignment history goes to `ckb_audit_events` through `ckb_audit()` like every other CKB RPC.
- `ckb_stocktake_counters` (0101) is today the counting permission itself (`ckb_assert_can_count`, 0101:455-465; the
  count page reads it). It stays "who may count this session"; assigning a line to someone adds them there, and
  `ckb_assert_can_count` is rewritten per line (below), not just extended.
- `ckb_evidence.kind` gains `COUNT` ("Foto hitung"): the check constraint (0104:30) and the type list
  (`lib/ckb/evidence.ts`, upload route) change in 0133. The count screen uploads with this kind.
- `ckb_stocktakes.photo_rules boolean not null default true`; set false for sessions that exist when 0133 runs, so
  sessions already counting are not suddenly refused (user call by default: rules apply to new sessions).
- `count_photo_required` is set through a new RPC `ckb_set_customer_count_photo(p_customer, p_required)` (admin;
  `ckb_save_customer` has a fixed signature, 0099:396), shown on the customer's settings.

### Rules

- **Who may count a line (per line):** an operator may count an **assigned** line only when `assigned_to = auth.uid()`;
  an **unassigned** line follows today's session rule (session counters, or any staff when the session lists none).
  Supervisors and admins may count any line (they still cannot approve their own count — 0101). Evidence on a count
  task may be uploaded only by someone who may count that line, or a supervisor/admin.
- **What a counter reads (user decisions, 8 Nov):**
  - `ckb_stocktake_tasks(p_stocktake)` returns, for an operator, the lines they may count (assigned to them, plus
    unassigned ones under the session rule). For a blind session it already hides `baseline_qty`, `variance`,
    `wrong_bin_hint` and narrows `classification` (0101:292-300); it must **also** hide `latest_qty`,
    `accepted_qty`, `latest_counter` of earlier rounds and `decision_reason` — **a recount is blind**: the counter
    does not see their earlier number. "Diminta hitung lagi" is shown; the request's reason is not.
  - **Operators lose SAP quantities everywhere in CKB:** `ckb_sap_snapshot_rows` (0100:94), `ckb_adjustments`
    (0101:231), `ckb_counts` and `ckb_task_notes` (0101:227-230) become unreadable for the `operator` CKB role
    (supervisor/admin/customer rules unchanged). `/ckb/inventory` shows operators locations and materials without
    quantities; the session page hides adjustments from them; `ckb_dashboard` (0107) returns no
    `discrepancies_awaiting_review` to operators. The count page reads only through the RPC.
  - Supervisors/admins keep seeing SAP everywhere, also while counting (user decision).
- **Photo at count time:** `ckb_submit_count` refuses (`Foto wajib: …`) unless the task has at least one evidence row
  (`ckb_evidence`, `entity_type = 'COUNT_TASK'`, not withdrawn) uploaded **in the current round**, when any of:
  qty = 0, `origin = 'FOUND'`, `round > 1`, or the customer's `count_photo_required`. "In the current round" = uploaded
  after the round started (the time of the recount request, or the session start for round 1) — the builder picks
  the exact column; the idempotent `client_key` retry must keep working. Only when `photo_rules` is true.
- **Photos per round (user-confirmed, 8 Nov):** a recount needs a new photo taken in that round; earlier photos are
  never deleted or invalidated — they stay on the line labelled with their round, and supervisors see all rounds side
  by side on review. The counter's count screen shows only the current round's photos (earlier ones could reveal the
  earlier number).
- **A photo a count relied on cannot be withdrawn by the counter** once that count is submitted (supervisors/admins
  keep the existing withdraw-with-reason, which is logged); `ckb_withdraw_evidence` (0104:200-212) changes.
- **Found stock:** today `ckb_add_found_item` creates the task and its count in one call. It becomes two steps: create
  the found line (assigned to the caller), then the normal count screen, where the photo rule applies.
- **Accepting a variance:** `ckb_decide_task(..., 'ACCEPT')` with a non-zero variance refuses without ≥ 1 photo on the
  task (any round).
- **Assignment RPC:** `ckb_assign_count_tasks(p_stocktake uuid, p_bins text[], p_counter uuid | null, p_by_name text)`
  — CKB supervisor/admin; sessions in `DRAFT`, `COUNTING`, `REVIEW`; `p_counter` must be CKB staff with the app and
  active (same check as `ckb_create_stocktake`); null unassigns. Returns how many lines changed. A line already
  counted can be reassigned (its next round goes to the new counter).

## 6. Screens

### 6.1 Counter: `Hitung saya` (`/ckb/count`, CKB nav, all CKB staff)

List of sessions with lines assigned to me in `COUNTING` / `REVIEW` (customer, ref no, "12 dari 23 selesai"). One
session → straight into it.

### 6.2 Count page (`/ckb/stock-take/[id]/count`, rebuilt)

Two screens on a phone (desktop: list left, count screen right).

- **List:** navy header with customer, ref, "ditugaskan ke Anda", progress bar and "12 dari 23 selesai". Scan/type box
  (a scanner typing a location + Enter opens the single match). Segmented filter `Belum` / `Hitung lagi` / `Selesai`
  with counts. "Diminta hitung lagi" group first, then by storage bin. Each row: location plate, material, short
  description, unit; a tag for recount / done. "+ Barang tidak ada di daftar" (found stock).
- **Count screen:** location plate large, material, description, batch / expiry as recorded (the identity, not a
  quantity). "Berapa yang Anda lihat? (UoM)" with a big numeric field and − / + buttons; **empty until typed** (empty
  = not counted). Batch / expiry "sesuai?" checks as today. Photo block **before** the send button: plain "Ambil foto"
  when optional; amber "Foto wajib: <reason>" when required, and the send button reads "Ambil foto dulu" until one is
  uploaded. Note field. Send button "Kirim 2 DR". After sending: a short confirmation and the next line opens; "‹
  Kembali ke daftar" always available.
- Supervisors/admins see the SAP quantity and status on the same screens; operators never.
- Evidence uses the existing upload route (`POST /api/ckb/evidence`); the photo type on this screen is fixed to a
  neutral "Foto hitung" (no `Selisih` choice for a counter).

### 6.3 Assignment (`/ckb/stock-take/[id]/assign`, supervisor/admin)

Locations of the session (distinct storage bins) grouped by their aisle/area prefix (the part before the last number,
e.g. `SIP-` for `SIP-15`, `0101NP` for `0101NP0104`), each with line count and current counter. Select locations
(single, a whole group, or a filter), pick a counter, `Tugaskan` (one confirmation with a summary sentence). Per
counter: assigned lines and progress. Linked from the session page and from `Sesi baru` right after creation (the
creation form's counter tick boxes stay as "who may count").

## 7. Tests

SQL test 97: operator sees only assigned lines and no baseline/variance/classification in a blind session; supervisor
sees all; counting an unassigned line refused; each photo rule refuses without a photo and passes with one (qty 0,
found, recount, customer setting); a photo from an earlier round does not satisfy a recount; accept-with-variance needs
a photo; assignment RPC role checks and reassign; legacy session without assignments behaves as before. Existing CKB
tests (65–69) stay green; `tests/ckb-stocktake.test.ts` / `ckb-isolation.test.ts` updated where needed.

## 8. Left to the builder

Component structure, the exact "round started" timestamp, prefix grouping edge cases, desktop layout details, copy.

## 9. Calls made without the user

- Supervisors may still count any line (useful for small sessions); only operators are limited to their lines.
- Unassigned lines stay countable under the session's counter list, so assigning some locations doesn't lock the rest.
- Photo rules apply to sessions created after 0133; running sessions keep today's behaviour.
- A counter cannot withdraw a photo their submitted count relied on.
- Found stock becomes a two-step flow so the photo rule applies.
- The counter never chooses a photo type; supervisors keep the existing evidence panel on the review pages.
