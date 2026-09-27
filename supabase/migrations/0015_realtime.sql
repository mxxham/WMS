-- =====================================================================
-- 0015: live updates
-- Pages subscribe to changes on these tables (Supabase Realtime,
-- postgres_changes) and re-render, so a task posted on one phone shows on
-- every open Wave page, dashboard and bin page without a manual refresh.
-- Realtime still applies each table's SELECT policy per subscriber.
-- Guarded: plain Postgres (supabase/tests) has no supabase_realtime publication.
-- =====================================================================
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication not found; skipping';
    return;
  end if;
  foreach t in array array['waves', 'pick_tasks', 'outbound', 'movements', 'count_tasks', 'execution_events', 'audits', 'pickfaces'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
