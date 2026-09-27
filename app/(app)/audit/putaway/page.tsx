import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import { AuditList, type AuditRow } from "@/components/audit/audit-list";
import { AuditHeader, auditDate } from "../audit-header";

export const dynamic = "force-dynamic";

type PutawayAudit = {
  movement_id: string; type: "putaway" | "inbound"; created_at: string; created_by_name: string | null;
  sku: string; description: string; uom: string | null;
  from_bin: string | null; to_bin: string; batch_lot: string; expiry_date: string | null; quantity: number; note: string | null;
  audit_id: string | null; counted_qty: number | null; sku_ok: boolean | null; batch_ok: boolean | null;
  result: "OK" | "MISMATCH" | null; audit_note: string | null; audited_at: string | null; audited_by_name: string | null;
};

/** Putaways and receipts made on the date (Jakarta time), and the checker's audit. */
export default async function PutawayAuditPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  await requireRole(["supervisor", "admin"]);
  const date = auditDate((await searchParams).date);
  const start = new Date(`${date}T00:00:00+07:00`);
  const end = new Date(start.getTime() + 86_400_000);
  const supabase = await createClient();
  const data = await fetchAll<PutawayAudit>((from, to) => supabase.from("putaway_audit_detail").select("*")
    .gte("created_at", start.toISOString()).lt("created_at", end.toISOString())
    .order("created_at", { ascending: false }).order("movement_id").range(from, to));

  const rows: AuditRow[] = data.map((m) => ({
    ref: m.movement_id, when: m.created_at, by: m.created_by_name,
    context: m.type === "inbound" ? "Terima baru" : `dari ${m.from_bin ?? "–"}${m.note ? ` · ${m.note}` : ""}`,
    bin: m.to_bin, sku: m.sku, description: m.description, uom: m.uom, batch: m.batch_lot, expiry: m.expiry_date,
    expected: Number(m.quantity), deviation: null,
    audit: m.audit_id ? {
      result: m.result!, counted: Number(m.counted_qty), skuOk: !!m.sku_ok, batchOk: !!m.batch_ok,
      note: m.audit_note, at: m.audited_at!, by: m.audited_by_name,
    } : null,
  }));

  return (
    <main>
      <AuditHeader title="Audit putaway" date={date} active="putaway" />
      <div className="p-4 lg:p-8"><AuditList kind="PUTAWAY" rows={rows} /></div>
    </main>
  );
}
