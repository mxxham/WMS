import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getBinDetail } from "@/lib/bin-data";

// JSON bin detail for the 3D side panel. RLS applies via the user's session.
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const detail = await getBinDetail(supabase, code);
  if (!detail) return NextResponse.json({ error: `Bin ${code} tidak terdaftar` }, { status: 404 });
  return NextResponse.json(detail);
}
