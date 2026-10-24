# Remainder replanned into a new wave (Tunda mid-run) — design

Date: 2026-10-24 · Branch: main · Status: draft awaiting builder check + owner approval

## Intent and why

When a wave is **mid-execution** and Tunda'd (rescheduled), re-running `Jalankan alokasi`
today does not hand the floor a new wave for the remaining work: the parked shipment's
demand lines are **deleted** from demand and the carried wave keeps its old open tasks
(`merge_into_carried_wave` only merges *new* items). The owner asked for the opposite:

> Re-running allocation on a shipment whose wave already exists must produce **a new wave
> with fresh picklists for the remainder** — the old wave stays untouched as its own
> record. Automatic, inside the normal run (approach A), not an extra confirmation step.

Scope decided in conversation:

- **Tunda mid-run** (carried wave, `posted_tasks > 0`): remainder → new wave. This is the
  build's core.
- **Batal then retry**: already produces a `<NO> RESCHEDULE` wave via the earlier-waves
  flow (`earlier-waves.ts`, pinned by `tests/earlier-waves.test.ts`). No new machinery —
  only the regression tests this design adds must confirm it, and a floor-visible failure
  there is a separate bug report.
- **Untouched same-date drafts**: keep the existing replace behavior. Replacing is what
  prevents the same cartons being planned into two waves at once. Owner approved.

## Goals, non-goals, anti-goals

**Goals**

1. After `Simpan rencana` on a run that meets a Tunda'd mid-run shipment, the remaining
   work exists as a **new wave** on the run date, planned FEFO-fresh against current stock.
2. The old wave keeps its posted history and becomes inert (no selectable work); its
   printed picklists remain printable and replay correctly (Wave page unchanged).
3. The whole operation is **atomic in the save step**. A run that is never saved changes
   nothing on the database.
4. The page makes the transformation visible before saving: which shipments carry a
   Tunda'd mid-run wave, how many open tasks/cartons, and what will be created.

**Non-goals**

- No change to `Cetak semua`, wave numbering conventions beyond what carry-over already
  does (`T<NO>`, `-2`, `-3`… on collision), slot handling, or the Wave page's own flows.
- Not generalizing to whole-day cancels or to untouched drafts — those keep today's
  replace semantics.

**Anti-goals (this change must not)**

