import { CkbFilterSkeleton, CkbListSkeleton, CkbPageSkeleton } from "@/components/loading/ckb";

/**
 * Stock take & hitung ulang. Customer and status, then every session: reference with its status pill
 * and "buta" mark, customer · scope · date on a phone; seven columns from `md` up, ending in who
 * created it and when it closed. A session that is not closed has no closing date to print, which is
 * exactly why nothing here is printed.
 */
export default function Loading() {
  return (
    <CkbPageSkeleton label="Memuat stock take" live pills={0} actions={1}>
      <CkbFilterSkeleton fields={2} delayMs={80} />
      <CkbListSkeleton columns={7} rows={8} delayMs={200} />
    </CkbPageSkeleton>
  );
}
