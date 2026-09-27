-- =====================================================================
-- 0018  Adjustment control: reason codes, names, four-eyes approval
--
--  movements  + reason_code (why stock changed, from a fixed list, so
--               root causes can be counted), by_name (who did it, as
--               typed on the floor), approved_by_name, ref_id.
--  Every adjustment by a user needs a reason code, a note and a name.
--  An adjustment larger than inventory_policy.adjust_approval_qty is
--  refused unless it comes through an approval: adjustment_requests
--  (decided by a different person), a confirmed count (0019) or a
--  function that only moves an identity (net zero).
--
--  Functions set, for their own transaction:
--    app.adjust_reason   default reason_code for adjustments they post
--    app.by_name         default by_name
--    app.adjust_approved 'on' = the size check was done by the function
-- =====================================================================

alter table public.movements
  add column if not exists reason_code text check (reason_code in (
    'COUNT_VARIANCE', 'DAMAGED', 'EXPIRED', 'DATA_ENTRY', 'MISPICK', 'FOUND', 'LOST',
    'RECEIVING_DIFF', 'RETURN', 'OPENING', 'OTHER')),
  add column if not exists by_name text,
  add column if not exists approved_by_name text,
  add column if not exists ref_id uuid;
create index if not exists movements_reason_idx on public.movements (reason_code, created_at desc) where reason_code is not null;

create or replace function public.guard_adjustment_policy()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_limit numeric;
begin
  new.reason_code := coalesce(new.reason_code, nullif(current_setting('app.adjust_reason', true), ''));
  new.by_name := coalesce(nullif(trim(new.by_name), ''), nullif(current_setting('app.by_name', true), ''));
  if new.type <> 'adjustment' or auth.uid() is null then return new; end if;

  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Only supervisors or admins can post adjustments';
  end if;
  if new.reason_code is null then raise exception 'Kode alasan adjustment wajib dipilih'; end if;
  if nullif(trim(new.note), '') is null then raise exception 'Keterangan adjustment wajib diisi'; end if;
  if new.by_name is null then raise exception 'Nama petugas wajib diisi untuk adjustment'; end if;
  new.by_name := public.person_name(new.by_name);

  v_limit := (public.inventory_policy()->>'adjust_approval_qty')::numeric;
  if abs(new.quantity) > v_limit and coalesce(current_setting('app.adjust_approved', true), '') <> 'on' then
    raise exception 'Adjustment % unit melebihi batas % unit: ajukan persetujuan (Inventory → Persetujuan), disetujui orang lain.',
      abs(new.quantity), v_limit;
  end if;
  return new;
end $$;

create trigger movements_a_adjust_policy before insert on public.movements
  for each row execute function public.guard_adjustment_policy();
revoke execute on function public.guard_adjustment_policy() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Adjustment requests (above the limit): one person asks, another decides.
-- ---------------------------------------------------------------------
create table public.adjustment_requests (
  id                uuid primary key default gen_random_uuid(),
  bin_id            uuid not null references public.bins(id),
  item_id           uuid not null references public.items(id),
  batch_lot         text not null default '',
  expiry_date       date,
  quantity          numeric not null check (quantity <> 0),
  reason_code       text not null,
  note              text not null,
  status            text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  requested_by      uuid references public.profiles(id),
  requested_by_name text not null,
  requested_at      timestamptz not null default now(),
  decided_by        uuid references public.profiles(id),
  decided_by_name   text,
  decided_at        timestamptz,
  decision_note     text,
  movement_id       uuid references public.movements(id)
);
create index adjustment_requests_status_idx on public.adjustment_requests (status, requested_at desc);
alter table public.adjustment_requests enable row level security;
create policy "adjustment_requests: read" on public.adjustment_requests for select to authenticated using (true);

