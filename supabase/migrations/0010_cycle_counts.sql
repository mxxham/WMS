-- =====================================================================
-- 0010  Cycle counts
--
--  A count task says "recount this bin". It is opened by a supervisor, by
--  the putaway import (unresolved qty_differs / bin_occupied conflicts), or
--  from the data quality page. One open task per bin.
--
--    OPEN      -> any user records what is physically in the bin (the whole
--                 bin: every SKU/batch/expiry found, 0 allowed)   submit_count
--    COUNTED   -> supervisor applies the difference as adjustments, or
--                 closes the task without changing stock           apply_count
--    APPLIED / CLOSED                                              close_count
--  A COUNTED task may be counted again before it is applied.
-- =====================================================================

create table public.count_tasks (
  id           uuid primary key default gen_random_uuid(),
  bin_id       uuid not null references public.bins(id),
  status       text not null default 'OPEN' check (status in ('OPEN', 'COUNTED', 'APPLIED', 'CLOSED')),
  reason       text not null,
  source       text not null default 'MANUAL' check (source in ('MANUAL', 'PUTAWAY', 'DATA_QUALITY')),
  expected     jsonb not null default '[]'::jsonb,   -- what the sheet / check claimed
  counted      jsonb,                               -- [{sku, batch_lot, expiry_date, quantity}]
  applied_diff jsonb,                               -- adjustments posted by apply_count
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  counted_by   uuid references public.profiles(id),
  counted_at   timestamptz,
  closed_by    uuid references public.profiles(id),
  closed_at    timestamptz,
  close_note   text
);
create unique index count_tasks_one_open_per_bin on public.count_tasks (bin_id) where status in ('OPEN', 'COUNTED');
create index count_tasks_status_idx on public.count_tasks (status, created_at desc);

alter table public.count_tasks enable row level security;
create policy "count_tasks: read" on public.count_tasks for select to authenticated using (true);
-- No write policies: changes go through the functions below.

create or replace view public.count_task_detail with (security_invoker = true) as
select t.id, b.bin_code, t.status, t.reason, t.source, t.expected, t.counted, t.applied_diff,
       t.created_at, pc.name as created_by_name, t.counted_at, pn.name as counted_by_name,
       t.closed_at, px.name as closed_by_name, t.close_note,
       (select coalesce(jsonb_agg(jsonb_build_object('sku', it.sku, 'description', it.description, 'batch_lot', i.batch_lot,
                 'expiry_date', i.expiry_date, 'quantity', i.quantity) order by it.sku, i.batch_lot, i.expiry_date), '[]'::jsonb)
          from public.inventory i join public.items it on it.id = i.item_id where i.bin_id = t.bin_id) as current
from public.count_tasks t
join public.bins b on b.id = t.bin_id
left join public.profiles pc on pc.id = t.created_by
left join public.profiles pn on pn.id = t.counted_by
left join public.profiles px on px.id = t.closed_by;

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
  on conflict (bin_id) where status in ('OPEN', 'COUNTED')
  do update set reason = public.count_tasks.reason || '; ' || excluded.reason
  returning id into v_id;
  return v_id;
end $$;

