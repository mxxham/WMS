-- Shipment assignment (0110): one operator per shipment, posting refused for the others.
-- Runs in a transaction and rolls back. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.fails(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then
  if sqlerrm not like p_like then raise notice 'got: %', sqlerrm; end if;
  return sqlerrm like p_like; end $$;
create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', p::text, true); end $$;
create or replace function pg_temp.w(p_no text) returns uuid language sql as $$
  select id from waves where planned_date = '2026-11-20' and wave_no = p_no $$;
create or replace function pg_temp.t(p_no text, p_seq int) returns uuid language sql as $$
  select t.id from pick_tasks t join waves w on w.id = t.wave_id
  where w.planned_date = '2026-11-20' and w.wave_no = p_no and t.seq = p_seq $$;
create or replace function pg_temp.st(p_no text, p_seq int) returns text language sql as $$
  select status from pick_tasks where id = pg_temp.t(p_no, p_seq) $$;
create or replace function pg_temp.drop_plan_temps() returns void language plpgsql security definer as $$
begin execute 'drop table if exists _replace, _wave_ids, _seen'; exception when others then null; end $$;
create or replace function pg_temp.assignee(p_ship text) returns uuid language sql as $$
  select user_id from shipment_assignments where planned_date = '2026-11-20' and shipment_number = p_ship $$;
create or replace function pg_temp.logs(p_ship text, p_action text) returns int language sql as $$
  select count(*)::int from shipment_assignment_log
  where planned_date = '2026-11-20' and shipment_number = p_ship and action = p_action $$;
create or replace function pg_temp.board(p_ship text) returns text language sql as $$
  select format('%s|%s|FL %s|HP %s', b.status, coalesce(b.user_name, '-'), b.fl_lines, b.hp_lines)
  from assignment_board('2026-11-20') b where b.shipment_number = p_ship $$;
grant execute on function pg_temp.check(text, boolean), pg_temp.fails(text, text), pg_temp.as_user(uuid),
  pg_temp.w(text), pg_temp.t(text, int), pg_temp.st(text, int), pg_temp.drop_plan_temps(),
  pg_temp.assignee(text), pg_temp.logs(text, text), pg_temp.board(text) to authenticated;

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('c1111111-1111-1111-1111-111111111111','inv@pengguna.internal','{"name":"Inv"}','{"username":"t72inv"}'),
  ('c2222222-2222-2222-2222-222222222222','chk@pengguna.internal','{"name":"Chk"}','{"username":"t72chk"}'),
  ('c3333333-3333-3333-3333-333333333333','op1@pengguna.internal','{"name":"Op Satu"}','{"username":"t72op1"}'),
  ('c4444444-4444-4444-4444-444444444444','op2@pengguna.internal','{"name":"Op Dua"}','{"username":"t72op2"}'),
  ('c5555555-5555-5555-5555-555555555555','lead@pengguna.internal','{"name":"Lead"}','{"username":"t72lead"}'),
  ('c6666666-6666-6666-6666-666666666666','adm@pengguna.internal','{"name":"Adm"}','{"username":"t72adm"}');
update profiles set job = 'inventory' where id = 'c1111111-1111-1111-1111-111111111111';
update profiles set job = 'checker'   where id = 'c2222222-2222-2222-2222-222222222222';
update profiles set job = 'leader'    where id = 'c5555555-5555-5555-5555-555555555555';
update profiles set job = 'admin'     where id = 'c6666666-6666-6666-6666-666666666666';

-- Stock: one pallet bin per wave (SKU 550044709, batch Z72).
delete from inventory where bin_id in (select id from bins where bin_code in
  ('CF38C01','CF37C01','CF36C01','CF36C02','CF35C01','CF34C01','CF33C01','CF32C01','CF31C01','CF30C01','CF39C01'));
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
select 'adjustment', (select id from items where sku = '550044709'), 'Z72', 44, (select id from bins where bin_code = b), '2030-08-18', 'fixture'
from unnest(array['CF38C01','CF37C01','CF36C01','CF35C01','CF34C01','CF33C01','CF32C01','CF31C01','CF30C01','CF39C01']) b;

-- Plan: wave 1 = S1 (HP + FL), 2 = S2 (pick + Bin To Bin), 3 = S3, 4 = S4, 5 = two shipments S5A + S5B.
set role authenticated;
select pg_temp.as_user('c6666666-6666-6666-6666-666666666666');
select save_plan('2026-11-20', '{
  "waves":[{"wave_no":"1","shipment_numbers":["S1"],"truck":"L 1234 AB","planned_slot":"08:00"},
           {"wave_no":"2","shipment_numbers":["S2"]},
           {"wave_no":"3","shipment_numbers":["S3"]},
           {"wave_no":"4","shipment_numbers":["S4"]},
           {"wave_no":"5","shipment_numbers":["S5A","S5B"]},
           {"wave_no":"6","shipment_numbers":["S6"]},
           {"wave_no":"7","shipment_numbers":["S7"]},
           {"wave_no":"8","shipment_numbers":["S8"]}],
  "tasks":[
    {"wave_no":"1","shipment_number":"S1","task_type":"PICK","pick_type":"CASE","sku":"550044709","from_bin":"CF38C01","batch_lot":"Z72","expiry_date":"2030-08-18","quantity":10,"seq":1},
    {"wave_no":"1","shipment_number":"S1","task_type":"PICK","pick_type":"PALLET","sku":"550044709","from_bin":"CF37C01","batch_lot":"Z72","expiry_date":"2030-08-18","quantity":44,"seq":2},
    {"wave_no":"2","shipment_number":"S2","task_type":"PICK","pick_type":"CASE","sku":"550044709","from_bin":"CF38C01","batch_lot":"Z72","expiry_date":"2030-08-18","quantity":5,"seq":3},
    {"wave_no":"2","task_type":"REPLENISH","sku":"550044709","from_bin":"CF38C01","to_bin":"CF36C02","batch_lot":"Z72","expiry_date":"2030-08-18","quantity":2,"seq":4},
    {"wave_no":"3","shipment_number":"S3","task_type":"PICK","pick_type":"CASE","sku":"550044709","from_bin":"CF35C01","batch_lot":"Z72","expiry_date":"2030-08-18","quantity":3,"seq":5},
    {"wave_no":"4","shipment_number":"S4","task_type":"PICK","pick_type":"CASE","sku":"550044709","from_bin":"CF34C01","batch_lot":"Z72","expiry_date":"2030-08-18","quantity":4,"seq":6},
    {"wave_no":"5","shipment_number":"S5A","task_type":"PICK","pick_type":"CASE","sku":"550044709","from_bin":"CF33C01","batch_lot":"Z72","expiry_date":"2030-08-18","quantity":1,"seq":7},
    {"wave_no":"5","shipment_number":"S5B","task_type":"PICK","pick_type":"CASE","sku":"550044709","from_bin":"CF32C01","batch_lot":"Z72","expiry_date":"2030-08-18","quantity":1,"seq":8},
    {"wave_no":"6","shipment_number":"S6","task_type":"PICK","pick_type":"CASE","sku":"550044709","from_bin":"CF31C01","batch_lot":"Z72","expiry_date":"2030-08-18","quantity":1,"seq":9},
    {"wave_no":"7","shipment_number":"S7","task_type":"PICK","pick_type":"CASE","sku":"550044709","from_bin":"CF30C01","batch_lot":"Z72","expiry_date":"2030-08-18","quantity":1,"seq":10},
    {"wave_no":"8","shipment_number":"S8","task_type":"PICK","pick_type":"CASE","sku":"550044709","from_bin":"CF39C01","batch_lot":"Z72","expiry_date":"2030-08-18","quantity":1,"seq":11},
    {"wave_no":"8","shipment_number":"S8","task_type":"PICK","pick_type":"CASE","sku":"550044709","from_bin":"CF39C01","batch_lot":"Z72","expiry_date":"2030-08-18","quantity":2,"seq":12}],
  "outbound":[]}'::jsonb);
select pg_temp.drop_plan_temps();

-- ---- assign / reassign / unassign ---------------------------------------------
select pg_temp.as_user('c1111111-1111-1111-1111-111111111111');
select assign_shipment('2026-11-20', 'S1', 'c3333333-3333-3333-3333-333333333333', 'Inv');
select pg_temp.check('inventory assigns S1 to op1; one ASSIGN log row',
  pg_temp.assignee('S1') = 'c3333333-3333-3333-3333-333333333333' and pg_temp.logs('S1', 'ASSIGN') = 1);
select pg_temp.check('the assignment records who assigned it',
  (select assigned_by = 'c1111111-1111-1111-1111-111111111111' and assigned_by_name = 'Inv'
   from shipment_assignments where planned_date = '2026-11-20' and shipment_number = 'S1'));
select pg_temp.as_user('c2222222-2222-2222-2222-222222222222');
select pg_temp.check('a checker cannot assign',
  pg_temp.fails($q$select assign_shipment('2026-11-20', 'S2', 'c3333333-3333-3333-3333-333333333333', 'Chk')$q$,
                'Hanya Inventory, Leader atau Admin%'));
select pg_temp.as_user('c1111111-1111-1111-1111-111111111111');
select pg_temp.check('a checker account cannot be the assignee',
  pg_temp.fails($q$select assign_shipment('2026-11-20', 'S2', 'c2222222-2222-2222-2222-222222222222', 'Inv')$q$,
                'Hanya akun Operator%'));
select pg_temp.check('a shipment not planned that day cannot be assigned',
  pg_temp.fails($q$select assign_shipment('2026-11-20', 'S99', 'c3333333-3333-3333-3333-333333333333', 'Inv')$q$, 'Shipment S99%'));
select pg_temp.check('the assigner''s name is required',
  pg_temp.fails($q$select assign_shipment('2026-11-20', 'S2', 'c3333333-3333-3333-3333-333333333333', ' ')$q$, '%wajib diisi%'));
select assign_shipment('2026-11-20', 'S1', 'c4444444-4444-4444-4444-444444444444', 'Inv');
select pg_temp.check('reassign to op2 replaces the row and logs ASSIGN again',
  pg_temp.assignee('S1') = 'c4444444-4444-4444-4444-444444444444' and pg_temp.logs('S1', 'ASSIGN') = 2
  and (select count(*) from shipment_assignments where planned_date = '2026-11-20' and shipment_number = 'S1') = 1);
select unassign_shipment('2026-11-20', 'S1', 'Inv');
select pg_temp.check('unassign removes the row and logs UNASSIGN with the former assignee',
  pg_temp.assignee('S1') is null and pg_temp.logs('S1', 'UNASSIGN') = 1
  and (select user_id from shipment_assignment_log where planned_date = '2026-11-20' and shipment_number = 'S1' and action = 'UNASSIGN')
      = 'c4444444-4444-4444-4444-444444444444');
select assign_shipment('2026-11-20', 'S1', 'c3333333-3333-3333-3333-333333333333', 'Inv');
select assign_shipment('2026-11-20', 'S3', 'c3333333-3333-3333-3333-333333333333', 'Inv');
select assign_shipment('2026-11-20', 'S4', 'c3333333-3333-3333-3333-333333333333', 'Inv');
select assign_shipment('2026-11-20', 'S5A', 'c3333333-3333-3333-3333-333333333333', 'Inv');

select pg_temp.check('board: S1 Belum, assignee name, 1 FL + 1 HP line',
  pg_temp.board('S1') = 'Belum|Op Satu|FL 1|HP 1');
select pg_temp.check('board: S2 Belum, nobody assigned',
  pg_temp.board('S2') = 'Belum|-|FL 0|HP 1');
select pg_temp.check('board: one row per shipment, also for a two-shipment wave',
  (select count(*) from assignment_board('2026-11-20')) = 9
  and (select wave_no = '1' and truck = 'L 1234 AB' and planned_slot = '08:00' and wave_id = pg_temp.w('1')
       from assignment_board('2026-11-20') where shipment_number = 'S1'));
select pg_temp.check('assignable_operators lists active operators with their open count',
  (select open_count = 4 and name = 'Op Satu' and username = 't72op1' from assignable_operators()
   where id = 'c3333333-3333-3333-3333-333333333333')
  and (select open_count = 0 from assignable_operators() where id = 'c4444444-4444-4444-4444-444444444444')
  and not exists (select 1 from assignable_operators() where id = 'c2222222-2222-2222-2222-222222222222'));

-- ---- posting guard --------------------------------------------------------------
select pg_temp.as_user('c4444444-4444-4444-4444-444444444444');
select pg_temp.check('shipment_assigned_to_me false for another operator',
  not shipment_assigned_to_me(pg_temp.w('1'), 'S1'));
select pg_temp.check('another operator cannot post a pick of S1',
  pg_temp.fails(format($q$select post_task_by(%L, p_by_name => 'Op Dua', p_scanned => 'CF38C01')$q$, pg_temp.t('1', 1)),
                'Shipment S1 tidak ditugaskan ke Anda%'));
select pg_temp.check('another operator cannot complete the wave of S1',
  pg_temp.fails(format($q$select complete_wave(%L)$q$, pg_temp.w('1')), 'Shipment S1 tidak ditugaskan ke Anda%'));
select pg_temp.check('a REPLENISH task of an unassigned wave is refused naming its shipment',
  pg_temp.fails(format($q$select post_task_by(%L, p_by_name => 'Op Dua', p_scanned => 'CF38C01')$q$, pg_temp.t('2', 4)),
                'Shipment S2 tidak ditugaskan ke Anda%'));
select pg_temp.check('nothing of S1 was posted', pg_temp.st('1', 1) = 'PLANNED' and pg_temp.st('1', 2) = 'PLANNED');

select pg_temp.as_user('c3333333-3333-3333-3333-333333333333');
-- Review Focus 1: the pick is op1's (S1), the Bin To Bin belongs to wave 2 (S2, not op1's).
-- post_pick_with_move (0068) already refuses a pair across waves before the guard can fire; the
-- point is that the call fails and leaves both tasks open.
select pg_temp.check('pick + Bin To Bin of another, unassigned wave is refused',
  pg_temp.fails(format($q$select post_pick_with_move(%L, %L, 10, 2, null, 'Op Satu', 'CF38C01')$q$,
                       pg_temp.t('1', 1), pg_temp.t('2', 4)), 'Tugas ini bukan pasangan pick + pindah sisa palet%'));
