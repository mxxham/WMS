-- Inventory → Stok: add stock to an empty bin (0142). Runs in a transaction and rolls back.
-- Run after 00 stub, migrations, seed. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
-- 0132: on the floor this bin is lent to CKB 3PL; this test uses it as a Shell bin.
update public.bins set owner = 'SHELL' where bin_code = 'CG10C01';
reset role;
insert into auth.users values ('11111111-1111-1111-1111-111111111111','op@x','{"name":"Operator"}'),
                              ('22222222-2222-2222-2222-222222222222','sup@x','{"name":"Supervisor"}') on conflict do nothing;
update profiles set role='supervisor' where id='22222222-2222-2222-2222-222222222222';

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when coalesce(ok, false) then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.fails(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then
  if sqlerrm not like p_like then raise notice '   got: %', sqlerrm; end if;
  return sqlerrm like p_like; end $$;
create or replace function pg_temp.qty() returns numeric language sql as $$
  select coalesce(sum(quantity), 0) from inventory_detail where bin_code = 'CG10C01' $$;
create or replace function pg_temp.lines() returns numeric language sql as $$
  select count(*) from inventory_detail
  where bin_code = 'CG10C01' and item_id = (select id from items where sku = '550044709')
    and batch_lot = 'T106' $$;
create or replace function pg_temp.as_user(p text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', case p when 'op' then '11111111-1111-1111-1111-111111111111'
    else '22222222-2222-2222-2222-222222222222' end, false) $$;

-- Fixture: CG10C01 is empty; 0142 adds stock where there is none.
delete from inventory where bin_id = (select id from bins where bin_code = 'CG10C01');
select set_config('t.requests', (select count(*) from adjustment_requests)::text, false);

set role authenticated;

select pg_temp.as_user('op');
select pg_temp.check('an operator cannot add stock to an empty bin',
  pg_temp.fails($q$select create_stock_in_bin('CG10C01','550044709','T106','2032-06-30',24,'FOUND','ketemu','Andi')$q$, 'Hanya supervisor atau admin%'));

select pg_temp.as_user('sup');
select pg_temp.check('it needs a quantity above zero, a reason code, a note and a name',
  pg_temp.fails($q$select create_stock_in_bin('CG10C01','550044709','T106','2032-06-30',0,'FOUND','ketemu','Andi')$q$, 'Jumlah yang ditambahkan%')
  and pg_temp.fails($q$select create_stock_in_bin('CG10C01','550044709','T106','2032-06-30',-5,'FOUND','ketemu','Andi')$q$, 'Jumlah yang ditambahkan%')
  and pg_temp.fails($q$select create_stock_in_bin('CG10C01','550044709','T106','2032-06-30',24,null,'ketemu','Andi')$q$, 'Kode alasan wajib%')
  and pg_temp.fails($q$select create_stock_in_bin('CG10C01','550044709','T106','2032-06-30',24,'FOUND',' ','Andi')$q$, 'Keterangan wajib%')
  and pg_temp.fails($q$select create_stock_in_bin('CG10C01','550044709','T106','2032-06-30',24,'FOUND','ketemu',' ')$q$, 'Nama petugas wajib%'));
select pg_temp.check('a reason code outside the list is refused',
  pg_temp.fails($q$select create_stock_in_bin('CG10C01','550044709','T106','2032-06-30',24,'WHATEVER','ketemu','Andi')$q$, '%reason_code%'));
select pg_temp.check('the SKU must exist in master item',
  pg_temp.fails($q$select create_stock_in_bin('CG10C01','NOSUCHSKU','T106','2032-06-30',24,'FOUND','ketemu','Andi')$q$, 'SKU NOSUCHSKU tidak ada di master item%'));
select pg_temp.check('nothing was posted by the refused calls', pg_temp.qty() = 0);

select set_config('t.mov', create_stock_in_bin('CG10C01','550044709','T106','2032-06-30',24,'FOUND','ketemu di lorong','Andi')::text, false);
select pg_temp.check('adding 24 to an empty bin creates the stock line', pg_temp.qty() = 24);
select pg_temp.check('the movement carries reason, note and name, and no approver',
  (select type = 'adjustment' and quantity = 24 and reason_code = 'FOUND' and note = 'ketemu di lorong' and by_name = 'Andi'
          and approved_by_name is null and user_id = '22222222-2222-2222-2222-222222222222'
   from movements where id = current_setting('t.mov')::uuid));
select pg_temp.check('the new line carries the batch and expiry typed in',
  (select batch_lot = 'T106' and expiry_date = '2032-06-30'::date
   from inventory where bin_id = (select id from bins where bin_code = 'CG10C01')
     and item_id = (select id from items where sku = '550044709')));

select create_stock_in_bin('CG10C01','550044709','T106','2032-06-30',6,'FOUND','ketemu lagi','Andi');
select pg_temp.check('a second add to the same bin and batch adds up', pg_temp.qty() = 30 and pg_temp.lines() = 1);

select create_stock_in_bin('CG10C01','550044709','T106','2033-06-30',2,'FOUND','expired beda tahun','Andi');
select pg_temp.check('the same batch with another expiry is a second line (identity 0142)', pg_temp.qty() = 32 and pg_temp.lines() = 2);

select create_stock_in_bin('CG10C01','550044709','T106B','2032-06-30',36,'FOUND','satu palet utuh','Andi');
select pg_temp.check('above the approval limit it still posts at once (0140 decision)', pg_temp.qty() = 68);

select pg_temp.check('stock cannot be added to a bin lent to CKB 3PL',
  pg_temp.fails($q$select create_stock_in_bin('CG30A02','550044709','T106','2032-06-30',1,'FOUND','ketemu','Andi')$q$, '%dipinjam CKB 3PL%'));
select pg_temp.check('stock cannot be added to a pillar bin (NOT_PRESENT)',
  pg_temp.fails($q$select create_stock_in_bin('CE33A01','550044709','T106','2032-06-30',1,'FOUND','ketemu','Andi')$q$, '%stok tidak bisa masuk'));
select pg_temp.check('no approval request was made',
  (select count(*) from adjustment_requests) = current_setting('t.requests')::numeric);

rollback;
