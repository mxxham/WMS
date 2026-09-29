import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { cn, fmtNum } from "@/lib/utils";
import { RACK_STATE_LABEL, RACK_STATE_TONE, type RackSummary } from "./rack-data";

/**
 * Racks (aisles) worked on the date with their audit progress; a row opens
 * the rack. Picking counts progress per bin, putaway per putaway (`unit`).
 */
export function RackList({ rows, href, empty, head, unit }: {
  rows: RackSummary[]; href: (zone: string) => string; empty: string;
  /** column titles for the bins and lines counts */
  head: [string, string];
  unit: { of: "bins" | "lines"; label: string; doneHead: string };
}) {
  if (!rows.length) return <p className="text-sm text-steel-500">{empty}</p>;
  return (
    <Card>
      <CardContent>
        <Table sticky>
          <thead><tr><Th>Rak</Th><Th>{head[0]}</Th><Th>{head[1]}</Th><Th>{unit.doneHead}</Th><Th>Status</Th></tr></thead>
          <tbody>{rows.map((r) => {
            const total = unit.of === "bins" ? r.bins : r.lines;
            return (
            <tr key={r.zone} className={cn(r.state === "MISMATCH" && "bg-bad/5")}>
              <Td><Link className="font-cond text-lg font-semibold underline" href={href(r.zone)}>{r.zone}</Link></Td>
              <Td className="tabular">{fmtNum(r.bins)}</Td>
              <Td className="tabular">{fmtNum(r.lines)}</Td>
              <Td className="min-w-40">
                <div className="text-xs tabular">{fmtNum(r.done)}/{fmtNum(total)} {unit.label}
                  {r.mismatch > 0 && <span className="text-bad"> · {fmtNum(r.mismatch)} selisih</span>}
                  {r.todo > 0 && <span className="text-steel-500"> · {fmtNum(r.todo)} belum</span>}
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded bg-steel-100">
                  <div className={cn("h-full", r.mismatch ? "bg-bad" : "bg-ok")} style={{ width: `${total ? (r.done / total) * 100 : 0}%` }} />
                </div>
              </Td>
              <Td><span className={cn("rounded px-2 py-0.5 text-xs font-semibold", RACK_STATE_TONE[r.state])}>{RACK_STATE_LABEL[r.state]}</span></Td>
            </tr>
            );
          })}</tbody>
        </Table>
      </CardContent>
    </Card>
  );
}
