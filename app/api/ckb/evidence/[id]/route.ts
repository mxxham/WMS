import { NextResponse } from "next/server";
import { checkCkb } from "@/lib/ckb/auth";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/ckb/evidence";

/**
 * Open one evidence file. The database decides (ckb_evidence_open: RLS-equivalent visibility for
 * staff and representatives, logs the view); only then is a 60-second signed URL created.
 * `?src=rb` opens a rebagging photo (0084's bucket), which only CKB staff may see.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await checkCkb(["admin", "supervisor", "operator", "customer"]);
  if (!user) return new NextResponse("Tidak diizinkan", { status: 403 });
  const { id } = await params;
  if (!isUuid(id)) return new NextResponse("Tidak ditemukan", { status: 404 });
  const db = await createClient();
  const rebagging = new URL(req.url).searchParams.get("src") === "rb";

  let bucket: string, path: string;
  if (rebagging) {
    if (user.ckbRole === "customer") return new NextResponse("Tidak ditemukan", { status: 404 });
    const { data } = await db.from("ckb_rebagging_evidence").select("storage_path").eq("id", id).maybeSingle();
    if (!data) return new NextResponse("Tidak ditemukan", { status: 404 });
    bucket = "ckb-rebagging"; path = data.storage_path;
  } else {
    const { data, error } = await db.rpc("ckb_evidence_open", { p_id: id }).maybeSingle<{ storage_path: string; mime: string }>();
    if (error || !data) return new NextResponse("Tidak ditemukan", { status: 404 });
    bucket = "ckb-evidence"; path = data.storage_path;
  }
  const { data: signed, error } = await createServiceClient().storage.from(bucket).createSignedUrl(path, 60);
  if (error || !signed) return new NextResponse("File tidak bisa dibuka", { status: 502 });
  return NextResponse.redirect(signed.signedUrl, { headers: { "Cache-Control": "private, no-store" } });
}
