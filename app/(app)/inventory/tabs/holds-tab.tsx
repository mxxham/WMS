"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ItemScanInput } from "@/components/app/item-scan-input";
import { PersonNameField, usePersonName } from "@/components/app/person-name";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { HOLD_REASONS, type HoldReason } from "@/lib/inventory-control";
import { cn, fmtDate, fmtDateTime, fmtNum } from "@/lib/utils";

export type HoldRow = {
  id: string; scope: "LINE" | "BATCH"; bin_code: string | null; sku: string; description: string; uom: string | null;
  batch_lot: string; expiry_date: string | null; quantity: number | null; reason_code: HoldReason; note: string; source: string;
  status: string; created_by_name: string; created_at: string; released_by_name: string | null; released_at: string | null;
  release_note: string | null; covered_qty: number; bins: number;
};
type BinLine = { sku: string; description: string; uom: string | null; batch_lot: string; expiry_date: string | null; quantity: number; held: number };

const SOURCE: Record<string, string> = { MANUAL: "", RECEIPT: "penerimaan", CARRY: "ikut ke karantina", RECON: "rekonsiliasi" };

/**
 * Held stock stays where it is but cannot be picked or moved (except into
 * quarantine or written off) until the hold is released; allocation leaves
 * it out.
 */
export function HoldsTab({ active, released }: { active: HoldRow[]; released: HoldRow[] }) {
  return (
    <div className="space-y-6 p-4 lg:p-8">
      <PlaceHold />
      <Card>
        <CardHeader><CardTitle>Hold aktif · {fmtNum(active.length)}</CardTitle></CardHeader>
        <CardContent>
          {active.length === 0 ? <p className="text-sm text-steel-500">Tidak ada stok yang ditahan.</p> : (
            <Table>
              <thead><tr><Th>Cakupan</Th><Th>SKU</Th><Th>Batch</Th><Th>Expired</Th><Th className="text-right">Ditahan</Th><Th>Alasan</Th><Th>Sejak</Th><Th /></tr></thead>
              <tbody>{active.map((h) => <HoldLine key={h.id} h={h} />)}</tbody>
            </Table>
          )}
        </CardContent>
      </Card>
      {released.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Dilepas (50 terakhir)</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <thead><tr><Th>Cakupan</Th><Th>SKU</Th><Th>Batch</Th><Th>Alasan hold</Th><Th>Ditahan</Th><Th>Dilepas</Th></tr></thead>
              <tbody>{released.map((h) => (
                <tr key={h.id}>
                  <Td className="text-xs">{h.scope === "BATCH" ? "Seluruh batch" : h.bin_code}</Td>
                  <Td>{h.sku}</Td><Td>{h.batch_lot || "–"}</Td>
                  <Td className="text-xs">{HOLD_REASONS[h.reason_code]} · {h.note}</Td>
                  <Td className="text-xs">{fmtDateTime(h.created_at)} · {h.created_by_name}</Td>
                  <Td className="text-xs">{fmtDateTime(h.released_at)} · {h.released_by_name}{h.release_note && <div>{h.release_note}</div>}</Td>
                </tr>
              ))}</tbody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function HoldLine({ h }: { h: HoldRow }) {
  const router = useRouter();
  const [person, setPerson] = usePersonName();
  const [releasing, setReleasing] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function release() {
    const { error } = await createClient().rpc("release_hold", { p_id: h.id, p_note: note, p_by_name: person });
    if (error) return setError(error.message);
    router.refresh();
  }
  return (
    <>
      <tr>
        <Td className="text-xs">{h.scope === "BATCH" ? <b>Seluruh batch ({fmtNum(h.bins)} bin)</b> : <Link className="font-semibold underline" href={`/bin/${encodeURIComponent(h.bin_code ?? "")}`}>{h.bin_code}</Link>}
          {SOURCE[h.source] && <div className="text-steel-500">{SOURCE[h.source]}</div>}</Td>
        <Td className="font-semibold">{h.sku}<div className="text-xs font-normal">{h.description}</div></Td>
        <Td>{h.batch_lot || "–"}</Td><Td className="whitespace-nowrap text-xs">{fmtDate(h.expiry_date)}</Td>
        <Td className="text-right tabular">{fmtNum(Number(h.covered_qty))} <span className="text-xs text-steel-500">{h.uom}</span>
          {h.scope === "LINE" && Number(h.quantity) !== Number(h.covered_qty) && <div className="text-xs text-steel-500">dari {fmtNum(Number(h.quantity))}</div>}</Td>
        <Td className="text-xs"><b>{HOLD_REASONS[h.reason_code]}</b><div>{h.note}</div></Td>
        <Td className="whitespace-nowrap text-xs">{fmtDateTime(h.created_at)}<div>{h.created_by_name}</div></Td>
        <Td>{!releasing && <Button size="sm" variant="outline" onClick={() => setReleasing(true)}>Lepas</Button>}</Td>
      </tr>
      {releasing && (
        <tr><td colSpan={8} className="bg-paper px-4 py-2">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-64 flex-1"><Label htmlFor={`rn-${h.id}`}>Alasan melepas</Label><Input id={`rn-${h.id}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. QA Shell: lolos" /></div>
            <PersonNameField id={`rp-${h.id}`} value={person} onChange={setPerson} />
            <Button size="sm" onClick={release} disabled={!note.trim() || person.trim().length < 2}>Lepas hold</Button>
            <Button size="sm" variant="ghost" onClick={() => setReleasing(false)}>Batal</Button>
          </div>
          {error && <p role="alert" className="mt-1 text-sm text-bad">{error}</p>}
        </td></tr>
      )}
    </>
  );
}

function PlaceHold() {
  const router = useRouter();
  const [scope, setScope] = useState<"LINE" | "BATCH">("LINE");
  const [bin, setBin] = useState("");
  const [lines, setLines] = useState<BinLine[] | null>(null);
  const [lineIdx, setLineIdx] = useState(0);
  const [qty, setQty] = useState("");
  const [sku, setSku] = useState("");
  const [batch, setBatch] = useState("");
  const [reason, setReason] = useState<HoldReason>("QC_HOLD");
  const [note, setNote] = useState("");
  const [person, setPerson] = usePersonName();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadBin() {
    setMsg(null);
    const { data, error } = await createClient().from("inventory_detail")
      .select("sku, description, uom, batch_lot, expiry_date, quantity, held").eq("bin_code", bin.trim().toUpperCase()).order("sku");
    if (error) return setMsg({ ok: false, text: error.message });
    setLines((data ?? []) as BinLine[]); setLineIdx(0);
    if (!data?.length) setMsg({ ok: false, text: `Bin ${bin.toUpperCase()} kosong atau tidak ada.` });
  }

  const line = lines?.[lineIdx];
  const free = line ? Number(line.quantity) - Number(line.held) : 0;

  async function place() {
    setBusy(true); setMsg(null);
    const args = scope === "LINE"
      ? { p_scope: "LINE", p_bin_code: bin.trim().toUpperCase(), p_sku: line?.sku, p_batch: line?.batch_lot, p_expiry: line?.expiry_date, p_qty: Number(qty) }
      : { p_scope: "BATCH", p_bin_code: null, p_sku: sku.trim(), p_batch: batch.trim().toUpperCase(), p_expiry: null, p_qty: null };
    const { data, error } = await createClient().rpc("place_hold", { ...args, p_reason_code: reason, p_note: note, p_by_name: person });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: error.message });
    const tasks = Number((data as { open_tasks?: number } | null)?.open_tasks ?? 0);
    setMsg({ ok: true, text: `Stok ditahan.${tasks ? ` ${tasks} tugas wave terbuka memakai stok ini dan tidak bisa diposting: hitung ulang wave-nya di halaman Alokasi.` : ""}` });
    setQty(""); setNote(""); setLines(null); setBin(""); setSku(""); setBatch("");
    router.refresh();
  }

  const ready = person.trim().length >= 2 && !!note.trim() &&
    (scope === "LINE" ? !!line && Number(qty) > 0 && Number(qty) <= free : !!sku.trim() && !!batch.trim());

  return (
    <Card>
      <CardHeader><CardTitle>Tahan stok</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-1 text-sm" role="radiogroup" aria-label="Cakupan hold">
          {(["LINE", "BATCH"] as const).map((s) => (
            <button key={s} type="button" role="radio" aria-checked={scope === s} onClick={() => { setScope(s); setMsg(null); }}
              className={cn("rounded-md border px-3 py-1.5", scope === s ? "border-ckb bg-ckb text-white" : "border-steel-300")}>
              {s === "LINE" ? "Sebagian / satu bin" : "Seluruh batch (recall)"}
            </button>
          ))}
        </div>
        {scope === "LINE" ? (
          <div className="flex flex-wrap items-end gap-2">
            <div><Label htmlFor="hbin">Bin</Label><Input id="hbin" className="w-36 uppercase" value={bin} onChange={(e) => setBin(e.target.value)} onKeyDown={(e) => e.key === "Enter" && loadBin()} placeholder="CA01C01" /></div>
            <Button variant="outline" onClick={loadBin} disabled={!bin.trim()}>Lihat isi</Button>
            {lines && lines.length > 0 && (
              <>
                <div className="min-w-72 flex-1"><Label htmlFor="hline">Stok</Label>
                  <Select id="hline" value={lineIdx} onChange={(e) => setLineIdx(Number(e.target.value))}>
                    {lines.map((l, i) => <option key={i} value={i}>{l.sku} · {l.batch_lot || "–"} · exp {fmtDate(l.expiry_date)} · {fmtNum(Number(l.quantity))} (ditahan {fmtNum(Number(l.held))})</option>)}
                  </Select></div>
                <div><Label htmlFor="hqty">Jumlah (maks {fmtNum(free)})</Label><Input id="hqty" type="number" min={1} max={free} className="w-32" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
              </>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-64"><Label htmlFor="hsku">SKU</Label><ItemScanInput id="hsku" value={sku} onChange={setSku} /></div>
            <div><Label htmlFor="hbatch">Batch</Label><Input id="hbatch" className="w-40 uppercase" value={batch} onChange={(e) => setBatch(e.target.value)} /></div>
            <p className="pb-2 text-xs text-steel-500">Semua karton batch ini di semua bin — termasuk yang datang nanti — tidak bisa dikirim.</p>
          </div>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <div><Label htmlFor="hreason">Alasan</Label>
            <Select id="hreason" value={reason} onChange={(e) => setReason(e.target.value as HoldReason)}>
              {(Object.keys(HOLD_REASONS) as HoldReason[]).map((r) => <option key={r} value={r}>{HOLD_REASONS[r]}</option>)}
            </Select></div>
          <div className="min-w-64 flex-1"><Label htmlFor="hnote">Keterangan</Label><Input id="hnote" value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. karton penyok 2, tunggu keputusan Shell" /></div>
          <PersonNameField id="hperson" value={person} onChange={setPerson} />
          <Button onClick={place} disabled={!ready || busy}>{busy ? "Menyimpan…" : "Tahan"}</Button>
        </div>
        {msg && <p role={msg.ok ? "status" : "alert"} className={cn("text-sm", msg.ok ? "text-ok" : "text-bad")}>{msg.text}</p>}
        <p className="text-xs text-steel-500">Stok yang ditahan tidak dialokasikan dan tidak bisa di-pick atau dipindah ke rak lain. Boleh dipindah ke karantina (hold ikut pindah) atau ditulis-off lewat adjustment.</p>
      </CardContent>
    </Card>
  );
}
