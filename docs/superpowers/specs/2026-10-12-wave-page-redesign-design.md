# Wave page redesign — design

Date: 2026-10-12 · Branch: `feat/independent-stock` · Scope: the Wave page (`app/(app)/waves/`), undoing a
finished or cancelled wave (migration `0069`), and the light-only opt-out for dropdowns.

## Goal

A picker or supervisor opening the Wave page on a phone sees, in this order, what is urgent, which wave,
and what to do next — with one obvious button per wave and per line. Every current feature stays
reachable; only where it lives changes. A finished or cancelled wave can be undone without any
`Remain Qty` problem.

## Measured problem (real 9-wave day, local stack, 9 Oct plan)

- 939 buttons on the page, ~212 inside one wave; phone page 25,375 px tall (~30 screens).
- Each wave header: 7–8 equal-weight buttons (`Picklist`, `Selesaikan wave`, `Mulai picking`,
  `Isi dari picklist`, `Tambah item`, `Tunda`, `Batalkan`), two filled green competing.
- Every line of every wave always rendered, each with `Posting` + `⋯`; finished lines still carry
  `Batalkan posting`, `Tambah Bin To Bin`, `Riwayat`.
- `Perlu ditangani` fills the first screen (14 rows, a button each).
- Top: date field, `Tampilkan`, 7 date links, name field, 4 tool buttons.

## Decisions (agreed)

| Topic | Decision |
|---|---|
| Visual system | Existing `DESIGN.md` tokens only (brand green, steel neutrals, Plex Sans / Condensed, yellow plates, ok/warn/bad). Hierarchy, not restyling. |
| No emojis | No emojis or emoticons anywhere (UI, guide, labels). lucide icons only where an icon helps. |
| One action | Each wave and each line shows at most one primary button: its next step. Everything else lives in that item's `Lainnya` menu. |
| Guidance | A "Langkah berikutnya" sentence at the top of the day and one per wave; a `Cara pakai` guide covering every situation. |
| Two layouts | One address (`/waves`), two layouts: a dedicated **phone layout** below 768 px (its own components, §2) and the **desktop layout** from 768 px up (§1). Same data, same actions, same menus and confirmations; only the arrangement differs. Rotating a tablet switches layouts. |
| Undo cancel | `Pulihkan wave`: restores only the lines the wave cancel cancelled; no stock moves; warns about lines the bins no longer cover and offers `Hitung ulang`. |
| Undo finish | `Buka lagi`: reopens; offers "Batalkan juga N baris yang diposting massal" (ticked by default) for the lines `Selesaikan wave` bulk-posted; lines picked one by one stay posted. Refused when a shipment is loaded; a bulk line already audited is refused. |
| Dropdowns | `color-scheme: only light` + `darkreader-lock`, so browser/OS auto-dark features stop darkening the app; the new menus are explicitly white. Replacing native select lists is a follow-up only if still black after this. |
| Isi dari picklist | The admin's main way to enter a printed picklist: kept unchanged, **desktop layout only**. The phone layout never shows it (not in the wave menu, not in `Minta supervisor`, not in its guide). |
| Unchanged | Picking screen (`Mulai picking` panel), `Isi dari picklist` sheet, posting dialogs, all RPCs except the new ones, the printed picklist. |

## 1. Desktop layout (768 px and up), top to bottom

Sections 1.1–1.6 describe the desktop layout. The building blocks they name — the day menu, the
`Perlu ditangani` summary, the next-step sentences, the wave and line menus, the action menu
component and `Cara pakai` — are shared with the phone layout (§2), which arranges them differently.

### 1.1 Day bar
```
<  Jumat 20 Nov  >   [calendar icon]                  Cara pakai   Lainnya
9 wave · 10/118 baris diposting
Langkah berikutnya: 2 baris stok kurang di NO 7 dan NO 8 harus diperbaiki dulu.
```
- Previous / next day arrows and a calendar icon (native date input behind it) replace the date
  field, `Tampilkan` and the 7 recent-date links. Days with a plan are reachable by the arrows
  (they jump to the previous / next planned day).
- `Lainnya` (day menu): `Tambah order`, `PDF semua picklist`, `PDF Bin To Bin`,
  `Hitung ulang wave tersisa` (shown only when the current rules show it today).
