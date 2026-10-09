-- Putaway of a pallet rest already moved in by Bin To Bin (0059). Runs in a transaction and rolls back.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users values ('11111111-1111-1111-1111-111111111111','op@x','{"name":"Operator"}') on conflict do nothing;
update profiles set role = 'admin' where id = '11111111-1111-1111-1111-111111111111';
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
create or replace function pg_temp.qty(p_bin text) returns numeric language sql as $$
  select coalesce(sum(v.quantity), 0) from inventory v join bins b on b.id = v.bin_id where b.bin_code = p_bin and v.batch_lot like 'TEST%' $$;
select import_snapshot('[
 {"bin_code":"CE28D02","zone":"CE","rack":"28","level":"D","position":"02","sku":"550058592","batch_lot":"TESTB","quantity":44,"expiry_date":"2030-08-05"}]'::jsonb, false, 'uji') \g /dev/null
-- 5 Oct: pick 15, the rest 29 moved to the pickface CE30A02 (the row's Bin To Bin).
reset role;
insert into movements (type, item_id, batch_lot, quantity, from_bin_id, expiry_date, note)
select 'picking', id, 'TESTB', 15, (select id from bins where bin_code = 'CE28D02'), '2030-08-05', 'uji pick' from items where sku = '550058592';
insert into movements (type, item_id, batch_lot, quantity, from_bin_id, to_bin_id, expiry_date, note)
select 'transfer', id, 'TESTB', 29, (select id from bins where bin_code = 'CE28D02'), (select id from bins where bin_code = 'CE30A02'), '2030-08-05', 'REPLENISH pickface'
from items where sku = '550058592';
set role authenticated;

-- The WMS "data putaway" sheet then lists the same rest as a putaway into CE30A02 (other expiry, as on 5 Oct).
create temp table v as select putaway_import('[{"line":7,"bin_code":"CE30A02","sku":"550058592","batch_lot":"TESTB","expiry_date":"2030-08-10","quantity":29},
  {"line":8,"bin_code":"CE31A01","sku":"550058592","batch_lot":"TESTC","expiry_date":"2030-08-10","quantity":44}]'::jsonb, 'uji', false) as r;
select pg_temp.check('the row into CE30A02 is a moved_in conflict, naming the Bin To Bin of 29 from CE28D02',
  (select (r->'rows'->0->>'kind') = 'moved_in' and (r->'rows'->0->'moved_in'->>'quantity')::numeric = 29
          and r->'rows'->0->'moved_in'->>'from_bin' = 'CE28D02' from v));
select pg_temp.check('a putaway into a bin with no recent Bin To Bin is still a plain new putaway',
  (select r->'rows'->1->>'status' = 'new' and r->'rows'->1->>'kind' is null from v));

-- Posted without a decision: the rest is not counted twice; the bin gets a count instead.
create temp table a as select putaway_import('[{"line":7,"bin_code":"CE30A02","sku":"550058592","batch_lot":"TESTB","expiry_date":"2030-08-10","quantity":29}]'::jsonb, 'uji', true) as r;
select pg_temp.check('left alone: no putaway posted (CE30A02 stays 29), and a count task opens on CE30A02',
  pg_temp.qty('CE30A02') = 29 and (select (r->>'movements')::int = 0 and (r->>'count_tasks')::int = 1 from a)
  and exists (select 1 from count_tasks c join bins b on b.id = c.bin_id where b.bin_code = 'CE30A02' and c.status = 'OPEN'));

-- Someone checks: it really is a new pallet.
create temp table b as select putaway_import('[{"line":7,"action":"add","bin_code":"CE30A02","sku":"550058592","batch_lot":"TESTB","expiry_date":"2030-08-10","quantity":29}]'::jsonb, 'uji', true) as r;
select pg_temp.check('"add" posts it: CE30A02 29 + 29', pg_temp.qty('CE30A02') = 58 and (select (r->>'movements')::int = 1 from b));
rollback;
