import { Bone, PULSE, PageSkeleton, SKELETON_CARD } from "@/components/loading/skeleton";
import { cn } from "@/lib/utils";

/**
 * Wave & tugas pick. The page is one day: where you are in it, what still needs a hand, and every
 * wave of the day as a collapsed block that opens into its lines. On a phone the same day is a
 * different screen (a date strip and one tappable tile per wave), so the skeleton carries both
 * arrangements under the same breakpoint the real page switches at.
 *
 * Nothing here names a wave, a slot or a count. Picklists are reprinted from this screen, and a
 * placeholder that printed "NO 12" would be a small lie about the day.
 */
export default function Loading() {
  return (
    <PageSkeleton label="Memuat wave" className="flex flex-col gap-4 p-4 lg:p-8">
      {/* Desktop: the day bar, Perlu ditangani, the search row, then the wave blocks. */}
      <div className="hidden flex-col gap-4 md:flex">
        <DayBarSkeleton />
        <ProblemsBarSkeleton />
        <div className={cn("flex flex-wrap items-center gap-2", PULSE)} style={{ animationDelay: "200ms" }}>
          <Bone className="h-10 w-80 max-w-full rounded-md" />
          <Bone className="h-10 w-24 rounded-md" />
        </div>
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => <WaveBlockSkeleton key={i} delayMs={240 + i * 20} />)}
        </div>
      </div>

      {/* Phones: the day screen — date strip, progress, next step, then one tile per wave. */}
      <div className="flex flex-col gap-3 md:hidden">
        <div className={cn("-mx-4 -mt-4 flex items-center justify-between border-b border-steel-100 bg-white px-1", PULSE)}>
          <div className="flex items-center gap-1">
            <Bone className="h-11 w-9 rounded-md" />
            <Bone className="h-6 w-32 rounded" />
            <Bone className="h-11 w-9 rounded-md" />
            <Bone className="h-11 w-11 rounded-md" />
          </div>
          <div className="flex items-center gap-1">
            <Bone className="h-11 w-11 rounded-md" />
            <Bone className="h-11 w-11 rounded-md" />
          </div>
        </div>
        <Bone className="h-2.5 w-64 rounded" />
        <Bone className="h-10 w-full rounded-md bg-ckb-tint/40" />
        <div className={cn("flex min-h-12 items-center gap-3 rounded-lg bg-white px-4 py-3", PULSE)} style={{ animationDelay: "120ms" }}>
          <Bone className="h-5 w-5 shrink-0 rounded" />
          <div className="flex-1 space-y-1.5">
            <Bone className="h-3.5 w-32 rounded" />
            <Bone className="h-2.5 w-48 rounded" />
          </div>
          <Bone className="h-2.5 w-10 rounded" />
        </div>
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <WaveTileSkeleton key={i} delayMs={160 + i * 20} />)}
        </div>
      </div>
    </PageSkeleton>
  );
}

/** "Jumat 20 Nov", the two day arrows, the calendar, the day menu; then progress and the next step. */
function DayBarSkeleton() {
  return (
    <div aria-hidden className="space-y-2 rounded-lg bg-white p-4">
      <div className={cn("flex flex-wrap items-center justify-between gap-2", PULSE)}>
        <div className="flex items-center gap-1">
          <Bone className="h-11 w-11 rounded-md" />
          <Bone className="h-8 w-48 rounded" />
          <Bone className="h-11 w-11 rounded-md" />
          <Bone className="ml-1 h-11 w-11 rounded-md" />
        </div>
        <div className="flex items-center gap-1">
          <Bone className="h-8 w-16 rounded-md" />
          <Bone className="h-11 w-11 rounded-md" />
        </div>
      </div>
      <Bone className={cn("h-3 w-64 rounded", PULSE)} />
      {/* Langkah berikutnya: the one most urgent thing, on its pale tint. */}
      <Bone className={cn("h-10 w-full rounded-md bg-ckb-tint/40", PULSE)} style={{ animationDelay: "40ms" }} />
    </div>
  );
}

/** Perlu ditangani, collapsed to one line: the triangle, the two lines, the Lihat. */
function ProblemsBarSkeleton() {
  return (
    <div aria-hidden className={cn("flex min-h-12 items-center gap-3 rounded-lg bg-white px-4 py-3", PULSE)} style={{ animationDelay: "160ms" }}>
      <Bone className="h-5 w-5 shrink-0 rounded" />
      <div className="flex-1 space-y-1.5">
        <Bone className="h-3.5 w-36 rounded" />
        <Bone className="h-2.5 w-56 rounded" />
      </div>
      <Bone className="h-2.5 w-12 rounded" />
    </div>
  );
}

/** One wave, closed: its number and slot, the shipments, the next step, the progress and its one button. */
function WaveBlockSkeleton({ delayMs }: { delayMs: number }) {
  return (
    <section aria-hidden className={cn(SKELETON_CARD, "rounded-lg border border-steel-100")}>
      <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 p-4", PULSE)} style={{ animationDelay: `${delayMs}ms` }}>
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <div className="shrink-0 space-y-1.5">
            <Bone className="h-5 w-20 rounded" />
            <Bone className="h-2.5 w-10 rounded" />
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Bone className="h-3 w-24 rounded" />
              <Bone className="h-3 w-20 rounded" />
              <Bone className="h-3 w-32 rounded" />
            </div>
            <Bone className="h-3 w-56 max-w-full rounded" />
          </div>
          <div className="w-32 shrink-0 space-y-1.5">
            <Bone className="ml-auto h-3 w-16 rounded" />
            <Bone className="ml-auto h-2.5 w-20 rounded" />
            <div className="mt-1 h-1.5 overflow-hidden rounded bg-steel-100">
              <div className="h-full w-1/3 rounded bg-steel-300/60" />
            </div>
          </div>
          <Bone className="h-5 w-5 shrink-0 rounded" />
        </div>
        <div className="flex items-center gap-1">
          <Bone className="h-10 w-28 rounded-md" />
          <Bone className="h-10 w-10 rounded-md" />
          <Bone className="h-10 w-10 rounded-md" />
        </div>
      </div>
    </section>
  );
}

/** The phone's version of a wave: number, slot, shipments, progress and the next step in one card. */
function WaveTileSkeleton({ delayMs }: { delayMs: number }) {
  return (
    <div aria-hidden className={cn("min-h-16 rounded-lg bg-white p-3", PULSE)} style={{ animationDelay: `${delayMs}ms` }}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Bone className="h-5 w-20 rounded" />
        <Bone className="h-3 w-10 rounded" />
        <Bone className="ml-auto h-3 w-16 rounded" />
      </div>
      <Bone className="mt-1 h-3 w-32 rounded" />
      <div className="mt-2 h-1.5 overflow-hidden rounded bg-steel-100">
        <div className="h-full w-1/3 rounded bg-steel-300/60" />
      </div>
      <Bone className="mt-2 h-3 w-48 max-w-full rounded" />
    </div>
  );
}
