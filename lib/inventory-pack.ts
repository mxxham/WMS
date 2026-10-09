/**
 * Inventory → Stok sends every stock line to the browser (filters and sorting
 * run there). As plain objects that was ~940 kB of HTML per load: the same 17
 * keys and the same product text on every line. Packed, each SKU and each
 * bin is sent once and a line is a short tuple; the browser rebuilds the
 * objects, so the screen code is unchanged.
 */
export type PackLine = {
  bin_code: string; zone: string; rack: string | null; level: string | null; bin_status: "active" | "blocked";
  sku: string; description: string; uom: string | null; upp: number | null; item_abc: string | null;
  batch_lot: string; quantity: number; expiry_date: string | null; received_date: string | null; days_remaining: number | null;
  held: number; hold_reasons: string | null;
};

type Row = [bin: string, sku: string, batch: string, qty: number, expiry: string | null, received: string | null,
  days: number | null, held: number, reasons: string | null];
export type PackedLines = {
  items: Record<string, [description: string, uom: string | null, upp: number | null, abc: string | null]>;
  bins: Record<string, [zone: string, rack: string | null, level: string | null, status: "active" | "blocked"]>;
  rows: Row[];
};

export function packLines(lines: PackLine[]): PackedLines {
  const items: PackedLines["items"] = {}, bins: PackedLines["bins"] = {};
  const rows = lines.map((l): Row => {
    items[l.sku] ??= [l.description, l.uom, l.upp, l.item_abc];
    bins[l.bin_code] ??= [l.zone, l.rack, l.level, l.bin_status];
    return [l.bin_code, l.sku, l.batch_lot, Number(l.quantity), l.expiry_date, l.received_date, l.days_remaining, Number(l.held), l.hold_reasons];
  });
  return { items, bins, rows };
}

export function unpackLines(p: PackedLines): PackLine[] {
  return p.rows.map(([bin_code, sku, batch_lot, quantity, expiry_date, received_date, days_remaining, held, hold_reasons]) => {
    const [description, uom, upp, item_abc] = p.items[sku];
    const [zone, rack, level, bin_status] = p.bins[bin_code];
    return { bin_code, zone, rack, level, bin_status, sku, description, uom, upp, item_abc, batch_lot, quantity, expiry_date, received_date, days_remaining, held, hold_reasons };
  });
}
