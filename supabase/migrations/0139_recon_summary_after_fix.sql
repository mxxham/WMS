-- =====================================================================
-- 0139  Rekonsiliasi SAP: a corrected line no longer counts as a gap
--
-- 15 Nov 2026: a SKU read +310, its stock was corrected by -310 from
-- Investigasi selisih, and the page still showed +310: the chart, the
-- Selisih column, the filters and the accuracy all read the day's gap
-- (diff_unrestricted / diff_blocked), while the correction only sat in
-- wms_fix as a small note ("dikoreksi -310 · sisa 0"). A reconciliation
-- that had been worked through looked untouched.
--
-- What is open on a line is now the day's gap plus what was posted
-- (recon_line_gap, 0129, already said so for the investigation itself).
-- The SAP / WMS quantities and diff_* stay the day's; only the reading
-- changes. This rebuilds stock_recon_summary on that rule, so the list of
-- reconciliations, the trend, Akurasi and the Dashboard agree with the
-- page (lib/sap-compare.ts `openGap` is the same arithmetic).
--
-- wms_fix is one number per line: it closes the free gap first, then the
-- blocked one, and anything left lands on free.
-- =====================================================================

-- Our side (+ = WMS holds more than SAP), free and blocked, after wms_fix.
create or replace function public.recon_line_open(p_diff_unrestricted numeric, p_diff_blocked numeric, p_fix numeric,
  out gap_unrestricted numeric, out gap_blocked numeric)
language plpgsql immutable as $$
declare u numeric := -coalesce(p_diff_unrestricted, 0); b numeric := -coalesce(p_diff_blocked, 0);
        f numeric := coalesce(p_fix, 0); t numeric;
begin
  if u <> 0 and f <> 0 and sign(u) <> sign(f) then
    t := sign(f) * least(abs(f), abs(u)); u := u + t; f := f - t;
  end if;
  if b <> 0 and f <> 0 and sign(b) <> sign(f) then
    t := sign(f) * least(abs(f), abs(b)); b := b + t; f := f - t;
  end if;
  gap_unrestricted := u + f;
  gap_blocked := b;
end $$;

-- Same columns, names and order as 0113: only what counts as a gap changes.
create or replace view public.stock_recon_summary with (security_invoker = true) as
select r.id, r.as_of, r.file_name, r.note, r.status, r.created_by, r.created_by_name, r.created_at,
       r.closed_by_name, r.closed_at, r.close_note, r.slocs, r.other_slocs, r.sap_moves, r.auto_gi_at, r.auto_gi_by_name,
       count(l.id) as skus,
       count(l.id) filter (where g.gap_unrestricted = 0 and g.gap_blocked = 0) as skus_match,
       round(100.0 * count(l.id) filter (where g.gap_unrestricted = 0 and g.gap_blocked = 0) / nullif(count(l.id), 0), 2) as accuracy_pct,
       coalesce(sum(abs(g.gap_unrestricted) + abs(g.gap_blocked)), 0) as abs_diff,
       coalesce(sum(l.sap_unrestricted + l.sap_blocked), 0) as sap_total,
       coalesce(sum(l.wms_unrestricted + l.wms_blocked), 0) as wms_total,
       count(l.id) filter (where (g.gap_unrestricted <> 0 or g.gap_blocked <> 0) and l.status in ('OPEN', 'COUNT_REQUESTED')) as open_diffs,
       count(l.id) filter (where g.gap_unrestricted + g.gap_blocked > 0) as skus_wms_more,
       count(l.id) filter (where g.gap_unrestricted + g.gap_blocked < 0) as skus_wms_less,
       coalesce(sum(g.gap_unrestricted + g.gap_blocked) filter (where g.gap_unrestricted + g.gap_blocked > 0), 0) as qty_wms_more,
       coalesce(-sum(g.gap_unrestricted + g.gap_blocked) filter (where g.gap_unrestricted + g.gap_blocked < 0), 0) as qty_wms_less,
       r.wms_at, r.wms_day
from public.stock_recons r
left join public.stock_recon_lines l on l.recon_id = r.id
left join lateral public.recon_line_open(l.diff_unrestricted, l.diff_blocked, l.wms_fix) g on true
group by r.id;

grant select on public.stock_recon_summary to authenticated;
revoke execute on function public.recon_line_open(numeric, numeric, numeric) from public, anon;
grant execute on function public.recon_line_open(numeric, numeric, numeric) to authenticated;
