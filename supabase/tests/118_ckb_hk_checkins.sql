-- CKB housekeeping, part 2 (0158): the daily check-in with before and after photos, the late window, review,
-- the day states, and that a customer reads housekeeping without a single name. Runs in a transaction and rolls back.
-- Dates are taken from the database's own today (the late rules depend on it); the "today" cases adapt to a weekend.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
\ir ckb_fixture.psql

create or replace function pg_temp.ph(p_checkin uuid, p_kind text, p_n int) returns uuid language plpgsql as $$
declare v_c uuid;
begin
  select customer_id into v_c from ckb_hk_checkins where id = p_checkin;
  return ckb_hk_register_photo(p_checkin, p_kind, v_c::text || '/HOUSEKEEPING/' || p_checkin::text || '/' || gen_random_uuid()::text || '.jpg',
    'image/jpeg', 40000, encode(sha256(convert_to('photo-' || p_n::text || '-' || p_checkin::text || p_kind, 'utf8')), 'hex'));
end $$;
grant execute on function pg_temp.ph(uuid, text, int) to authenticated;

-- Working days back from today: w1 is the latest working day before today (late rank 1), w2 rank 2, ...
select ckb_hk_today() as today \gset
select array_agg(d order by d desc) as wd from (select g::date as d from generate_series(:'today'::date - 25, :'today'::date - 1, interval '1 day') g
  where extract(isodow from g) between 1 and 5) x \gset
select (:'wd'::date[])[1] as w1, (:'wd'::date[])[2] as w2, (:'wd'::date[])[3] as w3, (:'wd'::date[])[4] as w4, (:'wd'::date[])[5] as w5, (:'wd'::date[])[6] as w6 \gset
select max(g::date) as sat from generate_series(:'today'::date - 10, :'today'::date, interval '1 day') g where extract(isodow from g) = 6 \gset
select ckb_hk_is_workday(:'today'::date) as tw \gset

-- Areas: A1 (Freeport, PIC op), A2 (CGP, PIC op2), A3 (Freeport, PIC sup), A0 (no PIC), A9 (no customer)
set role authenticated;
select pg_temp.as_user(pg_temp.u('adm'));
select ckb_hk_save_area(null, 'HKT-A1', 'Rak uji A1', :'c_fp', true, null) as a1 \gset
select ckb_hk_save_area(null, 'HKT-A2', 'Rak uji A2', :'c_cgp', true, null) as a2 \gset
select ckb_hk_save_area(null, 'HKT-A3', 'Rak uji A3', :'c_fp', true, null) as a3 \gset
select ckb_hk_save_area(null, 'HKT-A0', 'Rak uji A0', :'c_fp', true, null) as a0 \gset
select ckb_hk_save_area(null, 'HKT-A9', 'Rak uji A9', null, true, null) as a9 \gset
select ckb_hk_assign(:'a1', pg_temp.u('op'), :'today'::date - 40) as _ \gset
select ckb_hk_assign(:'a2', pg_temp.u('op2'), :'today'::date - 40) as _ \gset
select ckb_hk_assign(:'a3', pg_temp.u('sup'), :'today'::date - 40) as _ \gset
select ckb_hk_assign(:'a9', pg_temp.u('op'), :'today'::date - 40) as _ \gset
select pg_temp.as_user(pg_temp.u('sup'));
select ckb_hk_set_holiday(:'w6'::date, 'libur uji');
select ckb_hk_add_absence(pg_temp.u('op'), :'w3'::date, :'w3'::date, 'cuti uji') as _ \gset

