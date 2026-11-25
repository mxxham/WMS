-- Check preview (0156): recon_check_preview returns the plan a check would produce, stores nothing, and raises the
-- same errors as recon_check_bin. Runs in a transaction and rolls back. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users values
  ('a1161111-1111-1111-1111-111111111111','inv116@x','{"name":"Inv 116"}'),
  ('a1162222-2222-2222-2222-222222222222','opr116@x','{"name":"Opr 116"}') on conflict do nothing;
update profiles set job = 'inventory' where id = 'a1161111-1111-1111-1111-111111111111';
update profiles set job = 'operator' where id = 'a1162222-2222-2222-2222-222222222222';
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when coalesce(ok, false) then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.fails(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then
  if sqlerrm not like p_like then raise notice 'got: %', sqlerrm; end if;
  return sqlerrm like p_like; end $$;
create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', p::text, true); end $$;
grant execute on function pg_temp.check(text, boolean), pg_temp.fails(text, text), pg_temp.as_user(uuid) to authenticated;
create temp table r116 (k text primary key, v jsonb);
grant all on r116 to authenticated;

-- Fixture: 10 cartons of an existing SKU in an empty Shell rack bin; SAP says 0, so WMS holds more.
create temp table f116 as
  select (select id from items where sku = '550058593') as item_id,
         (select b.id from bins b where b.bin_code ~ '^C[A-Z][0-9]{2}[A-E][0-9]{2}$' and b.status = 'active' and public.bin_usable(b.id)
            and not exists (select 1 from inventory i where i.bin_id = b.id) order by b.bin_code limit 1) as rack_id,
         (select b.bin_code from bins b where b.bin_code ~ '^C[A-Z][0-9]{2}[A-E][0-9]{2}$' and b.status = 'active' and public.bin_usable(b.id)
            and not exists (select 1 from inventory i where i.bin_id = b.id) order by b.bin_code limit 1) as rack;
grant select on f116 to authenticated;
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, reason_code, note, by_name)
select 'adjustment', item_id, 'T116', 10, rack_id, '2030-01-01', 'FOUND', 'uji 116', 'Uji' from f116;

set role authenticated;
select pg_temp.as_user('a1161111-1111-1111-1111-111111111111');
create temp table l116 (id uuid); grant all on l116 to authenticated;
create temp table rc116 (id uuid); grant all on rc116 to authenticated;
insert into rc116 select create_stock_recon(current_date, 'uji 116', null,
  '[{"sku":"550058593","description":"x","uom":"CAR","unrestricted":0,"blocked":0}]'::jsonb, '[]'::jsonb, 'Inv');
insert into l116 select l.id from stock_recon_lines l where l.recon_id = (select id from rc116) and l.sku = '550058593';

-- ---------------------------------------------------------------------
-- 1  The preview is the plan the check would give
-- ---------------------------------------------------------------------
insert into r116 select 'zero', recon_check_preview((select id from l116), (select rack from f116), '[]'::jsonb, 'Inv');
select pg_temp.check('counting 0 in the bin: the plan adjusts the 10 away and the gap shrinks by 10',
  (select (v->'plan'->>'gap_after')::numeric = (v->'plan'->>'gap_before')::numeric - 10
      and jsonb_array_length(v->'plan'->'adjustments') = 1 and (v->'plan'->'adjustments'->0->>'quantity')::numeric = -10
          from r116 where k = 'zero'));
select pg_temp.check('the check summary is returned too (counted 0 against system 10)',
  (select (v->'check'->>'counted')::numeric = 0 and (v->'check'->>'system')::numeric = 10 from r116 where k = 'zero'));

insert into r116 select 'same', recon_check_preview((select id from l116), (select rack from f116),
  '[{"batch_lot":"T116","expiry_date":"2030-01-01","quantity":10}]'::jsonb, 'Inv');
select pg_temp.check('counting exactly what the system holds: nothing to fix, the gap stays',
  (select (v->'plan'->>'gap_after')::numeric = (v->'plan'->>'gap_before')::numeric
      and jsonb_array_length(v->'plan'->'adjustments') = 0 and jsonb_array_length(v->'plan'->'transfers') = 0 from r116 where k = 'same'));

-- ---------------------------------------------------------------------
-- 2  Nothing is stored
-- ---------------------------------------------------------------------
select pg_temp.check('the previews left no check row behind',
  (select count(*) = 0 from recon_checks where line_id = (select id from l116)));
select recon_check_bin((select id from l116), (select rack from f116), '[]'::jsonb, 'echt', 'Inv');
select pg_temp.check('a real check afterwards is stored, and the plan reads it (same numbers as its preview)',
  (select count(*) = 1 from recon_checks where line_id = (select id from l116))
  and (select (recon_fix_plan((select id from l116))->>'gap_after')::numeric = (v->'plan'->>'gap_after')::numeric from r116 where k = 'zero'));

-- ---------------------------------------------------------------------
-- 3  Same refusals as a real check
-- ---------------------------------------------------------------------
select pg_temp.check('a bin that does not exist is refused',
  pg_temp.fails($q$select recon_check_preview((select id from l116), 'ZZNOPE', '[]'::jsonb, 'Inv')$q$, '%tidak ada%'));
select pg_temp.check('a new batch without an expiry is refused',
  pg_temp.fails($q$select recon_check_preview((select id from l116), (select rack from f116), '[{"batch_lot":"NEW","quantity":3}]'::jsonb, 'Inv')$q$, '%expired wajib%'));
select pg_temp.check('a name is required',
  pg_temp.fails($q$select recon_check_preview((select id from l116), (select rack from f116), '[]'::jsonb, ' ')$q$, '%wajib diisi%'));
select pg_temp.as_user('a1162222-2222-2222-2222-222222222222');
select pg_temp.check('an operator is refused',
  pg_temp.fails($q$select recon_check_preview((select id from l116), (select rack from f116), '[]'::jsonb, 'Opr')$q$, '%supervisor atau admin%'));

reset role;
rollback;
