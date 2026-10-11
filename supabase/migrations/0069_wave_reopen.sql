-- =====================================================================
-- 0069  Undo a finished or cancelled wave
--
--  A supervisor who cancelled or finished a wave by mistake had no way back
--  (set_wave_status refuses a finished or cancelled wave). Both can now be
--  undone, with Remain Qty exact:
--  · restore_wave: the lines the wave cancel cancelled go back to the plan
--    (a line cancelled on its own stays cancelled). No movement at all.
--  · reopen_wave: the wave runs again; optionally the lines Selesaikan wave
--    posted in bulk are unposted through unpost_task (stock back to exactly
--    the bin, batch and expiry it left). Lines picked one by one or entered
--    with Isi dari picklist stay posted. Refused when a shipment is loaded
--    or a bulk line is audited; any refusal changes nothing.
--  · pick_tasks.bulk_source records which bulk action posted a line
--    (selesaikan / sheet). Every completion overwrites it, so a line posted
--    again by a person is never bulk again.
-- =====================================================================

alter table public.pick_tasks add column bulk_source text check (bulk_source in ('selesaikan', 'sheet'));

-- stamp_pick_confirmation (0068) + bulk_source, overwritten on every completion.
create or replace function public.stamp_pick_confirmation()
returns trigger language plpgsql as $$
declare v_scan text;
begin
  if new.status = 'COMPLETED' and old.status is distinct from 'COMPLETED' then
    new.picked_by_name := coalesce(nullif(trim(new.picked_by_name), ''), nullif(current_setting('app.by_name', true), ''));
    -- 0068: post_task sets actual_from_bin_id in this same UPDATE, so the bin it really left from is known here.
    v_scan := nullif(upper(regexp_replace(coalesce(current_setting('app.pick_scanned', true), ''), '\s', '', 'g')), '');
    if v_scan is distinct from (select b.bin_code from public.bins b where b.id = coalesce(new.actual_from_bin_id, new.from_bin_id)) then
      v_scan := null;
    end if;
    new.scanned_code := coalesce(new.scanned_code, v_scan);
    -- 0068: how the bin was confirmed (scan / ketik), only with the confirmation it belongs to.
    if v_scan is not null and new.scanned_code = v_scan then
      new.scan_method := coalesce(new.scan_method, nullif(current_setting('app.pick_scan_method', true), ''));
    end if;
    new.bulk_posted := new.bulk_posted or coalesce(current_setting('app.pick_bulk', true), '') = 'on';
    -- 0069: which bulk action posted it; a posting by a person clears it.
    new.bulk_source := nullif(current_setting('app.pick_bulk_source', true), '');
  end if;
  return new;
end $$;