-- ---------------------------------------------------------------------
-- 1  Who may start which day
-- ---------------------------------------------------------------------
select pg_temp.as_user(pg_temp.u('repfp'));
select pg_temp.check('a customer representative cannot start a check-in', pg_temp.fails(format($q$select ckb_hk_start(%L, %L)$q$, :'a1', :'w1'), '%staf CKB%'));
select pg_temp.as_user(pg_temp.u('op2'));
select pg_temp.check('a PIC cannot start someone else''s area', pg_temp.fails(format($q$select ckb_hk_start(%L, %L)$q$, :'a1', :'w1'), '%bukan milik Anda%'));
select pg_temp.as_user(pg_temp.u('op'));
select pg_temp.check('a future day is refused', pg_temp.fails(format($q$select ckb_hk_start(%L, %L)$q$, :'a1', :'today'::date + 1), '%belum tiba%'));
select pg_temp.check('a Saturday is refused', pg_temp.fails(format($q$select ckb_hk_start(%L, %L)$q$, :'a1', :'sat'), '%bukan hari kerja%'));
select pg_temp.check('a holiday is refused', pg_temp.fails(format($q$select ckb_hk_start(%L, %L)$q$, :'a1', :'w6'), '%bukan hari kerja%'));
select pg_temp.check('a leave day is refused', pg_temp.fails(format($q$select ckb_hk_start(%L, %L)$q$, :'a1', :'w3'), '%cuti%'));
select pg_temp.check('beyond the late window (3 working days) the PIC cannot fill it', pg_temp.fails(format($q$select ckb_hk_start(%L, %L)$q$, :'a1', :'w4'), '%batas terlambat%'));
select pg_temp.check('an area without a customer is refused', pg_temp.fails(format($q$select ckb_hk_start(%L, %L)$q$, :'a9', :'w1'), '%belum punya customer%'));
select pg_temp.as_user(pg_temp.u('sup'));
select pg_temp.check('an area without a PIC is refused', pg_temp.fails(format($q$select ckb_hk_start(%L, %L, %L)$q$, :'a0', :'w1', 'uji'), '%belum punya PIC%'));

\if :tw
  select pg_temp.as_user(pg_temp.u('op'));
  select ckb_hk_start(:'a1', null) as t0 \gset
  select pg_temp.check('today is a working day: a normal check-in starts, not late, not on behalf',
    (:'t0'::jsonb->>'late')::boolean = false and (:'t0'::jsonb->>'on_behalf')::boolean = false and (:'t0'::jsonb->>'resumed')::boolean = false);
  select pg_temp.check('starting again resumes the same check-in',
    (ckb_hk_start(:'a1', null)->>'id') = (:'t0'::jsonb->>'id') and (ckb_hk_start(:'a1', null)->>'resumed')::boolean);
\else
  select pg_temp.as_user(pg_temp.u('op'));
  select pg_temp.check('today is a weekend or holiday: starting is refused (today cases skipped)', pg_temp.fails(format($q$select ckb_hk_start(%L)$q$, :'a1'), '%bukan hari kerja%'));
\endif

-- ---------------------------------------------------------------------
-- 2  A late check-in of w1: photo rules, submit, review, attempt 2
-- ---------------------------------------------------------------------
select pg_temp.as_user(pg_temp.u('op'));
select ckb_hk_start(:'a1', :'w1'::date) as s1 \gset
select (:'s1'::jsonb->>'id')::uuid as c1 \gset
select pg_temp.check('a late check-in within the window starts, flagged late', (:'s1'::jsonb->>'late')::boolean and not (:'s1'::jsonb->>'on_behalf')::boolean);
select pg_temp.check('the same call again resumes it', (ckb_hk_start(:'a1', :'w1'::date)->>'id')::uuid = :'c1'::uuid);
select pg_temp.check('an after photo needs a before photo first', pg_temp.fails(format($q$select pg_temp.ph(%L, 'AFTER', 1)$q$, :'c1'), '%foto sebelum dulu%'));
select pg_temp.check('submitting with no photos is refused', pg_temp.fails(format($q$select ckb_hk_submit(%L)$q$, :'c1'), '%Foto sebelum belum ada%'));
select pg_temp.ph(:'c1', 'BEFORE', 1) as b1 \gset
select pg_temp.check('submitting with only a before photo is refused', pg_temp.fails(format($q$select ckb_hk_submit(%L)$q$, :'c1'), '%Foto sesudah belum ada%'));
select pg_temp.check('the same file is refused (duplicate fingerprint)',
  pg_temp.fails(format($q$select ckb_hk_register_photo(%L, 'BEFORE', %L, 'image/jpeg', 40000, %L)$q$, :'c1',
    (select customer_id::text from ckb_hk_checkins where id = :'c1'::uuid) || '/HOUSEKEEPING/' || :'c1' || '/' || gen_random_uuid()::text || '.jpg',
    encode(sha256(convert_to('photo-1-' || :'c1' || 'BEFORE', 'utf8')), 'hex')), '%sudah pernah dipakai%'));
