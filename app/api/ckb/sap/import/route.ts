import { NextResponse } from "next/server";
import { checkCkb } from "@/lib/ckb/auth";
import { createClient } from "@/lib/supabase/server";
import { readSapFile, sapUploadError } from "@/lib/ckb/sap-file";
import type { SapMapping } from "@/lib/ckb/sap-import";

/**
 * Import an SAP file as an immutable snapshot. The file is parsed again here (the browser's preview
 * is never trusted) and written in one RPC call as the signed-in supervisor/admin, which validates
 * every row again, refuses a duplicate file, and audits the import (0100).
 */
export async function POST(req: Request) {
  const user = await checkCkb(["admin", "supervisor"]);
  if (!user) return NextResponse.json({ error: "Hanya supervisor atau admin CKB." }, { status: 403 });
  const fd = await req.formData();
  const file = fd.get("file") as File | null;
  const customer = String(fd.get("customer") ?? "");
  const snapshotDate = String(fd.get("snapshot_date") ?? "");
  const bad = sapUploadError(file);
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });
  if (!/^[0-9a-f-]{36}$/.test(customer)) return NextResponse.json({ error: "Pilih customer." }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) return NextResponse.json({ error: "Isi tanggal snapshot." }, { status: 400 });

  const db = await createClient();
  const { data: setting } = await db.from("ckb_settings").select("value").eq("key", "sap_import").single();
  const mapping = ((setting?.value as { columns?: SapMapping } | null)?.columns ?? {}) as SapMapping;
  const read = await readSapFile(file!, mapping, String(fd.get("sheet") ?? "") || null);
  if (read.fileErrors.length) return NextResponse.json({ error: read.fileErrors.join(" ") }, { status: 400 });
  if (read.rows.length === 0) return NextResponse.json({ error: "Tidak ada baris stok yang valid di file ini." }, { status: 400 });

  const { data: id, error } = await db.rpc("ckb_import_sap_snapshot", {
    p_customer: customer, p_snapshot_date: snapshotDate,
    p_file: { name: read.name, sha256: read.sha256, size: read.size, sheet: read.sheet, header_line: read.headerLine },
    p_rows: read.rows, p_errors: read.errors, p_note: String(fd.get("note") ?? "") || null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ id, rows: read.rows.length, rejected: read.errors.length });
}
