-- Investigasi selisih (0129): suspect bins, bin checks, the fix plan and applying it.
-- Runs in a transaction and rolls back. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when coalesce(ok, false) then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.fails(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then
  if sqlerrm not like p_like then raise notice 'got: %', sqlerrm; end if;
  return sqlerrm like p_like; end $$;
create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', p::text, true); end $$;
grant execute on function pg_temp.check(text, boolean), pg_temp.fails(text, text), pg_temp.as_user(uuid) to authenticated;

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('a9011111-1111-1111-1111-111111111111','inv90@pengguna.internal','{"name":"Inv"}','{"username":"t90inv"}'),
  ('a9022222-2222-2222-2222-222222222222','op90@pengguna.internal','{"name":"Op"}','{"username":"t90op"}'),
  ('a9033333-3333-3333-3333-333333333333','adm90@pengguna.internal','{"name":"Adm"}','{"username":"t90adm"}');
update profiles set job = 'admin' where id = 'a9033333-3333-3333-3333-333333333333';
update profiles set job = 'inventory' where id = 'a9011111-1111-1111-1111-111111111111';
update profiles set job = 'operator' where id = 'a9022222-2222-2222-2222-222222222222';

-- Three SKUs with no stock of their own, so the numbers are the test's.
delete from inventory v using items i where i.id = v.item_id and i.sku in ('550024919', '550024921', '550024929');
delete from stock_holds h using items i where i.id = h.item_id and i.sku in ('550024919', '550024921', '550024929');

-- X (550024919): a pallet of 48 in CC27D02 and 30 in CE10A02. The morning import then zeroed CC27D02
-- "(not in file)", but the pallet never left. SAP still says 78.
set role authenticated;
select pg_temp.as_user('a9033333-3333-3333-3333-333333333333');
select import_snapshot('[
 {"bin_code":"CC27D02","zone":"CC","rack":"27","level":"D","position":"02","sku":"550024919","batch_lot":"B48","quantity":48,"expiry_date":"2030-05-01"},
 {"bin_code":"CE10A02","zone":"CE","rack":"10","level":"A","position":"02","sku":"550024919","batch_lot":"B30","quantity":30,"expiry_date":"2030-06-01"},
 {"bin_code":"CC28A01","zone":"CC","rack":"28","level":"A","position":"01","sku":"550024921","batch_lot":"Y1","quantity":20,"expiry_date":"2030-07-01"},
 {"bin_code":"CC29A01","zone":"CC","rack":"29","level":"A","position":"01","sku":"550024929","batch_lot":"Z1","quantity":10,"expiry_date":"2030-08-01"}]'::jsonb, false, 'uji90') \g /dev/null
reset role;
select set_config('request.jwt.claim.sub', '', true) \g /dev/null
-- The next morning's import (an hour later than the snapshot above).
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note, created_at)
select 'adjustment', i.id, 'B48', -48, b.id, '2030-05-01', 'IMPORT pagi.xlsx (not in file)', now() + interval '1 hour'
from items i, bins b where i.sku = '550024919' and b.bin_code = 'CC27D02';

insert into stock_recons (as_of, file_name, created_by_name) values (current_date - 1, 'MB52 uji90', 'Uji');
insert into stock_recon_lines (recon_id, item_id, sku, sap_unrestricted, wms_unrestricted)
select r.id, i.id, i.sku, v.sap, v.wms
from stock_recons r, (values ('550024919', 78, 30), ('550024921', 20, 20), ('550024929', 10, 10)) v(sku, sap, wms)
join items i on i.sku = v.sku where r.file_name = 'MB52 uji90';
create temp table ln as
select l.sku, l.id from stock_recon_lines l join stock_recons r on r.id = l.recon_id where r.file_name = 'MB52 uji90';
grant select on ln to authenticated;

set role authenticated;
select pg_temp.as_user('a9022222-2222-2222-2222-222222222222');
select pg_temp.check('an operator cannot see the suspects',
  pg_temp.fails($q$select * from recon_suspect_bins((select id from ln where sku = '550024919'))$q$, '%Hanya supervisor atau admin%'));
