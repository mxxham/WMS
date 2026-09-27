-- =====================================================================
-- 0014  Cycle counting on top of the count tasks of 0010 (Hitung stok)
--
--  plan_cycle_counts   Opens count tasks (source CYCLE) for rack bins that
--                      are due: class A every 30 days, B every 90, C and
--                      empty bins every 180 (bin class = bins.abc_class,
--                      else the best class of its stock, else C). Most
--                      overdue first, A before B before C; bins with an
--                      open count or open wave tasks are skipped.
--  cycle_count_status  One row per active rack bin: class, last count,
--                      due date. Drives the schedule card.
--  apply_count         Now refused when the bin moved after it was counted:
--                      the count no longer describes the stock, recount.
-- =====================================================================

alter table public.count_tasks drop constraint count_tasks_source_check;
alter table public.count_tasks add constraint count_tasks_source_check
  check (source in ('MANUAL', 'PUTAWAY', 'DATA_QUALITY', 'CYCLE'));

create or replace view public.cycle_count_status with (security_invoker = true) as
with bin_class as (
  select b.id, b.bin_code, b.zone,
         coalesce(b.abc_class,
                  (select min(it.abc_class) from public.inventory i join public.items it on it.id = i.item_id where i.bin_id = b.id),
                  'C') as abc_class,
         exists (select 1 from public.inventory i where i.bin_id = b.id) as has_stock
  from public.bins b
  where b.rack is not null and b.status = 'active'
),
last_count as (
  select bin_id, max(counted_at) as counted_at
  from public.count_tasks where status = 'APPLIED' or (status = 'CLOSED' and counted_at is not null)
  group by bin_id
)
select c.id as bin_id, c.bin_code, c.zone, c.abc_class, c.has_stock,
       case c.abc_class when 'A' then 30 when 'B' then 90 else 180 end as interval_days,
       lc.counted_at as last_counted_at,
       (lc.counted_at + make_interval(days => case c.abc_class when 'A' then 30 when 'B' then 90 else 180 end))::date as due_date,
       exists (select 1 from public.count_tasks t where t.bin_id = c.id and t.status in ('OPEN', 'COUNTED')) as open_task
from bin_class c
left join last_count lc on lc.bin_id = c.id;

create or replace function public.plan_cycle_counts(p_max int default 20)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa membuat jadwal cycle count';
  end if;
  if p_max is null or p_max < 1 or p_max > 500 then raise exception 'Jumlah bin 1–500'; end if;

  for r in
    select s.* from public.cycle_count_status s
    where not s.open_task
      and (s.due_date is null or s.due_date <= current_date)
      and not exists (select 1 from public.open_pick_tasks t where t.from_bin_id = s.bin_id or t.to_bin_id = s.bin_id)
    order by
      -- never counted bins with stock first, then the most overdue relative to the interval
      case when s.last_counted_at is null and s.has_stock then 0 when s.last_counted_at is null then 2 else 1 end,
      coalesce((current_date - s.due_date)::numeric / s.interval_days, 0) desc,
      s.abc_class, s.bin_code
    limit p_max
  loop
    insert into public.count_tasks (bin_id, reason, source, created_by)
    values (r.bin_id,
            'Cycle count kelas ' || r.abc_class || coalesce(' (terakhir ' || to_char(r.last_counted_at at time zone 'Asia/Jakarta', 'DD-MM-YYYY') || ')', ' (belum pernah dihitung)'),
            'CYCLE', auth.uid());
    n := n + 1;
  end loop;
  return jsonb_build_object('created', n);
end $$;

-- 0010's apply_count, plus: refuse when stock in the bin moved after the count.
create or replace function public.apply_count(p_task_id uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.count_tasks%rowtype; v_bin text; d record; v_diff jsonb := '[]'::jsonb; v_moved int;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa menerapkan hasil hitung';
  end if;
  select * into t from public.count_tasks where id = p_task_id for update;
  if t.id is null then raise exception 'Tugas hitung tidak ada'; end if;
  if t.status <> 'COUNTED' then raise exception 'Tugas belum dihitung atau sudah ditutup'; end if;
  select bin_code into v_bin from public.bins where id = t.bin_id;

  select count(*) into v_moved from public.movements
  where (from_bin_id = t.bin_id or to_bin_id = t.bin_id) and created_at > t.counted_at;
  if v_moved > 0 then
    raise exception 'Stok bin % berubah setelah dihitung (% mutasi). Hitung ulang dulu, lalu terapkan.', v_bin, v_moved;
  end if;

  for d in
    with counted as (
      select it.id as item_id, it.sku, coalesce(c->>'batch_lot', '') as batch_lot,
             nullif(c->>'expiry_date', '')::date as expiry_date, sum((c->>'quantity')::numeric) as qty
      from jsonb_array_elements(t.counted) c join public.items it on it.sku = c->>'sku'
      group by 1, 2, 3, 4),
    system as (
      select i.item_id, it.sku, i.batch_lot, i.expiry_date, i.quantity as qty
      from public.inventory i join public.items it on it.id = i.item_id where i.bin_id = t.bin_id)
    select coalesce(c.item_id, s.item_id) as item_id, coalesce(c.sku, s.sku) as sku,
           coalesce(c.batch_lot, s.batch_lot) as batch_lot, coalesce(c.expiry_date, s.expiry_date) as expiry_date,
           coalesce(s.qty, 0) as system_qty, coalesce(c.qty, 0) as counted_qty
    from counted c
    full join system s on s.item_id = c.item_id and s.batch_lot = c.batch_lot
      and coalesce(s.expiry_date, 'infinity'::date) = coalesce(c.expiry_date, 'infinity'::date)
    where coalesce(c.qty, 0) <> coalesce(s.qty, 0)
    order by 2, 3, 4
  loop
    insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
    values ('adjustment', d.item_id, d.batch_lot, d.counted_qty - d.system_qty, t.bin_id, d.expiry_date,
            'HITUNG ' || v_bin || coalesce(': ' || nullif(trim(p_note), ''), ''));
    v_diff := v_diff || jsonb_build_object('sku', d.sku, 'batch_lot', d.batch_lot, 'expiry_date', d.expiry_date,
                                           'system', d.system_qty, 'counted', d.counted_qty);
  end loop;

  update public.count_tasks
  set status = 'APPLIED', applied_diff = v_diff, closed_by = auth.uid(), closed_at = now(), close_note = nullif(trim(p_note), '')
  where id = p_task_id;
  return jsonb_build_object('adjustments', jsonb_array_length(v_diff));
end $$;

grant select on public.cycle_count_status to authenticated;
revoke execute on function public.plan_cycle_counts(int) from public, anon;
grant execute on function public.plan_cycle_counts(int) to authenticated;
