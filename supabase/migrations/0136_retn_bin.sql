-- =====================================================================
-- 0136  RETN: a returns location, like SAP's RETN storage location
--
-- 10 Nov 2026: the user asked for a RETN bin. SAP books returned goods in
-- its own storage location RETN (lib/sap-compare.ts already reads it as
-- cause RETURN); the WMS had nowhere to put them but a rack or STAGING.
--
-- RETN is a floor location in its own zone RETURN: active, no rack, no owner
-- (shared, like STAGING). It is never picked: the allocator only picks rack
-- codes (rackLocationPattern), so returned stock stays out of FEFO until
-- someone moves it into a rack with Bin To Bin. Stock gets in and out only
-- through movements, as everywhere else.
--
-- Idempotent: safe to re-run on the same state.
-- =====================================================================

insert into public.bins (bin_code, zone, rack, level, position, status)
values ('RETN', 'RETURN', null, null, null, 'active')
on conflict (bin_code) do nothing;

insert into public.bin_changes (change_set, bin_code, field, old_value, new_value, reason, changed_by_name)
select gen_random_uuid(), 'RETN', 'CREATED', null, 'ACTIVE', 'Lokasi retur (RETN), seperti lokasi RETN di SAP', 'migrasi 0136'
where not exists (select 1 from public.bin_changes where bin_code = 'RETN' and field = 'CREATED');
