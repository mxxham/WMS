-- One shape per pallet-break helper (0077). 0073 defined the helpers with three arguments and 0074
-- widened them by one; `create or replace` added an overload instead of replacing, so the live
-- database carried both — and the stale complete_open_pallet stayed granted to `authenticated`, so a
-- three-argument RPC call could still run the pre-0074 leftover lookup.
-- Runs in a transaction and rolls back. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;

select pg_temp.check('stale complete_open_pallet(uuid,text,text) is gone',
  to_regprocedure('public.complete_open_pallet(uuid,text,text)') is null);
select pg_temp.check('stale open_pallet_leftovers(uuid) is gone',
  to_regprocedure('public.open_pallet_leftovers(uuid)') is null);
select pg_temp.check('live complete_open_pallet(uuid,text,text,uuid) survives',
  to_regprocedure('public.complete_open_pallet(uuid,text,text,uuid)') is not null);
select pg_temp.check('live open_pallet_leftovers(uuid,uuid) survives',
  to_regprocedure('public.open_pallet_leftovers(uuid,uuid)') is not null);
select pg_temp.check('exactly one complete_open_pallet in public',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'complete_open_pallet') = 1);
select pg_temp.check('exactly one open_pallet_leftovers in public',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'open_pallet_leftovers') = 1);

rollback;
