import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app/page-header";
import { ReceivingList, type ReceiptSummary } from "./receiving-list";

export const dynamic = "force-dynamic";

/** Trucks from Shell, checked against their delivery document before stock is posted. */
export default async function ReceivingPage() {
  const user = await requireRole(["operator", "supervisor", "admin"]);
  const supabase = await createClient();
  const { data } = await supabase.from("receipt_summary").select("*").order("created_at", { ascending: false }).limit(100);
  return (
    <main>
      <PageHeader title="Penerimaan" live={["movements", "receipts"]} />
      <ReceivingList receipts={(data ?? []) as ReceiptSummary[]} supervisor={user.role !== "operator"} />
    </main>
  );
}
