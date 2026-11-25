import { NextResponse } from "next/server";
import { checkCkb } from "@/lib/ckb/auth";
import { createClient } from "@/lib/supabase/server";
import { loadCountContext, readSapFile, sapUploadError } from "@/lib/ckb/sap-file";
import { mergePlan, totalQty } from "@/lib/ckb/sap-import";

/**
 * Preview an SAP file: nothing is written. Returns what would be imported, every rejected line,
 * and whether this exact file was already imported for the customer.
 */
export async function POST(req: Request) {
  const user = await checkCkb(["admin", "supervisor"]);
  if (!user) return NextResponse.json({ error: "Hanya supervisor atau admin CKB." }, { status: 403 });
  const fd = await req.formData();
  const file = fd.get("file") as File | null;
  const customer = String(fd.get("customer") ?? "");
  const bad = sapUploadError(file);
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });

  const db = await createClient();
  const ctx = await loadCountContext(db, /^[0-9a-f-]{36}$/.test(customer) ? customer : null);
  const read = await readSapFile(file!, ctx.mapping, String(fd.get("sheet") ?? "") || null);
  const { data: dup } = customer
    ? await db.from("ckb_sap_imports").select("ref_no, imported_at").eq("customer_id", customer).eq("file_sha256", read.sha256).maybeSingle()
    : { data: null };

  return NextResponse.json({
    name: read.name, size: read.size, sha256: read.sha256, sheet: read.sheet, sheets: read.sheets,
    headerLine: read.headerLine, columns: read.columns, fileErrors: read.fileErrors,
    rowCount: read.rows.length, totalQty: totalQty(read.rows), duplicateIdentities: read.duplicateIdentities,
    errorCount: read.errors.length, errors: read.errors.slice(0, 300), sample: read.rows.slice(0, 25),
    duplicateOf: dup ? { ref_no: dup.ref_no, imported_at: dup.imported_at } : null,
    mappingVerified: ctx.verified, mappingSource: ctx.source, countIdentity: ctx.identity, plan: mergePlan(read.rows, ctx.identity),
  });
}
