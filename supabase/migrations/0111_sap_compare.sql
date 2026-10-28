-- =====================================================================
-- 0111  SAP comparison: MB52 by storage location, MB51, shipments vs GI
--
--  The real MB52 export (28 Oct 2026) is one workbook with three sheets:
--  `mb52` (storage location WHS1), `INBD` (inbound location: SAP stock
--  that is not yet booked into WHS1) and `mb51` (the day's SAP
--  transactions). 0021 read only the first sheet and summed every row.
--
--  A reconciliation now records:
--    * which storage locations count as warehouse stock (`slocs`, WHS1 by
--      default); the others are kept per SKU in `sap_other` so a WMS
--      surplus that sits in INBD is visible, not silently compared;
--    * the MB51 lines of the file (`stock_recon_sap_moves`, append-only);
--    * a cause per explained line (`cause`), for a cause breakdown;
--    * `auto_gi`: the timing difference found by matching MB51 goods
--      issues (601/602, Reference = Shell DO number = outbound.order_nos)
--      with our completed picks per shipment. Positive = picked here, not
--      yet GI in SAP; negative = GI in SAP, not yet picked here.
--
--  diff_unrestricted = SAP - (WMS + pending GI + auto GI - pending GR).
--  SAP is the reference: diff > 0 means our stock is LESS than SAP.
-- =====================================================================

alter table public.stock_recons
  add column slocs       text[] not null default '{}',
  add column other_slocs text[] not null default '{}',
  add column sap_moves   int    not null default 0,
  add column auto_gi_at  timestamptz,
  add column auto_gi_by_name text;

alter table public.stock_recon_lines
  add column sap_other jsonb   not null default '{}'::jsonb check (jsonb_typeof(sap_other) = 'object'),
  add column auto_gi   numeric not null default 0,
  add column cause     text check (cause in ('PENDING_GI', 'PENDING_GR', 'SAP_INBOUND', 'MISPICK', 'COUNT', 'SAP_ENTRY',
                                             'UOM', 'DAMAGED', 'RETURN', 'OTHER'));

-- The generated difference gains auto_gi. A generated column cannot be
-- altered, so the view that reads it is dropped and rebuilt around it.
drop view public.stock_recon_summary;
alter table public.stock_recon_lines drop column diff_unrestricted;
alter table public.stock_recon_lines add column diff_unrestricted numeric
  generated always as (sap_unrestricted - (wms_unrestricted + pending_gi + auto_gi - pending_gr)) stored;

create or replace view public.stock_recon_summary with (security_invoker = true) as
select r.*,
       count(l.id) as skus,
       count(l.id) filter (where l.diff_unrestricted = 0 and l.diff_blocked = 0) as skus_match,
       round(100.0 * count(l.id) filter (where l.diff_unrestricted = 0 and l.diff_blocked = 0) / nullif(count(l.id), 0), 2) as accuracy_pct,
       coalesce(sum(abs(l.diff_unrestricted) + abs(l.diff_blocked)), 0) as abs_diff,
       coalesce(sum(l.sap_unrestricted + l.sap_blocked), 0) as sap_total,
       coalesce(sum(l.wms_unrestricted + l.wms_blocked), 0) as wms_total,
       count(l.id) filter (where (l.diff_unrestricted <> 0 or l.diff_blocked <> 0) and l.status in ('OPEN', 'COUNT_REQUESTED')) as open_diffs,
       -- SAP is the reference: a negative difference is stock we have that SAP does not.
       count(l.id) filter (where l.diff_unrestricted + l.diff_blocked < 0) as skus_wms_more,
       count(l.id) filter (where l.diff_unrestricted + l.diff_blocked > 0) as skus_wms_less,
       coalesce(-sum(l.diff_unrestricted + l.diff_blocked) filter (where l.diff_unrestricted + l.diff_blocked < 0), 0) as qty_wms_more,
       coalesce(sum(l.diff_unrestricted + l.diff_blocked) filter (where l.diff_unrestricted + l.diff_blocked > 0), 0) as qty_wms_less
from public.stock_recons r left join public.stock_recon_lines l on l.recon_id = r.id
group by r.id;

-- ---------------------------------------------------------------------
-- MB51 lines, as they were in the uploaded file. Append-only: written
-- only by create_stock_recon_mb52, never edited.
-- ---------------------------------------------------------------------
create table public.stock_recon_sap_moves (
  id            bigint generated always as identity primary key,
  recon_id      uuid not null references public.stock_recons(id) on delete cascade,
  line_no       int  not null,
  sku           text not null,
  description   text,
  sloc          text not null default '',
  mvt_type      text not null default '',
  mvt_text      text,
  mat_doc       text,
  posting_date  date,
  quantity      numeric not null,          -- signed, base unit (Quantity column)
  uom           text,
  reference     text,                      -- leading zeros removed: matches outbound.order_nos
  customer      text,
  customer_name text,
  user_name     text
);
create index stock_recon_sap_moves_recon_idx on public.stock_recon_sap_moves (recon_id, sku);

