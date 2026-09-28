-- Putaway audit at the rack, with batch (0027). Runs in a transaction and rolls back.
-- Run with scripts/sql-test.sh. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users values ('22222222-2222-2222-2222-222222222222','sup@x','{"name":"Supervisor"}') on conflict do nothing;
update profiles set role='supervisor' where id='22222222-2222-2222-2222-222222222222';

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.fails(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then
  if sqlerrm not like p_like then raise notice 'got: %', sqlerrm; end if;
  return sqlerrm like p_like; end $$;

-- Fixture: A7 x48 put away from STAGING into CF38C01 by Budi.
delete from inventory where bin_id in (select id from bins where bin_code in ('CF38C01','STAGING'))
  and item_id = (select id from items where sku='550044709');
insert into movements (type,item_id,batch_lot,quantity,to_bin_id,expiry_date,note)
values ('adjustment', (select id from items where sku='550044709'), 'A7', 48, (select id from bins where bin_code='STAGING'), '2031-05-05', 'fixture');
insert into movements (type,item_id,batch_lot,quantity,from_bin_id,to_bin_id,expiry_date,note,by_name)
values ('putaway', (select id from items where sku='550044709'), 'A7', 48, (select id from bins where bin_code='STAGING'),
        (select id from bins where bin_code='CF38C01'), '2031-05-05', 'rack fixture', 'Budi Santoso');
select set_config('t.mv', (select id::text from movements where note='rack fixture'), false);

set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select pg_temp.check('view shows the rack and who put it away',
  (select zone = 'CF' and by_name = 'Budi Santoso' and attempts = 0 from putaway_audit_detail where movement_id = current_setting('t.mv')::uuid));
select pg_temp.check('the putaway person cannot audit it',
  pg_temp.fails(format($q$select record_putaway_audit(%L, 'budi santoso', '550044709', 'A7', 48)$q$, current_setting('t.mv')), 'Checker tidak boleh%'));
select pg_temp.check('unknown SKU refused',
  pg_temp.fails(format($q$select record_putaway_audit(%L, 'Sari', '999', 'A7', 48)$q$, current_setting('t.mv')), '%tidak dikenal%'));
select pg_temp.check('difference without note refused',
  pg_temp.fails(format($q$select record_putaway_audit(%L, 'Sari', '550044709', 'B8', 48)$q$, current_setting('t.mv')), 'Ada selisih%'));

select pg_temp.check('wrong batch -> MISMATCH, batch_ok false, qty and SKU fine',
  record_putaway_audit(current_setting('t.mv')::uuid, 'Sari', '550044709', 'B8', 48, 'batch beda') @> '{"result":"MISMATCH","sku_ok":true,"batch_ok":false}');
select pg_temp.check('found values and checker stored',
  (select found_sku = '550044709' and found_batch = 'B8' and checker_name = 'Sari' and counted_qty = 48
   from audits where movement_id = current_setting('t.mv')::uuid));
select pg_temp.check('recount: batch compared ignoring case and spaces -> OK, earlier result in history',
  record_putaway_audit(current_setting('t.mv')::uuid, 'Sari', '550044709', ' a7 ', 48) @> '{"result":"OK"}');
select pg_temp.check('one audit row, 2 attempts, history keeps the first checker and batch',
  (select count(*) = 1 from audits where movement_id = current_setting('t.mv')::uuid)
  and (select attempts = 2 and result = 'OK' from putaway_audit_detail where movement_id = current_setting('t.mv')::uuid)
  and (select history->0->>'found_batch' = 'B8' from audits where movement_id = current_setting('t.mv')::uuid));
select pg_temp.check('wrong SKU and short both caught',
  record_putaway_audit(current_setting('t.mv')::uuid, 'Sari', '550024919', 'A7', 40, 'barang lain') @> '{"result":"MISMATCH","sku_ok":false}');

-- Operators may audit at the rack too (0028); the list tab's record_audit stays supervisor-only.
reset role;
insert into auth.users values ('11111111-1111-1111-1111-111111111111','op@x','{"name":"Operator"}') on conflict do nothing;
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select pg_temp.check('operator can record a putaway audit (0028)',
  record_putaway_audit(current_setting('t.mv')::uuid, 'Sari', '550044709', 'A7', 48) @> '{"result":"OK"}');
select pg_temp.check('operator still cannot use the old record_audit',
  pg_temp.fails(format($q$select record_audit('PUTAWAY', %L, 48, true, true, null)$q$, current_setting('t.mv')), 'Hanya supervisor%'));

rollback;