select pg_temp.ph(:'c1', 'BEFORE', 2) as _ \gset
select pg_temp.ph(:'c1', 'BEFORE', 3) as _ \gset
select pg_temp.check('at most 3 before photos', pg_temp.fails(format($q$select pg_temp.ph(%L, 'BEFORE', 4)$q$, :'c1'), '%Maksimal 3%'));
select pg_temp.check('a pdf is not a photo',
  pg_temp.fails(format($q$select ckb_hk_register_photo(%L, 'AFTER', %L, 'application/pdf', 100, %L)$q$, :'c1', 'x/y/z/w.pdf', repeat('a', 64)), '%JPG, PNG atau WebP%'));
select pg_temp.check('a path that is not the check-in''s own is refused',
  pg_temp.fails(format($q$select ckb_hk_register_photo(%L, 'AFTER', %L, 'image/jpeg', 100, %L)$q$, :'c1', 'other/HOUSEKEEPING/x/' || gen_random_uuid()::text || '.jpg', repeat('b', 64)), '%Lokasi file%'));
select pg_temp.as_user(pg_temp.u('op2'));
select pg_temp.check('another person cannot add a photo to it', pg_temp.fails(format($q$select pg_temp.ph(%L, 'AFTER', 9)$q$, :'c1'), '%bukan milik Anda%'));
select pg_temp.as_user(pg_temp.u('op'));

-- the minimum gap is a setting (default 0 = none)
reset role;
update ckb_settings set value = jsonb_set(value, '{min_gap_minutes}', '10') where key = 'housekeeping';
set role authenticated;
select pg_temp.as_user(pg_temp.u('op'));
select pg_temp.check('with a 10 minute gap an after photo right away is refused', pg_temp.fails(format($q$select pg_temp.ph(%L, 'AFTER', 5)$q$, :'c1'), '%10 menit%'));
reset role;
update ckb_settings set value = jsonb_set(value, '{min_gap_minutes}', '0') where key = 'housekeeping';
set role authenticated;
select pg_temp.as_user(pg_temp.u('op'));
select pg_temp.ph(:'c1', 'AFTER', 5) as _ \gset
select ckb_hk_submit(:'c1'::uuid);
select pg_temp.check('submitted: status SUBMITTED, submitted_at set',
  (select status = 'SUBMITTED' and submitted_at is not null from ckb_hk_checkins where id = :'c1'::uuid));
select pg_temp.check('no more photos, no second submit, no second start on a finished day',
  pg_temp.fails(format($q$select pg_temp.ph(%L, 'AFTER', 6)$q$, :'c1'), '%sebelum check-in dikirim%')
  and pg_temp.fails(format($q$select ckb_hk_submit(%L)$q$, :'c1'), '%sudah dikirim%')
  and pg_temp.fails(format($q$select ckb_hk_start(%L, %L)$q$, :'a1', :'w1'), '%sudah selesai%'));
select pg_temp.check('it counts as done at once', (select state = 'DONE' and late from ckb_hk_my_days(:'w1'::date, :'w1'::date) where area_code = 'HKT-A1'));

