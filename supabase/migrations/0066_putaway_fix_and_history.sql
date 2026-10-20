-- =====================================================================
-- 0066  Putaway: "Sheet benar" fixes the bin, and every sheet line is kept
--
--  9 Oct analysis of 8 Oct: six putaway rows (86 cartons) were stopped as
--  conflicts and never posted. CA06C01/CA06C02 held 4 IAGO drums each on the
--  floor, while the system still had 36 Helix there (really in CA02D02). The
--  page could only add the pallet beside the wrong stock or overwrite one
--  quantity; correcting the bin meant leaving the page. Once a conflict was
--  resolved or its count task closed, nothing showed what it had been.
--
--  · Action 'fix' (bin_occupied, qty_differs, moved_in): the sheet is right.
--    Every line the system holds in that bin gets a decision: keep, the
--    counted quantity, remove, or move to the bin it is really in. Moves post
--    as transfers; adjustments within adjust_approval_qty post directly
--    (COUNT_VARIANCE); larger ones become an adjustment request for a second
--    person (Adjust stok). The sheet's pallet then posts as the putaway.
--    Refused per row, never silently: the bin changed since the check,
--    stock reserved for an open wave, held stock, an unknown or blocked bin.
--  · putaway_log keeps every posted sheet line: what the sheet said, the
--    verdict, the bin as the system had it at that moment, the decision and
--    its result, with the movements / requests / count task it made.
--    Written only here; no write policy.
-- =====================================================================

create table public.putaway_log (
  id            uuid primary key default gen_random_uuid(),
  import_id     uuid not null,
  posted_at     timestamptz not null default now(),
  posted_by     uuid references public.profiles(id) default auth.uid(),
  by_name       text,
  source        text,
  line          int,
  sheet_bin     text,
  bin_code      text,
  sku           text,
  batch_lot     text,
  expiry_date   date,
  quantity      numeric,
  status        text not null,
  kind          text,
  action        text,
  system_before jsonb not null default '[]'::jsonb,
  moved_in      jsonb,
  fix           jsonb,
  fix_error     text,
  result        text not null check (result in ('posted', 'set', 'fixed', 'count_task', 'same', 'skipped')),
  movement_ids  uuid[] not null default '{}',
  request_ids   uuid[] not null default '{}',
  count_task_id uuid references public.count_tasks(id)
);
create index putaway_log_posted_idx on public.putaway_log (posted_at desc);
create index putaway_log_import_idx on public.putaway_log (import_id, line);
alter table public.putaway_log enable row level security;
create policy "putaway_log: read" on public.putaway_log for select to authenticated using (true);
grant select on public.putaway_log to authenticated;

-- Is a fix (one decision per line the bin holds) still valid for this bin now?
-- Returns the reason it is not, or null.
create or replace function public.putaway_fix_error(p_bin uuid, p_fix jsonb)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  f jsonb; v_cur record; v_n int := 0; v_choice text; v_after numeric; v_reserved numeric; v_waves text;
  v_to public.bins%rowtype; v_item uuid; v_exp date; v_code text;
