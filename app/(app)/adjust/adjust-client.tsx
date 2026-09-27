"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Plus, Replace, Search, SlidersHorizontal } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { AdjustDialog } from "@/components/bin/movement-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/input";
import { OtherPersonField, PersonNameField, usePersonName } from "@/components/app/person-name";
import { MANUAL_REASONS, REASON_CODES, type ReasonCode } from "@/lib/inventory-control";
import { Table, Td, Th } from "@/components/ui/table";
import type { BinDetail } from "@/lib/bin-data";
import type { InventoryRow } from "@/lib/types";
import { fmtDate, fmtNum } from "@/lib/utils";

/**
 * Bin lookup + one ± button per stock line. Each adjustment goes through the
 * same form as Adjust on the bin page (confirmation, required reason, one
 * `adjustment` movement in the history).
 */
export function AdjustClient({ code, detail }: { code: string; detail: BinDetail | null }) {
  const router = useRouter();
  const [bin, setBin] = useState(code);
  // null = new SKU/batch line, number = index into detail.inventory, undefined = closed
  const [editing, setEditing] = useState<number | null | undefined>(undefined);
  const [replacing, setReplacing] = useState<InventoryRow | null>(null);
  const [swapping, setSwapping] = useState(false);
  const done = () => { setReplacing(null); setSwapping(false); router.refresh(); };

  function lookup(e: React.FormEvent) {
    e.preventDefault();
    const c = bin.trim().toUpperCase();
    if (c) router.push(`/adjust?bin=${encodeURIComponent(c)}`);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 lg:p-8">
      <form onSubmit={lookup} className="flex items-end gap-2 rounded-lg bg-white p-4">
        <div className="flex-1">
          <Label htmlFor="bin">Bin</Label>
          <Input id="bin" className="uppercase" autoFocus autoComplete="off" value={bin} onChange={(e) => setBin(e.target.value)} placeholder="Ketik atau scan, mis. CA01C01" />
        </div>
        <Button type="submit" disabled={!bin.trim()}><Search className="h-4 w-4" />Cari</Button>
      </form>

      {code && !detail && (
        <p role="alert" className="rounded-md bg-bad/10 p-3 text-sm text-bad">Bin {code} tidak ditemukan. Periksa kodenya (contoh: CA01C01, STAGING, STG_01).</p>
      )}

      {detail && (
        <Card>
          <CardHeader className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>
              {detail.bin.bin_code}
              {detail.bin.status === "blocked" && <span className="ml-2 text-sm font-normal text-bad">diblokir</span>}
            </CardTitle>
            <div className="flex items-center gap-3">
              <Button size="sm" variant="outline" onClick={() => setSwapping(true)}><ArrowLeftRight className="h-4 w-4" />Tukar dengan bin lain</Button>
              <Link href={`/bin/${encodeURIComponent(detail.bin.bin_code)}`} className="text-sm underline-offset-2 hover:underline">Buka halaman bin</Link>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {detail.inventory.length === 0 ? (
              <p className="text-sm text-steel-500">Bin ini kosong.</p>
            ) : (
              <Table>
                <thead><tr><Th>SKU</Th><Th>Batch</Th><Th>Expired</Th><Th className="text-right">Qty</Th><Th /></tr></thead>
                <tbody>{detail.inventory.map((r, i) => (
                  <tr key={r.id}>
                    <Td><span className="font-semibold">{r.items?.sku}</span><br /><span className="text-xs text-steel-500">{r.items?.description}</span></Td>
                    <Td>{r.batch_lot || "–"}</Td>
                    <Td>{fmtDate(r.expiry_date)}</Td>
                    <Td className="text-right tabular">{fmtNum(Number(r.quantity))} {r.items?.uom ?? ""}</Td>
                    <Td className="whitespace-nowrap text-right">
                      <Button size="sm" variant="outline" onClick={() => setEditing(i)} aria-label={`Adjust ${r.items?.sku}`}><SlidersHorizontal className="h-4 w-4" />±</Button>{" "}
                      <Button size="sm" variant="outline" onClick={() => setReplacing(r)}><Replace className="h-4 w-4" />Item salah</Button>
                    </Td>
                  </tr>
                ))}</tbody>
              </Table>
            )}
            <Button variant="outline" onClick={() => setEditing(null)}><Plus className="h-4 w-4" />Tambah SKU baru</Button>
          </CardContent>
        </Card>
      )}

      {detail && editing !== undefined && (
        <AdjustDialog bin={detail.bin} inventory={detail.inventory} lineIdx={editing}
          onClose={() => setEditing(undefined)}
          onDone={() => { setEditing(undefined); router.refresh(); }} />
      )}
      {detail && replacing && <ReplaceItemDialog binCode={detail.bin.bin_code} row={replacing} onClose={() => setReplacing(null)} onDone={done} />}
      {detail && swapping && <SwapBinDialog detail={detail} onClose={() => setSwapping(false)} onDone={done} />}
    </div>
  );
}