select pg_temp.as_user(pg_temp.u('op'));
select pg_temp.check('a PIC cannot review', pg_temp.fails(format($q$select ckb_hk_review(%L, true, null)$q$, :'c1'), '%supervisor atau admin%'));
select pg_temp.as_user(pg_temp.u('sup'));
select pg_temp.check('a rejection needs a reason', pg_temp.fails(format($q$select ckb_hk_review(%L, false, ' ')$q$, :'c1'), '%Alasan penolakan%'));
select ckb_hk_review(:'c1'::uuid, false, 'foto tidak menunjukkan rak');
select pg_temp.check('a rejection takes it back: the day reads MISSED (past) and the PIC sees why',
  (select state = 'MISSED' from ckb_hk_recap(:'w1'::date, :'w1'::date, :'c_fp'::uuid) where area_code = 'HKT-A1'));
select pg_temp.as_user(pg_temp.u('op'));
select pg_temp.check('the PIC sees the reason on the rejected day',
  (select review_note = 'foto tidak menunjukkan rak' from ckb_hk_my_days(:'w1'::date, :'w1'::date) where area_code = 'HKT-A1'));
select ckb_hk_start(:'a1', :'w1'::date) as s1b \gset
select (:'s1b'::jsonb->>'id')::uuid as c1b \gset
select pg_temp.check('after a rejection a new attempt starts', (:'s1b'::jsonb->>'attempt')::int = 2 and :'c1b' <> :'c1');
select pg_temp.ph(:'c1b', 'BEFORE', 11) as _ \gset
select pg_temp.ph(:'c1b', 'AFTER', 12) as _ \gset
select ckb_hk_submit(:'c1b'::uuid);
select pg_temp.as_user(pg_temp.u('sup'));
select ckb_hk_review(:'c1b'::uuid, true, null);
select pg_temp.check('accepted: status ACCEPTED, the day is DONE',
  (select status = 'ACCEPTED' from ckb_hk_checkins where id = :'c1b'::uuid)
  and (select state = 'DONE' from ckb_hk_recap(:'w1'::date, :'w1'::date, :'c_fp'::uuid) where area_code = 'HKT-A1'));
select pg_temp.check('a reviewed check-in cannot be reviewed again', pg_temp.fails(format($q$select ckb_hk_review(%L, false, 'lagi')$q$, :'c1b'), '%belum ditinjau%'));

-- a supervisor who is the PIC cannot review their own work
select ckb_hk_start(:'a3', :'w1'::date) as s3 \gset
select (:'s3'::jsonb->>'id')::uuid as c3 \gset
select pg_temp.ph(:'c3', 'BEFORE', 21) as _ \gset
select pg_temp.ph(:'c3', 'AFTER', 22) as _ \gset
select ckb_hk_submit(:'c3'::uuid);
select pg_temp.check('a reviewer is never the doer', pg_temp.fails(format($q$select ckb_hk_review(%L, true, null)$q$, :'c3'), '%pekerjaan sendiri%'));
select pg_temp.as_user(pg_temp.u('sup2'));
select ckb_hk_review(:'c3'::uuid, true, null);
select pg_temp.check('another supervisor can', (select status = 'ACCEPTED' from ckb_hk_checkins where id = :'c3'::uuid));

-- ---------------------------------------------------------------------
-- 3  On behalf of the PIC (a lead), also beyond the late window
-- ---------------------------------------------------------------------
select pg_temp.as_user(pg_temp.u('sup'));
select pg_temp.check('on behalf needs a reason', pg_temp.fails(format($q$select ckb_hk_start(%L, %L)$q$, :'a1', :'w2'), '%Alasan wajib%'));
select ckb_hk_start(:'a1', :'w2'::date, 'PIC sakit, tidak ada telepon') as s2 \gset
select (:'s2'::jsonb->>'id')::uuid as c2 \gset
select pg_temp.check('a lead starts it on behalf; it is flagged', (:'s2'::jsonb->>'on_behalf')::boolean and (:'s2'::jsonb->>'late')::boolean);
select pg_temp.ph(:'c2', 'BEFORE', 31) as _ \gset
select pg_temp.ph(:'c2', 'AFTER', 32) as _ \gset
select ckb_hk_submit(:'c2'::uuid);
select ckb_hk_start(:'a1', :'w4'::date, 'melewati batas') as s4 \gset
select (:'s4'::jsonb->>'id')::uuid as c4 \gset
select pg_temp.ph(:'c4', 'BEFORE', 41) as _ \gset
select pg_temp.ph(:'c4', 'AFTER', 42) as _ \gset
select ckb_hk_submit(:'c4'::uuid);
select pg_temp.check('a lead can fill a day beyond the window, on behalf',
  (select on_behalf_name is not null and on_behalf_reason = 'melewati batas' from ckb_hk_checkins where id = :'c4'::uuid));
