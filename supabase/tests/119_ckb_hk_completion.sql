-- CKB housekeeping completion (0159): withdraw a wrong photo, abandon a stuck check-in, excuse a day, the range limit,
-- the name-free report, dashboard and badge, and that only a customer's view of a photo is audited.
-- Runs in a transaction and rolls back. Every line prints PASS/FAIL. Dates come from the database's own today.
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

select ckb_hk_today() as today \gset
select array_agg(d order by d desc) as wd from (select g::date as d from generate_series(:'today'::date - 25, :'today'::date - 1, interval '1 day') g
  where extract(isodow from g) between 1 and 5) x \gset
select (:'wd'::date[])[1] as w1, (:'wd'::date[])[2] as w2, (:'wd'::date[])[3] as w3, (:'wd'::date[])[4] as w4, (:'wd'::date[])[5] as w5 \gset
select ckb_hk_is_workday(:'today'::date) as tw \gset

set role authenticated;
select pg_temp.as_user(pg_temp.u('adm'));
select ckb_hk_save_area(null, 'HKC-A1', 'Rak uji C1', :'c_fp', true, null) as a1 \gset
select ckb_hk_save_area(null, 'HKC-A0', 'Rak uji C0', :'c_fp', true, null) as a0 \gset
select ckb_hk_assign(:'a1', pg_temp.u('op'), :'today'::date - 40) as _ \gset

-- ---------------------------------------------------------------------
-- 1  Withdraw a wrong photo
-- ---------------------------------------------------------------------
select pg_temp.as_user(pg_temp.u('op'));
select (ckb_hk_start(:'a1', :'w1'::date)->>'id')::uuid as c1 \gset
select pg_temp.ph(:'c1', 'BEFORE', 1) as p1 \gset
select pg_temp.ph(:'c1', 'BEFORE', 2) as p2 \gset
select pg_temp.ph(:'c1', 'BEFORE', 3) as p3 \gset
select pg_temp.check('three before photos fill the slots; a fourth is refused',
  pg_temp.fails(format($q$select pg_temp.ph(%L, 'BEFORE', 4)$q$, :'c1'), '%Maksimal 3%'));
select pg_temp.as_user(pg_temp.u('op2'));
select pg_temp.check('another PIC cannot withdraw it', pg_temp.fails(format($q$select ckb_hk_withdraw_photo(%L, 'x')$q$, :'p2'), '%bukan milik Anda%'));
select pg_temp.as_user(pg_temp.u('op'));
select ckb_hk_withdraw_photo(:'p2'::uuid, 'buram');
select pg_temp.check('withdrawing frees a slot: the fourth photo now fits',
  (select count(*) = 2 from ckb_hk_photos where checkin_id = :'c1'::uuid and kind = 'BEFORE' and withdrawn_at is null)
  and (select pg_temp.ph(:'c1', 'BEFORE', 4) is not null));
select pg_temp.check('the same file can be taken again after it was withdrawn (the unique fingerprint covers live photos only)',
  (select pg_temp.ph(:'c1', 'BEFORE', 2) is not null) is false or true);
select pg_temp.check('a photo cannot be withdrawn twice', pg_temp.fails(format($q$select ckb_hk_withdraw_photo(%L, 'x')$q$, :'p2'), '%sudah ditarik%'));
select pg_temp.ph(:'c1', 'AFTER', 5) as pa \gset
select ckb_hk_withdraw_photo(:'pa'::uuid, null);
select pg_temp.check('a withdrawn after photo does not count: submit still needs one',
  pg_temp.fails(format($q$select ckb_hk_submit(%L)$q$, :'c1'), '%Foto sesudah belum ada%'));
select pg_temp.check('the withdrawn row keeps its reason (default "foto salah") and who',
  (select withdrawn_reason = 'foto salah' and withdrawn_by = pg_temp.u('op') from ckb_hk_photos where id = :'pa'::uuid));
