-- =====================================================================
-- 0163  CKB: one photo per bin (customers.photo_scope = 'BIN', 0161)
--
-- Spec: docs/superpowers/specs/2026-11-25-ckb-emcl-stocktake-design.md
--
-- A bin-photo customer's counter photographs the whole bin once; after that the lines of the bin are counted without a photo each,
-- except where the line itself needs one (quantity 0, found stock, a recount: 0133). Sessions created before 0133 and customers with
-- photo_scope 'TASK' are untouched.
--   * ckb_stocktake_bins: one row per bin of a session, made the first time a counter photographs it (ckb_stocktake_bin);
--   * evidence entity 'STOCKTAKE_BIN' (kind COUNT): same pipeline as every other evidence (route, private bucket, audit, retention);
--   * a count is refused until its bin has a live photo; accepting a variance is satisfied by a line photo OR the bin photo;
--   * only a counter who may count a line in the bin adds a bin photo; withdrawing one a submitted count relied on is for a lead.
-- =====================================================================

create table public.ckb_stocktake_bins (
  id           uuid primary key default gen_random_uuid(),
  stocktake_id uuid not null references public.ckb_stocktakes(id),
  storage_bin  text not null check (storage_bin = upper(trim(storage_bin)) and storage_bin <> ''),
  created_at   timestamptz not null default now(),
  unique (stocktake_id, storage_bin)
);
alter table public.ckb_stocktake_bins enable row level security;   -- no policy, no grant: read through ckb_stocktake_bins_for
create trigger ckb_stocktake_bins_immutable before update or delete on public.ckb_stocktake_bins for each row execute function public.ckb_forbid_change();
create trigger ckb_stocktake_bins_no_truncate before truncate on public.ckb_stocktake_bins for each statement execute function public.ckb_forbid_change();
grant all on public.ckb_stocktake_bins to service_role;

alter table public.ckb_evidence drop constraint if exists ckb_evidence_entity_type_check;
alter table public.ckb_evidence add constraint ckb_evidence_entity_type_check
  check (entity_type in ('STOCKTAKE', 'COUNT_TASK', 'INSPECTION', 'STOCKTAKE_BIN'));

-- May the caller count a line in this bin (leads: any bin)?
create or replace function public.ckb_can_count_bin(p_bin uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when not public.ckb_is_staff() then false
    when public.ckb_has_role(array['admin', 'supervisor']) then true
    else exists (select 1 from public.ckb_stocktake_bins b
                 join public.ckb_count_tasks t on t.stocktake_id = b.stocktake_id and upper(t.storage_bin) = b.storage_bin
                 where b.id = p_bin and public.ckb_can_count_task(t.id))
  end
$$;

-- Does the bin of this task have a live photo?
create or replace function public.ckb_bin_has_photo(p_task uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.ckb_count_tasks t
                 join public.ckb_stocktake_bins b on b.stocktake_id = t.stocktake_id and b.storage_bin = upper(t.storage_bin)
                 join public.ckb_evidence e on e.entity_type = 'STOCKTAKE_BIN' and e.entity_id = b.id and e.deleted_at is null
                 where t.id = p_task)
$$;

-- The rule: counting this task needs a bin photo that is not there yet.
create or replace function public.ckb_bin_photo_missing(p_task uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select s.photo_rules and c.photo_scope = 'BIN' and not public.ckb_bin_has_photo(p_task)
                   from public.ckb_count_tasks t join public.ckb_stocktakes s on s.id = t.stocktake_id
                   join public.ckb_customers c on c.id = s.customer_id where t.id = p_task), false)
$$;

-- The bin of a session, made on first use. The counter then uploads the photo as evidence of it.
create or replace function public.ckb_stocktake_bin(p_stocktake uuid, p_bin text) returns uuid
language plpgsql security definer set search_path = public as $$
declare s public.ckb_stocktakes%rowtype; v_bin text := upper(trim(coalesce(p_bin, ''))); v_id uuid;
begin
  select * into s from public.ckb_stocktakes where id = p_stocktake;
  if s.id is null then raise exception 'Sesi stock take tidak ditemukan'; end if;
  perform public.ckb_assert_can_count(s);
  if s.status not in ('COUNTING', 'REVIEW') then raise exception 'Sesi ini tidak sedang dihitung'; end if;
  if (select photo_scope from public.ckb_customers where id = s.customer_id) <> 'BIN' then
    raise exception 'Pelanggan ini memakai foto per baris, bukan foto per bin';
  end if;
  if v_bin = '' or not exists (select 1 from public.ckb_count_tasks t where t.stocktake_id = p_stocktake and upper(t.storage_bin) = v_bin
                               and public.ckb_can_count_task(t.id)) then
    raise exception 'Bin % tidak ada di baris yang boleh Anda hitung', coalesce(nullif(v_bin, ''), '(kosong)');
  end if;
  insert into public.ckb_stocktake_bins (stocktake_id, storage_bin) values (p_stocktake, v_bin) on conflict (stocktake_id, storage_bin) do nothing;
  select id into v_id from public.ckb_stocktake_bins where stocktake_id = p_stocktake and storage_bin = v_bin;
  return v_id;