create or replace function public.request_adjustment(
  p_bin_code text, p_sku text, p_batch text, p_expiry date, p_qty numeric,
  p_reason_code text, p_note text, p_by_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_name text := public.person_name(p_by_name); v_bin uuid; v_item uuid; v_cur numeric; v_id uuid;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa mengajukan adjustment';
  end if;
  if p_qty is null or p_qty = 0 then raise exception 'Jumlah adjustment tidak boleh 0'; end if;
  if p_reason_code is null then raise exception 'Kode alasan wajib dipilih'; end if;
  if nullif(trim(p_note), '') is null then raise exception 'Keterangan wajib diisi'; end if;
  select id into v_bin from public.bins where bin_code = upper(trim(p_bin_code));
  if v_bin is null then raise exception 'Bin % tidak ada', p_bin_code; end if;
  select id into v_item from public.items where sku = trim(p_sku);
  if v_item is null then raise exception 'SKU % tidak ada di master item', p_sku; end if;
  select quantity into v_cur from public.inventory
  where bin_id = v_bin and item_id = v_item and batch_lot = coalesce(p_batch, '') and expiry_date is not distinct from p_expiry;
  if p_qty < 0 and coalesce(v_cur, 0) + p_qty < 0 then
    raise exception 'Stok tinggal %, tidak bisa dikurangi %', coalesce(v_cur, 0), -p_qty;
  end if;
  if v_cur is null and p_expiry is null then raise exception 'Tanggal expired wajib untuk stok baru (FEFO)'; end if;
  insert into public.adjustment_requests (bin_id, item_id, batch_lot, expiry_date, quantity, reason_code, note, requested_by, requested_by_name)
  values (v_bin, v_item, coalesce(p_batch, ''), p_expiry, p_qty, p_reason_code, trim(p_note), auth.uid(), v_name)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.decide_adjustment(p_id uuid, p_approve boolean, p_note text, p_by_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text := public.person_name(p_by_name, 'Nama penyetuju'); r public.adjustment_requests%rowtype; v_mov uuid;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa memutuskan adjustment';
  end if;
  select * into r from public.adjustment_requests where id = p_id for update;
  if r.id is null or r.status <> 'PENDING' then raise exception 'Permintaan tidak ada atau sudah diputuskan'; end if;
  if public.same_person(v_name, r.requested_by_name) then
    raise exception 'Yang menyetujui harus orang lain dari yang mengajukan (%)', r.requested_by_name;
  end if;
  if not p_approve then
    if nullif(trim(p_note), '') is null then raise exception 'Alasan penolakan wajib diisi'; end if;
    update public.adjustment_requests set status = 'REJECTED', decided_by = auth.uid(), decided_by_name = v_name,
      decided_at = now(), decision_note = trim(p_note) where id = p_id;
    return jsonb_build_object('status', 'REJECTED');
  end if;

  perform set_config('app.adjust_approved', 'on', true);
  insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note, reason_code, by_name, approved_by_name, ref_id)
  values ('adjustment', r.item_id, r.batch_lot, r.quantity, r.bin_id, r.expiry_date,
          r.note || coalesce(' · disetujui: ' || nullif(trim(p_note), ''), ''), r.reason_code, r.requested_by_name, v_name, r.id)
  returning id into v_mov;
  perform set_config('app.adjust_approved', '', true);
  update public.adjustment_requests set status = 'APPROVED', decided_by = auth.uid(), decided_by_name = v_name,
    decided_at = now(), decision_note = nullif(trim(p_note), ''), movement_id = v_mov where id = p_id;
  return jsonb_build_object('status', 'APPROVED', 'movement_id', v_mov);
end $$;

create or replace view public.adjustment_request_detail with (security_invoker = true) as
select r.id, b.bin_code, it.sku, it.description, it.uom, r.batch_lot, r.expiry_date, r.quantity, r.reason_code, r.note,
       r.status, r.requested_by_name, r.requested_at, r.decided_by_name, r.decided_at, r.decision_note, r.movement_id,
       (select i.quantity from public.inventory i where i.bin_id = r.bin_id and i.item_id = r.item_id
          and i.batch_lot = r.batch_lot and i.expiry_date is not distinct from r.expiry_date) as current_qty
from public.adjustment_requests r
join public.bins b on b.id = r.bin_id
join public.items it on it.id = r.item_id;

-- ---------------------------------------------------------------------
-- Corrections (0011, 0013) with reason code, name, approval and holds.
-- ---------------------------------------------------------------------
drop function public.correct_stock_identity(text, text, text, date, text, date, text);
create function public.correct_stock_identity(
  p_bin_code text, p_sku text, p_batch text, p_expiry date,
  p_new_batch text, p_new_expiry date, p_reason text, p_by_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text := public.person_name(p_by_name); v_bin uuid; v_item uuid; src public.inventory%rowtype;
  v_new_batch text; v_new_exp date; v_waves text; v_note text;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa mengoreksi stok';
  end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Alasan wajib diisi'; end if;

  select id into v_bin from public.bins where bin_code = p_bin_code;
  select id into v_item from public.items where sku = p_sku;
  select * into src from public.inventory
  where bin_id = v_bin and item_id = v_item and batch_lot = coalesce(p_batch, '') and expiry_date is not distinct from p_expiry
  for update;
  if src.id is null then raise exception 'Stok % / % / batch % tidak ditemukan (mungkin sudah berubah)', p_bin_code, p_sku, p_batch; end if;

  v_new_batch := trim(coalesce(p_new_batch, src.batch_lot));
  v_new_exp := coalesce(p_new_expiry, src.expiry_date);
  if v_new_batch = src.batch_lot and v_new_exp is not distinct from src.expiry_date then
    raise exception 'Tidak ada yang berubah';
  end if;

  select string_agg(distinct w.wave_no || ' (' || w.planned_date || ')', ', ') into v_waves
  from public.open_pick_tasks t join public.waves w on w.id = t.wave_id
  where t.from_bin_id = v_bin and t.item_id = v_item and t.batch_lot = src.batch_lot
    and t.expiry_date is not distinct from src.expiry_date;
  if v_waves is not null then
    raise exception 'Stok ini dipakai tugas wave %. Selesaikan atau hitung ulang wave dulu.', v_waves;
  end if;

  -- Same cartons, corrected label data: net zero, holds move with them.
  perform set_config('app.adjust_approved', 'on', true);
  perform set_config('app.hold_carry', 'on', true);
  v_note := 'KOREKSI ' || p_bin_code || ': ' || trim(p_reason);
  insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, received_date, note, reason_code, by_name)
  values ('adjustment', v_item, src.batch_lot, -src.quantity, v_bin, src.expiry_date, src.received_date, v_note || ' (identitas lama)', 'DATA_ENTRY', v_name);
  insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, received_date, note, reason_code, by_name)
  values ('adjustment', v_item, v_new_batch, src.quantity, v_bin, v_new_exp, src.received_date, v_note || ' (identitas baru)', 'DATA_ENTRY', v_name);
  update public.stock_holds set batch_lot = v_new_batch, expiry_date = v_new_exp
  where status = 'ACTIVE' and scope = 'LINE' and bin_id = v_bin and item_id = v_item and batch_lot = src.batch_lot
    and expiry_date is not distinct from src.expiry_date;
  perform set_config('app.hold_carry', '', true);
  perform set_config('app.adjust_approved', '', true);

  return jsonb_build_object('quantity', src.quantity, 'batch_lot', v_new_batch, 'expiry_date', v_new_exp);
