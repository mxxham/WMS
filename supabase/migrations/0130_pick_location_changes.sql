-- =====================================================================
-- 0130  Perubahan lokasi: every change of a pick's location, as a list
--       that can be downloaded
--
--  8 Nov 2026: the floor asked for one report of every pick whose
--  location was changed after planning, original bin next to the new one.
--  Until now a change overwrote pick_tasks.from_bin_id; the original bin
--  survived only as a sentence in the row's Riwayat (execution_events),
--  readable one row at a time. Five paths change a location:
--    * Ubah baris (edit_pick_row, 0052) and the older Ubah bin pick
--      (0049/0050),
--    * Pindah sisa: the later picks follow the rest (0127),
--    * ikut palet: picks follow a posted Bin To Bin (0063),
--    * Isi dari picklist: a Bin To Bin set from the printed sheet (0057+),
--    * the picker took it from another bin / batch (actual_* at posting,
--      or Audit picking "terima batch lain", 0088).
--
--  pick_location_changes gets one row per change, written by a trigger on
--  pick_tasks, so a path added later is caught without being edited.
--  Copied data (wave NO, date, shipment, SKU, bin codes), no foreign key
--  to pick_tasks: save_plan deletes replaced waves with their tasks and the
--  history must stay. Append-only, like movements: a trigger refuses
--  UPDATE and DELETE. No write policy; only the trigger writes.
--
--  The effective location is (actual_* or planned) bin + batch + expiry,
--  plus the destination of a Bin To Bin. Posting that confirms the planned
--  bin changes nothing and writes nothing.
--
--  Who and why: the paths log their sentence in execution_events in the
--  same transaction (one now()), so the view joins that by time instead of
--  each path passing a reason to the trigger. Audit picking logs its note on
--  pick_audits.resolution_note, same transaction too.
--
--  Changes made before this migration are read back from those sentences
--  (source 'LOG'): Ubah baris, Ubah bin pick, Pindah sisa, ikut palet.
--  A change whose task was since deleted by a re-plan, or one made by
--  Isi dari picklist, cannot be recovered and is not listed.
-- =====================================================================

create table public.pick_location_changes (
  id              bigint generated always as identity primary key,
  task_id         uuid not null,              -- no FK: the history outlives a re-planned wave
  wave_id         uuid not null,
  planned_date    date not null,
  wave_no         text not null,
  shipment_number text,
  task_type       text not null,
  sku             text not null,
  description     text not null default '',
  quantity        numeric not null,
  old_bin         text,
  new_bin         text,
  old_batch       text not null default '',
  new_batch       text not null default '',
  old_expiry      date,
  new_expiry      date,
  old_to_bin      text,                       -- Bin To Bin destination; null on a pick
  new_to_bin      text,
  kind            text not null check (kind in ('PLAN', 'ACTUAL')),
  source          text not null default 'TRIGGER' check (source in ('TRIGGER', 'LOG')),
  reason          text,                       -- only on LOG rows; TRIGGER rows join their event
  changed_by      uuid references public.profiles(id),
  changed_at      timestamptz not null default now()
);
create index pick_location_changes_date_idx on public.pick_location_changes (planned_date, wave_no);
create index pick_location_changes_task_idx on public.pick_location_changes (task_id, changed_at);

create or replace function public.pick_location_changes_forbid_change() returns trigger language plpgsql as $$
begin
  raise exception 'Riwayat perubahan lokasi tidak bisa diubah atau dihapus';
end $$;
create trigger pick_location_changes_forbid_change before update or delete on public.pick_location_changes
  for each row execute function public.pick_location_changes_forbid_change();

alter table public.pick_location_changes enable row level security;
create policy "pick_location_changes: read" on public.pick_location_changes
  for select to authenticated using ((select public.is_active()));
grant select on public.pick_location_changes to authenticated;

-- One row when the effective location of a task changes.
create or replace function public.pick_tasks_log_location()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  o_bin uuid := coalesce(old.actual_from_bin_id, old.from_bin_id);
  n_bin uuid := coalesce(new.actual_from_bin_id, new.from_bin_id);
  o_batch text := coalesce(old.actual_batch_lot, old.batch_lot);
  n_batch text := coalesce(new.actual_batch_lot, new.batch_lot);
  o_exp date := coalesce(old.actual_expiry_date, old.expiry_date);
  n_exp date := coalesce(new.actual_expiry_date, new.expiry_date);
  w public.waves%rowtype;
  i public.items%rowtype;
  v_actual boolean;
begin
  if o_bin = n_bin and o_batch = n_batch and o_exp is not distinct from n_exp
     and old.to_bin_id is not distinct from new.to_bin_id then
    return null;
  end if;
  v_actual := old.actual_from_bin_id is distinct from new.actual_from_bin_id
           or old.actual_batch_lot is distinct from new.actual_batch_lot
           or old.actual_expiry_date is distinct from new.actual_expiry_date;
  select * into w from public.waves where id = new.wave_id;
  select * into i from public.items where id = new.item_id;
  insert into public.pick_location_changes (task_id, wave_id, planned_date, wave_no, shipment_number, task_type,
    sku, description, quantity, old_bin, new_bin, old_batch, new_batch, old_expiry, new_expiry,
    old_to_bin, new_to_bin, kind, changed_by)
  values (new.id, new.wave_id, w.planned_date, w.wave_no, new.shipment_number, new.task_type,
    i.sku, i.description, coalesce(new.actual_quantity, new.quantity),
    (select bin_code from public.bins where id = o_bin), (select bin_code from public.bins where id = n_bin),
    coalesce(o_batch, ''), coalesce(n_batch, ''), o_exp, n_exp,
    (select bin_code from public.bins where id = old.to_bin_id), (select bin_code from public.bins where id = new.to_bin_id),
    case when v_actual then 'ACTUAL' else 'PLAN' end, auth.uid());
  return null;