select pg_temp.check('... and the pick is still PLANNED, the move too',
  pg_temp.st('1', 1) = 'PLANNED' and pg_temp.st('2', 4) = 'PLANNED');
-- Atomic: complete_wave on a two-shipment wave where only S5A is op1's posts nothing.
select pg_temp.check('complete_wave over a shipment that is not op1''s is refused',
  pg_temp.fails(format($q$select complete_wave(%L)$q$, pg_temp.w('5')), 'Shipment S5B tidak ditugaskan ke Anda%'));
select pg_temp.check('... and S5A''s pick, posted first, is rolled back with it', pg_temp.st('5', 7) = 'PLANNED');

select pg_temp.check('shipment_assigned_to_me true for the assignee; null shipment = any of the wave',
  shipment_assigned_to_me(pg_temp.w('1'), 'S1') and shipment_assigned_to_me(pg_temp.w('1'), null)
  and shipment_assigned_to_me(pg_temp.w('5'), null) and not shipment_assigned_to_me(pg_temp.w('2'), null));
select post_task_by(pg_temp.t('1', 1), p_by_name => 'Op Satu', p_scanned => 'CF38C01');
select pg_temp.check('the assigned operator posts a pick of S1', pg_temp.st('1', 1) = 'COMPLETED');
select pg_temp.check('board: S1 Dipicking after one posted task, still op1',
  pg_temp.board('S1') = 'Dipicking|Op Satu|FL 1|HP 1');

