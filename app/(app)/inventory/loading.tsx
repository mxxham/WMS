import { Bone, PULSE, PageSkeleton, SKELETON_CARD, TableSkeleton, TilesSkeleton, ToolbarSkeleton } from "@/components/loading/skeleton";
import { cn } from "@/lib/utils";

/**
 * Inventory: the eight tabs, the daily WMS report bar, the seven totals, the filter bar and the
 * stock table with its footnote. The table is the same table on every screen — it scrolls sideways
 * on a phone — so its skeleton shows four columns there and all fourteen from md up, which is what
 * the eye actually sees at each width.
 */
export default function Loading() {
  return (
    <PageSkeleton label="Memuat inventory" className="flex flex-col">
      <TabsBarSkeleton />
      <WmsDayBarSkeleton />

      <div className="space-y-4 p-4 lg:p-8">
        <TilesSkeleton compact count={7} columns="grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7" delayMs={120} />

        {/* Cari · Lokasi · Aisle · Level · ABC · Umur simpan · Urutkan · the two toggles · the export. */}
        <ToolbarSkeleton fields={6} checks={2} actions={2} delayMs={160} />

        <section aria-hidden className={cn(SKELETON_CARD, "p-4")}>
          <TableSkeleton columns={14} rows={12} phoneColumns={4} delayMs={200} />
          <Bone className={cn("mt-3 h-10 w-56 rounded-md", PULSE)} style={{ animationDelay: "220ms" }} />
        </section>

        {/* Dipesan, Ditahan, Tersedia, Palet setara — the definitions under the table. */}
        <div className={cn("space-y-1.5", PULSE)} style={{ animationDelay: "240ms" }}>
          <Bone className="h-2 w-full max-w-4xl rounded" />
          <Bone className="h-2 w-full max-w-3xl rounded" />
        </div>
      </div>
    </PageSkeleton>
  );
}

/** The tab strip: one white bar, the active tab underlined. */
function TabsBarSkeleton() {
  return (
    <div aria-hidden className={cn("flex gap-1 overflow-x-auto border-b border-steel-100 bg-white px-4 lg:px-8", PULSE)}>
      {["w-10", "w-24", "w-28", "w-20", "w-20", "w-32", "w-28", "w-24"].map((width, i) => (
        <div key={i} className="shrink-0 border-b-2 border-transparent px-3 py-2.5">
          <Bone className={cn("h-3 rounded", width, i === 0 && "bg-steel-300/60")} />
        </div>
      ))}
    </div>
  );
}

/** "Laporan WMS harian": a date, then the button that builds the workbook. */
function WmsDayBarSkeleton() {
  return (
    <div aria-hidden className={cn("flex flex-wrap items-end gap-3 border-b border-steel-100 bg-white px-4 py-3 lg:px-8", PULSE)}>
      <div>
        <Bone className="mb-1 h-2.5 w-64 rounded" />
        <Bone className="h-10 w-44 rounded-md" />
      </div>
      <Bone className="h-10 w-36 rounded-md" />
    </div>
  );
}
