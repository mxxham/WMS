"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { cn, fmtDate, fmtNum } from "@/lib/utils";
import { AttemptLine, AuditDialog, type AttemptView } from "../../[wave]/[shipment]/shipment-audit-client";

export type FileLineView = {
  id: string; seq: number; sku: string; description: string; uom: string | null; from_bin: string;
  picklist: string | null; picker_name: string | null; state: "TODO" | "OK" | "MISMATCH"; attempts: number;
  /** only once the line has been audited: what the file says was picked */
  expected?: { qty: number; batch: string; expiry: string | null };
};

const STATE: Record<FileLineView["state"], { label: string; tone: string }> = {
  TODO: { label: "Belum diaudit", tone: "text-steel-500" },
  OK: { label: "OK", tone: "text-ok" },
  MISMATCH: { label: "Selisih", tone: "text-bad" },
};

/**
 * Lines of one shipment from the WMS file. The checker records what is on
 * the pallet without seeing the file's numbers; the database compares.
 * A mismatch is fixed on the floor and audited again.
 */
export function FileAuditClient({ date, shipment, waveNo, source, lines, attempts, canCorrect }: {
  date: string; shipment: string; waveNo: string | null; source: "K_ONE" | "ALLOCATOR"; lines: FileLineView[]; attempts: AttemptView[];
  /** supervisor / admin: a passed line can be recorded again (Ubah, 0032) */
  canCorrect: boolean;
}) {
  const [audit, setAudit] = useState<{ line: FileLineView; flash?: string; correct?: boolean } | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const byLine = new Map<string, AttemptView[]>();
  for (const a of attempts) byLine.set(a.task_id, [...(byLine.get(a.task_id) ?? []), a]);
  const ok = lines.filter((l) => l.state === "OK").length;
  const mismatch = lines.filter((l) => l.state === "MISMATCH").length;

  function nextTodo(from: FileLineView): { line: FileLineView; left: number } | null {
    const skip = new Set(saved).add(from.id);
    setSaved(skip);
    const todo = lines.filter((l) => l.state === "TODO" && !skip.has(l.id));
    const line = todo.find((l) => l.seq > from.seq) ?? todo[0];
    return line ? { line, left: todo.length } : null;
  }

  return (
    <div className="space-y-4">
      <Link href={`/audit/picking?tab=file&view=shipment&date=${date}`} className="inline-flex items-center gap-1 text-sm underline"><ArrowLeft className="h-4 w-4" />Semua shipment</Link>
      <Card>
        <CardContent className="space-y-1">
          <h2 className="font-cond text-2xl font-semibold">SH {shipment}</h2>
          <p className="text-sm text-steel-500">NO {waveNo ?? "–"} · {fmtDate(date)} · dari file WMS ({source === "K_ONE" ? "sheet K_ONE" : "alokasi dari stok WMS"})</p>
          <p className="text-sm">{fmtNum(ok)}/{fmtNum(lines.length)} baris lolos
            {mismatch > 0 && <span className="text-bad"> · {fmtNum(mismatch)} selisih</span>}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <Table>
            <thead><tr><Th>#</Th><Th>SKU</Th><Th>Bin asal</Th><Th>Status</Th><Th>Di file / audit</Th><Th /></tr></thead>
            <tbody>{lines.map((l) => (
              <tr key={l.id} className={cn(l.state === "MISMATCH" && "bg-bad/5")}>
                <Td className="tabular">{l.seq}</Td>
                <Td><span className="font-semibold">{l.sku}</span><br /><span className="text-xs text-steel-500">{l.description}</span></Td>
                <Td className="font-semibold">{l.from_bin}{l.picklist && <span className="block text-xs font-normal text-steel-500">{l.picklist}</span>}</Td>
                <Td className={cn("text-xs font-semibold", STATE[l.state].tone)}>{STATE[l.state].label}</Td>
                <Td className="space-y-1 text-xs">
                  {l.expected
                    ? <p>{fmtNum(l.expected.qty)} {l.uom ?? ""} · batch {l.expected.batch || "–"} · exp {fmtDate(l.expected.expiry)}</p>
                    : <p className="text-steel-500">disembunyikan sampai diaudit</p>}
                  {(byLine.get(l.id) ?? []).map((a) => <AttemptLine key={a.id} a={a} />)}
                </Td>
                <Td className="text-right">
                  {l.state === "OK" && canCorrect && (
                    <Button size="sm" variant="ghost" className="underline" onClick={() => setAudit({ line: l, correct: true })}>Ubah</Button>
                  )}
                  {l.state !== "OK" && (
                    <Button size="sm" variant={l.state === "TODO" ? "default" : "outline"} onClick={() => setAudit({ line: l })}>
                      <ClipboardCheck className="h-4 w-4" />{l.state === "TODO" ? "Audit" : "Audit ulang"}
                    </Button>
                  )}
                </Td>
              </tr>
            ))}</tbody>
          </Table>
        </CardContent>
      </Card>
      {audit && <AuditDialog key={`${audit.line.id}|${audit.correct ? "ubah" : ""}`} line={audit.line} rpc="record_sheet_pick_audit"
        target={{ p_line_id: audit.line.id }} correct={audit.correct}
        expectedLabel="Di file WMS" flash={audit.flash} next={nextTodo}
        onOpen={(line, flash) => setAudit({ line, flash })} onClose={() => setAudit(null)} />}
    </div>
  );
}
