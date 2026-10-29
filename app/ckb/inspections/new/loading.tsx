import { Bone, PULSE } from "@/components/loading/skeleton";
import { CkbPageSkeleton, CkbStepRailSkeleton, pulseDelay } from "@/components/loading/ckb";
import { cn } from "@/lib/utils";

/**
 * Inspeksi baru — the first step of a two-step job: identify the cargo here, then fill the checklist
 * on the record that gets created. So the page is a stage rail (identitas → checklist → kirim) with
 * the first stop lit, then one card of paired fields: customer, jenis, checklist, tanggal, dokumen,
 * gudang, lokasi, ref kemasan, material, batch, and the description across both columns, ending in
 * the one button that creates the draft.
 */
export default function Loading() {
  return (
    <CkbPageSkeleton label="Membuat inspeksi baru" back bodyClassName="max-w-3xl" pills={0}>
      <CkbStepRailSkeleton steps={3} active={0} delayMs={80} />

      <section aria-hidden className="rounded-lg border border-steel-100 bg-white p-4">
        <div className={cn("grid gap-3 sm:grid-cols-2", PULSE)} style={pulseDelay(120)}>
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i}>
              <Bone className={cn("mb-1 h-2.5 rounded", i % 3 === 0 ? "w-24" : "w-16")} />
              <Bone className="h-10 w-full rounded-md" />
            </div>
          ))}
          {/* Deskripsi material / kargo spans the pair of columns. */}
          <div className="sm:col-span-2">
            <Bone className="mb-1 h-2.5 w-40 rounded" />
            <Bone className="h-10 w-full rounded-md" />
          </div>
        </div>
        <div className={cn("mt-3", PULSE)} style={pulseDelay(160)}>
          <Bone className="h-10 w-56 rounded-md" />
        </div>
      </section>
    </CkbPageSkeleton>
  );
}
