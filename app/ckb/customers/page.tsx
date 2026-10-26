import type { Metadata } from "next";
import { requireCkb } from "@/lib/ckb/auth";
import { createClient } from "@/lib/supabase/server";
import { CkbHeader, CkbBody, Notice } from "@/components/ckb/ui";
import { CustomersClient, type CustomerRow } from "./customers-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Customer" };

/** Customer directory: admins create and change, supervisors read. Every change is audited (0099). */
export default async function CustomersPage() {
  const user = await requireCkb("/ckb/customers");
  const db = await createClient();
  const [{ data: customers, error }, { data: imports }, { data: members }, { data: profiles }] = await Promise.all([
    db.from("ckb_customers").select("*").order("name"),
    db.from("ckb_sap_imports").select("id, ref_no, snapshot_date"),
    db.from("ckb_customer_members").select("user_id, customer_id"),
    db.from("profiles").select("id, name"),
  ]);
  const snap = new Map((imports ?? []).map((i) => [i.id, `${i.ref_no} · ${i.snapshot_date}`]));
  const pname = new Map((profiles ?? []).map((p) => [p.id, p.name]));
  const rows: CustomerRow[] = (customers ?? []).map((c) => ({
    ...c,
    snapshot: c.active_snapshot_id ? snap.get(c.active_snapshot_id) ?? null : null,
    reps: (members ?? []).filter((m) => m.customer_id === c.id).map((m) => pname.get(m.user_id) ?? "?"),
  }));
  return (
    <main>
      <CkbHeader title="Customer" subtitle="Customer CKB Warehouse 5 dan pengaturannya." live={["ckb_customers"]} />
      <CkbBody>
        {error && <Notice tone="bad">Customer tidak bisa dimuat: {error.message}</Notice>}
        {user.ckbRole !== "admin" && <Notice>Hanya admin CKB yang bisa mengubah customer.</Notice>}
        <CustomersClient rows={rows} canEdit={user.ckbRole === "admin"} />
      </CkbBody>
    </main>
  );
}
