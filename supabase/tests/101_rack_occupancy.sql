-- Rack occupancy for the manager report (0137): locations, occupied, litres, per bay and per aisle, target volume.
-- Runs in a transaction and rolls back. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users values
  ('a1011111-1111-1111-1111-111111111111','adm101@x','{"name":"Adm 101"}'),
  ('a1012222-2222-2222-2222-222222222222','opr101@x','{"name":"Opr 101"}') on conflict do nothing;
update profiles set job = 'admin' where id = 'a1011111-1111-1111-1111-111111111111';
update profiles set job = 'operator' where id = 'a1012222-2222-2222-2222-222222222222';
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when coalesce(ok, false) then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', p::text, true); end $$;
grant execute on function pg_temp.check(text, boolean), pg_temp.as_user(uuid) to authenticated;
create temp table r101 (k text primary key, v jsonb);
grant all on r101 to authenticated;

-- Fixture: one empty usable rack bin gets 10 cartons of an item with a known volume; one empty bin is blocked.
insert into items (sku, description, uom, upp, volume_l) values ('T101-SKU', 'Uji 101', 'CAR', 48, 12);
insert into r101 select 'bins', to_jsonb(array_agg(bin_code)) from (
  select b.bin_code from bins b
  where b.rack is not null and b.status = 'active' and b.owner = 'SHELL'
    and not exists (select 1 from inventory i where i.bin_id = b.id)
  order by b.bin_code limit 2) x;
insert into r101 select 'before', rack_occupancy();
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, reason_code, note, by_name)
values ('adjustment', (select id from items where sku = 'T101-SKU'), 'B101', 10,
        (select id from bins where bin_code = (select v->>0 from r101 where k = 'bins')), '2030-01-01', 'FOUND', 'uji 101', 'Uji');
update bins set status = 'blocked', block_kind = 'BLOCKED' where bin_code = (select v->>1 from r101 where k = 'bins');

set role authenticated;
select pg_temp.as_user('a1012222-2222-2222-2222-222222222222');
insert into r101 select 'after', rack_occupancy();
reset role;

select pg_temp.check('locations = rack bins Shell may use',
  (select (v->>'locations')::int = (select count(*) from bins b where b.rack is not null and b.status = 'active'
                                      and (b.owner = 'SHELL' or b.owner is null)
                                      and exists (select 1 from bins x where x.zone = b.zone and x.rack = b.rack and x.owner is distinct from 'CKB'))
   from r101 where k = 'after'));
select pg_temp.check('a blocked bin leaves the locations, a filled bin joins occupied',
  (select (a.v->>'locations')::int = (bf.v->>'locations')::int - 1 and (a.v->>'occupied')::int = (bf.v->>'occupied')::int + 1
   from r101 a, r101 bf where a.k = 'after' and bf.k = 'before'));
select pg_temp.check('litres grow by 10 cartons x 12 L',
  (select (a.v->>'litres')::numeric = (bf.v->>'litres')::numeric + 120 from r101 a, r101 bf where a.k = 'after' and bf.k = 'before'));
select pg_temp.check('per-bay and per-aisle numbers add up to the totals',
  (select (select sum((e->>'occupied')::int) from jsonb_array_elements(v->'bays') e) = (v->>'occupied')::int
      and (select sum((e->>'locations')::int) from jsonb_array_elements(v->'aisles') e) = (v->>'locations')::int
   from r101 where k = 'after'));
select pg_temp.check('the filled bin''s bay shows it, the blocked bin''s bay counts it as blocked',
  (select exists (select 1 from jsonb_array_elements(v->'bays') e, bins b
                  where b.bin_code = (select v->>0 from r101 where k = 'bins') and e->>'zone' = b.zone and e->>'rack' = b.rack
                    and (e->>'occupied')::int >= 1)
      and exists (select 1 from jsonb_array_elements(v->'bays') e, bins b
                  where b.bin_code = (select v->>1 from r101 where k = 'bins') and e->>'zone' = b.zone and e->>'rack' = b.rack
                    and (e->>'blocked')::int >= 1)
   from r101 where k = 'after'));
select pg_temp.check('bays wholly lent to CKB 3PL are not on the map',
  (select not exists (select 1 from jsonb_array_elements(v->'bays') e where (e->>'ckb')::int > 0
                        and (e->>'ckb')::int = (select count(*) from bins b where b.zone = e->>'zone' and b.rack = e->>'rack'))
   from r101 where k = 'after'));
select pg_temp.check('target volume defaults to 1,756,000 L',
  (select (v->>'target_volume_l')::numeric = 1756000 from r101 where k = 'after'));

set role authenticated;
select pg_temp.as_user('a1011111-1111-1111-1111-111111111111');
select set_inventory_policy('{"target_volume_l": 1800000}');
select pg_temp.check('an admin changes the target volume',
  (select (rack_occupancy()->>'target_volume_l')::numeric = 1800000));
reset role;
select pg_temp.check('anon cannot call rack_occupancy',
  not has_function_privilege('anon', 'public.rack_occupancy()', 'execute'));

rollback;
