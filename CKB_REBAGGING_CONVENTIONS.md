# CKB 3PL — Rebagging Module: Conventions Report

Date: 2026-10-21  
Repo: `/home/ilham/allocator_k-one` (Next.js 15 + Supabase, Shell WMS + CKB 3PL sub-app)

---

## 1. `app/ckb/*` Current State

### Layout & Gating (`app/ckb/layout.tsx`)
- **Auth**: `requireAppAccess("ckb_3pl")` at layout level → redirects to `/keluar?nonaktif=1` if no session, or to user's other app home (`/` or `/ckb`) if missing app access.
- **Chrome**: Navy sidebar (`bg-jeir-navy`, `w-72`) on desktop (`lg:flex`), slim navy top bar (`h-14`) on mobile (`lg:hidden`).
- **Main content**: `lg:pl-72` offset, centered `max-w-7xl px-4 py-8`.
- **Sign-out**: Plain `<form action="/keluar" method="post">` with ghost button — works without JS.
- **Module groups**: `["Operasional", "Data & laporan", "Pengaturan"]` from `CKB_MODULES`.

### Module Registry (`app/ckb/modules.ts`)
```ts
type CkbModule = { href: string; label: string; group: "Operasional" | "Data & laporan" | "Pengaturan"; blurb: string; };
export const CKB_MODULES: CkbModule[] = [ ... 11 entries ... ];
```
- Single source for sidebar rail + landing grid.

### Module Stub (`app/ckb/module-stub.tsx`)
- Honest placeholder card: label, "Segera" chip (warn/10), blurb, muted notice line.
- Used by `/ckb/photos` page today.

### Three Existing Mockup Pages (all static, white-themed, disabled controls)
| Page | Slides | Key Components Used |
|------|--------|---------------------|
| `rebagging/page.tsx` | 3 | Card, Input, Select, Button, Badge, lucide icons |
| `inspections/page.tsx` | 3 | Card, Input, Select, Button, local `ChecklistItem`, `StepCard`, `UploadZone`, `DisabledField` |
| `stock-take/page.tsx` | 5 | Card, Input, Select, Table, Button, local `StatTile`, lucide icons |

**Pattern**: Each slide = `<section aria-labelledby>`, header with slide badge, two-column grid (`lg:grid-cols-2`), cards with `border-steel-100 rounded-xl p-6`, disabled form controls (`opacity-50`), "Mockup — tampilan saja" disclaimer chip. **No client JS, no state, no handlers.**  
**Mobile/desktop**: Grid collapses to single column on `< lg`; no separate mobile layouts.

### CKB vs Shell `(app)` Layout Differences
| Aspect | Shell `(app)` | CKB `app/ckb` |
|--------|---------------|---------------|
| Auth | `requireRole()` per page | `requireAppAccess("ckb_3pl")` at layout |
| Sidebar | `components/app/nav.tsx` (role-gated, dynamic) | Static rail from `CKB_MODULES` |
| Top bar | None (sidebar always) | Mobile-only navy bar (`h-14`) |
| Colors | `bg-paper` / `text-steel` | `bg-white` / `text-steel` (white theme) |
| Brand | `components/home/home-page.tsx` banner | `CKB 3PL` teal-on-navy header |

---

## 2. Supabase Client Patterns

### `lib/supabase/server.ts`
```ts
export async function createClient() { // RLS-applied, bound to user session
  const cookieStore = await cookies();
  return createServerClient(url, anonKey, { cookies: { getAll, setAll } });
}
export function createServiceClient() { // bypasses RLS — admin only
  return createAdminClient(url, serviceRoleKey, { auth: { persistSession: false } });
}
```

### `lib/supabase/client.ts`
```ts
"use client";
export function createClient() {
  return createBrowserClient(url, anonKey);
}
```

### `lib/fetch-all.ts` — Pagination Helper
```ts
export async function fetchAll<T>(make: (from, to) => Promise<{data, error}>, pageSize = 1000): T[]
```
- PostgREST defaults to 1,000 rows; warehouse has 2,570 bins.
- `make(from, to)` must return a fresh query with stable `.order()`.
- Used in server components for list queries.

