-- =====================================================================
-- 0003  Row Level Security
--   operator   : read stock, scan, post inbound/putaway/picking/transfer
--   supervisor : + adjustments, dashboard, label printing, logs
--   admin      : + import, users, bins/items/layout
-- =====================================================================
alter table public.profiles   enable row level security;
alter table public.bins       enable row level security;
alter table public.items      enable row level security;
alter table public.inventory  enable row level security;
alter table public.movements  enable row level security;
alter table public.scan_logs  enable row level security;
alter table public.print_logs enable row level security;
alter table public.settings   enable row level security;

-- profiles
-- Names are readable by all signed-in users so every movement shows who posted it.
create policy "profiles: read" on public.profiles for select to authenticated using (true);
create policy "profiles: admin update" on public.profiles for update to authenticated
  using (public.has_role(array['admin']::public.user_role[]))
  with check (public.has_role(array['admin']::public.user_role[]));

-- master data: everyone reads, admin writes
create policy "bins: read"  on public.bins for select to authenticated using (true);
create policy "bins: admin write" on public.bins for all to authenticated
  using (public.has_role(array['admin']::public.user_role[]))
  with check (public.has_role(array['admin']::public.user_role[]));
create policy "items: read" on public.items for select to authenticated using (true);
create policy "items: admin write" on public.items for all to authenticated
  using (public.has_role(array['admin']::public.user_role[]))
  with check (public.has_role(array['admin']::public.user_role[]));

-- inventory: read-only for every role. No insert/update/delete policy on purpose:
-- only the SECURITY DEFINER movements trigger can change stock.
create policy "inventory: read" on public.inventory for select to authenticated using (true);

-- movements: append-only. Author must be the caller; adjustments need supervisor+.
create policy "movements: read" on public.movements for select to authenticated using (true);
create policy "movements: insert" on public.movements for insert to authenticated
  with check (
    user_id = auth.uid()
    and (type <> 'adjustment' or public.has_role(array['supervisor','admin']::public.user_role[]))
  );

-- scan logs
create policy "scan_logs: insert own" on public.scan_logs for insert to authenticated
  with check (user_id = auth.uid());
create policy "scan_logs: staff read" on public.scan_logs for select to authenticated
  using (public.has_role(array['supervisor','admin']::public.user_role[]));

-- print logs (printing is supervisor+)
create policy "print_logs: staff insert" on public.print_logs for insert to authenticated
  with check (user_id = auth.uid() and public.has_role(array['supervisor','admin']::public.user_role[]));
create policy "print_logs: staff read" on public.print_logs for select to authenticated
  using (public.has_role(array['supervisor','admin']::public.user_role[]));

-- settings
create policy "settings: read" on public.settings for select to authenticated using (true);
create policy "settings: admin write" on public.settings for all to authenticated
  using (public.has_role(array['admin']::public.user_role[]))
  with check (public.has_role(array['admin']::public.user_role[]));

-- RPCs callable by signed-in users; each function checks the role itself.
revoke execute on function public.import_snapshot(jsonb, boolean, text, text[]) from public, anon;
revoke execute on function public.recompute_bin_positions() from public, anon;
revoke execute on function public.recompute_abc(int) from public, anon;
grant execute on function public.import_snapshot(jsonb, boolean, text, text[]) to authenticated;
grant execute on function public.recompute_bin_positions() to authenticated;
grant execute on function public.recompute_abc(int) to authenticated;
