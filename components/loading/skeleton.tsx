import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { TODAY_BOARD, TODAY_PANEL_ATTR } from "@/components/floor/floor";

/**
 * The skeleton kit — every `loading.tsx` in the app is built from these pieces, so the wait looks
 * the same whether the floor opened Wave, Inventory or the 3D warehouse. It is the vocabulary of
 * `app/(app)/loading.tsx`, extracted: one `Bone`, one card, one pulse rule, then the page shapes the
 * app actually has (tiles, a table, a list, a chart, a form, a toolbar, a detail header, the navy
 * band).
 *
 * Nothing is written on a skeleton. A placeholder that prints a number would be lying, and every
 * number in this app is a measurement of the stock.
 *
 * a11y: `role="status"` is the correct role. A skeleton is a wait of unknown length, so
 * `progressbar` (which promises a measurable completion) would be wrong. One sr-only Indonesian
 * sentence does the announcing, and the decorative tree is aria-hidden. `<main aria-busy>` keeps the
 * landmark the real pages give.
 *
 * Motion: one pulse per group, the groups a few tens of milliseconds apart, so a single wave travels
 * down the page instead of forty separate flickers. The project stops every animation under
 * prefers-reduced-motion (globals.css base layer); `motion-reduce:animate-none` states the same thing
 * on these blocks, and the resting state is the plain steel block — still a full placeholder.
 *
 * These are server components: no hooks, no randomness, no data. A block that varied per render
 * would hydrate into a different picture than the HTML it replaced.
 */

export const SKELETON_CARD =
  "overflow-hidden rounded-xl bg-white shadow-[0_1px_2px_rgba(3,39,65,0.05)] ring-1 ring-steel-100";

/** Kept for the 60 skeleton files that pass it: the motion now lives on each block (`skel`, one shared
 *  left-to-right sweep in globals.css), so a group no longer pulses on its own. */
export const PULSE = "";

/**
 * One loading block. Light surfaces use the palette's own rule colour (steel-100); the navy band
 * uses white at low alpha, so the block stays a lighter part of the band rather than a hole in it.
 */
export function Bone({ className, onNavy = false, style }: {
  className?: string; onNavy?: boolean; style?: CSSProperties;
}) {
  return (
    <div aria-hidden data-skeleton className={cn("skel", onNavy ? "skel-navy bg-white/15" : "bg-steel-100", className)} style={style} />
  );
}

/** PageHeader: the same 64px white bar, so the title lands exactly where the bar was. */
export function HeaderSkeleton() {
  return (
    <div aria-hidden className="flex flex-wrap items-center justify-between gap-3 border-b border-steel-100 bg-white px-4 py-4 lg:px-8">
      <div className={cn("flex items-center gap-3", PULSE)}>
        {/* Phones have no sidebar: their 36px logo link sits here. */}
        <Bone className="h-9 w-9 rounded-md lg:hidden" />
        <Bone className="h-8 w-44 rounded sm:w-56" />
        {/* The Live dot that most pages put next to the title. */}
        <Bone className="h-2 w-2 rounded-full" />
      </div>
      {/* Account avatar, phone only (the desktop sidebar carries the account box). */}
      <Bone className={cn("ml-auto h-10 w-10 rounded-full lg:hidden", PULSE)} />
    </div>
  );
}

/**
 * The standard page: `<main aria-busy>` → `role="status"` → one sr-only sentence → the header and the
 * page's own column. Pass `className` when the page's column is not the usual `p-4 lg:p-8` stack
 * (a full-bleed page like the 3D warehouse, or a bar pinned above the padding).
 */
export function PageSkeleton({ label = "Memuat halaman", header = true, mainClassName, className = "flex flex-col gap-5 p-4 lg:p-8", children }: {
  label?: string; header?: boolean; mainClassName?: string; className?: string; children: ReactNode;
}) {
  return (
    <main aria-busy="true" className={cn("skel-in", mainClassName)}>
      <div role="status">
        {/* The only words on the screen, for screen readers: the blocks themselves say nothing. */}
        <span className="sr-only">{label}</span>
        {header && <HeaderSkeleton />}
        <div className={className}>{children}</div>
      </div>
    </main>
  );
}

/**
 * A card's header row: title, subtitle, and the chip or button the real card puts at its right edge.
 * `right` is the whole class list for that chip — shape included — because the app's cards end in a
 * pill, a rounded button, or nothing at all.
 */
