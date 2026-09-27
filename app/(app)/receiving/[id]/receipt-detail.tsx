"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ConfirmButton } from "@/components/app/confirm-button";
import { ItemScanInput } from "@/components/app/item-scan-input";
import { PersonNameField, usePersonName } from "@/components/app/person-name";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { expectedExpiry, expiryCheck, MISMATCH_LABEL } from "@/lib/batch-code";
import { RECEIPT_RESULT, RECEIPT_STATUS } from "@/lib/inventory-control";
import { cn, fmtDate, fmtDateTime, fmtNum } from "@/lib/utils";
import type { ReceiptSummary } from "../receiving-list";

export type Actual = {
  line_no: number; batch_lot: string; expiry_date: string; expiry_confirmed: boolean; quantity: number; damaged_qty: number;
  items: { sku: string; description: string; uom: string | null } | null; bins: { bin_code: string } | null;
};
export type Compare = {
  sku: string; description: string; uom: string | null; batch_lot: string; received_batches: string | null;
  expected: number; good: number; damaged: number; diff: number; result: keyof typeof RECEIPT_RESULT;
};
type Pallet = { sku: string; batch_lot: string; expiry_date: string; quantity: string; damaged_qty: string; to_bin_code: string; expiryOk: boolean };
const emptyPallet = (): Pallet => ({ sku: "", batch_lot: "", expiry_date: "", quantity: "", damaged_qty: "", to_bin_code: "", expiryOk: false });

