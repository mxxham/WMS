"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ItemScanInput } from "@/components/app/item-scan-input";
import { PersonNameField, usePersonName } from "@/components/app/person-name";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { RECEIPT_STATUS } from "@/lib/inventory-control";
import { cn, fmtDate, fmtDateTime, fmtNum } from "@/lib/utils";

export type ReceiptSummary = {
  id: string; doc_no: string; doc_date: string | null; supplier: string; vehicle: string | null; note: string | null;
  status: keyof typeof RECEIPT_STATUS; created_by_name: string; created_at: string; checked_by_name: string | null; checked_at: string | null;
  posted_by_name: string | null; posted_at: string | null; expected_qty: number; good_qty: number; damaged_qty: number; pallets: number; issues: number;
};

type DocDraft = { sku: string; batch_lot: string; quantity: string };
const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });

export function ReceivingList({ receipts, supervisor }: { receipts: ReceiptSummary[]; supervisor: boolean }) {
  return (
    <div className="space-y-6 p-4 lg:p-8">
      <p className="max-w-3xl text-sm text-steel-500">
        1. Supervisor membuat penerimaan dari dokumen Shell (DO / surat jalan). 2. Pemeriksa di dock mencatat per palet apa yang benar-benar datang — SKU, batch,
        expired (dicek dengan kode batch), qty baik, qty rusak, bin tujuan — tanpa melihat qty dokumen. 3. Orang lain memposting: stok baik masuk bin,
        karton rusak ke karantina dengan hold, dan selisih dengan dokumen tercatat.
      </p>
      {supervisor && <NewReceipt />}
      <Card>
        <CardHeader><CardTitle>Penerimaan</CardTitle></CardHeader>
        <CardContent>
          {receipts.length === 0 ? <p className="text-sm text-steel-500">Belum ada penerimaan.</p> : (
            <Table>
              <thead><tr><Th>Dokumen</Th><Th>Tanggal</Th><Th>Status</Th><Th className="text-right">Dokumen</Th><Th className="text-right">Baik</Th><Th className="text-right">Rusak</Th><Th className="text-right">Selisih</Th><Th>Orang</Th></tr></thead>
              <tbody>{receipts.map((r) => (
                <tr key={r.id} className={cn(r.status === "OPEN" && "bg-plate/10")}>
                  <Td><Link className="font-semibold underline" href={`/receiving/${r.id}`}>{r.doc_no}</Link><div className="text-xs">{r.supplier}{r.vehicle && ` · ${r.vehicle}`}</div></Td>
                  <Td className="whitespace-nowrap text-xs">{fmtDate(r.doc_date)}<div>dibuat {fmtDateTime(r.created_at)}</div></Td>
                  <Td className="text-xs">{RECEIPT_STATUS[r.status]}</Td>
                  <Td className="text-right tabular">{fmtNum(Number(r.expected_qty))}</Td>
                  <Td className="text-right tabular">{r.status === "OPEN" ? "–" : fmtNum(Number(r.good_qty))}</Td>
                  <Td className="text-right tabular">{r.status === "OPEN" ? "–" : Number(r.damaged_qty) ? fmtNum(Number(r.damaged_qty)) : "–"}</Td>
                  <Td className={cn("text-right tabular", r.issues > 0 && r.status !== "OPEN" && "font-semibold text-warn")}>{r.status === "OPEN" ? "–" : fmtNum(r.issues)}</Td>
                  <Td className="text-xs">{r.created_by_name}{r.checked_by_name && ` → ${r.checked_by_name}`}{r.posted_by_name && ` → ${r.posted_by_name}`}</Td>
                </tr>
              ))}</tbody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function NewReceipt() {
  const router = useRouter();
  const [person, setPerson] = usePersonName();
  const [docNo, setDocNo] = useState("");
  const [docDate, setDocDate] = useState(today());
  const [vehicle, setVehicle] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<DocDraft[]>([{ sku: "", batch_lot: "", quantity: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (i: number, patch: Partial<DocDraft>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  async function upload(f: File | undefined) {
    if (!f) return;
    setError(null);
    try {
      // The Excel library and the delivery-doc parser load with the file, not with the page.
      const [XLSX, { parseDeliveryDoc }] = await Promise.all([import("xlsx"), import("@/lib/sap-stock")]);
      const doc = parseDeliveryDoc(XLSX.read(await f.arrayBuffer()));
      setLines(doc.map((d) => ({ sku: d.sku, batch_lot: d.batch_lot, quantity: String(d.quantity) })));
    } catch (e) { setError(`${f.name}: ${(e as Error).message}`); }
  }

  async function create() {
    setError(null);
    const filled = lines.filter((l) => l.sku.trim());
    if (!docNo.trim()) return setError("Isi nomor dokumen.");
    if (filled.length === 0) return setError("Isi baris dokumen (atau upload file DO).");
    if (filled.some((l) => !(Number(l.quantity) > 0))) return setError("Setiap baris butuh qty lebih dari 0.");
    setBusy(true);
    const { data, error } = await createClient().rpc("create_receipt", {
      p_doc_no: docNo, p_doc_date: docDate || null, p_vehicle: vehicle || null, p_note: note || null, p_by_name: person,
      p_lines: filled.map((l) => ({ sku: l.sku.trim(), batch_lot: l.batch_lot.trim(), quantity: Number(l.quantity) })),
    });
    setBusy(false);
    if (error) return setError(error.message);
    router.push(`/receiving/${data}`);
  }

  return (
    <Card>
      <CardHeader><CardTitle>Penerimaan baru</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div><Label htmlFor="docno">No. DO / surat jalan</Label><Input id="docno" className="w-48 uppercase" value={docNo} onChange={(e) => setDocNo(e.target.value)} /></div>
          <div><Label htmlFor="docdate">Tanggal dokumen</Label><Input id="docdate" type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} /></div>
          <div><Label htmlFor="veh">Kendaraan</Label><Input id="veh" className="w-40" value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder="nopol" /></div>
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-steel-300 bg-white px-3 py-2 text-sm hover:bg-paper">
            <Upload className="h-4 w-4" />Isi dari file DO (.xlsx)
            <input type="file" accept=".xlsx,.xls" className="sr-only" onChange={(e) => upload(e.target.files?.[0])} />
          </label>
        </div>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1.4fr_1fr_8rem_2.5rem] gap-2">
              <ItemScanInput value={l.sku} onChange={(v) => set(i, { sku: v })} />
              <Input aria-label="Batch di dokumen" value={l.batch_lot} onChange={(e) => set(i, { batch_lot: e.target.value })} placeholder="Batch (jika ada)" />
              <Input aria-label="Qty dokumen" inputMode="numeric" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value.replace(/[^\d.]/g, "") })} placeholder="Qty" />
              <Button size="icon" variant="ghost" aria-label="Hapus baris" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => setLines([...lines, { sku: "", batch_lot: "", quantity: "" }])}><Plus className="h-4 w-4" />Tambah baris</Button>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1"><Label htmlFor="rnote">Catatan</Label><Input id="rnote" value={note} onChange={(e) => setNote(e.target.value)} placeholder="opsional" /></div>
          <PersonNameField id="cperson" value={person} onChange={setPerson} />
          <Button onClick={create} disabled={busy || person.trim().length < 2}>{busy ? "Membuat…" : "Buat penerimaan"}</Button>
        </div>
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      </CardContent>
    </Card>
  );
}
