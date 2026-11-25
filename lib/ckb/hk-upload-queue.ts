/**
 * The housekeeping offline photo queue: pure rules (zero I/O). A photo taken without signal is kept on the phone and sent
 * when the signal returns. The storage (IndexedDB) and the sending live in hk-upload-db.ts and hk-upload-runner.ts; this file
 * only decides what to send next, how long to wait, and what an answer from the server means.
 */
import type { HkPhotoKind } from "@/lib/ckb/housekeeping";

export type QueueState = "PENDING" | "FAILED";
export type QueueMeta = {
  id: string; checkinId: string; kind: HkPhotoKind; createdAt: number;
  attempts: number;
  /** a request was started and no answer arrived: the server may already have the photo */
  maybeSent: boolean;
  state: QueueState; error: string | null;
  /** earliest time (ms) to try again */
  nextAt: number;
};
export type Outcome = "DONE" | "RETRY" | "FAILED";

const DUPLICATE = /sudah pernah dipakai/i;
const TIMED = /baru bisa diambil/i;

/**
 * What an answer means. `status` is null when there was no answer at all (offline, dropped). The server refuses a file it already
 * holds (same SHA-256): after a lost answer that means the first try worked, so it counts as sent; for a photo that never left the
 * phone it is a real refusal and the person must take a new one.
 */
export function classify(r: { status: number | null; error?: string | null; maybeSent: boolean }): { outcome: Outcome; message: string | null } {
  const { status, error, maybeSent } = r;
  if (status === null) return { outcome: "RETRY", message: "Belum ada sinyal. Foto tersimpan di ponsel dan dikirim otomatis." };
  if (status >= 200 && status < 300) return { outcome: "DONE", message: null };
  if (status === 401 || status === 403) return { outcome: "RETRY", message: "Sesi berakhir. Masuk lagi: foto tetap tersimpan di ponsel." };
  if (status >= 500 || status === 408 || status === 429) return { outcome: "RETRY", message: "Server sibuk. Dicoba lagi otomatis." };
  if (status === 400 && error && DUPLICATE.test(error) && maybeSent) return { outcome: "DONE", message: null };
  if (error && TIMED.test(error)) return { outcome: "RETRY", message: error };
  return { outcome: "FAILED", message: error ?? "Foto ditolak." };
}

/** Wait before the next try: 5 s, 10 s, 20 s ... capped at 5 minutes. */
export const backoffMs = (attempts: number): number => Math.min(300_000, 5_000 * 2 ** Math.min(Math.max(attempts, 0), 6));

/**
 * The next photo to send. Photos of one check-in go strictly in the order they were taken (the after photo needs the before photo
 * first), so only the oldest photo of each check-in is eligible, and a refused one holds back the rest of its check-in until it is
 * removed. Across check-ins the oldest goes first.
 */
export function nextToSend(items: readonly QueueMeta[], now: number): QueueMeta | null {
  const heads = new Map<string, QueueMeta>();
  for (const it of [...items].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))) if (!heads.has(it.checkinId)) heads.set(it.checkinId, it);
  const ready = [...heads.values()].filter((h) => h.state === "PENDING" && h.nextAt <= now).sort((a, b) => a.createdAt - b.createdAt);
  return ready[0] ?? null;
}

/** Photos waiting for a check-in (of a kind): they count toward the per-kind maximum like uploaded ones. */
export const queuedCount = (items: readonly QueueMeta[], checkinId: string, kind?: HkPhotoKind): number =>
  items.filter((i) => i.checkinId === checkinId && (!kind || i.kind === kind)).length;

/** A check-in cannot be sent while one of its photos is still on the phone. */
export const blocksSubmit = (items: readonly QueueMeta[], checkinId: string): boolean => items.some((i) => i.checkinId === checkinId);

export function summarize(items: readonly QueueMeta[]): { waiting: number; failed: number } {
  return { waiting: items.filter((i) => i.state === "PENDING").length, failed: items.filter((i) => i.state === "FAILED").length };
}

/** Mark an item after an attempt that did not finish it. */
export function afterAttempt(it: QueueMeta, outcome: Exclude<Outcome, "DONE">, message: string | null, now: number, answered: boolean): QueueMeta {
  const attempts = it.attempts + 1;
  return outcome === "FAILED"
    ? { ...it, attempts, maybeSent: false, state: "FAILED", error: message, nextAt: Number.MAX_SAFE_INTEGER }
    : { ...it, attempts, maybeSent: answered ? false : true, state: "PENDING", error: message, nextAt: now + backoffMs(attempts) };
}
