-- Split an open pick in two (0046). Runs in a transaction and rolls back.
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
delete from inventory where bin_id in (select id from bins where bin_code in ('CF38D02', 'CF38A01'));
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
select 'adjustment', (select id from items where sku = '550044709'), b, q, (select id from bins where bin_code = l), e::date, 'fixture'
from (values ('CF38D02', '18I', 36, '2030-09-18'), ('CF38A01', '17I', 25, '2030-09-17')) v(l, b, q, e);
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select save_plan('2026-10-25', '{
  "waves":[{"wave_no":"3","shipment_numbers":["109694908"]}],
  "tasks":[{"wave_no":"3","shipment_number":"109694908","task_type":"PICK","sku":"550044709","from_bin":"CF38D02","batch_lot":"18I","expiry_date":"2030-09-18","quantity":36,"seq":8},
           {"wave_no":"3","shipment_number":"109694908","task_type":"PICK","sku":"550044709","from_bin":"CF38D02","batch_lot":"18I","expiry_date":"2030-09-18","quantity":0.5,"seq":9}],
  "outbound":[{"wave_no":"3","shipment_number":"109694908","sku":"550044709","quantity_requested":36,"quantity_allocated":36}]}'::jsonb);
create or replace function pg_temp.t(p_seq int) returns pick_tasks language sql as $$
  select t.* from pick_tasks t join waves w on w.id = t.wave_id where w.planned_date = '2026-10-25' and t.seq = p_seq $$;
select pg_temp.check('keep must be 1..35', pg_temp.fails(format($q$select split_task(%L, 36, 'Budi')$q$, (pg_temp.t(8)).id), '%1 sampai 35%'));
select pg_temp.check('split 36 -> 23 + 13', split_task((pg_temp.t(8)).id, 23, 'Budi') @> '{"kept":23,"new_qty":13,"new_seq":9}');
select pg_temp.check('the new part sits right after, the later task moved down',
  (pg_temp.t(8)).quantity = 23 and (pg_temp.t(9)).quantity = 13 and (pg_temp.t(9)).shipment_number = '109694908' and (pg_temp.t(10)).quantity = 0.5);
select pg_temp.check('23 from CF38D02 as planned', (post_task_by((pg_temp.t(8)).id, p_by_name => 'Budi')->>'result') = 'POSTED');
select pg_temp.check('13 from the other bin (Berbeda)',
  (post_task_by((pg_temp.t(9)).id, 13, 'CF38A01', '17I', '2030-09-17', 'diambil dari CF38A01', 'Budi')->>'result') = 'POSTED');
select pg_temp.check('order picked 36 in total',
  (select quantity_picked from outbound o join waves w on w.id = o.wave_id where w.planned_date = '2026-10-25') = 36);
rollback;
