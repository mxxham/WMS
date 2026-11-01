-- =====================================================================
-- 0123  Destination and ship-to location on the picking audit
--
--  The checker must see, per item, not only the DO but also who the goods
--  go to: `Destination` (the ship-to company) and `Location of the ship-to
--  party` (the city). The allocator already parses both from the WMS
--  "Schedule of the day" (DemandLine.destination / DemandLine.shipToLocation)
--  and plan.ts writes the company into outbound.destination; the city was
--  never stored per shipment, so it is added here.
--
--  One value, one place — the same split rule (waves.destination holds the
--  combined "company · location" string written by waveDestination()):
--    d.destination     from outbound.destination, else split_part(wave, ' · ', 1)
--    d.ship_to_location from outbound.ship_to_location, else split_part(..., 2)
--  A wave whose destination carries no ' · ' is a company-only (or empty)
--  string: it yields no location rather than a wrong one.
--
--  a) outbound.ship_to_location, backfilled from the only historical source,
--     the wave's combined destination (no invented data).
--  b) save_plan re-issued (0007 body) to write the new column.
--  c) sheet_pick_lines.destination / .ship_to_location: the file's own two
--     columns, stored by load_sheet_pick_lines; an already-audited line only
--     gets its blank metadata filled (quantities, batch and expiry stay).
--  d) pick_audit_line: two columns appended after do_nos.
--  e) pick_audit_move: two text[] arrays appended after do_nos, so a Bin To
--     Bin row shows them too — the wave's own values when the move has no
--     demand for its SKU.
--  f) pick_audit_shipment: both appended after load_legacy.
--
--  CREATE OR REPLACE VIEW is append-only: every existing column keeps its
--  name, type and position in all three views.
-- =====================================================================

-- ---------------------------------------------------------------------
-- a) The city, per shipment + SKU (empty when the source had none)
-- ---------------------------------------------------------------------
alter table public.outbound add column ship_to_location text not null default '';

-- Backfill what the historical data can prove: waves.destination is the
-- combined "company · location" string. A combined value gives the location
-- directly; a wave destination that is not the outbound company is a
-- location-only wave; anything else stays empty rather than guessed.
update public.outbound o
   set ship_to_location = case
         when position(' · ' in w.destination) > 0 then split_part(w.destination, ' · ', 2)
         when w.destination <> '' and w.destination <> o.destination then w.destination
         else '' end
  from public.waves w
 where w.id = o.wave_id
   and o.ship_to_location = ''
   and (position(' · ' in w.destination) > 0
        or (w.destination <> '' and w.destination <> o.destination));

