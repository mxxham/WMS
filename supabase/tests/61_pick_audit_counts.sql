-- 0095: pick_audit_counts() replaces the dashboard's three head-counts over
-- pick_audit_shipment with one scan. Consistency: the RPC's three numbers must
-- equal three independent filtered counts of the same view, for ALL data in
-- the scratch db (seed + fixtures). Grants mirror the 0071+ analytics RPCs.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;

-- ---- Consistency for every shipment the view exposes -----------------------
-- Seed date determinism (tests 58/60 pattern): the view is read at test time,
-- inside the transaction, so the RPC and the manual counts see the same rows.
create or replace function pg_temp.manual(p_state text) returns bigint
language sql stable as $$
  select count(*) from public.pick_audit_shipment where state = p_state
$$;

select pg_temp.check('pick_audit_counts ready_audit matches manual count',
  (select ready_audit from pick_audit_counts()) = (select pg_temp.manual('READY_AUDIT')));
select pg_temp.check('pick_audit_counts has_mismatch matches manual count',
  (select has_mismatch from pick_audit_counts()) = (select pg_temp.manual('HAS_MISMATCH')));
select pg_temp.check('pick_audit_counts ready_load matches manual count',
  (select ready_load from pick_audit_counts()) = (select pg_temp.manual('READY_LOAD')));

-- The RPC covers exactly the three displayed states by equality to manual
-- counts; LOADED / CANCELLED / PICKING rows stay outside by the same equality.

-- ---- Grants: signed-in roles may call, anon/public never -------------------
select pg_temp.check('pick_audit_counts executable by authenticated',
  has_function_privilege('authenticated', 'public.pick_audit_counts()', 'execute'));
select pg_temp.check('pick_audit_counts NOT executable by anon',
  not has_function_privilege('anon', 'public.pick_audit_counts()', 'execute'));

rollback;
