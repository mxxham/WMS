-- Tambah item rows changed to follow the printed picklist (0051). Runs in a transaction and rolls back.
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
-- NO 8, shipment 109694907, one row already on the wave.
select save_plan('2026-10-26', '{
  "waves":[{"wave_no":"8","shipment_numbers":["109694907"],"truck":"LCL","destination":"PT RODA TIMOR PERKASA"}],
  "tasks":[{"wave_no":"8","shipment_number":"109694907","task_type":"PICK","sku":"550044709","from_bin":"CF02C01","batch_lot":"09I26JJ","expiry_date":"2030-09-09","quantity":48,"seq":1}],
  "outbound":[{"wave_no":"8","shipment_number":"109694907","sku":"550044709","quantity_requested":48,"quantity_allocated":48}]}'::jsonb) \g /dev/null
create or replace function pg_temp.wave() returns uuid language sql as $$
  select id from waves where planned_date = '2026-10-26' and wave_no = '8' $$;
create or replace function pg_temp.task(p_seq int) returns pick_tasks language sql as $$
  select * from pick_tasks where wave_id = pg_temp.wave() and seq = p_seq $$;
create or replace function pg_temp.bin(p_id uuid) returns text language sql as $$ select bin_code from bins where id = p_id $$;

-- The engine planned 6 from CF01C01 09I26JJ + rest 42 to CF38A01; the paper says
-- 6 from CF04D01 14I26JJ (later expiry) with the rest 42 to CF38A02, and a move the
-- engine never planned on a second line: CE17A02 -> CF38B01, 51.
create temp table plan as select '{
  "tasks":[
    {"task_type":"PICK","sku":"550044709","from_bin":"CF04D01","batch_lot":"14I26JJ","expiry_date":"2030-09-14","quantity":6,"pick_type":"CASE","breaks_pallet":true,"seq":1,
     "planned":{"from_bin":"CF01C01","to_bin":null,"batch_lot":"09I26JJ","expiry_date":"2030-09-09","quantity":6}},
    {"task_type":"REPLENISH","sku":"550044709","from_bin":"CF04D01","to_bin":"CF38A02","batch_lot":"14I26JJ","expiry_date":"2030-09-14","quantity":42,"pick_type":"CASE","breaks_pallet":true,"seq":2,
     "planned":{"from_bin":"CF01C01","to_bin":"CF38A01","batch_lot":"09I26JJ","expiry_date":"2030-09-09","quantity":42}},
    {"task_type":"PICK","sku":"550044709","from_bin":"CE17A02","batch_lot":"02I26JJ","expiry_date":"2030-09-02","quantity":6,"pick_type":"CASE","seq":3},
    {"task_type":"REPLENISH","sku":"550044709","from_bin":"CE17A02","to_bin":"CF38B01","batch_lot":"02I26JJ","expiry_date":"2030-09-02","quantity":51,"pick_type":"CASE","breaks_pallet":true,"seq":4,
     "planned":{"from_bin":null,"to_bin":null,"batch_lot":null,"expiry_date":null,"quantity":null}}],
  "outbound":[{"sku":"550044709","description":"Adv4TAX5","order_nos":[],"quantity_requested":12,"quantity_allocated":12}]}'::jsonb as p;
grant select on plan to authenticated;

select pg_temp.check('changed rows without a reason refused',
  pg_temp.fails(format($q$select add_wave_items(%L, '109694907', (select p from plan), 'Ilham', '  ')$q$, pg_temp.wave()), '%Alasan wajib%'));
select pg_temp.check('changed rows without a name refused',
  pg_temp.fails(format($q$select add_wave_items(%L, '109694907', (select p from plan), null, 'ikut picklist cetak')$q$, pg_temp.wave()), '%Nama Anda wajib%'));
select pg_temp.check('a changed pick into a bin that does not hold its batch + expiry refused, naming it',
  pg_temp.fails(format($q$select add_wave_items(%L, '109694907', jsonb_set((select p from plan), '{tasks,0,batch_lot}', '"99X99XX"'), 'Ilham', 'x')$q$, pg_temp.wave()),
    '%CF04D01 tidak menyimpan SKU 550044709 batch 99X99XX%Adjust stok%'));
