-- =====================================================================
-- 0087  Admin delete never-posted rebagging job
--
-- Decision (21 Oct 2026): test junk like RB000001 accumulated in DRAFT/OPEN.
-- Cancel (CANCELLED status) is not removal — it keeps the audit row.
-- This RPC provides a hard delete ONLY for jobs that never touched stock
-- (posted_at IS NULL AND status NOT IN ('COMPLETED','REVERSED')).
-- Movements are NEVER touched by this RPC.
-- A tombstone row is kept in ckb_rebagging_deleted_jobs for audit.
-- Storage objects are cleaned up best-effort; storage errors never fail
-- the delete.
-- =====================================================================

-- Tombstone table for deleted jobs audit trail
create table public.ckb_rebagging_deleted_jobs (
  id uuid primary key default gen_random_uuid(),
  job_no text not null,
  warehouse text not null,
  status text not null check (status in (
    'DRAFT','OPEN','IN_PROGRESS','AWAITING_VERIFICATION','VERIFIED','REJECTED',
    'ON_HOLD','COMPLETED','CANCELLED','REVERSED')),
  creator_name text not null,
  reason text not null,
  deleted_at timestamptz not null default now(),
  deleted_by text not null,
  delete_reason text
);

alter table public.ckb_rebagging_deleted_jobs enable row level security;

-- Policies: admin+supervisor can SELECT (tombstone audit), only admin can INSERT
create policy "ckb: admin+supervisor read deleted jobs" on public.ckb_rebagging_deleted_jobs
  for select to authenticated
  using (
    public.has_ckb_app()
    and public.has_role(array['admin','supervisor']::public.user_role[])
    and (select public.is_active())
  );

create policy "ckb: admin insert deleted jobs" on public.ckb_rebagging_deleted_jobs
  for insert to authenticated
  with check (
    public.has_ckb_app()
    and public.has_role(array['admin']::public.user_role[])
    and (select public.is_active())
  );

-- No UPDATE/DELETE policies — tombstone is append-only audit

-- Grant per convention
grant select on public.ckb_rebagging_deleted_jobs to authenticated;
grant all on public.ckb_rebagging_deleted_jobs to service_role;

-- =====================================================================
-- RPC: delete_rebagging_job
-- Admin-only, only never-posted jobs, releases REBAGGING holds with
-- SAME predicate as cancel_rebagging (ref_id + source + status), then
-- tombstones and deletes the job (cascades to sources/outputs/evidence/events).
-- =====================================================================
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
  if not public.has_role(array['admin']::public.user_role[]) then
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

revoke execute on function public.delete_rebagging_job(uuid, text, text) from public, anon;
grant execute on function public.delete_rebagging_job(uuid, text, text) to authenticated;