-- ---- Review Focus 4: non-operator jobs post as before -----------------------------
select pg_temp.as_user('c6666666-6666-6666-6666-666666666666');
select post_task_by(pg_temp.t('2', 3), p_by_name => 'Adm', p_scanned => 'CF38C01');
select pg_temp.check('admin posts an unassigned shipment', pg_temp.st('2', 3) = 'COMPLETED');
select pg_temp.as_user('c5555555-5555-5555-5555-555555555555');
select post_task_by(pg_temp.t('2', 4), p_by_name => 'Lead', p_scanned => 'CF38C01');
select pg_temp.check('leader posts an unassigned Bin To Bin', pg_temp.st('2', 4) = 'COMPLETED');
select pg_temp.as_user('c6666666-6666-6666-6666-666666666666');
select post_task_by(pg_temp.t('4', 6), p_by_name => 'Adm', p_scanned => 'CF34C01');  -- S4 is op1's: now Selesai
select pg_temp.check('board: S2 and S4 Selesai with no planned task left',
  (select count(*) from assignment_board('2026-11-20') where shipment_number in ('S2','S4') and status = 'Selesai') = 2);

-- ---- loaded shipment -----------------------------------------------------------
reset role;
insert into shipment_loads (wave_id, shipment_number, loaded_by_name) values (pg_temp.w('2'), 'S2', 'Chk');
set role authenticated;
select pg_temp.as_user('c1111111-1111-1111-1111-111111111111');
select pg_temp.check('board: S2 Dimuat', (select status from assignment_board('2026-11-20') where shipment_number = 'S2') = 'Dimuat');
select pg_temp.check('a loaded shipment cannot be assigned',
  pg_temp.fails($q$select assign_shipment('2026-11-20', 'S2', 'c3333333-3333-3333-3333-333333333333', 'Inv')$q$,
                'Shipment S2 sudah dimuat%'));

