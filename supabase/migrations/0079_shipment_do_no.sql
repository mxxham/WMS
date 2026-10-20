-- =====================================================================
-- 0079  Shipment DO numbers per picklist
--
--  DO numbers arrive on Shell delivery papers after allocation. They are
--  entered per picklist (one shipment within one wave) on the Wave page
--  and printed on the picksheet's "DO Number" line, appended to the WMS
--  order numbers that come from outbound.order_nos. The allocator engine
--  stays pure and untouched; manual DOs are merged only at the print edge.
-- =====================================================================

create table public.shipment_do_no (
  wave_id          uuid        not null references public.waves(id) on delete cascade,
  shipment_number  text        not null,
  do_nos           jsonb       not null default '[]'::jsonb,
  updated_by       text,
  updated_at       timestamptz not null default now(),
  primary key (wave_id, shipment_number),
  check (jsonb_typeof(do_nos) = 'array')
);

alter table public.shipment_do_no enable row level security;

-- Read by any active signed-in user (operator, supervisor, admin).
create policy "shipment_do_no: read" on public.shipment_do_no
for select to authenticated
using ((select public.is_active()));

-- No write policy. Writes only via the SECURITY DEFINER RPC below
-- (per AGENTS.md: "Plan tables have no write policy").

-- Explicit grants (0005 pattern): authenticated reads, service_role all.
grant select on public.shipment_do_no to authenticated;
grant all on public.shipment_do_no to service_role;

-- RPC: set DO numbers for one shipment in one wave.
-- Only supervisor or admin may call. Replaces the list (idempotent).
-- Empty list deletes the row.
create or replace function public.set_shipment_dos(
  p_wave_id uuid,
  p_shipment text,
  p_dos jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  w public.waves%rowtype;
  v_clean jsonb;
  v_elem text;
  v_seen jsonb := '[]'::jsonb;
begin
  -- Role check: supervisor or admin only.
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa mengubah DO number';
  end if;

  -- Shipment must not be null/empty and must belong to the wave.
  if p_shipment is null or trim(p_shipment) = '' then
    raise exception 'Shipment number tidak boleh kosong';
  end if;

  select * into w from public.waves where id = p_wave_id;
  if w.id is null then
    raise exception 'Wave tidak ditemukan';
  end if;
  if not trim(p_shipment) = any(w.shipment_numbers) then
    raise exception 'Shipment % tidak ada di wave ini', trim(p_shipment);
  end if;

  -- Normalise: trim each element, drop empties and duplicates (case-sensitive),
  -- cap element length at 40 chars, cap list length at 20.
  v_clean := '[]'::jsonb;
  for v_elem in select jsonb_array_elements_text(coalesce(p_dos, '[]'::jsonb))
  loop
    v_elem := trim(v_elem);
    if v_elem <> '' and length(v_elem) <= 40
       and not (v_elem = any(select jsonb_array_elements_text(v_seen)))
    then
      v_seen := v_seen || jsonb_build_array(v_elem);
      v_clean := v_clean || jsonb_build_array(v_elem);
    end if;
    -- Stop at 20 elements.
    if jsonb_array_length(v_clean) >= 20 then
      exit;
    end if;
  end loop;

  -- Upsert or delete.
  if jsonb_array_length(v_clean) = 0 then
    delete from public.shipment_do_no
    where wave_id = p_wave_id and shipment_number = trim(p_shipment);
  else
    insert into public.shipment_do_no (wave_id, shipment_number, do_nos, updated_by, updated_at)
    values (p_wave_id, trim(p_shipment), v_clean,
            coalesce(current_setting('app.by_name', true), ''), now())
    on conflict (wave_id, shipment_number) do update
    set do_nos = excluded.do_nos,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;
  end if;
end $$;

revoke execute on function public.set_shipment_dos(uuid, text, jsonb) from public, anon;
grant execute on function public.set_shipment_dos(uuid, text, jsonb) to authenticated;