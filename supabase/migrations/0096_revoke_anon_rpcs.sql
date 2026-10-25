-- 0096: close the anonymous REST surface.
-- Production audit (25 Oct 2026) found SECURITY DEFINER functions granted to
-- PUBLIC, i.e. callable unauthenticated through /rest/v1/rpc/*. The app
-- itself only ever calls them as `authenticated` (cookie sessions) or
-- `service_role`, so the correct wall is: revoke from PUBLIC (which removes
-- both the anon and authenticated right), then grant explicitly to the two
-- server roles. check_request is the PostgREST pre-request hook and must stay
-- unauthenticated-callable — it is the gate itself, not a leak.
\set ON_ERROR_STOP on

do $$
declare
  r record;
  swept text[] := array[
    'apply_movement', 'batch_expected_expiry', 'bin_abc_class', 'bin_count_lines',
    'ckb_job_exists', 'current_user_role', 'fefo_exceptions', 'fefo_pick_count',
    'handle_new_user', 'has_ckb_app', 'has_role', 'held_qty', 'hold_reasons',
    'inventory_policy', 'is_active', 'item_by_barcode', 'item_min_dispatch_days',
    'pick_tasks_follow_the_pallet', 'wms_stock_by_sku'
  ];
begin
  -- Every overload of each name, resolved by oid → exact signature. Revoking
  -- from PUBLIC is not enough — early migrations granted some functions
  -- (e.g. is_active) directly to anon, so strip anon and authenticated too
  -- and re-grant the two server roles explicitly.
  for r in
    select p.oid from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any(swept)
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.oid::regprocedure);
    execute format('grant execute on function %s to authenticated, service_role', r.oid::regprocedure);
  end loop;

  -- handle_new_user fires on auth.users inserts (hosted: supabase_auth_admin).
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    for r in select oid from pg_proc p where p.proname = 'handle_new_user'
             and p.pronamespace = 'public'::regnamespace loop
      execute format('grant execute on function %s to supabase_auth_admin', r.oid::regprocedure);
    end loop;
  end if;

  -- The gate itself stays public-callable: PostgREST runs it pre-auth.
  execute 'grant execute on function public.check_request() to public';
end $$;

-- Privilege changes do not reach the PostgREST schema cache, but reload is free.
notify pgrst, 'reload schema';
