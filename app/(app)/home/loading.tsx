import { Bone, PULSE, PageSkeleton } from "@/components/loading/skeleton";
import { cn } from "@/lib/utils";

/**
 * Beranda: the lobby (date and clock, the greeting, the floor line ending at one button), today's board
 * of four counts, then the module directory and the builders' band. Which modules there are is the page
 * table's business (`sectionsFor(job)`), so the skeleton shows two aisle signs with rows, not a claim
 * about what this account may open. The floor line is NOT drawn here: it comes in from the left once,
 * when the page lands (right after signing in, as the login line's continuation), never twice.
 */
export default function Loading() {
  return (
    <PageSkeleton label="Memuat beranda" header={false} className="flex flex-col">
      <section aria-hidden className="bg-jeir-navy px-4 pb-10 pt-8 sm:px-8 lg:px-12 lg:pb-14 lg:pt-12">
        <div className={cn("flex justify-between", PULSE)}>
          <Bone onNavy className="h-3.5 w-48 rounded" />
          <Bone onNavy className="h-3.5 w-20 rounded" />
        </div>
        <div className={cn("mt-8 space-y-3 lg:mt-14", PULSE)} style={{ animationDelay: "60ms" }}>
          <Bone onNavy className="h-10 w-full max-w-2xl rounded lg:h-14" />
          <Bone onNavy className="h-10 w-2/3 max-w-xl rounded lg:h-14" />
          <Bone onNavy className="mt-4 h-4 w-72 max-w-full rounded" />
        </div>
        <div className="mt-10 flex items-center gap-1 lg:mt-14">
          <span className="flex-1" />
          <Bone onNavy className="h-14 w-44 shrink-0 rounded-md" />
        </div>
      </section>

      <div aria-hidden className="grid grid-cols-2 gap-px border-t border-white/10 bg-white/10 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={cn("space-y-2 bg-jeir-navy px-4 py-5 sm:px-8 lg:px-12", PULSE)} style={{ animationDelay: `${160 + i * 20}ms` }}>
            <Bone onNavy className="h-9 w-20 rounded" />
            <Bone onNavy className="h-3 w-28 rounded" />
          </div>
        ))}
      </div>

      <section aria-hidden className="bg-paper px-4 py-12 sm:px-8 lg:px-12 lg:py-16">
        <Bone className={cn("h-8 w-48 rounded", PULSE)} />
        <div className="mt-8 grid gap-10 xl:grid-cols-2">
          {[0, 1].map((g) => (
            <div key={g} className={PULSE} style={{ animationDelay: `${240 + g * 40}ms` }}>
              <Bone className="h-8 w-36 rounded-plate" />
              <div className="mt-3 divide-y divide-steel-100 rounded-lg bg-white ring-1 ring-steel-100">
                {[0, 1, 2, 3].map((r) => (
                  <div key={r} className="flex items-center gap-4 px-4 py-3.5">
                    <Bone className="h-5 w-5 rounded" />
                    <div className="flex-1 space-y-1.5"><Bone className="h-3.5 w-32 rounded" /><Bone className="h-3 w-56 max-w-full rounded" /></div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </PageSkeleton>
  );
}
