import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { SHIPMENT_STATE_LABEL, SHIPMENT_STATE_TONE, type ShipmentState } from "@/lib/pick-audit";
import { cn, fmtDate, fmtDateTime, fmtNum } from "@/lib/utils";

/** One row of pick_audit_shipment. */
export type ShipmentRow = {
  wave_id: string; wave_no: string; planned_date: string; planned_slot: string | null; wave_status: string; planned_truck: string | null;
  shipment_number: string; open_tasks: number; lines: number; todo: number; ok: number; mismatch: number; resolved: number;
  state: ShipmentState; loaded_at: string | null; loaded_by_name: string | null; truck: string | null; load_legacy: boolean;
};

export function StateBadge({ state }: { state: ShipmentState }) {
  return <span className={cn("rounded px-2 py-0.5 text-xs font-semibold", SHIPMENT_STATE_TONE[state])}>{SHIPMENT_STATE_LABEL[state]}</span>;
}

export const shipmentHref = (s: { wave_id: string; shipment_number: string }) =>
  `/audit/picking/${s.wave_id}/${encodeURIComponent(s.shipment_number)}`;

/** Shipments with their audit progress; a row opens the shipment. */
export function ShipmentList({ rows, empty, showDate }: { rows: ShipmentRow[]; empty: string; showDate?: boolean }) {
  if (!rows.length) return <p className="text-sm text-steel-500">{empty}</p>;
  return (
    <Card>
      <CardContent>
        <Table sticky>
          <thead><tr>
            <Th>Shipment</Th>{showDate && <Th>Tanggal</Th>}<Th>NO</Th><Th>Truk</Th><Th>Lolos audit</Th><Th>Status</Th><Th>Dimuat</Th>
          </tr></thead>
          <tbody>{rows.map((s) => {
            const passed = s.ok + s.resolved;
            return (
              <tr key={`${s.wave_id}|${s.shipment_number}`} className={cn(s.state === "HAS_MISMATCH" && "bg-bad/5")}>
                <Td><Link className="font-semibold underline" href={shipmentHref(s)}>{s.shipment_number}</Link></Td>
                {showDate && <Td className="whitespace-nowrap">{fmtDate(s.planned_date)}</Td>}
                <Td>{s.wave_no}{s.planned_slot ? ` · ${s.planned_slot}` : ""}</Td>
                <Td className="text-xs">{s.truck ?? s.planned_truck ?? "–"}</Td>
                <Td className="min-w-40">
                  <div className="text-xs tabular">{fmtNum(passed)}/{fmtNum(s.lines)} baris
                    {s.mismatch > 0 && <span className="text-bad"> · {fmtNum(s.mismatch)} selisih</span>}
                    {s.open_tasks > 0 && <span className="text-steel-500"> · {fmtNum(s.open_tasks)} belum dipick</span>}
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded bg-steel-100">
                    <div className={cn("h-full", s.mismatch ? "bg-bad" : "bg-ok")} style={{ width: `${s.lines ? (passed / s.lines) * 100 : 0}%` }} />
                  </div>
                </Td>
                <Td><StateBadge state={s.state} /></Td>
                <Td className="whitespace-nowrap text-xs">
                  {s.state === "LOADED" ? (s.load_legacy ? "sebelum audit wajib" : <>{fmtDateTime(s.loaded_at)}<br /><span className="text-steel-500">{s.loaded_by_name}</span></>) : "–"}
                </Td>
              </tr>
            );
          })}</tbody>
        </Table>
      </CardContent>
    </Card>
  );
}
