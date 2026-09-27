-- =====================================================================
-- 0016  Inventory control: policy, item master, Shell batch codes
--
--  inventory_policy()     One set of rules every control reads (settings
--                         key 'inventory_policy' over built-in defaults):
--                         shelf life, dispatch minimum, near-expiry
--                         window, approval threshold, count tolerance,
--                         accuracy target, scan-on-pick.
--  items                  + ean (carton barcode), shelf_life_months,
--                         min_dispatch_days (per-SKU overrides).
--  batch_mfg_date         Shell date-coded batches "ddMyyPP" (14H26JJ =
--                         14 Aug 2026, plant JJ; months A..L). Expiry of
--                         such a batch = production date + shelf life, so
--                         a typed expiry can be checked against the batch.
--  person_name            Every control step records who did it by name
--                         (counter, approver, receiver ...). Required.
-- =====================================================================

alter table public.items
  add column if not exists ean text,
  add column if not exists shelf_life_months int check (shelf_life_months between 1 and 240),
  add column if not exists min_dispatch_days int check (min_dispatch_days between 0 and 3650);
create unique index if not exists items_ean_uq on public.items (ean) where ean is not null;

-- Built-in defaults; the settings row only overrides what it sets.
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
    'require_scan_on_pick', false      -- pick confirmation needs the carton barcode
  );
$$;

insert into public.settings (key, value) values ('inventory_policy', public.inventory_policy_defaults())
on conflict (key) do nothing;

create or replace function public.inventory_policy()
returns jsonb language sql stable security definer set search_path = public as $$
  select public.inventory_policy_defaults()
         || coalesce((select value from public.settings where key = 'inventory_policy'), '{}'::jsonb);
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
  merged := public.inventory_policy() || p_value;
  insert into public.settings (key, value, updated_at) values ('inventory_policy', merged, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return merged;
end $$;

-- ---------------------------------------------------------------------
-- Shell date-coded batch: dd + month letter (A=Jan .. L=Dec) + yy + plant.
-- Null for any other batch format (SAP 8-digit lots, blanks, ...).
-- ---------------------------------------------------------------------
create or replace function public.batch_mfg_date(p_batch text)
returns date language plpgsql immutable as $$
declare m text[];
begin
  m := regexp_match(upper(trim(coalesce(p_batch, ''))), '^(\d{2})([A-L])(\d{2})[A-Z]{2}$');
  if m is null then return null; end if;
  return make_date(2000 + m[3]::int, ascii(m[2]) - ascii('A') + 1, m[1]::int);
exception when others then
  return null;  -- day 31 in a 30-day month etc.: not a date code
end $$;

-- Expected expiry of a batch for an item (null when the batch is not date-coded).
create or replace function public.batch_expected_expiry(p_item_id uuid, p_batch text)
returns date language sql stable security definer set search_path = public as $$
  select (public.batch_mfg_date(p_batch)
          + make_interval(months => coalesce((select shelf_life_months from public.items where id = p_item_id),
                                             (public.inventory_policy()->>'default_shelf_life_months')::int)))::date;
$$;

-- Minimum days of life left to dispatch, per item (item override, else policy).
create or replace function public.item_min_dispatch_days(p_item_id uuid)
returns int language sql stable security definer set search_path = public as $$
  select coalesce((select min_dispatch_days from public.items where id = p_item_id),
                  (public.inventory_policy()->>'min_dispatch_days')::int);
$$;

-- A person's name as typed on a control step. Required, trimmed, one space.
create or replace function public.person_name(p_name text, p_role text default 'Nama petugas')
returns text language plpgsql immutable as $$
declare v text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
begin
  if length(v) < 2 then raise exception '% wajib diisi', p_role; end if;
  return v;
end $$;

create or replace function public.same_person(a text, b text)
returns boolean language sql immutable as $$
  select lower(regexp_replace(trim(coalesce(a, '')), '\s+', ' ', 'g')) = lower(regexp_replace(trim(coalesce(b, '')), '\s+', ' ', 'g'))
     and coalesce(trim(a), '') <> '';
$$;

-- Item master fields that inventory control owns (supervisor/admin).
create or replace function public.set_item_control(p_sku text, p_ean text, p_shelf_life_months int, p_min_dispatch_days int)
returns void language plpgsql security definer set search_path = public as $$
declare v_ean text := nullif(regexp_replace(coalesce(p_ean, ''), '\s', '', 'g'), ''); v_owner text;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa mengubah master item';
  end if;
  if v_ean is not null and v_ean !~ '^\d{8,14}$' then raise exception 'Barcode % tidak valid (8–14 angka)', p_ean; end if;
  select sku into v_owner from public.items where ean = v_ean and sku <> p_sku;
  if v_owner is not null then raise exception 'Barcode % sudah dipakai SKU %', v_ean, v_owner; end if;
  update public.items set ean = v_ean, shelf_life_months = p_shelf_life_months, min_dispatch_days = p_min_dispatch_days
  where sku = p_sku;
  if not found then raise exception 'SKU % tidak ada di master item', p_sku; end if;
end $$;

-- Barcode -> item (scan verification on the floor).
create or replace function public.item_by_barcode(p_code text)
returns table (sku text, description text, uom text, upp numeric) language sql stable security definer set search_path = public as $$
  select sku, description, uom, upp from public.items
  where ean = regexp_replace(coalesce(p_code, ''), '\s', '', 'g') or sku = trim(coalesce(p_code, ''));
$$;

grant execute on function public.inventory_policy(), public.inventory_policy_defaults(), public.batch_mfg_date(text),
  public.batch_expected_expiry(uuid, text), public.item_min_dispatch_days(uuid), public.person_name(text, text),
  public.same_person(text, text), public.item_by_barcode(text) to authenticated;
revoke execute on function public.set_inventory_policy(jsonb), public.set_item_control(text, text, int, int) from public, anon;
grant execute on function public.set_inventory_policy(jsonb), public.set_item_control(text, text, int, int) to authenticated;
