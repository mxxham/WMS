"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, PackagePlus, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Pill } from "@/components/ckb/ui";
import { callRpc } from "@/components/ckb/rpc-button";
import { EvidencePanel, type EvidenceRow } from "@/components/ckb/evidence-panel";
import { TASK_STATUS, countOpen, parseCountInput, type StocktakeStatus } from "@/lib/ckb/stocktake";
import type { TaskRow } from "@/lib/ckb/stocktake-data";
import { cn, fmtDate, fmtNum } from "@/lib/utils";

type Filter = "todo" | "recount" | "all";
const newKey = () => crypto.randomUUID();

/**
 * Counting on a phone. One card per stock identity; the search box doubles as the scanner input
 * (a hardware scanner types the bin code and Enter). Every submission carries a key made when the
 * form opened, so a retry after a dropped connection cannot count twice (ckb_submit_count).
 */
export function CountClient({ sessionId, sessionStatus, tasks, evidence, me, lead, canCount }: {
  sessionId: string; sessionStatus: StocktakeStatus; tasks: TaskRow[]; evidence: (EvidenceRow & { entity_id: string })[];
  me: string; lead: boolean; canCount: boolean;
}) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>(sessionStatus === "REVIEW" ? "recount" : "todo");
  const [openId, setOpenId] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const term = q.trim().toUpperCase();
  const shown = useMemo(() => tasks.filter((t) =>
    (filter === "all" || (filter === "recount" ? t.status === "RECOUNT_REQUESTED" : t.status === "OPEN" || t.status === "RECOUNT_REQUESTED"))
    && (!term || t.storage_bin.includes(term) || t.material_code.toUpperCase().includes(term) || t.description.toUpperCase().includes(term))), [tasks, filter, term]);
  const todo = tasks.filter((t) => t.status === "OPEN" || t.status === "RECOUNT_REQUESTED").length;

  return (
    <div className="space-y-3">
      <div className="sticky top-0 z-10 -mx-4 space-y-2 bg-ckb-tint/25 px-4 py-2 backdrop-blur">
        <div className="relative">
          <ScanLine className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-steel-500" aria-hidden="true" />
          <Input ref={search} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Scan atau ketik bin / material" placeholder="Scan atau ketik bin / material"
            className="h-11 pl-9 text-base" autoCapitalize="characters" enterKeyHint="search"
            onKeyDown={(e) => { if (e.key === "Enter" && shown.length === 1) setOpenId(shown[0].id); }} />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {([["todo", `Belum dihitung (${todo})`], ["recount", "Hitung ulang"], ["all", `Semua (${tasks.length})`]] as [Filter, string][]).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setFilter(k)} aria-pressed={filter === k}
              className={cn("min-h-9 rounded-full px-3 ring-1", filter === k ? "bg-ckb text-white ring-ckb" : "bg-white ring-steel-300 hover:bg-steel-100")}>{l}</button>
          ))}
          {canCount && sessionStatus === "COUNTING" && <FoundItem sessionId={sessionId} />}
        </div>
      </div>
      {shown.length === 0 && <p className="py-8 text-center text-sm text-steel-500">{todo === 0 ? "Semua tugas sudah dihitung." : "Tidak ada tugas yang cocok."}</p>}
      <ul className="space-y-2">
        {shown.map((t) => (
          <TaskCard key={t.id} t={t} open={openId === t.id} onToggle={() => setOpenId(openId === t.id ? null : t.id)}
            canCount={canCount && countOpen(sessionStatus, t.status)} evidence={evidence.filter((e) => e.entity_id === t.id)} me={me} lead={lead}
            onDone={() => { setOpenId(null); setQ(""); search.current?.focus(); }} />
        ))}
      </ul>
    </div>
  );
}

