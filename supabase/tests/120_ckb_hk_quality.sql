-- CKB housekeeping phase 2 (0160): checklist, weekly score, findings (raise, fix, verify, send back, cancel), what customers and
-- PICs can read, audit, and the guards. Runs in a transaction and rolls back. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
\ir ckb_fixture.psql

create or replace function pg_temp.ph(p_checkin uuid, p_kind text, p_n int) returns uuid language plpgsql as $$
declare v_c uuid;
begin
  select customer_id into v_c from ckb_hk_checkins where id = p_checkin;
  return ckb_hk_register_photo(p_checkin, p_kind, v_c::text || '/HOUSEKEEPING/' || p_checkin::text || '/' || gen_random_uuid()::text || '.jpg',
    'image/jpeg', 40000, encode(sha256(convert_to('q-' || p_n::text || '-' || p_checkin::text || p_kind, 'utf8')), 'hex'));
end $$;
grant execute on function pg_temp.ph(uuid, text, int) to authenticated;

select ckb_hk_today() as today \gset
select max(g::date) as d1 from generate_series(:'today'::date - 6, :'today'::date - 1, interval '1 day') g where ckb_hk_is_workday(g::date) \gset
select date_trunc('week', :'d1'::date)::date as lastmon \gset
select date_trunc('week', :'today'::date)::date as thismon \gset

set role authenticated;
select pg_temp.as_user(pg_temp.u('adm'));
select ckb_hk_save_area(null, 'HKQ-A1', 'Rak uji Q1', :'c_fp', true, null) as a1 \gset
select ckb_hk_save_area(null, 'HKQ-A2', 'Rak uji Q2', :'c_fp', true, null) as a2 \gset
select ckb_hk_save_area(null, 'HKQ-C1', 'Rak uji CGP', :'c_cgp', true, null) as ac \gset
select ckb_hk_assign(:'a1', pg_temp.u('op'), :'lastmon'::date - 30) as _ \gset
select ckb_hk_assign(:'a2', pg_temp.u('op2'), :'lastmon'::date - 30) as _ \gset
select ckb_hk_assign(:'ac', pg_temp.u('op2'), :'lastmon'::date - 30) as _ \gset

-- a done check-in with photos on d1 for A1 (by the PIC) and for A2; a started one for CGP
select pg_temp.as_user(pg_temp.u('op'));
select (ckb_hk_start(:'a1', :'d1'::date)->>'id')::uuid as k1 \gset
select pg_temp.ph(:'k1', 'BEFORE', 1) as pb1 \gset
select pg_temp.ph(:'k1', 'AFTER', 2) as pa1 \gset
select ckb_hk_submit(:'k1'::uuid);
select pg_temp.as_user(pg_temp.u('op2'));
select (ckb_hk_start(:'a2', :'d1'::date)->>'id')::uuid as k2 \gset
select pg_temp.ph(:'k2', 'BEFORE', 3) as pb2 \gset
select pg_temp.ph(:'k2', 'AFTER', 4) as _ \gset
select ckb_hk_submit(:'k2'::uuid);
select (ckb_hk_start(:'ac', :'d1'::date)->>'id')::uuid as kc \gset
select pg_temp.ph(:'kc', 'BEFORE', 5) as pbc \gset

-- ---------------------------------------------------------------------
-- 1  The checklist
-- ---------------------------------------------------------------------
select pg_temp.as_user(pg_temp.u('sup'));
select pg_temp.check('a supervisor reads the six seeded items', (select count(*) = 6 from ckb_hk_checklist_items where active));
select pg_temp.check('only an admin edits the checklist', pg_temp.fails($q$select ckb_hk_checklist_save(null, 'Item baru', true)$q$, '%Hanya admin%'));
select pg_temp.as_user(pg_temp.u('op'));
select pg_temp.check('a PIC cannot write to the checklist or score a rack',
  pg_temp.fails($q$select ckb_hk_checklist_save(null, 'Item baru', true)$q$, '%Hanya admin%')
  and pg_temp.fails(format($q$select ckb_hk_score_week(%L, %L, '[]'::jsonb)$q$, :'a1', :'lastmon'), '%Hanya supervisor atau admin%'));
