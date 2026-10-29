import type { SapBookLine } from "./sap-book";

/**
 * Buku stok: SAP's book against the WMS book of one day, per SKU (spec
 * docs/superpowers/specs/2026-10-28-inventory-ledger-design.md). Only stock akhir decides `match`, as in the
 * team's `BOOK TO BOOK` sheet; awal, inbound and outbound are shown for both books.
 */

/** One row of ledger_wms_book (0116). */
export type WmsBookLine = {
  sku: string; description: string; uom: string;
  awal_unrest: number; awal_block: number;
  inbound: number;
  /** the part of inbound received straight into QUARANTINE */
  inbound_block: number;
  /** the part of inbound filed on posting date − 1 because no arrival date was recorded */
  inbound_assumed: number;
  outbound: number; q_in: number; q_out: number;
  other_unrest: number; other_block: number;
  akhir_unrest: number; akhir_block: number;
};
export type LedgerNote = { id: string; sku: string; from_date: string; note: string; closed: boolean; by_name: string; created_at: string };
export type LedgerLine = {
  sku: string; description: string; uom: string; volume_l: number | null;
  sap: SapBookLine | null; wms: WmsBookLine | null;
  /** WMS akhir − SAP akhir */
  diff_unrest: number; diff_block: number;
  match: boolean; wms_identity_ok: boolean; note: LedgerNote | null;
};
type Flow = { awal_unrest: number; awal_block: number; inbound: number; outbound: number; akhir_unrest: number; akhir_block: number };
export type Totals = Flow & { litres: Flow };
export type LedgerSummary = {
  skus: number; matching: number;
  /** 0–100, 2 decimals; null when neither book has a SKU */
  accuracy: number | null;
  /** by quantity: 1 − Σ|WMS − SAP| ÷ Σ SAP stock akhir, 0–100, 2 decimals; null without SAP stock */
  qtyAccuracy: number | null; qtyAccuracyUnrest: number | null; qtyAccuracyBlock: number | null;
  differing: number; absDiff: number; absDiffLitres: number; missingVolume: string[];
  sap: Totals; wms: Totals; inboundAssumed: number;
};

const FLOW_KEYS: (keyof Flow)[] = ["awal_unrest", "awal_block", "inbound", "outbound", "akhir_unrest", "akhir_block"];
const emptyFlow = (): Flow => ({ awal_unrest: 0, awal_block: 0, inbound: 0, outbound: 0, akhir_unrest: 0, akhir_block: 0 });
const round2 = (n: number) => Math.round(n * 100) / 100;

function identityOk(w: WmsBookLine): boolean {
  const unrest = w.awal_unrest + (w.inbound - w.inbound_block) - w.outbound + w.q_out - w.q_in + w.other_unrest;
  const block = w.awal_block + w.inbound_block + w.q_in - w.q_out + w.other_block;
  return unrest === w.akhir_unrest && block === w.akhir_block;
}

/** The note shown for a SKU on `date`: its latest row from that date or earlier, open, and the SKU still differs (or it is the note's own date). */
function noteFor(notes: LedgerNote[], date: string, match: boolean): LedgerNote | null {
  const latest = notes.filter((n) => n.from_date <= date)
    .sort((a, b) => a.from_date.localeCompare(b.from_date) || a.created_at.localeCompare(b.created_at)).at(-1);
  if (!latest || latest.closed) return null;
  return latest.from_date === date || !match ? latest : null;
}

