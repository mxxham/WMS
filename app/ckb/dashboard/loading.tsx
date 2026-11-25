import { Bone, PULSE } from "@/components/loading/skeleton";
import { CkbPageSkeleton, CkbFilterSkeleton, CkbStatTilesSkeleton, pulseDelay } from "@/components/loading/ckb";
import { cn } from "@/lib/utils";

/**
 * Dashboard CKB. The page opens with the customer filter, then two bands of six `StatTile` boxes —
 * "Stock take" and "Rebagging dan inspeksi" — the row of doors into a new session / inspection /
 * rebagging job / import, the two open-record queues side by side, and (for a lead) the tail of the
 * activity log. Every figure is a live count, so no block here carries one.
 *
 * The two queues are the same shape on both breakpoints: a titled card holding short rows of
 * reference · customer · status pill.
 */
export default function Loading() {
  return (
    <CkbPageSkeleton label="Memuat dashboard" live pills={0}>
      <CkbFilterSkeleton fields={1} delayMs={60} />

      <section aria-hidden className="space-y-3">
        <Bone className={cn("h-5 w-32 rounded", PULSE)} style={pulseDelay(100)} />
        <CkbStatTilesSkeleton count={6} columns="grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" delayMs={120} />
      </section>

      <section aria-hidden className="space-y-3">
        <Bone className={cn("h-5 w-52 rounded", PULSE)} style={pulseDelay(160)} />
        <CkbStatTilesSkeleton count={6} columns="grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" delayMs={180} />
      </section>

      {/* Sesi stock take baru · Inspeksi baru · Rebagging baru · Import SAP. */}
      <div aria-hidden className={cn("flex flex-wrap gap-2", PULSE)} style={pulseDelay(220)}>
        <Bone className="h-10 w-44 rounded-md" />
        <Bone className="h-10 w-36 rounded-md" />
        <Bone className="h-10 w-40 rounded-md" />
        <Bone className="h-10 w-32 rounded-md" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <QueueCard titleWidth="w-48" delayMs={260} />
        <QueueCard titleWidth="w-36" delayMs={300} />
      </div>

      <LogCard delayMs={340} />
    </CkbPageSkeleton>
  );
}

/** "Sesi stock take terbuka" / "Inspeksi terbuka": a title, then reference · customer · pill rows. */
function QueueCard({ titleWidth, delayMs }: { titleWidth: string; delayMs: number }) {
  return (
    <section aria-hidden className="rounded-lg border border-steel-100 bg-white">
      <div className="border-b border-steel-100 px-4 py-3">
        <Bone className={cn("h-5 rounded", PULSE, titleWidth)} style={pulseDelay(delayMs)} />
      </div>
      <ul className={cn("divide-y divide-steel-100 px-4", PULSE)} style={pulseDelay(delayMs + 20)}>
        {[0, 1, 2].map((i) => (
          <li key={i} className="flex items-center justify-between gap-2 py-2.5">
            <Bone className="h-3 w-24 rounded" />
            <Bone className="h-3 w-28 rounded" />
            <Bone className="h-5 w-16 rounded" />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "Aktivitas terakhir": who did what, and when — a row per event, with "Semua" at the right. */
function LogCard({ delayMs }: { delayMs: number }) {
  return (
    <section aria-hidden className="rounded-lg border border-steel-100 bg-white">
      <div className="flex items-center justify-between border-b border-steel-100 px-4 py-3">
        <Bone className={cn("h-5 w-40 rounded", PULSE)} style={pulseDelay(delayMs)} />
        <Bone className={cn("h-3 w-14 rounded", PULSE)} style={pulseDelay(delayMs)} />
      </div>
      <ul className={cn("divide-y divide-steel-100 px-4", PULSE)} style={pulseDelay(delayMs + 20)}>
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
            <Bone className={cn("h-3 rounded", i % 2 ? "w-64" : "w-72")} />
            <Bone className="h-2.5 w-24 rounded" />
          </li>
        ))}
      </ul>
    </section>
  );
}
