"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, MessageSquare } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PersonNameField, usePersonName } from "@/components/app/person-name";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { ledgerSheetRows, type LedgerLine, type LedgerSummary } from "@/lib/ledger/compare";
import { saveSheets } from "@/lib/save-xlsx";
import { cn, fmtDate, fmtNum } from "@/lib/utils";

/** The BOOK TO BOOK table of one day: filter, notes, Excel. */
export function DayView({ date, lines, summary }: { date: string; lines: LedgerLine[]; summary: LedgerSummary }) {
  const [onlyDiff, setOnlyDiff] = useState(true);
  const [noteFor, setNoteFor] = useState<LedgerLine | null>(null);
  const shown = onlyDiff ? lines.filter((l) => !l.match) : lines;
  const n = (v: number | undefined) => fmtNum(v ?? 0);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-md bg-white p-1 text-sm">
          <button className={cn("rounded px-3 py-1", onlyDiff && "bg-ckb text-white")} onClick={() => setOnlyDiff(true)}>Hanya selisih ({lines.filter((l) => !l.match).length})</button>
          <button className={cn("rounded px-3 py-1", !onlyDiff && "bg-ckb text-white")} onClick={() => setOnlyDiff(false)}>Semua ({lines.length})</button>
        </div>
        <Button variant="outline" onClick={() => saveSheets({ Ringkasan: summaryRows(date, summary), "Book to Book": ledgerSheetRows(lines) }, `Buku stok ${date}.xlsx`, "tidak ada SKU")}>
          <Download className="h-4 w-4" />Download Excel
        </Button>
      </div>
      {shown.length === 0 && <p className="text-sm text-ok">Semua SKU sama: stok akhir SAP = stok akhir WMS.</p>}

      {/* phone: one card per SKU */}
      <div className="space-y-2 md:hidden">{shown.map((l) => (
        <Card key={l.sku} className={cn(!l.match && "border-bad/40")}><CardContent className="space-y-1 text-sm">
          <div className="flex justify-between gap-2"><span className="font-semibold">{l.sku}</span><span className="text-xs text-steel-500">{l.uom}</span></div>
          <div className="text-xs text-steel-500">{l.description}</div>
          <div className="grid grid-cols-3 gap-1 text-xs tabular">
            <span /><span className="text-steel-500">SAP</span><span className="text-steel-500">WMS</span>
            <span>Awal</span><span>{n(l.sap?.awal_unrest)}</span><span>{n(l.wms?.awal_unrest)}</span>
            <span>Inbound</span><span>{n(l.sap?.inbound)}</span><span>{n(l.wms?.inbound)}</span>
            <span>Outbound</span><span>{n(l.sap?.outbound)}</span><span>{n(l.wms?.outbound)}</span>
            <span>Akhir</span><span>{n(l.sap?.akhir_unrest)}</span><span>{n(l.wms?.akhir_unrest)}</span>
            <span>Block</span><span>{n(l.sap?.akhir_block)}</span><span>{n(l.wms?.akhir_block)}</span>
          </div>
          {!l.match && <p className="font-semibold text-bad">Selisih unrest {fmtNum(l.diff_unrest)} · block {fmtNum(l.diff_block)}</p>}
          <NoteLine l={l} onEdit={() => setNoteFor(l)} />
        </CardContent></Card>
      ))}</div>

      {/* desktop: BOOK TO BOOK */}
      <Card className="hidden md:block"><CardContent>
        <Table sticky>
          <thead>
            <tr><Th /><Th colSpan={6} className="text-center">SAP</Th><Th colSpan={6} className="text-center">WMS</Th><Th colSpan={2} className="text-center">WMS − SAP</Th><Th /></tr>
            <tr><Th>SKU</Th>
              {["Awal", "Blok awal", "Inbound", "Outbound", "Akhir", "Blok akhir", "Awal", "Blok awal", "Inbound", "Outbound", "Akhir", "Blok akhir", "Unrest", "Blok"].map((h, i) => <Th key={i} className="text-right">{h}</Th>)}
              <Th>Catatan</Th></tr>
          </thead>
          <tbody>{shown.map((l) => (
            <tr key={l.sku} className={cn(!l.match && "bg-bad/5")}>
              <Td><span className="font-semibold">{l.sku}</span><br /><span className="text-xs text-steel-500">{l.description} · {l.uom}</span></Td>
              {[l.sap?.awal_unrest, l.sap?.awal_block, l.sap?.inbound, l.sap?.outbound, l.sap?.akhir_unrest, l.sap?.akhir_block,
                l.wms?.awal_unrest, l.wms?.awal_block, l.wms?.inbound, l.wms?.outbound, l.wms?.akhir_unrest, l.wms?.akhir_block]
                .map((v, i) => <Td key={i} className={cn("text-right tabular", i === 6 && "border-l border-steel-100")}>{n(v)}</Td>)}
              <Td className={cn("border-l border-steel-100 text-right font-semibold tabular", l.diff_unrest && "text-bad")}>{fmtNum(l.diff_unrest)}</Td>
              <Td className={cn("text-right font-semibold tabular", l.diff_block && "text-bad")}>{fmtNum(l.diff_block)}</Td>
              <Td className="min-w-48"><NoteLine l={l} onEdit={() => setNoteFor(l)} /></Td>
            </tr>
          ))}</tbody>
        </Table>
      </CardContent></Card>

      {noteFor && <NoteDialog date={date} line={noteFor} onClose={() => setNoteFor(null)} />}
    </section>
  );
}

