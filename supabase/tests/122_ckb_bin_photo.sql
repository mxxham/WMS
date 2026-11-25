-- CKB photo per bin (0163): a count waits for its bin's photo, the line rules of 0133 stay, only a counter of the bin adds or sees the
-- photo, withdrawing a relied-on photo is for a lead, a bin photo can satisfy an accepted variance, and "TASK" customers are untouched.
-- Runs in a transaction and rolls back. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
\ir ckb_fixture.psql

create or replace function pg_temp.binphoto(c uuid, b uuid) returns uuid language sql as $$
  select ckb_register_evidence('STOCKTAKE_BIN', b, 'COUNT', c::text || '/STOCKTAKE_BIN/' || b::text || '/' || gen_random_uuid()::text || '.jpg', 'image/jpeg', 1000, null, null) $$;
create or replace function pg_temp.linephoto(c uuid, t uuid) returns uuid language sql as $$
  select ckb_register_evidence('COUNT_TASK', t, 'COUNT', c::text || '/COUNT_TASK/' || t::text || '/' || gen_random_uuid()::text || '.jpg', 'image/jpeg', 1000, null, null) $$;
grant execute on function pg_temp.binphoto(uuid, uuid), pg_temp.linephoto(uuid, uuid) to authenticated;

select id as c_emcl from ckb_customers where code = 'EMCL' \gset
\set rows_e '[{"line":2,"material_code":"M1","description":"Oli","plant":"ID1","storage_bin":"CML-A1","batch":"FC1PMCL01","uom":"DRM","quantity":10,"stock_type":"INV"},{"line":3,"material_code":"M2","description":"Valve","plant":"ID1","storage_bin":"CML-A1","batch":"FC-PMCL01","uom":"EA","quantity":4,"stock_type":"CAP"},{"line":4,"material_code":"M3","description":"Coolant","plant":"ID1","storage_bin":"CML-B1","batch":"FC1PMCL01","uom":"EA","quantity":7,"stock_type":"HOLD"}]'
\set rows_f '[{"line":2,"material_code":"F1","storage_bin":"FB-1","batch":"B1","uom":"BAG","quantity":3}]'

set role authenticated;
select pg_temp.as_user(pg_temp.u('sup'));
select ckb_import_sap_snapshot(:'c_emcl'::uuid, date '2026-11-25', '{"name":"e122.xlsx","sha256":"1212121212121212121212121212121212121212121212121212121212121212","size":10}', :'rows_e', '[]', null) as imp_e \gset
select ckb_import_sap_snapshot(:'c_fp'::uuid, date '2026-11-25', '{"name":"f122.xlsx","sha256":"1313131313131313131313131313131313131313131313131313131313131313","size":10}', :'rows_f', '[]', null) as imp_f \gset
select ckb_create_stocktake(:'c_emcl'::uuid, :'imp_e'::uuid, 'FULL', null, 'Warehouse 5', true, array[pg_temp.u('op'), pg_temp.u('op2')]::uuid[], null) as st \gset
select ckb_create_stocktake(:'c_fp'::uuid, :'imp_f'::uuid, 'FULL', null, 'Warehouse 5', true, array[pg_temp.u('op')]::uuid[], null) as st_f \gset
select ckb_assign_count_tasks(:'st'::uuid, array['CML-A1'], pg_temp.u('op'), 'Sari');
select ckb_assign_count_tasks(:'st'::uuid, array['CML-B1'], pg_temp.u('op2'), 'Sari');
select ckb_start_stocktake(:'st'::uuid);
select ckb_start_stocktake(:'st_f'::uuid);
select id as t_m1 from ckb_stocktake_tasks(:'st'::uuid) where material_code = 'M1' \gset
select id as t_m2 from ckb_stocktake_tasks(:'st'::uuid) where material_code = 'M2' \gset
select id as t_m3 from ckb_stocktake_tasks(:'st'::uuid) where material_code = 'M3' \gset
select id as t_f1 from ckb_stocktake_tasks(:'st_f'::uuid) \gset

-- ---------------------------------------------------------------------
-- 1  The bins a counter may photograph
-- ---------------------------------------------------------------------
select pg_temp.check('a lead sees both bins, with no photo yet',
  (select count(*) = 2 and bool_and(photos = 0 and bin_id is null) from ckb_stocktake_bins_for(:'st'::uuid)));
select pg_temp.as_user(pg_temp.u('op'));
select pg_temp.check('a counter sees only the bin assigned to them (2 lines in CML-A1)',
  (select count(*) = 1 and bool_and(storage_bin = 'CML-A1' and lines = 2) from ckb_stocktake_bins_for(:'st'::uuid)));
select pg_temp.check('a photo-per-task customer has no bin photos',
  pg_temp.fails(format($q$select ckb_stocktake_bin(%L, 'FB-1')$q$, :'st_f'), '%foto per baris%'));
select pg_temp.check('a counter cannot open a bin they may not count, and an empty bin is refused',
  pg_temp.fails(format($q$select ckb_stocktake_bin(%L, 'cml-b1')$q$, :'st'), '%tidak ada di baris yang boleh Anda hitung%')
  and pg_temp.fails(format($q$select ckb_stocktake_bin(%L, ' ')$q$, :'st'), '%tidak ada di baris%'));

