import type { CSSProperties, ReactNode } from "react";
import { Bone, PULSE, TableSkeleton, ToolbarSkeleton } from "@/components/loading/skeleton";
import { cn } from "@/lib/utils";

/**
 * The CKB 3PL shapes — the second app's own skeleton vocabulary, built on the shared kit in
 * `components/loading/skeleton.tsx` (one `Bone`, one pulse rule, one table). It is a separate file
 * because CKB is not the Shell WMS: it has no `PageHeader` bar, no navy "hari ini" band and no
 * `PageSkeleton` header — its pages open with `CkbHeader` (phone mark, title, live dot, pills,
 * clock) and continue with `CkbBody` (`space-y-6 p-4 pb-24 lg:p-8`).
 *
 * Everything here is a shape CKB actually renders: the filter form, the `StatTile` box, the
 * phone-cards-over-desktop-table list, the `Facts` definition list, the notice band, the counting
 * rows a phone operator taps one-handed, the session stage rail, the evidence grid (square
 * thumbnails, never a chart — evidence is append-only and has no trend), the summary sheet with its
 * download buttons, and the two-snapshot comparison whose A / B columns must stay side by side.
 *
 * Nothing is written on any of these. A placeholder that printed a ref number, a quantity or a date
 * would be inventing a record in an app whose whole point is that records are provable.
 */

/** One block of words: a card's prose, a double-line hint, a single rule. */
function Lines({ count = 2, className, width = ["w-full", "w-3/4"] }: { count?: number; className?: string; width?: string[] }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {Array.from({ length: count }, (_, i) => (
        <Bone key={i} className={cn("h-2.5 rounded", width[i % width.length])} />
      ))}
    </div>
  );
}

/**
 * `CkbHeader`: the way back, the phone-only CKB mark, the `font-cond` title with its Live dot, the
 * subtitle, then the pills and buttons and the clock at the right edge.
 */
export function CkbHeaderSkeleton({ back = false, live = false, subtitle = true, pills = 1, actions = 0, delayMs = 0 }: {
  back?: boolean; live?: boolean; subtitle?: boolean; pills?: number; actions?: number; delayMs?: number;
}) {
  return (
    <header aria-hidden className="border-b border-steel-100 bg-white px-4 py-4 lg:px-8">
      <div className={PULSE} style={delayMs ? { animationDelay: `${delayMs}ms` } : undefined}>
        {back && <Bone className="mb-1.5 h-2.5 w-28 rounded" />}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {/* Phones get the 36px CKB mark as their way home; the sidebar carries it from lg up. */}
            <Bone className="h-9 w-9 shrink-0 rounded-md lg:hidden" />
            <div className="min-w-0 space-y-1.5">
              <div className="flex items-baseline gap-3">
                <Bone className="h-7 w-40 rounded sm:w-56" />
                {live && <Bone className="h-2 w-2 rounded-full" />}
              </div>
              {subtitle && <Bone className="h-3 w-52 rounded sm:w-80" />}
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {Array.from({ length: pills }, (_, i) => <Bone key={`p${i}`} className="h-6 w-20 rounded" />)}
            {Array.from({ length: actions }, (_, i) => <Bone key={`a${i}`} className="h-10 w-24 rounded-md" />)}
            {/* The Clock sits last in the real header; it is text, so a short rule is its shape. */}
            <Bone className="h-3 w-16 rounded" />
          </div>
        </div>
      </div>
    </header>
  );
}

/**
 * A CKB page: `<main aria-busy>` → `role="status"` → one sr-only sentence → `CkbHeader` → the body
 * column. `bodyClassName` is for the pages whose column is narrower than `CkbBody`'s default
 * (`max-w-3xl` on the wizards, `max-w-4xl` on Pengaturan).
 */
