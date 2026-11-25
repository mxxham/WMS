-- CKB housekeeping, part 1 (0157): areas (racks plus manual), PIC with history, bulk entry, holidays and leave.
-- Runs in a transaction and rolls back. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
\ir ckb_fixture.psql

-- ---------------------------------------------------------------------
-- 1  The racks CKB owns became areas; sync only adds
-- ---------------------------------------------------------------------
select pg_temp.check('every CKB rack (zone + rack number) is an area of kind RACK',
  (select count(*) > 0 from ckb_hk_areas where kind = 'RACK')
  and (select count(*) = (select count(*) from (select distinct zone, rack from bins where owner = 'CKB' and rack is not null) x)
         from ckb_hk_areas where kind = 'RACK'));
select pg_temp.check('rack areas have a code like CG05 and 3D coordinates',
  (select bool_and(code = zone || rack and pos_x is not null and pos_z is not null) from ckb_hk_areas where kind = 'RACK'));

-- a rack that becomes CKB's later
update bins set owner = 'CKB' where bin_code = (select bin_code from bins where zone = 'CA' and rack = '01' and owner = 'SHELL' order by bin_code limit 1);
select (select zone || rack from bins where owner = 'CKB' and zone = 'CA' and rack = '01' limit 1) as newcode \gset
set role authenticated;
select pg_temp.as_user(pg_temp.u('op'));
select pg_temp.check('an operator cannot sync racks', pg_temp.fails($q$select ckb_hk_sync_racks()$q$, '%admin CKB%'));
select pg_temp.as_user(pg_temp.u('adm'));
select ckb_hk_sync_racks() as r1 \gset
select pg_temp.check('sync adds the new rack as an area', (:'r1'::jsonb->>'added')::int >= 1 and exists (select 1 from ckb_hk_areas where code = :'newcode'));
select ckb_hk_save_area((select id from ckb_hk_areas where code = :'newcode'), null, 'Rak CA01 (Freeport)', :'c_fp', true, 'sudah diedit') as _ \gset
select ckb_hk_sync_racks() as r2 \gset
select pg_temp.check('a second sync adds nothing and leaves the edited name and customer alone',
  (:'r2'::jsonb->>'added')::int = 0
  and (select name = 'Rak CA01 (Freeport)' and customer_id = :'c_fp'::uuid from ckb_hk_areas where code = :'newcode'));

-- ---------------------------------------------------------------------
-- 2  Manual locations: admin only
-- ---------------------------------------------------------------------
select pg_temp.as_user(pg_temp.u('sup'));
select pg_temp.check('a supervisor cannot add an area', pg_temp.fails($q$select ckb_hk_save_area(null, 'DOCK1', 'Dock', null, true, null)$q$, '%admin CKB%'));
select pg_temp.as_user(pg_temp.u('adm'));
select ckb_hk_save_area(null, ' fp-dock ', 'Dock Freeport', :'c_fp', true, 'lantai') as dock \gset
select pg_temp.check('admin adds a manual location (code upper-cased, kind MANUAL)',
  (select code = 'FP-DOCK' and kind = 'MANUAL' and customer_id = :'c_fp'::uuid from ckb_hk_areas where id = :'dock'));
select pg_temp.check('a duplicate code is refused', pg_temp.fails($q$select ckb_hk_save_area(null, 'FP-DOCK', 'Lagi', null, true, null)$q$, '%sudah dipakai%'));
select pg_temp.check('a bad code is refused', pg_temp.fails($q$select ckb_hk_save_area(null, '!', 'Xx', null, true, null)$q$, '%Kode area%'));
select pg_temp.check('a name is required', pg_temp.fails($q$select ckb_hk_save_area(null, 'DOCK2', ' ', null, true, null)$q$, '%Nama area%'));

-- ---------------------------------------------------------------------
-- 3  The PIC, with history
-- ---------------------------------------------------------------------
select pg_temp.as_user(pg_temp.u('op'));
select pg_temp.check('an operator cannot assign a PIC', pg_temp.fails(format($q$select ckb_hk_assign(%L, %L)$q$, :'dock', pg_temp.u('op')), '%supervisor atau admin%'));
select pg_temp.as_user(pg_temp.u('sup'));
select pg_temp.check('the shared site account cannot be a PIC', pg_temp.fails(format($q$select ckb_hk_assign(%L, %L)$q$, :'dock', pg_temp.u('shared')), '%akun staf CKB%'));
select pg_temp.check('a customer representative cannot be a PIC', pg_temp.fails(format($q$select ckb_hk_assign(%L, %L)$q$, :'dock', pg_temp.u('repfp')), '%akun staf CKB%'));
select pg_temp.check('an account without the CKB app cannot be a PIC', pg_temp.fails(format($q$select ckb_hk_assign(%L, %L)$q$, :'dock', pg_temp.u('shell')), '%akun staf CKB%'));
select ckb_hk_assign(:'dock', pg_temp.u('op'), date '2026-11-02') as _ \gset
select pg_temp.check('assigning a staff member opens the PIC from that day',
  (select count(*) = 1 and bool_and(pic_user_id = pg_temp.u('op') and from_date = date '2026-11-02' and to_date is null) from ckb_hk_assignments where area_id = :'dock'));
