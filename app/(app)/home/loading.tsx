import { Bone, PULSE, PageSkeleton } from "@/components/loading/skeleton";
import { cn } from "@/lib/utils";

/**
 * Beranda, opened from the logo: no page header — the banner is the heading. The photo runs edge to
 * edge, its navy strip carries the greeting, today's date, the clock, the two buttons and the four
 * counters, and under it every module the job can open, then who built the system.
 *
 * Which modules those are is the page table's business (`sectionsFor(job)`), so the skeleton shows
 * one group of eight tiles — the shape of a section, not a claim about what this account may open —
 * and one credits band.
 */
export default function Loading() {
  return (
    <PageSkeleton label="Memuat beranda" header={false} className="flex flex-col">
      {/* The banner and the navy strip that continues it. */}
      <section aria-hidden className="relative overflow-hidden bg-jeir-navy text-white">
        <div className="relative">
          <div className="aspect-video w-full bg-jeir-side" />
          {/* The image's own bottom eases into the strip below it. */}
          <div className="absolute inset-x-0 bottom-0 h-[22%] bg-gradient-to-t from-jeir-navy via-jeir-navy/30 to-transparent" />
        </div>

        <div className="home-strip relative">
          <div className={cn("flex flex-col gap-5 px-4 pb-4 pt-5 lg:flex-row lg:items-center lg:justify-between lg:gap-8 lg:px-10", PULSE)}>
            <div className="min-w-0 space-y-2">
              <Bone onNavy className="h-8 w-72 max-w-full rounded" />
              <Bone onNavy className="h-3 w-56 max-w-full rounded" />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Bone onNavy className="h-2.5 w-12 rounded" />
              <Bone onNavy className="h-12 w-44 rounded-md" />
              <Bone onNavy className="h-12 w-40 rounded-md" />
            </div>
          </div>

          {/* Karton masuk · karton keluar · wave selesai · tugas pick selesai. */}
          <div className="border-t border-white/10">
            <div className={cn("grid grid-cols-2 gap-x-6 gap-y-2 px-4 py-4 sm:grid-cols-4 lg:px-10", PULSE)}
              style={{ animationDelay: "70ms" }}>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="px-2 py-1.5">
                  <Bone onNavy className="h-7 w-16 rounded" />
                  <Bone onNavy className="mt-1 h-2.5 w-28 max-w-full rounded" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="px-4 pb-10 lg:px-10">
        {/* Modul: one group of tiles, four across on a wide screen. */}
        <div className="space-y-2 pt-10">
          <div aria-hidden className={cn(PULSE)} style={{ animationDelay: "120ms" }}>
            <Bone className="h-7 w-56 rounded" />
          </div>
          <ul className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <li key={i} aria-hidden className={cn("flex min-h-20 items-center gap-3.5 rounded-xl bg-white p-4 ring-1 ring-steel-100", PULSE)}
                style={{ animationDelay: `${140 + i * 20}ms` }}>
                <Bone className="h-10 w-10 shrink-0 rounded-lg" />
                <Bone className="h-3.5 flex-1 rounded" />
                <Bone className="h-4 w-4 shrink-0 rounded" />
              </li>
            ))}
          </ul>
        </div>

        {/* Credits: who built it, in the same navy as the strip. */}
        <section aria-hidden className={cn(
          "mt-8 flex flex-col gap-4 rounded-2xl bg-jeir-navy bg-jeir-bar px-6 py-5 text-white sm:flex-row sm:items-center sm:justify-between",
          PULSE)} style={{ animationDelay: "320ms" }}>
          <div className="space-y-2">
            <Bone onNavy className="h-5 w-40 rounded" />
            <Bone onNavy className="h-2.5 w-72 max-w-full rounded" />
          </div>
          <div className="flex flex-wrap gap-5">
            {[0, 1].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Bone onNavy className="h-11 w-11 rounded-full" />
                <Bone onNavy className="h-4 w-28 rounded" />
              </div>
            ))}
          </div>
        </section>
      </div>
    </PageSkeleton>
  );
}
