import { CkbFilterSkeleton, CkbNoticeSkeleton, CkbPageSkeleton, CkbStatTilesSkeleton, CkbTableSkeleton } from "@/components/loading/ckb";

/**
 * Inventaris. The snapshot notice (stock is the active SAP snapshot, not a live balance), the
 * customer + material filter, four `StatTile` boxes, then the stock table: bin on its plate ·
 * material · batch · expired · unit · qty SAP · usulan · disetujui — the two adjustment columns kept
 * beside the snapshot figure, never added into it. The table is sticky and deep, so the skeleton is
 * a long one.
 */
export default function Loading() {
  return (
    <CkbPageSkeleton label="Memuat inventaris" pills={0}>
      <CkbFilterSkeleton fields={2} delayMs={80} />
      <CkbNoticeSkeleton lines={3} delayMs={120} />
      <CkbStatTilesSkeleton count={4} delayMs={160} />
      <CkbTableSkeleton columns={8} rows={10} delayMs={220} />
    </CkbPageSkeleton>
  );
}
