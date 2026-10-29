-- =====================================================================
-- 0114  Bin To Bin: audit the source bin too
--
-- 0088 audits a REPLENISH move at its destination only (what arrived at the
-- pickface). On the floor a move CB05C01 -> CF05A01 touches two racks, and
-- the checker walking rack CB must also check CB05C01: what is left there
-- after the move. Asked for on 28 Oct 2026, after the moves were shown only
-- on a separate card instead of in the racks they touch.
--
-- The source check is a rack count, as in 0025: the checker counts every
-- carton of the SKU left in the source bin, blind, and the database compares
-- it with the stock it holds now. It has its own table so the destination
-- audit's attempts, line state and Ubah flow (0088) stay as they are.
-- =====================================================================

create table public.move_source_audits (
  id            uuid primary key default gen_random_uuid(),
  task_id       uuid not null references public.pick_tasks(id) on delete cascade,
  attempt_no    int not null check (attempt_no >= 1),
  checker_name  text not null,
  found_sku     text not null,
  system_qty    numeric not null,
  counted_qty   numeric not null check (counted_qty >= 0),
  result        text not null check (result in ('OK', 'MISMATCH')),
  note          text,
  correction    boolean not null default false,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  unique (task_id, attempt_no)
);
create index move_source_audits_created_idx on public.move_source_audits (created_at desc);

-- Written only by record_move_source_audit; a correction is a new attempt, never an edit.
alter table public.move_source_audits enable row level security;
create policy "move_source_audits: read" on public.move_source_audits for select to authenticated
  using ((select public.is_active()));
grant select on public.move_source_audits to authenticated;

create or replace function public.move_source_audits_forbid_change() returns trigger
language plpgsql as $$
begin raise exception 'Audit bin asal tidak bisa diubah atau dihapus: catat audit baru'; end $$;
create trigger move_source_audits_forbid_change before update or delete on public.move_source_audits
  for each row when (pg_trigger_depth() = 0) execute function public.move_source_audits_forbid_change();

-- ---------------------------------------------------------------------
-- View: 0088's columns unchanged, the source check appended
-- ---------------------------------------------------------------------
create or replace view public.pick_audit_move with (security_invoker = true) as
with latest as (
  select distinct on (task_id) * from public.pick_audits order by task_id, attempt_no desc
), n as (
  select task_id, count(*)::int as attempts from public.pick_audits group by task_id
), src as (
  select distinct on (task_id) * from public.move_source_audits order by task_id, attempt_no desc
), sn as (
  select task_id, count(*)::int as attempts from public.move_source_audits group by task_id
)
select t.id as task_id, t.wave_id, w.wave_no, w.planned_date, w.status as wave_status, t.seq,
       it.sku, it.description, it.uom,
       coalesce(ab.bin_code, fb.bin_code) as from_bin, coalesce(ab.zone, fb.zone) as zone,
       tb.bin_code as to_bin, tb.zone as to_zone,
       coalesce(t.actual_batch_lot, t.batch_lot) as batch_lot, coalesce(t.actual_expiry_date, t.expiry_date) as expiry_date,
       t.quantity as planned_qty, coalesce(t.actual_quantity, t.quantity) as moved_qty, t.deviation_reason,
       t.completed_at, t.picked_by_name, t.bulk_posted, t.scanned_code,
       l.id as audit_id, l.attempt_no, l.result, l.errors, l.resolution, l.checker_name, l.created_at as audited_at,
       coalesce(n.attempts, 0) as attempts,
       case when coalesce(t.actual_quantity, t.quantity) = 0 then 'AUTO_PASS'
            when l.id is null then 'TODO'
            when l.result = 'OK' then 'OK'
            when l.resolution is not null then 'RESOLVED'
            else 'MISMATCH' end as line_state,
       -- 0114: the count left in the source bin
       case when coalesce(t.actual_quantity, t.quantity) = 0 then 'AUTO_PASS'
            when s.id is null then 'TODO'
            when s.result = 'OK' then 'OK'
            else 'MISMATCH' end as from_state,
       coalesce(sn.attempts, 0) as from_attempts,
       s.checker_name as from_checker, s.system_qty as from_system, s.counted_qty as from_counted,
       s.found_sku as from_found_sku, s.note as from_note, s.correction as from_correction, s.created_at as from_audited_at
