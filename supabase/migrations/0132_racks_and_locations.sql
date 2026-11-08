-- =====================================================================
-- 0132  Rak & Lokasi: every rack position has a state and an owner
--
--  8 Nov 2026: Inventory -> Bin kosong offered CE32A02, a pillar. The
--  phantom bins (CE33, CE32 position 02, CE34 position 01) were listed in
--  the allocator's config as "deleted from the DB", but no migration ever
--  deleted them, and import_snapshot recreates any unknown bin as active.
--  Blocking was a raw admin form with no reason or history; occupancy
--  counted blocked bins as free space; "CKB uses CG/CH and CF21-CF40
--  level A" was spelled in five places, the last one by blocking the bins.
--  Spec: docs/superpowers/specs/2026-11-08-racks-and-locations-design.md.
--
--  1  Model: bins.block_kind / block_reason / owner, bin_changes (append-
--     only history), bin_usable() — the one answer to "may this side use
--     this bin" — and today's data.
--  2  Ledger guards (apply_movement), rebagging and import.
--  3  State / owner / attribute RPCs with a preview twin.
--  4  Plan, activate and cancel racks.
--  5  Read side: empty bins, bin summary, dashboard, planning stock.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1  Model
-- ---------------------------------------------------------------------
-- status stays the "may stock go here" switch, so every guard that already
-- refuses a blocked bin keeps working. block_kind says why it is blocked.
alter table public.bins
  add column block_kind   text check (block_kind in ('BLOCKED', 'NOT_PRESENT', 'PLANNED')),
  add column block_reason text,
  add column owner        text check (owner in ('SHELL', 'CKB'));

-- Floor locations (STAGING, STG_xx, QUARANTINE: rack is null) are shared by
-- both sides, so they carry no owner. Legacy writers (an old migration re-run
-- by a test, the import, the seed) set only status: the trigger fills the rest.
create or replace function public.bins_normalize() returns trigger language plpgsql as $$
begin
  if new.status = 'active' then
    -- A kind written on an active bin is a mistake; a status-only write that activates clears the kind.
    if new.block_kind is not null and (tg_op = 'INSERT' or new.block_kind is distinct from old.block_kind) then
      raise exception 'Bin % aktif tidak bisa berstatus %', new.bin_code, new.block_kind;
    end if;
    new.block_kind := null;
  elsif new.block_kind is null then
    new.block_kind := 'BLOCKED';
  end if;
  if new.rack is null then
    new.owner := null;
  elsif new.owner is null then
    new.owner := 'SHELL';
  end if;
  return new;
end $$;
create trigger bins_normalize before insert or update on public.bins
  for each row execute function public.bins_normalize();

update public.bins set owner = case when rack is null then null else 'SHELL' end,
                       block_kind = case when status = 'active' then null else 'BLOCKED' end;
alter table public.bins
  add constraint bins_state_ck check ((status = 'active') = (block_kind is null)),
  add constraint bins_owner_ck check ((rack is null) = (owner is null));

-- The state a person sees.
create or replace function public.bin_state(p_status public.bin_status, p_kind text)
returns text language sql immutable as $$
  select case when p_status = 'active' then 'ACTIVE' else coalesce(p_kind, 'BLOCKED') end
$$;

-- The one answer to "may this side put stock in / take stock from this bin".
-- Mirrored by lib/racks.ts usableForShell.
create or replace function public.bin_usable(p_bin uuid, p_side text default 'SHELL')
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select b.status = 'active' and (b.owner = p_side or b.owner is null)
                   from public.bins b where b.id = p_bin), false)
$$;
grant execute on function public.bin_state(public.bin_status, text), public.bin_usable(uuid, text) to authenticated;

-- History. One confirmed action = one change_set.
create table public.bin_changes (
  id              bigint generated always as identity primary key,
  change_set      uuid not null,
  bin_code        text not null,
  field           text not null check (field in ('STATE', 'OWNER', 'CREATED', 'REMOVED', 'ATTR')),
  old_value       text,
  new_value       text,
  reason          text not null,
  changed_by      uuid references public.profiles(id),
  changed_by_name text not null,
  changed_at      timestamptz not null default now()
);
create index bin_changes_at_idx on public.bin_changes (changed_at desc);
create index bin_changes_bin_idx on public.bin_changes (bin_code);
create index bin_changes_set_idx on public.bin_changes (change_set);

create or replace function public.bin_changes_forbid_change() returns trigger language plpgsql as $$
begin
  raise exception 'Riwayat rak tidak bisa diubah atau dihapus';
end $$;
create trigger bin_changes_forbid_change before update or delete on public.bin_changes
  for each row execute function public.bin_changes_forbid_change();
create trigger bin_changes_forbid_truncate before truncate on public.bin_changes
  for each statement execute function public.bin_changes_forbid_change();

alter table public.bin_changes enable row level security;
create policy "bin_changes: read" on public.bin_changes for select to authenticated using ((select public.is_active()));
grant select on public.bin_changes to authenticated;

create or replace function public.log_bin_change(p_set uuid, p_code text, p_field text, p_old text, p_new text,
                                                 p_reason text, p_by_name text)
returns void language sql security definer set search_path = public as $$
  insert into public.bin_changes (change_set, bin_code, field, old_value, new_value, reason, changed_by, changed_by_name)
  values (p_set, p_code, p_field, p_old, p_new, p_reason, auth.uid(), p_by_name);
$$;
revoke execute on function public.log_bin_change(uuid, text, text, text, text, text, text) from public, anon, authenticated;

-- Bins change only through the RPCs below (sections 3 and 4).
drop policy if exists "bins: admin write" on public.bins;

-- ---------------------------------------------------------------------
-- 1b  Today's data
-- ---------------------------------------------------------------------
-- Never refuses: a live push must not stop on data. A bin that cannot change safely is left as it is, says why
-- (block_reason + a bin_changes row + a NOTICE), and is finished later on Rak & Lokasi. 8 Nov 2026, first push to
-- ckb-wms-v2: CF21A01, CF21A02, CF39A01 and CF39A02 held Shell stock (booked by the WMS import while 0120 had them
-- blocked), and the earlier refusing version of this step stopped the push.
do $$
declare
  v_set uuid; v_list text;
  c_phantom constant text := '^(CE33[A-E]0[12]|CE32[A-E]02|CE34[A-E]01)$';
  c_ckb_a   constant text := '^CF(2[1-9]|3[0-9]|40)A0[12]$';
