import type { CSSProperties } from "react";

/**
 * Route-group skeleton — what the floor sees the instant a nav link is tapped, while the server
 * renders the next page. It fills the main column only: the sidebar, the phone bottom bar and the
 * footer come from (app)/layout.tsx and never blink, so the shell stays whole and only the content
 * is missing.
 *
 * Two page shapes share this group, so the skeleton carries both:
 *   • the dashboard's navy "hari ini" band, with its gauges and four stat tiles,
 *   • every other page's PageHeader + stack of white `rounded-xl ring-steel-100` cards.
 * Blocks sit at the height the real blocks land on, so the swap-in does not jump. Nothing is
 * written: a placeholder that prints a number would be lying, and every number is a measurement
 * of the stock.
 *
 * a11y: `role="status"` is the correct one. A skeleton is a wait of unknown length, so
 * `progressbar` (which promises a measurable completion) would be wrong; one sr-only sentence does
 * the announcing, in Indonesian like every other string on screen, and the decorative tree is
 * aria-hidden. `<main aria-busy>` keeps the landmark the real pages give.
 *
 * Motion: one pulse per group, the groups a few tens of milliseconds apart, so a single wave
 * travels down the page instead of forty separate flickers. The project stops every animation under
 * prefers-reduced-motion (globals.css base layer); `motion-reduce:animate-none` states the same
 * thing on these blocks, and the resting state is the plain steel block — still a full placeholder.
 */

const CARD = "overflow-hidden rounded-xl bg-white shadow-[0_1px_2px_rgba(3,39,65,0.05)] ring-1 ring-steel-100";
/** Pulse the group, not each block: the eye reads one wave, and there are far fewer animations. */
const PULSE = "animate-pulse motion-reduce:animate-none";

/**
 * One loading block. Light surfaces use the palette's own rule colour (steel-100); the navy band
 * uses white at low alpha, so the block stays a lighter part of the band rather than a hole in it.
 */
function Bone({ className = "", onNavy = false, style }: { className?: string; onNavy?: boolean; style?: CSSProperties }) {
  return <div aria-hidden data-skeleton className={`${onNavy ? "bg-white/15" : "bg-steel-100"} ${className}`} style={style} />;
}

/** PageHeader: the same 64px white bar, so the title lands exactly where the bar was. */
function HeaderSkeleton() {
  return (
    <div aria-hidden className="flex flex-wrap items-center justify-between gap-3 border-b border-steel-100 bg-white px-4 py-4 lg:px-8">
      <div className={`flex items-center gap-3 ${PULSE}`}>
        {/* Phones have no sidebar: their 36px logo link sits here. */}
        <Bone className="h-9 w-9 rounded-md lg:hidden" />
        <Bone className="h-8 w-44 rounded sm:w-56" />
        {/* The Live dot that most pages put next to the title. */}
        <Bone className="h-2 w-2 rounded-full" />
      </div>
      {/* Account avatar, phone only (the desktop sidebar carries the account box). */}
      <Bone className={`ml-auto h-10 w-10 rounded-full lg:hidden ${PULSE}`} />
    </div>
  );
}

/**
 * The dashboard's navy band: "Operasi hari ini", two plan gauges, then the four stat tiles.
 * Desktop only — on a phone the group's pages open with tiles and cards, and a 400px navy slab
 * would claim a hero that most of them do not have.
 */
