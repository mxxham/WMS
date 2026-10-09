-- =====================================================================
-- 0063  Ikut palet: later picks follow a Bin To Bin to the bin it really went to
--
--  30 Sep NO 8 #1: pallet CD39E02, 6 picked, the rest 38 planned to pickface
--  CC34A02. CC34A02 was full, so the picker put the 38 in CC33A02, and the
--  move was changed and posted that way (0047 / 0052 / 0056 / the paper).
--  Later waves had been planned to pick those cartons from CC34A02. They kept
--  pointing there: "menunggu Bin To Bin" for a move that would never come,
--  stok kurang, and a Perbaiki per line by hand, or a koreksi picklist when
--  the paper was entered.
--
--  Now, when a Bin To Bin is posted to another bin than it was planned to:
--    * pick_tasks.planned_to_bin_id keeps the destination the plan gave it
--      (stamped by trigger the first time to_bin_id changes, whichever
--      function changes it);
--    * the open picks of the same SKU + batch + expiry planned from that
--      original destination, after the move in execution order (date, slot,
--      NO, seq), and that the original bin cannot serve any more, move their
--      source to where the cartons are, in that order, as long as the new
--      bin holds them. A pick the new bin cannot hold stays where it is and
--      shows as stok kurang, with Perbaiki, as before.
--  Same batch and expiry: FEFO is untouched. Only the plan changes, never
--  stock. Every change is logged on the pick (Riwayat) with the move that
--  caused it, and Ubah baris undoes it.
-- =====================================================================

alter table public.pick_tasks add column if not exists planned_to_bin_id uuid references public.bins(id);

create or replace function public.pick_tasks_keep_planned_to()
returns trigger language plpgsql as $$
begin
  if new.task_type <> 'PICK' and old.to_bin_id is not null and new.to_bin_id is distinct from old.to_bin_id
     and new.planned_to_bin_id is null then
    new.planned_to_bin_id := old.to_bin_id;
  end if;
  -- Changed back to the plan: nothing to follow.
  if new.planned_to_bin_id is not null and new.to_bin_id = new.planned_to_bin_id then
    new.planned_to_bin_id := null;
  end if;
  return new;
end $$;

drop trigger if exists pick_tasks_keep_planned_to on public.pick_tasks;
create trigger pick_tasks_keep_planned_to before update of to_bin_id on public.pick_tasks
  for each row execute function public.pick_tasks_keep_planned_to();

-- A move posted to another bin than planned: the later picks it was meant to feed follow it.
create or replace function public.follow_the_pallet(p_move_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  m public.pick_tasks%rowtype; mw public.waves%rowtype;
  v_batch text; v_exp date; v_from_code text; v_to_code text;
  v_avail_x numeric; v_avail_y numeric; v_used_x numeric := 0; v_used_y numeric := 0;
  p record; n int := 0;
begin
  select * into m from public.pick_tasks where id = p_move_id;
  if m.id is null or m.task_type = 'PICK' or m.status <> 'COMPLETED' or m.planned_to_bin_id is null
     or m.planned_to_bin_id = m.to_bin_id then
    return 0;
  end if;
  select * into mw from public.waves where id = m.wave_id;
  v_batch := coalesce(m.actual_batch_lot, m.batch_lot);
  v_exp := coalesce(m.actual_expiry_date, m.expiry_date);
  select bin_code into v_from_code from public.bins where id = m.planned_to_bin_id;
  select bin_code into v_to_code from public.bins where id = m.to_bin_id;

  -- What the original bin can still serve: its stock of this batch plus other open moves into it.
  v_avail_x := public.sheet_have(m.planned_to_bin_id, m.item_id, v_batch, v_exp)
    + coalesce((select sum(x.quantity) from public.pick_tasks x join public.waves xw on xw.id = x.wave_id
                where x.task_type <> 'PICK' and x.status = 'PLANNED' and xw.status in ('PENDING', 'RESCHEDULED')
                  and x.to_bin_id = m.planned_to_bin_id and x.item_id = m.item_id and x.batch_lot = v_batch
                  and x.expiry_date is not distinct from v_exp), 0);
  -- What the new bin can give: its stock of this batch less the open picks already planned from it.
  v_avail_y := public.sheet_have(m.to_bin_id, m.item_id, v_batch, v_exp)
    - coalesce((select sum(x.quantity) from public.pick_tasks x join public.waves xw on xw.id = x.wave_id
                where x.task_type = 'PICK' and x.status = 'PLANNED' and xw.status in ('PENDING', 'RESCHEDULED')
                  and x.from_bin_id = m.to_bin_id and x.item_id = m.item_id and x.batch_lot = v_batch
                  and x.expiry_date is not distinct from v_exp), 0);

  for p in
    select t.id, t.seq, t.quantity, w.wave_no, w.planned_date,
           (w.planned_date, coalesce(w.planned_slot, '99:99'), coalesce(nullif(regexp_replace(w.wave_no, '\D', '', 'g'), '')::int, 0), t.seq)
             > (mw.planned_date, coalesce(mw.planned_slot, '99:99'), coalesce(nullif(regexp_replace(mw.wave_no, '\D', '', 'g'), '')::int, 0), m.seq) as after_move
    from public.pick_tasks t join public.waves w on w.id = t.wave_id
    where t.task_type = 'PICK' and t.status = 'PLANNED' and w.status in ('PENDING', 'RESCHEDULED')
      and t.from_bin_id = m.planned_to_bin_id and t.item_id = m.item_id and t.batch_lot = v_batch
      and t.expiry_date is not distinct from v_exp
    order by w.planned_date, coalesce(w.planned_slot, '99:99'), coalesce(nullif(regexp_replace(w.wave_no, '\D', '', 'g'), '')::int, 0), t.seq
    for update of t
  loop
    -- The original bin serves in execution order as far as it can; picks before the move always stay.
    if not p.after_move or v_used_x + p.quantity <= v_avail_x then
      v_used_x := v_used_x + p.quantity;
      continue;
    end if;
    -- Beyond it: these were counting on the move. They follow while the new bin holds them.
    if v_used_y + p.quantity > v_avail_y then continue; end if;
    v_used_y := v_used_y + p.quantity;
    update public.pick_tasks set from_bin_id = m.to_bin_id where id = p.id;
    perform public.log_execution_event('TASK', p.id, 'PLANNED', 'PLANNED',
      format('ikut palet: Bin To Bin NO %s #%s ke %s, bukan %s; pick ini sekarang dari %s', mw.wave_no, m.seq, v_to_code, v_from_code, v_to_code));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.follow_the_pallet(uuid) from public, anon, authenticated;

-- Fires on posting, whichever function posts the move.
create or replace function public.pick_tasks_follow_the_pallet()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.follow_the_pallet(new.id);
  return null;
end $$;

drop trigger if exists pick_tasks_follow_the_pallet on public.pick_tasks;
create trigger pick_tasks_follow_the_pallet after update of status on public.pick_tasks
  for each row when (new.task_type <> 'PICK' and new.status = 'COMPLETED' and old.status is distinct from 'COMPLETED'
                     and new.planned_to_bin_id is not null)
  execute function public.pick_tasks_follow_the_pallet();
