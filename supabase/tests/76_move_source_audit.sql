-- Bin To Bin source-bin audit (0114). Runs in a transaction and rolls back.
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

-- ---- A. View: both sides, both racks --------------------------------------
select pg_temp.check('view keeps the destination columns and adds from_state TODO',
  (pg_temp.line(1)).to_bin = 'CF38C02' and (pg_temp.line(1)).from_bin = 'CF38C01'
  and (pg_temp.line(1)).line_state = 'TODO' and (pg_temp.line(1)).from_state = 'TODO' and (pg_temp.line(1)).from_attempts = 0);
select pg_temp.check('a move of 0 needs no source check (AUTO_PASS)', (pg_temp.line(3)).from_state = 'AUTO_PASS');
select pg_temp.check('an unposted move is not listed', pg_temp.line(4) is null);

-- ---- B. Rules -------------------------------------------------------------
select pg_temp.check('the mover cannot check the source bin',
  pg_temp.fails(format($q$select record_move_source_audit(%L, 'Budi Santoso', 48)$q$, pg_temp.task(1)), '%petugas pindah%'));
select pg_temp.check('a move of 0 is refused',
  pg_temp.fails(format($q$select record_move_source_audit(%L, 'Sari', 0)$q$, pg_temp.task(3)), '%tidak dipindah (0)%'));
select pg_temp.check('an unposted move is refused',
  pg_temp.fails(format($q$select record_move_source_audit(%L, 'Sari', 0)$q$, pg_temp.task(4)), '%belum selesai%'));
select pg_temp.check('a short count without a note is refused',
  pg_temp.fails(format($q$select record_move_source_audit(%L, 'Sari', 46)$q$, pg_temp.task(1)), '%Catatan wajib%'));
select pg_temp.check('a negative count is refused',
  pg_temp.fails(format($q$select record_move_source_audit(%L, 'Sari', -1)$q$, pg_temp.task(1)), '%tidak valid%'));

-- ---- C. Counting ----------------------------------------------------------
select pg_temp.check('a short count is a mismatch against 48 in the bin',
  (record_move_source_audit(pg_temp.task(1), 'Sari', 46, '2 karton tidak ada') ->> 'system')::numeric = 48
  and (pg_temp.line(1)).from_state = 'MISMATCH' and (pg_temp.line(1)).from_counted = 46);
select pg_temp.check('the destination audit is untouched by the source count', (pg_temp.line(1)).line_state = 'TODO' and (pg_temp.line(1)).attempts = 0);
select pg_temp.check('a recount that matches passes as attempt 2',
  record_move_source_audit(pg_temp.task(1), 'Sari', 48) ->> 'result' = 'OK'
  and (pg_temp.line(1)).from_state = 'OK' and (pg_temp.line(1)).from_attempts = 2);
select pg_temp.check('a passed source bin is not counted again',
  pg_temp.fails(format($q$select record_move_source_audit(%L, 'Sari', 48)$q$, pg_temp.task(1)), '%sudah lolos%'));
select pg_temp.check('the right count with another SKU in the bin is a mismatch',
  record_move_source_audit(pg_temp.task(2), 'Sari', 48, 'oli lain di bin', '550024919') ->> 'result' = 'MISMATCH'
  and (pg_temp.line(2)).from_found_sku = '550024919');
select pg_temp.check('another SKU without a note is refused',
  pg_temp.fails(format($q$select record_move_source_audit(%L, 'Sari', 48, null, '550024919')$q$, pg_temp.task(2)), '%Catatan wajib%'));

-- ---- D. Ubah, and the ledger is append-only --------------------------------
select pg_temp.check('an operator cannot Ubah a passed source count',
  pg_temp.fails(format($q$select record_move_source_audit(%L, 'Sari', 48, 'salah', null, true)$q$, pg_temp.task(1)), '%supervisor atau admin%'));
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select pg_temp.check('a supervisor Ubah needs a reason',
  pg_temp.fails(format($q$select record_move_source_audit(%L, 'Rina', 48, null, null, true)$q$, pg_temp.task(1)), '%Alasan ubah%'));
select pg_temp.check('a supervisor Ubah adds attempt 3 marked as correction',
  record_move_source_audit(pg_temp.task(1), 'Rina', 48, 'hitung ulang', null, true) ->> 'attempt' = '3'
  and (pg_temp.line(1)).from_correction);
do $$ begin update move_source_audits set counted_qty = 0; exception when others then null; end $$;
select pg_temp.check('a source audit cannot be edited by a user (no write policy)',
  not exists (select 1 from move_source_audits where counted_qty = 0));
reset role;
select pg_temp.check('a source audit cannot be deleted, even by the table owner',
  pg_temp.fails($q$delete from move_source_audits$q$, '%tidak bisa diubah atau dihapus%'));

rollback;