export function compareDay(sap: SapBookLine[], wms: WmsBookLine[], volume: Map<string, number | null>, notes: LedgerNote[], date: string):
  { lines: LedgerLine[]; summary: LedgerSummary } {
  const s = new Map(sap.map((l) => [l.sku, l])), w = new Map(wms.map((l) => [l.sku, l]));
  const bySku = new Map<string, LedgerNote[]>();
  for (const n of notes) bySku.set(n.sku, [...(bySku.get(n.sku) ?? []), n]);

  const lines: LedgerLine[] = [...new Set([...s.keys(), ...w.keys()])].sort().map((sku) => {
    const a = s.get(sku) ?? null, b = w.get(sku) ?? null;
    const diff_unrest = (b?.akhir_unrest ?? 0) - (a?.akhir_unrest ?? 0);
    const diff_block = (b?.akhir_block ?? 0) - (a?.akhir_block ?? 0);
    const match = diff_unrest === 0 && diff_block === 0;
    const v = volume.get(sku);
    return {
      sku, description: a?.description || b?.description || "", uom: a?.uom || b?.uom || "",
      volume_l: v === undefined || v === null ? null : Number(v),
      sap: a, wms: b, diff_unrest, diff_block, match,
      wms_identity_ok: b ? identityOk(b) : true,
      note: noteFor(bySku.get(sku) ?? [], date, match),
    };
  });

  const totals = (pick: (l: LedgerLine) => Flow | null): Totals => {
    const t: Totals = { ...emptyFlow(), litres: emptyFlow() };
    for (const l of lines) {
      const f = pick(l);
      if (!f) continue;
      for (const k of FLOW_KEYS) {
        t[k] += f[k];
        if (l.volume_l !== null) t.litres[k] = round2(t.litres[k] + f[k] * l.volume_l);
      }
    }
    return t;
  };
  // Accuracy counts the SKUs in either book's stock akhir; a SKU at 0 in both (INBD only, or all issued
  // that day) is shown but cannot make the day look better.
  const counted = lines.filter((l) => l.sap?.akhir_unrest || l.sap?.akhir_block || l.wms?.akhir_unrest || l.wms?.akhir_block);
  const matching = counted.filter((l) => l.match).length;
  // Accuracy by quantity: how much of SAP's stock our book agrees with. 18 blocked cartons out of 59,495
  // is 99.97%, where by SKU the same 18 cartons on 4 SKUs read as 96%.
  const qtyAcc = (sapQty: number, diff: number) => (sapQty > 0 ? round2(Math.max(0, 1 - diff / sapQty) * 100) : null);
  const sapUnrest = lines.reduce((n, l) => n + (l.sap?.akhir_unrest ?? 0), 0);
  const sapBlock = lines.reduce((n, l) => n + (l.sap?.akhir_block ?? 0), 0);
  const diffUnrest = lines.reduce((n, l) => n + Math.abs(l.diff_unrest), 0);
  const diffBlock = lines.reduce((n, l) => n + Math.abs(l.diff_block), 0);
  const summary: LedgerSummary = {
    qtyAccuracy: qtyAcc(sapUnrest + sapBlock, diffUnrest + diffBlock),
    qtyAccuracyUnrest: qtyAcc(sapUnrest, diffUnrest),
    qtyAccuracyBlock: sapBlock > 0 ? qtyAcc(sapBlock, diffBlock) : diffBlock > 0 ? 0 : null,
    skus: counted.length, matching,
    accuracy: counted.length ? round2((matching / counted.length) * 100) : null,
    differing: lines.filter((l) => !l.match).length,
    absDiff: lines.reduce((n, l) => n + Math.abs(l.diff_unrest) + Math.abs(l.diff_block), 0),
    absDiffLitres: round2(lines.reduce((n, l) => n + (l.volume_l === null ? 0 : (Math.abs(l.diff_unrest) + Math.abs(l.diff_block)) * l.volume_l), 0)),
    missingVolume: lines.filter((l) => l.volume_l === null).map((l) => l.sku),
    sap: totals((l) => l.sap), wms: totals((l) => l.wms),
    inboundAssumed: wms.reduce((n, l) => n + l.inbound_assumed, 0),
  };
  return { lines, summary };
}

/** SKUs whose SAP awal (today) is not the previous day's SAP akhir (its MB52). Empty without a previous day. */
export function chainBreaks(today: SapBookLine[], previousDay: SapBookLine[] | null): string[] {
  if (!previousDay) return [];
  const t = new Map(today.map((l) => [l.sku, l])), p = new Map(previousDay.map((l) => [l.sku, l]));
  return [...new Set([...t.keys(), ...p.keys()])].sort().filter((sku) => {
    const a = t.get(sku), b = p.get(sku);
    return (a?.awal_unrest ?? 0) !== (b?.akhir_unrest ?? 0) || (a?.awal_block ?? 0) !== (b?.akhir_block ?? 0);
  });
}

/** The day as rows in the team's `BOOK TO BOOK` column order, for the Excel download. */
export function ledgerSheetRows(lines: LedgerLine[]): Record<string, string | number | null>[] {
  return lines.map((l) => {
    const a = l.sap, b = l.wms;
    const litres = (q: number) => (l.volume_l === null ? null : round2(q * l.volume_l));
    return {
      Material: l.sku, "Material Description": l.description, UOM: l.uom,
      "SAP Unrest Awal": a?.awal_unrest ?? 0, "SAP Block Awal": a?.awal_block ?? 0, "SAP Inbound": a?.inbound ?? 0,
      "SAP Outbound": a?.outbound ?? 0, "SAP Unrest Akhir": a?.akhir_unrest ?? 0, "SAP Block Akhir": a?.akhir_block ?? 0,
      "WMS Unrest Awal": b?.awal_unrest ?? 0, "WMS Block Awal": b?.awal_block ?? 0, "WMS Inbound": b?.inbound ?? 0,
      "WMS Outbound": b?.outbound ?? 0, "WMS Unrest Akhir": b?.akhir_unrest ?? 0, "WMS Block Akhir": b?.akhir_block ?? 0,
      "Selisih Unrest": l.diff_unrest, "Selisih Block": l.diff_block,
      "344 Release to Block": a?.mv344 ?? 0, "343 Block to Release": a?.mv343 ?? 0, "Z55 Write Off": a?.z55 ?? 0,
      "Karantina masuk": b?.q_in ?? 0, "Karantina keluar": b?.q_out ?? 0,
      "Lain-lain SAP": a?.other_unrest ?? 0, "Lain-lain WMS": (b?.other_unrest ?? 0) + (b?.other_block ?? 0),
      INBD: a?.inbd ?? 0, "Volume (L)": l.volume_l,
      "Selisih Unrest (L)": litres(l.diff_unrest), "Selisih Block (L)": litres(l.diff_block),
      Catatan: l.note?.note ?? null,
    };
  });
}
