-- CKB 3PL stock take (0101): fixed baseline, blind counting, zero vs uncounted, append-only counts,
-- recounts, classification without netting, review decisions, adjustment approval and segregation,
-- representative visibility, and no write to any Shell table.
-- Runs in a transaction and rolls back. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
\ir ckb_fixture.psql

select count(*) as shell_mov_before from movements \gset
select count(*) as shell_inv_before, coalesce(sum(quantity), 0) as shell_qty_before from inventory \gset

-- Baseline: M-400 appears twice with one identity (ambiguous); M-300 has baseline 0.
\set rows '[{"line":2,"material_code":"M-100","storage_bin":"CG01A01","batch":"B1","uom":"BAG","quantity":40},{"line":3,"material_code":"M-100","storage_bin":"CG01A02","batch":"B1","uom":"BAG","quantity":10},{"line":4,"material_code":"M-200","storage_bin":"CG01A03","batch":"","uom":"DR","quantity":5},{"line":5,"material_code":"M-300","storage_bin":"CG02A01","batch":"","uom":"KG","quantity":0},{"line":6,"material_code":"M-400","storage_bin":"CG02A02","batch":"L4","uom":"BAG","quantity":3},{"line":7,"material_code":"M-400","storage_bin":"CG02A02","batch":"L4","uom":"BAG","quantity":4},{"line":8,"material_code":"M-500","storage_bin":"CG02A03","batch":"","uom":"BAG","quantity":8},{"line":9,"material_code":"M-600","storage_bin":"CG03A02","batch":"BX","uom":"BAG","quantity":2}]'

set role authenticated;
select pg_temp.as_user(pg_temp.u('sup'));
select ckb_import_sap_snapshot(:'c_fp', date '2026-10-24', '{"name":"fp.xlsx","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","size":10}', :'rows', '[]', null) as imp \gset
select ckb_import_sap_snapshot(:'c_cgp', date '2026-10-24', '{"name":"cgp.xlsx","sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","size":10}', '[{"line":2,"material_code":"X","uom":"KG","quantity":1}]', '[]', null) as imp_cgp \gset

-- ---------------------------------------------------------------- creating a session
select pg_temp.as_user(pg_temp.u('op'));
select pg_temp.check('an operator cannot create a stock take',
  pg_temp.fails(format($q$select ckb_create_stocktake(%L, %L, 'FULL', null, 'Warehouse 5', true, null, null)$q$, :'c_fp', :'imp'), 'Hanya supervisor%'));
select pg_temp.as_user(pg_temp.u('sup'));
select pg_temp.check('a baseline from another customer is refused',
  pg_temp.fails(format($q$select ckb_create_stocktake(%L, %L, 'FULL', null, 'Warehouse 5', true, null, null)$q$, :'c_fp', :'imp_cgp'), '%customer yang sama%'));
select pg_temp.check('a bin scope without bins is refused',
  pg_temp.fails(format($q$select ckb_create_stocktake(%L, %L, 'BINS', array[]::text[], 'Warehouse 5', true, null, null)$q$, :'c_fp', :'imp'), 'Pilih minimal satu bin%'));
select pg_temp.check('a representative cannot be a counter',
  pg_temp.fails(format($q$select ckb_create_stocktake(%L, %L, 'FULL', null, 'Warehouse 5', true, array[%L]::uuid[], null)$q$, :'c_fp', :'imp', pg_temp.u('repfp')), 'Penghitung harus staf%'));
select ckb_create_stocktake(:'c_fp', :'imp', 'BINS', array['cg01a01', 'CG02A02'], 'Warehouse 5', true, null, null) as st_bins \gset
select pg_temp.check('a bin scope takes only those bins (case-insensitive)',
  (select count(*) from ckb_stocktake_tasks(:'st_bins')) = 2);
select ckb_create_stocktake(:'c_fp', :'imp', 'FULL', null, 'Warehouse 5', true, array[pg_temp.u('op')]::uuid[], 'opname Oktober') as st \gset
select pg_temp.check('one task per stock identity: 8 rows, 7 identities',
  (select count(*) from ckb_stocktake_tasks(:'st')) = 7);
