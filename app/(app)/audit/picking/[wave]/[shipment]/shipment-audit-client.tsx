"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, ClipboardCheck, Truck, XCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ItemScanInput } from "@/components/app/item-scan-input";
import { OtherPersonField, PersonNameField, usePersonName } from "@/components/app/person-name";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { expectedExpiry } from "@/lib/batch-code";
import {
  allowedResolutions, LINE_STATE_LABEL, PICK_ERROR_LABEL, RESOLUTION_LABEL,
  type LineState, type PickError, type Resolution,
} from "@/lib/pick-audit";
import { cn, fmtDate, fmtDateTime, fmtNum } from "@/lib/utils";
import { StateBadge, type ShipmentRow } from "../../shipment-list";

export type LineView = {
  task_id: string; seq: number; sku: string; description: string; uom: string | null; from_bin: string;
  /** current stock of this SKU in from_bin, all batches */
  bin_qty: number;
  picked_by_name: string | null; bulk_posted: boolean; state: LineState; attempts: number;
  /** only once the line has been audited (or was picked as 0): what the picker reported */
  picked?: { qty: number; planned_qty: number; batch: string; expiry: string | null; deviation: string | null };
};
export type AttemptView = {
  id: string; task_id: string; attempt_no: number; checker_name: string; found_sku: string; found_batch: string; found_expiry: string | null;
  counted_qty: number; damaged: boolean; expected_sku: string; expected_batch: string; expected_expiry: string | null; expected_qty: number;
  errors: PickError[]; result: "OK" | "MISMATCH"; note: string | null; resolution: Resolution | null; resolved_by_name: string | null;
  resolved_at: string | null; resolution_note: string | null; created_at: string; legacy: boolean;
};
type SaveResult = {
  result: "OK" | "MISMATCH"; errors: PickError[]; attempt: number;
  expected: { sku: string; batch: string; expiry: string | null; qty: number };
  found: { sku: string; batch: string; expiry: string | null; qty: number; damaged: boolean };
};

const LINE_TONE: Record<LineState, string> = {
  AUTO_PASS: "text-steel-500", TODO: "text-steel-500", OK: "text-ok", MISMATCH: "text-bad", RESOLVED: "text-warn",
};

/**
 * The checker records what is on the pallet without seeing what the picker
 * reported; the database compares. A mismatch is fixed on the floor and
 * audited again, or accepted by a supervisor. Loading needs every line passed.
 */
