-- Relocation carries what is really left (0033). Runs in a transaction and rolls back.
-- Run with scripts/sql-test.sh. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users values ('11111111-1111-1111-1111-111111111111','op@x','{"name":"Operator"}') on conflict do nothing;
update profiles set role = 'admin' where id = '11111111-1111-1111-1111-111111111111';

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.fails(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then
  if sqlerrm not like p_like then raise notice 'got: %', sqlerrm; end if;
  return sqlerrm like p_like; end $$;
create or replace function pg_temp.qty(p_bin text) returns numeric language sql as $$
  select coalesce(sum(i.quantity), 0) from inventory i join bins b on b.id = i.bin_id where b.bin_code = p_bin $$;
create or replace function pg_temp.task(p_type text) returns uuid language sql as $$
  select t.id from pick_tasks t join waves w on w.id = t.wave_id where w.planned_date = '2026-10-12' and t.task_type = p_type $$;

-- Fixture: a pallet of 44 in CF38C01 (like CC32C02 on 29 Sep), 1 already in the pickface CF38C02.
delete from inventory where bin_id in (select id from bins where bin_code in ('CF38C01', 'CF38C02'));
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
select 'adjustment', (select id from items where sku = '550044709'), 'H18', q, (select id from bins where bin_code = b), '2030-08-18', 'fixture'
from (values ('CF38C01', 44), ('CF38C02', 1)) v(b, q);

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select save_plan('2026-10-12', '{
  "waves":[{"wave_no":"4","shipment_numbers":["S65"]}],
  "tasks":[
    {"wave_no":"4","shipment_number":"S65","task_type":"PICK","sku":"550044709","from_bin":"CF38C01","batch_lot":"H18","expiry_date":"2030-08-18","quantity":32,"seq":1},
    {"wave_no":"4","task_type":"REPLENISH","sku":"550044709","from_bin":"CF38C01","to_bin":"CF38C02","batch_lot":"H18","expiry_date":"2030-08-18","quantity":12,"seq":2}],
  "outbound":[{"wave_no":"4","shipment_number":"S65","sku":"550044709","quantity_requested":32,"quantity_allocated":32}]}'::jsonb);

select pg_temp.check('pick still capped at the planned quantity',
  pg_temp.fails(format($q$select post_task_by(%L, 33, null, null, null, 'x', 'Budi')$q$, pg_temp.task('PICK')), 'Jumlah aktual harus%'));
select post_task_by(pg_temp.task('PICK'), 15, null, null, null, 'hanya butuh 15', 'Budi');
select pg_temp.check('pick 15 of 32 leaves 29 in the pallet bin', pg_temp.qty('CF38C01') = 29);
select pg_temp.check('relocation cannot move more than the bin holds',
  pg_temp.fails(format($q$select post_task_by(%L, 30, null, null, null, 'semua', 'Budi')$q$, pg_temp.task('REPLENISH')), '%'));
select pg_temp.check('relocation posts everything left (29, planned 12)',
  (post_task_by(pg_temp.task('REPLENISH'), 29, null, null, null, 'sisa setelah pick 15', 'Budi')->>'quantity')::numeric = 29);
select pg_temp.check('pallet bin empty, pickface 1 + 29 = 30', pg_temp.qty('CF38C01') = 0 and pg_temp.qty('CF38C02') = 30);

rollback;
