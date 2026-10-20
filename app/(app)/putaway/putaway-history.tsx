"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { History } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { fetchAll } from "@/lib/fetch-all";
import { KIND_LABELS, fixSummary, type BinLine, type FixLine, type PutawayKind } from "@/lib/putaway-sheet";
import { cn, fmtDate, fmtDateTime, fmtNum } from "@/lib/utils";

type LogRow = {
  id: string; import_id: string; posted_at: string; by_name: string | null; source: string | null; line: number;
  sheet_bin: string | null; bin_code: string | null; sku: string | null; batch_lot: string | null; expiry_date: string | null;
  quantity: number | null; status: string; kind: PutawayKind | null; action: "add" | "set" | "fix" | null;
  system_before: BinLine[]; fix: FixLine[] | null; fix_error: string | null;
  result: "posted" | "set" | "fixed" | "count_task" | "same" | "skipped";
  request_ids: string[]; count_task_id: string | null;
};

const RESULT: Record<LogRow["result"], string> = {
  posted: "Diposting", set: "Disamakan dengan sheet", fixed: "Isi bin dibetulkan", count_task: "Jadi tugas hitung",
  same: "Sudah tercatat", skipped: "Tidak diposting",
};
const ACTION: Record<NonNullable<LogRow["action"]>, string> = { add: "Tambahkan ke bin", set: "Samakan qty", fix: "Sheet benar" };
const DAYS = 30;

/**
 * Riwayat putaway (0066): every posted sheet line, with the bin as the system had it at that moment.
 * A conflict stays visible here after its count task is closed or its adjustment decided.
 */
export function PutawayHistory() {
  const [rows, setRows] = useState<LogRow[] | null>(null);
  const [requests, setRequests] = useState<Map<string, string>>(new Map());
  const [counts, setCounts] = useState<Map<string, string>>(new Map());
  const [all, setAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const db = createClient();
    const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();
    (async () => {
      try {
        const log = await fetchAll<LogRow>((a, b) => db.from("putaway_log").select("*").gte("posted_at", since)
          .order("posted_at", { ascending: false }).order("line").range(a, b));
        const reqIds = [...new Set(log.flatMap((l) => l.request_ids))];
        const countIds = [...new Set(log.map((l) => l.count_task_id).filter((x): x is string => !!x))];
        const [req, cnt] = await Promise.all([
          reqIds.length ? db.from("adjustment_requests").select("id, status").in("id", reqIds) : Promise.resolve({ data: [], error: null }),
          countIds.length ? db.from("count_tasks").select("id, status").in("id", countIds) : Promise.resolve({ data: [], error: null }),
        ]);
        setRequests(new Map(((req.data ?? []) as { id: string; status: string }[]).map((r) => [r.id, r.status])));
        setCounts(new Map(((cnt.data ?? []) as { id: string; status: string }[]).map((r) => [r.id, r.status])));
        setRows(log);
      } catch (e) { setError((e as Error).message); }
    })();
  }, []);

  const imports = useMemo(() => {
    const m = new Map<string, LogRow[]>();
    for (const r of rows ?? []) m.set(r.import_id, [...(m.get(r.import_id) ?? []), r]);
    return [...m.values()];
  }, [rows]);

  const isIssue = (r: LogRow) => r.status === "conflict" || !!r.fix_error;

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2"><History className="h-5 w-5" />Riwayat putaway · {DAYS} hari</CardTitle>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />Tampilkan semua baris, bukan hanya konflik
        </label>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        {!rows && !error && <p className="text-sm text-steel-500">Memuat…</p>}
        {rows && imports.length === 0 && <p className="text-sm text-steel-500">Belum ada putaway yang diposting.</p>}
        {imports.map((lines) => {
          const head = lines[0];
          const issues = lines.filter(isIssue);
          const shown = all ? lines : issues;
          const pending = lines.flatMap((l) => l.request_ids).filter((id) => requests.get(id) === "PENDING").length;
          return (
            <details key={head.import_id} className="rounded-md border border-steel-200 bg-white" open={issues.length > 0 && imports[0] === lines}>
              <summary className="cursor-pointer p-3 text-sm">
                <span className="font-semibold">{fmtDateTime(head.posted_at)}</span> · {head.source ?? "file"}{head.by_name && ` · ${head.by_name}`}
                <span className="block text-xs text-steel-500">
                  {fmtNum(lines.length)} baris · {fmtNum(lines.filter((l) => ["posted", "set", "fixed"].includes(l.result)).length)} diposting
                  · {fmtNum(issues.length)} konflik{pending > 0 && <span className="text-warn"> · {fmtNum(pending)} menunggu persetujuan</span>}
                </span>
              </summary>
              {shown.length === 0 ? <p className="px-3 pb-3 text-sm text-steel-500">Tidak ada konflik di upload ini.</p> : (
                <div className="px-3 pb-3">
                  <Table>
                    <thead><tr><Th>Baris</Th><Th>Bin</Th><Th>Sheet</Th><Th>Konflik</Th><Th>Isi bin waktu itu</Th><Th>Keputusan</Th><Th>Hasil</Th></tr></thead>
                    <tbody>{shown.map((r) => (
                      <tr key={r.id} className={cn(isIssue(r) && "bg-warn/10")}>
                        <Td>{r.line}</Td>
                        <Td className="font-semibold">{r.bin_code ?? "–"}{r.sheet_bin && <span className="block text-xs font-normal text-warn">di sheet {r.sheet_bin}</span>}</Td>
                        <Td className="text-xs">{r.sku} · {r.batch_lot || "–"} · {fmtDate(r.expiry_date)} · <b>{fmtNum(r.quantity)}</b></Td>
                        <Td className="text-xs">{r.kind ? KIND_LABELS[r.kind] : r.status === "same" ? "Isi bin sudah sama" : "–"}</Td>
                        <Td className="text-xs">{r.system_before.length
                          ? r.system_before.map((c, i) => <div key={i}>{c.sku} · {c.batch_lot || "–"} · {fmtDate(c.expiry_date)} · <b>{fmtNum(c.quantity)}</b></div>)
                          : "Kosong"}</Td>
                        <Td className="text-xs">
                          {r.action ? ACTION[r.action] : isIssue(r) ? "Dilewati" : "–"}
                          {r.action === "fix" && r.fix && <div className="text-steel-500">{fixSummary({ bin_code: r.bin_code ?? "", sku: r.sku ?? "", quantity: r.quantity }, r.fix, Infinity)}</div>}
                          {r.fix_error && <div className="text-bad">Sheet benar ditolak: {r.fix_error}</div>}
                        </Td>
                        <Td className="text-xs">
                          {RESULT[r.result]}
                          {r.request_ids.map((id) => (
                            <div key={id}><Link className="underline" href="/adjust">Adjustment {requests.get(id) === "PENDING" ? "menunggu persetujuan" : requests.get(id) === "APPROVED" ? "disetujui" : requests.get(id) === "REJECTED" ? "ditolak" : ""}</Link></div>
                          ))}
                          {r.count_task_id && <div><Link className="underline" href="/counts">Hitung stok {counts.get(r.count_task_id) === "OPEN" ? "(terbuka)" : counts.get(r.count_task_id) ? `(${counts.get(r.count_task_id)!.toLowerCase()})` : ""}</Link></div>}
                        </Td>
                      </tr>
                    ))}</tbody>
                  </Table>
                </div>
              )}
            </details>
          );
        })}
      </CardContent>
    </Card>
  );
}
