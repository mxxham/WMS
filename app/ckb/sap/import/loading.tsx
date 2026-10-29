import { Bone, PULSE } from "@/components/loading/skeleton";
import { CkbFilterSkeleton, CkbNoticeSkeleton, CkbPageSkeleton, CkbTableSkeleton, pulseDelay } from "@/components/loading/ckb";
import { cn } from "@/lib/utils";

/**
 * Import SAP. The warning that the column mapping has not been checked against a real CKB file, then
 * the upload card — customer, the SAP stock date, the file field, a note, Pratinjau — and, below the
 * customer filter, every snapshot ever imported: snapshot · customer · tanggal · file · baris ·
 * ditolak · total qty · status pills (aktif / belum terverifikasi / identitas ganda) · oleh.
 */
export default function Loading() {
  return (
    <CkbPageSkeleton label="Memuat import SAP" live pills={0}>
      <CkbNoticeSkeleton lines={3} delayMs={60} />

      <section aria-hidden className="rounded-lg border border-steel-100 bg-white">
        <div className="border-b border-steel-100 px-4 py-3">
          <Bone className={cn("h-5 w-36 rounded", PULSE)} style={pulseDelay(100)} />
        </div>
        <div className={cn("space-y-4 p-4", PULSE)} style={pulseDelay(120)}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className={cn(i === 2 && "sm:col-span-2")}>
                <Bone className="mb-1 h-2.5 w-20 rounded" />
                <Bone className="h-10 w-full rounded-md" />
              </div>
            ))}
            <div className="sm:col-span-2 lg:col-span-4">
              <Bone className="mb-1 h-2.5 w-20 rounded" />
              <Bone className="h-10 w-full rounded-md" />
            </div>
          </div>
          <Bone className="h-10 w-28 rounded-md" />
        </div>
      </section>

      <CkbFilterSkeleton fields={1} delayMs={160} />

      <CkbTableSkeleton columns={9} rows={8} delayMs={200} />
    </CkbPageSkeleton>
  );
}
