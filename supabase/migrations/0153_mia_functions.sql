-- =====================================================================
-- 0153  MIA: moving stock into and out of the MIA location
--
-- 0152 made the bin MIA and refused every movement into or out of it. This
-- migration is the only way in and out, four functions:
--
--   mia_move_in  rack -> MIA   stock the system holds but the floor cannot show (Bin To Bin, total of WMS drops)
--   mia_book     nothing -> MIA   stock SAP expects that nobody has found (adjustment +, WMS total unchanged: MIA
--                                 is not part of our side of the SAP comparison)
--   mia_find     MIA -> rack   found: the stock is back on a shelf (Bin To Bin, total of WMS rises)
--   mia_clear    MIA -> nothing   written off, after Shell posted it in SAP (adjustment -)
--
-- Who: the jobs `inventory` and `admin`, and nobody approves: the movements carry no approved_by_name, so
-- "nobody approved" stays visible in the ledger (like 0140). A reason, a note and a name are required.
-- A rack -> MIA move still may not cut into stock an open wave reserved or a hold keeps.
--
-- Every call writes one append-only mia_events row (the MIA ledger: kind, who, why, which reconciliation line).
-- Called from Investigasi selisih with a reconciliation line, the line's wms_fix follows the counted stock
-- (move in: minus, find: plus) and the line becomes EXPLAINED (or RESOLVED when the gap is gone) with cause MIA.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1  Vocabulary: a reason code and a cause
-- ---------------------------------------------------------------------
alter table public.movements drop constraint movements_reason_code_check;
alter table public.movements add constraint movements_reason_code_check check (reason_code in (
  'COUNT_VARIANCE', 'DAMAGED', 'EXPIRED', 'DATA_ENTRY', 'MISPICK', 'FOUND', 'LOST',
  'RECEIVING_DIFF', 'RETURN', 'OPENING', 'OTHER', 'PICK_AUDIT', 'MIA'));

alter table public.stock_recon_lines drop constraint if exists stock_recon_lines_cause_check;
alter table public.stock_recon_lines add constraint stock_recon_lines_cause_check
  check (cause in ('PENDING_GI', 'PENDING_GR', 'SAP_INBOUND', 'MISPICK', 'COUNT', 'SAP_ENTRY',
                   'UOM', 'DAMAGED', 'RETURN', 'OTHER', 'MISPLACED', 'MIA'));

-- ---------------------------------------------------------------------
-- 2  The MIA ledger (append-only) and the stock view
-- ---------------------------------------------------------------------
create table public.mia_events (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('MOVE_IN', 'BOOK', 'FIND', 'CLEAR')),
  item_id     uuid not null references public.items(id),
  batch_lot   text not null default '',
  expiry_date date,
  quantity    numeric not null check (quantity > 0),
  bin_id      uuid references public.bins(id),   -- MOVE_IN: the rack bin it came from; FIND: the bin it went to
  line_id     uuid references public.stock_recon_lines(id),
  note        text not null,
  by_name     text not null,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);
create index mia_events_item_idx on public.mia_events (item_id, created_at desc);
create index mia_events_line_idx on public.mia_events (line_id) where line_id is not null;

create or replace function public.mia_events_forbid_change() returns trigger language plpgsql as $$
begin
  raise exception 'Riwayat MIA tidak bisa diubah atau dihapus';
end $$;
create trigger mia_events_immutable before update or delete on public.mia_events
  for each row execute function public.mia_events_forbid_change();
create trigger mia_events_no_truncate before truncate on public.mia_events
  for each statement execute function public.mia_events_forbid_change();

alter table public.mia_events enable row level security;
create policy "mia_events: read" on public.mia_events for select to authenticated using ((select public.is_active()));
-- No write policy: the functions below only.
grant select on public.mia_events to authenticated;
grant all on public.mia_events to service_role;

-- What is in MIA now. `since` = the first time this identity entered MIA (its age).
create or replace view public.mia_stock with (security_invoker = true) as
select i.item_id, it.sku, it.description, it.upp, i.batch_lot, i.expiry_date, i.quantity,
       (select min(e.created_at) from public.mia_events e
         where e.item_id = i.item_id and e.batch_lot = i.batch_lot and e.expiry_date is not distinct from i.expiry_date
           and e.kind in ('MOVE_IN', 'BOOK')) as since
from public.inventory i
join public.bins b on b.id = i.bin_id
join public.items it on it.id = i.item_id
where b.zone = 'MIA' and i.quantity > 0;
grant select on public.mia_stock to authenticated;

-- ---------------------------------------------------------------------
-- 3  Helpers (not callable by the app)
-- ---------------------------------------------------------------------
create or replace function public.mia_require_actor() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_job(array['inventory', 'admin']) then
    raise exception 'Hanya Inventory atau Admin yang bisa memindahkan stok ke atau dari MIA';
  end if;
