-- Perubahan lokasi (0130): every change of a pick's location is one row, whichever path made it.
-- Runs in a transaction and rolls back. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users values ('22222222-2222-2222-2222-222222222222','sup@x','{"name":"Supervisor"}') on conflict do nothing;
update profiles set role = 'admin' where id = '22222222-2222-2222-2222-222222222222';
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when coalesce(ok, false) then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.fails(p_sql text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return true; end $$;
delete from inventory v using items i where i.id = v.item_id and i.sku = '550058593';
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
-- CC27D02 holds 48 of batch A; CE11A01 30 of batch B, which expires later.
select import_snapshot('[
 {"bin_code":"CC27D02","zone":"CC","rack":"27","level":"D","position":"02","sku":"550058593","batch_lot":"A","quantity":48,"expiry_date":"2030-09-10"},
 {"bin_code":"CE11A01","zone":"CE","rack":"11","level":"A","position":"01","sku":"550058593","batch_lot":"B","quantity":30,"expiry_date":"2030-12-01"}]'::jsonb, false, 'uji91') \g /dev/null
select save_plan('2026-12-05', '{
  "waves":[{"wave_no":"1","shipment_numbers":["S1"],"planned_slot":"08:00"},
           {"wave_no":"2","shipment_numbers":["S2"],"planned_slot":"10:00"},
           {"wave_no":"3","shipment_numbers":["S3"],"planned_slot":"14:30"}],
  "tasks":[
   {"wave_no":"1","shipment_number":"S1","task_type":"PICK","sku":"550058593","from_bin":"CC27D02","batch_lot":"A","expiry_date":"2030-09-10","quantity":20,"pick_type":"CASE","breaks_pallet":true,"seq":1},
   {"wave_no":"2","shipment_number":"S2","task_type":"PICK","sku":"550058593","from_bin":"CC27D02","batch_lot":"A","expiry_date":"2030-09-10","quantity":16,"pick_type":"CASE","seq":1},
   {"wave_no":"3","shipment_number":"S3","task_type":"PICK","sku":"550058593","from_bin":"CC27D02","batch_lot":"A","expiry_date":"2030-09-10","quantity":12,"pick_type":"CASE","seq":1}]}'::jsonb) \g /dev/null
create or replace function pg_temp.t(p_no text, p_seq int) returns pick_tasks language sql as $$
  select t.* from pick_tasks t join waves w on w.id = t.wave_id where w.planned_date = '2026-12-05' and w.wave_no = p_no and t.seq = p_seq $$;
create or replace function pg_temp.n() returns bigint language sql as $$
  select count(*) from pick_location_changes where planned_date = '2026-12-05' $$;
grant execute on function pg_temp.check(text, boolean), pg_temp.fails(text), pg_temp.t(text, int), pg_temp.n() to authenticated;

select pg_temp.check('planning writes no change', pg_temp.n() = 0);

-- Pindah sisa: the rest of the pallet goes to CE10A02, NO 2 and NO 3 follow it.
select move_rest_with_picks((pg_temp.t('1',1)).id, null, 'CE10A02', 'Sup', 'sisa turun') \g /dev/null
select pg_temp.check('Pindah sisa: one row per following pick, CC27D02 -> CE10A02, named and explained',
  pg_temp.n() = 2
  and (select bool_and(old_bin = 'CC27D02' and new_bin = 'CE10A02' and kind = 'PLAN' and source = 'TRIGGER'
                       and reason like 'ikut Bin To Bin NO 1 #1%' and changed_by_name = 'Supervisor' and not fefo_skipped)
       from pick_location_change_list where planned_date = '2026-12-05'));

-- Ubah baris: NO 3 now from CE11A01, batch B, a later expiry.
select edit_pick_row((pg_temp.t('3',1)).id, null, 'CE11A01', 'B', '2030-12-01', null, null, 'Sup', 'palet B lebih dekat') \g /dev/null
select pg_temp.check('Ubah baris: CE10A02 A -> CE11A01 B, FEFO dilewati, original bin still CC27D02',
  pg_temp.n() = 3
  and exists (select 1 from pick_location_change_list where task_id = (pg_temp.t('3',1)).id and new_bin = 'CE11A01'
              and old_bin = 'CE10A02' and old_batch = 'A' and new_batch = 'B' and new_expiry = '2030-12-01'
              and fefo_skipped and original_bin = 'CC27D02' and reason like 'baris diubah%'));

-- Posting on the planned bin changes no location.
select post_task_by((pg_temp.t('1',1)).id, null, null, null, null, null, 'Sup', 'CC27D02') \g /dev/null
select pg_temp.check('posting from the planned bin writes nothing', pg_temp.n() = 3);

-- The picker took it from somewhere else: the actual bin differs from the plan.
reset role;
update pick_tasks set actual_from_bin_id = (select id from bins where bin_code = 'CE11A01'),
                      actual_batch_lot = 'B', actual_expiry_date = '2030-12-01'
where id = (select id from pg_temp.t('2',1));
set role authenticated;
select pg_temp.check('actual bin differs from the plan: one ACTUAL row',
  pg_temp.n() = 4
  and exists (select 1 from pick_location_changes where task_id = (pg_temp.t('2',1)).id and kind = 'ACTUAL'
              and old_bin = 'CE10A02' and new_bin = 'CE11A01'));

-- Append-only and read-only for the API.
select pg_temp.check('an account cannot write the history',
  pg_temp.fails($q$insert into pick_location_changes (task_id, wave_id, planned_date, wave_no, task_type, sku, quantity, kind)
                   values (gen_random_uuid(), gen_random_uuid(), '2026-12-05', '9', 'PICK', 'x', 1, 'PLAN')$q$));
reset role;
select pg_temp.check('nobody can change a row', pg_temp.fails($q$update pick_location_changes set new_bin = 'X' where planned_date = '2026-12-05'$q$));
select pg_temp.check('nobody can delete a row', pg_temp.fails($q$delete from pick_location_changes where planned_date = '2026-12-05'$q$));

-- The history outlives its wave (no foreign key to pick_tasks).
delete from waves where planned_date = '2026-12-05' and wave_no = '3';
select pg_temp.check('deleting the waves keeps the history', pg_temp.n() = 4);

-- The reader of old Riwayat sentences (used once in 0130 for changes made before it).
select pg_temp.check('old Ubah baris sentence parses, empty batch included',
  (regexp_match('baris diubah oleh Sup: sumber CC27D02  exp 2030-09-10 → CE11A01 B exp 2030-12-01; FEFO dilewati: x',
    'sumber ([A-Za-z0-9_-]+) +(\S*) *exp (\d{4}-\d{2}-\d{2}) → ([A-Za-z0-9_-]+) +(\S*) *exp (\d{4}-\d{2}-\d{2})'))
  = array['CC27D02', '', '2030-09-10', 'CE11A01', 'B', '2030-12-01']);
select pg_temp.check('old ikut palet sentence parses: bukan = original, ke = new',
  (regexp_match('ikut palet: Bin To Bin NO 2 #3 ke CE10A02, bukan CC27D02; pick ini sekarang dari CE10A02',
    '^ikut palet: .* ke ([A-Za-z0-9_-]+), bukan ([A-Za-z0-9_-]+);')) = array['CE10A02', 'CC27D02']);

rollback;
