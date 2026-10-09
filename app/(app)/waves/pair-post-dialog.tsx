"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { BinLeftCheck } from "./bin-left-check";
import { ItemScanInput } from "@/components/app/item-scan-input";
import { PersonNameField, usePersonName } from "@/components/app/person-name";
import type { TaskRow } from "@/lib/allocator/picklist-from-tasks";
import { fmtNum } from "@/lib/utils";

/**
 * One picklist line of a broken pallet: pick N for the truck, then the rest
 * of the pallet to the pickface. Posts both tasks in one transaction
 * (post_pick_with_move, 0035). The rest is what is really left in the bin
 * after the pick, not the planned number.
 */
export function PairPostDialog({ pick: p, move: m, onDone }: { pick: TaskRow; move: TaskRow; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [different, setDifferent] = useState(false);
  const [left, setLeft] = useState<number | null>(null);
  const [pickQty, setPickQty] = useState(String(p.quantity));
  const [moveQty, setMoveQty] = useState(String(m.quantity));
  const [reason, setReason] = useState("");
  const [person, setPerson] = usePersonName();
  // After a successful posting: Cek sisa bin (0058) — is the pallet bin really empty now?
  const [checking, setChecking] = useState(false);
  const [scan, setScan] = useState("");
  const [scanned, setScanned] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const plannedPick = Number(p.quantity), plannedMove = Number(m.quantity);
  async function loadLeft() {
    const { data } = await createClient().from("inventory_detail").select("quantity")
      .eq("bin_code", p.from_bin).eq("sku", p.sku).eq("batch_lot", p.batch_lot);
    const l = (data ?? []).reduce((a, r) => a + Number(r.quantity), 0);
    setLeft(l); setMoveQty(String(Math.max(l - plannedPick, 0)));
  }

  const pk = different ? Number(pickQty) : plannedPick;
  // Everything left after the pick goes to the pickface unless the picker says otherwise.
  const rest = left === null ? plannedMove : Math.max(left - pk, 0);
  const mv = different ? Number(moveQty) : rest;
  const deviates = pk !== plannedPick || mv !== plannedMove;
  const wrongItem = scanned !== null && scanned !== p.sku;
  const invalid = person.trim().length < 2 || wrongItem || left === null
    || !Number.isFinite(pk) || pk < 0 || pk > plannedPick || pk > left
    || !Number.isFinite(mv) || mv < 0 || mv > left - pk
    || (deviates && different && !reason.trim());

  async function submit() {
    setBusy(true); setError(null);
    const { error } = await createClient().rpc("post_pick_with_move", {
      p_pick_id: p.id, p_move_id: m.id,
      p_pick_qty: pk === plannedPick ? null : pk, p_move_qty: mv === plannedMove ? null : mv,
      // Posting as planned with a different real rest: say why the move changed.
      p_reason: deviates ? (reason.trim() || `sisa palet sebenarnya ${fmtNum(left ?? 0)}`) : null,
      p_by_name: person, p_scanned: scanned,
    });
    setBusy(false);
    if (error) return setError(error.message);
    setChecking(true);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => {
      setOpen(o); setError(null);
      if (o) { setChecking(false); setDifferent(false); setPickQty(String(p.quantity)); setReason(""); setScan(""); setScanned(null); setLeft(null); loadLeft(); }
    }}>
      <DialogTrigger asChild><Button size="sm">Posting</Button></DialogTrigger>
      <DialogContent title="Posting pick + pindah sisa palet" description={`NO ${p.wave_no} · #${p.seq}`}>
        {checking ? <BinLeftCheck taskId={p.id} person={person} onDone={() => { setOpen(false); onDone(); }} /> : (
        <div className="space-y-4">
          <div className="space-y-1 rounded-md bg-plate/30 p-3 text-base">
            <p>1. Ambil <b>{fmtNum(plannedPick)} {p.uom ?? ""}</b> SKU {p.sku} batch {p.batch_lot || "–"} dari <b>{p.from_bin}</b> untuk shipment {p.shipment_number}.</p>
            <p>2. Sisa palet ({left === null ? "…" : fmtNum(rest)}) pindahkan ke pickface <b>{m.to_bin}</b>.</p>
          </div>
          {left !== null && left - plannedPick !== plannedMove && (
            <p className="rounded-md bg-warn/10 p-2 text-sm">Di {p.from_bin} sekarang {fmtNum(left)}: sisanya {fmtNum(Math.max(left - plannedPick, 0))}, bukan {fmtNum(plannedMove)} seperti rencana.</p>
          )}
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Hasil">
            <Button variant={different ? "outline" : "default"} aria-pressed={!different} onClick={() => setDifferent(false)}>Sesuai rencana</Button>
            <Button variant={different ? "default" : "outline"} aria-pressed={different}
              onClick={() => { setDifferent(true); setMoveQty(String(rest)); }}>Berbeda</Button>
          </div>
          {different && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="pp-pick">Diambil ke truk (0–{fmtNum(plannedPick)})</Label>
                  <Input id="pp-pick" type="number" inputMode="numeric" min={0} max={plannedPick} value={pickQty}
                    onChange={(e) => { setPickQty(e.target.value); if (left !== null) setMoveQty(String(Math.max(left - Number(e.target.value || 0), 0))); }} />
                </div>
                <div>
                  <Label htmlFor="pp-move">Sisa dipindah ke {m.to_bin}</Label>
                  <Input id="pp-move" type="number" inputMode="numeric" min={0} value={moveQty} onChange={(e) => setMoveQty(e.target.value)} />
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => setMoveQty("0")}>Sisa tetap di {p.from_bin} (tidak dipindah)</Button>
              <a href={`/inventory?tab=kosong&near=${p.from_bin}`} target="_blank" rel="noreferrer" className="ml-2 text-xs underline">
                Cari bin kosong terdekat dari {p.from_bin}</a>
              {left !== null && <p className="text-xs text-steel-500">Tetap di {p.from_bin} setelah ini: {fmtNum(Math.max(left - pk - mv, 0))}</p>}
              <div>
                <Label htmlFor="pp-reason">Alasan (wajib bila berbeda)</Label>
                <Input id="pp-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="mis. order hanya butuh 25" />
              </div>
            </div>
          )}
          <div>
            <Label htmlFor={`pp-scan-${p.id}`}>Scan barcode karton (disarankan)</Label>
            <ItemScanInput id={`pp-scan-${p.id}`} value={scan} onChange={setScan} onItem={(it) => setScanned(it?.sku ?? null)} placeholder="scan karton / ketik SKU" />
            {scanned === p.sku && <p className="mt-1 text-xs font-semibold text-ok">Barang sesuai: {p.sku}</p>}
            {wrongItem && <p className="mt-1 rounded-md bg-bad/10 p-2 text-sm font-semibold text-bad">Barang salah: yang di-scan {scanned}, tugas ini {p.sku}.</p>}
          </div>
          <PersonNameField id={`pp-person-${p.id}`} value={person} onChange={setPerson} label="Nama picker" />
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="lg" onClick={() => setOpen(false)}>Batal</Button>
            <Button size="lg" onClick={submit} disabled={busy || invalid}>{busy ? "Memproses…" : "Sudah dikerjakan"}</Button>
          </div>
        </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