- The name field leaves the page: every posting already asks for the name (remembered).
- "Langkah berikutnya" — one sentence, the single most urgent thing, from this priority order:
  1. stok kurang lines (`2 baris stok kurang di NO 7 dan NO 8 harus diperbaiki dulu.`)
  2. open supervisor requests (`1 permintaan dari picker menunggu supervisor.`)
  3. lines waiting for a Bin To Bin
  4. the next wave to start, by slot (`Mulai NO 2 (08:00): 27 baris.`)
  5. all done (`Semua wave hari ini selesai.`)
  (A warning about open waves of earlier days is out of scope — declined for now.)
  Each sentence links to the place it names (scrolls to / opens it).

### 1.2 Perlu ditangani (collapsed)
```
Perlu ditangani   2 stok kurang · 1 menunggu Bin To Bin · 9 hitung · 1 minta supervisor   Lihat
```
- Collapsed by default; red text when anything blocks posting (stok kurang, menunggu Bin To Bin),
  steel otherwise. Hidden when empty.
- `Lihat` opens the existing content (`ProblemsPanel`, `EscalationsPanel`, `CorrectionsPanel`)
  grouped by kind with their current bulk actions (`Perbaiki semua`, `Tutup N hitung lama`) and
  per-item buttons — unchanged behaviour.

### 1.3 Wave list
Each wave is one compact row (card on phone, row on desktop):
```
NO 2   08:00   109711286                         6/27 baris
[progress bar]
Mulai picking: 21 baris belum diambil.       [Mulai picking]   Lainnya
```
- Shipment numbers with their audit/load state pills (existing); truck and destination only when
  set (no "– · –").
- Next-step sentence and the one primary button by state:

| State | Sentence | Primary button |
|---|---|---|
| PENDING, open lines, none blocked | `Mulai picking: N baris belum diambil.` | `Mulai picking` |
| PENDING, some open lines stok kurang / menunggu Bin To Bin | `N baris tertahan: perbaiki dulu.` | `Lihat` (opens Perlu ditangani filtered to this wave) |
| PENDING, every line posted | `Semua baris sudah diposting: tutup wave.` | `Tutup wave` |
| RESCHEDULED (Tunda) | `Ditunda. Aktifkan untuk lanjut.` | `Aktifkan` (supervisor) |
| COMPLETED | `Selesai <time>.` + audit state (`Audit 3/5 shipment`) | none |
| CANCELLED | `Dibatalkan <time>.` | none |

- `Lainnya` (wave menu), items shown only when allowed today (same rules as the current buttons):
  `Picklist` (PDF), `Isi dari picklist`, `Tambah item`, `Selesaikan wave` (bulk post — its
  existing confirmation stays), `Tunda`, `Aktifkan`, `Buka lagi` (COMPLETED, new),
  `Pulihkan wave` (CANCELLED, new), and last, separated, in red: `Batalkan wave`.
  Operators see only what they can do today (`Picklist`, `Selesaikan wave` when allowed).
- Tapping the row (outside the buttons) opens the wave's lines. One wave open at a time; opening
  another closes the previous. The open wave's header stays sticky while scrolling its lines.
- `Mulai picking` opens the picking panel in place, as today; `Isi dari picklist` opens the sheet
  in place, as today.

### 1.4 Lines of the open wave
- Open lines: the existing row/card with only `Posting` visible (or `Menunggu Bin To Bin` /
  `Stok kurang` state text when blocked, with the existing `Perbaiki` inside its menu).
- Tapping a line (or its `Lainnya`) opens the line menu with every existing line action:
  `Berbeda` (the existing posting dialog in its "different" mode), `Ubah baris`, `Pecah`,
  `Posting Bin To Bin saja`, `Posting sesuai lapangan`, `Perbaiki`, `Riwayat`, `Batalkan posting`,
  `Tambah Bin To Bin`, `Batal tugas` / `Pulihkan tugas` — each only where allowed today.
- Finished lines are folded behind `12 selesai — tampilkan` (per wave; state remembered while the
  page is open). Shown finished lines have no buttons; tapping opens their menu.
- Filters (`Cari SKU atau bin`, `Hanya yang belum diposting`, `Hanya yang bermasalah`) move into a
  single search field above the wave list plus a `Filter` toggle; behaviour unchanged.

### 1.5 Action menu component
- New `components/app/action-menu.tsx`: a trigger (`Lainnya`, or the row itself) opening, on phone,
  a bottom sheet and, from `md` up, an anchored panel — built on the existing Radix dialog
  primitive (no new dependency).
