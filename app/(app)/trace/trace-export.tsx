"use client";
import * as XLSX from "xlsx";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

type Rows = Record<string, string | number>[];
export type TraceExportData = { batch: string; summary: Rows; shipments: Rows; locations: Rows; history: Rows };

/** One workbook, one sheet per section of the trace page. */
export function TraceExport({ data }: { data: TraceExportData }) {
  function download() {
    const book = XLSX.utils.book_new();
    const add = (rows: Rows, name: string) => XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows.length ? rows : [{ Info: "Tidak ada data" }]), name);
    add(data.summary, "Ringkasan");
    add(data.shipments, "Dikirim ke");
    add(data.locations, "Posisi sekarang");
    add(data.history, "Riwayat");
    XLSX.writeFile(book, `lacak-batch_${data.batch.replace(/[^\w-]+/g, "_")}.xlsx`);
  }
  return <Button type="button" variant="outline" onClick={download}><Download className="h-4 w-4" />Excel</Button>;
}