end $$;
revoke execute on function public.pick_tasks_log_location() from public, anon, authenticated;

create trigger pick_tasks_log_location
  after update of from_bin_id, batch_lot, expiry_date, to_bin_id, actual_from_bin_id, actual_batch_lot, actual_expiry_date
  on public.pick_tasks for each row execute function public.pick_tasks_log_location();

-- ---------------------------------------------------------------------
-- Changes before 0130, read back from the Riwayat sentences.
-- ---------------------------------------------------------------------
insert into public.pick_location_changes (task_id, wave_id, planned_date, wave_no, shipment_number, task_type,
  sku, description, quantity, old_bin, new_bin, old_batch, new_batch, old_expiry, new_expiry,
  old_to_bin, new_to_bin, kind, source, reason, changed_by, changed_at)
select t.id, t.wave_id, w.planned_date, w.wave_no, t.shipment_number, t.task_type, i.sku, i.description, t.quantity,
       p.old_bin, p.new_bin, coalesce(p.old_batch, t.batch_lot), coalesce(p.new_batch, t.batch_lot),
       coalesce(p.old_exp, t.expiry_date), coalesce(p.new_exp, t.expiry_date),
       null, null, 'PLAN', 'LOG', e.reason, e.actor, e.occurred_at
from public.execution_events e
join public.pick_tasks t on t.id = e.entity_id
join public.waves w on w.id = t.wave_id
join public.items i on i.id = t.item_id
cross join lateral (
  select m[1] as old_bin, m[2] as old_batch, m[3]::date as old_exp, m[4] as new_bin, m[5] as new_batch, m[6]::date as new_exp
  from regexp_match(e.reason, 'sumber ([A-Za-z0-9_-]+) +(\S*) *exp (\d{4}-\d{2}-\d{2}) → ([A-Za-z0-9_-]+) +(\S*) *exp (\d{4}-\d{2}-\d{2})') m
  where e.reason like 'baris diubah%' and m is not null
  union all
  select m[1], null, null, m[2], null, null
  from regexp_match(e.reason, '^bin pick diubah oleh .*?: ([A-Za-z0-9_-]+) → ([A-Za-z0-9_-]+)') m
  where m is not null
  union all
  select m[2], null, null, m[1], null, null
  from regexp_match(e.reason, '^ikut palet: .* ke ([A-Za-z0-9_-]+), bukan ([A-Za-z0-9_-]+);') m
  where m is not null
  union all
  select m[1], null, null, m[2], null, null
  from regexp_match(e.reason, '^ikut Bin To Bin .*: sisa \S+ dari ([A-Za-z0-9_-]+) ke ([A-Za-z0-9_-]+),') m
  where m is not null
) p
where e.entity_type = 'TASK'
  and (p.old_bin is distinct from p.new_bin or p.old_batch is distinct from p.new_batch or p.old_exp is distinct from p.new_exp)
order by e.occurred_at, e.id;

-- ---------------------------------------------------------------------
-- The list the page and the Excel read.
-- ---------------------------------------------------------------------
create or replace view public.pick_location_change_list with (security_invoker = true) as
select c.id, c.task_id, c.wave_id, c.planned_date, c.wave_no, c.shipment_number, c.task_type,
       c.sku, c.description, c.quantity,
       first_value(c.old_bin) over (partition by c.task_id order by c.changed_at, c.id) as original_bin,
       c.old_bin, c.new_bin, c.old_batch, c.new_batch, c.old_expiry, c.new_expiry, c.old_to_bin, c.new_to_bin,
       c.kind, c.source,
       coalesce(c.reason, ev.reason, pa.resolution_note) as reason,
       pf.name as changed_by_name, c.changed_at,
       (c.new_expiry > c.old_expiry) as fefo_skipped,
       (pa.task_id is not null) as via_audit,
       wv.status as wave_status
from public.pick_location_changes c
left join public.profiles pf on pf.id = c.changed_by
left join public.waves wv on wv.id = c.wave_id
left join lateral (
  select x.reason from public.execution_events x
  where c.source = 'TRIGGER' and x.entity_type = 'TASK' and x.entity_id = c.task_id and x.occurred_at = c.changed_at
  order by x.id desc limit 1
) ev on true
left join lateral (
  select a.task_id, a.resolution_note from public.pick_audits a
  where c.source = 'TRIGGER' and c.kind = 'ACTUAL' and a.task_id = c.task_id and a.resolved_at = c.changed_at
  order by a.resolved_at desc limit 1
) pa on true;
grant select on public.pick_location_change_list to authenticated;
