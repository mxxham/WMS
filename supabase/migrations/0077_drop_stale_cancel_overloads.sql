-- 0077 — drop the two cancel-path overloads that 0074 superseded but could not replace.
--
-- `create or replace function` only replaces a function with the *same* argument list. When 0074
-- widened the pallet-break helpers it added an argument, so the database kept both shapes running
-- side by side:
--
--   complete_open_pallet(uuid, text, text)          (0073 — the pre-0074 leftover lookup)
--   complete_open_pallet(uuid, text, text, uuid)    (0074 — the aligned lookup, p_ignore_wave)
--
-- each calling its own version of open_pallet_leftovers. The old pair is an island: the only caller
-- of the one-argument open_pallet_leftovers was the three-argument complete_open_pallet, and every
-- live call site passes four arguments (0074's set_task_status at :178 and set_wave_status at :211,
-- confirmed against the schema dump of the live database). The old complete_open_pallet was still
-- granted to `authenticated` though, so a direct RPC call with three arguments would have run the
-- unaligned lookup 0074 replaced — which is how a residue repair could move the wrong row.
--
-- Nothing in the app, the tests, or the migrations calls the old signatures. Live signatures are
-- untouched. Guarded by supabase/tests/49_no_stale_cancel_overloads.sql.

drop function if exists public.complete_open_pallet(uuid, text, text);
drop function if exists public.open_pallet_leftovers(uuid);
