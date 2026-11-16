-- Staging handling (0134): Rekap inbound STAGE-IN rows are booked into STAGING once per arrival day, listed on the
-- Staging page and moved into a rack from there. Runs in a transaction and rolls back. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users values
  ('a9811111-1111-1111-1111-111111111111','sup98@x','{"name":"Sup 98"}'),
  ('a9822222-2222-2222-2222-222222222222','inv98@x','{"name":"Inv 98"}'),
  ('a9833333-3333-3333-3333-333333333333','opr98@x','{"name":"Opr 98"}') on conflict do nothing;
update profiles set job = 'leader' where id = 'a9811111-1111-1111-1111-111111111111';
update profiles set job = 'inventory' where id = 'a9822222-2222-2222-2222-222222222222';
update profiles set job = 'operator' where id = 'a9833333-3333-3333-3333-333333333333';
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when coalesce(ok, false) then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.fails(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then
  if sqlerrm not like p_like then raise notice 'got: %', sqlerrm; end if;
  return sqlerrm like p_like; end $$;
create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', p::text, true); end $$;
grant execute on function pg_temp.check(text, boolean), pg_temp.fails(text, text), pg_temp.as_user(uuid) to authenticated;
create temp table r98 (k text primary key, v jsonb);
grant all on r98 to authenticated;

-- Fixture: a new SKU, another SKU already in STAGING (the bin is "occupied"), two empty Shell rack bins.
insert into items (sku, description, uom, upp) values ('T98-SKU', 'Drum uji 98', 'EA', 4);
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, reason_code, note, by_name)
values ('adjustment', (select id from items where sku = '550058593'), 'T98-OTHER', 2,
        (select id from bins where bin_code = 'STAGING'), '2030-01-01', 'FOUND', 'uji 98', 'Uji');
insert into r98 select 'rack', to_jsonb(array_agg(bin_code)) from (
  select b.bin_code from bins b
  where b.bin_code ~ '^C[A-Z][0-9]{2}[A-E][0-9]{2}$' and b.status = 'active' and public.bin_usable(b.id)
    and not exists (select 1 from inventory i where i.bin_id = b.id)
  order by b.bin_code limit 6) x;
create temp view v98 as
  select coalesce(sum(i.quantity), 0) as qty from inventory i join bins b on b.id = i.bin_id
  where b.bin_code = 'STAGING' and i.item_id = (select id from items where sku = 'T98-SKU');
grant select on v98 to authenticated;

-- ---------------------------------------------------------------------
-- Part 1: putaway_import_arrival books staging rows once per arrival day
-- ---------------------------------------------------------------------
set role authenticated;
select pg_temp.as_user('a9811111-1111-1111-1111-111111111111');
insert into r98 select 'p1', putaway_import_arrival(
  '[{"line":1,"bin_code":"STAGING","sheet_bin":"STAGE-IN","sku":"T98-SKU","batch_lot":"B1","expiry_date":"2028-01-01","quantity":4}]',
  'Rekap inbound 202611.xlsx', true, 'Sup', current_date - 1);
select pg_temp.check('posts a staging row into an occupied STAGING bin',
  (select v->'rows'->0->>'kind' = 'staging' and v->'rows'->0->>'status' = 'new' and (v->>'staging')::int = 1
          and (v->>'movements')::int = 1 from r98 where k = 'p1')
  and (select qty = 4 from v98)
  and (select received_date = current_date - 1 from inventory i join bins b on b.id = i.bin_id
       where b.bin_code = 'STAGING' and i.item_id = (select id from items where sku = 'T98-SKU')));
select pg_temp.check('the staging movement is a putaway into STAGING with the STAGE-IN note',
  (select count(*) = 1 from movements m where m.item_id = (select id from items where sku = 'T98-SKU')
     and m.type = 'putaway' and m.from_bin_id is null and m.to_bin_id = (select id from bins where bin_code = 'STAGING')
     and m.note like 'Rekap inbound Rekap inbound 202611.xlsx (STAGE-IN)%' and m.by_name = 'Sup'));

insert into r98 select 'p2', putaway_import_arrival(
  '[{"line":1,"bin_code":"STAGING","sheet_bin":"STAGE-IN","sku":"T98-SKU","batch_lot":"B1","expiry_date":"2028-01-01","quantity":4}]',
  'Rekap inbound 202611.xlsx', true, 'Sup', current_date - 1);
