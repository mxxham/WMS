import { Bone, PULSE, PageSkeleton, SKELETON_CARD, DetailHeaderSkeleton, TableSkeleton, TilesSkeleton } from "@/components/loading/skeleton";
import { cn } from "@/lib/utils";

/**
 * Penerimaan, one receipt. The way back, the four facts about the document, then the check card:
 * how to count it, what arrived per SKU, and one block per pallet with its bin, batch and expiry.
 *
 * The card carries the two numbered steps the real one prints — 1. what really arrived, 2. let the
 * putaway propose the bins — because that is the order the checker works in, and the eye should
 * recognise the shape before the fields exist.
 */
export default function Loading() {
  return (
    <PageSkeleton label="Memuat penerimaan" className="flex flex-col gap-6 p-4 lg:p-8">
      <DetailHeaderSkeleton back title={false} meta={0} actions={0} />

      {/* Status · Tanggal dokumen · Kendaraan · Oleh. */}
      <TilesSkeleton compact count={4} columns="grid-cols-2 gap-3 md:grid-cols-4" delayMs={140} />

      <section aria-hidden className={SKELETON_CARD}>
        <div className={cn("border-b border-steel-100 px-4 py-3", PULSE)} style={{ animationDelay: "180ms" }}>
          <Bone className="h-5 w-64 rounded" />
        </div>

        <div className="space-y-4 p-4">
          {/* 1. apa yang benar-benar datang, 2. hitung putaway — the numbered guide. */}
          <ol className={cn("space-y-2", PULSE)} style={{ animationDelay: "200ms" }}>
            {[0, 1].map((i) => (
              <li key={i} className="flex gap-2">
                <Bone className="mt-0.5 h-5 w-5 shrink-0 rounded-full bg-steel-300/50" />
                <div className="flex-1 space-y-1.5">
                  <Bone className="h-2.5 w-full max-w-xl rounded" />
                  <Bone className="h-2.5 w-full max-w-md rounded" />
                </div>
              </li>
            ))}
          </ol>

          {/* SKU · Kemasan · Rencana · Datang · Rusak · Selisih. */}
          <TableSkeleton columns={6} rows={4} phoneColumns={3} delayMs={220} />

          <div className={cn("flex flex-wrap gap-2", PULSE)} style={{ animationDelay: "240ms" }}>
            <Bone className="h-10 w-52 rounded-md" />
            <Bone className="h-10 w-40 rounded-md" />
          </div>

          {/* One block per pallet: the bin, the batch, the manufacture date and the expiry. */}
          <div className={cn("space-y-2", PULSE)} style={{ animationDelay: "260ms" }}>
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-1 rounded-md bg-paper p-2">
                <Bone className="h-2 w-12 rounded" />
                <div className="grid grid-cols-2 gap-2 md:grid-cols-[1.4fr_1fr_10rem_6rem_6rem_8rem_2.5rem]">
                  {[0, 1, 2, 3, 4, 5].map((f) => <Bone key={f} className="h-10 rounded-md bg-white" />)}
                  <Bone className="hidden h-10 w-10 rounded-md md:block" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </PageSkeleton>
  );
}
