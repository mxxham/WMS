-- 0143: a full import replaces the stock. What the file does not list is zeroed "(not in file)",
-- also when the app moved it last (0108 held those rows; a held row next to the SKU the file
-- booked into the same bin made two SKUs in one bin). Holds left open by earlier imports are
-- settled by the file. Bins ZT01-ZT05 are made by the test; every other bin is passed as keep_bins
-- so the seed is untouched. Runs in a transaction and rolls back.
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
create or replace function pg_temp.skus(p_bin text) returns int language sql as $$
  select count(distinct i.item_id)::int from inventory i join bins b on b.id = i.bin_id
  where b.bin_code = p_bin and i.quantity > 0 $$;
select set_config('t.keep', (select array_agg(bin_code)::text from bins), false);
select set_config('t.sku', (select sku from items order by sku limit 1), false);
select set_config('t.sku2', (select sku from items order by sku offset 1 limit 1), false);

-- Morning 1: the file lists five rows (an update import, nothing zeroed).
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select import_snapshot(jsonb_build_array(
  jsonb_build_object('bin_code','ZT01','zone','ZT','rack','01','level','A','position','01','sku',current_setting('t.sku'),'batch_lot','B1','quantity',10,'expiry_date','2031-01-01'),
  jsonb_build_object('bin_code','ZT02','zone','ZT','rack','01','level','A','position','01','sku',current_setting('t.sku'),'batch_lot','B1','quantity',5,'expiry_date','2031-01-01'),
  jsonb_build_object('bin_code','ZT03','zone','ZT','rack','01','level','A','position','01','sku',current_setting('t.sku'),'batch_lot','B2','quantity',7,'expiry_date','2031-01-01'),
  jsonb_build_object('bin_code','ZT04','zone','ZT','rack','01','level','A','position','01','sku',current_setting('t.sku2'),'batch_lot','B9','quantity',3,'expiry_date','2031-01-01'),
  jsonb_build_object('bin_code','ZT05','zone','ZT','rack','01','level','A','position','01','sku',current_setting('t.sku'),'batch_lot','B5','quantity',4,'expiry_date','2031-01-01')),
  false, 'pagi-1') \g /dev/null

-- During the day the app records a count at ZT02 (+2) and at ZT05 (+1): the file will not know.
-- Two holds are still open from an import made before 0143: ZT02 (7) and ZT05 (5).
reset role;
-- One transaction shares now(): the counts are stamped a minute later, as they would be on the floor.
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note, reason_code, by_name, created_at)
select 'adjustment', i.id, x.batch, x.qty, b.id, '2031-01-01', 'Selisih hitung', 'COUNT_VARIANCE', 'Uji', now() + interval '1 minute'
from items i, (values ('ZT02', 'B1', 2), ('ZT05', 'B5', 1)) as x(bin, batch, qty), bins b
where i.sku = current_setting('t.sku') and b.bin_code = x.bin;
insert into import_holds (source_name, bin_id, item_id, batch_lot, expiry_date, quantity, last_move)
select 'lama', b.id, i.id, x.batch, '2031-01-01', x.qty, 'Selisih hitung'
from items i, (values ('ZT02', 'B1', 7), ('ZT05', 'B5', 5)) as x(bin, batch, qty), bins b
where i.sku = current_setting('t.sku') and b.bin_code = x.bin;

-- Morning 2: a full import. ZT01 is missing. ZT02 now holds ANOTHER SKU in the file (the 16 Nov case).
-- ZT03 is listed under another expiry (a relabel). ZT05 is listed as the app has it.
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select set_config('t.res', import_snapshot(jsonb_build_array(
  jsonb_build_object('bin_code','ZT02','zone','ZT','rack','01','level','A','position','01','sku',current_setting('t.sku2'),'batch_lot','B7','quantity',6,'expiry_date','2031-03-01'),
  jsonb_build_object('bin_code','ZT03','zone','ZT','rack','01','level','A','position','01','sku',current_setting('t.sku'),'batch_lot','B2','quantity',7,'expiry_date','2031-02-01'),
  jsonb_build_object('bin_code','ZT04','zone','ZT','rack','01','level','A','position','01','sku',current_setting('t.sku2'),'batch_lot','B9','quantity',3,'expiry_date','2031-01-01'),
  jsonb_build_object('bin_code','ZT05','zone','ZT','rack','01','level','A','position','01','sku',current_setting('t.sku'),'batch_lot','B5','quantity',5,'expiry_date','2031-01-01')),
  true, 'pagi-2', current_setting('t.keep')::text[])::text, false) \g /dev/null
reset role;

select pg_temp.check('the import holds nothing back', (current_setting('t.res')::jsonb->>'held')::int = 0
  and not exists (select 1 from import_holds where resolution is null));
