import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import type { BinSummary } from "@/lib/warehouse-types";

// All bins with position, fill and expiry summary for the 3D view.
export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const bins = await fetchAll<BinSummary>((a, b) =>
    supabase.from("bin_summary").select("id, bin_code, zone, rack, level, position, status, capacity, pos_x, pos_y, pos_z, abc_class, total_qty, fill_ratio, min_expiry, skus").order("bin_code").range(a, b));
  return NextResponse.json({ bins });
}
