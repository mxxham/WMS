-- =====================================================================
-- 0108  Import: hold back "not in file" zeroing of stock the app moved
--
--  A full import (import_snapshot, full_sync) zeroes every stock row the
--  WMS file does not list. On 26 Oct 2026 that wiped real stock: 6 cartons
--  of 550053783 moved CC12A02 -> CC12A01 in the app on 13 Oct were never
--  booked in the Excel, the morning import zeroed them "(not in file)", and
--  the rack audit found all 6 in the bin that afternoon. 37 rows (1,114
--  cartons) were zeroed that morning; the floor had to find the real ones.
--
--  Now a row is held for an admin instead of zeroed when both hold:
--   - the file has no row at all for that bin + SKU (a batch/expiry relabel,
--     where the file still lists the SKU in the bin, is zeroed as before), and
--   - the row's last movement was recorded in the app (transfer, putaway,
--     count, correction), not by an earlier import or the opening balance.
--  The stock stays until an admin decides: zero it (the same "(not in
--  file)" adjustment the import would have made) or keep it (checked on the
--  floor). Stock still changes only through movements.
-- =====================================================================

create table public.import_holds (
  id            uuid primary key default gen_random_uuid(),
  source_name   text not null,
  bin_id        uuid not null references public.bins(id),
  item_id       uuid not null references public.items(id),
  batch_lot     text not null default '',
  expiry_date   date,
  quantity      numeric not null,           -- what the import would have zeroed
  last_move     text,                       -- the app movement that made it suspect
  held_at       timestamptz not null default now(),
  held_by       uuid references public.profiles(id),
  resolved_at   timestamptz,
  resolved_by   uuid references public.profiles(id),
  resolution    text check (resolution in ('ZEROED', 'KEPT')),
  constraint import_holds_resolved check ((resolution is null) = (resolved_at is null))
);
-- One open hold per stock row: a later import that still misses it does not add a second.
create unique index import_holds_open_idx on public.import_holds (bin_id, item_id, batch_lot, coalesce(expiry_date, 'infinity'))
  where resolution is null;

alter table public.import_holds enable row level security;
create policy import_holds_read on public.import_holds for select to authenticated
  using ((select public.is_active()) and (select public.has_role(array['supervisor','admin']::public.user_role[])));
grant select on public.import_holds to authenticated;
-- No write policy: rows are written only by import_snapshot and resolve_import_holds.

create view public.import_hold_detail with (security_invoker = true) as
select h.id, h.source_name, b.bin_code, it.sku, it.description, it.uom, h.batch_lot, h.expiry_date,
       h.quantity as held_qty,
       coalesce((select i.quantity from public.inventory i
                 where i.bin_id = h.bin_id and i.item_id = h.item_id and i.batch_lot = h.batch_lot
                   and i.expiry_date is not distinct from h.expiry_date), 0) as qty_now,
       h.last_move, h.held_at, h.resolution, h.resolved_at, p.name as resolved_by_name
from public.import_holds h
join public.bins b on b.id = h.bin_id
join public.items it on it.id = h.item_id
left join public.profiles p on p.id = h.resolved_by;
grant select on public.import_hold_detail to authenticated;

