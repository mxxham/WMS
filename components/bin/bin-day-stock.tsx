"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { binQuery, groupDayRows, type BinDayGroup, type DayRow } from "@/lib/bin-day-stock";
import { cn, fmtNum } from "@/lib/utils";

const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
const N = (n: number) => (n ? fmtNum(n) : "–");

/**
 * The Laporan WMS harian numbers of one bin, or every bin of a rack (prefix), for one day — without the
 * download. Same database calculation as the Excel file (wms_day_report, 0055), so the numbers match it.
 */
export function BinDayStock({ code, showDate = true, linkBins = false }: {
  /** a full bin code, or a prefix such as CB01 */
  code: string; showDate?: boolean;
  /** each bin's name links to its bin page (for rack results) */
  linkBins?: boolean;
}) {
  const [date, setDate] = useState(today());
  const [groups, setGroups] = useState<BinDayGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const q = binQuery(code);

  useEffect(() => {
    if (!q) { setGroups([]); return; }
    let live = true;
    setGroups(null); setError(null);
    let req = createClient().rpc("wms_day_report", { p_date: date })
      .select("bin_code, sku, description, uom, batch_lot, expiry_date, on_hand, pick, b_out, b_in, remain");
    req = q.kind === "exact" ? req.eq("bin_code", q.code) : req.like("bin_code", `${q.code}%`);
    req.order("bin_code").range(0, 1999).then(({ data, error }) => {
      if (!live) return;
      if (error) { setError(error.message); setGroups([]); return; }
      setGroups(groupDayRows((data ?? []) as DayRow[]));
    });
    return () => { live = false; };
  }, [q?.kind, q?.code, date]); // eslint-disable-line react-hooks/exhaustive-deps

  const isToday = date === today();
  return (
    <section aria-label="On hand dan remain" className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-cond text-lg font-semibold leading-tight">On hand &amp; remain</h2>
          <p className="text-xs text-steel-500">
            {isToday ? "Hari ini" : date}: on hand pagi (setelah putaway, sebelum picking) sampai remain {isToday ? "sekarang" : "akhir hari"}.
            Sama dengan Laporan WMS harian.
          </p>
        </div>
        {showDate && <Input type="date" aria-label="Tanggal" value={date} max={today()} onChange={(e) => e.target.value && setDate(e.target.value)} className="w-auto" />}
      </div>

      {error && <p role="alert" className="text-sm text-bad">On hand tidak bisa dibaca: {error}</p>}
      {groups === null && <p className="text-sm text-steel-500">Menghitung…</p>}
      {groups && !error && groups.length === 0 && (
        <p className="rounded-md border border-dashed border-steel-300 p-3 text-sm text-steel-500">
          {q ? `Tidak ada stok di ${q.code}${q.kind === "prefix" ? "…" : ""} pada tanggal ini.` : "Ketik kode bin (CB01A01) atau rak (CB01)."}
        </p>
      )}

      {groups?.map((g) => (
        <div key={g.bin} className="overflow-hidden rounded-lg border border-steel-100 bg-white">
          {(groups.length > 1 || linkBins) && (
            <div className="flex items-baseline justify-between bg-steel-100/60 px-3 py-1.5">
              {linkBins
                ? <Link href={`/bin/${encodeURIComponent(g.bin)}`} className="rounded-plate bg-plate px-1.5 font-cond text-sm font-bold">{g.bin}</Link>
                : <span className="rounded-plate bg-plate px-1.5 font-cond text-sm font-bold">{g.bin}</span>}
              <span className="text-xs text-steel-500 tabular">on hand {fmtNum(g.total.on_hand)} · remain {fmtNum(g.total.remain)}</span>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular">
              <thead className="text-xs text-steel-500">
                <tr className="[&>th]:px-3 [&>th]:py-1.5 [&>th]:text-left [&>th]:font-normal">
                  <th>SKU · batch · exp</th><th className="!text-right">On hand</th><th className="!text-right">Pick</th>
                  <th className="!text-right">B out</th><th className="!text-right">B in</th><th className="!text-right">Remain</th>
                </tr>
              </thead>
              <tbody>
                {g.lines.map((l, i) => (
                  <tr key={i} className="border-t border-steel-100 [&>td]:px-3 [&>td]:py-1.5">
                    <td><span className="font-semibold">{l.sku}</span>
                      <span className="block text-xs text-steel-500">{l.batch_lot || "tanpa batch"} · {l.expiry_date ?? "–"}</span></td>
                    <td className="text-right font-semibold">{N(l.on_hand)}</td>
                    <td className="text-right">{N(l.pick)}</td><td className="text-right">{N(l.b_out)}</td><td className="text-right">{N(l.b_in)}</td>
                    <td className={cn("text-right font-semibold", l.remain !== l.on_hand && "text-ckb")}>{N(l.remain)}</td>
                  </tr>
                ))}
                {g.lines.length > 1 && (
                  <tr className="border-t-2 border-steel-100 font-semibold [&>td]:px-3 [&>td]:py-1.5">
                    <td>Total</td><td className="text-right">{fmtNum(g.total.on_hand)}</td><td className="text-right">{N(g.total.pick)}</td>
                    <td className="text-right">{N(g.total.b_out)}</td><td className="text-right">{N(g.total.b_in)}</td><td className="text-right">{fmtNum(g.total.remain)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </section>
  );
}

/** Inventory Stok: type a bin or a rack and see its on hand right here. */
export function BinOnHandLookup() {
  const [text, setText] = useState("");
  const [code, setCode] = useState("");
  return (
    <div className="space-y-3 rounded-lg bg-white p-3">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setCode(text); }}>
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Cek on hand bin: CB01A01 atau rak CB01"
          aria-label="Kode bin atau rak" autoCapitalize="characters" className="max-w-xs" />
        <button type="submit" className="rounded-md bg-ckb px-4 text-sm font-semibold text-white hover:bg-ckb-dark">Cek</button>
        {code && <button type="button" className="text-sm text-steel-500 underline" onClick={() => { setCode(""); setText(""); }}>Tutup</button>}
      </form>
      {code && <BinDayStock code={code} linkBins />}
    </div>
  );
}
