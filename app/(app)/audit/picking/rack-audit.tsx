"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, ClipboardCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PersonNameField, usePersonName } from "@/components/app/person-name";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { cn, fmtDate, fmtDateTime, fmtNum } from "@/lib/utils";
import { BIN_STATE_LABEL, BIN_STATE_TONE, RACK_STATE_LABEL, RACK_STATE_TONE, type RackBin, type RackSummary } from "./rack-data";

type SaveResult = { result: "OK" | "MISMATCH"; system: number; counted: number; diff: number; lines: number };
const key = (b: RackBin) => `${b.bin_code}|${b.sku}`;

/**
 * One rack (aisle) on a date: its picked bins in walking order. The checker
 * counts what is left of the SKU in each bin, blind (0025); an OK count goes
 * straight on to the next bin still to count.
 */
export function RackAudit({ zone, date, bins, summary }: { zone: string; date: string; bins: RackBin[]; summary: RackSummary }) {
  const router = useRouter();
  const [checker, setChecker] = usePersonName();
  const [open, setOpen] = useState<{ bin: RackBin; flash?: string } | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const todo = bins.filter((b) => b.countable && !saved.has(key(b)));

  /** ✓ Sesuai: what is left in the bin matches the system, so every line of the bin passes. */
  async function confirm(b: RackBin) {
    const k = key(b);
    if (checker.trim().length < 2) return setRowError((e) => ({ ...e, [k]: "Isi nama checker di atas dulu." }));
    setBusy(k); setRowError((e) => ({ ...e, [k]: "" }));
    const { data, error } = await createClient().rpc("record_rack_audit", {
      p_date: date, p_bin: b.bin_code, p_sku: b.sku, p_checker_name: checker, p_counted: b.bin_qty ?? 0, p_note: null,
    });
    setBusy(null);
    if (error) {
      // The system moved since the page loaded: count it in the form instead.
      const msg = error.message.startsWith("Catatan wajib") ? "Sisa di sistem berubah: pakai Tidak sesuai / hitung." : error.message;
      return setRowError((e) => ({ ...e, [k]: msg }));
    }
    if ((data as SaveResult).result === "OK") setSaved((s) => new Set(s).add(k));
    router.refresh();
  }

  /** Marks `from` as counted and returns the next bin to count after it (wrapping round), if any. */
  function next(from: RackBin): { bin: RackBin; left: number } | null {
    const skip = new Set(saved).add(key(from));
    setSaved(skip);
    const rest = bins.filter((b) => b.countable && !skip.has(key(b)));
    const i = bins.findIndex((b) => key(b) === key(from));
    const bin = bins.slice(i + 1).find((b) => b.countable && !skip.has(key(b))) ?? rest[0];
    return bin ? { bin, left: rest.length } : null;
  }

  return (
    <div className="space-y-4">
      <Link href={`/audit/picking?date=${date}`} className="inline-flex items-center gap-1 text-sm underline"><ArrowLeft className="h-4 w-4" />Semua rak</Link>
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h2 className="font-cond text-2xl font-semibold">Rak {zone}</h2>
              <span className={cn("rounded px-2 py-0.5 text-xs font-semibold", RACK_STATE_TONE[summary.state])}>{RACK_STATE_LABEL[summary.state]}</span>
            </div>
            <p className="text-sm text-steel-500">{fmtDate(date)} · {fmtNum(summary.bins)} bin dipick · {fmtNum(summary.lines)} baris</p>
            <p className="text-sm">{fmtNum(summary.done)}/{fmtNum(summary.bins)} bin sudah dihitung
              {summary.mismatch > 0 && <span className="text-bad"> · {fmtNum(summary.mismatch)} selisih</span>}</p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <PersonNameField value={checker} onChange={setChecker} label="Nama checker (bukan picker)" id="rack-checker" />
            {todo.length > 0 && (
              <Button size="lg" variant="outline" onClick={() => setOpen({ bin: todo[0] })}><ClipboardCheck className="h-5 w-5" />Hitung satu per satu ({fmtNum(todo.length)})</Button>
            )}
          </div>
        </CardContent>
      </Card>
      <p className="text-sm text-steel-500">Cek <b>sisa</b> SKU di tiap bin (semua batch). Sama dengan sisa di sistem: tekan <b>✓ Sesuai</b>. Beda: <b>Tidak sesuai</b> lalu isi hitungan.</p>

      <Card>
        <CardContent>
          <Table>
            <thead><tr><Th>Bin</Th><Th>SKU</Th><Th>Shipment</Th><Th>Picker</Th><Th>Baris</Th><Th>Sisa di bin</Th><Th>Status</Th><Th>Hitung terakhir</Th><Th /></tr></thead>
            <tbody>{bins.map((b) => (
              <tr key={key(b)} className={cn(b.state === "MISMATCH" && "bg-bad/5")}>
                <Td className="font-cond text-lg font-semibold">{b.bin_code}</Td>
                <Td><span className="font-semibold">{b.sku}</span><br /><span className="text-xs text-steel-500">{b.description}</span></Td>
                <Td className="text-xs">{b.shipments.join(", ")}</Td>
                <Td className="text-xs">{b.pickers.join(", ") || "(tidak tercatat)"}</Td>
                <Td className="tabular">{fmtNum(b.lines)}</Td>
                <Td className="tabular font-semibold">{fmtNum(b.bin_qty ?? 0)} {b.uom ?? ""}</Td>
                <Td><span className={cn("rounded px-2 py-0.5 text-xs font-semibold", BIN_STATE_TONE[b.state])}>{BIN_STATE_LABEL[b.state]}</span></Td>
                <Td className="text-xs">{b.last
                  ? <>sisa {fmtNum(b.last.counted ?? 0)} · sistem {fmtNum(b.last.system ?? 0)} {b.uom ?? ""}<br />
                      <span className="text-steel-500">{b.last.checker} · {fmtDateTime(b.last.at)}</span></>
                  : b.state === "TODO" ? "–" : <span className="text-steel-500">diaudit di staging</span>}</Td>
                <Td className="text-right">
                  {b.countable && !saved.has(key(b)) && (
                    <div className="flex flex-wrap justify-end gap-1">
                      <Button size="sm" disabled={busy === key(b)} onClick={() => confirm(b)}>{busy === key(b) ? "…" : "✓ Sesuai"}</Button>
                      <Button size="sm" variant="outline" onClick={() => setOpen({ bin: b })}>Tidak sesuai</Button>
                    </div>
                  )}
                  {rowError[key(b)] && <p role="alert" className="mt-1 text-xs text-bad">{rowError[key(b)]}</p>}
                  {saved.has(key(b)) && <span className="text-xs font-semibold text-ok">✓ tersimpan</span>}
                </Td>
              </tr>
            ))}</tbody>
          </Table>
        </CardContent>
      </Card>
      {open && <CountDialog key={key(open.bin)} bin={open.bin} date={date} flash={open.flash} next={next}
        onOpen={(bin, flash) => setOpen({ bin, flash })} onClose={() => setOpen(null)} />}
    </div>
  );
}

