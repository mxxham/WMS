-- Bin To Bin added to a pick on the wave page (0045). Runs in a transaction and rolls back.
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
create or replace function pg_temp.qty(p_bin text) returns numeric language sql as $$
  select coalesce(sum(i.quantity), 0) from inventory i join bins b on b.id = i.bin_id where b.bin_code = p_bin $$;

-- A pallet of 80 in CF38E01 (like CB12E02); an empty CF38A02 below.
delete from inventory where bin_id in (select id from bins where bin_code in ('CF38E01', 'CF38A02'));
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
select 'adjustment', (select id from items where sku = '550044709'), '270826', 80, (select id from bins where bin_code = 'CF38E01'), '2030-08-27', 'fixture';
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select save_plan('2026-10-24', '{
  "waves":[{"wave_no":"4","shipment_numbers":["109694900"]}],
  "tasks":[
    {"wave_no":"4","shipment_number":"109694900","task_type":"PICK","sku":"550044709","from_bin":"CF38E01","batch_lot":"270826","expiry_date":"2030-08-27","quantity":67,"seq":4},
    {"wave_no":"4","shipment_number":"109694900","task_type":"PICK","sku":"550044709","from_bin":"CF38E01","batch_lot":"270826","expiry_date":"2030-08-27","quantity":1,"seq":5}],
  "outbound":[{"wave_no":"4","shipment_number":"109694900","sku":"550044709","quantity_requested":68,"quantity_allocated":68}]}'::jsonb);
create or replace function pg_temp.t(p_seq int) returns pick_tasks language sql as $$
  select t.* from pick_tasks t join waves w on w.id = t.wave_id where w.planned_date = '2026-10-24' and t.seq = p_seq $$;
create or replace function pg_temp.pick4() returns uuid language sql as $$
  select t.id from pick_tasks t join waves w on w.id = t.wave_id where w.planned_date = '2026-10-24' and t.task_type = 'PICK' and t.quantity = 67 $$;

select pg_temp.check('to the same bin refused',
  pg_temp.fails(format($q$select add_relocation(%L, 'CF38E01', 13, 'Budi')$q$, pg_temp.pick4()), '%sama dengan bin asal%'));
select pg_temp.check('added right after the pick',
  add_relocation(pg_temp.pick4(), 'cf38a02', 12, 'Budi', 'pickface penuh') @> '{"to_bin":"CF38A02","seq":5}');
select pg_temp.check('the later task moved one place down',
  (pg_temp.t(5)).task_type = 'REPLENISH' and (pg_temp.t(6)).task_type = 'PICK' and (pg_temp.t(6)).quantity = 1);
select pg_temp.check('a second open move from that bin refused',
  pg_temp.fails(format($q$select add_relocation(%L, 'CF38A02', 1, 'Budi')$q$, pg_temp.pick4()), '%Sudah ada Bin To Bin%'));
select pg_temp.check('pick + added move post together: 67 out, 12 down, 1 left for #6',
  (post_pick_with_move(pg_temp.pick4(), (pg_temp.t(5)).id, null, null, null, 'Budi')->'move'->>'result') = 'POSTED'
  );
select pg_temp.check('bins after: CF38E01 1, CF38A02 12', pg_temp.qty('CF38E01') = 1 and pg_temp.qty('CF38A02') = 12);
rollback;
