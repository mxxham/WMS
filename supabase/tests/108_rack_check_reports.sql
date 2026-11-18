-- Cek stok rak reports (0145): every save leaves one append-only report. Same rack as test 107 (bins ZK01-ZK04,
-- made by the test). Runs in a transaction and rolls back. Every line prints PASS/FAIL.
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
-- stock of one identity (a null expiry matches any)
create or replace function pg_temp.q(p_bin text, p_sku text, p_batch text, p_exp date default null) returns numeric language sql as $$
  select coalesce(sum(i.quantity), 0) from inventory i join bins b on b.id = i.bin_id join items it on it.id = i.item_id
  where b.bin_code = p_bin and it.sku = p_sku and i.batch_lot = p_batch and (p_exp is null or i.expiry_date = p_exp) $$;
create or replace function pg_temp.skus(p_bin text) returns int language sql as $$
  select count(distinct i.item_id)::int from inventory i join bins b on b.id = i.bin_id where b.bin_code = p_bin and i.quantity > 0 $$;
-- a payload line
create or replace function pg_temp.line(p_bin text, p_sku text, p_batch text, p_exp text, p_expected numeric, p_nb text, p_ne text, p_nq numeric) returns jsonb language sql as $$
  select jsonb_build_object('bin_code', p_bin, 'sku', p_sku, 'add', false, 'batch_lot', p_batch, 'expiry_date', p_exp, 'expected_qty', p_expected,
                            'new_batch', p_nb, 'new_expiry', p_ne, 'new_qty', p_nq) $$;
create or replace function pg_temp.add(p_bin text, p_sku text, p_nb text, p_ne text, p_nq numeric) returns jsonb language sql as $$
  select jsonb_build_object('bin_code', p_bin, 'sku', p_sku, 'add', true, 'new_batch', p_nb, 'new_expiry', p_ne, 'new_qty', p_nq) $$;
create or replace function pg_temp.run(p_lines jsonb) returns jsonb language sql as $$
  select apply_rack_check('ZK', p_lines, 'COUNT_VARIANCE', 'Budi') $$;
grant execute on function pg_temp.check(text, boolean), pg_temp.fails(text, text), pg_temp.as_user(uuid), pg_temp.q(text, text, text, date),
  pg_temp.skus(text), pg_temp.line(text, text, text, text, numeric, text, text, numeric), pg_temp.add(text, text, text, text, numeric),
  pg_temp.run(jsonb) to authenticated;

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('a1081111-1111-1111-1111-111111111111','adm108@pengguna.internal','{"name":"Admin"}','{"username":"t108adm"}'),
  ('a1082222-2222-2222-2222-222222222222','op108@pengguna.internal','{"name":"Op"}','{"username":"t108op"}');
update profiles set job = 'admin' where id = 'a1081111-1111-1111-1111-111111111111';
update profiles set job = 'operator' where id = 'a1082222-2222-2222-2222-222222222222';
select set_config('t.a', (select sku from items order by sku limit 1), false);
select set_config('t.b', (select sku from items order by sku offset 1 limit 1), false);

-- The rack: ZK01A01 A/B1 10 · ZK01A02 A/B2 5 · ZK02A01 B/B1 3 · ZK03A01 empty · ZK04A01 A/B1 6 + A/B2 4
set role authenticated;
select pg_temp.as_user('a1081111-1111-1111-1111-111111111111');
select import_snapshot(jsonb_build_array(
  jsonb_build_object('bin_code','ZK01A01','zone','ZK','rack','01','level','A','position','01','sku',current_setting('t.a'),'batch_lot','B1','quantity',10,'expiry_date','2031-01-01'),
  jsonb_build_object('bin_code','ZK01A02','zone','ZK','rack','01','level','A','position','02','sku',current_setting('t.a'),'batch_lot','B2','quantity',5,'expiry_date','2031-01-01'),
  jsonb_build_object('bin_code','ZK02A01','zone','ZK','rack','02','level','A','position','01','sku',current_setting('t.b'),'batch_lot','B1','quantity',3,'expiry_date','2031-01-01'),
  jsonb_build_object('bin_code','ZK03A01','zone','ZK','rack','03','level','A','position','01'),
  jsonb_build_object('bin_code','ZK04A01','zone','ZK','rack','04','level','A','position','01','sku',current_setting('t.a'),'batch_lot','B1','quantity',6,'expiry_date','2031-01-01'),
  jsonb_build_object('bin_code','ZK04A01','zone','ZK','rack','04','level','A','position','01','sku',current_setting('t.a'),'batch_lot','B2','quantity',4,'expiry_date','2031-01-01')),
  false, 'uji-108') \g /dev/null

-- Rack: ZK01A01 A/B1 10 · ZK01A02 A/B2 5 · ZK02A01 B/B1 3 · ZK03A01 empty · ZK04A01 A/B1 6 + A/B2 4  = 28 cartons
select pg_temp.as_user('a1081111-1111-1111-1111-111111111111');

select pg_temp.check('a save returns the id of its report',
  (pg_temp.run(jsonb_build_array(pg_temp.line('ZK01A01', current_setting('t.a'), 'B1', '2031-01-01', 10, 'B1', '2031-01-01', 7)))) ? 'report_id');
select pg_temp.check('one report per save, with the database''s own before and after (28 -> 25) and what was booked',
  (select count(*) = 1 and bool_and(aisle = 'ZK' and aisle_before = 28 and aisle_after = 25 and lines = 1 and added = 0 and movements = 1
                                    and by_name = 'Budi' and reason_code = 'COUNT_VARIANCE')
   from rack_check_reports where aisle = 'ZK'));

