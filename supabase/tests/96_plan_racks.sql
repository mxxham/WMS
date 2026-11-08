-- Rak & Lokasi (0132): plan new racks as Rencana, activate them when built, cancel unused plans.
-- Runs in a transaction and rolls back. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users values
  ('a9611111-1111-1111-1111-111111111111','adm96@x','{"name":"Admin 96"}'),
  ('a9622222-2222-2222-2222-222222222222','sup96@x','{"name":"Sup 96"}') on conflict do nothing;
update profiles set role = 'admin' where id = 'a9611111-1111-1111-1111-111111111111';
update profiles set role = 'supervisor' where id = 'a9622222-2222-2222-2222-222222222222';
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when coalesce(ok, false) then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.fails(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then
  if sqlerrm not like p_like then raise notice 'got: %', sqlerrm; end if;
  return sqlerrm like p_like; end $$;
create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', p::text, true); end $$;
grant execute on function pg_temp.check(text, boolean), pg_temp.fails(text, text), pg_temp.as_user(uuid) to authenticated;
create temp table r96 (k text primary key, v jsonb);
grant all on r96 to authenticated;

set role authenticated;
select pg_temp.as_user('a9622222-2222-2222-2222-222222222222');
select pg_temp.check('a supervisor cannot plan racks',
  pg_temp.fails($q$select plan_racks('CI', 10, array['A','B','C','D'], 'SHELL', 'rak baru', 'Sup')$q$, '%admin%'));

select pg_temp.as_user('a9611111-1111-1111-1111-111111111111');
select pg_temp.check('levels must start at A and be contiguous',
  pg_temp.fails($q$select plan_racks('CI', 10, array['B','C'], 'SHELL', 'x', 'Adm')$q$, 'Level%')
  and pg_temp.fails($q$select plan_racks('CI', 10, array['A','C'], 'SHELL', 'x', 'Adm')$q$, 'Level%'));
select pg_temp.check('bays per face between 1 and 20, aisle like CI',
  pg_temp.fails($q$select plan_racks('CI', 21, array['A'], 'SHELL', 'x', 'Adm')$q$, '%1-20%')
  and pg_temp.fails($q$select plan_racks('XI', 2, array['A'], 'SHELL', 'x', 'Adm')$q$, '%aisle%'));
select pg_temp.check('the preview lists the codes first',
  (select count(*) = 160 and bool_and(not exists) from plan_racks_preview('CI', 10, array['A','B','C','D'], 'SHELL')));

insert into r96 select 'p', plan_racks('CI', 10, array['A','B','C','D'], 'SHELL', 'rak baru 2027', 'Adm');
reset role;
select pg_temp.check('plan CI, 10 bays, levels A-D: 160 planned bins, racks 01-10 and 21-30',
  (select (v->>'created')::int = 160 and (v->>'existing')::int = 0 from r96 where k = 'p')
  and (select count(*) = 160 and bool_and(status = 'blocked' and block_kind = 'PLANNED' and owner = 'SHELL' and pos_x is not null)
       from bins where zone = 'CI')
  and exists (select 1 from bins where bin_code = 'CI01A01') and exists (select 1 from bins where bin_code = 'CI30D02')
  and not exists (select 1 from bins where bin_code in ('CI11A01', 'CI31A01', 'CI01E01')));
select pg_temp.check('the aisle joins the layout, last',
  (select value->'aisle_order'->>(jsonb_array_length(value->'aisle_order') - 1) = 'CI' from settings where key = 'layout'));
select pg_temp.check('one CREATED history row per bin, one change set',
  (select count(*) = 160 and count(distinct change_set) = 1 from bin_changes where field = 'CREATED' and bin_code like 'CI%'));
select pg_temp.check('planned bins are not usable and stock cannot enter',
  not bin_usable((select id from bins where bin_code = 'CI01A01'))
  and pg_temp.fails($q$insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, reason_code, note, by_name)
                       values ('adjustment', (select id from items where sku = '550058593'), 'T96', 1,
                               (select id from bins where bin_code = 'CI01A01'), '2030-01-01', 'FOUND', 'uji 96', 'Uji')$q$, '%belum dibangun%'));

set role authenticated;
select pg_temp.as_user('a9611111-1111-1111-1111-111111111111');
insert into r96 select 'q', plan_racks('CI', 12, array['A','B','C','D'], 'SHELL', 'tambah 2 bay', 'Adm');
select pg_temp.check('plan_racks on a partial aisle creates only the missing codes',
  (select (v->>'created')::int = 32 and (v->>'existing')::int = 160 from r96 where k = 'q')
  and (select count(*) = 192 from bins where zone = 'CI'));
select pg_temp.check('planning only existing codes is refused',
  pg_temp.fails($q$select plan_racks('CI', 12, array['A','B','C','D'], 'SHELL', 'lagi', 'Adm')$q$, '%sudah ada%'));
select pg_temp.check('the state actions leave a planned bin to Aktifkan',
  (select not ok and reason like 'Rencana%' from bin_change_preview(array['CI01A01'], 'STATE', 'BLOCKED')));

insert into r96 select 'a', activate_planned(array['CI01A01', 'CI01A02', 'CA01A01'], 'rak CI01 sudah berdiri', 'Adm');
select pg_temp.check('activate makes them usable and refuses a bin that is not planned',
  (select (v->>'changed')::int = 2 and v->'refused' @> '[{"bin_code":"CA01A01"}]' from r96 where k = 'a')
  and bin_usable((select id from bins where bin_code = 'CI01A01')));

insert into r96 select 'c', cancel_planned(array['CI01A01', 'CI02A01'], 'salah rencana', 'Adm');
select pg_temp.check('cancel refuses an activated bin and removes an unreferenced planned one',
  (select (v->>'changed')::int = 1 and v->'refused' @> '[{"bin_code":"CI01A01"}]' from r96 where k = 'c')
  and not exists (select 1 from bins where bin_code = 'CI02A01')
  and exists (select 1 from bin_changes where bin_code = 'CI02A01' and field = 'REMOVED'));

-- Cancel everything left: the aisle leaves the layout once no bin of it remains.
select activate_planned(array['CI01A02'], 'x', 'Adm') \g /dev/null
reset role;
delete from bins where bin_code in ('CI01A01', 'CI01A02');
set role authenticated;
select pg_temp.as_user('a9611111-1111-1111-1111-111111111111');
select cancel_planned((select array_agg(bin_code) from bins where zone = 'CI'), 'batal semua', 'Adm') \g /dev/null
select pg_temp.check('cancelling the last bins removes the aisle from aisle_order',
  not exists (select 1 from bins where zone = 'CI')
  and (select not (value->'aisle_order' ? 'CI') from settings where key = 'layout'));
insert into r96 select 'j', plan_racks('CJ', 1, array['A'], 'CKB', 'area CKB', 'Adm');
select pg_temp.check('a CKB aisle can be planned too',
  (select (v->>'created')::int = 4 from r96 where k = 'j')
  and (select count(*) = 4 and bool_and(owner = 'CKB') from bins where zone = 'CJ'));
reset role;
rollback;
