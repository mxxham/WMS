import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileSpreadsheet, FileText } from "lucide-react";
import { requireCkb } from "@/lib/ckb/auth";
import { createClient } from "@/lib/supabase/server";
import { loadSession } from "@/lib/ckb/stocktake-data";
import { ADJUSTMENT_STATUS, type AdjustmentStatus } from "@/lib/ckb/stocktake";
import { CkbHeader, CkbBody, Notice, StatTile } from "@/components/ckb/ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ekspor sesi" };

/** Session files: the full count sheet, its discrepancies, and the way to SAP for its approved adjustments. */
export default async function SessionExportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireCkb(`/ckb/stock-take/${id}/export`);
  const s = await loadSession(id);
  if (!s) notFound();
  const db = await createClient();
  const { data: adjustments } = await db.from("ckb_adjustments").select("status").eq("stocktake_id", id);
  const by = (st: AdjustmentStatus) => (adjustments ?? []).filter((a) => a.status === st).length;
  const file = (classification: string | null, format: "xlsx" | "pdf") =>
    `/api/ckb/reports?kind=discrepancies&stocktake=${id}${classification ? `&classification=${classification}` : ""}&format=${format}`;
  return (
    <main>
      <CkbHeader title={`Ekspor ${s.ref_no}`} subtitle={`${s.customer_name} · ${s.baseline_ref}`} back={{ href: `/ckb/stock-take/${id}`, label: s.ref_no }} />
      <CkbBody className="max-w-3xl">
        <Card>
          <CardHeader><CardTitle>Lembar hasil hitung</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-steel-500">Semua tugas sesi dengan qty SAP, qty yang diterima, selisih dan keputusan, ditandai snapshot dan tanggalnya.</p>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline"><a href={file("ALL", "xlsx")}><FileSpreadsheet className="h-4 w-4" />Semua tugas (Excel)</a></Button>
              <Button asChild variant="outline"><a href={file("ALL", "pdf")}><FileText className="h-4 w-4" />Semua tugas (PDF)</a></Button>
              <Button asChild variant="outline"><a href={file(null, "xlsx")}><FileSpreadsheet className="h-4 w-4" />Hanya selisih (Excel)</a></Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Penyesuaian ke SAP</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(["PROPOSED", "APPROVED", "EXPORTED", "REJECTED"] as AdjustmentStatus[]).map((st) => <StatTile key={st} label={ADJUSTMENT_STATUS[st].label} value={by(st)} />)}
            </div>
            {by("PROPOSED") > 0 && <Notice tone="warn">{by("PROPOSED")} penyesuaian belum diputuskan. <Link className="underline" href={`/ckb/stock-take/${id}/review`}>Review</Link></Notice>}
            <Button asChild disabled={by("APPROVED") === 0}><Link href={`/ckb/sap/export?customer=${s.customer_id}`}>Buat ekspor SAP ({by("APPROVED")} disetujui)</Link></Button>
          </CardContent>
        </Card>
      </CkbBody>
    </main>
  );
}
