import { Bone, PULSE } from "@/components/loading/skeleton";
import { CkbFactsSkeleton, CkbPageSkeleton, CkbStatTilesSkeleton, CkbTableSkeleton, pulseDelay } from "@/components/loading/ckb";
import { cn } from "@/lib/utils";

/**
 * One stock-take session. The header carries its status and the buttons that move it (Mulai, Hitung,
 * Tutup penghitungan, Selisih, Review, Ekspor, Batalkan); then the eleven facts — the snapshot it is
 * counted against, warehouse, scope, blind, the people, the four timestamps, the counters, the note —
 * the five counts, the per-classification pills, and the task table: # · bin · material · batch /
 * expired · unit · qty SAP · hitungan · selisih · status. The adjustments from this session and its
 * evidence follow underneath.
 */
export default function Loading() {
  return (
    <CkbPageSkeleton label="Memuat sesi stock take" back live pills={1} actions={3}>
      <CkbFactsSkeleton items={11} delayMs={100} />

      <CkbStatTilesSkeleton count={5} columns="grid-cols-2 gap-3 md:grid-cols-5" delayMs={140} />

      {/* Klasifikasi pills: counted / match / shortage / overage / ambiguous. */}
      <div aria-hidden className={cn("flex flex-wrap gap-2", PULSE)} style={pulseDelay(160)}>
        {[0, 1, 2, 3].map((i) => <Bone key={i} className="h-5 w-24 rounded" />)}
      </div>

      {/* Tugas hitung: the deep sticky table. */}
      <section aria-hidden className="rounded-lg border border-steel-100 bg-white">
        <div className="border-b border-steel-100 px-4 py-3">
          <Bone className={cn("h-5 w-28 rounded", PULSE)} style={pulseDelay(180)} />
        </div>
        <CkbTableSkeleton columns={9} rows={12} delayMs={200} className="rounded-none border-0" />
      </section>

      {/* Penyesuaian dari sesi ini: ref · material · bin · batch · selisih · status · keputusan. Selisih
          is hidden with qty SAP when the viewer may not see the baseline, as in the task table. */}
      <section aria-hidden className="rounded-lg border border-steel-100 bg-white">
        <div className="border-b border-steel-100 px-4 py-3">
          <Bone className={cn("h-5 w-44 rounded", PULSE)} style={pulseDelay(240)} />
        </div>
        <CkbTableSkeleton columns={7} rows={3} delayMs={260} className="rounded-none border-0" />
      </section>

      {/* Bukti sesi: two across, each with its file type, who uploaded it and the Buka link. */}
      <section aria-hidden className="rounded-lg border border-steel-100 bg-white">
        <div className="border-b border-steel-100 px-4 py-3">
          <Bone className={cn("h-5 w-24 rounded", PULSE)} style={pulseDelay(300)} />
        </div>
        <div className={cn("space-y-3 p-4", PULSE)} style={pulseDelay(320)}>
          <ul className="grid gap-2 sm:grid-cols-2">
            {[0, 1].map((i) => (
              <li key={i} className="flex items-start gap-3 rounded-md border border-steel-100 bg-white p-3">
                <Bone className="mt-0.5 h-5 w-5 shrink-0 rounded" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Bone className="h-3 w-24 rounded" />
                  <Bone className="h-2.5 w-2/3 rounded" />
                  <Bone className="h-2 w-40 rounded" />
                  <Bone className="h-2.5 w-12 rounded" />
                </div>
              </li>
            ))}
          </ul>
          <div className="grid gap-2 rounded-md bg-paper p-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
            <div>
              <Bone className="mb-1 h-2 w-12 rounded" />
              <Bone className="h-10 w-full rounded-md" />
            </div>
            <div>
              <Bone className="mb-1 h-2 w-24 rounded" />
              <Bone className="h-10 w-full rounded-md" />
            </div>
            <Bone className="h-10 w-32 rounded-md" />
          </div>
        </div>
      </section>
    </CkbPageSkeleton>
  );
}
