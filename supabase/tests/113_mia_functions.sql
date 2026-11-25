-- MIA functions (0153): rack -> MIA, nothing -> MIA, MIA -> rack, MIA -> nothing. Inventory / Admin only, no second
-- approver, every call one append-only mia_events row, tied to a reconciliation line when given one.
-- Runs in a transaction and rolls back. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users values
  ('a1131111-1111-1111-1111-111111111111','inv113@x','{"name":"Inv 113"}'),
  ('a1132222-2222-2222-2222-222222222222','ldr113@x','{"name":"Ldr 113"}'),
  ('a1133333-3333-3333-3333-333333333333','adm113@x','{"name":"Adm 113"}') on conflict do nothing;
update profiles set job = 'inventory' where id = 'a1131111-1111-1111-1111-111111111111';
update profiles set job = 'leader' where id = 'a1132222-2222-2222-2222-222222222222';
update profiles set job = 'admin' where id = 'a1133333-3333-3333-3333-333333333333';
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when coalesce(ok, false) then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.fails(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then
  if sqlerrm not like p_like then raise notice 'got: %', sqlerrm; end if;
  return sqlerrm like p_like; end $$;
create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', p::text, true); end $$;
grant execute on function pg_temp.check(text, boolean), pg_temp.fails(text, text), pg_temp.as_user(uuid) to authenticated;
create temp table r113 (k text primary key, v jsonb);
grant all on r113 to authenticated;

-- Fixture: SKU A has 50 cartons in rack bin R1; R2 is empty; R3 holds SKU B.
create temp table f113 as
  with racks as (
    select b.id, b.bin_code, row_number() over (order by b.bin_code) as n from bins b
     where b.bin_code ~ '^C[A-Z][0-9]{2}[A-E][0-9]{2}$' and b.status = 'active' and public.bin_usable(b.id)
       and not exists (select 1 from inventory i where i.bin_id = b.id))
  select (select id from items where sku = '550058593') as a_id,
         (select id from items where sku <> '550058593' order by sku limit 1) as b_id,
         (select bin_code from racks where n = 1) as r1, (select bin_code from racks where n = 2) as r2,
         (select bin_code from racks where n = 3) as r3, (select id from racks where n = 1) as r1_id,
         (select id from racks where n = 3) as r3_id, (select id from bins where bin_code = 'MIA') as mia_id;
grant select on f113 to authenticated;
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, reason_code, note, by_name)
select 'adjustment', a_id, 'T113', 50, r1_id, '2030-01-01', 'FOUND', 'uji 113', 'Uji' from f113;
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, reason_code, note, by_name)
select 'adjustment', b_id, 'T113B', 5, r3_id, '2030-01-01', 'FOUND', 'uji 113', 'Uji' from f113;
create temp view v113 as
  select (select coalesce(sum(quantity), 0) from inventory where bin_id = (select mia_id from f113) and item_id = (select a_id from f113)) as mia,
         (select coalesce(sum(quantity), 0) from inventory where bin_id = (select r1_id from f113) and item_id = (select a_id from f113)) as r1;
grant select on v113 to authenticated;

-- ---------------------------------------------------------------------
-- 1  Who may
-- ---------------------------------------------------------------------
set role authenticated;
select pg_temp.as_user('a1132222-2222-2222-2222-222222222222');   -- a leader
select pg_temp.check('a leader cannot move stock into MIA',
  pg_temp.fails($q$select mia_move_in((select r1 from f113), '550058593', 'T113', '2030-01-01', 4, 'uji', 'Ldr')$q$, '%Hanya Inventory atau Admin%'));

select pg_temp.as_user('a1131111-1111-1111-1111-111111111111');   -- inventory
select pg_temp.check('a note is required',
  pg_temp.fails($q$select mia_move_in((select r1 from f113), '550058593', 'T113', '2030-01-01', 4, '  ', 'Inv')$q$, '%Keterangan wajib%'));
select pg_temp.check('more than the bin holds is refused',
  pg_temp.fails($q$select mia_move_in((select r1 from f113), '550058593', 'T113', '2030-01-01', 51, 'uji', 'Inv')$q$, '%tinggal 50%'));

-- ---------------------------------------------------------------------
-- 2  rack -> MIA, above the approval limit, with nobody approving
-- ---------------------------------------------------------------------
insert into r113 select 'in', mia_move_in((select r1 from f113), '550058593', 'T113', '2030-01-01', 30, 'palet tidak ada di rak', 'Inv');
select pg_temp.check('30 cartons (above the limit of 20) move rack -> MIA at once: 30 in MIA, 20 left',
  (select mia = 30 and r1 = 20 from v113));
select pg_temp.check('the movement is a transfer with no approved_by_name, the event is MOVE_IN',
  (select count(*) = 1 from movements m where m.ref_id = (select (v->>'event_id')::uuid from r113 where k = 'in')
     and m.type = 'transfer' and m.approved_by_name is null and m.by_name = 'Inv' and m.note like 'MIA: %')
  and (select count(*) = 1 from mia_events e where e.id = (select (v->>'event_id')::uuid from r113 where k = 'in')
     and e.kind = 'MOVE_IN' and e.quantity = 30 and e.by_name = 'Inv'));

