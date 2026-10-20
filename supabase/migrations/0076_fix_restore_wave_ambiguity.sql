-- =====================================================================
-- 0076  Pulihkan wave: restore_wave could not run at all
--
--  0074 rewrote restore_wave to skip picks whose pallet break was already
--  completed (its defect 5). Two mistakes in that rewrite meant the function
--  raised before it could restore anything:
--
--  1. Ambiguous columns. wave_cancelled_lines() returns setof pick_tasks, so
--     the loop query's own output column `id` is visible as an outer
--     reference inside the body -- and pick_tasks, items and bins all carry
--     `id` too. Postgres answers with
--
--         ERROR: column reference "id" is ambiguous
--
--     the first time the loop body runs.
--
--  2. `skipped := skipped || s` concatenated a jsonb array with a `record`
--     variable, which has no such operator:
--
--         ERROR: operator does not exist: jsonb || record
--
--     The row has to be jsonb, as wave_restore_lines already builds it.
--
--  Together those made `Pulihkan wave` fail for EVERY cancelled wave, with or
--  without a posted pallet break. The refusal in set_task_status (0074:159)
--  is a separate path and was unaffected, which is why the wave page could
--  still *refuse* a restore while the wave-level button was dead. Test 47 is
--  the first caller -- tests 43 to 46 only cancel, and never call
--  restore_wave -- so nothing caught either mistake.
--
--  Same function, references qualified and the skipped row carried as jsonb.
--  No behaviour change: the same lines are skipped, in the same order, with
--  the same reason string.
-- =====================================================================

create or replace function public.restore_wave(p_wave_id uuid, p_by_name text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w public.waves%rowtype; v_name text; v_reason text := nullif(trim(p_reason), ''); v_lines jsonb; t record; n int := 0; skipped jsonb := '[]'::jsonb; s jsonb;
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
  -- The loop column is `l.id`, never a bare `id`: see the header.
  for t in select l.id from public.wave_cancelled_lines(w.id) l loop
    -- Defect 5: skip PICK lines whose pallet break was already completed
    if exists (select 1 from public.pick_tasks pt
               where pt.id = t.id and pt.task_type = 'PICK'
                 and public.posted_pallet_move_seq(pt.id) is not null) then
      select jsonb_build_object('task_id', pt.id, 'seq', pt.seq, 'sku', it.sku, 'bin', b.bin_code,
                                'reason', 'palet sudah dipindahkan (relokasi #' || public.posted_pallet_move_seq(pt.id) || ' diposting)')
      into s
      from public.pick_tasks pt
      join public.items it on it.id = pt.item_id
      join public.bins b on b.id = pt.from_bin_id
      where pt.id = t.id;
      skipped := skipped || s;
      continue;
    end if;
    update public.pick_tasks pt set status = 'PLANNED' where pt.id = t.id;
    perform public.log_execution_event('TASK', t.id, 'CANCELLED', 'PLANNED', format('wave dipulihkan oleh %s: %s', v_name, v_reason));
    n := n + 1;
  end loop;
  update public.outbound set status = 'PLANNED' where wave_id = w.id and status = 'CANCELLED';
  update public.waves set status = 'PENDING' where id = w.id;
  perform public.log_execution_event('WAVE', w.id, 'CANCELLED', 'PENDING', format('dipulihkan oleh %s: %s', v_name, v_reason));
  return jsonb_build_object('restored', n, 'lines', v_lines, 'skipped_pallet_breaks', skipped);
end $$;

revoke execute on function public.restore_wave(uuid, text, text) from public, anon;
grant execute on function public.restore_wave(uuid, text, text) to authenticated;
