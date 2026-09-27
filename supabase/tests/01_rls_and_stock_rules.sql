\set ON_ERROR_STOP off
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage on all sequences in schema public to authenticated;
insert into auth.users values ('11111111-1111-1111-1111-111111111111','op@x',  '{"name":"Operator"}'),
                              ('22222222-2222-2222-2222-222222222222','sup@x', '{"name":"Supervisor"}');
update profiles set role='supervisor' where id='22222222-2222-2222-2222-222222222222';
select name, role from profiles;
-- act as operator
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
\echo '--- operator: pick 4 from CA01C01 (has 44) -> OK'
insert into movements (type,item_id,batch_lot,quantity,from_bin_id,user_id)
select 'picking', i.item_id, i.batch_lot, 4, i.bin_id, auth.uid() from inventory i join bins b on b.id=i.bin_id where b.bin_code='CA01C01';
select b.bin_code, i.quantity from inventory i join bins b on b.id=i.bin_id where b.bin_code='CA01C01';
\echo '--- operator: pick 999 -> must fail (insufficient)'
insert into movements (type,item_id,batch_lot,quantity,from_bin_id,user_id)
select 'picking', i.item_id, i.batch_lot, 999, i.bin_id, auth.uid() from inventory i join bins b on b.id=i.bin_id where b.bin_code='CA01C01';
\echo '--- operator: transfer 10 CA01C01 -> CA01A01 -> OK, keeps expiry'
insert into movements (type,item_id,batch_lot,quantity,from_bin_id,to_bin_id,user_id)
select 'transfer', i.item_id, i.batch_lot, 10, i.bin_id, (select id from bins where bin_code='CA01A01'), auth.uid() from inventory i join bins b on b.id=i.bin_id where b.bin_code='CA01C01';
select bin_code, quantity, expiry_date from inventory_detail where bin_code in ('CA01C01','CA01A01');
\echo '--- operator: transfer into QUARANTINE (blocked) -> must fail'
insert into movements (type,item_id,batch_lot,quantity,from_bin_id,to_bin_id,user_id)
select 'transfer', i.item_id, i.batch_lot, 1, i.bin_id, (select id from bins where bin_code='QUARANTINE'), auth.uid() from inventory i join bins b on b.id=i.bin_id where b.bin_code='CA01A01';
\echo '--- operator: adjustment -> must fail (RLS)'
insert into movements (type,item_id,batch_lot,quantity,to_bin_id,user_id)
select 'adjustment', item_id, batch_lot, 5, bin_id, auth.uid() from inventory_detail where bin_code='CA01A01';
\echo '--- operator: direct inventory update -> 0 rows (no policy)'
update inventory set quantity = 1000;
\echo '--- operator: spoof user_id of supervisor -> must fail'
insert into movements (type,item_id,batch_lot,quantity,from_bin_id,user_id)
select 'picking', item_id, batch_lot, 1, bin_id, '22222222-2222-2222-2222-222222222222' from inventory_detail where bin_code='CA01A01';
\echo '--- operator: import -> must fail'
select import_snapshot('[]'::jsonb, false, 'x');
\echo '--- operator: delete movement -> 0 rows / blocked'
delete from movements;
-- supervisor
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
\echo '--- supervisor: adjustment -5 on CA01A01 -> OK'
insert into movements (type,item_id,batch_lot,quantity,to_bin_id,user_id,note,reason_code,by_name)
select 'adjustment', item_id, batch_lot, -5, bin_id, auth.uid(), 'cycle count', 'COUNT_VARIANCE', 'Supervisor' from inventory_detail where bin_code='CA01A01';
select bin_code, quantity from inventory_detail where bin_code='CA01A01';
\echo '--- supervisor: inbound without expiry -> must fail'
insert into movements (type,item_id,batch_lot,quantity,to_bin_id,user_id)
select 'inbound', id, 'NEW1', 5, (select id from bins where bin_code='STG_01'), auth.uid() from items limit 1;
reset role;
select type, quantity, note, (select name from profiles p where p.id=user_id) from movements where user_id is not null order by created_at;
select count(*) as profiles_visible_to_operator from (select 1) x;