/** The day's accuracy and totals, by quantity and by SKU, as the first sheet of the download. */
function summaryRows(date: string, s: LedgerSummary): Record<string, string | number | null>[] {
  const row = (label: string, v: number | null, unit = "%") => ({ Tanggal: date, Ukuran: label, Nilai: v, Satuan: unit });
  return [
    row("Akurasi qty stok akhir", s.qtyAccuracy), row("Akurasi qty unrestricted", s.qtyAccuracyUnrest),
    row("Akurasi qty blok", s.qtyAccuracyBlock), row("Akurasi SKU", s.accuracy),
    row("SKU selisih", s.differing, "SKU"), row("SKU dihitung", s.skus, "SKU"), row("Total selisih", s.absDiff, "karton"),
    row("SAP stok akhir unrestricted", s.sap.akhir_unrest, "karton"), row("WMS stok akhir unrestricted", s.wms.akhir_unrest, "karton"),
    row("SAP stok akhir blok", s.sap.akhir_block, "karton"), row("WMS stok akhir blok", s.wms.akhir_block, "karton"),
  ];
}

function NoteLine({ l, onEdit }: { l: LedgerLine; onEdit: () => void }) {
  return (
    <div className="space-y-1 text-xs">
      {l.note && <p>{l.note.note} <span className="text-steel-500">· {l.note.by_name ?? "–"}, sejak {fmtDate(l.note.from_date)}</span></p>}
      {(!l.match || l.note) && (
        <button className="inline-flex items-center gap-1 underline" onClick={onEdit}><MessageSquare className="h-3 w-3" />{l.note ? "Ubah / tutup" : "Catatan"}</button>
      )}
    </div>
  );
}

function NoteDialog({ date, line, onClose }: { date: string; line: LedgerLine; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = usePersonName();
  const [text, setText] = useState(line.note?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(closed: boolean) {
    if (name.trim().length < 2) return setError("Isi Nama Anda dulu.");
    if (!closed && !text.trim()) return setError("Isi catatannya.");
    setBusy(true); setError(null);
    const { error } = await createClient().rpc("ledger_add_note", {
      p_sku: line.sku, p_from_date: date, p_note: closed ? "" : text, p_closed: closed, p_by_name: name,
    });
    setBusy(false);
    if (error) return setError(error.message);
    router.refresh();
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Catatan ${line.sku}`} description={line.description}>
        <div className="space-y-4">
          <p className="rounded-md bg-plate/30 p-3 text-sm">
            Catatan untuk {line.sku} mulai {fmtDate(date)}. Tetap tampil di hari berikutnya selama SKU ini masih selisih.
          </p>
          <div>
            <Label htmlFor="ledger-note">Catatan</Label>
            <Input id="ledger-note" value={text} onChange={(e) => setText(e.target.value)} placeholder="mis. kurang 1, indikasi kurang kirim, tunggu barang kembali" />
          </div>
          <PersonNameField value={name} onChange={setName} label="Nama Anda" id="ledger-note-name" />
          {error && <p role="alert" className="rounded-md bg-bad/10 p-2 text-sm text-bad">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button size="lg" className="flex-1" disabled={busy} onClick={() => save(false)}>{busy ? "Menyimpan…" : "Simpan catatan"}</Button>
            {line.note && <Button size="lg" variant="outline" disabled={busy} onClick={() => save(true)}>Tutup catatan</Button>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
