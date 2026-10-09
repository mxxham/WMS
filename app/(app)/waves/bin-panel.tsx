"use client";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Table, Td, Th } from "@/components/ui/table";
import { movementQuery } from "@/lib/movement-query";
import { cn, fmtDate, fmtDateTime, fmtNum } from "@/lib/utils";
import { pgrstValue } from "@/lib/postgrest";

type Stock = { sku: string; description: string | null; batch_lot: string; expiry_date: string | null; quantity: number };
type OpenRow = { id: string; planned_date: string; wave_no: string; wave_status: string; seq: number; task_type: string; from_bin: string; to_bin: string | null;
  sku: string; batch_lot: string; quantity: number };
type Move = { id: string; type: string; quantity: number; batch_lot: string; created_at: string; note: string | null; by_name: string | null;
  items: { sku: string } | null; from_bin: { bin_code: string } | null; to_bin: { bin_code: string } | null };

const TYPE: Record<string, string> = { picking: "Pick", transfer: "Pindah", putaway: "Putaway", inbound: "Masuk", adjustment: "Adjust" };

/**
 * Tap a bin code on the wave page: what it holds now, every open row of every
 * wave that takes from it or moves into it, and its movements of the last two
 * days — "why is this row stok kurang?" answered without leaving the page.
 */
export function BinButton({ code, children, className }: { code: string; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ stock: Stock[]; rows: OpenRow[]; moves: Move[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setData(null); setError(null);
    const db = createClient();
    const since = new Date(Date.now() - 2 * 86_400_000).toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
    const [{ data: stock, error: e1 }, { data: rows, error: e2 }, q] = await Promise.all([
      db.from("inventory_detail").select("sku, description, batch_lot, expiry_date, quantity").eq("bin_code", code).order("sku"),
      db.from("pick_task_detail").select("id, planned_date, wave_no, wave_status, seq, task_type, from_bin, to_bin, sku, batch_lot, quantity")
        .or(`from_bin.eq.${pgrstValue(code)},to_bin.eq.${pgrstValue(code)}`).eq("status", "PLANNED").in("wave_status", ["PENDING", "RESCHEDULED"])
        .order("planned_date").order("seq").range(0, 499),
      movementQuery(db, { bin: code, from: since }),
    ]);
    if (e1 || e2) return setError((e1 ?? e2)!.message);
    let moves: Move[] = [];
    if (q) {
      const { data: m, error: e3 } = await q(0, 49);
      if (e3) return setError(e3.message);
      moves = (m ?? []) as unknown as Move[];
    }
    setData({ stock: (stock ?? []) as Stock[], rows: (rows ?? []) as OpenRow[], moves });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) void load(); }}>
      <DialogTrigger asChild>
        <button type="button" className={cn("text-left", className)} title={`Lihat isi dan tugas ${code}`}>{children}</button>
      </DialogTrigger>
      <DialogContent title={`Bin ${code}`} className="sm:w-[44rem]">
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        {!data && !error && <p className="text-sm text-steel-500">Memuat…</p>}
        {data && (
          <div className="space-y-5 text-sm">
            <section className="space-y-1">
              <h3 className="font-semibold">Isi sekarang</h3>
              {data.stock.length === 0 ? <p className="text-steel-500">Kosong di sistem.</p> : (
                <Table>
                  <thead><tr><Th>SKU</Th><Th>Batch</Th><Th>Exp</Th><Th className="text-right">Qty</Th></tr></thead>
                  <tbody>{data.stock.map((s, i) => (
                    <tr key={i}><Td title={s.description ?? ""}>{s.sku}</Td><Td>{s.batch_lot || "–"}</Td><Td>{s.expiry_date ? fmtDate(s.expiry_date) : "–"}</Td>
                      <Td className="text-right font-semibold">{fmtNum(Number(s.quantity))}</Td></tr>
                  ))}</tbody>
                </Table>
              )}
            </section>
            <section className="space-y-1">
              <h3 className="font-semibold">Tugas terbuka yang memakai bin ini ({data.rows.length})</h3>
              {data.rows.length === 0 ? <p className="text-steel-500">Tidak ada.</p> : (
                <ul className="space-y-1">
                  {data.rows.map((r) => {
                    const into = r.to_bin === code;
                    return (
                      <li key={r.id} className="flex flex-wrap gap-x-2">
                        <Link href={`/waves?date=${r.planned_date}`} className="font-semibold underline">NO {r.wave_no} #{r.seq}</Link>
                        {r.wave_status === "RESCHEDULED" && <span className="text-warn">(ditunda)</span>}
                        <span>{into ? `Bin To Bin masuk dari ${r.from_bin}` : r.task_type === "PICK" ? "ambil" : `pindah ke ${r.to_bin}`}</span>
                        <span className={cn("font-semibold", into ? "text-ok" : "text-bad")}>{into ? "+" : "−"}{fmtNum(Number(r.quantity))}</span>
                        <span className="text-steel-500">{r.sku} · {r.batch_lot || "–"}{r.planned_date !== data.rows[0].planned_date ? ` · ${fmtDate(r.planned_date)}` : ""}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
            <section className="space-y-1">
              <h3 className="font-semibold">Mutasi 2 hari terakhir</h3>
              {data.moves.length === 0 ? <p className="text-steel-500">Tidak ada.</p> : (
                <ul className="space-y-1">
                  {data.moves.map((m) => {
                    const out = m.from_bin?.bin_code === code && m.type !== "adjustment";
                    const qty = Number(m.quantity);
                    const sign = m.type === "adjustment" ? (qty >= 0 ? "+" : "−") : out ? "−" : "+";
                    return (
                      <li key={m.id} className="flex flex-wrap gap-x-2">
                        <span className="tabular text-steel-500">{fmtDateTime(m.created_at)}</span>
                        <span className="font-semibold">{TYPE[m.type] ?? m.type}</span>
                        <span className={cn("font-semibold", sign === "+" ? "text-ok" : "text-bad")}>{sign}{fmtNum(Math.abs(qty))}</span>
                        <span>{m.items?.sku} · {m.batch_lot || "–"}</span>
                        {m.type === "transfer" && <span>{out ? `ke ${m.to_bin?.bin_code}` : `dari ${m.from_bin?.bin_code}`}</span>}
                        <span className="text-steel-500">{m.by_name ?? ""}{m.note ? ` · ${m.note}` : ""}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
            <p><Link href={`/bin/${code}`} className="underline">Buka halaman bin {code} →</Link></p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
