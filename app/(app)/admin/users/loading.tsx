import { Bone, PULSE, PageSkeleton, SKELETON_CARD, TableSkeleton } from "@/components/loading/skeleton";
import { cn } from "@/lib/utils";

/**
 * Pengguna: the "Tambah pengguna" button, the peran filter, then every account — as cards on a
 * phone (name, username · peran · status, and the action menu) and as a table from md up.
 *
 * No name, username or role is drawn: an account list that showed a placeholder name would be
 * inventing a person.
 */
export default function Loading() {
  return (
    <PageSkeleton label="Memuat pengguna" className="space-y-4 p-4 lg:p-8">
      {/* Tambah pengguna, then the filter select at its real max-w-xs. */}
      <div aria-hidden className={cn("flex flex-wrap items-end gap-3", PULSE)}>
        <Bone className="h-10 w-40 rounded-md" />
      </div>
      <div aria-hidden className="max-w-xs">
        <Bone className={cn("mb-1 h-2.5 w-24 rounded", PULSE)} />
        <Bone className={cn("h-10 w-full rounded-md", PULSE)} style={{ animationDelay: "40ms" }} />
      </div>

      {/* Phone: one card per account. */}
      <ul aria-hidden className={cn("space-y-2 md:hidden", PULSE)} style={{ animationDelay: "80ms" }}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <li key={i} className="flex items-center gap-3 rounded-lg bg-white p-3">
            <div className="min-w-0 flex-1 space-y-1.5">
              <Bone className="h-3 w-32 rounded" />
              <Bone className="h-2.5 w-48 rounded" />
            </div>
            <Bone className="h-8 w-8 rounded-md" />
          </li>
        ))}
      </ul>

      {/* Desktop: Nama · Nama pengguna · Peran · Status · the menu. */}
      <section aria-hidden className={cn(SKELETON_CARD, "hidden md:block")}>
        <TableSkeleton columns={5} rows={8} delayMs={120} />
      </section>
    </PageSkeleton>
  );
}
