-- =====================================================================
-- 0117  Putaway: Tanggal barang datang, so Buku stok files inbound on arrival
--
-- The team enters a day's inbound the next day: goods arrive on D, the
-- putaway sheet is posted on D+1, while SAP books them on D. Buku stok
-- (0116) assumed arrival = posting date - 1. The putaway page now asks the
-- date the goods arrived (pre-filled with yesterday) and it is recorded
-- per import, so the ledger uses the real date.
--
--  * putaway_arrivals(import_id, arrival_date): append-only, one row per
--    posted import. Written only by putaway_import_arrival.
--  * putaway_import_arrival(...): checks the date (required when posting,
--    not in the future, at most 7 days back), calls putaway_import (0066)
--    unchanged, and records the date against the import it returns.
--    putaway_import itself is not touched; stock still moves when the
--    putaway is posted.
--  * putaway_arrival_moves: the date per putaway movement of the import,
--    so ledger_inbound_moves (0116) reads it by key: recorded date
--    (assumed = false), otherwise posting date - 1 as before. The 7-day
--    limit is what lets Buku stok look only 8 days of postings ahead.
-- =====================================================================

create table public.putaway_arrivals (
  import_id    uuid primary key,
  arrival_date date not null,
  by_name      text,
  created_by   uuid references public.profiles(id) default auth.uid(),
  created_at   timestamptz not null default now()
);
create trigger putaway_arrivals_forbid_change before update or delete on public.putaway_arrivals
  for each row execute function public.ledger_forbid_change();
alter table public.putaway_arrivals enable row level security;
create policy "putaway_arrivals: read" on public.putaway_arrivals for select to authenticated using ((select public.is_active()));
grant select on public.putaway_arrivals to authenticated;

-- The arrival date per putaway movement, so Buku stok finds it by key. Filled by the wrapper from the
-- import's putaway_log rows; append-only like putaway_arrivals.
create table public.putaway_arrival_moves (
  movement_id  uuid primary key references public.movements(id),
  import_id    uuid not null references public.putaway_arrivals(import_id),
  arrival_date date not null
);
create trigger putaway_arrival_moves_forbid_change before update or delete on public.putaway_arrival_moves
  for each row execute function public.ledger_forbid_change();
alter table public.putaway_arrival_moves enable row level security;
create policy "putaway_arrival_moves: read" on public.putaway_arrival_moves for select to authenticated using ((select public.is_active()));
grant select on public.putaway_arrival_moves to authenticated;

create or replace function public.putaway_import_arrival(p_rows jsonb, p_source text, p_apply boolean,
  p_by_name text default null, p_arrival_date date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_today date := (now() at time zone 'Asia/Jakarta')::date; v_res jsonb; v_import uuid;
begin
  if coalesce(p_apply, false) then
    if p_arrival_date is null then raise exception 'Tanggal barang datang wajib diisi'; end if;
    if p_arrival_date > v_today then raise exception 'Tanggal barang datang tidak boleh di masa depan'; end if;
    if p_arrival_date < v_today - 7 then raise exception 'Tanggal barang datang lebih dari 7 hari yang lalu'; end if;
  end if;
  v_res := public.putaway_import(p_rows, p_source, p_apply, p_by_name);
  v_import := nullif(v_res ->> 'import_id', '')::uuid;
  if coalesce(p_apply, false) and v_import is not null then
    insert into public.putaway_arrivals (import_id, arrival_date, by_name) values (v_import, p_arrival_date, nullif(trim(p_by_name), ''));
    insert into public.putaway_arrival_moves (movement_id, import_id, arrival_date)
    select distinct m.id, v_import, p_arrival_date
    from public.putaway_log l, unnest(l.movement_ids) mid
    join public.movements m on m.id = mid
    where l.import_id = v_import and m.type = 'putaway' and m.from_bin_id is null;
  end if;
  return v_res || jsonb_build_object('arrival_date', case when p_apply then p_arrival_date end);
end $$;
revoke execute on function public.putaway_import_arrival(jsonb, text, boolean, text, date) from public, anon;
grant execute on function public.putaway_import_arrival(jsonb, text, boolean, text, date) to authenticated;

-- Same window contract as 0116 (an arrival is at most 7 days before its posting: checked above).
create or replace function public.ledger_inbound_moves(p_from timestamptz, p_to timestamptz)
returns table (movement_id uuid, item_id uuid, to_bin_id uuid, quantity numeric, posted_date date, arrival_date date, assumed boolean)
language sql stable security invoker set search_path = public as $$
  select m.id, m.item_id, m.to_bin_id, m.quantity,
         (m.created_at at time zone 'Asia/Jakarta')::date,
         case when m.type = 'inbound' then (m.created_at at time zone 'Asia/Jakarta')::date
              else coalesce(am.arrival_date, (m.created_at at time zone 'Asia/Jakarta')::date - 1) end,
         m.type = 'putaway' and am.arrival_date is null
  from public.movements m
  left join public.putaway_arrival_moves am on am.movement_id = m.id
  where m.created_at >= p_from and m.created_at < p_to
    and (m.type = 'inbound' or (m.type = 'putaway' and m.from_bin_id is null));
$$;