select pg_temp.check('the duplicate identity is one task, flagged, with both rows counted in its baseline',
  (select identity_issue = 'DUPLICATE_ROWS' and baseline_rows = 2 and baseline_qty = 7 from ckb_stocktake_tasks(:'st') where material_code = 'M-400'));

select id as t1 from ckb_stocktake_tasks(:'st') where material_code = 'M-100' and storage_bin = 'CG01A01' \gset
select id as t2 from ckb_stocktake_tasks(:'st') where material_code = 'M-100' and storage_bin = 'CG01A02' \gset
select id as t3 from ckb_stocktake_tasks(:'st') where material_code = 'M-200' \gset
select id as t4 from ckb_stocktake_tasks(:'st') where material_code = 'M-300' \gset
select id as t5 from ckb_stocktake_tasks(:'st') where material_code = 'M-400' \gset
select id as t6 from ckb_stocktake_tasks(:'st') where material_code = 'M-500' \gset
select id as t7 from ckb_stocktake_tasks(:'st') where material_code = 'M-600' \gset

-- The baseline is fixed at creation.
select ckb_import_sap_snapshot(:'c_fp', date '2026-10-25', '{"name":"fp2.xlsx","sha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","size":10}', '[{"line":2,"material_code":"M-100","storage_bin":"CG01A01","batch":"B1","uom":"BAG","quantity":999}]', '[]', null) as imp2 \gset
select ckb_activate_snapshot(:'imp2');
select pg_temp.check('activating a newer snapshot leaves the session baseline untouched',
  (select baseline_import_id from ckb_stocktakes where id = :'st') = :'imp'::uuid
  and (select baseline_qty from ckb_stocktake_tasks(:'st') where id = :'t1') = 40);

-- ---------------------------------------------------------------- blind counting
select pg_temp.as_user(pg_temp.u('op'));
select pg_temp.check('blind session: the operator sees no baseline and no variance',
  (select bool_and(baseline_qty is null and variance is null) from ckb_stocktake_tasks(:'st')));
select pg_temp.check('the operator reads no count task directly over the API (RLS, no policy)',
  (select count(*) from ckb_count_tasks) = 0);
select pg_temp.as_user(pg_temp.u('sup'));
select pg_temp.check('the supervisor sees the baseline', (select baseline_qty from ckb_stocktake_tasks(:'st') where id = :'t1') = 40);

-- ---------------------------------------------------------------- counting
select pg_temp.as_user(pg_temp.u('op'));
select pg_temp.check('nothing can be counted before the session starts',
  pg_temp.fails(format($q$select ckb_submit_count(%L, 40, null, null, null, null, null, gen_random_uuid())$q$, :'t1'), '%tidak sedang dibuka%'));
select pg_temp.check('an operator cannot start a session', pg_temp.fails(format('select ckb_start_stocktake(%L)', :'st'), 'Hanya supervisor%'));
select pg_temp.as_user(pg_temp.u('sup'));
select ckb_start_stocktake(:'st');
select pg_temp.as_user(pg_temp.u('op2'));
select pg_temp.check('an operator not assigned to the session cannot count',
  pg_temp.fails(format($q$select ckb_submit_count(%L, 40, null, null, null, null, null, gen_random_uuid())$q$, :'t1'), '%tidak ditugaskan%'));
select pg_temp.as_user(pg_temp.u('repfp'));
select pg_temp.check('a representative cannot count',
  pg_temp.fails(format($q$select ckb_submit_count(%L, 40, null, null, null, null, null, gen_random_uuid())$q$, :'t1'), 'Hanya staf CKB%'));

select pg_temp.as_user(pg_temp.u('op'));
select pg_temp.check('an empty quantity is refused (empty is not zero)',
  pg_temp.fails(format($q$select ckb_submit_count(%L, null, null, null, null, null, null, gen_random_uuid())$q$, :'t1'), 'Qty wajib diisi%'));
