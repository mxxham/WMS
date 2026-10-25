-- FEFO exceptions now exposes the zone (aisle) of the picked bin (0093).
-- Runs in a transaction and rolls back.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;

insert into auth.users values
  ('11111111-1111-1111-1111-111111111111','op@x','{"name":"Operator"}'),
  ('22222222-2222-2222-2222-222222222222','sup@x','{"name":"Supervisor"}') on conflict do nothing;
update profiles set role='supervisor' where id='22222222-2222-2222-2222-222222222222';

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;

-- Fixture: item + stock in two zones. Older expiry in CA, newer expiry in CE.
update items set volume_l = 20 where sku = '550044709';
insert into items (sku, description, uom, volume_l)
values ('5500FEFZ', 'FEFO Zone Test', 'CAR', 20)
on conflict (sku) do update set volume_l = 20;

insert into bins (bin_code, zone, rack, level, position)
values ('CA01C01','CA','01','C','01'),
       ('CE01C01','CE','01','C','01')
on conflict (bin_code) do update set zone = EXCLUDED.zone;

set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

-- Older stock in CA (establishes inventory via the movements trigger).
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
select 'inbound', i.id, 'OLD', 10, b.id, '2030-01-01', 'fixture'
from items i join bins b on b.bin_code='CA01C01' where i.sku='5500FEFZ';
-- Newer stock in CE.
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
select 'inbound', i.id, 'NEW', 10, b.id, '2032-01-01', 'fixture'
from items i join bins b on b.bin_code='CE01C01' where i.sku='5500FEFZ';
-- Pick from the NEWER-expiry bin (CE) while older stock exists in CA -> FEFO exception.
-- The pick is pinned 36 h in the future and inspected in a +-1 h window around it:
-- the seed's own movements all share this transaction's now(), so an +-1-day window
-- around now() sweeps the seed in and both the count and the limit-1 row become
-- nondeterministic. A future offset makes this file self-contained.
insert into movements (type, item_id, batch_lot, quantity, from_bin_id, expiry_date, note, created_at)
select 'picking', i.id, 'NEW', 5, b.id, '2032-01-01', 'fixture', now() + interval '36 hours'
from items i join bins b on b.bin_code='CE01C01' where i.sku='5500FEFZ';

-- Window covering only the pinned pick (older stock arrives via inventory rows).
select pg_temp.check('fefo_exceptions returns exactly one exception row',
  (select count(*) = 1 from public.fefo_exceptions(now() + interval '35 hours', now() + interval '37 hours')));

select pg_temp.check('fefo exception is from the CE bin',
  (select from_bin = 'CE01C01' from public.fefo_exceptions(now() + interval '35 hours', now() + interval '37 hours') limit 1));

select pg_temp.check('fefo exception zone equals CE',
  (select zone = 'CE' from public.fefo_exceptions(now() + interval '35 hours', now() + interval '37 hours') limit 1));

select pg_temp.check('fefo zone equals bins.zone of the picked bin',
  (select zone = (select zone from bins where bin_code = 'CE01C01')
     from public.fefo_exceptions(now() + interval '35 hours', now() + interval '37 hours')
    where from_bin = 'CE01C01'
    limit 1));

rollback;
