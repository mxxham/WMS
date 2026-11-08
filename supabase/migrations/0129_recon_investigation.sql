-- =====================================================================
-- 0129  Investigasi selisih: find the stock behind a SAP difference and
--       correct today's on hand from the Rekonsiliasi SAP page
--
--  4 Nov 2026: a SKU showed less in the WMS than in SAP. The WMS said one
--  bin was empty; a full pallet of it stood there. Its history showed the
--  pallet had been in that bin, but the move that took it out in the
--  system never happened on the floor. Nothing on the page pointed at
--  that bin, and correcting it meant leaving the comparison.
--
--  A comparison line (stock_recon_lines) now carries its own investigation:
--   · recon_suspect_bins   every bin the SKU is in, was ever in, its
--                          pickface, the staging lanes and the neighbours
--                          of where it lives, scored by how likely the
--                          missing / extra stock is there. Strong clues:
--                          the bin last held exactly the difference, an
--                          import zeroed it "(not in file)", it moved in
--                          the last days.
--   · recon_check_bin      one person looks in one bin for this SKU and
--                          types what is there (qty, batch, expiry), or
--                          "kosong". Append-only (recon_checks); a later
--                          check of the same bin replaces it.
--   · recon_fix_plan       per batch + expiry: a bin that holds less than
--                          the system says and a bin that holds more are
--                          the same cartons -> Bin To Bin (no change to the
--                          total, nothing for SAP). Only what is left is an
--                          adjustment (FOUND / LOST). Never across batch or
--                          expiry: FEFO depends on them.
--   · recon_apply_fix      posts that plan as movements. Above the
--                          adjustment limit it must be applied by someone
--                          other than the people who checked (the count
--                          rule of 0019). The line keeps the day's numbers,
--                          gains wms_fix (net adjustment) and is RESOLVED.
--  Stock still changes only through movements; the guards on movements
--  (holds, blocked bins, adjustment limit) still apply. A check is "stale"
--  once the system stock of that SKU in that bin is no longer what it was
--  at the check (something was posted since): it is never applied.
-- =====================================================================

-- A misplaced pallet (Bin To Bin never recorded) is now its own cause.
alter table public.stock_recon_lines drop constraint if exists stock_recon_lines_cause_check;
alter table public.stock_recon_lines add constraint stock_recon_lines_cause_check
  check (cause in ('PENDING_GI', 'PENDING_GR', 'SAP_INBOUND', 'MISPICK', 'COUNT', 'SAP_ENTRY',
                   'UOM', 'DAMAGED', 'RETURN', 'OTHER', 'MISPLACED'));

-- Net adjustment posted to the WMS from this line (our side, + = cartons added).
alter table public.stock_recon_lines add column if not exists wms_fix numeric not null default 0;

-- ---------------------------------------------------------------------
-- Checks and fixes. Append-only, like every other audit trail here.
-- ---------------------------------------------------------------------
create table public.recon_checks (
  id            uuid primary key default gen_random_uuid(),
  line_id       uuid not null references public.stock_recon_lines(id),
  item_id       uuid not null references public.items(id),
  bin_id        uuid not null references public.bins(id),
  lines         jsonb not null default '[]'::jsonb check (jsonb_typeof(lines) = 'array'),        -- found [{batch_lot, expiry_date, quantity}]
  system_lines  jsonb not null default '[]'::jsonb check (jsonb_typeof(system_lines) = 'array'), -- this SKU in the bin at check time
  counted_qty   numeric not null,
  system_qty    numeric not null,
  note          text,
  checked_by    uuid references public.profiles(id),
  checked_name  text not null,
  checked_at    timestamptz not null default clock_timestamp()
);
create index recon_checks_line_idx on public.recon_checks (line_id, bin_id, checked_at desc);

create table public.recon_fixes (
  id             uuid primary key default gen_random_uuid(),
  line_id        uuid not null references public.stock_recon_lines(id),
  item_id        uuid not null references public.items(id),
  check_ids      uuid[] not null,
  plan           jsonb not null,
  transfer_qty   numeric not null,
  net_adjust     numeric not null,
  adjust_abs     numeric not null,
  cause          text,
  note           text,
  checker_names  text[] not null default '{}',
  applied_by     uuid references public.profiles(id),
  applied_name   text not null,
  applied_at     timestamptz not null default clock_timestamp()
);
create index recon_fixes_line_idx on public.recon_fixes (line_id, applied_at desc);

create or replace function public.recon_investigation_forbid_change() returns trigger
language plpgsql as $$
begin
  raise exception '% tidak bisa diubah atau dihapus (%)', tg_table_name, tg_op;
end $$;
create trigger recon_checks_immutable before update or delete on public.recon_checks
  for each row execute function public.recon_investigation_forbid_change();
create trigger recon_checks_no_truncate before truncate on public.recon_checks
  for each statement execute function public.recon_investigation_forbid_change();
