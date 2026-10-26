-- =====================================================================
-- 0106  Rebagging on CKB roles, linked to customers, in the CKB audit log
--
-- The rebagging module (0084/0085/0087) predates CKB operational roles and
-- checked supervisor/admin with the Shell role (has_role). It now uses the
-- CKB role (ckb_has_role), so a Shell title never grants a CKB approval.
-- 0099 backfilled each existing CKB member's CKB role from their profile
-- role, so the same people can do the same things on day one.
--
-- The seven functions below are copied verbatim from 0085/0087 with only
-- that one check changed; posting, holds and segregation are untouched.
--
-- NOT changed, deliberately: rebagging posts its stock effect to the
-- shared Shell ledger (movements) on aisles CG/CH, as designed and pushed
-- in 0084-0086 after the site confirmed CG/CH hold the 3PL goods. Whether
-- CKB stock should leave that ledger is an open business decision
-- (docs/CKB_3PL.md §9), not something to change silently.
--
-- Also:
--   * customer_id on ckb_rebagging_jobs, resolved from the existing free
--     text column by code or name on every write (backfilled now).
--   * representatives of a customer may read that customer's finished jobs
--     (COMPLETED / REVERSED) — read only.
--   * every rebagging event is mirrored into ckb_audit_events, so the CKB
--     activity log is one place.
-- =====================================================================

alter table public.ckb_rebagging_jobs add column customer_id uuid references public.ckb_customers(id);
create index ckb_rebagging_jobs_customer_idx on public.ckb_rebagging_jobs (customer_id);

create or replace function public.ckb_rebagging_customer() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.customer_id := (select id from public.ckb_customers
                      where upper(code) = upper(trim(coalesce(new.customer, '')))
                         or lower(name) = lower(trim(coalesce(new.customer, '')))
                      order by code limit 1);
  return new;
end $$;
create trigger ckb_rebagging_customer before insert or update of customer on public.ckb_rebagging_jobs
  for each row execute function public.ckb_rebagging_customer();

update public.ckb_rebagging_jobs j set customer_id = c.id
  from public.ckb_customers c
  where j.customer_id is null and (upper(c.code) = upper(trim(coalesce(j.customer, ''))) or lower(c.name) = lower(trim(coalesce(j.customer, ''))));

create policy "ckb: customer reads finished jobs" on public.ckb_rebagging_jobs
  for select to authenticated using (
    (select public.account_active()) and public.ckb_role() = 'customer' and customer_id is not null
    and status in ('COMPLETED', 'REVERSED') and public.ckb_can_see_customer(customer_id));

create or replace function public.ckb_rebagging_event_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.ckb_audit_events (actor_id, actor_name, action, entity_type, entity_id, customer_id, details)
  values (auth.uid(), coalesce(new.by_name, public.ckb_actor_name()), 'REBAGGING_' || upper(new.event_type), 'rebagging',
    new.job_id::text, (select customer_id from public.ckb_rebagging_jobs where id = new.job_id),
    jsonb_build_object('job_no', (select job_no from public.ckb_rebagging_jobs where id = new.job_id), 'note', new.note)
      || coalesce(new.details, '{}'::jsonb));
  return new;
end $$;
create trigger ckb_rebagging_event_audit after insert on public.ckb_rebagging_events
  for each row execute function public.ckb_rebagging_event_audit();

