"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Clock, Send, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ConfirmButton } from "@/components/app/confirm-button";
import { callRpc } from "@/components/ckb/rpc-button";
import { Pill } from "@/components/ckb/ui";
import { Button } from "@/components/ui/button";
import { HK_PHOTO_LABEL, HK_STATUS_LABEL, canSubmit, fitEdge, photoRuleError, type HkPhotoKind } from "@/lib/ckb/housekeeping";
import { blocksSubmit, queuedCount } from "@/lib/ckb/hk-upload-queue";
import { enqueue, flush, queueAvailable, removeFromQueue, type QueueRecord } from "@/lib/ckb/hk-upload-runner";
import { cn } from "@/lib/utils";
import { Lightbox } from "./lightbox";
import { useUploadQueue } from "./upload-queue";

type Photo = { id: string; kind: HkPhotoKind };

/** A square thumbnail that opens the photo; the file comes from the gated route, never from storage directly. */
export function HkThumb({ id, label, onClick, className }: { id: string; label?: string; onClick?: () => void; className?: string }) {
  const img = (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`/api/ckb/housekeeping/photo/${id}`} alt={label ?? "Foto housekeeping"} loading="lazy" className={cn("h-24 w-24 rounded-md border border-steel-100 bg-paper object-cover", className)} />
  );
  return onClick
    ? <button type="button" onClick={onClick} className="block shrink-0 rounded-md focus:outline-none focus:ring-2 focus:ring-ckb" aria-label={`Buka ${label ?? "foto"}`}>{img}</button>
    : <span className="block shrink-0">{img}</span>;
}

/** A photo still on the phone: shown from the stored file, marked as waiting (or refused, with the reason). */
function QueuedThumb({ rec }: { rec: QueueRecord }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { const u = URL.createObjectURL(rec.blob); setUrl(u); return () => URL.revokeObjectURL(u); }, [rec.blob]);
  const failed = rec.state === "FAILED";
  return (
    <div className="relative">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url ? <img src={url} alt="Foto menunggu dikirim" className={cn("h-24 w-24 rounded-md border-2 object-cover", failed ? "border-bad" : "border-warn")} /> : <div className="h-24 w-24 rounded-md bg-paper" />}
      <span className={cn("absolute bottom-1 left-1 flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-white", failed ? "bg-bad" : "bg-warn")}>
        <Clock className="h-3 w-3" />{failed ? "Ditolak" : "Menunggu"}
      </span>
      <button type="button" aria-label="Hapus foto ini dari ponsel" onClick={() => void removeFromQueue(rec.id)}
        className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-bad text-white"><X className="h-4 w-4" /></button>
    </div>
  );
}

/** Scales a photo so its long edge is at most `maxEdge` and re-encodes it as JPEG: a week of photos stays small. */
async function shrink(file: File, maxEdge: number): Promise<File> {
  if (typeof createImageBitmap !== "function") return file;
  try {
    const bmp = await createImageBitmap(file);
    const { w, h } = fitEdge(bmp.width, bmp.height, maxEdge);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d")?.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.82));
    return blob ? new File([blob], "foto.jpg", { type: "image/jpeg" }) : file;
  } catch { return file; }
}

/**
 * The before and after photos of one check-in. Two big tap-to-camera slots; a wrong photo is removed with its x (it stops
 * counting at once); `Kirim` is a sticky bar that appears once there is one of each. The real status of the check-in is
 * read here, so the panel never offers an action the database would refuse.
 */