- White panel (`bg-white text-steel`), items ≥ 44 px tall, icon + label + optional one-line hint,
  destructive items last after a divider in `text-bad`. Keyboard: arrow keys, Enter, Escape;
  focus returns to the trigger. Items are the existing self-contained action buttons
  (`UnpostButton`, `EditRowButton`, `SplitButton`, `ConfirmButton`, …) rendered as full-width menu
  rows; their confirmation dialogs open stacked on top of the menu (Radix nested dialogs), so every
  existing dialog is reused unchanged. After an action completes, the menu closes.

### 1.6 Cara pakai
A dialog with one short section per situation, plain Indonesian, no emojis:
mulai picking; Sesuai / Berbeda / Ubah and the rack scan; stok kurang; menunggu Bin To Bin;
Minta supervisor; tutup wave; Tunda / Aktifkan; Selesaikan wave (what bulk posting means and
when not to use it); Buka lagi and Pulihkan wave; Isi dari picklist (fallback when paper was used).
Each section: when it happens, what to tap, what the system does.

## 2. Phone layout (below 768 px) — its own Wave page

A separate component tree for phones (`app/(app)/waves/mobile/`), rendered instead of the desktop
layout below 768 px (decided on the client from the viewport; the server sends the same data). It is
designed as two screens, like an app; the browser back button and the on-screen back arrow both
return from screen 2 to screen 1 (the open wave is in the URL: `/waves?date=…&wave=<id>`).

### 2.1 Screen 1 — the day
```
<  Jumat 20 Nov  >                    Cara pakai   Lainnya
10/118 baris diposting
Langkah berikutnya: 2 baris stok kurang di NO 7 dan NO 8.

Perlu ditangani   2 stok kurang · 9 hitung        Lihat

NO 1   07:00                          12/16
Mulai picking: 4 baris belum diambil.
NO 2   08:00                           6/27
Mulai picking: 21 baris belum diambil.
NO 3   08:30                            1/1
Selesai 07.55.
```
- Each wave is one large tappable block (min. 64 px): NO, slot, shipment(s), progress (count + thin
  bar), and its next-step sentence (§1.3 table). **No buttons in the list**; tapping opens screen 2.
- Blocked waves show their sentence in `text-bad`; finished and cancelled waves are quieter
  (`text-steel-500`) and listed after the running ones.
- `Perlu ditangani` summary as in §1.2; `Lihat` opens it as a full-screen sheet.
- Day menu (`Lainnya`) and `Cara pakai` in the top bar. The phone's `Cara pakai` leaves out the
  `Isi dari picklist` section. Search/filter: a search icon in the top bar
  opening a search field (SKU or bin) that filters the wave list and, inside a wave, its lines.

### 2.2 Screen 2 — one wave, full screen
```
<  NO 2 · 08:00 · 109711286                        Lainnya
6/27 baris  [progress bar]
Mulai picking: 21 baris belum diambil.

[ open lines first, each as a card with the yellow plate ]
[ 6 selesai — tampilkan ]

[             Mulai picking             ]   <- pinned to the bottom
```
- Top bar: back arrow, wave identity, wave menu (`Lainnya`, same items as §1.3).
- The wave's one primary action (§1.3 table) is **pinned to the bottom of the screen** in thumb
  reach, full width, above the app's bottom navigation; it disappears when the state has none.
- Lines: open lines first as cards (yellow plate, SKU and description, batch/expiry, quantity with
  unit, state); finished lines folded behind `N selesai — tampilkan`. Tapping a line opens its line
  menu (§1.4) as a bottom sheet; an open line's own `Posting` stays on the card.
- `Mulai picking` opens full screen from here (the existing panel), with back returning to screen 2.
- `Isi dari picklist` is not available on the phone layout (desktop only). The wave menu on the
  phone omits it, and a `Minta supervisor` request on the phone offers only `Tutup`; posting it
  through the sheet is done on a desktop.

### 2.3 Phone rules
- One reach zone: the primary action and bottom sheets at the bottom; nothing that a picker needs
  often lives only at the top right.
- Tap targets ≥ 44 px; body text ≥ 15 px; bin codes as yellow plates (`font-cond`).
- No horizontal scrolling; no tables on the phone layout.

