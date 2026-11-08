-- Rak & Lokasi (0132): bin state + owner, the change history, bin_usable, today's data.
-- Runs in a transaction and rolls back. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users values ('22222222-2222-2222-2222-222222222222','sup@x','{"name":"Supervisor"}') on conflict do nothing;
update profiles set role = 'admin' where id = '22222222-2222-2222-2222-222222222222';
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when coalesce(ok, false) then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.fails(p_sql text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return true; end $$;
grant execute on function pg_temp.check(text, boolean), pg_temp.fails(text) to authenticated;

select pg_temp.check('phantoms are NOT_PRESENT (CE33 all, CE32 pos 02, CE34 pos 01)',
  (select count(*) from bins where status = 'blocked' and block_kind = 'NOT_PRESENT'
     and bin_code ~ '^(CE33[A-E]0[12]|CE32[A-E]02|CE34[A-E]01)$') = 20);
select pg_temp.check('CG and CH are CKB',
  (select bool_and(owner = 'CKB') and count(*) > 0 from bins where zone in ('CG', 'CH') and rack is not null));
select pg_temp.check('CF21-CF40 level A is CKB and active again',
  (select count(*) from bins where bin_code ~ '^CF(2[1-9]|3[0-9]|40)A0[12]$' and owner = 'CKB' and status = 'active') = 40);
select pg_temp.check('other racks are SHELL',
  not exists (select 1 from bins where rack is not null and zone not in ('CG', 'CH')
              and bin_code !~ '^CF(2[1-9]|3[0-9]|40)A0[12]$' and owner is distinct from 'SHELL'));
select pg_temp.check('floor locations have no owner',
  not exists (select 1 from bins where rack is null and owner is not null)
  and exists (select 1 from bins where rack is null));
insert into bins (bin_code, zone, rack, level, position) values ('CA41A01', 'CA', '41', 'A', '01'), ('STG_99', 'STAGING', null, null, '99');
select pg_temp.check('a new rack bin defaults to SHELL, a floor location to no owner',
  (select owner = 'SHELL' from bins where bin_code = 'CA41A01') and (select owner is null from bins where bin_code = 'STG_99'));
update bins set status = 'blocked' where bin_code = 'CA41A01';
select pg_temp.check('blocking without a kind becomes BLOCKED',
  (select block_kind = 'BLOCKED' from bins where bin_code = 'CA41A01'));
update bins set status = 'active' where bin_code = 'CA41A01';
select pg_temp.check('activating clears the kind',
  (select block_kind is null from bins where bin_code = 'CA41A01'));
select pg_temp.check('state and kind cannot disagree',
  pg_temp.fails($q$update bins set block_kind = 'NOT_PRESENT' where bin_code = 'CA41A01'$q$));
select pg_temp.check('bin_usable: a Shell rack bin',
  bin_usable((select id from bins where bin_code = 'CA01A01')) and not bin_usable((select id from bins where bin_code = 'CA01A01'), 'CKB'));
select pg_temp.check('bin_usable: a CKB rack bin',
  not bin_usable((select id from bins where bin_code = 'CF21A01')) and bin_usable((select id from bins where bin_code = 'CF21A01'), 'CKB'));
select pg_temp.check('bin_usable: floor locations are shared, pillars are nobody''s',
  bin_usable((select id from bins where bin_code = 'STAGING')) and bin_usable((select id from bins where bin_code = 'STAGING'), 'CKB')
  and not bin_usable((select id from bins where bin_code = 'CE33A01'))
  and not bin_usable((select id from bins where bin_code = 'CE33A01'), 'CKB'));
select pg_temp.check('bin_state names the four states',
  bin_state('active', null) = 'ACTIVE' and bin_state('blocked', 'BLOCKED') = 'BLOCKED'
  and bin_state('blocked', 'NOT_PRESENT') = 'NOT_PRESENT' and bin_state('blocked', 'PLANNED') = 'PLANNED');
select pg_temp.check('history recorded: 20 pillars in one change set',
  (select count(*) = 20 and count(distinct change_set) = 1 from bin_changes
   where changed_by_name = 'migrasi 0132' and field = 'STATE' and new_value = 'NOT_PRESENT'));
select pg_temp.check('history recorded: every CKB rack bin in one change set',
  (select count(*) = (select count(*) from bins where owner = 'CKB') and count(distinct change_set) = 1 from bin_changes
   where changed_by_name = 'migrasi 0132' and field = 'OWNER' and new_value = 'CKB'));
select pg_temp.check('history is append-only',
  pg_temp.fails($q$update bin_changes set reason = 'x'$q$) and pg_temp.fails($q$delete from bin_changes$q$));

-- Read side (section 5).
select pg_temp.check('occupancy excludes CKB, blocked, not present and planned bins',
  (dashboard_summary()->'bins'->>'rack_total')::int
    = (select count(*) from bins where rack is not null and status = 'active' and owner = 'SHELL')
  and not exists (select 1 from jsonb_array_elements(dashboard_summary()->'zones') z where z->>'zone' in ('CG', 'CH')));
select pg_temp.check('the dashboard counts CKB, not present and planned apart',
  (dashboard_summary()->'bins'->>'ckb')::int = (select count(*) from bins where owner = 'CKB')
  and (dashboard_summary()->'bins'->>'not_present')::int = 20
  and (dashboard_summary()->'bins'->>'planned')::int = 0
  and dashboard_summary()->'planned' = '[]'::jsonb);
select pg_temp.check('the dashboard Diblokir counts only blocked bins, not pillars or plans',
  (dashboard_summary()->'bins'->>'blocked')::int = (select count(*) from bins where block_kind = 'BLOCKED'));
select pg_temp.check('empty_bins has no CKB, pillar or planned bin',
  not exists (select 1 from empty_bins e join bins b on b.bin_code = e.bin_code where not bin_usable(b.id))
  and not exists (select 1 from empty_bins where bin_code in ('CE32A02', 'CE33A01', 'CG01A01', 'CF21A01')));
select pg_temp.check('bin_summary carries state and owner',
  (select block_kind = 'NOT_PRESENT' and owner = 'SHELL' from bin_summary where bin_code = 'CE33A01')
  and (select owner = 'CKB' from bin_summary where bin_code = 'CF21A01'));
select set_config('app.ckb_movement', 'on', true);
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note, reason_code, by_name)
values ('adjustment', (select id from items where sku = '550058593'), 'T93', 5, (select id from bins where bin_code = 'CG01A01'),
        '2030-01-01', 'uji 93', 'FOUND', 'Uji');
select set_config('app.ckb_movement', '', true);
select pg_temp.check('planning_stock reports a CKB rack as blocked for Shell',
  (select bool_and(bin_status = 'blocked') from planning_stock(current_date) where bin_code = 'CG01A01')
  and exists (select 1 from planning_stock(current_date) where bin_code = 'CG01A01'));

set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select plan_racks('CI', 1, array['A'], 'SHELL', 'uji', 'Uji') \g /dev/null
select pg_temp.check('the dashboard lists planned positions per aisle',
  dashboard_summary()->'planned' = '[{"zone":"CI","owner":"SHELL","positions":4}]'::jsonb
  and (dashboard_summary()->'bins'->>'planned')::int = 4);
update bins set status = 'blocked' where bin_code = 'CA01A01';
select pg_temp.check('no direct writes, not even by an admin',
  (select status = 'active' from bins where bin_code = 'CA01A01'));
select pg_temp.check('an account can read the history',
  (select count(*) > 0 from bin_changes));
reset role;
rollback;
