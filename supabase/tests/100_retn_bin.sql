-- RETN returns location (0136): exists once, active, shared, accepts stock by movement, never a rack bin.
-- Runs in a transaction and rolls back. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when coalesce(ok, false) then 'PASS' else 'FAIL' end, label; end $$;

select pg_temp.check('RETN exists once: zone RETURN, active, no rack, no owner',
  (select count(*) = 1 and bool_and(zone = 'RETURN' and status = 'active' and rack is null and owner is null)
   from bins where bin_code = 'RETN'));
select pg_temp.check('Shell may use RETN', (select public.bin_usable(id) from bins where bin_code = 'RETN'));
select pg_temp.check('its creation is in the bin history once',
  (select count(*) = 1 from bin_changes where bin_code = 'RETN' and field = 'CREATED'));

insert into items (sku, description, uom, upp) values ('T100-SKU', 'Uji 100', 'CAR', 48);
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, reason_code, note, by_name)
values ('adjustment', (select id from items where sku = 'T100-SKU'), 'B100', 5,
        (select id from bins where bin_code = 'RETN'), '2030-01-01', 'FOUND', 'uji 100 retur', 'Uji');
select pg_temp.check('a movement books stock into RETN',
  (select quantity = 5 from inventory i where i.bin_id = (select id from bins where bin_code = 'RETN')
     and i.item_id = (select id from items where sku = 'T100-SKU')));

rollback;
