-- Putaway sheet import: classification, resolutions, re-upload safety.
-- Runs in a transaction and rolls back. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
-- Any operator and any supervisor (works on the stub and on a real local Supabase).
select set_config('t.op',  (select id::text from profiles where role = 'operator'   limit 1), false),
       set_config('t.sup', (select id::text from profiles where role = 'supervisor' limit 1), false);

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.qty(p_bin text, p_batch text) returns numeric language sql as $$
  select coalesce(sum(quantity), 0) from inventory_detail where bin_code = p_bin and batch_lot = p_batch $$;
create or replace function pg_temp.row_of(res jsonb, p_line int) returns jsonb language sql as $$
  select e from jsonb_array_elements(res->'rows') e where (e->>'line')::int = p_line $$;

-- Fixture: CG01A01 empty; CG01A02 holds P1 x10; CG01B01 holds another SKU.
delete from inventory where bin_id in (select id from bins where bin_code in ('CG01A01','CG01A02','CG01B01'));
insert into movements (type,item_id,batch_lot,quantity,to_bin_id,expiry_date,note)
select 'adjustment', (select id from items where sku=s), bt, q, (select id from bins where bin_code=b), '2031-05-05', 'fixture'
from (values ('CG01A02','550044709','P1',10),('CG01B01','550058593','X9',20)) v(b,s,bt,q);

create temp table sheet as select '[
  {"line":2,"bin_code":"CG01A01","sku":"550044709","batch_lot":"P1","quantity":24,"expiry_date":"2031-05-05"},
  {"line":3,"bin_code":"CG01A02","sku":"550044709","batch_lot":"P1","quantity":10,"expiry_date":"2031-05-05"},
  {"line":4,"bin_code":"CG01A02","sku":"550044709","batch_lot":"P1","quantity":12,"expiry_date":"2031-05-05","action":"set"},
  {"line":5,"bin_code":"CG01B01","sku":"550044709","batch_lot":"P1","quantity":4,"expiry_date":"2031-05-05"},
  {"line":6,"bin_code":"NOPE01","sku":"550044709","batch_lot":"P1","quantity":4,"expiry_date":"2031-05-05"},
  {"line":7,"bin_code":"CG01A01","sku":"999999999","batch_lot":"P1","quantity":4,"expiry_date":"2031-05-05"},
  {"line":8,"bin_code":"QUARANTINE","sku":"550044709","batch_lot":"P1","quantity":4,"expiry_date":"2031-05-05","action":"add"}
]'::jsonb as rows;
grant select on sheet to authenticated;

set role authenticated;
select set_config('request.jwt.claim.sub', current_setting('t.op'), false);
do $$ begin
  perform putaway_import((select rows from sheet), 'test', false);
  perform pg_temp.check('operator cannot import putaway', false);
exception when others then perform pg_temp.check('operator cannot import putaway', sqlerrm like 'Hanya supervisor%'); end $$;

select set_config('request.jwt.claim.sub', current_setting('t.sup'), false);
create temp table dry as select putaway_import((select rows from sheet), 'test', false) as res;
select pg_temp.check('preview: empty bin is new',          pg_temp.row_of(res, 2)->>'status' = 'new') from dry;
select pg_temp.check('preview: identical stock is same',   pg_temp.row_of(res, 3)->>'status' = 'same') from dry;
select pg_temp.check('preview: other qty is qty_differs, "set" kept',
  pg_temp.row_of(res, 4) @> '{"status":"conflict","kind":"qty_differs","action":"set"}') from dry;
select pg_temp.check('preview: other SKU in bin is bin_occupied and lists it',
  pg_temp.row_of(res, 5) @> '{"kind":"bin_occupied","current":[{"sku":"550058593","quantity":20}]}') from dry;
select pg_temp.check('preview: unknown bin / unknown SKU / blocked bin',
  pg_temp.row_of(res, 6)->>'kind' = 'bin_unknown' and pg_temp.row_of(res, 7)->>'kind' = 'sku_unknown'
  and pg_temp.row_of(res, 8)->>'kind' = 'bin_blocked') from dry;
select pg_temp.check('preview: "add" ignored where it does not apply (blocked bin)',
  pg_temp.row_of(res, 8)->'action' = 'null'::jsonb) from dry;
select pg_temp.check('preview changes nothing',
  pg_temp.qty('CG01A01','P1') = 0 and pg_temp.qty('CG01A02','P1') = 10 and (res->>'movements')::int = 0) from dry;

create temp table applied as select putaway_import((select rows from sheet), 'test', true) as res;
select pg_temp.check('apply: same verdicts as the preview',
  (select jsonb_agg(e - 'current') from jsonb_array_elements((select res from applied)->'rows') e)
  = (select jsonb_agg(e - 'current') from jsonb_array_elements((select res from dry)->'rows') e));
select pg_temp.check('apply: 2 movements (new putaway + set)', (res->>'movements')::int = 2) from applied;
select pg_temp.check('apply: CG01A01 received 24, CG01A02 set to 12, CG01B01 untouched',
  pg_temp.qty('CG01A01','P1') = 24 and pg_temp.qty('CG01A02','P1') = 12 and pg_temp.qty('CG01B01','P1') = 0);
select pg_temp.check('ledger: putaway row with the sheet line in the note',
  exists (select 1 from movements where type='putaway' and note = 'PUTAWAY test baris 2' and user_id = auth.uid()));

-- Re-uploading the same sheet posts nothing new.
select pg_temp.check('re-upload: line 2 now same, nothing posted',
  pg_temp.row_of(putaway_import((select rows from sheet) - 2, 'test', true), 2)->>'status' = 'same'
  and (select count(*) from movements where note like 'PUTAWAY test%') = 2);

-- "add" next to other stock.
select pg_temp.check('bin_occupied + add puts the pallet in beside the other SKU',
  (putaway_import(jsonb_build_array((select rows from sheet)->3 || '{"action":"add"}'), 'test', true)->>'movements')::int = 1
  and pg_temp.qty('CG01B01','P1') = 4 and pg_temp.qty('CG01B01','X9') = 20);
reset role;
rollback;