function BandSkeleton() {
  return (
    <section aria-hidden className="relative hidden overflow-hidden rounded-2xl bg-jeir-side ring-1 ring-jeir-navy/30 lg:block">
      {/* The band's own dot cloud, so the navy block has depth instead of reading as a slab. */}
      <span className="home-dots pointer-events-none absolute -right-10 -top-10 h-40 w-72 opacity-70" />

      <div className={`relative px-4 pt-4 lg:px-6 ${PULSE}`}>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="space-y-2">
            <Bone onNavy className="h-2.5 w-24 rounded" />
            <Bone onNavy className="h-6 w-48 rounded lg:w-64" />
          </div>
          <Bone onNavy className="h-6 w-36 rounded-full" />
        </div>

        {/* Two plan gauges, side by side — the same pair the dashboard prints. */}
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3">
          {[66, 42].map((fill) => (
            <div key={fill} className="space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <Bone onNavy className="h-2.5 w-20 rounded" />
                <Bone onNavy className="h-6 w-14 rounded" />
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/15">
                {/* The fill is static: a bar that animates would claim measurable progress. */}
                <div className="h-full rounded-full bg-jeir-teal/60" style={{ width: `${fill}%` }} />
              </div>
              <Bone onNavy className="h-2 w-40 rounded" />
            </div>
          ))}
        </div>
      </div>

      {/* Stat strip: one row of four — BandStat's own border rules. */}
      <div className={`relative mt-4 grid grid-cols-4 border-t border-white/10 ${PULSE} [animation-delay:70ms]`}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="border-l border-white/10 px-3 py-3 first:border-l-0 lg:px-6 lg:py-4">
            <Bone onNavy className="h-2 w-16 rounded" />
            <Bone onNavy className="mt-1.5 h-6 w-12 rounded" />
            <Bone onNavy className="mt-1.5 h-2 w-24 rounded" />
          </div>
        ))}
      </div>
    </section>
  );
}

/** Four summary tiles: two across on a phone, four on a desktop — the shape pages use for totals. */
function TilesSkeleton() {
  return (
    <div aria-hidden className="grid grid-cols-2 gap-4 lg:grid-cols-4 lg:gap-5">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className={CARD}>
          {/* The pulse sits inside the card, never on it: a white card fading to grey would flash. */}
          <div className={`px-4 py-4 ${PULSE} [animation-delay:140ms]`}>
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
      ))}
    </div>
  );
}

