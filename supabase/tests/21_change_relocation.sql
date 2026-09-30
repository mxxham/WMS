-- Ubah Bin To Bin: an open move gets another destination on the wave page (0047). Runs in a transaction and rolls back.
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

-- A pallet of 44 in CF38E01 (like CD39E02); its planned pickface CF38A02 turns out full, CF38A01 is free.
delete from inventory where bin_id in (select id from bins where bin_code in ('CF38E01', 'CF38A02', 'CF38A01'));
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
select 'adjustment', (select id from items where sku = '550044709'), '15I26JJ', 44, (select id from bins where bin_code = 'CF38E01'), '2030-09-15', 'fixture';
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select save_plan('2026-10-25', '{
  "waves":[{"wave_no":"8","shipment_numbers":["109694907"]}],
  "tasks":[
    {"wave_no":"8","shipment_number":"109694907","task_type":"PICK","sku":"550044709","from_bin":"CF38E01","batch_lot":"15I26JJ","expiry_date":"2030-09-15","quantity":6,"seq":1}],
  "outbound":[{"wave_no":"8","shipment_number":"109694907","sku":"550044709","quantity_requested":6,"quantity_allocated":6}]}'::jsonb) \g /dev/null
create or replace function pg_temp.pick() returns uuid language sql as $$
  select t.id from pick_tasks t join waves w on w.id = t.wave_id where w.planned_date = '2026-10-25' and t.task_type = 'PICK' $$;
create or replace function pg_temp.move() returns pick_tasks language sql as $$
  select t.* from pick_tasks t join waves w on w.id = t.wave_id where w.planned_date = '2026-10-25' and t.task_type = 'REPLENISH' $$;
select add_relocation(pg_temp.pick(), 'CF38A02', 38, 'Budi', 'rencana') \g /dev/null

select pg_temp.check('a pick is not a Bin To Bin',
  pg_temp.fails(format($q$select change_relocation(%L, 'CF38A01', 38, 'Budi')$q$, pg_temp.pick()), '%bukan Bin To Bin%'));
select pg_temp.check('back to the pallet bin refused',
  pg_temp.fails(format($q$select change_relocation(%L, 'CF38E01', 38, 'Budi')$q$, (pg_temp.move()).id), '%sama dengan bin asal%'));
select pg_temp.check('an unknown bin refused',
  pg_temp.fails(format($q$select change_relocation(%L, 'ZZ99Z99', 38, 'Budi')$q$, (pg_temp.move()).id), '%tidak ada%'));
select pg_temp.check('zero cartons refused',
  pg_temp.fails(format($q$select change_relocation(%L, 'CF38A01', 0, 'Budi')$q$, (pg_temp.move()).id), '%lebih dari 0%'));
reset role;
update profiles set role = 'operator' where id = '11111111-1111-1111-1111-111111111111';
set role authenticated;
select pg_temp.check('an operator cannot change it',
  pg_temp.fails(format($q$select change_relocation(%L, 'CF38A01', 38, 'Budi')$q$, (pg_temp.move()).id), '%Hanya supervisor%'));
reset role;
update profiles set role = 'admin' where id = '11111111-1111-1111-1111-111111111111';
set role authenticated;

select pg_temp.check('changed to CF38A01, same place in the wave',
  change_relocation((pg_temp.move()).id, 'cf38a01', 38, 'Budi', 'CF38A02 penuh') @> '{"to_bin":"CF38A01","from_bin":"CF38A02"}'
  and (pg_temp.move()).seq = 2 and (pg_temp.move()).quantity = 38);
select pg_temp.check('the change is in the history',
  exists (select 1 from execution_events where entity_id = (pg_temp.move()).id and reason like '%Budi: CF38A02 → CF38A01 (38): CF38A02 penuh'));
select pg_temp.check('pick + move post together: 6 out, 38 to CF38A01, nothing to CF38A02',
  (post_pick_with_move(pg_temp.pick(), (pg_temp.move()).id, null, null, null, 'Budi')->'move'->>'result') = 'POSTED'
  and pg_temp.qty('CF38E01') = 0 and pg_temp.qty('CF38A01') = 38 and pg_temp.qty('CF38A02') = 0);
select pg_temp.check('a posted move cannot be changed',
  pg_temp.fails(format($q$select change_relocation(%L, 'CF38A02', 38, 'Budi')$q$, (pg_temp.move()).id), '%tidak terbuka%'));
rollback;