create trigger recon_fixes_immutable before update or delete on public.recon_fixes
  for each row execute function public.recon_investigation_forbid_change();
create trigger recon_fixes_no_truncate before truncate on public.recon_fixes
  for each statement execute function public.recon_investigation_forbid_change();

alter table public.recon_checks enable row level security;
alter table public.recon_fixes enable row level security;
create policy "recon_checks: read" on public.recon_checks for select to authenticated using ((select public.is_active()));
create policy "recon_fixes: read" on public.recon_fixes for select to authenticated using ((select public.is_active()));
-- No write policy: the functions below only.
grant select on public.recon_checks, public.recon_fixes to authenticated;
grant all on public.recon_checks, public.recon_fixes to service_role;

-- This SKU's stock in one bin as check lines.
create or replace function public.recon_bin_sku_lines(p_bin uuid, p_item uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('batch_lot', i.batch_lot, 'expiry_date', i.expiry_date, 'quantity', i.quantity)
                            order by i.expiry_date nulls last, i.batch_lot), '[]'::jsonb)
  from public.inventory i where i.bin_id = p_bin and i.item_id = p_item and i.quantity <> 0;
$$;

-- The line, its reconciliation and what is still open on it.
create or replace function public.recon_line_gap(l public.stock_recon_lines)
returns numeric language sql immutable as $$
  -- our side: + = WMS holds more than SAP; minus what was already corrected.
  select -(coalesce(l.diff_unrestricted, 0) + coalesce(l.diff_blocked, 0)) + coalesce(l.wms_fix, 0);
$$;

