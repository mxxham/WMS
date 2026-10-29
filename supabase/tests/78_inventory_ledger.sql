-- Buku stok (0116): stored SAP days, notes, and the live WMS book.
-- Runs in a transaction and rolls back. Every line prints PASS/FAIL.
-- Days relative to today (WIB): A = today-3, B = today-2, C = today-1, on a new test item.
--   A 10:00 receipt (inbound) 100 into CF38C01
--   B 09:00 pick 10, B 11:00 transfer 3 into QUARANTINE
--   C 08:00 putaway 50 (no source bin): arrived on B by the posting-date-minus-one rule
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
create or replace function pg_temp.at(k int, h int) returns timestamptz language sql as $$
  select ((pg_temp.d(k))::timestamp + make_interval(hours => h)) at time zone 'Asia/Jakarta' $$;
create or replace function pg_temp.book(k int) returns setof public.ledger_wms_book_row language sql as $$
  select * from ledger_wms_book(pg_temp.d(k)) where sku = '990000078' $$;
grant execute on function pg_temp.check(text, boolean), pg_temp.fails(text, text), pg_temp.as_user(uuid), pg_temp.d(int),
  pg_temp.at(int, int), pg_temp.book(int) to authenticated;

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('a7811111-1111-1111-1111-111111111111','inv78@pengguna.internal','{"name":"Inv"}','{"username":"t78inv"}'),
  ('a7822222-2222-2222-2222-222222222222','op78@pengguna.internal','{"name":"Op"}','{"username":"t78op"}');
update profiles set job = 'inventory' where id = 'a7811111-1111-1111-1111-111111111111';
update profiles set job = 'operator' where id = 'a7822222-2222-2222-2222-222222222222';

insert into items (sku, description, uom, volume_l) values ('990000078', 'Test ledger 78', 'CAR', 9.6);
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note, created_at) values
  ('inbound', (select id from items where sku = '990000078'), 'L78', 100, (select id from bins where bin_code = 'CF38C01'), '2031-01-01', 't78 receipt', pg_temp.at(3, 10));
insert into movements (type, item_id, batch_lot, quantity, from_bin_id, expiry_date, note, created_at) values
  ('picking', (select id from items where sku = '990000078'), 'L78', 10, (select id from bins where bin_code = 'CF38C01'), '2031-01-01', 't78 pick', pg_temp.at(2, 9));
insert into movements (type, item_id, batch_lot, quantity, from_bin_id, to_bin_id, expiry_date, note, created_at) values
  ('transfer', (select id from items where sku = '990000078'), 'L78', 3, (select id from bins where bin_code = 'CF38C01'),
   (select id from bins where bin_code = 'QUARANTINE'), '2031-01-01', 't78 to quarantine', pg_temp.at(2, 11));
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note, created_at) values
  ('putaway', (select id from items where sku = '990000078'), 'L78', 50, (select id from bins where bin_code = 'CF38C01'), '2031-01-01', 't78 putaway', pg_temp.at(1, 8));

-- ---- A. The WMS book --------------------------------------------------------
select pg_temp.check('day A: receipt of 100 is inbound on its own date, not assumed',
  (select inbound = 100 and inbound_assumed = 0 and awal_unrest = 0 and akhir_unrest = 100 from pg_temp.book(3)));
select pg_temp.check('day B: the putaway posted on C arrived on B (assumed)',
  (select inbound = 50 and inbound_assumed = 50 from pg_temp.book(2)));
select pg_temp.check('day B: pick 10 out, 3 into quarantine',
  (select outbound = 10 and q_in = 3 and q_out = 0 from pg_temp.book(2)));
select pg_temp.check('day B: akhir = real end 87 + the late putaway 50; blocked 3',
  (select awal_unrest = 100 and akhir_unrest = 137 and akhir_block = 3 from pg_temp.book(2)));
select pg_temp.check('day C: awal = akhir of B, no inbound left on C',
  (select awal_unrest = 137 and awal_block = 3 and inbound = 0 and akhir_unrest = 137 from pg_temp.book(1)));
select pg_temp.check('identity awal + inbound - outbound + q_out - q_in + other = akhir, unrestricted and blocked, A..C',
  (select bool_and(awal_unrest + (inbound - inbound_block) - outbound + q_out - q_in + other_unrest = akhir_unrest
               and awal_block + inbound_block + q_in - q_out + other_block = akhir_block)
     from (select * from pg_temp.book(3) union all select * from pg_temp.book(2) union all select * from pg_temp.book(1)) b));
