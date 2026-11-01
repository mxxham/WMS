-- Bin To Bin (REPLENISH) rows carry their shipment and DO (0122).
-- A move has no shipment of its own (pick_tasks.shipment_number is null by
-- design): both are derived from the wave at read time, never stored on the
-- task. Runs in a transaction and rolls back. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.ships(p_task uuid) returns text[] language sql as $$
  select shipment_numbers from pick_audit_move where task_id = p_task $$;
create or replace function pg_temp.dos(p_task uuid) returns text[] language sql as $$
  select do_nos from pick_audit_move where task_id = p_task $$;

-- ---- Fixture (postgres: the view is read-only, no stock is touched) --------
-- One wave that carries shipment 10975623, and one manual DO typed on the Wave page (0079).
insert into waves (wave_no, planned_date, shipment_numbers, status)
values ('10975623 RESCHEDULE', '2026-11-02', '{10975623}', 'PENDING');
create or replace function pg_temp.w() returns uuid language sql as $$
  select id from waves where planned_date = '2026-11-02' and wave_no = '10975623 RESCHEDULE' $$;

-- Outbound demand for 550044709: one live row with messy order numbers, one cancelled row with another DO.
insert into outbound (outbound_date, wave_id, shipment_number, sku, item_id, description, order_nos,
                      quantity_requested, quantity_allocated, status)
values
  ('2026-11-02', pg_temp.w(), '10975623', '550044709', (select id from items where sku = '550044709'), 'Rimula',
   '{539468824," 539999999 ",539468824,""}', 10, 10, 'PLANNED'),
  ('2026-11-02', pg_temp.w(), '10975623', '550044709', (select id from items where sku = '550044709'), 'Rimula',
   '{539777777}', 5, 5, 'CANCELLED');

-- A DO typed by hand on the Wave page for the same shipment.
insert into shipment_do_no (wave_id, shipment_number, do_nos)
values (pg_temp.w(), '10975623', '["539000001"]');

-- Two completed Bin To Bin lines: one for the SKU the wave picks, one for a SKU the wave has no demand for.
insert into pick_tasks (wave_id, shipment_number, task_type, item_id, from_bin_id, to_bin_id, batch_lot, expiry_date,
                        quantity, pick_type, seq, status)
values
  (pg_temp.w(), null, 'REPLENISH', (select id from items where sku = '550044709'),
   (select id from bins where bin_code = 'CF38C01'), (select id from bins where bin_code = 'CF38C02'),
   'A7', '2031-05-05', 4, 'CASE', 1, 'COMPLETED'),
  (pg_temp.w(), null, 'REPLENISH', (select id from items where sku = '550024919'),
   (select id from bins where bin_code = 'CF38C02'), (select id from bins where bin_code = 'CF38C01'),
   'C1', '2031-07-07', 2, 'CASE', 2, 'COMPLETED');

create or replace function pg_temp.task(p_sku text) returns uuid language sql as $$
  select t.id from pick_tasks t join items i on i.id = t.item_id
  where t.wave_id = pg_temp.w() and i.sku = p_sku $$;

-- ---- A. A move whose SKU the wave picks: shipments + every DO of theirs ---
select pg_temp.check('move: the shipment comes from the wave''s outbound demand for the SKU',
  pg_temp.ships(pg_temp.task('550044709')) = '{10975623}');
-- 0124: this move follows no pick (seq 1), so it falls back to the wave's demand for its SKU. The
-- manual DO typed on the Wave page is shipment paperwork and is no longer put on an item.
select pg_temp.check('move: DOs are the plan order numbers, trimmed/deduped; the manual one is not added',
  pg_temp.dos(pg_temp.task('550044709')) = '{539468824,539999999}');
select pg_temp.check('move: a cancelled outbound line contributes no shipment and no DO',
  not ('539777777' = any (pg_temp.dos(pg_temp.task('550044709'))))
  and not ('539777777' = any (select unnest(do_nos) from pick_audit_move where wave_id = pg_temp.w())));

-- ---- B. A relocation move: the wave's shipments, but no DO -----------------
select pg_temp.check('relocation: fallback to the wave''s shipment numbers',
  pg_temp.ships(pg_temp.task('550024919')) = '{10975623}');
select pg_temp.check('relocation: no demand for its SKU, so no DO and the manual one is not borrowed',
  pg_temp.dos(pg_temp.task('550024919')) = '{}');

-- ---- C. The columns are appended and hold their types ---------------------
-- 0123 appended destinations then ship_to_locations after 0122's batch.
select pg_temp.check('view: the last columns are ship_to_locations, destinations, do_nos, shipment_numbers, from_audited_at',
  (select (a[1] = 'ship_to_locations' and a[2] = 'destinations' and a[3] = 'do_nos'
           and a[4] = 'shipment_numbers' and a[5] = 'from_audited_at') from (
     select array_agg(attname order by attnum desc) as a from pg_attribute
     where attrelid = 'public.pick_audit_move'::regclass and attnum > 0 and not attisdropped) t));
select pg_temp.check('view: all four are text[] and not null for every row',
  (select bool_and(pg_typeof(shipment_numbers) = 'text[]'::regtype and pg_typeof(do_nos) = 'text[]'::regtype
                   and pg_typeof(destinations) = 'text[]'::regtype and pg_typeof(ship_to_locations) = 'text[]'::regtype
                   and shipment_numbers is not null and do_nos is not null
                   and destinations is not null and ship_to_locations is not null)
   from pick_audit_move where wave_id = pg_temp.w()));
select pg_temp.check('view: nothing is copied onto the task itself',
  (select bool_and(shipment_number is null) from pick_tasks where wave_id = pg_temp.w()));

rollback;