-- ---- carried-over shipment: the old day's assignment is not open, not on the new day ----
select pg_temp.as_user('c1111111-1111-1111-1111-111111111111');
select assign_shipment('2026-11-20', 'S6', 'c4444444-4444-4444-4444-444444444444', 'Inv');
select pg_temp.check('op2 holds S6: open count 1',
  (select open_count from assignable_operators() where id = 'c4444444-4444-4444-4444-444444444444') = 1);
select pg_temp.as_user('c6666666-6666-6666-6666-666666666666');
create temp table _w6 as select pg_temp.w('6') as id;
select set_wave_status((select id from _w6), 'RESCHEDULED', 'truk tidak datang');
select carry_over_wave((select id from _w6), '2026-11-21', '{}', 'jadwal ulang');
select pg_temp.check('after carry-over the stale assignment is not counted open',
  (select open_count from assignable_operators() where id = 'c4444444-4444-4444-4444-444444444444') = 0);
select pg_temp.check('... and the shipment is not assigned on the new day',
  (select user_id is null from assignment_board('2026-11-21') where shipment_number = 'S6'));
select pg_temp.as_user('c4444444-4444-4444-4444-444444444444');
select pg_temp.check('... and op2 cannot post it there', not shipment_assigned_to_me((select id from _w6), 'S6'));

