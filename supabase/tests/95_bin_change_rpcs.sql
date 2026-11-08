-- Rak & Lokasi (0132): block, not-present and lend-to-CKB actions with their preview; ABC / capacity.
-- Runs in a transaction and rolls back. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users values
  ('a9511111-1111-1111-1111-111111111111','adm95@x','{"name":"Admin 95"}'),
  ('a9522222-2222-2222-2222-222222222222','sup95@x','{"name":"Sup 95"}'),
  ('a9533333-3333-3333-3333-333333333333','op95@x','{"name":"Op 95"}') on conflict do nothing;
update profiles set role = 'admin' where id = 'a9511111-1111-1111-1111-111111111111';
update profiles set role = 'supervisor' where id = 'a9522222-2222-2222-2222-222222222222';
update profiles set role = 'operator' where id = 'a9533333-3333-3333-3333-333333333333';
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when coalesce(ok, false) then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.fails(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then
  if sqlerrm not like p_like then raise notice 'got: %', sqlerrm; end if;
  return sqlerrm like p_like; end $$;
create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', p::text, true); end $$;
grant execute on function pg_temp.check(text, boolean), pg_temp.fails(text, text), pg_temp.as_user(uuid) to authenticated;

-- Fixture bins: CA41A01/02 empty, CA41B01 empty but a pickface, CA41B02 holds stock.
insert into bins (bin_code, zone, rack, level, position) values
  ('CA41A01','CA','41','A','01'), ('CA41A02','CA','41','A','02'), ('CA41B01','CA','41','B','01'), ('CA41B02','CA','41','B','02');
insert into pickfaces (item_id, bin_id) values ((select id from items where sku = '550058593'), (select id from bins where bin_code = 'CA41B01'))
  on conflict (item_id) do update set bin_id = excluded.bin_id;
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note, reason_code)
values ('adjustment', (select id from items where sku = '550070612'), 'T95', 12, (select id from bins where bin_code = 'CA41B02'), '2030-09-10', 'uji 95', 'FOUND');
create temp table r95 (k text primary key, v jsonb);
grant all on r95 to authenticated;

set role authenticated;
select pg_temp.as_user('a9522222-2222-2222-2222-222222222222');
select pg_temp.check('a reason is required',
  pg_temp.fails($q$select apply_bin_change(array['CA41A01'], 'STATE', 'BLOCKED', ' ', 'Sup')$q$, '%Alasan%'));
select pg_temp.check('a name is required',
  pg_temp.fails($q$select apply_bin_change(array['CA41A01'], 'STATE', 'BLOCKED', 'rak penyok', '')$q$, '%Nama%'));

select pg_temp.as_user('a9533333-3333-3333-3333-333333333333');
select pg_temp.check('an operator cannot block',
  pg_temp.fails($q$select apply_bin_change(array['CA41A01'], 'STATE', 'BLOCKED', 'rak penyok', 'Op')$q$, '%supervisor%'));

select pg_temp.as_user('a9522222-2222-2222-2222-222222222222');
insert into r95 select 'b', apply_bin_change(array['CA41A01'], 'STATE', 'BLOCKED', 'rak penyok', 'Sup');
insert into r95 select 'u', apply_bin_change(array['CA41A01'], 'STATE', 'ACTIVE', 'sudah diperbaiki', 'Sup');
select pg_temp.check('a supervisor blocks an empty bin and unblocks it: two change sets, two history rows',
  (select (v->>'changed')::int = 1 from r95 where k = 'b') and (select (v->>'changed')::int = 1 from r95 where k = 'u')
  and (select count(*) = 2 and count(distinct change_set) = 2 from bin_changes where bin_code = 'CA41A01')
  and (select status = 'active' and block_kind is null and block_reason is null from bins where bin_code = 'CA41A01')
  and exists (select 1 from bin_changes where bin_code = 'CA41A01' and old_value = 'ACTIVE' and new_value = 'BLOCKED'
              and reason = 'rak penyok' and changed_by_name = 'Sup'));
select pg_temp.check('a supervisor cannot mark a bin NOT_PRESENT',
  pg_temp.fails($q$select apply_bin_change(array['CA41A01'], 'STATE', 'NOT_PRESENT', 'tiang', 'Sup')$q$, '%admin%'));
select pg_temp.check('a supervisor cannot lend a rack to CKB',
  pg_temp.fails($q$select apply_bin_change(array['CA41A01'], 'OWNER', 'CKB', 'pinjam', 'Sup')$q$, '%admin%'));
select pg_temp.check('blocking a bin with stock is refused with its SKU',
  (select not ok and reason like '%12 karton 550070612%' from bin_change_preview(array['CA41B02'], 'STATE', 'BLOCKED')));

-- Mixed selection: the empty one changes, the pickface and the stocked one are listed.
insert into r95 select 'p', (select jsonb_agg(jsonb_build_object('bin_code', bin_code, 'ok', ok, 'reason', reason) order by bin_code)
                            from bin_change_preview(array['CA41A02', 'CA41B01', 'CA41B02', 'XX99Z99'], 'STATE', 'BLOCKED'));