type Pending = { summary: string; run: () => Promise<string | null> };

/** Form, then a one-sentence confirmation, then the RPC. */
function TwoStep({ title, description, pending, onBack, onClose, children }: {
  title: string; description: string; pending: Pending | null; onBack: () => void; onClose: () => void; children: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function confirm() {
    if (!pending) return;
    setBusy(true); setError(null);
    const err = await pending.run();
    setBusy(false);
    if (err) setError(err);
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={title} description={description}>
        {pending ? (
          <div className="space-y-4">
            <p className="rounded-md bg-plate/30 p-3 text-base">{pending.summary}</p>
            {error && <p role="alert" className="rounded-md bg-bad/10 p-2 text-sm text-bad">{error}</p>}
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" size="lg" onClick={() => { setError(null); onBack(); }}>Ubah</Button>
              <Button size="lg" onClick={confirm} disabled={busy}>{busy ? "Menyimpan…" : "Konfirmasi"}</Button>
            </div>
          </div>
        ) : children}
      </DialogContent>
    </Dialog>
  );
}

/** The line is recorded as the wrong SKU (or batch / expiry / qty): replace it with what is really there. */
function ReplaceItemDialog({ binCode, row, onClose, onDone }: { binCode: string; row: InventoryRow; onClose: () => void; onDone: () => void }) {
  const oldSku = row.items?.sku ?? "";
  const [sku, setSku] = useState("");
  const [batch, setBatch] = useState(row.batch_lot);
  const [expiry, setExpiry] = useState(row.expiry_date ?? "");
  const [qty, setQty] = useState(String(Number(row.quantity)));
  const [reason, setReason] = useState("");
  const [code, setCode] = useState<ReasonCode>("DATA_ENTRY");
  const [person, setPerson] = usePersonName();
  const [approver, setApprover] = useState("");
  const [limit, setLimit] = useState(20);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  useEffect(() => {
    createClient().rpc("inventory_policy").then(({ data }) => setLimit(Number((data as { adjust_approval_qty?: number } | null)?.adjust_approval_qty ?? 20)));
  }, []);
  const needsApprover = Math.max(Number(row.quantity), Number(qty) || 0) > limit;

  async function review(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    const n = Number(qty);
    if (person.trim().length < 2) return setError("Isi nama petugas.");
    if (needsApprover && approver.trim().length < 2) return setError(`Di atas ${fmtNum(limit)} unit: isi nama penyetuju (orang lain).`);
    if (!sku.trim()) return setError("Isi SKU yang benar.");
    if (!expiry) return setError("Isi tanggal expired item yang benar.");
    if (!Number.isFinite(n) || n <= 0) return setError("Jumlah harus lebih dari 0.");
    if (!reason.trim()) return setError("Alasan wajib diisi (jejak audit).");
    const { data: item } = await createClient().from("items").select("sku, description, uom").eq("sku", sku.trim()).maybeSingle();
    if (!item) return setError(`SKU ${sku.trim()} tidak ada di master item.`);
    setPending({
      summary: `${binCode}: ${oldSku} batch ${row.batch_lot || "–"} (${fmtNum(Number(row.quantity))}) diganti menjadi ${item.sku} ${item.description} batch ${batch.trim() || "–"} exp ${fmtDate(expiry)} (${fmtNum(n)} ${item.uom ?? ""}). Alasan: ${reason.trim()}.`,
      run: async () => {
        const { error } = await createClient().rpc("replace_stock_item", {
          p_bin_code: binCode, p_sku: oldSku, p_batch: row.batch_lot, p_expiry: row.expiry_date,
          p_new_sku: sku.trim(), p_new_batch: batch.trim(), p_new_expiry: expiry, p_new_qty: n,
          p_reason_code: code, p_reason: reason.trim(), p_by_name: person, p_approver_name: needsApprover ? approver : null,
        });
        if (error) return error.message;
        onDone();
        return null;
      },
    });
  }

  return (
    <TwoStep title="Item salah" description={`${binCode} · tercatat ${oldSku}`} pending={pending} onBack={() => setPending(null)} onClose={onClose}>
      <form onSubmit={review} className="space-y-4">
        <div className="rounded-md bg-steel-100 p-3 text-sm">
          <p>Tercatat: <b>{oldSku}</b> {row.items?.description}</p>
          <p>Batch {row.batch_lot || "–"} · exp {fmtDate(row.expiry_date)} · {fmtNum(Number(row.quantity))} {row.items?.uom ?? ""}</p>
        </div>
        <div><Label htmlFor="rsku">SKU yang benar (ada di bin)</Label><Input id="rsku" inputMode="numeric" autoFocus value={sku} onChange={(e) => setSku(e.target.value)} required /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label htmlFor="rbatch">Batch</Label><Input id="rbatch" value={batch} onChange={(e) => setBatch(e.target.value)} /></div>
          <div><Label htmlFor="rexp">Expired</Label><Input id="rexp" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} required /></div>
        </div>
        <div><Label htmlFor="rqty">Jumlah</Label><Input id="rqty" type="number" inputMode="decimal" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} required /></div>
        <div>
          <Label htmlFor="rcode">Kode alasan</Label>
          <Select id="rcode" value={code} onChange={(e) => setCode(e.target.value as ReasonCode)}>
            {MANUAL_REASONS.map((c) => <option key={c} value={c}>{REASON_CODES[c]}</option>)}
          </Select>
        </div>
        <div><Label htmlFor="rreason">Keterangan (wajib)</Label><Input id="rreason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="mis. salah input saat putaway" required /></div>
        <div className="grid grid-cols-2 gap-2">
          <PersonNameField id="rperson" value={person} onChange={setPerson} />
          {needsApprover && <OtherPersonField id="rapprover" label={`Penyetuju (di atas ${fmtNum(limit)} unit)`} value={approver} onChange={setApprover} notSameAs={person} />}
        </div>
        {error && <p role="alert" className="rounded-md bg-bad/10 p-2 text-sm text-bad">{error}</p>}
        <Button type="submit" size="lg" className="w-full">Lanjut ke konfirmasi</Button>
      </form>
    </TwoStep>
  );
}

