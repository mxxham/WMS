-- =====================================================================
-- 0086  Aisles CG and CH exist — the CKB 3PL area reopens for the ledger
--
-- Reverses 0054's conclusion. 0054 (5 Oct 2026) blocked every CG bin on
-- the strength of the WMS sheet: its 400 CG rows are all Remain Qty 0,
-- which read like template rows for an aisle that is not there. That
-- reading was wrong. The Shell system does not manage the CKB 3PL goods,
-- so its sheet shows 0 for the 3PL aisles. On 21 Oct 2026, during the
-- rebagging rollout (the first flow to need CG as a source), the site
-- supervisor confirmed on the floor that aisles CG and CH physically
-- exist and hold the 3PL goods; a rebagging source line on CG15A02 had
-- just been refused by the shared 'blocked' rule.
--
-- What changes here:
--   * the CG grid (rack 01..40 × level A..E × position 01..02, the same
--     shape the sheet lists) is ensured and every CG bin becomes active
--     again — nothing is deleted, so any movement or old task that
--     references a CG bin keeps its reference;
--   * aisle CH is created as an exact mirror of CG: the sheet carries no
--     CH rows, so the grid is copied from the CG bins in the table
--     (for a fresh install this runs before the seed and both grids
--     come out of the same synthesis; the seed's on-conflict-do-nothing
--     then leaves them alone);
--   * CH joins layout aisle_order after CG and positions are recomputed,
--     so both aisles get 3D coordinates (CG keeps its coordinates: the
--     append does not shift earlier entries).
--
-- Shell picking is unchanged: the FEFO engine keeps CA–CF
-- (rackLocationPattern, lib/allocator/config.ts). CG/CH are valid ledger
-- locations — movements, rebagging source/output — but never Shell pick
-- routes. The 'warehouse mapping' status table will keep reading #N/A
-- for both aisles on every import; that is expected noise now.
--
-- Idempotent: safe to re-run on the same state.
-- =====================================================================

insert into public.bins (bin_code, zone, rack, level, position, status, capacity)
select 'CG' || to_char(r, 'FM00') || chr(64 + l) || to_char(p, 'FM00'), 'CG',
       to_char(r, 'FM00'), chr(64 + l), to_char(p, 'FM00'), 'active', 1
from generate_series(1, 40) r, generate_series(1, 5) l, generate_series(1, 2) p
on conflict (bin_code) do update set status = 'active';

update public.bins set status = 'active' where bin_code like 'CG%' and status <> 'active';

insert into public.bins (bin_code, zone, rack, level, position, status, capacity)
select 'CH' || substring(bin_code from 3), 'CH', rack, level, position, 'active', capacity
from public.bins where bin_code ~ '^CG\d{2}[A-E]\d{2}$'
on conflict (bin_code) do update set status = 'active';

update public.settings
   set value = jsonb_set(value, '{aisle_order}', (value->'aisle_order') || '"CH"'::jsonb),
       updated_at = now()
 where key = 'layout' and not ((value->'aisle_order') ? 'CH');

select public.recompute_bin_positions();