select pg_temp.check('a negative quantity is refused',
  pg_temp.fails(format($q$select ckb_submit_count(%L, -1, null, null, null, null, null, gen_random_uuid())$q$, :'t1'), '%negatif%'));
select ckb_submit_count(:'t1', 40, true, null, null, null, null, 'c0000000-0000-0000-0000-000000000001');
select ckb_submit_count(:'t2', 4, true, null, null, null, null, gen_random_uuid());
select ckb_submit_count(:'t3', 7, null, null, null, null, null, gen_random_uuid()) as c3_first \gset
select ckb_submit_count(:'t4', 0, null, null, null, null, 'kosong', gen_random_uuid());
select ckb_submit_count(:'t5', 7, null, null, null, null, null, gen_random_uuid());
select pg_temp.check('a retried submission (same key) returns the first count and adds nothing',
  ckb_submit_count(:'t1', 41, null, null, null, null, null, 'c0000000-0000-0000-0000-000000000001')
    = (select id from ckb_counts where client_key = 'c0000000-0000-0000-0000-000000000001')
  and (select count(*) from ckb_counts where task_id = :'t1') = 1);
select pg_temp.check('a key reused for another task is refused',
  pg_temp.fails(format($q$select ckb_submit_count(%L, 1, null, null, null, null, null, 'c0000000-0000-0000-0000-000000000001')$q$, :'t2'), '%tugas lain%'));
select pg_temp.check('a batch mismatch needs a note of what was seen',
  pg_temp.fails(format($q$select ckb_submit_count(%L, 2, false, null, null, null, null, gen_random_uuid())$q$, :'t7'), 'Batch/expiry tidak cocok%'));
select ckb_submit_count(:'t7', 2, false, null, 'BY', null, 'label menunjukkan batch BY', gen_random_uuid());
-- A revision while counting is a new row, the first count stays.
select ckb_submit_count(:'t3', 5, null, null, null, null, 'hitung lagi', gen_random_uuid());
select pg_temp.check('a revision adds a count; the first count is kept',
  (select count(*) from ckb_counts where task_id = :'t3') = 2 and exists (select 1 from ckb_counts where id = :'c3_first' and qty = 7));

-- Stock found on the floor but not on the list.
select pg_temp.check('found stock that is on the list must be counted there',
  pg_temp.fails(format($q$select ckb_add_found_item(%L, 'm-100', '', 'cg01a01', 'B1', null, 'bag', 3, null, gen_random_uuid())$q$, :'st'), '%ada di daftar hitung%'));
select pg_temp.as_user(pg_temp.u('sup'));
select ckb_add_found_item(:'st', 'M-100', 'Copper bag', 'CG03A01', 'B1', null, 'BAG', 6, 'di lantai', gen_random_uuid()) as tf \gset

select pg_temp.as_user(pg_temp.u('sup'));
select pg_temp.check('zero count and no count are different: M-300 MATCH (0 = 0), M-500 UNCOUNTED',
  (select classification from ckb_stocktake_tasks(:'st') where id = :'t4') = 'MATCH'
  and (select classification from ckb_stocktake_tasks(:'st') where id = :'t6') = 'UNCOUNTED'
  and (select latest_qty from ckb_stocktake_tasks(:'st') where id = :'t4') = 0
  and (select latest_qty is null from ckb_stocktake_tasks(:'st') where id = :'t6'));
select pg_temp.check('classification: match, shortage, overage, ambiguous, batch mismatch, unexpected',
  (select string_agg(classification, ',' order by seq) from ckb_stocktake_tasks(:'st'))
  = 'MATCH,SHORTAGE,MATCH,MATCH,AMBIGUOUS,UNCOUNTED,BATCH_MISMATCH,UNEXPECTED');
select pg_temp.check('variance = count - baseline (M-100 at CG01A02: 4 - 10 = -6)',
  (select variance from ckb_stocktake_tasks(:'st') where id = :'t2') = -6);
