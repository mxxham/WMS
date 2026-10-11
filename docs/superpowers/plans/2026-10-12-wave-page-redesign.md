# Wave Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Wave page so phone and desktop each show what is urgent, which wave and what to do next with one obvious button per wave and line, every existing action one tap away, plus undo for a finished or cancelled wave without any `Remain Qty` problem.

**Architecture:** Pure next-step logic in `lib/wave-next-step.ts`; one white `ActionMenu` (bottom sheet on phone, centered panel on desktop, on the existing Radix dialog) hosting the existing self-contained action buttons; shared wave/line/day menus used by two layouts on `/waves` — the desktop layout (restructured `waves-client.tsx`) and a dedicated phone layout (`app/(app)/waves/mobile/`) chosen by viewport. Migration `0069` adds `restore_wave` / `reopen_wave` (+ read-only previews) and records which bulk action posted a line.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript strict, Tailwind + existing `components/ui`, Radix Dialog, Supabase PostgreSQL (plpgsql), standalone `tsx` tests, psql SQL tests.

**Spec:** `docs/superpowers/specs/2026-10-12-wave-page-redesign-design.md`

## Global Constraints

- Existing `DESIGN.md` tokens only: `ckb` #135F45 (primary), `steel` inks, `paper` background, `plate` #F9CF54 for bin plates, `ok`/`warn`/`bad` as the only semantic colours; IBM Plex Sans body, IBM Plex Sans Condensed (`font-cond`) for headings, numbers and bin codes; `rounded-md` controls, `rounded-lg` cards.
- No emojis or emoticons anywhere (UI strings, guide, labels, comments in UI). lucide icons only where an icon helps.
- UI strings Indonesian; code, comments and docs English.
- Every meaningful action keeps a confirmation step with a one-sentence summary (existing dialogs are reused).
- One primary (filled `ckb`) button per wave and per line at most; destructive items in `text-bad` after a divider.
- Tap targets ≥ 44 px on the phone layout; no horizontal scrolling and no tables on the phone layout.
- `Isi dari picklist` is unchanged and available on the **desktop layout only**; the phone layout never shows it.
- Stock only changes through `movements`; `0001`–`0068` are final (never edit); database changes go in `supabase/migrations/0069_wave_reopen.sql`.
- Tests: standalone `tsx` files with inline `test()` helper and `node:assert` strict, exit non-zero on failure, added to the `npm test` chain; SQL tests print PASS/FAIL per row and roll back.
- Never connect to the live database; browser checks run on the local Supabase stack only.

## Review Focus

1. **Reopen with undo when a bulk relocation's pickface was already picked from** — the transfer back cannot be made; expected: the whole reopen is refused with the line named and nothing changes. Test: Task 2 "reopen refuses when a bulk Bin To Bin can no longer be sent back; nothing changed".
2. **Restoring a wave twice / reopening twice** — expected: the second call is refused ("wave tidak dibatalkan" / "wave belum selesai") and changes nothing. Test: Task 2 rows "restore twice" and "reopen twice".
3. **A line re-posted by a picker after a reopen must never count as bulk** — expected: a later reopen leaves it posted. Test: Task 2 "a line re-posted after reopen is not bulk any more".
4. **Phone back button inside an open wave** — expected: returns to the day list, not off the page. Browser check in Task 7.
5. **A menu item whose action makes it disappear** (e.g. `Batalkan posting` turns the line open) — expected: the menu shows the line's new options after refresh, no stale button. Browser check in Task 6.

---

## File Structure

| File | Responsibility |
|---|---|
| `app/layout.tsx`, `app/globals.css` (modify) | `only light` colour scheme, `darkreader-lock` |
| `supabase/migrations/0069_wave_reopen.sql` (create) | `bulk_source`, stamp, `restore_wave(_preview)`, `reopen_wave(_preview)`, `complete_wave_by` stamps its source |
| `supabase/tests/41_wave_reopen.sql` (create) | database behaviour and Remain Qty guarantees |
| `lib/wave-next-step.ts` (create) + `tests/wave-next-step.test.ts` | next-step sentence and primary action per wave and for the day |
| `components/app/action-menu.tsx` (create) | the white menu (sheet / panel) and its row styling |
| `app/(app)/waves/guide.tsx` (create) | `Cara pakai` dialog (phone variant omits Isi dari picklist) |
| `app/(app)/waves/wave-menu.tsx` (create) | wave-level actions as menu rows, incl. `Buka lagi` / `Pulihkan wave` dialogs with previews |
| `app/(app)/waves/line-menu.tsx` (create) | line-level actions (moved out of `PairAction` / `TaskAction` / `MoreActions`) |
| `app/(app)/waves/day-bar.tsx` (create) | date arrows + calendar, counts, next-step sentence, day menu, guide link |
| `app/(app)/waves/problems-summary.tsx` (create) | collapsed `Perlu ditangani` line opening the existing panels |
| `app/(app)/waves/waves-client.tsx` (modify) | desktop layout + layout switch |
| `app/(app)/waves/mobile/day-screen.tsx`, `wave-screen.tsx` (create) | phone layout screens |
| `app/(app)/waves/page.tsx` (modify) | `wave` search param, recent plan dates for the arrows |
| `README.md` (modify) | 0069 + layout notes + test 41 |

