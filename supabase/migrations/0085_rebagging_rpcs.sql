-- =====================================================================
-- 0085  Rebagging RPCs for CKB 3PL
--
-- All functions are SECURITY DEFINER (set search_path = public), so every
-- authorization gate is programmatic: has_ckb_app() for membership,
-- has_role() for supervisor/admin, person_name()/same_person() for
-- segregation of duties by typed names (INVENTORY_CONTROL §7).
-- Indonesian error messages; a ckb_rebagging_events row is appended on
-- every transition; the job row is locked FOR UPDATE at the top of every
-- mutating RPC. Status guards provide posting idempotency.
--
-- Posting model (single transaction inside approve_post_rebagging):
--   release this job's REBAGGING holds → greedy allocation (sources by
--   line_no against outputs by line_no) → one `transfer` movement per
--   cross-bin pair (same-bin pairs move nothing) → loss = sum(sources) −
--   sum(outputs) posted as negative `adjustment` movement(s) on the
--   source bin(s) (movement guard satisfied with app.adjust_approved='on',
--   §0018 precedent) → one ACTIVE ckb_packages row per output line plus
--   one ckb_package_lineage row per pair → PACKAGE-sourced packages
--   RETIRED → job COMPLETED. Double posting is refused by the status
--   guard ('Sudah diposting'), so retries cannot duplicate movements.
--
-- Segregation: verifier ≠ executor, verifier ≠ creator, approver ≠
-- executor, approver ≠ creator. Verifier and approver MAY be the same
-- second person (small site; both stay independent of the maker).
-- =====================================================================

