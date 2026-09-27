import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app/page-header";
import { parsePolicy } from "@/lib/inventory-control";
import type { ReceiptSummary } from "../receiving-list";
import { ReceiptDetail, type Actual, type Compare } from "./receipt-detail";

export const dynamic = "force-dynamic";

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(["operator", "supervisor", "admin"]);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: receipt }, { data: actuals }, { data: compare }, { data: items }, { data: policy }] = await Promise.all([
    supabase.from("receipt_summary").select("*").eq("id", id).maybeSingle(),
    supabase.from("receipt_actuals").select("line_no, batch_lot, expiry_date, expiry_confirmed, quantity, damaged_qty, items(sku, description, uom), bins(bin_code)").eq("receipt_id", id).order("line_no"),
    supabase.from("receipt_compare").select("*").eq("receipt_id", id).order("sku"),
    supabase.from("items").select("sku, shelf_life_months").not("shelf_life_months", "is", null),
    supabase.rpc("inventory_policy"),
  ]);
  if (!receipt) notFound();
  return (
    <main>
      <PageHeader title={`Penerimaan ${receipt.doc_no}`} live={["movements", "receipts", "receipt_actuals"]} />
      <ReceiptDetail receipt={receipt as ReceiptSummary} actuals={(actuals ?? []) as unknown as Actual[]} compare={(compare ?? []) as Compare[]}
        supervisor={user.role !== "operator"} shelfLife={Object.fromEntries((items ?? []).map((i) => [i.sku as string, Number(i.shelf_life_months)]))}
        defaultShelfLife={parsePolicy(policy).default_shelf_life_months} />
    </main>
  );
}
