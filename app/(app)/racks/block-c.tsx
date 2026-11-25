"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { PersonNameField, usePersonName } from "@/components/app/person-name";
import { BLOCK_C_LANES, BLOCK_C_SLOTS_PER_LANE, palletsPerSlot } from "@/config/warehouse";
import { packOf } from "@/lib/inbound/putaway-plan";
import { codeRangeText, STATE_LABEL } from "@/lib/racks";
import { cn, fmtNum } from "@/lib/utils";
import type { Role } from "@/lib/types";
import { PlannedDialog } from "./add-racks";
import type { BlockCSlot } from "./racks-data";

/**
 * Block C (0147): the second building's floor slots, FA-01..FA-20 facing FB-01..FB-20. Each slot has ONE dedicated SKU
 * and a stack height set by the SKU's pack type. Slots are planned, activated when the floor is marked, then given a SKU.
 */
export function BlockCPanel({ slots, role }: { slots: BlockCSlot[]; role: Role }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const admin = role === "admin", can = admin || role === "supervisor";
  const lanes = useMemo(() => {
    const names = [...new Set(slots.map((s) => s.bin_code.slice(0, 2)))].sort();
    const rows = Math.max(0, ...slots.map((s) => Number(s.bin_code.slice(3))));
    return { names, rows };
  }, [slots]);
  const by = useMemo(() => new Map(slots.map((s) => [s.bin_code, s])), [slots]);
  const sel = slots.filter((s) => selected.has(s.bin_code));
  const clear = () => setSelected(new Set());
  const toggle = (code: string) => setSelected((s) => { const n = new Set(s); if (n.has(code)) n.delete(code); else n.add(code); return n; });
  const planned = sel.filter((s) => s.state === "PLANNED").map((s) => s.bin_code);
  const codes = sel.map((s) => s.bin_code);
  const usable = slots.filter((s) => s.state === "ACTIVE" && s.assigned_sku);
  const totals = {
    slots: slots.length, active: slots.filter((s) => s.state === "ACTIVE").length, withSku: slots.filter((s) => s.assigned_sku).length,
    pallets: usable.reduce((n, s) => n + s.pallets, 0), room: usable.reduce((n, s) => n + (s.capacity ?? 0), 0),
    cartons: slots.reduce((n, s) => n + s.qty, 0),
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-steel-500">
          {slots.length === 0
            ? "Block C belum punya slot. Rencanakan slotnya dulu, lalu aktifkan saat garis lantainya sudah dibuat."
            : `${fmtNum(totals.slots)} slot · ${fmtNum(totals.active)} aktif · ${fmtNum(totals.withSku)} sudah punya SKU · ${fmtNum(totals.pallets)} dari ${fmtNum(totals.room)} palet terisi (${fmtNum(totals.cartons)} karton). Satu slot satu SKU; SKU Block C tidak bisa masuk Oso 5 dan SKU lain tidak bisa masuk Block C.`}
        </p>
        {admin && <div className="ml-auto"><PlanSlots /></div>}
      </div>

      {slots.length > 0 && (
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.max(lanes.names.length, 1)}, minmax(0, 1fr))` }}>
          {lanes.names.map((lane) => (
            <div key={lane} className="space-y-1">
              <p className="font-cond text-lg font-bold text-ckb">Jalur {lane}</p>
              {Array.from({ length: lanes.rows }, (_, i) => {
                const code = `${lane}-${String(i + 1).padStart(2, "0")}`, s = by.get(code);
                if (!s) return <div key={code} className="h-12 rounded-md border border-dashed border-steel-100" />;
                const on = selected.has(code);
                return (
                  <button key={code} onClick={() => toggle(code)} aria-pressed={on}
                    className={cn("flex h-12 w-full items-center gap-2 rounded-md border px-2 text-left text-sm",
                      on ? "border-ckb bg-ckb/10" : "border-steel-100 bg-paper hover:border-steel-300",
                      s.state !== "ACTIVE" && "border-dashed text-steel-500")}>
                    <span className="w-14 font-mono font-semibold">{code}</span>
                    <span className="min-w-0 flex-1 truncate">{s.assigned_sku ?? <span className="text-steel-500">belum ada SKU</span>}</span>
                    {s.state !== "ACTIVE" && <span className="text-xs">{STATE_LABEL[s.state]}</span>}
                    {s.assigned_sku && s.capacity !== null && <span className="tabular text-xs">{s.pallets}/{s.capacity} palet</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {sel.length > 0 && (
        <div className="sticky bottom-3 flex flex-wrap items-center gap-2 rounded-lg bg-ckb p-3 text-white">
          <span className="text-sm font-semibold">{fmtNum(sel.length)} slot dipilih ({codeRangeText(codes).replace(/ \(\d+ bin\)$/, "")})</span>
          <div className="ml-auto flex flex-wrap gap-2">
            {admin && planned.length > 0 && <PlannedDialog codes={planned} mode="activate" onDone={clear} />}
            {admin && planned.length > 0 && <PlannedDialog codes={planned} mode="cancel" onDone={clear} />}
            {can && <AssignDialog codes={codes} onDone={clear} />}
            {can && sel.some((s) => s.assigned_sku) && <AssignDialog codes={codes} onDone={clear} clearing />}
            <Button size="sm" variant="outline" className="border-white/30 bg-white/10 text-white hover:bg-white/20" onClick={clear}>Batal pilih</Button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Plan the 40 slots (or more) as Rencana (plan_block_c_slots). */
function PlanSlots() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [slotsPerLane, setSlotsPerLane] = useState(BLOCK_C_SLOTS_PER_LANE);
  const [reason, setReason] = useState("");
  const [person, setPerson] = usePersonName();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    if (reason.trim().length < 3) return setError("Tulis alasannya (minimal 3 huruf).");
    if (person.trim().length < 2) return setError("Isi nama Anda dulu.");
    setBusy(true); setError(null);
    const { error } = await createClient().rpc("plan_block_c_slots", { p_lanes: [...BLOCK_C_LANES], p_slots: slotsPerLane, p_reason: reason, p_by_name: person });
    setBusy(false);
    if (error) return setError(error.message);
    setOpen(false); setReason(""); router.refresh();
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setError(null); }}>
      <DialogTrigger asChild><Button variant="accent" size="sm">Rencanakan slot</Button></DialogTrigger>
      <DialogContent title="Rencanakan slot Block C" description="Slot baru dicatat sebagai Rencana: belum bisa dipakai sampai diaktifkan.">
        <div className="space-y-4">
          <p className="rounded-md bg-plate/30 p-3 text-base">
            Buat jalur {BLOCK_C_LANES.join(" dan ")}, masing-masing {fmtNum(slotsPerLane)} slot ({BLOCK_C_LANES[0]}-01 … {BLOCK_C_LANES[1]}-{String(slotsPerLane).padStart(2, "0")}). Slot yang sudah ada tidak diubah.
          </p>
          <div><Label htmlFor="pb-n">Slot per jalur</Label>
            <Input id="pb-n" type="number" min={1} max={99} value={slotsPerLane} onChange={(e) => setSlotsPerLane(Math.max(1, Math.min(99, Number(e.target.value) || 1)))} /></div>
          <div><Label htmlFor="pb-reason">Alasan</Label><Input id="pb-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          <PersonNameField id="pb-name" value={person} onChange={setPerson} label="Nama Anda" />
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="lg" onClick={() => setOpen(false)}>Batal</Button>
            <Button size="lg" onClick={run} disabled={busy}>{busy ? "Memproses…" : "Rencanakan slot"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Give the selected slots one dedicated SKU (or clear it). The stack height comes from the SKU's pack type. */
function AssignDialog({ codes, onDone, clearing = false }: { codes: string[]; onDone: () => void; clearing?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sku, setSku] = useState("");
  const [reason, setReason] = useState("");
  const [person, setPerson] = usePersonName();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const range = codeRangeText(codes).replace(/ \(\d+ bin\)$/, "");

  async function run() {
    const code = sku.trim();
    if (!clearing && !code) return setError("Isi SKU-nya.");
    if (reason.trim().length < 3) return setError("Tulis alasannya (minimal 3 huruf).");
    if (person.trim().length < 2) return setError("Isi nama Anda dulu.");
    setBusy(true); setError(null);
    const supabase = createClient();
    let pallets: number | null = null;
    if (!clearing) {
      const { data: item, error: e1 } = await supabase.from("items").select("sku, uom, description").eq("sku", code).maybeSingle();
      if (e1 || !item) { setBusy(false); return setError(e1?.message ?? `SKU ${code} tidak ada di Master item.`); }
      pallets = palletsPerSlot(packOf(item.sku as string, (item.uom as string | null) ?? null, (item.description as string) ?? ""));
    }
    const { data, error: e2 } = await supabase.rpc("assign_block_c_slots", {
      p_codes: codes, p_sku: clearing ? "" : code, p_pallets: pallets, p_reason: reason, p_by_name: person,
    });
    setBusy(false);
    if (e2) return setError(e2.message);
    const refused = ((data as { refused?: { bin_code: string; reason: string }[] })?.refused ?? []);
    if (refused.length) return setError(`${fmtNum(refused.length)} slot tidak diubah: ${refused.slice(0, 5).map((r) => `${r.bin_code} (${r.reason})`).join(", ")}${refused.length > 5 ? ", …" : ""}`);
    setOpen(false); setReason(""); onDone(); router.refresh();
  }

  const label = clearing ? "Kosongkan SKU" : "Tentukan SKU";
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setError(null); }}>
      <DialogTrigger asChild><Button size="sm" variant={clearing ? "outline" : "accent"} className={clearing ? "border-white/30 bg-white/10 text-white hover:bg-white/20" : undefined}>{label}</Button></DialogTrigger>
      <DialogContent title={label}>
        <div className="space-y-4">
          <p className="rounded-md bg-plate/30 p-3 text-base">
            {clearing
              ? `Lepas SKU dari ${fmtNum(codes.length)} slot ${range}. Slot yang masih berisi stok tidak diubah.`
              : `Slot ${range} (${fmtNum(codes.length)} slot) khusus untuk satu SKU ini. Satu slot berisi 14 posisi palet; tinggi tumpukan mengikuti jenis kemasannya: drum 3, karton 2, lainnya 2.`}
          </p>
          {!clearing && <div><Label htmlFor="as-sku">SKU</Label><Input id="as-sku" value={sku} onChange={(e) => setSku(e.target.value)} inputMode="numeric" /></div>}
          <div><Label htmlFor="as-reason">Alasan</Label><Input id="as-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          <PersonNameField id="as-name" value={person} onChange={setPerson} label="Nama Anda" />
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="lg" onClick={() => setOpen(false)}>Batal</Button>
            <Button size="lg" onClick={run} disabled={busy}>{busy ? "Memproses…" : label}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