type OtherLine = { sku: string; batch_lot: string; quantity: number };
const describe = (lines: OtherLine[]) => lines.length === 0 ? "kosong" : lines.map((l) => `${l.sku} ${l.batch_lot || "–"} (${fmtNum(Number(l.quantity))})`).join(", ");

/** The stock recorded in this bin is really in another bin and the other way round. */
function SwapBinDialog({ detail, onClose, onDone }: { detail: BinDetail; onClose: () => void; onDone: () => void }) {
  const here = detail.bin.bin_code;
  const mine: OtherLine[] = detail.inventory.map((r) => ({ sku: r.items?.sku ?? "", batch_lot: r.batch_lot, quantity: Number(r.quantity) }));
  const [other, setOther] = useState("");
  const [reason, setReason] = useState("");
  const [person, setPerson] = usePersonName();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  async function review(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    const code = other.trim().toUpperCase();
    if (!code) return setError("Isi bin yang ditukar.");
    if (code === here) return setError("Pilih bin lain.");
    if (!reason.trim()) return setError("Alasan wajib diisi (jejak audit).");
    if (person.trim().length < 2) return setError("Isi nama petugas.");
    const { data, error } = await createClient().from("inventory_detail").select("sku, batch_lot, quantity").eq("bin_code", code).order("sku");
    if (error) return setError(error.message);
    const theirs = (data ?? []) as OtherLine[];
    if (mine.length === 0 && theirs.length === 0) return setError("Kedua bin kosong: tidak ada yang ditukar.");
    setPending({
      summary: `Isi ${here} [${describe(mine)}] pindah ke ${code}, dan isi ${code} [${describe(theirs)}] pindah ke ${here}. Dicatat sebagai transfer. Alasan: ${reason.trim()}.`,
      run: async () => {
        const { error } = await createClient().rpc("swap_bin_contents", { p_bin_a: here, p_bin_b: code, p_reason: reason.trim(), p_by_name: person });
        if (error) return error.message;
        onDone();
        return null;
      },
    });
  }

  return (
    <TwoStep title="Tukar dengan bin lain" description={`${here}: isinya tertukar dengan bin lain`} pending={pending} onBack={() => setPending(null)} onClose={onClose}>
      <form onSubmit={review} className="space-y-4">
        <p className="rounded-md bg-steel-100 p-3 text-sm">Tercatat di {here}: {describe(mine)}</p>
        <div><Label htmlFor="other">Bin yang isinya tertukar</Label><Input id="other" className="uppercase" autoFocus value={other} onChange={(e) => setOther(e.target.value)} placeholder="Ketik atau scan, mis. CA01C02" required /></div>
        <div><Label htmlFor="sreason">Alasan (wajib)</Label><Input id="sreason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="mis. palet tertukar saat putaway" required /></div>
        <PersonNameField id="sperson" value={person} onChange={setPerson} />
        {error && <p role="alert" className="rounded-md bg-bad/10 p-2 text-sm text-bad">{error}</p>}
        <Button type="submit" size="lg" className="w-full">Lihat & konfirmasi</Button>
      </form>
    </TwoStep>
  );
}