-- ---------------------------------------------------------------------
-- Suspect bins, scored. Reasons are codes; the page words them.
--   CURRENT       the WMS holds the SKU here now
--   WMS_MORE      ...and the WMS holds more than SAP: make sure it is really there
--   EMPTIED       held the SKU, the WMS now says empty
--   IMPORT_ZERO   the last change was an import "(not in file)" zeroing
--   QTY_MATCH     the bin last held (or last lost) exactly the difference
--   STOCK_MATCH   the bin holds exactly the difference
--   RECENT_3 / RECENT_14 / RECENT_60   the SKU moved here that many days before the SAP date
--   PICKFACE      the SKU's pickface
--   STAGING / QUARANTINE   floor areas where an unbooked pallet waits
--   NEIGHBOUR     next to a bin the SKU is in or recently was (same column, or same level beside it)
--   OTHER_SKU     the WMS has another SKU here (a pallet put in the wrong bin)
-- ---------------------------------------------------------------------
create or replace function public.recon_suspect_bins(p_line_id uuid)
returns table (
  bin_id uuid, bin_code text, zone text, rack text, level text, bin_position text, bin_status text, kind text,
  system_qty numeric, system_lines jsonb, other_skus text[], is_pickface boolean,
  moves int, first_seen timestamptz, last_move_at timestamptz, last_move_type text, last_move_qty numeric, last_move_note text,
  last_full numeric, emptied_at timestamptz, emptied_by_import boolean, neighbour_of text,
  score int, reasons text[],
  check_id uuid, checked_at timestamptz, checked_name text, checked_qty numeric, check_lines jsonb, check_stale boolean
) language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  l public.stock_recon_lines%rowtype; v_asof date; v_gap numeric; v_abs numeric; v_last_fix timestamptz;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa melihat investigasi';
  end if;
  select * into l from public.stock_recon_lines where id = p_line_id;
  if l.id is null then raise exception 'Baris rekonsiliasi tidak ada'; end if;
  if l.item_id is null then raise exception 'SKU % tidak ada di master item', l.sku; end if;
  select r.as_of into v_asof from public.stock_recons r where r.id = l.recon_id;
  v_gap := public.recon_line_gap(l);
  v_abs := abs(v_gap);
  select max(f.applied_at) into v_last_fix from public.recon_fixes f where f.line_id = p_line_id;

  return query
  with mv as (
    -- One row per bin side of every movement of the SKU; delta = what the bin gained.
    select m.to_bin_id as b, m.id, m.created_at, m.type::text as mtype, m.quantity as delta, m.quantity as qty, m.note
    from public.movements m where m.item_id = l.item_id and m.to_bin_id is not null
    union all
    select m.from_bin_id, m.id, m.created_at, m.type::text, -m.quantity, m.quantity, m.note
    from public.movements m where m.item_id = l.item_id and m.from_bin_id is not null
  ),
  cur as (
    select i.bin_id as b, sum(i.quantity) as q from public.inventory i where i.item_id = l.item_id group by i.bin_id
  ),
  -- Balances anchored on today's stock, walked backwards, so missing early history cannot skew them.
  bal as (
    select mv.*,
           coalesce(c.q, 0) - sum(mv.delta) over (partition by mv.b) + sum(mv.delta) over (partition by mv.b order by mv.created_at, mv.id) as after_q,
           row_number() over (partition by mv.b order by mv.created_at desc, mv.id desc) as rn_desc
    from mv left join cur c on c.b = mv.b
  ),
  hist as (
    select bal.b, count(*)::int as n, min(bal.created_at) as first_at, max(bal.created_at) as last_at
    from bal group by bal.b
  ),
  lastm as (
    select bal.b, bal.mtype, bal.delta, bal.note, bal.created_at from bal where bal.rn_desc = 1
  ),
  emptied as (
    -- The latest time the bin went from stock to nothing, and what it held just before.
    select distinct on (bal.b) bal.b, bal.after_q - bal.delta as before_q, bal.created_at,
           (bal.mtype = 'adjustment' and bal.note like 'IMPORT %(not in file)%') as by_import
    from bal where bal.after_q <= 0 and bal.after_q - bal.delta > 0
    order by bal.b, bal.created_at desc, bal.id desc
  ),
  pf as (select p.bin_id as b from public.pickfaces p where p.item_id = l.item_id),
  anchors as (
    select c.b from cur c where c.q > 0
    union select h.b from hist h where h.last_at >= (v_asof - 30)::timestamp
    union select pf.b from pf
  ),
  neigh as (
    select distinct on (nb.id) nb.id as b, ab.bin_code as of_code
    from anchors a
    join public.bins ab on ab.id = a.b and ab.rack ~ '^\d+$' and ab.position ~ '^\d+$'
    join public.bins nb on nb.zone = ab.zone and nb.id <> ab.id and nb.rack ~ '^\d+$' and nb.position ~ '^\d+$'
      and (
        -- same column, another level (the pallet went up or down one)
        (nb.rack = ab.rack and nb.position = ab.position)
        -- same level, the bin beside it
        or (nb.level = ab.level and abs(nb.rack::int * 2 + nb.position::int - (ab.rack::int * 2 + ab.position::int)) = 1)
      )
    order by nb.id, ab.bin_code
  ),
  stg as (select b.id as b from public.bins b where b.zone = 'STAGING' and b.status = 'active'),
  chk as (
    select distinct on (c.bin_id) c.bin_id as b, c.id, c.checked_at, c.checked_name, c.counted_qty, c.lines, c.system_lines
    from public.recon_checks c
    where c.line_id = p_line_id and (v_last_fix is null or c.checked_at > v_last_fix)
    order by c.bin_id, c.checked_at desc, c.id desc
  ),
  cand as (
    select x.b from (
      select cur.b from cur where cur.q <> 0
      union select hist.b from hist
      union select pf.b from pf
      union select neigh.b from neigh
      union select stg.b from stg where v_gap < 0
      union select chk.b from chk
    ) x
  ),
  facts as (
    select bn.id, bn.bin_code, bn.zone, bn.rack, bn.level, bn.position, bn.status::text as bstatus,
           coalesce(c.q, 0) as sq, public.recon_bin_sku_lines(bn.id, l.item_id) as slines,
           (select array_agg(distinct it.sku order by it.sku) from public.inventory i join public.items it on it.id = i.item_id
             where i.bin_id = bn.id and i.item_id <> l.item_id and i.quantity > 0) as others,
           exists (select 1 from pf where pf.b = bn.id) as is_pf,
           coalesce(h.n, 0) as n, h.first_at, h.last_at, lm.mtype, lm.delta as lm_delta, lm.note as lm_note,
           e.before_q, e.created_at as e_at, coalesce(e.by_import, false) as e_import,
           ng.of_code,
           ck.id as ck_id, ck.checked_at as ck_at, ck.checked_name as ck_name, ck.counted_qty as ck_qty, ck.lines as ck_lines,
           (ck.id is not null and public.recon_bin_sku_lines(bn.id, l.item_id) <> ck.system_lines) as ck_stale
    from cand
    join public.bins bn on bn.id = cand.b
    left join cur c on c.b = bn.id
    left join hist h on h.b = bn.id
    left join lastm lm on lm.b = bn.id
    left join emptied e on e.b = bn.id
    left join neigh ng on ng.b = bn.id
    left join chk ck on ck.b = bn.id
  ),
  scored as (
    select f.*,
      array_remove(array[
        case when f.sq > 0 then 'CURRENT' end,
        case when f.sq > 0 and v_gap > 0 then 'WMS_MORE' end,
        case when f.sq <= 0 and f.n > 0 then 'EMPTIED' end,
        case when f.sq <= 0 and f.e_import then 'IMPORT_ZERO' end,
        case when v_abs > 0 and v_gap < 0 and (f.before_q = v_abs or abs(f.lm_delta) = v_abs) then 'QTY_MATCH' end,
        case when v_abs > 0 and v_gap > 0 and f.sq = v_abs then 'STOCK_MATCH' end,
        case when f.last_at >= (v_asof - 3)::timestamp then 'RECENT_3'
             when f.last_at >= (v_asof - 14)::timestamp then 'RECENT_14'
             when f.last_at >= (v_asof - 60)::timestamp then 'RECENT_60' end,
        case when f.is_pf then 'PICKFACE' end,
        case when f.zone = 'STAGING' then 'STAGING' end,
        case when f.zone = 'QUARANTINE' then 'QUARANTINE' end,
        case when f.of_code is not null and f.n = 0 and f.sq <= 0 then 'NEIGHBOUR' end,
        case when f.others is not null and f.sq <= 0 and v_gap < 0 then 'OTHER_SKU' end
      ], null) as rs
    from facts f
  )
  select s.id, s.bin_code, s.zone, s.rack, s.level, s.position, s.bstatus,
    case when s.sq > 0 then 'CURRENT' when s.n > 0 then 'HISTORY' when s.is_pf then 'PICKFACE'
         when s.zone = 'STAGING' then 'STAGING' when s.of_code is not null then 'NEIGHBOUR' else 'OTHER' end,
    s.sq, s.slines, s.others, s.is_pf,
    s.n, s.first_at, s.last_at, s.mtype, s.lm_delta, s.lm_note,
    s.before_q, s.e_at, s.e_import, s.of_code,
    (case when 'CURRENT' = any(s.rs) then 30 else 0 end
     + case when 'WMS_MORE' = any(s.rs) then 25 else 0 end
     + case when 'EMPTIED' = any(s.rs) then case when v_gap < 0 then 30 else 5 end else 0 end
     + case when 'IMPORT_ZERO' = any(s.rs) then case when v_gap < 0 then 35 else 10 end else 0 end
     + case when 'QTY_MATCH' = any(s.rs) or 'STOCK_MATCH' = any(s.rs) then 40 else 0 end
     + case when 'RECENT_3' = any(s.rs) then 20 when 'RECENT_14' = any(s.rs) then 12 when 'RECENT_60' = any(s.rs) then 5 else 0 end
     + case when 'PICKFACE' = any(s.rs) then 20 else 0 end
     + case when 'STAGING' = any(s.rs) then 10 else 0 end
     + case when 'QUARANTINE' = any(s.rs) then 8 else 0 end
     + case when 'NEIGHBOUR' = any(s.rs) then case when v_gap < 0 then 12 else 4 end else 0 end
     + case when 'OTHER_SKU' = any(s.rs) then 3 else 0 end
     + case when s.n > 0 then 2 else 0 end)::int,
    s.rs,
    s.ck_id, s.ck_at, s.ck_name, s.ck_qty, s.ck_lines, coalesce(s.ck_stale, false)
  from scored s
  order by 23 desc, 2;
