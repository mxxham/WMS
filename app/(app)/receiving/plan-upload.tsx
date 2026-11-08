"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PersonNameField, usePersonName } from "@/components/app/person-name";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import type { InboundPlan } from "@/lib/inbound/plan-file";
import { fmtDate, fmtNum } from "@/lib/utils";

/**
 * Upload Shell's inbound plan ("INBOUND SHELL, KAMIS 29 OKTOBER 2026") before the trucks come: one
 * Penerimaan per Delivery Order (0118). Nothing touches stock until a checked receipt is posted.
 */
export function PlanUpload() {
  const router = useRouter();
  const [person, setPerson] = usePersonName();
  const [plan, setPlan] = useState<(InboundPlan & { file: string }) | null>(null);
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ created: number; skipped: { doc_no: string; why: string }[] } | null>(null);

  async function read(f: File | undefined) {
    if (!f) return;
    setError(null); setDone(null);
    try {
      const [XLSX, { parseInboundPlan }] = await Promise.all([import("xlsx"), import("@/lib/inbound/plan-file")]);
      const p = parseInboundPlan(XLSX.read(await f.arrayBuffer()));
      if (!p.docs.length) throw new Error("Tidak ada baris DO yang bisa dibaca.");
      setPlan({ ...p, file: f.name }); setDate(p.date ?? "");
    } catch (e) { setError(`${f.name}: ${(e as Error).message}`); }
  }

  async function save() {
    if (!plan) return;
    if (!date) return setError("Isi tanggal rencana.");
    setBusy(true); setError(null);
    const { data, error } = await createClient().rpc("create_receipts_from_plan", {
      p_plan_date: date, p_file: plan.file, p_by_name: person,
      p_docs: plan.docs.map((d) => ({ ...d, lines: d.lines.map((l) => ({ sku: l.sku, quantity: l.quantity })) })),
    });
    setBusy(false);
    if (error) return setError(error.message);
    setDone(data as { created: number; skipped: { doc_no: string; why: string }[] }); setPlan(null);
    // The list shows one day: open the plan's day so the new receipts are on screen.
    router.push(`/receiving?date=${date}`); router.refresh();
  }

  const lines = plan?.docs.reduce((n, d) => n + d.lines.length, 0) ?? 0;
  const qty = plan?.docs.reduce((n, d) => n + d.lines.reduce((m, l) => m + l.quantity, 0), 0) ?? 0;
  return (
    <Card>
      <CardHeader><CardTitle>Rencana inbound Shell</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-steel-500">Upload file &quot;INBOUND SHELL&quot; sebelum truk datang. Setiap Delivery Order menjadi satu penerimaan.
          Saat kontainer dibongkar, buka penerimaannya, cocokkan dengan yang datang, lalu hitung putaway dan cetak kartu palet.</p>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-steel-300 bg-white px-3 py-2 text-sm hover:bg-paper">
          <CalendarClock className="h-4 w-4" />Upload rencana inbound (.xlsx)
          <input type="file" accept=".xlsx,.xls" className="sr-only" onChange={(e) => { read(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        {plan && (
          <div className="space-y-3 rounded-md bg-plate/30 p-3 text-sm">
            <p><b>{plan.file}</b>: {fmtNum(plan.docs.length)} DO, {fmtNum(lines)} baris, {fmtNum(qty)} unit
              {date && <> untuk <b>{fmtDate(date)}</b></>}. Simpan sebagai rencana?</p>
            {plan.skipped.length > 0 && <p className="text-warn">{fmtNum(plan.skipped.length)} baris tidak terbaca: {plan.skipped.slice(0, 5).map((s) => `baris ${s.row} (${s.why})`).join(", ")}</p>}
            <ul className="max-h-48 list-disc overflow-auto pl-5 text-xs">{plan.docs.map((d) => (
              <li key={d.doc_no}>DO {d.doc_no} · {d.container_no || "–"} · slot {d.slot_time ?? "–"} · {d.lines.map((l) => `${l.sku} × ${fmtNum(l.quantity)} ${l.uom}`).join(", ")}</li>
            ))}</ul>
            <div className="flex flex-wrap items-end gap-3">
              <div><Label htmlFor="plan-date">Tanggal rencana</Label><Input id="plan-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
              <PersonNameField id="plan-up-person" value={person} onChange={setPerson} label="Nama Anda" />
              <Button disabled={busy || person.trim().length < 2} onClick={save}>{busy ? "Menyimpan…" : "Simpan rencana"}</Button>
              <Button variant="outline" onClick={() => setPlan(null)}>Batal</Button>
            </div>
          </div>
        )}
        {done && (
          <div className="rounded-md bg-ok/10 p-3 text-sm">
            {fmtNum(done.created)} penerimaan dibuat.
            {done.skipped.length > 0 && <ul className="mt-1 list-disc pl-5 text-warn">{done.skipped.map((s) => <li key={s.doc_no}>DO {s.doc_no}: {s.why}</li>)}</ul>}
          </div>
        )}
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      </CardContent>
    </Card>
  );
}