-- complete_wave_by (0024) + bulk_source 'selesaikan'.
create or replace function public.complete_wave_by(p_wave_id uuid, p_by_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_res jsonb;
begin
  perform set_config('app.by_name', public.person_name(p_by_name), true);
  perform set_config('app.pick_scanned', '', true);
  perform set_config('app.pick_bulk', 'on', true);
  perform set_config('app.pick_bulk_source', 'selesaikan', true);
  v_res := public.complete_wave(p_wave_id);
  perform set_config('app.pick_bulk', '', true);
  perform set_config('app.pick_bulk_source', '', true);
  return v_res;
end $$;

-- post_wave_sheet (0067) + bulk_source 'sheet'. post_pick_line calls the engine directly and sets nothing.
create or replace function public.post_wave_sheet(p_wave_id uuid, p_rows jsonb, p_by_name text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_res jsonb;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa posting dari picklist';
  end if;
  perform set_config('app.pick_bulk_source', 'sheet', true);
  v_res := public.post_wave_sheet_rows(p_wave_id, p_rows, p_by_name, p_reason);
  perform set_config('app.pick_bulk_source', '', true);
  return v_res;
end $$;

-- The lines Selesaikan wave posted in bulk. Lines posted before 0069 have no bulk_source: they are the
-- bulk lines completed in the same transaction as the wave's last finish (complete_wave posts and logs
-- under one now()).
create or replace function public.wave_bulk_lines(p_wave_id uuid)
returns setof public.pick_tasks language sql stable security definer set search_path = public as $$
  select t.* from public.pick_tasks t
  where t.wave_id = p_wave_id and t.status = 'COMPLETED'
    and (t.bulk_source = 'selesaikan'
         or (t.bulk_source is null and t.bulk_posted and t.completed_at = (
               select max(e.occurred_at) from public.execution_events e
               where e.entity_type = 'WAVE' and e.entity_id = p_wave_id and e.to_status = 'COMPLETED')))
  order by t.seq;
$$;
revoke execute on function public.wave_bulk_lines(uuid) from public, anon, authenticated;

-- The lines a wave cancel cancelled: cancelled, and their own last task event is not a cancel
-- (a line cancelled on its own, or a move cancelled by Isi dari picklist, has its own event).
create or replace function public.wave_cancelled_lines(p_wave_id uuid)
returns setof public.pick_tasks language sql stable security definer set search_path = public as $$
  select t.* from public.pick_tasks t
  where t.wave_id = p_wave_id and t.status = 'CANCELLED'
    and coalesce((select e.to_status from public.execution_events e
                  where e.entity_type = 'TASK' and e.entity_id = t.id
                  order by e.occurred_at desc, e.id desc limit 1), '') <> 'CANCELLED'
  order by t.seq;
$$;
revoke execute on function public.wave_cancelled_lines(uuid) from public, anon, authenticated;

-- One line of a restore: is it still covered by its bin, net of the other open tasks on that stock?
create or replace function public.wave_restore_lines(p_wave_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'task_id', t.id, 'seq', t.seq, 'task_type', t.task_type, 'sku', it.sku, 'bin', b.bin_code,
           'batch_lot', t.batch_lot, 'quantity', t.quantity, 'free', f.free, 'covered', f.free >= t.quantity) order by t.seq), '[]'::jsonb)
  from public.wave_cancelled_lines(p_wave_id) t
  join public.items it on it.id = t.item_id
  join public.bins b on b.id = t.from_bin_id
  cross join lateral (
    select public.sheet_have(t.from_bin_id, t.item_id, t.batch_lot, t.expiry_date)
         - coalesce((select sum(o.quantity) from public.open_pick_tasks o
                     where o.from_bin_id = t.from_bin_id and o.item_id = t.item_id and o.batch_lot = t.batch_lot
                       and o.expiry_date is not distinct from t.expiry_date), 0) as free) f;
$$;
revoke execute on function public.wave_restore_lines(uuid) from public, anon, authenticated;

