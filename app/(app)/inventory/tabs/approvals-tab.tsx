"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PersonNameField, usePersonName } from "@/components/app/person-name";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { REASON_CODES, type ReasonCode } from "@/lib/inventory-control";
import { cn, fmtDate, fmtDateTime, fmtNum } from "@/lib/utils";

export type RequestRow = {
  id: string; bin_code: string; sku: string; description: string; uom: string | null; batch_lot: string; expiry_date: string | null;
  quantity: number; reason_code: ReasonCode; note: string; status: "PENDING" | "APPROVED" | "REJECTED";
  requested_by_name: string; requested_at: string; decided_by_name: string | null; decided_at: string | null; decision_note: string | null;
  current_qty: number | null;
};

/** Adjustments above the limit: one person asks, a different person approves or rejects. */
export function ApprovalsTab({ open, done, limit }: { open: RequestRow[]; done: RequestRow[]; limit: number }) {
  const [person, setPerson] = usePersonName();
  return (
    <div className="space-y-6 p-4 lg:p-8">
      <p className="max-w-3xl text-sm text-steel-500">Adjustment lebih dari {fmtNum(limit)} unit tidak langsung mengubah stok: diajukan dari halaman bin / Adjust stok, lalu diputuskan di sini oleh orang lain dari yang mengajukan. Selisih hitung yang besar disetujui lewat hitung ulang di Cycle count.</p>
      <PersonNameField className="max-w-xs" value={person} onChange={setPerson} label="Nama penyetuju" />
      <Card>
        <CardHeader><CardTitle>Menunggu keputusan · {fmtNum(open.length)}</CardTitle></CardHeader>
        <CardContent>
          {open.length === 0 ? <p className="text-sm text-steel-500">Tidak ada permintaan.</p> : (
            <Table>
              <thead><tr><Th>Diajukan</Th><Th>Bin</Th><Th>SKU · batch</Th><Th className="text-right">Stok sekarang</Th><Th className="text-right">Adjustment</Th><Th>Alasan</Th><Th>Keputusan</Th></tr></thead>
              <tbody>{open.map((r) => <RequestLine key={r.id} r={r} person={person} />)}</tbody>
            </Table>
          )}
        </CardContent>
      </Card>
      {done.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Sudah diputuskan (30 terakhir)</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <thead><tr><Th>Diputuskan</Th><Th>Bin</Th><Th>SKU</Th><Th className="text-right">Qty</Th><Th>Alasan</Th><Th>Hasil</Th></tr></thead>
              <tbody>{done.map((r) => (
                <tr key={r.id}>
                  <Td className="whitespace-nowrap text-xs">{fmtDateTime(r.decided_at)}</Td><Td>{r.bin_code}</Td><Td>{r.sku} · {r.batch_lot || "–"}</Td>
                  <Td className="text-right tabular">{r.quantity > 0 ? "+" : ""}{fmtNum(Number(r.quantity))}</Td>
                  <Td className="text-xs">{REASON_CODES[r.reason_code]} · {r.note}</Td>
                  <Td className={cn("text-xs font-semibold", r.status === "APPROVED" ? "text-ok" : "text-bad")}>
                    {r.status === "APPROVED" ? "Disetujui" : "Ditolak"} oleh {r.decided_by_name} (diajukan {r.requested_by_name}){r.decision_note && <div className="font-normal">{r.decision_note}</div>}</Td>
                </tr>
              ))}</tbody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function RequestLine({ r, person }: { r: RequestRow; person: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const self = person.trim().toLowerCase() === r.requested_by_name.trim().toLowerCase();
  async function decide(approve: boolean) {
    setBusy(true); setError(null);
    const { error } = await createClient().rpc("decide_adjustment", { p_id: r.id, p_approve: approve, p_note: note || null, p_by_name: person });
    setBusy(false);
    if (error) return setError(error.message);
    router.refresh();
  }
  const after = r.current_qty === null ? null : Number(r.current_qty) + Number(r.quantity);
  return (
    <tr>
      <Td className="whitespace-nowrap text-xs">{fmtDateTime(r.requested_at)}<div>{r.requested_by_name}</div></Td>
      <Td><Link className="font-semibold underline" href={`/bin/${encodeURIComponent(r.bin_code)}`}>{r.bin_code}</Link></Td>
      <Td>{r.sku}<div className="text-xs">{r.description} · {r.batch_lot || "–"} · exp {fmtDate(r.expiry_date)}</div></Td>
      <Td className="text-right tabular">{r.current_qty === null ? "–" : fmtNum(Number(r.current_qty))}</Td>
      <Td className={cn("text-right font-semibold tabular", r.quantity < 0 ? "text-bad" : "text-ok")}>{r.quantity > 0 ? "+" : ""}{fmtNum(Number(r.quantity))}
        {after !== null && <div className={cn("text-xs font-normal", after < 0 && "text-bad")}>→ {fmtNum(after)}</div>}</Td>
      <Td className="text-xs"><b>{REASON_CODES[r.reason_code]}</b><div>{r.note}</div></Td>
      <Td className="min-w-72">
        <Input aria-label="Catatan keputusan" className="h-8" value={note} onChange={(e) => setNote(e.target.value)} placeholder="catatan (wajib jika ditolak)" />
        <div className="mt-1 flex gap-1">
          <Button size="sm" onClick={() => decide(true)} disabled={busy || self || person.trim().length < 2}>Setujui</Button>
          <Button size="sm" variant="outline" onClick={() => decide(false)} disabled={busy || self || !note.trim() || person.trim().length < 2}>Tolak</Button>
        </div>
        {self && <p className="mt-1 text-xs text-bad">Anda yang mengajukan: harus diputuskan orang lain.</p>}
        {error && <p role="alert" className="mt-1 text-xs text-bad">{error}</p>}
      </Td>
    </tr>
  );
}
