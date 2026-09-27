-- =====================================================================
-- 0009  Fixed pickface per SKU
--
--  A supervisor assigns each SKU its own pick-from bin. The allocator
--  uses it instead of re-deriving one every run (config.pickfaceOverrides),
--  so replenishment always tops up the same bin. One bin per SKU and one
--  SKU per bin. SKUs without a row keep the automatic choice.
-- =====================================================================

create table public.pickfaces (
  item_id    uuid primary key references public.items(id),
  bin_id     uuid not null unique references public.bins(id),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

alter table public.pickfaces enable row level security;
create policy "pickfaces: read" on public.pickfaces for select to authenticated using (true);
-- No write policies: changes go through set_pickfaces().

create or replace view public.pickface_detail with (security_invoker = true) as
select it.sku, it.description, b.bin_code, b.status as bin_status, p.updated_at, pr.name as updated_by_name
from public.pickfaces p
join public.items it on it.id = p.item_id
join public.bins b on b.id = p.bin_id
left join public.profiles pr on pr.id = p.updated_by;

-- p_rows: [{sku, bin_code}] ; bin_code null or '' removes the assignment.
-- All rows or none: the first invalid row aborts with a message naming it.
create or replace function public.set_pickfaces(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; v_item uuid; v_bin public.bins%rowtype; v_owner text; n_set int := 0; n_cleared int := 0;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa mengatur pickface';
  end if;

  -- Clear first, so a swap (A -> bin of B, B -> bin of A) in one call works.
  for r in select * from jsonb_array_elements(p_rows) loop
    select id into v_item from public.items where sku = r->>'sku';
    if v_item is null then raise exception 'SKU % tidak ada di master data', r->>'sku'; end if;
    delete from public.pickfaces where item_id = v_item;
    if coalesce(r->>'bin_code', '') = '' then n_cleared := n_cleared + 1; end if;
  end loop;

  for r in select * from jsonb_array_elements(p_rows) loop
    continue when coalesce(r->>'bin_code', '') = '';
    select * into v_bin from public.bins where bin_code = upper(trim(r->>'bin_code'));
    if v_bin.id is null then raise exception 'Bin % tidak ada', r->>'bin_code'; end if;
    if v_bin.rack is null then raise exception 'Bin % bukan lokasi rak (SKU %)', v_bin.bin_code, r->>'sku'; end if;
    if v_bin.status = 'blocked' then raise exception 'Bin % diblokir (SKU %)', v_bin.bin_code, r->>'sku'; end if;
    select it.sku into v_owner from public.pickfaces p join public.items it on it.id = p.item_id where p.bin_id = v_bin.id;
    if v_owner is not null then
      raise exception 'Bin % sudah jadi pickface SKU %', v_bin.bin_code, v_owner;
    end if;
    insert into public.pickfaces (item_id, bin_id, updated_by)
    values ((select id from public.items where sku = r->>'sku'), v_bin.id, auth.uid());
    n_set := n_set + 1;
  end loop;

  return jsonb_build_object('set', n_set, 'cleared', n_cleared);
end $$;

grant select on public.pickfaces, public.pickface_detail to authenticated;
grant all on public.pickfaces to service_role;
revoke execute on function public.set_pickfaces(jsonb) from public, anon;
grant execute on function public.set_pickfaces(jsonb) to authenticated;
