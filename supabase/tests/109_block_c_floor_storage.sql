-- Block C floor storage (0147): slots, dedicated SKUs, stack height, the one movement guard and the import.
-- Runs in a transaction and rolls back. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users values
  ('a1091111-1111-1111-1111-111111111111','adm109@x','{"name":"Admin 109"}'),
  ('a1092222-2222-2222-2222-222222222222','sup109@x','{"name":"Sup 109"}'),
  ('a1093333-3333-3333-3333-333333333333','op109@x','{"name":"Op 109"}') on conflict do nothing;
update profiles set role = 'admin' where id = 'a1091111-1111-1111-1111-111111111111';
update profiles set role = 'supervisor' where id = 'a1092222-2222-2222-2222-222222222222';
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when coalesce(ok, false) then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.fails(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then
  if sqlerrm not like p_like then raise notice 'got: %', sqlerrm; end if;
  return sqlerrm like p_like; end $$;
create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', p::text, true); end $$;
create or replace function pg_temp.mv(p_type text, p_sku text, p_qty numeric, p_to text, p_from text default null)
returns void language sql as $$
  insert into movements (type, item_id, batch_lot, quantity, from_bin_id, to_bin_id, expiry_date, note)
  select p_type::movement_type, it.id, 'B109', p_qty, (select id from bins where bin_code = p_from),
         (select id from bins where bin_code = p_to), date '2031-01-01', 'tes 109'
  from items it where it.sku = p_sku $$;
create or replace function pg_temp.at(p_bin text, p_sku text) returns numeric language sql as $$
  select coalesce(sum(i.quantity), 0) from inventory i join bins b on b.id = i.bin_id join items it on it.id = i.item_id
  where b.bin_code = p_bin and it.sku = p_sku $$;
grant execute on function pg_temp.check(text, boolean), pg_temp.fails(text, text), pg_temp.as_user(uuid),
  pg_temp.mv(text, text, numeric, text, text), pg_temp.at(text, text) to authenticated;
create temp table r109 (k text primary key, v jsonb);
grant all on r109 to authenticated;

-- Fixture: three SKUs of 50 cartons per pallet, and one empty active Shell rack bin for the Oso 5 side.
insert into items (sku, description, uom, upp) values
  ('T109A', 'Block C SKU A', 'CAR', 50), ('T109B', 'Block C SKU B', 'CAR', 50), ('T109C', 'Oso 5 SKU C', 'CAR', 50);
select set_config('t109.rack', (select b.bin_code from bins b
  where b.bin_code ~ '^C[A-F]\d{2}[A-E]\d{2}$' and b.status = 'active' and b.owner = 'SHELL'
    and not exists (select 1 from inventory i where i.bin_id = b.id) order by b.bin_code limit 1), true);
select pg_temp.check('fixture: an empty Shell rack bin exists', current_setting('t109.rack') <> '');

set role authenticated;

-- 1  Planning -----------------------------------------------------------------------------------------------------
select pg_temp.as_user('a1092222-2222-2222-2222-222222222222');
select pg_temp.check('a supervisor cannot plan Block C slots',
  pg_temp.fails($q$select plan_block_c_slots(array['FA','FB'], 20, 'slot baru', 'Sup')$q$, '%admin%'));
select pg_temp.as_user('a1091111-1111-1111-1111-111111111111');
select pg_temp.check('a lane must look like FA, a count 1-99, a reason is required',
  pg_temp.fails($q$select plan_block_c_slots(array['CA'], 20, 'x', 'Adm')$q$, 'Jalur%')
  and pg_temp.fails($q$select plan_block_c_slots(array['FA'], 0, 'x', 'Adm')$q$, '%1-99%')
  and pg_temp.fails($q$select plan_block_c_slots(array['FA'], 20, '', 'Adm')$q$, 'Alasan%'));
insert into r109 select 'p', plan_block_c_slots(array['FA','FB'], 20, 'gedung Block C', 'Adm');
select pg_temp.check('40 slots are created, FA-01..FA-20 and FB-01..FB-20',
  (select (v->>'created')::int = 40 from r109 where k = 'p')
  and (select count(*) = 40 from bins where bin_code ~ '^F[AB]-\d{2}$')
  and exists (select 1 from bins where bin_code = 'FA-01') and exists (select 1 from bins where bin_code = 'FB-20'));
select pg_temp.check('slots are Block C floor bins: no rack, no owner, planned, no stack height yet',
  (select bool_and(site = 'BLOCKC' and rack is null and owner is null and block_kind = 'PLANNED' and capacity is null and assigned_sku is null)
     from bins where bin_code ~ '^F[AB]-\d{2}$'));
select pg_temp.check('every other bin stays Oso 5', (select bool_and(site = 'OSO5') from bins where bin_code !~ '^F[AB]-\d{2}$'));
select pg_temp.check('planning is logged in bin_changes (CREATED)',
  (select count(*) = 40 from bin_changes where field = 'CREATED' and new_value = 'PLANNED BLOCKC'));
select pg_temp.check('planning the same slots again is refused',
  pg_temp.fails($q$select plan_block_c_slots(array['FA','FB'], 20, 'lagi', 'Adm')$q$, 'Semua % slot itu sudah ada'));
select pg_temp.check('planning a wider lane only adds the new slots',
  (select (plan_block_c_slots(array['FA'], 22, 'tambah', 'Adm')->>'created')::int = 2));
select pg_temp.check('stock cannot enter a slot that is only planned',
  pg_temp.fails($q$select pg_temp.mv('inbound', 'T109A', 50, 'FA-01')$q$, '%belum dibangun%')
  or pg_temp.fails($q$select pg_temp.mv('inbound', 'T109A', 50, 'FA-01')$q$, '%belum punya SKU%'));
select pg_temp.check('admin activates the slots that are marked on the floor',
  (select (activate_planned(array['FA-01','FA-02','FA-03','FB-01'], 'garis cat selesai', 'Adm')->>'changed')::int = 4));

-- 2  Before any SKU is assigned: Oso 5 is unchanged, a slot with no SKU takes nothing ------------------------------
select pg_temp.as_user('a1092222-2222-2222-2222-222222222222');
select pg_temp.check('a slot with no SKU refuses stock',
  pg_temp.fails($q$select pg_temp.mv('inbound', 'T109A', 50, 'FA-01')$q$, '%belum punya SKU%'));
select pg_temp.mv('inbound', 'T109A', 100, current_setting('t109.rack'));
select pg_temp.check('before it is a Block C SKU, T109A may be in Oso 5 (today it is) — 100 cartons booked',
  pg_temp.at(current_setting('t109.rack'), 'T109A') = 100);

-- 3  Assigning SKUs ---------------------------------------------------------------------------------------------
select pg_temp.as_user('a1093333-3333-3333-3333-333333333333');
select pg_temp.check('an operator cannot assign a slot SKU',
  pg_temp.fails($q$select assign_block_c_slots(array['FA-01'], 'T109A', 3, 'x', 'Op')$q$, 'Hanya supervisor%'));
select pg_temp.as_user('a1092222-2222-2222-2222-222222222222');
select pg_temp.check('a reason, a known SKU and a stack height of 1 or more are required',
  pg_temp.fails($q$select assign_block_c_slots(array['FA-01'], 'T109A', 3, '', 'Sup')$q$, 'Alasan%')
  and pg_temp.fails($q$select assign_block_c_slots(array['FA-01'], 'NOPE', 3, 'x', 'Sup')$q$, 'SKU % tidak dikenal')
  and pg_temp.fails($q$select assign_block_c_slots(array['FA-01'], 'T109A', 0, 'x', 'Sup')$q$, 'Tinggi tumpukan%'));
insert into r109 select 'a1', assign_block_c_slots(array['FA-01','FA-02', current_setting('t109.rack')], 'T109A', 3, 'SKU lambat gerak', 'Sup');
select pg_temp.check('two slots assigned; a rack bin is refused (not a Block C slot)',
  (select (v->>'changed')::int = 2 and v->'refused'->0->>'reason' = 'bukan slot Block C' from r109 where k = 'a1'));
insert into r109 select 'a2', assign_block_c_slots(array['FB-01'], 'T109B', 2, 'SKU lambat gerak', 'Sup');
select pg_temp.check('the slot stores its SKU and stack height; the rack bin is untouched',
  (select assigned_sku = 'T109A' and capacity = 3 from bins where bin_code = 'FA-01')
  and (select assigned_sku = 'T109B' and capacity = 2 from bins where bin_code = 'FB-01')
  and (select assigned_sku is null from bins where bin_code = current_setting('t109.rack')));
select pg_temp.check('the assignment is logged (ATTR) with who and why',
  (select count(*) = 3 and bool_and(reason is not null and changed_by_name is not null)
     from bin_changes where field = 'ATTR' and bin_code in ('FA-01','FA-02','FB-01')));
select pg_temp.check('is_block_c_sku knows the assigned SKUs only',
  is_block_c_sku('T109A') and is_block_c_sku('T109B') and not is_block_c_sku('T109C'));

-- 4  The movement guard -------------------------------------------------------------------------------------------
select pg_temp.check('a slot takes only its own SKU',
  pg_temp.fails($q$select pg_temp.mv('inbound', 'T109B', 50, 'FA-01')$q$, 'Slot FA-01 khusus SKU T109A%')
  and pg_temp.fails($q$select pg_temp.mv('inbound', 'T109C', 50, 'FB-01')$q$, 'Slot FB-01 khusus SKU T109B%'));
select pg_temp.check('a slot with no SKU (FA-03) takes nothing',
  pg_temp.fails($q$select pg_temp.mv('inbound', 'T109A', 50, 'FA-03')$q$, '%belum punya SKU%'));
select pg_temp.mv('inbound', 'T109A', 100, 'FA-01');
select pg_temp.check('inbound of its SKU into its slot works: 100 cartons = 2 pallets', pg_temp.at('FA-01', 'T109A') = 100);
select pg_temp.check('stack height 3: a 4th pallet is refused, nothing is booked',
  pg_temp.fails($q$select pg_temp.mv('inbound', 'T109A', 100, 'FA-01')$q$, 'Slot FA-01 penuh%')
  and pg_temp.at('FA-01', 'T109A') = 100);
select pg_temp.mv('inbound', 'T109A', 50, 'FA-01');
select pg_temp.check('the 3rd pallet fits (150 cartons)', pg_temp.at('FA-01', 'T109A') = 150);
select pg_temp.check('a loose carton on top of a full stack is refused too (151 cartons = 4 pallets)',
  pg_temp.fails($q$select pg_temp.mv('inbound', 'T109A', 1, 'FA-01')$q$, 'Slot FA-01 penuh%'));
select pg_temp.mv('inbound', 'T109B', 100, 'FB-01');
select pg_temp.check('stack height 2 on FB-01: 100 cartons fit, the next carton does not',
  pg_temp.at('FB-01', 'T109B') = 100
  and pg_temp.fails($q$select pg_temp.mv('inbound', 'T109B', 1, 'FB-01')$q$, 'Slot FB-01 penuh%'));
select pg_temp.check('a Block C SKU cannot be received into an Oso 5 rack bin',
  pg_temp.fails(format($q$select pg_temp.mv('inbound', 'T109A', 10, %L)$q$, current_setting('t109.rack')), 'SKU T109A hanya untuk Block C%'));
select set_config('app.adjust_approved', 'on', true), set_config('app.adjust_reason', 'OPENING', true), set_config('app.by_name', 'Tes 109', true);
select pg_temp.check('nor into STAGING, nor by an adjustment',
  pg_temp.fails($q$select pg_temp.mv('inbound', 'T109A', 10, 'STAGING')$q$, 'SKU T109A hanya untuk Block C%')
  and pg_temp.fails(format($q$select pg_temp.mv('adjustment', 'T109A', 10, %L)$q$, current_setting('t109.rack')), 'SKU T109A hanya untuk Block C%'));
select set_config('app.adjust_approved', '', true), set_config('app.adjust_reason', '', true);
select pg_temp.mv('inbound', 'T109C', 20, current_setting('t109.rack'));
select pg_temp.check('any other SKU still goes to Oso 5 as before', pg_temp.at(current_setting('t109.rack'), 'T109C') = 20);
select pg_temp.check('...and never into a Block C slot, even an empty-looking one',
  pg_temp.fails($q$select pg_temp.mv('inbound', 'T109C', 10, 'FA-02')$q$, 'Slot FA-02 khusus SKU T109A%'));

-- 5  Bin To Bin: one way ------------------------------------------------------------------------------------------
select pg_temp.mv('transfer', 'T109A', 50, 'FA-02', current_setting('t109.rack'));
select pg_temp.check('Oso 5 -> its dedicated Block C slot works (the legacy stock moves out)',
  pg_temp.at('FA-02', 'T109A') = 50 and pg_temp.at(current_setting('t109.rack'), 'T109A') = 50);
select pg_temp.check('Oso 5 -> a slot of another SKU is refused',
  pg_temp.fails(format($q$select pg_temp.mv('transfer', 'T109A', 10, 'FB-01', %L)$q$, current_setting('t109.rack')), 'Slot FB-01 khusus SKU T109B%'));
select pg_temp.check('Block C -> Oso 5 is refused',
  pg_temp.fails(format($q$select pg_temp.mv('transfer', 'T109A', 10, %L, 'FA-02')$q$, current_setting('t109.rack')), 'SKU T109A hanya untuk Block C%')
  and pg_temp.at('FA-02', 'T109A') = 50);
select pg_temp.check('Block C -> a different Oso 5 SKU... also refused for any other Block C SKU (T109B)',
  pg_temp.fails($q$select pg_temp.mv('transfer', 'T109B', 10, 'STAGING', 'FB-01')$q$, 'SKU T109B hanya untuk Block C%'));
select pg_temp.mv('transfer', 'T109A', 50, 'FA-02', 'FA-01');
select pg_temp.check('inside Block C, between slots of the same SKU, a transfer works', pg_temp.at('FA-02', 'T109A') = 100 and pg_temp.at('FA-01', 'T109A') = 100);
select pg_temp.check('the stack height holds for transfers too: FA-02 (100) + 100 > 3 pallets',
  pg_temp.fails($q$select pg_temp.mv('transfer', 'T109A', 100, 'FA-02', 'FA-01')$q$, 'Slot FA-02 penuh%'));
select pg_temp.mv('transfer', 'T109A', 50, 'FA-02', current_setting('t109.rack'));
select pg_temp.check('leaving is never refused: the last Oso 5 cartons of T109A go out to Block C',
  pg_temp.at(current_setting('t109.rack'), 'T109A') = 0);

-- 6  Re-assigning ------------------------------------------------------------------------------------------------
select pg_temp.check('a slot holding stock of another SKU cannot be given a new SKU',
  (select assign_block_c_slots(array['FA-01'], 'T109B', 2, 'tukar', 'Sup')->'refused'->0->>'reason' = 'masih berisi SKU T109A'));
select pg_temp.check('nor cleared while it holds stock',
  (select assign_block_c_slots(array['FA-01'], '', null, 'kosongkan', 'Sup')->'refused'->0->>'reason' = 'masih berisi SKU T109A'));
select assign_block_c_slots(array['FA-03'], 'T109A', 3, 'slot tambahan', 'Sup') \g /dev/null
select pg_temp.check('an empty slot (FA-03) can be assigned', (select assigned_sku = 'T109A' and capacity = 3 from bins where bin_code = 'FA-03'));
select assign_block_c_slots(array['FA-03'], '', null, 'batal', 'Sup') \g /dev/null
select pg_temp.check('...and cleared again', (select assigned_sku is null and capacity is null from bins where bin_code = 'FA-03'));
select assign_block_c_slots(array['FA-01'], 'T109A', 4, 'tumpuk 4', 'Sup') \g /dev/null
select pg_temp.check('the same SKU can raise the stack height of a slot that holds it', (select capacity = 4 from bins where bin_code = 'FA-01'));

-- 7  Import: the file is physical truth ---------------------------------------------------------------------------
select pg_temp.as_user('a1091111-1111-1111-1111-111111111111');
insert into r109 select 'imp', import_snapshot(jsonb_build_array(
  jsonb_build_object('bin_code', current_setting('t109.rack'), 'zone', 'CA', 'rack', '01', 'level', 'A', 'position', '01',
    'sku', 'T109A', 'batch_lot', 'B109', 'quantity', 5, 'expiry_date', '2031-01-01'),
  jsonb_build_object('bin_code', 'FB-01', 'zone', 'FB', 'position', '01',
    'sku', 'T109A', 'batch_lot', 'B109', 'quantity', 7, 'expiry_date', '2031-01-01'),
  jsonb_build_object('bin_code', 'FB-30', 'zone', 'FB', 'position', '30',
    'sku', 'T109B', 'batch_lot', 'B109', 'quantity', 9, 'expiry_date', '2031-01-01')), false, 'test-109');
select pg_temp.check('the import books all three rows although the Block C rule would refuse them',
  pg_temp.at(current_setting('t109.rack'), 'T109A') = 5 and pg_temp.at('FB-01', 'T109A') = 7 and pg_temp.at('FB-30', 'T109B') = 9);
select pg_temp.check('...and reports each one with its reason',
  (select jsonb_array_length(v->'site_warnings') = 3
      and exists (select 1 from jsonb_array_elements(v->'site_warnings') w where w->>'bin_code' = current_setting('t109.rack') and w->>'reason' = 'BLOCKC_DI_OSO5')
      and exists (select 1 from jsonb_array_elements(v->'site_warnings') w where w->>'bin_code' = 'FB-01' and w->>'reason' = 'SLOT_LAIN')
      and exists (select 1 from jsonb_array_elements(v->'site_warnings') w where w->>'bin_code' = 'FB-30' and w->>'reason' = 'SLOT_TANPA_SKU')
   from r109 where k = 'imp'));
select pg_temp.check('a bin created by the import with a Block C code is a Block C slot',
  (select site = 'BLOCKC' and rack is null and owner is null from bins where bin_code = 'FB-30'));
select pg_temp.check('a planned slot is skipped and reported like any planned bin, never booked',
  (select (import_snapshot(jsonb_build_array(
      jsonb_build_object('bin_code', 'FA-20', 'zone', 'FA', 'position', '20', 'sku', 'T109A', 'batch_lot', 'B109', 'quantity', 3, 'expiry_date', '2031-01-01')),
      false, 'test-109b')->'skipped'->0->>'reason') = 'RENCANA'));
select pg_temp.as_user('a1092222-2222-2222-2222-222222222222');
select pg_temp.check('after the import the guard is on again',
  pg_temp.fails(format($q$select pg_temp.mv('inbound', 'T109A', 10, %L)$q$, current_setting('t109.rack')), 'SKU T109A hanya untuk Block C%'));

rollback;