select pg_temp.check('a lead still cannot fill a holiday or a leave day',
  pg_temp.fails(format($q$select ckb_hk_start(%L, %L, 'uji')$q$, :'a1', :'w6'), '%bukan hari kerja%')
  and pg_temp.fails(format($q$select ckb_hk_start(%L, %L, 'uji')$q$, :'a1', :'w3'), '%cuti%'));

-- ---------------------------------------------------------------------
-- 4  The customer reads housekeeping without a name
-- ---------------------------------------------------------------------
select pg_temp.as_user(pg_temp.u('repfp'));
select pg_temp.check('the Freeport representative reads no table of housekeeping directly',
  (select count(*) = 0 from ckb_hk_checkins) and (select count(*) = 0 from ckb_hk_photos) and (select count(*) = 0 from ckb_hk_areas)
  and (select count(*) = 0 from ckb_hk_assignments));
select pg_temp.check('the week of area A1 for Freeport, day by day (w6 oldest ... w1 latest)',
  (select string_agg(state || case when late then '+late' else '' end || case when on_behalf then '+beh' else '' end, ',' order by day)
     = 'HOLIDAY,MISSED,DONE+late+beh,NA,DONE+late+beh,DONE+late'
     from ckb_hk_customer_week(:'c_fp'::uuid, :'w6'::date, :'w1'::date) where area_code = 'HKT-A1'));
select pg_temp.check('leave reads as not scheduled (NA), never as leave', (select state = 'NA' from ckb_hk_customer_week(:'c_fp'::uuid, :'w3'::date, :'w3'::date) where area_code = 'HKT-A1'));
select pg_temp.check('compliance of A1 over the period: 4 expected (3 done + 1 missed), 3 done, 3 of them late',
  (select expected = 4 and done = 3 and late = 3 from ckb_hk_compliance(:'c_fp'::uuid, :'w6'::date, :'w1'::date) where area_code = 'HKT-A1'));
select pg_temp.check('nothing a customer receives contains a person''s name',
  (select string_agg(t::text, ' ') from ckb_hk_customer_week(:'c_fp'::uuid, :'w6'::date, :'w1'::date) t) !~* '(Oki|Odi|Sari|Sinta|Ayu|t_ckb|operator|supervisor)'
  and (select string_agg(t::text, ' ') from ckb_hk_compliance(:'c_fp'::uuid, :'w6'::date, :'w1'::date) t) !~* '(Oki|Odi|Sari|Sinta|Ayu|t_ckb)'
  and (select string_agg(t::text, ' ') from ckb_hk_customer_day(:'a1'::uuid, :'w1'::date) t) !~* '(Oki|Odi|Sari|Sinta|Ayu|t_ckb)');
select pg_temp.check('the day of A1 shows the photos of the accepted attempt only (1 before, 1 after), not the rejected attempt',
  (select count(*) = 2 and count(*) filter (where kind = 'BEFORE') = 1 and bool_and(checkin_id = :'c1b'::uuid) from ckb_hk_customer_day(:'a1'::uuid, :'w1'::date)));
select pg_temp.check('a day nobody did shows no photos', (select count(*) = 0 from ckb_hk_customer_day(:'a1'::uuid, :'w5'::date)));
select pg_temp.check('another customer''s area and customer are refused',
  pg_temp.fails(format($q$select * from ckb_hk_customer_week(%L, %L, %L)$q$, :'c_cgp', :'w2', :'w1'), '%Customer tidak ditemukan%')
  and pg_temp.fails(format($q$select * from ckb_hk_customer_day(%L, %L)$q$, :'a2', :'w1'), '%Area tidak ditemukan%'));
