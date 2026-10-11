-- =====================================================================
-- 0067  Paperless picking: post one line as it happened, from the phone
--
--  Pickers worked from a printed picklist that a supervisor then typed in
--  with Isi dari picklist (0057). post_pick_line posts one line at the bin
--  through the same engine, for any role, with the picker's limits:
--  a name, at most the order line, a Koreksi picklist only up to
--  adjust_approval_qty, a re-post only of one's own line while the wave runs
--  and the line is neither audited nor loaded. What needs a supervisor is
--  recorded in pick_line_requests (Perlu ditangani · Minta supervisor).
--
--  · post_wave_sheet's body is post_wave_sheet_rows (no role check, not
--    callable by clients); post_wave_sheet = supervisor check + call.
--  · Fix: a pick whose pallet rest was already moved (Posting Bin To Bin
--    saja) no longer asks the pallet to hold that rest too, which booked
--    the rest again as a Koreksi picklist (FOUND).
--  · split_task / unpost_task also accept the engine's own calls
--    (app.sheet_engine, set only inside post_wave_sheet_rows), so an
--    operator's two-bin line or own re-post works.
--  · pick_task_detail shows picked_by_name (the typed name of the posting).
-- =====================================================================

create or replace function public.post_wave_sheet_rows(p_wave_id uuid, p_rows jsonb, p_by_name text, p_reason text)
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
  -- 0067: split_task / unpost_task accept the engine's own calls (post_wave_sheet, post_pick_line).
  perform set_config('app.sheet_engine', 'on', true);
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
            (pc->>'qty')::numeric + case when i = 1 and k = 0 and v_to is not null and v_mq > 0
              and (m.id is null or m.status <> 'COMPLETED') then v_mq else 0 end, v_note, v_skip, true);
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
  perform set_config('app.sheet_engine', '', true);
  return jsonb_build_object('rows', n_rows, 'auto', v_out);
end $$;
revoke execute on function public.post_wave_sheet_rows(uuid, jsonb, text, text) from public, anon, authenticated;

