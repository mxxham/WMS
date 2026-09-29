import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app/page-header";
import type { PickError } from "@/lib/pick-audit";
import { auditDate } from "../../../audit-header";
import type { AttemptView } from "../../[wave]/[shipment]/shipment-audit-client";
import type { SheetLineRow } from "../data";
import { FileAuditClient, type FileLineView } from "./file-audit-client";

export const dynamic = "force-dynamic";

type AuditRow = Omit<AttemptView, "task_id" | "resolution" | "resolved_by_name" | "resolved_at" | "resolution_note" | "legacy"> & { line_id: string };

/** One shipment's lines from the WMS file. A line's qty / batch / expiry is not sent to the browser until it has been audited. */
export default async function FileShipmentAuditPage({ params, searchParams }: {
  params: Promise<{ shipment: string }>; searchParams: Promise<{ date?: string }>;
}) {
  const user = await requireRole(["operator", "supervisor", "admin"]);
  const ship = decodeURIComponent((await params).shipment);
  const date = auditDate((await searchParams).date);
  const supabase = await createClient();
  const { data } = await supabase.from("sheet_pick_line_state").select("*")
    .eq("pick_date", date).eq("shipment_number", ship).order("seq").order("bin_code");
  const rows = (data ?? []) as SheetLineRow[];
  if (!rows.length) notFound();
  const { data: attempts } = await supabase.from("sheet_pick_audits").select("*")
    .in("line_id", rows.map((r) => r.id)).order("attempt_no");

  const lines: FileLineView[] = rows.map((l) => ({
    id: l.id, seq: l.seq, sku: l.sku, description: l.description, uom: l.uom, from_bin: l.bin_code,
    picklist: l.picklist, picker_name: l.picker_name, state: l.line_state, attempts: l.attempts,
    expected: l.line_state === "TODO" ? undefined : { qty: Number(l.qty), batch: l.batch, expiry: l.expiry },
  }));
  const tries: AttemptView[] = ((attempts ?? []) as (AuditRow & { errors: PickError[] })[]).map((a) => ({
    id: a.id, task_id: a.line_id, attempt_no: a.attempt_no, checker_name: a.checker_name, found_sku: a.found_sku,
    found_batch: a.found_batch, found_expiry: a.found_expiry, counted_qty: Number(a.counted_qty), damaged: a.damaged,
    expected_sku: a.expected_sku, expected_batch: a.expected_batch, expected_expiry: a.expected_expiry, expected_qty: Number(a.expected_qty),
    errors: a.errors, result: a.result, note: a.note, resolution: null, resolved_by_name: null,
    resolved_at: null, resolution_note: null, created_at: a.created_at, legacy: false, correction: a.correction,
  }));

  return (
    <main>
      <PageHeader title={`Audit shipment ${ship}`} live={["sheet_pick_lines", "sheet_pick_audits"]} />
      <div className="p-4 lg:p-8">
        <FileAuditClient date={date} shipment={ship} waveNo={rows[0].wave_no} source={rows[0].source} lines={lines} attempts={tries}
          canCorrect={user.role !== "operator"} />
      </div>
    </main>
  );
}
