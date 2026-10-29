import { CkbFilterSkeleton, CkbNoticeSkeleton, CkbPageSkeleton, CkbTableSkeleton } from "@/components/loading/ckb";

/**
 * Arsip foto. The retention / legal-hold notice, four filters (customer, data, dari, sampai), then one
 * row per stored file, as the page itself lists it: waktu · customer · the record it belongs to ·
 * jenis · keterangan · oleh · simpan sampai with its hold pill · Buka. The archive is a register, not
 * a gallery: the thumbnails belong to the record each file is attached to (an inspection, a counting
 * task, a rebagging job), and every opening goes through the access-checked route that logs it — so
 * no image is fetched or drawn here.
 */
export default function Loading() {
  return (
    <CkbPageSkeleton label="Memuat arsip foto" live pills={0}>
      <CkbFilterSkeleton fields={4} delayMs={80} />
      <CkbNoticeSkeleton lines={3} delayMs={120} />
      <CkbTableSkeleton columns={8} rows={10} delayMs={200} />
    </CkbPageSkeleton>
  );
}