begin
  -- Bins that hold Shell's things: stock, a pickface, an open pick task.
  create temp table _stuck on commit drop as
  select b.id, b.bin_code, concat_ws('; ',
           (select 'stok ' || string_agg(it.sku || ' × ' || i.quantity, ', ') from public.inventory i
              join public.items it on it.id = i.item_id where i.bin_id = b.id and i.quantity > 0),
           (select 'pickface ' || string_agg(it.sku, ', ') from public.pickfaces p join public.items it on it.id = p.item_id
             where p.bin_id = b.id),
           (select 'tugas terbuka' from public.open_pick_tasks t where t.from_bin_id = b.id or t.to_bin_id = b.id limit 1)) as what
  from public.bins b;
  delete from _stuck where what = '';

  -- 1. The pillars. Rows are ensured so an import can never recreate them as active.
  insert into public.bins (bin_code, zone, rack, level, position, status, capacity)
  select 'CE' || to_char(r, 'FM00') || l || to_char(p, 'FM00'), 'CE', to_char(r, 'FM00'), l, to_char(p, 'FM00'), 'active', 1
  from (values (33, 1), (33, 2), (32, 2), (34, 1)) as x(r, p), unnest(array['A','B','C','D','E']) l
  on conflict (bin_code) do nothing;

  v_set := gen_random_uuid();
  insert into public.bin_changes (change_set, bin_code, field, old_value, new_value, reason, changed_by_name)
  select v_set, b.bin_code, 'STATE', public.bin_state(b.status, b.block_kind),
         case when s.id is null then 'NOT_PRESENT' else 'BLOCKED' end,
         case when s.id is null then 'tiang, tidak ada rak (0132)'
              else 'tiang, tapi masih ada ' || s.what || ' (0132): pindahkan, lalu tandai tidak ada' end,
         'migrasi 0132'
  from public.bins b left join _stuck s on s.id = b.id where b.bin_code ~ c_phantom;
  update public.bins b set status = 'blocked', block_kind = 'NOT_PRESENT', block_reason = 'tiang, tidak ada rak (0132)'
  where b.bin_code ~ c_phantom and not exists (select 1 from _stuck s where s.id = b.id);
  update public.bins b set status = 'blocked', block_kind = 'BLOCKED',
         block_reason = 'tiang, tapi masih ada ' || s.what || ' (0132): pindahkan, lalu tandai tidak ada'
  from _stuck s where s.id = b.id and b.bin_code ~ c_phantom;
  select string_agg(bin_code || ' (' || what || ')', ', ') into v_list from _stuck s
  join public.bins b using (id, bin_code) where b.bin_code ~ c_phantom;
  if v_list is not null then raise notice 'Bin tiang belum ditandai tidak ada, masih dipakai: %', v_list; end if;

  -- 2. Lent to CKB 3PL: aisles CG and CH (0086), and level A of CF21-CF40 (0120 lent them by blocking them).
  --    Stock in CG/CH is CKB's (rebagging, 0086). In CF21-CF40 level A stock is Shell's: such a bin, and any bin
  --    with a Shell pickface or open task, stays Shell's for now (blocked as 0120 left it), with the reason.
  insert into public.bins (bin_code, zone, rack, level, position, status, capacity)
  select 'CF' || to_char(r, 'FM00') || 'A' || to_char(p, 'FM00'), 'CF', to_char(r, 'FM00'), 'A', to_char(p, 'FM00'), 'active', 1
  from generate_series(21, 40) r, generate_series(1, 2) p
  on conflict (bin_code) do nothing;
  create temp table _keep on commit drop as
  select b.id, b.bin_code, s.what from public.bins b join _stuck s on s.id = b.id
  where b.rack is not null and (b.bin_code ~ c_ckb_a
        or (b.zone in ('CG', 'CH') and (s.what like '%pickface%' or s.what like '%tugas terbuka%')));
  v_set := gen_random_uuid();
  insert into public.bin_changes (change_set, bin_code, field, old_value, new_value, reason, changed_by_name)
  select v_set, b.bin_code, 'OWNER', 'SHELL', 'CKB', 'dipakai CKB 3PL (0086, 0120)', 'migrasi 0132'
  from public.bins b where b.rack is not null and (b.zone in ('CG', 'CH') or b.bin_code ~ c_ckb_a)
    and not exists (select 1 from _keep k where k.id = b.id);
  insert into public.bin_changes (change_set, bin_code, field, old_value, new_value, reason, changed_by_name)
  select v_set, k.bin_code, 'OWNER', 'SHELL', 'SHELL',
         'belum dipinjamkan ke CKB 3PL: masih ada ' || k.what || ' Shell (0132). Pindahkan, lalu pinjamkan di Rak & Lokasi', 'migrasi 0132'
  from _keep k;
  update public.bins b set owner = 'CKB' where b.rack is not null and (b.zone in ('CG', 'CH') or b.bin_code ~ c_ckb_a)
    and not exists (select 1 from _keep k where k.id = b.id);
  update public.bins b set status = 'active', block_reason = null
  where b.bin_code ~ c_ckb_a and b.status = 'blocked' and b.owner = 'CKB';
  update public.bins b set status = 'blocked', block_kind = 'BLOCKED',
         block_reason = 'untuk CKB 3PL, tapi masih ada ' || k.what || ' Shell (0132): pindahkan, lalu pinjamkan ke CKB'
  from _keep k where k.id = b.id;
  select string_agg(bin_code || ' (' || what || ')', ', ') into v_list from _keep;
  if v_list is not null then raise notice 'Belum dipinjamkan ke CKB 3PL (masih dipakai Shell): %', v_list; end if;

  -- 3. Anything else already blocked keeps being blocked, now with a kind.
  v_set := gen_random_uuid();
  insert into public.bin_changes (change_set, bin_code, field, old_value, new_value, reason, changed_by_name)
  select v_set, bin_code, 'STATE', 'BLOCKED', 'BLOCKED', 'diblokir sebelum 0132', 'migrasi 0132'
  from public.bins where block_kind = 'BLOCKED' and block_reason is null;
  update public.bins set block_reason = 'diblokir sebelum 0132' where block_kind = 'BLOCKED' and block_reason is null;
end $$;

