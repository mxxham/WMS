"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/input";
import { cn, fmtDate, fmtNum } from "@/lib/utils";
import { ItemScanInput } from "@/components/app/item-scan-input";
import { PersonNameField, usePersonName } from "@/components/app/person-name";
import { binDistance, distanceLabel, parseBin, type BinParts } from "@/lib/bin-distance";
import { DEFAULT_CONFIG } from "@/lib/allocator/config";
import type { TaskRow } from "@/lib/allocator/picklist-from-tasks";

type Source = { bin_code: string; batch_lot: string; expiry_date: string | null; quantity: number };
/** Other open tasks of this SKU taking from / bringing into a bin + batch: what that stock is already promised to. */
type Claim = { reserved: number; incoming: number; by: string[] };
const srcKey = (bin: string, batch: string, expiry: string | null) => `${bin}|${batch}|${(expiry ?? "").slice(0, 10)}`;
type Fefo = "planned" | "same" | "earlier" | "later" | "none";

/** Where a candidate bin stands against the planned expiry (FEFO: earliest first). */
function fefoOf(s: Source, plannedExpiry: string, isPlanned: boolean): Fefo {
  if (isPlanned) return "planned";
  if (!s.expiry_date) return "none";
  const d = s.expiry_date.slice(0, 10), p = plannedExpiry.slice(0, 10);
  return d === p ? "same" : d < p ? "earlier" : "later";
}
const GROUPS: { key: Fefo; label: string }[] = [
  { key: "planned", label: "Rencana" },
  { key: "same", label: "FEFO sama (expired sama dengan rencana)" },
  { key: "earlier", label: "Expired lebih awal (FEFO: boleh, ambil ini dulu)" },
  { key: "later", label: "Expired lebih lama (melanggar FEFO)" },
  { key: "none", label: "Tanpa tanggal expired" },
];

type Target = { bin: string; note: string };

/** Where a pick's leftover can go: the SKU's pickface, then the nearest empty Level-A bins (0045). */
async function moveTargets(from: string, sku: string): Promise<Target[]> {
  const db = createClient();
  const [{ data: pf }, { data: empty }] = await Promise.all([
    db.from("pickface_detail").select("bin_code").eq("sku", sku),
    db.from("empty_bins").select("bin_code, zone, rack, level, position").eq("level", "A").range(0, 2999),
  ]);
  const src = parseBin(from);
  const near = src ? ((empty ?? []) as (BinParts & { bin_code: string })[]).filter((b) => !DEFAULT_CONFIG.blockedBins.includes(b.bin_code))
    .map((b) => ({ b, d: binDistance(src, b) })).sort((a, c) => a.d - c.d).slice(0, 5)
    .map(({ b }) => ({ bin: b.bin_code, note: `kosong · ${distanceLabel(src, b)}` })) : [];
  const pfs = ((pf ?? []) as { bin_code: string }[]).filter((p) => p.bin_code !== from)
    .map((p) => ({ bin: p.bin_code, note: "pickface SKU ini" }));
  return [...pfs, ...near].filter((t) => t.bin !== from);
}

/** The move qty while typing: a number inside 0..max. Empty (or 0) means "no move". */
function clampQty(v: string, max: number): string {
  if (v.trim() === "") return "";
  const q = Number(v);
  return Number.isFinite(q) ? String(Math.min(Math.max(q, 0), max)) : "";
}

/**
 * Confirms one task. Default: done exactly as planned. "Berbeda" records
 * what the picker really did — fewer cartons, or another bin/batch — with a
 * reason; the ledger then moves the real stock, not the planned stock.
 */