export function CkbPageSkeleton({ label, back, subtitle = true, live = false, pills = 1, actions = 0, bodyClassName, children }: {
  label: string; back?: boolean; subtitle?: boolean; live?: boolean; pills?: number; actions?: number; bodyClassName?: string; children: ReactNode;
}) {
  return (
    <main aria-busy="true">
      <div role="status">
        <span className="sr-only">{label}</span>
        <CkbHeaderSkeleton back={back} subtitle={subtitle} live={live} pills={pills} actions={actions} />
        <div className={cn("space-y-6 p-4 pb-24 lg:p-8", bodyClassName)}>{children}</div>
      </div>
    </main>
  );
}

/**
 * `FilterBar`: a white form of label + field pairs that reads the URL. It is the shared
 * `ToolbarSkeleton` in CKB's layout — two across on a phone, a wrapping row from `lg` up — with the
 * two buttons the real bar always ends in (Terapkan, Reset).
 */
export function CkbFilterSkeleton({ fields = 2, actions = 2, delayMs = 120, className }: {
  fields?: number; actions?: number; delayMs?: number; className?: string;
}) {
  return (
    <ToolbarSkeleton search={false} fields={fields} actions={actions} delayMs={delayMs}
      className={cn("grid grid-cols-2 gap-3 rounded-lg border border-steel-100 bg-white p-3 sm:grid-cols-3 lg:flex lg:flex-wrap lg:items-end", className)} />
  );
}

/** The `Notice` band CKB puts above the data: pale tint for context, amber when it limits a promise. */
export function CkbNoticeSkeleton({ lines = 2, delayMs = 80, className }: { lines?: number; delayMs?: number; className?: string }) {
  return (
    <div aria-hidden className={cn("rounded-lg bg-ckb-tint/50 px-4 py-3", PULSE, className)} style={{ animationDelay: `${delayMs}ms` }}>
      <Lines count={lines} width={["w-full max-w-3xl", "w-full max-w-2xl", "w-1/2"]} />
    </div>
  );
}

/**
 * The `StatTile` box — a label over a `font-cond` figure (4xl), an optional hint under it. Not the
 * shared `TilesSkeleton`: that one is the Shell dashboard's tile with an icon and a meter, and CKB
 * never prints a meter (there is no CKB stock ledger to measure against).
 */
export function CkbStatTilesSkeleton({ count = 4, columns = "grid-cols-2 gap-3 md:grid-cols-4", hint = false, delayMs = 140 }: {
  count?: number; columns?: string; hint?: boolean; delayMs?: number;
}) {
  return (
    <div aria-hidden className={cn("grid", columns, PULSE)} style={{ animationDelay: `${delayMs}ms` }}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-lg border border-steel-100 bg-white p-4">
          <Bone className="h-2.5 w-20 rounded" />
          {/* The 4xl figure: a little air under the label, the same height it will print at. */}
          <Bone className="mt-2.5 h-9 w-16 rounded" />
          {hint && <Bone className="mt-2 h-2 w-24 rounded" />}
        </div>
      ))}
    </div>
  );
}

/** A plain CKB table in its white `rounded-lg border border-steel-100` box, with no card head. */
export function CkbTableSkeleton({ columns = 8, rows = 10, phoneColumns, delayMs = 240, className }: {
  columns?: number; rows?: number; phoneColumns?: number; delayMs?: number; className?: string;
}) {
  return (
    <div aria-hidden className={cn("rounded-lg border border-steel-100 bg-white", className)}>
      <TableSkeleton columns={columns} rows={rows} phoneColumns={phoneColumns} delayMs={delayMs} />
    </div>
  );
}

/**
 * The CKB list: a card per record on a phone (its reference, a status pill, then the one line of
 * facts), the same rows as a table from `md` up. Stock take, Inspeksi, Customer and Pengguna all
 * switch exactly here.
 */
export function CkbListSkeleton({ columns = 7, rows = 8, delayMs = 220 }: { columns?: number; rows?: number; delayMs?: number }) {
  return (
    <>
      <ul aria-hidden className="space-y-2 md:hidden">
        {Array.from({ length: rows }, (_, i) => (
          <li key={i} className={cn("rounded-lg border border-steel-100 bg-white p-4", PULSE)} style={{ animationDelay: `${delayMs + i * 20}ms` }}>
            <div className="flex items-center justify-between gap-2">
              <Bone className="h-5 w-24 rounded" />
              <Bone className="h-5 w-16 rounded" />
            </div>
            <Bone className="mt-2 h-3 w-3/4 rounded" />
          </li>
        ))}
      </ul>
      <div aria-hidden className="hidden rounded-lg border border-steel-100 bg-white md:block">
        <TableSkeleton columns={columns} rows={rows} delayMs={delayMs + 20} />
      </div>
    </>
  );
}