-- ---------------------------------------------------------------------
-- 2  Ledger guards, rebagging and import
-- ---------------------------------------------------------------------
-- Every stock change passes movements. This guard runs before movements_apply (triggers fire in name order):
--   * nothing enters a bin that does not exist (NOT_PRESENT) or is not built yet (PLANNED); leaving one is
--     allowed, that is how a data error is cleaned up;
--   * a rack bin is used only by its owner. A movement is CKB 3PL's when app.ckb_movement is 'on' or it
--     belongs to a rebagging job (ref_id), the one CKB writer of movements today; anything else is Shell's.
--     Floor locations (no owner) are shared.
-- SECURITY INVOKER on purpose: current_user tells a direct API insert ('authenticated') from a posting
-- function running as its owner, so only the latter may use a rebagging job's ref_id.
create or replace function public.movements_bin_guard() returns trigger
language plpgsql security invoker set search_path = public as $$
declare
  v_side text; f public.bins%rowtype; t public.bins%rowtype; b public.bins%rowtype;
begin
  v_side := case when coalesce(current_setting('app.ckb_movement', true), '') = 'on'
                   -- a rebagging posting (SECURITY DEFINER, so not the API role) carries its job as ref_id;
                   -- a direct API insert cannot borrow a job id to reach a CKB rack
                   or (current_user <> 'authenticated' and new.ref_id is not null
                       and exists (select 1 from public.ckb_rebagging_jobs j where j.id = new.ref_id))
                 then 'CKB' else 'SHELL' end;
  if new.from_bin_id is not null then select * into f from public.bins where id = new.from_bin_id; end if;
  if new.to_bin_id is not null then select * into t from public.bins where id = new.to_bin_id; end if;

  if t.id is not null and (new.type in ('inbound', 'putaway', 'transfer') or (new.type = 'adjustment' and new.quantity > 0)) then
    if t.block_kind = 'NOT_PRESENT' then
      raise exception 'Bin % tidak ada (tiang / tidak ada rak): stok tidak bisa masuk', t.bin_code;
    elsif t.block_kind = 'PLANNED' then
      raise exception 'Bin % belum dibangun (Rencana): stok tidak bisa masuk', t.bin_code;
    end if;
  end if;

  foreach b in array array_remove(array[f, t], null) loop
    continue when b.id is null or b.owner is null or b.owner = v_side;
    if b.owner = 'CKB' then
      raise exception 'Bin % dipinjam CKB 3PL: bukan untuk stok Shell', b.bin_code;
    else
      raise exception 'Bin % rak Shell: bukan untuk CKB 3PL', b.bin_code;
    end if;
  end loop;
  return new;
end $$;
create trigger movements_a_bin_guard before insert on public.movements
  for each row execute function public.movements_bin_guard();

-- Rebagging takes from and puts into CKB 3PL racks or floor locations only.
create or replace function public.ckb_rebagging_bin_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_bin public.bins%rowtype;
begin
  select * into v_bin from public.bins
  where id = case tg_table_name when 'ckb_rebagging_outputs' then (to_jsonb(new)->>'to_bin_id')::uuid
                                else (to_jsonb(new)->>'bin_id')::uuid end;
  if v_bin.owner is not null and v_bin.owner <> 'CKB' then
    raise exception 'Baris %: bin % bukan rak CKB', new.line_no, v_bin.bin_code;
  end if;
  return new;
end $$;
create trigger ckb_rebagging_sources_bin_guard before insert or update on public.ckb_rebagging_sources
  for each row execute function public.ckb_rebagging_bin_guard();
create trigger ckb_rebagging_outputs_bin_guard before insert or update on public.ckb_rebagging_outputs
  for each row execute function public.ckb_rebagging_bin_guard();

do $$
declare v_bad text;
begin
  select string_agg(distinct j.job_no || ' (' || b.bin_code || ')', ', ') into v_bad
  from public.ckb_rebagging_jobs j
  join (select job_id, bin_id from public.ckb_rebagging_sources
        union all select job_id, to_bin_id from public.ckb_rebagging_outputs) l on l.job_id = j.id
  join public.bins b on b.id = l.bin_id
  where j.status not in ('COMPLETED', 'CANCELLED', 'REVERSED') and b.owner = 'SHELL';
  if v_bad is not null then
    raise notice 'Rebagging terbuka memakai rak Shell, posting-nya akan ditolak sampai raknya CKB: %', v_bad;
  end if;
end $$;

