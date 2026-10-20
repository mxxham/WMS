-- Putaway "Sheet benar": the bin is fixed on the Putaway page, and every sheet line is logged (0066).
-- Runs in a transaction and rolls back.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users values ('11111111-1111-1111-1111-111111111111','op@x','{"name":"Operator"}') on conflict do nothing;
update profiles set role = 'admin' where id = '11111111-1111-1111-1111-111111111111';
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.qty(p_bin text, p_sku text) returns numeric language sql as $$
  select coalesce(sum(v.quantity), 0) from inventory v join bins b on b.id = v.bin_id join items i on i.id = v.item_id
  where b.bin_code = p_bin and i.sku = p_sku $$;
-- The bins start empty, so the numbers are the 8 Oct incident's.
delete from inventory v using bins b where b.id = v.bin_id
  and b.bin_code in ('CA06C01','CA02D02','CB21A01','CC14A01','CD22A02','CE11A01','CE11A02');
insert into items (sku, description) values ('550056224', 'IAGO DEO 15W-40 CI4_1*209L_A423'), ('550024955', 'Corena S4 R 46_1*20L_A227')
on conflict (sku) do nothing;
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

-- 8 Oct as the system had it: 36 Helix in CA06C01 (really in CA02D02), 5 Corena in CB21A01 that are not
-- there, 94 in CC14A01 (the floor has 47), 10 in CD22A02 of which an open wave picks 8, 3 in CE11A01.
select import_snapshot('[
 {"bin_code":"CA06C01","zone":"CA","rack":"06","level":"C","position":"01","sku":"550038021","batch_lot":"TESTH","quantity":36,"expiry_date":"2030-10-01"},
 {"bin_code":"CB21A01","zone":"CB","rack":"21","level":"A","position":"01","sku":"550024955","batch_lot":"TESTC","quantity":5,"expiry_date":"2030-06-01"},
 {"bin_code":"CC14A01","zone":"CC","rack":"14","level":"A","position":"01","sku":"550074326","batch_lot":"TESTQ","quantity":94,"expiry_date":"2030-09-23"},
 {"bin_code":"CD22A02","zone":"CD","rack":"22","level":"A","position":"02","sku":"550054879","batch_lot":"TESTR","quantity":10,"expiry_date":"2030-07-01"},
 {"bin_code":"CE11A01","zone":"CE","rack":"11","level":"A","position":"01","sku":"550054879","batch_lot":"TESTS","quantity":3,"expiry_date":"2030-07-01"}]'::jsonb, false, 'uji') \g /dev/null
select save_plan('2026-11-01', '{
  "waves":[{"wave_no":"1","shipment_numbers":["SH1"],"planned_slot":"08:00"}],
  "tasks":[{"wave_no":"1","shipment_number":"SH1","task_type":"PICK","sku":"550054879","from_bin":"CD22A02","batch_lot":"TESTR","expiry_date":"2030-07-01","quantity":8,"pick_type":"CASE","seq":1}]}'::jsonb) \g /dev/null

create temp table sheet as select '[
 {"line":2,"bin_code":"CA06C01","sku":"550056224","batch_lot":"TESTD","expiry_date":"2030-05-29","quantity":4,"action":"fix",
  "fix":[{"sku":"550038021","batch_lot":"TESTH","expiry_date":"2030-10-01","quantity":36,"choice":"move","move_to":"CA02D02"}]},
 {"line":3,"bin_code":"CB21A01","sku":"550024955","batch_lot":"TESTN","expiry_date":"2030-06-15","quantity":12,"action":"fix",
  "fix":[{"sku":"550024955","batch_lot":"TESTC","expiry_date":"2030-06-01","quantity":5,"choice":"remove"}]},
 {"line":4,"bin_code":"CC14A01","sku":"550074326","batch_lot":"TESTQ","expiry_date":"2030-09-23","quantity":47,"action":"fix",
  "fix":[{"sku":"550074326","batch_lot":"TESTQ","expiry_date":"2030-09-23","quantity":94,"choice":"count","counted":"0"}]},
 {"line":5,"bin_code":"CD22A02","sku":"550056224","batch_lot":"TESTD","expiry_date":"2030-05-29","quantity":2,"action":"fix",
  "fix":[{"sku":"550054879","batch_lot":"TESTR","expiry_date":"2030-07-01","quantity":10,"choice":"remove"}]},
 {"line":6,"bin_code":"CE11A01","sku":"550056224","batch_lot":"TESTD","expiry_date":"2030-05-29","quantity":2,"action":"fix",
  "fix":[{"sku":"550054879","batch_lot":"TESTS","expiry_date":"2030-07-01","quantity":9,"choice":"keep"}]},
 {"line":7,"bin_code":"CE11A02","sku":"550056224","batch_lot":"TESTD","expiry_date":"2030-05-29","quantity":1}]'::jsonb as j;

-- The check (nothing posted) already tells which fixes cannot run.
create temp table pre as select putaway_import((select j from sheet), 'uji', false, null) as r;
select pg_temp.check('check: the reserved and the changed bin are refused before posting, the others are fine',
  (select bool_and(case o->>'line' when '5' then o->>'fix_error' like '%dipesan 8%' when '6' then o->>'fix_error' like '%berubah%'
                   else o->>'fix_error' is null end) from pre, jsonb_array_elements(r->'rows') o));
