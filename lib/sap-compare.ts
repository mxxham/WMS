/**
 * SAP vs WMS stock comparison (Rekonsiliasi SAP, migrations 0021 + 0111).
 * SAP's MB52 is the reference: every number here reads from OUR side,
 * "lebih" = we hold more than SAP, "kurang" = we hold less.
 *
 * The database stores diff = SAP - (WMS + pending GI + auto GI - pending GR);
 * these helpers turn it around once so the UI never shows a sign the wrong way.
 */

export type CompareLine = {
  sku: string; description: string | null; item_id: string | null; sap_uom: string | null; wms_uom: string | null;
  sap_unrestricted: number; sap_blocked: number; wms_unrestricted: number; wms_blocked: number;
  pending_gi: number; pending_gr: number; auto_gi: number;
  diff_unrestricted: number; diff_blocked: number;
  /** net adjustment posted to the WMS from this line (Investigasi selisih, 0129); the day's numbers stay as they were */
  wms_fix?: number | null;
  sap_other: Record<string, number> | null;
  status: "OPEN" | "EXPLAINED" | "COUNT_REQUESTED" | "RESOLVED"; cause: CauseCode | null;
};

export const CAUSES = {
  PENDING_GI: "Pending GI (sudah kirim, belum GI SAP)",
  PENDING_GR: "Pending GR (sudah terima, belum GR SAP)",
  SAP_INBOUND: "Masih di INBD / transit SAP",
  MISPICK: "Salah ambil / salah kirim",
  COUNT: "Selisih hitung fisik",
  SAP_ENTRY: "Salah input di SAP",
  UOM: "Satuan beda",
  DAMAGED: "Rusak / blok",
  RETURN: "Retur",
  MISPLACED: "Salah lokasi (Bin To Bin tidak tercatat)",
  OTHER: "Lainnya",
} as const;
export type CauseCode = keyof typeof CAUSES;

/** SAP movement types seen in Shell's MB51, in words. */
export const MVT_TYPES: Record<string, string> = {
  "101": "GR penerimaan", "102": "Batal GR", "122": "Retur ke vendor", "161": "Retur",
  "301": "Transfer antar plant", "311": "Transfer antar lokasi", "312": "Batal transfer", Z31: "Transfer INBD → gudang",
  "343": "Blok → bebas", "344": "Bebas → blok", "551": "Scrap", "601": "GI pengiriman", "602": "Batal GI",
  "641": "GI transfer (STO)", "651": "Retur pelanggan", "653": "Retur pelanggan", "701": "Selisih opname +", "702": "Selisih opname -",
};
export const mvtLabel = (t: string) => MVT_TYPES[t] ?? `Mvt ${t}`;

const n = (v: unknown) => Number(v ?? 0) || 0;
const otherTotal = (l: CompareLine) => Object.values(l.sap_other ?? {}).reduce((s, v) => s + n(v), 0);

/** Our stock minus SAP's, after the timing corrections. + = lebih, - = kurang. */
export const gapUnrestricted = (l: CompareLine) => -n(l.diff_unrestricted);
export const gapBlocked = (l: CompareLine) => -n(l.diff_blocked);
export const gapTotal = (l: CompareLine) => gapUnrestricted(l) + gapBlocked(l);
export const sapTotal = (l: CompareLine) => n(l.sap_unrestricted) + n(l.sap_blocked);
export const wmsTotal = (l: CompareLine) => n(l.wms_unrestricted) + n(l.wms_blocked);
export const timingTotal = (l: CompareLine) => n(l.pending_gi) + n(l.auto_gi) - n(l.pending_gr);
export const hasGap = (l: CompareLine) => n(l.diff_unrestricted) !== 0 || n(l.diff_blocked) !== 0;

export type Direction = "MATCH" | "MORE" | "LESS" | "MIXED";
/** MIXED: e.g. more unrestricted but less blocked (stock in the wrong status). */
export function direction(l: CompareLine): Direction {
  const u = gapUnrestricted(l), b = gapBlocked(l);
  if (u === 0 && b === 0) return "MATCH";
  if ((u > 0 && b < 0) || (u < 0 && b > 0)) return "MIXED";
  return u + b > 0 ? "MORE" : "LESS";
}