-- The import (0108) with 0132's two rules; otherwise unchanged.
create or replace function public.import_snapshot(rows jsonb, full_sync boolean, source_name text, keep_bins text[] default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; v_bin uuid; v_item uuid; v_cur numeric; v_diff numeric; v_exp date; v_batch text;
  n_bins int := 0; n_items int := 0; n_moves int := 0; n_held int := 0; inv record; v_last text;
  v_note text := 'IMPORT ' || coalesce(source_name, 'file');
  v_brow public.bins%rowtype; v_skip jsonb := '[]'::jsonb;
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

    -- 0132: the WMS file is Shell's. A CKB 3PL rack is not Shell's to book, and stock cannot sit in a
    -- bin that does not exist or is not built yet: the row is skipped and reported, never guessed.
    select * into v_brow from public.bins where id = v_bin;
    if v_brow.owner = 'CKB' or v_brow.block_kind in ('NOT_PRESENT', 'PLANNED') then
      -- Only a row with stock is worth a report line (the sheet lists CKB aisles with Remain Qty 0, 0086).
      if coalesce(nullif(r->>'quantity', '')::numeric, 0) > 0 then
      v_skip := v_skip || jsonb_build_object('bin_code', v_brow.bin_code, 'sku', r->>'sku',
        'quantity', nullif(r->>'quantity', '')::numeric,
        'reason', case when v_brow.owner = 'CKB' then 'CKB' when v_brow.block_kind = 'NOT_PRESENT' then 'TIDAK_ADA' else 'RENCANA' end);
      end if;
      continue;
    end if;

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
        and b.owner is distinct from 'CKB'  -- 0132: the WMS file never lists CKB 3PL stock
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
  return jsonb_build_object('rows', n_bins, 'item_rows', n_items, 'movements', n_moves, 'held', n_held, 'skipped', v_skip);
end $$;

-- ---------------------------------------------------------------------
-- 3  State, owner and attribute changes (preview + apply share one function)
-- ---------------------------------------------------------------------
-- Why one bin cannot change now, in the words the page shows. Empty = it can.
create or replace function public.bin_blockers(p_bin uuid, p_owner_change boolean)
returns text language sql stable security definer set search_path = public as $$
  select nullif(concat_ws('; ',
    (select 'masih berisi ' || string_agg(q || ' karton ' || sku, ', ' order by sku)
       from (select it.sku, trim(to_char(sum(i.quantity), 'FM999999990.###')) as q
             from public.inventory i join public.items it on it.id = i.item_id
             where i.bin_id = p_bin and i.quantity > 0 group by it.sku) s),
    (select 'pickface ' || string_agg(it.sku, ', ') from public.pickfaces p join public.items it on it.id = p.item_id
      where p.bin_id = p_bin),
    (select 'tugas terbuka ' || string_agg(distinct 'NO ' || w.wave_no || ' #' || t.seq, ', ')
       from public.open_pick_tasks t join public.waves w on w.id = t.wave_id
      where t.from_bin_id = p_bin or t.to_bin_id = p_bin),
    case when p_owner_change and exists (select 1 from public.ckb_packages k where k.bin_id = p_bin and k.status = 'ACTIVE')
         then 'paket CKB aktif' end,
    case when p_owner_change and exists (
           select 1 from public.ckb_rebagging_jobs j
           join (select job_id, bin_id from public.ckb_rebagging_sources
                 union all select job_id, to_bin_id from public.ckb_rebagging_outputs) l on l.job_id = j.id
           where l.bin_id = p_bin and j.status not in ('COMPLETED', 'CANCELLED', 'REVERSED'))
         then 'rebagging terbuka' end,
    case when p_owner_change and exists (
           select 1 from public.ckb_count_tasks c join public.ckb_stocktakes s on s.id = c.stocktake_id
           join public.bins b on b.id = p_bin
           where c.storage_bin = b.bin_code and s.status not in ('CLOSED', 'CANCELLED'))
         then 'hitung stok CKB terbuka' end
  ), '')
$$;
revoke execute on function public.bin_blockers(uuid, boolean) from public, anon, authenticated;

create or replace function public.bin_change_preview(p_codes text[], p_field text, p_value text)
returns table (bin_code text, ok boolean, reason text, state text, owner text)
language plpgsql stable security definer set search_path = public as $$
declare
  c text; b public.bins%rowtype; v_state text; v_block text;
  c_state_label constant jsonb := '{"ACTIVE":"Aktif","BLOCKED":"Diblokir","NOT_PRESENT":"Tidak ada","PLANNED":"Rencana"}';
  c_owner_label constant jsonb := '{"SHELL":"Shell","CKB":"CKB 3PL"}';
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa mengubah rak';
  end if;
  if p_field = 'STATE' and p_value not in ('ACTIVE', 'BLOCKED', 'NOT_PRESENT', 'PRESENT')
     or p_field = 'OWNER' and p_value not in ('SHELL', 'CKB')
     or p_field not in ('STATE', 'OWNER') then
    raise exception 'Perubahan % % tidak dikenal', p_field, p_value;
  end if;
  for c in select distinct upper(trim(x)) from unnest(p_codes) x where trim(coalesce(x, '')) <> '' order by 1 loop
    b := null;
    select * into b from public.bins where public.bins.bin_code = c;
    if b.id is null then
      bin_code := c; ok := false; reason := 'bin tidak ditemukan'; state := null; owner := null; return next; continue;
    end if;
    v_state := public.bin_state(b.status, b.block_kind);
    bin_code := b.bin_code; state := v_state; owner := b.owner; ok := false; reason := null;
    if p_field = 'STATE' then
      -- A pillar only changes through Tandai ada lagi (PRESENT); Blokir / Buka blokir of a whole aisle leave it alone.
      if v_state = 'PLANNED' then reason := 'Rencana: aktifkan lewat Aktifkan';
      elsif p_value = 'PRESENT' then
        if v_state <> 'NOT_PRESENT' then reason := 'bukan bin tidak ada'; end if;
      elsif v_state = 'NOT_PRESENT' and p_value <> 'NOT_PRESENT' then reason := 'tidak ada (tiang): pakai Tandai ada lagi';
      elsif v_state = p_value then reason := 'sudah ' || lower(c_state_label->>p_value);
      elsif p_value in ('BLOCKED', 'NOT_PRESENT') then reason := public.bin_blockers(b.id, false);
      end if;
    else
      if b.rack is null then reason := 'rak lantai tidak punya pemilik';
      elsif b.owner = p_value then reason := 'sudah milik ' || (c_owner_label->>p_value);
      else reason := public.bin_blockers(b.id, true);
      end if;
    end if;
    ok := reason is null;
    return next;
  end loop;
end $$;

create or replace function public.apply_bin_change(p_codes text[], p_field text, p_value text, p_reason text, p_by_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_name text; v_set uuid := gen_random_uuid(); p record; n int := 0; v_refused jsonb := '[]'::jsonb;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa mengubah rak';
  end if;
  if v_reason is null then raise exception 'Alasan wajib diisi'; end if;
  v_name := public.person_name(p_by_name, 'Nama Anda');
  -- Admin only: lending racks, and anything that makes a bin not exist or exist again.
  if (p_field = 'OWNER' or p_value in ('NOT_PRESENT', 'PRESENT')) and not public.has_role(array['admin']::public.user_role[]) then
    raise exception 'Hanya admin yang bisa menandai bin tidak ada / ada lagi atau meminjamkan rak ke CKB 3PL';
  end if;
  -- Lock the bins first so the preview below sees what this change will act on.
  perform 1 from public.bins b where b.bin_code = any (select upper(trim(x)) from unnest(p_codes) x) for update;

  for p in select * from public.bin_change_preview(p_codes, p_field, p_value) loop
    if not p.ok then
      v_refused := v_refused || jsonb_build_object('bin_code', p.bin_code, 'reason', p.reason);
      continue;
    end if;
    if p_field = 'STATE' then
      update public.bins set status = case when p_value in ('ACTIVE', 'PRESENT') then 'active' else 'blocked' end::public.bin_status,
                             block_kind = case when p_value in ('ACTIVE', 'PRESENT') then null else p_value end,
                             block_reason = case when p_value in ('ACTIVE', 'PRESENT') then null else v_reason end
      where bins.bin_code = p.bin_code;
      perform public.log_bin_change(v_set, p.bin_code, 'STATE', p.state,
        case p_value when 'PRESENT' then 'ACTIVE' else p_value end, v_reason, v_name);
    else
      update public.bins set owner = p_value where bins.bin_code = p.bin_code;
      perform public.log_bin_change(v_set, p.bin_code, 'OWNER', p.owner, p_value, v_reason, v_name);
    end if;
    n := n + 1;
  end loop;
  return jsonb_build_object('change_set', case when n > 0 then v_set end, 'changed', n, 'refused', v_refused);
end $$;

create or replace function public.set_bin_attrs(p_codes text[], p_abc text, p_capacity numeric, p_reason text, p_by_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_reason text := nullif(trim(coalesce(p_reason, '')), ''); v_name text; v_set uuid := gen_random_uuid();
  b public.bins%rowtype; n int := 0; v_new_abc text;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa mengubah rak';
  end if;
  if p_abc is null and p_capacity is null then raise exception 'Pilih kelas ABC atau kapasitas yang diubah'; end if;
  if p_abc is not null and p_abc not in ('A', 'B', 'C', 'CLEAR') then raise exception 'Kelas ABC % tidak dikenal', p_abc; end if;
  if p_capacity is not null and p_capacity <= 0 then raise exception 'Kapasitas harus lebih dari 0'; end if;
  if v_reason is null then raise exception 'Alasan wajib diisi'; end if;
  v_name := public.person_name(p_by_name, 'Nama Anda');
  v_new_abc := case when p_abc = 'CLEAR' then null else p_abc end;
  for b in select * from public.bins where bin_code = any (select upper(trim(x)) from unnest(p_codes) x) for update loop
    update public.bins set abc_class = case when p_abc is null then abc_class else v_new_abc end,
                           capacity = coalesce(p_capacity, capacity)
    where id = b.id;
    perform public.log_bin_change(v_set, b.bin_code, 'ATTR',
      concat_ws(' · ', 'ABC ' || coalesce(b.abc_class, '-'), 'kapasitas ' || coalesce(b.capacity::text, '-')),
      concat_ws(' · ', 'ABC ' || coalesce(case when p_abc is null then b.abc_class else v_new_abc end, '-'),
                       'kapasitas ' || coalesce(coalesce(p_capacity, b.capacity)::text, '-')),
      v_reason, v_name);
    n := n + 1;
  end loop;
  return jsonb_build_object('change_set', case when n > 0 then v_set end, 'changed', n);
end $$;

revoke execute on function public.bin_change_preview(text[], text, text), public.apply_bin_change(text[], text, text, text, text),
  public.set_bin_attrs(text[], text, numeric, text, text) from public, anon;
grant execute on function public.bin_change_preview(text[], text, text), public.apply_bin_change(text[], text, text, text, text),
  public.set_bin_attrs(text[], text, numeric, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4  Plan, activate and cancel racks
-- ---------------------------------------------------------------------
-- New racks keep today's shape: back-to-back faces of up to 20 bays (racks 01..n and 21..20+n, rack 21
-- behind rack 01), 2 positions per bay, levels from A up. Mirrored by lib/racks.ts plannedCodes.
create or replace function public.plan_racks_preview(p_aisle text, p_bays int, p_levels text[], p_owner text)
returns table (bin_code text, rack text, level text, "position" text, "exists" boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_aisle text := upper(trim(coalesce(p_aisle, ''))); v_levels text[];
begin
  if v_aisle !~ '^C[A-Z]$' then raise exception 'Kode aisle harus seperti CI (C + satu huruf)'; end if;
  if p_bays is null or p_bays not between 1 and 20 then raise exception 'Jumlah bay per sisi harus 1-20'; end if;
  select array_agg(distinct upper(trim(l)) order by upper(trim(l))) into v_levels from unnest(p_levels) l;
  if v_levels is null or not (v_levels <@ array['A','B','C','D','E'])
     or v_levels <> (array['A','B','C','D','E'])[1:cardinality(v_levels)] then
    raise exception 'Level harus mulai dari A dan berurutan (A, A-B, ... A-E)';
  end if;
  if p_owner not in ('SHELL', 'CKB') then raise exception 'Pemilik % tidak dikenal', p_owner; end if;
  return query
    select v_aisle || to_char(r, 'FM00') || l || to_char(p, 'FM00'), to_char(r, 'FM00'), l, to_char(p, 'FM00'),
           exists (select 1 from public.bins b where b.bin_code = v_aisle || to_char(r, 'FM00') || l || to_char(p, 'FM00'))
    from (select generate_series(1, p_bays) as r union all select generate_series(21, 20 + p_bays)) rr,
         unnest(v_levels) l, generate_series(1, 2) p
    order by 2, 3, 4;
end $$;

create or replace function public.plan_racks(p_aisle text, p_bays int, p_levels text[], p_owner text, p_reason text, p_by_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_reason text := nullif(trim(coalesce(p_reason, '')), ''); v_name text; v_set uuid := gen_random_uuid();
  v_aisle text := upper(trim(coalesce(p_aisle, ''))); n_new int; n_old int;
begin
  if not public.has_role(array['admin']::public.user_role[]) then raise exception 'Hanya admin yang bisa merencanakan rak'; end if;
  if v_reason is null then raise exception 'Alasan wajib diisi'; end if;
  v_name := public.person_name(p_by_name, 'Nama Anda');
  create temp table _plan on commit drop as select * from public.plan_racks_preview(v_aisle, p_bays, p_levels, p_owner);
  select count(*) filter (where not "exists"), count(*) filter (where "exists") into n_new, n_old from _plan;
  if n_new = 0 then raise exception 'Semua % bin rak itu sudah ada', n_old; end if;

  insert into public.bins (bin_code, zone, rack, level, position, status, block_kind, block_reason, owner, capacity)
  select bin_code, v_aisle, rack, level, "position", 'blocked', 'PLANNED', v_reason, p_owner, 1 from _plan where not "exists";
  insert into public.bin_changes (change_set, bin_code, field, old_value, new_value, reason, changed_by, changed_by_name)
  select v_set, bin_code, 'CREATED', null, 'PLANNED ' || p_owner, v_reason, auth.uid(), v_name from _plan where not "exists";

  update public.settings
     set value = jsonb_set(value, '{aisle_order}', (value->'aisle_order') || to_jsonb(v_aisle)), updated_at = now()
   where key = 'layout' and not ((value->'aisle_order') ? v_aisle);
  perform public.recompute_bin_positions();
  drop table _plan;
  return jsonb_build_object('change_set', v_set, 'created', n_new, 'existing', n_old);
end $$;

create or replace function public.activate_planned(p_codes text[], p_reason text, p_by_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_reason text := nullif(trim(coalesce(p_reason, '')), ''); v_name text; v_set uuid := gen_random_uuid();
  c text; b public.bins%rowtype; n int := 0; v_refused jsonb := '[]'::jsonb;
begin
  if not public.has_role(array['admin']::public.user_role[]) then raise exception 'Hanya admin yang bisa mengaktifkan rak'; end if;
  if v_reason is null then raise exception 'Alasan wajib diisi'; end if;
  v_name := public.person_name(p_by_name, 'Nama Anda');
  for c in select distinct upper(trim(x)) from unnest(p_codes) x where trim(coalesce(x, '')) <> '' order by 1 loop
    b := null;
    select * into b from public.bins where bin_code = c for update;
    if b.id is null or b.block_kind is distinct from 'PLANNED' then
      v_refused := v_refused || jsonb_build_object('bin_code', c, 'reason',
                     case when b.id is null then 'bin tidak ditemukan' else 'bukan rak Rencana' end);
      continue;
    end if;
    update public.bins set status = 'active', block_kind = null, block_reason = null where id = b.id;
    perform public.log_bin_change(v_set, c, 'STATE', 'PLANNED', 'ACTIVE', v_reason, v_name);
    n := n + 1;
  end loop;
  return jsonb_build_object('change_set', case when n > 0 then v_set end, 'changed', n, 'refused', v_refused);
end $$;

-- A planned bin nothing ever referenced may be removed; anything else stays (bins are never deleted).
create or replace function public.cancel_planned(p_codes text[], p_reason text, p_by_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_reason text := nullif(trim(coalesce(p_reason, '')), ''); v_name text; v_set uuid := gen_random_uuid();
  c text; b public.bins%rowtype; n int := 0; v_refused jsonb := '[]'::jsonb; v_zones text[] := '{}';
  z text;
begin
  if not public.has_role(array['admin']::public.user_role[]) then raise exception 'Hanya admin yang bisa membatalkan rencana rak'; end if;
  if v_reason is null then raise exception 'Alasan wajib diisi'; end if;
  v_name := public.person_name(p_by_name, 'Nama Anda');
  for c in select distinct upper(trim(x)) from unnest(p_codes) x where trim(coalesce(x, '')) <> '' order by 1 loop
    b := null;
    select * into b from public.bins where bin_code = c for update;
    if b.id is null or b.block_kind is distinct from 'PLANNED' then
      v_refused := v_refused || jsonb_build_object('bin_code', c, 'reason',
                     case when b.id is null then 'bin tidak ditemukan' else 'bukan rak Rencana' end);
      continue;
    end if;
    begin
      delete from public.bins where id = b.id;
    exception when foreign_key_violation then
      v_refused := v_refused || jsonb_build_object('bin_code', c, 'reason', 'sudah dipakai, tidak bisa dihapus');
      continue;
    end;
    perform public.log_bin_change(v_set, c, 'REMOVED', 'PLANNED', null, v_reason, v_name);
    v_zones := array_append(v_zones, b.zone);
    n := n + 1;
  end loop;
  -- An aisle with no bins left leaves the layout.
  foreach z in array (select array_agg(distinct x) from unnest(v_zones) x) loop
    if not exists (select 1 from public.bins where zone = z) then
      update public.settings
         set value = jsonb_set(value, '{aisle_order}',
                       coalesce((select jsonb_agg(a) from jsonb_array_elements(value->'aisle_order') a where a <> to_jsonb(z)), '[]'::jsonb)),
             updated_at = now()
       where key = 'layout';
    end if;
  end loop;
  return jsonb_build_object('change_set', case when n > 0 then v_set end, 'changed', n, 'refused', v_refused);
end $$;

revoke execute on function public.plan_racks_preview(text, int, text[], text), public.plan_racks(text, int, text[], text, text, text),
  public.activate_planned(text[], text, text), public.cancel_planned(text[], text, text) from public, anon;
grant execute on function public.plan_racks_preview(text, int, text[], text), public.plan_racks(text, int, text[], text, text, text),
  public.activate_planned(text[], text, text), public.cancel_planned(text[], text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5  Read side: empty bins, bin summary, dashboard, planning stock
-- ---------------------------------------------------------------------
-- Bin kosong (0043): only bins Shell may use.
create or replace view public.empty_bins with (security_invoker = true) as
select b.bin_code, b.zone, b.rack, b.level, b.position, b.abc_class
from public.bins b
where b.rack is not null and b.status = 'active' and b.owner = 'SHELL'
  and not exists (select 1 from public.inventory i where i.bin_id = b.id and i.quantity > 0)
  and not exists (select 1 from public.open_pick_tasks t where t.to_bin_id = b.id);

-- bin_summary (0002) with state and owner appended (a replaced view keeps its column order).
create or replace view public.bin_summary with (security_invoker = true) as
select b.id, b.bin_code, b.zone, b.rack, b.level, b.position, b.status, b.capacity,
       b.pos_x, b.pos_y, b.pos_z,
       coalesce(b.abc_class, (
         select min(it.abc_class) from public.inventory i join public.items it on it.id = i.item_id where i.bin_id = b.id
       )) as abc_class,
       coalesce(sum(i.quantity), 0) as total_qty,
       case when count(i.id) = 0 then 0
            when bool_or(it.upp is null) then null
            else sum(i.quantity / nullif(it.upp, 0)) / nullif(b.capacity, 0) end as fill_ratio,
       min(i.expiry_date) as min_expiry,
       coalesce(array_agg(distinct it.sku) filter (where it.sku is not null), '{}') as skus,
       b.block_kind, b.owner, b.block_reason
from public.bins b
left join public.inventory i on i.bin_id = b.id
left join public.items it on it.id = i.item_id
group by b.id;

-- dashboard_summary (0098): occupancy over Shell's usable racks; CKB, missing and planned counted apart.
create or replace function public.dashboard_summary(
  p_today date default current_date,
  p_near_expiry_days int default 90,
  p_cal_years int default 2,
  p_risky_limit int default 25,
  p_shelf_keys text[] default array['expired','d90','d180','d365','y2','y3','more','none'],
  p_shelf_max numeric[] default array[-1,90,180,365,730,1095]::numeric[]
) returns jsonb
language sql stable security invoker set search_path = public as $$
with bins as materialized (
  select zone, rack, level, total_qty, status, block_kind, owner from public.bin_summary
), inv as materialized (
  select id, bin_code, zone, sku, description, uom, upp, item_abc, batch_lot, quantity,
         expiry_date, received_date, days_remaining
  from public.inventory_detail
),
-- ---- occupancy ------------------------------------------------------------
rack_bins as materialized (
  select zone, level, total_qty > 0 as occupied
  from bins
  -- 0132: positions Shell can use (active, owned by Shell); CKB 3PL, blocked, missing and planned are counted apart.
  where rack is not null and rack <> '' and status = 'active' and owner = 'SHELL'
),
bin_tally as (
  select count(*)::int as total,
         (count(*) filter (where total_qty > 0))::int as occupied,
         (count(*) filter (where block_kind = 'BLOCKED'))::int as blocked,  -- 0132: pillars and plans counted apart
         (count(*) filter (where owner = 'CKB'))::int as ckb,
         (count(*) filter (where block_kind = 'NOT_PRESENT'))::int as not_present,
         (count(*) filter (where block_kind = 'PLANNED'))::int as planned
  from bins
),
rack_tally as (
  select count(*)::int as total, (count(*) filter (where occupied))::int as occ from rack_bins
),
levels as (
  select l.level, l.ord from unnest(array['A','B','C','D','E']) with ordinality as l(level, ord)
),
zone_tally as (
  select zone, count(*)::int as total, (count(*) filter (where occupied))::int as occ
  from rack_bins group by zone
),
cell_tally as (
  select zone, level, count(*)::int as total, (count(*) filter (where occupied))::int as occ
  from rack_bins where level in (select level from levels) group by zone, level
),
level_tally as (
  select level, count(*)::int as total, (count(*) filter (where occupied))::int as occ
  from rack_bins where level in (select level from levels) group by level
),
-- ---- stock by ABC class ---------------------------------------------------
abc_tally as (
  select coalesce(item_abc, '–') as k, coalesce(sum(quantity), 0) as qty, count(distinct sku)::int as skus
  from inv group by 1
),
-- ---- near expiry ----------------------------------------------------------
risky_rows as materialized (
  select id, bin_code, sku, description, uom, batch_lot, quantity, expiry_date, days_remaining
  from inv where days_remaining is not null and days_remaining <= p_near_expiry_days
),
risky_tally as (
  select count(*)::int as cnt,
         coalesce(sum(quantity), 0) as qty,
         (count(*) filter (where days_remaining < 0))::int as expired_cnt,
         coalesce(sum(quantity) filter (where days_remaining < 0), 0) as expired_qty,
         (count(*) filter (where days_remaining >= 0))::int as near_cnt,
         coalesce(sum(quantity) filter (where days_remaining >= 0), 0) as near_qty,
         (count(distinct sku) filter (where days_remaining >= 0))::int as near_skus,
         min(days_remaining) filter (where days_remaining >= 0) as near_min_days
  from risky_rows
),
nodate_tally as (
  select count(*)::int as cnt, coalesce(sum(quantity), 0) as qty from inv where expiry_date is null
),
-- ---- staging (dock-to-stock stand-in) -------------------------------------
staging_tally as (
  select count(*)::int as cnt,
         coalesce(sum(quantity), 0) as qty,
         min(received_date) as oldest,
         coalesce(sum(quantity) filter (where received_date is not null and p_today - received_date <= 0), 0) as lt1,
         coalesce(sum(quantity) filter (where received_date is not null and p_today - received_date between 1 and 2), 0) as d12,
         coalesce(sum(quantity) filter (where received_date is not null and p_today - received_date > 2), 0) as d3p
  from inv where zone = 'STAGING'
),
-- ---- shelf life: every stock row in its horizon bucket ---------------------
shelf_bucket as (
  select v.quantity, v.sku,
    case
      when v.days_remaining is null then p_shelf_keys[array_length(p_shelf_keys, 1)]
      else coalesce(
        (select p_shelf_keys[k.i]
           from generate_subscripts(p_shelf_max, 1) as k(i)
          where v.days_remaining <= p_shelf_max[k.i]
          order by k.i limit 1),
        p_shelf_keys[greatest(array_length(p_shelf_keys, 1) - 1, 1)])
    end as key
  from inv v
),
shelf_tally as (
  select key, count(*)::int as cnt, coalesce(sum(quantity), 0) as qty, count(distinct sku)::int as skus
  from shelf_bucket group by key
),
-- ---- expiry calendar -------------------------------------------------------
cal_tagged as (
  select v.quantity, v.sku, v.expiry_date,
    case when p_cal_years > 2
      then to_char(date_trunc('quarter', v.expiry_date::timestamp), 'YYYY-"Q"Q')
      else to_char(v.expiry_date, 'YYYY-MM') end as ym
  from inv v where v.expiry_date is not null
),
cal_buckets as (
  select g.i as ord,
    case when p_cal_years > 2
      then to_char(date_trunc('quarter', p_today::timestamp) + make_interval(months => g.i * 3), 'YYYY-"Q"Q')
      else to_char(date_trunc('month', p_today::timestamp) + make_interval(months => g.i), 'YYYY-MM') end as ym
  from generate_series(0, case when p_cal_years > 2 then p_cal_years * 4 else p_cal_years * 12 end - 1) as g(i)
),
cal_tally as (
  select b.ym, b.ord, coalesce(sum(t.quantity), 0) as qty, count(distinct t.sku)::int as skus
  from cal_buckets b left join cal_tagged t on t.ym = b.ym
  group by b.ym, b.ord
),
expired_tally as (
  select coalesce(sum(quantity), 0) as qty from cal_tagged where expiry_date < p_today
),
later_tally as (
  select coalesce(sum(t.quantity), 0) as qty
  from cal_tagged t
  where t.expiry_date >= p_today
    and not exists (select 1 from cal_buckets b where b.ym = t.ym)
),
-- ---- top SKUs by stock -----------------------------------------------------
sku_tally as (
  select v.sku,
         (array_agg(v.description order by v.id))[1] as description,
         (array_agg(v.uom order by v.id))[1] as uom,
         sum(v.quantity) as qty,
         sum(case when v.upp is not null and v.upp <> 0 then v.quantity / v.upp else 0 end) as pallets,
         count(distinct v.bin_code)::int as bins,
         (array_agg(v.id order by v.id))[1] as first_id
  from inv v group by v.sku
),
top_skus as (
  select * from sku_tally order by qty desc, first_id limit 10
)
select jsonb_build_object(
  'bins', jsonb_build_object(
    'total', b.total, 'occupied', b.occupied, 'blocked', b.blocked,
    'ckb', b.ckb, 'not_present', b.not_present, 'planned', b.planned,
    'rack_total', rb.total, 'rack_occupied', rb.occ),
  'planned', (
    select coalesce(jsonb_agg(jsonb_build_object('zone', p.zone, 'owner', p.owner, 'positions', p.n) order by p.zone collate "C", p.owner), '[]'::jsonb)
    from (select zone, owner, count(*)::int as n from bins where block_kind = 'PLANNED' group by zone, owner) p),
  'levels', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'level', l.level, 'total', coalesce(t.total, 0), 'occ', coalesce(t.occ, 0)) order by l.ord), '[]'::jsonb)
    from levels l left join level_tally t on t.level = l.level),
  'zones', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'zone', z.zone, 'total', z.total, 'occ', z.occ,
             'cells', (
               select coalesce(jsonb_agg(jsonb_build_object(
                        'level', l.level, 'total', coalesce(c.total, 0), 'occ', coalesce(c.occ, 0)) order by l.ord), '[]'::jsonb)
               from levels l left join cell_tally c on c.zone = z.zone and c.level = l.level)) order by z.zone collate "C"), '[]'::jsonb)
    from zone_tally z),
  'abc', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'k', k.k, 'qty', coalesce(t.qty, 0), 'skus', coalesce(t.skus, 0)) order by k.ord), '[]'::jsonb)
    from (select a.k, a.ord from unnest(array['A','B','C','–']) with ordinality as a(k, ord)) k
    left join abc_tally t on t.k = k.k),
  'stock', jsonb_build_object('no_date_rows', n.cnt, 'no_date_qty', n.qty),
  'risky', jsonb_build_object(
    'count', r.cnt, 'qty', r.qty,
    'expired_count', r.expired_cnt, 'expired_qty', r.expired_qty,
    'near_count', r.near_cnt, 'near_qty', r.near_qty,
    'near_skus', r.near_skus, 'near_min_days', r.near_min_days,
    'rows', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'bin_code', x.bin_code, 'sku', x.sku, 'description', x.description, 'uom', x.uom,
               'batch_lot', x.batch_lot, 'quantity', x.quantity, 'expiry_date', x.expiry_date,
               'days_remaining', x.days_remaining) order by x.days_remaining, x.id), '[]'::jsonb)
      from (select * from risky_rows order by days_remaining, id limit greatest(p_risky_limit, 0)) x)),
  'staging', jsonb_build_object(
    'rows', s.cnt, 'qty', s.qty, 'oldest_received_date', s.oldest,
    'aging', jsonb_build_object('lt1', s.lt1, 'd1_2', s.d12, 'd3p', s.d3p)),
  'shelf', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'key', k.key, 'qty', coalesce(t.qty, 0), 'rows', coalesce(t.cnt, 0), 'skus', coalesce(t.skus, 0)) order by k.ord), '[]'::jsonb)
    from unnest(p_shelf_keys) with ordinality as k(key, ord)
    left join shelf_tally t on t.key = k.key),
  'expiry', jsonb_build_object(
    'expired_qty', e.qty, 'later_qty', l.qty,
    'buckets', (
      select coalesce(jsonb_agg(jsonb_build_object('ym', cb.ym, 'qty', cb.qty, 'skus', cb.skus) order by cb.ord), '[]'::jsonb)
      from cal_tally cb)),
  'top_skus', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'sku', t.sku, 'description', t.description, 'uom', t.uom,
             'qty', t.qty, 'pallets', t.pallets, 'bins', t.bins) order by t.qty desc, t.first_id), '[]'::jsonb)
    from top_skus t)
)
from bin_tally b, rack_tally rb, risky_tally r, nodate_tally n, staging_tally s,
     expired_tally e, later_tally l
