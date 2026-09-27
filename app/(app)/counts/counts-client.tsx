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
import { Input, Label, Select } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { expectedExpiry, expiryCheck, MISMATCH_LABEL } from "@/lib/batch-code";
import { COUNT_STATUS, MANUAL_REASONS, REASON_CODES, type ReasonCode } from "@/lib/inventory-control";
import { cn, fmtDate, fmtDateTime, fmtNum } from "@/lib/utils";

type Line = { sku: string; batch_lot: string; expiry_date: string | null; quantity: number };
type Round = { round: number; by_name: string; at: string; lines: Line[]; variance: number };
export type CountTask = {
  id: string; bin_code: string; status: "OPEN" | "RECOUNT" | "COUNTED" | "APPLIED" | "CLOSED"; reason: string; source: string;
  expected: (Line & { source?: string; line?: number })[]; counted: Line[] | null; applied_diff: { sku: string; batch_lot: string; expiry_date: string | null; system: number; counted: number }[] | null;
  current: (Line & { description?: string })[];
  created_at: string; created_by_name: string | null; counted_at: string | null; counted_by_name: string | null;
  closed_at: string | null; closed_by_name: string | null; close_note: string | null;
  counts: Round[]; abc_class: string | null; reason_code: string | null; system_qty: number | null; variance_qty: number | null;
  first_variance_qty: number | null; rounds: number;
};

const key = (l: { sku: string; batch_lot: string; expiry_date: string | null }) => `${l.sku}|${l.batch_lot ?? ""}|${(l.expiry_date ?? "").slice(0, 10)}`;
const SOURCE: Record<string, string> = { MANUAL: "Manual", PUTAWAY: "Konflik putaway", DATA_QUALITY: "Kualitas data", CYCLE: "Cycle count", RECON: "Rekonsiliasi SAP", RECEIPT: "Penerimaan" };

export type Schedule = {
  bins: number; due: Record<string, number>; neverCounted: number; countedLast30: number; accurateLast30: number;
  qtyAccuracy: number | null; firstCountAccurate: number; firstCountKnown: number; target: number;
};

/**
 * Counting is blind: the counter records what is in the bin without seeing
 * the system's lines or quantities. A count off from the system goes to a
 * recount by someone else; the supervisor sees every round against the
 * system only when the counts are done.
 */
