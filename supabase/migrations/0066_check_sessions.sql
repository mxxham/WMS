-- =====================================================================
-- 0066  Checker session: a thin layer over the picking audit
--
--  A checker verifies a picked shipment by scanning cartons before it is
--  loaded. This layer does NOT decide whether a shipment may be loaded —
--  that stays with pick_audit_line / record_pick_audit / mark_shipment_loaded.
--  It only:
--    * holds the claim (one active checker per wave+shipment),
--    * accumulates what was scanned (one carton per scan),
--    * at finish, drives the EXISTING audit once per un-audited line and
--      reads the SAME pick_audit_line gate mark_shipment_loaded reads.
--
--  Identity: the floor uses shared operator accounts and TYPED NAMES, the
--  same convention as post_task_by / record_pick_audit. A session stores the
--  typed checker_name, and "checker may not be the picker" is compared with
--  same_person() (normalized name, case and spaces ignored) — exactly as
--  record_pick_audit does. The claim lock is per (wave, shipment_number),
--  never per account, so any signed-in operator can scan and finish the
--  shipment once it is claimed; only a supervisor releases a claim.
--
--  Outcomes: ACCEPTED, UNKNOWN_BARCODE, WRONG_ITEM (SKU not on this
--  shipment), OVER_SCAN (would exceed the baseline). SHORT is not a scan
--  outcome: it is revealed at finish by the audit. Scanning never returns
--  the required quantity (the audit stays blind).
--
--  Baseline: record_pick_audit compares counted_qty against
--  coalesce(actual_quantity, quantity) — the picker's reported qty, exposed
--  as pick_audit_line.picked_qty. OVER_SCAN and the final audit therefore
--  both use picked_qty; they can never disagree, and the refusal text never
--  carries the number. (When the picker reported less than the order asked,
--  the check verifies the picker's report; the order-level shortage is the
--  pick deviation, already recorded.)
--
--  Re-check: a line left MISMATCH is re-audited as a NEW attempt when a
--  later session finishes (record_pick_audit allows a new attempt on a
--  MISMATCH), so a floor fix can clear it. A line RESOLVED by a supervisor
--  is left alone.
--
--  Lifecycle: open -> passed | exception (finish) | released (supervisor).
--  finish is one transaction and idempotent: a second call returns the same
--  result and writes no new pick_audits. The one-open-session index only
--  holds for status='open', so a released or finished session never blocks a
--  new claim, and a new session starts from zero — scans count by session_id.
--
--  One carton per scan (qty_per_scan = 1); there is no per-scan quantity.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Claim and scan log
-- ---------------------------------------------------------------------
create table public.check_sessions (
  id              uuid primary key default gen_random_uuid(),
  wave_id         uuid not null references public.waves(id) on delete cascade,
  shipment_number text not null,
  checker_name    text not null,
  checker_id      uuid references public.profiles(id),
  status          text not null default 'open' check (status in ('open', 'passed', 'exception', 'released')),
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  seal_number     text,
  released_by     uuid references public.profiles(id),
  released_at     timestamptz
);
-- One active checker per wave + shipment (not per account).
create unique index check_sessions_open_uq
  on public.check_sessions (wave_id, shipment_number) where status = 'open';
create index check_sessions_wave_idx on public.check_sessions (wave_id, shipment_number);

create table public.check_scans (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.check_sessions(id) on delete cascade,
  barcode_raw text not null,
  sku         text,
  outcome     text not null check (outcome in ('ACCEPTED', 'UNKNOWN_BARCODE', 'WRONG_ITEM', 'OVER_SCAN')),
  user_id     uuid references public.profiles(id),
  scanned_at  timestamptz not null default now()
);
create index check_scans_session_idx on public.check_scans (session_id, scanned_at);

alter table public.check_sessions enable row level security;
alter table public.check_scans enable row level security;
create policy "check_sessions: read" on public.check_sessions for select to authenticated using (true);
create policy "check_scans: read" on public.check_scans for select to authenticated using (true);
-- No write policies: written only through the functions below.

-- ---------------------------------------------------------------------
-- 2. Read view for the selection screen. NO quantities: a checker sees the
--    shipment state and line counts, never required or picked cartons.
-- ---------------------------------------------------------------------
create or replace view public.check_shipment with (security_invoker = true) as
select s.wave_id, s.wave_no, s.planned_date, s.planned_slot, s.planned_truck, s.shipment_number,
       s.state, s.todo, s.ok, s.mismatch, s.resolved, s.loaded_at, s.loaded_by_name, s.truck, s.load_legacy,
       cs.id as session_id, cs.checker_name, cs.started_at, cs.seal_number
from public.pick_audit_shipment s
left join public.check_sessions cs
  on cs.wave_id = s.wave_id and cs.shipment_number = s.shipment_number and cs.status = 'open';

