-- Investigasi claims (0155): one live claim per reconciliation line, soft (take-over allowed), stale after 30 minutes,
-- keyed on the typed name, no write policy. Runs in a transaction and rolls back. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users values
  ('a1151111-1111-1111-1111-111111111111','inv115@x','{"name":"Inv 115"}'),
  ('a1152222-2222-2222-2222-222222222222','opr115@x','{"name":"Opr 115"}') on conflict do nothing;
update profiles set job = 'inventory' where id = 'a1151111-1111-1111-1111-111111111111';
update profiles set job = 'operator' where id = 'a1152222-2222-2222-2222-222222222222';
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when coalesce(ok, false) then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.fails(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then
  if sqlerrm not like p_like then raise notice 'got: %', sqlerrm; end if;
  return sqlerrm like p_like; end $$;
create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', p::text, true); end $$;
grant execute on function pg_temp.check(text, boolean), pg_temp.fails(text, text), pg_temp.as_user(uuid) to authenticated;
create temp table r115 (k text primary key, v jsonb);
grant all on r115 to authenticated;

-- Fixture: a reconciliation with one line.
set role authenticated;
select pg_temp.as_user('a1151111-1111-1111-1111-111111111111');
create temp table l115 (id uuid); grant all on l115 to authenticated;
create temp table rc115 (id uuid); grant all on rc115 to authenticated;
insert into rc115 select create_stock_recon(current_date, 'uji 115', null,
  '[{"sku":"550058593","description":"x","uom":"CAR","unrestricted":0,"blocked":0}]'::jsonb, '[]'::jsonb, 'Ani');
insert into l115 select l.id from stock_recon_lines l where l.recon_id = (select id from rc115) and l.sku = '550058593';

-- ---------------------------------------------------------------------
-- 1  Claim, refresh, someone else
-- ---------------------------------------------------------------------
insert into r115 select 'a', recon_claim((select id from l115), 'Ani');
select pg_temp.check('the first claim is OK and shows in the active view',
  (select v->>'status' = 'OK' from r115 where k = 'a')
  and (select count(*) = 1 from recon_claims_active where line_id = (select id from l115) and by_name = 'Ani'));

insert into r115 select 'a2', recon_claim((select id from l115), '  ani  ');
select pg_temp.check('the same person (any case, spaces) refreshes the claim and keeps claimed_at',
  (select v->>'status' = 'OK' from r115 where k = 'a2')
  and (select count(*) = 1 and bool_and(by_name = 'ani') from recon_claims where line_id = (select id from l115)));

insert into r115 select 'b', recon_claim((select id from l115), 'Budi');
select pg_temp.check('another name is told TAKEN and does not overwrite',
  (select v->>'status' = 'TAKEN' and v->>'by_name' = 'ani' from r115 where k = 'b')
  and (select by_name = 'ani' from recon_claims where line_id = (select id from l115)));

insert into r115 select 'c', recon_claim((select id from l115), 'Budi', true);
select pg_temp.check('take over replaces the holder and says who it was',
  (select v->>'status' = 'OK' and v->>'taken_over_from' = 'ani' from r115 where k = 'c')
  and (select by_name = 'Budi' from recon_claims where line_id = (select id from l115)));

-- ---------------------------------------------------------------------
-- 2  Release and stale
-- ---------------------------------------------------------------------
select recon_release((select id from l115), 'Ani');
select pg_temp.check('releasing someone else''s claim does nothing',
  (select count(*) = 1 from recon_claims where line_id = (select id from l115)));
select recon_release((select id from l115), 'budi');
select pg_temp.check('releasing your own claim removes it',
  (select count(*) = 0 from recon_claims where line_id = (select id from l115)));

select recon_claim((select id from l115), 'Ani');
reset role;
update recon_claims set last_seen_at = now() - interval '31 minutes' where line_id = (select id from l115);
set role authenticated;
select pg_temp.as_user('a1151111-1111-1111-1111-111111111111');
select pg_temp.check('a claim not seen for 31 minutes is not in the active view',
  (select count(*) = 0 from recon_claims_active where line_id = (select id from l115)));
insert into r115 select 'd', recon_claim((select id from l115), 'Budi');
select pg_temp.check('and anyone can claim it without taking over',
  (select v->>'status' = 'OK' and v->>'taken_over_from' is null from r115 where k = 'd'));

-- ---------------------------------------------------------------------
-- 3  Who may, and no direct writes
-- ---------------------------------------------------------------------
select pg_temp.as_user('a1152222-2222-2222-2222-222222222222');   -- an operator
select pg_temp.check('an operator cannot claim',
  pg_temp.fails($q$select recon_claim((select id from l115), 'Opr')$q$, '%supervisor atau admin%'));
select pg_temp.as_user('a1151111-1111-1111-1111-111111111111');
select pg_temp.check('a name is required',
  pg_temp.fails($q$select recon_claim((select id from l115), ' ')$q$, '%wajib diisi%'));
create or replace function pg_temp.try_write() returns void language plpgsql as $$
begin
  begin update recon_claims set by_name = 'x'; exception when others then null; end;
  begin delete from recon_claims; exception when others then null; end;
  begin insert into recon_claims (line_id, by_name) select id, 'x' from l115; exception when others then null; end;
end $$;
grant execute on function pg_temp.try_write() to authenticated;
select pg_temp.try_write();
select pg_temp.check('the app role cannot write recon_claims directly',
  (select count(*) = 1 and bool_and(by_name = 'Budi') from recon_claims where line_id = (select id from l115)));

reset role;
rollback;
