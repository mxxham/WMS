"use client";
import { useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, ArrowRightLeft, PackageMinus, SlidersHorizontal } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { PersonNameField, usePersonName } from "@/components/app/person-name";
import { expiryCheck, MISMATCH_LABEL } from "@/lib/batch-code";
import { MANUAL_REASONS, REASON_CODES, type ReasonCode } from "@/lib/inventory-control";
import type { Bin, InventoryRow, MovementType, Role } from "@/lib/types";
import { fmtDate, fmtNum } from "@/lib/utils";

type Action = "putaway" | "pick" | "transfer" | "adjust";
type StockLine = { item_id: string; sku: string; description: string; uom: string | null; batch_lot: string; quantity: number; expiry_date: string | null; held: number };

const toLine = (r: InventoryRow): StockLine => ({
  item_id: r.item_id, sku: r.items?.sku ?? "", description: r.items?.description ?? "", uom: r.items?.uom ?? null,
  batch_lot: r.batch_lot, quantity: Number(r.quantity), expiry_date: r.expiry_date, held: Number(r.held ?? 0),
});
const lineLabel = (l: StockLine) => `${l.sku} · ${l.batch_lot || "tanpa batch"} · ${fmtNum(l.quantity)} ${l.uom ?? ""} · exp ${fmtDate(l.expiry_date)}${l.held ? ` · ${fmtNum(l.held)} DITAHAN` : ""}`;

/**
 * Putaway / Pick / Transfer / Adjust. Each posts ONE row to `movements`;
 * the database trigger validates stock and updates inventory, so the UI never
 * writes inventory directly. Every action goes through a confirmation step
 * and records who did it. An adjustment above the policy limit is not posted:
 * it becomes a request that another person approves (Inventory → Persetujuan).
 */
export function MovementActions({ bin, inventory, role, onDone }: { bin: Bin; inventory: InventoryRow[]; role: Role; onDone: () => void }) {
  const [open, setOpen] = useState<Action | null>(null);
  const canAdjust = role !== "operator";
  const lines = useMemo(() => inventory.map(toLine), [inventory]);
  const blocked = bin.status === "blocked";

  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Button size="lg" variant="plate" disabled={blocked} onClick={() => setOpen("putaway")}><ArrowDownToLine className="h-5 w-5" />Putaway</Button>
        <Button size="lg" disabled={lines.length === 0} onClick={() => setOpen("pick")}><PackageMinus className="h-5 w-5" />Pick</Button>
        <Button size="lg" variant="outline" disabled={lines.length === 0} onClick={() => setOpen("transfer")}><ArrowRightLeft className="h-5 w-5" />Transfer</Button>
        {canAdjust && <Button size="lg" variant="outline" onClick={() => setOpen("adjust")}><SlidersHorizontal className="h-5 w-5" />Adjust</Button>}
      </div>
      {blocked && <p className="mt-2 text-xs text-bad">Bin diblokir: putaway ditolak. Pick/transfer keluar tetap bisa untuk mengosongkan.</p>}
      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        {open && (
          <MovementForm key={open} action={open} bin={bin} lines={lines}
            onDone={() => { setOpen(null); onDone(); }} />
        )}
      </Dialog>
    </div>
  );
}

/**
 * The Adjust form on its own, opened on one stock line (`lineIdx`) or on a
 * new SKU/batch line (`lineIdx` null). Used by the Adjust stok page.
 */
export function AdjustDialog({ bin, inventory, lineIdx, onClose, onDone }: {
  bin: Bin; inventory: InventoryRow[]; lineIdx: number | null; onClose: () => void; onDone: () => void;
}) {
  const lines = useMemo(() => inventory.map(toLine), [inventory]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <MovementForm action="adjust" bin={bin} lines={lines} initialLineIdx={lineIdx ?? 0} initialNewLine={lineIdx === null} onDone={onDone} />
    </Dialog>
  );
}

