-- Cek stok rak (0144): apply_rack_check books a checked rack in one transaction. Bins ZK01-ZK05 are
-- made by the test. Runs in a transaction and rolls back. Every line prints PASS/FAIL.
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
  ('a1071111-1111-1111-1111-111111111111','adm107@pengguna.internal','{"name":"Admin"}','{"username":"t107adm"}'),
  ('a1072222-2222-2222-2222-222222222222','op107@pengguna.internal','{"name":"Op"}','{"username":"t107op"}');
update profiles set job = 'admin' where id = 'a1071111-1111-1111-1111-111111111111';
update profiles set job = 'operator' where id = 'a1072222-2222-2222-2222-222222222222';
select set_config('t.a', (select sku from items order by sku limit 1), false);
select set_config('t.b', (select sku from items order by sku offset 1 limit 1), false);

-- The rack: ZK01A01 A/B1 10 · ZK01A02 A/B2 5 · ZK02A01 B/B1 3 · ZK03A01 empty · ZK04A01 A/B1 6 + A/B2 4
set role authenticated;
select pg_temp.as_user('a1071111-1111-1111-1111-111111111111');
select import_snapshot(jsonb_build_array(
  jsonb_build_object('bin_code','ZK01A01','zone','ZK','rack','01','level','A','position','01','sku',current_setting('t.a'),'batch_lot','B1','quantity',10,'expiry_date','2031-01-01'),
  jsonb_build_object('bin_code','ZK01A02','zone','ZK','rack','01','level','A','position','02','sku',current_setting('t.a'),'batch_lot','B2','quantity',5,'expiry_date','2031-01-01'),
  jsonb_build_object('bin_code','ZK02A01','zone','ZK','rack','02','level','A','position','01','sku',current_setting('t.b'),'batch_lot','B1','quantity',3,'expiry_date','2031-01-01'),
  jsonb_build_object('bin_code','ZK03A01','zone','ZK','rack','03','level','A','position','01'),
  jsonb_build_object('bin_code','ZK04A01','zone','ZK','rack','04','level','A','position','01','sku',current_setting('t.a'),'batch_lot','B1','quantity',6,'expiry_date','2031-01-01'),
  jsonb_build_object('bin_code','ZK04A01','zone','ZK','rack','04','level','A','position','01','sku',current_setting('t.a'),'batch_lot','B2','quantity',4,'expiry_date','2031-01-01')),
  false, 'uji-107') \g /dev/null

-- ---- Who and what ----------------------------------------------------------------
select pg_temp.as_user('a1072222-2222-2222-2222-222222222222');
select pg_temp.check('an operator cannot save a rack check',
  pg_temp.fails(format($q$select pg_temp.run(jsonb_build_array(pg_temp.line('ZK01A01', %L, 'B1', '2031-01-01', 10, 'B1', '2031-01-01', 8)))$q$, current_setting('t.a')), '%Hanya supervisor atau admin%'));

select pg_temp.as_user('a1071111-1111-1111-1111-111111111111');
select pg_temp.check('nothing to save is refused', pg_temp.fails($q$select pg_temp.run('[]'::jsonb)$q$, '%Tidak ada perubahan%'));
select pg_temp.check('a bin of another aisle is refused',
  pg_temp.fails(format($q$select pg_temp.run(jsonb_build_array(pg_temp.add('CB01A01', %L, 'X', '2031-01-01', 1)))$q$, current_setting('t.a')), '%bukan di rak ZK%'));
select pg_temp.check('an unknown bin is refused',
  pg_temp.fails(format($q$select pg_temp.run(jsonb_build_array(pg_temp.add('ZK99A01', %L, 'X', '2031-01-01', 1)))$q$, current_setting('t.a')), '%tidak ada%'));
select pg_temp.check('a negative quantity is refused',
  pg_temp.fails(format($q$select pg_temp.run(jsonb_build_array(pg_temp.line('ZK01A01', %L, 'B1', '2031-01-01', 10, 'B1', '2031-01-01', -1)))$q$, current_setting('t.a')), '%negatif%'));
