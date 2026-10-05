-- Ubah bin pick: a planned pick and its Bin To Bin move together to the bin that really holds the stock (0049). Runs in a transaction and rolls back.
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

-- The pallet planned in CF38E01 was physically moved to CF38A01; the plan still says CF38E01.
delete from inventory where bin_id in (select id from bins where bin_code in ('CF38E01', 'CF38A01', 'CF38A02', 'CF38B01'));
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
select 'adjustment', (select id from items where sku = '550044709'), '15I26JJ', 44, (select id from bins where bin_code = 'CF38A01'), '2030-09-15', 'fixture';
-- 0050 refuses a target bin that holds none of the pick's identity: CF38B01 must hold it for the re-point below.
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
select 'adjustment', (select id from items where sku = '550044709'), '15I26JJ', 10, (select id from bins where bin_code = 'CF38B01'), '2030-09-15', 'fixture';
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select save_plan('2026-10-26', '{
  "waves":[{"wave_no":"6","shipment_numbers":["109694905"]}],
  "tasks":[
    {"wave_no":"6","shipment_number":"109694905","task_type":"PICK","sku":"550044709","from_bin":"CF38E01","batch_lot":"15I26JJ","expiry_date":"2030-09-15","quantity":6,"seq":1},
    {"wave_no":"6","shipment_number":"109694905","task_type":"PICK","sku":"550044709","from_bin":"CF38E01","batch_lot":"15I26JJ","expiry_date":"2030-09-15","quantity":1,"seq":2}],
  "outbound":[{"wave_no":"6","shipment_number":"109694905","sku":"550044709","quantity_requested":7,"quantity_allocated":7}]}'::jsonb) \g /dev/null
create or replace function pg_temp.pk() returns pick_tasks language sql as $$
  select t.* from pick_tasks t join waves w on w.id = t.wave_id where w.planned_date = '2026-10-26' and t.task_type = 'PICK' and t.quantity = 6 $$;
create or replace function pg_temp.pk2() returns pick_tasks language sql as $$
  select t.* from pick_tasks t join waves w on w.id = t.wave_id where w.planned_date = '2026-10-26' and t.task_type = 'PICK' and t.quantity = 1 $$;
create or replace function pg_temp.mv() returns pick_tasks language sql as $$
  select t.* from pick_tasks t join waves w on w.id = t.wave_id where w.planned_date = '2026-10-26' and t.task_type = 'REPLENISH' $$;
select add_relocation((pg_temp.pk()).id, 'CF38A02', 38, 'Budi', 'rencana') \g /dev/null

select pg_temp.check('an unknown bin refused',
  pg_temp.fails(format($q$select change_pick_bin(%L, 'ZZ99Z99', 'Budi')$q$, (pg_temp.pk()).id), '%tidak ada%'));
select pg_temp.check('a blocked bin refused',
  pg_temp.fails(format($q$select change_pick_bin(%L, 'QUARANTINE', 'Budi')$q$, (pg_temp.pk()).id), '%diblokir%'));
select pg_temp.check('re-pointing to the planned bin refused',
  pg_temp.fails(format($q$select change_pick_bin(%L, 'CF38E01', 'Budi')$q$, (pg_temp.pk()).id), '%sama dengan bin rencana%'));
select pg_temp.check('re-pointing to the move destination refused',
  pg_temp.fails(format($q$select change_pick_bin(%L, 'CF38A02', 'Budi')$q$, (pg_temp.pk()).id), '%sama dengan tujuan Bin To Bin%'));
select pg_temp.check('both rows untouched after the refusals',
  (pg_temp.pk()).from_bin_id = (select id from bins where bin_code = 'CF38E01')
  and (pg_temp.mv()).from_bin_id = (select id from bins where bin_code = 'CF38E01'));
reset role;
update profiles set role = 'operator' where id = '11111111-1111-1111-1111-111111111111';
set role authenticated;
select pg_temp.check('an operator cannot change it',
  pg_temp.fails(format($q$select change_pick_bin(%L, 'CF38A01', 'Budi')$q$, (pg_temp.pk()).id), '%Hanya supervisor%'));
reset role;
update profiles set role = 'admin' where id = '11111111-1111-1111-1111-111111111111';
set role authenticated;

select pg_temp.check('the pick and its move both re-point to CF38A01, the move keeps its destination',
  change_pick_bin((pg_temp.pk()).id, 'cf38a01', 'Budi', 'palet dipindah')
    @> jsonb_build_object('task_id', (pg_temp.pk()).id, 'from_bin', 'CF38E01', 'to_bin', 'CF38A01',
                          'move_id', (pg_temp.mv()).id, 'move_from_bin', 'CF38E01')
  and (pg_temp.pk()).from_bin_id = (select id from bins where bin_code = 'CF38A01')
  and (pg_temp.mv()).from_bin_id = (select id from bins where bin_code = 'CF38A01')
  and (pg_temp.mv()).to_bin_id = (select id from bins where bin_code = 'CF38A02'));
select pg_temp.check('item, batch, expiry, quantity and seq unchanged (FEFO intact)',
  (pg_temp.pk()).item_id = (select id from items where sku = '550044709')
  and (pg_temp.pk()).batch_lot = '15I26JJ'
  and (pg_temp.pk()).expiry_date = '2030-09-15'
  and (pg_temp.pk()).quantity = 6
  and (pg_temp.pk()).seq = 1);
select pg_temp.check('the change is in the history',
  exists (select 1 from execution_events where entity_type = 'TASK' and entity_id = (pg_temp.pk()).id
          and from_status = 'PLANNED' and to_status = 'PLANNED'
          and reason like '%Budi: CF38E01 → CF38A01: palet dipindah%'));
select pg_temp.check('a second pick cannot join the move already open from CF38A01',
  pg_temp.fails(format($q$select change_pick_bin(%L, 'CF38A01', 'Budi')$q$, (pg_temp.pk2()).id), '%Sudah ada Bin To Bin%'));
select pg_temp.check('the second pick untouched after the refusal',
  (pg_temp.pk2()).from_bin_id = (select id from bins where bin_code = 'CF38E01'));
select pg_temp.check('a pick with no paired move is re-pointed on its own',
  change_pick_bin((pg_temp.pk2()).id, 'cf38b01', 'Budi', 'tanpa Bin To Bin')
    @> jsonb_build_object('task_id', (pg_temp.pk2()).id, 'from_bin', 'CF38E01', 'to_bin', 'CF38B01',
                          'move_id', null, 'move_from_bin', null)
  and (pg_temp.pk2()).from_bin_id = (select id from bins where bin_code = 'CF38B01'));
select pg_temp.check('the re-pointed pick and move still post as one line: 6 out, 38 to CF38A02',
  (post_pick_with_move((pg_temp.pk()).id, (pg_temp.mv()).id, null, null, null, 'Budi')->'move'->>'result') = 'POSTED'
  and pg_temp.qty('CF38A01') = 0 and pg_temp.qty('CF38A02') = 38 and pg_temp.qty('CF38E01') = 0);
select pg_temp.check('a posted pick cannot be re-pointed',
  pg_temp.fails(format($q$select change_pick_bin(%L, 'CF38E01', 'Budi')$q$, (pg_temp.pk()).id), '%belum diposting%'));
rollback;