---

### Task 1: Dropdowns stay light everywhere

**Files:** Modify `app/layout.tsx`, `app/globals.css`.

- [ ] **Step 1:** In `app/layout.tsx` change the viewport to `colorScheme: "only light"` and add to `export const metadata` (or the document head) `other: { "darkreader-lock": "" }` so Next renders `<meta name="darkreader-lock" content="">`. If `metadata` is not exported in that file, add it next to `viewport` without removing existing fields.
- [ ] **Step 2:** In `app/globals.css` change `html { … color-scheme: light; }` and `input, select, textarea, button { color-scheme: light; }` to `only light`. Above the `select::picker(select), ::picker(select)` rule add the comment `/* Only applies to selects opted into appearance: base-select; kept for when we do. */`.
- [ ] **Step 3:** `npm run typecheck && npm run lint` → clean. Build check: `npx next build` must succeed (metadata typing).
- [ ] **Step 4:** Commit `fix(ui): opt the app out of browser and OS auto dark mode` (+ trailer).

---

### Task 2: Undo a finished or cancelled wave (0069)

**Files:** Create `supabase/migrations/0069_wave_reopen.sql`, `supabase/tests/41_wave_reopen.sql`.

**Interfaces — Produces:**
- `pick_tasks.bulk_source text` (null | `selesaikan` | `sheet`), stamped by `stamp_pick_confirmation` from `app.pick_bulk_source` on every completion (overwritten, so a re-post by a person clears it).
- `restore_wave_preview(p_wave_id uuid) returns jsonb` → `{wave_no, lines:[{task_id, seq, task_type, sku, bin, batch_lot, quantity, free, covered}]}` (read-only).
- `restore_wave(p_wave_id uuid, p_by_name text, p_reason text) returns jsonb` → `{restored, lines:[…same…]}`.
- `reopen_wave_preview(p_wave_id uuid) returns jsonb` → `{wave_no, loaded:[shipment], bulk:[{task_id, seq, task_type, sku, bin, quantity, audited}]}`.
- `reopen_wave(p_wave_id uuid, p_by_name text, p_reason text, p_undo_bulk boolean) returns jsonb` → `{reopened: true, undone}`.