insert into r95 select 'm', apply_bin_change(array['CA41A02', 'CA41B01', 'CA41B02', 'XX99Z99'], 'STATE', 'BLOCKED', 'perbaikan rak', 'Sup');
select pg_temp.check('mixed selection changes only the accepted bins, preview = result',
  (select (v->>'changed')::int = 1 from r95 where k = 'm')
  and (select status = 'blocked' from bins where bin_code = 'CA41A02')
  and (select status = 'active' from bins where bin_code = 'CA41B01')
  and (select v->'refused' from r95 where k = 'm') @> '[{"bin_code":"CA41B01"},{"bin_code":"CA41B02"},{"bin_code":"XX99Z99"}]'
  and (select jsonb_array_length(v->'refused') = 3 from r95 where k = 'm')
  and (select v from r95 where k = 'p') @> '[{"bin_code":"CA41A02","ok":true},{"bin_code":"CA41B01","ok":false},{"bin_code":"CA41B02","ok":false},{"bin_code":"XX99Z99","ok":false}]'
  and (select (select reason from jsonb_to_recordset(v) as x(bin_code text, ok boolean, reason text) where bin_code = 'CA41B01') like 'pickface%'
       from r95 where k = 'p'));
select pg_temp.check('a bin already blocked is not counted again',
  (select not ok and reason like 'sudah%' from bin_change_preview(array['CA41A02'], 'STATE', 'BLOCKED')));

-- Review fix: a whole aisle with pillars selected. Blokir / Buka blokir never touch a pillar.
select pg_temp.check('Blokir refuses a pillar in the selection (supervisor, no error)',
  (select not ok and reason like 'tidak ada%' from bin_change_preview(array['CE33A01'], 'STATE', 'BLOCKED')));
select pg_temp.check('Buka blokir refuses a pillar in the selection',
  (select not ok and reason like 'tidak ada%' from bin_change_preview(array['CE33A01'], 'STATE', 'ACTIVE')));
insert into r95 select 'ce', apply_bin_change(array['CE33A01', 'CE33A02', 'CA41A02'], 'STATE', 'ACTIVE', 'buka aisle', 'Sup');
select pg_temp.check('a mixed Buka blokir changes the blocked bin and leaves the pillars as they are',
  (select (v->>'changed')::int = 1 from r95 where k = 'ce')
  and (select bool_and(block_kind = 'NOT_PRESENT') from bins where bin_code in ('CE33A01', 'CE33A02')));
select pg_temp.check('Tandai ada lagi is admin only',
  pg_temp.fails($q$select apply_bin_change(array['CE33A01'], 'STATE', 'PRESENT', 'salah', 'Sup')$q$, '%admin%'));
select pg_temp.as_user('a9511111-1111-1111-1111-111111111111');
select pg_temp.check('owner change refused while stock is in the bin',
  (select not ok and reason like '%karton%' from bin_change_preview(array['CA41B02'], 'OWNER', 'CKB')));
select apply_bin_change(array['CA41A01'], 'OWNER', 'CKB', 'dipinjam CKB untuk 3 bulan', 'Adm') \g /dev/null
select pg_temp.check('admin lends an empty rack to CKB',
  (select owner = 'CKB' from bins where bin_code = 'CA41A01') and not bin_usable((select id from bins where bin_code = 'CA41A01'))
  and bin_usable((select id from bins where bin_code = 'CA41A01'), 'CKB'));
select apply_bin_change(array['CA41A01'], 'OWNER', 'SHELL', 'kembali ke Shell', 'Adm') \g /dev/null
select pg_temp.check('and takes it back',
  (select owner = 'SHELL' from bins where bin_code = 'CA41A01')
  and (select count(*) = 2 from bin_changes where bin_code = 'CA41A01' and field = 'OWNER'));
select pg_temp.check('a floor location has no owner to change',
  (select not ok and reason like '%lantai%' from bin_change_preview(array['STAGING'], 'OWNER', 'CKB')));
select apply_bin_change(array['CA41A01'], 'STATE', 'NOT_PRESENT', 'ternyata tiang', 'Adm') \g /dev/null
select pg_temp.check('an admin marks a bin NOT_PRESENT',
  (select block_kind = 'NOT_PRESENT' and block_reason = 'ternyata tiang' from bins where bin_code = 'CA41A01'));
select pg_temp.check('Tandai ada lagi refuses a bin that is not a pillar',
  (select not ok and reason like 'bukan bin tidak ada%' from bin_change_preview(array['CA41A02'], 'STATE', 'PRESENT')));
select apply_bin_change(array['CA41A01'], 'STATE', 'PRESENT', 'ternyata ada rak', 'Adm') \g /dev/null
select pg_temp.check('an admin brings a pillar back with Tandai ada lagi',
  (select status = 'active' and block_kind is null from bins where bin_code = 'CA41A01')
  and exists (select 1 from bin_changes where bin_code = 'CA41A01' and old_value = 'NOT_PRESENT' and new_value = 'ACTIVE'));
select pg_temp.as_user('a9522222-2222-2222-2222-222222222222');

insert into r95 select 'a', set_bin_attrs(array['CA41A02', 'CA41B01'], 'A', 2, 'rak dekat dock', 'Sup');
select pg_temp.check('set_bin_attrs sets ABC and capacity and logs ATTR rows',
  (select bool_and(abc_class = 'A' and capacity = 2) from bins where bin_code in ('CA41A02', 'CA41B01'))
  and (select count(*) = 2 from bin_changes where field = 'ATTR' and bin_code in ('CA41A02', 'CA41B01')));
select pg_temp.check('set_bin_attrs needs something to change',
  pg_temp.fails($q$select set_bin_attrs(array['CA41A02'], null, null, 'x', 'Sup')$q$, '%Pilih%'));
reset role;
rollback;
