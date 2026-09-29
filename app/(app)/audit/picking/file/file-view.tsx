import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { cn, fmtNum } from "@/lib/utils";
import { FileUpload } from "../file-upload";
import { sheetShipmentHref, type SheetShipment } from "./data";

/** The "Dari file WMS" tab: load the day's file, then audit shipment by shipment. */
export function FileView({ date, shipments, source }: { date: string; shipments: SheetShipment[]; source: string | null }) {
  const lines = shipments.reduce((s, x) => s + x.lines, 0);
  const tile = (n: number, label: string) => (
    <div className="rounded-lg border-l-4 border-ckb bg-white p-3">
      <div className="font-cond text-3xl font-semibold tabular">{fmtNum(n)}</div>
      <div className="text-xs text-steel-500">{label}</div>
    </div>
  );
  return (
    <div className="space-y-4">
      <FileUpload date={date} existing={lines} />
      {shipments.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {tile(shipments.reduce((s, x) => s + x.todo, 0), "Baris belum diaudit")}
          {tile(shipments.reduce((s, x) => s + x.mismatch, 0), "Baris selisih")}
          {tile(shipments.reduce((s, x) => s + x.ok, 0), "Baris OK")}
          {tile(shipments.filter((x) => x.ok === x.lines).length, "Shipment selesai")}
        </div>
      )}
      {source && <p className="text-sm text-steel-500">Baris dari {source}. Checker mencatat isi palet tanpa melihat angka di file.</p>}
      {!shipments.length ? <p className="text-sm text-steel-500">Belum ada file WMS untuk tanggal ini. Pilih file di atas.</p> : (
        <Card>
          <CardContent>
            <Table>
              <thead><tr><Th>Shipment</Th><Th>NO</Th><Th>Lolos audit</Th><Th>Status</Th></tr></thead>
              <tbody>{shipments.map((s) => (
                <tr key={s.shipment_number} className={cn(s.mismatch > 0 && "bg-bad/5")}>
                  <Td><Link className="font-semibold underline" href={sheetShipmentHref(date, s.shipment_number)}>{s.shipment_number}</Link></Td>
                  <Td>{s.wave_no ?? "–"}</Td>
                  <Td className="min-w-40">
                    <div className="text-xs tabular">{fmtNum(s.ok)}/{fmtNum(s.lines)} baris
                      {s.mismatch > 0 && <span className="text-bad"> · {fmtNum(s.mismatch)} selisih</span>}</div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded bg-steel-100">
                      <div className={cn("h-full", s.mismatch ? "bg-bad" : "bg-ok")} style={{ width: `${(s.ok / s.lines) * 100}%` }} />
                    </div>
                  </Td>
                  <Td className={cn("text-xs font-semibold", s.mismatch ? "text-bad" : s.todo ? "text-steel-500" : "text-ok")}>
                    {s.mismatch ? "Ada selisih" : s.todo ? "Siap audit" : "Selesai"}
                  </Td>
                </tr>
              ))}</tbody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
