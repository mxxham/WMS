-- Ubah bin pick follows batch and expiry (0050): explicit batch/expiry move with the
-- pick and its paired move; old 4-argument calls keep 0049 behaviour; a target bin
-- that does not hold the resulting identity is refused. Runs in a transaction and rolls back.
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

-- The pallet planned in CF38C01 (15I26JJ) is really in CF38C02 under another batch.
delete from inventory where bin_id in (select id from bins where bin_code in ('CF38C01', 'CF38C02', 'CF38D01', 'CF38D02'));
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
select 'adjustment', (select id from items where sku = '550044709'), '15I26JJ', 20, (select id from bins where bin_code = 'CF38C01'), '2030-09-15', 'fixture';
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
select 'adjustment', (select id from items where sku = '550044709'), '16I26JJ', 30, (select id from bins where bin_code = 'CF38C02'), '2030-10-16', 'fixture';
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
select 'adjustment', (select id from items where sku = '550044709'), '15I26JJ', 10, (select id from bins where bin_code = 'CF38D01'), '2030-09-15', 'fixture';
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
select 'adjustment', (select id from items where sku = '550044709'), '15I26JJ', 10, (select id from bins where bin_code = 'CF38D02'), '2030-09-15', 'fixture';
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select save_plan('2026-10-27', '{
  "waves":[{"wave_no":"7","shipment_numbers":["109694906"]}],
  "tasks":[
    {"wave_no":"7","shipment_number":"109694906","task_type":"PICK","sku":"550044709","from_bin":"CF38C01","batch_lot":"15I26JJ","expiry_date":"2030-09-15","quantity":6,"seq":1},
    {"wave_no":"7","shipment_number":"109694906","task_type":"PICK","sku":"550044709","from_bin":"CF38C01","batch_lot":"15I26JJ","expiry_date":"2030-09-15","quantity":2,"seq":2}],
  "outbound":[{"wave_no":"7","shipment_number":"109694906","sku":"550044709","quantity_requested":8,"quantity_allocated":8}]}'::jsonb) \g /dev/null
create or replace function pg_temp.pk() returns pick_tasks language sql as $$
  select * from pick_tasks where wave_id = (select id from waves where planned_date = '2026-10-27' and wave_no = '7') and task_type = 'PICK' and quantity = 6 $$;
create or replace function pg_temp.pk2() returns pick_tasks language sql as $$
  select * from pick_tasks where wave_id = (select id from waves where planned_date = '2026-10-27' and wave_no = '7') and task_type = 'PICK' and quantity = 2 $$;
create or replace function pg_temp.mv() returns pick_tasks language sql as $$
  select * from pick_tasks where wave_id = (select id from waves where planned_date = '2026-10-27' and wave_no = '7') and task_type = 'REPLENISH' $$;
select add_relocation((pg_temp.pk()).id, 'CF38D02', 14, 'Budi', 'rencana') \g /dev/null

select pg_temp.check('old 4-argument call to a bin without the identity refused, naming batch and expiry',
  pg_temp.fails(format($q$select change_pick_bin(%L, 'CF38C02', 'Budi')$q$, (pg_temp.pk()).id), '%tidak menyimpan batch 15I26JJ exp 2030-09-15%'));
select pg_temp.check('an unknown batch refused',
  pg_temp.fails(format($q$select change_pick_bin(%L, 'CF38C02', 'Budi', null, '99Z99ZZ')$q$, (pg_temp.pk()).id), '%tidak menyimpan batch 99Z99ZZ%'));
select pg_temp.check('a batch the bin holds only under another expiry refused',
  pg_temp.fails(format($q$select change_pick_bin(%L, 'CF38C02', 'Budi', null, '16I26JJ', '2030-09-15')$q$, (pg_temp.pk()).id), '%tidak menyimpan batch 16I26JJ exp 2030-09-15%'));