select pg_temp.as_user(pg_temp.u('adm'));
select pg_temp.check('an item needs a real name', pg_temp.fails($q$select ckb_hk_checklist_save(null, 'ab', true)$q$, '%minimal 3 huruf%'));
select ckb_hk_checklist_save(null, 'Alat kebersihan disimpan rapi', true) as extra \gset
select pg_temp.check('the admin adds an item, sorted last', (select count(*) = 7 from ckb_hk_checklist_items where active)
  and (select label = 'Alat kebersihan disimpan rapi' from ckb_hk_checklist_items order by sort desc limit 1));
select ckb_hk_checklist_save(:'extra'::uuid, 'Alat kebersihan disimpan rapi', false);
select pg_temp.check('retiring an item keeps the row', (select count(*) = 7 from ckb_hk_checklist_items) and (select count(*) = 6 from ckb_hk_checklist_items where active));
select pg_temp.check('the last active item cannot be retired together with the others (at least one stays)',
  pg_temp.fails($q$do $d$ declare r record; begin for r in select id, label from ckb_hk_checklist_items where active loop perform ckb_hk_checklist_save(r.id, r.label, false); end loop; end $d$$q$, '%Minimal satu item%'));

-- ---------------------------------------------------------------------
-- 2  Scoring a rack for a week
-- ---------------------------------------------------------------------
select pg_temp.as_user(pg_temp.u('sup'));
select jsonb_agg(jsonb_build_object('item_id', id, 'rating', case when n <= 4 then 'GOOD' when n = 5 then 'FAIR' else 'POOR' end)) as rt
  from (select id, row_number() over (order by sort) as n from ckb_hk_checklist_items where active) x \gset
select jsonb_agg(jsonb_build_object('item_id', id, 'rating', 'GOOD')) as allgood from ckb_hk_checklist_items where active \gset
select jsonb_agg(jsonb_build_object('item_id', id, 'rating', 'GOOD')) as nine from (select id from ckb_hk_checklist_items where active order by sort limit 5) x \gset

select pg_temp.check('every active item must be rated, exactly once',
  pg_temp.fails(format($q$select ckb_hk_score_week(%L, %L, %L::jsonb)$q$, :'a1', :'lastmon', :'nine'), '%dinilai tepat sekali%')
  and pg_temp.fails(format($q$select ckb_hk_score_week(%L, %L, %L::jsonb)$q$, :'a1', :'lastmon', (select (:'allgood'::jsonb || :'allgood'::jsonb)::text)), '%dinilai tepat sekali%'));
select pg_temp.check('a rating must be Baik, Perlu perbaikan or Buruk',
  pg_temp.fails(format($q$select ckb_hk_score_week(%L, %L, %L::jsonb)$q$, :'a1', :'lastmon', replace(:'allgood', 'GOOD', 'EXCELLENT')), '%Baik, Perlu perbaikan atau Buruk%'));
select pg_temp.check('the week starts on a Monday and is not in the future',
  pg_temp.fails(format($q$select ckb_hk_score_week(%L, %L, %L::jsonb)$q$, :'a1', :'lastmon'::date + 1, :'allgood'), '%hari Senin%')
  and pg_temp.fails(format($q$select ckb_hk_score_week(%L, %L, %L::jsonb)$q$, :'a1', :'thismon'::date + 7, :'allgood'), '%belum tiba%'));
select pg_temp.check('a rack with no done photos that week cannot be scored',
  pg_temp.fails(format($q$select ckb_hk_score_week(%L, %L, %L::jsonb)$q$, :'ac', :'lastmon', :'allgood'), '%Tidak ada foto%')
  and pg_temp.fails(format($q$select ckb_hk_score_week(%L, %L, %L::jsonb)$q$, :'a1', :'lastmon'::date - 7, :'allgood'), '%Tidak ada foto%'));

select ckb_hk_score_week(:'a1'::uuid, :'lastmon'::date, :'rt'::jsonb, 'cukup rapi') as sc1 \gset
select pg_temp.check('4 good, 1 fair, 1 poor of 6 = 9 of 12 points = 75%, version 1', (:'sc1'::jsonb->>'pct')::int = 75 and (:'sc1'::jsonb->>'version')::int = 1);
select pg_temp.check('six lines carry the item wording at scoring time',
  (select count(*) = 6 and bool_and(item_label is not null) from ckb_hk_score_lines where score_id = (:'sc1'::jsonb->>'id')::uuid));
