-- A pick whose cartons are in another bin than the books say (0039). Runs in a transaction and rolls back.
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
  select coalesce(sum(i.quantity), 0) from inventory i join bins b on b.id = i.bin_id
  join items it on it.id = i.item_id where b.bin_code = p_bin and it.sku = '550044709' $$;

-- The books: 3 in CF38C01 (like CB21A02); the cartons are really in CF38C02 (like CB23A01).
delete from inventory where bin_id in (select id from bins where bin_code in ('CF38C01', 'CF38C02'));
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
select 'adjustment', (select id from items where sku = '550044709'), '12700817', 3, (select id from bins where bin_code = 'CF38C01'), '2030-09-10', 'fixture';
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select save_plan('2026-10-23', '{
  "waves":[{"wave_no":"7","shipment_numbers":["109693343"]}],
  "tasks":[{"wave_no":"7","shipment_number":"109693343","task_type":"PICK","sku":"550044709","from_bin":"CF38C01","batch_lot":"12700817","expiry_date":"2030-09-10","quantity":3,"seq":3}],
  "outbound":[{"wave_no":"7","shipment_number":"109693343","sku":"550044709","quantity_requested":3,"quantity_allocated":3}]}'::jsonb);
create or replace function pg_temp.t() returns pick_tasks language sql as $$
  select t.* from pick_tasks t join waves w on w.id = t.wave_id where w.planned_date = '2026-10-23' $$;

select pg_temp.check('found elsewhere: reason required',
  pg_temp.fails(format($q$select post_task_found_elsewhere(%L, 'CF38C02', 3, ' ', 'Budi')$q$, (pg_temp.t()).id), '%Alasan%'));
select pg_temp.check('found elsewhere: unknown bin refused',
  pg_temp.fails(format($q$select post_task_found_elsewhere(%L, 'ZZ99Z99', 3, 'x', 'Budi')$q$, (pg_temp.t()).id), '%tidak ada%'));
select pg_temp.check('found elsewhere: posted, 3 recorded as moved first',
  post_task_found_elsewhere((pg_temp.t()).id, 'cf38c02', 3, 'barang ada di CF38C02', 'Budi') @> '{"result":"POSTED","moved_on_books":3}');
select pg_temp.check('both bins end at 0; the pick is from the typed bin',
  pg_temp.qty('CF38C01') = 0 and pg_temp.qty('CF38C02') = 0
  and (select b.bin_code from bins b where b.id = (pg_temp.t()).actual_from_bin_id) = 'CF38C02');
select pg_temp.check('the transfer says where the cartons really were',
  exists (select 1 from movements where type = 'transfer' and note like 'Barang ternyata di CF38C02, bukan CF38C01 (pick NO 7 #3)%'));
select pg_temp.check('the planned bin gets a count task',
  exists (select 1 from count_tasks c join bins b on b.id = c.bin_id where b.bin_code = 'CF38C01' and c.source = 'PICK'));

rollback;
