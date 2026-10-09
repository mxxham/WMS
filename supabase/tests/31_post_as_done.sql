-- Posting sesuai lapangan (0056): correct the row and post it, all or nothing. Runs in a transaction and rolls back.
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
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
create or replace function pg_temp.qty(p_bin text) returns numeric language sql as $$
  select coalesce(sum(v.quantity), 0) from inventory v join bins b on b.id = v.bin_id where b.bin_code = p_bin and v.batch_lot = 'TESTB' $$;
select import_snapshot('[
 {"bin_code":"CE28D02","zone":"CE","rack":"28","level":"D","position":"02","sku":"550058592","batch_lot":"TESTB","quantity":44,"expiry_date":"2030-08-05"},
 {"bin_code":"CF39A02","zone":"CF","rack":"39","level":"A","position":"02","sku":"550044709","batch_lot":"TESTB","quantity":33,"expiry_date":"2030-09-14"}]'::jsonb, false, 'uji') \g /dev/null
select save_plan('2026-10-26', '{
  "waves":[{"wave_no":"6","shipment_numbers":["SH6"],"planned_slot":"03:22"}],
  "tasks":[
   {"wave_no":"6","shipment_number":"SH6","task_type":"PICK","sku":"550058592","from_bin":"CE28D02","batch_lot":"TESTB","expiry_date":"2030-08-05","quantity":15,"pick_type":"CASE","breaks_pallet":true,"seq":5},
   {"wave_no":"6","task_type":"REPLENISH","sku":"550058592","from_bin":"CE28D02","to_bin":"CE30A02","batch_lot":"TESTB","expiry_date":"2030-08-05","quantity":19,"pick_type":"CASE","breaks_pallet":true,"seq":6},
   {"wave_no":"6","shipment_number":"SH6","task_type":"PICK","sku":"550044709","from_bin":"CF40C01","batch_lot":"TESTB","expiry_date":"2030-09-14","quantity":2,"pick_type":"CASE","seq":7}],
  "outbound":[{"wave_no":"6","shipment_number":"SH6","sku":"550058592","quantity_requested":15,"quantity_allocated":15}]}'::jsonb) \g /dev/null
create or replace function pg_temp.t(p_seq int) returns pick_tasks language sql as $$
  select t.* from pick_tasks t join waves w on w.id = t.wave_id where w.planned_date = '2026-10-26' and t.seq = p_seq $$;

reset role; update bins set status = 'blocked' where bin_code = 'CE31A02'; set role authenticated;
select pg_temp.check('a rest sent to a blocked bin: refused, and NOTHING is posted',
  pg_temp.fails(format($q$select post_as_done(%L, %L, 'CE28D02', 'TESTB', '2030-08-05', 15, 'CE31A02', 29, 'Ilham', 'ikut picklist')$q$, (pg_temp.t(5)).id, (pg_temp.t(6)).id), '%diblokir%')
  and (pg_temp.t(5)).status = 'PLANNED' and pg_temp.qty('CE28D02') = 44);
select pg_temp.check('a reason is required',
  pg_temp.fails(format($q$select post_as_done(%L, %L, 'CE28D02', 'TESTB', '2030-08-05', 15, 'CE30A02', 29, 'Ilham', ' ')$q$, (pg_temp.t(5)).id, (pg_temp.t(6)).id), '%Alasan wajib%'));

-- The paper: 15 from CE28D02, the whole rest 29 to CE30A02 (the plan said 19).
select post_as_done((pg_temp.t(5)).id, (pg_temp.t(6)).id, 'CE28D02', 'TESTB', '2030-08-05', 15, 'CE30A02', 29, 'Ilham', 'ikut picklist cetak') \g /dev/null
select pg_temp.check('pick and its corrected Bin To Bin posted together: pallet 44 − 15 − 29 = 0, pickface 29',
  (pg_temp.t(5)).status = 'COMPLETED' and (pg_temp.t(6)).status = 'COMPLETED' and (pg_temp.t(6)).quantity = 29
  and pg_temp.qty('CE28D02') = 0 and pg_temp.qty('CE30A02') = 29);
select pg_temp.check('the correction is logged with the reason',
  exists (select 1 from execution_events where entity_id = (pg_temp.t(5)).id and reason like 'baris diubah oleh Ilham%Bin To Bin CE30A02 (19) → CE30A02 (29)%sesuai lapangan: ikut picklist cetak'));

-- A pick taken from another bin: CF40C01 was empty, the 2 came from CF39A02.
select post_as_done((pg_temp.t(7)).id, null, 'CF39A02', 'TESTB', '2030-09-14', 2, null, null, 'Ilham', 'CF40C01 kosong') \g /dev/null
select pg_temp.check('a single pick from another bin: corrected and posted, CF39A02 33 → 31',
  (pg_temp.t(7)).status = 'COMPLETED' and pg_temp.qty('CF39A02') = 31);

reset role; update profiles set role = 'operator' where id = '11111111-1111-1111-1111-111111111111'; set role authenticated;
select pg_temp.check('an operator cannot use it (Posting / Berbeda stay theirs)',
  pg_temp.fails(format($q$select post_as_done(%L, null, 'CF39A02', 'TESTB', '2030-09-14', 2, null, null, 'Budi', 'x')$q$, (pg_temp.t(7)).id), '%Hanya supervisor%'));
rollback;
