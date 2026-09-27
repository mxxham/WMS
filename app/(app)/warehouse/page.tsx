import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Layout } from "@/lib/warehouse-types";
import { WarehouseClient } from "./warehouse-client";

export default async function WarehousePage() {
  const user = await requireRole(["operator", "supervisor", "admin"]);
  const supabase = await createClient();
  const { data } = await supabase.from("settings").select("value").eq("key", "layout").single();
  return <WarehouseClient layout={data?.value as Layout} role={user.role} />;
}