select ckb_hk_score_week(:'a1'::uuid, :'lastmon'::date, :'allgood'::jsonb) as sc2 \gset
select pg_temp.check('a re-score is a new version (2), 100%; the first stays',
  (:'sc2'::jsonb->>'version')::int = 2 and (:'sc2'::jsonb->>'pct')::int = 100 and (select count(*) = 2 from ckb_hk_scores where area_id = :'a1'::uuid and week_start = :'lastmon'::date));
select pg_temp.as_user(pg_temp.u('adm'));
select ckb_hk_checklist_save(id, 'Lantai bersih (diubah)', true) from ckb_hk_checklist_items order by sort limit 1;
select pg_temp.check('renaming an item does not rewrite an old score line',
  (select count(*) = 1 from ckb_hk_score_lines where item_label = 'Lantai bersih dan bebas sampah' and score_id = (:'sc1'::jsonb->>'id')::uuid));
reset role;
select pg_temp.check('scores and lines cannot be changed, deleted or truncated, even by the owner',
  pg_temp.fails(format($q$update ckb_hk_scores set pct = 100 where id = %L$q$, (:'sc1'::jsonb->>'id')), '%hanya bisa ditambah%')
  and pg_temp.fails(format($q$delete from ckb_hk_score_lines where score_id = %L$q$, (:'sc1'::jsonb->>'id')), '%hanya bisa ditambah%')
  and pg_temp.fails($q$truncate ckb_hk_scores cascade$q$, '%'));
set role authenticated;
select pg_temp.as_user(pg_temp.u('op'));
select pg_temp.check('a PIC reads no score table', (select count(*) = 0 from ckb_hk_scores) and (select count(*) = 0 from ckb_hk_score_lines));

-- ---------------------------------------------------------------------
-- 3  Findings: raise, fix, verify, send back, cancel
-- ---------------------------------------------------------------------
select pg_temp.as_user(pg_temp.u('sup'));
select pg_temp.check('evidence must be a live photo of a done check-in of THIS rack',
  pg_temp.fails(format($q$select ckb_hk_raise_finding(%L, 'Palet rapi', 'Palet miring di sudut', %L)$q$, :'a1', :'pb2'), '%foto aktif dari check-in rak ini%')
  and pg_temp.fails(format($q$select ckb_hk_raise_finding(%L, 'Palet rapi', 'Palet miring di sudut', %L)$q$, :'ac', :'pbc'), '%foto aktif dari check-in rak ini%'));
select pg_temp.check('item and description are required, the due date is not in the past',
  pg_temp.fails(format($q$select ckb_hk_raise_finding(%L, 'x', 'Palet miring', %L)$q$, :'a1', :'pb1'), '%wajib diisi%')
  and pg_temp.fails(format($q$select ckb_hk_raise_finding(%L, 'Palet rapi', 'Palet miring', %L, %L)$q$, :'a1', :'pb1', :'today'::date - 1), '%masa lalu%'));
select pg_temp.as_user(pg_temp.u('op'));
select pg_temp.check('a PIC cannot raise a finding', pg_temp.fails(format($q$select ckb_hk_raise_finding(%L, 'Palet rapi', 'Palet miring', %L)$q$, :'a1', :'pb1'), '%Hanya supervisor atau admin%'));
select pg_temp.as_user(pg_temp.u('sup'));
select ckb_hk_raise_finding(:'a1'::uuid, 'Palet rapi dan lurus', 'Dua palet miring di sudut kiri', :'pb1'::uuid, :'today'::date + 3, (:'sc1'::jsonb->>'id')::uuid) as f1 \gset
select ckb_hk_raise_finding(:'a1'::uuid, 'Lorong bebas hambatan', 'Kardus kosong di lorong', :'pa1'::uuid) as f2 \gset
select ckb_hk_raise_finding(:'a2'::uuid, 'Lantai bersih dan bebas sampah', 'Ada tumpahan oli', :'pb2'::uuid) as f3 \gset
select pg_temp.check('three findings are open', (select count(*) = 3 from ckb_hk_findings where status = 'OPEN'));

-- a PIC sees only the findings of their own rack
select pg_temp.as_user(pg_temp.u('op'));
select pg_temp.check('the PIC of A1 sees its two findings and not the one of A2',
  (select count(*) = 2 from ckb_hk_findings) and (select bool_and(area_id = :'a1'::uuid) from ckb_hk_findings));
