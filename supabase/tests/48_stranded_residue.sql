-- Sisa palet tertinggal (0075): the reserve bin keeps the pick's cartons in the system although the
-- pallet has physically moved, because the pick was never confirmed and its wave was cancelled.
-- CB01D01 (reserve) holds 48, UPP 48. Wave 1 = pick 8 + relokasi 40 to the pickface CB01A01.
-- The relokasi is posted early, the wave is cancelled by a path that does not finish the pallet
-- break (as before 0073), and the system still shows 8 in CB01D01.
-- Runs in a transaction and rolls back. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111','sup@x','{"name":"Supervisor"}'),
  ('22222222-2222-2222-2222-222222222222','op@x','{"name":"Operator"}') on conflict do nothing;
update profiles set role = 'admin'    where id = '11111111-1111-1111-1111-111111111111';
update profiles set role = 'operator' where id = '22222222-2222-2222-2222-222222222222';
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.fails(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then
  if sqlerrm not like p_like then raise notice 'got: %', sqlerrm; end if;
  return sqlerrm like p_like; end $$;
create or replace function pg_temp.qty(p_bin text) returns numeric language sql as $$
  select coalesce(sum(i.quantity), 0) from inventory i join bins b on b.id = i.bin_id
  join items it on it.id = i.item_id where b.bin_code = p_bin and it.sku = '550070614' $$;
create or replace function pg_temp.t(p_wave text, p_seq int) returns uuid language sql as $$
  select t.id from pick_tasks t join waves w on w.id = t.wave_id
  where w.planned_date = '2026-11-30' and w.wave_no = p_wave and t.seq = p_seq $$;
create or replace function pg_temp.st(p_wave text, p_seq int) returns text language sql as $$
  select status from pick_tasks where id = pg_temp.t(p_wave, p_seq) $$;
create or replace function pg_temp.rows_flagged() returns int language sql as $$
  select count(*)::int from stranded_residue where sku = '550070614' $$;
create or replace function pg_temp.drop_plan_temps() returns void language plpgsql as $$
begin execute 'drop table if exists _replace, _wave_ids, _seen'; exception when others then null; end $$;
grant execute on function pg_temp.check(text, boolean), pg_temp.fails(text, text), pg_temp.qty(text),
  pg_temp.t(text, int), pg_temp.st(text, int), pg_temp.rows_flagged(), pg_temp.drop_plan_temps() to authenticated;

-- Fixture: 48 in the reserve bin CB01D01, nothing in the pickface CB01A01, UPP 48.
update items set upp = 48 where sku = '550070614';
delete from inventory where bin_id in (select id from bins where bin_code in ('CB01A01','CB01D01'))
  and item_id = (select id from items where sku = '550070614');
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
select 'adjustment', (select id from items where sku = '550070614'), 'RW1', 48,
       (select id from bins where bin_code = 'CB01D01'), '2030-09-01', 'fixture';

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

-- NO 1: pick 8 + relokasi 40. NO 2: an unrelated open pick of 4 from the same pallet (no move).
select save_plan('2026-11-30', '{
  "waves":[
   {"wave_no":"1","shipment_numbers":["109722231"],"planned_slot":"00:52"},
   {"wave_no":"2","shipment_numbers":["109721549"],"planned_slot":"01:22"}],
  "tasks":[
   {"wave_no":"1","shipment_number":"109722231","task_type":"PICK","sku":"550070614","from_bin":"CB01D01","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":8,"pick_type":"CASE","breaks_pallet":true,"seq":1},
   {"wave_no":"1","task_type":"REPLENISH","sku":"550070614","from_bin":"CB01D01","to_bin":"CB01A01","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":40,"pick_type":"CASE","breaks_pallet":true,"seq":2},
   {"wave_no":"2","shipment_number":"109721549","task_type":"PICK","sku":"550070614","from_bin":"CB01D01","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":4,"pick_type":"CASE","breaks_pallet":true,"seq":1}]}'::jsonb) \g /dev/null

-- The truck is out of order: the relokasi is posted alone. The 8 stay in the system at CB01D01.
select post_task_by(p_task_id => pg_temp.t('1', 2), p_by_name => 'Ani', p_scanned => 'CB01D01') \g /dev/null
select pg_temp.check('40 moved up to the pickface, 8 left in the reserve bin until the pick is confirmed',
  pg_temp.qty('CB01A01') = 40 and pg_temp.qty('CB01D01') = 8);
select pg_temp.check('an open pick (NO 1) is not stranded anything', pg_temp.rows_flagged() = 0);

-- The wave is cancelled by a path that does not finish the pallet break (the situation before 0073,
-- or a pair that stopped being adjacent). The floor moved the whole pallet.
reset role;
update pick_tasks set status = 'CANCELLED' where id = pg_temp.t('1', 1);
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select pg_temp.check('the system still holds 8 in CB01D01 (the bug)', pg_temp.qty('CB01D01') = 8);
select pg_temp.check('NO 2 still has an open pick from that pallet: nothing is stranded, those cartons are its stock',
  pg_temp.rows_flagged() = 0);
select pg_temp.check('settling is refused while NO 2 needs the bin',
  pg_temp.fails($$select settle_stranded_residue(pg_temp.t('1', 1), 'Budi', 'palet sudah pindah')$$, '%Tidak ada sisa palet%'));

-- NO 2 goes away; nothing needs the 8 any more.
select set_task_status(pg_temp.t('2', 1), 'CANCELLED', 'order batal') \g /dev/null
select pg_temp.check('now the residue is listed: 8 from CB01D01 to CB01A01',
  (select count(*) = 1 and bool_and(bin = 'CB01D01' and to_bin = 'CB01A01' and residue = 8 and in_bin = 8
                                    and wave_no = '1' and shipment_number = '109722231')
   from stranded_residue where sku = '550070614'));

-- Permissions and reason.
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select pg_temp.check('an operator cannot settle it',
  pg_temp.fails($$select settle_stranded_residue(pg_temp.t('1', 1), 'Budi', 'palet sudah pindah')$$, '%supervisor atau admin%'));
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select pg_temp.check('a reason is required',
  pg_temp.fails($$select settle_stranded_residue(pg_temp.t('1', 1), 'Budi', '  ')$$, '%Alasan wajib%'));
select pg_temp.check('nothing moved by the refusals', pg_temp.qty('CB01D01') = 8 and pg_temp.qty('CB01A01') = 40);

-- Settle: the 8 go up with the 40, as one transfer.
select pg_temp.check('settling returns the 8 moved',
  (select settle_stranded_residue(pg_temp.t('1', 1), 'Budi', 'palet sudah pindah utuh')) = 8);
select pg_temp.check('CB01D01 is empty and the pickface holds the whole pallet of 48',
  pg_temp.qty('CB01D01') = 0 and pg_temp.qty('CB01A01') = 48);
select pg_temp.check('the correction is one transfer in the ledger, with a name and the reason, not an adjustment',
  (select count(*) = 1 and bool_and(m.by_name is not null and m.note like '%palet sudah pindah utuh%')
   from movements m join bins b on b.id = m.from_bin_id
   where m.type = 'transfer' and b.bin_code = 'CB01D01' and m.quantity = 8 and m.note like 'Sisa palet NO 1%'));
select pg_temp.check('the residue is no longer listed', pg_temp.rows_flagged() = 0);
select pg_temp.check('settling twice is refused and moves nothing',
  pg_temp.fails($$select settle_stranded_residue(pg_temp.t('1', 1), 'Budi', 'lagi')$$, '%Tidak ada sisa palet%')
  and pg_temp.qty('CB01D01') = 0 and pg_temp.qty('CB01A01') = 48);

-- A whole pallet put away into CB01D01 afterwards (same SKU and batch) is never mistaken for the residue.
reset role;
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
select 'inbound', (select id from items where sku = '550070614'), 'RW1', 48,
       (select id from bins where bin_code = 'CB01D01'), '2030-09-01', 'new pallet';
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select pg_temp.check('a new full pallet in the same bin is not flagged', pg_temp.rows_flagged() = 0 and pg_temp.qty('CB01D01') = 48);

-- ============================================================================
-- Regression guard for A1: a stranded pick with stale quantity (legacy row)
-- CB01D01 holds 48, UPP 48. The pick's quantity is 8, but a legacy path
-- cut the order without reconciling, leaving the pick's quantity as 2 (stale).
-- Without A1's fix (removing the clamp to pk.quantity), residue would be 2
-- and 6 cartons would be left stranded at level D.
-- ============================================================================
-- The fixture runs as the owner: inventory has no write policy (a delete would silently remove
-- nothing), and guard_adjustment_policy refuses an adjustment without a reason code.
reset role;
reset request.jwt.claim.sub;
select pg_temp.drop_plan_temps();
delete from inventory where bin_id in (select id from bins where bin_code in ('CB01A01','CB01D01'))
  and item_id = (select id from items where sku = '550070614');
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
select 'adjustment', (select id from items where sku = '550070614'), 'RW1', 48,
       (select id from bins where bin_code = 'CB01D01'), '2030-09-01', 'fixture for A1 guard';

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

-- NO 4: pick 8 + relokasi 40 → CB01A01
select save_plan('2026-11-30', '{
  "waves":[{"wave_no":"4","shipment_numbers":["109722234"],"planned_slot":"02:22"}],
  "tasks":[
    {"wave_no":"4","shipment_number":"109722234","task_type":"PICK","sku":"550070614","from_bin":"CB01D01","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":8,"pick_type":"CASE","breaks_pallet":true,"seq":1},
    {"wave_no":"4","task_type":"REPLENISH","sku":"550070614","from_bin":"CB01D01","to_bin":"CB01A01","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":40,"pick_type":"CASE","breaks_pallet":true,"seq":2}]}'::jsonb) \g /dev/null

-- Post the relokasi alone (40 moved up)
select post_task_by(p_task_id => pg_temp.t('4', 2), p_by_name => 'Ani', p_scanned => 'CB01D01') \g /dev/null
select pg_temp.check('after relokasi posted: reserve 8, pickface 40',
  pg_temp.qty('CB01D01') = 8 and pg_temp.qty('CB01A01') = 40);

-- Legacy row: the order was cut by a path that did not reconcile, so the pick's
-- quantity is stale memory (2 instead of 8). This is the case A1 fixes.
reset role;
update pick_tasks set quantity = 2 where id = pg_temp.t('4', 1);
update pick_tasks set status = 'CANCELLED' where id = pg_temp.t('4', 1);
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

-- The view must report residue = 8 (bin's loose part: 8 % 48 = 8), NOT 2 (clamped to stale pick qty)
select pg_temp.check('A1 guard: view reports residue = 8 (bin loose part), not 2 (stale pick qty)',
  (select residue = 8 and in_bin = 8 from stranded_residue where pick_task_id = pg_temp.t('4', 1)));

-- Settle and assert no cartons left stranded at level D
select pg_temp.check('settling moves the full 8, reserve emptied, pickface gets whole pallet',
  (select settle_stranded_residue(pg_temp.t('4', 1), 'Budi', 'palet sudah pindah utuh') = 8
   and pg_temp.qty('CB01D01') = 0 and pg_temp.qty('CB01A01') = 48));

rollback;
