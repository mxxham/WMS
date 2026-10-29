import { Bone, PULSE } from "@/components/loading/skeleton";
import { CkbNoticeSkeleton, CkbPageSkeleton, CkbTableSkeleton, pulseDelay } from "@/components/loading/ckb";
import { cn } from "@/lib/utils";

/**
 * Akses pengguna. The three-things notice (app access, CKB role, customer scope are separate), then
 * the toolbar — the name / username search, "Hanya yang punya akses CKB", and "Akun CKB baru" — and
 * the table that decides access: nama with its username, aplikasi as pills, peran CKB, the customers
 * a representative may see, and the Atur button. Never a count of anyone: the rows are people.
 */
export default function Loading() {
  return (
    <CkbPageSkeleton label="Memuat akses pengguna" pills={0}>
      <CkbNoticeSkeleton lines={3} delayMs={60} />

      <div aria-hidden className={cn("flex flex-wrap items-end gap-3", PULSE)} style={pulseDelay(100)}>
        <Bone className="h-10 w-full rounded-md sm:w-72" />
        <div className="flex min-h-10 items-center gap-2">
          <Bone className="h-4 w-4 rounded-sm" />
          <Bone className="h-2.5 w-40 rounded" />
        </div>
        <Bone className="ml-auto h-10 w-40 rounded-md" />
      </div>

      <CkbTableSkeleton columns={5} rows={10} delayMs={180} />
    </CkbPageSkeleton>
  );
}
