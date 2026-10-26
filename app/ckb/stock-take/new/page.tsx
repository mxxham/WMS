import type { Metadata } from "next";
import { requireCkb } from "@/lib/ckb/auth";
import { createClient } from "@/lib/supabase/server";
import { CkbHeader, CkbBody } from "@/components/ckb/ui";
import { NewStocktakeForm } from "./new-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sesi stock take baru" };

export default async function NewStocktakePage() {
  await requireCkb("/ckb/stock-take/new");
  const db = await createClient();
  const [{ data: customers }, { data: imports }, { data: staff }, { data: settings }] = await Promise.all([
    db.from("ckb_customers").select("id, name, active_snapshot_id").eq("active", true).order("name"),
    db.from("ckb_sap_imports").select("id, ref_no, customer_id, snapshot_date, row_count").order("snapshot_date", { ascending: false }).limit(500),
    db.rpc("ckb_staff"),
    db.from("ckb_settings").select("key, value").in("key", ["warehouses", "stocktake"]),
  ]);
  const counters = ((staff ?? []) as { user_id: string; name: string }[]).map((p) => ({ id: p.user_id, name: p.name }));
  const setting = Object.fromEntries((settings ?? []).map((s) => [s.key, s.value]));
  return (
    <main>
      <CkbHeader title="Sesi stock take baru" back={{ href: "/ckb/stock-take", label: "Stock take" }} />
      <CkbBody className="max-w-3xl">
        <NewStocktakeForm customers={customers ?? []} imports={imports ?? []} counters={counters}
          warehouses={(setting.warehouses as string[] | undefined) ?? ["Warehouse 5"]}
          blindDefault={(setting.stocktake as { blind_default?: boolean } | undefined)?.blind_default ?? true} />
      </CkbBody>
    </main>
  );
}
