import { Bone, CardHeadSkeleton, PULSE, PageSkeleton, SKELETON_CARD, StatBandSkeleton, ChartCardSkeleton, ListCardSkeleton, TableCardSkeleton } from "@/components/loading/skeleton";
import { cn } from "@/lib/utils";

/**
 * Dashboard gudang: the navy "hari ini" band, the flow chart, the queue that needs a hand, then the
 * four stock-health panels and two long tables underneath. The blocks sit where the real ones land —
 * band, chart card, a full-width list, a 3/2 grid, another 3/2 grid, a 10-row table and the expiry
 * table — so the swap-in does not move the page.
 *
 * The occupancy grid and the shelf-life bars are drawn here rather than in the kit: they are the
 * dashboard's own panels, not a shape another page has.
 */
export default function Loading() {
  return (
    <PageSkeleton label="Memuat dashboard">
      <StatBandSkeleton gauges={2} stats={4} todayPanel />

      {/* Arus barang: the day's figure, the legend, the fortnight of paired bars, the note. */}
      <ChartCardSkeleton lead className="lg:col-span-5" delayMs={140} />

      {/* Butuh perhatian sekarang: a queue, two across on anything wider than a phone. */}
      <ListCardSkeleton rows={4} columns={2} className="" delayMs={200} />

      <div className="grid gap-5 lg:grid-cols-5">
        <OccupancyCard />
        <ShelfLifeCard />
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <QualityCard />
        <AbcCard />
      </div>

      <TableCardSkeleton columns={5} rows={10} delayMs={400} />
      <TableCardSkeleton columns={8} rows={5} delayMs={440} />
    </PageSkeleton>
  );
}

/** Okupansi rak: aisle against level, the percentage cells, then the four-bin total and the rule. */
function OccupancyCard() {
  return (
    <section aria-hidden className={cn(SKELETON_CARD, "lg:col-span-3")}>
      <CardHeadSkeleton className="px-4 pb-2 pt-4" titleClass="h-5 w-32" subClass="h-2.5 w-40" right="h-5 w-24" delayMs={260} />

      {/* Five aisle rows plus the total row: the same 7 columns the real grid draws. */}
      <div className={cn("space-y-1 px-3 pt-1 sm:px-4", PULSE)} style={{ animationDelay: "280ms" }}>
        <div className="grid grid-cols-[2rem_repeat(5,1fr)_2.5rem] gap-1">
          <Bone className="h-2 w-6 rounded" />
          {[0, 1, 2, 3, 4].map((i) => <Bone key={i} className="mx-auto h-2 w-8 rounded" />)}
          <Bone className="mx-auto h-2 w-6 rounded" />
        </div>
        {[0, 1, 2, 3, 4].map((r) => (
          <div key={r} className="grid grid-cols-[2rem_repeat(5,1fr)_2.5rem] gap-1">
            <Bone className="h-6 w-7 rounded" />
            {[0, 1, 2, 3, 4].map((c) => <Bone key={c} className="h-6 rounded" />)}
            <Bone className="h-6 rounded bg-steel-300/40" />
          </div>
        ))}
        <div className="grid grid-cols-[2rem_repeat(5,1fr)_2.5rem] gap-1 border-t border-steel-100 pt-1">
          <Bone className="h-4 w-7 rounded" />
          {[0, 1, 2, 3, 4].map((c) => <Bone key={c} className="h-4 rounded" />)}
          <Bone className="h-4 rounded bg-steel-300/40" />
        </div>
      </div>

      <div className="mt-auto space-y-2.5 px-4 pb-4 pt-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Bone className="h-2 w-20 rounded" />
          {[0, 1, 2, 3].map((i) => <Bone key={i} className="h-3 w-5 rounded-sm bg-steel-300/50" />)}
        </div>
        <div className="grid grid-cols-4 gap-px overflow-hidden rounded-lg bg-steel-100 text-center">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="bg-white px-1 py-2">
              <Bone className="mx-auto h-2 w-10 rounded" />
              <Bone className="mx-auto mt-1 h-4 w-8 rounded" />
            </div>
          ))}
        </div>
        <Bone className="h-2 w-full max-w-[320px] rounded" />
      </div>
    </section>
  );
}