select pg_temp.check('same day twice posts nothing',
  (select v->'rows'->0->>'status' = 'same' and v->'rows'->0->>'kind' = 'staging_done'
          and (v->>'staging')::int = 0 and (v->>'movements')::int = 0 from r98 where k = 'p2')
  and (select qty = 4 from v98)
  and (select count(*) = 1 from movements where item_id = (select id from items where sku = 'T98-SKU')));

insert into r98 select 'p3', putaway_import_arrival(
  '[{"line":1,"bin_code":"STAGING","sku":"T98-SKU","batch_lot":"B1","expiry_date":"2028-01-01","quantity":4}]',
  'Rekap inbound 202611.xlsx', false, 'Sup', current_date - 1);
select pg_temp.check('preview reports staging_done without posting',
  (select v->'rows'->0->>'kind' = 'staging_done' from r98 where k = 'p3')
  and (select count(*) = 1 from movements where item_id = (select id from items where sku = 'T98-SKU')));

insert into r98 select 'p4', putaway_import_arrival(
  '[{"line":1,"bin_code":"STAGING","sku":"T98-SKU","batch_lot":"B1","expiry_date":"2028-01-01","quantity":4}]',
  'Rekap inbound 202611.xlsx', false, 'Sup', current_date - 2);
select pg_temp.check('preview of another day reports staging (new), posts nothing',
  (select v->'rows'->0->>'kind' = 'staging' and v->'rows'->0->>'status' = 'new' from r98 where k = 'p4')
  and (select qty = 4 from v98));

insert into r98 select 'p5', putaway_import_arrival(
  '[{"line":1,"bin_code":"STAGING","sku":"T98-SKU","batch_lot":"B1","expiry_date":"2028-01-01","quantity":4}]',
  'Rekap inbound 202611.xlsx', true, 'Sup', current_date - 2);
select pg_temp.check('another arrival day posts again',
  (select (v->>'staging')::int = 1 from r98 where k = 'p5') and (select qty = 8 from v98));

select pg_temp.check('buku stok sees the arrival day',
  (select count(*) = 2 and bool_and(am.arrival_date in (current_date - 1, current_date - 2))
            and count(distinct am.arrival_date) = 2
   from movements m join putaway_arrival_moves am on am.movement_id = m.id
   where m.item_id = (select id from items where sku = 'T98-SKU'))
  and (select count(*) = 2 from putaway_arrivals pa
       where pa.import_id in (select am.import_id from putaway_arrival_moves am join movements m on m.id = am.movement_id
                              where m.item_id = (select id from items where sku = 'T98-SKU'))));

insert into r98 select 'p6', putaway_import_arrival(
  jsonb_build_array(
    jsonb_build_object('line', 2, 'bin_code', (select v->>0 from r98 where k = 'rack'), 'sku', 'T98-SKU',
                       'batch_lot', 'R1', 'expiry_date', '2028-06-01', 'quantity', 5),
    jsonb_build_object('line', 1, 'bin_code', 'STAGING', 'sku', 'T98-SKU', 'batch_lot', 'B2',
                       'expiry_date', '2028-02-01', 'quantity', 3),
    jsonb_build_object('line', 3, 'bin_code', 'STAGING', 'sku', 'T98-NOPE', 'batch_lot', 'X',
                       'expiry_date', '2028-02-01', 'quantity', 1)),
  'Rekap inbound 202611.xlsx', true, 'Sup', current_date - 1);
select pg_temp.check('rack rows still go through putaway_import; rows come back ordered by line',
  (select v->'rows'->0->>'line' = '1' and v->'rows'->0->>'kind' = 'staging'
      and v->'rows'->1->>'line' = '2' and v->'rows'->1->>'kind' is null and v->'rows'->1->>'status' = 'new'
      and v->'rows'->2->>'kind' = 'sku_unknown' and v->'rows'->2->>'status' = 'conflict'
      and (v->>'staging')::int = 1 and (v->>'movements')::int = 2 and v->>'import_id' is not null
   from r98 where k = 'p6')
  and exists (select 1 from inventory i join bins b on b.id = i.bin_id
              where b.bin_code = (select v->>0 from r98 where k = 'rack') and i.quantity = 5));
select pg_temp.check('a mixed call books both on one import with its arrival date',
  (select count(*) = 2 and count(distinct am.import_id) = 1 and bool_and(am.arrival_date = current_date - 1)
   from movements m join putaway_arrival_moves am on am.movement_id = m.id
   where m.item_id = (select id from items where sku = 'T98-SKU') and m.batch_lot in ('R1', 'B2')));

reset role;
select pg_temp.check('staging_receipts is append-only',
  pg_temp.fails('update staging_receipts set quantity = 1', '%')
  and pg_temp.fails('delete from staging_receipts', '%'));
