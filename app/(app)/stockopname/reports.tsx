import { Card } from "@/components/ui/card";
import { REASON_CODES, type ReasonCode } from "@/lib/inventory-control";
import { jakartaDateTime } from "@/lib/trace";
import type { RackCheckReport } from "@/lib/stockopname";
import { cn, fmtNum } from "@/lib/utils";
import { ReviewSummary } from "./review-summary";

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmtNum(Math.abs(n))}`;
const tone = (n: number) => (n > 0 ? "text-ok" : n < 0 ? "text-bad" : "text-steel-500");

/**
 * Laporan: every saved Stock Opname Rak, newest first. A report is written in the same transaction as the
 * save (0145) and cannot be edited or deleted, so this list is the permanent record of what each check found.
 */
export function Reports({ reports, aisle, limit }: { reports: RackCheckReport[]; aisle: string | null; limit: number }) {
  if (reports.length === 0) {
    return (
      <Card>
        <p className="p-4 text-sm text-steel-500">
          Belum ada laporan{aisle ? ` untuk rak ${aisle}` : ""}. Laporan dibuat otomatis setiap kali hasil cek rak disimpan, dan tidak bisa diubah atau dihapus.
        </p>
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      <p className="px-1 text-xs text-steel-500">
        {fmtNum(reports.length)} laporan{reports.length >= limit ? ` terbaru (maksimal ${fmtNum(limit)})` : ""}. Laporan tersimpan tetap dan tidak bisa diubah atau dihapus.
      </p>
      {reports.map((r) => {
        const net = Number(r.aisle_after) - Number(r.aisle_before);
        const page = r.report.summary;
        const detail = page && r.report.changes;
        // Stock moved in the system while the check was typed in (a pick posted, a receipt): worth saying, not an error.
        const drift = page && (page.before !== Number(r.aisle_before) || page.after !== Number(r.aisle_after));
        return (
          <Card key={r.id}>
            <details className="group">
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 marker:hidden [&::-webkit-details-marker]:hidden">
                <span className="font-cond text-xl font-semibold">Rak {r.aisle}</span>
                <span className="text-sm text-steel-700">{jakartaDateTime(r.created_at)}</span>
                <span className="text-sm text-steel-700">{r.by_name}</span>
                <span className="tabular text-sm">
                  {fmtNum(r.aisle_before)} → <b>{fmtNum(r.aisle_after)}</b> karton{" "}
                  <b className={cn(tone(net))}>({net === 0 ? "0" : signed(net)})</b>
                </span>
                <span className="text-xs text-steel-500">
                  {fmtNum(r.lines + r.added)} baris · {REASON_CODES[r.reason_code as ReasonCode] ?? r.reason_code}
                </span>
                {r.warnings.length > 0 && <span className="rounded bg-warn px-1.5 text-xs font-semibold text-ink">{fmtNum(r.warnings.length)} stok kurang untuk wave</span>}
                <span className="ml-auto text-xs text-steel-500 group-open:hidden">Lihat rincian</span>
                <span className="ml-auto hidden text-xs text-steel-500 group-open:inline">Tutup rincian</span>
              </summary>
              <div className="space-y-3 border-t border-steel-100 p-4">
                {detail ? (
                  <ReviewSummary summary={page} changes={r.report.changes!} aisle={r.aisle} />
                ) : (
                  <p className="text-sm text-steel-500">
                    Laporan ini tidak menyimpan rincian per baris. Total di atas diukur database: {fmtNum(r.lines)} baris diperbarui, {fmtNum(r.added)} ditambah, {fmtNum(r.movements)} mutasi.
                  </p>
                )}
                {drift && (
                  <p className="text-xs text-steel-500">
                    Total di database saat disimpan ({fmtNum(r.aisle_before)} → {fmtNum(r.aisle_after)}) beda dengan layar pengecek ({fmtNum(page!.before)} → {fmtNum(page!.after)}):
                    stok rak ini berubah di sistem selama pengecekan (picking, penerimaan atau koreksi lain).
                  </p>
                )}
                {r.warnings.map((w) => (
                  <p key={`${w.bin_code}|${w.sku}`} className="text-sm text-bad">
                    {w.bin_code} · {w.sku}: tinggal {fmtNum(w.qty)}, tapi dipesan {fmtNum(w.reserved)} untuk wave NO {w.waves}.
                  </p>
                ))}
              </div>
            </details>
          </Card>
        );
      })}
    </div>
  );
}