export function CardHeadSkeleton({ className, titleClass = "h-5 w-36", subClass = "h-2.5 w-44 sm:w-64", right = null, style, delayMs = 0 }: {
  className?: string; titleClass?: string; subClass?: string | null; right?: string | null; style?: CSSProperties; delayMs?: number;
}) {
  return (
    <div aria-hidden className={cn("flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pb-3 pt-4", PULSE, className)}
      style={delayMs ? { animationDelay: `${delayMs}ms` } : undefined}>
      <div className="space-y-1.5">
        <Bone className={cn("rounded", titleClass)} />
        {subClass && <Bone className={cn("rounded", subClass)} />}
      </div>
      {right && <Bone className={cn("rounded-full", right)} />}
    </div>
  );
}

/** The navy "Operasi hari ini" band: eyebrow, heading, status pill, plan gauges, then the stat strip. */
export function StatBandSkeleton({ gauges = 2, stats = 4, desktopOnly = false, style, className, todayPanel = false }: {
  gauges?: number; stats?: number;
  /** the group skeleton hides the band on a phone: most pages do not open with a hero */
  desktopOnly?: boolean;
  style?: CSSProperties; className?: string;
  /** the Dashboard's "Hari ini" band: Home's board can land on it at once (components/floor/floor-door-link.tsx) */
  todayPanel?: boolean;
}) {
  return (
    <section aria-hidden {...(todayPanel ? { [TODAY_PANEL_ATTR]: "", style: { viewTransitionName: TODAY_BOARD } } : {})} className={cn(
      "relative overflow-hidden rounded-2xl bg-jeir-side ring-1 ring-jeir-navy/30",
      desktopOnly ? "hidden lg:block" : "block", className)}>
      {/* The band's own dot cloud, so the navy block has depth instead of reading as a slab. */}
      <span className="home-dots pointer-events-none absolute -right-10 -top-10 h-40 w-72 opacity-80" />

      <div className={cn("relative px-4 pt-4 lg:px-6", PULSE)} style={style}>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="space-y-2">
            <Bone onNavy className="h-2.5 w-24 rounded" />
            <Bone onNavy className="h-6 w-48 rounded lg:w-64" />
          </div>
          <Bone onNavy className="h-6 w-36 rounded-full" />
        </div>

        {/* The plan gauges, side by side — the same pair the dashboard prints. */}
        <div className={cn("mt-4 grid gap-x-6 gap-y-3", gauges > 1 ? "grid-cols-2" : "grid-cols-1")}>
          {Array.from({ length: gauges }, (_, i) => (
            <div key={i} className="min-w-0 space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <Bone onNavy className="h-2.5 w-20 rounded" />
                <Bone onNavy className="h-6 w-14 rounded" />
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/15">
                {/* The fill is static: a bar that animates would claim measurable progress. */}
                <div className="h-full rounded-full bg-jeir-teal/60" style={{ width: i === 0 ? "66%" : "42%" }} />
              </div>
              <Bone onNavy className="h-2 w-40 rounded" />
            </div>
          ))}
        </div>
      </div>

      {/* Stat strip: the band's own border rules, a pulse step behind the head. */}
      <div
        className={cn("relative mt-4 grid border-t border-white/10", PULSE, desktopOnly ? "grid-cols-4" : "grid-cols-2 sm:grid-cols-4")}
        style={{ animationDelay: "70ms" }}>
        {Array.from({ length: stats }, (_, i) => (
          <div key={i} className={cn(
            "border-white/10 px-3 py-3 lg:px-6 lg:py-4",
            desktopOnly
              ? "border-l first:border-l-0"
              : "border-t [&:nth-child(-n+2)]:border-t-0 sm:border-l sm:border-t-0 sm:first:border-l-0")}>
            <Bone onNavy className="h-2 w-16 rounded" />
            <Bone onNavy className="mt-1.5 h-6 w-12 rounded" />
            <Bone onNavy className="mt-1.5 h-2 w-24 rounded" />
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Summary tiles: two across on a phone, the given count on a desktop. `compact` is the plain white
 * total box (`label` over one big value) that Inventory and Penerimaan open with; the full tile adds
 * an icon, a caption and the meter a total usually sits above.
 */
export function TilesSkeleton({ count = 4, columns = "grid-cols-2 gap-4 lg:grid-cols-4 lg:gap-5", compact = false, delayMs = 140, className }: {
  count?: number; columns?: string; compact?: boolean; delayMs?: number; className?: string;
}) {
  return (
    <div aria-hidden className={cn("grid", columns, className)}>
      {Array.from({ length: count }, (_, i) => (
        compact ? (
          <div key={i} className={cn("rounded-lg bg-white p-3", PULSE)} style={{ animationDelay: `${delayMs}ms` }}>
            <Bone className="h-2 w-16 rounded" />
            <Bone className="mt-2 h-6 w-20 rounded" />
          </div>
        ) : (
          <div key={i} className={SKELETON_CARD}>
            {/* The pulse sits inside the card, never on it: a white card fading to grey would flash. */}
            <div className={cn("px-4 py-4", PULSE)} style={{ animationDelay: `${delayMs}ms` }}>
              <div className="flex items-center gap-2">
                <Bone className="h-7 w-7 rounded-lg" />
                <Bone className="h-2 w-16 rounded" />
              </div>
              <Bone className="mt-3 h-7 w-20 rounded" />
              <Bone className="mt-2 h-2 w-24 rounded" />
              {/* Foot of the tile: the meter a total usually sits above. */}
              <div className="mt-3 h-1 overflow-hidden rounded-full bg-steel-100">
                <div className="h-full w-3/5 rounded-full bg-steel-300/45" />
              </div>
            </div>
          </div>
        )
      ))}
    </div>
  );
}

/** Column tracks for a table skeleton: the identity column, the description, then the numbers. */
function columnTemplate(columns: number): string {
  if (columns <= 1) return "1fr";
  if (columns === 2) return "2fr 1fr";
  return ["1.2fr", "2fr", ...Array.from({ length: columns - 2 }, () => "1fr")].join(" ");
}

const CELL_WIDTHS = ["w-2/3", "w-1/2", "w-3/4", "w-3/5", "w-2/3", "w-1/2"];

/**
 * A table's rows as bones. `phoneColumns` renders a narrower grid under `md` so a wide stock table
 * does not turn into stripes on a 390px screen — the real table scrolls, so the eye only ever sees
 * its first few columns there.
 */
export function TableSkeleton({ columns = 4, rows = 6, header = true, phoneColumns, delayMs = 300, className }: {
  columns?: number; rows?: number; header?: boolean; phoneColumns?: number; delayMs?: number; className?: string;
}) {
  const head = (cols: number) => (
    <div className="grid gap-4 border-b border-steel-100 px-4 py-2" style={{ gridTemplateColumns: columnTemplate(cols) }}>
      {Array.from({ length: cols }, (_, i) => <Bone key={i} className="h-2 w-14 rounded" />)}
    </div>
  );

  const body = (cols: number) => (
    <div className={cn(PULSE, className)} style={{ animationDelay: `${delayMs}ms` }}>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="grid items-center gap-4 border-b border-steel-100/70 px-4 py-3 last:border-b-0"
          style={{ gridTemplateColumns: columnTemplate(cols) }}>
          <Bone className="h-4 w-16 rounded" />
          {cols > 1 && (
            <div>
              <Bone className={cn("h-2.5 rounded", CELL_WIDTHS[r % CELL_WIDTHS.length])} />
              <Bone className="mt-1.5 h-2 w-1/3 rounded" />
            </div>
          )}
          {Array.from({ length: Math.max(cols - 2, 0) }, (_, c) => (
            <Bone key={c} className={cn("h-2.5 rounded", c === cols - 3 ? "ml-auto w-10" : "w-12")} />
          ))}
        </div>
      ))}
    </div>
  );

  return (
    <div aria-hidden>
      {phoneColumns && phoneColumns < columns ? (
        <>
          <div className="md:hidden">
            {header && head(phoneColumns)}
            {body(phoneColumns)}
          </div>
          <div className="hidden md:block">
            {header && head(columns)}
            {body(columns)}
          </div>
        </>
      ) : (
        <>
          {header && head(columns)}
          {body(columns)}
        </>
      )}
    </div>
  );
}

/** Full-width list: a real table on a desktop, the same rows as cards on a phone. */
export function TableCardSkeleton({ columns = 4, rows = 6, className, delayMs = 280 }: {
  columns?: number; rows?: number; className?: string; delayMs?: number;
}) {
  return (
    <section aria-hidden className={cn(SKELETON_CARD, className)}>
      <CardHeadSkeleton titleClass="h-5 w-40" subClass="h-2.5 w-56" right="hidden h-6 w-28 rounded-md sm:block" delayMs={delayMs} />

      <div className="hidden border-t border-steel-100 md:block">
        <TableSkeleton columns={columns} rows={rows} delayMs={delayMs + 20} />
      </div>

      <div className={cn("space-y-2 border-t border-steel-100 p-2 md:hidden", PULSE)} style={{ animationDelay: `${delayMs + 20}ms` }}>
        {CELL_WIDTHS.slice(0, Math.min(rows, 3)).map((width, i) => (
          <div key={i} className="rounded-lg bg-paper px-3 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <Bone className="h-3 w-16 rounded" />
              <Bone className="h-2.5 w-12 rounded" />
            </div>
            <Bone className={cn("mt-2 h-2.5 rounded", width)} />
            <Bone className="mt-1.5 h-2 w-1/2 rounded" />
          </div>
        ))}
      </div>
    </section>
  );
}

/** Narrow card with a work queue: icon tile, two lines, the count on the right. `columns` 2 pairs them up. */
export function ListCardSkeleton({ rows = 4, columns = 1, className = "lg:col-span-2", delayMs = 220 }: {
  rows?: number; columns?: 1 | 2; className?: string; delayMs?: number;
}) {
  const widths = ["w-3/5", "w-2/3", "w-1/2", "w-3/5"];
  return (
    <section aria-hidden className={cn(SKELETON_CARD, className)}>
      <CardHeadSkeleton titleClass="h-5 w-32" subClass="h-2.5 w-44" right="h-5 w-20" delayMs={delayMs} />

      <div className={cn("border-t border-steel-100 p-2", columns === 2 && "grid gap-x-2 sm:grid-cols-2")}>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className={cn("grid grid-cols-[auto_1fr_auto] items-center gap-3 px-2.5 py-2.5", PULSE)}
            style={{ animationDelay: `${delayMs + 20}ms` }}>
            <Bone className="h-9 w-9 rounded-lg" />
            <div className="min-w-0">
              <Bone className={cn("h-2.5 rounded", widths[i % widths.length])} />
              <Bone className="mt-1.5 h-2 w-full rounded" />
              <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-steel-100">
                <div className="h-full w-2/3 rounded-full bg-steel-300/60" />
              </div>
            </div>
            <div className="flex flex-col items-end">
              <Bone className="h-6 w-8 rounded" />
              <Bone className="mt-1 h-2 w-10 rounded" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Wide card with a chart: header, `lead` figures, a fortnight of paired bars, legend, footnote. */
export function ChartCardSkeleton({ bars = 14, lead = false, className = "lg:col-span-3", delayMs = 180 }: {
  bars?: number; lead?: boolean; className?: string; delayMs?: number;
}) {
  const heights = [42, 68, 51, 84, 60, 37, 74, 92, 55, 63, 29, 78, 47, 88];
  return (
    <section aria-hidden className={cn(SKELETON_CARD, className)}>
      <CardHeadSkeleton titleClass="h-5 w-36" subClass="h-2.5 w-44 sm:w-64" right="hidden h-6 w-24 rounded-full sm:block" delayMs={delayMs} />

      <div className="border-t border-steel-100 px-4 py-4">
        {lead && (
          <div className={cn("mb-3 space-y-1.5", PULSE)} style={{ animationDelay: `${delayMs + 20}ms` }}>
            <Bone className="h-2 w-16 rounded" />
            <Bone className="h-8 w-44 rounded" />
            <Bone className="h-2 w-56 rounded" />
            <Bone className="h-2 w-40 rounded" />
          </div>
        )}
        <div className={cn("flex h-40 items-end gap-[3px] lg:h-44", PULSE)} style={{ animationDelay: `${delayMs + 20}ms` }}>
          {Array.from({ length: bars }, (_, i) => {
            const h = heights[i % heights.length];
            return (
              <div key={i} className="flex h-full min-w-0 flex-1 items-end justify-center gap-[3px]">
                <Bone className="w-full max-w-[10px] rounded-sm lg:max-w-[16px]" style={{ height: `${h}%` }} />
                <Bone className="w-full max-w-[10px] rounded-sm lg:max-w-[16px]" style={{ height: `${Math.round(h * 0.55)}%` }} />
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <Bone className="h-2 w-8 rounded-sm" />
          <Bone className="h-2 w-14 rounded" />
          <Bone className="h-2 w-10 rounded-sm" />
          <Bone className="h-2 w-16 rounded" />
          <Bone className="ml-auto h-2 w-20 rounded" />
        </div>
      </div>

      <div className="border-t border-steel-100 px-4 py-2.5">
        <Bone className="h-2 w-full max-w-[420px] rounded" />
      </div>
    </section>
  );
}

/** Two half-width cards under it all, so a desktop scroll never reaches the footer early. */
export function PairSkeleton({ cards = 2, className, delayMs = 360 }: { cards?: number; className?: string; delayMs?: number }) {
  return (
    <div aria-hidden className={cn("grid gap-5 lg:grid-cols-2", className)}>
      {Array.from({ length: cards }, (_, i) => (
        <section key={i} className={SKELETON_CARD}>
          <CardHeadSkeleton className="px-4 pb-3 pt-4" titleClass="h-5 w-32" subClass="h-2.5 w-48" delayMs={delayMs} />
          <div className={cn("space-y-2 border-t border-steel-100 px-4 py-4", PULSE)} style={{ animationDelay: `${delayMs + 20}ms` }}>
            {[0, 1, 2].map((r) => (
              <div key={r} className="flex items-center gap-2">
                <Bone className="h-3 w-10 shrink-0 rounded" />
                <Bone className="h-2.5 flex-1 rounded" />
                <Bone className="h-2.5 w-10 rounded" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** A white bar of filters above a list: the search field, the selects, the checkboxes, the actions. */
export function ToolbarSkeleton({ fields = 3, search = true, checks = 0, actions = 1, className = "flex flex-wrap items-end gap-3 rounded-lg bg-white p-4", delayMs = 120 }: {
  fields?: number; search?: boolean; checks?: number; actions?: number; className?: string; delayMs?: number;
}) {
  return (
    <div aria-hidden className={cn(className, PULSE)} style={{ animationDelay: `${delayMs}ms` }}>
      {search && (
        <div className="w-full min-w-56 flex-1 sm:w-auto">
          <Bone className="mb-1 h-2.5 w-12 rounded" />
          <Bone className="h-10 w-full rounded-md" />
        </div>
      )}
      {Array.from({ length: fields }, (_, i) => (
        <div key={i}>
          <Bone className="mb-1 h-2.5 w-12 rounded" />
          <Bone className="h-10 w-24 rounded-md" />
        </div>
      ))}
      {Array.from({ length: checks }, (_, i) => (
        <div key={i} className="flex items-center gap-2 pb-2">
          <Bone className="h-4 w-4 rounded-sm" />
          <Bone className="h-2.5 w-24 rounded" />
        </div>
      ))}
      {actions > 0 && (
        <div className="ml-auto flex gap-2">
          {Array.from({ length: actions }, (_, i) => <Bone key={i} className="h-10 w-24 rounded-md" />)}
        </div>
      )}
    </div>
  );
}

/** A detail page's opening: the way back, the title, its metadata, and the actions on the right. */
export function DetailHeaderSkeleton({ back = true, title = true, meta = 3, actions = 2, className, delayMs = 100 }: {
  back?: boolean; title?: boolean; meta?: number; actions?: number; className?: string; delayMs?: number;
}) {
  return (
    <div aria-hidden className={cn("space-y-3", PULSE, className)} style={{ animationDelay: `${delayMs}ms` }}>
      {back && <Bone className="h-2.5 w-32 rounded" />}
      {(title || actions > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {title ? <Bone className="h-8 w-48 rounded sm:w-64" /> : <span />}
          {actions > 0 && (
            <div className="flex gap-2">
              {Array.from({ length: actions }, (_, i) => <Bone key={i} className="h-10 w-24 rounded-md" />)}
            </div>
          )}
        </div>
      )}
      {meta > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {Array.from({ length: meta }, (_, i) => <Bone key={i} className="h-2.5 w-24 rounded" />)}
        </div>
      )}
    </div>
  );
}

/** A card that takes input: the title, a label + field per row, an optional note, the save button. */
export function FormCardSkeleton({ fields = 4, textarea = true, submit = true, className, delayMs = 140 }: {
  fields?: number; textarea?: boolean; submit?: boolean; className?: string; delayMs?: number;
}) {
  return (
    <section aria-hidden className={cn(SKELETON_CARD, className)}>
      <CardHeadSkeleton className="px-4 pb-2 pt-4" subClass={null} right={null} delayMs={delayMs} />
      <div className={cn("space-y-3 border-t border-steel-100 p-4", PULSE)} style={{ animationDelay: `${delayMs + 20}ms` }}>
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: fields }, (_, i) => (
            <div key={i}>
              <Bone className="mb-1 h-2.5 w-16 rounded" />
              <Bone className="h-10 w-full rounded-md" />
            </div>
          ))}
        </div>
        {textarea && (
          <div>
            <Bone className="mb-1 h-2.5 w-20 rounded" />
            <Bone className="h-20 w-full rounded-md" />
          </div>
        )}
        {submit && (
          <div className="flex justify-end gap-2 pt-1">
            <Bone className="h-10 w-32 rounded-md" />
          </div>
        )}
      </div>
    </section>
  );
}
