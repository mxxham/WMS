-- CF21A01-CF40A02 blocked for the CKB 3PL stock (0120). Runs in a transaction and rolls back. Every line prints PASS/FAIL.
-- The migration already ran on this database; this checks its effect and the paths that must refuse the bins.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
-- 0132: CF21-CF40 level A is lent to CKB 3PL; 0120 lent it by blocking it, so it is Shell here.
update public.bins set owner = 'SHELL' where bin_code ~ '^CF(2[1-9]|3[0-9]|40)A0[12]$';
reset role;
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when coalesce(ok, false) then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.fails(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then
  if sqlerrm not like p_like then raise notice 'got: %', sqlerrm; end if;
  return sqlerrm like p_like; end $$;
grant execute on function pg_temp.check(text, boolean), pg_temp.fails(text, text) to authenticated;

-- The test database loads its bins after the migrations, so run 0120 here, against the loaded bins.
-- First with 3 cartons of our stock in CF21A01 (as in the dev data): the migration must refuse and name it.
savepoint before_block;
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
values ('inbound', (select id from items where sku = '550074326'), 'T82', 3, (select id from bins where bin_code = 'CF21A01'), '2031-01-01', 't82');
\set ON_ERROR_STOP off
\i supabase/migrations/0120_block_cf21_40_level_a.sql
\set ON_ERROR_STOP on
\if :ERROR
  \set refused true
\else
  \set refused false
\endif
rollback to savepoint before_block;
select pg_temp.check('refused while our stock is in those bins', :refused);
select pg_temp.check('the refusal names the bin and the SKU', :'LAST_ERROR_MESSAGE' like '%CF21A01 (550074326%');
select pg_temp.check('and nothing was blocked', not exists (select 1 from bins where bin_code ~ '^CF(2[1-9]|3[0-9]|40)A[0-9]{2}$' and status = 'blocked'));

-- Then without our stock there: the 40 bins are blocked.
\i supabase/migrations/0120_block_cf21_40_level_a.sql

select pg_temp.check('all 40 bins CF21A01-CF40A02 are blocked',
  (select count(*) = 40 and bool_and(status = 'blocked') from bins where bin_code ~ '^CF(2[1-9]|3[0-9]|40)A[0-9]{2}$'));
select pg_temp.check('levels B-E of those bays and level A of CF01-CF20 stay active',
  (select bool_and(status = 'active') from bins where bin_code in ('CF21B01', 'CF40E02', 'CF20A01', 'CF01A02')));
select pg_temp.check('the bins are not offered as empty bins', not exists (select 1 from empty_bins where bin_code like 'CF21A%'));

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('a8211111-1111-1111-1111-111111111111','in82@pengguna.internal','{"name":"Admin In"}','{"username":"t82in"}');
update profiles set job = 'admin_inbound' where id = 'a8211111-1111-1111-1111-111111111111';
insert into items (sku, description, uom, upp) values ('990000082', 'Test 82', 'CAR', 36);
set role authenticated;
select set_config('request.jwt.claim.sub', 'a8211111-1111-1111-1111-111111111111', true);
select create_receipts_from_plan(current_date, 'x', '[{"doc_no":"880000082","lines":[{"sku":"990000082","quantity":36}]}]'::jsonb, 'Admin In');
select pg_temp.check('inbound into CF25A01 is refused',
  pg_temp.fails(format($q$select record_receipt_check(%L, '[{"sku":"990000082","quantity":36,"to_bin_code":"CF25A01"}]'::jsonb, 'Admin In')$q$,
    (select id from receipts where doc_no = '880000082')), '%diblokir%'));

rollback;
