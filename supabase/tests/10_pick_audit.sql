-- Picking audit (0024). Runs in a transaction and rolls back.
-- Run with scripts/sql-test.sh. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users values ('11111111-1111-1111-1111-111111111111','op@x','{"name":"Operator"}'),
                              ('22222222-2222-2222-2222-222222222222','sup@x','{"name":"Supervisor"}') on conflict do nothing;
update profiles set role='supervisor' where id='22222222-2222-2222-2222-222222222222';

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.fails(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then
  if sqlerrm not like p_like then raise notice 'got: %', sqlerrm; end if;
  return sqlerrm like p_like; end $$;
create or replace function pg_temp.task(p_ship text, p_seq int) returns uuid language sql as $$
  select t.id from pick_tasks t join waves w on w.id = t.wave_id
  where w.planned_date = '2026-10-06' and t.shipment_number = p_ship and t.seq = p_seq $$;
create or replace function pg_temp.wave(p_no text) returns uuid language sql as $$
  select id from waves where planned_date = '2026-10-06' and wave_no = p_no $$;
create or replace function pg_temp.qty(p_bin text, p_batch text) returns numeric language sql as $$
  select coalesce(sum(i.quantity), 0) from inventory i join bins b on b.id = i.bin_id
  where b.bin_code = p_bin and i.batch_lot = p_batch $$;
create or replace function pg_temp.line(p_ship text, p_seq int) returns pick_audit_line language sql as $$
  select * from pick_audit_line where task_id = pg_temp.task(p_ship, p_seq) $$;
create or replace function pg_temp.ship(p_ship text) returns pick_audit_shipment language sql as $$
  select * from pick_audit_shipment where planned_date = '2026-10-06' and shipment_number = p_ship $$;

-- Fixture: carton barcode for 550044709; A7 x48 in CF38C01, B8 x10 in CF38C02, C1 x30 (550024919) in CF37C01.
update items set ean = '8994123456789' where sku = '550044709';
delete from inventory where bin_id in (select id from bins where bin_code in ('CF38C01', 'CF38C02', 'CF37C01'));
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
select 'adjustment', (select id from items where sku = s), bt, q, (select id from bins where bin_code = b), e::date, 'fixture'
from (values ('CF38C01', '550044709', 'A7', 48, '2031-05-05'), ('CF38C02', '550044709', 'B8', 10, '2031-06-06'),
             ('CF37C01', '550024919', 'C1', 30, '2031-07-07')) v(b, s, bt, q, e);

set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select save_plan('2026-10-06', '{
  "waves":[{"wave_no":"1","shipment_numbers":["PA1","PA2","PA4","PA5"]},{"wave_no":"2","shipment_numbers":["PA3"]}],
  "tasks":[
    {"wave_no":"1","shipment_number":"PA1","task_type":"PICK","sku":"550044709","from_bin":"CF38C01","batch_lot":"A7","expiry_date":"2031-05-05","quantity":10,"seq":1},
    {"wave_no":"1","shipment_number":"PA1","task_type":"PICK","sku":"550024919","from_bin":"CF37C01","batch_lot":"C1","expiry_date":"2031-07-07","quantity":5,"seq":2},
    {"wave_no":"1","shipment_number":"PA2","task_type":"PICK","sku":"550044709","from_bin":"CF38C01","batch_lot":"A7","expiry_date":"2031-05-05","quantity":6,"seq":3},
    {"wave_no":"1","shipment_number":"PA4","task_type":"PICK","sku":"550024919","from_bin":"CF37C01","batch_lot":"C1","expiry_date":"2031-07-07","quantity":2,"seq":4},
    {"wave_no":"1","shipment_number":"PA1","task_type":"PICK","sku":"550024919","from_bin":"CF37C01","batch_lot":"C1","expiry_date":"2031-07-07","quantity":3,"seq":5},
    {"wave_no":"1","shipment_number":"PA5","task_type":"PICK","sku":"550024919","from_bin":"CF37C01","batch_lot":"C1","expiry_date":"2031-07-07","quantity":2,"seq":6},
    {"wave_no":"2","shipment_number":"PA3","task_type":"PICK","sku":"550044709","from_bin":"CF38C01","batch_lot":"A7","expiry_date":"2031-05-05","quantity":4,"seq":1}],
  "outbound":[
    {"wave_no":"1","shipment_number":"PA1","sku":"550044709","quantity_requested":10,"quantity_allocated":10},
    {"wave_no":"1","shipment_number":"PA1","sku":"550024919","quantity_requested":8,"quantity_allocated":8},
    {"wave_no":"1","shipment_number":"PA2","sku":"550044709","quantity_requested":6,"quantity_allocated":6},
    {"wave_no":"1","shipment_number":"PA4","sku":"550024919","quantity_requested":2,"quantity_allocated":2},
    {"wave_no":"1","shipment_number":"PA5","sku":"550024919","quantity_requested":2,"quantity_allocated":2},
    {"wave_no":"2","shipment_number":"PA3","sku":"550044709","quantity_requested":4,"quantity_allocated":4}]}'::jsonb);

-- ---- A. Error rule, who picked, views ------------------------------------
select pg_temp.check('errors: batch compare ignores case and spaces',
  pick_audit_errors('S', 'A7', '2031-05-05', 10, 'S', ' a7 ', null, 10, false) = '{}');
select pg_temp.check('errors: short + batch + expiry + damaged in fixed order',
  pick_audit_errors('S', 'A7', '2031-05-05', 10, 'S', 'B8', '2031-06-06', 8, true) = '{SHORT,WRONG_BATCH,WRONG_EXPIRY,DAMAGED}');
select pg_temp.check('errors: over',
  pick_audit_errors('S', 'A7', null, 10, 'S', 'A7', null, 11, false) = '{OVER}');
select pg_temp.check('errors: wrong SKU compares nothing else',
  pick_audit_errors('S', 'A7', null, 10, 'T', 'ZZ', null, 3, false) = '{WRONG_SKU}');

set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select post_task_by(pg_temp.task('PA1', 1), p_by_name => 'Budi Santoso');
select post_task_by(pg_temp.task('PA1', 2), 4, null, null, null, 'karton kurang', 'Budi Santoso', null);
select post_task_by(pg_temp.task('PA1', 5), 0, null, null, null, 'stok tidak ada', 'Budi Santoso', null);
select post_task_by(pg_temp.task('PA2', 3), p_by_name => 'Budi Santoso', p_scanned => ' 8994123456789 ');
select post_task_by(pg_temp.task('PA5', 6), p_by_name => 'Budi Santoso');
select complete_wave_by(pg_temp.wave('2'), 'Rina');

select pg_temp.check('the picker''s typed name is kept on the task, not the shared account',
  (select picked_by_name = 'Budi Santoso' and scanned_code is null and not bulk_posted from pick_tasks where id = pg_temp.task('PA1', 1)));
select pg_temp.check('the scanned carton code is kept (spaces removed)',
  (select scanned_code = '8994123456789' and not bulk_posted from pick_tasks where id = pg_temp.task('PA2', 3)));
select pg_temp.check('a scan does not leak onto the next task of the same transaction',
  (select scanned_code is null from pick_tasks where id = pg_temp.task('PA5', 6)));
select pg_temp.check('bulk completion keeps the name and flags the line',
  (select picked_by_name = 'Rina' and bulk_posted from pick_tasks where id = pg_temp.task('PA3', 1)));
select pg_temp.check('line shows what the picker reported (4 of 5), not yet audited',
  (select picked_qty = 4 and planned_qty = 5 and line_state = 'TODO' and attempts = 0 from pg_temp.line('PA1', 2)));
select pg_temp.check('a line picked as 0 passes without audit',
  (select line_state = 'AUTO_PASS' from pg_temp.line('PA1', 5)));
select pg_temp.check('shipment states: PA1 ready to audit, PA4 still picking, PA3 ready to audit',
  (pg_temp.ship('PA1')).state = 'READY_AUDIT' and (pg_temp.ship('PA4')).state = 'PICKING' and (pg_temp.ship('PA3')).state = 'READY_AUDIT');
select pg_temp.check('policy has the pick accuracy target',
  (inventory_policy()->>'pick_accuracy_target_pct')::numeric = 99.5);
select pg_temp.check('no direct writes to pick_audits',
  pg_temp.fails(format($q$insert into pick_audits (task_id, attempt_no, checker_name, found_sku, counted_qty, expected_sku, expected_qty, result)
    values (%L, 1, 'X', '550044709', 10, '550044709', 10, 'OK')$q$, pg_temp.task('PA1', 1)), '%row-level security%'));

-- ---- B. record_pick_audit -------------------------------------------------
-- (session: operator; any staff may audit)
select pg_temp.check('a pick that is not completed cannot be audited',
  pg_temp.fails(format($q$select record_pick_audit(%L, 'Sari', '550024919', 2, 'C1', null, false, null)$q$, pg_temp.task('PA4', 4)),
    'Tugas pick belum selesai%'));
select pg_temp.check('a line picked as 0 is not audited',
  pg_temp.fails(format($q$select record_pick_audit(%L, 'Sari', '550024919', 0, 'C1', null, false, null)$q$, pg_temp.task('PA1', 5)),
    'Baris ini tidak dipick%'));
select pg_temp.check('the picker cannot audit own line (name compared ignoring case and spaces)',
  pg_temp.fails(format($q$select record_pick_audit(%L, 'budi  santoso', '550044709', 10, 'A7', null, false, null)$q$, pg_temp.task('PA1', 1)),
    'Checker tidak boleh picker%'));
select pg_temp.check('a checker name is required',
  pg_temp.fails(format($q$select record_pick_audit(%L, ' ', '550044709', 10, 'A7', null, false, null)$q$, pg_temp.task('PA1', 1)),
    'Nama checker wajib%'));
select pg_temp.check('an unknown carton code is refused',
  pg_temp.fails(format($q$select record_pick_audit(%L, 'Sari', '0000000000000', 10, 'A7', null, false, null)$q$, pg_temp.task('PA1', 1)),
    '%tidak dikenal%'));
select pg_temp.check('a negative count is refused',
  pg_temp.fails(format($q$select record_pick_audit(%L, 'Sari', '550044709', -1, 'A7', null, false, null)$q$, pg_temp.task('PA1', 1)),
    'Jumlah hitung tidak valid%'));

select pg_temp.check('carton EAN + batch typed " a7 " + full count -> OK',
  record_pick_audit(pg_temp.task('PA1', 1), 'Sari', '8994123456789', 10, ' a7 ', null, false, null)->>'result' = 'OK');
select pg_temp.check('the attempt keeps the scanned code and the SKU it resolved to',
  (select found_sku = '550044709' and found_scanned_code = '8994123456789' and found_batch = 'A7' and attempt_no = 1
     and checker_name = 'Sari' and expected_qty = 10 from pick_audits where task_id = pg_temp.task('PA1', 1)));
select pg_temp.check('a passed line cannot be audited again',
  pg_temp.fails(format($q$select record_pick_audit(%L, 'Sari', '550044709', 9, 'A7', null, false, null)$q$, pg_temp.task('PA1', 1)),
    'Baris ini sudah lolos audit%'));
select pg_temp.check('expected = what the picker reported (4), not the plan (5)',
  record_pick_audit(pg_temp.task('PA1', 2), 'Sari', '550024919', 4, 'C1', '2031-07-07', false, null)->>'result' = 'OK');

select pg_temp.check('count 5 of 6 -> MISMATCH SHORT; no note needed (blind)',
  (select r->>'result' = 'MISMATCH' and r->'errors' = '["SHORT"]'::jsonb and (r->'expected'->>'qty')::numeric = 6
   from (select record_pick_audit(pg_temp.task('PA2', 3), 'Sari', '550044709', 5, 'A7', null, false, null) r) x));
select pg_temp.check('re-audit after the floor fix: other batch -> attempt 2, WRONG_BATCH',
  (select r->>'attempt' = '2' and r->'errors' = '["WRONG_BATCH"]'::jsonb
   from (select record_pick_audit(pg_temp.task('PA2', 3), 'Sari', '550044709', 6, 'B8', null, false, 'palet isi B8') r) x));
select pg_temp.check('wrong item on the pallet -> WRONG_SKU only',
  record_pick_audit(pg_temp.task('PA3', 1), 'Sari', '550024919', 4, 'C1', null, false, null)->'errors' = '["WRONG_SKU"]'::jsonb);
select pg_temp.check('damaged cartons -> DAMAGED',
  record_pick_audit(pg_temp.task('PA3', 1), 'Sari', '550044709', 4, 'A7', null, true, 'karton penyok')->'errors' = '["DAMAGED"]'::jsonb);
select pg_temp.check('line shows the latest attempt; shipment states follow',
  (select line_state = 'MISMATCH' and attempts = 2 from pg_temp.line('PA2', 3))
  and (pg_temp.ship('PA1')).state = 'READY_LOAD' and (pg_temp.ship('PA2')).state = 'HAS_MISMATCH');

rollback;
