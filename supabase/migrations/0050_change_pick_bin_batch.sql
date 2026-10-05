-- =====================================================================
-- 0050  Ubah Bin Pick follows batch and expiry
--
--  2 Oct: two re-points landed in stok kurang. CE08A01: a pick (batch
--  29E26JJ exp 2030-03-05) was re-pointed into a bin holding that batch
--  exp 2030-05-29 — change_pick_bin (0049) keeps batch/expiry by design,
--  and task_shortfalls matches bin + SKU + batch + expiry, so the pick
--  saw physical 0. CE17E02: re-pointed into a bin holding nothing of the
--  SKU at all. The function now takes optional batch/expiry (defaults
--  keep 0049 behaviour exactly, so old 4-argument calls keep working)
--  and refuses a target bin that does not hold the resulting identity,
--  naming what was asked instead of failing silently into a shortfall.
-- =====================================================================

drop function if exists public.change_pick_bin(uuid, text, text, text);

create or replace function public.change_pick_bin(
  p_task_id uuid, p_from_bin text, p_by_name text, p_reason text default null,
  p_batch_lot text default null, p_expiry_date date default null,
  p_follow_move boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t public.pick_tasks%rowtype; w public.waves%rowtype; v_to public.bins%rowtype;
  m public.pick_tasks%rowtype; v_old text; v_move_from text; v_name text;
  v_old_batch text; v_old_exp date; v_batch text; v_exp date; v_have numeric; v_extra text;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa mengubah bin pick';
  end if;
  v_name := public.person_name(p_by_name, 'Nama Anda');
  select * into t from public.pick_tasks where id = p_task_id for update;
  if t.id is null or t.task_type <> 'PICK' then raise exception 'Tugas pick tidak ditemukan'; end if;
  if t.status <> 'PLANNED' then raise exception 'Hanya tugas yang belum diposting yang bisa diubah binnya'; end if;
  select * into w from public.waves where id = t.wave_id for update;
  if w.status not in ('PENDING', 'RESCHEDULED') then raise exception 'Wave NO % sudah %', w.wave_no, w.status; end if;
  select * into v_to from public.bins where bin_code = upper(trim(p_from_bin));
  if v_to.id is null then raise exception 'Bin % tidak ada', p_from_bin; end if;
  if v_to.status = 'blocked' then raise exception 'Bin % diblokir', v_to.bin_code; end if;
  if v_to.id = t.from_bin_id then raise exception 'Bin % sama dengan bin rencana saat ini', v_to.bin_code; end if;
  select bin_code into v_old from public.bins where id = t.from_bin_id;

  -- The pick's current identity; explicit params win, otherwise it is kept.
  v_old_batch := coalesce(t.actual_batch_lot, t.batch_lot);
  v_old_exp := coalesce(t.actual_expiry_date, t.expiry_date);
  v_batch := coalesce(nullif(trim(p_batch_lot), ''), v_old_batch);
  v_exp := coalesce(p_expiry_date, v_old_exp);

  -- The move add_relocation (0045) put next to this pick: its source IS the
  -- pick's source, so it travels along. Only the move the wave page pairs
  -- may travel — pairMoves pairs neighbours only, so the lookup is limited
  -- to seq directly beside the pick. Without this, re-pointing one of two
  -- picks sharing a source bin steals the other's move. Matched on the OLD
  -- identity, before the rewrite below. The wave page passes p_follow_move
  -- false for a pick it shows without a paired move.
  if p_follow_move then
    select * into m from public.pick_tasks
     where wave_id = t.wave_id and task_type = 'REPLENISH' and status = 'PLANNED'
       and from_bin_id = t.from_bin_id and item_id = t.item_id
       and batch_lot = v_old_batch
       and seq in (t.seq - 1, t.seq + 1)
     order by seq limit 1 for update;
  end if;
  if m.id is not null then
    -- pick_task_bins (0004): a REPLENISH row needs to_bin_id <> from_bin_id,
    -- so re-pointing into the move's own destination would blow up the UPDATE.
    if v_to.id = m.to_bin_id then raise exception 'Bin % sama dengan tujuan Bin To Bin-nya', v_to.bin_code; end if;
    select bin_code into v_move_from from public.bins where id = m.from_bin_id;
  end if;

  -- The new bin must actually hold the resulting identity, or the pick lands
  -- in stok kurang (task_shortfalls matches bin + SKU + batch + expiry).
  select coalesce(sum(quantity), 0) into v_have from public.inventory
   where bin_id = v_to.id and item_id = t.item_id and batch_lot = v_batch
     and expiry_date is not distinct from v_exp;
  if v_have <= 0 then
    raise exception 'Bin % tidak menyimpan batch % exp %', v_to.bin_code, v_batch, v_exp;
  end if;

  update public.pick_tasks set from_bin_id = v_to.id, batch_lot = v_batch, expiry_date = v_exp where id = t.id;
  -- One open move per (bin, item, batch) per wave. Checked after the pick has
  -- re-pointed and before the move does, so the pair itself never trips it.
  if exists (select 1 from public.pick_tasks x where x.wave_id = t.wave_id and x.task_type <> 'PICK' and x.status = 'PLANNED'
             and x.from_bin_id = v_to.id and x.item_id = t.item_id and x.batch_lot = v_batch) then
    raise exception 'Sudah ada Bin To Bin terbuka dari bin ini di wave NO %', w.wave_no;
  end if;
  if m.id is not null then
    update public.pick_tasks set from_bin_id = v_to.id, batch_lot = v_batch, expiry_date = v_exp where id = m.id;
  end if;

  v_extra := case when v_batch is distinct from v_old_batch or v_exp is distinct from v_old_exp
    then format(' batch %s exp %s', v_batch, v_exp) else '' end;
  perform public.log_execution_event('TASK', t.id, 'PLANNED', 'PLANNED',
    format('bin pick diubah oleh %s: %s → %s%s%s', v_name, v_old, v_to.bin_code, v_extra,
           coalesce(': ' || nullif(trim(p_reason), ''), '')));
  return jsonb_build_object('task_id', t.id, 'from_bin', v_old, 'to_bin', v_to.bin_code,
                            'batch_lot', v_batch, 'expiry_date', v_exp,
                            'move_id', m.id, 'move_from_bin', v_move_from);
end $$;
revoke execute on function public.change_pick_bin(uuid, text, text, text, text, date, boolean) from public, anon;
grant execute on function public.change_pick_bin(uuid, text, text, text, text, date, boolean) to authenticated;