end $$;

drop function public.replace_stock_item(text, text, text, date, text, text, date, numeric, text);
create function public.replace_stock_item(
  p_bin_code text, p_sku text, p_batch text, p_expiry date,
  p_new_sku text, p_new_batch text, p_new_expiry date, p_new_qty numeric,
  p_reason_code text, p_reason text, p_by_name text, p_approver_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text := public.person_name(p_by_name); v_bin uuid; v_item uuid; v_new_item uuid; src public.inventory%rowtype;
  v_new_batch text := trim(coalesce(p_new_batch, '')); v_qty numeric; v_waves text; v_note text; v_approver text;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa mengganti item';
  end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Alasan wajib diisi'; end if;
  if p_reason_code is null then raise exception 'Kode alasan wajib dipilih'; end if;
  if p_new_expiry is null then raise exception 'Tanggal expired item yang benar wajib diisi (FEFO)'; end if;

  select id into v_bin from public.bins where bin_code = upper(trim(p_bin_code));
  select id into v_item from public.items where sku = p_sku;
  select * into src from public.inventory
  where bin_id = v_bin and item_id = v_item and batch_lot = coalesce(p_batch, '') and expiry_date is not distinct from p_expiry
  for update;
  if src.id is null then raise exception 'Stok % / % / batch % tidak ditemukan (mungkin sudah berubah)', p_bin_code, p_sku, p_batch; end if;

  select id into v_new_item from public.items where sku = trim(p_new_sku);
  if v_new_item is null then raise exception 'SKU % tidak ada di master item', p_new_sku; end if;
  v_qty := coalesce(p_new_qty, src.quantity);
  if v_qty <= 0 then raise exception 'Jumlah item yang benar harus lebih dari 0'; end if;
  if v_new_item = src.item_id and v_new_batch = src.batch_lot and p_new_expiry is not distinct from src.expiry_date and v_qty = src.quantity then
    raise exception 'Tidak ada yang berubah';
  end if;

  -- Two stock records change: above the limit a second person signs.
  if greatest(src.quantity, v_qty) > (public.inventory_policy()->>'adjust_approval_qty')::numeric then
    v_approver := public.person_name(p_approver_name, 'Nama penyetuju (di atas batas adjustment)');
    if public.same_person(v_approver, v_name) then raise exception 'Penyetuju harus orang lain dari petugas'; end if;
  end if;

  select string_agg(distinct w.wave_no || ' (' || w.planned_date || ')', ', ') into v_waves
  from public.open_pick_tasks t join public.waves w on w.id = t.wave_id
  where t.from_bin_id = v_bin and t.item_id = src.item_id and t.batch_lot = src.batch_lot
    and t.expiry_date is not distinct from src.expiry_date;
  if v_waves is not null then
    raise exception 'Stok ini dipakai tugas wave %. Selesaikan atau hitung ulang wave dulu.', v_waves;
  end if;

  perform set_config('app.adjust_approved', 'on', true);
  perform set_config('app.hold_carry', 'on', true);
  v_note := 'GANTI ITEM ' || upper(trim(p_bin_code)) || ': ' || trim(p_reason);
  insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, received_date, note, reason_code, by_name, approved_by_name)
  values ('adjustment', src.item_id, src.batch_lot, -src.quantity, v_bin, src.expiry_date, src.received_date, v_note || ' (item lama)', p_reason_code, v_name, v_approver);
  insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, received_date, note, reason_code, by_name, approved_by_name)
  values ('adjustment', v_new_item, v_new_batch, v_qty, v_bin, p_new_expiry, src.received_date, v_note || ' (item benar)', p_reason_code, v_name, v_approver);
  -- A hold on the wrong record follows the stock to its right record.
  update public.stock_holds set item_id = v_new_item, batch_lot = v_new_batch, expiry_date = p_new_expiry
  where status = 'ACTIVE' and scope = 'LINE' and bin_id = v_bin and item_id = src.item_id and batch_lot = src.batch_lot
    and expiry_date is not distinct from src.expiry_date;
  perform set_config('app.hold_carry', '', true);
  perform set_config('app.adjust_approved', '', true);

  return jsonb_build_object('old_sku', p_sku, 'old_qty', src.quantity, 'new_sku', trim(p_new_sku), 'new_qty', v_qty);
