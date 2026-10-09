"use client";
import { useState } from "react";
import Link from "next/link";
import { Check, ClipboardCheck, Download, Hourglass, ScanSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AdjustLineButton } from "@/components/app/adjust-line";
import { cn, fmtDate, fmtNum } from "@/lib/utils";

/** One row of picklist_corrections (0057). */
export type PicklistCorrection = {
  id: string; created_at: string; by_name: string | null; planned_date: string; wave_no: string; seq: number;
  had: number; paper: number; bin_code: string; sku: string; description: string | null; uom: string | null;
  batch_lot: string; expiry_date: string | null; added: number; stock_now: number;
  count_id: string | null; count_status: string | null; count_closed_at: string | null;
};

const settled = (c: PicklistCorrection) => c.count_status === "APPLIED" || c.count_status === "CLOSED";
const STATUS: Record<string, { text: string; tone: string; Icon: typeof Check }> = {
  OPEN: { text: "Belum dihitung", tone: "bg-warn/15 text-warn", Icon: Hourglass },
  RECOUNT: { text: "Hitung ulang", tone: "bg-warn/15 text-warn", Icon: Hourglass },
  COUNTED: { text: "Dihitung, tunggu disetujui", tone: "bg-ckb-tint text-ckb", Icon: ClipboardCheck },
  APPLIED: { text: "Selesai", tone: "bg-ok/10 text-ok", Icon: Check },
  CLOSED: { text: "Selesai", tone: "bg-ok/10 text-ok", Icon: Check },
};

/**
 * Koreksi picklist of the day: every bin the paper took more from than the
 * system had (Isi dari picklist books the difference and opens a count). One
 * list after the whole day is entered — which SKU, which bin, how much, from
 * which row, what the bin holds now, and whether someone has counted it yet —
 * so a shortage the floor never had is checked, not assumed.
 */
