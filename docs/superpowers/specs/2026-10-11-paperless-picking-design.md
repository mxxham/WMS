# Paperless picking — design

Date: 2026-10-11 · Branch: `feat/independent-stock` · Scope: a line-by-line picking screen for the
floor, built on the `Isi dari picklist` engine. Supervisor tools unchanged.

## Goal

Operators and pickers work a wave on the phone instead of from a printed picklist. At the bin they
post the line as it really happened — quantity, source bin and batch, a second source, where the
pallet rest went — with everything `Isi dari picklist` can do for one line, inside limits that keep
large stock corrections behind a supervisor.

## Decisions (agreed)

| Topic | Decision |
|---|---|
| Who | Everyone who opens the Wave page. "Picker" is not a role; pickers are `operator`. |
| Flow | Line by line, in walking order. Each line posts on its own at the bin. |
| System short | The line posts with a `Koreksi picklist` (FOUND adjustment + count task) only when every correction it needs is ≤ `adjust_approval_qty` (20). Above it, nothing of the line posts: "minta supervisor". |
| Mistakes | The picker re-posts a line they posted themselves (same typed name), while the wave is open and the line is neither audited nor loaded. Anything else: supervisor. |
| Enforcement | The live site shares one admin session (`Gudang`), so roles cannot tell a picker from a supervisor. The limits live in the picker screen's database function and apply to whoever uses it. "Own line" = `same_person()` on the typed name. |
| Quantity | Labelled `Qty` with the item's unit (`uomLabel(lookupUom(sku) ?? uom)`: Carton, Drum, Pail, IBC, Fluidbag) — never "karton". Summaries say "ambil 4 Drum dari CF34C01". |
| Scan or type | Item: phone camera, a USB/Bluetooth scanner, or the SKU / barcode typed (`ItemScanInput`, resolved by `item_by_barcode`; a typed SKU counts as the scan). Optional unless `require_scan_on_pick` is on. Bins (source, Bin To Bin destination): scan the location label (QR / Code 128) or type the bin code. |
| Escalation | Every line refused with "minta supervisor" is recorded and listed under `Perlu ditangani` on the Wave page until a supervisor posts the line or closes the request. The picker moves on. |
| Progress | No time target. The target is what the order needs; progress is what has been picked, so the picker sees at once whether a line, a shipment or the wave is still short. Quantities are per unit (`812/1.242 Carton · 20/24 Drum`), never summed across units; lines are the count that adds up. |
| Order | The screen lists lines in the one fixed print order (NO waves by earliest slot then NO, shipments by slot then number, walking order) — the same order as the printed picklist, task numbers and `Sisa`. |
| Unchanged | `Isi dari picklist`, `Batalkan posting`, `Perbaiki`, `Adjust stok`, the wave table and its per-row `Posting` dialogs, the printed picklist (still available, no longer needed). |

## Facts this builds on

- `post_wave_sheet(p_wave_id, p_rows, p_by_name, p_reason)` (0057 → 0062) posts any rows of one wave
  as the paper says: per row a pick with 1..n sources and an optional Bin To Bin (`move_to`,
  `move_qty`). It orders pallet-first (0062), reads a batch the bin does not hold as the bin's own
  (0061), splits a short batch over the bin's other batches (`batch_fill`), posts open relocations
  into a bin first, and books what the bin still lacks as `Koreksi picklist` (FOUND) with a count
  task (`sheet_ensure_stock`). An already-posted row that differs is undone (`unpost_task`) and
  posted again. It returns `{rows, auto[]}`; `auto` lists every `correction` with its `qty`.
- It is supervisor/admin only, and raises the task quantity when the paper took more than planned.
- `unpost_task` refuses a loaded shipment and a picking-audited line.
- `post_task_by` validates the carton scan (`require_scan_on_pick`); `bin_left_after` /
  `record_bin_check` drive `Cek sisa bin` (0058); `complete_wave_by` closes a wave (operator allowed).
- `pick_tasks.picked_by_name` holds the typed name of the posting.
- `lib/wave-sheet.ts` (`buildSheet`, `sheetNotes`, `leftoverAfter`) turns a wave's tasks into
  sheet lines (pick + its move) and predicts what the database will do.

## 1. Database — migration `0067_pick_line.sql`

