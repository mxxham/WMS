import { NextResponse } from "next/server";
import { checkRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import { buildLabelPdf, type LabelBin, type LabelOptions } from "@/lib/labels";

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = LabelOptions & (
  | { scope: "bins"; codes: string[] }
  | { scope: "rack"; zone: string; rack: string }
  | { scope: "zone"; zone: string }
);

// POST -> PDF. Supervisor/admin only; every print is written to print_logs.
export async function POST(req: Request) {
  const user = await checkRole(["supervisor", "admin"]);
  if (!user) return NextResponse.json({ error: "Hanya supervisor/admin yang bisa mencetak label." }, { status: 403 });
  const body = (await req.json()) as Body;
  const supabase = await createClient();

  type Row = LabelBin & { id: string };
  let bins: Row[];
  try {
    bins = await fetchAll<Row>((a, b) => {
      let q = supabase.from("bins").select("id, bin_code, zone, rack, level, position, abc_class").order("bin_code");
      if (body.scope === "bins") q = q.in("bin_code", body.codes.map((c) => c.trim().toUpperCase()).filter(Boolean));
      else if (body.scope === "rack") q = q.eq("zone", body.zone).eq("rack", body.rack);
      else q = q.eq("zone", body.zone);
      return q.range(a, b);
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  if (!bins?.length) return NextResponse.json({ error: "Tidak ada bin yang cocok dengan pilihan." }, { status: 404 });

  const pdf = await buildLabelPdf(bins, {
    layout: body.layout, colorMode: body.colorMode, includeCode128: Boolean(body.includeCode128),
  });
  await supabase.from("print_logs").insert({
    bin_ids: bins.map((b) => b.id), user_id: user.id,
    note: `${body.scope} · ${body.layout} · ${body.colorMode}${body.includeCode128 ? " · code128" : ""}`,
  });
  return new NextResponse(Buffer.from(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="label-bin-${Date.now()}.pdf"` },
  });
}
