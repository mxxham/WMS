import { useCallback, useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { codeRangeText, OWNER_LABEL, STATE_LABEL, type BinState, type Owner } from "@/lib/racks";
import { jakartaTime } from "@/lib/location-changes";
import { saveSheets } from "@/lib/save-xlsx";
import { fmtNum } from "@/lib/utils";

type Row = {
  id: number; change_set: string; bin_code: string; field: "STATE" | "OWNER" | "CREATED" | "REMOVED" | "ATTR";
  old_value: string | null; new_value: string | null; reason: string; changed_by_name: string; changed_at: string;
};
type Group = { set: string; at: string; by: string; reason: string; rows: Row[] };

const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });

const valueText = (field: Row["field"], v: string | null) => {
  if (!v) return "–";
  if (field === "STATE") return STATE_LABEL[v as BinState] ?? v;
  if (field === "OWNER") return OWNER_LABEL[v as Owner] ?? v;
  if (field === "CREATED") { const [s, o] = v.split(" "); return `${STATE_LABEL[s as BinState] ?? s}${o ? `, ${OWNER_LABEL[o as Owner] ?? o}` : ""}`; }
  return v;
};

/** "memblokir 10 bin CF21A01–CF25A02" — one change set as one sentence. */
export function groupSentence(rows: Row[]): string {
  const codes = codeRangeText(rows.map((r) => r.bin_code)).replace(/ \(\d+ bin\)$/, "");
  const n = `${fmtNum(rows.length)} bin ${codes}`;
  const r = rows[0];
  if (r.field === "CREATED") return `merencanakan ${n} (${valueText("CREATED", r.new_value)})`;
  if (r.field === "REMOVED") return `membatalkan rencana ${n}`;
  if (r.field === "ATTR") return `mengubah kelas ABC / kapasitas ${n}`;
  if (r.field === "OWNER") return r.new_value === "CKB" ? `meminjamkan ${n} ke CKB 3PL` : `mengembalikan ${n} ke Shell`;
  const to = r.new_value as BinState;
  if (to === "BLOCKED") return r.old_value === "BLOCKED" ? `mencatat blokir lama ${n}` : `memblokir ${n}`;
  if (to === "NOT_PRESENT") return `menandai ${n} tidak ada`;
  if (r.old_value === "PLANNED") return `mengaktifkan rak baru ${n}`;
  if (r.old_value === "NOT_PRESENT") return `menandai ${n} ada lagi`;
  return `membuka blokir ${n}`;
}

/** Riwayat: every block, lend, plan and change of a rack, grouped as people did them (one change set per action). */
export function History() {
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(today());
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(null); setError(null);
    try {
      const db = createClient();
      const data = await fetchAll<Row>((a, b) => db.from("bin_changes")
        .select("id, change_set, bin_code, field, old_value, new_value, reason, changed_by_name, changed_at")
        .gte("changed_at", `${from}T00:00:00+07:00`).lte("changed_at", `${to}T23:59:59.999+07:00`)
        .order("changed_at", { ascending: false }).order("id").range(a, b) as unknown as PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>);
      setRows(data);
    } catch (e) { setError((e as Error).message); }
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  const groups = useMemo(() => {
    const needle = q.trim().toUpperCase();
    const m = new Map<string, Group>();
    for (const r of rows ?? []) {
      const g = m.get(r.change_set) ?? { set: r.change_set, at: r.changed_at, by: r.changed_by_name, reason: r.reason, rows: [] };
      g.rows.push(r);
      m.set(r.change_set, g);
    }
    return [...m.values()].filter((g) => !needle || g.rows.some((r) => r.bin_code.startsWith(needle)) || g.by.toUpperCase().includes(needle));
  }, [rows, q]);

  function download() {
    saveSheets({
      "Riwayat rak": groups.flatMap((g) => g.rows.map((r) => ({
        "Waktu": jakartaTime(r.changed_at), "Oleh": r.changed_by_name, "Bin": r.bin_code,
        "Perubahan": r.field === "STATE" ? "Status" : r.field === "OWNER" ? "Pemilik" : r.field === "CREATED" ? "Dibuat" : r.field === "REMOVED" ? "Dihapus" : "Kelas / kapasitas",
        "Sebelum": valueText(r.field, r.old_value), "Sesudah": valueText(r.field, r.new_value), "Alasan": r.reason,
      }))),
    }, `Riwayat rak ${from} sd ${to}.xlsx`, "tidak ada perubahan");
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3 rounded-lg bg-white p-3">
        <div><Label htmlFor="h-from">Dari</Label><Input id="h-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-auto" /></div>
        <div><Label htmlFor="h-to">Sampai</Label><Input id="h-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-auto" /></div>
        <div><Label htmlFor="h-q">Bin atau nama</Label><Input id="h-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="CF21 atau nama" className="w-48" /></div>
        <div className="ml-auto"><Button variant="outline" size="sm" onClick={download} disabled={!groups.length}><Download className="h-4 w-4" />Unduh Excel</Button></div>
      </div>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      {!rows && !error && <p className="text-sm text-steel-500">Memuat riwayat…</p>}
      {rows && groups.length === 0 && <p className="rounded-lg bg-white p-6 text-center text-sm text-steel-500">Belum ada perubahan rak di rentang ini.</p>}
      <ol className="space-y-2">
        {groups.map((g) => (
          <li key={g.set} className="rounded-lg bg-white p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p className="text-sm"><span className="font-semibold">{g.by}</span> {groupSentence(g.rows)}</p>
              <time className="text-xs text-steel-500 tabular" dateTime={g.at}>{jakartaTime(g.at)}</time>
            </div>
            <p className="mt-0.5 text-sm text-steel-500">{g.reason}</p>
            {g.rows.length > 1 && (
              <details className="mt-1 text-xs">
                <summary className="cursor-pointer text-ckb">Lihat {fmtNum(g.rows.length)} bin</summary>
                <p className="mt-1 leading-relaxed">{g.rows.map((r) => r.bin_code).sort().join(", ")}</p>
              </details>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