export function CountsClient({ open, done, supervisor, schedule, shelfLife, defaultShelfLife }: {
  open: CountTask[]; done: CountTask[]; supervisor: boolean; schedule: Schedule; shelfLife: Record<string, number>; defaultShelfLife: number;
}) {
  const router = useRouter();
  const [bin, setBin] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [person, setPerson] = usePersonName();

  async function create() {
    setError(null);
    const { error } = await createClient().rpc("create_count_task", { p_bin_code: bin, p_reason: reason });
    if (error) return setError(error.message);
    setBin(""); setReason(""); router.refresh();
  }

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <ScheduleCard schedule={schedule} openCount={open.length} supervisor={supervisor} />
      <PersonNameField className="max-w-xs" value={person} onChange={setPerson} label="Nama Anda (penghitung / penyetuju)" />
      {supervisor && (
        <div className="flex flex-wrap items-end gap-3 rounded-lg bg-white p-4">
          <div><Label htmlFor="bin">Bin</Label><Input id="bin" className="w-36 uppercase" value={bin} onChange={(e) => setBin(e.target.value)} placeholder="CA01C01" /></div>
          <div className="min-w-60 flex-1"><Label htmlFor="reason">Alasan</Label><Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="mis. selisih saat picking" /></div>
          <Button onClick={create} disabled={!bin.trim()}><Plus className="h-4 w-4" />Tambah tugas hitung</Button>
          {error && <p role="alert" className="w-full text-sm text-bad">{error}</p>}
        </div>
      )}

      {open.length === 0 && <p className="text-sm text-steel-500">Tidak ada tugas hitung terbuka.</p>}
      {open.map((t) => <TaskCard key={t.id} task={t} supervisor={supervisor} person={person} shelfLife={shelfLife} defaultShelfLife={defaultShelfLife} />)}

      {done.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Selesai (30 terakhir)</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <thead><tr><Th>Bin</Th><Th>Alasan</Th><Th>Hasil</Th><Th>Putaran</Th><Th>Oleh</Th><Th>Waktu</Th></tr></thead>
              <tbody>{done.map((t) => (
                <tr key={t.id}>
                  <Td className="font-semibold"><Link className="underline" href={`/bin/${t.bin_code}`}>{t.bin_code}</Link></Td>
                  <Td className="text-xs">{t.reason}</Td>
                  <Td className="text-xs">{t.status === "APPLIED"
                    ? (t.applied_diff?.length
                      ? `${t.applied_diff.map((d) => `${d.sku}/${d.batch_lot || "–"} ${fmtNum(d.system)}→${fmtNum(d.counted)}`).join("; ")}${t.reason_code ? ` · ${REASON_CODES[t.reason_code as ReasonCode] ?? t.reason_code}` : ""}`
                      : "Sesuai sistem, tanpa selisih")
                    : `Ditutup: ${t.close_note}`}</Td>
                  <Td className="text-xs">{t.rounds > 0 ? `${t.rounds}× (${t.counts.map((c) => c.by_name).join(", ")})` : "–"}</Td>
                  <Td className="text-xs">{t.closed_by_name}</Td><Td className="text-xs">{fmtDateTime(t.closed_at)}</Td>
                </tr>
              ))}</tbody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

type Draft = { sku: string; batch_lot: string; expiry_date: string; quantity: string; expiryOk: boolean };
const emptyDraft = (): Draft => ({ sku: "", batch_lot: "", expiry_date: "", quantity: "", expiryOk: false });

function TaskCard({ task: t, supervisor, person, shelfLife, defaultShelfLife }: {
  task: CountTask; supervisor: boolean; person: string; shelfLife: Record<string, number>; defaultShelfLife: number;
}) {
  const router = useRouter();
  const [counting, setCounting] = useState(t.status !== "COUNTED");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [empty, setEmpty] = useState(false);
  // Blind: nothing pre-filled. The counter writes what is physically in the bin.
  const [lines, setLines] = useState<Draft[]>([emptyDraft()]);
  const set = (i: number, patch: Partial<Draft>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const months = (sku: string) => shelfLife[sku.trim()] ?? defaultShelfLife;
  const earlier = t.counts.map((c) => c.by_name);

  async function submit() {
    setError(null);
    if (person.trim().length < 2) return setError("Isi nama Anda di atas.");
    const filled = empty ? [] : lines.filter((l) => l.sku.trim());
    if (!empty && filled.length === 0) return setError("Catat isi bin, atau centang \"Bin kosong\".");
    const missing = filled.filter((l) => l.quantity.trim() === "");
    if (missing.length) return setError(`Isi qty untuk semua baris: ${missing.map((l) => l.sku).join(", ")}`);
    const bad = filled.find((l) => { const m = expiryCheck(l.batch_lot, l.expiry_date, months(l.sku)); return m && !l.expiryOk; });
    if (bad) return setError(`Expired ${bad.sku} batch ${bad.batch_lot} tidak cocok dengan kode batch: cek label, lalu centang konfirmasi.`);
    setBusy(true);
    const { data, error } = await createClient().rpc("submit_count", {
      p_task_id: t.id, p_by_name: person,
      p_lines: filled.map((l) => ({ sku: l.sku.trim(), batch_lot: l.batch_lot.trim().toUpperCase(), expiry_date: l.expiry_date || null, quantity: Number(l.quantity) })),
    });
    setBusy(false);
    if (error) return setError(error.message);
    setLines([emptyDraft()]); setEmpty(false); setCounting(false);
    if ((data as { status?: string } | null)?.status === "RECOUNT") setError("Tersimpan. Hasil berbeda dengan catatan: bin ini akan dihitung ulang oleh orang lain.");
    router.refresh();
  }

  return (
    <Card className={cn("border-l-4", t.status === "COUNTED" ? "border-plate" : t.status === "RECOUNT" ? "border-bad" : "border-warn")}>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle><Link className="underline" href={`/bin/${t.bin_code}`}>{t.bin_code}</Link> · {COUNT_STATUS[t.status]}</CardTitle>
          <p className="text-xs text-steel-500">{SOURCE[t.source] ?? t.source} · {t.reason} · dibuat {fmtDateTime(t.created_at)}{t.created_by_name && ` oleh ${t.created_by_name}`}
            {t.rounds > 0 && ` · dihitung ${t.rounds}× (terakhir ${fmtDateTime(t.counted_at)})`}</p>
        </div>
        {!counting && <Button size="sm" variant="outline" onClick={() => setCounting(true)}>Hitung lagi</Button>}
      </CardHeader>
      <CardContent className="space-y-3">
        {t.status === "RECOUNT" && (
          <p className="rounded-md bg-bad/10 p-2 text-sm">Hitungan sebelumnya berbeda dengan catatan. Harus dihitung ulang oleh <b>orang lain</b>
            {earlier.length > 0 && <> (bukan {earlier.join(", ")})</>}, tanpa melihat hasil sebelumnya.</p>
        )}

        {counting && (
          <div className="space-y-2">
            <p className="text-sm">Hitung <b>semua</b> isi bin: scan barcode karton atau ketik SKU, tulis batch dan jumlah. Expired terisi dari kode batch bila bisa.</p>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={empty} onChange={(e) => setEmpty(e.target.checked)} />Bin kosong</label>
            {!empty && lines.map((l, i) => {
              const m = expiryCheck(l.batch_lot, l.expiry_date, months(l.sku));
              return (
                <div key={i} className="space-y-1 rounded-md bg-paper p-2">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1.3fr_1fr_10rem_7rem_2.5rem]">
                    <ItemScanInput value={l.sku} onChange={(v) => set(i, { sku: v })} />
                    <Input aria-label="Batch" value={l.batch_lot} placeholder="Batch"
                      onChange={(e) => {
                        const b = e.target.value;
                        const exp = expectedExpiry(b, months(l.sku));
                        set(i, { batch_lot: b, ...(exp && !l.expiry_date ? { expiry_date: exp } : {}), expiryOk: false });
                      }} />
                    <Input aria-label="Expired" type="date" value={l.expiry_date} onChange={(e) => set(i, { expiry_date: e.target.value, expiryOk: false })} />
                    <Input aria-label="Qty" inputMode="numeric" className="font-semibold" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value.replace(/[^\d.]/g, "") })} placeholder="Qty" />
                    <Button size="icon" variant="ghost" aria-label="Hapus baris" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                  {m && (
                    <p className="text-xs text-warn">Batch {l.batch_lot.toUpperCase()} → expired seharusnya {fmtDate(m.expected)} ({MISMATCH_LABEL[m.kind]}).{" "}
                      <button type="button" className="underline" onClick={() => set(i, { expiry_date: m.expected })}>Pakai</button>{" · "}
                      <label className="inline-flex items-center gap-1"><input type="checkbox" checked={l.expiryOk} onChange={(e) => set(i, { expiryOk: e.target.checked })} />label memang begitu</label></p>
                  )}
                </div>
              );
            })}
            <div className="flex flex-wrap gap-2">
              {!empty && <Button size="sm" variant="outline" onClick={() => setLines([...lines, emptyDraft()])}><Plus className="h-4 w-4" />Tambah barang</Button>}
              <Button size="sm" onClick={submit} disabled={busy}>{busy ? "Menyimpan…" : "Simpan hasil hitung"}</Button>
              {t.status === "COUNTED" && <Button size="sm" variant="ghost" onClick={() => setCounting(false)}>Batal</Button>}
            </div>
          </div>
        )}

        {!counting && t.status === "COUNTED" && (supervisor
          ? <Review task={t} person={person} onDone={() => router.refresh()} />
          : <p className="text-sm text-steel-500">Hasil hitung tersimpan. Supervisor akan memeriksa dan menerapkannya.</p>)}

        {supervisor && t.status !== "COUNTED" && <CloseButton task={t} person={person} />}
        {error && <p role={error.startsWith("Tersimpan") ? "status" : "alert"} className={cn("text-sm", error.startsWith("Tersimpan") ? "text-steel-700" : "text-bad")}>{error}</p>}
      </CardContent>
    </Card>
  );
}

