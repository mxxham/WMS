-- =====================================================================
-- 0110  Shipment assignment: one Operator / Picker per shipment
--
--  26 Oct flowchart decision: the Inventory admin hands each shipment (its
--  -FL and -HP picklists together) to one Operator / Picker. An operator
--  posts only the shipments assigned to them; every other job posts as
--  before. Assignment never touches waves, pick_tasks rows, outbound, FEFO,
--  Sisa or the print order: it only decides who sees and who posts.
--   · shipment_assignments is keyed on (planned_date, shipment_number), not
--     wave_id, so it survives re-running Alokasi (save_plan replaces an
--     untouched wave with a new id and the same shipment numbers). A
--     shipment carried to another day is not assigned on the new day.
--   · shipment_assignment_log keeps every ASSIGN / UNASSIGN / RELEASE —
--     the floor asks "who had this shipment". Append-only.
--   · pick_tasks_assignment_guard: ONE trigger on every status change of a
--     task. An operator (by job) changes only tasks of a shipment assigned
--     to them; a REPLENISH (no shipment) belongs to its wave's shipments.
--     It covers post_task, post_task_by, post_pick_line, post_pick_with_move,
--     post_task_found_elsewhere, complete_wave and every future path, and
--     the raise rolls the whole call back, so nothing is half-posted.
--     It binds status changes (posting) only, not audit corrections.
--   · profiles_release_assignments: an operator moved to another job or
--     deactivated loses their open shipments (logged RELEASE), so Penugasan
--     shows them unassigned instead of pointing at someone who cannot pick.
-- =====================================================================

create table public.shipment_assignments (
  planned_date     date not null,
  shipment_number  text not null,
  user_id          uuid not null references public.profiles(id),
  assigned_by      uuid references public.profiles(id),
  assigned_by_name text not null,
  assigned_at      timestamptz not null default now(),
  primary key (planned_date, shipment_number)
);
create index shipment_assignments_user_idx on public.shipment_assignments (user_id);

create table public.shipment_assignment_log (
  id              uuid primary key default gen_random_uuid(),
  planned_date    date not null,
  shipment_number text not null,
  user_id         uuid references public.profiles(id),
  action          text not null check (action in ('ASSIGN','UNASSIGN','RELEASE')),
  by_name         text,
  created_at      timestamptz not null default now()
);
create index shipment_assignment_log_ship_idx on public.shipment_assignment_log (planned_date, shipment_number);

-- Append-only, for every role including the service role (0099's ckb_forbid_change pattern).
create or replace function public.shipment_assignment_log_forbid_change() returns trigger
language plpgsql as $$
begin
  raise exception '% tidak bisa diubah atau dihapus (%)', tg_table_name, tg_op;
end $$;
create trigger shipment_assignment_log_immutable before update or delete on public.shipment_assignment_log
  for each row execute function public.shipment_assignment_log_forbid_change();
create trigger shipment_assignment_log_no_truncate before truncate on public.shipment_assignment_log
  for each statement execute function public.shipment_assignment_log_forbid_change();

alter table public.shipment_assignments enable row level security;
alter table public.shipment_assignment_log enable row level security;
create policy "shipment_assignments: read" on public.shipment_assignments for select to authenticated
  using ((select public.is_active()));
create policy "shipment_assignment_log: read" on public.shipment_assignment_log for select to authenticated
  using ((select public.is_active()));
-- No write policies: written only through the functions below.
grant select on public.shipment_assignments, public.shipment_assignment_log to authenticated;
grant all on public.shipment_assignments, public.shipment_assignment_log to service_role;

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
-- The wave a shipment is planned in on a day (a cancelled one only when nothing else is left).
create or replace function public.shipment_wave(p_date date, p_shipment text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.waves
  where planned_date = p_date and p_shipment = any(shipment_numbers)
  order by (status = 'CANCELLED'), created_at desc
  limit 1
$$;

-- Board status of one shipment of a wave: Dimuat (loaded) > Selesai (wave completed or cancelled, or no
-- PLANNED / RESCHEDULED task left) > Dipicking (some task posted) > Belum. A REPLENISH task (no
-- shipment) counts for every shipment of its wave. No wave: Belum.
create or replace function public.shipment_status(p_wave_id uuid, p_shipment text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when exists (select 1 from public.shipment_loads l where l.wave_id = w.id and l.shipment_number = p_shipment)
        then 'Dimuat'
      when w.status in ('COMPLETED','CANCELLED')
        or not exists (select 1 from public.pick_tasks t where t.wave_id = w.id and t.status in ('PLANNED','RESCHEDULED')
                         and (t.shipment_number = p_shipment or t.shipment_number is null))
        then 'Selesai'
      when exists (select 1 from public.pick_tasks t where t.wave_id = w.id and t.status = 'COMPLETED'
                     and (t.shipment_number = p_shipment or t.shipment_number is null))
        then 'Dipicking'
      else 'Belum' end
    from public.waves w where w.id = p_wave_id), 'Belum')
$$;

-- An assignment still open: its shipment is still planned that day (a wave carried to another day
-- leaves a stale row: not open, never released, not counted) and is neither Selesai nor Dimuat.
create or replace function public.shipment_assignment_open(p_date date, p_shipment text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select public.shipment_status(v.id, p_shipment) not in ('Selesai','Dimuat')
                   from (select public.shipment_wave(p_date, p_shipment) as id) v where v.id is not null), false)
