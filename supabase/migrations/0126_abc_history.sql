-- =====================================================================
-- 0126  ABC classification: monthly runs with history (Kelas ABC page)
--
-- Until now an admin pressed "Hitung ulang" (recompute_abc, 0002) and the
-- old class was lost. On 1 Nov 2026 October's real picking showed 22 of
-- 124 SKUs in the wrong class, so the user asked for an ABC that keeps
-- itself current and shows its history.
--
--  * Basis: pick frequency = picking lines (movements of type 'picking')
--    per SKU over a period of Asia/Jakarta days. A = the SKUs that make
--    up the first abc_a_pct % of lines, B = up to abc_b_pct %, C = the
--    rest and every SKU not picked. The SKU that crosses a limit still
--    belongs to the class below it (October: 31 A, 30 B, 63 C).
--    Ties rank by cartons, then SKU, so a run is reproducible.
--  * abc_runs / abc_run_items: one row per run and one per SKU per run,
--    append-only (a run is only ever marked applied, once).
--  * abc_ensure_monthly(): the previous calendar month, computed and
--    applied once, by whoever opens Dashboard or Kelas ABC first in the
--    new month. A month without any picking is skipped, so classes are
--    never wiped to C by an empty period.
--  * abc_run(from, to, name, apply): a manual run (Inventory, Leader,
--    Admin), applied at once or kept as a preview.
--  * abc_apply(run, name): puts a preview's classes on items.abc_class.
--    Cycle count intervals (0014) follow items.abc_class immediately.
--  * inventory_policy gains abc_a_pct (80) and abc_b_pct (95).
-- =====================================================================

-- ---- Policy -----------------------------------------------------------------
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
    'bin_check_max_qty', 5,            -- after a pick leaving at most this many (0 included), ask what is left (0058)
    'abc_a_pct', 80,                   -- class A = SKUs making the first 80% of picking lines (0126)
    'abc_b_pct', 95                    -- class B = up to 95%; C = the rest
  );
$$;