select pg_temp.check('a shortage next to the same material found in another bin is flagged, not netted',
  (select wrong_bin_hint and variance = -6 from ckb_stocktake_tasks(:'st') where id = :'t2')
  and (select variance from ckb_stocktake_tasks(:'st') where id = :'tf') = 6);

-- ---------------------------------------------------------------- review
select pg_temp.check('no decision while counting', pg_temp.fails(format($q$select ckb_decide_task(%L, 'ACCEPT', null, null)$q$, :'t1'), '%tahap review%'));
select ckb_close_counting(:'st');
select pg_temp.as_user(pg_temp.u('op'));
select pg_temp.check('in review, only tasks sent back for recount can be counted',
  pg_temp.fails(format($q$select ckb_submit_count(%L, 1, null, null, null, null, null, gen_random_uuid())$q$, :'t1'), '%tidak sedang dibuka%'));
select pg_temp.check('an operator cannot decide', pg_temp.fails(format($q$select ckb_decide_task(%L, 'ACCEPT', null, null)$q$, :'t1'), 'Hanya supervisor%'));

select pg_temp.as_user(pg_temp.u('sup'));
select ckb_decide_task(:'t1', 'ACCEPT', null, null);
select pg_temp.check('accepting a match creates no adjustment', not exists (select 1 from ckb_adjustments where task_id = :'t1'));
select pg_temp.check('a variance cannot be accepted without a reason',
  pg_temp.fails(format($q$select ckb_decide_task(%L, 'ACCEPT', null, null)$q$, :'t2'), 'Selisih%alasan%'));
select ckb_decide_task(:'t2', 'ACCEPT', null, 'rak dicek, kurang 6');
select pg_temp.check('accepting a shortage proposes one adjustment of -6 (no stock moved)',
  (select status = 'PROPOSED' and delta = -6 and baseline_qty = 10 and accepted_qty = 4 from ckb_adjustments where task_id = :'t2'));
select pg_temp.check('a decided task cannot be decided again', pg_temp.fails(format($q$select ckb_decide_task(%L, 'ACCEPT', null, 'lagi')$q$, :'t2'), '%sudah diputuskan%'));
select pg_temp.check('an ambiguous identity cannot be accepted',
  pg_temp.fails(format($q$select ckb_decide_task(%L, 'ACCEPT', null, 'ok')$q$, :'t5'), '%identitas stok belum pasti%'));
select pg_temp.check('a batch mismatch cannot be accepted',
  pg_temp.fails(format($q$select ckb_decide_task(%L, 'ACCEPT', null, 'ok')$q$, :'t7'), '%identitas stok belum pasti%'));
select pg_temp.check('an uncounted task cannot be accepted', pg_temp.fails(format($q$select ckb_decide_task(%L, 'ACCEPT', null, 'x')$q$, :'t6'), '%belum punya hitungan%'));
select pg_temp.check('excluding needs a reason', pg_temp.fails(format($q$select ckb_decide_task(%L, 'EXCLUDE', null, '')$q$, :'t6'), '%wajib diisi%'));
select ckb_decide_task(:'t5', 'EXCLUDE', null, 'dua baris SAP satu identitas, dicek ke SAP');
select ckb_decide_task(:'t6', 'EXCLUDE', null, 'rak terhalang, dihitung bulan depan');
select ckb_decide_task(:'t7', 'EXCLUDE', null, 'batch berbeda, investigasi ke customer');
select pg_temp.check('excluded tasks propose nothing; an excluded uncounted task stays UNCOUNTED',
  not exists (select 1 from ckb_adjustments where task_id in (:'t5', :'t6', :'t7'))
  and (select classification from ckb_stocktake_tasks(:'st') where id = :'t6') = 'UNCOUNTED');

