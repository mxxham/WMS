import { CkbFilterSkeleton, CkbListSkeleton, CkbPageSkeleton } from "@/components/loading/ckb";

/**
 * Inspeksi kargo. Six filters (customer, status, jenis, dari, sampai, and the one search field that
 * matches a reference, a document number or a material), then the inspection list: reference + status
 * pill + customer · type · date on a phone, and nine columns from `md` up, where the result pill
 * stands in for "Lulus" or a damage class and the last column pairs inspector with reviewer.
 */
export default function Loading() {
  return (
    <CkbPageSkeleton label="Memuat inspeksi" live pills={0} actions={1}>
      <CkbFilterSkeleton fields={6} delayMs={80} />
      <CkbListSkeleton columns={9} rows={8} delayMs={220} />
    </CkbPageSkeleton>
  );
}
