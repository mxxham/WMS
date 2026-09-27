import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { quantityAccuracy, REASON_CODES, type ReasonCode } from "@/lib/inventory-control";
import { cn, fmtDate, fmtDateTime, fmtNum } from "@/lib/utils";

export type AccuracyRow = {
  id: string; bin_code: string; abc_class: string; closed_at: string; system_qty: number | null; variance_qty: number | null;
  first_variance_qty: number | null; rounds: number; reason_code: string | null; tolerance: number;
};
export type AdjustmentRow = {
  created_at: string; quantity: number; reason_code: string | null; note: string | null; by_name: string | null; approved_by_name: string | null;
  items: { sku: string; description: string } | null;
};

const DAY = 86_400_000;
const pct = (v: number | null) => (v === null ? "–" : `${v.toFixed(1)}%`);
const hitRate = (rows: AccuracyRow[]) => rows.length ? (rows.filter((r) => Number(r.variance_qty ?? 0) <= Number(r.tolerance)).length / rows.length) * 100 : null;
const firstRate = (rows: AccuracyRow[]) => {
  const k = rows.filter((r) => r.first_variance_qty !== null);
  return k.length ? (k.filter((r) => Number(r.first_variance_qty) <= Number(r.tolerance)).length / k.length) * 100 : null;
};