### `lib/auth.ts` — Session & Authorization
```ts
export type SessionUser = { id, email, name, role: Role, username, shared: boolean, apps: AppId[], defaultApp: string|null };
export const getSessionUser = cache(async (): Promise<SessionUser|null> => { ... }); // single request per render
export async function requireRole(allowed: Role[], app: AppId = "shell_wms"): Promise<SessionUser> { ... } // redirects
export async function checkRole(allowed: Role[], app: AppId = "shell_wms"): Promise<SessionUser|null> { ... } // null on fail
export async function requireAppAccess(app: AppId): Promise<SessionUser> { ... } // used in CKB layout
export async function checkAppAccess(app: AppId): Promise<SessionUser|null> { ... }
```
- `apps` array in `profiles` (`AppId[]`: `"shell_wms" | "ckb_3pl"`).
- `shared` = site account (login not required); personal accounts have `shared: false`.
- Deactivated account (`active=false`) → treated as signed out.

### `lib/auth-route.ts` — Middleware Routing Logic (pure)
- `PUBLIC_PATHS = ["/login", "/keluar"]`
- `loginRequired()` reads `LOGIN_REQUIRED === "true"`.
- `authRoute(path, search, signedIn, required, isShared)` returns `{kind: "continue"} | {kind: "redirect", to} | {kind: "shared"}`.

### Established Pattern: Server Page + Client Component + `router.refresh()`
```tsx
// app/(app)/receiving/page.tsx (Server Component)
export default async function ReceivingPage() {
  const user = await requireRole(["operator", "supervisor", "admin"]);
  const supabase = await createClient();
  const { data } = await supabase.from("receipt_summary").select("*").order("created_at", { ascending: false }).limit(100);
  return (
    <main>
      <PageHeader title="Penerimaan" live={["movements", "receipts"]} />
      <ReceivingList receipts={data} supervisor={user.role !== "operator"} />
    </main>
  );
}

// app/(app)/receiving/receiving-list.tsx (Client Component)
"use client";
export function ReceivingList({ receipts, supervisor }) {
  // uses createClient().rpc(...) for mutations
  // on success: router.refresh()  (via LiveRefresh or manual)
}
```
- **Server page**: fetches initial data, passes to client component.
- **Client component**: handles interactions, calls RPC via `createClient().rpc(...)`.
- **Refresh**: `LiveRefresh` (from `live-refresh.tsx`) calls `router.refresh()` on realtime changes; manual `router.refresh()` after RPC success.

---

## 3. RPC Invocation Patterns

### Client-Side (from `"use client"` components)
```ts
const { error } = await createClient().rpc("rpc_name", { p_param: value });
if (error) { setError(error.message); return; } // Indonesian error messages
// on success: router.refresh() or rely on LiveRefresh
```
**Examples** (68 matches in `app/(app)`):
- `create_receipt`, `post_receipt`, `cancel_receipt` (receiving)
- `post_task_by`, `post_pick_line`, `post_pick_with_move`, `unpost_task` (waves)
- `add_order_wave`, `add_wave_items` (wave planning)
- `create_count_task`, `submit_count`, `apply_count`, `close_count` (counts)
- `record_putaway_audit`, `putaway_import` (putaway)
- `place_hold`, `release_hold` (inventory holds)
- `decide_adjustment` (adjustments)
- `load_sheet_pick_lines` (audit file upload)
- `item_by_barcode` (scanner resolution)

### Server-Side RPC (rare; admin/settings)
```ts
const { error } = await (await createClient()).rpc("set_inventory_policy", { p_value: v });
```
- Used in `admin/settings/policy-form.tsx`.

### Error Handling Convention
- **Always** check `error` from RPC result.
- Show `error.message` directly in UI (already Indonesian from Postgres `RAISE EXCEPTION`).
- Example: `<p className="text-xs text-bad">{error}</p>` or toast via `ConfirmButton` error state.
- No try/catch — Supabase JS returns `{ data, error }` tuple.

---

## 4. Photo/File Upload — Current State

