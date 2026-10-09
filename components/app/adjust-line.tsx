"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/input";
import { PersonNameField, usePersonName } from "@/components/app/person-name";
import { MANUAL_REASONS, REASON_CODES, type ReasonCode } from "@/lib/inventory-control";
import { fmtDate, fmtNum } from "@/lib/utils";

export type AdjustLine = { bin_code: string; sku: string; batch_lot: string; expiry_date: string | null; quantity: number; uom: string | null };

/**
 * Adjust one stock line from wherever it is listed (Inventory), without going
 * to Adjust stok and finding it again. Same rules as the bin page: type the
 * quantity physically there (or a +/- change), a reason code and a note; up to
 * the policy's approval limit it is posted as an adjustment movement, above it
 * it becomes a request someone else approves (Inventory → Persetujuan, 0018).
 */
export function AdjustLineButton({ line }: { line: AdjustLine }) {
  const router = useRouter();
  const [person, setPerson] = usePersonName();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"count" | "delta">("count");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState<ReasonCode | "">("");
  const [note, setNote] = useState("");
  const [limit, setLimit] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cur = Number(line.quantity);
  const v = Number(value);
  const delta = value.trim() === "" || !Number.isFinite(v) ? null : mode === "count" ? v - cur : v;
  const after = delta === null ? null : cur + delta;
  const needsApproval = delta !== null && limit !== null && Math.abs(delta) > limit;
  const problem = delta === null ? null
    : !Number.isInteger(v) ? "Isi bilangan bulat."
    : delta === 0 ? "Tidak ada perubahan."
    : after! < 0 ? `Hasil akan negatif (stok ${fmtNum(cur)}).` : null;
  const ready = delta !== null && !problem && !!reason && note.trim().length > 0 && person.trim().length >= 2;

  async function onOpen(o: boolean) {
    setOpen(o); setError(null);
    if (!o) return;
    setMode("count"); setValue(""); setReason(""); setNote("");
    const { data } = await createClient().rpc("inventory_policy");
    setLimit(Number((data as { adjust_approval_qty?: number } | null)?.adjust_approval_qty ?? 20));
  }

  async function save() {
    if (!ready || delta === null || !reason) return;
    setBusy(true); setError(null);
    const db = createClient();
    let err: { message: string } | null = null;
    if (needsApproval) {
      ({ error: err } = await db.rpc("request_adjustment", {
        p_bin_code: line.bin_code, p_sku: line.sku, p_batch: line.batch_lot, p_expiry: line.expiry_date, p_qty: delta,
        p_reason_code: reason, p_note: note.trim(), p_by_name: person,
      }));
    } else {
      const [{ data: bin }, { data: item }, { data: auth }] = await Promise.all([
        db.from("bins").select("id").eq("bin_code", line.bin_code).maybeSingle(),
        db.from("items").select("id").eq("sku", line.sku).maybeSingle(),
        db.auth.getClaims(),
      ]);
      if (!bin || !item) err = { message: `Bin ${line.bin_code} atau SKU ${line.sku} tidak ditemukan.` };
      else ({ error: err } = await db.from("movements").insert({
        type: "adjustment", item_id: item.id, batch_lot: line.batch_lot, quantity: delta, to_bin_id: bin.id, expiry_date: line.expiry_date,
        note: note.trim(), reason_code: reason, by_name: person.trim(), user_id: auth?.claims.sub,
      }));
    }
    setBusy(false);
    if (err) return setError(err.message);
    setOpen(false); router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => void onOpen(o)}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 px-2" title={`Adjust ${line.bin_code} · ${line.sku}`} onClick={(e) => e.stopPropagation()}>
          <SlidersHorizontal className="h-4 w-4" /><span className="sr-only">Adjust</span>
        </Button>
      </DialogTrigger>
      <DialogContent title={`Adjust ${line.bin_code}`} description={`${line.sku} · batch ${line.batch_lot || "–"} · exp ${line.expiry_date ? fmtDate(line.expiry_date) : "–"} · sekarang ${fmtNum(cur)} ${line.uom ?? ""}`}>
        <div className="space-y-4" onClick={(e) => e.stopPropagation()}>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="radio" checked={mode === "count"} onChange={() => { setMode("count"); setValue(""); }} />Jumlah fisik sekarang</label>
            <label className="flex items-center gap-2"><input type="radio" checked={mode === "delta"} onChange={() => { setMode("delta"); setValue(""); }} />Tambah / kurangi</label>
          </div>
          <div>
            <Label htmlFor="adj-v">{mode === "count" ? "Jumlah yang benar-benar ada di bin" : "Perubahan (+ tambah, − kurangi)"}</Label>
            <Input id="adj-v" type="number" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} className="w-40" autoFocus />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="adj-r">Kode alasan</Label>
              <Select id="adj-r" value={reason} onChange={(e) => setReason(e.target.value as ReasonCode)}>
                <option value="">Pilih…</option>
                {MANUAL_REASONS.map((r) => <option key={r} value={r}>{REASON_CODES[r]}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="adj-n">Keterangan (wajib)</Label>
              <Input id="adj-n" value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. fisik kosong saat pick NO 6 #8" />
            </div>
          </div>
          <PersonNameField id="adj-person" value={person} onChange={setPerson} label="Nama Anda" />
          {delta !== null && !problem && (
            <p className="rounded-md bg-plate/30 p-3 text-base">
              {line.bin_code} · {line.sku}: {fmtNum(cur)} → <b>{fmtNum(after!)}</b> ({delta > 0 ? "+" : ""}{fmtNum(delta)}).
              {needsApproval ? ` Di atas batas ${fmtNum(limit!)} unit: diajukan, lalu disetujui orang lain di Inventory → Persetujuan.` : " Langsung tercatat sebagai adjustment."}
            </p>
          )}
          {problem && <p className="text-sm text-bad">{problem}</p>}
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="lg" onClick={() => setOpen(false)}>Batal</Button>
            <Button size="lg" onClick={save} disabled={busy || !ready}>{busy ? "Menyimpan…" : needsApproval ? "Ajukan" : "Simpan adjustment"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
