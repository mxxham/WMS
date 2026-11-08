-- =====================================================================
-- 0128  Manual loading number per shipment (Urutan muat)
--
--  4 Nov: the floor wants to type, on the Wave page, which truck is loaded
--  first, second, third... for each shipment of the day. It is a label
--  only: it never touches waves, pick_tasks, outbound, FEFO, Sisa or the
--  print order.
--   · Keyed on (planned_date, shipment_number), like shipment_assignments
--     (0110), so it survives re-running Alokasi (save_plan replaces an
--     untouched wave with a new id and the same shipment numbers).
--   · Two shipments may hold the same number for a moment (swapping 1 and
--     2 takes two edits); the page warns about the duplicate.
--   · No write policy: set_shipment_load_no (supervisor / admin) only.
-- =====================================================================

create table public.shipment_load_no (
  planned_date     date        not null,
  shipment_number  text        not null,
  load_no          int         not null check (load_no between 1 and 999),
  updated_by       text,
  updated_at       timestamptz not null default now(),
  primary key (planned_date, shipment_number)
);

alter table public.shipment_load_no enable row level security;

create policy "shipment_load_no: read" on public.shipment_load_no
for select to authenticated
using ((select public.is_active()));

grant select on public.shipment_load_no to authenticated;
grant all on public.shipment_load_no to service_role;

-- Set (or, with null, clear) one shipment's loading number on one day.
create or replace function public.set_shipment_load_no(
  p_date date,
  p_shipment text,
  p_load_no int
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ship text := trim(coalesce(p_shipment, ''));
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa mengubah urutan muat';
  end if;
  if v_ship = '' then
    raise exception 'Shipment number tidak boleh kosong';
  end if;
  if not exists (select 1 from public.waves w
                 where w.planned_date = p_date and v_ship = any(w.shipment_numbers)) then
    raise exception 'Shipment % tidak ada di wave tanggal %', v_ship, p_date;
  end if;
  if p_load_no is not null and (p_load_no < 1 or p_load_no > 999) then
    raise exception 'Urutan muat harus 1 sampai 999';
  end if;

  if p_load_no is null then
    delete from public.shipment_load_no where planned_date = p_date and shipment_number = v_ship;
  else
    insert into public.shipment_load_no (planned_date, shipment_number, load_no, updated_by, updated_at)
    values (p_date, v_ship, p_load_no,
            coalesce((select p.name from public.profiles p where p.id = auth.uid()), ''), now())
    on conflict (planned_date, shipment_number) do update
    set load_no = excluded.load_no, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  end if;
end $$;

revoke execute on function public.set_shipment_load_no(date, text, int) from public, anon;
grant execute on function public.set_shipment_load_no(date, text, int) to authenticated;

-- The Wave page refreshes live when a number changes (0015).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'alter publication supabase_realtime add table public.shipment_load_no';
  end if;
end $$;
