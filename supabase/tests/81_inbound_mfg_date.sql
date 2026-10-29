-- Manufacture date on received pallets (0119). Runs in a transaction and rolls back. Every line prints PASS/FAIL.
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

select create_receipts_from_plan(current_date + 1, 'x.xlsx', '[{"doc_no":"880000091","lines":[{"sku":"990000080","quantity":36}]}]'::jsonb, 'Admin In');

select pg_temp.check('a pallet keeps its manufacture date',
  (record_receipt_check(pg_temp.rid('880000091'), '[{"sku":"990000080","quantity":36,"to_bin_code":"CF38B01","mfg_date":"2026-09-01"}]'::jsonb, 'Admin In') ->> 'pallets') = '1');
select pg_temp.check('stored on the pallet', (select mfg_date = '2026-09-01' from receipt_actuals where receipt_id = pg_temp.rid('880000091')));
select pg_temp.check('a manufacture date in the future is refused',
  pg_temp.fails(format($q$select record_receipt_check(%L, '[{"sku":"990000080","quantity":36,"to_bin_code":"CF38B01","mfg_date":"%s"}]'::jsonb, 'Admin In')$q$,
    pg_temp.rid('880000091'), current_date + 1), '%produksi%masa depan%'));
select pg_temp.check('without a manufacture date it still saves (as before)',
  (record_receipt_check(pg_temp.rid('880000091'), '[{"sku":"990000080","quantity":36,"to_bin_code":"CF38B01"}]'::jsonb, 'Admin In') ->> 'pallets') = '1');
select pg_temp.check('the bin checks of 0118 still hold',
  pg_temp.fails(format($q$select record_receipt_check(%L, '[{"sku":"990000080","quantity":36,"to_bin_code":"QUARANTINE"}]'::jsonb, 'Admin In')$q$,
    pg_temp.rid('880000091')), '%karantina%'));

rollback;