export function ShipmentAuditClient({ shipment: s, lines, attempts, supervisor }: {
  shipment: ShipmentRow; lines: LineView[]; attempts: AttemptView[]; supervisor: boolean;
}) {
  const [audit, setAudit] = useState<{ line: LineView; flash?: string } | null>(null);
  const [resolve, setResolve] = useState<{ line: LineView; attempt: AttemptView; action: Resolution } | null>(null);
  const [loading, setLoading] = useState(false);
  // Lines saved in this session: the server list catches up after refresh.
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const frozen = s.state === "LOADED" || s.state === "CANCELLED";
  const byTask = new Map<string, AttemptView[]>();
  for (const a of attempts) byTask.set(a.task_id, [...(byTask.get(a.task_id) ?? []), a]);

  /** Marks `from` as saved and returns the next line still to audit (after it, wrapping round), if any. */
  function nextTodo(from: LineView): { line: LineView; left: number } | null {
    const skip = new Set(saved).add(from.task_id);
    setSaved(skip);
    const todo = lines.filter((l) => l.state === "TODO" && !skip.has(l.task_id));
    const line = todo.find((l) => l.seq > from.seq) ?? todo[0];
    return line ? { line, left: todo.length } : null;
  }

  return (
    <div className="space-y-4">
      <Link href={`/audit/picking?date=${s.planned_date}`} className="inline-flex items-center gap-1 text-sm underline"><ArrowLeft className="h-4 w-4" />Semua shipment</Link>
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2"><h2 className="font-cond text-2xl font-semibold">SH {s.shipment_number}</h2><StateBadge state={s.state} /></div>
            <p className="text-sm text-steel-500">NO {s.wave_no} · {fmtDate(s.planned_date)} · truk {s.truck ?? s.planned_truck ?? "–"}</p>
            <p className="text-sm">{fmtNum(s.ok + s.resolved)}/{fmtNum(s.lines)} baris lolos
              {s.todo > 0 && ` · ${fmtNum(s.todo)} belum diaudit`}{s.mismatch > 0 && <span className="text-bad"> · {fmtNum(s.mismatch)} selisih</span>}
              {s.open_tasks > 0 && ` · ${fmtNum(s.open_tasks)} tugas belum dipick`}</p>
          </div>
          {s.state === "LOADED"
            ? <p className="text-sm">Dimuat {s.load_legacy ? "(sebelum audit wajib)" : `${fmtDateTime(s.loaded_at)} oleh ${s.loaded_by_name}`}</p>
            : !frozen && <Button size="lg" disabled={s.state !== "READY_LOAD"} onClick={() => setLoading(true)}
                title={s.state === "READY_LOAD" ? undefined : "Semua baris harus lolos audit dulu"}><Truck className="h-5 w-5" />Muat shipment</Button>}
        </CardContent>
      </Card>
      {s.state === "CANCELLED" && (
        <p role="alert" className="rounded-md bg-bad/10 p-3 text-sm">Wave dibatalkan. Barang yang sudah dipick untuk shipment ini ada di staging:
          kembalikan ke rak dan catat lewat <Link className="underline" href="/adjust">Adjust stok</Link>.</p>
      )}

      <Card>
        <CardContent>
          <Table>
            <thead><tr><Th>#</Th><Th>SKU</Th><Th>Bin asal</Th><Th>Sisa di bin</Th><Th>Picker</Th><Th>Status</Th><Th>Dipick / audit</Th><Th /></tr></thead>
            <tbody>{lines.map((l) => {
              const hist = byTask.get(l.task_id) ?? [];
              const last = hist[hist.length - 1];
              const options = last && l.state === "MISMATCH" ? allowedResolutions(last.errors, last.counted_qty, last.expected_qty) : [];
              return (
                <tr key={l.task_id} className={cn(l.state === "MISMATCH" && "bg-bad/5")}>
                  <Td className="tabular">{l.seq}</Td>
                  <Td><span className="font-semibold">{l.sku}</span><br /><span className="text-xs text-steel-500">{l.description}</span></Td>
                  <Td className="font-semibold">{l.from_bin}</Td>
                  <Td className="tabular">{fmtNum(l.bin_qty)} {l.uom ?? ""}</Td>
                  <Td className="text-xs">{l.picked_by_name ?? "(tidak tercatat)"}
                    {l.bulk_posted && <span className="block text-warn">diposting massal, tanpa scan</span>}</Td>
                  <Td className={cn("text-xs font-semibold", LINE_TONE[l.state])}>{LINE_STATE_LABEL[l.state]}</Td>
                  <Td className="space-y-1 text-xs">
                    {l.picked
                      ? <p>{fmtNum(l.picked.qty)} {l.uom ?? ""} · batch {l.picked.batch || "–"} · exp {fmtDate(l.picked.expiry)}
                          {l.picked.qty !== l.picked.planned_qty && <span className="text-warn"> (rencana {fmtNum(l.picked.planned_qty)}{l.picked.deviation ? `: ${l.picked.deviation}` : ""})</span>}</p>
                      : <p className="text-steel-500">disembunyikan sampai diaudit</p>}
                    {hist.map((a) => <AttemptLine key={a.id} a={a} />)}
                  </Td>
                  <Td className="space-y-1 text-right">
                    {!frozen && (l.state === "TODO" || l.state === "MISMATCH") && (
                      <Button size="sm" variant={l.state === "TODO" ? "default" : "outline"} onClick={() => setAudit({ line: l })}>
                        <ClipboardCheck className="h-4 w-4" />{l.state === "TODO" ? "Audit" : "Audit ulang"}
                      </Button>
                    )}
                    {!frozen && supervisor && last && options.map((action) => (
                      <Button key={action} size="sm" variant="outline" onClick={() => setResolve({ line: l, attempt: last, action })}>{RESOLUTION_LABEL[action]}</Button>
                    ))}
                  </Td>
                </tr>
              );
            })}</tbody>
          </Table>
        </CardContent>
      </Card>

      {audit && <AuditDialog key={audit.line.task_id} line={audit.line} flash={audit.flash} next={nextTodo}
        onOpen={(line, flash) => setAudit({ line, flash })} onClose={() => setAudit(null)} />}
      {resolve && <ResolveDialog {...resolve} onClose={() => setResolve(null)} />}
      {loading && <LoadDialog shipment={s} onClose={() => setLoading(false)} />}
    </div>
  );
}

