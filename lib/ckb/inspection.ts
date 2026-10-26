/**
 * CKB 3PL cargo inspection — checklist shape, completeness and result. Pure, zero I/O.
 *
 * The database enforces the same rules (ckb_valid_checklist, ckb_submit_inspection in 0103); these
 * run in the browser so the inspector sees what is missing before tapping Kirim.
 */

export type ItemKind = "CHECK" | "TEXT" | "NUMBER";
export type ChecklistItem = { key: string; label: string; category?: string; required: boolean; kind: ItemKind };
export type CheckResult = "OK" | "NG" | "NA";
export type Response = { key: string; result?: CheckResult | null; value_text?: string | null; value_num?: number | null; note?: string | null };
export type InspectionStatus = "DRAFT" | "SUBMITTED" | "ACCEPTED" | "REJECTED" | "CLOSED";
export type InspectionType = "INBOUND" | "OUTBOUND" | "STORAGE" | "OTHER";
export type DamageClass = "NONE" | "MINOR" | "MAJOR" | "TOTAL_LOSS";

export const INSPECTION_STATUS: Record<InspectionStatus, { label: string; tone: "neutral" | "info" | "ok" | "warn" | "bad" | "muted" }> = {
  DRAFT: { label: "Draf", tone: "neutral" },
  SUBMITTED: { label: "Menunggu review", tone: "warn" },
  ACCEPTED: { label: "Diterima", tone: "ok" },
  REJECTED: { label: "Ditolak", tone: "bad" },
  CLOSED: { label: "Ditutup", tone: "muted" },
};
export const INSPECTION_TYPE: Record<InspectionType, string> = {
  INBOUND: "Barang masuk", OUTBOUND: "Barang keluar", STORAGE: "Di gudang", OTHER: "Lainnya",
};
export const DAMAGE_CLASS: Record<DamageClass, string> = {
  NONE: "Tidak ada kerusakan", MINOR: "Ringan", MAJOR: "Berat", TOTAL_LOSS: "Rusak total",
};

/** Mirror of public.ckb_valid_checklist: null when valid, else the first problem. */
export function checklistError(items: unknown): string | null {
  if (!Array.isArray(items) || items.length === 0) return "Checklist minimal satu butir.";
  if (items.length > 100) return "Checklist maksimal 100 butir.";
  const keys = new Set<string>();
  for (const [i, raw] of items.entries()) {
    const it = raw as Partial<ChecklistItem>;
    const n = i + 1;
    if (typeof it.key !== "string" || !/^[a-z0-9_]{1,40}$/.test(it.key)) return `Butir ${n}: kunci hanya huruf kecil, angka dan _ .`;
    if (keys.has(it.key)) return `Butir ${n}: kunci "${it.key}" dipakai dua kali.`;
    keys.add(it.key);
    if (typeof it.label !== "string" || it.label.trim().length < 2) return `Butir ${n}: label wajib diisi.`;
    if (it.kind !== "CHECK" && it.kind !== "TEXT" && it.kind !== "NUMBER") return `Butir ${n}: jenis harus CHECK, TEXT atau NUMBER.`;
    if (typeof it.required !== "boolean") return `Butir ${n}: wajib/tidak harus dipilih.`;
  }
  return null;
}

/** Turn a label into a stable key for a new checklist item. */
export function keyFromLabel(label: string, taken: Set<string>): string {
  const base = label.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32) || "butir";
  let k = base, n = 2;
  while (taken.has(k)) k = `${base}_${n++}`;
  return k;
}

const answered = (item: ChecklistItem, r: Response | undefined): boolean => {
  if (!r) return false;
  if (item.kind === "CHECK") return !!r.result;
  if (item.kind === "TEXT") return !!r.value_text && r.value_text.trim() !== "";
  return typeof r.value_num === "number" && Number.isFinite(r.value_num);
};

/** What still blocks submitting, in the order the inspector should fix it. Empty = ready. */
export function submitProblems(i: {
  checklist: ChecklistItem[]; responses: Response[]; photoCount: number; requirePhotoOnNg: boolean;
  damageClass: DamageClass; findings: string | null;
}): string[] {
  const byKey = new Map(i.responses.map((r) => [r.key, r]));
  const out: string[] = [];
  const missing = i.checklist.filter((it) => it.required && !answered(it, byKey.get(it.key))).map((it) => it.label);
  if (missing.length) out.push(`Butir wajib belum diisi: ${missing.join(", ")}.`);
  const ng = i.responses.filter((r) => r.result === "NG");
  if (ng.some((r) => !r.note || r.note.trim() === "")) out.push("Setiap butir NG wajib diberi catatan.");
  if (ng.length && i.requirePhotoOnNg && i.photoCount === 0) out.push("Ada butir NG: unggah minimal satu foto bukti.");
  if (ng.length && i.damageClass === "NONE" && !(i.findings ?? "").trim()) out.push("Ada butir NG: isi temuan atau kelas kerusakan.");
  return out;
}

/** PASS unless any answer is NG (same rule as ckb_submit_inspection). */
export const inspectionResult = (responses: Response[]): "PASS" | "FAIL" =>
  responses.some((r) => r.result === "NG") ? "FAIL" : "PASS";
