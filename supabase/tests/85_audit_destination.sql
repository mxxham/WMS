-- Destination and ship-to location on the picking audit (0123).
-- The checker sees, per item, the ship-to company and the city, next to the DO.
-- Runs in a transaction and rolls back. Every line prints PASS/FAIL.
--   A. save_plan stores outbound.ship_to_location exactly.
--   B. A completed PICK shows both from outbound, on the line and the shipment.
--   C. A wave whose combined destination carries the city but whose outbound
--      has no location falls back to the wave split.
--   D. A completed Bin To Bin move shows both arrays; a relocation with no
--      demand for its SKU falls back to the wave's own values.
--   E. The file's two columns are stored trimmed, exposed by
--      sheet_pick_line_state, and a re-upload only fills blank metadata on an
--      already-audited line (the audit row and its quantities stay).
--   F. Column order, types and grants.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111','adm@x','{"name":"Admin"}') on conflict do nothing;
update profiles set role = 'admin' where id = '11111111-1111-1111-1111-111111111111';

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.wave(p_no text) returns uuid language sql as $$
  select id from public.waves where planned_date = '2026-12-07' and wave_no = p_no $$;
create or replace function pg_temp.line(p_wave text, p_ship text) returns uuid language sql as $$
  select t.id from public.pick_tasks t
  where t.wave_id = pg_temp.wave(p_wave) and t.shipment_number = p_ship and t.task_type = 'PICK' $$;
create or replace function pg_temp.move(p_wave text, p_sku text) returns uuid language sql as $$
  select t.id from public.pick_tasks t join public.items i on i.id = t.item_id
  where t.wave_id = pg_temp.wave(p_wave) and i.sku = p_sku and t.task_type = 'REPLENISH' $$;
create or replace function pg_temp.dest(p_task uuid) returns text language sql as $$
  select destination from public.pick_audit_line where task_id = p_task $$;
create or replace function pg_temp.loc(p_task uuid) returns text language sql as $$
  select ship_to_location from public.pick_audit_line where task_id = p_task $$;
create or replace function pg_temp.ship_dest(p_wave text, p_ship text) returns text language sql as $$
  select destination from public.pick_audit_shipment
  where wave_id = pg_temp.wave(p_wave) and shipment_number = p_ship $$;
create or replace function pg_temp.ship_loc(p_wave text, p_ship text) returns text language sql as $$
  select ship_to_location from public.pick_audit_shipment
  where wave_id = pg_temp.wave(p_wave) and shipment_number = p_ship $$;
create or replace function pg_temp.move_dests(p_task uuid) returns text[] language sql as $$
  select destinations from public.pick_audit_move where task_id = p_task $$;
create or replace function pg_temp.move_locs(p_task uuid) returns text[] language sql as $$
  select ship_to_locations from public.pick_audit_move where task_id = p_task $$;
create or replace function pg_temp.sheet_dest(p_line uuid) returns text language sql as $$
  select destination from public.sheet_pick_lines where id = p_line $$;
create or replace function pg_temp.sheet_loc(p_line uuid) returns text language sql as $$
  select ship_to_location from public.sheet_pick_lines where id = p_line $$;
create or replace function pg_temp.state_dest(p_line uuid) returns text language sql as $$
  select destination from public.sheet_pick_line_state where id = p_line $$;
create or replace function pg_temp.state_loc(p_line uuid) returns text language sql as $$
  select ship_to_location from public.sheet_pick_line_state where id = p_line $$;
create or replace function pg_temp.sheet_line(p_date date, p_ship text, p_bin text) returns uuid language sql as $$
  select id from public.sheet_pick_lines
  where pick_date = p_date and shipment_number = p_ship and bin_code = p_bin $$;