create or replace function public.post_wave_sheet(p_wave_id uuid, p_rows jsonb, p_by_name text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa posting dari picklist';
  end if;
  return public.post_wave_sheet_rows(p_wave_id, p_rows, p_by_name, p_reason);
end $$;

create or replace function public.unpost_task(p_task_id uuid, p_by_name text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text; v_reason text := nullif(trim(p_reason), '');
  t public.pick_tasks%rowtype; v_wave public.waves%rowtype; v_sh text;
  v_qty numeric; v_from uuid; v_batch text; v_exp date;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[])
     and coalesce(current_setting('app.sheet_engine', true), '') <> 'on' then
    raise exception 'Hanya supervisor atau admin yang bisa membatalkan posting';
  end if;
  v_name := public.person_name(p_by_name, 'Nama Anda');
  if v_reason is null then raise exception 'Alasan batalkan posting wajib diisi'; end if;

  select * into t from public.pick_tasks where id = p_task_id for update;
  if t.id is null then raise exception 'Tugas tidak ditemukan'; end if;
  if t.status <> 'COMPLETED' then raise exception 'Tugas ini belum diposting'; end if;
  select * into v_wave from public.waves where id = t.wave_id for update;
  if v_wave.status = 'CANCELLED' then raise exception 'Wave dibatalkan: posting tidak bisa dibatalkan'; end if;
  if t.task_type = 'PICK' then
    if exists (select 1 from public.shipment_loads where wave_id = t.wave_id and shipment_number = t.shipment_number) then
      raise exception 'Shipment % sudah dimuat: posting tidak bisa dibatalkan', t.shipment_number;
    end if;
    if exists (select 1 from public.pick_audits where task_id = t.id) then
      raise exception 'Baris ini sudah diaudit picking: betulkan lewat Ubah di audit picking';
    end if;
  end if;

  v_qty := coalesce(t.actual_quantity, t.quantity);
  v_from := coalesce(t.actual_from_bin_id, t.from_bin_id);
  v_batch := coalesce(t.actual_batch_lot, t.batch_lot);
  v_exp := coalesce(t.actual_expiry_date, t.expiry_date);
  v_sh := coalesce(t.shipment_number, '-');

  perform set_config('app.by_name', v_name, true);
  if v_qty > 0 then
    if t.task_type = 'PICK' then
      -- The picked cartons go back into the bin they came from.
      perform set_config('app.adjust_reason', 'DATA_ENTRY', true);
      perform set_config('app.adjust_approved', 'on', true);
      insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, reason_code, note, ref_id)
      values ('adjustment', t.item_id, v_batch, v_qty, v_from, v_exp, 'DATA_ENTRY',
              format('Batalkan posting pick NO %s SH %s #%s: %s', v_wave.wave_no, v_sh, t.seq, v_reason), t.id);
      perform set_config('app.adjust_approved', '', true);
      perform set_config('app.adjust_reason', '', true);
    else
      -- The relocation goes back: from the pickface to the bin it left.
      insert into public.movements (type, item_id, batch_lot, quantity, from_bin_id, to_bin_id, expiry_date, note, ref_id)
      values ('transfer', t.item_id, v_batch, v_qty, t.to_bin_id, v_from, v_exp,
              format('Batalkan posting relokasi NO %s #%s: %s', v_wave.wave_no, t.seq, v_reason), t.id);
    end if;
  end if;

  update public.pick_tasks set
    status = 'PLANNED', completed_at = null, completed_by = null,
    actual_quantity = null, actual_from_bin_id = null, actual_batch_lot = null, actual_expiry_date = null,
    deviation_reason = null, picked_by_name = null, scanned_code = null, bulk_posted = false,
    post_no = post_no + 1
  where id = t.id;

  if t.task_type = 'PICK' then
    update public.outbound set quantity_picked = greatest(quantity_picked - v_qty, 0),
      status = case when status = 'COMPLETED' then 'PLANNED' else status end,
      completed_at = case when status = 'COMPLETED' then null else completed_at end
    where wave_id = t.wave_id and shipment_number = t.shipment_number and item_id = t.item_id;
  end if;
  if v_wave.status = 'COMPLETED' then
    update public.waves set status = 'PENDING' where id = v_wave.id;
    perform public.log_execution_event('WAVE', v_wave.id, 'COMPLETED', 'PENDING', format('dibuka lagi: batalkan posting #%s', t.seq));
  end if;
  perform public.log_execution_event('TASK', t.id, 'COMPLETED', 'PLANNED', format('batalkan posting oleh %s: %s', v_name, v_reason));

  return jsonb_build_object('result', 'UNPOSTED', 'task_id', t.id, 'quantity', v_qty, 'wave_reopened', v_wave.status = 'COMPLETED');
end $$;

create or replace function public.split_task(p_task_id uuid, p_keep numeric, p_by_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.pick_tasks%rowtype; w public.waves%rowtype; v_id uuid; v_name text;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[])
     and coalesce(current_setting('app.sheet_engine', true), '') <> 'on' then
    raise exception 'Hanya supervisor atau admin yang bisa memecah tugas';
  end if;
  v_name := public.person_name(p_by_name, 'Nama Anda');
  select * into t from public.pick_tasks where id = p_task_id for update;
  if t.id is null or t.task_type <> 'PICK' then raise exception 'Tugas pick tidak ditemukan'; end if;
  if t.status <> 'PLANNED' then raise exception 'Hanya tugas yang belum diposting yang bisa dipecah'; end if;
  select * into w from public.waves where id = t.wave_id for update;
  if w.status not in ('PENDING', 'RESCHEDULED') then raise exception 'Wave NO % sudah %', w.wave_no, w.status; end if;
  if p_keep is null or p_keep <= 0 or p_keep >= t.quantity then
    raise exception 'Jumlah yang tetap di tugas ini harus 1 sampai %', t.quantity - 1;
  end if;

  update public.pick_tasks set seq = seq + 1 where wave_id = t.wave_id and seq > t.seq;
  update public.pick_tasks set quantity = p_keep, breaks_pallet = false where id = t.id;
  insert into public.pick_tasks (wave_id, shipment_number, task_type, item_id, from_bin_id, to_bin_id,
                                 batch_lot, expiry_date, quantity, pick_type, breaks_pallet, seq)
  values (t.wave_id, t.shipment_number, 'PICK', t.item_id, t.from_bin_id, null,
          t.batch_lot, t.expiry_date, t.quantity - p_keep, 'CASE', false, t.seq + 1)
  returning id into v_id;
  perform public.log_execution_event('TASK', t.id, 'PLANNED', 'PLANNED',
    format('dipecah oleh %s: %s + %s', v_name, p_keep, t.quantity - p_keep));
  return jsonb_build_object('kept', p_keep, 'new_task', v_id, 'new_qty', t.quantity - p_keep, 'new_seq', t.seq + 1);