const TITLES: Record<Action, string> = { putaway: "Putaway ke bin ini", pick: "Pick dari bin ini", transfer: "Transfer ke bin lain", adjust: "Adjustment stok" };

function MovementForm({ action, bin, lines, onDone, initialLineIdx = 0, initialNewLine }: {
  action: Action; bin: Bin; lines: StockLine[]; onDone: () => void; initialLineIdx?: number; initialNewLine?: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [step, setStep] = useState<"form" | "confirm">("form");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // shared fields
  const [lineIdx, setLineIdx] = useState(initialLineIdx);
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [person, setPerson] = usePersonName();
  const [reason, setReason] = useState<ReasonCode | "">("");
  const [limit, setLimit] = useState<number | null>(null);
  const [expiryOk, setExpiryOk] = useState(false);
  const [shelfLife, setShelfLife] = useState(48);
  // putaway
  const [receiveNew, setReceiveNew] = useState(false);
  const [srcCode, setSrcCode] = useState("STAGING");
  const [srcLines, setSrcLines] = useState<StockLine[]>([]);
  const [srcId, setSrcId] = useState<string | null>(null);
  const [sku, setSku] = useState(""); const [batch, setBatch] = useState(""); const [expiry, setExpiry] = useState("");
  // transfer
  const [dstCode, setDstCode] = useState("");
  // adjust
  const [adjNewLine, setAdjNewLine] = useState(initialNewLine ?? lines.length === 0);

  // Load the source bin's stock for putaway (e.g. STAGING -> this bin).
  useEffect(() => {
    if (action !== "putaway" || receiveNew) return;
    const code = srcCode.trim().toUpperCase();
    if (!code) return;
    let cancelled = false;
    (async () => {
      const { data: b } = await supabase.from("bins").select("id").eq("bin_code", code).maybeSingle();
      if (cancelled) return;
      setSrcId(b?.id ?? null);
      if (!b) return setSrcLines([]);
      const { data } = await supabase.from("inventory")
        .select("id, bin_id, item_id, batch_lot, quantity, expiry_date, received_date, items(sku, description, uom, abc_class, upp)")
        .eq("bin_id", b.id).order("expiry_date", { ascending: true, nullsFirst: false });
      if (!cancelled) { setSrcLines(((data ?? []) as unknown as InventoryRow[]).map(toLine)); setLineIdx(0); }
    })();
    return () => { cancelled = true; };
  }, [action, receiveNew, srcCode, supabase]);

  // Approval limit for adjustments (inventory policy, 0016).
  useEffect(() => {
    if (action !== "adjust") return;
    supabase.rpc("inventory_policy").then(({ data }) => setLimit(Number((data as { adjust_approval_qty?: number } | null)?.adjust_approval_qty ?? 20)));
  }, [action, supabase]);
  // Shelf life of a typed SKU, to check its expiry against the batch code.
  useEffect(() => {
    if (!sku.trim()) return;
    let cancelled = false;
    Promise.all([supabase.from("items").select("shelf_life_months").eq("sku", sku.trim()).maybeSingle(), supabase.rpc("inventory_policy")])
      .then(([{ data: it }, { data: pol }]) => {
        if (!cancelled) setShelfLife(Number(it?.shelf_life_months ?? (pol as { default_shelf_life_months?: number } | null)?.default_shelf_life_months ?? 48));
      });
    return () => { cancelled = true; };
  }, [sku, supabase]);

  const pool = action === "putaway" ? srcLines : lines;
  const line: StockLine | undefined = pool[lineIdx];
  const n = Number(qty);
  const fefoWarning = action === "pick" && lineIdx > 0 && line?.expiry_date && pool[0]?.expiry_date && line.expiry_date > pool[0].expiry_date;
  const newStock = (action === "putaway" && receiveNew) || (action === "adjust" && adjNewLine);
  const mismatch = newStock ? expiryCheck(batch, expiry, shelfLife) : null;
  const needsApproval = action === "adjust" && limit !== null && Math.abs(n) > limit;

  /** Build the movement row + a sentence for the confirmation step. */
  async function build(): Promise<{ row: Record<string, unknown>; summary: string } | string> {
    if (!Number.isFinite(n) || n === 0) return "Isi jumlah yang valid.";
    if (action !== "adjust" && n < 0) return "Jumlah harus lebih dari 0.";
    if (person.trim().length < 2) return "Isi nama petugas.";
    if (mismatch && !expiryOk) return `Expired tidak cocok dengan batch ${batch.trim().toUpperCase()} (seharusnya ${fmtDate(mismatch.expected)}, ${MISMATCH_LABEL[mismatch.kind]}). Cek label, lalu centang konfirmasi bila label memang begitu.`;

    if (action === "putaway" && receiveNew) {
      const { data: item } = await supabase.from("items").select("id, sku, uom").eq("sku", sku.trim()).maybeSingle();
      if (!item) return `SKU ${sku} tidak ada di master item. Minta admin import master data.`;
      if (!expiry) return "Tanggal expired wajib untuk penerimaan baru (FEFO).";
      return { row: { type: "inbound" as MovementType, item_id: item.id, batch_lot: batch.trim().toUpperCase(), quantity: n, to_bin_id: bin.id, expiry_date: expiry, note: note || null },
        summary: `Terima ${fmtNum(n)} ${item.uom ?? ""} SKU ${item.sku} batch ${batch || "–"} ke ${bin.bin_code}.` };
    }
    if (action === "putaway") {
      if (!srcId) return `Bin asal ${srcCode} tidak ditemukan.`;
      if (!line) return "Bin asal tidak punya stok.";
      if (n > line.quantity) return `Maksimal ${fmtNum(line.quantity)} ${line.uom ?? ""}.`;
      return { row: { type: "putaway", item_id: line.item_id, batch_lot: line.batch_lot, quantity: n, from_bin_id: srcId, to_bin_id: bin.id, expiry_date: line.expiry_date, note: note || null },
        summary: `Putaway ${fmtNum(n)} ${line.uom ?? ""} SKU ${line.sku} dari ${srcCode.toUpperCase()} ke ${bin.bin_code}.` };
    }
    if (action === "pick") {
      if (!line) return "Tidak ada stok.";
      if (n > line.quantity) return `Maksimal ${fmtNum(line.quantity)} ${line.uom ?? ""}.`;
      return { row: { type: "picking", item_id: line.item_id, batch_lot: line.batch_lot, quantity: n, from_bin_id: bin.id, expiry_date: line.expiry_date, note: note || null },
        summary: `Pick ${fmtNum(n)} ${line.uom ?? ""} SKU ${line.sku} batch ${line.batch_lot || "–"} dari ${bin.bin_code}.` };
    }
    if (action === "transfer") {
      if (!line) return "Tidak ada stok.";
      if (n > line.quantity) return `Maksimal ${fmtNum(line.quantity)} ${line.uom ?? ""}.`;
      const code = dstCode.trim().toUpperCase();
      const { data: dst } = await supabase.from("bins").select("id, status").eq("bin_code", code).maybeSingle();
      if (!dst) return `Bin tujuan ${code || "(kosong)"} tidak ditemukan.`;
      if (dst.id === bin.id) return "Bin tujuan sama dengan bin asal.";
      if (dst.status === "blocked") return `Bin ${code} diblokir.`;
      return { row: { type: "transfer", item_id: line.item_id, batch_lot: line.batch_lot, quantity: n, from_bin_id: bin.id, to_bin_id: dst.id, expiry_date: line.expiry_date, note: note || null },
        summary: `Transfer ${fmtNum(n)} ${line.uom ?? ""} SKU ${line.sku} dari ${bin.bin_code} ke ${code}.` };
    }
    // adjust (signed)
    if (!reason) return "Pilih kode alasan adjustment.";
    if (!note.trim()) return "Keterangan adjustment wajib diisi (jejak audit).";
    const why = `${REASON_CODES[reason]} — ${note}`;
    const ask = needsApproval ? ` Di atas batas ${fmtNum(limit ?? 0)} unit: diajukan, lalu disetujui orang lain di Inventory → Persetujuan.` : "";
    if (adjNewLine) {
      const { data: item } = await supabase.from("items").select("id, sku, uom").eq("sku", sku.trim()).maybeSingle();
      if (!item) return `SKU ${sku} tidak ditemukan.`;
      if (n < 0) return "Stok baru tidak bisa negatif.";
      if (!expiry) return "Tanggal expired wajib untuk stok baru (FEFO).";
      return { row: { type: "adjustment", item_id: item.id, sku: item.sku, batch_lot: batch.trim().toUpperCase(), quantity: n, to_bin_id: bin.id, expiry_date: expiry, note, reason_code: reason },
        summary: `Adjustment +${fmtNum(n)} SKU ${item.sku} batch ${batch || "–"} di ${bin.bin_code}. ${why}.${ask}` };
    }
    if (!line) return "Pilih baris stok.";
    if (line.quantity + n < 0) return `Hasil akan negatif (stok ${fmtNum(line.quantity)}).`;
    return { row: { type: "adjustment", item_id: line.item_id, sku: line.sku, batch_lot: line.batch_lot, quantity: n, to_bin_id: bin.id, expiry_date: line.expiry_date, note, reason_code: reason },
      summary: `Adjustment ${n > 0 ? "+" : ""}${fmtNum(n)} SKU ${line.sku} di ${bin.bin_code} (${fmtNum(line.quantity)} → ${fmtNum(line.quantity + n)}). ${why}.${ask}` };
  }

  const [pending, setPending] = useState<{ row: Record<string, unknown>; summary: string } | null>(null);

  async function review(e: React.FormEvent) {
    e.preventDefault(); setError(null); setBusy(true);
    const res = await build(); setBusy(false);
    if (typeof res === "string") return setError(res);
    setPending(res); setStep("confirm");
  }

  async function commit() {
    if (!pending) return;
    setBusy(true); setError(null);
    const { sku: rowSku, ...row } = pending.row as Record<string, unknown> & { sku?: string };
    let error: { message: string } | null;
    if (needsApproval) {
      ({ error } = await supabase.rpc("request_adjustment", {
        p_bin_code: bin.bin_code, p_sku: rowSku, p_batch: row.batch_lot, p_expiry: row.expiry_date, p_qty: row.quantity,
        p_reason_code: row.reason_code, p_note: row.note, p_by_name: person,
      }));
    } else {
      const { data: auth } = await supabase.auth.getClaims();
      ({ error } = await supabase.from("movements").insert({ ...row, by_name: person.trim(), user_id: auth?.claims.sub }));
    }
    setBusy(false);
    if (error) { setError(error.message); setStep("form"); return; }
    onDone();
  }

  return (
    <DialogContent title={TITLES[action]} description={bin.bin_code}>
      {step === "confirm" && pending ? (
        <div className="space-y-4">
          <p className="rounded-md bg-plate/30 p-3 text-base">{pending.summary}</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="lg" onClick={() => setStep("form")}>Ubah</Button>
            <Button size="lg" onClick={commit} disabled={busy}>{busy ? "Menyimpan…" : needsApproval ? "Ajukan" : "Konfirmasi"}</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={review} className="space-y-4">
          {action === "putaway" && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={receiveNew} onChange={(e) => setReceiveNew(e.target.checked)} />
              Penerimaan baru (tanpa bin asal)
            </label>
          )}
          {action === "putaway" && !receiveNew && (
            <div><Label htmlFor="src">Bin asal</Label><Input id="src" value={srcCode} onChange={(e) => setSrcCode(e.target.value)} placeholder="STAGING / STG_01 / CA01A01" /></div>
          )}
          {action === "adjust" && lines.length > 0 && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={adjNewLine} onChange={(e) => setAdjNewLine(e.target.checked)} />
              Tambah SKU/batch yang belum tercatat di bin ini
            </label>
          )}

          {((action === "putaway" && receiveNew) || (action === "adjust" && adjNewLine)) ? (
            <>
              <div><Label htmlFor="sku">SKU</Label><Input id="sku" inputMode="numeric" value={sku} onChange={(e) => setSku(e.target.value)} required /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label htmlFor="batch">Batch/Lot</Label><Input id="batch" value={batch} onChange={(e) => setBatch(e.target.value)} /></div>
                <div><Label htmlFor="exp">Expired</Label><Input id="exp" type="date" value={expiry} onChange={(e) => { setExpiry(e.target.value); setExpiryOk(false); }} /></div>
              </div>
              {mismatch && (
                <div className="rounded-md bg-warn/15 p-2 text-sm">
                  Batch {batch.trim().toUpperCase()} → expired seharusnya <b>{fmtDate(mismatch.expected)}</b> ({MISMATCH_LABEL[mismatch.kind]}).{" "}
                  <button type="button" className="underline" onClick={() => setExpiry(mismatch.expected)}>Pakai tanggal ini</button>
                  <label className="mt-1 flex items-center gap-2"><input type="checkbox" checked={expiryOk} onChange={(e) => setExpiryOk(e.target.checked)} />Label karton memang tertulis {fmtDate(expiry)}</label>
                </div>
              )}
              {action === "putaway" && <p className="text-xs text-steel-500">Truk dari Shell sebaiknya diterima lewat halaman Penerimaan (dicocokkan dengan DO).</p>}
            </>
          ) : (
            <div>
              <Label htmlFor="line">Stok</Label>
              {pool.length === 0 ? <p className="text-sm text-steel-500">Tidak ada stok di bin {action === "putaway" ? "asal" : "ini"}.</p> : (
                <Select id="line" value={lineIdx} onChange={(e) => setLineIdx(Number(e.target.value))}>
                  {pool.map((l, i) => <option key={`${l.item_id}-${l.batch_lot}-${l.expiry_date}`} value={i}>{lineLabel(l)}</option>)}
                </Select>
              )}
              {fefoWarning && <p className="mt-1 text-xs text-warn">Ada batch dengan expired lebih awal. FEFO: ambil baris paling atas dulu.</p>}
            </div>
          )}

          {action === "transfer" && (
            <div><Label htmlFor="dst">Bin tujuan</Label><Input id="dst" value={dstCode} onChange={(e) => setDstCode(e.target.value)} placeholder="Scan atau ketik, mis. CB12A01" required /></div>
          )}

          <div>
            <Label htmlFor="qty">{action === "adjust" && !adjNewLine ? "Selisih (+ tambah / − kurang)" : "Jumlah"}</Label>
            <Input id="qty" type="number" inputMode="decimal" step="any" value={qty} onChange={(e) => setQty(e.target.value)} required />
          </div>
          {action === "adjust" && (
            <div>
              <Label htmlFor="reason">Kode alasan</Label>
              <Select id="reason" value={reason} onChange={(e) => setReason(e.target.value as ReasonCode)} required>
                <option value="">Pilih…</option>
                {MANUAL_REASONS.map((c) => <option key={c} value={c}>{REASON_CODES[c]}</option>)}
              </Select>
            </div>
          )}
          <div>
            <Label htmlFor="note">{action === "adjust" ? "Keterangan (wajib)" : "Catatan"}</Label>
            <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} required={action === "adjust"} placeholder={action === "adjust" ? "mis. hasil stock opname" : "opsional"} />
          </div>
          <PersonNameField value={person} onChange={setPerson} />
          {needsApproval && <p className="rounded-md bg-plate/30 p-2 text-sm">Di atas batas {fmtNum(limit ?? 0)} unit: adjustment ini diajukan dan baru berlaku setelah disetujui orang lain.</p>}
          {error && <p role="alert" className="rounded-md bg-bad/10 p-2 text-sm text-bad">{error}</p>}
          <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? "Memeriksa…" : "Lanjut ke konfirmasi"}</Button>
        </form>
      )}
    </DialogContent>
  );
}