-- 0110: an operator posts only the shipments assigned to them; the fixture admin holds the day's shipments.
create or replace function pg_temp.assign_day(p_date date, p_user uuid) returns void language sql security definer as $$
  insert into public.shipment_assignments (planned_date, shipment_number, user_id, assigned_by_name)
  select w.planned_date, s, p_user, 'fixture' from public.waves w, unnest(w.shipment_numbers) s where w.planned_date = p_date
  on conflict do nothing $$;
grant execute on function pg_temp.check(text, boolean), pg_temp.wave(text), pg_temp.line(text, text),
  pg_temp.move(text, text), pg_temp.dest(uuid), pg_temp.loc(uuid), pg_temp.ship_dest(text, text),
  pg_temp.ship_loc(text, text), pg_temp.move_dests(uuid), pg_temp.move_locs(uuid),
  pg_temp.sheet_dest(uuid), pg_temp.sheet_loc(uuid), pg_temp.state_dest(uuid), pg_temp.state_loc(uuid),
  pg_temp.sheet_line(date, text, text), pg_temp.assign_day(date, uuid) to authenticated;

-- ---- Fixture: stock for the two picks, then the plan ------------------------
-- Putaway movements, not 'adjustment' (which would need a reason code while the
-- session claim is set): stock still only ever arrives through movements.
reset role;
delete from inventory where bin_id in (select id from bins where bin_code in ('CF38C01', 'CF37C01'));
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
select 'putaway', i.id, f.batch, f.qty, b.id, f.exp, 'fixture'
from (values ('CF38C01', '550044709', 'A7', 20::numeric, '2031-05-05'::date),
             ('CF37C01', '550024919', 'C1', 20::numeric, '2031-07-07'::date)) f(bin, sku, batch, qty, exp)
join bins b on b.bin_code = f.bin join items i on i.sku = f.sku;

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

-- Wave 85A carries the combined destination and a full outbound line.
-- Wave 85B carries the combined destination but its outbound line has no
-- location at all (exactly what a file without that column produces).
select save_plan('2026-12-07', '{
  "waves":[
    {"wave_no":"85A","shipment_numbers":["DS1"],"destination":"PT SHELL INDONESIA · SURABAYA"},
    {"wave_no":"85B","shipment_numbers":["DS2"],"destination":"PT PERTAMINA LUBRICANTS · CILACAP"}],
  "tasks":[
    {"wave_no":"85A","shipment_number":"DS1","task_type":"PICK","sku":"550044709","from_bin":"CF38C01","batch_lot":"A7","expiry_date":"2031-05-05","quantity":4,"pick_type":"CASE","seq":1},
    {"wave_no":"85B","shipment_number":"DS2","task_type":"PICK","sku":"550024919","from_bin":"CF37C01","batch_lot":"C1","expiry_date":"2031-07-07","quantity":3,"pick_type":"CASE","seq":1}],
  "outbound":[
    {"wave_no":"85A","shipment_number":"DS1","sku":"550044709","quantity_requested":4,"quantity_allocated":4,
     "order_nos":["539000010"],"destination":"PT SHELL INDONESIA","ship_to_location":"SURABAYA"},
    {"wave_no":"85B","shipment_number":"DS2","sku":"550024919","quantity_requested":3,"quantity_allocated":3,
     "order_nos":["539000011"],"destination":"PT PERTAMINA LUBRICANTS"}]}'::jsonb) \g /dev/null

-- ---- A. save_plan writes the location per shipment + SKU --------------------
select pg_temp.check('A: outbound keeps the destination (company) and the ship-to location, verbatim',
  (select destination = 'PT SHELL INDONESIA' and ship_to_location = 'SURABAYA'
     from outbound where wave_id = pg_temp.wave('85A') and shipment_number = 'DS1' and sku = '550044709'));
select pg_temp.check('A: a line with no location in the plan gets an empty string, never NULL',
  (select ship_to_location = '' and ship_to_location is not null
     from outbound where wave_id = pg_temp.wave('85B') and shipment_number = 'DS2' and sku = '550024919'));

