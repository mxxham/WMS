import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import { PageHeader } from "@/components/app/page-header";
import type { OutboundRow, TaskRow, WaveRow } from "@/lib/allocator/picklist-from-tasks";
import type { ShipmentState } from "@/lib/pick-audit";
import type { PicklistCorrection } from "./corrections-panel";
import { WavesClient, type OutboundDetail, type TaskWait } from "./waves-client";
import type { LineRequest } from "./escalations-panel";
import type { OpenCount } from "./problems-panel";

export const dynamic = "force-dynamic";

export default async function WavesPage({ searchParams }: { searchParams: Promise<{ date?: string; wave?: string }> }) {
  const user = await requireRole(["operator", "supervisor", "admin"]);
  const sp = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
  const supabase = await createClient();

  const [{ data: waves }, tasks, { data: outbound }, { data: recent }, { data: shortfalls }, { data: auditStates }, { data: waits }, { data: counts }, { data: lastImport }, { data: corrections }, { data: requests }] = await Promise.all([
    supabase.from("waves").select("id, wave_no, planned_date, shipment_numbers, truck, destination, planned_slot, status")
      .eq("planned_date", date).order("planned_slot", { nullsFirst: false }).order("wave_no"),
    fetchAll<TaskRow>((from, to) => supabase.from("pick_task_detail").select("*").eq("planned_date", date).order("seq").order("id").range(from, to)),
    supabase.from("outbound").select("wave_id, shipment_number, sku, description, order_nos, quantity_requested, quantity_allocated, quantity_picked, shortage_reason, status")
      .eq("outbound_date", date).order("shipment_number"),
    // The nearest planned days before and after this one, for the day arrows.
    supabase.from("waves").select("planned_date").lt("planned_date", date).order("planned_date", { ascending: false }).limit(1),
    supabase.from("task_shortfalls").select("task_id").eq("planned_date", date),
    supabase.from("pick_audit_shipment").select("wave_id, shipment_number, state").eq("planned_date", date),
    supabase.from("task_waits").select("task_id, have, wait_wave_no, wait_seq, wait_from, wait_to, wait_qty, wait_task_id, wait_wave_status").eq("planned_date", date),
    // Counts opened by a short pick (0038), still to be done: listed in "Perlu ditangani".
    supabase.from("count_task_detail").select("id, bin_code, status, reason, created_at").eq("source", "PICK").in("status", ["OPEN", "RECOUNT", "COUNTED"]).order("created_at"),
    // The last full import (stock missing from the file zeroed): counts opened before it questioned stock that has since been replaced.
    supabase.from("movements").select("created_at").like("note", "IMPORT % (not in file)").order("created_at", { ascending: false }).limit(1),
    // Koreksi picklist of this date (0057): what the paper took that the system did not have.
    supabase.from("picklist_corrections").select("*").eq("planned_date", date).order("sku").order("bin_code"),
    // Minta supervisor (0067): picker lines the picking screen could not post.
    supabase.from("pick_line_requests_open").select("*").eq("planned_date", date).order("created_at"),
  ]);
  const { data: after } = await supabase.from("waves").select("planned_date").gt("planned_date", date).order("planned_date").limit(1);
  const prevDate = (recent?.[0]?.planned_date as string | undefined) ?? null;
  const nextDate = (after?.[0]?.planned_date as string | undefined) ?? null;

  // Fetch manual DO numbers for this date's waves (0079).
  const waveIds = (waves ?? []).map((w) => w.id);
  const { data: dosRows } = waveIds.length > 0
    ? await supabase.from("shipment_do_no").select("wave_id, shipment_number, do_nos").in("wave_id", waveIds)
    : { data: null };
  const dos: Record<string, string[]> = Object.fromEntries(
    (dosRows ?? []).map((r) => [`${r.wave_id}|${r.shipment_number}`, (r.do_nos as string[]) ?? []])
  );

  return (
    <main>
      <PageHeader title="Wave & tugas pick" live={["waves", "pick_tasks", "outbound", "movements", "pick_audits", "shipment_loads", "pick_line_requests"]} />
      <div className="space-y-4 p-4 lg:p-8">
        <WavesClient
          date={date}
          prevDate={prevDate}
          nextDate={nextDate}
          role={user.role}
          waves={(waves ?? []) as WaveRow[]}
          tasks={tasks}
          outbound={(outbound ?? []) as (OutboundRow & OutboundDetail)[]}
          shortfalls={(shortfalls ?? []).map((r) => r.task_id as string)}
          waits={Object.fromEntries(((waits ?? []) as TaskWait[]).map((w) => [w.task_id, w]))}
          audit={Object.fromEntries((auditStates ?? []).map((a) => [`${a.wave_id}|${a.shipment_number}`, a.state as ShipmentState]))}
          counts={(counts ?? []) as OpenCount[]}
          lastImport={(lastImport?.[0]?.created_at as string | undefined) ?? null}
          corrections={(corrections ?? []) as PicklistCorrection[]}
          requests={(requests ?? []) as LineRequest[]}
          dos={dos}
        />
      </div>
    </main>
  );
}