export function ReceiptDetail({ receipt: r, actuals, compare, supervisor, shelfLife, defaultShelfLife }: {
  receipt: ReceiptSummary; actuals: Actual[]; compare: Compare[]; supervisor: boolean; shelfLife: Record<string, number>; defaultShelfLife: number;
}) {
  const [checking, setChecking] = useState(r.status === "OPEN");
  const editable = r.status === "OPEN" || r.status === "CHECKED";
  return (
    <div className="space-y-6 p-4 lg:p-8">
      <Link className="text-sm underline" href="/receiving">← Semua penerimaan</Link>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {([["Status", RECEIPT_STATUS[r.status]], ["Tanggal dokumen", fmtDate(r.doc_date)], ["Kendaraan", r.vehicle ?? "–"],
          ["Oleh", [r.created_by_name, r.checked_by_name, r.posted_by_name].filter(Boolean).join(" → ")]] as const).map(([l, v]) => (
          <div key={l} className="rounded-lg bg-white p-3"><div className="text-xs text-steel-500">{l}</div><div className="font-semibold">{v}</div></div>
        ))}
      </div>
      {r.note && <p className="text-sm">Catatan: {r.note}</p>}

      {editable && checking && <DockCheck receipt={r} shelfLife={shelfLife} defaultShelfLife={defaultShelfLife} onDone={() => setChecking(false)} />}
      {editable && !checking && <Button variant="outline" onClick={() => setChecking(true)}>Periksa ulang seluruh truk</Button>}

      {r.status !== "OPEN" && (
        <>
          {(supervisor || r.status === "POSTED") && (
            <Card>
              <CardHeader><CardTitle>Dokumen vs fisik</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <thead><tr><Th>SKU</Th><Th>Batch dokumen</Th><Th>Batch diterima</Th><Th className="text-right">Dokumen</Th><Th className="text-right">Baik</Th><Th className="text-right">Rusak</Th><Th className="text-right">Selisih</Th><Th>Hasil</Th></tr></thead>
                  <tbody>{compare.map((c, i) => (
                    <tr key={i} className={cn(c.result !== "OK" && "bg-warn/10")}>
                      <Td className="font-semibold">{c.sku}<div className="text-xs font-normal">{c.description}</div></Td>
                      <Td>{c.batch_lot || <span className="text-xs text-steel-500">tidak disebut</span>}</Td><Td className="text-xs">{c.received_batches ?? "–"}</Td>
                      <Td className="text-right tabular">{fmtNum(Number(c.expected))}</Td><Td className="text-right tabular">{fmtNum(Number(c.good))}</Td>
                      <Td className="text-right tabular">{Number(c.damaged) ? fmtNum(Number(c.damaged)) : "–"}</Td>
                      <Td className={cn("text-right font-semibold tabular", Number(c.diff) < 0 ? "text-bad" : Number(c.diff) > 0 && "text-warn")}>{Number(c.diff) === 0 ? "–" : (Number(c.diff) > 0 ? "+" : "") + fmtNum(Number(c.diff))}</Td>
                      <Td className={cn("text-xs font-semibold", c.result === "OK" ? "text-ok" : "text-warn")}>{RECEIPT_RESULT[c.result]}</Td>
                    </tr>
                  ))}</tbody>
                </Table>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader><CardTitle>Palet yang diperiksa · {fmtNum(actuals.length)}{r.checked_by_name && ` · oleh ${r.checked_by_name} ${fmtDateTime(r.checked_at)}`}</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <thead><tr><Th>#</Th><Th>SKU</Th><Th>Batch</Th><Th>Expired</Th><Th className="text-right">Baik</Th><Th className="text-right">Rusak</Th><Th>Bin</Th></tr></thead>
                <tbody>{actuals.map((a) => (
                  <tr key={a.line_no}>
                    <Td>{a.line_no}</Td><Td>{a.items?.sku}<div className="text-xs">{a.items?.description}</div></Td><Td>{a.batch_lot}</Td>
                    <Td className="whitespace-nowrap">{fmtDate(a.expiry_date)}{a.expiry_confirmed && <div className="text-xs text-warn">beda dari kode batch, sesuai label</div>}</Td>
                    <Td className="text-right tabular">{fmtNum(Number(a.quantity))}</Td><Td className="text-right tabular">{Number(a.damaged_qty) ? fmtNum(Number(a.damaged_qty)) : "–"}</Td>
                    <Td>{a.bins ? <Link className="underline" href={`/bin/${encodeURIComponent(a.bins.bin_code)}`}>{a.bins.bin_code}</Link> : "–"}{Number(a.damaged_qty) > 0 && <div className="text-xs">rusak → karantina</div>}</Td>
                  </tr>
                ))}</tbody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      {r.status === "CHECKED" && supervisor && <PostReceipt receipt={r} issues={compare.filter((c) => c.result !== "OK").length} />}
      {r.status === "POSTED" && <p className="rounded-md bg-ok/10 p-3 text-sm">Diposting {fmtDateTime(r.posted_at)} oleh {r.posted_by_name}. Stok masuk ke bin masing-masing; lihat <Link className="underline" href="/movements">Riwayat mutasi</Link>.</p>}
      {r.status === "CANCELLED" && <p className="rounded-md bg-bad/10 p-3 text-sm">Dibatalkan.</p>}
      {editable && supervisor && <CancelReceipt receipt={r} />}
    </div>
  );
}

function DockCheck({ receipt: r, shelfLife, defaultShelfLife, onDone }: { receipt: ReceiptSummary; shelfLife: Record<string, number>; defaultShelfLife: number; onDone: () => void }) {
  const router = useRouter();
  const [person, setPerson] = usePersonName();
  const [pallets, setPallets] = useState<Pallet[]>([emptyPallet()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (i: number, patch: Partial<Pallet>) => setPallets((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const months = (sku: string) => shelfLife[sku.trim()] ?? defaultShelfLife;

  async function save() {
    setError(null);
    const filled = pallets.filter((p) => p.sku.trim());
    if (filled.length === 0) return setError("Catat minimal satu palet.");
    setBusy(true);
    const { error } = await createClient().rpc("record_receipt", {
      p_receipt_id: r.id, p_by_name: person,
      p_lines: filled.map((p) => ({ sku: p.sku.trim(), batch_lot: p.batch_lot.trim(), expiry_date: p.expiry_date || null, quantity: Number(p.quantity || 0),
        damaged_qty: Number(p.damaged_qty || 0), to_bin_code: p.to_bin_code.trim().toUpperCase(), expiry_confirmed: p.expiryOk })),
    });
    setBusy(false);
    if (error) return setError(error.message);
    onDone(); router.refresh();
  }

  return (
    <Card>
      <CardHeader><CardTitle>Periksa di dock</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">Catat per palet apa yang benar-benar ada: scan barcode karton, batch dari label, jumlah baik dan rusak, dan bin tujuan palet. Jumlah di dokumen sengaja tidak ditampilkan.</p>
        {pallets.map((p, i) => {
          const m = expiryCheck(p.batch_lot, p.expiry_date, months(p.sku));
          return (
            <div key={i} className="space-y-1 rounded-md bg-paper p-2">
              <div className="text-xs font-semibold">Palet {i + 1}</div>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-[1.4fr_1fr_10rem_6rem_6rem_8rem_2.5rem]">
                <ItemScanInput value={p.sku} onChange={(v) => set(i, { sku: v })} />
                <Input aria-label="Batch" className="uppercase" value={p.batch_lot} placeholder="Batch"
                  onChange={(e) => { const b = e.target.value; const exp = expectedExpiry(b, months(p.sku)); set(i, { batch_lot: b, ...(exp ? { expiry_date: exp } : {}), expiryOk: false }); }} />
                <Input aria-label="Expired" type="date" value={p.expiry_date} onChange={(e) => set(i, { expiry_date: e.target.value, expiryOk: false })} />
                <Input aria-label="Qty baik" inputMode="numeric" value={p.quantity} onChange={(e) => set(i, { quantity: e.target.value.replace(/[^\d.]/g, "") })} placeholder="Baik" />
                <Input aria-label="Qty rusak" inputMode="numeric" value={p.damaged_qty} onChange={(e) => set(i, { damaged_qty: e.target.value.replace(/[^\d.]/g, "") })} placeholder="Rusak" />
                <Input aria-label="Bin tujuan" className="uppercase" value={p.to_bin_code} onChange={(e) => set(i, { to_bin_code: e.target.value })} placeholder="Bin" />
                <Button size="icon" variant="ghost" aria-label="Hapus palet" disabled={pallets.length === 1} onClick={() => setPallets((ps) => ps.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
              </div>
              {m && (
                <p className="text-xs text-warn">Batch {p.batch_lot.toUpperCase()} → expired seharusnya {fmtDate(m.expected)} ({MISMATCH_LABEL[m.kind]}).{" "}
                  <button type="button" className="underline" onClick={() => set(i, { expiry_date: m.expected })}>Pakai</button>{" · "}
                  <label className="inline-flex items-center gap-1"><input type="checkbox" checked={p.expiryOk} onChange={(e) => set(i, { expiryOk: e.target.checked })} />label memang begitu</label></p>
              )}
            </div>
          );
        })}
        <div className="flex flex-wrap items-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setPallets([...pallets, { ...emptyPallet(), sku: pallets[pallets.length - 1]?.sku ?? "", batch_lot: pallets[pallets.length - 1]?.batch_lot ?? "", expiry_date: pallets[pallets.length - 1]?.expiry_date ?? "" }])}><Plus className="h-4 w-4" />Palet berikutnya</Button>
          <PersonNameField id="checker" value={person} onChange={setPerson} label="Nama pemeriksa" />
          <Button onClick={save} disabled={busy || person.trim().length < 2}>{busy ? "Menyimpan…" : "Simpan hasil periksa"}</Button>
        </div>
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      </CardContent>
    </Card>
  );
}

function PostReceipt({ receipt: r, issues }: { receipt: ReceiptSummary; issues: number }) {
  const router = useRouter();
  const [person, setPerson] = usePersonName();
  const [note, setNote] = useState("");
  const self = !!r.checked_by_name && person.trim().toLowerCase() === r.checked_by_name.trim().toLowerCase();
  const post = async () => {
    const { error } = await createClient().rpc("post_receipt", { p_receipt_id: r.id, p_note: note || null, p_by_name: person });
    if (error) return error.message;
    router.refresh(); return null;
  };
  return (
    <Card className="border-l-4 border-plate">
      <CardHeader><CardTitle>Posting</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {issues > 0 && <p className="text-sm text-warn">{issues} selisih dengan dokumen. Tulis keterangan (mis. sudah dilaporkan ke Shell / transporter).</p>}
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-72 flex-1"><Label htmlFor="pnote">Keterangan</Label><Input id="pnote" value={note} onChange={(e) => setNote(e.target.value)} /></div>
          <PersonNameField id="poster" value={person} onChange={setPerson} label="Nama yang memposting" />
          <ConfirmButton title={`Posting ${r.doc_no}`} confirmLabel="Posting"
            summary={`${fmtNum(Number(r.good_qty))} unit baik masuk ke bin masing-masing${Number(r.damaged_qty) ? `, ${fmtNum(Number(r.damaged_qty))} unit rusak ke karantina (ditahan)` : ""}. Diperiksa ${r.checked_by_name}, diposting ${person || "?"}.`}
            disabled={self || person.trim().length < 2 || (issues > 0 && !note.trim())} onConfirm={post}>Posting ke stok</ConfirmButton>
        </div>
        {self && <p className="text-xs text-bad">Anda yang memeriksa: posting harus oleh orang lain.</p>}
      </CardContent>
    </Card>
  );
}

function CancelReceipt({ receipt: r }: { receipt: ReceiptSummary }) {
  const router = useRouter();
  const [person, setPerson] = usePersonName();
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!asking) return <Button variant="ghost" size="sm" onClick={() => setAsking(true)}>Batalkan penerimaan</Button>;
  async function cancel() {
    const { error } = await createClient().rpc("cancel_receipt", { p_receipt_id: r.id, p_note: note, p_by_name: person });
    if (error) return setError(error.message);
    router.refresh();
  }
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-64"><Label htmlFor="cn">Alasan batal</Label><Input id="cn" value={note} onChange={(e) => setNote(e.target.value)} /></div>
      <PersonNameField id="canceller" value={person} onChange={setPerson} />
      <Button variant="outline" size="sm" onClick={cancel} disabled={!note.trim() || person.trim().length < 2}>Batalkan</Button>
      <Button variant="ghost" size="sm" onClick={() => setAsking(false)}>Tidak jadi</Button>
      {error && <p role="alert" className="w-full text-sm text-bad">{error}</p>}
    </div>
  );
}
