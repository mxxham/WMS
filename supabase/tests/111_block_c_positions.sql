-- Block C in the 3D view (0148): the slots get their own coordinates from layout.block_c and do not disturb the
-- floor row of Oso 5. Runs in a transaction and rolls back. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users values ('a1111111-1111-1111-1111-111111111111','adm111@x','{"name":"Admin 111"}') on conflict do nothing;
update profiles set role = 'admin' where id = 'a1111111-1111-1111-1111-111111111111';
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when coalesce(ok, false) then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.near(a numeric, b numeric) returns boolean language sql as $$ select abs(a - b) < 0.0001 $$;
grant execute on function pg_temp.check(text, boolean), pg_temp.near(numeric, numeric) to authenticated;

-- Oso 5's floor positions before Block C exists (a snapshot to compare against).
create temp table before_floor as
  select bin_code, pos_x, pos_y, pos_z from public.bins where rack is null and site = 'OSO5' and zone <> 'MIA';  -- MIA (0152) is virtual: no floor position
grant select on before_floor to authenticated;
select pg_temp.check('fixture: Oso 5 has floor bins with coordinates', (select count(*) > 0 and bool_and(pos_x is not null) from before_floor));

set role authenticated;
set request.jwt.claim.sub = 'a1111111-1111-1111-1111-111111111111';
select plan_block_c_slots(array['FA','FB'], 20, 'gedung Block C', 'Adm') \g /dev/null
reset role;

select pg_temp.check('the layout carries a block_c section with defaults',
  (select value->'block_c'->>'slot_pitch_m' = '1.4' and value->'block_c'->'lanes' = '["FA","FB"]'::jsonb from settings where key = 'layout'));
select pg_temp.check('planning slots gives all 40 coordinates at once (no manual recompute)',
  (select count(*) = 40 and bool_and(pos_x is not null and pos_y is not null and pos_z is not null) from bins where site = 'BLOCKC'));
select pg_temp.check('FA-01 stands at the origin, on the floor',
  (select pg_temp.near(pos_x, 0) and pg_temp.near(pos_y, 0) and pg_temp.near(pos_z, 70) from bins where bin_code = 'FA-01'));
select pg_temp.check('slots follow along x by the pitch: FA-02 = +1.4, FA-20 = +26.6',
  (select pg_temp.near(pos_x, 1.4) from bins where bin_code = 'FA-02') and (select pg_temp.near(pos_x, 26.6) from bins where bin_code = 'FA-20'));
select pg_temp.check('row FB is a separate row: FB-01 is at the same x as FA-01, one lane gap (4 m) further in z',
  (select pg_temp.near(pos_x, 0) and pg_temp.near(pos_z, 74) from bins where bin_code = 'FB-01'));
select pg_temp.check('Block C is far from the racks: no rack bin shares its z',
  not exists (select 1 from bins r where r.rack is not null and r.pos_z is not null and abs(r.pos_z - 70) < 5));
select pg_temp.check('Oso 5 floor bins did not move (STAGING, QUARANTINE, STG_xx keep their coordinates)',
  not exists (select 1 from before_floor f join bins b on b.bin_code = f.bin_code
              where b.pos_x is distinct from f.pos_x or b.pos_z is distinct from f.pos_z));

-- A changed dimension moves every slot on the next recompute.
update settings set value = jsonb_set(jsonb_set(value, '{block_c,origin,x}', '10'), '{block_c,slot_pitch_m}', '2') where key = 'layout';
select public.recompute_bin_positions() \g /dev/null
select pg_temp.check('a new origin and pitch move the slots: FA-03 = 10 + 2 x 2',
  (select pg_temp.near(pos_x, 14) from bins where bin_code = 'FA-03'));

-- A new lane joins the layout and gets coordinates.
set role authenticated;
select plan_block_c_slots(array['FC'], 5, 'jalur baru', 'Adm') \g /dev/null
reset role;
select pg_temp.check('a new lane FC is appended to block_c.lanes and stands one more gap away (z = 78)',
  (select value->'block_c'->'lanes' = '["FA","FB","FC"]'::jsonb from settings where key = 'layout')
  and (select pg_temp.near(pos_z, 78) from bins where bin_code = 'FC-01'));

rollback;