select pg_temp.check('stock found counts as added: the save reports it and the aisle total grows',
  (pg_temp.run(jsonb_build_array(pg_temp.add('ZK03A01', current_setting('t.a'), 'n1', '2031-04-01', 7))))->>'added' = '1');
select pg_temp.check('a second save is a second report (28 -> 25 -> 32), newest last',
  (select array_agg(aisle_before || '>' || aisle_after order by id) from rack_check_reports where aisle = 'ZK') = array['28>25', '25>32']);

select apply_rack_check('ZK', jsonb_build_array(pg_temp.line('ZK01A02', current_setting('t.a'), 'B2', '2031-01-01', 5, 'B2', '2031-01-01', 4)),
  'COUNT_VARIANCE', 'Budi', '{"summary":{"before":32,"after":31},"changes":[{"bin":"ZK01A02"}]}'::jsonb) \g /dev/null
select pg_temp.check('the report sent by the page is stored as given, beside the database''s own totals',
  (select report->'summary'->>'after' = '31' and aisle_before = 32 and aisle_after = 31 from rack_check_reports where aisle = 'ZK' order by id desc limit 1));

select apply_rack_check('ZK', jsonb_build_array(pg_temp.line('ZK01A02', current_setting('t.a'), 'B2', '2031-01-01', 4, 'B2', '2031-01-01', 3)),
  'COUNT_VARIANCE', 'Budi', '[1,2]'::jsonb) \g /dev/null
select pg_temp.check('something that is not an object is not stored as the report',
  (select report = '{}'::jsonb and aisle_after = 30 from rack_check_reports where aisle = 'ZK' order by id desc limit 1));

select pg_temp.check('a refused save leaves no report',
  (select count(*) from rack_check_reports where aisle = 'ZK') = 4
  and pg_temp.fails(format($q$select pg_temp.run(jsonb_build_array(pg_temp.line('ZK01A01', %L, 'B1', '2031-01-01', 99, 'B1', '2031-01-01', 1)))$q$, current_setting('t.a')), '%sekarang%')
  and (select count(*) from rack_check_reports where aisle = 'ZK') = 4);

select save_plan('2026-12-08', format('{
  "waves":[{"wave_no":"1","shipment_numbers":["SK"]}],
  "tasks":[{"wave_no":"1","shipment_number":"SK","task_type":"PICK","sku":"%s","from_bin":"ZK04A01","batch_lot":"B1","expiry_date":"2031-01-01","quantity":5,"pick_type":"CASE","seq":1}],
  "outbound":[{"wave_no":"1","shipment_number":"SK","sku":"%s","quantity_requested":5,"quantity_allocated":5}]}',
  current_setting('t.a'), current_setting('t.a'))::jsonb) \g /dev/null
select pg_temp.run(jsonb_build_array(pg_temp.line('ZK04A01', current_setting('t.a'), 'B1', '2031-01-01', 6, 'B1', '2031-01-01', 2))) \g /dev/null
select pg_temp.check('a line left short of an open wave: its warning is kept in the report',
  (select jsonb_array_length(warnings) = 1 and warnings->0->>'reserved' = '5' from rack_check_reports where aisle = 'ZK' order by id desc limit 1));

-- ---- Nothing can change a report --------------------------------------------------------------------
select pg_temp.check('a signed-in account cannot update a report', pg_temp.fails($q$update rack_check_reports set aisle = 'ZZ'$q$, '%permission denied%'));
select pg_temp.check('a signed-in account cannot delete a report', pg_temp.fails($q$delete from rack_check_reports$q$, '%permission denied%'));
select pg_temp.check('a signed-in account cannot truncate a report', pg_temp.fails($q$truncate rack_check_reports$q$, '%permission denied%'));
select pg_temp.check('a signed-in account cannot insert a report (only apply_rack_check does)',
  pg_temp.fails($q$insert into rack_check_reports (aisle, by_name, reason_code, lines, added, movements, aisle_before, aisle_after) values ('ZK', 'x', 'x', 0, 0, 0, 0, 0)$q$, '%permission denied%'));
-- Second layer: even the table's owner cannot.
reset role;
select pg_temp.check('the trigger refuses an update, even for the owner', pg_temp.fails($q$update rack_check_reports set aisle = 'ZZ'$q$, '%tidak bisa diubah atau dihapus%'));
select pg_temp.check('the trigger refuses a delete, even for the owner', pg_temp.fails($q$delete from rack_check_reports$q$, '%tidak bisa diubah atau dihapus%'));
select pg_temp.check('the trigger refuses a truncate, even for the owner', pg_temp.fails($q$truncate rack_check_reports$q$, '%tidak bisa diubah atau dihapus%'));
set role authenticated;
select pg_temp.as_user('a1081111-1111-1111-1111-111111111111');

-- ---- Who can read -----------------------------------------------------------------------------------
select pg_temp.check('an active account reads the reports', (select count(*) from rack_check_reports where aisle = 'ZK') = 5);
reset role;
update profiles set active = false where id = 'a1082222-2222-2222-2222-222222222222';
set role authenticated;
select pg_temp.as_user('a1082222-2222-2222-2222-222222222222');
select pg_temp.check('a deactivated account reads none', (select count(*) from rack_check_reports) = 0);

rollback;
