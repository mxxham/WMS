import { cn } from "@/lib/utils";
import type { ExpiryStatus } from "@/config/warehouse";

const tone: Record<ExpiryStatus, string> = {
  expired: "bg-bad text-white",
  near: "bg-warn text-steel",
  ok: "bg-ok text-white",
  unknown: "bg-steel-100 text-steel-700",
};
const label: Record<ExpiryStatus, string> = { expired: "Expired", near: "Segera expired", ok: "Aman", unknown: "Tanpa tanggal" };

export function ExpiryBadge({ status, className }: { status: ExpiryStatus; className?: string }) {
  return <span className={cn("inline-block rounded px-2 py-0.5 text-xs font-semibold", tone[status], className)}>{label[status]}</span>;
}

export function Badge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("inline-block rounded bg-steel-100 px-2 py-0.5 text-xs font-medium text-steel-700", className)} {...props} />;
}
