-- =====================================================================
-- 0036  A parked (Tunda) wave carried over to a later day
--
--  A rescheduled order comes back on a later Schedule of the day, often
--  under a NEW shipment number. Its old wave still reserves its stock
--  (open_pick_tasks, 0007) and a new plan only skips shipments of its own
--  date, so the order would be planned twice. The Alokasi page matches
--  today's lines to parked orders (same SKU + Order No) and, by default,
--  carries the old wave over instead of planning it again:
--
--  parked_orders(date)   order lines of RESCHEDULED waves up to that date
--  carry_over_wave(...)  the wave moves to the new date, active again,
--                        renamed T<NO> (NO is unique per day) and with its
--                        shipments renamed old -> new everywhere. Its
--                        tasks, reservations and postings stay as they are.
--  Run after save_plan, which replaces the date's untouched waves.
-- =====================================================================

create or replace function public.parked_orders(p_date date)
returns table (wave_id uuid, wave_no text, planned_date date, shipment_number text, sku text, description text,
               order_nos text[], quantity_requested numeric, quantity_picked numeric, posted_tasks int)
language sql stable security invoker set search_path = public as $$
  select w.id, w.wave_no, w.planned_date, o.shipment_number, it.sku, o.description, o.order_nos,
         o.quantity_requested, o.quantity_picked,
         (select count(*) from public.pick_tasks t where t.wave_id = w.id and t.status = 'COMPLETED')::int
  from public.waves w
  join public.outbound o on o.wave_id = w.id
  join public.items it on it.id = o.item_id
  where w.status = 'RESCHEDULED' and w.planned_date <= p_date and o.status <> 'CANCELLED'
  order by w.planned_date, w.wave_no, o.shipment_number, it.sku;
$$;

create or replace function public.carry_over_wave(
  p_wave_id uuid, p_date date, p_shipments jsonb default '{}', p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  w public.waves%rowtype; v_no text; v_n int := 1; k text; v text; v_ships text[];
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa melanjutkan wave';
  end if;
  select * into w from public.waves where id = p_wave_id for update;
  if w.id is null then raise exception 'Wave tidak ditemukan'; end if;
  if w.status <> 'RESCHEDULED' then raise exception 'Wave NO % tidak sedang ditunda', w.wave_no; end if;
  if p_date is null or p_date < w.planned_date then raise exception 'Tanggal baru tidak boleh sebelum %', w.planned_date; end if;
  if exists (select 1 from public.shipment_loads where wave_id = w.id) then
    raise exception 'Wave NO % sudah ada shipment yang dimuat', w.wave_no;
  end if;
  for k, v in select key, value from jsonb_each_text(coalesce(p_shipments, '{}')) loop
    if not (k = any(w.shipment_numbers)) then raise exception 'Shipment % tidak ada di wave NO %', k, w.wave_no; end if;
    if nullif(trim(v), '') is null then raise exception 'Nomor shipment baru untuk % kosong', k; end if;
  end loop;

  -- NO is unique per day: the carried wave is T<NO>, T<NO>-2 … on its new day.
  v_no := 'T' || regexp_replace(w.wave_no, '^T', '');
  while exists (select 1 from public.waves where planned_date = p_date and wave_no = v_no and id <> w.id) loop
    v_n := v_n + 1; v_no := 'T' || regexp_replace(w.wave_no, '^T', '') || '-' || v_n;
  end loop;

  select array_agg(coalesce(nullif(trim(p_shipments->>s), ''), s) order by ord) into v_ships
  from unnest(w.shipment_numbers) with ordinality as u(s, ord);
  update public.pick_tasks t set shipment_number = trim(p_shipments->>t.shipment_number)
  where t.wave_id = w.id and p_shipments ? t.shipment_number;
  update public.outbound o set shipment_number = trim(p_shipments->>o.shipment_number), outbound_date = p_date
  where o.wave_id = w.id and p_shipments ? o.shipment_number;
  update public.outbound set outbound_date = p_date where wave_id = w.id;
  update public.waves set planned_date = p_date, status = 'PENDING', wave_no = v_no, shipment_numbers = v_ships where id = w.id;

  perform public.log_execution_event('WAVE', w.id, 'RESCHEDULED', 'PENDING',
    format('dilanjutkan dari %s NO %s ke %s NO %s%s%s', w.planned_date, w.wave_no, p_date, v_no,
           case when p_shipments <> '{}' then ', shipment ' || p_shipments::text else '' end,
           case when nullif(trim(p_reason), '') is not null then ': ' || trim(p_reason) else '' end));
  return jsonb_build_object('result', 'CARRIED', 'wave_no', v_no, 'from_date', w.planned_date, 'to_date', p_date, 'shipment_numbers', to_jsonb(v_ships));
end $$;

revoke execute on function public.parked_orders(date) from public, anon;
grant execute on function public.parked_orders(date) to authenticated;
revoke execute on function public.carry_over_wave(uuid, date, jsonb, text) from public, anon;
grant execute on function public.carry_over_wave(uuid, date, jsonb, text) to authenticated;