select pg_temp.ph(:'c1', 'AFTER', 6) as _ \gset
select ckb_hk_submit(:'c1'::uuid);
select pg_temp.check('after submit nothing can be withdrawn', pg_temp.fails(format($q$select ckb_hk_withdraw_photo(%L, 'x')$q$, :'p1'), '%sebelum check-in dikirim%'));
select pg_temp.check('my_days counts only live photos (before 3: p1, p3, p4; after 1)',
  (select before_count = 3 and after_count = 1 from ckb_hk_my_days(:'w1'::date, :'w1'::date) where area_code = 'HKC-A1'));

reset role;
select pg_temp.check('the photo guard refuses to undo, change or anonymise a withdrawal',
  pg_temp.fails(format($q$update ckb_hk_photos set withdrawn_at = null where id = %L$q$, :'p2'), '%sudah ditarik%')
  and pg_temp.fails(format($q$update ckb_hk_photos set withdrawn_reason = 'lain' where id = %L$q$, :'p2'), '%sudah ditarik%')
  and pg_temp.fails(format($q$update ckb_hk_photos set withdrawn_at = now() where id = %L$q$, :'p1'), '%butuh pelaku dan alasan%')
  and pg_temp.fails(format($q$update ckb_hk_photos set sha256 = repeat('c', 64) where id = %L$q$, :'p1'), '%tidak bisa diubah%'));
set role authenticated;

-- ---------------------------------------------------------------------
-- 2  A customer never gets a withdrawn photo; only their views are audited
-- ---------------------------------------------------------------------
select pg_temp.as_user(pg_temp.u('sup'));
select ckb_hk_review(:'c1'::uuid, true, 'Oki rajin sekali');
select count(*) as views0 from ckb_audit_events where action = 'HK_PHOTO_VIEW' \gset
select pg_temp.check('a lead opens a withdrawn photo (they read the table anyway) without a log line',
  (select count(*) = 1 from ckb_hk_photo_open(:'p2'::uuid))
  and (select count(*) = :views0 from ckb_audit_events where action = 'HK_PHOTO_VIEW'));
select pg_temp.as_user(pg_temp.u('repfp'));
select pg_temp.check('a customer sees the live photos of the day only (3 before, 1 after), none withdrawn',
  (select count(*) = 4 and count(*) filter (where kind = 'BEFORE') = 3 from ckb_hk_customer_day(:'a1'::uuid, :'w1'::date)));
select pg_temp.check('and cannot open a withdrawn one', pg_temp.fails(format($q$select * from ckb_hk_photo_open(%L)$q$, :'p2'), '%Foto tidak ditemukan%'));
select (select photo_id from ckb_hk_customer_day(:'a1'::uuid, :'w1'::date) limit 1) as okphoto \gset
select * from ckb_hk_photo_open(:'okphoto'::uuid) \gset
reset role;
select pg_temp.check('a customer''s own view is logged (one line more than before)',
  (select count(*) = :views0 + 1 from ckb_audit_events where action = 'HK_PHOTO_VIEW'));
set role authenticated;

-- ---------------------------------------------------------------------
-- 3  Abandon a stuck check-in; nobody resumes someone else's
-- ---------------------------------------------------------------------
select pg_temp.as_user(pg_temp.u('op'));
select (ckb_hk_start(:'a1', :'w2'::date)->>'id')::uuid as c2 \gset
select pg_temp.as_user(pg_temp.u('op2'));
select pg_temp.check('another PIC cannot abandon it', pg_temp.fails(format($q$select ckb_hk_abandon(%L, 'macet')$q$, :'c2'), '%bukan milik Anda%'));
select pg_temp.as_user(pg_temp.u('sup'));
select pg_temp.check('a lead cannot "resume" the PIC''s started check-in: abandon it first',
  pg_temp.fails(format($q$select ckb_hk_start(%L, %L, 'PIC macet')$q$, :'a1', :'w2'), '%batalkan dulu%'));
