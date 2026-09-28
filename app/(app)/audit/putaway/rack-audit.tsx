"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, ClipboardCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ItemScanInput } from "@/components/app/item-scan-input";
import { PersonNameField, usePersonName } from "@/components/app/person-name";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { cn, fmtDate, fmtDateTime, fmtNum } from "@/lib/utils";
import { RACK_STATE_LABEL, RACK_STATE_TONE, type RackSummary } from "../picking/rack-data";
import type { PutawayRow } from "./rack-data";

type SaveResult = {
  result: "OK" | "MISMATCH"; sku_ok: boolean; batch_ok: boolean;
  expected: { sku: string; batch: string; qty: number }; found: { sku: string; batch: string; qty: number };
};

const STATE = {
  TODO: ["Belum diaudit", "bg-steel-100 text-steel-700"],
  OK: ["OK", "bg-ok/10 text-ok"],
  MISMATCH: ["Selisih", "bg-bad/10 text-bad"],
} as const;

/**
 * One rack on a date: its putaways in walking order. Per putaway the checker
 * scans/types the SKU, types the batch and counts (0027); an OK goes straight
 * on to the next putaway still to audit.
 */
export function PutawayRackAudit({ zone, date, rows, summary }: { zone: string; date: string; rows: PutawayRow[]; summary: RackSummary }) {
  const router = useRouter();
  const [checker, setChecker] = usePersonName();
  const [open, setOpen] = useState<{ row: PutawayRow; flash?: string } | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const needs = (r: PutawayRow) => (!r.audit || r.audit.result === "MISMATCH") && !saved.has(r.movement_id);
  const todo = rows.filter(needs);

  /** ✓ Sesuai: SKU, batch and qty in the bin are as put away. */
  async function confirm(r: PutawayRow) {
    const k = r.movement_id;
    if (checker.trim().length < 2) return setRowError((e) => ({ ...e, [k]: "Isi nama checker di atas dulu." }));
    setBusy(k); setRowError((e) => ({ ...e, [k]: "" }));
    const { error } = await createClient().rpc("record_putaway_audit", {
      p_movement_id: k, p_checker_name: checker, p_found: r.sku, p_batch: r.batch_lot, p_counted: r.quantity, p_note: null,
    });
    setBusy(null);
    if (error) return setRowError((e) => ({ ...e, [k]: error.message }));
    setSaved((s) => new Set(s).add(k));
    router.refresh();
  }

  /** Marks `from` as audited and returns the next putaway to audit after it (wrapping round), if any. */
  function next(from: PutawayRow): { row: PutawayRow; left: number } | null {
    const skip = new Set(saved).add(from.movement_id);
    setSaved(skip);
    const pending = (r: PutawayRow) => (!r.audit || r.audit.result === "MISMATCH") && !skip.has(r.movement_id);
    const rest = rows.filter(pending);
    const i = rows.findIndex((r) => r.movement_id === from.movement_id);
    const row = rows.slice(i + 1).find(pending) ?? rest[0];
    return row ? { row, left: rest.length } : null;
  }

  return (
    <div className="space-y-4">
      <Link href={`/audit/putaway?date=${date}`} className="inline-flex items-center gap-1 text-sm underline"><ArrowLeft className="h-4 w-4" />Semua rak</Link>
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h2 className="font-cond text-2xl font-semibold">Rak {zone}</h2>
              <span className={cn("rounded px-2 py-0.5 text-xs font-semibold", RACK_STATE_TONE[summary.state])}>{RACK_STATE_LABEL[summary.state]}</span>
            </div>
            <p className="text-sm text-steel-500">{fmtDate(date)} · {fmtNum(summary.lines)} putaway ke {fmtNum(summary.bins)} bin</p>
            <p className="text-sm">{fmtNum(summary.done)}/{fmtNum(summary.lines)} putaway sudah diaudit
              {summary.mismatch > 0 && <span className="text-bad"> · {fmtNum(summary.mismatch)} selisih</span>}</p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <PersonNameField value={checker} onChange={setChecker} label="Nama checker (bukan yang putaway)" id="rack-checker" />
            {todo.length > 0 && (
              <Button size="lg" variant="outline" onClick={() => setOpen({ row: todo[0] })}><ClipboardCheck className="h-5 w-5" />Audit satu per satu ({fmtNum(todo.length)})</Button>
            )}
          </div>
        </CardContent>
      </Card>
      <p className="text-sm text-steel-500">SKU, batch dan jumlah di bin sama dengan putaway: tekan <b>✓ Sesuai</b>. Ada yang beda: <b>Tidak sesuai</b> lalu isi yang ditemukan.</p>

      <Card>
        <CardContent>
          <Table>
            <thead><tr><Th>Bin</Th><Th>SKU</Th><Th>Batch / exp</Th><Th>Qty</Th><Th>Putaway</Th><Th>Status</Th><Th>Audit terakhir</Th><Th /></tr></thead>
            <tbody>{rows.map((r) => {
              const state = r.audit?.result ?? "TODO";
              return (
                <tr key={r.movement_id} className={cn(state === "MISMATCH" && "bg-bad/5")}>
                  <Td className="font-cond text-lg font-semibold">{r.to_bin}</Td>
                  <Td><span className="font-semibold">{r.sku}</span><br /><span className="text-xs text-steel-500">{r.description}</span></Td>
                  <Td className="text-xs">{r.batch_lot || "–"}<br /><span className="text-steel-500">{fmtDate(r.expiry_date)}</span></Td>
                  <Td className="tabular">{fmtNum(r.quantity)} {r.uom ?? ""}</Td>
                  <Td className="text-xs">{r.type === "inbound" ? "Terima baru" : `dari ${r.from_bin ?? "–"}`}<br />
                    <span className="text-steel-500">{r.by ?? "(tidak tercatat)"} · {fmtDateTime(r.created_at)}</span></Td>
                  <Td><span className={cn("rounded px-2 py-0.5 text-xs font-semibold", STATE[state][1])}>{STATE[state][0]}</span></Td>
                  <Td className="text-xs">{r.audit ? (
                    <>
                      {r.audit.result === "MISMATCH" && (
                        <span className="block text-bad">ditemukan {r.audit.foundSku ?? "?"} · batch {r.audit.foundBatch || "–"} · {fmtNum(r.audit.counted)}</span>
                      )}
                      {r.audit.note && <span className="block">{r.audit.note}</span>}
                      <span className="text-steel-500">{r.audit.checker ?? "–"} · {fmtDateTime(r.audit.at)}{r.audit.attempts > 1 ? ` · audit ke-${r.audit.attempts}` : ""}</span>
                    </>
                  ) : "–"}</Td>
                  <Td className="text-right">
                    {needs(r) && (
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button size="sm" disabled={busy === r.movement_id} onClick={() => confirm(r)}>{busy === r.movement_id ? "…" : "✓ Sesuai"}</Button>
                        <Button size="sm" variant="outline" onClick={() => setOpen({ row: r })}>Tidak sesuai</Button>
                      </div>
                    )}
                    {rowError[r.movement_id] && <p role="alert" className="mt-1 text-xs text-bad">{rowError[r.movement_id]}</p>}
                    {saved.has(r.movement_id) && <span className="text-xs font-semibold text-ok">✓ tersimpan</span>}
                  </Td>
                </tr>
              );
            })}</tbody>
          </Table>
        </CardContent>
      </Card>
      {open && <AuditDialog key={open.row.movement_id} row={open.row} flash={open.flash} next={next}
        onOpen={(row, flash) => setOpen({ row, flash })} onClose={() => setOpen(null)} />}
    </div>
  );
}

