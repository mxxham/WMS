"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ConfirmButton } from "@/components/app/confirm-button";
import { PersonNameField, usePersonName } from "@/components/app/person-name";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { fmtDate, fmtDateTime, fmtNum } from "@/lib/utils";

export type HeldRow = {
  id: string; source_name: string; bin_code: string; sku: string; description: string; uom: string | null;
  batch_lot: string; expiry_date: string | null; held_qty: number; qty_now: number; last_move: string | null; held_at: string;
};

/**
 * Stock a full import did not zero (0108): the file no longer lists the SKU in the bin, but the
 * app moved it there last. An admin checks the bin, then zeroes it or keeps it.
 */
export function HeldPanel({ rows }: { rows: HeldRow[] }) {
  const router = useRouter();
  const [name, setName] = usePersonName();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const chosen = rows.filter((r) => picked.has(r.id));
  const cartons = chosen.reduce((s, r) => s + Number(r.qty_now), 0);
  if (!rows.length) return null;

  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  async function decide(zero: boolean): Promise<string | null> {
    if (name.trim().length < 2) return "Isi nama Anda dulu.";
    const { error } = await createClient().rpc("resolve_import_holds", { p_ids: chosen.map((r) => r.id), p_zero: zero, p_name: name });
    if (error) return error.message;
    setPicked(new Set());
    router.refresh();
    return null;
  }

  return (
    <Card className="border-warn">
      <CardHeader><CardTitle>Ditahan impor · {fmtNum(rows.length)} baris belum diputuskan</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">File WMS tidak lagi mencatat SKU ini di bin-nya, tetapi gerakan terakhirnya dicatat di sistem
          (pindah, putaway, hitung atau koreksi). Stok <b>tidak dinolkan</b> sampai dicek. Cek bin: kalau barang tidak ada,
          pilih lalu <b>Nolkan</b>; kalau ada, pilih lalu <b>Tetap ada</b> dan betulkan file WMS.</p>
        <Table>
          <thead><tr><Th><span className="sr-only">Pilih</span></Th><Th>Bin</Th><Th>SKU</Th><Th>Batch · Expired</Th><Th className="text-right">Stok sistem</Th><Th>Gerakan terakhir di sistem</Th><Th>Ditahan</Th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <Td><input type="checkbox" aria-label={`Pilih ${r.bin_code} ${r.sku}`} checked={picked.has(r.id)} onChange={() => toggle(r.id)} /></Td>
              <Td className="font-cond text-lg font-semibold">{r.bin_code}</Td>
              <Td><span className="font-semibold">{r.sku}</span><br /><span className="text-xs text-steel-500">{r.description}</span></Td>
              <Td className="text-xs">{r.batch_lot || "–"} · {r.expiry_date ? fmtDate(r.expiry_date) : "–"}</Td>
              <Td className="text-right tabular font-semibold">{fmtNum(Number(r.qty_now))} {r.uom ?? ""}</Td>
              <Td className="text-xs">{r.last_move ?? "–"}</Td>
              <Td className="text-xs text-steel-500">{fmtDateTime(r.held_at)}<br />{r.source_name}</Td>
            </tr>
          ))}</tbody>
        </Table>
        <div className="flex flex-wrap items-end gap-2">
          <PersonNameField value={name} onChange={setName} label="Nama Anda" id="held-name" />
          <ConfirmButton variant="danger" disabled={!chosen.length} title="Nolkan stok yang dipilih?"
            summary={`${fmtNum(chosen.length)} baris (${fmtNum(cartons)} unit) dinolkan dengan penyesuaian "not in file", sama seperti impor. Pilih ini hanya bila barang memang tidak ada di bin.`}
            confirmLabel="Nolkan" onConfirm={() => decide(true)}>
            Nolkan ({fmtNum(chosen.length)})
          </ConfirmButton>
          <ConfirmButton variant="outline" disabled={!chosen.length} title="Stok tetap ada?"
            summary={`${fmtNum(chosen.length)} baris tetap di stok (${fmtNum(cartons)} unit), tanpa mutasi. Impor berikutnya menahannya lagi bila file WMS masih belum mencatatnya.`}
            confirmLabel="Tetap ada" onConfirm={() => decide(false)}>
            Tetap ada ({fmtNum(chosen.length)})
          </ConfirmButton>
        </div>
      </CardContent>
    </Card>
  );
}