select pg_temp.assign_day('2026-12-07', '11111111-1111-1111-1111-111111111111');

-- ---- B. A completed PICK shows both, from the outbound line -----------------
select pg_temp.check('B: nothing to show before the pick is posted',
  not exists (select 1 from pick_audit_line where planned_date = '2026-12-07'));
select post_task_by(pg_temp.line('85A', 'DS1'), p_by_name => 'Budi Santoso', p_scanned => 'CF38C01');
select pg_temp.check('B: the picked line shows the outbound company and city',
  pg_temp.dest(pg_temp.line('85A', 'DS1')) = 'PT SHELL INDONESIA'
  and pg_temp.loc(pg_temp.line('85A', 'DS1')) = 'SURABAYA');
select pg_temp.check('B: the shipment row shows the same pair',
  pg_temp.ship_dest('85A', 'DS1') = 'PT SHELL INDONESIA' and pg_temp.ship_loc('85A', 'DS1') = 'SURABAYA');

-- ---- C. No location on the outbound line: the wave's split fills it ---------
select post_task_by(pg_temp.line('85B', 'DS2'), p_by_name => 'Budi Santoso', p_scanned => 'CF37C01');
select pg_temp.check('C: the line falls back to the wave split for the city, the company from outbound',
  pg_temp.dest(pg_temp.line('85B', 'DS2')) = 'PT PERTAMINA LUBRICANTS'
  and pg_temp.loc(pg_temp.line('85B', 'DS2')) = 'CILACAP');
select pg_temp.check('C: the shipment row falls back the same way',
  pg_temp.ship_dest('85B', 'DS2') = 'PT PERTAMINA LUBRICANTS' and pg_temp.ship_loc('85B', 'DS2') = 'CILACAP');

-- ---- D. Bin To Bin rows carry both arrays ----------------------------------
-- Two completed moves on 85A (the view is read-only: the tasks are inserted
-- with status COMPLETED, the 84 pattern), plus a wave with no destination.
reset role;
insert into waves (wave_no, planned_date, shipment_numbers, destination, status)
values ('85C', '2026-12-07', '{DS3}', '', 'PENDING');
insert into pick_tasks (wave_id, shipment_number, task_type, item_id, from_bin_id, to_bin_id, batch_lot, expiry_date,
                        quantity, pick_type, seq, status)
values
  (pg_temp.wave('85A'), null, 'REPLENISH', (select id from items where sku = '550044709'),
   (select id from bins where bin_code = 'CF38C01'), (select id from bins where bin_code = 'CF38C02'),
   'A7', '2031-05-05', 4, 'CASE', 11, 'COMPLETED'),
  (pg_temp.wave('85A'), null, 'REPLENISH', (select id from items where sku = '550024919'),
   (select id from bins where bin_code = 'CF38C02'), (select id from bins where bin_code = 'CF38C01'),
   'C1', '2031-07-07', 2, 'CASE', 12, 'COMPLETED'),
  (pg_temp.wave('85C'), null, 'REPLENISH', (select id from items where sku = '550024986'),
   (select id from bins where bin_code = 'CF38C01'), (select id from bins where bin_code = 'CF38C02'),
   '12695961', '2030-08-21', 1, 'CASE', 13, 'COMPLETED');
set role authenticated;

select pg_temp.check('D: a move whose SKU the wave picks shows that demand''s destination and location',
  pg_temp.move_dests(pg_temp.move('85A', '550044709')) = array['PT SHELL INDONESIA']
  and pg_temp.move_locs(pg_temp.move('85A', '550044709')) = array['SURABAYA']);
select pg_temp.check('D: a relocation with no demand for its SKU falls back to the wave''s own pair',
  pg_temp.move_dests(pg_temp.move('85A', '550024919')) = array['PT SHELL INDONESIA']
  and pg_temp.move_locs(pg_temp.move('85A', '550024919')) = array['SURABAYA']);