-- ---- a RESCHEDULED task keeps the shipment open --------------------------------------
select pg_temp.as_user('c6666666-6666-6666-6666-666666666666');
select post_task_by(pg_temp.t('8', 11), p_by_name => 'Adm', p_scanned => 'CF39C01');
reset role;
update pick_tasks set status = 'RESCHEDULED' where id = pg_temp.t('8', 12);
set role authenticated;
select pg_temp.check('board: S8 with its last task RESCHEDULED is Dipicking, not Selesai',
  (select status from assignment_board('2026-11-20') where shipment_number = 'S8') = 'Dipicking');
select pg_temp.as_user('c1111111-1111-1111-1111-111111111111');
select assign_shipment('2026-11-20', 'S8', 'c4444444-4444-4444-4444-444444444444', 'Inv');
select assign_shipment('2026-11-20', 'S7', 'c4444444-4444-4444-4444-444444444444', 'Inv');
select pg_temp.check('... and it can still be assigned', pg_temp.assignee('S8') = 'c4444444-4444-4444-4444-444444444444');

-- ---- a legacy direct role write that moves the job also releases -----------------------
reset role;
update profiles set role = 'supervisor' where id = 'c4444444-4444-4444-4444-444444444444';
set role authenticated;
select pg_temp.check('role write operator -> supervisor: open S7 and S8 released with RELEASE rows',
  pg_temp.assignee('S7') is null and pg_temp.assignee('S8') is null
  and pg_temp.logs('S7', 'RELEASE') = 1 and pg_temp.logs('S8', 'RELEASE') = 1);

