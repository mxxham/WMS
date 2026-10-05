-- Aisle CG does not exist: its bins are blocked, out of Bin kosong, and an import does not bring them back (0054).
-- Runs in a transaction and rolls back. The seed loads after the migrations, so 0054's block is run here.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users values ('11111111-1111-1111-1111-111111111111','op@x','{"name":"Operator"}') on conflict do nothing;
update profiles set role = 'admin' where id = '11111111-1111-1111-1111-111111111111';
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;

select pg_temp.check('before: the seed has active CG bins in Bin kosong',
  exists (select 1 from empty_bins where bin_code like 'CG%'));

-- The guard: a CG bin holding stock stops the block, naming the bin.
savepoint guard;
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select import_snapshot('[{"bin_code":"CG05C01","zone":"CG","rack":"05","level":"C","position":"01","sku":"550044709","batch_lot":"09I26JJ","quantity":3,"expiry_date":"2030-09-09"}]'::jsonb, false, 'uji') \g /dev/null
reset role;
\set ON_ERROR_STOP off
\i supabase/migrations/0054_block_aisle_cg.sql
\set ON_ERROR_STOP on
rollback to savepoint guard;
select pg_temp.check('a CG bin with stock stops the block, naming it', :'LAST_ERROR_MESSAGE' like '%CG05C01%');

\i supabase/migrations/0054_block_aisle_cg.sql
select pg_temp.check('every CG bin is blocked, none deleted',
  (select count(*) from bins where bin_code like 'CG%') = (select count(*) from bins where bin_code like 'CG%' and status = 'blocked')
  and (select count(*) from bins where bin_code like 'CG%') > 0);
select pg_temp.check('Bin kosong has no CG any more, CF is still there',
  not exists (select 1 from empty_bins where bin_code like 'CG%') and exists (select 1 from empty_bins where bin_code like 'CF%'));

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select import_snapshot('[{"bin_code":"CG01A01","zone":"CG","rack":"01","level":"A","position":"01","sku":null,"quantity":0}]'::jsonb, false, 'WMS template rows') \g /dev/null
reset role;
select pg_temp.check('a later import of the WMS template rows keeps CG blocked',
  (select status from bins where bin_code = 'CG01A01') = 'blocked');
rollback;