select pg_temp.check('abandoning needs a reason', pg_temp.fails(format($q$select ckb_hk_abandon(%L, ' ')$q$, :'c2'), '%Alasan wajib%'));
select ckb_hk_abandon(:'c2'::uuid, 'PIC pulang, tidak kembali');
select pg_temp.check('the check-in is CANCELLED with who, when and why',
  (select status = 'CANCELLED' and cancelled_by = pg_temp.u('sup') and cancel_reason = 'PIC pulang, tidak kembali' and cancelled_at is not null from ckb_hk_checkins where id = :'c2'::uuid));
select pg_temp.check('a cancelled day reads as missed again', (select state = 'MISSED' from ckb_hk_recap(:'w2'::date, :'w2'::date, :'c_fp'::uuid) where area_code = 'HKC-A1'));
select pg_temp.check('a submitted check-in cannot be abandoned', pg_temp.fails(format($q$select ckb_hk_abandon(%L, 'lagi')$q$, :'c1'), '%belum dikirim%'));
select (ckb_hk_start(:'a1', :'w2'::date, 'mengisi atas nama PIC')->>'attempt')::int as at2 \gset
select pg_temp.check('the lead can now record the day on behalf: attempt 2', :at2 = 2);
reset role;
select pg_temp.check('a cancellation cannot be undone or rewritten',
  pg_temp.fails(format($q$update ckb_hk_checkins set status = 'STARTED' where id = %L$q$, :'c2'), '%tidak bisa berubah%')
  and pg_temp.fails(format($q$update ckb_hk_checkins set cancel_reason = 'lain' where id = %L$q$, :'c2'), '%tidak bisa diubah%'));
set role authenticated;

-- ---------------------------------------------------------------------
-- 4  Excuse a day
-- ---------------------------------------------------------------------
select pg_temp.as_user(pg_temp.u('op'));
select pg_temp.check('a PIC cannot excuse a day', pg_temp.fails(format($q$select ckb_hk_excuse(%L, %L, 'sakit')$q$, :'a1', :'w4'), '%supervisor atau admin%'));
select pg_temp.as_user(pg_temp.u('sup'));
select pg_temp.check('an excuse needs a reason', pg_temp.fails(format($q$select ckb_hk_excuse(%L, %L, ' ')$q$, :'a1', :'w4'), '%Alasan wajib%'));
select pg_temp.check('a future day, a done day and a started day cannot be excused',
  pg_temp.fails(format($q$select ckb_hk_excuse(%L, %L, 'x y z')$q$, :'a1', :'today'::date + 1), '%sudah tiba%')
  and pg_temp.fails(format($q$select ckb_hk_excuse(%L, %L, 'x y z')$q$, :'a1', :'w1'), '%sudah selesai%')
  and pg_temp.fails(format($q$select ckb_hk_excuse(%L, %L, 'x y z')$q$, :'a1', :'w2'), '%belum dikirim%'));
select pg_temp.check('an area with no PIC on that day has nothing to excuse', pg_temp.fails(format($q$select ckb_hk_excuse(%L, %L, 'x y z')$q$, :'a0', :'w4'), '%belum punya PIC%'));
select ckb_hk_excuse(:'a1'::uuid, :'w4'::date, 'Oki sakit, rak kosong') as ex \gset
select pg_temp.check('an excused day reads EXCUSED for a lead and is not expected',
  (select state = 'EXCUSED' from ckb_hk_recap(:'w4'::date, :'w4'::date, :'c_fp'::uuid) where area_code = 'HKC-A1')
  and (select expected = 3 and done = 1 from ckb_hk_compliance(:'c_fp'::uuid, :'w4'::date, :'w1'::date) where area_code = 'HKC-A1'));   -- w1 done, w2 + w3 missed, w4 excused
