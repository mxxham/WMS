-- Move (REPLENISH) audit (0088). Runs in a transaction and rolls back.
-- Run with scripts/sql-test.sh. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users values ('11111111-1111-1111-1111-111111111111','op@x','{"name":"Operator"}'),
                              ('22222222-2222-2222-2222-222222222222','sup@x','{"name":"Supervisor"}') on conflict do nothing;
update profiles set role='operator' where id='11111111-1111-1111-1111-111111111111';
update profiles set role='supervisor' where id='22222222-2222-2222-2222-222222222222';

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.fails(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then
  if sqlerrm not like p_like then raise notice 'got: %', sqlerrm; end if;
  return sqlerrm like p_like; end $$;
create or replace function pg_temp.task(p_wave text, p_seq int) returns uuid language sql as $$
  select t.id from pick_tasks t join waves w on w.id = t.wave_id
  where w.planned_date = '2026-10-06' and w.wave_no = p_wave and t.task_type = 'REPLENISH' and t.seq = p_seq $$;
create or replace function pg_temp.pick_task(p_wave text, p_seq int) returns uuid language sql as $$
  select t.id from pick_tasks t join waves w on w.id = t.wave_id
  where w.planned_date = '2026-10-06' and w.wave_no = p_wave and t.task_type = 'PICK' and t.seq = p_seq $$;
create or replace function pg_temp.wave(p_no text) returns uuid language sql as $$
  select id from waves where planned_date = '2026-10-06' and wave_no = p_no $$;
create or replace function pg_temp.qty(p_bin text, p_batch text) returns numeric language sql as $$
  select coalesce(sum(i.quantity), 0) from inventory i join bins b on b.id = i.bin_id
  where b.bin_code = p_bin and i.batch_lot = p_batch $$;
create or replace function pg_temp.move_line(p_wave text, p_seq int) returns pick_audit_move language sql as $$
  select * from pick_audit_move where task_id = pg_temp.task(p_wave, p_seq) $$;

-- Fixture: reserve bin CF38C01 (level A) has 96 of 550044709 batch A7 and 24 of batch B8; pickface CF38C02 (level B) empty.
update items set ean = '8994123456789' where sku = '550044709';
delete from inventory where bin_id in (select id from bins where bin_code in ('CF38C01', 'CF38C02'));
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
select 'adjustment', (select id from items where sku = s), bt, q, (select id from bins where bin_code = b), e::date, 'fixture'
from (values ('CF38C01', '550044709', 'A7', 96, '2031-05-05'), ('CF38C01', '550044709', 'B8', 24, '2031-06-06')) v(b, s, bt, q, e);

set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

-- A plan with multiple REPLENISH tasks for different test scenarios
select save_plan('2026-10-06', '{
  "waves":[
    {"wave_no":"1","shipment_numbers":["PA1"]},
    {"wave_no":"2","shipment_numbers":["PA2"]}
  ],
  "tasks":[
    {"wave_no":"1","shipment_number":"PA1","task_type":"PICK","sku":"550044709","from_bin":"CF38C02","batch_lot":"A7","expiry_date":"2031-05-05","quantity":10,"seq":1},
    {"wave_no":"1","task_type":"REPLENISH","sku":"550044709","from_bin":"CF38C01","to_bin":"CF38C02","batch_lot":"A7","expiry_date":"2031-05-05","quantity":24,"seq":2},
    {"wave_no":"1","task_type":"REPLENISH","sku":"550044709","from_bin":"CF38C01","to_bin":"CF38C02","batch_lot":"A7","expiry_date":"2031-05-05","quantity":1,"seq":3},
    {"wave_no":"1","task_type":"REPLENISH","sku":"550044709","from_bin":"CF38C01","to_bin":"CF38C02","batch_lot":"A7","expiry_date":"2031-05-05","quantity":24,"seq":4},
    {"wave_no":"1","task_type":"REPLENISH","sku":"550044709","from_bin":"CF38C01","to_bin":"CF38C02","batch_lot":"A7","expiry_date":"2031-05-05","quantity":24,"seq":5},
    {"wave_no":"2","task_type":"REPLENISH","sku":"550044709","from_bin":"CF38C01","to_bin":"CF38C02","batch_lot":"A7","expiry_date":"2031-05-05","quantity":12,"seq":1}
  ],
  "outbound":[
    {"wave_no":"1","shipment_number":"PA1","sku":"550044709","quantity_requested":10,"quantity_allocated":10},
    {"wave_no":"2","shipment_number":"PA2","sku":"550044709","quantity_requested":12,"quantity_allocated":12}]}'::jsonb);

-- Post the replenish tasks (operator)
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select post_task_by(pg_temp.task('1', 2), p_by_name => 'Budi Santoso', p_scanned => 'CF38C01');
-- Post a replenish with 0 actual quantity
select post_task_by(pg_temp.task('1', 3), p_actual_qty => 0, p_by_name => 'Budi Santoso', p_scanned => 'CF38C01', p_reason => 'tidak ada yang dipindah');
select post_task_by(pg_temp.task('1', 4), p_by_name => 'Budi Santoso', p_scanned => 'CF38C01');
select post_task_by(pg_temp.task('1', 5), p_by_name => 'Budi Santoso', p_scanned => 'CF38C01');
-- Post wave 2 replenish
select post_task_by(pg_temp.task('2', 1), p_by_name => 'Budi Santoso', p_scanned => 'CF38C01');
-- Post the PICK task so the shipment can be loaded
select post_task_by(pg_temp.pick_task('1', 1), p_by_name => 'Budi Santoso', p_scanned => 'CF38C02');

-- ---- A. View lists completed replenish with correct to_bin -----------------
select pg_temp.check('pick_audit_move shows the completed replenish with from_bin and to_bin',
  (pg_temp.move_line('1', 2)).from_bin = 'CF38C01' and (pg_temp.move_line('1', 2)).to_bin = 'CF38C02'
  and (pg_temp.move_line('1', 2)).line_state = 'TODO' and (pg_temp.move_line('1', 2)).attempts = 0);

select pg_temp.check('pick_audit_move includes wave fields',
  (pg_temp.move_line('1', 2)).wave_no = '1' and (pg_temp.move_line('1', 2)).planned_date = '2026-10-06'
  and (pg_temp.move_line('1', 2)).wave_status = 'PENDING');

-- ---- B. record_move_audit OK path ----------------------------------------
select pg_temp.check('a replenish that is not completed cannot be audited',
  pg_temp.fails(format($q$select record_move_audit(%L, 'Sari', '550044709', 10, 'A7', null, false, null)$q$,
    (select t.id from pick_tasks t join waves w on w.id = t.wave_id
     where w.planned_date = '2026-10-06' and w.wave_no = '1' and t.task_type = 'PICK' and t.seq = 1)),
    'Tugas pindahan belum selesai%'));

select pg_temp.check('a line moved as 0 is not audited',
  pg_temp.fails(format($q$select record_move_audit(%L, 'Sari', '550044709', 0, 'A7', null, false, null)$q$, pg_temp.task('1', 3)),
    'Baris ini tidak dipindah%'));

select pg_temp.check('the mover cannot audit own line (name compared ignoring case and spaces)',
  pg_temp.fails(format($q$select record_move_audit(%L, 'budi  santoso', '550044709', 24, 'A7', null, false, null)$q$, pg_temp.task('1', 2)),
    'Checker tidak boleh petugas pindah%'));

select pg_temp.check('a checker name is required',
  pg_temp.fails(format($q$select record_move_audit(%L, ' ', '550044709', 24, 'A7', null, false, null)$q$, pg_temp.task('1', 2)),
    'Nama checker wajib%'));

select pg_temp.check('an unknown carton code is refused',
  pg_temp.fails(format($q$select record_move_audit(%L, 'Sari', '0000000000000', 24, 'A7', null, false, null)$q$, pg_temp.task('1', 2)),
    '%tidak dikenal%'));

select pg_temp.check('a negative count is refused',
  pg_temp.fails(format($q$select record_move_audit(%L, 'Sari', '550044709', -1, 'A7', null, false, null)$q$, pg_temp.task('1', 2)),
    'Jumlah hitung tidak valid%'));

-- Use task 2 for OK path
select pg_temp.check('carton EAN + batch typed " a7 " + full count -> OK',
  record_move_audit(pg_temp.task('1', 2), 'Sari', '8994123456789', 24, ' a7 ', null, false, null)->>'result' = 'OK');

select pg_temp.check('the attempt keeps the scanned code and the SKU it resolved to',
  (select found_sku = '550044709' and found_scanned_code = '8994123456789' and found_batch = 'A7' and attempt_no = 1
     and checker_name = 'Sari' and expected_qty = 24 from pick_audits where task_id = pg_temp.task('1', 2) order by attempt_no desc limit 1));

select pg_temp.check('a passed line cannot be audited again (without p_correct)',
  pg_temp.fails(format($q$select record_move_audit(%L, 'Sari', '550044709', 20, 'A7', null, false, null)$q$, pg_temp.task('1', 2)),
    'Baris ini sudah lolos audit%'));

-- ---- B2. record_move_audit p_correct coverage ----------------------------------------
-- Supervisor correction over OK should succeed (p_correct=true)
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select pg_temp.check('supervisor can correct OK with p_correct=true and note',
  record_move_audit(pg_temp.task('1', 2), 'Sari', '550044709', 24, 'A7', null, false, 'salah klik, jumlah tetap 24', true)->>'attempt' = '2');

select pg_temp.check('correction attempt is OK and flagged correction=true',
  (select result = 'OK' and correction = true and attempt_no = 2 from pick_audits where task_id = pg_temp.task('1', 2) and attempt_no = 2));

-- Operator correction refused
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select pg_temp.check('operator correction refused (not supervisor/admin)',
  pg_temp.fails(format($q$select record_move_audit(%L, 'Sari', '550044709', 20, 'A7', null, false, 'salah klik', true)$q$, pg_temp.task('1', 2)),
    'Hanya supervisor atau admin%'));

-- Supervisor correction without note refused
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select pg_temp.check('supervisor correction without note refused',
  pg_temp.fails(format($q$select record_move_audit(%L, 'Sari', '550044709', 20, 'A7', null, false, '', true)$q$, pg_temp.task('1', 2)),
    'Alasan ubah wajib diisi di catatan%'));

-- Normal flow: prev-OK refusal still enforced without p_correct
select pg_temp.check('normal flow still refuses re-audit of OK without p_correct',
  pg_temp.fails(format($q$select record_move_audit(%L, 'Sari', '550044709', 20, 'A7', null, false, null)$q$, pg_temp.task('1', 2)),
    'Baris ini sudah lolos audit%'));

-- ---- C. record_move_audit MISMATCH paths (use task 4) ---------------------------------
select pg_temp.check('count 20 of 24 -> MISMATCH SHORT',
  (select r->>'result' = 'MISMATCH' and r->'errors' = '["SHORT"]'::jsonb and (r->'expected'->>'qty')::numeric = 24
   from (select record_move_audit(pg_temp.task('1', 4), 'Sari', '550044709', 20, 'A7', null, false, null) r) x));

-- Re-audit after floor fix
select pg_temp.check('re-audit after floor fix: other batch -> attempt 2, WRONG_BATCH',
  (select r->>'attempt' = '2' and r->'errors' = '["WRONG_BATCH"]'::jsonb
   from (select record_move_audit(pg_temp.task('1', 4), 'Sari', '550044709', 24, 'B8', null, false, 'palet isi B8') r) x));

select pg_temp.check('wrong item on the pallet -> WRONG_SKU only',
  record_move_audit(pg_temp.task('1', 4), 'Sari', '550024919', 24, 'C1', null, false, null)->'errors' = '["WRONG_SKU"]'::jsonb);

select pg_temp.check('damaged cartons -> DAMAGED',
  record_move_audit(pg_temp.task('1', 4), 'Sari', '550044709', 24, 'A7', null, true, 'karton penyok')->'errors' = '["DAMAGED"]'::jsonb);

-- ---- D. Resolve mismatch is now REFUSED for move audits -----------------------------
-- Create a mismatch audit for task 5 (WRONG_BATCH)
select record_move_audit(pg_temp.task('1', 5), 'Sari', '550044709', 24, 'B8', null, false, 'palet isi B8');
select set_config('t.move_5_1', (select id::text from pick_audits where task_id = pg_temp.task('1', 5) and attempt_no = 1), false);

select pg_temp.check('resolve_pick_mismatch REFUSES move audit (task_type=REPLENISH)',
  pg_temp.fails(format($q$select resolve_pick_mismatch(%L, 'ACCEPT_BATCH', 'Pak Joko', 'ok', 'CF38C01')$q$, current_setting('t.move_5_1')),
    'Baris ini pindahan bin: tidak bisa diputuskan di sini%'));

-- Sanity: the resolver still decides PICK audits (the PICK-only guard must not break picks)
select record_pick_audit(pg_temp.pick_task('1', 1), 'Sari', '550044709', 9, 'A7', null, false, 'kurang 1 karton');
select set_config('t.pick_1_1', (select id::text from pick_audits where task_id = pg_temp.pick_task('1', 1) and attempt_no = 1), false);
select resolve_pick_mismatch(current_setting('t.pick_1_1')::uuid, 'ACCEPT_SHORT', 'Pak Joko', 'kurang 1 karton, diterima');
select pg_temp.check('resolve_pick_mismatch still decides PICK audits',
  (select resolution = 'ACCEPT_SHORT' and resolved_by_name = 'Pak Joko'
     from pick_audits where id = current_setting('t.pick_1_1')::uuid));

-- ---- E. No shipment_loads gate: moves stay auditable after loading -------
-- Wave 2 replenish was already created and posted in the initial plan
-- It should be auditable regardless of wave 1's loading status

select pg_temp.check('wave 2 replenish is TODO and auditable',
  (select line_state = 'TODO' and attempts = 0 from pick_audit_move
   where task_id = pg_temp.task('2', 1)));

select pg_temp.check('record_move_audit works for wave 2 replenish (no load gate)',
  record_move_audit(pg_temp.task('2', 1), 'Sari', '550044709', 12, 'A7', null, false, null)->>'result' = 'OK');

-- ---- F. Attempt numbering ------------------------------------------------
select pg_temp.check('first attempt is 1, second is 2',
  (select attempt_no = 1 from pick_audits where task_id = pg_temp.task('1', 2) and attempt_no = 1) and
  (select attempt_no = 2 from pick_audits where task_id = pg_temp.task('1', 4) and attempt_no = 2));

-- ---- G. Role gate ---------------------------------------------------------
set role anon;
select pg_temp.check('anon cannot execute record_move_audit',
  pg_temp.fails('select record_move_audit(gen_random_uuid(), ''X'', ''550044709'', 1, ''A7'', null, false, null)',
    '%permission denied%'));

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select pg_temp.check('operator can execute record_move_audit (task 5 still open for audit)',
  record_move_audit(pg_temp.task('1', 5), 'Sari', '550044709', 1, 'A7', null, false, null) is not null);

rollback;