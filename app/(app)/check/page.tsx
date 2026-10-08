import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app/page-header";
import { CheckClient } from "./check-client";

export const dynamic = "force-dynamic";

/** Check outbound: verify picked shipments by scanning before loading. */
export default async function CheckPage() {
  const user = await requireRole(["operator", "supervisor", "admin"]);
  const supabase = await createClient();
  const { data: staff } = await supabase.from("profiles").select("name").order("name");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
  const names = [...new Set((staff ?? []).map((s) => s.name).filter((n): n is string => !!n))];
  return (
    <main>
      <PageHeader title="Check outbound" />
      <CheckClient role={user.role} staff={names} today={today} />
    </main>
  );
}
