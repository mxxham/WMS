-- =====================================================================
-- 0021  Reconciliation with Shell's SAP stock (Rekonsiliasi SAP)
--
--  Shell's SAP holds the book stock per SKU (plant I003 / WHS1, batch
--  "UT"), split Unrestricted / Blocked. A reconciliation run snapshots
--  both sides at upload time:
--    WMS unrestricted = physical - held - quarantine
--    WMS blocked      = held + quarantine
--  and explains timing: pending GI (shipped, not yet goods-issued in SAP,
--  still in SAP's stock) and pending GR (received here, not yet received
--  in SAP). diff = SAP - (WMS + pending GI - pending GR).
--  Each line with a difference is worked: remark, recount request (count
--  tasks for every bin of the SKU), explained / resolved.
-- =====================================================================

create table public.stock_recons (
  id               uuid primary key default gen_random_uuid(),
  as_of            date not null,
  file_name        text,
  note             text,
  status           text not null default 'OPEN' check (status in ('OPEN', 'CLOSED')),
  created_by       uuid references public.profiles(id),
  created_by_name  text not null,
  created_at       timestamptz not null default now(),
  closed_by_name   text,
  closed_at        timestamptz,
  close_note       text
);

create table public.stock_recon_lines (
  id                uuid primary key default gen_random_uuid(),
  recon_id          uuid not null references public.stock_recons(id) on delete cascade,
  item_id           uuid references public.items(id),
  sku               text not null,
  description       text,
  sap_uom           text,
  wms_uom           text,
  sap_unrestricted  numeric not null default 0,
  sap_blocked       numeric not null default 0,
  wms_unrestricted  numeric not null default 0,
  wms_blocked       numeric not null default 0,
  pending_gi        numeric not null default 0,
  pending_gr        numeric not null default 0,
  diff_unrestricted numeric generated always as (sap_unrestricted - (wms_unrestricted + pending_gi - pending_gr)) stored,
  diff_blocked      numeric generated always as (sap_blocked - wms_blocked) stored,
  status            text not null default 'OPEN' check (status in ('OPEN', 'EXPLAINED', 'COUNT_REQUESTED', 'RESOLVED')),
  remark            text,
  updated_by_name   text,
  updated_at        timestamptz,
  unique (recon_id, sku)
);
create index stock_recon_lines_recon_idx on public.stock_recon_lines (recon_id);

alter table public.stock_recons enable row level security;
alter table public.stock_recon_lines enable row level security;
create policy "stock_recons: read" on public.stock_recons for select to authenticated using (true);
create policy "stock_recon_lines: read" on public.stock_recon_lines for select to authenticated using (true);

-- Our stock per SKU, split the way SAP splits it.
create or replace function public.wms_stock_by_sku()
returns table (item_id uuid, sku text, description text, uom text, physical numeric, unrestricted numeric, blocked numeric)
language sql stable security definer set search_path = public as $$
  with lines as (
    select i.item_id, i.quantity,
           case when b.zone = 'QUARANTINE' then i.quantity
                else public.held_qty(i.bin_id, i.item_id, i.batch_lot, i.expiry_date, i.quantity) end as blocked
    from public.inventory i join public.bins b on b.id = i.bin_id
  )
  select it.id, it.sku, it.description, it.uom, sum(l.quantity), sum(l.quantity - l.blocked), sum(l.blocked)
  from lines l join public.items it on it.id = l.item_id
  group by it.id, it.sku, it.description, it.uom;
$$;