- Plan the same demand into two live waves simultaneously (double reservation).
- Break any of the FEFO rules or the single `selectNextBin` ranking.
- Leave a reserve bin holding a loose partial (`0074`'s residue rule) — the retract path
  reuses the same settle logic as cancel, never a new one.

## Constraints inherited from the spec (docs/ALLOCATOR.md, AGENTS.md)

- Stock only changes through `movements`; `apply_movement` validates. Retraction of open
  tasks writes **no** movements beyond the settle ones `0074` already writes for a cancel.
- FEFO is absolute: the remainder wave must re-plan against the current bin state
  (`planning_stock`), not copy the old wave's rows.
- `Sisa` is computed by replaying in one fixed order: **NO waves by earliest slot, then
  NO; shipments by slot then number; picklist walking order**. Two waves holding the same
  shipment on one date are already representable (`shipment_loads` is unique per
  `(wave_id, shipment)`, `outbound` has no cross-wave uniqueness); the interleave order
  stays whatever the slot/NO order says — no special-casing.
- Plans roll forward; `save_plan` replaces only `replaceable_waves()` (PENDING + all
  tasks PLANNED). A carried wave is `PENDING` *with* open tasks → kept — the new-wave step
  must not hand it to `save_plan` as replaceable, ever.
- The replay (`picklist-sisa-replay.test.ts`): completed tasks are undone at actuals and
  replayed with actuals; CANCELLED tasks are excluded. A wave whose open tasks were
  retracted to CANCELLED and whose posted tasks remain replays **correctly** — this
  behavior class is already the one `0074`/`0075` settled for whole-wave cancels.

## Approaches considered

1. **Merge into the carried wave (today).** Rejected by owner: floor never sees a new
   wave; picklist batch sizes grow; old open tasks carry stale FEFO assumptions to the
   new date.
2. **Explicit one-click transform.** Shallower (only `0074` machinery + rerun), but adds a
   tap and a second thing to remember on the floor. Owner picked automation.
3. **Just un-block the demand filter.** Rejected outright: same cartons reserved into two
   waves at once.
4. **Chosen: automatic split inside the save (approach A),** described below.

## The chosen design

### Detection (client, run time)

`plan_context()` already returns every wave of the run date split into `replaceable`
(PENDING, all tasks `PLANNED`) and `kept` (worked on, paused, cancelled). Extend the
campaign that produces parked-shipment matches (`carry-over.ts` `matchParked`) so that a
demand line matching a **carried wave with posted work** yields not only the wave id but
its **open remainder**:

- remainder definition per shipment + SKU: the carried wave's open `PLANNED` task
  quantities for that shipment (planned − picked already lives in the planned quantity;
  posted picks already left in `movements` are not double counted, because their task rows
  are no longer open). Explicitly *not* re-derived from the workbook demand: the workbook
  line is a **full** order and posted work cannot be subtracted client-side without
  re-implementing the movement ledger.
- This remainder is fed to the engine as demand lines (`shipmentNumber`, `itemCode`,
  `quantity` = remainder, `orderRequired` from the workbook for traceability) alongside
  whatever genuinely-new demand exists today. The page labels these rows so the summary
  can say *sisa dari Tunda T5* rather than pretending they are ordinary demand.

### Save transformation (RPC, atomic)

A single RPC owned by the save step, invoked per `carry` shipment **before or inside**
`save_plan`'s wave replacement — sequencing fixed in review, breaking it up is a defect:

1. **Retract** that shipment's open tasks in the carried wave: status → `CANCELLED`,
   running the same settle logic `set_wave_status → CANCELLED` runs for a pick's posted
   pallet break (`0074`) — move `qty % UPP` onward (pickface below target, else nearest
   empty Level-A), blank reason parameterized by the RPC (`sisanya direncanakan ulang`).
   If a stranded residue (`0075` shape) is detected first, `settle_stranded_residue` runs
   before the retract. Register in `movements` only via the existing helpers; no new
   movement classes.
2. **The wave itself stays** `RESCHEDULED`→`PENDING`-per-carry semantics unchanged for any
   *other* shipments it holds; if its `shipment_numbers` now contains shipments with no
   live work and all tasks CANCELLED/COMPLETED, it stays as an inert record (cancel-time
   semantics today; nothing upgrades it).
3. **Insert the new remainder wave(s)** built by `buildPlan` from the remainder demand:
   ordinary `PENDING` waves of the run date, named through the existing engine numbering
   (fresh NO; on collision with a kept wave, engine currently **errors** — the naming
   collides must instead fall to the next free number *prefix+suffix* per
   `0036`'s `-2/-3` convention. Decide inside the design check: fresh numeric NO if free,
   else reuse the T-variant scheme).
4. All in one transaction; `save_plan`'s replaceable/kept/clash checks run against the
   state *after* (1). A failure rolls back to the pre-call state.

### UI (Alokasi page)

- Run summary lists every detected carried/W-blocked shipment with its wave and the
  planned remainder (tasks/cartons count) before any confirmation.
- The existing save confirmation sentence gains the remainder line: `...sisa 2 wave Tunda
  diteruskan sebagai wave baru (NO <baru>)...`
- No change to the alphabetical/slot logic of the shipment list, to nav, or to the Wave
  page.

## Design-check decisions (builder-settled calls, owner confirmed nothing here)

Settled against the code and repo invariants by the builder check; recorded so the plan
does not re-litigate them:

- **Remainder aggregation lives in SQL.** One RPC (extending the `parked_orders` plan
  context or a new aggregate) returns per `(wave_id, shipment_number, sku)`: open PLANNED
  qty and the traceability order numbers pulled from the wave's outbound rows. The client
  derives demand lines from this, never recomputing planned−picked in TypeScript — the
  database's view of what remains is the only truth.
- **Atomic save is one new RPC**, not extended `save_plan` and not client
  orchestration: it retracts the designated shipment's open tasks (running `0074` settle +
  `settle_stranded_residue` when `stranded_residue` flags it, before anything else), then
  performs `save_plan`'s replace/keep/clash logic internally, then inserts the remainder
  wave built from the payload. One transaction, one client call.