end $$;

-- Tie a MIA move to an open reconciliation line: `p_fix` is what our (counted) side changed.
create or replace function public.mia_touch_line(p_line uuid, p_fix numeric, p_text text, p_name text)
returns numeric language plpgsql security definer set search_path = public as $$
declare l public.stock_recon_lines%rowtype; v_status text; v_gap numeric;
begin
  select * into l from public.stock_recon_lines where id = p_line for update;
  if l.id is null then raise exception 'Baris rekonsiliasi tidak ada'; end if;
  select status into v_status from public.stock_recons where id = l.recon_id;
  if v_status is distinct from 'OPEN' then raise exception 'Rekonsiliasi sudah ditutup'; end if;
  update public.stock_recon_lines
     set wms_fix = wms_fix + p_fix, cause = 'MIA', updated_by_name = p_name, updated_at = now(),
         remark = left(concat_ws(' · ', nullif(remark, ''), p_text || ' (' || p_name || ')'), 500)
   where id = p_line returning * into l;
  v_gap := public.recon_line_gap(l);
  update public.stock_recon_lines set status = case when v_gap = 0 then 'RESOLVED' else 'EXPLAINED' end where id = p_line;
  return v_gap;
end $$;

-- ---------------------------------------------------------------------
-- 4  rack -> MIA
-- ---------------------------------------------------------------------
create or replace function public.mia_move_in(p_from_bin text, p_sku text, p_batch text, p_expiry date, p_qty numeric,
                                              p_note text, p_by_name text, p_line_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text := public.person_name(p_by_name); v_from public.bins%rowtype; v_mia uuid; v_item uuid;
  v_batch text := coalesce(p_batch, ''); v_phys numeric; v_res numeric; v_waves text; v_held numeric;
  v_ev uuid := gen_random_uuid(); v_gap numeric;
begin
  perform public.mia_require_actor();
  if p_qty is null or p_qty <= 0 or p_qty <> trunc(p_qty) then raise exception 'Jumlah karton harus bilangan bulat lebih dari 0'; end if;
  if nullif(trim(p_note), '') is null then raise exception 'Keterangan wajib diisi'; end if;
  select * into v_from from public.bins where bin_code = upper(trim(p_from_bin));
  if v_from.id is null then raise exception 'Bin % tidak ada', p_from_bin; end if;
  if v_from.zone = 'MIA' then raise exception 'Stok sudah di MIA'; end if;
  select id into v_item from public.items where sku = trim(p_sku);
  if v_item is null then raise exception 'SKU % tidak ada di master item', p_sku; end if;
  select id into v_mia from public.bins where zone = 'MIA' order by bin_code limit 1;

  select quantity into v_phys from public.inventory
   where bin_id = v_from.id and item_id = v_item and batch_lot = v_batch and expiry_date is not distinct from p_expiry for update;
  if v_phys is null then
    raise exception 'Baris stok % / % batch % tidak ada lagi: muat ulang halaman', v_from.bin_code, trim(p_sku), coalesce(nullif(v_batch, ''), '–');
  end if;
  if p_qty > v_phys then raise exception 'Stok % di % tinggal %, tidak bisa dipindah %', trim(p_sku), v_from.bin_code, v_phys, p_qty; end if;

  select coalesce(sum(t.quantity), 0), string_agg(distinct w.wave_no || ' (' || w.planned_date || ')', ', ') into v_res, v_waves
    from public.open_pick_tasks t join public.waves w on w.id = t.wave_id
   where t.from_bin_id = v_from.id and t.item_id = v_item and t.batch_lot = v_batch and t.expiry_date is not distinct from p_expiry;
  if v_res > 0 and v_phys - p_qty < v_res then
    raise exception 'Bin % batch % dipesan % karton untuk wave %. Kerjakan atau hitung ulang wave itu dulu.', v_from.bin_code, coalesce(nullif(v_batch, ''), '–'), v_res, v_waves;
  end if;
  v_held := public.held_qty(v_from.id, v_item, v_batch, p_expiry, v_phys);
  if v_held > 0 and v_phys - p_qty < v_held then
    raise exception 'Bin % batch % ditahan % karton (%). Lepas hold dulu.', v_from.bin_code, coalesce(nullif(v_batch, ''), '–'), v_held,
      public.hold_reasons(v_from.id, v_item, v_batch, p_expiry);
  end if;

  perform set_config('app.mia_movement', 'on', true);
  insert into public.movements (type, item_id, batch_lot, quantity, from_bin_id, to_bin_id, expiry_date, note, by_name, ref_id)
  values ('transfer', v_item, v_batch, p_qty, v_from.id, v_mia, p_expiry, 'MIA: ' || trim(p_note), v_name, v_ev);
  perform set_config('app.mia_movement', '', true);

  insert into public.mia_events (id, kind, item_id, batch_lot, expiry_date, quantity, bin_id, line_id, note, by_name, created_by)
  values (v_ev, 'MOVE_IN', v_item, v_batch, p_expiry, p_qty, v_from.id, p_line_id, trim(p_note), v_name, auth.uid());
  if p_line_id is not null then
    v_gap := public.mia_touch_line(p_line_id, -p_qty, 'MIA +' || p_qty || ' dari ' || v_from.bin_code, v_name);
  end if;
  return jsonb_build_object('event_id', v_ev, 'quantity', p_qty, 'gap_after', v_gap);
end $$;

-- ---------------------------------------------------------------------
-- 5  nothing -> MIA: SAP expects it, nobody has found it
-- ---------------------------------------------------------------------
create or replace function public.mia_book(p_sku text, p_batch text, p_expiry date, p_qty numeric,
                                           p_note text, p_by_name text, p_line_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text := public.person_name(p_by_name); v_mia uuid; v_item uuid; v_batch text := coalesce(p_batch, '');
  v_ev uuid := gen_random_uuid(); v_gap numeric;
begin
  perform public.mia_require_actor();
  if p_qty is null or p_qty <= 0 or p_qty <> trunc(p_qty) then raise exception 'Jumlah karton harus bilangan bulat lebih dari 0'; end if;
  if nullif(trim(p_note), '') is null then raise exception 'Keterangan wajib diisi'; end if;
  select id into v_item from public.items where sku = trim(p_sku);
  if v_item is null then raise exception 'SKU % tidak ada di master item', p_sku; end if;
  select id into v_mia from public.bins where zone = 'MIA' order by bin_code limit 1;

  perform set_config('app.mia_movement', 'on', true);
  perform set_config('app.adjust_approved', 'on', true);
  insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note, reason_code, by_name, ref_id)
  values ('adjustment', v_item, v_batch, p_qty, v_mia, p_expiry, 'MIA: ' || trim(p_note), 'MIA', v_name, v_ev);
  perform set_config('app.mia_movement', '', true);
  perform set_config('app.adjust_approved', '', true);

  insert into public.mia_events (id, kind, item_id, batch_lot, expiry_date, quantity, line_id, note, by_name, created_by)
  values (v_ev, 'BOOK', v_item, v_batch, p_expiry, p_qty, p_line_id, trim(p_note), v_name, auth.uid());
  if p_line_id is not null then
    -- MIA is not our side of the comparison: the gap stays, now explained by MIA.
    v_gap := public.mia_touch_line(p_line_id, 0, 'MIA +' || p_qty || ' dicatat (belum ketemu)', v_name);
  end if;
  return jsonb_build_object('event_id', v_ev, 'quantity', p_qty, 'gap_after', v_gap);
end $$;

-- ---------------------------------------------------------------------
-- 6  MIA -> rack: found
-- ---------------------------------------------------------------------
create or replace function public.mia_find(p_to_bin text, p_sku text, p_batch text, p_expiry date, p_qty numeric,
                                           p_note text, p_by_name text, p_line_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text := public.person_name(p_by_name); v_to public.bins%rowtype; v_mia uuid; v_item uuid;
  v_batch text := coalesce(p_batch, ''); v_have numeric; v_ev uuid := gen_random_uuid(); v_gap numeric; v_other text;
begin
  perform public.mia_require_actor();
  if p_qty is null or p_qty <= 0 or p_qty <> trunc(p_qty) then raise exception 'Jumlah karton harus bilangan bulat lebih dari 0'; end if;
  if nullif(trim(p_note), '') is null then raise exception 'Keterangan wajib diisi'; end if;
  select * into v_to from public.bins where bin_code = upper(trim(p_to_bin));
  if v_to.id is null then raise exception 'Bin % tidak ada', p_to_bin; end if;
  if v_to.zone = 'MIA' then raise exception 'Pilih bin tujuan di luar MIA'; end if;
  if not public.bin_usable(v_to.id) then raise exception 'Bin % tidak bisa dipakai (diblokir, tidak ada, atau bukan milik Shell)', v_to.bin_code; end if;
  select id into v_item from public.items where sku = trim(p_sku);
  if v_item is null then raise exception 'SKU % tidak ada di master item', p_sku; end if;
  select id into v_mia from public.bins where zone = 'MIA' order by bin_code limit 1;

  -- A rack bin holds one SKU: refuse a bin that has another one.
  if v_to.bin_code ~ '^C[A-Z][0-9]{2}[A-E][0-9]{2}$' then
    select string_agg(distinct it.sku, ', ') into v_other from public.inventory i join public.items it on it.id = i.item_id
     where i.bin_id = v_to.id and i.item_id <> v_item and i.quantity > 0;
    if v_other is not null then raise exception 'Bin % sudah berisi SKU lain (%): satu bin satu SKU', v_to.bin_code, v_other; end if;
  end if;

  select quantity into v_have from public.inventory
   where bin_id = v_mia and item_id = v_item and batch_lot = v_batch and expiry_date is not distinct from p_expiry for update;
  if v_have is null or p_qty > v_have then
    raise exception 'Di MIA hanya ada % karton SKU % batch % untuk expired ini', coalesce(v_have, 0), trim(p_sku), coalesce(nullif(v_batch, ''), '–');
  end if;

  perform set_config('app.mia_movement', 'on', true);
  insert into public.movements (type, item_id, batch_lot, quantity, from_bin_id, to_bin_id, expiry_date, note, by_name, ref_id)
  values ('transfer', v_item, v_batch, p_qty, v_mia, v_to.id, p_expiry, 'MIA ditemukan: ' || trim(p_note), v_name, v_ev);
  perform set_config('app.mia_movement', '', true);

  insert into public.mia_events (id, kind, item_id, batch_lot, expiry_date, quantity, bin_id, line_id, note, by_name, created_by)
  values (v_ev, 'FIND', v_item, v_batch, p_expiry, p_qty, v_to.id, p_line_id, trim(p_note), v_name, auth.uid());
  if p_line_id is not null then
    v_gap := public.mia_touch_line(p_line_id, p_qty, 'MIA -' || p_qty || ' ditemukan di ' || v_to.bin_code, v_name);
  end if;
  return jsonb_build_object('event_id', v_ev, 'quantity', p_qty, 'gap_after', v_gap);
end $$;

-- ---------------------------------------------------------------------
-- 7  MIA -> nothing: written off
-- ---------------------------------------------------------------------
create or replace function public.mia_clear(p_sku text, p_batch text, p_expiry date, p_qty numeric,
                                            p_note text, p_by_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text := public.person_name(p_by_name); v_mia uuid; v_item uuid; v_batch text := coalesce(p_batch, '');
  v_have numeric; v_ev uuid := gen_random_uuid();
begin
  perform public.mia_require_actor();
  if p_qty is null or p_qty <= 0 or p_qty <> trunc(p_qty) then raise exception 'Jumlah karton harus bilangan bulat lebih dari 0'; end if;
  if nullif(trim(p_note), '') is null then raise exception 'Keterangan wajib diisi (mis. nomor dokumen SAP)'; end if;
  select id into v_item from public.items where sku = trim(p_sku);
  if v_item is null then raise exception 'SKU % tidak ada di master item', p_sku; end if;
  select id into v_mia from public.bins where zone = 'MIA' order by bin_code limit 1;
  select quantity into v_have from public.inventory
   where bin_id = v_mia and item_id = v_item and batch_lot = v_batch and expiry_date is not distinct from p_expiry for update;
  if v_have is null or p_qty > v_have then
    raise exception 'Di MIA hanya ada % karton SKU % batch % untuk expired ini', coalesce(v_have, 0), trim(p_sku), coalesce(nullif(v_batch, ''), '–');
  end if;

  perform set_config('app.mia_movement', 'on', true);
  perform set_config('app.adjust_approved', 'on', true);
  insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note, reason_code, by_name, ref_id)
  values ('adjustment', v_item, v_batch, -p_qty, v_mia, p_expiry, 'MIA dihapus: ' || trim(p_note), 'MIA', v_name, v_ev);
  perform set_config('app.mia_movement', '', true);
  perform set_config('app.adjust_approved', '', true);

  insert into public.mia_events (id, kind, item_id, batch_lot, expiry_date, quantity, note, by_name, created_by)
  values (v_ev, 'CLEAR', v_item, v_batch, p_expiry, p_qty, trim(p_note), v_name, auth.uid());
  return jsonb_build_object('event_id', v_ev, 'quantity', p_qty);
end $$;

revoke execute on function public.mia_require_actor(), public.mia_touch_line(uuid, numeric, text, text) from public, anon, authenticated;
revoke execute on function public.mia_move_in(text, text, text, date, numeric, text, text, uuid),
  public.mia_book(text, text, date, numeric, text, text, uuid),
  public.mia_find(text, text, text, date, numeric, text, text, uuid),
  public.mia_clear(text, text, date, numeric, text, text) from public, anon;
grant execute on function public.mia_move_in(text, text, text, date, numeric, text, text, uuid),
  public.mia_book(text, text, date, numeric, text, text, uuid),
  public.mia_find(text, text, text, date, numeric, text, text, uuid),
  public.mia_clear(text, text, date, numeric, text, text) to authenticated;
