import { NextResponse } from "next/server";
import { checkCkb } from "@/lib/ckb/auth";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/ckb/evidence";

/**
 * Open one housekeeping photo. The database decides (ckb_hk_photo_open: a lead any photo, a PIC their own, a
 * customer only a done check-in of their customer; a customer's view is logged); only then is a 60-second signed URL made.
 * `?raw=1` streams the bytes through this route instead of redirecting, so the browser can draw the photo on a canvas
 * (the photo pack PDF) without a cross-origin taint. Photos are resized before upload, so they stay small.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await checkCkb(["admin", "supervisor", "operator", "customer"]);
  if (!user) return new NextResponse("Tidak diizinkan", { status: 403 });
  const { id } = await params;
  if (!isUuid(id)) return new NextResponse("Tidak ditemukan", { status: 404 });
  const db = await createClient();
  const { data, error } = await db.rpc("ckb_hk_photo_open", { p_id: id }).maybeSingle<{ storage_path: string; mime: string }>();
  if (error || !data) return new NextResponse("Tidak ditemukan", { status: 404 });
  const { data: signed, error: e2 } = await createServiceClient().storage.from("ckb-evidence").createSignedUrl(data.storage_path, 60);
  if (e2 || !signed) return new NextResponse("File tidak bisa dibuka", { status: 502 });
  if (new URL(req.url).searchParams.get("raw") === "1") {
    const file = await fetch(signed.signedUrl);
    if (!file.ok || !file.body) return new NextResponse("File tidak bisa dibuka", { status: 502 });
    return new NextResponse(file.body, { headers: { "Content-Type": data.mime, "Cache-Control": "private, no-store" } });
  }
  return NextResponse.redirect(signed.signedUrl, { headers: { "Cache-Control": "private, no-store" } });
}
