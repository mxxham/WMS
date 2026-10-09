-- Cek sisa bin (0058): ask after a pick that leaves few cartons; a different answer opens a count. Runs in a transaction and rolls back.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users values ('11111111-1111-1111-1111-111111111111','op@x','{"name":"Operator"}') on conflict do nothing;
update profiles set role = 'operator' where id = '11111111-1111-1111-1111-111111111111';
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.fails(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then
  if sqlerrm not like p_like then raise notice 'got: %', sqlerrm; end if;
  return sqlerrm like p_like; end $$;
-- Stock and plan as an admin, then picking as an operator.
update profiles set role = 'admin' where id = '11111111-1111-1111-1111-111111111111';
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select import_snapshot('[
 {"bin_code":"CC25A01","zone":"CC","rack":"25","level":"A","position":"01","sku":"550058593","batch_lot":"TESTB","quantity":9,"expiry_date":"2030-08-08"},
 {"bin_code":"CE28D02","zone":"CE","rack":"28","level":"D","position":"02","sku":"550058592","batch_lot":"TESTB","quantity":44,"expiry_date":"2030-08-05"}]'::jsonb, false, 'uji') \g /dev/null
select save_plan('2026-10-28', '{
  "waves":[{"wave_no":"1","shipment_numbers":["SH1"],"planned_slot":"01:00"}],
  "tasks":[
   {"wave_no":"1","shipment_number":"SH1","task_type":"PICK","sku":"550058593","from_bin":"CC25A01","batch_lot":"TESTB","expiry_date":"2030-08-08","quantity":6,"pick_type":"CASE","seq":1},
   {"wave_no":"1","shipment_number":"SH1","task_type":"PICK","sku":"550058592","from_bin":"CE28D02","batch_lot":"TESTB","expiry_date":"2030-08-05","quantity":10,"pick_type":"CASE","seq":2}],
  "outbound":[]}'::jsonb) \g /dev/null
create or replace function pg_temp.t(p_seq int) returns pick_tasks language sql as $$
  select t.* from pick_tasks t join waves w on w.id = t.wave_id where w.planned_date = '2026-10-28' and t.seq = p_seq $$;
reset role; update profiles set role = 'operator' where id = '11111111-1111-1111-1111-111111111111'; set role authenticated;

select pg_temp.check('nothing to ask before the task is posted', not (bin_left_after((pg_temp.t(1)).id)->>'ask')::boolean);
select post_task_by((pg_temp.t(1)).id, null, null, null, null, null, 'Budi', null) \g /dev/null
select post_task_by((pg_temp.t(2)).id, null, null, null, null, null, 'Budi', null) \g /dev/null
select pg_temp.check('CC25A01: 9 − 6 = 3 left (≤ 5): ask, naming the bin',
  (bin_left_after((pg_temp.t(1)).id)->>'ask')::boolean and bin_left_after((pg_temp.t(1)).id)->>'bin' = 'CC25A01');
select pg_temp.check('CE28D02: 44 − 10 = 34 left: do not ask', not (bin_left_after((pg_temp.t(2)).id)->>'ask')::boolean);

-- The picker sees 1, the system says 3 (5 Oct).
create temp table answer as select record_bin_check((pg_temp.t(1)).id, 1, 'Budi') as r;
select pg_temp.check('a different answer: no match, and a count task on CC25A01 with both numbers',
  not ((select r from answer)->>'match')::boolean
  and exists (select 1 from count_tasks c join bins b on b.id = c.bin_id where b.bin_code = 'CC25A01' and c.status = 'OPEN'
              and c.reason like '%Cek sisa setelah NO 1 #1: sistem 3, dilihat 1%'));
select pg_temp.check('the answer is logged; stock is not changed by it',
  exists (select 1 from bin_checks where task_id = (pg_temp.t(1)).id and expected = 3 and seen = 1 and by_name = 'Budi')
  and (select sum(v.quantity) from inventory v join bins b on b.id = v.bin_id where b.bin_code = 'CC25A01' and v.batch_lot = 'TESTB') = 3);
create temp table answer2 as select record_bin_check((pg_temp.t(2)).id, 34, 'Budi') as r;
select pg_temp.check('a matching answer is logged as a match, no new count',
  ((select r from answer2)->>'match')::boolean
  and not exists (select 1 from count_tasks c join bins b on b.id = c.bin_id where b.bin_code = 'CE28D02' and c.status = 'OPEN'));
select pg_temp.check('a negative or fractional answer is refused',
  pg_temp.fails(format($q$select record_bin_check(%L, -1, 'Budi')$q$, (pg_temp.t(1)).id), '%Isi jumlah%')
  and pg_temp.fails(format($q$select record_bin_check(%L, 1.5, 'Budi')$q$, (pg_temp.t(1)).id), '%Isi jumlah%'));
select pg_temp.check('the threshold is a policy value (default 5); the picking audit target (0024) is kept',
  (inventory_policy()->>'bin_check_max_qty')::numeric = 5 and (inventory_policy()->>'pick_accuracy_target_pct')::numeric = 99.5);
rollback;
