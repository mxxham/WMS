"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ClipboardList, Wrench } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { usePersonName } from "@/components/app/person-name";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/app/confirm-button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { DEFAULT_CONFIG } from "@/lib/allocator/config";
import { pairMoves } from "@/lib/allocator/pair-moves";
import type { TaskRow, WaveRow } from "@/lib/allocator/picklist-from-tasks";
import { planFixes, type FixItem, type FixProposal } from "@/lib/wave-fix";
import { cn, fmtDateTime, fmtNum } from "@/lib/utils";
import { BinButton } from "./bin-panel";
import { PostMoveEarlyButton, type Rpc } from "./post-move-early";
import { fixMoveOf, fixRowOf, loadSkuContext } from "./sku-context";
import { FixButton } from "./wave-corrections";
import type { TaskWait } from "./waves-client";

export type OpenCount = { id: string; bin_code: string; status: string; reason: string | null; created_at: string };
type ShortItem = { pick: TaskRow; move: TaskRow | null; waveNo: string };

/**
 * "Perlu ditangani": every row of every wave of the day that needs a person,
 * each with its button — instead of scrolling 13 waves for 4 red rows
 * (5 Oct). Stok kurang → Perbaiki (or all at once), Tunggu relokasi → post the
 * move it waits for, a short pick's count → Cycle count.
 */