$$;

-- Whether the caller holds the shipment. p_shipment null (REPLENISH): any shipment of the wave.
create or replace function public.shipment_assigned_to_me(p_wave_id uuid, p_shipment text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.waves w
    join public.shipment_assignments a on a.planned_date = w.planned_date and a.shipment_number = any(w.shipment_numbers)
    where w.id = p_wave_id and a.user_id = auth.uid()
      and (p_shipment is null or a.shipment_number = p_shipment))
$$;

-- ---------------------------------------------------------------------
-- The posting guard: one trigger on every task status change
-- ---------------------------------------------------------------------
create or replace function public.pick_tasks_assignment_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- No session (migrations, the server, SQL fixtures): not an operator posting.
  if auth.uid() is null then return new; end if;
  -- Only the Operator / Picker job is bound to assignments; every other job posts as before.
  if public.my_job() is distinct from 'operator' then return new; end if;
  if not public.shipment_assigned_to_me(new.wave_id, new.shipment_number) then
    raise exception 'Shipment % tidak ditugaskan ke Anda',
      coalesce(new.shipment_number, (select shipment_numbers[1] from public.waves where id = new.wave_id));
  end if;
  return new;
end $$;
create trigger pick_tasks_assignment_guard before update of status on public.pick_tasks
  for each row when (old.status is distinct from new.status)
  execute function public.pick_tasks_assignment_guard();

-- ---------------------------------------------------------------------
-- Release: an operator who changes job or is deactivated gives back open shipments
-- ---------------------------------------------------------------------
create or replace function public.profiles_release_assignments() returns trigger
language plpgsql security definer set search_path = public as $$
declare a record; v_by text;
begin
  v_by := coalesce((select name from public.profiles where id = auth.uid()), 'Sistem');
  for a in select * from public.shipment_assignments where user_id = new.id
           order by planned_date, shipment_number for update loop
    if public.shipment_assignment_open(a.planned_date, a.shipment_number) then
      delete from public.shipment_assignments where planned_date = a.planned_date and shipment_number = a.shipment_number;
      insert into public.shipment_assignment_log (planned_date, shipment_number, user_id, action, by_name)
      values (a.planned_date, a.shipment_number, new.id, 'RELEASE', v_by);
    end if;
  end loop;
  return null;
end $$;
-- role too: a legacy direct role write changes job in 0109's BEFORE trigger, and a column-list
-- trigger fires only on the columns named in the UPDATE's SET list.
create trigger profiles_release_assignments after update of job, role, active on public.profiles
  for each row when (old.job = 'operator' and (new.job <> 'operator' or not new.active))
  execute function public.profiles_release_assignments();

-- ---------------------------------------------------------------------
-- RPCs: Inventory, Leader and Admin assign
-- ---------------------------------------------------------------------
create or replace function public.assign_shipment(p_date date, p_shipment text, p_user uuid, p_by_name text)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text; v_wave uuid; v_status text;
begin
  if not public.has_job(array['inventory','leader','admin']) then
    raise exception 'Hanya Inventory, Leader atau Admin yang bisa menugaskan shipment';
  end if;
  v_name := public.person_name(p_by_name, 'Nama Anda');
  v_wave := public.shipment_wave(p_date, p_shipment);
  if v_wave is null then
    raise exception 'Shipment % tidak ada di rencana %', p_shipment, to_char(p_date, 'DD-MM-YYYY');
  end if;
  -- Serialize with loading and posting on the same wave.
  perform 1 from public.waves where id = v_wave for update;
  if not exists (select 1 from public.profiles where id = p_user and active and job = 'operator'
                 and 'shell_wms' = any(apps)) then
    raise exception 'Hanya akun Operator / Picker aktif yang bisa ditugaskan';
  end if;
  v_status := public.shipment_status(v_wave, p_shipment);
  if v_status = 'Dimuat' then raise exception 'Shipment % sudah dimuat', p_shipment; end if;
  if v_status = 'Selesai' then raise exception 'Shipment % sudah selesai', p_shipment; end if;

  insert into public.shipment_assignments (planned_date, shipment_number, user_id, assigned_by, assigned_by_name)
  values (p_date, p_shipment, p_user, auth.uid(), v_name)
  on conflict (planned_date, shipment_number) do update
    set user_id = excluded.user_id, assigned_by = excluded.assigned_by,
        assigned_by_name = excluded.assigned_by_name, assigned_at = now();
  insert into public.shipment_assignment_log (planned_date, shipment_number, user_id, action, by_name)
  values (p_date, p_shipment, p_user, 'ASSIGN', v_name);
