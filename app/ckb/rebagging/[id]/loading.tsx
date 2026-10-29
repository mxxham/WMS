import type { ReactNode } from "react";
import { Bone, PULSE } from "@/components/loading/skeleton";
import { CkbPageSkeleton, CkbPhotoGridSkeleton, CkbTableSkeleton, pulseDelay } from "@/components/loading/ckb";
import { cn } from "@/lib/utils";

/**
 * One rebagging job — the workspace, in the order the floor works it: the job card (status, operation,
 * the plan's figures), "Nama Anda" (every step records a person), the source lines, the output plan,
 * the lifecycle buttons, the before/after photo evidence, and the event history at the bottom.
 *
 * The evidence section is the one place a photograph is expected: three dashed upload tiles for
 * sebelum / sesudah / lainnya, then the gallery of square thumbnails with their captions.
 */
export default function Loading() {
  return (
    <CkbPageSkeleton label="Memuat rebagging" back live pills={0} bodyClassName="space-y-4">
      {/* JobCard: the two badges, then the label/value pairs. */}
      <section aria-hidden className="rounded-lg border border-steel-100 bg-white p-4">
        <div className={cn("flex flex-wrap items-center gap-2", PULSE)} style={pulseDelay(60)}>
          <Bone className="h-5 w-24 rounded" />
          <Bone className="h-5 w-20 rounded" />
        </div>
        <dl className={cn("mt-3 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2", PULSE)} style={pulseDelay(80)}>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="flex items-baseline gap-2">
              <Bone className="h-2.5 w-20 shrink-0 rounded" />
              <Bone className="h-3 w-24 rounded" />
            </div>
          ))}
        </dl>
      </section>

      {/* "Nama Anda": the one field every action needs, with its hint beside it. */}
      <section aria-hidden className="rounded-lg border border-steel-100 bg-white p-4">
        <div className={cn("grid gap-3 sm:grid-cols-[auto_1fr] sm:items-end", PULSE)} style={pulseDelay(100)}>
          <div>
            <Bone className="mb-1 h-2.5 w-16 rounded" />
            <Bone className="h-10 w-56 rounded-md" />
          </div>
          <Bone className="mb-2 h-2.5 w-56 rounded" />
        </div>
      </section>

      <CardShell titleWidth="w-44" actionWidth="w-28" delayMs={120}>
        <CkbTableSkeleton columns={6} rows={3} delayMs={140} className="rounded-none border-0" />
      </CardShell>

      {/* Rencana output: one editable line per destination bin. */}
      <section aria-hidden className="rounded-lg border border-steel-100 bg-white">
        <CardTitleBone width="w-40" delayMs={160} />
        <div className={cn("space-y-2 p-4", PULSE)} style={pulseDelay(180)}>
          {[0, 1].map((i) => (
            <div key={i} className="grid gap-2 rounded-lg border border-steel-100 p-3 sm:grid-cols-5">
              {[0, 1, 2, 3].map((f) => <Bone key={f} className="h-10 rounded-md" />)}
              <Bone className="h-10 w-10 rounded-md" />
            </div>
          ))}
        </div>
      </section>

      {/* Aksi: the lifecycle buttons, wrapped. */}
      <section aria-hidden className="rounded-lg border border-steel-100 bg-white">
        <CardTitleBone width="w-16" delayMs={200} />
        <div className={cn("flex flex-wrap gap-2 p-4", PULSE)} style={pulseDelay(220)}>
          <Bone className="h-10 w-40 rounded-md" />
          <Bone className="h-10 w-32 rounded-md" />
          <Bone className="h-10 w-36 rounded-md" />
        </div>
      </section>

      {/* Bukti foto: the three upload tiles, then the gallery. */}
      <section aria-hidden className="rounded-lg border border-steel-100 bg-white">
        <CardTitleBone width="w-32" delayMs={240} />
        <div className={cn("space-y-4 p-4", PULSE)} style={pulseDelay(260)}>
          <div className="grid gap-3 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex h-24 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-steel-300">
                <Bone className="h-6 w-6 rounded" />
                <Bone className="h-2 w-20 rounded" />
              </div>
            ))}
          </div>
          <CkbPhotoGridSkeleton count={4} delayMs={280} />
        </div>
      </section>

      {/* Riwayat: one line per event, time · type · who · note. */}
      <section aria-hidden className="rounded-lg border border-steel-100 bg-white">
        <CardTitleBone width="w-20" delayMs={300} />
        <ol className={cn("space-y-2 p-4", PULSE)} style={pulseDelay(320)}>
          {[0, 1, 2, 3, 4].map((i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-x-2">
              <Bone className="h-2.5 w-28 rounded" />
              <Bone className="h-5 w-20 rounded" />
              <Bone className="h-2.5 w-24 rounded" />
            </li>
          ))}
        </ol>
      </section>
    </CkbPageSkeleton>
  );
}

/** A card with the real `CardHeader` rule and title, optionally with an action at its right edge. */
function CardTitleBone({ width, delayMs }: { width: string; delayMs: number }) {
  return (
    <div className="border-b border-steel-100 px-4 py-3">
      <Bone className={cn("h-5 rounded", PULSE, width)} style={pulseDelay(delayMs)} />
    </div>
  );
}

/** A card whose header carries both a title and a button. */
function CardShell({ titleWidth, actionWidth, delayMs, children }: { titleWidth: string; actionWidth: string; delayMs: number; children: ReactNode }) {
  return (
    <section aria-hidden className="rounded-lg border border-steel-100 bg-white">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <Bone className={cn("h-5 rounded", PULSE, titleWidth)} style={pulseDelay(delayMs)} />
        <Bone className={cn("h-8 rounded-md", PULSE, actionWidth)} style={pulseDelay(delayMs)} />
      </div>
      {children}
    </section>
  );
}
