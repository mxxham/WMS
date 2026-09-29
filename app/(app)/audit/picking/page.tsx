import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { TabsNav } from "@/components/app/tabs-nav";
import { SHIPMENT_STATE_LABEL, type ShipmentState } from "@/lib/pick-audit";
import { fmtNum } from "@/lib/utils";
import { AuditHeader, auditDate } from "../audit-header";
import { AccuracyView } from "./accuracy-view";
import { sheetRackBins, sheetShipments, type SheetLineRow } from "./file/data";
import { FileView } from "./file/file-view";
import { rackBins, rackSummary, RACK_STATE_LABEL, type RackState } from "./rack-data";
import { RackList } from "./rack-list";
import { ShipmentList, type ShipmentRow } from "./shipment-list";

export const dynamic = "force-dynamic";

const OPEN: ShipmentState[] = ["PICKING", "READY_AUDIT", "HAS_MISMATCH", "READY_LOAD"];

/**
 * Every picked line is audited by someone other than the picker, at the
 * rack (0025, default tab) or at staging per shipment; a shipment is loaded
 * only when all its lines passed (0024).
 */
export default async function PickingAuditPage({ searchParams }: { searchParams: Promise<{ date?: string; tab?: string; days?: string; view?: string }> }) {
  const user = await requireRole(["operator", "supervisor", "admin"]);
  const sp = await searchParams;
  const date = auditDate(sp.date);
  const supervisor = user.role !== "operator";
  const tab = supervisor && sp.tab === "akurasi" ? "akurasi" : sp.tab === "shipment" || sp.tab === "file" ? sp.tab : "rak";
  const days = [7, 30, 90].includes(Number(sp.days)) ? Number(sp.days) : 30;
  const supabase = await createClient();

  let body: React.ReactNode;
  if (tab === "akurasi") body = <AccuracyView days={days} />;
  else if (tab === "file") {
    const { data } = await supabase.from("sheet_pick_line_state").select("*").eq("pick_date", date);
    const rows = (data ?? []) as SheetLineRow[];
    const files = [...new Set(rows.map((r) => `${r.file_name ?? "file"} (${r.source === "K_ONE" ? "sheet K_ONE" : "alokasi dari stok WMS"})`))];
    body = <FileView date={date} shipments={sheetShipments(rows)} racks={rackSummary(sheetRackBins(rows))}
      view={sp.view === "shipment" ? "shipment" : "rak"} source={files.join(", ") || null} />;
  }
  else if (tab === "rak") {
    const racks = rackSummary(await rackBins(supabase, date));
    const count = (s: RackState) => racks.filter((r) => r.state === s).length;
    body = (
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          {(["TODO", "MISMATCH", "DONE"] as RackState[]).map((s) => (
            <div key={s} className="rounded-lg border-l-4 border-ckb bg-white p-3">
              <div className="font-cond text-3xl font-semibold tabular">{fmtNum(count(s))}</div>
              <div className="text-xs text-steel-500">Rak {RACK_STATE_LABEL[s].toLowerCase()}</div>
            </div>
          ))}
        </div>
        <p className="text-sm text-steel-500">Checker menghitung sisa di bin yang dipick, rak demi rak. Buka rak untuk mulai.</p>
        <RackList rows={racks} href={(z) => `/audit/picking/rak/${encodeURIComponent(z)}?date=${date}`}
          empty="Belum ada pick di tanggal ini." head={["Bin dipick", "Baris"]}
          unit={{ of: "bins", label: "bin", doneHead: "Sudah dihitung" }} />
      </div>
    );
  } else {
    const [{ data: today }, { data: carried }] = await Promise.all([
      supabase.from("pick_audit_shipment").select("*").eq("planned_date", date).order("wave_no").order("shipment_number"),
      supabase.from("pick_audit_shipment").select("*").lt("planned_date", date).in("state", OPEN).order("planned_date").order("shipment_number"),
    ]);
    const rows = (today ?? []) as ShipmentRow[];
    const earlier = (carried ?? []) as ShipmentRow[];
    const count = (s: ShipmentState) => rows.filter((r) => r.state === s).length;
    body = (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {(["READY_AUDIT", "HAS_MISMATCH", "READY_LOAD", "LOADED", "PICKING"] as ShipmentState[]).map((s) => (
            <div key={s} className="rounded-lg border-l-4 border-ckb bg-white p-3">
              <div className="font-cond text-3xl font-semibold tabular">{fmtNum(count(s))}</div>
              <div className="text-xs text-steel-500">{SHIPMENT_STATE_LABEL[s]}</div>
            </div>
          ))}
        </div>
        <ShipmentList rows={rows} empty="Belum ada shipment dengan pick di tanggal ini." />
        {earlier.length > 0 && (
          <section className="space-y-2">
            <h2 className="font-cond text-lg font-semibold text-bad">Belum dimuat dari tanggal sebelumnya</h2>
            <ShipmentList rows={earlier} empty="" showDate />
          </section>
        )}
      </div>
    );
  }

  return (
    <main>
      <AuditHeader title="Audit picking" date={date} active="picking"
        live={tab === "file" ? ["sheet_pick_lines", "sheet_pick_audits"] : ["pick_tasks", "pick_audits", "shipment_loads", "waves", "movements"]} />
      <TabsNav base="/audit/picking" active={tab}
        tabs={[{ key: "rak", label: "Per rak" }, { key: "shipment", label: "Shipment" }, { key: "file", label: "Dari file WMS" },
               ...(supervisor ? [{ key: "akurasi", label: "Akurasi picking" }] : [])]} />
      <div className="p-4 lg:p-8">{body}</div>
    </main>
  );
}
