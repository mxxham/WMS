/**
 * CKB 3PL evidence files — what may be uploaded and where it is stored. Pure, zero I/O.
 *
 * The upload route (app/api/ckb/evidence) checks the declared type against the file's own first
 * bytes, so a renamed .exe is not stored as a photo, and builds the object path here. The database
 * (ckb_register_evidence, 0104) re-checks type, size and path, so a forged request cannot place a
 * file under another customer's folder.
 */

export type EvidenceEntity = "STOCKTAKE" | "COUNT_TASK" | "INSPECTION";
export type EvidenceKind = "GENERAL" | "DAMAGE" | "LABEL" | "DOCUMENT" | "DISCREPANCY";

export const EVIDENCE_ENTITIES: readonly EvidenceEntity[] = ["STOCKTAKE", "COUNT_TASK", "INSPECTION"];
export const EVIDENCE_KINDS: readonly EvidenceKind[] = ["GENERAL", "DAMAGE", "LABEL", "DOCUMENT", "DISCREPANCY"];
export const EVIDENCE_KIND_LABEL: Record<EvidenceKind, string> = {
  GENERAL: "Umum", DAMAGE: "Kerusakan", LABEL: "Label", DOCUMENT: "Dokumen", DISCREPANCY: "Selisih",
};
export const ENTITY_LABEL: Record<EvidenceEntity | "REBAGGING", string> = {
  STOCKTAKE: "Stock take", COUNT_TASK: "Tugas hitung", INSPECTION: "Inspeksi", REBAGGING: "Rebagging",
};

export const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf",
};

export type EvidencePolicy = { max_mb: number; allowed_mime: string[]; retention_days: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** The type a file's first bytes prove, or null. Only the four allowed formats are recognised. */
export function sniffMime(head: Uint8Array): string | null {
  const b = (i: number) => head[i];
  if (head.length >= 3 && b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return "image/jpeg";
  if (head.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b(i) === v)) return "image/png";
  if (head.length >= 12 && String.fromCharCode(b(0), b(1), b(2), b(3)) === "RIFF" && String.fromCharCode(b(8), b(9), b(10), b(11)) === "WEBP") return "image/webp";
  if (head.length >= 5 && String.fromCharCode(b(0), b(1), b(2), b(3), b(4)) === "%PDF-") return "application/pdf";
  return null;
}

/** null when the file may be stored; otherwise the reason (Indonesian, for the person uploading). */
export function evidenceFileError(f: { declaredMime: string; size: number; head: Uint8Array }, policy: EvidencePolicy): string | null {
  if (f.size <= 0) return "File kosong.";
  if (f.size > policy.max_mb * 1024 * 1024) return `File melebihi ${policy.max_mb} MB.`;
  const real = sniffMime(f.head);
  if (!real) return "Format file tidak dikenali. Unggah JPG, PNG, WebP atau PDF.";
  if (!policy.allowed_mime.includes(real)) return `Tipe ${real} tidak diizinkan.`;
  if (f.declaredMime && f.declaredMime !== real) return `Isi file (${real}) tidak sama dengan tipenya (${f.declaredMime}).`;
  return null;
}

/**
 * {customer}/{entity type}/{entity id}/{new uuid}.{ext} — every part generated or validated here,
 * nothing from the original file name, so no path traversal is possible.
 */
export function evidencePath(customerId: string, entity: EvidenceEntity, entityId: string, objectId: string, mime: string): string {
  if (!isUuid(customerId) || !isUuid(entityId) || !isUuid(objectId)) throw new Error("ID tidak valid");
  if (!EVIDENCE_ENTITIES.includes(entity)) throw new Error("Jenis data tidak valid");
  const ext = MIME_EXT[mime];
  if (!ext) throw new Error("Tipe file tidak valid");
  return `${customerId}/${entity}/${entityId}/${objectId}.${ext}`;
}
