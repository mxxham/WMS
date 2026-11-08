import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/input";
import { PersonNameField, usePersonName } from "@/components/app/person-name";
import { codeRangeText, plannedCodes, type Owner } from "@/lib/racks";
import { cn, fmtNum } from "@/lib/utils";

const LEVELS = ["A", "B", "C", "D", "E"];

/** The next aisle code after the layout's last one (CH -> CI), skipping codes already in use. */
function nextAisle(order: string[]): string {
  const used = new Set(order);
  const last = order.filter((z) => /^C[A-Z]$/.test(z)).sort().pop() ?? "CA";
  for (let c = last.charCodeAt(1) + 1; c <= 90; c++) { const z = `C${String.fromCharCode(c)}`; if (!used.has(z)) return z; }
  return "";
}

/**
 * + Tambah rak: plan a new aisle (or the missing racks of one) as Rencana. Nothing can use the bins
 * until they are activated; the preview shows the codes and what already exists before anything is made.
 */
export function AddRacks({ aisleOrder }: { aisleOrder: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [aisle, setAisle] = useState(nextAisle(aisleOrder));
  const [bays, setBays] = useState(20);
  const [top, setTop] = useState("E");
  const [owner, setOwner] = useState<Owner>("SHELL");
  const [reason, setReason] = useState("");
  const [person, setPerson] = usePersonName();
  const [existing, setExisting] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const levels = LEVELS.slice(0, LEVELS.indexOf(top) + 1);
  const valid = /^C[A-Z]$/.test(aisle) && bays >= 1 && bays <= 20;
  const codes = useMemo(() => (valid ? plannedCodes(aisle, bays, levels) : []), [aisle, bays, top, valid]); // eslint-disable-line react-hooks/exhaustive-deps
  const isNewAisle = !aisleOrder.includes(aisle);

  // The database's own preview: how many of these codes already exist.
  useEffect(() => {
    if (!open || !valid) { setExisting(null); return; }
    let live = true;
    const t = setTimeout(async () => {
      const { data, error } = await createClient().rpc("plan_racks_preview", { p_aisle: aisle, p_bays: bays, p_levels: levels, p_owner: owner });
      if (!live) return;
      if (error) { setError(error.message); setExisting(null); return; }
      setError(null);
      setExisting(((data ?? []) as { exists: boolean }[]).filter((r) => r.exists).length);
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [open, aisle, bays, top, owner, valid]); // eslint-disable-line react-hooks/exhaustive-deps

  const fresh = existing === null ? null : codes.length - existing;

  async function run() {
    if (reason.trim().length < 3) return setError("Tulis alasannya (minimal 3 huruf).");
    if (person.trim().length < 2) return setError("Isi nama Anda dulu.");
    setBusy(true); setError(null);
    const { error } = await createClient().rpc("plan_racks", {
      p_aisle: aisle, p_bays: bays, p_levels: levels, p_owner: owner, p_reason: reason, p_by_name: person,
    });
    setBusy(false);
    if (error) return setError(error.message);
    setOpen(false); setReason("");
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setError(null); if (o) setAisle(nextAisle(aisleOrder)); }}>
      <DialogTrigger asChild><Button variant="accent" size="sm"><Plus className="h-4 w-4" />Tambah rak</Button></DialogTrigger>
      <DialogContent title="Tambah rak" description="Rak baru dicatat sebagai Rencana. Tidak bisa dipakai sampai diaktifkan saat raknya sudah berdiri.">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div><Label htmlFor="ar-aisle">Aisle</Label>
              <Input id="ar-aisle" value={aisle} maxLength={2} onChange={(e) => setAisle(e.target.value.toUpperCase())} autoCapitalize="characters" /></div>
            <div><Label htmlFor="ar-bays">Rak per sisi</Label>
              <Input id="ar-bays" type="number" min={1} max={20} value={bays} onChange={(e) => setBays(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} /></div>
            <div><Label htmlFor="ar-top">Level</Label>
              <Select id="ar-top" value={top} onChange={(e) => setTop(e.target.value)}>
                {LEVELS.map((l) => <option key={l} value={l}>{l === "A" ? "A saja" : `A–${l}`}</option>)}
              </Select></div>
            <div><Label htmlFor="ar-owner">Dipakai</Label>
              <Select id="ar-owner" value={owner} onChange={(e) => setOwner(e.target.value as Owner)}>
                <option value="SHELL">Shell</option><option value="CKB">CKB 3PL</option>
              </Select></div>
          </div>

          {/* The new block, drawn the way Denah will show it: two back-to-back faces, dotted until built. */}
          {valid && (
            <figure className="rounded-lg bg-[#DDE3E8] p-3">
              <div className="flex items-center gap-2">
                <span className="w-9 text-center font-cond text-lg font-bold text-ckb">{aisle}</span>
                <div className="flex-1 space-y-px rounded-sm p-px outline outline-1 outline-dotted outline-ckb">
                  {[0, 1].map((f) => (
                    <div key={f} className="grid grid-cols-[repeat(20,minmax(0,1fr))] gap-px">
                      {Array.from({ length: 20 }, (_, i) => (
                        <span key={i} className={cn("h-3", i < bays ? "bg-paper outline outline-1 -outline-offset-1 outline-dotted outline-ckb" : "")} />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
              <figcaption className="mt-2 text-xs text-steel-700">
                {isNewAisle ? `Aisle baru, di belakang ${aisleOrder[aisleOrder.length - 1] ?? "aisle terakhir"} di denah dan 3D.` : `Menambah rak yang belum ada di aisle ${aisle}.`}
              </figcaption>
            </figure>
          )}

          {valid && (
            <p className="rounded-md bg-plate/30 p-3 text-base">
              {fresh === null ? `Memeriksa ${fmtNum(codes.length)} bin…`
                : fresh === 0 ? `Semua ${fmtNum(codes.length)} bin rak itu sudah ada.`
                : `Rencanakan ${fmtNum(fresh)} bin ${codeRangeText(codes).replace(/ \(\d+ bin\)$/, "")} untuk ${owner === "CKB" ? "CKB 3PL" : "Shell"}`
                  + `${existing ? `; ${fmtNum(existing)} bin sudah ada dan tidak diubah` : ""}.`}
            </p>
          )}
          <div><Label htmlFor="ar-reason">Alasan</Label>
            <Input id="ar-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="mis. rak tambahan Q1 2027" /></div>
          <PersonNameField id="ar-name" value={person} onChange={setPerson} label="Nama Anda" />
          {!valid && <p className="text-sm text-bad">Aisle harus seperti CI (C + satu huruf), rak per sisi 1-20.</p>}
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="lg" onClick={() => setOpen(false)}>Batal</Button>
            <Button size="lg" onClick={run} disabled={busy || !valid || !fresh}>{busy ? "Memproses…" : "Rencanakan rak"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Aktifkan (built) or Batalkan rencana (never built) for the planned bins of the selection. */
export function PlannedDialog({ codes, mode, onDone }: { codes: string[]; mode: "activate" | "cancel"; onDone: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [person, setPerson] = usePersonName();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = mode === "activate" ? "Aktifkan" : "Batalkan rencana";
  const range = codeRangeText(codes).replace(/ \(\d+ bin\)$/, "");

  async function run() {
    if (reason.trim().length < 3) return setError("Tulis alasannya (minimal 3 huruf).");
    setBusy(true); setError(null);
    const { data, error } = await createClient().rpc(mode === "activate" ? "activate_planned" : "cancel_planned",
      { p_codes: codes, p_reason: reason, p_by_name: person });
    setBusy(false);
    if (error) return setError(error.message);
    const refused = ((data as { refused?: { bin_code: string; reason: string }[] })?.refused ?? []);
    if (refused.length) return setError(`${fmtNum(refused.length)} bin tidak diubah: ${refused.slice(0, 5).map((r) => `${r.bin_code} (${r.reason})`).join(", ")}${refused.length > 5 ? ", …" : ""}`);
    setOpen(false); onDone(); router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setError(null); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant={mode === "cancel" ? "danger" : "accent"}>{label}</Button>
      </DialogTrigger>
      <DialogContent title={label}>
        <div className="space-y-4">
          <p className="rounded-md bg-plate/30 p-3 text-base">
            {mode === "activate"
              ? `Aktifkan ${fmtNum(codes.length)} bin ${range}: rak sudah berdiri, bin bisa dipakai dan labelnya bisa dicetak.`
              : `Batalkan rencana ${fmtNum(codes.length)} bin ${range}: bin dihapus dari denah. Bin yang sudah pernah dipakai tidak dihapus.`}
          </p>
          <div><Label htmlFor={`pd-reason-${mode}`}>Alasan</Label><Input id={`pd-reason-${mode}`} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          <PersonNameField id={`pd-name-${mode}`} value={person} onChange={setPerson} label="Nama Anda" />
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="lg" onClick={() => setOpen(false)}>Batal</Button>
            <Button size="lg" variant={mode === "cancel" ? "danger" : "default"} onClick={run} disabled={busy}>{busy ? "Memproses…" : label}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
