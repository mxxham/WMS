import { NextResponse } from "next/server";
import { randomUUID, createHash } from "node:crypto";
import { checkCkb } from "@/lib/ckb/auth";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { evidenceFileError, isUuid, sniffMime, type EvidencePolicy } from "@/lib/ckb/evidence";
import { hkPhotoPath, type HkPhotoKind } from "@/lib/ckb/housekeeping";

const BUCKET = "ckb-evidence";
const IMAGES = ["image/jpeg", "image/png", "image/webp"];

/**
 * Upload one housekeeping photo (before or after) of a started check-in. Order: the database says which
 * customer the check-in belongs to (and that the caller started it), the bytes prove the file is an image,
 * the object is stored under a path built from ids only, then the photo is registered AS THE USER:
 * ckb_hk_register_photo re-checks the owner, the state, the rules and the path, and refuses a file already
 * used (same SHA-256). If registering fails the stored object is removed.
 */
export async function POST(req: Request) {
  const user = await checkCkb(["admin", "supervisor", "operator"]);
  if (!user) return NextResponse.json({ error: "Hanya staf CKB yang bisa mengunggah foto." }, { status: 403 });
  const fd = await req.formData();
  const checkinId = String(fd.get("checkin_id") ?? "");
  const kind = String(fd.get("kind") ?? "") as HkPhotoKind;
  const file = fd.get("file");
  if (!isUuid(checkinId) || (kind !== "BEFORE" && kind !== "AFTER")) return NextResponse.json({ error: "Data foto tidak valid." }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ error: "Ambil foto dulu." }, { status: 400 });

  const db = await createClient();
  const [{ data: checkin }, { data: setting }] = await Promise.all([
    db.from("ckb_hk_checkins").select("customer_id").eq("id", checkinId).maybeSingle(),
    db.from("ckb_settings").select("value").eq("key", "evidence").single(),
  ]);
  if (!checkin) return NextResponse.json({ error: "Check-in tidak ditemukan." }, { status: 404 });
  const policy = setting?.value as EvidencePolicy | undefined;
  if (!policy) return NextResponse.json({ error: "Pengaturan bukti tidak bisa dibaca." }, { status: 500 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const bad = evidenceFileError({ declaredMime: file.type, size: bytes.length, head: bytes.subarray(0, 16) }, policy);
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });
  const mime = sniffMime(bytes.subarray(0, 16))!;
  if (!IMAGES.includes(mime)) return NextResponse.json({ error: "Foto harus JPG, PNG atau WebP." }, { status: 400 });
  const path = hkPhotoPath(String(checkin.customer_id), checkinId, randomUUID(), mime);
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  const storage = createServiceClient().storage.from(BUCKET);
  const { error: up } = await storage.upload(path, bytes, { contentType: mime, upsert: false });
  if (up) return NextResponse.json({ error: `Upload gagal: ${up.message}` }, { status: 502 });
  const { data: id, error: reg } = await db.rpc("ckb_hk_register_photo", {
    p_checkin: checkinId, p_kind: kind, p_path: path, p_mime: mime, p_size: bytes.length, p_sha256: sha256,
  });
  if (reg) {
    await storage.remove([path]); // not registered = not kept
    return NextResponse.json({ error: reg.message }, { status: 400 });
  }
  return NextResponse.json({ id });
}
