-- =====================================================================
-- 0156  Investigasi selisih: what a check would do, before it is saved
--
-- While a count is typed the page shows "kalau disimpan, selisih jadi X".
-- That number must be the one the fix plan really produces, not a guess: the
-- plan pairs surplus and shortfall per batch + expiry across every checked bin
-- (recon_fix_plan, 0129), so one more check can move other bins' lines too.
--
-- recon_check_preview records the check exactly like recon_check_bin, asks
-- recon_fix_plan for the plan, and rolls the check back (the work happens in
-- a sub-transaction that ends in an exception carrying the result). Nothing
-- is stored: no check row, no history. Same role rule as recon_check_bin.
-- =====================================================================

create or replace function public.recon_check_preview(p_line_id uuid, p_bin_code text, p_lines jsonb, p_by_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_plan jsonb; v_check jsonb; v_msg text; v_detail text;
begin
  begin
    v_check := public.recon_check_bin(p_line_id, p_bin_code, p_lines, null, p_by_name);
    v_plan := public.recon_fix_plan(p_line_id);
    raise exception 'RECON_PREVIEW' using detail = jsonb_build_object('check', v_check, 'plan', v_plan)::text;
  exception when others then
    get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
    if v_msg = 'RECON_PREVIEW' then return v_detail::jsonb; end if;
    raise;
  end;
end $$;

revoke execute on function public.recon_check_preview(uuid, text, jsonb, text) from public, anon;
grant execute on function public.recon_check_preview(uuid, text, jsonb, text) to authenticated;
