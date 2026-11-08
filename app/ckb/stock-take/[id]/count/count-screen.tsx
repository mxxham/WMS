import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Check, ChevronLeft, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { callRpc } from "@/components/ckb/rpc-button";
import { offlineFetch } from "@/lib/net";
import { photoReason } from "@/lib/ckb/count-rules";
import { parseCountInput } from "@/lib/ckb/stocktake";
import type { TaskEvidence, TaskRow } from "@/lib/ckb/stocktake-data";
import { cn, fmtDate, fmtNum } from "@/lib/utils";

const newKey = () => crypto.randomUUID();

/**
 * Screen 2: count one line. Nothing is pre-filled (empty = not counted). The photo comes before the send
 * button; when the rules need one (0, found stock, a recount, the customer's setting) the button waits for it.
 * The database enforces the same rule (0133), this only says it first. One key per opened form, so a retry
 * after a dropped connection cannot count twice.
 */
export function CountScreen({ t, photos, rules, canCount, lead, onSent, onBack, progressText }: {
  t: TaskRow; photos: TaskEvidence[]; rules: { photoRules: boolean; customerAlways: boolean };
  canCount: boolean; lead: boolean; onSent: () => void; onBack: () => void; progressText: string;
}) {
  const router = useRouter();
  const [raw, setRaw] = useState("");
  const [batchOk, setBatchOk] = useState<boolean | null>(null);
  const [expiryOk, setExpiryOk] = useState<boolean | null>(null);
  const [obsBatch, setObsBatch] = useState("");
  const [obsExpiry, setObsExpiry] = useState("");
  const [note, setNote] = useState("");
  const [key] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const parsed = parseCountInput(raw);
  const qty = parsed && "qty" in parsed ? parsed.qty : null;
  // A counter sees only this round's photos (an earlier one can show the earlier number).
  const roundPhotos = photos.filter((p) => p.round == null || p.round === t.round);
  const reason = photoReason(t, qty, rules);
  const needPhoto = reason !== null && roundPhotos.length === 0;
  const step = (d: number) => setRaw(String(Math.max(0, (qty ?? 0) + d)).replace(".", ","));

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true); setError(null);
    try {
      for (const f of Array.from(files)) {
        const fd = new FormData();
        fd.set("entity_type", "COUNT_TASK"); fd.set("entity_id", t.id); fd.set("kind", "COUNT"); fd.set("description", ""); fd.set("file", f);
        const res = await offlineFetch("/api/ckb/evidence", { method: "POST", body: fd });
        if (!res.ok) { const b = await res.json().catch(() => ({})); setError(b.error ?? "Foto gagal diunggah"); break; }
      }
    } catch (e) { setError((e as Error).message); }
    setUploading(false);
    if (file.current) file.current.value = "";
    router.refresh();
  }

  async function submit() {
    if (!parsed) return setError("Isi jumlah yang Anda lihat; 0 jika barang tidak ada.");
    if ("error" in parsed) return setError(parsed.error);
    if (needPhoto) return setError(`Foto wajib: ${reason}.`);
    setBusy(true); setError(null);
    const [, err] = await callRpc("ckb_submit_count", {
      p_task: t.id, p_qty: parsed.qty, p_batch_ok: batchOk, p_expiry_ok: expiryOk,
      p_observed_batch: obsBatch || null, p_observed_expiry: obsExpiry || null, p_note: note || null, p_client_key: key,
    });
    setBusy(false);
    if (err) return setError(err);
    onSent();
    router.refresh();
  }

  const yesNo = (v: boolean | null, set: (b: boolean) => void, label: string) => (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span>{label} sesuai?</span>
      <div className="flex gap-1">
        {([[true, "Ya"], [false, "Tidak"]] as const).map(([val, l]) => (
          <button key={l} type="button" onClick={() => set(val)} aria-pressed={v === val}
            className={cn("min-h-10 min-w-16 rounded-lg px-3 ring-1", v === val ? (val ? "bg-ok text-white ring-ok" : "bg-bad text-white ring-bad") : "bg-white ring-steel-300")}>{l}</button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="flex min-h-full flex-col gap-3">
      <button type="button" onClick={onBack} className="flex items-center gap-1 self-start text-sm font-medium text-ckb">
        <ChevronLeft className="h-4 w-4" aria-hidden />Kembali ke daftar <span className="font-normal text-steel-500">· {progressText}</span>
      </button>

      <section className="space-y-3 rounded-2xl bg-white p-4">
        {t.status === "RECOUNT_REQUESTED" && <p className="rounded-lg bg-warn/10 px-3 py-2 text-sm text-[#8a5a00]">Diminta hitung lagi. Hitung dari awal.</p>}
        <div>
          <span className="inline-block rounded-plate bg-plate px-3 py-1 font-cond text-3xl font-bold leading-none tracking-tight text-steel">{t.storage_bin || "–"}</span>
          <p className="mt-2 text-lg font-semibold leading-tight">{t.material_code}{t.origin === "FOUND" && <span className="ml-2 text-sm font-normal text-warn">temuan</span>}</p>
          <p className="text-sm text-steel-500">{t.description}</p>
          <p className="text-xs text-steel-500">{t.batch ? `Batch ${t.batch}` : "Tanpa batch"}{t.expiry_date ? ` · exp ${fmtDate(t.expiry_date)}` : ""} · {t.uom}
            {lead && t.baseline_qty !== null && <span className="font-medium text-steel"> · SAP {fmtNum(Number(t.baseline_qty), 3)}</span>}</p>
          {t.identity_issue && lead && <p className="mt-1 text-xs text-warn">SAP mencatat material ini di {t.baseline_rows} baris: hitung semuanya bersama.</p>}
        </div>

        {canCount ? (
          <>
            <div>
              <Label htmlFor={`q-${t.id}`} className="text-sm">Berapa yang Anda lihat? ({t.uom})</Label>
              <div className="mt-1 flex items-center gap-2">
                <button type="button" aria-label="Kurangi satu" onClick={() => step(-1)} className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-steel-100 active:bg-steel-300"><Minus className="h-6 w-6" /></button>
                <Input id={`q-${t.id}`} inputMode="decimal" autoComplete="off" value={raw} onChange={(e) => setRaw(e.target.value)}
                  className="h-14 rounded-xl border-2 border-ckb text-center font-cond text-3xl font-bold tabular" placeholder="–" />
                <button type="button" aria-label="Tambah satu" onClick={() => step(1)} className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-steel-100 active:bg-steel-300"><Plus className="h-6 w-6" /></button>
              </div>
              <p className="mt-1 text-xs text-steel-500">Isi 0 jika barang tidak ada. Desimal pakai koma.</p>
            </div>

            {(t.batch || t.expiry_date) && (
              <div className="space-y-2">
                {t.batch && yesNo(batchOk, setBatchOk, `Batch ${t.batch}`)}
                {t.expiry_date && yesNo(expiryOk, setExpiryOk, `Expired ${fmtDate(t.expiry_date)}`)}
                {(batchOk === false || expiryOk === false) && (
                  <div className="grid grid-cols-2 gap-2">
                    {batchOk === false && <div><Label htmlFor={`ob-${t.id}`} className="text-xs">Batch yang terlihat</Label><Input id={`ob-${t.id}`} value={obsBatch} onChange={(e) => setObsBatch(e.target.value)} /></div>}
                    {expiryOk === false && <div><Label htmlFor={`oe-${t.id}`} className="text-xs">Expired yang terlihat</Label><Input id={`oe-${t.id}`} type="date" value={obsExpiry} onChange={(e) => setObsExpiry(e.target.value)} /></div>}
                  </div>
                )}
              </div>
            )}

            <div>
              <p className="text-sm">Foto</p>
              <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" id={`ph-${t.id}`}
                onChange={(e) => upload(e.target.files)} />
              <label htmlFor={`ph-${t.id}`}
                className={cn("mt-1 flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed p-4 text-center text-sm",
                  needPhoto ? "border-warn bg-warn/10 text-[#8a5a00]" : "border-steel-300 text-steel-500")}>
                <Camera className="h-6 w-6" aria-hidden />
                {uploading ? "Mengunggah…" : needPhoto ? `Foto wajib: ${reason}. Ambil foto rak / lokasi.` : roundPhotos.length ? "Tambah foto" : "Ambil foto (opsional)"}
              </label>
              {roundPhotos.length > 0 && <p className="mt-1 text-xs text-ok">{roundPhotos.length} foto tersimpan untuk hitungan ini.</p>}
            </div>

            <div><Label htmlFor={`n-${t.id}`} className="text-sm">Catatan{batchOk === false || expiryOk === false ? " (wajib)" : " (opsional)"}</Label>
              <Input id={`n-${t.id}`} value={note} onChange={(e) => setNote(e.target.value)} /></div>

            {error && <p role="alert" className="text-sm text-bad">{error}</p>}
            <Button size="lg" className="w-full rounded-xl text-lg" onClick={submit} disabled={busy || uploading || raw.trim() === "" || needPhoto}>
              {needPhoto ? <><Camera className="h-5 w-5" />Ambil foto dulu</>
                : <><Check className="h-5 w-5" />{busy ? "Mengirim…" : `Kirim ${qty !== null ? fmtNum(qty, 3) : ""} ${t.uom}`}</>}
            </Button>
          </>
        ) : (
          <p className="text-sm text-steel-500">{t.status === "RECOUNT_REQUESTED" || t.status === "OPEN" ? "Baris ini tidak bisa dihitung sekarang." : "Baris ini sudah dihitung."}</p>
        )}
      </section>
    </div>
  );
}