select pg_temp.check('the same person again is refused', pg_temp.fails(format($q$select ckb_hk_assign(%L, %L)$q$, :'dock', pg_temp.u('op')), '%sudah menjadi PIC%'));
select pg_temp.check('a new PIC cannot start on or before the current one''s start',
  pg_temp.fails(format($q$select ckb_hk_assign(%L, %L, date '2026-11-02')$q$, :'dock', pg_temp.u('op2')), '%Tanggal berlaku%'));
select ckb_hk_assign(:'dock', pg_temp.u('op2'), date '2026-11-16') as _ \gset
select pg_temp.check('a change ends the old PIC the day before and keeps both rows',
  (select to_date = date '2026-11-15' from ckb_hk_assignments where area_id = :'dock' and pic_user_id = pg_temp.u('op'))
  and (select to_date is null and from_date = date '2026-11-16' from ckb_hk_assignments where area_id = :'dock' and pic_user_id = pg_temp.u('op2'))
  and (select count(*) = 2 from ckb_hk_assignments where area_id = :'dock'));
select pg_temp.check('at most one open PIC per area (unique index)',
  (select count(*) = 1 from ckb_hk_assignments where area_id = :'dock' and to_date is null));

-- ---------------------------------------------------------------------
-- 4  Who reads what
-- ---------------------------------------------------------------------
select pg_temp.check('a supervisor reads every area',
  (select count(*) = (select count(*) from ckb_hk_areas) from ckb_hk_areas));
select pg_temp.as_user(pg_temp.u('op'));
select pg_temp.check('a PIC reads only the areas and assignments they hold or held',
  (select count(*) = 1 and bool_and(code = 'FP-DOCK') from ckb_hk_areas)
  and (select count(*) = 1 and bool_and(pic_user_id = pg_temp.u('op')) from ckb_hk_assignments));
select pg_temp.as_user(pg_temp.u('repfp'));
select pg_temp.check('a customer representative reads no area, assignment, holiday or leave directly',
  (select count(*) = 0 from ckb_hk_areas) and (select count(*) = 0 from ckb_hk_assignments)
  and (select count(*) = 0 from ckb_hk_holidays) and (select count(*) = 0 from ckb_hk_absences));
select pg_temp.as_user(pg_temp.u('sup'));
create or replace function pg_temp.try_write() returns void language plpgsql as $$
begin
  begin insert into ckb_hk_areas (code, name, kind) values ('ZZ1', 'Zz', 'MANUAL'); exception when others then null; end;
  begin update ckb_hk_assignments set pic_name = 'x'; exception when others then null; end;
  begin delete from ckb_hk_holidays; exception when others then null; end;
  begin delete from ckb_hk_areas; exception when others then null; end;
end $$;
grant execute on function pg_temp.try_write() to authenticated;
select pg_temp.try_write();
select pg_temp.check('no app role can write the tables directly (nothing changed)',
  not exists (select 1 from ckb_hk_areas where code = 'ZZ1') and not exists (select 1 from ckb_hk_assignments where pic_name = 'x')
  and (select count(*) > 0 from ckb_hk_areas));

-- ---------------------------------------------------------------------
-- 5  Bulk entry
-- ---------------------------------------------------------------------
select code as rk1 from ckb_hk_areas where kind = 'RACK' order by code limit 1 \gset
select code as rk2 from ckb_hk_areas where kind = 'RACK' order by code limit 1 offset 1 \gset
select code as rk3 from ckb_hk_areas where kind = 'RACK' order by code limit 1 offset 2 \gset
select jsonb_build_array(
  jsonb_build_object('code', 'FP-DOCK', 'customer', 'Freeport', 'pic', 't_ckb_op'),
  jsonb_build_object('code', 'NEW-1', 'name', 'Pojok baru', 'customer', 'CGP', 'pic', 'T_CKB_OP2'),
  jsonb_build_object('code', 'NEW-1', 'customer', 'CGP'),
  jsonb_build_object('code', '', 'customer', 'CGP'),
  jsonb_build_object('code', :'rk1', 'customer', 'Nope'),
  jsonb_build_object('code', :'rk2', 'pic', 'ghost'),
  jsonb_build_object('code', :'rk3', 'pic', 't_gudang')) as rows \gset