end $$;

-- ---------------------------------------------------------------------
-- One look in one bin for this SKU. Lines: what is there, by batch +
-- expiry; [] = nothing of this SKU. The checker never needs the system qty.
-- ---------------------------------------------------------------------
create or replace function public.recon_check_bin(p_line_id uuid, p_bin_code text, p_lines jsonb, p_note text, p_by_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text := public.person_name(p_by_name, 'Nama pengecek');
  l public.stock_recon_lines%rowtype; v_status text; v_bin uuid; v_bin_code text; r jsonb;
  v_clean jsonb := '[]'::jsonb; v_system jsonb; v_counted numeric; v_sys numeric; v_known boolean; v_id uuid;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa mencatat cek bin';
  end if;
  select * into l from public.stock_recon_lines where id = p_line_id;
  if l.id is null then raise exception 'Baris rekonsiliasi tidak ada'; end if;
  if l.item_id is null then raise exception 'SKU % tidak ada di master item', l.sku; end if;
  select status into v_status from public.stock_recons where id = l.recon_id;
  if v_status is distinct from 'OPEN' then raise exception 'Rekonsiliasi sudah ditutup'; end if;
  select id, bin_code into v_bin, v_bin_code from public.bins where bin_code = upper(trim(coalesce(p_bin_code, '')));
  if v_bin is null then raise exception 'Bin % tidak ada', p_bin_code; end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' then raise exception 'Format hasil cek tidak valid'; end if;

  -- Same batch + expiry typed twice is one line.
  for r in
    select jsonb_build_object('batch_lot', x.batch_lot, 'expiry_date', x.expiry_date, 'quantity', sum(x.qty))
    from (
      select upper(trim(coalesce(e->>'batch_lot', ''))) as batch_lot, nullif(e->>'expiry_date', '')::date as expiry_date,
             (e->>'quantity')::numeric as qty
      from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) e
    ) x group by x.batch_lot, x.expiry_date order by x.expiry_date nulls last, x.batch_lot
  loop
    if (r->>'quantity')::numeric is null or (r->>'quantity')::numeric < 0 then raise exception 'Qty tidak valid'; end if;
    if (r->>'quantity')::numeric = 0 then continue; end if;
    -- Stock new to this bin needs its expiry (FEFO), as in a count (0019).
    select exists (select 1 from public.inventory i where i.bin_id = v_bin and i.item_id = l.item_id
                   and upper(i.batch_lot) = r->>'batch_lot' and i.expiry_date is not distinct from (r->>'expiry_date')::date) into v_known;
    if not v_known and nullif(r->>'expiry_date', '') is null then
      raise exception 'Tanggal expired wajib untuk batch % (belum ada di bin %)', coalesce(nullif(r->>'batch_lot', ''), '–'), v_bin_code;
    end if;
    v_clean := v_clean || jsonb_build_array(r);
  end loop;

  -- Keep the batch spelling the bin already has, so the plan matches identities.
  select coalesce(jsonb_agg(jsonb_build_object(
           'batch_lot', coalesce((select i.batch_lot from public.inventory i where i.bin_id = v_bin and i.item_id = l.item_id
                                   and upper(i.batch_lot) = c->>'batch_lot' and i.expiry_date is not distinct from (c->>'expiry_date')::date limit 1),
                                 c->>'batch_lot'),
           'expiry_date', c->'expiry_date', 'quantity', (c->>'quantity')::numeric)), '[]'::jsonb)
    into v_clean from jsonb_array_elements(v_clean) c;

  v_system := public.recon_bin_sku_lines(v_bin, l.item_id);
  select coalesce(sum((c->>'quantity')::numeric), 0) into v_counted from jsonb_array_elements(v_clean) c;
  select coalesce(sum((c->>'quantity')::numeric), 0) into v_sys from jsonb_array_elements(v_system) c;

  insert into public.recon_checks (line_id, item_id, bin_id, lines, system_lines, counted_qty, system_qty, note, checked_by, checked_name)
  values (p_line_id, l.item_id, v_bin, v_clean, v_system, v_counted, v_sys, nullif(trim(p_note), ''), auth.uid(), v_name)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'bin_code', v_bin_code, 'counted', v_counted, 'system', v_sys, 'diff', v_counted - v_sys);
