-- Putaway row sent to the bin the pallet really went to (0042). Runs in a transaction and rolls back.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users values ('11111111-1111-1111-1111-111111111111','op@x','{"name":"Operator"}') on conflict do nothing;
update profiles set role = 'admin' where id = '11111111-1111-1111-1111-111111111111';
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;

-- The sheet says CF38C01, which holds another SKU; the pallet really went to the empty CF38C02.
delete from inventory where bin_id in (select id from bins where bin_code in ('CF38C01', 'CF38C02', 'CF39C01'));
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
select 'adjustment', (select id from items where sku = '550024919'), 'X1', 44, (select id from bins where bin_code = 'CF38C01'), '2030-06-22', 'fixture';
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select pg_temp.check('as in the sheet: bin occupied',
  putaway_import('[{"line":85,"bin_code":"CF38C01","sku":"550044709","batch_lot":"18I26JJ","quantity":44,"expiry_date":"2030-09-18"}]'::jsonb, 'WMS.xlsx', false)
  #>> '{rows,0,kind}' = 'bin_occupied');
select pg_temp.check('sent to the real bin: new',
  putaway_import('[{"line":85,"bin_code":"CF38C02","sheet_bin":"CF38C01","sku":"550044709","batch_lot":"18I26JJ","quantity":44,"expiry_date":"2030-09-18"}]'::jsonb, 'WMS.xlsx', false)
  #>> '{rows,0,status}' = 'new');
select putaway_import('[{"line":85,"bin_code":"CF38C02","sheet_bin":"CF38C01","sku":"550044709","batch_lot":"18I26JJ","quantity":44,"expiry_date":"2030-09-18"}]'::jsonb, 'WMS.xlsx', true);
select pg_temp.check('posted into CF38C02, CF38C01 untouched',
  (select sum(i.quantity) from inventory i join bins b on b.id = i.bin_id where b.bin_code = 'CF38C02') = 44
  and (select sum(i.quantity) from inventory i join bins b on b.id = i.bin_id where b.bin_code = 'CF38C01') = 44);
select pg_temp.check('note keeps the bin the sheet said',
  exists (select 1 from movements where type = 'putaway' and note = 'PUTAWAY WMS.xlsx baris 85 (di sheet CF38C01, ditaruh di CF38C02)'));
select pg_temp.check('a normal row keeps the plain note',
  (putaway_import('[{"line":86,"bin_code":"CF39C01","sku":"550044709","batch_lot":"18I26JJ","quantity":1,"expiry_date":"2030-09-18"}]'::jsonb, 'WMS.xlsx', true)->>'movements') = '1');
select pg_temp.check('its note has no redirect',
  exists (select 1 from movements where type = 'putaway' and note = 'PUTAWAY WMS.xlsx baris 86'));
rollback;
