-- 0108: a full import holds back stock the app moved last instead of zeroing it "(not in file)".
-- Bins ZT01-ZT04 are made by the test; every other bin is passed as keep_bins so the seed is untouched.
-- Runs in a transaction and rolls back.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users values ('11111111-1111-1111-1111-111111111111','adm@x','{"name":"Admin Uji"}') on conflict do nothing;
insert into auth.users values ('22222222-2222-2222-2222-222222222222','sup@x','{"name":"Supervisor Uji"}') on conflict do nothing;
insert into auth.users values ('33333333-3333-3333-3333-333333333333','op@x','{"name":"Operator Uji"}') on conflict do nothing;
update profiles set role = 'admin' where id = '11111111-1111-1111-1111-111111111111';
update profiles set role = 'supervisor' where id = '22222222-2222-2222-2222-222222222222';
update profiles set role = 'operator' where id = '33333333-3333-3333-3333-333333333333';
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.fails(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return sqlerrm like p_like; end $$;
create or replace function pg_temp.qty(p_bin text, p_batch text, p_exp date default null) returns numeric language sql as $$
  select coalesce(sum(i.quantity), 0) from inventory i join bins b on b.id = i.bin_id
  where b.bin_code = p_bin and i.batch_lot = p_batch and (p_exp is null or i.expiry_date = p_exp) $$;
select set_config('t.keep', (select array_agg(bin_code)::text from bins), false);
select set_config('t.sku', (select sku from items order by sku limit 1), false);
select set_config('t.sku2', (select sku from items order by sku offset 1 limit 1), false);

-- Morning 1: the file lists all four rows (an update import, nothing zeroed).
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select import_snapshot(jsonb_build_array(
  jsonb_build_object('bin_code','ZT01','zone','ZT','rack','01','level','A','position','01','sku',current_setting('t.sku'),'batch_lot','B1','quantity',10,'expiry_date','2031-01-01'),
  jsonb_build_object('bin_code','ZT02','zone','ZT','rack','01','level','A','position','01','sku',current_setting('t.sku'),'batch_lot','B1','quantity',5,'expiry_date','2031-01-01'),
  jsonb_build_object('bin_code','ZT03','zone','ZT','rack','01','level','A','position','01','sku',current_setting('t.sku'),'batch_lot','B2','quantity',7,'expiry_date','2031-01-01'),
  jsonb_build_object('bin_code','ZT04','zone','ZT','rack','01','level','A','position','01','sku',current_setting('t.sku2'),'batch_lot','B9','quantity',3,'expiry_date','2031-01-01')),
  false, 'pagi-1') \g /dev/null

-- During the day the app records a count at ZT02 (+2): the file will not know.
reset role;
-- One transaction shares now(): the count is stamped a minute later, as it would be on the floor.
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note, reason_code, by_name, created_at)
select 'adjustment', i.id, 'B1', 2, b.id, '2031-01-01', 'Selisih hitung', 'COUNT_VARIANCE', 'Uji', now() + interval '1 minute'
from items i, bins b where i.sku = current_setting('t.sku') and b.bin_code = 'ZT02';

-- Morning 2: a full import that misses ZT01 and ZT02, and lists ZT03 under another expiry (a relabel).
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select set_config('t.res', import_snapshot(jsonb_build_array(
  jsonb_build_object('bin_code','ZT03','zone','ZT','rack','01','level','A','position','01','sku',current_setting('t.sku'),'batch_lot','B2','quantity',7,'expiry_date','2031-02-01'),
  jsonb_build_object('bin_code','ZT04','zone','ZT','rack','01','level','A','position','01','sku',current_setting('t.sku2'),'batch_lot','B9','quantity',3,'expiry_date','2031-01-01')),
  true, 'pagi-2', current_setting('t.keep')::text[])::text, false) \g /dev/null
reset role;

select pg_temp.check('the import reports one held row', (current_setting('t.res')::jsonb->>'held')::int = 1);
select pg_temp.check('ZT01, last moved by an import, is zeroed as before', pg_temp.qty('ZT01','B1') = 0);
select pg_temp.check('ZT02, counted in the app, keeps its 7', pg_temp.qty('ZT02','B1') = 7);
select pg_temp.check('ZT03 relabel: the old expiry is zeroed, the file''s expiry has the 7',
  pg_temp.qty('ZT03','B2','2031-01-01') = 0 and pg_temp.qty('ZT03','B2','2031-02-01') = 7);
