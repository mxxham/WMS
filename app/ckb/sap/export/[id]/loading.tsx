import { Bone, PULSE } from "@/components/loading/skeleton";
import { CkbFactsSkeleton, CkbNoticeSkeleton, CkbPageSkeleton, CkbTableSkeleton, pulseDelay } from "@/components/loading/ckb";
import { cn } from "@/lib/utils";

/**
 * One SAP export. Its status pill and the Unduh file button, the two notices (the format is internal,
 * and a generated file only becomes posted when someone records SAP's document number, then the
 * facts — customer, lines, gain, loss, who and when, format version, downloads, the SAP document, the
 * original export and any re-exports — the actions (Ekspor ulang, Batalkan ekspor), and the frozen
 * lines themselves: penyesuaian · sesi · bin · material · batch · SAP · fisik · selisih.
 */
export default function Loading() {
  return (
    <CkbPageSkeleton label="Memuat ekspor SAP" back live pills={1} actions={1}>
      <CkbNoticeSkeleton lines={2} delayMs={80} />

      <CkbFactsSkeleton items={10} delayMs={120} />

      <div aria-hidden className={cn("flex flex-wrap gap-2", PULSE)} style={pulseDelay(160)}>
        <Bone className="h-10 w-36 rounded-md" />
        <Bone className="h-10 w-32 rounded-md" />
      </div>

      <CkbTableSkeleton columns={9} rows={8} delayMs={220} />
    </CkbPageSkeleton>
  );
}