select pg_temp.check('D: a wave with no destination and no demand gives empty arrays, not NULL',
  pg_temp.move_dests(pg_temp.move('85C', '550024986')) = '{}'
  and pg_temp.move_locs(pg_temp.move('85C', '550024986')) = '{}');

-- ---- E. The file's two columns ---------------------------------------------
select pg_temp.check('E: the loader stores both columns trimmed',
  load_sheet_pick_lines('2026-12-09', 'K_ONE', 'WMS.xlsx', '[
    {"shipment_number":"DS9","seq":1,"bin_code":"cf38c01","sku":"550044709","batch":"A7","expiry":"2031-05-05",
     "qty":2,"picker_name":"Budi Santoso","destination":"  PT SHELL INDONESIA  ","ship_to_location":" SURABAYA "},
    {"shipment_number":"DS9","seq":2,"bin_code":"CF37C01","sku":"550024919","batch":"C1","expiry":"2031-07-07",
     "qty":3,"picker_name":"Budi Santoso"}]'::jsonb)
  = '{"added":2,"kept":0,"removed":0,"skipped":0}'::jsonb
  and pg_temp.sheet_dest(pg_temp.sheet_line('2026-12-09', 'DS9', 'CF38C01')) = 'PT SHELL INDONESIA'
  and pg_temp.sheet_loc(pg_temp.sheet_line('2026-12-09', 'DS9', 'CF38C01')) = 'SURABAYA');
select pg_temp.check('E: a line whose file has no destination keeps two empty strings',
  pg_temp.sheet_dest(pg_temp.sheet_line('2026-12-09', 'DS9', 'CF37C01')) = ''
  and pg_temp.sheet_loc(pg_temp.sheet_line('2026-12-09', 'DS9', 'CF37C01')) = '');
select pg_temp.check('E: sheet_pick_line_state exposes both columns',
  pg_temp.state_dest(pg_temp.sheet_line('2026-12-09', 'DS9', 'CF38C01')) = 'PT SHELL INDONESIA'
  and pg_temp.state_loc(pg_temp.sheet_line('2026-12-09', 'DS9', 'CF38C01')) = 'SURABAYA');

-- An audited line whose metadata was blank when it was audited (loaded before 0123).
select record_sheet_pick_audit(
  pg_temp.sheet_line('2026-12-09', 'DS9', 'CF37C01'), 'Ani Checker', '550024919', 3, 'C1', '2031-07-07', false, null) \g /dev/null
select pg_temp.check('E: the audited line is OK and still has no destination',
  (select count(*) from sheet_pick_audits a where a.line_id = pg_temp.sheet_line('2026-12-09', 'DS9', 'CF37C01')) = 1
  and (select result from sheet_pick_audits where line_id = pg_temp.sheet_line('2026-12-09', 'DS9', 'CF37C01')) = 'OK'
  and pg_temp.sheet_dest(pg_temp.sheet_line('2026-12-09', 'DS9', 'CF37C01')) = '');

-- Re-upload with the same key, the metadata now present and a different qty:
-- only the two blank fields are filled, the audit row and its quantities stay.
select pg_temp.check('E: a re-upload of the day keeps the audited line and reports it kept',
  load_sheet_pick_lines('2026-12-09', 'K_ONE', 'WMS.xlsx', '[
    {"shipment_number":"DS9","seq":1,"bin_code":"CF38C01","sku":"550044709","batch":"A7","expiry":"2031-05-05",
     "qty":9,"picker_name":"Budi Santoso","destination":"PT SHELL INDONESIA","ship_to_location":"SURABAYA"},
    {"shipment_number":"DS9","seq":2,"bin_code":"CF37C01","sku":"550024919","batch":"C1","expiry":"2031-07-07",
     "qty":9,"picker_name":"Budi Santoso","destination":"PT PERTAMINA LUBRICANTS","ship_to_location":"CILACAP"}]'::jsonb)
  = '{"added":1,"kept":1,"removed":1,"skipped":1}'::jsonb);