function AttemptLine({ a }: { a: AttemptView }) {
  return (
    <div className="rounded border border-steel-100 p-1.5">
      <p>
        {a.result === "OK"
          ? <span className="inline-flex items-center gap-1 font-semibold text-ok"><CheckCircle2 className="h-3.5 w-3.5" />OK</span>
          : <span className="inline-flex items-center gap-1 font-semibold text-bad"><XCircle className="h-3.5 w-3.5" />{a.errors.map((e) => PICK_ERROR_LABEL[e]).join(", ")}</span>}
        {" "}· audit {a.attempt_no}{a.legacy ? " (lama)" : ""} · {a.checker_name} · {fmtDateTime(a.created_at)}
      </p>
      {a.result === "MISMATCH" && (
        <p className="text-steel-700">ditemukan {a.found_sku} · {fmtNum(a.counted_qty)} · batch {a.found_batch || "–"}{a.found_expiry ? ` · exp ${fmtDate(a.found_expiry)}` : ""}{a.damaged ? " · rusak" : ""}</p>
      )}
      {a.note && <p className="text-steel-700">{a.note}</p>}
      {a.resolution && <p className="text-warn">{RESOLUTION_LABEL[a.resolution]} oleh {a.resolved_by_name} · {fmtDateTime(a.resolved_at)}: {a.resolution_note}</p>}
    </div>
  );
}

/**
 * One line's audit. An OK save goes straight on to the next line still to
 * audit (checker name kept, cursor on the scan field); a mismatch stops and
 * shows the difference, with a button to carry on.
 */
