-- Item description guard (0138): an update that would replace a real name with nothing or with the
-- SKU keeps the stored name; a real new name still wins, and an item whose name is already its SKU
-- (a new item without a name) is not kept. Runs in a transaction and rolls back. Every line prints
-- PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when coalesce(ok, false) then 'PASS' else 'FAIL' end, label; end $$;

insert into items (sku, description, uom, upp) values ('T102-SKU', 'Shell Rimula R6 ME 10W-40', 'CAR', 48);

update items set description = null where sku = 'T102-SKU';
select pg_temp.check('setting the description to nothing keeps the name',
  (select description = 'Shell Rimula R6 ME 10W-40' from items where sku = 'T102-SKU'));

update items set description = 'T102-SKU' where sku = 'T102-SKU';
select pg_temp.check('setting the description to the SKU keeps the name',
  (select description = 'Shell Rimula R6 ME 10W-40' from items where sku = 'T102-SKU'));

update items set description = '   ' where sku = 'T102-SKU';
select pg_temp.check('a blank description keeps the name',
  (select description = 'Shell Rimula R6 ME 10W-40' from items where sku = 'T102-SKU'));

update items set description = 'Shell Rimula R6 ME 10W-40 (baru)' where sku = 'T102-SKU';
select pg_temp.check('a real new name still replaces the old one',
  (select description = 'Shell Rimula R6 ME 10W-40 (baru)' from items where sku = 'T102-SKU'));

-- A new item without a name starts as its SKU (import_snapshot inserts coalesce(description, sku));
-- the guard must not keep that SKU name on a later update.
insert into items (sku, description, uom, upp) values ('T102-NO-NAME', 'T102-NO-NAME', 'CAR', 48);
update items set description = null where sku = 'T102-NO-NAME';
select pg_temp.check('an item whose name is its SKU is not kept',
  (select description is null from items where sku = 'T102-NO-NAME'));

rollback;