-- set_rebagging_outputs: copied from 0085; only the role check changed.
create or replace function public.set_rebagging_outputs(
  p_job_id uuid, p_lines jsonb, p_by_name text
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_name text := public.person_name(p_by_name, 'Nama petugas');
  j public.ckb_rebagging_jobs%rowtype;
  l jsonb; i int := 0;
  v_bin public.bins%rowtype;
begin
  select * into j from public.ckb_rebagging_jobs where id = p_job_id for update;
  if j.id is null then raise exception 'Pekerjaan tidak ditemukan'; end if;
  if not public.has_ckb_app() then raise exception 'Akses ditolak: bukan anggota CKB 3PL'; end if;
  if j.status not in ('DRAFT','OPEN') then
    raise exception 'Baris output hanya bisa diubah saat Draf atau Terbuka (status: %)', j.status;
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Minimal satu baris output';
  end if;

  for l in select * from jsonb_array_elements(p_lines) loop
    i := i + 1;
    if coalesce((l->>'quantity')::numeric, 0) <= 0 then
      raise exception 'Baris output %: kuantitas harus lebih dari 0', i;
    end if;
    if nullif(trim(coalesce(l->>'unit','')), '') is null then
      raise exception 'Baris output %: satuan (unit) wajib diisi', i;
    end if;
    select * into v_bin from public.bins where bin_code = coalesce(l->>'bin_code','');
    if v_bin.id is null then
      raise exception 'Baris output %: bin % tidak ditemukan', i, coalesce(l->>'bin_code','?');
    end if;
    if v_bin.status = 'blocked' then
      raise exception 'Baris output %: bin % diblokir', i, v_bin.bin_code;
    end if;
    if v_bin.zone = 'QUARANTINE' and not public.ckb_has_role(array['supervisor','admin']) then
      raise exception 'Baris output %: tujuan karantina hanya untuk supervisor', i;
    end if;
    -- unit must match the job unit once known (set by sources)
    if j.unit is not null and trim(l->>'unit') is distinct from j.unit then
      raise exception 'Baris output %: satuan harus % (sama dengan sumber)', i, j.unit;
    end if;
  end loop;

  delete from public.ckb_rebagging_outputs where job_id = p_job_id;
  i := 0;
  for l in select * from jsonb_array_elements(p_lines) loop
    i := i + 1;
    select * into v_bin from public.bins where bin_code = coalesce(l->>'bin_code','');
    insert into public.ckb_rebagging_outputs
      (job_id, line_no, to_bin_id, quantity, unit, pkg_count,
       gross_weight, tare_weight, net_weight, weight_unit, status)
    values (p_job_id, i, v_bin.id, (l->>'quantity')::numeric, trim(l->>'unit'),
            nullif(l->>'pkg_count','')::int, nullif(l->>'gross_weight','')::numeric,
            nullif(l->>'tare_weight','')::numeric, nullif(l->>'net_weight','')::numeric,
            nullif(l->>'weight_unit',''), 'PROVISIONAL');
  end loop;

  perform public.ckb_rebagging_log_event(p_job_id, 'OUTPUTS', v_name, null,
    jsonb_build_object('lines', i));
end $$;

-- resolve_rebagging_variance: copied from 0085; only the role check changed.
create or replace function public.resolve_rebagging_variance(
  p_job_id uuid, p_reason_code text, p_note text, p_by_name text
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_name text := public.person_name(p_by_name, 'Nama penyelesai varians');
  j public.ckb_rebagging_jobs%rowtype;
begin
  if not public.ckb_has_role(array['supervisor','admin']) then
    raise exception 'Hanya supervisor atau admin yang bisa menyelesaikan varians';
  end if;
  select * into j from public.ckb_rebagging_jobs where id = p_job_id for update;
  if j.id is null then raise exception 'Pekerjaan tidak ditemukan'; end if;
  if j.status in ('COMPLETED','CANCELLED','REVERSED') then
    raise exception 'Pekerjaan sudah selesai / dibatalkan / dibalik; varians tidak bisa diubah';
  end if;
  if j.variance_qty is null or j.variance_qty = 0 then
    raise exception 'Tidak ada varians untuk diselesaikan';
  end if;
  if p_reason_code not in ('COUNT_VARIANCE','DAMAGED','EXPIRED','DATA_ENTRY','MISPICK','FOUND','LOST',
                           'RECEIVING_DIFF','RETURN','OPENING','OTHER','PICK_AUDIT') then
    raise exception 'Kode alasan varians tidak valid';
  end if;
  if nullif(trim(p_note), '') is null then
    raise exception 'Keterangan varians wajib diisi';
  end if;

  update public.ckb_rebagging_jobs
    set variance_reason = p_reason_code, variance_note = trim(p_note),
        variance_decided_by = v_name, variance_decided_at = now(), updated_at = now()
    where id = p_job_id;
  perform public.ckb_rebagging_log_event(p_job_id, 'VARIANCE', v_name, trim(p_note),
    jsonb_build_object('reason_code', p_reason_code, 'variance', j.variance_qty));
end $$;

-- toggle_rebagging_hold: copied from 0085; only the role check changed.
create or replace function public.toggle_rebagging_hold(p_job_id uuid, p_note text, p_by_name text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_name text := public.person_name(p_by_name, 'Nama supervisor');
  j public.ckb_rebagging_jobs%rowtype;
begin
  if not public.ckb_has_role(array['supervisor','admin']) then
    raise exception 'Hanya supervisor atau admin yang bisa menahan / melepas pekerjaan';
  end if;
  select * into j from public.ckb_rebagging_jobs where id = p_job_id for update;
  if j.id is null then raise exception 'Pekerjaan tidak ditemukan'; end if;

  if j.status = 'ON_HOLD' then
    if j.status_before_hold is null then
      raise exception 'Tidak ada status sebelumnya untuk dilanjutkan';
    end if;
    update public.ckb_rebagging_jobs
      set status = j.status_before_hold, status_before_hold = null, updated_at = now()
      where id = p_job_id;
    perform public.ckb_rebagging_log_event(p_job_id, 'UNHOLD', v_name, nullif(trim(p_note), ''),
      jsonb_build_object('resumed_to', j.status_before_hold));
  else
    if j.status not in ('DRAFT','OPEN','IN_PROGRESS','AWAITING_VERIFICATION','VERIFIED','REJECTED') then
      raise exception 'Status % tidak bisa ditahan', j.status;
    end if;
    update public.ckb_rebagging_jobs
      set status_before_hold = j.status, status = 'ON_HOLD', updated_at = now()
      where id = p_job_id;
    perform public.ckb_rebagging_log_event(p_job_id, 'HOLD', v_name, nullif(trim(p_note), ''),
      jsonb_build_object('paused_from', j.status));
  end if;
end $$;

-- cancel_rebagging: copied from 0085; only the role check changed.
create or replace function public.cancel_rebagging(p_job_id uuid, p_note text, p_by_name text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_name text := public.person_name(p_by_name, 'Nama supervisor');
  j public.ckb_rebagging_jobs%rowtype;
begin
  if not public.ckb_has_role(array['supervisor','admin']) then
    raise exception 'Hanya supervisor atau admin yang bisa membatalkan pekerjaan';
  end if;
  select * into j from public.ckb_rebagging_jobs where id = p_job_id for update;
  if j.id is null then raise exception 'Pekerjaan tidak ditemukan'; end if;
  if j.status in ('COMPLETED','CANCELLED','REVERSED') then
    raise exception 'Pekerjaan sudah diposting / sudah dibatalkan / sudah dibalik';
  end if;

  update public.stock_holds
    set status = 'RELEASED', released_by = auth.uid(), released_by_name = v_name,
        released_at = now(), release_note = 'Dibatalkan: ' || coalesce(nullif(trim(p_note), ''), '-')
    where ref_id = p_job_id and source = 'REBAGGING' and status = 'ACTIVE';

  update public.ckb_rebagging_jobs set status = 'CANCELLED', updated_at = now() where id = p_job_id;
  perform public.ckb_rebagging_log_event(p_job_id, 'CANCEL', v_name, trim(coalesce(p_note, '')), null);
end $$;

-- approve_post_rebagging: copied from 0085; only the role check changed.
create or replace function public.approve_post_rebagging(
  p_job_id uuid, p_note text, p_by_name text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text := public.person_name(p_by_name, 'Nama penyetuju');
  j public.ckb_rebagging_jobs%rowtype;
  s public.ckb_rebagging_sources%rowtype;
  o public.ckb_rebagging_outputs%rowtype;
  inv public.inventory%rowtype;
  -- mutable remaining quantities for greedy allocation
  v_src_rem numeric; v_out_rem numeric;
  v_pair_qty numeric;
  v_loss numeric; v_loss_left numeric;
  v_transfers int := 0; v_adjustments int := 0;
  v_pkg uuid; v_pkgs text[] := '{}';
  v_pkgno text;
  v_src_qty numeric; v_out_qty numeric;
  v_total_src numeric; v_total_out numeric;
  v_lineage_qty numeric;
  v_last_src_line_no int;
  sr record; -- allocation cursor into the temp consumed-tracking table
begin
  if not public.has_ckb_app() then raise exception 'Akses ditolak: bukan anggota CKB 3PL'; end if;
  if not public.ckb_has_role(array['supervisor','admin']) then
    raise exception 'Hanya supervisor atau admin yang bisa memposting';
  end if;

  select * into j from public.ckb_rebagging_jobs where id = p_job_id for update;
  if j.id is null then raise exception 'Pekerjaan tidak ditemukan'; end if;
  if j.status = 'COMPLETED' then raise exception 'Sudah diposting'; end if;
  if j.status in ('CANCELLED','REVERSED') then raise exception 'Pekerjaan sudah dibatalkan / dibalik'; end if;
  if j.status <> 'VERIFIED' then
    raise exception 'Pekerjaan harus Terverifikasi sebelum diposting (status: %)', j.status;
  end if;
  if public.same_person(v_name, j.executor_name) or public.same_person(v_name, j.creator_name) then
    raise exception 'Pemberi persetujuan harus orang lain dari eksekutor (%) / pembuat (%)',
      coalesce(j.executor_name, '?'), coalesce(j.creator_name, '?');
  end if;
  if not exists (select 1 from public.ckb_rebagging_evidence where job_id = p_job_id and kind = 'BEFORE')
     or not exists (select 1 from public.ckb_rebagging_evidence where job_id = p_job_id and kind = 'AFTER') then
    raise exception 'Foto BEFORE dan AFTER wajib sebelum posting';
  end if;
  if coalesce(j.variance_qty, 0) <> 0 and j.variance_decided_by is null then
    raise exception 'Varians belum diselesaikan: butuh kode alasan dan keputusan review';
  end if;
  if j.unit is null or j.item_id is null then
    raise exception 'Identitas material / satuan belum lengkap';
  end if;

  -- Revalidate the physical stock: for every source line the identity row must
  -- still hold exactly the quantity snapshotted at execution start. Any change
  -- since then means the world moved under us — the executor re-records and the
  -- job re-verified.
  for s in select * from public.ckb_rebagging_sources where job_id = p_job_id order by line_no loop
    if s.start_qty is null then
      raise exception 'Eksekusi belum mencatat snapshot stok sumber; mulai eksekusi ulang';
    end if;
    select * into inv from public.inventory iv
      where iv.bin_id = s.bin_id and iv.item_id = j.item_id and iv.batch_lot = j.batch_lot
        and iv.expiry_date is not distinct from j.expiry_date
      for update;
    if inv.bin_id is null then
      raise exception 'Stok berubah sejak eksekusi: tidak ada stok pada identitas pekerjaan di bin %; rekam ulang dan verifikasi ulang', s.bin_id;
    end if;
    if inv.quantity is distinct from s.start_qty then
      raise exception 'Stok berubah sejak eksekusi (bin: % → %); rekam ulang dan verifikasi ulang',
        s.start_qty, inv.quantity;
    end if;
  end loop;

  -- Release OUR holds first so the movement guards do not block our own transfers.
  update public.stock_holds
    set status = 'RELEASED', released_by = auth.uid(), released_by_name = v_name,
        released_at = now(), release_note = 'Posting REB'
    where ref_id = p_job_id and source = 'REBAGGING' and status = 'ACTIVE';

  -- Greedy allocation: sources by line_no fill outputs by line_no.
  --   cross-bin pair → one transfer movement;   same-bin pair → no movement.
  -- Loss (sources − outputs) is absorbed by the LAST source lines (reverse
  -- order) as negative adjustment movements.
  v_loss := j.input_qty - j.output_qty;
  if v_loss < 0 then
    raise exception 'Output melebihi input; posting ditolak (varians %)', v_loss;
  end if;

  -- Initialize remaining quantities on source lines (local to this transaction)
  -- We'll track consumption per source line using a temp table
  drop table if exists _src_rem;
  create temp table _src_rem on commit drop as
    select id, line_no, bin_id, package_id, quantity, 0::numeric as consumed
    from public.ckb_rebagging_sources
    where job_id = p_job_id
    order by line_no;

  -- For each output line, consume from earliest source with remainder
  for o in select * from public.ckb_rebagging_outputs where job_id = p_job_id order by line_no loop
    -- Create output package first so we have its ID for lineage
    v_pkgno := 'PKG' || lpad(nextval('public.ckb_package_seq')::text, 6, '0');
    insert into public.ckb_packages
      (package_no, item_id, batch_lot, expiry_date, quantity, unit, pkg_count, bin_id,
       status, source_job_id)
    values (v_pkgno, j.item_id, j.batch_lot, j.expiry_date, o.quantity, j.unit, o.pkg_count,
            o.to_bin_id, 'ACTIVE', j.id)
    returning id into v_pkg;
    v_pkgs := v_pkgs || v_pkgno;

    v_out_rem := o.quantity;
    while v_out_rem > 0 loop
      select * into sr from _src_rem
        where quantity - consumed > 0
        order by line_no limit 1;
      if not found then
        raise exception 'Kesalahan alokasi: output melebihi sumber';
      end if;
      v_src_rem := sr.quantity - sr.consumed;
      v_pair_qty := least(v_src_rem, v_out_rem);
      if sr.bin_id is distinct from o.to_bin_id then
        insert into public.movements
          (type, item_id, batch_lot, quantity, from_bin_id, to_bin_id, expiry_date,
           note, by_name, approved_by_name, ref_id)
        values ('transfer', j.item_id, j.batch_lot, v_pair_qty, sr.bin_id, o.to_bin_id, j.expiry_date,
                'REBAG ' || j.job_no || ' keluar baris ' || o.line_no,
                j.executor_name, v_name, j.id);
        v_transfers := v_transfers + 1;
      end if;
      update _src_rem set consumed = consumed + v_pair_qty where id = sr.id;
      v_out_rem := v_out_rem - v_pair_qty;

      -- Lineage row for this pair (output_package_id now known)
      insert into public.ckb_package_lineage
        (source_package_id, source_job_id, output_package_id, output_job_id, quantity)
      values (sr.package_id, p_job_id, v_pkg, p_job_id, v_pair_qty);
    end loop;
    update public.ckb_rebagging_outputs
      set package_id = v_pkg, status = 'ACTIVE'
      where id = o.id;
  end loop;

  -- Loss adjustment: negative adjustment on source bins in REVERSE line_no order
  v_loss_left := v_loss;
  if v_loss_left > 0 then
    perform set_config('app.adjust_approved', 'on', true);
    perform set_config('app.adjust_reason', j.variance_reason, true);
    perform set_config('app.by_name', j.executor_name, true);

    for sr in select * from _src_rem where consumed > 0 order by line_no desc loop
      exit when v_loss_left <= 0;
      v_src_qty := sr.consumed;
      v_pair_qty := least(v_src_qty, v_loss_left);
      insert into public.movements
        (type, item_id, batch_lot, quantity, to_bin_id, expiry_date,
         note, reason_code, by_name, approved_by_name, ref_id)
      values ('adjustment', j.item_id, j.batch_lot, -v_pair_qty, sr.bin_id, j.expiry_date,
              'REBAG ' || j.job_no || ' kerugian baris ' || sr.line_no,
              j.variance_reason, j.executor_name, v_name, j.id);
      v_adjustments := v_adjustments + 1;
      v_loss_left := v_loss_left - v_pair_qty;
    end loop;

    perform set_config('app.adjust_approved', '', true);
    perform set_config('app.adjust_reason', '', true);
    perform set_config('app.by_name', '', true);
  end if;

  -- Retire PACKAGE-sourced source packages
  update public.ckb_packages
    set status = 'RETIRED', retired_at = now(), retired_note = 'Konsumsi rebagging ' || j.job_no
    where id in (select package_id from public.ckb_rebagging_sources
                 where job_id = p_job_id and source_type = 'PACKAGE' and package_id is not null);

  -- Finalize job
  update public.ckb_rebagging_jobs
    set status = 'COMPLETED', posted_ref = j.job_no, posted_at = now(),
        approver_name = v_name, last_post_error = null, updated_at = now()
    where id = p_job_id;

  perform public.ckb_rebagging_log_event(p_job_id, 'POST', v_name, trim(coalesce(p_note, '')),
    jsonb_build_object('transfers', v_transfers, 'adjustments', v_adjustments, 'packages', v_pkgs));

  return jsonb_build_object('job_no', j.job_no, 'transfers', v_transfers, 'adjustments', v_adjustments, 'packages', v_pkgs);
end $$;

-- reverse_rebagging_posting: copied from 0085; only the role check changed.
create or replace function public.reverse_rebagging_posting(p_job_id uuid, p_note text, p_by_name text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_name text := public.person_name(p_by_name, 'Nama pembalik');
  j public.ckb_rebagging_jobs%rowtype;
  s public.ckb_rebagging_sources%rowtype;
  o public.ckb_rebagging_outputs%rowtype;
  inv public.inventory%rowtype;
  v_src_rem numeric; v_out_rem numeric;
  v_pair_qty numeric;
  sr record; -- allocation cursor into the temp consumed-tracking table
  v_rev_transfers int := 0; v_rev_adjustments int := 0;
  v_pkg uuid;
begin
  if not public.ckb_has_role(array['supervisor','admin']) then
    raise exception 'Hanya supervisor atau admin yang bisa membalik posting';
  end if;

  select * into j from public.ckb_rebagging_jobs where id = p_job_id for update;
  if j.id is null then raise exception 'Pekerjaan tidak ditemukan'; end if;
  if j.status <> 'COMPLETED' then
    raise exception 'Hanya pekerjaan yang sudah diposting yang bisa dibalik (status: %)', j.status;
  end if;

  -- Lock all output inventory rows FOR UPDATE; must still hold ≥ output qty
  for o in select * from public.ckb_rebagging_outputs where job_id = p_job_id loop
    select * into inv from public.inventory iv
      where iv.bin_id = o.to_bin_id and iv.item_id = j.item_id and iv.batch_lot = j.batch_lot
        and iv.expiry_date is not distinct from j.expiry_date
      for update;
    if inv.bin_id is null or inv.quantity < o.quantity then
      raise exception 'Stok output sudah berpindah dari bin % (tersedia: %, butuh: %); tidak bisa dibalik',
        o.to_bin_id, coalesce(inv.quantity, 0), o.quantity;
    end if;
  end loop;

  -- Rebuild the SAME greedy pairs from the job's own (unchanged) sources/outputs rows
  drop table if exists _src_rem_rv;
  create temp table _src_rem_rv on commit drop as
    select id, line_no, bin_id, quantity, 0::numeric as consumed
    from public.ckb_rebagging_sources
    where job_id = p_job_id
    order by line_no;

  for o in select * from public.ckb_rebagging_outputs where job_id = p_job_id order by line_no loop
    v_out_rem := o.quantity;
    while v_out_rem > 0 loop
      select * into sr from _src_rem_rv
        where quantity - consumed > 0
        order by line_no limit 1;
      if not found then
        raise exception 'Kesalahan alokasi pembalikan: output melebihi sumber';
      end if;
      v_src_rem := sr.quantity - sr.consumed;
      v_pair_qty := least(v_src_rem, v_out_rem);
      if sr.bin_id is distinct from o.to_bin_id then
        -- Reverse transfer: output bin → source bin
        insert into public.movements
          (type, item_id, batch_lot, quantity, from_bin_id, to_bin_id, expiry_date,
           note, by_name, approved_by_name, ref_id)
        values ('transfer', j.item_id, j.batch_lot, v_pair_qty, o.to_bin_id, sr.bin_id, j.expiry_date,
                'BATAL REB ' || j.job_no || ' baris ' || o.line_no,
                v_name, v_name, j.id);
        v_rev_transfers := v_rev_transfers + 1;
      end if;
      update _src_rem_rv set consumed = consumed + v_pair_qty where id = sr.id;
      v_out_rem := v_out_rem - v_pair_qty;
    end loop;
  end loop;

  -- Positive adjustment to restore loss (reverse of negative adjustment)
  if j.variance_qty > 0 then
    perform set_config('app.adjust_approved', 'on', true);
    perform set_config('app.adjust_reason', 'DATA_ENTRY', true);
    perform set_config('app.by_name', v_name, true);

    for sr in select * from _src_rem_rv where consumed > 0 order by line_no desc loop
      exit when j.variance_qty <= 0;
      v_pair_qty := least(sr.consumed, j.variance_qty);
      insert into public.movements
        (type, item_id, batch_lot, quantity, to_bin_id, expiry_date,
         note, reason_code, by_name, approved_by_name, ref_id)
      values ('adjustment', j.item_id, j.batch_lot, v_pair_qty, sr.bin_id, j.expiry_date,
              'Pembalikan REB ' || j.job_no || ' kerugian baris ' || sr.line_no,
              'DATA_ENTRY', v_name, v_name, j.id);
      v_rev_adjustments := v_rev_adjustments + 1;
      j.variance_qty := j.variance_qty - v_pair_qty;
    end loop;

    perform set_config('app.adjust_approved', '', true);
    perform set_config('app.adjust_reason', '', true);
    perform set_config('app.by_name', '', true);
  end if;

  -- Retire output packages
  update public.ckb_packages
    set status = 'RETIRED', retired_at = now(), retired_note = 'Dibalik: ' || coalesce(nullif(trim(p_note), ''), '-')
    where source_job_id = p_job_id;

  -- Re-activate PACKAGE-sourced source packages
  update public.ckb_packages
    set status = 'ACTIVE', retired_at = null, retired_note = null
    where id in (select package_id from public.ckb_rebagging_sources
                 where job_id = p_job_id and source_type = 'PACKAGE' and package_id is not null);

  -- Set output rows back to PROVISIONAL
  update public.ckb_rebagging_outputs
    set package_id = null, status = 'PROVISIONAL'
    where job_id = p_job_id;

  -- Finalize job
  update public.ckb_rebagging_jobs
    set status = 'REVERSED', reversed_by = v_name, reversed_at = now(),
        reversal_note = trim(coalesce(p_note, '')), updated_at = now()
    where id = p_job_id;

  perform public.ckb_rebagging_log_event(p_job_id, 'REVERSE', v_name, trim(coalesce(p_note, '')),
    jsonb_build_object('rev_transfers', v_rev_transfers, 'rev_adjustments', v_rev_adjustments));
end $$;

-- delete_rebagging_job: copied from 0087; only the role check changed.
create or replace function public.delete_rebagging_job(p_job_id uuid, p_reason text, p_by_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := public.person_name(p_by_name, 'Nama petugas');
  j public.ckb_rebagging_jobs%rowtype;
  ev record;
begin
  if not public.ckb_has_role(array['admin']) then
    raise exception 'Hanya admin yang bisa menghapus pekerjaan rebagging';
  end if;
  if not public.has_ckb_app() then raise exception 'Akses ditolak: bukan anggota CKB 3PL'; end if;

  select * into j from public.ckb_rebagging_jobs where id = p_job_id for update;
  if j.id is null then raise exception 'Pekerjaan tidak ditemukan'; end if;

  if j.posted_at is not null or j.status in ('COMPLETED','REVERSED') then
    raise exception 'Pekerjaan % sudah diposting: pakai Balikkan posting; hapus permanen tidak diizinkan agar riwayat mutasi tetap utuh', j.job_no;
  end if;

  -- Release THIS job's REBAGGING holds — SAME predicate as cancel_rebagging
  update public.stock_holds
    set status = 'RELEASED', released_by = auth.uid(), released_by_name = v_name,
        released_at = now(), release_note = 'Dihapus: ' || coalesce(nullif(trim(p_reason), ''), '-')
    where ref_id = p_job_id and source = 'REBAGGING' and status = 'ACTIVE';

  -- Best-effort storage cleanup; storage differences must never fail the delete
  for ev in select storage_path from public.ckb_rebagging_evidence where job_id = j.id loop
    begin
      delete from storage.objects where bucket_id = 'ckb-rebagging' and name = ev.storage_path;
    exception when others then null;
    end;
  end loop;

  -- Tombstone, then the row (cascades to sources/outputs/evidence/events via ON DELETE CASCADE)
  insert into public.ckb_rebagging_deleted_jobs (job_no, warehouse, status, creator_name, reason, deleted_by, delete_reason)
    values (j.job_no, j.warehouse, j.status, j.creator_name, j.reason, v_name, nullif(p_reason, ''));

  delete from public.ckb_rebagging_jobs where id = j.id;
end $$;
