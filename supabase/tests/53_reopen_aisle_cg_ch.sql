-- Aisles CG and CH physically exist (CKB 3PL area, confirmed on the floor
-- 21 Oct 2026). 0086 reactivates CG, creates CH as an exact mirror of CG's
-- grid, and gives both birds-eye 3D coordinates via the layout aisle_order.
-- This is the current-truth counterpart to 29_block_aisle_cg.sql, which
-- pins 0054's own mechanics in isolation. Runs in a transaction, rolls back.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;

select pg_temp.check('every CG bin is active, none deleted',
  (select count(*) from bins where bin_code like 'CG%') = (select count(*) from bins where bin_code like 'CG%' and status = 'active')
  and (select count(*) from bins where bin_code like 'CG%') >= 400);

select pg_temp.check('every CG rack bin has an active CH twin with the same rack/level/position',
  not exists (
    select 1 from bins cg
    where cg.bin_code ~ '^CG\d{2}[A-E]\d{2}$'
      and not exists (
        select 1 from bins ch
        where ch.bin_code = 'CH' || substring(cg.bin_code from 3)
          and ch.zone = 'CH' and ch.rack = cg.rack and ch.level = cg.level
          and ch.position = cg.position and ch.status = 'active')));

select pg_temp.check('CH rack-bin count equals CG rack-bin count',
  (select count(*) from bins where bin_code ~ '^CG\d{2}[A-E]\d{2}$')
  = (select count(*) from bins where bin_code ~ '^CH\d{2}[A-E]\d{2}$'));

select pg_temp.check('layout aisle_order contains CG and CH',
  exists (select 1 from settings where key = 'layout' and (value->'aisle_order') ? 'CG')
  and exists (select 1 from settings where key = 'layout' and (value->'aisle_order') ? 'CH'));

select pg_temp.check('every CG/CH rack bin has 3D coordinates (pos_x)',
  (select count(*) from bins
   where (bin_code like 'CG%' or bin_code like 'CH%')
     and rack is not null and pos_x is null) = 0);

select pg_temp.check('CG and CH bins show in Bin kosong (empty, not hidden)',
  exists (select 1 from empty_bins where bin_code like 'CG%')
  and exists (select 1 from empty_bins where bin_code like 'CH%'));

rollback;
