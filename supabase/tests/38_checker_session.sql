-- Checker session (0066). Runs in a transaction and rolls back.
-- Run with scripts/sql-test.sh. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users values
  ('11111111-1111-1111-1111-111111111111','picker@x','{"name":"Picker Satu"}'),
  ('22222222-2222-2222-2222-222222222222','checker@x','{"name":"Checker Dua"}'),
  ('33333333-3333-3333-3333-333333333333','sup@x','{"name":"Supervisor Tiga"}'),
  ('44444444-4444-4444-4444-444444444444','other@x','{"name":"Operator Empat"}') on conflict do nothing;
insert into profiles (id, name, role) values
  ('11111111-1111-1111-1111-111111111111','Picker Satu','operator'),
  ('22222222-2222-2222-2222-222222222222','Checker Dua','operator'),
  ('33333333-3333-3333-3333-333333333333','Supervisor Tiga','supervisor'),
  ('44444444-4444-4444-4444-444444444444','Operator Empat','operator') on conflict (id) do update set role=excluded.role, name=excluded.name;

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when coalesce(ok, false) then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.fails(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then
  if sqlerrm not like p_like then raise notice 'got: %', sqlerrm; end if;
  return sqlerrm like p_like; end $$;
create or replace function pg_temp.wave(p_no text) returns uuid language sql as $$
  select id from waves where planned_date = '2026-11-10' and wave_no = p_no $$;
create or replace function pg_temp.task(p_ship text, p_seq int) returns uuid language sql as $$
  select t.id from pick_tasks t join waves w on w.id = t.wave_id
  where w.planned_date = '2026-11-10' and t.shipment_number = p_ship and t.seq = p_seq $$;
create or replace function pg_temp.line(p_ship text, p_seq int) returns pick_audit_line language sql as $$
  select * from pick_audit_line where task_id = pg_temp.task(p_ship, p_seq) $$;
create or replace function pg_temp.claim(p_wave text, p_ship text, p_name text) returns uuid language sql as $$
  select (public.check_claim(pg_temp.wave(p_wave), p_ship, p_name)->>'session_id')::uuid $$;
create or replace function pg_temp.outcome(p_session uuid, p_code text) returns text language sql as $$
  select public.check_scan(p_session, p_code)->>'outcome' $$;
create or replace function pg_temp.attempts(p_ship text, p_seq int) returns int language sql as $$
  select count(*)::int from pick_audits where task_id = pg_temp.task(p_ship, p_seq) $$;

-- Fixture: barcode for 550044709; stock A7 in CF38C01 and C1 in CF37C01.
update items set ean = '8994123456789' where sku = '550044709';
delete from inventory where bin_id in (select id from bins where bin_code in ('CF38C01', 'CF37C01'));
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
select 'adjustment', (select id from items where sku = s), bt, q, (select id from bins where bin_code = b), e::date, 'fixture'
from (values ('CF38C01', '550044709', 'A7', 60, '2031-05-05'), ('CF37C01', '550024919', 'C1', 40, '2031-07-07')) v(b, s, bt, q, e);

set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select save_plan('2026-11-10', '{
  "waves":[{"wave_no":"1","shipment_numbers":["CK1","CK2","CK3","CK4","CK5"]},
           {"wave_no":"2","shipment_numbers":["CK6"]},
           {"wave_no":"3","shipment_numbers":["CK7"]}],
  "tasks":[
    {"wave_no":"1","shipment_number":"CK1","task_type":"PICK","sku":"550044709","from_bin":"CF38C01","batch_lot":"A7","expiry_date":"2031-05-05","quantity":5,"seq":1},
    {"wave_no":"1","shipment_number":"CK2","task_type":"PICK","sku":"550044709","from_bin":"CF38C01","batch_lot":"A7","expiry_date":"2031-05-05","quantity":3,"seq":1},
    {"wave_no":"1","shipment_number":"CK3","task_type":"PICK","sku":"550024919","from_bin":"CF37C01","batch_lot":"C1","expiry_date":"2031-07-07","quantity":2,"seq":1},
    {"wave_no":"1","shipment_number":"CK4","task_type":"PICK","sku":"550024919","from_bin":"CF37C01","batch_lot":"C1","expiry_date":"2031-07-07","quantity":2,"seq":1},
    {"wave_no":"1","shipment_number":"CK5","task_type":"PICK","sku":"550044709","from_bin":"CF38C01","batch_lot":"A7","expiry_date":"2031-05-05","quantity":4,"seq":1},
    {"wave_no":"2","shipment_number":"CK6","task_type":"PICK","sku":"550024919","from_bin":"CF37C01","batch_lot":"C1","expiry_date":"2031-07-07","quantity":2,"seq":1},
    {"wave_no":"3","shipment_number":"CK7","task_type":"PICK","sku":"550044709","from_bin":"CF38C01","batch_lot":"A7","expiry_date":"2031-05-05","quantity":1,"seq":1}],
  "outbound":[
    {"wave_no":"1","shipment_number":"CK1","sku":"550044709","quantity_requested":5,"quantity_allocated":5},
    {"wave_no":"1","shipment_number":"CK2","sku":"550044709","quantity_requested":3,"quantity_allocated":3},
    {"wave_no":"1","shipment_number":"CK3","sku":"550024919","quantity_requested":2,"quantity_allocated":2},
    {"wave_no":"1","shipment_number":"CK4","sku":"550024919","quantity_requested":2,"quantity_allocated":2},
    {"wave_no":"1","shipment_number":"CK5","sku":"550044709","quantity_requested":4,"quantity_allocated":4},
    {"wave_no":"2","shipment_number":"CK6","sku":"550024919","quantity_requested":2,"quantity_allocated":2},
    {"wave_no":"3","shipment_number":"CK7","sku":"550044709","quantity_requested":1,"quantity_allocated":1}]}'::jsonb);

-- Picker completes CK1..CK5 with what was really taken (CK1 is 4 of 5).
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select post_task_by(pg_temp.task('CK1', 1), 4, null, null, null, 'kurang', 'Picker Satu', null);
select post_task_by(pg_temp.task('CK2', 1), 3, null, null, null, null, 'Picker Satu', null);
select post_task_by(pg_temp.task('CK3', 1), 2, null, null, null, null, 'Picker Satu', null);
select post_task_by(pg_temp.task('CK4', 1), 2, null, null, null, null, 'Picker Satu', null);
select post_task_by(pg_temp.task('CK5', 1), 4, null, null, null, null, 'Picker Satu', null);
-- CK7's wave is cancelled; CK6 stays PICKING.
reset role;
update waves set status = 'CANCELLED' where id = pg_temp.wave('3');
set role authenticated;

select pg_temp.check('baseline: CK1 picked 4 of planned 5',
  (select picked_qty = 4 and planned_qty = 5 from pg_temp.line('CK1', 1)));

-- ==== A. claim, outcomes, baseline, finish, idempotency ==================
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select set_config('t.s1', pg_temp.claim('1', 'CK1', 'Checker Dua')::text, false);
select pg_temp.check('claim opens a session with the typed checker name',
  (select status = 'open' and checker_name = 'Checker Dua' from check_sessions where id = current_setting('t.s1')::uuid));
select pg_temp.check('claim lock is per wave+shipment, not per account',
  (select checker_id = '22222222-2222-2222-2222-222222222222' from check_sessions where id = current_setting('t.s1')::uuid));
select pg_temp.outcome(current_setting('t.s1')::uuid, '550044709');
select pg_temp.outcome(current_setting('t.s1')::uuid, '550044709');
select pg_temp.outcome(current_setting('t.s1')::uuid, '550044709');
select pg_temp.check('4th scan accepted (baseline is picked 4)', pg_temp.outcome(current_setting('t.s1')::uuid, '550044709') = 'ACCEPTED');
select pg_temp.check('5th scan OVER_SCAN, no number in the outcome', pg_temp.outcome(current_setting('t.s1')::uuid, '550044709') = 'OVER_SCAN');
select pg_temp.check('unknown barcode outcome', pg_temp.outcome(current_setting('t.s1')::uuid, '0000000000000') = 'UNKNOWN_BARCODE');
select pg_temp.check('wrong item (SKU not on this shipment)', pg_temp.outcome(current_setting('t.s1')::uuid, '550024919') = 'WRONG_ITEM');
select pg_temp.check('scans are recorded against the account from auth.uid()',
  (select count(*) > 0 from check_scans where session_id = current_setting('t.s1')::uuid and user_id = '22222222-2222-2222-2222-222222222222'));
select set_config('app.by_name', '', true);
select set_config('app.adjust_reason', '', true);
select public.check_finish(current_setting('t.s1')::uuid, 'SEAL-1');
select pg_temp.check('finish passed and kept the seal',
  (select status = 'passed' and seal_number = 'SEAL-1' from check_sessions where id = current_setting('t.s1')::uuid));
select pg_temp.check('finish drove record_pick_audit once (attempt 1 OK)',
  pg_temp.attempts('CK1', 1) = 1 and (select result = 'OK' from pick_audits where task_id = pg_temp.task('CK1', 1)));
select pg_temp.check('finish reports the refused over-scan',
  (public.check_finish(current_setting('t.s1')::uuid))->'over_scans' @> '[{"sku":"550044709","n":1}]'::jsonb);
select pg_temp.check('finish counts wrong-item and unknown scans',
  (public.check_finish(current_setting('t.s1')::uuid))->>'wrong_items' = '1'
  and (public.check_finish(current_setting('t.s1')::uuid))->>'unknown_barcodes' = '1');
select pg_temp.check('finish is idempotent (no second audit)',
  (public.check_finish(current_setting('t.s1')::uuid))->>'already' = 'true' and pg_temp.attempts('CK1', 1) = 1);
select pg_temp.check('check RPCs leave no app.* session state',
  coalesce(current_setting('app.by_name', true), '') = '' and coalesce(current_setting('app.adjust_reason', true), '') = '');

-- ==== B. second checker blocked; no direct writes; concurrent insert ====
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select set_config('t.s2', pg_temp.claim('1', 'CK2', 'Checker Dua')::text, false);
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
select pg_temp.check('another checker is blocked while claimed',
  pg_temp.fails($q$select check_claim(pg_temp.wave('1'), 'CK2', 'Operator Empat')$q$, 'Shipment CK2 sedang diperiksa%'));
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select pg_temp.check('the same checker name resumes its own session',
  (public.check_claim(pg_temp.wave('1'), 'CK2', 'checker  dua')->>'resumed') = 'true'
  and (public.check_claim(pg_temp.wave('1'), 'CK2', 'Checker Dua')->>'session_id') = current_setting('t.s2'));
select pg_temp.check('no direct writes to check_sessions',
  pg_temp.fails($q$insert into check_sessions (wave_id, shipment_number, checker_name) values (pg_temp.wave('1'), 'ZZ', 'X')$q$, '%row-level security%'));
select pg_temp.check('no direct writes to check_scans',
  pg_temp.fails($q$insert into check_scans (session_id, barcode_raw, outcome) values (current_setting('t.s2')::uuid, 'X', 'ACCEPTED')$q$, '%row-level security%'));
reset role;
select pg_temp.check('the one-open-session index is the real lock (concurrent insert refused)',
  pg_temp.fails($q$insert into check_sessions (wave_id, shipment_number, checker_name) values (pg_temp.wave('1'), 'CK2', 'X')$q$, '%check_sessions_open_uq%'));
set role authenticated;

-- ==== B2. client_scan_id idempotency =====================================
select set_config('t.cid', gen_random_uuid()::text, false);
select pg_temp.check('scan with a client id is accepted',
  public.check_scan(current_setting('t.s2')::uuid, '550044709', current_setting('t.cid')::uuid)->>'outcome' = 'ACCEPTED');
select pg_temp.check('a repeated client id replays and counts nothing',
  public.check_scan(current_setting('t.s2')::uuid, '550044709', current_setting('t.cid')::uuid)->>'replayed' = 'true'
  and (select count(*) from check_scans where session_id = current_setting('t.s2')::uuid and client_scan_id = current_setting('t.cid')::uuid) = 1
  and (select count(*) from check_scans where session_id = current_setting('t.s2')::uuid and outcome = 'ACCEPTED') = 1);

-- ==== C. release then reclaim starts at zero ============================
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select set_config('t.s3', pg_temp.claim('1', 'CK3', 'Checker Dua')::text, false);
select pg_temp.outcome(current_setting('t.s3')::uuid, '550024919');
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
select pg_temp.check('an operator cannot release a claim',
  pg_temp.fails($q$select check_release(current_setting('t.s3')::uuid, 'x')$q$, 'Hanya supervisor%'));
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select check_release(current_setting('t.s3')::uuid, 'salah orang');
select pg_temp.check('release closes the session as released',
  (select status = 'released' and released_by = '33333333-3333-3333-3333-333333333333' from check_sessions where id = current_setting('t.s3')::uuid));
select pg_temp.check('a released session cannot be scanned',
  pg_temp.fails(format($q$select check_scan(%L, '550024919')$q$, current_setting('t.s3')::uuid), 'Sesi check sudah selesai%'));
select pg_temp.check('finish on a released session is a no-op',
  public.check_finish(current_setting('t.s3')::uuid)->>'status' = 'released'
  and public.check_finish(current_setting('t.s3')::uuid)->>'already' = 'true'
  and pg_temp.attempts('CK3', 1) = 0);
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select set_config('t.s3b', pg_temp.claim('1', 'CK3', 'Checker Dua')::text, false);
select pg_temp.check('reclaim is a new session starting at zero',
  current_setting('t.s3b') <> current_setting('t.s3')
  and (select count(*) = 0 from check_scans where session_id = current_setting('t.s3b')::uuid));
select pg_temp.check('scans from the released session never count',
  pg_temp.outcome(current_setting('t.s3b')::uuid, '550024919') = 'ACCEPTED'
  and pg_temp.outcome(current_setting('t.s3b')::uuid, '550024919') = 'ACCEPTED');
select public.check_finish(current_setting('t.s3b')::uuid);
select pg_temp.check('reclaimed session passes',
  (select status = 'passed' from check_sessions where id = current_setting('t.s3b')::uuid));

-- ==== D. a MISMATCH is re-audited as a new attempt =======================
select set_config('t.s4', pg_temp.claim('1', 'CK4', 'Checker Dua')::text, false);
select pg_temp.outcome(current_setting('t.s4')::uuid, '550024919');  -- 1 of 2
select public.check_finish(current_setting('t.s4')::uuid);
select pg_temp.check('session 1 ends exception (short, 1 of 2)',
  (select status = 'exception' from check_sessions where id = current_setting('t.s4')::uuid)
  and pg_temp.attempts('CK4', 1) = 1 and (select result = 'MISMATCH' and errors = '{SHORT}' from pick_audits where task_id = pg_temp.task('CK4', 1)));
select set_config('t.s4b', pg_temp.claim('1', 'CK4', 'Checker Dua')::text, false);
select pg_temp.outcome(current_setting('t.s4b')::uuid, '550024919');
select pg_temp.outcome(current_setting('t.s4b')::uuid, '550024919');
select public.check_finish(current_setting('t.s4b')::uuid);
select pg_temp.check('session 2 re-audits MISMATCH as attempt 2 (OK)',
  pg_temp.attempts('CK4', 1) = 2
  and (select result = 'OK' and attempt_no = 2 from pick_audits where task_id = pg_temp.task('CK4', 1) order by attempt_no desc limit 1)
  and (select status = 'passed' from check_sessions where id = current_setting('t.s4b')::uuid));

-- ==== E. resolve_pick_mismatch on a check_finish attempt, then load ======
select set_config('t.s5', pg_temp.claim('1', 'CK5', 'Checker Dua')::text, false);
select pg_temp.outcome(current_setting('t.s5')::uuid, '550044709');  -- 1 of 4
select pg_temp.outcome(current_setting('t.s5')::uuid, '550044709');  -- 2
select pg_temp.outcome(current_setting('t.s5')::uuid, '550044709');  -- 3
select public.check_finish(current_setting('t.s5')::uuid);
select pg_temp.check('CK5 check_finish made a SHORT mismatch',
  (select status = 'exception' from check_sessions where id = current_setting('t.s5')::uuid)
  and (select result = 'MISMATCH' and errors = '{SHORT}' from pick_audits where task_id = pg_temp.task('CK5', 1) order by attempt_no desc limit 1));
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select resolve_pick_mismatch((select id from pick_audits where task_id = pg_temp.task('CK5', 1) order by attempt_no desc limit 1),
                             'ACCEPT_SHORT', 'Supervisor Tiga', 'kurang 1 karton', null);
select pg_temp.check('supervisor ACCEPT_SHORT resolves the finish attempt',
  (select line_state = 'RESOLVED' from pg_temp.line('CK5', 1)));
select pg_temp.check('mark_shipment_loaded then passes',
  mark_shipment_loaded(pg_temp.wave('1'), 'CK5', 'Loader Lima', 'L 1')->>'result' = 'LOADED');
select pg_temp.check('a loaded shipment cannot be claimed',
  pg_temp.fails($q$select check_claim(pg_temp.wave('1'), 'CK5', 'Checker Dua')$q$, 'Shipment CK5 sudah dimuat%'));

-- ==== F. claim refusals (messages match record_pick_audit) ===============
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select pg_temp.check('a shipment still PICKING is refused',
  pg_temp.fails($q$select check_claim(pg_temp.wave('2'), 'CK6', 'Checker Dua')$q$, 'Tugas pick belum selesai atau tidak ditemukan'));
select pg_temp.check('a cancelled wave is refused',
  pg_temp.fails($q$select check_claim(pg_temp.wave('3'), 'CK7', 'Checker Dua')$q$, 'Wave dibatalkan: shipment CK7 tidak diperiksa%'));
select pg_temp.check('the picker cannot check own line',
  pg_temp.fails($q$select check_claim(pg_temp.wave('1'), 'CK1', 'picker  satu')$q$, 'Checker tidak boleh picker%'));

-- ==== G. anon denied; view exposes no quantities =========================
reset role;
select pg_temp.check('anon denied check_claim/scan/finish/release',
  not has_function_privilege('anon','public.check_claim(uuid,text,text)','EXECUTE')
  and   not has_function_privilege('anon','public.check_scan(uuid,text,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.check_finish(uuid,text)','EXECUTE')
  and not has_function_privilege('anon','public.check_release(uuid,text)','EXECUTE'));
select pg_temp.check('anon denied the check tables and view',
  not has_table_privilege('anon','public.check_sessions','SELECT')
  and not has_table_privilege('anon','public.check_scans','SELECT')
  and not has_table_privilege('anon','public.check_shipment','SELECT'));
select pg_temp.check('check_shipment exposes no required/picked quantity',
  not exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='check_shipment'
                and (column_name ilike '%qty%' or column_name ilike '%quantit%' or column_name in ('required','picked'))));
rollback;