-- ---------------------------------------------------------------------
-- 2  No count before the bin photo
-- ---------------------------------------------------------------------
select pg_temp.check('a count is refused until the bin has a photo',
  pg_temp.fails(format($q$select ckb_submit_count(%L, 10, null, null, null, null, null, gen_random_uuid())$q$, :'t_m1'), 'Foto bin wajib%'));
select ckb_stocktake_bin(:'st'::uuid, 'cml-a1') as bin_a1 \gset
select pg_temp.check('the bin is made on first use, case-insensitively, and asking again returns the same one',
  :'bin_a1' = (select ckb_stocktake_bin(:'st'::uuid, 'CML-A1')::text));
select pg_temp.as_user(pg_temp.u('op2'));
select pg_temp.check('a counter of another bin cannot add a photo to it, nor see its photos',
  pg_temp.fails(format('select pg_temp.binphoto(%L, %L)', :'c_emcl', :'bin_a1'), '%tidak ditugaskan menghitung bin ini%'));
select pg_temp.as_user(pg_temp.u('op'));
select pg_temp.binphoto(:'c_emcl'::uuid, :'bin_a1'::uuid) as ph_a1 \gset
select pg_temp.check('the counter of the bin adds the photo, and the bin now shows one',
  (select photos = 1 and bin_id = :'bin_a1'::uuid from ckb_stocktake_bins_for(:'st'::uuid)));

-- ---------------------------------------------------------------------
-- 3  With the bin photo, lines count without a photo each, except where the line needs one (0133)
-- ---------------------------------------------------------------------
select ckb_submit_count(:'t_m1'::uuid, 9, null, null, null, null, null, gen_random_uuid());
select pg_temp.check('a normal count passes without a line photo once the bin has one',
  (select latest_qty = 9 from ckb_stocktake_tasks(:'st'::uuid) where id = :'t_m1'::uuid));
select pg_temp.check('a count of 0 still needs a photo of the line',
  pg_temp.fails(format($q$select ckb_submit_count(%L, 0, null, null, null, null, null, gen_random_uuid())$q$, :'t_m2'), 'Foto wajib: hitungan 0%'));
select pg_temp.linephoto(:'c_emcl'::uuid, :'t_m2'::uuid);
select ckb_submit_count(:'t_m2'::uuid, 0, null, null, null, null, null, gen_random_uuid());
select pg_temp.check('...and passes with it', (select latest_qty = 0 from ckb_stocktake_tasks(:'st'::uuid) where id = :'t_m2'::uuid));
reset role;
update ckb_customers set count_photo_required = true where id = :'c_emcl'::uuid;
set role authenticated;
select pg_temp.as_user(pg_temp.u('op'));
select pg_temp.check('the "photo on every count" setting is ignored for a bin-photo customer: a normal count needs no line photo',
  (select ckb_photo_reason(:'t_m1'::uuid, 5)) is null and (select ckb_photo_reason(:'t_m1'::uuid, 0)) is not null);

-- ---------------------------------------------------------------------
-- 4  Accepting a variance, withdrawing, who sees what
-- ---------------------------------------------------------------------
select pg_temp.as_user(pg_temp.u('sup'));
select ckb_close_counting(:'st'::uuid);
select id as c_m1 from ckb_counts where task_id = :'t_m1'::uuid order by entry_no desc limit 1 \gset
select ckb_decide_task(:'t_m1'::uuid, 'ACCEPT', :'c_m1'::uuid, 'selisih 1 drum');
select pg_temp.check('a variance (9 of 10) is accepted on the bin photo alone, no line photo needed',
  (select status = 'ACCEPTED' and variance = -1 from ckb_stocktake_tasks(:'st'::uuid) where id = :'t_m1'::uuid));
select pg_temp.as_user(pg_temp.u('op'));
select pg_temp.check('the counter cannot withdraw a bin photo their counts relied on',
  pg_temp.fails(format($q$select ckb_withdraw_evidence(%L, 'foto salah')$q$, :'ph_a1'), '%dipakai hitungan yang sudah dikirim%'));
select pg_temp.as_user(pg_temp.u('op2'));
select pg_temp.check('an operator of another bin reads none of its photos',
  (select count(*) = 0 from ckb_evidence where entity_type = 'STOCKTAKE_BIN'));
select pg_temp.as_user(pg_temp.u('sup'));
select pg_temp.check('a lead reads it', (select count(*) = 1 from ckb_evidence where entity_type = 'STOCKTAKE_BIN' and entity_id = :'bin_a1'::uuid));
select ckb_withdraw_evidence(:'ph_a1'::uuid, 'foto buram, diganti');
select pg_temp.as_user(pg_temp.u('op'));
select pg_temp.check('a withdrawn bin photo means the bin needs a new one before the next count',
  (select ckb_bin_photo_missing(:'t_m1'::uuid)) is true and (select photos = 0 from ckb_stocktake_bins_for(:'st'::uuid)));

-- ---------------------------------------------------------------------
-- 5  Other customers and sessions are untouched
-- ---------------------------------------------------------------------
select pg_temp.check('a photo-per-task customer counts as before: no bin photo asked for',
  (select ckb_bin_photo_missing(:'t_f1'::uuid)) is false);
select pg_temp.check('and an EMCL line whose bin has no photo is missing one',
  (select ckb_bin_photo_missing(:'t_m3'::uuid)) is true);
reset role;
update ckb_stocktakes set photo_rules = false where id = :'st'::uuid;
select pg_temp.check('photo_rules off switches the bin rule off too', (select ckb_bin_photo_missing(:'t_m3'::uuid)) is false);

rollback;