### Search Results (grep: `storage`, `upload`, `File`, `image`, `photo`, `blob`, `objectURL`)
| Location | Usage |
|----------|-------|
| `app/(app)/labels/labels-client.tsx` | `URL.createObjectURL(await res.blob())` — PDF label download |
| `app/(app)/allocator/browser/downloads.ts` | `URL.createObjectURL(blob)` — PDF/Excel download |
| `app/(app)/admin/import/import-client.tsx` | `<input type="file">` → `File.arrayBuffer()` → `XLSX.read()` — **Excel import only** |
| `app/(app)/putaway/putaway-client.tsx` | Same — Excel import |
| `app/(app)/receiving/receiving-list.tsx` | Same — Excel import |
| `app/(app)/audit/picking/file-upload.tsx` | Same — Excel import |
| `app/(app)/inventory/tabs/recon-tab.tsx` | Same — Excel import |
| `lib/allocator/browser/downloads.ts` | `triggerDownload(blob, filename)` — client-side file save |
| `components/app/person-name.tsx` | `localStorage` for name persistence |
| `components/app/use-welcome-once.ts` | `localStorage` for welcome flag |
| `lib/welcome.ts` | `localStorage` (welcome screen) |

**No Supabase Storage usage exists today.** No `supabase.storage.from(...).upload()`, no bucket references, no image/photo upload components.

### Package.json — Upload-Related Deps
- **None** for image upload (no `react-dropzone`, `uppy`, `filepond`, etc.).
- **Present**: `xlsx` (SheetJS), `exceljs`, `jspdf`, `pdf-lib`, `fflate` — all for **export/import of spreadsheets/PDFs**.

### `public/` Assets
- `je-ir-logo.png` (brand logo)
- `home-banner.jpg` (1600×900, used by Home page)
- `licenses/*.txt` (third-party license texts)
- **No user-uploaded images served from `public/`.**

### Next/Image Usage
- **Not used** anywhere in the codebase (grep `<Image` returns zero).
- Images rendered via `<img>` (e.g., Home banner, team photos in `about-copy.ts`).

### Implication for Rebagging
- **First image upload feature** — must design Supabase Storage bucket, RLS policies, client upload flow, and preview/display.
- Consider `URL.createObjectURL()` for local previews before upload (as done for PDF downloads).
- Keep white-theme: drop zone with `border-dashed border-steel-300 bg-paper/50`.

---

## 5. UI Primitives — Exact Export Signatures

### `components/ui/input.tsx`
```tsx
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} className={cn("flex h-10 w-full rounded-md border border-steel-300 bg-white px-3 text-sm placeholder:text-steel-500 disabled:opacity-50", className)} {...props} />
);
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => <select ref={ref} style={{ colorScheme: "only light", ...props.style }} className={cn("h-10 w-full rounded-md border border-steel-300 bg-white px-2 text-sm text-steel", className)} {...props} />
);
export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1 block text-sm font-medium text-steel-700", className)} {...props} />;
}
```

### `components/ui/button.tsx`
```tsx
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />;
});
// Variants: default (ckb), accent (jeir-teal on navy), outline, ghost, danger
// Sizes: default (h-10), sm (h-8), lg (h-14), icon (h-10 w-10)
```

### `components/ui/card.tsx`
```tsx
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>)
export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>)
export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>)
export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>)
// All render <div> with base: rounded-lg border border-steel-100 bg-white
```

### `components/ui/table.tsx`
```tsx
export function Table({ className, sticky, ...props }: React.TableHTMLAttributes<HTMLTableElement> & { sticky?: boolean })
// sticky: wraps in max-h-[calc(100dvh-5rem)] overflow-y-auto, makes thead th sticky with shadow border
export const Th = ({ className, ...p }: React.ThHTMLAttributes<HTMLTableCellElement>) => <th className={cn("border-b border-steel-300 px-3 py-2 text-left text-xs font-semibold text-steel-500", className)} {...p} />
export const Td = ({ className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) => <td className={cn("border-b border-steel-100 px-3 py-2 align-top", className)} {...p} />
```

### `components/ui/badge.tsx`
```tsx
export function ExpiryBadge({ status, className }: { status: ExpiryStatus; className?: string })
// status: "expired" | "near" | "ok" | "unknown" (from config/warehouse)
export function Badge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>)
// Base: inline-block rounded bg-steel-100 px-2 py-0.5 text-xs font-medium text-steel-700
```

### `components/ui/dialog.tsx`
```tsx
"use client";
export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;
export function DialogContent({ className, children, title, description }: {
  className?: string; children: React.ReactNode; title: string; description?: string
})
// Renders Portal > Overlay (bg-steel/50) > Content (bottom-sheet on mobile, centered on desktop)
// Title: font-cond text-xl font-semibold; Description: text-sm text-steel-500; Close: X icon
```