end $$;

-- ---------------------------------------------------------------------
-- What the checks mean, as movements. Same result for the preview and
-- the apply, so what the person confirms is what gets posted.
-- ---------------------------------------------------------------------
create or replace function public.recon_fix_plan(p_line_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.stock_recon_lines%rowtype; v_last_fix timestamptz; v_limit numeric; v_gap numeric;
  c record; d record; ident record;
  v_checks jsonb := '[]'::jsonb; v_stale jsonb := '[]'::jsonb; v_fresh uuid[] := '{}';
  v_diffs jsonb := '[]'::jsonb;
  v_transfers jsonb := '[]'::jsonb; v_adjust jsonb := '[]'::jsonb; v_blockers jsonb := '[]'::jsonb;
  v_checkers text[] := '{}';
  s_bin text[]; s_qty numeric[]; s_name text[]; t_bin text[]; t_qty numeric[]; t_name text[];
  i int; j int; q numeric;
  v_net numeric := 0; v_abs numeric := 0; v_tq numeric := 0;
  red record; v_res numeric; v_waves text; v_held numeric;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa melihat koreksi';
  end if;
  select * into l from public.stock_recon_lines where id = p_line_id;
  if l.id is null then raise exception 'Baris rekonsiliasi tidak ada'; end if;
  if l.item_id is null then raise exception 'SKU % tidak ada di master item', l.sku; end if;
  select max(f.applied_at) into v_last_fix from public.recon_fixes f where f.line_id = p_line_id;
  v_limit := (public.inventory_policy()->>'adjust_approval_qty')::numeric;
  v_gap := public.recon_line_gap(l);

  -- The latest check of each bin since the last fix.
  for c in
    select distinct on (rc.bin_id) rc.*, b.bin_code, b.status::text as bstatus, b.zone
    from public.recon_checks rc join public.bins b on b.id = rc.bin_id
    where rc.line_id = p_line_id and (v_last_fix is null or rc.checked_at > v_last_fix)
    order by rc.bin_id, rc.checked_at desc, rc.id desc
  loop
    if public.recon_bin_sku_lines(c.bin_id, l.item_id) <> c.system_lines then
      v_stale := v_stale || jsonb_build_object('check_id', c.id, 'bin_code', c.bin_code, 'checked_name', c.checked_name, 'checked_at', c.checked_at);
      continue;
    end if;
    v_fresh := v_fresh || c.id;
    if not (c.checked_name = any(v_checkers)) then v_checkers := v_checkers || c.checked_name; end if;
    v_checks := v_checks || jsonb_build_object('check_id', c.id, 'bin_code', c.bin_code, 'checked_name', c.checked_name,
      'checked_at', c.checked_at, 'counted', c.counted_qty, 'system', (select coalesce(sum(i.quantity), 0) from public.inventory i
        where i.bin_id = c.bin_id and i.item_id = l.item_id), 'lines', c.lines, 'system_lines', public.recon_bin_sku_lines(c.bin_id, l.item_id));
    -- Per batch + expiry: counted - system, today's system (unchanged since the check, or it would be stale).
    for d in
      with cnt as (
        select e->>'batch_lot' as batch_lot, nullif(e->>'expiry_date', '')::date as expiry_date, (e->>'quantity')::numeric as qty
        from jsonb_array_elements(c.lines) e
      ), sys as (
        select i.batch_lot, i.expiry_date, i.quantity as qty from public.inventory i where i.bin_id = c.bin_id and i.item_id = l.item_id
      )
      select coalesce(x.batch_lot, y.batch_lot) as batch_lot, coalesce(x.expiry_date, y.expiry_date) as expiry_date,
             coalesce(x.qty, 0) - coalesce(y.qty, 0) as diff
      from cnt x full join sys y on y.batch_lot = x.batch_lot and y.expiry_date is not distinct from x.expiry_date
      where coalesce(x.qty, 0) <> coalesce(y.qty, 0)
    loop
      v_diffs := v_diffs || jsonb_build_object('bin_code', c.bin_code, 'bin_status', c.bstatus, 'zone', c.zone,
        'batch_lot', d.batch_lot, 'expiry_date', d.expiry_date, 'diff', d.diff, 'checked_name', c.checked_name);
    end loop;
  end loop;

  -- Pair the cartons the system has too many of with the ones found, inside one batch + expiry.
  for ident in
    select distinct x->>'batch_lot' as batch_lot, nullif(x->>'expiry_date', '')::date as expiry_date
    from jsonb_array_elements(v_diffs) x order by 2 nulls last, 1
  loop
    select coalesce(array_agg(x->>'bin_code' order by x->>'bin_code'), '{}'), coalesce(array_agg(-(x->>'diff')::numeric order by x->>'bin_code'), '{}'),
           coalesce(array_agg(x->>'checked_name' order by x->>'bin_code'), '{}')
      into s_bin, s_qty, s_name
    from jsonb_array_elements(v_diffs) x
    where x->>'batch_lot' = ident.batch_lot and nullif(x->>'expiry_date', '')::date is not distinct from ident.expiry_date and (x->>'diff')::numeric < 0;
    -- A bin that is blocked (not quarantine) cannot receive a Bin To Bin; its found stock is adjusted in place.
    select coalesce(array_agg(x->>'bin_code' order by x->>'bin_code'), '{}'), coalesce(array_agg((x->>'diff')::numeric order by x->>'bin_code'), '{}'),
           coalesce(array_agg(x->>'checked_name' order by x->>'bin_code'), '{}')
      into t_bin, t_qty, t_name
    from jsonb_array_elements(v_diffs) x
    where x->>'batch_lot' = ident.batch_lot and nullif(x->>'expiry_date', '')::date is not distinct from ident.expiry_date and (x->>'diff')::numeric > 0;

    i := 1; j := 1;
    while i <= coalesce(array_length(s_bin, 1), 0) and j <= coalesce(array_length(t_bin, 1), 0) loop
      if (select b.status = 'blocked' and b.zone <> 'QUARANTINE' from public.bins b where b.bin_code = t_bin[j]) then
        j := j + 1; continue;
      end if;
      q := least(s_qty[i], t_qty[j]);
      v_transfers := v_transfers || jsonb_build_object('from_bin', s_bin[i], 'to_bin', t_bin[j], 'batch_lot', ident.batch_lot,
        'expiry_date', ident.expiry_date, 'quantity', q, 'checked_name', t_name[j]);
      v_tq := v_tq + q;
      s_qty[i] := s_qty[i] - q; t_qty[j] := t_qty[j] - q;
      if s_qty[i] = 0 then i := i + 1; end if;
      if t_qty[j] = 0 then j := j + 1; end if;
    end loop;
    for i in 1 .. coalesce(array_length(s_bin, 1), 0) loop
      if s_qty[i] > 0 then
        v_adjust := v_adjust || jsonb_build_object('bin_code', s_bin[i], 'batch_lot', ident.batch_lot, 'expiry_date', ident.expiry_date,
          'quantity', -s_qty[i], 'checked_name', s_name[i]);
        v_net := v_net - s_qty[i]; v_abs := v_abs + s_qty[i];
      end if;
    end loop;
    for j in 1 .. coalesce(array_length(t_bin, 1), 0) loop
      if t_qty[j] > 0 then
        v_adjust := v_adjust || jsonb_build_object('bin_code', t_bin[j], 'batch_lot', ident.batch_lot, 'expiry_date', ident.expiry_date,
          'quantity', t_qty[j], 'checked_name', t_name[j]);
        v_net := v_net + t_qty[j]; v_abs := v_abs + t_qty[j];
      end if;
    end loop;
  end loop;

  -- What the plan takes out of a bin must not cut into stock a wave has reserved or a hold keeps.
  for red in
    with outs as (
      select x->>'from_bin' as bin_code, x->>'batch_lot' as batch_lot, nullif(x->>'expiry_date', '')::date as expiry_date, (x->>'quantity')::numeric as qty
      from jsonb_array_elements(v_transfers) x
      union all
      select x->>'bin_code', x->>'batch_lot', nullif(x->>'expiry_date', '')::date, -(x->>'quantity')::numeric
      from jsonb_array_elements(v_adjust) x where (x->>'quantity')::numeric < 0
    )
    select o.bin_code, b.id as bin_id, o.batch_lot, o.expiry_date, sum(o.qty) as qty,
           coalesce((select i.quantity from public.inventory i where i.bin_id = b.id and i.item_id = l.item_id
                      and i.batch_lot = o.batch_lot and i.expiry_date is not distinct from o.expiry_date), 0) as phys
    from outs o join public.bins b on b.bin_code = o.bin_code
    group by o.bin_code, b.id, o.batch_lot, o.expiry_date
  loop
    select coalesce(sum(t.quantity), 0), string_agg(distinct w.wave_no || ' (' || w.planned_date || ')', ', ')
      into v_res, v_waves
    from public.open_pick_tasks t join public.waves w on w.id = t.wave_id
    where t.from_bin_id = red.bin_id and t.item_id = l.item_id and t.batch_lot = red.batch_lot
      and t.expiry_date is not distinct from red.expiry_date;
    if v_res > 0 and red.phys - red.qty < v_res then
      v_blockers := v_blockers || to_jsonb(format('Bin %s batch %s dipesan %s karton untuk wave %s. Kerjakan atau hitung ulang wave itu dulu.',
        red.bin_code, coalesce(nullif(red.batch_lot, ''), '–'), v_res, v_waves));
    end if;
    v_held := public.held_qty(red.bin_id, l.item_id, red.batch_lot, red.expiry_date, red.phys);
    if v_held > 0 and red.phys - red.qty < v_held then
      v_blockers := v_blockers || to_jsonb(format('Bin %s batch %s ditahan %s karton (%s). Lepas hold dulu.',
        red.bin_code, coalesce(nullif(red.batch_lot, ''), '–'), v_held,
        public.hold_reasons(red.bin_id, l.item_id, red.batch_lot, red.expiry_date)));
    end if;
  end loop;

  return jsonb_build_object(
    'checks', v_checks, 'stale', v_stale, 'check_ids', to_jsonb(v_fresh), 'checkers', to_jsonb(v_checkers),
    'transfers', v_transfers, 'adjustments', v_adjust, 'blockers', v_blockers,
    'transfer_qty', v_tq, 'net_adjust', v_net, 'adjust_abs', v_abs, 'limit', v_limit,
    'needs_other_person', v_abs > v_limit,
    'gap_before', v_gap, 'gap_after', v_gap + v_net, 'last_fix_at', v_last_fix);
end $$;

-- ---------------------------------------------------------------------
-- Post the plan. One transaction: every movement or none.
-- ---------------------------------------------------------------------
create or replace function public.recon_apply_fix(p_line_id uuid, p_cause text, p_reason_plus text, p_reason_minus text,
                                                  p_note text, p_by_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text := public.person_name(p_by_name, 'Nama yang menerapkan');
  l public.stock_recon_lines%rowtype; v_status text; v_asof date; v_sku text;
  p jsonb; x jsonb; v_fix uuid; v_note text; v_cause text; v_who text; v_plus text; v_minus text; v_remark text;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa menerapkan koreksi';
  end if;
  select * into l from public.stock_recon_lines where id = p_line_id for update;
  if l.id is null then raise exception 'Baris rekonsiliasi tidak ada'; end if;
  select status, as_of into v_status, v_asof from public.stock_recons where id = l.recon_id;
  if v_status is distinct from 'OPEN' then raise exception 'Rekonsiliasi sudah ditutup'; end if;
  v_sku := l.sku;

  p := public.recon_fix_plan(p_line_id);
  if jsonb_array_length(p->'transfers') = 0 and jsonb_array_length(p->'adjustments') = 0 then
    raise exception 'Tidak ada yang perlu dikoreksi: semua bin yang dicek sudah sama dengan sistem';
  end if;
  if jsonb_array_length(p->'blockers') > 0 then raise exception '%', p->'blockers'->>0; end if;
  if (p->>'needs_other_person')::boolean then
    for v_who in select jsonb_array_elements_text(p->'checkers') loop
      if public.same_person(v_name, v_who) then
        raise exception 'Koreksi % karton di atas batas % karton: harus diterapkan orang lain dari pengecek (%)',
          p->>'adjust_abs', p->>'limit', v_who;
      end if;
    end loop;
  end if;

  v_plus := coalesce(nullif(p_reason_plus, ''), 'FOUND');
  v_minus := coalesce(nullif(p_reason_minus, ''), 'LOST');
  if v_plus not in ('COUNT_VARIANCE', 'FOUND', 'DATA_ENTRY', 'RECEIVING_DIFF', 'RETURN', 'MISPICK', 'OTHER')
     or v_minus not in ('COUNT_VARIANCE', 'LOST', 'DATA_ENTRY', 'DAMAGED', 'MISPICK', 'RECEIVING_DIFF', 'OTHER') then
    raise exception 'Kode alasan tidak valid';
  end if;
  v_cause := coalesce(nullif(p_cause, ''), case when jsonb_array_length(p->'adjustments') = 0 then 'MISPLACED' else 'COUNT' end);
  if v_cause not in ('PENDING_GI', 'PENDING_GR', 'SAP_INBOUND', 'MISPICK', 'COUNT', 'SAP_ENTRY', 'UOM', 'DAMAGED', 'RETURN', 'OTHER', 'MISPLACED') then
    raise exception 'Penyebab tidak valid';
  end if;

  insert into public.recon_fixes (line_id, item_id, check_ids, plan, transfer_qty, net_adjust, adjust_abs, cause, note,
                                  checker_names, applied_by, applied_name)
  values (p_line_id, l.item_id, array(select jsonb_array_elements_text(p->'check_ids'))::uuid[], p,
          (p->>'transfer_qty')::numeric, (p->>'net_adjust')::numeric, (p->>'adjust_abs')::numeric, v_cause,
          nullif(trim(p_note), ''), array(select jsonb_array_elements_text(p->'checkers')), auth.uid(), v_name)
  returning id into v_fix;

  v_note := 'REKON SAP ' || to_char(v_asof, 'DD-MM-YYYY') || ' ' || v_sku || coalesce(': ' || nullif(trim(p_note), ''), '');
  -- The checks already are the second look: the size check is done here (0018's app.adjust_approved).
  perform set_config('app.adjust_approved', 'on', true);
  for x in select * from jsonb_array_elements(p->'transfers') loop
    insert into public.movements (type, item_id, batch_lot, quantity, from_bin_id, to_bin_id, expiry_date, note, by_name, approved_by_name, ref_id)
    values ('transfer', l.item_id, x->>'batch_lot', (x->>'quantity')::numeric,
            (select id from public.bins where bin_code = x->>'from_bin'), (select id from public.bins where bin_code = x->>'to_bin'),
            nullif(x->>'expiry_date', '')::date, v_note || ' (Bin To Bin tidak tercatat)', x->>'checked_name', v_name, v_fix);
  end loop;
  for x in select * from jsonb_array_elements(p->'adjustments') loop
    insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note, reason_code, by_name, approved_by_name, ref_id)
    values ('adjustment', l.item_id, x->>'batch_lot', (x->>'quantity')::numeric, (select id from public.bins where bin_code = x->>'bin_code'),
            nullif(x->>'expiry_date', '')::date, v_note || case when (x->>'quantity')::numeric > 0 then ' (ditemukan)' else ' (tidak ada)' end,
            case when (x->>'quantity')::numeric > 0 then v_plus else v_minus end, x->>'checked_name', v_name, v_fix);
  end loop;
  perform set_config('app.adjust_approved', '', true);

  v_remark := concat_ws(' · ',
    nullif(trim(p_note), ''),
    case when (p->>'transfer_qty')::numeric > 0 then 'Bin To Bin ' || (p->>'transfer_qty') end,
    case when (p->>'adjust_abs')::numeric > 0 then 'adjustment ' || case when (p->>'net_adjust')::numeric > 0 then '+' else '' end || (p->>'net_adjust') end,
    'diterapkan ' || v_name);
  update public.stock_recon_lines
  set wms_fix = wms_fix + (p->>'net_adjust')::numeric, status = 'RESOLVED', cause = v_cause,
      remark = left(v_remark, 500), updated_by_name = v_name, updated_at = now()
  where id = p_line_id;

  return jsonb_build_object('fix_id', v_fix, 'transfers', jsonb_array_length(p->'transfers'),
    'adjustments', jsonb_array_length(p->'adjustments'), 'transfer_qty', p->'transfer_qty', 'net_adjust', p->'net_adjust',
    'gap_after', p->'gap_after');
end $$;

revoke execute on function public.recon_bin_sku_lines(uuid, uuid), public.recon_suspect_bins(uuid),
  public.recon_check_bin(uuid, text, jsonb, text, text), public.recon_fix_plan(uuid),
  public.recon_apply_fix(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.recon_bin_sku_lines(uuid, uuid), public.recon_suspect_bins(uuid),
  public.recon_check_bin(uuid, text, jsonb, text, text), public.recon_fix_plan(uuid),
  public.recon_apply_fix(uuid, text, text, text, text, text), public.recon_line_gap(public.stock_recon_lines) to authenticated;

-- The page refreshes live when someone checks a bin or applies a fix (0015).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'alter publication supabase_realtime add table public.recon_checks';
    execute 'alter publication supabase_realtime add table public.recon_fixes';
  end if;
end $$;
