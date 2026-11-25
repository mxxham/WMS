"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CloudOff, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HK_PHOTO_LABEL } from "@/lib/ckb/housekeeping";
import { summarize } from "@/lib/ckb/hk-upload-queue";
import { flush, listQueue, queueAvailable, removeFromQueue, setQueueUser, subscribe, type QueueRecord } from "@/lib/ckb/hk-upload-runner";

/** This account's queued photos, kept in step with IndexedDB (and with other tabs). */
export function useUploadQueue(): QueueRecord[] {
  const [items, setItems] = useState<QueueRecord[]>([]);
  const refresh = useCallback(() => { void listQueue().then(setItems).catch(() => setItems([])); }, []);
  useEffect(() => { refresh(); return subscribe(refresh); }, [refresh]);
  return items;
}

/**
 * Mounted once on the housekeeping page for staff. Sends queued photos when the page opens, when the signal returns, when the tab
 * comes back to the front and every 15 seconds while something waits; and says what is waiting. The page refreshes itself as photos
 * arrive. A photo is never dropped on a failure: only the person can remove one.
 */
export function UploadQueueRunner({ userId }: { userId: string }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const items = useUploadQueue();
  const last = useRef(0);
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setQueueUser(userId); setReady(true);
    setOnline(navigator.onLine);
    const go = () => { setOnline(navigator.onLine); void flush(); };
    const vis = () => { if (document.visibilityState === "visible") go(); };
    window.addEventListener("online", go); window.addEventListener("offline", go); document.addEventListener("visibilitychange", vis);
    go();
    const t = window.setInterval(go, 15_000);
    return () => { window.removeEventListener("online", go); window.removeEventListener("offline", go); document.removeEventListener("visibilitychange", vis); window.clearInterval(t); setQueueUser(null); };
  }, [userId]);
  // A shorter queue means photos arrived: bring the cards and counts up to date.
  useEffect(() => { if (items.length < last.current) router.refresh(); last.current = items.length; }, [items.length, router]);

  if (!ready || !queueAvailable() || items.length === 0) return null;
  const s = summarize(items);
  const failed = items.filter((i) => i.state === "FAILED");
  // Why a waiting photo has not gone yet, when it is more than "no signal" (an expired session needs the person to sign in again).
  const reasons = [...new Set(items.filter((i) => i.state === "PENDING" && i.error && (online || !/Belum ada sinyal/.test(i.error))).map((i) => i.error as string))];
  return (
    <div role="status" className="space-y-2 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-medium">
          <CloudOff className="h-4 w-4" />
          {s.waiting > 0 ? `${s.waiting} foto menunggu dikirim${online ? "" : " (tidak ada sinyal)"}` : "Ada foto yang ditolak server"}
        </p>
        {s.waiting > 0 && (
          <Button size="sm" variant="outline" disabled={busy || !online} onClick={() => { setBusy(true); void flush({ force: true }).finally(() => setBusy(false)); }}>
            <RefreshCw className={busy ? "h-4 w-4 animate-spin" : "h-4 w-4"} />Kirim sekarang
          </Button>
        )}
      </div>
      {reasons.map((r) => <p key={r} className="text-sm font-medium text-warn">{r}</p>)}
      {s.waiting > 0
        ? <p className="text-xs text-steel-500">Foto tersimpan di ponsel ini dan dikirim otomatis saat ada sinyal. Biarkan halaman ini terbuka, atau buka lagi nanti.</p>
        : <p className="text-xs text-steel-500">Foto yang ditolak tidak dikirim lagi. Hapus, lalu ambil foto baru.</p>}
      {failed.map((f) => (
        <div key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-bad/10 p-2">
          <span className="text-bad">Foto {HK_PHOTO_LABEL[f.kind].toLowerCase()} ditolak: {f.error}</span>
          <Button size="sm" variant="ghost" onClick={() => void removeFromQueue(f.id)}><Trash2 className="h-4 w-4" />Hapus</Button>
        </div>
      ))}
    </div>
  );
}