### `components/ui/status-icon.tsx`
```tsx
export type StatusTone = "bad" | "warn" | "wait" | "ok";
export function StatusIcon({ tone, word, className }: { tone: StatusTone; word?: string; className?: string })
// Tones: bad→CircleAlert/text-bad/"Bermasalah", warn→TriangleAlert/text-warn/"Perlu dicek", wait→Clock/text-ckb/"Menunggu", ok→CircleCheck/text-ok/"Beres"
// Returns inline-flex with icon + sr-only label
```

---

### `components/app/*` Shared Components Worth Reusing

| Component | Purpose | Key Props / Notes |
|-----------|---------|-------------------|
| `person-name.tsx` | `usePersonName()` hook + `PersonNameField` + `OtherPersonField` | Syncs via `CustomEvent` across fields; shared account → `localStorage`; personal → account name, not remembered |
| `item-scan-input.tsx` | SKU/barcode input with camera scanner | `onItem?: (item, code) => void`; resolves via `item_by_barcode` RPC; `Input` + camera `Button` + dynamic `CameraScanner` |
| `confirm-button.tsx` | Two-tap confirmation dialog | `title`, `summary`, `confirmLabel`, `onConfirm: () => Promise<string|null>`, `extra?`; shows error inline |
| `page-header.tsx` | Page title + optional `LiveRefresh` + `AccountButton` | `title`, `live?: LiveTable[]`, `liveDebounceMs?`, `children?` |
| `live-refresh.tsx` | **Realtime subscription + `router.refresh()`** | `LiveTable` type (19 tables); `useLiveTables(tables, onChange, debounceMs)` → `LiveStatus`; `LiveRefresh` drops `?scan=1` |
| `session.tsx` | `SessionProvider` + `useSession()` | Client context: `{ name, username, role, loginRequired, shared }` |
| `account.tsx` | `AccountBox` (desktop sidebar), `AccountSwitch` (sign in as other), `AccountButton` (mobile header) | `SignOut` = `<form action="/keluar" method="post">` |
| `action-menu.tsx` | `ActionMenu` + `MenuSection` | Radix-based dropdown used by `AccountButton` |

**Realtime Users**: `PageHeader` → `LiveRefresh` → `useLiveTables` (waves, pick_tasks, movements, etc.). `LiveDot` shows green/red/grey pulse.

---

## 6. Tailwind / Design Tokens

### `tailwind.config.ts` — Full Token List
```ts
colors: {
  ckb:     { DEFAULT: "#0B8384", dark: "#097172", light: "#0E8E8C", tint: "#E2F2F3" },
  steel:   { DEFAULT: "#102331", 700: "#283D4C", 500: "#546675", 300: "#A3B2BE", 100: "#E0E7ED" },
  paper:   "#F3F6F9",
  jeir:    { navy: "#032741", teal: { DEFAULT: "#18C3C1", dark: "#12A9A7" } },
  plate:   { DEFAULT: "#F9CF54", dark: "#E5B532" },  // Shell yellow (rack plates)
  ok:      "#2E7D4F",
  warn:    "#D9941A",
  bad:     "#C0392B",
}
fontFamily: {
  sans: ['"IBM Plex Sans"', "system-ui", "sans-serif"],
  cond: ['"IBM Plex Sans Condensed"', '"IBM Plex Sans"', "sans-serif"],
}
borderRadius: { plate: "6px" },
backgroundImage: {
  "jeir-side": "linear-gradient(180deg, #032741 0%, #022239 45%, #04394B 78%, #075A67 100%)",
  "jeir-bar":  "linear-gradient(90deg, #022239 0%, #04394B 60%, #075A67 100%)",
}
```

### `app/globals.css` — Custom Classes / Utilities
```css
@layer base {
  html { color-scheme: only light; }           /* force light mode everywhere */
  select option, datalist option { background: #fff; color: #102331; }
  input, select, textarea, button { color-scheme: only light; }
  body { @apply bg-paper text-steel font-sans antialiased; }
  :focus-visible { @apply outline outline-2 outline-offset-2 outline-ckb; }
}
@layer components {
  .tabular { font-variant-numeric: tabular-nums; }
}
.welcome-fade { animation: welcome-fade 400ms ease-out both; }
/* Home banner animations (home-hero, home-rise, home-shine, home-glow) */
body:has([data-pinned-bar]) .site-footer { padding-bottom: 6rem; }
```

