-- 0078: three gaps left after 0074-0077. Runs in a transaction and rolls back; every line prints PASS/FAIL.
--  A. pick posted alone, relokasi planned, wave cancelled -> the loose rest rests at level D for good
--  B. restore_wave must not bring back an outbound line whose picks were all skipped (pallet break posted)
--  C. pair rule: both neighbours of a pick are posted moves -> the NEXT one (seq+1) is the pair, as on the wave page
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111','sup@x','{"name":"Supervisor"}') on conflict do nothing;
update profiles set role = 'admin' where id = '11111111-1111-1111-1111-111111111111';
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.qty(p_bin text) returns numeric language sql as $$
  select coalesce(sum(i.quantity), 0) from inventory i join bins b on b.id = i.bin_id
  join items it on it.id = i.item_id where b.bin_code = p_bin and it.sku = '550070614' $$;
create or replace function pg_temp.t(p_date text, p_wave text, p_seq int) returns uuid language sql as $$
  select t.id from pick_tasks t join waves w on w.id = t.wave_id
  where w.planned_date = p_date::date and w.wave_no = p_wave and t.seq = p_seq $$;
create or replace function pg_temp.w(p_date text, p_wave text) returns uuid language sql as $$
  select id from waves where planned_date = p_date::date and wave_no = p_wave $$;
create or replace function pg_temp.flagged(p_kind text) returns int language sql as $$
  select count(*)::int from stranded_residue where sku = '550070614' and kind = p_kind $$;
grant execute on function pg_temp.check(text, boolean), pg_temp.qty(text), pg_temp.t(text, text, int),
  pg_temp.w(text, text), pg_temp.flagged(text) to authenticated;

update items set upp = 48 where sku = '550070614';
delete from inventory where item_id = (select id from items where sku = '550070614')
  and bin_id in (select id from bins where bin_code in ('CB01A01','CB01A02','CB01D01','CB01D02','CB01B01','CB11A01','CB11A02'));
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
select 'inbound', (select id from items where sku = '550070614'), 'RW1', q, (select id from bins where bin_code = b), '2030-09-01', 'fixture'
from (values ('CB01D01', 48), ('CB01D02', 48), ('CB01B01', 48), ('CB11A01', 48)) v(b, q);

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

-- ---------------------------------------------------------------- A
-- Wave 1 (date 2026-11-30): pick 8 + relokasi 40 from CB01D01 (reserve, level D).
-- Wave 2 (date 2026-11-29): the same on CB11A01, a level-A source, which legitimately holds loose cartons.
select save_plan('2026-11-30', '{"waves":[{"wave_no":"1","shipment_numbers":["109722231"],"planned_slot":"00:52"}],
 "tasks":[
 {"wave_no":"1","shipment_number":"109722231","task_type":"PICK","sku":"550070614","from_bin":"CB01D01","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":8,"pick_type":"CASE","breaks_pallet":true,"seq":1},
 {"wave_no":"1","task_type":"REPLENISH","sku":"550070614","from_bin":"CB01D01","to_bin":"CB01A01","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":40,"pick_type":"CASE","breaks_pallet":true,"seq":2}]}'::jsonb) \g /dev/null
reset role; drop table if exists pg_temp._replace, pg_temp._wave_ids; set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select save_plan('2026-11-29', '{"waves":[{"wave_no":"1","shipment_numbers":["109721549"],"planned_slot":"00:52"}],
 "tasks":[
 {"wave_no":"1","shipment_number":"109721549","task_type":"PICK","sku":"550070614","from_bin":"CB11A01","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":2,"pick_type":"CASE","breaks_pallet":true,"seq":1},
 {"wave_no":"1","task_type":"REPLENISH","sku":"550070614","from_bin":"CB11A01","to_bin":"CB11A02","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":46,"pick_type":"CASE","breaks_pallet":true,"seq":2}]}'::jsonb) \g /dev/null