/** Supervisor review: every count round next to the system, then apply or close. */
function Review({ task: t, person, onDone }: { task: CountTask; person: string; onDone: () => void }) {
  const [code, setCode] = useState<ReasonCode | "">("");
  const [note, setNote] = useState("");
  const counters = t.counts.map((c) => c.by_name);
  const sys = new Map(t.current.map((c) => [key(c), Number(c.quantity)]));
  const rounds = t.counts.length ? t.counts : [{ round: 1, by_name: t.counted_by_name ?? "?", at: t.counted_at ?? "", lines: t.counted ?? [], variance: 0 }];
  const roundMaps = rounds.map((r) => { const m = new Map<string, number>(); for (const l of r.lines) m.set(key(l), (m.get(key(l)) ?? 0) + Number(l.quantity)); return m; });
  const last = roundMaps[roundMaps.length - 1];
  const keys = [...new Set([...sys.keys(), ...roundMaps.flatMap((m) => [...m.keys()])])].sort();
  const diffs = keys.filter((k) => (sys.get(k) ?? 0) !== (last.get(k) ?? 0));
  const isCounter = counters.some((c) => c.trim().toLowerCase() === person.trim().toLowerCase());

  const apply = async () => {
    if (person.trim().length < 2) return "Isi nama Anda di atas.";
    if (isCounter) return "Yang menerapkan harus orang lain dari penghitung.";
    if (diffs.length && !code) return "Pilih kode alasan selisih.";
    const { error } = await createClient().rpc("apply_count", { p_task_id: t.id, p_note: note || null, p_reason_code: code || null, p_by_name: person });
    if (error) return error.message;
    onDone(); return null;
  };

  return (
    <>
      <Table>
        <thead><tr><Th>SKU</Th><Th>Batch</Th><Th>Expired</Th><Th className="text-right">Sistem</Th>
          {rounds.map((r) => <Th key={r.round} className="text-right">Hitung {r.round}<div className="text-[11px] font-normal">{r.by_name}</div></Th>)}
          <Th className="text-right">Selisih</Th></tr></thead>
        <tbody>{keys.map((k) => {
          const [sku, batch, exp] = k.split("|");
          const s = sys.get(k) ?? 0, c = last.get(k) ?? 0;
          return (
            <tr key={k} className={cn(s !== c && "bg-warn/10")}>
              <Td>{sku}</Td><Td>{batch || "–"}</Td><Td>{fmtDate(exp || null)}</Td>
              <Td className="text-right tabular">{fmtNum(s)}</Td>
              {roundMaps.map((m, i) => <Td key={i} className="text-right tabular">{fmtNum(m.get(k) ?? 0)}</Td>)}
              <Td className={cn("text-right font-semibold tabular", c < s ? "text-bad" : c > s && "text-ok")}>{c === s ? "–" : (c > s ? "+" : "") + fmtNum(c - s)}</Td>
            </tr>
          );
        })}</tbody>
      </Table>
      {t.expected.length > 0 && (
        <p className="text-xs text-steel-500">Menurut sheet: {t.expected.map((e) => `${e.sku} / ${e.batch_lot || "–"} / ${fmtDate(e.expiry_date)} = ${fmtNum(e.quantity)}${e.line ? ` (baris ${e.line})` : ""}`).join("; ")}</p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        {diffs.length > 0 && (
          <div className="w-56">
            <Label htmlFor={`code-${t.id}`}>Kode alasan selisih</Label>
            <Select id={`code-${t.id}`} value={code} onChange={(e) => setCode(e.target.value as ReasonCode)}>
              <option value="">Pilih…</option>
              {MANUAL_REASONS.map((c) => <option key={c} value={c}>{REASON_CODES[c]}</option>)}
            </Select>
          </div>
        )}
        <div className="min-w-56 flex-1"><Label htmlFor={`note-${t.id}`}>Catatan</Label><Input id={`note-${t.id}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="opsional" /></div>
        <ConfirmButton size="sm" title={`Terapkan hitung ${t.bin_code}`} confirmLabel="Terapkan"
          summary={diffs.length ? `${diffs.length} penyesuaian stok akan diposting atas nama ${person || "?"} supaya ${t.bin_code} sama dengan hasil hitung ${counters.join(" / ")}.` : "Hasil hitung sama dengan sistem. Tugas ditutup tanpa mutasi."}
          onConfirm={apply}>{diffs.length ? `Terapkan ${diffs.length} selisih` : "Tutup: sesuai sistem"}</ConfirmButton>
        <CloseButton task={t} person={person} />
      </div>
      {isCounter && <p className="text-xs text-bad">Anda ({person}) ikut menghitung bin ini: penerapan harus oleh orang lain.</p>}
    </>
  );
}

function CloseButton({ task, person }: { task: CountTask; person: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!asking) return <Button size="sm" variant="ghost" onClick={() => setAsking(true)}>Tutup tanpa perubahan</Button>;
  async function close() {
    const { error } = await createClient().rpc("close_count", { p_task_id: task.id, p_note: note, p_by_name: person });
    if (error) return setError(error.message);
    router.refresh();
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input aria-label={`Alasan tutup ${task.bin_code}`} className="h-9 w-64" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Alasan (wajib)" />
      <Button size="sm" variant="outline" disabled={!note.trim()} onClick={close}>Tutup tugas</Button>
      <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>Batal</Button>
      {error && <p role="alert" className="w-full text-sm text-bad">{error}</p>}
    </div>
  );
}

/** Cycle count schedule: A every 30 days, B every 90, C and empty bins every 180 (plan_cycle_counts). */
function ScheduleCard({ schedule: s, openCount, supervisor }: { schedule: Schedule; openCount: number; supervisor: boolean }) {
  const router = useRouter();
  const [quota, setQuota] = useState("20");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const due = (s.due.A ?? 0) + (s.due.B ?? 0) + (s.due.C ?? 0);
  const hit = s.countedLast30 ? (s.accurateLast30 / s.countedLast30) * 100 : null;
  const first = s.firstCountKnown ? (s.firstCountAccurate / s.firstCountKnown) * 100 : null;

  async function plan() {
    setBusy(true); setMsg(null);
    const { data, error } = await createClient().rpc("plan_cycle_counts", { p_max: Number(quota) });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: error.message });
    setMsg({ ok: true, text: data.created ? `${fmtNum(data.created)} tugas cycle count dibuat, urut per bin.` : "Tidak ada bin yang jatuh tempo (atau semua sedang dipakai wave)." });
    router.refresh();
  }

  const pct = (v: number | null) => (v === null ? "–" : `${v.toFixed(1)}%`);
  const tiles: [string, string, string, boolean?][] = [
    ["Akurasi qty · 30 hari", pct(s.qtyAccuracy), `1 − selisih / stok tercatat · target ≥ ${s.target}%`, s.qtyAccuracy !== null && s.qtyAccuracy < s.target],
    ["Bin tepat · 30 hari", pct(hit), `${fmtNum(s.accurateLast30)} dari ${fmtNum(s.countedLast30)} bin dalam toleransi`, hit !== null && hit < s.target],
    ["Hitungan pertama tepat", pct(first), `${fmtNum(s.firstCountAccurate)} dari ${fmtNum(s.firstCountKnown)} · mengukur ketelitian penghitung`],
    ["Jatuh tempo", fmtNum(due), `A ${fmtNum(s.due.A ?? 0)} · B ${fmtNum(s.due.B ?? 0)} · C ${fmtNum(s.due.C ?? 0)}`],
    ["Belum pernah dihitung", fmtNum(s.neverCounted), `bin berisi stok, dari ${fmtNum(s.bins)} bin rak`],
    ["Tugas terbuka", fmtNum(openCount), "belum dihitung / hitung ulang / menunggu supervisor"],
  ];

  return (
    <Card>
      <CardHeader><CardTitle>Jadwal cycle count</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {tiles.map(([label, value, note, bad]) => (
            <div key={label} className={cn("rounded-lg bg-paper p-3", bad && "border-l-4 border-warn")}>
              <div className="text-xs text-steel-500">{label}</div>
              <div className="font-cond text-3xl font-semibold tabular">{value}</div>
              <div className="text-xs text-steel-500">{note}</div>
            </div>
          ))}
        </div>
        <p className="text-xs text-steel-500">Kelas A dihitung tiap 30 hari, B tiap 90 hari, C dan bin kosong tiap 180 hari. Penghitung tidak melihat stok sistem; hitungan yang berbeda dihitung ulang oleh orang lain sebelum supervisor (orang ketiga) menerapkannya.</p>
        {supervisor && (
          <div className="flex flex-wrap items-end gap-3">
            <div><Label htmlFor="quota">Jumlah bin hari ini</Label><Input id="quota" type="number" min={1} max={500} className="w-28" value={quota} onChange={(e) => setQuota(e.target.value)} /></div>
            <Button onClick={plan} disabled={busy || !(Number(quota) >= 1)}>{busy ? "Membuat…" : "Buat tugas cycle count"}</Button>
            {msg && <p role={msg.ok ? "status" : "alert"} className={cn("text-sm", msg.ok ? "text-ok" : "text-bad")}>{msg.text}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