select pg_temp.as_user(pg_temp.u('op2'));
select pg_temp.check('the PIC of A2 sees only the A2 finding', (select count(*) = 1 from ckb_hk_findings where id = :'f3'::uuid) and (select count(*) = 1 from ckb_hk_findings where area_id = :'a2'::uuid));
select pg_temp.check('another rack''s PIC cannot mark it fixed', pg_temp.fails(format($q$select ckb_hk_fix_finding(%L, 'sudah dirapikan')$q$, :'f1'), '%bukan untuk rak Anda%'));

select pg_temp.as_user(pg_temp.u('op'));
select pg_temp.check('a fix needs a note; a photo must be later than the finding and from this rack',
  pg_temp.fails(format($q$select ckb_hk_fix_finding(%L, ' ')$q$, :'f1'), '%Catatan perbaikan wajib%')
  and pg_temp.fails(format($q$select ckb_hk_fix_finding(%L, 'sudah dirapikan', %L)$q$, :'f1', :'pa1'), '%setelah temuan dibuat%')
  and pg_temp.fails(format($q$select ckb_hk_fix_finding(%L, 'sudah dirapikan', %L)$q$, :'f1', :'pb2'), '%foto aktif%'));
select ckb_hk_fix_finding(:'f1'::uuid, 'Palet sudah dirapikan dan diluruskan');
select pg_temp.check('the PIC marks it fixed', (select status = 'FIXED' and fixed_by = pg_temp.u('op') from ckb_hk_findings where id = :'f1'::uuid));
select pg_temp.check('a fixed finding cannot be fixed again', pg_temp.fails(format($q$select ckb_hk_fix_finding(%L, 'lagi')$q$, :'f1'), '%masih terbuka%'));

-- verification: not the raiser, not the fixer
select pg_temp.as_user(pg_temp.u('sup'));
select pg_temp.check('the lead who raised it cannot verify it', pg_temp.fails(format($q$select ckb_hk_verify_finding(%L, true)$q$, :'f1'), '%tidak bisa memverifikasi%'));
select pg_temp.as_user(pg_temp.u('op'));
select pg_temp.check('a PIC cannot verify', pg_temp.fails(format($q$select ckb_hk_verify_finding(%L, true)$q$, :'f1'), '%Hanya supervisor atau admin%'));
select pg_temp.as_user(pg_temp.u('sup2'));
select pg_temp.check('sending back needs a reason', pg_temp.fails(format($q$select ckb_hk_verify_finding(%L, false)$q$, :'f1'), '%Alasan mengembalikan%'));
select ckb_hk_verify_finding(:'f1'::uuid, false, 'Masih ada satu palet miring');
select pg_temp.check('sent back: open again, reopen count 1 with its note',
  (select status = 'OPEN' and reopen_count = 1 and reopen_note = 'Masih ada satu palet miring' from ckb_hk_findings where id = :'f1'::uuid));
select pg_temp.as_user(pg_temp.u('op'));
select ckb_hk_fix_finding(:'f1'::uuid, 'Palet terakhir sudah diluruskan');
select pg_temp.as_user(pg_temp.u('sup2'));
select ckb_hk_verify_finding(:'f1'::uuid, true, 'Sudah rapi');
select pg_temp.check('a different lead verifies it', (select status = 'VERIFIED' and verified_by = pg_temp.u('sup2') and verified_at is not null from ckb_hk_findings where id = :'f1'::uuid));
select pg_temp.check('a verified finding cannot be cancelled or reopened',
  pg_temp.fails(format($q$select ckb_hk_cancel_finding(%L, 'salah')$q$, :'f1'), '%sudah selesai atau dibatalkan%')
  and pg_temp.fails(format($q$select ckb_hk_verify_finding(%L, false, 'lagi')$q$, :'f1'), '%sudah ditandai diperbaiki%'));

