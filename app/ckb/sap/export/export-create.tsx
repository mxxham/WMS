"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Th, Td } from "@/components/ui/table";
import { ConfirmButton } from "@/components/app/confirm-button";
import { callRpc } from "@/components/ckb/rpc-button";
import { fmtNum } from "@/lib/utils";

export type Approved = {
  id: string; ref_no: string; material_code: string; description: string; storage_bin: string; batch: string; uom: string;
  baseline_qty: number; accepted_qty: number; delta: number; decided_by_name: string | null; decided_at: string | null;
  ckb_stocktakes: { ref_no: string } | null;
};

/** Pick approved adjustments and freeze them into one export (ckb_create_sap_export: all or nothing). */
export function ExportCreate({ customerId, customerName, rows }: { customerId: string; customerName: string; rows: Approved[] }) {
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>(rows.map((r) => r.id));
  const chosen = rows.filter((r) => picked.includes(r.id));
  const gain = chosen.reduce((s, r) => s + Math.max(0, Number(r.delta)), 0);
  const loss = chosen.reduce((s, r) => s + Math.max(0, -Number(r.delta)), 0);
  const all = picked.length === rows.length;
  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>Disetujui, belum diekspor ({rows.length})</CardTitle>
        <ConfirmButton disabled={picked.length === 0} title="Buat ekspor SAP"
          summary={`${picked.length} penyesuaian ${customerName} (tambah ${fmtNum(gain, 3)}, kurang ${fmtNum(loss, 3)}) dibekukan dalam satu file dan ditandai sudah diekspor. Stok SAP belum berubah sampai diposting di SAP.`}
          confirmLabel="Buat ekspor"
          onConfirm={async () => {
            const [id, err] = await callRpc<string>("ckb_create_sap_export", { p_customer: customerId, p_adjustments: picked });
            if (err) return err;
            router.push(`/ckb/sap/export/${id}`);
            return null;
          }}>
          Buat ekspor ({picked.length})
        </ConfirmButton>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <thead><tr>
            <Th className="w-8"><input type="checkbox" aria-label="Pilih semua" className="h-4 w-4" checked={all} onChange={() => setPicked(all ? [] : rows.map((r) => r.id))} /></Th>
            <Th>Ref</Th><Th>Sesi</Th><Th>Bin</Th><Th>Material</Th><Th>Batch</Th><Th className="text-right">SAP</Th><Th className="text-right">Fisik</Th><Th className="text-right">Selisih</Th><Th>Disetujui</Th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td><input type="checkbox" aria-label={`Pilih ${r.ref_no}`} className="h-4 w-4" checked={picked.includes(r.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, r.id] : picked.filter((x) => x !== r.id))} /></Td>
                <Td>{r.ref_no}</Td><Td>{r.ckb_stocktakes?.ref_no}</Td><Td className="font-cond font-semibold">{r.storage_bin}</Td>
                <Td>{r.material_code}<span className="block max-w-[14rem] truncate text-xs text-steel-500">{r.description}</span></Td><Td>{r.batch || "–"}</Td>
                <Td className="text-right">{fmtNum(Number(r.baseline_qty), 3)}</Td><Td className="text-right">{fmtNum(Number(r.accepted_qty), 3)}</Td>
                <Td className={`text-right font-medium ${r.delta < 0 ? "text-bad" : "text-ok"}`}>{r.delta > 0 ? "+" : ""}{fmtNum(Number(r.delta), 3)} {r.uom}</Td>
                <Td className="text-xs text-steel-500">{r.decided_by_name}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {picked.length === 0 && <p className="p-3"><Button variant="ghost" size="sm" onClick={() => setPicked(rows.map((r) => r.id))}>Pilih semua</Button></p>}
      </CardContent>
    </Card>
  );
}
