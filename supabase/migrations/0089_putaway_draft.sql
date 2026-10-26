-- =====================================================================
-- 0089  Putaway draft: persist the in-progress review so leaving /putaway
--       does not lose the work.
--
--  Pain: the putaway page keeps parsed rows, per-line decisions (actions),
--  bin redirects (sheet_bin in rows) and "Sheet benar" fixes (fixes) in
--  useState. Navigating away or closing the tab loses everything — up to
--  ~92 conflict decisions in a real sheet. Same precedent as sheet_pick_lines
--  (0029), which persists the picking audit's uploaded file lines so its
--  review survives leaving the page. 23 Oct 2026.
-- =====================================================================

create table public.putaway_draft (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null default auth.uid() references public.profiles (id),
  by_name text not null default '',
  source text,
  rows jsonb not null,
  actions jsonb not null default '{}'::jsonb,
  fixes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (created_by, by_name)
);

grant select on public.putaway_draft to authenticated;

alter table public.putaway_draft enable row level security;
create policy "putaway_draft: read own" on public.putaway_draft
  for select to authenticated
  using (created_by = (select auth.uid()) and (select public.is_active()));

-- =====================================================================
-- Save / upsert a draft. Only supervisor or admin (role gate mirrors 0008).
-- Returns { updated_at } so the client can show the timestamp.
-- =====================================================================
create or replace function public.putaway_draft_save(
  p_source text,
  p_rows jsonb,
  p_actions jsonb default '{}'::jsonb,
  p_fixes jsonb default '{}'::jsonb,
  p_by_name text default ''
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_updated timestamptz;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa simpan draf putaway';
  end if;

  insert into public.putaway_draft (created_by, by_name, source, rows, actions, fixes, updated_at)
  values (auth.uid(), p_by_name, p_source, p_rows, p_actions, p_fixes, now())
  on conflict (created_by, by_name) do update set
    source = excluded.source,
    rows = excluded.rows,
    actions = excluded.actions,
    fixes = excluded.fixes,
    updated_at = now()
  returning updated_at into v_updated;

  return jsonb_build_object('updated_at', v_updated);
end $$;

revoke execute on function public.putaway_draft_save(text, jsonb, jsonb, jsonb, text) from public, anon;
grant execute on function public.putaway_draft_save(text, jsonb, jsonb, jsonb, text) to authenticated;

-- =====================================================================
-- Load the latest draft for the current user. Returns null when none.
-- =====================================================================
create or replace function public.putaway_draft_load()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v jsonb;
begin
  select jsonb_build_object(
           'source', source,
           'by_name', by_name,
           'rows', rows,
           'actions', actions,
           'fixes', fixes,
           'updated_at', updated_at
         )
    into v
    from public.putaway_draft
   where created_by = auth.uid()
   order by updated_at desc
   limit 1;

  return v;
end $$;

revoke execute on function public.putaway_draft_load() from public, anon;
grant execute on function public.putaway_draft_load() to authenticated;

-- =====================================================================
-- Clear all drafts for the current user (called after successful post,
-- or when the user clicks "Ganti file"). Returns { cleared }.
-- =====================================================================
create or replace function public.putaway_draft_clear()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  delete from public.putaway_draft where created_by = auth.uid();
  get diagnostics n = row_count;
  return jsonb_build_object('cleared', n);
end $$;

revoke execute on function public.putaway_draft_clear() from public, anon;
grant execute on function public.putaway_draft_clear() to authenticated;