begin
  select bin_code into v_code from public.bins where id = p_bin;
  if jsonb_typeof(coalesce(p_fix, 'null'::jsonb)) <> 'array' then return 'Keputusan isi bin belum diisi'; end if;
  -- Every line the bin holds needs exactly one decision, against the quantity that was shown.
  for v_cur in select i.item_id, it.sku, i.batch_lot, i.expiry_date, i.quantity
               from public.inventory i join public.items it on it.id = i.item_id
               where i.bin_id = p_bin and i.quantity <> 0 loop
    v_n := v_n + 1;
    select e into f from jsonb_array_elements(p_fix) e
    where e->>'sku' = v_cur.sku and coalesce(e->>'batch_lot', '') = v_cur.batch_lot
      and nullif(e->>'expiry_date', '')::date is not distinct from v_cur.expiry_date
    limit 1;
    if f is null or (f->>'quantity')::numeric is distinct from v_cur.quantity then
      return format('Isi bin %s berubah sejak diperiksa (%s batch %s sekarang %s): periksa lagi', v_code, v_cur.sku, coalesce(nullif(v_cur.batch_lot, ''), '–'), v_cur.quantity);
    end if;
  end loop;
  if jsonb_array_length(p_fix) <> v_n then
    return format('Isi bin %s berubah sejak diperiksa: periksa lagi', v_code);
  end if;

  for f in select e from jsonb_array_elements(p_fix) e loop
    v_choice := f->>'choice';
    select id into v_item from public.items where sku = f->>'sku';
    v_exp := nullif(f->>'expiry_date', '')::date;
    if v_choice = 'keep' then v_after := (f->>'quantity')::numeric;
    elsif v_choice = 'count' then
      if (f->>'counted') is null or (f->>'counted') !~ '^\d+(\.\d+)?$' then
        return format('%s batch %s: isi jumlah sebenarnya', f->>'sku', coalesce(nullif(f->>'batch_lot', ''), '–'));
      end if;
      v_after := (f->>'counted')::numeric;
    elsif v_choice = 'remove' then v_after := 0;
    elsif v_choice = 'move' then
      v_after := 0;
      select * into v_to from public.bins where bin_code = upper(trim(coalesce(f->>'move_to', '')));
      if v_to.id is null then return format('%s: bin tujuan %s tidak ada', f->>'sku', coalesce(nullif(trim(f->>'move_to'), ''), '(kosong)')); end if;
      if v_to.status = 'blocked' then return format('%s: bin tujuan %s diblokir', f->>'sku', v_to.bin_code); end if;
      if v_to.id = p_bin then return format('%s: bin tujuan sama dengan bin ini', f->>'sku'); end if;
    else
      return format('%s batch %s: pilih keputusan', f->>'sku', coalesce(nullif(f->>'batch_lot', ''), '–'));
    end if;

    if v_after < (f->>'quantity')::numeric then
      -- Stock an open wave will pick stays; held stock is released on its own page first.
      select coalesce(sum(t.quantity), 0), string_agg(distinct 'NO ' || w.wave_no || ' (' || w.planned_date || ') #' || t.seq, ', ')
        into v_reserved, v_waves
      from public.open_pick_tasks t join public.waves w on w.id = t.wave_id
      where t.from_bin_id = p_bin and t.item_id = v_item and t.batch_lot = coalesce(f->>'batch_lot', '')
        and t.expiry_date is not distinct from v_exp;
      if v_reserved > v_after then
        return format('%s batch %s dipesan %s untuk wave %s: kerjakan atau ubah wave dulu', f->>'sku',
                      coalesce(nullif(f->>'batch_lot', ''), '–'), v_reserved, v_waves);
      end if;
      if public.held_qty(p_bin, v_item, coalesce(f->>'batch_lot', ''), v_exp, (f->>'quantity')::numeric) > 0 then
        return format('%s batch %s sedang ditahan (hold): lepas dulu di halaman Hold', f->>'sku', coalesce(nullif(f->>'batch_lot', ''), '–'));
      end if;
    end if;
  end loop;
  return null;
end $$;
revoke execute on function public.putaway_fix_error(uuid, jsonb) from public, anon, authenticated;

