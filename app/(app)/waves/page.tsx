import { requirePage } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import { assignedDates, filterToAssigned, keepWaveIds, neighbourDates } from "@/lib/assigned-waves";
import { PageHeader } from "@/components/app/page-header";
import type { OutboundRow, TaskRow, WaveRow } from "@/lib/allocator/picklist-from-tasks";
import type { ShipmentState } from "@/lib/pick-audit";
import type { PicklistCorrection } from "./corrections-panel";
import { WavesClient, type OutboundDetail, type TaskWait } from "./waves-client";
import type { LineRequest } from "./escalations-panel";
import type { OpenCount } from "./problems-panel";

export const dynamic = "force-dynamic";

/** One row of wave_problems() (0097): the audit / short / wait data behind "Perlu ditangani". */
type WaveProblemRow = {
  kind: "audit" | "short" | "wait";
  wave_id: string | null; wave_no: string | null; shipment_number: string | null; state: string | null;
  task_id: string | null; wait_task_id: string | null; wait_wave_no: string | null; wait_seq: number | null;
  wait_from: string | null; wait_to: string | null; wait_qty: number | null; wait_have: number | null;
  wait_wave_status: string | null;
};

export default async function WavesPage({ searchParams }: { searchParams: Promise<{ date?: string; wave?: string }> }) {
  const user = await requirePage("/waves");
  const sp = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
  const supabase = await createClient();

  // An operator sees only the shipments assigned to them (shipment_assignments, RLS: readable by active users).
  const assignedOnly = user.job === "operator";
  const mineRows = assignedOnly
    ? ((await supabase.from("shipment_assignments").select("planned_date, shipment_number").eq("user_id", user.id)).data ?? []) as { planned_date: string; shipment_number: string }[]
    : [];
  const assignedToday = new Set(mineRows.filter((r) => r.planned_date === date).map((r) => r.shipment_number));

  const [{ data: wavesAll }, tasksAll, { data: outboundAll }, { data: recent }, { data: problemsAll }, { data: counts }, { data: lastImport }, { data: corrections }, { data: requestsAll }, { data: after }] = await Promise.all([
    supabase.from("waves").select("id, wave_no, planned_date, shipment_numbers, truck, destination, planned_slot, status")
      .eq("planned_date", date).order("planned_slot", { nullsFirst: false }).order("wave_no"),
    fetchAll<TaskRow>((from, to) => supabase.from("pick_task_detail").select("*").eq("planned_date", date).order("seq").order("id").range(from, to)),
    supabase.from("outbound").select("wave_id, shipment_number, sku, description, order_nos, quantity_requested, quantity_allocated, quantity_picked, shortage_reason, status")
      .eq("outbound_date", date).order("shipment_number"),
    // The nearest planned days before and after this one, for the day arrows.
    supabase.from("waves").select("planned_date").lt("planned_date", date).order("planned_date", { ascending: false }).limit(1),
    // Perlu ditangani in one round trip (0097): the audit state of every shipment, the open tasks
    // the stock can no longer satisfy, and the open tasks waiting for a relocation into their bin.
    supabase.rpc("wave_problems", { p_date: date }),
    // Counts opened by a short pick (0038), still to be done: listed in "Perlu ditangani".
    supabase.from("count_task_detail").select("id, bin_code, status, reason, created_at").eq("source", "PICK").in("status", ["OPEN", "RECOUNT", "COUNTED"]).order("created_at"),
    // The last full import (stock missing from the file zeroed): counts opened before it questioned stock that has since been replaced.
    supabase.from("movements").select("created_at").like("note", "IMPORT % (not in file)").order("created_at", { ascending: false }).limit(1),
    // Koreksi picklist of this date (0057): what the paper took that the system did not have.
    supabase.from("picklist_corrections").select("*").eq("planned_date", date).order("sku").order("bin_code"),
    // Minta supervisor (0067): picker lines the picking screen could not post.
    supabase.from("pick_line_requests_open").select("*").eq("planned_date", date).order("created_at"),
    // The nearest planned day after this one, for the day arrows.
    supabase.from("waves").select("planned_date").gt("planned_date", date).order("planned_date").limit(1),
  ]);
  const waves = assignedOnly ? filterToAssigned((wavesAll ?? []) as WaveRow[], assignedToday) : wavesAll;
  const keep = new Set((waves ?? []).map((w) => w.id));
  const tasks = assignedOnly ? keepWaveIds(keep, tasksAll) : tasksAll;
  const outbound = assignedOnly ? keepWaveIds(keep, (outboundAll ?? []) as { wave_id: string | null }[]) : outboundAll;
  const requests = assignedOnly ? keepWaveIds(keep, (requestsAll ?? []) as { wave_id: string | null }[]) : requestsAll;
  const keepTask = new Set(tasks.map((t) => t.id));
  // Audit rows carry a wave; short / wait rows are kept by the task they name.
  const problems = assignedOnly
    ? ((problemsAll ?? []) as WaveProblemRow[]).filter((r) => (r.kind === "audit" ? !!r.wave_id && keep.has(r.wave_id) : !!r.task_id && keepTask.has(r.task_id)))
    : problemsAll;
  // The day arrows of an operator only move between days that have an assignment for them.
  const dayNeighbours = neighbourDates(assignedDates(mineRows), date);
  const prevDate = assignedOnly ? dayNeighbours.prev : ((recent?.[0]?.planned_date as string | undefined) ?? null);
  const nextDate = assignedOnly ? dayNeighbours.next : ((after?.[0]?.planned_date as string | undefined) ?? null);

  // 0097: one response, split by `kind` into the three shapes the panels take — the same rows,
  // the same maps as the three separate queries built before it.
  const problemRows = (problems ?? []) as WaveProblemRow[];
  const shortfalls = problemRows.filter((r) => r.kind === "short").map((r) => r.task_id as string);
  const audit: Record<string, ShipmentState> = Object.fromEntries(
    problemRows.filter((r) => r.kind === "audit")
      .map((r) => [`${r.wave_id}|${r.shipment_number}`, r.state as ShipmentState])
  );
  const waits: Record<string, TaskWait> = Object.fromEntries(
    problemRows.filter((r) => r.kind === "wait").map((r) => [r.task_id as string, {
      task_id: r.task_id as string, have: Number(r.wait_have), wait_wave_no: r.wait_wave_no as string,
      wait_seq: Number(r.wait_seq), wait_from: r.wait_from as string, wait_to: r.wait_to as string,
      wait_qty: Number(r.wait_qty), wait_task_id: r.wait_task_id as string, wait_wave_status: r.wait_wave_status as string,
    } satisfies TaskWait])
  );

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
      <PageHeader title="Wave & tugas pick" live={["waves", "pick_tasks", "outbound", "movements", "pick_audits", "shipment_loads", "pick_line_requests", "shipment_assignments"]} />
      <div className="space-y-4 p-4 lg:p-8">
        <WavesClient
          date={date}
          prevDate={prevDate}
          nextDate={nextDate}
          role={user.role}
          assignedOnly={assignedOnly}
          waves={(waves ?? []) as WaveRow[]}
          tasks={tasks}
          outbound={(outbound ?? []) as (OutboundRow & OutboundDetail)[]}
          shortfalls={shortfalls}
          waits={waits}
          audit={audit}
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
