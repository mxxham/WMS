# DESIGN.md — CKB Warehouse WMS

Design contract for the WMS UI. Tokens and primitives below are the ones in
`tailwind.config.ts` + `app/globals.css` + `components/ui/*`. New UI must use
these tokens; do not introduce new colors, fonts, or radii without updating
this file.

## 1. Brand & palette

| Token | Value | Use |
|---|---|---|
| `ckb` | #0B8384 | Primary action teal: default buttons, selected toggles (white text 4.6:1) |
| `ckb-dark` | #097172 | Pressed/hover, active nav item |
| `ckb-light` | #0E8E8C | Secondary teal (bars, fills) |
| `ckb-tint` | #E2F2F3 | Selected row/card wash |
| `steel` | #102331 | Primary ink |
| `steel-700` | #283D4C | Strong secondary ink |
| `steel-500` | #546675 | Muted ink (notes, captions) |
| `steel-300` | #A3B2BE | Borders, disabled text |
| `steel-100` | #E0E7ED | Hover washes, table zebra |
| `paper` | #F3F6F9 | Page background (navy-tinted white) |
| `white` | #FFFFFF | Cards, forms |
| `plate` | #F9CF54 | Shell yellow (plates, highlights) |
| `jeir-navy` | #032741 | JE-IR WMS mark: logo tile, Home banner band |
| `bg-jeir-side` / `bg-jeir-bar` | gradient | The banner's navy-to-teal ground: desktop sidebar / phone bottom bar |
| `jeir-teal-dark` | #12A9A7 | Hover of the `accent` button |
| `jeir-teal` | #18C3C1 | JE-IR WMS accent: `accent` button (navy ink), active nav item, Home welcome line. As text, only on navy (too light on white) |
| `ok` | #2E7D4F | Success |
| `warn` | #D9941A | Warning |
| `bad` | #C0392B | Error/destructive |

The palette follows the JE-IR WMS banner (navy + teal); the token names stay
`ckb`/`steel` so no page had to change. Neutrals are navy-tinted to sit with the
brand navy. `plate` stays Shell yellow because it mirrors the physical rack plates. The three
signal colours (`ok`/`warn`/`bad`) are the only semantic colours.

## 2. Typography

- **Body/UI**: `IBM Plex Sans` (`font-sans`).
- **Display/numbers/bin codes**: `IBM Plex Sans Condensed` (`font-cond`) for
  KPIs, headings, bin codes, and dense labels.
- Big KPI numbers: `font-cond text-4xl font-semibold tabular`.
- Section headings: `font-cond text-lg font-semibold`.
- Captions/notes: `text-xs text-steel-500`.
- Numeric columns always use `tabular` (`font-variant-numeric: tabular-nums`).

## 3. Spacing, radius, elevation

- Cards: `rounded-lg bg-white` with a 1px `steel-100`-class border or a soft
  shadow — flat white on `paper` background, no heavy shadows.
- Radius scale: `rounded-md` (controls), `rounded-lg` (cards), `rounded-plate`
  (6px, plates/labels).
- Page padding: `p-4 lg:p-8`; stacks use `space-y-2`–`space-y-6`.

## 4. Components (existing primitives)

| Component | File | Notes |
|---|---|---|
| `Button` | `components/ui/button.tsx` | Primary `ckb`, ghost, outline variants |
| `Card/CardContent/CardHeader/CardTitle` | `components/ui/card.tsx` | White panel container |
| `Input/Label/Select` | `components/ui/input.tsx` | Always light background (`color-scheme: light`) |
| `Table/Th/Td` + `sticky` | `components/ui/table.tsx` | Desktop tables; `Table sticky` for long lists |
| `TabsNav` | `components/app/tabs-nav.tsx` | Page tabs as real links with `?tab=…` |
| `PageHeader` + `live` dot | `components/app/page-header.tsx` | Title + realtime indicator |
| `Badge` | `components/ui/badge.tsx` | State pills (`ExpiryBadge` etc.) |
| `Dialog` | `components/ui/dialog.tsx` | Every action has a confirmation step |

## 5. State encoding (anti-slop rules)

- **Do not** use coloured accent borders (`border-l-4 border-ckb`) on rounded
  surfaces to mark selection/focus. Use tonal layering instead:
  selected card = `ring-2 ring-ckb bg-ckb-tint/40`, unselected =
  `bg-white hover:bg-steel-100`.
- Hover feedback must change *something visible* (background or ring) — a
  hover that changes nothing is not allowed.
- Selection state may also carry a glyph (check icon), not just colour.
- Error text: `text-sm text-bad` with `role="alert"`.

## 6. Layout & responsive

- Cards on phone, tables on desktop (`md`/`lg` breakpoints).
- Tables get `Table sticky` for long scans; cap a rendered list with a
  "showing N of M" hint and filter controls rather than rendering thousands.
- Every destructive/meaningful action: confirmation step with a one-sentence
  summary (mis-taps on the floor cost more than an extra tap).

## 7. Accessibility & motion

- `color-scheme: light` is forced; the app is light-only.
- `:focus-visible` always shows a `ckb` outline.
- `prefers-reduced-motion: reduce` disables transitions/animations globally.
- Animations are GPU-composited (`transform`/`opacity`) and only where they
  communicate a state change — no decorative motion.

## 8. Content & conventions

- UI strings are **Indonesian**; code, comments, docs are **English**.
- Bin codes are shown like the yellow plates on the rack (`font-cond`,
  semibold).
- Numbers use `fmtNum`/`fmtDate` from `@/lib/utils`; money/units are
  cartons (`CAR`) everywhere.