-- ---------------------------------------------------------------------
-- 3  nothing -> MIA, then found into a rack and written off
-- ---------------------------------------------------------------------
insert into r113 select 'book', mia_book('550058593', 'B113', '2031-01-01', 7, 'SAP punya, belum ketemu', 'Inv');
select pg_temp.check('mia_book puts 7 cartons into MIA with reason MIA and no approver',
  (select count(*) = 1 from movements m where m.ref_id = (select (v->>'event_id')::uuid from r113 where k = 'book')
     and m.type = 'adjustment' and m.quantity = 7 and m.reason_code = 'MIA' and m.approved_by_name is null)
  and (select mia = 37 from v113));

select pg_temp.check('found into a bin of another SKU is refused (one bin, one SKU)',
  pg_temp.fails($q$select mia_find((select r3 from f113), '550058593', 'T113', '2030-01-01', 5, 'uji', 'Inv')$q$, '%satu bin satu SKU%'));
select pg_temp.check('found more than MIA holds is refused',
  pg_temp.fails($q$select mia_find((select r2 from f113), '550058593', 'T113', '2030-01-01', 31, 'uji', 'Inv')$q$, '%hanya ada 30%'));
insert into r113 select 'find', mia_find((select r2 from f113), '550058593', 'T113', '2030-01-01', 10, 'ketemu di belakang', 'Inv');
select pg_temp.check('found: 10 cartons MIA -> an empty rack bin',
  (select mia = 27 from v113)
  and (select coalesce(sum(i.quantity), 0) = 10 from inventory i join bins b on b.id = i.bin_id
        where b.bin_code = (select r2 from f113) and i.item_id = (select a_id from f113)));

select pg_temp.check('clear needs a note',
  pg_temp.fails($q$select mia_clear('550058593', 'B113', '2031-01-01', 3, '', 'Inv')$q$, '%Keterangan wajib%'));
insert into r113 select 'clear', mia_clear('550058593', 'B113', '2031-01-01', 3, 'SAP 702 dokumen 4900', 'Inv');
select pg_temp.check('cleared: 3 cartons written off, MIA 24 left, reason MIA',
  (select mia = 24 from v113)
  and (select count(*) = 1 from movements m where m.ref_id = (select (v->>'event_id')::uuid from r113 where k = 'clear')
        and m.type = 'adjustment' and m.quantity = -3 and m.reason_code = 'MIA'));

select pg_temp.check('the stock view lists what is in MIA with its age',
  (select sum(quantity) = 24 and bool_and(since is not null) from mia_stock where sku = '550058593'));

-- ---------------------------------------------------------------------
-- 4  The ledger cannot be changed
-- ---------------------------------------------------------------------
-- No write policy: an UPDATE or DELETE by the app role touches no row (or is refused outright).
create or replace function pg_temp.try_write() returns void language plpgsql as $$
begin
  begin update mia_events set note = 'x'; exception when others then null; end;
  begin delete from mia_events; exception when others then null; end;
end $$;
grant execute on function pg_temp.try_write() to authenticated;
select pg_temp.try_write();
select pg_temp.check('the app role cannot change or remove a MIA event',
  (select count(*) from mia_events where note = 'x') = 0 and (select count(*) from mia_events) >= 4);
reset role;
select pg_temp.check('even the owner cannot update or delete a MIA event (trigger)',
  pg_temp.fails($q$update mia_events set note = 'x'$q$, '%tidak bisa diubah%')
  and pg_temp.fails($q$delete from mia_events$q$, '%tidak bisa diubah%'));
set role authenticated;

-- ---------------------------------------------------------------------
-- 5  Tied to a reconciliation line
-- ---------------------------------------------------------------------
select pg_temp.as_user('a1133333-3333-3333-3333-333333333333');   -- admin
insert into r113 select 'recon', to_jsonb(create_stock_recon(current_date, 'uji 113', null,
  '[{"sku":"550058593","description":"x","uom":"CAR","unrestricted":0,"blocked":0}]'::jsonb, '[]'::jsonb, 'Adm'));
create temp table l113 (id uuid); grant all on l113 to authenticated;
insert into l113 select l.id from stock_recon_lines l where l.recon_id = (select (v#>>'{}')::uuid from r113 where k = 'recon') and l.sku = '550058593';
select pg_temp.check('the reconciliation line exists with a gap against SAP (WMS holds more than SAP 0)',
  (select count(*) = 1 from l113));

insert into r113 select 'line_in', mia_move_in((select r1 from f113), '550058593', 'T113', '2030-01-01', 5, 'tidak ada di rak', 'Adm', (select id from l113));
select pg_temp.check('rack -> MIA from a line: wms_fix -5, cause MIA, status EXPLAINED or RESOLVED',
  (select l.wms_fix = -5 and l.cause = 'MIA' and l.status in ('EXPLAINED', 'RESOLVED') from stock_recon_lines l where l.id = (select id from l113)));
insert into r113 select 'line_book', mia_book('550058593', 'B113', '2031-01-01', 2, 'belum ketemu', 'Adm', (select id from l113));
select pg_temp.check('mia_book from a line leaves wms_fix alone (MIA is not our side of the comparison)',
  (select l.wms_fix = -5 and l.status = 'EXPLAINED' from stock_recon_lines l where l.id = (select id from l113)));
insert into r113 select 'line_find', mia_find((select r2 from f113), '550058593', 'T113', '2030-01-01', 2, 'ketemu', 'Adm', (select id from l113));
select pg_temp.check('found from a line: wms_fix goes back up by 2',
  (select l.wms_fix = -3 from stock_recon_lines l where l.id = (select id from l113)));

reset role;
rollback;