export type Flag = "ONLY_SAP" | "ONLY_WMS" | "UOM" | "NO_MASTER" | "IN_OTHER" | "STATUS";
export function flags(l: CompareLine): Flag[] {
  const f: Flag[] = [];
  if (sapTotal(l) > 0 && wmsTotal(l) === 0) f.push("ONLY_SAP");
  if (sapTotal(l) === 0 && wmsTotal(l) > 0) f.push("ONLY_WMS");
  if (l.sap_uom && l.wms_uom && l.sap_uom !== l.wms_uom) f.push("UOM");
  if (!l.item_id) f.push("NO_MASTER");
  if (otherTotal(l) > 0) f.push("IN_OTHER");
  if (direction(l) === "MIXED") f.push("STATUS");
  return f;
}
export const FLAG_LABEL: Record<Flag, string> = {
  ONLY_SAP: "Hanya di SAP", ONLY_WMS: "Hanya di WMS", UOM: "Satuan beda", NO_MASTER: "Tidak ada di master",
  IN_OTHER: "Ada di lokasi SAP lain", STATUS: "Status beda (bebas vs blok)",
};

export const FILTERS = {
  diff: { label: "Ada selisih", test: (l: CompareLine) => hasGap(l) },
  more: { label: "WMS lebih", test: (l: CompareLine) => gapTotal(l) > 0 },
  less: { label: "WMS kurang", test: (l: CompareLine) => gapTotal(l) < 0 },
  only_sap: { label: "Hanya di SAP", test: (l: CompareLine) => flags(l).includes("ONLY_SAP") },
  only_wms: { label: "Hanya di WMS", test: (l: CompareLine) => flags(l).includes("ONLY_WMS") },
  open: { label: "Belum ditangani", test: (l: CompareLine) => hasGap(l) && (l.status === "OPEN" || l.status === "COUNT_REQUESTED") },
  match: { label: "Cocok", test: (l: CompareLine) => !hasGap(l) },
  all: { label: "Semua SKU", test: () => true },
} as const;
export type FilterKey = keyof typeof FILTERS;

export const SORTS = {
  gap: { label: "Selisih terbesar", cmp: (a: CompareLine, b: CompareLine) => Math.abs(gapTotal(b)) - Math.abs(gapTotal(a)) },
  more: { label: "WMS paling lebih", cmp: (a: CompareLine, b: CompareLine) => gapTotal(b) - gapTotal(a) },
  less: { label: "WMS paling kurang", cmp: (a: CompareLine, b: CompareLine) => gapTotal(a) - gapTotal(b) },
  pct: { label: "Selisih % terbesar", cmp: (a: CompareLine, b: CompareLine) => gapPct(b) - gapPct(a) },
  sap: { label: "Stok SAP terbanyak", cmp: (a: CompareLine, b: CompareLine) => sapTotal(b) - sapTotal(a) },
  sku: { label: "SKU", cmp: () => 0 },
} as const;
export type SortKey = keyof typeof SORTS;

/** |gap| as a share of SAP's stock; a SKU SAP does not hold counts as 100%. */
export function gapPct(l: CompareLine): number {
  const g = Math.abs(gapTotal(l));
  if (!g) return 0;
  const s = sapTotal(l);
  return s > 0 ? (100 * g) / s : 100;
}

export function filterLines(lines: CompareLine[], filter: FilterKey, query: string, sort: SortKey, uom = ""): CompareLine[] {
  const q = query.trim().toLowerCase();
  return lines
    .filter((l) => FILTERS[filter].test(l))
    .filter((l) => !uom || (l.sap_uom || l.wms_uom) === uom)
    .filter((l) => !q || l.sku.includes(q) || (l.description ?? "").toLowerCase().includes(q))
    .sort((a, b) => SORTS[sort].cmp(a, b) || a.sku.localeCompare(b.sku));
}

export type CompareStats = {
  skus: number; match: number; more: number; less: number; onlySap: number; onlyWms: number; open: number;
  sapQty: number; wmsQty: number; moreQty: number; lessQty: number; timingQty: number; otherQty: number;
  /** SKUs that match, out of all. */
  skuAccuracy: number | null;
  /** 1 - sum|gap| / SAP stock: how much of SAP's stock we can account for, carton for carton. */
  qtyAccuracy: number | null;
};
export function compareStats(lines: CompareLine[]): CompareStats {
  const s: CompareStats = { skus: lines.length, match: 0, more: 0, less: 0, onlySap: 0, onlyWms: 0, open: 0, sapQty: 0, wmsQty: 0,
    moreQty: 0, lessQty: 0, timingQty: 0, otherQty: 0, skuAccuracy: null, qtyAccuracy: null };
  let absGap = 0;
  for (const l of lines) {
    const g = gapTotal(l), f = flags(l);
    s.sapQty += sapTotal(l); s.wmsQty += wmsTotal(l); s.timingQty += timingTotal(l); s.otherQty += otherTotal(l);
    if (!hasGap(l)) s.match++;
    if (g > 0) { s.more++; s.moreQty += g; }
    if (g < 0) { s.less++; s.lessQty += -g; }
    absGap += Math.abs(gapUnrestricted(l)) + Math.abs(gapBlocked(l));
    if (f.includes("ONLY_SAP")) s.onlySap++;
    if (f.includes("ONLY_WMS")) s.onlyWms++;
    if (FILTERS.open.test(l)) s.open++;
  }
  s.skuAccuracy = s.skus ? (100 * s.match) / s.skus : null;
  s.qtyAccuracy = s.sapQty ? Math.max(0, 100 * (1 - absGap / s.sapQty)) : null;
  return s;
}