select pg_temp.check('a customer cannot call the recap or the PIC list', pg_temp.fails(format($q$select * from ckb_hk_recap(%L, %L)$q$, :'w2', :'w1'), '%supervisor atau admin%')
  and pg_temp.fails(format($q$select * from ckb_hk_my_days(%L, %L)$q$, :'w2', :'w1'), '%staf CKB%'));

select (select photo_id from ckb_hk_customer_day(:'a1'::uuid, :'w1'::date) limit 1) as okphoto \gset
reset role;
select id as rejphoto from ckb_hk_photos where checkin_id = :'c1'::uuid limit 1 \gset
set role authenticated;
select pg_temp.as_user(pg_temp.u('repfp'));
select pg_temp.check('the customer opens a photo of an accepted check-in (and the view is logged)',
  (select count(*) = 1 from ckb_hk_photo_open(:'okphoto'::uuid)));
select pg_temp.check('but not a photo of a rejected attempt', pg_temp.fails(format($q$select * from ckb_hk_photo_open(%L)$q$, :'rejphoto'), '%Foto tidak ditemukan%'));
select pg_temp.as_user(pg_temp.u('repcgp'));
select pg_temp.check('another customer cannot open it', pg_temp.fails(format($q$select * from ckb_hk_photo_open(%L)$q$, :'okphoto'), '%Foto tidak ditemukan%'));
select pg_temp.as_user(pg_temp.u('op2'));
select pg_temp.check('another PIC cannot open it, and reads none of A1''s check-ins',
  pg_temp.fails(format($q$select * from ckb_hk_photo_open(%L)$q$, :'okphoto'), '%Foto tidak ditemukan%')
  and (select count(*) = 0 from ckb_hk_checkins where area_id = :'a1'::uuid));
select pg_temp.as_user(pg_temp.u('op'));
select pg_temp.check('the PIC opens their own photo', (select count(*) = 1 from ckb_hk_photo_open(:'okphoto'::uuid)));
select pg_temp.check('the PIC list is only theirs: A1 and A9, no other area',
  (select count(distinct area_code) = 2 and bool_and(area_code in ('HKT-A1', 'HKT-A9')) from ckb_hk_my_days(:'w6'::date, :'w1'::date)));

-- ---------------------------------------------------------------------
-- 5  Nothing is edited or removed, and everything is audited
-- ---------------------------------------------------------------------
reset role;
select pg_temp.check('a check-in cannot be re-pointed, deleted or moved backwards',
  pg_temp.fails(format($q$update ckb_hk_checkins set area_id = %L where id = %L$q$, :'a2', :'c1b'), '%tidak bisa diubah%')
  and pg_temp.fails(format($q$delete from ckb_hk_checkins where id = %L$q$, :'c1b'), '%tidak bisa dihapus%')
  and pg_temp.fails(format($q$update ckb_hk_checkins set status = 'STARTED' where id = %L$q$, :'c1b'), '%tidak bisa berubah%'));
select pg_temp.check('a photo cannot be edited or deleted',
  pg_temp.fails(format($q$update ckb_hk_photos set kind = 'BEFORE' where id = %L$q$, :'okphoto'), '%tidak bisa diubah%')
  and pg_temp.fails(format($q$delete from ckb_hk_photos where id = %L$q$, :'okphoto'), '%tidak bisa dihapus%'));
select pg_temp.check('the photo table stores no person''s name',
  not exists (select 1 from information_schema.columns where table_name = 'ckb_hk_photos' and column_name ~ 'name'));
select pg_temp.check('every step was audited',
  (select count(distinct action) = 7 from ckb_audit_events where action in ('HK_START', 'HK_PHOTO', 'HK_SUBMIT', 'HK_ACCEPT', 'HK_REJECT', 'HK_PHOTO_VIEW', 'HK_ASSIGN')));

rollback;
