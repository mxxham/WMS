-- =====================================================================
-- 0062  Isi dari picklist: the pallet comes down before the pickface is picked
--
--  Floor incident, 7 Oct 2026 (wave 10 of 6 Oct, from the K_ONE sheet):
--  CD13A01 (pickface, 550048593) held 1 carton of 13H26JJ. The paper says
--  line #2 picked 31 there, and line #3 opened pallet CF11E01 (21H26JJ),
--  picked 5 and sent the rest 43 to CD13A01. On the floor the pallet came
--  down first: 1 + 48 - 31 - 5 = 13 left, as the WMS shows. Posted in paper
--  order, #2 found 1, booked +30 koreksi picklist, then #3 moved 43 in: 43
--  in the system, 30 cartons that do not exist. CD15A02 (+23) the same.
--
--  Two changes, both inside post_wave_sheet; nothing else calls them:
--    1. Order: a line whose Bin To Bin fills a bin is posted before the
--       lines that pick that SKU from that bin. sheet_ensure_stock already
--       posted open moves of OTHER waves first; a move the paper itself
--       creates was not one yet.
--    2. Mixed batches: when the bin holds too few of the line's batch, the
--       rest is taken from the bin's other batches of the SKU, earliest
--       expiry first, one split pick per batch (kind 'batch_fill'). Only
--       what the whole bin lacks is still a koreksi picklist + count.
--  Never another bin, never another quantity: the paper's bin and numbers
--  are what gets posted.
-- =====================================================================

