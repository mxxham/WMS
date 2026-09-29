import { jakartaTime } from "@/lib/sheet-audit-export";

/**
 * The putaway audit of a day (0012 / 0027 / 0028) as spreadsheet rows: one row
 * per putaway with its latest audit, and every audit as history (an audit
 * saved again, e.g. after Ubah, keeps the earlier results in `history`).
 */
export type PutawayExport = {
  movement_id: string; created_at: string; by: string | null; type: "putaway" | "inbound";
  from_bin: string | null; to_bin: string; sku: string; description: string; uom: string | null;
  batch_lot: string; expiry_date: string | null; quantity: number;
  audit: { result: "OK" | "MISMATCH"; counted: number; foundSku: string | null; foundBatch: string | null;
           checker: string | null; note: string | null; at: string; attempts: number } | null;
};
export type PutawayHistory = {
  movement_id: string;
  entries: { result: string; counted_qty: number; found_sku: string | null; found_batch: string | null;
             checker_name: string | null; note: string | null; audited_at: string }[];
};
type Row = Record<string, string | number | null>;

const zoneOf = (bin: string) => (/^[A-Z]{2}\d{2}[A-Z]\d{2}$/.test(bin) ? bin.slice(0, 2) : bin);

export function putawayWorkbookRows(rows: PutawayExport[], history: PutawayHistory[]): { putaway: Row[]; history: Row[] } {
  const sorted = [...rows].sort((a, b) => a.to_bin.localeCompare(b.to_bin) || a.created_at.localeCompare(b.created_at));
  const putaway: Row[] = sorted.map((r) => ({
    Rak: zoneOf(r.to_bin), Bin: r.to_bin, SKU: r.sku, Deskripsi: r.description, Batch: r.batch_lot, Expired: r.expiry_date,
    Qty: Number(r.quantity), UOM: r.uom, Asal: r.type === "inbound" ? "Terima baru" : r.from_bin, "Putaway oleh": r.by,
    "Waktu putaway": jakartaTime(r.created_at),
    Status: !r.audit ? "Belum diaudit" : r.audit.result === "OK" ? "OK" : "Selisih",
    "SKU ditemukan": r.audit && r.audit.foundSku !== r.sku ? r.audit.foundSku : null,
    "Batch ditemukan": r.audit && (r.audit.foundBatch ?? "") !== (r.batch_lot ?? "").toUpperCase().replace(/\s/g, "") ? r.audit.foundBatch : null,
    Dihitung: r.audit ? Number(r.audit.counted) : null,
    Selisih: r.audit ? Number(r.audit.counted) - Number(r.quantity) : null,
    Checker: r.audit?.checker ?? null, "Waktu audit": jakartaTime(r.audit?.at ?? null), Catatan: r.audit?.note ?? null,
    Audit: r.audit?.attempts ?? 0,
  }));

  const byId = new Map(rows.map((r) => [r.movement_id, r]));
  const past: Row[] = history.flatMap((h) => h.entries.map((e) => ({ h, e })))
    .map(({ h, e }) => ({ r: byId.get(h.movement_id), e }))
    .filter((x) => !!x.r)
    .map(({ r, e }) => ({
      Waktu: jakartaTime(e.audited_at), Bin: r!.to_bin, SKU: r!.sku, Hasil: e.result === "OK" ? "OK" : "Selisih",
      Dihitung: Number(e.counted_qty), Ditemukan: e.found_sku, "Batch ditemukan": e.found_batch, Checker: e.checker_name, Catatan: e.note,
      Keterangan: "diganti audit berikutnya",
    }));
  const latest: Row[] = sorted.filter((r) => r.audit).map((r) => ({
    Waktu: jakartaTime(r.audit!.at), Bin: r.to_bin, SKU: r.sku, Hasil: r.audit!.result === "OK" ? "OK" : "Selisih",
    Dihitung: Number(r.audit!.counted), Ditemukan: r.audit!.foundSku, "Batch ditemukan": r.audit!.foundBatch, Checker: r.audit!.checker,
    Catatan: r.audit!.note, Keterangan: "terakhir",
  }));
  return { putaway, history: [...past, ...latest].sort((a, b) => String(a.Waktu).localeCompare(String(b.Waktu))) };
}
