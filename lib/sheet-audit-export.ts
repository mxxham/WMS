import { PICK_ERROR_LABEL, type PickError } from "@/lib/pick-audit";

/**
 * A picking audit as spreadsheet rows, from the WMS file (0029-0032) or from
 * the system's pick tasks (0024-0032): one row per bin + SKU (what the rack
 * walk checks), one per pick line, and every attempt as history (corrections
 * included). `sisaLabel` names what the rack count was compared with.
 */
export type ExportLine = {
  id: string; shipment_number: string; wave_no: string | null; picklist: string | null; seq: number;
  bin_code: string; sku: string; description: string; uom: string | null; batch: string; expiry: string | null;
  qty: number; bin_remaining: number | null; line_state: "TODO" | "OK" | "MISMATCH" | "RESOLVED" | "AUTO_PASS";
};
export type ExportAttempt = {
  line_id: string; attempt_no: number; checker_name: string; method: "STAGING" | "RACK"; result: "OK" | "MISMATCH";
  errors: PickError[]; counted_qty: number; found_sku: string; found_batch: string; rack_system: number | null;
  rack_counted: number | null; note: string | null; correction: boolean; created_at: string;
};
type Row = Record<string, string | number | null>;

const STATE: Record<ExportLine["line_state"], string> = {
  TODO: "Belum diaudit", OK: "OK", MISMATCH: "Selisih", RESOLVED: "Diterima supervisor", AUTO_PASS: "Tidak dipick (0)",
};

/** 'YYYY-MM-DD HH:mm' in Jakarta time. */
export function jakartaTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("sv-SE", { timeZone: "Asia/Jakarta" }).slice(0, 16);
}
const errorText = (errors: PickError[]) => errors.map((e) => PICK_ERROR_LABEL[e] ?? e).join(", ");
const zoneOf = (bin: string) => (/^[A-Z]{2}\d{2}[A-Z]\d{2}$/.test(bin) ? bin.slice(0, 2) : bin);

export function auditWorkbookRows(lines: ExportLine[], attempts: ExportAttempt[], sisaLabel = "Sisa di file"): { bins: Row[]; lines: Row[]; history: Row[] } {
  const byLine = new Map<string, ExportAttempt[]>();
  for (const a of [...attempts].sort((x, y) => x.attempt_no - y.attempt_no)) byLine.set(a.line_id, [...(byLine.get(a.line_id) ?? []), a]);
  const lastOf = (id: string) => byLine.get(id)?.at(-1);
  const lineById = new Map(lines.map((l) => [l.id, l]));

  // Per bin + SKU: the latest count of any of its lines.
  const groups = new Map<string, ExportLine[]>();
  for (const l of lines) groups.set(`${l.bin_code}|${l.sku}`, [...(groups.get(`${l.bin_code}|${l.sku}`) ?? []), l]);
  const bins: Row[] = [...groups.values()].map((ls) => {
    const l = ls[0];
    const last = ls.map((x) => lastOf(x.id)).filter((a): a is ExportAttempt => !!a).sort((a, b) => a.created_at.localeCompare(b.created_at)).at(-1);
    const remaining = ls.map((x) => x.bin_remaining).filter((n): n is number => n !== null);
    // The system count compares with the bin's stock at count time, kept on the attempt.
    const sisa = remaining.length ? Math.min(...remaining) : last?.method === "RACK" ? last.rack_system : null;
    const state = ls.some((x) => x.line_state === "MISMATCH") ? "MISMATCH" : ls.some((x) => x.line_state === "TODO") ? "TODO" : "OK";
    const counted = last?.method === "RACK" ? last.rack_counted : null;
    return {
      Rak: zoneOf(l.bin_code), Bin: l.bin_code, SKU: l.sku, Deskripsi: l.description, UOM: l.uom,
      Shipment: [...new Set(ls.map((x) => x.shipment_number))].join(", "), Baris: ls.length,
      "Qty pick": ls.reduce((s, x) => s + Number(x.qty), 0), [sisaLabel]: sisa, "Sisa dihitung": counted,
      Selisih: counted !== null && sisa !== null ? Number(counted) - sisa : null,
      "Barang ditemukan": last && last.found_sku !== l.sku ? last.found_sku : null,
      Status: STATE[state as ExportLine["line_state"]], Checker: last?.checker_name ?? null, Waktu: jakartaTime(last?.created_at ?? null),
      Catatan: last?.note ?? null, Diubah: ls.some((x) => byLine.get(x.id)?.some((a) => a.correction)) ? "Ya" : null,
    };
  }).sort((a, b) => String(a.Rak).localeCompare(String(b.Rak)) || String(a.Bin).localeCompare(String(b.Bin)));

  const lineRows: Row[] = [...lines].sort((a, b) => a.shipment_number.localeCompare(b.shipment_number) || a.seq - b.seq).map((l) => {
    const last = lastOf(l.id);
    return {
      Shipment: l.shipment_number, NO: l.wave_no, Picklist: l.picklist, Seq: l.seq, Bin: l.bin_code, SKU: l.sku, Deskripsi: l.description,
      Batch: l.batch, Expired: l.expiry, "Qty pick": Number(l.qty), Status: STATE[l.line_state], Error: last ? errorText(last.errors) : null,
      "Dihitung (baris)": last ? Number(last.counted_qty) : null, Checker: last?.checker_name ?? null, Waktu: jakartaTime(last?.created_at ?? null),
      Catatan: last?.note ?? null, Audit: byLine.get(l.id)?.length ?? 0,
    };
  });

  const history: Row[] = [...attempts].sort((a, b) => a.created_at.localeCompare(b.created_at)).map((a) => {
    const l = lineById.get(a.line_id);
    return {
      Waktu: jakartaTime(a.created_at), Bin: l?.bin_code ?? null, SKU: l?.sku ?? null, Shipment: l?.shipment_number ?? null,
      "Audit ke": a.attempt_no, Checker: a.checker_name, Cara: a.method === "RACK" ? "Per rak" : "Per shipment",
      Hasil: a.result === "OK" ? "OK" : "Selisih", Error: errorText(a.errors), [sisaLabel]: a.rack_system, "Sisa dihitung": a.rack_counted,
      "Dihitung (baris)": Number(a.counted_qty), Ditemukan: a.found_sku, Catatan: a.note, Ubah: a.correction ? "Ya" : null,
    };
  });
  return { bins, lines: lineRows, history };
}
