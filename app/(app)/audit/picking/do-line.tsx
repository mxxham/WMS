import { doText, mergeDos } from "@/lib/audit-do";
import { cn } from "@/lib/utils";

/**
 * An item's DO (delivery order = SAP order) numbers, as a compact second line
 * inside the SKU or Shipment cell — a tenth column costs too much room on a
 * phone. DO is shipping metadata, not audited data, so it is shown from the
 * start and never behind an audit; "–" when the source names none.
 */
export function DoLine({ dos, className, label = "DO" }: {
  dos: string[] | null | undefined;
  className?: string;
  /** "DO" on one item; "DO shipment" when the line lists a whole shipment's numbers */
  label?: string;
}) {
  const list = mergeDos(dos);
  return (
    <span className={cn("block text-xs", className)}>
      <span className="text-steel-500">{label}</span>{" "}
      {/* tabular: a column of DO numbers still lines up; selectable so it can be copied. */}
      <span className={cn("tabular", list.length ? "font-medium" : "text-steel-500")}>{doText(list)}</span>
    </span>
  );
}