-- ---- Review Focus 3: re-running Alokasi keeps the assignment --------------------
select pg_temp.as_user('c6666666-6666-6666-6666-666666666666');
create temp table _old_w3 as select pg_temp.w('3') as id;
select save_plan('2026-11-20', '{
  "waves":[{"wave_no":"3","shipment_numbers":["S3"]},{"wave_no":"5","shipment_numbers":["S5A","S5B"]}],
  "tasks":[{"wave_no":"3","shipment_number":"S3","task_type":"PICK","pick_type":"CASE","sku":"550044709","from_bin":"CF35C01","batch_lot":"Z72","expiry_date":"2030-08-18","quantity":2,"seq":5},
    {"wave_no":"5","shipment_number":"S5A","task_type":"PICK","pick_type":"CASE","sku":"550044709","from_bin":"CF33C01","batch_lot":"Z72","expiry_date":"2030-08-18","quantity":1,"seq":7},
    {"wave_no":"5","shipment_number":"S5B","task_type":"PICK","pick_type":"CASE","sku":"550044709","from_bin":"CF32C01","batch_lot":"Z72","expiry_date":"2030-08-18","quantity":1,"seq":8}],
  "outbound":[]}'::jsonb);
select pg_temp.drop_plan_temps();
select pg_temp.check('the untouched wave 3 was replaced (new id)', pg_temp.w('3') <> (select id from _old_w3));
select pg_temp.as_user('c3333333-3333-3333-3333-333333333333');
select pg_temp.check('op1 still holds S3 on the new wave', shipment_assigned_to_me(pg_temp.w('3'), 'S3'));

-- ---- Review Focus 2: moving or deactivating the operator releases open shipments ----
select pg_temp.as_user('c6666666-6666-6666-6666-666666666666');
select set_user_job('c3333333-3333-3333-3333-333333333333', 'checker');
select pg_temp.check('job change: open S1, S3, S5A released with a RELEASE log row each',
  pg_temp.assignee('S1') is null and pg_temp.assignee('S3') is null and pg_temp.assignee('S5A') is null
  and pg_temp.logs('S1', 'RELEASE') = 1 and pg_temp.logs('S3', 'RELEASE') = 1 and pg_temp.logs('S5A', 'RELEASE') = 1);
select pg_temp.check('job change: the Selesai shipment S4 stays with them',
  pg_temp.assignee('S4') = 'c3333333-3333-3333-3333-333333333333' and pg_temp.logs('S4', 'RELEASE') = 0);
select set_user_job('c3333333-3333-3333-3333-333333333333', 'operator');
select assign_shipment('2026-11-20', 'S1', 'c3333333-3333-3333-3333-333333333333', 'Adm');
select set_user_active('c3333333-3333-3333-3333-333333333333', false);
select pg_temp.check('deactivation: open S1 released and logged',
  pg_temp.assignee('S1') is null and pg_temp.logs('S1', 'RELEASE') = 2);
select pg_temp.check('a deactivated operator cannot be assigned',
  pg_temp.fails($q$select assign_shipment('2026-11-20', 'S1', 'c3333333-3333-3333-3333-333333333333', 'Adm')$q$,
                'Hanya akun Operator%'));

-- ---- the log is append-only, the tables have no write policy ------------------------
reset role;
select pg_temp.check('a log row cannot be updated',
  pg_temp.fails($q$update shipment_assignment_log set by_name = 'x'$q$, '%tidak bisa diubah%'));
select pg_temp.check('a log row cannot be deleted',
  pg_temp.fails($q$delete from shipment_assignment_log$q$, '%tidak bisa diubah%'));
set role authenticated;
select pg_temp.as_user('c6666666-6666-6666-6666-666666666666');
select pg_temp.check('authenticated cannot write assignments directly',
  pg_temp.fails($q$insert into shipment_assignments (planned_date, shipment_number, user_id, assigned_by_name)
                   values ('2026-11-20', 'S2', 'c4444444-4444-4444-4444-444444444444', 'x')$q$, '%'));
reset role;
select pg_temp.check('anon cannot execute assign_shipment',
  not has_function_privilege('anon', 'public.assign_shipment(date, text, uuid, text)', 'execute'));
rollback;
