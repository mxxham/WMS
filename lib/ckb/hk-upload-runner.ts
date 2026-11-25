/**
 * Browser side of the housekeeping offline photo queue: IndexedDB storage and the sender. The rules (what goes next, what an
 * answer means) are in hk-upload-queue.ts and tested there. A photo is stored first and sent second, so closing the tab, losing
 * signal or a crash never loses it; it is removed only after the server confirmed it. The queue belongs to the signed-in account:
 * a second person on the same phone neither sees nor sends it.
 */
import type { HkPhotoKind } from "@/lib/ckb/housekeeping";
import { afterAttempt, classify, nextToSend, type QueueMeta } from "@/lib/ckb/hk-upload-queue";

const DB_NAME = "ckb-hk-uploads", STORE = "queue", EVENT = "ckb-hk-queue-changed", CHANNEL = "ckb-hk-uploads", SEND_TIMEOUT_MS = 60_000;
export type QueueRecord = QueueMeta & { userId: string; blob: Blob };

let user: string | null = null;
/** Set once per page by the runner component: whose queue this is. */
export const setQueueUser = (id: string | null) => { user = id; if (typeof window !== "undefined") queueMicrotask(notifyChanged); };
export const queueAvailable = (): boolean => typeof indexedDB !== "undefined" && typeof window !== "undefined";

let dbPromise: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: "id" }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = null; reject(req.error); };
  });
  return dbPromise;
}
async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let channel: BroadcastChannel | null = null;
const bc = () => (channel ??= typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CHANNEL) : null);
/** Tell this tab and the others that the queue changed. */
export function notifyChanged() { window.dispatchEvent(new Event(EVENT)); bc()?.postMessage("changed"); }
export function subscribe(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  const c = bc(); const on = () => fn();
  c?.addEventListener("message", on);
  return () => { window.removeEventListener(EVENT, fn); c?.removeEventListener("message", on); };
}

/** This account's queue, oldest first. */
export async function listQueue(): Promise<QueueRecord[]> {
  if (!queueAvailable() || !user) return [];
  const all = await run("readonly", (s) => s.getAll() as IDBRequest<QueueRecord[]>);
  return all.filter((r) => r.userId === user).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}
const put = (r: QueueRecord) => run("readwrite", (s) => s.put(r));

/** Store a photo for later (or immediate) sending. Resolves once it is safely on the phone. */
export async function enqueue(checkinId: string, kind: HkPhotoKind, blob: Blob): Promise<QueueMeta> {
  if (!user) throw new Error("Antrean foto belum siap");
  const rec: QueueRecord = {
    id: crypto.randomUUID(), checkinId, kind, createdAt: Date.now(), attempts: 0, maybeSent: false, state: "PENDING", error: null, nextAt: 0, userId: user, blob,
  };
  await put(rec);
  notifyChanged();
  return rec;
}
export async function removeFromQueue(id: string): Promise<void> {
  await run("readwrite", (s) => s.delete(id));
  notifyChanged();
}

/** One request. status null = no answer; an expired session (a redirect to the login page) reads as 401, never as success. */
async function send(r: QueueRecord): Promise<{ status: number | null; error: string | null }> {
  const fd = new FormData();
  fd.set("checkin_id", r.checkinId); fd.set("kind", r.kind); fd.set("file", new File([r.blob], "foto.jpg", { type: r.blob.type || "image/jpeg" }));
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await fetch("/api/ckb/housekeeping/photo", { method: "POST", body: fd, signal: ctl.signal });
    if (res.redirected || !(res.headers.get("content-type") ?? "").includes("json")) return { status: 401, error: null };
    const body = (await res.json().catch(() => ({}))) as { id?: unknown; error?: string };
    if (res.ok && typeof body.id !== "string") return { status: 401, error: null };
    return { status: res.status, error: body.error ?? null };
  } catch { return { status: null, error: null }; }
  finally { clearTimeout(timer); }
}

let flushing = false;
/**
 * Send what is due, oldest first, one at a time. `force` ignores the waiting time (the "Kirim sekarang" button). Only one tab sends
 * at a time (Web Locks where the browser has them). Stops at the first answer that means "try later" so a bad connection is not hammered.
 */
export async function flush(opts: { force?: boolean } = {}): Promise<void> {
  if (!queueAvailable() || !user || flushing) return;
  flushing = true;
  const loop = async () => {
    for (;;) {
      const next = nextToSend(await listQueue(), opts.force ? Number.MAX_SAFE_INTEGER : Date.now());
      if (!next) return;
      const rec = (await listQueue()).find((r) => r.id === next.id);
      if (!rec) continue;
      // Written before sending: if the tab dies mid-request the photo is remembered as "may have arrived".
      await put({ ...rec, maybeSent: true });
      const res = await send(rec);
      const c = classify({ status: res.status, error: res.error, maybeSent: rec.maybeSent });
      if (c.outcome === "DONE") { await run("readwrite", (s) => s.delete(rec.id)); notifyChanged(); continue; }
      await put({ ...rec, ...afterAttempt(rec, c.outcome, c.message, Date.now(), res.status !== null) });
      notifyChanged();
      if (c.outcome === "RETRY") return;
    }
  };
  try {
    if (typeof navigator !== "undefined" && navigator.locks) await navigator.locks.request("ckb-hk-upload", { ifAvailable: true }, async (lock) => { if (lock) await loop(); });
    else await loop();
  } finally { flushing = false; notifyChanged(); }
}
