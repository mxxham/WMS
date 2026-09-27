import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import { AuditList, type AuditRow } from "@/components/audit/audit-list";
import { fmtNum } from "@/lib/utils";
import { AuditHeader, auditDate } from "../audit-header";

export const dynamic = "force-dynamic";

type PickAudit = {
  task_id: string; planned_date: string; wave_no: string; shipment_number: string | null; seq: number;
  sku: string; description: string; uom: string | null;
  from_bin: string; batch_lot: string; expiry_date: string; planned_qty: number;
  actual_quantity: number | null; actual_from_bin: string | null; actual_batch_lot: string | null; deviation_reason: string | null;
  completed_at: string | null; completed_by_name: string | null;
  audit_id: string | null; counted_qty: number | null; sku_ok: boolean | null; batch_ok: boolean | null;
  result: "OK" | "MISMATCH" | null; audit_note: string | null; audited_at: string | null; audited_by_name: string | null;
};

/** Completed picks of the wave date, what the picker reported, and the checker's audit. */
export default async function PickingAuditPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  await requireRole(["supervisor", "admin"]);
  const date = auditDate((await searchParams).date);
  const supabase = await createClient();
  const data = await fetchAll<PickAudit>((from, to) => supabase.from("pick_audit_detail").select("*")
    .eq("planned_date", date).order("completed_at", { ascending: false }).order("task_id").range(from, to));

  const rows: AuditRow[] = data.map((t) => {
    const planned = Number(t.planned_qty);
    const actual = t.actual_quantity === null ? planned : Number(t.actual_quantity);
    const bin = t.actual_from_bin ?? t.from_bin;
    const batch = t.actual_batch_lot ?? t.batch_lot;
    const changes = [
      actual !== planned && `rencana ${fmtNum(planned)}`,
      bin !== t.from_bin && `rencana bin ${t.from_bin}`,
      batch !== t.batch_lot && `rencana batch ${t.batch_lot || "–"}`,
    ].filter(Boolean);
    return {
      ref: t.task_id, when: t.completed_at, by: t.completed_by_name,
      context: `NO ${t.wave_no} #${t.seq} · SH ${t.shipment_number ?? "–"}`,
      bin, sku: t.sku, description: t.description, uom: t.uom, batch, expiry: t.expiry_date,
      expected: actual,
      deviation: changes.length ? `${changes.join(", ")}${t.deviation_reason ? `: ${t.deviation_reason}` : ""}` : null,
      audit: t.audit_id ? {
        result: t.result!, counted: Number(t.counted_qty), skuOk: !!t.sku_ok, batchOk: !!t.batch_ok,
        note: t.audit_note, at: t.audited_at!, by: t.audited_by_name,
      } : null,
    };
  });

  return (
    <main>
      <AuditHeader title="Audit picking" date={date} active="picking" />
      <div className="p-4 lg:p-8"><AuditList kind="PICK" rows={rows} /></div>
    </main>
  );
}