**Shared engine.** The body of `post_wave_sheet` moves unchanged into
`post_wave_sheet_rows(p_wave_id, p_rows, p_by_name, p_reason)` — no role check, `revoke`d from
every client role. `post_wave_sheet` becomes: the supervisor/admin check, then a call to it.
`Isi dari picklist` behaves exactly as before (its tests 32, 35, 36, 37 stay green).
The engine itself calls `split_task` (two sources, batch fill) and `unpost_task` (re-post), which
are supervisor/admin only; `post_wave_sheet_rows` sets the transaction-local flag
`app.sheet_engine` and those two accept a call while it is on — the same trust pattern as
`app.adjust_approved`: clients cannot set it, only database functions do.

**`post_pick_line(p_wave_id, p_row jsonb, p_by_name, p_reason, p_scanned)`** — granted to
`authenticated`, any role. One row in the `post_wave_sheet` row shape
(`pick_id`, `move_id`, `sources[]`, `move_to`, `move_qty`). In one transaction:

1. **Name and wave** — `person_name(p_by_name)`; required. The wave must be `PENDING` (a `Tunda`,
   finished or cancelled wave is a supervisor's: "wave NO x sedang Tunda").
2. **Scan** — when the policy requires a scan on pick and the SKU has a barcode, `p_scanned` must
   resolve to the line's SKU (the same rule `post_task_by` applies).
3. **Quantity** — the sources' total may not exceed the pick task's planned quantity (the order
   line). More is refused: "lebih dari order (X Drum)". Fewer is a short pick, as today.
4. **Re-post** — if the pick (or its move) is already `COMPLETED`, it must have been posted under
   the same name (`same_person(picked_by_name, p_by_name)`), the wave must be `PENDING`, the line
   not picking-audited and its shipment not loaded. Otherwise: "baris ini diposting oleh X: minta
   supervisor".
5. **Post** — `post_wave_sheet_rows(p_wave_id, [p_row], p_by_name, p_reason)`.
6. **Correction limit** — any `auto` entry of kind `correction` with `qty > adjust_approval_qty`
   refuses the line: "sistem hanya punya H di BIN untuk SKU batch B, diambil Q: minta supervisor".
   Steps 5–6 run inside a `begin … exception` block (a savepoint), so the refusal rolls back the
   whole line — nothing is posted, nothing corrected — while the function itself goes on to step 7.
7. **Escalation** — a refusal that needs a supervisor (correction over the limit, another name's
   line, an audited or loaded line, a `Tunda` wave) is written to `pick_line_requests` and returned
   as `{result: 'refused', kind, message, request_id}` instead of an error. Input mistakes the
   picker fixes themselves (no name, quantity above the order, bad bin, missing scan) are plain
   errors and are not recorded.
8. Otherwise returns the `post_wave_sheet` answer plus `{result: 'posted', posted_by, corrections}`.

**`pick_line_requests`** — `id`, `wave_id`, `pick_id`, `move_id`, `row` (what the picker posted,
the `p_row`), `by_name`, `kind` (`correction_over_limit` / `other_picker` / `audited` / `loaded` /
`wave_not_pending`), `message`, `created_at`, `status` (`OPEN` / `CLOSED`), `closed_by_name`,
`closed_at`, `close_note`. Read for `authenticated`, no write policy. The view
`pick_line_requests_open` lists `OPEN` requests whose pick has not been posted (or re-posted) since
the request — a supervisor posting the line through `Isi dari picklist` makes it drop off by itself.
`close_pick_line_request(id, by_name, note)` (supervisor/admin, name and note required) closes one
that needs no posting.

The picker name is written to `picked_by_name` on every task the line posts (including split and
batch-fill pieces), so the next re-post can check it.

## 2. Screen — `Picking` on the Wave page

`Mulai picking` on every wave that is not cancelled, for all roles, opens
`app/(app)/waves/picking-panel.tsx` in place of the wave's table (like `Isi dari picklist`).
Phone first: one card per line, full width; on a desktop the cards stay one column.

**Header** — wave NO, shipment(s), `12/25 baris`, the picker's name (remembered,
`usePersonName`), `Tutup`.

**Card (open line)**
- Bin as the yellow location plate; SKU, description; batch, expiry; `Qty` with unit;
  `PALLET` / `CASE`; for a broken pallet "sisa → CB18A02 (23 Carton)".
- `Scan barcode` when the SKU has one (required when the policy says so): camera, scanner or typed.
- **`Sesuai`** — posts as planned after one confirmation sentence
  ("Ambil 13 Carton 550070614 dari CB34D02, sisa 23 Carton ke CB18A02.").
