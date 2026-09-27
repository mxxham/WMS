-- Fixed pickfaces (0009), cycle counts (0010), stock corrections (0011).
-- Runs in a transaction and rolls back. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
select set_config('t.op',  (select id::text from profiles where role = 'operator'   limit 1), false),
       set_config('t.sup', (select id::text from profiles where role = 'supervisor' limit 1), false);

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.qty(p_bin text, p_batch text) returns numeric language sql as $$
  select coalesce(sum(quantity), 0) from inventory_detail where bin_code = p_bin and batch_lot = p_batch $$;
create or replace function pg_temp.fails(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return sqlerrm like p_like; end $$;

-- Fixture: CG02A01 holds K1 x30 (exp 2031-01-01), CG02A02 empty.
delete from inventory where bin_id in (select id from bins where bin_code in ('CG02A01','CG02A02'));
delete from pickfaces where item_id in (select id from items where sku in ('550044709','550058593'));
insert into movements (type,item_id,batch_lot,quantity,to_bin_id,expiry_date,note)
values ('adjustment', (select id from items where sku='550044709'), 'K1', 30, (select id from bins where bin_code='CG02A01'), '2031-01-01', 'fixture');
set role authenticated;

-- ---- 0009 pickfaces --------------------------------------------------
select set_config('request.jwt.claim.sub', current_setting('t.op'), false);
select pg_temp.check('operator cannot set pickfaces',
  pg_temp.fails($q$select set_pickfaces('[{"sku":"550044709","bin_code":"CG02A02"}]')$q$, 'Hanya supervisor%'));
select set_config('request.jwt.claim.sub', current_setting('t.sup'), false);
select set_config('t.r', set_pickfaces('[{"sku":"550044709","bin_code":"cg02a02"}]')::text, false);
select pg_temp.check('supervisor sets a pickface',
  current_setting('t.r')::jsonb = '{"set":1,"cleared":0}' and (select bin_code from pickface_detail where sku='550044709') = 'CG02A02');
select pg_temp.check('a bin is the pickface of one SKU only',
  pg_temp.fails($q$select set_pickfaces('[{"sku":"550058593","bin_code":"CG02A02"}]')$q$, 'Bin CG02A02 sudah jadi pickface SKU 550044709'));
select set_config('t.r', set_pickfaces('[{"sku":"550044709","bin_code":"CG02A01"},{"sku":"550058593","bin_code":"CG02A02"}]')::text, false);
select pg_temp.check('swap in one call works',
  (current_setting('t.r')::jsonb->>'set')::int = 2 and (select bin_code from pickface_detail where sku='550058593') = 'CG02A02'
  and (select bin_code from pickface_detail where sku='550044709') = 'CG02A01');
select pg_temp.check('floor location refused',
  pg_temp.fails($q$select set_pickfaces('[{"sku":"550044709","bin_code":"STAGING"}]')$q$, '%bukan lokasi rak%'));
select set_config('t.r', set_pickfaces('[{"sku":"550058593","bin_code":""}]')::text, false);
select pg_temp.check('empty bin_code clears',
  current_setting('t.r')::jsonb = '{"set":0,"cleared":1}' and not exists (select 1 from pickface_detail where sku='550058593'));

-- ---- 0010 counts -----------------------------------------------------
select set_config('t.task', create_count_task('CG02A01', 'uji')::text, false);
select set_config('t.r', create_count_task('CG02A01', 'lagi')::text, false);
select pg_temp.check('second task for the same bin reuses the open one',
  current_setting('t.r') = current_setting('t.task')
  and (select reason from count_tasks where id = current_setting('t.task')::uuid) = 'uji; lagi');
select set_config('request.jwt.claim.sub', current_setting('t.op'), false);
select pg_temp.check('new stock in a count needs an expiry',
  pg_temp.fails(format($q$select submit_count(%L, '[{"sku":"550044709","batch_lot":"K2","quantity":5}]', 'Andi')$q$, current_setting('t.task')), 'Tanggal expired wajib%'));
select pg_temp.check('a count needs the counter''s name',
  pg_temp.fails(format($q$select submit_count(%L, '[]', ' ')$q$, current_setting('t.task')), 'Nama penghitung wajib%'));
-- Operator finds 28 of K1 and 5 of a batch the system does not know.
select submit_count(current_setting('t.task')::uuid,
  '[{"sku":"550044709","batch_lot":"K1","expiry_date":"2031-01-01","quantity":28},
    {"sku":"550044709","batch_lot":"K2","expiry_date":"2031-02-02","quantity":5}]', 'Andi');
select pg_temp.check('a count off from the system goes to a blind recount; stock unchanged',
  (select status from count_tasks where id = current_setting('t.task')::uuid) = 'RECOUNT' and pg_temp.qty('CG02A01','K1') = 30);
select pg_temp.check('the recount must be by someone else',
  pg_temp.fails(format($q$select submit_count(%L, '[]', ' andi ')$q$, current_setting('t.task')), 'Hitung ulang harus oleh orang lain%'));
select submit_count(current_setting('t.task')::uuid,
  '[{"sku":"550044709","batch_lot":"K1","expiry_date":"2031-01-01","quantity":28},
    {"sku":"550044709","batch_lot":"K2","expiry_date":"2031-02-02","quantity":5}]', 'Budi');
select pg_temp.check('two counts that agree confirm the difference',
  (select status from count_tasks where id = current_setting('t.task')::uuid) = 'COUNTED'
  and (select jsonb_array_length(counts) from count_tasks where id = current_setting('t.task')::uuid) = 2);
select pg_temp.check('operator cannot apply',
  pg_temp.fails(format($q$select apply_count(%L, null, 'COUNT_VARIANCE', 'Citra')$q$, current_setting('t.task')), 'Hanya supervisor%'));
select set_config('request.jwt.claim.sub', current_setting('t.sup'), false);
select pg_temp.check('a counter cannot apply their own count',
  pg_temp.fails(format($q$select apply_count(%L, 'uji', 'COUNT_VARIANCE', 'BUDI')$q$, current_setting('t.task')), 'Yang menerapkan harus orang lain%'));
select pg_temp.check('a difference needs a reason code',
  pg_temp.fails(format($q$select apply_count(%L, 'uji', null, 'Citra')$q$, current_setting('t.task')), 'Pilih kode alasan%'));
select set_config('t.r', apply_count(current_setting('t.task')::uuid, 'uji', 'COUNT_VARIANCE', 'Citra')::text, false);
select pg_temp.check('apply posts both differences (-2 K1, +5 K2) with reason, counter and approver',
  current_setting('t.r')::jsonb = '{"adjustments":2,"variance":7}'
  and pg_temp.qty('CG02A01','K1') = 28 and pg_temp.qty('CG02A01','K2') = 5
  and (select count(*) from movements where note = 'HITUNG CG02A01: uji' and reason_code = 'COUNT_VARIANCE'
       and by_name = 'Budi' and approved_by_name = 'Citra') = 2);
select pg_temp.check('accuracy row: system 30 at the first count, 7 off',
  (select system_qty = 30 and variance_qty = 7 and first_variance_qty = 7 and rounds = 2 from count_accuracy
   where id = current_setting('t.task')::uuid));
select pg_temp.check('an applied task is closed',
  pg_temp.fails(format($q$select apply_count(%L, null, 'COUNT_VARIANCE', 'Citra')$q$, current_setting('t.task')), 'Tugas belum dihitung%'));
select set_config('t.task2', create_count_task('CG02A01', 'kosong?')::text, false);
select submit_count(current_setting('t.task2')::uuid, '[]', 'Andi');
select submit_count(current_setting('t.task2')::uuid, '[]', 'Budi');
select set_config('t.r', apply_count(current_setting('t.task2')::uuid, null, 'LOST', 'Citra')::text, false);
select pg_temp.check('count of an empty bin zeroes every row',
  (current_setting('t.r')::jsonb->>'adjustments')::int = 2 and pg_temp.qty('CG02A01','K1') + pg_temp.qty('CG02A01','K2') = 0);
select set_config('t.task3', create_count_task('CG02A02', 'x')::text, false);
select pg_temp.check('close needs a reason',
  pg_temp.fails(format($q$select close_count(%L, ' ', 'Citra')$q$, current_setting('t.task3')), 'Alasan wajib%'));
select close_count(current_setting('t.task3')::uuid, 'salah bin', 'Citra');
select pg_temp.check('closed without changing stock',
  (select status from count_tasks where id = current_setting('t.task3')::uuid) = 'CLOSED');

-- Putaway conflict without a decision becomes a count task; resolved ones do not.
reset role;
insert into movements (type,item_id,batch_lot,quantity,to_bin_id,expiry_date,note,reason_code,by_name)
values ('adjustment', (select id from items where sku='550044709'), 'K1', 10, (select id from bins where bin_code='CG02A01'), '2031-01-01', 'fixture', 'FOUND', 'fixture');
set role authenticated;
select set_config('t.r', putaway_import('[{"line":9,"bin_code":"CG02A01","sku":"550044709","batch_lot":"K1","quantity":12,"expiry_date":"2031-01-01"}]', 'pa.xlsx', true)::text, false);
select pg_temp.check('putaway: unresolved qty conflict opens one count task with the sheet line',
  (current_setting('t.r')::jsonb->>'count_tasks')::int = 1
  and (select expected @> '[{"line":9,"quantity":12,"source":"pa.xlsx"}]' from count_tasks where status='OPEN'
       and bin_id=(select id from bins where bin_code='CG02A01')));
select pg_temp.check('putaway: preview opens no task, resolved conflict opens no task',
  (putaway_import('[{"line":9,"bin_code":"CG02A01","sku":"550044709","batch_lot":"K1","quantity":12,"expiry_date":"2031-01-01"}]', 'pa.xlsx', false)->>'count_tasks')::int = 0
  and (putaway_import('[{"line":9,"bin_code":"CG02A01","sku":"550044709","batch_lot":"K1","quantity":12,"expiry_date":"2031-01-01","action":"set"}]', 'pa.xlsx', true)->>'count_tasks')::int = 0);

-- ---- 0011 corrections ------------------------------------------------
select pg_temp.check('correction needs a reason',
  pg_temp.fails($q$select correct_stock_identity('CG02A01','550044709','K1','2031-01-01','K9',null,'','Citra')$q$, 'Alasan wajib%'));
select set_config('t.r', correct_stock_identity('CG02A01','550044709','K1','2031-01-01','K9',null,'label fisik','Citra')::text, false);
select pg_temp.check('batch correction moves the qty to the new identity with 2 ledger rows',
  current_setting('t.r')::jsonb @> '{"quantity":12,"batch_lot":"K9"}'
  and pg_temp.qty('CG02A01','K1') = 0 and pg_temp.qty('CG02A01','K9') = 12
  and (select count(*) from movements where note like 'KOREKSI CG02A01: label fisik%') = 2);
select set_config('t.r', correct_stock_identity('CG02A01','550044709','K9','2031-01-01',null,'2031-06-30','salah ketik','Citra')::text, false);
select pg_temp.check('expiry correction keeps the batch',
  (current_setting('t.r')::jsonb->>'expiry_date') = '2031-06-30'
  and (select expiry_date from inventory_detail where bin_code='CG02A01' and batch_lot='K9') = '2031-06-30');
reset role;
rollback;