function AuditDialog({ line, flash, next, onOpen, onClose }: {
  line: LineView; flash?: string;
  next: (from: LineView) => { line: LineView; left: number } | null;
  onOpen: (line: LineView, flash: string) => void; onClose: () => void;
}) {
  const router = useRouter();
  const [checker, setChecker] = usePersonName();
  const [skuInput, setSkuInput] = useState("");
  const [found, setFound] = useState<{ code: string; sku: string } | null>(null);
  const [batch, setBatch] = useState("");
  const [expiry, setExpiry] = useState("");
  const [counted, setCounted] = useState("");
  const [damaged, setDamaged] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SaveResult | null>(null);
  const [upNext, setUpNext] = useState<{ line: LineView; left: number } | null>(null);
  const batchRef = useRef<HTMLInputElement>(null);
  const countRef = useRef<HTMLInputElement>(null);

  const n = Number(counted);
  const valid = checker.trim().length >= 2 && !!found && counted.trim() !== "" && Number.isFinite(n) && n >= 0;
  const hint = expectedExpiry(batch);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return setError("Isi nama checker, scan karton / SKU dan jumlah karton.");
    setBusy(true); setError(null);
    const { data, error } = await createClient().rpc("record_pick_audit", {
      p_task_id: line.task_id, p_checker_name: checker, p_found: found!.code, p_counted: n,
      p_batch: batch, p_expiry: expiry || null, p_damaged: damaged, p_note: note,
    });
    setBusy(false);
    if (error) return setError(error.message);
    const r = data as SaveResult;
    const following = next(line);
    router.refresh();
    if (r.result === "OK" && following) {
      return onOpen(following.line, `#${line.seq} ${line.sku} sesuai · ${following.left} baris lagi`);
    }
    setUpNext(following);
    setSaved(r);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Audit #${line.seq} · ${line.sku}`} description={`${line.description} · dari ${line.from_bin}`}>
        {saved ? <SavedResult r={saved} onClose={onClose}
          next={upNext && { label: `#${upNext.line.seq} ${upNext.line.sku}`, go: () => onOpen(upNext.line, "") }} /> : (
          <form onSubmit={save} className="space-y-4">
            {flash && <p role="status" className="flex items-center gap-1 rounded-md bg-ok/10 p-2 text-sm font-semibold text-ok"><CheckCircle2 className="h-4 w-4" />{flash}</p>}
            <p className="rounded-md bg-plate/30 p-3 text-sm">Hitung dan catat apa yang ada di palet. Jumlah dan batch dari picker tidak ditampilkan.</p>
            <PersonNameField value={checker} onChange={setChecker} label="Nama checker (bukan picker baris ini)" id="checker" />
            <div>
              <Label htmlFor="found">Scan karton / ketik SKU yang ada di palet</Label>
              <ItemScanInput id="found" value={skuInput} autoFocus
                onChange={(v) => { setSkuInput(v); if (found && v !== found.sku && v !== found.code) setFound(null); }}
                onItem={(it, code) => { setFound(it ? { code, sku: it.sku } : null); if (it) batchRef.current?.focus(); }} />
              {found && <p className="mt-1 text-xs font-semibold text-ok">Terbaca: {found.sku}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="batch">Batch di karton</Label>
                <Input id="batch" ref={batchRef} value={batch}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); countRef.current?.focus(); } }} onChange={(e) => setBatch(e.target.value)} placeholder="mis. 14H26JJ" autoCapitalize="characters" />
              </div>
              <div>
                <Label htmlFor="expiry">Expired (kalau tercetak)</Label>
                <Input id="expiry" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
                {hint && !expiry && <button type="button" className="mt-1 text-xs underline" onClick={() => setExpiry(hint)}>perkiraan dari batch: {fmtDate(hint)}</button>}
              </div>
            </div>
            <div>
              <Label htmlFor="counted">Jumlah karton dihitung</Label>
              <Input id="counted" ref={countRef} type="number" inputMode="numeric" min={0} step="any" value={counted} onChange={(e) => setCounted(e.target.value)} required />
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={damaged} onChange={(e) => setDamaged(e.target.checked)} />Ada karton rusak</label>
            <div>
              <Label htmlFor="note">Catatan (wajib bila tidak sesuai)</Label>
              <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. 2 karton penyok, label batch pudar" />
            </div>
            {error && <p role="alert" className="rounded-md bg-bad/10 p-2 text-sm text-bad">{error}</p>}
            <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? "Menyimpan…" : "Simpan audit"}</Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SavedResult({ r, onClose, next }: { r: SaveResult; onClose: () => void; next: { label: string; go: () => void } | null }) {
  const rows: [string, string, string][] = [
    ["SKU", r.found.sku, r.expected.sku],
    ["Batch", r.found.batch || "–", r.expected.batch || "–"],
    ["Expired", fmtDate(r.found.expiry), fmtDate(r.expected.expiry)],
    ["Jumlah", fmtNum(r.found.qty), fmtNum(r.expected.qty)],
  ];
  return (
    <div className="space-y-4">
      <p className={cn("rounded-md p-3 text-base font-semibold", r.result === "OK" ? "bg-ok/10 text-ok" : "bg-bad/10 text-bad")}>
        {r.result === "OK" ? "Sesuai. Baris lolos audit." : `Selisih: ${r.errors.map((e) => PICK_ERROR_LABEL[e]).join(", ")}`}
      </p>
      <Table>
        <thead><tr><Th /><Th>Di palet</Th><Th>Dilaporkan picker</Th></tr></thead>
        <tbody>{rows.map(([k, f, x]) => (
          <tr key={k} className={cn(f !== x && k !== "Expired" && "text-bad")}><Td>{k}</Td><Td className="font-semibold">{f}</Td><Td>{x}</Td></tr>
        ))}</tbody>
      </Table>
      {r.found.damaged && <p className="text-sm text-bad">Ada karton rusak: ganti dengan karton baik.</p>}
      {r.result === "MISMATCH" && (
        <p className="text-sm">Perbaiki di lantai: ambil yang kurang, kembalikan yang lebih, tukar barang atau batch yang salah. Setelah itu audit ulang.
          Supervisor bisa menerima kurang atau batch lain bila memang itu yang dikirim.</p>
      )}
      {next && <Button size="lg" className="w-full" onClick={next.go}>Lanjut: {next.label}</Button>}
      <Button size="lg" variant={next ? "outline" : "default"} className="w-full" onClick={onClose}>Tutup</Button>
    </div>
  );
}