create or replace function public.post_wave_sheet(p_wave_id uuid, p_rows jsonb, p_by_name text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text; v_reason text := nullif(trim(p_reason), '');
  w public.waves%rowtype; v_orig text;
  row jsonb; src jsonb; t public.pick_tasks%rowtype; m public.pick_tasks%rowtype;
  v_rr text; v_srcs jsonb; n_src int; v_total numeric; i int;
  v_part_ids uuid[]; v_part_qty numeric[]; v_part_src jsonb; v_res jsonb; v_keep numeric;
  b_id uuid; b_status text; v_batch text; v_exp date; v_q numeric; v_mq numeric; v_to text; v_to_id uuid; v_to_status text;
  v_first_bin uuid; v_first_batch text; v_first_exp date; v_note text; v_same boolean;
  v_out jsonb := '[]'::jsonb; n_rows int := 0; v_skip uuid[]; v_rb text; v_re date;
  v_order int[] := '{}'; v_idx int; v_n int; v_item uuid; r_i jsonb; r_j jsonb; j int;
  v_pieces jsonb; pc jsonb; k int; v_h numeric; v_left numeric; v_take numeric; v_first_q numeric; ob record;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa posting dari picklist';
  end if;
  v_name := public.person_name(p_by_name, 'Nama Anda');
  if v_reason is null then raise exception 'Alasan wajib diisi'; end if;
  select * into w from public.waves where id = p_wave_id for update;
  if w.id is null then raise exception 'Wave tidak ditemukan'; end if;
  if w.status = 'CANCELLED' then raise exception 'Wave NO % dibatalkan', w.wave_no; end if;
  v_orig := w.status;
  -- A Tunda or finished wave is worked on for the length of this transaction only.
  if v_orig <> 'PENDING' then update public.waves set status = 'PENDING' where id = w.id; end if;
  perform set_config('app.by_name', v_name, true);

  -- 0062: a line whose Bin To Bin fills a bin goes before the lines that pick from that bin
  -- (same SKU): on the floor the pallet came down to the pickface first, then it was picked.
  v_n := jsonb_array_length(coalesce(p_rows, '[]'::jsonb));
  for i in 0 .. v_n - 1 loop
    continue when i = any(v_order);
    r_i := p_rows->i;
    select item_id into v_item from public.pick_tasks
     where id = coalesce(nullif(r_i->>'pick_id', '')::uuid, nullif(r_i->>'move_id', '')::uuid);
    for j in i + 1 .. v_n - 1 loop
      continue when j = any(v_order);
      r_j := p_rows->j;
      if nullif(upper(trim(coalesce(r_j->>'move_to', ''))), '') is not null and coalesce((r_j->>'move_qty')::numeric, 0) > 0
         and upper(trim(r_j->>'move_to')) in (select upper(trim(s->>'bin')) from jsonb_array_elements(coalesce(r_i->'sources', '[]'::jsonb)) s
                                              where coalesce((s->>'qty')::numeric, 0) > 0)
         and (select item_id from public.pick_tasks
               where id = coalesce(nullif(r_j->>'pick_id', '')::uuid, nullif(r_j->>'move_id', '')::uuid)) = v_item then
        v_order := v_order || j;
      end if;
    end loop;
    v_order := v_order || i;
  end loop;

  foreach v_idx in array v_order loop
    row := p_rows->v_idx;
    n_rows := n_rows + 1;
    v_rr := coalesce(nullif(trim(row->>'reason'), ''), v_reason);
    t := null; m := null;
    if nullif(row->>'pick_id', '') is not null then
      select * into t from public.pick_tasks where id = (row->>'pick_id')::uuid for update;
      if t.id is null or t.wave_id <> w.id or t.task_type <> 'PICK' then raise exception 'Baris % bukan pick wave ini', v_idx + 1; end if;
      if t.status = 'CANCELLED' then raise exception 'Baris #% dibatalkan: pulihkan dulu', t.seq; end if;
    end if;
    if nullif(row->>'move_id', '') is not null then
      select * into m from public.pick_tasks where id = (row->>'move_id')::uuid for update;
      if m.id is null or m.wave_id <> w.id or m.task_type = 'PICK' then raise exception 'Bin To Bin baris % bukan milik wave ini', v_idx + 1; end if;
    end if;
    if t.id is null and m.id is null then raise exception 'Baris % tanpa tugas', v_idx + 1; end if;
    v_skip := array_remove(array[t.id, m.id], null);

    -- Sources as written on the paper (resolved to bins; unknown bins refuse).
    v_srcs := '[]'::jsonb; v_total := 0;
    for src in select value from jsonb_array_elements(coalesce(row->'sources', '[]'::jsonb)) loop
      v_q := coalesce((src->>'qty')::numeric, 0);
      select id, status into b_id, b_status from public.bins where bin_code = upper(trim(src->>'bin'));
      if b_id is null then raise exception 'Bin % tidak ada (baris #%)', upper(trim(src->>'bin')), coalesce(t.seq, m.seq); end if;
      if v_q < 0 then raise exception 'Jumlah negatif di baris #%', coalesce(t.seq, m.seq); end if;
      -- 0061: the cartons the floor took are the ones in the bin. A batch the bin
      -- does not hold (a name copied down on the paper) is read as the bin's own.
      v_batch := coalesce(trim(src->>'batch'), ''); v_exp := nullif(src->>'expiry', '')::date;
      if v_q > 0 then
        select r.batch_lot, r.expiry_date into v_rb, v_re
        from public.sheet_real_batch(b_id, coalesce(t.item_id, m.item_id), v_batch, v_exp, array_remove(array[t.id, m.id], null)) r;
        if v_rb is distinct from v_batch or v_re is distinct from v_exp then
          v_out := v_out || jsonb_build_object('kind', 'batch_from_bin', 'wave_no', w.wave_no, 'seq', coalesce(t.seq, m.seq),
            'bin', upper(trim(src->>'bin')), 'sku', (select sku from public.items where id = coalesce(t.item_id, m.item_id)),
            'paper_batch', v_batch, 'paper_expiry', v_exp, 'batch', v_rb, 'expiry', v_re, 'qty', v_q);
          v_batch := v_rb; v_exp := v_re;
        end if;
      end if;
      v_srcs := v_srcs || jsonb_build_object('bin_id', b_id, 'bin', upper(trim(src->>'bin')), 'batch', v_batch,
                                             'expiry', v_exp, 'qty', v_q);
      v_total := v_total + v_q;
    end loop;
    -- A second source with 0 cartons is an empty line on the paper.
    if jsonb_array_length(v_srcs) > 1 then
      v_srcs := coalesce((select jsonb_agg(e) from jsonb_array_elements(v_srcs) e where (e->>'qty')::numeric > 0), v_srcs->0);
      if jsonb_typeof(v_srcs) = 'object' then v_srcs := jsonb_build_array(v_srcs); end if;
    end if;
    n_src := jsonb_array_length(v_srcs);
    if n_src = 0 then raise exception 'Baris #% tanpa bin sumber', coalesce(t.seq, m.seq); end if;
    v_first_bin := (v_srcs->0->>'bin_id')::uuid; v_first_batch := v_srcs->0->>'batch'; v_first_exp := (v_srcs->0->>'expiry')::date;
    v_to := nullif(upper(trim(coalesce(row->>'move_to', ''))), '');
    v_mq := coalesce((row->>'move_qty')::numeric, 0);
    if v_to is not null then
      select id, status into v_to_id, v_to_status from public.bins where bin_code = v_to;
      if v_to_id is null then raise exception 'Bin % tidak ada (Bin To Bin baris #%)', v_to, coalesce(t.seq, m.seq); end if;
      if v_to_id = v_first_bin then raise exception 'Bin To Bin baris #%: tujuan sama dengan sumber %', coalesce(t.seq, m.seq), v_to; end if;
    end if;
    -- The wave date leads the note: picklist_corrections finds the correction by it, whenever the paper was entered.
    v_note := format('%s NO %s #%s', w.planned_date, w.wave_no, coalesce(t.seq, m.seq));

    -- 1. Posted rows: undo what differs from the paper (the move first, then the pick).
    if m.id is not null and m.status = 'COMPLETED' then
      v_same := v_to is not null and m.to_bin_id = v_to_id and coalesce(m.actual_quantity, m.quantity) = v_mq
        and coalesce(m.actual_from_bin_id, m.from_bin_id) = v_first_bin
        and coalesce(m.actual_batch_lot, m.batch_lot) = v_first_batch
        and coalesce(m.actual_expiry_date, m.expiry_date) is not distinct from v_first_exp;
      -- A pick being undone takes its move back with it.
      if t.id is not null and t.status = 'COMPLETED' and not (n_src = 1 and coalesce(t.actual_from_bin_id, t.from_bin_id) = v_first_bin
          and coalesce(t.actual_batch_lot, t.batch_lot) = v_first_batch
          and coalesce(t.actual_expiry_date, t.expiry_date) is not distinct from v_first_exp
          and coalesce(t.actual_quantity, t.quantity) = v_total) then
        v_same := false;
      end if;
      if not v_same then
        -- The pickface must still hold what the move brought, to send it back.
        v_out := v_out || public.sheet_ensure_stock(m.to_bin_id, m.item_id, coalesce(m.actual_batch_lot, m.batch_lot),
          coalesce(m.actual_expiry_date, m.expiry_date), coalesce(m.actual_quantity, m.quantity), v_note || ' batalkan Bin To Bin', v_skip, false);
        perform public.unpost_task(m.id, v_name, 'isi dari picklist: ' || v_rr);
        select * into m from public.pick_tasks where id = m.id;
      end if;
    end if;
    if t.id is not null and t.status = 'COMPLETED' then
      v_same := n_src = 1 and coalesce(t.actual_from_bin_id, t.from_bin_id) = v_first_bin
        and coalesce(t.actual_batch_lot, t.batch_lot) = v_first_batch
        and coalesce(t.actual_expiry_date, t.expiry_date) is not distinct from v_first_exp
        and coalesce(t.actual_quantity, t.quantity) = v_total;
      if not v_same then
        perform public.unpost_task(t.id, v_name, 'isi dari picklist: ' || v_rr);
        select * into t from public.pick_tasks where id = t.id;
      end if;
    end if;

    -- 2. The pick: split per source, raised when more was taken, then posted from the real source.
    if t.id is not null and t.status = 'PLANNED' then
      if v_total > t.quantity then
        perform public.log_execution_event('TASK', t.id, 'PLANNED', 'PLANNED',
          format('isi dari picklist oleh %s: diambil %s, rencana %s: %s', v_name, v_total, t.quantity, v_rr));
        update public.pick_tasks set quantity = v_total where id = t.id;
        t.quantity := v_total;
      end if;
      v_part_ids := array[t.id]; v_part_qty := array[(v_srcs->0->>'qty')::numeric]; v_part_src := jsonb_build_array(v_srcs->0);
      -- Extra sources split off the task; the first source keeps the rest (and any shortfall).
      for i in 1 .. n_src - 1 loop
        v_q := (v_srcs->i->>'qty')::numeric;
        select quantity into v_keep from public.pick_tasks where id = t.id;
        v_res := public.split_task(t.id, v_keep - v_q, v_name);
        v_part_ids := v_part_ids || (v_res->>'new_task')::uuid;
        v_part_qty := v_part_qty || v_q;
        v_part_src := v_part_src || jsonb_build_array(v_srcs->i);
      end loop;
      for i in 1 .. array_length(v_part_ids, 1) loop
        src := v_part_src->(i - 1);
        v_q := v_part_qty[i];
        v_batch := src->>'batch'; v_exp := (src->>'expiry')::date; b_id := (src->>'bin_id')::uuid;
        v_pieces := jsonb_build_array(jsonb_build_object('id', v_part_ids[i], 'batch', v_batch, 'expiry', v_exp, 'qty', v_q));
        -- 0062: the bin holds too few of this batch: the rest comes from the bin's other batches
        -- (earliest expiry first), one split pick per batch. Only what the whole bin lacks is
        -- left for sheet_ensure_stock to correct. Not for an opened pallet (one batch, its rest
        -- moves on), nor when an open Bin To Bin is bringing this batch.
        if v_q > 0 and not (i = 1 and v_to is not null and v_mq > 0) then
          v_h := public.sheet_have(b_id, t.item_id, v_batch, v_exp);
          if v_h < v_q and not exists (
               select 1 from public.pick_tasks x join public.waves xw on xw.id = x.wave_id
               where x.task_type <> 'PICK' and x.status = 'PLANNED' and xw.status in ('PENDING', 'RESCHEDULED')
                 and x.to_bin_id = b_id and x.item_id = t.item_id and x.batch_lot = v_batch
                 and x.expiry_date is not distinct from v_exp and x.id <> all(v_skip)) then
            v_left := v_q - v_h; v_first_q := v_q;
            for ob in select v.batch_lot, v.expiry_date, v.quantity from public.inventory v
                      where v.bin_id = b_id and v.item_id = t.item_id and v.quantity > 0
                        and not (v.batch_lot = v_batch and v.expiry_date is not distinct from v_exp)
                      order by v.expiry_date nulls last, v.quantity desc, v.batch_lot loop
              exit when v_left <= 0;
              select quantity into v_keep from public.pick_tasks where id = v_part_ids[i];
              v_take := least(v_left, ob.quantity, v_keep - 1);
              exit when v_take <= 0;
              v_res := public.split_task(v_part_ids[i], v_keep - v_take, v_name);
              v_pieces := v_pieces || jsonb_build_object('id', v_res->>'new_task', 'batch', ob.batch_lot, 'expiry', ob.expiry_date, 'qty', v_take);
              v_first_q := v_first_q - v_take; v_left := v_left - v_take;
              v_out := v_out || jsonb_build_object('kind', 'batch_fill', 'wave_no', w.wave_no, 'seq', t.seq, 'bin', src->>'bin',
                'sku', (select sku from public.items where id = t.item_id), 'paper_batch', v_batch, 'batch', ob.batch_lot,
                'expiry', ob.expiry_date, 'qty', v_take);
            end loop;
            v_pieces := jsonb_set(v_pieces, '{0,qty}', to_jsonb(v_first_q));
          end if;
        end if;
        for k in 0 .. jsonb_array_length(v_pieces) - 1 loop
          pc := v_pieces->k;
          -- The pallet the Bin To Bin leaves from must also hold its rest.
          v_out := v_out || public.sheet_ensure_stock(b_id, t.item_id, pc->>'batch', (pc->>'expiry')::date,
            (pc->>'qty')::numeric + case when i = 1 and k = 0 and v_to is not null and v_mq > 0 then v_mq else 0 end, v_note, v_skip, true);
          perform set_config('app.pick_bulk', 'on', true);
          perform public.post_task((pc->>'id')::uuid, (pc->>'qty')::numeric, src->>'bin', pc->>'batch', (pc->>'expiry')::date, v_rr);
          perform set_config('app.pick_bulk', '', true);
        end loop;
      end loop;
    end if;

    -- 3. The Bin To Bin, as the paper says.
    if m.id is not null and m.status = 'PLANNED' and (v_to is null or v_mq <= 0) then
      update public.pick_tasks set status = 'CANCELLED' where id = m.id;
      perform public.log_execution_event('TASK', m.id, 'PLANNED', 'CANCELLED', format('isi dari picklist oleh %s: tidak dipindah: %s', v_name, v_rr));
    elsif v_to is not null and v_mq > 0 and (m.id is null or m.status = 'PLANNED') then
      if m.id is null then
        update public.pick_tasks set seq = seq + 1 where wave_id = w.id and seq > t.seq;
        insert into public.pick_tasks (wave_id, shipment_number, task_type, item_id, from_bin_id, to_bin_id,
                                       batch_lot, expiry_date, quantity, pick_type, breaks_pallet, seq)
        values (w.id, null, 'REPLENISH', t.item_id, v_first_bin, v_to_id, v_first_batch, v_first_exp, v_mq, 'CASE', true, t.seq + 1)
        returning * into m;
        perform public.log_execution_event('TASK', m.id, null, 'PLANNED', format('isi dari picklist oleh %s: Bin To Bin ke %s (%s): %s', v_name, v_to, v_mq, v_rr));
      elsif m.from_bin_id <> v_first_bin or m.to_bin_id <> v_to_id or m.quantity <> v_mq or m.batch_lot <> v_first_batch
            or m.expiry_date is distinct from v_first_exp then
        perform public.log_execution_event('TASK', m.id, 'PLANNED', 'PLANNED', format('isi dari picklist oleh %s: %s %s -> %s %s (%s): %s',
          v_name, m.quantity, (select bin_code from public.bins where id = m.to_bin_id), v_mq, v_to, (v_srcs->0->>'bin'), v_rr));
        update public.pick_tasks set from_bin_id = v_first_bin, to_bin_id = v_to_id, quantity = v_mq,
          batch_lot = v_first_batch, expiry_date = v_first_exp where id = m.id;
      end if;
      v_out := v_out || public.sheet_ensure_stock(v_first_bin, m.item_id, v_first_batch, v_first_exp, v_mq, v_note || ' Bin To Bin', v_skip, t.id is null);
      perform set_config('app.pick_bulk', 'on', true);
      perform public.post_task(m.id, null, null, null, null, null);
      perform set_config('app.pick_bulk', '', true);
    end if;
  end loop;

  -- Back to how the wave was: Tunda stays Tunda; a finished wave closes again once nothing is open.
  if v_orig = 'RESCHEDULED' then
    update public.waves set status = 'RESCHEDULED' where id = w.id;
  elsif v_orig = 'COMPLETED' and not exists (select 1 from public.pick_tasks where wave_id = w.id and status = 'PLANNED') then
    update public.waves set status = 'COMPLETED' where id = w.id;
  end if;
  perform public.log_execution_event('WAVE', w.id, v_orig, (select status::text from public.waves where id = w.id),
    format('isi dari picklist oleh %s: %s baris: %s', v_name, n_rows, v_reason));
  return jsonb_build_object('rows', n_rows, 'auto', v_out);
end $$;
revoke execute on function public.post_wave_sheet(uuid, jsonb, text, text) from public, anon;
grant execute on function public.post_wave_sheet(uuid, jsonb, text, text) to authenticated;