-- a lead fixes, a lead raised: the admin verifies
select pg_temp.as_user(pg_temp.u('sup'));
select ckb_hk_fix_finding(:'f2'::uuid, 'Kardus sudah dibuang');
select pg_temp.as_user(pg_temp.u('sup'));
select pg_temp.check('the lead who fixed it (and raised it) cannot verify it', pg_temp.fails(format($q$select ckb_hk_verify_finding(%L, true)$q$, :'f2'), '%tidak bisa memverifikasi%'));
select pg_temp.as_user(pg_temp.u('adm'));
select ckb_hk_verify_finding(:'f2'::uuid, true);
select pg_temp.check('the admin verifies it', (select status = 'VERIFIED' from ckb_hk_findings where id = :'f2'::uuid));

-- cancel
select pg_temp.as_user(pg_temp.u('op2'));
select pg_temp.check('a PIC cannot cancel', pg_temp.fails(format($q$select ckb_hk_cancel_finding(%L, 'salah')$q$, :'f3'), '%Hanya supervisor atau admin%'));
select pg_temp.as_user(pg_temp.u('sup'));
select pg_temp.check('cancelling needs a reason', pg_temp.fails(format($q$select ckb_hk_cancel_finding(%L, ' ')$q$, :'f3'), '%Alasan wajib%'));
select ckb_hk_cancel_finding(:'f3'::uuid, 'Salah rak, sudah dilaporkan ulang');
select pg_temp.check('the finding is cancelled with who and why', (select status = 'CANCELLED' and cancelled_by = pg_temp.u('sup') and cancel_reason like 'Salah rak%' from ckb_hk_findings where id = :'f3'::uuid));

-- guards, as the table owner
reset role;
select pg_temp.check('the guard refuses a rewrite of the description, a skipped step, a delete and a truncate',
  pg_temp.fails(format($q$update ckb_hk_findings set description = 'lain' where id = %L$q$, :'f1'), '%tidak bisa diubah%')
  and pg_temp.fails(format($q$update ckb_hk_findings set status = 'OPEN' where id = %L$q$, :'f1'), '%tidak bisa berubah dari VERIFIED ke OPEN%')
  and pg_temp.fails(format($q$update ckb_hk_findings set status = 'FIXED' where id = %L$q$, :'f3'), '%tidak bisa berubah dari CANCELLED ke FIXED%')
  and pg_temp.fails(format($q$delete from ckb_hk_findings where id = %L$q$, :'f1'), '%tidak bisa dihapus%')
  and pg_temp.fails($q$truncate ckb_hk_findings cascade$q$, '%'));
set role authenticated;

-- ---------------------------------------------------------------------
-- 4  What a customer reads
-- ---------------------------------------------------------------------
select pg_temp.as_user(pg_temp.u('sup'));
select ckb_hk_raise_finding(:'a1'::uuid, 'Label dan kode rak terlihat jelas', 'Label rak terlipat', :'pb1'::uuid) as f4 \gset
select pg_temp.as_user(pg_temp.u('repfp'));
select pg_temp.check('the customer sees the latest score per rack and week (version 2 = 100%), nothing else',
  (select count(*) = 1 and bool_and(pct = 100) and bool_and(area_code = 'HKQ-A1') from ckb_hk_customer_quality(:'c_fp'::uuid, :'lastmon'::date, :'today'::date)));
select pg_temp.check('the customer sees open and verified findings, not the cancelled one, with VERIFIED shown as DONE',
  (select count(*) = 3 from ckb_hk_customer_findings(:'c_fp'::uuid))
  and (select count(*) = 2 from ckb_hk_customer_findings(:'c_fp'::uuid) where status = 'DONE')
  and (select count(*) = 1 from ckb_hk_customer_findings(:'c_fp'::uuid) where status = 'OPEN')
  and not exists (select 1 from ckb_hk_customer_findings(:'c_fp'::uuid) where description like 'Ada tumpahan%'));
select pg_temp.check('open findings come first',
  (select status from ckb_hk_customer_findings(:'c_fp'::uuid) limit 1) = 'OPEN');
select pg_temp.check('nothing a customer gets holds a name, a fix note, a verification note or a send-back reason',
  (select string_agg(t::text, ' ') from ckb_hk_customer_findings(:'c_fp'::uuid) t) !~* '(Oki|Odi|Sari|Sinta|Ayu|t_ckb|dirapikan|diluruskan|Sudah rapi|Masih ada|dibuang|Salah rak)'
  and (select string_agg(t::text, ' ') from ckb_hk_customer_quality(:'c_fp'::uuid, :'lastmon'::date, :'today'::date) t) !~* '(Oki|Odi|Sari|Sinta|Ayu|t_ckb|cukup rapi)');
