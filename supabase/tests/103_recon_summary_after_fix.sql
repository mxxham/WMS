-- Rekonsiliasi SAP (0139): a line corrected from Investigasi selisih no longer counts as a gap.
-- Runs in a transaction and rolls back. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when coalesce(ok, false) then 'PASS' else 'FAIL' end, label; end $$;

-- diff = SAP - WMS, so "WMS holds 310 more" is diff -310; our side reads +310.
select pg_temp.check('no correction: the day''s gap, read from our side',
  (select gap_unrestricted = 310 and gap_blocked = 0 from recon_line_open(-310, 0, 0)));
select pg_temp.check('+310 corrected by -310 is closed',
  (select gap_unrestricted = 0 and gap_blocked = 0 from recon_line_open(-310, 0, -310)));
select pg_temp.check('a partial correction leaves the rest',
  (select gap_unrestricted = 110 and gap_blocked = 0 from recon_line_open(-310, 0, -200)));
select pg_temp.check('a correction past zero turns the gap around',
  (select gap_unrestricted = -10 and gap_blocked = 0 from recon_line_open(-310, 0, -320)));
select pg_temp.check('a blocked-only gap is closed by its correction, not turned into free vs blocked',
  (select gap_unrestricted = 0 and gap_blocked = 0 from recon_line_open(0, -5, -5)));
select pg_temp.check('free first, then blocked',
  (select gap_unrestricted = 0 and gap_blocked = -1 from recon_line_open(4, 3, 6)));
select pg_temp.check('a correction on a line that matched opens a gap',
  (select gap_unrestricted = 7 and gap_blocked = 0 from recon_line_open(0, 0, 7)));

insert into stock_recons (as_of, file_name, created_by_name) values (current_date - 1, 'MB52 uji103', 'Uji');
insert into stock_recon_lines (recon_id, sku, sap_unrestricted, wms_unrestricted, wms_fix, status)
select r.id, v.sku, v.sap, v.wms, v.fix, v.status
from stock_recons r, (values
  ('T103-A', 100, 100,    0, 'OPEN'),       -- matches
  ('T103-B', 1601, 1911, -310, 'RESOLVED'), -- +310, corrected by -310
  ('T103-C', 50, 40,      0, 'OPEN'),       -- 10 short, untouched
  ('T103-D', 20, 32,     -4, 'RESOLVED')    -- +12, corrected by -4: 8 left
) v(sku, sap, wms, fix, status) where r.file_name = 'MB52 uji103';

select pg_temp.check('the line keeps the day''s numbers',
  (select diff_unrestricted = -310 and wms_unrestricted = 1911 from stock_recon_lines where sku = 'T103-B'));
select pg_temp.check('summary: the corrected line counts as a match',
  (select skus = 4 and skus_match = 2 and accuracy_pct = 50.00 from stock_recon_summary where file_name = 'MB52 uji103'));
select pg_temp.check('summary: more / less read what is left (8 more on one SKU, 10 less on one)',
  (select skus_wms_more = 1 and qty_wms_more = 8 and skus_wms_less = 1 and qty_wms_less = 10 and abs_diff = 18
   from stock_recon_summary where file_name = 'MB52 uji103'));
select pg_temp.check('summary: only the untouched gap is still open',
  (select open_diffs = 1 from stock_recon_summary where file_name = 'MB52 uji103'));
select pg_temp.check('summary: the totals stay the day''s stock',
  (select sap_total = 1771 and wms_total = 2083 from stock_recon_summary where file_name = 'MB52 uji103'));

rollback;