select post_task_by(p_task_id => pg_temp.t('2026-11-30','1',1), p_by_name => 'Ani', p_scanned => 'CB01D01') \g /dev/null
select post_task_by(p_task_id => pg_temp.t('2026-11-29','1',1), p_by_name => 'Ani', p_scanned => 'CB11A01') \g /dev/null
select pg_temp.check('A: pick posted alone leaves 40 at CB01D01, relokasi still planned',
  pg_temp.qty('CB01D01') = 40 and pg_temp.qty('CB01A01') = 0);
select pg_temp.check('A: a live relokasi is not flagged yet', pg_temp.flagged('move_cancelled') = 0);

select set_wave_status(pg_temp.w('2026-11-30','1'), 'CANCELLED', 'truck batal') \g /dev/null
select set_wave_status(pg_temp.w('2026-11-29','1'), 'CANCELLED', 'truck batal') \g /dev/null
select pg_temp.check('A: after the cancel the 40 still rest at level D (the gap)', pg_temp.qty('CB01D01') = 40);
select pg_temp.check('A: it is now listed: 40, CB01D01 -> CB01A01, kind move_cancelled',
  (select count(*) = 1 and bool_and(bin = 'CB01D01' and to_bin = 'CB01A01' and residue = 40 and in_bin = 40)
   from stranded_residue where sku = '550070614' and kind = 'move_cancelled'));
select pg_temp.check('A: the level-A source (CB11A01 keeps 46) is never flagged',
  pg_temp.qty('CB11A01') = 46 and not exists (select 1 from stranded_residue where bin = 'CB11A01'));
select pg_temp.check('A: settling moves the 40 up as one transfer; D is empty',
  (select settle_stranded_residue(pg_temp.t('2026-11-30','1',1), 'Budi', 'relokasi batal')) = 40
  and pg_temp.qty('CB01D01') = 0 and pg_temp.qty('CB01A01') = 40);
select pg_temp.check('A: one transfer in the ledger, with a name, naming the cancelled relokasi',
  (select count(*) = 1 and bool_and(m.by_name is not null and m.note like '%relokasi dibatalkan%')
   from movements m join bins b on b.id = m.from_bin_id
   where m.type = 'transfer' and b.bin_code = 'CB01D01' and m.quantity = 40));
select pg_temp.check('A: listed no more', pg_temp.flagged('move_cancelled') = 0);

-- ---------------------------------------------------------------- B
-- One wave, two shipments. S1: pick 8 + relokasi 40 (posted early) from CB01D02 -> a posted break.
-- S2: a plain pick of 4 from CB01B01. Cancel the wave, restore it.
reset role; drop table if exists pg_temp._replace, pg_temp._wave_ids; set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select save_plan('2026-12-01', '{"waves":[{"wave_no":"1","shipment_numbers":["109722231","109721549"],"planned_slot":"00:52"}],
 "tasks":[
 {"wave_no":"1","shipment_number":"109722231","task_type":"PICK","sku":"550070614","from_bin":"CB01D02","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":8,"pick_type":"CASE","breaks_pallet":true,"seq":1},
 {"wave_no":"1","task_type":"REPLENISH","sku":"550070614","from_bin":"CB01D02","to_bin":"CB01A02","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":40,"pick_type":"CASE","breaks_pallet":true,"seq":2},
 {"wave_no":"1","shipment_number":"109721549","task_type":"PICK","sku":"550070614","from_bin":"CB01B01","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":4,"pick_type":"CASE","breaks_pallet":false,"seq":3}],
 "outbound":[{"wave_no":"1","shipment_number":"109722231","sku":"550070614","quantity_requested":8,"quantity_allocated":8},
             {"wave_no":"1","shipment_number":"109721549","sku":"550070614","quantity_requested":4,"quantity_allocated":4}]}'::jsonb) \g /dev/null
select post_task_by(p_task_id => pg_temp.t('2026-12-01','1',2), p_by_name => 'Ani', p_scanned => 'CB01D02') \g /dev/null
select set_wave_status(pg_temp.w('2026-12-01','1'), 'CANCELLED', 'truck batal') \g /dev/null
select pg_temp.check('B: both outbound lines are CANCELLED with the wave',
  (select count(*) = 2 and bool_and(status = 'CANCELLED') from outbound where wave_id = pg_temp.w('2026-12-01','1')));