select pg_temp.check('an operator cannot check a bin',
  pg_temp.fails($q$select recon_check_bin((select id from ln where sku = '550024919'), 'CC27D02', '[]', null, 'Op')$q$, '%Hanya supervisor atau admin%'));

select pg_temp.as_user('a9011111-1111-1111-1111-111111111111');
select pg_temp.check('the zeroed bin is the first suspect: emptied by the import, held exactly the difference (48)',
  (select bin_code from recon_suspect_bins((select id from ln where sku = '550024919')) limit 1) = 'CC27D02'
  and (select reasons @> array['EMPTIED','IMPORT_ZERO','QTY_MATCH'] and last_full = 48
       from recon_suspect_bins((select id from ln where sku = '550024919')) where bin_code = 'CC27D02'));
select pg_temp.check('the bin that still holds the SKU is a suspect too, and its neighbours are listed',
  exists (select 1 from recon_suspect_bins((select id from ln where sku = '550024919')) where bin_code = 'CE10A02' and 'CURRENT' = any(reasons))
  and exists (select 1 from recon_suspect_bins((select id from ln where sku = '550024919')) where kind = 'NEIGHBOUR' and neighbour_of = 'CC27D02'));

select pg_temp.check('found stock new to a bin needs its expiry',
  pg_temp.fails($q$select recon_check_bin((select id from ln where sku = '550024919'), 'CC27D01', '[{"batch_lot":"B48","quantity":5}]', null, 'Andi')$q$, '%Tanggal expired wajib%'));
select recon_check_bin((select id from ln where sku = '550024919'), 'cc27d02', '[{"batch_lot":"b48","expiry_date":"2030-05-01","quantity":48}]', 'palet utuh', 'Andi') \g /dev/null
select recon_check_bin((select id from ln where sku = '550024919'), 'CE10A02', '[{"batch_lot":"B30","expiry_date":"2030-06-01","quantity":30}]', null, 'Andi') \g /dev/null
select pg_temp.check('the plan: +48 FOUND in CC27D02, nothing for CE10A02, the gap closes, a second person is needed',
  (select jsonb_array_length(p->'adjustments') = 1 and jsonb_array_length(p->'transfers') = 0
          and p->'adjustments'->0->>'bin_code' = 'CC27D02' and (p->'adjustments'->0->>'quantity')::numeric = 48
          and (p->>'gap_before')::numeric = -48 and (p->>'gap_after')::numeric = 0 and (p->>'needs_other_person')::boolean
   from recon_fix_plan((select id from ln where sku = '550024919')) p));
select pg_temp.check('the person who checked cannot apply a fix above the limit',
  pg_temp.fails($q$select recon_apply_fix((select id from ln where sku = '550024919'), null, null, null, 'palet ketemu', 'Andi')$q$, '%harus diterapkan orang lain%'));
select recon_apply_fix((select id from ln where sku = '550024919'), null, null, null, 'palet ketemu', 'Budi') \g /dev/null
select pg_temp.check('another person applies: CC27D02 holds 48 again, as an approved FOUND adjustment',
  (select v.quantity from inventory v join bins b on b.id = v.bin_id join items i on i.id = v.item_id
    where b.bin_code = 'CC27D02' and i.sku = '550024919') = 48
  and exists (select 1 from movements m join recon_fixes f on f.id = m.ref_id
              where m.reason_code = 'FOUND' and m.quantity = 48 and m.by_name = 'Andi' and m.approved_by_name = 'Budi'));
select pg_temp.check('the line keeps the day''s numbers, gains wms_fix 48 and is resolved',
  (select wms_unrestricted = 30 and wms_fix = 48 and status = 'RESOLVED' and cause = 'COUNT'
   from stock_recon_lines where id = (select id from ln where sku = '550024919')));
select pg_temp.check('after the fix the old checks are spent: nothing left to apply',
  pg_temp.fails($q$select recon_apply_fix((select id from ln where sku = '550024919'), null, null, null, null, 'Budi')$q$, '%Tidak ada yang perlu dikoreksi%'));
reset role;
select pg_temp.check('checks and fixes cannot be edited, not even by the database owner',
  pg_temp.fails($q$update recon_checks set counted_qty = 0$q$, '%recon_checks%')
  and pg_temp.fails($q$delete from recon_fixes$q$, '%recon_fixes%'));