export function TaskPostDialog({ task: t, onDone }: { task: TaskRow; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [different, setDifferent] = useState(false);
  const [qty, setQty] = useState(String(t.quantity));
  const [sources, setSources] = useState<Source[] | null>(null);
  const [claims, setClaims] = useState<Map<string, Claim>>(new Map());
  // "Bin lain": a bin the books do not list for this SKU (0039).
  const [otherBin, setOtherBin] = useState("");
  const [otherHave, setOtherHave] = useState<number | null>(null);
  async function lookOther(code: string) {
    setOtherBin(code); setOtherHave(null);
    const c = code.trim().toUpperCase();
    if (!/^[A-Z0-9_]{3,20}$/.test(c)) return;
    const { data } = await createClient().from("inventory_detail").select("quantity")
      .eq("bin_code", c).eq("sku", t.sku).eq("batch_lot", t.batch_lot);
    setOtherHave((data ?? []).reduce((a, r) => a + Number(r.quantity), 0));
  }
  const [source, setSource] = useState("0");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [person, setPerson] = usePersonName();
  const [scan, setScan] = useState("");
  const [scanned, setScanned] = useState<string | null>(null);
  // Scan rules: whether this SKU has a barcode and whether the policy requires the scan.
  const [scanRule, setScanRule] = useState<{ hasEan: boolean; required: boolean } | null>(null);
  // Optional Bin To Bin (0045) offered with the pick: where what the chosen source keeps goes.
  const [moveTo, setMoveTo] = useState("");
  const [moveQty, setMoveQty] = useState("");
  const [moveSuggest, setMoveSuggest] = useState<Target[]>([]);
  const [moveLoaded, setMoveLoaded] = useState(false);
  const moveTouched = useRef(false);
  // Relocation of a broken pallet's rest: what is really left of this batch in the bin now (0033).
  const relocate = t.task_type !== "PICK";
  const [left, setLeft] = useState<number | null>(null);
  async function loadLeft() {
    if (!relocate) return;
    const { data } = await createClient().from("inventory_detail").select("quantity")
      .eq("bin_code", t.from_bin).eq("sku", t.sku).eq("batch_lot", t.batch_lot);
    setLeft((data ?? []).reduce((a, r) => a + Number(r.quantity), 0));
  }
  async function loadScanRule() {
    const db = createClient();
    const [{ data: item }, { data: pol }] = await Promise.all([db.from("items").select("ean").eq("sku", t.sku).maybeSingle(), db.rpc("inventory_policy")]);
    const hasEan = !!item?.ean;
    setScanRule({ hasEan, required: hasEan && t.task_type === "PICK" && !!(pol as { require_scan_on_pick?: boolean } | null)?.require_scan_on_pick });
  }

  const planned = `${t.from_bin}|${t.batch_lot}|${t.expiry_date}`;
  const what = t.task_type === "PICK"
    ? `Ambil ${fmtNum(Number(t.quantity))} ${t.uom ?? ""} SKU ${t.sku} batch ${t.batch_lot || "–"} dari ${t.from_bin} untuk shipment ${t.shipment_number}.`
    : `Pindahkan ${fmtNum(Number(t.quantity))} ${t.uom ?? ""} SKU ${t.sku} batch ${t.batch_lot || "–"} dari ${t.from_bin} ke pickface ${t.to_bin}.`;

  async function loadSources() {
    // Every bin currently holding this SKU; the planned one first, the rest
    // grouped against the planned expiry in the list below.
    const { data } = await createClient().from("inventory_detail")
      .select("bin_code, batch_lot, expiry_date, quantity").eq("sku", t.sku).gt("quantity", 0)
      .order("expiry_date", { ascending: true, nullsFirst: false }).order("bin_code");
    const rows = (data ?? []) as Source[];
    // What each bin's stock is already planned for: the other open tasks of this SKU (any wave).
    const { data: open } = await createClient().from("pick_task_detail")
      .select("id, wave_no, seq, shipment_number, task_type, from_bin, to_bin, batch_lot, expiry_date, quantity")
      .eq("sku", t.sku).eq("status", "PLANNED").in("wave_status", ["PENDING", "RESCHEDULED"]);
    const c = new Map<string, Claim>();
    const claim = (k: string) => c.get(k) ?? c.set(k, { reserved: 0, incoming: 0, by: [] }).get(k)!;
    for (const o of (open ?? []) as { id: string; wave_no: string; seq: number; shipment_number: string | null; task_type: string; from_bin: string; to_bin: string | null; batch_lot: string; expiry_date: string | null; quantity: number }[]) {
      if (o.id === t.id) continue;
      const out = claim(srcKey(o.from_bin, o.batch_lot, o.expiry_date));
      out.reserved += Number(o.quantity);
      out.by.push(`NO ${o.wave_no} #${o.seq}${o.task_type === "PICK" ? ` SH ${o.shipment_number}` : " relokasi"} ${fmtNum(Number(o.quantity))}`);
      if (o.to_bin) claim(srcKey(o.to_bin, o.batch_lot, o.expiry_date)).incoming += Number(o.quantity);
    }
    setClaims(c);
    const idx = rows.findIndex((r) => `${r.bin_code}|${r.batch_lot}|${r.expiry_date}` === planned);
    const ordered = idx >= 0 ? [rows[idx], ...rows.filter((_, i) => i !== idx)]
      : [{ bin_code: t.from_bin, batch_lot: t.batch_lot, expiry_date: t.expiry_date, quantity: 0 }, ...rows];
    setSources(ordered); setSource("0");
  }

  async function submit() {
    setBusy(true); setError(null);
    // The optional Bin To Bin runs only after the pick itself posted: the pick is
    // never rolled back for it, and a failure here is reported, never swallowed.
    const dest = moveTo.trim().toUpperCase();
    const moveQtyN = Math.min(Math.max(Number(moveQty) || 0, 0), leftover);
    const doMove = showMove && moveQtyN > 0 && /^[A-Z0-9_]{3,20}$/.test(dest) && dest !== srcBin;
    async function afterPost() {
      if (!doMove) { setBusy(false); setOpen(false); onDone(); return; }
      const { error: moveErr } = await createClient().rpc("add_relocation", {
        p_task_id: t.id, p_to_bin: dest, p_qty: moveQtyN, p_by_name: person, p_reason: reason.trim(),
      });
      setBusy(false);
      if (moveErr) {
        setError(`Pick sudah diposting, Bin To Bin gagal: ${moveErr.message}`);
        onDone();
        return;
      }
      setOpen(false); onDone();
    }
    if (different && source === "other") {
      const { error } = await createClient().rpc("post_task_found_elsewhere", {
        p_task_id: t.id, p_bin: otherBin.trim().toUpperCase(), p_qty: Number(qty), p_reason: reason.trim(), p_by_name: person, p_scanned: scanned,
      });
      if (error) { setBusy(false); return setError(error.message); }
      return afterPost();
    }
    const args: Record<string, unknown> = { p_task_id: t.id, p_by_name: person, p_scanned: scanned };
    if (different) {
      const src = sources?.[Number(source)];
      args.p_actual_qty = Number(qty);
      if (src) { args.p_from_bin = src.bin_code; args.p_batch_lot = src.batch_lot; args.p_expiry = src.expiry_date; }
      args.p_reason = reason.trim();
    }
    const { error } = await createClient().rpc("post_task_by", args);
    if (error) { setBusy(false); return setError(error.message); }
    return afterPost();
  }

  const fefo = (sources ?? []).map((s, i) => fefoOf(s, t.expiry_date, i === 0));
  const picked = fefo[Number(source)];
  const claimOf = (s: Source) => claims.get(srcKey(s.bin_code, s.batch_lot, s.expiry_date));
  const freeOf = (s: Source) => Number(s.quantity) - (claimOf(s)?.reserved ?? 0);
  const chosen = sources?.[Number(source)];
  const chosenClaim = chosen ? claimOf(chosen) : undefined;

  const n = Number(qty);
  // A pick takes at most the planned cartons; a relocation at most what the chosen bin holds.
  const maxQty = relocate ? Number(sources?.[Number(source)]?.quantity ?? left ?? t.quantity) : Number(t.quantity);
  const wrongItem = scanned !== null && scanned !== t.sku;
  // Optional Bin To Bin: only a PICK, only when the chosen source keeps something after this pick.
  const srcBin = source === "other" ? otherBin.trim().toUpperCase() : (chosen?.bin_code ?? "");
  const haveLeft = source === "other" ? otherHave : (chosen ? Number(chosen.quantity) : null);
  const leftover = haveLeft === null || !Number.isFinite(n) ? 0 : Math.max(haveLeft - n, 0);
  const showMove = !relocate && different && n > 0 && leftover > 0;
  const moveDest = moveTo.trim().toUpperCase();
  const moveN = Number(moveQty);
  const wantsMove = showMove && Number.isFinite(moveN) && moveN > 0;
  const moveDestErr = !wantsMove ? null
    : !moveDest ? "Isi bin tujuan, atau kosongkan jumlah sisa."
    : moveDest === srcBin ? `Bin tujuan sama dengan bin asal ${srcBin}.`
    : !/^[A-Z0-9_]{3,20}$/.test(moveDest) ? "Format bin tujuan tidak valid (huruf, angka, atau _)." : null;
  const invalid = (different && (!Number.isFinite(n) || n < 0 || n > maxQty || !reason.trim()))
    || (different && source === "other" && (otherHave === null || n <= 0))
    || person.trim().length < 2 || wrongItem || (!!scanRule?.required && scanned !== t.sku)
    || moveDestErr !== null
    || (showMove && moveQty.trim() !== "" && !Number.isFinite(moveN))
    || (wantsMove && moveN > leftover);

  // The move qty follows the leftover, and clears itself when there is nothing left to move.
  useEffect(() => { setMoveQty(showMove ? String(leftover) : ""); }, [showMove, leftover]);
  // Suggestions follow the chosen source: its rank decides which empty bin is "nearest".
  useEffect(() => {
    if (!showMove || !srcBin) return;
    let live = true;
    void moveTargets(srcBin, t.sku).then((targets) => {
      if (!live) return;
      setMoveSuggest(targets);
      setMoveLoaded(true);
      if (!moveTouched.current) setMoveTo(targets[0]?.bin ?? "");
    });
    return () => { live = false; };
  }, [showMove, srcBin, t.sku]);

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setError(null); if (o) { setDifferent(false); setQty(String(t.quantity)); setReason(""); setScan(""); setScanned(null); setOtherBin(""); setOtherHave(null); setSource("0"); setMoveTo(""); setMoveQty(""); setMoveSuggest([]); setMoveLoaded(false); moveTouched.current = false; loadScanRule(); loadLeft(); } }}>
      <DialogTrigger asChild><Button size="sm">Posting</Button></DialogTrigger>
      <DialogContent title="Posting tugas" description={`NO ${t.wave_no} · #${t.seq}`}>
        <div className="space-y-4">
          <p className="rounded-md bg-plate/30 p-3 text-base">{what}</p>
          {relocate && left !== null && left !== Number(t.quantity) && (
            <div className="space-y-2 rounded-md border-2 border-warn bg-warn/10 p-3 text-sm">
              <p>Sisa batch ini di {t.from_bin} sekarang <b>{fmtNum(left)} {t.uom ?? ""}</b>, rencana pindah {fmtNum(Number(t.quantity))}.
                {left > Number(t.quantity) ? " Pick sebelumnya mengambil kurang dari rencana: pindahkan semua sisa supaya bin kosong." : " Stok di bin kurang dari rencana."}</p>
              {left > 0 && (
                <Button size="sm" variant="plate" onClick={() => {
                  setDifferent(true); setQty(String(left)); setReason("pindahkan semua sisa bin"); if (!sources) loadSources();
                }}>Pindahkan semua sisa ({fmtNum(left)})</Button>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Hasil">
            <Button variant={different ? "outline" : "default"} onClick={() => setDifferent(false)} aria-pressed={!different}>Sesuai rencana</Button>
            <Button variant={different ? "default" : "outline"} aria-pressed={different}
              onClick={() => { setDifferent(true); if (!sources) loadSources(); }}>Berbeda</Button>
          </div>
          {different && (
            <div className="space-y-3">
              <div>
                <Label htmlFor="aq">{relocate ? "Jumlah yang benar-benar dipindah" : "Jumlah yang benar-benar diambil"} (0–{fmtNum(maxQty)})</Label>
                <Input id="aq" type="number" inputMode="numeric" min={0} max={maxQty} value={qty} onChange={(e) => setQty(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="as">Diambil dari</Label>
                <Select id="as" value={source} onChange={(e) => setSource(e.target.value)} disabled={!sources}>
                  {GROUPS.map((g) => {
                    const items = (sources ?? []).map((s, i) => ({ s, i })).filter(({ i }) => fefo[i] === g.key);
                    return items.length === 0 ? null : (
                      <optgroup key={g.key} label={g.label}>
                        {items.map(({ s, i }) => (
                          <option key={i} value={i}>
                            {freeOf(s) > 0 ? "✓" : "⚠"} {s.bin_code} · batch {s.batch_lot || "–"} · exp {fmtDate(s.expiry_date)} · stok {fmtNum(Number(s.quantity))}
                            {claimOf(s)?.reserved ? ` · dipesan ${fmtNum(claimOf(s)!.reserved)} · bebas ${fmtNum(Math.max(freeOf(s), 0))}` : " · bebas semua"}
                            {claimOf(s)?.incoming ? ` · +${fmtNum(claimOf(s)!.incoming)} akan masuk` : ""}
                          </option>
                        ))}
                      </optgroup>
                    );
                  })}
                  {!relocate && <option value="other">Bin lain… (ketik kode bin, tidak ada di daftar)</option>}
                </Select>
                {source === "other" && (
                  <div className="mt-2 space-y-1">
                    <Input value={otherBin} onChange={(e) => lookOther(e.target.value)} placeholder="mis. CB23A01" autoCapitalize="characters" aria-label="Kode bin" />
                    {otherHave !== null && (
                      <p className={cn("rounded-md p-2 text-xs", otherHave >= n ? "bg-plate/30" : "bg-warn/10")}>
                        Tercatat di {otherBin.trim().toUpperCase()}: {fmtNum(otherHave)} (batch {t.batch_lot || "–"}).
                        {otherHave < n && ` Barang rencana ternyata di bin ini: ${fmtNum(n - otherHave)} dicatat pindah dari ${t.from_bin} dulu, lalu pick diposting dari ${otherBin.trim().toUpperCase()}. ${t.from_bin} otomatis dijadwalkan hitung ulang.`}
                      </p>
                    )}
                  </div>
                )}
                {chosen && chosenClaim && chosenClaim.reserved > 0 && (
                  <p className={cn("mt-1 rounded-md p-2 text-xs", freeOf(chosen) < n ? "bg-bad/10 font-semibold text-bad" : "bg-plate/30")}>
                    Stok ini sudah dipesan tugas lain: {chosenClaim.by.join(", ")}.
                    {freeOf(chosen) < n
                      ? ` Bebas hanya ${fmtNum(Math.max(freeOf(chosen), 0))}: mengambil ${fmtNum(n)} dari sini membuat tugas itu kurang. Pilih bin bertanda ✓ bila ada.`
                      : ` Masih bebas ${fmtNum(freeOf(chosen))}.`}
                  </p>
                )}
                {picked === "same" && <p className="mt-1 text-xs text-ok">Expired sama dengan rencana: sesuai FEFO.</p>}
                {picked === "earlier" && <p className="mt-1 text-xs text-ok">Expired lebih awal dari rencana: sesuai FEFO.</p>}
                {picked === "later" && <p className="mt-1 rounded-md bg-warn/10 p-2 text-xs text-warn">Expired lebih lama dari rencana ({fmtDate(t.expiry_date)}): melanggar FEFO. Pakai hanya jika stok yang lebih awal memang tidak ada, dan tulis alasannya.</p>}
                {picked === "none" && <p className="mt-1 rounded-md bg-warn/10 p-2 text-xs text-warn">Stok ini tidak punya tanggal expired: FEFO tidak bisa dicek.</p>}
              </div>
              {showMove && (
                <div className="space-y-2 rounded-md bg-plate/30 p-3 text-sm">
                  <p>
                    Sisa di <b>{srcBin}</b> setelah ambil {fmtNum(n)} {t.uom ?? ""}: <b>{fmtNum(leftover)}</b>.
                    Opsional — tentukan ke mana sisa ini dipindah (Bin To Bin): pick diposting dulu, lalu sisa dipindahkan.
                  </p>
                  {moveSuggest.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {moveSuggest.map((s) => (
                        <Button key={s.bin} size="sm" variant={moveDest === s.bin ? "default" : "outline"} title={s.note}
                          onClick={() => { moveTouched.current = true; setMoveTo(s.bin); }}>
                          {s.bin}<span className="ml-1 text-[10px] font-normal opacity-80">{s.note}</span>
                        </Button>
                      ))}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="mv-to">Ke bin (opsional)</Label>
                      <Input id="mv-to" value={moveTo} autoCapitalize="characters" placeholder={moveLoaded ? "mis. CB12A01" : "memuat saran bin…"}
                        onChange={(e) => { moveTouched.current = true; setMoveTo(e.target.value.toUpperCase()); }} />
                    </div>
                    <div>
                      <Label htmlFor="mv-qty">Jumlah sisa (0–{fmtNum(leftover)})</Label>
                      <Input id="mv-qty" type="number" inputMode="numeric" min={0} max={leftover} value={moveQty}
                        onChange={(e) => setMoveQty(clampQty(e.target.value, leftover))} />
                    </div>
                  </div>
                  {moveDestErr && <p className="rounded-md bg-bad/10 p-2 text-xs text-bad">{moveDestErr}</p>}
                  <p className="text-xs text-steel-500">Kosongkan tujuan atau isi jumlah 0 kalau sisa tidak dipindah.</p>
                </div>
              )}
              <div>
                <Label htmlFor="ar">Alasan (wajib)</Label>
                <Input id="ar" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="mis. karton rusak, palet terhalang" />
              </div>
              <p className="text-xs text-steel-500">Stok dipotong dari bin yang dipilih. Jika wave lain jadi tidak cocok, supervisor bisa menghitung ulang wave yang belum dikerjakan.</p>
            </div>
          )}
          <div>
            <Label htmlFor={`scan-${t.id}`}>Scan barcode karton {scanRule?.required ? "(wajib)" : scanRule?.hasEan ? "(disarankan)" : "(SKU belum punya barcode)"}</Label>
            <ItemScanInput id={`scan-${t.id}`} value={scan} onChange={setScan} onItem={(it) => setScanned(it?.sku ?? null)} placeholder="scan karton / ketik SKU" />
            {scanned === t.sku && <p className="mt-1 text-xs font-semibold text-ok">Barang sesuai: {t.sku}</p>}
            {wrongItem && <p className="mt-1 rounded-md bg-bad/10 p-2 text-sm font-semibold text-bad">Barang salah: yang di-scan {scanned}, tugas ini {t.sku}. Jangan diambil.</p>}
          </div>
          <PersonNameField id={`picker-${t.id}`} value={person} onChange={setPerson} label="Nama picker" />
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="lg" onClick={() => setOpen(false)}>Batal</Button>
            <Button size="lg" onClick={submit} disabled={busy || invalid}>{busy ? "Memproses…" : "Sudah dikerjakan"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