select restore_wave(pg_temp.w('2026-12-01','1'), 'Budi', 'truck jadi berangkat') \g /dev/null
select pg_temp.check('B: the plain line S2 is restored: pick PLANNED, outbound PLANNED',
  (select status from pick_tasks where id = pg_temp.t('2026-12-01','1',3)) = 'PLANNED'
  and (select status from outbound where wave_id = pg_temp.w('2026-12-01','1') and shipment_number = '109721549') = 'PLANNED');
select pg_temp.check('B: the posted-break line S1 stays skipped and its outbound stays CANCELLED (replan it)',
  (select status from pick_tasks where id = pg_temp.t('2026-12-01','1',1)) = 'CANCELLED'
  and (select status from outbound where wave_id = pg_temp.w('2026-12-01','1') and shipment_number = '109722231') = 'CANCELLED');

-- ---------------------------------------------------------------- C
-- CB01D02 now holds 0 (S1's break finished by the cancel). Re-stock it with 48 for a clean pallet.
reset role;
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
select 'inbound', (select id from items where sku = '550070614'), 'RW1', 48, (select id from bins where bin_code = 'CB01D02'), '2030-09-01', 'fixture C';
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
-- seq 1 relokasi 20 -> CB01A01, seq 2 pick 8, seq 3 relokasi 20 -> CB01A02; both moves posted, the pick open.
-- The wave page pairs the pick with seq 3 (the move after it); so must the cancel.
reset role; drop table if exists pg_temp._replace, pg_temp._wave_ids; set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select save_plan('2026-12-02', '{"waves":[{"wave_no":"1","shipment_numbers":["109722231"],"planned_slot":"00:52"}],
 "tasks":[
 {"wave_no":"1","task_type":"REPLENISH","sku":"550070614","from_bin":"CB01D02","to_bin":"CB01A01","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":20,"pick_type":"CASE","breaks_pallet":true,"seq":1},
 {"wave_no":"1","shipment_number":"109722231","task_type":"PICK","sku":"550070614","from_bin":"CB01D02","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":8,"pick_type":"CASE","breaks_pallet":true,"seq":2},
 {"wave_no":"1","task_type":"REPLENISH","sku":"550070614","from_bin":"CB01D02","to_bin":"CB01A02","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":20,"pick_type":"CASE","breaks_pallet":true,"seq":3}]}'::jsonb) \g /dev/null
select post_task_by(p_task_id => pg_temp.t('2026-12-02','1',1), p_by_name => 'Ani', p_scanned => 'CB01D02') \g /dev/null
select post_task_by(p_task_id => pg_temp.t('2026-12-02','1',3), p_by_name => 'Ani', p_scanned => 'CB01D02') \g /dev/null
select pg_temp.check('C: both moves posted: D holds 8, each pickface 20 (+ the 40 settled in A at CB01A01 / 0 at CB01A02)',
  pg_temp.qty('CB01D02') = 8);
reset role;
select pg_temp.check('C: the pick pairs with the move AFTER it (seq 3)',
  public.posted_pallet_move_seq(pg_temp.t('2026-12-02','1',2)) = 3);
select pg_temp.check('C: the leftover lookup names the same pickface as the wave page: CB01A02',
  (select to_bin from public.open_pallet_leftovers(pg_temp.t('2026-12-02','1',2))) = 'CB01A02');
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select set_wave_status(pg_temp.w('2026-12-02','1'), 'CANCELLED', 'truck batal') \g /dev/null
select pg_temp.check('C: cancelling the wave sends the 8 to CB01A02, the pickface of the move after the pick',
  pg_temp.qty('CB01D02') = 0
  and (select count(*) = 1 from movements m join bins b on b.id = m.to_bin_id
       where m.type = 'transfer' and b.bin_code = 'CB01A02' and m.quantity = 8 and m.note like 'Batal pick NO 1 SH 109722231 #2:%'));

rollback;
