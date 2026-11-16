-- Inventory → Stok direct adjustment (0140). Runs in a transaction and rolls back.
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
  select coalesce(sum(quantity), 0) from inventory_detail where bin_code = 'CG10C01' and batch_lot = 'T104' $$;
create or replace function pg_temp.as_user(p text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', case p when 'op' then '11111111-1111-1111-1111-111111111111'
    else '22222222-2222-2222-2222-222222222222' end, false) $$;

-- Fixture (no user: a system row). CG10C01: 550044709 T104 x44 exp 2031-01-01.
delete from inventory where bin_id = (select id from bins where bin_code = 'CG10C01');
insert into movements (type,item_id,batch_lot,quantity,to_bin_id,expiry_date,note)
select 'adjustment', (select id from items where sku='550044709'), 'T104', 44, (select id from bins where bin_code='CG10C01'), '2031-01-01'::date, 'fixture';
select set_config('t.requests', (select count(*) from adjustment_requests)::text, false);

set role authenticated;

select pg_temp.as_user('op');
select pg_temp.check('an operator cannot adjust a stock line',
  pg_temp.fails($q$select adjust_stock_line('CG10C01','550044709','T104','2031-01-01',25,'FOUND','ketemu','Andi')$q$, 'Hanya supervisor atau admin%'));

select pg_temp.as_user('sup');
select pg_temp.check('it needs a quantity, a reason code, a note and a name',
  pg_temp.fails($q$select adjust_stock_line('CG10C01','550044709','T104','2031-01-01',0,'FOUND','ketemu','Andi')$q$, 'Jumlah adjustment tidak boleh 0%')
  and pg_temp.fails($q$select adjust_stock_line('CG10C01','550044709','T104','2031-01-01',25,null,'ketemu','Andi')$q$, 'Kode alasan wajib%')
  and pg_temp.fails($q$select adjust_stock_line('CG10C01','550044709','T104','2031-01-01',25,'FOUND',' ','Andi')$q$, 'Keterangan wajib%')
  and pg_temp.fails($q$select adjust_stock_line('CG10C01','550044709','T104','2031-01-01',25,'FOUND','ketemu',' ')$q$, 'Nama petugas wajib%'));
select pg_temp.check('a reason code outside the list is refused',
  pg_temp.fails($q$select adjust_stock_line('CG10C01','550044709','T104','2031-01-01',25,'WHATEVER','ketemu','Andi')$q$, '%reason_code%'));
select pg_temp.check('only a stock line that exists: another batch or expiry is refused',
  pg_temp.fails($q$select adjust_stock_line('CG10C01','550044709','NOPE','2031-01-01',25,'FOUND','ketemu','Andi')$q$, 'Baris stok CG10C01%')
  and pg_temp.fails($q$select adjust_stock_line('CG10C01','550044709','T104','2031-01-02',25,'FOUND','ketemu','Andi')$q$, 'Baris stok CG10C01%'));
select pg_temp.check('it cannot take more than there is',
  pg_temp.fails($q$select adjust_stock_line('CG10C01','550044709','T104','2031-01-01',-45,'LOST','hilang','Andi')$q$, 'Stok tinggal 44%'));
select pg_temp.check('nothing was posted by the refused calls', pg_temp.qty() = 44);

select set_config('t.mov', adjust_stock_line('CG10C01','550044709','T104','2031-01-01',25,'FOUND','ketemu di lorong','Andi')::text, false);
select pg_temp.check('+25 (above the limit of 20) posts at once', pg_temp.qty() = 69);
select pg_temp.check('the movement carries reason, note and name, and no approver',
  (select type = 'adjustment' and quantity = 25 and reason_code = 'FOUND' and note = 'ketemu di lorong' and by_name = 'Andi'
          and approved_by_name is null and user_id = '22222222-2222-2222-2222-222222222222'
   from movements where id = current_setting('t.mov')::uuid));
select adjust_stock_line('CG10C01','550044709','T104','2031-01-01',-30,'LOST','hilang saat opname','Andi');
select pg_temp.check('-30 posts at once', pg_temp.qty() = 39);
select pg_temp.check('no approval request was made',
  (select count(*) from adjustment_requests) = current_setting('t.requests')::bigint);

-- The limit itself is unchanged outside this function.
select adjust_stock_line('CG10C01','550044709','T104','2031-01-01',5,'FOUND','ketemu','Andi');
select pg_temp.check('a direct adjustment above the limit is still refused',
  pg_temp.fails($q$insert into movements (type,item_id,batch_lot,quantity,to_bin_id,expiry_date,note,reason_code,by_name)
    select 'adjustment', item_id, 'T104', 25, bin_id, expiry_date, 'x', 'FOUND', 'Andi' from inventory_detail where bin_code='CG10C01' and batch_lot='T104'$q$, 'Adjustment 25 unit melebihi batas 20 unit%'));
select pg_temp.check('the approval flag does not outlive the call', pg_temp.qty() = 44
  and coalesce(current_setting('app.adjust_approved', true), '') = '');

rollback;
