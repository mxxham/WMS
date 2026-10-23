/**
 * CKB Rebagging — pure logic library (zero I/O).
 * Status machine metadata, operation-type config, variance math, unit checks,
 * evidence kinds, and allocation preview (greedy, same algorithm as SQL posting).
 */

// ============================================================================
// Status machine
// ============================================================================

export type RebagStatus =
  | 'DRAFT'
  | 'OPEN'
  | 'IN_PROGRESS'
  | 'AWAITING_VERIFICATION'
  | 'VERIFIED'
  | 'REJECTED'
  | 'ON_HOLD'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'REVERSED';

export type RebagActionKey =
  | 'edit-sources'
  | 'edit-outputs'
  | 'start'
  | 'record'
  | 'submit'
  | 'verify'
  | 'resolve-variance'
  | 'hold'
  | 'unhold'
  | 'cancel'
  | 'approve-post'
  | 'reverse'
  | 'add-evidence';

export const REBAG_STATUSES: ReadonlyArray<{
  key: RebagStatus;
  label: string; // Indonesian UI label
  tone: 'ckb' | 'ckb-dark' | 'ckb-tint' | 'paper' | 'plate' | 'ok' | 'warn' | 'bad' | 'steel-100' | 'steel-300' | 'steel-500' | 'steel-700';
  description: string;
}> = [
  { key: 'DRAFT', label: 'Draf', tone: 'steel-300', description: 'Baru dibuat, belum siap dieksekusi' },
  { key: 'OPEN', label: 'Terbuka', tone: 'ckb-tint', description: 'Sumber & tujuan lengkap, siap dimulai' },
  { key: 'IN_PROGRESS', label: 'Sedang Berjalan', tone: 'ckb', description: 'Eksekusi dimulai, stok di-hold' },
  { key: 'AWAITING_VERIFICATION', label: 'Menunggu Verifikasi', tone: 'plate', description: 'Sudah direkam, butuh foto before/after & verifikator' },
  { key: 'VERIFIED', label: 'Terverifikasi', tone: 'ok', description: 'Verifikator menyetujui, siap posting' },
  { key: 'REJECTED', label: 'Ditolak', tone: 'bad', description: 'Verifikator menolak, bisa dikoreksi & direkam ulang' },
  { key: 'ON_HOLD', label: 'Ditahan', tone: 'warn', description: 'Ditahan supervisor, resume ke status sebelum hold' },
  { key: 'COMPLETED', label: 'Selesai', tone: 'steel-700', description: 'Posting sukses, stok berpindah, paket ACTIVE' },
  { key: 'CANCELLED', label: 'Dibatalkan', tone: 'steel-500', description: 'Dibatalkan supervisor, hold dilepaskan, tidak ada gerakan stok' },
  { key: 'REVERSED', label: 'Dibatalkan Posting', tone: 'steel-100', description: 'Posting dibalik, stok dikembalikan, paket output RETIRED' },
];

// Actions visible per status (role checks done in UI/RPC separately)
export const REBAG_ACTIONS_BY_STATUS: Readonly<Record<RebagStatus, RebagActionKey[]>> = {
  DRAFT: ['edit-sources', 'edit-outputs', 'start', 'cancel', 'add-evidence'],
  OPEN: ['edit-sources', 'edit-outputs', 'start', 'cancel', 'add-evidence'],
  IN_PROGRESS: ['record', 'hold', 'cancel', 'add-evidence'],
  AWAITING_VERIFICATION: ['hold', 'resolve-variance', 'cancel', 'add-evidence'],
  VERIFIED: ['approve-post', 'hold', 'cancel', 'add-evidence'],
  REJECTED: ['record', 'hold', 'cancel', 'add-evidence'],
  ON_HOLD: ['unhold', 'cancel', 'add-evidence'],
  COMPLETED: ['reverse', 'add-evidence'],
  CANCELLED: ['add-evidence'],
  REVERSED: ['add-evidence'],
};

// Valid transitions (from -> allowed to)
export const REBAG_VALID_TRANSITIONS: Readonly<Record<RebagStatus, RebagStatus[]>> = {
  DRAFT: ['OPEN', 'CANCELLED'],
  OPEN: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['AWAITING_VERIFICATION', 'ON_HOLD', 'CANCELLED'],
  AWAITING_VERIFICATION: ['VERIFIED', 'REJECTED', 'ON_HOLD', 'CANCELLED'],
  VERIFIED: ['COMPLETED', 'ON_HOLD', 'CANCELLED'],
  REJECTED: ['IN_PROGRESS', 'ON_HOLD', 'CANCELLED'],
  ON_HOLD: ['DRAFT', 'OPEN', 'IN_PROGRESS', 'AWAITING_VERIFICATION', 'VERIFIED', 'REJECTED', 'CANCELLED'],
  COMPLETED: ['REVERSED'],
  CANCELLED: [],
  REVERSED: [],
};

// ============================================================================
// Operation types
// ============================================================================

export type OperationType = 'DAMAGE_REBAG' | 'SPLIT' | 'RELABEL' | 'COMBINE';