alter table public.stock_recon_sap_moves enable row level security;
create policy "stock_recon_sap_moves: read" on public.stock_recon_sap_moves
  for select to authenticated using ((select public.is_active()));
-- No write policy.
grant select on public.stock_recon_sap_moves to authenticated;
grant all on public.stock_recon_sap_moves to service_role;

create or replace function public.stock_recon_moves_forbid_change() returns trigger
language plpgsql as $$
begin raise exception 'Transaksi MB51 rekonsiliasi tidak bisa diubah'; end $$;
create trigger stock_recon_sap_moves_no_update before update on public.stock_recon_sap_moves
  for each row execute function public.stock_recon_moves_forbid_change();

-- ---------------------------------------------------------------------
-- Create from an MB52 workbook.
--   p_sap:   [{sku, description, uom, unrestricted, blocked}]  counted storage locations
--   p_other: [{sku, description, uom, sloc, unrestricted, blocked}] the other locations
--   p_moves: [{line_no, sku, description, sloc, mvt_type, mvt_text, mat_doc,
--              posting_date, quantity, uom, reference, customer, customer_name, user_name}]
-- ---------------------------------------------------------------------
create or replace function public.create_stock_recon_mb52(p_as_of date, p_file_name text, p_note text,
  p_sap jsonb, p_other jsonb, p_slocs text[], p_moves jsonb, p_pending jsonb, p_by_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_other text[];
begin
  -- create_stock_recon checks the role, the SAP rows and snapshots our stock.
  v_id := public.create_stock_recon(p_as_of, p_file_name, p_note, p_sap, p_pending, p_by_name);

  -- A SKU SAP holds only outside the counted locations still gets a line.
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

  update public.stock_recons set slocs = coalesce(p_slocs, '{}'), other_slocs = v_other,
    sap_moves = (select count(*) from public.stock_recon_sap_moves where recon_id = v_id)
  where id = v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Status + cause + remark in one call.
-- ---------------------------------------------------------------------
create or replace function public.explain_recon_line(p_line_id uuid, p_status text, p_cause text, p_remark text, p_by_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_status in ('EXPLAINED', 'RESOLVED') and nullif(trim(p_cause), '') is null then
    raise exception 'Pilih penyebab selisih';
  end if;
  perform public.update_recon_line(p_line_id, p_status, p_remark, p_by_name);
  update public.stock_recon_lines set cause = nullif(trim(p_cause), '') where id = p_line_id;
end $$;

-- ---------------------------------------------------------------------
-- Recount every open, unexplained difference of one reconciliation.
-- ---------------------------------------------------------------------
create or replace function public.request_recon_counts_all(p_recon_id uuid, p_by_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l record; n_lines int := 0; n_tasks int := 0; r jsonb;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa meminta hitung';
  end if;
  if (select status from public.stock_recons where id = p_recon_id) is distinct from 'OPEN' then
    raise exception 'Rekonsiliasi tidak ada atau sudah ditutup';
  end if;
  for l in select id from public.stock_recon_lines
           where recon_id = p_recon_id and status = 'OPEN' and item_id is not null
             and (diff_unrestricted <> 0 or diff_blocked <> 0) order by sku loop
    r := public.request_recon_counts(l.id, p_by_name);
    n_lines := n_lines + 1; n_tasks := n_tasks + (r->>'count_tasks')::int;
  end loop;
  return jsonb_build_object('lines', n_lines, 'count_tasks', n_tasks);
end $$;

-- ---------------------------------------------------------------------
-- Shipments vs SAP goods issue, one row per shipment + SKU.
--   MATCH        SAP GI = our picked quantity
--   SAP_MORE     SAP issued more than we picked (we still hold the rest)
--   WMS_MORE     we picked more than SAP issued (not yet GI in SAP)
--   NO_GI        picked here inside the MB51 dates, no GI in the file
--   NOT_IN_WMS   a DO SAP issued that no outbound line of ours carries
-- timing = picked - SAP GI: what our stock is lower than SAP's because
-- of this shipment (negative: higher). NOT_IN_WMS has no timing.
-- ---------------------------------------------------------------------
create or replace function public.recon_shipment_match(p_recon_id uuid)
returns table (status text, shipment_number text, wave_no text, planned_date date, sku text, description text,
               do_nos text[], sap_gi numeric, ordered numeric, picked numeric, timing numeric, last_pick timestamptz, posting_date date)
language plpgsql stable security definer set search_path = public as $$
declare v_slocs text[]; v_from date; v_to date;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa melihat rekonsiliasi';
  end if;
  select r.slocs into v_slocs from public.stock_recons r where r.id = p_recon_id;
  select min(m.posting_date), max(m.posting_date) into v_from, v_to
  from public.stock_recon_sap_moves m where m.recon_id = p_recon_id;

  return query
  with gi as (     -- SAP goods issue per DO + SKU, in the counted storage locations
    select m.reference as do_no, m.sku, max(m.description) as description, -sum(m.quantity) as qty, max(m.posting_date) as posting_date
    from public.stock_recon_sap_moves m
    where m.recon_id = p_recon_id and m.mvt_type in ('601', '602') and m.reference is not null
      and (cardinality(v_slocs) = 0 or m.sloc = any(v_slocs))
    group by 1, 2
  ), ob as (       -- our outbound lines with their DO numbers
    select o.wave_id, o.shipment_number, o.sku, o.item_id, o.description, o.quantity_requested,
           array(select ltrim(trim(x), '0') from unnest(o.order_nos) x where trim(x) <> '') as dos
    from public.outbound o join public.waves w on w.id = o.wave_id
    where w.status <> 'CANCELLED' and o.status <> 'CANCELLED'
  ), hit as (      -- each GI line goes to the outbound line carrying its DO
    select distinct on (g.do_no, g.sku) g.*, ob.wave_id, ob.shipment_number
    from gi g join ob on ob.sku = g.sku and g.do_no = any(ob.dos)
    order by g.do_no, g.sku, ob.wave_id
  ), picks as (
    select t.wave_id, t.shipment_number, t.item_id,
           sum(coalesce(t.actual_quantity, t.quantity)) as qty, max(t.completed_at) as last_at
    from public.pick_tasks t
    where t.task_type = 'PICK' and t.status = 'COMPLETED'
    group by 1, 2, 3
  ), ship as (     -- shipments + SKU that SAP issued, or that we picked inside the MB51 dates
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

-- Write the shipment timing into the lines (auto_gi), replacing any earlier
-- run. NOT_IN_WMS is never counted: SAP may have shipped it from elsewhere.
create or replace function public.apply_recon_auto_gi(p_recon_id uuid, p_by_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text := public.person_name(p_by_name); v_skus int; v_qty numeric;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa mengisi rekonsiliasi';
  end if;
  if (select status from public.stock_recons where id = p_recon_id) is distinct from 'OPEN' then
    raise exception 'Rekonsiliasi tidak ada atau sudah ditutup';
  end if;
  create temp table _auto on commit drop as
    select m.sku, sum(m.timing) as qty from public.recon_shipment_match(p_recon_id) m
    where m.status in ('SAP_MORE', 'WMS_MORE', 'NO_GI') group by 1 having sum(m.timing) <> 0;
  update public.stock_recon_lines l set auto_gi = coalesce((select a.qty from _auto a where a.sku = l.sku), 0)
  where l.recon_id = p_recon_id and l.auto_gi is distinct from coalesce((select a.qty from _auto a where a.sku = l.sku), 0);
  select count(*), coalesce(sum(qty), 0) into v_skus, v_qty from _auto;
  update public.stock_recons set auto_gi_at = now(), auto_gi_by_name = v_name where id = p_recon_id;
  drop table _auto;
  return jsonb_build_object('skus', v_skus, 'qty', v_qty);
end $$;

create or replace function public.clear_recon_auto_gi(p_recon_id uuid, p_by_name text)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text := public.person_name(p_by_name);
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa mengisi rekonsiliasi';
  end if;
  if (select status from public.stock_recons where id = p_recon_id) is distinct from 'OPEN' then
    raise exception 'Rekonsiliasi tidak ada atau sudah ditutup';
  end if;
  update public.stock_recon_lines set auto_gi = 0 where recon_id = p_recon_id and auto_gi <> 0;
  update public.stock_recons set auto_gi_at = null, auto_gi_by_name = v_name where id = p_recon_id;
end $$;

grant select on public.stock_recon_summary to authenticated;
revoke execute on function public.create_stock_recon_mb52(date, text, text, jsonb, jsonb, text[], jsonb, jsonb, text),
  public.explain_recon_line(uuid, text, text, text, text), public.request_recon_counts_all(uuid, text),
  public.recon_shipment_match(uuid), public.apply_recon_auto_gi(uuid, text), public.clear_recon_auto_gi(uuid, text),
  public.stock_recon_moves_forbid_change() from public, anon;
grant execute on function public.create_stock_recon_mb52(date, text, text, jsonb, jsonb, text[], jsonb, jsonb, text),
  public.explain_recon_line(uuid, text, text, text, text), public.request_recon_counts_all(uuid, text),
  public.recon_shipment_match(uuid), public.apply_recon_auto_gi(uuid, text), public.clear_recon_auto_gi(uuid, text) to authenticated;
