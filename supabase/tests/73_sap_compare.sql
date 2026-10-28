-- SAP comparison (0111): MB52 storage locations, MB51 lines, shipments vs SAP GI.
-- Runs in a transaction and rolls back. Every line prints PASS/FAIL.
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
create or replace function pg_temp.line(p_sku text) returns public.stock_recon_lines language sql as $$
  select * from stock_recon_lines where recon_id = current_setting('t.rec')::uuid and sku = p_sku $$;
create or replace function pg_temp.match(p_status text, p_sku text) returns numeric language sql as $$
  select sum(timing) from recon_shipment_match(current_setting('t.rec')::uuid) where status = p_status and sku = p_sku $$;
grant execute on function pg_temp.check(text, boolean), pg_temp.fails(text, text), pg_temp.as_user(uuid),
  pg_temp.line(text), pg_temp.match(text, text) to authenticated;

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('d1111111-1111-1111-1111-111111111111','inv73@pengguna.internal','{"name":"Inv"}','{"username":"t73inv"}'),
  ('d2222222-2222-2222-2222-222222222222','op73@pengguna.internal','{"name":"Op"}','{"username":"t73op"}');
update profiles set job = 'inventory' where id = 'd1111111-1111-1111-1111-111111111111';

-- Shipments: SHA (SKU 550058593, DO 538306981) picked 12; SHB (550044709) picked 5 on 27 Oct, no GI in the file.
insert into waves (id, wave_no, planned_date, shipment_numbers, status) values
  ('e1111111-1111-1111-1111-111111111111', '73', '2026-10-27', '{SHA,SHB}', 'COMPLETED');
insert into outbound (outbound_date, wave_id, shipment_number, sku, item_id, order_nos, quantity_requested, quantity_allocated, status) values
  ('2026-10-27', 'e1111111-1111-1111-1111-111111111111', 'SHA', '550058593', (select id from items where sku = '550058593'), '{538306981}', 12, 12, 'COMPLETED'),
  ('2026-10-27', 'e1111111-1111-1111-1111-111111111111', 'SHB', '550044709', (select id from items where sku = '550044709'), '{538300001}', 5, 5, 'COMPLETED');
insert into pick_tasks (wave_id, shipment_number, task_type, item_id, from_bin_id, expiry_date, quantity, actual_quantity, seq, status, completed_at)
select 'e1111111-1111-1111-1111-111111111111', s, 'PICK', (select id from items where sku = k), (select id from bins where bin_code = 'CC22C01'),
       '2030-09-15', q, q, n, 'COMPLETED', '2026-10-27 10:00+07'
from (values ('SHA', '550058593', 12, 1), ('SHB', '550044709', 5, 2)) v(s, k, q, n);

set role authenticated;
select pg_temp.as_user('d1111111-1111-1111-1111-111111111111');
select set_config('t.rec', create_stock_recon_mb52('2026-10-28', 'MB52 2810.xlsx', null,
  '[{"sku":"550058593","uom":"CAR","unrestricted":100,"blocked":0},{"sku":"550044709","uom":"CAR","unrestricted":40,"blocked":1}]',
  '[{"sku":"550058593","uom":"CAR","sloc":"INBD","unrestricted":50,"blocked":0},{"sku":"999000222","uom":"EA","sloc":"INBD","unrestricted":7,"blocked":0}]',
  '{WHS1}',
  '[{"line_no":2,"sku":"550058593","sloc":"WHS1","mvt_type":"601","quantity":-10,"uom":"CAR","reference":"0538306981","posting_date":"2026-10-27"},
    {"line_no":3,"sku":"550058593","sloc":"WHS1","mvt_type":"601","quantity":-3,"uom":"CAR","reference":"0999999999","posting_date":"2026-10-27"},
    {"line_no":4,"sku":"550058593","sloc":"RETN","mvt_type":"311","quantity":5,"uom":"CAR","posting_date":"2026-10-27"}]',
  '[]', 'Inv')::text, true);

select pg_temp.check('counted location only: SAP unrestricted 100, INBD kept apart',
  (pg_temp.line('550058593')).sap_unrestricted = 100 and ((pg_temp.line('550058593')).sap_other->>'INBD')::numeric = 50);
select pg_temp.check('a SKU SAP has only in INBD still gets a line',
  (pg_temp.line('999000222')).sap_unrestricted = 0 and ((pg_temp.line('999000222')).sap_other->>'INBD')::numeric = 7);
