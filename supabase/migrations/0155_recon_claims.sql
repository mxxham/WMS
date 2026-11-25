-- =====================================================================
-- 0155  Investigasi selisih: who is looking at which SKU
--
-- Two people could open the same SKU of a reconciliation and check the same
-- bins twice, or post two fixes for one gap. A claim says "Ani is on this
-- SKU": it is shown on the list and as a banner on the SKU, and it is soft:
-- nothing is blocked, someone else can take over.
--
--   * one row per reconciliation line (line_id), kept alive by a heartbeat
--     (last_seen_at, every ~2 minutes while the SKU is open);
--   * a claim not seen for 30 minutes is free (a closed tab never releases it);
--   * the person is the typed name (the shared site account has one login for
--     everybody), compared with same_person();
--   * transient state, not a ledger: the functions below replace and delete rows;
--     there is no write policy.
-- =====================================================================

create table public.recon_claims (
  line_id      uuid primary key references public.stock_recon_lines(id) on delete cascade,
  by_name      text not null,
  claimed_by   uuid references public.profiles(id),
  claimed_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.recon_claims enable row level security;
create policy "recon_claims: read" on public.recon_claims for select to authenticated using ((select public.is_active()));
-- No write policy: recon_claim / recon_release only.
grant select on public.recon_claims to authenticated;
grant all on public.recon_claims to service_role;

-- The claims that are still alive (seen in the last 30 minutes).
create or replace view public.recon_claims_active with (security_invoker = true) as
select line_id, by_name, claimed_at, last_seen_at
from public.recon_claims
where last_seen_at > now() - interval '30 minutes';
grant select on public.recon_claims_active to authenticated;

-- Claim a line (or refresh your own claim). Another person's live claim is not overwritten unless p_take_over.
create or replace function public.recon_claim(p_line_id uuid, p_by_name text, p_take_over boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text := public.person_name(p_by_name); c public.recon_claims%rowtype; v_prev text;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa memeriksa selisih';
  end if;
  if not exists (select 1 from public.stock_recon_lines where id = p_line_id) then raise exception 'Baris rekonsiliasi tidak ada'; end if;

  select * into c from public.recon_claims where line_id = p_line_id for update;
  if c.line_id is not null and c.last_seen_at > now() - interval '30 minutes'
     and not public.same_person(c.by_name, v_name) and not coalesce(p_take_over, false) then
    return jsonb_build_object('status', 'TAKEN', 'by_name', c.by_name, 'claimed_at', c.claimed_at, 'last_seen_at', c.last_seen_at);
  end if;
  v_prev := case when c.line_id is not null and c.last_seen_at > now() - interval '30 minutes' and not public.same_person(c.by_name, v_name) then c.by_name end;

  insert into public.recon_claims (line_id, by_name, claimed_by, claimed_at, last_seen_at)
  values (p_line_id, v_name, auth.uid(), now(), now())
  on conflict (line_id) do update
    set claimed_at = case when public.same_person(public.recon_claims.by_name, excluded.by_name) then public.recon_claims.claimed_at else now() end,
        by_name = excluded.by_name, claimed_by = excluded.claimed_by, last_seen_at = now();
  return jsonb_build_object('status', 'OK', 'taken_over_from', v_prev);
end $$;

-- Let go of a line you hold (leaving the SKU). Someone else's claim is left alone.
create or replace function public.recon_release(p_line_id uuid, p_by_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then return; end if;
  delete from public.recon_claims where line_id = p_line_id and public.same_person(by_name, p_by_name);
end $$;

revoke execute on function public.recon_claim(uuid, text, boolean), public.recon_release(uuid, text) from public, anon;
grant execute on function public.recon_claim(uuid, text, boolean), public.recon_release(uuid, text) to authenticated;

-- The list refreshes when a claim changes (same guard as 0015: plain Postgres has no publication).
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication not found; skipping';
    return;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'recon_claims') then
    execute 'alter publication supabase_realtime add table public.recon_claims';
  end if;
end $$;
