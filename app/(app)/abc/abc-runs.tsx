"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Calculator, CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ConfirmButton } from "@/components/app/confirm-button";
import { PersonNameField, usePersonName } from "@/components/app/person-name";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { lastMonth, periodLabel, type AbcRun } from "@/lib/abc";
import { cn, fmtDateTime, fmtNum } from "@/lib/utils";

/** Inventory, Leader and Admin: compute a period now, as a preview or applied at once. */
export function ManualRun({ today, policy }: { today: string; policy: { a: number; b: number } }) {
  const router = useRouter();
  const [person, setPerson] = usePersonName();
  const def = lastMonth(today);
  const [from, setFrom] = useState(def.from);
  const [to, setTo] = useState(def.to);
  const [apply, setApply] = useState(false);
  const run = async () => {
    const { data, error } = await createClient().rpc("abc_run", { p_from: from, p_to: to, p_by_name: person, p_apply: apply });
    if (error) return error.message;
    router.push(`/abc?run=${data}`); router.refresh();
    return null;
  };
  return (
    <Card>
      <CardHeader><CardTitle>Hitung periode lain</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-steel-500">Bulan lalu dihitung dan diterapkan otomatis di awal bulan. Di sini bisa dihitung periode lain, misalnya
          3 bulan terakhir, untuk dilihat dulu (pratinjau) sebelum diterapkan.</p>
        <div className="flex flex-wrap items-end gap-3">
          <div><Label htmlFor="abc-from">Dari</Label><Input id="abc-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label htmlFor="abc-to">Sampai</Label><Input id="abc-to" type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} /></div>
          <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={apply} onChange={(e) => setApply(e.target.checked)} />Langsung terapkan</label>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <PersonNameField id="abc-person" value={person} onChange={setPerson} label="Nama Anda" />
          <ConfirmButton title="Hitung kelas ABC" confirmLabel={apply ? "Hitung dan terapkan" : "Hitung"}
            disabled={!from || !to || from > to || person.trim().length < 2}
            summary={`Kelas ABC dari baris picking ${from && to ? periodLabel(from, to) : "–"}, batas A ${fmtNum(policy.a)}% dan B ${fmtNum(policy.b)}%. ${apply
              ? "Kelas baru langsung dipakai semua SKU, termasuk jadwal cycle count."
              : "Disimpan sebagai pratinjau: kelas SKU belum berubah sampai diterapkan."}`}
            onConfirm={run}><Calculator className="h-4 w-4" />Hitung…</ConfirmButton>
        </div>
      </CardContent>
    </Card>
  );
}

/** A preview: put its classes on the SKUs. */
export function ApplyRun({ run, changes }: { run: AbcRun; changes: number }) {
  const router = useRouter();
  const [person, setPerson] = usePersonName();
  const apply = async () => {
    const { error } = await createClient().rpc("abc_apply", { p_run: run.id, p_by_name: person });
    if (error) return error.message;
    router.refresh();
    return null;
  };
  return (
    <div className="flex flex-wrap items-end gap-3">
      <PersonNameField id="abc-apply-person" value={person} onChange={setPerson} label="Nama Anda" />
      <ConfirmButton title="Terapkan kelas ABC" confirmLabel="Terapkan" disabled={person.trim().length < 2}
        summary={`Terapkan kelas ${periodLabel(run.period_from, run.period_to)}: ${fmtNum(changes)} SKU berubah kelas. Jadwal cycle count ikut kelas baru.`}
        onConfirm={apply}><CheckCircle2 className="h-4 w-4" />Terapkan kelas ini…</ConfirmButton>
    </div>
  );
}

/** Every run, newest period first; the one shown is highlighted, the one in force is marked. */
export function RunHistory({ runs, current, inForce }: { runs: AbcRun[]; current: string | null; inForce: string | null }) {
  return (
    <Card>
      <CardHeader><CardTitle>Riwayat perhitungan</CardTitle></CardHeader>
      <CardContent>
        {runs.length === 0 ? <p className="text-sm text-steel-500">Belum ada perhitungan.</p> : (
          <Table>
            <thead><tr><Th>Periode</Th><Th>Jenis</Th><Th className="text-right">Baris pick</Th><Th className="text-right">Karton</Th><Th>Batas</Th><Th>Status</Th><Th>Oleh</Th></tr></thead>
            <tbody>{runs.map((r) => (
              <tr key={r.id} className={cn(r.id === current && "bg-plate/20")}>
                <Td><Link className="font-semibold underline" href={`/abc?run=${r.id}`}>{periodLabel(r.period_from, r.period_to)}</Link></Td>
                <Td className="text-xs">{r.source === "AUTO" ? "Otomatis bulanan" : "Manual"}</Td>
                <Td className="text-right tabular">{fmtNum(r.total_lines)}</Td>
                <Td className="text-right tabular">{fmtNum(r.total_cartons)}</Td>
                <Td className="text-xs">A {fmtNum(r.a_pct)}% · B {fmtNum(r.b_pct)}%</Td>
                <Td className="text-xs">{r.id === inForce ? <span className="font-semibold text-ok">Berlaku sekarang</span>
                  : r.applied_at ? `Diterapkan ${fmtDateTime(r.applied_at)}` : <span className="text-warn">Pratinjau</span>}</Td>
                <Td className="text-xs">{r.created_by_name}{r.applied_by_name && r.applied_by_name !== r.created_by_name && ` → ${r.applied_by_name}`}<div className="text-steel-500">{fmtDateTime(r.created_at)}</div></Td>
              </tr>
            ))}</tbody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