-- Recount: the old counts stay, a chosen count is accepted.
select pg_temp.check('a recount needs a reason', pg_temp.fails(format($q$select ckb_decide_task(%L, 'RECOUNT', null, null)$q$, :'t3'), '%wajib diisi%'));
select ckb_decide_task(:'t3', 'RECOUNT', null, 'dua hitungan berbeda');
select pg_temp.check('a recount opens round 2', (select status = 'RECOUNT_REQUESTED' and round = 2 from ckb_stocktake_tasks(:'st') where id = :'t3'));
select pg_temp.check('a task waiting for its recount cannot be accepted',
  pg_temp.fails(format($q$select ckb_decide_task(%L, 'ACCEPT', null, 'x')$q$, :'t3'), '%menunggu hitung ulang%'));
select pg_temp.as_user(pg_temp.u('op'));
select ckb_submit_count(:'t3', 7, null, null, null, null, 'hitung ulang, 7', gen_random_uuid());
select pg_temp.as_user(pg_temp.u('sup'));
select pg_temp.check('recount history: three counts over two rounds, none erased',
  (select count(*) = 3 and count(distinct round) = 2 from ckb_counts where task_id = :'t3'));
select ckb_decide_task(:'t3', 'ACCEPT', :'c3_first', 'hitungan pertama dikonfirmasi oleh hitung ulang');
select pg_temp.check('the reviewer may accept the first count; +2 proposed',
  (select accepted_count_id = :'c3_first'::uuid and delta = 2 from ckb_adjustments where task_id = :'t3'));
select ckb_decide_task(:'t4', 'ACCEPT', null, null);
select pg_temp.check('the session cannot close while a task is undecided',
  pg_temp.fails(format($q$select ckb_close_stocktake(%L, null)$q$, :'st'), 'Masih ada 1 tugas%'));
select ckb_decide_task(:'tf', 'ACCEPT', null, 'barang temuan di lantai, milik customer');
select pg_temp.check('shortage and found stock stay two separate adjustments (-6 and +6), never netted',
  (select count(*) from ckb_adjustments where stocktake_id = :'st' and material_code = 'M-100') = 2);
select pg_temp.check('a session with adjustments cannot be cancelled',
  pg_temp.fails(format($q$select ckb_cancel_stocktake(%L, 'salah')$q$, :'st'), '%sudah punya penyesuaian%'));
select ckb_close_stocktake(:'st', 'selesai');

-- ---------------------------------------------------------------- approval
select id as adj2 from ckb_adjustments where task_id = :'t2' \gset
select id as adj3 from ckb_adjustments where task_id = :'t3' \gset
select id as adjf from ckb_adjustments where task_id = :'tf' \gset
select pg_temp.as_user(pg_temp.u('op'));
select pg_temp.check('an operator cannot approve', pg_temp.fails(format($q$select ckb_decide_adjustments(array[%L]::uuid[], true, null)$q$, :'adj2'), 'Hanya supervisor%'));
select pg_temp.as_user(pg_temp.u('sup'));
select pg_temp.check('a batch with one invalid item fails as a whole (sup counted the found stock)',
  pg_temp.fails(format($q$select ckb_decide_adjustments(array[%L, %L]::uuid[], true, null)$q$, :'adj2', :'adjf'), '%penghitung tidak boleh%'));
select pg_temp.check('... and leaves every adjustment of that batch untouched',
  (select bool_and(status = 'PROPOSED' and decided_at is null) from ckb_adjustments where id in (:'adj2', :'adjf')));
select pg_temp.check('approving needs no reason, rejecting does',
  pg_temp.fails(format($q$select ckb_decide_adjustments(array[%L]::uuid[], false, null)$q$, :'adj3'), 'Alasan penolakan%'));
select ckb_decide_adjustments(array[:'adj2']::uuid[], true, null);
select ckb_decide_adjustments(array[:'adj3']::uuid[], false, 'hitungan pertama diragukan');
select pg_temp.check('an approved adjustment cannot be approved twice',
  pg_temp.fails(format($q$select ckb_decide_adjustments(array[%L]::uuid[], true, null)$q$, :'adj2'), '%sudah diputuskan%'));
select pg_temp.as_user(pg_temp.u('sup2'));
select ckb_decide_adjustments(array[:'adjf']::uuid[], true, null);
select pg_temp.check('another supervisor approves the found stock',
  (select status = 'APPROVED' and decided_by_name = 'Sinta Supervisor' from ckb_adjustments where id = :'adjf'));