-- ---------------------------------------------------------------------
-- b) save_plan (0007 body) now writes outbound.ship_to_location
-- ---------------------------------------------------------------------
create or replace function public.save_plan(p_date date, p_plan jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  w jsonb; t jsonb; o jsonb;
  v_wave uuid; v_item uuid; v_from uuid; v_to uuid;
  n_waves int := 0; n_tasks int := 0; n_out int := 0; n_replaced int; n_kept int;
  v_clash text;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Only supervisors or admins can save an allocation plan';
  end if;

  create temp table _replace on commit drop as select id from public.replaceable_waves(p_date) as id;
  select count(*) into n_replaced from _replace;
  select count(*) into n_kept from public.waves where planned_date = p_date and id not in (select id from _replace);

  -- A new wave may not reuse the NO of a wave that is being kept.
  select string_agg(distinct x.wave_no, ', ') into v_clash
  from jsonb_to_recordset(coalesce(p_plan->'waves', '[]')) as x(wave_no text)
  join public.waves kw on kw.planned_date = p_date and kw.wave_no = x.wave_no
  where kw.id not in (select id from _replace);
  if v_clash is not null then
    raise exception 'Wave NO % sudah dikerjakan/ditahan/dibatalkan dan tidak bisa direncanakan ulang', v_clash;
  end if;

  delete from public.waves where id in (select id from _replace);  -- cascades to tasks + outbound

  create temp table _wave_ids (wave_no text primary key, id uuid) on commit drop;

  for w in select * from jsonb_array_elements(coalesce(p_plan->'waves', '[]')) loop
    insert into public.waves (wave_no, planned_date, shipment_numbers, truck, destination, planned_slot, created_by)
    values (w->>'wave_no', p_date,
            coalesce(array(select jsonb_array_elements_text(w->'shipment_numbers')), '{}'),
            nullif(w->>'truck',''), coalesce(w->>'destination',''), nullif(w->>'planned_slot',''), auth.uid())
    returning id into v_wave;
    insert into _wave_ids values (w->>'wave_no', v_wave);
    n_waves := n_waves + 1;
  end loop;

  for t in select * from jsonb_array_elements(coalesce(p_plan->'tasks', '[]')) loop
    select id into v_wave from _wave_ids where wave_no = t->>'wave_no';
    if v_wave is null then raise exception 'Task references unknown wave %', t->>'wave_no'; end if;
    select id into v_item from public.items where sku = t->>'sku';
    if v_item is null then raise exception 'Unknown SKU %', t->>'sku'; end if;
    select id into v_from from public.bins where bin_code = t->>'from_bin';
    if v_from is null then raise exception 'Unknown bin %', t->>'from_bin'; end if;
    v_to := null;
    if coalesce(t->>'to_bin','') <> '' then
      select id into v_to from public.bins where bin_code = t->>'to_bin';
      if v_to is null then raise exception 'Unknown bin %', t->>'to_bin'; end if;
    end if;
    insert into public.pick_tasks (wave_id, shipment_number, task_type, item_id, from_bin_id, to_bin_id,
                                   batch_lot, expiry_date, quantity, pick_type, breaks_pallet, seq)
    values (v_wave, nullif(t->>'shipment_number',''), t->>'task_type', v_item, v_from, v_to,
            coalesce(t->>'batch_lot',''), (t->>'expiry_date')::date, (t->>'quantity')::numeric,
            nullif(t->>'pick_type',''), coalesce((t->>'breaks_pallet')::boolean, false), (t->>'seq')::int);
    n_tasks := n_tasks + 1;
  end loop;

  for o in select * from jsonb_array_elements(coalesce(p_plan->'outbound', '[]')) loop
    select id into v_wave from _wave_ids where wave_no = o->>'wave_no';
    if v_wave is null then raise exception 'Outbound line references unknown wave %', o->>'wave_no'; end if;
    insert into public.outbound (outbound_date, wave_id, shipment_number, sku, item_id, description, order_nos,
                                 truck, destination, ship_to_location, quantity_requested, quantity_allocated, shortage_reason)
    values (p_date, v_wave, o->>'shipment_number', o->>'sku',
            (select id from public.items where sku = o->>'sku'), coalesce(o->>'description',''),
            coalesce(array(select jsonb_array_elements_text(o->'order_nos')), '{}'),
            nullif(o->>'truck',''), coalesce(o->>'destination',''), coalesce(o->>'ship_to_location',''),
            (o->>'quantity_requested')::numeric, coalesce((o->>'quantity_allocated')::numeric, 0),
            nullif(o->>'shortage_reason',''));
    n_out := n_out + 1;
  end loop;

  return jsonb_build_object('waves', n_waves, 'tasks', n_tasks, 'outbound', n_out,
                            'replaced', n_replaced, 'kept', n_kept);
end $$;

-- Replace keeps the existing ACL; re-issued here so the boundary is explicit
-- and survives an apply onto a database whose grants drifted.
revoke execute on function public.save_plan(date, jsonb) from public, anon;
grant execute on function public.save_plan(date, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- c) The file's own two columns (empty when the file has none)
-- ---------------------------------------------------------------------
alter table public.sheet_pick_lines
  add column destination text not null default '',
  add column ship_to_location text not null default '';

-- sheet_pick_line_state selects `l.*`, but `*` is expanded when the view is
-- created, so the two columns only show up once the view is re-issued. They
-- land among the l.* ones (not appended), so the view is dropped first —
-- exactly what 0121 did for do_nos.
drop view public.sheet_pick_line_state;
create view public.sheet_pick_line_state with (security_invoker = true) as
select l.*,
       a.id as last_audit_id, a.result as last_result, a.errors as last_errors, a.checker_name as last_checker,
       a.created_at as last_audited_at, a.method as last_method, a.rack_system as last_rack_system,
       a.rack_counted as last_rack_counted, coalesce(n.attempts, 0) as attempts,
       case when a.id is null then 'TODO' when a.result = 'OK' then 'OK' else 'MISMATCH' end as line_state
from public.sheet_pick_lines l
left join lateral (select * from public.sheet_pick_audits x where x.line_id = l.id order by attempt_no desc limit 1) a on true
left join lateral (select count(*)::int as attempts from public.sheet_pick_audits x where x.line_id = l.id) n on true;
grant select on public.sheet_pick_line_state to authenticated;

-- ---------------------------------------------------------------------
-- Loading the day's lines (0121 body, + destination / ship_to_location)
--   p_lines: [{picklist, wave_no, shipment_number, seq, bin_code, sku,
--              description, uom, batch, expiry, qty, picker_name,
--              bin_remaining, do_nos[], destination, ship_to_location}]
-- ---------------------------------------------------------------------
create or replace function public.load_sheet_pick_lines(p_date date, p_source text, p_file text, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_removed int; v_added int; v_kept int; v_total int;
begin
  if not public.has_role(array['operator','supervisor','admin']::public.user_role[]) then
    raise exception 'Sesi situs tidak tersedia';
  end if;
  if p_date is null then raise exception 'Tanggal pick wajib diisi'; end if;
  if p_source not in ('K_ONE', 'ALLOCATOR') then raise exception 'Sumber tidak dikenal: %', p_source; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'File tidak berisi baris pick';
  end if;
  v_total := jsonb_array_length(p_lines);

  delete from public.sheet_pick_lines l
  where l.pick_date = p_date and not exists (select 1 from public.sheet_pick_audits a where a.line_id = l.id);
  get diagnostics v_removed = row_count;

  -- Lines audited before 0123 have no destination yet. The re-uploaded file
  -- only fills the two metadata fields, and only where they are still blank:
  -- the audited quantities, batch and expiry stay exactly as the checker saw
  -- them, and the audit row is not touched. This runs before the insert, so
  -- it never sees the rows this load adds or keeps, and the counts below are
  -- unaffected.
  update public.sheet_pick_lines l
     set destination = case when trim(r->>'destination') <> '' then trim(r->>'destination') else l.destination end,
         ship_to_location = case when trim(r->>'ship_to_location') <> '' then trim(r->>'ship_to_location') else l.ship_to_location end
    from jsonb_array_elements(p_lines) r
   where l.pick_date = p_date
     and trim(r->>'shipment_number') <> ''
     and l.shipment_number = trim(r->>'shipment_number')
     and l.bin_code = upper(trim(r->>'bin_code'))
     and l.sku = trim(r->>'sku')
     and l.batch = public.norm_batch(r->>'batch')
     and (trim(r->>'destination') <> '' or trim(r->>'ship_to_location') <> '')
     and (l.destination = '' or l.ship_to_location = '');

  with src as (
    select nullif(trim(r->>'picklist'), '') as picklist, nullif(trim(r->>'wave_no'), '') as wave_no,
           trim(r->>'shipment_number') as shipment_number, coalesce((r->>'seq')::int, 0) as seq,
           upper(trim(r->>'bin_code')) as bin_code, trim(r->>'sku') as sku,
           coalesce(r->>'description', '') as description, nullif(trim(r->>'uom'), '') as uom,
           public.norm_batch(r->>'batch') as batch, nullif(r->>'expiry', '')::date as expiry,
           (r->>'qty')::numeric as qty, nullif(trim(r->>'picker_name'), '') as picker_name,
           nullif(r->>'bin_remaining', '')::numeric as bin_remaining,
           public.norm_do_nos(r->'do_nos') as do_nos,
           coalesce(trim(r->>'destination'), '') as destination,
           coalesce(trim(r->>'ship_to_location'), '') as ship_to_location
    from jsonb_array_elements(p_lines) r
  )
  insert into public.sheet_pick_lines (pick_date, source, file_name, picklist, wave_no, shipment_number, seq,
    bin_code, sku, description, uom, batch, expiry, qty, picker_name, bin_remaining, do_nos,
    destination, ship_to_location, created_by)
  select p_date, p_source, nullif(trim(p_file), ''), picklist, wave_no, shipment_number, seq,
         bin_code, sku, description, uom, batch, expiry, qty, picker_name, bin_remaining, do_nos,
         destination, ship_to_location, auth.uid()
  from src
  where coalesce(shipment_number, '') <> '' and coalesce(bin_code, '') <> '' and coalesce(sku, '') <> '' and qty > 0
  on conflict (pick_date, shipment_number, bin_code, sku, batch) do nothing;
  get diagnostics v_added = row_count;

  select count(*) into v_kept from public.sheet_pick_lines l
  where l.pick_date = p_date and exists (select 1 from public.sheet_pick_audits a where a.line_id = l.id);

  return jsonb_build_object('added', v_added, 'kept', v_kept, 'removed', v_removed, 'skipped', v_total - v_added);
end $$;

revoke execute on function public.load_sheet_pick_lines(date, text, text, jsonb) from public, anon;
grant execute on function public.load_sheet_pick_lines(date, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- d) pick_audit_line + destination, ship_to_location (last two columns)
--    Source: outbound of the same wave + shipment + SKU (status <>
--    'CANCELLED'), falling back to the wave's combined destination. The
--    lateral that produces do_nos gains the two aggregates; the DO list is
--    unchanged (trim, distinct, sorted, empty strings dropped).
-- ---------------------------------------------------------------------
create or replace view public.pick_audit_line with (security_invoker = true) as
with latest as (
  select distinct on (task_id) * from public.pick_audits order by task_id, attempt_no desc
), n as (
  select task_id, count(*)::int as attempts from public.pick_audits group by task_id
)
select t.id as task_id, t.wave_id, w.wave_no, w.planned_date, w.status as wave_status, t.shipment_number, t.seq,
       it.sku, it.description, it.uom,
       coalesce(ab.bin_code, fb.bin_code) as from_bin, coalesce(ab.zone, fb.zone) as zone,
       coalesce(t.actual_batch_lot, t.batch_lot) as batch_lot, coalesce(t.actual_expiry_date, t.expiry_date) as expiry_date,
       t.quantity as planned_qty, coalesce(t.actual_quantity, t.quantity) as picked_qty, t.deviation_reason,
       t.completed_at, t.picked_by_name, t.bulk_posted, t.scanned_code,
       l.id as audit_id, l.attempt_no, l.result, l.errors, l.resolution, l.checker_name, l.created_at as audited_at,
       coalesce(n.attempts, 0) as attempts,
       case when coalesce(t.actual_quantity, t.quantity) = 0 then 'AUTO_PASS'
            when l.id is null then 'TODO'
            when l.result = 'OK' then 'OK'
            when l.resolution is not null then 'RESOLVED'
            else 'MISMATCH' end as line_state,
       sl.id is not null as loaded,
       t.scan_method,
       it.volume_l,
       coalesce(d.do_nos, '{}'::text[]) as do_nos,
       -- 0123: who the goods go to, and where
       coalesce(nullif(trim(d.destination), ''), split_part(w.destination, ' · ', 1), '') as destination,
       coalesce(nullif(trim(d.ship_to_location), ''),
                case when position(' · ' in w.destination) > 0 then split_part(w.destination, ' · ', 2) end,
                '') as ship_to_location
from public.pick_tasks t
join public.waves w on w.id = t.wave_id
join public.items it on it.id = t.item_id
join public.bins fb on fb.id = t.from_bin_id
left join public.bins ab on ab.id = t.actual_from_bin_id
left join latest l on l.task_id = t.id
left join n on n.task_id = t.id
left join public.shipment_loads sl on sl.wave_id = t.wave_id and sl.shipment_number = t.shipment_number
left join lateral (
  select array(
           select distinct trim(o_d) from public.outbound o
           cross join unnest(o.order_nos) as o_d
           where o.wave_id = t.wave_id and o.shipment_number = t.shipment_number
             and o.sku = it.sku and o.status <> 'CANCELLED' and trim(o_d) <> ''
           order by trim(o_d)
         ) as do_nos,
         mx.destination, mx.ship_to_location
  from (
    select max(o.destination) as destination, max(o.ship_to_location) as ship_to_location
    from public.outbound o
    where o.wave_id = t.wave_id and o.shipment_number = t.shipment_number
      and o.sku = it.sku and o.status <> 'CANCELLED'
  ) mx
) d on true
where t.task_type = 'PICK' and t.status = 'COMPLETED';

grant select on public.pick_audit_line to authenticated;

-- ---------------------------------------------------------------------
-- e) pick_audit_move + destinations, ship_to_locations (last two columns)
--    The same rule, one array per column: a move with demand for its SKU
--    shows that demand's values; a pure relocation shows the wave's own
--    destination and location, never an unrelated shipment's.
-- ---------------------------------------------------------------------
create or replace view public.pick_audit_move with (security_invoker = true) as
with latest as (
  select distinct on (task_id) * from public.pick_audits order by task_id, attempt_no desc
), n as (
  select task_id, count(*)::int as attempts from public.pick_audits group by task_id
), src as (
  select distinct on (task_id) * from public.move_source_audits order by task_id, attempt_no desc
), sn as (
  select task_id, count(*)::int as attempts from public.move_source_audits group by task_id
)
select t.id as task_id, t.wave_id, w.wave_no, w.planned_date, w.status as wave_status, t.seq,
       it.sku, it.description, it.uom,
       coalesce(ab.bin_code, fb.bin_code) as from_bin, coalesce(ab.zone, fb.zone) as zone,
       tb.bin_code as to_bin, tb.zone as to_zone,
       coalesce(t.actual_batch_lot, t.batch_lot) as batch_lot, coalesce(t.actual_expiry_date, t.expiry_date) as expiry_date,
       t.quantity as planned_qty, coalesce(t.actual_quantity, t.quantity) as moved_qty, t.deviation_reason,
       t.completed_at, t.picked_by_name, t.bulk_posted, t.scanned_code,
       l.id as audit_id, l.attempt_no, l.result, l.errors, l.resolution, l.checker_name, l.created_at as audited_at,
       coalesce(n.attempts, 0) as attempts,
       case when coalesce(t.actual_quantity, t.quantity) = 0 then 'AUTO_PASS'
            when l.id is null then 'TODO'
            when l.result = 'OK' then 'OK'
            when l.resolution is not null then 'RESOLVED'
            else 'MISMATCH' end as line_state,
       -- 0114: the count left in the source bin
       case when coalesce(t.actual_quantity, t.quantity) = 0 then 'AUTO_PASS'
            when s.id is null then 'TODO'
            when s.result = 'OK' then 'OK'
            else 'MISMATCH' end as from_state,
       coalesce(sn.attempts, 0) as from_attempts,
       s.checker_name as from_checker, s.system_qty as from_system, s.counted_qty as from_counted,
       s.found_sku as from_found_sku, s.note as from_note, s.correction as from_correction, s.created_at as from_audited_at,
       -- 0122: the shipments of this move, and their DOs
       coalesce(dm.shipments, w.shipment_numbers) as shipment_numbers,
       coalesce(doa.do_nos, '{}'::text[]) as do_nos,
       -- 0123: who the goods go to, and where
       coalesce(dm.destinations,
                case when w.destination <> '' then array[split_part(w.destination, ' · ', 1)] else '{}'::text[] end) as destinations,
       coalesce(dm.ship_to_locations,
                case when position(' · ' in w.destination) > 0 then array[split_part(w.destination, ' · ', 2)] else '{}'::text[] end) as ship_to_locations
from public.pick_tasks t
join public.waves w on w.id = t.wave_id
join public.items it on it.id = t.item_id
join public.bins fb on fb.id = t.from_bin_id
left join public.bins ab on ab.id = t.actual_from_bin_id
join public.bins tb on tb.id = t.to_bin_id
left join latest l on l.task_id = t.id
left join n on n.task_id = t.id
left join src s on s.task_id = t.id
left join sn on sn.task_id = t.id
-- The wave's outbound demand for this move's SKU: its shipments, every order number of theirs, and
-- their destination / location. The DO elements are aggregated one by one on purpose: array_agg over
-- the order_nos arrays themselves raises "cannot accumulate empty arrays" as soon as one row has '{}'.
left join lateral (
  select array_agg(distinct o.shipment_number order by o.shipment_number) as shipments,
         (select array_agg(d.d order by d.ord)
            from public.outbound o2
            cross join lateral unnest(o2.order_nos) with ordinality as d(d, ord)
           where o2.wave_id = t.wave_id and o2.sku = it.sku and o2.status <> 'CANCELLED') as do_list,
         (select array_agg(x.v order by x.v)
            from (select distinct coalesce(nullif(trim(o3.destination), ''), split_part(w.destination, ' · ', 1)) as v
                    from public.outbound o3
                   where o3.wave_id = t.wave_id and o3.sku = it.sku and o3.status <> 'CANCELLED') x
           where coalesce(x.v, '') <> '') as destinations,
         (select array_agg(y.v order by y.v)
            from (select distinct coalesce(nullif(trim(o4.ship_to_location), ''),
                                           case when position(' · ' in w.destination) > 0
                                                then split_part(w.destination, ' · ', 2) end) as v
                    from public.outbound o4
                   where o4.wave_id = t.wave_id and o4.sku = it.sku and o4.status <> 'CANCELLED') y
           where coalesce(y.v, '') <> '') as ship_to_locations
  from public.outbound o
  where o.wave_id = t.wave_id and o.sku = it.sku and o.status <> 'CANCELLED'
) dm on true
-- The DOs typed by hand on the Wave page for those shipments (none when the move has no demand).
left join lateral (
  select jsonb_agg(e.d order by sd.shipment_number, e.ord) as dos
  from public.shipment_do_no sd
  cross join lateral jsonb_array_elements_text(sd.do_nos) with ordinality as e(d, ord)
  where sd.wave_id = t.wave_id and sd.shipment_number = any(dm.shipments)
) md on true
-- The plan's order numbers, then the manual ones, normalised once.
left join lateral (
  select public.norm_do_nos(coalesce(jsonb_agg(d.d order by d.ord), '[]'::jsonb) || coalesce(md.dos, '[]'::jsonb)) as do_nos
  from unnest(dm.do_list) with ordinality as d(d, ord)
) doa on true
where t.task_type = 'REPLENISH' and t.status = 'COMPLETED';

grant select on public.pick_audit_move to authenticated;

-- ---------------------------------------------------------------------
-- f) pick_audit_shipment + destination, ship_to_location (last two columns)
--    The shipment page shows one row per wave + shipment, so it takes the
--    shipment's outbound values (max, they are the same per shipment) and
--    falls back to the wave split exactly like pick_audit_line.
-- ---------------------------------------------------------------------
create or replace view public.pick_audit_shipment with (security_invoker = true) as
with tasks as (
  select wave_id, shipment_number,
         count(*) filter (where status in ('PLANNED', 'RESCHEDULED'))::int as open_tasks,
         count(*) filter (where status = 'COMPLETED')::int as lines
  from public.pick_tasks where task_type = 'PICK' group by wave_id, shipment_number
), st as (
  select wave_id, shipment_number,
         count(*) filter (where line_state = 'TODO')::int as todo,
         count(*) filter (where line_state in ('OK', 'AUTO_PASS'))::int as ok,
         count(*) filter (where line_state = 'MISMATCH')::int as mismatch,
         count(*) filter (where line_state = 'RESOLVED')::int as resolved
  from public.pick_audit_line group by wave_id, shipment_number
)
select w.id as wave_id, w.wave_no, w.planned_date, w.planned_slot, w.status as wave_status, w.truck as planned_truck,
       t.shipment_number, t.open_tasks, t.lines,
       coalesce(st.todo, 0) as todo, coalesce(st.ok, 0) as ok, coalesce(st.mismatch, 0) as mismatch, coalesce(st.resolved, 0) as resolved,
       case when sl.id is not null then 'LOADED'
            when w.status = 'CANCELLED' or (t.open_tasks = 0 and t.lines = 0) then 'CANCELLED'
            when t.open_tasks > 0 then 'PICKING'
            when coalesce(st.mismatch, 0) > 0 then 'HAS_MISMATCH'
            when coalesce(st.todo, 0) > 0 then 'READY_AUDIT'
            else 'READY_LOAD' end as state,
       sl.loaded_at, sl.loaded_by_name, sl.truck, coalesce(sl.legacy, false) as load_legacy,
       -- 0123: who the goods go to, and where
       coalesce(nullif(trim(ob.destination), ''), split_part(w.destination, ' · ', 1), '') as destination,
       coalesce(nullif(trim(ob.ship_to_location), ''),
                case when position(' · ' in w.destination) > 0 then split_part(w.destination, ' · ', 2) end,
                '') as ship_to_location
from tasks t
join public.waves w on w.id = t.wave_id
left join st on st.wave_id = t.wave_id and st.shipment_number = t.shipment_number
left join public.shipment_loads sl on sl.wave_id = t.wave_id and sl.shipment_number = t.shipment_number
left join lateral (
  select max(o.destination) as destination, max(o.ship_to_location) as ship_to_location
  from public.outbound o
  where o.wave_id = t.wave_id and o.shipment_number = t.shipment_number
    and o.status <> 'CANCELLED'
) ob on true;

grant select on public.pick_audit_shipment to authenticated;
