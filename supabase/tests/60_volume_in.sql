-- 0094: volume_in_daily mirrors volume_out_daily (0091) for the inflow side.
-- Inflow = movements of type 'inbound' or 'putaway', quantity > 0.
-- Rows with NULL items.volume_l are excluded entirely; transfer and picking
-- movements are not inflow and must never appear. Runs in a transaction, rolls back.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;

insert into auth.users values
  ('11111111-1111-1111-1111-111111111111','op@x','{"name":"Operator"}'),
  ('22222222-2222-2222-2222-222222222222','sup@x','{"name":"Supervisor"}') on conflict do nothing;
update profiles set role='supervisor' where id='22222222-2222-2222-2222-222222222222';

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;

create or replace function pg_temp.item(p_sku text) returns uuid
language sql stable as $$ select id from items where sku = p_sku $$;
create or replace function pg_temp.bin1(p_code text) returns uuid
language sql stable as $$ select id from bins where bin_code = p_code $$;

-- Volume data for the fixture item; a second item deliberately has NULL volume.
update items set volume_l = 20 where sku = '550044709';
-- Day A = the fixture's counted-inflow day. Mirrors the view's own filter
-- (join items, volume_l not null) so the day-B NULL-volume row cannot drag
-- the day anchor into the exclusion day.
create or replace function pg_temp.in_day() returns date language sql stable as $$
  select (max(m.created_at) at time zone 'Asia/Jakarta')::date from public.movements m
  join public.items it on it.id = m.item_id
  where m.type in ('inbound','putaway') and m.note = 'fixture' and it.volume_l is not null $$;

-- ---- Fixture --------------------------------------------------------------
-- Day A (now + 2 h): inflow stock. Batch IN1, expiry 2031.
--   inbound 10 cartons @ 20 L, then putaway moves 5 of them to the neighbour bin.
-- Day B (now + 50 h, always two calendar days after day A): only exclusions —
--   a picking row, a transfer row and an inbound row of a NULL-volume item.
--   volume_in_daily must show NO row for that day.
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note, created_at)
values ('inbound', pg_temp.item('550044709'), 'IN1', 10, pg_temp.bin1('CF38C01'), '2031-01-01', 'fixture', now() + interval '2 hours');
insert into movements (type, item_id, batch_lot, quantity, from_bin_id, to_bin_id, expiry_date, note, created_at)
values ('putaway', pg_temp.item('550044709'), 'IN1', 5, pg_temp.bin1('CF38C01'), pg_temp.bin1('CF38C02'), '2031-01-01', 'fixture', now() + interval '2 hours');

-- A NULL-volume inbound on day B: counted by stock, never by the view.
insert into items (sku, description, uom)
values ('5500VANN', 'No Volume In Test', 'CAR') on conflict (sku) do update set volume_l = null;
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note, created_at)
values ('inbound', pg_temp.item('5500VANN'), 'NN', 4, pg_temp.bin1('CF38C01'), '2031-02-02', 'fixture', now() + interval '50 hours');

-- Day B exclusions that do need stock behind them: pick 3 of the 10, transfer 2 back.
insert into movements (type, item_id, batch_lot, quantity, from_bin_id, expiry_date, note, created_at)
values ('picking', pg_temp.item('550044709'), 'IN1', 3, pg_temp.bin1('CF38C01'), '2031-01-01', 'fixture', now() + interval '50 hours');
insert into movements (type, item_id, batch_lot, quantity, from_bin_id, to_bin_id, expiry_date, note, created_at)
values ('transfer', pg_temp.item('550044709'), 'IN1', 2, pg_temp.bin1('CF38C02'), pg_temp.bin1('CF38C01'), '2031-01-01', 'fixture', now() + interval '50 hours');

-- ---- Manual mirror of the view (same predicates, unfiltered by note) ------
create or replace function pg_temp.manual_in(p_day date) returns table (boxes numeric, litres numeric, picks int)
language sql stable as $$
  select sum(m.quantity), sum(m.quantity * it.volume_l), count(*)
  from public.movements m
  join public.items it on it.id = m.item_id
  where m.type in ('inbound', 'putaway')
    and m.quantity > 0
    and it.volume_l is not null
    and (m.created_at at time zone 'Asia/Jakarta')::date = p_day
$$;

-- ---- Assertions -----------------------------------------------------------
-- View row exists for the fixture day (scratch seed adds its own inflow on the
-- same wall-clock day; both sides therefore see seed + fixture — that is the point).
select pg_temp.check('volume_in_daily has a row for the fixture day',
  exists (select 1 from volume_in_daily where day = pg_temp.in_day()));

-- View math matches the manual mirror on that day.
select pg_temp.check('volume_in_daily boxes matches manual mirror',
  (select boxes from volume_in_daily where day = pg_temp.in_day()) = (select boxes from pg_temp.manual_in(pg_temp.in_day())));
select pg_temp.check('volume_in_daily litres matches manual mirror',
  (select litres from volume_in_daily where day = pg_temp.in_day()) = (select litres from pg_temp.manual_in(pg_temp.in_day())));
select pg_temp.check('volume_in_daily picks matches manual mirror',
  (select picks from volume_in_daily where day = pg_temp.in_day()) = (select picks from pg_temp.manual_in(pg_temp.in_day())));

-- Day B must be silent: every row there is excluded (picking, transfer, NULL volume).
select pg_temp.check('volume_in_daily ignores picking / transfer / NULL volume days',
  not exists (select 1 from volume_in_daily
              where day = (select ((max(created_at)) at time zone 'Asia/Jakarta')::date
                             from public.movements where type in ('picking') and note = 'fixture')));

-- Grants: mirror volume_out_daily — authenticated may select.
select pg_temp.check('volume_in_daily is selectable by authenticated',
  has_table_privilege('authenticated', 'public.volume_in_daily', 'select'));

rollback;