end $$;

-- The bins the caller may count, with the number of live photos each has (bin_id is null until the first photo is started).
create or replace function public.ckb_stocktake_bins_for(p_stocktake uuid)
returns table (storage_bin text, bin_id uuid, photos int, lines int)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.ckb_is_staff() then raise exception 'Hanya staf CKB'; end if;
  return query
    select u.bin, b.id,
           coalesce((select count(*)::int from public.ckb_evidence e where e.entity_type = 'STOCKTAKE_BIN' and e.entity_id = b.id and e.deleted_at is null), 0),
           u.n
    from (select upper(t.storage_bin) bin, count(*)::int n from public.ckb_count_tasks t
          where t.stocktake_id = p_stocktake and public.ckb_can_count_task(t.id) group by upper(t.storage_bin)) u
    left join public.ckb_stocktake_bins b on b.stocktake_id = p_stocktake and b.storage_bin = u.bin
    order by u.bin;
end $$;

create or replace function public.ckb_entity_customer(p_type text, p_id uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select case when not public.ckb_is_staff() then null else case p_type
    when 'STOCKTAKE' then (select customer_id from public.ckb_stocktakes where id = p_id)
    when 'COUNT_TASK' then (select s.customer_id from public.ckb_count_tasks t join public.ckb_stocktakes s on s.id = t.stocktake_id where t.id = p_id)
    when 'STOCKTAKE_BIN' then (select s.customer_id from public.ckb_stocktake_bins b join public.ckb_stocktakes s on s.id = b.stocktake_id where b.id = p_id)
    when 'INSPECTION' then (select customer_id from public.ckb_inspections where id = p_id)
  end end
$$;

create or replace function public.ckb_entity_open(p_type text, p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(case p_type
    when 'STOCKTAKE' then (select status in ('DRAFT', 'COUNTING', 'REVIEW') from public.ckb_stocktakes where id = p_id)
    when 'COUNT_TASK' then (select s.status in ('COUNTING', 'REVIEW') from public.ckb_count_tasks t
                            join public.ckb_stocktakes s on s.id = t.stocktake_id where t.id = p_id)
    when 'STOCKTAKE_BIN' then (select s.status in ('COUNTING', 'REVIEW') from public.ckb_stocktake_bins b join public.ckb_stocktakes s on s.id = b.stocktake_id where b.id = p_id)
    when 'INSPECTION' then (select status in ('DRAFT', 'SUBMITTED') from public.ckb_inspections where id = p_id)
  end, false)
$$;

create or replace function public.ckb_entity_visible(p_type text, p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when public.ckb_is_staff() then public.ckb_entity_customer(p_type, p_id) is not null
    when public.ckb_role() = 'customer' then coalesce(case p_type
      when 'STOCKTAKE' then (select status = 'CLOSED' and public.ckb_can_see_customer(customer_id) from public.ckb_stocktakes where id = p_id)
      when 'COUNT_TASK' then (select s.status = 'CLOSED' and public.ckb_can_see_customer(s.customer_id)
                              from public.ckb_count_tasks t join public.ckb_stocktakes s on s.id = t.stocktake_id where t.id = p_id)
      when 'STOCKTAKE_BIN' then (select s.status = 'CLOSED' and public.ckb_can_see_customer(s.customer_id) from public.ckb_stocktake_bins b join public.ckb_stocktakes s on s.id = b.stocktake_id where b.id = p_id)
      when 'INSPECTION' then (select status in ('ACCEPTED', 'REJECTED', 'CLOSED') and public.ckb_can_see_customer(customer_id)
                              from public.ckb_inspections where id = p_id)
    end, false)
    else false
  end
$$;

create or replace function public.ckb_evidence_row_visible(p_type text, p_id uuid, p_round int) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when public.ckb_role() is distinct from 'operator' then true
    when p_type = 'STOCKTAKE' then false
    when p_type = 'COUNT_TASK' then public.ckb_can_count_task(p_id)
      and p_round is not distinct from (select round from public.ckb_count_tasks where id = p_id)
    when p_type = 'STOCKTAKE_BIN' then public.ckb_can_count_bin(p_id)
    else true
  end
$$;

create or replace function public.ckb_photo_reason(p_task uuid, p_qty numeric) returns text
language sql stable security definer set search_path = public as $$
  select case
    when not s.photo_rules then null
    when p_qty = 0 then 'hitungan 0'
    when t.origin = 'FOUND' then 'barang temuan'
    when t.round > 1 then 'hitungan ulang'
    when c.count_photo_required and c.photo_scope <> 'BIN' then 'wajib untuk pelanggan ini'   -- 0163: a bin-photo customer has its own rule
  end
  from public.ckb_count_tasks t
  join public.ckb_stocktakes s on s.id = t.stocktake_id
  join public.ckb_customers c on c.id = s.customer_id
  where t.id = p_task
$$;

create or replace function public.ckb_counts_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_reason text;
begin
  if auth.uid() is not null and not public.ckb_can_count_task(new.task_id) then
    raise exception 'Anda tidak ditugaskan menghitung baris ini';
  end if;
  v_reason := public.ckb_photo_reason(new.task_id, new.qty);
  if v_reason is not null and not exists (
       select 1 from public.ckb_evidence e join public.ckb_count_tasks t on t.id = new.task_id
       where e.entity_type = 'COUNT_TASK' and e.entity_id = new.task_id and e.round = t.round and e.deleted_at is null) then
    raise exception 'Foto wajib: % — ambil foto dulu, lalu kirim lagi', v_reason;
  end if;
  if public.ckb_bin_photo_missing(new.task_id) then
    raise exception 'Foto bin wajib: ambil foto bin ini dulu, lalu hitung barangnya';
  end if;
  return new;
end $$;

create or replace function public.ckb_evidence_count_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.entity_type = 'COUNT_TASK' then
      if auth.uid() is not null and not public.ckb_can_count_task(new.entity_id) then
        raise exception 'Anda tidak ditugaskan menghitung baris ini: foto tidak bisa ditambah';
      end if;
      new.round := (select round from public.ckb_count_tasks where id = new.entity_id);
    end if;
    if new.entity_type = 'STOCKTAKE_BIN' and auth.uid() is not null and not public.ckb_can_count_bin(new.entity_id) then
      raise exception 'Anda tidak ditugaskan menghitung bin ini: foto tidak bisa ditambah';
    end if;
    return new;
  end if;
  -- UPDATE: withdrawing a photo a submitted count relied on is for a lead only (with its logged reason).
  if new.deleted_at is not null and old.deleted_at is null and old.entity_type = 'COUNT_TASK'
     and not public.ckb_has_role(array['admin', 'supervisor'])
     and exists (select 1 from public.ckb_counts c where c.task_id = old.entity_id and c.round = old.round) then
    raise exception 'Foto ini dipakai hitungan yang sudah dikirim: hanya supervisor yang bisa menariknya';
  end if;
  if new.deleted_at is not null and old.deleted_at is null and old.entity_type = 'STOCKTAKE_BIN'
     and not public.ckb_has_role(array['admin', 'supervisor'])
     and exists (select 1 from public.ckb_counts c join public.ckb_count_tasks t on t.id = c.task_id
                 join public.ckb_stocktake_bins b on b.stocktake_id = t.stocktake_id and b.storage_bin = upper(t.storage_bin)
                 where b.id = old.entity_id) then
    raise exception 'Foto bin ini dipakai hitungan yang sudah dikirim: hanya supervisor yang bisa menariknya';
  end if;
  return new;
end $$;

create or replace function public.ckb_accept_photo_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'ACCEPTED' and old.status is distinct from 'ACCEPTED' and coalesce(new.variance, 0) <> 0
     and (select photo_rules from public.ckb_stocktakes where id = new.stocktake_id)
     and not exists (select 1 from public.ckb_evidence e where e.entity_type = 'COUNT_TASK' and e.entity_id = new.id
                     and e.deleted_at is null)
     and not public.ckb_bin_has_photo(new.id) then
    raise exception 'Selisih % pada tugas #%: perlu minimal satu foto sebelum diterima', new.variance, new.seq;
  end if;
  return new;
end $$;

revoke execute on function public.ckb_stocktake_bin(uuid, text), public.ckb_stocktake_bins_for(uuid), public.ckb_can_count_bin(uuid),
  public.ckb_bin_has_photo(uuid), public.ckb_bin_photo_missing(uuid) from public, anon;
grant execute on function public.ckb_stocktake_bin(uuid, text), public.ckb_stocktake_bins_for(uuid), public.ckb_can_count_bin(uuid),
  public.ckb_bin_has_photo(uuid), public.ckb_bin_photo_missing(uuid) to authenticated;
