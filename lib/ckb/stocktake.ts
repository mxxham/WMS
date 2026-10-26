/**
 * CKB 3PL stock take — labels, tones and the client-side mirror of the classification rule.
 * Pure, zero I/O.
 *
 * The authoritative classification is public.ckb_classify (migration 0101); the database applies
 * it to every review decision. classify() here repeats it only to explain a number on screen before
 * the server answers, and tests/ckb-stocktake.test.ts pins both to the same cases.
 */

export type StocktakeStatus = "DRAFT" | "COUNTING" | "REVIEW" | "CLOSED" | "CANCELLED";
export type TaskStatus = "OPEN" | "COUNTED" | "RECOUNT_REQUESTED" | "ACCEPTED" | "EXCLUDED";
export type Classification =
  | "MATCH" | "SHORTAGE" | "OVERAGE" | "UNEXPECTED" | "UNCOUNTED" | "AMBIGUOUS" | "BATCH_MISMATCH";
export type AdjustmentStatus = "PROPOSED" | "APPROVED" | "REJECTED" | "EXPORTED";
export type Tone = "neutral" | "info" | "ok" | "warn" | "bad" | "muted";

export const STOCKTAKE_STATUS: Record<StocktakeStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: "Draf", tone: "neutral" },
  COUNTING: { label: "Penghitungan", tone: "info" },
  REVIEW: { label: "Review", tone: "warn" },
  CLOSED: { label: "Selesai", tone: "ok" },
  CANCELLED: { label: "Dibatalkan", tone: "muted" },
};

export const TASK_STATUS: Record<TaskStatus, { label: string; tone: Tone }> = {
  OPEN: { label: "Belum dihitung", tone: "neutral" },
  COUNTED: { label: "Sudah dihitung", tone: "info" },
  RECOUNT_REQUESTED: { label: "Hitung ulang", tone: "warn" },
  ACCEPTED: { label: "Diterima", tone: "ok" },
  EXCLUDED: { label: "Dikecualikan", tone: "muted" },
};

export const CLASSIFICATION: Record<Classification | "COUNTED", { label: string; tone: Tone; hint: string }> = {
  MATCH: { label: "Cocok", tone: "ok", hint: "Hitungan sama dengan snapshot SAP." },
  SHORTAGE: { label: "Kurang", tone: "bad", hint: "Fisik lebih sedikit dari SAP." },
  OVERAGE: { label: "Lebih", tone: "warn", hint: "Fisik lebih banyak dari SAP." },
  UNEXPECTED: { label: "Barang temuan", tone: "warn", hint: "Ada di lantai, tidak ada di snapshot." },
  UNCOUNTED: { label: "Belum dihitung", tone: "neutral", hint: "Belum ada hitungan. Kosong bukan nol." },
  AMBIGUOUS: { label: "Identitas ganda", tone: "bad", hint: "Beberapa baris SAP dengan identitas sama: hitung ulang atau kecualikan." },
  BATCH_MISMATCH: { label: "Batch/expiry beda", tone: "bad", hint: "Batch atau expiry fisik tidak sama: hitung ulang atau kecualikan." },
  COUNTED: { label: "Sudah dihitung", tone: "info", hint: "Hitungan buta: selisih tidak ditampilkan." },
};

export const ADJUSTMENT_STATUS: Record<AdjustmentStatus, { label: string; tone: Tone }> = {
  PROPOSED: { label: "Menunggu persetujuan", tone: "warn" },
  APPROVED: { label: "Disetujui", tone: "ok" },
  REJECTED: { label: "Ditolak", tone: "bad" },
  EXPORTED: { label: "Sudah diekspor", tone: "info" },
};

export const SCOPE_LABEL = { FULL: "Semua stok", BINS: "Bin terpilih", MATERIALS: "Material terpilih" } as const;

/** Mirror of public.ckb_classify. `qty` null = no count yet. */
export function classify(i: {
  origin: "BASELINE" | "FOUND"; identityIssue: string | null; baseline: number;
  qty: number | null; batchOk: boolean | null; expiryOk: boolean | null;
}): Classification {
  if (i.qty === null) return "UNCOUNTED";
  if (i.identityIssue) return "AMBIGUOUS";
  if (i.origin === "FOUND") return "UNEXPECTED";
  if (i.batchOk === false || i.expiryOk === false) return "BATCH_MISMATCH";
  if (i.qty === i.baseline) return "MATCH";
  return i.qty < i.baseline ? "SHORTAGE" : "OVERAGE";
}

/** Accepted count minus baseline; null while nothing was counted. */
export const variance = (baseline: number, qty: number | null): number | null => (qty === null ? null : qty - baseline);

/** Classifications that may be accepted into an adjustment (the others need a recount or exclusion). */
export const ACCEPTABLE: readonly Classification[] = ["MATCH", "SHORTAGE", "OVERAGE", "UNEXPECTED"];

/** Which review buttons a task gets in a REVIEW session. Mirrors the guards in ckb_decide_task. */
export function reviewActions(task: { status: TaskStatus; classification: string | null; countTotal: number }): ("ACCEPT" | "RECOUNT" | "EXCLUDE")[] {
  if (task.status === "ACCEPTED" || task.status === "EXCLUDED") return [];
  if (task.status === "RECOUNT_REQUESTED") return ["EXCLUDE"];
  const out: ("ACCEPT" | "RECOUNT" | "EXCLUDE")[] = [];
  if (task.countTotal > 0 && ACCEPTABLE.includes(task.classification as Classification)) out.push("ACCEPT");
  out.push("RECOUNT", "EXCLUDE");
  return out;
}

/** Can a counter submit for this task right now? Mirrors ckb_submit_count. */
export function countOpen(session: StocktakeStatus, task: TaskStatus): boolean {
  return (session === "COUNTING" && (task === "OPEN" || task === "COUNTED" || task === "RECOUNT_REQUESTED"))
    || (session === "REVIEW" && task === "RECOUNT_REQUESTED");
}

/**
 * Parse a quantity typed on the phone. Empty is "not counted", never zero. The decimal separator
 * is a comma only: "1.234" means one thousand in Indonesian and 1.234 in English, so a dot is refused.
 */
export function parseCountInput(raw: string): { qty: number } | { error: string } | null {
  const s = raw.trim();
  if (s === "") return null;
  if (/^\d+\.\d+$/.test(s) || /^\d{1,3}(\.\d{3})+$/.test(s)) return { error: "Jangan pakai titik. Desimal pakai koma (12,5); ribuan tanpa pemisah (1234)." };
  if (!/^\d+(,\d+)?$/.test(s)) return { error: "Isi angka 0 atau lebih." };
  return { qty: Number(s.replace(",", ".")) };
}
