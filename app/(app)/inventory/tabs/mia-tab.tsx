"use client";
import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ConfirmButton } from "@/components/app/confirm-button";
import { PersonNameField, usePersonName } from "@/components/app/person-name";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { MIA_ALERT_DAYS, MIA_KIND_LABEL, miaAgeDays, miaSummary, type MiaEvent, type MiaStockRow } from "@/lib/mia";
import { cn, fmtDate, fmtDateTime, fmtNum } from "@/lib/utils";

type BinLine = { sku: string; description: string; batch_lot: string; expiry_date: string | null; quantity: number; held: number };

const intOf = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v) : NaN);

/**
 * MIA (Missing In Action): stock nobody can find. It is not part of our side of the SAP comparison. Inventory and
 * Admin move stock in and out here without a second person: the ledger below keeps who, why and how many.
 */
export function MiaTab({ stock, events, canMove }: { stock: MiaStockRow[]; events: MiaEvent[]; canMove: boolean }) {
  const [person, setPerson] = usePersonName();
  const s = miaSummary(stock);
  return (
    <div className="space-y-6 p-4 lg:p-8">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {([
          ["Karton di MIA", fmtNum(s.qty), undefined],
          ["SKU", fmtNum(s.skus), undefined],
          ["Paling lama", s.oldestDays === null ? "–" : `${fmtNum(s.oldestDays)} hari`, undefined],
          [`Lewat ${MIA_ALERT_DAYS} hari`, fmtNum(s.overdue), s.overdue > 0 ? "text-warn" : undefined],
        ] as const).map(([k, v, tone]) => (
          <div key={k} className="rounded-lg bg-white p-3">
            <div className="text-xs text-steel-500">{k}</div>
            <div className={cn("font-cond text-2xl font-semibold tabular", tone)}>{v}</div>
          </div>
        ))}
      </div>
      <p className="text-sm text-steel-700">
        MIA tidak dihitung sebagai stok WMS pada perbandingan dengan SAP. Dipakai untuk stok yang tercatat tetapi tidak ketemu di rak,
        atau stok yang SAP punya tetapi belum ketemu. {canMove
          ? "Anda bisa memindahkan stok masuk dan keluar MIA tanpa persetujuan; semuanya tercatat di riwayat di bawah."
          : "Hanya Inventory dan Admin yang bisa memindahkan stok masuk dan keluar MIA."}
      </p>
      {canMove && <div className="max-w-sm"><PersonNameField id="mia-person" value={person} onChange={setPerson} label="Nama Anda" /></div>}

      <StockTable stock={stock} canMove={canMove} person={person} />
      {canMove && <MoveIn person={person} />}
      {canMove && <Book person={person} />}
      <History events={events} />
    </div>
  );
}

