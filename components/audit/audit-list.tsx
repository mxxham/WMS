"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, ClipboardCheck, XCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { cn, fmtDate, fmtDateTime, fmtNum } from "@/lib/utils";

export type AuditKind = "PICK" | "PUTAWAY";

export type AuditRow = {
  /** pick task id or movement id */
  ref: string;
  when: string | null;
  by: string | null;
  /** "NO 3 · SH 109682957" or "dari STAGING" */
  context: string;
  bin: string;
  sku: string;
  description: string;
  uom: string | null;
  batch: string;
  expiry: string | null;
  /** what the checker should find: picker's actual (pick) or the moved qty (putaway) */
  expected: number;
  /** pick only: picker reported something other than the plan */
  deviation: string | null;
  audit: { result: "OK" | "MISMATCH"; counted: number; skuOk: boolean; batchOk: boolean; note: string | null; at: string; by: string | null } | null;
};

type Filter = "all" | "todo" | "mismatch" | "deviation";

/**
 * Plan / actual / audited per row, with an Audit button that records what
 * the checker found (record_audit). An audit never changes stock.
 */
export function AuditList({ kind, rows }: { kind: AuditKind; rows: AuditRow[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<AuditRow | null>(null);

  const counts = useMemo(() => ({
    all: rows.length,
    todo: rows.filter((r) => !r.audit).length,
    ok: rows.filter((r) => r.audit?.result === "OK").length,
    mismatch: rows.filter((r) => r.audit?.result === "MISMATCH").length,
    deviation: rows.filter((r) => r.deviation).length,
  }), [rows]);

  const shown = rows.filter((r) =>
    filter === "todo" ? !r.audit : filter === "mismatch" ? r.audit?.result === "MISMATCH" : filter === "deviation" ? !!r.deviation : true);

  const tiles: [Filter | null, string, number, string][] = [
    ["all", kind === "PICK" ? "Pick selesai" : "Putaway", counts.all, "border-steel-300"],
    ["todo", "Belum diaudit", counts.todo, "border-plate"],
    [null, "Audit OK", counts.ok, "border-ok"],
    ["mismatch", "Audit selisih", counts.mismatch, "border-bad"],
  ];
  if (kind === "PICK") tiles.push(["deviation", "Picker lapor beda", counts.deviation, "border-warn"]);

  return (
    <div className="space-y-4">
      <div className={cn("grid grid-cols-2 gap-3", kind === "PICK" ? "sm:grid-cols-5" : "sm:grid-cols-4")}>
        {tiles.map(([f, label, n, border]) => (
          <button key={label} type="button" disabled={f === null} onClick={() => f && setFilter(filter === f ? "all" : f)}
            className={cn("rounded-lg border-l-4 bg-white p-3 text-left", border, f !== null && filter === f && "ring-2 ring-ckb")}>
            <div className="font-cond text-3xl font-semibold tabular">{fmtNum(n)}</div>
            <div className="text-xs text-steel-500">{label}</div>
          </button>
        ))}
      </div>

      <Card>
        <CardContent>
          {shown.length === 0 ? (
            <p className="text-sm text-steel-500">{rows.length === 0 ? (kind === "PICK" ? "Belum ada pick yang selesai di tanggal ini." : "Belum ada putaway di tanggal ini.") : "Tidak ada baris untuk filter ini."}</p>
          ) : (
            <Table sticky>
              <thead><tr>
                <Th>Waktu</Th><Th>{kind === "PICK" ? "Wave / shipment" : "Asal"}</Th><Th>Bin</Th><Th>SKU</Th><Th>Batch · Exp</Th>
                <Th className="text-right">{kind === "PICK" ? "Dipick" : "Qty"}</Th><Th>Audit</Th><Th />
              </tr></thead>
              <tbody>{shown.map((r) => (
                <tr key={r.ref} className={cn(r.audit?.result === "MISMATCH" && "bg-bad/5")}>
                  <Td className="whitespace-nowrap text-xs">{fmtDateTime(r.when)}<br /><span className="text-steel-500">{r.by ?? "–"}</span></Td>
                  <Td className="text-xs">{r.context}</Td>
                  <Td className="font-semibold">{r.bin}</Td>
                  <Td><span className="font-semibold">{r.sku}</span><br /><span className="text-xs text-steel-500">{r.description}</span></Td>
                  <Td className="whitespace-nowrap text-xs">{r.batch || "–"}<br />{fmtDate(r.expiry)}</Td>
                  <Td className="text-right tabular">
                    {fmtNum(r.expected)} {r.uom ?? ""}
                    {r.deviation && <p className="text-xs text-warn">{r.deviation}</p>}
                  </Td>
                  <Td className="text-xs"><AuditBadge row={r} /></Td>
                  <Td className="text-right">
                    <Button size="sm" variant={r.audit ? "outline" : "default"} onClick={() => setOpen(r)}>
                      <ClipboardCheck className="h-4 w-4" />{r.audit ? "Ulang" : "Audit"}
                    </Button>
                  </Td>
                </tr>
              ))}</tbody>
            </Table>
          )}
        </CardContent>
      </Card>

      {open && <AuditDialog kind={kind} row={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function AuditBadge({ row }: { row: AuditRow }) {
  const a = row.audit;
  if (!a) return <span className="text-steel-500">Belum</span>;
  const issues = [
    a.counted !== row.expected && `hitung ${fmtNum(a.counted)}`,
    !a.skuOk && "SKU salah",
    !a.batchOk && "batch salah",
  ].filter(Boolean).join(", ");
  return (
    <div>
      {a.result === "OK"
        ? <span className="inline-flex items-center gap-1 font-semibold text-ok"><CheckCircle2 className="h-4 w-4" />OK</span>
        : <span className="inline-flex items-center gap-1 font-semibold text-bad"><XCircle className="h-4 w-4" />Selisih</span>}
      {issues && <p className="text-bad">{issues}</p>}
      {a.note && <p className="text-steel-700">{a.note}</p>}
      <p className="text-steel-500">{a.by ?? "–"} · {fmtDateTime(a.at)}</p>
    </div>
  );
}

function AuditDialog({ kind, row, onClose }: { kind: AuditKind; row: AuditRow; onClose: () => void }) {
  const router = useRouter();
  const [counted, setCounted] = useState("");
  const [skuOk, setSkuOk] = useState(true);
  const [batchOk, setBatchOk] = useState(true);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<"OK" | "MISMATCH" | null>(null);

  const n = Number(counted);
  const valid = counted.trim() !== "" && Number.isFinite(n) && n >= 0;
  const mismatch = valid && (n !== row.expected || !skuOk || !batchOk);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return setError("Isi jumlah yang dihitung.");
    if (mismatch && !note.trim()) return setError("Ada selisih: tulis catatan apa yang ditemukan.");
    setBusy(true); setError(null);
    const { data, error } = await createClient().rpc("record_audit", {
      p_kind: kind, p_ref: row.ref, p_counted: n, p_sku_ok: skuOk, p_batch_ok: batchOk, p_note: note,
    });
    setBusy(false);
    if (error) return setError(error.message);
    setSaved(data.result);
    router.refresh();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={kind === "PICK" ? "Audit picking" : "Audit putaway"} description={`${row.bin} · ${row.context}`}>
        {saved ? (
          <div className="space-y-4">
            <p className={cn("rounded-md p-3 text-base", saved === "OK" ? "bg-ok/10" : "bg-bad/10")}>
              {saved === "OK" ? "Audit tersimpan: sesuai." : "Audit tersimpan sebagai selisih."}
            </p>
            {saved === "MISMATCH" && kind === "PUTAWAY" && (
              <p className="text-sm">Stok tidak berubah karena audit. Kalau isi bin memang beda, koreksi di{" "}
                <Link className="underline" href={`/adjust?bin=${encodeURIComponent(row.bin)}`}>Adjust stok {row.bin}</Link>.</p>
            )}
            <Button size="lg" className="w-full" onClick={onClose}>Tutup</Button>
          </div>
        ) : (
          <form onSubmit={save} className="space-y-4">
            <div className="rounded-md bg-plate/30 p-3 text-sm">
              <p><b>{row.sku}</b> {row.description}</p>
              <p>Batch {row.batch || "–"} · exp {fmtDate(row.expiry)}</p>
              <p>{kind === "PICK" ? "Picker melaporkan" : "Dipindah ke bin"}: <b>{fmtNum(row.expected)} {row.uom ?? ""}</b></p>
            </div>
            <div>
              <Label htmlFor="counted">Jumlah yang dihitung checker</Label>
              <Input id="counted" type="number" inputMode="decimal" min={0} step="any" autoFocus value={counted} onChange={(e) => setCounted(e.target.value)} required />
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={skuOk} onChange={(e) => setSkuOk(e.target.checked)} />SKU sesuai</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={batchOk} onChange={(e) => setBatchOk(e.target.checked)} />Batch / expired sesuai</label>
            <div>
              <Label htmlFor="note">Catatan{mismatch ? " (wajib, ada selisih)" : ""}</Label>
              <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. kurang 2 karton, batch lain di palet" />
            </div>
            {valid && <p className={cn("text-sm font-semibold", mismatch ? "text-bad" : "text-ok")}>{mismatch ? "Hasil: selisih" : "Hasil: sesuai"}</p>}
            {error && <p role="alert" className="rounded-md bg-bad/10 p-2 text-sm text-bad">{error}</p>}
            <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? "Menyimpan…" : "Simpan audit"}</Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
