-- =====================================================================
-- 0005  Explicit table/function privileges
--
-- Newer Supabase projects no longer grant SELECT/INSERT/UPDATE/DELETE or
-- EXECUTE to `authenticated` by default on objects created by `postgres`.
-- Without these grants every query fails with "permission denied" before
-- RLS is even evaluated. Privileges here only open the door; the RLS
-- policies in 0003/0004 still decide which rows each role may touch.
-- Idempotent, and harmless on projects that still have the old defaults.
-- =====================================================================

-- Read everything (RLS: signed-in users only).
grant select on
  public.profiles, public.bins, public.items, public.inventory, public.movements,
  public.scan_logs, public.print_logs, public.settings,
  public.waves, public.outbound, public.pick_tasks, public.execution_events,
  public.inventory_detail, public.bin_summary, public.pick_task_detail
to authenticated;

-- Writes that RLS policies allow. inventory and the planning tables get
-- none: stock changes only through the movements trigger, plans only
-- through the SECURITY DEFINER RPCs.
grant insert on public.movements, public.scan_logs, public.print_logs to authenticated;
grant update on public.profiles to authenticated;
grant insert, update, delete on public.bins, public.items, public.settings to authenticated;
grant usage on all sequences in schema public to authenticated;

-- RLS policies call these as the invoking user.
grant execute on function public.has_role(public.user_role[]) to authenticated;
grant execute on function public.current_user_role() to authenticated;

-- Server-side tooling (admin user creation, `npm run allocate:file -- --db`).
grant all on all tables in schema public to service_role;
grant usage on all sequences in schema public to service_role;