reset role;
update bins set status = 'blocked' where bin_code = 'CF38A02';
set role authenticated;
select pg_temp.check('a blocked Bin To Bin destination refused',
  pg_temp.fails(format($q$select add_wave_items(%L, '109694907', (select p from plan), 'Ilham', 'x')$q$, pg_temp.wave()), '%CF38A02 diblokir%'));
reset role;
update bins set status = 'active' where bin_code = 'CF38A02';
set role authenticated;

select pg_temp.check('saved: 4 tasks, 3 of them changed',
  add_wave_items(pg_temp.wave(), '109694907', (select p from plan), 'Ilham', 'ikut picklist cetak PL-109694907') @> '{"tasks":4,"changed":3}');
select pg_temp.check('the pick is saved from the paper''s bin with its batch and expiry, after the old row',
  pg_temp.bin((pg_temp.task(2)).from_bin_id) = 'CF04D01' and (pg_temp.task(2)).batch_lot = '14I26JJ'
  and (pg_temp.task(2)).expiry_date = '2030-09-14' and (pg_temp.task(2)).quantity = 6);
select pg_temp.check('its move follows: from CF04D01 to the paper''s CF38A02, 42',
  (pg_temp.task(3)).task_type = 'REPLENISH' and pg_temp.bin((pg_temp.task(3)).from_bin_id) = 'CF04D01'
  and pg_temp.bin((pg_temp.task(3)).to_bin_id) = 'CF38A02' and (pg_temp.task(3)).quantity = 42);
select pg_temp.check('the added move is saved next to its pick',
  pg_temp.bin((pg_temp.task(5)).from_bin_id) = 'CE17A02' and pg_temp.bin((pg_temp.task(5)).to_bin_id) = 'CF38B01' and (pg_temp.task(5)).quantity = 51);
select pg_temp.check('the changed pick is logged: planned bin and batch -> saved, with name and reason',
  exists (select 1 from execution_events where entity_id = (pg_temp.task(2)).id
    and reason like 'bin pick diubah oleh Ilham (Tambah item): CF01C01 → CF04D01 batch 09I26JJ exp 2030-09-09 → 14I26JJ exp 2030-09-14: ikut picklist cetak%'));
select pg_temp.check('the changed move is logged against the planned CF38A01',
  exists (select 1 from execution_events where entity_id = (pg_temp.task(3)).id and reason like '%CF04D01 → CF38A02 42, rencana CF01C01 → CF38A01 42%'));
select pg_temp.check('the added move is logged as added',
  exists (select 1 from execution_events where entity_id = (pg_temp.task(5)).id and reason like 'Bin To Bin ditambah oleh Ilham%CE17A02 → CF38B01 51%'));
select pg_temp.check('the unchanged pick is not logged',
  not exists (select 1 from execution_events where entity_id = (pg_temp.task(4)).id));
select pg_temp.check('the wave log says how many rows followed the paper',
  exists (select 1 from execution_events where entity_id = pg_temp.wave() and reason like '%(3 baris mengikuti picklist cetak, oleh Ilham)%'));
select pg_temp.check('a second changed move from the same bin and batch refused while the first is open',
  pg_temp.fails(format($q$select add_wave_items(%L, '109694907', (select p from plan), 'Ilham', 'x')$q$, pg_temp.wave()), '%Sudah ada Bin To Bin terbuka dari CF04D01%'));
select pg_temp.check('an unchanged plan needs no name or reason (0048 behaviour)',
  add_wave_items(pg_temp.wave(), '109694907', '{"tasks":[{"task_type":"PICK","sku":"550044709","from_bin":"CF03C01","batch_lot":"09I26JJ","expiry_date":"2030-09-09","quantity":48,"pick_type":"PALLET","seq":1}],
    "outbound":[{"sku":"550044709","quantity_requested":48,"quantity_allocated":48}]}'::jsonb) @> '{"tasks":1,"changed":0}');
rollback;
