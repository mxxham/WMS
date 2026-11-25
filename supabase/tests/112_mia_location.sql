-- MIA location (0152): the bin exists, nothing moves in or out of it except through the MIA functions
-- (app.mia_movement), it is not part of our side of the SAP comparison, and a full import never zeroes it.
-- Runs in a transaction and rolls back. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users values
  ('a1121111-1111-1111-1111-111111111111','adm112@x','{"name":"Adm 112"}') on conflict do nothing;
update profiles set job = 'admin' where id = 'a1121111-1111-1111-1111-111111111111';
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when coalesce(ok, false) then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.fails(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then
  if sqlerrm not like p_like then raise notice 'got: %', sqlerrm; end if;
  return sqlerrm like p_like; end $$;
create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', p::text, true); end $$;
grant execute on function pg_temp.check(text, boolean), pg_temp.fails(text, text), pg_temp.as_user(uuid) to authenticated;

-- Fixture: 10 cartons of an existing SKU in an empty Shell rack bin.
create temp table f112 as
  select (select id from items where sku = '550058593') as item_id,
         (select b.id from bins b
           where b.bin_code ~ '^C[A-Z][0-9]{2}[A-E][0-9]{2}$' and b.status = 'active' and public.bin_usable(b.id)
             and not exists (select 1 from inventory i where i.bin_id = b.id)
           order by b.bin_code limit 1) as rack_id,
         (select id from bins where bin_code = 'MIA') as mia_id;
grant select on f112 to authenticated;
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, reason_code, note, by_name)
select 'adjustment', item_id, 'T112', 10, rack_id, '2030-01-01', 'FOUND', 'uji 112', 'Uji' from f112;

-- ---------------------------------------------------------------------
-- 1  The bin and the guard
-- ---------------------------------------------------------------------
select pg_temp.check('MIA is an active floor bin in its own zone, shared (no owner), with a history line',
  (select zone = 'MIA' and status = 'active' and rack is null and owner is null from bins where bin_code = 'MIA')
  and exists (select 1 from bin_changes where bin_code = 'MIA' and field = 'CREATED'));

select pg_temp.check('stock cannot be moved into MIA by hand (transfer)',
  pg_temp.fails($q$insert into movements (type, item_id, batch_lot, quantity, from_bin_id, to_bin_id, expiry_date, note, by_name)
    select 'transfer', item_id, 'T112', 4, rack_id, mia_id, '2030-01-01', 'uji 112', 'Uji' from f112$q$, '%MIA%'));
select pg_temp.check('nor adjusted into MIA by hand',
  pg_temp.fails($q$insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, reason_code, note, by_name)
    select 'adjustment', item_id, 'T112', 4, mia_id, '2030-01-01', 'FOUND', 'uji 112', 'Uji' from f112$q$, '%MIA%'));
select pg_temp.check('the refused movements left nothing in MIA',
  (select coalesce(sum(quantity), 0) = 0 from inventory where bin_id = (select mia_id from f112)));

-- The MIA functions of the next migration switch this on around their own movements.
select set_config('app.mia_movement', 'on', true);
select set_config('app.adjust_approved', 'on', true);
insert into movements (type, item_id, batch_lot, quantity, from_bin_id, to_bin_id, expiry_date, note, by_name)
select 'transfer', item_id, 'T112', 4, rack_id, mia_id, '2030-01-01', 'uji 112', 'Uji' from f112;
select set_config('app.mia_movement', '', true);
select set_config('app.adjust_approved', '', true);

select pg_temp.check('with the switch on, a transfer rack -> MIA works: 4 in MIA, 6 left in the rack',
  (select quantity = 4 from inventory where bin_id = (select mia_id from f112) and item_id = (select item_id from f112) and batch_lot = 'T112')
  and (select quantity = 6 from inventory where bin_id = (select rack_id from f112) and item_id = (select item_id from f112) and batch_lot = 'T112'));
select pg_temp.check('and with it off again, MIA -> rack is refused too',
  pg_temp.fails($q$insert into movements (type, item_id, batch_lot, quantity, from_bin_id, to_bin_id, expiry_date, note, by_name)
    select 'transfer', item_id, 'T112', 4, mia_id, rack_id, '2030-01-01', 'uji 112', 'Uji' from f112$q$, '%MIA%'));

-- ---------------------------------------------------------------------
-- 2  Not our side of the SAP comparison
-- ---------------------------------------------------------------------
select pg_temp.check('wms_stock_by_sku leaves MIA out: physical = stock outside MIA',
  (select physical from wms_stock_by_sku() where item_id = (select item_id from f112))
  = (select sum(i.quantity) from inventory i join bins b on b.id = i.bin_id
      where i.item_id = (select item_id from f112) and b.zone <> 'MIA'));
select pg_temp.check('the 4 cartons in MIA are really in stock, just not counted',
  (select sum(i.quantity) from inventory i where i.item_id = (select item_id from f112))
  = (select physical from wms_stock_by_sku() where item_id = (select item_id from f112)) + 4);
-- Every movement of this test has created_at = now() (one transaction), so a cut-off just before now() makes exactly
-- the test's own two movements "later": +10 into the rack, then 4 of them to MIA (-4 of our side). Cut-off = now - 6.
select pg_temp.check('stock at a cut-off before the test: now - 6 (+10 adjusted, -4 moved to MIA)',
  (select physical from wms_stock_by_sku_at(now() - interval '1 millisecond') where item_id = (select item_id from f112))
  = (select physical from wms_stock_by_sku() where item_id = (select item_id from f112)) - 6);

-- ---------------------------------------------------------------------
-- 3  A full import does not zero MIA
-- ---------------------------------------------------------------------
set role authenticated;
select pg_temp.as_user('a1121111-1111-1111-1111-111111111111');
select import_snapshot('[]'::jsonb, true, 'uji 112', '{}');
reset role;
select pg_temp.check('a full import with an empty file zeroed the rack stock of the test',
  (select coalesce(sum(quantity), 0) = 0 from inventory where bin_id = (select rack_id from f112) and item_id = (select item_id from f112)));
select pg_temp.check('but MIA still holds its 4 cartons',
  (select quantity = 4 from inventory where bin_id = (select mia_id from f112) and item_id = (select item_id from f112) and batch_lot = 'T112'));

rollback;
