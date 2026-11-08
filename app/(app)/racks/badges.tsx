import { OWNER_LABEL, STATE_LABEL, stateOf, type RackBin } from "@/lib/racks";
import { cn } from "@/lib/utils";

/** The state, as everywhere on this page: red Diblokir, dashed Tidak ada, dotted Rencana. Aktif shows nothing. */
export function StateBadge({ bin, className }: { bin: Pick<RackBin, "status" | "block_kind">; className?: string }) {
  const s = stateOf(bin);
  if (s === "ACTIVE") return null;
  return (
    <span className={cn("inline-flex items-center rounded px-1.5 text-xs font-semibold leading-5",
      s === "BLOCKED" && "bg-bad text-white",
      s === "NOT_PRESENT" && "border border-dashed border-steel-300 text-steel-500",
      s === "PLANNED" && "border border-dotted border-ckb text-ckb", className)}>
      {STATE_LABEL[s]}
    </span>
  );
}

/** Only CKB 3PL is marked; Shell is the default and says nothing. */
export function OwnerBadge({ owner, className }: { owner: RackBin["owner"]; className?: string }) {
  if (owner !== "CKB") return null;
  return <span className={cn("inline-flex items-center rounded bg-jeir-teal/20 px-1.5 text-xs font-semibold leading-5 text-jeir-navy", className)}>{OWNER_LABEL.CKB}</span>;
}

/** A bin code set like its rack plate. */
export function CodePlate({ code, dim = false, className }: { code: string; dim?: boolean; className?: string }) {
  return (
    <span className={cn("inline-block rounded-plate px-1.5 font-cond text-sm font-bold leading-6 tracking-tight",
      dim ? "border border-dashed border-steel-300 bg-transparent text-steel-500" : "bg-plate text-steel", className)}>
      {code}
    </span>
  );
}