select pg_temp.check('the customer has no table access to scores, lines or findings',
  (select count(*) = 0 from ckb_hk_scores) and (select count(*) = 0 from ckb_hk_findings) and (select count(*) = 0 from ckb_hk_score_lines));
select pg_temp.check('the customer opens the evidence photo of a done check-in',
  (select count(*) = 1 from ckb_hk_photo_open((select evidence_photo_id from ckb_hk_customer_findings(:'c_fp'::uuid) limit 1))));
select pg_temp.check('another customer''s findings and quality are refused',
  pg_temp.fails(format($q$select * from ckb_hk_customer_findings(%L)$q$, :'c_cgp'), '%Customer tidak ditemukan%')
  and pg_temp.fails(format($q$select * from ckb_hk_customer_quality(%L, %L, %L)$q$, :'c_cgp', :'lastmon', :'today'), '%Customer tidak ditemukan%'));
select pg_temp.as_user(pg_temp.u('repcgp'));
select pg_temp.check('the CGP customer sees none of Freeport''s findings', (select count(*) = 0 from ckb_hk_customer_findings(:'c_cgp'::uuid)));
select pg_temp.as_user(pg_temp.u('repfp'));
select pg_temp.check('a range over 190 days is refused', pg_temp.fails(format($q$select * from ckb_hk_customer_quality(%L, %L, %L)$q$, :'c_fp', :'today'::date - 200, :'today'), '%maksimal 190 hari%'));

-- ---------------------------------------------------------------------
-- 5  Dashboard, badge, audit
-- ---------------------------------------------------------------------
select pg_temp.as_user(pg_temp.u('sup'));
select ckb_hk_dashboard(null) as dash \gset
select pg_temp.check('the lead dashboard counts open and awaiting findings',
  (:'dash'::jsonb ?& array['open_findings', 'awaiting_verify']) and (:'dash'::jsonb->>'open_findings')::int = 1 and (:'dash'::jsonb->>'awaiting_verify')::int = 0);
select pg_temp.as_user(pg_temp.u('op'));
select pg_temp.check('the PIC dashboard counts their own open findings (1 on A1)', (ckb_hk_dashboard(null)->>'my_findings')::int = 1 and not (ckb_hk_dashboard(null) ? 'awaiting_verify'));
select pg_temp.as_user(pg_temp.u('repfp'));
select pg_temp.check('the customer dashboard counts open findings of their customer only', (ckb_hk_dashboard(:'c_fp'::uuid)->>'open_findings')::int = 1);
select pg_temp.as_user(pg_temp.u('op'));
select ckb_hk_fix_finding(:'f4'::uuid, 'Label sudah diluruskan');
select pg_temp.as_user(pg_temp.u('sup'));
select pg_temp.check('the lead badge counts a fixed finding waiting for verification (queue of check-ins plus 1)',
  ckb_hk_badge() = (select count(*) from ckb_hk_checkins where status = 'SUBMITTED') + 1);
select pg_temp.as_user(pg_temp.u('op'));
select ckb_hk_badge() as pic_b0 \gset
select pg_temp.as_user(pg_temp.u('sup'));
select ckb_hk_raise_finding(:'a1'::uuid, 'Lorong bebas hambatan', 'Pallet kosong menumpuk', :'pa1'::uuid) as f5 \gset
select pg_temp.as_user(pg_temp.u('op'));
select pg_temp.check('a new open finding on the PIC''s rack adds one to their badge', ckb_hk_badge() = :pic_b0 + 1);

reset role;
select pg_temp.check('every step was audited',
  (select count(distinct action) = 7 from ckb_audit_events where action in ('HK_CHECKLIST_SAVE', 'HK_SCORE', 'HK_FINDING_RAISE', 'HK_FINDING_FIX', 'HK_FINDING_VERIFY', 'HK_FINDING_REOPEN', 'HK_FINDING_CANCEL')));
select pg_temp.check('the new tables have no name column that a customer could read (they have no policy at all)',
  not exists (select 1 from pg_policies where tablename in ('ckb_hk_scores', 'ckb_hk_score_lines', 'ckb_hk_findings', 'ckb_hk_checklist_items') and (qual ~ 'customer' or qual ~ 'ckb_can_see_customer')));

rollback;