select ckb_hk_import_preview(:'rows', false) as pv \gset
select pg_temp.check('the preview refuses what it cannot place, row by row, and says why',
  (select string_agg(x->>'status', ',' order by (x->>'line')::int) = 'OK,REFUSED,REFUSED,REFUSED,REFUSED,REFUSED,REFUSED' from jsonb_array_elements(:'pv'::jsonb) x)
  and (select x->>'message' like 'Area NEW-1 tidak ada%' from jsonb_array_elements(:'pv'::jsonb) x where (x->>'line')::int = 2)
  and (select x->>'message' like '%dua kali%' from jsonb_array_elements(:'pv'::jsonb) x where (x->>'line')::int = 3)
  and (select x->>'message' = 'Kode area kosong' from jsonb_array_elements(:'pv'::jsonb) x where (x->>'line')::int = 4)
  and (select x->>'message' like 'Customer "Nope"%' from jsonb_array_elements(:'pv'::jsonb) x where (x->>'line')::int = 5)
  and (select x->>'message' like 'Pengguna "ghost"%' from jsonb_array_elements(:'pv'::jsonb) x where (x->>'line')::int = 6)
  and (select x->>'message' like '%akun pribadi%' from jsonb_array_elements(:'pv'::jsonb) x where (x->>'line')::int = 7));
select pg_temp.check('apply is all or nothing: one refused row stops the file',
  pg_temp.fails(format($q$select ckb_hk_import_apply(%L, true)$q$, :'rows'), '%baris ditolak%')
  and not exists (select 1 from ckb_hk_areas where code = 'NEW-1'));
select '[{"code":"FP-DOCK","customer":"Freeport","pic":"t_ckb_op2"},{"code":"NEW-1","name":"Pojok baru","customer":"CGP","pic":"T_CKB_OP"}]' as rows2 \gset
select ckb_hk_import_apply(:'rows2', true, date '2026-11-23') as ap \gset
select pg_temp.check('a clean file creates the missing location, sets customers and PICs from the given day',
  (:'ap'::jsonb->>'created')::int = 1 and (:'ap'::jsonb->>'pics_set')::int = 1 and (:'ap'::jsonb->>'unchanged')::int = 1
  and (select customer_id = :'c_cgp'::uuid and name = 'Pojok baru' from ckb_hk_areas where code = 'NEW-1')
  and (select pic_user_id = pg_temp.u('op') and from_date = date '2026-11-23' and to_date is null
         from ckb_hk_assignments s join ckb_hk_areas a on a.id = s.area_id where a.code = 'NEW-1'));
select ckb_hk_import_apply(:'rows2', true, date '2026-11-24') as ap2 \gset
select pg_temp.check('the same file again changes nothing',
  (:'ap2'::jsonb->>'created')::int = 0 and (:'ap2'::jsonb->>'pics_set')::int = 0 and (:'ap2'::jsonb->>'unchanged')::int = 2);

-- ---------------------------------------------------------------------
-- 6  Holidays and leave
-- ---------------------------------------------------------------------
select pg_temp.as_user(pg_temp.u('op'));
select pg_temp.check('an operator cannot record a holiday or leave',
  pg_temp.fails($q$select ckb_hk_set_holiday(date '2026-11-25', 'cuti bersama')$q$, '%supervisor atau admin%')
  and pg_temp.fails(format($q$select ckb_hk_add_absence(%L, date '2026-11-25', date '2026-11-26', 'sakit')$q$, pg_temp.u('op')), '%supervisor atau admin%'));
select pg_temp.as_user(pg_temp.u('sup'));
select ckb_hk_set_holiday(date '2026-11-25', 'cuti bersama');
select pg_temp.check('working days are Monday to Friday minus holidays',
  ckb_hk_is_workday(date '2026-11-23') and ckb_hk_is_workday(date '2026-11-24')
  and not ckb_hk_is_workday(date '2026-11-25')   -- a recorded holiday
  and not ckb_hk_is_workday(date '2026-11-28') and not ckb_hk_is_workday(date '2026-11-29')   -- Saturday, Sunday
  and ckb_hk_is_workday(date '2026-11-30'));
select pg_temp.check('a holiday needs a reason', pg_temp.fails($q$select ckb_hk_set_holiday(date '2026-12-01', ' ')$q$, '%Alasan wajib%'));
select ckb_hk_set_holiday(date '2026-11-25', null, true);
select pg_temp.check('removing the holiday makes the day a working day again', ckb_hk_is_workday(date '2026-11-25'));
select ckb_hk_add_absence(pg_temp.u('op'), date '2026-11-25', date '2026-11-26', 'sakit') as ab \gset
select pg_temp.check('leave is recorded; a backwards range is refused',
  (select count(*) = 1 from ckb_hk_absences where id = :'ab'::uuid)
  and pg_temp.fails(format($q$select ckb_hk_add_absence(%L, date '2026-11-26', date '2026-11-25', 'x')$q$, pg_temp.u('op')), '%tidak valid%'));
select pg_temp.as_user(pg_temp.u('op'));
select pg_temp.check('a PIC reads only their own leave', (select count(*) = 1 from ckb_hk_absences));
select pg_temp.as_user(pg_temp.u('sup'));
select ckb_hk_remove_absence(:'ab'::uuid);
select pg_temp.check('leave can be removed', (select count(*) = 0 from ckb_hk_absences));

-- ---------------------------------------------------------------------
-- 7  Audit
-- ---------------------------------------------------------------------
reset role;
select pg_temp.check('every write left an audit event',
  (select count(distinct action) >= 8 from ckb_audit_events where action like 'HK\_%'));

rollback;