end $$;

-- The typed name of the posting, for the picking screen (own line) and Perlu ditangani.
create or replace view public.pick_task_detail with (security_invoker = true) as
select t.id, t.wave_id, w.wave_no, w.planned_date, w.planned_slot, w.status as wave_status,
       t.shipment_number, t.task_type, t.seq, t.status,
       it.sku, it.description, it.uom, it.upp,
       fb.bin_code as from_bin, tb.bin_code as to_bin,
       t.batch_lot, t.expiry_date, t.quantity, t.pick_type, t.breaks_pallet,
       t.completed_at, p.name as completed_by_name,
       t.actual_quantity, ab.bin_code as actual_from_bin, t.actual_batch_lot, t.actual_expiry_date,
       t.deviation_reason, t.picked_by_name
from public.pick_tasks t
join public.waves w on w.id = t.wave_id
join public.items it on it.id = t.item_id
join public.bins fb on fb.id = t.from_bin_id
left join public.bins tb on tb.id = t.to_bin_id
left join public.profiles p on p.id = t.completed_by
left join public.bins ab on ab.id = t.actual_from_bin_id;

-- ---------------------------------------------------------------------
-- Minta supervisor: a picker's line that needs a supervisor (0067)
-- ---------------------------------------------------------------------
create table public.pick_line_requests (
  id             uuid primary key default gen_random_uuid(),
  wave_id        uuid not null references public.waves(id) on delete cascade,
  pick_id        uuid references public.pick_tasks(id) on delete cascade,
  move_id        uuid references public.pick_tasks(id) on delete cascade,
  row            jsonb not null,
  by_name        text not null,
  kind           text not null check (kind in ('correction_over_limit', 'other_picker', 'audited', 'loaded', 'wave_not_pending')),
  message        text not null,
  -- The line as it was when refused: it drops off the open list once posted (again) after that.
  task_post_no   int not null,
  task_was_done  boolean not null,
  created_at     timestamptz not null default now(),
  status         text not null default 'OPEN' check (status in ('OPEN', 'CLOSED')),
  closed_by_name text,
  closed_at      timestamptz,
  close_note     text
);
create index pick_line_requests_open_idx on public.pick_line_requests (wave_id, created_at) where status = 'OPEN';
alter table public.pick_line_requests enable row level security;
create policy "pick_line_requests: read" on public.pick_line_requests for select to authenticated using (true);
grant select on public.pick_line_requests to authenticated;

-- Open requests whose line has not been posted (again) since: a supervisor posting it makes it drop off.
-- Compared on the task's posting counter, not on time (one transaction has one now()).
create or replace view public.pick_line_requests_open with (security_invoker = true) as
select r.*, w.wave_no, w.planned_date, t.seq, t.shipment_number, it.sku, it.description, it.uom, fb.bin_code as from_bin
from public.pick_line_requests r
join public.waves w on w.id = r.wave_id
left join public.pick_tasks t on t.id = coalesce(r.pick_id, r.move_id)
left join public.items it on it.id = t.item_id
left join public.bins fb on fb.id = t.from_bin_id
where r.status = 'OPEN' and w.status <> 'CANCELLED'
  and not (t.status = 'COMPLETED' and (not r.task_was_done or t.post_no > r.task_post_no));
grant select on public.pick_line_requests_open to authenticated;