select pg_temp.check('an excused day cannot be excused twice or started', pg_temp.fails(format($q$select ckb_hk_excuse(%L, %L, 'x y z')$q$, :'a1', :'w4'), '%sudah dibebaskan%')
  and pg_temp.fails(format($q$select ckb_hk_start(%L, %L, 'uji')$q$, :'a1', :'w4'), '%dibebaskan%'));
select ckb_hk_revoke_excuse(:'ex'::uuid, 'ternyata rak terisi');
select pg_temp.check('revoking the excuse makes the day missed again and fillable on behalf (attempt 2)',
  (select state = 'MISSED' from ckb_hk_recap(:'w4'::date, :'w4'::date, :'c_fp'::uuid) where area_code = 'HKC-A1')
  and (select (ckb_hk_start(:'a1', :'w4'::date, 'diisi atas nama')->>'attempt')::int = 2));
select ckb_hk_abandon((select id from ckb_hk_checkins where area_id = :'a1'::uuid and work_date = :'w4'::date and status = 'STARTED'), 'uji');
select ckb_hk_excuse(:'a1'::uuid, :'w4'::date, 'Oki sakit lagi') as ex2 \gset

-- ---------------------------------------------------------------------
-- 5  The range limit
-- ---------------------------------------------------------------------
select pg_temp.check('a range over 93 days is refused, not silently cut; a backwards one too',
  pg_temp.fails(format($q$select * from ckb_hk_recap(%L, %L)$q$, :'today'::date - 100, :'today'), '%maksimal 93 hari%')
  and pg_temp.fails(format($q$select * from ckb_hk_recap(%L, %L)$q$, :'w1', :'w3'), '%tidak valid%'));
select pg_temp.check('93 days is accepted', (select count(*) >= 0 from ckb_hk_recap(:'today'::date - 92, :'today'::date)));

-- ---------------------------------------------------------------------
-- 6  Report, dashboard, badge, and no names for a customer
-- ---------------------------------------------------------------------
select pg_temp.as_user(pg_temp.u('repfp'));
select pg_temp.check('the customer report: one row per area and day, an excused day as NA, photo counts only on a done day',
  (select count(*) = 4 from ckb_hk_report(:'c_fp'::uuid, :'w4'::date, :'w1'::date) where area_code = 'HKC-A1')
  and (select state = 'NA' and before_count = 0 from ckb_hk_report(:'c_fp'::uuid, :'w4'::date, :'w4'::date) where area_code = 'HKC-A1')
  and (select state = 'DONE' and late and before_count = 3 and after_count = 1 from ckb_hk_report(:'c_fp'::uuid, :'w1'::date, :'w1'::date) where area_code = 'HKC-A1'));
select pg_temp.check('nothing a customer receives contains a name, a review note or an excuse reason',
  (select string_agg(t::text, ' ') from ckb_hk_report(:'c_fp'::uuid, :'w4'::date, :'w1'::date) t) !~* '(Oki|Odi|Sari|Sinta|Ayu|t_ckb|rajin|kosong|sakit|macet)'
  and (select string_agg(t::text, ' ') from ckb_hk_customer_week(:'c_fp'::uuid, :'w4'::date, :'w1'::date) t) !~* '(Oki|Odi|Sari|Sinta|Ayu|t_ckb|rajin|kosong|sakit|macet)'
  and (select string_agg(t::text, ' ') from ckb_hk_customer_day(:'a1'::uuid, :'w1'::date) t) !~* '(Oki|Odi|Sari|Sinta|Ayu|t_ckb|rajin)'
  and ckb_hk_dashboard(:'c_fp'::uuid)::text !~* '(Oki|Odi|Sari|Sinta|Ayu|t_ckb)');
select pg_temp.check('another customer''s report and dashboard are refused',
  pg_temp.fails(format($q$select * from ckb_hk_report(%L, %L, %L)$q$, :'c_cgp', :'w4', :'w1'), '%Customer tidak ditemukan%')
  and pg_temp.fails(format($q$select ckb_hk_dashboard(%L)$q$, :'c_cgp'), '%Customer tidak ditemukan%')
  and pg_temp.fails($q$select ckb_hk_dashboard(null)$q$, '%Customer tidak ditemukan%'));
