-- Pindah sisa + pick berikutnya (0127): a triple pick from one pallet, the rest brought down for the later picks.
-- Runs in a transaction and rolls back. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users values ('22222222-2222-2222-2222-222222222222','sup@x','{"name":"Supervisor"}') on conflict do nothing;
update profiles set role = 'admin' where id = '22222222-2222-2222-2222-222222222222';
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.fails(p_sql text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return true; end $$;
-- The seed's own stock of the SKU is cleared, so the numbers are the incident's.
delete from inventory v using items i where i.id = v.item_id and i.sku = '550058593';
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
-- 3 Nov: CC27D02 holds 48. 109759868 (08:00) takes 20, NO 109757797 (10:00) 16, 109760403 (14:30) 12.
select import_snapshot('[
 {"bin_code":"CC27D02","zone":"CC","rack":"27","level":"D","position":"02","sku":"550058593","batch_lot":"10I26JJ","quantity":48,"expiry_date":"2030-09-10"}]'::jsonb, false, 'uji') \g /dev/null
select save_plan('2026-12-03', '{
  "waves":[{"wave_no":"1","shipment_numbers":["109759868"],"planned_slot":"08:00"},
           {"wave_no":"2","shipment_numbers":["109757797"],"planned_slot":"10:00"},
           {"wave_no":"3","shipment_numbers":["109760403"],"planned_slot":"14:30"}],
  "tasks":[
   {"wave_no":"1","shipment_number":"109759868","task_type":"PICK","sku":"550058593","from_bin":"CC27D02","batch_lot":"10I26JJ","expiry_date":"2030-09-10","quantity":20,"pick_type":"CASE","breaks_pallet":true,"seq":1},
   {"wave_no":"2","shipment_number":"109757797","task_type":"PICK","sku":"550058593","from_bin":"CC27D02","batch_lot":"10I26JJ","expiry_date":"2030-09-10","quantity":16,"pick_type":"CASE","seq":1},
   {"wave_no":"3","shipment_number":"109760403","task_type":"PICK","sku":"550058593","from_bin":"CC27D02","batch_lot":"10I26JJ","expiry_date":"2030-09-10","quantity":12,"pick_type":"CASE","seq":1}]}'::jsonb) \g /dev/null
create or replace function pg_temp.t(p_no text, p_seq int) returns pick_tasks language sql as $$
  select t.* from pick_tasks t join waves w on w.id = t.wave_id where w.planned_date = '2026-12-03' and w.wave_no = p_no and t.seq = p_seq $$;
create or replace function pg_temp.bin(p_id uuid) returns text language sql as $$
  select b.bin_code from pick_tasks t join bins b on b.id = t.from_bin_id where t.id = p_id $$;
grant execute on function pg_temp.check(text, boolean), pg_temp.fails(text), pg_temp.t(text, int), pg_temp.bin(uuid) to authenticated;

select pg_temp.check('the last pick of the pallet has nothing after it to move',
  pg_temp.fails(format($q$select move_rest_with_picks(%L, null, 'CE10A02', 'Sup', 'turun')$q$, (pg_temp.t('3',1)).id)));
select pg_temp.check('a reason is required',
  pg_temp.fails(format($q$select move_rest_with_picks(%L, null, 'CE10A02', 'Sup', ' ')$q$, (pg_temp.t('1',1)).id)));

select move_rest_with_picks((pg_temp.t('1',1)).id, null, 'CE10A02', 'Sup', 'triple pick: sisa turun ke CE10A02') \g /dev/null
select pg_temp.check('NO 1: pick 20 stays on CC27D02, the rest 28 moves to CE10A02 right after it',
  pg_temp.bin((pg_temp.t('1',1)).id) = 'CC27D02' and (pg_temp.t('1',1)).quantity = 20
  and (pg_temp.t('1',2)).task_type = 'REPLENISH' and (pg_temp.t('1',2)).quantity = 28
  and pg_temp.bin((pg_temp.t('1',2)).id) = 'CC27D02'
  and (select bin_code from bins where id = (pg_temp.t('1',2)).to_bin_id) = 'CE10A02');
select pg_temp.check('NO 2 and NO 3 now pick from CE10A02, same batch and expiry',
  pg_temp.bin((pg_temp.t('2',1)).id) = 'CE10A02' and pg_temp.bin((pg_temp.t('3',1)).id) = 'CE10A02'
  and (pg_temp.t('2',1)).batch_lot = '10I26JJ' and (pg_temp.t('3',1)).expiry_date = '2030-09-10');
select pg_temp.check('each moved pick logs why (Riwayat)',
  (select count(*) from execution_events where entity_id in ((pg_temp.t('2',1)).id, (pg_temp.t('3',1)).id)
   and reason like 'ikut Bin To Bin NO 1 #1: sisa 28 dari CC27D02 ke CE10A02%') = 2);
select pg_temp.check('no stock moved by planning',
  (select sum(quantity) from inventory v join bins b on b.id = v.bin_id join items i on i.id = v.item_id
   where b.bin_code = 'CC27D02' and i.sku = '550058593') = 48
  and not exists (select 1 from inventory v join bins b on b.id = v.bin_id where b.bin_code = 'CE10A02' and v.quantity > 0));
select pg_temp.check('a second call finds no later pick on CC27D02 any more',
  pg_temp.fails(format($q$select move_rest_with_picks(%L, %L, 'CE10A01', 'Sup', 'lagi')$q$, (pg_temp.t('1',1)).id, (pg_temp.t('1',2)).id)));

-- On the floor: pick, move, then the later picks from CE10A02.
select post_task_by((pg_temp.t('1',1)).id, null, null, null, null, null, 'Sup', 'CC27D02') \g /dev/null
select post_task_by((pg_temp.t('1',2)).id, null, null, null, null, null, 'Sup', 'CC27D02') \g /dev/null
select post_task_by((pg_temp.t('2',1)).id, null, null, null, null, null, 'Sup', 'CE10A02') \g /dev/null
select post_task_by((pg_temp.t('3',1)).id, null, null, null, null, null, 'Sup', 'CE10A02') \g /dev/null
select pg_temp.check('all four post; CC27D02 and CE10A02 end empty',
  (select bool_and(t.status = 'COMPLETED') from pick_tasks t join waves w on w.id = t.wave_id where w.planned_date = '2026-12-03')
  and not exists (select 1 from inventory v join bins b on b.id = v.bin_id join items i on i.id = v.item_id
                  where b.bin_code in ('CC27D02', 'CE10A02') and i.sku = '550058593' and v.quantity > 0));

rollback;
