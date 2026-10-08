-- =====================================================================
-- 0068  check_shipment: add the wave destination
--
--  The selection screen groups by wave and shows truck, destination and
--  arrival slot. pick_audit_shipment carries the slot and truck but not the
--  destination, which lives on waves; join it in.
-- =====================================================================

create or replace view public.check_shipment with (security_invoker = true) as
select s.wave_id, s.wave_no, s.planned_date, s.planned_slot, s.planned_truck, s.shipment_number,
       s.state, s.todo, s.ok, s.mismatch, s.resolved, s.loaded_at, s.loaded_by_name, s.truck, s.load_legacy,
       cs.id as session_id, cs.checker_name, cs.started_at, cs.seal_number, w.destination
from public.pick_audit_shipment s
join public.waves w on w.id = s.wave_id
left join public.check_sessions cs
  on cs.wave_id = s.wave_id and cs.shipment_number = s.shipment_number and cs.status = 'open';

grant select on public.check_shipment to authenticated;
revoke all on public.check_shipment from anon;