select pg_temp.check('the hold names the bin, the quantity and the app movement',
  exists (select 1 from import_hold_detail where bin_code = 'ZT02' and held_qty = 7 and qty_now = 7
          and source_name = 'pagi-2' and last_move like '%Selisih hitung%' and resolution is null));
select pg_temp.check('no "(not in file)" adjustment for ZT02',
  not exists (select 1 from movements m join bins b on b.id = m.to_bin_id where b.bin_code = 'ZT02' and m.note like '%(not in file)'));

-- The same file again does not add a second open hold.
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select import_snapshot(jsonb_build_array(
  jsonb_build_object('bin_code','ZT03','zone','ZT','rack','01','level','A','position','01','sku',current_setting('t.sku'),'batch_lot','B2','quantity',7,'expiry_date','2031-02-01')),
  true, 'pagi-3', current_setting('t.keep')::text[]) \g /dev/null
reset role;
select pg_temp.check('a repeat import keeps one open hold, now naming the newer file',
  (select count(*) from import_holds h join bins b on b.id = h.bin_id where b.bin_code = 'ZT02' and h.resolution is null) = 1
  and (select source_name from import_hold_detail where bin_code = 'ZT02' and resolution is null) = 'pagi-3');
select pg_temp.check('ZT04, missing from that file but last moved by an import, is zeroed', pg_temp.qty('ZT04','B9') = 0);

-- Who sees and who decides.
set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select pg_temp.check('an operator does not see held rows', (select count(*) from import_hold_detail) = 0);
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select pg_temp.check('a supervisor sees held rows', (select count(*) from import_hold_detail where bin_code = 'ZT02') = 1);
select pg_temp.check('a supervisor cannot decide', pg_temp.fails(
  $q$select resolve_import_holds(array(select id from import_holds where resolution is null), true, 'Supervisor Uji')$q$, 'Hanya admin%'));
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select pg_temp.check('an empty choice is refused', pg_temp.fails($q$select resolve_import_holds('{}'::uuid[], true, 'Admin Uji')$q$, 'Pilih baris dulu'));

-- Keep: checked on the floor, the stock stays and no movement is written.
select set_config('t.n', (select count(*)::text from movements), false);
select resolve_import_holds(array(select id from import_holds where resolution is null), false, 'Admin Uji') \g /dev/null
reset role;
select pg_temp.check('keep: resolved KEPT by the admin, stock unchanged, no movement',
  (select resolution from import_holds h join bins b on b.id = h.bin_id where b.bin_code = 'ZT02') = 'KEPT'
  and pg_temp.qty('ZT02','B1') = 7 and (select count(*) from movements) = current_setting('t.n')::bigint);

-- A later import that still misses it holds it again; this time the admin zeroes it.
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select import_snapshot(jsonb_build_array(
  jsonb_build_object('bin_code','ZT03','zone','ZT','rack','01','level','A','position','01','sku',current_setting('t.sku'),'batch_lot','B2','quantity',7,'expiry_date','2031-02-01')),
  true, 'pagi-4', current_setting('t.keep')::text[]) \g /dev/null
select set_config('t.hold', (select id::text from import_holds where resolution is null), false);
select resolve_import_holds(array[current_setting('t.hold')::uuid], true, 'Admin Uji') \g /dev/null
reset role;
select pg_temp.check('zero: ZT02 is 0 and the hold is ZEROED', pg_temp.qty('ZT02','B1') = 0
  and (select resolution from import_holds where id = current_setting('t.hold')::uuid) = 'ZEROED');
select pg_temp.check('zero: the same "(not in file)" adjustment the import makes, linked to the hold, with the admin''s name',
  exists (select 1 from movements where ref_id = current_setting('t.hold')::uuid and type = 'adjustment' and quantity = -7
          and note = 'IMPORT pagi-4 (not in file)' and reason_code = 'OPENING' and by_name = 'Admin Uji'));
rollback;