-- p_lines: every SKU/batch/expiry physically found in the bin. [] = bin is empty.
create or replace function public.submit_count(p_task_id uuid, p_lines jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare t public.count_tasks%rowtype; r jsonb; v_known boolean;
begin
  select * into t from public.count_tasks where id = p_task_id for update;
  if t.id is null then raise exception 'Tugas hitung tidak ada'; end if;
  if t.status not in ('OPEN', 'COUNTED') then raise exception 'Tugas hitung sudah ditutup'; end if;
  if jsonb_typeof(p_lines) <> 'array' then raise exception 'Format hasil hitung tidak valid'; end if;

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

  update public.count_tasks
  set counted = p_lines, status = 'COUNTED', counted_by = auth.uid(), counted_at = now()
  where id = p_task_id;
end $$;

-- Posts counted - system for every identity in the bin (a count covers the whole bin).
create or replace function public.apply_count(p_task_id uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.count_tasks%rowtype; v_bin text; d record; v_diff jsonb := '[]'::jsonb;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa menerapkan hasil hitung';
  end if;
  select * into t from public.count_tasks where id = p_task_id for update;
  if t.id is null then raise exception 'Tugas hitung tidak ada'; end if;
  if t.status <> 'COUNTED' then raise exception 'Tugas belum dihitung atau sudah ditutup'; end if;
  select bin_code into v_bin from public.bins where id = t.bin_id;

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
      -- FULL JOIN needs a hashable condition: compare no-expiry as 'infinity' (like inventory_identity_uq).
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

create or replace function public.close_count(p_task_id uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa menutup tugas hitung';
  end if;
  if nullif(trim(p_note), '') is null then raise exception 'Alasan wajib diisi'; end if;
  update public.count_tasks set status = 'CLOSED', closed_by = auth.uid(), closed_at = now(), close_note = trim(p_note)
  where id = p_task_id and status in ('OPEN', 'COUNTED');
  if not found then raise exception 'Tugas hitung tidak ada atau sudah ditutup'; end if;
end $$;

-- ---------------------------------------------------------------------
-- putaway_import (0008) + count tasks for unresolved conflicts on posting
-- ---------------------------------------------------------------------
create or replace function public.putaway_import(p_rows jsonb, p_source text, p_apply boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; v_bin public.bins%rowtype; v_item uuid; v_batch text; v_exp date; v_qty numeric;
  v_action text; v_status text; v_kind text; v_current jsonb; v_match numeric; v_others int;
  v_note text; t record; out jsonb := '[]'::jsonb; n_moves int := 0; n_counts int := 0;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa import putaway';
  end if;

  drop table if exists _putaway;
  create temp table _putaway (line int, bin_id uuid, item_id uuid, batch_lot text, expiry_date date,
    quantity numeric, current_qty numeric, status text, action text) on commit drop;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_batch := coalesce(r->>'batch_lot', '');
    v_exp := (r->>'expiry_date')::date;
    v_qty := (r->>'quantity')::numeric;
    v_action := r->>'action';               -- null | 'add' | 'set'
    v_kind := null; v_current := '[]'::jsonb; v_item := null;

    select * into v_bin from public.bins where bin_code = r->>'bin_code';
    select id into v_item from public.items where sku = r->>'sku';

    if v_bin.id is null then v_kind := 'bin_unknown';
    elsif v_bin.status = 'blocked' then v_kind := 'bin_blocked';
    elsif v_item is null then v_kind := 'sku_unknown';
    else
      select coalesce(jsonb_agg(jsonb_build_object('sku', it.sku, 'batch_lot', i.batch_lot,
               'expiry_date', i.expiry_date, 'quantity', i.quantity) order by it.sku, i.batch_lot), '[]'::jsonb),
             max(i.quantity) filter (where i.item_id = v_item and i.batch_lot = v_batch
                                       and i.expiry_date is not distinct from v_exp),
             count(*) filter (where not (i.item_id = v_item and i.batch_lot = v_batch
                                           and i.expiry_date is not distinct from v_exp))
        into v_current, v_match, v_others
      from public.inventory i join public.items it on it.id = i.item_id
      where i.bin_id = v_bin.id;

      if v_match is not null and v_match <> v_qty then v_kind := 'qty_differs';
      elsif v_match is null and v_others > 0 then v_kind := 'bin_occupied';
      end if;
    end if;

    v_status := case when v_kind is not null then 'conflict'
                     when v_match is not null then 'same' else 'new' end;

    -- A resolution only counts where it makes sense for that conflict.
    if v_status <> 'conflict' or not (
         (v_kind = 'qty_differs' and v_action in ('add', 'set')) or
         (v_kind = 'bin_occupied' and v_action = 'add')) then
      v_action := null;
    end if;

    insert into _putaway values ((r->>'line')::int, v_bin.id, v_item, v_batch, v_exp, v_qty, v_match, v_status, v_action);
    out := out || jsonb_build_object('line', (r->>'line')::int, 'status', v_status, 'kind', v_kind,
                                     'action', v_action, 'current', v_current);
  end loop;

  if p_apply then
    for t in select * from _putaway where status = 'new' or action is not null order by line loop
      v_note := 'PUTAWAY ' || coalesce(p_source, 'file') || ' baris ' || t.line;
      if t.action = 'set' then
        insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
        values ('adjustment', t.item_id, t.batch_lot, t.quantity - t.current_qty, t.bin_id, t.expiry_date, v_note || ' (disamakan)');
      else
        insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
        values ('putaway', t.item_id, t.batch_lot, t.quantity, t.bin_id, t.expiry_date,
                v_note || case when t.action = 'add' then ' (ditambahkan)' else '' end);
      end if;
      n_moves := n_moves + 1;
    end loop;

    -- Unresolved "the sheet and the system disagree about this bin" rows become
    -- count tasks. One open task per bin; later sheet lines are appended to it.
    for t in select p.*, it.sku from _putaway p join public.items it on it.id = p.item_id
             where p.status = 'conflict' and p.action is null and p.bin_id is not null order by p.line loop
      insert into public.count_tasks (bin_id, reason, source, expected, created_by)
      values (t.bin_id, 'Putaway: isi sheet berbeda dengan sistem', 'PUTAWAY',
              jsonb_build_array(jsonb_build_object('source', p_source, 'line', t.line, 'sku', t.sku,
                'batch_lot', t.batch_lot, 'expiry_date', t.expiry_date, 'quantity', t.quantity)), auth.uid())
      on conflict (bin_id) where status in ('OPEN', 'COUNTED')
      do update set expected = public.count_tasks.expected || excluded.expected;
      n_counts := n_counts + 1;
    end loop;
  end if;

  return jsonb_build_object('rows', out, 'movements', n_moves, 'count_tasks', n_counts);
end $$;


grant select on public.count_tasks, public.count_task_detail to authenticated;
grant all on public.count_tasks to service_role;
revoke execute on function public.create_count_task(text, text, text) from public, anon;
revoke execute on function public.submit_count(uuid, jsonb) from public, anon;
revoke execute on function public.apply_count(uuid, text) from public, anon;
revoke execute on function public.close_count(uuid, text) from public, anon;
grant execute on function public.create_count_task(text, text, text) to authenticated;
grant execute on function public.submit_count(uuid, jsonb) to authenticated;
grant execute on function public.apply_count(uuid, text) to authenticated;
grant execute on function public.close_count(uuid, text) to authenticated;
