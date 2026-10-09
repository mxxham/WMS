"use client";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Cek sisa bin (0058), right after a Posting: when the pick left few cartons
 * of this SKU + batch in the bin, the picker — still standing there — says
 * how many they see. Blind: the system number is not shown. A different
 * answer opens a count on the bin; stock is not changed by it. Asked only
 * when bin_left_after says so; otherwise the dialog closes straight away.
 */
export function BinLeftCheck({ taskId, person, onDone }: { taskId: string; person: string; onDone: () => void }) {
  const [info, setInfo] = useState<{ bin: string; sku: string; batch: string } | null>(null);
  const [seen, setSeen] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ match: boolean } | null>(null);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    let live = true;
    void createClient().rpc("bin_left_after", { p_task_id: taskId }).then(({ data, error }) => {
      if (!live) return;
      const d = data as { ask?: boolean; bin?: string; sku?: string; batch?: string } | null;
      // Nothing to ask (plenty left), or the check itself failed: the posting already succeeded, so just close.
      if (error || !d?.ask) return done.current();
      setInfo({ bin: d.bin ?? "", sku: d.sku ?? "", batch: d.batch ?? "" });
    });
    return () => { live = false; };
  }, [taskId]);

  useEffect(() => {
    if (!result?.match) return;
    const t = setTimeout(() => done.current(), 1200);
    return () => clearTimeout(t);
  }, [result]);

  async function save(n: number) {
    setBusy(true); setError(null);
    const { data, error } = await createClient().rpc("record_bin_check", { p_task_id: taskId, p_seen: n, p_by_name: person });
    setBusy(false);
    if (error) return setError(error.message);
    setResult({ match: !!(data as { match?: boolean } | null)?.match });
  }

  if (!info) return <p className="py-6 text-center text-sm text-steel-500">Tersimpan. Memeriksa sisa bin…</p>;
  if (result) return result.match ? (
    <p className="flex items-center gap-2 rounded-md bg-ok/10 p-4 text-base font-semibold text-ok"><Check className="h-5 w-5" />Cocok dengan sistem. Terima kasih.</p>
  ) : (
    <div className="space-y-3">
      <p className="flex items-start gap-2 rounded-md bg-warn/10 p-4 text-base">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warn" />
        <span>Berbeda dari sistem. <b className="font-cond">{info.bin}</b> dijadwalkan dihitung ulang (Cycle count); stok belum diubah.</span>
      </p>
      <Button size="lg" className="w-full" onClick={() => done.current()}>Tutup</Button>
    </div>
  );

  const n = Number(seen);
  const valid = seen.trim() !== "" && Number.isInteger(n) && n >= 0;
  return (
    <div className="space-y-4">
      <p className="rounded-md bg-ok/10 p-3 text-sm font-semibold text-ok">Posting tersimpan.</p>
      <div className="space-y-1">
        <p className="text-base">
          Masih ada berapa karton di <span className="rounded-plate border border-plate-dark/40 bg-plate/40 px-2 py-0.5 font-cond font-semibold">{info.bin}</span>?
        </p>
        <p className="text-sm text-steel-500">SKU {info.sku} batch {info.batch || "–"}. Hitung yang terlihat di bin sekarang, tanpa melihat sistem.</p>
      </div>
      <Button size="lg" variant="outline" className="h-16 w-full text-lg" disabled={busy} onClick={() => void save(0)}>Kosong (0)</Button>
      <div className="flex gap-2">
        <Input type="number" inputMode="numeric" min={0} value={seen} onChange={(e) => setSeen(e.target.value)} placeholder="jumlah karton"
          aria-label={`Sisa karton di ${info.bin}`} className="h-14 flex-1 text-center text-xl" />
        <Button size="lg" className="h-14" disabled={busy || !valid} onClick={() => void save(n)}>{busy ? "Menyimpan…" : "Simpan"}</Button>
      </div>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      <button type="button" className="w-full text-center text-sm text-steel-500 underline" onClick={() => done.current()}>Lewati</button>
    </div>
  );
}
