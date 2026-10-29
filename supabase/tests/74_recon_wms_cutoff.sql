-- SAP comparison at a cut-off (0112): our stock with later movements undone.
-- Runs in a transaction and rolls back. Every line prints PASS/FAIL.
-- Movements inserted here carry created_at = now() (transaction start), so a
-- cut-off of now() - 1 microsecond sits just before all of them (and after the seed).
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
create or replace function pg_temp.now_of(p_sku text, p_col text) returns numeric language sql as $$
  select coalesce((select case p_col when 'phys' then physical when 'free' then unrestricted else blocked end
                   from wms_stock_by_sku() where sku = p_sku), 0) $$;
create or replace function pg_temp.at_of(p_sku text, p_col text) returns numeric language sql as $$
  select coalesce((select case p_col when 'phys' then physical when 'free' then unrestricted else blocked end
                   from wms_stock_by_sku_at(now() - interval '1 microsecond') where sku = p_sku), 0) $$;
create or replace function pg_temp.line(p_rec text, p_sku text) returns public.stock_recon_lines language sql as $$
  select * from stock_recon_lines where recon_id = current_setting(p_rec)::uuid and sku = p_sku $$;
grant execute on function pg_temp.check(text, boolean), pg_temp.fails(text, text), pg_temp.as_user(uuid),
  pg_temp.now_of(text, text), pg_temp.at_of(text, text), pg_temp.line(text, text) to authenticated;

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('f1111111-1111-1111-1111-111111111111','inv74@pengguna.internal','{"name":"Inv"}','{"username":"t74inv"}');
update profiles set job = 'inventory' where id = 'f1111111-1111-1111-1111-111111111111';

-- Before: stock of the two SKUs as the seed left it.
select set_config('t.a_phys', pg_temp.now_of('550058593', 'phys')::text, true),
       set_config('t.a_blk',  pg_temp.now_of('550058593', 'blk')::text, true),
       set_config('t.a_free', pg_temp.now_of('550058593', 'free')::text, true),
       set_config('t.b_phys', pg_temp.now_of('550044709', 'phys')::text, true);

-- "Today": pick 5, move 4 into quarantine, find 3 of the other SKU.
insert into movements (type, item_id, batch_lot, quantity, from_bin_id, note) values
  ('picking', (select id from items where sku = '550058593'), '15I26JJ', 5, (select id from bins where bin_code = 'CC22C01'), 't74');
insert into movements (type, item_id, batch_lot, quantity, from_bin_id, to_bin_id, note) values
  ('transfer', (select id from items where sku = '550058593'), '15I26JJ', 4, (select id from bins where bin_code = 'CC22C02'),
   (select id from bins where zone = 'QUARANTINE' order by bin_code limit 1), 't74');
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, reason_code, note) values
  ('adjustment', (select id from items where sku = '550044709'), 'T74', 3, (select id from bins where bin_code = 'CF39C02'), '2031-01-01', 'FOUND', 't74');

select pg_temp.check('now: the pick is gone, 4 more blocked, 3 found',
  pg_temp.now_of('550058593', 'phys') = current_setting('t.a_phys')::numeric - 5
  and pg_temp.now_of('550058593', 'blk') = current_setting('t.a_blk')::numeric + 4
  and pg_temp.now_of('550044709', 'phys') = current_setting('t.b_phys')::numeric + 3);
select pg_temp.check('at the cut-off: on-hand before the pick',
  pg_temp.at_of('550058593', 'phys') = current_setting('t.a_phys')::numeric);
select pg_temp.check('at the cut-off: the quarantine move is undone',
  pg_temp.at_of('550058593', 'blk') = current_setting('t.a_blk')::numeric
  and pg_temp.at_of('550058593', 'free') = current_setting('t.a_free')::numeric);
select pg_temp.check('at the cut-off: the adjustment is undone',
  pg_temp.at_of('550044709', 'phys') = current_setting('t.b_phys')::numeric);
select pg_temp.check('inventory itself is not touched',
  pg_temp.now_of('550058593', 'phys') = current_setting('t.a_phys')::numeric - 5);