export function ProblemsPanel({ waves, tasks, short, waits, counts: allCounts, lastImport, supervisor, rpc, extra }: {
  waves: WaveRow[]; tasks: TaskRow[]; short: Set<string>; waits: Record<string, TaskWait>; counts: OpenCount[]; lastImport: string | null;
  supervisor: boolean; rpc: Rpc; extra?: React.ReactNode;
}) {
  const waveOf = new Map(waves.map((w) => [w.id, w]));
  const shortItems: ShortItem[] = [];
  const otherShort: TaskRow[] = [];
  for (const it of pairMoves(tasks)) {
    const pick = it.kind === "pair" ? it.pick : it.task;
    const move = it.kind === "pair" ? it.move : null;
    if (pick.status !== "PLANNED" || !(short.has(pick.id) || (move && short.has(move.id)))) continue;
    if (pick.task_type === "PICK") shortItems.push({ pick, move, waveNo: waveOf.get(pick.wave_id)?.wave_no ?? "?" });
    else otherShort.push(pick);
  }
  const waiting = tasks.filter((t) => t.status === "PLANNED" && waits[t.id] && !short.has(t.id));
  // 5 Oct: 21 of 22 listed counts came from before that morning's full import, which had replaced the stock they
  // questioned. Only counts opened after the last full import are work; the older ones fold into one line to close.
  const counts = lastImport ? allCounts.filter((c) => c.created_at >= lastImport) : allCounts;
  const stale = lastImport ? allCounts.filter((c) => c.created_at < lastImport) : [];
  const total = shortItems.length + otherShort.length + waiting.length + counts.length + (stale.length ? 1 : 0);
  if (!total) return null;
  const parked = (t: TaskRow) => waveOf.get(t.wave_id)?.status === "RESCHEDULED";

  return (
    <section aria-labelledby="perlu" className="space-y-3 rounded-md border-2 border-bad bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="perlu" className="flex items-center gap-2 font-cond text-lg font-semibold"><AlertTriangle className="h-5 w-5 text-bad" />Perlu ditangani ({total})</h2>
        <div className="flex flex-wrap gap-2">
          {supervisor && shortItems.length > 1 && <FixAllButton items={shortItems} />}
          {extra}
        </div>
      </div>
      <ul className="divide-y divide-steel-100 text-sm">
        {shortItems.map(({ pick, move, waveNo }) => (
          <li key={pick.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              <b>NO {waveNo} #{pick.seq}</b> · stok kurang · ambil {fmtNum(Number(pick.quantity))} {pick.sku} dari{" "}
              <BinButton code={pick.from_bin} className="font-semibold underline">{pick.from_bin}</BinButton>
              {move && <> · sisa {fmtNum(Number(move.quantity))} → {move.to_bin}</>}
              {parked(pick) && <span className="text-warn"> · wave ditunda</span>}
            </span>
            {supervisor && <FixButton pick={pick} move={move} />}
          </li>
        ))}
        {otherShort.map((t) => (
          <li key={t.id} className="py-2">
            <b>NO {waveOf.get(t.wave_id)?.wave_no} #{t.seq}</b> · stok kurang · Bin To Bin {fmtNum(Number(t.quantity))} {t.from_bin} → {t.to_bin}: ubah lewat baris pick-nya
          </li>
        ))}
        {waiting.map((t) => {
          const w = waits[t.id];
          const held = w.wait_wave_status === "RESCHEDULED";
          return (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <b>NO {waveOf.get(t.wave_id)?.wave_no} #{t.seq}</b> · menunggu Bin To Bin <b>NO {w.wait_wave_no} #{w.wait_seq}</b> ({w.wait_from} → {w.wait_to}, {fmtNum(Number(w.wait_qty))})
                {held && <span className="text-warn"> · wave itu ditunda</span>}
              </span>
              <span className="flex flex-wrap gap-2">
                {(supervisor || !held) && (
                  <PostMoveEarlyButton moveId={w.wait_task_id} sku={t.sku} to={w.wait_to} rpc={rpc} label={`Posting Bin To Bin NO ${w.wait_wave_no} #${w.wait_seq}`}
                    summary={`Posting Bin To Bin NO ${w.wait_wave_no} #${w.wait_seq} sekarang, tanpa pick-nya: ${fmtNum(Number(w.wait_qty))} dari ${w.wait_from} ke ${w.wait_to}. Setelah itu NO ${waveOf.get(t.wave_id)?.wave_no} #${t.seq} bisa diposting.`} />
                )}
                {supervisor && t.task_type === "PICK" && <FixButton pick={t} />}
              </span>
            </li>
          );
        })}
        {stale.length > 0 && (
          <li className="flex flex-wrap items-center justify-between gap-2 py-2 text-steel-500">
            <span>{stale.length} tugas hitung dari sebelum impor stok terakhir ({fmtDateTime(lastImport!)}): stoknya sudah diganti isi file WMS, jadi hitungan lama ini tidak relevan lagi.</span>
            {supervisor ? <CloseStaleCounts counts={stale} lastImport={lastImport!} /> : <Link href="/counts" className="underline">Cycle count</Link>}
          </li>
        )}
        {counts.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span><b>Hitung {c.bin_code}</b> · {c.reason ?? "pick kurang"} · sejak {fmtDateTime(c.created_at)}</span>
            <Link href="/counts" className="inline-flex items-center gap-1 font-semibold underline"><ClipboardList className="h-4 w-4" />Cycle count</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * "Perbaiki semua": the proposal for every stok kurang row, each computed on
 * top of the ones before it (planFixes), as a list to untick; applied row by
 * row through edit_pick_row with the supervisor's name, the sentence as reason.
 */
function FixAllButton({ items }: { items: ShortItem[] }) {
  const router = useRouter();
  const [person] = usePersonName();
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<{ item: ShortItem; proposal: FixProposal }[] | null>(null);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setPlan(null); setSkip(new Set()); setResult({}); setError(null);
    try {
      const ctx = await loadSkuContext(items.map((i) => i.pick.sku));
      const fixItems: FixItem[] = items.map((i) => ({ pickId: i.pick.id, moveId: i.move?.id ?? null, row: fixRowOf(i.pick), move: fixMoveOf(i.move) }));
      const open = ctx.tasks.map((t) => ({ id: t.id, from: t.from, to: t.to, batch: t.batch, expiry: t.expiry, qty: t.qty }));
      const out = planFixes(fixItems, ctx.stock, open, DEFAULT_CONFIG);
      setPlan(out.map((o, n) => ({ item: items[n], proposal: o.proposal })));
    } catch (e) { setError((e as Error).message); }
  }

  const doable = (p: FixProposal) => p.kind === "resize" || p.kind === "repoint";
  async function apply() {
    if (!plan) return;
    if (person.trim().length < 2) return setError("Isi nama Anda di atas daftar wave dulu.");
    setBusy(true); setError(null);
    const done: Record<string, string> = {};
    for (const { item, proposal: p } of plan) {
      if (!doable(p) || skip.has(item.pick.id) || (p.kind !== "resize" && p.kind !== "repoint")) continue;
      const { error } = await createClient().rpc("edit_pick_row", {
        p_task_id: item.pick.id, p_move_id: item.move?.id ?? null, p_from_bin: p.from, p_batch_lot: p.batch, p_expiry_date: p.expiry,
        p_move_to: p.moveTo, p_move_qty: p.moveQty, p_by_name: person, p_reason: `Perbaiki semua: ${p.sentence}`,
      });
      done[item.pick.id] = error ? `gagal: ${error.message}` : "tersimpan";
    }
    setResult(done); setBusy(false);
    router.refresh();
  }

  const chosen = plan ? plan.filter((x) => doable(x.proposal) && !skip.has(x.item.pick.id)).length : 0;
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) void load(); }}>
      <DialogTrigger asChild><Button size="sm" variant="outline" className="border-bad text-bad"><Wrench className="h-4 w-4" />Perbaiki semua ({items.length})</Button></DialogTrigger>
      <DialogContent title="Perbaiki semua" description="Usulan untuk setiap baris stok kurang. Hilangkan centang baris yang tidak ingin diubah." className="sm:w-[44rem]">
        <div className="space-y-4">
          {!plan && !error && <p className="text-sm text-steel-500">Menghitung stok sekarang…</p>}
          {plan && (
            <ul className="space-y-2 text-sm">
              {plan.map(({ item, proposal: p }) => (
                <li key={item.pick.id} className={cn("rounded-md border p-2", doable(p) ? "border-steel-200" : "border-warn bg-warn/10")}>
                  <label className="flex items-start gap-2">
                    <input type="checkbox" className="mt-1" disabled={!doable(p) || busy || !!result[item.pick.id]}
                      checked={doable(p) && !skip.has(item.pick.id)}
                      onChange={(e) => setSkip((s) => { const n = new Set(s); if (e.target.checked) n.delete(item.pick.id); else n.add(item.pick.id); return n; })} />
                    <span><b>NO {item.waveNo} #{item.pick.seq}</b> · {p.sentence}
                      {result[item.pick.id] && <span className={cn("ml-1 font-semibold", result[item.pick.id] === "tersimpan" ? "text-ok" : "text-bad")}>({result[item.pick.id]})</span>}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-steel-500">Berdasarkan stok di sistem. Usulan dihitung berurutan: dua baris tidak pernah diberi karton yang sama.</p>
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="lg" onClick={() => setOpen(false)}>Tutup</Button>
            <Button size="lg" onClick={apply} disabled={busy || !plan || chosen === 0 || Object.keys(result).length > 0}>
              {busy ? "Menyimpan…" : `Simpan ${chosen} perbaikan`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Closes the counts opened before the last full import, with the reason recorded on each (close_count, 0019). */
function CloseStaleCounts({ counts, lastImport }: { counts: OpenCount[]; lastImport: string }) {
  const router = useRouter();
  const [person] = usePersonName();
  return (
    <ConfirmButton size="sm" variant="outline" title="Tutup hitung lama" confirmLabel={`Tutup ${counts.length} hitung`}
      summary={`Tutup ${counts.length} tugas hitung yang dibuat sebelum impor stok ${fmtDateTime(lastImport)} (${counts.map((c) => c.bin_code).join(", ")}). Tidak ada stok yang berubah; alasan dicatat di setiap tugas.`}
      onConfirm={async () => {
        if (person.trim().length < 2) return "Isi nama Anda di atas daftar wave dulu.";
        const failed: string[] = [];
        for (const c of counts) {
          const { error } = await createClient().rpc("close_count", { p_task_id: c.id, p_by_name: person,
            p_note: `stok sudah diganti impor WMS ${fmtDateTime(lastImport)}; hitungan dari sebelum impor tidak relevan` });
          if (error) failed.push(`${c.bin_code}: ${error.message}`);
        }
        router.refresh();
        return failed.length ? `${counts.length - failed.length} ditutup, ${failed.length} gagal: ${failed.join("; ")}` : null;
      }}>Tutup {counts.length} hitung lama</ConfirmButton>
  );
}