/** Wide card with a chart: header, a fortnight of paired bars, legend, footnote. */
function ChartCardSkeleton() {
  const bars = [42, 68, 51, 84, 60, 37, 74, 92, 55, 63, 29, 78, 47, 88];
  return (
    <section aria-hidden className={`${CARD} lg:col-span-3`}>
      <div className={`flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pb-3 pt-4 ${PULSE} [animation-delay:180ms]`}>
        <div className="space-y-1.5">
          <Bone className="h-5 w-36 rounded" />
          <Bone className="h-2.5 w-44 rounded sm:w-64" />
        </div>
        <Bone className="hidden h-6 w-24 rounded-full sm:block" />
      </div>

      <div className="border-t border-steel-100 px-4 py-4">
        <div className={`flex h-40 items-end gap-[3px] lg:h-44 ${PULSE} [animation-delay:200ms]`}>
          {bars.map((h, i) => (
            <div key={i} className="flex h-full min-w-0 flex-1 items-end justify-center gap-[3px]">
              <Bone className="w-full max-w-[10px] rounded-sm lg:max-w-[16px]" style={{ height: `${h}%` }} />
              <Bone className="w-full max-w-[10px] rounded-sm lg:max-w-[16px]" style={{ height: `${Math.round(h * 0.55)}%` }} />
            </div>
          ))}
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

/** Narrow card with a work queue: icon tile, two lines, and the count on the right. */
function ListCardSkeleton() {
  const rows = ["w-3/5", "w-2/3", "w-1/2", "w-3/5"];
  return (
    <section aria-hidden className={`${CARD} lg:col-span-2`}>
      <div className={`flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pb-3 pt-4 ${PULSE} [animation-delay:220ms]`}>
        <div className="space-y-1.5">
          <Bone className="h-5 w-32 rounded" />
          <Bone className="h-2.5 w-44 rounded" />
        </div>
        <Bone className="h-5 w-20 rounded-full" />
      </div>

      <div className={`border-t border-steel-100 p-2 ${PULSE} [animation-delay:240ms]`}>
        {rows.map((width, i) => (
          <div key={i} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-2.5 py-2.5">
            <Bone className="h-9 w-9 rounded-lg" />
            <div className="min-w-0">
              <Bone className={`h-2.5 ${width} rounded`} />
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

/** Full-width list: a real table on a desktop, the same rows as cards on a phone. */
function TableCardSkeleton() {
  const rows = ["w-2/3", "w-1/2", "w-3/4", "w-3/5", "w-2/3", "w-1/2"];
  return (
    <section aria-hidden className={CARD}>
      <div className={`flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pb-3 pt-4 ${PULSE} [animation-delay:280ms]`}>
        <div className="space-y-1.5">
          <Bone className="h-5 w-40 rounded" />
          <Bone className="h-2.5 w-56 rounded" />
        </div>
        <Bone className="hidden h-6 w-28 rounded-md sm:block" />
      </div>

      <div className="hidden border-t border-steel-100 md:block">
        <div className="grid grid-cols-[1.2fr_2fr_1fr_1fr] gap-4 border-b border-steel-100 px-4 py-2">
          {[0, 1, 2, 3].map((i) => <Bone key={i} className="h-2 w-14 rounded" />)}
        </div>
        <div className={`${PULSE} [animation-delay:300ms]`}>
          {rows.map((width, i) => (
            <div key={i} className="grid grid-cols-[1.2fr_2fr_1fr_1fr] items-center gap-4 border-b border-steel-100/70 px-4 py-3 last:border-b-0">
              <Bone className="h-4 w-16 rounded" />
              <div>
                <Bone className={`h-2.5 ${width} rounded`} />
                <Bone className="mt-1.5 h-2 w-1/3 rounded" />
              </div>
              <Bone className="h-2.5 w-12 rounded" />
              <Bone className="ml-auto h-2.5 w-10 rounded" />
            </div>
          ))}
        </div>
      </div>

      <div className={`space-y-2 border-t border-steel-100 p-2 md:hidden ${PULSE} [animation-delay:300ms]`}>
        {rows.slice(0, 3).map((width, i) => (
          <div key={i} className="rounded-lg bg-paper px-3 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <Bone className="h-3 w-16 rounded" />
              <Bone className="h-2.5 w-12 rounded" />
            </div>
            <Bone className={`mt-2 h-2.5 ${width} rounded`} />
            <Bone className="mt-1.5 h-2 w-1/2 rounded" />
          </div>
        ))}
      </div>
    </section>
  );
}

/** Two half-width cards under it all, so a desktop scroll never reaches the footer early. */
function PairSkeleton() {
  return (
    <div aria-hidden className="grid gap-5 lg:grid-cols-2">
      {[0, 1].map((i) => (
        <section key={i} className={CARD}>
          <div className={`space-y-1.5 px-4 pb-3 pt-4 ${PULSE} [animation-delay:360ms]`}>
            <Bone className="h-5 w-32 rounded" />
            <Bone className="h-2.5 w-48 rounded" />
          </div>
          <div className={`space-y-2 border-t border-steel-100 px-4 py-4 ${PULSE} [animation-delay:380ms]`}>
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

export default function Loading() {
  return (
    <main aria-busy="true">
      <div role="status">
        {/* The only words on the screen, for screen readers: the blocks themselves say nothing. */}
        <span className="sr-only">Memuat halaman</span>

        <HeaderSkeleton />
        {/* flex + gap, not space-y: the navy band is display:none on a phone, and space-y would
            still reserve its 20px slot, leaving a hole under the header. */}
        <div className="flex flex-col gap-5 p-4 lg:p-8">
          <BandSkeleton />
          <TilesSkeleton />
          <div className="grid gap-5 lg:grid-cols-5">
            <ChartCardSkeleton />
            <ListCardSkeleton />
          </div>
          <TableCardSkeleton />
          <PairSkeleton />
        </div>
      </div>
    </main>
  );
}