## 3. Undo a finished or cancelled wave — migration `0069_wave_reopen.sql`

### `restore_wave(p_wave_id uuid, p_by_name text, p_reason text) returns jsonb`
- Supervisor/admin; name and reason required; wave must be `CANCELLED`.
- Restores the tasks the wave cancel cancelled: status `CANCELLED`, and no `TASK` execution event
  to `CANCELLED` after the wave's last `WAVE … → CANCELLED` event (a line cancelled on its own, or a
  move cancelled by `Isi dari picklist`, has its own task event and stays cancelled). Restored tasks
  → `PLANNED`; the wave's outbound lines `CANCELLED` → `PLANNED`; wave → `PENDING`. Logged.
- No movement is written. Returns the restored task ids and, per restored PICK, whether the bin
  still covers it now (same rule as `task_shortfalls`).
- `restore_wave_preview(p_wave_id)` (read-only) returns the same list without changing anything,
  for the confirmation step.

### `reopen_wave(p_wave_id uuid, p_by_name text, p_reason text, p_undo_bulk boolean) returns jsonb`
- Supervisor/admin; name and reason required; wave must be `COMPLETED`; refused when any shipment
  of the wave is loaded (`shipment_loads`).
- Bulk lines = tasks of the wave with `bulk_posted` and `completed_at` equal to the wave's last
  `WAVE … → COMPLETED` event time (the same transaction as `complete_wave`), i.e. posted by
  `Selesaikan wave`, not by `Isi dari picklist` or a picker.
- With `p_undo_bulk`: every bulk line is unposted through the existing `unpost_task` path (stock
  back to the exact bin, batch and expiry it left; a relocation transferred back); a bulk line
  already picking-audited refuses the whole reopen with its line named. Then wave → `PENDING` and
  the wave's outbound lines `COMPLETED` → `PLANNED` (re-computed from the tasks still posted, as
  `unpost_task` already does per line). Logged.
- Without `p_undo_bulk`: status changes only; no movement.
- `reopen_wave_preview(p_wave_id)` (read-only) lists the bulk lines and anything that would refuse.

### Remain Qty guarantees (tested)
- `restore_wave`: stock of every bin identical before and after.
- `reopen_wave` without undo: identical before and after.
- `reopen_wave` with undo: each bulk line's quantity back in exactly its source bin / batch /
  expiry; every other bin unchanged; posting the same lines again returns stock to the
  pre-reopen numbers (post → reopen-undo → post is a no-op on stock).
- Refusals (loaded shipment, audited bulk line, wrong status, missing name/reason) change nothing.

## 4. Dropdowns
- `app/layout.tsx` viewport `colorScheme: "only light"`; `app/globals.css` `color-scheme: only light`
  on `html` and form controls; a `<meta name="darkreader-lock">` in the document head.
- Remove the inert `::picker(select)` rule or keep it with a comment that it only applies to
  `appearance: base-select`.
- If, after deploying, a native select list is still black on the user's devices, replace the
  affected selects with a white listbox component — a separate follow-up.

## 5. Testing
- `supabase/tests/41_wave_reopen.sql`: restore (only wave-cancelled lines back, single-cancelled stay,
  outbound back, stock identical, shortfall reported); reopen without undo (stock identical);
  reopen with undo (exact stock per bin, sheet-posted and picker-posted lines untouched, outbound
  reopened, post → reopen-undo → post leaves stock as before); refusals change nothing.
- `tests/wave-next-step.test.ts`: the next-step sentence and primary button for every state in the
  table and the day-level priority order (pure function in `lib/wave-next-step.ts`).
- Existing tests unchanged and green.
- Browser on the local stack with the real 9-wave day (`2026-11-20`), each layout checked on its own:
  phone layout at 390 × 844 (screen 1 and screen 2, back arrow and browser back, pinned primary
  action, bottom sheets) and desktop layout at 1440 × 900; before/after screenshots, button count
  and page height compared; every former button reachable in both layouts (a checklist mapping
  each old button to where it lives now); keyboard navigation of a menu (desktop); `Buka lagi` and
  `Pulihkan wave` round trips with stock checked in psql; resizing across 768 px switches layouts
  without losing the open wave.

## Out of scope
`Bandingkan dengan sistem` changes, a full replacement of native selects, the picking screen and the
`Isi dari picklist` sheet layouts.
