-- Putaway draft (0089). Runs in a transaction and rolls back.
-- Run with scripts/sql-test.sh. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
set request.jwt.claim.sub = '';

-- Test users, inserted like 55_move_audit.sql — the seed ships only one
-- operator and one supervisor, never an admin, so role lookups cannot
-- build a three-role fixture. The stub's handle_new_user trigger creates
-- the profile rows for these auth.users.
insert into auth.users values
  ('11111111-1111-1111-1111-111111111111','op@x','{"name":"Operator"}'),
  ('22222222-2222-2222-2222-222222222222','sup@x','{"name":"Supervisor"}'),
  ('33333333-3333-3333-3333-333333333333','adm@x','{"name":"Admin"}') on conflict do nothing;
update profiles set role='operator'   where id='11111111-1111-1111-1111-111111111111';
update profiles set role='supervisor' where id='22222222-2222-2222-2222-222222222222';
update profiles set role='admin'      where id='33333333-3333-3333-3333-333333333333';

-- Helper: pg_temp.check(label, ok)
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;

-- Helper: fails(sql, regex) -> true if error message matches
create or replace function pg_temp.fails(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return sqlerrm ~ p_like; end $$;

-- Helper: count putaway_draft rows for current user
create or replace function pg_temp.draft_count() returns int language sql as $$
  select count(*) from putaway_draft $$;

-- =====================================================================
-- FIXTURES: ensure test users have ckb_3pl app and are active
-- =====================================================================
update profiles
set apps = array_append(apps, 'ckb_3pl'), active = true
where id in ('11111111-1111-1111-1111-111111111111'::uuid,
             '22222222-2222-2222-2222-222222222222'::uuid,
             '33333333-3333-3333-3333-333333333333'::uuid)
  and not ('ckb_3pl' = any(apps));

set role authenticated;

-- =====================================================================
-- TEST 1: Operator role -> refused on save (Hanya supervisor atau admin)
-- =====================================================================
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

select pg_temp.check('operator save FAILS',
  pg_temp.fails($q$select putaway_draft_save('test.xlsx', '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, 'test')$q$, 'Hanya supervisor'));

-- =====================================================================
-- TEST 2: Supervisor save -> load returns the rows
-- =====================================================================
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);

select putaway_draft_save('putaway-1.xlsx',
  '[{"line":1,"bin_code":"CA01A01","sku":"550044709","batch_lot":"B1","quantity":10,"expiry_date":"2030-12-31","error":null,"sheet_bin":null}]'::jsonb,
  '{"1":"add"}'::jsonb,
  '{"1":[{"sku":"550044709","batch_lot":"B1","expiry_date":"2030-12-31","quantity":10,"choice":"keep"}]}'::jsonb,
  'Supervisor Satu');

select pg_temp.check('supervisor save succeeded', pg_temp.draft_count() = 1);

select set_config('t.load1', putaway_draft_load()::text, false);
select pg_temp.check('load returns source', current_setting('t.load1')::jsonb->>'source' = 'putaway-1.xlsx');
select pg_temp.check('load returns by_name', current_setting('t.load1')::jsonb->>'by_name' = 'Supervisor Satu');
select pg_temp.check('load returns rows array', jsonb_typeof(current_setting('t.load1')::jsonb->'rows') = 'array');
select pg_temp.check('load returns 1 row', jsonb_array_length(current_setting('t.load1')::jsonb->'rows') = 1);
select pg_temp.check('load returns actions', current_setting('t.load1')::jsonb->'actions'->>'1' = 'add');
select pg_temp.check('load returns fixes', jsonb_array_length(current_setting('t.load1')::jsonb->'fixes'->'1') = 1);

-- =====================================================================
-- TEST 3: Same by_name save again -> upserts (1 row, not 2)
-- =====================================================================
select putaway_draft_save('putaway-1.xlsx',
  '[{"line":2,"bin_code":"CA01A02","sku":"550044709","batch_lot":"B2","quantity":20,"expiry_date":"2031-01-01","error":null}]'::jsonb,
  '{"2":"set"}'::jsonb,
  '{}'::jsonb,
  'Supervisor Satu');

select pg_temp.check('upsert keeps 1 row', pg_temp.draft_count() = 1);

select set_config('t.load2', putaway_draft_load()::text, false);
select pg_temp.check('load returns updated rows (2nd save)', jsonb_array_length(current_setting('t.load2')::jsonb->'rows') = 1);
select pg_temp.check('load returns updated actions', current_setting('t.load2')::jsonb->'actions'->>'2' = 'set');

-- =====================================================================
-- TEST 4: Second by_name creates 2 drafts
-- =====================================================================
select putaway_draft_save('putaway-2.xlsx',
  '[{"line":3,"bin_code":"CB01B01","sku":"550056224","batch_lot":"C1","quantity":5,"expiry_date":"2031-02-02","error":null}]'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb,
  'Supervisor Dua');

select pg_temp.check('second by_name creates 2 drafts', pg_temp.draft_count() = 2);

-- =====================================================================
-- TEST 5: Load returns most-recent (by updated_at)
-- =====================================================================
select pg_sleep(0.01); -- ensure updated_at differs
select putaway_draft_save('putaway-1-updated.xlsx',
  '[{"line":4,"bin_code":"CA01A01","sku":"550044709","batch_lot":"B3","quantity":30,"expiry_date":"2031-03-03","error":null}]'::jsonb,
  '{"4":"fix"}'::jsonb,
  '{"4":[{"sku":"550044709","batch_lot":"B3","expiry_date":"2031-03-03","quantity":30,"choice":"remove"}]}'::jsonb,
  'Supervisor Satu');

select pg_temp.check('still 2 drafts (same by_name updated)', pg_temp.draft_count() = 2);

select set_config('t.load3', putaway_draft_load()::text, false);
select pg_temp.check('load returns most recent by_name=Supervisor Satu', current_setting('t.load3')::jsonb->>'source' = 'putaway-1-updated.xlsx');
select pg_temp.check('load returns most recent actions', current_setting('t.load3')::jsonb->'actions'->>'4' = 'fix');

-- =====================================================================
-- TEST 6: Clear removes all drafts for the account
-- =====================================================================
select putaway_draft_clear();
select pg_temp.check('clear returns cleared count', (putaway_draft_clear())::jsonb->>'cleared' = '0'); -- already cleared

-- Re-create two drafts
select putaway_draft_save('a.xlsx', '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, 'name1');
select putaway_draft_save('b.xlsx', '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, 'name2');
select pg_temp.check('two drafts before clear', pg_temp.draft_count() = 2);

select set_config('t.cleared', putaway_draft_clear()::text, false);
select pg_temp.check('clear removed both', current_setting('t.cleared')::jsonb->>'cleared' = '2');
select pg_temp.check('draft count now 0', pg_temp.draft_count() = 0);
select pg_temp.check('load returns null after clear', putaway_draft_load() is null);

-- =====================================================================
-- TEST 7: Anon cannot select the table
-- =====================================================================
set role anon;
select pg_temp.check('anon cannot select putaway_draft',
  pg_temp.fails('select * from putaway_draft', 'permission denied'));

-- =====================================================================
-- CLEANUP
-- =====================================================================
reset role; set request.jwt.claim.sub = '';
rollback;