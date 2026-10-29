import { Bone, PULSE, PageSkeleton } from "@/components/loading/skeleton";
import { cn } from "@/lib/utils";

/**
 * Gudang 3D. The page has no header: the canvas takes the whole viewport and the controls float on
 * top of it, so the skeleton is a floor plate seen from above rather than a table. The rack blocks
 * sit where the 3D racks land, and the control column is in the same top-left corner, same width,
 * so the search box the eye is heading for does not move when the real scene arrives.
 *
 * Height matches WarehouseClient: `100dvh` minus the 4.5rem phone bottom bar, the full screen on a
 * desktop where the bar is gone.
 */
export default function Loading() {
  return (
    <PageSkeleton
      label="Memuat tampilan 3D gudang"
      header={false}
      mainClassName="relative h-[calc(100dvh-4.5rem)] overflow-hidden lg:h-screen"
      className="h-full">
      <FloorPlate />

      {/* Controls overlay, exactly where WarehouseClient puts it. */}
      <div aria-hidden className="absolute left-3 right-3 top-3 flex flex-col gap-2 sm:right-auto sm:w-96">
        <div className={cn("flex gap-2", PULSE)} style={{ animationDelay: "60ms" }}>
          <Bone className="h-10 flex-1 rounded-md bg-white/95" />
          <Bone className="h-10 w-10 shrink-0 rounded-md" />
        </div>
        <div className={cn("flex rounded-md bg-white/95 p-1", PULSE)} style={{ animationDelay: "100ms" }}>
          {[0, 1, 2].map((i) => <Bone key={i} className={cn("mx-0.5 h-8 flex-1 rounded", i === 2 && "bg-steel-300/50")} />)}
        </div>
        <Bone className={cn("h-6 w-24 self-start rounded-md bg-white/95", PULSE)} style={{ animationDelay: "140ms" }} />
        <div className={cn("space-y-1.5 rounded-md bg-white/95 p-2", PULSE)} style={{ animationDelay: "180ms" }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-2">
              <Bone className="h-3 w-3 shrink-0 rounded-sm" />
              <Bone className="h-2 w-20 rounded" />
            </div>
          ))}
        </div>
      </div>
    </PageSkeleton>
  );
}

/**
 * The floor: a pale wash, the dotted texture the Home banner and the dashboard band already use, and
 * the rack rows underneath. One pulse for the whole plate — the racks are one object, not forty.
 */
function FloorPlate() {
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden bg-paper">
      <span className="home-dots pointer-events-none absolute -right-16 -top-16 h-72 w-96 opacity-60" />
      <span className="home-dots pointer-events-none absolute -bottom-24 -left-10 h-64 w-80 rotate-180 opacity-40" />

      <div className={cn("absolute inset-0 flex items-center justify-center px-4 py-6", PULSE)}>
        <div className="w-full max-w-3xl space-y-2 opacity-90">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className={cn("flex gap-2", row % 2 === 1 && "px-4")}>
              {[0, 1, 2, 3, 4, 5, 6].map((cell) => (
                <Bone key={cell} className={cn("h-14 flex-1 rounded-md lg:h-16", cell % 3 === 0 ? "bg-steel-300/40" : "bg-steel-100")} />
              ))}
            </div>
          ))}
          {/* The staging lane at the front of the floor. */}
          <div className="pt-2">
            <Bone className="h-10 w-full rounded-md bg-white ring-1 ring-steel-100" />
          </div>
        </div>
      </div>
    </div>
  );
}
