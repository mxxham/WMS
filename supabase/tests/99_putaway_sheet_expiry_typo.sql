-- Putaway sheet expiry typo (0135): a sheet expiry that disagrees with its batch code is matched to the bin's line
-- with the batch-code expiry, not reported as "Bin sudah berisi stok lain". Runs in a transaction and rolls back.
-- Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users values
  ('a9911111-1111-1111-1111-111111111111','sup99@x','{"name":"Sup 99"}') on conflict do nothing;
update profiles set job = 'leader' where id = 'a9911111-1111-1111-1111-111111111111';
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when coalesce(ok, false) then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', p::text, true); end $$;
grant execute on function pg_temp.check(text, boolean), pg_temp.as_user(uuid) to authenticated;
create temp table r99 (k text primary key, v jsonb);
grant all on r99 to authenticated;

-- Fixture: two date-coded SKUs, four empty Shell rack bins.
--   b1: T99-A 02K26JJ at the batch-code expiry, 36   (the 10 Nov CA01B01 case)
--   b2: T99-B 02K26JJ (another SKU)                   (a real "other stock" conflict)
--   b3: T99-A 02K26JJ at an expiry that is NOT the batch-code one
--   b4: empty
insert into items (sku, description, uom, upp, shelf_life_months) values
  ('T99-A', 'Uji 99 A', 'CAR', 48, 48), ('T99-B', 'Uji 99 B', 'CAR', 48, 48);
insert into r99 select 'exp', to_jsonb(public.batch_expected_expiry((select id from items where sku = 'T99-A'), '02K26JJ'));
insert into r99 select 'bins', to_jsonb(array_agg(bin_code)) from (
  select b.bin_code from bins b
  where b.bin_code ~ '^C[A-Z][0-9]{2}[A-E][0-9]{2}$' and b.status = 'active' and public.bin_usable(b.id)
    and not exists (select 1 from inventory i where i.bin_id = b.id)
  order by b.bin_code limit 4) x;
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, reason_code, note, by_name)
select 'adjustment', (select id from items where sku = s), '02K26JJ', 36,
       (select id from bins where bin_code = (select v->>n from r99 where k = 'bins')), e, 'FOUND', 'uji 99', 'Uji'
from (values ('T99-A', 0, (select (v #>> '{}')::date from r99 where k = 'exp')),
             ('T99-B', 1, (select (v #>> '{}')::date from r99 where k = 'exp')),
             ('T99-A', 2, date '2029-01-01')) f(s, n, e);

select pg_temp.check('the batch code gives an expiry that is not the sheet''s 1930 one',
  (select (v #>> '{}')::date > date '2026-11-10' from r99 where k = 'exp'));

set role authenticated;
select pg_temp.as_user('a9911111-1111-1111-1111-111111111111');

-- Check only (p_apply false): one row per case, all with the sheet's 1930 expiry.
insert into r99 select 'chk', putaway_import(jsonb_build_array(
  jsonb_build_object('line', 2, 'bin_code', (select v->>0 from r99 where k = 'bins'), 'sku', 'T99-A', 'batch_lot', '02K26JJ', 'expiry_date', '1930-11-02', 'quantity', 36),
  jsonb_build_object('line', 3, 'bin_code', (select v->>1 from r99 where k = 'bins'), 'sku', 'T99-A', 'batch_lot', '02K26JJ', 'expiry_date', '1930-11-02', 'quantity', 36),
  jsonb_build_object('line', 4, 'bin_code', (select v->>2 from r99 where k = 'bins'), 'sku', 'T99-A', 'batch_lot', '02K26JJ', 'expiry_date', '1930-11-02', 'quantity', 36),
  jsonb_build_object('line', 5, 'bin_code', (select v->>3 from r99 where k = 'bins'), 'sku', 'T99-A', 'batch_lot', '02K26JJ', 'expiry_date', '1930-11-02', 'quantity', 36)
), 'uji 99', false, 'Sup');

select pg_temp.check('sheet 1930, bin holds the batch-code expiry with the same qty: same, no conflict',
  (select v->'rows'->0->>'status' = 'same' and v->'rows'->0->>'kind' is null from r99 where k = 'chk'));
select pg_temp.check('the expiry warning still points at the batch-code expiry (fixed on Kualitas data)',
  (select v->'rows'->0->>'expiry_expected' = (select v #>> '{}' from r99 where k = 'exp') from r99 where k = 'chk'));
select pg_temp.check('another SKU in the bin is still a conflict',
  (select v->'rows'->1->>'status' = 'conflict' and v->'rows'->1->>'kind' = 'bin_occupied' from r99 where k = 'chk'));
select pg_temp.check('same SKU + batch at a different, non-batch-code expiry is still a conflict',
  (select v->'rows'->2->>'status' = 'conflict' and v->'rows'->2->>'kind' = 'bin_occupied' from r99 where k = 'chk'));
select pg_temp.check('an empty bin is a new row with the warning, as before',
  (select v->'rows'->3->>'status' = 'new' and v->'rows'->3->>'expiry_expected' is not null from r99 where k = 'chk'));

-- A different qty is qty_differs, and "Tambahkan" adds to the batch-code line, never a 1930 line.
insert into r99 select 'add', putaway_import(jsonb_build_array(
  jsonb_build_object('line', 2, 'bin_code', (select v->>0 from r99 where k = 'bins'), 'sku', 'T99-A', 'batch_lot', '02K26JJ',
                     'expiry_date', '1930-11-02', 'quantity', 12, 'action', 'add')
), 'uji 99', true, 'Sup');
select pg_temp.check('sheet 1930 with another qty: qty_differs, not bin_occupied',
  (select v->'rows'->0->>'kind' = 'qty_differs' and (v->>'movements')::int = 1 from r99 where k = 'add'));
reset role;
select pg_temp.check('the added cartons went to the batch-code line; no 1930 stock line exists',
  (select count(*) = 1 and sum(i.quantity) = 48 and min(i.expiry_date) = (select (v #>> '{}')::date from r99 where k = 'exp')
   from inventory i join bins b on b.id = i.bin_id
   where b.bin_code = (select v->>0 from r99 where k = 'bins') and i.item_id = (select id from items where sku = 'T99-A')));

rollback;
