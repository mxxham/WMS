-- =====================================================================
-- 0019  Blind counts, recount by another person, count accuracy
--
--  OPEN     -> counted by a named person, who never sees the system qty
--  RECOUNT  -> the count was off from the system by more than the
--              tolerance of the bin's class: a DIFFERENT person counts
--              again, blind. Two counts that agree confirm the difference;
--              a recount that matches the system clears it; after three
--              counts the supervisor decides.
--  COUNTED  -> the supervisor applies (reason code; must not be one of the
--              counters) or closes it. A difference above the adjustment
--              limit can only be applied once two counts agree.
--  Every task keeps its count history and the system stock at the first
--  count, so accuracy (count_accuracy) is measured on real numbers.
-- =====================================================================

alter table public.count_tasks drop constraint count_tasks_status_check;
alter table public.count_tasks add constraint count_tasks_status_check
  check (status in ('OPEN', 'COUNTED', 'RECOUNT', 'APPLIED', 'CLOSED'));
alter table public.count_tasks drop constraint count_tasks_source_check;
alter table public.count_tasks add constraint count_tasks_source_check
  check (source in ('MANUAL', 'PUTAWAY', 'DATA_QUALITY', 'CYCLE', 'RECON', 'RECEIPT'));
drop index public.count_tasks_one_open_per_bin;
create unique index count_tasks_one_open_per_bin on public.count_tasks (bin_id) where status in ('OPEN', 'COUNTED', 'RECOUNT');

alter table public.count_tasks
  add column if not exists counts jsonb not null default '[]'::jsonb,  -- [{round, by_name, at, lines, variance}]
  add column if not exists counted_name text,                          -- last counter, as typed
  add column if not exists abc_class text,                             -- class of the bin at the first count
  add column if not exists system_at_count jsonb,                      -- system lines at the first count
  add column if not exists closed_name text,                           -- who applied / closed, as typed
  add column if not exists reason_code text,
  add column if not exists system_qty numeric,                         -- sum of system lines at the first count
  add column if not exists variance_qty numeric,                       -- sum |confirmed count - system| applied
  add column if not exists first_variance_qty numeric;                 -- sum |first count - system|

-- Lines [{sku, batch_lot, expiry_date, quantity}] -> one row per identity.
create or replace function public.count_line_set(p_lines jsonb)
returns table (sku text, batch_lot text, expiry_date date, qty numeric) language sql immutable as $$
  select c->>'sku', coalesce(c->>'batch_lot', ''), nullif(c->>'expiry_date', '')::date, sum((c->>'quantity')::numeric)
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) c
  group by 1, 2, 3;
$$;

-- Sum of |a - b| over every identity in either list.
create or replace function public.count_line_variance(a jsonb, b jsonb)
returns numeric language sql immutable as $$
  select coalesce(sum(abs(coalesce(x.qty, 0) - coalesce(y.qty, 0))), 0)
  from public.count_line_set(a) x
  full join public.count_line_set(b) y
    on x.sku = y.sku and x.batch_lot = y.batch_lot
   and coalesce(x.expiry_date, 'infinity'::date) = coalesce(y.expiry_date, 'infinity'::date);
$$;

-- System stock of a bin as count lines.
create or replace function public.bin_count_lines(p_bin uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('sku', it.sku, 'batch_lot', i.batch_lot, 'expiry_date', i.expiry_date,
                                               'quantity', i.quantity) order by it.sku, i.batch_lot, i.expiry_date), '[]'::jsonb)
  from public.inventory i join public.items it on it.id = i.item_id where i.bin_id = p_bin;
$$;

