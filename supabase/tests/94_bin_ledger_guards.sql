-- Rak & Lokasi (0132): the ledger refuses missing bins and the other side's racks; the import leaves CKB racks alone.
-- Runs in a transaction and rolls back. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users values ('22222222-2222-2222-2222-222222222222','sup@x','{"name":"Supervisor"}') on conflict do nothing;
update profiles set role = 'admin' where id = '22222222-2222-2222-2222-222222222222';
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when coalesce(ok, false) then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.fails(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then
  if sqlerrm not like p_like then raise notice 'got: %', sqlerrm; end if;
  return sqlerrm like p_like; end $$;
create or replace function pg_temp.qty(p_bin text) returns numeric language sql as $$
  select coalesce(sum(i.quantity), 0) from inventory i join bins b on b.id = i.bin_id where b.bin_code = p_bin $$;
create or replace function pg_temp.mv(p_type text, p_from text, p_to text, p_qty numeric) returns void language sql as $$
  insert into movements (type, item_id, batch_lot, quantity, from_bin_id, to_bin_id, expiry_date, note, reason_code)
  values (p_type::movement_type, (select id from items where sku = '550058593'), 'T94', p_qty,
          (select id from bins where bin_code = p_from), (select id from bins where bin_code = p_to), '2030-09-10', 'uji 94',
          case when p_type = 'adjustment' then 'FOUND' end) $$;
grant execute on function pg_temp.check(text, boolean) to authenticated;
insert into bins (bin_code, zone, rack, level, position) values ('CA41A01', 'CA', '41', 'A', '01'), ('CA41A02', 'CA', '41', 'A', '02');

-- Into missing / planned bins: never.
select pg_temp.check('stock cannot enter a NOT_PRESENT bin',
  pg_temp.fails($q$select pg_temp.mv('adjustment', null, 'CE33A01', 1)$q$, '%tidak ada%'));
update bins set status = 'blocked', block_kind = 'PLANNED' where bin_code = 'CA41A02';
select pg_temp.check('stock cannot enter a PLANNED bin',
  pg_temp.fails($q$select pg_temp.mv('adjustment', null, 'CA41A02', 1)$q$, '%belum dibangun%'));
update bins set status = 'active' where bin_code = 'CA41A02';
-- Out of a missing bin: allowed (cleaning up a data error).
select pg_temp.mv('adjustment', null, 'CA41A01', 5);
update bins set status = 'blocked', block_kind = 'NOT_PRESENT' where bin_code = 'CA41A01';
select pg_temp.mv('transfer', 'CA41A01', 'CA41A02', 5);
select pg_temp.check('stock may leave a NOT_PRESENT bin', pg_temp.qty('CA41A01') = 0 and pg_temp.qty('CA41A02') = 5);

-- Shell and CKB racks stay apart.
select pg_temp.check('Shell cannot move stock into a CKB rack',
  pg_temp.fails($q$select pg_temp.mv('transfer', 'CA41A02', 'CF21A01', 1)$q$, '%dipinjam CKB%'));
select set_config('app.ckb_movement', 'on', true);
select pg_temp.mv('adjustment', null, 'CG01A01', 7);
select pg_temp.check('the CKB side may book into its own rack', pg_temp.qty('CG01A01') = 7);
select pg_temp.check('the CKB side cannot touch a Shell rack',
  pg_temp.fails($q$select pg_temp.mv('transfer', 'CG01A01', 'CA41A02', 1)$q$, '%Shell%'));
select pg_temp.mv('transfer', 'CG01A01', 'STAGING', 2);
select pg_temp.check('floor locations are shared', pg_temp.qty('STAGING') >= 2 and pg_temp.qty('CG01A01') = 5);
select set_config('app.ckb_movement', '', true);
select pg_temp.mv('transfer', 'STAGING', 'CA41A02', 2);
select pg_temp.check('Shell may take from a floor location', pg_temp.qty('CA41A02') = 7);

-- Review fix: a rebagging job id as ref_id makes a movement CKB's only inside a database function.
insert into ckb_rebagging_jobs (id, shift, warehouse, operation_type, reason, creator_name)
values ('a9400000-0000-0000-0000-000000000001', 'Pagi', 'Gudang', 'SPLIT', 'uji 94', 'Uji');
insert into auth.users values ('a9411111-1111-1111-1111-111111111111','sup94@x','{"name":"Sup94"}') on conflict do nothing;
update profiles set role = 'admin' where id = 'a9411111-1111-1111-1111-111111111111';
set role authenticated;
set request.jwt.claim.sub = 'a9411111-1111-1111-1111-111111111111';
select pg_temp.check('a direct API movement cannot borrow a rebagging job id to touch a CKB rack',
  pg_temp.fails($q$insert into movements (type, item_id, batch_lot, quantity, from_bin_id, to_bin_id, expiry_date, note, ref_id)
    values ('transfer', (select id from items where sku = '550058593'), 'T94', 1, (select id from bins where bin_code = 'CA41A02'),
            (select id from bins where bin_code = 'CF21A01'), '2030-09-10', 'uji 94', 'a9400000-0000-0000-0000-000000000001')$q$, '%dipinjam CKB%'));
reset role;

-- The import (a Shell writer).
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select set_config('t.imp', import_snapshot('[
 {"bin_code":"CE33A01","zone":"CE","rack":"33","level":"A","position":"01","status":"active","sku":"550058593","batch_lot":"T94","quantity":4,"expiry_date":"2030-09-10"},
 {"bin_code":"CG01A02","zone":"CG","rack":"01","level":"A","position":"02","sku":"550058593","batch_lot":"T94","quantity":3,"expiry_date":"2030-09-10"},
 {"bin_code":"CG02A01","zone":"CG","rack":"02","level":"A","position":"01","sku":"550058593","batch_lot":"T94","quantity":0,"expiry_date":"2030-09-10"},
 {"bin_code":"CA41A02","zone":"CA","rack":"41","level":"A","position":"02","sku":"550058593","batch_lot":"T94","quantity":9,"expiry_date":"2030-09-10"}]'::jsonb,
 true, 'uji94')::text, true);
reset role;
select pg_temp.check('import keeps a NOT_PRESENT bin NOT_PRESENT',
  (select status = 'blocked' and block_kind = 'NOT_PRESENT' from bins where bin_code = 'CE33A01'));
select pg_temp.check('import skips a TIDAK_ADA row and reports it',
  pg_temp.qty('CE33A01') = 0
  and current_setting('t.imp')::jsonb->'skipped' @> '[{"bin_code":"CE33A01","sku":"550058593","quantity":4,"reason":"TIDAK_ADA"}]');
select pg_temp.check('full_sync leaves CKB racks alone and reports their rows',
  pg_temp.qty('CG01A01') = 5 and pg_temp.qty('CG01A02') = 0
  and current_setting('t.imp')::jsonb->'skipped' @> '[{"bin_code":"CG01A02","reason":"CKB"}]');
select pg_temp.check('the Shell row is booked', pg_temp.qty('CA41A02') = 9);
select pg_temp.check('a zero row on a CKB rack is skipped without a report line',
  not (current_setting('t.imp')::jsonb->'skipped' @> '[{"bin_code":"CG02A01"}]'));
select pg_temp.check('import keeps the owner of a known bin',
  (select owner = 'CKB' from bins where bin_code = 'CG01A02'));
rollback;
