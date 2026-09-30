-- Tambah item: more cartons or a new SKU on a wave that already exists (0048). Runs in a transaction and rolls back.
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
-- NO 8, shipment 109694907: 16 x 550044709 from CF38E01 (seq 1), 48 from CF38E02 (seq 2).
select save_plan('2026-10-26', '{
  "waves":[{"wave_no":"8","shipment_numbers":["109694907"],"truck":"LCL","destination":"PT RODA TIMOR PERKASA"}],
  "tasks":[
    {"wave_no":"8","shipment_number":"109694907","task_type":"PICK","sku":"550044709","from_bin":"CF38E01","batch_lot":"19I26JJ","expiry_date":"2030-09-19","quantity":16,"seq":1},
    {"wave_no":"8","shipment_number":"109694907","task_type":"PICK","sku":"550044709","from_bin":"CF38E02","batch_lot":"19I26JJ","expiry_date":"2030-09-19","quantity":48,"seq":2}],
  "outbound":[{"wave_no":"8","shipment_number":"109694907","sku":"550044709","quantity_requested":64,"quantity_allocated":64}]}'::jsonb) \g /dev/null
create or replace function pg_temp.wave() returns uuid language sql as $$
  select id from waves where planned_date = '2026-10-26' and wave_no = '8' $$;
create or replace function pg_temp.out(p_sku text) returns outbound language sql as $$
  select * from outbound where wave_id = pg_temp.wave() and sku = p_sku $$;
create or replace function pg_temp.task(p_seq int) returns pick_tasks language sql as $$
  select * from pick_tasks where wave_id = pg_temp.wave() and seq = p_seq $$;

-- +16 of the SKU already on the order, and a new SKU (6 cartons, its pallet rest to CF38A01).
create temp table plan as select '{
  "tasks":[
    {"task_type":"PICK","sku":"550044709","from_bin":"CF38A02","batch_lot":"12I26JJ","expiry_date":"2030-09-12","quantity":16,"pick_type":"CASE","seq":1},
    {"task_type":"PICK","sku":"550044845","from_bin":"CF37E01","batch_lot":"15I26JJ","expiry_date":"2030-09-15","quantity":6,"pick_type":"CASE","breaks_pallet":true,"seq":2},
    {"task_type":"REPLENISH","sku":"550044845","from_bin":"CF37E01","to_bin":"CF38A01","batch_lot":"15I26JJ","expiry_date":"2030-09-15","quantity":38,"pick_type":"CASE","breaks_pallet":true,"seq":3}],
  "outbound":[
    {"sku":"550044709","description":"Adv4TAX5","order_nos":["538266492"],"quantity_requested":16,"quantity_allocated":16},
    {"sku":"550044845","description":"Spirax","order_nos":[],"quantity_requested":6,"quantity_allocated":6}]}'::jsonb as p;
grant select on plan to authenticated;

select pg_temp.check('a shipment that is not on the wave refused',
  pg_temp.fails(format($q$select add_wave_items(%L, '999', (select p from plan))$q$, pg_temp.wave()), '%tidak ada di wave%'));
select pg_temp.check('a plan without SKU lines refused',
  pg_temp.fails(format($q$select add_wave_items(%L, '109694907', '{"tasks":[],"outbound":[]}')$q$, pg_temp.wave()), '%tanpa baris SKU%'));
reset role;
update profiles set role = 'operator' where id = '11111111-1111-1111-1111-111111111111';
set role authenticated;
select pg_temp.check('an operator cannot add items',
  pg_temp.fails(format($q$select add_wave_items(%L, '109694907', (select p from plan))$q$, pg_temp.wave()), '%Hanya supervisor%'));
reset role;
update profiles set role = 'admin' where id = '11111111-1111-1111-1111-111111111111';
set role authenticated;

select pg_temp.check('saved: 3 tasks, 1 order line raised, 1 added',
  add_wave_items(pg_temp.wave(), '109694907', (select p from plan)) @> '{"tasks":3,"raised":1,"added":1}');
select pg_temp.check('the old rows keep their numbers',
  (pg_temp.task(1)).quantity = 16 and (pg_temp.task(2)).quantity = 48);
select pg_temp.check('new rows come after them, pick and its move side by side, for this shipment',
  (pg_temp.task(3)).quantity = 16 and (pg_temp.task(3)).shipment_number = '109694907'
  and (pg_temp.task(4)).quantity = 6 and (pg_temp.task(4)).breaks_pallet
  and (pg_temp.task(5)).task_type = 'REPLENISH' and (pg_temp.task(5)).shipment_number is null);
select pg_temp.check('the SKU already on the order: 64 -> 80, order no added',
  (pg_temp.out('550044709')).quantity_requested = 80 and (pg_temp.out('550044709')).quantity_allocated = 80
  and (pg_temp.out('550044709')).order_nos @> '{538266492}');
select pg_temp.check('the new SKU is a new order line with the wave''s truck and customer',
  (pg_temp.out('550044845')).quantity_requested = 6 and (pg_temp.out('550044845')).destination = 'PT RODA TIMOR PERKASA'
  and (pg_temp.out('550044845')).truck = 'LCL');
select pg_temp.check('logged on the wave',
  exists (select 1 from execution_events where entity_id = pg_temp.wave() and reason like '%item ditambah%109694907%'));
reset role;
update waves set status = 'COMPLETED' where id = pg_temp.wave();
set role authenticated;
select pg_temp.check('a finished wave refused',
  pg_temp.fails(format($q$select add_wave_items(%L, '109694907', (select p from plan))$q$, pg_temp.wave()), '%sudah COMPLETED%'));
rollback;