export function CorrectionsPanel({ date, rows, canAdjust }: { date: string; rows: PicklistCorrection[]; canAdjust: boolean }) {
  const [showSettled, setShowSettled] = useState(false);
  if (rows.length === 0) return null;

  const open = rows.filter((c) => !settled(c));
  const shown = showSettled ? rows : open;
  const bySku = new Map<string, PicklistCorrection[]>();
  for (const c of [...shown].sort((a, b) => a.sku.localeCompare(b.sku) || a.bin_code.localeCompare(b.bin_code))) {
    bySku.set(c.sku, [...(bySku.get(c.sku) ?? []), c]);
  }
  const total = rows.reduce((n, c) => n + Number(c.added), 0);

  async function download() {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Koreksi picklist", { views: [{ state: "frozen", ySplit: 3 }] });
    ws.mergeCells(1, 1, 1, 12);
    ws.getCell(1, 1).value = `Koreksi picklist · wave ${date}`;
    ws.getCell(1, 1).font = { name: "Calibri", size: 15, bold: true, color: { argb: "FF135F45" } };
    ws.mergeCells(2, 1, 2, 12);
    ws.getCell(2, 1).value = `${rows.length} koreksi · ${new Set(rows.map((c) => c.bin_code)).size} bin · ${new Set(rows.map((c) => c.sku)).size} SKU · +${total} karton · ${open.length} belum dicek`;
    ws.getCell(2, 1).font = { name: "Calibri", size: 10, color: { argb: "FF586A63" } };
    const cols: [string, number][] = [["SKU", 12], ["Barang", 34], ["Bin", 10], ["Batch", 12], ["Exp", 11], ["Ditambah", 10], ["Sistem saat itu", 13],
      ["Kertas", 9], ["Dari", 10], ["Stok sekarang", 13], ["Hitung", 24], ["Dicatat oleh", 16]];
    ws.columns = cols.map(([, width]) => ({ width }));
    const head = ws.getRow(3);
    head.values = cols.map(([h]) => h);
    head.height = 22;
    head.eachCell((cell) => {
      cell.font = { name: "Calibri", bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF135F45" } };
      cell.alignment = { vertical: "middle" };
    });
    const sorted = [...rows].sort((a, b) => a.sku.localeCompare(b.sku) || a.bin_code.localeCompare(b.bin_code));
    sorted.forEach((c, i) => {
      const r = ws.getRow(4 + i);
      r.values = [c.sku, c.description ?? "", c.bin_code, c.batch_lot, c.expiry_date ? new Date(`${c.expiry_date.slice(0, 10)}T00:00:00Z`) : "",
        Number(c.added), Number(c.had), Number(c.paper), `NO ${c.wave_no} #${c.seq}`, Number(c.stock_now),
        STATUS[c.count_status ?? ""]?.text ?? "Tanpa hitung", c.by_name ?? ""];
      r.getCell(5).numFmt = "dd/mm/yyyy";
      r.getCell(6).numFmt = "+#,##0";
      r.getCell(3).font = { name: "Calibri", bold: true };
      r.eachCell({ includeEmpty: true }, (cell, col) => {
        cell.border = { bottom: { style: "thin", color: { argb: "FFE2E9E5" } } };
        if (col === 11) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: settled(c) ? "FFE2EFDA" : "FFFFF2CC" } };
      });
    });
    ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + sorted.length, column: cols.length } };
    const buf = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const a = document.createElement("a");
    a.href = url; a.download = `koreksi_picklist_${date}.xlsx`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 font-cond text-xl font-semibold"><ScanSearch className="h-5 w-5 text-warn" />Koreksi picklist</h2>
          <p className="max-w-3xl text-sm text-steel-500">
            Bin yang menurut kertas diambil lebih banyak dari stok sistem. Selisihnya sudah ditambahkan dan bin-nya dijadwalkan hitung:
            cek di rak, lalu betulkan dengan Adjust bila fisiknya lain.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void download()}><Download className="h-4 w-4" />Unduh Excel</Button>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-y border-steel-100 bg-paper px-4 py-2 text-sm">
        <span><b className="font-cond text-lg tabular">{fmtNum(open.length)}</b> belum dicek</span>
        <span><b className="font-cond text-lg tabular">{fmtNum(new Set(rows.map((c) => c.bin_code)).size)}</b> bin</span>
        <span><b className="font-cond text-lg tabular">{fmtNum(new Set(rows.map((c) => c.sku)).size)}</b> SKU</span>
        <span><b className="font-cond text-lg tabular">+{fmtNum(total)}</b> karton ditambahkan</span>
        {rows.length > open.length && (
          <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={showSettled} onChange={(e) => setShowSettled(e.target.checked)} />
            Tampilkan yang sudah selesai ({fmtNum(rows.length - open.length)})
          </label>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="flex items-center gap-2 p-4 text-sm text-ok"><Check className="h-4 w-4" />Semua koreksi hari ini sudah dihitung.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] border-separate border-spacing-0 text-sm">
            <thead className="text-left text-xs text-steel-500">
              <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
                <th>Bin</th><th>Batch</th><th>Exp</th><th className="text-right">Ditambah</th><th>Sistem → kertas</th><th>Dari</th>
                <th className="text-right">Stok sekarang</th><th>Hitung</th><th />
              </tr>
            </thead>
            <tbody>
              {[...bySku.entries()].map(([sku, list]) => (
                <SkuGroup key={sku} list={list} canAdjust={canAdjust} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function SkuGroup({ list, canAdjust }: { list: PicklistCorrection[]; canAdjust: boolean }) {
  const head = list[0];
  const sum = list.reduce((n, c) => n + Number(c.added), 0);
  return (
    <>
      <tr>
        <td colSpan={9} className="border-t border-steel-100 bg-steel-100/40 px-3 py-1.5">
          <span className="font-cond font-semibold tabular">{head.sku}</span>
          <span className="ml-2 text-steel-500">{head.description}</span>
          <span className="ml-3 font-cond font-semibold tabular text-warn">+{fmtNum(sum)} {head.uom ?? ""}</span>
          {list.length > 1 && <span className="ml-2 text-xs text-steel-500">di {list.length} baris</span>}
        </td>
      </tr>
      {list.map((c) => {
        const st = STATUS[c.count_status ?? ""];
        return (
          <tr key={c.id} className={cn("align-middle [&>td]:border-b [&>td]:border-steel-100 [&>td]:px-3 [&>td]:py-2", settled(c) && "opacity-60")}>
            <td><span className="rounded-plate border border-plate-dark/40 bg-plate/25 px-2 py-0.5 font-cond font-semibold">{c.bin_code}</span></td>
            <td className="tabular">{c.batch_lot || "–"}</td>
            <td className="tabular">{c.expiry_date ? fmtDate(c.expiry_date) : "–"}</td>
            <td className="text-right font-cond text-base font-semibold tabular text-warn">+{fmtNum(Number(c.added))}</td>
            <td className="tabular text-steel-500">{fmtNum(Number(c.had))} → <span className="text-steel">{fmtNum(Number(c.paper))}</span></td>
            <td className="whitespace-nowrap">NO {c.wave_no} #{c.seq}</td>
            <td className="text-right font-cond text-base tabular">{fmtNum(Number(c.stock_now))}</td>
            <td>
              {st ? (
                <Link href="/counts" className={cn("inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold hover:underline", st.tone)}>
                  <st.Icon className="h-3.5 w-3.5" />{st.text}
                </Link>
              ) : <span className="text-xs text-steel-500">Tanpa hitung</span>}
            </td>
            <td className="text-right">
              {canAdjust && !settled(c) && (
                <AdjustLineButton line={{ bin_code: c.bin_code, sku: c.sku, batch_lot: c.batch_lot, expiry_date: c.expiry_date, quantity: Number(c.stock_now), uom: c.uom }} />
              )}
            </td>
          </tr>
        );
      })}
    </>
  );
}