/** Umur simpan stok: the whole-shelf bar, its legend, the expiry calendar, the three way split. */
function ShelfLifeCard() {
  return (
    <section aria-hidden className={cn(SKELETON_CARD, "lg:col-span-2")}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-4 pb-3 pt-4">
        <div className={cn("min-w-0 space-y-1.5", PULSE)} style={{ animationDelay: "300ms" }}>
          <Bone className="h-5 w-36 rounded" />
          <Bone className="h-2.5 w-40 rounded" />
        </div>
        {/* The range switch: three years, one of them active. */}
        <div className={cn("flex rounded-md bg-paper p-0.5 ring-1 ring-inset ring-steel-100", PULSE)} style={{ animationDelay: "300ms" }}>
          {[0, 1, 2].map((i) => <Bone key={i} className={cn("mx-0.5 my-0.5 h-4 w-8 rounded", i === 0 && "bg-steel-300/60")} />)}
        </div>
      </div>

      <div className={cn("flex-1 space-y-3 px-4 pb-4", PULSE)} style={{ animationDelay: "320ms" }}>
        {/* The whole shelf in one bar. */}
        <div>
          <div className="flex h-3 overflow-hidden rounded-full bg-steel-100">
            <div className="h-full w-2/5 bg-steel-300/60" />
            <div className="h-full w-1/4 bg-steel-300/40" />
            <div className="h-full w-1/5 bg-steel-300/25" />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center gap-1.5">
                <Bone className="h-2 w-2 shrink-0 rounded-sm bg-steel-300/60" />
                <Bone className="h-2 w-16 rounded" />
                <Bone className="ml-auto h-2 w-6 rounded" />
              </div>
            ))}
          </div>
        </div>

        {/* Cartons expiring per month. */}
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <Bone className="h-2.5 w-32 rounded" />
            <Bone className="h-2 w-16 rounded" />
          </div>
          <div className="mt-1.5 flex h-20 items-end gap-[3px] border-b border-steel-300">
            {[38, 54, 30, 62, 45, 70, 34, 58, 26, 48, 66, 40].map((h, i) => (
              <div key={i} className="flex h-full flex-1 items-end justify-center">
                <Bone className="w-full max-w-5 rounded-t" style={{ height: `${h}%` }} />
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-[3px]">
            {[0, 1, 2, 3, 4, 5].map((i) => <Bone key={i} className="h-2 w-4 rounded-sm" />)}
          </div>
        </div>

        {/* Expired / near / still good. */}
        <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-lg bg-steel-100 text-center">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-white px-1 py-2">
              <Bone className="mx-auto h-2 w-10 rounded" />
              <Bone className="mx-auto mt-1 h-4 w-8 rounded" />
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/** Mutu & kendali: six metrics, each a label, a number, a trend and a bar against its target. */
function QualityCard() {
  return (
    <section aria-hidden className={cn(SKELETON_CARD, "lg:col-span-3")}>
      <CardHeadSkeleton className="px-4 pb-1 pt-4" titleClass="h-5 w-32" subClass="h-2.5 w-44" right={null} delayMs={340} />

      <div className={cn("grid gap-x-2 p-2 sm:grid-cols-2", PULSE)} style={{ animationDelay: "360ms" }}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="rounded-lg px-2.5 py-2">
            <div className="flex items-baseline justify-between gap-2">
              <Bone className="h-2.5 w-28 rounded" />
              <Bone className="h-5 w-12 rounded" />
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              <Bone className="h-6 w-20 rounded-sm" />
              <Bone className="h-2 w-8 rounded" />
            </div>
            <div className="relative mt-1.5 h-1.5 rounded-full bg-steel-100">
              <div className="h-full w-3/4 rounded-full bg-steel-300/60" />
              <span className="absolute -top-[2px] h-[10px] w-[2px] rounded-full bg-steel-300" style={{ left: "calc(75% - 1px)" }} />
            </div>
            <Bone className="mt-1 h-2 w-full max-w-[180px] rounded" />
          </div>
        ))}
      </div>

      {/* A div, not a p: the placeholder inside is a div, and a div inside a p is invalid HTML. */}
      <div className="mt-auto border-t border-steel-100 px-4 py-2.5">
        <Bone className="h-2 w-full max-w-[420px] rounded" />
      </div>
    </section>
  );
}

/** Kelas ABC stok: the split bar, the four class tiles, the note. */
function AbcCard() {
  return (
    <section aria-hidden className={cn(SKELETON_CARD, "lg:col-span-2")}>
      <CardHeadSkeleton className="px-4 pb-3 pt-4" titleClass="h-5 w-32" subClass="h-2.5 w-44" right="h-2 w-16" delayMs={380} />

      <div className={cn("flex-1 space-y-3 px-4 pb-4", PULSE)} style={{ animationDelay: "400ms" }}>
        <div className="flex h-3 overflow-hidden rounded-full bg-steel-100">
          <div className="h-full w-1/2 bg-steel-300/60" />
          <div className="h-full w-1/3 bg-steel-300/40" />
          <div className="h-full w-1/6 bg-steel-300/25" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-lg bg-paper px-2.5 py-2">
              <div className="flex items-center gap-1.5">
                <Bone className="h-2 w-2 rounded-sm bg-steel-300/60" />
                <Bone className="h-2 w-14 rounded" />
              </div>
              <Bone className="mt-1 h-5 w-12 rounded" />
              <Bone className="mt-1 h-2 w-20 rounded" />
            </div>
          ))}
        </div>
        <Bone className="h-2 w-full max-w-[280px] rounded" />
      </div>
    </section>
  );
}
