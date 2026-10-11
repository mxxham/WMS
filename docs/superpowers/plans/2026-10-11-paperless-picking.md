# Paperless Picking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A line-by-line picking screen on the Wave page that lets any operator post a pick line as it really happened (Qty, source bin/batch, a second source, the Bin To Bin rest and destination), with progress against the order, while large corrections and other people's lines go to a supervisor.

**Architecture:** One new database function `post_pick_line` posts one line through the same engine as `Isi dari picklist` (`post_wave_sheet`'s body moved into `post_wave_sheet_rows`), adds the picker limits, and records refusals that need a supervisor in `pick_line_requests`. Pure logic (validation, summary, payload, progress) lives in `lib/pick-line.ts`; the screen is `picking-panel.tsx` + `pick-line-card.tsx`; supervisors see open requests in `escalations-panel.tsx` and fix them in `Isi dari picklist` opened at that line.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript strict, Tailwind + shadcn/ui, Supabase PostgreSQL 16 (plpgsql, RLS), standalone `tsx` tests, `psql` SQL tests.

**Spec:** `docs/superpowers/specs/2026-10-11-paperless-picking-design.md`

## Global Constraints

- UI strings are Indonesian; code, comments and docs are English.
- Quantities are labelled `Qty` with the item's unit `uomLabel(lookupUom(sku) ?? uom)` (Carton, Drum, Pail, IBC, Fluidbag) — never "karton". Units are never summed together.
- Stock only changes through `movements`; nothing writes `inventory`.
- Never edit a migration that may have been pushed. All database changes go in the new `supabase/migrations/0067_pick_line.sql`.
- An empty batch is `''`, never NULL.
- `post_pick_line` limits apply to every caller whatever the role (the live site shares one admin session). "Own line" = `same_person(picked_by_name, p_by_name)`.
- Correction limit = `inventory_policy()->>'adjust_approval_qty'` (default 20).
- `Isi dari picklist` (`post_wave_sheet`) behaves exactly as before; tests 32, 35, 36, 37 stay green unchanged.
- The screen lists lines in `buildSheet(tasks)` order — the printed picklist order.
- Every action has a confirmation step with a summary sentence.
- Tests: standalone `tsx` files with inline `test()` helper, `node:assert` strict, exit non-zero on failure, added to the `npm test` chain. SQL tests print `PASS`/`FAIL` per row and roll back.
- Bin codes accept a scanned location label (labels encode the plain bin code) or typing.

## Review Focus

1. **Two pickers on the same line at once** — the second `Posting` must not post the line twice; expected: the second call is refused as a re-post by another name (or succeeds as a no-op re-post by the same name). Test: Task 2, "same line posted twice by two names: second is a request, stock taken once".
2. **A picker retrying a refused line many times** — must not flood `Perlu ditangani`; expected: one open request per line, updated. Test: Task 2, "a refused line retried keeps one open request".
3. **A pick quantity of 0 (nothing found)** — must post as a short pick and open a count, not be refused as invalid. Test: Task 2, "Qty 0 posts as a short pick with a count task"; Task 3 `lineProblem` accepts 0.
4. **Page refresh while an editor is open** — a realtime refresh must not wipe what the picker typed. Covered in Task 4 by keeping editor state per line key outside the task list and the browser check in Task 6 step 3.
5. **A line whose move was posted early by someone else** (pick open, move done) — the picker posting the pick must not undo the other person's move. Test: Task 2, "pick posted after its move was posted early keeps the move".

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/0067_pick_line.sql` (create) | engine extraction, `app.sheet_engine` flag in `split_task`/`unpost_task`, `pick_task_detail.picked_by_name`, `pick_line_requests` + view + close, `post_pick_line` |
| `supabase/tests/39_pick_line.sql` (create) | database behaviour of `post_pick_line` and requests |
| `lib/wave-sheet.ts` (modify) | export `sheetRow(line)` used by `sheetPayload` and `linePayload` |
| `lib/allocator/picklist-from-tasks.ts` (modify) | `TaskRow.picked_by_name?` |
| `lib/pick-line.ts` (create) | `unitOf`, `lineProblem`, `lineSummary`, `linePayload`, `waveProgress` |
| `tests/pick-line.test.ts` (create) | pure logic tests |
| `components/app/bin-scan-input.tsx` (create) | bin code field: scanner types it, phone camera reads the location label, or typed |
| `app/(app)/waves/pick-line-card.tsx` (create) | one line: show, `Sesuai`, `Berbeda` editor, post, `Ubah` |
| `app/(app)/waves/picking-panel.tsx` (create) | the wave's cards, progress, `Tutup wave` |
| `app/(app)/waves/escalations-panel.tsx` (create) | `Minta supervisor` list with `Isi dari picklist` / `Tutup` |
| `app/(app)/waves/wave-sheet.tsx` (modify) | optional `prefill` for one line |
| `app/(app)/waves/waves-client.tsx` (modify) | `Mulai picking` button, panel, escalation → sheet |
| `app/(app)/waves/page.tsx` (modify) | load `pick_line_requests_open` |
| `README.md` (modify) | 0067 entry, test 39 |

---

### Task 1: Shared engine and picker name on the task view

**Files:**
- Create: `supabase/migrations/0067_pick_line.sql`
- Test: `supabase/tests/32_post_wave_sheet.sql`, `35`, `36`, `37` (existing, unchanged)

**Interfaces:**
- Produces: `public.post_wave_sheet_rows(p_wave_id uuid, p_rows jsonb, p_by_name text, p_reason text) returns jsonb` (no role check, revoked from clients; sets `app.sheet_engine` = `on` for its transaction while it runs). `post_wave_sheet` = role check + call. `split_task` and `unpost_task` accept the call when `current_setting('app.sheet_engine', true) = 'on'`. `pick_task_detail` gains a last column `picked_by_name`.

- [ ] **Step 1: Generate the migration's first part from the existing bodies**

Run (from the repo root):

```bash
python3 - <<'EOF'
import re
src62 = open('supabase/migrations/0062_sheet_pallet_first.sql').read()
src34 = open('supabase/migrations/0034_unpost_and_order_qty.sql').read()
src46 = open('supabase/migrations/0046_split_task.sql').read()

def block(src, name):
    i = src.index(f'create or replace function public.{name}(')
    j = src.index('end $$;', i) + len('end $$;')
    return src[i:j]

sheet = block(src62, 'post_wave_sheet')
role62 = """  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa posting dari picklist';
  end if;
"""
assert sheet.count(role62) == 1
rows = sheet.replace('create or replace function public.post_wave_sheet(', 'create or replace function public.post_wave_sheet_rows(', 1)
rows = rows.replace(role62, """  -- 0067: split_task / unpost_task accept the engine's own calls (post_wave_sheet, post_pick_line).
  perform set_config('app.sheet_engine', 'on', true);
""")
assert rows.count("  return jsonb_build_object('rows', n_rows, 'auto', v_out);\n") == 1
rows = rows.replace("  return jsonb_build_object('rows', n_rows, 'auto', v_out);\n",
                    "  perform set_config('app.sheet_engine', '', true);\n  return jsonb_build_object('rows', n_rows, 'auto', v_out);\n")

unpost = block(src34, 'unpost_task')
role34 = "  if not public.has_role(array['supervisor','admin']::public.user_role[]) then\n    raise exception 'Hanya supervisor atau admin yang bisa membatalkan posting';"
assert unpost.count(role34) == 1
unpost = unpost.replace(role34, "  if not public.has_role(array['supervisor','admin']::public.user_role[])\n     and coalesce(current_setting('app.sheet_engine', true), '') <> 'on' then\n    raise exception 'Hanya supervisor atau admin yang bisa membatalkan posting';")

split = block(src46, 'split_task')
role46 = "  if not public.has_role(array['supervisor','admin']::public.user_role[]) then\n    raise exception 'Hanya supervisor atau admin yang bisa memecah tugas';"
assert split.count(role46) == 1
split = split.replace(role46, "  if not public.has_role(array['supervisor','admin']::public.user_role[])\n     and coalesce(current_setting('app.sheet_engine', true), '') <> 'on' then\n    raise exception 'Hanya supervisor atau admin yang bisa memecah tugas';")

out = """-- =====================================================================
-- 0067  Paperless picking: post one line as it happened, from the phone
--
--  Pickers worked from a printed picklist that a supervisor then typed in
--  with Isi dari picklist (0057). post_pick_line posts one line at the bin
--  through the same engine, for any role, with the picker's limits:
--  a name, at most the order line, a Koreksi picklist only up to
--  adjust_approval_qty, a re-post only of one's own line while the wave runs
--  and the line is neither audited nor loaded. What needs a supervisor is
--  recorded in pick_line_requests (Perlu ditangani · Minta supervisor).
--
--  · post_wave_sheet's body is post_wave_sheet_rows (no role check, not
--    callable by clients); post_wave_sheet = supervisor check + call.
--  · split_task / unpost_task also accept the engine's own calls
--    (app.sheet_engine, set only inside post_wave_sheet_rows), so an
--    operator's two-bin line or own re-post works.
--  · pick_task_detail shows picked_by_name (the typed name of the posting).
-- =====================================================================

""" + rows + """
revoke execute on function public.post_wave_sheet_rows(uuid, jsonb, text, text) from public, anon, authenticated;

create or replace function public.post_wave_sheet(p_wave_id uuid, p_rows jsonb, p_by_name text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa posting dari picklist';
  end if;
  return public.post_wave_sheet_rows(p_wave_id, p_rows, p_by_name, p_reason);
end $$;

""" + unpost + "\n\n" + split + """

-- The typed name of the posting, for the picking screen (own line) and Perlu ditangani.
create or replace view public.pick_task_detail with (security_invoker = true) as
select t.id, t.wave_id, w.wave_no, w.planned_date, w.planned_slot, w.status as wave_status,
       t.shipment_number, t.task_type, t.seq, t.status,
       it.sku, it.description, it.uom, it.upp,
       fb.bin_code as from_bin, tb.bin_code as to_bin,
       t.batch_lot, t.expiry_date, t.quantity, t.pick_type, t.breaks_pallet,
       t.completed_at, p.name as completed_by_name,
       t.actual_quantity, ab.bin_code as actual_from_bin, t.actual_batch_lot, t.actual_expiry_date,
       t.deviation_reason, t.picked_by_name
from public.pick_tasks t
join public.waves w on w.id = t.wave_id
join public.items it on it.id = t.item_id
join public.bins fb on fb.id = t.from_bin_id
left join public.bins tb on tb.id = t.to_bin_id
left join public.profiles p on p.id = t.completed_by
left join public.bins ab on ab.id = t.actual_from_bin_id;
"""
open('supabase/migrations/0067_pick_line.sql', 'w').write(out)
print('written', len(out))
EOF
```

Expected: `written <n>` and no assertion error.

- [ ] **Step 2: Check `pick_task_detail` was last defined in 0007 (so the column list above is current)**

Run: `grep -l "view public.pick_task_detail" supabase/migrations/*.sql`
Expected: only `supabase/migrations/0007_rolling_execution.sql` (and now 0067). If another file appears, copy its column list into the view above and append `t.picked_by_name` last.

- [ ] **Step 3: Run the existing sheet tests against a fresh build**

Run: `PGUSER=postgres scripts/sql-test.sh supabase/tests/32_post_wave_sheet.sql supabase/tests/35_sheet_real_batch.sql supabase/tests/36_sheet_pallet_first.sql supabase/tests/37_follow_the_pallet.sql supabase/tests/26_edit_pick_row.sql supabase/tests/20_split_task.sql supabase/tests/27_unpost_pick_keep_move.sql`
Expected: every file `N PASS, 0 FAIL` (32: 16, 35: 8, 36: 8, 37: 10).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0067_pick_line.sql
git commit -m "feat(waves): shared Isi dari picklist engine for one-line posting (0067)"
```

---

### Task 2: `post_pick_line`, `pick_line_requests`

**Files:**
- Modify: `supabase/migrations/0067_pick_line.sql` (append)
- Create: `supabase/tests/39_pick_line.sql`

**Interfaces:**
- Consumes: `post_wave_sheet_rows` (Task 1).
- Produces:
  - `public.post_pick_line(p_wave_id uuid, p_row jsonb, p_by_name text, p_reason text, p_scanned text default null) returns jsonb` — `p_row` = `{pick_id, move_id, sources:[{bin,batch,expiry,qty}], move_to, move_qty}`. Returns `{result:'posted', posted_by, corrections, auto, rows}` or `{result:'refused', kind, message, request_id}`. Input mistakes raise.
  - table `public.pick_line_requests(id, wave_id, pick_id, move_id, row, by_name, kind, message, task_post_no, task_was_done, created_at, status, closed_by_name, closed_at, close_note)`.
  - view `public.pick_line_requests_open` (+ `wave_no, planned_date, seq, sku, description, uom, from_bin, shipment_number`).
  - `public.close_pick_line_request(p_id uuid, p_by_name text, p_note text) returns void`.

- [ ] **Step 1: Write the failing SQL test**

Create `supabase/tests/39_pick_line.sql`:

```sql
-- Paperless picking: post_pick_line and Minta supervisor (0067). Runs in a transaction and rolls back.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users values ('11111111-1111-1111-1111-111111111111','sup@x','{"name":"Supervisor"}') on conflict do nothing;
insert into auth.users values ('22222222-2222-2222-2222-222222222222','op@x','{"name":"Operator"}') on conflict do nothing;
update profiles set role = 'admin' where id = '11111111-1111-1111-1111-111111111111';
update profiles set role = 'operator' where id = '22222222-2222-2222-2222-222222222222';
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.qty(p_bin text, p_sku text) returns numeric language sql as $$
  select coalesce(sum(v.quantity), 0) from inventory v join bins b on b.id = v.bin_id join items i on i.id = v.item_id
  where b.bin_code = p_bin and i.sku = p_sku $$;
create or replace function pg_temp.t(p_seq int) returns uuid language sql as $$
  select t.id from pick_tasks t join waves w on w.id = t.wave_id where w.planned_date = '2026-11-02' and w.wave_no = '1' and t.seq = p_seq $$;
create or replace function pg_temp.wave() returns uuid language sql as $$
  select id from waves where planned_date = '2026-11-02' and wave_no = '1' $$;
create or replace function pg_temp.row(p_pick uuid, p_move uuid, p_sources text, p_to text, p_mq numeric) returns jsonb language sql as $$
  select jsonb_build_object('pick_id', p_pick, 'move_id', p_move, 'sources', p_sources::jsonb, 'move_to', p_to, 'move_qty', p_mq) $$;
create or replace function pg_temp.requests() returns bigint language sql as $$ select count(*) from pick_line_requests $$;
delete from inventory v using bins b where b.id = v.bin_id
  and b.bin_code in ('CB18A02','CB18A01','CB34D02','CB33E02','CB33E01','CD13A01','CE01A01','CE01A02');
grant execute on function pg_temp.check(text, boolean), pg_temp.qty(text, text), pg_temp.t(int), pg_temp.wave(),
  pg_temp.row(uuid, uuid, text, text, numeric), pg_temp.requests() to authenticated;

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select import_snapshot('[
 {"bin_code":"CB18A02","zone":"CB","rack":"18","level":"A","position":"02","sku":"550070614","batch_lot":"P20","quantity":16,"expiry_date":"2030-08-20"},
 {"bin_code":"CB34D02","zone":"CB","rack":"34","level":"D","position":"02","sku":"550070614","batch_lot":"P11","quantity":36,"expiry_date":"2030-09-11"},
 {"bin_code":"CB33E02","zone":"CB","rack":"33","level":"E","position":"02","sku":"550070614","batch_lot":"P11","quantity":36,"expiry_date":"2030-09-11"},
 {"bin_code":"CB33E01","zone":"CB","rack":"33","level":"E","position":"01","sku":"550070614","batch_lot":"P11","quantity":36,"expiry_date":"2030-09-11"},
 {"bin_code":"CD13A01","zone":"CD","rack":"13","level":"A","position":"01","sku":"550048593","batch_lot":"Q13","quantity":5,"expiry_date":"2030-08-13"},
 {"bin_code":"CE01A01","zone":"CE","rack":"01","level":"A","position":"01","sku":"550062460","batch_lot":"R1","quantity":10,"expiry_date":"2030-09-01"},
 {"bin_code":"CE01A02","zone":"CE","rack":"01","level":"A","position":"02","sku":"550062460","batch_lot":"R1","quantity":10,"expiry_date":"2030-09-01"}]'::jsonb, false, 'uji') \g /dev/null
select save_plan('2026-11-02', '{
  "waves":[{"wave_no":"1","shipment_numbers":["SH1"],"planned_slot":"08:00"}],
  "tasks":[
   {"wave_no":"1","shipment_number":"SH1","task_type":"PICK","sku":"550070614","from_bin":"CB18A02","batch_lot":"P20","expiry_date":"2030-08-20","quantity":16,"pick_type":"CASE","seq":1},
   {"wave_no":"1","shipment_number":"SH1","task_type":"PICK","sku":"550070614","from_bin":"CB34D02","batch_lot":"P11","expiry_date":"2030-09-11","quantity":13,"pick_type":"CASE","breaks_pallet":true,"seq":2},
   {"wave_no":"1","task_type":"REPLENISH","sku":"550070614","from_bin":"CB34D02","to_bin":"CB18A02","batch_lot":"P11","expiry_date":"2030-09-11","quantity":23,"pick_type":"CASE","breaks_pallet":true,"seq":3},
   {"wave_no":"1","shipment_number":"SH1","task_type":"PICK","sku":"550070614","from_bin":"CB33E02","batch_lot":"P11","expiry_date":"2030-09-11","quantity":10,"pick_type":"CASE","seq":4},
   {"wave_no":"1","shipment_number":"SH1","task_type":"PICK","sku":"550048593","from_bin":"CD13A01","batch_lot":"Q13","expiry_date":"2030-08-13","quantity":8,"pick_type":"CASE","seq":5},
   {"wave_no":"1","shipment_number":"SH1","task_type":"PICK","sku":"550062460","from_bin":"CE01A01","batch_lot":"R1","expiry_date":"2030-09-01","quantity":40,"pick_type":"CASE","seq":6},
   {"wave_no":"1","shipment_number":"SH1","task_type":"PICK","sku":"550062460","from_bin":"CE01A02","batch_lot":"R1","expiry_date":"2030-09-01","quantity":10,"pick_type":"CASE","seq":7},
   {"wave_no":"1","shipment_number":"SH1","task_type":"PICK","sku":"550070614","from_bin":"CB33E01","batch_lot":"P11","expiry_date":"2030-09-11","quantity":5,"pick_type":"CASE","seq":8}]}'::jsonb) \g /dev/null
-- Ids before posting: splits renumber the tasks.
create temp table ids as select pg_temp.t(1) p1, pg_temp.t(2) p2, pg_temp.t(3) m3, pg_temp.t(4) p4, pg_temp.t(5) p5, pg_temp.t(6) p6, pg_temp.t(7) p7, pg_temp.t(8) p8;

-- From here on: the operator.
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

do $$ begin
  perform post_wave_sheet(pg_temp.wave(), '[]'::jsonb, 'Ani', 'x');
  raise notice 'FAIL an operator still cannot use Isi dari picklist';
exception when others then raise notice 'PASS an operator still cannot use Isi dari picklist'; end $$;

do $$ begin
  perform post_pick_line(pg_temp.wave(), pg_temp.row((select p1 from ids), null, '[{"bin":"CB18A02","batch":"P20","expiry":"2030-08-20","qty":16}]', null, null), ' ', 'sesuai');
  raise notice 'FAIL a line without a name is refused';
exception when others then raise notice 'PASS a line without a name is refused'; end $$;

create temp table r1 as select post_pick_line(pg_temp.wave(), pg_temp.row((select p1 from ids), null,
  '[{"bin":"CB18A02","batch":"P20","expiry":"2030-08-20","qty":16}]', null, null), 'Ani', 'sesuai') as r;
select pg_temp.check('as planned: posted by an operator, CB18A02 16 -> 0, picked_by_name Ani',
  (select r->>'result' = 'posted' from r1) and pg_temp.qty('CB18A02', '550070614') = 0
  and (select picked_by_name from pick_tasks where id = (select p1 from ids)) = 'Ani');

create temp table r2 as select post_pick_line(pg_temp.wave(), pg_temp.row((select p2 from ids), (select m3 from ids),
  '[{"bin":"CB34D02","batch":"P11","expiry":"2030-09-11","qty":13}]', 'CB18A01', 23), 'Ani', 'pickface penuh') as r;
select pg_temp.check('pallet: 13 picked, the rest 23 to CB18A01 instead of CB18A02',
  (select r->>'result' = 'posted' from r2) and pg_temp.qty('CB34D02', '550070614') = 0
  and pg_temp.qty('CB18A01', '550070614') = 23 and pg_temp.qty('CB18A02', '550070614') = 0);

create temp table r4 as select post_pick_line(pg_temp.wave(), pg_temp.row((select p4 from ids), null,
  '[{"bin":"CB33E02","batch":"P11","expiry":"2030-09-11","qty":6},{"bin":"CB33E01","batch":"P11","expiry":"2030-09-11","qty":4}]', null, null), 'Ani', 'palet terhalang') as r;
select pg_temp.check('two sources: 6 from CB33E02 + 4 from CB33E01 (split_task inside works for an operator)',
  (select r->>'result' = 'posted' from r4) and pg_temp.qty('CB33E02', '550070614') = 30 and pg_temp.qty('CB33E01', '550070614') = 32);

create temp table r5 as select post_pick_line(pg_temp.wave(), pg_temp.row((select p5 from ids), null,
  '[{"bin":"CD13A01","batch":"Q13","expiry":"2030-08-13","qty":8}]', null, null), 'Ani', 'sesuai') as r;
select pg_temp.check('correction of 3 (<= 20): posted, CD13A01 5 + 3 - 8 = 0, a count task opens',
  (select r->>'result' = 'posted' and (r->>'corrections')::int = 1 from r5) and pg_temp.qty('CD13A01', '550048593') = 0
  and exists (select 1 from count_tasks c join bins b on b.id = c.bin_id where b.bin_code = 'CD13A01' and c.status = 'OPEN'));

create temp table r6 as select post_pick_line(pg_temp.wave(), pg_temp.row((select p6 from ids), null,
  '[{"bin":"CE01A01","batch":"R1","expiry":"2030-09-01","qty":40}]', null, null), 'Ani', 'sesuai') as r;
select pg_temp.check('correction of 30 (> 20): refused, nothing posted, stock untouched, no FOUND booked',
  (select r->>'result' = 'refused' and r->>'kind' = 'correction_over_limit' and r->>'message' like '%minta supervisor%' from r6)
  and pg_temp.qty('CE01A01', '550062460') = 10
  and (select status from pick_tasks where id = (select p6 from ids)) = 'PLANNED'
  and not exists (select 1 from movements m join bins b on b.id = m.to_bin_id where b.bin_code = 'CE01A01' and m.reason_code = 'FOUND'));
select pg_temp.check('the refused line is a request for a supervisor, listed open',
  exists (select 1 from pick_line_requests_open where pick_id = (select p6 from ids) and kind = 'correction_over_limit' and by_name = 'Ani'));

select post_pick_line(pg_temp.wave(), pg_temp.row((select p6 from ids), null,
  '[{"bin":"CE01A01","batch":"R1","expiry":"2030-09-01","qty":40}]', null, null), 'Ani', 'sesuai') \g /dev/null
select pg_temp.check('a refused line retried keeps one open request',
  (select count(*) from pick_line_requests where pick_id = (select p6 from ids) and status = 'OPEN') = 1);

do $$ begin
  perform post_pick_line(pg_temp.wave(), pg_temp.row((select p7 from ids), null, '[{"bin":"CE01A02","batch":"R1","expiry":"2030-09-01","qty":11}]', null, null), 'Ani', 'x');
  raise notice 'FAIL more than the order line is refused';
exception when others then raise notice 'PASS more than the order line is refused'; end $$;
select pg_temp.check('input mistakes write no request', pg_temp.requests() = 1);

create temp table r7 as select post_pick_line(pg_temp.wave(), pg_temp.row((select p7 from ids), null,
  '[{"bin":"CE01A02","batch":"R1","expiry":"2030-09-01","qty":7}]', null, null), 'Ani', 'bin kosong / kurang') as r;
select pg_temp.check('fewer than planned: 7 of 10 posted',
  (select r->>'result' = 'posted' from r7) and pg_temp.qty('CE01A02', '550062460') = 3);

create temp table r7b as select post_pick_line(pg_temp.wave(), pg_temp.row((select p7 from ids), null,
  '[{"bin":"CE01A02","batch":"R1","expiry":"2030-09-01","qty":9}]', null, null), 'ani', 'salah ketik') as r;
select pg_temp.check('re-post own line (name case-insensitive): 9 instead of 7, stock taken once (10 - 9 = 1)',
  (select r->>'result' = 'posted' from r7b) and pg_temp.qty('CE01A02', '550062460') = 1);

create temp table r7c as select post_pick_line(pg_temp.wave(), pg_temp.row((select p7 from ids), null,
  '[{"bin":"CE01A02","batch":"R1","expiry":"2030-09-01","qty":10}]', null, null), 'Budi', 'x') as r;
select pg_temp.check('same line posted twice by two names: second is a request, stock taken once',
  (select r->>'result' = 'refused' and r->>'kind' = 'other_picker' and r->>'message' like '%ani%' from r7c)
  and pg_temp.qty('CE01A02', '550062460') = 1);

create temp table r8 as select post_pick_line(pg_temp.wave(), pg_temp.row((select p8 from ids), null,
  '[{"bin":"CB33E01","batch":"P11","expiry":"2030-09-11","qty":0}]', null, null), 'Ani', 'bin kosong / kurang') as r;
select pg_temp.check('Qty 0 posts as a short pick with a count task, not an input mistake',
  (select r->>'result' = 'posted' from r8) and (select status from pick_tasks where id = (select p8 from ids)) = 'COMPLETED'
  and exists (select 1 from count_tasks c join bins b on b.id = c.bin_id where b.bin_code = 'CB33E01' and c.status = 'OPEN'));

-- A checker audits line 1; the picker may no longer change it.
reset role;
insert into pick_audits (task_id, attempt_no, checker_name, found_sku, counted_qty, expected_sku, expected_qty, result)
values ((select p1 from ids), 1, 'Cek', '550070614', 16, '550070614', 16, 'OK');
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
create temp table r1b as select post_pick_line(pg_temp.wave(), pg_temp.row((select p1 from ids), null,
  '[{"bin":"CB18A02","batch":"P20","expiry":"2030-08-20","qty":15}]', null, null), 'Ani', 'x') as r;
select pg_temp.check('re-post of an audited line: request, nothing changes',
  (select r->>'result' = 'refused' and r->>'kind' = 'audited' from r1b)
  and (select actual_quantity from pick_tasks where id = (select p1 from ids)) = 16);

-- A Tunda wave belongs to a supervisor.
reset role;
update waves set status = 'RESCHEDULED' where id = pg_temp.wave();
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
create temp table rt as select post_pick_line(pg_temp.wave(), pg_temp.row((select p6 from ids), null,
  '[{"bin":"CE01A01","batch":"R1","expiry":"2030-09-01","qty":0}]', null, null), 'Ani', 'x') as r;
select pg_temp.check('a Tunda wave: request, nothing posted',
  (select r->>'result' = 'refused' and r->>'kind' = 'wave_not_pending' from rt)
  and (select status from pick_tasks where id = (select p6 from ids)) = 'PLANNED');
reset role;
update waves set status = 'PENDING' where id = pg_temp.wave();
set role authenticated;

-- The supervisor posts line 6 through Isi dari picklist: its requests drop off by themselves.
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select post_wave_sheet(pg_temp.wave(), jsonb_build_array(pg_temp.row((select p6 from ids), null,
  '[{"bin":"CE01A01","batch":"R1","expiry":"2030-09-01","qty":40}]', null, null)), 'Supervisor', 'dicek') \g /dev/null
select pg_temp.check('posted by the supervisor: the line''s requests leave the open list',
  not exists (select 1 from pick_line_requests_open where pick_id = (select p6 from ids)));

do $$ begin
  perform close_pick_line_request((select id from pick_line_requests where kind = 'other_picker' limit 1), 'Supervisor', ' ');
  raise notice 'FAIL closing a request needs a note';
exception when others then raise notice 'PASS closing a request needs a note'; end $$;
select close_pick_line_request((select id from pick_line_requests where kind = 'other_picker' limit 1), 'Supervisor', 'Ani benar, 9') \g /dev/null
select pg_temp.check('closed with name and note: off the open list',
  not exists (select 1 from pick_line_requests_open where kind = 'other_picker')
  and exists (select 1 from pick_line_requests where kind = 'other_picker' and status = 'CLOSED' and closed_by_name = 'Supervisor'));

-- Review focus: a pick posted after its move was posted early keeps that move.
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
reset role;
delete from inventory v using bins b where b.id = v.bin_id and b.bin_code in ('CC01A01','CC01A02');
set role authenticated;
select import_snapshot('[
 {"bin_code":"CC01A01","zone":"CC","rack":"01","level":"A","position":"01","sku":"550071397","batch_lot":"S1","quantity":36,"expiry_date":"2030-09-01"}]'::jsonb, false, 'uji') \g /dev/null
select save_plan('2026-11-03', '{
  "waves":[{"wave_no":"1","shipment_numbers":["SH2"],"planned_slot":"08:00"}],
  "tasks":[
   {"wave_no":"1","shipment_number":"SH2","task_type":"PICK","sku":"550071397","from_bin":"CC01A01","batch_lot":"S1","expiry_date":"2030-09-01","quantity":6,"pick_type":"CASE","breaks_pallet":true,"seq":1},
   {"wave_no":"1","task_type":"REPLENISH","sku":"550071397","from_bin":"CC01A01","to_bin":"CC01A02","batch_lot":"S1","expiry_date":"2030-09-01","quantity":30,"pick_type":"CASE","breaks_pallet":true,"seq":2}]}'::jsonb) \g /dev/null
create temp table ids2 as select
  (select t.id from pick_tasks t join waves w on w.id = t.wave_id where w.planned_date = '2026-11-03' and t.seq = 1) p,
  (select t.id from pick_tasks t join waves w on w.id = t.wave_id where w.planned_date = '2026-11-03' and t.seq = 2) m,
  (select id from waves where planned_date = '2026-11-03') w;
-- Budi posts the move first (Posting Bin To Bin saja), leaving 6 in the pallet for the pick.
select post_task((select m from ids2), 30, null, null, null, null) \g /dev/null
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
create temp table rm as select post_pick_line((select w from ids2), pg_temp.row((select p from ids2), (select m from ids2),
  '[{"bin":"CC01A01","batch":"S1","expiry":"2030-09-01","qty":6}]', 'CC01A02', 30), 'Ani', 'sesuai') as r;
select pg_temp.check('pick posted after its move was posted early keeps the move: CC01A02 30, CC01A01 0',
  (select r->>'result' from rm) in ('posted', 'refused') and pg_temp.qty('CC01A02', '550071397') = 30
  and pg_temp.qty('CC01A01', '550071397') = (case (select r->>'result' from rm) when 'posted' then 0 else 6 end));
rollback;
```

- [ ] **Step 2: Run it to see it fail**

Run: `PGUSER=postgres scripts/sql-test.sh supabase/tests/39_pick_line.sql`
Expected: `ERROR in supabase/tests/39_pick_line.sql` with `function post_pick_line(...) does not exist` (or `relation "pick_line_requests" does not exist`).

- [ ] **Step 3: Append the implementation to `0067_pick_line.sql`**

```sql

-- ---------------------------------------------------------------------
-- Minta supervisor: a picker's line that needs a supervisor (0067)
-- ---------------------------------------------------------------------
create table public.pick_line_requests (
  id             uuid primary key default gen_random_uuid(),
  wave_id        uuid not null references public.waves(id) on delete cascade,
  pick_id        uuid references public.pick_tasks(id) on delete cascade,
  move_id        uuid references public.pick_tasks(id) on delete cascade,
  row            jsonb not null,
  by_name        text not null,
  kind           text not null check (kind in ('correction_over_limit', 'other_picker', 'audited', 'loaded', 'wave_not_pending')),
  message        text not null,
  -- The line as it was when refused: it drops off the open list once posted (again) after that.
  task_post_no   int not null,
  task_was_done  boolean not null,
  created_at     timestamptz not null default now(),
  status         text not null default 'OPEN' check (status in ('OPEN', 'CLOSED')),
  closed_by_name text,
  closed_at      timestamptz,
  close_note     text
);
create index pick_line_requests_open_idx on public.pick_line_requests (wave_id, created_at) where status = 'OPEN';
alter table public.pick_line_requests enable row level security;
create policy "pick_line_requests: read" on public.pick_line_requests for select to authenticated using (true);
grant select on public.pick_line_requests to authenticated;

-- Open requests whose line has not been posted (again) since: a supervisor posting it makes it drop off.
-- Compared on the task's posting counter, not on time (one transaction has one now()).
create or replace view public.pick_line_requests_open with (security_invoker = true) as
select r.*, w.wave_no, w.planned_date, t.seq, t.shipment_number, it.sku, it.description, it.uom, fb.bin_code as from_bin
from public.pick_line_requests r
join public.waves w on w.id = r.wave_id
left join public.pick_tasks t on t.id = coalesce(r.pick_id, r.move_id)
left join public.items it on it.id = t.item_id
left join public.bins fb on fb.id = t.from_bin_id
where r.status = 'OPEN' and w.status <> 'CANCELLED'
  and not (t.status = 'COMPLETED' and (not r.task_was_done or t.post_no > r.task_post_no));
grant select on public.pick_line_requests_open to authenticated;

create or replace function public.close_pick_line_request(p_id uuid, p_by_name text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa menutup permintaan';
  end if;
  v_name := public.person_name(p_by_name, 'Nama Anda');
  if nullif(trim(p_note), '') is null then raise exception 'Catatan wajib diisi'; end if;
  update public.pick_line_requests set status = 'CLOSED', closed_by_name = v_name, closed_at = now(), close_note = trim(p_note)
  where id = p_id and status = 'OPEN';
  if not found then raise exception 'Permintaan tidak ada atau sudah ditutup'; end if;
end $$;
revoke execute on function public.close_pick_line_request(uuid, text, text) from public, anon;
grant execute on function public.close_pick_line_request(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- post_pick_line: one line from the picking screen, any role (0067)
-- ---------------------------------------------------------------------
create or replace function public.post_pick_line(p_wave_id uuid, p_row jsonb, p_by_name text, p_reason text, p_scanned text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text; w public.waves%rowtype; t public.pick_tasks%rowtype; m public.pick_tasks%rowtype;
  v_total numeric; v_sku text; v_ean text; v_scan_sku text; v_posted_by text;
  v_limit numeric := (public.inventory_policy()->>'adjust_approval_qty')::numeric;
  v_kind text; v_msg text; v_res jsonb; c jsonb; v_req uuid; v_corr int := 0;
begin
  if not public.has_role(array['operator','supervisor','admin']::public.user_role[]) then
    raise exception 'Masuk dulu untuk posting';
  end if;
  v_name := public.person_name(p_by_name, 'Nama picker');
  select * into w from public.waves where id = p_wave_id;
  if w.id is null then raise exception 'Wave tidak ditemukan'; end if;
  if nullif(p_row->>'pick_id', '') is not null then
    select * into t from public.pick_tasks where id = (p_row->>'pick_id')::uuid;
    if t.id is null or t.wave_id <> w.id or t.task_type <> 'PICK' then raise exception 'Baris ini bukan pick wave NO %', w.wave_no; end if;
  end if;
  if nullif(p_row->>'move_id', '') is not null then
    select * into m from public.pick_tasks where id = (p_row->>'move_id')::uuid;
    if m.id is null or m.wave_id <> w.id or m.task_type = 'PICK' then raise exception 'Bin To Bin ini bukan milik wave NO %', w.wave_no; end if;
  end if;
  if t.id is null and m.id is null then raise exception 'Baris tanpa tugas'; end if;

  -- Input the picker fixes on the card: never recorded.
  select coalesce(sum(coalesce((s->>'qty')::numeric, 0)), 0) into v_total
  from jsonb_array_elements(coalesce(p_row->'sources', '[]'::jsonb)) s;
  if t.id is not null and v_total > t.quantity then
    raise exception 'Lebih dari order: paling banyak % untuk baris ini', t.quantity;
  end if;
  if t.id is not null then
    select sku, ean into v_sku, v_ean from public.items where id = t.item_id;
    if nullif(trim(p_scanned), '') is not null then
      select sku into v_scan_sku from public.item_by_barcode(p_scanned) limit 1;
      if v_scan_sku is null then raise exception 'Barcode % tidak dikenal di master item', trim(p_scanned); end if;
      if v_scan_sku <> v_sku then raise exception 'Barang salah: yang di-scan SKU %, baris ini SKU %', v_scan_sku, v_sku; end if;
    elsif t.status = 'PLANNED' and v_ean is not null and coalesce((public.inventory_policy()->>'require_scan_on_pick')::boolean, false) then
      raise exception 'Scan barcode SKU % dulu (atau ketik SKU-nya)', v_sku;
    end if;
  end if;

  -- What only a supervisor may do: recorded, nothing posted.
  if w.status <> 'PENDING' then
    v_kind := 'wave_not_pending';
    v_msg := format('Wave NO %s sedang %s: minta supervisor', w.wave_no,
                    case w.status when 'RESCHEDULED' then 'Tunda' when 'COMPLETED' then 'selesai' else 'dibatalkan' end);
  elsif t.status = 'COMPLETED' or (t.id is null and m.status = 'COMPLETED') then
    v_posted_by := coalesce(t.picked_by_name, m.picked_by_name);
    if not public.same_person(v_posted_by, v_name) then
      v_kind := 'other_picker';
      v_msg := format('Baris ini diposting oleh %s: minta supervisor', coalesce(v_posted_by, 'orang lain'));
    elsif t.id is not null and exists (select 1 from public.pick_audits where task_id = t.id) then
      v_kind := 'audited';
      v_msg := 'Baris ini sudah diaudit picking: minta supervisor';
    elsif t.id is not null and exists (select 1 from public.shipment_loads where wave_id = t.wave_id and shipment_number = t.shipment_number) then
      v_kind := 'loaded';
      v_msg := format('Shipment %s sudah dimuat: minta supervisor', t.shipment_number);
    end if;
  end if;

  if v_kind is null then
    begin
      v_res := public.post_wave_sheet_rows(p_wave_id, jsonb_build_array(p_row), v_name,
                                           coalesce(nullif(trim(p_reason), ''), 'picking'));
      for c in select e from jsonb_array_elements(coalesce(v_res->'auto', '[]'::jsonb)) e where e->>'kind' = 'correction' loop
        v_corr := v_corr + 1;
        if (c->>'qty')::numeric > v_limit then
          v_kind := 'correction_over_limit';
          v_msg := format('Sistem hanya punya %s di %s untuk SKU %s batch %s, diambil %s: minta supervisor',
                          c->>'had', c->>'bin', c->>'sku', coalesce(nullif(c->>'batch', ''), '–'),
                          (c->>'had')::numeric + (c->>'qty')::numeric);
          raise exception using errcode = 'PL001', message = v_msg;
        end if;
      end loop;
    exception when sqlstate 'PL001' then
      v_res := null;  -- the savepoint rolled the whole line back; v_kind / v_msg stay set
    end;
  end if;

  if v_kind is not null then
    -- One open request per line: a retry updates it.
    update public.pick_line_requests set row = p_row, by_name = v_name, kind = v_kind, message = v_msg, created_at = now(),
      task_post_no = coalesce(t.post_no, m.post_no), task_was_done = coalesce(t.status, m.status) = 'COMPLETED'
    where status = 'OPEN' and pick_id is not distinct from t.id and move_id is not distinct from m.id
    returning id into v_req;
    if v_req is null then
      insert into public.pick_line_requests (wave_id, pick_id, move_id, row, by_name, kind, message, task_post_no, task_was_done)
      values (w.id, t.id, m.id, p_row, v_name, v_kind, v_msg, coalesce(t.post_no, m.post_no), coalesce(t.status, m.status) = 'COMPLETED')
      returning id into v_req;
    end if;
    return jsonb_build_object('result', 'refused', 'kind', v_kind, 'message', v_msg, 'request_id', v_req);
  end if;

  return jsonb_build_object('result', 'posted', 'posted_by', v_name, 'corrections', v_corr,
                            'auto', v_res->'auto', 'rows', v_res->'rows');
end $$;
revoke execute on function public.post_pick_line(uuid, jsonb, text, text, text) from public, anon;
grant execute on function public.post_pick_line(uuid, jsonb, text, text, text) to authenticated;
```

- [ ] **Step 4: Run test 39 and the sheet tests**

Run: `PGUSER=postgres scripts/sql-test.sh supabase/tests/39_pick_line.sql supabase/tests/32_post_wave_sheet.sql supabase/tests/36_sheet_pallet_first.sql`
Expected: `39_pick_line.sql: 21 PASS, 0 FAIL` (17 checks + 4 refusals), 32 and 36 unchanged and all PASS. If "pick posted after its move was posted early" fails, read the `rm` result: `post_wave_sheet_rows` must not undo a COMPLETED move that matches the row (its step 1 compares and keeps it).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0067_pick_line.sql supabase/tests/39_pick_line.sql
git commit -m "feat(waves): post_pick_line and Minta supervisor requests (0067, test 39)"
```

---

### Task 3: Pure logic — `lib/pick-line.ts`

**Files:**
- Modify: `lib/wave-sheet.ts` (export `sheetRow`)
- Modify: `lib/allocator/picklist-from-tasks.ts` (`TaskRow.picked_by_name?`)
- Create: `lib/pick-line.ts`
- Create: `tests/pick-line.test.ts`
- Modify: `package.json` (`npm test` chain)

**Interfaces:**
- Consumes: `SheetLine`, `buildSheet` from `lib/wave-sheet.ts`; `uomLabel` from `lib/allocator/picklist.ts`; `lookupUom` from `lib/allocator/uom-master.ts`.
- Produces:
  - `sheetRow(l: SheetLine): SheetRow` and `type SheetRow = { pick_id: string | null; move_id: string | null; sources: { bin: string; batch: string; expiry: string | null; qty: number }[]; move_to: string | null; move_qty: number | null }` (in `lib/wave-sheet.ts`)
  - `unitOf(sku: string, uom: string | null): string`
  - `lineProblem(l: SheetLine, bins: Set<string> | null): string | null`
  - `lineSummary(l: SheetLine, unit: string): string`
  - `linePayload(l: SheetLine): SheetRow`
  - `type OrderLine = { shipment_number: string; sku: string; description?: string | null; quantity_requested: number; shortage_reason?: string | null }`
  - `type UnitQty = Record<string, { needed: number; picked: number }>`
  - `waveProgress(tasks: TaskRow[], orders: OrderLine[]): WaveProgress` with `WaveProgress = { lines: { done: number; total: number }; units: UnitQty; shipments: ShipmentProgress[]; orders: OrderProgress[]; pickers: PickerProgress[] }`, `ShipmentProgress = { shipment: string; units: UnitQty; open: number; lack: Record<string, number> }`, `OrderProgress = { shipment: string; sku: string; description: string; unit: string; needed: number; planned: number; picked: number; lackUnplanned: number; shortageReason: string | null; lackShort: number; shortSeqs: number[]; openLines: number }`, `PickerProgress = { name: string; lines: number; units: Record<string, number> }`

- [ ] **Step 1: Write the failing test**

Create `tests/pick-line.test.ts`:

```ts
/** Paperless picking: one line's validation, sentence and payload, and the wave's progress (database side: supabase/tests/39_pick_line.sql). */
import { strict as assert } from 'node:assert';
import { buildSheet } from '../lib/wave-sheet';
import { lineProblem, linePayload, lineSummary, unitOf, waveProgress, type OrderLine } from '../lib/pick-line';
import type { TaskRow } from '../lib/allocator/picklist-from-tasks';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
console.log('\nPaperless picking');

const base: TaskRow = {
  id: '', wave_id: 'w1', wave_no: '5', planned_slot: '08:00', shipment_number: '109711290', task_type: 'PICK', seq: 1,
  status: 'PLANNED', sku: '550070614', description: 'HlxHX610W40SP_4*4L_A04W', uom: 'CAR', upp: 36, from_bin: 'CB34D02', to_bin: null,
  batch_lot: '11I26JJ', expiry_date: '2030-09-11', quantity: 13, pick_type: 'CASE', breaks_pallet: true, completed_at: null,
  completed_by_name: null, actual_quantity: null, actual_from_bin: null, actual_batch_lot: null, actual_expiry_date: null, deviation_reason: null,
};
const pick = { ...base, id: 'p2', seq: 2 };
const move: TaskRow = { ...base, id: 'm3', seq: 3, task_type: 'REPLENISH', shipment_number: null, to_bin: 'CB18A02', quantity: 23 };
const drum: TaskRow = { ...base, id: 'p9', seq: 9, sku: '550044360', description: 'RimR4X15W40CI4E7DH1_1*209L_A227', uom: 'Drum', from_bin: 'CF17B02', batch_lot: '12704140', quantity: 4, pick_type: 'PALLET', breaks_pallet: false };
const line = () => buildSheet([pick, move]).lines[0];
const BINS = new Set(['CB34D02', 'CB18A02', 'CB18A01', 'CB33E02', 'CF17B02']);

test('unit comes from the item master: Carton, Drum, never "karton"', () => {
  assert.equal(unitOf('550070614', 'CAR'), 'Carton');
  assert.equal(unitOf('550044360', null), 'Drum');
});

test('as planned: no problem, sentence names pick and rest in the unit', () => {
  const l = line();
  assert.equal(lineProblem(l, BINS), null);
  assert.equal(lineSummary(l, 'Carton'), 'Ambil 13 Carton 550070614 dari CB34D02, sisa 23 Carton ke CB18A02.');
});

test('a drum line says Drum', () => {
  const l = buildSheet([drum]).lines[0];
  assert.equal(lineSummary(l, unitOf(drum.sku, drum.uom)), 'Ambil 4 Drum 550044360 dari CF17B02.');
});

test('two sources and the rest to another bin', () => {
  const l = line();
  l.sources = [{ ...l.sources[0], qty: '10' }, { bin: 'cb33e02', batch: '11I26JJ', expiry: '2030-09-11', qty: '3' }];
  l.moveTo = 'cb18a01';
  assert.equal(lineProblem(l, BINS), null);
  assert.equal(lineSummary(l, 'Carton'), 'Ambil 10 Carton 550070614 dari CB34D02 + 3 Carton dari CB33E02, sisa 23 Carton ke CB18A01.');
  assert.deepEqual(linePayload(l), {
    pick_id: 'p2', move_id: 'm3',
    sources: [{ bin: 'CB34D02', batch: '11I26JJ', expiry: '2030-09-11', qty: 10 }, { bin: 'CB33E02', batch: '11I26JJ', expiry: '2030-09-11', qty: 3 }],
    move_to: 'CB18A01', move_qty: 23,
  });
});

test('rest kept in the bin: no move in the sentence, move_to null', () => {
  const l = line(); l.moveTo = '';
  assert.equal(lineSummary(l, 'Carton'), 'Ambil 13 Carton 550070614 dari CB34D02.');
  assert.equal(linePayload(l).move_to, null);
});

test('Qty 0 is allowed (nothing found = short pick)', () => {
  const l = line(); l.sources[0].qty = '0';
  assert.equal(lineProblem(l, BINS), null);
});

test('problems: above the order, empty or unknown bin, destination = source, rest without quantity', () => {
  const over = line(); over.sources[0].qty = '14';
  assert.match(lineProblem(over, BINS)!, /paling banyak 13/);
  const empty = line(); empty.sources[0].bin = ' ';
  assert.match(lineProblem(empty, BINS)!, /isi bin/);
  const unknown = line(); unknown.sources[0].bin = 'CX99A01';
  assert.match(lineProblem(unknown, BINS)!, /CX99A01 tidak ada/);
  const same = line(); same.moveTo = 'cb34d02';
  assert.match(lineProblem(same, BINS)!, /sama dengan bin asal/);
  const noQty = line(); noQty.moveQty = '';
  assert.match(lineProblem(noQty, BINS)!, /Qty sisa/);
  const notNum = line(); notNum.sources[0].qty = 'x';
  assert.match(lineProblem(notNum, BINS)!, /Qty/);
});

test('progress: units never summed, short pick vs shortage, two shipments, per picker', () => {
  const t1: TaskRow = { ...base, id: 'a', seq: 1, shipment_number: 'S1', quantity: 13, status: 'COMPLETED', actual_quantity: 10, picked_by_name: 'Ani' };
  const t2: TaskRow = { ...base, id: 'b', seq: 2, shipment_number: 'S1', quantity: 20, status: 'PLANNED' };
  const t3: TaskRow = { ...drum, id: 'c', seq: 3, shipment_number: 'S2', quantity: 4, status: 'COMPLETED', actual_quantity: 4, picked_by_name: 'Budi' };
  const orders: OrderLine[] = [
    { shipment_number: 'S1', sku: '550070614', quantity_requested: 40, shortage_reason: 'NO_STOCK' },
    { shipment_number: 'S2', sku: '550044360', quantity_requested: 4 },
  ];
  const p = waveProgress([t1, t2, t3], orders);
  assert.deepEqual(p.lines, { done: 2, total: 3 });
  assert.deepEqual(p.units, { Carton: { needed: 40, picked: 10 }, Drum: { needed: 4, picked: 4 } });
  const s1 = p.orders.find((o) => o.shipment === 'S1')!;
  assert.equal(s1.planned, 33);
  assert.equal(s1.lackUnplanned, 7);
  assert.equal(s1.shortageReason, 'NO_STOCK');
  assert.equal(s1.lackShort, 3);
  assert.deepEqual(s1.shortSeqs, [1]);
  assert.equal(s1.openLines, 1);
  const s2 = p.shipments.find((s) => s.shipment === 'S2')!;
  assert.equal(s2.open, 0);
  assert.deepEqual(s2.lack, {});
  assert.deepEqual(p.pickers, [{ name: 'Ani', lines: 1, units: { Carton: 10 } }, { name: 'Budi', lines: 1, units: { Drum: 4 } }]);
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx tsx tests/pick-line.test.ts`
Expected: FAIL — `Cannot find module '../lib/pick-line'`.

- [ ] **Step 3: Add `picked_by_name` to `TaskRow` and export `sheetRow`**

In `lib/allocator/picklist-from-tasks.ts`, inside `interface TaskRow` after `deviation_reason: string | null;` add:

```ts
  /** typed name of the posting (0024; on pick_task_detail since 0067) */
  picked_by_name?: string | null;
```

In `lib/wave-sheet.ts`, replace the body of `sheetPayload` so the per-line mapping is a named export:

```ts
/** One line as post_wave_sheet / post_pick_line take it. */
export type SheetRow = {
  pick_id: string | null; move_id: string | null;
  sources: { bin: string; batch: string; expiry: string | null; qty: number }[];
  move_to: string | null; move_qty: number | null;
};

export function sheetRow(l: SheetLine): SheetRow {
  const to = up(l.moveTo);
  const sources = l.sources.filter((s, i) => i === 0 || up(s.bin) !== "" || Number(s.qty) > 0);
  return {
    pick_id: l.pick?.id ?? null,
    move_id: l.move?.id ?? null,
    sources: sources.map((s) => ({ bin: up(s.bin), batch: s.batch.trim(), expiry: day(s.expiry) || null, qty: l.pick ? Number(s.qty) || 0 : 0 })),
    move_to: to || null,
    move_qty: to ? Number(l.moveQty) || 0 : null,
  };
}

/** The post_wave_sheet payload: open lines marked done, and posted lines whose paper differs. */
export function sheetPayload(lines: SheetLine[], initial: Map<string, SheetLine>) {
  return lines.filter((l) => (l.posted ? lineChanged(l, initial.get(l.key)!) : l.done)).map(sheetRow);
}
```

- [ ] **Step 4: Write `lib/pick-line.ts`**

```ts
import { uomLabel } from "./allocator/picklist";
import { lookupUom } from "./allocator/uom-master";
import type { TaskRow } from "./allocator/picklist-from-tasks";
import { sheetRow, type SheetLine, type SheetRow } from "./wave-sheet";

/**
 * Paperless picking (0067): one line of a wave as the picker posts it at the
 * bin through post_pick_line, and the wave's progress against the order.
 * Quantities are in the item's own unit and never summed across units.
 */

const up = (s: string) => s.trim().toUpperCase();
const BIN = /^[A-Z0-9_]{3,20}$/;
const isQty = (v: string) => /^\d+(\.\d+)?$/.test(v.trim());

/** The unit the picklist prints: Carton, Drum, Pail, IBC, Fluidbag. */
export function unitOf(sku: string, uom: string | null): string {
  return uomLabel(lookupUom(sku) ?? uom);
}

/** What must be fixed before Posting, or null. Mirrors post_pick_line's input checks. */
export function lineProblem(l: SheetLine, bins: Set<string> | null): string | null {
  const unit = unitOf(l.sku, l.uom);
  let total = 0;
  for (const s of l.sources) {
    const bin = up(s.bin);
    if (!bin) return "Isi bin asal";
    if (!BIN.test(bin) || (bins && !bins.has(bin))) return `Bin ${bin} tidak ada`;
    if (l.pick) {
      if (!isQty(s.qty)) return `Qty di ${bin} harus angka`;
      total += Number(s.qty);
    }
  }
  if (l.pick && total > Number(l.pick.quantity)) return `Qty paling banyak ${Number(l.pick.quantity)} ${unit} (order baris ini)`;
  const to = up(l.moveTo);
  if (to) {
    if (!BIN.test(to) || (bins && !bins.has(to))) return `Bin ${to} tidak ada`;
    if (l.sources.some((s) => up(s.bin) === to)) return `Bin To Bin: tujuan ${to} sama dengan bin asal`;
    if (!isQty(l.moveQty) || Number(l.moveQty) <= 0) return "Isi Qty sisa yang dipindah";
  }
  return null;
}

/** The confirmation sentence, e.g. "Ambil 13 Carton 550070614 dari CB34D02, sisa 23 Carton ke CB18A02." */
export function lineSummary(l: SheetLine, unit: string): string {
  const to = up(l.moveTo);
  const rest = to ? `${Number(l.moveQty)} ${unit} ke ${to}` : "";
  if (!l.pick) return `Pindah ${rest.replace(" ke ", ` ${l.sku} dari ${up(l.sources[0].bin)} ke `)}.`;
  const parts = l.sources.map((s, i) => `${Number(s.qty)} ${unit}${i === 0 ? ` ${l.sku}` : ""} dari ${up(s.bin)}`);
  return `Ambil ${parts.join(" + ")}${rest ? `, sisa ${rest}` : ""}.`;
}

/** The p_row for post_pick_line. */
export function linePayload(l: SheetLine): SheetRow {
  return sheetRow(l);
}

export type OrderLine = { shipment_number: string; sku: string; description?: string | null; quantity_requested: number; shortage_reason?: string | null };
export type UnitQty = Record<string, { needed: number; picked: number }>;
export type ShipmentProgress = { shipment: string; units: UnitQty; open: number; lack: Record<string, number> };
export type OrderProgress = {
  shipment: string; sku: string; description: string; unit: string;
  needed: number; planned: number; picked: number;
  /** the part allocation never planned, with its reason (NO_STOCK, BLOCKED_SHELF_LIFE, ALREADY_STAGED) */
  lackUnplanned: number; shortageReason: string | null;
  /** the part posted lines came up short, and those lines */
  lackShort: number; shortSeqs: number[];
  openLines: number;
};
export type PickerProgress = { name: string; lines: number; units: Record<string, number> };
export type WaveProgress = { lines: { done: number; total: number }; units: UnitQty; shipments: ShipmentProgress[]; orders: OrderProgress[]; pickers: PickerProgress[] };

const addUnit = (u: UnitQty, unit: string, needed: number, picked: number) => {
  const x = u[unit] ?? { needed: 0, picked: 0 };
  u[unit] = { needed: x.needed + needed, picked: x.picked + picked };
};

/** Needed (the order) vs picked (posted), per wave, shipment, order line and picker. */
export function waveProgress(tasks: TaskRow[], orders: OrderLine[]): WaveProgress {
  const live = tasks.filter((t) => t.status !== "CANCELLED");
  const picks = live.filter((t) => t.task_type === "PICK");
  const posted = (t: TaskRow) => t.status === "COMPLETED";
  const took = (t: TaskRow) => (posted(t) ? Number(t.actual_quantity ?? t.quantity) : 0);
  const info = new Map(live.map((t) => [t.sku, t]));

  const keys = new Map<string, OrderLine>();
  for (const o of orders) keys.set(`${o.shipment_number}|${o.sku}`, o);
  for (const t of picks) {
    const k = `${t.shipment_number ?? "-"}|${t.sku}`;
    if (!keys.has(k)) keys.set(k, { shipment_number: t.shipment_number ?? "-", sku: t.sku, quantity_requested: 0 });
  }

  const orderRows: OrderProgress[] = [...keys.values()].map((o) => {
    const mine = picks.filter((t) => (t.shipment_number ?? "-") === o.shipment_number && t.sku === o.sku);
    const ref = info.get(o.sku);
    const planned = mine.reduce((n, t) => n + Number(t.quantity), 0);
    const picked = mine.reduce((n, t) => n + took(t), 0);
    const short = mine.filter((t) => posted(t) && took(t) < Number(t.quantity));
    const needed = Number(o.quantity_requested) || planned;
    return {
      shipment: o.shipment_number, sku: o.sku, description: o.description ?? ref?.description ?? "",
      unit: unitOf(o.sku, ref?.uom ?? null), needed, planned, picked,
      lackUnplanned: Math.max(needed - planned, 0), shortageReason: o.shortage_reason ?? null,
      lackShort: short.reduce((n, t) => n + Number(t.quantity) - took(t), 0), shortSeqs: short.map((t) => t.seq).sort((a, b) => a - b),
      openLines: mine.filter((t) => !posted(t)).length,
    };
  }).sort((a, b) => a.shipment.localeCompare(b.shipment) || a.sku.localeCompare(b.sku));

  const units: UnitQty = {};
  const byShipment = new Map<string, ShipmentProgress>();
  for (const o of orderRows) {
    addUnit(units, o.unit, o.needed, o.picked);
    const s = byShipment.get(o.shipment) ?? { shipment: o.shipment, units: {}, open: 0, lack: {} };
    addUnit(s.units, o.unit, o.needed, o.picked);
    s.open += o.openLines;
    byShipment.set(o.shipment, s);
  }
  for (const s of byShipment.values()) {
    if (s.open > 0) continue;
    for (const [unit, q] of Object.entries(s.units)) if (q.picked < q.needed) s.lack[unit] = q.needed - q.picked;
  }

  const pickers = new Map<string, PickerProgress>();
  for (const t of picks.filter(posted)) {
    const name = t.picked_by_name?.trim() || "–";
    const p = pickers.get(name) ?? { name, lines: 0, units: {} };
    const unit = unitOf(t.sku, t.uom);
    p.lines += 1;
    p.units[unit] = (p.units[unit] ?? 0) + took(t);
    pickers.set(name, p);
  }

  return {
    lines: { done: live.filter(posted).length, total: live.length },
    units, shipments: [...byShipment.values()], orders: orderRows,
    pickers: [...pickers.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}
```

Note on `lines`: the spec's `18/25 baris` counts tasks shown as cards; a broken-pallet pick and its move are one card. Count cards in the panel with `buildSheet(tasks).lines` (Task 4); `waveProgress.lines` counts tasks and is used only in this test.

- [ ] **Step 5: Run the test and add it to the chain**

Run: `npx tsx tests/pick-line.test.ts`
Expected: `8 passed, 0 failed`.

Then in `package.json`, append ` && tsx tests/pick-line.test.ts` right after `tsx tests/putaway-fix.test.ts` in the `test` script (Python one-liner, as the chain is one long string):

```bash
python3 - <<'EOF'
p='package.json'; s=open(p).read(); a='tsx tests/putaway-fix.test.ts'
assert s.count(a)==1; s=s.replace(a, a+' && tsx tests/pick-line.test.ts'); open(p,'w').write(s)
EOF
```

Run: `npx tsx tests/putaway-sheet.test.ts && npm run typecheck`
Expected: putaway-sheet tests still pass (they use `sheetPayload` indirectly via nothing — sanity), typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add lib/pick-line.ts lib/wave-sheet.ts lib/allocator/picklist-from-tasks.ts tests/pick-line.test.ts package.json
git commit -m "feat(waves): pick line validation, sentence, payload and order progress"
```

---

### Task 4: The picking screen

**Files:**
- Create: `app/(app)/waves/pick-line-card.tsx`
- Create: `app/(app)/waves/picking-panel.tsx`
- Modify: `app/(app)/waves/waves-client.tsx` (button + panel)

**Interfaces:**
- Consumes: `buildSheet`, `leftoverAfter`, `type SheetLine`, `type SheetStock` (`lib/wave-sheet.ts`); `lineProblem`, `lineSummary`, `linePayload`, `unitOf`, `waveProgress`, `type OrderLine` (`lib/pick-line.ts`); `post_pick_line` RPC (Task 2); `ItemScanInput`; `usePersonName`; `BinLeftCheck({ taskId, person, onDone })`; `ConfirmButton`.
- Produces: `BinScanInput({ id, value, onChange, list? })`, `PickingPanel({ wave, tasks, orders, onClose })`, `PickLineCard({ line, unit, stock, bins, person, waveId, onPosted })`.

- [ ] **Step 0: Write `components/app/bin-scan-input.tsx`**

Bin labels encode the plain bin code (QR and Code 128, `lib/labels.ts`), so a scan is the code itself. `CameraScanner` uses one fixed DOM region, so only one camera opens at a time per field toggle.

```tsx
"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import { Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const CameraScanner = dynamic(() => import("@/components/scan/camera-scanner").then((m) => m.CameraScanner), { ssr: false });

/**
 * Bin code field: a USB/Bluetooth scanner types the label's code, the phone
 * camera reads the location label, or the code is typed. Upper-cased.
 */
export function BinScanInput({ id, value, onChange, list, placeholder = "scan label / ketik bin" }: {
  id: string; value: string; onChange: (v: string) => void; list?: string; placeholder?: string;
}) {
  const [camera, setCamera] = useState(false);
  return (
    <div>
      <div className="flex gap-1">
        <Input id={id} value={value} list={list} placeholder={placeholder} className="font-cond uppercase"
          onChange={(e) => onChange(e.target.value.toUpperCase())} />
        <Button type="button" size="icon" variant="outline" aria-label="Scan label bin dengan kamera" onClick={() => setCamera((c) => !c)}><Camera className="h-4 w-4" /></Button>
      </div>
      {camera && <div className="mt-2"><CameraScanner onResult={(t) => { setCamera(false); onChange(t.trim().toUpperCase()); }} /></div>}
    </div>
  );
}
```

- [ ] **Step 1: Write `pick-line-card.tsx`**

```tsx
import { useState } from "react";
import { Check, Pencil, Plus, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { ItemScanInput } from "@/components/app/item-scan-input";
import { BinScanInput } from "@/components/app/bin-scan-input";
import { BinLeftCheck } from "./bin-left-check";
import { leftoverAfter, type SheetLine, type SheetStock } from "@/lib/wave-sheet";
import { linePayload, lineProblem, lineSummary } from "@/lib/pick-line";
import { cn, fmtDate, fmtNum } from "@/lib/utils";

const REASONS = ["bin kosong / kurang", "palet terhalang", "karton rusak", "pickface penuh", "lain"];

/**
 * One line of the picking screen (0067): the plan, Sesuai to post it as
 * planned, Berbeda to post what really happened, Ubah on one's own posted line.
 * Editor state lives here, keyed by the line, so a page refresh never wipes it.
 */
export function PickLineCard({ line, unit, stock, bins, person, waveId, onPosted }: {
  line: SheetLine; unit: string; stock: SheetStock[]; bins: Set<string> | null; person: string; waveId: string; onPosted: () => void;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "confirm" | "check">("view");
  const [draft, setDraft] = useState<SheetLine>(line);
  const [reason, setReason] = useState("");
  const [scan, setScan] = useState("");
  const [scanned, setScanned] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "bad" | "warn"; text: string } | null>(null);

  const posted = line.posted;
  const by = line.pick?.picked_by_name ?? line.move?.picked_by_name ?? null;
  const own = !by || by.trim().toLowerCase() === person.trim().toLowerCase();
  const sources = stock.filter((s) => s.sku === line.sku && s.qty > 0)
    .sort((a, b) => (a.expiry ?? "9999").localeCompare(b.expiry ?? "9999") || a.bin.localeCompare(b.bin));
  const problem = lineProblem(draft, bins);
  const asPlanned = mode !== "edit" && mode !== "confirm";
  const sentence = lineSummary(asPlanned ? line : draft, unit);

  function open(edit: boolean) {
    const d = structuredClone(line);
    if (!line.posted && line.move) d.moveQty = String(leftoverAfter(d, stock) || Number(line.move.quantity));
    setDraft(d); setReason(""); setMessage(null);
    setMode(edit ? "edit" : "confirm");
  }
  const setSource = (i: number, patch: Partial<SheetLine["sources"][number]>) => setDraft((d) => {
    const x = structuredClone(d);
    const s = { ...x.sources[i], ...patch };
    if (patch.bin !== undefined) {
      const here = sources.filter((r) => r.bin === s.bin.trim().toUpperCase());
      if (here.length === 1) { s.batch = here[0].batch; s.expiry = (here[0].expiry ?? "").slice(0, 10); }
    }
    x.sources[i] = s;
    return x;
  });

  async function post(target: SheetLine) {
    setBusy(true); setMessage(null);
    const { data, error } = await createClient().rpc("post_pick_line", {
      p_wave_id: waveId, p_row: linePayload(target), p_by_name: person,
      p_reason: reason.trim() || (target === line ? "sesuai picklist" : "berbeda di lapangan"), p_scanned: scanned,
    });
    setBusy(false);
    if (error) { setMessage({ tone: "bad", text: error.message }); return; }
    const r = data as { result: "posted" | "refused"; message?: string; corrections?: number };
    if (r.result === "refused") {
      setMessage({ tone: "warn", text: `${r.message} — dikirim ke supervisor, lanjut ke baris berikutnya.` });
      setMode("view");
      return;
    }
    setMessage(r.corrections ? { tone: "warn", text: `Diposting dengan ${r.corrections} koreksi stok kecil; bin ini akan dihitung ulang.` } : null);
    setMode(line.pick ? "check" : "view");
    if (!line.pick) onPosted();
  }

  const qtyOf = (l: SheetLine) => l.sources.reduce((n, s) => n + (Number(s.qty) || 0), 0);
  const plate = "rounded bg-plate px-2 py-0.5 font-cond text-lg font-semibold tracking-wide text-steel";

  return (
    <div id={`line-${line.key}`} className={cn("space-y-3 rounded-lg border bg-white p-4", posted ? "border-ok/50 bg-ok/5" : "border-steel-200")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-steel-500">#{line.seq}</span>
            <span className={plate}>{line.sources[0].bin}</span>
            {line.pick?.pick_type && <span className="rounded bg-steel-100 px-1.5 text-xs font-semibold">{line.pick.pick_type}</span>}
          </div>
          <p className="text-sm font-semibold">{line.sku} · {line.description}</p>
          <p className="text-xs text-steel-500">Batch {line.sources[0].batch || "–"} · exp {fmtDate(line.sources[0].expiry)}{line.shipment && ` · shipment ${line.shipment}`}</p>
        </div>
        <div className="text-right">
          {line.pick && <p className="font-cond text-2xl font-semibold tabular">{fmtNum(posted ? qtyOf(line) : Number(line.pick.quantity))} <span className="text-base">{unit}</span></p>}
          {line.move && <p className="text-xs">sisa → <b>{line.moveTo || "tetap di bin"}</b>{line.moveTo && ` (${fmtNum(Number(line.moveQty))} ${unit})`}</p>}
        </div>
      </div>

      {posted && mode === "view" && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="font-semibold text-ok"><Check className="mr-1 inline h-4 w-4" />Diposting{by && ` oleh ${by}`}{line.pick?.completed_at && ` · ${new Date(line.pick.completed_at).toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" })}`}</span>
          <Button size="sm" variant="outline" disabled={!own || person.trim().length < 2} onClick={() => open(true)}
            title={own ? "Ubah baris yang Anda posting" : "Baris orang lain: minta supervisor"}><Pencil className="h-4 w-4" />Ubah</Button>
          {!own && <span className="w-full text-xs text-steel-500">Diposting {by}: minta supervisor untuk mengubah.</span>}
        </div>
      )}

      {!posted && mode === "view" && (
        <div className="flex gap-2">
          <Button className="flex-1" disabled={person.trim().length < 2} onClick={() => open(false)}><Check className="h-4 w-4" />Sesuai</Button>
          <Button className="flex-1" variant="outline" disabled={person.trim().length < 2} onClick={() => open(true)}><Pencil className="h-4 w-4" />Berbeda</Button>
        </div>
      )}

      {mode === "edit" && (
        <div className="space-y-3 rounded-md border border-warn/40 bg-warn/5 p-3">
          {draft.sources.map((s, i) => (
            <div key={i} className="grid grid-cols-[1fr_5rem_auto] items-end gap-2">
              <div>
                <Label htmlFor={`bin-${line.key}-${i}`}>{i === 0 ? "Bin asal (scan label / ketik)" : "Bin lain"}</Label>
                <BinScanInput id={`bin-${line.key}-${i}`} list={`stock-${line.key}`} value={s.bin} onChange={(v) => setSource(i, { bin: v })} />
                <p className="mt-0.5 text-[11px] text-steel-500">batch {s.batch || "–"} · exp {fmtDate(s.expiry)}</p>
              </div>
              {line.pick && (
                <div>
                  <Label htmlFor={`qty-${line.key}-${i}`}>Qty ({unit})</Label>
                  <Input id={`qty-${line.key}-${i}`} inputMode="numeric" value={s.qty} onChange={(e) => setSource(i, { qty: e.target.value })} />
                </div>
              )}
              {i > 0 ? <Button size="sm" variant="ghost" aria-label="Hapus bin ini" onClick={() => setDraft((d) => ({ ...d, sources: d.sources.filter((_, j) => j !== i) }))}><X className="h-4 w-4" /></Button> : <span />}
            </div>
          ))}
          <datalist id={`stock-${line.key}`}>{sources.map((r) => <option key={`${r.bin}|${r.batch}|${r.expiry}`} value={r.bin}>{`${r.batch} · ${fmtDate(r.expiry)} · ${fmtNum(r.qty)} ${unit}`}</option>)}</datalist>
          {line.pick && draft.sources.length < 3 && (
            <Button size="sm" variant="ghost" onClick={() => setDraft((d) => ({ ...d, sources: [...d.sources, { bin: "", batch: "", expiry: "", qty: "0" }] }))}><Plus className="h-4 w-4" />bin lain</Button>
          )}
          {line.move && (
            <div className="grid grid-cols-[1fr_5rem] gap-2">
              <div><Label htmlFor={`to-${line.key}`}>Sisa dipindah ke (scan label / ketik; kosong = tetap di bin)</Label>
                <BinScanInput id={`to-${line.key}`} value={draft.moveTo} onChange={(v) => setDraft((d) => ({ ...d, moveTo: v }))} /></div>
              <div><Label htmlFor={`mq-${line.key}`}>Qty sisa</Label>
                <Input id={`mq-${line.key}`} inputMode="numeric" value={draft.moveQty} onChange={(e) => setDraft((d) => ({ ...d, moveQty: e.target.value }))} /></div>
            </div>
          )}
          <div className="flex flex-wrap gap-1">{REASONS.map((r) => (
            <button key={r} type="button" onClick={() => setReason(r)} className={cn("rounded-full border px-2 py-0.5 text-xs", reason === r ? "border-ckb bg-ckb text-white" : "border-steel-300")}>{r}</button>
          ))}</div>
          {problem && <p role="alert" className="text-sm text-bad">{problem}</p>}
          <div className="flex gap-2">
            <Button disabled={!!problem || !reason} onClick={() => setMode("confirm")}>Lanjut</Button>
            <Button variant="outline" onClick={() => setMode("view")}>Batal</Button>
          </div>
        </div>
      )}

      {mode === "confirm" && (
        <div className="space-y-3 rounded-md border border-ckb/40 bg-ckb/5 p-3">
          <p className="text-sm font-semibold">{sentence}</p>
          {line.pick && !line.posted && (
            <div><Label htmlFor={`scan-${line.key}`}>Scan barcode karton atau ketik SKU</Label>
              <ItemScanInput id={`scan-${line.key}`} value={scan} onChange={setScan} onItem={(it) => setScanned(it?.sku ?? null)} placeholder="scan / ketik SKU" />
              {scanned && scanned !== line.sku && <p className="text-sm text-bad">Barang salah: {scanned}, baris ini {line.sku}</p>}</div>
          )}
          <div className="flex gap-2">
            <Button disabled={busy || (scanned !== null && scanned !== line.sku)} onClick={() => void post(draft)}>{busy ? "Memposting…" : "Posting"}</Button>
            <Button variant="outline" disabled={busy} onClick={() => setMode("view")}>Batal</Button>
          </div>
        </div>
      )}

      {mode === "check" && line.pick && (
        <BinLeftCheck taskId={line.pick.id} person={person} onDone={() => { setMode("view"); onPosted(); }} />
      )}

      {message && <p role="alert" className={cn("text-sm", message.tone === "bad" ? "text-bad" : "text-warn")}>{message.text}</p>}
    </div>
  );
}
```

Note: `open(false)` (Sesuai) goes straight to `confirm` with `draft` = the plan, so `post(draft)` posts the plan.

- [ ] **Step 2: Write `picking-panel.tsx`**

```tsx
"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PersonNameField, usePersonName } from "@/components/app/person-name";
import { ConfirmButton } from "@/components/app/confirm-button";
import { fetchAll } from "@/lib/fetch-all";
import { buildSheet, type SheetStock } from "@/lib/wave-sheet";
import { unitOf, waveProgress, type OrderLine, type UnitQty } from "@/lib/pick-line";
import type { TaskRow } from "@/lib/allocator/picklist-from-tasks";
import { cn, fmtNum } from "@/lib/utils";
import { PickLineCard } from "./pick-line-card";

const REASON_LABEL: Record<string, string> = { NO_STOCK: "stok tidak ada", BLOCKED_SHELF_LIFE: "umur simpan kurang", ALREADY_STAGED: "sudah di staging" };

function Units({ units }: { units: UnitQty }) {
  return (
    <div className="space-y-1">{Object.entries(units).map(([unit, q]) => (
      <div key={unit} className="text-sm tabular">
        <div className="flex justify-between"><span>{unit}</span><span><b>{fmtNum(q.picked)}</b>/{fmtNum(q.needed)}</span></div>
        <div className="h-1.5 overflow-hidden rounded bg-steel-100"><div className={cn("h-full", q.picked >= q.needed ? "bg-ok" : "bg-ckb")} style={{ width: `${q.needed ? Math.min(q.picked / q.needed, 1) * 100 : 0}%` }} /></div>
      </div>
    ))}</div>
  );
}

/**
 * Picking (0067): a wave line by line on the phone, in picklist order. Each
 * line posts on its own through post_pick_line; progress shows what the order
 * still needs. Opens in place of the wave's table.
 */
export function PickingPanel({ wave: w, tasks, orders, onClose }: {
  wave: { id: string; wave_no: string; status: string }; tasks: TaskRow[]; orders: OrderLine[]; onClose: () => void;
}) {
  const router = useRouter();
  const [person, setPerson] = usePersonName();
  const [stock, setStock] = useState<SheetStock[]>([]);
  const [bins, setBins] = useState<Set<string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lines = useMemo(() => buildSheet(tasks).lines, [tasks]);
  const progress = useMemo(() => waveProgress(tasks, orders), [tasks, orders]);
  const done = lines.filter((l) => l.posted).length;
  const skus = useMemo(() => [...new Set(tasks.map((t) => t.sku))].sort().join(","), [tasks]);

  async function loadStock() {
    const db = createClient();
    try {
      const [inv, all] = await Promise.all([
        fetchAll<{ bin_code: string; sku: string; batch_lot: string; expiry_date: string | null; quantity: number }>((a, b) =>
          db.from("inventory_detail").select("bin_code, sku, batch_lot, expiry_date, quantity").in("sku", skus.split(",")).order("bin_code").range(a, b)),
        bins ? Promise.resolve(null) : fetchAll<{ bin_code: string }>((a, b) => db.from("bins").select("bin_code").neq("status", "blocked").order("bin_code").range(a, b)),
      ]);
      setStock(inv.map((r) => ({ bin: r.bin_code, sku: r.sku, batch: r.batch_lot, expiry: r.expiry_date, qty: Number(r.quantity) })));
      if (all) setBins(new Set(all.map((b) => b.bin_code)));
    } catch (e) { setError((e as Error).message); }
  }
  // Stock is reloaded whenever the wave's tasks change (a posting, here or by another picker).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void loadStock(); }, [tasks]);

  function posted() {
    router.refresh();
    const next = lines.find((l) => !l.posted);
    if (next) setTimeout(() => document.getElementById(`line-${next.key}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 400);
  }

  async function close(): Promise<string | null> {
    const { error } = await createClient().rpc("complete_wave_by", { p_wave_id: w.id, p_by_name: person });
    if (error) return error.message;
    router.refresh(); onClose();
    return null;
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle>Picking NO {w.wave_no} · {fmtNum(done)}/{fmtNum(lines.length)} baris</CardTitle>
          <Button size="sm" variant="ghost" onClick={onClose}><X className="h-4 w-4" />Tutup</Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <PersonNameField className="max-w-xs" value={person} onChange={setPerson} label="Nama picker (wajib)" />
          <Units units={progress.units} />
          {progress.shipments.length > 1 && progress.shipments.map((s) => (
            <div key={s.shipment} className="text-sm"><b>Shipment {s.shipment}</b>
              {s.open === 0 && (Object.keys(s.lack).length === 0 ? <span className="ml-2 font-semibold text-ok">lengkap</span>
                : <span className="ml-2 font-semibold text-bad">kurang {Object.entries(s.lack).map(([u, n]) => `${fmtNum(n)} ${u}`).join(" · ")}</span>)}
              <Units units={s.units} /></div>
          ))}
          {progress.shipments.length === 1 && progress.shipments[0].open === 0 && (
            Object.keys(progress.shipments[0].lack).length === 0
              ? <p className="text-sm font-semibold text-ok">Order lengkap</p>
              : <p className="text-sm font-semibold text-bad">Order kurang {Object.entries(progress.shipments[0].lack).map(([u, n]) => `${fmtNum(n)} ${u}`).join(" · ")}</p>
          )}
          <details className="text-sm"><summary className="cursor-pointer font-semibold">Per order</summary>
            <ul className="mt-2 space-y-1">{progress.orders.map((o) => (
              <li key={`${o.shipment}|${o.sku}`} className="tabular">
                {o.shipment} · {o.sku} {o.description}: <b>{fmtNum(o.picked)}</b>/{fmtNum(o.needed)} {o.unit}
                {o.lackUnplanned > 0 && <span className="text-bad"> · {fmtNum(o.lackUnplanned)} tidak teralokasi ({REASON_LABEL[o.shortageReason ?? ""] ?? o.shortageReason ?? "kurang stok"})</span>}
                {o.lackShort > 0 && <span className="text-bad"> · {fmtNum(o.lackShort)} kurang dari baris #{o.shortSeqs.join(", #")}</span>}
              </li>
            ))}</ul>
          </details>
          <details className="text-sm"><summary className="cursor-pointer font-semibold">Per picker</summary>
            <ul className="mt-2 space-y-1">{progress.pickers.map((p) => (
              <li key={p.name}>{p.name}: {fmtNum(p.lines)} baris · {Object.entries(p.units).map(([u, n]) => `${fmtNum(n)} ${u}`).join(" · ")}</li>
            ))}</ul>
          </details>
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        </CardContent>
      </Card>

      {lines.map((l) => {
        const order = progress.orders.find((o) => o.shipment === (l.shipment ?? "-") && o.sku === l.sku);
        const lastOpen = !l.posted && order && order.openLines === 1 && order.picked + Number(l.pick?.quantity ?? 0) < order.needed;
        return (
          <div key={l.key}>
            <PickLineCard line={l} unit={unitOf(l.sku, l.uom)} stock={stock} bins={bins} person={person} waveId={w.id} onPosted={posted} />
            {lastOpen && <p className="px-1 pt-1 text-xs font-semibold text-bad">masih kurang {fmtNum(order.needed - order.picked - Number(l.pick?.quantity ?? 0))} {order.unit} untuk order ini</p>}
          </div>
        );
      })}

      {w.status === "PENDING" && done === lines.length && lines.length > 0 && (
        <ConfirmButton title={`Tutup NO ${w.wave_no}`} summary="Semua baris sudah diposting. Tandai wave dan order-nya selesai." onConfirm={close}>
          <CheckCheck className="h-4 w-4" />Selesaikan wave
        </ConfirmButton>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Check the imports exist with these names**

Run: `grep -n "export function ConfirmButton\|export function PersonNameField\|export function usePersonName\|export function BinLeftCheck" -r components app/\(app\)/waves | head`
Expected: `ConfirmButton` in `components/app/confirm-button.tsx` (props `title`, `summary`, `onConfirm: () => Promise<string | null>`, optional `confirmLabel`, `size`, `variant`), `PersonNameField`/`usePersonName` in `components/app/person-name.tsx`, `BinLeftCheck` in `app/(app)/waves/bin-left-check.tsx` with props `{ taskId, person, onDone }`. If a path or prop differs, use the real one (waves-client.tsx imports them all).

- [ ] **Step 4: Wire `Mulai picking` into the wave card**

In `app/(app)/waves/waves-client.tsx`:

Add the dynamic import next to the existing `WaveSheetPanel` one (around line 39):

```tsx
const PickingPanel = dynamic(() => import("./picking-panel").then((m) => m.PickingPanel), { ssr: false });
```

In the wave card component, next to `const [sheet, setSheet] = useState(false);` add:

```tsx
  // Picking (0067): the wave line by line for the floor, any role.
  const [picking, setPicking] = useState(false);
  const canPick = w.status === "PENDING" && live > 0;
```

Change `if (active && rows.length === 0 && !sheet) return null;` to `if (active && rows.length === 0 && !sheet && !picking) return null;` and `const show = expanded || active || sheet;` to `const show = expanded || active || sheet || picking;`.

In the header buttons, before the `canSheet && !sheet` button, add:

```tsx
          {canPick && !picking && !sheet && (
            <Button size="sm" onClick={() => setPicking(true)} title="Picking tanpa kertas: posting baris demi baris di bin">
              <ClipboardList className="h-4 w-4" />Mulai picking
            </Button>
          )}
```

Next to `{sheet && <WaveSheetPanel wave={w} tasks={tasks} onClose={() => setSheet(false)} />}` add:

```tsx
      {picking && <PickingPanel wave={w} tasks={tasks}
        orders={outbound.map((o) => ({ shipment_number: o.shipment_number, sku: o.sku, description: o.description, quantity_requested: Number(o.quantity_requested), shortage_reason: o.shortage_reason }))}
        onClose={() => setPicking(false)} />}
```

and make the wave's own task table render only when `!sheet && !picking` (find the condition that hides the table while `sheet` is open and add `&& !picking`).

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors, `✔ No ESLint warnings or errors`.

- [ ] **Step 6: Commit**

```bash
git add components/app/bin-scan-input.tsx "app/(app)/waves/pick-line-card.tsx" "app/(app)/waves/picking-panel.tsx" "app/(app)/waves/waves-client.tsx"
git commit -m "feat(waves): Mulai picking, line-by-line posting on the phone"
```

---

### Task 5: Minta supervisor in Perlu ditangani, and the sheet opened at that line

**Files:**
- Create: `app/(app)/waves/escalations-panel.tsx`
- Modify: `app/(app)/waves/page.tsx` (load requests)
- Modify: `app/(app)/waves/waves-client.tsx` (render panel, open sheet with prefill)
- Modify: `app/(app)/waves/wave-sheet.tsx` (`prefill` prop)

**Interfaces:**
- Consumes: view `pick_line_requests_open`, RPC `close_pick_line_request` (Task 2); `type SheetRow` (Task 3); `unitOf`.
- Produces: `type LineRequest` (one row of `pick_line_requests_open`), `EscalationsPanel({ rows, supervisor, onOpenSheet })`, `WaveSheetPanel` prop `prefill?: SheetRow`.

- [ ] **Step 1: Write `escalations-panel.tsx`**

```tsx
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { unitOf } from "@/lib/pick-line";
import type { SheetRow } from "@/lib/wave-sheet";
import { fmtNum } from "@/lib/utils";

export type LineRequest = {
  id: string; wave_id: string; pick_id: string | null; move_id: string | null; row: SheetRow; by_name: string; kind: string;
  message: string; created_at: string; wave_no: string; seq: number | null; shipment_number: string | null;
  sku: string | null; description: string | null; uom: string | null; from_bin: string | null;
};

const KIND: Record<string, string> = {
  correction_over_limit: "Stok sistem jauh kurang", other_picker: "Baris picker lain", audited: "Sudah diaudit",
  loaded: "Sudah dimuat", wave_not_pending: "Wave Tunda / selesai",
};

/** Perlu ditangani · Minta supervisor (0067): picker lines the picking screen could not post. */
export function EscalationsPanel({ rows, supervisor, person, onOpenSheet }: {
  rows: LineRequest[]; supervisor: boolean; person: string; onOpenSheet: (r: LineRequest) => void;
}) {
  const router = useRouter();
  const [note, setNote] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  if (!rows.length) return null;

  async function close(r: LineRequest) {
    setError(null);
    const { error } = await createClient().rpc("close_pick_line_request", { p_id: r.id, p_by_name: person, p_note: note[r.id] ?? "" });
    if (error) return setError(error.message);
    router.refresh();
  }

  return (
    <Card className="border-l-4 border-warn">
      <CardHeader><CardTitle>Perlu ditangani · Minta supervisor · {fmtNum(rows.length)}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        {rows.map((r) => {
          const unit = unitOf(r.sku ?? "", r.uom);
          const took = r.row.sources.map((s) => `${fmtNum(s.qty)} ${unit} dari ${s.bin}`).join(" + ");
          return (
            <div key={r.id} className="space-y-2 rounded-md border border-steel-200 p-3 text-sm">
              <p><b>NO {r.wave_no} #{r.seq ?? "–"}</b> · {r.sku} {r.description} · {KIND[r.kind] ?? r.kind}</p>
              <p className="text-steel-500">{r.by_name}, {new Date(r.created_at).toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" })}: ambil {took}{r.row.move_to && `, sisa ${fmtNum(r.row.move_qty ?? 0)} ${unit} ke ${r.row.move_to}`}</p>
              <p className="text-warn">{r.message}</p>
              {supervisor && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" onClick={() => onOpenSheet(r)}>Isi dari picklist</Button>
                  <Input aria-label={`Catatan tutup ${r.wave_no} #${r.seq}`} className="h-8 w-56" placeholder="catatan (wajib untuk Tutup)"
                    value={note[r.id] ?? ""} onChange={(e) => setNote({ ...note, [r.id]: e.target.value })} />
                  <Button size="sm" variant="outline" disabled={!(note[r.id] ?? "").trim() || person.trim().length < 2} onClick={() => void close(r)}>Tutup</Button>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Load the requests on the page**

In `app/(app)/waves/page.tsx`, add to the `Promise.all` array (and to the destructured names as `{ data: requests }`):

```ts
    // Minta supervisor (0067): picker lines the picking screen could not post.
    supabase.from("pick_line_requests_open").select("*").eq("planned_date", date).order("created_at"),
```

and pass to the client: `requests={(requests ?? []) as LineRequest[]}` with `import type { LineRequest } from "./escalations-panel";`. Add `"pick_line_requests"` to the `PageHeader` `live` list.

- [ ] **Step 3: Render the panel and open the sheet at the line**

In `waves-client.tsx`:
- add prop `requests = []` typed `requests?: LineRequest[]` to `WavesClient`;
- add state `const [sheetAt, setSheetAt] = useState<LineRequest | null>(null);`;
- render `<EscalationsPanel rows={requests} supervisor={supervisor} person={person} onOpenSheet={setSheetAt} />` right after `<ProblemsPanel … />`;
- pass `sheetAt={sheetAt?.wave_id === w.id ? sheetAt : null}` and `onSheetAtDone={() => setSheetAt(null)}` to each wave card; in the card, `useEffect(() => { if (sheetAt) { setSheet(true); setExpanded(true); } }, [sheetAt]);` and render `<WaveSheetPanel wave={w} tasks={tasks} prefill={sheetAt?.row} onClose={() => { setSheet(false); onSheetAtDone(); }} />`.

- [ ] **Step 4: `prefill` in `WaveSheetPanel`**

In `wave-sheet.tsx`, add `prefill` to the props: `{ wave, tasks, onClose, prefill }: { …; prefill?: SheetRow | null }` (import `type SheetRow`). In `load()`, after `setLines(sheet.lines)` is computed, apply it before setting state:

```tsx
    const sheet = buildSheet(tasks);
    if (prefill) {
      const key = prefill.pick_id ?? prefill.move_id;
      const l = sheet.lines.find((x) => x.key === key || x.pick?.id === prefill.pick_id);
      if (l) {
        // What the picker posted on the phone (0067): the supervisor checks it and posts.
        l.sources = prefill.sources.map((s) => ({ bin: s.bin, batch: s.batch, expiry: s.expiry ?? "", qty: String(s.qty) }));
        l.moveTo = prefill.move_to ?? ""; l.moveQty = prefill.move_qty === null ? "" : String(prefill.move_qty);
        l.done = true;
        setTimeout(() => document.querySelector(`[data-sheet="${w.id}"][data-r="${sheet.lines.indexOf(l)}"]`)?.scrollIntoView({ block: "center" }), 300);
      }
    }
    setLines(sheet.lines);
```

`initial` must still be the unmodified plan: build it from a second `buildSheet(tasks)` call: `setInitial(new Map(buildSheet(tasks).lines.map((l) => [l.key, structuredClone(l)])));`.

- [ ] **Step 5: Typecheck, lint, tests**

Run: `npm run typecheck && npm run lint && npx tsx tests/wave-sheet.test.ts && npx tsx tests/pick-line.test.ts`
Expected: clean; both test files `0 failed`.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/waves/escalations-panel.tsx" "app/(app)/waves/page.tsx" "app/(app)/waves/waves-client.tsx" "app/(app)/waves/wave-sheet.tsx"
git commit -m "feat(waves): Minta supervisor in Perlu ditangani, opens Isi dari picklist at the line"
```

---

### Task 6: Docs, full verification, browser run

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README**

Add after the `0066` bullet in the migrations list:

```markdown
- `0067` **Paperless picking** — `Mulai picking` on every running wave opens the wave line by line on the phone, in picklist order, for every role. Per line `Sesuai` posts the plan, `Berbeda` posts what happened: `Qty` in the item's unit (Carton, Drum, Pail…), the source bin and batch (scan the location label or type), `+ bin lain`, and where the pallet rest went. `post_pick_line` posts it through the `Isi dari picklist` engine (`post_wave_sheet_rows`) with the picker's limits: a name, at most the order line, a `Koreksi picklist` only up to `adjust_approval_qty`, and `Ubah` only on one's own line while the wave runs and the line is neither audited nor loaded. Anything beyond that is recorded in `pick_line_requests` and listed under **`Perlu ditangani · Minta supervisor`**, where `Isi dari picklist` opens at that line with what the picker posted. The top of the screen shows needed vs picked per unit for the wave, each shipment (`lengkap` / `kurang`), each order line (a shortage the allocation never planned shown apart from a short pick) and each picker.
```

and after the `38_putaway_fix.sql` line in the test list:

```markdown
psql -f supabase/tests/39_pick_line.sql                  # paperless picking, Minta supervisor (0067), same
```

- [ ] **Step 2: Full verification**

Run: `npm test && npm run typecheck && npm run lint && PGUSER=postgres scripts/sql-test.sh`
Expected: `npm test` exits 0; typecheck clean; `✔ No ESLint warnings or errors`; every SQL file `0 FAIL`, including `39_pick_line.sql: 21 PASS`.

- [ ] **Step 3: Browser run on the local stack (not live)**

Apply 0067 to the local Supabase (`psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/migrations/0067_pick_line.sql`, then record it: `insert into supabase_migrations.schema_migrations (version, name) values ('0067','pick_line')`). Start `next dev -p 3100` with the local stack's URL/keys and a local test account in the `SITE_ACCOUNT_*` env vars, `NEXT_DIST_DIR=.next/claude-dev`. At a 390 × 844 viewport, on a local wave:
1. `Mulai picking` → the cards are in picklist order, the header shows `0/N baris` and needed/picked per unit.
2. `Sesuai` on a line → confirm sentence in the item's unit → `Posting` → the card turns green "Diposting oleh <name>", the progress moves, the next line scrolls into view.
3. Open `Berbeda` on another line, type a Qty, then trigger a page refresh (post a line from a second tab) → the typed Qty is still there.
4. `Berbeda`: two sources and the rest to another bin → posted; `Ubah` on it with the same name → re-posted.
5. A line whose system stock is short by more than 20 → the card says "minta supervisor", nothing posted; as supervisor the request shows under `Perlu ditangani · Minta supervisor`; `Isi dari picklist` opens at that line prefilled; posting it removes the request.
6. Last line posted → `Selesaikan wave`.

Afterwards: stop the server, `git checkout -- tsconfig.json` (Next adds the dist types path), `rm -rf .next/claude-dev`.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(readme): paperless picking and Minta supervisor (0067, test 39)"
```
