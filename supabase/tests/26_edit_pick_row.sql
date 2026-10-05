-- Ubah baris: an open row's source and Bin To Bin in one correction (0052). Runs in a transaction and rolls back.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users values ('11111111-1111-1111-1111-111111111111','op@x','{"name":"Operator"}') on conflict do nothing;
update profiles set role = 'admin' where id = '11111111-1111-1111-1111-111111111111';
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.fails(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then
  if sqlerrm not like p_like then raise notice 'got: %', sqlerrm; end if;
  return sqlerrm like p_like; end $$;

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
-- NO 8: #1 6 from the CF01C01 pallet + #2 its rest 42 to CF38A01; #3 a full pallet CF02C01; #4 6 from CE17A02.
select save_plan('2026-10-26', '{
  "waves":[{"wave_no":"8","shipment_numbers":["109694907"],"truck":"LCL","destination":"PT RODA TIMOR PERKASA"}],
  "tasks":[
    {"wave_no":"8","shipment_number":"109694907","task_type":"PICK","sku":"550044709","from_bin":"CF01C01","batch_lot":"09I26JJ","expiry_date":"2030-09-09","quantity":6,"pick_type":"CASE","breaks_pallet":true,"seq":1},
    {"wave_no":"8","task_type":"REPLENISH","sku":"550044709","from_bin":"CF01C01","to_bin":"CF38A01","batch_lot":"09I26JJ","expiry_date":"2030-09-09","quantity":42,"pick_type":"CASE","breaks_pallet":true,"seq":2},
    {"wave_no":"8","shipment_number":"109694907","task_type":"PICK","sku":"550044709","from_bin":"CF02C01","batch_lot":"09I26JJ","expiry_date":"2030-09-09","quantity":48,"pick_type":"PALLET","seq":3},
    {"wave_no":"8","shipment_number":"109694907","task_type":"PICK","sku":"550044709","from_bin":"CE17A02","batch_lot":"02I26JJ","expiry_date":"2030-09-02","quantity":6,"pick_type":"CASE","seq":4}],
  "outbound":[{"wave_no":"8","shipment_number":"109694907","sku":"550044709","quantity_requested":60,"quantity_allocated":60}]}'::jsonb) \g /dev/null
create or replace function pg_temp.wave() returns uuid language sql as $$
  select id from waves where planned_date = '2026-10-26' and wave_no = '8' $$;
create or replace function pg_temp.task(p_seq int) returns pick_tasks language sql as $$
  select * from pick_tasks where wave_id = pg_temp.wave() and seq = p_seq $$;
create or replace function pg_temp.bin(p_id uuid) returns text language sql as $$ select bin_code from bins where id = p_id $$;
create temp table ids as select seq, id from pick_tasks where wave_id = pg_temp.wave();
grant select on ids to authenticated;
create or replace function pg_temp.id(p_seq int) returns uuid language sql as $$ select id from ids where seq = p_seq $$;

select pg_temp.check('no reason refused',
  pg_temp.fails(format($q$select edit_pick_row(%L, %L, 'CF01C01', '09I26JJ', '2030-09-09', 'CF38A02', 42, 'Ilham', ' ')$q$, pg_temp.id(1), pg_temp.id(2)), '%Alasan wajib%'));
select pg_temp.check('a move that is not this pick''s neighbour refused',
  pg_temp.fails(format($q$select edit_pick_row(%L, %L, 'CF01C01', '09I26JJ', '2030-09-09', 'CF38A02', 42, 'Ilham', 'x')$q$, pg_temp.id(3), pg_temp.id(2)), '%sudah berubah%'));
select pg_temp.check('nothing changed refused',
  pg_temp.fails(format($q$select edit_pick_row(%L, %L, 'CF01C01', '09I26JJ', '2030-09-09', 'CF38A01', 42, 'Ilham', 'x')$q$, pg_temp.id(1), pg_temp.id(2)), '%Tidak ada yang diubah%'));
select pg_temp.check('a source bin that does not hold the batch + expiry refused, pointing to Adjust stok',
  pg_temp.fails(format($q$select edit_pick_row(%L, %L, 'CF04D01', '09I26JJ', '2030-09-09', 'CF38A01', 42, 'Ilham', 'x')$q$, pg_temp.id(1), pg_temp.id(2)), '%CF04D01 tidak menyimpan batch 09I26JJ%Adjust stok%'));
select pg_temp.check('destination equal to the new source refused',
  pg_temp.fails(format($q$select edit_pick_row(%L, %L, 'CF04D01', '14I26JJ', '2030-09-14', 'CF04D01', 42, 'Ilham', 'x')$q$, pg_temp.id(1), pg_temp.id(2)), '%sama: CF04D01%'));
select pg_temp.check('a move without a sisa refused',
  pg_temp.fails(format($q$select edit_pick_row(%L, null, 'CF02C01', '09I26JJ', '2030-09-09', 'CF38B01', 0, 'Ilham', 'x')$q$, pg_temp.id(3)), '%harus lebih dari 0%'));
reset role;
update bins set status = 'blocked' where bin_code = 'CF38A02';
set role authenticated;
select pg_temp.check('a blocked destination refused',
  pg_temp.fails(format($q$select edit_pick_row(%L, %L, 'CF01C01', '09I26JJ', '2030-09-09', 'CF38A02', 42, 'Ilham', 'x')$q$, pg_temp.id(1), pg_temp.id(2)), '%CF38A02 diblokir%'));
reset role;
update bins set status = 'active' where bin_code = 'CF38A02';
update profiles set role = 'operator' where id = '11111111-1111-1111-1111-111111111111';
set role authenticated;
select pg_temp.check('an operator cannot change a row',
  pg_temp.fails(format($q$select edit_pick_row(%L, %L, 'CF01C01', '09I26JJ', '2030-09-09', 'CF38A02', 42, 'Ilham', 'x')$q$, pg_temp.id(1), pg_temp.id(2)), '%Hanya supervisor%'));
reset role;
update profiles set role = 'admin' where id = '11111111-1111-1111-1111-111111111111';
set role authenticated;

-- The paper: #1 from CF04D01 batch 14I26JJ (later expiry), its rest 42 to CF38A02.
select edit_pick_row(pg_temp.id(1), pg_temp.id(2), 'cf04d01', '14I26JJ', '2030-09-14', 'cf38a02', 42, 'Ilham', 'ikut picklist cetak') \g /dev/null
select pg_temp.check('the pick takes the paper''s bin, batch and expiry, quantity untouched',
  pg_temp.bin((pg_temp.task(1)).from_bin_id) = 'CF04D01' and (pg_temp.task(1)).batch_lot = '14I26JJ'
  and (pg_temp.task(1)).expiry_date = '2030-09-14' and (pg_temp.task(1)).quantity = 6);
select pg_temp.check('its move follows the source and goes to the paper''s destination, still right after it',
  (pg_temp.task(2)).id = pg_temp.id(2) and pg_temp.bin((pg_temp.task(2)).from_bin_id) = 'CF04D01'
  and pg_temp.bin((pg_temp.task(2)).to_bin_id) = 'CF38A02' and (pg_temp.task(2)).batch_lot = '14I26JJ' and (pg_temp.task(2)).quantity = 42);
select pg_temp.check('one log line: source, FEFO skipped, Bin To Bin, name and reason',
  exists (select 1 from execution_events where entity_id = pg_temp.id(1) and reason =
    'baris diubah oleh Ilham: sumber CF01C01 09I26JJ exp 2030-09-09 → CF04D01 14I26JJ exp 2030-09-14; FEFO dilewati; Bin To Bin CF38A01 (42) → CF38A02 (42): ikut picklist cetak'));

-- Remove that move: CANCELLED, so Pulihkan can bring it back.
select edit_pick_row(pg_temp.id(1), pg_temp.id(2), 'CF04D01', '14I26JJ', '2030-09-14', null, null, 'Ilham', 'sisa tetap di bin') \g /dev/null
select pg_temp.check('a removed move is cancelled, not deleted, and logged on both rows',
  (pg_temp.task(2)).status = 'CANCELLED' and (pg_temp.task(1)).status = 'PLANNED'
  and exists (select 1 from execution_events where entity_id = pg_temp.id(2) and to_status = 'CANCELLED' and reason like 'Bin To Bin dihapus lewat Ubah baris #1%')
  and exists (select 1 from execution_events where entity_id = pg_temp.id(1) and reason like '%Bin To Bin ke CF38A02 (42) dihapus: sisa tetap di bin'));

-- Add a move to #3, a row the plan gave none.
select edit_pick_row(pg_temp.id(3), null, 'CF02C01', '09I26JJ', '2030-09-09', 'CF38B01', 10, 'Ilham', 'ikut picklist cetak') \g /dev/null
select pg_temp.check('an added move lands right after its pick, the rows below move down one',
  (pg_temp.task(3)).id = pg_temp.id(3) and (pg_temp.task(4)).task_type = 'REPLENISH'
  and pg_temp.bin((pg_temp.task(4)).from_bin_id) = 'CF02C01' and pg_temp.bin((pg_temp.task(4)).to_bin_id) = 'CF38B01'
  and (pg_temp.task(4)).quantity = 10 and (pg_temp.task(5)).id = pg_temp.id(4));
select pg_temp.check('a second open move from the same bin + batch refused',
  pg_temp.fails(format($q$select edit_pick_row(%L, null, 'CF02C01', '09I26JJ', '2030-09-09', 'CF38B02', 5, 'Ilham', 'x')$q$, pg_temp.id(4)), '%Sudah ada Bin To Bin terbuka dari CF02C01%'));
reset role;
update pick_tasks set status = 'COMPLETED' where id = pg_temp.id(4);
set role authenticated;
select pg_temp.check('a posted row refused',
  pg_temp.fails(format($q$select edit_pick_row(%L, null, 'CF01C01', '09I26JJ', '2030-09-09', null, null, 'Ilham', 'x')$q$, pg_temp.id(4)), '%belum diposting%'));
rollback;