-- A shipment picked after the cut-off whose GI SAP already posted.
insert into waves (id, wave_no, planned_date, shipment_numbers, status) values
  ('f2222222-2222-2222-2222-222222222222', '74', current_date, '{SH74}', 'COMPLETED');
insert into outbound (outbound_date, wave_id, shipment_number, sku, item_id, order_nos, quantity_requested, quantity_allocated, status) values
  (current_date, 'f2222222-2222-2222-2222-222222222222', 'SH74', '550058593', (select id from items where sku = '550058593'), '{538374000}', 5, 5, 'COMPLETED');
insert into pick_tasks (wave_id, shipment_number, task_type, item_id, from_bin_id, expiry_date, quantity, actual_quantity, seq, status, completed_at)
values ('f2222222-2222-2222-2222-222222222222', 'SH74', 'PICK', (select id from items where sku = '550058593'),
        (select id from bins where bin_code = 'CC22C01'), '2030-09-15', 5, 5, 1, 'COMPLETED', now());

set role authenticated;
select pg_temp.as_user('f1111111-1111-1111-1111-111111111111');
select set_config('t.cut', create_stock_recon_mb52(current_date, 'MB52.xlsx', null,
  '[{"sku":"550058593","uom":"CAR","unrestricted":100,"blocked":0}]', '[]', '{WHS1}',
  format('[{"line_no":2,"sku":"550058593","sloc":"WHS1","mvt_type":"601","quantity":-5,"reference":"0538374000","posting_date":"%s"}]', current_date)::jsonb,
  '[]', 'Inv', now() - interval '1 microsecond')::text, true);
select set_config('t.now', create_stock_recon_mb52(current_date, 'MB52.xlsx', null,
  '[{"sku":"550058593","uom":"CAR","unrestricted":100,"blocked":0}]', '[]', '{WHS1}',
  format('[{"line_no":2,"sku":"550058593","sloc":"WHS1","mvt_type":"601","quantity":-5,"reference":"0538374000","posting_date":"%s"}]', current_date)::jsonb,
  '[]', 'Inv')::text, true);

select pg_temp.check('recon with a cut-off compares the on-hand before today''s pick',
  (pg_temp.line('t.cut', '550058593')).wms_unrestricted = current_setting('t.a_free')::numeric
  and (pg_temp.line('t.cut', '550058593')).wms_blocked = current_setting('t.a_blk')::numeric);
select pg_temp.check('recon without a cut-off still compares "now" (as 0111)',
  (pg_temp.line('t.now', '550058593')).wms_unrestricted + (pg_temp.line('t.now', '550058593')).wms_blocked
    = current_setting('t.a_phys')::numeric - 5);
select pg_temp.check('a SKU held only at the cut-off still gets a line',
  (pg_temp.line('t.cut', '550044709')).wms_unrestricted + (pg_temp.line('t.cut', '550044709')).wms_blocked = current_setting('t.b_phys')::numeric);
select pg_temp.check('the cut-off is recorded and shown in the summary',
  (select wms_at is not null from stock_recon_summary where id = current_setting('t.cut')::uuid)
  and (select wms_at is null from stock_recon_summary where id = current_setting('t.now')::uuid));
select pg_temp.check('shipments: a pick after the cut-off is not counted (GI 5, picked 0 -> timing -5)',
  (select status = 'SAP_MORE' and picked = 0 and timing = -5 from recon_shipment_match(current_setting('t.cut')::uuid) where shipment_number = 'SH74'));
select pg_temp.check('shipments without a cut-off: GI 5 = picked 5',
  (select status = 'MATCH' from recon_shipment_match(current_setting('t.now')::uuid) where shipment_number = 'SH74'));
select pg_temp.check('a cut-off in the future is refused',
  pg_temp.fails($q$select create_stock_recon_mb52(current_date, 'x', null, '[{"sku":"550058593","unrestricted":1}]', '[]', '{WHS1}', '[]', '[]', 'Inv', now() + interval '1 day')$q$, '%masa depan%'));
reset role;
select pg_temp.check('anon cannot execute wms_stock_by_sku_at',
  not has_function_privilege('anon', 'public.wms_stock_by_sku_at(timestamptz)', 'execute'));
rollback;
