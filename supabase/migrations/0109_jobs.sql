-- =====================================================================
-- 0109  Seven flowchart jobs; the role level is derived from the job
--
--  26 Oct flowchart decision: people do one of seven jobs (Admin Inbound,
--  Admin Outbound, Checker, Inventory, Operator / Picker, Leader, Admin),
--  not one of three levels. profiles.job holds the job.
--   · profiles.role (user_role) stays and is DERIVED from the job, so the
--     ~210 has_role() checks keep their meaning unchanged:
--       admin -> admin; leader, admin_inbound, admin_outbound, inventory
--       -> supervisor; checker, operator -> operator.
--   · a legacy direct write of role (old scripts, fixtures) maps back:
--     admin -> admin, supervisor -> leader, operator -> operator.
--   · set_user_job replaces set_user_role for the Shell app (same rules as
--     0071: admin only, never yourself, one active admin stays);
--     set_user_role is revoked from authenticated so the two cannot disagree.
--   · my_job / has_job: the caller's job, for the page gate and assignment.
--   · placeholder_job: the placeholder accounts the owner already created
--     get their job from their username (one-off update below).
-- =====================================================================

alter table public.profiles add column job text not null default 'operator';

-- Backfill from the level, before the check and the trigger exist.
update public.profiles set job = case role when 'admin' then 'admin' when 'supervisor' then 'leader' else 'operator' end;

alter table public.profiles add constraint profiles_job_check
  check (job in ('admin_inbound','admin_outbound','checker','inventory','operator','leader','admin'));

create or replace function public.job_level(p_job text) returns public.user_role
language sql immutable set search_path = public as $$
  select case p_job
    when 'admin' then 'admin'
    when 'leader' then 'supervisor' when 'admin_inbound' then 'supervisor'
    when 'admin_outbound' then 'supervisor' when 'inventory' then 'supervisor'
    when 'checker' then 'operator' when 'operator' then 'operator'
  end::public.user_role
$$;

create or replace function public.placeholder_job(p_username text) returns text
language sql immutable set search_path = public as $$
  select case lower(p_username)
    when 'admin.inbound' then 'admin_inbound' when 'admin.outbound' then 'admin_outbound'
    when 'checker' then 'checker' when 'inventory' then 'inventory'
    when 'operator' then 'operator' when 'leader' then 'leader'
  end
$$;

-- BEFORE trigger: the final row (seen by 0105's AFTER trigger) is always consistent.
create or replace function public.profiles_job_level() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    -- a job given: role follows. Only the default job with a stronger legacy role (old inserts) maps back.
    if new.job = 'operator' and new.role is distinct from 'operator' then
      new.job := case new.role when 'admin' then 'admin' else 'leader' end;
    else
      new.role := coalesce(public.job_level(new.job), new.role);  -- unknown job: the check constraint refuses it
    end if;
  elsif new.job is distinct from old.job then
    new.role := coalesce(public.job_level(new.job), new.role);
  elsif new.role is distinct from old.role then
    new.job := case new.role when 'admin' then 'admin' when 'supervisor' then 'leader' else 'operator' end;
  end if;
  return new;
end $$;

create trigger profiles_job_level before insert or update of job, role on public.profiles
  for each row execute function public.profiles_job_level();

-- One-off: the placeholder accounts take their job from the username (absent ones match nothing).
update public.profiles set job = public.placeholder_job(username)
where public.placeholder_job(username) is not null;

create or replace function public.set_user_job(p_user uuid, p_job text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.accounts_guard(p_user);
  if p_job is null or p_job not in ('admin_inbound','admin_outbound','checker','inventory','operator','leader','admin') then
    raise exception 'Pekerjaan tidak dikenal';
  end if;
  update public.profiles set job = p_job where id = p_user;
  if not exists (select 1 from public.profiles where job = 'admin' and active) then raise exception 'Harus ada minimal satu admin aktif'; end if;
end $$;

create or replace function public.my_job() returns text
language sql stable security definer set search_path = public as $$
  select job from public.profiles where id = auth.uid()
$$;

create or replace function public.has_job(p_jobs text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select active and job = any(p_jobs) from public.profiles where id = auth.uid()), false)
$$;

revoke execute on function public.job_level(text), public.placeholder_job(text), public.profiles_job_level(),
  public.set_user_job(uuid, text), public.my_job(), public.has_job(text[]) from public, anon;
grant execute on function public.job_level(text), public.my_job(), public.has_job(text[]), public.set_user_job(uuid, text) to authenticated;
grant execute on function public.job_level(text), public.placeholder_job(text), public.my_job(), public.has_job(text[]) to service_role;
revoke execute on function public.set_user_role(uuid, public.user_role) from authenticated;