select pg_temp.check('recon records counted and other locations and the MB51 lines',
  (select slocs = '{WHS1}' and other_slocs = '{INBD}' and sap_moves = 3 from stock_recons where id = current_setting('t.rec')::uuid));
select pg_temp.check('MB51 Reference loses its leading zero (= our DO number)',
  exists (select 1 from stock_recon_sap_moves where recon_id = current_setting('t.rec')::uuid and reference = '538306981'));

select pg_temp.check('SAP GI 10, picked 12: WMS_MORE, timing +2', pg_temp.match('WMS_MORE', '550058593') = 2);
select pg_temp.check('picked inside the MB51 dates without GI: NO_GI, timing +5', pg_temp.match('NO_GI', '550044709') = 5);
select pg_temp.check('a DO no outbound line carries: NOT_IN_WMS, no timing', pg_temp.match('NOT_IN_WMS', '550058593') = 0);
select pg_temp.check('GI in an uncounted location (RETN 311) is not a GI',
  (select count(*) = 3 from recon_shipment_match(current_setting('t.rec')::uuid)));

select pg_temp.check('apply: auto GI per SKU', (apply_recon_auto_gi(current_setting('t.rec')::uuid, 'Inv')->>'skus')::int = 2
  and (pg_temp.line('550058593')).auto_gi = 2 and (pg_temp.line('550044709')).auto_gi = 5);
select pg_temp.check('difference counts auto GI',
  (select diff_unrestricted = 100 - (wms_unrestricted + 2) from stock_recon_lines where recon_id = current_setting('t.rec')::uuid and sku = '550058593'));
select apply_recon_auto_gi(current_setting('t.rec')::uuid, 'Inv');
select pg_temp.check('apply twice gives the same numbers', (pg_temp.line('550058593')).auto_gi = 2);
select clear_recon_auto_gi(current_setting('t.rec')::uuid, 'Inv');
select pg_temp.check('clear sets auto GI back to 0',
  (select count(*) = 0 from stock_recon_lines where recon_id = current_setting('t.rec')::uuid and auto_gi <> 0));

select pg_temp.check('explaining needs a cause',
  pg_temp.fails(format($q$select explain_recon_line(%L, 'EXPLAINED', '', 'masih di INBD', 'Inv')$q$, (pg_temp.line('999000222')).id), 'Pilih penyebab%'));
select explain_recon_line((pg_temp.line('999000222')).id, 'EXPLAINED', 'SAP_INBOUND', 'masih di INBD', 'Inv');
select pg_temp.check('cause and remark are saved',
  (pg_temp.line('999000222')).cause = 'SAP_INBOUND' and (pg_temp.line('999000222')).status = 'EXPLAINED');
select pg_temp.check('summary splits more / less than SAP',
  (select skus_wms_more + skus_wms_less >= 1 and wms_total >= 0 from stock_recon_summary where id = current_setting('t.rec')::uuid));
select pg_temp.check('recount all open differences opens count tasks',
  (request_recon_counts_all(current_setting('t.rec')::uuid, 'Inv')->>'lines')::int >= 1
  and (pg_temp.line('550058593')).status = 'COUNT_REQUESTED');

select pg_temp.as_user('d2222222-2222-2222-2222-222222222222');
select pg_temp.check('an operator cannot create a reconciliation',
  pg_temp.fails($q$select create_stock_recon_mb52('2026-10-28', 'x', null, '[{"sku":"550058593","unrestricted":1}]', '[]', '{WHS1}', '[]', '[]', 'Op')$q$, 'Hanya supervisor%'));
select pg_temp.check('an operator cannot read the shipment match',
  pg_temp.fails(format($q$select * from recon_shipment_match(%L)$q$, current_setting('t.rec')), 'Hanya supervisor%'));

reset role;
select pg_temp.check('MB51 lines cannot be edited',
  pg_temp.fails(format($q$update stock_recon_sap_moves set quantity = 0 where recon_id = %L$q$, current_setting('t.rec')), '%tidak bisa diubah%'));
select pg_temp.check('anon cannot execute the new functions',
  not has_function_privilege('anon', 'public.create_stock_recon_mb52(date, text, text, jsonb, jsonb, text[], jsonb, jsonb, text)', 'execute')
  and not has_function_privilege('anon', 'public.recon_shipment_match(uuid)', 'execute'));
rollback;
