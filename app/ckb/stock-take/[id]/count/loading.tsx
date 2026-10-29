import { Bone, PULSE } from "@/components/loading/skeleton";
import { CkbCountRowsSkeleton, CkbPageSkeleton, CkbStepRailSkeleton, pulseDelay } from "@/components/loading/ckb";
import { cn } from "@/lib/utils";

/**
 * Hitung. This screen is held in one hand at the rack, so the shape is a phone column: the session's
 * stage rail with counting lit, the sticky scan band (the field the scanner types a bin code into,
 * plus the Belum dihitung / Hitung ulang / Semua / Barang temuan chips), then one full-width row per
 * stock identity — bin on its plate, material with its description line, batch · expiry · unit, the
 * status pill and the chevron that opens the count form.
 */
export default function Loading() {
  return (
    <CkbPageSkeleton label="Memuat hitung stock take" back live pills={1} bodyClassName="max-w-3xl">
      <CkbStepRailSkeleton steps={3} active={0} delayMs={80} />

      {/* The sticky scan band: same tint, same 44px field, so the list below does not jump. */}
      <div aria-hidden className={cn("-mx-4 space-y-2 bg-ckb-tint/25 px-4 py-2 backdrop-blur", PULSE)} style={pulseDelay(120)}>
        <Bone className="h-11 w-full rounded-md" />
        <div className="flex flex-wrap items-center gap-2">
          <Bone className="h-9 w-36 rounded-full" />
          <Bone className="h-9 w-28 rounded-full" />
          <Bone className="h-9 w-20 rounded-full" />
          <Bone className="ml-auto h-9 w-32 rounded-md" />
        </div>
      </div>

      <CkbCountRowsSkeleton rows={6} delayMs={160} />
    </CkbPageSkeleton>
  );
}
