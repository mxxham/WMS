"use client";
import { cn, fmtNum } from "@/lib/utils";
import { diffOf, type ChangeView, type FieldDiff, type Summary } from "@/lib/stockopname";

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmtNum(Math.abs(n))}`;
const tone = (n: number) => (n > 0 ? "text-ok" : n < 0 ? "text-bad" : "text-steel-500");

/** "SKU 550044709 → 550062463 · Qty 48 → 46": only the fields that differ, the old value struck through. */
export function DiffChips({ diffs }: { diffs: FieldDiff[] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-0.5">
      {diffs.map((d) => (
        <span key={d.label} className="whitespace-nowrap">
          <span className="text-steel-500">{d.label} </span>
          <span className="text-steel-500 line-through decoration-bad/70">{d.from}</span>
          <span className="px-1 text-steel-500">→</span>
          <b>{d.to}</b>
        </span>
      ))}
    </span>
  );
}

/**
 * The stock of the aisle before and after the check: totals, how the differences split, each SKU the
 * changes touch, and every changed line with what the system held next to what the shelf showed.
 */
export function ReviewSummary({ summary, changes, aisle, className }: {
  summary: Summary; changes: ChangeView[]; aisle: string; className?: string;
}) {
  const net = summary.after - summary.before;
  const c = summary.counts;
  const kinds = [
    c.qty > 0 && `${fmtNum(c.qty)} jumlah beda`,
    c.identity > 0 && `${fmtNum(c.identity)} batch/expired beda`,
    c.swap > 0 && `${fmtNum(c.swap)} SKU beda`,
    c.found > 0 && `${fmtNum(c.found)} stok ditemukan`,
  ].filter(Boolean) as string[];

  return (
    <div className={cn("space-y-3 text-sm", className)}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label={`Sebelum (sistem, rak ${aisle})`} value={fmtNum(summary.before)} unit="karton" />
        <Tile label="Sesudah cek" value={fmtNum(summary.after)} unit="karton" />
        <Tile label="Selisih bersih" value={signed(net)} unit="karton" valueClass={tone(net)} />
        <Tile label="Baris diubah" value={fmtNum(changes.length)} unit={`di ${fmtNum(summary.bins)} bin`} />
      </div>
      <p className="tabular text-steel-700">
        <span className="font-semibold text-ok">+{fmtNum(summary.plus)}</span> lebih dari sistem ·{" "}
        <span className="font-semibold text-bad">−{fmtNum(summary.minus)}</span> kurang dari sistem
        {kinds.length > 0 && <span className="text-steel-500"> · {kinds.join(" · ")}</span>}
      </p>

      {summary.skus.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-steel-100">
          <table className="w-full min-w-[28rem] text-xs tabular">
            <caption className="bg-steel-100/60 px-2 py-1 text-left font-semibold text-steel-700">Per SKU di rak {aisle}</caption>
            <thead>
              <tr className="border-b border-steel-100 text-steel-500">
                <th className="px-2 py-1 text-left font-medium">SKU</th>
                <th className="px-2 py-1 text-right font-medium">Sebelum</th>
                <th className="px-2 py-1 text-right font-medium">Sesudah</th>
                <th className="px-2 py-1 text-right font-medium">Selisih</th>
              </tr>
            </thead>
            <tbody>
              {summary.skus.map((s) => (
                <tr key={s.sku} className="border-b border-steel-100 last:border-0">
                  <td className="px-2 py-1"><b>{s.sku}</b> <span className="text-steel-700">{s.description}</span></td>
                  <td className="px-2 py-1 text-right">{fmtNum(s.before)}</td>
                  <td className="px-2 py-1 text-right font-semibold">{fmtNum(s.after)}</td>
                  <td className={cn("px-2 py-1 text-right font-semibold", tone(s.diff))}>{s.diff === 0 ? "0" : signed(s.diff)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="overflow-x-auto rounded-md border border-steel-100">
        <table className="w-full min-w-[28rem] text-xs tabular">
          <caption className="bg-steel-100/60 px-2 py-1 text-left font-semibold text-steel-700">Sistem vs fisik, per baris</caption>
          <tbody>
            {changes.map((ch) => {
              const d = ch.to.qty - (ch.from?.qty ?? 0);
              return (
                <tr key={ch.row} className="border-b border-steel-100 align-top last:border-0">
                  <td className="whitespace-nowrap px-2 py-1 font-cond text-sm font-semibold">{ch.bin}</td>
                  <td className="px-2 py-1">
                    <span className="text-steel-500">{ch.add ? "ditemukan, tidak ada di sistem" : ch.fromSku ?? ch.sku}</span>
                    {" "}<DiffChips diffs={diffOf(ch)} />
                  </td>
                  <td className={cn("whitespace-nowrap px-2 py-1 text-right font-semibold", tone(d))}>{d === 0 ? "identitas" : signed(d)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Tile({ label, value, unit, valueClass }: { label: string; value: string; unit: string; valueClass?: string }) {
  return (
    <div className="rounded-md border border-steel-100 bg-paper px-3 py-2">
      <p className="text-xs text-steel-500">{label}</p>
      <p className={cn("font-cond text-2xl font-semibold tabular", valueClass)}>{value} <span className="text-xs font-normal text-steel-500">{unit}</span></p>
    </div>
  );
}
