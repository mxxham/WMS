"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/input";
import { fmtDate, fmtNum } from "@/lib/utils";
import { ItemScanInput } from "@/components/app/item-scan-input";
import { PersonNameField, usePersonName } from "@/components/app/person-name";
import type { TaskRow } from "@/lib/allocator/picklist-from-tasks";

type Source = { bin_code: string; batch_lot: string; expiry_date: string | null; quantity: number };
type Fefo = "planned" | "same" | "earlier" | "later" | "none";

/** Where a candidate bin stands against the planned expiry (FEFO: earliest first). */
function fefoOf(s: Source, plannedExpiry: string, isPlanned: boolean): Fefo {
  if (isPlanned) return "planned";
  if (!s.expiry_date) return "none";
  const d = s.expiry_date.slice(0, 10), p = plannedExpiry.slice(0, 10);
  return d === p ? "same" : d < p ? "earlier" : "later";
}
const GROUPS: { key: Fefo; label: string }[] = [
  { key: "planned", label: "Rencana" },
  { key: "same", label: "FEFO sama (expired sama dengan rencana)" },
  { key: "earlier", label: "Expired lebih awal (FEFO: boleh, ambil ini dulu)" },
  { key: "later", label: "Expired lebih lama (melanggar FEFO)" },
  { key: "none", label: "Tanpa tanggal expired" },
];

/**
 * Confirms one task. Default: done exactly as planned. "Berbeda" records
 * what the picker really did — fewer cartons, or another bin/batch — with a
 * reason; the ledger then moves the real stock, not the planned stock.
 */