- **`Berbeda`** — the line editor:
  - `Qty` per source, at most the order line in total.
  - Source: the SKU's stock rows (bin, batch, expiry, qty), FEFO first, the planned one marked;
    or scan the bin's location label / type the bin code. `+ bin lain` adds a second source; `×` removes it.
  - Bin To Bin: `Sisa` quantity (prefilled with what the bin will really have left,
    `leftoverAfter`) and destination bin (prefilled with the plan; scan its label or type it). Clearing it = the rest
    stays in the bin.
  - Reason chips (`bin kosong / kurang`, `palet terhalang`, `karton rusak`, `lain`).
  - The notes `sheetNotes` gives for this line (yellow / red), and the summary sentence.
  - `Posting`.
- After posting: `Cek sisa bin` when it applies (existing `BinLeftCheck`), then the next open line
  scrolls into view.

**Card (posted line)** — green, what was posted, `Diposting oleh Ani 14:05`, and `Ubah` (opens the
editor prefilled with what was posted; re-posts through the same function). A line posted by
another name shows `Ubah` disabled with "minta supervisor".

**Errors** — shown on the card in Indonesian, from the database message; the card stays editable.
A correction above the limit says what the system holds and to call a supervisor.

**Completion** — when no line is open: `Selesaikan wave` (`complete_wave_by`), with confirmation.

**Progress** (top of the panel, always visible, updates after every posting):
- Wave: `18/25 baris` and needed vs picked per unit, with a bar per unit.
- Per shipment in the wave (a wave can hold two): the same, plus `lengkap` (green) or
  `kurang 6 Carton` (red) once none of its lines is open.
- `Per order` (folded list): per SKU of each shipment — needed (`outbound.quantity_requested`), planned on
  lines, picked (posted actual), and what is lacking. A lack the plan never covered (an allocation
  shortage: `NO_STOCK`, `BLOCKED_SHELF_LIFE`, `ALREADY_STAGED`) is shown apart with its reason, so
  nobody chases stock that is not there; a lack from short picks says which line came up short.
- `Per picker` (folded list): per typed name, the lines and quantity per unit they posted in this
  wave.
- On each card: `masih kurang N <unit>` for the order line when this card is its last open line and
  the line still falls short.

**Perlu ditangani** (supervisor view, existing panel on the Wave page) gets a group
`Minta supervisor`: per open request the wave, line, picker, time, what they posted (one sentence in
the item's unit), the reason, and two buttons — `Isi dari picklist` (opens that wave's sheet at that
line, prefilled with what the picker posted) and `Tutup` (name + note). On the picker's card a
refused line shows "dikirim ke supervisor" and stays open; the picker carries on with the next line.

**Live updates** — the panel works on the tasks it loaded; when the page refreshes (realtime) it
reloads posted/open state per line but never overwrites an editor that is open.

## 3. Pure logic — `lib/pick-line.ts`

So the screen and the tests share it:
- `waveProgress(tasks, outbound, shortfalls)` → wave / shipment / order-line / picker progress per
  unit, with the lack split into "not planned (reason)" and "short picked (line)".
- `lineFromTasks(pick, move)` → the editable line (sources, rest, destination) — built on
  `buildSheet` so the shape matches `Isi dari picklist`.
- `lineProblem(line, plannedQty)` → what must be fixed before `Posting` (empty source bin,
  quantity 0 / above the order, rest without destination, destination = source) or null.
- `lineSummary(line, unit)` → the confirmation sentence in the item's unit.
- `linePayload(line)` → the `p_row` for `post_pick_line`.

## 4. Testing

- `supabase/tests/39_pick_line.sql` (rolls back), PASS per row:
  as planned; fewer than planned; other bin; two sources; rest to another destination; rest kept in
  the bin; correction ≤ 20 posts with a count task; correction > 20 posts nothing and leaves stock
  unchanged; above the order quantity refused; missing name refused; re-post own line changes stock
  exactly once; re-post by another name refused; re-post of an audited line refused;
  `post_pick_line` works for an `operator`; `post_wave_sheet` still refuses an `operator`;
  every escalation kind writes one `pick_line_requests` row and posts nothing; input mistakes write
  none; the request drops out of `pick_line_requests_open` once the line is posted through
  `post_wave_sheet`; `close_pick_line_request` needs a name and a note.
- Tests 32, 35, 36, 37 (`Isi dari picklist`) stay green unchanged.
- `tests/pick-line.test.ts` — summary in Carton / Drum, validation, payload, progress (units never
  summed; a shortage vs a short pick; two shipments in one wave; per picker); added to the
  `npm test` chain.
- Browser run on the local stack at 390 px: a wave picked line by line with `Sesuai`, `Berbeda`
  (second source, rest elsewhere), `Ubah`, a refused correction, `Selesaikan wave`.

## Out of scope

Per-person accounts; changing the supervisor tools; picking without a plan (no wave); offline use.
