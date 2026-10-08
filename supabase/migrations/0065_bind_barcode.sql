-- =====================================================================
-- 0065  Bind a carton barcode to one SKU, audited
--
--  bind_barcode()   The only writer of items.ean. Keeps set_item_control's
--                   role check (supervisor/admin), the 8-14 digit rule and
--                   its Indonesian messages, but touches ONLY ean - unlike
--                   set_item_control it cannot clear shelf life or the
--                   dispatch minimum. Passing a null/empty p_code clears
--                   the binding.
--                   Refused when the code already belongs to another SKU's
--                   barcode (barcode_norm) OR to another SKU's SKU code,
--                   because item_by_barcode matches both and a scan would
--                   otherwise be ambiguous.
--  item_barcode_log append-only: sku, old_ean, new_ean, who, when. Written
--                   inside the RPC; no write policy, so the app cannot
--                   forge or edit it.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Append-only bind log
-- ---------------------------------------------------------------------
create table public.item_barcode_log (
  id         uuid primary key default gen_random_uuid(),
  sku        text not null,
  old_ean    text,
  new_ean    text,
  user_id    uuid references public.profiles(id),
  user_name  text,
  created_at timestamptz not null default now()
);
create index item_barcode_log_created_idx on public.item_barcode_log (created_at desc);

alter table public.item_barcode_log enable row level security;
create policy "item_barcode_log: read" on public.item_barcode_log for select to authenticated using (true);
-- No write policies: written only through bind_barcode().

-- ---------------------------------------------------------------------
-- 2. Bind / rebind / clear
-- ---------------------------------------------------------------------
create or replace function public.bind_barcode(p_sku text, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_sku   text := trim(coalesce(p_sku, ''));
  v_code  text := nullif(upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g')), '');
  v_owner text;
  v_old   text;
  v_name  text;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa mengubah master item';
  end if;
  if v_sku = '' then raise exception 'SKU wajib diisi'; end if;
  if not exists (select 1 from public.items where sku = v_sku) then
    raise exception 'SKU % tidak ada di master item', p_sku;
  end if;
  if v_code is not null and v_code !~ '^\d{8,14}$' then
    raise exception 'Barcode % tidak valid (8–14 angka)', p_code;
  end if;

  -- The code must not be another SKU's barcode ...
  select sku into v_owner from public.items where barcode_norm = v_code and sku <> v_sku;
  if v_owner is not null then raise exception 'Barcode % sudah dipakai SKU %', v_code, v_owner; end if;
  -- ... nor another SKU's SKU code (item_by_barcode matches both).
  select sku into v_owner from public.items where sku = v_code and sku <> v_sku;
  if v_owner is not null then raise exception 'Barcode % sama dengan kode SKU %', v_code, v_owner; end if;

  select ean into v_old from public.items where sku = v_sku for update;
  update public.items set ean = v_code where sku = v_sku;

  if v_old is distinct from v_code then
    select name into v_name from public.profiles where id = auth.uid();
    insert into public.item_barcode_log (sku, old_ean, new_ean, user_id, user_name)
    values (v_sku, v_old, v_code, auth.uid(), v_name);
  end if;

  return jsonb_build_object('sku', v_sku, 'old_ean', v_old, 'ean', v_code);
end $$;

-- ---------------------------------------------------------------------
-- 3. Grants
-- ---------------------------------------------------------------------
grant select on public.item_barcode_log to authenticated;
revoke execute on function public.bind_barcode(text, text) from public, anon;
grant execute on function public.bind_barcode(text, text) to authenticated;