- [ ] **Step 1: Write the failing test** `supabase/tests/41_wave_reopen.sql` in the style of `supabase/tests/39_pick_line.sql` (begin; admin user `1111…`; `pg_temp.check`; `pg_temp.qty(bin, sku)`; a `pg_temp.stock()` returning `jsonb_object_agg(bin_code||'|'||sku||'|'||batch_lot, quantity)` over the test bins; rollback). Fixture: import stock for bins `CC20A01`, `CC20A02`, `CC21A01`, `CC21A02`, `CC22A01` (SKU `550070614`, batch `RW1`, 36 each, plus `CC20A02` empty pickface); `save_plan` date `2026-11-30` wave `1` (`SH1`) with: #1 PICK CC21A01 10; #2 PICK CC20A01 13 breaks_pallet + #3 REPLENISH CC20A01→CC20A02 23; #4 PICK CC21A02 5; #5 PICK CC22A01 4; wave `2` (`SH2`) with #1 PICK CC22A01 30. Rows (each a PASS/FAIL line):
  1. *picked one by one*: `post_task_by` for wave 1 #1 with `p_scanned 'CC21A01'`; *Isi dari picklist*: `post_wave_sheet` for #4 (5 from CC21A02); then `complete_wave_by(wave1, 'Ani')` → wave COMPLETED; check `bulk_source` = `selesaikan` on #2, #3, #5 only, `sheet` on #4, null on #1.
  2. `reopen_wave_preview` lists exactly #2, #3, #5 as bulk, `loaded` empty.
  3. reopen without undo: stock identical (`pg_temp.stock()` before = after), wave PENDING, its outbound PLANNED, every task still COMPLETED.
  4. close again (`complete_wave_by`) — nothing left to post, wave COMPLETED.
  5. reopen with undo: CC20A01 back to 36 (13 + 23 returned), CC20A02 back to 0, CC22A01 back by 4; CC21A01 and CC21A02 unchanged (still minus 10 and 5); #2 #3 #5 PLANNED; #1 #4 COMPLETED; outbound PLANNED; no movement on other bins.
  6. post → reopen-undo → post is a no-op: post #2/#3/#5 again with `post_task` (as admin), then compare `pg_temp.stock()` with the snapshot taken right after row 1's `complete_wave_by`: identical.
  7. *a line re-posted after reopen is not bulk*: after row 6, `bulk_source` of #2/#3/#5 is null; `complete_wave_by` again then `reopen_wave_preview` lists no bulk lines.
  8. *audited bulk line refuses*: new wave `3` (`SH3`) #1 PICK CC21A01 2, `complete_wave_by`, insert a `pick_audits` row for it (as in test 39), `reopen_wave(…, true)` raises; stock and statuses unchanged.
  9. *loaded shipment refuses*: insert a `shipment_loads` row for wave 3 `SH3`; `reopen_wave(…, false)` raises naming SH3; `reopen_wave_preview` lists SH3 in `loaded`.
  10. *a bulk Bin To Bin that can no longer be sent back refuses*: wave `4` (`SH4`) #1 PICK CC21A02 1 breaks_pallet + #2 REPLENISH CC21A02→CC22A02 rest; `complete_wave_by`; then a separate `post_task_by`-free pick drains the pickface (insert a `picking` movement from CC22A02 as admin for the whole rest); `reopen_wave(…, true)` raises; stock unchanged.
  11. *reopen twice*: second `reopen_wave` on an already PENDING wave raises; nothing changes.
  12. restore: wave `5` (`SH5`) with #1 PICK CC21A01 3 and #2 PICK CC21A02 3; `set_task_status(#2,'CANCELLED')` (single cancel, logs a TASK event); `set_wave_status(wave5,'CANCELLED')`; `restore_wave_preview` lists only #1 with `covered`; `restore_wave` → #1 PLANNED, #2 still CANCELLED, wave PENDING, outbound PLANNED, stock identical.
  13. *restore twice*: second `restore_wave` raises; nothing changes.
  14. *shortfall reported*: wave `6` (`SH6`) #1 PICK CC21A01 30; cancel the wave; then, as admin, insert a `picking` movement that takes CC21A01's remaining stock to 0; `restore_wave_preview` shows #1 `covered = false`; `restore_wave` still restores it (a warning, not a refusal) and stock is unchanged by the restore.
  15. refusals: missing name / missing reason / operator role → raise, nothing changes (one row each, as `do $$ … exception … $$` blocks like test 39).
- [ ] **Step 2:** `PGUSER=postgres scripts/sql-test.sh supabase/tests/41_wave_reopen.sql` → ERROR (functions missing).
- [ ] **Step 3: Write `0069_wave_reopen.sql`**:

```sql
-- =====================================================================
-- 0069  Undo a finished or cancelled wave
--
--  A supervisor who cancelled or finished a wave by mistake had no way back
--  (set_wave_status refuses a finished/cancelled wave). Both now can be
--  undone, with Remain Qty exact:
--  · restore_wave: the lines the wave cancel cancelled go back to the plan
--    (a line cancelled on its own stays cancelled); no movement at all.
--  · reopen_wave: the wave runs again; optionally the lines Selesaikan wave
--    posted in bulk are unposted through unpost_task (stock back to exactly
--    the bin, batch and expiry it left). Lines picked one by one or entered
--    with Isi dari picklist stay posted. Refused when a shipment is loaded
--    or a bulk line is audited; any refusal changes nothing.
--  · pick_tasks.bulk_source records which bulk action posted a line
--    (selesaikan / sheet); every completion overwrites it, so a line posted
--    again by a person is never bulk again.
-- =====================================================================

alter table public.pick_tasks add column bulk_source text check (bulk_source in ('selesaikan', 'sheet'));
```

  Then:
  - `stamp_pick_confirmation`: `create or replace` copying its latest definition (0068) exactly and adding inside the `if new.status = 'COMPLETED' and old.status is distinct from 'COMPLETED'` block: `new.bulk_source := nullif(current_setting('app.pick_bulk_source', true), '');`. Show the diff vs 0068 in the report.
  - `complete_wave_by`: `create or replace` copying 0024's definition exactly, adding `perform set_config('app.pick_bulk_source', 'selesaikan', true);` next to `app.pick_bulk 'on'` and resetting it to `''` with `app.pick_bulk`.
  - Sheet postings: `post_wave_sheet` (the client wrapper, 0067) gets `perform set_config('app.pick_bulk_source', 'sheet', true);` before calling `post_wave_sheet_rows` and resets it after. `post_pick_line` must not set it (picker lines are not bulk).
  - A helper `public.wave_bulk_lines(p_wave_id uuid) returns setof public.pick_tasks` (stable, security definer, revoked from clients): tasks of the wave with status COMPLETED and either `bulk_source = 'selesaikan'`, or (`bulk_source is null` and `bulk_posted` and `completed_at` = the `occurred_at` of the wave's last `execution_events` row with `entity_type='WAVE'` and `to_status='COMPLETED'`) — the second branch covers lines posted before 0069.
  - A helper `public.wave_cancelled_lines(p_wave_id uuid) returns setof public.pick_tasks`: tasks of the wave with status CANCELLED whose **last** `TASK` execution event is not `to_status='CANCELLED'` (no task event, or the last one is something else) — a line cancelled on its own keeps its own CANCELLED event and is excluded.
  - `restore_wave_preview` / `reopen_wave_preview` (stable, security definer, granted to authenticated): validate the status, build the JSON from the helpers; `free` = `sheet_have(bin)` minus the quantity of open tasks (`open_pick_tasks`) from that bin/item/batch/expiry; `covered = free >= quantity`.
  - `restore_wave(p_wave_id, p_by_name, p_reason)`: supervisor/admin; `person_name(p_by_name, 'Nama Anda')`; reason required (`'Alasan wajib diisi'`); `select … for update` the wave; status must be CANCELLED (`'Wave NO % tidak dibatalkan'`); compute the preview lines first; `update pick_tasks set status='PLANNED' where id in (select id from wave_cancelled_lines(w.id))` logging a TASK event per line (`log_execution_event('TASK', id, 'CANCELLED', 'PLANNED', format('wave dipulihkan oleh %s: %s', v_name, v_reason))`); `update outbound set status='PLANNED' where wave_id=w.id and status='CANCELLED'`; `update waves set status='PENDING'`; WAVE event CANCELLED→PENDING; return `{restored, lines}`.
  - `reopen_wave(p_wave_id, p_by_name, p_reason, p_undo_bulk)`: supervisor/admin; name; reason; lock wave; status must be COMPLETED (`'Wave NO % belum selesai'`); refuse when `exists (select 1 from shipment_loads where wave_id = w.id)` (`'Shipment % sudah dimuat: wave tidak bisa dibuka lagi'`); if `p_undo_bulk`: refuse when a bulk PICK has a `pick_audits` row (`'Baris #% sudah diaudit: batalkan lewat audit dulu'`); then `perform unpost_task(id, v_name, 'buka lagi: ' || v_reason)` for every bulk line **in descending seq** (later picks before the moves that fed them); finally `update outbound set status='PLANNED', completed_at=null where wave_id=w.id and status='COMPLETED'`; `update waves set status='PENDING' where id=w.id and status<>'PENDING'`; WAVE event COMPLETED→PENDING; return `{reopened:true, undone:n}`. Any raise rolls back everything.
  - Grants: the four public functions `revoke … from public, anon; grant … to authenticated`; helpers revoked from `public, anon, authenticated`.
- [ ] **Step 4:** Run test 41 → all PASS; run `PGUSER=postgres scripts/sql-test.sh` → every file 0 FAIL (39 and 40 unchanged).
- [ ] **Step 5:** Commit `feat(waves): Pulihkan wave and Buka lagi without Remain Qty changes (0069, test 41)`.

---

### Task 3: Next-step logic

**Files:** Create `lib/wave-next-step.ts`, `tests/wave-next-step.test.ts`; modify `package.json` (chain).

**Interfaces — Produces:**
```ts
export type WaveFacts = {
  id: string; wave_no: string; planned_slot: string | null;
  status: "PENDING" | "RESCHEDULED" | "COMPLETED" | "CANCELLED";
  open: number;        // live tasks still PLANNED
  total: number;       // live tasks (not cancelled)
  blocked: number;     // open tasks stok kurang or waiting for a Bin To Bin
  finishedAt?: string | null; cancelledAt?: string | null;
  audit?: { done: number; total: number } | null;
};
export type Primary = "mulai" | "lihat" | "tutup" | "aktifkan" | null;
export type NextStep = { tone: "normal" | "bad" | "muted"; text: string; primary: Primary };
export function waveNextStep(w: WaveFacts): NextStep;
export type DayFacts = { short: { wave_no: string }[]; requests: number; waiting: { wave_no: string }[] };
export type DayStep = { text: string; target: { kind: "problems" } | { kind: "wave"; id: string } | null };
export function dayNextStep(waves: WaveFacts[], d: DayFacts): DayStep;
export function waveOrder(waves: WaveFacts[]): WaveFacts[]; // running (PENDING, RESCHEDULED) by slot then NO, then COMPLETED, then CANCELLED
```

- [ ] **Step 1: Write the failing test** `tests/wave-next-step.test.ts` (repo test shape) asserting, for each spec §1.3 state, the exact Indonesian sentence and primary:
  - PENDING, open 21, blocked 0 → `{ tone: "normal", text: "Mulai picking: 21 baris belum diambil.", primary: "mulai" }`
  - PENDING, open 5, blocked 2 → `{ tone: "bad", text: "2 baris tertahan: perbaiki dulu.", primary: "lihat" }`
  - PENDING, open 0 → `{ tone: "normal", text: "Semua baris sudah diposting: tutup wave.", primary: "tutup" }`
  - RESCHEDULED → `{ tone: "muted", text: "Ditunda. Aktifkan untuk lanjut.", primary: "aktifkan" }`
  - COMPLETED finishedAt `2026-11-20T07:20:00+07:00`, audit 3/5 → `{ tone: "muted", text: "Selesai 07.20. Audit 3/5 shipment.", primary: null }` (time in Asia/Jakarta, `HH.mm`; audit sentence only when audit given)
  - CANCELLED cancelledAt 09.05 → `{ tone: "muted", text: "Dibatalkan 09.05.", primary: null }`
  - `dayNextStep` priority: short in NO 7 and NO 8 → `"2 baris stok kurang di NO 7 dan NO 8 harus diperbaiki dulu."` target problems; else requests 1 → `"1 permintaan dari picker menunggu supervisor."` target problems; else waiting in NO 2 → `"1 baris menunggu Bin To Bin di NO 2."` target problems; else first PENDING wave by slot with open > 0 → `"Mulai NO 2 (08:00): 27 baris."` target wave; else all finished/cancelled → `"Semua wave hari ini selesai."` target null; no waves → `"Belum ada rencana untuk hari ini."` target null.
  - Wave lists joined Indonesian style: one → `NO 7`; two → `NO 7 dan NO 8`; three+ → `NO 1, NO 2 dan NO 3`; repeated wave numbers counted once.
  - `waveOrder` puts PENDING/RESCHEDULED first by slot (nulls last) then numeric NO, then COMPLETED, then CANCELLED.
- [ ] **Step 2:** `npx tsx tests/wave-next-step.test.ts` → fails (module missing).
- [ ] **Step 3:** Implement `lib/wave-next-step.ts` (pure, no imports besides types; time formatting with `toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" })` normalised to `HH.mm`).
- [ ] **Step 4:** Test passes; add `tsx tests/wave-next-step.test.ts` to the `npm test` chain right after `tsx tests/pick-line.test.ts`; `npm run typecheck` clean.
- [ ] **Step 5:** Commit `feat(waves): next-step sentence per wave and for the day`.

---

### Task 4: Action menu and guide

**Files:** Create `components/app/action-menu.tsx`, `app/(app)/waves/guide.tsx`.

**Interfaces — Produces:** `ActionMenu({ title, trigger, children })`, `MenuSection({ children })`, `MenuDanger({ children })`, `MenuNote({ children })`; `WaveGuide({ variant: "desktop" | "phone" })`.

- [ ] **Step 1: `components/app/action-menu.tsx`**

```tsx
"use client";
import * as React from "react";
import { MoreHorizontal } from "lucide-react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The white action menu (0069 redesign): a bottom sheet on a phone, a centered panel on a desktop
 * (the existing dialog). Its rows are the existing self-contained action buttons; their own
 * confirmation dialogs open stacked on top of it, so every dialog is reused unchanged.
 */
export function ActionMenu({ title, trigger, children }: { title: string; trigger?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        {trigger ?? <Button variant="ghost" size="sm" className="h-11 px-3 text-steel-700"><MoreHorizontal className="h-5 w-5" />Lainnya</Button>}
      </DialogTrigger>
      <DialogContent title={title} className="bg-white text-steel sm:w-[24rem]">
        <div className="space-y-1">{children}</div>
      </DialogContent>
    </Dialog>
  );
}

/** Rows: every button inside becomes a full-width, 44 px, left-aligned row. */
export function MenuSection({ children }: { children: React.ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-1",
      "[&_button]:h-11 [&_button]:w-full [&_button]:justify-start [&_button]:gap-3 [&_button]:rounded-md",
      "[&_button]:border-0 [&_button]:bg-white [&_button]:px-3 [&_button]:text-left [&_button]:text-sm [&_button]:font-medium [&_button]:text-steel [&_button]:no-underline",
      "[&_button:hover]:bg-steel-100 [&_button:disabled]:opacity-50")}>{children}</div>
  );
}

export function MenuDanger({ children }: { children: React.ReactNode }) {
  return <div className="mt-2 border-t border-steel-100 pt-2 [&_button]:!text-bad"><MenuSection>{children}</MenuSection></div>;
}

export function MenuNote({ children }: { children: React.ReactNode }) {
  return <p className="px-3 pb-1 text-xs text-steel-500">{children}</p>;
}
```
  The `[&_button]` row styling must not leak into the stacked confirmation dialogs: those render in their own portal (outside the menu's DOM subtree) — verify in the browser (Task 6/7) that a confirmation's buttons keep their own variants.
- [ ] **Step 2: `app/(app)/waves/guide.tsx`** — `WaveGuide({ variant })`: a `Cara pakai` text button opening a `DialogContent title="Cara pakai halaman Wave"` with short sections (heading `font-cond text-lg`, 1–3 sentences each, plain Indonesian, no emojis): Mulai picking; Sesuai, Berbeda dan Ubah (scan label rak); Stok kurang; Menunggu Bin To Bin; Minta supervisor; Tutup wave; Tunda dan Aktifkan; Selesaikan wave (posting massal — hanya bila semua baris benar-benar sudah diambil); Buka lagi dan Pulihkan wave; Isi dari picklist (only when `variant === "desktop"`). Each section answers: kapan terjadi, apa yang ditekan, apa yang dilakukan sistem.
- [ ] **Step 3:** `npm run typecheck && npm run lint` clean.
- [ ] **Step 4:** Commit `feat(ui): white action menu and the Wave page guide`.

---

### Task 5: Shared wave building blocks

**Files:** Create `app/(app)/waves/wave-menu.tsx`, `line-menu.tsx`, `day-bar.tsx`, `problems-summary.tsx`; modify `waves-client.tsx` only to export what these need (types `Rpc`, `TaskWait`, `OutboundDetail`, and move `TundaButton`, `WaitNotice`, `CancelButton`, `Actual` out to where both layouts can import them, without changing their behaviour).

**Interfaces — Produces:**
- `WaveMenu({ wave, tasks, outbound, supervisor, rpc, layout, onOpenSheet, onPrint })` — rows, each shown under exactly the conditions the current header buttons use (`waves-client.tsx` WaveCard header): `Picklist` (onPrint), `Isi dari picklist` (only `layout === "desktop"` and `canSheet`), `Tambah item` (`AddItems`), `Selesaikan wave` (existing ConfirmButton, pending && open > 0), `Tunda` (`TundaButton`), `Aktifkan`, **`Buka lagi`** (supervisor, COMPLETED), **`Pulihkan wave`** (supervisor, CANCELLED); `MenuDanger`: `Batalkan wave`.
- `ReopenWaveButton({ wave })` — opens a dialog that loads `reopen_wave_preview`, shows: loaded shipments (then the action is disabled with the reason), the bulk lines (seq, SKU, bin, qty, audited flag), a checkbox **"Batalkan juga N baris yang diposting massal"** (default ticked; disabled with a note if any is audited), name field (`usePersonName`) and reason; summary sentence; calls `reopen_wave`; shows the result and refreshes.
- `RestoreWaveButton({ wave })` — loads `restore_wave_preview`, lists the lines that come back, marks those with `covered === false` in `text-bad` ("stok tidak cukup lagi: x tersedia"), name + reason; calls `restore_wave`; after success, if any line was not covered and the wave is untouched, offers `Hitung ulang` (the existing `replanRemaining` for that date).
- `LineMenu({ wave, item, short, wait, supervisor, rpc, layout })` — every action the current `PairAction` / `TaskAction` / `MoreActions` / row links offer, under the same conditions: `Berbeda` (the posting dialog in different mode — keep `TaskPostDialog`/`PairPostDialog` triggers), `Posting sesuai lapangan` and `Ubah baris` (`EditRowButton` modes), `Pecah` (`SplitButton`), `Posting Bin To Bin saja` (`PostMoveEarlyButton`), `Perbaiki` (`FixButton`), `Riwayat` (`RowHistory`), `Batalkan posting` (`UnpostButton` / `UnpostPairButton`), `Tambah Bin To Bin` (`AddMoveButton`), `Batal` (danger) / `Pulihkan tugas`. A line's visible primary stays outside the menu: `Posting` for an open postable line, or the `WaitNotice` / stok kurang text.
- `DayBar({ date, prevDate, nextDate, counts, step, supervisor, layout, dayMenu })` — arrows link to `/waves?date=<prev|next planned date>` (from page data), a calendar icon wrapping a native date input that navigates on change, `x/y baris diposting`, the day sentence (clickable when it has a target), `Cara pakai` (`WaveGuide variant=layout`) and the day `ActionMenu` (`Tambah order`, `PDF semua picklist`, `PDF Bin To Bin`, `Hitung ulang wave tersisa` under today's conditions).
- `ProblemsSummary({ counts, children })` — one line `Perlu ditangani` with `n stok kurang · n menunggu Bin To Bin · n hitung · n minta supervisor` (only non-zero parts, joined with ` · `), red when stok kurang or waiting > 0; `Lihat` toggles the children (the existing `ProblemsPanel`, `EscalationsPanel`, `CorrectionsPanel`); hidden when all zero.

- [ ] **Step 1:** Write the components; reuse every existing action component unchanged; no behaviour changes in dialogs.
- [ ] **Step 2:** Add a mapping check: in `tests/wave-actions-map.test.ts` (repo test shape) assert that a static list `WAVE_ACTIONS` / `LINE_ACTIONS` exported from `wave-menu.tsx` / `line-menu.tsx` (labels) contains every label from the old UI: wave `Picklist, Selesaikan wave, Tutup wave, Mulai picking, Isi dari picklist, Tambah item, Tunda, Aktifkan, Batalkan`; line `Posting, Berbeda, Posting sesuai lapangan, Ubah baris, Pecah, Posting Bin To Bin saja, Perbaiki, Riwayat, Batalkan posting, Tambah Bin To Bin, Batal, Pulihkan`; day `Tambah order, PDF semua picklist, PDF Bin To Bin, Hitung ulang wave tersisa`. Add it to the chain.
- [ ] **Step 3:** typecheck, lint, the new test, `npm test`.
- [ ] **Step 4:** Commit `feat(waves): wave, line and day menus; Buka lagi and Pulihkan wave dialogs`.

---

### Task 6: Desktop layout

**Files:** Modify `app/(app)/waves/waves-client.tsx`, `app/(app)/waves/page.tsx`.

- [ ] **Step 1: page data** — `page.tsx` also loads the nearest planned dates before and after `date` (`waves.planned_date` lt / gt, ordered, limit 1 each) and reads `searchParams.wave`; passes `prevDate`, `nextDate`, `openWave` to `WavesClient`. Remove the recent-dates link row.
- [ ] **Step 2: layout switch** — `WavesClient` decides the layout with a `useIsPhone()` hook (`window.matchMedia("(max-width: 767px)")`, SSR default desktop, updates on change) and renders `<WavesDesktop …/>` or `<WavesPhone …/>` (Task 7) with the same props. Until Task 7 lands, both render the desktop layout.
- [ ] **Step 3: desktop composition** (spec §1): `DayBar`; `ProblemsSummary` wrapping the existing panels; the filter as one search field + `Filter` toggle (existing `rowMatches` logic); the wave list in `waveOrder` order, each wave a card header row: `NO`, slot, shipments with their audit pills, `open/total baris` + progress bar, the `waveNextStep` sentence (tone → `text-steel` / `text-bad` / `text-steel-500`), the one primary button (`mulai` → open picking panel; `lihat` → open `ProblemsSummary` and scroll to it; `tutup` → existing `Tutup wave` ConfirmButton; `aktifkan` → existing ConfirmButton), and `WaveMenu`. Clicking the header (outside buttons) expands that wave and collapses any other (`openWave` state, mirrored to `?wave=` with `router.replace` without scroll). The expanded wave keeps the existing table (desktop) with one change: the actions column shows only the line's visible primary plus `LineMenu`; finished lines fold behind `N selesai — tampilkan`; the order table stays behind its existing toggle.
- [ ] **Step 4:** Remove the old per-wave header button row, the name field, the `MoreActions` inline panel and the always-expanded behaviour. Keep `PickingPanel` / `WaveSheetPanel` mounting exactly as today.
- [ ] **Step 5:** typecheck, lint, `npm test`.
- [ ] **Step 6: Browser check (desktop, 1440 × 900, local stack, date `2026-11-20`)** — start the app as in earlier sessions (`NEXT_DIST_DIR=.next/claude-dev`, local `API_URL/ANON_KEY/SERVICE_ROLE_KEY`, `SITE_ACCOUNT_EMAIL=claude-test@local.test`, `SITE_ACCOUNT_PASSWORD=claude-test-local-1`, port 3100; Playwright from `/home/ilham/.npm/_npx/86170c4cd1c5da32/node_modules/playwright-core` with chromium `~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`): screenshot; count buttons (target ≲ 60 with no wave open) and page height; open a wave, open a line menu, run `Batalkan posting` from it on a posted line and confirm the menu then shows the line's open-line options (Review Focus 5); walk the old-button checklist (each found in its menu). Clean up: kill the dev server by PID, `git checkout -- tsconfig.json`, `rm -rf .next/claude-dev`.
- [ ] **Step 7:** Commit `feat(waves): desktop Wave page with one action per wave and line`.

---

### Task 7: Phone layout

**Files:** Create `app/(app)/waves/mobile/day-screen.tsx`, `app/(app)/waves/mobile/wave-screen.tsx`; modify `waves-client.tsx` (render them when `useIsPhone()`).

- [ ] **Step 1: `DayScreen`** (spec §2.1): sticky top bar with date arrows (prev/next planned date), the date as text (`Jumat 20 Nov`), a calendar icon (native date input), a search icon toggling a search field, `Cara pakai` (`variant="phone"`), day `ActionMenu`; below: `x/y baris diposting`, the day sentence, `ProblemsSummary` (opening as a full-screen sheet), then the waves in `waveOrder` as tappable blocks (min 64 px; `NO`, slot, shipment numbers, `open/total` + thin bar, the next-step sentence; no buttons). Tapping a wave pushes `?wave=<id>` (`router.push`, so browser back returns).
- [ ] **Step 2: `WaveScreen`** (spec §2.2): sticky top bar with a back arrow (`router.back()` when the previous history entry is the day, else `router.replace` to the day URL), `NO · slot · shipment`, `WaveMenu layout="phone"` (no `Isi dari picklist`); progress and the wave sentence; lines as cards (yellow plate, SKU + description, batch/expiry, quantity with unit, state) — open first, finished folded behind `N selesai — tampilkan`; tapping a card opens its `LineMenu` (bottom sheet) while an open line's `Posting` stays on the card; a bottom bar pinned above the app's bottom navigation (`fixed inset-x-0 bottom-[<nav height>] z-30 bg-white/95 p-3 border-t`) holding the wave's primary as a full-width `h-14` button (hidden when none). `Mulai picking` opens `PickingPanel` full screen (`fixed inset-0 z-40 overflow-y-auto bg-paper`) with its own back.
- [ ] **Step 3: `Minta supervisor` on the phone** — `EscalationsPanel` receives `layout`; with `phone` it hides `Isi dari picklist` and keeps `Tutup`.
- [ ] **Step 4:** typecheck, lint, `npm test`.
- [ ] **Step 5: Browser check (390 × 844, local stack, `2026-11-20`)**: screenshot screen 1 and screen 2; count buttons on screen 1 (target: day bar controls only, no buttons in the wave list) and page height (target ≲ 2 screens); open a wave, press the browser back → day list (Review Focus 4), open again and use the on-screen back; the pinned primary is visible and within the bottom 120 px; open a line's sheet; `Isi dari picklist` appears nowhere on the phone layout; the stacked confirmation dialogs keep their own button styling; resize across 768 px with a wave open → the same wave stays open in the other layout. Clean up as in Task 6.
- [ ] **Step 6:** Commit `feat(waves): dedicated phone layout for the Wave page`.

---

### Task 8: Docs and full verification

**Files:** Modify `README.md`.

- [ ] **Step 1:** README: a `0069` bullet (Pulihkan wave / Buka lagi, bulk_source, Remain Qty guarantees) after the 0068 bullet; the test-41 line after test 40; a short note under the Wave page section on the two layouts, the one-action rule, the menus, `Cara pakai`, and `Isi dari picklist` being desktop only; mention the dropdown opt-out.
- [ ] **Step 2:** `npm test`, `npm run typecheck`, `npm run lint`, `PGUSER=postgres scripts/sql-test.sh` → all green.
- [ ] **Step 3: Before/after evidence** — screenshots of the old layout already exist in the scratchpad (`ui/desktop-fold.png`, `ui/mobile-fold.png`, `ui/desktop-wave.png`, `ui/mobile-wave.png`); capture the same four views after, plus the button count and page height for both layouts, and put the numbers in the report.
- [ ] **Step 4:** Commit `docs(readme): Wave page layouts, Pulihkan wave and Buka lagi (0069, test 41)`.