-- Carries out a checked fix. Returns the movements and adjustment requests it made.
create or replace function public.putaway_fix_apply(p_bin uuid, p_fix jsonb, p_note text, p_name text, p_limit numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  f jsonb; v_item uuid; v_exp date; v_batch text; v_qty numeric; v_delta numeric; v_to uuid; v_code text;
  v_mov uuid; v_req uuid; v_movs uuid[] := '{}'; v_reqs uuid[] := '{}';
begin
  select bin_code into v_code from public.bins where id = p_bin;
  for f in select e from jsonb_array_elements(p_fix) e loop
    select id into v_item from public.items where sku = f->>'sku';
    v_batch := coalesce(f->>'batch_lot', ''); v_exp := nullif(f->>'expiry_date', '')::date;
    v_qty := (f->>'quantity')::numeric;
    if f->>'choice' = 'move' then
      select id into v_to from public.bins where bin_code = upper(trim(f->>'move_to'));
      insert into public.movements (type, item_id, batch_lot, quantity, from_bin_id, to_bin_id, expiry_date, by_name, note)
      values ('transfer', v_item, v_batch, v_qty, p_bin, v_to, v_exp, p_name, p_note || ': stok lama dipindah ke ' || upper(trim(f->>'move_to')))
      returning id into v_mov;
      v_movs := v_movs || v_mov;
      continue;
    end if;
    v_delta := case f->>'choice' when 'remove' then -v_qty when 'count' then (f->>'counted')::numeric - v_qty else 0 end;
    continue when v_delta = 0;
    if abs(v_delta) > p_limit then
      -- Above the limit: a second person decides in Adjust stok.
      v_req := public.request_adjustment(v_code, f->>'sku', v_batch, v_exp, v_delta, 'COUNT_VARIANCE',
        p_note || case f->>'choice' when 'remove' then ': stok lama tidak ada di bin' else ': jumlah sebenarnya ' || (f->>'counted') end, p_name);
      v_reqs := v_reqs || v_req;
    else
      perform set_config('app.adjust_approved', 'on', true);
      insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, reason_code, by_name, note)
      values ('adjustment', v_item, v_batch, v_delta, p_bin, v_exp, 'COUNT_VARIANCE', p_name,
              p_note || case f->>'choice' when 'remove' then ': stok lama tidak ada di bin' else ': jumlah sebenarnya ' || (f->>'counted') end)
      returning id into v_mov;
      perform set_config('app.adjust_approved', '', true);
      v_movs := v_movs || v_mov;
    end if;
  end loop;
  return jsonb_build_object('movement_ids', to_jsonb(v_movs), 'request_ids', to_jsonb(v_reqs));
end $$;
revoke execute on function public.putaway_fix_apply(uuid, jsonb, text, text, numeric) from public, anon, authenticated;