-- p_sap: [{sku, description, uom, unrestricted, blocked}] (several rows per SKU are summed)
-- p_pending: [{sku, pending_gi, pending_gr}]
create or replace function public.create_stock_recon(p_as_of date, p_file_name text, p_note text, p_sap jsonb, p_pending jsonb, p_by_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_name text := public.person_name(p_by_name); v_id uuid;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa membuat rekonsiliasi';
  end if;
  if jsonb_typeof(p_sap) <> 'array' or jsonb_array_length(p_sap) = 0 then raise exception 'File SAP kosong'; end if;
  insert into public.stock_recons (as_of, file_name, note, created_by, created_by_name)
  values (coalesce(p_as_of, current_date), nullif(trim(p_file_name), ''), nullif(trim(p_note), ''), auth.uid(), v_name)
  returning id into v_id;

  insert into public.stock_recon_lines (recon_id, item_id, sku, description, sap_uom, wms_uom,
    sap_unrestricted, sap_blocked, wms_unrestricted, wms_blocked, pending_gi, pending_gr)
  with sap as (
    select trim(s->>'sku') as sku, max(s->>'description') as description, max(upper(s->>'uom')) as uom,
           sum(coalesce((s->>'unrestricted')::numeric, 0)) as unrestricted, sum(coalesce((s->>'blocked')::numeric, 0)) as blocked
    from jsonb_array_elements(p_sap) s where coalesce(trim(s->>'sku'), '') <> '' group by 1
  ), pend as (
    select trim(p->>'sku') as sku, sum(coalesce((p->>'pending_gi')::numeric, 0)) as gi, sum(coalesce((p->>'pending_gr')::numeric, 0)) as gr
    from jsonb_array_elements(coalesce(p_pending, '[]'::jsonb)) p where coalesce(trim(p->>'sku'), '') <> '' group by 1
  ), wms as (select * from public.wms_stock_by_sku()),
  skus as (select sku from sap union select sku from wms union select sku from pend)
  select v_id, coalesce(w.item_id, it.id), k.sku, coalesce(w.description, it.description, s.description),
         s.uom, coalesce(w.uom, it.uom),
         coalesce(s.unrestricted, 0), coalesce(s.blocked, 0), coalesce(w.unrestricted, 0), coalesce(w.blocked, 0),
         coalesce(p.gi, 0), coalesce(p.gr, 0)
  from skus k
  left join sap s on s.sku = k.sku
  left join wms w on w.sku = k.sku
  left join pend p on p.sku = k.sku
  left join public.items it on it.sku = k.sku;
  return v_id;
end $$;

create or replace function public.update_recon_line(p_line_id uuid, p_status text, p_remark text, p_by_name text)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text := public.person_name(p_by_name);
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa mengisi rekonsiliasi';
  end if;
  if p_status in ('EXPLAINED', 'RESOLVED') and nullif(trim(p_remark), '') is null then
    raise exception 'Tulis penjelasan selisih';
  end if;
  update public.stock_recon_lines l set status = p_status, remark = nullif(trim(p_remark), ''), updated_by_name = v_name, updated_at = now()
  where l.id = p_line_id and (select status from public.stock_recons r where r.id = l.recon_id) = 'OPEN';
  if not found then raise exception 'Baris tidak ada atau rekonsiliasi sudah ditutup'; end if;
end $$;

-- Recount every bin that holds the SKU (one open count task per bin).
create or replace function public.request_recon_counts(p_line_id uuid, p_by_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text := public.person_name(p_by_name); l public.stock_recon_lines%rowtype; b record; n int := 0;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa meminta hitung';
  end if;
  select * into l from public.stock_recon_lines where id = p_line_id;
  if l.id is null or l.item_id is null then raise exception 'SKU ini tidak ada di master item'; end if;
  for b in select distinct bn.bin_code from public.inventory i join public.bins bn on bn.id = i.bin_id
           where i.item_id = l.item_id and bn.status = 'active' order by 1 loop
    perform public.create_count_task(b.bin_code, 'Rekonsiliasi SAP: selisih SKU ' || l.sku, 'RECON');
    n := n + 1;
  end loop;
  update public.stock_recon_lines set status = 'COUNT_REQUESTED', updated_by_name = v_name, updated_at = now(),
    remark = coalesce(remark, 'Hitung ulang ' || n || ' bin') where id = p_line_id;
  return jsonb_build_object('count_tasks', n);
end $$;

create or replace function public.close_stock_recon(p_id uuid, p_note text, p_by_name text)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text := public.person_name(p_by_name); v_open int;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa menutup rekonsiliasi';
  end if;
  select count(*) into v_open from public.stock_recon_lines
  where recon_id = p_id and status in ('OPEN', 'COUNT_REQUESTED') and (diff_unrestricted <> 0 or diff_blocked <> 0);
  if v_open > 0 and nullif(trim(p_note), '') is null then
    raise exception '% selisih belum dijelaskan: tulis catatan penutupan', v_open;
  end if;
  update public.stock_recons set status = 'CLOSED', closed_by_name = v_name, closed_at = now(), close_note = nullif(trim(p_note), '')
  where id = p_id and status = 'OPEN';
  if not found then raise exception 'Rekonsiliasi tidak ada atau sudah ditutup'; end if;
end $$;

create or replace view public.stock_recon_summary with (security_invoker = true) as
select r.*,
       count(l.id) as skus,
       count(l.id) filter (where l.diff_unrestricted = 0 and l.diff_blocked = 0) as skus_match,
       round(100.0 * count(l.id) filter (where l.diff_unrestricted = 0 and l.diff_blocked = 0) / nullif(count(l.id), 0), 2) as accuracy_pct,
       coalesce(sum(abs(l.diff_unrestricted) + abs(l.diff_blocked)), 0) as abs_diff,
       coalesce(sum(l.sap_unrestricted + l.sap_blocked), 0) as sap_total,
       count(l.id) filter (where (l.diff_unrestricted <> 0 or l.diff_blocked <> 0) and l.status in ('OPEN', 'COUNT_REQUESTED')) as open_diffs
from public.stock_recons r left join public.stock_recon_lines l on l.recon_id = r.id
group by r.id;

grant select on public.stock_recons, public.stock_recon_lines, public.stock_recon_summary to authenticated;
grant all on public.stock_recons, public.stock_recon_lines to service_role;
grant execute on function public.wms_stock_by_sku() to authenticated;
revoke execute on function public.create_stock_recon(date, text, text, jsonb, jsonb, text), public.update_recon_line(uuid, text, text, text),
  public.request_recon_counts(uuid, text), public.close_stock_recon(uuid, text, text) from public, anon;
grant execute on function public.create_stock_recon(date, text, text, jsonb, jsonb, text), public.update_recon_line(uuid, text, text, text),
  public.request_recon_counts(uuid, text), public.close_stock_recon(uuid, text, text) to authenticated;
