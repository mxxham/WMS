-- Wrong item in a bin, swapped bins (0013). Runs in a transaction and rolls back.
-- Run after 00 stub, migrations, seed. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users values ('11111111-1111-1111-1111-111111111111','op@x','{"name":"Operator"}'),
                              ('22222222-2222-2222-2222-222222222222','sup@x','{"name":"Supervisor"}') on conflict do nothing;
update profiles set role='supervisor' where id='22222222-2222-2222-2222-222222222222';

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.fails(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return sqlerrm like p_like; end $$;
-- 'SKU:batch:qty' lines of a bin, sorted
create or replace function pg_temp.bin(p_bin text) returns text language sql as $$
  select coalesce(string_agg(sku || ':' || batch_lot || ':' || quantity::int, ' ' order by sku, batch_lot), '')
  from inventory_detail where bin_code = p_bin $$;

-- Fixture: CG06C01 holds 550044709 X1 x40; CG06C02 holds 550058593 Y1 x12 and 550044709 X1 x5.
delete from inventory where bin_id in (select id from bins where bin_code in ('CG06C01','CG06C02','CG07C01'));
insert into movements (type,item_id,batch_lot,quantity,to_bin_id,expiry_date,note)
select 'adjustment', (select id from items where sku=s), bt, q, (select id from bins where bin_code=b), '2031-06-06', 'fixture'
from (values ('CG06C01','550044709','X1',40),('CG06C02','550058593','Y1',12),('CG06C02','550044709','X1',5)) v(b,s,bt,q);

set role authenticated;

-- Roles
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select pg_temp.check('operator cannot replace an item',
  pg_temp.fails($q$select replace_stock_item('CG06C01','550044709','X1','2031-06-06','550058593','Y1','2031-06-06',40,'DATA_ENTRY','x','Citra','Dewi')$q$, 'Hanya supervisor%'));
select pg_temp.check('operator cannot swap bins',
  pg_temp.fails($q$select swap_bin_contents('CG06C01', 'CG06C02', 'x', 'Citra')$q$, 'Hanya supervisor%'));
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

-- Swap
select pg_temp.check('swap needs a reason', pg_temp.fails($q$select swap_bin_contents('CG06C01', 'CG06C02', '', 'Citra')$q$, 'Alasan wajib%'));
select pg_temp.check('swap two empty bins is refused', pg_temp.fails($q$select swap_bin_contents('CG07C01', 'CG07C02', 'x', 'Citra')$q$, 'Kedua bin kosong%'));
select swap_bin_contents('cg06c01', 'CG06C02', 'isi tertukar', 'Citra');
select pg_temp.check('after swap CG06C01 holds what CG06C02 had', pg_temp.bin('CG06C01') = '550044709:X1:5 550058593:Y1:12');
select pg_temp.check('after swap CG06C02 holds what CG06C01 had (same identity split back correctly)', pg_temp.bin('CG06C02') = '550044709:X1:40');
select pg_temp.check('swap is recorded as transfers',
  (select count(*) = 3 from movements where type = 'transfer' and note like 'TUKAR CG06C01 <-> CG06C02%'));
select swap_bin_contents('CG06C02', 'CG07C01', 'ke bin kosong', 'Citra');
select pg_temp.check('swap with an empty bin moves everything across',
  pg_temp.bin('CG06C02') = '' and pg_temp.bin('CG07C01') = '550044709:X1:40');

-- Replace item
select pg_temp.check('replace needs the right expiry',
  pg_temp.fails($q$select replace_stock_item('CG07C01','550044709','X1','2031-06-06','550058593','Z9',null,null,'DATA_ENTRY','x','Citra','Dewi')$q$, 'Tanggal expired%'));
select pg_temp.check('replace with an unknown SKU is refused',
  pg_temp.fails($q$select replace_stock_item('CG07C01','550044709','X1','2031-06-06','999','Z9','2031-07-07',null,'DATA_ENTRY','x','Citra','Dewi')$q$, 'SKU 999 tidak ada%'));
select pg_temp.check('replace above the limit needs a second person',
  pg_temp.fails($q$select replace_stock_item('CG07C01','550044709','X1','2031-06-06','550058593','Z9','2031-07-07',36,'DATA_ENTRY','x','Citra',null)$q$, 'Nama penyetuju%')
  and pg_temp.fails($q$select replace_stock_item('CG07C01','550044709','X1','2031-06-06','550058593','Z9','2031-07-07',36,'DATA_ENTRY','x','Citra','citra')$q$, 'Penyetuju harus orang lain%'));
select replace_stock_item('CG07C01','550044709','X1','2031-06-06','550058593','Z9','2031-07-07',36,'DATA_ENTRY','item salah saat putaway','Citra','Dewi');
select pg_temp.check('wrong item replaced by the right SKU/batch/qty', pg_temp.bin('CG07C01') = '550058593:Z9:36');
select pg_temp.check('replace is two adjustments (-old, +new)',
  (select string_agg(quantity::int::text, ',' order by quantity) = '-40,36' from movements where note like 'GANTI ITEM CG07C01%'
   and reason_code = 'DATA_ENTRY' and by_name = 'Citra' and approved_by_name = 'Dewi'));
select pg_temp.check('replace where nothing changes is refused',
  pg_temp.fails($q$select replace_stock_item('CG07C01','550058593','Z9','2031-07-07','550058593','Z9','2031-07-07',36,'DATA_ENTRY','x','Citra','Dewi')$q$, 'Tidak ada yang berubah%'));

-- Open tasks block both
select save_plan('2026-10-07', '{
  "waves":[{"wave_no":"1","shipment_numbers":["SW1"]}],
  "tasks":[{"wave_no":"1","shipment_number":"SW1","task_type":"PICK","sku":"550058593","from_bin":"CG07C01","batch_lot":"Z9","expiry_date":"2031-07-07","quantity":6,"seq":1}],
  "outbound":[{"wave_no":"1","shipment_number":"SW1","sku":"550058593","quantity_requested":6,"quantity_allocated":6}]}'::jsonb);
select pg_temp.check('replace is refused while an open task uses that stock',
  pg_temp.fails($q$select replace_stock_item('CG07C01','550058593','Z9','2031-07-07','550044709','X1','2031-06-06',36,'DATA_ENTRY','x','Citra','Dewi')$q$, 'Stok ini dipakai tugas wave%'));
select pg_temp.check('swap is refused while an open task uses the bin',
  pg_temp.fails($q$select swap_bin_contents('CG06C01', 'CG07C01', 'x', 'Citra')$q$, 'Bin ini dipakai tugas wave%'));

rollback;