select pg_temp.check('every decision is in the audit log',
  (select count(*) from ckb_audit_events where action in ('ADJUSTMENT_APPROVE', 'ADJUSTMENT_REJECT')) = 3);

-- ---------------------------------------------------------------- representatives
select pg_temp.as_user(pg_temp.u('repfp'));
select pg_temp.check('the representative sees the closed session of their customer with its results',
  (select count(*) from ckb_stocktakes where id = :'st') = 1
  and (select baseline_qty from ckb_stocktake_tasks(:'st') where id = :'t2') = 10);
select pg_temp.check('... but not a session still open', (select count(*) from ckb_stocktakes where id = :'st_bins') = 0
  and pg_temp.fails(format('select * from ckb_stocktake_tasks(%L)', :'st_bins'), 'Akses ditolak%'));
select pg_temp.check('... and only decided adjustments (2 approved + 1 rejected)', (select count(*) from ckb_adjustments) = 3);
select pg_temp.check('the representative reads no counts or counter names', (select count(*) from ckb_counts) = 0);
select pg_temp.check('the discrepancy report gives the representative their closed session only',
  (select count(distinct stocktake_id) from ckb_report_discrepancies(null, null, null, null, null)) = 1);
select pg_temp.as_user(pg_temp.u('repcgp'));
select pg_temp.check('another customer''s representative sees none of it',
  (select count(*) from ckb_stocktakes) = 0 and (select count(*) from ckb_adjustments) = 0
  and pg_temp.fails(format('select * from ckb_stocktake_tasks(%L)', :'st'), 'Akses ditolak%')
  and (select count(*) from ckb_report_discrepancies(null, null, null, null, null)) = 0);

-- ---------------------------------------------------------------- integrity
reset role;
select pg_temp.check('counts cannot be edited', pg_temp.fails(format('update ckb_counts set qty = 1 where task_id = %L', :'t2'), '%tidak bisa diubah%'));
select pg_temp.check('counts cannot be deleted', pg_temp.fails(format('delete from ckb_counts where task_id = %L', :'t2'), '%tidak bisa diubah%'));
select pg_temp.check('an adjustment''s quantity cannot be changed', pg_temp.fails(format('update ckb_adjustments set delta = -1 where id = %L', :'adj2'), '%tidak bisa diubah%'));
select pg_temp.check('an approved adjustment cannot go back to proposed',
  pg_temp.fails(format('update ckb_adjustments set status = ''PROPOSED'' where id = %L', :'adj2'), '%tidak diizinkan%'));
select pg_temp.check('an adjustment cannot be deleted', pg_temp.fails(format('delete from ckb_adjustments where id = %L', :'adj2'), '%tidak bisa dihapus%'));
select pg_temp.check('the whole stock take touched no Shell stock: movements and inventory unchanged',
  (select count(*) from movements) = :shell_mov_before
  and (select count(*) from inventory) = :shell_inv_before
  and (select coalesce(sum(quantity), 0) from inventory) = :shell_qty_before);

-- The dashboard counts real rows.
set role authenticated;
select pg_temp.as_user(pg_temp.u('sup'));
select ckb_start_stocktake(:'st_bins');
select pg_temp.check('dashboard: one session counting, one adjustment awaiting export per approved, none proposed',
  (ckb_dashboard(:'c_fp')->>'stocktakes_counting')::int = 1
  and (ckb_dashboard(:'c_fp')->>'tasks_awaiting_count')::int = 2
  and (ckb_dashboard(:'c_fp')->>'adjustments_awaiting_export')::int = 2
  and (ckb_dashboard(:'c_fp')->>'adjustments_proposed')::int = 0);
select pg_temp.as_user(pg_temp.u('repfp'));
select pg_temp.check('the staff dashboard is not for representatives', pg_temp.fails('select ckb_dashboard(null)', 'Akses ditolak%'));

rollback;