select pg_temp.check('staging_receipts holds one row per posted day line',
  (select count(*) = 3 from staging_receipts where item_id = (select id from items where sku = 'T98-SKU')));

set role authenticated;
select pg_temp.as_user('a9833333-3333-3333-3333-333333333333');
select pg_temp.check('an operator cannot post',
  pg_temp.fails($q$select putaway_import_arrival('[{"line":1,"bin_code":"STAGING","sku":"T98-SKU","batch_lot":"B9","expiry_date":"2028-01-01","quantity":1}]',
                   'x', true, 'Opr', current_date - 1)$q$, '%supervisor%'));

-- Final review: a day uploaded again with another quantity (the sheet is filled in over several passes).
select pg_temp.as_user('a9811111-1111-1111-1111-111111111111');
create or replace function pg_temp.stage98(p_batch text, p_qty int, p_day date, p_apply boolean default true) returns jsonb
language sql as $f$ select putaway_import_arrival(jsonb_build_array(jsonb_build_object('line', 1, 'bin_code', 'STAGING',
  'sheet_bin', 'STAGE-IN', 'sku', 'T98-SKU', 'batch_lot', p_batch, 'expiry_date', '2028-03-01', 'quantity', p_qty)),
  'Rekap inbound 202611.xlsx', p_apply, 'Sup', p_day) $f$;
grant execute on function pg_temp.stage98(text, int, date, boolean) to authenticated;
create temp view v98b as select coalesce(sum(i.quantity), 0) as qty from inventory i join bins b on b.id = i.bin_id
  where b.bin_code = 'STAGING' and i.item_id = (select id from items where sku = 'T98-SKU') and i.batch_lot = 'B3';
grant select on v98b to authenticated;
select pg_temp.stage98('B3', 40, current_date - 1);
insert into r98 select 'q1', pg_temp.stage98('B3', 80, current_date - 1);
select pg_temp.check('the same day again with more posts only the difference',
  (select v->'rows'->0->>'kind' = 'staging' and (v->>'staging')::int = 1 from r98 where k = 'q1')
  and (select qty = 80 from v98b));
insert into r98 select 'q2', pg_temp.stage98('B3', 80, current_date - 1);
select pg_temp.check('the same day again with the same quantity posts nothing',
  (select v->'rows'->0->>'kind' = 'staging_done' and (v->>'staging')::int = 0 from r98 where k = 'q2') and (select qty = 80 from v98b));
insert into r98 select 'q3', pg_temp.stage98('B3', 60, current_date - 1);
select pg_temp.check('the same day again with less posts nothing and says how much is recorded',
  (select v->'rows'->0->>'kind' = 'staging_less' and v->'rows'->0->>'status' = 'conflict'
          and (v->'rows'->0->>'recorded')::numeric = 80 and (v->>'staging')::int = 0 from r98 where k = 'q3')
  and (select qty = 80 from v98b));
insert into r98 select 'q4', pg_temp.stage98('B3', 100, current_date - 1, false);
select pg_temp.check('the preview of more says how much is recorded and posts nothing',
  (select v->'rows'->0->>'kind' = 'staging' and (v->'rows'->0->>'recorded')::numeric = 80 from r98 where k = 'q4')
  and (select qty = 80 from v98b));

-- Final review: only the STAGING bin is the staging branch; floor spots STG_xx keep putaway_import's checks.
insert into r98 select 'g1', putaway_import_arrival('[{"line":1,"bin_code":"STG_01","sku":"T98-SKU","batch_lot":"S1","expiry_date":"2028-01-01","quantity":2}]',
  'data putaway.xlsx', true, 'Sup', current_date - 1);
insert into r98 select 'g2', putaway_import_arrival('[{"line":1,"bin_code":"STG_01","sku":"T98-SKU","batch_lot":"S1","expiry_date":"2028-01-01","quantity":2}]',
  'data putaway.xlsx', true, 'Sup', current_date - 2);
select pg_temp.check('a STG_xx row goes through putaway_import: posted once, then the same content is "same"',
  (select v->'rows'->0->>'kind' is null and v->'rows'->0->>'status' = 'new' and (v->>'staging')::int = 0 from r98 where k = 'g1')
  and (select v->'rows'->0->>'status' = 'same' and (v->>'movements')::int = 0 from r98 where k = 'g2')
  and (select sum(i.quantity) = 2 from inventory i join bins b on b.id = i.bin_id
       where b.bin_code = 'STG_01' and i.item_id = (select id from items where sku = 'T98-SKU')));
reset role;