/** `Facts`: the label-over-value list a record opens with, 2 up on a phone and 4 up on a desktop. */
export function CkbFactsSkeleton({ items = 8, delayMs = 120, className }: { items?: number; delayMs?: number; className?: string }) {
  return (
    <dl aria-hidden className={cn("grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-4", PULSE, className)}
      style={{ animationDelay: `${delayMs}ms` }}>
      {Array.from({ length: items }, (_, i) => (
        <div key={i} className="min-w-0">
          <Bone className="h-2 w-16 rounded" />
          <Bone className="mt-1.5 h-3.5 w-24 rounded" />
        </div>
      ))}
    </dl>
  );
}

/**
 * The counting rows. This screen is used one-handed on a phone, so the shape is a single column of
 * full-width rows: the bin code on its pale plate, the material with its description and its batch /
 * expiry / unit line, the status pill and the chevron at the right. No grid, no columns to scroll.
 */
export function CkbCountRowsSkeleton({ rows = 6, delayMs = 200 }: { rows?: number; delayMs?: number }) {
  return (
    <ul aria-hidden className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className={cn("flex items-start gap-3 rounded-lg border border-steel-100 bg-white p-3", PULSE)}
          style={{ animationDelay: `${delayMs + i * 30}ms` }}>
          {/* The bin plate, shown like the yellow location plate on the rack. */}
          <span className="shrink-0 rounded-plate bg-plate px-2 py-1">
            <Bone className="h-4 w-14 rounded bg-steel/25" />
          </span>
          <span className="min-w-0 flex-1 space-y-1.5">
            <Bone className="h-3.5 w-24 rounded" />
            <Bone className="h-3 w-2/3 rounded" />
            <Bone className="h-2.5 w-40 rounded" />
          </span>
          <span className="flex shrink-0 flex-col items-end gap-1.5">
            <Bone className="h-5 w-16 rounded" />
            <Bone className="h-4 w-4 rounded" />
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The session's stage rail (DRAFT → COUNTING → REVIEW → CLOSED): a numbered stop per stage, the
 * connecting rule between them, the current stage the one block that is lit. It is placed where the
 * real page states which stage the session is in, so the wizard reads as one flow rather than three
 * unrelated screens.
 */
export function CkbStepRailSkeleton({ steps = 3, active = 0, delayMs = 100, className }: {
  steps?: number; active?: number; delayMs?: number; className?: string;
}) {
  return (
    <ol aria-hidden className={cn("flex items-center gap-2 rounded-lg border border-steel-100 bg-white px-3 py-2.5", PULSE, className)}
      style={{ animationDelay: `${delayMs}ms` }}>
      {Array.from({ length: steps }, (_, i) => (
        <li key={i} className="flex min-w-0 flex-1 items-center gap-2">
          <Bone className={cn("h-6 w-6 shrink-0 rounded-full", i === active ? "bg-ckb/30" : i < active ? "bg-ckb/15" : "bg-steel-100")} />
          <Bone className={cn("rounded", i === active ? "h-2.5 w-16 bg-steel-300/70" : "h-2 w-12")} />
          {i < steps - 1 && <span className="ml-1 h-px flex-1 bg-steel-100" />}
        </li>
      ))}
    </ol>
  );
}

/**
 * Evidence: square thumbnails in a grid, each with its one-line caption (time, uploader, note). This
 * is `EvidenceCard`'s gallery in the rebagging workspace. Deliberately not a chart — evidence is
 * append-only, it has no trend to draw.
 */
export function CkbPhotoGridSkeleton({ count = 4, columns = "grid-cols-2 sm:grid-cols-4", captions = true, delayMs = 260, className }: {
  count?: number; columns?: string; captions?: boolean; delayMs?: number; className?: string;
}) {
  return (
    <div aria-hidden className={cn("grid gap-3", columns, PULSE)} style={{ animationDelay: `${delayMs}ms` }}>
      {Array.from({ length: count }, (_, i) => (
        <figure key={i} className="space-y-1">
          {/* EvidenceImage is a square, rounded-lg tile. */}
          <Bone className="aspect-square w-full rounded-lg" />
          {captions && (
            <>
              <Bone className="h-2 w-3/4 rounded" />
              <Bone className="h-2 w-1/2 rounded" />
            </>
          )}
        </figure>
      ))}
    </div>
  );
}

/**
 * A summary sheet: the heading, the prose that says what the sheet contains, then the row of
 * downloads (Excel / PDF) at the height of the real buttons, and a footnote rule under them. Used by
 * the session export page, where the whole page is a document rather than a list.
 */
export function CkbSheetSkeleton({ lines = 2, actions = 3, note = true, delayMs = 160 }: {
  lines?: number; actions?: number; note?: boolean; delayMs?: number;
}) {
  return (
    <section aria-hidden className="rounded-lg border border-steel-100 bg-white">
      <div className="border-b border-steel-100 px-4 py-3">
        <Bone className={cn("h-5 w-40 rounded", PULSE)} style={{ animationDelay: `${delayMs}ms` }} />
      </div>
      <div className={cn("space-y-3 p-4", PULSE)} style={{ animationDelay: `${delayMs + 20}ms` }}>
        <Lines count={lines} width={["w-full max-w-2xl", "w-4/5", "w-2/3"]} />
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: actions }, (_, i) => <Bone key={i} className="h-10 w-40 rounded-md" />)}
        </div>
        {note && <Bone className="h-2 w-full max-w-sm rounded" />}
      </div>
    </section>
  );
}