set role authenticated;
select pg_temp.as_user('a9011111-1111-1111-1111-111111111111');

-- Y (550024921): the system has 20 in CC28A01; the pallet really stands in CC28B01 (a Bin To Bin never booked).
select recon_check_bin((select id from ln where sku = '550024921'), 'CC28A01', '[]', 'kosong', 'Andi') \g /dev/null
select recon_check_bin((select id from ln where sku = '550024921'), 'CC28B01', '[{"batch_lot":"Y1","expiry_date":"2030-07-01","quantity":20}]', null, 'Andi') \g /dev/null
select pg_temp.check('a pallet in the wrong bin is one Bin To Bin, no adjustment',
  (select jsonb_array_length(p->'transfers') = 1 and jsonb_array_length(p->'adjustments') = 0
          and p->'transfers'->0->>'from_bin' = 'CC28A01' and p->'transfers'->0->>'to_bin' = 'CC28B01'
          and (p->>'net_adjust')::numeric = 0 and not (p->>'needs_other_person')::boolean
   from recon_fix_plan((select id from ln where sku = '550024921')) p));
select recon_apply_fix((select id from ln where sku = '550024921'), null, null, null, null, 'Andi') \g /dev/null
select pg_temp.check('the checker may apply a Bin To Bin; the stock moved and the cause is "salah lokasi"',
  (select v.quantity from inventory v join bins b on b.id = v.bin_id join items i on i.id = v.item_id
    where b.bin_code = 'CC28B01' and i.sku = '550024921') = 20
  and not exists (select 1 from inventory v join bins b on b.id = v.bin_id join items i on i.id = v.item_id
    where b.bin_code = 'CC28A01' and i.sku = '550024921')
  and (select cause = 'MISPLACED' and wms_fix = 0 from stock_recon_lines where id = (select id from ln where sku = '550024921')));

-- Z (550024929): 10 in CC29A01, 5 of them reserved by a wave; the bin is found empty.
select save_plan('2026-12-05', '{
  "waves":[{"wave_no":"90","shipment_numbers":["900000001"],"planned_slot":"08:00"}],
  "tasks":[{"wave_no":"90","shipment_number":"900000001","task_type":"PICK","sku":"550024929","from_bin":"CC29A01","batch_lot":"Z1","expiry_date":"2030-08-01","quantity":5,"pick_type":"CASE","seq":1}]}'::jsonb) \g /dev/null
select recon_check_bin((select id from ln where sku = '550024929'), 'CC29A01', '[]', null, 'Andi') \g /dev/null
select pg_temp.check('stock a wave reserved blocks the fix, with the wave named',
  (select jsonb_array_length(p->'blockers') = 1 and p->'blockers'->>0 like '%wave 90%' from recon_fix_plan((select id from ln where sku = '550024929')) p)
  and pg_temp.fails($q$select recon_apply_fix((select id from ln where sku = '550024929'), null, null, null, null, 'Budi')$q$, '%dipesan%'));

-- A check goes stale when the bin's stock of the SKU moves after it.
select recon_check_bin((select id from ln where sku = '550024919'), 'CE10A02', '[{"batch_lot":"B30","expiry_date":"2030-06-01","quantity":25}]', null, 'Andi') \g /dev/null
reset role;
select set_config('request.jwt.claim.sub', '', true) \g /dev/null
insert into movements (type, item_id, batch_lot, quantity, from_bin_id, expiry_date, note)
select 'picking', i.id, 'B30', 2, b.id, '2030-06-01', 'uji90 pick'
from items i, bins b where i.sku = '550024919' and b.bin_code = 'CE10A02';
set role authenticated;
select pg_temp.as_user('a9011111-1111-1111-1111-111111111111');
select pg_temp.check('a stale check is listed, never applied',
  (select jsonb_array_length(p->'stale') = 1 and jsonb_array_length(p->'adjustments') = 0 and jsonb_array_length(p->'transfers') = 0
   from recon_fix_plan((select id from ln where sku = '550024919')) p)
  and (select check_stale from recon_suspect_bins((select id from ln where sku = '550024919')) where bin_code = 'CE10A02'));

rollback;
