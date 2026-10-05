"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Pencil, Scissors, Undo2, Wrench } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PersonNameField, usePersonName } from "@/components/app/person-name";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { DEFAULT_CONFIG } from "@/lib/allocator/config";
import type { TaskRow } from "@/lib/allocator/picklist-from-tasks";
import { cn, fmtDate, fmtNum } from "@/lib/utils";
import { proposeFix, type FixClaim, type FixProposal, type FixStock } from "@/lib/wave-fix";
import { binDistance, distanceLabel, parseBin, type BinParts } from "@/lib/bin-distance";

/** A dialog with the person's name, a reason and an action; closes and refreshes on success. */
function CorrectionDialog({ trigger, title, children, confirmLabel, run, ready = true }: {
  trigger: React.ReactNode; title: string; children?: React.ReactNode; confirmLabel: string; ready?: boolean;
  run: (person: string, reason: string) => Promise<string | null>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [person, setPerson] = usePersonName();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (person.trim().length < 2) return setError("Isi nama Anda.");
    if (!reason.trim()) return setError("Isi alasannya.");
    setBusy(true); setError(null);
    const err = await run(person, reason);
    setBusy(false);
    if (err) return setError(err);
    setOpen(false); setReason(""); router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setError(null); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={title}>
        <div className="space-y-4">
          {children}
          <div>
            <Label htmlFor="corr-reason">Alasan (wajib)</Label>
            <Input id="corr-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="mis. salah input jumlah" />
          </div>
          <PersonNameField id="corr-person" value={person} onChange={setPerson} label="Nama Anda" />
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="lg" onClick={() => setOpen(false)}>Batal</Button>
            <Button size="lg" onClick={submit} disabled={busy || !ready}>{busy ? "Memproses…" : confirmLabel}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** "Batalkan posting" (0034): stock goes back as the posting took it, the task opens again. */
export function UnpostButton({ task: t }: { task: TaskRow }) {
  const qty = Number(t.actual_quantity ?? t.quantity);
  const from = t.actual_from_bin ?? t.from_bin;
  const what = t.task_type === "PICK"
    ? `${fmtNum(qty)} ${t.uom ?? ""} SKU ${t.sku} kembali ke ${from} (barang fisik juga dikembalikan ke bin itu).`
    : `${fmtNum(qty)} ${t.uom ?? ""} SKU ${t.sku} kembali dari ${t.to_bin} ke ${from}.`;
  return (
    <CorrectionDialog title={`Batalkan posting #${t.seq}`} confirmLabel="Batalkan posting"
      trigger={<Button size="sm" variant="ghost" className="underline"><Undo2 className="h-4 w-4" />Batalkan posting</Button>}
      run={async (person, reason) => {
        const { error } = await createClient().rpc("unpost_task", { p_task_id: t.id, p_by_name: person, p_reason: reason });
        return error?.message ?? null;
      }}>
      <p className="rounded-md bg-plate/30 p-3 text-base">Posting dibatalkan: {what} Tugas jadi belum dikerjakan; posting lagi dengan jumlah / bin yang benar.</p>
      <p className="text-xs text-steel-500">Posting lama dan pembatalannya tetap tercatat di riwayat stok. Wave yang sudah selesai dibuka lagi.</p>
    </CorrectionDialog>
  );
}

/** "Ubah jumlah order" (0034): the real quantity of one order line; open picks follow when it goes down. */
export function OrderQtyButton({ waveId, shipment, sku, description, requested, picked }: {
  waveId: string; shipment: string; sku: string; description: string; requested: number; picked: number;
}) {
  const [qty, setQty] = useState(String(requested));
  const n = Number(qty);
  const valid = qty.trim() !== "" && Number.isFinite(n) && n >= 0 && n !== requested;
  return (
    <CorrectionDialog title={`Ubah jumlah order ${sku}`} confirmLabel="Simpan jumlah" ready={valid}
      trigger={<Button size="sm" variant="ghost" className="underline"><Pencil className="h-3.5 w-3.5" />Ubah</Button>}
      run={async (person, reason) => {
        const { error } = await createClient().rpc("set_order_quantity", {
          p_wave_id: waveId, p_shipment: shipment, p_sku: sku, p_quantity: n, p_by_name: person, p_reason: reason,
        });
        return error?.message ?? null;
      }}>
      <p className="text-sm">SH {shipment} · {description} · order sekarang <b>{fmtNum(requested)}</b>, sudah diambil {fmtNum(picked)}.</p>
      <div>
        <Label htmlFor="order-qty">Jumlah order yang benar</Label>
        <Input id="order-qty" type="number" inputMode="numeric" min={0} value={qty} onChange={(e) => setQty(e.target.value)} className="h-12 text-lg" />
      </div>
      {valid && n < requested && (
        <p className="rounded-md bg-plate/30 p-2 text-sm">Kurang {fmtNum(requested - n)}: tugas pick yang belum diposting dikurangi (mulai dari palet yang dibuka).
          Sisa palet ikut ke relokasi pickface. Pick yang sudah diposting tidak berubah: pakai Batalkan posting bila perlu.</p>
      )}
      {valid && n > requested && (
        <p className="rounded-md bg-warn/10 p-2 text-sm">Tambah {fmtNum(n - requested)}: hanya order yang dicatat; kekurangannya tampil sampai wave dihitung ulang.</p>
      )}
    </CorrectionDialog>
  );
}

/**
 * "Batalkan posting" of a pick + its pallet move (0035). Both go back in one
 * step, or — 5 Oct, NO 1 put on Tunda after posting — the pick alone: its
 * cartons return from the truck while the move stays done, because the rest
 * really is in the pickface and other waves have picked from it already
 * (undoing the move then fails: "available 24, requested 28").
 */
export function UnpostPairButton({ pick: p, move: m }: { pick: TaskRow; move: TaskRow }) {
  const picked = Number(p.actual_quantity ?? p.quantity), moved = Number(m.actual_quantity ?? m.quantity);
  const src = p.actual_from_bin ?? p.from_bin;
  const [scope, setScope] = useState<"both" | "pick">("both");
  // What the pickface still holds of this batch: below what was moved in, the move cannot be undone.
  const [atDest, setAtDest] = useState<number | null>(null);
  const moveUndoable = atDest === null || atDest >= moved;
  async function check() {
    setScope("both"); setAtDest(null);
    const { data } = await createClient().from("inventory_detail").select("quantity")
      .eq("bin_code", m.to_bin ?? "").eq("sku", m.sku).eq("batch_lot", m.actual_batch_lot ?? m.batch_lot);
    const have = (data ?? []).reduce((a, r) => a + Number(r.quantity), 0);
    setAtDest(have);
    if (have < moved) setScope("pick");
  }
  return (
    <CorrectionDialog title={`Batalkan posting #${p.seq}`} confirmLabel="Batalkan posting"
      trigger={<Button size="sm" variant="ghost" className="underline" onClick={() => void check()}><Undo2 className="h-4 w-4" />Batalkan posting</Button>}
      run={async (person, reason) => {
        const { error } = scope === "pick"
          ? await createClient().rpc("unpost_task", { p_task_id: p.id, p_by_name: person, p_reason: reason })
          : await createClient().rpc("unpost_pick_with_move", { p_pick_id: p.id, p_move_id: m.id, p_by_name: person, p_reason: reason });
        if (error && scope === "both" && /insufficient stock|stok/i.test(error.message)) {
          return `${error.message}. Sebagian sisa di ${m.to_bin} sudah diambil tugas lain: pilih "Pick saja" agar Bin To Bin tetap.`;
        }
        return error?.message ?? null;
      }}>
      <div className="space-y-2 text-sm">
        <label className="flex items-start gap-2">
          <input type="radio" name={`unpost-${p.id}`} checked={scope === "both"} disabled={!moveUndoable} onChange={() => setScope("both")} className="mt-1" />
          <span className={cn(!moveUndoable && "text-steel-500")}><b>Pick dan Bin To Bin</b>: {fmtNum(moved)} dari {m.to_bin} dan {fmtNum(picked)} dari truk kembali ke {src}.
            {!moveUndoable && <> Tidak bisa: di {m.to_bin} tinggal {fmtNum(atDest ?? 0)} dari {fmtNum(moved)} yang dipindah (sebagian sudah diambil wave lain).</>}</span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" name={`unpost-${p.id}`} checked={scope === "pick"} onChange={() => setScope("pick")} className="mt-1" />
          <span><b>Pick saja</b>: {fmtNum(picked)} dari truk kembali ke {src}; sisa {fmtNum(moved)} tetap di {m.to_bin} (Bin To Bin tetap selesai). Pakai bila sisa itu sudah dipakai wave lain.</span>
        </label>
      </div>
      <p className="rounded-md bg-plate/30 p-3 text-base">
        {scope === "both"
          ? <>Posting dibatalkan: {fmtNum(moved)} dari {m.to_bin} dan {fmtNum(picked)} dari truk kembali ke {src} (barang fisik juga dikembalikan). Baris jadi belum dikerjakan; posting lagi dengan jumlah yang benar.</>
          : <>Pick #{p.seq} dibatalkan: {fmtNum(picked)} karton dari truk kembali ke {src} (taruh fisiknya di sana). Bin To Bin ke {m.to_bin} tetap tercatat selesai; pick jadi belum dikerjakan.</>}
      </p>
      <p className="text-xs text-steel-500">Posting lama dan pembatalannya tetap tercatat di riwayat stok.</p>
    </CorrectionDialog>
  );
}

/**
 * "Tambah Bin To Bin" (0045): a move for what a pick leaves in its bin, when
 * the plan made none. Suggests the SKU's pickface and the nearest empty
 * Level-A bins; the move lands right after the pick and posts with it.
 */
export function AddMoveButton({ task: t }: { task: TaskRow }) {
  const from = t.actual_from_bin ?? t.from_bin;
  const [have, setHave] = useState<number | null>(null);
  const [suggest, setSuggest] = useState<Target[]>([]);
  const [to, setTo] = useState("");
  const [qty, setQty] = useState("");
  const rest = have === null ? null : Math.max(have - (t.status === "PLANNED" ? Number(t.quantity) : 0), 0);

  async function load() {
    const [{ data: inv }, targets] = await Promise.all([
      createClient().from("inventory_detail").select("quantity").eq("bin_code", from).eq("sku", t.sku).eq("batch_lot", t.actual_batch_lot ?? t.batch_lot),
      moveTargets(from, t.sku),
    ]);
    const h = (inv ?? []).reduce((a, r) => a + Number(r.quantity), 0);
    setHave(h);
    setQty(String(Math.max(h - (t.status === "PLANNED" ? Number(t.quantity) : 0), 0)));
    setSuggest(targets);
    setTo(targets[0]?.bin ?? "");
  }

  const ready = targetReady(to, qty);
  return (
    <CorrectionDialog title={`Tambah Bin To Bin #${t.seq}`} confirmLabel="Tambah Bin To Bin" ready={ready}
      trigger={<Button size="sm" variant="ghost" className="underline" onClick={() => { if (have === null) void load(); }}><ArrowRightLeft className="h-4 w-4" />Tambah Bin To Bin</Button>}
      run={async (person, reason) => {
        const { error } = await createClient().rpc("add_relocation", {
          p_task_id: t.id, p_to_bin: to.trim().toUpperCase(), p_qty: Number(qty), p_by_name: person, p_reason: reason,
        });
        return error?.message ?? null;
      }}>
      <p className="rounded-md bg-plate/30 p-3 text-sm">
        {from} · {t.sku} batch {t.actual_batch_lot ?? t.batch_lot}: {have === null ? "memuat…" : <>di bin sekarang <b>{fmtNum(have)}</b>
        {t.status === "PLANNED" && <>, pick ini {fmtNum(Number(t.quantity))}</>}, sisa <b>{fmtNum(rest ?? 0)}</b></>}.
        Sisa dipindah ke bin level A; pick dan pindahnya diposting bersama.
      </p>
      <TargetFields suggest={suggest} to={to} setTo={setTo} qty={qty} setQty={setQty} />
    </CorrectionDialog>
  );
}

type Target = { bin: string; note: string };
/** Pillars, not bins (config blockedBins): some still exist as empty bins in the database, never suggest them. */
const PHANTOM = new Set(DEFAULT_CONFIG.blockedBins);

/** Where a pallet's rest can go: the SKU's pickface, then the nearest empty Level-A bins. */
async function moveTargets(from: string, sku: string, except?: string | null): Promise<Target[]> {
  const db = createClient();
  const [{ data: pf }, { data: empty }] = await Promise.all([
    db.from("pickface_detail").select("bin_code").eq("sku", sku),
    db.from("empty_bins").select("bin_code, zone, rack, level, position").eq("level", "A").range(0, 2999),
  ]);
  const src = parseBin(from);
  const near = src ? ((empty ?? []) as (BinParts & { bin_code: string })[]).filter((b) => !PHANTOM.has(b.bin_code))
    .map((b) => ({ b, d: binDistance(src, b) })).sort((a, c) => a.d - c.d).slice(0, 5)
    .map(({ b }) => ({ bin: b.bin_code, note: `kosong · ${distanceLabel(src, b)}` })) : [];
  const pfs = ((pf ?? []) as { bin_code: string }[]).filter((p) => p.bin_code !== from).map((p) => ({ bin: p.bin_code, note: "pickface SKU ini" }));
  return [...pfs, ...near].filter((t) => t.bin !== except);
}

const targetReady = (to: string, qty: string) => /^[A-Z0-9_]{3,20}$/.test(to.trim().toUpperCase()) && Number(qty) > 0;

function TargetFields({ suggest, to, setTo, qty, setQty }: {
  suggest: Target[]; to: string; setTo: (v: string) => void; qty: string; setQty: (v: string) => void;
}) {
  return (
    <>
      {suggest.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {suggest.map((s) => (
            <Button key={s.bin} size="sm" variant={to === s.bin ? "default" : "outline"} onClick={() => setTo(s.bin)} title={s.note}>
              {s.bin}<span className="ml-1 text-[10px] font-normal opacity-80">{s.note}</span></Button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div><Label htmlFor="mv-to">Ke bin</Label><Input id="mv-to" value={to} onChange={(e) => setTo(e.target.value.toUpperCase())} placeholder="mis. CB12A01" /></div>
        <div><Label htmlFor="mv-qty">Jumlah</Label><Input id="mv-qty" type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} /></div>
      </div>
    </>
  );
}

/** "Pecah" (0046): split an open pick in two, so each part can be posted from its own bin. */
export function SplitButton({ task: t }: { task: TaskRow }) {
  const total = Number(t.quantity);
  const [keep, setKeep] = useState("");
  const k = Number(keep);
  const ready = Number.isFinite(k) && k >= 1 && k < total;
  return (
    <CorrectionDialog title={`Pecah tugas #${t.seq}`} confirmLabel="Pecah" ready={ready}
      trigger={<Button size="sm" variant="ghost" className="underline"><Scissors className="h-4 w-4" />Pecah</Button>}
      run={async (person) => {
        const { error } = await createClient().rpc("split_task", { p_task_id: t.id, p_keep: k, p_by_name: person });
        return error?.message ?? null;
      }}>
      <p className="rounded-md bg-plate/30 p-3 text-sm">
        #{t.seq}: {fmtNum(total)} {t.uom ?? ""} SKU {t.sku} dari {t.from_bin}. Dipecah jadi dua tugas untuk shipment yang sama;
        tiap bagian bisa diposting dari bin berbeda (Berbeda).
      </p>
      <div>
        <Label htmlFor="sp-keep">Tetap di tugas ini ({t.from_bin})</Label>
        <Input id="sp-keep" type="number" min={1} max={total - 1} value={keep} onChange={(e) => setKeep(e.target.value)} placeholder={`1–${total - 1}`} />
        {ready && <p className="mt-1 text-sm">Tugas baru: <b>{fmtNum(total - k)}</b>, tepat di bawahnya.</p>}
      </div>
    </CorrectionDialog>
  );
}

/** One bin + batch + expiry row of a SKU; `others` is what other open tasks (not this row) already take from it. */
/** `by`: those other open rows, e.g. "NO 7 #8 ambil 1", "NO 7 #9 pindah 5 → CC14A01". */
type SourceRow = { bin: string; batch: string; expiry: string | null; qty: number; others: number; by: string[] };
const sourceKey = (bin: string, batch: string, expiry: string | null) => `${bin}|${batch}|${expiry ?? ""}`;

/** Every row of the SKU in the database, with what OTHER open tasks take — this pick and its own move excluded. */
async function loadSourceRows(sku: string, exclude: string[]): Promise<SourceRow[]> {
  const db = createClient();
  const [{ data: inv }, { data: open }] = await Promise.all([
    db.from("inventory_detail").select("bin_code, batch_lot, expiry_date, quantity").eq("sku", sku).range(0, 2999),
    db.from("pick_task_detail").select("id, wave_no, seq, task_type, from_bin, to_bin, batch_lot, expiry_date, quantity")
      .eq("sku", sku).eq("status", "PLANNED").in("wave_status", ["PENDING", "RESCHEDULED"]).range(0, 2999),
  ]);
  const taken = new Map<string, { q: number; by: string[] }>();
  for (const o of (open ?? []) as { id: string; wave_no: string; seq: number; task_type: string; from_bin: string; to_bin: string | null;
    batch_lot: string; expiry_date: string | null; quantity: number }[]) {
    if (exclude.includes(o.id)) continue;
    const k = sourceKey(o.from_bin, o.batch_lot, o.expiry_date);
    const e = taken.get(k) ?? { q: 0, by: [] };
    e.q += Number(o.quantity);
    e.by.push(`NO ${o.wave_no} #${o.seq} ${o.task_type === "PICK" ? `ambil ${fmtNum(Number(o.quantity))}` : `pindah ${fmtNum(Number(o.quantity))} → ${o.to_bin}`}`);
    taken.set(k, e);
  }
  const rows = new Map<string, SourceRow>();
  for (const r of (inv ?? []) as { bin_code: string; batch_lot: string; expiry_date: string | null; quantity: number }[]) {
    const k = sourceKey(r.bin_code, r.batch_lot, r.expiry_date);
    const e = rows.get(k) ?? { bin: r.bin_code, batch: r.batch_lot, expiry: r.expiry_date, qty: 0, others: taken.get(k)?.q ?? 0, by: taken.get(k)?.by ?? [] };
    e.qty += Number(r.quantity);
    rows.set(k, e);
  }
  return [...rows.values()].filter((s) => s.qty > 0)
    .sort((a, b) => (a.expiry ?? "9999").localeCompare(b.expiry ?? "9999") || a.bin.localeCompare(b.bin));
}

/**
 * "Ubah baris" (0052): makes an open row match the printed picklist in one
 * dialog — the pick's source (any bin, any batch; a later expiry is warned,
 * never blocked) and its Bin To Bin (change, add or remove). Replaces Ubah
 * Bin Pick, Tambah Bin To Bin and Ubah Bin To Bin on open rows.
 */
export function EditRowButton({ pick, move }: { pick: TaskRow; move?: TaskRow | null }) {
  const curBin = pick.from_bin;
  const curBatch = pick.actual_batch_lot ?? pick.batch_lot;
  const curExpiry = pick.actual_expiry_date ?? pick.expiry_date;
  const curKey = sourceKey(curBin, curBatch, curExpiry);
  const qty = Number(pick.quantity);
  const [rows, setRows] = useState<SourceRow[] | null>(null);
  const [sel, setSel] = useState<SourceRow | null>(null);
  const [typed, setTyped] = useState("");
  const [moveTo, setMoveTo] = useState(move?.to_bin ?? "");
  const [moveQty, setMoveQty] = useState<string | null>(null);
  const [targets, setTargets] = useState<Target[]>([]);

  function reset() {
    setSel(null); setTyped(""); setMoveTo(move?.to_bin ?? ""); setMoveQty(null);
    void loadSourceRows(pick.sku, [pick.id, ...(move ? [move.id] : [])]).then(setRows);
  }

  // The source: a chosen row, else a typed bin (its row of this batch, else its only row), else the plan's own.
  const bin = typed.trim().toUpperCase();
  const atBin = bin ? (rows ?? []).filter((r) => r.bin === bin) : [];
  const typedRow = atBin.find((r) => r.batch === curBatch && (r.expiry ?? "") === (curExpiry ?? "")) ?? (atBin.length === 1 ? atBin[0] : null);
  const ambiguous = !sel && bin !== "" && !typedRow && atBin.length > 1;
  const unknownBin = !sel && bin !== "" && rows !== null && atBin.length === 0;
  const src = sel ?? typedRow;
  const srcBin = src?.bin ?? (bin || curBin);
  const srcBatch = src?.batch ?? curBatch;
  const srcExpiry = src ? src.expiry : curExpiry;
  // The plan's own row only while no other bin is typed: an unknown typed bin has no numbers of its own.
  const srcRow = src ?? (bin && bin !== curBin ? null : (rows ?? []).find((r) => sourceKey(r.bin, r.batch, r.expiry) === curKey) ?? null);
  const srcChanged = sourceKey(srcBin, srcBatch, srcExpiry) !== curKey;
  const free = srcRow ? srcRow.qty - srcRow.others : null;
  const leftover = free === null ? null : free - qty;

  // Sisa: the plan's own while the source stays, else what the new source keeps; a typed number wins.
  const defaultQty = move && !srcChanged ? String(Number(move.quantity)) : leftover !== null && leftover > 0 ? String(leftover) : "";
  const sisa = moveQty ?? defaultQty;
  const to = moveTo.trim().toUpperCase();
  const sisaN = Number(sisa);
  const moveErr = !to ? null
    : !/^[A-Z0-9_]{3,20}$/.test(to) ? "Format bin tujuan tidak valid."
    : to === srcBin ? `Tujuan sama dengan bin sumber ${srcBin}.`
    : !Number.isInteger(sisaN) || sisaN <= 0
      ? (leftover !== null && leftover <= 0 && srcRow && srcRow.by.length
        ? `Tidak ada sisa bebas di ${srcBin}: ${fmtNum(srcRow.qty)} karton = pick ini ${fmtNum(qty)} + ${srcRow.by.join(", ")}. Sisanya sudah direncanakan; isi jumlah hanya bila picklist cetak memang berbeda.`
        : "Isi jumlah sisa (lebih dari 0).")
      : null;
  const moveChanged = move ? to !== move.to_bin || sisaN !== Number(move.quantity) : to !== "";
  const ready = rows !== null && !ambiguous && !unknownBin && moveErr === null && (srcChanged || moveChanged);

  useEffect(() => {
    let live = true;
    void moveTargets(srcBin, pick.sku).then((t) => { if (live) setTargets(t); });
    return () => { live = false; };
  }, [srcBin, pick.sku]);

  const later = srcChanged && !!srcExpiry && !!curExpiry && srcExpiry > curExpiry;
  // The plan's own row first, so "rencana" is always in view; the rest stay in FEFO order.
  const chips = (rows ?? []).filter((r) => !bin || r.bin === bin)
    .sort((a, b) => Number(sourceKey(b.bin, b.batch, b.expiry) === curKey) - Number(sourceKey(a.bin, a.batch, a.expiry) === curKey));
  return (
    <CorrectionDialog title={`Ubah baris #${pick.seq}`} confirmLabel="Simpan baris" ready={ready}
      trigger={<Button size="sm" variant="ghost" className="underline" onClick={reset}><Pencil className="h-4 w-4" />Ubah baris</Button>}
      run={async (person, reason) => {
        const { error } = await createClient().rpc("edit_pick_row", {
          p_task_id: pick.id, p_move_id: move?.id ?? null, p_from_bin: srcBin, p_batch_lot: srcBatch, p_expiry_date: srcExpiry,
          p_move_to: to || null, p_move_qty: to ? sisaN : null, p_by_name: person, p_reason: reason,
        });
        return error?.message ?? null;
      }}>
      <p className="rounded-md bg-plate/30 p-3 text-sm">
        #{pick.seq}: ambil <b>{fmtNum(qty)}</b> {pick.uom ?? ""} SKU {pick.sku} dari <b>{srcBin}</b> batch {srcBatch || "–"} exp {srcExpiry ? fmtDate(srcExpiry) : "–"}
        {srcChanged && <> (rencana {curBin} {curBatch || "–"})</>}
        {moveErr ? <>.</>
          : to ? <>, sisa <b>{fmtNum(sisaN)}</b> dipindah ke <b>{to}</b>.</>
          : move ? <>, <b>Bin To Bin ke {move.to_bin} dihapus</b>.</> : <>, tanpa Bin To Bin.</>}
      </p>

      <div className="space-y-2">
        <Label htmlFor="er-bin">Ambil dari (Sumber)</Label>
        {rows === null ? <p className="text-xs text-steel-500">Memuat stok SKU ini…</p> : (
          <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto">
            {chips.map((r) => {
              const k = sourceKey(r.bin, r.batch, r.expiry);
              const on = sourceKey(srcBin, srcBatch, srcExpiry) === k;
              return (
                <Button key={k} size="sm" variant={on ? "default" : "outline"} onClick={() => { setSel(r); setTyped(r.bin); setMoveQty(null); if (r.bin === to) setMoveTo(""); }}
                  title={`isi ${fmtNum(r.qty)}, dipakai tugas lain ${fmtNum(r.others)}`}>
                  {r.bin}<span className="ml-1 text-[10px] font-normal opacity-80">{r.batch || "–"} · {r.expiry ?? "–"} · bebas {fmtNum(Math.max(r.qty - r.others, 0))}{k === curKey ? " · rencana" : ""}</span>
                </Button>
              );
            })}
          </div>
        )}
        <Input id="er-bin" value={typed} autoCapitalize="characters" placeholder="atau ketik bin, mis. CF19A01"
          onChange={(e) => { const v = e.target.value.toUpperCase(); setTyped(v); setSel(null); setMoveQty(null); if (v.trim() && v.trim() === to) setMoveTo(""); }} />
        {ambiguous && <p className="rounded-md bg-warn/10 p-2 text-sm">{bin} menyimpan {atBin.length} batch SKU ini: pilih salah satu di atas.</p>}
        {unknownBin && <p className="rounded-md bg-bad/10 p-2 text-sm text-bad">Menurut database {bin} tidak menyimpan SKU ini. Koreksi stok dulu (Adjust stok), atau posting dengan Berbeda → Bin lain.</p>}
        {later && <p className="rounded-md bg-warn/10 p-2 text-sm">FEFO dilewati: exp {fmtDate(srcExpiry!)} lebih lama dari rencana {fmtDate(curExpiry!)}. Boleh bila picklist cetak memang begitu; tulis alasannya.</p>}
        {srcChanged && free !== null && free < qty && (
          <p className="rounded-md bg-warn/10 p-2 text-sm">Bebas di {srcBin} batch ini {fmtNum(Math.max(free, 0))}, kurang {fmtNum(qty - Math.max(free, 0))} dari {fmtNum(qty)}: tugas tampil stok kurang sampai stok dikoreksi.</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="er-to">Sisa palet (Bin To Bin)</Label>
        {targets.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {move && move.to_bin !== srcBin && (
              <Button size="sm" variant={to === move.to_bin ? "default" : "outline"} onClick={() => setMoveTo(move.to_bin ?? "")}>
                {move.to_bin}<span className="ml-1 text-[10px] font-normal opacity-80">rencana</span></Button>
            )}
            {targets.filter((t) => t.bin !== move?.to_bin).map((t) => (
              <Button key={t.bin} size="sm" variant={to === t.bin ? "default" : "outline"} onClick={() => setMoveTo(t.bin)} title={t.note}>
                {t.bin}<span className="ml-1 text-[10px] font-normal opacity-80">{t.note}</span></Button>
            ))}
          </div>
        )}
        <div className="grid grid-cols-[1fr_6rem_auto] items-end gap-2">
          <div><Input id="er-to" value={moveTo} autoCapitalize="characters" placeholder="ketik bin tujuan" onChange={(e) => setMoveTo(e.target.value.toUpperCase())} /></div>
          <div><Input aria-label="Jumlah sisa" type="number" inputMode="numeric" min={1} value={sisa} disabled={!to}
            onChange={(e) => setMoveQty(e.target.value)} placeholder="sisa" /></div>
          <Button size="sm" variant="ghost" disabled={!moveTo} onClick={() => { setMoveTo(""); setMoveQty(null); }}>Hapus</Button>
        </div>
        {moveErr && <p className="rounded-md bg-bad/10 p-2 text-xs text-bad">{moveErr}</p>}
        {to && leftover !== null && sisaN > Math.max(leftover, 0) && (
          <p className="rounded-md bg-warn/10 p-2 text-xs">Sisa {fmtNum(sisaN)} lebih dari yang tersisa di {srcBin} setelah pick ({fmtNum(Math.max(leftover, 0))}).</p>
        )}
        {!to && leftover !== null && leftover > 0 && <p className="text-xs text-steel-500">Sisa {fmtNum(leftover)} tetap di {srcBin}.</p>}
        {!to && srcRow && srcRow.by.length > 0 && (
          <p className="text-xs text-steel-500">Baris lain dari {srcBin} batch ini: {srcRow.by.join(", ")}.</p>
        )}
      </div>
    </CorrectionDialog>
  );
}

/**
 * "Perbaiki" on a stok kurang row (lib/wave-fix.ts): loads this SKU's stock and
 * the other open rows, proposes the smallest change in one sentence (shrink the
 * Bin To Bin, or the bin the engine's own rule picks), and saves it through
 * edit_pick_row (0052) only on confirm — name from the wave page, the sentence as reason.
 */
export function FixButton({ pick, move }: { pick: TaskRow; move?: TaskRow | null }) {
  const router = useRouter();
  const [person] = usePersonName();
  const [open, setOpen] = useState(false);
  const [proposal, setProposal] = useState<FixProposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setProposal(null); setError(null);
    const db = createClient();
    const [{ data: inv, error: e1 }, { data: tasks, error: e2 }] = await Promise.all([
      db.from("inventory_detail").select("bin_code, bin_status, batch_lot, expiry_date, quantity").eq("sku", pick.sku).range(0, 2999),
      db.from("pick_task_detail").select("id, from_bin, to_bin, batch_lot, expiry_date, quantity")
        .eq("sku", pick.sku).eq("status", "PLANNED").in("wave_status", ["PENDING", "RESCHEDULED"]).range(0, 2999),
    ]);
    if (e1 || e2) return setError((e1 ?? e2)!.message);
    const stock: FixStock[] = ((inv ?? []) as { bin_code: string; bin_status: string; batch_lot: string; expiry_date: string | null; quantity: number }[])
      .map((r) => ({ bin: r.bin_code, batch: r.batch_lot, expiry: r.expiry_date, qty: Number(r.quantity), blocked: r.bin_status === "blocked" }));
    const claims: FixClaim[] = ((tasks ?? []) as { id: string; from_bin: string; to_bin: string | null; batch_lot: string; expiry_date: string | null; quantity: number }[])
      .filter((t) => t.id !== pick.id && t.id !== move?.id)
      .map((t) => ({ from: t.from_bin, to: t.to_bin, batch: t.batch_lot, expiry: t.expiry_date, qty: Number(t.quantity) }));
    setProposal(proposeFix(
      { from: pick.from_bin, sku: pick.sku, batch: pick.actual_batch_lot ?? pick.batch_lot, expiry: pick.actual_expiry_date ?? pick.expiry_date,
        qty: Number(pick.quantity), upp: Number(pick.upp) || 1 },
      move && move.to_bin ? { to: move.to_bin, qty: Number(move.quantity) } : null, stock, claims, DEFAULT_CONFIG));
  }

  async function save() {
    if (!proposal || (proposal.kind !== "resize" && proposal.kind !== "repoint")) return;
    if (person.trim().length < 2) return setError("Isi nama Anda di atas daftar wave dulu.");
    setBusy(true); setError(null);
    const { error } = await createClient().rpc("edit_pick_row", {
      p_task_id: pick.id, p_move_id: move?.id ?? null, p_from_bin: proposal.from, p_batch_lot: proposal.batch, p_expiry_date: proposal.expiry,
      p_move_to: proposal.moveTo, p_move_qty: proposal.moveQty, p_by_name: person, p_reason: `Perbaiki: ${proposal.sentence}`,
    });
    setBusy(false);
    if (error) return setError(error.message);
    setOpen(false); router.refresh();
  }

  const doable = proposal?.kind === "resize" || proposal?.kind === "repoint";
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) void load(); }}>
      <DialogTrigger asChild><Button size="sm" variant="outline" className="border-bad text-bad"><Wrench className="h-4 w-4" />Perbaiki</Button></DialogTrigger>
      <DialogContent title={`Perbaiki #${pick.seq}`} description={`${pick.sku} · ${fmtNum(Number(pick.quantity))} ${pick.uom ?? ""} dari ${pick.from_bin}`}>
        <div className="space-y-4">
          {!proposal && !error && <p className="text-sm text-steel-500">Menghitung stok sekarang…</p>}
          {proposal && (
            <p className={cn("rounded-md p-3 text-base", doable ? "bg-plate/30" : "bg-warn/10")}>{proposal.sentence}</p>
          )}
          {proposal?.kind === "repoint" && proposal.fefoLater && (
            <p className="rounded-md bg-warn/10 p-2 text-sm">Batch lebih awal tidak cukup di satu bin. Pakai hanya bila memang begitu di lapangan.</p>
          )}
          {doable && <p className="text-xs text-steel-500">Berdasarkan stok di sistem. Bila bin yang diusulkan ternyata kosong di lapangan, hitung bin itu dulu (Cycle count).</p>}
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="lg" onClick={() => setOpen(false)}>Tutup</Button>
            <Button size="lg" onClick={save} disabled={busy || !doable}>{busy ? "Menyimpan…" : "Simpan perbaikan"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