### Critical Notes
- **`text-steel-400`, `text-steel-600`, `text-steel-800`, `text-steel-900` do NOT exist** — only `DEFAULT` (100/300/500/700). Use `text-steel-500` for muted, `text-steel-700` for labels, `text-steel` (DEFAULT) for body.
- **White theme convention**: All CKB pages use `bg-white` cards on `bg-paper` (`#F3F6F9`) page background. Shell app uses `bg-paper` directly.
- **Rack-plate yellow**: `plate` / `plate-dark` for highlights, badges, CTAs.
- **Status colours**: `ok`/`warn`/`bad` — never use raw red/green.
- **Font**: `font-cond` for headings/numbers, `font-sans` for body.

---

## 7. Tests

### `package.json` Scripts
```json
"typecheck": "tsc --noEmit",
"lint": "next lint",
"build": "next build",
"test": "tsx tests/sisa-regression.test.ts && tsx tests/daily-workflow.test.ts && ... && tsx tests/inventory-pack.test.ts"  // 61 files chained with &&
```
- **No Jest/Vitest** — each test file is a standalone `tsx` script with inline `test()` helper.
- **7 files** prefixed with `TZ=Asia/Jakarta` (date-boundary tests).

### Test File Structure (2 Examples)

#### `tests/sisa-regression.test.ts` (allocator regression)
```ts
import { strict as assert } from 'node:assert';
import { allocate, relocateByWaveOrder } from '../lib/allocator/allocator';
import { withConfig, type AllocatorConfig } from '../lib/allocator/config';
// ... imports

let passed = 0, failed = 0;
function describe(name, fn) { console.log(`\n  ${name}`); fn(); }
function it(name, fn) { try { fn(); passed++; console.log(`    ✓ ${name}`); } catch(e) { failed++; console.log(`    ✗ ${name}\n      ${e.message}`); } }
function eq<T>(a, e, label) { if (a !== e) throw new Error(`${label}: expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`); }
// Fixture builders: makeBin(), makeDemand()
// Tests: describe("Sisa replay"), it("...") { eq(actual, expected, "label"); }
process.exit(failed > 0 ? 1 : 0);
```

#### `tests/pickface-missing-bug.test.ts` (bug reproduction)
```ts
// Same runner pattern
function makeBin(location, sku, batch, expiry, qty, upp): StockBin { ... }
function makeDemand(shipment, wave, sku, qty, upp, slotTime): DemandLine { ... }
describe("Pickface missing fallback", () => {
  it("allocates from reserve when pickface absent", () => { ... });
});
```

**Convention**: Inline helpers (`eq`, `gt`, `gte`), fixture builders, `describe`/`it` logging, `process.exit(failed>0?1:0)`.

### `scripts/sql-test.sh` — SQL Test Execution
```bash
#!/usr/bin/env bash
export PGUSER="${PGUSER:-postgres}"
db="${SQL_TEST_DB:-k1_sql_test}"
psql -d postgres -q -c "drop database if exists $db" -c "create database $db"
export PGDATABASE="$db"
psql -q -f supabase/tests/00_local_auth_stub.sql
for f in supabase/migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 -f "$f"; done
psql -q -f supabase/seed.sql
psql -q -f supabase/tests/01_rls_and_stock_rules.sql
# Then run test files 02–22, each printing PASS/FAIL notices
```
- **Local Postgres only** (default `postgres` user, no password, localhost:5432).
- Requires `PGUSER`/`PGPASSWORD`/`PGHOST`/`PGPORT` env vars if non-default.
- `00_local_auth_stub.sql` = auth stub (not real Supabase Auth).
- Tests 04–22 roll back (safe on local).
- **Can run in this environment** if local Postgres is installed and accessible.

### `supabase/config.toml`
```toml
project_id = "ckb-warehouse"
[db] major_version = 17
[studio] enabled = false
```
- Local dev uses `supabase db reset` or `supabase migration up`.
- Linked to remote project `ckb-warehouse`.

---

## 8. Key Lib Files — One-Liners