end $$;

drop function public.swap_bin_contents(text, text, text);
create function public.swap_bin_contents(p_bin_a text, p_bin_b text, p_reason text, p_by_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text := public.person_name(p_by_name); a public.bins%rowtype; b public.bins%rowtype; r record; v_waves text; v_note text;
  n_ab int := 0; n_ba int := 0;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa menukar isi bin';
  end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Alasan wajib diisi'; end if;

  select * into a from public.bins where bin_code = upper(trim(p_bin_a));
  select * into b from public.bins where bin_code = upper(trim(p_bin_b));
  if a.id is null then raise exception 'Bin % tidak ditemukan', p_bin_a; end if;
  if b.id is null then raise exception 'Bin % tidak ditemukan', p_bin_b; end if;
  if a.id = b.id then raise exception 'Pilih dua bin yang berbeda'; end if;
  if a.status = 'blocked' or b.status = 'blocked' then
    raise exception 'Bin % diblokir: buka blokir dulu', case when a.status = 'blocked' then a.bin_code else b.bin_code end;
  end if;

  select string_agg(distinct w.wave_no || ' (' || w.planned_date || ')', ', ') into v_waves
  from public.open_pick_tasks t join public.waves w on w.id = t.wave_id
  where t.from_bin_id in (a.id, b.id) or t.to_bin_id in (a.id, b.id);
  if v_waves is not null then
    raise exception 'Bin ini dipakai tugas wave %. Selesaikan atau hitung ulang wave dulu.', v_waves;
  end if;

  perform 1 from public.inventory where bin_id in (a.id, b.id) for update;
  drop table if exists _swap;
  create temp table _swap on commit drop as
    select i.bin_id, i.item_id, i.batch_lot, i.quantity, i.expiry_date, i.received_date
    from public.inventory i where i.bin_id in (a.id, b.id);
  if not exists (select 1 from _swap) then raise exception 'Kedua bin kosong: tidak ada yang ditukar'; end if;

  perform set_config('app.hold_carry', 'on', true);
  v_note := 'TUKAR ' || a.bin_code || ' <-> ' || b.bin_code || ': ' || trim(p_reason);
  for r in select * from _swap where bin_id = a.id loop
    insert into public.movements (type, item_id, batch_lot, quantity, from_bin_id, to_bin_id, expiry_date, received_date, note, reason_code, by_name)
    values ('transfer', r.item_id, r.batch_lot, r.quantity, a.id, b.id, r.expiry_date, r.received_date, v_note, 'DATA_ENTRY', v_name);
    n_ab := n_ab + 1;
  end loop;
  for r in select * from _swap where bin_id = b.id loop
    insert into public.movements (type, item_id, batch_lot, quantity, from_bin_id, to_bin_id, expiry_date, received_date, note, reason_code, by_name)
    values ('transfer', r.item_id, r.batch_lot, r.quantity, b.id, a.id, r.expiry_date, r.received_date, v_note, 'DATA_ENTRY', v_name);
    n_ba := n_ba + 1;
  end loop;
  -- Holds follow the cartons to the other bin.
  update public.stock_holds set bin_id = case when bin_id = a.id then b.id else a.id end
  where status = 'ACTIVE' and scope = 'LINE' and bin_id in (a.id, b.id);
  perform set_config('app.hold_carry', '', true);

  return jsonb_build_object('moved_a_to_b', n_ab, 'moved_b_to_a', n_ba);
end $$;

grant select on public.adjustment_requests, public.adjustment_request_detail to authenticated;
grant all on public.adjustment_requests to service_role;
revoke execute on function public.request_adjustment(text, text, text, date, numeric, text, text, text),
  public.decide_adjustment(uuid, boolean, text, text),
  public.correct_stock_identity(text, text, text, date, text, date, text, text),
  public.replace_stock_item(text, text, text, date, text, text, date, numeric, text, text, text, text),
  public.swap_bin_contents(text, text, text, text) from public, anon;
grant execute on function public.request_adjustment(text, text, text, date, numeric, text, text, text),
  public.decide_adjustment(uuid, boolean, text, text),
  public.correct_stock_identity(text, text, text, date, text, date, text, text),
  public.replace_stock_item(text, text, text, date, text, text, date, numeric, text, text, text, text),
  public.swap_bin_contents(text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Snapshot import (0004) and putaway import (0010): generated below.
-- ---------------------------------------------------------------------

create or replace function public.import_snapshot(rows jsonb, full_sync boolean, source_name text, keep_bins text[] default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; v_bin uuid; v_item uuid; v_cur numeric; v_diff numeric; v_exp date; v_batch text;
  n_bins int := 0; n_items int := 0; n_moves int := 0; inv record;
  v_note text := 'IMPORT ' || coalesce(source_name, 'file');
begin
  if not public.has_role(array['admin']::public.user_role[]) then
    raise exception 'Only admins can import';
  end if;
  -- Opening balances: the file is the approval; reason OPENING, by the import.
  perform set_config('app.adjust_approved', 'on', true);
  perform set_config('app.adjust_reason', 'OPENING', true);
  perform set_config('app.by_name', 'impor ' || coalesce(source_name, 'file'), true);

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
  -- except in bins whose rows were rejected by validation (keep_bins).
  if full_sync then
    for inv in select i.* from public.inventory i
      join public.bins b on b.id = i.bin_id
      where b.bin_code <> all(keep_bins)  -- bins with rejected rows keep their stock
        and not exists (select 1 from _seen s where s.bin_id = i.bin_id and s.item_id = i.item_id
                          and s.batch_lot = i.batch_lot and s.expiry_date is not distinct from i.expiry_date)
    loop
      insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
      values ('adjustment', inv.item_id, inv.batch_lot, -inv.quantity, inv.bin_id, inv.expiry_date,
              v_note || ' (not in file)');
      n_moves := n_moves + 1;
    end loop;
  end if;

  perform set_config('app.adjust_approved', '', true);
  perform set_config('app.adjust_reason', '', true);
  perform set_config('app.by_name', '', true);
  return jsonb_build_object('rows', n_bins, 'item_rows', n_items, 'movements', n_moves);
end $$;

create or replace function public.putaway_import(p_rows jsonb, p_source text, p_apply boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; v_bin public.bins%rowtype; v_item uuid; v_batch text; v_exp date; v_qty numeric;
  v_action text; v_status text; v_kind text; v_current jsonb; v_match numeric; v_others int;
  v_note text; t record; out jsonb := '[]'::jsonb; n_moves int := 0; n_counts int := 0;
  v_limit numeric := (public.inventory_policy()->>'adjust_approval_qty')::numeric; v_over jsonb := '[]'::jsonb; v_expected date;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa import putaway';
  end if;
  perform set_config('app.adjust_reason', 'RECEIVING_DIFF', true);
  perform set_config('app.by_name', 'putaway ' || coalesce(p_source, 'file'), true);

  drop table if exists _putaway;
  create temp table _putaway (line int, bin_id uuid, item_id uuid, batch_lot text, expiry_date date,
    quantity numeric, current_qty numeric, status text, action text) on commit drop;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_batch := coalesce(r->>'batch_lot', '');
    v_exp := (r->>'expiry_date')::date;
    v_qty := (r->>'quantity')::numeric;
    v_action := r->>'action';               -- null | 'add' | 'set'
    v_kind := null; v_current := '[]'::jsonb; v_item := null;

    select * into v_bin from public.bins where bin_code = r->>'bin_code';
    select id into v_item from public.items where sku = r->>'sku';

    if v_bin.id is null then v_kind := 'bin_unknown';
    elsif v_bin.status = 'blocked' then v_kind := 'bin_blocked';
    elsif v_item is null then v_kind := 'sku_unknown';
    else
      select coalesce(jsonb_agg(jsonb_build_object('sku', it.sku, 'batch_lot', i.batch_lot,
               'expiry_date', i.expiry_date, 'quantity', i.quantity) order by it.sku, i.batch_lot), '[]'::jsonb),
             max(i.quantity) filter (where i.item_id = v_item and i.batch_lot = v_batch
                                       and i.expiry_date is not distinct from v_exp),
             count(*) filter (where not (i.item_id = v_item and i.batch_lot = v_batch
                                           and i.expiry_date is not distinct from v_exp))
        into v_current, v_match, v_others
      from public.inventory i join public.items it on it.id = i.item_id
      where i.bin_id = v_bin.id;

      if v_match is not null and v_match <> v_qty then v_kind := 'qty_differs';
      elsif v_match is null and v_others > 0 then v_kind := 'bin_occupied';
      end if;
    end if;

    v_status := case when v_kind is not null then 'conflict'
                     when v_match is not null then 'same' else 'new' end;

    -- A resolution only counts where it makes sense for that conflict.
    if v_status <> 'conflict' or not (
         (v_kind = 'qty_differs' and v_action in ('add', 'set')) or
         (v_kind = 'bin_occupied' and v_action = 'add')) then
      v_action := null;
    end if;

    if v_action = 'set' and abs(v_qty - v_match) > v_limit then
      -- Above the adjustment limit a sheet cannot overwrite stock: it becomes a count task.
      v_over := v_over || to_jsonb((r->>'line')::int);
      v_action := null;
    end if;
    insert into _putaway values ((r->>'line')::int, v_bin.id, v_item, v_batch, v_exp, v_qty, v_match, v_status, v_action);
    -- A date-coded batch whose expiry disagrees with the batch code (warning only).
    v_expected := case when v_item is not null then public.batch_expected_expiry(v_item, v_batch) end;
    out := out || jsonb_build_object('line', (r->>'line')::int, 'status', v_status, 'kind', v_kind,
                                     'action', v_action, 'current', v_current,
                                     'expiry_expected', case when v_expected is distinct from v_exp then v_expected end);
  end loop;

  if p_apply then
    perform set_config('app.adjust_approved', 'on', true);  -- 'set' rows are within the limit (checked above)
    for t in select * from _putaway where status = 'new' or action is not null order by line loop
      v_note := 'PUTAWAY ' || coalesce(p_source, 'file') || ' baris ' || t.line;
      if t.action = 'set' then
        insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
        values ('adjustment', t.item_id, t.batch_lot, t.quantity - t.current_qty, t.bin_id, t.expiry_date, v_note || ' (disamakan)');
      else
        insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
        values ('putaway', t.item_id, t.batch_lot, t.quantity, t.bin_id, t.expiry_date,
                v_note || case when t.action = 'add' then ' (ditambahkan)' else '' end);
      end if;
      n_moves := n_moves + 1;
    end loop;

    perform set_config('app.adjust_approved', '', true);
    -- Unresolved "the sheet and the system disagree about this bin" rows become
    -- count tasks. One open task per bin; later sheet lines are appended to it.
    for t in select p.*, it.sku from _putaway p join public.items it on it.id = p.item_id
             where p.status = 'conflict' and p.action is null and p.bin_id is not null order by p.line loop
      insert into public.count_tasks (bin_id, reason, source, expected, created_by)
      values (t.bin_id, 'Putaway: isi sheet berbeda dengan sistem', 'PUTAWAY',
              jsonb_build_array(jsonb_build_object('source', p_source, 'line', t.line, 'sku', t.sku,
                'batch_lot', t.batch_lot, 'expiry_date', t.expiry_date, 'quantity', t.quantity)), auth.uid())
      on conflict (bin_id) where status in ('OPEN', 'COUNTED', 'RECOUNT')
      do update set expected = public.count_tasks.expected || excluded.expected;
      n_counts := n_counts + 1;
    end loop;
  end if;

  return jsonb_build_object('rows', out, 'movements', n_moves, 'count_tasks', n_counts, 'set_over_limit', v_over);
end $$;
