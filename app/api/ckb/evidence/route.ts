import { NextResponse } from "next/server";
import { randomUUID, createHash } from "node:crypto";
import { checkCkb } from "@/lib/ckb/auth";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { EVIDENCE_ENTITIES, EVIDENCE_KINDS, evidenceFileError, evidencePath, isUuid, sniffMime, type EvidenceEntity, type EvidencePolicy } from "@/lib/ckb/evidence";

const BUCKET = "ckb-evidence";

/**
 * Upload one evidence file. Order: the database says which customer the record belongs to (and
 * that the caller may see it), the bytes prove the file type, the object is stored under a path
 * built from ids only, then the row is registered AS THE USER — ckb_register_evidence re-checks
 * role, record state, type, size and path. If registering fails the stored object is removed.
 */
export async function POST(req: Request) {
  const user = await checkCkb(["admin", "supervisor", "operator"]);
  if (!user) return NextResponse.json({ error: "Hanya staf CKB yang bisa mengunggah bukti." }, { status: 403 });
  const fd = await req.formData();
  const entityType = String(fd.get("entity_type") ?? "") as EvidenceEntity;
  const entityId = String(fd.get("entity_id") ?? "");
  const kind = String(fd.get("kind") ?? "GENERAL");
  const file = fd.get("file");
  if (!EVIDENCE_ENTITIES.includes(entityType) || !isUuid(entityId)) return NextResponse.json({ error: "Data yang dilampiri tidak valid." }, { status: 400 });
  if (!(EVIDENCE_KINDS as readonly string[]).includes(kind)) return NextResponse.json({ error: "Jenis bukti tidak valid." }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ error: "Pilih file." }, { status: 400 });

  const db = await createClient();
  const [{ data: customer, error: e1 }, { data: setting }] = await Promise.all([
    db.rpc("ckb_entity_customer", { p_type: entityType, p_id: entityId }),
    db.from("ckb_settings").select("value").eq("key", "evidence").single(),
  ]);
  if (e1 || !customer) return NextResponse.json({ error: "Data yang dilampiri tidak ditemukan." }, { status: 404 });
  const policy = setting?.value as EvidencePolicy | undefined;
  if (!policy) return NextResponse.json({ error: "Pengaturan bukti tidak bisa dibaca." }, { status: 500 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const bad = evidenceFileError({ declaredMime: file.type, size: bytes.length, head: bytes.subarray(0, 16) }, policy);
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });
  const mime = sniffMime(bytes.subarray(0, 16))!;
  const path = evidencePath(String(customer), entityType, entityId, randomUUID(), mime);
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  const storage = createServiceClient().storage.from(BUCKET);
  const { error: up } = await storage.upload(path, bytes, { contentType: mime, upsert: false });
  if (up) return NextResponse.json({ error: `Upload gagal: ${up.message}` }, { status: 502 });
  const { data: id, error: reg } = await db.rpc("ckb_register_evidence", {
    p_entity_type: entityType, p_entity_id: entityId, p_kind: kind, p_path: path, p_mime: mime,
    p_size: bytes.length, p_sha256: sha256, p_description: String(fd.get("description") ?? "") || null,
  });
  if (reg) {
    await storage.remove([path]); // not registered = not kept
    return NextResponse.json({ error: reg.message }, { status: 400 });
  }
  return NextResponse.json({ id });
}