create or replace function public.restore_wave_preview(p_wave_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare w public.waves%rowtype;
begin
  select * into w from public.waves where id = p_wave_id;
  if w.id is null then raise exception 'Wave tidak ditemukan'; end if;
  if w.status <> 'CANCELLED' then raise exception 'Wave NO % tidak dibatalkan', w.wave_no; end if;
  return jsonb_build_object('wave_no', w.wave_no, 'lines', public.wave_restore_lines(w.id));
end $$;

create or replace function public.restore_wave(p_wave_id uuid, p_by_name text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w public.waves%rowtype; v_name text; v_reason text := nullif(trim(p_reason), ''); v_lines jsonb; t record; n int := 0;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa memulihkan wave';
  end if;
  v_name := public.person_name(p_by_name, 'Nama Anda');
  if v_reason is null then raise exception 'Alasan wajib diisi'; end if;
  select * into w from public.waves where id = p_wave_id for update;
  if w.id is null then raise exception 'Wave tidak ditemukan'; end if;
  if w.status <> 'CANCELLED' then raise exception 'Wave NO % tidak dibatalkan', w.wave_no; end if;

  v_lines := public.wave_restore_lines(w.id);
  for t in select id from public.wave_cancelled_lines(w.id) loop
    update public.pick_tasks set status = 'PLANNED' where id = t.id;
    perform public.log_execution_event('TASK', t.id, 'CANCELLED', 'PLANNED', format('wave dipulihkan oleh %s: %s', v_name, v_reason));
    n := n + 1;
  end loop;
  update public.outbound set status = 'PLANNED' where wave_id = w.id and status = 'CANCELLED';
  update public.waves set status = 'PENDING' where id = w.id;
  perform public.log_execution_event('WAVE', w.id, 'CANCELLED', 'PENDING', format('dipulihkan oleh %s: %s', v_name, v_reason));
  return jsonb_build_object('restored', n, 'lines', v_lines);
end $$;

create or replace function public.reopen_wave_preview(p_wave_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare w public.waves%rowtype;
begin
  select * into w from public.waves where id = p_wave_id;
  if w.id is null then raise exception 'Wave tidak ditemukan'; end if;
  if w.status <> 'COMPLETED' then raise exception 'Wave NO % belum selesai', w.wave_no; end if;
  return jsonb_build_object(
    'wave_no', w.wave_no,
    'loaded', coalesce((select jsonb_agg(l.shipment_number order by l.shipment_number) from public.shipment_loads l where l.wave_id = w.id), '[]'::jsonb),
    'bulk', coalesce((select jsonb_agg(jsonb_build_object(
               'task_id', t.id, 'seq', t.seq, 'task_type', t.task_type, 'sku', it.sku,
               'bin', b.bin_code, 'to_bin', tb.bin_code, 'quantity', coalesce(t.actual_quantity, t.quantity),
               'audited', exists (select 1 from public.pick_audits a where a.task_id = t.id)) order by t.seq)
             from public.wave_bulk_lines(w.id) t
             join public.items it on it.id = t.item_id
             join public.bins b on b.id = coalesce(t.actual_from_bin_id, t.from_bin_id)
             left join public.bins tb on tb.id = t.to_bin_id), '[]'::jsonb));
end $$;

create or replace function public.reopen_wave(p_wave_id uuid, p_by_name text, p_reason text, p_undo_bulk boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w public.waves%rowtype; v_name text; v_reason text := nullif(trim(p_reason), ''); v_loaded text; v_seq int; t record; n int := 0;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa membuka lagi wave';
  end if;
  v_name := public.person_name(p_by_name, 'Nama Anda');
  if v_reason is null then raise exception 'Alasan wajib diisi'; end if;
  select * into w from public.waves where id = p_wave_id for update;
  if w.id is null then raise exception 'Wave tidak ditemukan'; end if;
  if w.status <> 'COMPLETED' then raise exception 'Wave NO % belum selesai', w.wave_no; end if;
  select string_agg(l.shipment_number, ', ' order by l.shipment_number) into v_loaded from public.shipment_loads l where l.wave_id = w.id;
  if v_loaded is not null then
    raise exception 'Shipment % sudah dimuat: wave tidak bisa dibuka lagi', v_loaded;
  end if;

  if coalesce(p_undo_bulk, false) then
    select bl.seq into v_seq from public.wave_bulk_lines(w.id) bl
    where bl.task_type = 'PICK' and exists (select 1 from public.pick_audits a where a.task_id = bl.id)
    order by bl.seq limit 1;
    if v_seq is not null then raise exception 'Baris #% sudah diaudit: batalkan lewat audit dulu', v_seq; end if;
    -- Later picks before the moves that fed them: a move is sent back only after its pickface's picks returned.
    for t in select b.id from public.wave_bulk_lines(w.id) b order by b.seq desc loop
      perform public.unpost_task(t.id, v_name, 'buka lagi: ' || v_reason);
      n := n + 1;
    end loop;
  end if;

  update public.outbound set status = 'PLANNED', completed_at = null where wave_id = w.id and status = 'COMPLETED';
  update public.waves set status = 'PENDING' where id = w.id and status <> 'PENDING';
  perform public.log_execution_event('WAVE', w.id, 'COMPLETED', 'PENDING',
    format('dibuka lagi oleh %s: %s%s', v_name, v_reason, case when n > 0 then format(' (%s baris massal dibatalkan)', n) else '' end));
  return jsonb_build_object('reopened', true, 'undone', n);
end $$;

revoke execute on function public.restore_wave_preview(uuid), public.restore_wave(uuid, text, text),
  public.reopen_wave_preview(uuid), public.reopen_wave(uuid, text, text, boolean) from public, anon;
grant execute on function public.restore_wave_preview(uuid), public.restore_wave(uuid, text, text),
  public.reopen_wave_preview(uuid), public.reopen_wave(uuid, text, text, boolean) to authenticated;