-- =====================================================================
-- Helper: append one event row (used by every RPC below)
-- =====================================================================
create or replace function public.ckb_rebagging_log_event(
  p_job_id uuid, p_event_type text, p_by_name text default null, p_note text default null, p_details jsonb default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.ckb_rebagging_events (job_id, event_type, by_name, note, details)
  values (p_job_id, p_event_type, p_by_name, p_note, p_details);
end $$;

revoke execute on function public.ckb_rebagging_log_event(uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.ckb_rebagging_log_event(uuid, text, text, text, jsonb) to authenticated;

-- =====================================================================
-- 1. create_rebagging_job — DRAFT job. Material identity is nullable at
--    creation and derived by set_rebagging_sources (0084 keeps
--    ckb_rebagging_jobs.item_id nullable for exactly this reason).
-- =====================================================================
create or replace function public.create_rebagging_job(
  p_operation_type text, p_reason text, p_warehouse text,
  p_customer text, p_customer_ref text,
  p_shift text, p_priority int, p_note text,
  p_by_name text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_name text := public.person_name(p_by_name, 'Nama pembuat');
  v_job uuid;
begin
  if not public.has_ckb_app() then
    raise exception 'Akses ditolak: bukan anggota CKB 3PL';
  end if;
  if p_operation_type not in ('DAMAGE_REBAG','SPLIT','RELABEL','COMBINE') then
    raise exception 'Jenis operasi tidak valid';
  end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Alasan wajib diisi'; end if;
  if nullif(trim(p_warehouse), '') is null then raise exception 'Gudang wajib diisi'; end if;
  if nullif(trim(p_shift), '') is null then raise exception 'Shift wajib diisi'; end if;

  insert into public.ckb_rebagging_jobs
    (operation_type, reason, warehouse, customer, customer_ref, shift, priority,
     note, status, creator_name, batch_lot, created_by)
  values
    (p_operation_type, trim(p_reason), trim(p_warehouse), p_customer, p_customer_ref, trim(p_shift),
     coalesce(p_priority, 0), p_note, 'DRAFT', v_name, '', auth.uid())
  returning id into v_job;

  perform public.ckb_rebagging_log_event(v_job, 'CREATE', v_name, null,
    jsonb_build_object('operation_type', p_operation_type, 'warehouse', p_warehouse));
  return v_job;
end $$;

revoke execute on function public.create_rebagging_job(text, text, text, text, text, text, int, text, text) from public, anon;
grant execute on function public.create_rebagging_job(text, text, text, text, text, text, int, text, text) to authenticated;

-- =====================================================================
-- 2. set_rebagging_sources — replace-all source lines (DRAFT/OPEN only).
--    Line JSON: {source_type:"STOCK"|"PACKAGE", bin_code?, package_no?,
--    sku?, batch_lot?, expiry_date? "YYYY-MM-DD", quantity>0, unit,
--    pkg_count?, gross_weight?, tare_weight?, net_weight?, weight_unit?}
--    A bin holding exactly one identity needs no hints; several
--    identities require sku (and batch/expiry to pin one row).
--    Derives the job's (item_id, batch_lot, expiry_date) and unit.
-- =====================================================================
create or replace function public.set_rebagging_sources(
  p_job_id uuid, p_lines jsonb, p_by_name text
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_name text := public.person_name(p_by_name, 'Nama petugas');
  j public.ckb_rebagging_jobs%rowtype;
  l jsonb; i int := 0;
  v_bin uuid; v_pkg public.ckb_packages%rowtype;
  v_item uuid; v_batch text; v_exp date;
  f_item uuid; f_batch text; f_exp date; f_unit text;
  v_ok int; v_qty numeric;
begin
  select * into j from public.ckb_rebagging_jobs where id = p_job_id for update;
  if j.id is null then raise exception 'Pekerjaan tidak ditemukan'; end if;
  if not public.has_ckb_app() then raise exception 'Akses ditolak: bukan anggota CKB 3PL'; end if;
  if j.status not in ('DRAFT','OPEN') then
    raise exception 'Baris sumber hanya bisa diubah saat Draf atau Terbuka (status: %)', j.status;
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Minimal satu baris sumber';
  end if;

  delete from public.ckb_rebagging_sources where job_id = p_job_id;

  for l in select * from jsonb_array_elements(p_lines) loop
    i := i + 1;
    v_qty := coalesce((l->>'quantity')::numeric, 0);
    if v_qty <= 0 then
      raise exception 'Baris sumber %: kuantitas harus lebih dari 0', i;
    end if;
    if nullif(trim(coalesce(l->>'unit','')), '') is null then
      raise exception 'Baris sumber %: satuan (unit) wajib diisi', i;
    end if;
    if coalesce(l->>'source_type','STOCK') = 'PACKAGE' then
      select * into v_pkg from public.ckb_packages
        where package_no = coalesce(l->>'package_no','') and status = 'ACTIVE';
      if v_pkg.id is null then
        raise exception 'Baris sumber %: paket % tidak ada atau sudah tidak aktif', i, coalesce(l->>'package_no','?');
      end if;
      if v_pkg.bin_id is null then
        raise exception 'Paket % tidak punya lokasi bin', v_pkg.package_no;
      end if;
      v_bin := v_pkg.bin_id; v_item := v_pkg.item_id; v_batch := v_pkg.batch_lot; v_exp := v_pkg.expiry_date;
      if v_qty > v_pkg.quantity then
        raise exception 'Baris sumber %: kuantitas melebihi isi paket % (%)', i, v_pkg.package_no, v_pkg.quantity;
      end if;
      insert into public.ckb_rebagging_sources
        (job_id, line_no, source_type, package_id, bin_id, quantity, unit, pkg_count,
         gross_weight, tare_weight, net_weight, weight_unit)
      values (p_job_id, i, 'PACKAGE', v_pkg.id, v_bin, v_qty, trim(l->>'unit'),
              nullif(l->>'pkg_count','')::int, nullif(l->>'gross_weight','')::numeric,
              nullif(l->>'tare_weight','')::numeric, nullif(l->>'net_weight','')::numeric,
              nullif(l->>'weight_unit',''));
    else
      select id into v_bin from public.bins where bin_code = coalesce(l->>'bin_code','');
      if v_bin is null then
        raise exception 'Baris sumber %: bin % tidak ditemukan', i, coalesce(l->>'bin_code','?');
      end if;
      if exists (select 1 from public.bins where id = v_bin and status = 'blocked') then
        raise exception 'Baris sumber %: bin % diblokir', i, l->>'bin_code';
      end if;
      -- Resolve ONE stock identity (bin+sku+batch+expiry). Given hints pin the row;
      -- without hints the bin must contain exactly one identity with stock.
      select iv.item_id, iv.batch_lot, iv.expiry_date into v_item, v_batch, v_exp
        from public.inventory iv
        where iv.bin_id = v_bin
          and (l->>'sku' is null or iv.item_id = (select it.id from public.items it where it.sku = l->>'sku'))
          and (l->>'batch_lot' is null or iv.batch_lot = coalesce(l->>'batch_lot',''))
          and (l->>'expiry_date' is null or iv.expiry_date = (l->>'expiry_date')::date)
          and iv.quantity > 0;
      if v_item is null then
        raise exception 'Baris sumber %: tidak ada stok yang cocok di % (bin dengan beberapa identitas wajib menyebut SKU/batch/expired)', i, l->>'bin_code';
      end if;
      select count(*) into v_ok from public.inventory iv
        where iv.bin_id = v_bin and iv.item_id = v_item and iv.batch_lot = v_batch
          and iv.expiry_date is not distinct from v_exp and iv.quantity > 0;
      if v_ok > 1 then
        raise exception 'Baris sumber %: beberapa baris stok cocok di %; sebutkan juga batch/expired', i, l->>'bin_code';
      end if;
      if (select iv.quantity from public.inventory iv
            where iv.bin_id = v_bin and iv.item_id = v_item and iv.batch_lot = v_batch
              and iv.expiry_date is not distinct from v_exp) < v_qty then
        raise exception 'Baris sumber %: stok tidak cukup di %', i, l->>'bin_code';
      end if;
      insert into public.ckb_rebagging_sources
        (job_id, line_no, source_type, bin_id, quantity, unit, pkg_count,
         gross_weight, tare_weight, net_weight, weight_unit)
      values (p_job_id, i, 'STOCK', v_bin, v_qty, trim(l->>'unit'),
              nullif(l->>'pkg_count','')::int, nullif(l->>'gross_weight','')::numeric,
              nullif(l->>'tare_weight','')::numeric, nullif(l->>'net_weight','')::numeric,
              nullif(l->>'weight_unit',''));
    end if;

    -- one identity and one unit across all lines
    if f_item is null then
      f_item := v_item; f_batch := coalesce(v_batch, ''); f_exp := v_exp; f_unit := trim(l->>'unit');
    else
      if v_item is distinct from f_item or coalesce(v_batch,'') is distinct from f_batch
         or v_exp is distinct from f_exp then
        raise exception 'Semua baris sumber harus satu identitas material (SKU/batch/expired sama)';
      end if;
      if trim(l->>'unit') is distinct from f_unit then
        raise exception 'Semua baris sumber harus pakai satu satuan (unit %)', f_unit;
      end if;
    end if;
  end loop;

  update public.ckb_rebagging_jobs
    set item_id = f_item, batch_lot = coalesce(f_batch, ''), expiry_date = f_exp, unit = f_unit,
        updated_at = now()
    where id = p_job_id;

  perform public.ckb_rebagging_log_event(p_job_id, 'SOURCES', v_name, null,
    jsonb_build_object('lines', i, 'unit', f_unit, 'item', (select it.sku from public.items it where it.id = f_item)));
end $$;

revoke execute on function public.set_rebagging_sources(uuid, jsonb, text) from public, anon;
grant execute on function public.set_rebagging_sources(uuid, jsonb, text) to authenticated;

-- =====================================================================
-- 3. set_rebagging_outputs — replace-all planned output lines
--    (DRAFT/OPEN only). Line JSON: {bin_code, quantity>0, unit,
--    pkg_count?, gross_weight?, tare_weight?, net_weight?, weight_unit?}
-- =====================================================================
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
    if v_bin.zone = 'QUARANTINE' and not public.has_role(array['supervisor','admin']::public.user_role[]) then
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

revoke execute on function public.set_rebagging_outputs(uuid, jsonb, text) from public, anon;
grant execute on function public.set_rebagging_outputs(uuid, jsonb, text) to authenticated;

-- =====================================================================
-- 4. open_rebagging_job — DRAFT → OPEN. Requires ≥1 source (identity
--    derived), ≥1 output, output total ≤ source total.
-- =====================================================================
create or replace function public.open_rebagging_job(p_job_id uuid, p_by_name text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_name text := public.person_name(p_by_name, 'Nama petugas');
  j public.ckb_rebagging_jobs%rowtype;
  v_src numeric; v_out numeric; v_n_src int; v_n_out int;
begin
  select * into j from public.ckb_rebagging_jobs where id = p_job_id for update;
  if j.id is null then raise exception 'Pekerjaan tidak ditemukan'; end if;
  if not public.has_ckb_app() then raise exception 'Akses ditolak: bukan anggota CKB 3PL'; end if;
  if j.status <> 'DRAFT' then raise exception 'Hanya pekerjaan Draf yang bisa dibuka (status: %)', j.status; end if;

  select count(*), coalesce(sum(quantity), 0) into v_n_src, v_src from public.ckb_rebagging_sources where job_id = p_job_id;
  select count(*), coalesce(sum(quantity), 0) into v_n_out, v_out from public.ckb_rebagging_outputs where job_id = p_job_id;
  if v_n_src = 0 or j.item_id is null then
    raise exception 'Identitas material belum diisi: daftar sumber kosong atau tidak valid';
  end if;
  if v_n_out = 0 then
    raise exception 'Baris output kosong: rencanakan minimal satu output';
  end if;
  if v_out > v_src then
    raise exception 'Total output (%) melebihi total sumber (%)', v_out, v_src;
  end if;

  update public.ckb_rebagging_jobs set status = 'OPEN', updated_at = now() where id = p_job_id;
  perform public.ckb_rebagging_log_event(p_job_id, 'OPEN', v_name, null, null);
end $$;

revoke execute on function public.open_rebagging_job(uuid, text) from public, anon;
grant execute on function public.open_rebagging_job(uuid, text) to authenticated;

-- =====================================================================
-- 5. start_rebagging_execution — OPEN → IN_PROGRESS. Records executor,
--    snapshots each source identity's physical qty (stok saat mulai),
--    and places exclusive REBAGGING LINE holds per source line.
--    A stock identity can be held for only one job at a time.
-- =====================================================================
create or replace function public.start_rebagging_execution(p_job_id uuid, p_by_name text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_name text := public.person_name(p_by_name, 'Nama eksekutor');
  j public.ckb_rebagging_jobs%rowtype;
  s public.ckb_rebagging_sources%rowtype;
  inv public.inventory%rowtype;
begin
  select * into j from public.ckb_rebagging_jobs where id = p_job_id for update;
  if j.id is null then raise exception 'Pekerjaan tidak ditemukan'; end if;
  if not public.has_ckb_app() then raise exception 'Akses ditolak: bukan anggota CKB 3PL'; end if;
  if j.status <> 'OPEN' then
    raise exception 'Eksekusi hanya bisa dimulai dari status Terbuka (status: %)', j.status;
  end if;

  for s in select * from public.ckb_rebagging_sources where job_id = p_job_id order by line_no loop
    select * into inv from public.inventory iv
      where iv.bin_id = s.bin_id and iv.item_id = j.item_id and iv.batch_lot = j.batch_lot
        and iv.expiry_date is not distinct from j.expiry_date
      for update;
    if inv.bin_id is null or inv.quantity < s.quantity then
      raise exception 'Stok tidak cukup di bin dengan identitas pekerjaan ini (stok: %, minta: %)',
        coalesce(inv.quantity, 0), s.quantity;
    end if;
    -- exclusive hold: another live hold on this identity (LINE) or any
    -- BATCH hold for the material blocks a second concurrent job.
    if exists (select 1 from public.stock_holds h
                 where h.status = 'ACTIVE' and h.scope = 'LINE'
                   and h.bin_id = s.bin_id and h.item_id = j.item_id
                   and h.batch_lot = j.batch_lot and h.expiry_date is not distinct from j.expiry_date)
        or exists (select 1 from public.stock_holds h
                     where h.status = 'ACTIVE' and h.scope = 'BATCH'
                       and h.item_id = j.item_id and h.batch_lot = j.batch_lot) then
      raise exception 'Stok identitas ini sedang di-hold oleh pekerjaan lain; selesaikan atau batalkan dulu';
    end if;
    insert into public.stock_holds
      (scope, bin_id, item_id, batch_lot, expiry_date, quantity, reason_code, note, source, ref_id,
       created_by, created_by_name)
    values ('LINE', s.bin_id, j.item_id, j.batch_lot, j.expiry_date, s.quantity, 'REBAGGING',
            'REBAG ' || j.job_no || ' baris ' || s.line_no, 'REBAGGING', j.id, auth.uid(), v_name);
    update public.ckb_rebagging_sources
      set start_qty = inv.quantity
      where id = s.id;
  end loop;

  update public.ckb_rebagging_jobs
    set status = 'IN_PROGRESS', executor_name = v_name, updated_at = now()
    where id = p_job_id;
  perform public.ckb_rebagging_log_event(p_job_id, 'START', v_name, null, null);
end $$;

revoke execute on function public.start_rebagging_execution(uuid, text) from public, anon;
grant execute on function public.start_rebagging_execution(uuid, text) to authenticated;

-- =====================================================================
-- 6. record_rebagging_execution — replace-all actuals while
--    IN_PROGRESS (or REJECTED, after which the job returns to
--    IN_PROGRESS). Executed only by the recorded executor.
--    inputs/outputs JSON: [{line_no, quantity, unit, pkg_count?, ...}]
-- =====================================================================
create or replace function public.record_rebagging_execution(
  p_job_id uuid, p_inputs jsonb, p_outputs jsonb, p_checklist jsonb, p_by_name text
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_name text := public.person_name(p_by_name, 'Nama eksekutor');
  j public.ckb_rebagging_jobs%rowtype;
  l jsonb; v_in numeric := 0; v_out numeric := 0; v_unit text;
  s public.ckb_rebagging_sources%rowtype; o public.ckb_rebagging_outputs%rowtype;
begin
  select * into j from public.ckb_rebagging_jobs where id = p_job_id for update;
  if j.id is null then raise exception 'Pekerjaan tidak ditemukan'; end if;
  if not public.has_ckb_app() then raise exception 'Akses ditolak: bukan anggota CKB 3PL'; end if;
  if j.status not in ('IN_PROGRESS','REJECTED') then
    raise exception 'Perekaman eksekusi hanya saat Sedang Berjalan / Ditolak (status: %)', j.status;
  end if;
  if j.executor_name is null or not public.same_person(v_name, j.executor_name) then
    raise exception 'Hanya eksekutor (%) yang bisa merekam eksekusi', coalesce(j.executor_name, '?');
  end if;
  if p_inputs is null or jsonb_typeof(p_inputs) <> 'array' or jsonb_array_length(p_inputs) = 0 then
    raise exception 'Rincian input wajib diisi';
  end if;
  if p_outputs is null or jsonb_typeof(p_outputs) <> 'array' or jsonb_array_length(p_outputs) = 0 then
    raise exception 'Rincian output wajib diisi';
  end if;

  -- every recorded input line must match its source line exactly (the source
  -- line quantity IS the amount this job consumes; partial rebagging is done
  -- by planning a smaller source line, not by recording less).
  for l in select * from jsonb_array_elements(p_inputs) loop
    select * into s from public.ckb_rebagging_sources
      where job_id = p_job_id and line_no = (l->>'line_no')::int;
    if s.id is null then raise exception 'Baris input % tidak ditemukan pada daftar sumber', l->>'line_no'; end if;
    if coalesce((l->>'quantity')::numeric, 0) <> s.quantity then
      raise exception 'Input baris % harus % (sesuai rencana sumber)', l->>'line_no', s.quantity;
    end if;
    if v_unit is null then v_unit := trim(coalesce(l->>'unit', j.unit)); end if;
    if trim(coalesce(l->>'unit', j.unit)) is distinct from v_unit then
      raise exception 'Satuan input tidak konsisten';
    end if;
  end loop;
  for l in select * from jsonb_array_elements(p_outputs) loop
    select * into o from public.ckb_rebagging_outputs
      where job_id = p_job_id and line_no = (l->>'line_no')::int;
    if o.id is null then raise exception 'Baris output % tidak ditemukan', l->>'line_no'; end if;
    if coalesce((l->>'quantity')::numeric, 0) <= 0 then
      raise exception 'Baris output %: kuantitas harus lebih dari 0', l->>'line_no';
    end if;
    if trim(coalesce(l->>'unit', j.unit)) is distinct from v_unit then
      raise exception 'Satuan output tidak konsisten dengan input';
    end if;
  end loop;

  select coalesce(sum((el->>'quantity')::numeric), 0) into v_in from jsonb_array_elements(p_inputs) el;
  select coalesce(sum((el->>'quantity')::numeric), 0) into v_out from jsonb_array_elements(p_outputs) el;

  update public.ckb_rebagging_jobs
    set actual_inputs = p_inputs, actual_outputs = p_outputs, checklist = p_checklist,
        input_qty = v_in, output_qty = v_out, unit = v_unit,
        variance_qty = v_in - v_out,
        pkg_count_in = coalesce((select sum((el->>'pkg_count')::int) from jsonb_array_elements(p_inputs) el), 0),
        pkg_count_out = coalesce((select sum((el->>'pkg_count')::int) from jsonb_array_elements(p_outputs) el), 0),
        status = case when j.status = 'REJECTED' then 'IN_PROGRESS' else j.status end,
        updated_at = now()
    where id = p_job_id;

  perform public.ckb_rebagging_log_event(p_job_id, 'RECORD', v_name, null,
    jsonb_build_object('input', v_in, 'output', v_out, 'unit', v_unit));
end $$;

revoke execute on function public.record_rebagging_execution(uuid, jsonb, jsonb, jsonb, text) from public, anon;
grant execute on function public.record_rebagging_execution(uuid, jsonb, jsonb, jsonb, text) to authenticated;

-- =====================================================================
-- 7. submit_rebagging_verification — IN_PROGRESS → AWAITING_VERIFICATION.
--    Gates: both photo kinds present, actuals recorded, variance stored.
-- =====================================================================
create or replace function public.submit_rebagging_verification(p_job_id uuid, p_by_name text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_name text := public.person_name(p_by_name, 'Nama eksekutor');
  j public.ckb_rebagging_jobs%rowtype;
begin
  select * into j from public.ckb_rebagging_jobs where id = p_job_id for update;
  if j.id is null then raise exception 'Pekerjaan tidak ditemukan'; end if;
  if not public.has_ckb_app() then raise exception 'Akses ditolak: bukan anggota CKB 3PL'; end if;
  if j.status <> 'IN_PROGRESS' then
    raise exception 'Penyerahan verifikasi hanya saat Sedang Berjalan (status: %)', j.status;
  end if;
  if j.executor_name is null or not public.same_person(v_name, j.executor_name) then
    raise exception 'Hanya eksekutor (%) yang bisa menyerahkan verifikasi', coalesce(j.executor_name, '?');
  end if;
  if not exists (select 1 from public.ckb_rebagging_evidence
                   where job_id = p_job_id and kind = 'BEFORE') then
    raise exception 'Foto BEFORE wajib sebelum verifikasi (kondisi sebelum rebagging)';
  end if;
  if not exists (select 1 from public.ckb_rebagging_evidence
                   where job_id = p_job_id and kind = 'AFTER') then
    raise exception 'Foto AFTER wajib sebelum verifikasi (kondisi setelah rebagging)';
  end if;
  if j.actual_inputs is null or j.actual_outputs is null then
    raise exception 'Kuantitas eksekusi belum direkam: isi input dan output dulu';
  end if;
  if j.input_qty is null or j.output_qty is null or j.unit is null then
    raise exception 'Rekonsiliasi kuantitas belum lengkap';
  end if;

  update public.ckb_rebagging_jobs
    set status = 'AWAITING_VERIFICATION', updated_at = now()
    where id = p_job_id;
  perform public.ckb_rebagging_log_event(p_job_id, 'SUBMIT', v_name, null,
    jsonb_build_object('input', j.input_qty, 'output', j.output_qty, 'variance', j.variance_qty));
end $$;

revoke execute on function public.submit_rebagging_verification(uuid, text) from public, anon;
grant execute on function public.submit_rebagging_verification(uuid, text) to authenticated;

-- =====================================================================
-- 8. verify_rebagging — AWAITING_VERIFICATION → VERIFIED or REJECTED.
--    Any CKB member except the executor and the creator ("someone else").
--    Rejecting requires a reason; recording again returns to IN_PROGRESS.
-- =====================================================================
create or replace function public.verify_rebagging(
  p_job_id uuid, p_approved boolean, p_note text, p_by_name text
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_name text := public.person_name(p_by_name, 'Nama verifikator');
  j public.ckb_rebagging_jobs%rowtype;
begin
  select * into j from public.ckb_rebagging_jobs where id = p_job_id for update;
  if j.id is null then raise exception 'Pekerjaan tidak ditemukan'; end if;
  if not public.has_ckb_app() then raise exception 'Akses ditolak: bukan anggota CKB 3PL'; end if;
  if j.status <> 'AWAITING_VERIFICATION' then
    raise exception 'Pekerjaan tidak sedang menunggu verifikasi (status: %)', j.status;
  end if;
  if public.same_person(v_name, j.executor_name) or public.same_person(v_name, j.creator_name) then
    raise exception 'Verifikator harus orang lain (eksekutor %, pembuat %)',
      coalesce(j.executor_name, '?'), coalesce(j.creator_name, '?');
  end if;

  if p_approved then
    update public.ckb_rebagging_jobs
      set status = 'VERIFIED', verifier_name = v_name, updated_at = now()
      where id = p_job_id;
    perform public.ckb_rebagging_log_event(p_job_id, 'VERIFY', v_name, nullif(trim(p_note), ''), null);
  else
    if nullif(trim(p_note), '') is null then raise exception 'Alasan penolakan wajib diisi'; end if;
    update public.ckb_rebagging_jobs
      set status = 'REJECTED', verifier_name = v_name, updated_at = now()
      where id = p_job_id;
    perform public.ckb_rebagging_log_event(p_job_id, 'REJECT', v_name, trim(p_note), null);
  end if;
end $$;

revoke execute on function public.verify_rebagging(uuid, boolean, text, text) from public, anon;
grant execute on function public.verify_rebagging(uuid, boolean, text, text) to authenticated;

-- =====================================================================
-- 9. resolve_rebagging_variance — record the review decision for a
--    nonzero variance. Supervisor/admin; reason uses the movements
--    reason-code list (0018). Approval posting stays blocked until this
--    is done.
-- =====================================================================
create or replace function public.resolve_rebagging_variance(
  p_job_id uuid, p_reason_code text, p_note text, p_by_name text
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_name text := public.person_name(p_by_name, 'Nama penyelesai varians');
  j public.ckb_rebagging_jobs%rowtype;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
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

revoke execute on function public.resolve_rebagging_variance(uuid, text, text, text) from public, anon;
grant execute on function public.resolve_rebagging_variance(uuid, text, text, text) to authenticated;

-- =====================================================================
-- 10. toggle_rebagging_hold — put a pre-posting job ON_HOLD and back.
--     Stock holds stay active during ON_HOLD (stock stays protected).
-- =====================================================================
create or replace function public.toggle_rebagging_hold(p_job_id uuid, p_note text, p_by_name text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_name text := public.person_name(p_by_name, 'Nama supervisor');
  j public.ckb_rebagging_jobs%rowtype;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
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

revoke execute on function public.toggle_rebagging_hold(uuid, text, text) from public, anon;
grant execute on function public.toggle_rebagging_hold(uuid, text, text) to authenticated;

-- =====================================================================
-- 11. cancel_rebagging — supervisor cancels a not-yet-posted job.
--     Releases this job's REBAGGING holds; no inventory was ever touched.
-- =====================================================================
create or replace function public.cancel_rebagging(p_job_id uuid, p_note text, p_by_name text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_name text := public.person_name(p_by_name, 'Nama supervisor');
  j public.ckb_rebagging_jobs%rowtype;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
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

revoke execute on function public.cancel_rebagging(uuid, text, text) from public, anon;
grant execute on function public.cancel_rebagging(uuid, text, text) to authenticated;

-- =====================================================================
-- 12. approve_post_rebagging — VERIFIED → COMPLETED, ONE transaction.
--     Idempotent by status guard. Returns a posting summary as jsonb.
-- =====================================================================
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
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
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

revoke execute on function public.approve_post_rebagging(uuid, text, text) from public, anon;
grant execute on function public.approve_post_rebagging(uuid, text, text) to authenticated;

-- =====================================================================
-- 13. reverse_rebagging_posting — COMPLETED → REVERSED.
--     Compensating movements: reverse transfers + positive adjustments.
--     Output packages RETIRED; PACKAGE-sourced sources re-ACTIVE.
--     Lineage KEPT (history, not deleted).
-- =====================================================================
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
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
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

revoke execute on function public.reverse_rebagging_posting(uuid, text, text) from public, anon;
grant execute on function public.reverse_rebagging_posting(uuid, text, text) to authenticated;

-- =====================================================================
-- 14. add_rebagging_evidence — append evidence row (storage path validated)
-- =====================================================================
create or replace function public.add_rebagging_evidence(
  p_job_id uuid, p_kind text, p_storage_path text, p_mime text, p_size bigint, p_note text, p_by_name text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_name text := public.person_name(p_by_name, 'Nama pengunggah');
  v_id uuid;
  j public.ckb_rebagging_jobs%rowtype;
  v_expected_prefix text;
begin
  if not public.has_ckb_app() then raise exception 'Akses ditolak: bukan anggota CKB 3PL'; end if;

  select * into j from public.ckb_rebagging_jobs where id = p_job_id;
  if j.id is null then raise exception 'Pekerjaan tidak ditemukan'; end if;
  if j.status = 'CANCELLED' then raise exception 'Pekerjaan dibatalkan: tidak bisa menambah bukti'; end if;

  if p_kind not in ('BEFORE','AFTER','OTHER') then
    raise exception 'Jenis bukti tidak valid: harus BEFORE, AFTER, atau OTHER';
  end if;
  if p_mime not in ('image/jpeg','image/png','image/webp') then
    raise exception 'Format file tidak didukung: hanya JPEG, PNG, WebP';
  end if;
  if p_size <= 0 then raise exception 'Ukuran file harus lebih dari 0'; end if;

  v_expected_prefix := p_job_id::text || '/' || p_kind || '/';
  if not p_storage_path like v_expected_prefix || '%' then
    raise exception 'Path storage harus diawali %', v_expected_prefix;
  end if;

  insert into public.ckb_rebagging_evidence
    (job_id, kind, storage_path, mime, size_bytes, note, uploader, uploader_name)
  values
    (p_job_id, p_kind, p_storage_path, p_mime, p_size, p_note, auth.uid(), v_name)
  returning id into v_id;

  perform public.ckb_rebagging_log_event(p_job_id, 'EVIDENCE', v_name, p_note,
    jsonb_build_object('kind', p_kind, 'path', p_storage_path, 'mime', p_mime, 'size', p_size));
  return v_id;
end $$;

revoke execute on function public.add_rebagging_evidence(uuid, text, text, text, bigint, text, text) from public, anon;
grant execute on function public.add_rebagging_evidence(uuid, text, text, text, bigint, text, text) to authenticated;

-- =====================================================================
-- 15. VIEW ckb_rebagging_job_summary — list view for the CKB page
--     security_invoker = true so RLS on underlying tables applies
-- =====================================================================
create or replace view public.ckb_rebagging_job_summary with (security_invoker = true) as
select
  j.id,
  j.job_no,
  j.job_date,
  j.shift,
  j.warehouse,
  j.customer,
  j.customer_ref,
  j.operation_type,
  j.reason,
  j.priority,
  j.status,
  j.creator_name,
  j.executor_name,
  j.verifier_name,
  j.approver_name,
  j.created_at,
  it.sku as item_sku,
  it.description as item_description,
  (select count(*) from public.ckb_rebagging_sources s where s.job_id = j.id) as sources_count,
  (select count(*) from public.ckb_rebagging_outputs o where o.job_id = j.id) as outputs_count,
  (select count(*) from public.ckb_rebagging_evidence e where e.job_id = j.id and e.kind = 'BEFORE') as evidence_before_count,
  (select count(*) from public.ckb_rebagging_evidence e where e.job_id = j.id and e.kind = 'AFTER') as evidence_after_count,
  j.variance_qty,
  j.variance_reason,
  j.note
from public.ckb_rebagging_jobs j
left join public.items it on it.id = j.item_id;

grant select on public.ckb_rebagging_job_summary to authenticated;