create or replace function public.close_pick_line_request(p_id uuid, p_by_name text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa menutup permintaan';
  end if;
  v_name := public.person_name(p_by_name, 'Nama Anda');
  if nullif(trim(p_note), '') is null then raise exception 'Catatan wajib diisi'; end if;
  update public.pick_line_requests set status = 'CLOSED', closed_by_name = v_name, closed_at = now(), close_note = trim(p_note)
  where id = p_id and status = 'OPEN';
  if not found then raise exception 'Permintaan tidak ada atau sudah ditutup'; end if;
end $$;
revoke execute on function public.close_pick_line_request(uuid, text, text) from public, anon;
grant execute on function public.close_pick_line_request(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- post_pick_line: one line from the picking screen, any role (0067)
-- ---------------------------------------------------------------------
-- The first source of a row exactly as post_wave_sheet_rows reads it: 0-cartons sources are dropped only when
-- there are several (all 0 keeps the first); bin upper(trim), batch coalesce(trim, ''), expiry nullif(.., '')::date.
create or replace function public.pick_line_first_source(p_row jsonb)
returns table (bin_code text, batch text, expiry date) language sql immutable as $$
  select upper(trim(x.s->>'bin')), coalesce(trim(x.s->>'batch'), ''), nullif(x.s->>'expiry', '')::date
  from jsonb_array_elements(coalesce(p_row->'sources', '[]'::jsonb)) with ordinality as x(s, n)
  order by (jsonb_array_length(p_row->'sources') > 1 and coalesce((x.s->>'qty')::numeric, 0) <= 0), x.n
  limit 1
$$;

create or replace function public.post_pick_line(p_wave_id uuid, p_row jsonb, p_by_name text, p_reason text, p_scanned text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text; w public.waves%rowtype; t public.pick_tasks%rowtype; m public.pick_tasks%rowtype;
  v_total numeric; v_sku text; v_ean text; v_scan_sku text;
  v_limit numeric := coalesce((public.inventory_policy()->>'adjust_approval_qty')::numeric, 20);
  v_unchanged boolean := false; v_fbin text; v_fbatch text; v_fexp date;
  v_kind text; v_msg text; v_res jsonb; c jsonb; v_req uuid; v_corr int := 0;
begin
  if not public.has_role(array['operator','supervisor','admin']::public.user_role[]) then
    raise exception 'Masuk dulu untuk posting';
  end if;
  v_name := public.person_name(p_by_name, 'Nama picker');
  -- Lock first: two pickers posting the same line are decided one after the other (the engine re-locks the row).
  select * into w from public.waves where id = p_wave_id for update;
  if w.id is null then raise exception 'Wave tidak ditemukan'; end if;
  if nullif(p_row->>'pick_id', '') is not null then
    select * into t from public.pick_tasks where id = (p_row->>'pick_id')::uuid;
    if t.id is null or t.wave_id <> w.id or t.task_type <> 'PICK' then raise exception 'Baris ini bukan pick wave NO %', w.wave_no; end if;
  end if;
  if nullif(p_row->>'move_id', '') is not null then
    select * into m from public.pick_tasks where id = (p_row->>'move_id')::uuid;
    if m.id is null or m.wave_id <> w.id or m.task_type = 'PICK' then raise exception 'Bin To Bin ini bukan milik wave NO %', w.wave_no; end if;
  end if;
  if t.id is null and m.id is null then raise exception 'Baris tanpa tugas'; end if;
  if t.id is not null and m.id is not null and not (m.item_id = t.item_id
      and m.batch_lot is not distinct from t.batch_lot and m.from_bin_id = t.from_bin_id) then
    raise exception 'Bin To Bin ini bukan milik baris ini';
  end if;

  -- Input the picker fixes on the card: never recorded.
  select coalesce(sum(coalesce((s->>'qty')::numeric, 0)), 0) into v_total
  from jsonb_array_elements(coalesce(p_row->'sources', '[]'::jsonb)) s;
  if t.id is not null and v_total > t.quantity then
    raise exception 'Lebih dari order: paling banyak % untuk baris ini', t.quantity;
  end if;
  if t.id is not null then
    select sku, ean into v_sku, v_ean from public.items where id = t.item_id;
    if nullif(trim(p_scanned), '') is not null then
      select sku into v_scan_sku from public.item_by_barcode(p_scanned) limit 1;
      if v_scan_sku is null then raise exception 'Barcode % tidak dikenal di master item', trim(p_scanned); end if;
      if v_scan_sku <> v_sku then raise exception 'Barang salah: yang di-scan SKU %, baris ini SKU %', v_scan_sku, v_sku; end if;
    elsif t.status = 'PLANNED' and v_ean is not null and coalesce((public.inventory_policy()->>'require_scan_on_pick')::boolean, false) then
      raise exception 'Scan barcode SKU % dulu (atau ketik SKU-nya)', v_sku;
    end if;
  end if;

  -- What only a supervisor may do: recorded, nothing posted.
  if w.status <> 'PENDING' then
    v_kind := 'wave_not_pending';
    v_msg := format('Wave NO %s sedang %s: minta supervisor', w.wave_no,
                    case w.status when 'RESCHEDULED' then 'Tunda' when 'COMPLETED' then 'selesai' else 'dibatalkan' end);
  elsif t.status = 'COMPLETED' or m.status = 'COMPLETED' then
    -- An open pick may be posted next to another picker's completed move as long as the row leaves that move as posted.
    if t.id is not null and t.status <> 'COMPLETED' and m.status = 'COMPLETED' then
      -- Mirrors the engine's v_same. The row is read the way the engine reads it (pick_line_first_source, move_to, move_qty).
      -- The batch is compared as written, not as the engine maps it to the bin's own: that errs toward refusing.
      select f.bin_code, f.batch, f.expiry into v_fbin, v_fbatch, v_fexp from public.pick_line_first_source(p_row) f;
      v_unchanged := v_fbin is not null
        and nullif(upper(trim(coalesce(p_row->>'move_to', ''))), '') = (select bin_code from public.bins where id = m.to_bin_id)
        and coalesce((p_row->>'move_qty')::numeric, 0) = coalesce(m.actual_quantity, m.quantity)
        and v_fbin = (select bin_code from public.bins where id = coalesce(m.actual_from_bin_id, m.from_bin_id))
        and v_fbatch = coalesce(m.actual_batch_lot, m.batch_lot, '')
        and v_fexp is not distinct from coalesce(m.actual_expiry_date, m.expiry_date);
    end if;
    if t.status = 'COMPLETED' and not public.same_person(t.picked_by_name, v_name) then
      v_kind := 'other_picker';
      v_msg := format('Baris ini diposting oleh %s: minta supervisor', coalesce(t.picked_by_name, 'orang lain'));
    elsif m.status = 'COMPLETED' and not public.same_person(m.picked_by_name, v_name) and not v_unchanged then
      v_kind := 'other_picker';
      v_msg := format('Bin To Bin baris ini diposting oleh %s: minta supervisor', coalesce(m.picked_by_name, 'orang lain'));
    elsif t.status = 'COMPLETED' and exists (select 1 from public.pick_audits where task_id = t.id) then
      v_kind := 'audited';
      v_msg := 'Baris ini sudah diaudit picking: minta supervisor';
    elsif t.status = 'COMPLETED' and exists (select 1 from public.shipment_loads where wave_id = t.wave_id and shipment_number = t.shipment_number) then
      v_kind := 'loaded';
      v_msg := format('Shipment %s sudah dimuat: minta supervisor', t.shipment_number);
    end if;
  end if;

  if v_kind is null then
    begin
      v_res := public.post_wave_sheet_rows(p_wave_id, jsonb_build_array(p_row), v_name,
                                           coalesce(nullif(trim(p_reason), ''), 'picking'));
      for c in select e from jsonb_array_elements(coalesce(v_res->'auto', '[]'::jsonb)) e where e->>'kind' = 'correction' loop
        v_corr := v_corr + 1;
        if (c->>'qty')::numeric > v_limit then
          v_kind := 'correction_over_limit';
          v_msg := format('Sistem hanya punya %s di %s untuk SKU %s batch %s, diambil %s: minta supervisor',
                          c->>'had', c->>'bin', c->>'sku', coalesce(nullif(c->>'batch', ''), '–'),
                          (c->>'had')::numeric + (c->>'qty')::numeric);
          raise exception using errcode = 'PL001', message = v_msg;
        end if;
      end loop;
    exception when sqlstate 'PL001' then
      v_res := null;  -- the savepoint rolled the whole line back; v_kind / v_msg stay set
    end;
  end if;

  if v_kind is not null then
    -- One open request per line: a retry updates it.
    update public.pick_line_requests set row = p_row, by_name = v_name, kind = v_kind, message = v_msg, created_at = now(),
      task_post_no = coalesce(t.post_no, m.post_no), task_was_done = coalesce(t.status, m.status) = 'COMPLETED'
    where status = 'OPEN' and pick_id is not distinct from t.id and move_id is not distinct from m.id
    returning id into v_req;
    if v_req is null then
      insert into public.pick_line_requests (wave_id, pick_id, move_id, row, by_name, kind, message, task_post_no, task_was_done)
      values (w.id, t.id, m.id, p_row, v_name, v_kind, v_msg, coalesce(t.post_no, m.post_no), coalesce(t.status, m.status) = 'COMPLETED')
      returning id into v_req;
    end if;
    return jsonb_build_object('result', 'refused', 'kind', v_kind, 'message', v_msg, 'request_id', v_req);
  end if;

  return jsonb_build_object('result', 'posted', 'posted_by', v_name, 'corrections', v_corr,
                            'auto', v_res->'auto', 'rows', v_res->'rows');
end $$;
revoke execute on function public.post_pick_line(uuid, jsonb, text, text, text) from public, anon;
grant execute on function public.post_pick_line(uuid, jsonb, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- The engine's own adjustments (Koreksi picklist, undo of a posting) are made for
-- an operator's line too: the role check yields to app.sheet_engine, which only
-- post_wave_sheet_rows sets. Everything else in the guard is unchanged.
-- ---------------------------------------------------------------------
create or replace function public.guard_adjustment_policy()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_limit numeric;
begin
  new.reason_code := coalesce(new.reason_code, nullif(current_setting('app.adjust_reason', true), ''));
  new.by_name := coalesce(nullif(trim(new.by_name), ''), nullif(current_setting('app.by_name', true), ''));
  if new.type <> 'adjustment' or auth.uid() is null then return new; end if;

  if not public.has_role(array['supervisor','admin']::public.user_role[])
     and coalesce(current_setting('app.sheet_engine', true), '') <> 'on' then
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
revoke execute on function public.guard_adjustment_policy() from public, anon, authenticated;

-- apply_movement (0017) with the same yield to the engine for its adjustments; nothing else changed.
create or replace function public.apply_movement()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  src public.inventory%rowtype;
  n_rows int;
  v_exp date := new.expiry_date;
  v_rec date := coalesce(new.received_date, current_date);
  v_to_status public.bin_status;
  v_to_zone text;
  v_from_zone text;
begin
  -- Force the author to be the caller (seed/import from SQL editor have no auth.uid()).
  if auth.uid() is not null then new.user_id := auth.uid(); end if;

  -- Adjustments are supervisor/admin only (defence in depth; RLS checks too).
  if new.type = 'adjustment' and auth.uid() is not null
     and not public.has_role(array['supervisor','admin']::public.user_role[])
     and coalesce(current_setting('app.sheet_engine', true), '') <> 'on' then
    raise exception 'Only supervisors or admins can post adjustments';
  end if;

  -- Quarantine is blocked for picking but is where held / damaged stock goes:
  -- supervisors may move stock in; nothing is ever picked out of it.
  if new.to_bin_id is not null and new.type <> 'adjustment' then
    select status, zone into v_to_status, v_to_zone from public.bins where id = new.to_bin_id;
    if v_to_zone = 'QUARANTINE' then
      if auth.uid() is not null and not public.has_role(array['supervisor','admin']::public.user_role[]) then
        raise exception 'Hanya supervisor atau admin yang bisa memindahkan stok ke karantina';
      end if;
    elsif v_to_status = 'blocked' then
      raise exception 'Destination bin is blocked';
    end if;
  end if;
  if new.type = 'picking' and new.from_bin_id is not null then
    select zone into v_from_zone from public.bins where id = new.from_bin_id;
    if v_from_zone = 'QUARANTINE' then raise exception 'Stok karantina tidak boleh dipick'; end if;
  end if;

  -- 1) Take stock out of the source bin (picking, transfer, putaway from staging).
  if new.from_bin_id is not null then
    select count(*) into n_rows from public.inventory
      where bin_id = new.from_bin_id and item_id = new.item_id and batch_lot = new.batch_lot
        and (new.expiry_date is null or expiry_date = new.expiry_date);
    if n_rows > 1 then
      raise exception 'Batch % has several expiry dates in this bin; specify the expiry date', new.batch_lot;
    end if;
    select * into src from public.inventory
      where bin_id = new.from_bin_id and item_id = new.item_id and batch_lot = new.batch_lot
        and (new.expiry_date is null or expiry_date = new.expiry_date)
      for update;
    if not found or src.quantity < new.quantity then
      raise exception 'Insufficient stock in source bin (available %, requested %)',
        coalesce(src.quantity, 0), new.quantity;
    end if;
    if src.quantity = new.quantity then
      delete from public.inventory where id = src.id;
    else
      update public.inventory set quantity = quantity - new.quantity, updated_at = now() where id = src.id;
    end if;
    -- Moved stock keeps its original dates (FEFO depends on it).
    v_exp := src.expiry_date;
    v_rec := coalesce(src.received_date, v_rec);
    new.expiry_date := src.expiry_date;
  end if;

  -- 2) Put stock into the destination bin.
  if new.type in ('inbound','putaway','transfer') then
    if new.type in ('inbound','putaway') and new.from_bin_id is null and v_exp is null then
      raise exception 'Expiry date is required when receiving stock';
    end if;
    insert into public.inventory (bin_id, item_id, batch_lot, quantity, expiry_date, received_date)
    values (new.to_bin_id, new.item_id, new.batch_lot, new.quantity, v_exp, v_rec)
    on conflict (bin_id, item_id, batch_lot, (coalesce(expiry_date, 'infinity'::date)))
    do update set quantity = public.inventory.quantity + excluded.quantity, updated_at = now();

  elsif new.type = 'adjustment' then
    -- Signed correction on to_bin. Creates the row for opening balances / found stock.
    -- Exact identity match first. Without an expiry, fall back to the batch's
    -- only row in this bin (the pre-expiry-identity behaviour); ambiguous if
    -- the batch has several expiry dates here.
    select * into src from public.inventory
      where bin_id = new.to_bin_id and item_id = new.item_id and batch_lot = new.batch_lot
        and expiry_date is not distinct from new.expiry_date
      for update;
    if not found and new.expiry_date is null then
      select count(*) into n_rows from public.inventory
        where bin_id = new.to_bin_id and item_id = new.item_id and batch_lot = new.batch_lot;
      if n_rows > 1 then
        raise exception 'Batch % has several expiry dates in this bin; specify the expiry date', new.batch_lot;
      end if;
      select * into src from public.inventory
        where bin_id = new.to_bin_id and item_id = new.item_id and batch_lot = new.batch_lot
        for update;
    end if;
    if src.id is null then
      if new.quantity < 0 then raise exception 'Cannot adjust below zero: no stock of this batch in bin'; end if;
      insert into public.inventory (bin_id, item_id, batch_lot, quantity, expiry_date, received_date)
      values (new.to_bin_id, new.item_id, new.batch_lot, new.quantity, new.expiry_date, new.received_date);
    elsif src.quantity + new.quantity < 0 then
      raise exception 'Adjustment would make stock negative (current %)', src.quantity;
    elsif src.quantity + new.quantity = 0 then
      delete from public.inventory where id = src.id;
    else
      update public.inventory set quantity = quantity + new.quantity, updated_at = now()
      where id = src.id;
    end if;
    -- The ledger row records the identity it actually changed.
    new.expiry_date := coalesce(new.expiry_date, src.expiry_date);
  end if;

  return new;
end $$;

