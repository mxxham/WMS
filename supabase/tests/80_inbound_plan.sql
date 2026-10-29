-- Inbound plan + auto putaway (0118). Runs in a transaction and rolls back. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when coalesce(ok, false) then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.fails(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then
  if sqlerrm not like p_like then raise notice 'got: %', sqlerrm; end if;
  return sqlerrm like p_like; end $$;
create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', p::text, true); end $$;
create or replace function pg_temp.rid(p_doc text) returns uuid language sql as $$ select id from receipts where doc_no = p_doc $$;
grant execute on function pg_temp.check(text, boolean), pg_temp.fails(text, text), pg_temp.as_user(uuid), pg_temp.rid(text) to authenticated;

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('a8011111-1111-1111-1111-111111111111','in80@pengguna.internal','{"name":"Admin In"}','{"username":"t80in"}'),
  ('a8022222-2222-2222-2222-222222222222','lead80@pengguna.internal','{"name":"Leader"}','{"username":"t80lead"}'),
  ('a8033333-3333-3333-3333-333333333333','op80@pengguna.internal','{"name":"Op"}','{"username":"t80op"}');
update profiles set job = 'admin_inbound' where id = 'a8011111-1111-1111-1111-111111111111';
update profiles set job = 'leader' where id = 'a8022222-2222-2222-2222-222222222222';
update profiles set job = 'operator' where id = 'a8033333-3333-3333-3333-333333333333';
insert into items (sku, description, uom, upp) values ('990000080', 'Test inbound 80_4*4L', 'CAR', 36);
delete from inventory where bin_id in (select id from bins where bin_code in ('CF38B01', 'CF38C01', 'CF38D01'));

set role authenticated;
select pg_temp.as_user('a8011111-1111-1111-1111-111111111111');

-- ---- A. Plan upload ---------------------------------------------------------
select set_config('t.docs', '[
  {"doc_no":"880000001","shipment_no":"109718765","sales_order":"4550721436","container_no":"HPCU2051790","seal_no":"JKT068035",
   "transporter":"SILKARGO","slot_time":"09:30","lines":[{"sku":"990000080","quantity":80}]},
  {"doc_no":"880000002","shipment_no":"109718766","sales_order":"4550721436","container_no":"HPCU2051337","seal_no":"JKT068036",
   "transporter":"SILKARGO","slot_time":"10:30","lines":[{"sku":"999999999","quantity":5}]}]', true);
select set_config('t.res', create_receipts_from_plan(current_date + 1, 'INBOUND 29.xlsx', current_setting('t.docs')::jsonb, 'Admin In')::text, true);
select pg_temp.check('a plan creates one receipt per DO with its header',
  (select count(*) = 1 and bool_and(source = 'PLAN' and plan_date = current_date + 1 and container_no = 'HPCU2051790'
          and slot_time = '09:30' and status = 'OPEN') from receipts where doc_no = '880000001'));
select pg_temp.check('the plan line is the expected quantity',
  (select quantity = 80 from receipt_expected where receipt_id = pg_temp.rid('880000001')));
select pg_temp.check('a DO with an unknown SKU is skipped with its reason',
  (current_setting('t.res')::jsonb -> 'skipped' -> 0 ->> 'doc_no') = '880000002'
  and (current_setting('t.res')::jsonb -> 'skipped' -> 0 ->> 'why') like '%999999999%' and pg_temp.rid('880000002') is null);
select set_config('t.res2', create_receipts_from_plan(current_date + 1, 'INBOUND 29.xlsx', current_setting('t.docs')::jsonb, 'Admin In')::text, true);
select pg_temp.check('uploading the plan again skips DOs that exist',
  (current_setting('t.res2')::jsonb ->> 'created')::int = 0
  and (select count(*) = 1 from receipts where doc_no = '880000001'));

select pg_temp.check('the receipt list shows the plan header',
  (select container_no = 'HPCU2051790' and expected_qty = 80 from receipt_summary where doc_no = '880000001'));

-- ---- B. Check + putaway -----------------------------------------------------
select pg_temp.check('a pallet into an occupied bin is refused',
  pg_temp.fails(format($q$select record_receipt_check(%L, '[{"sku":"990000080","quantity":36,"to_bin_code":"%s"}]'::jsonb, 'Admin In')$q$,
    pg_temp.rid('880000001'), (select b.bin_code from inventory i join bins b on b.id = i.bin_id where i.quantity > 0 and b.zone like 'C_' limit 1)),
    '%sudah berisi%'));
select pg_temp.check('a pallet into QUARANTINE is refused',
  pg_temp.fails(format($q$select record_receipt_check(%L, '[{"sku":"990000080","quantity":36,"to_bin_code":"QUARANTINE"}]'::jsonb, 'Admin In')$q$,
    pg_temp.rid('880000001')), '%karantina%'));
select pg_temp.check('two pallets in one bin are refused',
  pg_temp.fails(format($q$select record_receipt_check(%L, '[{"sku":"990000080","quantity":36,"to_bin_code":"CF38B01"},{"sku":"990000080","quantity":36,"to_bin_code":"CF38B01"}]'::jsonb, 'Admin In')$q$,
    pg_temp.rid('880000001')), '%dua palet%'));
create temp table c1 as select record_receipt_check(pg_temp.rid('880000001'), '[{"sku":"990000080","quantity":36,"to_bin_code":"CF38B01"},
     {"sku":"990000080","quantity":36,"to_bin_code":"CF38C01"},{"sku":"990000080","quantity":6,"damaged_qty":2,"to_bin_code":"CF38D01"}]'::jsonb,
     'Admin In') as r;
