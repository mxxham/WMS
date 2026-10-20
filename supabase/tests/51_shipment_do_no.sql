-- Shipment DO numbers per picklist (0079): manual DO numbers entered on the Wave page,
-- stored per wave+shipment, printed on the picksheet header merged with WMS order_nos.
-- Runs in a transaction and rolls back. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111','sup@x','{"name":"Supervisor"}'),
  ('22222222-2222-2222-2222-222222222222','op@x','{"name":"Operator"}') on conflict do nothing;
update profiles set role = 'admin'    where id = '11111111-1111-1111-1111-111111111111';
update profiles set role = 'operator' where id = '22222222-2222-2222-2222-222222222222';
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.fails(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then
  if sqlerrm not like p_like then raise notice 'got: %', sqlerrm; end if;
  return sqlerrm like p_like; end $$;

-- Same shape as fails(), but passes on ANY exception (with the message printed):
-- locally 01 grants CRUD to authenticated so the wall is RLS ('row-level security'),
-- on real Supabase there is usually no INSERT grant at all ('permission denied').
create or replace function pg_temp.any_fail(p_sql text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then
  raise notice 'refused: %', sqlerrm; return true; end $$;
create or replace function pg_temp.w(p_wave text) returns uuid language sql as $$
  select id from waves where planned_date = '2026-11-30' and wave_no = p_wave $$;
create or replace function pg_temp.dos(p_wave_id uuid, p_shipment text) returns jsonb language sql as $$
  select do_nos from shipment_do_no where wave_id = p_wave_id and shipment_number = p_shipment $$;
create or replace function pg_temp.row_exists(p_wave_id uuid, p_shipment text) returns boolean language sql as $$
  select exists (select 1 from shipment_do_no where wave_id = p_wave_id and shipment_number = p_shipment) $$;
grant execute on function pg_temp.check(text, boolean), pg_temp.fails(text, text),
  pg_temp.w(text), pg_temp.dos(uuid, text), pg_temp.row_exists(uuid, text) to authenticated;

-- Fixture: one wave with two shipments.
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select save_plan('2026-11-30', '{
  "waves":[{"wave_no":"1","shipment_numbers":["SHIP-A","SHIP-B"],"planned_slot":"00:52"}],
  "tasks":[
    {"wave_no":"1","shipment_number":"SHIP-A","task_type":"PICK","sku":"550070614","from_bin":"CB01D01","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":10,"pick_type":"CASE","seq":1},
    {"wave_no":"1","shipment_number":"SHIP-B","task_type":"PICK","sku":"550070614","from_bin":"CB01D01","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":5,"pick_type":"CASE","seq":2}]}'::jsonb) \g /dev/null

-- 1) Operator role is refused.
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select pg_temp.check('operator cannot set DOs',
  pg_temp.fails($$select set_shipment_dos(pg_temp.w('1'), 'SHIP-A', '["DO-001"]'::jsonb)$$,
  '%supervisor atau admin%'));

-- 2) Supervisor stores the list.
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select set_shipment_dos(pg_temp.w('1'), 'SHIP-A', '["DO-001","DO-002"]'::jsonb) \g /dev/null
select pg_temp.check('supervisor stores two DOs',
  pg_temp.dos(pg_temp.w('1'), 'SHIP-A') = '["DO-001", "DO-002"]'::jsonb);

-- 3) Second call REPLACES the list (add one more, verify two elements).
select set_shipment_dos(pg_temp.w('1'), 'SHIP-A', '["DO-002","DO-003"]'::jsonb) \g /dev/null
select pg_temp.check('second call replaces: now DO-002 and DO-003',
  pg_temp.dos(pg_temp.w('1'), 'SHIP-A') = '["DO-002", "DO-003"]'::jsonb);

-- 4) Unknown shipment is refused.
select pg_temp.check('unknown shipment refused',
  pg_temp.fails($$select set_shipment_dos(pg_temp.w('1'), 'SHIP-X', '["DO-999"]'::jsonb)$$,
  '%Shipment SHIP-X tidak ada di wave ini%'));

-- 5) Empty list deletes the row (select count = 0).
select set_shipment_dos(pg_temp.w('1'), 'SHIP-A', '[]'::jsonb) \g /dev/null
select pg_temp.check('empty list deletes the row',
  not pg_temp.row_exists(pg_temp.w('1'), 'SHIP-A'));

-- 6) Direct insert into shipment_do_no as authenticated (non-service) fails.
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select pg_temp.check('direct insert by authenticated fails',
  pg_temp.any_fail($$insert into shipment_do_no (wave_id, shipment_number, do_nos) values (pg_temp.w('1'), 'SHIP-B', '["DIRECT"]'::jsonb)$$));

-- 7) Trim, dedupe (case-sensitive), cap element length 40, cap list length 20.
select set_shipment_dos(pg_temp.w('1'), 'SHIP-B', ('["  DO-1  ","DO-2","DO-1","DO-3","' || repeat('X',41) || '"]')::jsonb) \g /dev/null
select pg_temp.check('trim + dedupe + length caps',
  pg_temp.dos(pg_temp.w('1'), 'SHIP-B') = '["DO-1", "DO-2", "DO-3"]'::jsonb);

-- 8) List length cap at 20 (send 25 unique, expect first 20).
select set_shipment_dos(pg_temp.w('1'), 'SHIP-B',
  (select jsonb_agg(to_jsonb('DO-' || g)) from generate_series(1,25) g) ) \g /dev/null
select pg_temp.check('list capped at 20 elements',
  jsonb_array_length(pg_temp.dos(pg_temp.w('1'), 'SHIP-B')) = 20);

rollback;