-- ---------------------------------------------------------------------
-- import_snapshot: 0018's function, with the hold in the full-sync loop.
-- ---------------------------------------------------------------------
create or replace function public.import_snapshot(rows jsonb, full_sync boolean, source_name text, keep_bins text[] default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; v_bin uuid; v_item uuid; v_cur numeric; v_diff numeric; v_exp date; v_batch text;
  n_bins int := 0; n_items int := 0; n_moves int := 0; n_held int := 0; inv record; v_last text;
  v_note text := 'IMPORT ' || coalesce(source_name, 'file');
begin
  if not public.has_role(array['admin']::public.user_role[]) then
    raise exception 'Only admins can import';
  end if;
  -- Opening balances: the file is the approval; reason OPENING, by the import.
  perform set_config('app.adjust_approved', 'on', true);
  perform set_config('app.adjust_reason', 'OPENING', true);
  perform set_config('app.by_name', 'impor ' || coalesce(source_name, 'file'), true);

  -- Dropped first: a second import in the same transaction (tests, scripts) reuses the name.
  drop table if exists _seen;
  create temp table _seen (bin_id uuid, item_id uuid, batch_lot text, expiry_date date) on commit drop;

  for r in select * from jsonb_array_elements(rows) loop
    insert into public.bins (bin_code, zone, rack, level, position, status)
    values (r->>'bin_code', r->>'zone', r->>'rack', r->>'level', r->>'position',
            coalesce(r->>'status','active')::public.bin_status)
    on conflict (bin_code) do update set zone = excluded.zone, rack = excluded.rack,
      level = excluded.level, position = excluded.position
    returning id into v_bin;
    n_bins := n_bins + 1;

    continue when coalesce(r->>'sku','') = '';

    insert into public.items (sku, description, uom, upp, volume_l)
    values (r->>'sku', coalesce(r->>'description', r->>'sku'), r->>'uom',
            nullif(r->>'upp','')::numeric, nullif(r->>'volume_l','')::numeric)
    on conflict (sku) do update set
      description = coalesce(nullif(excluded.description, ''), public.items.description),
      uom  = coalesce(excluded.uom, public.items.uom),
      upp  = coalesce(excluded.upp, public.items.upp),
      volume_l = coalesce(excluded.volume_l, public.items.volume_l)
    returning id into v_item;
    n_items := n_items + 1;

    v_batch := coalesce(r->>'batch_lot','');
    v_exp := nullif(r->>'expiry_date','')::date;
    v_cur := null;
    select quantity into v_cur from public.inventory
      where bin_id = v_bin and item_id = v_item and batch_lot = v_batch
        and expiry_date is not distinct from v_exp;
    if v_cur is null and v_exp is null then
      -- Same fallback as the trigger: a row without expiry in the file
      -- matches the batch's only row in this bin.
      select quantity, expiry_date into v_cur, v_exp from public.inventory
        where bin_id = v_bin and item_id = v_item and batch_lot = v_batch
          and (select count(*) from public.inventory
               where bin_id = v_bin and item_id = v_item and batch_lot = v_batch) = 1;
    end if;
    insert into _seen values (v_bin, v_item, v_batch, v_exp);
    v_diff := (r->>'quantity')::numeric - coalesce(v_cur, 0);
    if v_diff <> 0 then
      insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, received_date, note)
      values ('adjustment', v_item, v_batch, v_diff, v_bin, v_exp,
              nullif(r->>'received_date','')::date, v_note);
      n_moves := n_moves + 1;
    end if;
  end loop;

  -- Full snapshot: stock in the system that is absent from the file is zeroed (with a ledger entry),
  -- except in bins whose rows were rejected by validation (keep_bins), and except stock the app
  -- moved last when the file drops the SKU from the bin altogether: that is held for an admin (0108).
  if full_sync then
    for inv in select i.* from public.inventory i
      join public.bins b on b.id = i.bin_id
      where b.bin_code <> all(keep_bins)  -- bins with rejected rows keep their stock
        and not exists (select 1 from _seen s where s.bin_id = i.bin_id and s.item_id = i.item_id
                          and s.batch_lot = i.batch_lot and s.expiry_date is not distinct from i.expiry_date)
    loop
      v_last := null;
      if not exists (select 1 from _seen s where s.bin_id = inv.bin_id and s.item_id = inv.item_id) then
        select to_char(m.created_at at time zone 'Asia/Jakarta', 'DD Mon YYYY') || ' ' || m.type
                 || coalesce(' · ' || nullif(trim(m.note), ''), '')
          into v_last
          from public.movements m
          where m.item_id = inv.item_id and m.batch_lot = inv.batch_lot
            and (m.to_bin_id = inv.bin_id or m.from_bin_id = inv.bin_id)
            and coalesce(m.note, '') not like 'IMPORT %'
            and coalesce(m.note, '') not like 'OPENING BALANCE%'
            and m.created_at > coalesce((select max(x.created_at) from public.movements x
                 where x.item_id = inv.item_id and x.batch_lot = inv.batch_lot
                   and (x.to_bin_id = inv.bin_id or x.from_bin_id = inv.bin_id)
                   and (x.note like 'IMPORT %' or x.note like 'OPENING BALANCE%')), '-infinity')
          order by m.created_at desc limit 1;
      end if;
      if v_last is not null then
        insert into public.import_holds (source_name, bin_id, item_id, batch_lot, expiry_date, quantity, last_move, held_by)
        values (coalesce(source_name, 'file'), inv.bin_id, inv.item_id, inv.batch_lot, inv.expiry_date, inv.quantity, v_last, auth.uid())
        on conflict (bin_id, item_id, batch_lot, coalesce(expiry_date, 'infinity')) where resolution is null
        do update set source_name = excluded.source_name, quantity = excluded.quantity, held_at = now();
        n_held := n_held + 1;
        continue;
      end if;
      insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
      values ('adjustment', inv.item_id, inv.batch_lot, -inv.quantity, inv.bin_id, inv.expiry_date,
              v_note || ' (not in file)');
      n_moves := n_moves + 1;
    end loop;
  end if;

  perform set_config('app.adjust_approved', '', true);
  perform set_config('app.adjust_reason', '', true);
  perform set_config('app.by_name', '', true);
  return jsonb_build_object('rows', n_bins, 'item_rows', n_items, 'movements', n_moves, 'held', n_held);
