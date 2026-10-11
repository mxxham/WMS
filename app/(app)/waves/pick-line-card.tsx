"use client";
import { useState } from "react";
import { Check, Pencil, Plus, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { BinScanInput } from "@/components/app/bin-scan-input";
import { RackScan, rackMatches, type RackConfirm } from "@/components/app/rack-scan";
import { BinLeftCheck } from "./bin-left-check";
import type { SheetLine, SheetStock } from "@/lib/wave-sheet";
import { draftNotes, isPlannedSource, linePayload, lineProblem, lineSummary, restAtOpen, samePerson, scanTarget, takeFrom } from "@/lib/pick-line";
import { cn, fmtDate, fmtNum } from "@/lib/utils";

const REASONS = ["bin kosong / kurang", "palet terhalang", "karton rusak", "pickface penuh", "lain"];

/**
 * One line of the picking screen (0067): the plan, Sesuai to post it as
 * planned, Berbeda to post what really happened, Ubah on one's own posted line.
 * Posting needs the rack scan (0068): the label of the bin the line takes from,
 * scanned or typed; the scan button and Posting sit at the bottom, in thumb reach.
 * Editor state lives here, keyed by the line, so a page refresh never wipes it.
 */
export function PickLineCard({ line, unit, stock, stockLoaded, bins, person, waveId, onPosted }: {
  line: SheetLine; unit: string; stock: SheetStock[]; stockLoaded: boolean; bins: Set<string> | null; person: string; waveId: string; onPosted: () => void;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "confirm" | "check">("view");
  // Sesuai = the plan as is; Berbeda / Ubah = edited (decides the default reason).
  const [edited, setEdited] = useState(false);
  const [draft, setDraft] = useState<SheetLine>(line);
  const [reason, setReason] = useState("");
  // The rack label read for this line (0068); it stays across Sesuai / Berbeda until posted.
  const [rack, setRack] = useState<RackConfirm | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "bad" | "warn"; text: string } | null>(null);

  const posted = line.posted;
  const by = line.pick?.picked_by_name ?? line.move?.picked_by_name ?? null;
  // Own line = the same typed name (same_person); a line posted without a name is a supervisor's.
  const own = samePerson(by, person);
  const sources = stock.filter((s) => s.sku === line.sku && s.qty > 0)
    .sort((a, b) => (a.expiry ?? "9999").localeCompare(b.expiry ?? "9999") || a.bin.localeCompare(b.bin));
  const problem = lineProblem(draft, bins);
  const asPlanned = mode !== "edit" && mode !== "confirm";
  const sentence = lineSummary(asPlanned ? line : draft, unit);
  // Isi dari picklist's notes for this line, and the rest against the system: shown before Posting, never blocking.
  const notes = asPlanned ? [] : draftNotes(draft, line, stock, bins, unit, stockLoaded);
  const noteList = notes.length > 0 && (
    <ul className="space-y-0.5 text-xs">{notes.map((n, i) => (
      <li key={i} className={cn(n.tone === "bad" ? "text-bad" : n.tone === "warn" ? "rounded bg-warn/10 px-1 text-warn" : "text-steel-500")}>{n.text}</li>
    ))}</ul>
  );

  function open(edit: boolean, from: SheetLine = line) {
    const d = structuredClone(from);
    // The rest the pallet really keeps, once the stock has loaded; the plan only until then.
    d.moveQty = restAtOpen(d, stock, stockLoaded);
    setDraft(d); setReason(""); setMessage(null); setEdited(edit);
    setMode(edit ? "edit" : "confirm");
  }
  // Ambil dari <scanned>: Berbeda with the scanned bin as the first source (batch/expiry when it holds one batch).
  const takeScanned = (code: string) => open(true, takeFrom(line, code, stock));
  // A scan on the open card: the right bin goes straight to Posting as planned; a wrong one stays here, in red.
  function scannedInView(v: RackConfirm | null) {
    setRack(v);
    if (v && rackMatches(scanTarget(line), v)) open(false);
  }
  const setSource = (i: number, patch: Partial<SheetLine["sources"][number]>) => setDraft((d) => {
    const x = structuredClone(d);
    const s = { ...x.sources[i], ...patch };
    if (patch.bin !== undefined) {
      const here = sources.filter((r) => r.bin === s.bin.trim().toUpperCase());
      if (here.length === 1) { s.batch = here[0].batch; s.expiry = (here[0].expiry ?? "").slice(0, 10); }
    }
    x.sources[i] = s;
    return x;
  });

  async function post(target: SheetLine) {
    setBusy(true); setMessage(null);
    const { data, error } = await createClient().rpc("post_pick_line", {
      p_wave_id: waveId, p_row: linePayload(target), p_by_name: person,
      p_reason: reason.trim() || (edited ? "berbeda di lapangan" : "sesuai picklist"),
      p_scanned: rack?.code ?? null, p_scan_mode: rack?.method ?? "scan",
    });
    setBusy(false);
    if (error) { setMessage({ tone: "bad", text: error.message }); return; }
    const r = data as { result: "posted" | "refused"; message?: string; corrections?: number };
    setRack(null);
    if (r.result === "refused") {
      setMessage({ tone: "warn", text: `${r.message} — dikirim ke supervisor, lanjut ke baris berikutnya.` });
      setMode("view");
      return;
    }
    setMessage(r.corrections ? { tone: "warn", text: `Diposting dengan ${r.corrections} koreksi stok kecil; bin ini akan dihitung ulang.` } : null);
    setMode(line.pick ? "check" : "view");
    if (!line.pick) onPosted();
  }

  const qtyOf = (l: SheetLine) => l.sources.reduce((n, s) => n + (Number(s.qty) || 0), 0);
  const plate = "rounded bg-plate px-2 py-0.5 font-cond text-lg font-semibold tracking-wide text-steel";

  return (
    <div id={`line-${line.key}`} className={cn("space-y-3 rounded-lg border bg-white p-4", posted ? "border-ok/50 bg-ok/5" : "border-steel-200")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-steel-500">#{line.seq}</span>
            <span className={plate}>{line.sources[0].bin}</span>
            {line.pick?.pick_type && <span className="rounded bg-steel-100 px-1.5 text-xs font-semibold">{line.pick.pick_type}</span>}
          </div>
          <p className="text-sm font-semibold">{line.sku} · {line.description}</p>
          <p className="text-xs text-steel-500">Batch {line.sources[0].batch || "–"} · exp {fmtDate(line.sources[0].expiry)}{line.shipment && ` · shipment ${line.shipment}`}</p>
        </div>
        <div className="text-right">
          {line.pick && <p className="font-cond text-2xl font-semibold tabular">{fmtNum(posted ? qtyOf(line) : Number(line.pick.quantity))} <span className="text-base">{unit}</span></p>}
          {line.move && <p className="text-xs">sisa → <b>{line.moveTo || "tetap di bin"}</b>{line.moveTo && ` (${fmtNum(Number(line.moveQty))} ${unit})`}</p>}
        </div>
      </div>

      {posted && mode === "view" && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="font-semibold text-ok"><Check className="mr-1 inline h-4 w-4" />Diposting{by && ` oleh ${by}`}{line.pick?.completed_at && ` · ${new Date(line.pick.completed_at).toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" })}`}</span>
          <Button size="sm" variant="outline" disabled={!own || person.trim().length < 2} onClick={() => open(true)}
            title={own ? "Ubah baris yang Anda posting" : "Baris orang lain: minta supervisor"}><Pencil className="h-4 w-4" />Ubah</Button>
          {!own && <span className="w-full text-xs text-steel-500">Diposting {by ? `oleh ${by}` : "tanpa nama"}: minta supervisor untuk mengubah.</span>}
        </div>
      )}

      {!posted && mode === "view" && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Button className="flex-1" variant="outline" disabled={person.trim().length < 2} onClick={() => open(false)}><Check className="h-4 w-4" />Sesuai</Button>
            <Button className="flex-1" variant="outline" disabled={person.trim().length < 2} onClick={() => open(true)}><Pencil className="h-4 w-4" />Berbeda</Button>
          </div>
          {person.trim().length >= 2
            ? <RackScan id={`rack-${line.key}`} target={scanTarget(line)} value={rack} onChange={scannedInView} onTakeFrom={takeScanned} />
            : <p className="text-center text-xs text-steel-500">Isi nama picker dulu, lalu scan label bin.</p>}
        </div>
      )}

      {mode === "edit" && (
        <div className="space-y-3 rounded-md border border-warn/40 bg-warn/5 p-3">
          {draft.sources.map((s, i) => (
            <div key={i} className="space-y-1">
              <div>
                <Label htmlFor={`bin-${line.key}-${i}`}>{i === 0 ? "Bin asal (scan label / ketik)" : "Bin lain"}</Label>
                <BinScanInput id={`bin-${line.key}-${i}`} list={`stock-${line.key}`} value={s.bin} onChange={(v) => setSource(i, { bin: v })} />
                <p className="mt-0.5 text-[11px] text-steel-500">batch {s.batch || "–"} · exp {fmtDate(s.expiry)}</p>
              </div>
              {(line.pick || i > 0) && (
                <div className="flex items-end gap-2">
                  {line.pick && (
                    <div className="w-28">
                      <Label htmlFor={`qty-${line.key}-${i}`}>Qty ({unit})</Label>
                      <Input id={`qty-${line.key}-${i}`} inputMode="numeric" className="h-11" value={s.qty} onChange={(e) => setSource(i, { qty: e.target.value })} />
                    </div>
                  )}
                  {i > 0 && <Button variant="ghost" className="ml-auto h-11" aria-label="Hapus bin ini" onClick={() => setDraft((d) => ({ ...d, sources: d.sources.filter((_, j) => j !== i) }))}><X className="h-4 w-4" />hapus</Button>}
                </div>
              )}
            </div>
          ))}
          <datalist id={`stock-${line.key}`}>{sources.map((r) => <option key={`${r.bin}|${r.batch}|${r.expiry}`} value={r.bin}>{`${r.batch} · ${fmtDate(r.expiry)} · ${fmtNum(r.qty)} ${unit}${isPlannedSource(r, line) ? " · rencana" : ""}`}</option>)}</datalist>
          {line.pick && draft.sources.length < 3 && (
            <Button size="sm" variant="ghost" onClick={() => setDraft((d) => ({ ...d, sources: [...d.sources, { bin: "", batch: "", expiry: "", qty: "0" }] }))}><Plus className="h-4 w-4" />bin lain</Button>
          )}
          {line.move && (
            <div className="space-y-1">
              <div><Label htmlFor={`to-${line.key}`}>Sisa dipindah ke (scan label / ketik; kosong = tetap di bin)</Label>
                <BinScanInput id={`to-${line.key}`} value={draft.moveTo} onChange={(v) => setDraft((d) => ({ ...d, moveTo: v }))} /></div>
              <div className="w-28"><Label htmlFor={`mq-${line.key}`}>Qty sisa</Label>
                <Input id={`mq-${line.key}`} inputMode="numeric" className="h-11" value={draft.moveQty} onChange={(e) => setDraft((d) => ({ ...d, moveQty: e.target.value }))} /></div>
            </div>
          )}
          <div className="flex flex-wrap gap-1">{REASONS.map((r) => (
            <button key={r} type="button" onClick={() => setReason(r)} className={cn("rounded-full border px-2 py-0.5 text-xs", reason === r ? "border-ckb bg-ckb text-white" : "border-steel-300")}>{r}</button>
          ))}</div>
          {noteList}
          {problem && <p role="alert" className="text-sm text-bad">{problem}</p>}
          <div className="flex gap-2">
            <Button variant="outline" className="h-14" onClick={() => setMode("view")}>Batal</Button>
            <Button className="h-14 flex-1 text-base" disabled={!!problem || !reason} onClick={() => setMode("confirm")}>Lanjut</Button>
          </div>
        </div>
      )}

      {mode === "confirm" && (
        <div className="space-y-3 rounded-md border border-ckb/40 bg-ckb/5 p-3">
          <p className="text-sm font-semibold">{sentence}</p>
          {noteList}
          {problem && <p role="alert" className="text-sm text-bad">{problem}{!edited && " — pakai Berbeda."}</p>}
          <RackScan id={`rack-c-${line.key}`} target={scanTarget(draft)} value={rack} onChange={setRack}
            onTakeFrom={(code) => { setDraft(takeFrom(draft, code, stock)); setEdited(true); setMode("edit"); }}
            hideButton={rackMatches(scanTarget(draft), rack)} />
          {!rackMatches(scanTarget(draft), rack) && <p className="text-center text-xs text-steel-500">Scan label {scanTarget(draft)} dulu untuk Posting.</p>}
          <div className="flex gap-2">
            <Button variant="outline" className="h-14" disabled={busy} onClick={() => setMode("view")}>Batal</Button>
            <Button className="h-14 flex-1 text-base" disabled={busy || !!problem || !rackMatches(scanTarget(draft), rack)} onClick={() => void post(draft)}>{busy ? "Memposting…" : "Posting"}</Button>
          </div>
        </div>
      )}

      {mode === "check" && line.pick && (
        <BinLeftCheck taskId={line.pick.id} person={person} unit={unit} onDone={() => { setMode("view"); onPosted(); }} />
      )}

      {message && <p role="alert" className={cn("text-sm", message.tone === "bad" ? "text-bad" : "text-warn")}>{message.text}</p>}
    </div>
  );
}
