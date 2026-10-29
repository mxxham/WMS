import { Bone, PULSE } from "@/components/loading/skeleton";
import { CkbPageSkeleton, CkbNoticeSkeleton, CkbListSkeleton, pulseDelay } from "@/components/loading/ckb";
import { cn } from "@/lib/utils";

/**
 * Customer. A notice when the reader may not edit, the "Customer baru" door for an admin, then the
 * directory: cards on a phone, the seven-column table from `md` up (kode · nama · status · kode
 * SAP/plant/SLoc · snapshot aktif · perwakilan · Ubah). The active snapshot is a record's own
 * reference, so it stays a bone.
 */
export default function Loading() {
  return (
    <CkbPageSkeleton label="Memuat customer" live pills={0}>
      <CkbNoticeSkeleton lines={1} delayMs={80} />

      <div aria-hidden className={cn(PULSE)} style={pulseDelay(120)}>
        <Bone className="h-10 w-40 rounded-md" />
      </div>

      <CkbListSkeleton columns={7} rows={6} delayMs={160} />
    </CkbPageSkeleton>
  );
}