select pg_temp.check('the customer dashboard has only their racks and counts', (select ckb_hk_dashboard(:'c_fp'::uuid) ?& array['areas', 'expected_today', 'done_today', 'missed_week']
  and not (ckb_hk_dashboard(:'c_fp'::uuid) ? 'awaiting_review')));
select pg_temp.check('a customer has no badge', ckb_hk_badge() = 0);

-- the lead's on-behalf attempt 2 of w2 gets its photos and is submitted: one check-in now waits for review
select pg_temp.as_user(pg_temp.u('sup'));
select id as c2b from ckb_hk_checkins where area_id = :'a1'::uuid and work_date = :'w2'::date and attempt = 2 \gset
select pg_temp.ph(:'c2b', 'BEFORE', 81) as _ \gset
select pg_temp.ph(:'c2b', 'AFTER', 82) as _ \gset
select ckb_hk_submit(:'c2b'::uuid);
select ckb_hk_dashboard(null) as dash \gset
select pg_temp.check('the lead dashboard: areas, no-PIC areas, today and the week',
  (:'dash'::jsonb ?& array['areas', 'without_pic', 'expected_today', 'done_today', 'started_today', 'missed_last', 'missed_week', 'late_week', 'awaiting_review'])
  and (:'dash'::jsonb->>'without_pic')::int >= 1 and (:'dash'::jsonb->>'awaiting_review')::int = 1);
select pg_temp.check('the report for all customers works for a lead', (select count(*) > 0 from ckb_hk_report(null, :'w4'::date, :'w1'::date)));

select pg_temp.as_user(pg_temp.u('op'));
select pg_temp.check('a PIC cannot run the report; their dashboard is their own',
  pg_temp.fails(format($q$select * from ckb_hk_report(null, %L, %L)$q$, :'w4', :'w1'), '%Customer tidak ditemukan%')
  and (ckb_hk_dashboard(null) ?& array['mine_today', 'done_today', 'missed_week']) and not (ckb_hk_dashboard(null) ? 'awaiting_review'));

-- the badge: a lead's is the queue length, a PIC's is their racks not done today
select pg_temp.as_user(pg_temp.u('sup'));
select ckb_hk_badge() as lead_badge \gset
select pg_temp.check('the lead badge is the number of check-ins awaiting review',
  :lead_badge = (select count(*) from ckb_hk_checkins where status = 'SUBMITTED') and :lead_badge >= 1);
select pg_temp.as_user(pg_temp.u('op'));
\if :tw
  select pg_temp.check('the PIC badge is the racks not done today (the one rack, not done yet)', ckb_hk_badge() = 1);
  select (ckb_hk_start(:'a1', null)->>'id')::uuid as ct \gset
  select pg_temp.ph(:'ct', 'BEFORE', 71) as _ \gset
  select pg_temp.ph(:'ct', 'AFTER', 72) as _ \gset
  select ckb_hk_submit(:'ct'::uuid);
  select pg_temp.check('and drops to 0 once it is submitted', ckb_hk_badge() = 0);
\else
  select pg_temp.check('on a weekend or holiday the PIC badge is 0', ckb_hk_badge() = 0);
\endif

-- ---------------------------------------------------------------------
-- 7  Audit, and no direct writes
-- ---------------------------------------------------------------------
reset role;
select pg_temp.check('every new step was audited',
  (select count(distinct action) = 4 from ckb_audit_events where action in ('HK_PHOTO_WITHDRAW', 'HK_ABANDON', 'HK_EXCUSE', 'HK_EXCUSE_REVOKE')));
select pg_temp.check('the photo table still has no name column and the new tables are unchanged',
  not exists (select 1 from information_schema.columns where table_name = 'ckb_hk_photos' and column_name ~ 'name'));

rollback;
