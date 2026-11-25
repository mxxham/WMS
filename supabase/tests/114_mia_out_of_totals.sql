-- MIA out of every stock total (0154): inventory_detail / bin_summary / the daily WMS report / Buku stok leave MIA out,
-- inventory_detail_all keeps it (Lacak batch), and saving the layout gives MIA no 3D position.
-- Runs in a transaction and rolls back. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users values
  ('a1141111-1111-1111-1111-111111111111','inv114@x','{"name":"Inv 114"}') on conflict do nothing;
update profiles set job = 'inventory' where id = 'a1141111-1111-1111-1111-111111111111';
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when coalesce(ok, false) then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', p::text, true); end $$;
grant execute on function pg_temp.check(text, boolean), pg_temp.as_user(uuid) to authenticated;

create temp table f114 as
  select (select id from items where sku = '550058593') as a_id,
         (select b.id from bins b
           where b.bin_code ~ '^C[A-Z][0-9]{2}[A-E][0-9]{2}$' and b.status = 'active' and public.bin_usable(b.id)
             and not exists (select 1 from inventory i where i.bin_id = b.id)
           order by b.bin_code limit 1) as rack_id,
         (select b.bin_code from bins b
           where b.bin_code ~ '^C[A-Z][0-9]{2}[A-E][0-9]{2}$' and b.status = 'active' and public.bin_usable(b.id)
             and not exists (select 1 from inventory i where i.bin_id = b.id)
           order by b.bin_code limit 1) as rack_code;
create temp table day114 as select (now() at time zone 'Asia/Jakarta')::date as d;
grant select on f114, day114 to authenticated;
-- the Buku stok row of the SKU before the test's movements
create temp table b114 as select * from ledger_wms_book((select d from day114)) where sku = '550058593';

insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, reason_code, note, by_name)
select 'adjustment', a_id, 'T114', 10, rack_id, '2030-01-01', 'FOUND', 'uji 114', 'Uji' from f114;

set role authenticated;
select pg_temp.as_user('a1141111-1111-1111-1111-111111111111');
select mia_move_in((select rack_code from f114), '550058593', 'T114', '2030-01-01', 4, 'uji 114', 'Inv');
select mia_book('550058593', 'T114B', '2031-01-01', 3, 'uji 114', 'Inv');
reset role;

-- ---------------------------------------------------------------------
-- 1  The views
-- ---------------------------------------------------------------------
select pg_temp.check('MIA holds 7 cartons of the SKU (4 moved in + 3 booked)',
  (select coalesce(sum(quantity), 0) = 7 from inventory i join bins b on b.id = i.bin_id
    where b.zone = 'MIA' and i.item_id = (select a_id from f114)));
select pg_temp.check('inventory_detail has no MIA row, inventory_detail_all has them',
  (select count(*) = 0 from inventory_detail where zone = 'MIA')
  and (select count(*) = 2 from inventory_detail_all where zone = 'MIA' and sku = '550058593'));
select pg_temp.check('bin_summary does not list the MIA bin; the rack bin shows its 6 left',
  (select count(*) = 0 from bin_summary where bin_code = 'MIA')
  and (select total_qty = 6 from bin_summary where bin_code = (select rack_code from f114)));
select pg_temp.check('inventory_detail keeps the same columns as before (23, bin_owner and bin_kind last)',
  (select count(*) = 23 from information_schema.columns where table_schema = 'public' and table_name = 'inventory_detail')
  and (select column_name from information_schema.columns where table_schema = 'public' and table_name = 'inventory_detail' and ordinal_position = 23) = 'bin_kind');

-- ---------------------------------------------------------------------
-- 2  The daily WMS report and Buku stok
-- ---------------------------------------------------------------------
select pg_temp.check('the daily WMS report has no MIA bin row',
  (select count(*) = 0 from wms_day_report((select d from day114)) where bin_code = 'MIA'));
select pg_temp.check('Buku stok: the day counts +6 (10 into the rack, 4 of them parked in MIA), the 3 booked in MIA do not count',
  (select a.akhir_unrest - coalesce(b.akhir_unrest, 0) = 6 and a.other_unrest - coalesce(b.other_unrest, 0) = 6
     from ledger_wms_book((select d from day114)) a left join b114 b on b.sku = a.sku where a.sku = '550058593'));
select pg_temp.check('Buku stok end-of-day stock = the stock the SAP comparison counts (MIA left out)',
  (select unrest + block from ledger_wms_end((select d from day114)) where item_id = (select a_id from f114))
  = (select physical from wms_stock_by_sku() where item_id = (select a_id from f114)));

-- ---------------------------------------------------------------------
-- 3  3D positions
-- ---------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '', true);
select recompute_bin_positions();
select pg_temp.check('saving the layout gives MIA no floor position',
  (select pos_x is null from bins where bin_code = 'MIA'));

rollback;
