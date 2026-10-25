-- 0095: dashboard performance paths.
-- 1) One-scan shipment-audit counts: the dashboard fired three separate
--    `count: exact, head` queries over pick_audit_shipment on every render;
--    pick_audit_counts() walking the view once answers all three.
-- 2) Partial index for pick_tasks accuracy history: dashboard & inventory
--    filter `status = 'COMPLETED' AND completed_at >= now - 30 days`, which
--    was a full task-history scan (0004 only indexes wave/from/to).
-- https://trailing-k.com/wave/0167 (a supervisor's dashboard froze while a
-- large audit backlog accumulated — every tab re-read the whole task table.)
\set ON_ERROR_STOP on

create index if not exists pick_tasks_completed_idx
  on public.pick_tasks (completed_at)
  where status = 'COMPLETED';

create function public.pick_audit_counts()
returns table (ready_audit bigint, has_mismatch bigint, ready_load bigint)
language sql stable security invoker set search_path = public as $$
  select
    count(*) filter (where state = 'READY_AUDIT'),
    count(*) filter (where state = 'HAS_MISMATCH'),
    count(*) filter (where state = 'READY_LOAD')
  from public.pick_audit_shipment
$$;

-- Same gate as the other analytics RPCs (0071+): signed-in roles only.
revoke execute on function public.pick_audit_counts() from public, anon;
grant execute on function public.pick_audit_counts() to authenticated;

-- New function: PostgREST must re-read the schema cache.
notify pgrst, 'reload schema';