select pg_temp.check('a line the system no longer has is refused',
  pg_temp.fails(format($q$select pg_temp.run(jsonb_build_array(pg_temp.line('ZK01A01', %L, 'ZZ', '2031-01-01', 10, 'ZZ', '2031-01-01', 8)))$q$, current_setting('t.a')), '%sudah berubah atau tidak ada lagi%'));
select pg_temp.check('the quantity the page showed must still be the system''s',
  pg_temp.fails(format($q$select pg_temp.run(jsonb_build_array(pg_temp.line('ZK01A01', %L, 'B1', '2031-01-01', 9, 'B1', '2031-01-01', 8)))$q$, current_setting('t.a')), '%sekarang 10 (saat halaman dimuat 9)%'));

-- ---- Quantity ----------------------------------------------------------------------
select pg_temp.check('quantity: one adjustment of the difference, no limit asked',
  (pg_temp.run(jsonb_build_array(pg_temp.line('ZK01A01', current_setting('t.a'), 'B1', '2031-01-01', 10, 'B1', '2031-01-01', 4))))->>'movements' = '1'
  and pg_temp.q('ZK01A01', current_setting('t.a'), 'B1') = 4);
select pg_temp.check('the movement names the rack, the reason, the person; nobody approved',
  exists (select 1 from movements m join bins b on b.id = m.to_bin_id where b.bin_code = 'ZK01A01' and m.type = 'adjustment' and m.quantity = -6
          and m.note like 'Cek stok rak ZK ZK01A01: jumlah 10 → 4' and m.reason_code = 'COUNT_VARIANCE' and m.by_name = 'Budi' and m.approved_by_name is null));
select pg_temp.check('an unchanged line books nothing',
  (pg_temp.run(jsonb_build_array(pg_temp.line('ZK01A01', current_setting('t.a'), 'B1', '2031-01-01', 4, 'b1', '2031-01-01', 4))))->>'movements' = '0');

-- ---- Batch and expiry -------------------------------------------------------------------
select pg_temp.check('batch and expiry: the stock moves to its new identity, the batch tidied to capitals',
  (pg_temp.run(jsonb_build_array(pg_temp.line('ZK01A02', current_setting('t.a'), 'B2', '2031-01-01', 5, ' b3 ', '2031-02-01', 5))))->>'movements' = '2'
  and pg_temp.q('ZK01A02', current_setting('t.a'), 'B2') = 0 and pg_temp.q('ZK01A02', current_setting('t.a'), 'B3', '2031-02-01') = 5);
select pg_temp.check('batch, expiry and quantity in one line',
  (pg_temp.run(jsonb_build_array(pg_temp.line('ZK02A01', current_setting('t.b'), 'B1', '2031-01-01', 3, 'B8', '2031-03-01', 4))))->>'movements' = '2'
  and pg_temp.q('ZK02A01', current_setting('t.b'), 'B1') = 0 and pg_temp.q('ZK02A01', current_setting('t.b'), 'B8', '2031-03-01') = 4);
select pg_temp.check('a batch typed as an identity the bin already has merges into it',
  (pg_temp.run(jsonb_build_array(pg_temp.line('ZK04A01', current_setting('t.a'), 'B2', '2031-01-01', 4, 'B1', '2031-01-01', 4))))->>'movements' = '2'
  and pg_temp.q('ZK04A01', current_setting('t.a'), 'B1', '2031-01-01') = 10 and pg_temp.q('ZK04A01', current_setting('t.a'), 'B2') = 0);
select pg_temp.check('the stock total is the same after relabelling (two adjustments, -q and +q)',
  (select sum(m.quantity) from movements m join bins b on b.id = m.to_bin_id where b.bin_code = 'ZK01A02' and m.note like 'Cek stok rak%') = 0);

