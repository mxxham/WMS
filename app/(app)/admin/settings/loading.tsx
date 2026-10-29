import { Bone, CardHeadSkeleton, PULSE, PageSkeleton, SKELETON_CARD } from "@/components/loading/skeleton";
import { cn } from "@/lib/utils";

/**
 * Pengaturan: "Aturan inventory" first — the seven numbers every control reads, in a two/three
 * column grid, with the A/B/C tolerance row and the flag beside them — then the three cards under
 * it: layout gudang (the tall one, spanning two rows), status & kelas bin, and hitung ulang ABC.
 *
 * The rules card sits in its own padded block, the three below share a two-column grid, and each
 * card ends in the button the real form has.
 */
export default function Loading() {
  return (
    <PageSkeleton label="Memuat pengaturan" header mainClassName="flex flex-col">
      <div className="p-4 pb-0 lg:p-8 lg:pb-0">
        <section aria-hidden className={SKELETON_CARD}>
          <CardHeadSkeleton titleClass="h-5 w-40" subClass={null} right={null} />
          <div className={cn("space-y-4 border-t border-steel-100 p-4", PULSE)} style={{ animationDelay: "80ms" }}>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2, 3, 4, 5, 6].map((f) => (
                <div key={f}>
                  <Bone className="mb-1 h-2.5 w-28 rounded" />
                  <Bone className="h-10 w-full rounded-md" />
                  <Bone className="mt-1 h-2 w-4/5 rounded" />
                </div>
              ))}
              {/* Kelas A / B / C tolerance: three small fields in one cell. */}
              <div>
                <Bone className="mb-1 h-2.5 w-24 rounded" />
                <div className="grid grid-cols-3 gap-2">
                  {[0, 1, 2].map((c) => <Bone key={c} className="h-10 rounded-md" />)}
                </div>
                <Bone className="mt-1 h-2 w-4/5 rounded" />
              </div>
            </div>
            <Bone className="h-10 w-32 rounded-md" />
          </div>
        </section>
      </div>

      <div className="grid gap-6 p-4 lg:grid-cols-2 lg:p-8">
        {/* Layout gudang (tampilan 3D): the tall card, six measurements plus the aisle order. */}
        <section aria-hidden className={cn(SKELETON_CARD, "lg:row-span-2")}>
          <CardHeadSkeleton titleClass="h-5 w-56" subClass={null} right={null} delayMs={120} />
          <div className={cn("space-y-3 border-t border-steel-100 p-4", PULSE)} style={{ animationDelay: "140ms" }}>
            <div>
              <Bone className="mb-1 h-2.5 w-40 rounded" />
              <Bone className="h-10 w-full rounded-md" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[0, 1, 2, 3, 4, 5].map((f) => (
                <div key={f}>
                  <Bone className="mb-1 h-2.5 w-24 rounded" />
                  <Bone className="h-10 w-full rounded-md" />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[0, 1].map((f) => <Bone key={f} className="h-10 rounded-md" />)}
            </div>
            <div className="flex justify-end">
              <Bone className="h-10 w-56 rounded-md" />
            </div>
          </div>
        </section>

        {[2, 3].map((i) => (
          <section key={i} aria-hidden className={SKELETON_CARD}>
            <CardHeadSkeleton titleClass="h-5 w-44" subClass={null} right={null} delayMs={180 + i * 20} />
            <div className={cn("space-y-3 border-t border-steel-100 p-4", PULSE)} style={{ animationDelay: `${200 + i * 20}ms` }}>
              <div>
                <Bone className="mb-1 h-2.5 w-20 rounded" />
                <Bone className="h-20 w-full rounded-md" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[0, 1].map((f) => <Bone key={f} className="h-10 rounded-md" />)}
              </div>
              <div className="flex justify-end">
                <Bone className="h-10 w-32 rounded-md" />
              </div>
            </div>
          </section>
        ))}
      </div>
    </PageSkeleton>
  );
}