$$;

-- planning_stock (0044): the allocator's BIN_NOT_ACTIVE exclusion now drops CKB, missing and planned bins.
create or replace function public.planning_stock(p_date date, p_release uuid[] default '{}', p_keep_all boolean default false)
returns table (
  bin_code text, bin_status public.bin_status, sku text, description text, uom text, upp numeric,
  batch_lot text, quantity numeric, expiry_date date, received_date date,
  physical numeric, reserved numeric, incoming numeric, held numeric
) language sql stable security invoker set search_path = public as $$
  with keep_tasks as (
    select * from public.open_pick_tasks
    -- p_keep_all: an order added to a day keeps every reservation, also of the day's untouched waves.
    where (p_keep_all or wave_id not in (select public.replaceable_waves(p_date)))
      and wave_id <> all(coalesce(p_release, '{}'))
  ), deltas as (
    select bin_id, item_id, batch_lot, expiry_date, quantity as phys, 0::numeric as res, 0::numeric as inc, received_date
      from public.inventory
    union all
    select from_bin_id, item_id, batch_lot, expiry_date, 0, quantity, 0, null from keep_tasks
    union all
    select to_bin_id, item_id, batch_lot, expiry_date, 0, 0, quantity, null from keep_tasks where to_bin_id is not null
  ), agg as (
    select bin_id, item_id, batch_lot, expiry_date,
           sum(phys) as physical, sum(res) as reserved, sum(inc) as incoming, max(received_date) as received_date
    from deltas group by bin_id, item_id, batch_lot, expiry_date
  ), held as (
    select a.*, public.held_qty(a.bin_id, a.item_id, a.batch_lot, a.expiry_date, a.physical) as held from agg a
  )
  -- 0132: bin_status is Shell's view: 'active' only for a bin Shell may use (not CKB 3PL, not missing or planned).
  select b.bin_code, case when public.bin_usable(b.id) then 'active' else 'blocked' end::public.bin_status, it.sku, it.description, it.uom, it.upp,
         h.batch_lot, greatest(h.physical - h.held - h.reserved + h.incoming, 0), h.expiry_date, h.received_date,
         h.physical, h.reserved, h.incoming, h.held
  from held h
  join public.bins b on b.id = h.bin_id
  join public.items it on it.id = h.item_id
  where h.physical - h.held - h.reserved + h.incoming > 0 or h.physical > 0
  order by b.bin_code, it.sku, h.batch_lot, h.expiry_date;
$$;

-- inventory_detail (0017) with the bin's owner and kind appended, so the Wave page's fix proposals can
-- tell a Shell rack from a CKB 3PL one (lib/racks.ts usableForShell).
create or replace view public.inventory_detail with (security_invoker = true) as
select i.id, i.bin_id, b.bin_code, b.zone, b.rack, b.level, b.position,
       it.id as item_id, it.sku, it.description, it.uom, it.upp, it.abc_class as item_abc,
       i.batch_lot, i.quantity, i.expiry_date, i.received_date,
       (i.expiry_date - current_date) as days_remaining,
       b.status as bin_status,
       public.held_qty(i.bin_id, i.item_id, i.batch_lot, i.expiry_date, i.quantity) as held,
       public.hold_reasons(i.bin_id, i.item_id, i.batch_lot, i.expiry_date) as hold_reasons,
       b.owner as bin_owner, b.block_kind as bin_kind
from public.inventory i
join public.bins b on b.id = i.bin_id
join public.items it on it.id = i.item_id;

-- Live updates for Rak & Lokasi (same guard as 0015: plain Postgres has no publication).
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication not found; skipping';
    return;
  end if;
  foreach t in array array['bins', 'bin_changes'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
