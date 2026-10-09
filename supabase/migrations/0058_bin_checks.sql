-- =====================================================================
-- 0058  Cek sisa bin: a near-zero check right after a pick
--
--  5 Oct: CC25A01 showed 3 cartons after the pick, the picker had found 1,
--  and nobody knew until a later wave came up short. A WMS asks the person
--  standing at the bin while it is cheap: when a posted pick (or a pallet's
--  Bin To Bin) leaves that SKU + batch with few cartons in the bin — at most
--  inventory_policy.bin_check_max_qty, 0 included — the Posting dialog asks
--  "how many are left?", blind (the system number is not shown).
--
--    bin_left_after(task)        what the posted task left in its source bin,
--                                and whether to ask
--    record_bin_check(task, n)   logs the answer in bin_checks; an answer that
--                                differs from the system opens a count task on
--                                the bin (source PICK). Stock is not changed
--                                by a glance: the count settles it.
-- =====================================================================

create or replace function public.inventory_policy_defaults()
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'default_shelf_life_months', 48,   -- Shell packaged lubricants: production + 4 years
    'min_dispatch_days', 0,            -- refuse to ship stock with fewer days left
    'near_expiry_days', 180,           -- "ship first / report to Shell" window
    'adjust_approval_qty', 20,         -- |adjustment| above this (cartons) needs a second person
    'count_tolerance_qty', jsonb_build_object('A', 0, 'B', 0, 'C', 0),  -- per bin, cartons
    'recount_on_variance', true,       -- a count off by more than the tolerance is recounted blind
    'ira_target_pct', 98,
    'require_scan_on_pick', false,     -- pick confirmation needs the carton barcode
    'pick_accuracy_target_pct', 99.5,  -- first-attempt line accuracy of the picking audit (0024)
    'bin_check_max_qty', 5             -- after a pick leaving at most this many (0 included), ask what is left (0058)
  );
$$;

create table public.bin_checks (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid references public.pick_tasks(id) on delete set null,
  bin_id      uuid not null references public.bins(id),
  item_id     uuid not null references public.items(id),
  batch_lot   text not null default '',
  expiry_date date,
  expected    numeric not null,
  seen        numeric not null check (seen >= 0),
  by_name     text not null,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create index bin_checks_created_idx on public.bin_checks (created_at desc);
create index bin_checks_bin_idx on public.bin_checks (bin_id, created_at desc);
alter table public.bin_checks enable row level security;
create policy "bin_checks: read" on public.bin_checks for select to authenticated using (true);
grant select on public.bin_checks to authenticated;
grant all on public.bin_checks to service_role;

-- The bin a posted task took from, as posted (the actual source when it deviated).
create or replace function public.bin_left_after(p_task_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t public.pick_tasks%rowtype; v_bin uuid; v_batch text; v_exp date; v_left numeric; v_max numeric;
begin
  if not public.has_role(array['operator','supervisor','admin']::public.user_role[]) then
    raise exception 'Sign in to post tasks';
  end if;
  select * into t from public.pick_tasks where id = p_task_id;
  if t.id is null or t.status <> 'COMPLETED' then return jsonb_build_object('ask', false); end if;
  v_bin := coalesce(t.actual_from_bin_id, t.from_bin_id);
  v_batch := coalesce(t.actual_batch_lot, t.batch_lot);
  v_exp := coalesce(t.actual_expiry_date, t.expiry_date);
  select coalesce(sum(quantity), 0) into v_left from public.inventory
  where bin_id = v_bin and item_id = t.item_id and batch_lot = v_batch and expiry_date is not distinct from v_exp;
  v_max := coalesce((public.inventory_policy()->>'bin_check_max_qty')::numeric, 5);
  return jsonb_build_object('ask', v_max >= 0 and v_left <= v_max,
    'bin', (select bin_code from public.bins where id = v_bin),
    'sku', (select sku from public.items where id = t.item_id), 'batch', v_batch);
end $$;

create or replace function public.record_bin_check(p_task_id uuid, p_seen numeric, p_by_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text; t public.pick_tasks%rowtype; v_bin uuid; v_code text; v_batch text; v_exp date; v_sku text;
  v_have numeric; v_wave text;
begin
  if not public.has_role(array['operator','supervisor','admin']::public.user_role[]) then
    raise exception 'Sign in to post tasks';
  end if;
  v_name := public.person_name(p_by_name, 'Nama picker');
  if p_seen is null or p_seen < 0 or p_seen <> trunc(p_seen) then raise exception 'Isi jumlah karton yang terlihat (0 atau lebih)'; end if;
  select * into t from public.pick_tasks where id = p_task_id;
  if t.id is null or t.status <> 'COMPLETED' then raise exception 'Tugas ini belum diposting'; end if;
  v_bin := coalesce(t.actual_from_bin_id, t.from_bin_id);
  v_batch := coalesce(t.actual_batch_lot, t.batch_lot);
  v_exp := coalesce(t.actual_expiry_date, t.expiry_date);
  select coalesce(sum(quantity), 0) into v_have from public.inventory
  where bin_id = v_bin and item_id = t.item_id and batch_lot = v_batch and expiry_date is not distinct from v_exp;
  select bin_code into v_code from public.bins where id = v_bin;
  select sku into v_sku from public.items where id = t.item_id;
  select wave_no into v_wave from public.waves where id = t.wave_id;

  insert into public.bin_checks (task_id, bin_id, item_id, batch_lot, expiry_date, expected, seen, by_name)
  values (t.id, v_bin, t.item_id, v_batch, v_exp, v_have, p_seen, v_name);

  if p_seen <> v_have then
    insert into public.count_tasks (bin_id, reason, source, created_by)
    values (v_bin, format('Cek sisa setelah NO %s #%s: sistem %s, dilihat %s (SKU %s batch %s, %s)',
                          v_wave, t.seq, v_have, p_seen, v_sku, v_batch, v_name), 'PICK', auth.uid())
    on conflict (bin_id) where status in ('OPEN', 'COUNTED', 'RECOUNT')
    do update set reason = public.count_tasks.reason || '; ' || excluded.reason;
  end if;
  return jsonb_build_object('match', p_seen = v_have, 'bin', v_code, 'expected', v_have, 'seen', p_seen);
end $$;

revoke execute on function public.bin_left_after(uuid), public.record_bin_check(uuid, numeric, text) from public, anon;
grant execute on function public.bin_left_after(uuid), public.record_bin_check(uuid, numeric, text) to authenticated;
