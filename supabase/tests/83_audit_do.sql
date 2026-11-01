-- Per-item DO (delivery order = SAP order) numbers on the picking audit (0121).
-- Runs in a transaction and rolls back. Every line prints PASS/FAIL.
--   A. norm_do_nos: trim, drop empty, dedupe, first-seen order, cap 20.
--   B. load_sheet_pick_lines stores them; sheet_pick_line_state shows them.
--   C. pick_audit_line.do_nos comes from outbound.order_nos of the completed pick.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111','adm@x','{"name":"Admin"}') on conflict do nothing;
update profiles set role = 'admin' where id = '11111111-1111-1111-1111-111111111111';

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.fails(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then
  if sqlerrm not like p_like then raise notice 'got: %', sqlerrm; end if;
  return sqlerrm like p_like; end $$;
create or replace function pg_temp.line_dos(p_date date, p_ship text, p_bin text) returns text[] language sql as $$
  select do_nos from sheet_pick_lines where pick_date = p_date and shipment_number = p_ship and bin_code = p_bin $$;
create or replace function pg_temp.state_dos(p_date date, p_ship text, p_bin text) returns text[] language sql as $$
  select do_nos from sheet_pick_line_state where pick_date = p_date and shipment_number = p_ship and bin_code = p_bin $$;
create or replace function pg_temp.task(p_ship text, p_seq int) returns uuid language sql as $$
  select t.id from pick_tasks t join waves w on w.id = t.wave_id
  where w.planned_date = '2026-11-30' and t.shipment_number = p_ship and t.seq = p_seq $$;
create or replace function pg_temp.view_dos(p_ship text, p_seq int) returns text[] language sql as $$
  select do_nos from pick_audit_line where task_id = pg_temp.task(p_ship, p_seq) $$;
-- 0110: an operator posts only the shipments assigned to them; the fixture admin holds the day's shipments.
create or replace function pg_temp.assign_day(p_date date, p_user uuid) returns void language sql security definer as $$
  insert into public.shipment_assignments (planned_date, shipment_number, user_id, assigned_by_name)
  select w.planned_date, s, p_user, 'fixture' from public.waves w, unnest(w.shipment_numbers) s where w.planned_date = p_date
  on conflict do nothing $$;
grant execute on function pg_temp.check(text, boolean), pg_temp.fails(text, text),
  pg_temp.line_dos(date, text, text), pg_temp.state_dos(date, text, text), pg_temp.task(text, int),
  pg_temp.view_dos(text, int), pg_temp.assign_day(date, uuid) to authenticated;

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

-- ---- A. Normalisation -------------------------------------------------------
select pg_temp.check('norm: trim, drop empty, dedupe, first-seen order',
  norm_do_nos('[" 538306981 ", "538045290", "538306981", "", "   "]'::jsonb) = array['538306981','538045290']);
select pg_temp.check('norm: missing / non-array / null give an empty list',
  norm_do_nos(null) = '{}' and norm_do_nos('"538306981"'::jsonb) = '{}' and norm_do_nos('[]'::jsonb) = '{}');
select pg_temp.check('norm: case is kept (a DO number is not a word)',
  norm_do_nos('["ab1","AB1"]'::jsonb) = array['ab1','AB1']);
select pg_temp.check('norm: capped at 20, first-seen order kept',
  (select array_length(norm_do_nos(jsonb_agg(to_jsonb('DO-' || g))), 1) = 20
          and (norm_do_nos(jsonb_agg(to_jsonb('DO-' || g))))[1] = 'DO-1'
   from generate_series(1, 25) g));

-- ---- B. Loading the file's per-line DOs ------------------------------------
select pg_temp.check('load: DOs stored normalised, a line without them gets an empty list',
  load_sheet_pick_lines('2026-10-12', 'K_ONE', 'WMS.xlsx', '[
    {"shipment_number":"S1","seq":1,"bin_code":"cf38c01","sku":"550044709","batch":"A7","qty":5,
     "do_nos":[" 538306981 ","538045290","538306981",""]},
    {"shipment_number":"S1","seq":2,"bin_code":"CF37C01","sku":"550024919","batch":"C1","qty":2}]'::jsonb)
  = '{"added": 2, "kept": 0, "removed": 0, "skipped": 0}'::jsonb);
select pg_temp.check('load: first line keeps 538306981 then 538045290',
  pg_temp.line_dos('2026-10-12', 'S1', 'CF38C01') = array['538306981','538045290']);
select pg_temp.check('load: a line with no DO in the file has none',
  pg_temp.line_dos('2026-10-12', 'S1', 'CF37C01') = '{}');
select pg_temp.check('state: sheet_pick_line_state exposes the same do_nos',
  pg_temp.state_dos('2026-10-12', 'S1', 'CF38C01') = array['538306981','538045290']);
select load_sheet_pick_lines('2026-10-13', 'K_ONE', null, jsonb_build_array(jsonb_build_object(
  'shipment_number','S1','bin_code','CA01A03','sku','550024919','batch','C1','qty',1,
  'do_nos',(select jsonb_agg(to_jsonb('D-' || g)) from generate_series(1,25) g)))) \g /dev/null
select pg_temp.check('load: a 25-DO line is stored capped at 20',
  array_length(pg_temp.line_dos('2026-10-13', 'S1', 'CA01A03'), 1) = 20);
select pg_temp.check('load: a direct write to sheet_pick_lines is still refused',
  pg_temp.fails($q$insert into sheet_pick_lines (pick_date, source, shipment_number, bin_code, sku, qty, do_nos)
                   values ('2026-10-14', 'K_ONE', 'S9', 'CA01A01', '550024919', 1, '{X}')$q$, '%'));

-- ---- C. pick_audit_line.do_nos from outbound.order_nos -----------------------
-- Stock for the two picks, then a plan whose outbound rows carry the DOs.
-- Putaway movements (not 'adjustment', which would need a reason code while
-- the session claim is set): stock still only ever arrives through movements.
reset role;
delete from inventory where bin_id in (select id from bins where bin_code in ('CF38C01', 'CF37C01'));
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
select 'putaway', i.id, f.batch, f.qty, b.id, f.exp, 'fixture'
from (values ('CF38C01', '550044709', 'A7', 20::numeric, '2031-05-05'::date),
             ('CF37C01', '550024919', 'C1', 20::numeric, '2031-07-07'::date)) f(bin, sku, batch, qty, exp)
join bins b on b.bin_code = f.bin join items i on i.sku = f.sku;
set role authenticated;
select save_plan('2026-11-30', '{
  "waves":[{"wave_no":"1","shipment_numbers":["DO1","DO2"]}],
  "tasks":[
    {"wave_no":"1","shipment_number":"DO1","task_type":"PICK","sku":"550044709","from_bin":"CF38C01","batch_lot":"A7","expiry_date":"2031-05-05","quantity":4,"pick_type":"CASE","seq":1},
    {"wave_no":"1","shipment_number":"DO2","task_type":"PICK","sku":"550024919","from_bin":"CF37C01","batch_lot":"C1","expiry_date":"2031-07-07","quantity":3,"pick_type":"CASE","seq":2}],
  "outbound":[
    {"wave_no":"1","shipment_number":"DO1","sku":"550044709","quantity_requested":4,"quantity_allocated":4,
     "order_nos":[" 538306981 ","538045290","538306981"]},
    {"wave_no":"1","shipment_number":"DO2","sku":"550024919","quantity_requested":3,"quantity_allocated":3,
     "order_nos":["538259123"]}]}'::jsonb) \g /dev/null
select pg_temp.assign_day('2026-11-30', '11111111-1111-1111-1111-111111111111');

-- 0123 appended destination then ship_to_location after do_nos (append-only
-- rule): do_nos itself keeps its place, before the two new columns.
select pg_temp.check('view: do_nos sits before destination and ship_to_location',
  (select (a[1] = 'ship_to_location' and a[2] = 'destination' and a[3] = 'do_nos') from (
     select array_agg(attname order by attnum desc) as a from pg_attribute
     where attrelid = 'public.pick_audit_line'::regclass and attnum > 0 and not attisdropped) t));
select pg_temp.check('view: not a completed pick yet, nothing to show',
  not exists (select 1 from pick_audit_line where planned_date = '2026-11-30'));

select post_task_by(pg_temp.task('DO1', 1), p_by_name => 'Budi Santoso', p_scanned => 'CF38C01');
-- 0124: a plan without a DO split falls back to the shipment + SKU's DOs, normalised by the one
-- rule (norm_do_nos: first-seen order), the same as a Bin To Bin row; no longer sorted.
select pg_temp.check('view: the pick carries its own SKU''s DOs, trimmed, deduped, first-seen order',
  pg_temp.view_dos('DO1', 1) = array['538306981','538045290']);
select post_task_by(pg_temp.task('DO2', 2), p_by_name => 'Budi Santoso', p_scanned => 'CF37C01');
select pg_temp.check('view: each item gets its own DO, not the shipment''s',
  pg_temp.view_dos('DO1', 1) = array['538306981','538045290'] and pg_temp.view_dos('DO2', 2) = array['538259123']);

-- A cancelled outbound line is not a DO of the pick any more.
reset role;
update outbound set status = 'CANCELLED' where shipment_number = 'DO2';
set role authenticated;
select pg_temp.check('view: a cancelled outbound line drops out, empty list stays an array',
  pg_temp.view_dos('DO2', 2) = '{}' and pg_temp.view_dos('DO1', 1) = array['538306981','538045290']);
select pg_temp.check('view: the loader lines are not confused with the plan (their dates differ)',
  (select count(*) from pick_audit_line where planned_date = '2026-11-30') = 2);

rollback;