- **Partial split bypasses `carry_over_wave`/`merge_into_carried_wave`** (`0036`/`0037`
  move/rename a whole wave; this design splits one shipment out). New RPC work only;
  other shipments of the same carried wave stay parked on the old wave exactly as they
  were — untouched by a run that only re-plans one of them.
- **Wave-NO for the remainder wave:** fresh numeric NO if free on the run date; on clash
  with a kept wave, fall back to the `T<origNO>` (then `-2`, `-3`…) scheme so lexical
  order (`compareWaveNo`) stays the day's print order.
- **Summary before save** shows the client's planned NO for the remainder wave; the RPC's
  return is authoritative after save.

## Owner decisions

- **Remainder quantities: the sheet wins, minus what's done.** The remainder demand for a
  shipment = today's workbook line (full order) **minus the quantity already picked to
  staging** for that shipment+SKU (posted picks' actual quantities, in this or earlier
  waves). If the difference is zero or negative, the line drops out of the new plan
  entirely; the remainder is planned in full by the engine — the part of the order
  sitting at staging is not a shortage row, it simply stays delivered. Only if the
  remainder cannot be served from stock does the run report a genuine shortage with its
  usual reasons. Workbook edits made while the order sat Tunda'd therefore flow into the
  new wave automatically — no manual wave edit. This is consistent with the repo rule
  that the sheet is the demand source of truth.
- **Consequence for retraction:** because the new plan derives from sheet-minus-done, ALL
  of that shipment's open tasks in the carried wave are retracted (planned quantities no
  longer define anything); only its posted history stays.


## What is left to the builder

- Exact transactional shape (single RPC vs `save_plan` gained parameter) per review.
- Wave-no allocation for the new wave when the fresh number collides with a kept wave.
- Test fixtures: a carried wave with ≥2 shipments where only one ships this run.
- These regression tests are **required, not nice-to-have** (owner's own scenario):
  1. Tunda mid-run with some picks *and their Bin To Bin* posted → Batal→(per owner's
     actual flow, or direct retract) → same shipment next day → remainder planned fresh;
     the already-staged part shows as `ALREADY_STAGED` shortage, not a false stock-out or
     a duplicate move.
  2. The `0075` stranded-residue shape (posted bin-to-bin, pick never posted) settles
     before the remainder is planned (`settle_stranded_residue`), and the new plan reads
     the settled physical state.
  3. The old wave's picklists and Wave-page replay remain byte-true after the new wave
     exists (cancelled tasks excluded, posted tasks at actuals — pin via
     `picklist-sisa-replay` reuse on a fixture two-waves-one-shipment scenario).
  4. Two waves, one shipment, one day: `Sisa` lines agree under the fixed replay order
     (stress variant of `picklist-stress.test.ts`).

## Invariants this change stresses (review targets)

- FEFO absolute: remainder re-plans FEFO at save-time stock; the remainder wave may pick
  different bins than the old tasks planned. That is spec-correct, not drift.
- Reservation not locking: cancelled open tasks release their reservations automatically
  the moment `open_pick_tasks`/`planning_stock` no longer sees them (nothing explicit to
  release — must be proven, not assumed).
- `movements(task_id)` unique → posting remaider tasks is independent of history.
- `posted_pallet_move_seq` restore-safety (`0074`): the retract path must never resurrect
  a retracted pick as PLANNED after its pallet break posted.
- `shipment_loads` per-wave uniqueness unaffected.
- Print artifacts: Alokasi print, Wave reprint, Gudang 3D — untouched inputs, fixed order
  must hold across the two waves sharing a shipment.