select pg_temp.check('both rows untouched after the refusals',
  (pg_temp.pk()).from_bin_id = (select id from bins where bin_code = 'CF38C01')
  and (pg_temp.pk()).batch_lot = '15I26JJ' and (pg_temp.pk()).expiry_date = '2030-09-15'
  and (pg_temp.mv()).from_bin_id = (select id from bins where bin_code = 'CF38C01'));
reset role;
update profiles set role = 'operator' where id = '11111111-1111-1111-1111-111111111111';
set role authenticated;
select pg_temp.check('an operator cannot change it even with the new params',
  pg_temp.fails(format($q$select change_pick_bin(%L, 'CF38C02', 'Budi', null, '16I26JJ', '2030-10-16')$q$, (pg_temp.pk()).id), '%Hanya supervisor%'));
reset role;
update profiles set role = 'admin' where id = '11111111-1111-1111-1111-111111111111';
set role authenticated;

select pg_temp.check('explicit nulls without follow keeps batch and leaves the pair alone',
  change_pick_bin((pg_temp.pk2()).id, 'cf38d01', 'Budi', 'tetap batch lama', null, null, false)
    @> jsonb_build_object('to_bin', 'CF38D01', 'batch_lot', '15I26JJ', 'expiry_date', '2030-09-15')
  and (pg_temp.pk2()).from_bin_id = (select id from bins where bin_code = 'CF38D01')
  and (pg_temp.pk2()).batch_lot = '15I26JJ' and (pg_temp.pk2()).expiry_date = '2030-09-15'
  and (pg_temp.mv()).from_bin_id = (select id from bins where bin_code = 'CF38C01'));
select pg_temp.check('re-pointing a pick shown without its pair does not steal the other pick''s move',
  change_pick_bin((pg_temp.pk2()).id, 'cf38d02', 'Budi', 'pindah lagi', null, null, false)
    @> jsonb_build_object('to_bin', 'CF38D02', 'move_id', null)
  and (pg_temp.pk2()).from_bin_id = (select id from bins where bin_code = 'CF38D02')
  and (pg_temp.mv()).from_bin_id = (select id from bins where bin_code = 'CF38C01'));
select pg_temp.check('explicit batch and expiry move with the pick, the paired move follows with its destination kept',
  change_pick_bin((pg_temp.pk()).id, 'cf38c02', 'Budi', 'batch lain di bin ini', '16I26JJ', '2030-10-16')
    @> jsonb_build_object('from_bin', 'CF38C01', 'to_bin', 'CF38C02', 'batch_lot', '16I26JJ', 'expiry_date', '2030-10-16')
  and (pg_temp.pk()).from_bin_id = (select id from bins where bin_code = 'CF38C02')
  and (pg_temp.pk()).batch_lot = '16I26JJ' and (pg_temp.pk()).expiry_date = '2030-10-16'
  and (pg_temp.mv()).from_bin_id = (select id from bins where bin_code = 'CF38C02')
  and (pg_temp.mv()).batch_lot = '16I26JJ' and (pg_temp.mv()).expiry_date = '2030-10-16'
  and (pg_temp.mv()).to_bin_id = (select id from bins where bin_code = 'CF38D02'));
select pg_temp.check('the batch change is in the history',
  exists (select 1 from execution_events where entity_type = 'TASK' and entity_id = (pg_temp.pk()).id
          and reason like '%Budi: CF38C01 → CF38C02 batch 16I26JJ exp 2030-10-16%'));
select pg_temp.check('the re-pointed pick and move still post as one line: 6 out, 14 to CF38D02',
  (post_pick_with_move((pg_temp.pk()).id, (pg_temp.mv()).id, null, null, null, 'Budi')->'move'->>'result') = 'POSTED');
select pg_temp.check('a posted pick cannot be re-pointed',
  pg_temp.fails(format($q$select change_pick_bin(%L, 'CF38C01', 'Budi')$q$, (pg_temp.pk()).id), '%belum diposting%'));
rollback;