from public.pick_tasks t
join public.waves w on w.id = t.wave_id
join public.items it on it.id = t.item_id
join public.bins fb on fb.id = t.from_bin_id
left join public.bins ab on ab.id = t.actual_from_bin_id
join public.bins tb on tb.id = t.to_bin_id
left join latest l on l.task_id = t.id
left join n on n.task_id = t.id
left join src s on s.task_id = t.id
left join sn on sn.task_id = t.id
where t.task_type = 'REPLENISH' and t.status = 'COMPLETED';

grant select on public.pick_audit_move to authenticated;

-- ---------------------------------------------------------------------
-- RPC: record_move_source_audit — blind count of the SKU left in the source bin
-- ---------------------------------------------------------------------
create or replace function public.record_move_source_audit(
  p_task_id uuid, p_checker_name text, p_counted numeric, p_note text default null,
  p_found_sku text default null, p_correct boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_checker text := public.person_name(p_checker_name, 'Nama checker');
  t record; v_prev public.move_source_audits%rowtype; v_system numeric; v_found text; v_result text; v_attempt int;
begin
  if not public.has_role(array['operator','supervisor','admin']::public.user_role[]) then
    raise exception 'Sesi situs tidak tersedia';
  end if;
  perform public.pick_audit_correction_check(p_correct, p_note);
  if p_counted is null or p_counted < 0 then raise exception 'Jumlah hitung tidak valid'; end if;

  select pt.id, pt.task_type, pt.status, pt.picked_by_name, pt.item_id, it.sku,
         coalesce(pt.actual_from_bin_id, pt.from_bin_id) as src, coalesce(pt.actual_quantity, pt.quantity) as qty,
         w.status as wave_status
    into t
  from public.pick_tasks pt
  join public.items it on it.id = pt.item_id
  join public.waves w on w.id = pt.wave_id
  where pt.id = p_task_id
  for update of pt;

  if not found or t.task_type <> 'REPLENISH' or t.status <> 'COMPLETED' then
    raise exception 'Tugas pindahan belum selesai atau tidak ditemukan';
  end if;
  if t.wave_status = 'CANCELLED' then raise exception 'Wave dibatalkan: baris ini tidak diaudit'; end if;
  if t.qty = 0 then raise exception 'Baris ini tidak dipindah (0): tidak perlu diaudit'; end if;
  if public.same_person(v_checker, t.picked_by_name) then
    raise exception 'Checker tidak boleh petugas pindah baris ini (%)', t.picked_by_name;
  end if;

  select * into v_prev from public.move_source_audits where task_id = p_task_id order by attempt_no desc limit 1;
  if v_prev.id is not null and v_prev.result = 'OK' and not coalesce(p_correct, false) then
    raise exception 'Bin asal baris ini sudah lolos audit';
  end if;

  -- Same rule as the rack count (0031): another SKU found in the bin needs a note.
  v_found := public.rack_found_sku(p_found_sku, t.sku, p_note);
  select coalesce(sum(quantity), 0) into v_system from public.inventory where bin_id = t.src and item_id = t.item_id;
  v_result := case when p_counted = v_system and v_found is null then 'OK' else 'MISMATCH' end;
  if v_result <> 'OK' and nullif(trim(p_note), '') is null then
    raise exception 'Catatan wajib diisi bila sisa di bin asal tidak sesuai';
  end if;
  v_attempt := coalesce(v_prev.attempt_no, 0) + 1;

  insert into public.move_source_audits (task_id, attempt_no, checker_name, found_sku, system_qty, counted_qty, result, note,
    correction, created_by)
  values (p_task_id, v_attempt, v_checker, coalesce(v_found, t.sku), v_system, p_counted, v_result, nullif(trim(p_note), ''),
    coalesce(p_correct, false), auth.uid());

  -- The system count leaves the database only here, after the count is saved.
  return jsonb_build_object('result', v_result, 'attempt', v_attempt, 'system', v_system, 'counted', p_counted,
    'diff', p_counted - v_system, 'found_sku', v_found);
end $$;

revoke execute on function public.record_move_source_audit(uuid, text, numeric, text, text, boolean) from public, anon;
grant execute on function public.record_move_source_audit(uuid, text, numeric, text, text, boolean) to authenticated;

-- Realtime: the rack page refreshes when a source count lands.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication not found; skipping';
    return;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
                 and tablename = 'move_source_audits') then
    execute 'alter publication supabase_realtime add table public.move_source_audits';
  end if;
end $$;
