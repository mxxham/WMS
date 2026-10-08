-- =====================================================================
-- 0067  Idempotent scans: one client id, one outcome
--
--  The scan screen retries a scan that failed on the network with the SAME
--  client_scan_id. A repeated id must not count twice: check_scan returns
--  the stored outcome and inserts nothing.
--
--  check_scans  + client_scan_id uuid, unique per session (partial, so the
--               rows written before this migration stay valid).
--  check_scan   takes an optional p_client_scan_id and replays the original
--               outcome on a repeat (no insert, count unchanged).
--  check_finish also reports how many WRONG_ITEM and UNKNOWN_BARCODE scans
--               the session recorded.
-- =====================================================================

alter table public.check_scans add column if not exists client_scan_id uuid;
create unique index if not exists check_scans_client_uq
  on public.check_scans (session_id, client_scan_id) where client_scan_id is not null;

drop function if exists public.check_scan(uuid, text);

create or replace function public.check_scan(p_session uuid, p_barcode text, p_client_scan_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.check_sessions%rowtype;
  v_code text := nullif(upper(regexp_replace(coalesce(p_barcode, ''), '\s', '', 'g')), '');
  v_sku text;
  v_outcome text;
  v_required numeric;
  v_scanned int;
begin
  if not public.has_role(array['operator','supervisor','admin']::public.user_role[]) then
    raise exception 'Sesi situs tidak tersedia';
  end if;
  select * into s from public.check_sessions where id = p_session for update;
  if s.id is null then raise exception 'Sesi check tidak ditemukan'; end if;
  if s.status <> 'open' then raise exception 'Sesi check sudah selesai'; end if;

  -- A retried scan (same client id) returns the original outcome and counts nothing.
  if p_client_scan_id is not null then
    select cs.outcome, cs.sku into v_outcome, v_sku from public.check_scans cs
    where cs.session_id = p_session and cs.client_scan_id = p_client_scan_id;
    if v_outcome is not null then
      select count(*) into v_scanned from public.check_scans
      where session_id = p_session and outcome = 'ACCEPTED' and sku is not distinct from v_sku;
      return jsonb_build_object('outcome', v_outcome, 'sku', v_sku, 'scanned', coalesce(v_scanned, 0), 'code', v_code, 'replayed', true);
    end if;
  end if;

  if v_code is null then raise exception 'Barcode kosong'; end if;

  select sku into v_sku from public.item_by_barcode(v_code) limit 1;
  if v_sku is null then
    v_outcome := 'UNKNOWN_BARCODE';
  elsif not exists (select 1 from public.pick_audit_line l
                    where l.wave_id = s.wave_id and l.shipment_number = s.shipment_number and l.sku = v_sku) then
    v_outcome := 'WRONG_ITEM';
  else
    -- Baseline = picked_qty, exactly what record_pick_audit will compare against.
    select coalesce(sum(l.picked_qty), 0) into v_required from public.pick_audit_line l
    where l.wave_id = s.wave_id and l.shipment_number = s.shipment_number and l.sku = v_sku;
    select count(*) into v_scanned from public.check_scans
    where session_id = p_session and outcome = 'ACCEPTED' and sku = v_sku;
    if v_scanned + 1 > v_required then
      v_outcome := 'OVER_SCAN';   -- no number in the outcome; the checker stays blind
    else
      v_outcome := 'ACCEPTED';
      v_scanned := v_scanned + 1;
    end if;
  end if;

  insert into public.check_scans (session_id, barcode_raw, sku, outcome, user_id, client_scan_id)
  values (p_session, trim(p_barcode), v_sku, v_outcome, auth.uid(), p_client_scan_id);

  -- Never return the required quantity: the checker stays blind.
  return jsonb_build_object('outcome', v_outcome, 'sku', v_sku, 'scanned', coalesce(v_scanned, 0), 'code', v_code, 'replayed', false);
end $$;

-- check_finish: add the WRONG_ITEM / UNKNOWN_BARCODE counters (same body otherwise).
create or replace function public.check_finish(p_session uuid, p_seal_number text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.check_sessions%rowtype;
  r record;
  v_scanned int;
  v_assigned jsonb := '{}'::jsonb;
  v_take numeric;
  v_open int;
  v_status text;
  v_todo int;
  v_ok int;
  v_mismatch int;
  v_resolved int;
  v_wrong int;
  v_unknown int;
  v_over jsonb;
  v_lines jsonb;
begin
  if not public.has_role(array['operator','supervisor','admin']::public.user_role[]) then
    raise exception 'Sesi situs tidak tersedia';
  end if;
  select * into s from public.check_sessions where id = p_session for update;
  if s.id is null then raise exception 'Sesi check tidak ditemukan'; end if;

  if s.status = 'open' then
    for r in
      select task_id, sku, picked_qty, batch_lot, expiry_date, seq
      from public.pick_audit_line
      where wave_id = s.wave_id and shipment_number = s.shipment_number
        and line_state in ('TODO', 'MISMATCH')
      order by seq
    loop
      select count(*) into v_scanned from public.check_scans
      where session_id = p_session and outcome = 'ACCEPTED' and sku = r.sku;
      v_take := greatest(0, v_scanned - coalesce((v_assigned->>r.sku)::numeric, 0));
      if v_take > r.picked_qty then v_take := r.picked_qty; end if;
      perform public.record_pick_audit(r.task_id, s.checker_name, r.sku, v_take, r.batch_lot, r.expiry_date, false,
                                       'Check session ' || p_session::text);
      v_assigned := jsonb_set(v_assigned, array[r.sku], to_jsonb(coalesce((v_assigned->>r.sku)::numeric, 0) + v_take));
    end loop;

    select count(*) into v_open from public.pick_audit_line
    where wave_id = s.wave_id and shipment_number = s.shipment_number and line_state in ('TODO', 'MISMATCH');
    v_status := case when v_open = 0 then 'passed' else 'exception' end;

    update public.check_sessions
       set status = v_status, finished_at = now(), seal_number = coalesce(nullif(trim(p_seal_number), ''), seal_number)
     where id = p_session;
  else
    v_status := s.status;  -- already finished or released: idempotent, no new audits
  end if;

  select count(*) filter (where line_state = 'TODO'),
         count(*) filter (where line_state in ('OK', 'AUTO_PASS')),
         count(*) filter (where line_state = 'MISMATCH'),
         count(*) filter (where line_state = 'RESOLVED')
    into v_todo, v_ok, v_mismatch, v_resolved
  from public.pick_audit_line
  where wave_id = s.wave_id and shipment_number = s.shipment_number;

  select count(*) filter (where outcome = 'WRONG_ITEM'),
         count(*) filter (where outcome = 'UNKNOWN_BARCODE')
    into v_wrong, v_unknown
  from public.check_scans where session_id = p_session;

  select coalesce(jsonb_agg(jsonb_build_object('sku', sku, 'n', n) order by sku), '[]'::jsonb) into v_over
  from (select sku, count(*)::int n from public.check_scans
        where session_id = p_session and outcome = 'OVER_SCAN' group by sku) q;

  select coalesce(jsonb_agg(jsonb_build_object(
           'task_id', task_id, 'sku', sku, 'description', description,
           'required', picked_qty, 'counted', coalesce(counted, 0),
           'errors', coalesce(errors, '[]'::jsonb), 'line_state', line_state) order by seq), '[]'::jsonb) into v_lines
  from (
    select l.task_id, l.sku, l.description, l.picked_qty, l.seq, l.line_state, a.counted_qty as counted, to_jsonb(a.errors) as errors
    from public.pick_audit_line l
    left join lateral (select counted_qty, errors from public.pick_audits pa
                       where pa.task_id = l.task_id order by attempt_no desc limit 1) a on true
    where l.wave_id = s.wave_id and l.shipment_number = s.shipment_number
  ) x;

  return jsonb_build_object('status', v_status, 'todo', v_todo, 'ok', v_ok, 'mismatch', v_mismatch,
                            'resolved', v_resolved, 'over_scans', v_over, 'lines', v_lines,
                            'wrong_items', v_wrong, 'unknown_barcodes', v_unknown,
                            'already', s.status <> 'open');
end $$;

revoke execute on function public.check_scan(uuid, text, uuid) from public, anon;
grant execute on function public.check_scan(uuid, text, uuid) to authenticated;
