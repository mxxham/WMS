import { RECON_STATUS } from "@/lib/inventory-control";
import { CAUSES, FLAG_LABEL, compareStats, flags, gapBlocked, gapTotal, gapUnrestricted, mvtLabel, type CompareStats } from "@/lib/sap-compare";
import { SHIP_STATUS, type PrevGap, type ReconLine, type ReconSummary, type SapMove, type ShipMatch } from "./types";

const num = (v: unknown) => Number(v ?? 0) || 0;
const pct = (v: number | null) => (v === null ? "" : Math.round(v * 10) / 10);

/**
 * One workbook per reconciliation: summary, SAP vs fisik (the columns of
 * the manual sheet first, so the old layout still lines up), shipments vs
 * GI and the MB51 lines. Loaded on click: the Excel library is not part of the page.
 */
export async function exportRecon(run: ReconSummary, lines: ReconLine[], moves: SapMove[], ships: ShipMatch[], prev: PrevGap | null) {
  const XLSX = await import("xlsx");
  const s: CompareStats = compareStats(lines);
  const book = XLSX.utils.book_new();

  const summary: (string | number)[][] = [
    ["Rekonsiliasi stok SAP vs WMS"], [],
    ["Stok SAP per", run.as_of], ["File", run.file_name ?? ""], ["Storage location dihitung", (run.slocs ?? []).join(", ") || "semua"],
    ["Lokasi SAP lain", (run.other_slocs ?? []).join(", ")],
    ["Stok WMS per", run.wms_day ? `on hand ${run.wms_day} (Laporan WMS harian)` : run.wms_at ? `${new Date(run.wms_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB` : `saat dibuat (${run.created_at})`], ["Dibuat", `${run.created_by_name} ${run.created_at}`],
    ["Status", run.status === "OPEN" ? "Terbuka" : `Ditutup ${run.closed_at} oleh ${run.closed_by_name}: ${run.close_note ?? ""}`], [],
    ["SKU", s.skus], ["SKU cocok", s.match], ["Akurasi SKU (%)", pct(s.skuAccuracy)], ["Akurasi qty (%)", pct(s.qtyAccuracy)],
    ["Total SAP", s.sapQty], ["Total WMS", s.wmsQty], ["Koreksi timing", s.timingQty],
    ["SKU WMS lebih dari SAP", s.more], ["Qty WMS lebih", s.moreQty], ["SKU WMS kurang dari SAP", s.less], ["Qty WMS kurang", s.lessQty],
    ["Hanya di SAP", s.onlySap], ["Hanya di WMS", s.onlyWms], ["Belum ditangani", s.open],
  ];
  const ws0 = XLSX.utils.aoa_to_sheet(summary);
  ws0["!cols"] = [{ wch: 28 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(book, ws0, "Ringkasan");

  const rows = [...lines].sort((a, b) => Math.abs(gapTotal(b)) - Math.abs(gapTotal(a)) || a.sku.localeCompare(b.sku)).map((l) => ({
    "SKU CODE": l.sku, "Material Description": l.description ?? "", "Base Unit of Measure": l.sap_uom || l.wms_uom || "",
    "SAP Unrestricted": num(l.sap_unrestricted), "SAP Blocked": num(l.sap_blocked),
    "FISIK Unrestricted": num(l.wms_unrestricted), "FISIK Blocked": num(l.wms_blocked),
    "Pending GI": num(l.pending_gi), "GI otomatis": num(l.auto_gi), "Pending GR": num(l.pending_gr),
    "Unrest Diff (SAP vs fisik)": num(l.diff_unrestricted), "Blok Diff (SAP vs fisik)": num(l.diff_blocked),
    "Selisih WMS - SAP": gapTotal(l), "Selisih bebas": gapUnrestricted(l), "Selisih blok": gapBlocked(l),
    Arah: gapTotal(l) > 0 ? "WMS lebih" : gapTotal(l) < 0 ? "WMS kurang" : "Cocok",
    "Lokasi SAP lain": Object.entries(l.sap_other ?? {}).map(([k, v]) => `${k} ${v}`).join(", "),
    Tanda: flags(l).map((f) => FLAG_LABEL[f]).join(", "),
    ...(prev ? { "Selisih sebelumnya": prev[l.sku] ?? "" } : {}),
    Status: RECON_STATUS[l.status], Penyebab: l.cause ? CAUSES[l.cause] : "", Remark: l.remark ?? "", "Diisi oleh": l.updated_by_name ?? "",
  }));
  const ws1 = XLSX.utils.json_to_sheet(rows);
  ws1["!autofilter"] = { ref: ws1["!ref"] ?? "A1" };
  XLSX.utils.book_append_sheet(book, ws1, "SAP vs fisik");

  if (ships.length) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(ships.map((r) => ({
      Status: SHIP_STATUS[r.status].label, Shipment: r.shipment_number ?? "", Wave: r.wave_no ?? "", Tanggal: r.planned_date ?? "",
      Material: r.sku, Description: r.description ?? "", DO: (r.do_nos ?? []).join(", "), "GI SAP": num(r.sap_gi),
      Order: num(r.ordered), Dipick: num(r.picked), Timing: num(r.timing), "Pick terakhir": r.last_pick ?? "",
    }))), "Pengiriman vs GI");
  }
  if (moves.length) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(moves.map((m) => ({
      "Posting Date": m.posting_date ?? "", "Storage Location": m.sloc, "Movement Type": m.mvt_type, Arti: mvtLabel(m.mvt_type),
      "Movement Type Text": m.mvt_text ?? "", Material: m.sku, "Material Description": m.description ?? "", Quantity: num(m.quantity),
      "Base Unit of Measure": m.uom ?? "", "Material Document": m.mat_doc ?? "", Reference: m.reference ?? "",
      Customer: m.customer ?? "", "Name 1": m.customer_name ?? "", "User Name": m.user_name ?? "",
    }))), "MB51");
  }
  XLSX.writeFile(book, `SAP_vs_WMS_${run.as_of}.xlsx`);
}
