-- =====================================================================
-- 0112  SAP comparison: our stock at a cut-off time, not "now"
--
--  28 Oct 2026, first live comparison: the MB52 of the morning was
--  compared with our stock at the moment Buat was pressed, after that
--  day's picks had already left the bins. Every SKU shipped that day read
--  as "WMS kurang" (550048593 -1,188, 550062461 -200, ...).
--
--  Our stock is now taken at a cut-off (default: 00:00 WIB of the SAP
--  stock date). Stock only changes through `movements`, so the stock at
--  any moment is today's stock with every later movement undone:
--    inbound            +q          putaway (no source) +q
--    putaway (source)    0          transfer             0
--    picking            -q          adjustment           +q (signed)
--  Blocked follows quarantine-bin moves the same way; holds keep their
--  current state (a hold has no quantity history).
--  Nothing is written to inventory: this is arithmetic on the ledger.
-- =====================================================================

alter table public.stock_recons add column wms_at timestamptz;

-- Our stock per SKU at p_at, split the way SAP splits it.
create or replace function public.wms_stock_by_sku_at(p_at timestamptz)
returns table (item_id uuid, sku text, description text, uom text, physical numeric, unrestricted numeric, blocked numeric)
language sql stable security definer set search_path = public as $$
  with now_stock as (
    select w.item_id, w.physical, w.blocked from public.wms_stock_by_sku() w
  ), later as (     -- what happened after the cut-off, per item
    select m.item_id,
           sum(case m.type
                 when 'inbound' then m.quantity
                 when 'putaway' then case when m.from_bin_id is null then m.quantity else 0 end
                 when 'picking' then -m.quantity
                 when 'adjustment' then m.quantity
                 else 0 end) as phys,
           sum(case when tb.zone = 'QUARANTINE' and m.type <> 'picking' then m.quantity else 0 end)
         - sum(case when fb.zone = 'QUARANTINE' then m.quantity else 0 end) as blk
    from public.movements m
    left join public.bins tb on tb.id = m.to_bin_id
    left join public.bins fb on fb.id = m.from_bin_id
    where m.created_at > p_at
    group by m.item_id
  ), at_cut as (
    select coalesce(n.item_id, l.item_id) as item_id,
           coalesce(n.physical, 0) - coalesce(l.phys, 0) as physical,
           coalesce(n.blocked, 0) - coalesce(l.blk, 0) as blocked
    from now_stock n full join later l on l.item_id = n.item_id
  )
  select it.id, it.sku, it.description, it.uom, a.physical,
         a.physical - least(greatest(a.blocked, 0), greatest(a.physical, 0)),
         least(greatest(a.blocked, 0), greatest(a.physical, 0))
  from at_cut a join public.items it on it.id = a.item_id
  where a.physical <> 0 or a.blocked <> 0;
$$;