function TaskCard({ t, open, onToggle, canCount, evidence, me, lead, onDone }: {
  t: TaskRow; open: boolean; onToggle: () => void; canCount: boolean; evidence: EvidenceRow[]; me: string; lead: boolean; onDone: () => void;
}) {
  const router = useRouter();
  const [raw, setRaw] = useState("");
  const [batchOk, setBatchOk] = useState<boolean | null>(null);
  const [expiryOk, setExpiryOk] = useState<boolean | null>(null);
  const [obsBatch, setObsBatch] = useState("");
  const [obsExpiry, setObsExpiry] = useState("");
  const [note, setNote] = useState("");
  const [key, setKey] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = parseCountInput(raw);

  async function submit() {
    if (!parsed) { setError("Isi qty. Kosong berarti belum dihitung; isi 0 jika bin kosong."); return; }
    if ("error" in parsed) { setError(parsed.error); return; }
    setBusy(true); setError(null);
    const [, err] = await callRpc("ckb_submit_count", {
      p_task: t.id, p_qty: parsed.qty, p_batch_ok: t.batch ? batchOk : null, p_expiry_ok: t.expiry_date ? expiryOk : null,
      p_observed_batch: obsBatch || null, p_observed_expiry: obsExpiry || null, p_note: note || null, p_client_key: key,
    });
    setBusy(false);
    if (err) { setError(err); return; }
    setKey(newKey()); setRaw(""); setNote(""); setBatchOk(null); setExpiryOk(null); setObsBatch(""); setObsExpiry("");
    onDone(); router.refresh();
  }

  const tri = (v: boolean | null, set: (v: boolean | null) => void, label: string) => (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-20 text-steel-500">{label}</span>
      {([[true, "Sesuai"], [false, "Beda"]] as [boolean, string][]).map(([val, l]) => (
        <button key={l} type="button" onClick={() => set(v === val ? null : val)} aria-pressed={v === val}
          className={cn("min-h-9 rounded-md px-3 ring-1", v === val ? (val ? "bg-ok text-white ring-ok" : "bg-bad text-white ring-bad") : "bg-white ring-steel-300")}>{l}</button>
      ))}
    </div>
  );

  return (
    <li className={cn("rounded-lg border bg-white", open ? "border-ckb ring-2 ring-ckb/30" : "border-steel-100")}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-3 p-3 text-left">
        <span className="rounded-plate bg-plate px-2 py-1 font-cond text-lg font-bold leading-none text-steel">{t.storage_bin || "–"}</span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{t.material_code}{t.origin === "FOUND" && <span className="ml-1 text-xs text-warn">temuan</span>}</span>
          <span className="block truncate text-sm text-steel-500">{t.description}</span>
          <span className="block text-xs text-steel-500">{t.batch ? `Batch ${t.batch}` : "Tanpa batch"}{t.expiry_date ? ` · exp ${fmtDate(t.expiry_date)}` : ""} · {t.uom}
            {t.baseline_qty !== null && ` · SAP ${fmtNum(Number(t.baseline_qty), 3)}`}</span>
        </span>
        <span className="flex flex-col items-end gap-1">
          <Pill tone={TASK_STATUS[t.status].tone}>{TASK_STATUS[t.status].label}</Pill>
          {t.latest_qty !== null && <span className="text-xs text-steel-500">terakhir {fmtNum(Number(t.latest_qty), 3)}</span>}
          <ChevronDown className={cn("h-4 w-4 text-steel-500 transition-transform", open && "rotate-180")} aria-hidden="true" />
        </span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-steel-100 p-3">
          {t.identity_issue && <p className="text-sm text-warn">SAP mencatat material ini di {t.baseline_rows} baris dengan identitas yang sama. Hitung semuanya bersama.</p>}
          {t.status === "RECOUNT_REQUESTED" && <p className="text-sm text-warn">Hitung ulang putaran {t.round}. Hitung dari awal, jangan menyalin angka sebelumnya.</p>}
          {canCount ? (
            <>
              <div>
                <Label htmlFor={`q-${t.id}`}>Qty fisik ({t.uom})</Label>
                <Input id={`q-${t.id}`} inputMode="decimal" autoComplete="off" value={raw} onChange={(e) => setRaw(e.target.value)} className="h-14 text-2xl tabular" placeholder="0"
                  onKeyDown={(e) => { if (e.key === "Enter") submit(); }} autoFocus />
                <p className="mt-1 text-xs text-steel-500">Kosong = belum dihitung. Isi 0 jika barang tidak ada. Desimal pakai koma.</p>
              </div>
              {(t.batch || t.expiry_date) && (
                <div className="space-y-2">
                  {t.batch && tri(batchOk, setBatchOk, "Batch")}
                  {t.expiry_date && tri(expiryOk, setExpiryOk, "Expired")}
                  {(batchOk === false || expiryOk === false) && (
                    <div className="grid grid-cols-2 gap-2">
                      {batchOk === false && <div><Label htmlFor={`ob-${t.id}`} className="text-xs">Batch terlihat</Label><Input id={`ob-${t.id}`} value={obsBatch} onChange={(e) => setObsBatch(e.target.value)} /></div>}
                      {expiryOk === false && <div><Label htmlFor={`oe-${t.id}`} className="text-xs">Expired terlihat</Label><Input id={`oe-${t.id}`} type="date" value={obsExpiry} onChange={(e) => setObsExpiry(e.target.value)} /></div>}
                    </div>
                  )}
                </div>
              )}
              <div><Label htmlFor={`n-${t.id}`}>Catatan{batchOk === false || expiryOk === false ? " (wajib)" : ""}</Label><Input id={`n-${t.id}`} value={note} onChange={(e) => setNote(e.target.value)} /></div>
              {error && <p role="alert" className="text-sm text-bad">{error}</p>}
              <Button size="lg" className="w-full" onClick={submit} disabled={busy || raw.trim() === ""}><Check className="h-5 w-5" />{busy ? "Mengirim…" : `Kirim ${parsed && "qty" in parsed ? fmtNum(parsed.qty, 3) : ""} ${t.uom}`}</Button>
            </>
          ) : <p className="text-sm text-steel-500">Tugas ini tidak bisa dihitung sekarang.</p>}
          <details>
            <summary className="cursor-pointer text-sm text-ckb">Foto bukti ({evidence.length})</summary>
            <div className="mt-2"><EvidencePanel entityType="COUNT_TASK" entityId={t.id} rows={evidence} canUpload={canCount || lead} me={me} lead={lead} defaultKind="DISCREPANCY" /></div>
          </details>
        </div>
      )}
    </li>
  );
}