end $$;

-- ---------------------------------------------------------------------
-- An admin decides held rows: zero them as the import would have, or keep them.
-- ---------------------------------------------------------------------
create or replace function public.resolve_import_holds(p_ids uuid[], p_zero boolean, p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text := public.person_name(p_name, 'Nama');
  h record; v_qty numeric; n_zeroed int := 0; n_kept int := 0;
begin
  if not public.has_role(array['admin']::public.user_role[]) then
    raise exception 'Hanya admin yang memutuskan stok yang ditahan impor';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then raise exception 'Pilih baris dulu'; end if;
  perform set_config('app.adjust_approved', 'on', true);
  perform set_config('app.adjust_reason', 'OPENING', true);
  perform set_config('app.by_name', v_name, true);

  for h in select * from public.import_holds where id = any(p_ids) and resolution is null order by id for update loop
    if p_zero then
      select quantity into v_qty from public.inventory
        where bin_id = h.bin_id and item_id = h.item_id and batch_lot = h.batch_lot
          and expiry_date is not distinct from h.expiry_date
        for update;
      if coalesce(v_qty, 0) > 0 then
        insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note, ref_id)
        values ('adjustment', h.item_id, h.batch_lot, -v_qty, h.bin_id, h.expiry_date,
                'IMPORT ' || h.source_name || ' (not in file)', h.id);
      end if;
      n_zeroed := n_zeroed + 1;
    else
      n_kept := n_kept + 1;
    end if;
    update public.import_holds set resolution = case when p_zero then 'ZEROED' else 'KEPT' end,
      resolved_at = now(), resolved_by = auth.uid()
      where id = h.id;
  end loop;

  perform set_config('app.adjust_approved', '', true);
  perform set_config('app.adjust_reason', '', true);
  perform set_config('app.by_name', '', true);
  return jsonb_build_object('zeroed', n_zeroed, 'kept', n_kept);
end $$;

revoke execute on function public.resolve_import_holds(uuid[], boolean, text) from public, anon;
grant execute on function public.resolve_import_holds(uuid[], boolean, text) to authenticated;

-- The import page refreshes on new holds (guarded: plain Postgres has no publication; 0015).
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication not found; skipping';
    return;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'import_holds') then
    alter publication supabase_realtime add table public.import_holds;
  end if;
end $$;