/**
 * Two snapshots, identity by identity: the change pill, the stock identity, then the pair of columns
 * that must be read together — quantity at A, quantity at B, and the delta. The header row keeps A
 * and B as one group so the shape cannot be mistaken for a single-column table.
 */
export function CkbCompareSkeleton({ rows = 8, delayMs = 240 }: { rows?: number; delayMs?: number }) {
  const template = "0.8fr 2fr 0.9fr 0.9fr 0.9fr 0.6fr 0.8fr 0.8fr 0.8fr";
  return (
    <div aria-hidden className="overflow-x-auto rounded-lg border border-steel-100 bg-white">
      <div className="grid gap-3 border-b border-steel-300 px-3 py-2" style={{ gridTemplateColumns: template }}>
        {["w-14", "w-16", "w-10", "w-10", "w-10", "w-8", "w-10", "w-10", "w-10"].map((w, i) => (
          <Bone key={i} className={cn("h-2 rounded", w, i > 5 && "ml-auto")} />
        ))}
      </div>
      <div className={PULSE} style={{ animationDelay: `${delayMs}ms` }}>
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="grid items-center gap-3 border-b border-steel-100/70 px-3 py-3 last:border-b-0"
            style={{ gridTemplateColumns: template }}>
            <Bone className="h-5 w-14 rounded" />
            <div>
              <Bone className={cn("h-2.5 rounded", r % 2 ? "w-2/3" : "w-1/2")} />
              <Bone className="mt-1.5 h-2 w-1/3 rounded" />
            </div>
            <Bone className="h-2.5 w-12 rounded" />
            <Bone className="h-2.5 w-12 rounded" />
            <Bone className="h-2.5 w-14 rounded" />
            <Bone className="h-2.5 w-8 rounded" />
            {/* A · B · selisih, right-aligned as three numbers of one comparison. */}
            <Bone className="ml-auto h-2.5 w-10 rounded" />
            <Bone className="ml-auto h-2.5 w-10 rounded" />
            <Bone className="ml-auto h-2.5 w-12 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Let a page keep its own stagger without repeating the style object. */
export function pulseDelay(ms: number): CSSProperties {
  return { animationDelay: `${ms}ms` };
}