-- ---- Add -------------------------------------------------------------------------------------
select pg_temp.check('add: stock found in an empty bin',
  (pg_temp.run(jsonb_build_array(pg_temp.add('ZK03A01', current_setting('t.a'), 'n1', '2031-04-01', 7))))->>'added' = '1'
  and pg_temp.q('ZK03A01', current_setting('t.a'), 'N1', '2031-04-01') = 7);
select pg_temp.check('add: an expiry is required',
  pg_temp.fails(format($q$select pg_temp.run(jsonb_build_array(pg_temp.add('ZK03A01', %L, 'N2', null, 2)))$q$, current_setting('t.a')), '%expired wajib%'));

-- ---- One bin, one SKU ---------------------------------------------------------------------------
select pg_temp.check('a second SKU in a bin that holds one is refused, and nothing else of the save is booked (all or none)',
  pg_temp.fails(format($q$select pg_temp.run(jsonb_build_array(
      pg_temp.line('ZK01A01', %L, 'B1', '2031-01-01', 4, 'B1', '2031-01-01', 3), pg_temp.add('ZK02A01', %L, 'Y1', '2031-05-01', 2)))$q$,
      current_setting('t.a'), current_setting('t.a')), '%lebih dari satu SKU%')
  and pg_temp.q('ZK01A01', current_setting('t.a'), 'B1') = 4);
select pg_temp.check('the old SKU emptied in the same save frees the bin for the new one',
  (pg_temp.run(jsonb_build_array(
     pg_temp.line('ZK02A01', current_setting('t.b'), 'B8', '2031-03-01', 4, 'B8', '2031-03-01', 0),
     pg_temp.add('ZK02A01', current_setting('t.a'), 'Y1', '2031-05-01', 2))))->>'movements' = '2'
  and pg_temp.skus('ZK02A01') = 1 and pg_temp.q('ZK02A01', current_setting('t.a'), 'Y1') = 2);
select pg_temp.check('emptying a line: quantity 0 leaves nothing on the shelf',
  pg_temp.q('ZK02A01', current_setting('t.b'), 'B8') = 0);

-- ---- Open waves -----------------------------------------------------------------------------------
select save_plan('2026-12-07', format('{
  "waves":[{"wave_no":"1","shipment_numbers":["SK"]}],
  "tasks":[{"wave_no":"1","shipment_number":"SK","task_type":"PICK","sku":"%s","from_bin":"ZK01A01","batch_lot":"B1","expiry_date":"2031-01-01","quantity":3,"pick_type":"CASE","seq":1}],
  "outbound":[{"wave_no":"1","shipment_number":"SK","sku":"%s","quantity_requested":3,"quantity_allocated":3}]}',
  current_setting('t.a'), current_setting('t.a'))::jsonb) \g /dev/null
select pg_temp.check('batch and expiry cannot change under an open wave task',
  pg_temp.fails(format($q$select pg_temp.run(jsonb_build_array(pg_temp.line('ZK01A01', %L, 'B1', '2031-01-01', 4, 'B9', '2031-01-01', 4)))$q$, current_setting('t.a')), '%dipakai tugas wave%'));
select pg_temp.check('quantity still can: left above what the wave promised, no warning',
  jsonb_array_length((pg_temp.run(jsonb_build_array(pg_temp.line('ZK01A01', current_setting('t.a'), 'B1', '2031-01-01', 4, 'B1', '2031-01-01', 3))))->'warnings') = 0);
select pg_temp.check('quantity below what the wave promised is booked, with a warning naming the wave',
  (select w->>'waves' || '/' || (w->>'reserved') from jsonb_array_elements(
     (pg_temp.run(jsonb_build_array(pg_temp.line('ZK01A01', current_setting('t.a'), 'B1', '2031-01-01', 3, 'B1', '2031-01-01', 1))))->'warnings') w) = '1/3'
  and pg_temp.q('ZK01A01', current_setting('t.a'), 'B1') = 1);

rollback;