function ResolveDialog({ line, attempt: a, action, onClose }: { line: LineView; attempt: AttemptView; action: Resolution; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [bin, setBin] = useState(line.from_bin);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const short = a.expected_qty - a.counted_qty;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await createClient().rpc("resolve_pick_mismatch", {
      p_audit_id: a.id, p_action: action, p_by_name: name, p_note: note, p_bin: action === "ACCEPT_BATCH" ? bin : null,
    });
    setBusy(false);
    if (error) return setError(error.message);
    router.refresh();
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`${RESOLUTION_LABEL[action]} · #${line.seq} ${line.sku}`} description={`Audit ${a.attempt_no} oleh ${a.checker_name}`}>
        <form onSubmit={save} className="space-y-4">
          <p className="rounded-md bg-plate/30 p-3 text-sm">
            {action === "ACCEPT_SHORT"
              ? `Kirim ${fmtNum(a.counted_qty)} dari ${fmtNum(a.expected_qty)}. ${fmtNum(short)} karton dicatat kembali di ${line.from_bin} (batch ${a.expected_batch || "–"}) dan bin itu dijadwalkan hitung ulang.`
              : `Kirim batch ${a.found_batch} yang ada di palet. Batch ${a.expected_batch || "–"} dicatat kembali di ${line.from_bin}; batch ${a.found_batch} dikurangi dari bin di bawah. ${line.from_bin} dijadwalkan hitung ulang.`}
          </p>
          <OtherPersonField value={name} onChange={setName} label="Nama supervisor (bukan picker / checker)" id="resolver" notSameAs={a.checker_name} />
          {action === "ACCEPT_BATCH" && (
            <div>
              <Label htmlFor="bin">Bin asal batch {a.found_batch}</Label>
              <Input id="bin" value={bin} onChange={(e) => setBin(e.target.value.toUpperCase())} required />
            </div>
          )}
          <div>
            <Label htmlFor="rnote">Alasan (wajib)</Label>
            <Input id="rnote" value={note} onChange={(e) => setNote(e.target.value)} required placeholder="mis. stok memang habis, pelanggan setuju" />
          </div>
          {error && <p role="alert" className="rounded-md bg-bad/10 p-2 text-sm text-bad">{error}</p>}
          <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? "Menyimpan…" : RESOLUTION_LABEL[action]}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LoadDialog({ shipment: s, onClose }: { shipment: ShipmentRow; onClose: () => void }) {
  const router = useRouter();
  const [person, setPerson] = usePersonName();
  const [truck, setTruck] = useState(s.planned_truck ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await createClient().rpc("mark_shipment_loaded", {
      p_wave_id: s.wave_id, p_shipment: s.shipment_number, p_by_name: person, p_truck: truck,
    });
    setBusy(false);
    if (error) return setError(error.message);
    router.refresh();
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Muat shipment ${s.shipment_number}`} description={`${fmtNum(s.lines)} baris, semua lolos audit`}>
        <form onSubmit={save} className="space-y-4">
          <p className="rounded-md bg-plate/30 p-3 text-sm">Setelah dimuat, shipment ini tidak bisa diaudit atau diubah lagi.</p>
          <PersonNameField value={person} onChange={setPerson} label="Nama petugas muat" id="loader" />
          <div>
            <Label htmlFor="truck">Truk / nomor polisi</Label>
            <Input id="truck" value={truck} onChange={(e) => setTruck(e.target.value)} placeholder="mis. B 1234 XY" />
          </div>
          {error && <p role="alert" className="rounded-md bg-bad/10 p-2 text-sm text-bad">{error}</p>}
          <Button type="submit" size="lg" className="w-full" disabled={busy}><Truck className="h-5 w-5" />{busy ? "Menyimpan…" : "Muat"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
