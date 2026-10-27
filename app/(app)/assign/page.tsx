import { requirePage } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app/page-header";
import type { BoardRow, OperatorRow } from "@/lib/assign-board";
import { AssignClient } from "./assign-client";

export const dynamic = "force-dynamic";

export default async function AssignPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  await requirePage("/assign");
  const sp = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
  const supabase = await createClient();
  const [board, ops, prev, next] = await Promise.all([
    supabase.rpc("assignment_board", { p_date: date }),
    supabase.rpc("assignable_operators"),
    supabase.from("waves").select("planned_date").lt("planned_date", date).order("planned_date", { ascending: false }).limit(1),
    supabase.from("waves").select("planned_date").gt("planned_date", date).order("planned_date").limit(1),
  ]);
  const error = board.error?.message ?? ops.error?.message ?? null;
  return (
    <>
      <PageHeader title="Penugasan" live={["shipment_assignments", "pick_tasks", "waves", "shipment_loads"]} />
      <div className="space-y-4 p-4 lg:p-8">
        {error
          ? <p role="alert" className="rounded-md bg-white p-4 text-sm text-bad">{error}</p>
          : <AssignClient date={date} prevDate={(prev.data?.[0]?.planned_date as string | undefined) ?? null}
              nextDate={(next.data?.[0]?.planned_date as string | undefined) ?? null}
              rows={(board.data ?? []) as BoardRow[]} operators={(ops.data ?? []) as OperatorRow[]} />}
      </div>
    </>
  );
}