drop function public.putaway_import(jsonb, text, boolean);
create function public.putaway_import(p_rows jsonb, p_source text, p_apply boolean, p_by_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; v_bin public.bins%rowtype; v_item uuid; v_batch text; v_exp date; v_qty numeric;
  v_action text; v_status text; v_kind text; v_current jsonb; v_match numeric; v_others int; v_moved jsonb;
  v_note text; t record; out jsonb := '[]'::jsonb; n_moves int := 0; n_counts int := 0; n_requests int := 0;
  v_limit numeric := (public.inventory_policy()->>'adjust_approval_qty')::numeric; v_over jsonb := '[]'::jsonb; v_expected date;
  v_fix jsonb; v_fix_error text; v_fixed_bins uuid[] := '{}'; v_name text; v_import uuid := gen_random_uuid();
  v_mov uuid; v_res jsonb; v_movs uuid[]; v_reqs uuid[]; v_count uuid; v_result text;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa import putaway';
  end if;
  perform set_config('app.adjust_reason', 'RECEIVING_DIFF', true);
  perform set_config('app.by_name', 'putaway ' || coalesce(p_source, 'file'), true);

  drop table if exists _putaway;
  create temp table _putaway (line int, bin_id uuid, item_id uuid, batch_lot text, expiry_date date,
    quantity numeric, current_qty numeric, status text, action text, sheet_bin text,
    kind text, current jsonb, moved_in jsonb, fix jsonb, fix_error text) on commit drop;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_batch := coalesce(r->>'batch_lot', '');
    v_exp := (r->>'expiry_date')::date;
    v_qty := (r->>'quantity')::numeric;
    v_action := r->>'action';               -- null | 'add' | 'set' | 'fix'
    v_kind := null; v_current := '[]'::jsonb; v_item := null; v_moved := null; v_fix := null; v_fix_error := null;

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

      -- 0059: this SKU came into the bin by Bin To Bin in the last two days.
      select jsonb_build_object('quantity', m.quantity, 'from_bin', fb.bin_code, 'batch_lot', m.batch_lot,
               'at', m.created_at, 'note', m.note)
        into v_moved
      from public.movements m left join public.bins fb on fb.id = m.from_bin_id
      where m.type = 'transfer' and m.to_bin_id = v_bin.id and m.item_id = v_item
        and m.created_at >= now() - interval '2 days'
      order by m.created_at desc limit 1;

      if v_moved is not null then v_kind := 'moved_in';
      elsif v_match is not null and v_match <> v_qty then v_kind := 'qty_differs';
      elsif v_match is null and v_others > 0 then v_kind := 'bin_occupied';
      end if;
    end if;

    v_status := case when v_kind is not null then 'conflict'
                     when v_match is not null then 'same' else 'new' end;

    -- A resolution only counts where it makes sense for that conflict.
    if v_status <> 'conflict' or not (
         (v_kind = 'qty_differs' and v_action in ('add', 'set', 'fix')) or
         (v_kind = 'bin_occupied' and v_action in ('add', 'fix')) or
         (v_kind = 'moved_in' and v_action in ('add', 'fix'))) then
      v_action := null;
    end if;

    if v_action = 'set' and abs(v_qty - v_match) > v_limit then
      -- Above the adjustment limit a sheet cannot overwrite stock: it becomes a count task.
      v_over := v_over || to_jsonb((r->>'line')::int);
      v_action := null;
    end if;

    -- 0066: the sheet is right; the bin's lines each have a decision.
    if v_action = 'fix' then
      v_fix := r->'fix';
      if v_bin.id = any(v_fixed_bins) then
        v_fix_error := format('Bin %s sudah dibetulkan di baris lain sheet ini', v_bin.bin_code);
      else
        v_fix_error := public.putaway_fix_error(v_bin.id, v_fix);
      end if;
      if v_fix_error is null then v_fixed_bins := v_fixed_bins || v_bin.id; else v_action := null; end if;
    end if;

    insert into _putaway values ((r->>'line')::int, v_bin.id, v_item, v_batch, v_exp, v_qty, v_match, v_status, v_action,
      nullif(upper(trim(r->>'sheet_bin')), upper(trim(r->>'bin_code'))), v_kind, v_current, v_moved, v_fix, v_fix_error);
    -- A date-coded batch whose expiry disagrees with the batch code (warning only).
    v_expected := case when v_item is not null then public.batch_expected_expiry(v_item, v_batch) end;
    out := out || jsonb_build_object('line', (r->>'line')::int, 'status', v_status, 'kind', v_kind,
                                     'action', v_action, 'current', v_current, 'moved_in', v_moved, 'fix_error', v_fix_error,
                                     'expiry_expected', case when v_expected is distinct from v_exp then v_expected end);
  end loop;

  if p_apply then
    if exists (select 1 from _putaway where action = 'fix') then
      v_name := public.person_name(p_by_name, 'Nama Anda');
    else
      v_name := nullif(trim(coalesce(p_by_name, '')), '');
    end if;

    for t in select p.*, it.sku, b.bin_code from _putaway p
             left join public.items it on it.id = p.item_id left join public.bins b on b.id = p.bin_id
             order by p.line loop
      v_movs := '{}'; v_reqs := '{}'; v_count := null; v_result := null;
      v_note := 'PUTAWAY ' || coalesce(p_source, 'file') || ' baris ' || t.line
        || coalesce(' (di sheet ' || t.sheet_bin || ', ditaruh di ' || t.bin_code || ')', '');

      -- A fix is checked again right before it runs: an earlier line may have changed the bin.
      if t.action = 'fix' then
        t.fix_error := public.putaway_fix_error(t.bin_id, t.fix);
        if t.fix_error is not null then
          t.action := null;
          update _putaway set action = null, fix_error = t.fix_error where line = t.line;
        end if;
      end if;

      if t.status = 'new' or t.action is not null then
        perform set_config('app.adjust_approved', 'on', true);  -- 'set' rows are within the limit (checked above)
        if t.action = 'fix' then
          v_res := public.putaway_fix_apply(t.bin_id, t.fix, v_note || ' (sheet benar)', v_name, v_limit);
          select coalesce(array_agg(x::uuid), '{}') into v_movs from jsonb_array_elements_text(v_res->'movement_ids') x;
          select coalesce(array_agg(x::uuid), '{}') into v_reqs from jsonb_array_elements_text(v_res->'request_ids') x;
          n_requests := n_requests + coalesce(array_length(v_reqs, 1), 0);
        end if;
        if t.action = 'set' then
          insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
          values ('adjustment', t.item_id, t.batch_lot, t.quantity - t.current_qty, t.bin_id, t.expiry_date, v_note || ' (disamakan)')
          returning id into v_mov;
        else
          insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
          values ('putaway', t.item_id, t.batch_lot, t.quantity, t.bin_id, t.expiry_date,
                  v_note || case t.action when 'add' then ' (ditambahkan)' when 'fix' then ' (sheet benar)' else '' end)
          returning id into v_mov;
        end if;
        perform set_config('app.adjust_approved', '', true);
        v_movs := v_movs || v_mov;
        n_moves := n_moves + 1;
        v_result := case t.action when 'set' then 'set' when 'fix' then 'fixed' else 'posted' end;
      elsif t.status = 'conflict' and t.bin_id is not null and t.item_id is not null then
        -- Unresolved "the sheet and the system disagree about this bin" rows become
        -- count tasks. One open task per bin; later sheet lines are appended to it.
        insert into public.count_tasks (bin_id, reason, source, expected, created_by)
        values (t.bin_id, 'Putaway: isi sheet berbeda dengan sistem', 'PUTAWAY',
                jsonb_build_array(jsonb_build_object('source', p_source, 'line', t.line, 'sku', t.sku,
                  'batch_lot', t.batch_lot, 'expiry_date', t.expiry_date, 'quantity', t.quantity)), auth.uid())
        on conflict (bin_id) where status in ('OPEN', 'COUNTED', 'RECOUNT')
        do update set expected = public.count_tasks.expected || excluded.expected
        returning id into v_count;
        n_counts := n_counts + 1;
        v_result := 'count_task';
      else
        v_result := case when t.status = 'same' then 'same' else 'skipped' end;
      end if;

      insert into public.putaway_log (import_id, by_name, source, line, sheet_bin, bin_code, sku, batch_lot, expiry_date,
        quantity, status, kind, action, system_before, moved_in, fix, fix_error, result, movement_ids, request_ids, count_task_id)
      select v_import, v_name, p_source, t.line, t.sheet_bin,
        coalesce(t.bin_code, (select e->>'bin_code' from jsonb_array_elements(p_rows) e where (e->>'line')::int = t.line limit 1)),
        coalesce(t.sku, (select e->>'sku' from jsonb_array_elements(p_rows) e where (e->>'line')::int = t.line limit 1)),
        t.batch_lot, t.expiry_date, t.quantity, t.status, t.kind, t.action, coalesce(t.current, '[]'::jsonb), t.moved_in,
        case when t.action = 'fix' or t.fix_error is not null then t.fix end, t.fix_error, v_result, v_movs, v_reqs, v_count;
    end loop;
    -- The fix errors found on the second check are part of the answer too.
    out := (select coalesce(jsonb_agg(case when p.fix_error is not null then o || jsonb_build_object('fix_error', p.fix_error, 'action', null) else o end
                                      order by n), '[]'::jsonb)
            from jsonb_array_elements(out) with ordinality x(o, n) left join _putaway p on p.line = (o->>'line')::int);
  end if;

  return jsonb_build_object('rows', out, 'movements', n_moves, 'count_tasks', n_counts, 'set_over_limit', v_over,
                            'requests', n_requests, 'import_id', case when p_apply then v_import end);
end $$;
revoke execute on function public.putaway_import(jsonb, text, boolean, text) from public, anon;
grant execute on function public.putaway_import(jsonb, text, boolean, text) to authenticated;
