import type { Metadata } from "next";
import { requireCkb } from "@/lib/ckb/auth";
import { createClient } from "@/lib/supabase/server";
import { CkbHeader, CkbBody, EmptyState, Notice, Pill, StatTile } from "@/components/ckb/ui";
import { Table, Th, Td } from "@/components/ui/table";
import { fmtDate, fmtNum } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Bandingkan snapshot" };
const CHANGE = { ADDED: { label: "Baru", tone: "info" }, REMOVED: { label: "Hilang", tone: "bad" }, CHANGED: { label: "Berubah", tone: "warn" }, SAME: { label: "Sama", tone: "neutral" } } as const;

/** Two snapshots of one customer, identity by identity (ckb_compare_snapshots). */
export default async function ComparePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireCkb("/ckb/sap/compare");
  const { a, b, semua } = await searchParams;
  const db = await createClient();
  const { data: heads } = await db.from("ckb_sap_import_summary").select("id, ref_no, snapshot_date, customer_name").in("id", [a ?? "", b ?? ""].filter((x) => /^[0-9a-f-]{36}$/.test(x)));
  const A = heads?.find((h) => h.id === a), B = heads?.find((h) => h.id === b);
  const { data, error } = A && B ? await db.rpc("ckb_compare_snapshots", { p_a: a, p_b: b }) : { data: null, error: null };
  const rows = ((data ?? []) as { identity_key: string; material_code: string; description: string; storage_bin: string; batch: string; expiry_date: string | null; uom: string; qty_a: number | null; qty_b: number | null; delta: number; change: keyof typeof CHANGE }[]);
  const shown = semua ? rows : rows.filter((r) => r.change !== "SAME");
  const n = (c: keyof typeof CHANGE) => rows.filter((r) => r.change === c).length;
  return (
    <main>
      <CkbHeader title="Bandingkan snapshot" subtitle={A && B ? `${A.customer_name}: ${A.ref_no} (${fmtDate(A.snapshot_date)}) → ${B.ref_no} (${fmtDate(B.snapshot_date)})` : undefined}
        back={{ href: b ? `/ckb/sap/import/${b}` : "/ckb/sap/import", label: "Snapshot" }} />
      <CkbBody>
        {!A || !B ? <EmptyState title="Pilih dua snapshot dari halaman snapshot" /> : error ? <Notice tone="bad">{error.message}</Notice> : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatTile label="Berubah" value={n("CHANGED")} tone="warn" /><StatTile label="Baru" value={n("ADDED")} />
              <StatTile label="Hilang" value={n("REMOVED")} tone="bad" /><StatTile label="Sama" value={n("SAME")} />
            </div>
            <p className="text-sm text-steel-500">Dibandingkan per identitas stok (material, plant, SLoc, bin, batch, expiry, satuan). Tidak ada yang dijumlah lintas bin.
              {" "}<a className="text-ckb hover:underline" href={`?a=${a}&b=${b}${semua ? "" : "&semua=1"}`}>{semua ? "Sembunyikan yang sama" : "Tampilkan semua"}</a></p>
            {shown.length === 0 ? <EmptyState title="Tidak ada perbedaan" /> : (
              <div className="rounded-lg border border-steel-100 bg-white">
                <Table sticky>
                  <thead><tr><Th>Perubahan</Th><Th>Material</Th><Th>Bin</Th><Th>Batch</Th><Th>Expired</Th><Th>Satuan</Th><Th className="text-right">{A.ref_no}</Th><Th className="text-right">{B.ref_no}</Th><Th className="text-right">Selisih</Th></tr></thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={r.identity_key}>
                        <Td><Pill tone={CHANGE[r.change].tone}>{CHANGE[r.change].label}</Pill></Td>
                        <Td><span className="font-medium">{r.material_code}</span><span className="block max-w-[14rem] truncate text-xs text-steel-500">{r.description}</span></Td>
                        <Td>{r.storage_bin || "–"}</Td><Td>{r.batch || "–"}</Td><Td>{r.expiry_date ? fmtDate(r.expiry_date) : "–"}</Td><Td>{r.uom}</Td>
                        <Td className="text-right">{r.qty_a === null ? "–" : fmtNum(Number(r.qty_a), 3)}</Td><Td className="text-right">{r.qty_b === null ? "–" : fmtNum(Number(r.qty_b), 3)}</Td>
                        <Td className={`text-right font-medium ${r.delta < 0 ? "text-bad" : r.delta > 0 ? "text-ok" : ""}`}>{r.delta > 0 ? "+" : ""}{fmtNum(Number(r.delta), 3)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </>
        )}
      </CkbBody>
    </main>
  );
}
