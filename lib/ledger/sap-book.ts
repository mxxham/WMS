import type * as XLSX from "xlsx";
import { dateFromFileName, parseMb51, parseMb52, type Mb51Row, type Mb52Row } from "@/lib/sap-stock";
import { readSheet } from "@/lib/read-sheet";

/**
 * SAP's book of one day for Buku stok (spec docs/superpowers/specs/2026-10-28-inventory-ledger-design.md),
 * by the rules of the team's hand workbook `Book to Book SHELL_...xlsx`:
 *   akhir unrest = awal + inbound − outbound + 343 − 344 + other;  akhir block = awal + 344 − 343 − Z55.
 * The daily file "MB52 2810_28 Oktober" holds MB52 = the stock on the morning of the 28th and MB51 = the
 * movements posted on the 27th. So the file is the day of its MB51 posting date (27 Oct): akhir is MB52 as
 * printed, awal is akhir minus that day's movements.
 * Storage location WHS1 only; INBD is information.
 */
export type SapBookLine = {
  sku: string; description: string; uom: string;
  awal_unrest: number; awal_block: number;
  /** 101 and 102 (signed) + Z31 + positive 311, WHS1 */
  inbound: number;
  /** −(601 + 602 signed): positive = cartons out */
  outbound: number;
  /** positive (debit) quantities */
  mv343: number; mv344: number; z55: number;
  /** every other WHS1 movement, signed */
  other_unrest: number;
  other_by_type: Record<string, number>;
  akhir_unrest: number; akhir_block: number;
  /** INBD unrestricted + blocked */
  inbd: number;
};
export type SapBook = { date: string; lines: SapBookLine[]; mb51Count: number; inbdTotal: number };

const WHS = "WHS1";

/** "2026-10-28" -> "2026-10-27" (calendar arithmetic in UTC, no time zone involved). */
export function dayBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const INBOUND = new Set(["101", "102", "Z31"]);
const OUTBOUND = new Set(["601", "602"]);

export function sapBook(mb52: Mb52Row[], mb51: Mb51Row[], fileName: string): SapBook {
  const dates = [...new Set(mb51.map((r) => r.posting_date).filter((d): d is string => !!d))].sort();
  if (dates.length > 1) throw new Error(`File berisi lebih dari satu tanggal posting MB51: ${dates.join(", ")}`);
  const named = dateFromFileName(fileName);
  const date = dates[0] ?? (named ? dayBefore(named) : null);
  if (!date) throw new Error(`Tanggal file tidak terbaca: ${fileName}`);

  const by = new Map<string, SapBookLine>();
  const get = (sku: string, description: string, uom: string) => {
    let l = by.get(sku);
    if (!l) {
      l = { sku, description, uom, awal_unrest: 0, awal_block: 0, inbound: 0, outbound: 0, mv343: 0, mv344: 0, z55: 0,
            other_unrest: 0, other_by_type: {}, akhir_unrest: 0, akhir_block: 0, inbd: 0 };
      by.set(sku, l);
    }
    if (!l.description && description) l.description = description;
    if (!l.uom && uom) l.uom = uom;
    return l;
  };

  let inbdTotal = 0;
  for (const r of mb52) {
    if (r.sloc === WHS) {
      const l = get(r.sku, r.description, r.uom);
      l.akhir_unrest += r.unrestricted; l.akhir_block += r.blocked;
    } else if (r.sloc === "INBD") {
      get(r.sku, r.description, r.uom).inbd += r.unrestricted + r.blocked;
      inbdTotal += r.unrestricted + r.blocked;
    }
  }

  for (const r of mb51) {
    if (r.sloc !== WHS) continue;
    const l = get(r.sku, r.description, r.uom);
    const t = r.mvt_type, q = r.quantity;
    if (INBOUND.has(t) || (t === "311" && q > 0)) l.inbound += q;
    else if (OUTBOUND.has(t)) l.outbound -= q;
    else if (t === "343" || t === "344") { if (q > 0) { if (t === "343") l.mv343 += q; else l.mv344 += q; } }
    else if (t === "Z55") l.z55 -= q;
    else { l.other_unrest += q; l.other_by_type[t] = (l.other_by_type[t] ?? 0) + q; }
  }

  const lines = [...by.values()]
    .filter((l) => l.akhir_unrest || l.akhir_block || l.inbound || l.outbound || l.mv343 || l.mv344 || l.z55 || l.other_unrest || l.inbd)
    .map((l) => ({
      ...l,
      awal_unrest: l.akhir_unrest - l.inbound + l.outbound - l.mv343 + l.mv344 - l.other_unrest,
      awal_block: l.akhir_block - l.mv344 + l.mv343 + l.z55,
    }))
    .sort((a, b) => a.sku.localeCompare(b.sku));
  return { date, lines, mb51Count: mb51.length, inbdTotal };
}

/** Does any sheet carry the MB51 header (Material + Movement Type), even with no rows under it? */
function hasMb51Header(wb: XLSX.WorkBook): boolean {
  return wb.SheetNames.some((name) => readSheet(wb, name).rows.slice(0, 30).some((r) => {
    const h = r.map((c) => String(c ?? "").trim().toLowerCase());
    return h.includes("material") && (h.includes("movement type") || h.includes("mvt type"));
  }));
}

/**
 * The daily workbook as SAP exports it: `mb52` (+ `INBD`) and `mb51`. Both sheets are required; an `mb51`
 * with its header but no rows is a day without SAP movements (a Sunday or holiday), dated file name − 1.
 */
export function readSapWorkbook(wb: XLSX.WorkBook, fileName: string): SapBook {
  const stock = parseMb52(wb).rows;
  let moves: Mb51Row[];
  try { moves = parseMb51(wb).rows; } catch (e) {
    if (!hasMb51Header(wb)) throw e;
    moves = [];
  }
  return sapBook(stock, moves, fileName);
}