-- ---------------------------------------------------------------------
-- Part 2: staging_stock() and staging_to_rack(...)
-- State: STAGING holds T98-SKU B1/2028-01-01 = 8 (days -1 and -2), B2/2028-02-01 = 3 (day -1).
-- ---------------------------------------------------------------------
set role authenticated;
select pg_temp.as_user('a9822222-2222-2222-2222-222222222222');
select pg_temp.check('staging_stock ages a line on its stock row date, as the dashboard tally does',
  (select arrival_date = current_date - 1 and days_waiting = 1 and quantity = 8 and reserved = 0 and bin_code = 'STAGING'
          and uom = 'EA' and description = 'Drum uji 98'
   from staging_stock() where sku = 'T98-SKU' and batch_lot = 'B1'));
select pg_temp.check('staging_stock lists other SKUs in staging too, oldest first',
  (select count(*) >= 3 from staging_stock())
  and (select bool_and(coalesce(a <= b, true)) from (
         select arrival_date as a, lead(arrival_date) over (order by n) as b
         from staging_stock() with ordinality s(bin_code, item_id, sku, description, uom, batch_lot, expiry_date,
                                                 quantity, reserved, arrival_date, days_waiting, n)) x
       where a is not null and b is not null));

insert into r98 select 'tot', to_jsonb((select sum(quantity) from inventory where item_id = (select id from items where sku = 'T98-SKU')));
insert into r98 select 'm1', to_jsonb(staging_to_rack('STAGING', 'T98-SKU', 'B1', '2028-01-01', 3,
  (select v->>1 from r98 where k = 'rack'), 'Inv'));
select pg_temp.check('moves part of a line',
  (select qty = 88 from v98)  -- B1 5 + B2 3 + B3 80
  and (select quantity = 5 from staging_stock() where sku = 'T98-SKU' and batch_lot = 'B1')
  and (select sum(i.quantity) = 3 from inventory i join bins b on b.id = i.bin_id
       where b.bin_code = (select v->>1 from r98 where k = 'rack') and i.item_id = (select id from items where sku = 'T98-SKU'))
  and (select sum(quantity) = (select (v)::numeric from r98 where k = 'tot') from inventory
       where item_id = (select id from items where sku = 'T98-SKU')));
