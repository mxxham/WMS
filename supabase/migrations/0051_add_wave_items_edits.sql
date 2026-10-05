-- =====================================================================
-- 0051  Tambah item follows the printed picklist, and says so
--
--  The printed picklist is what the floor works from, and it is not
--  always what the engine would plan (not always FEFO either). Tambah
--  item lets the supervisor set each new row's source bin and Bin To Bin
--  (destination and sisa, also on a line the engine gave none) before
--  saving. 0048 saved those rows as if the engine had chosen them: no
--  name, no reason, no trace of what was planned. A row the wave page
--  changed now carries `planned` (the engine's values; all null for a
--  row it added) and this function:
--    * requires a name and a reason when any row was changed,
--    * logs one TASK event per changed row: planned -> saved,
--    * refuses a changed pick whose bin does not hold its batch + expiry
--      (0050's rule: task_shortfalls matches bin + SKU + batch + expiry,
--      so such a pick could never post — fix the stock first),
--    * refuses a changed move when the wave already has an open Bin To
--      Bin from that bin for that batch (0045's rule).
--  Blocked bins are refused for every row, changed or not, as add_relocation
--  and change_relocation already do. A later expiry is the page's warning,
--  not a refusal here. Rows without `planned` are saved exactly as 0048.
-- =====================================================================

drop function if exists public.add_wave_items(uuid, text, jsonb);

create or replace function public.add_wave_items(p_wave_id uuid, p_shipment text, p_plan jsonb,
  p_by_name text default null, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  w public.waves%rowtype; t jsonb; o jsonb; pl jsonb; v_item uuid; v_from public.bins%rowtype; v_to public.bins%rowtype;
  v_base int; v_sh text := trim(p_shipment); v_line uuid; v_id uuid; v_name text; v_reason text := nullif(trim(p_reason), '');
  v_batch text; v_exp date; v_have numeric; v_note text;
  n_tasks int := 0; n_raised int := 0; n_added int := 0; n_changed int := 0;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa menambah item';
  end if;
  select * into w from public.waves where id = p_wave_id for update;
  if w.id is null then raise exception 'Wave tidak ditemukan'; end if;
  if w.status not in ('PENDING', 'RESCHEDULED') then raise exception 'Wave NO % sudah %', w.wave_no, w.status; end if;
  if v_sh is null or not v_sh = any(w.shipment_numbers) then raise exception 'Shipment % tidak ada di wave NO %', p_shipment, w.wave_no; end if;
  if jsonb_array_length(coalesce(p_plan->'outbound', '[]')) = 0 then raise exception 'Item tanpa baris SKU'; end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_plan->'tasks', '[]')) x where x ? 'planned') then
    v_name := public.person_name(p_by_name, 'Nama Anda');
    if v_reason is null then raise exception 'Alasan wajib diisi bila bin atau Bin To Bin diubah'; end if;
  end if;

  -- After the wave's last row; the plan's own order (a pick then its move) is kept.
  select coalesce(max(seq), 0) into v_base from public.pick_tasks where wave_id = w.id;
  for t in select * from jsonb_array_elements(coalesce(p_plan->'tasks', '[]')) loop
    select id into v_item from public.items where sku = t->>'sku';
    if v_item is null then raise exception 'SKU % tidak ada di master item', t->>'sku'; end if;
    select * into v_from from public.bins where bin_code = upper(trim(t->>'from_bin'));
    if v_from.id is null then raise exception 'Bin % tidak ada', t->>'from_bin'; end if;
    if v_from.status = 'blocked' then raise exception 'Bin % diblokir', v_from.bin_code; end if;
    v_to := null;
    if coalesce(t->>'to_bin', '') <> '' then
      select * into v_to from public.bins where bin_code = upper(trim(t->>'to_bin'));
      if v_to.id is null then raise exception 'Bin % tidak ada', t->>'to_bin'; end if;
      if v_to.status = 'blocked' then raise exception 'Bin % diblokir', v_to.bin_code; end if;
      if v_to.id = v_from.id then raise exception 'Bin asal dan tujuan Bin To Bin sama: %', v_from.bin_code; end if;
    end if;
    v_batch := coalesce(t->>'batch_lot', '');
    v_exp := (t->>'expiry_date')::date;
    pl := t->'planned';

    if pl is not null then
      if t->>'task_type' = 'PICK' and (pl->>'from_bin' is distinct from v_from.bin_code
          or coalesce(pl->>'batch_lot', '') <> v_batch or (pl->>'expiry_date')::date is distinct from v_exp) then
        select coalesce(sum(quantity), 0) into v_have from public.inventory
         where bin_id = v_from.id and item_id = v_item and batch_lot = v_batch and expiry_date is not distinct from v_exp;
        if v_have <= 0 then
          raise exception 'Bin % tidak menyimpan SKU % batch % exp %: koreksi stok dulu (Adjust stok), lalu simpan lagi',
            v_from.bin_code, t->>'sku', nullif(v_batch, ''), v_exp;
        end if;
      end if;
      if t->>'task_type' <> 'PICK' and exists (
          select 1 from public.pick_tasks x where x.wave_id = w.id and x.task_type <> 'PICK' and x.status = 'PLANNED'
             and x.from_bin_id = v_from.id and x.item_id = v_item and x.batch_lot = v_batch) then
        raise exception 'Sudah ada Bin To Bin terbuka dari % di wave NO %', v_from.bin_code, w.wave_no;
      end if;
    end if;

    insert into public.pick_tasks (wave_id, shipment_number, task_type, item_id, from_bin_id, to_bin_id,
                                   batch_lot, expiry_date, quantity, pick_type, breaks_pallet, seq)
    values (w.id, case when t->>'task_type' = 'PICK' then v_sh end, t->>'task_type', v_item, v_from.id, v_to.id,
            v_batch, v_exp, (t->>'quantity')::numeric,
            nullif(t->>'pick_type', ''), coalesce((t->>'breaks_pallet')::boolean, false), v_base + (t->>'seq')::int)
    returning id into v_id;
    n_tasks := n_tasks + 1;

    if pl is not null then
      n_changed := n_changed + 1;
      if t->>'task_type' = 'PICK' then
        v_note := format('bin pick diubah oleh %s (Tambah item): %s → %s', v_name, pl->>'from_bin', v_from.bin_code);
        if coalesce(pl->>'batch_lot', '') <> v_batch or (pl->>'expiry_date')::date is distinct from v_exp then
          v_note := v_note || format(' batch %s exp %s → %s exp %s', nullif(pl->>'batch_lot', ''), pl->>'expiry_date', nullif(v_batch, ''), v_exp);
        end if;
        if pl->>'to_bin' is not null then v_note := v_note || format('; Bin To Bin rencana ke %s dihapus', pl->>'to_bin'); end if;
      elsif pl->>'to_bin' is null then
        v_note := format('Bin To Bin ditambah oleh %s (Tambah item): %s → %s %s', v_name, v_from.bin_code, v_to.bin_code, t->>'quantity');
      else
        v_note := format('Bin To Bin diubah oleh %s (Tambah item): %s → %s %s, rencana %s → %s %s', v_name,
          v_from.bin_code, v_to.bin_code, t->>'quantity', pl->>'from_bin', pl->>'to_bin', pl->>'quantity');
      end if;
      perform public.log_execution_event('TASK', v_id, null, 'PLANNED', v_note || ': ' || v_reason);
    end if;
  end loop;

  for o in select * from jsonb_array_elements(p_plan->'outbound') loop
    select id into v_item from public.items where sku = o->>'sku';
    if v_item is null then raise exception 'SKU % tidak ada di master item', o->>'sku'; end if;
    select id into v_line from public.outbound
    where wave_id = w.id and shipment_number = v_sh and sku = o->>'sku' and status <> 'CANCELLED'
    order by created_at limit 1 for update;
    if v_line is not null then
      update public.outbound set
        quantity_requested = quantity_requested + (o->>'quantity_requested')::numeric,
        quantity_allocated = quantity_allocated + coalesce((o->>'quantity_allocated')::numeric, 0),
        order_nos = array(select distinct x from unnest(order_nos || coalesce(array(select jsonb_array_elements_text(o->'order_nos')), '{}')) x order by 1)
      where id = v_line;
      n_raised := n_raised + 1;
    else
      insert into public.outbound (outbound_date, wave_id, shipment_number, sku, item_id, description, order_nos,
                                   truck, destination, quantity_requested, quantity_allocated, shortage_reason)
      values (w.planned_date, w.id, v_sh, o->>'sku', v_item, coalesce(o->>'description', ''),
              coalesce(array(select jsonb_array_elements_text(o->'order_nos')), '{}'),
              w.truck, w.destination, (o->>'quantity_requested')::numeric, coalesce((o->>'quantity_allocated')::numeric, 0),
              nullif(o->>'shortage_reason', ''));
      n_added := n_added + 1;
    end if;
  end loop;

  perform public.log_execution_event('WAVE', w.id, w.status, w.status,
    format('item ditambah ke shipment %s: %s%s', v_sh,
           (select string_agg(format('%s +%s', o2->>'sku', o2->>'quantity_requested'), ', ') from jsonb_array_elements(p_plan->'outbound') o2),
           case when n_changed > 0 then format(' (%s baris mengikuti picklist cetak, oleh %s)', n_changed, v_name) else '' end));
  return jsonb_build_object('wave_no', w.wave_no, 'tasks', n_tasks, 'raised', n_raised, 'added', n_added, 'changed', n_changed);
end $$;
revoke execute on function public.add_wave_items(uuid, text, jsonb, text, text) from public, anon;
grant execute on function public.add_wave_items(uuid, text, jsonb, text, text) to authenticated;
