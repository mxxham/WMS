-- 0097: the Wave page's problem panels in one round trip.
-- "Perlu ditangani" reads three datasets for the same planned_date: the audit
-- state of every wave shipment (pick_audit_shipment), the open tasks the stock
-- can no longer satisfy (task_shortfalls) and the open tasks waiting for a
-- relocation into their bin (task_waits). Three requests, three round trips,
-- and two of the three views re-derive the same per-bin stock balances for the
-- day. wave_problems() scans each view once for the date and returns the three
-- sets in one response: `kind` says which panel a row belongs to ('audit',
-- 'short', 'wait'), and the columns after it are the fields those panels
-- render. Every row is a view's own row, unfiltered — the page builds the
-- same maps it built from the three queries.

create function public.wave_problems(p_date date)
returns table (
  kind             text,     -- 'audit' | 'short' | 'wait'
  wave_id          uuid,     -- audit/short: the wave the row belongs to
  wave_no          text,
  shipment_number  text,     -- audit: the shipment whose state this is
  state            text,     -- audit: the shipment state the panel labels
  task_id          uuid,     -- short/wait: the blocked task
  wait_task_id     uuid,     -- wait: the Bin To Bin it waits for
  wait_wave_no     text,
  wait_seq         int,
  wait_from        text,
  wait_to          text,
  wait_qty         numeric,
  wait_have        numeric,  -- what the blamed bin actually holds now
  wait_wave_status text      -- a Tunda wave's move is a supervisor's call
)
language sql stable security invoker set search_path = public as $$
  select 'audit'::text, s.wave_id, s.wave_no, s.shipment_number, s.state,
         null::uuid, null::uuid, null::text, null::int, null::text, null::text,
         null::numeric, null::numeric, null::text
  from public.pick_audit_shipment s
  where s.planned_date = p_date
  union all
  select 'short'::text, f.wave_id, f.wave_no, null, null,
         f.task_id, null, null, null, null, null, null, null, null
  from public.task_shortfalls f
  where f.planned_date = p_date
  union all
  select 'wait'::text, null, null, null, null,
         w.task_id, w.wait_task_id, w.wait_wave_no, w.wait_seq, w.wait_from,
         w.wait_to, w.wait_qty, w.have, w.wait_wave_status
  from public.task_waits w
  where w.planned_date = p_date
$$;

-- Same gate as the other analytics RPCs (0071+): signed-in roles only.
revoke execute on function public.wave_problems(date) from public, anon;
grant execute on function public.wave_problems(date) to authenticated, service_role;

-- New function: PostgREST must re-read the schema cache.
notify pgrst, 'reload schema';
