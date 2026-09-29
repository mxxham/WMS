import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { TabsNav } from "@/components/app/tabs-nav";
import { AuditList, type AuditRow } from "@/components/audit/audit-list";
import { fmtNum } from "@/lib/utils";
import { AuditHeader, auditDate } from "../audit-header";
import { RACK_STATE_LABEL, type RackState } from "../picking/rack-data";
import { RackList } from "../picking/rack-list";
import { putawayRows, putawaySummary } from "./rack-data";
import { DownloadPutawayAudit } from "./download-putaway-audit";

export const dynamic = "force-dynamic";

/**
 * Putaways and receipts made on the date (Jakarta time) and the checker's
 * audit: per rack (0027, default) or as one list.
 */
export default async function PutawayAuditPage({ searchParams }: { searchParams: Promise<{ date?: string; tab?: string }> }) {
  const user = await requireRole(["operator", "supervisor", "admin"]);
  const supervisor = user.role !== "operator";
  const sp = await searchParams;
  const date = auditDate(sp.date);
  // The list tab still audits with record_audit (0012), which is supervisor-only.
  const tab = supervisor && sp.tab === "daftar" ? "daftar" : "rak";
  const data = await putawayRows(await createClient(), date);

  let body: React.ReactNode;
  if (tab === "rak") {
    const racks = putawaySummary(data);
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
        <p className="text-sm text-steel-500">Checker memeriksa SKU, batch dan jumlah tiap putaway di rak. Buka rak untuk mulai.</p>
        <RackList rows={racks} href={(z) => `/audit/putaway/rak/${encodeURIComponent(z)}?date=${date}`}
          empty="Belum ada putaway di tanggal ini." head={["Bin diisi", "Putaway"]}
          unit={{ of: "lines", label: "putaway", doneHead: "Sudah diaudit" }} />
      </div>
    );
  } else {
    const rows: AuditRow[] = [...data].sort((a, b) => b.created_at.localeCompare(a.created_at)).map((m) => ({
      ref: m.movement_id, when: m.created_at, by: m.by,
      context: m.type === "inbound" ? "Terima baru" : `dari ${m.from_bin ?? "–"}${m.note ? ` · ${m.note}` : ""}`,
      bin: m.to_bin, sku: m.sku, description: m.description, uom: m.uom, batch: m.batch_lot, expiry: m.expiry_date,
      expected: m.quantity, deviation: null,
      audit: m.audit ? {
        result: m.audit.result, counted: m.audit.counted, skuOk: m.audit.skuOk, batchOk: m.audit.batchOk,
        note: m.audit.note, at: m.audit.at, by: m.audit.checker,
      } : null,
    }));
    body = <AuditList kind="PUTAWAY" rows={rows} />;
  }

  return (
    <main>
      <AuditHeader title="Audit putaway" date={date} active="putaway" />
      {supervisor && <TabsNav base="/audit/putaway" active={tab} tabs={[{ key: "rak", label: "Per rak" }, { key: "daftar", label: "Daftar" }]} />}
      <div className="space-y-4 p-4 lg:p-8">{data.length > 0 && <DownloadPutawayAudit date={date} />}{body}</div>
    </main>
  );
}