create or replace function public.bin_abc_class(p_bin uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(b.abc_class,
                  (select min(it.abc_class) from public.inventory i join public.items it on it.id = i.item_id where i.bin_id = b.id),
                  'C')
  from public.bins b where b.id = p_bin;
$$;

create or replace function public.create_count_task(p_bin_code text, p_reason text, p_source text default 'MANUAL')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_bin uuid; v_id uuid;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa membuat tugas hitung';
  end if;
  select id into v_bin from public.bins where bin_code = upper(trim(p_bin_code));
  if v_bin is null then raise exception 'Bin % tidak ada', p_bin_code; end if;
  insert into public.count_tasks (bin_id, reason, source, created_by)
  values (v_bin, coalesce(nullif(trim(p_reason), ''), 'Hitung ulang'), p_source, auth.uid())
  on conflict (bin_id) where status in ('OPEN', 'COUNTED', 'RECOUNT')
  do update set reason = public.count_tasks.reason || '; ' || excluded.reason
  returning id into v_id;
  return v_id;
end $$;

drop function public.submit_count(uuid, jsonb);
create function public.submit_count(p_task_id uuid, p_lines jsonb, p_by_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text := public.person_name(p_by_name, 'Nama penghitung'); t public.count_tasks%rowtype; r jsonb; v_known boolean;
  v_round int; v_system jsonb; v_var numeric; v_tol numeric; v_prev jsonb; v_status text; v_abc text; c jsonb;
  v_policy jsonb := public.inventory_policy();
begin
  select * into t from public.count_tasks where id = p_task_id for update;
  if t.id is null then raise exception 'Tugas hitung tidak ada'; end if;
  if t.status not in ('OPEN', 'COUNTED', 'RECOUNT') then raise exception 'Tugas hitung sudah ditutup'; end if;
  if jsonb_typeof(p_lines) <> 'array' then raise exception 'Format hasil hitung tidak valid'; end if;
  if t.status = 'RECOUNT' then
    for c in select * from jsonb_array_elements(t.counts) loop
      if public.same_person(v_name, c->>'by_name') then
        raise exception 'Hitung ulang harus oleh orang lain (bin ini sudah dihitung oleh %)', c->>'by_name';
      end if;
    end loop;
  end if;
  for r in select * from jsonb_array_elements(p_lines) loop
    if not exists (select 1 from public.items where sku = r->>'sku') then
      raise exception 'SKU % tidak ada di master data', r->>'sku';
    end if;
    if (r->>'quantity') is null or (r->>'quantity')::numeric < 0 then
      raise exception 'Qty SKU % tidak valid', r->>'sku';
    end if;
    -- Stock that is new to this bin needs an expiry date (FEFO depends on it).
    select exists (select 1 from public.inventory i join public.items it on it.id = i.item_id
                   where i.bin_id = t.bin_id and it.sku = r->>'sku' and i.batch_lot = coalesce(r->>'batch_lot', '')
                     and i.expiry_date is not distinct from nullif(r->>'expiry_date', '')::date) into v_known;
    if not v_known and (r->>'quantity')::numeric > 0 and nullif(r->>'expiry_date', '') is null then
      raise exception 'Tanggal expired wajib untuk SKU % batch % (belum ada di bin ini)', r->>'sku', coalesce(r->>'batch_lot', '');
    end if;
  end loop;

  v_round := jsonb_array_length(t.counts) + 1;
  v_system := public.bin_count_lines(t.bin_id);
  v_abc := coalesce(t.abc_class, public.bin_abc_class(t.bin_id));
  v_tol := coalesce((v_policy->'count_tolerance_qty'->>v_abc)::numeric, 0);
  v_var := public.count_line_variance(p_lines, v_system);
  v_prev := case when v_round > 1 then t.counts->(v_round - 2)->'lines' end;

  v_status := case
    when not (v_policy->>'recount_on_variance')::boolean or v_var <= v_tol then 'COUNTED'
    when v_round = 1 then 'RECOUNT'
    when public.count_line_variance(p_lines, v_prev) = 0 then 'COUNTED'   -- two counts agree: confirmed
    when v_round >= 3 then 'COUNTED'                                       -- supervisor decides
    else 'RECOUNT' end;

  update public.count_tasks set
    counts = counts || jsonb_build_array(jsonb_build_object('round', v_round, 'by_name', v_name, 'at', now(),
                                                            'lines', p_lines, 'variance', v_var)),
    counted = p_lines, status = v_status, counted_by = auth.uid(), counted_at = now(), counted_name = v_name,
    abc_class = v_abc,
    system_at_count = coalesce(system_at_count, v_system),
    system_qty = coalesce(system_qty, (select coalesce(sum(qty), 0) from public.count_line_set(v_system))),
    first_variance_qty = coalesce(first_variance_qty, v_var)
  where id = p_task_id;
  return jsonb_build_object('status', v_status, 'round', v_round);
end $$;

drop function public.apply_count(uuid, text);
create function public.apply_count(p_task_id uuid, p_note text, p_reason_code text, p_by_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text := public.person_name(p_by_name, 'Nama yang menerapkan'); t public.count_tasks%rowtype; v_bin text;
  d record; v_diff jsonb := '[]'::jsonb; v_moved int; c jsonb; v_total numeric; v_n int; v_confirmed boolean;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa menerapkan hasil hitung';
  end if;
  select * into t from public.count_tasks where id = p_task_id for update;
  if t.id is null then raise exception 'Tugas hitung tidak ada'; end if;
  if t.status = 'RECOUNT' then raise exception 'Bin ini menunggu hitung ulang oleh orang lain'; end if;
  if t.status <> 'COUNTED' then raise exception 'Tugas belum dihitung atau sudah ditutup'; end if;
  select bin_code into v_bin from public.bins where id = t.bin_id;
  for c in select * from jsonb_array_elements(t.counts) loop
    if public.same_person(v_name, c->>'by_name') then
      raise exception 'Yang menerapkan harus orang lain dari penghitung (%)', c->>'by_name';
    end if;
  end loop;

  select count(*) into v_moved from public.movements
  where (from_bin_id = t.bin_id or to_bin_id = t.bin_id) and created_at > t.counted_at;
  if v_moved > 0 then
    raise exception 'Stok bin % berubah setelah dihitung (% mutasi). Hitung ulang dulu, lalu terapkan.', v_bin, v_moved;
  end if;

  v_total := public.count_line_variance(t.counted, public.bin_count_lines(t.bin_id));
  if v_total > 0 and p_reason_code is null then raise exception 'Pilih kode alasan selisih'; end if;
  v_n := jsonb_array_length(t.counts);
  v_confirmed := v_n >= 2 and public.count_line_variance(t.counts->(v_n - 1)->'lines', t.counts->(v_n - 2)->'lines') = 0;
  if v_total > (public.inventory_policy()->>'adjust_approval_qty')::numeric and not v_confirmed then
    raise exception 'Selisih % unit di atas batas adjustment: perlu hitung ulang oleh orang lain dengan hasil yang sama', v_total;
  end if;

  perform set_config('app.adjust_approved', 'on', true);
  for d in
    with counted as (
      select it.id as item_id, c.sku, c.batch_lot, c.expiry_date, c.qty
      from public.count_line_set(t.counted) c join public.items it on it.sku = c.sku),
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
    insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note, reason_code, by_name, approved_by_name, ref_id)
    values ('adjustment', d.item_id, d.batch_lot, d.counted_qty - d.system_qty, t.bin_id, d.expiry_date,
            'HITUNG ' || v_bin || coalesce(': ' || nullif(trim(p_note), ''), ''), p_reason_code,
            coalesce(t.counted_name, v_name), v_name, t.id);
    v_diff := v_diff || jsonb_build_object('sku', d.sku, 'batch_lot', d.batch_lot, 'expiry_date', d.expiry_date,
                                           'system', d.system_qty, 'counted', d.counted_qty);
  end loop;
  perform set_config('app.adjust_approved', '', true);

  update public.count_tasks
  set status = 'APPLIED', applied_diff = v_diff, closed_by = auth.uid(), closed_at = now(), closed_name = v_name,
      close_note = nullif(trim(p_note), ''), reason_code = case when v_total > 0 then p_reason_code end, variance_qty = v_total,
      system_qty = coalesce(system_qty, (select coalesce(sum(qty), 0) from public.count_line_set(public.bin_count_lines(t.bin_id))))
  where id = p_task_id;
  return jsonb_build_object('adjustments', jsonb_array_length(v_diff), 'variance', v_total);
end $$;

drop function public.close_count(uuid, text);
create function public.close_count(p_task_id uuid, p_note text, p_by_name text)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text := public.person_name(p_by_name);
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa menutup tugas hitung';
  end if;
  if nullif(trim(p_note), '') is null then raise exception 'Alasan wajib diisi'; end if;
  update public.count_tasks set status = 'CLOSED', closed_by = auth.uid(), closed_at = now(), closed_name = v_name, close_note = trim(p_note)
  where id = p_task_id and status in ('OPEN', 'COUNTED', 'RECOUNT');
  if not found then raise exception 'Tugas hitung tidak ada atau sudah ditutup'; end if;
end $$;

-- count_task_detail (0010) with typed names and the new fields appended.
create or replace view public.count_task_detail with (security_invoker = true) as
select t.id, b.bin_code, t.status, t.reason, t.source, t.expected, t.counted, t.applied_diff,
       t.created_at, pc.name as created_by_name, t.counted_at, coalesce(t.counted_name, pn.name) as counted_by_name,
       t.closed_at, coalesce(t.closed_name, px.name) as closed_by_name, t.close_note,
       public.bin_count_lines(t.bin_id) as current,
       t.counts, t.abc_class, t.reason_code, t.system_qty, t.variance_qty, t.first_variance_qty,
       jsonb_array_length(t.counts) as rounds
from public.count_tasks t
join public.bins b on b.id = t.bin_id
left join public.profiles pc on pc.id = t.created_by
left join public.profiles pn on pn.id = t.counted_by
left join public.profiles px on px.id = t.closed_by;

-- cycle_count_status (0014): a RECOUNT task is an open task.
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
       exists (select 1 from public.count_tasks t where t.bin_id = c.id and t.status in ('OPEN', 'COUNTED', 'RECOUNT')) as open_task
from bin_class c
left join last_count lc on lc.bin_id = c.id;

-- One row per applied count: what the record said vs what was really there.
--   hit        confirmed difference within the class tolerance (location accuracy)
--   first_hit  the first count already agreed with the record
-- Counts applied before 0019 carry only their differing lines: system_qty is
-- null for them and they only feed the hit rate.
create or replace view public.count_accuracy with (security_invoker = true) as
select t.id, b.bin_code, coalesce(t.abc_class, public.bin_abc_class(t.bin_id)) as abc_class, t.closed_at, t.closed_name,
       t.system_qty,
       coalesce(t.variance_qty, (select coalesce(sum(abs((d->>'counted')::numeric - (d->>'system')::numeric)), 0)
                                 from jsonb_array_elements(coalesce(t.applied_diff, '[]'::jsonb)) d)) as variance_qty,
       t.first_variance_qty, jsonb_array_length(t.counts) as rounds, t.reason_code,
       coalesce((public.inventory_policy()->'count_tolerance_qty'->>coalesce(t.abc_class, public.bin_abc_class(t.bin_id)))::numeric, 0) as tolerance,
       t.source
from public.count_tasks t join public.bins b on b.id = t.bin_id
where t.status = 'APPLIED';

grant select on public.count_accuracy to authenticated;
grant execute on function public.count_line_set(jsonb), public.count_line_variance(jsonb, jsonb),
  public.bin_count_lines(uuid), public.bin_abc_class(uuid) to authenticated;
revoke execute on function public.submit_count(uuid, jsonb, text), public.apply_count(uuid, text, text, text),
  public.close_count(uuid, text, text) from public, anon;
grant execute on function public.submit_count(uuid, jsonb, text), public.apply_count(uuid, text, text, text),
  public.close_count(uuid, text, text) to authenticated;
