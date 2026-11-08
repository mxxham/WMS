-- Tanggal barang datang on putaway (0117): Buku stok files a putaway's inbound on the recorded arrival date.
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
create or replace function pg_temp.d(k int) returns date language sql as $$ select (now() at time zone 'Asia/Jakarta')::date - k $$;
create or replace function pg_temp.inb(k int) returns public.ledger_wms_book_row language sql as $$
  select * from ledger_wms_book(pg_temp.d(k)) where sku = '990000079' $$;
grant execute on function pg_temp.check(text, boolean), pg_temp.fails(text, text), pg_temp.as_user(uuid), pg_temp.d(int), pg_temp.inb(int) to authenticated;

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('a7911111-1111-1111-1111-111111111111','lead79@pengguna.internal','{"name":"Lead"}','{"username":"t79lead"}');
update profiles set job = 'leader' where id = 'a7911111-1111-1111-1111-111111111111';
insert into items (sku, description, uom, volume_l) values ('990000079', 'Test putaway 79', 'CAR', 12);
delete from inventory where bin_id = (select id from bins where bin_code = 'CF38C02');
select set_config('t.rows', '[{"line":2,"bin_code":"CF38C02","sku":"990000079","batch_lot":"P79","expiry_date":"2031-01-01","quantity":40}]', true);

set role authenticated;
select pg_temp.as_user('a7911111-1111-1111-1111-111111111111');

select pg_temp.check('a dry run needs no arrival date',
  (putaway_import_arrival(current_setting('t.rows')::jsonb, 'sheet79.xlsx', false, 'Lead', null) -> 'rows') is not null);
select pg_temp.check('posting without an arrival date is refused',
  pg_temp.fails($q$select putaway_import_arrival(current_setting('t.rows')::jsonb, 'sheet79.xlsx', true, 'Lead', null)$q$, '%Tanggal barang datang wajib%'));
select pg_temp.check('an arrival date in the future is refused',
  pg_temp.fails(format($q$select putaway_import_arrival(current_setting('t.rows')::jsonb, 'sheet79.xlsx', true, 'Lead', %L)$q$, pg_temp.d(-1)), '%masa depan%'));
select pg_temp.check('an arrival date more than 7 days back is refused',
  pg_temp.fails(format($q$select putaway_import_arrival(current_setting('t.rows')::jsonb, 'sheet79.xlsx', true, 'Lead', %L)$q$, pg_temp.d(8)), '%lebih dari 7 hari%'));
select pg_temp.check('nothing was posted by the refused calls',
  (select coalesce(sum(quantity), 0) = 0 from inventory where item_id = (select id from items where sku = '990000079')));

select set_config('t.res', putaway_import_arrival(current_setting('t.rows')::jsonb, 'sheet79.xlsx', true, 'Lead', pg_temp.d(2))::text, true);
select pg_temp.check('posting with an arrival date posts the putaway as before',
  (current_setting('t.res')::jsonb ->> 'movements')::int = 1
  and (select sum(quantity) = 40 from inventory where item_id = (select id from items where sku = '990000079')));
select pg_temp.check('the arrival date is recorded for the import',
  (select arrival_date = pg_temp.d(2) from putaway_arrivals where import_id = (current_setting('t.res')::jsonb ->> 'import_id')::uuid));
select pg_temp.check('Buku stok files the inbound on the recorded date, not assumed',
  (select inbound = 40 and inbound_assumed = 0 from pg_temp.inb(2)));
select pg_temp.check('and not on the day before posting (the old assumption)',
  (select coalesce(inbound, 0) = 0 from pg_temp.inb(1)) or (select count(*) = 0 from pg_temp.inb(1) where inbound <> 0));
select pg_temp.check('the stock arrived by day 2 counts in the akhir of days 2 and 1',
  (select akhir_unrest = 40 from pg_temp.inb(2)) and (select akhir_unrest = 40 from pg_temp.inb(1)));
-- The window edge: an arrival 7 days back (the oldest the page accepts) is still filed on that day.
reset role;
insert into items (sku, description, uom) values ('990000097', 'Test putaway 79 edge', 'CAR');
delete from inventory where bin_id = (select id from bins where bin_code = 'CF38C01');
set role authenticated;
select pg_temp.as_user('a7911111-1111-1111-1111-111111111111');
select putaway_import_arrival('[{"line":3,"bin_code":"CF38C01","sku":"990000097","batch_lot":"E79","expiry_date":"2031-01-01","quantity":7}]'::jsonb,
  'edge79.xlsx', true, 'Lead', pg_temp.d(7));
select pg_temp.check('an arrival 7 days back is filed on that day',
  (select inbound = 7 and inbound_assumed = 0 from ledger_wms_book(pg_temp.d(7)) where sku = '990000097'));
select pg_temp.check('and counts in every akhir since',
  (select bool_and(akhir_unrest = 7) from generate_series(1, 7) k, ledger_wms_book(pg_temp.d(k)) b where b.sku = '990000097'));

-- 0125: the dashboard's Arus barang chart counts the putaway on its arrival day, not the posting day.
select pg_temp.check('volume_in_daily counts the putaway on its arrival day',
  (select boxes >= 40 from volume_in_daily where day = pg_temp.d(2)));
select pg_temp.check('volume_in_daily does not count it on the posting day',
  coalesce((select boxes from volume_in_daily where day = pg_temp.d(0)), 0) =
  (select coalesce(sum(m.quantity), 0) from movements m join items it on it.id = m.item_id
    where m.type in ('inbound', 'putaway') and m.quantity > 0 and it.volume_l is not null
      and (m.created_at at time zone 'Asia/Jakarta')::date = pg_temp.d(0)
      and not exists (select 1 from putaway_arrival_moves pam where pam.movement_id = m.id)));

select pg_temp.check('arrival dates cannot be written directly',
  pg_temp.fails($q$insert into putaway_arrivals (import_id, arrival_date) values (gen_random_uuid(), current_date)$q$, '%'));

reset role;
select pg_temp.check('a recorded arrival date cannot be changed, even by the table owner',
  pg_temp.fails($q$update putaway_arrivals set arrival_date = current_date$q$, '%tidak bisa diubah%'));

rollback;
