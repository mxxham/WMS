-- Urutan muat per shipment (0128). Runs in a transaction and rolls back. Every line prints PASS/FAIL.
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
grant execute on function pg_temp.check(text, boolean), pg_temp.fails(text, text), pg_temp.as_user(uuid) to authenticated;

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('a8911111-1111-1111-1111-111111111111','out89@pengguna.internal','{"name":"Outbound"}','{"username":"t89out"}'),
  ('a8922222-2222-2222-2222-222222222222','op89@pengguna.internal','{"name":"Op"}','{"username":"t89op"}');
update profiles set job = 'admin_outbound' where id = 'a8911111-1111-1111-1111-111111111111';
update profiles set job = 'operator' where id = 'a8922222-2222-2222-2222-222222222222';

insert into waves (wave_no, planned_date, shipment_numbers, status)
values ('89A', '2026-12-09', array['109759765','109759766'], 'PENDING');

set role authenticated;
select pg_temp.as_user('a8922222-2222-2222-2222-222222222222');
select pg_temp.check('an operator cannot set a loading number',
  pg_temp.fails($q$select set_shipment_load_no('2026-12-09', '109759765', 1)$q$, '%Hanya supervisor atau admin%'));
select pg_temp.check('nobody writes the table directly',
  pg_temp.fails($q$insert into shipment_load_no (planned_date, shipment_number, load_no) values ('2026-12-09', '109759765', 1)$q$, '%shipment_load_no%'));

select pg_temp.as_user('a8911111-1111-1111-1111-111111111111');
select pg_temp.check('a shipment not on that day is refused',
  pg_temp.fails($q$select set_shipment_load_no('2026-12-10', '109759765', 1)$q$, '%tidak ada di wave%'));
select pg_temp.check('0 is refused',
  pg_temp.fails($q$select set_shipment_load_no('2026-12-09', '109759765', 0)$q$, '%1 sampai 999%'));

select set_shipment_load_no('2026-12-09', ' 109759765 ', 2) \g /dev/null
select set_shipment_load_no('2026-12-09', '109759766', 1) \g /dev/null
select pg_temp.check('Admin Outbound sets both numbers, trimmed, with the author',
  (select load_no from shipment_load_no where planned_date = '2026-12-09' and shipment_number = '109759765') = 2
  and (select load_no from shipment_load_no where planned_date = '2026-12-09' and shipment_number = '109759766') = 1
  and (select updated_by from shipment_load_no where shipment_number = '109759765') = 'Outbound');

select set_shipment_load_no('2026-12-09', '109759765', 1) \g /dev/null
select pg_temp.check('a number can be changed; a duplicate is allowed for a moment',
  (select count(*) from shipment_load_no where planned_date = '2026-12-09' and load_no = 1) = 2);

select set_shipment_load_no('2026-12-09', '109759766', null) \g /dev/null
select pg_temp.check('null clears the number',
  not exists (select 1 from shipment_load_no where shipment_number = '109759766'));

reset role;
delete from waves where wave_no = '89A' and planned_date = '2026-12-09';
select pg_temp.check('the number survives the wave being replaced (keyed on day + shipment)',
  exists (select 1 from shipment_load_no where planned_date = '2026-12-09' and shipment_number = '109759765'));

rollback;