function AuditDialog({ row, flash, next, onOpen, onClose }: {
  row: PutawayRow; flash?: string;
  next: (from: PutawayRow) => { row: PutawayRow; left: number } | null;
  onOpen: (row: PutawayRow, flash: string) => void; onClose: () => void;
}) {
  const router = useRouter();
  const [checker, setChecker] = usePersonName();
  const [skuInput, setSkuInput] = useState("");
  const [found, setFound] = useState<{ code: string; sku: string } | null>(null);
  const [batch, setBatch] = useState("");
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SaveResult | null>(null);
  const [upNext, setUpNext] = useState<{ row: PutawayRow; left: number } | null>(null);
  const batchRef = useRef<HTMLInputElement>(null);
  const countRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLInputElement>(null);
  const n = Number(counted);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (checker.trim().length < 2 || !found || counted.trim() === "" || !Number.isFinite(n) || n < 0) {
      return setError("Isi nama checker, scan karton / SKU dan jumlah.");
    }
    setBusy(true); setError(null);
    const { data, error } = await createClient().rpc("record_putaway_audit", {
      p_movement_id: row.movement_id, p_checker_name: checker, p_found: found.code, p_batch: batch, p_counted: n, p_note: note,
    });
    setBusy(false);
    if (error) {
      if (error.message.startsWith("Ada selisih")) noteRef.current?.focus();
      return setError(error.message);
    }
    const r = data as SaveResult;
    const following = next(row);
    router.refresh();
    if (r.result === "OK" && following) {
      return onOpen(following.row, `${row.to_bin} ${row.sku} sesuai · ${following.left} putaway lagi`);
    }
    setUpNext(following);
    setSaved(r);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`${row.to_bin} · ${row.sku}`}
        description={`${row.description} · batch ${row.batch_lot || "–"} · ${fmtNum(row.quantity)} ${row.uom ?? ""}`}>
        {saved ? (
          <div className="space-y-4">
            <p className={cn("rounded-md p-3 text-base font-semibold", saved.result === "OK" ? "bg-ok/10 text-ok" : "bg-bad/10 text-bad")}>
              {saved.result === "OK" ? "Sesuai. Putaway lolos audit." : "Ada selisih."}
            </p>
            <Table>
              <thead><tr><Th /><Th>Di bin</Th><Th>Putaway</Th></tr></thead>
              <tbody>
                <tr className={cn(!saved.sku_ok && "text-bad")}><Td>SKU</Td><Td className="font-semibold">{saved.found.sku}</Td><Td>{saved.expected.sku}</Td></tr>
                <tr className={cn(!saved.batch_ok && "text-bad")}><Td>Batch</Td><Td className="font-semibold">{saved.found.batch || "–"}</Td><Td>{saved.expected.batch || "–"}</Td></tr>
                <tr className={cn(saved.found.qty !== saved.expected.qty && "text-bad")}><Td>Jumlah</Td><Td className="font-semibold">{fmtNum(saved.found.qty)}</Td><Td>{fmtNum(saved.expected.qty)}</Td></tr>
              </tbody>
            </Table>
            {saved.result === "MISMATCH" && (
              <p className="text-sm">Perbaiki di rak (pindahkan / tukar / hitung ulang), lalu audit ulang. Koreksi stok lewat Adjust stok bila memang berbeda.</p>
            )}
            {upNext && <Button size="lg" className="w-full" onClick={() => onOpen(upNext.row, "")}>Lanjut: {upNext.row.to_bin} {upNext.row.sku}</Button>}
            <Button size="lg" variant={upNext ? "outline" : "default"} className="w-full" onClick={onClose}>Tutup</Button>
          </div>
        ) : (
          <form onSubmit={save} className="space-y-4">
            {flash && <p role="status" className="flex items-center gap-1 rounded-md bg-ok/10 p-2 text-sm font-semibold text-ok"><CheckCircle2 className="h-4 w-4" />{flash}</p>}
            <PersonNameField value={checker} onChange={setChecker} label="Nama checker (bukan yang putaway)" id="checker" />
            <div>
              <Label htmlFor="found">Scan karton / ketik SKU yang ada di bin</Label>
              <ItemScanInput id="found" value={skuInput} autoFocus
                onChange={(v) => { setSkuInput(v); if (found && v !== found.sku && v !== found.code) setFound(null); }}
                onItem={(it, code) => { setFound(it ? { code, sku: it.sku } : null); if (it) batchRef.current?.focus(); }} />
              {found && <p className="mt-1 text-xs font-semibold text-ok">Terbaca: {found.sku}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="batch">Batch di karton</Label>
                <Input id="batch" ref={batchRef} value={batch} onChange={(e) => setBatch(e.target.value)} placeholder="mis. 14H26JJ" autoCapitalize="characters"
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); countRef.current?.focus(); } }} />
              </div>
              <div>
                <Label htmlFor="counted">Jumlah dihitung</Label>
                <Input id="counted" ref={countRef} type="number" inputMode="numeric" min={0} step="any" value={counted}
                  onChange={(e) => setCounted(e.target.value)} required />
              </div>
            </div>
            <div>
              <Label htmlFor="pnote">Catatan (wajib bila tidak sesuai)</Label>
              <Input id="pnote" ref={noteRef} value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. batch di karton beda" />
            </div>
            {error && <p role="alert" className="rounded-md bg-bad/10 p-2 text-sm text-bad">{error}</p>}
            <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? "Menyimpan…" : "Simpan audit"}</Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
