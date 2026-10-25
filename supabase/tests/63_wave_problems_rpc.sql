-- 0097: wave_problems() replaces the Wave page's three problem-panel reads
-- (pick_audit_shipment, task_shortfalls, task_waits) for one planned_date with
-- one response. Consistency: each `kind` of row must equal an independent
-- count/sum over the view it comes from, on the same day. Grants mirror the
-- 0071+ analytics RPCs; an empty day must return no rows, not an error.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;

-- ---- Scratch day ---------------------------------------------------------
-- A wave on a date no seed row can touch, with a pick whose bin holds nothing
-- (task_shortfalls), and a relocation into that same bin (task_waits) — so all
-- three branches of the union have at least one row and the equalities below
-- cannot pass vacuously.
insert into items (sku, description, uom)
values ('5500WPRB', 'Wave Problems Test', 'CAR')
on conflict (sku) do nothing;

insert into bins (bin_code, zone, rack, level, position)
values ('CA01A01', 'CA', '01', 'A', '01'),
       ('CA01A02', 'CA', '01', 'A', '02')
on conflict (bin_code) do nothing;

insert into waves (wave_no, planned_date, shipment_numbers, destination)
values ('T63WP', date '2031-04-05', array['SH-T63'], 'T63');

insert into pick_tasks (wave_id, shipment_number, task_type, item_id, from_bin_id, to_bin_id, batch_lot, expiry_date, quantity, seq, status)
select w.id, 'SH-T63', 'PICK', i.id, b.id, null, 'T63', date '2032-01-01', 10, 1, 'PLANNED'
from waves w, items i, bins b
where w.wave_no = 'T63WP' and i.sku = '5500WPRB' and b.bin_code = 'CA01A01';

insert into pick_tasks (wave_id, task_type, item_id, from_bin_id, to_bin_id, batch_lot, expiry_date, quantity, seq, status)
select w.id, 'REPLENISH', i.id, f.id, t.id, 'T63', date '2032-01-01', 5, 2, 'PLANNED'
from waves w, items i, bins f, bins t
where w.wave_no = 'T63WP' and i.sku = '5500WPRB' and f.bin_code = 'CA01A02' and t.bin_code = 'CA01A01';

-- ---- (a) content equals the views it is built from, on the same day -------
create or replace function pg_temp.manual(kind text, d date) returns bigint
language sql stable as $$
  select case kind
    when 'audit' then (select count(*) from public.pick_audit_shipment where planned_date = d)
    when 'short' then (select count(*) from public.task_shortfalls where planned_date = d)
    when 'wait'  then (select count(*) from public.task_waits where planned_date = d)
  end
$$;

select pg_temp.check('wave_problems audit rows match pick_audit_shipment for the day',
  (select count(*) from public.wave_problems(date '2031-04-05') where kind = 'audit') = pg_temp.manual('audit', date '2031-04-05'));
select pg_temp.check('wave_problems short rows match task_shortfalls for the day',
  (select count(*) from public.wave_problems(date '2031-04-05') where kind = 'short') = pg_temp.manual('short', date '2031-04-05'));
select pg_temp.check('wave_problems wait rows match task_waits for the day',
  (select count(*) from public.wave_problems(date '2031-04-05') where kind = 'wait') = pg_temp.manual('wait', date '2031-04-05'));
select pg_temp.check('wave_problems wait quantities sum to task_waits on the day',
  (select coalesce(sum(wait_qty), 0) from public.wave_problems(date '2031-04-05') where kind = 'wait')
  = (select coalesce(sum(wait_qty), 0) from public.task_waits where planned_date = date '2031-04-05'));

-- The rows are the displayed ones: the scratch day has a row of every kind.
select pg_temp.check('scratch day returns an audit, a short and a wait row',
  (select count(distinct kind) = 3 and count(*) >= 3 from public.wave_problems(date '2031-04-05')));

-- The audit branch still carries the shipment state the panel labels.
select pg_temp.check('audit row carries the shipment state of the view',
  (select state from public.wave_problems(date '2031-04-05') where kind = 'audit' and shipment_number = 'SH-T63')
  = (select state from public.pick_audit_shipment where planned_date = date '2031-04-05' and shipment_number = 'SH-T63'));

-- The wait branch still carries every field "Tunggu relokasi" renders.
select pg_temp.check('wait row carries the Bin To Bin it waits for',
  (select wait_from = 'CA01A02' and wait_to = 'CA01A01' and wait_qty = 5 and wait_have = 0
          and wait_seq = 2 and wait_wave_no = 'T63WP' and wait_wave_status = 'PENDING'
          and wait_task_id = (select id from public.pick_tasks where seq = 2 and wave_id = (select id from public.waves where wave_no = 'T63WP'))
     from public.wave_problems(date '2031-04-05') where kind = 'wait'
       and task_id = (select id from public.pick_tasks where seq = 1 and wave_id = (select id from public.waves where wave_no = 'T63WP'))));

-- The short branch lists exactly the tasks the view calls short.
select pg_temp.check('short rows are the task_shortfalls task ids',
  (select array_agg(task_id order by task_id) from public.wave_problems(date '2031-04-05') where kind = 'short')
  = (select array_agg(task_id order by task_id) from public.task_shortfalls where planned_date = date '2031-04-05'));

-- ---- (b) grants: signed-in roles may call, anon/public never -------------
select pg_temp.check('wave_problems executable by authenticated',
  has_function_privilege('authenticated', 'public.wave_problems(date)', 'execute'));
select pg_temp.check('wave_problems executable by service_role',
  has_function_privilege('service_role', 'public.wave_problems(date)', 'execute'));
select pg_temp.check('wave_problems NOT executable by anon',
  not has_function_privilege('anon', 'public.wave_problems(date)', 'execute'));

-- Called as a signed-in user the same day answers the same rows (security invoker).
insert into auth.users values ('33333333-3333-3333-3333-333333333333', 'sup63@x', '{"name":"Supervisor 63"}') on conflict do nothing;
set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select pg_temp.check('authenticated sees the scratch day through the RPC',
  (select count(distinct kind) = 3 from public.wave_problems(date '2031-04-05')));
reset role;

-- ---- (c) an empty day is no rows, not an error ---------------------------
select pg_temp.check('empty day returns no rows',
  not exists (select 1 from public.wave_problems(date '2099-12-31')));

rollback;