select pg_temp.check('check: nothing posted, nothing logged',
  pg_temp.qty('CA06C01', '550038021') = 36 and not exists (select 1 from putaway_log));

do $$ begin
  perform putaway_import((select j from sheet), 'uji', true, ' ');
  raise notice 'FAIL a fix without a name is refused';
exception when others then raise notice 'PASS a fix without a name is refused'; end $$;

create temp table res as select putaway_import((select j from sheet), 'uji', true, 'Ilham') as r;

select pg_temp.check('move: CA06C01 holds only the 4 drums, the 36 Helix are in CA02D02',
  pg_temp.qty('CA06C01', '550056224') = 4 and pg_temp.qty('CA06C01', '550038021') = 0 and pg_temp.qty('CA02D02', '550038021') = 36);
select pg_temp.check('remove within the limit: CB21A01 = the 12 of the sheet, the 5 adjusted out as COUNT_VARIANCE by Ilham',
  pg_temp.qty('CB21A01', '550024955') = 12
  and exists (select 1 from movements m join bins b on b.id = m.to_bin_id where b.bin_code = 'CB21A01' and m.type = 'adjustment'
              and m.quantity = -5 and m.reason_code = 'COUNT_VARIANCE' and m.by_name = 'Ilham' and m.note like '%sheet benar%'));
select pg_temp.check('above the limit: the -94 waits in Adjust stok, the 47 are put away',
  pg_temp.qty('CC14A01', '550074326') = 141
  and exists (select 1 from adjustment_requests a join bins b on b.id = a.bin_id where b.bin_code = 'CC14A01'
              and a.quantity = -94 and a.status = 'PENDING' and a.requested_by_name = 'Ilham'));
select pg_temp.check('reserved: CD22A02 untouched, no putaway, a count task instead',
  pg_temp.qty('CD22A02', '550054879') = 10 and pg_temp.qty('CD22A02', '550056224') = 0
  and exists (select 1 from count_tasks c join bins b on b.id = c.bin_id where b.bin_code = 'CD22A02' and c.status = 'OPEN'));
select pg_temp.check('changed bin: CE11A01 untouched, a count task instead',
  pg_temp.qty('CE11A01', '550054879') = 3 and pg_temp.qty('CE11A01', '550056224') = 0
  and exists (select 1 from count_tasks c join bins b on b.id = c.bin_id where b.bin_code = 'CE11A01' and c.status = 'OPEN'));
select pg_temp.check('a plain new putaway still posts',
  pg_temp.qty('CE11A02', '550056224') = 1);
select pg_temp.check('answer: 4 putaways, 1 request, 2 count tasks',
  (select (r->>'movements')::int = 4 and (r->>'requests')::int = 1 and (r->>'count_tasks')::int = 2 and r->>'import_id' is not null from res));

select pg_temp.check('log: one row per sheet line, under one import',
  (select count(*) = 6 and count(distinct import_id) = 1 from putaway_log));
select pg_temp.check('log: CA06C01 keeps the conflict as it was (bin held 36 Helix), the decision and the result',
  exists (select 1 from putaway_log where line = 2 and status = 'conflict' and kind = 'bin_occupied' and action = 'fix'
          and result = 'fixed' and system_before @> '[{"sku":"550038021","quantity":36}]' and fix->0->>'move_to' = 'CA02D02'
          and array_length(movement_ids, 1) = 2 and by_name = 'Ilham'));
select pg_temp.check('log: CC14A01 links its pending request',
  exists (select 1 from putaway_log l join adjustment_requests a on a.id = any(l.request_ids) where l.line = 4 and l.kind = 'qty_differs' and a.quantity = -94));
select pg_temp.check('log: the refused fixes keep their reason and their count task',
  exists (select 1 from putaway_log where line = 5 and result = 'count_task' and fix_error like '%dipesan%' and count_task_id is not null)
  and exists (select 1 from putaway_log where line = 6 and result = 'count_task' and fix_error like '%berubah%'));
select pg_temp.check('log: the plain putaway is logged as posted, with an empty bin before',
  exists (select 1 from putaway_log where line = 7 and status = 'new' and result = 'posted' and system_before = '[]'::jsonb));
select pg_temp.check('log: both count tasks are linked from their sheet line',
  (select count(*) from putaway_log where count_task_id is not null) = 2);

-- Unchanged: add and set, without a name.
create temp table old as select putaway_import('[
 {"line":9,"bin_code":"CB21A01","sku":"550024955","batch_lot":"TESTN","expiry_date":"2030-06-15","quantity":15,"action":"set"}]'::jsonb, 'uji2', true) as r;
select pg_temp.check('set (Samakan qty) still works without a name, and is logged as set',
  pg_temp.qty('CB21A01', '550024955') = 15 and exists (select 1 from putaway_log where line = 9 and result = 'set'));

-- The log cannot be written or changed from outside.
do $$ begin
  update putaway_log set result = 'skipped';
  if exists (select 1 from putaway_log where result = 'skipped') then raise notice 'FAIL the log cannot be changed';
  else raise notice 'PASS the log cannot be changed'; end if;
exception when others then raise notice 'PASS the log cannot be changed'; end $$;
rollback;