select pg_temp.check('today: the item still holds 137 + 3 as real stock (the ledger wrote nothing)',
  (select sum(quantity) = 140 from inventory where item_id = (select id from items where sku = '990000078')));

-- ---- B. Saving SAP days -----------------------------------------------------
set role authenticated;
select pg_temp.as_user('a7811111-1111-1111-1111-111111111111');
select set_config('t.lines', '[{"sku":"990000078","description":"Test","uom":"CAR","awal_unrest":100,"awal_block":0,"inbound":50,"outbound":10,'
  '"mv343":0,"mv344":3,"z55":0,"other_unrest":0,"other_by_type":{},"akhir_unrest":137,"akhir_block":3,"inbd":0}]', true);
select pg_temp.check('save a day: version 1',
  (ledger_save_day(pg_temp.d(2), 'MB52 a.xlsx', 'Sari', 40, 0, current_setting('t.lines')::jsonb) ->> 'version') = '1');
select pg_temp.check('save the same day again: version 2',
  (ledger_save_day(pg_temp.d(2), 'MB52 b.xlsx', 'Sari', 41, 0, current_setting('t.lines')::jsonb) ->> 'version') = '2');
select pg_temp.check('the latest version is the one shown',
  (select version = 2 and file_name = 'MB52 b.xlsx' from ledger_latest_days where ledger_date = pg_temp.d(2)));
select pg_temp.check('the older version is kept', (select count(*) = 2 from ledger_days where ledger_date = pg_temp.d(2)));
select pg_temp.check('SAP lines stored per SKU',
  (select akhir_unrest = 137 and mv344 = 3 from ledger_sap_lines l join ledger_latest_days d on d.id = l.day_id
    where d.ledger_date = pg_temp.d(2) and l.sku = '990000078'));
select pg_temp.check('a future date is refused',
  pg_temp.fails(format($q$select ledger_save_day(%L, 'x', 'Sari', 0, 0, %L::jsonb)$q$, pg_temp.d(-1), current_setting('t.lines')), '%masa depan%'));
select pg_temp.check('a file without WHS1 stock is refused',
  pg_temp.fails(format($q$select ledger_save_day(%L, 'x', 'Sari', 0, 0, '[]'::jsonb)$q$, pg_temp.d(2)), '%stok WHS1%'));
select pg_temp.check('rows cannot be written directly',
  pg_temp.fails($q$insert into ledger_days (ledger_date, version, file_name) values (current_date, 9, 'x')$q$, '%'));

-- ---- C. Notes ---------------------------------------------------------------
select pg_temp.check('a note is saved', ledger_add_note('990000078', pg_temp.d(2), 'kurang 1, tunggu barang kembali', false, 'Sari') is not null);
select pg_temp.check('an open note needs text',
  pg_temp.fails(format($q$select ledger_add_note('990000078', %L, '  ', false, 'Sari')$q$, pg_temp.d(2)), '%Catatan wajib%'));
select pg_temp.check('closing needs no text', ledger_add_note('990000078', pg_temp.d(1), '', true, 'Sari') is not null);

-- ---- D. Roles and append-only -----------------------------------------------
select pg_temp.as_user('a7822222-2222-2222-2222-222222222222');
select pg_temp.check('an operator cannot save a day',
  pg_temp.fails(format($q$select ledger_save_day(%L, 'x', 'Op', 0, 0, %L::jsonb)$q$, pg_temp.d(2), current_setting('t.lines')), '%Inventory, Leader atau Admin%'));
select pg_temp.check('an operator cannot add a note',
  pg_temp.fails(format($q$select ledger_add_note('990000078', %L, 'x', false, 'Op')$q$, pg_temp.d(2)), '%Inventory, Leader atau Admin%'));
reset role;
select pg_temp.check('a saved day cannot be changed, even by the table owner',
  pg_temp.fails($q$update ledger_days set file_name = 'y'$q$, '%tidak bisa diubah%'));
select pg_temp.check('a note cannot be deleted, even by the table owner',
  pg_temp.fails($q$delete from ledger_notes$q$, '%tidak bisa diubah%'));

rollback;