end $$;

create or replace function public.unassign_shipment(p_date date, p_shipment text, p_by_name text)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text; v_prev uuid;
begin
  if not public.has_job(array['inventory','leader','admin']) then
    raise exception 'Hanya Inventory, Leader atau Admin yang bisa menugaskan shipment';
  end if;
  v_name := public.person_name(p_by_name, 'Nama Anda');
  delete from public.shipment_assignments where planned_date = p_date and shipment_number = p_shipment
  returning user_id into v_prev;
  if v_prev is null then raise exception 'Shipment % belum ditugaskan', p_shipment; end if;
  insert into public.shipment_assignment_log (planned_date, shipment_number, user_id, action, by_name)
  values (p_date, p_shipment, v_prev, 'UNASSIGN', v_name);
end $$;

-- One row per shipment of the day's waves (a cancelled wave has nothing to pick), in wave order (earliest slot, then NO).
-- FL / HP = PICK lines on a pallet / by the case, the -FL / -HP split (picklist-from-tasks.ts);
-- a line with no pick_type prints on -HP there, so it counts as HP here.
create or replace function public.assignment_board(p_date date)
returns table (wave_id uuid, wave_no text, shipment_number text, planned_slot text, truck text,
               fl_lines int, hp_lines int, status text, user_id uuid, user_name text)
language sql stable security definer set search_path = public as $$
  select w.id, w.wave_no, s.shipment_number, w.planned_slot, w.truck,
         (select count(*)::int from public.pick_tasks t where t.wave_id = w.id and t.shipment_number = s.shipment_number
            and t.task_type = 'PICK' and t.status <> 'CANCELLED' and t.pick_type = 'PALLET'),
         (select count(*)::int from public.pick_tasks t where t.wave_id = w.id and t.shipment_number = s.shipment_number
            and t.task_type = 'PICK' and t.status <> 'CANCELLED' and coalesce(t.pick_type, 'CASE') = 'CASE'),
         public.shipment_status(w.id, s.shipment_number),
         a.user_id, p.name
  from public.waves w
  cross join lateral unnest(w.shipment_numbers) with ordinality as s(shipment_number, n)
  left join public.shipment_assignments a on a.planned_date = w.planned_date and a.shipment_number = s.shipment_number
  left join public.profiles p on p.id = a.user_id
  where w.planned_date = p_date and w.status <> 'CANCELLED' and (select public.is_active())
  order by w.planned_slot nulls last, length(w.wave_no), w.wave_no, s.n
$$;

-- Who can be assigned, with their count of open (not Selesai / Dimuat) shipments.
create or replace function public.assignable_operators()
returns table (id uuid, name text, username text, open_count int)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.username,
         (select count(*)::int from public.shipment_assignments a
          where a.user_id = p.id and public.shipment_assignment_open(a.planned_date, a.shipment_number))
  from public.profiles p
  where p.active and p.job = 'operator' and 'shell_wms' = any(p.apps) and (select public.is_active())
  order by p.name
$$;

revoke execute on function public.shipment_assignment_log_forbid_change(), public.shipment_wave(date, text),
  public.shipment_status(uuid, text), public.shipment_assignment_open(date, text),
  public.shipment_assigned_to_me(uuid, text), public.pick_tasks_assignment_guard(),
  public.profiles_release_assignments(), public.assign_shipment(date, text, uuid, text),
  public.unassign_shipment(date, text, text), public.assignment_board(date), public.assignable_operators()
  from public, anon;
grant execute on function public.shipment_assigned_to_me(uuid, text), public.assign_shipment(date, text, uuid, text),
  public.unassign_shipment(date, text, text), public.assignment_board(date), public.assignable_operators()
  to authenticated;
grant execute on function public.shipment_wave(date, text), public.shipment_status(uuid, text),
  public.shipment_assignment_open(date, text), public.shipment_assigned_to_me(uuid, text),
  public.assignment_board(date), public.assignable_operators() to service_role;

-- Live refresh for Penugasan and Wave (0015's guarded loop).
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication not found; skipping';
    return;
  end if;
  foreach t in array array['shipment_assignments', 'shipment_assignment_log'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