-- The 0111 entry point gains the cut-off; the 9-argument form is replaced
-- so PostgREST sees one function.
drop function public.create_stock_recon_mb52(date, text, text, jsonb, jsonb, text[], jsonb, jsonb, text);
create function public.create_stock_recon_mb52(p_as_of date, p_file_name text, p_note text,
  p_sap jsonb, p_other jsonb, p_slocs text[], p_moves jsonb, p_pending jsonb, p_by_name text, p_wms_at timestamptz default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_other text[];
begin
  if p_wms_at is not null and p_wms_at > now() then
    raise exception 'Jam stok WMS tidak boleh di masa depan';
  end if;
  -- create_stock_recon checks the role, the SAP rows and snapshots our stock now.
  v_id := public.create_stock_recon(p_as_of, p_file_name, p_note, p_sap, p_pending, p_by_name);

  if p_wms_at is not null then
    -- Replace "now" with the stock at the cut-off; a SKU we held then but not now still gets a line.
    create temp table _at on commit drop as select * from public.wms_stock_by_sku_at(p_wms_at);
    update public.stock_recon_lines l
    set wms_unrestricted = coalesce((select a.unrestricted from _at a where a.sku = l.sku), 0),
        wms_blocked      = coalesce((select a.blocked from _at a where a.sku = l.sku), 0)
    where l.recon_id = v_id;
    insert into public.stock_recon_lines (recon_id, item_id, sku, description, wms_uom, wms_unrestricted, wms_blocked)
    select v_id, a.item_id, a.sku, a.description, a.uom, a.unrestricted, a.blocked
    from _at a where not exists (select 1 from public.stock_recon_lines l where l.recon_id = v_id and l.sku = a.sku);
    drop table _at;
  end if;

  insert into public.stock_recon_lines (recon_id, item_id, sku, description, sap_uom, wms_uom)
  select distinct on (trim(o->>'sku')) v_id, it.id, trim(o->>'sku'), coalesce(it.description, o->>'description'), upper(o->>'uom'), it.uom
  from jsonb_array_elements(coalesce(p_other, '[]'::jsonb)) o
  left join public.items it on it.sku = trim(o->>'sku')
  where coalesce(trim(o->>'sku'), '') <> ''
    and not exists (select 1 from public.stock_recon_lines l where l.recon_id = v_id and l.sku = trim(o->>'sku'));

  with o as (
    select trim(o->>'sku') as sku, coalesce(nullif(trim(o->>'sloc'), ''), '?') as sloc,
           sum(coalesce((o->>'unrestricted')::numeric, 0) + coalesce((o->>'blocked')::numeric, 0)) as qty
    from jsonb_array_elements(coalesce(p_other, '[]'::jsonb)) o
    where coalesce(trim(o->>'sku'), '') <> '' group by 1, 2
  ), per_sku as (select sku, jsonb_object_agg(sloc, qty) as m from o group by sku)
  update public.stock_recon_lines l set sap_other = p.m
  from per_sku p where l.recon_id = v_id and l.sku = p.sku;

  select coalesce(array_agg(distinct coalesce(nullif(trim(o->>'sloc'), ''), '?') order by coalesce(nullif(trim(o->>'sloc'), ''), '?')), '{}')
    into v_other from jsonb_array_elements(coalesce(p_other, '[]'::jsonb)) o;

  insert into public.stock_recon_sap_moves (recon_id, line_no, sku, description, sloc, mvt_type, mvt_text, mat_doc,
    posting_date, quantity, uom, reference, customer, customer_name, user_name)
  select v_id, coalesce((m->>'line_no')::int, 0), trim(m->>'sku'), m->>'description', coalesce(trim(m->>'sloc'), ''),
         coalesce(trim(m->>'mvt_type'), ''), m->>'mvt_text', nullif(trim(m->>'mat_doc'), ''),
         nullif(m->>'posting_date', '')::date, coalesce((m->>'quantity')::numeric, 0), upper(nullif(m->>'uom', '')),
         nullif(ltrim(trim(m->>'reference'), '0'), ''), nullif(trim(m->>'customer'), ''), m->>'customer_name', m->>'user_name'
  from jsonb_array_elements(coalesce(p_moves, '[]'::jsonb)) m
  where coalesce(trim(m->>'sku'), '') <> '';

  update public.stock_recons set slocs = coalesce(p_slocs, '{}'), other_slocs = v_other, wms_at = p_wms_at,
    sap_moves = (select count(*) from public.stock_recon_sap_moves where recon_id = v_id)
  where id = v_id;
  return v_id;
end $$;

-- Shipments vs GI: with a cut-off, only picks done by then count. A pick
-- after the cut-off is already undone on our side, so it is no timing gap.
create or replace function public.recon_shipment_match(p_recon_id uuid)
returns table (status text, shipment_number text, wave_no text, planned_date date, sku text, description text,
               do_nos text[], sap_gi numeric, ordered numeric, picked numeric, timing numeric, last_pick timestamptz, posting_date date)
language plpgsql stable security definer set search_path = public as $$
declare v_slocs text[]; v_at timestamptz; v_from date; v_to date;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa melihat rekonsiliasi';
  end if;
  select r.slocs, r.wms_at into v_slocs, v_at from public.stock_recons r where r.id = p_recon_id;
  select min(m.posting_date), max(m.posting_date) into v_from, v_to
  from public.stock_recon_sap_moves m where m.recon_id = p_recon_id;

  return query
  with gi as (
    select m.reference as do_no, m.sku, max(m.description) as description, -sum(m.quantity) as qty, max(m.posting_date) as posting_date
    from public.stock_recon_sap_moves m
    where m.recon_id = p_recon_id and m.mvt_type in ('601', '602') and m.reference is not null
      and (cardinality(v_slocs) = 0 or m.sloc = any(v_slocs))
    group by 1, 2
  ), ob as (
    select o.wave_id, o.shipment_number, o.sku, o.item_id, o.description, o.quantity_requested,
           array(select ltrim(trim(x), '0') from unnest(o.order_nos) x where trim(x) <> '') as dos
    from public.outbound o join public.waves w on w.id = o.wave_id
    where w.status <> 'CANCELLED' and o.status <> 'CANCELLED'
  ), hit as (
    select distinct on (g.do_no, g.sku) g.*, ob.wave_id, ob.shipment_number
    from gi g join ob on ob.sku = g.sku and g.do_no = any(ob.dos)
    order by g.do_no, g.sku, ob.wave_id
  ), picks as (
    select t.wave_id, t.shipment_number, t.item_id,
           sum(coalesce(t.actual_quantity, t.quantity)) as qty, max(t.completed_at) as last_at
    from public.pick_tasks t
    where t.task_type = 'PICK' and t.status = 'COMPLETED' and (v_at is null or t.completed_at <= v_at)
    group by 1, 2, 3
  ), ship as (
    select ob.wave_id, ob.shipment_number, ob.sku, ob.item_id, ob.description, ob.quantity_requested, ob.dos
    from ob
    where exists (select 1 from hit h where h.wave_id = ob.wave_id and h.shipment_number = ob.shipment_number and h.sku = ob.sku)
       or (v_from is not null and exists (
            select 1 from picks p where p.wave_id = ob.wave_id and p.shipment_number = ob.shipment_number and p.item_id = ob.item_id
              and (p.last_at at time zone 'Asia/Jakarta')::date between v_from and v_to))
  )
  select case
           when coalesce(h.qty, 0) = 0 and coalesce(p.qty, 0) > 0 then 'NO_GI'
           when coalesce(h.qty, 0) = coalesce(p.qty, 0) then 'MATCH'
           when coalesce(h.qty, 0) > coalesce(p.qty, 0) then 'SAP_MORE'
           else 'WMS_MORE' end,
         s.shipment_number, w.wave_no, w.planned_date, s.sku, s.description, s.dos,
         coalesce(h.qty, 0), s.quantity_requested, coalesce(p.qty, 0), coalesce(p.qty, 0) - coalesce(h.qty, 0), p.last_at, h.posting_date
  from ship s
  join public.waves w on w.id = s.wave_id
  left join (select hh.wave_id, hh.shipment_number, hh.sku, sum(hh.qty) as qty, max(hh.posting_date) as posting_date
             from hit hh group by 1, 2, 3) h on h.wave_id = s.wave_id and h.shipment_number = s.shipment_number and h.sku = s.sku
  left join picks p on p.wave_id = s.wave_id and p.shipment_number = s.shipment_number and p.item_id = s.item_id
  union all
  select 'NOT_IN_WMS', null, null, null, g.sku, g.description, array[g.do_no], g.qty, 0::numeric, 0::numeric, 0::numeric, null, g.posting_date
  from gi g where not exists (select 1 from hit h where h.do_no = g.do_no and h.sku = g.sku)
  order by 1, 2, 5;
end $$;

-- stock_recon_summary selects r.*: rebuild it so it carries wms_at.
create or replace view public.stock_recon_summary with (security_invoker = true) as
select r.id, r.as_of, r.file_name, r.note, r.status, r.created_by, r.created_by_name, r.created_at,
       r.closed_by_name, r.closed_at, r.close_note, r.slocs, r.other_slocs, r.sap_moves, r.auto_gi_at, r.auto_gi_by_name,
       count(l.id) as skus,
       count(l.id) filter (where l.diff_unrestricted = 0 and l.diff_blocked = 0) as skus_match,
       round(100.0 * count(l.id) filter (where l.diff_unrestricted = 0 and l.diff_blocked = 0) / nullif(count(l.id), 0), 2) as accuracy_pct,
       coalesce(sum(abs(l.diff_unrestricted) + abs(l.diff_blocked)), 0) as abs_diff,
       coalesce(sum(l.sap_unrestricted + l.sap_blocked), 0) as sap_total,
       coalesce(sum(l.wms_unrestricted + l.wms_blocked), 0) as wms_total,
       count(l.id) filter (where (l.diff_unrestricted <> 0 or l.diff_blocked <> 0) and l.status in ('OPEN', 'COUNT_REQUESTED')) as open_diffs,
       count(l.id) filter (where l.diff_unrestricted + l.diff_blocked < 0) as skus_wms_more,
       count(l.id) filter (where l.diff_unrestricted + l.diff_blocked > 0) as skus_wms_less,
       coalesce(-sum(l.diff_unrestricted + l.diff_blocked) filter (where l.diff_unrestricted + l.diff_blocked < 0), 0) as qty_wms_more,
       coalesce(sum(l.diff_unrestricted + l.diff_blocked) filter (where l.diff_unrestricted + l.diff_blocked > 0), 0) as qty_wms_less,
       r.wms_at
from public.stock_recons r left join public.stock_recon_lines l on l.recon_id = r.id
group by r.id;

grant select on public.stock_recon_summary to authenticated;
revoke execute on function public.wms_stock_by_sku_at(timestamptz),
  public.create_stock_recon_mb52(date, text, text, jsonb, jsonb, text[], jsonb, jsonb, text, timestamptz) from public, anon;
grant execute on function public.wms_stock_by_sku_at(timestamptz),
  public.create_stock_recon_mb52(date, text, text, jsonb, jsonb, text[], jsonb, jsonb, text, timestamptz) to authenticated;
