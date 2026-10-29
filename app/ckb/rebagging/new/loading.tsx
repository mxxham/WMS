import { Bone, PULSE } from "@/components/loading/skeleton";
import { CkbPageSkeleton, pulseDelay } from "@/components/loading/ckb";
import { cn } from "@/lib/utils";

/**
 * /ckb/rebagging/new exists only to open the new-job form on the list page — it checks access and
 * redirects. So this waiting state is a moment, not a page: the way back and one line saying the
 * form is opening where it lives. Drawing the form here would promise a screen that never appears.
 */
export default function Loading() {
  return (
    <CkbPageSkeleton label="Membuka formulir rebagging" bodyClassName="max-w-3xl" pills={0}>
      <div aria-hidden className={cn("space-y-1.5", PULSE)} style={pulseDelay(60)}>
        <Bone className="h-2.5 w-64 rounded" />
        <Bone className="h-2.5 w-48 rounded" />
      </div>
    </CkbPageSkeleton>
  );
}