select pg_temp.check('the check is saved without batch and expiry',
  (select (r ->> 'pallets')::int = 3 from c1) and (select status = 'CHECKED' from receipts where id = pg_temp.rid('880000001')));
select pg_temp.check('the comparison with the plan: 80 planned, 78 good + 2 damaged',
  (select expected = 80 and good = 78 and damaged = 2 and result = 'DAMAGED' from receipt_compare where receipt_id = pg_temp.rid('880000001')));
select pg_temp.check('bins of a checked receipt are reserved for it',
  (select count(*) = 3 from inbound_reserved_bins where receipt_id = pg_temp.rid('880000001')));
select pg_temp.as_user('a8033333-3333-3333-3333-333333333333');
select pg_temp.check('an operator cannot record the check',
  pg_temp.fails(format($q$select record_receipt_check(%L, '[{"sku":"990000080","quantity":1,"to_bin_code":"CF38B01"}]'::jsonb, 'Op')$q$,
    pg_temp.rid('880000001')), '%Admin Inbound%'));

-- ---- C. Posting needs the expiry --------------------------------------------
select pg_temp.as_user('a8022222-2222-2222-2222-222222222222');
select pg_temp.check('posting without expiry is refused',
  pg_temp.fails(format($q$select post_receipt(%L, 'rusak 2', 'Leader')$q$, pg_temp.rid('880000001')), '%expired belum diisi%'));
select pg_temp.as_user('a8011111-1111-1111-1111-111111111111');
select record_receipt_check(pg_temp.rid('880000001'), '[{"sku":"990000080","quantity":36,"to_bin_code":"CF38B01","batch_lot":"B80","expiry_date":"2031-01-01"},
     {"sku":"990000080","quantity":36,"to_bin_code":"CF38C01","batch_lot":"B80","expiry_date":"2031-01-01"},
     {"sku":"990000080","quantity":6,"damaged_qty":2,"to_bin_code":"CF38D01","batch_lot":"B80","expiry_date":"2031-01-01"}]'::jsonb, 'Admin In');
select pg_temp.as_user('a8022222-2222-2222-2222-222222222222');
create temp table p1 as select post_receipt(pg_temp.rid('880000001'), 'rusak 2', 'Leader') as r;
select pg_temp.check('posted by another person: 78 into the bins, 2 into quarantine',
  (select (r ->> 'inbound')::int = 3 from p1)
  and (select sum(i.quantity) = 78 from inventory i join bins b on b.id = i.bin_id
       where i.item_id = (select id from items where sku = '990000080') and b.zone <> 'QUARANTINE')
  and (select sum(i.quantity) = 2 from inventory i join bins b on b.id = i.bin_id
       where i.item_id = (select id from items where sku = '990000080') and b.zone = 'QUARANTINE'));
select pg_temp.check('a posted receipt no longer reserves bins',
  (select count(*) = 0 from inbound_reserved_bins where receipt_id = pg_temp.rid('880000001')));

-- ---- D. Roles ---------------------------------------------------------------
select pg_temp.as_user('a8033333-3333-3333-3333-333333333333');
select pg_temp.check('an operator cannot upload a plan',
  pg_temp.fails($q$select create_receipts_from_plan(current_date, 'x', '[{"doc_no":"880000009","lines":[{"sku":"990000080","quantity":1}]}]'::jsonb, 'Op')$q$, '%Admin Inbound%'));

rollback;
