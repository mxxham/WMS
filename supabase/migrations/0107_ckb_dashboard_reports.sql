-- =====================================================================
-- 0107  CKB 3PL dashboard counts and the discrepancy report
--
-- ckb_dashboard(): one round trip for the staff dashboard, every number a
-- count of real CKB rows (nothing from Shell tables), optionally for one
-- customer. Representatives have their own page built on RLS reads.
--
-- ckb_report_discrepancies(): count-task results across sessions. Count
-- tasks are not readable over the API (blind counting, 0101), so reports
-- read them here — staff supervisors/admins see every session, a
-- representative only CLOSED sessions of their customers.
-- =====================================================================

create or replace function public.ckb_dashboard(p_customer uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.ckb_is_staff() then raise exception 'Akses ditolak'; end if;
  with st as (
    select s.* from public.ckb_stocktakes s where p_customer is null or s.customer_id = p_customer
  ), tk as (
    select t.*, s.status s_status,
      (select c.qty from public.ckb_counts c where c.task_id = t.id order by c.entry_no desc limit 1) lqty,
      (select c.batch_matches is false or c.expiry_matches is false from public.ckb_counts c where c.task_id = t.id
        order by c.entry_no desc limit 1) lmismatch
    from public.ckb_count_tasks t join st s on s.id = t.stocktake_id
    where s.status in ('COUNTING', 'REVIEW')
  )
  select jsonb_build_object(
    'stocktakes_counting', (select count(*) from st where status = 'COUNTING'),
    'stocktakes_review', (select count(*) from st where status = 'REVIEW'),
    'stocktakes_draft', (select count(*) from st where status = 'DRAFT'),
    'tasks_awaiting_count', (select count(*) from tk where status in ('OPEN', 'RECOUNT_REQUESTED')),
    'recounts_requested', (select count(*) from tk where status = 'RECOUNT_REQUESTED'),
    'discrepancies_awaiting_review', (select count(*) from tk where s_status = 'REVIEW' and status = 'COUNTED'
       and (lqty <> baseline_qty or origin = 'FOUND' or identity_issue is not null or lmismatch)),
    'adjustments_proposed', (select count(*) from public.ckb_adjustments a where a.status = 'PROPOSED'
       and (p_customer is null or a.customer_id = p_customer)),
    'adjustments_awaiting_export', (select count(*) from public.ckb_adjustments a where a.status = 'APPROVED'
       and (p_customer is null or a.customer_id = p_customer)),
    'exports_unconfirmed', (select count(*) from public.ckb_sap_exports e where e.status = 'GENERATED'
       and (p_customer is null or e.customer_id = p_customer)),
    'rebagging_open', (select count(*) from public.ckb_rebagging_jobs j
       where j.status in ('DRAFT', 'OPEN', 'IN_PROGRESS', 'REJECTED', 'ON_HOLD') and (p_customer is null or j.customer_id = p_customer)),
    'rebagging_awaiting_verification', (select count(*) from public.ckb_rebagging_jobs j
       where j.status = 'AWAITING_VERIFICATION' and (p_customer is null or j.customer_id = p_customer)),
    'rebagging_awaiting_posting', (select count(*) from public.ckb_rebagging_jobs j
       where j.status = 'VERIFIED' and (p_customer is null or j.customer_id = p_customer)),
    'inspections_draft', (select count(*) from public.ckb_inspections i where i.status = 'DRAFT'
       and (p_customer is null or i.customer_id = p_customer)),
    'inspections_awaiting_review', (select count(*) from public.ckb_inspections i where i.status = 'SUBMITTED'
       and (p_customer is null or i.customer_id = p_customer)),
    'customers_without_snapshot', (select count(*) from public.ckb_customers c where c.active and c.active_snapshot_id is null
       and (p_customer is null or c.id = p_customer))
  ) into v;
  return v;
end $$;

create or replace function public.ckb_report_discrepancies(p_customer uuid, p_from date, p_to date,
  p_stocktake uuid, p_classification text)
returns table (stocktake_id uuid, stocktake_ref text, stocktake_status text, customer_id uuid, customer_name text,
  baseline_ref text, snapshot_date date, created_at timestamptz, seq int, material_code text, description text,
  storage_bin text, batch text, expiry_date date, uom text, baseline_qty numeric, latest_qty numeric,
  accepted_qty numeric, variance numeric, classification text, count_rounds int, task_status text,
  decision_reason text, decided_by_name text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not (public.ckb_has_role(array['admin', 'supervisor']) or public.ckb_role() = 'customer') then
    raise exception 'Akses ditolak';
  end if;
  return query
  with vis as materialized (
    select s.* from public.ckb_stocktakes s
    where s.status <> 'CANCELLED'
      and (public.ckb_is_staff() or (s.status = 'CLOSED' and public.ckb_can_see_customer(s.customer_id)))
      and (p_customer is null or s.customer_id = p_customer)
      and (p_stocktake is null or s.id = p_stocktake)
      and (p_from is null or s.created_at >= p_from)
      and (p_to is null or s.created_at < p_to + 1)
  )
  select s.id, s.ref_no, s.status, s.customer_id, c.name, i.ref_no, i.snapshot_date, s.created_at,
    t.seq, t.material_code, t.description, t.storage_bin, t.batch, t.expiry_date, t.uom, t.baseline_qty, t.latest_qty,
    t.accepted_qty, t.variance, t.classification, t.count_rounds, t.status, t.decision_reason, t.decided_by_name
  from vis s
  join public.ckb_customers c on c.id = s.customer_id
  join public.ckb_sap_imports i on i.id = s.baseline_import_id
  cross join lateral public.ckb_stocktake_tasks(s.id) t
  where (nullif(p_classification, '') is null or t.classification = p_classification)
  order by s.created_at desc, t.seq;
end $$;

revoke execute on function public.ckb_dashboard(uuid), public.ckb_report_discrepancies(uuid, date, date, uuid, text) from public, anon;
grant execute on function public.ckb_dashboard(uuid), public.ckb_report_discrepancies(uuid, date, date, uuid, text) to authenticated;

-- Live pages: the CKB tables a page refreshes on (guarded: plain Postgres has no publication; 0015).
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication not found; skipping';
    return;
  end if;
  foreach t in array array['ckb_stocktakes', 'ckb_counts', 'ckb_adjustments', 'ckb_inspections', 'ckb_evidence',
                           'ckb_sap_imports', 'ckb_sap_exports', 'ckb_customers'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