select pg_temp.check('E: the audited line keeps its audit and its qty, and gets the two values',
  (select count(*) from sheet_pick_audits a where a.line_id = pg_temp.sheet_line('2026-12-09', 'DS9', 'CF37C01')) = 1
  and (select qty from sheet_pick_lines where id = pg_temp.sheet_line('2026-12-09', 'DS9', 'CF37C01')) = 3
  and pg_temp.sheet_dest(pg_temp.sheet_line('2026-12-09', 'DS9', 'CF37C01')) = 'PT PERTAMINA LUBRICANTS'
  and pg_temp.sheet_loc(pg_temp.sheet_line('2026-12-09', 'DS9', 'CF37C01')) = 'CILACAP');
select pg_temp.check('E: a re-upload with no metadata in the file wipes nothing',
  load_sheet_pick_lines('2026-12-09', 'K_ONE', 'WMS.xlsx', '[
    {"shipment_number":"DS9","seq":2,"bin_code":"CF37C01","sku":"550024919","batch":"C1","expiry":"2031-07-07",
     "qty":3,"picker_name":"Budi Santoso"}]'::jsonb)->>'kept' = '1'
  and pg_temp.sheet_dest(pg_temp.sheet_line('2026-12-09', 'DS9', 'CF37C01')) = 'PT PERTAMINA LUBRICANTS'
  and pg_temp.sheet_loc(pg_temp.sheet_line('2026-12-09', 'DS9', 'CF37C01')) = 'CILACAP');

-- ---- F. Column order, types and grants ------------------------------------
select pg_temp.check('F: pick_audit_line ends with destination then ship_to_location, both text',
  (select (a[1] = 'ship_to_location' and a[2] = 'destination' and a[3] = 'do_nos') from (
     select array_agg(attname order by attnum desc) as a from pg_attribute
     where attrelid = 'public.pick_audit_line'::regclass and attnum > 0 and not attisdropped) t)
  and (select bool_and(pg_typeof(destination) = 'text'::regtype and pg_typeof(ship_to_location) = 'text'::regtype
                       and destination is not null and ship_to_location is not null)
       from pick_audit_line));
select pg_temp.check('F: pick_audit_move ends with destinations then ship_to_locations, both text[]',
  (select (a[1] = 'ship_to_locations' and a[2] = 'destinations' and a[3] = 'do_nos') from (
     select array_agg(attname order by attnum desc) as a from pg_attribute
     where attrelid = 'public.pick_audit_move'::regclass and attnum > 0 and not attisdropped) t)
  and (select bool_and(pg_typeof(destinations) = 'text[]'::regtype and pg_typeof(ship_to_locations) = 'text[]'::regtype)
       from pick_audit_move));
select pg_temp.check('F: pick_audit_shipment ends with destination then ship_to_location, both text',
  (select (a[1] = 'ship_to_location' and a[2] = 'destination' and a[3] = 'load_legacy') from (
     select array_agg(attname order by attnum desc) as a from pg_attribute
     where attrelid = 'public.pick_audit_shipment'::regclass and attnum > 0 and not attisdropped) t)
  and (select bool_and(pg_typeof(destination) = 'text'::regtype and pg_typeof(ship_to_location) = 'text'::regtype)
       from pick_audit_shipment));
select pg_temp.check('F: the four views are still readable by authenticated, and no write policy was added',
  has_table_privilege('authenticated', 'public.pick_audit_line', 'select')
  and has_table_privilege('authenticated', 'public.pick_audit_move', 'select')
  and has_table_privilege('authenticated', 'public.pick_audit_shipment', 'select')
  and has_table_privilege('authenticated', 'public.sheet_pick_line_state', 'select')
  and not exists (select 1 from pg_policies where schemaname = 'public'
                  and tablename in ('outbound', 'sheet_pick_lines') and cmd <> 'SELECT'));

rollback;