function StockTable({ stock, canMove, person }: { stock: MiaStockRow[]; canMove: boolean; person: string }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader><CardTitle>Stok di MIA · {fmtNum(stock.length)} baris</CardTitle></CardHeader>
      <CardContent>
        {stock.length === 0 ? <p className="text-sm text-steel-500">MIA kosong.</p> : (
          <div className="overflow-auto">
            <Table>
              <thead><tr><Th>SKU</Th><Th>Batch</Th><Th>Expired</Th><Th className="text-right">Karton</Th><Th>Sejak</Th><Th /></tr></thead>
              <tbody>{stock.map((r) => {
                const k = `${r.sku}|${r.batch_lot}|${r.expiry_date ?? ""}`;
                const age = miaAgeDays(r.since);
                return (
                  <Fragment key={k}>
                    <tr>
                      <Td>{r.sku}<div className="text-xs text-steel-500">{r.description}</div></Td>
                      <Td>{r.batch_lot || "–"}</Td><Td>{fmtDate(r.expiry_date)}</Td>
                      <Td className="text-right font-semibold tabular">{fmtNum(Number(r.quantity))}</Td>
                      <Td className={cn("text-xs", age !== null && age > MIA_ALERT_DAYS && "font-semibold text-warn")}>
                        {r.since ? fmtDate(r.since) : "–"}{age !== null && <div>{age > MIA_ALERT_DAYS && <AlertTriangle className="mr-1 inline h-3 w-3" />}{age} hari</div>}
                      </Td>
                      <Td>{canMove && <Button size="sm" variant="outline" onClick={() => setOpen(open === k ? null : k)}>{open === k ? "Tutup" : "Pindahkan"}</Button>}</Td>
                    </tr>
                    {open === k && (
                      <tr><td colSpan={6} className="border-b border-steel-200 bg-paper p-3">
                        <div className="grid gap-4 lg:grid-cols-2">
                          <FindForm row={r} person={person} onDone={() => setOpen(null)} />
                          <ClearForm row={r} person={person} onDone={() => setOpen(null)} />
                        </div>
                      </td></tr>
                    )}
                  </Fragment>
                );
              })}</tbody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function useAct() {
  const router = useRouter();
  return async (fn: string, args: Record<string, unknown>): Promise<string | null> => {
    const { error } = await createClient().rpc(fn, args);
    if (error) return error.message;
    router.refresh();
    return null;
  };
}

/** MIA -> rack: found. */
function FindForm({ row, person, onDone }: { row: MiaStockRow; person: string; onDone: () => void }) {
  const act = useAct();
  const [bin, setBin] = useState(""); const [qty, setQty] = useState(String(row.quantity)); const [note, setNote] = useState("");
  const q = intOf(qty), ok = person.trim().length >= 2 && bin.trim().length >= 4 && q > 0 && q <= row.quantity && note.trim().length > 0;
  return (
    <div className="space-y-2 text-sm">
      <p className="font-semibold">Ditemukan: pindah ke bin</p>
      <div className="grid grid-cols-[1fr_6rem] gap-2">
        <div><Label htmlFor={`f-bin-${row.sku}`}>Bin tujuan</Label><Input id={`f-bin-${row.sku}`} className="uppercase" value={bin} onChange={(e) => setBin(e.target.value)} placeholder="mis. CA01A01" /></div>
        <div><Label htmlFor={`f-q-${row.sku}`}>Karton</Label><Input id={`f-q-${row.sku}`} type="number" inputMode="numeric" min={1} max={row.quantity} className="tabular" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
      </div>
      <div><Label htmlFor={`f-n-${row.sku}`}>Keterangan</Label><Input id={`f-n-${row.sku}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. ketemu di belakang rak CD22" /></div>
      <ConfirmButton title="Stok MIA ditemukan" confirmLabel="Pindahkan ke bin" disabled={!ok}
        summary={`Pindahkan ${fmtNum(q || 0)} karton ${row.sku} (batch ${row.batch_lot || "–"}) dari MIA ke ${bin.trim().toUpperCase() || "…"}. Stok WMS bertambah sebesar itu.`}
        onConfirm={async () => {
          const e = await act("mia_find", { p_to_bin: bin, p_sku: row.sku, p_batch: row.batch_lot, p_expiry: row.expiry_date, p_qty: q, p_note: note, p_by_name: person });
          if (!e) onDone();
          return e;
        }}>Pindah ke bin</ConfirmButton>
    </div>
  );
}

/** MIA -> nothing: written off. */
function ClearForm({ row, person, onDone }: { row: MiaStockRow; person: string; onDone: () => void }) {
  const act = useAct();
  const [qty, setQty] = useState(String(row.quantity)); const [note, setNote] = useState("");
  const q = intOf(qty), ok = person.trim().length >= 2 && q > 0 && q <= row.quantity && note.trim().length > 0;
  return (
    <div className="space-y-2 text-sm">
      <p className="font-semibold">Dihapus: sudah di-posting SAP</p>
      <div className="grid grid-cols-[6rem_1fr] gap-2">
        <div><Label htmlFor={`c-q-${row.sku}`}>Karton</Label><Input id={`c-q-${row.sku}`} type="number" inputMode="numeric" min={1} max={row.quantity} className="tabular" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
        <div><Label htmlFor={`c-n-${row.sku}`}>Keterangan (nomor dokumen SAP)</Label><Input id={`c-n-${row.sku}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. SAP 702 dokumen 4900123" /></div>
      </div>
      <ConfirmButton title="Hapus stok MIA" confirmLabel="Hapus dari MIA" variant="outline" disabled={!ok}
        summary={`Hapus ${fmtNum(q || 0)} karton ${row.sku} (batch ${row.batch_lot || "–"}) dari MIA. Stok ini hilang dari WMS dan tidak bisa dikembalikan kecuali dicatat lagi.`}
        onConfirm={async () => {
          const e = await act("mia_clear", { p_sku: row.sku, p_batch: row.batch_lot, p_expiry: row.expiry_date, p_qty: q, p_note: note, p_by_name: person });
          if (!e) onDone();
          return e;
        }}>Hapus dari MIA</ConfirmButton>
    </div>
  );
}

/** rack -> MIA: the system holds it, the floor does not show it. */
function MoveIn({ person }: { person: string }) {
  const act = useAct();
  const [bin, setBin] = useState(""); const [lines, setLines] = useState<BinLine[] | null>(null); const [err, setErr] = useState<string | null>(null);
  const [pick, setPick] = useState<number | null>(null); const [qty, setQty] = useState(""); const [note, setNote] = useState("");

  async function load() {
    setErr(null); setLines(null); setPick(null);
    const { data, error } = await createClient().from("inventory_detail")
      .select("sku, description, batch_lot, expiry_date, quantity, held").eq("bin_code", bin.trim().toUpperCase()).gt("quantity", 0).order("sku");
    if (error) { setErr(error.message); return; }
    setLines((data ?? []) as BinLine[]);
  }
  const sel = pick !== null && lines ? lines[pick] : null;
  const q = intOf(qty), ok = !!sel && person.trim().length >= 2 && q > 0 && q <= Number(sel.quantity) && note.trim().length > 0;
  return (
    <Card>
      <CardHeader><CardTitle>Pindahkan dari bin ke MIA</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-steel-700">Sistem mencatat stok di bin ini, tetapi barangnya tidak ada di sana. Stok dipindah ke MIA; stok WMS berkurang sebesar itu.</p>
        <div className="flex flex-wrap items-end gap-2">
          <div><Label htmlFor="mi-bin">Bin asal</Label><Input id="mi-bin" className="w-40 uppercase" value={bin} onChange={(e) => setBin(e.target.value)} placeholder="mis. CD23B02" /></div>
          <Button variant="outline" disabled={bin.trim().length < 4} onClick={() => void load()}>Lihat isi bin</Button>
        </div>
        {err && <p role="alert" className="text-bad">{err}</p>}
        {lines && lines.length === 0 && <p className="text-steel-500">Bin ini kosong di sistem.</p>}
        {lines && lines.length > 0 && (
          <div className="space-y-1">
            {lines.map((l, i) => (
              <label key={i} className={cn("flex cursor-pointer items-center gap-2 rounded border p-2", pick === i ? "border-ckb bg-ckb/5" : "border-steel-200")}>
                <input type="radio" name="mi-line" checked={pick === i} onChange={() => { setPick(i); setQty(String(l.quantity)); }} />
                <span><b>{l.sku}</b> {l.description} · batch {l.batch_lot || "–"} · exp {fmtDate(l.expiry_date)} · <b className="tabular">{fmtNum(Number(l.quantity))}</b> karton{Number(l.held) > 0 ? ` · ditahan ${fmtNum(Number(l.held))}` : ""}</span>
              </label>
            ))}
          </div>
        )}
        {sel && (
          <div className="grid gap-2 sm:grid-cols-[6rem_1fr]">
            <div><Label htmlFor="mi-q">Karton</Label><Input id="mi-q" type="number" inputMode="numeric" min={1} max={Number(sel.quantity)} className="tabular" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
            <div><Label htmlFor="mi-n">Keterangan</Label><Input id="mi-n" value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. palet tidak ada di bin, sudah dicari" /></div>
          </div>
        )}
        <ConfirmButton title="Pindahkan ke MIA" confirmLabel="Pindahkan ke MIA" disabled={!ok}
          summary={sel ? `Pindahkan ${fmtNum(q || 0)} karton ${sel.sku} (batch ${sel.batch_lot || "–"}) dari ${bin.trim().toUpperCase()} ke MIA. Stok WMS berkurang ${fmtNum(q || 0)}.` : "Pilih baris stok dulu."}
          onConfirm={async () => {
            if (!sel) return "Pilih baris stok dulu.";
            const e = await act("mia_move_in", { p_from_bin: bin, p_sku: sel.sku, p_batch: sel.batch_lot, p_expiry: sel.expiry_date, p_qty: q, p_note: note, p_by_name: person });
            if (!e) { setLines(null); setPick(null); setNote(""); setQty(""); }
            return e;
          }}>Pindahkan ke MIA</ConfirmButton>
      </CardContent>
    </Card>
  );
}

/** nothing -> MIA: SAP has it, nobody found it. */
function Book({ person }: { person: string }) {
  const act = useAct();
  const [sku, setSku] = useState(""); const [batch, setBatch] = useState(""); const [exp, setExp] = useState(""); const [qty, setQty] = useState(""); const [note, setNote] = useState("");
  const q = intOf(qty), ok = /^\d{6,}$/.test(sku.trim()) && person.trim().length >= 2 && q > 0 && note.trim().length > 0;
  return (
    <Card>
      <CardHeader><CardTitle>Catat stok yang belum ketemu</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-steel-700">SAP mencatat stok ini tetapi tidak ada di WMS dan belum ketemu. Dicatat ke MIA agar kelihatan; stok WMS pada perbandingan SAP tidak berubah.</p>
        <div className="grid gap-2 sm:grid-cols-[10rem_1fr_10rem_6rem]">
          <div><Label htmlFor="bk-sku">SKU</Label><Input id="bk-sku" inputMode="numeric" value={sku} onChange={(e) => setSku(e.target.value)} /></div>
          <div><Label htmlFor="bk-batch">Batch (jika tahu)</Label><Input id="bk-batch" className="uppercase" value={batch} onChange={(e) => setBatch(e.target.value)} /></div>
          <div><Label htmlFor="bk-exp">Expired (jika tahu)</Label><Input id="bk-exp" type="date" value={exp} onChange={(e) => setExp(e.target.value)} /></div>
          <div><Label htmlFor="bk-q">Karton</Label><Input id="bk-q" type="number" inputMode="numeric" min={1} className="tabular" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
        </div>
        <div><Label htmlFor="bk-n">Keterangan</Label><Input id="bk-n" value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. SAP lebih 48 karton, picklist kemarin sudah dicek" /></div>
        <ConfirmButton title="Catat ke MIA" confirmLabel="Catat ke MIA" disabled={!ok}
          summary={`Catat ${fmtNum(q || 0)} karton ${sku.trim()} (batch ${batch.trim() || "–"}) ke MIA sebagai stok yang belum ketemu. Stok WMS pada perbandingan SAP tidak berubah.`}
          onConfirm={async () => {
            const e = await act("mia_book", { p_sku: sku, p_batch: batch.trim().toUpperCase(), p_expiry: exp || null, p_qty: q, p_note: note, p_by_name: person });
            if (!e) { setSku(""); setBatch(""); setExp(""); setQty(""); setNote(""); }
            return e;
          }}>Catat ke MIA</ConfirmButton>
      </CardContent>
    </Card>
  );
}

function History({ events }: { events: MiaEvent[] }) {
  return (
    <Card>
      <CardHeader><CardTitle>Riwayat MIA · {fmtNum(events.length)} terakhir</CardTitle></CardHeader>
      <CardContent>
        {events.length === 0 ? <p className="text-sm text-steel-500">Belum ada.</p> : (
          <div className="max-h-[28rem] overflow-auto">
            <Table>
              <thead><tr><Th>Waktu</Th><Th>Kejadian</Th><Th>SKU</Th><Th>Batch</Th><Th className="text-right">Karton</Th><Th>Bin</Th><Th>Oleh</Th><Th>Keterangan</Th></tr></thead>
              <tbody>{events.map((e) => (
                <tr key={e.id}>
                  <Td className="whitespace-nowrap text-xs">{fmtDateTime(e.created_at)}</Td>
                  <Td className="whitespace-nowrap">{MIA_KIND_LABEL[e.kind]}{e.line_id && <div className="text-xs text-steel-500">dari rekonsiliasi</div>}</Td>
                  <Td>{e.sku}</Td><Td className="text-xs">{e.batch_lot || "–"}<div className="text-steel-500">exp {fmtDate(e.expiry_date)}</div></Td>
                  <Td className="text-right tabular">{fmtNum(Number(e.quantity))}</Td><Td>{e.bin_code ?? "–"}</Td>
                  <Td className="text-xs">{e.by_name}</Td><Td className="max-w-xs text-xs">{e.note}</Td>
                </tr>
              ))}</tbody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
