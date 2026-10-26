import Link from "next/link";
import { getCkbUser } from "@/lib/ckb/auth";
import { createClient } from "@/lib/supabase/server";
import { isLead, isStaff } from "@/lib/ckb/permissions";
import { STOCKTAKE_STATUS, ADJUSTMENT_STATUS, type StocktakeStatus, type AdjustmentStatus } from "@/lib/ckb/stocktake";
import { INSPECTION_STATUS, type InspectionStatus } from "@/lib/ckb/inspection";
import { CkbHeader, CkbBody, StatTile, EmptyState, Notice, Pill } from "@/components/ckb/ui";
import { FilterBar } from "@/components/ckb/filter-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtDate, fmtDateTime } from "@/lib/utils";
import { actionLabel } from "./activity/labels";

export const dynamic = "force-dynamic";

type Dash = Record<string, number>;

export default async function CkbDashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getCkbUser();
  if (!user?.ckbRole) return null; // the layout explains a missing role
  const sp = await searchParams;
  const db = await createClient();
  const { data: customers } = await db.from("ckb_customers").select("id, code, name, active, active_snapshot_id").order("name");
  const denied = sp.ditolak === "1" && <Notice tone="warn">Halaman itu tidak tersedia untuk peran Anda.</Notice>;

  if (!isStaff(user.ckbRole)) return <CustomerDashboard name={user.name} customers={customers ?? []} denied={denied} />;

  const customer = (customers ?? []).find((c) => c.id === sp.customer)?.id ?? null;
  const [{ data: dash, error }, { data: activity }, { data: sessions }, { data: inspections }] = await Promise.all([
    db.rpc("ckb_dashboard", { p_customer: customer }),
    isLead(user.ckbRole)
      ? db.from("ckb_audit_events").select("id, at, actor_name, action, entity_type, customer_id").order("at", { ascending: false }).limit(8)
      : Promise.resolve({ data: [] as { id: number; at: string; actor_name: string; action: string; entity_type: string; customer_id: string | null }[] }),
    db.from("ckb_stocktakes").select("id, ref_no, status, customer_id, created_at").in("status", ["DRAFT", "COUNTING", "REVIEW"]).order("created_at", { ascending: false }).limit(6),
    db.from("ckb_inspections").select("id, ref_no, status, customer_id, inspection_date").in("status", ["DRAFT", "SUBMITTED"]).order("created_at", { ascending: false }).limit(6),
  ]);
  const d = (dash ?? {}) as Dash;
  const name = new Map((customers ?? []).map((c) => [c.id, c.name]));
  const filtered = <T extends { customer_id: string | null }>(rows: T[] | null): T[] => (rows ?? []).filter((r) => !customer || r.customer_id === customer);
  const lead = isLead(user.ckbRole);

  return (
    <main>
      <CkbHeader title="Dashboard" subtitle="CKB Warehouse 5 · Freeport, CGP, SIP, MNE, Boiler, SSB"
        live={["ckb_stocktakes", "ckb_counts", "ckb_adjustments", "ckb_inspections", "ckb_rebagging_jobs"]} />
      <CkbBody>
        {denied}
        {error && <Notice tone="bad">Angka dashboard tidak bisa dimuat: {error.message}</Notice>}
        <FilterBar fields={[{ name: "customer", label: "Customer", kind: "select", all: "Semua customer",
          options: (customers ?? []).map((c) => ({ value: c.id, label: c.name })) }]} />
        {lead && d.customers_without_snapshot > 0 && (
          <Notice tone="warn" title={`${d.customers_without_snapshot} customer aktif belum punya snapshot SAP aktif`}>
            Stock take butuh snapshot sebagai dasar. <Link className="underline" href="/ckb/sap/import">Import SAP</Link>
          </Notice>
        )}

        <section aria-labelledby="h-ops" className="space-y-3">
          <h2 id="h-ops" className="font-cond text-lg font-semibold">Stock take</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatTile label="Sesi berjalan" value={d.stocktakes_counting ?? 0} href="/ckb/stock-take?status=COUNTING" />
            <StatTile label="Menunggu dihitung" value={d.tasks_awaiting_count ?? 0} href="/ckb/stock-take?status=COUNTING" hint="tugas belum/ulang dihitung" />
            <StatTile label="Selisih menunggu review" value={d.discrepancies_awaiting_review ?? 0} tone="warn" href="/ckb/stock-take?status=REVIEW" />
            <StatTile label="Hitung ulang diminta" value={d.recounts_requested ?? 0} tone="warn" href="/ckb/stock-take?status=REVIEW" />
            <StatTile label="Penyesuaian menunggu persetujuan" value={d.adjustments_proposed ?? 0} tone="warn" href="/ckb/stock-take?status=CLOSED" />
            <StatTile label="Disetujui, belum diekspor" value={d.adjustments_awaiting_export ?? 0} href={lead ? "/ckb/sap/export" : undefined} />
          </div>
        </section>
        <section aria-labelledby="h-floor" className="space-y-3">
          <h2 id="h-floor" className="font-cond text-lg font-semibold">Rebagging dan inspeksi</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatTile label="Rebagging terbuka" value={d.rebagging_open ?? 0} href="/ckb/rebagging" />
            <StatTile label="Rebagging menunggu verifikasi" value={d.rebagging_awaiting_verification ?? 0} tone="warn" href="/ckb/rebagging" />
            <StatTile label="Rebagging siap posting" value={d.rebagging_awaiting_posting ?? 0} href="/ckb/rebagging" />
            <StatTile label="Inspeksi draf" value={d.inspections_draft ?? 0} href="/ckb/inspections?status=DRAFT" />
            <StatTile label="Inspeksi menunggu review" value={d.inspections_awaiting_review ?? 0} tone="warn" href="/ckb/inspections?status=SUBMITTED" />
            <StatTile label="Ekspor SAP belum dikonfirmasi" value={d.exports_unconfirmed ?? 0} href={lead ? "/ckb/sap/export" : undefined} />
          </div>
        </section>

        <div className="flex flex-wrap gap-2">
          {lead && <Button asChild><Link href="/ckb/stock-take/new">Sesi stock take baru</Link></Button>}
          <Button asChild variant="outline"><Link href="/ckb/inspections/new">Inspeksi baru</Link></Button>
          <Button asChild variant="outline"><Link href="/ckb/rebagging?baru=1">Rebagging baru</Link></Button>
          {lead && <Button asChild variant="outline"><Link href="/ckb/sap/import">Import SAP</Link></Button>}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Sesi stock take terbuka</CardTitle></CardHeader>
            <CardContent>
              {filtered(sessions).length === 0 ? <p className="text-sm text-steel-500">Tidak ada sesi terbuka.</p> : (
                <ul className="divide-y divide-steel-100">
                  {filtered(sessions).map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <Link href={`/ckb/stock-take/${s.id}`} className="font-medium text-ckb hover:underline">{s.ref_no}</Link>
                      <span className="truncate text-steel-500">{name.get(s.customer_id)}</span>
                      <Pill tone={STOCKTAKE_STATUS[s.status as StocktakeStatus].tone}>{STOCKTAKE_STATUS[s.status as StocktakeStatus].label}</Pill>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Inspeksi terbuka</CardTitle></CardHeader>
            <CardContent>
              {filtered(inspections).length === 0 ? <p className="text-sm text-steel-500">Tidak ada inspeksi terbuka.</p> : (
                <ul className="divide-y divide-steel-100">
                  {filtered(inspections).map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <Link href={`/ckb/inspections/${i.id}`} className="font-medium text-ckb hover:underline">{i.ref_no}</Link>
                      <span className="truncate text-steel-500">{name.get(i.customer_id)} · {fmtDate(i.inspection_date)}</span>
                      <Pill tone={INSPECTION_STATUS[i.status as InspectionStatus].tone}>{INSPECTION_STATUS[i.status as InspectionStatus].label}</Pill>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {lead && (
          <Card>
            <CardHeader className="flex items-center justify-between"><CardTitle>Aktivitas terakhir</CardTitle><Link href="/ckb/activity" className="text-sm text-ckb hover:underline">Semua</Link></CardHeader>
            <CardContent>
              {filtered(activity).length === 0 ? <p className="text-sm text-steel-500">Belum ada aktivitas.</p> : (
                <ul className="divide-y divide-steel-100">
                  {filtered(activity).map((a) => (
                    <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                      <span><span className="font-medium">{a.actor_name}</span> · {actionLabel(a.action)}</span>
                      <span className="text-xs text-steel-500">{a.customer_id ? `${name.get(a.customer_id)} · ` : ""}{fmtDateTime(a.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
      </CkbBody>
    </main>
  );
}

/** A representative's view: their customers' finished records only (RLS returns nothing else). */
async function CustomerDashboard({ name, customers, denied }: { name: string; customers: { id: string; name: string }[]; denied: React.ReactNode }) {
  const db = await createClient();
  const [{ data: sessions }, { data: inspections }, { data: adjustments }] = await Promise.all([
    db.from("ckb_stocktakes").select("id, ref_no, customer_id, closed_at").order("closed_at", { ascending: false }).limit(8),
    db.from("ckb_inspections").select("id, ref_no, customer_id, inspection_date, status, result").order("inspection_date", { ascending: false }).limit(8),
    db.from("ckb_adjustments").select("status"),
  ]);
  const cname = new Map(customers.map((c) => [c.id, c.name]));
  const by = (s: AdjustmentStatus) => (adjustments ?? []).filter((a) => a.status === s).length;
  return (
    <main>
      <CkbHeader title="Dashboard" subtitle={customers.map((c) => c.name).join(", ") || "Belum ada customer yang ditugaskan"} />
      <CkbBody>
        {denied}
        <Notice>Halo {name}. Anda melihat hasil yang sudah selesai untuk customer Anda: stock take yang ditutup, inspeksi yang sudah direview, dan keputusan penyesuaian.</Notice>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label="Stock take selesai" value={(sessions ?? []).length} href="/ckb/stock-take" />
          <StatTile label="Inspeksi direview" value={(inspections ?? []).length} href="/ckb/inspections" />
          <StatTile label={ADJUSTMENT_STATUS.APPROVED.label} value={by("APPROVED") + by("EXPORTED")} href="/ckb/reports?kind=adjustments" />
          <StatTile label={ADJUSTMENT_STATUS.REJECTED.label} value={by("REJECTED")} href="/ckb/reports?kind=adjustments" />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Stock take terakhir</CardTitle></CardHeader>
            <CardContent>
              {(sessions ?? []).length === 0 ? <EmptyState title="Belum ada stock take selesai" /> : (
                <ul className="divide-y divide-steel-100">
                  {(sessions ?? []).map((s) => (
                    <li key={s.id} className="flex justify-between gap-2 py-2 text-sm">
                      <Link href={`/ckb/stock-take/${s.id}`} className="font-medium text-ckb hover:underline">{s.ref_no}</Link>
                      <span className="text-steel-500">{cname.get(s.customer_id)} · {fmtDate(s.closed_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Inspeksi terakhir</CardTitle></CardHeader>
            <CardContent>
              {(inspections ?? []).length === 0 ? <EmptyState title="Belum ada inspeksi yang direview" /> : (
                <ul className="divide-y divide-steel-100">
                  {(inspections ?? []).map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <Link href={`/ckb/inspections/${i.id}`} className="font-medium text-ckb hover:underline">{i.ref_no}</Link>
                      <span className="text-steel-500">{fmtDate(i.inspection_date)}</span>
                      <Pill tone={i.result === "FAIL" ? "bad" : "ok"}>{i.result === "FAIL" ? "Ada temuan" : "Lulus"}</Pill>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
        <Button asChild><Link href="/ckb/reports">Buka laporan</Link></Button>
      </CkbBody>
    </main>
  );
}