select pg_temp.check('the move is one transfer from STAGING with the staging note and the name',
  (select m.type = 'transfer' and m.from_bin_id = (select id from bins where bin_code = 'STAGING')
          and m.note = 'Dari staging' and m.by_name = 'Inv' and m.quantity = 3 and m.expiry_date = '2028-01-01'
   from movements m where m.id = (select (v #>> '{}')::uuid from r98 where k = 'm1')));

select staging_to_rack('STAGING', 'T98-SKU', 'B1', '2028-01-01', 5, (select v->>1 from r98 where k = 'rack'), 'Inv');
select pg_temp.check('moves the rest and the line leaves the list',
  not exists (select 1 from staging_stock() where sku = 'T98-SKU' and batch_lot = 'B1')
  and (select sum(i.quantity) = 8 from inventory i join bins b on b.id = i.bin_id
       where b.bin_code = (select v->>1 from r98 where k = 'rack') and i.item_id = (select id from items where sku = 'T98-SKU')));

select pg_temp.as_user('a9811111-1111-1111-1111-111111111111');
select putaway_import_arrival('[{"line":1,"bin_code":"STAGING","sku":"T98-SKU","batch_lot":"B1","expiry_date":"2028-01-01","quantity":4}]',
  'Rekap inbound 202611.xlsx', true, 'Sup', current_date);
select pg_temp.as_user('a9822222-2222-2222-2222-222222222222');
select pg_temp.check('fresh drums of a line that left staging start at today, not at the old receipt',
  (select arrival_date = current_date and days_waiting = 0 and quantity = 4 from staging_stock() where sku = 'T98-SKU' and batch_lot = 'B1'));
select staging_to_rack('STAGING', 'T98-SKU', 'B1', '2028-01-01', 4, (select v->>1 from r98 where k = 'rack'), 'Inv');

select pg_temp.check('refuses more than is there',
  pg_temp.fails($q$select staging_to_rack('STAGING', 'T98-SKU', 'B2', '2028-02-01', 4, (select v->>1 from r98 where k = 'rack'), 'Inv')$q$, '%melebihi%')
  and pg_temp.fails($q$select staging_to_rack('STAGING', 'T98-SKU', 'B2', '2028-02-01', 0, (select v->>1 from r98 where k = 'rack'), 'Inv')$q$, '%melebihi%'));
select pg_temp.check('refuses a non-staging source',
  pg_temp.fails($q$select staging_to_rack((select v->>1 from r98 where k = 'rack'), 'T98-SKU', 'B1', '2028-01-01', 1, (select v->>2 from r98 where k = 'rack'), 'Inv')$q$, '%Bukan lokasi staging%'));
select pg_temp.check('refuses a floor target',
  pg_temp.fails($q$select staging_to_rack('STAGING', 'T98-SKU', 'B2', '2028-02-01', 1, 'STG_01', 'Inv')$q$, '%rak%'));
reset role;
update bins set owner = 'CKB' where bin_code = (select v->>2 from r98 where k = 'rack');
update bins set status = 'blocked', block_kind = 'NOT_PRESENT' where bin_code = (select v->>3 from r98 where k = 'rack');
update bins set status = 'blocked', block_kind = 'PLANNED' where bin_code = (select v->>4 from r98 where k = 'rack');
update bins set status = 'blocked', block_kind = 'BLOCKED' where bin_code = (select v->>5 from r98 where k = 'rack');
set role authenticated;
select pg_temp.as_user('a9822222-2222-2222-2222-222222222222');
select pg_temp.check('refuses a CKB-owned rack',
  pg_temp.fails($q$select staging_to_rack('STAGING', 'T98-SKU', 'B2', '2028-02-01', 1, (select v->>2 from r98 where k = 'rack'), 'Inv')$q$, '%CKB%'));
select pg_temp.check('refuses a pillar (NOT_PRESENT), a planned and a blocked rack',
  pg_temp.fails($q$select staging_to_rack('STAGING', 'T98-SKU', 'B2', '2028-02-01', 1, (select v->>3 from r98 where k = 'rack'), 'Inv')$q$, '%tidak ada%')
  and pg_temp.fails($q$select staging_to_rack('STAGING', 'T98-SKU', 'B2', '2028-02-01', 1, (select v->>4 from r98 where k = 'rack'), 'Inv')$q$, '%belum dibangun%')
  and pg_temp.fails($q$select staging_to_rack('STAGING', 'T98-SKU', 'B2', '2028-02-01', 1, (select v->>5 from r98 where k = 'rack'), 'Inv')$q$, '%blocked%'));
select pg_temp.check('a refused move leaves staging as it was',
  (select quantity = 3 from staging_stock() where sku = 'T98-SKU' and batch_lot = 'B2'));

reset role;
insert into waves (id, wave_no, planned_date, shipment_numbers, status) values
  ('a9844444-4444-4444-4444-444444444444', '98', current_date, '{SH98}', 'PENDING');
insert into pick_tasks (wave_id, shipment_number, task_type, item_id, from_bin_id, batch_lot, expiry_date, quantity, seq, status)
values ('a9844444-4444-4444-4444-444444444444', 'SH98', 'PICK', (select id from items where sku = 'T98-SKU'),
        (select id from bins where bin_code = 'STAGING'), 'B2', '2028-02-01', 2, 1, 'PLANNED');
set role authenticated;
select pg_temp.as_user('a9822222-2222-2222-2222-222222222222');
select pg_temp.check('staging_stock shows what a wave reserved',
  (select reserved = 2 from staging_stock() where sku = 'T98-SKU' and batch_lot = 'B2'));
select pg_temp.check('refuses reserved quantity (Inventory job, a supervisor-level role)',
  pg_temp.fails($q$select staging_to_rack('STAGING', 'T98-SKU', 'B2', '2028-02-01', 2, (select v->>0 from r98 where k = 'rack'), 'Inv')$q$, '%dipesan%'));
select pg_temp.as_user('a9811111-1111-1111-1111-111111111111');
select pg_temp.check('refuses reserved quantity for a Leader too; the free part moves',
  pg_temp.fails($q$select staging_to_rack('STAGING', 'T98-SKU', 'B2', '2028-02-01', 3, (select v->>0 from r98 where k = 'rack'), 'Sup')$q$, '%dipesan%')
  and staging_to_rack('STAGING', 'T98-SKU', 'B2', '2028-02-01', 1, (select v->>0 from r98 where k = 'rack'), 'Sup') is not null);

select pg_temp.as_user('a9833333-3333-3333-3333-333333333333');
select pg_temp.check('an Operator / Picker cannot see or move staging',
  pg_temp.fails('select * from staging_stock()', '%Akses ditolak%')
  and pg_temp.fails($q$select staging_to_rack('STAGING', 'T98-SKU', 'B2', '2028-02-01', 1, (select v->>0 from r98 where k = 'rack'), 'Opr')$q$, '%Akses ditolak%'));
reset role;

rollback;
