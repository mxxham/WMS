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

/** One row of wave_problems() (0097): the audit / short / wait data behind "Perlu ditangani". */
type WaveProblemRow = {
  kind: "audit" | "short" | "wait";
  wave_id: string | null; wave_no: string | null; shipment_number: string | null; state: string | null;
  task_id: string | null; wait_task_id: string | null; wait_wave_no: string | null; wait_seq: number | null;
  wait_from: string | null; wait_to: string | null; wait_qty: number | null; wait_have: number | null;
  wait_wave_status: string | null;
};

export default async function WavesPage({ searchParams }: { searchParams: Promise<{ date?: string; wave?: string }> }) {
  const user = await requireRole(["operator", "supervisor", "admin"]);
  const sp = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
  const supabase = await createClient();

  const [{ data: waves }, tasks, { data: outbound }, { data: recent }, { data: problems }, { data: counts }, { data: lastImport }, { data: corrections }, { data: requests }, { data: after }] = await Promise.all([
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
  const prevDate = (recent?.[0]?.planned_date as string | undefined) ?? null;
  const nextDate = (after?.[0]?.planned_date as string | undefined) ?? null;

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