-- ---------------------------------------------------------------------
-- 3. Claim / resume (typed checker name, as on the floor)
-- ---------------------------------------------------------------------
create or replace function public.check_claim(p_wave_id uuid, p_shipment text, p_checker_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text := public.person_name(p_checker_name, 'Nama checker');
  v_ship text := trim(coalesce(p_shipment, ''));
  v_state text;
  v_existing public.check_sessions%rowtype;
  v_owner text;
  v_id uuid;
begin
  if not public.has_role(array['operator','supervisor','admin']::public.user_role[]) then
    raise exception 'Sesi situs tidak tersedia';
  end if;
  select state into v_state from public.pick_audit_shipment
  where wave_id = p_wave_id and shipment_number = v_ship;
  if v_state is null then raise exception 'Shipment % tidak ada di wave ini', v_ship; end if;
  if v_state = 'CANCELLED' then raise exception 'Wave dibatalkan: shipment % tidak diperiksa', v_ship; end if;
  if v_state = 'PICKING' then raise exception 'Tugas pick belum selesai atau tidak ditemukan'; end if;
  if v_state = 'LOADED' then raise exception 'Shipment % sudah dimuat', v_ship; end if;

  -- The checker may not be the picker of any line (same_person, as record_pick_audit).
  select l.picked_by_name into v_owner from public.pick_audit_line l
  where l.wave_id = p_wave_id and l.shipment_number = v_ship and public.same_person(v_name, l.picked_by_name)
  limit 1;
  if v_owner is not null then raise exception 'Checker tidak boleh picker baris ini (%)', v_owner; end if;

  select * into v_existing from public.check_sessions
  where wave_id = p_wave_id and shipment_number = v_ship and status = 'open' for update;
  if v_existing.id is not null then
    if public.same_person(v_name, v_existing.checker_name) then
      return jsonb_build_object('session_id', v_existing.id, 'resumed', true);
    end if;
    raise exception 'Shipment % sedang diperiksa oleh %', v_ship, v_existing.checker_name;
  end if;

  insert into public.check_sessions (wave_id, shipment_number, checker_name, checker_id)
  values (p_wave_id, v_ship, v_name, auth.uid())
  returning id into v_id;
  return jsonb_build_object('session_id', v_id, 'resumed', false);
end $$;

-- ---------------------------------------------------------------------
-- 4. Release a claim (supervisor/admin). Closes it as 'released'.
-- ---------------------------------------------------------------------
create or replace function public.check_release(p_session uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.check_sessions%rowtype;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa melepas checker';
  end if;
  if nullif(trim(coalesce(p_note, '')), '') is null then raise exception 'Alasan wajib diisi'; end if;
  select * into s from public.check_sessions where id = p_session for update;
  if s.id is null then raise exception 'Sesi check tidak ditemukan'; end if;
  if s.status <> 'open' then raise exception 'Sesi check sudah selesai'; end if;
  update public.check_sessions
     set status = 'released', finished_at = now(), released_by = auth.uid(), released_at = now()
   where id = p_session;
  return jsonb_build_object('session_id', p_session, 'checker', s.checker_name, 'note', trim(p_note));
end $$;

-- ---------------------------------------------------------------------
-- 5. Scan one carton
-- ---------------------------------------------------------------------
create or replace function public.check_scan(p_session uuid, p_barcode text)
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

  insert into public.check_scans (session_id, barcode_raw, sku, outcome, user_id)
  values (p_session, trim(p_barcode), v_sku, v_outcome, auth.uid());

  -- Never return the required quantity: the checker stays blind.
  return jsonb_build_object('outcome', v_outcome, 'sku', v_sku, 'scanned', coalesce(v_scanned, 0), 'code', v_code);
end $$;

-- ---------------------------------------------------------------------
-- 6. Finish. One transaction, idempotent.
--    Drives the existing audit on every line not yet OK/RESOLVED/AUTO_PASS
--    (TODO and MISMATCH alike, so a floor fix is a new attempt), then reads
--    the existing gate. Batch/expiry/damaged are passed as the EXPECTED
--    values, so the finish audit can only surface SHORT or OVER.
-- ---------------------------------------------------------------------
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
  v_over jsonb;
  v_lines jsonb;
begin
  if not public.has_role(array['operator','supervisor','admin']::public.user_role[]) then
    raise exception 'Sesi situs tidak tersedia';
  end if;
  select * into s from public.check_sessions where id = p_session for update;
  if s.id is null then raise exception 'Sesi check tidak ditemukan'; end if;

  if s.status = 'open' then
    -- One new attempt per line still to clear, counted from this session's
    -- accepted scans for that SKU (split across same-SKU lines by seq).
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

    -- The gate: identical predicate to mark_shipment_loaded (no fork).
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

  -- Refused over-scans this session, per SKU (reported, never counted).
  select coalesce(jsonb_agg(jsonb_build_object('sku', sku, 'n', n) order by sku), '[]'::jsonb) into v_over
  from (select sku, count(*)::int n from public.check_scans
        where session_id = p_session and outcome = 'OVER_SCAN' group by sku) q;

  -- The discrepancy detail (revealed only here, never while scanning).
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
                            'already', s.status <> 'open');
end $$;

-- ---------------------------------------------------------------------
-- 7. Grants (views and logs are read-only to signed-in; anon gets nothing)
-- ---------------------------------------------------------------------
grant select on public.check_sessions, public.check_scans, public.check_shipment to authenticated;
revoke all on public.check_sessions, public.check_scans, public.check_shipment from anon;
revoke execute on function public.check_claim(uuid, text, text) from public, anon;
revoke execute on function public.check_release(uuid, text) from public, anon;
revoke execute on function public.check_scan(uuid, text) from public, anon;
revoke execute on function public.check_finish(uuid, text) from public, anon;
grant execute on function public.check_claim(uuid, text, text), public.check_release(uuid, text),
  public.check_scan(uuid, text), public.check_finish(uuid, text) to authenticated;