function CountDialog({ bin, date, flash, next, onOpen, onClose }: {
  bin: RackBin; date: string; flash?: string;
  next: (from: RackBin) => { bin: RackBin; left: number } | null;
  onOpen: (bin: RackBin, flash: string) => void; onClose: () => void;
}) {
  const router = useRouter();
  const [checker, setChecker] = usePersonName();
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SaveResult | null>(null);
  const [upNext, setUpNext] = useState<{ bin: RackBin; left: number } | null>(null);
  const noteRef = useRef<HTMLInputElement>(null);
  const n = Number(counted);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (checker.trim().length < 2 || counted.trim() === "" || !Number.isFinite(n) || n < 0) {
      return setError("Isi nama checker dan jumlah sisa di bin.");
    }
    setBusy(true); setError(null);
    const { data, error } = await createClient().rpc("record_rack_audit", {
      p_date: date, p_bin: bin.bin_code, p_sku: bin.sku, p_checker_name: checker, p_counted: n, p_note: note,
    });
    setBusy(false);
    if (error) {
      if (error.message.startsWith("Catatan wajib")) noteRef.current?.focus();
      return setError(error.message);
    }
    const r = data as SaveResult;
    const following = next(bin);
    router.refresh();
    if (r.result === "OK" && following) {
      return onOpen(following.bin, `${bin.bin_code} ${bin.sku} sesuai · ${following.left} bin lagi`);
    }
    setUpNext(following);
    setSaved(r);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`${bin.bin_code} · ${bin.sku}`} description={`${bin.description} · SH ${bin.shipments.join(", ")}`}>
        {saved ? (
          <div className="space-y-4">
            <p className={cn("rounded-md p-3 text-base font-semibold", saved.result === "OK" ? "bg-ok/10 text-ok" : "bg-bad/10 text-bad")}>
              {saved.result === "OK" ? "Sesuai. Semua baris di bin ini lolos." : saved.diff > 0
                ? `Sisa lebih ${fmtNum(saved.diff)}: picker mengambil kurang dari yang dicatat.`
                : `Sisa kurang ${fmtNum(-saved.diff)}: picker mengambil lebih dari yang dicatat.`}
            </p>
            <p className="text-sm">Dihitung {fmtNum(saved.counted)} · sistem {fmtNum(saved.system)} {bin.uom ?? ""}</p>
            {saved.result === "MISMATCH" && (
              <p className="text-sm">{saved.diff > 0
                ? "Ambil karton yang kurang ke palet, lalu hitung ulang bin ini. Atau supervisor menerima kurang di halaman shipment."
                : "Kembalikan karton lebih dari palet ke bin ini, lalu hitung ulang."}</p>
            )}
            {upNext && <Button size="lg" className="w-full" onClick={() => onOpen(upNext.bin, "")}>Lanjut: {upNext.bin.bin_code} {upNext.bin.sku}</Button>}
            <Button size="lg" variant={upNext ? "outline" : "default"} className="w-full" onClick={onClose}>Tutup</Button>
          </div>
        ) : (
          <form onSubmit={save} className="space-y-4">
            {flash && <p role="status" className="flex items-center gap-1 rounded-md bg-ok/10 p-2 text-sm font-semibold text-ok"><CheckCircle2 className="h-4 w-4" />{flash}</p>}
            <PersonNameField value={checker} onChange={setChecker} label="Nama checker (bukan picker)" id="checker" />
            <div>
              <Label htmlFor="left">Sisa {bin.sku} di {bin.bin_code} (semua batch) · sistem: {fmtNum(bin.bin_qty ?? 0)} {bin.uom ?? ""}</Label>
              <Input id="left" type="number" inputMode="numeric" min={0} step="any" autoFocus value={counted}
                onChange={(e) => setCounted(e.target.value)} className="h-12 text-lg" required />
            </div>
            <div>
              <Label htmlFor="rnote">Catatan (wajib bila tidak sesuai)</Label>
              <Input id="rnote" ref={noteRef} value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. sisa 2 karton lebih" />
            </div>
            {error && <p role="alert" className="rounded-md bg-bad/10 p-2 text-sm text-bad">{error}</p>}
            <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? "Menyimpan…" : "Simpan"}</Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
