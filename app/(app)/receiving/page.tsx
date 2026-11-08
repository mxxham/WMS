import { requirePage } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addDays } from "@/lib/ledger/dates";
import { receiptDay } from "@/lib/inbound/lot";
import { auditDate } from "../audit/audit-header";
import { ReceivingList, type ReceiptSummary } from "./receiving-list";

export const dynamic = "force-dynamic";

/**
 * Trucks from Shell, checked against their delivery document before stock is posted. One day at a time
 * (?date=, today by default): a planned receipt on its plan date, a manual one on the day it was made.
 * Receipts of other days that are not finished yet are counted, so a day's list never hides open work.
 */
export default async function ReceivingPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const user = await requirePage("/receiving");
  const date = auditDate((await searchParams).date);
  const start = new Date(`${date}T00:00:00+07:00`).toISOString(), end = new Date(`${addDays(date, 1)}T00:00:00+07:00`).toISOString();
  const supabase = await createClient();
  const [{ data: day }, { data: open }] = await Promise.all([
    supabase.from("receipt_summary").select("*")
      .or(`plan_date.eq.${date},and(plan_date.is.null,created_at.gte.${start},created_at.lt.${end})`)
      .order("created_at", { ascending: false }).limit(500),
    supabase.from("receipt_summary").select("*").in("status", ["OPEN", "CHECKED"]).order("created_at", { ascending: false }).limit(500),
  ]);
  const others = ((open ?? []) as ReceiptSummary[]).filter((r) => receiptDay(r) !== date);
  return (
    <main>
      <PageHeader title="Penerimaan" live={["movements", "receipts"]}>
        <form className="flex items-center gap-2">
          <Input type="date" name="date" defaultValue={date} className="w-auto" aria-label="Tanggal" />
          <Button type="submit" variant="outline">Tampilkan</Button>
        </form>
      </PageHeader>
      <ReceivingList date={date} receipts={(day ?? []) as ReceiptSummary[]} unfinished={others} supervisor={user.role !== "operator"} />
    </main>
  );
}
