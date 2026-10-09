/**
 * Bandingkan dengan WMS: the day's WMS file against the system's stock,
 * without importing anything. Lines come from the import's own parser
 * (validateRows), so both read the file the same way.
 *
 * Compared per bin + SKU, then sorted by what the difference means:
 *   same        quantity and batches (batch + expiry) agree
 *   batch       same quantity, other batch name or expiry (the WMS sheet keeps
 *               one row per bin, so a new batch moved in often keeps the old name)
 *   moved       the SKU's total agrees, the cartons sit in another bin
 *               (a Bin To Bin done on the floor to another bin than posted)
 *   qty         the quantity differs
 *   only_file / only_system
 * The "moved" test runs per SKU over rack bins: the differences of its bins
 * add up to zero. Bins with a rejected file row are flagged, never judged.
 */
export type StockRow = { bin: string; sku: string; batch: string; expiry: string | null; qty: number; description?: string | null };
export type CompareKind = "same" | "batch" | "moved" | "qty" | "only_file" | "only_system";
export type CompareLine = {
  bin: string; sku: string; description: string; kind: CompareKind;
  file: number; system: number; fileBatches: string; systemBatches: string; rejected: boolean;
};
export type CompareResult = {
  lines: CompareLine[];
  counts: Record<CompareKind, number>;
  fileTotal: number; systemTotal: number;
};

const day = (d: string | null) => (d ?? "").slice(0, 10);
const isRack = (bin: string) => /^C[A-Z]\d{2}[A-E]\d{2}$/.test(bin);

function group(rows: StockRow[]) {
  const m = new Map<string, { bin: string; sku: string; description: string; qty: number; batches: Map<string, number> }>();
  for (const r of rows) {
    const bin = r.bin.trim().toUpperCase();
    const k = `${bin}|${r.sku}`;
    const g = m.get(k) ?? { bin, sku: r.sku, description: r.description ?? "", qty: 0, batches: new Map<string, number>() };
    g.qty += Number(r.qty) || 0;
    const b = `${r.batch.trim() || "–"} exp ${day(r.expiry) || "–"}`;
    g.batches.set(b, (g.batches.get(b) ?? 0) + (Number(r.qty) || 0));
    if (!g.description && r.description) g.description = r.description;
    m.set(k, g);
  }
  return m;
}
const describe = (b: Map<string, number> | undefined) =>
  !b ? "" : [...b.entries()].filter(([, q]) => q !== 0).sort().map(([k, q]) => `${k}: ${q}`).join("; ");
const sameBatches = (a: Map<string, number>, b: Map<string, number>) => describe(a) === describe(b);

export function compareWms(file: StockRow[], system: StockRow[], rejectedBins: Iterable<string> = []): CompareResult {
  const F = group(file), S = group(system);
  const rejected = new Set([...rejectedBins].map((b) => b.trim().toUpperCase()));
  const lines: CompareLine[] = [];
  for (const k of new Set([...F.keys(), ...S.keys()])) {
    const f = F.get(k), s = S.get(k);
    const fq = f?.qty ?? 0, sq = s?.qty ?? 0;
    if (fq === 0 && sq === 0) continue;
    const kind: CompareKind = fq === sq ? (sameBatches(f!.batches, s!.batches) ? "same" : "batch")
      : fq === 0 ? "only_system" : sq === 0 ? "only_file" : "qty";
    const g = (f ?? s)!;
    lines.push({ bin: g.bin, sku: g.sku, description: f?.description || s?.description || "", kind, file: fq, system: sq,
      fileBatches: describe(f?.batches), systemBatches: describe(s?.batches), rejected: rejected.has(g.bin) });
  }
  // Same cartons, another bin: a SKU whose rack differences cancel out.
  const bySku = new Map<string, CompareLine[]>();
  for (const l of lines) if (isRack(l.bin) && (l.kind === "qty" || l.kind === "only_file" || l.kind === "only_system")) {
    bySku.set(l.sku, [...(bySku.get(l.sku) ?? []), l]);
  }
  for (const list of bySku.values()) {
    if (list.length > 1 && list.reduce((n, l) => n + l.system - l.file, 0) === 0) for (const l of list) l.kind = "moved";
  }
  const order: CompareKind[] = ["qty", "only_system", "only_file", "moved", "batch", "same"];
  lines.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || Math.abs(b.system - b.file) - Math.abs(a.system - a.file) || a.bin.localeCompare(b.bin));
  const counts = { same: 0, batch: 0, moved: 0, qty: 0, only_file: 0, only_system: 0 } as Record<CompareKind, number>;
  for (const l of lines) counts[l.kind]++;
  return {
    lines, counts,
    fileTotal: file.reduce((n, r) => n + (Number(r.qty) || 0), 0),
    systemTotal: system.reduce((n, r) => n + (Number(r.qty) || 0), 0),
  };
}
