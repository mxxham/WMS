-- =====================================================================
-- 0146  Remove dynamic release (Truk datang): waves no longer wait for a truck
--
--  0141 let a wave be locked until its truck arrived and planned it again from
--  the stock of that moment. The warehouse prints every picklist at once, so
--  the lock only got in the way (user decision, 18 Nov 2026). The app no longer
--  locks or opens waves.
--
--  a) Every wave still waiting is opened as it was planned.
--  b) The posting guard and the two RPCs are dropped.
--
--  Kept on purpose: waves.locked_at / released_at (+ who) stay as history and as
--  inert columns. Nothing sets locked_at any more, so the filters 0141 added to
--  task_shortfalls / task_waits and the lock carry in save_plan do nothing.
--  replaceable_waves still keeps a wave that has a released_at: its picklist
--  went out, so a new plan does not replace it.
-- =====================================================================

-- a) Nothing waits any more (the triggers below must not fire on this).
update public.waves
   set locked_at = null, locked_by_name = null
 where locked_at is not null;

-- b) No lock, so no guard; no way to lock or open.
drop trigger if exists pick_tasks_lock_guard on public.pick_tasks;
drop function if exists public.pick_tasks_lock_guard();
drop function if exists public.lock_waves(date, uuid[], text);
drop function if exists public.release_waves(date, uuid[], jsonb, text);
drop function if exists public.apply_locked_plan(uuid[], jsonb);
