-- 0096: the anonymous REST surface is closed.
-- Every SECURITY DEFINER function that production 25 Oct still handed to role
-- anon must now answer: authenticated YES, anon NO. check_request is the
-- deliberate exception (PostgREST pre-request hook, runs pre-auth). No policy
-- granted to anon/public may evaluate the swept functions, or an anonymous
-- REST select would 500 instead of returning no rows.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;

create or replace function pg_temp.swept() returns table (f text) language sql stable as $$
  values ('apply_movement'), ('batch_expected_expiry'), ('bin_abc_class'), ('bin_count_lines'),
         ('ckb_job_exists'), ('current_user_role'), ('fefo_exceptions'), ('fefo_pick_count'),
         ('handle_new_user'), ('has_ckb_app'), ('has_role'), ('held_qty'), ('hold_reasons'),
         ('inventory_policy'), ('is_active'), ('item_by_barcode'), ('item_min_dispatch_days'),
         ('pick_tasks_follow_the_pallet'), ('wms_stock_by_sku')
$$;

-- anon is refused everywhere it was exposed (all 19 signatures, by oid).
select pg_temp.check('all 19 swept functions are present by name',
  (select count(*) from pg_temp.swept() s
    join pg_proc p on p.proname = s.f and p.pronamespace = 'public'::regnamespace) = 19);
select pg_temp.check('sum of anon-denied swept functions equals the list length',
  (select count(*) from pg_temp.swept() s
    join pg_proc p on p.proname = s.f and p.pronamespace = 'public'::regnamespace
    where has_function_privilege('anon', p.oid, 'execute')) = 0);

-- authenticated keeps the app's own access.
select pg_temp.check('authenticated allowed on all 19 swept functions',
  (select count(*) from pg_temp.swept() s
    join pg_proc p on p.proname = s.f and p.pronamespace = 'public'::regnamespace
    where not has_function_privilege('authenticated', p.oid, 'execute')) = 0);

-- The gate itself must remain callable pre-auth.
select pg_temp.check('check_request still executable by anon (pre-request hook)',
  has_function_privilege('anon', 'public.check_request()', 'execute'));
select pg_temp.check('check_request still executable by authenticated',
  has_function_privilege('authenticated', 'public.check_request()', 'execute'));

-- No anon/public policy may call a swept function (that would turn an
-- anonymous select into a permission-denied error instead of empty rows).
-- pg_policies.roles is name[] — {anon,public} overlap means the policy fires
-- for unauthenticated REST calls too.
select pg_temp.check('no anon/public policy evaluates a swept function',
  not exists (
    select 1 from pg_policies p
    where '{anon,public}' && p.roles::text[]
      and concat_ws(' ', p.qual, p.with_check) ~
        'apply_movement|batch_expected_expiry|bin_abc_class|bin_count_lines|ckb_job_exists|current_user_role|fefo_exceptions|fefo_pick_count|handle_new_user|has_ckb_app|has_role|held_qty|hold_reasons|inventory_policy|is_active|item_by_barcode|item_min_dispatch_days|pick_tasks_follow_the_pallet|wms_stock_by_sku'
  ));

rollback;
