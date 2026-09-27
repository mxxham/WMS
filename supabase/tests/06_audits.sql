-- Picking audit & putaway audit (0012). Runs in a transaction and rolls back.
-- Run after 00 stub, migrations, seed. Every line prints PASS/FAIL.
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
begin execute p_sql; return false; exception when others then return sqlerrm like p_like; end $$;

-- Fixture: A7 x48 in CF38C01 (via putaway from STAGING), one pick plan of 20.
delete from inventory where bin_id in (select id from bins where bin_code in ('CF38C01','STAGING'))
  and item_id = (select id from items where sku='550044709');
insert into movements (type,item_id,batch_lot,quantity,to_bin_id,expiry_date,note)
values ('adjustment', (select id from items where sku='550044709'), 'A7', 48, (select id from bins where bin_code='STAGING'), '2031-05-05', 'fixture');
insert into movements (type,item_id,batch_lot,quantity,from_bin_id,to_bin_id,expiry_date,note)
values ('putaway', (select id from items where sku='550044709'), 'A7', 48, (select id from bins where bin_code='STAGING'),
        (select id from bins where bin_code='CF38C01'), '2031-05-05', 'audit fixture');
select set_config('t.mv', (select id::text from movements where note='audit fixture'), false);

set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select save_plan('2026-10-05', '{
  "waves":[{"wave_no":"1","shipment_numbers":["AU1"]}],
  "tasks":[{"wave_no":"1","shipment_number":"AU1","task_type":"PICK","sku":"550044709","from_bin":"CF38C01","batch_lot":"A7","expiry_date":"2031-05-05","quantity":20,"seq":1}],
  "outbound":[{"wave_no":"1","shipment_number":"AU1","sku":"550044709","quantity_requested":20,"quantity_allocated":20}]}'::jsonb);
select set_config('t.task', (select t.id::text from pick_tasks t join waves w on w.id=t.wave_id where w.planned_date='2026-10-05' and t.shipment_number='AU1'), false);

-- Pick audit
select pg_temp.check('a pick that is not completed cannot be audited',
  pg_temp.fails(format($q$select record_audit('PICK', %L, 20, true, true, null)$q$, current_setting('t.task')), 'Tugas pick belum selesai%'));
select post_task(current_setting('t.task')::uuid, 18, null, null, null, 'karton rusak');
select pg_temp.check('completed pick shows in pick_audit_detail, not yet audited',
  (select audit_id is null and actual_quantity = 18 from pick_audit_detail where task_id = current_setting('t.task')::uuid));
select pg_temp.check('matches what the picker reported (18, not the plan 20) -> OK',
  record_audit('PICK', current_setting('t.task')::uuid, 18, true, true, null)->>'result' = 'OK');
select pg_temp.check('a mismatch needs a note',
  pg_temp.fails(format($q$select record_audit('PICK', %L, 17, true, true, '')$q$, current_setting('t.task')), 'Ada selisih%'));
select pg_temp.check('re-audit with a wrong batch -> MISMATCH',
  record_audit('PICK', current_setting('t.task')::uuid, 18, true, false, 'batch lain di palet')->>'result' = 'MISMATCH');
select pg_temp.check('one audit per task; the earlier OK is kept in history',
  (select count(*) = 1 and bool_and(result = 'MISMATCH' and history->0->>'result' = 'OK') from audits where task_id = current_setting('t.task')::uuid));

-- Putaway audit
select pg_temp.check('putaway shows in putaway_audit_detail',
  (select to_bin = 'CF38C01' and quantity = 48 from putaway_audit_detail where movement_id = current_setting('t.mv')::uuid));
select pg_temp.check('putaway counted short -> MISMATCH',
  record_audit('PUTAWAY', current_setting('t.mv')::uuid, 46, true, true, 'kurang 2')->>'result' = 'MISMATCH');
select pg_temp.check('an audit never changes stock (CF38C01 still 48 - 18 picked = 30)',
  (select quantity = 30 from inventory_detail where bin_code = 'CF38C01' and batch_lot = 'A7'));
select pg_temp.check('an adjustment movement cannot be audited as a putaway',
  pg_temp.fails(format($q$select record_audit('PUTAWAY', %L, 1, true, true, null)$q$,
    (select id::text from movements where note = 'fixture' and batch_lot = 'A7')), 'Mutasi putaway tidak ditemukan%'));

-- Roles and direct writes
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select pg_temp.check('operator cannot audit',
  pg_temp.fails(format($q$select record_audit('PUTAWAY', %L, 48, true, true, null)$q$, current_setting('t.mv')), 'Hanya supervisor%'));
-- Refused outright (no grant), or silently a no-op (no RLS write policy).
do $$ begin update audits set result = 'OK' where movement_id = current_setting('t.mv')::uuid;
exception when insufficient_privilege then null; end $$;
select pg_temp.check('no direct writes to audits',
  (select result = 'MISMATCH' from audits where movement_id = current_setting('t.mv')::uuid));

rollback;
