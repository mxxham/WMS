-- Block C picking end to end (0147): a stack in a floor slot is planned, reserved and posted like any bin.
-- save_plan accepts FA- slots, planning_stock reserves them, post_task books the pick and leaves the rest of the
-- stack, and the one-way rule still holds for the stock left over.
-- Runs in a transaction and rolls back. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users values
  ('a1101111-1111-1111-1111-111111111111','adm110@x','{"name":"Admin 110"}'),
  ('a1102222-2222-2222-2222-222222222222','sup110@x','{"name":"Sup 110"}') on conflict do nothing;
update profiles set role = 'admin' where id = 'a1101111-1111-1111-1111-111111111111';
update profiles set role = 'supervisor' where id = 'a1102222-2222-2222-2222-222222222222';
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when coalesce(ok, false) then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.fails(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then
  if sqlerrm not like p_like then raise notice 'got: %', sqlerrm; end if;
  return sqlerrm like p_like; end $$;
create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', p::text, true); end $$;
create or replace function pg_temp.at(p_bin text, p_sku text) returns numeric language sql as $$
  select coalesce(sum(i.quantity), 0) from inventory i join bins b on b.id = i.bin_id join items it on it.id = i.item_id
  where b.bin_code = p_bin and it.sku = p_sku $$;
create or replace function pg_temp.avail(p_date date, p_bin text) returns numeric language sql as $$
  select coalesce(sum(quantity), 0) from planning_stock(p_date) where bin_code = p_bin and sku = 'T110A' $$;
create or replace function pg_temp.task(p_seq int) returns uuid language sql as $$
  select t.id from pick_tasks t join waves w on w.id = t.wave_id where w.planned_date = '2026-12-02' and t.seq = p_seq $$;
grant execute on function pg_temp.check(text, boolean), pg_temp.fails(text, text), pg_temp.as_user(uuid),
  pg_temp.at(text, text), pg_temp.avail(date, text), pg_temp.task(int) to authenticated;

-- Fixture: T110A (50 cartons per pallet) lives in slot FA-01, 3 pallets high, with 150 cartons.
insert into items (sku, description, uom, upp) values ('T110A', 'Block C SKU', 'CAR', 50), ('T110B', 'Another SKU', 'CAR', 50);
insert into bins (bin_code, zone, rack, level, position, status, capacity, assigned_sku)
  values ('FA-01', 'FA', null, null, '01', 'active', 3, 'T110A');
select pg_temp.check('fixture: FA-01 is a Block C slot', (select site = 'BLOCKC' from bins where bin_code = 'FA-01'));
set role authenticated;
select pg_temp.as_user('a1102222-2222-2222-2222-222222222222');
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
  select 'inbound', id, 'B110', 150, (select id from bins where bin_code = 'FA-01'), date '2031-01-01', 'tes 110' from items where sku = 'T110A';
select pg_temp.check('fixture: 150 cartons = 3 pallets in the slot', pg_temp.at('FA-01', 'T110A') = 150);

-- 1  The planner sees the slot ------------------------------------------------------------------------------------
select pg_temp.check('planning_stock lists the slot as usable stock',
  (select quantity = 150 and bin_status = 'active' and upp = 50 from planning_stock('2026-12-02') where bin_code = 'FA-01' and sku = 'T110A'));

-- 2  save_plan: two whole pallets and 20 loose from the third, as plan.ts builds them -------------------------------
select save_plan('2026-12-02', '{
  "waves":[{"wave_no":"1","shipment_numbers":["S110"]}],
  "tasks":[
    {"wave_no":"1","shipment_number":"S110","task_type":"PICK","sku":"T110A","from_bin":"FA-01","batch_lot":"B110","expiry_date":"2031-01-01","quantity":50,"pick_type":"PALLET","breaks_pallet":false,"seq":1},
    {"wave_no":"1","shipment_number":"S110","task_type":"PICK","sku":"T110A","from_bin":"FA-01","batch_lot":"B110","expiry_date":"2031-01-01","quantity":50,"pick_type":"PALLET","breaks_pallet":false,"seq":2},
    {"wave_no":"1","shipment_number":"S110","task_type":"PICK","sku":"T110A","from_bin":"FA-01","batch_lot":"B110","expiry_date":"2031-01-01","quantity":20,"pick_type":"CASE","breaks_pallet":true,"seq":3}],
  "outbound":[{"wave_no":"1","shipment_number":"S110","sku":"T110A","quantity_requested":120,"quantity_allocated":120}]}'::jsonb) \g /dev/null
select pg_temp.check('the plan is saved: three PICK tasks from FA-01',
  (select count(*) = 3 and bool_and(task_type = 'PICK') and sum(quantity) = 120
     from pick_tasks t join bins b on b.id = t.from_bin_id where b.bin_code = 'FA-01'));
select pg_temp.check('another day sees the stack net of the open tasks: 150 - 120 = 30 free',
  pg_temp.avail('2026-12-03', 'FA-01') = 30);
select pg_temp.check('the Wave page view lists the Block C tasks with their pick type',
  (select count(*) = 3 and count(*) filter (where pick_type = 'PALLET') = 2 from pick_task_detail where from_bin = 'FA-01'));

-- 3  Posting -----------------------------------------------------------------------------------------------------
select post_task(pg_temp.task(1)) \g /dev/null
select post_task(pg_temp.task(2)) \g /dev/null
select pg_temp.check('two whole pallets posted: one pallet (50 cartons) remains in the stack', pg_temp.at('FA-01', 'T110A') = 50);
select post_task(pg_temp.task(3)) \g /dev/null
select pg_temp.check('the loose pick is posted: 30 cartons stay in the slot, no Bin To Bin was needed', pg_temp.at('FA-01', 'T110A') = 30);
select pg_temp.check('three picking movements from FA-01 were booked, 120 cartons',
  (select count(*) = 3 and sum(m.quantity) = 120 from movements m join bins b on b.id = m.from_bin_id
     where b.bin_code = 'FA-01' and m.type = 'picking'));
select pg_temp.check('the tasks are COMPLETED',
  (select bool_and(t.status = 'COMPLETED') from pick_tasks t join bins b on b.id = t.from_bin_id where b.bin_code = 'FA-01'));

-- 4  The rule still holds after picking ---------------------------------------------------------------------------
select pg_temp.check('the leftover of the stack still cannot be moved into Oso 5',
  pg_temp.fails($q$insert into movements (type, item_id, batch_lot, quantity, from_bin_id, to_bin_id, expiry_date)
    select 'transfer', id, 'B110', 10, (select id from bins where bin_code = 'FA-01'),
           (select b.id from bins b where b.bin_code ~ '^C[A-F]\d{2}[A-E]\d{2}$' and b.status = 'active' and b.owner = 'SHELL' order by b.bin_code limit 1), date '2031-01-01'
    from items where sku = 'T110A'$q$, 'SKU T110A hanya untuk Block C%'));

-- 5  Stock Opname of a Block C lane (apply_rack_check takes the lane as the aisle) --------------------------------
select pg_temp.check('a count of lane FA: the slot is corrected from 30 to 24 cartons',
  (apply_rack_check('FA', jsonb_build_array(jsonb_build_object('bin_code', 'FA-01', 'sku', 'T110A', 'add', false, 'batch_lot', 'B110',
     'expiry_date', '2031-01-01', 'expected_qty', 30, 'new_batch', 'B110', 'new_expiry', '2031-01-01', 'new_qty', 24)),
     'COUNT_VARIANCE', 'Budi') is not null) and pg_temp.at('FA-01', 'T110A') = 24);
select pg_temp.check('a count cannot put another SKU into the slot: the one-SKU rule of the slot refuses it',
  pg_temp.fails($q$select apply_rack_check('FA', jsonb_build_array(jsonb_build_object('bin_code', 'FA-01', 'sku', 'T110B', 'add', true,
     'new_batch', 'X1', 'new_expiry', '2031-01-01', 'new_qty', 5)), 'COUNT_VARIANCE', 'Budi')$q$, 'Slot FA-01 khusus SKU T110A%'));
select pg_temp.check('...and the slot still holds only T110A', pg_temp.at('FA-01', 'T110B') = 0);

rollback;