select pg_temp.check('ZT01, missing from the file, is zeroed', pg_temp.qty('ZT01','B1') = 0);
select pg_temp.check('ZT02: the SKU the app counted is zeroed, the file''s SKU is booked: one bin, one SKU',
  pg_temp.qty('ZT02','B1') = 0 and pg_temp.qty('ZT02','B7') = 6 and pg_temp.skus('ZT02') = 1);
select pg_temp.check('ZT02: zeroed with the "(not in file)" adjustment, in the ledger',
  exists (select 1 from movements m join bins b on b.id = m.to_bin_id
          where b.bin_code = 'ZT02' and m.type = 'adjustment' and m.quantity = -7 and m.note = 'IMPORT pagi-2 (not in file)'));
select pg_temp.check('ZT03 relabel: the old expiry is zeroed, the file''s expiry has the 7',
  pg_temp.qty('ZT03','B2','2031-01-01') = 0 and pg_temp.qty('ZT03','B2','2031-02-01') = 7);
select pg_temp.check('ZT04, listed as it was, is untouched', pg_temp.qty('ZT04','B9') = 3);
select pg_temp.check('the two old holds are settled by the file: ZT02 zeroed, ZT05 kept',
  (current_setting('t.res')::jsonb->>'settled')::int = 2
  and (select h.resolution from import_holds h join bins b on b.id = h.bin_id where b.bin_code = 'ZT02') = 'ZEROED'
  and (select h.resolution from import_holds h join bins b on b.id = h.bin_id where b.bin_code = 'ZT05') = 'KEPT'
  and pg_temp.qty('ZT05','B5') = 5);

-- An update import ("Perbarui saja") still changes only the rows it lists.
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select import_snapshot(jsonb_build_array(
  jsonb_build_object('bin_code','ZT03','zone','ZT','rack','01','level','A','position','01','sku',current_setting('t.sku'),'batch_lot','B2','quantity',9,'expiry_date','2031-02-01')),
  false, 'pagi-3') \g /dev/null
reset role;
select pg_temp.check('an update import leaves stock it does not list', pg_temp.qty('ZT03','B2') = 9 and pg_temp.qty('ZT04','B9') = 3);

-- A bin with a row validation rejected (keep_bins) is not readable in the file: it keeps its stock,
-- and a hold there stays open for an admin, who decides as before.
insert into import_holds (source_name, bin_id, item_id, batch_lot, expiry_date, quantity, last_move)
select 'lama', b.id, i.id, 'B9', '2031-01-01', 3, 'Selisih hitung'
from items i, bins b where i.sku = current_setting('t.sku2') and b.bin_code = 'ZT04';
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select import_snapshot(jsonb_build_array(
  jsonb_build_object('bin_code','ZT03','zone','ZT','rack','01','level','A','position','01','sku',current_setting('t.sku'),'batch_lot','B2','quantity',9,'expiry_date','2031-02-01')),
  true, 'pagi-4', current_setting('t.keep')::text[] || array['ZT04']) \g /dev/null
reset role;
select pg_temp.check('a bin with rejected rows keeps its stock and its open hold',
  pg_temp.qty('ZT04','B9') = 3 and pg_temp.qty('ZT05','B5') = 0
  and (select count(*) from import_holds h join bins b on b.id = h.bin_id where b.bin_code = 'ZT04' and h.resolution is null) = 1);

-- Who sees and who decides.
set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select pg_temp.check('an operator does not see held rows', (select count(*) from import_hold_detail) = 0);
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select pg_temp.check('a supervisor sees held rows', (select count(*) from import_hold_detail where bin_code = 'ZT04' and resolution is null) = 1);
select pg_temp.check('a supervisor cannot decide', pg_temp.fails(
  $q$select resolve_import_holds(array(select id from import_holds where resolution is null), true, 'Supervisor Uji')$q$, 'Hanya admin%'));
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select pg_temp.check('an empty choice is refused', pg_temp.fails($q$select resolve_import_holds('{}'::uuid[], true, 'Admin Uji')$q$, 'Pilih baris dulu'));
select set_config('t.hold', (select id::text from import_holds where resolution is null), false);
select resolve_import_holds(array[current_setting('t.hold')::uuid], true, 'Admin Uji') \g /dev/null
reset role;
select pg_temp.check('zero: ZT04 is 0 and the hold is ZEROED', pg_temp.qty('ZT04','B9') = 0
  and (select resolution from import_holds where id = current_setting('t.hold')::uuid) = 'ZEROED');
select pg_temp.check('zero: the "(not in file)" adjustment, linked to the hold, with the admin''s name',
  exists (select 1 from movements where ref_id = current_setting('t.hold')::uuid and type = 'adjustment' and quantity = -3
          and note = 'IMPORT lama (not in file)' and reason_code = 'OPENING' and by_name = 'Admin Uji'));
rollback;
