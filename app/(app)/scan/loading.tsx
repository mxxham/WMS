import { Bone, PULSE, PageSkeleton } from "@/components/loading/skeleton";
import { cn } from "@/lib/utils";

/**
 * Scan bin. One plate, one camera button, one line of help: the whole page is the field the scanner
 * types into, so the skeleton is that plate at its real 80px, in the plate blue — the thing the eye
 * is heading for, at the height it will be. Results do not appear here, they open /bin/<code>, so
 * there is no result sheet below to hold open.
 */
export default function Loading() {
  return (
    <PageSkeleton label="Memuat scan" className="mx-auto flex flex-col gap-4 p-4 max-w-lg">
      <div className={cn("space-y-2", PULSE)}>
        <Bone className="h-5 w-52 rounded" />
        {/* The scan plate itself: the pale rack-sign blue, the code centred in it. */}
        <div className="relative flex h-20 w-full items-center justify-center rounded-plate border-4 border-steel bg-plate">
          <Bone className="h-9 w-44 rounded bg-steel/15" />
        </div>
      </div>

      {/* Scan pakai kamera — the one button, full width, 56px tall. */}
      <Bone className={cn("h-14 w-full rounded-md bg-steel-300/60", PULSE)} style={{ animationDelay: "60ms" }} />

      {/* The USB/Bluetooth hint under the button. */}
      <div className="space-y-1.5">
        <Bone className={cn("h-2.5 w-full rounded", PULSE)} style={{ animationDelay: "100ms" }} />
        <Bone className={cn("h-2.5 w-3/5 rounded", PULSE)} style={{ animationDelay: "100ms" }} />
      </div>
    </PageSkeleton>
  );
}
