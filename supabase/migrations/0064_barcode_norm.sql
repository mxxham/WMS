-- =====================================================================
-- 0064  Barcode: one canonical, normalized form
--
--  Why: items.ean is stored as typed (set_item_control strips whitespace,
--  but a direct write and a differently formatted scan can still disagree).
--  Scanning must resolve a carton code the same way every time, so the
--  barcode gets one canonical form — whitespace removed, upper case — and
--  only that form is compared and made unique.
--
--  items          + barcode_norm, a generated column derived from ean.
--  item_by_barcode  resolves a scan against barcode_norm (still falls back
--                   to the SKU, which the pick/check screens also accept).
--  barcode_lookup   first-class scan outcome: 'KNOWN' or 'UNKNOWN_BARCODE'.
--                   A code that matches no item is answered with a definite
--                   outcome, not an empty result that callers may misread.
--                   (WRONG_ITEM / OVER_SCAN / ACCEPTED are decided against
--                   the order, in the check layer — not here.)
--  set_item_control keeps its rule and messages; its duplicate check now
--  reads barcode_norm so it can never be bypassed by formatting.
--
--  qty_per_scan is always 1 carton, so there is no barcode table: an item
--  carries exactly one barcode, and item_by_barcode already returns its
--  uom/upp. A SKU with more than one barcode is out of scope.
--
--  Additive only. No data changes: items.ean is empty in every project so
--  the unique index backfills without conflict.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Canonical barcode form (generated, so it cannot drift from ean)
-- ---------------------------------------------------------------------
alter table public.items
  add column if not exists barcode_norm text
  generated always as (
    nullif(upper(regexp_replace(coalesce(ean, ''), '\s', '', 'g')), '')
  ) stored;

create unique index if not exists items_barcode_norm_uq
  on public.items (barcode_norm) where barcode_norm is not null;

-- ---------------------------------------------------------------------
-- 2. Scan resolution uses the canonical form
-- ---------------------------------------------------------------------
create or replace function public.item_by_barcode(p_code text)
returns table (sku text, description text, uom text, upp numeric)
language sql stable security definer set search_path = public as $$
  select i.sku, i.description, i.uom, i.upp
  from public.items i
  where i.barcode_norm = nullif(upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g')), '')
     or i.sku = trim(coalesce(p_code, ''))
  order by i.sku;
$$;

-- ---------------------------------------------------------------------
-- 3. First-class outcome for a code that matches nothing
-- ---------------------------------------------------------------------
create or replace function public.barcode_lookup(p_code text)
returns table (outcome text, sku text, description text, uom text, upp numeric)
language sql stable security definer set search_path = public as $$
  with input as (
    select nullif(upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g')), '') as norm,
           trim(coalesce(p_code, '')) as raw
  ), hit as (
    select i.sku, i.description, i.uom, i.upp
    from public.items i, input
    where (input.norm is not null and i.barcode_norm = input.norm)
       or i.sku = input.raw
    order by (i.barcode_norm = input.norm) desc nulls last, i.sku
    limit 1
  )
  select 'KNOWN'::text, h.sku, h.description, h.uom, h.upp from hit h
  union all
  select 'UNKNOWN_BARCODE'::text, null::text, null::text, null::text, null::numeric
  from input
  where not exists (select 1 from hit);
$$;

-- ---------------------------------------------------------------------
-- 4. The bind path (master item) validates against the same form
-- ---------------------------------------------------------------------
create or replace function public.set_item_control(p_sku text, p_ean text, p_shelf_life_months int, p_min_dispatch_days int)
returns void language plpgsql security definer set search_path = public as $$
declare v_ean text := nullif(upper(regexp_replace(coalesce(p_ean, ''), '\s', '', 'g')), ''); v_owner text;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa mengubah master item';
  end if;
  if v_ean is not null and v_ean !~ '^\d{8,14}$' then raise exception 'Barcode % tidak valid (8–14 angka)', p_ean; end if;
  select sku into v_owner from public.items where barcode_norm = v_ean and sku <> p_sku;
  if v_owner is not null then raise exception 'Barcode % sudah dipakai SKU %', v_ean, v_owner; end if;
  update public.items set ean = v_ean, shelf_life_months = p_shelf_life_months, min_dispatch_days = p_min_dispatch_days
  where sku = p_sku;
  if not found then raise exception 'SKU % tidak ada di master item', p_sku; end if;
end $$;

-- ---------------------------------------------------------------------
-- 5. Grants (same split as 0016: read open to signed-in, write not anon)
-- ---------------------------------------------------------------------
revoke execute on function public.barcode_lookup(text) from public, anon;
grant execute on function public.item_by_barcode(text), public.barcode_lookup(text) to authenticated;
revoke execute on function public.set_item_control(text, text, int, int) from public, anon;
grant execute on function public.set_item_control(text, text, int, int) to authenticated;