export function TaskPostDialog({ task: t, onDone }: { task: TaskRow; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [different, setDifferent] = useState(false);
  const [qty, setQty] = useState(String(t.quantity));
  const [sources, setSources] = useState<Source[] | null>(null);
  const [source, setSource] = useState("0");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [person, setPerson] = usePersonName();
  const [scan, setScan] = useState("");
  const [scanned, setScanned] = useState<string | null>(null);
  // Scan rules: whether this SKU has a barcode and whether the policy requires the scan.
  const [scanRule, setScanRule] = useState<{ hasEan: boolean; required: boolean } | null>(null);
  // Relocation of a broken pallet's rest: what is really left of this batch in the bin now (0033).
  const relocate = t.task_type !== "PICK";
  const [left, setLeft] = useState<number | null>(null);
  async function loadLeft() {
    if (!relocate) return;
    const { data } = await createClient().from("inventory_detail").select("quantity")
      .eq("bin_code", t.from_bin).eq("sku", t.sku).eq("batch_lot", t.batch_lot);
    setLeft((data ?? []).reduce((a, r) => a + Number(r.quantity), 0));
  }
  async function loadScanRule() {
    const db = createClient();
    const [{ data: item }, { data: pol }] = await Promise.all([db.from("items").select("ean").eq("sku", t.sku).maybeSingle(), db.rpc("inventory_policy")]);
    const hasEan = !!item?.ean;
    setScanRule({ hasEan, required: hasEan && t.task_type === "PICK" && !!(pol as { require_scan_on_pick?: boolean } | null)?.require_scan_on_pick });
  }

  const planned = `${t.from_bin}|${t.batch_lot}|${t.expiry_date}`;
  const what = t.task_type === "PICK"
    ? `Ambil ${fmtNum(Number(t.quantity))} ${t.uom ?? ""} SKU ${t.sku} batch ${t.batch_lot || "–"} dari ${t.from_bin} untuk shipment ${t.shipment_number}.`
    : `Pindahkan ${fmtNum(Number(t.quantity))} ${t.uom ?? ""} SKU ${t.sku} batch ${t.batch_lot || "–"} dari ${t.from_bin} ke pickface ${t.to_bin}.`;

  async function loadSources() {
    // Every bin currently holding this SKU; the planned one first, the rest
    // grouped against the planned expiry in the list below.
    const { data } = await createClient().from("inventory_detail")
      .select("bin_code, batch_lot, expiry_date, quantity").eq("sku", t.sku).gt("quantity", 0)
      .order("expiry_date", { ascending: true, nullsFirst: false }).order("bin_code");
    const rows = (data ?? []) as Source[];
    const idx = rows.findIndex((r) => `${r.bin_code}|${r.batch_lot}|${r.expiry_date}` === planned);
    const ordered = idx >= 0 ? [rows[idx], ...rows.filter((_, i) => i !== idx)]
      : [{ bin_code: t.from_bin, batch_lot: t.batch_lot, expiry_date: t.expiry_date, quantity: 0 }, ...rows];
    setSources(ordered); setSource("0");
  }

  async function submit() {
    setBusy(true); setError(null);
    const args: Record<string, unknown> = { p_task_id: t.id, p_by_name: person, p_scanned: scanned };
    if (different) {
      const src = sources?.[Number(source)];
      args.p_actual_qty = Number(qty);
      if (src) { args.p_from_bin = src.bin_code; args.p_batch_lot = src.batch_lot; args.p_expiry = src.expiry_date; }
      args.p_reason = reason.trim();
    }
    const { error } = await createClient().rpc("post_task_by", args);
    setBusy(false);
    if (error) return setError(error.message);
    setOpen(false); onDone();
  }

  const fefo = (sources ?? []).map((s, i) => fefoOf(s, t.expiry_date, i === 0));
  const picked = fefo[Number(source)];

  const n = Number(qty);
  // A pick takes at most the planned cartons; a relocation at most what the chosen bin holds.
  const maxQty = relocate ? Number(sources?.[Number(source)]?.quantity ?? left ?? t.quantity) : Number(t.quantity);
  const wrongItem = scanned !== null && scanned !== t.sku;
  const invalid = (different && (!Number.isFinite(n) || n < 0 || n > maxQty || !reason.trim()))
    || person.trim().length < 2 || wrongItem || (!!scanRule?.required && scanned !== t.sku);

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setError(null); if (o) { setDifferent(false); setQty(String(t.quantity)); setReason(""); setScan(""); setScanned(null); loadScanRule(); loadLeft(); } }}>
      <DialogTrigger asChild><Button size="sm">Posting</Button></DialogTrigger>
      <DialogContent title="Posting tugas" description={`NO ${t.wave_no} · #${t.seq}`}>
        <div className="space-y-4">
          <p className="rounded-md bg-plate/30 p-3 text-base">{what}</p>
          {relocate && left !== null && left !== Number(t.quantity) && (
            <div className="space-y-2 rounded-md border-2 border-warn bg-warn/10 p-3 text-sm">
              <p>Sisa batch ini di {t.from_bin} sekarang <b>{fmtNum(left)} {t.uom ?? ""}</b>, rencana pindah {fmtNum(Number(t.quantity))}.
                {left > Number(t.quantity) ? " Pick sebelumnya mengambil kurang dari rencana: pindahkan semua sisa supaya bin kosong." : " Stok di bin kurang dari rencana."}</p>
              {left > 0 && (
                <Button size="sm" variant="plate" onClick={() => {
                  setDifferent(true); setQty(String(left)); setReason("pindahkan semua sisa bin"); if (!sources) loadSources();
                }}>Pindahkan semua sisa ({fmtNum(left)})</Button>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Hasil">
            <Button variant={different ? "outline" : "default"} onClick={() => setDifferent(false)} aria-pressed={!different}>Sesuai rencana</Button>
            <Button variant={different ? "default" : "outline"} aria-pressed={different}
              onClick={() => { setDifferent(true); if (!sources) loadSources(); }}>Berbeda</Button>
          </div>
          {different && (
            <div className="space-y-3">
              <div>
                <Label htmlFor="aq">{relocate ? "Jumlah yang benar-benar dipindah" : "Jumlah yang benar-benar diambil"} (0–{fmtNum(maxQty)})</Label>
                <Input id="aq" type="number" inputMode="numeric" min={0} max={maxQty} value={qty} onChange={(e) => setQty(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="as">Diambil dari</Label>
                <Select id="as" value={source} onChange={(e) => setSource(e.target.value)} disabled={!sources}>
                  {GROUPS.map((g) => {
                    const items = (sources ?? []).map((s, i) => ({ s, i })).filter(({ i }) => fefo[i] === g.key);
                    return items.length === 0 ? null : (
                      <optgroup key={g.key} label={g.label}>
                        {items.map(({ s, i }) => (
                          <option key={i} value={i}>
                            {s.bin_code} · batch {s.batch_lot || "–"} · exp {fmtDate(s.expiry_date)} · stok {fmtNum(Number(s.quantity))}
                          </option>
                        ))}
                      </optgroup>
                    );
                  })}
                </Select>
                {picked === "same" && <p className="mt-1 text-xs text-ok">Expired sama dengan rencana: sesuai FEFO.</p>}
                {picked === "earlier" && <p className="mt-1 text-xs text-ok">Expired lebih awal dari rencana: sesuai FEFO.</p>}
                {picked === "later" && <p className="mt-1 rounded-md bg-warn/10 p-2 text-xs text-warn">Expired lebih lama dari rencana ({fmtDate(t.expiry_date)}): melanggar FEFO. Pakai hanya jika stok yang lebih awal memang tidak ada, dan tulis alasannya.</p>}
                {picked === "none" && <p className="mt-1 rounded-md bg-warn/10 p-2 text-xs text-warn">Stok ini tidak punya tanggal expired: FEFO tidak bisa dicek.</p>}
              </div>
              <div>
                <Label htmlFor="ar">Alasan (wajib)</Label>
                <Input id="ar" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="mis. karton rusak, palet terhalang" />
              </div>
              <p className="text-xs text-steel-500">Stok dipotong dari bin yang dipilih. Jika wave lain jadi tidak cocok, supervisor bisa menghitung ulang wave yang belum dikerjakan.</p>
            </div>
          )}
          <div>
            <Label htmlFor={`scan-${t.id}`}>Scan barcode karton {scanRule?.required ? "(wajib)" : scanRule?.hasEan ? "(disarankan)" : "(SKU belum punya barcode)"}</Label>
            <ItemScanInput id={`scan-${t.id}`} value={scan} onChange={setScan} onItem={(it) => setScanned(it?.sku ?? null)} placeholder="scan karton / ketik SKU" />
            {scanned === t.sku && <p className="mt-1 text-xs font-semibold text-ok">Barang sesuai: {t.sku}</p>}
            {wrongItem && <p className="mt-1 rounded-md bg-bad/10 p-2 text-sm font-semibold text-bad">Barang salah: yang di-scan {scanned}, tugas ini {t.sku}. Jangan diambil.</p>}
          </div>
          <PersonNameField id={`picker-${t.id}`} value={person} onChange={setPerson} label="Nama picker" />
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="lg" onClick={() => setOpen(false)}>Batal</Button>
            <Button size="lg" onClick={submit} disabled={busy || invalid}>{busy ? "Memproses…" : "Sudah dikerjakan"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
