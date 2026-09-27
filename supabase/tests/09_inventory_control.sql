-- Inventory control (0016-0022). Runs in a transaction and rolls back.
-- Run after 00 stub, migrations, seed. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users values ('11111111-1111-1111-1111-111111111111','op@x','{"name":"Operator"}'),
                              ('22222222-2222-2222-2222-222222222222','sup@x','{"name":"Supervisor"}'),
                              ('33333333-3333-3333-3333-333333333333','adm@x','{"name":"Admin"}') on conflict do nothing;
update profiles set role='supervisor' where id='22222222-2222-2222-2222-222222222222';
update profiles set role='admin' where id='33333333-3333-3333-3333-333333333333';

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when coalesce(ok, false) then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.fails(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then
  if sqlerrm not like p_like then raise notice '   got: %', sqlerrm; end if;
  return sqlerrm like p_like; end $$;
create or replace function pg_temp.qty(p_bin text, p_batch text) returns numeric language sql as $$
  select coalesce(sum(quantity), 0) from inventory_detail where bin_code = p_bin and batch_lot = p_batch $$;
create or replace function pg_temp.as_user(p text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', case p when 'op' then '11111111-1111-1111-1111-111111111111'
    when 'sup' then '22222222-2222-2222-2222-222222222222' else '33333333-3333-3333-3333-333333333333' end, false) $$;

-- Fixtures (no user: system rows).
-- CG10C01: 550044709 H1 x44 exp 2031-01-01.  CG10C02: 550044709 H2 x20 exp 2030-06-01 (older).
-- CG11C01: 550058593 R7 x30 exp 2031-05-05.
delete from inventory where bin_id in (select id from bins where bin_code in ('CG10C01','CG10C02','CG11C01','CG11C02','CG12C01','CG12C02','QUARANTINE'));
delete from count_tasks where bin_id in (select id from bins where bin_code in ('CG10C01','CG10C02','CG11C01','CG11C02','CG12C01'));
insert into movements (type,item_id,batch_lot,quantity,to_bin_id,expiry_date,note)
select 'adjustment', (select id from items where sku=s), bt, q, (select id from bins where bin_code=b), e::date, 'fixture'
from (values ('CG10C01','550044709','H1',44,'2031-01-01'),('CG10C02','550044709','H2',20,'2030-06-01'),
             ('CG11C01','550058593','R7',30,'2031-05-05')) v(b,s,bt,q,e);

set role authenticated;

-- ---- 0016 policy, item master, batch codes ---------------------------
select pg_temp.as_user('sup');
select pg_temp.check('policy has defaults (48 months, limit 20, recount on)',
  (inventory_policy()->>'default_shelf_life_months')::int = 48 and (inventory_policy()->>'adjust_approval_qty')::int = 20
  and (inventory_policy()->>'recount_on_variance')::boolean);
select pg_temp.check('only an admin changes the policy',
  pg_temp.fails($q$select set_inventory_policy('{"near_expiry_days":90}')$q$, 'Hanya admin%'));
select pg_temp.as_user('adm');
select pg_temp.check('unknown / invalid policy keys are refused',
  pg_temp.fails($q$select set_inventory_policy('{"foo":1}')$q$, 'Aturan foo tidak dikenal%')
  and pg_temp.fails($q$select set_inventory_policy('{"recount_on_variance":1}')$q$, '%ya/tidak%')
  and pg_temp.fails($q$select set_inventory_policy('{"count_tolerance_qty":{"A":0}}')$q$, 'Toleransi hitung butuh%'));
select set_inventory_policy('{"near_expiry_days":90}');
select pg_temp.check('policy change merges over the rest',
  (inventory_policy()->>'near_expiry_days')::int = 90 and (inventory_policy()->>'adjust_approval_qty')::int = 20);
select pg_temp.check('batch 14H26JJ was made 14 Aug 2026; L = December',
  batch_mfg_date('14H26JJ') = '2026-08-14' and batch_mfg_date(' 01l25jj ') = '2025-12-01');
select pg_temp.check('non date-coded batches and impossible dates give null',
  batch_mfg_date('12658123') is null and batch_mfg_date('31B26JJ') is null and batch_mfg_date('') is null and batch_mfg_date('14M26JJ') is null);
select pg_temp.check('expected expiry = production + 48 months by default',
  batch_expected_expiry((select id from items where sku='550044709'), '09F26JJ') = '2030-06-09');
select pg_temp.as_user('sup');
select set_item_control('550044709', '8 994 123 456 789', 51, 30);
select pg_temp.check('item shelf life overrides the default; barcode stored without spaces',
  batch_expected_expiry((select id from items where sku='550044709'), '09F26JJ') = '2030-09-09'
  and (select ean from items where sku='550044709') = '8994123456789' and item_min_dispatch_days((select id from items where sku='550044709')) = 30);
select pg_temp.check('a barcode belongs to one SKU; invalid barcodes refused',
  pg_temp.fails($q$select set_item_control('550058593', '8994123456789', null, null)$q$, 'Barcode 8994123456789 sudah dipakai SKU 550044709%')
  and pg_temp.fails($q$select set_item_control('550058593', 'ABC', null, null)$q$, 'Barcode ABC tidak valid%'));
select pg_temp.check('scan resolves barcode or SKU', (select sku from item_by_barcode('8994123456789')) = '550044709'
  and (select sku from item_by_barcode('550058593')) = '550058593');
select set_item_control('550044709', null, null, null);
select pg_temp.as_user('op');
select pg_temp.check('operator cannot change item master',
  pg_temp.fails($q$select set_item_control('550044709', null, 12, null)$q$, 'Hanya supervisor%'));

-- ---- 0017 holds ------------------------------------------------------
select pg_temp.check('operator cannot place a hold',
  pg_temp.fails($q$select place_hold('LINE','CG10C01','550044709','H1','2031-01-01',4,'DAMAGED','karton penyok','Andi')$q$, 'Hanya supervisor%'));
select pg_temp.as_user('sup');
select pg_temp.check('a hold needs a note and a name',
  pg_temp.fails($q$select place_hold('LINE','CG10C01','550044709','H1','2031-01-01',4,'DAMAGED','','Andi')$q$, 'Keterangan hold wajib%')
  and pg_temp.fails($q$select place_hold('LINE','CG10C01','550044709','H1','2031-01-01',4,'DAMAGED','x','')$q$, 'Nama petugas wajib%'));
select set_config('t.hold', (place_hold('LINE','CG10C01','550044709','H1','2031-01-01',4,'DAMAGED','karton penyok','Andi')->>'id'), false);
select pg_temp.check('held qty shows on the stock line',
  (select held = 4 and hold_reasons = 'DAMAGED' from inventory_detail where bin_code='CG10C01' and batch_lot='H1'));
select pg_temp.check('planning leaves the held cartons out (44 - 4 = 40)',
  (select quantity = 40 and held = 4 from planning_stock('2026-12-01') where bin_code='CG10C01' and batch_lot='H1'));
select pg_temp.check('cannot hold more than the unheld part',
  pg_temp.fails($q$select place_hold('LINE','CG10C01','550044709','H1','2031-01-01',41,'QC_HOLD','x','Andi')$q$, 'Hanya 40 unit%'));
select pg_temp.check('picking into the held cartons is refused (41 of 44 with 4 held)',
  pg_temp.fails($q$insert into movements (type,item_id,batch_lot,quantity,from_bin_id,expiry_date)
    select 'picking', item_id, 'H1', 41, bin_id, expiry_date from inventory_detail where bin_code='CG10C01' and batch_lot='H1'$q$, 'Stok 550044709 batch H1 di CG10C01 ditahan (DAMAGED)%'));
insert into movements (type,item_id,batch_lot,quantity,from_bin_id,expiry_date)
select 'picking', item_id, 'H1', 30, bin_id, expiry_date from inventory_detail where bin_code='CG10C01' and batch_lot='H1';
select pg_temp.check('picking the unheld cartons is fine (44 - 30 = 14, 4 still held)',
  (select quantity = 14 and held = 4 from inventory_detail where bin_code='CG10C01' and batch_lot='H1'));
select pg_temp.check('moving held stock to another rack bin is refused',
  pg_temp.fails($q$insert into movements (type,item_id,batch_lot,quantity,from_bin_id,to_bin_id,expiry_date)
    select 'transfer', item_id, 'H1', 14, bin_id, (select id from bins where bin_code='CG12C01'), expiry_date from inventory_detail where bin_code='CG10C01' and batch_lot='H1'$q$, '%ditahan%'));
insert into movements (type,item_id,batch_lot,quantity,from_bin_id,to_bin_id,expiry_date)
select 'transfer', item_id, 'H1', 4, bin_id, (select id from bins where bin_code='QUARANTINE'), expiry_date from inventory_detail where bin_code='CG10C01' and batch_lot='H1';
select pg_temp.check('into quarantine: the hold follows the cartons, the rack line is free',
  (select held = 0 from inventory_detail where bin_code='CG10C01' and batch_lot='H1')
  and (select held = 4 and hold_reasons = 'DAMAGED' from inventory_detail where bin_code='QUARANTINE' and batch_lot='H1')
  and (select status from stock_holds where id = current_setting('t.hold')::uuid) = 'RELEASED');
select pg_temp.check('nothing is picked out of quarantine',
  pg_temp.fails($q$insert into movements (type,item_id,batch_lot,quantity,from_bin_id,expiry_date,note)
    select 'picking', item_id, 'H1', 1, bin_id, expiry_date, 'x' from inventory_detail where bin_code='QUARANTINE' and batch_lot='H1'$q$, '%ditahan%')
  or pg_temp.fails($q$insert into movements (type,item_id,batch_lot,quantity,from_bin_id,expiry_date,note)
    select 'picking', item_id, 'H1', 1, bin_id, expiry_date, 'x' from inventory_detail where bin_code='QUARANTINE' and batch_lot='H1'$q$, 'Stok karantina tidak boleh dipick%'));
insert into movements (type,item_id,batch_lot,quantity,to_bin_id,expiry_date,note,reason_code,by_name)
select 'adjustment', item_id, 'H1', -4, bin_id, expiry_date, 'dimusnahkan', 'DAMAGED', 'Budi' from inventory_detail where bin_code='QUARANTINE' and batch_lot='H1';
select pg_temp.check('writing off held stock closes its hold',
  pg_temp.qty('QUARANTINE','H1') = 0
  and not exists (select 1 from stock_holds where status='ACTIVE' and batch_lot='H1'));
select pg_temp.as_user('op');
select pg_temp.check('operator cannot move stock into quarantine',
  pg_temp.fails($q$insert into movements (type,item_id,batch_lot,quantity,from_bin_id,to_bin_id,expiry_date)
    select 'transfer', item_id, 'H1', 1, bin_id, (select id from bins where bin_code='QUARANTINE'), expiry_date from inventory_detail where bin_code='CG10C01' and batch_lot='H1'$q$, 'Hanya supervisor atau admin yang bisa memindahkan stok ke karantina%'));
select pg_temp.as_user('sup');
-- Batch hold (recall): every carton of 550058593 R7, wherever it is.
select set_config('t.bhold', (place_hold('BATCH',null,'550058593','R7',null,null,'RECALL','recall Shell QA-12','Andi')->>'id'), false);
select pg_temp.check('a batch hold covers the whole line and planning drops it',
  (select held = 30 from inventory_detail where bin_code='CG11C01' and batch_lot='R7')
  and not exists (select 1 from planning_stock('2026-12-01') where bin_code='CG11C01' and batch_lot='R7' and quantity > 0));
select pg_temp.check('one active batch hold per SKU + batch',
  pg_temp.fails($q$select place_hold('BATCH',null,'550058593','R7',null,null,'QC_HOLD','x','Andi')$q$, '%sudah ditahan%'));
select pg_temp.check('a recalled batch cannot be picked, even by a supervisor',
  pg_temp.fails($q$insert into movements (type,item_id,batch_lot,quantity,from_bin_id,expiry_date)
    select 'picking', item_id, 'R7', 1, bin_id, expiry_date from inventory_detail where bin_code='CG11C01' and batch_lot='R7'$q$, '%ditahan (RECALL)%'));
select save_plan('2026-12-02', '{
  "waves":[{"wave_no":"1","shipment_numbers":["HX1"]}],
  "tasks":[{"wave_no":"1","shipment_number":"HX1","task_type":"PICK","sku":"550058593","from_bin":"CG11C01","batch_lot":"R7","expiry_date":"2031-05-05","quantity":6,"seq":1}],
  "outbound":[{"wave_no":"1","shipment_number":"HX1","sku":"550058593","quantity_requested":6,"quantity_allocated":6}]}'::jsonb);
select pg_temp.check('a wave task on held stock cannot be posted',
  pg_temp.fails($q$select post_task((select id from pick_tasks where shipment_number='HX1'))$q$, '%ditahan (RECALL)%'));
select pg_temp.check('release needs a reason',
  pg_temp.fails(format($q$select release_hold(%L, '', 'Andi')$q$, current_setting('t.bhold')), 'Alasan melepas hold wajib%'));
select release_hold(current_setting('t.bhold')::uuid, 'QA Shell: lolos', 'Budi');
select pg_temp.check('after release the task posts',
  post_task((select id from pick_tasks where shipment_number='HX1'))->>'result' = 'POSTED');
select pg_temp.check('the reservation guard no longer hides "insufficient stock"',
  pg_temp.fails($q$insert into movements (type,item_id,batch_lot,quantity,from_bin_id,expiry_date)
    select 'picking', item_id, 'R7', 999, bin_id, expiry_date from inventory_detail where bin_code='CG11C01' and batch_lot='R7'$q$, 'Insufficient stock%'));

-- ---- 0018 adjustments ------------------------------------------------
select pg_temp.check('an adjustment needs a reason code, a note and a name',
  pg_temp.fails($q$insert into movements (type,item_id,batch_lot,quantity,to_bin_id,expiry_date,note)
    select 'adjustment', item_id, 'H1', 1, bin_id, expiry_date, 'x' from inventory_detail where bin_code='CG10C01' and batch_lot='H1'$q$, 'Kode alasan adjustment wajib%')
  and pg_temp.fails($q$insert into movements (type,item_id,batch_lot,quantity,to_bin_id,expiry_date,reason_code,by_name)
    select 'adjustment', item_id, 'H1', 1, bin_id, expiry_date, 'FOUND', 'Andi' from inventory_detail where bin_code='CG10C01' and batch_lot='H1'$q$, 'Keterangan adjustment wajib%')
  and pg_temp.fails($q$insert into movements (type,item_id,batch_lot,quantity,to_bin_id,expiry_date,note,reason_code)
    select 'adjustment', item_id, 'H1', 1, bin_id, expiry_date, 'x', 'FOUND' from inventory_detail where bin_code='CG10C01' and batch_lot='H1'$q$, 'Nama petugas wajib%'));
insert into movements (type,item_id,batch_lot,quantity,to_bin_id,expiry_date,note,reason_code,by_name)
select 'adjustment', item_id, 'H1', 2, bin_id, expiry_date, 'ketemu di lorong', 'FOUND', 'Andi' from inventory_detail where bin_code='CG10C01' and batch_lot='H1';
select pg_temp.check('within the limit it posts with reason and name', pg_temp.qty('CG10C01','H1') = 12
  and exists (select 1 from movements where note = 'ketemu di lorong' and reason_code = 'FOUND' and by_name = 'Andi'));
select pg_temp.check('above the limit a direct adjustment is refused',
  pg_temp.fails($q$insert into movements (type,item_id,batch_lot,quantity,to_bin_id,expiry_date,note,reason_code,by_name)
    select 'adjustment', item_id, 'H1', 25, bin_id, expiry_date, 'x', 'FOUND', 'Andi' from inventory_detail where bin_code='CG10C01' and batch_lot='H1'$q$, 'Adjustment 25 unit melebihi batas 20 unit%'));
select set_config('t.req', request_adjustment('CG10C01','550044709','H1','2031-01-01',-12,'LOST','hilang saat opname','Andi')::text, false);
select pg_temp.check('the requester cannot approve their own request',
  pg_temp.fails(format($q$select decide_adjustment(%L, true, null, 'ANDI')$q$, current_setting('t.req')), 'Yang menyetujui harus orang lain%'));
select pg_temp.check('a rejection needs a reason',
  pg_temp.fails(format($q$select decide_adjustment(%L, false, '', 'Budi')$q$, current_setting('t.req')), 'Alasan penolakan wajib%'));
select decide_adjustment(current_setting('t.req')::uuid, true, 'dicek CCTV', 'Budi');
select pg_temp.check('approved request posts one adjustment with both names',
  pg_temp.qty('CG10C01','H1') = 0
  and (select count(*) = 1 from movements where ref_id = current_setting('t.req')::uuid and reason_code = 'LOST'
       and by_name = 'Andi' and approved_by_name = 'Budi')
  and (select status from adjustment_requests where id = current_setting('t.req')::uuid) = 'APPROVED');
select pg_temp.check('a decided request cannot be decided again',
  pg_temp.fails(format($q$select decide_adjustment(%L, true, null, 'Citra')$q$, current_setting('t.req')), 'Permintaan tidak ada atau sudah diputuskan%'));
select pg_temp.check('a request for new stock needs an expiry; cannot take more than there is',
  pg_temp.fails($q$select request_adjustment('CG12C01','550044709','N1',null,30,'FOUND','x','Andi')$q$, 'Tanggal expired wajib%')
  and pg_temp.fails($q$select request_adjustment('CG10C02','550044709','H2','2030-06-01',-21,'LOST','x','Andi')$q$, 'Stok tinggal 20%'));
-- Identity correction carries a hold with the cartons.
select place_hold('LINE','CG10C02','550044709','H2','2030-06-01',5,'INVESTIGATION','cek label','Andi');
select correct_stock_identity('CG10C02','550044709','H2','2030-06-01',null,'2030-06-02','salah ketik expired','Budi');
select pg_temp.check('identity correction moves the hold to the corrected record',
  (select held = 5 and expiry_date = '2030-06-02' from inventory_detail where bin_code='CG10C02' and batch_lot='H2')
  and exists (select 1 from movements where note like 'KOREKSI CG10C02%' and reason_code = 'DATA_ENTRY' and by_name = 'Budi'));
select release_hold((select id from stock_holds where status='ACTIVE' and batch_lot='H2'), 'label benar', 'Budi');

-- ---- 0019 counts -----------------------------------------------------
select set_config('t.c1', create_count_task('CG10C02', 'uji')::text, false);
select set_config('t.r', submit_count(current_setting('t.c1')::uuid, '[{"sku":"550044709","batch_lot":"H2","expiry_date":"2030-06-02","quantity":20}]', 'Andi')::text, false);
select pg_temp.check('a count equal to the system is COUNTED at once',
  current_setting('t.r')::jsonb->>'status' = 'COUNTED');
select set_config('t.r', apply_count(current_setting('t.c1')::uuid, null, null, 'Budi')::text, false);
select pg_temp.check('applying an exact count needs no reason and posts nothing; it is a hit',
  current_setting('t.r')::jsonb = '{"adjustments":0,"variance":0}'
  and (select variance_qty = 0 and system_qty = 20 and first_variance_qty = 0 from count_accuracy where id = current_setting('t.c1')::uuid));
select set_config('t.c2', create_count_task('CG10C02', 'uji 2')::text, false);
select submit_count(current_setting('t.c2')::uuid, '[{"sku":"550044709","batch_lot":"H2","expiry_date":"2030-06-02","quantity":17}]', 'Andi');
select set_config('t.r', submit_count(current_setting('t.c2')::uuid, '[{"sku":"550044709","batch_lot":"H2","expiry_date":"2030-06-02","quantity":20}]', 'Budi')::text, false);
select pg_temp.check('a recount that matches the system clears the first count',
  current_setting('t.r')::jsonb->>'status' = 'COUNTED');
select set_config('t.r', apply_count(current_setting('t.c2')::uuid, null, null, 'Citra')::text, false);
select pg_temp.check('... and applying it changes nothing, but the first count shows as a miss',
  (current_setting('t.r')::jsonb->>'adjustments')::int = 0
  and (select variance_qty = 0 and first_variance_qty = 3 from count_accuracy where id = current_setting('t.c2')::uuid));
select set_config('t.c3', create_count_task('CG10C02', 'uji 3')::text, false);
select submit_count(current_setting('t.c3')::uuid, '[]', 'Andi');
select submit_count(current_setting('t.c3')::uuid, '[{"sku":"550044709","batch_lot":"H2","expiry_date":"2030-06-02","quantity":10}]', 'Budi');
select pg_temp.check('two counts that disagree with each other and the system: recount again',
  (select status from count_tasks where id = current_setting('t.c3')::uuid) = 'RECOUNT');
select set_config('t.r', submit_count(current_setting('t.c3')::uuid, '[{"sku":"550044709","batch_lot":"H2","expiry_date":"2030-06-02","quantity":5}]', 'Citra')::text, false);
select pg_temp.check('after three counts the supervisor decides',
  current_setting('t.r')::jsonb->>'status' = 'COUNTED');
select pg_temp.check('but a difference within the limit can be applied; above the limit needs two agreeing counts',
  (apply_count(current_setting('t.c3')::uuid, 'uji', 'LOST', 'Dewi')->>'variance')::numeric = 15);
select set_config('t.c4', create_count_task('CG10C02', 'uji 4')::text, false);
select submit_count(current_setting('t.c4')::uuid, '[]', 'Andi');
select submit_count(current_setting('t.c4')::uuid, '[{"sku":"550044709","batch_lot":"H2","expiry_date":"2030-06-02","quantity":40}]', 'Budi');
select submit_count(current_setting('t.c4')::uuid, '[{"sku":"550044709","batch_lot":"H2","expiry_date":"2030-06-02","quantity":35}]', 'Citra');
select pg_temp.check('a 30-carton difference without two agreeing counts is refused',
  pg_temp.fails(format($q$select apply_count(%L, null, 'FOUND', 'Dewi')$q$, current_setting('t.c4')), 'Selisih 30 unit di atas batas%'));
select pg_temp.check('the recount status is visible on the detail view',
  (select rounds = 3 and status = 'COUNTED' and counted_by_name = 'Citra' from count_task_detail where id = current_setting('t.c4')::uuid));
select close_count(current_setting('t.c4')::uuid, 'hitung ulang besok', 'Dewi');

-- ---- 0020 receiving --------------------------------------------------
select pg_temp.as_user('op');
select pg_temp.check('operator cannot create a receipt',
  pg_temp.fails($q$select create_receipt('DO-1', null, null, null, '[{"sku":"550044709","quantity":10}]', 'Andi')$q$, 'Hanya supervisor%'));
select pg_temp.as_user('sup');
select set_config('t.rc', create_receipt('do-77', '2026-09-27', 'L 1234 AB', null,
  '[{"sku":"550044709","quantity":44},{"sku":"550058593","batch_lot":"09F26JJ","quantity":30},{"sku":"550044709","batch_lot":"ZZ","quantity":5}]', 'Andi')::text, false);
select pg_temp.check('document numbers are unique',
  pg_temp.fails($q$select create_receipt('DO-77', null, null, null, '[{"sku":"550044709","quantity":1}]', 'Andi')$q$, 'Dokumen DO-77 sudah%'));
select pg_temp.as_user('op');
select pg_temp.check('an expiry that disagrees with the batch code is refused unless confirmed',
  pg_temp.fails(format($q$select record_receipt(%L, '[{"sku":"550058593","batch_lot":"09F26JJ","expiry_date":"2030-09-06","quantity":30,"to_bin_code":"CG12C01"}]', 'Eko')$q$, current_setting('t.rc')),
    'Palet 1: expired 06-09-2030 tidak cocok dengan batch 09F26JJ (seharusnya 09-06-2030)%'));
select pg_temp.check('good stock needs a real bin, not quarantine',
  pg_temp.fails(format($q$select record_receipt(%L, '[{"sku":"550058593","batch_lot":"09F26JJ","expiry_date":"2030-06-09","quantity":30,"to_bin_code":"QUARANTINE"}]', 'Eko')$q$, current_setting('t.rc')), '%tidak ke karantina%'));
select record_receipt(current_setting('t.rc')::uuid, '[
  {"sku":"550044709","batch_lot":"14H26JJ","expiry_date":"2030-08-14","quantity":40,"damaged_qty":2,"to_bin_code":"CG12C01"},
  {"sku":"550058593","batch_lot":"09F26JJ","expiry_date":"2030-06-09","quantity":30,"to_bin_code":"CG12C02"},
  {"sku":"550044709","batch_lot":"X9","expiry_date":"2031-01-01","quantity":3,"to_bin_code":"CG12C01"}]', 'Eko');
select pg_temp.check('comparison: batch-less line 44 vs 43 good + 2 rusak = OVER; ZZ missing; 09F26JJ ok',
  (select string_agg(sku || '/' || batch_lot || '=' || result, ' ' order by sku, batch_lot) from receipt_compare where receipt_id = current_setting('t.rc')::uuid)
  = '550044709/=OVER 550044709/ZZ=MISSING 550058593/09F26JJ=OK');
select pg_temp.as_user('sup');
select pg_temp.check('the checker cannot post their own check',
  pg_temp.fails(format($q$select post_receipt(%L, 'x', 'eko')$q$, current_setting('t.rc')), 'Yang memposting harus orang lain%'));
select pg_temp.check('differences need a note before posting',
  pg_temp.fails(format($q$select post_receipt(%L, '', 'Budi')$q$, current_setting('t.rc')), 'Ada 2 selisih dengan dokumen%'));
select post_receipt(current_setting('t.rc')::uuid, 'ZZ tidak dikirim, sudah lapor Shell', 'Budi');
select pg_temp.check('posting puts good stock in its bins and damaged in quarantine on hold',
  pg_temp.qty('CG12C01','14H26JJ') = 40 and pg_temp.qty('CG12C02','09F26JJ') = 30 and pg_temp.qty('CG12C01','X9') = 3
  and (select held = 2 and hold_reasons = 'DAMAGED' from inventory_detail where bin_code = 'QUARANTINE' and batch_lot = '14H26JJ')
  and (select count(*) = 4 from movements where ref_id = current_setting('t.rc')::uuid and type = 'inbound' and by_name = 'Eko' and approved_by_name = 'Budi'));
select pg_temp.check('a posted receipt is closed',
  pg_temp.fails(format($q$select record_receipt(%L, '[{"sku":"550044709","batch_lot":"A","expiry_date":"2031-01-01","quantity":1,"to_bin_code":"CG12C01"}]', 'Eko')$q$, current_setting('t.rc')), '%sudah posted%'));

-- ---- 0021 reconciliation ---------------------------------------------
select set_config('t.rec', create_stock_recon('2026-09-27', 'sap.xlsx', null,
  '[{"sku":"550058593","uom":"CAR","unrestricted":61,"blocked":0},{"sku":"550058593","uom":"CAR","unrestricted":0,"blocked":0},{"sku":"999000111","uom":"CAR","unrestricted":7,"blocked":0}]',
  '[{"sku":"550058593","pending_gi":6}]', 'Budi')::text, false);
select pg_temp.check('SAP 61 vs ours: diff = SAP - (ours + pending GI)',
  (select sap_unrestricted = 61 and pending_gi = 6 and diff_unrestricted = 61 - (wms_unrestricted + 6)
   from stock_recon_lines where recon_id = current_setting('t.rec')::uuid and sku = '550058593'));
select pg_temp.check('a SKU SAP has but the master does not is still listed',
  (select item_id is null and diff_unrestricted = 7 from stock_recon_lines where recon_id = current_setting('t.rec')::uuid and sku = '999000111'));
select pg_temp.check('quarantine / held stock is compared with SAP blocked',
  (select wms_blocked >= 2 from stock_recon_lines where recon_id = current_setting('t.rec')::uuid and sku = '550044709'));
select set_config('t.r', request_recon_counts((select id from stock_recon_lines where recon_id = current_setting('t.rec')::uuid and sku = '550058593'), 'Budi')::text, false);
select pg_temp.check('recount request opens count tasks for every bin of the SKU',
  (current_setting('t.r')::jsonb->>'count_tasks')::int = (select count(distinct bin_code) from inventory_detail where sku = '550058593' and bin_status = 'active')
  and exists (select 1 from count_tasks where source = 'RECON' and status = 'OPEN'));
select pg_temp.check('explaining a line needs a remark',
  pg_temp.fails(format($q$select update_recon_line(%L, 'EXPLAINED', '', 'Budi')$q$,
    (select id from stock_recon_lines where recon_id = current_setting('t.rec')::uuid and sku = '999000111')), 'Tulis penjelasan%'));
select update_recon_line((select id from stock_recon_lines where recon_id = current_setting('t.rec')::uuid and sku = '999000111'),
  'EXPLAINED', 'SKU belum ada di master, stok di gudang lain', 'Budi');
select pg_temp.check('closing with open differences needs a note',
  pg_temp.fails(format($q$select close_stock_recon(%L, '', 'Budi')$q$, current_setting('t.rec')), '%selisih belum dijelaskan%'));
select close_stock_recon(current_setting('t.rec')::uuid, 'lanjut minggu depan', 'Budi');
select pg_temp.check('summary counts SKUs and matches',
  (select skus >= 3 and status = 'CLOSED' from stock_recon_summary where id = current_setting('t.rec')::uuid));

-- ---- 0022 FEFO on actual picks ---------------------------------------
reset role;
-- 550058593: older R8 (2030-01-01) in CG11C02, newer R7 (2031-05-05) in CG11C01 (30 - 6 picked = 24).
select set_config('request.jwt.claim.sub', '', false);
insert into movements (type,item_id,batch_lot,quantity,to_bin_id,expiry_date,note)
values ('adjustment', (select id from items where sku='550058593'), 'R8', 10, (select id from bins where bin_code='CG11C02'), '2030-01-01', 'fixture');
set role authenticated;
select pg_temp.as_user('sup');
-- One transaction = one now(): stamp the picks later so they are not "the same posting" as the fixture.
insert into movements (type,item_id,batch_lot,quantity,from_bin_id,expiry_date,note)
select 'picking', item_id, 'R7', 4, bin_id, expiry_date, 'ambil yang baru' from inventory_detail where bin_code='CG11C01' and batch_lot='R7';
insert into movements (type,item_id,batch_lot,quantity,from_bin_id,expiry_date,note)
select 'picking', item_id, 'R8', 1, bin_id, expiry_date, 'ambil yang lama' from inventory_detail where bin_code='CG11C02' and batch_lot='R8';
reset role;
alter table movements disable trigger movements_immutable;
update movements set created_at = created_at + interval '1 minute' where note = 'ambil yang baru';
update movements set created_at = created_at + interval '2 minutes' where note = 'ambil yang lama';
alter table movements enable trigger movements_immutable;
set role authenticated;
select pg_temp.as_user('sup');
create temp table _fefo1 as select * from fefo_exceptions(now() - interval '1 day', now() + interval '1 day');
select pg_temp.check('taking the newer batch while the oldest (R8, CG11C02) waits is a FEFO exception',
  (select count(*) = 1 and bool_and(older_expiry = '2030-01-01' and older_bins like '%CG11C02%') from _fefo1 where note = 'ambil yang baru'));
select pg_temp.check('taking the oldest batch is not an exception',
  not exists (select 1 from _fefo1 where note = 'ambil yang lama'));
select pg_temp.check('picks counted for the FEFO rate', fefo_pick_count(now() - interval '1 day', now() + interval '1 day') >= 3);
-- R8 on hold before the pick (hold stamped now(), the pick now()+1 min): it was not available then.
select place_hold('LINE','CG11C02','550058593','R8','2030-01-01',9,'QC_HOLD','tunggu QA','Andi');
create temp table _fefo2 as select * from fefo_exceptions(now() - interval '1 day', now() + interval '1 day');
select pg_temp.check('stock on hold at the moment of the pick is not counted as available (9 of R8''s 10 held)',
  (select a.older_qty - b.older_qty = 9 and b.older_expiry = '2030-01-01'
   from _fefo1 a join _fefo2 b on b.movement_id = a.movement_id where a.note = 'ambil yang baru'));

-- ---- 0023 pick confirmation ------------------------------------------
select pg_temp.as_user('adm');
select set_inventory_policy('{"require_scan_on_pick":true}');
select set_item_control('550044709', '8994123456789', null, null);
reset role; drop table if exists _replace; drop table if exists _wave_ids; set role authenticated; select pg_temp.as_user('adm');  -- save_plan's temp table, once per transaction
select save_plan('2026-12-03', '{
  "waves":[{"wave_no":"1","shipment_numbers":["SC1"]}],
  "tasks":[{"wave_no":"1","shipment_number":"SC1","task_type":"PICK","sku":"550044709","from_bin":"CG12C01","batch_lot":"14H26JJ","expiry_date":"2030-08-14","quantity":4,"seq":1}],
  "outbound":[{"wave_no":"1","shipment_number":"SC1","sku":"550044709","quantity_requested":4,"quantity_allocated":4}]}'::jsonb);
select pg_temp.as_user('op');
select pg_temp.check('the picker''s name is required',
  pg_temp.fails($q$select post_task_by((select id from pick_tasks where shipment_number='SC1'), p_scanned => '8994123456789')$q$, 'Nama picker wajib%'));
select pg_temp.check('with scan-on-pick a SKU with a barcode needs the scan',
  pg_temp.fails($q$select post_task_by((select id from pick_tasks where shipment_number='SC1'), p_by_name => 'Fajar')$q$, 'Scan barcode karton SKU 550044709%'));
select pg_temp.check('scanning another item is refused',
  pg_temp.fails($q$select post_task_by((select id from pick_tasks where shipment_number='SC1'), p_by_name => 'Fajar', p_scanned => '550058593')$q$, 'Barang salah: yang di-scan SKU 550058593, tugas ini SKU 550044709%'));
select pg_temp.check('the right carton posts; the movement carries the picker''s name',
  post_task_by((select id from pick_tasks where shipment_number='SC1'), p_by_name => 'Fajar', p_scanned => '8994123456789')->>'result' = 'POSTED'
);
select pg_temp.check('... recorded on the ledger',
  exists (select 1 from movements where task_id = (select id from pick_tasks where shipment_number='SC1') and by_name = 'Fajar'));

rollback;