/**
 * A likely explanation the numbers alone suggest. Shown as a hint; the
 * person still picks the cause.
 */
export function hint(l: CompareLine): { cause: CauseCode; text: string } | null {
  const g = gapTotal(l);
  if (!g) return null;
  const f = flags(l);
  if (f.includes("UOM")) return { cause: "UOM", text: `Satuan SAP ${l.sap_uom} beda dengan WMS ${l.wms_uom}: cek konversi sebelum hitung ulang.` };
  const other = Object.entries(l.sap_other ?? {}).filter(([, v]) => n(v) > 0);
  const otherQty = other.reduce((s, [, v]) => s + n(v), 0);
  if (g > 0 && otherQty > 0) {
    const where = other.map(([k, v]) => `${k} ${n(v)}`).join(", ");
    // RETN is SAP's returns location; anything else (INBD) is stock not yet booked into the warehouse.
    const cause: CauseCode = other.every(([k]) => k.startsWith("RET")) ? "RETURN" : "SAP_INBOUND";
    return otherQty === g
      ? { cause, text: `Lebih ${g} = persis stok SAP di ${where}: barangnya ada di sini, di SAP tercatat di lokasi lain.` }
      : { cause, text: `SAP punya ${where} di luar lokasi yang dihitung: sebagian dari lebih ${g} mungkin barang itu.` };
  }
  if (f.includes("STATUS")) return { cause: "DAMAGED", text: "Total sama arah beda: stok bebas vs blok tidak sama dengan SAP. Cek hold / karantina." };
  if (f.includes("NO_MASTER")) return { cause: "OTHER", text: "SKU tidak ada di master item WMS: tambahkan dulu di master." };
  if (f.includes("ONLY_SAP")) return { cause: "COUNT", text: "SAP punya stok, WMS kosong: cari fisiknya atau cek apakah sudah dikirim." };
  if (f.includes("ONLY_WMS")) return { cause: "PENDING_GR", text: "WMS punya stok, SAP kosong: kemungkinan belum GR di SAP." };
  return null;
}

/** Explained differences per cause (lines and |cartons|), biggest first. */
export function causeBreakdown(lines: CompareLine[]): { cause: CauseCode | null; lines: number; qty: number }[] {
  const m = new Map<CauseCode | null, { lines: number; qty: number }>();
  for (const l of lines) {
    if (!hasGap(l)) continue;
    const k = l.cause ?? null;
    const e = m.get(k) ?? { lines: 0, qty: 0 };
    e.lines++; e.qty += Math.abs(gapTotal(l)); m.set(k, e);
  }
  return [...m].map(([cause, v]) => ({ cause, ...v })).sort((a, b) => b.qty - a.qty);
}

/** "+5" / "-3" / "0", from our side. */
export const signed = (v: number) => (v > 0 ? `+${v.toLocaleString("id-ID")}` : v.toLocaleString("id-ID"));

/**
 * Our side of the comparison is our stock at a cut-off (0112), not at the
 * moment the reconciliation is made: today's picks must not count against
 * a morning MB52. Times are WIB wall-clock, as typed in a datetime-local box.
 */
export const defaultCutoff = (asOf: string) => `${asOf}T00:00`;
/** "2026-10-28T09:45" (WIB) -> "2026-10-28T09:45:00+07:00". */
export const cutoffIso = (local: string) => `${local.length === 16 ? `${local}:00` : local}+07:00`;
/** Now in WIB, minute precision, for the box's max. */
export function nowWib(at: Date = new Date()): string {
  return new Date(at.getTime() + 7 * 3_600_000).toISOString().slice(0, 16);
}
export const isFuture = (local: string, at: Date = new Date()) => new Date(cutoffIso(local)).getTime() > at.getTime();
