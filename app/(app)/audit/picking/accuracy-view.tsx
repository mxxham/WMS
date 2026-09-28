import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import { parsePolicy } from "@/lib/inventory-control";
import {
  auditCoverage, PICK_ERROR_LABEL, scanCompliance, shipmentFirstPass, summarizeAccuracy, type FirstAttempt,
} from "@/lib/pick-audit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { cn, fmtDateTime, fmtNum } from "@/lib/utils";
import { shipmentHref } from "./shipment-list";

const pct = (x: number | null) => (x === null ? "–" : `${fmtNum(x, 1)}%`);

/**
 * Pick accuracy from first attempts only (a fixed line still counts as an
 * error), with where the errors come from.
 */
export async function AccuracyView({ days }: { days: number }) {
  const supabase = await createClient();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const [firsts, lines, loads, { data: policyRaw }] = await Promise.all([
    fetchAll<FirstAttempt & { audited_at: string }>((a, b) => supabase.from("pick_audit_first")
      .select("task_id, audited_at, result, errors, expected_qty, counted_qty, picked_by_name, sku, description, zone, bulk_posted, minutes_to_audit, wave_id, shipment_number")
      .gte("audited_at", since).order("audited_at").order("task_id").range(a, b)),
    fetchAll<{ scanned_code: string | null }>((a, b) => supabase.from("pick_audit_line").select("scanned_code")
      .gte("completed_at", since).gt("picked_qty", 0).order("task_id").range(a, b)),
    fetchAll<{ wave_id: string; shipment_number: string; todo: number; mismatch: number }>((a, b) => supabase.from("pick_audit_shipment")
      .select("wave_id, shipment_number, todo, mismatch").eq("state", "LOADED").eq("load_legacy", false).gte("loaded_at", since)
      .order("wave_id").order("shipment_number").range(a, b)),
    supabase.rpc("inventory_policy"),
  ]);
  const target = parsePolicy(policyRaw).pick_accuracy_target_pct;
  const s = summarizeAccuracy(firsts);
  const tiles: { label: string; value: string; note: string; bad?: boolean }[] = [
    { label: "Akurasi baris", value: pct(s.lineAccuracy), note: `${fmtNum(s.ok)} OK dari ${fmtNum(s.lines)} · target ${fmtNum(target, 1)}%`, bad: s.lineAccuracy !== null && s.lineAccuracy < target },
    { label: "Akurasi karton", value: pct(s.unitAccuracy), note: "karton benar dari yang diaudit" },
    { label: "Salah pick / 1.000 baris", value: s.mispicksPer1000 === null ? "–" : fmtNum(s.mispicksPer1000, 1), note: "di atas 5 = masalah proses" },
    { label: "Shipment lolos sekali audit", value: pct(shipmentFirstPass(loads, firsts)), note: `${fmtNum(loads.length)} shipment dimuat` },
    { label: "Cakupan audit", value: pct(auditCoverage(loads)), note: "harus 100%: semua baris dimuat sudah lolos", bad: loads.length > 0 && auditCoverage(loads) !== 100 },
    { label: "Kepatuhan scan", value: pct(scanCompliance(lines.map((l) => !!l.scanned_code))), note: `${fmtNum(lines.length)} baris dipick` },
    { label: "Pick → audit", value: s.medianMinutes === null ? "–" : `${fmtNum(s.medianMinutes)} mnt`, note: "median" },
  ];
  const recent = firsts.filter((f) => f.result === "MISMATCH").slice(-20).reverse();

  return (
    <div className="space-y-4">
      <nav className="flex gap-2 text-sm">
        {[7, 30, 90].map((d) => (
          <Link key={d} href={`/audit/picking?tab=akurasi&days=${d}`} aria-current={d === days ? "page" : undefined}
            className={cn("rounded-md border px-3 py-1.5", d === days ? "border-ckb bg-ckb text-white" : "border-steel-300 bg-white")}>{d} hari</Link>
        ))}
      </nav>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        {tiles.map((t) => (
          <div key={t.label} className={cn("rounded-lg border-l-4 bg-white p-3", t.bad ? "border-bad" : "border-ckb")}>
            <div className="font-cond text-3xl font-semibold tabular">{t.value}</div>
            <div className="text-sm font-medium">{t.label}</div>
            <div className="text-xs text-steel-500">{t.note}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>Jenis kesalahan</CardTitle></CardHeader><CardContent>
          {s.byError.length === 0 ? <p className="text-sm text-steel-500">Tidak ada kesalahan.</p> : (
            <Table><thead><tr><Th>Jenis</Th><Th className="text-right">Baris</Th></tr></thead>
              <tbody>{s.byError.map((e) => <tr key={e.error}><Td>{PICK_ERROR_LABEL[e.error]}</Td><Td className="text-right tabular">{fmtNum(e.n)}</Td></tr>)}</tbody></Table>
          )}
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Per picker</CardTitle></CardHeader><CardContent>
          {s.byPicker.length === 0 ? <p className="text-sm text-steel-500">Belum ada audit.</p> : (
            <Table><thead><tr><Th>Picker</Th><Th className="text-right">Baris</Th><Th className="text-right">Salah</Th><Th className="text-right">Akurasi</Th><Th className="text-right">Tanpa scan (massal)</Th></tr></thead>
              <tbody>{s.byPicker.map((p) => (
                <tr key={p.name} className={cn(p.accuracy < target && "bg-bad/5")}>
                  <Td>{p.name}</Td><Td className="text-right tabular">{fmtNum(p.lines)}</Td><Td className="text-right tabular">{fmtNum(p.errors)}</Td>
                  <Td className="text-right tabular">{pct(p.accuracy)}</Td><Td className="text-right tabular">{fmtNum(p.bulk)}</Td>
                </tr>))}</tbody></Table>
          )}
        </CardContent></Card>
        <Card><CardHeader><CardTitle>SKU paling sering salah</CardTitle></CardHeader><CardContent>
          <Table><thead><tr><Th>SKU</Th><Th className="text-right">Salah</Th><Th className="text-right">Baris</Th></tr></thead>
            <tbody>{s.bySku.filter((x) => x.errors > 0).slice(0, 10).map((x) => (
              <tr key={x.sku}><Td><b>{x.sku}</b><br /><span className="text-xs text-steel-500">{x.description}</span></Td>
                <Td className="text-right tabular">{fmtNum(x.errors)}</Td><Td className="text-right tabular">{fmtNum(x.lines)}</Td></tr>))}</tbody></Table>
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Per aisle asal</CardTitle></CardHeader><CardContent>
          <Table><thead><tr><Th>Aisle</Th><Th className="text-right">Salah</Th><Th className="text-right">Baris</Th></tr></thead>
            <tbody>{s.byZone.map((z) => (
              <tr key={z.zone}><Td>{z.zone}</Td><Td className="text-right tabular">{fmtNum(z.errors)}</Td><Td className="text-right tabular">{fmtNum(z.lines)}</Td></tr>))}</tbody></Table>
        </CardContent></Card>
      </div>
      <Card><CardHeader><CardTitle>Selisih terakhir</CardTitle></CardHeader><CardContent>
        {recent.length === 0 ? <p className="text-sm text-steel-500">Tidak ada selisih pada periode ini.</p> : (
          <Table><thead><tr><Th>Waktu audit</Th><Th>Shipment</Th><Th>SKU</Th><Th>Picker</Th><Th>Kesalahan</Th></tr></thead>
            <tbody>{recent.map((r) => (
              <tr key={r.task_id}>
                <Td className="whitespace-nowrap text-xs">{fmtDateTime(r.audited_at)}</Td>
                <Td><Link className="underline" href={shipmentHref(r)}>{r.shipment_number}</Link></Td>
                <Td>{r.sku}</Td><Td>{r.picked_by_name ?? "(tidak tercatat)"}</Td>
                <Td className="text-bad">{r.errors.map((e) => PICK_ERROR_LABEL[e]).join(", ")}</Td>
              </tr>))}</tbody></Table>
        )}
      </CardContent></Card>
    </div>
  );
}
