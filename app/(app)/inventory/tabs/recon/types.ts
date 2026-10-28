import type { CompareLine } from "@/lib/sap-compare";

export type ReconSummary = {
  id: string; as_of: string; file_name: string | null; note: string | null; status: "OPEN" | "CLOSED"; created_by_name: string; created_at: string;
  closed_by_name: string | null; closed_at: string | null; close_note: string | null;
  slocs: string[] | null; other_slocs: string[] | null; sap_moves: number | null; auto_gi_at: string | null; auto_gi_by_name: string | null;
  skus: number; skus_match: number; accuracy_pct: number | null; abs_diff: number; sap_total: number; wms_total: number | null; open_diffs: number;
  skus_wms_more: number | null; skus_wms_less: number | null; qty_wms_more: number | null; qty_wms_less: number | null;
};

export type ReconLine = CompareLine & {
  id: string; recon_id: string; remark: string | null; updated_by_name: string | null; updated_at: string | null;
};

/** One MB51 line kept with the reconciliation (stock_recon_sap_moves). */
export type SapMove = {
  line_no: number; sku: string; description: string | null; sloc: string; mvt_type: string; mvt_text: string | null; mat_doc: string | null;
  posting_date: string | null; quantity: number; uom: string | null; reference: string | null; customer: string | null;
  customer_name: string | null; user_name: string | null;
};

/** recon_shipment_match (0111). */
export type ShipMatch = {
  status: "MATCH" | "SAP_MORE" | "WMS_MORE" | "NO_GI" | "NOT_IN_WMS";
  shipment_number: string | null; wave_no: string | null; planned_date: string | null; sku: string; description: string | null;
  do_nos: string[] | null; sap_gi: number; ordered: number; picked: number; timing: number; last_pick: string | null; posting_date: string | null;
};

export const SHIP_STATUS: Record<ShipMatch["status"], { label: string; tone: string; help: string }> = {
  MATCH: { label: "Cocok", tone: "bg-ok/15 text-ok", help: "GI SAP = qty yang kita pick." },
  WMS_MORE: { label: "Belum GI penuh", tone: "bg-warn/20 text-steel-900", help: "Kita pick lebih dari GI SAP: sisanya belum di-GI." },
  NO_GI: { label: "Belum GI", tone: "bg-warn/20 text-steel-900", help: "Sudah dipick di tanggal MB51, tidak ada GI di file." },
  SAP_MORE: { label: "GI > pick", tone: "bg-bad/15 text-bad", help: "SAP sudah GI lebih dari yang kita pick." },
  NOT_IN_WMS: { label: "DO tidak ada di WMS", tone: "bg-steel-100 text-steel-700", help: "DO yang di-GI SAP tidak ada di pengiriman WMS." },
};

/** Previous reconciliation's gap per SKU (our side), for "berulang". */
export type PrevGap = Record<string, number>;
