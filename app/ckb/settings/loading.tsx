import { Bone, PULSE } from "@/components/loading/skeleton";
import { CkbPageSkeleton, pulseDelay } from "@/components/loading/ckb";
import { cn } from "@/lib/utils";

/**
 * Pengaturan. One card per setting key, each saved whole by its own Simpan: gudang, stock take
 * (blind by default), evidence (size, retention, file types), inspection (photo on every NG), the SAP
 * import column mapping with its unverified warning and its two-column field list, and the export
 * format version. The inspection checklist templates close the page as a list of code + version rows.
 */
export default function Loading() {
  return (
    <CkbPageSkeleton label="Memuat pengaturan" pills={0} bodyClassName="max-w-4xl">
      <SettingCard titleWidth="w-24" fields={1} delayMs={60} />
      <SettingCard titleWidth="w-32" fields={1} checks={1} delayMs={100} />
      <SettingCard titleWidth="w-56" fields={3} note={2} delayMs={140} />
      <SettingCard titleWidth="w-24" fields={1} checks={1} delayMs={180} />
      <SettingCard titleWidth="w-64" fields={6} note={3} checks={1} pair delayMs={220} />
      <SettingCard titleWidth="w-40" fields={1} checks={1} note={2} delayMs={260} />

      {/* Checklist inspeksi: the template list, one row per code and version. */}
      <section aria-hidden className="rounded-lg border border-steel-100 bg-white">
        <div className="border-b border-steel-100 px-4 py-3">
          <Bone className={cn("h-5 w-44 rounded", PULSE)} style={pulseDelay(300)} />
        </div>
        <ul className={cn("divide-y divide-steel-100 px-4", PULSE)} style={pulseDelay(320)}>
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex items-center justify-between gap-2 py-2.5">
              <Bone className={cn("h-3 rounded", i % 2 ? "w-40" : "w-56")} />
              <Bone className="h-5 w-16 rounded" />
            </li>
          ))}
        </ul>
      </section>
    </CkbPageSkeleton>
  );
}

/** A settings card: its title, an optional note band, its fields, its checkboxes, and the Simpan. */
function SettingCard({ titleWidth, fields, checks = 0, note = 0, pair = false, delayMs }: {
  titleWidth: string; fields: number; checks?: number; note?: number; pair?: boolean; delayMs: number;
}) {
  return (
    <section aria-hidden className="rounded-lg border border-steel-100 bg-white">
      <div className="border-b border-steel-100 px-4 py-3">
        <Bone className={cn("h-5 rounded", PULSE, titleWidth)} style={pulseDelay(delayMs)} />
      </div>
      <div className={cn("space-y-3 p-4", PULSE)} style={pulseDelay(delayMs + 20)}>
        {note > 0 && (
          <div className="space-y-1.5 rounded-lg bg-ckb-tint/50 px-3 py-2">
            {Array.from({ length: note }, (_, i) => (
              <Bone key={i} className={cn("h-2 rounded", i === note - 1 ? "w-1/3" : "w-full max-w-2xl")} />
            ))}
          </div>
        )}
        <div className={cn("grid gap-3", pair && "sm:grid-cols-2")}>
          {Array.from({ length: fields }, (_, i) => (
            <div key={i} className={cn(!pair && "max-w-xl")}>
              <Bone className="mb-1 h-2.5 w-24 rounded" />
              <Bone className="h-10 w-full rounded-md" />
            </div>
          ))}
        </div>
        {Array.from({ length: checks }, (_, i) => (
          <div key={i} className="flex min-h-10 items-center gap-2">
            <Bone className="h-4 w-4 rounded-sm" />
            <Bone className="h-2.5 w-64" />
          </div>
        ))}
        <Bone className="h-10 w-28 rounded-md" />
      </div>
    </section>
  );
}