/** Inventory Record Accuracy from applied counts, and where stock was adjusted and why. */
export function AccuracyTab({ counts, adjustments, target, recons }: {
  counts: AccuracyRow[]; adjustments: AdjustmentRow[]; target: number;
  recons: { id: string; as_of: string; accuracy_pct: number | null; skus: number; skus_match: number }[];
}) {
  const now = Date.now();
  const last30 = counts.filter((c) => now - Date.parse(c.closed_at) <= 30 * DAY);
  const adj30 = adjustments.filter((a) => now - Date.parse(a.created_at) <= 30 * DAY);
  const q30 = quantityAccuracy(last30), q90 = quantityAccuracy(counts);

  const byClass = ["A", "B", "C"].map((k) => {
    const rows = counts.filter((c) => c.abc_class === k);
    return { k, n: rows.length, hit: hitRate(rows), qty: quantityAccuracy(rows), first: firstRate(rows), tol: rows[0]?.tolerance ?? 0 };
  });

  // Last 12 weeks, oldest first (week = 7 days back from today).
  const weeks = Array.from({ length: 12 }, (_, i) => {
    const end = now - (11 - i) * 7 * DAY, start = end - 7 * DAY;
    const rows = counts.filter((c) => { const t = Date.parse(c.closed_at); return t > start && t <= end; });
    return { label: fmtDate(new Date(start + DAY)), n: rows.length, hit: hitRate(rows), qty: quantityAccuracy(rows) };
  });

  const reasons = new Map<string, { n: number; plus: number; minus: number }>();
  for (const a of adjustments) {
    const k = a.reason_code ?? "–";
    const r = reasons.get(k) ?? { n: 0, plus: 0, minus: 0 };
    r.n++; if (Number(a.quantity) > 0) r.plus += Number(a.quantity); else r.minus += Number(a.quantity);
    reasons.set(k, r);
  }
  const bySku = new Map<string, { sku: string; description: string; abs: number; net: number; n: number }>();
  for (const a of adjustments) {
    if (a.reason_code === "OPENING" || a.reason_code === "DATA_ENTRY") continue;  // imports and label fixes are not stock lost or found
    const k = a.items?.sku ?? "?";
    const r = bySku.get(k) ?? { sku: k, description: a.items?.description ?? "", abs: 0, net: 0, n: 0 };
    r.abs += Math.abs(Number(a.quantity)); r.net += Number(a.quantity); r.n++;
    bySku.set(k, r);
  }
  const topSku = [...bySku.values()].sort((a, b) => b.abs - a.abs).slice(0, 10);
  const big = [...adjustments].filter((a) => a.approved_by_name && a.reason_code !== "OPENING").reverse().slice(0, 15);

  const tiles: [string, string, string, boolean?][] = [
    ["Akurasi qty · 30 hari", pct(q30), `target ≥ ${target}% · ${fmtNum(last30.length)} hitungan`, q30 !== null && q30 < target],
    ["Akurasi qty · 90 hari", pct(q90), `${fmtNum(counts.length)} hitungan`, q90 !== null && q90 < target],
    ["Bin tepat · 30 hari", pct(hitRate(last30)), "selisih dalam toleransi kelas", (hitRate(last30) ?? 100) < target],
    ["Hitungan pertama tepat · 30 hari", pct(firstRate(last30)), "ketelitian penghitung"],
    ["Adjustment · 30 hari", fmtNum(adj30.filter((a) => a.reason_code !== "OPENING").length), `${fmtNum(adj30.reduce((s, a) => s + (a.reason_code === "OPENING" ? 0 : Math.abs(Number(a.quantity))), 0))} unit (nilai mutlak)`],
    ["Rekonsiliasi SAP terakhir", recons[0]?.accuracy_pct != null ? `${Number(recons[0].accuracy_pct).toFixed(1)}%` : "–", recons[0] ? `${fmtNum(recons[0].skus_match)} dari ${fmtNum(recons[0].skus)} SKU cocok · ${fmtDate(recons[0].as_of)}` : "belum ada"],
  ];

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {tiles.map(([label, value, note, bad]) => (
          <div key={label} className={cn("rounded-lg bg-white p-3", bad && "border-l-4 border-warn")}>
            <div className="text-xs text-steel-500">{label}</div>
            <div className="font-cond text-3xl font-semibold tabular">{value}</div>
            <div className="text-xs text-steel-500">{note}</div>
          </div>
        ))}
      </div>
      <p className="max-w-4xl text-xs text-steel-500">Akurasi qty = 1 − (jumlah selisih terkonfirmasi ÷ stok tercatat saat dihitung), dari cycle count yang sudah diterapkan. Bin tepat = bin yang selisihnya dalam toleransi kelasnya. Hitungan pertama tepat = hitungan pertama sudah sama dengan catatan (sebelum hitung ulang).</p>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Per kelas ABC · 90 hari</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <thead><tr><Th>Kelas</Th><Th className="text-right">Hitungan</Th><Th className="text-right">Akurasi qty</Th><Th className="text-right">Bin tepat</Th><Th className="text-right">Hitungan 1 tepat</Th><Th className="text-right">Toleransi</Th></tr></thead>
              <tbody>{byClass.map((c) => (
                <tr key={c.k}><Td className="font-semibold">{c.k}</Td><Td className="text-right tabular">{fmtNum(c.n)}</Td>
                  <Td className={cn("text-right tabular", c.qty !== null && c.qty < target && "text-bad")}>{pct(c.qty)}</Td>
                  <Td className="text-right tabular">{pct(c.hit)}</Td><Td className="text-right tabular">{pct(c.first)}</Td><Td className="text-right tabular">±{fmtNum(Number(c.tol))}</Td></tr>
              ))}</tbody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Tren mingguan · 12 minggu</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <thead><tr><Th>Minggu mulai</Th><Th className="text-right">Hitungan</Th><Th className="text-right">Akurasi qty</Th><Th>Bin tepat</Th></tr></thead>
              <tbody>{weeks.map((w) => (
                <tr key={w.label}><Td className="text-xs">{w.label}</Td><Td className="text-right tabular">{fmtNum(w.n)}</Td>
                  <Td className={cn("text-right tabular", w.qty !== null && w.qty < target && "text-bad")}>{pct(w.qty)}</Td>
                  <Td>{w.hit === null ? <span className="text-xs text-steel-500">–</span> : (
                    <div className="flex items-center gap-2"><div className="h-2 w-24 rounded bg-steel-100"><div className={cn("h-2 rounded", w.hit >= target ? "bg-ok" : "bg-warn")} style={{ width: `${w.hit}%` }} /></div><span className="text-xs tabular">{pct(w.hit)}</span></div>
                  )}</Td></tr>
              ))}</tbody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Adjustment per alasan · 90 hari</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <thead><tr><Th>Alasan</Th><Th className="text-right">Baris</Th><Th className="text-right">Tambah</Th><Th className="text-right">Kurang</Th><Th className="text-right">Bersih</Th></tr></thead>
              <tbody>{[...reasons.entries()].sort((a, b) => (b[1].plus - b[1].minus) - (a[1].plus - a[1].minus)).map(([k, r]) => (
                <tr key={k}><Td>{REASON_CODES[k as ReasonCode] ?? "Tanpa kode (sebelum aturan baru)"}</Td><Td className="text-right tabular">{fmtNum(r.n)}</Td>
                  <Td className="text-right tabular text-ok">{r.plus ? `+${fmtNum(r.plus)}` : "–"}</Td><Td className="text-right tabular text-bad">{r.minus ? fmtNum(r.minus) : "–"}</Td>
                  <Td className="text-right font-semibold tabular">{fmtNum(r.plus + r.minus)}</Td></tr>
              ))}</tbody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>SKU paling sering disesuaikan · 90 hari</CardTitle></CardHeader>
          <CardContent>
            {topSku.length === 0 ? <p className="text-sm text-steel-500">Belum ada adjustment selain impor dan koreksi label.</p> : (
              <Table>
                <thead><tr><Th>SKU</Th><Th className="text-right">Baris</Th><Th className="text-right">Total selisih</Th><Th className="text-right">Bersih</Th></tr></thead>
                <tbody>{topSku.map((r) => (
                  <tr key={r.sku}><Td className="font-semibold">{r.sku}<div className="text-xs font-normal">{r.description}</div></Td><Td className="text-right tabular">{fmtNum(r.n)}</Td>
                    <Td className="text-right tabular">{fmtNum(r.abs)}</Td><Td className={cn("text-right font-semibold tabular", r.net < 0 ? "text-bad" : r.net > 0 && "text-ok")}>{fmtNum(r.net)}</Td></tr>
                ))}</tbody>
              </Table>
            )}
            <p className="mt-2 text-xs text-steel-500">Tanpa impor saldo awal dan koreksi batch/expired (tidak mengubah jumlah). SKU yang sering muncul: periksa proses picking / putaway-nya.</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Adjustment dengan persetujuan (terbaru)</CardTitle></CardHeader>
        <CardContent>
          {big.length === 0 ? <p className="text-sm text-steel-500">Belum ada.</p> : (
            <Table>
              <thead><tr><Th>Waktu</Th><Th>SKU</Th><Th className="text-right">Qty</Th><Th>Alasan</Th><Th>Petugas → penyetuju</Th></tr></thead>
              <tbody>{big.map((a, i) => (
                <tr key={i}><Td className="whitespace-nowrap text-xs">{fmtDateTime(a.created_at)}</Td><Td>{a.items?.sku}</Td>
                  <Td className="text-right tabular">{Number(a.quantity) > 0 ? "+" : ""}{fmtNum(Number(a.quantity))}</Td>
                  <Td className="text-xs">{REASON_CODES[a.reason_code as ReasonCode] ?? a.reason_code} · {a.note}</Td>
                  <Td className="text-xs">{a.by_name} → {a.approved_by_name}</Td></tr>
              ))}</tbody>
            </Table>
          )}
          <p className="mt-2 text-xs"><Link className="underline" href="/movements?type=adjustment">Semua adjustment di Riwayat mutasi →</Link></p>
        </CardContent>
      </Card>
    </div>
  );
}