create or replace function public.set_inventory_policy(p_value jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k text; v jsonb; merged jsonb;
begin
  if not public.has_role(array['admin']::public.user_role[]) then
    raise exception 'Hanya admin yang bisa mengubah aturan inventory';
  end if;
  if jsonb_typeof(p_value) <> 'object' then raise exception 'Format aturan tidak valid'; end if;
  for k, v in select * from jsonb_each(p_value) loop
    if not public.inventory_policy_defaults() ? k then raise exception 'Aturan % tidak dikenal', k; end if;
    if k in ('recount_on_variance', 'require_scan_on_pick') then
      if jsonb_typeof(v) <> 'boolean' then raise exception '% harus ya/tidak', k; end if;
    elsif k = 'count_tolerance_qty' then
      if jsonb_typeof(v) <> 'object' or not (v ?& array['A', 'B', 'C']) then raise exception 'Toleransi hitung butuh nilai A, B dan C'; end if;
      if exists (select 1 from jsonb_each(v) e where jsonb_typeof(e.value) <> 'number' or (e.value)::numeric < 0) then
        raise exception 'Toleransi hitung harus angka ≥ 0';
      end if;
    elsif jsonb_typeof(v) <> 'number' or (v)::numeric < 0 then
      raise exception '% harus angka ≥ 0', k;
    end if;
  end loop;
  if (p_value ? 'default_shelf_life_months') and ((p_value->>'default_shelf_life_months')::numeric not between 1 and 240) then
    raise exception 'Umur simpan 1–240 bulan';
  end if;
  if (p_value ? 'ira_target_pct') and ((p_value->>'ira_target_pct')::numeric > 100) then
    raise exception 'Target akurasi maksimal 100%%';
  end if;
  if (p_value ? 'pick_accuracy_target_pct') and ((p_value->>'pick_accuracy_target_pct')::numeric > 100) then
    raise exception 'Target akurasi picking maksimal 100%%';
  end if;
  merged := public.inventory_policy() || p_value;
  if not ((merged->>'abc_a_pct')::numeric > 0 and (merged->>'abc_a_pct')::numeric < (merged->>'abc_b_pct')::numeric
          and (merged->>'abc_b_pct')::numeric < 100) then
    raise exception 'Batas ABC: 0 < A < B < 100 (persen baris picking kumulatif)';
  end if;
  insert into public.settings (key, value, updated_at) values ('inventory_policy', merged, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return merged;
end $$;

-- ---- History ----------------------------------------------------------------
create table public.abc_runs (
  id              uuid primary key default gen_random_uuid(),
  period_from     date not null,            -- Jakarta days, inclusive
  period_to       date not null,
  a_pct           numeric not null,
  b_pct           numeric not null,
  source          text not null check (source in ('AUTO', 'MANUAL')),
  total_lines     int not null,
  total_cartons   numeric not null,
  sku_count       int not null,
  created_at      timestamptz not null default now(),
  created_by      uuid default auth.uid(),
  created_by_name text not null,
  applied_at      timestamptz,
  applied_by_name text,
  check (period_from <= period_to),
  check (a_pct > 0 and a_pct < b_pct and b_pct < 100)
);
-- One automatic run per month, however many people open the page at once.
create unique index abc_runs_auto_month on public.abc_runs (period_from) where source = 'AUTO';
create index abc_runs_created_idx on public.abc_runs (created_at desc);

create table public.abc_run_items (
  run_id      uuid not null references public.abc_runs(id),
  item_id     uuid not null references public.items(id),
  sku         text not null,
  description text,
  class       text not null check (class in ('A', 'B', 'C')),
  prev_class  text,                         -- items.abc_class when the run was made
  rank        int not null,
  pick_lines  int not null,
  cartons     numeric not null,
  pick_days   int not null,                 -- Jakarta days with at least one pick
  share       numeric not null,             -- of all picking lines in the period, 0..1
  cum_share   numeric not null,             -- running total up to and including this SKU
  primary key (run_id, item_id)
);
create index abc_run_items_item_idx on public.abc_run_items (item_id);

-- Append-only: a run may only be marked applied, once; nothing is deleted.
create or replace function public.abc_runs_forbid_change() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if old.applied_at is null and new.applied_at is not null
       and (to_jsonb(new) - 'applied_at' - 'applied_by_name') = (to_jsonb(old) - 'applied_at' - 'applied_by_name') then
      return new;
    end if;
  end if;
  raise exception 'Riwayat ABC tidak bisa diubah atau dihapus: buat perhitungan baru';
end $$;
create or replace function public.abc_items_forbid_change() returns trigger language plpgsql as $$
begin
  raise exception 'Riwayat ABC tidak bisa diubah atau dihapus: buat perhitungan baru';
end $$;
create trigger abc_runs_forbid_change before update or delete on public.abc_runs
  for each row execute function public.abc_runs_forbid_change();
create trigger abc_run_items_forbid_change before update or delete on public.abc_run_items
  for each row execute function public.abc_items_forbid_change();

alter table public.abc_runs enable row level security;
alter table public.abc_run_items enable row level security;
create policy "abc_runs: read" on public.abc_runs for select to authenticated using ((select public.is_active()));
create policy "abc_run_items: read" on public.abc_run_items for select to authenticated using ((select public.is_active()));
grant select on public.abc_runs, public.abc_run_items to authenticated;

-- ---- Engine -----------------------------------------------------------------
-- Computes and stores a run; never applies it. Callers check the role. Returns null when the period
-- has no picking at all (nothing to classify by).
create or replace function public.abc_compute(p_from date, p_to date, p_source text, p_by_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_a numeric := (public.inventory_policy()->>'abc_a_pct')::numeric;
  v_b numeric := (public.inventory_policy()->>'abc_b_pct')::numeric;
  v_t0 timestamptz := p_from::timestamp at time zone 'Asia/Jakarta';
  v_t1 timestamptz := (p_to + 1)::timestamp at time zone 'Asia/Jakarta';
  v_lines int; v_cartons numeric; v_run uuid;
begin
  select count(*), coalesce(sum(quantity), 0) into v_lines, v_cartons
  from public.movements where type = 'picking' and quantity > 0 and created_at >= v_t0 and created_at < v_t1;
  if v_lines = 0 then return null; end if;

  insert into public.abc_runs (period_from, period_to, a_pct, b_pct, source, total_lines, total_cartons, sku_count, created_by_name)
  values (p_from, p_to, v_a, v_b, p_source, v_lines, v_cartons, (select count(*) from public.items), p_by_name)
  returning id into v_run;

  insert into public.abc_run_items (run_id, item_id, sku, description, class, prev_class, rank, pick_lines, cartons, pick_days, share, cum_share)
  with picks as (
    select m.item_id, count(*)::int as lines, sum(m.quantity) as cartons,
           count(distinct (m.created_at at time zone 'Asia/Jakarta')::date)::int as days
    from public.movements m
    where m.type = 'picking' and m.quantity > 0 and m.created_at >= v_t0 and m.created_at < v_t1
    group by m.item_id
  ), ranked as (
    select it.id as item_id, it.sku, it.description, it.abc_class as prev,
           coalesce(p.lines, 0) as lines, coalesce(p.cartons, 0) as cartons, coalesce(p.days, 0) as days,
           row_number() over (order by coalesce(p.lines, 0) desc, coalesce(p.cartons, 0) desc, it.sku)::int as rk
    from public.items it left join picks p on p.item_id = it.id
  ), shares as (
    select r.*, r.lines::numeric / v_lines as share, (sum(r.lines) over (order by r.rk))::numeric / v_lines as cum
    from ranked r
  )
  select v_run, item_id, sku, description,
         case when lines = 0 then 'C'
              when (cum - share) * 100 < v_a then 'A'
              when (cum - share) * 100 < v_b then 'B'
              else 'C' end,
         prev, rk, lines, cartons, days, share, cum
  from shares;
  return v_run;
end $$;

create or replace function public.abc_apply_run(p_run uuid, p_by_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.abc_runs set applied_at = now(), applied_by_name = p_by_name where id = p_run and applied_at is null;
  if not found then raise exception 'Perhitungan ABC tidak ada atau sudah diterapkan'; end if;
  update public.items i set abc_class = ri.class from public.abc_run_items ri where ri.run_id = p_run and ri.item_id = i.id;
end $$;

-- A manual run. p_apply = false keeps it as a preview to look at first.
create or replace function public.abc_run(p_from date, p_to date, p_by_name text, p_apply boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_name text := public.person_name(p_by_name); v_today date := (now() at time zone 'Asia/Jakarta')::date; v_run uuid;
begin
  if not public.has_job(array['inventory', 'leader', 'admin']) then
    raise exception 'Hanya Inventory, Leader atau Admin yang bisa menghitung kelas ABC';
  end if;
  if p_from is null or p_to is null or p_from > p_to then raise exception 'Periode tidak valid'; end if;
  if p_to > v_today then raise exception 'Periode tidak boleh sampai masa depan'; end if;
  if p_to - p_from > 366 then raise exception 'Periode maksimal 1 tahun'; end if;
  perform pg_advisory_xact_lock(hashtext('abc_run'));
  v_run := public.abc_compute(p_from, p_to, 'MANUAL', v_name);
  if v_run is null then raise exception 'Tidak ada picking pada % s/d %', to_char(p_from, 'DD-MM-YYYY'), to_char(p_to, 'DD-MM-YYYY'); end if;
  if p_apply then perform public.abc_apply_run(v_run, v_name); end if;
  return v_run;
end $$;

create or replace function public.abc_apply(p_run uuid, p_by_name text)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text := public.person_name(p_by_name);
begin
  if not public.has_job(array['inventory', 'leader', 'admin']) then
    raise exception 'Hanya Inventory, Leader atau Admin yang bisa menerapkan kelas ABC';
  end if;
  perform pg_advisory_xact_lock(hashtext('abc_run'));
  perform public.abc_apply_run(p_run, v_name);
end $$;

-- The previous calendar month (Jakarta), computed and applied once. Any active account may trigger it:
-- it only ever does the one thing, and the unique index makes a second call a no-op.
create or replace function public.abc_ensure_monthly()
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_to date := date_trunc('month', (now() at time zone 'Asia/Jakarta')::date)::date - 1;
  v_from date := date_trunc('month', v_to)::date;
  v_run uuid;
begin
  if auth.uid() is not null and not public.is_active() then return null; end if;
  if exists (select 1 from public.abc_runs where source = 'AUTO' and period_from = v_from) then return null; end if;
  perform pg_advisory_xact_lock(hashtext('abc_run'));
  if exists (select 1 from public.abc_runs where source = 'AUTO' and period_from = v_from) then return null; end if;
  v_run := public.abc_compute(v_from, v_to, 'AUTO', 'Otomatis (bulanan)');
  if v_run is not null then perform public.abc_apply_run(v_run, 'Otomatis (bulanan)'); end if;
  return v_run;
end $$;

revoke execute on function public.abc_compute(date, date, text, text), public.abc_apply_run(uuid, text),
  public.abc_runs_forbid_change(), public.abc_items_forbid_change() from public, anon, authenticated;
revoke execute on function public.abc_run(date, date, text, boolean), public.abc_apply(uuid, text),
  public.abc_ensure_monthly() from public, anon;
grant execute on function public.abc_run(date, date, text, boolean), public.abc_apply(uuid, text),
  public.abc_ensure_monthly() to authenticated;
