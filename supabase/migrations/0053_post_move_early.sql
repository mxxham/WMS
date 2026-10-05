-- =====================================================================
-- 0053  Posting Bin To Bin saja: move a pallet's rest without its pick
--
--  5 Oct: NO 3 picked from the pickface CC25A01, which only fills when
--  NO 1 #7 carries the rest of pallet CC29C02 there (task_waits, 0038:
--  "Tunggu relokasi NO 1 #7"). NO 1's truck was late and the wave went on
--  Tunda, and a pick and its move could only be posted together, and only
--  on a PENDING wave — so to unblock NO 3 the supervisor posted NO 1's pick
--  of 20 as well, then had to undo it (undoing the move too failed: NO 3
--  had already taken 4 of the 28 from the pickface).
--  post_move_early posts ONE open Bin To Bin by itself, also on a Tunda
--  (RESCHEDULED) wave, so the waiting wave can go on while the delayed
--  wave keeps its pick open for its own truck. The posting is the normal
--  one (post_task_by: planned quantity, movement, the stock checks of the
--  movements trigger, order guard). On a Tunda wave the wave is PENDING
--  only for the length of that call, inside this transaction, and back on
--  RESCHEDULED before it returns — no other session can see the switch.
--  task_waits also returns the move it waits for, so the wave page can
--  offer the button right in the notice.
-- =====================================================================

create or replace view public.task_waits with (security_invoker = true) as
select t.id as task_id, w.planned_date,
       coalesce((select sum(i.quantity) from public.inventory i
                 where i.bin_id = t.from_bin_id and i.item_id = t.item_id and i.batch_lot = t.batch_lot
                   and i.expiry_date is not distinct from t.expiry_date), 0) as have,
       r.wave_no as wait_wave_no, r.seq as wait_seq, r.from_bin as wait_from, r.to_bin as wait_to, r.quantity as wait_qty,
       r.id as wait_task_id, r.wave_status as wait_wave_status
from public.open_pick_tasks t
join public.waves w on w.id = t.wave_id
cross join lateral (
  select rw.wave_no, x.seq, fb.bin_code as from_bin, tb.bin_code as to_bin, x.quantity, x.id, rw.status as wave_status
  from public.open_pick_tasks x
  join public.waves rw on rw.id = x.wave_id
  join public.bins fb on fb.id = x.from_bin_id
  join public.bins tb on tb.id = x.to_bin_id
  where x.id <> t.id and x.task_type <> 'PICK' and x.to_bin_id = t.from_bin_id
    and x.item_id = t.item_id and x.batch_lot = t.batch_lot
  order by rw.planned_date, rw.planned_slot nulls last, rw.wave_no, x.seq
  limit 1
) r
where coalesce((select sum(i.quantity) from public.inventory i
                where i.bin_id = t.from_bin_id and i.item_id = t.item_id and i.batch_lot = t.batch_lot
                  and i.expiry_date is not distinct from t.expiry_date), 0) < t.quantity;
grant select on public.task_waits to authenticated;

create or replace function public.post_move_early(p_move_id uuid, p_by_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m public.pick_tasks%rowtype; w public.waves%rowtype; v_name text; v_res jsonb;
begin
  v_name := public.person_name(p_by_name, 'Nama Anda');
  select * into m from public.pick_tasks where id = p_move_id for update;
  if m.id is null or m.task_type = 'PICK' then raise exception 'Bin To Bin tidak ditemukan'; end if;
  if m.status <> 'PLANNED' then raise exception 'Bin To Bin #% sudah %', m.seq, m.status; end if;
  select * into w from public.waves where id = m.wave_id for update;
  if w.status = 'RESCHEDULED' then
    -- A parked wave is the supervisor's call; on an active wave any operator posts as usual.
    if not public.has_role(array['supervisor','admin']::public.user_role[]) then
      raise exception 'Wave NO % ditunda: hanya supervisor atau admin yang bisa memposting Bin To Bin-nya', w.wave_no;
    end if;
    update public.waves set status = 'PENDING' where id = w.id;
    v_res := public.post_task_by(m.id, null, null, null, null, null, v_name, null);
    update public.waves set status = 'RESCHEDULED' where id = w.id;
  elsif w.status = 'PENDING' then
    v_res := public.post_task_by(m.id, null, null, null, null, null, v_name, null);
  else
    raise exception 'Wave NO % sudah %', w.wave_no, w.status;
  end if;
  perform public.log_execution_event('TASK', m.id, 'PLANNED', 'COMPLETED',
    format('Bin To Bin diposting tanpa pick-nya oleh %s (wave NO %s %s)', v_name, w.wave_no,
           case when w.status = 'RESCHEDULED' then 'ditunda' else 'aktif' end));
  return v_res;
end $$;
revoke execute on function public.post_move_early(uuid, text) from public, anon;
grant execute on function public.post_move_early(uuid, text) to authenticated;