| File | Purpose |
|------|---------|
| `lib/warehouse-types.ts` | 3D warehouse types: `BinSummary` (2,570 bins), `Layout` (aisle/bay/level geometry, `bays_per_side`), `ColorMode` (`abc`\|`fill`\|`expiry`). |
| `lib/wave-impact.ts` | Pure "impact analysis" for wave actions: simulates stock/tasks before/after a change (`postMove`, `park`, `unpost`, `replace`), returns rows in *other* waves whose state worsens (`short` > `waiting` > `held` > `ok`). Used by wave page confirmations. |
| `lib/inventory-pack.ts` | Compresses 1,790 stock lines for transport: `PackedLines = { items: Record<sku, [...]>, bins: Record<bin, [...]>, rows: [bin, sku, batch, qty, expiry, received, days, held, reasons][] }` — `packLines()`/`unpackLines()` round-trip. |

---

## 9. Document Numbering / Sequence Conventions

### Database ID Generation
- **All primary keys**: `uuid primary key default gen_random_uuid()` (35 occurrences in migrations).
- **No serial/bigserial sequences** for business keys (only `grant usage on all sequences` for internal use).

### Business Document Numbers
| Entity | Field | Generation | Uniqueness |
|--------|-------|------------|------------|
| Receipts | `doc_no` | **User-supplied** (DO / surat jalan number) | `unique` + `upper(trim())` in `create_receipt` RPC |
| Waves | `wave_no` | **User-supplied** per date (`text not null`, `unique (planned_date, wave_no)`) | Composite unique on `(planned_date, wave_no)` |
| Pick Tasks | `seq` | Auto-assigned by allocator (`seq` in `pick_tasks`) | Unique per wave |
| Bin Checks | `id` | `gen_random_uuid()` | PK |
| Rebagging (new, migration 0081) | `id` | `gen_random_uuid()` | PK |
| Stock Take (migration 0083) | `id` | `gen_random_uuid()` | PK |
| Cargo Inspection (migration 0082) | `id` | `gen_random_uuid()` | PK |

### Collision-Resistant Job Number Pattern for Rebagging
**Recommendation**: Follow `receipts` pattern — **user-supplied reference** (WO / job number) + `gen_random_uuid()` PK.
```sql
-- In migration (mirror 0020_receiving.sql pattern)
job_no text not null unique,
-- RPC
create or replace function public.create_rebagging_job(
  p_job_no text, p_job_date date, p_location text, p_shift text,
  p_operator_name text, p_checker_name text, p_material text, p_qty_uom text,
  p_by_name text
) returns uuid ...
  if nullif(trim(p_job_no), '') is null then raise exception 'Nomor pekerjaan wajib diisi'; end if;
  if exists (select 1 from public.rebagging_jobs where job_no = upper(trim(p_job_no))) then
    raise exception 'Pekerjaan % sudah ada', upper(trim(p_job_no));
  end if;
```
- **Human-readable**: Operator enters WO/job number from paperwork.
- **Collision-safe**: DB unique constraint + uppercase trim.
- **PK**: `gen_random_uuid()` for joins/FKs.
- **No sequences needed** — avoids gap/rollback complexity.

---

## Summary for Rebagging Implementation

1. **Page Structure**: Replace `app/ckb/rebagging/page.tsx` with server page (`requireAppAccess("ckb_3pl")`) + client workspace component.
2. **Data Fetching**: Server page calls `createClient()` → RPC or direct select → pass to client.
3. **Interactions**: Client uses `createClient().rpc("create_rebagging_job", ...)`, `rpc("add_rebagging_photo", ...)`, `rpc("submit_rebagging_for_review", ...)`.
4. **Realtime**: Add `rebagging_jobs` + `rebagging_photos` to `LiveTable` type + publication (migration 0015 style) → `LiveRefresh` in `PageHeader`.
5. **Photo Upload**: First Supabase Storage feature — create bucket `ckb-rebagging`, RLS policies (owner/org), client upload via `supabase.storage.from().upload()`, preview with `createObjectURL()`.
6. **UI**: White theme cards, `font-cond` headings, `plate` yellow for CTAs, `ok`/`warn`/`bad` status chips, `ConfirmButton` for submissions.
7. **Person Name**: Reuse `usePersonName()` / `PersonNameField` for operator/checker fields.
8. **Job Number**: User-supplied `job_no` (unique, uppercase) + UUID PK.
9. **Tests**: Add `tests/rebagging.test.ts` following inline runner pattern; add to `package.json` test chain.
10. **SQL Tests**: Add `supabase/tests/XX_rebagging.sql` following existing pattern (PASS/FAIL notices).