/** Stock on the floor that is not on the list: a new task with its count (ckb_add_found_item). */
function FoundItem({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(fd: FormData) {
    const parsed = parseCountInput(String(fd.get("qty") ?? ""));
    if (!parsed || "error" in parsed) { setError(parsed && "error" in parsed ? parsed.error : "Isi qty."); return; }
    setBusy(true); setError(null);
    const s = (k: string) => String(fd.get(k) ?? "").trim();
    const [, err] = await callRpc("ckb_add_found_item", {
      p_stocktake: sessionId, p_material: s("material"), p_description: s("description"), p_bin: s("bin"), p_batch: s("batch"),
      p_expiry: s("expiry") || null, p_uom: s("uom"), p_qty: parsed.qty, p_note: s("note"), p_client_key: key,
    });
    setBusy(false);
    if (err) { setError(err); return; }
    setKey(newKey()); setOpen(false); router.refresh();
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setError(null); }}>
      <DialogTrigger asChild><Button size="sm" variant="outline" className="ml-auto"><PackagePlus className="h-4 w-4" />Barang temuan</Button></DialogTrigger>
      <DialogContent title="Barang temuan" description="Barang ada di bin tetapi tidak ada di daftar hitung.">
        <form action={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div><Label htmlFor="f-bin">Bin</Label><Input id="f-bin" name="bin" required autoCapitalize="characters" /></div>
            <div><Label htmlFor="f-mat">Material</Label><Input id="f-mat" name="material" required autoCapitalize="characters" /></div>
          </div>
          <div><Label htmlFor="f-desc">Deskripsi</Label><Input id="f-desc" name="description" /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label htmlFor="f-batch">Batch</Label><Input id="f-batch" name="batch" /></div>
            <div><Label htmlFor="f-exp">Expired</Label><Input id="f-exp" name="expiry" type="date" /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label htmlFor="f-qty">Qty</Label><Input id="f-qty" name="qty" inputMode="decimal" required /></div>
            <div><Label htmlFor="f-uom">Satuan</Label><Input id="f-uom" name="uom" required autoCapitalize="characters" placeholder="BAG" /></div>
          </div>
          <div><Label htmlFor="f-note">Catatan</Label><Input id="f-note" name="note" /></div>
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Batal</Button>
            <Button type="submit" disabled={busy}>{busy ? "Mengirim…" : "Catat temuan"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
