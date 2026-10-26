import type { Metadata } from "next";
import Link from "next/link";
import { FileSpreadsheet, FileText } from "lucide-react";
import { requireCkb } from "@/lib/ckb/auth";
import { createClient } from "@/lib/supabase/server";
import { cleanFilters, loadReport } from "@/lib/ckb/report-data";
import { REPORTS, cellText, reportSummary, reportsFor, type ReportFilters, type ReportKind } from "@/lib/ckb/reports";
import { CLASSIFICATION, STOCKTAKE_STATUS, ADJUSTMENT_STATUS } from "@/lib/ckb/stocktake";
import { INSPECTION_STATUS, INSPECTION_TYPE } from "@/lib/ckb/inspection";
import { ACTION_GROUPS } from "../activity/labels";
import { CkbHeader, CkbBody, EmptyState, Notice, StatTile } from "@/components/ckb/ui";
import { FilterBar, type FilterField } from "@/components/ckb/filter-bar";
import { Button } from "@/components/ui/button";
import { Table, Th, Td } from "@/components/ui/table";
import { cn, fmtNum } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Laporan" };
const SHOW = 500;

const opts = (rec: Record<string, { label: string } | string>) => Object.entries(rec).map(([value, v]) => ({ value, label: typeof v === "string" ? v : v.label }));
const STATUS_OPTIONS: Partial<Record<ReportKind, { value: string; label: string }[]>> = {
  stocktakes: opts(STOCKTAKE_STATUS), adjustments: opts(ADJUSTMENT_STATUS), inspections: opts(INSPECTION_STATUS),
  rebagging: ["DRAFT", "OPEN", "IN_PROGRESS", "AWAITING_VERIFICATION", "VERIFIED", "REJECTED", "ON_HOLD", "COMPLETED", "CANCELLED", "REVERSED"].map((s) => ({ value: s, label: s })),
  sap_exports: [{ value: "GENERATED", label: "Dibuat" }, { value: "SAP_CONFIRMED", label: "Dikonfirmasi SAP" }, { value: "VOIDED", label: "Dibatalkan" }],
};
const TYPE_OPTIONS: Partial<Record<ReportKind, { value: string; label: string }[]>> = {
  inspections: opts(INSPECTION_TYPE),
  rebagging: [{ value: "DAMAGE_REBAG", label: "Kemasan rusak" }, { value: "SPLIT", label: "Pecah kemasan" }, { value: "RELABEL", label: "Label ulang" }, { value: "COMBINE", label: "Gabung kemasan" }],
  activity: ACTION_GROUPS,
};

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireCkb("/ckb/reports");
  const sp = await searchParams;
  const allowed = reportsFor(user.ckbRole);
  const kind = (allowed.includes(sp.kind as ReportKind) ? sp.kind : allowed[0]) as ReportKind;
  const def = REPORTS[kind];
  const f = cleanFilters(sp);
  const db = await createClient();
  const { data: customers } = await db.from("ckb_customers").select("id, name").order("name");
  const { rows, truncated } = await loadReport(kind, f);
  const summary = reportSummary(kind, rows);

  const fields: FilterField[] = def.filters.flatMap((k: keyof ReportFilters): FilterField[] => {
    if (k === "customer") return [{ name: k, label: "Customer", kind: "select", options: (customers ?? []).map((c) => ({ value: c.id, label: c.name })) }];
    if (k === "from") return [{ name: k, label: "Dari tanggal", kind: "date" }];
    if (k === "to") return [{ name: k, label: "Sampai tanggal", kind: "date" }];
    if (k === "status" && STATUS_OPTIONS[kind]) return [{ name: k, label: "Status", kind: "select", options: STATUS_OPTIONS[kind]! }];
    if (k === "type" && TYPE_OPTIONS[kind]) return [{ name: k, label: "Jenis", kind: "select", options: TYPE_OPTIONS[kind]! }];
    if (k === "classification") return [{ name: k, label: "Klasifikasi", kind: "select", options: opts(CLASSIFICATION).filter((o) => o.value !== "COUNTED") }];
    if (k === "material") return [{ name: k, label: "Material", kind: "text" }];
    if (k === "location") return [{ name: k, label: "Bin / lokasi", kind: "text" }];
    return [];
  });
  const qs = new URLSearchParams({ kind, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) });

  return (
    <main>
      <CkbHeader title="Laporan" subtitle={user.ckbRole === "customer" ? "Hanya data customer Anda." : "Laporan operasional CKB 3PL dari data asli."} />
      <CkbBody>
        <nav aria-label="Jenis laporan" className="flex flex-wrap gap-2">
          {allowed.map((k) => (
            <Link key={k} href={`?kind=${k}`} aria-current={k === kind ? "page" : undefined}
              className={cn("min-h-9 rounded-full px-3 py-1.5 text-sm ring-1", k === kind ? "bg-ckb text-white ring-ckb" : "bg-white ring-steel-300 hover:bg-steel-100")}>{REPORTS[k].title}</Link>
          ))}
        </nav>
        <p className="text-sm text-steel-500">{def.blurb}</p>
        <FilterBar key={kind} fields={fields} />
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm"><a href={`/api/ckb/reports?${qs}&format=xlsx`}><FileSpreadsheet className="h-4 w-4" />Excel</a></Button>
          <Button asChild variant="outline" size="sm"><a href={`/api/ckb/reports?${qs}&format=pdf`}><FileText className="h-4 w-4" />PDF</a></Button>
          <span className="text-xs text-steel-500">File berisi baris yang sama dengan filter di atas.</span>
        </div>
        {truncated && <Notice tone="warn">Laporan terlalu besar dan dipotong. Persempit tanggal atau customer.</Notice>}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{summary.map((s) => <StatTile key={s.label} label={s.label} value={fmtNum(s.value, 3)} />)}</div>
        {rows.length === 0 ? <EmptyState title="Tidak ada data untuk filter ini" /> : (
          <div className="rounded-lg border border-steel-100 bg-white">
            <Table sticky>
              <thead><tr>{def.columns.map((c) => <Th key={c.key} className={c.type === "num" ? "text-right" : ""}>{c.header}</Th>)}</tr></thead>
              <tbody>
                {rows.slice(0, SHOW).map((r, i) => (
                  <tr key={i}>{def.columns.map((c) => (
                    <Td key={c.key} className={cn(c.type === "num" && "text-right", c.key === "details" && "max-w-xs truncate text-xs")}>
                      {c.type === "num" && typeof r[c.key] === "number" ? fmtNum(r[c.key] as number, 3) : cellText(r[c.key], c.type) || "–"}
                    </Td>
                  ))}</tr>
                ))}
              </tbody>
            </Table>
            {rows.length > SHOW && <p className="p-3 text-sm text-steel-500">Menampilkan {SHOW} dari {fmtNum(rows.length)} baris; unduh Excel untuk semuanya.</p>}
          </div>
        )}
      </CkbBody>
    </main>
  );
}
