import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app/page-header";
import type { LineState, PickError } from "@/lib/pick-audit";
import type { ShipmentRow } from "../../shipment-list";
import { ShipmentAuditClient, type AttemptView, type LineView } from "./shipment-audit-client";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LineRow = {
  task_id: string; seq: number; sku: string; description: string; uom: string | null; from_bin: string; batch_lot: string;
  expiry_date: string | null; planned_qty: number; picked_qty: number; deviation_reason: string | null;
  picked_by_name: string | null; bulk_posted: boolean; line_state: LineState; attempts: number;
};

/** One shipment's lines. A line's picked qty / batch / expiry is not sent to the browser until it has been audited. */
export default async function ShipmentAuditPage({ params }: { params: Promise<{ wave: string; shipment: string }> }) {
  const user = await requireRole(["operator", "supervisor", "admin"]);
  const { wave, shipment } = await params;
  const ship = decodeURIComponent(shipment);
  if (!UUID.test(wave)) notFound();
  const supabase = await createClient();
  const [{ data: s }, { data: lines }, { data: attempts }] = await Promise.all([
    supabase.from("pick_audit_shipment").select("*").eq("wave_id", wave).eq("shipment_number", ship).maybeSingle(),
    supabase.from("pick_audit_line")
      .select("task_id, seq, sku, description, uom, from_bin, batch_lot, expiry_date, planned_qty, picked_qty, deviation_reason, picked_by_name, bulk_posted, line_state, attempts")
      .eq("wave_id", wave).eq("shipment_number", ship).order("seq"),
    supabase.from("pick_audits").select("*, pick_tasks!inner(wave_id, shipment_number)")
      .eq("pick_tasks.wave_id", wave).eq("pick_tasks.shipment_number", ship).order("attempt_no"),
  ]);
  if (!s) notFound();

  // What is in each line's source bin now, for that SKU (all batches).
  const rows = (lines ?? []) as LineRow[];
  const { data: stock } = rows.length
    ? await supabase.from("inventory_detail").select("bin_code, sku, quantity").in("bin_code", [...new Set(rows.map((l) => l.from_bin))])
    : { data: [] };
  const inBin = new Map<string, number>();
  for (const r of (stock ?? []) as { bin_code: string; sku: string; quantity: number }[]) {
    inBin.set(`${r.bin_code}|${r.sku}`, (inBin.get(`${r.bin_code}|${r.sku}`) ?? 0) + Number(r.quantity));
  }

  const view: LineView[] = rows.map((l) => ({
    task_id: l.task_id, seq: l.seq, sku: l.sku, description: l.description, uom: l.uom, from_bin: l.from_bin,
    bin_qty: inBin.get(`${l.from_bin}|${l.sku}`) ?? 0,
    picked_by_name: l.picked_by_name, bulk_posted: l.bulk_posted, state: l.line_state, attempts: l.attempts,
    picked: l.line_state === "TODO" ? undefined : {
      qty: Number(l.picked_qty), planned_qty: Number(l.planned_qty), batch: l.batch_lot, expiry: l.expiry_date, deviation: l.deviation_reason,
    },
  }));
  const tries: AttemptView[] = ((attempts ?? []) as (AttemptView & { errors: PickError[] })[]).map((a) => ({
    id: a.id, task_id: a.task_id, attempt_no: a.attempt_no, checker_name: a.checker_name, found_sku: a.found_sku,
    found_batch: a.found_batch, found_expiry: a.found_expiry, counted_qty: Number(a.counted_qty), damaged: a.damaged,
    expected_sku: a.expected_sku, expected_batch: a.expected_batch, expected_expiry: a.expected_expiry, expected_qty: Number(a.expected_qty),
    errors: a.errors, result: a.result, note: a.note, resolution: a.resolution, resolved_by_name: a.resolved_by_name,
    resolved_at: a.resolved_at, resolution_note: a.resolution_note, created_at: a.created_at, legacy: a.legacy,
  }));

  return (
    <main>
      <PageHeader title={`Audit shipment ${ship}`} live={["pick_tasks", "pick_audits", "shipment_loads", "waves", "movements"]} />
      <div className="p-4 lg:p-8">
        <ShipmentAuditClient shipment={s as ShipmentRow} lines={view} attempts={tries} supervisor={user.role !== "operator"} />
      </div>
    </main>
  );
}
