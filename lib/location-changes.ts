/**
 * Perubahan lokasi (0130): every change of a pick's location, original bin next to the new one.
 * Pure: rows of `pick_location_change_list` in, labels and Excel rows out. No I/O.
 */

export type LocationChange = {
  id: number;
  task_id: string;
  planned_date: string;
  wave_no: string;
  shipment_number: string | null;
  task_type: "PICK" | "REPLENISH";
  sku: string;
  description: string;
  quantity: number;
  /** the bin the task was planned on, before its first change */
  original_bin: string | null;
  old_bin: string | null;
  new_bin: string | null;
  old_batch: string;
  new_batch: string;
  old_expiry: string | null;
  new_expiry: string | null;
  old_to_bin: string | null;
  new_to_bin: string | null;
  kind: "PLAN" | "ACTUAL";
  source: "TRIGGER" | "LOG";
  reason: string | null;
  changed_by_name: string | null;
  changed_at: string;
  fefo_skipped: boolean | null;
  /** the change came from Audit picking (terima batch lain, 0088), not from the picker */
  via_audit: boolean | null;
  wave_status: string | null;
};

export type ChangeAction =
  | "UBAH_BARIS" | "UBAH_BIN" | "PINDAH_SISA" | "IKUT_PALET" | "ISI_PICKLIST" | "DIPICK_LAIN" | "AUDIT" | "LAINNYA";

export const ACTION_LABEL: Record<ChangeAction, string> = {
  UBAH_BARIS: "Ubah baris",
  UBAH_BIN: "Ubah bin pick",
  PINDAH_SISA: "Pindah sisa",
  IKUT_PALET: "Ikut palet",
  ISI_PICKLIST: "Isi dari picklist",
  DIPICK_LAIN: "Dipick dari bin lain",
  AUDIT: "Audit picking",
  LAINNYA: "Lainnya",
};

/**
 * Which action made the change. The database paths each log their own sentence (0049–0127); the
 * sentence decides. A change of the actual bin is the picker's (at posting) or the auditor's.
 */
export function changeAction(c: Pick<LocationChange, "kind" | "reason" | "via_audit">): ChangeAction {
  const r = (c.reason ?? "").trim();
  if (r.startsWith("baris diubah")) return "UBAH_BARIS";
  if (r.startsWith("bin pick diubah")) return "UBAH_BIN";
  if (r.startsWith("ikut Bin To Bin")) return "PINDAH_SISA";
  if (r.startsWith("ikut palet")) return "IKUT_PALET";
  if (r.startsWith("isi dari picklist")) return "ISI_PICKLIST";
  if (c.kind === "ACTUAL") return c.via_audit ? "AUDIT" : "DIPICK_LAIN";
  return "LAINNYA";
}

/** True when the bin itself changed (not only the batch or expiry). */
export function binChanged(c: Pick<LocationChange, "old_bin" | "new_bin" | "old_to_bin" | "new_to_bin">): boolean {
  return c.old_bin !== c.new_bin || c.old_to_bin !== c.new_to_bin;
}

/** Bin + batch + expiry as one cell: "CC27D02 · 10I26JJ · 2030-09-10". */
export function locationText(bin: string | null, batch: string, expiry: string | null): string {
  return [bin ?? "–", batch || "tanpa batch", expiry ?? "–"].join(" · ");
}

/** Jakarta "YYYY-MM-DD HH:MM", independent of the machine's timezone. */
export function jakartaTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour === "24" ? "00" : p.hour}:${p.minute}`;
}

/** Print order: date, wave NO (numeric), time of change. */
export function sortChanges<T extends Pick<LocationChange, "planned_date" | "wave_no" | "changed_at" | "id">>(rows: T[]): T[] {
  const no = (w: string) => Number(w.replace(/\D/g, "")) || 0;
  return [...rows].sort((a, b) =>
    a.planned_date.localeCompare(b.planned_date) || no(a.wave_no) - no(b.wave_no) || a.wave_no.localeCompare(b.wave_no)
    || a.changed_at.localeCompare(b.changed_at) || a.id - b.id);
}

type Cell = string | number | null;

/** One Excel row per change, in the order of the table on the page. */
export function changeSheetRows(rows: LocationChange[]): Record<string, Cell>[] {
  return sortChanges(rows).map((c) => ({
    "Tanggal": c.planned_date,
    "Wave NO": c.wave_no,
    "Shipment": c.shipment_number ?? "",
    "Jenis": c.task_type === "PICK" ? "Pick" : "Bin To Bin",
    "SKU": c.sku,
    "Deskripsi": c.description,
    "Qty": Number(c.quantity),
    "Lokasi awal (rencana)": c.original_bin ?? "",
    "Bin sebelum": c.old_bin ?? "",
    "Batch sebelum": c.old_batch,
    "Exp sebelum": c.old_expiry ?? "",
    "Bin sesudah": c.new_bin ?? "",
    "Batch sesudah": c.new_batch,
    "Exp sesudah": c.new_expiry ?? "",
    "Tujuan Bin To Bin sebelum": c.old_to_bin ?? "",
    "Tujuan Bin To Bin sesudah": c.new_to_bin ?? "",
    "FEFO dilewati": c.fefo_skipped ? "YA" : "",
    "Aksi": ACTION_LABEL[changeAction(c)],
    "Diubah oleh": c.changed_by_name ?? "",
    "Waktu": jakartaTime(c.changed_at),
    "Alasan / catatan": c.reason ?? "",
    "Sumber": c.source === "LOG" ? "dari Riwayat (sebelum 0130)" : "",
  }));
}

/** Per bin: how often stock was moved away from it and onto it. Biggest first. */
export function binSummaryRows(rows: LocationChange[]): Record<string, Cell>[] {
  const m = new Map<string, { from: number; to: number; qtyFrom: number; qtyTo: number }>();
  const at = (b: string) => m.get(b) ?? (m.set(b, { from: 0, to: 0, qtyFrom: 0, qtyTo: 0 }), m.get(b)!);
  for (const c of rows) {
    if (c.old_bin === c.new_bin) continue;
    if (c.old_bin) { const s = at(c.old_bin); s.from++; s.qtyFrom += Number(c.quantity); }
    if (c.new_bin) { const s = at(c.new_bin); s.to++; s.qtyTo += Number(c.quantity); }
  }
  return [...m.entries()]
    .sort((a, b) => (b[1].from + b[1].to) - (a[1].from + a[1].to) || a[0].localeCompare(b[0]))
    .map(([bin, s]) => ({ "Bin": bin, "Dipindah dari bin ini": s.from, "Qty dari": s.qtyFrom, "Dipindah ke bin ini": s.to, "Qty ke": s.qtyTo }));
}

export function changesFileName(from: string, to: string, wave?: string | null): string {
  return `Perubahan lokasi ${from === to ? from : `${from} sd ${to}`}${wave ? ` NO ${wave}` : ""}.xlsx`;
}