export function PhotoSlots({ checkinId, editable = true, maxPerKind = 3, maxEdge = 1600, onChanged }: {
  checkinId: string; editable?: boolean; maxPerKind?: number; maxEdge?: number; onChanged?: () => void;
}) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [status, setStatus] = useState<string>("STARTED");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<HkPhotoKind | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<number | null>(null);
  const before = useRef<HTMLInputElement>(null);
  const after = useRef<HTMLInputElement>(null);
  const queue = useUploadQueue().filter((q) => q.checkinId === checkinId);

  const load = useCallback(async () => {
    const sb = createClient();
    const [p, c] = await Promise.all([
      sb.from("ckb_hk_photos").select("id, kind").eq("checkin_id", checkinId).is("withdrawn_at", null).order("uploaded_at"),
      sb.from("ckb_hk_checkins").select("status").eq("id", checkinId).maybeSingle(),
    ]);
    if (p.error || c.error) { setLoadError((p.error ?? c.error)!.message); return; }
    setLoadError(null);
    setPhotos((p.data ?? []) as Photo[]);
    if (c.data?.status) setStatus(c.data.status as string);
  }, [checkinId]);
  useEffect(() => { void load(); }, [load, queue.length]);   // a photo leaving the phone means it arrived: read the list again

  // Photos waiting on the phone count toward the maximum and toward "there is a before photo", like uploaded ones.
  const nBefore = photos.filter((p) => p.kind === "BEFORE").length + queuedCount(queue, checkinId, "BEFORE");
  const nAfter = photos.filter((p) => p.kind === "AFTER").length + queuedCount(queue, checkinId, "AFTER");
  const waiting = blocksSubmit(queue, checkinId);
  const canEdit = editable && status === "STARTED";
  const all = photos.map((p) => ({ id: p.id, caption: `Foto ${HK_PHOTO_LABEL[p.kind].toLowerCase()}` }));

  async function upload(kind: HkPhotoKind, file: File | undefined) {
    if (!file) return;
    const rule = photoRuleError({ status, kind, before: nBefore, after: nAfter, maxPerKind });
    if (rule) { setError(rule); return; }
    setBusy(kind); setError(null);
    try {
      const shrunk = await shrink(file, maxEdge);
      if (queueAvailable()) {
        // Stored on the phone first, then sent: no signal, a closed tab or a crash never loses the photo.
        await enqueue(checkinId, kind, shrunk);
        await flush({ force: true });
        await load(); onChanged?.();
        return;
      }
      const fd = new FormData();   // no IndexedDB (private window): the old direct upload
      fd.set("checkin_id", checkinId); fd.set("kind", kind); fd.set("file", shrunk);
      const res = await fetch("/api/ckb/housekeeping/photo", { method: "POST", body: fd });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { setError(body.error ?? (res.status === 413 ? "Foto terlalu besar. Coba lagi." : "Upload gagal. Periksa sinyal lalu coba lagi.")); return; }
      await load(); onChanged?.();
    } catch { setError("Foto tidak bisa disimpan di ponsel. Coba lagi."); }
    finally { setBusy(null); }
  }
  async function remove(id: string): Promise<string | null> {
    const [, err] = await callRpc("ckb_hk_withdraw_photo", { p_photo: id, p_reason: null });
    if (err) return err;
    await load(); onChanged?.();
    return null;
  }
  async function send() {
    setBusy("send"); setError(null);
    const [, err] = await callRpc("ckb_hk_submit", { p_checkin: checkinId });
    setBusy(null);
    if (err) { setError(err); return; }
    await load(); onChanged?.();
  }

  const slot = (kind: HkPhotoKind, ref: React.RefObject<HTMLInputElement | null>, n: number) => {
    const mine = photos.filter((p) => p.kind === kind);
    const waitingHere = queue.filter((q) => q.kind === kind);
    const rule = photoRuleError({ status, kind, before: nBefore, after: nAfter, maxPerKind });
    return (
      <div className="space-y-2">
        <p className="flex items-baseline justify-between font-semibold">
          <span>{HK_PHOTO_LABEL[kind]}</span><span className="text-xs font-normal text-steel-500">{n}/{maxPerKind}</span>
        </p>
        <div className="flex flex-wrap gap-2">
          {mine.map((p) => (
            <div key={p.id} className="relative">
              <HkThumb id={p.id} label={`Foto ${HK_PHOTO_LABEL[kind].toLowerCase()}`} onClick={() => setView(photos.findIndex((x) => x.id === p.id))} />
              {canEdit && (
                <ConfirmButton variant="default" size="icon" className="absolute -right-2 -top-2 h-7 w-7 rounded-full bg-bad text-white hover:bg-bad/90" title="Hapus foto"
                  summary="Foto ini dihapus dari check-in dan tidak dihitung. Ambil foto baru sebagai gantinya." confirmLabel="Hapus foto" onConfirm={() => remove(p.id)} aria-label="Hapus foto ini">
                  <X className="h-4 w-4" />
                </ConfirmButton>
              )}
            </div>
          ))}
          {waitingHere.map((q) => <QueuedThumb key={q.id} rec={q} />)}
          {canEdit && n < maxPerKind && (
            <>
              <input ref={ref} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void upload(kind, e.target.files?.[0]); e.target.value = ""; }} />
              <button type="button" disabled={busy !== null || !!rule} onClick={() => ref.current?.click()} aria-label={`Ambil foto ${HK_PHOTO_LABEL[kind].toLowerCase()}`}
                className={cn("flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed text-xs font-medium transition-colors",
                  rule ? "border-steel-100 text-steel-300" : "border-ckb text-ckb hover:bg-ckb-tint/40", busy === kind && "animate-pulse")}>
                <Camera className="h-6 w-6" />{busy === kind ? "Mengunggah…" : n === 0 ? "Ambil foto" : "Tambah"}
              </button>
            </>
          )}
          {!canEdit && mine.length === 0 && waitingHere.length === 0 && <p className="text-xs text-steel-500">Tidak ada foto.</p>}
          {waitingHere.find((q) => q.state === "FAILED") && <p className="w-full text-xs text-bad">{waitingHere.find((q) => q.state === "FAILED")!.error}</p>}
        </div>
        {canEdit && n === 0 && kind === "AFTER" && nBefore === 0 && <p className="text-xs text-steel-500">Ambil foto sebelum dulu.</p>}
      </div>
    );
  };

  return (
    <div className="space-y-4 rounded-lg border border-steel-100 bg-white p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="font-cond text-lg font-semibold">Foto housekeeping</p>
        <Pill tone={status === "ACCEPTED" || status === "SUBMITTED" ? "ok" : status === "REJECTED" || status === "CANCELLED" ? "bad" : "info"}>{HK_STATUS_LABEL[status] ?? status}</Pill>
      </div>
      {loadError && <p role="alert" className="rounded-md bg-bad/10 p-2 text-bad">Foto tidak bisa dimuat: {loadError}</p>}
      <div className="grid gap-4 sm:grid-cols-2">{slot("BEFORE", before, nBefore)}{slot("AFTER", after, nAfter)}</div>
      {error && <p role="alert" className="rounded-md bg-bad/10 p-2 text-bad">{error}</p>}
      {canEdit && (
        <div className="sticky bottom-[4.5rem] z-10 -mx-1 flex flex-wrap items-center gap-2 rounded-lg bg-white/95 p-1 backdrop-blur lg:bottom-2">
          <Button type="button" size="lg" className="flex-1 sm:flex-none" disabled={!canSubmit(nBefore, nAfter) || waiting || busy !== null} onClick={() => void send()}>
            <Send className="h-4 w-4" />{busy === "send" ? "Mengirim…" : "Kirim"}
          </Button>
          {waiting ? <span className="text-xs text-warn">Tunggu foto terkirim ke server dulu ({queue.length} menunggu).</span>
            : !canSubmit(nBefore, nAfter) && <span className="text-xs text-steel-500">Perlu minimal 1 foto sebelum dan 1 foto sesudah.</span>}
        </div>
      )}
      {view !== null && <Lightbox items={all} index={view} onIndex={setView} onClose={() => setView(null)} />}
    </div>
  );
}