export const OPERATION_TYPES: ReadonlyArray<{
  key: OperationType;
  label: string;
  description: string;
  emphasizes: string[]; // field names the UI should highlight
}> = [
  {
    key: 'DAMAGE_REBAG',
    label: 'Rebag Kerusakan',
    description: 'Kemasan rusak → pindah ke kemasan baru, kuantitas bisa berkurang (kerugian)',
    emphasizes: ['variance_reason', 'variance_note', 'evidence'],
  },
  {
    key: 'SPLIT',
    label: 'Pecah Paket',
    description: 'Satu paket besar → beberapa paket kecil, total kuantitas sama',
    emphasizes: ['pkg_count', 'output_lines'],
  },
  {
    key: 'RELABEL',
    label: 'Ganti Label',
    description: 'Hanya ganti identitas label/paket, stok tidak berubah, paket lama RETIRED',
    emphasizes: ['package_no', 'lineage'],
  },
  {
    key: 'COMBINE',
    label: 'Gabung Paket',
    description: 'Beberapa paket → satu paket besar, total kuantitas sama',
    emphasizes: ['source_lines', 'output_qty'],
  },
];

// ============================================================================
// Variance & units
// ============================================================================

/** Variance = inputQty - outputQty (positive = loss, negative = gain — both require review). */
export function computeVariance(inputQty: number, outputQty: number): number {
  return Number(inputQty) - Number(outputQty);
}

/** All lines must share the exact same unit string (case and space sensitive). */
export function unitsCompatible(lines: ReadonlyArray<{ unit: string }>): boolean {
  if (lines.length === 0) return true;
  const first = lines[0].unit;
  return lines.every((l) => l.unit === first);
}

// ============================================================================
// Evidence kinds
// ============================================================================

export type EvidenceKind = 'BEFORE' | 'AFTER' | 'OTHER';

export const EVIDENCE_KIND_LABELS: Readonly<Record<EvidenceKind, string>> = {
  BEFORE: 'Sebelum',
  AFTER: 'Sesudah',
  OTHER: 'Lainnya',
};

/** Returns { before: boolean, after: boolean } — both must be true to submit. */
export function evidenceGate(evidenceKinds: ReadonlyArray<EvidenceKind>): { before: boolean; after: boolean } {
  const set = new Set(evidenceKinds);
  return { before: set.has('BEFORE'), after: set.has('AFTER') };
}

/** True iff the job has never been posted (posted_at IS NULL) and is not in a terminal posted state. */
export function isRebagDeletable(j: { posted_at: string | null; status: RebagStatus }): boolean {
  return j.posted_at === null && j.status !== 'COMPLETED' && j.status !== 'REVERSED';
}

// ============================================================================
// Allocation preview (greedy: sources in line_no order, outputs in line_no order)
// ============================================================================

export interface AllocSource {
  lineNo: number;
  quantity: number;
}

export interface AllocOutput {
  lineNo: number;
  quantity: number;
  binCode: string;
}

export interface AllocPair {
  sourceLineNo: number;
  outputLineNo: number;
  quantity: number;
  sameBin: boolean; // source bin == output bin
  crossBin: boolean; // source bin != output bin
}

export interface AllocationPreviewResult {
  pairs: AllocPair[];
  unallocatedSources: AllocSource[]; // sources with remaining qty
  unfilledOutputs: AllocOutput[]; // outputs with remaining qty
}

/**
 * Greedy allocation preview matching the SQL posting algorithm:
 * - Sources sorted by line_no ascending
 * - Outputs sorted by line_no ascending
 * - Fill each output from the earliest remaining source
 * - Returns per-pair quantities and sameBin/crossBin flags (binCode comparison)
 */
export function allocatePreview(
  sources: ReadonlyArray<AllocSource & { binCode: string }>,
  outputs: ReadonlyArray<AllocOutput>
): AllocationPreviewResult {
  // Clone and sort
  const src = [...sources].sort((a, b) => a.lineNo - b.lineNo);
  const out = [...outputs].sort((a, b) => a.lineNo - b.lineNo);

  // Mutable remaining quantities
  const srcRem = src.map((s) => ({ ...s, rem: s.quantity }));
  const outRem = out.map((o) => ({ ...o, rem: o.quantity }));

  const pairs: AllocPair[] = [];

  let si = 0;
  for (const o of outRem) {
    while (o.rem > 0 && si < srcRem.length) {
      const s = srcRem[si];
      if (s.rem <= 0) {
        si++;
        continue;
      }
      const qty = Math.min(s.rem, o.rem);
      pairs.push({
        sourceLineNo: s.lineNo,
        outputLineNo: o.lineNo,
        quantity: qty,
        sameBin: s.binCode === o.binCode,
        crossBin: s.binCode !== o.binCode,
      });
      s.rem -= qty;
      o.rem -= qty;
      if (s.rem <= 0) si++;
    }
  }

  const unallocatedSources = srcRem.filter((s) => s.rem > 0).map((s) => ({ lineNo: s.lineNo, quantity: s.rem }));
  const unfilledOutputs = outRem.filter((o) => o.rem > 0).map((o) => ({ lineNo: o.lineNo, quantity: o.rem, binCode: o.binCode }));

  return { pairs, unallocatedSources, unfilledOutputs };
}