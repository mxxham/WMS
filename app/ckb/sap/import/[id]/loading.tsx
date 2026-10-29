import { Bone, PULSE } from "@/components/loading/skeleton";
import { CkbFactsSkeleton, CkbFilterSkeleton, CkbNoticeSkeleton, CkbPageSkeleton, CkbTableSkeleton, pulseDelay } from "@/components/loading/ckb";
import { cn } from "@/lib/utils";

/**
 * One SAP snapshot. The "aktif / Aktifkan" pill, the unverified-mapping notice, the facts (file,
 * sheet and header line, checksum, rows, rejected, total qty, duplicate identities, who imported it
 * and when, the note), the "Bandingkan dengan:" chips that open the comparison against an older
 * snapshot, the search, and the snapshot's own rows — baris · material · deskripsi · plant · SLoc ·
 * bin · batch · expired · satuan · qty — paged five hundred at a time.
 */
export default function Loading() {
  return (
    <CkbPageSkeleton label="Memuat snapshot SAP" back pills={1}>
      <CkbNoticeSkeleton lines={1} delayMs={60} />

      <CkbFactsSkeleton items={10} delayMs={100} />

      {/* Bandingkan dengan: one chip per earlier snapshot of this customer. */}
      <div aria-hidden className={cn("flex flex-wrap items-center gap-2", PULSE)} style={pulseDelay(140)}>
        <Bone className="h-2.5 w-32 rounded" />
        <Bone className="h-8 w-32 rounded-md" />
        <Bone className="h-8 w-32 rounded-md" />
      </div>

      <CkbFilterSkeleton fields={1} delayMs={180} />

      <CkbTableSkeleton columns={10} rows={12} delayMs={220} />

      {/* The pager: how many rows, and the two page links. */}
      <div aria-hidden className={cn("flex items-center justify-between", PULSE)} style={pulseDelay(280)}>
        <Bone className="h-3 w-24 rounded" />
        <div className="flex gap-3">
          <Bone className="h-3 w-20 rounded" />
          <Bone className="h-3 w-20 rounded" />
        </div>
      </div>
    </CkbPageSkeleton>
  );
}
