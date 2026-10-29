import { Bone, PULSE, PageSkeleton } from "@/components/loading/skeleton";
import { cn } from "@/lib/utils";

/**
 * Import data WMS: the page header (`Import data WMS` + Live dot), then the upload step — one large
 * dashed drop target holding the spreadsheet icon, "Pilih file WMS (.xlsx / .csv)" and the two-line
 * note under it.
 *
 * `Ditahan impor` (`HeldPanel`) is left out: it only renders while the database still holds an
 * undecided import, so a skeleton that always drew it would promise a card most visits do not have.
 * The map / review / done steps are left out for the same reason — they replace the drop target only
 * after a file has been read, and the skeleton only ever stands in for the first paint.
 */
export default function Loading() {
  return (
    <PageSkeleton label="Memuat import data WMS" header>
      <div aria-hidden className="space-y-6">
        <div
          className={cn(
            "flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-steel-300 bg-white p-10 text-center",
            PULSE,
          )}
          style={{ animationDelay: "80ms" }}
        >
          {/* FileSpreadsheet, then the step's title and the explanation under it. */}
          <Bone className="h-10 w-10 rounded-md" />
          <Bone className="h-6 w-64 rounded" />
          <Bone className="h-2.5 w-full max-w-md rounded" />
          <Bone className="h-2.5 w-56 rounded" />
        </div>
      </div>
    </PageSkeleton>
  );
}
