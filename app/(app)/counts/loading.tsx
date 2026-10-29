import { Bone, PULSE, PageSkeleton, SKELETON_CARD, TableSkeleton } from "@/components/loading/skeleton";
import { cn } from "@/lib/utils";

/**
 * Cycle count: the schedule card (six figures, the note that explains the cadence, the quota and
 * the button that makes today's tasks), then the counter's name, then the add-task bar, then one
 * card per open count — blind rounds, so the skeleton shows input rows and a submit button rather
 * than a reading table — and finally the last thirty closed counts.
 *
 * The cards are the same shape whatever is open; the skeleton draws two, the way the table
 * skeletons draw a handful of rows.
 */
export default function Loading() {
  return (
    <PageSkeleton label="Memuat cycle count" className="flex flex-col gap-6 p-4 lg:p-8">
      {/* Jadwal: six figures, the cadence, how many bins to plan today. */}
      <section aria-hidden className={SKELETON_CARD}>
        <div className={cn("px-4 pb-3 pt-4", PULSE)}>
          <Bone className="h-5 w-44 rounded" />
        </div>
        <div className={cn("space-y-4 border-t border-steel-100 px-4 py-4", PULSE)} style={{ animationDelay: "50ms" }}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="rounded-lg bg-paper p-3">
                <div className="flex items-start justify-between gap-2">
                  <Bone className="h-2.5 w-20 rounded" />
                  <Bone className="h-3.5 w-3.5 rounded" />
                </div>
                <Bone className="mt-2 h-8 w-16 rounded" />
                <Bone className="mt-1 h-2 w-full rounded" />
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            <Bone className="h-2.5 w-full max-w-4xl rounded" />
            <Bone className="h-2.5 w-full max-w-3xl rounded" />
          </div>

          {/* Jumlah bin hari ini + Buat tugas cycle count. */}
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Bone className="mb-1.5 h-2.5 w-32 rounded" />
              <Bone className="h-10 w-28 rounded-md" />
            </div>
            <Bone className="h-10 w-52 rounded-md" />
          </div>
        </div>
      </section>

      {/* Nama Anda (penghitung / penyetuju). */}
      <div aria-hidden className={cn("max-w-xs", PULSE)} style={{ animationDelay: "100ms" }}>
        <Bone className="mb-1.5 h-2.5 w-56 rounded" />
        <Bone className="h-10 w-full rounded-md" />
      </div>

      {/* Bin · Alasan · Tambah tugas hitung. */}
      <div aria-hidden className={cn("flex flex-wrap items-end gap-3 rounded-lg bg-white p-4", PULSE)} style={{ animationDelay: "120ms" }}>
        <div>
          <Bone className="mb-1.5 h-2.5 w-8 rounded" />
          <Bone className="h-10 w-36 rounded-md" />
        </div>
        <div className="min-w-60 flex-1">
          <Bone className="mb-1.5 h-2.5 w-16 rounded" />
          <Bone className="h-10 w-full rounded-md" />
        </div>
        <Bone className="h-10 w-48 rounded-md" />
      </div>

      {/* One card per open count: what it is, then the blind count form. */}
      {[0, 1].map((i) => (
        <section key={i} aria-hidden className={SKELETON_CARD}>
          <div className={cn("flex flex-wrap items-center justify-between gap-2 px-4 pb-3 pt-4", PULSE)}
            style={{ animationDelay: `${140 + i * 30}ms` }}>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Bone className="h-4 w-16 rounded" />
                <Bone className="h-5 w-24 rounded" />
              </div>
              <Bone className="h-2.5 w-72 max-w-full rounded" />
            </div>
            <Bone className="h-8 w-24 rounded-md" />
          </div>
          <div className={cn("space-y-2 border-t border-steel-100 px-4 py-4", PULSE)}
            style={{ animationDelay: `${160 + i * 30}ms` }}>
            <Bone className="h-2.5 w-full max-w-3xl rounded" />
            <div className="flex items-center gap-2">
              <Bone className="h-4 w-4 rounded-sm" />
              <Bone className="h-2.5 w-24 rounded" />
            </div>
            {[0, 1].map((r) => (
              <div key={r} className="grid grid-cols-2 gap-2 rounded-md bg-paper p-2 sm:grid-cols-[1.3fr_1fr_10rem_7rem_2.5rem]">
                <Bone className="h-10 rounded-md bg-white" />
                <Bone className="h-10 rounded-md bg-white" />
                <Bone className="h-10 rounded-md bg-white" />
                <Bone className="h-10 rounded-md bg-white" />
                <Bone className="hidden h-10 w-10 rounded-md bg-white sm:block" />
              </div>
            ))}
            <div className="flex flex-wrap gap-2 pt-1">
              <Bone className="h-8 w-36 rounded-md" />
              <Bone className="h-8 w-44 rounded-md" />
            </div>
          </div>
        </section>
      ))}

      {/* Selesai (30 terakhir): Bin · Alasan · Hasil · Putaran · Oleh · Waktu. */}
      <section aria-hidden className={SKELETON_CARD}>
        <div className={cn("px-4 pb-3 pt-4", PULSE)} style={{ animationDelay: "220ms" }}>
          <Bone className="h-5 w-52 rounded" />
        </div>
        <div className="border-t border-steel-100">
          <TableSkeleton columns={6} rows={5} delayMs={240} />
        </div>
      </section>
    </PageSkeleton>
  );
}
