/**
 * DO numbers (delivery order = SAP order) on the picking audit.
 *
 * Three sources name the DO of an item, and they overlap:
 *   - the file's per-line "Order No" (or its "DO Number" when that is blank),
 *   - the allocator's `orderNos` from Schedule of the day,
 *   - `outbound.order_nos` in the database,
 *   - plus the manual DOs typed on the Wave page (`shipment_do_no`, 0079),
 *     which live per shipment and are only merged at read time.
 *
 * Both helpers are pure and match the database rule (0121, `norm_do_nos` and
 * `set_shipment_dos` in 0079): trim, drop empty, dedupe, keep first-seen
 * order, at most `MAX_DOS` entries.
 */

/** Same cap as the database: a shipment has a handful of DOs, never more. */
export const MAX_DOS = 20;

/** The DOs of a list of lists, in first-seen order, without blanks or repeats. */
export function mergeDos(...lists: (string[] | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const list of lists) {
    for (const raw of list ?? []) {
      const d = (raw ?? "").trim();
      if (d === "" || out.includes(d)) continue;
      out.push(d);
      if (out.length >= MAX_DOS) return out;
    }
  }
  return out;
}

/** The DOs as one printable cell: "538306981, 538045290", or "–" when there are none. */
export function doText(dos: string[] | null | undefined): string {
  const list = mergeDos(dos);
  return list.length ? list.join(", ") : "–";
}
