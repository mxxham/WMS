-- Bin To Bin destination rack count (0115). Runs in a transaction and rolls back.
-- Run with scripts/sql-test.sh. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users values ('11111111-1111-1111-1111-111111111111','op@x','{"name":"Operator"}'),
                              ('22222222-2222-2222-2222-222222222222','sup@x','{"name":"Supervisor"}') on conflict do nothing;
update profiles set role='operator' where id='11111111-1111-1111-1111-111111111111';
update profiles set role='supervisor' where id='22222222-2222-2222-2222-222222222222';

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.assign_day(p_date date, p_user uuid) returns void language sql security definer as $$
  insert into public.shipment_assignments (planned_date, shipment_number, user_id, assigned_by_name)
  select w.planned_date, s, p_user, 'fixture' from public.waves w, unnest(w.shipment_numbers) s where w.planned_date = p_date
  on conflict do nothing $$;
grant execute on function pg_temp.assign_day(date, uuid) to authenticated;
create or replace function pg_temp.fails(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then
  if sqlerrm not like p_like then raise notice 'got: %', sqlerrm; end if;
  return sqlerrm like p_like; end $$;
create or replace function pg_temp.task(p_seq int) returns uuid language sql as $$
  select t.id from pick_tasks t join waves w on w.id = t.wave_id
  where w.planned_date = '2026-10-06' and w.wave_no = '1' and t.task_type = 'REPLENISH' and t.seq = p_seq $$;
create or replace function pg_temp.line(p_seq int) returns pick_audit_move language sql as $$
  select * from pick_audit_move where task_id = pg_temp.task(p_seq) $$;

-- Fixture: reserve CF38C01 holds 96 of 550044709 (A7); pickface CF38C02 empty. Two moves of 24 leave 48 in CF38C01.
delete from inventory where bin_id in (select id from bins where bin_code in ('CF38C01', 'CF38C02'));
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
values ('adjustment', (select id from items where sku = '550044709'), 'A7', 96, (select id from bins where bin_code = 'CF38C01'), '2031-05-05', 'fixture');

set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select save_plan('2026-10-06', '{
  "waves":[{"wave_no":"1","shipment_numbers":["PA1"]}],
  "tasks":[
    {"wave_no":"1","task_type":"REPLENISH","sku":"550044709","from_bin":"CF38C01","to_bin":"CF38C02","batch_lot":"A7","expiry_date":"2031-05-05","quantity":24,"seq":1},
    {"wave_no":"1","task_type":"REPLENISH","sku":"550044709","from_bin":"CF38C01","to_bin":"CF38C02","batch_lot":"A7","expiry_date":"2031-05-05","quantity":24,"seq":2},
    {"wave_no":"1","task_type":"REPLENISH","sku":"550044709","from_bin":"CF38C01","to_bin":"CF38C02","batch_lot":"A7","expiry_date":"2031-05-05","quantity":5,"seq":3},
    {"wave_no":"1","task_type":"REPLENISH","sku":"550044709","from_bin":"CF38C01","to_bin":"CF38C02","batch_lot":"A7","expiry_date":"2031-05-05","quantity":5,"seq":4}],
  "outbound":[{"wave_no":"1","shipment_number":"PA1","sku":"550044709","quantity_requested":1,"quantity_allocated":0}]}'::jsonb);
select pg_temp.assign_day('2026-10-06', '11111111-1111-1111-1111-111111111111');

set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select post_task_by(pg_temp.task(1), p_by_name => 'Budi Santoso', p_scanned => 'CF38C01');
select post_task_by(pg_temp.task(2), p_by_name => 'Budi Santoso', p_scanned => 'CF38C01');
select post_task_by(pg_temp.task(3), p_actual_qty => 0, p_by_name => 'Budi Santoso', p_scanned => 'CF38C01', p_reason => 'tidak ada');

-- After the two moves of 24: CF38C02 (destination) holds 48.
-- ---- A. Rules --------------------------------------------------------------
select pg_temp.check('the mover cannot count the destination',
  pg_temp.fails(format($q$select record_move_rack_audit(%L, 'Budi Santoso', 48)$q$, pg_temp.task(1)), '%petugas pindah%'));
select pg_temp.check('a move of 0 is refused',
  pg_temp.fails(format($q$select record_move_rack_audit(%L, 'Sari', 0)$q$, pg_temp.task(3)), '%tidak dipindah (0)%'));
select pg_temp.check('an unposted move is refused',
  pg_temp.fails(format($q$select record_move_rack_audit(%L, 'Sari', 0)$q$, pg_temp.task(4)), '%belum selesai%'));
select pg_temp.check('a wrong count without a note is refused',
  pg_temp.fails(format($q$select record_move_rack_audit(%L, 'Sari', 46)$q$, pg_temp.task(1)), '%Catatan wajib%'));

-- ---- B. Counting ------------------------------------------------------------
create temp table r1 as select record_move_rack_audit(pg_temp.task(1), 'Sari', 48) as r;
select pg_temp.check('Sesuai: the bin holds what the system says, the line passes as a RACK attempt',
  (select r ->> 'result' from r1) = 'OK'
  and (pg_temp.line(1)).line_state = 'OK'
  and (select method = 'RACK' and rack_system = 48 and rack_counted = 48 and counted_qty = 24
       from pick_audits where task_id = pg_temp.task(1)));
create temp table r2 as select record_move_rack_audit(pg_temp.task(2), 'Sari', 46, '2 karton tidak ada') as r;
select pg_temp.check('2 short in the bin: the line arrived 22 of 24, a mismatch (short)',
  (select (r ->> 'diff')::numeric from r2) = -2
  and (pg_temp.line(2)).line_state = 'MISMATCH'
  and (select counted_qty = 22 and errors = array['SHORT'] from pick_audits where task_id = pg_temp.task(2)));
select pg_temp.check('a recount that matches passes as attempt 2',
  record_move_rack_audit(pg_temp.task(2), 'Sari', 48) ->> 'attempt' = '2' and (pg_temp.line(2)).line_state = 'OK');
select pg_temp.check('a passed line is not counted again',
  pg_temp.fails(format($q$select record_move_rack_audit(%L, 'Sari', 48)$q$, pg_temp.task(1)), '%sudah lolos%'));

-- ---- C. Ubah ---------------------------------------------------------------
select pg_temp.check('an operator cannot Ubah',
  pg_temp.fails(format($q$select record_move_rack_audit(%L, 'Sari', 48, 'salah', null, true)$q$, pg_temp.task(1)), '%supervisor atau admin%'));
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
create temp table r3 as select record_move_rack_audit(pg_temp.task(1), 'Rina', 48, 'hitung ulang', null, true) as r;
select pg_temp.check('a supervisor Ubah adds attempt 2 marked as correction',
  (select r ->> 'attempt' from r3) = '2'
  and (select correction from pick_audits where task_id = pg_temp.task(1) and attempt_no = 2));

rollback;
